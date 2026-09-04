// @ts-check
/**
 * E4.5: al entrar stock (warehouseBreakdown dep 11 sube), promueve lineas
 * de pedidos-app con state='BO' a state='ASIG' via FIFO estricto por
 * createdAt del pedido.
 *
 * FIFO estricto (decision Q9): primeros pedidos se llevan la linea COMPLETA.
 * Si el stock nuevo no alcanza para cubrir la qtyOpen de un pedido, ese
 * pedido queda en BO esperando mas stock (NO promocion parcial). Los
 * siguientes en cola tampoco se promueven hasta que entre mas.
 *
 * MODOS (lee de app_config/sap_sync_state.mode, misma llave que E2/E3):
 *   - 'shadow' (default): loguea a stock_assignment_log_shadow. No modifica pedidos.
 *   - 'active' (E5): modifica pedidos.lines[i].state='ASIG' + asigAt=now.
 *
 * Trigger: on-write app_config/stock_snapshot. Compara warehouseBreakdown
 * before vs after para detectar SKUs con delta positivo en dep 11.
 */

import { readSyncMode } from './pedido-snapshot-core.js';

/**
 * @typedef {Object} FifoAssignDeps
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 *
 * @typedef {Object} BoCandidate
 * @property {string} pedidoId
 * @property {number} createdAtMs
 * @property {number} lineIndex
 * @property {number} qtyOpen
 * @property {string} clientCardCode
 *
 * @typedef {Object} Assignment
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {number} qtyAssigned
 * @property {string} clientCardCode
 *
 * @typedef {Object} Promotion
 * @property {string} sku
 * @property {number} delta
 * @property {number} availableAfter
 * @property {Assignment[]} assignments
 *
 * @typedef {Object} FifoResult
 * @property {'shadow'|'active'} mode
 * @property {number} skusChecked
 * @property {Promotion[]} promotions
 * @property {string[]} errors
 */

/**
 * v798 (2026-09-04, bug reportado por Santi): parsear `warehouseBreakdown` como
 * JSON string cuando corresponde. El sync `scripts/sync_sap_to_firestore.py`
 * (v368+, 2026-07-31, line 673) serializa `warehouseBreakdown` como string
 * JSON antes de escribirlo a `app_config/stock_snapshot` — Firestore tiene
 * limite de 40k index entries por doc y con ~10k SKUs cada uno con {11: n,
 * 12: n} sobraba. La CF FIFO no fue actualizada para esa serializacion:
 * hacia `Object.keys(after)` directo sobre un STRING, devolviendo indices
 * de chars ("0", "1", "2", ...) en vez de SKUs. Resultado: `skusChecked`
 * siempre 0 en los logs, ningun BO se promocionaba. Rev commits: CF v333
 * (2026-07-25) vs sync v368 (2026-07-31) — 6 dias de gap donde el schema
 * se rompio silenciosamente.
 *
 * Fallback objeto para retrocompat con syncs viejos o tests.
 * @param {any} snap
 * @returns {Record<string, Record<string, number>>}
 */
function _parseWarehouseBreakdown(snap) {
  const raw = snap && snap.warehouseBreakdown;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

/**
 * Extrae SKUs con delta positivo en dep 11 (stock disponible venta) comparando
 * warehouseBreakdown before vs after.
 * @param {any} beforeSnap
 * @param {any} afterSnap
 * @returns {Map<string, number>} sku -> delta
 */
export function extractSkusWithStockIncrease(beforeSnap, afterSnap) {
  const out = new Map();
  const before = _parseWarehouseBreakdown(beforeSnap);
  const after = _parseWarehouseBreakdown(afterSnap);
  for (const sku of Object.keys(after)) {
    const beforeDep11 = Number((before[sku] || {})['11']) || 0;
    const afterDep11 = Number((after[sku] || {})['11']) || 0;
    if (afterDep11 > beforeDep11) {
      out.set(sku, afterDep11 - beforeDep11);
    }
  }
  return out;
}

/**
 * Carga pedidos abiertos con al menos una linea state='BO' del sku dado.
 * Devuelve todas las lineas BO de ese sku (un pedido puede tener multiples,
 * aunque en practica es raro).
 * @param {FifoAssignDeps} deps
 * @param {string} sku
 * @returns {Promise<BoCandidate[]>}
 */
export async function loadBoCandidatesForSku(deps, sku) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {BoCandidate[]} */
  const out = [];
  const skuUp = String(sku).toUpperCase();
  snap.forEach((/** @type {any} */ doc) => {
    const data = doc.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      if (l.state !== 'BO') continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      // createdAt es Firestore Timestamp (server) o ISO string
      /** @type {number} */
      let createdAtMs = 0;
      if (data.createdAt) {
        if (typeof data.createdAt.toMillis === 'function') {
          createdAtMs = data.createdAt.toMillis();
        } else if (typeof data.createdAt === 'string') {
          createdAtMs = new Date(data.createdAt).getTime() || 0;
        } else if (typeof data.createdAt === 'number') {
          createdAtMs = data.createdAt;
        }
      }
      out.push({
        pedidoId: doc.id,
        createdAtMs,
        lineIndex: i,
        qtyOpen,
        clientCardCode: String(data.clientCardCode || '').trim(),
      });
    }
  });
  // FIFO por createdAt ascendente. Ties se rompen por pedidoId (deterministic).
  out.sort((a, b) => a.createdAtMs - b.createdAtMs || a.pedidoId.localeCompare(b.pedidoId));
  return out;
}

/**
 * FIFO estricto: primeros pedidos se llevan la linea COMPLETA. Si no alcanza
 * para cubrir la linea, corta (no promocion parcial).
 * @param {BoCandidate[]} candidates
 * @param {number} availableStock
 * @returns {{ assignments: Assignment[], remaining: number }}
 */
export function computeAssignmentsFifo(candidates, availableStock) {
  /** @type {Assignment[]} */
  const assignments = [];
  let remaining = availableStock;
  for (const c of candidates) {
    if (remaining < c.qtyOpen) break; // FIFO estricto, no parcial
    assignments.push({
      pedidoId: c.pedidoId,
      lineIndex: c.lineIndex,
      qtyAssigned: c.qtyOpen,
      clientCardCode: c.clientCardCode,
    });
    remaining -= c.qtyOpen;
  }
  return { assignments, remaining };
}

/**
 * Aplica las asignaciones al Firestore (solo en modo 'active'). Modifica
 * pedidos.lines[i].state='ASIG' + asigAt=ISO now.
 * @param {FifoAssignDeps} deps
 * @param {Assignment[]} assignments
 */
async function applyAssignments(deps, assignments) {
  if (!assignments.length) return;
  const nowIso = new Date().toISOString();
  // Firestore no soporta update de un elemento de array. Read-mutate-write por doc.
  // Con volumen esperado (<10 assignments por SKU) es viable secuencial.
  for (const a of assignments) {
    const ref = deps.fbDb.collection('pedidos').doc(a.pedidoId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const data = snap.data();
    const lines = Array.isArray(data.lines) ? [...data.lines] : [];
    if (!lines[a.lineIndex]) continue;
    lines[a.lineIndex] = Object.assign({}, lines[a.lineIndex], {
      state: 'ASIG',
      asigAt: nowIso,
    });
    await ref.update({ lines, updatedAt: nowIso });
  }
}

/**
 * Ejecuta el FIFO para todos los SKUs con delta positivo.
 * @param {FifoAssignDeps} deps
 * @param {any} beforeSnap
 * @param {any} afterSnap
 * @returns {Promise<FifoResult>}
 */
export async function runFifoAssign(deps, beforeSnap, afterSnap) {
  const log = deps.log || (() => {});
  const mode = await readSyncMode(deps);
  const deltas = extractSkusWithStockIncrease(beforeSnap, afterSnap);
  /** @type {Promotion[]} */
  const promotions = [];
  /** @type {string[]} */
  const errors = [];

  if (!deltas.size) {
    return { mode, skusChecked: 0, promotions, errors };
  }

  for (const [sku, delta] of deltas) {
    try {
      const candidates = await loadBoCandidatesForSku(deps, sku);
      if (!candidates.length) continue;
      const { assignments, remaining } = computeAssignmentsFifo(candidates, delta);
      if (!assignments.length) continue;
      promotions.push({
        sku,
        delta,
        availableAfter: remaining,
        assignments,
      });
      if (mode === 'active') {
        await applyAssignments(deps, assignments);
      }
    } catch (e) {
      errors.push(`sku=${sku}: ${String(e)}`);
    }
  }

  // Audit log (siempre, aun en shadow).
  const logId = new Date().toISOString().replace(/[:.]/g, '-');
  const collectionName = mode === 'active' ? 'stock_assignment_log' : 'stock_assignment_log_shadow';
  try {
    await deps.fbDb.collection(collectionName).doc(logId).set({
      ranAt: new Date().toISOString(),
      mode,
      skusChecked: deltas.size,
      promotions,
      errors,
    });
  } catch (e) {
    errors.push(`audit_log: ${String(e)}`);
  }

  log('runFifoAssign done', {
    mode,
    skusChecked: deltas.size,
    promotionsCount: promotions.length,
    errors: errors.length,
  });

  return { mode, skusChecked: deltas.size, promotions, errors };
}
