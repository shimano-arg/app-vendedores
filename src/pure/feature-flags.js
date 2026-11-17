/**
 * feature-flags.js — reads from `app_config/feature_flags` doc.
 *
 * E2 reparto-dep12 (FIX-A7 §11.2): `dep12_reparto_enabled` controla si la
 * CF del reparto procesa deltas/cancelaciones dep 12. Default `false`
 * (safety off). Script rollback `U_revert_dep12_asigs.cjs --apply` aborta
 * si el flag sigue `true` para prevenir loop CF↔script.
 *
 * Mirror obligatorio en `functions/core/feature-flags.js` (§57).
 */

/**
 * @param {Record<string, unknown> | null | undefined} doc - app_config/feature_flags data.
 * @param {string} key - flag name.
 * @param {boolean} [defaultValue=false]
 * @returns {boolean}
 */
export function readFlag(doc, key, defaultValue = false) {
  if (!doc || typeof doc !== 'object') return defaultValue;
  const v = /** @type {any} */ (doc)[key];
  if (typeof v === 'boolean') return v;
  return defaultValue;
}

/**
 * Convenience helper para el flag principal del feature.
 * @param {Record<string, unknown> | null | undefined} doc
 * @returns {boolean}
 */
export function isDep12RepartoEnabled(doc) {
  return readFlag(doc, 'dep12_reparto_enabled', false);
}

export const FEATURE_FLAG_DOC_PATH = 'app_config/feature_flags';
