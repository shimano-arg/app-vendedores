// v1266 (2026-10-13): cron endpoint que manda email diario con reclamos stuck.
// Trigger: GitHub Actions scheduled workflow con auth bearer CRON_SECRET.
// Lógica: 1 email por assignee con sus reclamos sin movimiento > 72hs.
// Admins reciben también resumen de los que no están asignados a nadie.

import { NextResponse } from 'next/server';
import { COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';
import { sendEmail } from '@/lib/email/smtp';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const STUCK_HOURS = 72;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app-reclamos-shimano.vercel.app';

function auth(req: Request): boolean {
  const header = req.headers.get('authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const expected = process.env.CRON_SECRET ?? '';
  return expected.length > 0 && token === expected;
}

function stuckRowHtml(claim: {
  id: number;
  remito_number: string;
  client_name: string | null;
  current_column: string;
  updated_at: string;
}): string {
  const hours = Math.floor((Date.now() - new Date(claim.updated_at).getTime()) / 36e5);
  const days = Math.floor(hours / 24);
  const ago = days > 0 ? `${days}d` : `${hours}h`;
  const col = COLUMN_LABEL[claim.current_column as ClaimColumn] ?? claim.current_column;
  return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#C7301B;font-weight:600">${ago}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><a href="${APP_URL}/board?claim=${claim.id}" style="color:#0071E3;text-decoration:none">${claim.remito_number}</a></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#444">${claim.client_name ?? ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666">${col}</td>
    </tr>
  `;
}

function emailBody(stuck: Array<{
  id: number;
  remito_number: string;
  client_name: string | null;
  current_column: string;
  updated_at: string;
}>, title: string): string {
  return `
    <!doctype html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1D1D1F;background:#F5F5F7;margin:0;padding:24px">
      <div style="max-width:640px;margin:0 auto;background:#FFF;border-radius:14px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        <h1 style="margin:0 0 8px;font-size:20px;letter-spacing:-0.02em">⚠ ${title}</h1>
        <p style="color:#6E6E73;font-size:13px;margin:0 0 20px">Reclamos sin movimiento hace más de ${STUCK_HOURS} horas.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#F5F5F7">
              <th style="text-align:left;padding:10px 12px;color:#6E6E73;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.4px">Antigüedad</th>
              <th style="text-align:left;padding:10px 12px;color:#6E6E73;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.4px">Remito</th>
              <th style="text-align:left;padding:10px 12px;color:#6E6E73;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.4px">Cliente</th>
              <th style="text-align:left;padding:10px 12px;color:#6E6E73;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.4px">Columna</th>
            </tr>
          </thead>
          <tbody>${stuck.map(stuckRowHtml).join('')}</tbody>
        </table>
        <p style="color:#86868B;font-size:11px;margin-top:24px;line-height:1.5">
          Email automático de APP-RECLAMOS Shimano. <a href="${APP_URL}/board" style="color:#0071E3">Ir al board</a>.
        </p>
      </div>
    </body>
    </html>
  `;
}

export async function POST(req: Request) {
  if (!auth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const since = new Date(Date.now() - STUCK_HOURS * 3600 * 1000).toISOString();

  const { data: claims, error } = await supabase
    .from('claims')
    .select('id, remito_number, client_name, current_column, updated_at, assignee_id')
    .not('current_column', 'in', '(resuelto,cerrado)')
    .lte('updated_at', since);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stuck = claims ?? [];
  if (stuck.length === 0) return NextResponse.json({ ok: true, sent: 0, note: 'no stuck claims' });

  // Group by assignee.
  const byAssignee = new Map<string, typeof stuck>();
  for (const c of stuck) {
    const list = byAssignee.get(c.assignee_id) ?? [];
    list.push(c);
    byAssignee.set(c.assignee_id, list);
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, display_name, role')
    .eq('active', true);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const admins = (profiles ?? []).filter((p) => p.role === 'admin');

  let sent = 0;
  let failed = 0;

  for (const [assigneeId, list] of byAssignee) {
    const p = profileById.get(assigneeId);
    if (!p || !p.email) continue;
    const name = p.display_name?.split(' ')[0] ?? 'equipo';
    const res = await sendEmail({
      to: p.email,
      subject: `[Reclamos] ${list.length} ${list.length === 1 ? 'reclamo' : 'reclamos'} stuck (${name})`,
      html: emailBody(list, `${list.length} ${list.length === 1 ? 'reclamo stuck' : 'reclamos stuck'}`),
    });
    if (res.ok) sent++;
    else failed++;
  }

  // Admin digest: todos los stuck.
  for (const admin of admins) {
    const res = await sendEmail({
      to: admin.email,
      subject: `[Reclamos] Resumen admin: ${stuck.length} stuck en total`,
      html: emailBody(stuck, `Resumen admin: ${stuck.length} reclamos stuck`),
    });
    if (res.ok) sent++;
    else failed++;
  }

  return NextResponse.json({ ok: true, totalStuck: stuck.length, sent, failed });
}
