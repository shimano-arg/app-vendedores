#!/usr/bin/env python3
"""Snapshot semanal de sap_items_bike_raw.cost_avg_ars a costo_snapshot_semanal.

Decision Mariano 2026-10-23: NO hacer pull nuevo a SAP ni CSV. El sync continuo
(sync_sap_to_bigquery.py) ya trae cost_avg_ars al dataset BQ. El job del lunes
inserta la foto del momento como snapshot de la semana.

Idempotencia: DELETE del snapshot_week_start actual antes del INSERT. Si corre
dos veces el mismo lunes, pisa (misma fecha_corte, mismos valores).

snapshot_week_start = lunes de la semana actual (BQ: WEEK(MONDAY) de hoy).

Si DRY_RUN=1, imprime el SQL + conteos sin ejecutar.

Guards:
   * Aborta si MAX(_sync_timestamp) de sap_items_bike_raw es > 24hs atras
     (sync detenido).
   * Aborta si cantidad de items a insertar < 500 (datos degradados).
"""
import json
import os
import sys
from datetime import datetime, timezone, timedelta

from google.cloud import bigquery
from google.oauth2 import service_account


BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'
BQ_TABLE_SNAPSHOT = f'{BQ_PROJECT}.{BQ_DATASET}.costo_snapshot_semanal'
BQ_TABLE_ITEMS_BIKE = f'{BQ_PROJECT}.{BQ_DATASET}.sap_items_bike_raw'


def init_bq() -> bigquery.Client:
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if sa_json:
        if not sa_json.startswith('{'):
            import base64
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        sa_data = json.loads(sa_json)
        creds = service_account.Credentials.from_service_account_info(sa_data)
        print('[init_bq] usando FIREBASE_SERVICE_ACCOUNT env var')
        return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)
    print('[init_bq] usando ADC local (gcloud auth application-default login)')
    return bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)


def main():
    dry_run = os.environ.get('DRY_RUN', '').strip().lower() in ('1', 'true', 'yes')
    c = init_bq()

    # Guard 1: freshness del sync items_bike.
    q_fresh = f"""
    SELECT
      MAX(_sync_timestamp) AS last_sync,
      COUNT(*) AS total,
      COUNTIF(cost_avg_ars IS NOT NULL) AS con_cost
    FROM `{BQ_TABLE_ITEMS_BIKE}`
    """
    r = list(c.query(q_fresh).result())[0]
    last_sync_str = r['last_sync']
    total_items = int(r['total'] or 0)
    con_cost = int(r['con_cost'] or 0)
    # last_sync viene como STRING (schema). Parseamos para chequeo.
    try:
        if isinstance(last_sync_str, str):
            last_sync_dt = datetime.fromisoformat(last_sync_str.replace('Z', '+00:00'))
        else:
            last_sync_dt = last_sync_str
    except Exception as e:
        print(f'[FATAL] no se puede parsear last_sync "{last_sync_str}": {e}')
        sys.exit(2)
    if last_sync_dt.tzinfo is None:
        last_sync_dt = last_sync_dt.replace(tzinfo=timezone.utc)
    now_utc = datetime.now(timezone.utc)
    age = now_utc - last_sync_dt
    print(f'[check] sap_items_bike_raw: last_sync={last_sync_dt.isoformat()} (hace {age.total_seconds()/3600:.1f}h), total={total_items:,}, con_cost={con_cost:,}')
    if age > timedelta(hours=24):
        print(f'[FATAL] sap_items_bike_raw sync > 24hs atras — sync detenido? Aborta.')
        sys.exit(3)
    if con_cost < 500:
        print(f'[FATAL] sap_items_bike_raw con_cost={con_cost} < 500 — data degradada. Aborta.')
        sys.exit(4)

    # Compute snapshot_week_start = lunes de la semana actual (ART).
    # DATE_TRUNC(CURRENT_DATE('America/Argentina/Buenos_Aires'), WEEK(MONDAY)).
    q_week = """
    SELECT DATE_TRUNC(CURRENT_DATE('America/Argentina/Buenos_Aires'), WEEK(MONDAY)) AS wk
    """
    week_row = list(c.query(q_week).result())[0]
    week_start = week_row['wk']
    print(f'[week] snapshot_week_start = {week_start}')

    # SQL del snapshot (DELETE + INSERT idempotente).
    sql = f"""
    DELETE FROM `{BQ_TABLE_SNAPSHOT}`
    WHERE snapshot_week_start = DATE('{week_start}');

    INSERT INTO `{BQ_TABLE_SNAPSHOT}`
      (snapshot_week_start, snapshot_at, item_code, cost_avg_ars, cost_source)
    SELECT
      DATE('{week_start}') AS snapshot_week_start,
      CURRENT_TIMESTAMP() AS snapshot_at,
      item_code,
      cost_avg_ars,
      'sap_items_bike_raw.cost_avg_ars' AS cost_source
    FROM `{BQ_TABLE_ITEMS_BIKE}`
    WHERE cost_avg_ars IS NOT NULL
    ;
    """
    if dry_run:
        print('[DRY_RUN] SQL:')
        print(sql)
        return

    print('[exec] ejecutando snapshot...')
    job = c.query(sql)
    job.result()
    print(f'[exec] OK bytes_processed={(job.total_bytes_processed or 0):,}')

    # Verificacion post-insert.
    q_check = f"""
    SELECT COUNT(*) AS n, COUNT(DISTINCT item_code) AS items,
      ROUND(AVG(cost_avg_ars), 2) AS avg,
      ROUND(MIN(cost_avg_ars), 2) AS min,
      ROUND(MAX(cost_avg_ars), 2) AS max
    FROM `{BQ_TABLE_SNAPSHOT}`
    WHERE snapshot_week_start = DATE('{week_start}')
    """
    r = list(c.query(q_check).result())[0]
    print(f'[check] snapshot_week_start={week_start}  rows={int(r.n):,}  items_unique={int(r.items):,}  avg=${r.avg:,.2f}  min={r.min}  max={r.max}')
    if int(r.n) == 0:
        print('[FATAL] snapshot vacio post-insert.')
        sys.exit(5)


if __name__ == '__main__':
    main()
