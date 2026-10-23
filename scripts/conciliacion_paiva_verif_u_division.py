"""Verificacion u_division cliente vs COGSCostingCode3 renglon — 2026.
Mariano quiere confirmar que '1' = BIKE antes de que la vista lo use."""
from google.cloud import bigquery
c = bigquery.Client(project='app-vendedores-shimano', location='southamerica-east1')

print('=' * 72)
print('TABLA CRUZADA: u_division cliente vs COGSCostingCode3 renglon (2026)')
print('=' * 72)
q = '''
WITH invoices_and_cns AS (
  SELECT *, 1 AS sign FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw`
  UNION ALL
  SELECT *, -1 AS sign FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw`
),
sum_lines_per_doc AS (
  SELECT doc_entry, series,
    SUM(SAFE_CAST(JSON_VALUE(ln, '$.LineTotal') AS FLOAT64)) AS suma
  FROM invoices_and_cns, UNNEST(JSON_EXTRACT_ARRAY(lines_json)) ln
  GROUP BY doc_entry, series
),
lines AS (
  SELECT
    COALESCE(NULLIF(bp.u_division, ''), '(vacio)') AS u_div,
    COALESCE(JSON_VALUE(l, '$.COGSCostingCode3'), '(null)') AS cogs3,
    SAFE_CAST(JSON_VALUE(l, '$.LineTotal') AS FLOAT64)
      * (1 - SAFE_DIVIDE(COALESCE(inv.total_discount, 0), NULLIF(slp.suma, 0)))
      * inv.sign AS venta_neta_ars
  FROM invoices_and_cns inv,
  UNNEST(JSON_EXTRACT_ARRAY(inv.lines_json)) l
  LEFT JOIN `app-vendedores-shimano.shimano_app.sap_bp_raw` bp
    ON bp.card_code = inv.card_code
  LEFT JOIN sum_lines_per_doc slp
    ON slp.doc_entry = inv.doc_entry
  WHERE inv.cancelled = 'tNO'
    AND EXTRACT(YEAR FROM inv.doc_date) = 2026
)
SELECT u_div, cogs3,
  COUNT(*) AS lineas,
  ROUND(SUM(venta_neta_ars), 2) AS venta_neta_sum
FROM lines
GROUP BY u_div, cogs3
ORDER BY u_div, lineas DESC
'''

print(f'{"u_div":10s}  {"cogs3":10s}  {"lineas":>10s}  {"venta_neta_ars":>20s}')
print('-' * 72)
by_div = {}
for r in c.query(q).result():
    print(f'{r.u_div:10s}  {r.cogs3:10s}  {r.lineas:>10,}  {(r.venta_neta_sum or 0):>20,.2f}')
    by_div.setdefault(r.u_div, []).append((r.cogs3, r.lineas, r.venta_neta_sum or 0))

print()
print('=' * 72)
print('RESUMEN por u_division (totales 2026)')
print('=' * 72)
for div, items in sorted(by_div.items()):
    total_lineas = sum(x[1] for x in items)
    total_venta = sum(x[2] for x in items)
    bik = next((x for x in items if x[0] == 'BIK'), None)
    pes = next((x for x in items if x[0] == 'PES'), None)
    print(f'u_div={div}  lineas_total={total_lineas:>8,}  venta_total=${total_venta:>18,.2f}')
    if bik:
        pct = 100 * bik[2] / total_venta if total_venta else 0
        print(f'  BIK: {bik[1]:>7,} lineas  ${bik[2]:>15,.2f}  ({pct:.1f}% del venta_div)')
    if pes:
        pct = 100 * pes[2] / total_venta if total_venta else 0
        print(f'  PES: {pes[1]:>7,} lineas  ${pes[2]:>15,.2f}  ({pct:.1f}% del venta_div)')

print()
print('=' * 72)
print('Los 4 clientes u_division = "3" (BIKE & PESCA)')
print('=' * 72)
q2 = '''
SELECT card_code, card_name, state, group_code
FROM `app-vendedores-shimano.shimano_app.sap_bp_raw`
WHERE u_division = '3'
ORDER BY card_code
'''
for r in c.query(q2).result():
    print(f'  {r.card_code}  {r.card_name}  (state={r.state}, group={r.group_code})')
