"""
Recupera pedidos borrados de Firestore buscando en BigQuery changelog.

La extension firestore-bigquery-export mantiene `pedidos_raw_raw_changelog` con
TODOS los eventos (CREATE/UPDATE/DELETE). Cuando se borra un doc Firestore,
la row DELETE tiene el `data` completo del pedido como estaba antes.

Uso:
  Env SEARCH='GOITIA'  → busca docs cuyo clientName contenga 'GOITIA'
  Env DATE_FROM='2026-10-07'  → desde esta fecha (default: hoy)

Output:
  recovered_pedidos.xlsx con 1 hoja por pedido recuperado + 1 hoja Resumen.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

try:
    from google.cloud import bigquery
    from google.oauth2 import service_account
except ImportError:
    print('[ERROR] pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(2)

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:
    print('[ERROR] pip install openpyxl', file=sys.stderr)
    sys.exit(2)


BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'

SEARCH = os.environ.get('SEARCH', '').strip()
DATE_FROM = os.environ.get('DATE_FROM', date.today().isoformat())
FB_SA_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '')
OUTPUT_PATH = os.environ.get('OUTPUT_PATH', 'recovered_pedidos.xlsx')


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def bq_client():
    if not FB_SA_JSON:
        raise SystemExit('[ERROR] FIREBASE_SERVICE_ACCOUNT no seteada')
    sa = json.loads(FB_SA_JSON)
    creds = service_account.Credentials.from_service_account_info(sa)
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


def fetch_deleted(client):
    """Trae DELETEs recientes del changelog que matcheen SEARCH."""
    if not SEARCH:
        raise SystemExit('[ERROR] SEARCH no seteada (ej SEARCH="GOITIA")')
    q = f"""
        SELECT
          timestamp,
          event_id,
          document_name,
          operation,
          data
        FROM `{BQ_PROJECT}.{BQ_DATASET}.pedidos_raw_raw_changelog`
        WHERE DATE(timestamp) >= @date_from
          AND REGEXP_CONTAINS(data, @pattern)
        ORDER BY timestamp DESC
        LIMIT 100
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter('date_from', 'DATE', DATE_FROM),
            bigquery.ScalarQueryParameter('pattern', 'STRING', f'(?i){SEARCH}'),
        ],
    )
    log(f'[BQ] query changelog desde {DATE_FROM} filtrando por "{SEARCH}"...')
    rows = list(client.query(q, job_config=job_config).result())
    log(f'[BQ] {len(rows)} eventos matcheados')
    return rows


def parse_data(data_str):
    """Convierte el campo data (JSON string) a dict. Si falla, devuelve raw."""
    if not data_str:
        return None
    try:
        return json.loads(data_str)
    except Exception:
        return data_str


def fmt_ars(n):
    if n is None:
        return '$0'
    try:
        return '$' + '{:,.0f}'.format(float(n)).replace(',', '.')
    except Exception:
        return str(n)


def write_excel(events):
    log('[XLSX] generando Excel...')
    wb = Workbook()

    navy_fill = PatternFill('solid', fgColor='1F3864')
    header_font = Font(bold=True, color='FFFFFF', size=10)
    bold_font = Font(bold=True, size=11)

    # ========== Hoja Resumen ==========
    ws = wb.active
    ws.title = 'Resumen'
    ws['A1'] = 'RECUPERACION PEDIDOS BORRADOS'
    ws['A1'].font = Font(bold=True, size=14, color='0F172A')
    ws.merge_cells('A1:F1')
    ws['A2'] = f'Busqueda: "{SEARCH}" | Desde: {DATE_FROM} | Generado: {datetime.now().strftime("%d/%m/%Y %H:%M")}'
    ws['A2'].font = Font(italic=True, color='64748b', size=10)
    ws.merge_cells('A2:F2')

    headers = ['Timestamp', 'Operation', 'Cliente', 'OrderNumber', 'Stage', 'DocumentName']
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=4, column=i, value=h)
        c.fill = navy_fill
        c.font = header_font
        c.alignment = Alignment(horizontal='center')

    recovered = []
    for i, ev in enumerate(events, start=5):
        data = parse_data(ev['data']) or {}
        if not isinstance(data, dict):
            data = {}
        ws.cell(row=i, column=1, value=str(ev['timestamp']))
        ws.cell(row=i, column=2, value=str(ev['operation']))
        ws.cell(row=i, column=3, value=str(data.get('clientName', '')))
        ws.cell(row=i, column=4, value=str(data.get('orderNumber', '')))
        ws.cell(row=i, column=5, value=str(data.get('stage', '')))
        ws.cell(row=i, column=6, value=str(ev['document_name']))
        # Si es DELETE o IMPORT, marcar en rojo
        if str(ev['operation']).upper() in ('DELETE',):
            for col in range(1, 7):
                ws.cell(row=i, column=col).font = Font(color='dc2626', bold=True)
            recovered.append((ev, data))

    for col_idx, width in enumerate([22, 10, 32, 12, 14, 50], start=1):
        ws.column_dimensions[get_column_letter(col_idx)].width = width
    ws.freeze_panes = 'A5'

    # ========== 1 hoja por pedido borrado (DELETE) ==========
    for idx, (ev, data) in enumerate(recovered, start=1):
        if not isinstance(data, dict) or not data:
            continue
        # Nombre de hoja: cliente + orderNumber truncado
        cliente = str(data.get('clientName', 'unknown'))[:20].replace('/', '_').replace('\\', '_')
        order = str(data.get('orderNumber', ''))[:8]
        sheet_name = f'{idx}_{cliente}_{order}'[:31]  # Excel limita 31 chars
        wsh = wb.create_sheet(sheet_name)

        # Header del pedido
        wsh['A1'] = f'PEDIDO BORRADO — {data.get("clientName", "")} — ORDEN {data.get("orderNumber", "")}'
        wsh['A1'].font = Font(bold=True, size=12, color='dc2626')
        wsh.merge_cells('A1:F1')
        wsh['A2'] = f'Borrado el: {ev["timestamp"]} | Document: {ev["document_name"]}'
        wsh['A2'].font = Font(italic=True, color='64748b', size=9)
        wsh.merge_cells('A2:F2')

        row = 4
        # Metadatos del pedido (header fields)
        wsh.cell(row=row, column=1, value='Campo').fill = navy_fill
        wsh.cell(row=row, column=1).font = header_font
        wsh.cell(row=row, column=2, value='Valor').fill = navy_fill
        wsh.cell(row=row, column=2).font = header_font
        row += 1

        header_fields = [
            ('_fsId (document ID)', ev['document_name'].split('/')[-1] if ev['document_name'] else ''),
            ('clientName', data.get('clientName', '')),
            ('clientCardCode', data.get('clientCardCode', '')),
            ('clientProvince / province', data.get('clientProvince') or data.get('province', '')),
            ('clientLocality / locName', data.get('clientLocality') or data.get('locName', '')),
            ('tipo', data.get('tipo', '')),
            ('key', data.get('key', '')),
            ('stage', data.get('stage', '')),
            ('month', data.get('month', '')),
            ('monthIdx', data.get('monthIdx', '')),
            ('year', data.get('year', '')),
            ('orderNumber', data.get('orderNumber', '')),
            ('ownerUid', data.get('ownerUid', '')),
            ('ownerEmail', data.get('ownerEmail', '')),
            ('ownerVendor', data.get('ownerVendor', '')),
            ('vendorAssigned', data.get('vendorAssigned', '')),
            ('createdByUid', data.get('createdByUid', '')),
            ('createdByEmail', data.get('createdByEmail', '')),
            ('onBehalfOf', data.get('onBehalfOf', '')),
            ('createdAt', data.get('createdAt', '')),
            ('confirmedAt', data.get('confirmedAt', '')),
            ('finalizedAt', data.get('finalizedAt', '')),
            ('closedAt', data.get('closedAt', '')),
            ('deliveryMethod', data.get('deliveryMethod', '')),
            ('deliveryDetails', json.dumps(data.get('deliveryDetails', {}), ensure_ascii=False)[:500]),
            ('condicionPago / formaPago', data.get('condicionPago') or data.get('formaPago', '')),
            ('transferidoSAP', json.dumps(data.get('transferidoSAP', {}), ensure_ascii=False)[:500]),
            ('transferError', json.dumps(data.get('transferError', {}), ensure_ascii=False)[:500]),
            ('sendingSapLock', json.dumps(data.get('sendingSapLock', {}), ensure_ascii=False)[:300]),
        ]
        for field, value in header_fields:
            wsh.cell(row=row, column=1, value=field).font = bold_font
            wsh.cell(row=row, column=2, value=str(value) if value is not None else '')
            row += 1

        row += 2

        # Lineas del pedido
        lines = data.get('lines') or []
        if lines:
            wsh.cell(row=row, column=1, value='LINEAS DEL PEDIDO').font = Font(bold=True, size=12, color='0F172A')
            row += 1
            line_headers = [
                'SKU', 'Descripcion', 'Cat', 'Fam', 'Sub', 'State', 'Qty',
                'QtyOpen', 'QtyInvoiced', 'QtyCancelled', 'Precio', 'Subtotal',
                'asigReserva', 'asigAt', 'asigCliTipo', 'manualBackorder',
                'targetMonth', 'targetMonthIdx', 'targetYear',
            ]
            for i, h in enumerate(line_headers, start=1):
                c = wsh.cell(row=row, column=i, value=h)
                c.fill = navy_fill
                c.font = header_font
                c.alignment = Alignment(horizontal='center')
            row += 1

            total_qty = 0
            total_ars = 0.0
            for ln in lines:
                if not isinstance(ln, dict):
                    continue
                qty = float(ln.get('qty') or 0)
                precio = float(ln.get('precio') or 0)
                subtotal = qty * precio
                total_qty += qty
                total_ars += subtotal
                wsh.cell(row=row, column=1, value=str(ln.get('code', '')))
                wsh.cell(row=row, column=2, value=str(ln.get('desc', ''))[:80])
                wsh.cell(row=row, column=3, value=str(ln.get('cat', '')))
                wsh.cell(row=row, column=4, value=str(ln.get('fam', '')))
                wsh.cell(row=row, column=5, value=str(ln.get('sub', '')))
                wsh.cell(row=row, column=6, value=str(ln.get('state', '')))
                wsh.cell(row=row, column=7, value=qty)
                wsh.cell(row=row, column=8, value=float(ln.get('qtyOpen') or 0))
                wsh.cell(row=row, column=9, value=float(ln.get('qtyInvoiced') or 0))
                wsh.cell(row=row, column=10, value=float(ln.get('qtyCancelled') or 0))
                wsh.cell(row=row, column=11, value=precio)
                wsh.cell(row=row, column=12, value=subtotal)
                wsh.cell(row=row, column=13, value=str(ln.get('asigReserva', '')))
                wsh.cell(row=row, column=14, value=str(ln.get('asigAt', '')))
                wsh.cell(row=row, column=15, value=str(ln.get('asigCliTipo', '')))
                wsh.cell(row=row, column=16, value=str(ln.get('manualBackorder', '')))
                wsh.cell(row=row, column=17, value=str(ln.get('targetMonth', '')))
                wsh.cell(row=row, column=18, value=str(ln.get('targetMonthIdx', '')))
                wsh.cell(row=row, column=19, value=str(ln.get('targetYear', '')))
                for col in (7, 8, 9, 10, 11, 12):
                    wsh.cell(row=row, column=col).number_format = '#,##0.00'
                row += 1

            # Totales
            row += 1
            wsh.cell(row=row, column=6, value='TOTALES').font = bold_font
            c = wsh.cell(row=row, column=7, value=total_qty)
            c.font = bold_font
            c.number_format = '#,##0'
            c = wsh.cell(row=row, column=12, value=total_ars)
            c.font = bold_font
            c.number_format = '#,##0.00'

        # Dump completo JSON como fallback
        row += 3
        wsh.cell(row=row, column=1, value='JSON COMPLETO (fallback)').font = Font(bold=True, size=10, color='64748b')
        row += 1
        full_json = json.dumps(data, ensure_ascii=False, indent=2)
        # Pegar en chunks de 500 chars por cell (Excel limit 32767 por cell)
        wsh.cell(row=row, column=1, value=full_json[:30000])

        # Widths razonables
        widths = [16, 48, 14, 14, 14, 12, 10, 10, 12, 12, 12, 14, 12, 20, 16, 14, 14, 14, 10]
        for col_idx, w in enumerate(widths, start=1):
            wsh.column_dimensions[get_column_letter(col_idx)].width = w
        wsh.freeze_panes = 'A5'

    out = Path(OUTPUT_PATH)
    wb.save(out)
    log(f'[XLSX] escrito a {out} ({out.stat().st_size:,} bytes)')
    log(f'[XLSX] eventos totales: {len(events)} | DELETEs recuperados: {len(recovered)}')
    return len(recovered)


def main():
    log(f'=== recover_deleted_pedido_from_bq START ===')
    log(f'  SEARCH: "{SEARCH}"')
    log(f'  DATE_FROM: {DATE_FROM}')
    client = bq_client()
    events = fetch_deleted(client)
    if not events:
        log('[DONE] Sin eventos matcheados. Nada que recuperar.')
        return 0
    n = write_excel(events)
    if n == 0:
        log('[WARN] Encontre eventos pero ninguno es DELETE. Revisa el Resumen del Excel igual.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
