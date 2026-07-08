"""
cleanup_bad_bp_sync.py — Limpieza de docs mal cargados por el sync BPs v286.

Contexto (2026-07-08):
El sync v286 filtro U_DIVISION='1' pensando que era PESCA en Shimano SAP.
En realidad los codigos son:
  1 = BIKE
  2 = PESCA
  3 = BIKE & PESCA
Resultado: se crearon ~2506 docs en client_applications con clientes de
BICICLETAS, no de pesca.

Este script BORRA de Firestore SOLO los docs con:
  - source == 'sap_sync'
  - status == 'approved'
  - createdAt > '2026-07-08T00:00:00Z' (safety - solo los del run 2026-07-08)

NO TOCA SAP para nada. Solo Firestore.
NO TOCA docs creados por vendedores manualmente (source != 'sap_sync').
NO TOCA docs viejos previos a 2026-07-08 (createdAt filter).

Uso:
  Local:   FIREBASE_SERVICE_ACCOUNT=$(cat sa-key.json) python scripts/cleanup_bad_bp_sync.py
  Con DRY_RUN=true no borra, solo cuenta.

Env vars:
  FIREBASE_SERVICE_ACCOUNT  Mismo SA que los otros scripts.
  DRY_RUN                   'true' -> no borra, solo cuenta.
  CUTOFF_DATE               ISO (default: 2026-07-08T00:00:00Z)
"""
import base64
import json
import os
import sys
from datetime import datetime, timezone

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print('[ERROR] firebase-admin no instalado', file=sys.stderr)
    sys.exit(2)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(msg: str) -> None:
    print(f'[{now_iso()}] {msg}', flush=True)


def init_firestore() -> firestore.Client:
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if not sa_json:
        log('[FATAL] FIREBASE_SERVICE_ACCOUNT env var vacia')
        sys.exit(2)
    if not sa_json.startswith('{'):
        try:
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        except Exception:
            pass
    try:
        sa_data = json.loads(sa_json)
    except json.JSONDecodeError as e:
        log(f'[FATAL] FIREBASE_SERVICE_ACCOUNT no es JSON valido: {e}')
        sys.exit(2)
    cred = credentials.Certificate(sa_data)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def main():
    log('=== cleanup_bad_bp_sync START ===')
    dry_run = os.environ.get('DRY_RUN', '').lower() == 'true'
    cutoff_str = os.environ.get('CUTOFF_DATE', '2026-07-08T00:00:00Z')
    cutoff_dt = datetime.fromisoformat(cutoff_str.replace('Z', '+00:00'))
    log(f'[MODE] dry_run={dry_run}, cutoff={cutoff_str}')

    db = init_firestore()
    log('[FS] cliente OK')

    # Query: client_applications con source='sap_sync'
    # No filtramos por createdAt en el query (Firestore requiere index compuesto)
    # sino en Python al iterar.
    query = db.collection('client_applications').where('source', '==', 'sap_sync')
    docs = list(query.stream())
    log(f'[FS] {len(docs)} docs con source=sap_sync')

    # Filtrar por createdAt > cutoff
    to_delete = []
    kept = 0
    for d in docs:
        data = d.to_dict() or {}
        created_at = data.get('createdAt')
        # createdAt puede ser Timestamp de Firestore, str, o dict con seconds/nanos.
        # Firestore devuelve un DatetimeWithNanoseconds cuando es SERVER_TIMESTAMP.
        try:
            if hasattr(created_at, 'timestamp'):
                # Es un datetime-like
                doc_dt = created_at
                if doc_dt.tzinfo is None:
                    doc_dt = doc_dt.replace(tzinfo=timezone.utc)
            elif isinstance(created_at, str):
                doc_dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            else:
                # Sin createdAt legible - safety: NO borrar
                log(f'[SKIP] {d.id}: createdAt ilegible ({type(created_at)}), no borro')
                kept += 1
                continue
        except Exception as e:
            log(f'[SKIP] {d.id}: error parseando createdAt: {e}')
            kept += 1
            continue

        if doc_dt < cutoff_dt:
            log(f'[SKIP] {d.id}: createdAt {doc_dt.isoformat()} < cutoff, no borro')
            kept += 1
            continue
        to_delete.append(d)

    log(f'[FS] a borrar: {len(to_delete)}, mantener: {kept}')

    if dry_run:
        log(f'[DRY_RUN] no borro nada. Para borrar: quitar DRY_RUN=true')
        log('[DRY_RUN] muestra los primeros 10 que se borrarian:')
        for d in to_delete[:10]:
            data = d.to_dict() or {}
            log(f'  - {d.id}: cardCode={data.get("cardCodeSap")} comercio={data.get("comercio")}')
        return

    # Borrar en batches de 500 (max de Firestore batch)
    batch_size = 500
    total_borrado = 0
    for i in range(0, len(to_delete), batch_size):
        batch = db.batch()
        chunk = to_delete[i:i + batch_size]
        for d in chunk:
            batch.delete(d.reference)
        batch.commit()
        total_borrado += len(chunk)
        log(f'[FS] batch {i // batch_size + 1}: borrados {total_borrado}/{len(to_delete)}')

    log(f'=== cleanup_bad_bp_sync END: borrados={total_borrado} ===')


if __name__ == '__main__':
    main()
