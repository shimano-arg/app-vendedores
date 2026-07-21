"""Aplica v_facturado_cobrado_deuda_por_vendedor + corre verificacion."""
import json
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
    marker = f'CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.{view_name}`'
    start = sql_text.find(marker)
    if start < 0:
        return None
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


sql = extract_view('v_facturado_cobrado_deuda_por_vendedor', VIEWS)
if not sql:
    print('[FAIL] No encontre la vista en views.sql')
    raise SystemExit(1)

print(f'[EXEC] v_facturado_cobrado_deuda_por_vendedor ({len(sql)} chars)...')
client.query(sql, location=BQ_LOCATION).result()
print('  OK\n')

print('=' * 70)
print('VERIFICACIONES')
print('=' * 70)

# Total historico por vendedor
print()
print('>>> Total historico (todas las facturas ultimos 12 meses)')
print('    facturado = cobrado + deuda por definicion')
r = list(client.query(f'''
    SELECT assigned_vendor,
           SUM(facturas_emitidas) AS n_facturas,
           SUM(facturado_ars) AS facturado,
           SUM(cobrado_ars) AS cobrado,
           SUM(deuda_ars) AS deuda
    FROM `{TBL}.v_facturado_cobrado_deuda_por_vendedor`
    GROUP BY assigned_vendor
    ORDER BY facturado DESC
''').result())
if not r:
    print('  (vacio)')
else:
    print(f'  {"Vendedor":<30} {"Facturas":>8} {"Facturado":>15} {"Cobrado":>15} {"Deuda":>15}')
    print('  ' + '-' * 90)
    tot_f = tot_c = tot_d = 0
    for row in r:
        d = dict(row.items())
        print(f'  {d["assigned_vendor"]:<30} '
              f'{d["n_facturas"]:>8} '
              f'${d["facturado"]:>13,.0f} '
              f'${d["cobrado"]:>13,.0f} '
              f'${d["deuda"]:>13,.0f}')
        tot_f += d['facturado']
        tot_c += d['cobrado']
        tot_d += d['deuda']
    print('  ' + '-' * 90)
    print(f'  {"TOTAL PESCA":<30} {"":<8} ${tot_f:>13,.0f} ${tot_c:>13,.0f} ${tot_d:>13,.0f}')

# Detalle mensual del ultimo mes (para vista mensual del dashboard)
print()
print('>>> Mes actual (julio 2026):')
r = list(client.query(f'''
    SELECT assigned_vendor, facturas_emitidas, facturado_ars, cobrado_ars, deuda_ars
    FROM `{TBL}.v_facturado_cobrado_deuda_por_vendedor`
    WHERE anio = 2026 AND mes = 7
    ORDER BY facturado_ars DESC
''').result())
if not r:
    print('  (sin facturacion pesca en julio 2026)')
else:
    print(f'  {"Vendedor":<30} {"N":>3} {"Facturado":>15} {"Cobrado":>15} {"Deuda":>15}')
    for row in r:
        d = dict(row.items())
        print(f'  {d["assigned_vendor"]:<30} '
              f'{d["facturas_emitidas"]:>3} '
              f'${d["facturado_ars"]:>13,.0f} '
              f'${d["cobrado_ars"]:>13,.0f} '
              f'${d["deuda_ars"]:>13,.0f}')

# Verificar consistencia matematica
print()
print('>>> Chequeo matematico: facturado - cobrado - deuda = 0 (excepto redondeo)')
r = list(client.query(f'''
    SELECT assigned_vendor,
           SUM(facturado_ars) - SUM(cobrado_ars) - SUM(deuda_ars) AS diff
    FROM `{TBL}.v_facturado_cobrado_deuda_por_vendedor`
    GROUP BY assigned_vendor
''').result())
for row in r:
    d = dict(row.items())
    marker = 'OK' if abs(d['diff']) < 1 else 'FAIL'
    print(f'  {d["assigned_vendor"]:<30}  diff=${d["diff"]:>10,.2f}  [{marker}]')

print('\nDONE')
