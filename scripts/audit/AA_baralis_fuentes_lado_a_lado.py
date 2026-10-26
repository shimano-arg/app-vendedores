"""AA — Baralis Isidoro Joaquin (C20402598515) — valores lado a lado por fuente.

Read-only prod audit (§31 CLAUDE.md). NO modifica nada. Solo informa.

Fuentes consultadas:
  1. BQ v_cartera_vendor (vista fuente del dashboard)
  2. BQ v_ventas_lineas (facturas SAP, origen de ULT.COMPRA + FACT12M)
  3. Firestore cartera_vendor/{vendorKey} (snapshot nightly 04:00 ART)
  4. Firestore client_master/{docId} (lo que escribe la Ficha Cliente)
  5. Firestore client_applications where cardCodeSap == C20402598515
  6. Firestore pedidos where clientCardCode == C20402598515

Output:
  - stdout tabla
  - Desktop\\BARALIS_INCONSISTENCIAS\\baralis_fuentes_lado_a_lado.md

Autorizado por Mariano 2026-10-26: "antes de cambiar nada, mostrame los valores
de cada fuente lado a lado".
"""

import json
import sys
from pathlib import Path
from datetime import datetime

from google.cloud import bigquery
import firebase_admin
from firebase_admin import firestore

BQ_PROJECT = 'app-vendedores-shimano'
BQ_LOCATION = 'southamerica-east1'
CARD_CODE = 'C20402598515'
CLIENT_NAME_HINT = 'BARALIS'
VENDOR_KEY = 'GONZALO DE LA ROSA'

OUT_DIR = Path.home() / 'Desktop' / 'BARALIS_INCONSISTENCIAS'
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_MD = OUT_DIR / 'baralis_fuentes_lado_a_lado.md'

bq = bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={'projectId': BQ_PROJECT})
db = firestore.client()

report_lines = []


def log(s=''):
    print(s)
    report_lines.append(s)


log('# Baralis Isidoro Joaquin — Valores por fuente — ' + datetime.now().isoformat())
log('')
log(f'CardCode: {CARD_CODE}  ·  VendorKey esperado: {VENDOR_KEY}')
log('')

# ---- 1. BQ v_cartera_vendor ----
log('## 1. BQ `v_cartera_vendor` (fuente del dashboard)')
log('')
sql = f"""
SELECT vendor_key, client_id, card_code, client_name, province, loc_name,
       cli_tipo, ultima_visita_presencial, ultimo_contacto,
       ultima_compra, facturado_12m, deuda_abierta,
       dias_sin_visita_presencial, dias_sin_contacto, dias_sin_compra
FROM `app-vendedores-shimano.shimano_app.v_cartera_vendor`
WHERE card_code = '{CARD_CODE}'
"""
rows = list(bq.query(sql).result())
if not rows:
    log('_(sin filas en v_cartera_vendor para este cardCode)_')
else:
    for r in rows:
        log('```')
        for k, v in dict(r).items():
            log(f'  {k:35s}: {v}')
        log('```')
log('')

# ---- 2. BQ v_ventas_lineas (facturas SAP, últimos 15) ----
log('## 2. BQ `v_ventas_lineas` (origen ULT.COMPRA + FACT12M)')
log('')
sql = f"""
SELECT doc_kind, doc_num, doc_date, item_code, descripcion_linea,
       cantidad, importe_linea_ars
FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
WHERE card_code = '{CARD_CODE}'
ORDER BY doc_date DESC
LIMIT 25
"""
try:
    rows = list(bq.query(sql).result())
except Exception as e:
    log(f'_(error query v_ventas_lineas: {e})_')
    rows = []

if not rows:
    log('_(sin filas en v_ventas_lineas — NO hay facturas SAP para este cliente)_')
else:
    log(f'Total líneas devueltas: {len(rows)}')
    log('')
    log('| doc_kind | doc_num | doc_date | item_code | descripcion | cantidad | importe_ars |')
    log('|---|---|---|---|---|---:|---:|')
    for r in rows:
        d = dict(r)
        dd = d.get('doc_date')
        dd_s = dd.isoformat() if dd else ''
        name = (d.get('descripcion_linea') or '')[:40]
        log(f"| {d.get('doc_kind')} | {d.get('doc_num')} | {dd_s} | {d.get('item_code')} | {name} | {d.get('cantidad')} | {d.get('importe_linea_ars')} |")

    # Agregado como lo hace la view
    log('')
    log('**Agregado como lo computa la view**:')
    sql2 = f"""
    SELECT
      MAX(IF(doc_kind = 'INVOICE', doc_date, NULL)) AS ultima_compra_sap,
      SUM(IF(doc_date >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 12 MONTH),
             importe_linea_ars, 0)) AS facturado_12m_sap,
      COUNTIF(doc_kind = 'INVOICE') AS invoice_lines_count
    FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
    WHERE card_code = '{CARD_CODE}'
    """
    agg = list(bq.query(sql2).result())[0]
    log('```')
    log(f'  ultima_compra_sap    : {agg.ultima_compra_sap}')
    log(f'  facturado_12m_sap    : {agg.facturado_12m_sap}')
    log(f'  invoice_lines_count  : {agg.invoice_lines_count}')
    log('```')
log('')

# ---- 3. Firestore cartera_vendor/{vendor} ----
log(f'## 3. Firestore `cartera_vendor/{VENDOR_KEY}` (snapshot nightly 04:00 ART)')
log('')
doc = db.collection('cartera_vendor').document(VENDOR_KEY).get()
if not doc.exists:
    log(f'_(doc cartera_vendor/{VENDOR_KEY} NO existe)_')
else:
    d = doc.to_dict()
    log(f'snapshotAt   : {d.get("snapshotAt")}')
    log(f'snapshotDate : {d.get("snapshotDate")}')
    log(f'total clientes en array: {len(d.get("clientes", []))}')
    hit = None
    for c in d.get('clientes', []):
        if c.get('cardCode') == CARD_CODE:
            hit = c
            break
    if hit is None:
        log(f'_(Baralis NO está en el array clientes del vendor {VENDOR_KEY})_')
    else:
        log('')
        log('Entry Baralis:')
        log('```')
        for k, v in hit.items():
            log(f'  {k:28s}: {v}')
        log('```')
log('')

# ---- 4. Firestore client_master ----
log('## 4. Firestore `client_master` (lo que escribe la Ficha Cliente — campo `cliTipo`)')
log('')
# Buscar por sapCardCode
q = db.collection('client_master').where('sapCardCode', '==', CARD_CODE).get()
hits = list(q)
log(f'Docs con sapCardCode="{CARD_CODE}": {len(hits)}')
log('')
for h in hits:
    d = h.to_dict() or {}
    log(f'### docId: `{h.id}`')
    log('```')
    for k in ['sapCardCode', 'clientName', 'provincia', 'localidad', 'vendor',
              'cliTipo', 'cliTamano', 'cliFidelidad', 'cliEspecializacion',
              'cliEstado', 'cliStatus', 'cliBike', 'cliPesca',
              'updatedBy', 'updatedByUid', 'updatedAt']:
        if k in d:
            v = d[k]
            if hasattr(v, 'isoformat'):
                v = v.isoformat()
            log(f'  {k:28s}: {v}')
    log('```')
    log('')

# También buscar por clientName (por si tiene docID por name sin sapCardCode)
log('_También probar por clientName LIKE BARALIS:_')
q2 = db.collection('client_master').where('clientName', '>=', CLIENT_NAME_HINT).where('clientName', '<', CLIENT_NAME_HINT + '').get()
for h in q2:
    if h.id in [x.id for x in hits]:
        continue  # ya mostrado
    d = h.to_dict() or {}
    log(f'### docId: `{h.id}` (match por name, sin sapCardCode exacto)')
    log('```')
    for k in ['sapCardCode', 'clientName', 'provincia', 'localidad', 'vendor', 'cliTipo', 'updatedAt']:
        if k in d:
            v = d[k]
            if hasattr(v, 'isoformat'):
                v = v.isoformat()
            log(f'  {k:28s}: {v}')
    log('```')
log('')

# ---- 5. Firestore client_applications ----
log('## 5. Firestore `client_applications` (otra fuente de cliTipo en BQ view — prioritaria)')
log('')
q = db.collection('client_applications').where('cardCodeSap', '==', CARD_CODE).get()
hits_apps = list(q)
log(f'Docs con cardCodeSap="{CARD_CODE}": {len(hits_apps)}')
log('')
for h in hits_apps:
    d = h.to_dict() or {}
    log(f'### docId: `{h.id}`')
    log('```')
    for k in ['cardCodeSap', 'comercio', 'fantasia', 'provincia', 'localidad',
              'assignedVendor', 'cliTipo', 'cliTamano', 'cliFidelidad',
              'manualSapPending', 'approvedAt']:
        if k in d:
            v = d[k]
            if hasattr(v, 'isoformat'):
                v = v.isoformat()
            log(f'  {k:28s}: {v}')
    log('```')
    log('')

# ---- 6. Firestore pedidos ----
log('## 6. Firestore `pedidos` (origen de Pedidos > Confirmados — NO usado por cartera)')
log('')
q = db.collection('pedidos').where('clientCardCode', '==', CARD_CODE).get()
peds = list(q)
peds_data = []
for p in peds:
    d = p.to_dict() or {}
    peds_data.append({'_id': p.id, **d})

# ordenar por confirmedAt DESC si existe
def _confirmed_at_key(p):
    v = p.get('confirmedAt') or p.get('createdAt')
    if hasattr(v, 'isoformat'):
        return v.isoformat()
    return str(v or '')

peds_data.sort(key=_confirmed_at_key, reverse=True)

log(f'Total pedidos del cliente: {len(peds_data)}')
log('')
log('| pedidoId | orderNumber | stage | createdAt | confirmedAt | cobradoAt | transferidoSAP.docNum | lines (vivas / total) | monto |')
log('|---|---|---|---|---|---|---|---:|---:|')

for p in peds_data[:15]:
    oid = p.get('orderNumber')
    stage = p.get('stage')
    created = p.get('createdAt')
    confirmed = p.get('confirmedAt')
    cobrado = p.get('cobradoAt')
    sap = p.get('transferidoSAP') or {}
    doc_num = sap.get('docNum')
    lines = p.get('lines') or []
    live_lines = sum(1 for l in lines if l and l.get('state') != 'cancelled' and l.get('state') != 'closed')
    monto = p.get('netAmountArs') or p.get('subtotalArs') or p.get('sapDocTotal') or ''

    def _fmt(v):
        if v is None:
            return ''
        if hasattr(v, 'isoformat'):
            return v.isoformat()
        return str(v)[:19]

    log(f'| {p["_id"][:14]} | {oid} | {stage} | {_fmt(created)} | {_fmt(confirmed)} | {_fmt(cobrado)} | {doc_num} | {live_lines}/{len(lines)} | {monto} |')

# Pedido de agosto 2026 explícito
log('')
log('**Pedidos con `confirmedAt` en agosto 2026** (filtro cliente-side):')
for p in peds_data:
    v = p.get('confirmedAt')
    if hasattr(v, 'isoformat'):
        s = v.isoformat()
    else:
        s = str(v or '')
    if '2026-08' in s:
        log('```')
        log(f'  pedidoId      : {p["_id"]}')
        log(f'  orderNumber   : {p.get("orderNumber")}')
        log(f'  stage         : {p.get("stage")}')
        log(f'  confirmedAt   : {s}')
        log(f'  month label   : {p.get("month")}')
        log(f'  cobradoAt     : {p.get("cobradoAt")}')
        sap = p.get('transferidoSAP') or {}
        log(f'  SAP docNum    : {sap.get("docNum")}')
        log(f'  SAP docEntry  : {sap.get("docEntry")}')
        log(f'  orderDocEntry : {sap.get("orderDocEntry")}')
        log(f'  invoiceDocNum : {sap.get("invoiceDocNum")}')
        log(f'  lineas totales: {len(p.get("lines", []))}')
        log(f'  monto ars     : {p.get("netAmountArs")}')
        log('```')
log('')

# ---- Resumen lado a lado ----
log('## 7. RESUMEN LADO A LADO')
log('')
log('| Campo | Ficha Cliente (client_master) | client_applications | BQ v_cartera_vendor | Firestore cartera_vendor snapshot | UI mostraria |')
log('|---|---|---|---|---|---|')

# TIPO
ficha_tipo = ''
for h in hits:
    d = h.to_dict() or {}
    if d.get('cliTipo'):
        ficha_tipo = d['cliTipo']
        break
apps_tipo = ''
for h in hits_apps:
    d = h.to_dict() or {}
    if d.get('cliTipo'):
        apps_tipo = d['cliTipo']
        break

# bq cartera
sql3 = f"""
SELECT cli_tipo FROM `app-vendedores-shimano.shimano_app.v_cartera_vendor`
WHERE card_code = '{CARD_CODE}'
"""
bq_tipo_rows = list(bq.query(sql3).result())
bq_tipo = bq_tipo_rows[0].cli_tipo if bq_tipo_rows else '(sin fila)'

# snapshot
snapshot_tipo = ''
if doc.exists:
    for c in (doc.to_dict() or {}).get('clientes', []):
        if c.get('cardCode') == CARD_CODE:
            snapshot_tipo = c.get('cliTipo') or ''
            break

log(f'| cliTipo | **{ficha_tipo or "(vacio)"}** | {apps_tipo or "(vacio)"} | {bq_tipo or "(vacio)"} | {snapshot_tipo or "(vacio)"} | `{snapshot_tipo or "-"}` |')

log('')
log('')
log('## 8. Notas de interpretación')
log('')
log('- La **Ficha Cliente** escribe en `client_master.cliTipo` en tiempo real.')
log('- La **BQ view** `v_cartera_vendor` lee `cliTipo` de 2 fuentes y PRIORIZA `client_applications_raw` sobre `client_master_raw` (view SQL línea 3271 priority=1 vs 3294 priority=2).')
log('- El **snapshot Firestore** `cartera_vendor/{vendor}` se regenera cada 04:00 ART desde la view BQ.')
log('- `v_cartera_vendor` depende de los dos **_raw_latest** que son sync BI (Datastream/Dataflow). Si el sync BI no corrió desde la última edición de la Ficha, el BQ ve el cliTipo **viejo**.')
log('- **ULT.COMPRA + FACT12M** salen de `v_ventas_lineas` (`doc_kind=INVOICE` solamente, SAP OINV). Un pedido en Firestore `pedidos.stage=confirmed/COBRADO COMPLETO` **sin** `transferidoSAP.docNum` + sin OINV asociada **nunca** aparece en la cartera.')
log('')

OUT_MD.write_text('\n'.join(report_lines), encoding='utf-8')
print(f'\nInforme escrito a: {OUT_MD}')
