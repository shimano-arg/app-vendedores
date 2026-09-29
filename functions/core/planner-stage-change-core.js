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

/**
 * v1026 (2026-09-22): sync con PLANNER_COLUMNS del frontend.
 * 'Órdenes SAP' → 'Pendiente de facturar' (SO creada esperando facturar).
 * 'Facturar' → 'Facturado' (al menos 1 línea con qtyInvoiced > 0).
 * @type {Record<string, string>}
 */
const COLUMN_LABELS = {
  lista_espera: 'Lista de espera',
  oferta: 'Oferta SAP',
  ordenes: 'Pendiente de facturar',
  facturar: 'Facturado',
  cobrado: 'Cobrado',
  // v1037: 'confirmado' removida — 0 uso en prod.
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * v1081 (2026-09-25): alias legacy para vendedores que salieron del equipo
 * pero cuyos pedidos historicos siguen en Firestore con el nombre viejo.
 * MARTIN BOIERO era Z4 hasta que PACHI ocupo la zona. Mariano confirmo:
 * "NO EXISTE MAS MARTIN BOIERO. TODO LO DE MARTIN ES PACHI". El alias hace
 * que la CF trate los pedidos historicos como si fueran de PACHI —
 * resolveVdeEmail y resolveVdiPartnerEmail resuelven a PACHI+Santiago
 * automaticamente. Pattern paralelo al frontend v1079 (_canonVendor).
 *
 * Escalable: para cualquier nuevo caso, agregar entrada aca.
 */
const LEGACY_VENDOR_ALIAS = {
  'MARTIN BOIERO': 'PACHI',
};
function canonVendor(v) {
  if (v == null) return v;
  const k = String(v).toUpperCase().trim();
  return LEGACY_VENDOR_ALIAS[k] || k;
}

/**
 * Resolves the email of the VDE (vendedor externo) that owns a vendorKey.
 *
 * v1031 (2026-09-22) rename: antes se llamaba `resolveVdiEmail` pero
 * semanticamente devuelve el VDE, no el VDI (el que tiene `vendor` en `roles`
 * es el VDE, el VDI es su partner). Config `sendToVdi` en Facturar quedó
 * mal nombrada — en realidad envía al VDE (dueño del pedido).
 *
 * v1081 (2026-09-25): aplica canonVendor para mapear MARTIN BOIERO → PACHI.
 *
 * @param {string} vendorKey
 * @param {any} db  - Injected Firestore instance
 * @returns {Promise<string|null>}
 */
async function resolveVdeEmail(vendorKey, db) {
  const canonKey = canonVendor(vendorKey);
  const snap = await db.collection('roles').where('vendor', '==', canonKey).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data().email || null;
}

/**
 * Resolves the email of the VDI (vendedor interno) pareja del VDE dueño de
 * un pedido. Flow:
 *   1. Buscar VDE con `vendor === pedido.ownerVendor` (o `vendorKey` fallback)
 *   2. Leer su `internalPartnerUid` (apunta al UID del VDI pareja)
 *   3. Traer `roles/{internalPartnerUid}` y devolver su email
 *
 * v1031 (2026-09-22): pedido de Mariano — notificar a los VDIs (Santiago
 * Esteban, Ioannis Palkoudakis) cuando un pedido de su/sus pareja(s) VDE
 * cambia de columna en el Planner. Auto-escalable a cualquier VDI futuro.
 *
 * @param {any} pedido - The pedido document data
 * @param {any} db - Injected Firestore instance
 * @returns {Promise<string|null>}
 */
async function resolveVdiPartnerEmail(pedido, db) {
  const rawVendorKey = pedido?.ownerVendor || pedido?.vendorKey;
  if (!rawVendorKey) {
    console.log('[vdi-partner] skip: no-vendor-key en pedido', pedido?.id || '?');
    return null;
  }
  // v1081 (2026-09-25): canonVendor mapea MARTIN BOIERO → PACHI. Pedidos
  // historicos de Martin resuelven al VDE PACHI (y por su internalPartnerUid
  // llegan a Santiago Esteban).
  const vendorKey = canonVendor(rawVendorKey);
  if (vendorKey !== rawVendorKey) {
    console.log('[vdi-partner] alias legacy: ' + rawVendorKey + ' -> ' + vendorKey);
  }
  // Paso 1: encontrar el VDE con ese vendor key.
  const vdeSnap = await db
    .collection('roles')
    .where('vendor', '==', vendorKey)
    .where('role', '==', 'vendedor')
    .limit(1)
    .get();
  // v1080 (2026-09-25): fallback self-notification. Reporte Mariano — Santiago
  // no recibia alertas de sus PROPIOS pedidos (ownerVendor='SANTIAGO ESTEBAN')
  // porque Santiago esta registrado como role='interno' (no 'vendedor'). El
  // codigo original solo buscaba VDEs pareja de otro VDI. Ahora: si no hay VDE
  // 'vendedor' con ese key, buscar directamente al 'interno' con el mismo
  // vendor — es su propio pedido, se auto-notifica. Aplica al VDE-VDI hibrido
  // (Santiago Z7 + partner de Mauricio/PACHI/Martin, Ioannis Z6, etc).
  if (vdeSnap.empty) {
    const selfInternoSnap = await db
      .collection('roles')
      .where('vendor', '==', vendorKey)
      .where('role', '==', 'interno')
      .limit(1)
      .get();
    if (!selfInternoSnap.empty) {
      const self = selfInternoSnap.docs[0].data() || {};
      if (self.email) {
        console.log('[vdi-partner] OK self-notify: vendor=' + vendorKey + ' es interno directo -> ' + self.email);
        return self.email;
      }
      console.log('[vdi-partner] skip: interno self=' + vendorKey + ' sin email');
      return null;
    }
    console.log('[vdi-partner] skip: no-vde-found ni no-interno-self para vendorKey=' + vendorKey);
    return null;
  }
  const vde = vdeSnap.docs[0].data() || {};
  const vdeUid = vdeSnap.docs[0].id;
  const partnerUid = vde.internalPartnerUid;
  if (!partnerUid) {
    console.log('[vdi-partner] skip: no-internalPartnerUid en VDE ' + vdeUid + ' (email=' + (vde.email || '?') + ', vendor=' + vendorKey + ')');
    return null;
  }
  const vdiSnap = await db.doc('roles/' + partnerUid).get();
  if (!vdiSnap.exists) {
    console.log('[vdi-partner] skip: partnerUid=' + partnerUid + ' no existe en roles/');
    return null;
  }
  const vdi = vdiSnap.data() || {};
  if (vdi.role !== 'interno') {
    console.log('[vdi-partner] skip: partnerUid=' + partnerUid + ' tiene role=' + vdi.role + ' (esperado: interno). Email=' + (vdi.email || '?'));
    return null;
  }
  if (!vdi.email) {
    console.log('[vdi-partner] skip: partnerUid=' + partnerUid + ' role=interno OK pero sin email seteado');
    return null;
  }
  console.log('[vdi-partner] OK: vendor=' + vendorKey + ' -> VDE ' + (vde.email || '?') + ' -> VDI ' + vdi.email);
  return vdi.email;
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
 *
 * v1022 (2026-09-22): pedido.orderNumber (ID único del negocio asignado por
 * counters/orderNumber al crearse en el waitlist) tiene la precedencia máxima
 * y se combina con SAP:X / SO:Y como contexto adicional. El ORDEN es el ID
 * que el equipo comercial usa para trackear el pedido a lo largo del pipeline
 * — SAP:X y SO:Y son números internos del sistema contable.
 *
 * Formato:
 *  - "ORDEN 145" (sin SAP)
 *  - "ORDEN 145 (SAP:2000120 · SO:36882)" (con SAP+SO)
 *  - "ORDEN 145 (SAP:2000120)" (con SAP sin SO)
 *  - "SAP:2000120 · SO:36882" (sin ORDEN, legacy fallback)
 *  - "(sin número)" (nada)
 *
 * v1021: pedidoNumber es legacy (schema plan viejo, nunca existió en prod).
 *
 * @param {any} pedido
 * @returns {string}
 */
function resolveDisplayNumber(pedido) {
  const t = pedido?.transferidoSAP;
  let sapContext = '';
  if (t?.orderDocEntry && t?.docNum) sapContext = `SAP:${t.docNum} · SO:${t.orderDocEntry}`;
  else if (t?.docNum) sapContext = `SAP:${t.docNum}`;
  else if (t?.orderDocEntry) sapContext = `SO:${t.orderDocEntry}`;

  if (pedido?.orderNumber) {
    const orden = `ORDEN ${pedido.orderNumber}`;
    return sapContext ? `${orden} (${sapContext})` : orden;
  }
  if (pedido?.pedidoNumber) return String(pedido.pedidoNumber);
  if (sapContext) return sapContext;
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
    : Array.isArray(pedido.items)
      ? pedido.items
      : [];
  if (lineas.length === 0) return null;
  let sum = 0,
    any = false;
  for (const l of lineas) {
    if (!l) continue;
    const qty = Number(l.qty) || 0;
    const price = Number(l.precio) || Number(l.priceAtCreation) || Number(l.price) || 0;
    if (qty > 0 && price > 0) {
      sum += qty * price;
      any = true;
    }
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
  const totalFmt =
    typeof totalArs === 'number' && totalArs > 0
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

  // Step 6a — for 'facturar' with sendToVdi (legacy — en realidad notifica al
  // VDE dueño), notificar al VDE. v1031 rename: la función se llama
  // resolveVdeEmail ahora (antes mal nombrada resolveVdiEmail).
  if (afterCol === 'facturar' && columnConfig.sendToVdi && after.vendorKey) {
    const vdeEmail = await resolveVdeEmail(after.vendorKey, deps.db);
    if (vdeEmail) {
      recipients.push(vdeEmail);
    } else {
      deps.log.warn(`Facturar sendToVdi: no email for vendor ${after.vendorKey}`);
    }
  }

  // Step 6b (v1031, 2026-09-22) — notificar al VDI pareja del VDE dueño del
  // pedido para TODAS las columnas del pipeline. Pedido de Mariano: Santiago
  // Esteban e Ioannis Palkoudakis reciben notif de cambio de columna de sus
  // pedidos o de sus parejas VDE.
  // Se puede deshabilitar por columna con `notifyVdiPartner: false` en la
  // config de responsables (opt-out granular).
  if (columnConfig.notifyVdiPartner !== false) {
    const vdiPartnerEmail = await resolveVdiPartnerEmail(after, deps.db);
    if (vdiPartnerEmail && !recipients.includes(vdiPartnerEmail)) {
      recipients.push(vdiPartnerEmail);
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
