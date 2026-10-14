// v1266 (2026-10-13): weekly digest lunes 9am ART. KPIs semana + top stuck
// + link al dashboard. Enviado a admins.

import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/smtp';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app-reclamos-shimano.vercel.app';

function auth(req: Request): boolean {
  const header = req.headers.get('authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  const expected = process.env.CRON_SECRET ?? '';
  return expected.length > 0 && token === expected;
}

export async function POST(req: Request) {
  if (!auth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const weekAgoIso = weekAgo.toISOString();

  const { data: allClaims } = await supabase
    .from('claims')
    .select('id, current_column, created_at, updated_at')
    .limit(10000);
  const claims = allClaims ?? [];

  const abiertos = claims.filter(
    (c) => !['resuelto', 'cerrado'].includes(c.current_column),
  ).length;
  const nuevosSemana = claims.filter((c) => c.created_at >= weekAgoIso).length;
  const resueltosSemana = claims.filter(
    (c) => c.current_column === 'cerrado' && c.updated_at >= weekAgoIso,
  ).length;

  // Top 5 stuck (más antiguos abiertos).
  const stuck = claims
    .filter((c) => !['resuelto', 'cerrado'].includes(c.current_column))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(0, 5);
  const stuckInfo = await supabase
    .from('claims')
    .select('id, remito_number, client_name, updated_at')
    .in('id', stuck.map((s) => s.id));

  const { data: profiles } = await supabase
    .from('profiles')
    .select('email, role, display_name')
    .eq('active', true)
    .eq('role', 'admin');
  const admins = profiles ?? [];

  const trendIcon = resueltosSemana >= nuevosSemana ? '🟢' : '🟡';

  const html = `
    <!doctype html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1D1D1F;background:#F5F5F7;margin:0;padding:24px">
      <div style="max-width:640px;margin:0 auto;background:#FFF;border-radius:14px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        <p style="color:#6E6E73;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;margin:0 0 4px;font-weight:600">Weekly digest</p>
        <h1 style="margin:0 0 20px;font-size:22px;letter-spacing:-0.02em">${trendIcon} Resumen semanal de reclamos</h1>

        <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
          <div style="flex:1;min-width:140px;background:#F5F5F7;border-radius:10px;padding:14px">
            <p style="margin:0;color:#6E6E73;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600">Abiertos ahora</p>
            <p style="margin:4px 0 0;font-size:28px;font-weight:600;letter-spacing:-0.02em">${abiertos}</p>
          </div>
          <div style="flex:1;min-width:140px;background:#F5F5F7;border-radius:10px;padding:14px">
            <p style="margin:0;color:#6E6E73;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600">Nuevos semana</p>
            <p style="margin:4px 0 0;font-size:28px;font-weight:600;letter-spacing:-0.02em">${nuevosSemana}</p>
          </div>
          <div style="flex:1;min-width:140px;background:#F5F5F7;border-radius:10px;padding:14px">
            <p style="margin:0;color:#6E6E73;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600">Resueltos semana</p>
            <p style="margin:4px 0 0;font-size:28px;font-weight:600;letter-spacing:-0.02em">${resueltosSemana}</p>
          </div>
        </div>

        ${
          stuckInfo.data && stuckInfo.data.length > 0
            ? `
          <h2 style="font-size:14px;margin:0 0 8px;color:#8B1D14">⚠ Top 5 más antiguos abiertos</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
            ${stuckInfo.data
              .map((c) => {
                const hours = Math.floor(
                  (Date.now() - new Date(c.updated_at).getTime()) / 36e5,
                );
                const days = Math.floor(hours / 24);
                const ago = days > 0 ? `${days}d` : `${hours}h`;
                return `
                  <tr>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#C7301B;font-weight:600;width:50px">${ago}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee"><a href="${APP_URL}/board?claim=${c.id}" style="color:#0071E3;text-decoration:none">${c.remito_number}</a></td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#444">${c.client_name ?? ''}</td>
                  </tr>
                `;
              })
              .join('')}
          </table>
        `
            : ''
        }

        <div style="margin-top:24px;text-align:center">
          <a href="${APP_URL}/dashboard" style="display:inline-block;background:#0071E3;color:#FFF;padding:10px 18px;border-radius:999px;text-decoration:none;font-size:13px;font-weight:500">Abrir dashboard</a>
        </div>

        <p style="color:#86868B;font-size:11px;margin-top:28px;text-align:center">
          Email automático de APP-RECLAMOS Shimano · lunes 9:00 ART
        </p>
      </div>
    </body>
    </html>
  `;

  let sent = 0;
  let failed = 0;
  for (const admin of admins) {
    const res = await sendEmail({
      to: admin.email,
      subject: `[Reclamos] Weekly digest · ${nuevosSemana}↑ / ${resueltosSemana}↓ semana`,
      html,
    });
    if (res.ok) sent++;
    else failed++;
  }

  return NextResponse.json({ ok: true, abiertos, nuevosSemana, resueltosSemana, sent, failed });
}
