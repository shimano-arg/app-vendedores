"""Aplica v_rentabilidad_pesca (Fase 2, 2026-11-05) para el TABLERO SAR pesca.

Vista nueva: margen bruto por operacion/cliente/SKU con mismo criterio de finanzas
que v_rentabilidad_bike (universo por cliente u_division='2', costo_finanzas_ars
desde costo_snapshot_semanal con logica mes cerrado/abierto, descuento prorrateado).

Confirmaciones Mariano (Fase 1 §11.1):
  * Arquitectura Opcion B: archivo nuevo, NO toca v_rentabilidad_bike.
  * sub_subfamilia <- sap_items_raw.cat
  * Expone ciclo_producto + pesca_categoria
  * Columnas bike-only ELIMINADAS (no NULL): costo_prom_ars, costo_prom_usd, costo_paiva_ars_sep2026.
  * Clientes u_division='3' EXCLUIDOS (FOLCA + GOMAR salen).
  * Costo = AvgPrice SL, NO reconciliado con finanzas (Juan no hace informe pesca).

Pre-requisito:
  La tabla costo_snapshot_semanal debe tener oitm_avg_price_sl_<YYYYMMDD> con pesca
  (items_group_code = 102). El job del lunes (scripts/snapshot_avgprice_sl.py) ya lo
  pobla. Verificado 2026-11-05: 604 items pesca en oitm_avg_price_sl_20261102.

Validaciones post-deploy:
  a. Grano unico (doc_entry, doc_kind, line_num): COUNT(*) == COUNT DISTINCT tupla.
  b. Totales por mes 2026: lineas, docs, venta_neta, costo_doc, costo_finanzas, cobertura.
  c. Baseline v_rentabilidad_bike pre vs post (0 diferencia esperada, Opcion B no toca bike).
  d. Cruce oct 2026 con snapshot cierre: pct cobertura esperado ~100%.
  e. 3 samples pesca octubre con detalle linea (doc_num, cliente, item, venta_neta, costo_finanzas).
  f. Schema final.

Credenciales: SA key en Desktop\\sa-key.json O ADC (bot.shimano.pesca). Mismo
patron que apply_v_cobros_factura.py.
"""
import json
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
TBL = f'{BQ_PROJECT}.shimano_app'

_SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if _SA_KEY.exists():
    sa = json.loads(_SA_KEY.read_text())
    creds = service_account.Credentials.from_service_account_info(sa)
    client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)
    print(f'[auth] usando SA key {_SA_KEY}')
else:
    client = bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)
    print('[auth] usando Application Default Credentials')

# --------------------------------------------------------------
# PRE-REQUISITO: snapshot pesca oct 2026 existe.
# --------------------------------------------------------------
print('=' * 70)
print('PRE-REQUISITO: snapshot pesca cierre octubre 2026')
print('=' * 70)
r = list(client.query(f'''
  SELECT cost_source, snapshot_week_start,
         COUNT(DISTINCT css.item_code) AS n_items_pesca
  FROM `{TBL}.costo_snapshot_semanal` css
  JOIN `{TBL}.sap_items_raw` it
    ON it.item_code = css.item_code AND it.items_group_code = 102
  WHERE css.cost_source LIKE 'oitm_avg_price_sl_%'
    AND css.snapshot_week_start = '2026-11-02'
  GROUP BY cost_source, snapshot_week_start
''').result())
if not r or r[0].n_items_pesca == 0:
    print('  FAIL snapshot oitm_avg_price_sl_20261102 no tiene items pesca.')
    print('  SOLUCION: correr scripts/snapshot_avgprice_sl.py o el workflow GHA.')
    raise SystemExit(1)
print(f'  OK cost_source={r[0].cost_source} snapshot_week_start={r[0].snapshot_week_start} items_pesca={r[0].n_items_pesca}')
print()

# --------------------------------------------------------------
# BASELINE bike pre-deploy (Opcion B no toca bike, pero validamos por disciplina).
# --------------------------------------------------------------
print('=' * 70)
print('BASELINE pre-deploy v_rentabilidad_bike 2026 (hash por mes)')
print('=' * 70)
baseline_bike = list(client.query(f'''
  SELECT
    anio_contable, mes_contable,
    COUNT(*)                                                                                     AS n_lineas,
    COUNT(DISTINCT doc_entry)                                                                    AS n_docs,
    ROUND(SUM(venta_neta_ars), 2)                                                                AS sum_venta_neta_ars,
    ROUND(SUM(costo_doc_ars), 2)                                                                 AS sum_costo_doc_ars,
    ROUND(SUM(costo_finanzas_ars), 2)                                                            AS sum_costo_finanzas_ars
  FROM `{TBL}.v_rentabilidad_bike`
  WHERE anio_contable = 2026
  GROUP BY anio_contable, mes_contable
  ORDER BY mes_contable
''').result())
baseline_dict = {(r.anio_contable, r.mes_contable): r for r in baseline_bike}
for r in baseline_bike:
    print(f'  {r.anio_contable}-{r.mes_contable:02d}  lineas={r.n_lineas:>5}  docs={r.n_docs:>4}  '
          f'venta_neta={r.sum_venta_neta_ars:>18,.2f}  costo_fin={str(r.sum_costo_finanzas_ars):>18}')
print()

# --------------------------------------------------------------
# DEPLOY: CREATE OR REPLACE VIEW desde archivo.
# --------------------------------------------------------------
print('=' * 70)
print('DEPLOY v_rentabilidad_pesca')
print('=' * 70)
sql_path = Path(__file__).resolve().parent.parent / 'bigquery' / 'views' / 'v_rentabilidad_pesca.sql'
sql_body = sql_path.read_text(encoding='utf-8').rstrip().rstrip(';')
sql = f'CREATE OR REPLACE VIEW `{TBL}.v_rentabilidad_pesca` AS\n{sql_body}'
print(f'[EXEC] CREATE OR REPLACE v_rentabilidad_pesca ({len(sql)} chars, source: {sql_path.name})...')
client.query(sql, location=BQ_LOCATION).result()
print('  OK\n')

# --------------------------------------------------------------
# a) GRANO UNICO
# --------------------------------------------------------------
print('=' * 70)
print('a) Grano unico: (doc_entry, doc_kind, line_num)')
print('=' * 70)
r = list(client.query(f'''
  SELECT
    COUNT(*)                                                                              AS n_lineas,
    COUNT(DISTINCT CONCAT(CAST(doc_entry AS STRING), '|', doc_kind, '|', CAST(line_num AS STRING))) AS n_grano
  FROM `{TBL}.v_rentabilidad_pesca`
''').result())[0]
status = 'OK' if r.n_lineas == r.n_grano else 'FAIL'
print(f'  lineas={r.n_lineas:>6}  grano_distinct={r.n_grano:>6}  diff={r.n_lineas - r.n_grano}  [{status}]')
print()

# --------------------------------------------------------------
# b) TOTALES POR MES 2026
# --------------------------------------------------------------
print('=' * 70)
print('b) Totales por mes 2026 (v_rentabilidad_pesca)')
print('=' * 70)
rows = list(client.query(f'''
  SELECT
    anio_contable, mes_contable,
    COUNT(*)                                                                                     AS n_lineas,
    COUNT(DISTINCT doc_entry)                                                                    AS n_docs,
    ROUND(SUM(venta_neta_ars), 2)                                                                AS sum_venta_neta_ars,
    ROUND(SUM(costo_doc_ars), 2)                                                                 AS sum_costo_doc_ars,
    ROUND(SUM(costo_finanzas_ars), 2)                                                            AS sum_costo_finanzas_ars,
    COUNTIF(costo_finanzas_ars IS NULL)                                                          AS n_sin_costo_fin,
    ROUND(SAFE_DIVIDE(COUNTIF(costo_finanzas_ars IS NOT NULL), COUNT(*)) * 100, 2)               AS cobertura_pct
  FROM `{TBL}.v_rentabilidad_pesca`
  WHERE anio_contable = 2026
  GROUP BY anio_contable, mes_contable
  ORDER BY mes_contable
''').result())
if not rows:
    print('  (sin filas 2026)')
else:
    print(f'  {"Mes":<8} {"Lineas":>7} {"Docs":>5} {"Venta neta ARS":>20} {"Costo doc ARS":>18} {"Costo fin ARS":>20} {"Sin cost":>8} {"Cob%":>6}')
    for r in rows:
        venta = r.sum_venta_neta_ars if r.sum_venta_neta_ars is not None else 0
        c_doc = r.sum_costo_doc_ars if r.sum_costo_doc_ars is not None else 0
        c_fin = r.sum_costo_finanzas_ars
        print(f'  {r.anio_contable}-{r.mes_contable:02d}  {r.n_lineas:>7}  {r.n_docs:>5}  '
              f'{venta:>20,.2f}  {c_doc:>18,.2f}  {str(c_fin):>20}  {r.n_sin_costo_fin:>8}  {r.cobertura_pct:>5}%')
print()

# --------------------------------------------------------------
# c) BIKE POST-DEPLOY (verificar 0 diferencia)
# --------------------------------------------------------------
print('=' * 70)
print('c) Post-deploy: v_rentabilidad_bike debe seguir identica al baseline')
print('=' * 70)
post_bike = list(client.query(f'''
  SELECT
    anio_contable, mes_contable,
    COUNT(*)                                                                                     AS n_lineas,
    COUNT(DISTINCT doc_entry)                                                                    AS n_docs,
    ROUND(SUM(venta_neta_ars), 2)                                                                AS sum_venta_neta_ars,
    ROUND(SUM(costo_doc_ars), 2)                                                                 AS sum_costo_doc_ars,
    ROUND(SUM(costo_finanzas_ars), 2)                                                            AS sum_costo_finanzas_ars
  FROM `{TBL}.v_rentabilidad_bike`
  WHERE anio_contable = 2026
  GROUP BY anio_contable, mes_contable
  ORDER BY mes_contable
''').result())
diffs = []
for r in post_bike:
    k = (r.anio_contable, r.mes_contable)
    b = baseline_dict.get(k)
    if b is None:
        diffs.append(f'{k}: mes nuevo en post, no estaba en baseline')
        continue
    for field in ('n_lineas', 'n_docs', 'sum_venta_neta_ars', 'sum_costo_doc_ars', 'sum_costo_finanzas_ars'):
        v_pre = getattr(b, field)
        v_post = getattr(r, field)
        if v_pre != v_post:
            diffs.append(f'{k}.{field}: pre={v_pre} post={v_post}')
if diffs:
    print(f'  FAIL {len(diffs)} diferencias:')
    for d in diffs:
        print(f'    - {d}')
    raise SystemExit(2)
print(f'  OK {len(post_bike)} meses sin diferencias (bike intacto)')
print()

# --------------------------------------------------------------
# d) CRUCE OCT 2026 PESCA con snapshot cierre (cobertura esperada ~100%)
# --------------------------------------------------------------
print('=' * 70)
print('d) Cruce octubre 2026 pesca contra snapshot oitm_avg_price_sl_20261102')
print('=' * 70)
r = list(client.query(f'''
  SELECT
    COUNT(*)                                                           AS n_lineas,
    COUNTIF(costo_finanzas_cierre = TRUE)                              AS n_cierre_true,
    COUNTIF(costo_finanzas_cierre = FALSE)                             AS n_cierre_false,
    COUNTIF(costo_finanzas_cierre IS NULL)                             AS n_cierre_null,
    COUNT(DISTINCT CASE WHEN costo_finanzas_fuente IS NOT NULL
                        THEN costo_finanzas_fuente END)                AS n_fuentes_distintas,
    ARRAY_AGG(DISTINCT costo_finanzas_fuente IGNORE NULLS LIMIT 3)     AS fuentes,
    ROUND(SUM(venta_neta_ars), 2)                                      AS venta_neta_ars,
    ROUND(SUM(costo_finanzas_ars), 2)                                  AS costo_finanzas_ars,
    ROUND(SUM(venta_neta_ars) - SUM(costo_finanzas_ars), 2)            AS margen_bruto_ars,
    ROUND(SAFE_DIVIDE(SUM(venta_neta_ars) - SUM(costo_finanzas_ars),
                      SUM(venta_neta_ars)) * 100, 2)                   AS margen_pct_sobre_neta
  FROM `{TBL}.v_rentabilidad_pesca`
  WHERE anio_contable = 2026 AND mes_contable = 10
''').result())[0]
print(f'  lineas={r.n_lineas}')
print(f'  cierre_TRUE={r.n_cierre_true}  cierre_FALSE={r.n_cierre_false}  cierre_NULL={r.n_cierre_null}')
print(f'  fuentes={list(r.fuentes)}')
print(f'  venta_neta_ars        {r.venta_neta_ars:,.2f}')
print(f'  costo_finanzas_ars    {r.costo_finanzas_ars:,.2f}')
print(f'  margen_bruto_ars      {r.margen_bruto_ars:,.2f}')
print(f'  margen % sobre neta   {r.margen_pct_sobre_neta}%')
print()

# --------------------------------------------------------------
# e) 3 SAMPLES PESCA OCTUBRE (azar)
# --------------------------------------------------------------
print('=' * 70)
print('e) 3 samples pesca octubre al azar — detalle linea')
print('=' * 70)
samples = list(client.query(f'''
  SELECT
    doc_num, doc_entry, line_num, doc_kind,
    doc_date, card_code, card_name,
    item_code, cantidad,
    ROUND(venta_bruta_ars, 2) AS venta_bruta_ars,
    ROUND(dcto_cabecera_prorrateado_ars, 2) AS dcto_cab_ars,
    ROUND(venta_neta_ars, 2) AS venta_neta_ars,
    ROUND(costo_doc_ars, 2) AS costo_doc_ars,
    ROUND(costo_finanzas_ars, 2) AS costo_finanzas_ars,
    costo_finanzas_fuente, costo_finanzas_cierre,
    familia, subfamilia, sub_subfamilia, ciclo_producto
  FROM `{TBL}.v_rentabilidad_pesca`
  WHERE anio_contable = 2026 AND mes_contable = 10 AND doc_kind = 'FACTURA'
  ORDER BY RAND()
  LIMIT 3
''').result())
for s in samples:
    print()
    print(f'  Doc {s.doc_kind} {s.doc_num} (doc_entry {s.doc_entry}, line_num {s.line_num})')
    print(f'    Cliente: {s.card_name} ({s.card_code})')
    print(f'    Fecha:   {s.doc_date}')
    print(f'    Item:    {s.item_code}  cantidad={s.cantidad}')
    print(f'    Familia/Subfamilia/Sub: {s.familia} / {s.subfamilia} / {s.sub_subfamilia}  Ciclo: {s.ciclo_producto}')
    print(f'    Venta bruta:    ${s.venta_bruta_ars:>14,.2f}')
    print(f'    Dcto cabecera:  ${s.dcto_cab_ars:>14,.2f}')
    print(f'    Venta neta:     ${s.venta_neta_ars:>14,.2f}')
    print(f'    Costo doc:      ${s.costo_doc_ars:>14,.2f}')
    print(f'    Costo finanzas: ${s.costo_finanzas_ars:>14,.2f}  (fuente: {s.costo_finanzas_fuente}, cierre: {s.costo_finanzas_cierre})')
    margen = (s.venta_neta_ars or 0) - (s.costo_finanzas_ars or 0)
    print(f'    Margen bruto:   ${margen:>14,.2f}')
print()

# --------------------------------------------------------------
# f) SCHEMA FINAL
# --------------------------------------------------------------
print('=' * 70)
print('f) SCHEMA v_rentabilidad_pesca')
print('=' * 70)
t = client.get_table(f'{TBL}.v_rentabilidad_pesca')
for f in t.schema:
    print(f'  {f.name:30s}  {f.field_type:12s}')

print()
print('DONE')
