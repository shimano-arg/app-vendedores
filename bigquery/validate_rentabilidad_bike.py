#!/usr/bin/env python
"""
Validacion de v_rentabilidad_bike contra los criterios de aceptacion del brief
(BIKE DASHBOARD/rentabilidad/PROPUESTA.md seccion "CRITERIOS DE ACEPTACION").

Prueba 1 — Septiembre 2026 solo Facturas Bike, vs Excel de Juan Paiva:
  Lineas de factura                     5.469
  Facturas                                416
  Venta bruta antes de descuentos   1.003.477.800 ARS
  Venta neta facturada                849.830.181 ARS
  Descuentos totales                  153.647.618 ARS  (15,3% de la bruta)
  Costo de mercaderia vendida         519.147.376 ARS
  Margen bruto sin descuentos         484.330.423 ARS  (48,27%)
  Margen bruto con descuentos         330.682.805 ARS  (38,91%)

Prueba 2 — 1 al 16 de octubre 2026 Bike (facturas + NCs), vs export Fernando:
  Lineas de factura                     1.606
  Lineas de nota de credito                73
  Documentos                              173
  Venta facturas                      321.297.029 ARS
  Costo facturas                      207.806.687 ARS
  Margen facturas                           35,61%

Prueba 3 — Prorrateo factura 42457 Sep: ratio desc_prorrateado/line_total = 0.08
  en las 18 lineas. (En nuestro BQ es doc_num 18921 — mismo patron validado.)

Uso: python bigquery/validate_rentabilidad_bike.py

No ajusta queries para forzar cierre. Reporta deltas honestos y senala
donde esta la diferencia.
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


def fmt_ars(n):
    """Format ARS con separador de miles."""
    if n is None:
        return '(null)'
    return f'$ {round(n):,.0f}'.replace(',', '.')


def fmt_pct(n):
    """Format porcentaje con 2 decimales."""
    if n is None:
        return '(null)'
    return f'{n*100:.2f}%'


def delta_pct(real, esperado):
    """Delta en % entre real y esperado."""
    if esperado is None or esperado == 0:
        return 'N/A'
    d = (real - esperado) / esperado * 100
    return f'{d:+.2f}%'


def check(label, real, esperado, tolerancia_pct=0.5):
    """Imprime una fila comparativa con flag OK/DIFF."""
    if real is None or esperado is None:
        flag = '  N/A '
    else:
        try:
            d = abs((real - esperado) / esperado * 100) if esperado else 0
            flag = '  OK  ' if d <= tolerancia_pct else ' DIFF '
        except (TypeError, ZeroDivisionError):
            flag = '  N/A '
    print(f'[{flag}] {label:<40} real={real:>18} esperado={esperado:>18} delta={delta_pct(real, esperado)}')


def prueba_1(client):
    """Septiembre 2026, solo Facturas Bike, vs Excel Paiva."""
    print('\n' + '=' * 80)
    print('PRUEBA 1 — Septiembre 2026, solo Facturas Bike (vs Excel Paiva)')
    print('=' * 80)
    q = f'''
    SELECT
      COUNT(*) AS lineas,
      COUNT(DISTINCT doc_entry) AS facturas,
      SUM(importe_linea_bruto_ars) AS venta_bruta_ars,
      SUM(importe_linea_neto_ars) AS venta_neta_ars,
      SUM(descuento_comprobante_prorrateado_ars) AS desc_cabecera_ars,
      SUM(descuento_linea_ars) AS desc_linea_ars,
      SUM(costo_total_ars) AS cogs_ars,
      SUM(margen_sin_descuento_cabecera_ars) AS margen_sin_dcto_ars,
      SUM(margen_con_descuento_cabecera_ars) AS margen_con_dcto_ars,
      SAFE_DIVIDE(SUM(margen_sin_descuento_cabecera_ars), NULLIF(SUM(importe_linea_bruto_ars), 0)) AS margen_sin_dcto_pct,
      SAFE_DIVIDE(SUM(margen_con_descuento_cabecera_ars), NULLIF(SUM(importe_linea_neto_ars), 0)) AS margen_con_dcto_pct
    FROM {VIEW}
    WHERE doc_kind = 'INVOICE'
      AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
    '''
    r = list(client.query(q).result())[0]

    # Esperados Paiva
    exp_lineas = 5469
    exp_facturas = 416
    exp_venta_bruta = 1_003_477_800
    exp_venta_neta = 849_830_181
    exp_descuentos = 153_647_618
    exp_cogs = 519_147_376
    exp_mb_sin_dcto = 484_330_423
    exp_mb_con_dcto = 330_682_805
    exp_mb_sin_pct = 0.4827
    exp_mb_con_pct = 0.3891

    check('Lineas de factura', r.lineas, exp_lineas)
    check('Facturas (doc_entry distinct)', r.facturas, exp_facturas)
    check('Venta bruta antes de descuentos', r.venta_bruta_ars, exp_venta_bruta)
    check('Venta neta facturada', r.venta_neta_ars, exp_venta_neta)
    # Descuentos totales = cabecera (prorrateo lo aplica, suma = total_discount sumado) + linea
    descuentos_totales = (r.desc_cabecera_ars or 0) + (r.desc_linea_ars or 0)
    check('Descuentos totales (cabecera + linea)', round(descuentos_totales), exp_descuentos)
    check('Costo de mercaderia vendida', r.cogs_ars, exp_cogs)
    check('Margen bruto sin descuentos ARS', r.margen_sin_dcto_ars, exp_mb_sin_dcto)
    check('Margen bruto con descuentos ARS', r.margen_con_dcto_ars, exp_mb_con_dcto)
    check('Margen bruto sin descuentos %', r.margen_sin_dcto_pct, exp_mb_sin_pct, tolerancia_pct=1.0)
    check('Margen bruto con descuentos %', r.margen_con_dcto_pct, exp_mb_con_pct, tolerancia_pct=1.0)


def prueba_2(client):
    """1 al 16 Oct 2026, Facturas + NCs Bike, vs export Fernando (ARS)."""
    print('\n' + '=' * 80)
    print('PRUEBA 2 — 1 al 16 Oct 2026, Bike (vs export Fernando en ARS)')
    print('=' * 80)
    q = f'''
    SELECT
      COUNTIF(doc_kind = 'INVOICE') AS lineas_fact,
      COUNTIF(doc_kind = 'CREDIT_NOTE') AS lineas_nc,
      COUNT(DISTINCT CONCAT(doc_kind, '-', CAST(doc_entry AS STRING))) AS documentos,
      SUM(IF(doc_kind = 'INVOICE', importe_linea_bruto_ars, 0)) AS venta_fact_ars,
      SUM(IF(doc_kind = 'INVOICE', costo_total_ars, 0)) AS costo_fact_ars,
      SAFE_DIVIDE(
        SUM(IF(doc_kind = 'INVOICE', importe_linea_bruto_ars, 0))
        - SUM(IF(doc_kind = 'INVOICE', costo_total_ars, 0)),
        NULLIF(SUM(IF(doc_kind = 'INVOICE', importe_linea_bruto_ars, 0)), 0)
      ) AS margen_fact_pct
    FROM {VIEW}
    WHERE doc_date BETWEEN DATE('2026-10-01') AND DATE('2026-10-16')
    '''
    r = list(client.query(q).result())[0]

    exp_lineas_fact = 1606
    exp_lineas_nc = 73
    exp_docs = 173
    exp_venta_fact = 321_297_029
    exp_costo_fact = 207_806_687
    exp_margen_fact_pct = 0.3561

    check('Lineas de factura', r.lineas_fact, exp_lineas_fact)
    check('Lineas de nota de credito', r.lineas_nc, exp_lineas_nc)
    check('Documentos distintos (fact + NC)', r.documentos, exp_docs)
    check('Venta facturas ARS', r.venta_fact_ars, exp_venta_fact)
    check('Costo facturas ARS', r.costo_fact_ars, exp_costo_fact)
    check('Margen facturas %', r.margen_fact_pct, exp_margen_fact_pct, tolerancia_pct=1.0)


def prueba_3(client):
    """Prorrateo factura 18921 (equivalente a la 42457 que menciona el brief)."""
    print('\n' + '=' * 80)
    print('PRUEBA 3 — Prorrateo factura 18921 Sep 2026 (18 lineas, 8% dcto cabecera)')
    print('=' * 80)
    q = f'''
    SELECT
      line_num,
      item_code,
      cantidad,
      importe_linea_bruto_ars,
      descuento_comprobante_prorrateado_ars,
      SAFE_DIVIDE(descuento_comprobante_prorrateado_ars, NULLIF(importe_linea_bruto_ars, 0)) AS ratio
    FROM {VIEW}
    WHERE doc_kind = 'INVOICE'
      AND doc_num = 18921
      AND doc_date = DATE('2026-09-03')
    ORDER BY line_num
    '''
    rows = list(client.query(q).result())
    if not rows:
        print('  WARN: factura 18921 Bike no encontrada en v_rentabilidad_bike.')
        print('        (Puede ser que esta factura NO sea Bike — filtro COGSCostingCode3=BIK.)')
        return

    print(f'  {"ln":<4}{"item":<22}{"qty":<6}{"line_total":<14}{"prorrateado":<14}{"ratio":<10}')
    todos_ok = True
    for r in rows:
        lt = r.importe_linea_bruto_ars or 0
        dp = r.descuento_comprobante_prorrateado_ars or 0
        rt = r.ratio
        rt_str = f'{rt:.5f}' if rt is not None else '(line_total=0)'
        flag_ok = (rt is not None and abs(rt - 0.08) < 0.001) or lt == 0
        if not flag_ok:
            todos_ok = False
        marker = '  ' if flag_ok else '!!'
        item_short = (r.item_code or '-')[:20]
        print(f'  {marker}{str(r.line_num):<4}{item_short:<22}{r.cantidad:<6.1f}{lt:<14.2f}{dp:<14.2f}{rt_str:<10}')
    if todos_ok:
        print('  OK: todas las lineas con base > 0 tienen ratio = 0.08 (dcto cabecera).')
    else:
        print('  DIFF: alguna linea no cuadra con el prorrateo esperado 0.08.')


def totales_jerarquia(client):
    """Prueba exploratoria: totales por marca/mss/clase para ver que la jerarquia funciona."""
    print('\n' + '=' * 80)
    print('EXPLORATORIO — Totales Septiembre 2026 por marca (top 5)')
    print('=' * 80)
    q = f'''
    SELECT
      marca,
      COUNT(DISTINCT item_code) AS skus,
      SUM(cantidad) AS unidades,
      SUM(importe_linea_bruto_ars) AS venta_ars,
      SUM(costo_total_ars) AS costo_ars,
      SAFE_DIVIDE(
        SUM(margen_sin_descuento_cabecera_ars),
        NULLIF(SUM(importe_linea_bruto_ars), 0)
      ) AS margen_pct
    FROM {VIEW}
    WHERE doc_kind = 'INVOICE'
      AND doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
      AND marca IS NOT NULL
    GROUP BY marca
    ORDER BY venta_ars DESC
    LIMIT 5
    '''
    print(f'  {"marca":<25}{"skus":<8}{"unid":<10}{"venta":<18}{"costo":<18}{"margen%":<10}')
    for r in client.query(q):
        print(f'  {(r.marca or "(sin)"):<25}{r.skus:<8}{r.unidades:<10.0f}{fmt_ars(r.venta_ars):<18}{fmt_ars(r.costo_ars):<18}{fmt_pct(r.margen_pct):<10}')


def main():
    client = bigquery.Client(project=PROJECT, location=LOCATION)
    print(f'Proyecto: {PROJECT} | Vista: v_rentabilidad_bike')
    try:
        prueba_1(client)
        prueba_2(client)
        prueba_3(client)
        totales_jerarquia(client)
    except Exception as e:
        print(f'\nERROR: {e}', file=sys.stderr)
        sys.exit(1)

    print('\n' + '=' * 80)
    print('Validacion completada. Deltas OK = cuadra con el criterio del brief.')
    print('Deltas DIFF = reportar a Mariano antes de merge (no ajustar queries).')
    print('=' * 80)


if __name__ == '__main__':
    main()
