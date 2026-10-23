"""Prueba si el Service Layer de Shimano expone /SQLQueries para leer
OITM.AvgPrice directamente, lo que permitiria reemplazar la carga
manual del Excel por un job automatico semanal.

Mismo esquema de autenticacion que scripts/test_sl_avg_price_singular.py:
Application Default Credentials (ADC) local para Firestore + BigQuery,
y env var SAP_SL_PASSWORD para el SL. Sin SA key file.

Pasos (frena en el primero que falle):
  1. Login POST /b1s/v1/Login. Mostrar version del Service Layer (header
     'DataServiceVersion' o similar + /b1s/v1/$metadata truncado).
  2. GET /b1s/v1/SQLQueries. Status + cuerpo (truncado). Si 404/403:
     parar y reportar.
  3. POST /b1s/v1/SQLQueries creando AVGPRICE_BQ:
       {"SqlCode":"AVGPRICE_BQ",
        "SqlName":"AvgPrice para BigQuery",
        "SqlText":"SELECT \"ItemCode\", \"AvgPrice\", \"ItmsGrpCod\" FROM OITM WHERE \"AvgPrice\" > 0"}
     Si 409 ("ya existe"), seguir con paso 4.
  4. GET /b1s/v1/SQLQueries('AVGPRICE_BQ')/List (fallback: POST /List
     con ParamList vacio). Paginar con $skip. Contar filas y mostrar 5,
     entre ellas EMFTZ5007428, ESHRX910MCL01S4300S, Y5YC98140.
  5. Comparar los 3 SKUs contra costo_snapshot_semanal
     cost_source='paiva_import_semanal_20261023' (carga de hoy
     2026-10-24). Veredicto: si coinciden al centavo -> fuente
     automatica viable.

NO carga nada en BigQuery. Si el paso 3 funciono, deja la SQLQuery
creada en SAP (es solo un SELECT guardado). Para borrarla:
    DELETE /b1s/v1/SQLQueries('AVGPRICE_BQ')

Uso:
    $env:SAP_SL_PASSWORD = "..."
    python scripts\test_sl_sqlqueries.py
"""
import json
import os
import sys

import requests
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import bigquery


BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
SECRET_RESOURCE = f'projects/{BQ_PROJECT}/secrets/SAP_SL_PASSWORD/versions/latest'

SKUS_TEST = [
    'EMFTZ5007428',
    'ESHRX910MCL01S4300S',
    'Y5YC98140',
]
COST_SOURCE_HOY = 'paiva_import_semanal_20261023'

SQL_PAYLOAD = {
    'SqlCode': 'AVGPRICE_BQ',
    'SqlName': 'AvgPrice para BigQuery',
    'SqlText': 'SELECT "ItemCode", "AvgPrice", "ItmsGrpCod" FROM OITM WHERE "AvgPrice" > 0',
}


def resolve_sl_password() -> str:
    pwd = os.environ.get('SAP_SL_PASSWORD', '').strip()
    if pwd:
        print('[password] desde env var SAP_SL_PASSWORD')
        return pwd
    print('[password] env var vacia; intento Secret Manager via ADC')
    try:
        from google.cloud import secretmanager
    except ImportError:
        print('[FATAL] falta google-cloud-secret-manager y SAP_SL_PASSWORD vacio.',
              file=sys.stderr)
        sys.exit(6)
    try:
        c = secretmanager.SecretManagerServiceClient()
        resp = c.access_secret_version(request={'name': SECRET_RESOURCE})
        return resp.payload.data.decode('utf-8').strip()
    except Exception as e:
        print(f'[FATAL] Secret Manager fallo: {type(e).__name__}: {e}',
              file=sys.stderr)
        sys.exit(7)


def pretty_body(resp: requests.Response, max_chars: int = 1500) -> str:
    try:
        body = resp.json()
        text = json.dumps(body, indent=2, ensure_ascii=False)
    except Exception:
        text = resp.text
    if len(text) > max_chars:
        text = text[:max_chars] + '\n... [truncado]'
    return text


def main():
    # Firestore ADC
    try:
        firebase_admin.initialize_app(
            credentials.ApplicationDefault(),
            {'projectId': BQ_PROJECT},
        )
    except Exception as e:
        print(f'[FATAL] firebase_admin init: {type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(2)
    fs = firestore.client()
    sl = (fs.collection('app_config').document('sap_integration').get()
          .to_dict() or {}).get('serviceLayer', {})
    if not sl.get('companyDB'):
        sl['companyDB'] = sl.get('companyDB') or sl.get('CompanyDB')
    username = sl.get('username') or sl.get('userName') or ''
    url_base = sl.get('url', '').rstrip('/')
    if not (url_base and sl.get('companyDB') and username):
        print(f'[FATAL] serviceLayer config incompleta', file=sys.stderr)
        sys.exit(3)

    pwd = resolve_sl_password()
    session = requests.Session()

    # ========== PASO 1: LOGIN + VERSION ==========
    print()
    print('=' * 60)
    print('PASO 1 — Login + version del Service Layer')
    print('=' * 60)
    print(f'[login] POST {url_base}/b1s/v1/Login')
    r = session.post(f'{url_base}/b1s/v1/Login',
                     json={'CompanyDB': sl['companyDB'], 'UserName': username,
                           'Password': pwd},
                     timeout=30)
    print(f'[login] HTTP {r.status_code}')
    if not r.ok:
        print(f'[login] body: {pretty_body(r)}', file=sys.stderr)
        sys.exit(4)
    # Headers que pueden exponer version
    version_headers = {k: v for k, v in r.headers.items()
                       if any(t in k.lower() for t in ['version', 'data', 'server'])}
    print(f'[login] response headers (filtrados): {json.dumps(dict(version_headers), indent=2)}')
    # Metadata para version
    print(f'\n[version] GET {url_base}/b1s/v1/$metadata (primeros 500 chars)')
    rm = session.get(f'{url_base}/b1s/v1/$metadata', timeout=30)
    print(f'[version] HTTP {rm.status_code}')
    if rm.ok:
        txt = rm.text
        # buscar atributo Version
        import re
        m = re.search(r'Version="([^"]+)"', txt)
        if m:
            print(f'[version] edmx:DataServices Version = {m.group(1)}')
        else:
            print(f'[version] no se encontro atributo Version')
        print(f'[version] metadata snippet:')
        print(txt[:500])
    else:
        print(f'[version] no se pudo obtener metadata, body: {pretty_body(rm)}')

    # ========== PASO 2: GET /SQLQueries ==========
    print()
    print('=' * 60)
    print('PASO 2 — GET /b1s/v1/SQLQueries')
    print('=' * 60)
    r2 = session.get(f'{url_base}/b1s/v1/SQLQueries?$top=5', timeout=30)
    print(f'[sqlqueries-list] HTTP {r2.status_code}')
    print(f'[sqlqueries-list] body:')
    print(pretty_body(r2))
    if r2.status_code in (404, 403):
        print(f'\n[VEREDICTO] /SQLQueries NO habilitado (status {r2.status_code}). '
              f'FUENTE AUTOMATICA NO VIABLE con esta via.', file=sys.stderr)
        _logout(session, url_base)
        sys.exit(10)
    if not r2.ok:
        print(f'[FATAL] GET /SQLQueries fallo con status inesperado', file=sys.stderr)
        _logout(session, url_base)
        sys.exit(11)

    # ========== PASO 3: POST crear AVGPRICE_BQ ==========
    print()
    print('=' * 60)
    print('PASO 3 — POST /b1s/v1/SQLQueries (crear AVGPRICE_BQ)')
    print('=' * 60)
    r3 = session.post(f'{url_base}/b1s/v1/SQLQueries',
                      json=SQL_PAYLOAD, timeout=30)
    print(f'[sqlqueries-create] HTTP {r3.status_code}')
    print(f'[sqlqueries-create] body:')
    print(pretty_body(r3))
    if r3.status_code == 201:
        print('[sqlqueries-create] CREADA OK.')
    elif r3.status_code == 409 or (r3.status_code == 400 and 'exist' in r3.text.lower()):
        print('[sqlqueries-create] YA EXISTE, sigo con paso 4.')
    else:
        print(f'[FATAL] POST /SQLQueries fallo con status {r3.status_code}',
              file=sys.stderr)
        _logout(session, url_base)
        sys.exit(12)

    # ========== PASO 4: ejecutar List con paginacion ==========
    print()
    print('=' * 60)
    print('PASO 4 — Ejecutar SQLQuery AVGPRICE_BQ')
    print('=' * 60)
    total = 0
    all_rows = []
    skip = 0
    page_size = 20  # SL de Shimano cappea en 20 filas por request pese a $top>20.
    endpoint_used = None
    for attempt in range(2000):  # safety guard: max 40.000 rows (2000 * 20)
        # Primera iteracion: probar GET; si falla, probar POST con ParamList vacio.
        if endpoint_used is None or endpoint_used == 'GET':
            url = f"{url_base}/b1s/v1/SQLQueries('AVGPRICE_BQ')/List?$skip={skip}&$top={page_size}"
            if attempt == 0:
                print(f'[list GET] {url}')
            r4 = session.get(url, timeout=60)
            if r4.status_code == 405 or r4.status_code == 404:
                print(f'[list GET] HTTP {r4.status_code} — probando POST /List')
                url_post = f"{url_base}/b1s/v1/SQLQueries('AVGPRICE_BQ')/List?$skip={skip}&$top={page_size}"
                r4 = session.post(url_post, json={'ParamList': ''}, timeout=60)
                endpoint_used = 'POST'
            else:
                endpoint_used = 'GET'
        else:
            url_post = f"{url_base}/b1s/v1/SQLQueries('AVGPRICE_BQ')/List?$skip={skip}&$top={page_size}"
            r4 = session.post(url_post, json={'ParamList': ''}, timeout=60)
        if not r4.ok:
            print(f'[list] body:')
            print(pretty_body(r4))
            print(f'[FATAL] /List fallo con status {r4.status_code}', file=sys.stderr)
            _logout(session, url_base)
            sys.exit(13)
        body = r4.json()
        value = body.get('value', [])
        nextlink = body.get('@odata.nextLink') or body.get('odata.nextLink')
        total += len(value)
        all_rows.extend(value)
        # Log compacto: cada 50 paginas o cuando page devuelve != page_size
        if attempt == 0 or (attempt + 1) % 50 == 0 or len(value) < page_size:
            print(f'[list] page {attempt + 1} (skip={skip}): devolvio {len(value)} filas (acumulado {total})')
        if attempt == 0 and value:
            print(f'[list] primeras 2 filas:')
            print(json.dumps(value[:2], indent=2, ensure_ascii=False))
        if not nextlink and len(value) < page_size:
            break
        skip += page_size

    print(f'\n[list] TOTAL filas: {total}')
    if total == 0:
        print('[FATAL] 0 filas devueltas; algo esta mal con la SQLQuery', file=sys.stderr)
        _logout(session, url_base)
        sys.exit(14)

    # Mostrar 5 filas incluyendo los 3 SKUs del test
    print('\n[list] 5 filas incluyendo SKUs de test (si existen):')
    sl_by_sku = {}
    for row in all_rows:
        code = row.get('ItemCode') or row.get('itemCode') or row.get('item_code')
        if code:
            sl_by_sku[code] = row
    shown = 0
    for sku in SKUS_TEST:
        if sku in sl_by_sku:
            print(f'  {json.dumps(sl_by_sku[sku], ensure_ascii=False)}')
            shown += 1
    # Completar hasta 5 con primeras del total
    for row in all_rows:
        if shown >= 5:
            break
        code = row.get('ItemCode') or row.get('itemCode') or row.get('item_code')
        if code in SKUS_TEST:
            continue
        print(f'  {json.dumps(row, ensure_ascii=False)}')
        shown += 1

    # ========== PASO 5: comparar contra snapshot_semanal_20261023 ==========
    print()
    print('=' * 60)
    print('PASO 5 — Comparar vs costo_snapshot_semanal cost_source=paiva_import_semanal_20261023')
    print('=' * 60)
    bq = bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)
    skus_quoted = ','.join([f"'{s}'" for s in SKUS_TEST])
    q = f'''
    SELECT item_code, cost_avg_ars
    FROM `{BQ_PROJECT}.shimano_app.costo_snapshot_semanal`
    WHERE cost_source = '{COST_SOURCE_HOY}'
      AND item_code IN ({skus_quoted})
    '''
    paiva = {}
    for row in bq.query(q).result():
        paiva[row['item_code']] = float(row['cost_avg_ars'] or 0)
    print(f'[paiva] filas encontradas en BQ: {len(paiva)}')
    print()
    exact_count = 0
    for sku in SKUS_TEST:
        sl_val = None
        if sku in sl_by_sku:
            raw = sl_by_sku[sku].get('AvgPrice') or sl_by_sku[sku].get('avgPrice')
            try:
                sl_val = float(raw) if raw is not None else None
            except Exception:
                sl_val = None
        pv = paiva.get(sku)
        if sl_val is None or pv is None:
            print(f'  {sku}: SL={sl_val}  Paiva_semanal={pv}  (sin comparacion)')
            continue
        diff = sl_val - pv
        exact = abs(diff) < 0.01
        pct = (abs(diff) / pv * 100) if pv else 0
        if exact:
            exact_count += 1
            tag = 'OK EXACTO'
        else:
            tag = f'DIFF ${diff:+,.2f} ({pct:+.4f}%)'
        print(f'  {sku}: SL=${sl_val:,.2f}  Paiva_semanal=${pv:,.2f}  [{tag}]')

    print()
    print('=' * 60)
    print('VEREDICTO')
    print('=' * 60)
    if exact_count == len(SKUS_TEST):
        print(f'  {exact_count}/{len(SKUS_TEST)} SKUs coinciden EXACTO al centavo.')
        print('  FUENTE AUTOMATICA VIABLE: reemplazar carga manual del Excel por job SL.')
    else:
        print(f'  {exact_count}/{len(SKUS_TEST)} SKUs coinciden exacto.')
        print('  Revisar diseno del job (quizas Juan filtra algo diferente, o la')
        print('  consulta OITM.AvgPrice en SAP tiene semantica distinta vs la query')
        print('  de margen de Juan).')

    # DELETE instruction
    print()
    print(f'Para borrar la SQLQuery creada en SAP (si corresponde):')
    print(f"  DELETE {url_base}/b1s/v1/SQLQueries('AVGPRICE_BQ')")
    print('  (Es un SELECT guardado read-only, se puede dejar sin riesgo.)')

    _logout(session, url_base)


def _logout(session, url_base):
    try:
        session.post(f'{url_base}/b1s/v1/Logout', timeout=10)
    except Exception:
        pass


if __name__ == '__main__':
    main()
