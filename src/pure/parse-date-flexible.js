// @ts-check
/**
 * parse-date-flexible (v1474, 2026-10-26) — PR 1 cierre fecha definitivo.
 *
 * Problema: `confirmedAt`, `createdAt`, `transferredAt`, `cobradoAt`,
 * `invoicedAt` pueden estar persistidos en Firestore como:
 *   - string ISO (ej. "2026-10-26T21:13:44.030Z") — pedidos pre-v1457 y v1473+.
 *   - Firestore Timestamp (`{seconds, nanoseconds}`) — pedidos entre v1457
 *     y v1473 que escribieron FieldValue.serverTimestamp().
 *   - Date nativo — en algunos path del cliente.
 *   - number (ms epoch).
 *   - null/undefined.
 *
 * Call-sites de la UI hacen `new Date(x)` directo → "Invalid Date" para los
 * Timestamp. Reportado Federico ORDEN 530 SUSANA ANDRILI 2026-10-26.
 *
 * Fix definitivo: todos los call-sites usan `parseFirestoreDate(v)` o
 * `formatFirestoreDate(v, locale, opts)` desde este helper. Nunca más depende
 * del formato persistido.
 */

/**
 * Convierte un valor Firestore (Timestamp, Date, string ISO, number epoch,
 * null, undefined) a `Date` nativo. Si el valor no es parseable, devuelve `null`.
 *
 * @param {any} v
 * @returns {Date | null}
 */
export function parseFirestoreDate(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v;
  }
  // Firestore Timestamp (admin SDK: DatetimeWithNanoseconds; client SDK: Timestamp class).
  if (typeof v === 'object') {
    if (typeof v.toDate === 'function') {
      try {
        const d = v.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
      } catch (_e) {
        /* fall through */
      }
    }
    if (typeof v.seconds === 'number') {
      const ms =
        v.seconds * 1000 +
        (typeof v.nanoseconds === 'number' ? Math.floor(v.nanoseconds / 1e6) : 0);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // _seconds / _nanoseconds (REST API shape, Firestore v8 compat).
    if (typeof v._seconds === 'number') {
      const ms =
        v._seconds * 1000 +
        (typeof v._nanoseconds === 'number' ? Math.floor(v._nanoseconds / 1e6) : 0);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof v === 'string') {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Convierte un valor Firestore a ISO string (`"YYYY-MM-DDTHH:mm:ss.sssZ"`).
 * Si no parseable, devuelve `null`.
 *
 * Útil para persistir Timestamps viejos en el formato nuevo (backfill PR1 §71).
 *
 * @param {any} v
 * @returns {string | null}
 */
export function toIsoStringFlexible(v) {
  const d = parseFirestoreDate(v);
  return d ? d.toISOString() : null;
}

/**
 * Formatea un valor Firestore a string para UI. Default es-AR con fecha corta.
 *
 * Si el valor no es parseable, devuelve el fallback (default `'-'`).
 *
 * @param {any} v
 * @param {object} [opts]
 * @param {string} [opts.locale] default `'es-AR'`.
 * @param {'date'|'datetime'|'time'} [opts.style] default `'date'`.
 * @param {string} [opts.fallback] default `'-'`.
 * @returns {string}
 */
export function formatFirestoreDate(v, opts) {
  const d = parseFirestoreDate(v);
  const fallback = opts && opts.fallback !== undefined ? opts.fallback : '-';
  if (!d) return fallback;
  const locale = (opts && opts.locale) || 'es-AR';
  const style = (opts && opts.style) || 'date';
  try {
    if (style === 'datetime') return d.toLocaleString(locale);
    if (style === 'time') return d.toLocaleTimeString(locale);
    return d.toLocaleDateString(locale);
  } catch (_e) {
    return d.toISOString();
  }
}

/**
 * Detecta si un valor es un Firestore Timestamp (necesita conversión para
 * persistir como ISO). Usado por el backfill PR1 §71.
 *
 * @param {any} v
 * @returns {boolean}
 */
export function isFirestoreTimestamp(v) {
  if (!v || typeof v !== 'object') return false;
  if (v instanceof Date) return false;
  // Admin SDK Node (DatetimeWithNanoseconds), client SDK v8+ (Timestamp class),
  // o REST shape (_seconds/_nanoseconds).
  if (typeof v.toDate === 'function') return true;
  if (typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') return true;
  if (typeof v._seconds === 'number' && typeof v._nanoseconds === 'number') return true;
  return false;
}
