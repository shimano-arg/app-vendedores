// @ts-check
/**
 * v808 (2026-09-04, Loop iter 5): render de skeleton rows para loading states
 * de paneles waitlist.
 *
 * Reemplaza el "Cargando..." plano por N filas placeholder gris con animacion
 * shimmer, mejorando percepcion de carga (el vendedor ve estructura, no un
 * modal en blanco 2-5s).
 *
 * Pura: recibe el container + count + deps inyectables. Testeable en Vitest
 * sin DOM real (dep.doc mockeable).
 *
 * CSS asociada: clase `.wcard-skeleton-row` (definida en index.html <style>).
 */

/**
 * @typedef {Object} DocLike
 * @property {(tag: string) => any} createElement
 */

/**
 * @typedef {Object} RenderDeps
 * @property {DocLike} doc
 */

/**
 * Renderea `count` filas skeleton dentro de `container`. Limpia previo primero.
 *
 * @param {*} container Elemento (o mock) con appendChild + firstChild + removeChild
 * @param {number} count Cantidad de filas skeleton a mostrar (>=1).
 * @param {RenderDeps} deps
 */
export function renderSkeletonRowsPure(container, count, deps) {
  if (!container || !deps || !deps.doc) return;
  const n = Math.max(1, Math.floor(Number(count) || 0));

  while (container.firstChild) container.removeChild(container.firstChild);

  for (let i = 0; i < n; i++) {
    const row = deps.doc.createElement('div');
    row.className = 'wcard-skeleton-row';
    container.appendChild(row);
  }
}
