"""
Backfill clientCardCode faltantes en pedidos existentes (one-shot).

Problema (reporte cowork 2026-10-07):
~1570 lineas en `v_pedidos_lines` tienen cliente_nombre pero cliente_code vacio.
La vista BQ lee `JSON_VALUE(p.data, '$.clientCardCode')` directo de Firestore.
Si el pedido se creo cuando `sapGetClienteCode(clientName)` devolvio '' silencioso
(cliente no mapeado en sap_clients o nombre no normalizado), queda sin cardCode.

Este script resuelve los pedidos ya cargados buscando el nombre en 3 fuentes:
  1. BigQuery sap_bp_raw (maestro SAP real, sync cada 30min)
  2. Firestore sap_clients (mapeo manual admin)
  3. Firestore client_applications (altas aprobadas con cardCodeSap)

Normalizacion: UPPER + TRIM + remover sufijos legales (.SA/SRL/S.R.L./SA./SRL.).

Dry-run por default (muestra sin escribir). Correr con DRY_RUN=false para aplicar.

Output:
  - stdout: resumen por fuente + sample matches/non-matches
  - backfill_pedido_cardcode_unresolved.csv: nombres no resueltos para review manual

Env vars:
  FIREBASE_SERVICE_ACCOUNT   JSON SA con permisos read Firestore + read BQ
  DRY_RUN                    'true' (default) | 'false' (aplica writes)

Uso:
  # Dry-run (default):
  $env:FIREBASE_SERVICE_ACCOUNT = Get-Content path/to/sa.json -Raw
  python scripts/backfill_pedido_cardcode.py

  # Aplicar:
  $env:DRY_RUN = 'false'
  python scripts/backfill_pedido_cardcode.py
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print('[ERROR] firebase-admin no instalado. pip install firebase-admin', file=sys.stderr)
    sys.exit(2)

try:
    from google.cloud import bigquery
    from google.oauth2 import service_account
except ImportError:
    print('[ERROR] google-cloud-bigquery no instalado. pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(2)


BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'

FB_SA_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '')
DRY_RUN = (os.environ.get('DRY_RUN', 'true').lower() != 'false')


def log(msg: str) -> None:
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


# ============================================================
# Normalizacion de nombres (replicar sapNorm del frontend)
# ============================================================
# Patrones para remover sufijos legales + puntuacion.
# Replica + extiende lo que hace sap-admin-panel.js:sapNorm
_LEGAL_SUFFIX_RE = re.compile(
    r'\s*(S\.?\s*A\.?|S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*A\.?\s*I\.?\s*C\.?|S\.?\s*C\.?\s*A\.?)\s*$',
    re.IGNORECASE,
)
_MULTI_SPACE_RE = re.compile(r'\s+')


def norm_name(name: str) -> str:
    """Normaliza nombre de cliente para match case-insensitive.
    Mas agresivo que el sapNorm del frontend — remueve puntuacion + sufijos legales
    comunes (SA, SRL, etc) para pescar "REBORN SRL" == "REBORN S.R.L." == "REBORN".
    """
    if not name:
        return ''
    s = str(name).upper().strip()
    # Remover puntuacion sobrante (puntos, comas, apostrofes).
    s = s.replace('.', '').replace(',', '').replace("'", '').replace('"', '')
    # Remover sufijos legales iterativamente (algunos tienen 2 sufijos pegados).
    for _ in range(3):
        new = _LEGAL_SUFFIX_RE.sub('', s)
        if new == s:
            break
        s = new.strip()
    # Colapsar whitespace multiple.
    s = _MULTI_SPACE_RE.sub(' ', s).strip()
    return s


# ============================================================
# Firestore + BigQuery clients
# ============================================================
def init_firestore() -> firestore.Client:
    if not FB_SA_JSON:
        raise SystemExit('[ERROR] FIREBASE_SERVICE_ACCOUNT no seteada')
    sa = json.loads(FB_SA_JSON)
    cred = credentials.Certificate(sa)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def init_bigquery() -> bigquery.Client:
    if not FB_SA_JSON:
        raise SystemExit('[ERROR] FIREBASE_SERVICE_ACCOUNT no seteada')
    sa = json.loads(FB_SA_JSON)
    creds = service_account.Credentials.from_service_account_info(sa)
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


# ============================================================
# Cargar las 3 fuentes de mapeo nombre→cardCode
# ============================================================
def load_sap_bp_raw(bq: bigquery.Client) -> dict:
    """Fuente 1: maestro SAP real desde BigQuery sap_bp_raw."""
    log('[SOURCE 1] cargando sap_bp_raw desde BigQuery...')
    q = f"""
        SELECT card_code, card_name
        FROM `{BQ_PROJECT}.{BQ_DATASET}.sap_bp_raw`
        WHERE card_code IS NOT NULL AND card_name IS NOT NULL
    """
    result = bq.query(q).result()
    name_to_code = {}
    rows = 0
    for row in result:
        rows += 1
        norm = norm_name(row['card_name'])
        if not norm:
            continue
        # Si hay colision (dos cardCodes para el mismo nombre normalizado),
        # el primero gana. En BPs reales esto es raro.
        if norm not in name_to_code:
            name_to_code[norm] = {
                'card_code': row['card_code'],
                'card_name_raw': row['card_name'],
                'source': 'sap_bp_raw',
            }
    log(f'[SOURCE 1] sap_bp_raw: {rows} rows totales, {len(name_to_code)} nombres unicos normalizados')
    return name_to_code


def load_sap_clients_map(db: firestore.Client) -> dict:
    """Fuente 2: mapeo manual admin desde Firestore sap_clients."""
    log('[SOURCE 2] cargando sap_clients desde Firestore...')
    name_to_code = {}
    rows = 0
    for doc in db.collection('sap_clients').stream():
        rows += 1
        data = doc.to_dict() or {}
        card_code = (data.get('sapCode') or data.get('cardCode') or '').strip()
        if not card_code:
            continue
        # El doc_id de sap_clients es el nombre normalizado por el frontend.
        # El doc tambien tiene `name` o `nombre` con el original.
        raw_name = data.get('name') or data.get('nombre') or doc.id
        norm = norm_name(raw_name)
        if not norm:
            continue
        if norm not in name_to_code:
            name_to_code[norm] = {
                'card_code': card_code,
                'card_name_raw': raw_name,
                'source': 'sap_clients',
            }
    log(f'[SOURCE 2] sap_clients: {rows} docs totales, {len(name_to_code)} nombres unicos normalizados')
    return name_to_code


def load_client_applications_map(db: firestore.Client) -> dict:
    """Fuente 3: altas aprobadas con cardCodeSap en Firestore client_applications."""
    log('[SOURCE 3] cargando client_applications desde Firestore...')
    name_to_code = {}
    rows = 0
    for doc in db.collection('client_applications').stream():
        rows += 1
        data = doc.to_dict() or {}
        card_code = (data.get('cardCodeSap') or '').strip()
        if not card_code:
            continue
        # Un doc client_applications puede tener 3 nombres distintos (comercio,
        # titular, fantasia). Mapeamos los 3 al mismo cardCode.
        candidates = [
            data.get('comercio'),
            data.get('titular'),
            data.get('fantasia'),
        ]
        for raw_name in candidates:
            if not raw_name:
                continue
            norm = norm_name(raw_name)
            if not norm:
                continue
            if norm not in name_to_code:
                name_to_code[norm] = {
                    'card_code': card_code,
                    'card_name_raw': raw_name,
                    'source': 'client_applications',
                }
    log(f'[SOURCE 3] client_applications: {rows} docs totales, {len(name_to_code)} nombres unicos normalizados')
    return name_to_code


# ============================================================
# Resolver + backfill
# ============================================================
def resolve_cardcode(client_name: str, maps: list[dict]) -> dict | None:
    """Busca el cardCode en las 3 fuentes por orden de prioridad.
    Devuelve {card_code, source, card_name_raw} del primer match, o None.
    """
    norm = norm_name(client_name)
    if not norm:
        return None
    for m in maps:
        if norm in m:
            hit = m[norm]
            return {
                'card_code': hit['card_code'],
                'source': hit['source'],
                'card_name_raw': hit['card_name_raw'],
                'norm_name': norm,
            }
    return None


def fetch_pedidos_without_cardcode(db: firestore.Client) -> list[tuple[str, dict]]:
    """Query Firestore `pedidos` donde clientCardCode esta vacio o missing.
    Devuelve [(doc_id, data), ...].
    """
    log('[FS] escaneando pedidos sin clientCardCode...')
    out = []
    total = 0
    for doc in db.collection('pedidos').stream():
        total += 1
        data = doc.to_dict() or {}
        card_code = (data.get('clientCardCode') or '').strip()
        if card_code:
            continue
        name = (data.get('clientName') or '').strip()
        if not name:
            # Pedido sin nombre tampoco — nada que resolver.
            continue
        out.append((doc.id, data))
    log(f'[FS] {total} pedidos totales, {len(out)} sin clientCardCode (con clientName)')
    return out


def backfill(
    db: firestore.Client,
    pedidos: list[tuple[str, dict]],
    maps: list[dict],
) -> dict:
    """Resuelve + batch-update. Default dry-run.
    Devuelve estadisticas.
    """
    stats = {
        'total_sin_cardcode': len(pedidos),
        'resueltos_sap_bp_raw': 0,
        'resueltos_sap_clients': 0,
        'resueltos_client_applications': 0,
        'no_resueltos': 0,
        'write_errors': 0,
    }
    resolved = []  # [(doc_id, old_name, resolved_cardcode, resolved_source, resolved_name_raw)]
    unresolved = []  # [(doc_id, old_name, order_number)]

    for doc_id, data in pedidos:
        name = (data.get('clientName') or '').strip()
        hit = resolve_cardcode(name, maps)
        if hit:
            stats[f'resueltos_{hit["source"]}'] = stats.get(f'resueltos_{hit["source"]}', 0) + 1
            resolved.append((
                doc_id,
                name,
                hit['card_code'],
                hit['source'],
                hit['card_name_raw'],
            ))
        else:
            stats['no_resueltos'] += 1
            unresolved.append((
                doc_id,
                name,
                str(data.get('orderNumber') or ''),
            ))

    log(f'[RESOLVE] resueltos: {sum(stats[k] for k in stats if k.startswith("resueltos_"))} / {len(pedidos)}')
    log(f'[RESOLVE] no_resueltos: {stats["no_resueltos"]}')

    # Mostrar sample de 10 resueltos y 10 no-resueltos.
    log('\n[SAMPLE RESUELTOS] (hasta 10):')
    for r in resolved[:10]:
        log(f'  {r[0][:12]}  "{r[1][:40]}"  →  {r[2]}  (via {r[3]}, matched "{r[4][:40]}")')

    log('\n[SAMPLE NO_RESUELTOS] (hasta 10):')
    for u in unresolved[:10]:
        log(f'  {u[0][:12]}  "{u[1][:60]}"  (ORDEN {u[2]})')

    # Write a CSV los no-resueltos para review manual.
    if unresolved:
        csv_path = Path(__file__).parent.parent / 'backfill_pedido_cardcode_unresolved.csv'
        with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f)
            w.writerow(['pedido_id', 'client_name', 'order_number'])
            for u in unresolved:
                w.writerow(u)
        log(f'[CSV] {len(unresolved)} no_resueltos escritos a {csv_path}')

    # Writes a Firestore (si no es dry-run).
    if DRY_RUN:
        log(f'\n[DRY_RUN] NO escribo nada. Correr con DRY_RUN=false para aplicar los {len(resolved)} updates.')
        return stats

    log(f'\n[WRITE] aplicando {len(resolved)} updates a Firestore...')
    # Firestore batch limit = 500. Chunking.
    CHUNK = 400
    for i in range(0, len(resolved), CHUNK):
        batch = db.batch()
        slice_r = resolved[i:i + CHUNK]
        for doc_id, _name, card_code, source, _raw in slice_r:
            ref = db.collection('pedidos').document(doc_id)
            batch.update(ref, {
                'clientCardCode': card_code,
                '_backfillCardCode': {
                    'source': source,
                    'at': datetime.utcnow().isoformat() + 'Z',
                    'script': 'backfill_pedido_cardcode.py',
                },
            })
        try:
            batch.commit()
            log(f'[WRITE] batch {i // CHUNK + 1}: {len(slice_r)} docs OK')
        except Exception as e:
            stats['write_errors'] += len(slice_r)
            log(f'[WRITE] batch {i // CHUNK + 1} ERROR: {e}')
    return stats


# ============================================================
# Main
# ============================================================
def main() -> int:
    log('=== backfill_pedido_cardcode START ===')
    log(f'  DRY_RUN: {DRY_RUN}')

    db = init_firestore()
    bq = init_bigquery()

    # Cargar las 3 fuentes en orden de prioridad.
    map_bp_raw = load_sap_bp_raw(bq)              # Prioridad 1: SAP real
    map_sap_clients = load_sap_clients_map(db)    # Prioridad 2: mapeo admin
    map_altas = load_client_applications_map(db)  # Prioridad 3: altas aprobadas

    maps = [map_bp_raw, map_sap_clients, map_altas]

    # Fetch pedidos sin cardCode.
    pedidos = fetch_pedidos_without_cardcode(db)

    if not pedidos:
        log('[DONE] No hay pedidos sin cardCode. Nada que backfillear.')
        return 0

    # Resolver + backfill.
    stats = backfill(db, pedidos, maps)

    log('\n=== RESUMEN ===')
    for k, v in stats.items():
        log(f'  {k}: {v}')

    if DRY_RUN:
        log('\n[DRY_RUN] Para aplicar: setear DRY_RUN=false y re-correr.')
    else:
        log(f'\n[DONE] Backfill aplicado. BQ v_pedidos_lines se actualiza al proximo sync (~30min).')
        log(f'[DONE] Query de validacion: SELECT COUNT(*) FROM v_pedidos_lines WHERE cliente_code IS NULL OR cliente_code = ""')

    return 0


if __name__ == '__main__':
    sys.exit(main())
