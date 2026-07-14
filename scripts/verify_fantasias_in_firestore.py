"""Verifica que las fantasias del bulk import quedaron en Firestore
y diagnostica por que no aparecen en la app."""
import json
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(json.loads(SA_KEY.read_text())))
db = firestore.client()

# Nombres visibles en la captura del user (que deberian tener fantasia visible)
TARGETS = [
    'ADRIAN HORACIO VALIÑA',
    'AGUSTIN BEBER',
    'ALAN OSCAR NICOLAS RODRIGUEZ',
    'ALBERTO MAXERA',
    'ALBERTO PONTORIERO',
    'ALDANA MICAELA BOTTINI',
    'ALDO JUAN TARICCO',
    'ALEJANDRO EMANUEL SIMBRON',
]

# Cargar todos y filtrar por match parcial (comercio/titular contiene el nombre)
print('Cargando client_applications...')
docs = list(db.collection('client_applications').stream())
print(f'{len(docs)} docs\n')

def _n(s):
    return (s or '').strip().upper()

hits_by_name = {}
for name in TARGETS:
    hits_by_name[name] = []
    n_up = _n(name)
    for d in docs:
        data = d.to_dict() or {}
        com = _n(data.get('comercio', ''))
        tit = _n(data.get('titular', ''))
        if n_up in com or n_up in tit or com == n_up or tit == n_up:
            hits_by_name[name].append({'_id': d.id, 'data': data})

print('=' * 70)
print('VERIFICACION POR CLIENTE')
print('=' * 70)
for name in TARGETS:
    hits = hits_by_name[name]
    print()
    print(f'--- {name} ---')
    if not hits:
        print(f'  !!! SIN MATCH en client_applications')
        continue
    for h in hits:
        d = h['data']
        cc = d.get('cardCodeSap', '')
        cuit = d.get('cuit', '')
        com = d.get('comercio', '')
        fant = d.get('fantasia', '')
        src = d.get('fantasiaSource', '')
        prov = d.get('provincia', '')
        loc = d.get('localidadFinal') or d.get('localidad', '')
        flag = ''
        if fant.strip().lower() == com.strip().lower():
            flag = '  <-- fantasia == comercio (no se muestra grande)'
        elif not fant:
            flag = '  <-- fantasia vacia'
        else:
            flag = '  <-- OK, deberia verse "' + fant + '"'
        print(f'  doc={h["_id"][:22]}')
        print(f'    cardCode={cc}  cuit={cuit}')
        print(f'    comercio={com!r}')
        print(f'    fantasia={fant!r}  source={src!r}')
        print(f'    prov={prov!r} loc={loc!r}')
        print(f'    {flag}')

# Chequeo global
print()
print('=' * 70)
print('STATS GLOBALES')
print('=' * 70)
n_bulk = sum(1 for d in docs if (d.to_dict() or {}).get('fantasiaSource', '').startswith('bulk_excel'))
print(f'Docs con fantasiaSource=bulk_excel_*: {n_bulk} (esperamos ~103)')

# Distribucion fantasia real vs sin fantasia
n_con_fant_real = 0
n_sin_fant = 0
n_fant_igual_comercio = 0
for d in docs:
    data = d.to_dict() or {}
    fant = (data.get('fantasia') or '').strip()
    com = (data.get('comercio') or '').strip()
    if not fant:
        n_sin_fant += 1
    elif fant.lower() == com.lower():
        n_fant_igual_comercio += 1
    else:
        n_con_fant_real += 1
print(f'Docs con fantasia real (distinta de comercio): {n_con_fant_real}')
print(f'Docs con fantasia == comercio: {n_fant_igual_comercio}')
print(f'Docs sin fantasia: {n_sin_fant}')
