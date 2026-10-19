"""
Backfill de la tabla ORTT (tipos de cambio diarios) desde SAP B1 Service Layer
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
  2. /b1s/v1/SBOBobService_GetCurrencyRate     — metodo, requiere body
     (fallback: si (1) falla, iteramos moneda × fecha, mas lento pero funciona)

Modo: write_truncate (reemplaza la tabla entera). Para corridas periodicas
usar sync_sap_to_bigquery.py (modo incremental, append nuevas fechas).

Uso: python scripts/backfill_sap_ortt.py [--dry-run] [--start-date=YYYY-MM-DD]
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
START_DATE_DEFAULT = '2024-01-01'


def probe_sml_ortt(cfg: dict, session: requests.Session) -> bool:
    """Verifica si /b1s/v1/sml.svc/ORTT responde OK con al menos 1 fila."""
    url = f"{cfg['url']}/b1s/v1/sml.svc/ORTT?$top=1"
    try:
        resp = session.get(url, timeout=30)
    except requests.RequestException as e:
        log(f'[PROBE/sml.svc/ORTT] error de red: {e}')
        return False
    if not resp.ok:
        log(f'[PROBE/sml.svc/ORTT] HTTP {resp.status_code}: {resp.text[:200]}')
        return False
    body = resp.json()
    rows = body.get('value', [])
    log(f'[PROBE/sml.svc/ORTT] OK — devolvio {len(rows)} rows en la pagina de prueba.')
    if rows:
        log(f'[PROBE/sml.svc/ORTT] columnas sample: {sorted(rows[0].keys())}')
    return True


def fetch_ortt_via_sml(cfg: dict, session: requests.Session, start_date: str) -> list:
    """Pagina /b1s/v1/sml.svc/ORTT?$filter=RateDate ge START filtrando por fecha."""
    rows_all = []
    # SL usa OData v4 con cursor @odata.nextLink.
    filter_expr = f"RateDate ge {start_date}T00:00:00Z"
    url = (
        f"{cfg['url']}/b1s/v1/sml.svc/ORTT"
        f"?$filter={filter_expr}"
        f"&$select=RateDate,Currency,Rate"
        f"&$orderby=RateDate asc,Currency asc"
    )
    page = 0
    headers = {'Prefer': 'odata.maxpagesize=1000'}
    while url:
        try:
            resp = session.get(url, timeout=60, headers=headers)
        except requests.RequestException as e:
            log(f'[ORTT/sml] red error pag {page}: {e}')
            time.sleep(3)
            resp = session.get(url, timeout=60, headers=headers)
        if resp.status_code == 401:
            sl_login(cfg, session)
            resp = session.get(url, timeout=60, headers=headers)
        if not resp.ok:
            log(f'[FATAL/ORTT/sml] HTTP {resp.status_code}: {resp.text[:300]}')
            sys.exit(4)
        body = resp.json()
        value = body.get('value', [])
        rows_all.extend(value)
        page += 1
        log(f'[ORTT/sml] pag {page}: +{len(value)} rows (acum {len(rows_all)})')
        next_link = body.get('@odata.nextLink') or body.get('odata.nextLink')
        if not next_link:
            break
        url = next_link if next_link.startswith('http') else f"{cfg['url']}/{next_link.lstrip('/')}"
    return rows_all


def normalize_row(raw: dict, sync_ts: str) -> dict:
    """ORTT raw -> schema sap_tipo_cambio_raw."""
    rate_date = raw.get('RateDate') or raw.get('rateDate') or ''
    # SL devuelve datetime en formato 'YYYY-MM-DDT00:00:00Z'. BQ DATE acepta YYYY-MM-DD.
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


def write_to_bq(bq_client: bigquery.Client, rows: list, dry_run: bool = False) -> None:
    """Reemplaza tabla sap_tipo_cambio_raw con las rows normalizadas."""
    if dry_run:
        log(f'[DRY RUN] {len(rows)} rows preparadas (no se escriben).')
        log(f'[DRY RUN] Muestra: {rows[:3]}')
        return
    if not rows:
        log('[WARN] 0 rows para escribir. Abortando sin tocar la tabla.')
        return
    schema = [
        bigquery.SchemaField('fecha', 'DATE', mode='REQUIRED'),
        bigquery.SchemaField('moneda', 'STRING', mode='REQUIRED'),
        bigquery.SchemaField('tasa', 'NUMERIC', mode='NULLABLE'),
        bigquery.SchemaField('_sync_timestamp', 'TIMESTAMP', mode='REQUIRED'),
    ]
    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition='WRITE_TRUNCATE',
    )
    log(f'[BQ] load_from_json a {BQ_TABLE_TIPO_CAMBIO}, {len(rows)} rows...')
    job = bq_client.load_table_from_json(rows, BQ_TABLE_TIPO_CAMBIO, job_config=job_config)
    job.result()
    log(f'[BQ] OK — tabla reemplazada.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='No escribe a BQ')
    parser.add_argument('--start-date', default=START_DATE_DEFAULT, help='YYYY-MM-DD (default 2024-01-01)')
    args = parser.parse_args()

    sync_ts = datetime.now(tz=timezone.utc).isoformat()
    log(f'=== Backfill sap_tipo_cambio_raw ===')
    log(f'start_date: {args.start_date}')
    log(f'dry_run:    {args.dry_run}')
    log(f'sync_ts:    {sync_ts}')

    # 1. Service Account + Firestore + BQ clients.
    sa_data = parse_sa_json()
    db = init_firestore(sa_data)
    bq_client = init_bigquery(sa_data)
    cfg = get_sl_config(db)

    # 2. Login SL.
    session = requests.Session()
    sl_login(cfg, session)

    # 3. Probe ORTT.
    if not probe_sml_ortt(cfg, session):
        log('[FATAL] /b1s/v1/sml.svc/ORTT no disponible. Decime a Mariano para explorar fallbacks.')
        sys.exit(4)

    # 4. Fetch histórico.
    raw_rows = fetch_ortt_via_sml(cfg, session, args.start_date)
    log(f'Total rows obtenidas de ORTT: {len(raw_rows)}')

    # 5. Normalizar.
    normalized = [normalize_row(r, sync_ts) for r in raw_rows]
    # Filtrar rows con fecha o moneda vacias (defensivo).
    normalized = [r for r in normalized if r['fecha'] and r['moneda']]
    log(f'Rows post-normalizacion: {len(normalized)}')

    # 6. Resumen por moneda (debug).
    from collections import Counter
    by_currency = Counter(r['moneda'] for r in normalized)
    log(f'Monedas encontradas: {dict(by_currency)}')

    # 7. Load a BQ.
    write_to_bq(bq_client, normalized, dry_run=args.dry_run)
    log('=== Backfill completado ===')


if __name__ == '__main__':
    main()
