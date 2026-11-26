/**
 * Mirror server-side de src/pure/dual-write/compare-pedido-parity.js (§57).
 *
 * Mantener byte-equivalent con el pure (post header). El test de sincronia
 * `tests/unit/audit/dual-write-sync.test.js` falla si divergen.
 *
 * @module functions/core/dual-write/compare-pedido-parity
 *   - Debug ad-hoc cuando aparezca un reporte de divergencia.
 *
 * Reusa `transformPedidoToPg` como base: transforma Firestore → PG-shape y
 * compara contra el PG real. Si ambos lados son equivalentes, devuelve
 * `{ok: true, diff: []}`. Si no, devuelve diff con path + valor FS + valor PG
 * + severity.
 *
 * ESTE HELPER ES PURO — no lee ni escribe Firestore, PG, red, tiempo.
 * El audit nocturno hace los reads y pasa ambos lados ya resueltos.
 *
 * @module src/pure/dual-write/compare-pedido-parity
 */

import { transformPedidoToPg } from './transform-pedido-to-pg.js';

/**
 * @typedef {Object} ParityDiffEntry
 * @property {string} path - "pedido.order_number" o "lines[2].qty" etc.
 * @property {unknown} fsValue
 * @property {unknown} pgValue
 * @property {'critical'|'warning'|'info'} severity
 *   - critical: campo core de negocio diverge (qty, state, orderNumber, cardCode).
 *   - warning: campo secundario diverge (timestamps, notas, audit fields).
 *   - info: campo que puede divergir legitimamente (ej. updated_at nunca sincroniza exacto).
 */

/**
 * @typedef {Object} PgPedidoShape
 * @property {Record<string, any>} pedido
 * @property {Array<Record<string, any>>} lines
 * @property {Array<Record<string, any>>} reservations
 */

/**
 * Campos de cabecera "critical": una divergencia aqui es bug grave.
 * Documentada a proposito — expandir con cuidado y con test.
 */
export const PEDIDO_CRITICAL_FIELDS = Object.freeze([
  'id',
  'order_number',
  'client_card_code',
  'client_name',
  'assigned_vendor_uid',
  'owner_uid',
  'origen',
  'draft_id',
]);

/**
 * Campos de cabecera "warning": diferencias sospechosas pero no bloqueantes.
 */
export const PEDIDO_WARNING_FIELDS = Object.freeze([
  'assigned_vendor_key',
  'cargado_por_uid',
  'closed_at',
  'closed_reason',
  'closed_by',
  'first_invoiced_at',
  'cobrado_at',
]);

/**
 * Campos de linea "critical".
 */
export const LINE_CRITICAL_FIELDS = Object.freeze([
  'sku',
  'state',
  'qty',
  'qty_open',
  'qty_cancelled',
]);

/**
 * Campos de linea "warning".
 */
export const LINE_WARNING_FIELDS = Object.freeze([
  'price_ars',
  'discount_percent',
  'en_transito',
  'asig_at',
  'confirmed_at',
  'cancelled_at',
  'asig_revertida_reason',
  'split_from_line_index',
]);

/**
 * Tolerancia default de timestamp — Firestore puede tener ms distinta a PG
 * por el roundtrip ISO ↔ Timestamp; 1 segundo es normal.
 */
export const TIMESTAMP_TOLERANCE_MS = 1000;

/**
 * Compara dos valores escalares. Devuelve true si son equivalentes.
 * Strings con trim. Numeros con Number() y === . Booleans ===. null/undefined
 * son equivalentes entre si (ambos "no data").
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function scalarEquals(a, b) {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  // Numeric string vs number (ej. '5' vs 5).
  if (typeof a === 'string' && typeof b === 'number') {
    const n = Number(a);
    if (!Number.isNaN(n)) return n === b;
  }
  if (typeof a === 'number' && typeof b === 'string') {
    const n = Number(b);
    if (!Number.isNaN(n)) return n === a;
  }
  return false;
}

/**
 * Compara dos timestamps ISO (o null) con tolerancia de 1s.
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function timestampEquals(a, b) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return Math.abs(ta - tb) <= TIMESTAMP_TOLERANCE_MS;
}

/**
 * Compara dos objetos JSONB shallow (keys + scalar values). Usado para
 * `transferido_sap`.
 *
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 * @returns {boolean}
 */
export function jsonbEquals(a, b) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!scalarEquals(/** @type {any} */ (a)[ka[i]], /** @type {any} */ (b)[kb[i]])) return false;
  }
  return true;
}

/**
 * Determina si un campo es timestamp por nombre.
 *
 * @param {string} field
 * @returns {boolean}
 */
function isTimestampField(field) {
  return (
    field === 'created_at' ||
    field === 'updated_at' ||
    field === 'first_invoiced_at' ||
    field === 'cobrado_at' ||
    field === 'closed_at' ||
    field === 'asig_at' ||
    field === 'confirmed_at' ||
    field === 'cancelled_at' ||
    field === 'asig_at_transito' ||
    field === 'en_dep11_at' ||
    field === 'asig_revertida_at'
  );
}

/**
 * Compara la cabecera del pedido. Produce diffs per-field.
 *
 * @param {Record<string, any>} fsPedido - shape PG-equivalente del Firestore (ya transformado).
 * @param {Record<string, any>} pgPedido - row PG real.
 * @returns {ParityDiffEntry[]}
 */
export function comparePedidoHeader(fsPedido, pgPedido) {
  /** @type {ParityDiffEntry[]} */
  const diffs = [];
  const allFields = new Set([...PEDIDO_CRITICAL_FIELDS, ...PEDIDO_WARNING_FIELDS]);

  for (const field of allFields) {
    const fsValue = fsPedido ? fsPedido[field] : undefined;
    const pgValue = pgPedido ? pgPedido[field] : undefined;
    let equal;
    if (isTimestampField(field)) {
      equal = timestampEquals(fsValue, pgValue);
    } else {
      equal = scalarEquals(fsValue, pgValue);
    }
    if (!equal) {
      diffs.push({
        path: 'pedido.' + field,
        fsValue: fsValue === undefined ? null : fsValue,
        pgValue: pgValue === undefined ? null : pgValue,
        severity: /** @type {'critical'|'warning'} */ (
          PEDIDO_CRITICAL_FIELDS.includes(field) ? 'critical' : 'warning'
        ),
      });
    }
  }

  // JSONB shape: transferido_sap.
  if (
    !jsonbEquals(
      fsPedido ? fsPedido.transferido_sap : null,
      pgPedido ? pgPedido.transferido_sap : null
    )
  ) {
    diffs.push({
      path: 'pedido.transferido_sap',
      fsValue: fsPedido ? fsPedido.transferido_sap : null,
      pgValue: pgPedido ? pgPedido.transferido_sap : null,
      severity: 'critical',
    });
  }

  return diffs;
}

/**
 * Compara las lineas por `line_index`. Detecta:
 *   - Linea en FS que no esta en PG (extra en FS).
 *   - Linea en PG que no esta en FS (extra en PG).
 *   - Linea con campos divergentes.
 *
 * @param {Array<Record<string, any>>} fsLines
 * @param {Array<Record<string, any>>} pgLines
 * @returns {ParityDiffEntry[]}
 */
export function compareLines(fsLines, pgLines) {
  /** @type {ParityDiffEntry[]} */
  const diffs = [];
  const fsById = new Map();
  const pgById = new Map();

  for (const l of fsLines || []) {
    fsById.set(Number(l.line_index), l);
  }
  for (const l of pgLines || []) {
    pgById.set(Number(l.line_index), l);
  }

  const allIndexes = new Set([...fsById.keys(), ...pgById.keys()]);
  const sortedIndexes = [...allIndexes].sort((a, b) => a - b);

  for (const idx of sortedIndexes) {
    const fsLine = fsById.get(idx);
    const pgLine = pgById.get(idx);
    if (!fsLine && pgLine) {
      diffs.push({
        path: 'lines[' + idx + ']',
        fsValue: null,
        pgValue: 'exists',
        severity: 'critical',
      });
      continue;
    }
    if (fsLine && !pgLine) {
      diffs.push({
        path: 'lines[' + idx + ']',
        fsValue: 'exists',
        pgValue: null,
        severity: 'critical',
      });
      continue;
    }
    // Ambos existen: comparar campos.
    const allFields = new Set([...LINE_CRITICAL_FIELDS, ...LINE_WARNING_FIELDS]);
    for (const field of allFields) {
      const fsValue = fsLine[field];
      const pgValue = pgLine[field];
      let equal;
      if (isTimestampField(field)) {
        equal = timestampEquals(fsValue, pgValue);
      } else {
        equal = scalarEquals(fsValue, pgValue);
      }
      if (!equal) {
        diffs.push({
          path: 'lines[' + idx + '].' + field,
          fsValue: fsValue === undefined ? null : fsValue,
          pgValue: pgValue === undefined ? null : pgValue,
          severity: /** @type {'critical'|'warning'} */ (
            LINE_CRITICAL_FIELDS.includes(field) ? 'critical' : 'warning'
          ),
        });
      }
    }
  }

  return diffs;
}

/**
 * Compara las reservations. Clave composite (pedido_id, line_index).
 *
 * @param {Array<Record<string, any>>} fsReservations
 * @param {Array<Record<string, any>>} pgReservations
 * @returns {ParityDiffEntry[]}
 */
export function compareReservations(fsReservations, pgReservations) {
  /** @type {ParityDiffEntry[]} */
  const diffs = [];
  const fsByKey = new Map();
  const pgByKey = new Map();

  for (const r of fsReservations || []) {
    fsByKey.set(r.pedido_id + '|' + r.line_index, r);
  }
  for (const r of pgReservations || []) {
    pgByKey.set(r.pedido_id + '|' + r.line_index, r);
  }

  const allKeys = new Set([...fsByKey.keys(), ...pgByKey.keys()]);
  for (const key of allKeys) {
    const fsR = fsByKey.get(key);
    const pgR = pgByKey.get(key);
    if (!fsR && pgR) {
      diffs.push({
        path: 'reservations[' + key + ']',
        fsValue: null,
        pgValue: 'exists',
        severity: 'critical',
      });
      continue;
    }
    if (fsR && !pgR) {
      diffs.push({
        path: 'reservations[' + key + ']',
        fsValue: 'exists',
        pgValue: null,
        severity: 'critical',
      });
      continue;
    }
    // Ambos existen: comparar qty, sku, warehouse, state.
    if (!scalarEquals(fsR.qty, pgR.qty)) {
      diffs.push({
        path: 'reservations[' + key + '].qty',
        fsValue: fsR.qty,
        pgValue: pgR.qty,
        severity: 'critical',
      });
    }
    if (!scalarEquals(fsR.sku, pgR.sku)) {
      diffs.push({
        path: 'reservations[' + key + '].sku',
        fsValue: fsR.sku,
        pgValue: pgR.sku,
        severity: 'critical',
      });
    }
    if (!scalarEquals(fsR.warehouse, pgR.warehouse)) {
      diffs.push({
        path: 'reservations[' + key + '].warehouse',
        fsValue: fsR.warehouse,
        pgValue: pgR.warehouse,
        severity: 'critical',
      });
    }
    if (!scalarEquals(fsR.state, pgR.state)) {
      diffs.push({
        path: 'reservations[' + key + '].state',
        fsValue: fsR.state,
        pgValue: pgR.state,
        severity: 'critical',
      });
    }
  }

  return diffs;
}

/**
 * Compara un documento Firestore `pedidos/{id}` contra el shape PG equivalente.
 *
 * @param {Record<string, any>} firestoreDoc - documento Firestore crudo.
 * @param {PgPedidoShape | null} pgShape - rows PG (si null, PG no tiene el doc).
 * @returns {{ok: boolean, diff: ParityDiffEntry[]}}
 */
export function comparePedidoParity(firestoreDoc, pgShape) {
  /** @type {ParityDiffEntry[]} */
  const diff = [];

  if (!firestoreDoc && !pgShape) {
    return { ok: true, diff: [] };
  }

  if (!firestoreDoc) {
    diff.push({
      path: 'pedido',
      fsValue: null,
      pgValue: 'exists',
      severity: 'critical',
    });
    return { ok: false, diff };
  }

  // PG shape vacio = ADR-008 paso 1 "shadow write" aun no ocurrió → critical.
  if (!pgShape || !pgShape.pedido) {
    diff.push({
      path: 'pedido',
      fsValue: 'exists',
      pgValue: null,
      severity: 'critical',
    });
    return { ok: false, diff };
  }

  // Transformar FS al shape PG-equivalente + comparar.
  let fsTransformed;
  try {
    fsTransformed = transformPedidoToPg(firestoreDoc);
  } catch (e) {
    diff.push({
      path: 'pedido',
      fsValue: 'transform_failed:' + (e && e.message ? e.message : 'unknown'),
      pgValue: 'exists',
      severity: 'critical',
    });
    return { ok: false, diff };
  }

  diff.push(...comparePedidoHeader(fsTransformed.pedido, pgShape.pedido));
  diff.push(...compareLines(fsTransformed.lines, pgShape.lines || []));
  diff.push(...compareReservations(fsTransformed.reservations, pgShape.reservations || []));

  // ok = sin diffs critical (warnings se reportan pero no bloquean).
  const hasCritical = diff.some((d) => d.severity === 'critical');
  return { ok: !hasCritical, diff };
}

export const PARITY_VERSION = 1;
