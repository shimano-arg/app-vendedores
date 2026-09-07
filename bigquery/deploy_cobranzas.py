#!/usr/bin/env python
"""
Deploy de las vistas de cobranzas_bike.sql a BigQuery.
Usa ADC (application default credentials) — no requiere sa-key.json local.
Alternativa a `bq query < file.sql` que esta roto en Cloud SDK v con python3.13.

Uso: python bigquery/deploy_cobranzas.py
"""
import re
import sys
from pathlib import Path

try:
    from google.cloud import bigquery
except ImportError:
    print('ERROR: pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(1)

PROJECT = 'app-vendedores-shimano'
LOCATION = 'southamerica-east1'
SQL_FILE = Path(__file__).parent / 'cobranzas_bike.sql'


def split_statements(sql: str) -> list:
    """
    Divide el SQL en statements individuales por ';'. Ignora ';' dentro de
    strings o comentarios (simple parser). Cada CREATE OR REPLACE VIEW es un
    statement separado.
    """
    # Remove comentarios: linea entera que empieza con -- Y comentarios inline
    # despues de codigo. Ej: ");  -- comentario" -> ");"
    lines = []
    for line in sql.split('\n'):
        stripped = line.strip()
        if stripped.startswith('--'):
            continue
        # Comentario inline: preservar solo la parte antes del --
        # (esto es simplista — no maneja -- dentro de strings, pero para
        # nuestros SQL es suficiente)
        if ' --' in line:
            line = line.split(' --')[0]
        lines.append(line)
    cleaned = '\n'.join(lines)
    # Split por ; al final de linea (evita ';' inline dentro de strings/CASE WHEN)
    stmts = [s.strip() for s in re.split(r';\s*\n', cleaned)]
    return [s for s in stmts if s and not s.isspace()]


def extract_view_name(stmt: str) -> str:
    m = re.search(r'CREATE\s+OR\s+REPLACE\s+VIEW\s+`([^`]+)`', stmt, re.IGNORECASE)
    if m:
        return m.group(1).split('.')[-1]
    return '(no CREATE VIEW)'


def main():
    if not SQL_FILE.exists():
        print(f'ERROR: {SQL_FILE} no existe', file=sys.stderr)
        sys.exit(2)
    sql = SQL_FILE.read_text(encoding='utf-8')
    stmts = split_statements(sql)
    print(f'[deploy] {len(stmts)} statements a ejecutar contra {PROJECT}')
    print(f'[deploy] Archivo: {SQL_FILE}')

    client = bigquery.Client(project=PROJECT, location=LOCATION)

    for i, stmt in enumerate(stmts, 1):
        view_name = extract_view_name(stmt)
        print(f'\n[{i}/{len(stmts)}] Deploying: {view_name} ...')
        try:
            job = client.query(stmt, location=LOCATION)
            job.result()  # Bloquea hasta que termine
            print(f'    OK.')
        except Exception as e:
            print(f'    FAIL: {e}', file=sys.stderr)
            sys.exit(3)

    print('\n[deploy] Todos los statements ejecutados OK.')


if __name__ == '__main__':
    main()
