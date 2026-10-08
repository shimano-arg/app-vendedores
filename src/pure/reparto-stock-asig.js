// @ts-check
/**
 * v1210 (2026-10-08): Reparto de Stock Asignado.
 *
 * Permite que admin ajuste la cantidad ASIG de un cliente/pedido para un SKU
 * especifico. La diferencia se mueve entre ASIG ↔ BO del MISMO pedido sin
 * perder unidades.
 *
 * Reglas:
 * - Reducir (newQty < currentAsig): la diferencia va a BO del mismo pedido.
 *   Si ya existe linea BO del SKU en el pedido, se incrementa; sino se crea.
 * - Aumentar (newQty > currentAsig): primero consume linea BO del mismo
 *   pedido/SKU si existe. Si falta, exige stock fisico libre (dep 11 sin
 *   reservar). Si no alcanza, error "sin unidades disponibles".
 * - newQty === currentAsig: no-op.
 *
 * Caso: pedido con 20u ASIG + 0u BO. Admin cambia 20→18.
 *   Resultado: linea ASIG qty=18 + linea BO nueva qty=2.
 *
 * Caso: pedido con 18u ASIG + 2u BO. Admin cambia 18→20.
 *   Resultado: linea ASIG qty=20 + linea BO qty=0 state='cancelled'.
 *
 * Caso: pedido con 20u ASIG + 0u BO + stockFisicoLibre=5. Admin cambia 20→22.
 *   Resultado: linea ASIG qty=22 (toma 2u del stock libre).
 *
 * Caso: pedido con 20u ASIG + 0u BO + stockFisicoLibre=0. Admin cambia 20→25.
 *   Resultado: error "no hay stock libre suficiente".
 *
 * Audit trail: lineas modificadas reciben redistributedBy + redistributedAt.
 */

/**
 * @typedef {Object} LineLike
 * @property {string} [sku]
 * @property {string} [code]
 * @property {number} [qty]
 * @property {number} [qtyOpen]
 * @property {string} [state]
 * @property {boolean} [asigReserva]
 * @property {string|null} [asigAt]
 * @property {string|null} [asigCliTipo]
 * @property {number} [priceAtCreation]
 * @property {string|null} [recycledIntoPedidoId]
 * @property {string} [cancelledAt]
 * @property {string} [cancelledBy]
 * @property {string} [cancelReason]
 * @property {boolean} [createdFromRedistribution]
 * @property {string} [redistributedBy]
 * @property {string} [redistributedAt]
 * @property {number} [redistributedBefore]
 * @property {number} [redistributedAfter]
 *
 * @typedef {Object} PedidoLike
 * @property {Array<LineLike>} [lines]
 * @property {string} [clientName]
 * @property {string} [clientCardCode]
 *
 * @typedef {Object} AuditInfo
 * @property {string} adminEmail Email del admin que ejecuta el reparto.
 * @property {string} nowIso Timestamp ISO del momento del reparto.
 *
 * @typedef {Object} RepartoResult
 * @property {boolean} ok Si la redistribucion fue aplicada.
 * @property {Array<LineLike>} [newLines] Nuevo array de lineas del pedido (reemplaza al original).
 * @property {string} [error] Mensaje de error si !ok.
 * @property {number} delta Delta ejecutado (newQty - currentAsig). 0 si no-op.
 * @property {'BO'|'LIBRE'|'MIXED'|null} [from] De donde vinieron las unidades al aumentar.
 * @property {number} [usedFromBO] Cuantas unidades vinieron de BO (si delta>0).
 * @property {number} [usedFromLibre] Cuantas unidades vinieron del stock fisico libre (si delta>0).
 * @property {number} [currentAsig] ASIG actual antes del cambio.
 * @property {number} [currentBO] BO actual antes del cambio.
 */

const EPSILON = 1e-9;

/**
 * Normaliza SKU: upper + trim.
 * @param {any} v
 * @returns {string}
 */
function normSku(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().toUpperCase();
}

/**
 * Retorna el sku efectivo de una linea.
 * @param {LineLike} l
 * @returns {string}
 */
function lineSku(l) {
  return normSku(l?.sku || l?.code || '');
}

/**
 * Clasifica si una linea cuenta como ASIG activa para el reparto.
 * Solo lineas con state='ASIG' + asigReserva=true + qtyOpen>0.
 * @param {LineLike} l
 * @returns {boolean}
 */
function isAsigActive(l) {
  if (!l || l.state !== 'ASIG') return false;
  if (l.asigReserva === false) return false; // SIN RESERVA no cuenta
  const qo = Number(l.qtyOpen);
  if (!Number.isFinite(qo) || qo <= 0) return false;
  return true;
}

/**
 * Clasifica si una linea cuenta como BO activa para el reparto.
 * Solo lineas con state='BO' + qtyOpen>0.
 * @param {LineLike} l
 * @returns {boolean}
 */
function isBoActive(l) {
  if (!l || l.state !== 'BO') return false;
  const qo = Number(l.qtyOpen);
  if (!Number.isFinite(qo) || qo <= 0) return false;
  return true;
}

/**
 * Redistribuye ASIG ↔ BO dentro de un pedido para un SKU.
 *
 * @param {Object} params
 * @param {PedidoLike} params.pedido Pedido con lines[].
 * @param {string} params.sku Codigo SKU a redistribuir.
 * @param {number} params.newQty Nuevo total ASIG qty para ese SKU en ese pedido.
 * @param {number} params.stockFisicoLibre Stock fisico libre (dep11 - reservado) para aumentar.
 * @param {AuditInfo} params.audit Info para audit trail.
 * @returns {RepartoResult}
 */
export function redistributeAsigLine({ pedido, sku, newQty, stockFisicoLibre, audit }) {
  // Validacion de inputs.
  const n = Number(newQty);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { ok: false, error: 'newQty debe ser un entero >= 0', delta: 0 };
  }
  if (!pedido || !Array.isArray(pedido.lines)) {
    return { ok: false, error: 'pedido invalido o sin lines[]', delta: 0 };
  }
  const skuNorm = normSku(sku);
  if (!skuNorm) {
    return { ok: false, error: 'sku vacio', delta: 0 };
  }
  const stockLibre = Number(stockFisicoLibre);
  if (!Number.isFinite(stockLibre) || stockLibre < 0) {
    return { ok: false, error: 'stockFisicoLibre invalido', delta: 0 };
  }
  if (!audit || typeof audit.adminEmail !== 'string' || typeof audit.nowIso !== 'string') {
    return { ok: false, error: 'audit.adminEmail + audit.nowIso requeridos', delta: 0 };
  }

  const lines = pedido.lines.map((l) => Object.assign({}, l)); // shallow clone
  // Indexes de lineas afectadas (ASIG y BO del SKU).
  /** @type {Array<number>} */
  const asigIdx = [];
  /** @type {Array<number>} */
  const boIdx = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (lineSku(l) !== skuNorm) continue;
    if (isAsigActive(l)) asigIdx.push(i);
    else if (isBoActive(l)) boIdx.push(i);
  }

  const currentAsig = asigIdx.reduce((acc, i) => acc + (Number(lines[i].qtyOpen) || 0), 0);
  const currentBO = boIdx.reduce((acc, i) => acc + (Number(lines[i].qtyOpen) || 0), 0);
  const delta = n - currentAsig;

  if (Math.abs(delta) < EPSILON) {
    return {
      ok: false,
      error: 'sin cambios (newQty === currentAsig)',
      delta: 0,
      currentAsig,
      currentBO,
    };
  }

  if (asigIdx.length === 0 && delta < 0) {
    return {
      ok: false,
      error: 'no hay linea ASIG activa del SKU en el pedido para reducir',
      delta: 0,
      currentAsig,
      currentBO,
    };
  }

  // CASO 1: reducir ASIG → mover a BO.
  if (delta < 0) {
    const amount = Math.abs(delta);
    // Reducir ASIG desde la primera linea (FIFO por posicion en array).
    let remaining = amount;
    for (const idx of asigIdx) {
      if (remaining <= 0) break;
      const l = lines[idx];
      const q = Number(l.qty) || 0;
      const qo = Number(l.qtyOpen) || 0;
      const take = Math.min(qo, remaining);
      const newQo = qo - take;
      const newQ = Math.max(0, q - take);
      lines[idx] = Object.assign({}, l, {
        qty: newQ,
        qtyOpen: newQo,
        redistributedBy: audit.adminEmail,
        redistributedAt: audit.nowIso,
        redistributedBefore: qo,
        redistributedAfter: newQo,
      });
      if (newQo === 0) {
        // Linea queda vacia → cancellar.
        lines[idx].state = 'cancelled';
        lines[idx].cancelledAt = audit.nowIso;
        lines[idx].cancelledBy = audit.adminEmail;
        lines[idx].cancelReason = 'reparto-admin';
      }
      remaining -= take;
    }
    // Mover a BO: incrementar linea BO existente, o crear nueva.
    if (boIdx.length > 0) {
      const idx = boIdx[0]; // Usamos la primera BO.
      const l = lines[idx];
      const qo = Number(l.qtyOpen) || 0;
      const q = Number(l.qty) || 0;
      lines[idx] = Object.assign({}, l, {
        qty: q + amount,
        qtyOpen: qo + amount,
        redistributedBy: audit.adminEmail,
        redistributedAt: audit.nowIso,
        redistributedBefore: qo,
        redistributedAfter: qo + amount,
      });
    } else {
      // Clonar propiedades base de la linea ASIG original.
      const base = asigIdx.length > 0 ? lines[asigIdx[0]] : null;
      const newBoLine = {
        sku: skuNorm,
        code: skuNorm,
        qty: amount,
        qtyOpen: amount,
        state: 'BO',
        asigReserva: false,
        asigAt: null,
        asigCliTipo: null,
        priceAtCreation: base ? Number(base.priceAtCreation) || 0 : 0,
        recycledIntoPedidoId: null,
        createdFromRedistribution: true,
        redistributedBy: audit.adminEmail,
        redistributedAt: audit.nowIso,
        redistributedBefore: 0,
        redistributedAfter: amount,
      };
      lines.push(newBoLine);
    }
    return {
      ok: true,
      newLines: lines,
      delta,
      currentAsig,
      currentBO,
      from: null,
      usedFromBO: 0,
      usedFromLibre: 0,
    };
  }

  // CASO 2: aumentar ASIG → consumir BO + stock libre.
  const needed = delta;
  const takeFromBo = Math.min(needed, currentBO);
  const takeFromLibre = needed - takeFromBo;
  if (takeFromLibre > stockLibre + EPSILON) {
    return {
      ok: false,
      error:
        'no hay stock libre suficiente para aumentar. Faltan ' +
        (takeFromLibre - stockLibre).toFixed(0) +
        ' unidades (BO del pedido: ' +
        currentBO +
        ', stock libre: ' +
        stockLibre +
        ')',
      delta: 0,
      currentAsig,
      currentBO,
    };
  }

  // Aumentar ASIG: a la primera linea ASIG existente, o crear nueva si no hay.
  if (asigIdx.length > 0) {
    const idx = asigIdx[0];
    const l = lines[idx];
    const qo = Number(l.qtyOpen) || 0;
    const q = Number(l.qty) || 0;
    lines[idx] = Object.assign({}, l, {
      qty: q + needed,
      qtyOpen: qo + needed,
      asigAt: l.asigAt || audit.nowIso, // refresca si estaba sin reserva
      asigReserva: true,
      redistributedBy: audit.adminEmail,
      redistributedAt: audit.nowIso,
      redistributedBefore: qo,
      redistributedAfter: qo + needed,
    });
  } else {
    // No habia ASIG previo → crear nueva linea ASIG.
    // Clonar propiedades base de la linea BO original (si existe).
    const base = boIdx.length > 0 ? lines[boIdx[0]] : null;
    const newAsigLine = {
      sku: skuNorm,
      code: skuNorm,
      qty: needed,
      qtyOpen: needed,
      state: 'ASIG',
      asigReserva: true,
      asigAt: audit.nowIso,
      asigCliTipo: 'reparto-admin',
      priceAtCreation: base ? Number(base.priceAtCreation) || 0 : 0,
      recycledIntoPedidoId: null,
      createdFromRedistribution: true,
      redistributedBy: audit.adminEmail,
      redistributedAt: audit.nowIso,
      redistributedBefore: 0,
      redistributedAfter: needed,
    };
    lines.push(newAsigLine);
  }

  // Reducir BO: consumir desde las lineas BO (FIFO por array position).
  let remaining = takeFromBo;
  for (const idx of boIdx) {
    if (remaining <= 0) break;
    const l = lines[idx];
    const qo = Number(l.qtyOpen) || 0;
    const q = Number(l.qty) || 0;
    const take = Math.min(qo, remaining);
    const newQo = qo - take;
    const newQ = Math.max(0, q - take);
    lines[idx] = Object.assign({}, l, {
      qty: newQ,
      qtyOpen: newQo,
      redistributedBy: audit.adminEmail,
      redistributedAt: audit.nowIso,
      redistributedBefore: qo,
      redistributedAfter: newQo,
    });
    if (newQo === 0) {
      lines[idx].state = 'cancelled';
      lines[idx].cancelledAt = audit.nowIso;
      lines[idx].cancelledBy = audit.adminEmail;
      lines[idx].cancelReason = 'reparto-admin-absorbed';
    }
    remaining -= take;
  }

  /** @type {'BO'|'LIBRE'|'MIXED'|null} */
  let from = null;
  if (takeFromBo > 0 && takeFromLibre > 0) from = 'MIXED';
  else if (takeFromBo > 0) from = 'BO';
  else if (takeFromLibre > 0) from = 'LIBRE';

  return {
    ok: true,
    newLines: lines,
    delta,
    currentAsig,
    currentBO,
    from,
    usedFromBO: takeFromBo,
    usedFromLibre: takeFromLibre,
  };
}
