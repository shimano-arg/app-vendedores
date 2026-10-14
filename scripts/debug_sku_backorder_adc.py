"""Debug: por que un SKU aparece en Reparto pero NO en el modal Backorder.
Causa comun: pedidos con state='BO' pero stage!='confirmed' (modal Backorder
filtra por stage=confirmed, extractClientesBOForSku no).

Uso:
    SKU=EXGTVC66M4AR python scripts/debug_sku_backorder_adc.py
"""
from __future__ import annotations
import os
from google.cloud import firestore

SKU = os.environ.get('SKU', '').strip().upper()
PROJECT = 'app-vendedores-shimano'


def main():
    print(f'=== debug_sku_backorder_adc SKU={SKU} ===')
    db = firestore.Client(project=PROJECT)
    snap = db.collection('pedidos').where('closedAt', '==', None).get()
    docs = list(snap)
    print(f'  pedidos abiertos (closedAt==null): {len(docs)}')
    buckets = {'confirmed_BO': [], 'confirmed_ASIG': [], 'pending_BO': [], 'pending_other': [], 'other_stage_BO': []}
    for d in docs:
        data = d.to_dict() or {}
        stage = data.get('stage')
        lines = data.get('lines') or []
        for i, l in enumerate(lines):
            if not l or not l.get('code'): continue
            if str(l.get('code', '')).upper() != SKU: continue
            state = l.get('state')
            qo = l.get('qtyOpen') or 0
            if qo <= 0: continue
            entry = (d.id, data.get('clientName', ''), stage, state, qo, i)
            if stage == 'confirmed' and state == 'BO':
                buckets['confirmed_BO'].append(entry)
            elif stage == 'confirmed' and state == 'ASIG':
                buckets['confirmed_ASIG'].append(entry)
            elif stage == 'pending' and state == 'BO':
                buckets['pending_BO'].append(entry)
            elif stage == 'pending':
                buckets['pending_other'].append(entry)
            elif state == 'BO':
                buckets['other_stage_BO'].append(entry)
    for k, v in buckets.items():
        print(f'  [{k}] {len(v)} lineas, {sum(x[4] for x in v)} unidades')
        for e in v[:5]:
            print(f'     - {e[1]} (pedido {e[0]}, state={e[3]}, qtyOpen={e[4]}, lineIdx={e[5]})')
    print('=== DONE ===')


if __name__ == '__main__':
    main()
