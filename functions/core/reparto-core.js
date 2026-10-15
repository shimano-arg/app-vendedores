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
      // Dedupe: si hay un pending con mismo dedupeKey, skip.
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
 * Valida un payload de reparto manual sin aplicar nada. Reusable por
 * applyRepartoManualCore y por tests.
 *
 * @param {IngresoRepartoDoc} ingresoDoc
 * @param {Assignment[]} assignments
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateRepartoPayload(ingresoDoc, assignments) {
  /** @type {string[]} */
  const errors = [];
  if (!ingresoDoc) {
    errors.push('ingreso_reparto no encontrado');
    return { valid: false, errors };
  }
  if (ingresoDoc.status !== 'pending') {
    errors.push('ingreso ya aplicado o cancelado (status=' + ingresoDoc.status + ')');
  }
  if (!Array.isArray(assignments) || assignments.length === 0) {
    errors.push('assignments vacio');
    return { valid: false, errors };
  }
  // Mapa pedidoId|lineIndex -> clienteBO para lookup rapido.
  /** @type {Map<string, ClienteBO>} */
  const boMap = new Map();
  for (const c of ingresoDoc.clientesBO || []) {
    boMap.set(c.pedidoId + '|' + c.lineIndex, c);
  }
  let sumAsignada = 0;
  for (const a of assignments) {
    const qty = Number(a.qtyAsignada) || 0;
    if (qty <= 0) {
      errors.push('assignment con qtyAsignada <= 0 (pedido ' + a.pedidoId + ')');
      continue;
    }
    const key = a.pedidoId + '|' + a.lineIndex;
    const bo = boMap.get(key);
    if (!bo) {
      errors.push('assignment no coincide con ningun cliente BO (' + key + ')');
      continue;
    }
    // v1292 (2026-10-14): se permite qty > bo.qtyBackorder (sobre-asignacion).
    // Pablo puede darle mas al cliente de lo que pidio. La linea se expande
    // (qtyOpen aumenta) en applyRepartoManualCore. Antes rechazaba con error.
    sumAsignada += qty;
  }
  // v1309 (2026-10-15): el cap vs stock fisico se valida en applyRepartoManualCore
  // porque requiere leer app_config/stock_snapshot (async). validateRepartoPayload
  // queda sync, solo chequea estructura basica.
  return { valid: errors.length === 0, errors, sumAsignada };
}

/**
 * Aplica un reparto manual. Transaccional por linea (dentro de runTransaction).
 * Split pattern (v600/v1153 manual-backorder): si qtyAsignada < qtyOpen, se
 * crea una nueva linea state='ASIG' con qtyAsignada + se reduce la linea
 * original BO a qtyOpen - qtyAsignada. Si qtyAsignada === qtyOpen, la linea
 * entera pasa a ASIG.
 *
 * @param {RepartoDeps} deps
 * @param {Object} opts
 * @param {string} opts.ingresoId
 * @param {Assignment[]} opts.assignments
 * @param {string} opts.appliedByEmail Email del user que aplica (audit).
 * @returns {Promise<{ok: boolean, errors: string[], applied: Assignment[], unassignedCancelled?: Array<{pedidoId: string, lineIndex: number}>}>}
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
  const validation = validateRepartoPayload(ingresoDoc, opts.assignments);
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
    const skuKey = String(ingresoDoc.sku || '').toUpperCase().trim();
    const whs = (wbs && wbs[skuKey]) || null;
    stockFisicoDep11 = whs ? Number(whs['11'] || 0) : 0;
  } catch (stockErr) {
    log('stock_snapshot read fail', { err: stockErr && stockErr.message });
    return {
      ok: false,
      errors: ['no se pudo leer stock_snapshot para validar cap: ' + (stockErr && stockErr.message ? stockErr.message : String(stockErr))],
      applied: [],
    };
  }
  if (validation.sumAsignada > stockFisicoDep11) {
    return {
      ok: false,
      errors: [
        'sum assignments=' + validation.sumAsignada +
          ' > stock fisico dep 11 actual=' + stockFisicoDep11 +
          ' (sobre-reparto, sin stock real para cubrir)',
      ],
      applied: [],
    };
  }
  // v1277 BLOCKER-1 fix: lock ANTES del loop para que un crash parcial +
  // retry del user no cause doble aplicacion. Si el lock falla no tocamos
  // pedidos; si pasa, validator (status != pending) bloquea re-ejecuciones.
  try {
    await ingresoRef.update({
      status: 'in_progress',
      lockedAt: nowIso,
      lockedBy: opts.appliedByEmail || '',
    });
  } catch (lockErr) {
    return {
      ok: false,
      errors: [
        'lock del ingreso fallo (no se modifico nada): ' +
          (lockErr && lockErr.message ? lockErr.message : String(lockErr)),
      ],
      applied: [],
    };
  }
  /** @type {Assignment[]} */
  const applied = [];
  /** @type {string[]} */
  const errors = [];
  for (const a of opts.assignments) {
    const pedidoRef = deps.fbDb.collection('pedidos').doc(a.pedidoId);
    try {
      await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        const pedidoSnap = await tx.get(pedidoRef);
        if (!pedidoSnap.exists) {
          throw new Error('pedido no existe: ' + a.pedidoId);
        }
        const data = pedidoSnap.data();
        // v1300 (2026-10-14) M1 fix: no permitir reparto sobre pedidos ya
        // enviados a SAP (transferidoSAP.docNum setado) ni cerrados. Precedente
        // FATECHI 2026-10-06: expandir qtyOpen sin SQ correspondiente genera
        // stock reservado app-side eterno + factura SAP por qty vieja.
        if (data.closedAt) {
          throw new Error('pedido cerrado (closedAt), no se puede repartir @ ' + a.pedidoId);
        }
        if (data.transferidoSAP && data.transferidoSAP.docNum) {
          throw new Error(
            'pedido ya en SAP (SQ #' +
              data.transferidoSAP.docNum +
              '), no se puede repartir @ ' +
              a.pedidoId
          );
        }
        const lines = Array.isArray(data.lines) ? [...data.lines] : [];
        const line = lines[a.lineIndex];
        if (!line) {
          throw new Error('line index invalido: ' + a.lineIndex + ' @ ' + a.pedidoId);
        }
        if (line.state !== 'BO') {
          // Race: otra operacion ya la movio (recycle, cancel, otro reparto).
          throw new Error(
            'linea ya no esta BO (state=' + line.state + ') @ ' + a.pedidoId + ':' + a.lineIndex
          );
        }
        const qo = Number(line.qtyOpen) || 0;
        if (qo <= 0) {
          throw new Error('linea con qtyOpen=0 @ ' + a.pedidoId + ':' + a.lineIndex);
        }
        const qty = Number(a.qtyAsignada) || 0;
        if (qty <= 0) {
          throw new Error('qtyAsignada=' + qty + ' invalido @ ' + a.pedidoId + ':' + a.lineIndex);
        }
        if (qty > qo) {
          // v1292 (2026-10-14): sobre-asignacion. Pablo le da mas al cliente
          // de lo que pidio. La linea se expande: qty > qo, state=ASIG,
          // qtyOpen = qty. qty del pedido original tambien se amplia para
          // mantener consistencia (qty = qtyOpen cuando no hay invoiced).
          lines[a.lineIndex] = Object.assign({}, line, {
            qty: qty,
            qtyOpen: qty,
            state: 'ASIG',
            asigAt: nowIso,
            asigReserva: true,
            asigFromReparto: opts.ingresoId,
            overAssigned: true,
            overAssignedDelta: qty - qo,
          });
        } else if (qty === qo) {
          // Linea entera pasa a ASIG.
          lines[a.lineIndex] = Object.assign({}, line, {
            state: 'ASIG',
            asigAt: nowIso,
            asigReserva: true,
            asigFromReparto: opts.ingresoId,
          });
        } else {
          // Split: linea BO existente baja a qo - qty + se APPEND una nueva
          // ASIG con qty. v1277 IMPORTANT-4 fix (precedente v600): la nueva
          // linea usa whitelist de campos safe en vez de Object.assign (que
          // heredaba qtyInvoiced/qtyCancelled/qtyRecycled/transferidoSAP y
          // podia duplicar historial en caso de BO con historia parcial).
          lines[a.lineIndex] = Object.assign({}, line, {
            qtyOpen: qo - qty,
          });
          lines.push({
            code: line.code,
            desc: line.desc || '',
            cat: line.cat || '',
            fam: line.fam || '',
            sub: line.sub || '',
            qty: qty,
            qtyOpen: qty,
            qtyInvoiced: 0,
            qtyCancelled: 0,
            qtyRecycled: 0,
            recycledIntoPedidoId: null,
            precio: Number(line.precio) || 0,
            priceAtCreation: Number(line.priceAtCreation) || Number(line.precio) || 0,
            needsReview: false,
            targetMonth: line.targetMonth || null,
            targetMonthIdx:
              line.targetMonthIdx !== null && line.targetMonthIdx !== undefined
                ? line.targetMonthIdx
                : null,
            targetYear: line.targetYear || null,
            state: 'ASIG',
            asigAt: nowIso,
            asigReserva: true,
            asigFromReparto: opts.ingresoId,
            splitFromLineIndex: a.lineIndex,
          });
        }
        tx.update(pedidoRef, { lines, updatedAt: nowIso });
      });
      applied.push(a);
      log('reparto aplicado', { pedidoId: a.pedidoId, lineIndex: a.lineIndex, qty: a.qtyAsignada });
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)) + ' (pedido ' + a.pedidoId + ')';
      errors.push(msg);
    }
  }
  // v1295 (2026-10-14): si quedó stock LIBRE post-apply (Pablo decidió no
  // asignar todo), cancelar los BO de clientesBO que NO recibieron asignacion.
  // Rationale Mariano: "si habia stock disponible y lo deje en 0, es que ese
  // cliente ya no va a esperar — eliminame el backorder". Si no quedo libre
  // (todo se asigno), los no-asignados MANTIENEN su BO (siguen esperando otro
  // ingreso).
  const sumAsignada = applied.reduce((s, a) => s + (Number(a.qtyAsignada) || 0), 0);
  // v1309: libre = stock fisico actual - sumAsignada. Preserva la regla v1295:
  // si queda stock libre y hay clientes BO en 0, se les cancela el BO.
  const libre = Math.max(0, stockFisicoDep11 - sumAsignada);
  /** @type {Array<{pedidoId: string, lineIndex: number}>} */
  const unassignedCancelled = [];
  if (libre > 0) {
    const clientesBO = Array.isArray(ingresoDoc.clientesBO) ? ingresoDoc.clientesBO : [];
    const assignedKeys = new Set(applied.map((a) => a.pedidoId + '|' + a.lineIndex));
    const toCancel = clientesBO.filter(
      (c) => c && c.pedidoId && !assignedKeys.has(c.pedidoId + '|' + c.lineIndex)
    );
    // Agrupar por pedidoId: 1 tx por pedido con todas las lineas a cancelar.
    /** @type {Map<string, number[]>} */
    const byPedido = new Map();
    for (const c of toCancel) {
      const li = Number(c.lineIndex);
      if (!byPedido.has(c.pedidoId)) byPedido.set(c.pedidoId, []);
      /** @type {number[]} */ (byPedido.get(c.pedidoId)).push(li);
    }
    for (const [pid, lineIdxs] of byPedido) {
      try {
        await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
          const pedidoRef = deps.fbDb.collection('pedidos').doc(pid);
          const pSnap = await tx.get(pedidoRef);
          if (!pSnap.exists) throw new Error('pedido no existe: ' + pid);
          const data = pSnap.data();
          const lines = Array.isArray(data.lines) ? [...data.lines] : [];
          for (const li of lineIdxs) {
            const line = lines[li];
            if (!line) continue;
            if (line.state !== 'BO') continue; // Alguien ya la movio (race).
            const qo = Number(line.qtyOpen) || 0;
            if (qo <= 0) continue;
            lines[li] = Object.assign({}, line, {
              qtyOpen: 0,
              qtyCancelled: (Number(line.qtyCancelled) || 0) + qo,
              state: 'cancelled',
              cancelledAt: nowIso,
              cancelledFrom: 'reparto-unassigned-with-stock-libre',
              cancelledFromIngreso: opts.ingresoId,
            });
            unassignedCancelled.push({ pedidoId: pid, lineIndex: li });
          }
          tx.update(pedidoRef, { lines, updatedAt: nowIso });
        });
      } catch (e) {
        const msg =
          'cancel unassigned fallo (pedido ' +
          pid +
          '): ' +
          (e && e.message ? e.message : String(e));
        errors.push(msg);
      }
    }
  }
  // Marcar ingreso como done (parcialmente OK, en progreso, o done segun errors).
  const nextStatus = errors.length === 0 ? 'done' : applied.length > 0 ? 'in_progress' : 'pending';
  try {
    await ingresoRef.update({
      status: nextStatus,
      appliedAt: nowIso,
      appliedBy: opts.appliedByEmail || '',
      assignments: applied,
      assignmentErrors: errors,
    });
  } catch (e) {
    errors.push('update ingreso status failed: ' + (e && e.message ? e.message : String(e)));
  }
  // Audit log. v1277 IMPORTANT-6 fix: no silent swallow — si falla, loguear
  // + agregar al errors[] del response para que caller lo vea.
  // v1277 IMPORTANT-3 fix: incluir primeros 10 messages de errors[] en el
  // doc audit para debug sin ir a logs CF.
  try {
    await deps.fbDb.collection(REPARTO_LOG_COLLECTION).add({
      ingresoId: opts.ingresoId,
      sku: ingresoDoc.sku,
      qtyIngresada: ingresoDoc.qtyIngresada,
      appliedAt: nowIso,
      appliedBy: opts.appliedByEmail || '',
      assignmentsCount: applied.length,
      errorsCount: errors.length,
      errors: errors.slice(0, 10),
      status: nextStatus,
      // v1295: lineas BO canceladas por no-asignado + stock libre.
      unassignedCancelledCount: unassignedCancelled.length,
      unassignedCancelled: unassignedCancelled.slice(0, 20),
    });
  } catch (logErr) {
    const msg =
      'audit log write failed (reparto aplicado OK): ' +
      (logErr && logErr.message ? logErr.message : String(logErr));
    log('reparto_log write failed', { ingresoId: opts.ingresoId, err: msg });
    errors.push(msg);
  }
  return { ok: errors.length === 0, errors, applied, unassignedCancelled };
}
