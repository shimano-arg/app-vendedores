// @ts-check
/**
 * §J (2026-10-25, v1455) — Absorción de back order al confirmar pedido.
 *
 * Al confirmar X unidades de SKU `S` para cardCode `C`, si existe pedido
 * ABIERTO del mismo cardCode con línea `state='BO'` del mismo SKU, consumir
 * hasta X unidades del BO (FIFO por `createdAt` entre pedidos, por lineIndex
 * dentro del mismo pedido). Reduce `qtyOpen` del BO; si llega a 0, flip a
 * `state='cancelled'` con `closedReason='absorbed_by_newer_confirmed'`.
 *
 * Garantías:
 *   - Pura (sin side effects, sin Firestore).
 *   - Determinística (mismo input → mismo output).
 *   - Idempotente (segunda invocación tras aplicar mutaciones devuelve []).
 *
 * Shape input:
 *   {
 *     cardCode: string,                         // cliente SAP CardCode
 *     lines: Array<{sku: string, cantidad: number}>,  // líneas del pedido NUEVO (payload)
 *     allPedidos: Array<any>,                   // pedidos (todos, se filtran acá)
 *     now?: number,                             // ms (default Date.now())
 *   }
 *
 * Shape output:
 *   {
 *     absorptions: Array<{
 *       sku: string,
 *       cantidad: number,                       // cantidad absorbida de ESTA línea del BO
 *       pedidoIdOrigen: string,
 *       lineIndexOrigen: number,
 *       qtyAntes: number,                       // qtyOpen antes del absorb
 *       qtyDespues: number,                     // qtyOpen después (puede ser 0)
 *     }>,
 *     totalCubierto: number,                    // suma de cantidad
 *   }
 *
 * Precedente plan #1206 (hipótesis S1 "backorder inflado"). CLAUDE.md §40
 * dice "BO no reserva stock pero es cola/forecast" — esta absorción cierra
 * el ciclo: cuando el cliente YA recibe la mercadería, el BO se consume.
 */

/**
 * @param {string} s
 * @returns {string}
 */
function norm(s) {
  return String(s || '')
    .toUpperCase()
    .trim();
}

/**
 * @param {any} ts
 * @returns {number}
 */
function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const n = Date.parse(ts);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof ts.toMillis === 'function') {
    try {
      return ts.toMillis();
    } catch (_e) {
      return 0;
    }
  }
  if (ts.seconds) return Number(ts.seconds) * 1000;
  return 0;
}

/**
 * Core puro: computa el plan de absorción sin mutar nada.
 *
 * @param {{cardCode: string, lines: Array<any>, allPedidos: Array<any>, now?: number}} params
 * @returns {{absorptions: Array<any>, totalCubierto: number}}
 */
export function computeBoAbsorption(params) {
  const cardCode = (params && params.cardCode) || '';
  const lines = params && Array.isArray(params.lines) ? params.lines : [];
  const allPedidos = params && Array.isArray(params.allPedidos) ? params.allPedidos : [];

  if (!cardCode || lines.length === 0 || allPedidos.length === 0) {
    return { absorptions: [], totalCubierto: 0 };
  }

  // 1. Agregar cantidad pedida por SKU normalizado (una línea del payload por SKU
  //    puede haber duplicados; sumamos).
  /** @type {Map<string, number>} */
  const cantidadPorSku = new Map();
  for (const l of lines) {
    if (!l) continue;
    const sku = norm(l.sku || l.code);
    const q = Number(l.cantidad || l.qty) || 0;
    if (!sku || q <= 0) continue;
    cantidadPorSku.set(sku, (cantidadPorSku.get(sku) || 0) + q);
  }
  if (cantidadPorSku.size === 0) {
    return { absorptions: [], totalCubierto: 0 };
  }

  // 2. Filtrar pedidos candidatos: mismo cardCode + abiertos + con al menos
  //    una línea BO con qtyOpen>0 de los SKUs del payload.
  /** @type {Array<{pedido: any, createdAtMs: number}>} */
  const candidatos = [];
  for (const p of allPedidos) {
    if (!p || !p.lines || !Array.isArray(p.lines)) continue;
    if (p.closedAt != null) continue;
    if (String(p.clientCardCode || '').trim() !== String(cardCode).trim()) continue;
    // ¿Tiene alguna línea BO que absorbe?
    const matches = p.lines.some(
      (/** @type {any} */ l) =>
        l && l.state === 'BO' && Number(l.qtyOpen || 0) > 0 && cantidadPorSku.has(norm(l.code))
    );
    if (!matches) continue;
    candidatos.push({ pedido: p, createdAtMs: toMillis(p.createdAt) });
  }
  if (candidatos.length === 0) {
    return { absorptions: [], totalCubierto: 0 };
  }

  // 3. Sort FIFO por createdAt (más viejo primero). Nulos al final (0 → al principio);
  //    para evitar que un pedido sin createdAt siempre gane, los mandamos al final.
  candidatos.sort((a, b) => {
    const aMs = a.createdAtMs || Infinity;
    const bMs = b.createdAtMs || Infinity;
    return aMs - bMs;
  });

  // 4. Consumir FIFO: entre pedidos (más viejo primero) + dentro de cada pedido
  //    por lineIndex ASC.
  /** @type {Array<any>} */
  const absorptions = [];
  /** @type {Map<string, number>} */
  const restantePorSku = new Map(cantidadPorSku);

  for (const { pedido } of candidatos) {
    const pedidoId = pedido._fsId || pedido.id;
    if (!pedidoId) continue;
    for (let li = 0; li < pedido.lines.length; li += 1) {
      const line = pedido.lines[li];
      if (!line || line.state !== 'BO') continue;
      const qtyOpen = Number(line.qtyOpen || 0);
      if (qtyOpen <= 0) continue;
      const sku = norm(line.code);
      const restante = restantePorSku.get(sku) || 0;
      if (restante <= 0) continue;
      const absorb = Math.min(qtyOpen, restante);
      if (absorb <= 0) continue;
      absorptions.push({
        sku,
        cantidad: absorb,
        pedidoIdOrigen: pedidoId,
        lineIndexOrigen: li,
        qtyAntes: qtyOpen,
        qtyDespues: qtyOpen - absorb,
      });
      restantePorSku.set(sku, restante - absorb);
    }
  }

  const totalCubierto = absorptions.reduce(
    (/** @type {number} */ s, /** @type {any} */ a) => s + (Number(a.cantidad) || 0),
    0
  );

  return { absorptions, totalCubierto };
}

/**
 * Aplica las absorciones a un `lines[]` array del pedido origen (mutación
 * local, no toca Firestore). Útil tanto para el espejo server-side como
 * para tests. Devuelve el nuevo array de líneas listo para `tx.update`.
 *
 * - Mutaciones por línea absorbida:
 *   - `qtyOpen -= absorbed` (puede quedar 0).
 *   - Si `qtyOpen === 0`: `state='cancelled'`, `closedReason='absorbed_by_newer_confirmed'`,
 *     `cancelledAt`, `cancelledIntoPedidoId`, `asigReserva=false`.
 *   - En todos los casos: `qtyCancelled += absorbed`.
 *
 * - Audit `_backfill` del PEDIDO (no de la línea) via la función
 *   `buildBackfillUpdate`.
 *
 * @param {Array<any>} lines
 * @param {Array<any>} absorptionsOfPedido  Subset de `absorptions` que apunta
 *                                           a este pedido.
 * @param {string} newPedidoId               `pedidoId` del pedido nuevo que
 *                                           absorbe (para audit).
 * @param {string} nowIso                    Timestamp ISO.
 * @returns {Array<any>} newLines
 */
export function applyAbsorptionsToLines(lines, absorptionsOfPedido, newPedidoId, nowIso) {
  const newLines = Array.isArray(lines) ? lines.map((l) => ({ ...l })) : [];
  for (const a of absorptionsOfPedido) {
    const li = Number(a.lineIndexOrigen);
    if (!Number.isFinite(li) || li < 0 || li >= newLines.length) continue;
    const line = newLines[li];
    if (!line) continue;
    const absorbed = Number(a.cantidad) || 0;
    if (absorbed <= 0) continue;
    const prevQo = Number(line.qtyOpen) || 0;
    const nextQo = Math.max(0, prevQo - absorbed);
    /** @type {any} */
    const mutated = {
      ...line,
      qtyOpen: nextQo,
      qtyCancelled: (Number(line.qtyCancelled) || 0) + absorbed,
      asigReserva: false,
    };
    if (nextQo === 0) {
      mutated.state = 'cancelled';
      mutated.closedReason = 'absorbed_by_newer_confirmed';
      mutated.cancelledAt = nowIso;
      mutated.cancelledIntoPedidoId = newPedidoId;
      mutated.absorbedByNewerPedidoId = newPedidoId;
    } else {
      // Mantener state='BO'; marcar partial absorption.
      mutated.partialCancelAt = nowIso;
      mutated.partialCancelFrom = 'absorbed_by_newer_confirmed';
      mutated.partialCancelQty = (Number(line.partialCancelQty) || 0) + absorbed;
      mutated.partialCancelIntoPedidoId = newPedidoId;
    }
    newLines[li] = mutated;
  }
  return newLines;
}

/**
 * Construye el update object para el campo `_backfill` del pedido origen.
 * Clave versionada por fecha para append-only (§55).
 *
 * Shape:
 *   _backfill: {
 *     J_bo_absorbed_<YYYYMMDDHHMMSS>: {
 *       absorptions: [{sku, qtyAntes, qtyDespues, cantidad, lineIndex}, ...],
 *       consumedBy: newPedidoId,
 *       at: nowIso,
 *       source: 'commitPedidoCF',
 *     }
 *   }
 *
 * @param {Array<any>} existingBackfill  Valor actual del `_backfill` del doc (o {}).
 * @param {Array<any>} absorptionsOfPedido
 * @param {string} newPedidoId
 * @param {string} nowIso
 * @returns {Record<string, any>}  Objeto `_backfill` nuevo (mergear con existing).
 */
export function buildBackfillUpdate(existingBackfill, absorptionsOfPedido, newPedidoId, nowIso) {
  const key = buildBackfillKey(nowIso);
  const existing = existingBackfill && typeof existingBackfill === 'object' ? existingBackfill : {};
  const payload = {
    absorptions: absorptionsOfPedido.map((a) => ({
      sku: a.sku,
      qtyAntes: a.qtyAntes,
      qtyDespues: a.qtyDespues,
      cantidad: a.cantidad,
      lineIndex: a.lineIndexOrigen,
    })),
    consumedBy: newPedidoId,
    at: nowIso,
    source: 'commitPedidoCF',
  };
  return Object.assign({}, existing, { [key]: payload });
}

/**
 * @param {string} nowIso
 * @returns {string}
 */
export function buildBackfillKey(nowIso) {
  // ISO '2026-10-25T13:45:12.345Z' → 'J_bo_absorbed_20261025T134512Z'
  const compact = String(nowIso || '')
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
    .replace(/[^0-9TZ]/g, '');
  return 'J_bo_absorbed_' + (compact || 'unknown');
}
