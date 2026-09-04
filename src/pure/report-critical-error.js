// @ts-check
/**
 * v805 (2026-09-04, Loop iter 2): reportador de errores críticos que antes
 * se tragaban con `.catch(e => console.warn(...))`.
 *
 * Reemplaza el anti-pattern por 3 acciones inyectables (testeable sin DOM
 * ni Sentry real):
 *   1. console.error (severity real, no warn).
 *   2. Sentry.captureException con tags (op, source, extra).
 *   3. Toast rojo visible al vendedor (no bloquea flow).
 *
 * Precedente v785: client_master.set falló silencioso 3 semanas hasta que
 * alguien reportó un bug. El costo de silent-catches es que detectamos el
 * problema cuando ya se rompió algo visible.
 *
 * Todas las deps son inyectables para poder mockear en Vitest. La versión
 * runtime en index.html conecta las deps reales (console, window.Sentry,
 * window._showErrorToast).
 */

/**
 * @typedef {Object} ConsoleLike
 * @property {(...args: unknown[]) => void} error
 */

/**
 * @typedef {Object} SentryLike
 * @property {(err: unknown, ctx?: {tags?: Record<string, string>, extra?: Record<string, unknown>}) => void} [captureException]
 */

/**
 * @typedef {Object} ReportDeps
 * @property {ConsoleLike} console
 * @property {SentryLike | null | undefined} sentry
 * @property {(msg: string) => void} showErrorToast Muestra toast rojo al user.
 * @property {string} [appVersion] Version de la app para tags Sentry.
 * @property {string | null | undefined} [userEmail] Email del user para extra context.
 */

/**
 * @typedef {Object} ReportOpts
 * @property {string} op Tag Sentry para agrupar issues. Kebab-case ej. 'waitlist-delete'.
 * @property {Record<string, unknown>} [extra] Context adicional (docId, uid, etc.).
 * @property {string} [userMsg] Mensaje custom al usuario. Default: "No pude {op}. Reintentá en un momento."
 * @property {boolean} [silent] Si true: solo captura a Sentry, NO muestra toast.
 */

/**
 * Reporta un error crítico. Deps inyectables para testeo.
 *
 * @param {unknown} err
 * @param {ReportOpts} opts
 * @param {ReportDeps} deps
 */
export function reportCriticalErrorPure(err, opts, deps) {
  const op = String((opts && opts.op) || 'unknown');
  const extra = (opts && opts.extra) || {};
  const userMsg =
    (opts && opts.userMsg) || 'No pude ' + op.replace(/-/g, ' ') + '. Reintentá en un momento.';
  const silent = !!(opts && opts.silent);

  // 1. console.error real (no warn — es error de verdad).
  deps.console.error('[' + op + ']', err, extra);

  // 2. Sentry con tag para agrupar. Best-effort — nunca romper el flow.
  try {
    if (deps.sentry && typeof deps.sentry.captureException === 'function') {
      deps.sentry.captureException(err, {
        tags: { op: op, source: 'reportCriticalError' },
        extra: Object.assign({}, extra, {
          appVersion: deps.appVersion || 'unknown',
          userEmail: deps.userEmail || null,
        }),
      });
    }
  } catch (_sentryErr) {
    // Sentry es best-effort — NUNCA bloquear el flow por fallo del reporter.
  }

  // 3. Toast rojo al user (no bloqueante).
  if (!silent) {
    try {
      deps.showErrorToast(userMsg);
    } catch (_toastErr) {
      // Edge case bootstrap: DOM no listo. Silencioso.
    }
  }
}
