"""
Probe: enviar el pedido de SANDOVAL a SAP con DiscountPercent=4 para ver
el detalle del rechazo. Si el POST tiene exito, cancela el documento
(POST .../Cancel). OJO: Cancel NO borra — la cotizacion queda en SAP como
cancelada y consume numeracion.

C9 (contencion de scripts destructivos):
  - DRY-RUN por defecto: lee el pedido de Firestore, arma el payload e
    IMPRIME el request. No hace Login ni POST a SAP.
  - APPLY exige TODO esto:
        --project <id> --apply --confirm-project=<id>
        --sap-allow=Quotations,Quotations/Cancel
        --confirm-sap-company=<CompanyDB configurada>
  - Ya no imprime los headers de respuesta del SL (podian incluir cookies
    de sesion en los logs del workflow) y hace Logout al final.

Uso:
    python scripts/probe_sap_discount.py --project app-vendedores-shimano
"""
import json
import sys
from datetime import datetime, timedelta

import requests

sys.path.insert(0, 'scripts')
from _lib.script_guard import SapWriteGate, guard, mask_url  # noqa: E402
from _lib.safe_target import SafeTargetError  # noqa: E402
from sync_sap_to_bigquery import (  # noqa: E402
    get_sl_config,
    init_firestore,
    log,
    parse_sa_json,
    sl_login,
)

PEDIDO_FS_ID = 'VCTStbCkQpp2YnO5Isww'
CARD_CODE = 'C20418439794'  # SANDOVAL
SAP_ENTITIES = ('Quotations', 'Quotations/Cancel')


def build_probe_payload(p: dict, fs_id: str, now: datetime, disc: float = 4) -> dict:
    """Payload minimalista (3 primeras lineas). Puro: testeable sin red."""
    lines = (p.get('lines') or [])[:3]
    doc_lines = [
        {
            'ItemCode': l.get('code'),
            'Quantity': float(l.get('qty', 0)),
            'WarehouseCode': '11',
            'LineNum': idx,
        }
        for idx, l in enumerate(lines)
    ]
    today = now.strftime('%Y-%m-%d')
    due = (now + timedelta(days=30)).strftime('%Y-%m-%d')
    return {
        'CardCode': CARD_CODE,
        'DocDate': today,
        'DocDueDate': due,
        'TaxDate': today,
        'SalesPersonCode': -1,
        'Comments': 'TEST DISCOUNT PROBE - IGNORE',
        'NumAtCard': f'TEST_{fs_id}',
        'DocumentLines': doc_lines,
        'DiscountPercent': disc,
    }


def _read_sl_target(db) -> dict:
    """Solo url + companyDB (sin password): alcanza para el DRY-RUN."""
    snap = db.collection('app_config').document('sap_integration').get()
    sl = ((snap.to_dict() if snap.exists else None) or {}).get('serviceLayer') or {}
    return {'url': (sl.get('url') or '').rstrip('/'), 'companyDB': sl.get('companyDB') or ''}


def main(argv=None) -> int:
    t = guard(argv=argv, requires_write=True)
    sa = parse_sa_json()
    db = init_firestore(sa)
    sl_target = _read_sl_target(db)
    gate = SapWriteGate(t, SAP_ENTITIES, sl_target['companyDB'])
    if gate.rest:
        log(f'[FATAL] argumentos desconocidos: {gate.rest}')
        return 2
    try:
        gate.check_apply()
    except SafeTargetError as e:
        log(f'[safe-target] BLOQUEADO ({e.code}): {e}')
        return 2

    doc = db.collection('pedidos').document(PEDIDO_FS_ID).get()
    if not doc.exists:
        log(f'[FATAL] Pedido {PEDIDO_FS_ID} no existe')
        return 1
    p = doc.to_dict()
    log(f'Pedido: {p.get("clientName")} - {len(p.get("lines", []))} lineas - orig disc={p.get("discountPct")}%')
    payload = build_probe_payload(p, PEDIDO_FS_ID, datetime.utcnow())
    url_base = sl_target['url'] or 'https://<sin-config>'

    if not t.apply:
        gate.request(None, 'POST', f'{url_base}/b1s/v1/Quotations', 'Quotations', payload)
        gate.request(None, 'POST', f'{url_base}/b1s/v1/Quotations(<DocEntry>)/Cancel', 'Quotations/Cancel')
        log('[DRY-RUN] no se hizo Login ni ningun request a SAP.')
        return 0

    cfg = get_sl_config(db)  # password: env SAP_SL_PASSWORD (o legacy Firestore)
    session = requests.Session()
    sl_login(cfg, session)
    try:
        resp = gate.request(session, 'POST', f"{cfg['url']}/b1s/v1/Quotations", 'Quotations', payload, timeout=30)
        log(f'Status HTTP: {resp.status_code}')
        try:
            log(json.dumps(resp.json(), indent=2, ensure_ascii=False)[:4000])
        except Exception:
            log(mask_url(resp.text[:4000]))
        if resp.status_code in (200, 201):
            doc_entry = resp.json().get('DocEntry')
            log(f'ATENCION: creado DocEntry={doc_entry}, cancelando...')
            del_resp = gate.request(
                session, 'POST', f"{cfg['url']}/b1s/v1/Quotations({doc_entry})/Cancel",
                'Quotations/Cancel', timeout=30,
            )
            log(f'Cancel: HTTP {del_resp.status_code}')
            if not del_resp.ok:
                log(f'[ALERTA] La cotizacion DocEntry={doc_entry} quedo ABIERTA en SAP. Cancelarla a mano.')
                return 3
    finally:
        try:
            session.post(f"{cfg['url']}/b1s/v1/Logout", timeout=10)
        except Exception:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
