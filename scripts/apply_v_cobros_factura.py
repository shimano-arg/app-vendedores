"""Aplica v_cobros_factura (v1553, 2026-11-05) para habilitar DSO literal en PBI.

Vista nueva: fecha de cobro LITERAL por factura (OINV), calculada FIFO desde
sap_incoming_payment_invoices_raw (RCT2 - lineas que aplican un pago ORCT a una
factura especifica).

Regla de fecha_cobro (Opcion A, confirmada por Mariano):
  fecha_cobro = ORCT.DocDate del pago cuyo acumulado FIFO cubre >= doc_total * 0.9999.
  Facturas con saldo > 0 -> fecha_cobro = NULL (no cobradas).

Pre-requisito:
  1. Correr `python scripts/sync_sap_to_bigquery.py` al menos una vez despues del
     v1553 para poblar la nueva tabla sap_incoming_payment_invoices_raw. El sync
     agrega PaymentInvoices al bloque COBRANZAS-B (per-doc, ~6k pagos * ~8 workers
     = ~3-6 min adicionales).

Validaciones post-deploy:
  a. La tabla raw sap_incoming_payment_invoices_raw existe y tiene datos.
  b. Conteo de facturas 12m: con fecha_cobro vs sin fecha_cobro.
  c. Avg/median de dias_cobro contra dias_vencido de las facturas cobradas (cruce).
  d. Sample de 5 facturas cobradas con el detalle de pagos (ordenados).
  e. Schema final de la vista.

Credenciales: SA key en Desktop\\sa-key.json O ADC. Mismo patron que apply_v_pedidos_lines.py.
"""
import json
import re
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'

_SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if _SA_KEY.exists():
    sa = json.loads(_SA_KEY.read_text())
    creds = service_account.Credentials.from_service_account_info(sa)
    client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)
    print(f'[auth] usando SA key {_SA_KEY}')
else:
    client = bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)
    print('[auth] usando Application Default Credentials')

TBL = 'app-vendedores-shimano.shimano_app'

# --------------------------------------------------------------
# Pre-requisito: tabla raw poblada.
# --------------------------------------------------------------
print('=' * 70)
print('PRE-REQUISITO: tabla sap_incoming_payment_invoices_raw poblada')
print('=' * 70)
try:
    pre = list(client.query(f'''
      SELECT COUNT(*) AS n_rows,
             COUNT(DISTINCT invoice_doc_entry) AS n_facturas_distintas,
             MIN(payment_doc_date) AS pay_desde,
             MAX(payment_doc_date) AS pay_hasta
      FROM `{TBL}.sap_incoming_payment_invoices_raw`
    ''').result())[0]
except Exception as e:
    print(f'  FAIL tabla no existe o no tiene datos: {e}')
    print()
    print('  SOLUCION: correr `python scripts/sync_sap_to_bigquery.py` para que el')
    print('           bloque COBRANZAS-B pueble la nueva tabla PaymentInvoices.')
    raise SystemExit(1)

if pre.n_rows == 0:
    print('  FAIL tabla existe pero esta vacia')
    print('  SOLUCION: correr `python scripts/sync_sap_to_bigquery.py` primero.')
    raise SystemExit(1)

print(f'  n_rows={pre.n_rows}   n_facturas_distintas={pre.n_facturas_distintas}')
print(f'  payments entre: {pre.pay_desde} .. {pre.pay_hasta}')
print('  OK')
print()

# --------------------------------------------------------------
# Deploy de la vista.
# --------------------------------------------------------------
VIEWS = (Path(__file__).resolve().parent.parent / 'bigquery' / 'views.sql').read_text(encoding='utf-8')

# Marker regex unico de v_cobros_factura: el bloque CREATE OR REPLACE VIEW
# ... termina con `AND f.doc_total > 0;` que solo aparece en esta vista en
# todo views.sql (verificado con grep).
m = re.search(
    r"(CREATE OR REPLACE VIEW `[^`]+\.v_cobros_factura` AS[\s\S]+?AND f\.doc_total > 0;)",
    VIEWS,
)
if not m:
    raise SystemExit('No encontre v_cobros_factura en views.sql (marker regex no matcheo)')

print('[EXEC] CREATE OR REPLACE v_cobros_factura...')
client.query(m.group(1), location=BQ_LOCATION).result()
print('  OK\n')

# --------------------------------------------------------------
# Validacion b) Conteos: con fecha_cobro vs sin
# --------------------------------------------------------------
print('=' * 70)
print('b) Cobertura 12m: facturas con fecha_cobro no null vs con saldo')
print('=' * 70)
r = list(client.query(f'''
  SELECT
    COUNT(*)                                    AS total_facturas_12m,
    COUNTIF(fecha_cobro IS NOT NULL)            AS con_fecha_cobro,
    COUNTIF(fecha_cobro IS NULL AND saldo_ars > 0) AS sin_cobro_con_saldo,
    COUNTIF(fecha_cobro IS NULL AND saldo_ars <= 1) AS sin_cobro_saldo_0_sin_rct2,
    ROUND(SAFE_DIVIDE(COUNTIF(fecha_cobro IS NOT NULL), COUNT(*)) * 100, 2)
                                                AS pct_cobradas_literal
  FROM `{TBL}.v_cobros_factura`
  WHERE doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
''').result())[0]
print(f'  total_facturas_12m:         {r.total_facturas_12m}')
print(f'  con_fecha_cobro:            {r.con_fecha_cobro}   ({r.pct_cobradas_literal}%)')
print(f'  sin_cobro_con_saldo (vivas): {r.sin_cobro_con_saldo}')
print(f'  sin_cobro_saldo_0_sin_rct2: {r.sin_cobro_saldo_0_sin_rct2}')
if r.sin_cobro_saldo_0_sin_rct2 > 0:
    print(f'  WARN hay {r.sin_cobro_saldo_0_sin_rct2} facturas con saldo 0 pero sin aplicacion RCT2.')
    print(f'       Puede ser facturas antiguas cobradas antes del arranque del sync (12m).')

print()

# --------------------------------------------------------------
# Validacion c) KPI dias_cobro + cross-check dias_vencido
# --------------------------------------------------------------
print('=' * 70)
print('c) KPI DSO literal: promedio/mediana de dias_cobro (facturas cobradas 12m)')
print('=' * 70)
r = list(client.query(f'''
  SELECT
    COUNT(*)                                AS n_cobradas,
    ROUND(AVG(dias_cobro), 2)               AS dias_cobro_avg,
    APPROX_QUANTILES(dias_cobro, 2)[OFFSET(1)] AS dias_cobro_mediana,
    APPROX_QUANTILES(dias_cobro, 100)[OFFSET(10)] AS dias_cobro_p10,
    APPROX_QUANTILES(dias_cobro, 100)[OFFSET(90)] AS dias_cobro_p90,
    MIN(dias_cobro)                         AS dias_cobro_min,
    MAX(dias_cobro)                         AS dias_cobro_max,
    COUNTIF(dias_cobro < 0)                 AS cobros_antes_emision_bug
  FROM `{TBL}.v_cobros_factura`
  WHERE fecha_cobro IS NOT NULL
    AND doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
''').result())[0]
print(f'  n_cobradas:                 {r.n_cobradas}')
print(f'  dias_cobro avg:             {r.dias_cobro_avg}')
print(f'  dias_cobro mediana:         {r.dias_cobro_mediana}')
print(f'  dias_cobro p10 - p90:       {r.dias_cobro_p10} - {r.dias_cobro_p90}')
print(f'  dias_cobro min - max:       {r.dias_cobro_min} - {r.dias_cobro_max}')
if r.cobros_antes_emision_bug > 0:
    print(f'  WARN {r.cobros_antes_emision_bug} facturas con dias_cobro < 0 (pago aplicado')
    print(f'       antes de emision — anticipos. Esperado para cuentas de clientes a cuenta).')

print()

# --------------------------------------------------------------
# Validacion d) Breakdown Pesca vs Bike + por vendedor
# --------------------------------------------------------------
print('=' * 70)
print('d) DSO literal — Pesca vs Bike (facturas cobradas 12m)')
print('=' * 70)
rows = list(client.query(f'''
  SELECT
    CASE WHEN is_pesca THEN 'PESCA' ELSE 'BIKE' END AS vertical,
    COUNT(*)                                AS n_cobradas,
    ROUND(AVG(dias_cobro), 1)               AS dias_cobro_avg,
    APPROX_QUANTILES(dias_cobro, 2)[OFFSET(1)] AS dias_cobro_mediana
  FROM `{TBL}.v_cobros_factura`
  WHERE fecha_cobro IS NOT NULL
    AND doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
  GROUP BY vertical
  ORDER BY vertical
''').result())
for row in rows:
    d = dict(row.items())
    print(f'  {d["vertical"]:8s} n={d["n_cobradas"]:>5}  avg={d["dias_cobro_avg"]:>6}  median={d["dias_cobro_mediana"]:>4}')

print()
print('=' * 70)
print('d2) DSO literal — top 10 vendedores por volumen (facturas cobradas 12m)')
print('=' * 70)
rows = list(client.query(f'''
  SELECT
    COALESCE(vendor, '(sin vendedor)')      AS vendor,
    COUNT(*)                                AS n_cobradas,
    ROUND(SUM(doc_total_ars), 0)            AS facturado_ars,
    ROUND(AVG(dias_cobro), 1)               AS dias_cobro_avg,
    APPROX_QUANTILES(dias_cobro, 2)[OFFSET(1)] AS dias_cobro_mediana
  FROM `{TBL}.v_cobros_factura`
  WHERE fecha_cobro IS NOT NULL
    AND doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
    AND is_pesca
  GROUP BY vendor
  ORDER BY facturado_ars DESC
  LIMIT 10
''').result())
print(f'  {"Vendedor":<30} {"N":>5}  {"Facturado":>15}  {"DSO avg":>8}  {"Mediana":>7}')
for row in rows:
    d = dict(row.items())
    print(f'  {d["vendor"]:<30} {d["n_cobradas"]:>5}  ${d["facturado_ars"]:>13,.0f}  {d["dias_cobro_avg"]:>8}  {d["dias_cobro_mediana"]:>7}')

print()

# --------------------------------------------------------------
# e) Sample de 5 facturas cobradas con historial de pagos (para validar la regla)
# --------------------------------------------------------------
print('=' * 70)
print('e) SAMPLE 5 facturas cobradas — ver historial de pagos aplicados (regla A)')
print('=' * 70)
samples = list(client.query(f'''
  WITH cob AS (
    SELECT doc_entry, doc_num, doc_date, card_code, card_name,
           vendor, is_pesca, doc_total_ars, fecha_cobro, dias_cobro
    FROM `{TBL}.v_cobros_factura`
    WHERE fecha_cobro IS NOT NULL
      AND doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
      AND doc_total_ars > 500000
      AND is_pesca
    ORDER BY RAND()
    LIMIT 5
  )
  SELECT
    cob.*,
    ARRAY_AGG(STRUCT(
      pi.payment_doc_entry,
      pi.payment_doc_date,
      ROUND(pi.sum_applied, 2) AS sum_applied
    ) ORDER BY pi.payment_doc_date ASC, pi.payment_doc_entry ASC) AS pagos_aplicados
  FROM cob
  LEFT JOIN `{TBL}.sap_incoming_payment_invoices_raw` pi
    ON pi.invoice_doc_entry = cob.doc_entry
   AND pi.invoice_type = 'it_Invoice'
   AND (pi.payment_cancelled IS NULL OR pi.payment_cancelled != 'tYES')
  GROUP BY cob.doc_entry, cob.doc_num, cob.doc_date, cob.card_code, cob.card_name,
           cob.vendor, cob.is_pesca, cob.doc_total_ars, cob.fecha_cobro, cob.dias_cobro
''').result())
for s in samples:
    print()
    print(f'  Factura OINV {s.doc_num} (doc_entry {s.doc_entry})')
    print(f'    Cliente: {s.card_name} ({s.card_code})')
    print(f'    Vendedor: {s.vendor}')
    print(f'    Emision: {s.doc_date}   |   doc_total ARS: ${s.doc_total_ars:,.2f}')
    print(f'    Fecha cobro (regla A): {s.fecha_cobro}   |   dias_cobro: {s.dias_cobro}')
    print(f'    Pagos aplicados:')
    cum = 0.0
    for p in s.pagos_aplicados:
        cum += (p['sum_applied'] or 0)
        cover = ' <-- cierra' if cum >= s.doc_total_ars * 0.9999 and (cum - (p['sum_applied'] or 0)) < s.doc_total_ars * 0.9999 else ''
        print(f'      ORCT #{p["payment_doc_entry"]:>6}  {p["payment_doc_date"]}  ${p["sum_applied"]:>13,.2f}  (acumulado ${cum:>13,.2f}){cover}')

print()

# --------------------------------------------------------------
# f) Schema final
# --------------------------------------------------------------
print('=' * 70)
print('f) SCHEMA v_cobros_factura')
print('=' * 70)
t = client.get_table(f'{TBL}.v_cobros_factura')
for f in t.schema:
    print(f'  {f.name:25s}  {f.field_type:12s}  mode={f.mode}')

print()
print('DONE')
