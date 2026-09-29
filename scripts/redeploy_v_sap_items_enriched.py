"""
redeploy_v_sap_items_enriched.py — v1087 (2026-09-29)

Root cause del mojibake CAÑAS→CAÃ'AS en BigQuery:
El deploy anterior de v_sap_items_enriched (probablemente algún `bq query < file`
desde PowerShell 5.1 / cmd.exe) interpretó el file como Windows-1252 en vez de
UTF-8. Los 2 bytes UTF-8 de Ñ (0xC3 0x91) fueron leídos como 2 chars separados
Windows-1252 (Ã + 0x91=U+2018 '), y BQ los re-encoded a UTF-8 quedando la
literal 'CAÑAS' del SQL guardada como bytes 0xC3 0x83 0xE2 0x80 0x98 = 'CAÃ'AS'.

Fix: re-deployar la view leyendo el file con encoding='utf-8' explícito y
enviándola via bq Python SDK (que preserva UTF-8 en la request HTTP).

Uso:
  python scripts/redeploy_v_sap_items_enriched.py

Usa ADC (application_default_credentials.json) — no requiere service account.
"""
import re
import sys
from pathlib import Path

try:
    from google.cloud import bigquery
except ImportError:
    print('[FATAL] Falta instalar google-cloud-bigquery. Ejecutá: pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(2)

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'  # dataset shimano_app

SCRIPT_DIR = Path(__file__).resolve().parent
VIEWS_SQL_PATH = SCRIPT_DIR.parent / 'bigquery' / 'views.sql'

# Views a re-deployar. La primera es la crítica (mojibake CAÑAS).
# Las otras se agregan por defense-in-depth: si el bug afectó a v_sap_items_enriched,
# quizás también afecte a otras views con literales acentuados.
VIEWS_TO_REDEPLOY = [
    'v_sap_items_enriched',
    'v_ventas_lineas',
    'v_inventario',
    'v_backorder_lineas',
]


def extract_view_sql(views_sql: str, view_name: str) -> str:
    """Extrae el CREATE OR REPLACE VIEW completo para 'view_name' de views.sql."""
    marker = f'CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.{view_name}`'
    start = views_sql.find(marker)
    if start < 0:
        raise SystemExit(f'No encontré {view_name!r} en views.sql (marker: {marker!r})')
    next_create = views_sql.find('CREATE OR REPLACE VIEW', start + 1)
    end = next_create if next_create > 0 else len(views_sql)
    chunk = views_sql[start:end]
    last_semi = chunk.rfind(';')
    if last_semi < 0:
        raise SystemExit(f'{view_name}: no encontré `;` terminador en el chunk')
    return chunk[:last_semi + 1]


def main():
    print(f'[read] Leyendo {VIEWS_SQL_PATH} con encoding=utf-8')
    views_sql = VIEWS_SQL_PATH.read_text(encoding='utf-8')
    print(f'[read] {len(views_sql):,} chars, {len(views_sql.encode("utf-8")):,} bytes UTF-8')

    # Sanity check: 'CAÑAS' aparece bien encoded en el file?
    ca_bytes = 'CAÑAS'.encode('utf-8')  # b'CA\xc3\x91AS'
    if ca_bytes in views_sql.encode('utf-8'):
        print(f'[verify] "CAÑAS" bien encoded en el file source (bytes {ca_bytes.hex()})')
    else:
        print(f'[FATAL] "CAÑAS" NO encontrado con bytes UTF-8 correctos en el file. Abortando.', file=sys.stderr)
        sys.exit(3)

    client = bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)
    print(f'[bq] Cliente autenticado via ADC. Project={BQ_PROJECT} location={BQ_LOCATION}')

    for view_name in VIEWS_TO_REDEPLOY:
        print(f'\n{"=" * 60}')
        print(f'[deploy] {view_name}')
        print(f'{"=" * 60}')
        view_sql = extract_view_sql(views_sql, view_name)
        print(f'[deploy] SQL length: {len(view_sql):,} chars')
        # Verificar 'CAÑAS' presente si aplica (solo v_sap_items_enriched lo tiene hardcoded)
        if 'CAÑAS' in view_sql:
            print(f'[deploy] literal "CAÑAS" está en el SQL a enviar')
        try:
            job = client.query(view_sql)
            job.result()  # bloquea hasta que termine
            print(f'[deploy] OK — {view_name} re-deployada')
        except Exception as e:
            print(f'[FAIL] {view_name}: {type(e).__name__} - {e}', file=sys.stderr)
            sys.exit(4)

    print(f'\n{"=" * 60}')
    print('[done] Todas las views re-deployadas OK.')
    print('[done] Verificar corriendo _mojibake_verify.sql')
    print(f'{"=" * 60}')


if __name__ == '__main__':
    main()
