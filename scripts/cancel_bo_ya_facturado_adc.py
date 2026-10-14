"""Cancelar lineas BO que ya se facturaron (audit sep+oct).

Match: para cada (cliente+sku) de la lista YA_FACTURADO (fact_qty >= bo_qty),
buscar en Firestore pedidos abiertos (closedAt=null, stage=confirmed) con lineas
state='BO' qtyOpen>0 del mismo SKU + mismo cliente (uppercase trimmed name).
Cancelar hasta la cantidad del BO del CSV (nunca mas).

Marca cada linea: state='cancelled', qtyOpen=0, cancelledAt=now,
cancelledFrom='audit-ya-facturado', cancelledFromCsvBo=<csv_bo>, cancelledFromCsvFact=<csv_fact>.

Uso:
    DRY_RUN=true  python scripts/cancel_bo_ya_facturado_adc.py
    DRY_RUN=false python scripts/cancel_bo_ya_facturado_adc.py
"""
from __future__ import annotations
import csv, os
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
from google.cloud import firestore

DESKTOP = Path(r'C:\Users\shimano.sandbox\Desktop')
BO_CSV = DESKTOP / 'BACKORDER.csv'
FACT_CSV = DESKTOP / 'FACTURADO SEPTIEMBRE + OCTUBRE.csv'
PROJECT = 'app-vendedores-shimano'
DRY_RUN = (os.environ.get('DRY_RUN', 'true').lower() != 'false')


def _norm_cli(s): return (s or '').strip().upper()
def _norm_sku(s): return (s or '').strip().upper()


def _parse_int(s):
    try:
        return int(str(s).replace(',', '.').split('.')[0])
    except Exception:
        return 0


def _iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def load_targets():
    """Return list of {cliente, sku, bo_qty, fact_qty} donde fact >= bo."""
    bo_rows = {}  # (cli, sku) -> bo_qty
    with open(BO_CSV, encoding='utf-8-sig', newline='') as f:
        rdr = csv.DictReader(f)
        for r in rdr:
            sku = _norm_sku(r.get('SKU'))
            cli = _norm_cli(r.get('Cliente'))
            bo = _parse_int(r.get('Backorder ') or r.get('Backorder'))
            if not sku or not cli or bo <= 0: continue
            bo_rows[(cli, sku)] = bo
    fact_agg = defaultdict(int)
    with open(FACT_CSV, encoding='utf-8-sig', newline='') as f:
        rdr = csv.DictReader(f)
        for r in rdr:
            cli = _norm_cli(r.get('card_name'))
            sku = _norm_sku(r.get('item_code'))
            qty = _parse_int(r.get('Cantidad'))
            if not cli or not sku: continue
            fact_agg[(cli, sku)] += qty
    targets = []
    for (cli, sku), bo_qty in bo_rows.items():
        fact_qty = fact_agg.get((cli, sku), 0)
        if fact_qty >= bo_qty:
            targets.append({'cliente': cli, 'sku': sku, 'bo_qty': bo_qty, 'fact_qty': fact_qty})
    return targets


def main():
    print('=== cancel_bo_ya_facturado_adc START ===')
    print(f'  DRY_RUN: {DRY_RUN}')
    targets = load_targets()
    print(f'  targets (fact >= bo): {len(targets)}')
    db = firestore.Client(project=PROJECT)
    snap = db.collection('pedidos').where('closedAt', '==', None).get()
    pedidos = []
    for p in snap:
        d = p.to_dict() or {}
        if d.get('stage') != 'confirmed': continue
        pedidos.append((p.id, p.reference, d))
    print(f'  pedidos abiertos confirmed: {len(pedidos)}')
    # index: (cli_up, sku_up) -> list of (pedidoId, pedidoRef, lineIndex, qtyOpen)
    by_cli_sku = defaultdict(list)
    for pid, pref, data in pedidos:
        cli = _norm_cli(data.get('clientName'))
        lines = data.get('lines') or []
        for i, l in enumerate(lines):
            if not l or not l.get('code'): continue
            if l.get('state') != 'BO': continue
            qo = int(l.get('qtyOpen') or 0)
            if qo <= 0: continue
            sku = _norm_sku(l.get('code'))
            by_cli_sku[(cli, sku)].append({
                'pid': pid, 'ref': pref, 'lineIdx': i, 'qo': qo, 'linea': l,
            })
    print(f'  (cliente+sku) con BO en Firestore: {len(by_cli_sku)}')
    # Match + plan de cancelacion.
    plan = []
    no_match = []
    for t in targets:
        key = (t['cliente'], t['sku'])
        fs_bos = by_cli_sku.get(key)
        if not fs_bos:
            no_match.append(t)
            continue
        # cancelar hasta bo_qty — ordenar por qtyOpen ASC para favorecer cancelar
        # las lineas chicas primero (y evitar partials). Si total <= bo_qty, todas.
        fs_bos_sorted = sorted(fs_bos, key=lambda x: x['qo'])
        remaining = t['bo_qty']
        for fs in fs_bos_sorted:
            if remaining <= 0: break
            qo = fs['qo']
            take = min(qo, remaining)
            full = (take == qo)
            plan.append({
                'cliente': t['cliente'], 'sku': t['sku'],
                'pedidoId': fs['pid'], 'lineIndex': fs['lineIdx'],
                'qtyOpen_actual': qo, 'take': take, 'full_cancel': full,
                'csv_bo_qty': t['bo_qty'], 'csv_fact_qty': t['fact_qty'],
                'ref': fs['ref'], 'linea': fs['linea'],
            })
            remaining -= take
    print(f'  plan: {len(plan)} lineas a cancelar')
    print(f'  no match (cliente+sku no encontrado en Firestore): {len(no_match)}')
    for t in no_match[:10]:
        print(f'    - {t["cliente"]} / {t["sku"]} (bo={t["bo_qty"]})')
    if no_match[10:]:
        print(f'    ... y {len(no_match) - 10} mas')
    # Preview primeros 10 del plan.
    for p in plan[:10]:
        print(f'    * {p["cliente"]} / {p["sku"]} pedido={p["pedidoId"]} line={p["lineIndex"]} qo={p["qtyOpen_actual"]} take={p["take"]} full={p["full_cancel"]}')
    if plan[10:]:
        print(f'    ... y {len(plan) - 10} mas')
    if DRY_RUN:
        print('=== DONE (DRY_RUN) ===')
        return
    # Apply: agrupar por pedido para 1 tx por doc.
    by_pedido = defaultdict(list)
    for p in plan: by_pedido[p['pedidoId']].append(p)
    now_iso = _iso()
    cancelled_count = 0
    for pid, items in by_pedido.items():
        try:
            ref = items[0]['ref']
            @firestore.transactional
            def _tx(txn, ref=ref, items=items):
                nonlocal cancelled_count
                snap_ = ref.get(transaction=txn)
                data = snap_.to_dict() or {}
                lines = list(data.get('lines') or [])
                for it in items:
                    li = it['lineIndex']
                    if li >= len(lines): continue
                    line = lines[li]
                    if not line or line.get('state') != 'BO': continue
                    qo = int(line.get('qtyOpen') or 0)
                    if qo <= 0: continue
                    take = min(qo, it['take'])
                    if take <= 0: continue
                    new_line = dict(line)
                    if take == qo:
                        new_line['state'] = 'cancelled'
                        new_line['qtyOpen'] = 0
                        new_line['qtyCancelled'] = (int(line.get('qtyCancelled') or 0)) + qo
                    else:
                        new_line['qtyOpen'] = qo - take
                        new_line['partialCancelAt'] = now_iso
                        new_line['partialCancelFrom'] = 'audit-ya-facturado'
                        new_line['partialCancelQty'] = (int(line.get('partialCancelQty') or 0)) + take
                    new_line['cancelledFrom'] = 'audit-ya-facturado'
                    new_line['cancelledAt'] = now_iso
                    new_line['cancelledCsvBoQty'] = it['csv_bo_qty']
                    new_line['cancelledCsvFactQty'] = it['csv_fact_qty']
                    lines[li] = new_line
                    cancelled_count += 1
                txn.update(ref, {'lines': lines, 'updatedAt': now_iso})
            txn = db.transaction()
            _tx(txn)
        except Exception as e:
            print(f'    [ERR] pedido {pid}: {e}')
    print(f'  Cancelled: {cancelled_count} lineas')
    # Audit log en coleccion dedicada.
    try:
        db.collection('audit_bo_ya_facturado_log').add({
            'runAt': now_iso,
            'targets': len(targets),
            'planLineas': len(plan),
            'cancelled': cancelled_count,
            'noMatchCount': len(no_match),
            'noMatchSample': [f"{t['cliente']}/{t['sku']} ({t['bo_qty']}u)" for t in no_match[:20]],
            'source': 'script cancel_bo_ya_facturado_adc.py',
        })
    except Exception as _e:
        pass
    print('=== DONE (APPLIED) ===')


if __name__ == '__main__':
    main()
