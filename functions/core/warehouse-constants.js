/**
 * Mirror server-side de src/pure/warehouse-constants.js (§57).
 *
 * Mantener byte-equivalent con el pure del cliente (post header). Si cambiás
 * uno, cambiá el otro + corré tests/unit/audit/warehouse-constants-sync.test.js.
 */

/** @type {11} */
export const DEP_FISICO = 11;

/** @type {12} */
export const DEP_TRANSITO = 12;

/** Depósitos cuyo stock cuenta como "asignable por la app" (físico + tránsito). */
export const WAREHOUSES_ASIGNABLES = Object.freeze([DEP_FISICO, DEP_TRANSITO]);

/** Depósitos que NO cuentan para reparto ni venta directa (contabilidad/consignación/etc). */
export const WAREHOUSES_NO_ASIGNABLES = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 10, 20, 21, 22, 23, 96, 97, 98, 99,
]);

/** Keys string del warehouseBreakdown JSON (el sync Python serializa como strings). */
export const WAREHOUSE_KEY_FISICO = String(DEP_FISICO);
export const WAREHOUSE_KEY_TRANSITO = String(DEP_TRANSITO);

/**
 * Extrae `qty` de un `warehouseBreakdown` del snapshot para un depósito dado.
 *
 * Soporta las 3 formas que puede venir el breakdown (JSON string parseada, dict,
 * o campo específico ya resuelto). Tolera null/undefined → 0.
 *
 * @param {Record<string, number> | null | undefined} whsBreakdown
 * @param {11 | 12 | number} depNumber
 * @returns {number}
 */
export function getQtyFromBreakdown(whsBreakdown, depNumber) {
  if (!whsBreakdown || typeof whsBreakdown !== 'object') return 0;
  const key = String(depNumber);
  const v = whsBreakdown[key];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
