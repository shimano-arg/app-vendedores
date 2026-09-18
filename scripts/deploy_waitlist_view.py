"""v997 (2026-09-18): deploy inicial de la tabla `waitlist_raw` + vista
`v_waitlist_disponible_ars` para el card PowerBI "Total Espera $ARS".

Este script hace 3 cosas en orden:
  1. Backfill inicial de `waitlist_raw` desde Firestore `revision_waitlist`
     (mismo shape que va a poblar el cron sync_sap_to_bigquery.py cada 30 min).
  2. CREATE OR REPLACE VIEW v_waitlist_disponible_ars leyendo el bloque final
     de bigquery/views.sql (delimitado por su comentario de encabezado).
  3. Smoke test: cuenta docs, muestra top-3 items por disponible_ars.

Uso (una sola vez, despues el cron cada 30 min sync automatico):

    export FIREBASE_SERVICE_ACCOUNT="$(cat sa-key.json)"
    python scripts/deploy_waitlist_view.py

Requiere:
  - Python 3.10+
  - google-cloud-bigquery, firebase-admin (ya en el proyecto)
  - FIREBASE_SERVICE_ACCOUNT env con SA JSON (mismo que sync_sap_to_bigquery.py)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Reutiliza el modulo del sync grande para no duplicar el codigo del pull
# Firestore. Al importar, el modulo NO ejecuta main() porque es __main__ guard.
_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO / 'scripts'))

import firebase_admin  # noqa: E402
from firebase_admin import credentials, firestore  # noqa: E402
from google.cloud import bigquery  # noqa: E402
from google.oauth2 import service_account  # noqa: E402

# Importa las constantes + funcion de sync desde sync_sap_to_bigquery
from sync_sap_to_bigquery import (  # noqa: E402
    BQ_PROJECT,
    BQ_DATASET,
    BQ_TABLE_WAITLIST,
    sync_waitlist_from_firestore,
    _load_to_bq_with_schema,
)


BQ_LOCATION = 'southamerica-east1'


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
    print(f'[{ts}Z] {msg}', flush=True)


def parse_sa() -> dict:
    raw = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '')
    if not raw:
        # Fallback local: ~/Desktop/sa-key.json (mismo pattern que redeploy_views.py)
        sa_path = Path.home() / 'Desktop' / 'sa-key.json'
        if sa_path.exists():
            raw = sa_path.read_text()
        else:
            print('ERROR: FIREBASE_SERVICE_ACCOUNT env var no definida y ~/Desktop/sa-key.json no existe')
            sys.exit(1)
    return json.loads(raw)


def init_firestore(sa: dict):
    cred = credentials.Certificate(sa)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


def init_bq(sa: dict) -> bigquery.Client:
    creds = service_account.Credentials.from_service_account_info(sa)
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


def extract_view_sql() -> str:
    """Lee bigquery/views.sql y extrae el ultimo bloque CREATE OR REPLACE VIEW
    correspondiente a v_waitlist_disponible_ars (delimitado por el header
    `-- v_waitlist_disponible_ars — v997`)."""
    sql_path = _REPO / 'bigquery' / 'views.sql'
    text = sql_path.read_text(encoding='utf-8')
    marker = '-- v_waitlist_disponible_ars — v997'
    idx = text.find(marker)
    if idx < 0:
        raise RuntimeError(f'header {marker!r} no encontrado en {sql_path}')
    body_start = text.find('CREATE OR REPLACE VIEW', idx)
    if body_start < 0:
        raise RuntimeError('CREATE OR REPLACE VIEW no encontrado despues del header')
    # el final del script es el fin del archivo (unica vista despues del header)
    return text[body_start:].strip()


def main() -> None:
    log('=== v997 deploy_waitlist_view.py ===')
    sa = parse_sa()
    db = init_firestore(sa)
    bq = init_bq(sa)
    log(f'firestore + bq clientes OK (project={BQ_PROJECT}, location={BQ_LOCATION})')

    # 1. Backfill inicial waitlist_raw
    sync_ts = datetime.now(timezone.utc).isoformat()
    log('1. backfill waitlist_raw...')
    rows = sync_waitlist_from_firestore(db, sync_ts)
    _waitlist_schema = [
        bigquery.SchemaField('doc_id',             'STRING'),
        bigquery.SchemaField('item_index',         'INT64'),
        bigquery.SchemaField('client_name',        'STRING'),
        bigquery.SchemaField('client_province',    'STRING'),
        bigquery.SchemaField('client_locality',    'STRING'),
        bigquery.SchemaField('client_card_code',   'STRING'),
        bigquery.SchemaField('owner_uid',          'STRING'),
        bigquery.SchemaField('owner_email',        'STRING'),
        bigquery.SchemaField('owner_display_name', 'STRING'),
        bigquery.SchemaField('owner_vendor',       'STRING'),
        bigquery.SchemaField('vendor_assigned',    'STRING'),
        bigquery.SchemaField('order_number',       'INT64'),
        bigquery.SchemaField('source',             'STRING'),
        bigquery.SchemaField('from_pedido_fs_id',  'STRING'),
        bigquery.SchemaField('from_pedido_month',  'STRING'),
        bigquery.SchemaField('delivery_method',    'STRING'),
        bigquery.SchemaField('source_excel_path',  'STRING'),
        bigquery.SchemaField('source_excel_name',  'STRING'),
        bigquery.SchemaField('item_code',          'STRING'),
        bigquery.SchemaField('item_desc',          'STRING'),
        bigquery.SchemaField('item_qty',           'FLOAT64'),
        bigquery.SchemaField('first_stock_total',  'FLOAT64'),
        bigquery.SchemaField('first_backorder',    'FLOAT64'),
        bigquery.SchemaField('first_disponible',   'FLOAT64'),
        bigquery.SchemaField('created_at',         'TIMESTAMP'),
        bigquery.SchemaField('updated_at',         'TIMESTAMP'),
        bigquery.SchemaField('_sync_timestamp',    'TIMESTAMP'),
    ]
    _load_to_bq_with_schema(bq, BQ_TABLE_WAITLIST, rows, 'WAITLIST', _waitlist_schema, truncate_on_empty=True)

    # 2. Create/replace view
    log('2. CREATE OR REPLACE VIEW v_waitlist_disponible_ars...')
    view_sql = extract_view_sql()
    bq.query(view_sql, location=BQ_LOCATION).result()
    log('   OK vista creada/replaced')

    # 3. Smoke test
    log('3. smoke test...')
    smoke_sql = """
      SELECT
        COUNT(DISTINCT waitlist_id) AS waitlists,
        COUNT(*)                    AS items,
        COUNT(DISTINCT assigned_vendor) AS vendors,
        ROUND(SUM(disponible_ars), 2)   AS total_disponible_ars,
        ROUND(SUM(total_pedido_ars), 2) AS total_pedido_ars,
        ROUND(SUM(backorder_estimado_ars), 2) AS backorder_estimado_ars
      FROM `app-vendedores-shimano.shimano_app.v_waitlist_disponible_ars`
    """
    row = list(bq.query(smoke_sql, location=BQ_LOCATION).result())[0]
    log(f'   waitlists={row.waitlists} items={row.items} vendors={row.vendors}')
    log(f'   total_disponible_ars={row.total_disponible_ars:,.2f}')
    log(f'   total_pedido_ars    ={row.total_pedido_ars:,.2f}')
    log(f'   backorder_estimado_ars={row.backorder_estimado_ars:,.2f}')

    log('=== deploy OK ===')


if __name__ == '__main__':
    main()
