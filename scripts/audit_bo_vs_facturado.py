"""Audit BO vs Facturado: detecta backorders que ya se facturaron al cliente
y quedaron 'inflados' sin descontar.

Hipotesis Mariano: 'MARIANOPESCA tiene backorder de 6 unidades pero se le
facturaron 5 unidades entonces el backorder quedo en 6 (inflado)'.

Inputs:
  - BACKORDER.csv: SKU, Cliente, Disponible, Transito, Backorder, En Camino
  - FACTURADO SEPTIEMBRE + OCTUBRE.csv: Ano, Mes, card_name, item_code, Cantidad, Importe

Logica:
  Para cada BO (cliente+sku), buscar facturado del mismo cliente+sku en sep+oct.
  Si facturado >= BO: 'YA FACTURADO (sospecha fuerte)'
  Si 0 < facturado < BO: 'PARCIAL (sospecha moderada)'
  Si facturado == 0: 'SIN FACTURAR (OK)'

Output: Excel con 3 pestanias (ya_facturado, parcial, sin_facturar) + summary.

Uso:
    python scripts/audit_bo_vs_facturado.py
"""
from __future__ import annotations
import csv
from pathlib import Path
from collections import defaultdict

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
except ImportError:
    raise SystemExit('[ERROR] pip install openpyxl')

DESKTOP = Path(r'C:\Users\shimano.sandbox\Desktop')
BO_CSV = DESKTOP / 'BACKORDER.csv'
FACT_CSV = DESKTOP / 'FACTURADO SEPTIEMBRE + OCTUBRE.csv'
OUT_XLSX = DESKTOP / 'AUDIT_BO_vs_FACTURADO.xlsx'


def _norm_cli(s):
    return (s or '').strip().upper()


def _norm_sku(s):
    return (s or '').strip().upper()


def _parse_int(s):
    try:
        return int(str(s).replace(',', '.').split('.')[0])
    except Exception:
        return 0


def _parse_importe(s):
    if not s:
        return 0.0
    txt = str(s).replace('$', '').replace(' ', '').replace('.', '').replace(',', '.')
    try:
        return float(txt)
    except Exception:
        return 0.0


def load_bo(path):
    rows = []
    with open(path, encoding='utf-8-sig', newline='') as f:
        rdr = csv.DictReader(f)
        for r in rdr:
            sku = _norm_sku(r.get('SKU'))
            cli = _norm_cli(r.get('Cliente'))
            bo = _parse_int(r.get('Backorder ') or r.get('Backorder'))
            if not sku or not cli or bo <= 0:
                continue
            rows.append({
                'sku': sku,
                'cliente': cli,
                'disponible': _parse_int(r.get('Disponible')),
                'transito': _parse_int(r.get('Tránsito')),
                'backorder': bo,
                'en_camino': (r.get('En Camino') or '').strip(),
            })
    return rows


def load_facturado(path):
    # mapa (cliente, sku) -> {total_qty, total_importe, meses: [{mes, qty}]}
    agg = defaultdict(lambda: {'qty': 0, 'importe': 0.0, 'detalle': []})
    with open(path, encoding='utf-8-sig', newline='') as f:
        rdr = csv.DictReader(f)
        for r in rdr:
            cli = _norm_cli(r.get('card_name'))
            sku = _norm_sku(r.get('item_code'))
            qty = _parse_int(r.get('Cantidad'))
            imp = _parse_importe(r.get('Importe'))
            mes = (r.get('Mes ') or r.get('Mes') or '').strip()
            if not cli or not sku:
                continue
            k = (cli, sku)
            agg[k]['qty'] += qty
            agg[k]['importe'] += imp
            agg[k]['detalle'].append(f'{mes}: {qty}u')
    return agg


def main():
    print('=== audit_bo_vs_facturado START ===')
    print(f'  BO CSV: {BO_CSV}')
    print(f'  FACT CSV: {FACT_CSV}')
    print(f'  OUT: {OUT_XLSX}')

    bo_rows = load_bo(BO_CSV)
    print(f'  BO lineas (con backorder > 0): {len(bo_rows)}')

    fact_agg = load_facturado(FACT_CSV)
    print(f'  Facturado keys (cliente+sku unicos): {len(fact_agg)}')

    ya_facturado = []
    parcial = []
    sin_facturar = []
    for bo in bo_rows:
        k = (bo['cliente'], bo['sku'])
        fact = fact_agg.get(k, {'qty': 0, 'importe': 0.0, 'detalle': []})
        bo_qty = bo['backorder']
        fact_qty = fact['qty']
        row = {
            'sku': bo['sku'],
            'cliente': bo['cliente'],
            'bo_qty': bo_qty,
            'disponible': bo['disponible'],
            'transito': bo['transito'],
            'facturado_total': fact_qty,
            'facturado_importe': fact['importe'],
            'facturado_detalle': ' | '.join(fact['detalle']),
            'exceso_sobre_bo': max(0, fact_qty - bo_qty),
            'falta_facturar': max(0, bo_qty - fact_qty),
        }
        if fact_qty >= bo_qty and bo_qty > 0:
            row['sospecha'] = 'YA FACTURADO (fuerte) --- cancelar BO sugerido'
            ya_facturado.append(row)
        elif fact_qty > 0:
            row['sospecha'] = 'PARCIAL (moderada) --- revisar si lo que falta es real'
            parcial.append(row)
        else:
            row['sospecha'] = 'SIN FACTURAR (OK)'
            sin_facturar.append(row)

    # Resumen
    total_bo_unidades = sum(r['backorder'] for r in bo_rows)
    unidades_ya_fact = sum(r['bo_qty'] for r in ya_facturado)
    unidades_parcial_pisado = sum(r['facturado_total'] for r in parcial)
    print(f'')
    print(f'  BO total lineas:   {len(bo_rows)} ({total_bo_unidades} u)')
    print(f'  YA FACTURADO:      {len(ya_facturado)} lineas ({unidades_ya_fact} u BO sospechosas de ser basura)')
    print(f'  PARCIAL:           {len(parcial)} lineas ({unidades_parcial_pisado} u facturadas pisadas con BO)')
    print(f'  SIN FACTURAR OK:   {len(sin_facturar)} lineas')

    # Excel output
    wb = Workbook()
    ws = wb.active
    ws.title = 'YA_FACTURADO'
    headers = [
        'SKU', 'Cliente', 'BO qty', 'Facturado total',
        'Importe facturado', 'Exceso sobre BO', 'Detalle facturado', 'Sospecha',
    ]
    red_hdr = PatternFill(start_color='991B1B', end_color='991B1B', fill_type='solid')
    orange_hdr = PatternFill(start_color='D97706', end_color='D97706', fill_type='solid')
    green_hdr = PatternFill(start_color='15803D', end_color='15803D', fill_type='solid')
    white_bold = Font(bold=True, color='FFFFFF')

    def _write_sheet(ws_, rows, hdr_fill):
        for col, h in enumerate(headers, 1):
            c = ws_.cell(row=1, column=col, value=h)
            c.font = white_bold
            c.fill = hdr_fill
            c.alignment = Alignment(horizontal='center', vertical='center')
        rows_sorted = sorted(rows, key=lambda r: -r.get('bo_qty', 0))
        for i, r in enumerate(rows_sorted, 2):
            ws_.cell(row=i, column=1, value=r['sku'])
            ws_.cell(row=i, column=2, value=r['cliente'])
            ws_.cell(row=i, column=3, value=r['bo_qty'])
            ws_.cell(row=i, column=4, value=r['facturado_total'])
            ws_.cell(row=i, column=5, value=round(r['facturado_importe'], 2))
            ws_.cell(row=i, column=6, value=r['exceso_sobre_bo'])
            ws_.cell(row=i, column=7, value=r['facturado_detalle'])
            ws_.cell(row=i, column=8, value=r['sospecha'])
        # Autofit basico
        for col_idx, w in enumerate([18, 42, 10, 14, 16, 15, 55, 48], 1):
            ws_.column_dimensions[chr(64 + col_idx)].width = w

    _write_sheet(ws, ya_facturado, red_hdr)
    ws2 = wb.create_sheet('PARCIAL')
    _write_sheet(ws2, parcial, orange_hdr)
    ws3 = wb.create_sheet('SIN_FACTURAR')
    _write_sheet(ws3, sin_facturar, green_hdr)

    # Summary sheet
    wss = wb.create_sheet('RESUMEN', 0)
    wss['A1'] = 'Auditoria BO vs Facturado'
    wss['A1'].font = Font(bold=True, size=16)
    wss['A3'] = 'Metrica'
    wss['B3'] = 'Lineas'
    wss['C3'] = 'Unidades BO'
    wss['A3'].font = Font(bold=True)
    wss['B3'].font = Font(bold=True)
    wss['C3'].font = Font(bold=True)
    rows_sum = [
        ('BO total', len(bo_rows), total_bo_unidades),
        ('YA FACTURADO (cancelar)', len(ya_facturado), unidades_ya_fact),
        ('PARCIAL (revisar)', len(parcial), sum(r['bo_qty'] for r in parcial)),
        ('SIN FACTURAR (OK)', len(sin_facturar), sum(r['bo_qty'] for r in sin_facturar)),
    ]
    for i, (lbl, nrows, nu) in enumerate(rows_sum, 4):
        wss.cell(row=i, column=1, value=lbl)
        wss.cell(row=i, column=2, value=nrows)
        wss.cell(row=i, column=3, value=nu)
    wss.column_dimensions['A'].width = 32
    wss.column_dimensions['B'].width = 12
    wss.column_dimensions['C'].width = 15
    wss['A10'] = 'Interpretacion'
    wss['A10'].font = Font(bold=True)
    wss['A11'] = '* YA FACTURADO = BO quedo "sucio". Cliente ya recibio todas las unidades. Candidato a cancelar BO.'
    wss['A12'] = '* PARCIAL = algunas unidades facturadas (quizas de otro pedido). Revisar manual si lo que falta es real.'
    wss['A13'] = '* SIN FACTURAR = no hubo factura en sep+oct para ese cliente+sku. BO legitimamente pendiente.'

    wb.save(OUT_XLSX)
    print(f'')
    print(f'  Excel escrito: {OUT_XLSX}')
    print('=== DONE ===')


if __name__ == '__main__':
    main()
