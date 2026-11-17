/**
 * Mirror server-side de src/pure/feature-flags.js (§57).
 *
 * Mantener byte-equivalent con el pure (post header).
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
