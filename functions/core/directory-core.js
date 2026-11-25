// @ts-check
/**
 * S-7 P0-A Fase 2A: directory de usuarios sin secretos.
 *
 * Cierra el hueco S04 permitiendo que el cliente lea la lista de
 * users (role / vendor / email / displayName / etc.) SIN exponer
 * los secretos (passwordHash, passwordSalt, totpSecret, totpEnabled)
 * que vivian en /roles/{uid}.
 *
 * El wrapper Cloud Function valida que el caller este autenticado
 * y tenga rol ∈ {admin, gerente, interno, vendedor}. Este core puro
 * recibe `deps.fbDb` (Admin SDK) + payload saneado y hace la query.
 *
 * Deps:
 *   deps.fbDb   Firestore Admin instance (.collection())
 *   deps.log    (msg, extra?) => void   opcional
 *   deps.now    () => Date              opcional (reservado para futuros caches)
 *
 * Nunca retorna campos del set PRIVATE_FIELDS (passwordHash, passwordSalt,
 * totpSecret, totpEnabled). Solo arma el shape desde PUBLIC_FIELDS.
 */

/** Campos publicos retornables al cliente. Lista frozen para que un
 * add accidental de campo nuevo no filtre data sensible por default. */
export const PUBLIC_FIELDS = Object.freeze([
  'role',
  'vendor',
  'zone',
  'internalPartnerUid',
  'name',
  'email',
  'displayName',
  'active',
]);

/** Set de campos que NUNCA van al cliente. Defensa en profundidad
 * por si alguien agrega un campo a PUBLIC_FIELDS sin revisar. */
export const PRIVATE_FIELDS = Object.freeze([
  'passwordHash',
  'passwordSalt',
  'totpSecret',
  'totpEnabled',
]);

/** Limite de UIDs por invocacion. Firestore `in` query limit es 30 por
 * sub-query; agrupamos de a 10 para dejar margen con otros `where`. */
const MAX_UIDS = 50;
const UIDS_BATCH_SIZE = 10;

/** Roles validos para el filtro `filterRole`. */
const VALID_ROLES = Object.freeze(['admin', 'gerente', 'interno', 'vendedor']);

/**
 * @param {{fbDb: any, log?: (msg: string, extra?: any) => void, now?: () => Date}} deps
 * @param {{filterRole?: string, uids?: string[], byVendorKey?: string}} payload
 * @returns {Promise<{users: Array<{uid: string, [k: string]: any}>}>}
 */
export async function getUsersDirectoryCore(deps, payload) {
  if (!deps || !deps.fbDb) {
    throw new Error('getUsersDirectoryCore requires deps.fbDb');
  }
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  const p = payload || {};

  // Sanitizar payload.
  const filterRole =
    typeof p.filterRole === 'string' && VALID_ROLES.includes(p.filterRole) ? p.filterRole : null;

  const byVendorKey =
    typeof p.byVendorKey === 'string' && p.byVendorKey.trim().length > 0
      ? p.byVendorKey.trim()
      : null;

  let uids = null;
  if (Array.isArray(p.uids)) {
    const filtered = p.uids.filter((u) => typeof u === 'string' && u.length > 0 && u.length <= 128);
    uids = filtered.slice(0, MAX_UIDS);
  }

  // Construir query base.
  let qRef = deps.fbDb.collection('roles');
  if (filterRole) qRef = qRef.where('role', '==', filterRole);
  if (byVendorKey) qRef = qRef.where('vendor', '==', byVendorKey);

  /** @type {Array<any>} */
  const docs = [];

  if (uids && uids.length > 0) {
    // Fetch por uids. Firestore `in` limita a 30; agrupamos de a 10.
    /** @type {Array<Promise<any>>} */
    const batches = [];
    for (let i = 0; i < uids.length; i += UIDS_BATCH_SIZE) {
      const chunk = uids.slice(i, i + UIDS_BATCH_SIZE);
      batches.push(qRef.where('__name__', 'in', chunk).get());
    }
    const results = await Promise.all(batches);
    for (const qs of results) {
      if (!qs || typeof qs.forEach !== 'function') continue;
      qs.forEach((/** @type {any} */ d) => docs.push(d));
    }
  } else {
    const qs = await qRef.get();
    if (qs && typeof qs.forEach === 'function') {
      qs.forEach((/** @type {any} */ d) => docs.push(d));
    }
  }

  // Strip secrets + build response. Solo copiamos PUBLIC_FIELDS.
  const users = docs.map((doc) => {
    const data = doc && typeof doc.data === 'function' ? doc.data() || {} : {};
    /** @type {{uid: string, [k: string]: any}} */
    const clean = { uid: doc.id };
    for (const f of PUBLIC_FIELDS) {
      if (data[f] !== undefined) clean[f] = data[f];
    }
    return clean;
  });

  log('[getUsersDirectoryCore] ok', {
    filterRole: filterRole || null,
    byVendorKey: byVendorKey || null,
    uidsCount: uids ? uids.length : 0,
    returned: users.length,
  });

  return { users };
}
