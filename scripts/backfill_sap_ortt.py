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

Endpoint usado:
  POST /b1s/v1/SBOBobService_GetCurrencyRate (body: Currency + Date)
  Este metodo esta siempre expuesto en SAP B1 SL. Iteramos moneda × fecha.
  Alternativas descartadas (probadas y fallan en este SAP):
    - /b1s/v1/sml.svc/ORTT                 → "View ORTT not exposed"
    - /b1s/v1/sml.svc/CurrencyRates        → idem
    - /b1s/v1/CurrencyRates                → "Unrecognized resource path"

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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

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


# ----- Fetch SL (metodo SBOBobService_GetCurrencyRate) -----

def list_currencies(cfg: dict, session: requests.Session) -> list:
    """Lista las monedas definidas en SAP. Devuelve codigos (ej ['USD','EUR'])."""
    url = f"{cfg['url']}/b1s/v1/Currencies?$select=Code,Name,International&$top=100"
    resp = session.get(url, timeout=30)
    if not resp.ok:
        log(f'[CURR] WARN HTTP {resp.status_code}, fallback a lista fija USD+EUR')
        return ['USD', 'EUR']
    rows = resp.json().get('value', [])
    # Filtrar: solo tomar las monedas marcadas como "International" (= no la local).
    codes = []
    for r in rows:
        code = (r.get('Code') or '').strip()
        if not code:
            continue
        # International='tYES' indica moneda extranjera. ARS no la tiene.
        intl = r.get('International')
        if intl in ('tYES', True, 'Y', 'y'):
            codes.append(code)
    if not codes:
        log('[CURR] WARN no se detectaron monedas Internacional, fallback USD+EUR')
        return ['USD', 'EUR']
    log(f'[CURR] monedas detectadas: {codes}')
    return codes


def get_rate_one(cfg: dict, session: requests.Session, currency: str, fecha: date):
    """
    POST /b1s/v1/SBOBobService_GetCurrencyRate con body { Currency, Date }.
    Devuelve float (tasa) o None si no hay rate ese dia (fin de semana, feriado).
    """
    url = f"{cfg['url']}/b1s/v1/SBOBobService_GetCurrencyRate"
    body = {
        'Currency': currency,
        'Date': fecha.strftime('%Y-%m-%dT00:00:00Z'),
    }
    try:
        resp = session.post(url, json=body, timeout=15)
    except requests.RequestException as e:
        log(f'[RATE] red error {currency} {fecha}: {e}')
        return None
    if resp.status_code == 401:
        sl_login(cfg, session)
        resp = session.post(url, json=body, timeout=15)
    if not resp.ok:
        # SAP devuelve 400 cuando no hay cotizacion para ese dia. Es esperado.
        if resp.status_code == 400:
            return None
        log(f'[RATE] HTTP {resp.status_code} {currency} {fecha}: {resp.text[:200]}')
        return None
    try:
        data = resp.json()
    except ValueError:
        return None
    # El metodo devuelve { "SBOBobService_GetCurrencyRateResponse": { "Rate": N.NN } }
    # o directamente { "value": N.NN } segun version.
    rate = None
    if 'SBOBobService_GetCurrencyRateResponse' in data:
        rate = data['SBOBobService_GetCurrencyRateResponse'].get('Rate')
    elif 'value' in data:
        rate = data.get('value')
    elif 'Rate' in data:
        rate = data.get('Rate')
    try:
        return float(rate) if rate is not None else None
    except (TypeError, ValueError):
        return None


def date_range(start: date, end: date):
    cur = start
    while cur <= end:
        yield cur
        cur = cur + timedelta(days=1)


def fetch_ortt_via_bob(cfg, session, start_date_str: str, currencies: list, max_workers: int = 8) -> list:
    """Itera cada (moneda, fecha) desde start_date hasta hoy, paralelizado."""
    start_date_obj = date.fromisoformat(start_date_str)
    end_date_obj = datetime.now(tz=timezone.utc).date()
    tasks = []
    for curr in currencies:
        for fecha in date_range(start_date_obj, end_date_obj):
            tasks.append((curr, fecha))
    log(f'[RATE] {len(tasks)} tasks ({len(currencies)} monedas × {(end_date_obj - start_date_obj).days + 1} dias)')
    sync_ts = datetime.now(tz=timezone.utc).isoformat()
    rows = []

    def _worker(args):
        curr, fecha = args
        rate = get_rate_one(cfg, session, curr, fecha)
        if rate is not None and rate > 0:
            return {
                'fecha': fecha.isoformat(),
                'moneda': curr,
                'tasa': rate,
                '_sync_timestamp': sync_ts,
            }
        return None

    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for future in as_completed(pool.submit(_worker, t) for t in tasks):
            r = future.result()
            done += 1
            if r:
                rows.append(r)
            if done % 500 == 0:
                elapsed = time.time() - t0
                rate_per_sec = done / elapsed if elapsed > 0 else 0
                log(f'[RATE] progress {done}/{len(tasks)} ({rate_per_sec:.1f} req/s), rows ok={len(rows)}')
    log(f'[RATE] completado en {time.time() - t0:.1f}s. {len(rows)} rows con tasa > 0')
    return rows


def normalize_row(raw: dict, sync_ts: str) -> dict:
    """Normalizador legacy (compat). Hoy no se usa — rows ya vienen normalizadas."""
    return raw


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

    # 1. Listar monedas internacionales desde SAP.
    currencies = list_currencies(cfg, session)

    # 2. Iterar (moneda, fecha) via SBOBobService_GetCurrencyRate.
    normalized = fetch_ortt_via_bob(cfg, session, args.start_date, currencies, max_workers=8)
    log(f'Rows con tasa > 0: {len(normalized)}')

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
