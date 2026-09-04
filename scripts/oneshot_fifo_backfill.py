# -*- coding: utf-8 -*-
"""oneshot_fifo_backfill.py — promocion manual BO -> ASIG para los BOs colgados.

CONTEXTO (v798, 2026-09-04):
  La CF onStockChangeFIFOAssign (functions/index.js:344) tuvo un bug desde v368
  (2026-07-31): el sync escribe warehouseBreakdown como JSON string, pero la CF
  hacia Object.keys() directo sobre el string. Resultado: skusChecked=0 SIEMPRE
  en logs, ninguna promocion se aplico durante ~5 semanas.

  El fix v798 (functions/core/fifo-assign-core.js) hace JSON.parse antes. Pero
  la CF solo dispara con DELTA positivo (afterDep11 > beforeDep11). Los SKUs
  que ya tienen stock disponible NO van a auto-promocionarse porque el delta
  va a ser 0 en los proximos syncs (before = after).

  Este script promociona MANUALMENTE los ~605 unidades / ~112 SKUs pendientes
  que YA tienen stock. Reusa la misma logica FIFO estricta que la CF (Q9
  decision Mariano): primeros pedidos se llevan la linea COMPLETA, si no
  cabe se corta (no promocion parcial).

  DESPUES de este backfill, la CF v798 queda cubriendo casos NUEVOS
  automaticamente. Este script no vuelve a correr.

Uso:
    $env:FIREBASE_SERVICE_ACCOUNT_PATH = "$HOME\Desktop\sa-key.json"
    python scripts\oneshot_fifo_backfill.py --dry-run   # simula
    python scripts\oneshot_fifo_backfill.py             # aplica

Requiere: firebase-admin (ya instalado en el ambiente del sync).

Salida:
  - Log resumen por SKU (n_candidatos, promociones, remaining stock).
  - Escritura a Firestore stock_assignment_log/oneshot-backfill-<TS>
    con el detalle completo (auditoria).
  - Modifica pedidos.<id>.lines[i].state='ASIG' + asigAt=<now>.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print('[ERROR] firebase-admin no instalado. pip install firebase-admin', file=sys.stderr)
    sys.exit(2)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_sa() -> dict:
    """Lee SA JSON desde env var o path fallback (Desktop/sa-key.json)."""
    env_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
    if env_json:
        try:
            return json.loads(env_json)
        except json.JSONDecodeError:
            pass
    env_path = os.environ.get('FIREBASE_SERVICE_ACCOUNT_PATH')
    if env_path and Path(env_path).exists():
        return json.loads(Path(env_path).read_text(encoding='utf-8'))
    default_path = Path.home() / 'Desktop' / 'sa-key.json'
    if default_path.exists():
        return json.loads(default_path.read_text(encoding='utf-8'))
    print('[FATAL] no encontre SA. Setea FIREBASE_SERVICE_ACCOUNT_PATH o poné sa-key.json en Desktop.', file=sys.stderr)
    sys.exit(2)


def init_firestore(sa_data: dict):
    cred = credentials.Certificate(sa_data)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def load_warehouse_breakdown(db) -> dict:
    """Lee stock_snapshot.warehouseBreakdown desde Firestore. Es JSON string."""
    snap = db.collection('app_config').document('stock_snapshot').get()
    if not snap.exists:
        print('[FATAL] app_config/stock_snapshot no existe', file=sys.stderr)
        sys.exit(3)
    data = snap.to_dict() or {}
    raw = data.get('warehouseBreakdown')
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            print(f'[FATAL] warehouseBreakdown JSON invalido: {e}', file=sys.stderr)
            sys.exit(3)
    if isinstance(raw, dict):
        return raw
    return {}


def load_bo_candidates(db, sku: str) -> list:
    """Carga lineas state='BO' de pedidos abiertos para un SKU. FIFO por createdAt.

    Devuelve: [{pedido_id, created_at_ms, line_index, qty_open, client_card_code}]
    """
    sku_up = sku.upper()
    candidates = []
    query = db.collection('pedidos').where('closedAt', '==', None).stream()
    for doc in query:
        data = doc.to_dict() or {}
        lines = data.get('lines') or []
        if not isinstance(lines, list):
            continue
        for i, line in enumerate(lines):
            if not isinstance(line, dict):
                continue
            code = str(line.get('code') or '').upper()
            if code != sku_up:
                continue
            if line.get('state') != 'BO':
                continue
            try:
                qty_open = float(line.get('qtyOpen') or 0)
            except (TypeError, ValueError):
                qty_open = 0
            if qty_open <= 0:
                continue
            # createdAt puede ser Firestore Timestamp (Admin SDK devuelve datetime),
            # ISO string, o int ms.
            created = data.get('createdAt')
            created_at_ms = 0
            if hasattr(created, 'timestamp'):
                created_at_ms = int(created.timestamp() * 1000)
            elif isinstance(created, str):
                try:
                    created_at_ms = int(datetime.fromisoformat(created.replace('Z', '+00:00')).timestamp() * 1000)
                except (ValueError, TypeError):
                    pass
            elif isinstance(created, (int, float)):
                created_at_ms = int(created)
            candidates.append({
                'pedido_id': doc.id,
                'created_at_ms': created_at_ms,
                'line_index': i,
                'qty_open': qty_open,
                'client_card_code': str(data.get('clientCardCode') or '').strip(),
            })
    # FIFO: createdAt ASC, tie-break por pedido_id.
    candidates.sort(key=lambda c: (c['created_at_ms'], c['pedido_id']))
    return candidates


def compute_fifo(candidates: list, available: float) -> tuple:
    """FIFO estricto: promociona lineas COMPLETAS hasta agotar stock. No parcial.
    Devuelve: (assignments, remaining)
    """
    assignments = []
    remaining = available
    for c in candidates:
        if remaining < c['qty_open']:
            break  # no cabe la linea completa, corta
        assignments.append({
            'pedido_id': c['pedido_id'],
            'line_index': c['line_index'],
            'qty_assigned': c['qty_open'],
            'client_card_code': c['client_card_code'],
        })
        remaining -= c['qty_open']
    return assignments, remaining


def apply_assignments(db, assignments: list, now_iso: str) -> int:
    """Aplica los updates a Firestore: lines[i].state='ASIG' + asigAt=now.
    Devuelve numero de pedidos actualizados.
    """
    updated = 0
    for a in assignments:
        ref = db.collection('pedidos').document(a['pedido_id'])
        snap = ref.get()
        if not snap.exists:
            continue
        data = snap.to_dict() or {}
        lines = data.get('lines') or []
        if not isinstance(lines, list) or a['line_index'] >= len(lines):
            continue
        line = lines[a['line_index']]
        if not isinstance(line, dict):
            continue
        # Verificacion defensiva: solo actualizar si sigue en state=BO.
        if line.get('state') != 'BO':
            continue
        line['state'] = 'ASIG'
        line['asigAt'] = now_iso
        lines[a['line_index']] = line
        ref.update({'lines': lines, 'updatedAt': now_iso})
        updated += 1
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='no modifica Firestore')
    parser.add_argument('--sku-cap', type=int, default=0, help='cap max de SKUs a procesar (0=sin cap)')
    args = parser.parse_args()

    print(f'[start] {_now_iso()} — dry_run={args.dry_run}')
    sa = _load_sa()
    db = init_firestore(sa)
    print('[fs] init OK')

    whs_map = load_warehouse_breakdown(db)
    skus_con_stock = [(sku, float(whs.get('11', 0)))
                      for sku, whs in whs_map.items()
                      if isinstance(whs, dict) and float(whs.get('11', 0) or 0) > 0]
    skus_con_stock.sort(key=lambda x: -x[1])  # mayor stock primero
    print(f'[skus] {len(skus_con_stock)} SKUs con stock dep 11 > 0')

    if args.sku_cap:
        skus_con_stock = skus_con_stock[:args.sku_cap]
        print(f'[skus] cap aplicado: procesando {len(skus_con_stock)}')

    now_iso = _now_iso()
    all_promotions = []
    skus_touched = 0
    total_assignments = 0
    total_qty_assigned = 0.0
    errors = []

    for sku, dep11 in skus_con_stock:
        try:
            candidates = load_bo_candidates(db, sku)
            if not candidates:
                continue
            assignments, remaining = compute_fifo(candidates, dep11)
            if not assignments:
                continue
            skus_touched += 1
            total_assignments += len(assignments)
            qty_sum = sum(a['qty_assigned'] for a in assignments)
            total_qty_assigned += qty_sum
            all_promotions.append({
                'sku': sku,
                'dep11_available': dep11,
                'candidates_n': len(candidates),
                'assignments': assignments,
                'remaining_after': remaining,
                'qty_assigned': qty_sum,
            })
            if not args.dry_run:
                applied = apply_assignments(db, assignments, now_iso)
                print(f'[promo] {sku}: dep11={dep11:.0f} n_cand={len(candidates)} n_promo={len(assignments)} qty={qty_sum:.0f} applied={applied}')
            else:
                print(f'[DRY promo] {sku}: dep11={dep11:.0f} n_cand={len(candidates)} n_promo={len(assignments)} qty={qty_sum:.0f}')
        except Exception as e:
            errors.append(f'sku={sku}: {e}')
            print(f'[ERR] {sku}: {e}')

    print()
    print('=' * 60)
    print(f'RESUMEN — skus con promociones: {skus_touched}')
    print(f'RESUMEN — total asignaciones (lineas): {total_assignments}')
    print(f'RESUMEN — total qty promocionada: {total_qty_assigned:.0f}')
    print(f'RESUMEN — errores: {len(errors)}')
    print('=' * 60)

    # Auditoria a Firestore (siempre, incluso dry-run).
    log_id = 'oneshot-backfill-' + now_iso.replace(':', '-').replace('.', '-')
    audit_doc = {
        'ranAt': now_iso,
        'mode': 'dry-run' if args.dry_run else 'active',
        'trigger': 'manual/oneshot_fifo_backfill.py',
        'skusChecked': len(skus_con_stock),
        'skusPromoted': skus_touched,
        'totalAssignments': total_assignments,
        'totalQtyAssigned': total_qty_assigned,
        'promotions': all_promotions,
        'errors': errors,
    }
    if not args.dry_run:
        db.collection('stock_assignment_log').document(log_id).set(audit_doc)
        print(f'[audit] escrito stock_assignment_log/{log_id}')
    else:
        print(f'[audit] DRY-RUN: no se escribio audit log ({len(json.dumps(audit_doc, default=str))} bytes)')


if __name__ == '__main__':
    main()
