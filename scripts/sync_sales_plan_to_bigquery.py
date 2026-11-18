#!/usr/bin/env python3
"""
sync_sales_plan_to_bigquery.py — v1 (2026-11-18)

Exporta los Sales Plans (Rods + Reels) que viven en Firestore
`sales_plan_cache/{familia}` a una tabla BigQuery en long format:

  shimano_app.sales_plan_rows (familia, sku, description, moq, mes DATE,
                               cantidad, source_year_month, source_filename,
                               uploaded_by, snapshot_at, loaded_at)

Pensado para alimentar Power BI con la misma información que el frontend
Forecast usa para calcular "Plan futuro" en la pantalla
"Recomendación de Compra".

Flujo:
  1. Lee Firestore `sales_plan_cache/rods` + `sales_plan_cache/reels`
     (patrón ya usado por src/domains/forecast.js).
  2. Expande `rows[].months{}` a long format. Cada entrada 'YYYY-MM'
     se convierte en un registro con `mes = DATE(YYYY, MM, 1)`.
  3. Normaliza fechas con parse_firestore_date (CLAUDE.md §85) para
     tolerar tanto Timestamp nativo como string ISO.
  4. Escribe a BQ con WRITE_TRUNCATE (reemplazo total cada corrida).
     `truncate_on_empty=True`: si ambos caches están vacíos, la tabla
     en BQ queda vacía (coherente con el estado del Forecast).

Variables de entorno:
  FIREBASE_SERVICE_ACCOUNT  JSON del SA (mismo que usa sync-sap-to-bigquery.yml).
  DRY_RUN=true              No escribe a BQ, solo loguea el summary.
  LIMIT_MONTHS=N            Opcional, cap de meses futuros a expandir (debug).

Uso local:
  export FIREBASE_SERVICE_ACCOUNT=$(cat sa.json)
  python scripts/sync_sales_plan_to_bigquery.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime, timezone
from typing import Any, Iterable

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.cloud import bigquery
    from google.oauth2 import service_account
except Exception as e:  # pragma: no cover - env setup
    print(f'[fatal] deps missing: {e}', file=sys.stderr)
    sys.exit(2)


BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'
BQ_TABLE_SALES_PLAN = f'{BQ_PROJECT}.{BQ_DATASET}.sales_plan_rows'

FAMILIAS = ('rods', 'reels')


# ============================================================
# Helpers
# ============================================================

def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def parse_firestore_date(v: Any) -> str | None:
    """CLAUDE.md §85. Acepta Timestamp, datetime, string ISO, None."""
    if v is None:
        return None
    if hasattr(v, 'isoformat'):
        try:
            return v.isoformat()
        except Exception:
            return None
    if isinstance(v, str):
        return v if v else None
    return None


def normalize_month_key(k: str) -> date | None:
    """Convierte 'YYYY-MM' a DATE(YYYY, MM, 1). Rechaza shape inválido."""
    if not isinstance(k, str) or len(k) != 7 or k[4] != '-':
        return None
    try:
        y = int(k[:4])
        m = int(k[5:])
        if m < 1 or m > 12:
            return None
        if y < 2000 or y > 2100:
            return None
        return date(y, m, 1)
    except (ValueError, TypeError):
        return None


def load_sa_credentials() -> service_account.Credentials:
    raw = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if not raw:
        print('[fatal] FIREBASE_SERVICE_ACCOUNT no seteado', file=sys.stderr)
        sys.exit(2)
    try:
        sa_info = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f'[fatal] FIREBASE_SERVICE_ACCOUNT no es JSON válido: {e}', file=sys.stderr)
        sys.exit(2)
    creds = service_account.Credentials.from_service_account_info(
        sa_info,
        scopes=['https://www.googleapis.com/auth/cloud-platform'],
    )
    return creds


def init_firestore(creds: service_account.Credentials):
    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            credentials.Certificate(json.loads(os.environ['FIREBASE_SERVICE_ACCOUNT'])),
            {'projectId': BQ_PROJECT},
        )
    return firestore.client()


def init_bigquery(creds: service_account.Credentials) -> bigquery.Client:
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


# ============================================================
# Core: expansión a long format
# ============================================================

def expand_cache_to_rows(familia: str, cache: dict, loaded_at_iso: str) -> list[dict]:
    """
    Expande un doc `sales_plan_cache/{familia}` a records long-format.
    Cada SKU × mes = 1 row. Filtra cantidades no numéricas o <= 0.
    """
    if not isinstance(cache, dict):
        return []
    source_rows = cache.get('rows')
    if not isinstance(source_rows, list):
        return []

    snapshot_at = parse_firestore_date(cache.get('parsedAt')) or loaded_at_iso
    source_year_month = cache.get('yearMonth') or ''
    source_filename = cache.get('sourceFilename') or ''
    uploaded_by = cache.get('uploadedBy') or ''

    out: list[dict] = []
    for row in source_rows:
        if not isinstance(row, dict):
            continue
        sku = str(row.get('sku') or '').strip()
        if not sku:
            continue
        description = str(row.get('description') or '').strip()
        moq_raw = row.get('moq')
        try:
            moq = int(moq_raw) if moq_raw is not None else 0
        except (ValueError, TypeError):
            moq = 0
        months = row.get('months')
        if not isinstance(months, dict):
            continue
        for mes_key, qty_raw in months.items():
            mes = normalize_month_key(mes_key)
            if mes is None:
                continue
            try:
                qty = int(qty_raw) if qty_raw is not None else 0
            except (ValueError, TypeError):
                continue
            if qty <= 0:
                continue
            out.append({
                'familia': familia,
                'sku': sku,
                'description': description,
                'moq': moq,
                'mes': mes.isoformat(),  # 'YYYY-MM-DD'
                'cantidad': qty,
                'source_year_month': source_year_month,
                'source_filename': source_filename,
                'uploaded_by': uploaded_by,
                'snapshot_at': snapshot_at,
                'loaded_at': loaded_at_iso,
            })
    return out


# ============================================================
# BigQuery load
# ============================================================

SALES_PLAN_SCHEMA = [
    bigquery.SchemaField('familia', 'STRING', mode='REQUIRED'),
    bigquery.SchemaField('sku', 'STRING', mode='REQUIRED'),
    bigquery.SchemaField('description', 'STRING', mode='NULLABLE'),
    bigquery.SchemaField('moq', 'INTEGER', mode='NULLABLE'),
    bigquery.SchemaField('mes', 'DATE', mode='REQUIRED'),
    bigquery.SchemaField('cantidad', 'INTEGER', mode='REQUIRED'),
    bigquery.SchemaField('source_year_month', 'STRING', mode='NULLABLE'),
    bigquery.SchemaField('source_filename', 'STRING', mode='NULLABLE'),
    bigquery.SchemaField('uploaded_by', 'STRING', mode='NULLABLE'),
    bigquery.SchemaField('snapshot_at', 'TIMESTAMP', mode='NULLABLE'),
    bigquery.SchemaField('loaded_at', 'TIMESTAMP', mode='REQUIRED'),
]


def load_to_bq(bq_client: bigquery.Client, rows: list[dict], dry_run: bool) -> dict:
    """
    WRITE_TRUNCATE + truncate_on_empty=True.
    Si rows=[], la tabla queda vacía (coherente con "no hay sales plan").
    """
    if dry_run:
        return {'written': 0, 'dry_run': True, 'total_rows': len(rows)}

    job_config = bigquery.LoadJobConfig(
        schema=SALES_PLAN_SCHEMA,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        time_partitioning=bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.MONTH,
            field='mes',
        ),
        clustering_fields=['familia', 'sku'],
    )

    if not rows:
        # Truncate explícito: tabla queda vacía sin perder schema.
        job = bq_client.load_table_from_json([], BQ_TABLE_SALES_PLAN, job_config=job_config, location=BQ_LOCATION)
        job.result()
        return {'written': 0, 'dry_run': False, 'total_rows': 0}

    job = bq_client.load_table_from_json(rows, BQ_TABLE_SALES_PLAN, job_config=job_config, location=BQ_LOCATION)
    job.result()
    return {'written': job.output_rows or len(rows), 'dry_run': False, 'total_rows': len(rows)}


# ============================================================
# Main
# ============================================================

def main() -> int:
    dry_run = os.environ.get('DRY_RUN', '').lower() in ('true', '1', 'yes')
    loaded_at_iso = now_iso()
    t0 = time.monotonic()

    creds = load_sa_credentials()
    fs_client = init_firestore(creds)
    bq_client = init_bigquery(creds)

    all_rows: list[dict] = []
    per_familia_stats: list[dict] = []

    for familia in FAMILIAS:
        doc_ref = fs_client.collection('sales_plan_cache').document(familia)
        snap = doc_ref.get()
        if not snap.exists:
            print(f'[warn] sales_plan_cache/{familia} no existe — skip')
            per_familia_stats.append({'familia': familia, 'skus': 0, 'rows': 0, 'status': 'missing'})
            continue
        data = snap.to_dict() or {}
        expanded = expand_cache_to_rows(familia, data, loaded_at_iso)
        skus_total = len(data.get('rows') or [])
        rows_total = len(expanded)
        per_familia_stats.append({
            'familia': familia,
            'skus': skus_total,
            'rows': rows_total,
            'status': 'ok',
            'source_year_month': data.get('yearMonth'),
            'source_filename': data.get('sourceFilename'),
        })
        print(f'[info] {familia}: {skus_total} SKUs → {rows_total} rows long-format')
        all_rows.extend(expanded)

    load_result = load_to_bq(bq_client, all_rows, dry_run=dry_run)
    dt = time.monotonic() - t0

    summary = {
        'ok': True,
        'loaded_at': loaded_at_iso,
        'dry_run': dry_run,
        'per_familia': per_familia_stats,
        'total_rows': load_result['total_rows'],
        'bq_rows_written': load_result['written'],
        'bq_table': BQ_TABLE_SALES_PLAN,
        'elapsed_seconds': round(dt, 2),
    }
    print('[summary]', json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
