// @ts-check
/**
 * §Decisión-1 v1577 (2026-11-25) — gate INTERNO_CLIENTE_FUERA_DE_PAREJA usa
 * shape canónico VDE→interno.
 *
 * Shape canónico (ya establecido en rules + `interno-scope.js`):
 *   `roles/{uidVDE}.internalPartnerUid = <uidInterno>`.
 *
 * Un VDE apunta a un interno; N VDEs pueden apuntar al mismo interno.
 * El doc del interno NO tiene `internalPartnerUid` (eso era el shape invertido
 * que v1577 leía por error).
 *
 * Este helper hace la query inversa: dado un `internoUid`, devuelve los UIDs
 * de TODOS los VDEs que lo tienen como pareja.
 *
 * El mirror `functions/core/interno-pareja-helpers.js` es verbatim (§57).
 * NO EDITAR SIN REPLICAR EL CAMBIO EN EL MIRROR.
 */

/**
 * Query roles del VDE pareja de un interno. Shape canónico:
 * roles/{uidVDE}.internalPartnerUid = <uidInterno>.
 *
 * @param {any} fbDb Firestore admin SDK instance.
 * @param {string} internoUid
 * @returns {Promise<Set<string>>} Set de UIDs de VDEs pareja.
 */
export async function getVendorsPairedWithInterno(fbDb, internoUid) {
  if (!internoUid || !fbDb) return new Set();
  const qs = await fbDb.collection('roles').where('internalPartnerUid', '==', internoUid).get();
  /** @type {Set<string>} */
  const set = new Set();
  qs.forEach((/** @type {any} */ doc) => {
    const data = doc.data() || {};
    // Validar que es realmente un VDE (defensivo, por si el campo quedó setteado en otro rol).
    if (data.role === 'vendedor' && doc.id) set.add(doc.id);
  });
  return set;
}

/**
 * Chequea si `vendorUid` es pareja del `internoUid` usando el set precomputado.
 * Fail-closed: null/undefined → false.
 *
 * @param {string | null | undefined} vendorUid
 * @param {Set<string> | null | undefined} pairedSet
 * @returns {boolean}
 */
export function isVendorInInternoPair(vendorUid, pairedSet) {
  if (!vendorUid || !pairedSet) return false;
  return pairedSet.has(vendorUid);
}
