// @ts-check
/**
 * Rendicion duplicate detector — core logic (CF-agnostic).
 *
 * Escrito para el trigger onDocumentCreated en rendiciones/{docId}. Sin
 * dependencias a firebase-admin — recibe deps inyectables para test.
 *
 * Cuando se crea una rendicion:
 *   1. Compute claves (via src/pure/rendicion-duplicate.js).
 *   2. Populate `ticketNormalizado` en el doc (para consumers cliente-side).
 *   3. Query rendiciones del mismo ownerUid en los ultimos 90 dias con
 *      cualquiera de las claves fuertes.
 *   4. Si match fuerte contra approved/pending → update status a
 *      'duplicado_detectado' + duplicateOf + duplicateStrength + duplicateReason.
 *
 * Feature flag: si app_config/rendiciones_config.antiDuplicadoEnabled = false,
 * solo popula ticketNormalizado (para no perder datos), NO chequea. Permite
 * apagar el bloqueo sin redeploy si algo sale mal.
 */

// Re-importa la logica pura. En CF Node20, `require` funciona con esm-interop.
// Pero preferimos import estatico (esm nativo en functions con "type": "module").
import { clavesDeDuplicado, normalizarTicket } from '../../src/pure/rendicion-duplicate.js';

/**
 * Ventana de busqueda hacia atras. 90 dias per Mariano (2026-09-09).
 */
export const LOOKBACK_DAYS = 90;

/**
 * Estados que califican como "match relevante". Un doc con estos estados es
 * un "duplicado" que debe bloquear al nuevo. rejected/duplicado_detectado NO
 * cuentan (ya fueron descartados).
 */
export const RELEVANT_STATUSES = ['approved', 'pending_approval'];

/**
 * Marca de audit en el doc duplicado.
 * @typedef {Object} DuplicadoAuditFields
 * @property {'duplicado_detectado'} status
 * @property {string} duplicateOf          docId de la rendicion original que matcheo.
 * @property {'strong'} duplicateStrength
 * @property {string} duplicateReason       la clave que matcheo (para diagnostico).
 * @property {string} duplicateDetectedAt   ISO timestamp.
 * @property {string} duplicateDetectedBy   siempre 'cf/onRendicionCreatedCheckDuplicate'.
 */

/**
 * Deps inyectables (mockeables en tests).
 * @typedef {Object} CoreDeps
 * @property {any} db                       Firestore instance (Admin SDK).
 * @property {any} FieldValue               firebase-admin/firestore FieldValue.
 * @property {(msg: string, extra?: any) => void} log
 * @property {() => Date} [now]             injectable for tests.
 * @property {() => Promise<boolean>} [isEnabled]  Feature flag lookup.
 */

/**
 * Query firestore por rendiciones del mismo ownerUid en los ultimos N dias
 * con alguna de las claves fuertes.
 *
 * Estrategia: NO usa filtro por ticketNormalizado (ese solo cubre parte del
 * problema). Trae TODAS las rendiciones del owner en la ventana y compara
 * las claves en memoria. Es defensivo pero el volumen esperado por owner
 * es bajo (<200 rend/mes tipico) — trade cost por correctness.
 *
 * @param {CoreDeps} deps
 * @param {string} ownerUid
 * @param {Date} nowDate
 * @param {string} excludeDocId  no matchear contra el mismo doc que dispara.
 * @returns {Promise<Array<{id: string, data: any}>>}
 */
async function fetchOwnerRendiciones(deps, ownerUid, nowDate, excludeDocId) {
  const since = new Date(nowDate.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const snap = await deps.db
    .collection('rendiciones')
    .where('ownerUid', '==', ownerUid)
    .where('createdAt', '>=', since)
    .get();
  /** @type {Array<{id: string, data: any}>} */
  const out = [];
  snap.forEach(
    /** @param {any} doc */ (doc) => {
      if (doc.id === excludeDocId) return;
      out.push({ id: doc.id, data: doc.data() });
    }
  );
  return out;
}

/**
 * Core del trigger. Recibe la rendicion recien creada (data) + id + deps.
 *
 * @param {string} newDocId
 * @param {any} newData
 * @param {CoreDeps} deps
 * @returns {Promise<{
 *   action: 'noop'|'populate-only'|'duplicate-detected'|'skipped',
 *   reason?: string,
 *   ticketNormalizado?: string|null,
 *   matchedDocId?: string,
 *   matchedReason?: string,
 * }>}
 */
export async function checkNewRendicionDuplicate(newDocId, newData, deps) {
  if (!newData || !newData.ownerUid) {
    return { action: 'skipped', reason: 'no-owner' };
  }
  // Compute ticketNormalizado siempre. Aunque el feature flag este OFF, este
  // campo se guarda para futuros queries y el backfill lo va a asumir presente.
  const ticketNorm = normalizarTicket(newData.numeroTicket);

  // Si ya viene con status='duplicado_detectado' (defensivo: re-trigger),
  // no re-procesar.
  if (newData.status === 'duplicado_detectado') {
    return { action: 'skipped', reason: 'already-flagged' };
  }
  // Rejected no bloquea nada — pero igual poblamos ticketNormalizado.
  if (newData.status === 'rejected') {
    if (ticketNorm && !newData.ticketNormalizado) {
      await deps.db.collection('rendiciones').doc(newDocId).update({
        ticketNormalizado: ticketNorm,
      });
      return { action: 'populate-only', ticketNormalizado: ticketNorm };
    }
    return { action: 'skipped', reason: 'rejected' };
  }

  // Feature flag: si esta OFF, solo poblamos ticketNormalizado y salimos.
  const enabled = deps.isEnabled ? await deps.isEnabled() : true;
  if (!enabled) {
    if (ticketNorm && !newData.ticketNormalizado) {
      await deps.db.collection('rendiciones').doc(newDocId).update({
        ticketNormalizado: ticketNorm,
      });
      return {
        action: 'populate-only',
        reason: 'feature-flag-off',
        ticketNormalizado: ticketNorm,
      };
    }
    return { action: 'skipped', reason: 'feature-flag-off' };
  }

  // Compute claves de la rendicion nueva. Sin claves = no hay como chequear.
  const clavesNueva = clavesDeDuplicado(newData);
  if (!clavesNueva.fuertes.length) {
    // Populate ticketNormalizado si aplica pero no chequeamos.
    if (ticketNorm && !newData.ticketNormalizado) {
      await deps.db.collection('rendiciones').doc(newDocId).update({
        ticketNormalizado: ticketNorm,
      });
      return { action: 'populate-only', ticketNormalizado: ticketNorm };
    }
    return { action: 'noop', reason: 'no-strong-keys' };
  }

  // Fetch otras rendiciones del mismo owner en la ventana.
  const nowFn = deps.now || (() => new Date());
  const nowDate = nowFn();
  const others = await fetchOwnerRendiciones(deps, newData.ownerUid, nowDate, newDocId);

  // Buscar match fuerte contra un doc en RELEVANT_STATUSES.
  const clavesSet = new Set(clavesNueva.fuertes);
  let matched = null;
  for (const other of others) {
    if (!RELEVANT_STATUSES.includes(other.data?.status)) continue;
    const clavesOther = clavesDeDuplicado(other.data);
    for (const k of clavesOther.fuertes) {
      if (clavesSet.has(k)) {
        matched = { doc: other, reason: k };
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    // Sin match — solo populate ticketNormalizado.
    if (ticketNorm && !newData.ticketNormalizado) {
      await deps.db.collection('rendiciones').doc(newDocId).update({
        ticketNormalizado: ticketNorm,
      });
      return { action: 'populate-only', ticketNormalizado: ticketNorm };
    }
    return { action: 'noop', reason: 'no-match' };
  }

  // MATCH — marcar como duplicado_detectado.
  deps.log('[antidup] MATCH FUERTE detectado', {
    newDocId,
    matchedDocId: matched.doc.id,
    reason: matched.reason,
    ownerUid: newData.ownerUid,
    importe: newData.importe,
    numeroTicket: newData.numeroTicket,
  });
  /** @type {Record<string, any>} */
  const updateFields = {
    status: 'duplicado_detectado',
    duplicateOf: matched.doc.id,
    duplicateStrength: 'strong',
    duplicateReason: matched.reason,
    duplicateDetectedAt: new Date().toISOString(),
    duplicateDetectedBy: 'cf/onRendicionCreatedCheckDuplicate',
  };
  if (ticketNorm) updateFields.ticketNormalizado = ticketNorm;
  await deps.db.collection('rendiciones').doc(newDocId).update(updateFields);
  return {
    action: 'duplicate-detected',
    ticketNormalizado: ticketNorm || undefined,
    matchedDocId: matched.doc.id,
    matchedReason: matched.reason,
  };
}
