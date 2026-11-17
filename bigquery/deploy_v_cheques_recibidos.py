"""
deploy_v_cheques_recibidos.py — Deploy aislado de la vista v_cheques_recibidos v3

Por que un deploy aislado y no `bq query < cobranzas_bike.sql` entero:
  1. CLAUDE.md feedback `feedback_bq_view_deploy_utf8.md`: nunca `bq query <` desde
     PS 5.1/cmd.exe con literales acentuados -- quema mojibake. Usamos Python SDK
     con encoding='utf-8' explicito.
  2. Las otras 6 views del cobranzas_bike.sql (dim_intercompany, v_deuda_facturas_detalle,
     dim_bancos, v_pagos_recibidos, v_depositos, v_provincia_cliente) ya estan OK;
     redeployarlas sin intencion genera ruido de auditoria sin valor.

Fase 2 del fix "VENCIDO_SIN_DEPOSITAR falso en cheques fisicos" (2026-11-16).
Informe Fase 1: Desktop\\RESPUESTAS\\CHEQUES_VENCIDO_SIN_DEPOSITAR_2026-11-16\\DIAGNOSTICO.md.

Env vars requeridas:
  FIREBASE_SA_PATH   (o GOOGLE_APPLICATION_CREDENTIALS, o ADC)

Uso:
  python bigquery/deploy_v_cheques_recibidos.py [--dry-run]

Salidas:
  Exit 0  OK.
  Exit 2  Env vars / credenciales mal.
  Exit 3  BQ query fallo.
"""
import json
import os
import sys
from pathlib import Path

try:
    from google.cloud import bigquery
    from google.oauth2 import service_account
except ImportError:
    print('[ERROR] google-cloud-bigquery no instalado. pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(2)


BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'

VIEW_SQL = r"""
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_cheques_recibidos` AS
SELECT
  ch.payment_doc_entry,
  ch.payment_doc_date,
  ch.payment_card_code,
  ch.line_num,
  ch.check_number,
  ch.check_abs_entry,
  ch.due_date,
  SAFE_CAST(ch.check_sum AS FLOAT64) AS check_sum,
  ch.currency,
  CAST(ch.bank_code AS STRING) AS bank_code,
  ch.branch,
  ch.accountt_num,
  ch.check_account,
  ch.country_code,
  ch.e_check,
  ch.trnsfrable,
  ch.manual_check,
  ch.endorse,
  ch.originally_issued_by,
  ch.fiscal_id,
  ch._sync_timestamp,
  p.u_estado,
  CAST(NULL AS INT64) AS deposit_abs_entry,
  CAST(NULL AS DATE)  AS deposit_date,
  CASE
    WHEN ch.e_check = 'tYES' AND p.u_estado = 'RECHAZADO' THEN 'RECHAZADO'
    WHEN ch.e_check = 'tYES' AND ch.due_date <= CURRENT_DATE('America/Argentina/Buenos_Aires') THEN 'ACREDITADO'
    WHEN ch.e_check = 'tYES' AND ch.due_date >  CURRENT_DATE('America/Argentina/Buenos_Aires') THEN 'PENDIENTE_ACREDITACION'
    WHEN ch.e_check = 'tNO'  AND p.u_estado = 'COBRADO'   THEN 'DEPOSITADO'
    WHEN ch.e_check = 'tNO'  AND p.u_estado = 'RECHAZADO' THEN 'RECHAZADO'
    WHEN ch.e_check = 'tNO'  AND ch.due_date <  CURRENT_DATE('America/Argentina/Buenos_Aires') THEN 'VENCIDO_SIN_DEPOSITAR'
    ELSE 'EN_CARTERA'
  END AS estado_cheque,
  DATE_DIFF(ch.due_date, CURRENT_DATE('America/Argentina/Buenos_Aires'), DAY) AS dias_hasta_vencimiento,
  CASE WHEN ch.e_check = 'tYES' THEN 'ECHEQ' ELSE 'FISICO' END AS tipo_cheque,
  CASE
    WHEN ch.due_date < CURRENT_DATE('America/Argentina/Buenos_Aires') THEN '0. Ya vencio/acreditado'
    WHEN DATE_DIFF(ch.due_date, CURRENT_DATE('America/Argentina/Buenos_Aires'), DAY) <= 7 THEN '1. Vence esta semana'
    WHEN DATE_DIFF(ch.due_date, CURRENT_DATE('America/Argentina/Buenos_Aires'), DAY) <= 30 THEN '2. Vence 8-30d'
    WHEN DATE_DIFF(ch.due_date, CURRENT_DATE('America/Argentina/Buenos_Aires'), DAY) <= 60 THEN '3. Vence 31-60d'
    WHEN DATE_DIFF(ch.due_date, CURRENT_DATE('America/Argentina/Buenos_Aires'), DAY) <= 90 THEN '4. Vence 61-90d'
    ELSE '5. Vence +90d'
  END AS bucket_vencimiento
FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw` ch
LEFT JOIN `app-vendedores-shimano.shimano_app.sap_incoming_payments_raw` p
  ON p.doc_entry = ch.payment_doc_entry;
"""


def resolve_credentials():
    """Devuelve creds explicit si FIREBASE_SA_PATH/GAC; sino None para ADC."""
    for env_name in ('FIREBASE_SA_PATH', 'GOOGLE_APPLICATION_CREDENTIALS'):
        sa_path = os.environ.get(env_name)
        if sa_path:
            p = Path(sa_path)
            if not p.exists():
                print(f'[FATAL] {env_name}={sa_path} no existe.', file=sys.stderr)
                sys.exit(2)
            with open(p, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return service_account.Credentials.from_service_account_info(data)
    return None  # Application Default Credentials


def main():
    dry_run = '--dry-run' in sys.argv
    creds = resolve_credentials()
    client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

    print(f'[deploy] project={BQ_PROJECT} location={BQ_LOCATION} dry_run={dry_run}')
    print(f'[deploy] view=app-vendedores-shimano.shimano_app.v_cheques_recibidos')

    job_config = bigquery.QueryJobConfig(dry_run=dry_run, use_query_cache=False)
    try:
        job = client.query(VIEW_SQL, job_config=job_config)
        if dry_run:
            print(f'[dry-run] OK. Bytes processed: {job.total_bytes_processed}')
        else:
            job.result()
            print(f'[deploy] OK -- job_id={job.job_id}')
    except Exception as e:
        print(f'[FATAL] BQ query fallo: {e}', file=sys.stderr)
        sys.exit(3)

    # Smoke queries post-deploy (solo si no es dry-run).
    if not dry_run:
        print('\n[verify] smoke queries post-deploy...')
        smoke_queries = [
            (
                'Estado de los 3 cheques fisicos (debe ser DEPOSITADO)',
                """SELECT check_abs_entry, check_number, payment_card_code, due_date, check_sum,
                          estado_cheque, u_estado
                   FROM `app-vendedores-shimano.shimano_app.v_cheques_recibidos`
                   WHERE e_check='tNO'
                   ORDER BY check_abs_entry DESC""",
            ),
            (
                'Distribucion estados post-fix',
                """SELECT tipo_cheque, estado_cheque, COUNT(*) AS n
                   FROM `app-vendedores-shimano.shimano_app.v_cheques_recibidos`
                   GROUP BY 1,2
                   ORDER BY tipo_cheque, n DESC""",
            ),
            (
                'VENCIDO_SIN_DEPOSITAR residual (deberia ser 0 fisicos y 0 echeqs)',
                """SELECT tipo_cheque, COUNT(*) AS n
                   FROM `app-vendedores-shimano.shimano_app.v_cheques_recibidos`
                   WHERE estado_cheque='VENCIDO_SIN_DEPOSITAR'
                   GROUP BY tipo_cheque""",
            ),
        ]
        for title, sql in smoke_queries:
            print(f'\n  >>> {title}')
            try:
                for row in client.query(sql).result():
                    print(f'    {dict(row)}')
            except Exception as e:
                print(f'    [ERROR] {e}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
