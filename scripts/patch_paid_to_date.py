"""One-off: agrega paid_to_date a sap_invoices_raw SIN pisar lines_json.

Contexto: el sync grande (sync_sap_to_bigquery.py) usa autodetect=True al
cargar a BQ. Como paid_to_date viene null para la mayoria de facturas
cerradas, autodetect dropea la columna. Este parche la agrega y la
puebla sin tocar el resto del schema.

C9 (contencion): antes TODO corria al importar el modulo y escribia sin
gate. Ahora:
  - DRY-RUN por defecto: lee SAP (solo GET) e imprime las 4 operaciones BQ
    (ALTER, load staging WRITE_TRUNCATE, UPDATE, DROP staging) sin ejecutarlas.
  - APPLY: --project <id> --apply --confirm-project=<id> + cuenta de servicio.
  - Si la paginacion de SAP se corta, aborta antes de tocar BQ.
  - Password del SL: env SAP_SL_PASSWORD (fallback legacy Firestore).

Uso:
    python scripts/patch_paid_to_date.py --project app-vendedores-shimano
Credencial: GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT o
~/Desktop/sa-key.json (en ese orden).

Fix permanente: agregar schema explicito al sync grande. TODO.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import requests

sys.path.insert(0, 'scripts')
from _lib.script_guard import guard, mask_url  # noqa: E402

BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'
HISTORY_DAYS = 365
DEFAULT_SA_FILE = str(Path.home() / 'Desktop' / 'sa-key.json')


def fetch_paid_to_date(sess, url: str, since: str, log=print):
    """Devuelve (rows, complete). complete=False si una pagina fallo."""
    filter_ = f"DocumentStatus eq 'bost_Open' or DocDate ge '{since}'"
    next_url = f'{url}/b1s/v1/Invoices?$select=DocEntry,PaidToDate&$filter={filter_}'
    rows, page = [], 0
    while next_url:
        resp = sess.get(next_url, timeout=60)
        if not resp.ok:
            log(f'[FAIL] pag {page}: {resp.status_code} {mask_url(resp.text[:200])}')
            return rows, False
        body = resp.json()
        for inv in body.get('value', []):
            rows.append({'doc_entry': inv.get('DocEntry'), 'paid_to_date': inv.get('PaidToDate') or 0.0})
        page += 1
        if page % 10 == 0:
            log(f'  pag {page}: {len(rows)} facturas')
        nl = body.get('@odata.nextLink') or body.get('odata.nextLink')
        if not nl:
            break
        if nl.startswith('http'):
            next_url = nl
        elif nl.startswith('/'):
            next_url = f'{url}{nl}'
        else:
            next_url = f'{url}/b1s/v1/{nl}'
    return rows, True


def bq_statements(project: str) -> dict:
    main_t = f'{project}.{BQ_DATASET}.sap_invoices_raw'
    stage_t = f'{project}.{BQ_DATASET}.sap_invoices_paid_stage'
    return {
        'main': main_t,
        'stage': stage_t,
        'alter': f'ALTER TABLE `{main_t}` ADD COLUMN IF NOT EXISTS paid_to_date FLOAT64',
        'update': (f'UPDATE `{main_t}` T\nSET paid_to_date = S.paid_to_date\n'
                   f'FROM `{stage_t}` S\nWHERE T.doc_entry = S.doc_entry'),
        'drop': f'DROP TABLE IF EXISTS `{stage_t}`',
    }


def main(argv=None) -> int:
    t = guard(argv=argv, requires_write=True, sa_file=DEFAULT_SA_FILE)
    if t.rest:
        print(f'[FATAL] argumentos desconocidos: {t.rest}', file=sys.stderr)
        return 2

    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.cloud import bigquery
    from google.oauth2 import service_account

    sa = None
    sa_path = t.credential.source if t.credential.kind == 'service_account' else None
    if sa_path and sa_path.startswith('env:'):
        from _lib.script_guard import decode_sa_json
        sa = json.loads(decode_sa_json(os.environ.get('FIREBASE_SERVICE_ACCOUNT', '')))
    elif sa_path:
        sa = json.loads(Path(sa_path).read_text())
    # APPLY en prod ya exige cuenta de servicio (guard). En DRY-RUN se acepta ADC.
    if not firebase_admin._apps:
        cred = credentials.Certificate(sa) if sa else credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred, {'projectId': t.project})
    fs = firestore.client()
    creds = service_account.Credentials.from_service_account_info(sa) if sa else None
    bq = bigquery.Client(project=t.project, credentials=creds, location=BQ_LOCATION)
    q = bq_statements(t.project)

    snap = fs.collection('app_config').document('sap_integration').get()
    sl = (snap.to_dict() or {}).get('serviceLayer') or {}
    url = (sl.get('url') or '').rstrip('/')
    password = os.environ.get('SAP_SL_PASSWORD') or sl.get('password') or ''
    if not (url and sl.get('companyDB') and sl.get('username') and password):
        print('[FATAL] config SL incompleta (url/companyDB/username/password)', file=sys.stderr)
        return 1
    sess = requests.Session()
    r = sess.post(f'{url}/b1s/v1/Login', json={
        'CompanyDB': sl['companyDB'], 'UserName': sl['username'], 'Password': password,
    }, timeout=30)
    if not r.ok:
        print(f'[FATAL] login: {r.status_code}')
        return 1
    print('[SL] login OK')
    since = (datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)).strftime('%Y-%m-%d')
    try:
        rows, complete = fetch_paid_to_date(sess, url, since)
    finally:
        try:
            sess.post(f'{url}/b1s/v1/Logout', timeout=10)
        except Exception:
            pass
    print(f'[SL] total: {len(rows)} facturas (completo={complete})')
    if not complete:
        print('[FATAL] la lectura de SAP se corto; no toco BQ.', file=sys.stderr)
        return 1
    if not rows:
        print('[warn] sin filas, no toco BQ')
        return 0

    t.write(q['alter'], lambda: bq.query(q['alter']).result())

    def _load():
        schema = [bigquery.SchemaField('doc_entry', 'INT64'), bigquery.SchemaField('paid_to_date', 'FLOAT64')]
        jc = bigquery.LoadJobConfig(
            write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=schema,
        )
        buf = BytesIO()
        for r_ in rows:
            buf.write((json.dumps(r_) + '\n').encode('utf-8'))
        buf.seek(0)
        bq.load_table_from_file(buf, q['stage'], location=BQ_LOCATION, job_config=jc).result()
    t.write(f"load {len(rows)} filas a {q['stage']} (WRITE_TRUNCATE)", _load)

    def _update():
        job = bq.query(q['update'])
        job.result()
        print(f'  OK: {job.num_dml_affected_rows} filas actualizadas')
    t.write(q['update'], _update)
    t.write(q['drop'], lambda: bq.query(q['drop']).result())

    if not t.apply:
        print('[DRY-RUN] no se escribio nada en BigQuery.')
        return 0
    res = list(bq.query(f'''
        SELECT COUNT(*) AS total, COUNTIF(paid_to_date IS NOT NULL) AS n_with_paid,
               COUNTIF(lines_json IS NOT NULL) AS n_with_lines,
               ROUND(SUM(doc_total - COALESCE(paid_to_date, 0)), 0) AS saldo_total
        FROM `{q['main']}` WHERE document_status = 'bost_Open' AND cancelled = 'tNO'
    ''').result())[0]
    print(f'  total open: {res.total} | con paid_to_date: {res.n_with_paid} | '
          f'con lines_json: {res.n_with_lines} | saldo total open: ${res.saldo_total:,.0f}')
    print('DONE')
    return 0


if __name__ == '__main__':
    sys.exit(main())
