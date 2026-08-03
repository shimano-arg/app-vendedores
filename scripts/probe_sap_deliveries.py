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
    """GET /DeliveryNotes?$top=1&$count=true -> count total (OData v4)."""
    # SAP B1 Service Layer usa OData v4 -> $count=true (no $inlinecount=allpages).
    # Requiere header Prefer: odata.include-annotations="*" en algunas versiones.
    url = (
        f"{cfg['url']}/b1s/v1/DeliveryNotes"
        "?$top=1&$count=true"
        "&$select=DocEntry,DocNum,DocDate,CardCode,CardName"
    )
    resp = session.get(url, timeout=30, headers={'Prefer': 'odata.include-annotations="*"'})
    if not resp.ok:
        log(f'[FATAL] GET DeliveryNotes: HTTP {resp.status_code} - {resp.text[:400]}')
        sys.exit(4)
    body = resp.json()
    # SAP B1 SL puede devolver el count como @odata.count o directamente
    # como "count" segun version. Probamos ambos.
    count = body.get('@odata.count')
    if count is None:
        count = body.get('odata.count')
    log(f'[PROBE] @odata.count = {count}')
    log(f'[PROBE] Total keys en response: {list(body.keys())}')
    log(f'[PROBE] Primera row: {json.dumps(body.get("value", [{}])[0], ensure_ascii=False) if body.get("value") else "SIN ROWS"}')
    return int(count) if count is not None else -1


def probe_count_via_pagination(cfg: dict, session: requests.Session) -> int:
    """Fallback: pagina con $top=100 hasta que no queden mas, cuenta manual.

    Corta despues de 60 paginas (6000 docs) para no colgar el workflow si
    hay mucho volumen. Devuelve el count real hasta ese limite; si se
    llego al limite se loguea 'CAP' para indicar que hay mas.
    """
    total = 0
    skip = 0
    top = 100
    max_pages = 60
    for page in range(max_pages):
        url = (
            f"{cfg['url']}/b1s/v1/DeliveryNotes"
            f"?$top={top}&$skip={skip}"
            "&$select=DocEntry"
        )
        resp = session.get(url, timeout=30)
        if not resp.ok:
            log(f'[WARN] pagination page {page}: HTTP {resp.status_code}')
            break
        rows = resp.json().get('value', [])
        total += len(rows)
        if len(rows) < top:
            log(f'[PROBE] pagination TERMINO en pagina {page + 1} - total = {total}')
            return total
        skip += top
    log(f'[PROBE] pagination CAP a {max_pages} paginas - total minimo = {total} (hay mas)')
    return total


def probe_last_5(cfg: dict, session: requests.Session) -> None:
    """Trae las 5 Deliveries mas recientes con lineas resumidas.

    Nota SAP B1 SL: si $select incluye DocumentLines, algunos servers
    devuelven 400. En ese caso hacemos 2 requests: header + expand aparte.
    """
    # Primera version: pedimos headers + expand lines.
    url = (
        f"{cfg['url']}/b1s/v1/DeliveryNotes"
        "?$top=5&$orderby=DocDate desc,DocEntry desc"
        "&$select=DocEntry,DocNum,DocDate,CardCode,CardName,SlpCode,DocTotal,Cancelled"
    )
    resp = session.get(url, timeout=30)
    if not resp.ok:
        log(f'[WARN] GET last 5: HTTP {resp.status_code} - {resp.text[:300]}')
        return
    rows = resp.json().get('value', [])
    log(f'[PROBE] Recibidas {len(rows)} deliveries recientes')
    for d in rows:
        log(
            f"[PROBE] Delivery DocEntry={d.get('DocEntry')} DocNum={d.get('DocNum')} "
            f"Date={d.get('DocDate')} SlpCode={d.get('SlpCode')} "
            f"Card={d.get('CardName')} Total={d.get('DocTotal')} Cancelled={d.get('Cancelled')}"
        )
        # Fetch lines de esta delivery para ver BaseType/BaseEntry.
        de = d.get('DocEntry')
        if de is None:
            continue
        lines_url = (
            f"{cfg['url']}/b1s/v1/DeliveryNotes({de})"
            "?$select=DocumentLines"
        )
        lresp = session.get(lines_url, timeout=30)
        if not lresp.ok:
            log(f'  [WARN] lines DocEntry={de} HTTP {lresp.status_code}')
            continue
        lines = lresp.json().get('DocumentLines', [])
        base_types = sorted({str(ln.get('BaseType')) for ln in lines})
        base_entries = sorted({ln.get('BaseEntry') for ln in lines if ln.get('BaseEntry') is not None})
        log(f'  Lines={len(lines)} BaseTypes={base_types} BaseEntries[:5]={base_entries[:5]}')


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
    log('PROBE 1: count total de DeliveryNotes (via $count=true)')
    log('=' * 60)
    count = probe_count(cfg, session)

    if count < 0:
        log('=' * 60)
        log('PROBE 1b: fallback pagination (SL no soporto $count)')
        log('=' * 60)
        count = probe_count_via_pagination(cfg, session)

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
