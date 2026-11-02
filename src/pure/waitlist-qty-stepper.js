// @ts-check
/**
 * waitlist-qty-stepper.js (v1538, 2026-11-02, APP-03)
 *
 * Cálculo de la cantidad de la columna "Pedido original" del modal
 * "Pedido en espera" cuando se usa el control [−] [n] [+] (mismo control
 * visual `.qty-stepper` de Crear pedido manual).
 *
 * Reglas (las mismas que ya aplicaba waitlistUpdateItemQty):
 *   - La cantidad mínima es 1 (para quitar el producto se usa la X).
 *   - Solo enteros.
 */

/**
 * Cantidad nueva al tocar (+) o (−).
 * @param {any} current - cantidad actual (número o texto del input).
 * @param {number} delta - +1 o -1.
 * @returns {number} entero >= 1.
 */
export function nextWaitlistQty(current, delta) {
  const base = Math.floor(Number(current));
  const safeBase = Number.isFinite(base) && base >= 1 ? base : 1;
  const next = safeBase + (Math.trunc(Number(delta)) || 0);
  return next < 1 ? 1 : next;
}

/**
 * Cantidad tipeada en el número central. Devuelve 0 si es inválida
 * (vacío, letras, negativo, decimal): waitlistUpdateItemQty la rechaza con
 * el aviso de siempre y vuelve al valor anterior.
 * @param {any} raw
 * @returns {number}
 */
export function parseWaitlistQtyInput(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!/^\d+$/.test(s)) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? n : 0;
}

/**
 * ¿El botón (−) va deshabilitado? Con cantidad 1 no se puede bajar más.
 * @param {any} qty
 * @returns {boolean}
 */
export function isWaitlistQtyMinusDisabled(qty) {
  const n = Math.floor(Number(qty));
  return !Number.isFinite(n) || n <= 1;
}
