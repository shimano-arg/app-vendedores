#!/usr/bin/env python
"""
Carga el CSV de Paiva (paiva_sep2026_facturas_lineas.csv) a BQ como tabla
temporal y responde los 4 puntos que Mariano pidio para cerrar la Prueba 1:

1. Conteo de 3 particiones: solo en mi vista, solo en Paiva, en ambas.
2. Correlacion/ratio promedio: GrossBuyPrice vs costo_unitario_paiva, y
   cost_avg_ars vs costo_unitario_paiva. Si cost_avg_ars reproduce Paiva,
   ese es el campo y queda cerrado el issue de costo.
3. Los 9 documentos que tengo de mas: nro, cliente, division, serie, monto.
4. Las 20 lineas de diferencia: adentro de esos 9 docs o aparte.

Join por (card_code, item_code, doc_date, cantidad). El nro_factura externo
del CSV (42442, etc.) no es el doc_num de BQ (18899) — hay offset de serie.
"""
import sys
from pathlib import Path

try:
    from google.cloud import bigquery
except ImportError:
    print('ERROR: pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(1)

PROJECT = 'app-vendedores-shimano'
LOCATION = 'southamerica-east1'
CSV = Path(r'C:\Users\shimano.sandbox\Desktop\PowerBI\Bike\paiva_sep2026_facturas_lineas.csv')
TMP_TABLE = f'{PROJECT}.shimano_app._tmp_paiva_sep2026'


def load_csv_to_bq(client):
    """Carga CSV a tabla temporal (overwrite)."""
    schema = [
        bigquery.SchemaField('fecha_contab', 'DATETIME'),
        bigquery.SchemaField('cod_cliente', 'STRING'),
        bigquery.SchemaField('nro_factura', 'INT64'),
        bigquery.SchemaField('tipo_doc', 'STRING'),
        bigquery.SchemaField('cantidad', 'FLOAT64'),
        bigquery.SchemaField('cod_articulo', 'STRING'),
        bigquery.SchemaField('precio_unit_antes_dcto', 'FLOAT64'),
        bigquery.SchemaField('dcto_linea_pct', 'FLOAT64'),
        bigquery.SchemaField('dcto_linea_pesos', 'FLOAT64'),
        bigquery.SchemaField('dcto_cbte_pct', 'FLOAT64'),
        bigquery.SchemaField('dcto_cbte_prorrateado', 'FLOAT64'),
        bigquery.SchemaField('venta_unit_neta', 'FLOAT64'),
        bigquery.SchemaField('venta_total_neta', 'FLOAT64'),
        bigquery.SchemaField('costo_unitario', 'FLOAT64'),
        bigquery.SchemaField('costo_total', 'FLOAT64'),
        bigquery.SchemaField('ssc', 'STRING'),
    ]
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.CSV,
        schema=schema,
        skip_leading_rows=1,
        write_disposition='WRITE_TRUNCATE',
    )
    with open(CSV, 'rb') as f:
        job = client.load_table_from_file(
            f, TMP_TABLE, job_config=job_config, location=LOCATION
        )
    job.result()
    print(f'Cargado {CSV.name} a {TMP_TABLE}')
    r = list(client.query(f'SELECT COUNT(*) AS n FROM `{TMP_TABLE}`').result())[0]
    print(f'  Rows cargados: {r.n}')


def punto_1(client):
    """3 particiones por (card_code, item_code, doc_date, cantidad)."""
    print('\n' + '=' * 90)
    print('PUNTO 1 — Particiones del join (card_code, item_code, doc_date, cantidad)')
    print('=' * 90)
    q = f'''
    WITH mia AS (
      SELECT card_code, item_code, DATE(doc_date) AS fecha, cantidad
      FROM `{PROJECT}.shimano_app.v_rentabilidad_bike`
      WHERE doc_kind = 'INVOICE'
        AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
    ),
    paiva AS (
      SELECT cod_cliente AS card_code, cod_articulo AS item_code, DATE(fecha_contab) AS fecha, cantidad
      FROM `{TMP_TABLE}`
    )
    SELECT
      (SELECT COUNT(*) FROM mia) AS total_mia,
      (SELECT COUNT(*) FROM paiva) AS total_paiva,
      (SELECT COUNT(*) FROM mia m INNER JOIN paiva p USING (card_code, item_code, fecha, cantidad)) AS en_ambas,
      (SELECT COUNT(*) FROM mia m LEFT JOIN paiva p USING (card_code, item_code, fecha, cantidad) WHERE p.card_code IS NULL) AS solo_mia,
      (SELECT COUNT(*) FROM paiva p LEFT JOIN mia m USING (card_code, item_code, fecha, cantidad) WHERE m.card_code IS NULL) AS solo_paiva
    '''
    r = list(client.query(q).result())[0]
    print(f'  Total mi vista:                {r.total_mia}')
    print(f'  Total CSV Paiva:               {r.total_paiva}')
    print(f'  Match (en ambas):              {r.en_ambas}')
    print(f'  Solo en mi vista:              {r.solo_mia}')
    print(f'  Solo en Paiva:                 {r.solo_paiva}')


def punto_2(client):
    """Correlación y ratio costo_doc vs costo_paiva, costo_prom vs costo_paiva."""
    print('\n' + '=' * 90)
    print('PUNTO 2 — Costo mio vs Paiva (sobre matches)')
    print('=' * 90)
    q = f'''
    WITH j AS (
      SELECT
        m.item_code,
        m.costo_unitario_doc_ars AS costo_doc_mio,
        m.costo_unitario_prom_ars AS costo_prom_mio,
        p.costo_unitario AS costo_paiva,
        p.cantidad
      FROM `{PROJECT}.shimano_app.v_rentabilidad_bike` m
      INNER JOIN `{TMP_TABLE}` p
        ON p.cod_cliente = m.card_code
        AND p.cod_articulo = m.item_code
        AND DATE(p.fecha_contab) = DATE(m.doc_date)
        AND p.cantidad = m.cantidad
      WHERE m.doc_kind = 'INVOICE'
        AND m.doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
    )
    SELECT
      COUNT(*) AS n_lineas,
      ROUND(CORR(costo_doc_mio, costo_paiva), 5) AS corr_doc_paiva,
      ROUND(AVG(SAFE_DIVIDE(costo_doc_mio, costo_paiva)), 5) AS ratio_prom_doc_paiva,
      ROUND(CORR(costo_prom_mio, costo_paiva), 5) AS corr_prom_paiva,
      ROUND(AVG(SAFE_DIVIDE(costo_prom_mio, costo_paiva)), 5) AS ratio_prom_prom_paiva,
      -- diff absoluta promedio en ARS
      ROUND(AVG(ABS(costo_doc_mio - costo_paiva)), 2) AS diff_abs_prom_doc,
      ROUND(AVG(ABS(costo_prom_mio - costo_paiva)), 2) AS diff_abs_prom_prom,
      -- % de lineas donde costo_prom = costo_paiva exacto (tolerancia 1 ARS)
      ROUND(SUM(CASE WHEN ABS(costo_prom_mio - costo_paiva) <= 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS pct_prom_match_exacto,
      ROUND(SUM(CASE WHEN ABS(costo_doc_mio - costo_paiva) <= 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS pct_doc_match_exacto
    FROM j
    '''
    r = list(client.query(q).result())[0]
    print(f'  Lineas comparadas:                     {r.n_lineas}')
    print(f'')
    print(f'  CORRELACION (debe estar cerca de 1.0):')
    print(f'    costo_doc_mio (GrossBuyPrice) vs costo_paiva: {r.corr_doc_paiva}')
    print(f'    costo_prom_mio (cost_avg_ars) vs costo_paiva: {r.corr_prom_paiva}')
    print(f'')
    print(f'  RATIO PROMEDIO (debe estar cerca de 1.0):')
    print(f'    costo_doc_mio / costo_paiva:  {r.ratio_prom_doc_paiva}')
    print(f'    costo_prom_mio / costo_paiva: {r.ratio_prom_prom_paiva}')
    print(f'')
    print(f'  DIFERENCIA ABSOLUTA PROMEDIO (ARS por linea):')
    print(f'    |costo_doc_mio - costo_paiva|:  $ {r.diff_abs_prom_doc:,.2f}')
    print(f'    |costo_prom_mio - costo_paiva|: $ {r.diff_abs_prom_prom:,.2f}')
    print(f'')
    print(f'  % LINEAS CON MATCH EXACTO (tolerancia +-1 ARS):')
    print(f'    costo_doc_mio == costo_paiva:  {r.pct_doc_match_exacto}%')
    print(f'    costo_prom_mio == costo_paiva: {r.pct_prom_match_exacto}%')


def punto_3(client):
    """9 docs que tengo de mas (si hay) — info por documento."""
    print('\n' + '=' * 90)
    print('PUNTO 3 — Documentos que YO tengo pero Paiva no (candidatos a serie excluida)')
    print('=' * 90)
    q = f'''
    WITH mios AS (
      SELECT DISTINCT doc_entry, doc_num, series, card_code, card_name, division_proxy, doc_date
      FROM `{PROJECT}.shimano_app.v_rentabilidad_bike`
      WHERE doc_kind = 'INVOICE'
        AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
    ),
    paiva_docs AS (
      SELECT DISTINCT cod_cliente AS card_code, DATE(fecha_contab) AS fecha
      FROM `{TMP_TABLE}`
    ),
    -- Docs mios que no tienen match (cliente, fecha) en Paiva
    docs_solo_mios AS (
      SELECT m.*
      FROM mios m
      LEFT JOIN paiva_docs p
        ON p.card_code = m.card_code AND p.fecha = m.doc_date
      WHERE p.card_code IS NULL
    ),
    -- Monto de cada uno de esos
    docs_con_monto AS (
      SELECT
        d.doc_entry, d.doc_num, d.series, d.card_code, d.card_name,
        d.division_proxy, d.doc_date,
        SUM(v.importe_linea_bruto_ars) AS monto_bruto,
        COUNT(*) AS lineas
      FROM docs_solo_mios d
      JOIN `{PROJECT}.shimano_app.v_rentabilidad_bike` v
        ON v.doc_entry = d.doc_entry AND v.doc_kind = 'INVOICE'
      GROUP BY ALL
    )
    SELECT * FROM docs_con_monto ORDER BY monto_bruto DESC
    '''
    rows = list(client.query(q).result())
    print(f'  Encontrados {len(rows)} docs mios sin match en Paiva por (card_code, fecha):')
    print(f'  {"doc_num":<8}{"series":<7}{"card":<16}{"div":<8}{"fecha":<12}{"lineas":<8}{"monto_bruto":<18}{"card_name":<40}')
    for r in rows:
        name = (r.card_name or '')[:38]
        print(f'  {r.doc_num:<8}{r.series:<7}{r.card_code[:14]:<16}{r.division_proxy:<8}{str(r.doc_date):<12}{r.lineas:<8}$ {r.monto_bruto:<16,.2f}{name:<40}')
    return [r.doc_entry for r in rows]


def punto_4(client, doc_entries_extra):
    """20 líneas de diferencia: dentro de los docs extra o aparte?"""
    print('\n' + '=' * 90)
    print('PUNTO 4 — Lineas solo-mias vs si estan en los docs extra del Punto 3')
    print('=' * 90)
    if not doc_entries_extra:
        print('  (No hay docs extra del Punto 3)')
        return
    q = f'''
    WITH mia AS (
      SELECT m.doc_entry, m.card_code, m.item_code, DATE(m.doc_date) AS fecha, m.cantidad
      FROM `{PROJECT}.shimano_app.v_rentabilidad_bike` m
      WHERE m.doc_kind = 'INVOICE'
        AND m.doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
    ),
    paiva AS (
      SELECT cod_cliente AS card_code, cod_articulo AS item_code,
             DATE(fecha_contab) AS fecha, cantidad
      FROM `{TMP_TABLE}`
    ),
    solo_mia AS (
      SELECT m.*
      FROM mia m
      LEFT JOIN paiva p USING (card_code, item_code, fecha, cantidad)
      WHERE p.card_code IS NULL
    )
    SELECT
      COUNT(*) AS total_solo_mias,
      SUM(CASE WHEN doc_entry IN UNNEST(@docs_extra) THEN 1 ELSE 0 END) AS dentro_docs_extra,
      SUM(CASE WHEN doc_entry NOT IN UNNEST(@docs_extra) THEN 1 ELSE 0 END) AS fuera_docs_extra
    FROM solo_mia
    '''
    job_cfg = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ArrayQueryParameter('docs_extra', 'INT64', doc_entries_extra)]
    )
    r = list(client.query(q, job_config=job_cfg).result())[0]
    print(f'  Total lineas solo-mias:           {r.total_solo_mias}')
    print(f'  Dentro de docs extra del Punto 3: {r.dentro_docs_extra}')
    print(f'  Fuera de docs extra:              {r.fuera_docs_extra}  <= si > 0, estas son issue aparte')


def main():
    client = bigquery.Client(project=PROJECT, location=LOCATION)
    load_csv_to_bq(client)
    punto_1(client)
    punto_2(client)
    docs_extra = punto_3(client)
    punto_4(client, docs_extra)
    print('\n' + '=' * 90)
    print('Analisis completo. Si cost_avg_ars reproduce Paiva (correlacion >0.99,')
    print('ratio ~1.0, pct_match alto), el issue de costo queda cerrado.')
    print('=' * 90)


if __name__ == '__main__':
    main()
