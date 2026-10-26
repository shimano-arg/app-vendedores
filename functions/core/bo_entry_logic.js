// @ts-check
/**
 * Tarea L (v1457, 2026-10-25) — ESPEJO de `src/pure/bo_entry_logic.js`.
 *
 * CLAUDE.md §57: lógica compartida cliente+servidor vive una sola vez en
 * `src/pure/<name>.js` con copia espejo en `functions/core/<name>.js` y
 * test de sincronía `tests/unit/audit/<name>-sync.test.js` que falla si
 * los dos archivos divergen.
 *
 * NO EDITAR SIN REPLICAR EL CAMBIO EN `src/pure/bo_entry_logic.js`.
 */

/**
 * @typedef {Object} BoVigenteItem
 * @property {string} sku
 * @property {number} cantidad
 * @property {string} [fechaIso]
 * @property {number} [orderNumber]
 */

/**
 * @typedef {Object} CargaItem
 * @property {string} code SKU que el vendedor cargó.
 * @property {number} qty Cantidad nueva.
 * @property {string} [origen] 'stock-asignado' | ...
 * @property {number} [qtyAsignadaPrevia] Si origen='stock-asignado', piso ASIG.
 */

/**
 * @typedef {Object} BoEntryRow
 * @property {string} sku
 * @property {number} cantidadNueva Lo que el vendedor cargó.
 * @property {number} cantidadBoPrevia Suma del BO vigente del cliente+SKU.
 * @property {string | null} fechaBoPrevio ISO del BO más viejo.
 * @property {number} piso Unidades ASIG previas (preserva §40). Default 0.
 * @property {'same' | 'additional' | null} resolved
 * @property {number} resolvedQty Cantidad final tras resolver. Siempre >= piso.
 */

/**
 * Compute "filas rojas". Idempotente, pure.
 *
 * @param {Object} args
 * @param {Array<CargaItem>} args.items Lo que el vendedor cargó (manual, Excel, CPST).
 * @param {Array<BoVigenteItem>} args.boVigente BO del cliente — pre-filtrado por caller.
 * @param {string} [args.clienteCardCode] Solo para log/debug.
 * @returns {Array<BoEntryRow>}
 */
export function computeBoEntryRows(args) {
  if (!args || typeof args !== 'object') return [];
  const items = Array.isArray(args.items) ? args.items : [];
  const boVigente = Array.isArray(args.boVigente) ? args.boVigente : [];
  if (items.length === 0 || boVigente.length === 0) return [];

  // Agrupar BO por SKU normalizado + sumar cantidad + encontrar fecha más vieja.
  /** @type {Map<string, {cantidad: number, fechaMinIso: string | null}>} */
  const boBySku = new Map();
  for (const b of boVigente) {
    if (!b || !b.sku) continue;
    const key = String(b.sku).toLowerCase();
    const cant = Number(b.cantidad) || 0;
    if (cant <= 0) continue;
    const prev = boBySku.get(key);
    const fechaIso = b.fechaIso || null;
    if (!prev) {
      boBySku.set(key, { cantidad: cant, fechaMinIso: fechaIso });
    } else {
      prev.cantidad += cant;
      if (fechaIso && (!prev.fechaMinIso || fechaIso < prev.fechaMinIso)) {
        prev.fechaMinIso = fechaIso;
      }
    }
  }
  if (boBySku.size === 0) return [];

  const out = [];
  /** @type {Map<string, {qty: number, piso: number}>} */
  const itemsBySku = new Map();
  for (const it of items) {
    if (!it || !it.code) continue;
    const key = String(it.code).toLowerCase();
    const qty = Number(it.qty) || 0;
    if (qty <= 0) continue;
    const piso = Number(it.qtyAsignadaPrevia) || 0;
    const prev = itemsBySku.get(key);
    if (!prev) {
      itemsBySku.set(key, { qty, piso });
    } else {
      prev.qty += qty;
      prev.piso = Math.max(prev.piso, piso);
    }
  }

  for (const [key, { qty, piso }] of itemsBySku) {
    const bo = boBySku.get(key);
    if (!bo) continue;
    out.push({
      sku: key,
      cantidadNueva: qty,
      cantidadBoPrevia: bo.cantidad,
      fechaBoPrevio: bo.fechaMinIso,
      piso,
      resolved: /** @type {'same' | 'additional' | null} */ (null),
      resolvedQty: qty,
    });
  }
  out.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  return out;
}

/**
 * Resuelve una fila roja. Pure — devuelve una nueva row con `resolved` seteado.
 * Reglas:
 *   - 'same': resolvedQty = max(cantidadNueva, piso).
 *   - 'additional': resolvedQty = max(cantidadBoPrevia + cantidadNueva, piso).
 *
 * @param {BoEntryRow} row
 * @param {'same' | 'additional'} choice
 * @returns {BoEntryRow}
 */
export function setBoEntryRowResolution(row, choice) {
  if (!row || typeof row !== 'object') return row;
  if (choice !== 'same' && choice !== 'additional') return row;
  const piso = Number(row.piso) || 0;
  const nueva = Number(row.cantidadNueva) || 0;
  const previa = Number(row.cantidadBoPrevia) || 0;
  let resolvedQty;
  if (choice === 'same') {
    resolvedQty = Math.max(nueva, piso);
  } else {
    resolvedQty = Math.max(nueva + previa, piso);
  }
  return {
    sku: row.sku,
    cantidadNueva: nueva,
    cantidadBoPrevia: previa,
    fechaBoPrevio: row.fechaBoPrevio || null,
    piso,
    resolved: choice,
    resolvedQty,
  };
}

/**
 * Chequeo bulk: ¿quedan filas sin resolver?
 * @param {Array<BoEntryRow>} rows
 * @returns {Array<BoEntryRow>} Las que todavía tienen resolved===null.
 */
export function unresolvedBoEntryRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && r.resolved === null);
}

/**
 * ¿El Excel cargado es idéntico a la orden abierta pasada?
 *
 * @param {Object} args
 * @param {Array<CargaItem>} args.items
 * @param {Object} args.openOrder {_id, orderNumber, items: [{code, qty}], createdAt}
 * @returns {{identical: boolean, openOrderNumber?: number, fechaCargaOpenOrder?: string}}
 */
export function isExcelIdenticalToOpenOrder(args) {
  if (!args || !args.items || !args.openOrder) return { identical: false };
  const items = Array.isArray(args.items) ? args.items : [];
  const openItems = Array.isArray(args.openOrder.items) ? args.openOrder.items : [];
  if (items.length === 0 || openItems.length === 0) return { identical: false };

  /** @param {Array<any>} arr @returns {Map<string, number>} */
  const toMap = (arr) => {
    /** @type {Map<string, number>} */
    const m = new Map();
    for (const it of arr) {
      if (!it) continue;
      const code = String(it.code || it.sku || '').toLowerCase().trim();
      if (!code) continue;
      const qty = Number(it.qty) || 0;
      if (qty <= 0) continue;
      m.set(code, (m.get(code) || 0) + qty);
    }
    return m;
  };
  const a = toMap(items);
  const b = toMap(openItems);
  if (a.size !== b.size) return { identical: false };
  for (const [k, v] of a) {
    if (!b.has(k)) return { identical: false };
    if (b.get(k) !== v) return { identical: false };
  }
  let fechaCargaOpenOrder;
  const t = args.openOrder.createdAt;
  if (t) {
    if (typeof t === 'string') fechaCargaOpenOrder = t;
    else if (typeof t.toDate === 'function') {
      try {
        fechaCargaOpenOrder = t.toDate().toISOString();
      } catch (_e) {
        /* noop */
      }
    } else if (typeof t.toMillis === 'function') {
      try {
        fechaCargaOpenOrder = new Date(t.toMillis()).toISOString();
      } catch (_e) {
        /* noop */
      }
    } else if (t instanceof Date) {
      fechaCargaOpenOrder = t.toISOString();
    }
  }
  return {
    identical: true,
    openOrderNumber: Number(args.openOrder.orderNumber) || undefined,
    fechaCargaOpenOrder,
  };
}

/**
 * ¿Alguna de las órdenes abiertas pasadas es idéntica al Excel?
 *
 * @param {Object} args
 * @param {Array<CargaItem>} args.items
 * @param {Array<Object>} args.openOrders
 * @returns {{identical: boolean, openOrderNumber?: number, fechaCargaOpenOrder?: string, openOrderId?: string}}
 */
export function findIdenticalOpenOrder(args) {
  if (!args || !args.items) return { identical: false };
  const openOrders = Array.isArray(args.openOrders) ? args.openOrders : [];
  if (openOrders.length === 0) return { identical: false };
  for (const o of openOrders) {
    const r = isExcelIdenticalToOpenOrder({ items: args.items, openOrder: o });
    if (r.identical) {
      return Object.assign({}, r, { openOrderId: o && o._id ? String(o._id) : undefined });
    }
  }
  return { identical: false };
}
