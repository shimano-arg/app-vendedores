"""Cruza los clientes de POINTS de Salta contra client_applications para
ver si estan cargados con provincia distinta (o no lo estan)."""
import json
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(json.loads(SA_KEY.read_text())))
db = firestore.client()

# Nombres de POINTS Salta (extraidos del parse de arriba)
POINTS_SALTA = {
    'Salta Capital': ['TOMPY PESCA','BELLONE PABLO EDGARDO','SANTA FE AVENTURA'],
    'Cerrillos':     ['EL PINGUINO','VON CLIA'],
    'Tartagal':      ['LAS 4 BOCAS'],
    'Rosario de la Frontera': ['ARMERIA DON ANGEL'],
}

def _n(s):
    return (s or '').strip().upper()

docs = list(db.collection('client_applications').stream())
print(f'{len(docs)} docs\n')

# Chequeo cada cliente de POINTS Salta si tiene doc en Firestore
for loc, tiendas in POINTS_SALTA.items():
    print('=' * 70)
    print(f'LOCALIDAD: {loc}')
    print('=' * 70)
    for tienda in tiendas:
        t_up = _n(tienda)
        # buscar match en client_applications por comercio, titular o fantasia
        hits = []
        for d in docs:
            data = d.to_dict() or {}
            for k in ('comercio', 'titular', 'fantasia'):
                if _n(data.get(k, '')) == t_up:
                    hits.append({'_id': d.id, 'matched_field': k, 'data': data})
                    break
                # match parcial: nombre esta contenido en el campo
                elif t_up in _n(data.get(k, '')):
                    hits.append({'_id': d.id, 'matched_field': k + ' (partial)', 'data': data})
                    break
        print(f'\n  Cliente POINTS: {tienda!r}')
        if not hits:
            print(f'    !! SIN MATCH en client_applications')
        else:
            for h in hits:
                d = h['data']
                print(f'    match_via={h["matched_field"]:20}  doc={h["_id"][:22]}')
                print(f'      comercio={d.get("comercio", "")!r}')
                print(f'      fantasia={d.get("fantasia", "")!r}')
                print(f'      provincia={d.get("provincia", "")!r}  <-- si es "" o != SALTA, ese es el bug')
                print(f'      cardCodeSap={d.get("cardCodeSap", "")!r}')
                print(f'      calle={d.get("calle", "")!r}')

# Chequeo tambien client_master
print()
print('=' * 70)
print('CHECK client_master para SALTA')
print('=' * 70)
cm = list(db.collection('client_master').stream())
salta_cm = []
for d in cm:
    data = d.to_dict() or {}
    prov = _n(data.get('provincia', '') or data.get('sapState', ''))
    if 'SALTA' in prov:
        salta_cm.append({'_id': d.id, 'data': data})
print(f'client_master con provincia contiene SALTA: {len(salta_cm)}')
for s in salta_cm[:10]:
    d = s['data']
    print(f'  doc={s["_id"][:30]:30}  clientName={d.get("clientName")!r}  sapCardCode={d.get("sapCardCode")!r}  address={d.get("address")!r}')
