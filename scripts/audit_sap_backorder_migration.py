# -*- coding: utf-8 -*-
"""Audit BO/ASIG en SAP antes de migrar a app-source.

Detecta 6 tipos de mugre para decidir qué cancelar/consolidar antes del cutover:

1. DUP INTRA-SAP: mismo (cardCode, SKU) en 2+ SQs abiertos distintos.
2. SQs VIEJOS: sqDocDate con >90d, >180d, >365d de antigüedad.
3. DUP MES VS MES: mismo (cardCode, SKU) que reaparece en meses distintos.
4. DUP APP VS SAP refinado (además del audit_backorder_overlap existente).
5. CLIENTES INACTIVOS: cardCode no está en `clientes` activos.
6. SKUs DISCONTINUADOS: SKU no está en `products` activos.

Uso: python scripts/audit_sap_backorder_migration.py [--json] [--out reporte.json]
"""
import os, sys, json, argparse
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if SA_KEY.exists():
    os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY.read_text()
sys.stdout.reconfigure(encoding='utf-8')

from sync_sap_to_bigquery import init_firestore, parse_sa_json  # noqa: E402


def load_sap_lines(db):
    """Devuelve TODAS las lineas open del snapshot backorder_snapshot.

    Cada linea tiene: {vendor, cardCode, clienteNombre, sku, producto, familia,
                       subfamilia, sqDocNum, sqDocDate, pendiente, precio,
                       estado, stockActual}
    """
    lines = []
    for doc in db.collection('backorder_snapshot').stream():
        d = doc.to_dict() or {}
        vendor = d.get('vendorKey') or doc.id
        for l in (d.get('lines') or []):
            pend = float(l.get('pendiente') or 0)
            if pend <= 0:
                continue
            sqn = l.get('sqDocNum')
            try:
                sqn = int(sqn) if sqn is not None else None
            except (TypeError, ValueError):
                sqn = None
            docdate = l.get('sqDocDate')
            if isinstance(docdate, str):
                try:
                    docdate = datetime.fromisoformat(docdate.replace('Z', '+00:00'))
                except Exception:
                    docdate = None
            if isinstance(docdate, datetime) and docdate.tzinfo is None:
                docdate = docdate.replace(tzinfo=timezone.utc)
            lines.append({
                'vendor': vendor,
                'cardCode': str(l.get('clienteCode') or '').strip(),
                'clienteNombre': l.get('clienteNombre') or '',
                'sku': str(l.get('sku') or '').upper().strip(),
                'producto': l.get('producto') or '',
                'familia': l.get('familia') or '',
                'subfamilia': l.get('subfamilia') or '',
                'sqDocNum': sqn,
                'sqDocDate': docdate,
                'pendiente': pend,
                'precio': float(l.get('precioUnitario') or 0),
                'estado': l.get('estado') or '',
                'stockActual': float(l.get('stockActual') or 0),
            })
    return lines


def audit_dup_intra_sap(lines):
    """(cardCode, SKU) presente en 2+ SQs distintos abiertos."""
    by_pair = defaultdict(list)  # (cc, sku) -> [line...]
    for l in lines:
        if l['cardCode'] and l['sku']:
            by_pair[(l['cardCode'], l['sku'])].append(l)
    dups = []
    for (cc, sku), grp in by_pair.items():
        sq_set = {l['sqDocNum'] for l in grp if l['sqDocNum']}
        if len(sq_set) >= 2:
            total_pend = sum(l['pendiente'] for l in grp)
            dups.append({
                'cardCode': cc,
                'clienteNombre': grp[0]['clienteNombre'],
                'sku': sku,
                'producto': grp[0]['producto'],
                'num_sqs': len(sq_set),
                'sqs': sorted(sq_set),
                'total_pendiente': total_pend,
                'lines': grp,
            })
    dups.sort(key=lambda x: -x['total_pendiente'])
    return dups


def audit_age(lines, now):
    """Distribución por antigüedad de sqDocDate."""
    buckets = {'0-30d': [], '30-90d': [], '90-180d': [], '180-365d': [], '>365d': [], 'sin_fecha': []}
    for l in lines:
        d = l['sqDocDate']
        if not d:
            buckets['sin_fecha'].append(l)
            continue
        age = (now - d).days
        if age < 30: buckets['0-30d'].append(l)
        elif age < 90: buckets['30-90d'].append(l)
        elif age < 180: buckets['90-180d'].append(l)
        elif age < 365: buckets['180-365d'].append(l)
        else: buckets['>365d'].append(l)
    return buckets


def audit_dup_month_vs_month(lines):
    """(cardCode, SKU) que aparece en 2+ meses distintos."""
    by_pair = defaultdict(lambda: defaultdict(list))  # (cc,sku) -> mes -> [line]
    for l in lines:
        if not l['cardCode'] or not l['sku'] or not l['sqDocDate']:
            continue
        mes = l['sqDocDate'].strftime('%Y-%m')
        by_pair[(l['cardCode'], l['sku'])][mes].append(l)
    multi_mes = []
    for (cc, sku), mes_dict in by_pair.items():
        if len(mes_dict) >= 2:
            meses = sorted(mes_dict.keys())
            spread = 0
            if len(meses) >= 2:
                d1 = datetime.strptime(meses[0], '%Y-%m')
                d2 = datetime.strptime(meses[-1], '%Y-%m')
                spread = (d2.year - d1.year) * 12 + (d2.month - d1.month)
            multi_mes.append({
                'cardCode': cc,
                'clienteNombre': next(iter(mes_dict.values()))[0]['clienteNombre'],
                'sku': sku,
                'producto': next(iter(mes_dict.values()))[0]['producto'],
                'num_meses': len(meses),
                'meses': meses,
                'spread_meses': spread,
                'total_pendiente': sum(sum(l['pendiente'] for l in ls) for ls in mes_dict.values()),
                'por_mes': {m: sum(l['pendiente'] for l in ls) for m, ls in mes_dict.items()},
            })
    multi_mes.sort(key=lambda x: (-x['spread_meses'], -x['total_pendiente']))
    return multi_mes


def load_clientes_activos(db):
    """Lee cardCodes activos. Intenta varias colecciones habituales."""
    activos = set()
    for coll in ('clientesSap', 'clientes'):
        try:
            for doc in db.collection(coll).stream():
                d = doc.to_dict() or {}
                cc = d.get('cardCode') or doc.id
                if cc:
                    activos.add(str(cc).strip())
        except Exception:
            continue
    return activos


def load_skus_activos(db):
    """Lee SKUs activos de coleccion products."""
    activos = set()
    for coll in ('products',):
        try:
            for doc in db.collection(coll).stream():
                d = doc.to_dict() or {}
                # sku o code
                code = d.get('code') or d.get('sku') or doc.id
                if code:
                    activos.add(str(code).upper().strip())
        except Exception:
            continue
    return activos


def audit_clientes_inactivos(lines, activos):
    if not activos:
        return None  # sin data no puede evaluar
    huerfanos = defaultdict(lambda: {'lines': [], 'total_pendiente': 0})
    for l in lines:
        cc = l['cardCode']
        if cc and cc not in activos:
            huerfanos[cc]['lines'].append(l)
            huerfanos[cc]['total_pendiente'] += l['pendiente']
            huerfanos[cc]['clienteNombre'] = l['clienteNombre']
    out = [
        {'cardCode': cc, 'clienteNombre': v['clienteNombre'], 'total_pendiente': v['total_pendiente'],
         'num_lines': len(v['lines'])}
        for cc, v in huerfanos.items()
    ]
    out.sort(key=lambda x: -x['total_pendiente'])
    return out


def audit_skus_discontinuados(lines, activos):
    if not activos:
        return None
    huerfanos = defaultdict(lambda: {'lines': [], 'total_pendiente': 0, 'clientes': set()})
    for l in lines:
        sku = l['sku']
        if sku and sku not in activos:
            huerfanos[sku]['lines'].append(l)
            huerfanos[sku]['total_pendiente'] += l['pendiente']
            huerfanos[sku]['producto'] = l['producto']
            huerfanos[sku]['clientes'].add(l['cardCode'])
    out = [
        {'sku': sku, 'producto': v['producto'], 'total_pendiente': v['total_pendiente'],
         'num_lines': len(v['lines']), 'num_clientes': len(v['clientes'])}
        for sku, v in huerfanos.items()
    ]
    out.sort(key=lambda x: -x['total_pendiente'])
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', help='Path a reporte JSON completo (default: stdout resumen)')
    parser.add_argument('--top', type=int, default=20, help='Top-N casos por sección')
    args = parser.parse_args()

    db = init_firestore(parse_sa_json())
    now = datetime.now(timezone.utc)

    print('Cargando snapshot backorder_snapshot...')
    lines = load_sap_lines(db)
    print(f'  {len(lines)} líneas open ({sum(l["pendiente"] for l in lines):.0f}u totales)')
    unique_sqs = {l['sqDocNum'] for l in lines if l['sqDocNum']}
    unique_pairs = {(l['cardCode'], l['sku']) for l in lines if l['cardCode'] and l['sku']}
    unique_clientes = {l['cardCode'] for l in lines if l['cardCode']}
    unique_skus = {l['sku'] for l in lines if l['sku']}
    print(f'  {len(unique_sqs)} SQs distintos, {len(unique_pairs)} pares (cliente,SKU)')
    print(f'  {len(unique_clientes)} clientes, {len(unique_skus)} SKUs')

    # 1
    print('\n[1/6] Duplicación intra-SAP...')
    dups_intra = audit_dup_intra_sap(lines)

    # 2
    print('[2/6] Antigüedad SQs...')
    buckets = audit_age(lines, now)

    # 3
    print('[3/6] Duplicación mes vs mes...')
    dups_mes = audit_dup_month_vs_month(lines)

    # 5
    print('[5/6] Clientes activos...')
    activos_c = load_clientes_activos(db)
    print(f'  {len(activos_c)} clientes activos en Firestore')
    clientes_off = audit_clientes_inactivos(lines, activos_c)

    # 6
    print('[6/6] SKUs activos...')
    activos_s = load_skus_activos(db)
    print(f'  {len(activos_s)} SKUs activos en Firestore')
    skus_off = audit_skus_discontinuados(lines, activos_s)

    # =============== REPORTE ===============
    print('\n' + '=' * 100)
    print('REPORTE AUDIT MIGRACIÓN SAP → APP-SOURCE — ' + now.strftime('%Y-%m-%d %H:%M UTC'))
    print('=' * 100)

    print(f'\n### RESUMEN ###')
    print(f'  Líneas open en SAP: {len(lines)} ({sum(l["pendiente"] for l in lines):.0f}u)')
    print(f'  SQs distintos: {len(unique_sqs)}')
    print(f'  Clientes involucrados: {len(unique_clientes)}')
    print(f'  SKUs involucrados: {len(unique_skus)}')

    print(f'\n### [1] DUP INTRA-SAP — (cliente,SKU) en 2+ SQs distintos ###')
    print(f'  {len(dups_intra)} pares afectados')
    if dups_intra:
        total_dup_u = sum(d['total_pendiente'] for d in dups_intra)
        print(f'  Total pendiente en dups: {total_dup_u:.0f}u')
        print(f'  Top {args.top}:')
        print(f'    {"cliente":<40} {"SKU":<18} {"SQs":<6} {"pend":<6}')
        for d in dups_intra[:args.top]:
            print(f'    {d["clienteNombre"][:40]:<40} {d["sku"]:<18} {d["num_sqs"]:<6} {d["total_pendiente"]:>5.0f}')

    print(f'\n### [2] ANTIGÜEDAD SQs ###')
    for k, v in buckets.items():
        print(f'  {k:<12}: {len(v):>5} líneas / {sum(l["pendiente"] for l in v):>7.0f}u')

    print(f'\n### [3] DUP MES VS MES — mismo (cliente,SKU) reaparece ###')
    print(f'  {len(dups_mes)} pares en 2+ meses')
    if dups_mes:
        old_spreads = [d for d in dups_mes if d['spread_meses'] >= 3]
        print(f'  Con spread >=3 meses: {len(old_spreads)}')
        print(f'  Top {args.top} por spread:')
        print(f'    {"cliente":<38} {"SKU":<18} {"meses":<8} {"spread":<7} {"pend":<6}')
        for d in dups_mes[:args.top]:
            print(f'    {d["clienteNombre"][:38]:<38} {d["sku"]:<18} {d["num_meses"]:<8} {d["spread_meses"]:<7} {d["total_pendiente"]:>5.0f}')

    print(f'\n### [5] CLIENTES INACTIVOS en SQs abiertos ###')
    if clientes_off is None:
        print('  (skip — no encontré colección clientes activos)')
    else:
        print(f'  {len(clientes_off)} cardCodes que NO están en clientes activos')
        for c in clientes_off[:args.top]:
            print(f'    {c["cardCode"]:<14} {c["clienteNombre"][:40]:<40} pend={c["total_pendiente"]:.0f}u')

    print(f'\n### [6] SKUs DISCONTINUADOS en SQs abiertos ###')
    if skus_off is None:
        print('  (skip — no encontré colección products activa)')
    else:
        print(f'  {len(skus_off)} SKUs que NO están en products activos')
        for s in skus_off[:args.top]:
            print(f'    {s["sku"]:<18} {s["producto"][:45]:<45} pend={s["total_pendiente"]:.0f}u clientes={s["num_clientes"]}')

    # dump full JSON
    if args.out:
        # convert datetimes
        def clean(o):
            if isinstance(o, datetime): return o.isoformat()
            if isinstance(o, set): return sorted(o)
            return str(o)
        report = {
            'timestamp': now.isoformat(),
            'resumen': {
                'total_lines': len(lines),
                'total_pendiente': sum(l['pendiente'] for l in lines),
                'unique_sqs': len(unique_sqs),
                'unique_clientes': len(unique_clientes),
                'unique_skus': len(unique_skus),
            },
            'dup_intra_sap': dups_intra,
            'antiguedad': {k: {'count': len(v), 'pendiente': sum(l['pendiente'] for l in v)} for k, v in buckets.items()},
            'dup_mes_vs_mes': dups_mes,
            'clientes_inactivos': clientes_off,
            'skus_discontinuados': skus_off,
        }
        Path(args.out).write_text(json.dumps(report, indent=2, default=clean, ensure_ascii=False), encoding='utf-8')
        print(f'\n📄 Reporte completo en: {args.out}')


if __name__ == '__main__':
    main()
