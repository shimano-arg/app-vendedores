# -*- coding: utf-8 -*-
"""Migra BO/ASIG SAP → pedidos-app sintéticos en Firestore.

Objetivo (Mariano 2026-08-28): replicar el 100% del snapshot backorder SAP
como pedidos-app, para poder trabajar todo desde la app sin depender de SQs
abiertos en SAP. NO cancela SQs en SAP.

Uso:
    python scripts/migrate_sap_backorder_to_app.py --dry-run   # simula
    python scripts/migrate_sap_backorder_to_app.py --apply     # escribe Firestore

Idempotencia:
- Si ya existe un pedido-app con transferidoSAP.docEntry == X, se SKIP.
- Cubre los ~6 SQs del rango 2000xxx que ya tienen pedido-app.

Diseño del pedido-app sintético:
- 1 pedido por SQ (agrupa todas las líneas por sqDocNum/DocEntry)
- state='BO' en todas las líneas (la app recalcula ASIG cuando llegue stock)
- createdAt = sqDocDate original (respeta timeline)
- vendedor = vendorKey del backorder_snapshot ('(SIN ASIGNAR)' si desconocido)
- transferidoSAP.via = 'sap_migration_2026-08-28' (identificador claro)
- migrationSource = 'sap_snapshot_2026-08-28' (para audit/rollback)

Fuentes:
1. Firestore backorder_snapshot/{vendor}.lines[] — tiene DocNum, sqDocDate,
   clienteCode, clienteNombre, sku, pendiente, precioUnitario
2. BigQuery sap_quotations_raw — para resolver DocNum → DocEntry
   (el snapshot Firestore no trae DocEntry)
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if SA_KEY.exists():
    os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY.read_text()
sys.stdout.reconfigure(encoding='utf-8')

from sync_sap_to_bigquery import init_firestore, parse_sa_json  # noqa: E402
from firebase_admin import firestore  # noqa: E402

MIGRATION_TAG = 'sap_snapshot_2026-08-28'
VIA_TAG = 'sap_migration_2026-08-28'


def log(msg):
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}')


def load_snapshot(db):
    """Lee backorder_snapshot/{vendor} agrupando líneas por SQ.

    Devuelve: dict {(sqDocNum, clienteCode): {vendor, clienteNombre,
                                              sqDocDate, lines: [...]}}
    """
    by_sq = {}
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
            if not sqn:
                continue
            cc = str(l.get('clienteCode') or '').strip()
            if not cc:
                continue
            sqdate = l.get('sqDocDate')
            if isinstance(sqdate, str):
                try:
                    sqdate = datetime.fromisoformat(sqdate.replace('Z', '+00:00'))
                except Exception:
                    sqdate = None
            if isinstance(sqdate, datetime) and sqdate.tzinfo is None:
                sqdate = sqdate.replace(tzinfo=timezone.utc)
            key = (sqn, cc)
            if key not in by_sq:
                by_sq[key] = {
                    'sqDocNum': sqn,
                    'clientCardCode': cc,
                    'clientName': l.get('clienteNombre') or '',
                    'clientCity': l.get('clienteCiudad') or '',
                    'sqDocDate': sqdate,
                    'vendor': vendor,
                    'lines': [],
                }
            by_sq[key]['lines'].append({
                'code': str(l.get('sku') or '').upper().strip(),
                'name': l.get('producto') or '',
                'familia': l.get('familia') or '',
                'subfamilia': l.get('subfamilia') or '',
                'qty': pend,
                'qtyOpen': pend,
                'priceAtCreation': float(l.get('precioUnitario') or 0),
                'state': 'BO',
                'qtyInvoiced': 0,
                'qtyCancelled': 0,
                'qtyRecycled': 0,
            })
    return by_sq


def resolve_docentry_by_docnum(sq_doc_nums):
    """Consulta BigQuery para mapear sqDocNum → DocEntry."""
    from google.cloud import bigquery
    from google.oauth2 import service_account
    creds_info = json.loads(Path.home().joinpath('Desktop', 'sa-key.json').read_text())
    creds = service_account.Credentials.from_service_account_info(creds_info)
    bq = bigquery.Client(project='app-vendedores-shimano', credentials=creds)
    q = f'''
    SELECT doc_num, doc_entry
    FROM `app-vendedores-shimano.shimano_app.sap_quotations_raw`
    WHERE doc_num IN ({','.join(str(n) for n in sq_doc_nums)})
    '''
    return {r.doc_num: r.doc_entry for r in bq.query(q).result()}


def load_existing_transferidos(db):
    """Devuelve set de docEntry ya presentes en pedidos con transferidoSAP.docEntry."""
    existing = set()
    for doc in db.collection('pedidos').stream():
        d = doc.to_dict() or {}
        ts = d.get('transferidoSAP') or {}
        de = ts.get('docEntry')
        if de:
            try:
                existing.add(int(de))
            except (TypeError, ValueError):
                pass
    return existing


def build_pedido_doc(sq_info, doc_entry, now):
    """Construye el dict que va a Firestore para un SQ."""
    total_qty = sum(l['qty'] for l in sq_info['lines'])
    total_amt = sum(l['qty'] * l['priceAtCreation'] for l in sq_info['lines'])
    return {
        'clientCardCode': sq_info['clientCardCode'],
        'clientName': sq_info['clientName'],
        'clientCity': sq_info['clientCity'],
        'vendedor': sq_info['vendor'],
        'createdAt': sq_info['sqDocDate'] or now,
        'lines': sq_info['lines'],
        'closedAt': None,
        'closedReason': None,
        'schemaVersion': 2,
        'migrationSource': MIGRATION_TAG,
        'migratedAt': now,
        'transferidoSAP': {
            'docEntry': doc_entry,
            'docNum': sq_info['sqDocNum'],
            'via': VIA_TAG,
            'sapDocRange': str(sq_info['sqDocNum']),
            'transferredAt': (sq_info['sqDocDate'] or now).isoformat() if isinstance(sq_info['sqDocDate'] or now, datetime) else str(now),
            'transferredBy': 'sap_migration_script',
        },
        'sapLinkage': {
            'soDocEntry': None,
            'lastSyncAt': None,
            'lastInvoiceDocEntry': None,
        },
        'totalUnits': total_qty,
        'totalAmountArs': total_amt,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--limit', type=int, help='Limitar N SQs (test)')
    args = parser.parse_args()
    if not (args.dry_run or args.apply):
        log('[FATAL] Usar --dry-run o --apply')
        sys.exit(1)

    mode = 'DRY-RUN' if args.dry_run else 'APPLY'
    log(f'=== MIGRACIÓN BO SAP → APP — modo {mode} ===')
    db = init_firestore(parse_sa_json())

    # 1) Snapshot
    log('Cargando backorder_snapshot...')
    by_sq = load_snapshot(db)
    log(f'  {len(by_sq)} SQs distintos, {sum(len(v["lines"]) for v in by_sq.values())} líneas totales')

    # 2) Existing pedidos-app con transferidoSAP.docEntry
    log('Cargando pedidos-app existentes con transferidoSAP...')
    existing = load_existing_transferidos(db)
    log(f'  {len(existing)} pedidos-app ya tienen SAP link (skip esos)')

    # 3) Resolver DocNum → DocEntry via BQ
    doc_nums = sorted({info['sqDocNum'] for info in by_sq.values()})
    log(f'Resolviendo DocNum → DocEntry en BQ ({len(doc_nums)} SQs)...')
    docentry_map = resolve_docentry_by_docnum(doc_nums)
    log(f'  {len(docentry_map)} mapeos resueltos')

    # 4) Preparar batch
    now = datetime.now(timezone.utc)
    to_create = []
    skipped_existing = []
    skipped_no_entry = []
    for key, info in by_sq.items():
        docn = info['sqDocNum']
        de = docentry_map.get(docn)
        if de is None:
            skipped_no_entry.append((docn, info['clientName']))
            continue
        if de in existing:
            skipped_existing.append((docn, de, info['clientName']))
            continue
        to_create.append((info, de))

    if args.limit:
        to_create = to_create[:args.limit]

    log('')
    log(f'📊 PLAN:')
    log(f'  🆕 Crear pedidos-app: {len(to_create)}')
    log(f'  ⏭️  Skip (ya migrados): {len(skipped_existing)}')
    log(f'  ⚠️  Skip (sin DocEntry en BQ): {len(skipped_no_entry)}')

    total_u = sum(sum(l['qty'] for l in info['lines']) for info, _ in to_create)
    total_lines = sum(len(info['lines']) for info, _ in to_create)
    log(f'  Unidades a migrar: {total_u:.0f}u en {total_lines} líneas')

    # Muestra top 10
    log('')
    log(f'=== TOP 10 SQs a crear (por unidades) ===')
    top = sorted(to_create, key=lambda x: -sum(l['qty'] for l in x[0]['lines']))[:10]
    for info, de in top:
        u = sum(l['qty'] for l in info['lines'])
        log(f'  SQ {info["sqDocNum"]:<8} (entry {de:<6}) {info["clientName"][:34]:<34} {len(info["lines"])} líneas / {u:.0f}u  vendor={info["vendor"][:15]}')

    if skipped_no_entry:
        log('')
        log(f'⚠️  SQs sin DocEntry en BQ (no encontrados en sap_quotations_raw):')
        for docn, name in skipped_no_entry[:10]:
            log(f'  SQ {docn}  {name}')

    if skipped_existing:
        log('')
        log(f'⏭️  Ya migrados (skip):')
        for docn, de, name in skipped_existing[:10]:
            log(f'  SQ {docn} (entry {de})  {name}')

    # 5) Escribir a Firestore
    if args.dry_run:
        log('')
        log('[dry-run] no toco Firestore')
    else:
        log('')
        log(f'Escribiendo {len(to_create)} pedidos-app a Firestore...')
        batch = db.batch()
        batch_size = 0
        written = 0
        for info, de in to_create:
            payload = build_pedido_doc(info, de, now)
            ref = db.collection('pedidos').document()
            batch.set(ref, payload)
            batch_size += 1
            if batch_size >= 400:
                batch.commit()
                written += batch_size
                log(f'  batch commit: {written}/{len(to_create)}')
                batch = db.batch()
                batch_size = 0
        if batch_size > 0:
            batch.commit()
            written += batch_size
        log(f'  Total escritos: {written}')

    # Audit log
    audit = {
        'mode': mode,
        'startedAt': now.isoformat(),
        'candidatos': len(by_sq),
        'creados': 0 if args.dry_run else len(to_create),
        'skipped_existing': len(skipped_existing),
        'skipped_no_entry': len(skipped_no_entry),
        'total_units': total_u,
        'migration_tag': MIGRATION_TAG,
    }
    ts = now.strftime('%Y-%m-%dT%H%M%SZ')
    docid = f'migrate_sap_bo_{ts}_{"dry" if args.dry_run else "apply"}'
    db.collection('sap_sync_log').document(docid).set(audit)
    log(f'Audit log: sap_sync_log/{docid}')


if __name__ == '__main__':
    main()
