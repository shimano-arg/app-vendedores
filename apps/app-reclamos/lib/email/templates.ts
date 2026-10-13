import { COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';

export function assignmentEmail(opts: {
  recipientName: string;
  claimId: number;
  remitoNumber: string;
  observations: string;
  column: ClaimColumn;
  appUrl: string;
}) {
  const link = `${opts.appUrl}/board?claim=${opts.claimId}`;
  const columnLabel = COLUMN_LABEL[opts.column];
  const obsShort =
    opts.observations.length > 200
      ? opts.observations.slice(0, 200) + '...'
      : opts.observations;
  return {
    subject: `[Reclamos Shimano] Tarjeta asignada — Remito #${opts.remitoNumber}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
        <h2 style="margin: 0 0 8px;">Hola ${opts.recipientName},</h2>
        <p style="margin: 0 0 16px;">
          Se te asignó una tarjeta en la columna <strong>${columnLabel}</strong>.
        </p>
        <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <div style="font-size: 12px; color: #64748b;">Remito</div>
          <div style="font-weight: 600; margin-bottom: 8px;">#${opts.remitoNumber}</div>
          <div style="font-size: 12px; color: #64748b;">Observaciones</div>
          <div style="white-space: pre-wrap;">${obsShort}</div>
        </div>
        <a href="${link}" style="display: inline-block; background: #0f172a; color: white; padding: 10px 16px; border-radius: 6px; text-decoration: none;">Abrir reclamo</a>
        <p style="font-size: 12px; color: #64748b; margin-top: 24px;">
          Enviado por Reclamos Shimano.
        </p>
      </div>`,
  };
}
