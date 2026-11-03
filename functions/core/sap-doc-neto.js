// @ts-check
/**
 * v1550 (2026-11-03) — monto NETO sin IVA de un documento SAP (Oferta/Orden).
 *
 * "VA A SAP" en la app se muestra sin IVA (los precios de la app son netos).
 * SAP devuelve `DocTotal` CON IVA y `VatSum` = el IVA. El número comparable
 * con lo que el vendedor ve es `DocTotal - VatSum` (ya incluye el descuento
 * de cabecera). Caso SEBASTIAN ARIZAGA SQ 2000476: DocTotal 3.164.150 −
 * VatSum 549.150 = 2.615.000 = "Total Before Discount" de la Oferta.
 *
 * Si `VatSum` no viene (respuestas viejas o fixtures), se usa `DocTotal`.
 *
 * @param {{DocTotal?: unknown, VatSum?: unknown} | null | undefined} doc
 * @returns {number | null} neto redondeado a 2 decimales, o null si no hay DocTotal válido.
 */
export function sapDocNetoSinIva(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const total = Number(doc.DocTotal);
  if (!Number.isFinite(total) || total <= 0) return null;
  const vat = Number(doc.VatSum);
  const neto = Number.isFinite(vat) && vat > 0 && vat < total ? total - vat : total;
  return Math.round(neto * 100) / 100;
}
