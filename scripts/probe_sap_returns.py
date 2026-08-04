"""
One-shot probe: cuantos Returns hay en SAP + volumen en meses recientes.

Returns (RIN1/ORIN en SAP B1, endpoint /b1s/v1/Returns) son la contrapartida
fisica del Delivery Note cuando el cliente devuelve mercaderia. Sin restarlos,
v_remitos_lineas queda inflada por las devoluciones (bug detectado 2026-08-04).

Este probe verifica el volumen antes de agregar el fetch al pipeline.
"""

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


def probe_returns(cfg: dict, session: requests.Session) -> None:
    """Count total + top 10 mas recientes con detalle de importe."""
    url = (
        f"{cfg['url']}/b1s/v1/Returns"
        "?$top=1&$count=true"
        "&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal"
    )
    resp = session.get(
        url,
        timeout=30,
        headers={'Prefer': 'odata.include-annotations="*"'},
    )
    if not resp.ok:
        log(f'[FATAL] GET Returns: HTTP {resp.status_code} - {resp.text[:400]}')
        sys.exit(4)
    body = resp.json()
    count = body.get('@odata.count') or body.get('odata.count')
    log(f'[PROBE] Returns @odata.count total = {count}')
    log(f'[PROBE] Primera row: {body.get("value", [{}])[0]}')

    # Top 10 mas recientes con importe (para ver volumen y fechas).
    url2 = (
        f"{cfg['url']}/b1s/v1/Returns"
        "?$top=10&$orderby=DocEntry desc"
        "&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,Cancelled"
    )
    r2 = session.get(url2, timeout=30)
    if not r2.ok:
        log(f'[WARN] top 10: HTTP {r2.status_code}')
        return
    log('[PROBE] Top 10 Returns mas recientes:')
    for r in r2.json().get('value', []):
        log(
            f"  DocNum={r.get('DocNum')} Date={r.get('DocDate')} "
            f"Total={r.get('DocTotal')} Card={r.get('CardName')} "
            f"Cancelled={r.get('Cancelled')}"
        )

    # Filtrar Returns julio 2026 para estimar impacto en la vista.
    url3 = (
        f"{cfg['url']}/b1s/v1/Returns"
        "?$filter=DocDate ge '2026-07-01' and DocDate le '2026-07-31' and Cancelled eq 'tNO'"
        "&$count=true&$top=1"
        "&$select=DocEntry"
    )
    r3 = session.get(
        url3,
        timeout=30,
        headers={'Prefer': 'odata.include-annotations="*"'},
    )
    if r3.ok:
        cnt_jul = r3.json().get('@odata.count') or r3.json().get('odata.count')
        log(f'[PROBE] Returns julio 2026 (no cancelados): {cnt_jul} docs')


def main() -> None:
    sa = parse_sa_json()
    db = init_firestore(sa)
    cfg = get_sl_config(db)
    session = requests.Session()
    sl_login(cfg, session)

    log('=' * 60)
    log('PROBE: cuantos Returns (devoluciones) hay en SAP')
    log('=' * 60)
    probe_returns(cfg, session)
    log('=' * 60)


if __name__ == '__main__':
    main()
