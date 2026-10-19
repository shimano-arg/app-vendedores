#!/usr/bin/env python
"""
Prueba de aceptacion ORTT vs doc_rate de facturas en USD.

Spec Mariano 2026-10-19: hay 41 facturas en dolares de 2026 en v_facturas_sap
con su doc_rate y su fecha. Para cada una, la tasa de ORTT en la fecha de esa
factura TIENE QUE COINCIDIR con su doc_rate. Si coinciden las 41, queda
demostrado que ORTT es la fuente correcta.

Devuelve: cuantas coinciden exacto, cuantas difieren, y para las que difieren
el detalle (fecha, doc_num, doc_rate, tasa ORTT).

Uso: python bigquery/validate_ortt_vs_facturas.py
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


def main():
    client = bigquery.Client(project=PROJECT, location=LOCATION)
    q = f'''
    WITH facturas_usd AS (
      SELECT
        doc_num,
        doc_date,
        doc_currency,
        doc_rate
      FROM `{PROJECT}.shimano_app.v_facturas_sap`
      WHERE EXTRACT(YEAR FROM doc_date) = 2026
        AND doc_currency = 'USD'
        AND doc_rate IS NOT NULL
        AND doc_rate > 0
    ),
    cruzado AS (
      SELECT
        f.doc_num,
        f.doc_date,
        f.doc_rate AS tasa_factura,
        o.tasa AS tasa_ortt,
        ROUND(ABS(f.doc_rate - COALESCE(o.tasa, 0)), 4) AS diff_abs,
        CASE
          WHEN o.tasa IS NULL THEN 'NO_ORTT_PARA_FECHA'
          WHEN ABS(f.doc_rate - o.tasa) < 0.01 THEN 'MATCH_EXACTO'
          WHEN ABS(f.doc_rate - o.tasa) < 1 THEN 'MATCH_CENTAVOS'
          ELSE 'DIFF'
        END AS resultado
      FROM facturas_usd f
      LEFT JOIN `{PROJECT}.shimano_app.dim_tipo_cambio` o
        ON o.fecha = f.doc_date
        AND o.moneda = 'USD'
    )
    SELECT * FROM cruzado
    ORDER BY doc_date, doc_num
    '''
    rows = list(client.query(q).result())
    if not rows:
        print('WARN: 0 facturas USD 2026 encontradas en v_facturas_sap.')
        return

    total = len(rows)
    match_exacto = sum(1 for r in rows if r.resultado == 'MATCH_EXACTO')
    match_centavos = sum(1 for r in rows if r.resultado == 'MATCH_CENTAVOS')
    diff = sum(1 for r in rows if r.resultado == 'DIFF')
    sin_ortt = sum(1 for r in rows if r.resultado == 'NO_ORTT_PARA_FECHA')

    print('=' * 80)
    print(f'PRUEBA DE ACEPTACION — ORTT vs doc_rate de facturas USD 2026')
    print('=' * 80)
    print(f'Total facturas USD 2026 en v_facturas_sap:  {total}')
    print(f'  MATCH exacto (< 0.01 ARS diff):           {match_exacto}')
    print(f'  MATCH centavos (< 1 ARS diff):            {match_centavos}')
    print(f'  DIFF (> 1 ARS):                           {diff}')
    print(f'  SIN cotizacion ORTT en la fecha:          {sin_ortt}')
    print()

    # Detalle de las que no son MATCH_EXACTO.
    anomalias = [r for r in rows if r.resultado != 'MATCH_EXACTO']
    if anomalias:
        print(f'DETALLE de las {len(anomalias)} que NO son MATCH_EXACTO:')
        print()
        print(f'  {"fecha":<12}{"doc_num":<10}{"factura":<12}{"ortt":<12}{"diff":<10}{"resultado":<22}')
        for r in anomalias:
            fac = f'{r.tasa_factura:.4f}' if r.tasa_factura is not None else '-'
            ort = f'{r.tasa_ortt:.4f}' if r.tasa_ortt is not None else '(null)'
            print(f'  {str(r.doc_date):<12}{r.doc_num:<10}{fac:<12}{ort:<12}{r.diff_abs:<10}{r.resultado:<22}')
    else:
        print('OK: todas las facturas USD matchean exacto con ORTT.')
        print('    Queda demostrado que ORTT es la fuente correcta.')


if __name__ == '__main__':
    main()
