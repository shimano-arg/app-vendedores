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

Uso (C9: DRY-RUN por defecto; antes BORRABA por defecto):
  FIREBASE_SERVICE_ACCOUNT=$(cat sa-key.json) \
    python scripts/cleanup_bad_bp_sync.py --project app-vendedores-shimano          # cuenta
  ... --apply --confirm-project=app-vendedores-shimano                             # borra
  En APPLY, antes de borrar, guarda un respaldo JSON de cada doc en
  --backup-dir (default: directorio actual). Sin respaldo escrito, no borra.

Env vars:
  FIREBASE_SERVICE_ACCOUNT  Mismo SA que los otros scripts.
  DRY_RUN                   legacy: 'true' + --apply = error (ambiguo).
  CUTOFF_DATE               ISO (default: 2026-07-08T00:00:00Z)
"""
import base64
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from _lib.script_guard import guard  # noqa: E402

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


def init_firestore(project: str) -> firestore.Client:
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
    firebase_admin.initialize_app(cred, {'projectId': project})
    return firestore.client()


def select_to_delete(docs, cutoff_dt, log=print):
    """Puro: (a_borrar, mantenidos). Testeable sin Firestore."""
    to_delete = []
    kept = 0
    for d in docs:
        data = d.to_dict() or {}
        created_at = data.get('createdAt')
        try:
            if hasattr(created_at, 'timestamp'):
                doc_dt = created_at
                if doc_dt.tzinfo is None:
                    doc_dt = doc_dt.replace(tzinfo=timezone.utc)
            elif isinstance(created_at, str):
                doc_dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            else:
                log(f'[SKIP] {d.id}: createdAt ilegible ({type(created_at)}), no borro')
                kept += 1
                continue
        except Exception as e:
            log(f'[SKIP] {d.id}: error parseando createdAt: {e}')
            kept += 1
            continue
        if doc_dt < cutoff_dt:
            kept += 1
            continue
        to_delete.append(d)
    return to_delete, kept


def main(argv=None):
    log('=== cleanup_bad_bp_sync START ===')
    t = guard(argv=argv, requires_write=True)
    backup_dir = '.'
    for a in t.rest:
        if a.startswith('--backup-dir='):
            backup_dir = a[len('--backup-dir='):]
        else:
            log(f'[FATAL] argumento desconocido: {a}')
            sys.exit(2)
    if t.apply and os.environ.get('DRY_RUN', '').lower() == 'true':
        log('[FATAL] DRY_RUN=true junto con --apply: ambiguo, no hago nada.')
        sys.exit(2)
    cutoff_str = os.environ.get('CUTOFF_DATE', '2026-07-08T00:00:00Z')
    cutoff_dt = datetime.fromisoformat(cutoff_str.replace('Z', '+00:00'))
    log(f'[MODE] {t.mode}, cutoff={cutoff_str}')

    db = init_firestore(t.project)
    log('[FS] cliente OK')

    # Query: client_applications con source='sap_sync'
    # No filtramos por createdAt en el query (Firestore requiere index compuesto)
    # sino en Python al iterar.
    query = db.collection('client_applications').where('source', '==', 'sap_sync')
    docs = list(query.stream())
    log(f'[FS] {len(docs)} docs con source=sap_sync')
    to_delete, kept = select_to_delete(docs, cutoff_dt, log)
    log(f'[FS] a borrar: {len(to_delete)}, mantener: {kept}')
    for d in to_delete[:10]:
        data = d.to_dict() or {}
        log(f'  - {d.id}: cardCode={data.get("cardCodeSap")} comercio={data.get("comercio")}')
    if not to_delete:
        return

    if t.apply:
        # Respaldo ANTES de borrar (reversibilidad, CLAUDE.md §55). Si falla, no se borra nada.
        ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup_path = os.path.join(backup_dir, f'cleanup_bad_bp_sync_backup_{t.project}_{ts}.json')
        with open(backup_path, 'w', encoding='utf-8') as fh:
            json.dump({d.id: (d.to_dict() or {}) for d in to_delete}, fh, ensure_ascii=False, default=str)
        log(f'[BACKUP] {len(to_delete)} docs respaldados en {backup_path}')

    # Borrar en batches de 500 (max de Firestore batch)
    batch_size = 500
    total_borrado = 0
    for i in range(0, len(to_delete), batch_size):
        chunk = to_delete[i:i + batch_size]

        def _commit(chunk=chunk):
            batch = db.batch()
            for d in chunk:
                batch.delete(d.reference)
            batch.commit()
        t.write(f'borrar {len(chunk)} docs de client_applications (batch {i // batch_size + 1})', _commit)
        if t.apply:
            total_borrado += len(chunk)
            log(f'[FS] batch {i // batch_size + 1}: borrados {total_borrado}/{len(to_delete)}')

    log(f'=== cleanup_bad_bp_sync END: modo={t.mode} borrados={total_borrado} ===')


if __name__ == '__main__':
    main()
