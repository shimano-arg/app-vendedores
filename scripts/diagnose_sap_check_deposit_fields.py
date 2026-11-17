r"""
diagnose_sap_check_deposit_fields.py — Diagnóstico one-shot del schema SL

Objetivo: ver qué campos expone SAP Service Layer para los endpoints que
pueblan `sap_payment_checks_raw` y `sap_deposit_checks_raw`, para resolver
cómo matcheamos un PaymentCheck con su Deposit (hoy el link está roto en
`v_cheques_recibidos` — ver Desktop\RESPUESTAS\CHEQUES_VENCIDO_SIN_DEPOSITAR_
2026-11-16\DIAGNOSTICO.md).

Qué hace:
  1. Login SL usando el mismo pattern que sync_sap_to_bigquery.py:
     - Cred SA via env FIREBASE_SERVICE_ACCOUNT (o hardcoded path fallback).
     - URL/CompanyDB/username de Firestore app_config/sap_integration.
     - password de env SAP_SL_PASSWORD.
  2. Para cada payment_doc_entry en TARGET_PAYMENTS:
        GET /b1s/v1/IncomingPayments({N})?$expand=PaymentChecks
        Dump JSON crudo entero.
  3. Para cada deposit_abs_entry en TARGET_DEPOSITS:
        GET /b1s/v1/Deposits({M})/CheckLines
        Dump JSON crudo entero.
  4. Output a OUT_DIR (default Desktop\RESPUESTAS\CHEQUES_VENCIDO_SIN_DEPOSITAR_2026-11-16\):
     - sl_schema_dump.json (payloads completos).
     - sl_schema_dump.log (resumen con las keys encontradas).
     - sl_metadata.xml (schema CSDL de SL).

NO ESCRIBE a BigQuery, Firestore, ni Service Layer. Solo HTTP GET + archivos
locales.

Credenciales Firestore — probadas en orden hasta que una funcione:
  1. FIREBASE_SERVICE_ACCOUNT env (JSON raw o base64) — mismo que
     sync_sap_to_bigquery.py.
  2. GOOGLE_APPLICATION_CREDENTIALS env (path a archivo JSON del SA).
  3. FIREBASE_SA_PATH env (path a archivo JSON del SA).
  4. Application Default Credentials (gcloud auth application-default login).

Password SL — probados en orden:
  1. SAP_SL_PASSWORD env.
  2. Firestore app_config/sap_integration.serviceLayer.password (fallback
     legacy que ya usa el otro sync).

Env vars opcionales:
  SL_INSECURE               'true' -> desactiva verify SSL.
  OUT_DIR                   Override del directorio de salida.

Ejecución (PowerShell Windows):
  $env:FIREBASE_SA_PATH = "C:\Users\shimano.sandbox\auditoria-sa.json"
  $env:SAP_SL_PASSWORD  = "<password del SL>"   # o dejarlo vacío si Firestore tiene fallback
  python scripts\diagnose_sap_check_deposit_fields.py

Ejecución (GitHub Actions dispatch):
  Ver .github/workflows/diagnose-sap-check-fields.yml.

Salidas:
  Exit 0  OK.
  Exit 2  Env vars inválidas o Firestore inaccesible.
  Exit 3  Login SL falló.
  Exit 4  SL error HTTP en algún fetch (sigue con los demás; exit != 0 al final
          si al menos uno falló).
"""
import base64
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
    from urllib3.exceptions import InsecureRequestWarning
except ImportError:
    print('[ERROR] requests no instalado. pip install requests', file=sys.stderr)
    sys.exit(2)

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print('[ERROR] firebase-admin no instalado. pip install firebase-admin', file=sys.stderr)
    sys.exit(2)


# ============================================================
# Targets a diagnosticar
# ============================================================
# Los 3 payment_doc_entry correspondientes a los 3 cheques físicos actuales
# (e_check='tNO') en sap_payment_checks_raw al 2026-11-16.
# Si cuando corras esto los IDs cambian, actualizá acá.
TARGET_PAYMENTS = [
    # (payment_doc_entry, check_abs_entry, check_number, hint_cliente)
    # Confirmados desde BQ al 2026-11-16 (sap_payment_checks_raw WHERE e_check='tNO').
    (53158, 4667, 69083015, 'C30693701755 — caso testigo TIBETAN'),
    (50602, 4120, 17800879, 'C20102551436'),
    (47778, 3573, 121162,   'C20256418674'),
]

# 3 deposit_abs_entry recientes (de los más nuevos).
# Fuente: SELECT DISTINCT deposit_abs_entry FROM sap_deposit_checks_raw
# ORDER BY deposit_date DESC LIMIT 3;  (al 2026-11-16: 2287, 2282, 2286)
TARGET_DEPOSITS = [2287, 2282, 2286]


# ============================================================
# Config paths
# ============================================================
OUT_DIR = os.environ.get('OUT_DIR') or str(
    Path.home() / 'Desktop' / 'RESPUESTAS' / 'CHEQUES_VENCIDO_SIN_DEPOSITAR_2026-11-16'
)


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


# ============================================================
# Firestore + SL bootstrap (idéntico pattern a sync_sap_to_bigquery.py)
# ============================================================
def load_sa_data():
    """Devuelve dict del SA si se pudo leer; None si no hay y hay que fallback a ADC."""
    sa_raw = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
    if sa_raw:
        try:
            if sa_raw.strip().startswith('{'):
                return json.loads(sa_raw)
            return json.loads(base64.b64decode(sa_raw).decode('utf-8'))
        except Exception as e:
            log(f'[FATAL] FIREBASE_SERVICE_ACCOUNT inválido: {e}')
            sys.exit(2)
    for env_name in ('FIREBASE_SA_PATH', 'GOOGLE_APPLICATION_CREDENTIALS'):
        sa_path = os.environ.get(env_name)
        if sa_path:
            p = Path(sa_path)
            if not p.exists():
                log(f'[FATAL] {env_name}={sa_path} no existe.')
                sys.exit(2)
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                log(f'[FATAL] no pude leer {env_name}={sa_path}: {e}')
                sys.exit(2)
    return None


def init_firestore(sa_data):
    if not firebase_admin._apps:
        if sa_data is not None:
            cred = credentials.Certificate(sa_data)
            log(f'[auth] SA = {sa_data.get("client_email", "?")}')
        else:
            cred = credentials.ApplicationDefault()
            log('[auth] usando Application Default Credentials (gcloud ADC)')
        firebase_admin.initialize_app(cred, {
            'projectId': os.environ.get('GOOGLE_CLOUD_PROJECT', 'app-vendedores-shimano'),
        })
    return firestore.client()


def get_sl_config(db):
    snap = db.collection('app_config').document('sap_integration').get()
    if not snap.exists:
        log('[FATAL] app_config/sap_integration no existe')
        sys.exit(2)
    data = snap.to_dict() or {}
    sl = data.get('serviceLayer') or {}
    required_fs = ('url', 'companyDB', 'username')
    missing = [k for k in required_fs if not sl.get(k)]
    if missing:
        log(f'[FATAL] faltan campos en app_config/sap_integration.serviceLayer: {missing}')
        sys.exit(2)
    password = os.environ.get('SAP_SL_PASSWORD') or sl.get('password') or ''
    if not password:
        log('[FATAL] SAP_SL_PASSWORD no está en env.')
        sys.exit(2)
    return {
        'url': sl['url'].rstrip('/'),
        'companyDB': sl['companyDB'],
        'username': sl['username'],
        'password': password,
    }


def sl_login(cfg, session):
    resp = session.post(
        f"{cfg['url']}/b1s/v1/Login",
        json={
            'CompanyDB': cfg['companyDB'],
            'UserName': cfg['username'],
            'Password': cfg['password'],
        },
        timeout=30,
    )
    if not resp.ok:
        try:
            resp.encoding = 'utf-8'
            detail = resp.json().get('error', {}).get('message', {}).get('value', '')
        except Exception:
            detail = resp.text[:200]
        log(f'[FATAL] Login SL falló: HTTP {resp.status_code} - {detail}')
        sys.exit(3)
    log(f"[SL] login OK contra {cfg['url']} (CompanyDB={cfg['companyDB']})")


# ============================================================
# Diagnóstico
# ============================================================
def fetch_json(session, base_url, path):
    """GET -> JSON. Si el content-type es XML (p.ej. /$metadata) devuelve
    {'_raw_text': '<xml>'} en lugar de parsearlo."""
    url = f'{base_url}{path}'
    log(f'[GET] {path}')
    resp = session.get(url, timeout=60)
    resp.encoding = 'utf-8'
    if not resp.ok:
        try:
            detail = resp.json().get('error', {}).get('message', {}).get('value', '')
        except Exception:
            detail = resp.text[:300]
        log(f'  [HTTP {resp.status_code}] {detail}')
        return {'_error': True, '_status': resp.status_code, '_message': detail, '_url': url}
    ctype = (resp.headers.get('Content-Type') or '').lower()
    if 'json' not in ctype:
        return {'_raw_text': resp.text, '_content_type': ctype}
    try:
        return resp.json()
    except Exception as e:
        return {'_raw_text': resp.text, '_content_type': ctype, '_parse_error': str(e)}


def summarize_keys(d, prefix=''):
    """Devuelve lista de keys top-level + un string resumido del valor para log."""
    out = []
    for k, v in d.items():
        if isinstance(v, dict):
            type_desc = f'dict({len(v)} keys)'
        elif isinstance(v, list):
            if v and isinstance(v[0], dict):
                type_desc = f'list[{len(v)}] of dict({len(v[0])} keys)'
            else:
                type_desc = f'list[{len(v)}] of {type(v[0]).__name__ if v else "?"}'
        else:
            vs = repr(v)
            if len(vs) > 80:
                vs = vs[:77] + '...'
            type_desc = f'{type(v).__name__} = {vs}'
        out.append(f'{prefix}{k} :: {type_desc}')
    return out


def main():
    # Crear carpeta de salida.
    out_path = Path(OUT_DIR)
    out_path.mkdir(parents=True, exist_ok=True)
    dump_file = out_path / 'sl_schema_dump.json'
    log_file = out_path / 'sl_schema_dump.log'

    sa_data = load_sa_data()
    db = init_firestore(sa_data)
    cfg = get_sl_config(db)

    session = requests.Session()
    if os.environ.get('SL_INSECURE', '').lower() == 'true':
        requests.packages.urllib3.disable_warnings(InsecureRequestWarning)
        session.verify = False
    session.headers.update({'Accept': 'application/json', 'Content-Type': 'application/json'})

    sl_login(cfg, session)

    base_url = cfg['url']
    all_errors = []
    dump = {
        'generated_at_utc': datetime.now(timezone.utc).isoformat(),
        'company_db': cfg['companyDB'],
        'sl_url': cfg['url'],
        'targets': {
            'payments': TARGET_PAYMENTS,
            'deposits': TARGET_DEPOSITS,
        },
        'incoming_payments': {},
        'deposits_check_lines': {},
    }

    # Fase 1A: HEADER de IncomingPayments (sin $expand — $expand=PaymentChecks da HTTP 400
    # "invalid navigation property" en este tenant SL v10). Es el bug conocido que el
    # sync Python evita via fetch per-doc del nested.
    log('--- Fase 1A: /IncomingPayments({N}) [header, sin expand] ---')
    for payment_doc_entry, check_abs_entry, check_number, hint in TARGET_PAYMENTS:
        log(f'[target] payment_doc_entry={payment_doc_entry} check_abs_entry={check_abs_entry} check_number={check_number} ({hint})')
        data = fetch_json(session, base_url, f'/b1s/v1/IncomingPayments({payment_doc_entry})')
        dump['incoming_payments'][str(payment_doc_entry)] = data
        if data.get('_error'):
            all_errors.append(f'IncomingPayments({payment_doc_entry}): HTTP {data["_status"]}')
            continue
        header_keys = summarize_keys(data)
        log(f'  header: {len(header_keys)} keys')
        # Chequear si hay algo tipo Deposited / Reconciled en el header mismo.
        interesting_header = [k for k in data.keys() if any(
            tok in k.lower() for tok in ('depos', 'reconc', 'cleared')
        )]
        if interesting_header:
            log(f'  [HINT] campos de interés en IncomingPayment header: {interesting_header}')
            for k in interesting_header:
                log(f'    -> {k} = {data.get(k)!r}')

    # Fase 1B: /IncomingPayments({N})/PaymentChecks (nested per-doc, sin $expand).
    # Este es el endpoint que usa el sync Python para poblar sap_payment_checks_raw.
    log('--- Fase 1B: /IncomingPayments({N})/PaymentChecks [nested per-doc] ---')
    dump['payment_checks_per_doc'] = {}
    for payment_doc_entry, check_abs_entry, check_number, hint in TARGET_PAYMENTS:
        log(f'[target] payment_doc_entry={payment_doc_entry} check_abs_entry={check_abs_entry} check_number={check_number} ({hint})')
        data = fetch_json(session, base_url, f'/b1s/v1/IncomingPayments({payment_doc_entry})/PaymentChecks')
        dump['payment_checks_per_doc'][str(payment_doc_entry)] = data
        if data.get('_error'):
            all_errors.append(f'IncomingPayments({payment_doc_entry})/PaymentChecks: HTTP {data["_status"]}')
            continue
        pc_list = data.get('value') or []
        log(f'  PaymentChecks[]: {len(pc_list)} items')
        if pc_list:
            first = pc_list[0]
            for line in summarize_keys(first, prefix='    '):
                log(line)
            # Buscar campos SOSPECHOSOS de ser flag de depósito O link a Deposit.
            interesting = [k for k in first.keys() if any(
                tok in k.lower() for tok in ('depos', 'reconc', 'status', 'cleared', 'applied', 'cashed', 'abs', 'key', 'rct')
            )]
            if interesting:
                log(f'  [HINT] campos de interés en PaymentCheck: {interesting}')
                for k in interesting:
                    log(f'    -> {k} = {first.get(k)!r}')

    # Fase 2: Deposits/CheckLines.
    log('--- Fase 2: /Deposits({M})/CheckLines ---')
    for deposit_abs_entry in TARGET_DEPOSITS:
        log(f'[target] deposit_abs_entry={deposit_abs_entry}')
        data = fetch_json(session, base_url, f'/b1s/v1/Deposits({deposit_abs_entry})/CheckLines')
        dump['deposits_check_lines'][str(deposit_abs_entry)] = data
        if data.get('_error'):
            all_errors.append(f'Deposits({deposit_abs_entry})/CheckLines: HTTP {data["_status"]}')
            continue
        arr = data.get('value') or data.get('CheckLines') or []
        log(f'  CheckLines[]: {len(arr)} items')
        if arr:
            first = arr[0]
            for line in summarize_keys(first, prefix='    '):
                log(line)
            interesting = [k for k in first.keys() if any(
                tok in k.lower() for tok in ('abs', 'key', 'check', 'rct', 'ocrt', 'payment', 'incoming')
            )]
            if interesting:
                log(f'  [HINT] campos de interés en CheckLine: {interesting}')
                for k in interesting:
                    log(f'    -> {k} = {first.get(k)!r}')

    # Fase 3 bonus: metadata declarado del entity. Útil para ver TODAS las
    # properties del entity PaymentCheck / CheckLine, incluso las que no vienen
    # populadas en los samples. El endpoint $metadata devuelve XML CSDL.
    log('--- Fase 3: $metadata (schema XML declarado del SL) ---')
    meta = fetch_json(session, base_url, '/b1s/v1/$metadata')
    if meta.get('_error'):
        all_errors.append(f'$metadata: HTTP {meta["_status"]}')
    elif '_raw_text' in meta:
        metadata_file = out_path / 'sl_metadata.xml'
        metadata_file.write_text(meta['_raw_text'], encoding='utf-8')
        log(f'  [OK] guardado en {metadata_file} ({len(meta["_raw_text"])} chars)')
        # Buscar inline las entidades que nos importan.
        xml = meta['_raw_text']
        for ent in ('PaymentCheck', 'CheckLine', 'IncomingPayment', 'Deposit'):
            idx = xml.find(f'EntityType Name="{ent}"')
            if idx >= 0:
                end = xml.find('</EntityType>', idx)
                snippet = xml[idx:end] if end > idx else xml[idx:idx+2000]
                log(f'  [HINT $metadata EntityType={ent}]: encontrado ({len(snippet)} chars del bloque)')
            else:
                log(f'  [HINT $metadata EntityType={ent}]: NO encontrado en la raíz del service document. Puede estar como ComplexType.')
    else:
        log('  [WARN] $metadata devolvió un shape inesperado — revisá sl_schema_dump.json.')

    # Volcar dump final.
    dump_file.write_text(json.dumps(dump, indent=2, default=str, ensure_ascii=False), encoding='utf-8')
    log(f'[OK] JSON dump en {dump_file}')
    log(f'[OK] Log en {log_file}')

    if all_errors:
        log(f'[WARN] fetches con error: {all_errors}')
        return 4
    return 0


if __name__ == '__main__':
    # Redirigir stdout también al archivo log.
    out_path = Path(OUT_DIR)
    out_path.mkdir(parents=True, exist_ok=True)
    log_file = out_path / 'sl_schema_dump.log'

    class Tee:
        def __init__(self, *streams):
            self.streams = streams
        def write(self, s):
            for st in self.streams:
                st.write(s)
                st.flush()
        def flush(self):
            for st in self.streams:
                st.flush()

    with open(log_file, 'w', encoding='utf-8') as f:
        sys.stdout = Tee(sys.__stdout__, f)
        sys.stderr = Tee(sys.__stderr__, f)
        code = main()
    sys.exit(code)
