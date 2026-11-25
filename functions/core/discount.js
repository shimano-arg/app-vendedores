// @ts-check
/**
 * MIRROR (§57) de src/pure/discount.js — Cálculo de descuentos comerciales
 * por categoría de cliente + volumen + forma de pago.
 *
 * STACK S-4 T5 (v??? D12 fix, 2026-11-25): server-side recompute del
 * descuento comercial. El cliente ya calcula con la misma fórmula (pure
 * src/pure/discount.js); el server es la autoridad.
 *
 * NUNCA edites este archivo sin replicar el cambio en src/pure/discount.js.
 * El sync test (tests/unit/audit/discount-sync.test.js) te pilla si divergen.
 *
 * Reglas de negocio (idem pure):
 *   FIJO:   P=6% / A=3% / B,C=0%
 *   VOLUMEN (subtotal ARS):
 *     hasta $3M: 0% / $3M-$4.5M: 2% / $4.5M-$10M: 3% /
 *     $10M-$20M: 4% / más de $20M: 6%
 *   ANTIC (solo CONTADO):  P=5% / A=3% / B,C=0%
 */

/** @type {Record<string, number>} */
const FIJO_PCT = { P: 6, A: 3, B: 0, C: 0 };
/** @type {Record<string, number>} */
const ANTIC_PCT = { P: 5, A: 3, B: 0, C: 0 };

/**
 * @typedef {'P'|'A'|'B'|'C'|''|null} ClientTipo
 * @typedef {{ cliTipo?: ClientTipo }} ClientData
 * @typedef {{
 *   tipo: string,
 *   vol: string,
 *   formaPago: string,
 *   subtotal: number,
 *   pctFijo: number,
 *   pctVol: number,
 *   pctAntic: number,
 *   pctTotal: number,
 *   monto: number,
 *   total: number,
 *   hasAny: boolean
 * }} DiscountResult
 */

/**
 * @param {ClientData | null | undefined} clientData
 * @param {number} subtotal Subtotal en ARS (antes de descuento).
 * @param {string | null | undefined} formaPago 'CONTADO' | 'CTA CTE' | otro.
 * @returns {DiscountResult}
 */
export function calcClientDiscount(clientData, subtotal, formaPago) {
  const tipo = (clientData && clientData.cliTipo) || '';
  let pctVol = 0;
  let volLabel = '';
  if (subtotal > 20000000) {
    pctVol = 6;
    volLabel = 'mas de $20M';
  } else if (subtotal > 10000000) {
    pctVol = 4;
    volLabel = '$10M-$20M';
  } else if (subtotal > 4500000) {
    pctVol = 3;
    volLabel = '$4.5M-$10M';
  } else if (subtotal > 3000000) {
    pctVol = 2;
    volLabel = '$3M-$4.5M';
  } else {
    pctVol = 0;
    volLabel = 'hasta $3M';
  }

  const pctFijo = FIJO_PCT[tipo] || 0;
  const pctAntic = formaPago === 'CONTADO' ? ANTIC_PCT[tipo] || 0 : 0;
  const pctTotal = pctFijo + pctVol + pctAntic;
  const monto = (subtotal * pctTotal) / 100;
  return {
    tipo,
    vol: volLabel,
    formaPago: formaPago || '',
    subtotal,
    pctFijo,
    pctVol,
    pctAntic,
    pctTotal,
    monto,
    total: subtotal - monto,
    hasAny: !!(tipo || formaPago || pctVol > 0),
  };
}

export { ANTIC_PCT, FIJO_PCT };
