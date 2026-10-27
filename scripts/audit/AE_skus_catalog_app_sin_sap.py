"""AE — PR2 §72 (2026-10-26) — Lista SKUs del catalogo app que NO estan en SAP.

Cruza `stock_snapshot/*` (catalog app, lo que el VDE puede ver y agregar) con
`sap_products/*` (catalog SAP, lo que SAP acepta). Los SKUs que estan en el
primero pero no en el segundo son los candidatos a bloquear reportes como el
de Federico ORDEN 530 (EXGTVC66M4AR).

Reportado 2026-10-26. Autorizado por Mariano para cruce con BI.

Output:
  - stdout tabla.
  - Desktop\\SKUS_NO_EN_SAP\\lista_2026-10-26.md (markdown para WhatsApp a BI).

Uso:
  python scripts/audit/AE_skus_catalog_app_sin_sap.py
"""

import firebase_admin
from firebase_admin import firestore
from datetime import datetime
from pathlib import Path

PROJECT = 'app-vendedores-shimano'

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={'projectId': PROJECT})
db = firestore.client()

OUT_DIR = Path.home() / 'Desktop' / 'SKUS_NO_EN_SAP'
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_MD = OUT_DIR / f'lista_{datetime.now().strftime("%Y-%m-%d")}.md'

print('=' * 70)
print('AE - SKUs catalog app sin equivalente en SAP')
print('=' * 70)

# 1) Todos los SKUs en stock_snapshot (catalog app).
print('\n[1/3] Leyendo stock_snapshot...')
ss_docs = list(db.collection('stock_snapshot').stream())
ss_skus = set(d.id.upper() for d in ss_docs)
print(f'  stock_snapshot: {len(ss_skus)} SKUs')

# 2) Todos los SKUs en sap_products (catalog SAP).
print('[2/3] Leyendo sap_products...')
sp_docs = list(db.collection('sap_products').stream())
sp_skus = set(d.id.upper() for d in sp_docs)
print(f'  sap_products: {len(sp_skus)} SKUs')

# 3) Diferencia: en stock_snapshot pero NO en sap_products.
print('[3/3] Calculando diferencia...')
missing = ss_skus - sp_skus
print(f'  SKUs en app pero NO en SAP: {len(missing)}')

# Enriquecer con metadata del stock_snapshot (si tiene backorder app, etc.).
rows = []
ss_data_map = {d.id: d.to_dict() or {} for d in ss_docs}
for sku in sorted(missing):
    data = ss_data_map.get(sku) or {}
    back_app = data.get('backorderApp', {}) or {}
    rows.append({
        'sku': sku,
        'backorder_app_total': back_app.get('total', 0),
        'clientes_con_bo': len((back_app.get('byClient') or {})),
    })

# Ordenar por backorder app desc (los más urgentes primero).
rows.sort(key=lambda r: -r['backorder_app_total'])

print()
print('Top 30 por backorder app:')
print(f'{"SKU":<30} {"BO app":<10} {"# clientes":<10}')
for r in rows[:30]:
    print(f'{r["sku"]:<30} {r["backorder_app_total"]:<10} {r["clientes_con_bo"]:<10}')

# Markdown.
md = [
    f'# SKUs del catalogo app que NO estan en SAP ({datetime.now().strftime("%Y-%m-%d %H:%M")} ART)',
    '',
    f'Total: **{len(missing)} SKUs**. Comparacion `stock_snapshot/*` vs `sap_products/*`.',
    '',
    'Estos SKUs los puede ver el VDE en el catalogo app, pero SAP no los conoce.',
    'Un pedido con alguno de ellos:',
    '',
    '- Pre-v1475: bloqueaba el pedido entero con `needsManualIntervention`.',
    '- Post-v1475: `commitPedidoCF` lo rechaza preservando la waitlist (CAPA b).',
    '- Si llega al envio por race (sync tardio): se degrada la linea individual + se envia el resto + email alerta a Mariano (CAPA c).',
    '',
    'Pedido Mariano a BI: agregar al catalog SAP, o alias/desalias segun corresponda.',
    '',
    '| SKU | BO app | # clientes con BO |',
    '|---|---:|---:|',
]
for r in rows:
    md.append(f'| `{r["sku"]}` | {r["backorder_app_total"]} | {r["clientes_con_bo"]} |')

OUT_MD.write_text('\n'.join(md), encoding='utf-8')
print()
print(f'Markdown escrito: {OUT_MD}')
