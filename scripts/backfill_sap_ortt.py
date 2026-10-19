"""
Sync de la tabla ORTT (tipos de cambio diarios) desde SAP B1 Service Layer
a BigQuery como `sap_tipo_cambio_raw`.

Spec (pedido Mariano 2026-10-19 cierre Fase 2 Bike):
  grano: 1 fila por (fecha, moneda)
  columnas: fecha DATE, moneda STRING, tasa NUMERIC, _sync_timestamp TIMESTAMP
  rango: desde START_DATE (default 2024-01-01)
  monedas: todas las que haya cargadas en ORTT
  huecos: ORTT no tiene fila para fines de semana/feriados — no rellenar.
          El arrastre de ultima cotizacion conocida es decision DAX en PBI.

Endpoints probados (en orden):
  1. /b1s/v1/sml.svc/ORTT                      — vista semantica (preferida)
  2. /b1s/v1/sml.svc/CurrencyRates             — fallback alterno
  3. SQLQueries (requiere setup previo en SAP, no implementado)

IDEMPOTENCIA (v2 2026-10-19):
  Usa MERGE sobre la tabla destino. Jamas trunca.
  - Fila nueva (fecha, moneda) → INSERT
  - Fila existente → UPDATE tasa + _sync_timestamp
  - Fila que ya existia y NO viene en esta corrida → NO SE TOCA
  Resultado: imposible perder historia aunque start_date sea reciente.

Uso:
  python scripts/backfill_sap_ortt.py                       # desde 2024-01-01
  python scripts/backfill_sap_ortt.py --dry-run             # solo loguea
  python scripts/backfill_sap_ortt.py --start-date=2026-01-01  # ventana corta
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone

import requests

sys.path.insert(0, 'scripts')
from sync_sap_to_bigquery import (  # noqa: E402
    BQ_DATASET,
    BQ_PROJECT,
    get_sl_config,
    init_bigquery,
    init_firestore,
    log,
    parse_sa_json,
    sl_login,
)

try:
    from google.cloud import bigquery
except ImportError:
    print('ERROR: pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(1)

BQ_TABLE_TIPO_CAMBIO = f'{BQ_PROJECT}.{BQ_DATASET}.sap_tipo_cambio_raw'
BQ_TABLE_TIPO_CAMBIO_STAGING = f'{BQ_PROJECT}.{BQ_DATASET}._tmp_sap_tipo_cambio_staging'
START_DATE_DEFAULT = '2024-01-01'


# ----- Fetch SL -----

def probe_endpoint(cfg: dict, session: requests.Session, path: str) -> bool:
    """Devuelve True si el endpoint responde 2xx con 'value' array."""
    url = f"{cfg['url']}{path}?$top=1"
    try:
        resp = session.get(url, timeout=30)
    except requests.RequestException as e:
        log(f'[PROBE {path}] error de red: {e}')
        return False
    if not resp.ok:
        log(f'[PROBE {path}] HTTP {resp.status_code}: {resp.text[:200]}')
        return False
    try:
        body = resp.json()
    except ValueError:
        log(f'[PROBE {path}] respuesta no es JSON')
        return False
    rows = body.get('value', [])
    log(f'[PROBE {path}] OK — devolvio {len(rows)} rows.')
    if rows:
        log(f'[PROBE {path}] columnas sample: {sorted(rows[0].keys())}')
    return True


def pick_endpoint(cfg: dict, session: requests.Session) -> str:
    """Prueba endpoints en orden hasta encontrar uno que responda."""
    candidates = [
        '/b1s/v1/sml.svc/ORTT',
        '/b1s/v1/sml.svc/CurrencyRates',
        '/b1s/v1/CurrencyRates',
    ]
    for path in candidates:
        if probe_endpoint(cfg, session, path):
            return path
    log('[FATAL] Ningun endpoint de ORTT responde.')
    log('        Candidatos probados: ' + ', '.join(candidates))
    sys.exit(4)


def fetch_ortt(cfg: dict, session: requests.Session, path: str, start_date: str) -> list:
    """Pagina el endpoint elegido con $filter=RateDate ge start_date."""
    rows_all = []
    filter_expr = f"RateDate ge {start_date}T00:00:00Z"
    select = 'RateDate,Currency,Rate'
    orderby = 'RateDate asc,Currency asc'
    url = (
        f"{cfg['url']}{path}"
        f"?$filter={filter_expr}"
        f"&$select={select}"
        f"&$orderby={orderby}"
    )
    page = 0
    headers = {'Prefer': 'odata.maxpagesize=1000'}
    while url:
        try:
            resp = session.get(url, timeout=60, headers=headers)
        except requests.RequestException as e:
            log(f'[ORTT] red error pag {page}: {e}. Retry en 3s.')
            time.sleep(3)
            resp = session.get(url, timeout=60, headers=headers)
        if resp.status_code == 401:
            log('[ORTT] 401, re-login + retry')
            sl_login(cfg, session)
            resp = session.get(url, timeout=60, headers=headers)
        if not resp.ok:
            log(f'[FATAL] HTTP {resp.status_code}: {resp.text[:500]}')
            sys.exit(4)
        body = resp.json()
        value = body.get('value', [])
        rows_all.extend(value)
        page += 1
        log(f'[ORTT] pag {page}: +{len(value)} rows (acum {len(rows_all)})')
        next_link = body.get('@odata.nextLink') or body.get('odata.nextLink')
        if not next_link:
            break
        url = next_link if next_link.startswith('http') else f"{cfg['url']}/{next_link.lstrip('/')}"
    return rows_all


def normalize_row(raw: dict, sync_ts: str) -> dict:
    """ORTT raw -> schema sap_tipo_cambio_raw."""
    rate_date = raw.get('RateDate') or raw.get('rateDate') or ''
    if rate_date and 'T' in rate_date:
        rate_date = rate_date.split('T', 1)[0]
    currency = (raw.get('Currency') or raw.get('currency') or '').strip()
    rate_raw = raw.get('Rate') if 'Rate' in raw else raw.get('rate')
    try:
        rate = float(rate_raw) if rate_raw is not None else None
    except (TypeError, ValueError):
        rate = None
    return {
        'fecha': rate_date,
        'moneda': currency,
        'tasa': rate,
        '_sync_timestamp': sync_ts,
    }


# ----- BQ load (idempotente via MERGE) -----

TABLE_SCHEMA = [
    bigquery.SchemaField('fecha', 'DATE', mode='REQUIRED'),
    bigquery.SchemaField('moneda', 'STRING', mode='REQUIRED'),
    bigquery.SchemaField('tasa', 'NUMERIC', mode='NULLABLE'),
    bigquery.SchemaField('_sync_timestamp', 'TIMESTAMP', mode='REQUIRED'),
]


def ensure_table_exists(bq_client: bigquery.Client) -> None:
    """Crea sap_tipo_cambio_raw con el schema si no existe."""
    try:
        bq_client.get_table(BQ_TABLE_TIPO_CAMBIO)
        log(f'[BQ] tabla {BQ_TABLE_TIPO_CAMBIO} ya existe')
    except Exception:
        log(f'[BQ] creando tabla {BQ_TABLE_TIPO_CAMBIO}')
        table = bigquery.Table(BQ_TABLE_TIPO_CAMBIO, schema=TABLE_SCHEMA)
        bq_client.create_table(table)
        log(f'[BQ] tabla creada')


def merge_rows(bq_client: bigquery.Client, rows: list) -> dict:
    """
    Carga rows al staging y hace MERGE a la tabla destino.
    Devuelve dict con contadores: inserted, updated, unchanged.
    """
    if not rows:
        log('[WARN] 0 rows para mergear. Abortando sin tocar la tabla.')
        return {'inserted': 0, 'updated': 0}

    # 1. Load a staging con WRITE_TRUNCATE (siempre tabla temporal fresca).
    staging_cfg = bigquery.LoadJobConfig(
        schema=TABLE_SCHEMA,
        write_disposition='WRITE_TRUNCATE',
    )
    log(f'[BQ] load_from_json a staging {BQ_TABLE_TIPO_CAMBIO_STAGING}, {len(rows)} rows')
    job = bq_client.load_table_from_json(rows, BQ_TABLE_TIPO_CAMBIO_STAGING, job_config=staging_cfg)
    job.result()

    # 2. MERGE.
    merge_sql = f'''
    MERGE INTO `{BQ_TABLE_TIPO_CAMBIO}` T
    USING `{BQ_TABLE_TIPO_CAMBIO_STAGING}` S
    ON T.fecha = S.fecha AND T.moneda = S.moneda
    WHEN MATCHED AND (T.tasa != S.tasa OR T.tasa IS NULL) THEN
      UPDATE SET tasa = S.tasa, _sync_timestamp = S._sync_timestamp
    WHEN NOT MATCHED THEN
      INSERT (fecha, moneda, tasa, _sync_timestamp)
      VALUES (S.fecha, S.moneda, S.tasa, S._sync_timestamp)
    '''
    log(f'[BQ] MERGE sap_tipo_cambio_raw <- staging')
    merge_job = bq_client.query(merge_sql)
    merge_job.result()
    stats = merge_job.num_dml_affected_rows or 0
    log(f'[BQ] MERGE OK — {stats} filas afectadas (INSERT + UPDATE)')

    # 3. Drop staging.
    try:
        bq_client.delete_table(BQ_TABLE_TIPO_CAMBIO_STAGING)
        log(f'[BQ] staging table drop OK')
    except Exception as e:
        log(f'[BQ] WARN: no pude borrar staging ({e}), ignorando')

    return {'affected': stats}


def write_to_bq(bq_client: bigquery.Client, rows: list, dry_run: bool = False) -> None:
    if dry_run:
        log(f'[DRY RUN] {len(rows)} rows preparadas (no se escriben).')
        if rows:
            log(f'[DRY RUN] Muestra: {rows[:3]}')
        return
    if not rows:
        log('[WARN] 0 rows. Nada que hacer.')
        return
    ensure_table_exists(bq_client)
    merge_rows(bq_client, rows)


# ----- Main -----

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='No escribe a BQ')
    parser.add_argument('--start-date', default=START_DATE_DEFAULT, help='YYYY-MM-DD (default 2024-01-01)')
    args = parser.parse_args()

    sync_ts = datetime.now(tz=timezone.utc).isoformat()
    log('=== Sync sap_tipo_cambio_raw ===')
    log(f'start_date: {args.start_date}')
    log(f'dry_run:    {args.dry_run}')
    log(f'sync_ts:    {sync_ts}')
    log(f'tabla:      {BQ_TABLE_TIPO_CAMBIO}')

    sa_data = parse_sa_json()
    db = init_firestore(sa_data)
    bq_client = init_bigquery(sa_data)
    cfg = get_sl_config(db)

    session = requests.Session()
    sl_login(cfg, session)

    endpoint = pick_endpoint(cfg, session)
    raw_rows = fetch_ortt(cfg, session, endpoint, args.start_date)
    log(f'Total rows obtenidas de SAP: {len(raw_rows)}')

    normalized = [normalize_row(r, sync_ts) for r in raw_rows]
    normalized = [r for r in normalized if r['fecha'] and r['moneda']]
    log(f'Rows post-normalizacion: {len(normalized)}')

    from collections import Counter
    by_currency = Counter(r['moneda'] for r in normalized)
    log(f'Monedas: {dict(by_currency)}')

    write_to_bq(bq_client, normalized, dry_run=args.dry_run)

    # Reporte final del estado de la tabla.
    if not args.dry_run and normalized:
        q = f'''
        SELECT
          COUNT(*) AS total,
          MIN(fecha) AS fecha_min,
          MAX(fecha) AS fecha_max,
          COUNT(DISTINCT moneda) AS n_monedas,
          STRING_AGG(DISTINCT moneda ORDER BY moneda) AS monedas
        FROM `{BQ_TABLE_TIPO_CAMBIO}`
        '''
        r = list(bq_client.query(q).result())[0]
        log('=== Estado final de la tabla ===')
        log(f'Total filas:   {r.total}')
        log(f'Rango fechas:  {r.fecha_min} a {r.fecha_max}')
        log(f'Monedas ({r.n_monedas}): {r.monedas}')

    log('=== Sync completado ===')


if __name__ == '__main__':
    main()
