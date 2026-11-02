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
 *   - Admin / gerente / viewer: sin cambio (global). Otro rol o sin rol: nada.
 *   - Visitas: el vendedor ve solo las que cargó él (`ownerUid === myUid`);
 *     el interno ve las suyas + las de sus parejas (por `ownerUid` de una
 *     pareja, por `createdByUid` propio o por `vendor` ∈ su conjunto).
 *
 * Solo un prospecto sin CardCode SAP cae al `vendorAssigned` guardado en el
 * pedido. Un CardCode que el master no resuelve, o una zona sin vendedor,
 * queda fuera del alcance de vendedor e interno. `ownerVendor` (= quién lo
 * cargó, legacy) NO se usa para decidir el alcance; solo como último recurso
 * para la columna "Vendedor" del Excel.
 */

/**
 * @typedef {(cardCode: string, clientName: string) => (string|{vendorKey?: string, reason?: string})} ResolveVendorForClient
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
 * Resultado del master para el cliente del pedido. Acepta un resolver que
 * devuelve string (vendorKey) o {vendorKey, reason}.
 * @param {any} p
 * @param {ResolveVendorForClient|undefined} resolve
 * @returns {{vendorKey: string, reason: string}}
 */
function masterLookup(p, resolve) {
  if (!p || typeof resolve !== 'function') return { vendorKey: '', reason: 'sin_resolver' };
  try {
    const r = resolve(String(p.clientCardCode || ''), String(p.clientName || ''));
    if (r && typeof r === 'object') {
      return { vendorKey: normVendorKey(r.vendorKey), reason: String(r.reason || '') };
    }
    return { vendorKey: normVendorKey(r), reason: '' };
  } catch (_e) {
    return { vendorKey: '', reason: 'error' };
  }
}

/**
 * Vendedor que define el alcance del pedido:
 *   - el del master actual, si resuelve;
 *   - zona sin vendedor (incluido distribuidor): '' (el master manda);
 *   - prospecto sin CardCode SAP: el `vendorAssigned` guardado en el pedido;
 *   - CardCode SAP que el master no resuelve: '' (falla cerrado). Ej.: un alta
 *     reasignada a otro vendedor desaparece del approvedAltasList del VDE y
 *     el `vendorAssigned` viejo no tiene que volver a meterla.
 * @param {any} p
 * @param {ResolveVendorForClient} [resolve]
 * @returns {string}
 */
export function resolvePedidoVendorKey(p, resolve) {
  if (!p) return '';
  const m = masterLookup(p, resolve);
  if (m.vendorKey) return m.vendorKey;
  if (m.reason === 'zona_sin_vendedor') return '';
  if (!String(p.clientCardCode || '').trim()) return normVendorKey(p.vendorAssigned);
  return '';
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
  const m = masterLookup(p, resolve);
  if (m.vendorKey) return m.vendorKey;
  // Zona sin vendedor: la columna queda vacía (no se muestra el vendedor viejo).
  if (m.reason === 'zona_sin_vendedor') return '';
  return String(p.vendorAssigned || '').trim() || String(p.ownerVendor || '').trim();
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

  if (role !== 'admin' && role !== 'gerente' && role !== 'viewer') {
    // Rol vacío, 'unassigned' o desconocido: no exporta nada (falla cerrado).
    return {
      isGlobal: false,
      visitsQueryByOwnerUid: false,
      vendorColumnForPedido: vendorColumn,
      filterPedidos: () => [],
      filterVisits: () => [],
    };
  }

  // Admin / gerente / viewer: sin cambio (global).
  return {
    isGlobal: true,
    visitsQueryByOwnerUid: false,
    vendorColumnForPedido: vendorColumn,
    filterPedidos: (arr) => compact(arr),
    filterVisits: (arr) => compact(arr),
  };
}
