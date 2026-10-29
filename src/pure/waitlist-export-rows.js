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
 * Precio = el mismo del modal (getPrice). v1530: el total suma solo lo que
 * tiene stock (= "Subtotal del pedido (Con Stock)" del modal); lo que queda
 * en back order va en filas rojas que no suman.
 */

/** @typedef {'asignado'|'original'|'completo'} WaitlistExportMode */

/**
 * @typedef {Object} WaitlistExportRow
 * @property {string} code
 * @property {string} desc
 * @property {number} qty        unidades CON stock (las que suman).
 * @property {number} precio
 * @property {number} subtotal   qty * precio (suma al total).
 * @property {boolean} stockAsignado
 * @property {boolean} sinStock  true = fila roja de back order (no suma).
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
 *
 * v1530: con `getQtyConStock` el producto se parte en una fila normal (lo que
 * tiene stock, suma al total) y una fila sinStock (lo que queda en back order,
 * no suma). `getQtyConStock(indice)` recibe el indice del item en `items` y
 * devuelve las unidades con stock que calculo el modal (null = sin dato, todo
 * suma como antes).
 *
 * @param {any[]} items  w.items de la orden en espera.
 * @param {WaitlistExportMode} mode
 * @param {(code: string) => number} getPrice  mismo precio que usa el modal.
 * @param {(index: number) => (number|null|undefined)} [getQtyConStock]
 * @returns {{rows: WaitlistExportRow[], total: number, unidades: number,
 *   totalSinStock: number, unidadesSinStock: number, productos: number}}
 */
export function buildWaitlistExportRows(items, mode, getPrice, getQtyConStock) {
  /** @type {WaitlistExportRow[]} */
  const rows = [];
  let total = 0;
  let unidades = 0;
  let totalSinStock = 0;
  let unidadesSinStock = 0;
  let productos = 0;
  const lista = Array.isArray(items) ? items : [];
  for (let i = 0; i < lista.length; i++) {
    const it = lista[i];
    if (!it || !it.code) continue;
    const qty = Number(it.qty) || 0;
    if (qty <= 0) continue;
    const asig = isStockAsignadoItem(it);
    if (mode === 'asignado' && !asig) continue;
    if (mode === 'original' && asig) continue;
    const precio = Number(typeof getPrice === 'function' ? getPrice(it.code) : 0) || 0;
    const raw = typeof getQtyConStock === 'function' ? getQtyConStock(i) : null;
    const conStock =
      raw === null || raw === undefined || !Number.isFinite(Number(raw))
        ? qty
        : Math.min(qty, Math.max(0, Math.floor(Number(raw))));
    const sinStock = qty - conStock;
    const base = { code: String(it.code), desc: String(it.desc || ''), precio, stockAsignado: asig };
    productos++;
    if (conStock > 0) {
      total += conStock * precio;
      unidades += conStock;
      rows.push({ ...base, qty: conStock, subtotal: conStock * precio, sinStock: false });
    }
    if (sinStock > 0) {
      totalSinStock += sinStock * precio;
      unidadesSinStock += sinStock;
      rows.push({ ...base, qty: sinStock, subtotal: sinStock * precio, sinStock: true });
    }
  }
  return { rows, total, unidades, totalSinStock, unidadesSinStock, productos };
}
