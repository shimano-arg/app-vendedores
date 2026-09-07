# -*- coding: utf-8 -*-
"""Cancela los 14 SQs SAP dup identificados en el audit 2026-08-28.

Ejecución segura:
    python scripts/cancel_dup_sqs.py --dry-run   # solo muestra qué haría
    python scripts/cancel_dup_sqs.py --apply     # ejecuta cancelación real

Requisitos:
- $env:SAP_SL_PASSWORD debe estar seteado antes de correr --apply
- ~/Desktop/sa-key.json (Firebase Admin SDK key)
- scripts/cancel_dup_sqs_mapping.json (mapeo SQ→pedidoId, generado previamente)

Comportamiento por cada SQ:
1. GET /Quotations({DocEntry}) → re-verifica que sigue Open + no Cancelled.
   Si cambió el estado desde el audit → skip ese SQ con warning.
2. POST /Quotations({DocEntry})/Cancel → cancela SQ en SAP.
3. Si el SQ tiene pedido-app asociado → cierra pedido en Firestore con
   closedAt=now, closedReason='cancelled_dup_sap_audit_2026-08-28'.
4. Log de cada operación a Firestore sap_sync_log/cancel_dup_2026-08-28_HHMMSS.

Fail-safe: si SAP cancel falla → NO toca Firestore. Atomicidad por SQ.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if SA_KEY.exists():
    os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY.read_text()
sys.stdout.reconfigure(encoding='utf-8')

import requests  # noqa: E402
from sync_sap_to_bigquery import init_firestore, parse_sa_json  # noqa: E402
from sync_sap_to_firestore import get_sl_config, sl_login  # noqa: E402
from firebase_admin import firestore  # noqa: E402

# ============================================================
# LOS 14 SQs A CANCELAR (audit 2026-08-28)
# Cada tupla: (DocEntry, DocNum, cliente, líneas_esperadas, unidades_totales, SQ_reemplazo)
# ============================================================
CANDIDATOS = [
    (49573, 2000042, 'PESCAR.INFO SHOP',       25, 121, [26403]),
    (48394, 25797,   'RICARDO BLANCO GOITIA',  14,  96, [25879]),
    (48399, 25801,   'MUNDO ESTURION',          3,  60, [2000044]),
    (49108, 2000013, 'FEDERICO RODRIGUEZ',      9,  12, [26241, 2000069]),
    (48199, 2000003, 'MARIA A. PRAT',           3,  10, [25714]),
    (49504, 26248,   'REBORN SRL',              2,   8, [26247]),
    (48480, 25841,   'REBORN SRL',              4,   8, [2000006]),
    (48773, 2000006, 'REBORN SRL',              3,   7, [2000015]),
    (48689, 25938,   'BROBRO SA',               5,   7, [2000051, 2000077]),
    (49900, 2000063, 'FERNANDO URQUIOLA',       3,   7, [26536]),
    (48240, 25728,   'GERARDO BIANCHINI',       1,   6, [2000012]),
    (49439, 26223,   'ROBERTO TOLABA',          3,   3, [26240]),
    (48875, 26028,   'DANIEL BATTISTONI',       1,   2, [2000108]),
    (48408, 25806,   'MARISA IANUNZIO',         1,   1, [26232]),
]

CLOSE_REASON = 'cancelled_dup_sap_audit_2026-08-28'


def log(msg):
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}')


def load_mapping():
    p = SCRIPT_DIR / 'cancel_dup_sqs_mapping.json'
    if not p.exists():
        log(f'[FATAL] Mapping SQ→pedidoId no encontrado en {p}. Correr audit primero.')
        sys.exit(2)
    m = json.loads(p.read_text(encoding='utf-8'))
    # keys son str por JSON; convertir a int
    return {int(k): v for k, v in m.items()}


def verify_sq_open(cfg, session, doc_entry):
    """GET /Quotations({DocEntry}) → devuelve dict con status actual o None si error."""
    url = f"{cfg['url']}/b1s/v1/Quotations({doc_entry})?$select=DocEntry,DocNum,DocumentStatus,Cancelled,CardCode,DocDate"
    resp = session.get(url, timeout=30)
    if resp.status_code == 401:
        log(f'  401 en verify SQ {doc_entry} - relogin')
        sl_login(cfg, session)
        resp = session.get(url, timeout=30)
    if not resp.ok:
        try:
            err = resp.json().get('error', {}).get('message', {}).get('value', '')
        except Exception:
            err = resp.text[:200]
        log(f'  ✗ verify SQ {doc_entry} HTTP {resp.status_code}: {err}')
        return None
    return resp.json()


def cancel_sq(cfg, session, doc_entry):
    """POST /Quotations({DocEntry})/Cancel → devuelve (ok: bool, detail: str)."""
    url = f"{cfg['url']}/b1s/v1/Quotations({doc_entry})/Cancel"
    resp = session.post(url, timeout=60)
    if resp.status_code == 401:
        sl_login(cfg, session)
        resp = session.post(url, timeout=60)
    if resp.status_code in (200, 204):
        return (True, f'HTTP {resp.status_code}')
    try:
        err = resp.json().get('error', {}).get('message', {}).get('value', '')
    except Exception:
        err = resp.text[:300]
    return (False, f'HTTP {resp.status_code}: {err}')


def close_pedido_app(db, pedido_id, doc_entry, doc_num):
    """Cierra pedido-app en Firestore con closedReason=CLOSE_REASON."""
    ref = db.collection('pedidos').document(pedido_id)
    snap = ref.get()
    if not snap.exists:
        return (False, 'pedido no existe en Firestore')
    d = snap.to_dict() or {}
    if d.get('closedAt'):
        return (False, f'pedido ya cerrado at {d.get("closedAt")} reason {d.get("closedReason")}')
    ref.update({
        'closedAt': firestore.SERVER_TIMESTAMP,
        'closedReason': CLOSE_REASON,
        'cancelledSapSq': {'docEntry': doc_entry, 'docNum': doc_num, 'cancelledAt': datetime.now(timezone.utc).isoformat()},
    })
    return (True, 'pedido-app cerrado')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='solo simular, no toca SAP ni Firestore')
    parser.add_argument('--apply', action='store_true', help='ejecutar cancelación real')
    args = parser.parse_args()

    if not (args.dry_run or args.apply):
        log('[FATAL] Especifica --dry-run o --apply')
        sys.exit(1)
    if args.apply and not os.environ.get('SAP_SL_PASSWORD'):
        log('[FATAL] --apply requiere $env:SAP_SL_PASSWORD seteado')
        sys.exit(1)

    mode = 'DRY-RUN' if args.dry_run else 'APPLY'
    log(f'=== CANCEL DUP SQs — modo {mode} ===')
    log(f'Total candidatos: {len(CANDIDATOS)} SQs, {sum(u for _,_,_,_,u,_ in CANDIDATOS)}u totales')

    db = init_firestore(parse_sa_json())
    mapping = load_mapping()

    session = requests.Session()
    cfg = None
    if not args.dry_run:
        cfg = get_sl_config(db)
        sl_login(cfg, session)
    else:
        # En dry-run intentamos login solo si hay password para poder verificar estado
        if os.environ.get('SAP_SL_PASSWORD'):
            cfg = get_sl_config(db)
            sl_login(cfg, session)
            log('[dry-run] SL login OK para verificación de estado')
        else:
            log('[dry-run] sin SAP_SL_PASSWORD → skip verificación SL, solo imprimo plan')

    audit_log = {
        'mode': mode,
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'candidatos': len(CANDIDATOS),
        'resultados': [],
    }

    for doc_entry, doc_num, cliente, lineas, u, reemplaza in CANDIDATOS:
        entrada = {
            'docEntry': doc_entry, 'docNum': doc_num, 'cliente': cliente,
            'lineas': lineas, 'unidades': u, 'reemplaza_a_SQ': reemplaza,
            'has_pedido_app': doc_entry in mapping,
            'pedidoId': mapping.get(doc_entry, {}).get('pedidoId'),
        }
        log('')
        log(f'--- SQ {doc_num} (entry {doc_entry}) {cliente} — {lineas}líneas / {u}u ---')

        # Paso 1: verificar estado actual del SQ
        current = None
        if cfg:
            current = verify_sq_open(cfg, session, doc_entry)
            if current is None:
                entrada['skipped_reason'] = 'no pude leer estado SL'
                entrada['action'] = 'SKIP'
                audit_log['resultados'].append(entrada)
                log(f'  SKIP: no pude verificar estado en SL')
                continue
            ds = current.get('DocumentStatus')
            can = current.get('Cancelled')
            entrada['current_status'] = ds
            entrada['current_cancelled'] = can
            log(f'  estado actual: DocumentStatus={ds} Cancelled={can}')
            if ds != 'bost_Open' or can != 'tNO':
                entrada['skipped_reason'] = f'ya no está Open+tNO (status={ds} cancelled={can})'
                entrada['action'] = 'SKIP'
                audit_log['resultados'].append(entrada)
                log(f'  SKIP: SQ ya no está open. Nada que cancelar.')
                continue

        # Paso 2: cancelar (o simular)
        if args.dry_run:
            entrada['action'] = 'CANCEL(dry-run)'
            log(f'  [dry-run] cancelaría SQ {doc_entry}')
            if entrada['pedidoId']:
                log(f'  [dry-run] + cerraría pedido-app {entrada["pedidoId"]}')
        else:
            log(f'  cancelando SQ {doc_entry} en SAP...')
            ok, detail = cancel_sq(cfg, session, doc_entry)
            entrada['sap_cancel_ok'] = ok
            entrada['sap_cancel_detail'] = detail
            if not ok:
                entrada['action'] = 'FAILED'
                log(f'  ✗ SAP cancel FALLÓ: {detail}. No toco Firestore.')
                audit_log['resultados'].append(entrada)
                continue
            log(f'  ✓ SAP cancel OK: {detail}')

            # Paso 3: cerrar pedido-app si aplica
            if entrada['pedidoId']:
                ok_fs, detail_fs = close_pedido_app(db, entrada['pedidoId'], doc_entry, doc_num)
                entrada['fs_close_ok'] = ok_fs
                entrada['fs_close_detail'] = detail_fs
                if ok_fs:
                    log(f'  ✓ pedido-app {entrada["pedidoId"]} cerrado')
                    entrada['action'] = 'CANCELLED+PEDIDO_CLOSED'
                else:
                    log(f'  ⚠ pedido-app {entrada["pedidoId"]} NO cerrado: {detail_fs}')
                    entrada['action'] = 'CANCELLED+PEDIDO_WARN'
            else:
                entrada['action'] = 'CANCELLED'

            # Ritmo suave para no saturar SAP SL
            time.sleep(0.5)

        audit_log['resultados'].append(entrada)

    # Resumen
    log('')
    log('=== RESUMEN ===')
    from collections import Counter
    cnt = Counter(r['action'] for r in audit_log['resultados'])
    for k, v in cnt.items():
        log(f'  {k}: {v}')

    # Escribir audit log
    audit_log['finishedAt'] = datetime.now(timezone.utc).isoformat()
    ts = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H%M%SZ')
    docid = f'cancel_dup_{ts}_{"dry" if args.dry_run else "apply"}'
    db.collection('sap_sync_log').document(docid).set(audit_log)
    log(f'Audit log guardado en sap_sync_log/{docid}')

    # CSV backup
    csv_path = SCRIPT_DIR.parent / f'cancel_dup_sqs_{ts}.csv'
    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        import csv
        w = csv.writer(f)
        w.writerow(['docEntry', 'docNum', 'cliente', 'unidades', 'action', 'sap_detail', 'fs_detail', 'pedidoId'])
        for r in audit_log['resultados']:
            w.writerow([
                r['docEntry'], r['docNum'], r['cliente'], r['unidades'],
                r.get('action'), r.get('sap_cancel_detail', ''), r.get('fs_close_detail', ''),
                r.get('pedidoId', ''),
            ])
    log(f'CSV backup: {csv_path}')


if __name__ == '__main__':
    main()
