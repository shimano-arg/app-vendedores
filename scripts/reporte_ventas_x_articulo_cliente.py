"""Reporte mensual VENTAS x ARTICULO x CLIENTE/VENDEDOR (pedido Pablo).

Para cada vendedor del padron SAP, muestra en 4 hojas Excel:
  1. Vendidos            — items que vendio en el mes (1 fila por vendor×cliente×item).
  2. No vendidos         — items del master que NO vendio (1 fila por vendor×item).
  3. Clientes con compra — clientes asignados que si compraron en el mes.
  4. Clientes sin compra — clientes asignados que NO compraron.

Fuentes:
- Ventas: BQ app-vendedores-shimano.shimano_app.v_ventas_lineas (filtra mes).
- Master items: BQ app-vendedores-shimano.shimano_app.v_sap_items_enriched.
- Master clientes: Firestore client_master (padron app).
- Vendors oficiales: Firestore sap_vendors.

Uso (ADC):
  python scripts/reporte_ventas_x_articulo_cliente.py                     # mes anterior cerrado
  python scripts/reporte_ventas_x_articulo_cliente.py --year 2026 --month 9

Output: ventas_x_articulo_cliente_YYYY-MM.xlsx en el cwd.
"""
from __future__ import annotations
import argparse
import sys
from datetime import date
from pathlib import Path

from google.cloud import bigquery, firestore
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

PROJECT = 'app-vendedores-shimano'
BQ_LOC = 'southamerica-east1'
HEADER_FILL = PatternFill(start_color='1F3864', end_color='1F3864', fill_type='solid')
HEADER_FONT = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
HEADER_ALIGN = Alignment(horizontal='center', vertical='center', wrap_text=True)


def prev_month_closed(today=None):
    """Devuelve (year, month) del mes calendario cerrado inmediato anterior."""
    today = today or date.today()
    first_of_this = today.replace(day=1)
    last_of_prev = first_of_this - __import__('datetime').timedelta(days=1)
    return last_of_prev.year, last_of_prev.month


def fetch_ventas(bq, year, month):
    """Ventas del mes agrupadas por (slp_code, cardCode, itemCode).
    El nombre del vendedor se resuelve despues via sap_vendors mapping."""
    q = f"""
    SELECT
      sales_person_code AS slp_code,
      card_code,
      card_name,
      item_code,
      item_name_catalogo AS item_name,
      familia,
      subfamilia,
      SUM(cantidad) AS qty,
      ROUND(SUM(importe_linea_ars), 2) AS importe_ars,
      COUNT(DISTINCT doc_entry) AS docs
    FROM `{PROJECT}.shimano_app.v_ventas_lineas`
    WHERE anio = {year} AND mes = {month}
      AND item_code IS NOT NULL
    GROUP BY slp_code, card_code, card_name, item_code, item_name, familia, subfamilia
    ORDER BY slp_code, card_name, item_code
    """
    return list(bq.query(q))


def fetch_items_master(bq):
    """Master de items (todos los SKUs activos)."""
    q = f"""
    SELECT item_code, item_name, fam AS familia, sub AS subfamilia
    FROM `{PROJECT}.shimano_app.v_sap_items_enriched`
    WHERE item_code IS NOT NULL
      AND COALESCE(valid, 'tYES') = 'tYES'
      AND COALESCE(frozen, 'tNO') = 'tNO'
    """
    return list(bq.query(q))


def fetch_client_master(fs):
    """Padron de clientes de la app con vendor asignado + ubicacion."""
    out = []
    for d in fs.collection('client_master').stream():
        data = d.to_dict() or {}
        out.append({
            'cardCode': (data.get('sapCardCode') or '').strip(),
            'clientName': (data.get('clientName') or '').strip(),
            'vendor': (data.get('vendor') or '').strip(),
            'provincia': (data.get('provincia') or '').strip(),
            'localidad': (data.get('localidad') or '').strip(),
        })
    return out


def fetch_vendors(fs):
    """Lista oficial de vendedores desde sap_vendors."""
    out = []
    for d in fs.collection('sap_vendors').stream():
        data = d.to_dict() or {}
        key = (data.get('vendorKey') or '').strip()
        if not key:
            continue
        out.append({
            'vendorKey': key,
            'slpCode': data.get('slpCode'),
            'slpName': (data.get('slpName') or '').strip(),
            'zone': (data.get('zone') or '').strip(),
        })
    return out


def norm_vendor(name):
    return (name or '').strip().upper()


def style_header(ws, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = HEADER_ALIGN
    ws.row_dimensions[1].height = 28
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions


def autosize_cols(ws, max_width=50):
    for col in ws.columns:
        max_len = 0
        letter = get_column_letter(col[0].column)
        for cell in col:
            v = str(cell.value) if cell.value is not None else ''
            if len(v) > max_len:
                max_len = len(v)
        ws.column_dimensions[letter].width = min(max(10, max_len + 2), max_width)


def build_report(year, month, out_path):
    bq = bigquery.Client(project=PROJECT, location=BQ_LOC)
    fs = firestore.Client(project=PROJECT)

    print(f'[1/5] Fetch ventas BQ {year}-{month:02d}...', flush=True)
    ventas = fetch_ventas(bq, year, month)
    print(f'       {len(ventas)} filas de ventas (agrupadas).', flush=True)

    print('[2/5] Fetch master items BQ...', flush=True)
    items = fetch_items_master(bq)
    print(f'       {len(items)} items en el master.', flush=True)

    print('[3/5] Fetch client_master Firestore...', flush=True)
    clients = fetch_client_master(fs)
    print(f'       {len(clients)} clientes en el master.', flush=True)

    print('[4/5] Fetch sap_vendors Firestore...', flush=True)
    vendors = fetch_vendors(fs)
    print(f'       {len(vendors)} vendedores oficiales.', flush=True)

    # Set vendedores activos (normalized).
    vendor_keys = {norm_vendor(v['vendorKey']) for v in vendors if v['vendorKey']}
    # Mapping slpCode -> vendorKey (nombre) para resolver ventas.
    slp_to_vendor = {}
    for v in vendors:
        if v.get('slpCode') is not None:
            try:
                slp_to_vendor[int(v['slpCode'])] = norm_vendor(v['vendorKey'])
            except (TypeError, ValueError):
                pass

    # Indices.
    ventas_by_vendor_item = {}  # (vendor, item_code) -> True
    ventas_by_vendor_client = {}  # (vendor, card_code) -> dict acumulado
    for v in ventas:
        slp = v.slp_code
        try:
            vn = slp_to_vendor.get(int(slp)) if slp is not None else None
        except (TypeError, ValueError):
            vn = None
        if not vn:
            vn = '(sin vendedor)'
        ventas_by_vendor_item[(vn, v.item_code)] = True
        key = (vn, v.card_code)
        acc = ventas_by_vendor_client.setdefault(key, {
            'card_name': v.card_name or '', 'qty': 0.0, 'importe': 0.0, 'skus': set(), 'docs': 0,
        })
        acc['qty'] += float(v.qty or 0)
        acc['importe'] += float(v.importe_ars or 0)
        acc['skus'].add(v.item_code)
        acc['docs'] += int(v.docs or 0)

    # Clientes agrupados por vendor normalizado.
    clients_by_vendor = {}
    for c in clients:
        vn = norm_vendor(c['vendor'])
        if not vn:
            continue
        clients_by_vendor.setdefault(vn, []).append(c)

    wb = Workbook()
    wb.remove(wb.active)

    # === Hoja 1: Vendidos ===
    ws1 = wb.create_sheet('1. Vendidos')
    ws1.append([
        'VENDEDOR', 'CARD_CODE', 'CLIENTE', 'ITEM_CODE', 'ITEM', 'FAMILIA', 'SUBFAMILIA',
        'UNIDADES', 'IMPORTE_ARS', 'DOCUMENTOS',
    ])
    for v in ventas:
        try:
            vn = slp_to_vendor.get(int(v.slp_code)) if v.slp_code is not None else None
        except (TypeError, ValueError):
            vn = None
        ws1.append([
            vn or '(sin vendedor)', v.card_code or '', v.card_name or '',
            v.item_code or '', v.item_name or '', v.familia or '', v.subfamilia or '',
            float(v.qty or 0), float(v.importe_ars or 0), int(v.docs or 0),
        ])
    style_header(ws1, 10)
    autosize_cols(ws1)

    # === Hoja 2: No vendidos (vendor x item cross-join - vendidos) ===
    ws2 = wb.create_sheet('2. No vendidos')
    ws2.append(['VENDEDOR', 'ITEM_CODE', 'ITEM', 'FAMILIA', 'SUBFAMILIA'])
    for vk in sorted(vendor_keys):
        for it in items:
            if (vk, it.item_code) in ventas_by_vendor_item:
                continue
            ws2.append([vk, it.item_code or '', it.item_name or '', it.familia or '', it.subfamilia or ''])
    style_header(ws2, 5)
    autosize_cols(ws2)

    # === Hoja 3: Clientes con compra ===
    ws3 = wb.create_sheet('3. Clientes con compra')
    ws3.append([
        'VENDEDOR', 'CARD_CODE', 'CLIENTE', 'SKUs_DISTINTOS', 'UNIDADES', 'IMPORTE_ARS', 'DOCUMENTOS',
    ])
    for (vn, cc), acc in sorted(ventas_by_vendor_client.items(), key=lambda x: (x[0][0], -x[1]['importe'])):
        ws3.append([
            vn, cc or '', acc['card_name'],
            len(acc['skus']), acc['qty'], acc['importe'], acc['docs'],
        ])
    style_header(ws3, 7)
    autosize_cols(ws3)

    # === Hoja 4: Clientes sin compra ===
    ws4 = wb.create_sheet('4. Clientes sin compra')
    ws4.append(['VENDEDOR', 'CARD_CODE', 'CLIENTE', 'PROVINCIA', 'LOCALIDAD'])
    bought = {k[1] for k in ventas_by_vendor_client.keys()}  # cardCodes que compraron
    for vk in sorted(vendor_keys):
        for c in sorted(clients_by_vendor.get(vk, []), key=lambda x: x['clientName']):
            if c['cardCode'] and c['cardCode'] in bought:
                continue  # ya compro al menos a algun vendedor
            # Mas estricto: no compro a ESTE vendedor.
            if (vk, c['cardCode']) in ventas_by_vendor_client:
                continue
            ws4.append([vk, c['cardCode'], c['clientName'], c['provincia'], c['localidad']])
    style_header(ws4, 5)
    autosize_cols(ws4)

    print(f'[5/5] Escribiendo {out_path}...', flush=True)
    wb.save(out_path)
    print(f'[OK] {out_path} ({ws1.max_row - 1} vendidos / {ws2.max_row - 1} no vendidos / '
          f'{ws3.max_row - 1} clientes con compra / {ws4.max_row - 1} clientes sin compra)', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=None)
    ap.add_argument('--month', type=int, default=None)
    ap.add_argument('--out', type=str, default=None)
    args = ap.parse_args()

    if args.year and args.month:
        y, m = args.year, args.month
    else:
        y, m = prev_month_closed()

    out = args.out or f'ventas_x_articulo_cliente_{y}-{m:02d}.xlsx'
    out_path = Path(out).resolve()
    build_report(y, m, out_path)


if __name__ == '__main__':
    sys.exit(main() or 0)
