"""Audita la coleccion `targets` de Firestore para diagnosticar por que
los targets cargados por el gerente Pablo no aparecen en el modal del vendedor.

Read-only. No modifica nada."""
import json
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'

sa_data = json.loads(SA_KEY_PATH.read_text())
cred = credentials.Certificate(sa_data)
firebase_admin.initialize_app(cred)
db = firestore.client()

MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

print('=' * 78)
print('COLECCION targets - DUMP COMPLETO')
print('=' * 78)

docs = list(db.collection('targets').stream())
print(f'\nTotal docs en la coleccion: {len(docs)}\n')

# Agrupar por vendorKey + year
by_vendor_year = {}
raw_dump = []
for d in docs:
    data = d.to_dict() or {}
    doc_id = d.id
    seller = data.get('sellerId', '?')
    year = data.get('year', '?')
    month = data.get('month', '?')
    target = data.get('targetArs', '?')
    updated_by = data.get('updatedByEmail', '?')
    key = f'{seller} | {year}'
    by_vendor_year.setdefault(key, []).append({
        'doc_id': doc_id,
        'month': month,
        'month_name': MESES[month] if isinstance(month, int) and 0 <= month < 12 else '?',
        'targetArs': target,
        'updated_by': updated_by,
    })
    raw_dump.append({
        'doc_id': doc_id,
        'sellerId': seller,
        'year': year,
        'month': month,
        'targetArs': target,
        'updated_by': updated_by,
    })

# Mostrar por grupo
for key in sorted(by_vendor_year.keys()):
    print('-' * 78)
    print(f'{key}')
    print('-' * 78)
    entries = sorted(by_vendor_year[key], key=lambda x: x['month'] if isinstance(x['month'], int) else 99)
    for e in entries:
        print(f"  {e['month_name']:<12} m={e['month']}  target={e['targetArs']:<15}  by={e['updated_by']}  doc={e['doc_id']}")
    print()

# Buscar especificamente los que menciono Pablo (Julio de gonza, fede, martin, mauricio)
print('=' * 78)
print('BUSQUEDA ESPECIFICA - Julio (month=6) de Gonza / Fede / Martin / Mauricio')
print('=' * 78)
target_names = ['gonzalo', 'federico', 'martin', 'mauricio']
julio_hits = []
for d in docs:
    data = d.to_dict() or {}
    seller = (data.get('sellerId') or '').lower()
    if data.get('month') == 6 and any(n in seller for n in target_names):
        julio_hits.append({
            'doc_id': d.id,
            'sellerId': data.get('sellerId'),
            'year': data.get('year'),
            'targetArs': data.get('targetArs'),
            'updated_by': data.get('updatedByEmail'),
            'updated_at': data.get('updatedAt'),
        })

if julio_hits:
    print(f'\nEncontrados {len(julio_hits)} docs para Julio de esos 4 vendedores:')
    for h in julio_hits:
        print(f'  {h}')
else:
    print('\n*** NO se encontraron targets de Julio (month=6) para gonzalo/federico/martin/mauricio ***')

# Chequear todos los ultimos updates para ver por quien fueron
print()
print('=' * 78)
print('ULTIMOS UPDATES POR EMAIL (posiblemente Pablo cargo con otro email)')
print('=' * 78)
by_updater = {}
for d in docs:
    data = d.to_dict() or {}
    email = data.get('updatedByEmail') or '(sin email)'
    by_updater.setdefault(email, 0)
    by_updater[email] += 1
for email, count in sorted(by_updater.items(), key=lambda x: -x[1]):
    print(f'  {email:<45}  {count} doc(s)')

# Sample de docs por email de Pablo
print()
print('=' * 78)
print('DOCS DE PABLO (si su email contiene "pablo" o "maraschin")')
print('=' * 78)
pablo_docs = []
for d in docs:
    data = d.to_dict() or {}
    email = (data.get('updatedByEmail') or '').lower()
    if 'pablo' in email or 'maraschin' in email:
        pablo_docs.append({
            'doc_id': d.id,
            'sellerId': data.get('sellerId'),
            'year': data.get('year'),
            'month': data.get('month'),
            'month_name': MESES[data['month']] if isinstance(data.get('month'), int) and 0 <= data['month'] < 12 else '?',
            'targetArs': data.get('targetArs'),
        })
if pablo_docs:
    for p in pablo_docs:
        print(f'  {p}')
else:
    print('*** No hay docs cargados por email con "pablo" o "maraschin" ***')
