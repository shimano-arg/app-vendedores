"""audit_waitlist_integrity.py

Chequea invariantes del sistema waitlist/pedidos post-v953:
  1. NO deberia haber 2+ pedidos con el mismo orderNumber.
  2. NO deberia haber revision_waitlist docs con orderNumber que YA
     exista como pedido confirmed (waitlist zombie).
  3. NO deberia haber revision_waitlist docs con stage='consumed' vivos
     hace mas de 1h (delete deberia haberse ejecutado).

Uso local:
    export FIREBASE_SERVICE_ACCOUNT="$(cat ~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json)"
    python scripts/audit_waitlist_integrity.py

Uso via GH Actions:
    ver .github/workflows/audit-waitlist-integrity.yml

Salida:
    exit 0 → OK, sin alertas
    exit 2 → alertas encontradas (el workflow falla, notifica en GH Actions)
    exit 1 → error interno
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import firebase_admin
from firebase_admin import credentials, firestore

# Config
STALE_CONSUMED_HOURS = 1  # docs stage=consumed vivos hace mas de N horas


def init_firestore():
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
    if not sa_json:
        print('ERROR: FIREBASE_SERVICE_ACCOUNT env var no seteada')
        sys.exit(1)
    try:
        sa_data = json.loads(sa_json)
    except json.JSONDecodeError as e:
        print(f'ERROR: FIREBASE_SERVICE_ACCOUNT no es JSON valido: {e}')
        sys.exit(1)
    cred = credentials.Certificate(sa_data)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def main():
    print('===== AUDIT waitlist/pedidos integrity =====\n')
    db = init_firestore()
    alerts = []

    # 1) Duplicados de orderNumber en pedidos.
    print('1) Buscando pedidos con orderNumber duplicado...')
    all_pedidos = list(db.collection('pedidos').stream())
    by_order = {}
    for d in all_pedidos:
        data = d.to_dict() or {}
        on = data.get('orderNumber')
        if on is None or on == '':
            continue
        key = str(on)
        by_order.setdefault(key, []).append({'id': d.id, **data})
    dupes = [(on, arr) for on, arr in by_order.items() if len(arr) > 1]
    print(f'   Total pedidos con orderNumber: {len(by_order)}')
    print(f'   Duplicados: {len(dupes)}')
    for on, arr in dupes:
        print(f'   ⚠️  ORDEN {on}: {len(arr)} pedidos')
        for p in arr:
            sap = (p.get('transferidoSAP') or {}).get('docNum') or '(no SAP)'
            print(f'      - id={p["id"]} client={p.get("clientName")} SAP={sap}')
        alerts.append(f'ORDEN {on}: {len(arr)} pedidos duplicados')
    if not dupes:
        print('   ✅ OK — no hay duplicados')

    # 2) Waitlist zombies.
    print('\n2) Buscando waitlist zombie (orderNumber ya en pedidos)...')
    wl_docs = list(db.collection('revision_waitlist').stream())
    zombies = []
    for d in wl_docs:
        data = d.to_dict() or {}
        on = data.get('orderNumber')
        if on and str(on) in by_order:
            zombies.append({
                'id': d.id,
                'orderNumber': on,
                'clientName': data.get('clientName'),
                'stage': data.get('stage'),
            })
    print(f'   Total waitlist docs: {len(wl_docs)}')
    print(f'   Zombie: {len(zombies)}')
    for z in zombies:
        print(f'   ⚠️  {z["id"]} — ORDEN {z["orderNumber"]} {z["clientName"]} stage="{z["stage"] or "sin-stage"}"')
        alerts.append(f'Waitlist zombie ORDEN {z["orderNumber"]} ({z["clientName"]})')
    if not zombies:
        print('   ✅ OK — no hay zombies')

    # 3) Waitlist docs stage=consumed vivos hace >1h.
    print(f'\n3) Buscando waitlist stage=consumed vivos >{STALE_CONSUMED_HOURS}h...')
    cutoff = datetime.now(timezone.utc) - timedelta(hours=STALE_CONSUMED_HOURS)
    stale_consumed = []
    for d in wl_docs:
        data = d.to_dict() or {}
        if data.get('stage') == 'consumed':
            consumed_at = data.get('consumedAt')
            if consumed_at is None or (hasattr(consumed_at, 'timestamp') and consumed_at < cutoff):
                stale_consumed.append({
                    'id': d.id,
                    'orderNumber': data.get('orderNumber'),
                })
    print(f'   Consumed viejos: {len(stale_consumed)}')
    for c in stale_consumed:
        print(f'   ⚠️  {c["id"]} — ORDEN {c["orderNumber"]}')
        alerts.append(f'Waitlist consumed no borrado ({c["id"]})')
    if not stale_consumed:
        print('   ✅ OK — ningun consumed vivo')

    # Resumen
    print('\n===== RESUMEN =====')
    if not alerts:
        print('✅ Sistema OK — todos los invariantes se cumplen')
        sys.exit(0)
    else:
        print(f'⚠️  {len(alerts)} alertas:')
        for a in alerts:
            print(f'   - {a}')
        print('\nAccion: revisar los casos manual + correr cleanup script (scripts/cleanup-*.cjs).')
        sys.exit(2)


if __name__ == '__main__':
    main()
