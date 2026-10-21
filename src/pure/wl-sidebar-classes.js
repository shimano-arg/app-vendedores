// @ts-check
/**
 * v1396 (2026-10-21) — Clases CSS para una card de "Pedidos en Espera"
 * (sidebar `#slft-wl-rows` + modal `#waitlist-modal`).
 *
 * Pure function. Idempotente: mismo input → mismo output, en cualquier render,
 * en cualquier orden del listener Firestore. Precedente: pre-v1396 el render
 * calculaba `has-exceed` y `source-cpst` inline + las reglas CSS asignaban
 * backgrounds distintos por combinación → flicker 3-4s entre primer render
 * (globalPedidos/snapshot vacíos → excedentes falsos positivos) y segundo
 * render (snapshot llegó → excedentes reales). CLAUDE.md §40.4.
 *
 * El background de una card con badge STOCK ASIG es UN SOLO color (#fdba74)
 * en todos los estados. `has-exceed` solo cambia el border-left-color. Ver
 * `styles/apple-design.css:1979-...`.
 */

/**
 * ¿El waitlist viene de "Crear Pedido Desde Stock Asignado"?
 *
 * Primario: `source === 'stock-asignado-batch'` (escrito en _cpstConfirmar).
 * Fallback: `pedidosOrigenes[]` populated — también se escribe en el write
 * original, útil cuando el cache local trae un snapshot stale sin `source`.
 *
 * @param {{ source?: string, pedidosOrigenes?: Array<unknown> } | null | undefined} w
 * @returns {boolean}
 */
export function isWaitlistCpst(w) {
  if (!w || typeof w !== 'object') return false;
  if (w.source === 'stock-asignado-batch') return true;
  if (Array.isArray(w.pedidosOrigenes) && w.pedidosOrigenes.length > 0) return true;
  return false;
}

/**
 * Clases para una card del sidebar. Siempre incluye 'slft-wl-item'. Suma
 * 'has-exceed' si `hasExceed=true`. Suma 'source-cpst' si `isWaitlistCpst(w)`.
 *
 * @param {Parameters<typeof isWaitlistCpst>[0]} w
 * @param {boolean} hasExceed
 * @returns {string[]}
 */
export function computeWaitlistCardClasses(w, hasExceed) {
  const cls = ['slft-wl-item'];
  if (hasExceed === true) cls.push('has-exceed');
  if (isWaitlistCpst(w)) cls.push('source-cpst');
  return cls;
}
