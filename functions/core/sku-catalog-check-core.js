// @ts-check
/**
 * sku-catalog-check-core (v1475, 2026-10-26) — PR 2 §72.
 *
 * Chequea que cada SKU del pedido exista en el catálogo SAP (`sap_products/{sku}`).
 * Si alguno falta → el VDE no debería poder confirmarlo porque SAP no lo acepta.
 * Reportado ORDEN 530 SUSANA ANDRILI (EXGTVC66M4AR no estaba en sap_products).
 *
 * Fuente de verdad: `sap_products/{sku}.exists` es escrito por el sync cada
 * 5 min via `syncSapCatalogStockCF`. Si el doc NO existe, SAP no reconoce
 * ese ItemCode y el envío a SAP falla con `sap_item_not_found`.
 *
 * CAPA (b) de la defensa en profundidad del PR 2:
 *   - CAPA (a): UI de carga bloquea SKUs sin doc (prevención temprana).
 *   - CAPA (b): commitPedidoCore (acá) rechaza pre-tx si llega alguno sin doc.
 *   - CAPA (c): auto-send-sap-core degrada línea individual si llega por race
 *     entre sync y envío (fallback última instancia).
 *
 * Resultado: nunca más un pedido entero bloqueado por 1 SKU inexistente en SAP.
 */

/**
 * Lee los docs `sap_products/{sku}` para una lista de SKUs y reporta los
 * missing. Lectura paralela, un .get() por SKU. Para pedidos típicos (≤30 SKUs)
 * es < 500ms.
 *
 * @param {Array<string>} skus Lista de SKUs (uppercase recomendado; se normaliza).
 * @param {{fbDb: any}} deps
 * @returns {Promise<{ok: boolean, missing: Array<string>, checked: number}>}
 */
export async function checkSkusInSapCatalog(skus, deps) {
  if (!deps || !deps.fbDb) {
    throw new Error('checkSkusInSapCatalog: deps.fbDb requerido');
  }
  const uniqueSkus = Array.from(
    new Set(
      (Array.isArray(skus) ? skus : [])
        .map((s) =>
          String(s || '')
            .toUpperCase()
            .trim()
        )
        .filter(Boolean)
    )
  );
  if (uniqueSkus.length === 0) {
    return { ok: true, missing: [], checked: 0 };
  }
  const snaps = await Promise.all(
    uniqueSkus.map((sku) => deps.fbDb.collection('sap_products').doc(sku).get())
  );
  const missing = [];
  for (let i = 0; i < uniqueSkus.length; i++) {
    if (!snaps[i].exists) missing.push(uniqueSkus[i]);
  }
  return {
    ok: missing.length === 0,
    missing,
    checked: uniqueSkus.length,
  };
}
