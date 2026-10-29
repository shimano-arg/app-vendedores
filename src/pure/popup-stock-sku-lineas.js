// @ts-check
/**
 * v1520 (2026-10-29) — Popup "Stock del SKU" líneas visibles.
 *
 * Problema que arregla: §40.11 (v1403) simplificó el popup a 5 líneas y
 * sacó "Confirmadas sin facturar". Pero `libre = físico − asig − conf`
 * (§40.2 cap por físico), entonces la cuenta no cerraba a ojo cuando había
 * confirmed > 0. Caso TRX301B 29/10 09:04: físico 16, asig 7, libre 2 —
 * faltaban las 7u de ORDEN 419 (IUALE 1u) + ORDEN 615 (PESCAR.INFO 6u).
 *
 * Regla fuerte: el popup muestra TODO lo que resta hasta llegar a Libre.
 * La última línea es la fórmula explícita. Nada de restar algo que no
 * esté en la lista.
 */

/**
 * @typedef {Object} StockLineaPopup
 * @property {string} label
 * @property {number} qty
 * @property {string|null} nota  Texto entre paréntesis o null.
 * @property {boolean} entraEnCuenta  true si suma/resta en la fórmula de Libre.
 */

/**
 * @typedef {Object} PopupStockSkuRender
 * @property {StockLineaPopup[]} lineas
 * @property {string} formula  "Cuenta: 16 físico − 7 asignados − 7 confirmados sin facturar = 2"
 */

/**
 * Devuelve las líneas visibles del popup "Stock del SKU" + la fórmula que
 * cierra la cuenta. Se construye SOLO desde `getStockBreakdown` (§39).
 *
 * Orden fijo:
 * 1. Stock físico (dep 11)                     — base de la cuenta
 * 2. En tránsito (dep 12)                      — informativo, no entra
 * 3. En back order                             — informativo si > 0, no reserva (§40)
 * 4. Pedidos asignados                         — reserva, resta
 * 5. Pedidos confirmados sin facturar          — reserva, resta
 * 6. Libre para la venta                       — resultado
 * + fórmula "Cuenta: F físico − A asignados − C confirmados sin facturar = L"
 *
 * @param {import('./stock-breakdown.js').StockBreakdown} breakdown
 * @returns {PopupStockSkuRender}
 */
export function buildPopupStockSkuLineas(breakdown) {
  const b = breakdown;
  const fisico = Number(b.fisicoDep11) || 0;
  const transito = Number(b.transitoDep12) || 0;
  const bo = Number((b.backorderApp && b.backorderApp.total) || 0);
  const asig = Number((b.asignadas && b.asignadas.total) || 0);
  const conf = Number((b.confirmadasSinFacturar && b.confirmadasSinFacturar.total) || 0);
  const libre = Number(b.libre) || 0;

  /** @type {StockLineaPopup[]} */
  const lineas = [
    { label: 'Stock físico (dep 11)', qty: fisico, nota: null, entraEnCuenta: true },
    {
      label: 'En tránsito (dep 12)',
      qty: transito,
      nota: 'todavía no es vendible',
      entraEnCuenta: false,
    },
  ];
  if (bo > 0) {
    lineas.push({
      label: 'En back order',
      qty: bo,
      nota: 'todavía no toca stock',
      entraEnCuenta: false,
    });
  }
  lineas.push({
    label: 'Pedidos asignados',
    qty: asig,
    nota: 'reservan stock',
    entraEnCuenta: true,
  });
  lineas.push({
    label: 'Pedidos confirmados sin facturar',
    qty: conf,
    nota: 'reservan stock',
    entraEnCuenta: true,
  });
  lineas.push({
    label: 'Libre para la venta',
    qty: libre,
    nota: null,
    entraEnCuenta: true,
  });

  const formula =
    'Cuenta: ' +
    fisico +
    ' físico − ' +
    asig +
    ' asignados − ' +
    conf +
    ' confirmados sin facturar = ' +
    libre;

  return { lineas, formula };
}

/**
 * Serializa las líneas al formato texto plano del `alert()` del popup.
 *
 * @param {import('./stock-breakdown.js').StockBreakdown} breakdown
 * @returns {string}
 */
export function renderPopupStockSkuPlainText(breakdown) {
  const { lineas, formula } = buildPopupStockSkuLineas(breakdown);
  const body = lineas
    .map((l) => {
      let s = l.label + ': ' + l.qty + ' unidades';
      if (l.nota) s += ' (' + l.nota + ')';
      return s;
    })
    .join('\n');
  return body + '\n\n' + formula;
}
