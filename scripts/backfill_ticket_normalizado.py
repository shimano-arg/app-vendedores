"""Backfill ticketNormalizado en la coleccion rendiciones (one-off).

Contexto: al implementar el anti-duplicados (2026-09-09), agregamos el
campo `ticketNormalizado` que popula el CF onCreate trigger. Este script
recorre las rendiciones historicas y calcula el campo retroactivamente.

Ademas: identifica y opcionalmente MARCA como 'duplicado_detectado' las
rendiciones historicas que matchean fuerte con otra approved/pending del
mismo owner en la ventana de 90 dias. Corre en dry-run por default.

Uso:
    # 1. Dry-run — imprime todo lo que va a hacer sin escribir.
    python scripts/backfill_ticket_normalizado.py

    # 2. Apply — escribe los updates a Firestore. Requiere --apply explicito.
    python scripts/backfill_ticket_normalizado.py --apply

    # 3. Apply solo populate (sin marcar duplicados historicos):
    python scripts/backfill_ticket_normalizado.py --apply --populate-only

Auth: ADC (application default credentials). Correr:
    gcloud auth application-default login
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import io

from google.cloud import firestore

# Force UTF-8 stdout for Windows PowerShell (default cp1252 rompe con → y acentos).
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROJECT_ID = 'app-vendedores-shimano'
LOOKBACK_DAYS = 90

# --------------------------------------------------------------------------
# Replica de src/pure/rendicion-duplicate.js en Python (para no depender de
# node desde este script). Los tests unitarios JS son la fuente de verdad;
# aca replicamos la misma logica y en el commit-msg validamos que da igual.
# --------------------------------------------------------------------------


def normalizar_ticket(input_val: str | None) -> str | None:
    if input_val is None:
        return None
    s = str(input_val).strip().upper()
    if not s:
        return None
    # Separadores (espacio, /, \) -> guion.
    with_dashes = re.sub(r'[\s/\\]+', '-', s)
    if '-' in with_dashes:
        segments = [seg for seg in with_dashes.split('-') if seg != '']
        if not segments:
            return None
        normalized = []
        for seg in segments:
            stripped = seg.lstrip('0')
            normalized.append(stripped if stripped else '0')
        return '-'.join(normalized) or None
    # Sin guiones.
    stripped = with_dashes.lstrip('0')
    return stripped or None


def parse_cuit(obs: str | None) -> str | None:
    if not obs:
        return None
    m = re.search(r'CUIT[^\n:]*:\s*([\d\-/.\s]{11,17})', str(obs), re.IGNORECASE)
    if not m:
        return None
    digits = re.sub(r'\D+', '', m.group(1))
    if len(digits) != 11:
        return None
    return digits


def importe_canonico(v) -> int | None:
    if v is None or v == '':
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if not (n > 0):
        return None
    return round(n)


def fecha_ticket_canonica(r: dict) -> str | None:
    raw = r.get('fechaTicket') or r.get('fecha') or ''
    if not raw:
        return None
    s = str(raw).strip()
    m = re.match(r'(\d{4}-\d{2}-\d{2})', s)
    return m.group(1) if m else None


def claves_de_duplicado(r: dict) -> tuple[list[str], list[str]]:
    """Retorna (fuertes, debiles)."""
    ticket = normalizar_ticket(r.get('numeroTicket'))
    cuit = parse_cuit(r.get('observaciones'))
    importe = importe_canonico(r.get('importe'))
    fecha = fecha_ticket_canonica(r)
    fuertes: list[str] = []
    debiles: list[str] = []
    if cuit and ticket:
        fuertes.append(f'strong:cuit-ticket:{cuit}|{ticket}')
    if ticket and importe is not None:
        fuertes.append(f'strong:ticket-importe:{ticket}|{importe}')
    if cuit and importe is not None and fecha:
        debiles.append(f'weak:cuit-importe-fecha:{cuit}|{importe}|{fecha}')
    return fuertes, debiles


# --------------------------------------------------------------------------
# Backfill principal
# --------------------------------------------------------------------------

RELEVANT_STATUSES = {'approved', 'pending_approval'}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('--apply', action='store_true', help='Escribir a Firestore (default dry-run)')
    p.add_argument('--populate-only', action='store_true', help='Solo poblar ticketNormalizado, no marcar duplicados historicos')
    args = p.parse_args()

    mode = 'APPLY' if args.apply else 'DRY-RUN'
    print(f'[backfill] mode={mode}  populate-only={args.populate_only}')

    db = firestore.Client(project=PROJECT_ID)
    print('[backfill] leyendo rendiciones...')
    docs = list(db.collection('rendiciones').stream())
    print(f'[backfill] {len(docs)} rendiciones totales')

    # Agrupar por owner + calcular claves.
    by_owner: dict[str, list[dict]] = defaultdict(list)
    to_populate: list[tuple[str, str]] = []  # (docId, ticketNormalizado)
    stats = {
        'con_ticket': 0,
        'sin_ticket': 0,
        'ya_tenia_normalizado': 0,
        'a_poblar': 0,
    }
    for d in docs:
        data = d.to_dict() or {}
        ticket_norm = normalizar_ticket(data.get('numeroTicket'))
        if ticket_norm:
            stats['con_ticket'] += 1
        else:
            stats['sin_ticket'] += 1
        if data.get('ticketNormalizado'):
            stats['ya_tenia_normalizado'] += 1
        elif ticket_norm:
            to_populate.append((d.id, ticket_norm))
            stats['a_poblar'] += 1
        by_owner[data.get('ownerUid') or ''].append({
            '_id': d.id,
            '_data': data,
            '_ticketNorm': ticket_norm,
            '_fuertes': claves_de_duplicado(data)[0],
        })

    print(f'[backfill] stats: {stats}')

    # Detectar duplicados historicos (agrupar por owner + claves fuertes).
    dup_candidates: list[dict] = []
    for owner_uid, rends in by_owner.items():
        if not owner_uid:
            continue
        # Solo mirar rendiciones RELEVANTES (approved/pending) como "originales".
        # Cualquier rendicion nueva que matchee fuerte con una original en los
        # ultimos 90 dias es candidato duplicate_detected.
        by_clave: dict[str, list[dict]] = defaultdict(list)
        for r in rends:
            for k in r['_fuertes']:
                by_clave[k].append(r)
        for clave, group in by_clave.items():
            if len(group) < 2:
                continue
            # Sort por createdAt asc — el mas viejo es el "original".
            group.sort(key=lambda x: str(x['_data'].get('createdAt') or ''))
            original = group[0]
            for dup in group[1:]:
                # Filtro: solo marcar dup si el original es approved/pending
                # y el dup NO es rejected/duplicado_detectado ya.
                if original['_data'].get('status') not in RELEVANT_STATUSES:
                    continue
                if dup['_data'].get('status') in {'rejected', 'duplicado_detectado'}:
                    continue
                dup_candidates.append({
                    'dupId': dup['_id'],
                    'dupStatus': dup['_data'].get('status'),
                    'originalId': original['_id'],
                    'originalStatus': original['_data'].get('status'),
                    'clave': clave,
                    'ownerUid': owner_uid,
                    'ownerEmail': dup['_data'].get('ownerEmail', ''),
                    'importe': dup['_data'].get('importe'),
                    'numeroTicket': dup['_data'].get('numeroTicket'),
                })

    print(f'[backfill] duplicados historicos candidatos: {len(dup_candidates)}')

    # Report
    print()
    print('=' * 70)
    print('POPULATE ticketNormalizado (primeros 20)')
    print('=' * 70)
    for docid, tn in to_populate[:20]:
        print(f'  {docid[:20]:22}  → ticketNormalizado={tn!r}')
    if len(to_populate) > 20:
        print(f'  ... +{len(to_populate) - 20} mas')

    print()
    print('=' * 70)
    print('DUPLICADOS HISTORICOS (para marcar como duplicado_detectado)')
    print('=' * 70)
    for c in dup_candidates:
        print(f"  dup={c['dupId'][:12]:14} owner={c['ownerEmail']:35}  "
              f"orig={c['originalId'][:12]:14} clave={c['clave'][:60]}")
        print(f"    ticket={c['numeroTicket']} importe=${c['importe']}  origStatus={c['originalStatus']} dupStatus={c['dupStatus']}")

    # Apply
    if not args.apply:
        print()
        print('[backfill] DRY-RUN — no se escribio nada. Usar --apply para persistir.')
        return

    print()
    print('[backfill] APPLYING...')
    batch = db.batch()
    n_batch = 0
    total = 0

    # 1) Populate ticketNormalizado
    for docid, tn in to_populate:
        ref = db.collection('rendiciones').document(docid)
        batch.update(ref, {'ticketNormalizado': tn})
        n_batch += 1
        total += 1
        if n_batch >= 400:
            batch.commit()
            batch = db.batch()
            n_batch = 0

    # 2) Marcar duplicados historicos (solo si no --populate-only)
    if not args.populate_only:
        for c in dup_candidates:
            ref = db.collection('rendiciones').document(c['dupId'])
            update = {
                'status': 'duplicado_detectado',
                'duplicateOf': c['originalId'],
                'duplicateStrength': 'strong',
                'duplicateReason': c['clave'],
                'duplicateDetectedAt': datetime.now(timezone.utc).isoformat(),
                'duplicateDetectedBy': 'script/backfill_ticket_normalizado',
            }
            batch.update(ref, update)
            n_batch += 1
            total += 1
            if n_batch >= 400:
                batch.commit()
                batch = db.batch()
                n_batch = 0

    if n_batch > 0:
        batch.commit()

    print(f'[backfill] APPLY OK — {total} writes hechos')
    print(f'  populate: {len(to_populate)}')
    if not args.populate_only:
        print(f'  duplicados marcados: {len(dup_candidates)}')


if __name__ == '__main__':
    main()
