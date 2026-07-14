"""Valida el mapeo canonico vendorKey app -> SlpCode SAP contra la
coleccion sap_vendors de Firestore (fuente de verdad, poblada por el
admin desde la Integracion SAP). Tambien lista los targets crudos."""
import json
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
sa_data = json.loads(SA_KEY_PATH.read_text())
cred = credentials.Certificate(sa_data)
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

# Mapeo que dio el user
EXPECTED = {
    'GONZALO DE LA ROSA':    50,
    'MAURICIO GIL':          51,
    'IOANNIS PALKOUDAKIS':   52,
    'SANTIAGO ESTEBAN':      53,
    'FEDERICO CASTELANELLI': 54,
    'MARTIN BOIERO':         55,
}
EXCLUDE = {49}  # SlpCode admin (Mariano), no comercial

print('=' * 70)
print('1) sap_vendors en Firestore (mapeo canonico app -> SAP)')
print('=' * 70)
sap_vendors = list(db.collection('sap_vendors').stream())
print(f'Total docs: {len(sap_vendors)}\n')
mapping = {}
for d in sap_vendors:
    data = d.to_dict() or {}
    vk = (data.get('vendorKey') or '').upper()
    slp = data.get('slpCode')
    name = data.get('slpName', '')
    zone = data.get('zone', '')
    mapping[vk] = slp
    print(f'  vendorKey={vk:30}  slpCode={slp}  slpName={name:35}  zone={zone}')

print()
print('=' * 70)
print('2) VALIDACION contra mapeo esperado por el user')
print('=' * 70)
ok = True
for vk, expected_slp in EXPECTED.items():
    real = mapping.get(vk)
    if real == expected_slp:
        print(f'  OK   {vk:30} -> {real}')
    elif real is None:
        print(f'  MISS {vk:30} -> NO EN sap_vendors (esperado {expected_slp})')
        ok = False
    else:
        print(f'  DIFF {vk:30} -> Firestore dice {real}, user dice {expected_slp}')
        ok = False

# SlpCode 49 excluido?
slp_49_docs = [d for d in sap_vendors if (d.to_dict() or {}).get('slpCode') == 49]
if slp_49_docs:
    print(f'\n  WARN: hay {len(slp_49_docs)} doc(s) con slpCode=49 en sap_vendors:')
    for d in slp_49_docs:
        print(f'    {d.to_dict()}')
    print(f'    (segun user, 49 = Mariano admin, NO debe ser vendedor comercial)')
else:
    print(f'\n  OK   Ningun doc en sap_vendors tiene slpCode=49')

print()
print('=' * 70)
print('3) targets cargados en Firestore (los que hay que sincronizar)')
print('=' * 70)
targets = list(db.collection('targets').stream())
print(f'Total docs: {len(targets)}\n')
for d in targets:
    data = d.to_dict() or {}
    seller = data.get('sellerId', '?')
    year = data.get('year', '?')
    month = data.get('month', '?')  # 0-11
    val = data.get('targetArs', '?')
    upd_by = data.get('updatedByEmail', '?')
    upd_at = data.get('updatedAt')
    upd_ts = upd_at.isoformat() if upd_at else '-'
    slp = mapping.get((seller or '').upper(), 'NO_MAP')
    slp_flag = ''
    if slp == 'NO_MAP': slp_flag = '  <-- NO ENCUENTRO SlpCode'
    elif slp == 49:     slp_flag = '  <-- SlpCode 49 = EXCLUIR'
    print(f'  doc={d.id:35}  seller={seller:22}  y={year}  m={month:>2}  target={val:>13}  slp={slp}{slp_flag}')
    print(f'    updated: {upd_by} @ {upd_ts}')

print()
print('=' * 70)
print(f'RESUMEN: mapeo user vs firestore = {"OK" if ok else "TIENE DIFERENCIAS"}')
print(f'         targets a sincronizar   = {len(targets)}')
print('=' * 70)
