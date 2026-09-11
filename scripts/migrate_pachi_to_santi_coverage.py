"""
Migracion Pachi -> Santi (coverage) 2026-09-11.

Contexto: Diego (director) confirmo 2026-09-10 que PACHI no es empleado
Shimano. La cartera oficial pasa a SANTIAGO ESTEBAN (SAP + comisiones),
pero mantenemos coverageBy='PACHI' durante 3 meses de trial (hasta
2026-12-11) para medir la coverage presencial.

Cambios por cada client_applications con assignedVendor='PACHI':
  - assignedVendor: 'PACHI' -> 'SANTIAGO ESTEBAN'
  - coverageBy: 'PACHI'                (nuevo campo)
  - coverageTrialEndDate: '2026-12-11' (nuevo campo)
  - assignedVendorHistory: appended audit entry (nuevo campo, defensivo)

Uso:
  python scripts/migrate_pachi_to_santi_coverage.py           # dry-run
  python scripts/migrate_pachi_to_santi_coverage.py --apply   # ejecuta

Requiere FIREBASE_SERVICE_ACCOUNT env var. Backup a
scripts/_backups/pachi_migration_YYYYMMDD_HHMMSS.json antes de aplicar
(para rollback).
"""
import sys
import os
import json
import datetime

sys.path.insert(0, 'scripts')

from sync_sap_to_bigquery import init_firestore, parse_sa_json, log  # noqa: E402

APPLY = '--apply' in sys.argv
COVERAGE_TRIAL_END = '2026-12-11'
NEW_VENDOR = 'SANTIAGO ESTEBAN'
OLD_VENDOR = 'PACHI'
MIGRATION_REASON = 'Diego 2026-09-10: PACHI no es empleado Shimano, cartera oficial a SANTI, coverage presencial durante trial 3 meses'


def find_pachi_clients(db):
    """Retorna docs con assignedVendor='PACHI'."""
    log(f'[SEARCH] client_applications con assignedVendor={OLD_VENDOR}...')
    docs = list(db.collection('client_applications').where('assignedVendor', '==', OLD_VENDOR).stream())
    log(f'[SEARCH] Encontrados: {len(docs)}')
    return docs


def build_migration_payload(existing_data):
    """Construye el payload de update para un cliente."""
    now_iso = datetime.datetime.utcnow().isoformat() + 'Z'
    history = existing_data.get('assignedVendorHistory') or []
    new_entry = {
        'from': OLD_VENDOR,
        'to': NEW_VENDOR,
        'at': now_iso,
        'reason': MIGRATION_REASON,
    }
    return {
        'assignedVendor': NEW_VENDOR,
        'coverageBy': OLD_VENDOR,  # PACHI cubre presencialmente
        'coverageTrialEndDate': COVERAGE_TRIAL_END,
        'assignedVendorHistory': history + [new_entry],
    }


def backup_docs(docs):
    """Backup completo antes de aplicar. Para rollback si algo sale mal."""
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_dir = os.path.join('scripts', '_backups')
    os.makedirs(backup_dir, exist_ok=True)
    backup_path = os.path.join(backup_dir, f'pachi_migration_{ts}.json')
    payload = []
    for d in docs:
        payload.append({
            'id': d.id,
            'data': d.to_dict() or {},
        })
    # datetime objects → ISO strings
    def default(o):
        if hasattr(o, 'isoformat'):
            return o.isoformat()
        return str(o)
    with open(backup_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=default)
    log(f'[BACKUP] {len(payload)} docs → {backup_path}')
    return backup_path


def main():
    sa = parse_sa_json()
    db = init_firestore(sa)

    docs = find_pachi_clients(db)
    if not docs:
        log(f'\n[RESULT] Cero clientes con assignedVendor={OLD_VENDOR}. Nada para migrar.')
        return

    # Sample para review
    log(f'\n[SAMPLE] Primeros 5 clientes a migrar:')
    for d in docs[:5]:
        data = d.to_dict() or {}
        log(f'  {d.id}: {data.get("comercio", "")[:40]} | prov={data.get("provincia","")} | loc={data.get("localidad","")}')

    if not APPLY:
        log(f'\n[DRY-RUN] {len(docs)} clientes se migrarian:')
        log(f'  assignedVendor: {OLD_VENDOR} → {NEW_VENDOR}')
        log(f'  coverageBy: {OLD_VENDOR} (nuevo)')
        log(f'  coverageTrialEndDate: {COVERAGE_TRIAL_END} (nuevo)')
        log(f'  assignedVendorHistory: audit entry appended')
        log(f'\nCorre con --apply para ejecutar.')
        return

    # Backup antes de aplicar
    backup_path = backup_docs(docs)

    # Aplicar en batches (Firestore max 500 ops/batch)
    log(f'\n[APPLY] Migrando {len(docs)} clientes en batches...')
    batch_size = 400
    total_updated = 0
    total_errors = 0
    for chunk_start in range(0, len(docs), batch_size):
        chunk = docs[chunk_start:chunk_start + batch_size]
        batch = db.batch()
        for d in chunk:
            data = d.to_dict() or {}
            payload = build_migration_payload(data)
            batch.update(d.reference, payload)
        try:
            batch.commit()
            total_updated += len(chunk)
            log(f'  Batch {chunk_start}-{chunk_start+len(chunk)}: OK ({len(chunk)} docs)')
        except Exception as e:
            total_errors += len(chunk)
            log(f'  Batch {chunk_start}-{chunk_start+len(chunk)}: ERROR {e}')

    log(f'\n[APPLY] Done. {total_updated} updated, {total_errors} errors.')
    log(f'[APPLY] Backup: {backup_path} (para rollback)')
    log(f'\n[VERIFY] Query recomendada:')
    log(f'  db.collection("client_applications").where("coverageBy","==","{OLD_VENDOR}").count().get()')
    log(f'  Esperado: {total_updated} docs.')


if __name__ == '__main__':
    main()
