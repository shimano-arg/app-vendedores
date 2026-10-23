#!/usr/bin/env python3
"""
Deploy conciliacion Paiva: 2 operaciones BQ atomicas (fuera de 1 transaccion:
BQ no soporta DDL cross-table en 1 txn, pero validamos pre/post).

Operacion A — Crear tabla costo_snapshot_semanal (CREATE TABLE IF NOT EXISTS)
              + seed septiembre 2026 desde bike_test_paiva_sep2026.
Operacion B — CREATE OR REPLACE VIEW v_rentabilidad_bike con 4 columnas nuevas
              (division_cliente, nro_fiscal, nro_fiscal_completo, costo_finanzas_ars).

Controles antes/despues (regla Mariano):
   * COUNT(*) de v_rentabilidad_bike NO cambia (invariante — nuevas columnas
     se agregan al SELECT, no filtran filas).
   * SUM(venta_neta_ars) de v_rentabilidad_bike NO cambia.
   * SUM(costo_prom_ars) de v_rentabilidad_bike NO cambia.
   * COUNT(*) de costo_snapshot_semanal post-seed > 0 (septiembre 2026).

Requiere:
   FIREBASE_SERVICE_ACCOUNT env var (service account JSON para BQ).
"""
import json
import os
import sys
import pathlib
from google.cloud import bigquery
from google.oauth2 import service_account


BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'  # verificado 2026-10-22 contra d.location
HERE = pathlib.Path(__file__).parent.resolve()
VIEW_SQL_PATH = HERE.parent / 'bigquery' / 'views' / 'v_rentabilidad_bike.sql'
TABLE_SQL_PATH = HERE.parent / 'bigquery' / 'tables' / 'costo_snapshot_semanal.sql'


def init_bq() -> bigquery.Client:
    """Prefiere FIREBASE_SERVICE_ACCOUNT (GH Actions / entorno server) y
    fallback a ADC local (gcloud auth application-default login)."""
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if sa_json:
        if not sa_json.startswith('{'):
            import base64
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        sa_data = json.loads(sa_json)
        creds = service_account.Credentials.from_service_account_info(sa_data)
        print('[init_bq] credenciales desde FIREBASE_SERVICE_ACCOUNT env var')
        return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)
    # Fallback: ADC local (gcloud auth application-default login).
    print('[init_bq] FIREBASE_SERVICE_ACCOUNT vacio — usando ADC local (gcloud)')
    return bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)


def run_query(bq_client: bigquery.Client, sql: str, label: str) -> list:
    print(f'[{label}] ejecutando...')
    job = bq_client.query(sql)
    rows = list(job.result())
    print(f'[{label}] OK  bytes_processed={job.total_bytes_processed or 0:,}')
    return rows


def get_control_metrics(bq_client: bigquery.Client, label: str) -> dict:
    rows = run_query(
        bq_client,
        f"""
        SELECT
          COUNT(*)             AS filas_total,
          SUM(venta_neta_ars)  AS venta_neta_sum,
          SUM(costo_prom_ars)  AS costo_prom_sum,
          SUM(costo_doc_ars)   AS costo_doc_sum,
          COUNT(DISTINCT doc_entry) AS docs
        FROM `app-vendedores-shimano.shimano_app.v_rentabilidad_bike`
        """,
        f'control-{label}',
    )
    r = rows[0]
    return {
        'filas_total': int(r['filas_total'] or 0),
        'venta_neta_sum': round(float(r['venta_neta_sum'] or 0), 2),
        'costo_prom_sum': round(float(r['costo_prom_sum'] or 0), 2),
        'costo_doc_sum': round(float(r['costo_doc_sum'] or 0), 2),
        'docs': int(r['docs'] or 0),
    }


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=['table', 'view', 'all'], default='all',
                    help='table = solo costo_snapshot_semanal + seed; view = solo redeploy v_rentabilidad_bike; all = ambos (default)')
    args = ap.parse_args()

    bq_client = init_bq()

    pre = None
    if args.only in ('view', 'all'):
        print('=' * 60)
        print('CONTROL ANTES')
        print('=' * 60)
        pre = get_control_metrics(bq_client, 'antes')
        print(json.dumps(pre, indent=2))

    if args.only in ('table', 'all'):
        _run_op_a(bq_client)

    if args.only == 'table':
        print('\n[only=table] skip Operacion B (view redeploy).')
        return

    _run_op_b(bq_client, pre)


def _run_op_a(bq_client: bigquery.Client):
    print('\n' + '=' * 60)
    print('OPERACION A — costo_snapshot_semanal + seed sep 2026')
    print('=' * 60)
    # BQ Python SDK soporta scripts multi-statement directamente (no hace falta
    # split manual — el split rompe cuando hay ';' dentro de comentarios o
    # strings). Enviamos el archivo completo como 1 job.
    sql_a = TABLE_SQL_PATH.read_text(encoding='utf-8')
    run_query(bq_client, sql_a, 'script-A')

    seed_rows = run_query(
        bq_client,
        """
        SELECT COUNT(*) AS n, COUNT(DISTINCT item_code) AS items,
               ROUND(AVG(cost_avg_ars), 2) AS avg, ROUND(MAX(cost_avg_ars), 2) AS max,
               ROUND(MIN(cost_avg_ars), 2) AS min
        FROM `app-vendedores-shimano.shimano_app.costo_snapshot_semanal`
        WHERE snapshot_week_start = DATE('2026-10-05')
        """,
        'seed-check',
    )
    s = seed_rows[0]
    print(f'[seed sep2026] rows={int(s["n"] or 0)}  items_unique={int(s["items"] or 0)}  avg={s["avg"]}  min={s["min"]}  max={s["max"]}')
    if (s['n'] or 0) == 0:
        print('[FATAL] seed vacio: bike_test_paiva_sep2026 no tiene filas con cantidad>0 y costo_total_paiva_ars NOT NULL', file=sys.stderr)
        sys.exit(3)


def _run_op_b(bq_client: bigquery.Client, pre: dict | None):
    print('\n' + '=' * 60)
    print('OPERACION B — CREATE OR REPLACE VIEW v_rentabilidad_bike')
    print('=' * 60)
    sql_b_body = VIEW_SQL_PATH.read_text(encoding='utf-8')
    # Prefijo CREATE OR REPLACE VIEW.
    sql_b = (
        'CREATE OR REPLACE VIEW '
        f'`app-vendedores-shimano.shimano_app.v_rentabilidad_bike`\n'
        'OPTIONS(\n'
        "  description=\"Rentabilidad bike por linea de factura/NC. Linea 1 "
        "row = (doc_entry, line_num) con COGSCostingCode3='BIK'. Ver cabecera del "
        "SQL para columnas 2026-10-22 (division_cliente, nro_fiscal, "
        "nro_fiscal_completo, costo_finanzas_ars) y nota sobre fecha_contable "
        "(campo DERIVADO, NO es la fecha contable de SAP para NCs).\"\n"
        ')\n'
        'AS\n'
        + sql_b_body
    )
    run_query(bq_client, sql_b, 'view-replace')

    print('\n' + '=' * 60)
    print('CONTROL DESPUES')
    print('=' * 60)
    post = get_control_metrics(bq_client, 'despues')
    print(json.dumps(post, indent=2))

    print('\n' + '=' * 60)
    print('DIFF PRE vs POST')
    print('=' * 60)
    rc = 0
    for k in ('filas_total', 'venta_neta_sum', 'costo_prom_sum', 'costo_doc_sum', 'docs'):
        diff = post[k] - pre[k]
        tag = 'OK' if abs(diff) < 0.01 else '!!'
        print(f'  {tag}  {k}: pre={pre[k]:,}  post={post[k]:,}  diff={diff:+,.2f}')
        if abs(diff) >= 0.01:
            rc = 10

    # Chequeo adicional: columnas nuevas existen + poblamiento
    print('\n--- columnas nuevas en v_rentabilidad_bike ---')
    cols = run_query(
        bq_client,
        """
        SELECT column_name, data_type
        FROM `app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = 'v_rentabilidad_bike'
          AND column_name IN ('division_cliente', 'nro_fiscal', 'nro_fiscal_completo', 'costo_finanzas_ars')
        ORDER BY ordinal_position
        """,
        'cols-check',
    )
    found = {c['column_name']: c['data_type'] for c in cols}
    for col in ('division_cliente', 'nro_fiscal', 'nro_fiscal_completo', 'costo_finanzas_ars'):
        if col in found:
            print(f'  OK  {col} {found[col]}')
        else:
            print(f'  !!  FALTA {col}')
            rc = 11

    print('\n--- poblamiento septiembre 2026 ---')
    pop = run_query(
        bq_client,
        """
        SELECT
          COUNT(*) AS lineas,
          COUNTIF(division_cliente IS NOT NULL AND division_cliente != '') AS con_div,
          COUNTIF(nro_fiscal_completo IS NOT NULL) AS con_fiscal_completo,
          COUNTIF(costo_finanzas_ars IS NOT NULL) AS con_costo_finanzas,
          COUNTIF(costo_paiva_ars_sep2026 IS NOT NULL) AS con_costo_paiva_sep
        FROM `app-vendedores-shimano.shimano_app.v_rentabilidad_bike`
        WHERE doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
        """,
        'poblamiento-sep',
    )
    p = pop[0]
    print(f'  lineas sep 2026: {int(p["lineas"] or 0)}')
    print(f'  con division_cliente: {int(p["con_div"] or 0)}')
    print(f'  con nro_fiscal_completo: {int(p["con_fiscal_completo"] or 0)}')
    print(f'  con costo_finanzas_ars: {int(p["con_costo_finanzas"] or 0)}')
    print(f'  con costo_paiva_ars_sep2026 (legacy): {int(p["con_costo_paiva_sep"] or 0)}')

    if rc != 0:
        sys.exit(rc)


if __name__ == '__main__':
    main()
