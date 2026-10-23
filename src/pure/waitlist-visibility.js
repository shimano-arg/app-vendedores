// @ts-check
/**
 * §59 (2026-10-23) — Visibilidad de `revision_waitlist` para el VDE.
 *
 * Un VDE ve TODAS las órdenes abiertas de sus clientes, no importa quién
 * la cargó. "Cliente del VDE" = `w.assignedVendorUid === myUid` (campo
 * escrito por §44 + §46 desde el cliente master OCRD + overrides +
 * approvedAltas).
 *
 * Precedente del bug (2026-10-23, prod):
 *   - Mariano reportó que el guard §42.2 ofrecía unificar la ORDEN 516
 *     (BROBRO SA, cargada por Pablo) a Gonzalo, pero Gonzalo NO veía esa
 *     orden en su lista de espera.
 *   - Causa: el filtro de sidebar/widgets del VDE filtraba por `ownerUid`
 *     ("quien cargó") en vez de `assignedVendorUid` ("vendedor del
 *     cliente master"). Pablo cargó la 516 para un cliente de Gonzalo:
 *     la orden quedaba visible para Pablo (ownerUid) pero oculta para
 *     Gonzalo (assignedVendorUid).
 *   - El guard §42.2 (vive del cliente master) sí la detectaba, abriendo
 *     ventana a "ofrecer unificar algo que el VDE no puede abrir".
 *   - CLAUDE.md §46: el vendedor de un pedido/waitlist siempre viene del
 *     cliente master → el filtro de visibilidad TIENE que usar el mismo
 *     campo.
 *
 * Regla implementada por `isWaitlistVisibleForVendor(w, uid)`:
 *   1. Si `w.assignedVendorUid` está populated: visible SOLO si === uid.
 *   2. Si NO está populated (docs legacy pre-§44): fallback a:
 *      - `w.ownerUid === uid` (lo cargó él mismo), O
 *      - `w.ownerVendor === myVendorKey` o `w.vendorAssigned === myVendorKey`
 *        (su zona cargó por otro user antes de §44).
 *   El fallback preserva compat con órdenes creadas pre-§44 — pero una
 *   orden post-§44 SIEMPRE tiene `assignedVendorUid`, por lo que el
 *   fallback NUNCA aplica en flows nuevos.
 *
 * Admin/gerente/interno NO llaman a esta función — ellos ven todo.
 */

/**
 * @typedef {Object} WaitlistDoc
 * @property {string} [assignedVendorUid]
 * @property {string} [ownerUid]
 * @property {string} [ownerVendor]
 * @property {string} [vendorAssigned]
 */

/**
 * Determina si una waitlist es visible para un VDE según su UID y vendorKey.
 *
 * @param {WaitlistDoc} w - Doc de `revision_waitlist`.
 * @param {string} myUid - UID Firebase del VDE logueado.
 * @param {string} [myVendorKey] - vendorKey canónico ("MAURICIO GIL", etc.) del VDE.
 *   Solo se usa en el fallback para docs legacy sin `assignedVendorUid`.
 * @returns {boolean} true si el VDE puede ver la orden.
 */
export function isWaitlistVisibleForVendor(w, myUid, myVendorKey) {
  if (!w || !myUid) return false;
  const assigned = String(w.assignedVendorUid || '').trim();
  if (assigned) {
    // Post-§44: autoridad = assignedVendorUid.
    return assigned === myUid;
  }
  // Pre-§44 (legacy): fallback a ownerUid + vendorAssigned.
  const owner = String(w.ownerUid || '').trim();
  if (owner && owner === myUid) return true;
  const vk = String(myVendorKey || '').trim();
  if (!vk) return false;
  const ownerV = String(w.ownerVendor || '').trim();
  const vAss = String(w.vendorAssigned || '').trim();
  return ownerV === vk || vAss === vk;
}

/**
 * Filtra un array de waitlists según `isWaitlistVisibleForVendor`.
 *
 * @param {Array<WaitlistDoc>} list
 * @param {string} myUid
 * @param {string} [myVendorKey]
 * @returns {Array<WaitlistDoc>}
 */
export function filterWaitlistsForVendor(list, myUid, myVendorKey) {
  if (!Array.isArray(list)) return [];
  if (!myUid) return [];
  return list.filter((w) => isWaitlistVisibleForVendor(w, myUid, myVendorKey));
}
