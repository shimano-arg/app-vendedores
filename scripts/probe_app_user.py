"""Ver MaxDiscount especifico del user APP_VENDEDORES que usa la app."""
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

    # Buscar el user APP_VENDEDORES
    url = f"{cfg['url']}/b1s/v1/Users?$filter=UserCode eq 'APP_VENDEDORES'"
    resp = session.get(url, timeout=30)
    log(f'Status: {resp.status_code}')
    if resp.ok:
        body = resp.json()
        for u in body.get('value', []):
            log('=== USER APP_VENDEDORES ===')
            for k, v in u.items():
                if v not in (None, '', 0) and 'odata' not in k.lower() and k != 'UserPermission':
                    log(f'  {k}: {v}')
    else:
        log(f'Error: {resp.text[:400]}')

    # Adicional: probar POST con DiscountPercent = 0, 1, 2, 3 para acotar el cap
    # PERO solo si el user tuvo autorizacion previa (skip aqui)
    log('\n(Skip POST tests - modo read-only)')


if __name__ == '__main__':
    main()
