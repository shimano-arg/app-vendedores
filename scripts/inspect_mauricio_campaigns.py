"""Diagnostico: listar todas las campanias y buscar MAURICIO en cualquier campo.
"""
from __future__ import annotations
from google.cloud import firestore

db = firestore.Client(project='app-vendedores-shimano')
all_snap = db.collection('campaigns').get()
total = 0
activa = 0
with_mau = []
all_vendors = set()
for d in all_snap:
    total += 1
    data = d.to_dict() or {}
    if data.get('archivedManually') is True:
        continue
    activa += 1
    name = str(data.get('name') or '')
    scope = data.get('scope') or ''
    sv = data.get('scopeValues') or []
    for v in sv:
        all_vendors.add(str(v).strip())
    blob = (name + ' ' + ' '.join(str(x) for x in sv)).upper()
    if 'MAURI' in blob:
        with_mau.append((d.id, name, scope, sv, data.get('startDate'), data.get('endDate')))

print(f'total campanias: {total}')
print(f'activas (no archivedManually): {activa}')
print(f'activas con "MAURI" en nombre o scopeValues: {len(with_mau)}')
for cid, n, s, sv, sd, ed in with_mau:
    print(f'  - {cid}: "{n}" scope={s} scopeValues={sv} dates={sd}->{ed}')
print(f'\nvalores unicos en scopeValues (todas activas): {sorted(all_vendors)[:50]}')
