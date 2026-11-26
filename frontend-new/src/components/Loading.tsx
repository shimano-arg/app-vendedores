/**
 * Loading — skeleton CWV-friendly para Suspense fallback y navegaciones.
 *
 * Reglas:
 * - Zero CLS: ocupa el mismo bounding box que el contenido real (reserva vertical
 *   via min-height derivada de --shell-main-h).
 * - Sin animaciones pesadas por default — respetamos prefers-reduced-motion.
 * - No usa imagenes ni fuentes externas; texto plano.
 */
export function Loading(): JSX.Element {
  return (
    <div className="loading" role="status" aria-live="polite" aria-busy="true">
      <div className="loading__pulse" aria-hidden="true" />
      <span className="loading__text">Cargando…</span>
    </div>
  );
}

export default Loading;
