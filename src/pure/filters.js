// @ts-check
/**
 * Filtros del sidebar CLIENTES. Extracted de index.html:3658 para E4.
 *
 * passesTypeFilter decide si un cliente pasa el filtro actual del tab
 * (ALL / VENTAS_ESPECIALES / DISTRIBUIDORES / EXISTENTES / PROSPECTOS).
 * DISTRIBUIDORES y EXISTENTES/PROSPECTOS se manejan afuera; acá solo
 * cubrimos VENTAS_ESPECIALES (por nombre).
 *
 * REFACTOR para testeabilidad: recibe currentFilter y specialSalesSet
 * como params (antes globales).
 */
import { normClientName } from './normalize.js';

/**
 * @param {string} clientName
 * @param {'ALL'|'VENTAS_ESPECIALES'|'DISTRIBUIDORES'|'EXISTENTES'|'PROSPECTOS'|string} currentFilter
 * @param {Set<string>} specialSalesSet Set de nombres normalizados marcados como ventas especiales.
 * @returns {boolean}
 */
export function passesTypeFilter(clientName, currentFilter, specialSalesSet) {
  if (currentFilter === 'ALL') return true;
  if (currentFilter === 'VENTAS_ESPECIALES') {
    return specialSalesSet instanceof Set && specialSalesSet.has(normClientName(clientName));
  }
  // DISTRIBUIDORES se maneja a nivel localidad. EXISTENTES/PROSPECTOS a nivel array.
  return true;
}
