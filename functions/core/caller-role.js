// @ts-check
/**
 * §SEC-AUTH-001 ítem 2 + §SEC-CF-003 (PR #1 v1520, 2026-10-28) — role gate helper.
 *
 * Rechaza callers de Cloud Functions `commitPedidoCF` + `updatePedidoLinesCF`
 * si no tienen doc `/roles/{auth.uid}` con `role ∈ ALLOWED_ROLES`.
 *
 * Antes del fix: ambos CFs validaban solo `ALLOWED_DOMAINS` (shimano.com.ar,
 * shimano.uy, gmail.com). Una cuenta orphan `x@shimano.com.ar` creada via
 * `createUserWithEmailAndPassword` directo contra Firebase Web API (bypass
 * de doInlineLogin + validate+kick client-side de v993) pasaba el gate y
 * podía crear pedidos / editar líneas. Firestore reads estaban cerrados por
 * `isReader()`, pero los CFs no chequeaban role.
 *
 * El helper es puro: recibe `role` (string | null | undefined), devuelve
 * `{ok, errorCode?, normalized}`. Los wrappers leen `/roles/{auth.uid}.role`
 * server-side y lo pasan al helper; el cliente no puede inyectar.
 *
 * Reemplaza `ALLOWED_DOMAINS` en los wrappers (role gate es más fuerte +
 * compatible con Gmail legítimos como Pachi + Mariano).
 */

export const ALLOWED_ROLES = Object.freeze(new Set(['vendedor', 'interno', 'gerente', 'admin']));

/**
 * @param {unknown} role Valor leído de `/roles/{auth.uid}.role`.
 * @returns {{ok: boolean, errorCode?: string, normalized: string}}
 */
export function assertCallerRole(role) {
  const normalized = String(role ?? '')
    .toLowerCase()
    .trim();
  if (!ALLOWED_ROLES.has(normalized)) {
    return { ok: false, errorCode: 'ROLE_REQUIRED', normalized };
  }
  return { ok: true, normalized };
}
