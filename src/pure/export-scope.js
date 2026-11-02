// @ts-check
/**
 * v1534 (2026-11-02) — Alcance por rol de las exportaciones del modal
 * "Reportes Excel" (auditoría docs/auditoria/46, Etapa 1).
 *
 * Reglas (decisiones de Mariano):
 *   - "Los clientes de un vendedor" = el master ACTUAL del cliente (POINTS +
 *     vendor_overrides + approvedAltas, CLAUDE.md §46/§50). NO el vendedor
 *     que quedó guardado en el pedido (assignedVendorUid se graba al crear y
 *     no se re-sincroniza cuando cambia el master).
 *   - Vendedor (VDE): un pedido entra solo si el vendedor del master de su
 *     cliente es el suyo Y además `assignedVendorUid === myUid` (defensa en
 *     profundidad: `myUid` sale de Firebase Auth, no de `userRole`).
 *   - Interno (VDI): un pedido entra si el vendedor del master de su cliente
 *     está en su conjunto de vendedores (su zona + sus parejas, el mismo que
 *     usa el mapa: getMyAllowedVendorKeys / getEffectiveVendorSet('ALL')).
 *   - Admin / gerente / viewer / otros: sin cambio (global).
 *   - Visitas: el vendedor ve solo las que cargó él (`ownerUid === myUid`);
 *     el interno ve las suyas + las de sus parejas (por `ownerUid` de una
 *     pareja, por `createdByUid` propio o por `vendor` ∈ su conjunto).
 *
 * Si el master no resuelve al cliente (cliente nuevo / prospecto sin zona),
 * se usa el `vendorAssigned` guardado en el pedido. `ownerVendor` (= quién lo
 * cargó, legacy) NO se usa para decidir el alcance; solo como último recurso
 * para la columna "Vendedor" del Excel.
 */

/**
 * @typedef {(cardCode: string, clientName: string) => string} ResolveVendorForClient
 */

/**
 * @typedef {Object} ExportScopeArgs
 * @property {string|null|undefined} role
 * @property {string|null|undefined} [myUid]
 * @property {string|null|undefined} [myVendorKey]
 * @property {Set<string>|Array<string>|null|undefined} [effectiveVendorSet]
 * @property {Array<string>|Set<string>|null|undefined} [partnerUids]
 * @property {ResolveVendorForClient} [resolveVendorForClient]
 */

/**
 * @typedef {Object} ExportScope
 * @property {boolean} isGlobal
 * @property {boolean} visitsQueryByOwnerUid - true: consultar visits con where('ownerUid','==',uid).
 * @property {(pedidos: Array<any>) => Array<any>} filterPedidos
 * @property {(visits: Array<any>) => Array<any>} filterVisits
 * @property {(p: any) => string} vendorColumnForPedido
 */

/**
 * Normaliza un vendorKey: trim + mayúsculas.
 * @param {any} k
 * @returns {string}
 */
export function normVendorKey(k) {
  return String(k || '')
    .trim()
    .toUpperCase();
}

/**
 * Vendedor del master actual para el cliente del pedido. '' si no resuelve.
 * @param {any} p
 * @param {ResolveVendorForClient|undefined} resolve
 * @returns {string}
 */
function masterVendorKey(p, resolve) {
  if (!p || typeof resolve !== 'function') return '';
  try {
    return normVendorKey(resolve(String(p.clientCardCode || ''), String(p.clientName || '')));
  } catch (_e) {
    return '';
  }
}

/**
 * Vendedor que define el alcance del pedido: master actual; si el master no
 * resuelve, el `vendorAssigned` guardado en el pedido.
 * @param {any} p
 * @param {ResolveVendorForClient} [resolve]
 * @returns {string}
 */
export function resolvePedidoVendorKey(p, resolve) {
  if (!p) return '';
  return masterVendorKey(p, resolve) || normVendorKey(p.vendorAssigned);
}

/**
 * Valor de la columna "Vendedor" del Excel de Pedidos del mes: master actual,
 * después `vendorAssigned`, y `ownerVendor` solo si no hay otra cosa.
 * @param {any} p
 * @param {ResolveVendorForClient} [resolve]
 * @returns {string}
 */
export function vendorColumnForPedido(p, resolve) {
  if (!p) return '';
  return (
    masterVendorKey(p, resolve) ||
    String(p.vendorAssigned || '').trim() ||
    String(p.ownerVendor || '').trim()
  );
}

/**
 * @param {Set<string>|Array<string>|null|undefined} s
 * @returns {Set<string>|null}
 */
function toNormSet(s) {
  if (!s) return null;
  const out = new Set();
  for (const k of /** @type {Iterable<string>} */ (s)) {
    const n = normVendorKey(k);
    if (n) out.add(n);
  }
  return out;
}

/**
 * Arma los filtros de exportación para el rol del usuario.
 * @param {ExportScopeArgs} args
 * @returns {ExportScope}
 */
export function buildExportScope(args) {
  const a = args || /** @type {ExportScopeArgs} */ ({ role: null });
  const role = String(a.role || '');
  const myUid = String(a.myUid || '').trim();
  const myKey = normVendorKey(a.myVendorKey);
  const resolve =
    typeof a.resolveVendorForClient === 'function' ? a.resolveVendorForClient : undefined;
  /** @param {any} p */
  const vendorColumn = (p) => vendorColumnForPedido(p, resolve);
  /** @param {Array<any>} arr */
  const compact = (arr) => (Array.isArray(arr) ? arr.filter(Boolean) : []);

  if (role === 'vendedor') {
    return {
      isGlobal: false,
      visitsQueryByOwnerUid: true,
      vendorColumnForPedido: vendorColumn,
      filterPedidos: (arr) => {
        if (!myUid || !myKey) return [];
        return compact(arr).filter(
          (p) =>
            String(p.assignedVendorUid || '') === myUid &&
            resolvePedidoVendorKey(p, resolve) === myKey
        );
      },
      filterVisits: (arr) => {
        if (!myUid) return [];
        return compact(arr).filter((v) => String(v.ownerUid || '') === myUid);
      },
    };
  }

  if (role === 'interno') {
    const set = toNormSet(a.effectiveVendorSet);
    const partners = new Set(
      Array.from(/** @type {Iterable<string>} */ (a.partnerUids || []))
        .map((u) => String(u || '').trim())
        .filter(Boolean)
    );
    return {
      isGlobal: false,
      visitsQueryByOwnerUid: false,
      vendorColumnForPedido: vendorColumn,
      filterPedidos: (arr) => {
        if (!set || set.size === 0) return [];
        return compact(arr).filter((p) => {
          const k = resolvePedidoVendorKey(p, resolve);
          return !!k && set.has(k);
        });
      },
      filterVisits: (arr) =>
        compact(arr).filter((v) => {
          const owner = String(v.ownerUid || '');
          if (myUid && (owner === myUid || String(v.createdByUid || '') === myUid)) return true;
          if (owner && partners.has(owner)) return true;
          const k = normVendorKey(v.vendor);
          return !!set && !!k && set.has(k);
        }),
    };
  }

  // Admin / gerente / viewer / otros: sin cambio.
  return {
    isGlobal: true,
    visitsQueryByOwnerUid: false,
    vendorColumnForPedido: vendorColumn,
    filterPedidos: (arr) => compact(arr),
    filterVisits: (arr) => compact(arr),
  };
}
