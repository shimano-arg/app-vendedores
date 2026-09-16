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
 * @property {'P'|'A'|'B'|'C'} cliTipo — v956 (2026-09-16): categoria comercial. Default 'C' si no seteado.
 *
 * @typedef {Object} Assignment
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {number} qtyAssigned
 * @property {string} clientCardCode
 * @property {'P'|'A'|'B'|'C'} cliTipo — v956: para audit y visibility.
 * @property {boolean} asigReserva — v956: true si P/A (retiene stock), false si B/C (stock queda disponible).
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

// v956 (2026-09-16): tier priority para FIFO. Los clientes P y A tienen
// prioridad y ademas retienen stock (asigReserva=true). B y C solo se
// asignan si sobra stock post-P/A, y no retienen (asigReserva=false).
/** @type {Record<'P'|'A'|'B'|'C', number>} */
const CLI_TIPO_PRIORITY = { P: 0, A: 1, B: 2, C: 3 };

/**
 * v956: normaliza el string cliTipo a los 4 tiers oficiales. Default 'C'
 * cuando no hay valor o el valor es invalido — mismo comportamiento que
 * la UI (master-clientes.js:2445 "default visual 'C' cuando no hay
 * cliTipo guardado").
 * @param {any} raw
 * @returns {'P'|'A'|'B'|'C'}
 */
function normalizeCliTipo(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase();
  if (s === 'P' || s === 'A' || s === 'B' || s === 'C') return s;
  return 'C';
}

/**
 * v956: computa el docId de client_master a partir de province + locality
 * + tienda. Portado de app.bundle.js:7919 (fn clientLocId2) — mismo algoritmo
 * que usa la UI para keyar client_master. Sin esto la CF no podria lookup
 * el cliTipo actual del cliente.
 * @param {string} prov
 * @param {string} locName
 * @param {string} tienda
 * @returns {string}
 */
export function computeClientLocId(prov, locName, tienda) {
  /** @param {string} s */
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  return norm(prov) + '__' + norm(locName) + '__' + norm(tienda);
}

/**
 * v956: fetch cliTipo para un cliente desde client_master. Default 'C'
 * si el doc no existe o no tiene el field. Se llama en `loadBoCandidatesForSku`.
 * @param {FifoAssignDeps} deps
 * @param {string} docId
 * @returns {Promise<'P'|'A'|'B'|'C'>}
 */
async function fetchCliTipo(deps, docId) {
  if (!docId) return 'C';
  try {
    const snap = await deps.fbDb.collection('client_master').doc(docId).get();
    if (!snap.exists) return 'C';
    const data = snap.data() || {};
    return normalizeCliTipo(data.cliTipo);
  } catch (_e) {
    return 'C';
  }
}

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
  /** @type {Array<BoCandidate & { _prov: string, _loc: string, _cli: string }>} */
  const preOut = [];
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
      preOut.push({
        pedidoId: doc.id,
        createdAtMs,
        lineIndex: i,
        qtyOpen,
        clientCardCode: String(data.clientCardCode || '').trim(),
        cliTipo: 'C', // placeholder — se rellena abajo con lookup a client_master
        _prov: String(data.province || data.clientProvince || '').trim(),
        _loc: String(data.locName || data.clientLocality || '').trim(),
        _cli: String(data.clientName || '').trim(),
      });
    }
  });
  // v956 (2026-09-16): resolver cliTipo dinamico via client_master. Cache
  // por docId dentro del batch para evitar duplicar reads si multiples
  // pedidos del mismo cliente estan en la cola.
  /** @type {Map<string, 'P'|'A'|'B'|'C'>} */
  const cliTipoCache = new Map();
  for (const c of preOut) {
    const docId = computeClientLocId(c._prov, c._loc, c._cli);
    let tipo = cliTipoCache.get(docId);
    if (tipo === undefined) {
      tipo = await fetchCliTipo(deps, docId);
      cliTipoCache.set(docId, tipo);
    }
    c.cliTipo = tipo;
  }
  /** @type {BoCandidate[]} */
  const out = preOut.map((c) => ({
    pedidoId: c.pedidoId,
    createdAtMs: c.createdAtMs,
    lineIndex: c.lineIndex,
    qtyOpen: c.qtyOpen,
    clientCardCode: c.clientCardCode,
    cliTipo: c.cliTipo,
  }));
  // FIFO por createdAt ascendente. Ties se rompen por pedidoId (deterministic).
  // La priorizacion por cliTipo se hace en computeAssignmentsFifo (agrupacion
  // tier-based), no en el orden global aqui.
  out.sort((a, b) => a.createdAtMs - b.createdAtMs || a.pedidoId.localeCompare(b.pedidoId));
  return out;
}

/**
 * v956 (2026-09-16): FIFO tier-based por cliTipo. Los pedidos se procesan
 * tier por tier (P → A → B → C). Dentro de cada tier, FIFO estricto por
 * createdAt: primeros pedidos se llevan la linea COMPLETA; si no alcanza
 * para cubrir el primero de la cola, ESE TIER se corta (no promocion
 * parcial) — pero el siguiente tier sigue procesandose con el stock que
 * quede.
 *
 * asigReserva: true si el tier es P o A (reserva stock fisico para el
 * cliente), false si es B o C (linea aparece en Stock Asignado pero el
 * stock queda libre para nuevos pedidos de clientes A/P).
 *
 * Rationale (pedido Mariano 2026-09-16): que los VDEs no vean "sin stock"
 * cuando el stock esta parado por un cliente C con baja frecuencia de
 * compra. Los clientes A/P son los que retienen stock; B/C no.
 *
 * @param {BoCandidate[]} candidates
 * @param {number} availableStock
 * @returns {{ assignments: Assignment[], remaining: number }}
 */
export function computeAssignmentsFifo(candidates, availableStock) {
  /** @type {Assignment[]} */
  const assignments = [];
  let remaining = availableStock;
  // Agrupar por tier (ya vienen sorteados por createdAt ASC desde loader).
  /** @type {Map<'P'|'A'|'B'|'C', BoCandidate[]>} */
  const byTier = new Map();
  for (const t of /** @type {const} */ (['P', 'A', 'B', 'C'])) byTier.set(t, []);
  for (const c of candidates) {
    const tier = c.cliTipo || 'C';
    const list = byTier.get(tier);
    if (list) list.push(c);
  }
  // Procesar tiers en orden de prioridad. Un tier que "se corta" no bloquea
  // al siguiente — pasar al siguiente con el remaining actual.
  for (const tier of /** @type {const} */ (['P', 'A', 'B', 'C'])) {
    const tierCands = byTier.get(tier) || [];
    for (const c of tierCands) {
      if (remaining < c.qtyOpen) break; // FIFO estricto WITHIN tier, no parcial
      assignments.push({
        pedidoId: c.pedidoId,
        lineIndex: c.lineIndex,
        qtyAssigned: c.qtyOpen,
        clientCardCode: c.clientCardCode,
        cliTipo: tier,
        asigReserva: tier === 'P' || tier === 'A',
      });
      remaining -= c.qtyOpen;
    }
  }
  return { assignments, remaining };
}

/**
 * Aplica las asignaciones al Firestore (solo en modo 'active'). Modifica
 * pedidos.lines[i].state='ASIG' + asigAt=ISO now.
 *
 * v939 (2026-09-14, SecAudit Sprint 2 MED-14 VULN-L007): envuelto en
 * runTransaction para eliminar el race entre snap.get() y ref.update().
 * Antes: CF FIFO leia lines, el VDE cancelaba una linea BO desde la app en
 * la ventana (ms), CF escribia lines pisando la cancelacion sin ver el
 * cambio. Ahora la transaction re-lee dentro del ciclo y aborta+retry si
 * el doc cambio - Firestore garantiza serializabilidad. Ademas, si la
 * linea que ibamos a promover a ASIG ya no esta en state 'BO' (fue
 * cancelada/expired/reciclada por otro flow), se skipea sin escribir para
 * no clobbear el nuevo estado.
 *
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
    // v939: transaction para atomic read-mutate-write. Firestore reintenta
    // hasta 5 veces automatico si detecta conflict.
    await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data();
      const lines = Array.isArray(data.lines) ? [...data.lines] : [];
      if (!lines[a.lineIndex]) return;
      // v939: defense-in-depth. Solo promover si la linea sigue en BO.
      // Si un VDE ya la cancelo/reciclo mientras estabamos calculando el
      // FIFO, no pisar el nuevo state.
      const currentState = lines[a.lineIndex].state;
      if (currentState && currentState !== 'BO') {
        return; // linea ya no esta en BO, skip sin escribir
      }
      lines[a.lineIndex] = Object.assign({}, lines[a.lineIndex], {
        state: 'ASIG',
        asigAt: nowIso,
        // v956 (2026-09-16): asigReserva computado en computeAssignmentsFifo
        // segun cliTipo del cliente al momento de la promocion.
        asigReserva: !!a.asigReserva,
        asigCliTipo: a.cliTipo,
      });
      tx.update(ref, { lines, updatedAt: nowIso });
    });
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
