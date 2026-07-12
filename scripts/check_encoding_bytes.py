"""Ver los bytes reales de item_name para confirmar si el fix encoding funciono."""
import json
import sys
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

sys.stdout.reconfigure(encoding='utf-8')

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
client = bigquery.Client(project='app-vendedores-shimano',
                        credentials=service_account.Credentials.from_service_account_info(sa),
                        location='southamerica-east1')

q = """
SELECT
  item_code,
  item_name_catalogo AS name,
  TO_HEX(CAST(item_name_catalogo AS BYTES)) AS name_hex,
  familia,
  subfamilia
FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
WHERE item_code IN ('CVC66H2CSA', 'FXPR410', '471512', 'SIE2500HG', 'FX1000FC')
GROUP BY item_code, name, name_hex, familia, subfamilia
LIMIT 10
"""
print('=== Bytes hex de item_name (0xC3B1 = "ñ" UTF-8, 0xEFBFBD = "�" U+FFFD) ===\n')
for row in client.query(q).result():
    print(f'item_code:  {row["item_code"]}')
    print(f'name:       {row["name"]}')
    print(f'familia:    {row["familia"]}  subfamilia: {row["subfamilia"]}')
    hex_str = row['name_hex']
    print(f'hex:        {hex_str[:200]}{"..." if len(hex_str) > 200 else ""}')
    if 'efbfbd' in hex_str.lower():
        print('  ! CONTIENE U+FFFD (encoding roto sigue presente)')
    if 'c3b1' in hex_str.lower():
        print('  OK contiene ñ UTF-8 (0xC3B1)')
    if 'c3b3' in hex_str.lower():
        print('  OK contiene ó UTF-8 (0xC3B3)')
    print()
