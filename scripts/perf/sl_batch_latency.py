"""
Mide latencia batch del Service Layer SAP para GET /Items con $filter+$select.

Uso:
    python scripts/perf/sl_batch_latency.py --skus=1,20,50,80,150 --repeat=5

Lee creds de Firestore app_config/sap_integration.serviceLayer (mismo patrón
que sync_sap_to_firestore.py). SOLO lectura — un login al principio, un
logout al final, una sesión durante toda la corrida.

Output:
    - median, p95, p99 por tamaño de bloque + status codes + body sizes.
    - Longitud del URI construido para cada tamaño (para detectar HTTP 414).

NO modifica nada en SAP. Es puro GET.
"""

import argparse
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone

import requests
from urllib3.exceptions import InsecureRequestWarning

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print('[ERROR] firebase-admin no instalado. pip install firebase-admin', file=sys.stderr)
    sys.exit(2)


def log(msg):
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}', flush=True)


# =============================================================================
# Firestore config loader
# =============================================================================


def init_firebase():
    """Inicializa firebase_admin con ADC (gcloud auth) o service account."""
    if firebase_admin._apps:
        return firestore.client()

    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
    if sa_json:
        try:
            cred = credentials.Certificate(json.loads(sa_json))
            firebase_admin.initialize_app(cred, {'projectId': 'app-vendedores-shimano'})
        except Exception as e:
            print(f'[ERROR] FIREBASE_SERVICE_ACCOUNT JSON invalido: {e}', file=sys.stderr)
            sys.exit(2)
    else:
        # ADC via gcloud auth application-default login
        firebase_admin.initialize_app(options={'projectId': 'app-vendedores-shimano'})
    return firestore.client()


def load_sl_config(db):
    """Lee app_config/sap_integration.serviceLayer."""
    snap = db.collection('app_config').document('sap_integration').get()
    if not snap.exists:
        print('[ERROR] no existe app_config/sap_integration', file=sys.stderr)
        sys.exit(2)
    data = snap.to_dict() or {}
    sl = data.get('serviceLayer') or {}
    cfg = {
        'url': sl.get('url'),
        'companyDB': sl.get('companyDB'),
        'userName': sl.get('username') or sl.get('userName'),
        'password': sl.get('password'),
        'enabled': bool(sl.get('enabled', True)),
    }
    if not all([cfg['url'], cfg['companyDB'], cfg['userName'], cfg['password']]):
        print(
            '[ERROR] faltan credenciales SL (url/companyDB/username/password)', file=sys.stderr
        )
        sys.exit(2)
    return cfg


# =============================================================================
# Service Layer helpers
# =============================================================================


def sl_login(cfg, session):
    """Login en SL, guarda cookie B1SESSION en session."""
    endpoint = f"{cfg['url']}/b1s/v1/Login"
    body = {
        'UserName': cfg['userName'],
        'Password': cfg['password'],
        'CompanyDB': cfg['companyDB'],
    }
    t0 = time.perf_counter()
    r = session.post(endpoint, json=body, verify=True, timeout=15)
    elapsed = (time.perf_counter() - t0) * 1000
    if r.status_code not in (200, 201):
        print(
            f'[ERROR] login SL fallo: {r.status_code} {r.text[:200]}', file=sys.stderr
        )
        sys.exit(3)
    log(f'[SL] login OK ({elapsed:.0f} ms)')


def sl_logout(cfg, session):
    endpoint = f"{cfg['url']}/b1s/v1/Logout"
    try:
        session.post(endpoint, timeout=5, verify=True)
    except Exception:
        pass


def fetch_sku_sample(cfg, session, limit):
    """Trae los primeros `limit` ItemCodes reales del maestro para armar batches."""
    path = f"/b1s/v1/Items?$select=ItemCode&$top={limit}"
    url = f"{cfg['url']}{path}"
    r = session.get(url, timeout=15, verify=True)
    if r.status_code != 200:
        print(f'[ERROR] fetch SKU sample fallo: {r.status_code}', file=sys.stderr)
        sys.exit(3)
    data = r.json() or {}
    skus = [it.get('ItemCode') for it in (data.get('value') or []) if it.get('ItemCode')]
    log(f'[SL] fetched {len(skus)} SKUs de ejemplo')
    return skus


def build_filter_query(skus):
    """
    Arma $filter con 'ItemCode eq ...' para batch.
    Devuelve (url_path_sin_host, longitud_del_filter_sin_encoding).
    """
    terms = [f"ItemCode eq '{s}'" for s in skus]
    filter_expr = ' or '.join(terms)
    select = 'ItemCode,ItemWarehouseInfoCollection'
    path = f'/b1s/v1/Items?$filter={filter_expr}&$select={select}'
    return path, len(filter_expr)


def measure_batch(cfg, session, skus):
    """
    Mide 1 batch GET. Devuelve dict con status, elapsed_ms, body_size, filter_len.
    """
    path, filter_len = build_filter_query(skus)
    url = f"{cfg['url']}{path}"
    t0 = time.perf_counter()
    try:
        r = session.get(url, timeout=10, verify=True)
        elapsed = (time.perf_counter() - t0) * 1000
        body_size = len(r.content) if r.content else 0
        # Validar que efectivamente trajo todos los SKUs pedidos.
        count_returned = None
        if r.status_code == 200:
            try:
                data = r.json()
                count_returned = len(data.get('value', []) if data else [])
            except Exception:
                count_returned = -1
        return {
            'status': r.status_code,
            'elapsed_ms': elapsed,
            'body_size': body_size,
            'filter_len': filter_len,
            'count_returned': count_returned,
            'count_requested': len(skus),
            'error': None,
        }
    except Exception as e:
        return {
            'status': None,
            'elapsed_ms': (time.perf_counter() - t0) * 1000,
            'body_size': 0,
            'filter_len': filter_len,
            'count_returned': None,
            'count_requested': len(skus),
            'error': str(e),
        }


def pctile(samples, p):
    """Cálculo robusto de percentil para listas chicas."""
    if not samples:
        return 0
    sorted_samples = sorted(samples)
    k = (len(sorted_samples) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(sorted_samples) - 1)
    return sorted_samples[f] + (sorted_samples[c] - sorted_samples[f]) * (k - f)


# =============================================================================
# Main
# =============================================================================


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '--skus', default='1,20,50,80,150', help='Tamaños de batch comma-separated'
    )
    parser.add_argument('--repeat', type=int, default=5, help='Repeticiones por batch')
    args = parser.parse_args()
    batch_sizes = [int(s) for s in args.skus.split(',')]
    max_size = max(batch_sizes)

    db = init_firebase()
    cfg = load_sl_config(db)
    if not cfg['enabled']:
        log('[WARN] serviceLayer.enabled=false; abortando')
        sys.exit(1)

    session = requests.Session()
    sl_login(cfg, session)
    try:
        sku_sample = fetch_sku_sample(cfg, session, max_size)
        if len(sku_sample) < max_size:
            log(f'[WARN] catalogo tiene solo {len(sku_sample)} items; ajustando')
            batch_sizes = [b for b in batch_sizes if b <= len(sku_sample)]

        print('\n' + '=' * 95)
        print(
            f'MEDICION LATENCIA SL BATCH · {datetime.now(timezone.utc).isoformat()} · {args.repeat} corridas/tamano'
        )
        print('=' * 95)
        print(
            f'{"N SKUs":<8} {"Median":<10} {"P95":<10} {"P99":<10} {"Min":<10} {"Max":<10} '
            f'{"Body(KB)":<10} {"Filter chars":<14} {"Status":<10}'
        )
        print('-' * 95)

        results = []
        for n in batch_sizes:
            skus = sku_sample[:n]
            latencies = []
            body_sizes = []
            statuses = set()
            errors = []
            filter_len = 0
            # Warm-up (1 corrida descartada para no sesgar cold-start del SL cache).
            measure_batch(cfg, session, skus)
            for _i in range(args.repeat):
                res = measure_batch(cfg, session, skus)
                latencies.append(res['elapsed_ms'])
                body_sizes.append(res['body_size'])
                statuses.add(res['status'])
                filter_len = res['filter_len']
                if res['error']:
                    errors.append(res['error'])
                if res['status'] != 200:
                    errors.append(
                        f"HTTP {res['status']} (requested {res['count_requested']}, returned {res['count_returned']})"
                    )
            median = statistics.median(latencies)
            p95 = pctile(latencies, 95)
            p99 = pctile(latencies, 99)
            mn = min(latencies)
            mx = max(latencies)
            avg_body = statistics.mean(body_sizes) / 1024
            status_str = ','.join(str(s) for s in statuses)
            print(
                f'{n:<8} {median:<10.1f} {p95:<10.1f} {p99:<10.1f} {mn:<10.1f} {mx:<10.1f} '
                f'{avg_body:<10.1f} {filter_len:<14} {status_str:<10}'
            )
            results.append(
                {
                    'n': n,
                    'median': median,
                    'p95': p95,
                    'p99': p99,
                    'min': mn,
                    'max': mx,
                    'body_kb': avg_body,
                    'filter_len': filter_len,
                    'statuses': list(statuses),
                    'errors': errors,
                }
            )
        print('-' * 95)
        print('\nERRORES DETECTADOS:')
        any_err = False
        for r in results:
            if r['errors']:
                any_err = True
                print(f'  N={r["n"]}: {r["errors"][:3]}')
        if not any_err:
            print('  Ninguno. Todos los batches 200 OK.')
        print()
        print('JSON crudo (para pegar en el design doc):')
        print(json.dumps(results, indent=2))
    finally:
        sl_logout(cfg, session)
        log('[SL] logout OK')


if __name__ == '__main__':
    main()
