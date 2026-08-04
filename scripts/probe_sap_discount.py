"""
Probe: enviar el pedido de SANDOVAL a SAP con distintos DiscountPercent
para encontrar el cap real. Solo hace POST de test - si alguno tiene exito
lo elimina inmediatamente (POST -> DELETE) para no dejar basura en SAP.

Ejecutar via workflow probe-sap-discount.yml (workflow_dispatch).
"""
import json
import sys

import requests

sys.path.insert(0, 'scripts')
from sync_sap_to_bigquery import (  # noqa: E402
    get_sl_config,
    init_firestore,
    log,
    parse_sa_json,
    sl_login,
)


def try_post_sq(cfg: dict, session: requests.Session, payload: dict, disc: float) -> None:
    """Intenta POST y reporta el resultado. Si exitoso, DELETE inmediato."""
    payload['DiscountPercent'] = disc
    resp = session.post(
        f"{cfg['url']}/b1s/v1/SalesQuotations",
        json=payload,
        timeout=30,
    )
    if resp.status_code in (200, 201):
        body = resp.json()
        doc_entry = body.get('DocEntry')
        log(f'[TEST disc={disc}%] OK: HTTP {resp.status_code}, DocEntry creado={doc_entry}')
        # Cleanup: cancel/delete
        try:
            del_resp = session.post(
                f"{cfg['url']}/b1s/v1/SalesQuotations({doc_entry})/Cancel",
                timeout=30,
            )
            log(f'  Cleanup Cancel: HTTP {del_resp.status_code}')
        except Exception as e:
            log(f'  Cleanup failed: {e}')
    else:
        try:
            err_body = resp.json()
            err_msg = err_body.get('error', {}).get('message', {}).get('value', 'no msg')
            err_code = err_body.get('error', {}).get('code', 'no code')
            log(f'[TEST disc={disc}%] FAIL: HTTP {resp.status_code}, code={err_code}, msg="{err_msg}"')
        except Exception:
            log(f'[TEST disc={disc}%] FAIL: HTTP {resp.status_code}, body="{resp.text[:400]}"')


def main() -> None:
    sa = parse_sa_json()
    db = init_firestore(sa)
    cfg = get_sl_config(db)
    session = requests.Session()
    sl_login(cfg, session)

    # Traer el pedido SANDOVAL de Firestore
    fs_id = 'VCTStbCkQpp2YnO5Isww'
    doc = db.collection('pedidos').document(fs_id).get()
    if not doc.exists:
        log(f'[FATAL] Pedido {fs_id} no existe')
        return
    p = doc.to_dict()
    log(f'Pedido: {p.get("clientName")} - {len(p.get("lines", []))} lineas - orig disc={p.get("discountPct")}%')

    # Construir payload minimalista (misma logica que buildQuotationPayload)
    # Traducimos SKUs directo (no re-consultamos el mapeo).
    # Solo primeras 3 lineas para hacer test rapido.
    lines = p.get('lines', [])[:3]
    doc_lines = [
        {
            'ItemCode': l.get('code'),
            'Quantity': float(l.get('qty', 0)),
            'WarehouseCode': '11',
            'LineNum': idx,
        }
        for idx, l in enumerate(lines)
    ]
    from datetime import datetime, timedelta
    today = datetime.utcnow().strftime('%Y-%m-%d')
    due = (datetime.utcnow() + timedelta(days=30)).strftime('%Y-%m-%d')
    payload = {
        'CardCode': 'C20418439794',  # SANDOVAL
        'DocDate': today,
        'DocDueDate': due,
        'TaxDate': today,
        'SalesPersonCode': -1,
        'Comments': 'TEST DISCOUNT PROBE - IGNORE',
        'NumAtCard': f'TEST_{fs_id}',
        'DocumentLines': doc_lines,
    }

    log('=' * 60)
    log('Probando distintos DiscountPercent con 3 primeras lineas de SANDOVAL')
    log('=' * 60)
    for disc in [0, 0.5, 1, 2, 3, 4, 5, 10]:
        try_post_sq(cfg, session, dict(payload), disc)


if __name__ == '__main__':
    main()
