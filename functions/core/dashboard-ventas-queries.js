// @ts-check
/**
 * Dashboard de Ventas (2026-10-29) — armado de SQL + params para BigQuery.
 *
 * Separado de `dashboard-ventas-core.js` para que el core quede chico.
 * Todo valor que viene del usuario viaja como parámetro (`@x`), nunca
 * concatenado en el texto SQL. Los arrays vacíos necesitan tipo explícito
 * en BigQuery, por eso cada query devuelve también un mapa `types` que se
 * pasa tal cual a `bigquery.query({query, params, types})`.
 *
 * Ojo con los alias: v_ventas_lineas ya tiene columnas `anio`/`mes`
 * (fecha del documento), distintas de `anio_contable`/`mes_contable`. Los
 * GROUP BY usan columnas reales o posición, nunca un alias que choque.
 *
 * Cada query arranca con el marcador `-- dashboard:<nombre>` (sirve para
 * logs y para que los tests identifiquen la query).
 */

const DS = 'app-vendedores-shimano.shimano_app';
// Back order: tablas materializadas por el sync (scripts/sync_sap_to_bigquery.py
// sync_backorder_dashboard_tables). Las vistas tardan 1-2 min; el CF corta a 60 s.
const T_VENTAS = `\`${DS}.v_ventas_lineas\``;
const T_BO_VIVO = `\`${DS}.backorder_dashboard_actual\``;
const T_BO_SNAP = `\`${DS}.backorder_daily_snapshot\``;
const T_BO_RECON = `\`${DS}.backorder_reconstruido_mensual\``;

export const TZ_ART = 'America/Argentina/Buenos_Aires';

/** Meses de la serie de evolución (terminando en el mes elegido). */
export const SERIE_MESES = 12;
/** Ventana de meses para las opciones de los filtros. */
export const OPCIONES_MESES = 24;

/**
 * @typedef {{ mes: string, vendedores: string[], clientes: string[],
 *   provincias: string[], categorias: string[], skus: string[],
 *   scopeVendedores?: string[] }} DashboardFilters
 * `scopeVendedores`: alcance por rol, solo para las opciones de los filtros
 * ([vendor] para vendedor, [] para admin/gerente).
 * @typedef {{ query: string, params: Record<string, any>, types: Record<string, any> }} BqQuery
 */

/** Filtros multiselección: nombre del param → columna en las tablas. */
const FILTER_COLS = /** @type {const} */ ([
  ['vendedores', 'assigned_vendor'],
  ['clientes', 'card_code'],
  ['provincias', 'provincia_cliente'],
  ['categorias', 'familia'],
  ['skus', 'item_code'],
]);

/**
 * Mes en curso (AAAA-MM) en hora Argentina.
 * @param {number} nowMs
 * @returns {string}
 */
export function currentMonthArt(nowMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_ART,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(nowMs));
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  return `${y}-${m}`;
}

/**
 * Corre un mes AAAA-MM `delta` meses (negativo = hacia atrás).
 * @param {string} mes
 * @param {number} delta
 * @returns {string}
 */
export function shiftMonth(mes, delta) {
  const [y, m] = mes.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/**
 * Lista de `n` meses AAAA-MM que terminan en `mes` (orden ascendente).
 * @param {string} mes
 * @param {number} n
 * @returns {string[]}
 */
export function monthsEndingAt(mes, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(mes, -i));
  return out;
}

/**
 * Columna del filtro, normalizada si es la de vendedor: roles.vendor y
 * assigned_vendor se comparan en mayúsculas y sin espacios en los bordes
 * (los valores del param ya llegan así desde normalizeFilters/applyRoleScope).
 * @param {string} p nombre del param
 * @param {string} colRef columna con alias
 */
function colExpr(p, colRef) {
  return p === 'vendedores' ? `UPPER(TRIM(${colRef}))` : colRef;
}

/**
 * Predicado de un array param. Vacío (o NULL: BigQuery puede recibir un array
 * vacío como NULL y ARRAY_LENGTH(NULL) es NULL) = no filtra.
 * @param {string} param
 * @param {string} colSql
 */
function arrayPredicate(param, colSql) {
  return `(COALESCE(ARRAY_LENGTH(@${param}), 0) = 0 OR ${colSql} IN UNNEST(@${param}))`;
}

/**
 * Predicado de los filtros multiselección. Filtro vacío = no filtra.
 * @param {string} [alias] prefijo de tabla (ej. 's.'), vacío por default.
 * @param {ReadonlyArray<string>} [only] limitar a estos filtros.
 * @returns {string}
 */
function filterPredicate(alias, only) {
  const a = alias || '';
  return FILTER_COLS.filter(([p]) => !only || only.includes(p))
    .map(([p, col]) => arrayPredicate(p, colExpr(p, `${a}${col}`)))
    .join('\n    AND ');
}

/** @param {DashboardFilters} f */
function filterParams(f) {
  /** @type {Record<string, any>} */
  const params = {};
  /** @type {Record<string, any>} */
  const types = {};
  for (const [p] of FILTER_COLS) {
    params[p] = f[p].slice();
    types[p] = ['STRING'];
  }
  return { params, types };
}

const VENTAS_BASE = 'is_pesca = TRUE AND assigned_vendor IS NOT NULL';

/**
 * Arma las 5 queries del dashboard.
 * @param {DashboardFilters} f filtros ya normalizados y con scope de rol.
 * @param {number} [nowMs] para el mes en curso (default Date.now()).
 * @returns {{ kpis: BqQuery, topSkus: BqQuery, serieVentas: BqQuery,
 *   serieBackorder: BqQuery, opciones: BqQuery }}
 */
export function buildQueries(f, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const [anio, mesNum] = f.mes.split('-').map(Number);
  const mesActual = currentMonthArt(now);
  const desdeMes = shiftMonth(f.mes, -(SERIE_MESES - 1));
  const desde = `${desdeMes}-01`;
  const hasta = `${f.mes}-01`;
  const desdeOpciones = `${shiftMonth(mesActual, -(OPCIONES_MESES - 1))}-01`;
  const filt = filterPredicate();
  const fp = filterParams(f);

  const mesParams = { ...fp.params, anio, mesNum };
  const mesTypes = { ...fp.types, anio: 'INT64', mesNum: 'INT64' };

  const kpis = {
    query: `-- dashboard:kpis
WITH lineas AS (
  SELECT importe_linea_ars, doc_kind, doc_entry, card_code
  FROM ${T_VENTAS}
  WHERE ${VENTAS_BASE}
    AND anio_contable = @anio AND mes_contable = @mesNum
    AND ${filt}
)
SELECT
  (SELECT COALESCE(SUM(importe_linea_ars), 0) FROM lineas) AS facturado,
  (SELECT COUNT(DISTINCT doc_entry) FROM lineas WHERE doc_kind = 'INVOICE') AS pedidos,
  (SELECT COUNT(DISTINCT card_code) FROM lineas WHERE doc_kind = 'INVOICE') AS pedidos_unicos,
  (SELECT COALESCE(SUM(pendiente_ars), 0) FROM ${T_BO_VIVO}
    WHERE ${filt}) AS backorder_ars`,
    params: mesParams,
    types: mesTypes,
  };

  const topSkus = {
    query: `-- dashboard:topSkus
SELECT
  item_code AS sku,
  ANY_VALUE(COALESCE(item_name_catalogo, descripcion_linea)) AS descr,
  SUM(cantidad) AS uds,
  SUM(importe_linea_ars) AS ars
FROM ${T_VENTAS}
WHERE ${VENTAS_BASE}
  AND anio_contable = @anio AND mes_contable = @mesNum
  AND ${filt}
GROUP BY item_code`,
    params: { ...mesParams },
    types: { ...mesTypes },
  };

  const rangoParams = { ...fp.params, desde, hasta };
  const rangoTypes = { ...fp.types, desde: 'DATE', hasta: 'DATE' };

  const serieVentas = {
    query: `-- dashboard:serieVentas
SELECT anio_contable AS anio, mes_contable AS mes, SUM(importe_linea_ars) AS valor
FROM ${T_VENTAS}
WHERE ${VENTAS_BASE}
  AND DATE(anio_contable, mes_contable, 1) BETWEEN @desde AND @hasta
  AND ${filt}
GROUP BY anio_contable, mes_contable`,
    params: rangoParams,
    types: rangoTypes,
  };

  // Back order fin de mes. Tres fuentes, el core elige por mes:
  //   snapshot     = foto del último snapshot_date del mes (real).
  //   reconstruido = backorder_reconstruido_mensual (estimado; tabla diaria de la vista).
  //   vivo         = backorder_dashboard_actual (tabla del sync, ≤ 30 min de atraso).
  // El día/mes disponible se decide SIN filtros y los filtros van en el JOIN:
  // así un filtro que no matchea da 0 (hay foto) y no cae a la otra fuente.
  const serieBackorder = {
    query: `-- dashboard:serieBackorder
WITH dias AS (
  SELECT FORMAT_DATE('%Y-%m', snapshot_date) AS mes, MAX(snapshot_date) AS dia
  FROM ${T_BO_SNAP}
  WHERE snapshot_date BETWEEN @desde AND LAST_DAY(@hasta)
  GROUP BY 1
),
meses_recon AS (
  SELECT DISTINCT mes_fin
  FROM ${T_BO_RECON}
  WHERE mes_fin BETWEEN @desde AND LAST_DAY(@hasta)
)
SELECT 'snapshot' AS fuente, d.mes AS mes,
  COALESCE(SUM(s.pendiente_uds), 0) AS uds, COALESCE(SUM(s.pendiente_ars), 0) AS ars
FROM dias d
LEFT JOIN ${T_BO_SNAP} s
  ON s.snapshot_date = d.dia
  AND ${filterPredicate('s.')}
GROUP BY d.mes
UNION ALL
SELECT 'reconstruido' AS fuente, FORMAT_DATE('%Y-%m', m.mes_fin) AS mes,
  COALESCE(SUM(r.pendiente_uds), 0) AS uds, COALESCE(SUM(r.pendiente_ars), 0) AS ars
FROM meses_recon m
LEFT JOIN ${T_BO_RECON} r
  ON r.mes_fin = m.mes_fin
  AND ${filterPredicate('r.')}
GROUP BY 2
UNION ALL
SELECT 'vivo' AS fuente, @mesActual AS mes,
  COALESCE(SUM(pendiente_uds), 0) AS uds, COALESCE(SUM(pendiente_ars), 0) AS ars
FROM ${T_BO_VIVO}
WHERE ${filt}`,
    params: { ...rangoParams, mesActual },
    types: { ...rangoTypes, mesActual: 'STRING' },
  };

  // Opciones de los filtros: solo con el alcance del rol (un vendedor ve solo
  // sus clientes; admin/gerente ven todo aunque hayan aplicado Vendedor=A).
  // El resto de los filtros no recorta las opciones.
  const scopeVendedores = (f.scopeVendedores || []).slice();
  const opciones = {
    query: `-- dashboard:opciones
WITH base AS (
  SELECT UPPER(TRIM(assigned_vendor)) AS vendor, card_code, card_name, provincia_cliente, familia, item_code,
    COALESCE(item_name_catalogo, descripcion_linea) AS item_desc
  FROM ${T_VENTAS}
  WHERE ${VENTAS_BASE}
    AND DATE(anio_contable, mes_contable, 1) >= @desdeOpciones
    AND ${arrayPredicate('scopeVendedores', 'UPPER(TRIM(assigned_vendor))')}
)
SELECT 'vendedor' AS tipo, vendor AS code, CAST(NULL AS STRING) AS name
FROM base GROUP BY vendor
UNION ALL
SELECT 'cliente', card_code, ANY_VALUE(card_name) FROM base
WHERE card_code IS NOT NULL GROUP BY card_code
UNION ALL
SELECT 'provincia', provincia_cliente, CAST(NULL AS STRING) FROM base
WHERE provincia_cliente IS NOT NULL GROUP BY provincia_cliente
UNION ALL
SELECT 'categoria', familia, CAST(NULL AS STRING) FROM base
WHERE familia IS NOT NULL GROUP BY familia
UNION ALL
SELECT 'sku', item_code, ANY_VALUE(item_desc) FROM base
WHERE item_code IS NOT NULL GROUP BY item_code`,
    params: { scopeVendedores, desdeOpciones },
    types: { scopeVendedores: ['STRING'], desdeOpciones: 'DATE' },
  };

  return { kpis, topSkus, serieVentas, serieBackorder, opciones };
}
