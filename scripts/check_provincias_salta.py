"""Diagnostica el bug del filtro por provincia. Chequea:
1. Que valores unicos tiene el campo provincia en client_applications
2. Cuantos docs quedan si filtro exact match por 'SALTA'
3. Cuantos si hago fuzzy match (upper, trim, sin acento)
"""
import json
import unicodedata
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(json.loads(SA_KEY.read_text())))
db = firestore.client()

def norm(s):
    if not s: return ''
    s = str(s).strip().upper()
    # Remove accents
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
    return s

docs = list(db.collection('client_applications').stream())
print(f'{len(docs)} docs client_applications\n')

from collections import Counter
prov_raw_counts = Counter()
prov_norm_counts = Counter()
salta_docs = []
for d in docs:
    data = d.to_dict() or {}
    raw = data.get('provincia') or ''
    prov_raw_counts[raw] += 1
    prov_norm_counts[norm(raw)] += 1
    if norm(raw) == 'SALTA':
        salta_docs.append({
            '_id': d.id,
            'raw_provincia': repr(raw),
            'comercio': data.get('comercio', ''),
            'localidad': data.get('localidad', ''),
        })

print('=' * 70)
print('VALORES DISTINTOS DE `provincia` (raw)')
print('=' * 70)
for raw, count in sorted(prov_raw_counts.items(), key=lambda x: -x[1]):
    marker = ''
    if 'SALTA' in raw.upper():
        marker = '  <-- contiene SALTA'
    print(f'  {count:3}x  {raw!r}{marker}')

print()
print('=' * 70)
print('CLIENTES DE SALTA (norm)')
print('=' * 70)
for d in salta_docs:
    print(f'  raw_provincia={d["raw_provincia"]:15}  comercio={d["comercio"]!r:50}  loc={d["localidad"]!r}')

print()
print('=' * 70)
print('DIAGNOSTICO')
print('=' * 70)
print(f'Total docs con provincia normalizada "SALTA": {len(salta_docs)}')
print(f'Valores raw distintos que normalizan a "SALTA": {[r for r in prov_raw_counts.keys() if norm(r) == "SALTA"]}')

# Chequear tambien POINTS si podemos - eso viene del build del HTML, no de Firestore
# El filtro exact-match del sidebar hace p.province === currentProvince
# Si POINTS tiene 'SALTA' pero currentProvince viene 'Salta' o algo raro,
# tambien puede fallar. Pero eso es del client-side, no puedo verlo desde aca.
