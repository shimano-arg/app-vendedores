"""
One-shot probe: cuantas DeliveryNotes hay en SAP + ejemplos.

Corre en el workflow probe-sap-deliveries.yml (workflow_dispatch).
Usa el mismo login SL que sync_sap_to_bigquery.py — reusa las funciones
parse_sa_json / init_firestore / get_sl_config / sl_login.

Cero writes. Cero cambios de estado. Solo GETs de exploracion.
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


def probe_count(cfg: dict, session: requests.Session) -> int:
    """GET /DeliveryNotes?$top=1&$inlinecount=allpages -> count total."""
    url = (
        f"{cfg['url']}/b1s/v1/DeliveryNotes"
        "?$top=1&$inlinecount=allpages"
        "&$select=DocEntry,DocNum,DocDate,CardCode,CardName"
    )
    resp = session.get(url, timeout=30)
    if not resp.ok:
        log(f'[FATAL] GET DeliveryNotes: HTTP {resp.status_code} - {resp.text[:400]}')
        sys.exit(4)
    body = resp.json()
    count = body.get('@odata.count')
    log(f'[PROBE] @odata.count = {count}')
    log(f'[PROBE] Primera row: {json.dumps(body.get("value", [{}])[0], ensure_ascii=False)}')
    return int(count) if count is not None else -1


def probe_last_5(cfg: dict, session: requests.Session) -> None:
    """Trae las 5 Deliveries mas recientes con lineas resumidas."""
    url = (
        f"{cfg['url']}/b1s/v1/DeliveryNotes"
        "?$top=5&$orderby=DocDate desc"
        "&$select=DocEntry,DocNum,DocDate,CardCode,CardName,SlpCode,DocTotal,Cancelled,DocumentLines"
    )
    resp = session.get(url, timeout=30)
    if not resp.ok:
        log(f'[WARN] GET last 5: HTTP {resp.status_code}')
        return
    for d in resp.json().get('value', []):
        lines = d.get('DocumentLines', [])
        base_types = sorted({str(ln.get('BaseType')) for ln in lines})
        base_entries = sorted({ln.get('BaseEntry') for ln in lines if ln.get('BaseEntry') is not None})
        log(
            f"[PROBE] Delivery DocNum={d.get('DocNum')} Date={d.get('DocDate')} "
            f"Card={d.get('CardName')} Total={d.get('DocTotal')} "
            f"Lines={len(lines)} BaseTypes={base_types} BaseEntries={base_entries[:5]}"
        )


def probe_for_sebastian_sales_so(cfg: dict, session: requests.Session, so_doc_entry: int = 35063) -> None:
    """Busca deliveries que apunten al SO 35063 (SEBASTIAN SALES caso 18364)."""
    url = (
        f"{cfg['url']}/b1s/v1/DeliveryNotes"
        f"?$filter=DocumentLines/any(dl: dl/BaseType eq 17 and dl/BaseEntry eq {so_doc_entry})"
        "&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Cancelled"
    )
    resp = session.get(url, timeout=30)
    if not resp.ok:
        log(f'[WARN] GET filter by SO {so_doc_entry}: HTTP {resp.status_code} - {resp.text[:300]}')
        return
    rows = resp.json().get('value', [])
    log(f'[PROBE][CASO SEBASTIAN SALES] Deliveries que referencian SO {so_doc_entry}: {len(rows)}')
    for r in rows:
        log(f'  -> DocNum={r.get("DocNum")} Date={r.get("DocDate")} Total={r.get("DocTotal")} Card={r.get("CardName")}')


def main() -> None:
    sa = parse_sa_json()
    db = init_firestore(sa)
    cfg = get_sl_config(db)
    session = requests.Session()
    sl_login(cfg, session)

    log('=' * 60)
    log('PROBE 1: count total de DeliveryNotes')
    log('=' * 60)
    count = probe_count(cfg, session)

    log('=' * 60)
    log('PROBE 2: 5 deliveries mas recientes')
    log('=' * 60)
    probe_last_5(cfg, session)

    log('=' * 60)
    log('PROBE 3: caso SEBASTIAN SALES (SO 35063, factura 18364)')
    log('=' * 60)
    probe_for_sebastian_sales_so(cfg, session, 35063)

    log('=' * 60)
    if count < 200:
        log(f'[VEREDICTO] Escenario A: solo {count} deliveries -> remitido = facturado')
    elif count > 2000:
        log(f'[VEREDICTO] Escenario B: {count} deliveries -> hay que traerlas al pipeline')
    else:
        log(f'[VEREDICTO] Escenario intermedio: {count} deliveries -> revisar patron con Diego/Federica')
    log('=' * 60)


if __name__ == '__main__':
    main()
