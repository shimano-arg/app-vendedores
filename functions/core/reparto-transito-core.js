/**
 * reparto-transito-core.js — scanners dep 12 para E2 reparto-dep12.
 *
 * Dos funciones principales invocadas por el trigger `onStockSnapshotWrittenReparto`
 * (alias de `onDep11IncreaseCreateReparto`) cuando el feature flag
 * `dep12_reparto_enabled === true`:
 *
 * 1. `scanCancelledTransito(deps, before, after)`:
 *    detecta bajas de dep 12 sin suba equivalente en dep 11 (patrón
 *    `detectTransitoCancelaciones` del pure E0). Para cada SKU afectado,
 *    recorre ASIG vivas con `enTransito=true` FIFO por `asigAtTransito` ASC
 *    y revierte las unidades canceladas a BO con
 *    `closedReason='partida_cancelada_en_transito'` (CLAUDE.md §40.5 pattern).
 *
 * 2. `scanDep12ToDep11Transitions(deps, after)`:
 *    recorre ASIG vivas con `enTransito=true` + verifica que el físico dep 11
 *    cubre el nominal (SAP hizo cruce). Muta la línea a `enTransito=false`,
 *    setea `enDep11At`. Hoy no dispara auto-send (eso va en E3); solo migra
 *    el flag.
 *
 * Ambas funciones corren dentro de `runTransaction` por pedido (§58 strict:
 *  ALL reads before ALL writes + re-lectura del doc dentro del tx para no
 *  pisar escrituras concurrentes — §104 derivada 2).
 *
 * TODAS las mutaciones loguean a `operations_log` AWAIT (§64.2 pattern).
 * Fail-safe por pedido: un pedido que falla su tx NO bloquea los demás.
 */

import { detectTransitoCancelaciones } from './detect-stock-increases.js';
import { DEP_FISICO, DEP_TRANSITO, getQtyFromBreakdown } from './warehouse-constants.js';

const INGRESOS_REPARTO_COLLECTION = 'ingresos_reparto';

/**
 * Logger centralizado AWAIT (§64.2). Fire-and-await: si falla el write a
 * operations_log, loguea a console pero NO lanza.
 *
 * @param {any} deps
 * @param {string} type
 * @param {Record<string, unknown>} entry
 */
async function logOps(deps, type, entry) {
  if (!deps || !deps.fbDb) return;
  try {
    await deps.fbDb.collection('operations_log').add(
      Object.assign(
        {
          type,
          timestamp: new Date(),
        },
        entry || {}
      )
    );
  } catch (e) {
    if (deps.log) deps.log('operations_log write failed', { type, err: String(e) });
  }
}

/**
 * Parsea `warehouseBreakdown` del snapshot. Tolera string/obj/null (igual
 * patrón que detect-stock-increases).
 *
 * @param {unknown} raw
 * @returns {Record<string, Record<string, number>>}
 */
function parseWhsBreakdown(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return /** @type {any} */ (raw);
  return {};
}

/**
 * Carga pedidos abiertos (`closedAt == null`) UNA sola vez.
 *
 * @param {any} deps
 * @returns {Promise<Array<{id:string, data:any}>>}
 */
async function loadOpenPedidos(deps) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<{id:string, data:any}>} */
  const out = [];
  snap.forEach((/** @type {any} */ d) => out.push({ id: d.id, data: d.data() || {} }));
  return out;
}

/**
 * @typedef {Object} TransitoCancelResult
 * @property {Array<{sku:string, pedidoId:string, lineIndex:number, qtyRevertida:number, cardCode:string}>} revertidas
 * @property {Array<{pedidoId:string, motivo:string}>} skipped
 * @property {string[]} errors
 */

/**
 * scanCancelledTransito — fase 1 de E2 (FIX-A1).
 *
 * @param {any} deps
 * @param {any} beforeSnap - stock_snapshot.data() antes del write
 * @param {any} afterSnap - stock_snapshot.data() después del write
 * @returns {Promise<TransitoCancelResult>}
 */
export async function scanCancelledTransito(deps, beforeSnap, afterSnap) {
  /** @type {TransitoCancelResult} */
  const out = { revertidas: [], skipped: [], errors: [] };
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();

  const cancelaciones = detectTransitoCancelaciones(beforeSnap, afterSnap);
  if (cancelaciones.length === 0) return out;

  // Index por SKU para query rápido.
  /** @type {Map<string, number>} */
  const pendientePorSku = new Map();
  for (const c of cancelaciones) pendientePorSku.set(String(c.sku).toUpperCase(), c.qtyCancelada);

  let openPedidos;
  try {
    openPedidos = await loadOpenPedidos(deps);
  } catch (e) {
    out.errors.push('loadOpenPedidos failed: ' + String(e));
    return out;
  }

  // Recolectar candidatos FIFO: ASIG vivas con enTransito=true del SKU afectado.
  /** @type {Array<{pedidoId:string, lineIndex:number, sku:string, qtyOpen:number, asigAtTransitoMs:number, asigAtMs:number, cardCode:string, line:any}>} */
  const candidatos = [];
  for (const p of openPedidos) {
    const lines = Array.isArray(p.data.lines) ? p.data.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || l.state !== 'ASIG' || !l.enTransito) continue;
      const sku = String(l.code || '').toUpperCase();
      if (!pendientePorSku.has(sku)) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const asigAtTransitoMs = toMs(l.asigAtTransito) ?? toMs(l.asigAt) ?? Number.POSITIVE_INFINITY;
      const asigAtMs = toMs(l.asigAt) ?? Number.POSITIVE_INFINITY;
      candidatos.push({
        pedidoId: p.id,
        lineIndex: i,
        sku,
        qtyOpen: qo,
        asigAtTransitoMs,
        asigAtMs,
        cardCode: String(p.data.clientCardCode || ''),
        line: l,
      });
    }
  }
  // FIFO: asigAtTransito ASC; tie-break asigAt ASC; tie-break pedidoId.
  candidatos.sort(
    (a, b) =>
      a.asigAtTransitoMs - b.asigAtTransitoMs ||
      a.asigAtMs - b.asigAtMs ||
      a.pedidoId.localeCompare(b.pedidoId)
  );

  // Agrupar por pedido para 1 tx por pedido.
  /** @type {Map<string, Array<typeof candidatos[0]>>} */
  const porPedido = new Map();
  for (const c of candidatos) {
    const rem = pendientePorSku.get(c.sku) || 0;
    if (rem <= 0) continue;
    const consumir = Math.min(rem, c.qtyOpen);
    if (consumir <= 0) continue;
    pendientePorSku.set(c.sku, rem - consumir);
    c.qtyOpen = consumir; // reuso el campo para pasar la qty a cancelar
    const arr = porPedido.get(c.pedidoId) || [];
    arr.push(c);
    porPedido.set(c.pedidoId, arr);
  }

  // Aplicar por pedido en tx (§58 + §104 derivada 2: re-lectura dentro del tx).
  for (const [pedidoId, items] of porPedido) {
    try {
      await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        const ref = deps.fbDb.collection('pedidos').doc(pedidoId);
        const snap = await tx.get(ref); // READ (§58)
        if (!snap.exists) {
          out.skipped.push({ pedidoId, motivo: 'pedido_no_existe' });
          return;
        }
        const data = snap.data() || {};
        const lines = Array.isArray(data.lines) ? data.lines.slice() : [];
        for (const item of items) {
          const idx = item.lineIndex;
          const orig = lines[idx];
          if (!orig || orig.state !== 'ASIG' || !orig.enTransito) {
            // La línea cambió entre scan y tx — skip (idempotencia §104).
            continue;
          }
          const prevQo = Number(orig.qtyOpen) || 0;
          const qtyRevertir = Math.min(item.qtyOpen, prevQo);
          if (qtyRevertir <= 0) continue;
          const keep = prevQo - qtyRevertir;
          // Caso 1: revert TOTAL — la ASIG queda qty=0 → convertir a cancelled
          // + append BO. §104: nunca ASIG con qtyOpen<=0.
          // Caso 2: revert parcial — ASIG conserva keep unidades + append BO
          // por qtyRevertir.
          if (keep <= 0) {
            lines[idx] = Object.assign({}, orig, {
              state: 'cancelled',
              qtyOpen: 0,
              qtyCancelled: (Number(orig.qtyCancelled) || 0) + qtyRevertir,
              closedReason: 'partida_cancelada_en_transito',
              cancelledAt: nowIso,
              cancelledBy: 'system:scanCancelledTransito',
            });
          } else {
            lines[idx] = Object.assign({}, orig, {
              qty: (Number(orig.qty) || prevQo) - qtyRevertir,
              qtyOpen: keep,
            });
          }
          // Append BO con audit.
          lines.push({
            code: orig.code,
            desc: orig.desc || '',
            cat: orig.cat || '',
            fam: orig.fam || '',
            sub: orig.sub || '',
            qty: qtyRevertir,
            qtyOpen: qtyRevertir,
            qtyInvoiced: 0,
            qtyCancelled: 0,
            qtyRecycled: 0,
            recycledIntoPedidoId: null,
            precio: Number(orig.precio) || 0,
            priceAtCreation: Number(orig.priceAtCreation) || Number(orig.precio) || 0,
            needsReview: false,
            state: 'BO',
            asigRevertidaAt: nowIso,
            asigRevertidaBy: 'system:scanCancelledTransito',
            asigRevertidaReason: 'partida_cancelada_en_transito',
            splitFromLineIndex: idx,
          });
          out.revertidas.push({
            sku: item.sku,
            pedidoId,
            lineIndex: idx,
            qtyRevertida: qtyRevertir,
            cardCode: item.cardCode,
          });
        }
        tx.update(ref, { lines, updatedAt: nowIso }); // WRITE (§58)
      });
    } catch (e) {
      const msg = pedidoId + ': ' + (e && e.message ? e.message : String(e));
      out.errors.push(msg);
      log('scanCancelledTransito error', { pedidoId, err: msg });
    }
  }

  // Log operations_log por cada reversión (AWAIT §64.2).
  for (const r of out.revertidas) {
    await logOps(deps, 'asig_revertida_partida_cancelada', {
      sku: r.sku,
      pedidoId: r.pedidoId,
      lineIndex: r.lineIndex,
      qtyRevertida: r.qtyRevertida,
      cardCode: r.cardCode,
      closedReason: 'partida_cancelada_en_transito',
    });
  }

  return out;
}

/**
 * @typedef {Object} TransitionResult
 * @property {Array<{sku:string, pedidoId:string, lineIndex:number, cardCode:string}>} migradas
 * @property {Array<{pedidoId:string, motivo:string}>} skipped
 * @property {string[]} errors
 */

/**
 * scanDep12ToDep11Transitions — detecta ASIG enTransito=true cuyo físico dep 11
 * ya cubre + migra el flag a `enTransito=false` + setea `enDep11At`.
 *
 * NO dispara auto-send (eso va en E3). Solo marca el estado para que
 * `auto-send-sap` lo levante en la próxima pasada.
 *
 * @param {any} deps
 * @param {any} afterSnap - stock_snapshot.data() después del write
 * @returns {Promise<TransitionResult>}
 */
export async function scanDep12ToDep11Transitions(deps, afterSnap) {
  /** @type {TransitionResult} */
  const out = { migradas: [], skipped: [], errors: [] };
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();

  const whs = parseWhsBreakdown(afterSnap && afterSnap.warehouseBreakdown);

  let openPedidos;
  try {
    openPedidos = await loadOpenPedidos(deps);
  } catch (e) {
    out.errors.push('loadOpenPedidos failed: ' + String(e));
    return out;
  }

  // Candidatos agrupados por pedido para 1 tx cada uno.
  /** @type {Map<string, Array<{lineIndex:number, sku:string, qtyNom:number, asigAtMs:number}>>} */
  const porPedido = new Map();
  for (const p of openPedidos) {
    const lines = Array.isArray(p.data.lines) ? p.data.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || l.state !== 'ASIG' || !l.enTransito) continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      const sku = String(l.code || '').toUpperCase();
      porPedido.set(
        p.id,
        (porPedido.get(p.id) || []).concat([
          {
            lineIndex: i,
            sku,
            qtyNom: qo,
            asigAtMs: toMs(l.asigAt) ?? Number.POSITIVE_INFINITY,
          },
        ])
      );
    }
  }

  // Para evaluar si el físico cubre, necesitamos conocer también las ASIG
  // físicas (no tránsito) del mismo SKU. Simple heurística acá: si
  // `fisicoDep11[sku] >= sum(qtyNom tránsito del SKU)`, migramos TODAS las
  // tránsito del SKU (FIFO por asigAt). Una fórmula más precisa queda para
  // iteración (sobra con lo nominal para el gate de E2).
  /** @type {Map<string, number>} */
  const transitoDemandaPorSku = new Map();
  for (const arr of porPedido.values()) {
    for (const item of arr) {
      transitoDemandaPorSku.set(item.sku, (transitoDemandaPorSku.get(item.sku) || 0) + item.qtyNom);
    }
  }

  // Aplicar por pedido con tx (§58 + §104 derivada 2).
  for (const [pedidoId, items] of porPedido) {
    try {
      await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        const ref = deps.fbDb.collection('pedidos').doc(pedidoId);
        const snap = await tx.get(ref);
        if (!snap.exists) {
          out.skipped.push({ pedidoId, motivo: 'pedido_no_existe' });
          return;
        }
        const data = snap.data() || {};
        const lines = Array.isArray(data.lines) ? data.lines.slice() : [];
        let mutated = false;
        for (const item of items) {
          const orig = lines[item.lineIndex];
          if (!orig || orig.state !== 'ASIG' || !orig.enTransito) {
            // Cambió entre scan y tx (§104). Skip.
            continue;
          }
          const fisico = getQtyFromBreakdown(whs[item.sku] || {}, DEP_FISICO);
          const demanda = transitoDemandaPorSku.get(item.sku) || 0;
          if (fisico < demanda) continue; // no cubre; esperá al próximo delta.
          lines[item.lineIndex] = Object.assign({}, orig, {
            enTransito: false,
            enDep11At: nowIso,
          });
          mutated = true;
          out.migradas.push({
            sku: item.sku,
            pedidoId,
            lineIndex: item.lineIndex,
            cardCode: String(data.clientCardCode || ''),
          });
        }
        if (mutated) {
          tx.update(ref, { lines, updatedAt: nowIso });
        }
      });
    } catch (e) {
      const msg = pedidoId + ': ' + (e && e.message ? e.message : String(e));
      out.errors.push(msg);
      log('scanDep12ToDep11Transitions error', { pedidoId, err: msg });
    }
  }

  for (const m of out.migradas) {
    await logOps(deps, 'asig_cruzo_a_fisico', {
      sku: m.sku,
      pedidoId: m.pedidoId,
      lineIndex: m.lineIndex,
      cardCode: m.cardCode,
    });
  }

  return out;
}

/**
 * Lee el doc de feature flags del Firestore. Si falla o no existe, devuelve
 * objeto vacío (fail-open — scanners quedan desactivados por default).
 *
 * @param {any} deps
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadFeatureFlagsDoc(deps) {
  try {
    const snap = await deps.fbDb.doc('app_config/feature_flags').get();
    if (!snap.exists) return {};
    return snap.data() || {};
  } catch {
    return {};
  }
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function toMs(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const n = Date.parse(v);
    return Number.isNaN(n) ? null : n;
  }
  if (typeof v === 'number') return v;
  // Firestore Timestamp
  if (typeof (/** @type {any} */ (v).toMillis) === 'function') {
    try {
      return /** @type {any} */ (v).toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

// Re-exports para usabilidad en tests.
export { DEP_FISICO, DEP_TRANSITO, INGRESOS_REPARTO_COLLECTION };
