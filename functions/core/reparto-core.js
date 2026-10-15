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
export function validateRepartoPayload(ingresoDoc, assignments, eliminations) {
  /** @type {string[]} */
  const errors = [];
  if (!ingresoDoc) {
    errors.push('ingreso_reparto no encontrado');
    return { valid: false, errors };
  }
  if (ingresoDoc.status !== 'pending') {
    errors.push('ingreso ya aplicado o cancelado (status=' + ingresoDoc.status + ')');
  }
  const asigArr = Array.isArray(assignments) ? assignments : [];
  const elimArr = Array.isArray(eliminations) ? eliminations : [];
  if (asigArr.length === 0 && elimArr.length === 0) {
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
    const key = a.pedidoId + '|' + a.lineIndex;
    if (!boMap.has(key)) {
      errors.push('assignment no coincide con ningun cliente BO (' + key + ')');
      continue;
    }
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
    const key = e.pedidoId + '|' + e.lineIndex;
    if (!boMap.has(key)) {
      errors.push('elimination no coincide con ningun cliente BO (' + key + ')');
      continue;
    }
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
 * @returns {Promise<{ok: boolean, errors: string[], applied: Assignment[], eliminated?: Array<{pedidoId: string, lineIndex: number, qtyEliminada: number}>}>}
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
  const validation = validateRepartoPayload(ingresoDoc, opts.assignments, opts.eliminations);
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
  /** @type {Array<{pedidoId: string, lineIndex: number, qtyEliminada: number}>} */
  const eliminated = [];
  /** @type {string[]} */
  const errors = [];

  // v1312: combinar assignments + eliminations por (pedidoId, lineIndex) para
  // hacer 1 tx por linea (atomico: la linea original + las nuevas ASIG se
  // crean/cambian juntas).
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

  for (const [, action] of actionsByLine) {
    const pedidoRef = deps.fbDb.collection('pedidos').doc(action.pedidoId);
    try {
      await deps.fbDb.runTransaction(async (/** @type {any} */ tx) => {
        const pedidoSnap = await tx.get(pedidoRef);
        if (!pedidoSnap.exists) {
          throw new Error('pedido no existe: ' + action.pedidoId);
        }
        const data = pedidoSnap.data();
        // v1336 (2026-10-15): guards v1300 (FATECHI) REMOVIDOS por pedido
        // explicito de Mariano. "Yo tomo la responsabilidad si ya se habia
        // asignado en pedidos viejo". Admin/gerente only (gate frontend).
        // Preservado: validaciones matematicas basicas (line existe,
        // qtyOpen > 0, asig+elim <= qtyOpen).
        const lines = Array.isArray(data.lines) ? [...data.lines] : [];
        const line = lines[action.lineIndex];
        if (!line) {
          throw new Error('line index invalido: ' + action.lineIndex + ' @ ' + action.pedidoId);
        }
        const qo = Number(line.qtyOpen) || 0;
        if (qo <= 0) {
          throw new Error('linea con qtyOpen=0 @ ' + action.pedidoId + ':' + action.lineIndex);
        }
        const asig = Math.max(0, Number(action.asig) || 0);
        const elim = Math.max(0, Number(action.elim) || 0);
        // v1338 (2026-10-15): cap asig+elim > qo REMOVIDO (sobre-asignacion
        // permitida). Si asig+elim > qo, qr queda en 0 (no negativo). Mariano
        // toma la responsabilidad.
        const qr = Math.max(0, qo - asig - elim); // qtyMantenerBO (>= 0 siempre)
        // Linea original: siempre acumula qtyCancelled si elim>0.
        const newOrig = Object.assign({}, line, {
          qtyCancelled: (Number(line.qtyCancelled) || 0) + elim,
          qtyOpen: qr,
        });
        if (qr === 0 && asig > 0 && elim === 0) {
          // Linea entera pasa a ASIG.
          newOrig.qtyOpen = asig;
          newOrig.state = 'ASIG';
          newOrig.asigAt = nowIso;
          newOrig.asigReserva = true;
          newOrig.asigFromReparto = opts.ingresoId;
          lines[action.lineIndex] = newOrig;
        } else if (qr === 0 && elim > 0) {
          // Linea original cancelled (full o parcial depending on asig).
          newOrig.state = 'cancelled';
          newOrig.cancelledAt = nowIso;
          newOrig.cancelledFrom = 'reparto-eliminado';
          newOrig.cancelledFromIngreso = opts.ingresoId;
          lines[action.lineIndex] = newOrig;
          if (asig > 0) {
            lines.push(_buildAsigLine(line, asig, nowIso, opts.ingresoId, action.lineIndex));
          }
        } else {
          // qr > 0: linea original queda BO con menos qty (+qtyCancelled si elim>0).
          lines[action.lineIndex] = newOrig;
          if (asig > 0) {
            lines.push(_buildAsigLine(line, asig, nowIso, opts.ingresoId, action.lineIndex));
          }
        }
        tx.update(pedidoRef, { lines, updatedAt: nowIso });
      });
      if (asig0(action) > 0) {
        applied.push({
          pedidoId: action.pedidoId,
          lineIndex: action.lineIndex,
          qtyAsignada: asig0(action),
        });
      }
      if (elim0(action) > 0) {
        eliminated.push({
          pedidoId: action.pedidoId,
          lineIndex: action.lineIndex,
          qtyEliminada: elim0(action),
        });
      }
      log('reparto aplicado', {
        pedidoId: action.pedidoId,
        lineIndex: action.lineIndex,
        asig: action.asig,
        elim: action.elim,
      });
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)) + ' (pedido ' + action.pedidoId + ')';
      errors.push(msg);
    }
  }
  // Marcar ingreso como done (parcialmente OK, en progreso, o done segun errors).
  const touched = applied.length + eliminated.length;
  const nextStatus = errors.length === 0 ? 'done' : touched > 0 ? 'in_progress' : 'pending';
  try {
    await ingresoRef.update({
      status: nextStatus,
      appliedAt: nowIso,
      appliedBy: opts.appliedByEmail || '',
      assignments: applied,
      eliminations: eliminated,
      assignmentErrors: errors,
    });
  } catch (e) {
    errors.push('update ingreso status failed: ' + (e && e.message ? e.message : String(e)));
  }
  // Audit log. v1277 IMPORTANT-6 fix: no silent swallow — si falla, loguear
  // + agregar al errors[] del response para que caller lo vea.
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
  return { ok: errors.length === 0, errors, applied, eliminated };
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
