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
 * @typedef {Object} AsigRef
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {number} qtyAsignada
 * @property {string} [sku]
 *
 * @typedef {Object} Line
 * @property {string} code
 * @property {number} [qty]
 * @property {number} [importedFromOrder]
 * @property {'stock-asignado'} [origen]  v1382: identidad ASIG por linea
 * @property {Array<AsigRef>} [asigRefs]  v1382: refs a ASIG original(es)
 *
 * @typedef {Object} OtherOrder
 * @property {number} orderNumber
 * @property {string} [pedidoId]
 * @property {string} [source]  v1382: 'stock-asignado-batch' si es CPST absorbido
 * @property {Array<AsigRef>} [pedidosOrigenes]  v1382: shape {pedidoId, lineIndex, sku, qtyAsignada}
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
  return String(code || '')
    .toUpperCase()
    .trim();
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
 * Devuelve las AsigRefs que respaldan un SKU dado desde el pedidosOrigenes[]
 * de un CPST absorbido. Match case-insensitive por sku.
 *
 * v1382: una linea importada de un CPST puede estar respaldada por N refs
 * (ej: Pablo asigno 2u desde pedido A + 1u desde pedido B). Devolver todas.
 *
 * @param {string} code
 * @param {Array<AsigRef>|undefined} pedidosOrigenes
 * @returns {Array<AsigRef>}
 */
/**
 * E9 §stock-servidor-atomico (v1433) — union dedup de asigRefs para fix G2.03
 * chained merge. Cuando Z absorbe Y que ya absorbió X, los asigRefs de X
 * viven persistidos en Y.lines[].asigRefs; el pedidosOrigenes de Y puede
 * estar pisado o faltante. UNION resuelve.
 *
 * Dedupe por (pedidoId, lineIndex). Si ambos sets tienen la misma ref,
 * se queda con el qtyAsignada MAYOR (defensivo).
 *
 * @param {Array<AsigRef>} refsA
 * @param {Array<AsigRef>} refsB
 * @returns {Array<AsigRef>}
 */
export function unionAsigRefsDedup(refsA, refsB) {
  /** @type {Map<string, AsigRef>} */
  const seen = new Map();
  const all = [...(Array.isArray(refsA) ? refsA : []), ...(Array.isArray(refsB) ? refsB : [])];
  for (const r of all) {
    if (!r || !r.pedidoId) continue;
    const li = Number(r.lineIndex);
    if (!Number.isFinite(li)) continue;
    const key = r.pedidoId + '|' + li;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, {
        pedidoId: r.pedidoId,
        lineIndex: li,
        qtyAsignada: Number(r.qtyAsignada) || 0,
        sku: r.sku,
      });
    } else {
      // Dedupe: keep max qtyAsignada.
      const q = Number(r.qtyAsignada) || 0;
      if (q > (Number(existing.qtyAsignada) || 0)) {
        existing.qtyAsignada = q;
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * @param {string} code
 * @param {Array<AsigRef>|undefined} pedidosOrigenes
 * @returns {Array<AsigRef>}
 */
export function buildAsigRefsForLine(code, pedidosOrigenes) {
  if (!Array.isArray(pedidosOrigenes) || pedidosOrigenes.length === 0) return [];
  const target = normCode(code);
  const refs = [];
  for (const o of pedidosOrigenes) {
    if (!o || !o.sku) continue;
    if (normCode(o.sku) !== target) continue;
    refs.push({
      pedidoId: o.pedidoId,
      lineIndex: Number(o.lineIndex),
      qtyAsignada: Number(o.qtyAsignada) || 0,
      sku: o.sku,
    });
  }
  return refs;
}

/**
 * Merge lines de órdenes viejas dentro de las de la nueva. Las importadas
 * quedan con flag `importedFromOrder: <orderNumber>`.
 *
 * v1382: si la orden absorbida es un CPST (source='stock-asignado-batch' o
 * pedidosOrigenes[] populated), cada línea importada tambien recibe:
 *   - origen: 'stock-asignado'
 *   - asigRefs: refs a las ASIG originales (match por sku dentro de pedidosOrigenes)
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
  // Copia defensiva de baseLines (preserva campos existentes, incl. origen/asigRefs
  // si la base ya los tenía — ej. orden base es CPST actualizada).
  const mergedLines = baseLines.map((l) => ({ ...l }));
  if (Array.isArray(otherOrders)) {
    for (const order of otherOrders) {
      if (!order || !Array.isArray(order.lines)) continue;
      const isCpst =
        order.source === 'stock-asignado-batch' ||
        (Array.isArray(order.pedidosOrigenes) && order.pedidosOrigenes.length > 0);
      for (const line of order.lines) {
        if (!line) continue;
        const newLine = { ...line, importedFromOrder: order.orderNumber };
        // E9 §stock-servidor-atomico (v1433): fix G2.03 chained merge.
        // Bug: cuando Z absorbe Y, y Y antes había absorbido X con
        // asigRefs persistidos en Y.lines[k].asigRefs, el merge solo leía
        // order.pedidosOrigenes (potencialmente pisado por un merge
        // intermedio) y descartaba los asigRefs persistidos en la línea.
        //
        // Fix: UNION de refs de pedidosOrigenes + line.asigRefs ya
        // persistidos. Dedupe por (pedidoId, lineIndex).
        const refsFromOrigenes = isCpst
          ? buildAsigRefsForLine(line.code, order.pedidosOrigenes)
          : [];
        const refsFromLine = Array.isArray(line.asigRefs) ? line.asigRefs : [];
        const refs = unionAsigRefsDedup(refsFromOrigenes, refsFromLine);
        if (refs.length > 0) {
          newLine.origen = 'stock-asignado';
          newLine.asigRefs = refs;
        }
        mergedLines.push(newLine);
      }
    }
  }
  const duplicateCodes = computeDuplicateCodes(mergedLines);
  return { mergedLines, duplicateCodes };
}

/**
 * Devuelve la clase CSS que corresponde a la fila según su rol en el merge.
 *
 * v1382: nuevas clases para líneas con `origen='stock-asignado'`:
 *   - 'reservado-imported' (importada, no duplicada): azul + badge
 *   - 'duplicate-reservado' (importada + duplicada): azul + badge, la otra
 *     fila original queda 'duplicate-original' (rojo)
 *
 * @param {Line|null} line
 * @param {Set<string>|null} duplicateCodes
 * @returns {'imported' | 'duplicate-original' | 'duplicate-imported' | 'reservado-imported' | 'duplicate-reservado' | null}
 */
export function getRowColorClass(line, duplicateCodes) {
  if (!line) return null;
  const isImported = line.importedFromOrder != null;
  const isReservado = line.origen === 'stock-asignado';
  const isDuplicate =
    duplicateCodes instanceof Set ? duplicateCodes.has(normCode(line.code)) : false;
  // v1382: una linea reservada SOLO se marca con la clase reservado si viene
  // importada (importedFromOrder != null). Si origen='stock-asignado' pero
  // es parte de la base (no importada), es un CPST original — ya se renderiza
  // con su propio tratamiento visual en el modal; getRowColorClass no cambia.
  if (isReservado && isImported) {
    return isDuplicate ? 'duplicate-reservado' : 'reservado-imported';
  }
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
