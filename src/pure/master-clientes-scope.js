// @ts-check
/**
 * v1545 (2026-11-02) — Alcance de Master Clientes por rol.
 *
 * Reglas (Mariano 2026-11-02):
 *   - admin / gerente: ven todo y editan (sin cambio).
 *   - vendedor: ve solo los clientes cuyo vendedor en el master es el suyo
 *     (`myVendorKey`). Solo lectura.
 *   - interno (VDI): ve su zona + la de sus parejas (el mismo conjunto que
 *     usa el mapa, `getMyAllowedVendorKeys`). Solo lectura.
 *   - Cualquier otro rol o sin rol: no entra.
 *
 * "El vendedor del master" es el `vendor` que ya calcula `getAllStoreEntries`
 * (POINTS + vendor_overrides vía getEffectiveVendorForClient; altas SAP vía
 * assignedVendor), el mismo que muestra la columna Vendedor.
 *
 * El filtro es de pantalla: `client_master` sigue legible para cualquier
 * usuario logueado (firestore.rules), igual que antes.
 */

/** @param {unknown} v */
function canonVendor(v) {
  return String(v == null ? '' : v)
    .trim()
    .toUpperCase();
}

/**
 * @typedef {Object} MasterClientesScopeArgs
 * @property {string|null|undefined} role
 * @property {string|null|undefined} [myVendorKey]
 * @property {Iterable<string>|null|undefined} [allowedVendorKeys] - interno: su zona + parejas.
 */

/**
 * @typedef {Object} MasterClientesScope
 * @property {boolean} canOpen
 * @property {boolean} isGlobal - true: ve todos los clientes.
 * @property {boolean} readOnly - true: no puede guardar, borrar ni reasignar.
 * @property {string|null} fixedVendorKey - vendedor: filtro de vendedor fijo en el suyo.
 * @property {(vendorKey: unknown) => boolean} allowsVendor
 * @property {<T>(items: T[], getVendor: (item: T) => unknown) => T[]} filter
 */

/**
 * @param {MasterClientesScopeArgs} args
 * @returns {MasterClientesScope}
 */
export function buildMasterClientesScope(args) {
  const role = String((args && args.role) || '').trim();
  /** @type {Set<string>} */
  let allowed = new Set();
  let isGlobal = false;
  let canOpen = false;
  let fixedVendorKey = null;

  if (role === 'admin' || role === 'gerente') {
    isGlobal = true;
    canOpen = true;
  } else if (role === 'vendedor') {
    const mine = canonVendor(args && args.myVendorKey);
    canOpen = true;
    if (mine) {
      allowed = new Set([mine]);
      fixedVendorKey = mine;
    }
  } else if (role === 'interno') {
    canOpen = true;
    const keys = (args && args.allowedVendorKeys) || [];
    for (const k of keys) {
      const c = canonVendor(k);
      if (c) allowed.add(c);
    }
    const mine = canonVendor(args && args.myVendorKey);
    if (mine) allowed.add(mine);
  }

  /** @param {unknown} vendorKey */
  const allowsVendor = (vendorKey) => {
    if (isGlobal) return true;
    const c = canonVendor(vendorKey);
    return !!c && allowed.has(c);
  };

  return {
    canOpen,
    isGlobal,
    readOnly: !isGlobal,
    fixedVendorKey,
    allowsVendor,
    filter(items, getVendor) {
      const arr = Array.isArray(items) ? items : [];
      if (isGlobal) return arr.slice();
      if (!canOpen) return [];
      return arr.filter((it) => allowsVendor(getVendor(it)));
    },
  };
}
