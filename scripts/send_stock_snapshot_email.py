"""
Send Stock Snapshot Email — cron L-V 16:00 hora Argentina.

Envia a Pablo Gonzalez (gerente ventas) + Mariano un resumen del stock de
SAP al cierre del dia habil, con:
  - HTML inline: totales + top SKUs con stock + top SKUs con backorder.
  - Excel attachment (2 hojas): Resumen por familia/warehouse + Detalle
    completo (todos los SKUs con stock en whs 11).

Fuente: Firestore 'app_config/stock_snapshot' (actualizado cada 5 min por
scripts/sync_sap_to_firestore.py) + 'product_catalog/chunk_N' (categorias
mergeadas). No re-pullea SAP SL — reusa la foto ya pisada por el sync.

Snapshot historico opcional en 'stock_daily_snapshots/{YYYY-MM-DD}' con
summary agregado (no cada SKU) para computar delta vs. dias previos.

Env vars (GitHub Actions Secrets):
  FIREBASE_SERVICE_ACCOUNT   JSON SA con permisos Firestore read.
  GMAIL_APP_PASSWORD         App password de bot.shimano.pesca@gmail.com.
  MAIL_FROM                  bot.shimano.pesca@gmail.com.
  MAIL_TO                    pablo.gonzalez@shimano.com.ar
                             (coma-separado para varios).
  MAIL_CC                    (opcional) copias.
  DRY_RUN                    'true' -> escribe HTML + Excel locales, no envia.
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
from datetime import datetime
from email.message import EmailMessage
from email.utils import make_msgid
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo

import firebase_admin
from firebase_admin import credentials, firestore
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ============================================================
# Config
# ============================================================
MAIL_FROM = os.environ.get('MAIL_FROM', 'bot.shimano.pesca@gmail.com')
MAIL_TO_RAW = os.environ.get('MAIL_TO', 'pablo.gonzalez@shimano.com.ar')
MAIL_CC_RAW = os.environ.get('MAIL_CC', '')
MAIL_TO = [x.strip() for x in MAIL_TO_RAW.split(',') if x.strip()]
MAIL_CC = [x.strip() for x in MAIL_CC_RAW.split(',') if x.strip()]
GMAIL_APP_PASSWORD = os.environ.get('GMAIL_APP_PASSWORD', '')
FB_SA_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '')

TZ_AR = ZoneInfo('America/Argentina/Buenos_Aires')

# Paleta Shimano (matcheo con send_tablero_sar_email.py)
NAVY = '#1F3864'
NAVY_DARK = '#0F172A'
LIGHT_BLUE = '#D9E1F2'
SHIMANO_CYAN = '#00A9E0'
GREEN_OK = '#10b981'
ORANGE_WARN = '#f59e0b'
RED_BAD = '#dc2626'
MUTED = '#64748b'

MESES_ES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
DIAS_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

# Mismo hack de encoding que send_tablero_sar_email.py (latin-1 leido como UTF-8).
_ENCODING_REPLACEMENTS = [
    ('Ca�as', 'Cañas'), ('Ca�a', 'Caña'),
    ('Tama�o', 'Tamaño'), ('Se�uelo', 'Señuelo'),
    ('Se�or', 'Señor'), ('Acci�n', 'Acción'),
    ('visi�n', 'visión'), ('Multifunci�n', 'Multifunción'),
    ('C�digo', 'Código'), ('Jap�n', 'Japón'),
    ('Telesc�pica', 'Telescópica'), ('Se�al', 'Señal'),
    ('a�os', 'años'), ('a�o', 'año'),
    ('R�pida', 'Rápida'), ('R�pido', 'Rápido'),
    ('Pesca�', 'Pesca'), ('CA�AS', 'CAÑAS'),
    ('DISE�O', 'DISEÑO'), ('�', ''),
]


def log(msg: str) -> None:
    ts = datetime.now(TZ_AR).strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def clean_text(s) -> str:
    if s is None:
        return ''
    out = str(s)
    for old, new in _ENCODING_REPLACEMENTS:
        out = out.replace(old, new)
    return out


def fmt_int(n) -> str:
    if n is None:
        return '0'
    return '{:,.0f}'.format(round(float(n))).replace(',', '.')


# ============================================================
# Firestore
# ============================================================
def fs_client() -> firestore.Client:
    if not FB_SA_JSON:
        raise SystemExit('[ERROR] FIREBASE_SERVICE_ACCOUNT no seteada')
    sa = json.loads(FB_SA_JSON)
    cred = credentials.Certificate(sa)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def fetch_snapshot(db: firestore.Client) -> dict:
    """Lee app_config/stock_snapshot + product_catalog/chunk_N y arma el
    dataset: [{code, desc, fam, sub, cat, qty_total, whs_breakdown,
    committed_breakdown, backorder, pre_lanzamiento}, ...] solo con items
    que tienen stock disponible (whs 11 > 0).
    """
    log('[FS] leyendo app_config/stock_snapshot...')
    snap_doc = db.collection('app_config').document('stock_snapshot').get()
    if not snap_doc.exists:
        raise SystemExit('[ERROR] stock_snapshot no existe en Firestore')
    snap = snap_doc.to_dict() or {}

    quantities = json.loads(snap.get('quantities') or '{}')
    whs_breakdown = json.loads(snap.get('warehouseBreakdown') or '{}')
    whs_committed = json.loads(snap.get('warehouseCommittedBreakdown') or '{}')
    backorder = json.loads(snap.get('backorderBySku') or '{}')
    pre_lanz = json.loads(snap.get('preLanzamientoBySku') or '{}')

    updated_at = snap.get('updatedAt')
    total_items_meta = snap.get('totalItems') or 0
    with_stock_meta = snap.get('withStock') or 0
    log(f'  stock_snapshot: totalItems={total_items_meta}, withStock={with_stock_meta}')

    log('[FS] leyendo product_catalog/chunk_N...')
    catalog = {}
    for d in db.collection('product_catalog').stream():
        data = d.to_dict() or {}
        for it in data.get('items', []) or []:
            code = it.get('code')
            if not code:
                continue
            catalog[code] = {
                'desc': clean_text(it.get('desc') or ''),
                'fam': clean_text(it.get('fam') or ''),
                'sub': clean_text(it.get('sub') or ''),
                'cat': clean_text(it.get('cat') or ''),
            }
    log(f'  product_catalog: {len(catalog)} items')

    items = []
    for sku, breakdown in whs_breakdown.items():
        qty_whs11 = int(breakdown.get('11', 0) or 0)
        if qty_whs11 <= 0:
            continue
        if pre_lanz.get(sku):
            # PRE LANZAMIENTO: SAP lista stock pero la app no deja vender.
            # Lo excluimos del reporte "stock disponible" al gerente.
            continue
        meta = catalog.get(sku) or {}
        items.append({
            'code': sku,
            'desc': meta.get('desc', ''),
            'fam': meta.get('fam', ''),
            'sub': meta.get('sub', ''),
            'cat': meta.get('cat', ''),
            'qty_total': int(quantities.get(sku, 0) or 0),
            'qty_whs11': qty_whs11,
            'qty_whs12': int(breakdown.get('12', 0) or 0),
            'qty_otros': sum(int(v or 0) for k, v in breakdown.items() if k not in ('11', '12')),
            'committed_whs11': int((whs_committed.get(sku) or {}).get('11', 0) or 0),
            'backorder': int(backorder.get(sku, 0) or 0),
        })

    # Tambien agregamos items SIN stock pero CON backorder (SKUs rotos del catalogo).
    sin_stock_con_bo = []
    for sku, bo_qty in backorder.items():
        bo_qty_int = int(bo_qty or 0)
        if bo_qty_int <= 0:
            continue
        if whs_breakdown.get(sku, {}).get('11', 0):
            continue  # ya esta en items (tiene stock + backorder)
        if pre_lanz.get(sku):
            continue
        meta = catalog.get(sku) or {}
        sin_stock_con_bo.append({
            'code': sku,
            'desc': meta.get('desc', ''),
            'fam': meta.get('fam', ''),
            'sub': meta.get('sub', ''),
            'cat': meta.get('cat', ''),
            'backorder': bo_qty_int,
        })

    items.sort(key=lambda x: (-x['qty_whs11'], x['code']))
    sin_stock_con_bo.sort(key=lambda x: -x['backorder'])

    log(f'[FS] dataset: {len(items)} SKUs con stock disponible + '
        f'{len(sin_stock_con_bo)} SKUs sin stock con backorder')

    return {
        'items': items,
        'sin_stock_con_bo': sin_stock_con_bo,
        'total_skus_catalog': len(catalog),
        'total_skus_snapshot': total_items_meta,
        'updated_at': updated_at,
    }


def write_daily_snapshot(db: firestore.Client, dataset: dict) -> None:
    """Guarda summary agregado del dia en stock_daily_snapshots/{YYYY-MM-DD}
    para computar deltas en futuras ejecuciones. No guardamos cada SKU
    (seria caro) — solo totales por familia + totales globales.
    """
    hoy = datetime.now(TZ_AR)
    doc_id = hoy.strftime('%Y-%m-%d')

    por_fam = {}
    for it in dataset['items']:
        fam = it['fam'] or '(sin familia)'
        if fam not in por_fam:
            por_fam[fam] = {'skus': 0, 'unidades': 0}
        por_fam[fam]['skus'] += 1
        por_fam[fam]['unidades'] += it['qty_whs11']

    payload = {
        'date': doc_id,
        'generatedAt': firestore.SERVER_TIMESTAMP,
        'totalSkusCatalog': dataset['total_skus_catalog'],
        'totalSkusConStock': len(dataset['items']),
        'totalUnidadesWhs11': sum(it['qty_whs11'] for it in dataset['items']),
        'totalUnidadesBackorder': sum(it['backorder'] for it in dataset['items'])
                                   + sum(it['backorder'] for it in dataset['sin_stock_con_bo']),
        'skusSinStockConBackorder': len(dataset['sin_stock_con_bo']),
        'porFamilia': por_fam,
        'source': 'send_stock_snapshot_email',
    }

    if os.environ.get('DRY_RUN', '').lower() == 'true':
        log(f'[DRY_RUN] escribiria stock_daily_snapshots/{doc_id}')
        return
    db.collection('stock_daily_snapshots').document(doc_id).set(payload)
    log(f'[FS] stock_daily_snapshots/{doc_id} guardado')


# ============================================================
# Excel
# ============================================================
def build_excel(dataset: dict) -> bytes:
    log('[XLSX] generando Excel...')
    wb = Workbook()

    header_fill = PatternFill('solid', fgColor='1F3864')
    header_font = Font(bold=True, color='FFFFFF', size=10)
    thin_border = Border(
        left=Side(style='thin', color='D9E1F2'),
        right=Side(style='thin', color='D9E1F2'),
        top=Side(style='thin', color='D9E1F2'),
        bottom=Side(style='thin', color='D9E1F2'),
    )

    # ---------- Hoja 1: Resumen ----------
    ws1 = wb.active
    ws1.title = 'Resumen'

    hoy = datetime.now(TZ_AR)
    ws1['A1'] = 'STOCK SNAPSHOT SHIMANO ARGENTINA'
    ws1['A1'].font = Font(bold=True, size=14, color='0F172A')
    ws1.merge_cells('A1:E1')
    ws1['A2'] = f'{DIAS_ES[hoy.weekday()].capitalize()} {hoy.day} de {MESES_ES[hoy.month - 1]} {hoy.year} — {hoy.strftime("%H:%M")} ART'
    ws1['A2'].font = Font(italic=True, color='64748b', size=10)
    ws1.merge_cells('A2:E2')

    row = 4
    # Totales
    ws1.cell(row=row, column=1, value='Métrica').fill = header_fill
    ws1.cell(row=row, column=1).font = header_font
    ws1.cell(row=row, column=2, value='Valor').fill = header_fill
    ws1.cell(row=row, column=2).font = header_font
    row += 1
    total_un_disponibles = sum(it['qty_whs11'] for it in dataset['items'])
    total_un_committed = sum(it['committed_whs11'] for it in dataset['items'])
    total_un_backorder = sum(it['backorder'] for it in dataset['items']) \
                        + sum(it['backorder'] for it in dataset['sin_stock_con_bo'])

    metricas = [
        ('SKUs totales en catálogo', dataset['total_skus_catalog']),
        ('SKUs con stock disponible (whs 11)', len(dataset['items'])),
        ('SKUs sin stock pero con backorder', len(dataset['sin_stock_con_bo'])),
        ('Unidades disponibles (whs 11)', total_un_disponibles),
        ('Unidades comprometidas (committed whs 11)', total_un_committed),
        ('Unidades en backorder (todas las SQ abiertas)', total_un_backorder),
    ]
    for m_label, m_val in metricas:
        ws1.cell(row=row, column=1, value=m_label).font = Font(size=10)
        c = ws1.cell(row=row, column=2, value=m_val)
        c.number_format = '#,##0'
        c.font = Font(bold=True, size=11, color='1F3864')
        row += 1

    row += 2

    # Breakdown por familia
    por_fam = {}
    for it in dataset['items']:
        fam = it['fam'] or '(sin familia)'
        if fam not in por_fam:
            por_fam[fam] = {'skus': 0, 'unidades': 0, 'committed': 0, 'backorder': 0}
        por_fam[fam]['skus'] += 1
        por_fam[fam]['unidades'] += it['qty_whs11']
        por_fam[fam]['committed'] += it['committed_whs11']
        por_fam[fam]['backorder'] += it['backorder']

    ws1.cell(row=row, column=1, value='DESGLOSE POR FAMILIA').font = Font(bold=True, size=12, color='0F172A')
    row += 1
    headers_fam = ['Familia', 'SKUs con stock', 'Unidades disp.', 'Committed', 'Backorder']
    for i, h in enumerate(headers_fam, start=1):
        c = ws1.cell(row=row, column=i, value=h)
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(horizontal='center')
    row += 1
    for fam in sorted(por_fam.keys(), key=lambda f: -por_fam[f]['unidades']):
        d = por_fam[fam]
        ws1.cell(row=row, column=1, value=fam).font = Font(size=10)
        for i, k in enumerate(('skus', 'unidades', 'committed', 'backorder'), start=2):
            c = ws1.cell(row=row, column=i, value=d[k])
            c.number_format = '#,##0'
            c.font = Font(size=10)
            c.alignment = Alignment(horizontal='right')
        row += 1

    # Column widths
    for col_idx, width in enumerate([44, 18, 18, 18, 18], start=1):
        ws1.column_dimensions[get_column_letter(col_idx)].width = width

    # ---------- Hoja 2: Detalle ----------
    ws2 = wb.create_sheet('Detalle stock')
    headers_det = [
        'SKU', 'Descripción', 'Familia', 'Subfamilia', 'Categoría',
        'Disp. (whs 11)', 'Tránsito (whs 12)', 'Otros whs',
        'Committed (whs 11)', 'Backorder',
    ]
    for i, h in enumerate(headers_det, start=1):
        c = ws2.cell(row=1, column=i, value=h)
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(horizontal='center')
    for r_idx, it in enumerate(dataset['items'], start=2):
        ws2.cell(row=r_idx, column=1, value=it['code']).font = Font(name='Courier New', size=10, bold=True)
        ws2.cell(row=r_idx, column=2, value=it['desc'][:120]).font = Font(size=10)
        ws2.cell(row=r_idx, column=3, value=it['fam']).font = Font(size=10)
        ws2.cell(row=r_idx, column=4, value=it['sub']).font = Font(size=10)
        ws2.cell(row=r_idx, column=5, value=it['cat']).font = Font(size=10)
        for col_idx, key in enumerate(('qty_whs11', 'qty_whs12', 'qty_otros', 'committed_whs11', 'backorder'), start=6):
            c = ws2.cell(row=r_idx, column=col_idx, value=it[key])
            c.number_format = '#,##0'
            c.alignment = Alignment(horizontal='right')
    ws2.freeze_panes = 'A2'
    for col_idx, width in enumerate([14, 48, 20, 20, 22, 14, 14, 12, 14, 12], start=1):
        ws2.column_dimensions[get_column_letter(col_idx)].width = width

    # ---------- Hoja 3: Sin stock con backorder ----------
    if dataset['sin_stock_con_bo']:
        ws3 = wb.create_sheet('Sin stock con backorder')
        headers_bo = ['SKU', 'Descripción', 'Familia', 'Subfamilia', 'Categoría', 'Backorder']
        for i, h in enumerate(headers_bo, start=1):
            c = ws3.cell(row=1, column=i, value=h)
            c.fill = header_fill
            c.font = header_font
            c.alignment = Alignment(horizontal='center')
        for r_idx, it in enumerate(dataset['sin_stock_con_bo'], start=2):
            ws3.cell(row=r_idx, column=1, value=it['code']).font = Font(name='Courier New', size=10, bold=True)
            ws3.cell(row=r_idx, column=2, value=it['desc'][:120]).font = Font(size=10)
            ws3.cell(row=r_idx, column=3, value=it['fam']).font = Font(size=10)
            ws3.cell(row=r_idx, column=4, value=it['sub']).font = Font(size=10)
            ws3.cell(row=r_idx, column=5, value=it['cat']).font = Font(size=10)
            c = ws3.cell(row=r_idx, column=6, value=it['backorder'])
            c.number_format = '#,##0'
            c.alignment = Alignment(horizontal='right')
            c.font = Font(size=10, bold=True, color='dc2626')
        ws3.freeze_panes = 'A2'
        for col_idx, width in enumerate([14, 48, 20, 20, 22, 14], start=1):
            ws3.column_dimensions[get_column_letter(col_idx)].width = width

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    data = buf.read()
    log(f'[XLSX] generado: {len(data):,} bytes')
    return data


# ============================================================
# HTML email
# ============================================================
def render_html(dataset: dict, logo_cid: str) -> str:
    hoy = datetime.now(TZ_AR)
    fecha_str = f'{DIAS_ES[hoy.weekday()].capitalize()} {hoy.day} de {MESES_ES[hoy.month - 1]}, {hoy.year}'
    hora_str = hoy.strftime('%H:%M')

    total_skus = len(dataset['items'])
    total_un = sum(it['qty_whs11'] for it in dataset['items'])
    total_committed = sum(it['committed_whs11'] for it in dataset['items'])
    total_bo = sum(it['backorder'] for it in dataset['items']) \
             + sum(it['backorder'] for it in dataset['sin_stock_con_bo'])

    # Top 10 con mas stock
    top_stock = dataset['items'][:10]
    rows_top_stock = ''
    if top_stock:
        rows_top_stock = ''.join(
            f'''<tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#0f172a">
                <span style="font-family:monospace;font-weight:700;color:{NAVY}">{it['code']}</span>
                <div style="font-size:11px;color:#334155;margin-top:2px;line-height:1.3">{(it['desc'] or '')[:60]}</div>
                <div style="font-size:9px;color:{MUTED};margin-top:2px;text-transform:uppercase;letter-spacing:.3px">{it['fam']}</div>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:14px;font-weight:800;color:{NAVY};white-space:nowrap">{fmt_int(it['qty_whs11'])}</td>
            </tr>'''
            for it in top_stock
        )
    else:
        rows_top_stock = f'<tr><td colspan="2" style="padding:20px;text-align:center;color:{MUTED};font-size:12px">Sin SKUs con stock.</td></tr>'

    # Top 10 backorder (necesidades mas grandes)
    con_bo = [it for it in dataset['items'] if it['backorder'] > 0] + dataset['sin_stock_con_bo']
    con_bo.sort(key=lambda x: -x['backorder'])
    top_bo = con_bo[:10]
    rows_top_bo = ''
    if top_bo:
        rows_top_bo = ''.join(
            f'''<tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#0f172a">
                <span style="font-family:monospace;font-weight:700;color:{NAVY}">{it['code']}</span>
                <div style="font-size:11px;color:#334155;margin-top:2px;line-height:1.3">{(it['desc'] or '')[:60]}</div>
                <div style="font-size:9px;color:{MUTED};margin-top:2px;text-transform:uppercase;letter-spacing:.3px">{it['fam']}</div>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:14px;font-weight:800;color:{RED_BAD};white-space:nowrap">{fmt_int(it['backorder'])}</td>
            </tr>'''
            for it in top_bo
        )
    else:
        rows_top_bo = f'<tr><td colspan="2" style="padding:20px;text-align:center;color:{MUTED};font-size:12px">Sin backorder.</td></tr>'

    # Breakdown por familia (top 8 por unidades)
    por_fam = {}
    for it in dataset['items']:
        fam = it['fam'] or '(sin familia)'
        if fam not in por_fam:
            por_fam[fam] = {'skus': 0, 'unidades': 0}
        por_fam[fam]['skus'] += 1
        por_fam[fam]['unidades'] += it['qty_whs11']
    fam_sorted = sorted(por_fam.items(), key=lambda kv: -kv[1]['unidades'])[:8]
    max_un_fam = max((v['unidades'] for _, v in fam_sorted), default=1)

    rows_fam = ''
    for fam_name, fam_data in fam_sorted:
        pct_bar = (fam_data['unidades'] / max_un_fam * 100) if max_un_fam > 0 else 0
        rows_fam += f'''<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#0f172a;font-weight:600">
            {fam_name}
            <div style="height:6px;background:#f1f5f9;border-radius:3px;margin-top:4px;overflow:hidden">
              <div style="height:100%;background:linear-gradient(90deg,{SHIMANO_CYAN},{NAVY});width:{pct_bar:.1f}%"></div>
            </div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;color:{MUTED}">{fmt_int(fam_data['skus'])}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;font-weight:700;color:{NAVY};white-space:nowrap">{fmt_int(fam_data['unidades'])}</td>
        </tr>'''
    if not rows_fam:
        rows_fam = f'<tr><td colspan="3" style="padding:20px;text-align:center;color:{MUTED};font-size:12px">Sin datos por familia.</td></tr>'

    html = f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock Shimano — Snapshot {hoy.strftime("%d/%m")} 16:00 ART</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:20px 12px">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 20px rgba(15,23,42,.08)">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,{NAVY_DARK},{NAVY});padding:24px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle">
              <img src="cid:{logo_cid}" alt="Shimano" width="120" style="display:block;height:auto"/>
            </td>
            <td style="vertical-align:middle;text-align:right">
              <div style="color:{SHIMANO_CYAN};font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Stock Snapshot · Pesca</div>
              <div style="color:#fff;font-size:12px;font-weight:500">{fecha_str}</div>
              <div style="color:#94a3b8;font-size:10px;margin-top:2px">Cierre {hora_str} ART</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Titulo -->
      <tr><td style="padding:28px 28px 8px">
        <div style="font-size:11px;font-weight:700;color:{SHIMANO_CYAN};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Resumen de inventario</div>
        <h1 style="margin:0;font-size:24px;font-weight:800;color:{NAVY_DARK};line-height:1.2">Stock al cierre del {hoy.day}/{hoy.month:02d}</h1>
        <p style="margin:10px 0 0;font-size:13px;color:{MUTED};line-height:1.5">Fotografía de SAP B1 (bodega 11 — Pesca Disponible Venta). Detalle completo adjunto en Excel.</p>
      </td></tr>

      <!-- KPI hero -->
      <tr><td style="padding:20px 28px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8fafc,#e2e8f0);border-radius:10px;padding:0">
          <tr>
            <td width="50%" style="padding:20px 20px;border-right:1px solid #cbd5e1">
              <div style="font-size:10px;font-weight:800;color:{MUTED};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">SKUs con stock</div>
              <div style="font-size:26px;font-weight:900;color:{NAVY};line-height:1">{fmt_int(total_skus)}</div>
              <div style="font-size:11px;color:{MUTED};margin-top:4px">sobre {fmt_int(dataset['total_skus_catalog'])} en catálogo</div>
            </td>
            <td width="50%" style="padding:20px 20px">
              <div style="font-size:10px;font-weight:800;color:{MUTED};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">Unidades disponibles</div>
              <div style="font-size:26px;font-weight:900;color:{NAVY};line-height:1">{fmt_int(total_un)}</div>
              <div style="font-size:11px;color:{MUTED};margin-top:4px">committed: {fmt_int(total_committed)}</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Backorder warning -->
      <tr><td style="padding:14px 28px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:10px">
          <tr><td style="padding:14px 20px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:10px;font-weight:800;color:{RED_BAD};letter-spacing:1.2px;text-transform:uppercase">Backorder total</div>
                  <div style="font-size:14px;font-weight:600;color:#0f172a;margin-top:4px">unidades solicitadas y aún no entregadas en SQ abiertas</div>
                </td>
                <td style="text-align:right">
                  <div style="font-size:22px;font-weight:900;color:{RED_BAD}">{fmt_int(total_bo)}</div>
                  <div style="font-size:10px;color:{MUTED}">{len(dataset['sin_stock_con_bo'])} SKUs sin stock pero con BO</div>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Breakdown por familia -->
      <tr><td style="padding:28px 28px 0">
        <div style="font-size:11px;font-weight:800;color:{NAVY};letter-spacing:1.2px;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid {SHIMANO_CYAN};margin-bottom:12px">📦 Stock por familia (top 8)</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:{NAVY}">
              <th style="padding:10px 12px;text-align:left;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Familia</th>
              <th style="padding:10px 12px;text-align:center;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">SKUs</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Unidades</th>
            </tr>
          </thead>
          <tbody>{rows_fam}</tbody>
        </table>
      </td></tr>

      <!-- Top SKUs con mas stock -->
      <tr><td style="padding:28px 28px 0">
        <div style="font-size:11px;font-weight:800;color:{NAVY};letter-spacing:1.2px;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid {SHIMANO_CYAN};margin-bottom:12px">🏆 Top 10 SKUs con más stock disponible</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:{NAVY}">
              <th style="padding:10px 12px;text-align:left;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Producto</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Unidades</th>
            </tr>
          </thead>
          <tbody>{rows_top_stock}</tbody>
        </table>
      </td></tr>

      <!-- Top SKUs con mas backorder -->
      <tr><td style="padding:28px 28px 0">
        <div style="font-size:11px;font-weight:800;color:{RED_BAD};letter-spacing:1.2px;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid {RED_BAD};margin-bottom:12px">⚠️ Top 10 SKUs con más backorder</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fecaca;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:{RED_BAD}">
              <th style="padding:10px 12px;text-align:left;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Producto</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Faltante</th>
            </tr>
          </thead>
          <tbody>{rows_top_bo}</tbody>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:28px 28px 24px;border-top:1px solid #e5e7eb;background:#f8fafc;text-align:center">
        <div style="font-size:11px;color:#334155;line-height:1.5;margin-bottom:8px">
          <strong>Detalle completo adjunto</strong> (Excel con todos los SKUs por bodega).
        </div>
        <div style="font-size:10px;color:{MUTED};line-height:1.5">
          Snapshot automático cada día hábil a las 16:00 ART. Datos tomados del Service Layer de SAP B1 (sincronizado cada 5 min).
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>
'''
    return html


# ============================================================
# Send
# ============================================================
def send_email(html: str, excel_bytes: bytes, dataset: dict,
               logo_cid: str, logo_bytes: bytes) -> None:
    if not GMAIL_APP_PASSWORD:
        raise SystemExit('[ERROR] GMAIL_APP_PASSWORD no seteada')
    if not MAIL_TO:
        raise SystemExit('[ERROR] MAIL_TO vacío')

    hoy = datetime.now(TZ_AR)
    total_skus = len(dataset['items'])
    total_un = sum(it['qty_whs11'] for it in dataset['items'])
    subject = (f'Stock Shimano · {hoy.day}/{hoy.month:02d} 16:00 · '
               f'{fmt_int(total_skus)} SKUs / {fmt_int(total_un)} unid.')

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = MAIL_FROM
    msg['To'] = ', '.join(MAIL_TO)
    if MAIL_CC:
        msg['Cc'] = ', '.join(MAIL_CC)

    # Plain text fallback
    plain = f'''Stock Shimano Argentina — Snapshot {hoy.strftime('%d/%m/%Y %H:%M')} ART

SKUs con stock disponible (whs 11): {total_skus:,}
Unidades disponibles:               {total_un:,}
SKUs sin stock con backorder:       {len(dataset['sin_stock_con_bo']):,}

Detalle completo adjunto (Excel). Este correo se ve mejor en HTML.
'''
    msg.set_content(plain)
    msg.add_alternative(html, subtype='html')

    # Logo inline
    html_part = msg.get_payload()[-1]
    if logo_bytes:
        html_part.add_related(
            logo_bytes,
            maintype='image',
            subtype='png',
            cid=f'<{logo_cid}>',
        )

    # Excel attachment
    xlsx_name = f'stock-shimano-{hoy.strftime("%Y-%m-%d")}.xlsx'
    msg.add_attachment(
        excel_bytes,
        maintype='application',
        subtype='vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename=xlsx_name,
    )

    all_rcpts = MAIL_TO + MAIL_CC
    log(f'[SMTP] enviando a {all_rcpts}... subject={subject!r}')
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=30) as smtp:
        smtp.login(MAIL_FROM, GMAIL_APP_PASSWORD)
        smtp.send_message(msg, from_addr=MAIL_FROM, to_addrs=all_rcpts)
    log('[SMTP] OK')


# ============================================================
# Main
# ============================================================
def main() -> int:
    log('=== send_stock_snapshot_email START ===')
    db = fs_client()
    dataset = fetch_snapshot(db)

    excel_bytes = build_excel(dataset)

    # Logo opcional
    repo_root = Path(__file__).parent.parent
    logo_path = repo_root / 'Shimano-Logo.png'
    logo_bytes = logo_path.read_bytes() if logo_path.exists() else b''
    logo_cid = make_msgid(domain='shimano.local')[1:-1]

    html = render_html(dataset, logo_cid)

    if os.environ.get('DRY_RUN', '').lower() == 'true':
        out_html = repo_root / '_dryrun_stock_snapshot.html'
        out_xlsx = repo_root / '_dryrun_stock_snapshot.xlsx'
        out_html.write_text(html, encoding='utf-8')
        out_xlsx.write_bytes(excel_bytes)
        log(f'[DRY_RUN] HTML -> {out_html}')
        log(f'[DRY_RUN] XLSX -> {out_xlsx}')
        write_daily_snapshot(db, dataset)
        return 0

    send_email(html, excel_bytes, dataset, logo_cid, logo_bytes)
    write_daily_snapshot(db, dataset)
    log('=== DONE ===')
    return 0


if __name__ == '__main__':
    sys.exit(main())
