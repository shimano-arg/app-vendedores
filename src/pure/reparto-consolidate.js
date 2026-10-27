// @ts-check
/**
 * reparto-consolidate (v1498 §97, 2026-10-27) — pure fn para consolidar
 * `clientesBO` entries por cliente+SKU en el módulo Reparto de ingresos.
 *
 * Bug reportado: CUDC201XG + FERNANDO ANTONIO URQUIOLA (CardCode
 * `C20084809919`, Lobos, BA) aparece en 2 filas en Reparto: 15 un (ORDEN
 * 275) + 2 un (ORDEN 276). Son 2 pedidos distintos del MISMO cliente+SKU
 * cargados a 27 segundos de diferencia (ambos legítimos post-§56).
 *
 * Según pedido Mariano: una sola fila con 17 un; la asignación se
 * distribuye FIFO sobre las órdenes origen (vieja primero).
 *
 * Clave de agrupación (normalizada): preferido `cardCode` (trim + upper);
 * si falta, fallback a `clientName|locality|province` normalizado.
 *
 * Fuente única: reusada por `_repartoLiveClientesBO`, `_repartoBuildCard`,
 * `exportRepartoToExcel` (v1497 §96), y el popup Master Productos cuando
 * necesite leer la cola por cliente.
 *
 * Preserva array interno `pedidoIds[]` con FIFO ordering (más vieja
 * primero) para que `applyRepartoManualCF` distribuya correctamente la
 * asignación entre múltiples pedidos del mismo cliente.
 */

/**
 * Normaliza una clave para agrupar entries.
 * @param {string} s
 * @returns {string}
 */
function normKey(s) {
  return String(s || '')
    .trim()
    .toUpperCase();
}

/**
 * Devuelve la clave canónica para un cliente+SKU. CardCode preferido;
 * fallback a `clientName|locality|province` si falta.
 *
 * @param {any} entry - `{clientCardCode, clientName, clientLocality, clientProvince, ...}`.
 * @returns {string} clave canónica, ej. "C20084809919" o "URQUIOLA|LOBOS|BUENOS AIRES".
 */
export function groupKeyForClienteBO(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const cc = normKey(entry.clientCardCode || entry.cardCode);
  if (cc) return cc;
  const name = normKey(entry.clientName);
  const loc = normKey(entry.clientLocality || entry.locName);
  const prov = normKey(entry.clientProvince || entry.province);
  if (!name && !loc && !prov) return '';
  return `${name}|${loc}|${prov}`;
}

/**
 * Lee un timestamp de `pedidoCreatedAt` o `createdAt` tolerante a Firestore
 * Timestamp / Date / string ISO / number. Devuelve ms epoch o `+Infinity`
 * si no parseable (para que caiga al final del sort).
 *
 * @param {any} ts
 * @returns {number}
 */
function tsToMs(ts) {
  if (ts == null) return Number.POSITIVE_INFINITY;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string') {
    const n = Date.parse(ts);
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
  }
  if (ts instanceof Date) {
    const n = ts.getTime();
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
  }
  if (typeof ts === 'object') {
    if (typeof ts.toMillis === 'function') {
      try {
        return ts.toMillis();
      } catch (_e) {
        /* fall */
      }
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Consolida un array de `clientesBO` entries agrupando por cliente+SKU.
 * Suma `qtyBackorder` + preserva `pedidoIds[]` ordenado FIFO (más vieja
 * primero).
 *
 * Preserva los campos cosméticos (clientName, clientLocality, clientProvince,
 * vendorKey) del PRIMER entry del grupo. CardCode normalizado.
 *
 * Idempotente: aplicar dos veces devuelve el mismo resultado.
 *
 * @param {Array<any>} entries - lista de `clientesBO`.
 * @returns {Array<{
 *   clientCardCode: string,
 *   clientName: string,
 *   clientLocality: string,
 *   clientProvince: string,
 *   vendorKey: string,
 *   qtyBackorder: number,
 *   pedidoIds: Array<{pedidoId: string, lineIndex: number, qty: number, createdAt: any}>,
 *   groupKey: string,
 * }>}
 */
export function consolidateClientesBO(entries) {
  if (!Array.isArray(entries)) return [];
  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const key = groupKeyForClienteBO(e);
    if (!key) continue; // skip entries sin cardCode ni clientName
    const qty = Number(e.qtyBackorder) || 0;
    if (qty <= 0) continue;
    let g = groups.get(key);
    if (!g) {
      g = {
        clientCardCode: String(e.clientCardCode || e.cardCode || '').trim(),
        clientName: String(e.clientName || '').trim(),
        clientLocality: String(e.clientLocality || e.locName || '').trim(),
        clientProvince: String(e.clientProvince || e.province || '').trim(),
        vendorKey: String(e.vendorKey || e.vendor || '').trim(),
        qtyBackorder: 0,
        pedidoIds: [],
        groupKey: key,
      };
      groups.set(key, g);
    }
    g.qtyBackorder += qty;
    g.pedidoIds.push({
      pedidoId: String(e.pedidoId || ''),
      lineIndex: Number(e.lineIndex) || 0,
      qty,
      createdAt: e.pedidoCreatedAt || e.createdAt || null,
    });
  }
  // FIFO: sort pedidoIds por createdAt asc dentro de cada grupo.
  for (const g of groups.values()) {
    g.pedidoIds.sort(
      (/** @type {any} */ a, /** @type {any} */ b) => tsToMs(a.createdAt) - tsToMs(b.createdAt)
    );
  }
  // Sort outer: por qty desc (clientes con más BO primero) + name asc.
  /** @type {Array<any>} */
  const out = Array.from(groups.values());
  out.sort((/** @type {any} */ a, /** @type {any} */ b) => {
    if (b.qtyBackorder !== a.qtyBackorder) return b.qtyBackorder - a.qtyBackorder;
    return String(a.clientName || '').localeCompare(String(b.clientName || ''));
  });
  return out;
}

/**
 * Distribuye una cantidad asignada entre los `pedidoIds` del grupo FIFO.
 * Devuelve un array de `{pedidoId, lineIndex, qtyAsignada}` que suma
 * `qtyAsignar` (clampeado al `qtyBackorder` total del grupo).
 *
 * Usado por `applyRepartoManualCore` server-side cuando Pablo asigna sobre
 * una fila unificada.
 *
 * @param {Array<{pedidoId: string, lineIndex: number, qty: number, createdAt: any}>} pedidoIds
 * @param {number} qtyAsignar
 * @returns {Array<{pedidoId: string, lineIndex: number, qtyAsignada: number}>}
 */
export function distributeQtyFifo(pedidoIds, qtyAsignar) {
  if (!Array.isArray(pedidoIds) || pedidoIds.length === 0) return [];
  let remaining = Math.max(0, Number(qtyAsignar) || 0);
  const out = [];
  for (const p of pedidoIds) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(p.qty) || 0);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    out.push({
      pedidoId: String(p.pedidoId || ''),
      lineIndex: Number(p.lineIndex) || 0,
      qtyAsignada: take,
    });
    remaining -= take;
  }
  return out;
}
