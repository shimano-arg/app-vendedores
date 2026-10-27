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
 * Lee la fecha canónica de un pedido para el Planner Kanban. Prioridad:
 *   1. `pedido.createdAt` — fuente de verdad desde v1474 PR1 (string ISO).
 *   2. `pedido.updatedAt` — fallback para docs legacy sin createdAt.
 *   3. null si no parseable.
 *
 * Devuelve `Date | null`. Usado por: filtro de mes, sort de columnas,
 * render de fecha en cards. Garantiza que los 3 call-sites del Planner
 * usen la MISMA selección de campo + MISMO parser tolerante a Timestamp
 * y string ISO (CLAUDE.md §71).
 *
 * NO usar para la query Firestore server-side `where('createdAt', '>=', X)`:
 * para eso usar {@link plannerCutoffIsoForQuery} que devuelve string ISO
 * (Firestore trata un `Date` como Timestamp y por tipo nunca matchea los
 * campos string ISO post-backfill AD v1474 — bug prod 2026-10-27 v1478).
 *
 * @param {{createdAt?: any, updatedAt?: any} | null | undefined} pedido
 * @returns {Date | null}
 */
export function pedidoDateForPlanner(pedido) {
  if (!pedido) return null;
  const d = parseFirestoreDate(pedido.createdAt);
  if (d) return d;
  return parseFirestoreDate(pedido.updatedAt);
}

/**
 * Devuelve el string ISO del cutoff para la query Firestore
 * `where('createdAt', '>=', <cutoff>)` del listener de pedidos del Planner.
 *
 * Por qué string y NO `Date`: desde el backfill AD v1474 (CLAUDE.md §71),
 * todos los pedidos tienen `createdAt` como string ISO. Firestore compara
 * campos por TIPO primero: un `Date` se promueve a Timestamp y Timestamp
 * nunca matchea un string en `>=`. Pasar ISO string hace comparación
 * lexicográfica string vs string — que funciona porque ISO 8601 es
 * ordenable lexicográficamente.
 *
 * @param {number} nowMs — ahora en ms epoch (inyectable para tests).
 * @param {number} daysBack — cuantos días hacia atrás (ej. 90, 180).
 * @returns {string} ISO 8601, ej. "2026-07-29T11:49:20.189Z".
 */
export function plannerCutoffIsoForQuery(nowMs, daysBack) {
  const ms = Number(nowMs) || Date.now();
  const back = Number(daysBack) || 90;
  return new Date(ms - back * 86400000).toISOString();
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
