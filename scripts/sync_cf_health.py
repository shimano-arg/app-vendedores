"""
Sync Cloud Functions health (errors + p95 latency) al Panel de Control.

Consulta Cloud Logging API para las CFs del proyecto en las ultimas 24h:
- Cantidad de errores (severity ERROR) por funcion
- p95 execution latency por funcion (parseado de "Function execution took Xms")

Escribe a app_config/cf_health:
  {
    functions: {
      <name>: { errors24h, invocations24h, p95Ms, healthColor }
    },
    worstFunction, worstErrors24h,
    syncedAt, status
  }

Cron cada 30 min. Requiere:
- Cloud Logging API habilitada
- SA con roles/logging.viewer

Si el SA no tiene permisos, escribe status=error con el message y el Panel
muestra card en gris con warning tooltip.

Uso: python scripts/sync_cf_health.py
Env: FIREBASE_SERVICE_ACCOUNT (JSON o base64)
"""

import base64
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.cloud import logging as gcp_logging
    from google.oauth2 import service_account
except ImportError:
    print('[FATAL] deps: pip install firebase-admin google-cloud-logging', file=sys.stderr)
    sys.exit(2)


def log(msg):
    print(f'[cf-health-sync] {msg}', flush=True)


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


def percentile(sorted_list, p):
    if not sorted_list:
        return 0
    k = (len(sorted_list) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_list) - 1)
    if f == c:
        return sorted_list[f]
    return sorted_list[f] * (c - k) + sorted_list[c] * (k - f)


def main():
    log('init')
    sa_data = parse_sa()
    project_id = sa_data['project_id']
    scoped = service_account.Credentials.from_service_account_info(sa_data)

    # Firestore admin
    cred = credentials.Certificate(sa_data)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    error_status = 'ok'
    error_msg = None

    # Cloud Logging client
    try:
        log_client = gcp_logging.Client(project=project_id, credentials=scoped)
    except Exception as e:
        error_status = 'error'
        error_msg = 'no logging client: ' + str(e)
        log(f'FATAL logging client: {e}')
        db.collection('app_config').document('cf_health').set(
            {
                'functions': {},
                'worstFunction': '',
                'worstErrors24h': 0,
                'status': error_status,
                'errorMessage': error_msg,
                'syncedAt': firestore.SERVER_TIMESTAMP,
            }
        )
        return

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    since_str = since.strftime('%Y-%m-%dT%H:%M:%SZ')

    # Query CF logs (v2 unified: resource.type=cloud_run_revision para CF Gen2,
    # cloud_function para Gen1). Filtramos ambos.
    filter_str = (
        f'timestamp >= "{since_str}" AND '
        '(resource.type="cloud_function" OR resource.type="cloud_run_revision") '
        f'AND resource.labels.project_id="{project_id}"'
    )

    functions = {}

    try:
        for entry in log_client.list_entries(
            filter_=filter_str, order_by='timestamp desc', max_results=5000
        ):
            labels = getattr(entry, 'labels', {}) or {}
            resource = entry.resource
            fname = None
            if resource.type == 'cloud_function':
                fname = resource.labels.get('function_name')
            elif resource.type == 'cloud_run_revision':
                fname = resource.labels.get('service_name')
            if not fname:
                continue

            f = functions.setdefault(
                fname, {'errors24h': 0, 'invocations24h': 0, 'durationsMs': []}
            )

            severity = getattr(entry, 'severity', '') or ''
            if severity in ('ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'):
                f['errors24h'] += 1

            # Parse payload para "Function execution took XX ms" (Gen1) o similar
            payload = entry.payload
            payload_str = str(payload) if payload else ''
            m = re.search(r'Function execution took (\d+) ms', payload_str)
            if m:
                f['invocations24h'] += 1
                f['durationsMs'].append(int(m.group(1)))
    except Exception as e:
        error_status = 'error'
        error_msg = 'logging query failed: ' + str(e)
        log(f'WARN: {error_msg}')

    # Compute p95 per function
    out_functions = {}
    worst_fname = ''
    worst_errors = 0
    for fname, f in functions.items():
        durations = sorted(f['durationsMs'])
        p95 = int(percentile(durations, 0.95)) if durations else 0
        # Health por funcion:
        # - red: errors > 20 O p95 > 5000ms
        # - yellow: errors > 5 O p95 > 2000ms
        # - green: sino
        errs = f['errors24h']
        if errs > 20 or p95 > 5000:
            hc = 'red'
        elif errs > 5 or p95 > 2000:
            hc = 'yellow'
        else:
            hc = 'green'
        out_functions[fname] = {
            'errors24h': errs,
            'invocations24h': f['invocations24h'],
            'p95Ms': p95,
            'healthColor': hc,
        }
        if errs > worst_errors:
            worst_errors = errs
            worst_fname = fname

    payload_out = {
        'functions': out_functions,
        'worstFunction': worst_fname,
        'worstErrors24h': worst_errors,
        'status': error_status,
        'errorMessage': error_msg,
        'syncedAt': firestore.SERVER_TIMESTAMP,
    }
    log(f'writing cf_health: {len(out_functions)} functions, worst={worst_fname} ({worst_errors} err)')
    db.collection('app_config').document('cf_health').set(payload_out)
    log('OK')


if __name__ == '__main__':
    main()
