// @ts-check
/**
 * unificar-ordenes.js (v1435, 2026-10-24)
 *
 * Puras para unificar órdenes de la lista de espera (`revision_waitlist`).
 *
 * v1435 §56 (2026-10-24): regla fuerte "un SKU una sola vez por orden".
 * `mergeLinesFromOrders` ahora FUSIONA por SKU en vez de concatenar:
 *   - Suma qty.
 *   - Conserva origen='stock-asignado' si alguna línea lo tenía.
 *   - Union de asigRefs con dedupe por (pedidoId, lineIndex).
 *   - Precio igual: mantiene; distinto: usa precio actual + registra
 *     precioAnterior1/precioAnterior2/precioOrigen.
 *   - Campo mergedFrom[] para audit.
 * El badge "DUPLICADO" y la clase `merge-duplicate-*` fueron eliminados: ya
 * nunca hay SKU duplicado por construcción, el único duplicado posible era
 * de datos legacy pre-§56. getRowColorClass ahora devuelve solo
 * 'imported' / 'reservado-imported' / null.
 */

/**
 * @typedef {Object} AsigRef
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {number} qtyAsignada
 * @property {string} [sku]
 *
 * @typedef {Object} MergedFromEntry
 * @property {number} orden     orderNumber de la orden absorbida (0 = creación)
 * @property {number} qty       qty aportada
 * @property {number} [precio]
 *
 * @typedef {Object} Line
 * @property {string} code
 * @property {number} [qty]
 * @property {number} [importedFromOrder]
 * @property {'stock-asignado'} [origen]  v1382: identidad ASIG por linea
 * @property {Array<AsigRef>} [asigRefs]  v1382: refs a ASIG original(es)
 * @property {number} [precio]
 * @property {number} [precioAnterior1]   v1435 §56
 * @property {number} [precioAnterior2]   v1435 §56
 * @property {string} [precioOrigen]      v1435 §56: 'lista_actual' | 'kept'
 * @property {Array<MergedFromEntry>} [mergedFrom]  v1435 §56: audit trail
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
 * Append `source` a `line.mergedFrom[]` sin mutar el array original.
 *
 * @param {Line} line
 * @param {MergedFromEntry} entry
 * @returns {Array<MergedFromEntry>}
 */
function appendMergedFrom(line, entry) {
  const prev = Array.isArray(line.mergedFrom) ? line.mergedFrom.slice() : [];
  prev.push(entry);
  return prev;
}

/**
 * Merge lines de órdenes viejas dentro de las de la nueva, FUSIONANDO por SKU.
 *
 * v1435 §56 (2026-10-24): regla fuerte "un SKU una sola vez por orden".
 * Si una línea con el mismo code (case-insensitive) existe en la base o entre
 * las órdenes absorbidas, se fusiona:
 *   - qty: suma.
 *   - origen: preserva 'stock-asignado' si alguna lo tenía.
 *   - asigRefs: union dedupe por (pedidoId, lineIndex) (patrón v1382/§42).
 *   - precio: si todos iguales, mantiene; si distintos, usa el de la línea
 *     base (asumida "actual") y guarda precioAnterior1 / precioAnterior2 /
 *     precioOrigen='lista_actual'. El resto queda en mergedFrom[].
 *   - importedFromOrder: queda con el orderNumber de la primera línea
 *     absorbida (compat con UI que la marca "DE ORDEN N").
 *   - mergedFrom[]: audit trail con {orden, qty, precio?} por aporte.
 *
 * v1382 (preservado): si la orden absorbida es CPST (source='stock-asignado-batch'
 * o pedidosOrigenes[] populated), cada línea importada hereda origen+asigRefs
 * matcheando por SKU en pedidosOrigenes.
 *
 * No muta inputs.
 *
 * @param {Array<Line>} baseLines - lines del pedido más nueva (actual)
 * @param {Array<OtherOrder>} otherOrders - órdenes viejas a absorber
 * @returns {MergeResult}
 */
export function mergeLinesFromOrders(baseLines, otherOrders) {
  if (!Array.isArray(baseLines)) {
    return { mergedLines: [] };
  }
  // Copia defensiva de baseLines con mergedFrom[] inicial = ['base'] implícito
  // (preserva mergedFrom[] si venía ya persistido de un merge previo).
  /** @type {Map<string, Line>} */
  const bySku = new Map();
  /** @type {Array<string>} */
  const skuOrder = [];
  for (const l of baseLines) {
    if (!l) continue;
    const copy = { ...l };
    if (Array.isArray(l.asigRefs)) copy.asigRefs = l.asigRefs.slice();
    if (Array.isArray(l.mergedFrom)) copy.mergedFrom = l.mergedFrom.slice();
    const key = normCode(l.code);
    // Si la base ya tenía 2 filas con el mismo SKU (datos legacy pre-§56),
    // las fusiono en el primer pase (comportamiento consistente).
    const existing = bySku.get(key);
    if (!existing) {
      bySku.set(key, copy);
      skuOrder.push(key);
    } else {
      _fuseInto(existing, copy, { orden: 0, qty: Number(copy.qty) || 0, precio: copy.precio });
    }
  }

  if (Array.isArray(otherOrders)) {
    for (const order of otherOrders) {
      if (!order || !Array.isArray(order.lines)) continue;
      const isCpst =
        order.source === 'stock-asignado-batch' ||
        (Array.isArray(order.pedidosOrigenes) && order.pedidosOrigenes.length > 0);
      const orderNum = Number(order.orderNumber) || 0;
      for (const line of order.lines) {
        if (!line) continue;
        const key = normCode(line.code);
        const incoming = { ...line, importedFromOrder: orderNum };
        if (Array.isArray(line.asigRefs)) incoming.asigRefs = line.asigRefs.slice();
        // v1382 (§33/§35): refs persistidas en la línea + refs de pedidosOrigenes.
        const refsFromOrigenes = isCpst
          ? buildAsigRefsForLine(line.code, order.pedidosOrigenes)
          : [];
        const refsFromLine = Array.isArray(line.asigRefs) ? line.asigRefs : [];
        const refs = unionAsigRefsDedup(refsFromOrigenes, refsFromLine);
        if (refs.length > 0) {
          incoming.origen = 'stock-asignado';
          incoming.asigRefs = refs;
        }
        const existing = bySku.get(key);
        const entry = {
          orden: orderNum,
          qty: Number(incoming.qty) || 0,
          precio: incoming.precio,
        };
        if (!existing) {
          // Primer registro: inicializar mergedFrom[] con el aporte.
          incoming.mergedFrom = appendMergedFrom(incoming, entry);
          bySku.set(key, incoming);
          skuOrder.push(key);
        } else {
          _fuseInto(existing, incoming, entry);
        }
      }
    }
  }
  const mergedLines = /** @type {Line[]} */ (skuOrder.map((k) => bySku.get(k)).filter(Boolean));
  return { mergedLines };
}

/**
 * Fusiona `incoming` dentro de `target`. Muta target.
 *
 * @param {Line} target
 * @param {Line} incoming
 * @param {MergedFromEntry} entry
 */
function _fuseInto(target, incoming, entry) {
  // qty: suma.
  target.qty = (Number(target.qty) || 0) + (Number(incoming.qty) || 0);
  // origen: 'stock-asignado' si alguna de las dos lo tenía.
  if (incoming.origen === 'stock-asignado' || target.origen === 'stock-asignado') {
    target.origen = 'stock-asignado';
  }
  // asigRefs: union dedupe.
  const refsA = Array.isArray(target.asigRefs) ? target.asigRefs : [];
  const refsB = Array.isArray(incoming.asigRefs) ? incoming.asigRefs : [];
  const unionRefs = unionAsigRefsDedup(refsA, refsB);
  if (unionRefs.length > 0) target.asigRefs = unionRefs;
  // importedFromOrder: si target no tenía y incoming sí → heredar (visibilidad badge "DE ORDEN N").
  if (target.importedFromOrder == null && incoming.importedFromOrder != null) {
    target.importedFromOrder = incoming.importedFromOrder;
  }
  // Precio: si cambia, snapshot anterior y marcar origen 'lista_actual'.
  const prevPrecio = target.precio;
  const incPrecio = incoming.precio;
  if (incPrecio != null && prevPrecio != null && Number(incPrecio) !== Number(prevPrecio)) {
    // v1435 §56: distintos precios → usar el "actual" (target.precio como lista
    // actual, inicializada por el call-site) + registrar las 2 variantes vistas.
    if (target.precioAnterior1 == null) target.precioAnterior1 = Number(prevPrecio);
    else if (target.precioAnterior2 == null) target.precioAnterior2 = Number(incPrecio);
    target.precioOrigen = 'lista_actual';
  } else if (incPrecio != null && prevPrecio == null) {
    target.precio = Number(incPrecio);
  }
  // mergedFrom[] audit.
  target.mergedFrom = appendMergedFrom(target, entry);
}

/**
 * Devuelve la clase CSS que corresponde a la fila según su rol en el merge.
 *
 * v1435 §56 (2026-10-24): eliminadas las clases duplicate-* porque por
 * construcción no hay SKUs duplicados en una orden. Las dos clases que
 * quedan son:
 *   - 'imported' (línea importada normal, naranja).
 *   - 'reservado-imported' (línea importada con reserva, azul + badge).
 *
 * El segundo argumento se preserva por compat con callers legacy (se ignora).
 *
 * @param {Line|null} line
 * @param {Set<string>|null} [_legacyDupCodes]  ignorado post-§56
 * @returns {'imported' | 'reservado-imported' | null}
 */
export function getRowColorClass(line, _legacyDupCodes) {
  if (!line) return null;
  const isImported = line.importedFromOrder != null;
  const isReservado = line.origen === 'stock-asignado';
  if (isReservado && isImported) return 'reservado-imported';
  if (isImported) return 'imported';
  return null;
}

/**
 * Deduplica un array de lines por `code` (case-insensitive).
 *
 * v1435 §56 (2026-10-24): usado por los call-sites de creación de waitlist
 * (alta manual, import Excel) para garantizar la invariante "un SKU una
 * sola vez por orden" sin pasar por una fusión completa (porque no vienen
 * de absorber otra orden).
 *
 * Fusión por SKU: suma qty + preserva origen=stock-asignado + union
 * dedupe de asigRefs. Preserva el PRIMER aparición de cada campo adicional
 * (desc, precio, etc.).
 *
 * @param {Array<Line>} lines
 * @returns {{lines: Array<Line>, dedupedCount: number}}
 */
export function dedupeLinesByCode(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { lines: [], dedupedCount: 0 };
  }
  /** @type {Map<string, Line>} */
  const bySku = new Map();
  /** @type {Array<string>} */
  const order = [];
  for (const line of lines) {
    if (!line || !line.code) continue;
    const key = normCode(line.code);
    const existing = bySku.get(key);
    if (!existing) {
      const copy = { ...line };
      if (Array.isArray(line.asigRefs)) copy.asigRefs = line.asigRefs.slice();
      bySku.set(key, copy);
      order.push(key);
    } else {
      existing.qty = (Number(existing.qty) || 0) + (Number(line.qty) || 0);
      if (line.origen === 'stock-asignado' || existing.origen === 'stock-asignado') {
        existing.origen = 'stock-asignado';
      }
      const refsA = Array.isArray(existing.asigRefs) ? existing.asigRefs : [];
      const refsB = Array.isArray(line.asigRefs) ? line.asigRefs : [];
      const union = unionAsigRefsDedup(refsA, refsB);
      if (union.length > 0) existing.asigRefs = union;
    }
  }
  const out = /** @type {Line[]} */ (order.map((k) => bySku.get(k)).filter(Boolean));
  return { lines: out, dedupedCount: lines.length - out.length };
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
