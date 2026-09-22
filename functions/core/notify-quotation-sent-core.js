// @ts-check
/**
 * v774 (2026-09-02): notify email cuando una oferta (SQ) se envia a SAP.
 * Pedido de Mariano: cada vez que la app envie una oferta a SAP, notificar
 * al email santiago.beron@shimano.uy con info del cliente.
 *
 * Trigger: onDocumentWritten en pedidos/{pedidoId}. Detecta cuando
 * `transferidoSAP.docNum` cambia de null/undefined a un valor real Y
 * `via === 'service_layer_auto'` (excluir 'app_only' que NO va a SAP).
 *
 * Idempotencia: solo dispara cuando el docNum pasa de vacio a un valor. Si
 * el pedido se actualiza N veces despues sin cambiar transferidoSAP, no
 * re-envia. Si el docNum se limpia (volverAPendientes) y vuelve, si notifica
 * de nuevo — comportamiento esperado ("re-envio").
 *
 * Email transport: SMTP Gmail via nodemailer, credenciales del Secret
 * Manager. Fire-and-forget: si falla el email, el envio a SAP ya paso; el
 * error se loguea pero no bloquea nada.
 */

/**
 * @typedef {Object} TransferidoSAP
 * @property {string|number} [docNum]
 * @property {string|number} [docEntry]
 * @property {string} [via]
 * @property {string} [transferredAt]
 * @property {string} [transferredBy]
 */

/**
 * @typedef {Object} PedidoData
 * @property {string} [clientName]
 * @property {string} [clientCardCode]
 * @property {string} [ownerVendor]
 * @property {string} [ownerEmail]
 * @property {string} [locName]
 * @property {string} [province]
 * @property {number} [orderNumber]
 * @property {number} [totalAmountArs]
 * @property {number} [netAmountArs]
 * @property {number} [subtotalArs]
 * @property {number} [total]
 * @property {number} [totalARS]
 * @property {any[]} [lines]
 * @property {TransferidoSAP} [transferidoSAP]
 */

/**
 * Total ARS del pedido con schema real de Firestore.
 * Mismo pattern que _plannerComputeTotal en el frontend (v1018). El schema
 * NO tiene un unico field: la mayoria de pedidos que se envian a SAP usan
 * `netAmountArs`; algunos legacy podrian usar `totalAmountArs`/`subtotalArs`.
 * Fallback final: sumar qty*precio de `lines`. Antes se leia solo
 * `pedido.totalAmountArs` -> vacio en el email porque el field no existe.
 *
 * @param {PedidoData|null|undefined} pedido
 * @returns {number|null}
 */
export function computeTotalArs(pedido) {
  if (!pedido) return null;
  if (typeof pedido.totalAmountArs === 'number') return pedido.totalAmountArs;
  if (typeof pedido.netAmountArs === 'number') return pedido.netAmountArs;
  if (typeof pedido.subtotalArs === 'number') return pedido.subtotalArs;
  if (typeof pedido.total === 'number') return pedido.total;
  if (typeof pedido.totalARS === 'number') return pedido.totalARS;
  const lineas = Array.isArray(pedido.lines) ? pedido.lines : [];
  if (lineas.length === 0) return null;
  let sum = 0;
  let any = false;
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
 * Determina si debe disparar la notificacion comparando antes/despues.
 *
 * @param {PedidoData|null} before
 * @param {PedidoData|null} after
 * @returns {boolean}
 */
export function shouldNotify(before, after) {
  if (!after) return false; // pedido borrado
  const tsAfter = after.transferidoSAP || {};
  // Solo notificar si REALMENTE fue a SAP (no app_only) y tiene docNum.
  if (!tsAfter.docNum) return false;
  if (tsAfter.via !== 'service_layer_auto') return false;
  // Y solo si esto es NUEVO (antes no habia docNum).
  const tsBefore = (before && before.transferidoSAP) || {};
  if (tsBefore.docNum) return false;
  return true;
}

/**
 * Construye el body del email.
 *
 * @param {string} pedidoId
 * @param {PedidoData} pedido
 * @returns {{subject: string, text: string, html: string}}
 */
export function buildEmailContent(pedidoId, pedido) {
  const ts = pedido.transferidoSAP || {};
  const nLines = Array.isArray(pedido.lines) ? pedido.lines.length : 0;
  const totalArs = computeTotalArs(pedido);
  const totalFmt = totalArs != null
    ? '$' + totalArs.toLocaleString('es-AR', { minimumFractionDigits: 0 })
    : '-';

  const subject = `[Shimano App] Oferta SAP ${ts.docNum} - ${pedido.clientName || 'Cliente'}`;

  const text = [
    'Se envio una oferta a SAP desde la app-vendedores.',
    '',
    `Cliente: ${pedido.clientName || '(sin nombre)'}`,
    `CardCode: ${pedido.clientCardCode || '-'}`,
    `Localidad: ${pedido.locName || '-'} / ${pedido.province || '-'}`,
    `Vendedor: ${pedido.ownerVendor || '-'} (${pedido.ownerEmail || '-'})`,
    '',
    `SAP DocNum: ${ts.docNum}`,
    `SAP DocEntry: ${ts.docEntry || '-'}`,
    `Enviado: ${ts.transferredAt || '-'}`,
    '',
    `Orden App: ${pedido.orderNumber || pedidoId}`,
    `Cantidad de lineas: ${nLines}`,
    `Total ARS: ${totalFmt}`,
    '',
    '-- Shimano App Vendedores (notificacion automatica)',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.5">
      <p>Se envio una oferta a SAP desde la <b>app-vendedores</b>.</p>
      <table style="border-collapse:collapse;margin:10px 0">
        <tr><td style="padding:4px 12px;background:#f3f4f6;font-weight:bold">Cliente</td><td style="padding:4px 12px">${escapeHtml(pedido.clientName || '(sin nombre)')}</td></tr>
        <tr><td style="padding:4px 12px;background:#f3f4f6;font-weight:bold">CardCode</td><td style="padding:4px 12px">${escapeHtml(pedido.clientCardCode || '-')}</td></tr>
        <tr><td style="padding:4px 12px;background:#f3f4f6;font-weight:bold">Localidad</td><td style="padding:4px 12px">${escapeHtml(pedido.locName || '-')} / ${escapeHtml(pedido.province || '-')}</td></tr>
        <tr><td style="padding:4px 12px;background:#f3f4f6;font-weight:bold">Vendedor</td><td style="padding:4px 12px">${escapeHtml(pedido.ownerVendor || '-')} (${escapeHtml(pedido.ownerEmail || '-')})</td></tr>
        <tr><td style="padding:4px 12px;background:#dcfce7;font-weight:bold;color:#166534">SAP DocNum</td><td style="padding:4px 12px;color:#166534;font-weight:bold">${escapeHtml(String(ts.docNum))}</td></tr>
        <tr><td style="padding:4px 12px;background:#f3f4f6;font-weight:bold">Enviado</td><td style="padding:4px 12px">${escapeHtml(String(ts.transferredAt || '-'))}</td></tr>
        <tr><td style="padding:4px 12px;background:#f3f4f6;font-weight:bold">Orden App</td><td style="padding:4px 12px">${escapeHtml(String(pedido.orderNumber || pedidoId))}</td></tr>
        <tr><td style="padding:4px 12px;background:#f3f4f6;font-weight:bold">Cantidad lineas</td><td style="padding:4px 12px">${nLines}</td></tr>
        <tr><td style="padding:4px 12px;background:#f3f4f6;font-weight:bold">Total ARS</td><td style="padding:4px 12px">${escapeHtml(totalFmt)}</td></tr>
      </table>
      <p style="color:#6b7280;font-size:11px">-- Shimano App Vendedores (notificacion automatica)</p>
    </div>
  `;

  return { subject, text, html };
}

/**
 * @param {any} s
 */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Envia email via SMTP Gmail. Fire-and-forget desde el trigger.
 *
 * @param {Object} deps
 * @param {any} deps.nodemailer  Modulo nodemailer (inyectable para test)
 * @param {string} deps.gmailUser  ej. bot.shimano.pesca@gmail.com
 * @param {string} deps.gmailAppPassword  App Password de 16 chars (Secret Manager)
 * @param {string} deps.recipient  ej. santiago.beron@shimano.uy
 * @param {string} subject
 * @param {string} text
 * @param {string} html
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendEmail(deps, subject, text, html) {
  const { nodemailer, gmailUser, gmailAppPassword, recipient } = deps;
  if (!gmailUser || !gmailAppPassword) {
    return { ok: false, error: 'gmailUser o gmailAppPassword vacios' };
  }
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailAppPassword },
    });
    await transporter.sendMail({
      from: gmailUser,
      to: recipient,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}
