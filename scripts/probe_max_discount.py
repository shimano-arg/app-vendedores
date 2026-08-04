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

    # 1. Traer todos los SalesPersons con TODAS las propiedades
    url = f"{cfg['url']}/b1s/v1/SalesPersons?$top=10"
    resp = session.get(url, timeout=30)
    log(f'Status GET SalesPersons: {resp.status_code}')
    if resp.ok:
        body = resp.json()
        log(f'Total SalesPersons: {len(body.get("value", []))}')
        # Solo primeros 3 para ver structura
        for sp in body.get('value', [])[:3]:
            log('---')
            for k, v in sp.items():
                if v not in (None, '', 0) and 'odata' not in k.lower():
                    log(f'  {k}: {v}')
    else:
        log(f'Error: {resp.text[:500]}')

    # 2. Ver Users (donde suele estar el MaxDiscount)
    log('\n=== Usuarios SAP ===')
    url2 = f"{cfg['url']}/b1s/v1/Users?$top=5"
    r2 = session.get(url2, timeout=30)
    log(f'Status GET Users: {r2.status_code}')
    if r2.ok:
        for u in r2.json().get('value', [])[:3]:
            log('---')
            for k, v in u.items():
                if v not in (None, '', 0) and 'odata' not in k.lower():
                    log(f'  {k}: {v}')


if __name__ == '__main__':
    main()
