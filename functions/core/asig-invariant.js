// @ts-check
/**
 * v1520 (2026-10-29) — invariante: una línea state='ASIG' siempre tiene
 * qtyOpen > 0. Una ASIG sin unidades abiertas es una "zombie": el breakdown la
 * ignora, pero los flujos que buscan la línea origen por producto la toman y
 * fallan (CPST REBORN CLC66H2PY 2026-10-29).
 *
 * Toda escritura de reparto (applyRepartoManualCore, revertSobreAsignadas)
 * valida esto antes de escribir.
 */

/**
 * @param {any[]} lines
 * @returns {number[]} índices de líneas ASIG con qtyOpen <= 0.
 */
export function findZombieAsigLines(lines) {
  /** @type {number[]} */
  const out = [];
  (Array.isArray(lines) ? lines : []).forEach((l, i) => {
    if (l && l.state === 'ASIG' && !((Number(l.qtyOpen) || 0) > 0)) out.push(i);
  });
  return out;
}
