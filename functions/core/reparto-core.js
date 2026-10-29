// @ts-check
/**
 * v1277 (2026-10-14): reparto manual de stock por Pablo. Reemplaza el motor
 * FIFO automatico (eliminado v1279) por un flow asistido:
 *
 *  1. Cada write a `app_config/stock_snapshot` dispara detectDep11Increases.
 *     Para cada SKU con delta positivo en dep 11, se crea un doc en la
 *     coleccion `ingresos_reparto/{autoId}` con:
 *       - sku, qtyIngresada, detectedAt
 *       - clientesBO: lista de lineas state='BO' del SKU en pedidos abiertos
 *       - status: 'pending'
 *
 *  2. Pablo abre el modal "Reparto" en la UI, elige un ingreso pending y
 *     completa manualmente cuanto asigna a cada cliente. El form sube un
 *     callable `applyRepartoManualCF` que:
 *       - Valida: sum(qtyAsignada) <= qtyIngresada; cada qtyAsignada <= qtyOpen
 *         del cliente; status del ingreso aun 'pending'.
 *       - Aplica split por linea (patron v600/v1153 manual-backorder):
 *         * Si qtyAsignada < qtyOpen: 2 lineas resultantes — nueva ASIG con
 *           qtyAsignada + original BO con qtyOpen - qtyAsignada.
 *         * Si qtyAsignada === qtyOpen: linea entera pasa a ASIG.
 *       - Marca ingreso.status='done', appliedAt, appliedBy.
 *
 *  3. Audit log por aplicacion en `reparto_log/{iso}`.
 *
 * Diferencias respecto al FIFO viejo:
 *   - NO automatico (Pablo decide quien recibe).
 *   - Split parcial permitido (puede dar 7u a cliente con BO=20).
 *   - Zero dependencia de cliTipo (P/A/B/C).
 *   - Zero shadow/active mode — directo o nada.
 *
 * Lineas nuevas creadas en el split tienen `asigReserva=true` por default
 * (Pablo las aprobo manualmente — reserva stock fisico). Admin puede
 * destildar despues desde el modal Stock Asignado (v1268).
 */

// v1384 (2026-10-21): import lineReservesStock para la reconciliación de reparto.
// v1391 (2026-10-21): import getStockBreakdown — el reconcile usa el mismo
// cálculo que las pantallas (CLAUDE.md §39). lineReservesStock sigue
// importado SOLO para armar clientesBO[] ordenado FIFO.
import { findZombieAsigLines } from './asig-invariant.js';
import { getStockBreakdown } from './pedido-snapshot-core.js';

const INGRESOS_REPARTO_COLLECTION = 'ingresos_reparto';
const REPARTO_LOG_COLLECTION = 'reparto_log';

/**
 * @typedef {Object} RepartoDeps
 * @property {any} fbDb Firestore Admin instance.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {() => Date} [now] Inyectable para tests.
 *
 * @typedef {Object} ClienteBO
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {string} clientCardCode
 * @property {string} clientName
 * @property {string} clientProvince
 * @property {string} clientLocality
 * @property {string|null} pedidoCreatedAt ISO.
 * @property {number} qtyBackorder qtyOpen de la linea BO.
 *
 * @typedef {Object} IngresoRepartoDoc
 * @property {string} sku
 * @property {number} qtyIngresada Delta positivo detectado en dep 11.
 * @property {string} detectedAt ISO.
 * @property {'pending'|'in_progress'|'done'|'expired'} status
 * @property {ClienteBO[]} clientesBO
 * @property {number} qtyBackorderTotal Suma de qtyBackorder de todos los clientesBO.
 * @property {number} clientesCount
 * @property {string|null} appliedAt
 * @property {string|null} appliedBy
 * @property {Assignment[]|null} assignments Populated al aplicar.
 *
 * @typedef {Object} Assignment
 * @property {string} pedidoId
 * @property {number} lineIndex
 * @property {number} qtyAsignada
 */

/**
 * Parsea warehouseBreakdown que puede venir como JSON string (sync Python v368+)
 * o como objeto (tests). v1279: antes importado de fifo-assign-core; ahora
 * standalone porque ese modulo ya no existe.
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
 * Extrae SKUs con delta positivo en dep 11 comparando warehouseBreakdown
 * before vs after.
 * @param {any} beforeSnap
 * @param {any} afterSnap
 * @returns {Map<string, number>} sku -> delta
 */
export function detectDep11Increases(beforeSnap, afterSnap) {
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
 * Carga pedidos abiertos (closedAt==null) una vez. Reutilizable por multiples
 * SKUs del mismo tick.
 * @param {RepartoDeps} deps
 * @returns {Promise<Array<{id: string, data: () => any}>>}
 */
async function loadOpenPedidos(deps) {
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
  /** @type {Array<{id: string, data: () => any}>} */
  const docs = [];
  snap.forEach((/** @type {any} */ d) => {
    docs.push(d);
  });
  return docs;
}

/**
 * @param {any} v Timestamp Firestore o ISO string o Date.
 * @returns {string|null}
 */
function toIsoSafe(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.toDate === 'function') {
    try {
      return v.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return v.toISOString();
  return null;
}

/**
 * Extrae todos los clientes con lineas state='BO' + qtyOpen>0 del SKU en los
 * pedidos abiertos. Ordenados por `createdAt` ASC (FIFO visual para Pablo —
 * aunque la decision final es manual).
 * @param {Array<{id: string, data: () => any}>} openPedidos
 * @param {string} sku
 * @returns {ClienteBO[]}
 */
export function extractClientesBOForSku(openPedidos, sku) {
  const skuUp = String(sku).toUpperCase();
  /** @type {Array<ClienteBO & { _createdMs: number }>} */
  const preOut = [];
  for (const doc of openPedidos) {
    const data = doc.data() || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || !l.code) continue;
      if (String(l.code).toUpperCase() !== skuUp) continue;
      if (l.state !== 'BO') continue;
      const qtyOpen = Number(l.qtyOpen) || 0;
      if (qtyOpen <= 0) continue;
      let createdMs = 0;
      let createdIso = null;
      if (data.createdAt) {
        if (typeof data.createdAt.toMillis === 'function') {
          createdMs = data.createdAt.toMillis();
          createdIso = toIsoSafe(data.createdAt);
        } else if (typeof data.createdAt === 'string') {
          createdMs = new Date(data.createdAt).getTime() || 0;
          createdIso = data.createdAt;
        }
      }
      preOut.push({
        pedidoId: doc.id,
        lineIndex: i,
        clientCardCode: String(data.clientCardCode || '').trim(),
        clientName: String(data.clientName || '').trim(),
        clientProvince: String(data.province || data.clientProvince || '').trim(),
        clientLocality: String(data.locName || data.clientLocality || '').trim(),
        pedidoCreatedAt: createdIso,
        qtyBackorder: qtyOpen,
        _createdMs: createdMs,
      });
    }
  }
  preOut.sort((a, b) => a._createdMs - b._createdMs || a.pedidoId.localeCompare(b.pedidoId));
  return preOut.map((c) => ({
    pedidoId: c.pedidoId,
    lineIndex: c.lineIndex,
    clientCardCode: c.clientCardCode,
    clientName: c.clientName,
    clientProvince: c.clientProvince,
    clientLocality: c.clientLocality,
    pedidoCreatedAt: c.pedidoCreatedAt,
    qtyBackorder: c.qtyBackorder,
  }));
}

/**
 * Orchestrador: dispara on-write a `app_config/stock_snapshot`. Para cada
 * SKU con delta positivo en dep 11, crea un doc en `ingresos_reparto/`.
 * Lineas sin clientes BO se skippean (no tiene sentido crear un reparto sin
 * destinos — el stock queda libre).
 *
 * Idempotencia: cada tick crea docs frescos. Si el mismo delta se dispara
 * dos veces por retry, se duplicarian. Mitigacion v1: dedupe via campo
 * `dedupeKey = sku + '|' + afterDep11` — ya hay un pending con la misma key,
 * skip. (Simplicidad > perfecto: en practica los deltas unicos son >95% del
 * trafico, el 5% de retries desperdicia 1 doc.)
 *
 * @param {RepartoDeps} deps
 * @param {any} beforeSnap
 * @param {any} afterSnap
 * @returns {Promise<{created: string[], skipped: Array<{sku: string, reason: string}>, errors: string[]}>}
 */
export async function createIngresosRepartoFromDelta(deps, beforeSnap, afterSnap) {
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();
  const deltas = detectDep11Increases(beforeSnap, afterSnap);
  /** @type {string[]} */
  const created = [];
  /** @type {Array<{sku: string, reason: string}>} */
  const skipped = [];
  /** @type {string[]} */
  const errors = [];
  if (deltas.size === 0) {
    return { created, skipped, errors };
  }
  // Load pedidos abiertos UNA sola vez — reusable para todos los SKUs.
  let openPedidos;
  try {
    openPedidos = await loadOpenPedidos(deps);
  } catch (e) {
    errors.push('loadOpenPedidos failed: ' + (e && e.message ? e.message : String(e)));
    return { created, skipped, errors };
  }
  // After snap para computar dedupeKey.
  const after = _parseWarehouseBreakdown(afterSnap);
  for (const [sku, delta] of deltas) {
    try {
      const clientesBO = extractClientesBOForSku(openPedidos, sku);
      if (clientesBO.length === 0) {
        skipped.push({ sku, reason: 'sin clientes BO' });
        continue;
      }
      const qtyBackorderTotal = clientesBO.reduce((s, c) => s + (Number(c.qtyBackorder) || 0), 0);
      const afterDep11 = Number((after[sku] || {})['11']) || 0;
      const dedupeKey = sku + '|' + afterDep11;
      // v1516 §TBD: consolidar en vez de duplicar.
      // Si ya existe un doc pending/in_progress del mismo SKU, sumar
      // qtyIngresada al existente + refrescar clientesBO desde el BO vigente
      // actual. Marcar mergedFromDeltas[] con audit.
      // Precedente: pre-v1516 el dedupe solo matcheaba por `sku|afterDep11`.
      // Si el fisico cambia entre triggers (venta + nuevo ingreso), creaba
      // 2 docs del mismo SKU — bug "FXS70MHC2 x2 cards" reportado 2026-10-28.
      let existingSameSku = null;
      try {
        const existingQ = await deps.fbDb
          .collection(INGRESOS_REPARTO_COLLECTION)
          .where('sku', '==', sku)
          .where('status', 'in', ['pending', 'in_progress'])
          .limit(1)
          .get();
        if (!existingQ.empty) existingSameSku = existingQ.docs[0];
      } catch (_e) {
        log('reparto consolidate query failed', { sku, err: String(_e) });
      }
      if (existingSameSku) {
        const prev = existingSameSku.data() || {};
        const prevQty = Number(prev.qtyIngresada) || 0;
        const newQty = prevQty + delta;
        // Refrescar clientesBO: recalcular desde pedidos actuales
        // (clientesBO ya está computado arriba como `clientesBO`).
        const prevMerged = Array.isArray(prev.mergedFromDeltas) ? prev.mergedFromDeltas : [];
        const auditEntry = {
          at: nowIso,
          delta,
          afterDep11,
          source: 'createIngresosRepartoFromDelta',
          reason: 'consolidate_pending_sku',
        };
        try {
          await deps.fbDb
            .collection(INGRESOS_REPARTO_COLLECTION)
            .doc(existingSameSku.id)
            .update({
              qtyIngresada: newQty,
              clientesBO,
              qtyBackorderTotal,
              clientesCount: clientesBO.length,
              mergedFromDeltas: prevMerged.concat([auditEntry]),
              _lastConsolidatedAt: nowIso,
            });
          skipped.push({
            sku,
            reason: 'consolidated_into:' + existingSameSku.id + ' (new qty ' + newQty + ')',
          });
          continue;
        } catch (updErr) {
          errors.push(
            sku +
              ' consolidation failed: ' +
              (updErr && updErr.message ? updErr.message : String(updErr))
          );
          continue;
        }
      }
      // Dedupe secondary (safety-net): si hay un pending con mismo dedupeKey, skip.
      // v1516: cubierto por consolidate check de arriba en 99% de los casos,
      // pero se preserva por si llega un retry con fisico idéntico (edge case).
      try {
        const existing = await deps.fbDb
          .collection(INGRESOS_REPARTO_COLLECTION)
          .where('dedupeKey', '==', dedupeKey)
          .where('status', '==', 'pending')
          .limit(1)
          .get();
        if (!existing.empty) {
          skipped.push({ sku, reason: 'dedupe (pending existente)' });
          continue;
        }
      } catch (_dedupeErr) {
        // Si el query falla por missing index, loguear y continuar (dedupe
        // best-effort). Index creation request se activara al primer trigger.
        log('reparto dedupe query failed', { sku, err: String(_dedupeErr) });
      }
      /** @type {IngresoRepartoDoc & {dedupeKey: string}} */
      const docData = {
        sku,
        qtyIngresada: delta,
        detectedAt: nowIso,
        status: 'pending',
        clientesBO,
        qtyBackorderTotal,
        clientesCount: clientesBO.length,
        appliedAt: null,
        appliedBy: null,
        assignments: null,
        dedupeKey,
      };
      const ref = await deps.fbDb.collection(INGRESOS_REPARTO_COLLECTION).add(docData);
      created.push(ref.id);
      log('ingreso_reparto creado', { sku, delta, clientes: clientesBO.length, id: ref.id });
    } catch (e) {
      const msg = sku + ': ' + (e && e.message ? e.message : String(e));
      errors.push(msg);
      log('ingreso_reparto error', { sku, err: msg });
    }
  }
  return { created, skipped, errors };
}

/**
 * v1384 (2026-10-21): Reconciliación retrospectiva. Crea `ingresos_reparto`
 * para SKUs que cumplen todas las condiciones:
 *   - Físico dep 11 > 0.
 *   - BO vigente (dentro TTL 7d) > 0 en pedidos abiertos.
 *   - Sin reparto abierto (status pending|in_progress) para ese SKU.
 *
 * Diferencia con createIngresosRepartoFromDelta:
 *   - Ese responde a aumentos del físico (dep11 subió → nuevo stock → reparto).
 *   - Este responde a huecos: físico estable pero reparto nunca disparó porque
 *     no hubo delta. Caso típico: BO viejos + stock físico tapado por otras
 *     reservas; cuando esas reservas se liberan (TTL, cancel), queda stock
 *     disponible pero el delta no se mueve → nadie crea el reparto.
 *
 * Dedupe: `dedupeKey = sku + '|reconciliation|' + fisico`. Combinado con la
 * verificación "sin reparto activo", evita duplicar.
 *
 * `qtyARepartir = max(0, fisico - ASIG_vigentes - confirmed_vigentes)`.
 * Si qtyARepartir <= 0 → skip (nada libre para repartir, aunque haya BO).
 *
 * v1519 (2026-10-28): auto-close de ingresos con `clientesBO` stale.
 *   - Precedente SATO 2026-10-23 (ver CLAUDE.md §64.3): draft_lock creó 2
 *     pedidos SATO que se facturaron/cancelaron antes del reparto. El ingreso
 *     para EDUARDO SATO 21100400100E seguía abierto con `clientesBO` apuntando
 *     a esas líneas con qtyOpen=0 → al apretar "Aplicar reparto" la CF
 *     rechazaba por "linea con qtyOpen=0".
 *   - Fix: si `boVig <= 0` para un SKU con reparto abierto, auto-close con
 *     `closureReason='bo_vigente_cero_auto'` y snapshot `_autoClose.previousValues`
 *     para rollback. Idempotente (status='done' ya no se re-cierra).
 *   - Batch de hasta 500 ops por invocación.
 *
 * @param {RepartoDeps} deps
 * @param {any} snapshot - stock_snapshot.warehouseBreakdown
 * @returns {Promise<{created: string[], skipped: Array<{sku:string, reason:string}>, errors: string[], autoCerrados: string[]}>}
 */
export async function reconcileRepartosFaltantes(deps, snapshot) {
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const whsBreakdown = _parseWarehouseBreakdown(snapshot);
  /** @type {string[]} */
  const created = [];
  /** @type {Array<{sku: string, reason: string}>} */
  const skipped = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const autoCerrados = [];

  // 1. SKUs con reparto activo (dedupe + ajuste + auto-close v1519).
  // v1392 §40: ya NO solo "skip si existe"; también ajustar qtyIngresada
  // cuando el reparto activo supera BO vigente.
  // v1519: guardamos data completa para poder auto-cerrar con snapshot
  // en `_autoClose.previousValues`.
  /** @type {Map<string, {id:string, qtyIng:number, assignmentsSum:number, status:string, data:any}>} */
  const repartosActivos = new Map();
  try {
    const activosSnap = await deps.fbDb
      .collection(INGRESOS_REPARTO_COLLECTION)
      .where('status', 'in', ['pending', 'in_progress'])
      .get();
    activosSnap.forEach((/** @type {any} */ d) => {
      const data = d.data() || {};
      if (!data.sku) return;
      const sku = String(data.sku).toUpperCase();
      const assignments = /** @type {any[]} */ (
        Array.isArray(data.assignments) ? data.assignments : []
      );
      /** @type {number} */
      let asignadoYa = 0;
      for (const a of assignments) asignadoYa += Number((a && a.qtyAsignada) || 0);
      repartosActivos.set(sku, {
        id: d.id,
        qtyIng: Number(data.qtyIngresada) || 0,
        assignmentsSum: asignadoYa,
        status: String(data.status || 'pending'),
        data,
      });
    });
  } catch (e) {
    errors.push(
      'reconcile: query ingresos_reparto activos fallo: ' + (e && e.message ? e.message : String(e))
    );
    return { created, skipped, errors, autoCerrados };
  }
  const skusConReparto = new Set(repartosActivos.keys());

  // 2. Pedidos abiertos (una sola vez).
  let openPedidos;
  try {
    openPedidos = await loadOpenPedidos(deps);
  } catch (e) {
    errors.push('reconcile: loadOpenPedidos fallo: ' + (e && e.message ? e.message : String(e)));
    return { created, skipped, errors, autoCerrados };
  }

  // 3. Para cada SKU con fisico > 0 → delegar cálculo a getStockBreakdown
  //    (CLAUDE.md §39: una sola fuente de verdad). lineReservesStock sigue
  //    usándose SOLO para armar el shape clientesBO[] FIFO del doc nuevo.
  //    Shape de pedidos: ya expandido en openPedidos (array de QueryDocumentSnapshot).
  const pedidosData = openPedidos.map((d) => Object.assign({ _fsId: d.id }, d.data() || {}));
  // v1519: colección de auto-close para flushear en batch(es) después del loop
  // (patrón acumulativo, hasta 500 writes por batch — límite Firestore).
  /** @type {Array<{id:string, sku:string, previousStatus:string, previousClientesBO:any[]}>} */
  const autoCloseOps = [];
  for (const [skuRaw, whs] of Object.entries(whsBreakdown)) {
    const sku = String(skuRaw).toUpperCase();
    try {
      const fisico = Number(whs['11']) || 0;
      if (fisico <= 0) continue;
      // Breakdown v2: boVig + asig + conf; NO depende de reparto activo.
      const breakdown = getStockBreakdown(
        sku,
        { getStockFisico: () => fisico, pedidos: pedidosData },
        { now: nowMs }
      );
      const boVig = breakdown.backorderApp.total;
      if (boVig <= 0) {
        if (skusConReparto.has(sku)) {
          // v1519 §64.3: hay reparto abierto PERO sin BO vigente → auto-close.
          // Antes (<=v1518) solo skipeaba con reason='reparto_activo_sin_bo_vigente'
          // y el ingreso quedaba abierto para siempre con `clientesBO` stale.
          // Al apretar "Aplicar reparto" la CF rechazaba por "linea con qtyOpen=0".
          // Precedente SATO 2026-10-23 (doble pedido via draft_lock), ambos
          // facturados/cancelados.
          const activo = repartosActivos.get(sku);
          if (activo) {
            // Idempotente: si ya está en status='done', NO reencolamos.
            if (activo.status === 'done') {
              skipped.push({ sku, reason: 'ya_cerrado' });
            } else {
              autoCloseOps.push({
                id: activo.id,
                sku,
                previousStatus: activo.status,
                previousClientesBO: Array.isArray(activo.data && activo.data.clientesBO)
                  ? activo.data.clientesBO
                  : [],
              });
            }
          } else {
            // Edge case: skusConReparto decía true pero el map no tiene entry
            // (shouldn't happen; defensive).
            skipped.push({ sku, reason: 'reparto_activo_sin_bo_vigente' });
          }
        } else {
          skipped.push({ sku, reason: 'sin_bo_vigente' });
        }
        continue;
      }
      // v1392 §40 fórmula qtyARepartir = min(fisico - asig - conf, BO vigente).
      const qtyARepartir = Math.max(
        0,
        Math.min(fisico - breakdown.asignadas.total - breakdown.confirmadasSinFacturar.total, boVig)
      );
      if (qtyARepartir <= 0) {
        skipped.push({
          sku,
          reason:
            'libre_cero (fisico=' +
            fisico +
            ' asig=' +
            breakdown.asignadas.total +
            ' conf=' +
            breakdown.confirmadasSinFacturar.total +
            ' boVig=' +
            boVig +
            ')',
        });
        continue;
      }
      // Si ya existe reparto activo → ajustar qtyIngresada si supera qtyARepartir.
      const activo = repartosActivos.get(sku);
      if (activo) {
        const pendiente = Math.max(0, activo.qtyIng - activo.assignmentsSum);
        if (pendiente > qtyARepartir) {
          // Ajustar: nueva qtyIngresada = assignmentsSum + qtyARepartir (preserva asignaciones).
          const newQtyIng = activo.assignmentsSum + qtyARepartir;
          try {
            await deps.fbDb.collection(INGRESOS_REPARTO_COLLECTION).doc(activo.id).update({
              qtyIngresada: newQtyIng,
              adjustedAt: nowIso,
              adjustedReason: 'bo_vigente_bajo',
            });
            log('reparto_ajustado', {
              sku,
              id: activo.id,
              qtyIngOld: activo.qtyIng,
              qtyIngNew: newQtyIng,
              assignmentsSum: activo.assignmentsSum,
              boVig,
            });
            skipped.push({
              sku,
              reason: 'reparto_ajustado (qty ' + activo.qtyIng + ' -> ' + newQtyIng + ')',
            });
          } catch (e) {
            errors.push(
              'reparto_ajuste fallo sku=' + sku + ': ' + (e && e.message ? e.message : String(e))
            );
          }
        } else {
          skipped.push({ sku, reason: 'reparto_activo_qty_ok' });
        }
        continue;
      }
      // clientesBO[] FIFO: construido iterando pedidos (shape del doc requiere
      // clientProvince/clientLocality/pedidoCreatedAt que breakdown no provee).
      /** @type {Array<ClienteBO & { _createdMs: number }>} */
      const preClientesBO = [];
      for (const doc of openPedidos) {
        const data = doc.data() || {};
        const lines = Array.isArray(data.lines) ? data.lines : [];
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (!l || !l.code) continue;
          if (String(l.code).toUpperCase() !== sku) continue;
          if (l.state !== 'BO') continue;
          const qo = Number(l.qtyOpen) || 0;
          if (qo <= 0) continue;
          // v1392 §40: lineReservesStock('BO') ahora es false. Usamos filtro
          // TTL 90d directo para considerar la cola vigente (misma lógica
          // que breakdown.backorderApp).
          if (data.createdAt) {
            const createdMsCheck =
              typeof data.createdAt === 'string'
                ? Date.parse(data.createdAt)
                : data.createdAt && typeof data.createdAt.toMillis === 'function'
                  ? data.createdAt.toMillis()
                  : null;
            if (createdMsCheck !== null && (nowMs - createdMsCheck) / (24 * 60 * 60 * 1000) > 90)
              continue;
          }
          let createdMs = 0;
          let createdIso = null;
          if (data.createdAt) {
            if (typeof data.createdAt.toMillis === 'function') {
              try {
                createdMs = data.createdAt.toMillis();
              } catch {
                createdMs = 0;
              }
              createdIso = toIsoSafe(data.createdAt);
            } else if (typeof data.createdAt === 'string') {
              createdMs = Date.parse(data.createdAt) || 0;
              createdIso = data.createdAt;
            }
          }
          preClientesBO.push({
            pedidoId: doc.id,
            lineIndex: i,
            clientCardCode: String(data.clientCardCode || '').trim(),
            clientName: String(data.clientName || '').trim(),
            clientProvince: String(data.province || data.clientProvince || '').trim(),
            clientLocality: String(data.locName || data.clientLocality || '').trim(),
            pedidoCreatedAt: createdIso,
            qtyBackorder: qo,
            _createdMs: createdMs,
          });
        }
      }
      preClientesBO.sort(
        (a, b) => a._createdMs - b._createdMs || a.pedidoId.localeCompare(b.pedidoId)
      );
      /** @type {ClienteBO[]} */
      const clientesBO = preClientesBO.map(({ _createdMs: _unused, ...rest }) => rest);
      const dedupeKey = sku + '|reconciliation|' + fisico;
      const docData = {
        sku,
        qtyIngresada: qtyARepartir,
        detectedAt: nowIso,
        status: 'pending',
        clientesBO,
        qtyBackorderTotal: boVig,
        clientesCount: clientesBO.length,
        appliedAt: null,
        appliedBy: null,
        assignments: null,
        source: 'reconciliation', // v1384
        dedupeKey,
      };
      const ref = await deps.fbDb.collection(INGRESOS_REPARTO_COLLECTION).add(docData);
      created.push(ref.id);
      log('reparto_reconciliado creado', { sku, qtyARepartir, boVig, id: ref.id });
    } catch (e) {
      const msg = sku + ': ' + (e && e.message ? e.message : String(e));
      errors.push(msg);
      log('reparto_reconciliado error', { sku, err: msg });
    }
  }

  // v1519: flush de auto-close en batch(es) de hasta 500 (límite Firestore).
  if (autoCloseOps.length > 0) {
    const BATCH_LIMIT = 500;
    for (let i = 0; i < autoCloseOps.length; i += BATCH_LIMIT) {
      const chunk = autoCloseOps.slice(i, i + BATCH_LIMIT);
      try {
        const batch = deps.fbDb.batch();
        for (const op of chunk) {
          const ref = deps.fbDb.collection(INGRESOS_REPARTO_COLLECTION).doc(op.id);
          batch.update(ref, {
            status: 'done',
            appliedAt: nowIso,
            appliedBy: 'system:reconcileRepartosFaltantes',
            closureReason: 'bo_vigente_cero_auto',
            _autoClose: {
              at: nowIso,
              reason: 'bo_vigente_cero_detected_in_reconcile',
              previousValues: {
                status: op.previousStatus,
                clientesBO: op.previousClientesBO,
              },
            },
          });
        }
        await batch.commit();
        for (const op of chunk) {
          autoCerrados.push(op.id);
          log('reparto_auto_cerrado', {
            sku: op.sku,
            id: op.id,
            previousStatus: op.previousStatus,
            reason: 'bo_vigente_cero_auto',
          });
        }
      } catch (e) {
        const msg =
          'auto-close batch (' +
          chunk.length +
          ' ops) fallo: ' +
          (e && e.message ? e.message : String(e));
        errors.push(msg);
        log('reparto_auto_cerrado error', { chunkSize: chunk.length, err: msg });
      }
    }
  }

  return { created, skipped, errors, autoCerrados };
}

/**
 * Valida un payload de reparto manual sin aplicar nada. Reusable por
 * applyRepartoManualCore y por tests.
 *
 * v1312 (2026-10-15): rediseno 3-way. Reglas:
 *   - assignments[] (asig>0) y eliminations[] (elim>0) como arrays separados.
 *   - Por cliente (pedidoId|lineIndex): asig + elim <= qtyBackorder (sin
 *     sobre-asignacion; decidido por Mariano al rediseñar la UI).
 *   - Sum global asig se valida contra stock fisico en applyRepartoManualCore
 *     (requiere I/O async).
 *   - Debe haber AL MENOS una accion (assignment o elimination). Si ambos
 *     vacios, error.
 *
 * @param {IngresoRepartoDoc} ingresoDoc
 * @param {Assignment[]} assignments
 * @param {Array<{pedidoId: string, lineIndex: number, qtyEliminar: number}>} [eliminations]
 * @returns {{valid: boolean, errors: string[], sumAsignada?: number, sumEliminada?: number}}
 */
/**
 * @param {any} ingresoDoc
 * @param {Array<any>} [assignments]
 * @param {Array<any>} [eliminations]
 * @param {{allowSobrante?: boolean, nowMs?: number}} [opts]
 */
export function validateRepartoPayload(ingresoDoc, assignments, eliminations, opts) {
  /** @type {string[]} */
  const errors = [];
  if (!ingresoDoc) {
    errors.push('ingreso_reparto no encontrado');
    return { valid: false, errors };
  }
  // v1525: in_progress de la version vieja con lock > 2 min se acepta
  // (el intento anterior corto; la pantalla muestra lo que falta hoy).
  const nowMs = opts && typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  if (!ingresoAceptaReparto(ingresoDoc, nowMs)) {
    errors.push('ingreso ya aplicado o cancelado (status=' + ingresoDoc.status + ')');
  }
  const asigArr = Array.isArray(assignments) ? assignments : [];
  const elimArr = Array.isArray(eliminations) ? eliminations : [];
  // v1392 §40: con allowSobrante=true, permitir asig+elim=0 (Pablo cierra con sobrante).
  const allowSobrante = !!(opts && opts.allowSobrante);
  if (!allowSobrante && asigArr.length === 0 && elimArr.length === 0) {
    errors.push('assignments y eliminations vacios (nada que aplicar)');
    return { valid: false, errors };
  }
  // Mapa pedidoId|lineIndex -> clienteBO para lookup rapido.
  /** @type {Map<string, ClienteBO>} */
  const boMap = new Map();
  for (const c of ingresoDoc.clientesBO || []) {
    boMap.set(c.pedidoId + '|' + c.lineIndex, c);
  }
  // Acumular asig + elim por cliente para validar sum <= qtyBackorder.
  /** @type {Map<string, {asig: number, elim: number}>} */
  const perLine = new Map();
  let sumAsignada = 0;
  for (const a of asigArr) {
    const qty = Number(a.qtyAsignada) || 0;
    if (qty <= 0) {
      errors.push('assignment con qtyAsignada <= 0 (pedido ' + a.pedidoId + ')');
      continue;
    }
    // v1343 (2026-10-15): validacion "esta en boMap" REMOVIDA. El `clientesBO`
    // es un snapshot al crear el ingreso; puede quedar stale si entre tanto
    // otro flow modifico el pedido. La validacion real (line.state='BO' +
    // line.code===ingresoDoc.sku + qtyOpen>0) ocurre DENTRO del runTransaction
    // en applyRepartoManualCore. Esto evita falsos "no coincide con ningun
    // cliente BO" cuando Pablo intenta repartir sobre un pedido que fue
    // sincronizado tras la creacion del ingreso.
    const key = a.pedidoId + '|' + a.lineIndex;
    const entry = perLine.get(key) || { asig: 0, elim: 0 };
    entry.asig += qty;
    perLine.set(key, entry);
    sumAsignada += qty;
  }
  let sumEliminada = 0;
  for (const e of elimArr) {
    const qty = Number(e.qtyEliminar) || 0;
    if (qty <= 0) {
      errors.push('elimination con qtyEliminar <= 0 (pedido ' + e.pedidoId + ')');
      continue;
    }
    // v1343: idem assignments. Validacion real en runTransaction.
    const key = e.pedidoId + '|' + e.lineIndex;
    const entry = perLine.get(key) || { asig: 0, elim: 0 };
    entry.elim += qty;
    perLine.set(key, entry);
    sumEliminada += qty;
  }
  // v1338 (2026-10-15): validacion "asig+elim <= qtyBackorder" REMOVIDA
  // completamente. Sobre-asignacion permitida — Mariano toma la
  // responsabilidad al autorizar. El backend acepta asig > qo expandiendo
  // la linea; qr queda en 0 si asig+elim > qo (no se vuelve negativo).
  return { valid: errors.length === 0, errors, sumAsignada, sumEliminada };
}

/**
 * Aplica un reparto manual. Transaccional por linea (dentro de runTransaction).
 *
 * v1312 (2026-10-15) rediseno 3-way: por cada clientBO se puede asignar
 * (asig>0, pasa a ASIG), eliminar (elim>0, se cancela el BO parcial o total)
 * o ambos. La porcion remanente (qtyOpen - asig - elim) queda en BO
 * esperando. assignments y eliminations se merge por (pedidoId, lineIndex)
 * para hacer 1 transaccion por linea.
 *
 * Casos resultantes por linea (qo=qtyOpen original, qr=qtyMantenerBO=qo-asig-elim):
 *   - asig>0, elim=0, qr>0  → split 2-way: BO(qr) + ASIG(asig)
 *   - asig>0, elim=0, qr=0  → linea entera pasa a ASIG
 *   - asig=0, elim>0, qr>0  → linea original: qtyOpen=qr, qtyCancelled+=elim
 *   - asig=0, elim>0, qr=0  → linea entera cancelled
 *   - asig>0, elim>0, qr>0  → linea original: qtyOpen=qr, qtyCancelled+=elim; append ASIG(asig)
 *   - asig>0, elim>0, qr=0  → linea original cancelled (qtyCancelled+=elim); append ASIG(asig)
 *
 * @param {RepartoDeps} deps
 * @param {Object} opts
 * @param {string} opts.ingresoId
 * @param {Assignment[]} opts.assignments
 * @param {Array<{pedidoId: string, lineIndex: number, qtyEliminar: number}>} [opts.eliminations]
 * @param {string} opts.appliedByEmail Email del user que aplica (audit).
 * @param {boolean} [opts.allowSobrante] v1392 §40: cerrar con sobrante.
 * @returns {Promise<{ok: boolean, errors: string[], applied: Assignment[], eliminated?: Array<{pedidoId: string, lineIndex: number, qtyEliminada: number}>, skipped?: Array<{pedidoId: string, lineIndex: number, motivo: string}>}>}
 */
export async function applyRepartoManualCore(deps, opts) {
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();
  const ingresoRef = deps.fbDb.collection(INGRESOS_REPARTO_COLLECTION).doc(opts.ingresoId);
  const snap = await ingresoRef.get();
  if (!snap.exists) {
    return { ok: false, errors: ['ingreso_reparto no encontrado: ' + opts.ingresoId], applied: [] };
  }
  const ingresoDoc = /** @type {IngresoRepartoDoc} */ (snap.data() || {});
  const validation = validateRepartoPayload(ingresoDoc, opts.assignments, opts.eliminations, {
    allowSobrante: opts.allowSobrante === true,
    nowMs: now.getTime(),
  });
  if (!validation.valid) {
    return { ok: false, errors: validation.errors, applied: [] };
  }
  // v1309 (2026-10-15): cap contra STOCK FISICO ACTUAL dep 11, no qtyIngresada
  // (delta del ingreso). Pedido Mariano: UI muestra stock real (ej. 64u) en vez
  // del delta (ej. 13u), por lo que el cap tambien debe reflejar stock fisico.
  let stockFisicoDep11 = 0;
  try {
    const stockSnap = await deps.fbDb.collection('app_config').doc('stock_snapshot').get();
    const stockData = stockSnap.exists ? stockSnap.data() : null;
    const wbs = _parseWarehouseBreakdown(stockData);
    const skuKey = String(ingresoDoc.sku || '')
      .toUpperCase()
      .trim();
    const whs = (wbs && wbs[skuKey]) || null;
    stockFisicoDep11 = whs ? Number(whs['11'] || 0) : 0;
  } catch (stockErr) {
    log('stock_snapshot read fail', { err: stockErr && stockErr.message });
    return {
      ok: false,
      errors: [
        'no se pudo leer stock_snapshot para validar cap: ' +
          (stockErr && stockErr.message ? stockErr.message : String(stockErr)),
      ],
      applied: [],
    };
  }
  // v1312: cap global de ASIG (eliminations NO cuentan — no reservan stock).
  const sumAsigValid = Number(validation.sumAsignada) || 0;
  if (sumAsigValid > stockFisicoDep11) {
    return {
      ok: false,
      errors: [
        'sum assignments=' +
          sumAsigValid +
          ' > stock fisico dep 11 actual=' +
          stockFisicoDep11 +
          ' (sobre-reparto, sin stock real para cubrir)',
      ],
      applied: [],
    };
  }

  // v1312: combinar assignments + eliminations por (pedidoId, lineIndex).
  /** @type {Map<string, {pedidoId: string, lineIndex: number, asig: number, elim: number}>} */
  const actionsByLine = new Map();
  const _asigArr = Array.isArray(opts.assignments) ? opts.assignments : [];
  const _elimArr = Array.isArray(opts.eliminations) ? opts.eliminations : [];
  for (const a of _asigArr) {
    const key = a.pedidoId + '|' + a.lineIndex;
    const entry = actionsByLine.get(key) || {
      pedidoId: a.pedidoId,
      lineIndex: a.lineIndex,
      asig: 0,
      elim: 0,
    };
    entry.asig += Number(a.qtyAsignada) || 0;
    actionsByLine.set(key, entry);
  }
  for (const e of _elimArr) {
    const key = e.pedidoId + '|' + e.lineIndex;
    const entry = actionsByLine.get(key) || {
      pedidoId: e.pedidoId,
      lineIndex: e.lineIndex,
      asig: 0,
      elim: 0,
    };
    entry.elim += Number(e.qtyEliminar) || 0;
    actionsByLine.set(key, entry);
  }
  const allowSobrante = opts.allowSobrante === true;
  const skuUp = String(ingresoDoc.sku || '')
    .toUpperCase()
    .trim();

  // v1525 (2026-10-29): TODO el reparto en UNA transaccion. Antes: lock
  // status=in_progress + 1 transaccion por linea, en serie. Con 15 clientes
  // eran 15 rondas (cada una releyendo el stock_snapshot entero y chocando con
  // onPedidoWriteRecalcSnapshot, que escribe ese mismo doc) -> lento, y si la
  // CF cortaba a los 60 s el ingreso quedaba in_progress para siempre con la
  // mitad aplicada (LUGC22 / BALTICA20LG / CVL401, 2026-10-28 18:49).
  // Ahora: se lee todo una vez, se calcula y se escribe junto. Si algo aborta,
  // no se aplica nada y el ingreso sigue pending (nunca queda trabado).
  // Lineas que ya no estan en BO (asignadas antes, facturadas, borradas) se
  // saltean con aviso en `skipped`; no son error.
  /** @type {Assignment[]} */
  let applied = [];
  /** @type {Array<{pedidoId: string, lineIndex: number, qtyEliminada: number}>} */
  let eliminated = [];
  /** @type {string[]} */
  let errors = [];
  /** @type {Array<{pedidoId: string, lineIndex: number, motivo: string}>} */
  let skipped = [];
  let nextStatus = 'pending';
  /** @type {Record<string, any>} */
  let updatePayload = {};
  try {
    await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
      // Reset por si Firestore reintenta la transaccion.
      applied = [];
      eliminated = [];
      errors = [];
      skipped = [];
      // === FASE READ (§58: todos los reads antes de cualquier write) ===
      const ingSnapTx = await tx.get(ingresoRef);
      const ingTx = ingSnapTx.exists ? ingSnapTx.data() || {} : null;
      if (!ingTx || !ingresoAceptaReparto(ingTx, now.getTime())) {
        throw Object.assign(new Error('ingreso ya aplicado o cancelado'), { _abort: true });
      }
      // E5 §stock-servidor-atomico (v1433): re-leer stock DENTRO de la txn.
      const stockSnapInTx = await tx.get(deps.fbDb.collection('app_config').doc('stock_snapshot'));
      const stockDataInTx = stockSnapInTx.exists ? stockSnapInTx.data() : null;
      const wbsInTx = _parseWarehouseBreakdown(stockDataInTx);
      const whsInTx = (wbsInTx && wbsInTx[skuUp]) || null;
      const fisicoInTx = whsInTx ? Number(whsInTx['11'] || 0) : 0;
      if (fisicoInTx < stockFisicoDep11) {
        throw Object.assign(
          new Error(
            'E5 stock físico bajó durante aplicación (' +
              stockFisicoDep11 +
              ' → ' +
              fisicoInTx +
              ') SKU=' +
              skuUp
          ),
          { _abort: true }
        );
      }
      const currentAsig =
        stockDataInTx && stockDataInTx.asigBySkuApp
          ? Number(stockDataInTx.asigBySkuApp[skuUp] || 0)
          : null;
      /** @type {Map<string, {ref: any, exists: boolean, data: any}>} */
      const pedidos = new Map();
      for (const action of actionsByLine.values()) {
        if (pedidos.has(action.pedidoId)) continue;
        const ref = deps.fbDb.collection('pedidos').doc(action.pedidoId);
        const s = await tx.get(ref);
        pedidos.set(action.pedidoId, {
          ref,
          exists: !!s.exists,
          data: s.exists ? s.data() || {} : null,
        });
      }

      // === FASE COMPUTE ===
      /** @type {Map<string, any[]>} lineas modificadas por pedido */
      const workLines = new Map();
      for (const action of actionsByLine.values()) {
        const where = action.pedidoId + ':' + action.lineIndex;
        const asig = asig0(action);
        const elim = elim0(action);
        const p = pedidos.get(action.pedidoId);
        if (!p || !p.exists) {
          skipped.push({ ...ref0(action), motivo: 'pedido no existe' });
          continue;
        }
        const baseLines =
          workLines.get(action.pedidoId) || (Array.isArray(p.data.lines) ? [...p.data.lines] : []);
        const line = baseLines[action.lineIndex];
        if (!line) {
          skipped.push({ ...ref0(action), motivo: 'linea no existe' });
          continue;
        }
        // v1343: guard de SKU (payload erroneo no asigna stock de otro SKU).
        const lineSku = String(line.code || '')
          .toUpperCase()
          .trim();
        if (lineSku !== skuUp) {
          errors.push(
            'line SKU no coincide con ingreso (line.code=' +
              line.code +
              ' vs ingreso.sku=' +
              ingresoDoc.sku +
              ') @ ' +
              where
          );
          continue;
        }
        // Linea ya repartida/facturada/cancelada desde que se armo la pantalla:
        // no es error, se saltea (no se asigna dos veces).
        if (line.state !== 'BO') {
          skipped.push({
            ...ref0(action),
            motivo: 'ya no espera stock (state=' + line.state + ')',
          });
          continue;
        }
        const qo = Number(line.qtyOpen) || 0;
        if (qo <= 0) {
          skipped.push({ ...ref0(action), motivo: 'no le queda nada pendiente' });
          continue;
        }
        // E5: ASIG actual + nueva no puede exceder el fisico actual.
        if (currentAsig !== null && currentAsig + asig > fisicoInTx) {
          errors.push(
            'E5 reparto excedería físico actual: asigActual=' +
              currentAsig +
              ' + newAsig=' +
              asig +
              ' > fisico=' +
              fisicoInTx +
              ' SKU=' +
              skuUp +
              ' @ ' +
              where
          );
          continue;
        }
        const lines = [...baseLines];
        // v1338: asig+elim > qo permitido (sobre-asignacion); qr nunca negativo.
        const qr = Math.max(0, qo - asig - elim);
        const newOrig = Object.assign({}, line, {
          qtyCancelled: (Number(line.qtyCancelled) || 0) + elim,
          qtyOpen: qr,
        });
        if (qr === 0 && asig > 0 && elim === 0) {
          newOrig.qtyOpen = asig;
          newOrig.state = 'ASIG';
          newOrig.asigAt = nowIso;
          newOrig.asigReserva = true;
          newOrig.asigFromReparto = opts.ingresoId;
          lines[action.lineIndex] = newOrig;
        } else if (qr === 0 && elim > 0) {
          newOrig.state = 'cancelled';
          newOrig.cancelledAt = nowIso;
          newOrig.cancelledFrom = 'reparto-eliminado';
          newOrig.cancelledFromIngreso = opts.ingresoId;
          lines[action.lineIndex] = newOrig;
          if (asig > 0) {
            lines.push(_buildAsigLine(line, asig, nowIso, opts.ingresoId, action.lineIndex));
          }
        } else {
          lines[action.lineIndex] = newOrig;
          if (asig > 0) {
            lines.push(_buildAsigLine(line, asig, nowIso, opts.ingresoId, action.lineIndex));
          }
        }
        // v1520 invariante §104: ninguna linea tocada queda ASIG con qtyOpen<=0.
        const _prevLen = baseLines.length;
        const _zombies = findZombieAsigLines(lines).filter(
          (i) => i === action.lineIndex || i >= _prevLen
        );
        if (_zombies.length > 0) {
          errors.push(
            'invariante: ASIG con qtyOpen=0 en lineas ' + _zombies.join(',') + ' @ ' + where
          );
          continue;
        }
        workLines.set(action.pedidoId, lines);
        if (asig > 0) {
          applied.push({
            pedidoId: action.pedidoId,
            lineIndex: action.lineIndex,
            qtyAsignada: asig,
          });
        }
        if (elim > 0) {
          eliminated.push({
            pedidoId: action.pedidoId,
            lineIndex: action.lineIndex,
            qtyEliminada: elim,
          });
        }
      }

      // Estado final. Nunca 'in_progress': o queda done, o sigue pending
      // (con lo aplicado ya guardado) para reintentar desde la pantalla.
      const touched = applied.length + eliminated.length;
      /** @type {any[]} */
      const prevAssignments = Array.isArray(ingTx.assignments) ? ingTx.assignments : [];
      /** @type {any[]} */
      const prevEliminations = Array.isArray(ingTx.eliminations) ? ingTx.eliminations : [];
      const allAssignments = prevAssignments.concat(applied);
      const allEliminations = prevEliminations.concat(eliminated);
      nextStatus = errors.length === 0 && (touched > 0 || allowSobrante) ? 'done' : 'pending';
      const sumIngresada = Number(ingresoDoc.qtyIngresada) || 0;
      const sumAsigTotal = allAssignments.reduce((s, a) => s + (Number(a.qtyAsignada) || 0), 0);
      const sumElimTotal = allEliminations.reduce((s, e) => s + (Number(e.qtyEliminada) || 0), 0);
      const sobrante = Math.max(0, sumIngresada - sumAsigTotal - sumElimTotal);
      updatePayload = {
        status: nextStatus,
        appliedAt: nowIso,
        appliedBy: opts.appliedByEmail || '',
        assignments: allAssignments,
        eliminations: allEliminations,
        assignmentErrors: errors,
        assignmentSkipped: skipped,
        lockedAt: null,
        lockedBy: null,
      };
      if (nextStatus === 'done' && sobrante > 0) {
        updatePayload.closedReason = allowSobrante
          ? 'admin_cerrado_con_sobrante_' + sobrante + '_libres'
          : 'done_con_sobrante_' + sobrante;
        updatePayload.sobranteLibre = sobrante;
      }
      // Medir ventana ingreso→reparto: tiempo entre detectedAt y appliedAt.
      if (nextStatus === 'done' && ingresoDoc.detectedAt) {
        const detectedMs =
          typeof ingresoDoc.detectedAt === 'string' ? Date.parse(ingresoDoc.detectedAt) : null;
        if (detectedMs !== null)
          updatePayload.ventanaIngresoARepartoMs = now.getTime() - detectedMs;
      }

      // === FASE WRITE ===
      for (const [pedidoId, lines] of workLines) {
        tx.update(/** @type {any} */ (pedidos.get(pedidoId)).ref, { lines, updatedAt: nowIso });
      }
      // Si no se toco nada y no es cierre con sobrante, el ingreso queda igual.
      if (touched > 0 || allowSobrante || nextStatus !== ingTx.status) {
        tx.update(ingresoRef, updatePayload);
      }
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    log('reparto abortado', { ingresoId: opts.ingresoId, err: msg });
    return { ok: false, errors: [msg], applied: [], eliminated: [], skipped: [] };
  }
  log('reparto aplicado', {
    ingresoId: opts.ingresoId,
    applied: applied.length,
    eliminated: eliminated.length,
    skipped: skipped.length,
    errors: errors.length,
    status: nextStatus,
  });
  // Audit log. v1277 IMPORTANT-6 fix: no silent swallow.
  try {
    await deps.fbDb.collection(REPARTO_LOG_COLLECTION).add({
      ingresoId: opts.ingresoId,
      sku: ingresoDoc.sku,
      qtyIngresada: ingresoDoc.qtyIngresada,
      stockFisicoDep11,
      appliedAt: nowIso,
      appliedBy: opts.appliedByEmail || '',
      assignmentsCount: applied.length,
      eliminationsCount: eliminated.length,
      skippedCount: skipped.length,
      errorsCount: errors.length,
      errors: errors.slice(0, 10),
      status: nextStatus,
    });
  } catch (logErr) {
    const msg =
      'audit log write failed (reparto aplicado OK): ' +
      (logErr && logErr.message ? logErr.message : String(logErr));
    log('reparto_log write failed', { ingresoId: opts.ingresoId, err: msg });
    errors.push(msg);
  }
  const touched = applied.length + eliminated.length;
  if (errors.length === 0 && touched === 0 && !allowSobrante) {
    errors.push(
      'nada para aplicar: esos clientes ya no esperan stock (ya asignados, facturados o borrados)'
    );
  }
  return { ok: errors.length === 0, errors, applied, eliminated, skipped };
}

/**
 * v1525: un ingreso acepta reparto si esta pending, o si quedo in_progress
 * de la version vieja (lock por linea) y el lock tiene mas de 2 minutos.
 * @param {any} ingresoDoc
 * @param {number} nowMs
 */
function ingresoAceptaReparto(ingresoDoc, nowMs) {
  if (!ingresoDoc) return false;
  if (ingresoDoc.status === 'pending') return true;
  if (ingresoDoc.status !== 'in_progress') return false;
  const lockMs = toMillisSafeReparto(ingresoDoc.lockedAt || ingresoDoc.appliedAt);
  return lockMs === null || nowMs - lockMs > STALE_LOCK_MS;
}

const STALE_LOCK_MS = 2 * 60 * 1000;

/** @param {any} v */
function toMillisSafeReparto(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

/** @param {{pedidoId: string, lineIndex: number}} action */
function ref0(action) {
  return { pedidoId: action.pedidoId, lineIndex: action.lineIndex };
}

// v1312 helpers.
/** @param {{asig?: number}} action */
function asig0(action) {
  return Math.max(0, Number(action.asig) || 0);
}
/** @param {{elim?: number}} action */
function elim0(action) {
  return Math.max(0, Number(action.elim) || 0);
}

/**
 * Construye una nueva linea state='ASIG' para el reparto (patron v600/v1277).
 * Whitelist de campos safe (NO hereda qtyInvoiced/qtyCancelled/qtyRecycled/
 * transferidoSAP del origen).
 * @param {any} origLine
 * @param {number} qty
 * @param {string} nowIso
 * @param {string} ingresoId
 * @param {number} splitFromIdx
 */
function _buildAsigLine(origLine, qty, nowIso, ingresoId, splitFromIdx) {
  return {
    code: origLine.code,
    desc: origLine.desc || '',
    cat: origLine.cat || '',
    fam: origLine.fam || '',
    sub: origLine.sub || '',
    qty,
    qtyOpen: qty,
    qtyInvoiced: 0,
    qtyCancelled: 0,
    qtyRecycled: 0,
    recycledIntoPedidoId: null,
    precio: Number(origLine.precio) || 0,
    priceAtCreation: Number(origLine.priceAtCreation) || Number(origLine.precio) || 0,
    needsReview: false,
    targetMonth: origLine.targetMonth || null,
    targetMonthIdx:
      origLine.targetMonthIdx !== null && origLine.targetMonthIdx !== undefined
        ? origLine.targetMonthIdx
        : null,
    targetYear: origLine.targetYear || null,
    state: 'ASIG',
    asigAt: nowIso,
    asigReserva: true,
    asigFromReparto: ingresoId,
    splitFromLineIndex: splitFromIdx,
  };
}

/**
 * v1403 §40.11: revertSobreAsignadas — reconciliación automática.
 *
 * Antes (v1395 §40.3 scanSobreAsignadas): leía líneas con `sobreAsignada > 0`
 * y SOLO loguéaba. El estado "ASIG con qtyNominal > físico" quedaba vivo hasta
 * que el VDE pasara por CPST (§40.5).
 *
 * Ahora (v1403 §40.11): la CF corre en cada tick de `onDep11IncreaseCreateReparto`
 * y revierte proactivamente el excedente a BO. Para cada línea ASIG con
 * `sobreAsignada > 0`:
 *   - Mutar línea original a `qty = qtyEntregable`, `qtyOpen = qtyEntregable`.
 *   - Appendar nueva línea `state='BO'` con `qty = sobreAsignada`,
 *     `closedReason='asig_sin_stock_revertida_a_bo'`, `asigRevertidaAt`,
 *     `asigRevertidaBy='system:reconcile'`, `splitFromLineIndex`.
 *
 * Idempotente: una línea ya revertida tiene `qty=qtyEntregable`, por lo que
 * `sobreAsignada` del próximo scan es 0 → no se re-revierte.
 *
 * El cliente conserva lugar en cola (el BO nuevo tiene el mismo cardCode) —
 * cuando entre stock, aparece en Reparto por las unidades revertidas.
 *
 * @param {RepartoDeps} deps
 * @param {any} snapshot - stock_snapshot.warehouseBreakdown
 * @param {{dryRun?: boolean}} [opts] - dryRun=true no escribe en Firestore.
 * @returns {Promise<{revertidas: Array<{sku:string, pedidoId:string, lineIndex:number, cardCode:string, clientName:string, qtyEntregable:number, qtyRevertida:number}>, errors: string[], skipped?: Array<{pedidoId:string, motivo:string}>}>}
 */
export async function revertSobreAsignadas(deps, snapshot, opts) {
  const dryRun = !!(opts && opts.dryRun);
  const log = deps.log || (() => {});
  const now = (deps.now || (() => new Date()))();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const whsBreakdown = _parseWarehouseBreakdown(snapshot);
  /** @type {Array<any>} */
  const revertidas = [];
  /** @type {string[]} */
  const errors = [];

  let openPedidos;
  try {
    openPedidos = await loadOpenPedidos(deps);
  } catch (e) {
    errors.push(
      'revertSobreAsignadas: loadOpenPedidos fallo: ' + (e && e.message ? e.message : String(e))
    );
    return { revertidas, errors, skipped: [] };
  }
  const pedidosData = openPedidos.map((d) => Object.assign({ _fsId: d.id }, d.data() || {}));

  // SKUs a scanear: unión de (SKUs con físico > 0 en whs 11) + (SKUs con ASIG en pedidos abiertos).
  const skuSet = new Set();
  for (const [skuRaw, whs] of Object.entries(whsBreakdown)) {
    const fisico = Number(whs['11']) || 0;
    if (fisico > 0) skuSet.add(String(skuRaw).toUpperCase());
  }
  for (const p of pedidosData) {
    for (const l of Array.isArray(p.lines) ? p.lines : []) {
      if (l && l.state === 'ASIG' && l.code) skuSet.add(String(l.code).toUpperCase());
    }
  }

  // Agrupar updates por pedidoId para hacer 1 update por doc.
  /** @type {Map<string, any[]>} */
  const modifiedLines = new Map();

  for (const sku of skuSet) {
    try {
      const fisico = Number((whsBreakdown[sku] && whsBreakdown[sku]['11']) || 0);
      const breakdown = getStockBreakdown(
        sku,
        { getStockFisico: () => fisico, pedidos: pedidosData },
        { now: nowMs }
      );
      // v1403 §40.11: iteramos directo sobre detalle[] (totalSobreAsignada eliminado del shape).
      for (const d of breakdown.asignadas.detalle || []) {
        if (d.sobreAsignada <= 0) continue;
        const row = {
          sku,
          pedidoId: d.pedidoId,
          lineIndex: d.lineIndex,
          cardCode: d.cardCode,
          clientName: d.clientName,
          qtyEntregable: d.qtyEntregable,
          qtyRevertida: d.sobreAsignada,
        };
        // Encontrar la línea original en el pedido.
        const ped = pedidosData.find((p) => p._fsId === d.pedidoId);
        if (!ped || !Array.isArray(ped.lines)) continue;
        /** @type {any[]} */
        let _newLinesTyped;
        const _existing = modifiedLines.get(d.pedidoId);
        if (_existing) {
          _newLinesTyped = _existing;
        } else {
          _newLinesTyped = ped.lines.map((/** @type {any} */ l) => Object.assign({}, l));
          modifiedLines.set(d.pedidoId, _newLinesTyped);
        }
        const origLine = _newLinesTyped[d.lineIndex];
        if (!origLine || origLine.state !== 'ASIG') continue;
        const origQo = Number(origLine.qtyOpen) || 0;
        // v1520: entregable 0 → la línea entera vuelve a BO EN SU LUGAR. Antes
        // quedaba state='ASIG' con qty=0/qtyOpen=0 (zombie) + BO apendeada; el
        // CPST la tomaba como origen y bloqueaba (REBORN CLC66H2PY 2026-10-29).
        if (!(Number(d.qtyEntregable) > 0)) {
          Object.assign(origLine, {
            state: 'BO',
            qtyOpen: origQo,
            asigReserva: false,
            asigAt: null,
            asigRevertidaAt: nowIso,
            asigRevertidaBy: 'system:reconcile',
            asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
          });
          delete origLine.asigRefs;
          revertidas.push(row);
          log('asig_revertida_auto', Object.assign({ full: true }, row));
          continue;
        }
        // Mutar la ASIG original a qty=entregable.
        origLine.qty = d.qtyEntregable;
        origLine.qtyOpen = Math.min(origQo, d.qtyEntregable);
        // Appendar línea BO revertida con audit.
        const boLine = Object.assign({}, origLine, {
          qty: d.sobreAsignada,
          qtyOpen: d.sobreAsignada,
          qtyInvoiced: 0,
          qtyCancelled: 0,
          qtyRecycled: 0,
          state: 'BO',
          asigReserva: false,
          asigAt: null,
          asigRevertidaAt: nowIso,
          asigRevertidaBy: 'system:reconcile',
          asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
          splitFromLineIndex: d.lineIndex,
        });
        delete boLine.asigRefs;
        _newLinesTyped.push(boLine);
        revertidas.push(row);
        log('asig_revertida_auto', row);
      }
    } catch (e) {
      errors.push(
        'revertSobreAsignadas sku=' + sku + ': ' + (e && e.message ? e.message : String(e))
      );
    }
  }

  /** @type {Array<{pedidoId: string, motivo: string}>} */
  const skipped = [];
  // Aplicar updates por pedido (salvo dryRun).
  // v1522: cada pedido se escribe en una transacción que re-lee el doc. Si sus
  // líneas cambiaron desde la lectura masiva (ej. Pablo aplicó un reparto en
  // el medio), NO se escribe en esta vuelta: la versión calculada está vieja y
  // pisaría la asignación nueva (lost update). La próxima corrida (~5 min,
  // cada escritura de stock_snapshot) lo recalcula con datos frescos.
  if (!dryRun) {
    for (const [pedidoId, newLines] of modifiedLines.entries()) {
      // v1520 invariante ASIG qtyOpen>0 (ver findZombieAsigLines).
      const _orig = pedidosData.find((p) => p._fsId === pedidoId);
      const _antes = new Set(findZombieAsigLines((_orig && _orig.lines) || []));
      const _nuevas = findZombieAsigLines(newLines).filter((i) => !_antes.has(i));
      if (_nuevas.length > 0) {
        errors.push(
          'revertSobreAsignadas invariante pedidoId=' +
            pedidoId +
            ': ASIG qtyOpen=0 en ' +
            _nuevas.join(',')
        );
        continue;
      }
      const _leidas = JSON.stringify((_orig && _orig.lines) || []);
      try {
        const pedidoRef = deps.fbDb.collection('pedidos').doc(pedidoId);
        const motivo = await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
          const snap = await tx.get(pedidoRef);
          if (!snap.exists) return 'pedido_no_existe';
          const fresh = snap.data() || {};
          if (fresh.closedAt) return 'pedido_cerrado';
          if (JSON.stringify(Array.isArray(fresh.lines) ? fresh.lines : []) !== _leidas) {
            return 'pedido_cambio_durante_reconcile';
          }
          tx.update(pedidoRef, { lines: newLines, updatedAt: nowIso });
          return null;
        });
        if (motivo) {
          skipped.push({ pedidoId, motivo });
          log('revert_sobre_asignadas_skip', { pedidoId, motivo });
        }
      } catch (e) {
        errors.push(
          'revertSobreAsignadas update pedidoId=' +
            pedidoId +
            ': ' +
            (e && e.message ? e.message : String(e))
        );
      }
    }
  }

  return { revertidas, errors, skipped };
}

// Compat alias — el export viejo scanSobreAsignadas sigue existiendo como
// read-only (sin escribir) por si algún caller/test externo lo usa.
/**
 * @deprecated v1403 §40.11. Usar revertSobreAsignadas (sin opts para producción;
 * `{ dryRun: true }` para test/audit).
 * @param {RepartoDeps} deps
 * @param {any} snapshot
 */
export async function scanSobreAsignadas(deps, snapshot) {
  const r = await revertSobreAsignadas(deps, snapshot, { dryRun: true });
  return {
    sobreAsignadas: r.revertidas.map((x) =>
      Object.assign(
        { qtyNominal: x.qtyEntregable + x.qtyRevertida, sobreAsignada: x.qtyRevertida },
        x
      )
    ),
    errors: r.errors,
  };
}
