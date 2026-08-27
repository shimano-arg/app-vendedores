"""
Sync collections growth to Firestore for the Panel de Control card.

Corre diario via GitHub Actions. Para cada coleccion clave del proyecto,
cuenta N docs actual + calcula delta vs snapshot anterior (7d si existe).
Estima total bytes en base a muestra + calcula % del free tier de storage.

Escribe a app_config/collections_growth con estructura:
  {
    collections: {
      visits: { count, avgBytesDoc, totalBytes, delta7d, syncedAt },
      pedidos: { ... },
      ...
    },
    freeTierBytes: 1073741824,  // 1 GB
    totalBytesAllCollections: N,
    worstGrowthCollection: 'visits',
    worstGrowthDelta7d: 12,
    syncedAt: timestamp,
    status: 'ok' | 'error',
  }

Uso: python scripts/sync_collections_growth.py
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
except ImportError:
    print('[FATAL] falta firebase-admin: pip install firebase-admin', file=sys.stderr)
    sys.exit(2)


def log(msg):
    print(f'[collections-growth-sync] {msg}', flush=True)


# Colecciones que monitoreamos (crecen lineal o son criticas para operacion).
# Para cada una guardamos count + avgBytesDoc + totalBytes estimado.
MONITORED_COLLECTIONS = [
    'visits',
    'pedidos',
    'client_applications',
    'client_master',
    'opsLog',
    'notifs',
    'campaigns',
    'targets',
    'rutas_personalizadas',
    'backorder_snapshot',
    'auditLog',
    'rendiciones',
    'client_categories',
]

# Limite de scanned docs para estimar avg bytes (no toca cost cuando N es alto).
# Con 20 docs sample es suficiente para el promedio.
SAMPLE_SIZE = 20
FREE_TIER_STORAGE_BYTES = 1073741824  # 1 GB


def init_firebase():
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if not sa_json:
        # Fallback: buscar archivo local
        for p in [
            r'C:\Users\shimano.sandbox\Downloads\app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json'
        ]:
            if os.path.exists(p):
                with open(p) as f:
                    sa_json = f.read()
                break
    if not sa_json:
        log('FATAL: FIREBASE_SERVICE_ACCOUNT env vacio y no hay SA local')
        sys.exit(2)
    if not sa_json.startswith('{'):
        try:
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        except Exception:
            pass
    sa_data = json.loads(sa_json)
    cred = credentials.Certificate(sa_data)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def measure_collection(db, name):
    """Cuenta docs (via aggregate query si es posible, sino scan hasta 5000)
    + estima avg bytes en base a sample de SAMPLE_SIZE docs.
    Retorna {count, avgBytesDoc, totalBytes, sampled}.
    """
    try:
        # Firestore Aggregate: count() es 1 read (mucho mas barato que scan).
        # Requiere firebase-admin >= 6.0.
        count_query = db.collection(name).count()
        agg_result = count_query.get()
        count = int(agg_result[0][0].value) if agg_result else 0
    except Exception as e:
        log(f'  {name}: aggregate count fail ({str(e)[:60]}), fallback a scan')
        # Fallback: scan hasta 5000 docs (cost proporcional al size real).
        try:
            docs = list(db.collection(name).limit(5000).stream())
            count = len(docs)
        except Exception as e2:
            log(f'  {name}: scan fail: {e2}')
            return {'count': 0, 'avgBytesDoc': 0, 'totalBytes': 0, 'sampled': 0, 'error': str(e2)}

    if count == 0:
        return {'count': 0, 'avgBytesDoc': 0, 'totalBytes': 0, 'sampled': 0}

    # Sample para estimar avg bytes.
    try:
        sample_docs = list(db.collection(name).limit(SAMPLE_SIZE).stream())
        if not sample_docs:
            return {'count': count, 'avgBytesDoc': 0, 'totalBytes': 0, 'sampled': 0}
        # Estimacion cruda: json.dumps(dict) es proxy razonable de Firestore doc size.
        # No es exacto (Firestore tiene overhead de field names, indexes, etc) pero
        # sirve para detectar tendencias.
        sizes = []
        for d in sample_docs:
            data = d.to_dict() or {}
            try:
                s = len(json.dumps(data, default=str))
                sizes.append(s)
            except Exception:
                pass
        if not sizes:
            return {'count': count, 'avgBytesDoc': 0, 'totalBytes': 0, 'sampled': 0}
        avg = int(sum(sizes) / len(sizes))
        total = avg * count
        return {'count': count, 'avgBytesDoc': avg, 'totalBytes': total, 'sampled': len(sizes)}
    except Exception as e:
        log(f'  {name}: sample fail: {e}')
        return {'count': count, 'avgBytesDoc': 0, 'totalBytes': 0, 'sampled': 0}


def main():
    log('init firebase')
    db = init_firebase()

    # Leer snapshot previo para calcular delta7d.
    prev_doc = db.collection('app_config').document('collections_growth').get()
    prev_data = prev_doc.to_dict() if prev_doc.exists else {}
    prev_collections = (prev_data.get('collections') or {}) if prev_data else {}

    now = datetime.now(timezone.utc)
    collections_out = {}
    total_bytes = 0
    worst_delta_col = None
    worst_delta_val = 0

    for name in MONITORED_COLLECTIONS:
        log(f'measure {name}')
        m = measure_collection(db, name)
        prev = prev_collections.get(name) or {}
        prev_count = int(prev.get('count') or 0)
        delta = m['count'] - prev_count
        m['delta7d'] = delta  # simple: delta desde ultimo sync
        m['syncedAt'] = now.isoformat()
        collections_out[name] = m
        total_bytes += m.get('totalBytes') or 0
        if delta > worst_delta_val:
            worst_delta_val = delta
            worst_delta_col = name

    status = 'ok'
    payload = {
        'collections': collections_out,
        'freeTierBytes': FREE_TIER_STORAGE_BYTES,
        'totalBytesAllCollections': total_bytes,
        'worstGrowthCollection': worst_delta_col or '',
        'worstGrowthDelta7d': worst_delta_val,
        'syncedAt': firestore.SERVER_TIMESTAMP,
        'status': status,
    }

    log(f'write collections_growth (total {total_bytes / 1024 / 1024:.1f} MB, worst={worst_delta_col} +{worst_delta_val})')
    db.collection('app_config').document('collections_growth').set(payload)

    log('OK')


if __name__ == '__main__':
    main()
