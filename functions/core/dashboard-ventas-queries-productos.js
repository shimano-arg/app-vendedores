// @ts-check
/**
 * Dashboard de Ventas fase 2 (2026-10-29) — queries de productos, cobertura y clientes.
 *
 * Mismas reglas que `dashboard-ventas-queries.js`: valores del usuario solo
 * como parámetros, arrays con tipo STRING, fechas como STRING + DATE() en el SQL.
 * Cada query arranca con el marcador `-- dashboard:<nombre>`.
 */
import {
  arrayPredicate,
  filterParams,
  filterPredicate,
  T_BO_VIVO,
  VENTAS_BASE,
} from './dashboard-ventas-queries.js';

const DS = 'app-vendedores-shimano.shimano_app';
const T_VENTAS = `\`${DS}.v_ventas_lineas\``;
const T_ITEMS = `\`${DS}.v_sap_items_enriched\``;
const T_CARTERA = `\`${DS}.v_cartera_vendor\``;

/** Inicio fijo de la medición de cobertura de clientes. */
export const COBERTURA_DESDE = '2026-06-01';

/**
 * @param {import('./dashboard-ventas-queries.js').DashboardFilters} f
 * @param {number} [_nowMs]
 * @returns {{ productos: import('./dashboard-ventas-queries.js').BqQuery,
 *   cobertura: import('./dashboard-ventas-queries.js').BqQuery,
 *   clientes: import('./dashboard-ventas-queries.js').BqQuery }}
 */
export function buildProductosQueries(f, _nowMs) {
  const [anio, mesNum] = f.mes.split('-').map(Number);
  const fp = filterParams(f);
  const filt = filterPredicate();
  const mesParams = { ...fp.params, anio, mesNum };
  const mesTypes = { ...fp.types, anio: 'INT64', mesNum: 'INT64' };

  // Ventas del mes y back order vivo por SKU, con los mismos filtros en ambos
  // lados. El back order no trae subfamilia: se completa con el catálogo.
  const productos = {
    query: `-- dashboard:productos
WITH ventas AS (
  SELECT item_code,
    ANY_VALUE(familia) AS familia,
    ANY_VALUE(subfamilia) AS subfamilia,
    SUM(cantidad) AS uds_vendidas,
    SUM(importe_linea_ars) AS facturado
  FROM ${T_VENTAS}
  WHERE ${VENTAS_BASE}
    AND anio_contable = @anio AND mes_contable = @mesNum
    AND ${filt}
  GROUP BY item_code
),
bo AS (
  SELECT item_code,
    ANY_VALUE(familia) AS familia,
    SUM(pendiente_uds) AS uds_backorder
  FROM ${T_BO_VIVO}
  WHERE ${filt}
  GROUP BY item_code
)
SELECT
  COALESCE(v.item_code, b.item_code) AS sku,
  COALESCE(v.familia, b.familia, i.familia_norm) AS categoria,
  COALESCE(v.subfamilia, i.subfamilia_norm) AS familia,
  COALESCE(v.uds_vendidas, 0) AS uds_vendidas,
  COALESCE(v.facturado, 0) AS facturado,
  COALESCE(b.uds_backorder, 0) AS uds_backorder
FROM ventas v
FULL OUTER JOIN bo b ON b.item_code = v.item_code
LEFT JOIN ${T_ITEMS} i ON i.item_code = COALESCE(v.item_code, b.item_code)
ORDER BY facturado DESC, uds_backorder DESC, sku`,
    params: mesParams,
    types: mesTypes,
  };

  // Cobertura: solo filtra por vendedor. Dados de alta = clientes de la cartera
  // (sin leads); compraron = los que tienen factura entre el inicio fijo y el
  // fin del mes elegido.
  const cobertura = {
    query: `-- dashboard:cobertura
WITH compras AS (
  SELECT DISTINCT card_code
  FROM ${T_VENTAS}
  WHERE ${VENTAS_BASE}
    AND doc_kind = 'INVOICE'
    AND card_code IS NOT NULL
    AND doc_date BETWEEN DATE(@coberturaDesde) AND LAST_DAY(DATE(@hasta))
),
cartera AS (
  SELECT DISTINCT UPPER(TRIM(vendor_key)) AS vendedor, card_code
  FROM ${T_CARTERA}
  WHERE card_code IS NOT NULL
    AND ${arrayPredicate('vendedores', 'UPPER(TRIM(vendor_key))')}
)
SELECT c.vendedor AS vendedor,
  COUNT(DISTINCT c.card_code) AS dados_alta,
  COUNT(DISTINCT p.card_code) AS compraron
FROM cartera c
LEFT JOIN compras p ON p.card_code = c.card_code
GROUP BY c.vendedor`,
    params: {
      vendedores: fp.params.vendedores,
      coberturaDesde: COBERTURA_DESDE,
      hasta: `${f.mes}-01`,
    },
    types: { vendedores: fp.types.vendedores, coberturaDesde: 'STRING', hasta: 'STRING' },
  };

  const clientes = {
    query: `-- dashboard:clientes
SELECT card_code,
  ANY_VALUE(card_name) AS nombre,
  SUM(importe_linea_ars) AS facturado
FROM ${T_VENTAS}
WHERE ${VENTAS_BASE}
  AND anio_contable = @anio AND mes_contable = @mesNum
  AND card_code IS NOT NULL
  AND ${filt}
GROUP BY card_code
ORDER BY facturado DESC`,
    params: { ...mesParams },
    types: { ...mesTypes },
  };

  return { productos, cobertura, clientes };
}
