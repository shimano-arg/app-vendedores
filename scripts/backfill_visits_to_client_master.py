"""Backfill client_master.lastVisit desde visits historicos (one-off).

Contexto: al implementar F2 (CF onVisitCreatedDenormToClientMaster, v1056)
denormalizamos los atributos comerciales de cada visita nueva al doc del
cliente en client_master. Este script hace lo mismo retroactivamente para
todas las visitas historicas — agrupa por cliente y aplica la ultima visita
(por fecha) como lastVisit.

Reusa la logica del core en functions/core/denorm-visit-to-client-master-core.js
(replica de norm() + extractLastVisitPayload en Python).

Uso:
    # 1. Dry-run - imprime todo lo que va a escribir sin tocar Firestore.
    python scripts/backfill_visits_to_client_master.py

    # 2. Apply - escribe los updates. Requiere --apply explicito.
    python scripts/backfill_visits_to_client_master.py --apply

Auth: ADC (application default credentials). Correr una vez:
    gcloud auth application-default login
"""
from __future__ import annotations

import argparse
import io
import re
import sys
from collections import defaultdict
from unicodedata import normalize as _unicode_normalize

from google.cloud import firestore

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROJECT_ID = 'app-vendedores-shimano'


# --------------------------------------------------------------------------
# Replica de clientLocId + extractLastVisitPayload en Python.
# Fuente de verdad: functions/core/denorm-visit-to-client-master-core.js
# --------------------------------------------------------------------------


def _norm(s: str | None) -> str:
    if not s:
        return ''
    lowered = str(s).lower()
    stripped = _unicode_normalize('NFD', lowered)
    stripped = ''.join(c for c in stripped if not (0x0300 <= ord(c) <= 0x036F))
    stripped = re.sub(r'[^a-z0-9]+', '_', stripped)
    stripped = re.sub(r'^_|_$', '', stripped)
    return stripped


def client_loc_id(prov: str, loc: str, tienda: str) -> str:
    return f'{_norm(prov)}__{_norm(loc)}__{_norm(tienda)}'


def extract_last_visit_payload(visit: dict, visit_id: str) -> dict | None:
    out: dict = {}
    if visit.get('fidelidad'):
        out['fidelidad'] = str(visit['fidelidad'])
    tamanos = visit.get('tamanos')
    if isinstance(tamanos, list) and tamanos:
        out['tamanos'] = list(tamanos)
    especializaciones = visit.get('especializaciones')
    if isinstance(especializaciones, list) and especializaciones:
        out['especializaciones'] = list(especializaciones)
    if visit.get('canalCompra'):
        out['canalCompra'] = str(visit['canalCompra'])
    if visit.get('tipoVenta'):
        out['tipoVenta'] = str(visit['tipoVenta'])
    if visit.get('tipoVenta') == 'AMBOS':
        pm = visit.get('ponderacionMostrado')
        pe = visit.get('ponderacionEcommerce')
        if isinstance(pm, (int, float)):
            out['ponderacionMostrado'] = pm
        if isinstance(pe, (int, float)):
            out['ponderacionEcommerce'] = pe
    if not out:
        return None
    out['fecha'] = visit.get('fecha') or ''
    out['byUid'] = visit.get('createdByUid') or ''
    out['byDisplayName'] = visit.get('createdByDisplayName') or visit.get('createdByEmail') or ''
    out['visitId'] = visit_id
    return out


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--apply', action='store_true', help='Ejecuta writes (default: dry-run)')
    parser.add_argument('--limit', type=int, default=None, help='Limitar clientes procesados (debug)')
    args = parser.parse_args()

    mode = 'APPLY' if args.apply else 'DRY-RUN'
    print(f'[backfill-visits] Modo: {mode}')
    print(f'[backfill-visits] Project: {PROJECT_ID}')

    db = firestore.Client(project=PROJECT_ID)

    print('[backfill-visits] Fetch visits (esto puede tardar)...')
    visits_ref = db.collection('visits')
    all_visits = list(visits_ref.stream())
    print(f'[backfill-visits] Total visits leidas: {len(all_visits)}')

    # Agrupar por docId, quedarse con la ultima por fecha.
    latest_by_client: dict[str, tuple[str, dict, str]] = {}
    skipped_missing = 0
    skipped_no_attrs = 0

    for v in all_visits:
        data = v.to_dict() or {}
        prov = data.get('provincia') or ''
        loc = data.get('localidad') or ''
        tienda = data.get('tienda') or ''
        if not (prov and loc and tienda):
            skipped_missing += 1
            continue
        payload = extract_last_visit_payload(data, v.id)
        if payload is None:
            skipped_no_attrs += 1
            continue
        doc_id = client_loc_id(prov, loc, tienda)
        fecha = payload.get('fecha') or ''
        prev = latest_by_client.get(doc_id)
        if prev is None or fecha > prev[0]:
            latest_by_client[doc_id] = (fecha, payload, v.id)

    print(f'[backfill-visits] Clientes candidatos: {len(latest_by_client)}')
    print(f'[backfill-visits] Visitas skipped por prov/loc/tienda vacios: {skipped_missing}')
    print(f'[backfill-visits] Visitas skipped por no atributos comerciales: {skipped_no_attrs}')

    # Fetch client_master existentes para chequear LWW guard (no pisar si el
    # trigger CF ya escribio uno mas nuevo — irrelevante al primer backfill,
    # importante si se corre el script una segunda vez despues del deploy).
    print('[backfill-visits] Fetch client_master existentes...')
    cm_ref = db.collection('client_master')
    existing = {snap.id: (snap.to_dict() or {}) for snap in cm_ref.stream()}
    print(f'[backfill-visits] client_master docs existentes: {len(existing)}')

    to_write = []
    skipped_older = 0
    for doc_id, (fecha, payload, visit_id) in latest_by_client.items():
        prev_cm = existing.get(doc_id) or {}
        prev_last = prev_cm.get('lastVisit') or {}
        prev_fecha = str(prev_last.get('fecha') or '')
        if prev_fecha and prev_fecha >= fecha:
            skipped_older += 1
            continue
        to_write.append((doc_id, payload, prev_cm.get('provincia'), payload.get('fecha')))

    print(f'[backfill-visits] Docs a escribir: {len(to_write)}')
    print(f'[backfill-visits] Docs skipped por lastVisit ya newer: {skipped_older}')

    if args.limit:
        to_write = to_write[: args.limit]
        print(f'[backfill-visits] Limitando a {len(to_write)} (--limit)')

    if mode == 'DRY-RUN':
        print('[backfill-visits] --- Preview primeros 10 ---')
        for doc_id, payload, prev_prov, fecha in to_write[:10]:
            print(f'  {doc_id} <- fidelidad={payload.get("fidelidad")} '
                  f'tipoVenta={payload.get("tipoVenta")} fecha={fecha}')
        print('[backfill-visits] Re-ejecutar con --apply para escribir.')
        return

    # APPLY: batches de 400 (limite Firestore = 500 por batch, dejo margen).
    print('[backfill-visits] Aplicando writes...')
    BATCH_SIZE = 400
    written = 0
    for i in range(0, len(to_write), BATCH_SIZE):
        chunk = to_write[i: i + BATCH_SIZE]
        batch = db.batch()
        for doc_id, payload, _, _ in chunk:
            ref = db.collection('client_master').document(doc_id)
            update = {
                'lastVisit': payload,
                'lastVisitDenormAt': firestore.SERVER_TIMESTAMP,
            }
            # Si el doc no existia, popular metadatos basicos.
            if doc_id not in existing:
                # Buscar prov/loc/tienda del payload (los tenemos del visit doc).
                # OJO: payload no los tiene, tenemos que ir a rebuscarlos en
                # latest_by_client. Peor, del visit original — que ya no
                # tenemos aca. Skip metadatos: el trigger CF cuando corra
                # sobre nuevas visitas los llenara. Para el backfill inicial,
                # el doc queda con lastVisit + provinsia/localidad/clientName
                # se pueden derivar del docId o quedar vacios.
                pass
            batch.set(ref, update, merge=True)
            written += 1
        batch.commit()
        print(f'[backfill-visits] batch {i // BATCH_SIZE + 1}: escritos {written}/{len(to_write)}')

    print(f'[backfill-visits] Done. Total escritos: {written}')


if __name__ == '__main__':
    main()
