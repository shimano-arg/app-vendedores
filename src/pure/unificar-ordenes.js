// @ts-check
/**
 * unificar-ordenes.js (v1284, 2026-10-20)
 *
 * Puras para unificar órdenes de la lista de espera (`revision_waitlist`).
 * Spec: docs/superpowers/specs/2026-10-20-unificar-ordenes-waitlist-design.md
 *
 * Flow: cuando el VDE click "Unificar orden" en el modal "Pedido en espera" de
 * la orden más nueva (ej. 460), estas puras combinan sus items con los de
 * las otras órdenes del mismo cliente en lista de espera. Las líneas
 * importadas quedan marcadas con `line.importedFromOrder: <orderNumber>` para
 * que la UI las pinte en amarillo (`#d97706`). Si un SKU se duplica, ambas
 * filas quedan y la UI las pinta en rojo (original) + amarillo (importada).
 */

/**
 * @typedef {Object} Line
 * @property {string} code
 * @property {number} [qty]
 * @property {number} [importedFromOrder]
 *
 * @typedef {Object} OtherOrder
 * @property {number} orderNumber
 * @property {string} [pedidoId]
 * @property {Array<Line>} lines
 *
 * @typedef {Object} MergeResult
 * @property {Array<Line>} mergedLines
 * @property {Set<string>} duplicateCodes
 */

/**
 * Normaliza un code a MAYÚSCULA + trim para comparar SKUs.
 * @param {string} code
 * @returns {string}
 */
function normCode(code) {
  return String(code || '').toUpperCase().trim();
}

/**
 * Devuelve el Set de codes que aparecen 2+ veces en el array de lines.
 * Case-insensitive (normaliza a MAYÚSCULA).
 *
 * @param {Array<Line>} lines
 * @returns {Set<string>}
 */
export function computeDuplicateCodes(lines) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  if (!Array.isArray(lines)) return new Set();
  for (const line of lines) {
    if (!line || !line.code) continue;
    const key = normCode(line.code);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicates = new Set();
  for (const [key, count] of counts) {
    if (count > 1) duplicates.add(key);
  }
  return duplicates;
}

/**
 * Merge lines de órdenes viejas dentro de las de la nueva. Las importadas
 * quedan con flag `importedFromOrder: <orderNumber>`.
 *
 * No muta inputs. Devuelve nuevo array + Set de codes duplicados.
 *
 * @param {Array<Line>} baseLines - lines del pedido más nueva (actual)
 * @param {Array<OtherOrder>} otherOrders - órdenes viejas a absorber
 * @returns {MergeResult}
 */
export function mergeLinesFromOrders(baseLines, otherOrders) {
  if (!Array.isArray(baseLines)) {
    return { mergedLines: [], duplicateCodes: new Set() };
  }
  // Copia defensiva de baseLines (sin flag importedFromOrder).
  const mergedLines = baseLines.map((l) => ({ ...l }));
  if (Array.isArray(otherOrders)) {
    for (const order of otherOrders) {
      if (!order || !Array.isArray(order.lines)) continue;
      for (const line of order.lines) {
        if (!line) continue;
        mergedLines.push({ ...line, importedFromOrder: order.orderNumber });
      }
    }
  }
  const duplicateCodes = computeDuplicateCodes(mergedLines);
  return { mergedLines, duplicateCodes };
}

/**
 * Devuelve la clase CSS que corresponde a la fila según su rol en el merge.
 *
 * @param {Line|null} line
 * @param {Set<string>|null} duplicateCodes
 * @returns {'imported' | 'duplicate-original' | 'duplicate-imported' | null}
 */
export function getRowColorClass(line, duplicateCodes) {
  if (!line) return null;
  const isImported = line.importedFromOrder != null;
  const isDuplicate = duplicateCodes instanceof Set
    ? duplicateCodes.has(normCode(line.code))
    : false;
  if (isDuplicate && isImported) return 'duplicate-imported';
  if (isDuplicate && !isImported) return 'duplicate-original';
  if (!isDuplicate && isImported) return 'imported';
  return null;
}

/**
 * Build audit trail para `unifiedFrom[]` del pedido nuevo. Un entry por
 * orden absorbida.
 *
 * @param {Array<OtherOrder>} otherOrders
 * @param {string} userEmail
 * @param {string} nowIso
 * @returns {Array<{orderNumber: number, pedidoId: string|undefined, mergedAt: string, mergedBy: string, lineCount: number}>}
 */
export function buildUnifiedFromAudit(otherOrders, userEmail, nowIso) {
  if (!Array.isArray(otherOrders)) return [];
  return otherOrders.map((order) => ({
    orderNumber: order.orderNumber,
    pedidoId: order.pedidoId,
    mergedAt: nowIso,
    mergedBy: userEmail,
    lineCount: Array.isArray(order.lines) ? order.lines.length : 0,
  }));
}
