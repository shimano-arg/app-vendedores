"""
Para cada factura USD con DIFF vs ORTT, buscar la tasa ORTT de los
dias cercanos (D-3 a D+3) y ver si la tasa de la factura matchea con
alguno. Teoria 2026-10-19: SAP factura fin de mes usa tasa de dias
anteriores (quiza la del dia habil previo).
"""
import sys
from google.cloud import bigquery

PROJECT = 'app-vendedores-shimano'
LOCATION = 'southamerica-east1'


def main():
    c = bigquery.Client(project=PROJECT, location=LOCATION)
    q = f'''
    WITH facturas AS (
      SELECT doc_num, doc_date, doc_rate
      FROM `{PROJECT}.shimano_app.v_facturas_sap`
      WHERE EXTRACT(YEAR FROM doc_date) = 2026
        AND doc_currency = 'USD'
        AND doc_rate IS NOT NULL AND doc_rate > 0
    ),
    todas_tasas AS (
      SELECT fecha, tasa
      FROM `{PROJECT}.shimano_app.dim_tipo_cambio`
      WHERE moneda = 'USD'
    )
    SELECT
      f.doc_num,
      f.doc_date,
      f.doc_rate AS tasa_factura,
      ARRAY_AGG(STRUCT(t.fecha, t.tasa) ORDER BY t.fecha) AS tasas_cercanas
    FROM facturas f
    LEFT JOIN todas_tasas t
      ON t.fecha BETWEEN DATE_SUB(f.doc_date, INTERVAL 5 DAY)
                   AND DATE_ADD(f.doc_date, INTERVAL 2 DAY)
    GROUP BY f.doc_num, f.doc_date, f.doc_rate
    ORDER BY f.doc_date, f.doc_num
    '''
    rows = list(c.query(q).result())
    print(f'Diagnostico {len(rows)} facturas USD 2026 vs ORTT D-5 a D+2')
    print('=' * 95)
    matches_dminus = {}
    for r in rows:
        linea = f'{r.doc_date} #{r.doc_num:<7} fact={r.tasa_factura:.2f}'
        hit = None
        for t in r.tasas_cercanas:
            if t['tasa'] is None:
                continue
            if abs(float(t['tasa']) - float(r.tasa_factura)) < 0.5:
                delta = (r.doc_date - t['fecha']).days
                hit = (t['fecha'], float(t['tasa']), delta)
                break
        if hit:
            linea += f'  → match {hit[0]} ({hit[1]:.2f}) D{-hit[2] if hit[2]>0 else "+"+str(-hit[2])}'
            k = hit[2]
            matches_dminus[k] = matches_dminus.get(k, 0) + 1
        else:
            cercanas = ','.join(f'{t["fecha"]}:{float(t["tasa"]):.0f}' for t in r.tasas_cercanas if t['tasa'])
            linea += f'  ✗ sin match. ORTT: {cercanas}'
        print(linea)
    print()
    print('Distribucion de delta (dias desde doc_date):')
    for k in sorted(matches_dminus.keys()):
        print(f'  D-{k}: {matches_dminus[k]} facturas')


if __name__ == '__main__':
    main()
