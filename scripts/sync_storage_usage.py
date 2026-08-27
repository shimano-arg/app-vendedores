"""
Sync Cloud Storage usage al Panel de Control.

Enumera los buckets del proyecto GCP + suma bytes totales + detecta top
carpetas por tamano. Anticipa cuando el storage de fotos crezca cerca del
free tier (5 GB Firebase Storage).

Escribe a app_config/storage_usage con:
  {
    totalBytes, totalGB, freeTierBytes,
    buckets: [{ name, bytes, blobs, isUserData }],
    topFolders: [{ path, bytes, blobs }],   # top 5
    syncedAt, status
  }

Corre diario (1x). Cost: 1 read + N list requests por bucket (barato).

Uso: python scripts/sync_storage_usage.py
Env: FIREBASE_SERVICE_ACCOUNT (JSON o base64)
"""

import base64
import json
import os
import sys
from datetime import datetime, timezone

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.cloud import storage
    from google.oauth2 import service_account
except ImportError:
    print('[FATAL] deps faltantes: pip install firebase-admin google-cloud-storage', file=sys.stderr)
    sys.exit(2)


def log(msg):
    print(f'[storage-usage-sync] {msg}', flush=True)


# Firebase Free Tier: 5 GB Storage.
FREE_TIER_BYTES = 5 * 1024 * 1024 * 1024

# Buckets que consideramos "user data" (crecen con el uso). El resto son
# infra (Cloud Functions sources, deploys).
USER_DATA_BUCKETS = [
    'app-vendedores-shimano.firebasestorage.app',
    'app-vendedores-shimano-backups',
]


def parse_sa():
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if not sa_json:
        for p in [
            r'C:\Users\shimano.sandbox\Downloads\app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json'
        ]:
            if os.path.exists(p):
                with open(p) as f:
                    sa_json = f.read()
                break
    if not sa_json:
        log('FATAL: no FIREBASE_SERVICE_ACCOUNT')
        sys.exit(2)
    if not sa_json.startswith('{'):
        try:
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        except Exception:
            pass
    return json.loads(sa_json)


def measure_bucket(client, bucket_name):
    """Enumera TODOS los blobs de un bucket + agrupa por top-level folder."""
    try:
        bucket = client.bucket(bucket_name)
        by_folder = {}
        total_bytes = 0
        total_blobs = 0
        # No max_results = iterate all
        for blob in bucket.list_blobs():
            sz = blob.size or 0
            total_bytes += sz
            total_blobs += 1
            # Top-level folder (primer segment del path).
            name = blob.name or ''
            parts = name.split('/', 1)
            folder = parts[0] if len(parts) > 1 else '(root)'
            e = by_folder.get(folder)
            if e is None:
                e = {'path': folder, 'bytes': 0, 'blobs': 0}
                by_folder[folder] = e
            e['bytes'] += sz
            e['blobs'] += 1
        return {
            'bytes': total_bytes,
            'blobs': total_blobs,
            'folders': list(by_folder.values()),
        }
    except Exception as e:
        log(f'  {bucket_name}: ERR {e}')
        return {'bytes': 0, 'blobs': 0, 'folders': [], 'error': str(e)}


def main():
    log('init')
    sa_data = parse_sa()
    project_id = sa_data['project_id']

    # Firestore admin
    cred = credentials.Certificate(sa_data)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    # Storage client
    scoped = service_account.Credentials.from_service_account_info(sa_data)
    storage_client = storage.Client(project=project_id, credentials=scoped)

    all_folders = []
    buckets_out = []
    total_bytes = 0

    all_buckets = list(storage_client.list_buckets())
    log(f'{len(all_buckets)} buckets encontrados')

    for b in all_buckets:
        is_user = b.name in USER_DATA_BUCKETS
        # Solo enumeramos user data (los gcf-* pueden ser gigantes con builds).
        if not is_user:
            buckets_out.append(
                {'name': b.name, 'bytes': 0, 'blobs': 0, 'isUserData': False, 'skipped': True}
            )
            continue
        log(f'  measuring {b.name}')
        m = measure_bucket(storage_client, b.name)
        total_bytes += m['bytes']
        buckets_out.append(
            {
                'name': b.name,
                'bytes': m['bytes'],
                'blobs': m['blobs'],
                'isUserData': True,
                'skipped': False,
            }
        )
        for f in m['folders']:
            all_folders.append({**f, 'bucket': b.name})

    # Top 5 folders por bytes
    all_folders.sort(key=lambda x: x['bytes'], reverse=True)
    top_folders = all_folders[:5]

    payload = {
        'totalBytes': total_bytes,
        'totalGB': round(total_bytes / 1024 / 1024 / 1024, 3),
        'freeTierBytes': FREE_TIER_BYTES,
        'buckets': buckets_out,
        'topFolders': top_folders,
        'syncedAt': firestore.SERVER_TIMESTAMP,
        'status': 'ok',
    }
    log(f'writing storage_usage: {total_bytes / 1024 / 1024:.1f} MB en {len(buckets_out)} buckets, top folder: {top_folders[0]["path"] if top_folders else "-"}')
    db.collection('app_config').document('storage_usage').set(payload)
    log('OK')


if __name__ == '__main__':
    main()
