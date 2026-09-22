// @ts-check
/**
 * planner-stage-change-core.js (Planner Kanban, 2026-09-22)
 *
 * Pure core logic for CF `onPlannerStageChanged`. No firebase-admin imports.
 * All side-effect dependencies are injected via `deps` (CLAUDE.md §7).
 *
 * Trigger: onDocumentWritten on pedidos/{pedidoId}. Fires when the computed
 * Kanban column changes. Sends an email to the column's responsable and,
 * for 'facturar' with sendToVdi=true, also to the VDI assigned to the pedido.
 *
 * Idempotency: if `after.plannerEmails.<column>.sentAt` is already set the
 * email is skipped — safe to re-run on retries.
 */

import { computeColumn } from './planner-compute-column.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const COLUMN_LABELS = {
  lista_espera: 'Lista de espera',
  oferta: 'Oferta SAP',
  ordenes: 'Órdenes SAP',
  confirmado: 'Confirmado',
  facturar: 'Facturar',
  cobrado: 'Cobrado',
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the email of the VDI associated with a vendorKey by querying
 * the `roles` collection.
 *
 * @param {string} vendorKey
 * @param {any} db  - Injected Firestore instance
 * @returns {Promise<string|null>}
 */
async function resolveVdiEmail(vendorKey, db) {
  const snap = await db.collection('roles').where('vendor', '==', vendorKey).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data().email || null;
}

/**
 * @param {any} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolves the display "number" for a pedido in the email notification.
 * v1021: los pedidos NUNCA tienen pedidoNumber/orderNumber (ese schema
 * nunca existió); la card del Planner muestra `SAP:<docNum>` y opcionalmente
 * `SO:<orderDocEntry>`. Alineamos el email con esa misma señal.
 *
 * @param {any} pedido
 * @returns {string}
 */
function resolveDisplayNumber(pedido) {
  if (pedido?.pedidoNumber) return String(pedido.pedidoNumber);
  if (pedido?.orderNumber) return String(pedido.orderNumber);
  const t = pedido?.transferidoSAP;
  if (t?.orderDocEntry && t?.docNum) return `SAP:${t.docNum} · SO:${t.orderDocEntry}`;
  if (t?.docNum) return `SAP:${t.docNum}`;
  if (t?.orderDocEntry) return `SO:${t.orderDocEntry}`;
  return '(sin número)';
}

/**
 * Resolves the total ARS of a pedido using the same precedence chain as
 * the client's _plannerComputeTotal (index.html v1018). v1021 fix: antes
 * solo miraba totalAmountArs (~24% de docs) → 76% de pedidos mostraban "-".
 * MANTENER SINCRONIZADO con _plannerComputeTotal en index.html.
 *
 * @param {any} pedido
 * @returns {number|null}
 */
function resolveTotalArs(pedido) {
  if (!pedido) return null;
  if (typeof pedido.totalAmountArs === 'number') return pedido.totalAmountArs;
  if (typeof pedido.netAmountArs === 'number') return pedido.netAmountArs;
  if (typeof pedido.subtotalArs === 'number') return pedido.subtotalArs;
  if (typeof pedido.total === 'number') return pedido.total;
  if (typeof pedido.totalARS === 'number') return pedido.totalARS;
  const lineas = Array.isArray(pedido.lines)
    ? pedido.lines
    : Array.isArray(pedido.items) ? pedido.items : [];
  if (lineas.length === 0) return null;
  let sum = 0, any = false;
  for (const l of lineas) {
    if (!l) continue;
    const qty = Number(l.qty) || 0;
    const price = Number(l.precio) || Number(l.priceAtCreation) || Number(l.price) || 0;
    if (qty > 0 && price > 0) { sum += qty * price; any = true; }
  }
  return any ? sum : null;
}

/**
 * Builds the email subject, HTML body, and plain-text fallback for a
 * Planner column-entry notification.
 *
 * @param {any} pedido - The `after` document data
 * @param {string} column - The column being entered
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildEmailBody(pedido, column) {
  const label = COLUMN_LABELS[column] || column;
  const num = resolveDisplayNumber(pedido);
  const cliente = pedido.clientName || pedido.cardName || '(sin cliente)';
  const vdi = pedido.ownerVendor || pedido.vendorKey || '-';
  const totalArs = resolveTotalArs(pedido);
  const totalFmt = typeof totalArs === 'number' && totalArs > 0
    ? '$' + totalArs.toLocaleString('es-AR', { minimumFractionDigits: 0 })
    : '-';

  const subject = `[Planner] Pedido ${num} entró a ${label}`;

  const text = [
    `Pedido ${num} pasó a la columna "${label}" en el Planner Kanban.`,
    '',
    `Cliente:  ${cliente}`,
    `VDI:      ${vdi}`,
    `Total ARS:${totalFmt}`,
    '',
    '-- Shimano App Vendedores (notificación automática)',
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.6;color:#1a1a1a">
      <h2 style="color:#003366;margin:0 0 12px">Planner Kanban — ${escapeHtml(label)}</h2>
      <p style="margin:0 0 12px">El pedido <strong>${escapeHtml(String(num))}</strong> ingresó a la columna <strong>${escapeHtml(label)}</strong>.</p>
      <table style="border-collapse:collapse;margin:0 0 16px;min-width:280px">
        <tr>
          <td style="padding:6px 14px;background:#f0f4f8;font-weight:600;white-space:nowrap">Cliente</td>
          <td style="padding:6px 14px;border-bottom:1px solid #e5e7eb">${escapeHtml(cliente)}</td>
        </tr>
        <tr>
          <td style="padding:6px 14px;background:#f0f4f8;font-weight:600;white-space:nowrap">VDI</td>
          <td style="padding:6px 14px;border-bottom:1px solid #e5e7eb">${escapeHtml(vdi)}</td>
        </tr>
        <tr>
          <td style="padding:6px 14px;background:#f0f4f8;font-weight:600;white-space:nowrap">Total ARS</td>
          <td style="padding:6px 14px;border-bottom:1px solid #e5e7eb">${escapeHtml(totalFmt)}</td>
        </tr>
      </table>
      <p style="color:#6b7280;font-size:11px;margin:0">-- Shimano App Vendedores (notificación automática)</p>
    </div>
  `;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   db: any,
 *   transporter: { sendMail: (opts: any) => Promise<any> },
 *   log: { info: (msg: string) => void, warn: (msg: string) => void, error: (msg: string) => void },
 *   now: () => Date
 * }} PlannerDeps
 */

/**
 * Handles a Planner stage-change Firestore trigger.
 *
 * Returns `{ skipped: string }` for early exits or `{ sent: { to, column } }`
 * on successful delivery.
 *
 * @param {any} event - The Firestore DocumentWritten event (Change<DocumentSnapshot>)
 * @param {PlannerDeps} deps - Injected side-effect dependencies
 * @returns {Promise<{ skipped: string } | { sent: { to: string, column: string } }>}
 */
export async function handlePlannerStageChanged(event, deps) {
  // Step 1 — require after document
  const after = event?.data?.after?.data?.();
  if (!after) return { skipped: 'no-after' };

  // Step 2 — compute columns; skip if unchanged
  const before = event?.data?.before?.data?.();
  const beforeCol = before ? computeColumn(before) : null;
  const afterCol = computeColumn(after);
  if (beforeCol === afterCol) return { skipped: 'no-column-change' };

  // Step 3 — idempotency: skip if email was already sent for this column
  if (after.plannerEmails?.[afterCol]?.sentAt) return { skipped: 'already-sent' };

  // Step 4 — load column config from Firestore
  const configSnap = await deps.db.doc('app_config/planner_responsables').get();
  if (!configSnap.exists) return { skipped: 'no-config' };
  const columnConfig = configSnap.data()?.[afterCol];
  if (!columnConfig?.notifyOnEnter) return { skipped: 'notify-disabled' };

  // Step 5 — build recipients list; always include the column's primary email
  /** @type {string[]} */
  const recipients = [];
  if (columnConfig.email) recipients.push(columnConfig.email);

  // Step 6 — for 'facturar' with sendToVdi, also notify the assigned VDI
  if (afterCol === 'facturar' && columnConfig.sendToVdi && after.vendorKey) {
    const vdiEmail = await resolveVdiEmail(after.vendorKey, deps.db);
    if (vdiEmail) {
      recipients.push(vdiEmail);
    } else {
      deps.log.warn(`Facturar sendToVdi: no email for vendor ${after.vendorKey}`);
    }
  }

  // Step 7 — bail if no recipients
  if (recipients.length === 0) return { skipped: 'no-recipients' };

  // Step 8 — build email body
  const { subject, html, text } = buildEmailBody(after, afterCol);

  // Step 9 — send email
  await deps.transporter.sendMail({
    from: 'bot.shimano.pesca@gmail.com',
    to: recipients.join(','),
    subject,
    html,
    text,
  });

  // Step 10 — mark as sent in the document (idempotency record)
  await event.data.after.ref.update({
    [`plannerEmails.${afterCol}`]: { sentAt: deps.now(), to: recipients.join(',') },
  });

  // Step 11 — log
  deps.log.info(`Planner email sent: ${afterCol} -> ${recipients.join(',')}`);

  // Step 12 — return result
  return { sent: { to: recipients.join(','), column: afterCol } };
}
