// @ts-check
/**
 * v1526 (2026-10-29) — Filas del Excel "Exportar pedido" del modal Pedido en espera.
 *
 * Problema que arregla: el export viejo ("Exportar pedido para enviar al
 * cliente") capeaba cada fila por el stock libre GENERAL, que resta tambien
 * la reserva del propio cliente. Las lineas STOCK ASIGNADO del cliente daban
 * libre 0 y se omitian. Caso REBORN ORDEN 632: modal $7.021.000 (23 prod),
 * Excel $2.453.000 (13 prod).
 *
 * Ahora hay 3 variantes que particionan la orden (asignado + original = completo):
 * - 'asignado': solo lineas con origen='stock-asignado' (badge STOCK ASIGNADO).
 * - 'original': todas las lineas que NO son STOCK ASIGNADO.
 * - 'completo': todas las lineas.
 * Cantidad = la pedida (it.qty), precio = el mismo del modal (getPrice).
 * Asi el total de 'completo' coincide con "Total pedido" del modal.
 */

/** @typedef {'asignado'|'original'|'completo'} WaitlistExportMode */

/**
 * @typedef {Object} WaitlistExportRow
 * @property {string} code
 * @property {string} desc
 * @property {number} qty
 * @property {number} precio
 * @property {number} subtotal
 * @property {boolean} stockAsignado
 */

/**
 * @param {any} it
 * @returns {boolean}
 */
export function isStockAsignadoItem(it) {
  return !!it && it.origen === 'stock-asignado';
}

/**
 * Arma las filas del Excel para una variante.
 * @param {any[]} items  w.items de la orden en espera.
 * @param {WaitlistExportMode} mode
 * @param {(code: string) => number} getPrice  mismo precio que usa el modal.
 * @returns {{rows: WaitlistExportRow[], total: number, unidades: number}}
 */
export function buildWaitlistExportRows(items, mode, getPrice) {
  /** @type {WaitlistExportRow[]} */
  const rows = [];
  let total = 0;
  let unidades = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !it.code) continue;
    const qty = Number(it.qty) || 0;
    if (qty <= 0) continue;
    const asig = isStockAsignadoItem(it);
    if (mode === 'asignado' && !asig) continue;
    if (mode === 'original' && asig) continue;
    const precio = Number(typeof getPrice === 'function' ? getPrice(it.code) : 0) || 0;
    const subtotal = qty * precio;
    total += subtotal;
    unidades += qty;
    rows.push({
      code: String(it.code),
      desc: String(it.desc || ''),
      qty,
      precio,
      subtotal,
      stockAsignado: asig,
    });
  }
  return { rows, total, unidades };
}
