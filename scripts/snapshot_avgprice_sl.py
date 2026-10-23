"""Job semanal: snapshot de OITM.AvgPrice via Service Layer -> costo_snapshot_semanal.

Corre cada lunes (ver .github/workflows/snapshot-avgprice-sl.yml). Reemplaza el
flujo manual del Excel que usaba scripts/load_paiva_semanal.py:
    - Autentica en el SL (mismo pattern que test_sl_sqlqueries.py).
    - Ejecuta la SQLQuery guardada 'AVGPRICE_BQ' con Prefer odata.maxpagesize=1000.
    - Idempotente: DELETE solo las filas de la semana con cost_source LIKE
      'oitm_avg_price_sl%' (no toca otras fuentes), despues INSERT.
    - cost_source = 'oitm_avg_price_sl_<yyyymmdd>' (yyyymmdd = --fecha, no el
      lunes; permite auditar cuando corrio cada semana).

Convivencia con v_rentabilidad_bike:
    * Ampliado el CTE latest_paiva_import -> latest_snapshot que acepta
      cost_source LIKE 'paiva_import%' OR 'oitm_avg_price%' (PR del job).
    * Dedup CTE por (item_code, snapshot_week_start) con ROW_NUMBER por prioridad:
        1. paiva_import_<mes><año>  (cierre oficial Juan Paiva, historico)
        2. oitm_avg_price_sl        (job automatico, prioridad para la semana)
        3. paiva_import_semanal     (carga manual legacy, respaldo)

Guards (abortan sin cargar):
    * < 3.000 filas devueltas por SL.
    * ItemCode duplicados en la respuesta.

Si la SQLQuery 'AVGPRICE_BQ' no existe en SAP, el script la crea con el
payload documentado en INFORME_sl_sqlqueries.md paso 3.

Autenticacion:
    * Firestore + BigQuery: ADC (local) o FIREBASE_SERVICE_ACCOUNT env var
      (GH Actions).
    * SAP SL password: env var SAP_SL_PASSWORD (preferido en GH Actions) o
      Secret Manager via ADC (local).

Uso:
    python scripts/snapshot_avgprice_sl.py --dry-run                   # inspeccion
    python scripts/snapshot_avgprice_sl.py --fecha 2026-10-23 --dry-run
    python scripts/snapshot_avgprice_sl.py --fecha 2026-10-23          # real
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import bigquery


BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
TABLE = f'{BQ_PROJECT}.shimano_app.costo_snapshot_semanal'

SQL_CODE = 'AVGPRICE_BQ'
SQL_PAYLOAD = {
    'SqlCode': SQL_CODE,
    'SqlName': 'AvgPrice para BigQuery',
    'SqlText': 'SELECT "ItemCode", "AvgPrice", "ItmsGrpCod" FROM OITM WHERE "AvgPrice" > 0',
}
PREFER_PAGE_SIZE = 1000
FALLBACK_PAGE_SIZE = 20
MIN_FILAS_VALIDAS = 3000


def init_firebase_admin():
    """Inicializa firebase_admin con FIREBASE_SERVICE_ACCOUNT env var (GH Actions)
    o ADC local (gcloud auth application-default login)."""
    if firebase_admin._apps:
        return
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if sa_json:
        if not sa_json.startswith('{'):
            import base64
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        sa_data = json.loads(sa_json)
        firebase_admin.initialize_app(credentials.Certificate(sa_data),
                                      {'projectId': BQ_PROJECT})
        print('[init] firebase_admin via FIREBASE_SERVICE_ACCOUNT env var')
    else:
        firebase_admin.initialize_app(credentials.ApplicationDefault(),
                                      {'projectId': BQ_PROJECT})
        print('[init] firebase_admin via ADC local')


def init_bq() -> bigquery.Client:
    """BigQuery client. Si hay FIREBASE_SERVICE_ACCOUNT, usarlo; sino ADC."""
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if sa_json:
        from google.oauth2 import service_account
        if not sa_json.startswith('{'):
            import base64
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        sa_data = json.loads(sa_json)
        creds = service_account.Credentials.from_service_account_info(sa_data)
        return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)
    return bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)


def resolve_sl_password() -> str:
    """env var SAP_SL_PASSWORD (preferido) -> Secret Manager via ADC -> error."""
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
        resp = c.access_secret_version(request={
            'name': f'projects/{BQ_PROJECT}/secrets/SAP_SL_PASSWORD/versions/latest',
        })
        return resp.payload.data.decode('utf-8').strip()
    except Exception as e:
        print(f'[FATAL] Secret Manager fallo: {type(e).__name__}: {e}',
              file=sys.stderr)
        sys.exit(7)


def lunes_art_de_la_semana(d: date) -> date:
    """Lunes de la semana ISO de la fecha dada (si d es lunes, devuelve d)."""
    return d - timedelta(days=d.weekday())


def sl_login(session: requests.Session, url_base: str, company_db: str,
             username: str, pwd: str) -> None:
    r = session.post(f'{url_base}/b1s/v1/Login',
                     json={'CompanyDB': company_db, 'UserName': username, 'Password': pwd},
                     timeout=30)
    r.raise_for_status()
    print(f'[login] HTTP {r.status_code}')


def sl_logout(session: requests.Session, url_base: str) -> None:
    try:
        session.post(f'{url_base}/b1s/v1/Logout', timeout=10)
        print('[logout] OK')
    except Exception as e:
        print(f'[logout] fallo (no critico): {e}')


def ensure_sqlquery_exists(session: requests.Session, url_base: str) -> None:
    """GET /SQLQueries('AVGPRICE_BQ'); si 404, crearla."""
    url = f"{url_base}/b1s/v1/SQLQueries('{SQL_CODE}')"
    r = session.get(url, timeout=30)
    if r.ok:
        print(f'[sqlquery] {SQL_CODE} YA EXISTE en SAP')
        return
    if r.status_code != 404:
        print(f'[FATAL] GET /SQLQueries(X) devolvio {r.status_code}: {r.text[:500]}',
              file=sys.stderr)
        sys.exit(10)
    print(f'[sqlquery] {SQL_CODE} no existe; creando...')
    rc = session.post(f'{url_base}/b1s/v1/SQLQueries', json=SQL_PAYLOAD, timeout=30)
    if rc.status_code != 201:
        print(f'[FATAL] POST /SQLQueries fallo con {rc.status_code}: {rc.text[:500]}',
              file=sys.stderr)
        sys.exit(11)
    print(f'[sqlquery] creada OK')


def fetch_avgprice_rows(session: requests.Session, url_base: str) -> list[dict]:
    """GET /SQLQueries('AVGPRICE_BQ')/List con Prefer odata.maxpagesize=1000.
    Si el SL no respeta el prefer (Preference-Applied ausente o distinto),
    cae a paginar de a 20."""
    page_size = PREFER_PAGE_SIZE
    all_rows: list[dict] = []
    skip = 0
    headers = {'Prefer': f'odata.maxpagesize={PREFER_PAGE_SIZE}'}
    pref_applied_checked = False
    while True:
        url = f"{url_base}/b1s/v1/SQLQueries('{SQL_CODE}')/List?$skip={skip}&$top={page_size}"
        r = session.get(url, headers=headers, timeout=120)
        r.raise_for_status()
        body = r.json()
        value = body.get('value', [])
        # Chequear Preference-Applied en la 1era respuesta.
        if not pref_applied_checked:
            applied = r.headers.get('Preference-Applied', '')
            if f'odata.maxpagesize={PREFER_PAGE_SIZE}' not in applied:
                print(f'[WARN] SL no respeto Prefer odata.maxpagesize={PREFER_PAGE_SIZE}; '
                      f'cae a page_size={FALLBACK_PAGE_SIZE}. header: {applied!r}')
                page_size = FALLBACK_PAGE_SIZE
            else:
                print(f'[list] Preference-Applied: {applied}')
            pref_applied_checked = True
        all_rows.extend(value)
        print(f'[list] skip={skip}: devolvio {len(value)} filas (acumulado {len(all_rows)})')
        if not value or len(value) < page_size:
            break
        skip += len(value)  # avanzar por el valor efectivamente devuelto
    return all_rows


def validate(rows: list[dict]) -> dict:
    con_precio = [r for r in rows if (r.get('AvgPrice') or 0) > 0]
    if len(con_precio) < MIN_FILAS_VALIDAS:
        print(f'[FATAL] solo {len(con_precio)} filas con AvgPrice > 0 '
              f'(minimo {MIN_FILAS_VALIDAS}). Abortando sin cargar.',
              file=sys.stderr)
        sys.exit(13)
    seen: dict[str, float] = {}
    dupes: list[tuple[str, float, float]] = []
    for r in con_precio:
        code = r.get('ItemCode')
        price = float(r.get('AvgPrice') or 0)
        if code in seen and abs(seen[code] - price) > 0.01:
            dupes.append((code, seen[code], price))
        seen[code] = price
    if dupes:
        print(f'[FATAL] ItemCode duplicados en SL con precios distintos '
              f'({len(dupes)} casos). Primeros 5:', file=sys.stderr)
        for code, p1, p2 in dupes[:5]:
            print(f'    {code}: {p1} vs {p2}', file=sys.stderr)
        sys.exit(14)
    return {
        'total': len(rows),
        'con_precio': len(con_precio),
        'unicos': len(seen),
    }


def build_sql(rows: list[dict], week_start: date, cost_source: str) -> list[str]:
    """DELETE idempotente limitado a oitm_avg_price_sl% + INSERT batch."""
    sql_delete = (
        f"DELETE FROM `{TABLE}` "
        f"WHERE snapshot_week_start = DATE('{week_start.isoformat()}') "
        f"AND cost_source LIKE 'oitm_avg_price_sl%';"
    )
    structs = []
    for r in rows:
        price = float(r.get('AvgPrice') or 0)
        if price <= 0:
            continue
        code = str(r.get('ItemCode') or '').replace("'", "''")
        structs.append(f"STRUCT('{code}' AS item_code, {price} AS cost_avg_ars)")
    values_sql = ', '.join(structs)
    sql_insert = f"""
INSERT INTO `{TABLE}`
  (snapshot_week_start, snapshot_at, item_code, cost_avg_ars, cost_source)
SELECT
  DATE('{week_start.isoformat()}'),
  CURRENT_TIMESTAMP(),
  t.item_code,
  t.cost_avg_ars,
  '{cost_source}'
FROM UNNEST([{values_sql}]) AS t;
""".strip()
    return [sql_delete, sql_insert]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fecha', help='Fecha ISO (YYYY-MM-DD). Default: hoy ART.')
    ap.add_argument('--dry-run', action='store_true',
                    help='No ejecuta BQ; imprime SQL + conteos.')
    args = ap.parse_args()

    # Fecha ART (por defecto). En GH Actions UTC, forzar ART via tz.
    if args.fecha:
        try:
            fecha = date.fromisoformat(args.fecha)
        except ValueError:
            print(f'[FATAL] --fecha invalida: {args.fecha}', file=sys.stderr)
            sys.exit(1)
    else:
        # ART = UTC-3 fijo (Argentina no observa DST desde 2009).
        now_art = datetime.now(timezone(timedelta(hours=-3)))
        fecha = now_art.date()

    week_start = lunes_art_de_la_semana(fecha)
    yyyymmdd = fecha.strftime('%Y%m%d')
    cost_source = f'oitm_avg_price_sl_{yyyymmdd}'

    print(f'[input]  fecha         = {fecha.isoformat()}')
    print(f'[calc]   week_start    = {week_start.isoformat()}  (lunes de la semana ART)')
    print(f'[calc]   cost_source   = {cost_source}')
    print()

    # Firestore -> SL config.
    init_firebase_admin()
    fs = firestore.client()
    sl = (fs.collection('app_config').document('sap_integration').get()
          .to_dict() or {}).get('serviceLayer', {})
    url_base = sl.get('url', '').rstrip('/')
    company_db = sl.get('companyDB') or sl.get('CompanyDB') or ''
    username = sl.get('username') or sl.get('userName') or ''
    if not (url_base and company_db and username):
        print(f'[FATAL] serviceLayer config incompleta', file=sys.stderr)
        sys.exit(3)
    pwd = resolve_sl_password()

    session = requests.Session()
    try:
        # Login.
        sl_login(session, url_base, company_db, username, pwd)
        # Asegurar SQLQuery.
        ensure_sqlquery_exists(session, url_base)
        # Fetch filas.
        rows = fetch_avgprice_rows(session, url_base)
        print()
        print(f'[fetch] TOTAL filas SL: {len(rows)}')
        # Validar.
        stats = validate(rows)
        print(f'[check] con AvgPrice > 0: {stats["con_precio"]}')
        print(f'[check] items unicos:     {stats["unicos"]}')
        # Build SQL.
        stmts = build_sql(rows, week_start, cost_source)
        if args.dry_run:
            print()
            print('[DRY_RUN] NO ejecuta BQ. SQL que se ejecutaria:')
            print()
            print('--- DELETE ---')
            print(stmts[0])
            print()
            print('--- INSERT (primeros 500 chars) ---')
            print(stmts[1][:500] + ('...[truncado]...' if len(stmts[1]) > 500 else ''))
            return
        # Carga real.
        print()
        print(f'[exec] target = {TABLE}')
        c = init_bq()
        full_sql = stmts[0] + '\n' + stmts[1]
        job = c.query(full_sql)
        job.result()
        print(f'[exec] OK bytes_processed={job.total_bytes_processed or 0:,}')
        # Verif post.
        q = f"""
        SELECT COUNT(*) AS n, COUNT(DISTINCT item_code) AS items,
          ROUND(AVG(cost_avg_ars), 2) AS avg,
          ROUND(MIN(cost_avg_ars), 2) AS mn,
          ROUND(MAX(cost_avg_ars), 2) AS mx
        FROM `{TABLE}`
        WHERE snapshot_week_start = DATE('{week_start.isoformat()}')
          AND cost_source = '{cost_source}'
        """
        rp = list(c.query(q).result())[0]
        print(f'[check] post rows = {rp.n}  items_unique = {rp["items"]}  '
              f'avg = {rp.avg}  min = {rp.mn}  max = {rp.mx}')
    finally:
        sl_logout(session, url_base)


if __name__ == '__main__':
    main()
