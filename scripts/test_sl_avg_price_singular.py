"""Prueba HTTP del campo singular `AvgPrice` sobre Items en SAP Service Layer.

Contexto 2026-10-23: `AvgStdPrice` falla con HTTP 400 (confirmado en
sync_sap_to_bigquery.py linea 2850 comment). No se habia probado el
singular `AvgPrice`. Este script lo prueba sobre 3 ItemCodes
representativos y compara contra la planilla de Juan Paiva (septiembre
2026) para decidir si sirve como fuente del snapshot semanal.

Requiere `~/Desktop/sa-key.json` (patron existente en el repo:
`debug_sl_direct.py` + `apply_credit_notes_fix.py`). El doc Firestore
`app_config/sap_integration.serviceLayer` tiene url/companyDB/username/
password. Luego hace Login a /b1s/v1/Login y 3 GET.

Output:
  - HTTP status + body (truncado) para cada SKU.
  - Si 200: compara AvgPrice vs costo_avg_ars del snapshot Paiva sep 2026
    (BQ: costo_snapshot_semanal where cost_source='paiva_import_sep2026').
  - Veredicto: si al menos 2 de 3 estan dentro del 5% de la planilla
    Paiva, sugiere cambiar la fuente del job semanal a 'oitm_avg_price'.
    Caso contrario, deja la carga manual Paiva como oficial.

Uso:
    python scripts/test_sl_avg_price_singular.py
"""
import json
import os
import sys
from pathlib import Path

import requests
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import bigquery
from google.oauth2 import service_account


SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'

SKUS_TEST = [
    'EMFTZ5007428',
    'ESHRX910MCL01S4300S',
    'Y5YC98140',
]

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'


def main():
    if not SA_KEY_PATH.exists():
        print(f'[FATAL] falta {SA_KEY_PATH}. Esta es la SA key que usan los '
              f'scripts del repo (patron en debug_sl_direct.py). '
              f'Ponela ahi y volve a correr.', file=sys.stderr)
        sys.exit(2)

    sa = json.loads(SA_KEY_PATH.read_text())

    # Firestore Admin para leer serviceLayer config.
    firebase_admin.initialize_app(credentials.Certificate(sa))
    fs = firestore.client()
    sl = (fs.collection('app_config').document('sap_integration').get()
          .to_dict() or {}).get('serviceLayer', {})
    for k in ('url', 'companyDB', 'password'):
        if not sl.get(k):
            # Fallbacks que ya conoce el repo (ver reglas CLAUDE.md 24).
            if k == 'companyDB':
                sl[k] = sl.get('companyDB') or sl.get('CompanyDB')
            else:
                print(f'[FATAL] serviceLayer falta campo {k}', file=sys.stderr)
                sys.exit(3)
    username = sl.get('username') or sl.get('userName') or ''
    if not username:
        print(f'[FATAL] serviceLayer no tiene username ni userName', file=sys.stderr)
        sys.exit(4)

    url_base = sl['url'].rstrip('/')
    session = requests.Session()
    print(f'[login] POST {url_base}/b1s/v1/Login')
    r = session.post(
        f'{url_base}/b1s/v1/Login',
        json={'CompanyDB': sl['companyDB'], 'UserName': username,
              'Password': sl['password']},
        timeout=30,
    )
    print(f'[login] HTTP {r.status_code}')
    if not r.ok:
        print(f'[login] body: {r.text[:500]}', file=sys.stderr)
        sys.exit(5)

    # Prueba el campo singular `AvgPrice`.
    print()
    print('=' * 60)
    print('PRUEBA AvgPrice (singular) via /b1s/v1/Items')
    print('=' * 60)
    results = {}
    for sku in SKUS_TEST:
        q = f"{url_base}/b1s/v1/Items('{sku}')?$select=ItemCode,AvgPrice"
        print(f'\n[test] GET {q}')
        resp = session.get(q, timeout=30)
        print(f'[test] HTTP {resp.status_code}')
        if resp.ok:
            body = resp.json()
            print(f'[test] body: {json.dumps(body, indent=2)[:500]}')
            results[sku] = {
                'ok': True,
                'status': resp.status_code,
                'AvgPrice': body.get('AvgPrice'),
                'ItemCode': body.get('ItemCode'),
                'body_keys': list(body.keys()),
            }
        else:
            # Mostrar error completo (sin truncar) para diagnosticar.
            print(f'[test] body: {resp.text[:1500]}')
            results[sku] = {
                'ok': False,
                'status': resp.status_code,
                'body': resp.text[:1500],
            }

    # Si al menos uno respondio 200, comparar contra Paiva snapshot.
    some_ok = any(v['ok'] for v in results.values())
    if some_ok:
        print()
        print('=' * 60)
        print('COMPARACION contra planilla Paiva (snapshot sep 2026)')
        print('=' * 60)
        creds_bq = service_account.Credentials.from_service_account_info(sa)
        bq = bigquery.Client(project=BQ_PROJECT, credentials=creds_bq,
                             location=BQ_LOCATION)
        skus_quoted = ','.join([f"'{s}'" for s in SKUS_TEST])
        q = f'''
        SELECT item_code, cost_avg_ars
        FROM `{BQ_PROJECT}.shimano_app.costo_snapshot_semanal`
        WHERE snapshot_week_start = DATE('2026-10-05')
          AND cost_source = 'paiva_import_sep2026'
          AND item_code IN ({skus_quoted})
        '''
        paiva = {r['item_code']: float(r['cost_avg_ars'] or 0)
                 for r in bq.query(q).result()}
        print(f'[paiva] filas: {len(paiva)}')
        close_count = 0
        for sku in SKUS_TEST:
            sl_val = results[sku].get('AvgPrice')
            pv_val = paiva.get(sku)
            if sl_val is None or pv_val is None:
                print(f'  {sku}: SL={sl_val} Paiva={pv_val}  (sin comparacion)')
                continue
            try:
                sl_f = float(sl_val)
            except Exception:
                print(f'  {sku}: SL (no parseable)={sl_val}')
                continue
            diff = sl_f - pv_val
            pct = (abs(diff) / pv_val * 100) if pv_val else None
            tag = 'OK' if (pct is not None and pct <= 5) else '!!'
            if tag == 'OK':
                close_count += 1
            print(f'  [{tag}] {sku}: SL AvgPrice={sl_f:,.2f}  '
                  f'Paiva={pv_val:,.2f}  diff={diff:+,.2f}  '
                  f'diff%={pct:+.2f}%' if pct is not None else
                  f'  [{tag}] {sku}: SL AvgPrice={sl_f:,.2f}  Paiva={pv_val:,.2f}  diff={diff:+,.2f}')

        print()
        if close_count >= 2:
            print(f'[VEREDICTO] {close_count}/{len(SKUS_TEST)} dentro del 5%. '
                  f'SUGERENCIA: cambiar fuente del job semanal a oitm_avg_price '
                  f'(agregar AvgPrice a $select de Items en '
                  f'sync_sap_to_bigquery.py, y job snapshot inserta con '
                  f'cost_source="oitm_avg_price_weekly").')
            print('Antes del cambio: validar sobre muestra MAS GRANDE '
                  '(>= 100 SKUs) y confirmar con Juan Paiva.')
        else:
            print(f'[VEREDICTO] {close_count}/{len(SKUS_TEST)} dentro del 5%. '
                  f'SL.AvgPrice NO reproduce Paiva. Dejar la carga MANUAL '
                  f'desde planilla Juan como mecanismo oficial.')
    else:
        print()
        print('=' * 60)
        print('VEREDICTO')
        print('=' * 60)
        statuses = {v['status'] for v in results.values()}
        print(f'  AvgPrice singular fallo en {len(SKUS_TEST)}/{len(SKUS_TEST)} '
              f'(statuses: {sorted(statuses)}).')
        print('  SL de Shimano NO expone AvgPrice ni singular ni Std. '
              'DEJAMOS la carga manual Paiva como mecanismo oficial.')

    # Logout cortesia (no critico).
    try:
        session.post(f'{url_base}/b1s/v1/Logout', timeout=10)
    except Exception:
        pass


if __name__ == '__main__':
    main()
