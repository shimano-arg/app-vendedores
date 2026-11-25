// @ts-check
/**
 * Alcance del vendedor interno (VDI, rol 'interno') sobre pedidos y órdenes
 * en espera, del lado del servidor.
 *
 * Regla (auditoría de seguridad 2026-11-25, misma que firestore.rules):
 *   - El interno modifica pedidos/órdenes PROPIOS (los cargó él) o de SU
 *     PAREJA VDE: el VDE cuyo `roles/{uidVDE}` tiene role 'vendedor' e
 *     `internalPartnerUid` igual al uid del interno.
 *   - Los pedidos que cargó otra persona (ej. gerente) para un cliente de la
 *     pareja entran por `assignedVendorUid` (vendedor del cliente, §44/§46).
 *   - Cualquier otro documento queda fuera de su alcance.
 *   - Admin y gerente no pasan por acá (sin restricción).
 *
 * Falla cerrada: si no se puede leer el rol del VDE candidato, ese camino no
 * concede acceso. Si ningún camino lo concede, se deniega.
 *
 * Core puro (§7): `getRoleDoc(uid)` se inyecta. Devuelve el objeto del doc
 * `roles/{uid}` o null si no existe; puede tirar si la lectura falla.
 */

export const INTERNO_FUERA_DE_PAREJA = 'INTERNO_FUERA_DE_PAREJA';
export const INTERNO_FUERA_DE_PAREJA_MESSAGE =
  'Este pedido es de otro vendedor y no lo podés modificar.';
// Acciones que sacan el pedido del flujo (ej. pasarlo a espera, que borra el
// pedido): el interno solo puede sobre pedidos propios, no de la pareja
// (mismo criterio que firestore.rules: la pareja no cambia estado ni borra).
export const INTERNO_SOLO_PEDIDO_PROPIO = 'INTERNO_SOLO_PEDIDO_PROPIO';
export const INTERNO_SOLO_PEDIDO_PROPIO_MESSAGE =
  'Solo podés pasar a espera pedidos que cargaste vos.';

/**
 * @typedef {(uid: string) => Promise<any>} GetRoleDoc
 * @typedef {{ ok: boolean, via: string, reason: string }} ScopeResult
 */

/** @param {any} v */
function uidOf(v) {
  return typeof v === 'string' && v ? v : '';
}

/**
 * Evalúa si alguno de los uids candidatos es un VDE cuya pareja es el caller.
 *
 * @param {string} callerUid
 * @param {string[]} candidateUids
 * @param {GetRoleDoc} getRoleDoc
 * @returns {Promise<{ ok: boolean, unreadable: boolean }>}
 */
async function anyCandidateIsMyPartnerVde(callerUid, candidateUids, getRoleDoc) {
  let unreadable = false;
  const seen = new Set();
  for (const uid of candidateUids) {
    if (!uid || seen.has(uid) || uid === callerUid) continue;
    seen.add(uid);
    let doc = null;
    try {
      doc = await getRoleDoc(uid);
    } catch (_e) {
      unreadable = true;
      continue;
    }
    if (
      doc &&
      String(doc.role || '').toLowerCase() === 'vendedor' &&
      uidOf(doc.internalPartnerUid) === callerUid
    ) {
      return { ok: true, unreadable };
    }
  }
  return { ok: false, unreadable };
}

/**
 * @param {{ callerUid: string, doc: any, propioFields: string[], getRoleDoc: GetRoleDoc }} p
 * @returns {Promise<ScopeResult>}
 */
async function evaluateScope({ callerUid, doc, propioFields, getRoleDoc }) {
  const uid = uidOf(callerUid);
  if (!uid) return { ok: false, via: '', reason: 'sin_caller' };
  if (!doc || typeof doc !== 'object') return { ok: false, via: '', reason: 'sin_documento' };
  for (const f of propioFields) {
    if (uidOf(doc[f]) === uid) return { ok: true, via: 'propio', reason: '' };
  }
  if (typeof getRoleDoc !== 'function') {
    return { ok: false, via: '', reason: 'rol_ilegible' };
  }
  const r = await anyCandidateIsMyPartnerVde(
    uid,
    [uidOf(doc.ownerUid), uidOf(doc.assignedVendorUid)],
    getRoleDoc
  );
  if (r.ok) return { ok: true, via: 'pareja', reason: '' };
  return { ok: false, via: '', reason: r.unreadable ? 'rol_ilegible' : 'fuera_de_pareja' };
}

/**
 * Pedido (`/pedidos`): propio si ownerUid, createdByUid o cargadoPorUid es el
 * caller; de la pareja si ownerUid o assignedVendorUid es su VDE pareja.
 *
 * @param {{ callerUid: string, pedido: any, getRoleDoc: GetRoleDoc }} p
 * @returns {Promise<ScopeResult>}
 */
export function evaluatePedidoScopeInterno({ callerUid, pedido, getRoleDoc }) {
  return evaluateScope({
    callerUid,
    doc: pedido,
    propioFields: ['ownerUid', 'createdByUid', 'cargadoPorUid'],
    getRoleDoc,
  });
}

/**
 * @param {{ callerUid: string, pedido: any, getRoleDoc: GetRoleDoc }} p
 * @returns {Promise<boolean>}
 */
export async function isPedidoEnScopeInterno(p) {
  return (await evaluatePedidoScopeInterno(p)).ok;
}

/**
 * Orden en espera (`/revision_waitlist`): propia si ownerUid o cargadoPorUid
 * es el caller; de la pareja si ownerUid o assignedVendorUid es su VDE pareja.
 *
 * @param {{ callerUid: string, waitlist: any, getRoleDoc: GetRoleDoc }} p
 * @returns {Promise<ScopeResult>}
 */
export function evaluateWaitlistScopeInterno({ callerUid, waitlist, getRoleDoc }) {
  return evaluateScope({
    callerUid,
    doc: waitlist,
    propioFields: ['ownerUid', 'cargadoPorUid'],
    getRoleDoc,
  });
}

/**
 * @param {{ callerUid: string, waitlist: any, getRoleDoc: GetRoleDoc }} p
 * @returns {Promise<boolean>}
 */
export async function isWaitlistEnScopeInterno(p) {
  return (await evaluateWaitlistScopeInterno(p)).ok;
}

/**
 * `getRoleDoc` por defecto sobre Firestore (Admin SDK), con cache por
 * invocación. Lectura fuera de transacción: se llama antes de cualquier
 * write (§58). Si la lectura falla, tira (el evaluador lo trata como
 * ilegible = no concede).
 *
 * @param {any} fbDb
 * @returns {GetRoleDoc}
 */
export function makeGetRoleDoc(fbDb) {
  /** @type {Map<string, Promise<any>>} */
  const cache = new Map();
  return (uid) => {
    if (!cache.has(uid)) {
      const p = (async () => {
        const snap = await fbDb.collection('roles').doc(uid).get();
        if (!snap || snap.exists === false) return null;
        return snap.data() || null;
      })();
      // No cachear rechazos: un reintento dentro de la misma invocación
      // (retry de la transacción) puede leer bien.
      p.catch(() => cache.delete(uid));
      cache.set(uid, p);
    }
    return /** @type {Promise<any>} */ (cache.get(uid));
  };
}
