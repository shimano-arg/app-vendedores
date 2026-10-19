#!/usr/bin/env python
"""
Diagnostico fino del gap de costo mi_vista vs Paiva, con las correcciones del
feedback de Mariano:
- Ratio PONDERADO (suma/suma), no promedio de ratios.
- Join por nro_factura via mapping doc_num ↔ nro_factura.
- Dedupe estricto antes de la agregacion.
- Signo de la diferencia correcto.

Entregables (PASO 1 pedido por Mariano):
  a) 20 lineas con mayor |dif absoluta|
  b) % del gap total ($66.346.913) que explican esas 20
  c) 20 SKUs con mayor |dif acumulada|
  d) Ratio ponderado global + histograma de ratios por decil
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
VIEW = f'`{PROJECT}.shimano_app.v_rentabilidad_bike`'
PAIVA = f'`{PROJECT}.shimano_app._tmp_paiva_sep2026`'


def fmt_ars(n):
    if n is None:
        return '-'
    return f'$ {n:,.0f}'.replace(',', '.')


def paso_1_particiones_correctas(client):
    """Partition del join con dedupe explicito via ROW_NUMBER."""
    print('\n' + '=' * 90)
    print('PASO 1.0 — Particiones (dedupe estricto por doc + line)')
    print('=' * 90)
    # Para dedupear, le damos un rank a cada combinacion y nos quedamos con 1 por lado.
    q = f'''
    WITH mia AS (
      SELECT doc_entry, line_num, card_code, item_code, DATE(doc_date) AS fecha, cantidad,
             importe_linea_bruto_ars, importe_linea_neto_ars,
             costo_unitario_doc_ars, costo_unitario_prom_ars,
             costo_total_doc_ars, costo_total_prom_ars,
             -- clave de dedupe: card_code + item_code + fecha + cantidad + importe
             ROW_NUMBER() OVER (
               PARTITION BY card_code, item_code, DATE(doc_date), CAST(cantidad AS STRING)
               ORDER BY doc_entry, line_num
             ) AS rn
      FROM {VIEW}
      WHERE doc_kind = 'INVOICE'
        AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
        AND card_code NOT IN ('CSIC0001','CSUR0001')
        AND division_proxy = 'BIKE'
        AND item_code NOT LIKE 'ENV%'
        AND importe_linea_bruto_ars > 0
    ),
    paiva AS (
      SELECT nro_factura, cod_cliente AS card_code, cod_articulo AS item_code,
             DATE(fecha_contab) AS fecha, cantidad,
             venta_total_neta, costo_unitario, costo_total,
             ROW_NUMBER() OVER (
               PARTITION BY cod_cliente, cod_articulo, DATE(fecha_contab), CAST(cantidad AS STRING)
               ORDER BY nro_factura
             ) AS rn
      FROM {PAIVA}
    ),
    j AS (
      SELECT m.*, p.nro_factura, p.costo_unitario AS costo_paiva, p.costo_total AS costo_total_paiva
      FROM mia m
      FULL OUTER JOIN paiva p
        ON m.card_code = p.card_code AND m.item_code = p.item_code
        AND m.fecha = p.fecha AND m.cantidad = p.cantidad AND m.rn = p.rn
    )
    SELECT
      COUNTIF(doc_entry IS NOT NULL AND nro_factura IS NOT NULL) AS match_11,
      COUNTIF(doc_entry IS NOT NULL AND nro_factura IS NULL) AS solo_mia,
      COUNTIF(doc_entry IS NULL AND nro_factura IS NOT NULL) AS solo_paiva,
      (SELECT COUNT(*) FROM mia) AS total_mia_filtrada,
      (SELECT COUNT(*) FROM paiva) AS total_paiva
    FROM j
    '''
    r = list(client.query(q).result())[0]
    print(f'  Mi vista filtrada total:   {r.total_mia_filtrada}')
    print(f'  CSV Paiva total:           {r.total_paiva}')
    print(f'  Match 1-a-1 (dedupe):      {r.match_11}')
    print(f'  Solo mia:                  {r.solo_mia}')
    print(f'  Solo Paiva:                {r.solo_paiva}')
    print(f'  Suma = {r.match_11 + r.solo_mia} / {r.match_11 + r.solo_paiva}')


def paso_1_d_ratio_ponderado_y_histograma(client):
    """Ratio ponderado global = SUM(mio) / SUM(paiva). Histograma por decil."""
    print('\n' + '=' * 90)
    print('PASO 1.d — Ratio PONDERADO global + histograma por decil')
    print('=' * 90)
    q = f'''
    WITH mia AS (
      SELECT doc_entry, line_num, card_code, item_code, DATE(doc_date) AS fecha, cantidad,
             costo_total_prom_ars, costo_unitario_prom_ars,
             ROW_NUMBER() OVER (
               PARTITION BY card_code, item_code, DATE(doc_date), CAST(cantidad AS STRING)
               ORDER BY doc_entry, line_num
             ) AS rn
      FROM {VIEW}
      WHERE doc_kind = 'INVOICE'
        AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
        AND card_code NOT IN ('CSIC0001','CSUR0001')
        AND division_proxy = 'BIKE'
        AND item_code NOT LIKE 'ENV%'
        AND importe_linea_bruto_ars > 0
    ),
    paiva AS (
      SELECT nro_factura, cod_cliente AS card_code, cod_articulo AS item_code,
             DATE(fecha_contab) AS fecha, cantidad, costo_total, costo_unitario,
             ROW_NUMBER() OVER (
               PARTITION BY cod_cliente, cod_articulo, DATE(fecha_contab), CAST(cantidad AS STRING)
               ORDER BY nro_factura
             ) AS rn
      FROM {PAIVA}
    ),
    j AS (
      SELECT m.costo_total_prom_ars AS costo_mio_total,
             m.costo_unitario_prom_ars AS costo_mio_unit,
             p.costo_total AS costo_paiva_total,
             p.costo_unitario AS costo_paiva_unit,
             SAFE_DIVIDE(m.costo_total_prom_ars, p.costo_total) AS ratio_linea
      FROM mia m
      INNER JOIN paiva p
        ON m.card_code = p.card_code AND m.item_code = p.item_code
        AND m.fecha = p.fecha AND m.cantidad = p.cantidad AND m.rn = p.rn
    )
    SELECT
      COUNT(*) AS n,
      ROUND(SUM(costo_mio_total), 0) AS sum_mio,
      ROUND(SUM(costo_paiva_total), 0) AS sum_paiva,
      ROUND(SAFE_DIVIDE(SUM(costo_mio_total), SUM(costo_paiva_total)), 5) AS ratio_ponderado,
      ROUND(AVG(ratio_linea), 5) AS ratio_promedio_no_ponderado
    FROM j
    '''
    r = list(client.query(q).result())[0]
    print(f'  Lineas matcheadas 1-a-1: {r.n}')
    print(f'  Costo total mio:    {fmt_ars(r.sum_mio)}')
    print(f'  Costo total Paiva:  {fmt_ars(r.sum_paiva)}')
    print(f'  Gap (mio - paiva):  {fmt_ars(r.sum_mio - r.sum_paiva)}')
    print(f'  Ratio PONDERADO (suma/suma):     {r.ratio_ponderado}  <<< este es el real')
    print(f'  Ratio no ponderado (avg ratios): {r.ratio_promedio_no_ponderado}  (el que use antes mal)')

    # Histograma por decil
    q2 = f'''
    WITH mia AS (
      SELECT doc_entry, line_num, card_code, item_code, DATE(doc_date) AS fecha, cantidad,
             costo_total_prom_ars,
             ROW_NUMBER() OVER (
               PARTITION BY card_code, item_code, DATE(doc_date), CAST(cantidad AS STRING)
               ORDER BY doc_entry, line_num
             ) AS rn
      FROM {VIEW}
      WHERE doc_kind = 'INVOICE'
        AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
        AND card_code NOT IN ('CSIC0001','CSUR0001')
        AND division_proxy = 'BIKE'
        AND item_code NOT LIKE 'ENV%'
        AND importe_linea_bruto_ars > 0
    ),
    paiva AS (
      SELECT nro_factura, cod_cliente AS card_code, cod_articulo AS item_code,
             DATE(fecha_contab) AS fecha, cantidad, costo_total,
             ROW_NUMBER() OVER (
               PARTITION BY cod_cliente, cod_articulo, DATE(fecha_contab), CAST(cantidad AS STRING)
               ORDER BY nro_factura
             ) AS rn
      FROM {PAIVA}
    ),
    j AS (
      SELECT SAFE_DIVIDE(m.costo_total_prom_ars, p.costo_total) AS ratio
      FROM mia m INNER JOIN paiva p
        ON m.card_code = p.card_code AND m.item_code = p.item_code
        AND m.fecha = p.fecha AND m.cantidad = p.cantidad AND m.rn = p.rn
      WHERE p.costo_total > 0
    )
    SELECT
      APPROX_QUANTILES(ratio, 10) AS deciles
    FROM j
    '''
    r2 = list(client.query(q2).result())[0]
    print(f'\n  HISTOGRAMA — ratios (mio_prom / paiva) por decil:')
    labels = ['min', 'p10', 'p20', 'p30', 'p40', 'p50', 'p60', 'p70', 'p80', 'p90', 'max']
    for i, v in enumerate(r2.deciles):
        print(f'    {labels[i]:<5}: {v:.4f}')


def paso_1_a_top_lineas(client):
    """20 lineas con mayor |dif absoluta|."""
    print('\n' + '=' * 90)
    print('PASO 1.a — Top 20 lineas con mayor |dif absoluta|')
    print('=' * 90)
    q = f'''
    WITH mia AS (
      SELECT doc_num, doc_entry, line_num, card_code, card_name, item_code, DATE(doc_date) AS fecha, cantidad,
             costo_unitario_prom_ars AS mio_unit,
             costo_total_prom_ars AS mio_total,
             ROW_NUMBER() OVER (
               PARTITION BY card_code, item_code, DATE(doc_date), CAST(cantidad AS STRING)
               ORDER BY doc_entry, line_num
             ) AS rn
      FROM {VIEW}
      WHERE doc_kind = 'INVOICE'
        AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
        AND card_code NOT IN ('CSIC0001','CSUR0001')
        AND division_proxy = 'BIKE'
        AND item_code NOT LIKE 'ENV%'
        AND importe_linea_bruto_ars > 0
    ),
    paiva AS (
      SELECT nro_factura, cod_cliente AS card_code, cod_articulo AS item_code,
             DATE(fecha_contab) AS fecha, cantidad,
             costo_unitario AS paiva_unit, costo_total AS paiva_total,
             ROW_NUMBER() OVER (
               PARTITION BY cod_cliente, cod_articulo, DATE(fecha_contab), CAST(cantidad AS STRING)
               ORDER BY nro_factura
             ) AS rn
      FROM {PAIVA}
    )
    SELECT
      p.nro_factura, m.item_code, m.cantidad,
      ROUND(m.mio_unit, 2) AS mio_unit,
      ROUND(p.paiva_unit, 2) AS paiva_unit,
      ROUND(SAFE_DIVIDE(m.mio_unit, p.paiva_unit), 4) AS ratio,
      ROUND(m.mio_total - p.paiva_total, 2) AS dif_ars
    FROM mia m INNER JOIN paiva p
      ON m.card_code = p.card_code AND m.item_code = p.item_code
      AND m.fecha = p.fecha AND m.cantidad = p.cantidad AND m.rn = p.rn
    ORDER BY ABS(m.mio_total - p.paiva_total) DESC
    LIMIT 20
    '''
    rows = list(client.query(q).result())
    print(f'  {"nro":<8}{"item":<22}{"qty":<6}{"mio_unit":<13}{"paiva_unit":<13}{"ratio":<9}{"dif_ars":<16}')
    sum_dif_top20 = 0
    for r in rows:
        print(f'  {r.nro_factura:<8}{r.item_code[:20]:<22}{r.cantidad:<6.0f}'
              f'$ {r.mio_unit:<11,.0f}$ {r.paiva_unit:<11,.0f}{r.ratio:<9}'
              f'$ {r.dif_ars:<14,.0f}')
        sum_dif_top20 += r.dif_ars

    # Punto b: % del gap total que explican
    print(f'\n  Suma |dif| de las 20 lineas: {fmt_ars(abs(sum_dif_top20))}')
    # Gap total via query
    q_gap = f'''
    WITH mia AS (
      SELECT doc_entry, line_num, card_code, item_code, DATE(doc_date) AS fecha, cantidad, costo_total_prom_ars,
             ROW_NUMBER() OVER (PARTITION BY card_code, item_code, DATE(doc_date), CAST(cantidad AS STRING) ORDER BY doc_entry, line_num) AS rn
      FROM {VIEW}
      WHERE doc_kind = 'INVOICE' AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
        AND card_code NOT IN ('CSIC0001','CSUR0001')
        AND division_proxy = 'BIKE'
        AND item_code NOT LIKE 'ENV%'
        AND importe_linea_bruto_ars > 0
    ),
    paiva AS (
      SELECT nro_factura, cod_cliente AS card_code, cod_articulo AS item_code,
             DATE(fecha_contab) AS fecha, cantidad, costo_total,
             ROW_NUMBER() OVER (PARTITION BY cod_cliente, cod_articulo, DATE(fecha_contab), CAST(cantidad AS STRING) ORDER BY nro_factura) AS rn
      FROM {PAIVA}
    )
    SELECT ROUND(SUM(m.costo_total_prom_ars - p.costo_total), 0) AS gap_total
    FROM mia m INNER JOIN paiva p USING (card_code, item_code, fecha, cantidad, rn)
    '''
    r_gap = list(client.query(q_gap).result())[0]
    print(f'  Gap total matcheadas (mio - paiva): {fmt_ars(r_gap.gap_total)}')
    if r_gap.gap_total:
        pct = sum_dif_top20 / r_gap.gap_total * 100
        print(f'  Top 20 explica: {pct:.1f}% del gap total')


def paso_1_c_top_skus(client):
    """20 SKUs con mayor |dif acumulada|."""
    print('\n' + '=' * 90)
    print('PASO 1.c — Top 20 SKUs con mayor |dif acumulada|')
    print('=' * 90)
    q = f'''
    WITH mia AS (
      SELECT doc_entry, line_num, card_code, item_code, DATE(doc_date) AS fecha, cantidad,
             costo_unitario_prom_ars, costo_total_prom_ars,
             ROW_NUMBER() OVER (PARTITION BY card_code, item_code, DATE(doc_date), CAST(cantidad AS STRING) ORDER BY doc_entry, line_num) AS rn
      FROM {VIEW}
      WHERE doc_kind = 'INVOICE' AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
        AND card_code NOT IN ('CSIC0001','CSUR0001')
        AND division_proxy = 'BIKE'
        AND item_code NOT LIKE 'ENV%'
        AND importe_linea_bruto_ars > 0
    ),
    paiva AS (
      SELECT nro_factura, cod_cliente AS card_code, cod_articulo AS item_code,
             DATE(fecha_contab) AS fecha, cantidad, costo_unitario, costo_total,
             ROW_NUMBER() OVER (PARTITION BY cod_cliente, cod_articulo, DATE(fecha_contab), CAST(cantidad AS STRING) ORDER BY nro_factura) AS rn
      FROM {PAIVA}
    )
    SELECT
      m.item_code,
      COUNT(*) AS n_lineas,
      ROUND(SUM(m.cantidad), 0) AS unidades,
      ROUND(AVG(m.costo_unitario_prom_ars), 2) AS mio_unit_avg,
      ROUND(AVG(p.costo_unitario), 2) AS paiva_unit_avg,
      ROUND(SAFE_DIVIDE(AVG(m.costo_unitario_prom_ars), AVG(p.costo_unitario)), 4) AS ratio,
      ROUND(SUM(m.costo_total_prom_ars - p.costo_total), 2) AS dif_acum_ars
    FROM mia m INNER JOIN paiva p
      ON m.card_code = p.card_code AND m.item_code = p.item_code
      AND m.fecha = p.fecha AND m.cantidad = p.cantidad AND m.rn = p.rn
    GROUP BY m.item_code
    ORDER BY ABS(SUM(m.costo_total_prom_ars - p.costo_total)) DESC
    LIMIT 20
    '''
    print(f'  {"item":<22}{"n":<5}{"unid":<7}{"mio_unit":<13}{"paiva_unit":<13}{"ratio":<9}{"dif_acum":<16}')
    for r in client.query(q):
        print(f'  {r.item_code[:20]:<22}{r.n_lineas:<5}{r.unidades:<7.0f}'
              f'$ {r.mio_unit_avg:<11,.0f}$ {r.paiva_unit_avg:<11,.0f}{r.ratio:<9}'
              f'$ {r.dif_acum_ars:<14,.0f}')


def main():
    client = bigquery.Client(project=PROJECT, location=LOCATION)
    paso_1_particiones_correctas(client)
    paso_1_d_ratio_ponderado_y_histograma(client)
    paso_1_a_top_lineas(client)
    paso_1_c_top_skus(client)


if __name__ == '__main__':
    main()
