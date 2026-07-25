// @ts-check
/**
 * Sentry helpers (Fase 0 E7).
 *
 * El loader CDN de Sentry expone `window.Sentry` asíncronamente y hace
 * queue de calls previos. Estas funciones son las que el resto de la
 * app llama cuando quiere setear contexto de usuario o forzar un error
 * de prueba.
 *
 * Testeable: `sentry` se pasa como parámetro para poder mockear en
 * Vitest (no depende del global).
 *
 * IMPORTANTE: la implementación real vive INLINE en index.html hasta
 * que E2 modularice el bundle. Este módulo es la source-of-truth y
 * también lo consume E2 cuando arme el bundle esbuild.
 */

/**
 * @typedef {Object} SentryLike
 * @property {(user: {id?: string, email?: string} | null) => void} [setUser]
 * @property {(key: string, value: string | undefined) => void} [setTag]
 * @property {(err: unknown) => void} [captureException]
 */

/**
 * @typedef {Object} UserContext
 * @property {string} uid
 * @property {string} [email]
 */

/**
 * Aplica contexto de usuario a Sentry. Silencioso si `sentry` no está
 * cargado todavía (loader async). Los tags viajan con todo error
 * reportado a partir de ahora.
 *
 * @param {SentryLike | null | undefined} sentry
 * @param {UserContext | null} user
 * @param {string | null | undefined} role Ej: 'admin', 'gerente', 'vendedor'.
 * @param {string | null | undefined} vendor Ej: 'GONZALO', 'MARTIN'.
 */
export function applySentryUserContext(sentry, user, role, vendor) {
  if (!sentry) return;
  try {
    if (user && typeof sentry.setUser === 'function') {
      sentry.setUser({ id: user.uid, email: user.email });
    } else if (user === null && typeof sentry.setUser === 'function') {
      sentry.setUser(null); // logout: clear PII
    }
    if (typeof sentry.setTag === 'function') {
      sentry.setTag('role', role || 'unknown');
      sentry.setTag('vendor', vendor || 'none');
    }
  } catch {
    // Sentry es best-effort: nunca romper el flow de auth por fallar acá.
  }
}
