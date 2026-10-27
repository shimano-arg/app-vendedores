"""AL — v1487 §85 (2026-10-27) dry-run read-only de sync_waitlist_from_firestore.

Reproduce la lectura exacta del sync BQ pero sin escribir BigQuery. Útil para
verificar que el fix parse_firestore_date funciona contra prod ANTES de
disparar el workflow completo.

Uso:
  python scripts/audit/AL_dryrun_sync_waitlist.py
"""
import os
import sys

# Agregar scripts/ al path y seteá DRY_RUN para no escribir BQ.
os.environ['DRY_RUN'] = 'true'
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from google.cloud import firestore
import sync_sap_to_bigquery as sync


def main():
    db = firestore.Client(project='app-vendedores-shimano')
    print('=== AL dry-run: sync_waitlist_from_firestore ===')
    try:
        rows = sync.sync_waitlist_from_firestore(db, '2026-10-27T13:00:00Z')
        print(f'  OK — {len(rows)} rows generados sin crash.')
    except AttributeError as e:
        print(f'  FAIL — AttributeError (bug sigue vivo): {e}')
        sys.exit(1)
    except Exception as e:
        print(f'  FAIL — Error inesperado: {type(e).__name__}: {e}')
        sys.exit(1)

    # Spot-check: cuántos rows tienen updated_at (campo que rompía).
    with_updated = sum(1 for r in rows if r.get('updated_at'))
    with_created = sum(1 for r in rows if r.get('created_at'))
    print(f'  Rows con updated_at populated: {with_updated}')
    print(f'  Rows con created_at populated: {with_created}')
    # Mostrar 3 rows ejemplo.
    for r in rows[:3]:
        print(f'    doc_id={r.get("doc_id")} created_at={r.get("created_at")} updated_at={r.get("updated_at")}')
    print('\n✓ Dry-run OK. El fix parse_firestore_date tolera string ISO.')


if __name__ == '__main__':
    main()
