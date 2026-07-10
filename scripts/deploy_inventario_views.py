"""
deploy_inventario_views.py - One-shot: ejecuta las 2 views nuevas de inventario
en BigQuery (v_inventario + v_inventario_por_warehouse) usando el sa-key local.

Extrae los CREATE OR REPLACE VIEW desde bigquery/views.sql (a partir del
marcador "View 5") y los ejecuta uno por uno.

Uso:
  python scripts/deploy_inventario_views.py
"""
import json
import os
import sys
from pathlib import Path

from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
VIEWS_SQL_PATH = Path(__file__).resolve().parent.parent / 'bigquery' / 'views.sql'


def load_new_views(sql_text: str) -> list[tuple[str, str]]:
    """Extrae los bloques CREATE OR REPLACE VIEW para Views 5-8."""
    result = []
    parts = sql_text.split('-- View ')
    for part in parts:
        if part[:2] in ('5:', '6:', '7:', '8:'):
            title = part.split(':', 1)[1].strip().splitlines()[0].strip()
            idx = part.find('CREATE OR REPLACE VIEW')
            if idx < 0:
                continue
            body = part[idx:]
            end = body.rfind(';')
            if end > 0:
                body = body[:end + 1]
            result.append((title, body))
    return result


def main():
    if not SA_KEY_PATH.exists():
        print(f'[FATAL] sa-key.json no existe en {SA_KEY_PATH}', file=sys.stderr)
        sys.exit(2)
    with open(SA_KEY_PATH) as f:
        sa_data = json.load(f)
    creds = service_account.Credentials.from_service_account_info(sa_data)
    client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)
    print(f'[BQ] cliente OK, project={BQ_PROJECT}, location={BQ_LOCATION}')

    sql_text = VIEWS_SQL_PATH.read_text(encoding='utf-8')
    views = load_new_views(sql_text)
    if not views:
        print('[FATAL] no encontre views 5/6 en views.sql', file=sys.stderr)
        sys.exit(3)

    for title, ddl in views:
        print(f'\n[EXEC] {title}')
        print(f'  SQL length: {len(ddl)} chars')
        job = client.query(ddl, location=BQ_LOCATION)
        job.result()
        print(f'  OK')

    print('\n[DONE] Views deployadas.')


if __name__ == '__main__':
    main()
