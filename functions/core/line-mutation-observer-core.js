// @ts-check
/**
 * v1564+ (2026-11-24): observer-only para mutaciones post-commit en pedidos.lines /
 * pedidos.netAmountArs / pedidos.subtotalArs.
 *
 * Vector descubierto en HARDENING6_28 §3: un VDE con DevTools puede modificar
 * `lines[*].qty`, `lines[*].code`, agregar / quitar líneas, o cambiar
 * netAmountArs / subtotalArs entre que el pedido se crea (`doConfirmPedido`)
 * y que el trigger `onPedidoConfirmedSendToSap` arma el payload SL. SAP recibe
 * la Quantity falsificada y crea la SQ con DocTotal real inflado. Precio
 * UnitPrice no se puede manipular (SAP lo resuelve server-side desde el
 * PriceListNum del BP), pero inflar qty o cambiar SKU produce fraude comercial
 * real.
 *
 * Esta pure fn es el DETECTOR: compara el snapshot `before` vs `after` de un
 * pedido y devuelve la lista de mutaciones detectadas. NO hace writes a
 * Firestore, NO lee auth context. La CF wrapper (`onPedidoLineMutationObserver`
 * en functions/index.js) decide:
 *   1. Si el actor es admin/interno/gerente → skip (correcciones legítimas).
 *   2. Si el stage del pedido ya es terminal (sent-to-SAP / invoiced / closed)
 *      → skip (el daño ya está hecho; sin valor loguear).
 *   3. Si hasMutation → escribir operations_log type='LINE_MUTATION_OBSERVED'.
 *
 * NO rechaza writes. NO rollbackea. Es observer de 4 semanas para sizing +
 * baseline de FPs antes del enforcement (follow-up PR: `updatePedidoLinesCF`
 * callable + remover whitelist VDE en firestore.rules).
 *
 * Shape de output:
 *   {
 *     hasMutation: boolean,
 *     mutations: Array<Mutation>,   // 0+ eventos detectados
 *     inScope: boolean,             // false si el pedido está en stage terminal
 *   }
 *
 * Mutation kinds:
 *   LINE_QTY_CHANGED     { kind, lineIdx, sku, from, to, delta }
 *   LINE_SKU_CHANGED     { kind, lineIdx, from, to, qty }
 *   LINE_ADDED           { kind, lineIdx, sku, qty }
 *   LINE_REMOVED         { kind, lineIdx, sku, qty }
 *   NET_AMOUNT_CHANGED   { kind, from, to, delta }
 *   SUBTOTAL_CHANGED     { kind, from, to, delta }
 */

// Stages en los que una mutación del VDE a lines[]/agregados es "riesgosa"
// (pre-SAP). Si el pedido ya pasó a estos stages, el daño ya ocurrió o la
// mutación es correción legítima post-facturación:
//   - SENT_TO_SAP / INVOICED / CLOSED / CANCELLED → ya cerrado.
const TERMINAL_STAGES = new Set(['invoiced', 'closed', 'cancelled']);

/**
 * @param {any} v
 * @returns {number}
 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {any} v
 * @returns {string}
 */
function str(v) {
  return typeof v === 'string' ? v : '';
}

/**
 * Determina si una línea está "viva" (no cancelled). Para líneas canceladas,
 * mutaciones de qty/code no son observables (son ruido del cleanup).
 * @param {any} line
 */
function isLineActive(line) {
  if (!line || typeof line !== 'object') return false;
  const state = String(line.state || '').toLowerCase();
  if (state === 'cancelled' || state === 'recycled') return false;
  return true;
}

/**
 * Detecta las mutaciones entre before y after de un pedido.
 *
 * @param {any} before Snapshot `before` del doc pedidos/{id}.
 * @param {any} after Snapshot `after` del doc pedidos/{id}. Debe existir;
 *   si viene null, retornamos { hasMutation: false } (es un delete).
 * @param {{ includeTerminalStages?: boolean }} [opts] Si `includeTerminalStages`
 *   es true, no filtra por stage. Útil para tests + auditorías ad-hoc.
 */
export function detectLineMutations(before, after, opts) {
  const options = opts || {};
  const includeTerminal = options.includeTerminalStages === true;

  if (!after || typeof after !== 'object') {
    // delete — observable como "LINE_REMOVED en masa" pero fuera de scope.
    return { hasMutation: false, mutations: [], inScope: false };
  }

  if (!before || typeof before !== 'object') {
    // create — el pedido se crea desde el payload del commit callable, no hay
    // mutación "post-commit". Fuera de scope (la detección ocurre en el
    // callable mismo + sus validaciones).
    return { hasMutation: false, mutations: [], inScope: false };
  }

  if (!includeTerminal) {
    const stage = String(after.stage || '').toLowerCase();
    if (TERMINAL_STAGES.has(stage)) {
      return { hasMutation: false, mutations: [], inScope: false };
    }
  }

  const beforeLines = Array.isArray(before.lines) ? before.lines : [];
  const afterLines = Array.isArray(after.lines) ? after.lines : [];

  /** @type {any[]} */
  const mutations = [];

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const bl = beforeLines[i];
    const al = afterLines[i];

    const blActive = isLineActive(bl);
    const alActive = isLineActive(al);

    if (!blActive && alActive) {
      // LINE_ADDED: no existía (o estaba cancelled) y ahora existe viva.
      mutations.push({
        kind: 'LINE_ADDED',
        lineIdx: i,
        sku: str(al.code),
        qty: num(al.qty),
      });
      continue;
    }

    if (blActive && !alActive) {
      // LINE_REMOVED: existía viva y ahora desapareció (o pasó a cancelled).
      // No distinguimos "cancelled legítimo" vs "removido" acá — el actor-role
      // check en el wrapper filtra admin writes. VDE no puede setear
      // state='cancelled' directo sin pasar por releaseAsigCF.
      mutations.push({
        kind: 'LINE_REMOVED',
        lineIdx: i,
        sku: str(bl.code),
        qty: num(bl.qty),
      });
      continue;
    }

    if (!blActive && !alActive) {
      // Ambas inactivas — nada que observar.
      continue;
    }

    // Ambas activas: comparar.
    const blCode = str(bl.code);
    const alCode = str(al.code);
    const blQty = num(bl.qty);
    const alQty = num(al.qty);

    if (blCode !== alCode) {
      mutations.push({
        kind: 'LINE_SKU_CHANGED',
        lineIdx: i,
        from: blCode,
        to: alCode,
        qty: alQty,
      });
    }

    if (blQty !== alQty) {
      mutations.push({
        kind: 'LINE_QTY_CHANGED',
        lineIdx: i,
        sku: alCode,
        from: blQty,
        to: alQty,
        delta: alQty - blQty,
      });
    }
  }

  // Agregados a nivel doc.
  const blNet = num(before.netAmountArs);
  const alNet = num(after.netAmountArs);
  if (blNet !== alNet) {
    mutations.push({
      kind: 'NET_AMOUNT_CHANGED',
      from: blNet,
      to: alNet,
      delta: alNet - blNet,
    });
  }

  const blSub = num(before.subtotalArs);
  const alSub = num(after.subtotalArs);
  if (blSub !== alSub) {
    mutations.push({
      kind: 'SUBTOTAL_CHANGED',
      from: blSub,
      to: alSub,
      delta: alSub - blSub,
    });
  }

  return {
    hasMutation: mutations.length > 0,
    mutations,
    inScope: true,
  };
}

/**
 * Determina si el rol del actor del write es "legítimo" (admin/interno/gerente).
 * Un actor legítimo escribe por correcciones operativas, no por fraude.
 *
 * @param {string | null | undefined} role
 * @returns {boolean}
 */
export function isLegitimateActor(role) {
  if (!role) return false;
  const r = String(role).toLowerCase();
  return r === 'admin' || r === 'interno' || r === 'gerente';
}

/**
 * Arma el entry para `operations_log` dado el resultado del detector + contexto
 * del evento Firestore.
 *
 * @param {object} params
 * @param {string} params.pedidoId
 * @param {any[]} params.mutations
 * @param {string | null} params.actorUid
 * @param {string | null} params.actorEmail
 * @param {string | null} params.actorRole
 * @param {any} params.afterData Snapshot after para extraer contexto negocio.
 * @param {string} params.nowIso
 * @param {string} params.shadowStartedAt Fecha ISO (YYYY-MM-DD) de inicio del shadow.
 */
export function buildObservationLogEntry(params) {
  const afterData = params.afterData || {};
  return {
    type: 'LINE_MUTATION_OBSERVED',
    severity: 'HIGH',
    pedidoId: params.pedidoId,
    actorUid: params.actorUid || null,
    actorEmail: params.actorEmail || null,
    actorRole: params.actorRole || null,
    pedidoStage: String(afterData.stage || '').toLowerCase() || null,
    pedidoOwnerUid: afterData.ownerUid || null,
    pedidoOwnerEmail: afterData.ownerEmail || null,
    pedidoVendorKey: afterData.vendorAssigned || afterData.ownerVendor || null,
    pedidoClientCardCode: afterData.clientCardCode || null,
    pedidoClientName: afterData.clientName || null,
    pedidoOrderNumber: afterData.orderNumber || null,
    mutations: params.mutations,
    mutationsCount: params.mutations.length,
    // v1564+ shadow mode: flags que anuncian "este entry es observación,
    // NO está bloqueando nada". Follow-up PR (enforcement) pondrá
    // _shadowOnly=false + agregará blockedAt/blockedBy.
    _shadowOnly: true,
    _shadowStartedAt: params.shadowStartedAt,
    _observerVersion: 'v1',
    timestamp: params.nowIso,
  };
}
