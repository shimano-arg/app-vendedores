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
 * **Fail-open (v1480 2026-10-27 HOTFIX §77)**: si la colección `sap_products`
 * está vacía/inexistente, se devuelve `ok=true` + `catalogEmpty=true` para
 * NO bloquear confirmaciones. Precedente: 2026-10-26 21:00 — `sap_products`
 * tenía 0 docs en prod (nadie la poblaba; §72 asumió que `syncSapCatalogStockCF`
 * la escribía pero sólo escribe `app_config/stock_snapshot`). Resultado: 100%
 * de confirmaciones rechazadas con SKU_NOT_IN_SAP_CATALOG. Fix: detectar
 * catálogo vacío y pasar; el core loguea `catalog_check_skipped` en
 * operations_log para auditoría.
 *
 * El chequeo `.limit(1)` sólo se ejecuta cuando `missing.length === uniqueSkus.length`
 * (caso sospechoso de catálogo vacío) → cero costo extra en el happy path.
 *
 * @param {Array<string>} skus Lista de SKUs (uppercase recomendado; se normaliza).
 * @param {{fbDb: any}} deps
 * @returns {Promise<{ok: boolean, missing: Array<string>, checked: number, catalogEmpty?: boolean}>}
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
  // Fail-open §77: si TODOS los SKUs del pedido faltan, probar si la colección
  // está vacía (señal de que el catálogo no está siendo poblado). Lectura lazy
  // de 1 doc — cero costo en el happy path (missing != uniqueSkus).
  if (missing.length === uniqueSkus.length && uniqueSkus.length > 0) {
    try {
      const probe = await deps.fbDb.collection('sap_products').limit(1).get();
      const isEmpty = probe && (probe.empty === true || probe.size === 0);
      if (isEmpty) {
        return {
          ok: true,
          missing: [],
          checked: uniqueSkus.length,
          catalogEmpty: true,
        };
      }
    } catch (_e) {
      // Si la probe falla (permission, timeout, collection no existe en el
      // emulator), tratarlo como "vacío" y pasar. Mejor dejar pasar un pedido
      // de más que bloquear 100% la producción como pasó el 2026-10-26 21:00.
      return {
        ok: true,
        missing: [],
        checked: uniqueSkus.length,
        catalogEmpty: true,
      };
    }
  }
  return {
    ok: missing.length === 0,
    missing,
    checked: uniqueSkus.length,
  };
}
