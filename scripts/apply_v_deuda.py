"""Aplica v_deuda_por_vendedor + v_deuda_facturas_detalle a BigQuery prod
y corre verificaciones.

Verificaciones que esperamos (basadas en el diagnostico previo):
- 3 vendedores con deuda (Gonzalo, Federico, Martin)
- Deuda total pesca ~$42.4M ARS
- Detalle: 4 facturas
"""
import json
import re
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
creds = service_account.Credentials.from_service_account_info(sa)
client = bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)

VIEWS = (Path(__file__).resolve().parent.parent / 'bigquery' / 'views.sql').read_text(encoding='utf-8')
TBL = 'app-vendedores-shimano.shimano_app'

def extract_view(view_name, sql_text):
    """Extrae un CREATE OR REPLACE VIEW ignorando ; dentro de comentarios --.
    Busca el patron completo hasta el ; que este fuera de un comentario."""
    marker = f'CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.{view_name}`'
    start = sql_text.find(marker)
    if start < 0:
        return None
    # Camina caracter por caracter buscando el ; terminador.
    # Ignora contenido despues de -- hasta \n.
    i = start
    in_line_comment = False
    while i < len(sql_text):
        ch = sql_text[i]
        if in_line_comment:
            if ch == '\n':
                in_line_comment = False
        elif ch == '-' and i + 1 < len(sql_text) and sql_text[i+1] == '-':
            in_line_comment = True
        elif ch == ';':
            return sql_text[start:i+1]
        i += 1
    return None

# Extraer y aplicar solo las 2 vistas nuevas
for view_name in ('v_deuda_por_vendedor', 'v_deuda_facturas_detalle'):
    sql = extract_view(view_name, VIEWS)
    if not sql:
        print(f'[FAIL] No encontre {view_name} en views.sql')
        raise SystemExit(1)
    print(f'[EXEC] {view_name} ({len(sql)} chars)...')
    client.query(sql, location=BQ_LOCATION).result()
    print('  OK')

print()
print('=' * 70)
print('VERIFICACIONES')
print('=' * 70)

print()
print('>>> v_deuda_por_vendedor (agregado por vendedor):')
r = list(client.query(f'''
    SELECT * FROM `{TBL}.v_deuda_por_vendedor`
    ORDER BY deuda_total_ars DESC
''').result())
if not r:
    print('  (vacia) - raro, esperabamos 3 vendedores con deuda')
else:
    for row in r:
        d = dict(row.items())
        print(f'  {d["assigned_vendor"]:<28} '
              f'{d["facturas_pendientes"]:>3} facturas  '
              f'{d["clientes_con_deuda"]:>2} clientes  '
              f'deuda_total=${d["deuda_total_ars"]:>15,.2f}  '
              f'vencida=${d["deuda_vencida_ars"]:>15,.2f}  '
              f'al_dia=${d["deuda_al_dia_ars"]:>15,.2f}  '
              f'prox_venc={d["proxima_vencimiento"]}')

    total = sum(dict(row.items())['deuda_total_ars'] for row in r)
    print(f'\n  TOTAL DEUDA PESCA: ${total:,.2f}')
    print(f'  (esperado en diagnostico: ~$42.4M)')

print()
print('>>> v_deuda_facturas_detalle (detalle factura por factura):')
r = list(client.query(f'''
    SELECT assigned_vendor, cliente_display, doc_num, doc_due_date,
           dias_vencido, saldo_ars, estado
    FROM `{TBL}.v_deuda_facturas_detalle`
    ORDER BY assigned_vendor, saldo_ars DESC
''').result())
if not r:
    print('  (vacia)')
else:
    for row in r:
        d = dict(row.items())
        print(f'  {d["assigned_vendor"]:<28} {d["cliente_display"][:35]:<37} '
              f'#{d["doc_num"]:<6} venc={d["doc_due_date"]} '
              f'({d["dias_vencido"]:>+4}d)  '
              f'${d["saldo_ars"]:>12,.2f}  {d["estado"]}')

print()
print('DONE')
