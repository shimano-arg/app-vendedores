// @ts-check
/**
 * §91 (v<X> 2026-11-20): resolucion y sanitizacion de descuentos comerciales.
 *
 * Fix D12-CRITICAL-01 + defensa contra ATK-004. Fuente unica de verdad para
 * el chequeo coherencia + clamp defensivo del descuento persistido.
 *
 * Consumer cliente: index.html payload builder (via window.__phase0.pure.discountValidator).
 * Consumer server: functions/core/commit-pedido-core.js buildPedidoDocData.
 *
 * Mirror server-only: functions/core/discount-validator.js (CLAUDE.md §57).
 * Sync test: tests/unit/audit/discount-validator-sync.test.js.
 *
 * Shape del snapshot (match src/pure/discount.js:calcClientDiscount):
 *   {pctFijo, pctVol, pctAntic, pctTotal, subtotal, monto, total, calculatedAt?}
 *
 * Decisiones:
 *   - clamp defensivo [0, 100] siempre (no confiamos en que el cliente ya lo
 *     haya hecho).
 *   - coherencia pctTotal vs discountPct: tolerancia 0.01 (float). Si divergen
 *     mas, throw con _errorCode='DISCOUNT_COHERENCE_MISMATCH' + detalle.
 *   - caps por rol NO implementados aun (dependen de D1 Santi comercial).
 *     TODO AUTH-F4: agregar check cap(role) cuando este definido.
 */

const DISCOUNT_TOLERANCE = 0.01;

/**
 * Parsea a numero finito. Devuelve 0 para null/undefined/NaN/Infinity/strings no-numericas.
 * @param {unknown} v
 * @returns {number}
 */
function toSafeNumber(v) {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/**
 * Clampea a [min, max].
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Sanitiza un snapshot de descuento aplicando clamp defensivo + shape canonico.
 *
 * Devuelve null si el input no es un objeto valido. Esto preserva el
 * comportamiento legacy "no persistir snapshot si no vino" sin romper.
 *
 * @param {unknown} snap
 * @returns {null | {pctFijo: number, pctVol: number, pctAntic: number, pctTotal: number, subtotal: number, monto: number, total: number, calculatedAt: string | null}}
 */
export function sanitizeDiscountSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return null;
  const s = /** @type {any} */ (snap);
  const pctFijo = clamp(toSafeNumber(s.pctFijo), 0, 100);
  const pctVol = clamp(toSafeNumber(s.pctVol), 0, 100);
  const pctAntic = clamp(toSafeNumber(s.pctAntic), 0, 100);
  const pctTotal = clamp(toSafeNumber(s.pctTotal), 0, 100);
  const subtotal = Math.max(0, toSafeNumber(s.subtotal));
  const monto = Math.max(0, toSafeNumber(s.monto));
  const total = Math.max(0, toSafeNumber(s.total));
  const calculatedAt = typeof s.calculatedAt === 'string' && s.calculatedAt ? s.calculatedAt : null;
  return { pctFijo, pctVol, pctAntic, pctTotal, subtotal, monto, total, calculatedAt };
}

/**
 * Resuelve y valida el descuento del payload.
 *
 * Reglas:
 *   1. Si ambos discountPct y discountSnapshot.pctTotal vienen, deben coincidir
 *      en [-0.01, +0.01]. Diferencias mayores = cliente armo cosas raras o
 *      intento de bypass -> throw DISCOUNT_COHERENCE_MISMATCH.
 *   2. Si solo uno viene, se usa ese.
 *   3. Si ninguno viene, devuelve 0 (comportamiento legacy pre-D12).
 *   4. Clamp defensivo [0, 100] siempre al final.
 *
 * NO lee limites por rol aun (TODO AUTH-F4).
 *
 * @param {unknown} payload
 * @returns {number}
 * @throws {{_errorCode: 'DISCOUNT_COHERENCE_MISMATCH', _data: {flatPct: number, snapshotPctTotal: number, delta: number}}}
 */
export function resolveAndValidateDiscount(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  const p = /** @type {any} */ (payload);
  const hasFlat = p.discountPct !== null && p.discountPct !== undefined;
  const snap = p.discountSnapshot;
  const hasSnap =
    snap && typeof snap === 'object' && snap.pctTotal !== null && snap.pctTotal !== undefined;

  const flatPct = hasFlat ? toSafeNumber(p.discountPct) : null;
  const snapPct = hasSnap ? toSafeNumber(snap.pctTotal) : null;

  if (flatPct !== null && snapPct !== null) {
    const delta = Math.abs(flatPct - snapPct);
    if (delta > DISCOUNT_TOLERANCE) {
      const err = /** @type {any} */ (
        new Error(
          'Descuento del pedido inconsistente: discountPct=' +
            flatPct +
            ' vs discountSnapshot.pctTotal=' +
            snapPct +
            ' (delta=' +
            delta.toFixed(4) +
            ', toleranciaMax=' +
            DISCOUNT_TOLERANCE +
            ')'
        )
      );
      err._errorCode = 'DISCOUNT_COHERENCE_MISMATCH';
      err._data = { flatPct, snapshotPctTotal: snapPct, delta };
      throw err;
    }
    return clamp(flatPct, 0, 100);
  }

  if (flatPct !== null) return clamp(flatPct, 0, 100);
  if (snapPct !== null) return clamp(snapPct, 0, 100);
  return 0;
}

/**
 * Helper utilitario: devuelve el descuento resuelto + el snapshot sanitizado
 * en una sola llamada. Usado por buildPedidoDocData para no duplicar logic.
 *
 * Si resolveAndValidateDiscount tira, la excepcion se propaga tal cual.
 *
 * @param {unknown} payload
 * @returns {{discountPct: number, discountSnapshot: ReturnType<typeof sanitizeDiscountSnapshot>}}
 */
export function resolveDiscountForPersist(payload) {
  const discountPct = resolveAndValidateDiscount(payload);
  const p = /** @type {any} */ (payload);
  const discountSnapshot =
    p && typeof p === 'object' ? sanitizeDiscountSnapshot(p.discountSnapshot) : null;
  return { discountPct, discountSnapshot };
}
