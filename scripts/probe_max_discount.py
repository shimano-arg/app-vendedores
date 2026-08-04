"""GET /b1s/v1/SalesPersons -> ver MaxDiscount configurado por SlpCode."""
import json, sys
import requests

sys.path.insert(0, 'scripts')
from sync_sap_to_bigquery import get_sl_config, init_firestore, log, parse_sa_json, sl_login  # noqa: E402


def main():
    sa = parse_sa_json()
    db = init_firestore(sa)
    cfg = get_sl_config(db)
    session = requests.Session()
    sl_login(cfg, session)

    # Traer todos los SalesPersons con campo MaxDiscount
    url = f"{cfg['url']}/b1s/v1/SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName,Active,MaxDiscountPercent,U_*"
    resp = session.get(url, timeout=30)
    log(f'Status: {resp.status_code}')
    if resp.ok:
        body = resp.json()
        log(f'Total SalesPersons: {len(body.get("value", []))}')
        log(f'Response body:')
        log(json.dumps(body, indent=2, ensure_ascii=False))
    else:
        log(f'Error: {resp.text[:500]}')


if __name__ == '__main__':
    main()
