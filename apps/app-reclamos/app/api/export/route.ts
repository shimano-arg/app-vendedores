// v1264 (2026-10-13): endpoint export CSV + xlsx con filtros.
// GET /api/export?format=csv|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD&type=...&assignee=...&status=open|closed|all
// Gate admin via is_admin() RLS en claims (si no, no vé nada).
import { NextResponse } from 'next/server';
import { CLAIM_TYPE_LABEL, type ClaimType } from '@/lib/claim-types';
import { COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = {
  id: number;
  remito: string;
  factura: string;
  cliente: string;
  fantasia: string;
  tipo: string;
  columna: string;
  responsable: string;
  creadoPor: string;
  creadoAt: string;
  ultimaActualizacion: string;
  tiempoTotalHs: number;
};

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Row[]): string {
  const headers = [
    'ID',
    'Remito',
    'Factura',
    'Cliente',
    'Fantasía',
    'Tipo',
    'Columna',
    'Responsable',
    'Creado por',
    'Creado',
    'Última actualización',
    'Tiempo total (hs)',
  ];
  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.remito,
        r.factura,
        r.cliente,
        r.fantasia,
        r.tipo,
        r.columna,
        r.responsable,
        r.creadoPor,
        r.creadoAt,
        r.ultimaActualizacion,
        r.tiempoTotalHs,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n');
}

async function toXlsx(rows: Row[]): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'APP-RECLAMOS';
  wb.created = new Date();

  // Sheet 1: Resumen
  const resumen = wb.addWorksheet('Resumen');
  resumen.addRow(['Reporte de Reclamos — Shimano']);
  resumen.getRow(1).font = { size: 16, bold: true, color: { argb: 'FF1D1D1F' } };
  resumen.addRow([`Generado: ${new Date().toLocaleString('es-AR')}`]);
  resumen.getRow(2).font = { size: 11, color: { argb: 'FF6E6E73' } };
  resumen.addRow([]);
  resumen.addRow(['Total reclamos', rows.length]);
  const abiertos = rows.filter((r) => !['Pendiente', 'Resuelto'].includes(r.columna)).length;
  resumen.addRow(['Abiertos', abiertos]);
  resumen.addRow(['Cerrados', rows.length - abiertos]);
  const promHs =
    rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.tiempoTotalHs, 0) / rows.length) : 0;
  resumen.addRow(['Promedio tiempo total (hs)', promHs]);
  resumen.getColumn(1).width = 32;
  resumen.getColumn(2).width = 16;

  // Sheet 2: Detalle
  const detalle = wb.addWorksheet('Detalle');
  const headers = [
    'ID',
    'Remito',
    'Factura',
    'Cliente',
    'Fantasía',
    'Tipo',
    'Columna',
    'Responsable',
    'Creado por',
    'Creado',
    'Última actualización',
    'Tiempo total (hs)',
  ];
  const headerRow = detalle.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0071E3' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;
  for (const r of rows) {
    detalle.addRow([
      r.id,
      r.remito,
      r.factura,
      r.cliente,
      r.fantasia,
      r.tipo,
      r.columna,
      r.responsable,
      r.creadoPor,
      r.creadoAt,
      r.ultimaActualizacion,
      r.tiempoTotalHs,
    ]);
  }
  // Widths
  const widths = [8, 16, 20, 24, 18, 22, 20, 20, 22, 20, 20, 14];
  widths.forEach((w, i) => {
    detalle.getColumn(i + 1).width = w;
  });
  detalle.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const type = searchParams.get('type');
  const assignee = searchParams.get('assignee');
  const status = searchParams.get('status') ?? 'all'; // open|closed|all

  const supabase = await createClient();
  let query = supabase
    .from('claims')
    .select(
      'id, remito_number, invoice_number, client_name, fantasy_name, claim_type, current_column, assignee_id, created_by, created_at, updated_at',
    )
    .order('created_at', { ascending: false });

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`);
  if (type) query = query.eq('claim_type', type);
  if (assignee) query = query.eq('assignee_id', assignee);
  if (status === 'open') query = query.not('current_column', 'in', '(resuelto,cerrado)');
  if (status === 'closed') query = query.in('current_column', ['resuelto', 'cerrado']);

  const { data: claims, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const list = claims ?? [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, email');
  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name || p.email || p.id]),
  );

  const now = Date.now();
  const rows: Row[] = list.map((c) => {
    const created = new Date(c.created_at).getTime();
    const updated = new Date(c.updated_at).getTime();
    const closed = ['resuelto', 'cerrado'].includes(c.current_column);
    const tiempoTotalHs = Math.round((closed ? updated - created : now - created) / 36e5);
    return {
      id: c.id,
      remito: c.remito_number,
      factura: c.invoice_number ?? '',
      cliente: c.client_name ?? '',
      fantasia: c.fantasy_name ?? '',
      tipo: c.claim_type ? (CLAIM_TYPE_LABEL[c.claim_type as ClaimType] ?? c.claim_type) : '',
      columna: COLUMN_LABEL[c.current_column as ClaimColumn] ?? c.current_column,
      responsable: profileById.get(c.assignee_id) ?? '',
      creadoPor: profileById.get(c.created_by) ?? '',
      creadoAt: new Date(c.created_at).toLocaleString('es-AR'),
      ultimaActualizacion: new Date(c.updated_at).toLocaleString('es-AR'),
      tiempoTotalHs,
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `reclamos-${today}.${format}`;

  if (format === 'csv') {
    const csv = toCsv(rows);
    // Agregar BOM para que Excel abra con UTF-8 directo.
    const body = `﻿${csv}`;
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  const xlsxBuf = await toXlsx(rows);
  return new NextResponse(xlsxBuf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
