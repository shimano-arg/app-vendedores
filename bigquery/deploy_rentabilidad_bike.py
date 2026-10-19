#!/usr/bin/env python
"""
Deploy puntual de v_rentabilidad_bike (sin tocar las demas vistas del archivo).
Extrae el bloque `CREATE OR REPLACE VIEW ... v_rentabilidad_bike ...;` de
`bigquery/views.sql` y lo ejecuta en BQ.

Uso: python bigquery/deploy_rentabilidad_bike.py
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
SQL_FILE = Path(__file__).parent / 'views.sql'
VIEW_NAME = 'v_rentabilidad_bike'


def extract_view_sql(file_path: Path, view_name: str) -> str:
    """
    Lee el archivo views.sql y extrae SOLO el bloque CREATE OR REPLACE VIEW
    cuyo nombre coincide con view_name. Devuelve el SQL del CREATE hasta el
    siguiente `;` que termina el statement.
    """
    text = file_path.read_text(encoding='utf-8')
    marker = f'`app-vendedores-shimano.shimano_app.{view_name}` AS'
    start = text.find(marker)
    if start < 0:
        raise RuntimeError(f'View {view_name} no encontrada en {file_path}')
    # Buscar hacia atras el "CREATE OR REPLACE VIEW".
    create_start = text.rfind('CREATE OR REPLACE VIEW', 0, start)
    if create_start < 0:
        raise RuntimeError(f'No pude ubicar CREATE OR REPLACE VIEW antes de {marker}')
    # Final: el proximo ";" fuera de string. Simplificacion: busca ";\n" o fin de archivo.
    end = text.find(';\n', start)
    if end < 0:
        end = len(text)
    stmt = text[create_start:end].strip()
    if not stmt.endswith(';'):
        stmt += ';'
    return stmt


def main():
    print(f'Proyecto: {PROJECT}')
    print(f'Vista:    {VIEW_NAME}')
    print(f'Archivo:  {SQL_FILE.name}')
    sql = extract_view_sql(SQL_FILE, VIEW_NAME)
    print(f'SQL extraido ({len(sql)} chars). Deploy a BQ...')
    client = bigquery.Client(project=PROJECT, location=LOCATION)
    job = client.query(sql)
    job.result()
    print(f'OK — vista {VIEW_NAME} desplegada.')
    # Mini sanity check: contar filas totales de la vista Sep 2026 Bike.
    q_check = f'''
    SELECT COUNT(*) AS n
    FROM `{PROJECT}.shimano_app.{VIEW_NAME}`
    WHERE doc_date BETWEEN DATE('2026-09-01') AND DATE('2026-09-30')
    '''
    r = list(client.query(q_check).result())[0]
    print(f'Sanity check: {r.n} lineas Sep 2026 Bike en la vista.')


if __name__ == '__main__':
    main()
