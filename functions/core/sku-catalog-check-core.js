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
 * Chequea que cada SKU exista en el catálogo SAP. Fuente de verdad:
 * `app_config/stock_snapshot.quantities` (JSON string `{sku: qty}` escrita por
 * `syncSapCatalogStockCF` cada 5 min — misma colección que ya refresca el sync).
 *
 * **Pre-v1480 §77/§79**: leía `sap_products/{sku}` (colección separada).
 * Problema: `sap_products` nunca se pobló en prod → 100% de confirmaciones
 * rechazadas 2026-10-26 21:00. §77 agregó fail-open. §79 migra la fuente
 * a `stock_snapshot.quantities` (misma colección que §72 pretendía auditar).
 *
 * **Fail-open (§77)**: si el doc no existe, `quantities` falta o la lectura
 * falla, devuelve `{ok:true, catalogEmpty:true}` y el core loguea
 * `catalog_check_skipped` en operations_log.
 *
 * Beneficio §79: 1 doc read por pedido (vs N reads antes). Siempre poblado.
 * No requiere escritura adicional del sync (reusa su output).
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
  // v1480 §79: fuente única `app_config/stock_snapshot.quantities`.
  let snapshotKeys = null;
  try {
    const snap = await deps.fbDb.doc('app_config/stock_snapshot').get();
    if (snap && snap.exists) {
      const data = snap.data() || {};
      // `quantities` es un JSON string (patrón sync Python → Node desde §65).
      const raw = data.quantities;
      let parsed = null;
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          parsed = JSON.parse(raw);
        } catch (_pe) {
          parsed = null;
        }
      } else if (raw && typeof raw === 'object') {
        parsed = raw;
      }
      if (parsed && typeof parsed === 'object') {
        snapshotKeys = new Set(Object.keys(parsed).map((k) => String(k).toUpperCase()));
      }
    }
  } catch (_e) {
    // Lectura fallida (permission, timeout) → fail-open §77 defensivo.
    snapshotKeys = null;
  }
  // Si no pudimos leer o el set está vacío → fail-open.
  if (!snapshotKeys || snapshotKeys.size === 0) {
    return {
      ok: true,
      missing: [],
      checked: uniqueSkus.length,
      catalogEmpty: true,
    };
  }
  // Chequeo in-memory contra el set del snapshot. 1 lookup O(1) por SKU.
  const missing = [];
  for (const sku of uniqueSkus) {
    if (!snapshotKeys.has(sku)) missing.push(sku);
  }
  return {
    ok: missing.length === 0,
    missing,
    checked: uniqueSkus.length,
  };
}
