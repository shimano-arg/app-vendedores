// @ts-check
/**
 * Dashboard de Ventas (2026-10-29) — core puro (CLAUDE.md §7).
 *
 * Toda la lógica del callable `dashboardVentasCF` vive acá con dependencias
 * inyectables; el wrapper en functions/index.js solo hace el plumbing
 * Firebase/BigQuery. El SQL se arma en `dashboard-ventas-queries.js`.
 *
 * Reglas:
 *   - admin/gerente: filtros tal cual.
 *   - vendedor: el servidor REEMPLAZA `vendedores` por el suyo (roles.vendor).
 *     Sin vendor cargado → permission-denied (nunca "ver todo").
 *   - otro rol → permission-denied.
 *   - Valores del usuario siempre como parámetros BigQuery.
 *   - Back order fin de mes: foto real (último snapshot_date del mes) →
 *     reconstrucción estimada (estimado:true, solo si mostrarEstimados) →
 *     null. Mes en curso sin foto: back order vivo.
 *   - Caché en memoria por (uid, filtros) 10 minutos.
 *
 * Errores: objetos Error con `.code` ('unauthenticated', 'permission-denied',
 * 'invalid-argument'), sin importar firebase-functions.
 */

import {
  buildQueries,
  currentMonthArt,
  monthsEndingAt,
  SERIE_MESES,
} from './dashboard-ventas-queries.js';

export { buildQueries } from './dashboard-ventas-queries.js';

/** @typedef {import('./dashboard-ventas-queries.js').DashboardFilters} DashboardFilters */
/** @typedef {import('./dashboard-ventas-queries.js').BqQuery} BqQuery */

/**
 * @typedef {{ sku: string, desc: string, uds: number, ars: number }} TopSku
 * @typedef {{ mes: string, valor: number }} PuntoVentas
 * @typedef {{ mes: string, valor: number|null, estimado: boolean }} PuntoBackorder
 * @typedef {{
 *   kpis: { facturado: number, backorderArs: number, pedidos: number, pedidosUnicos: number },
 *   topUnidades: TopSku[], topDinero: TopSku[],
 *   serieVentas: PuntoVentas[], serieBoUds: PuntoBackorder[], serieBoArs: PuntoBackorder[],
 *   opciones: { vendedores: string[], clientes: {code: string, name: string}[],
 *     provincias: string[], categorias: string[], skus: {code: string, desc: string}[] },
 *   dataUpdatedAt: string,
 * }} DashboardResponse
 * @typedef {{
 *   runQuery: (q: BqQuery, params?: Record<string, any>) => Promise<any[]>,
 *   getUserRole: (uid: string) => Promise<{ role?: string, vendor?: string }|null>,
 *   getConfig?: () => Promise<{ mostrarEstimados?: boolean }|null>,
 *   cache?: { get: (k: string) => any, set: (k: string, v: any) => any },
 *   now?: () => number,
 *   log?: Function,
 * }} DashboardDeps
 */

export const MAX_VALORES_FILTRO = 200;
export const CACHE_TTL_MS = 10 * 60 * 1000;

const ARRAY_KEYS = /** @type {const} */ ([
  'vendedores',
  'clientes',
  'provincias',
  'categorias',
  'skus',
]);

/** Error con código — compatible con HttpsError pero sin importarlo. */
function mkErr(/** @type {string} */ code, /** @type {string} */ message) {
  const e = /** @type {any} */ (new Error(message));
  e.code = code;
  e._errorCode = code;
  return e;
}

/** Número seguro desde lo que devuelve BigQuery (number, string, Big, BigQueryInt). */
function num(/** @type {any} */ v) {
  if (v === null || v === undefined) return 0;
  const n =
    typeof v === 'object' && typeof v.valueOf === 'function' ? Number(v.valueOf()) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normaliza los filtros crudos del cliente.
 * Arrays: strings trimmed, sin vacíos, sin duplicados, ordenados, máx 200 (si no, invalid-argument).
 * Mes: AAAA-MM con mes 01-12; si no es válido, mes en curso (hora Argentina).
 * @param {any} raw
 * @param {number} [nowMs]
 * @returns {DashboardFilters}
 */
export function normalizeFilters(raw, nowMs) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  let mes = typeof r.mes === 'string' ? r.mes.trim() : '';
  const okMes =
    /^\d{4}-\d{2}$/.test(mes) && Number(mes.slice(5)) >= 1 && Number(mes.slice(5)) <= 12;
  if (!okMes) mes = currentMonthArt(now);

  /** @type {any} */
  const out = { mes };
  for (const k of ARRAY_KEYS) {
    const src = Array.isArray(r[k]) ? r[k] : [];
    /** @type {string[]} */
    const vals = [];
    for (const v of src) {
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const s = String(v).trim();
      if (s && !vals.includes(s)) vals.push(s);
    }
    if (vals.length > MAX_VALORES_FILTRO) {
      throw mkErr('invalid-argument', `filtro ${k}: máximo ${MAX_VALORES_FILTRO} valores`);
    }
    // Orden estable: misma selección en otro orden = misma clave de caché.
    out[k] = vals.sort();
  }
  return out;
}

/**
 * Aplica el alcance por rol.
 * @param {DashboardFilters} filters
 * @param {{ role?: string, vendor?: string }|null} roleInfo
 * @returns {DashboardFilters}
 */
export function applyRoleScope(filters, roleInfo) {
  const role = String((roleInfo && roleInfo.role) || '').toLowerCase();
  if (role === 'admin' || role === 'gerente') return { ...filters };
  if (role === 'vendedor') {
    const vendor = String((roleInfo && roleInfo.vendor) || '').trim();
    if (!vendor) throw mkErr('permission-denied', 'vendedor sin vendor asignado en roles');
    return { ...filters, vendedores: [vendor] };
  }
  throw mkErr('permission-denied', 'rol sin acceso al Dashboard de Ventas');
}

/** Orden de los Top: mayor a menor; los ≤ 0 (más devuelto que facturado) quedan al final. */
function sortTop(/** @type {TopSku[]} */ list, /** @type {'uds'|'ars'} */ key) {
  return list.slice().sort((a, b) => b[key] - a[key] || a.sku.localeCompare(b.sku));
}

/**
 * @param {any[]} rows filas de serieBackorder ({fuente, mes, uds, ars}).
 * @param {string[]} meses
 * @param {string} mesActual
 * @param {boolean} mostrarEstimados
 * @returns {{ uds: PuntoBackorder[], ars: PuntoBackorder[] }}
 */
function buildSeriesBackorder(rows, meses, mesActual, mostrarEstimados) {
  /** @type {Record<string, Map<string, {uds: number, ars: number}>>} */
  const by = { snapshot: new Map(), reconstruido: new Map(), vivo: new Map() };
  for (const row of rows || []) {
    const m = by[String(row && row.fuente)];
    if (m && row.mes) m.set(String(row.mes), { uds: num(row.uds), ars: num(row.ars) });
  }
  /** @type {PuntoBackorder[]} */
  const uds = [];
  /** @type {PuntoBackorder[]} */
  const ars = [];
  for (const mes of meses) {
    let v = by.snapshot.get(mes);
    let estimado = false;
    if (!v && mes === mesActual) v = by.vivo.get(mes);
    if (!v && by.reconstruido.has(mes)) {
      estimado = true;
      v = mostrarEstimados ? by.reconstruido.get(mes) : undefined;
    }
    uds.push({ mes, valor: v ? v.uds : null, estimado });
    ars.push({ mes, valor: v ? v.ars : null, estimado });
  }
  return { uds, ars };
}

/** @param {any[]} rows */
function buildOpciones(rows) {
  const byName = (/** @type {string} */ a, /** @type {string} */ b) => a.localeCompare(b);
  /** @type {DashboardResponse['opciones']} */
  const o = { vendedores: [], clientes: [], provincias: [], categorias: [], skus: [] };
  for (const r of rows || []) {
    if (!r || r.code === null || r.code === undefined || r.code === '') continue;
    const code = String(r.code);
    const name = r.name === null || r.name === undefined ? '' : String(r.name);
    if (r.tipo === 'vendedor') o.vendedores.push(code);
    else if (r.tipo === 'cliente') o.clientes.push({ code, name: name || code });
    else if (r.tipo === 'provincia') o.provincias.push(code);
    else if (r.tipo === 'categoria') o.categorias.push(code);
    else if (r.tipo === 'sku') o.skus.push({ code, desc: name });
  }
  o.vendedores.sort(byName);
  o.provincias.sort(byName);
  o.categorias.sort(byName);
  o.clientes.sort((a, b) => byName(a.name, b.name) || byName(a.code, b.code));
  o.skus.sort((a, b) => byName(a.code, b.code));
  return o;
}

/**
 * @param {DashboardDeps} deps
 * @param {{ auth: any, data: any }} params
 * @returns {Promise<DashboardResponse>}
 */
export async function dashboardVentasCore(deps, params) {
  const nowFn = deps && typeof deps.now === 'function' ? deps.now : Date.now;
  const now = nowFn();
  const { auth, data } = params || {};
  if (!auth || !auth.uid) throw mkErr('unauthenticated', 'login requerido');

  const roleInfo = await deps.getUserRole(auth.uid);
  const filters = applyRoleScope(normalizeFilters(data, now), roleInfo);

  const cacheKey = `${auth.uid}|${JSON.stringify(filters)}`;
  const cached = deps.cache ? deps.cache.get(cacheKey) : null;
  // Copia: quien reciba la respuesta no puede corromper la caché.
  if (cached && now - cached.at < CACHE_TTL_MS) return structuredClone(cached.value);

  const qs = buildQueries(filters, now);
  const run = (/** @type {BqQuery} */ q) => deps.runQuery(q, q.params);
  const [kpiRows, topRows, ventasRows, boRows, opcRows, config] = await Promise.all([
    run(qs.kpis),
    run(qs.topSkus),
    run(qs.serieVentas),
    run(qs.serieBackorder),
    run(qs.opciones),
    typeof deps.getConfig === 'function' ? deps.getConfig() : Promise.resolve(null),
  ]);
  const mostrarEstimados = !!(config && config.mostrarEstimados === true);

  const k = (kpiRows && kpiRows[0]) || {};
  const kpis = {
    facturado: num(k.facturado),
    backorderArs: num(k.backorder_ars),
    pedidos: num(k.pedidos),
    pedidosUnicos: num(k.pedidos_unicos),
  };

  /** @type {TopSku[]} */
  const top = (topRows || [])
    .filter((r) => r && r.sku)
    .map((r) => ({
      sku: String(r.sku),
      desc: r.descr === null || r.descr === undefined ? '' : String(r.descr),
      uds: num(r.uds),
      ars: num(r.ars),
    }));

  const meses = monthsEndingAt(filters.mes, SERIE_MESES);
  /** @type {Map<string, number>} */
  const ventasPorMes = new Map();
  for (const r of ventasRows || []) {
    if (!r) continue;
    const mes = `${num(r.anio)}-${String(num(r.mes)).padStart(2, '0')}`;
    ventasPorMes.set(mes, num(r.valor));
  }
  const serieVentas = meses.map((mes) => ({ mes, valor: ventasPorMes.get(mes) || 0 }));

  const bo = buildSeriesBackorder(boRows, meses, currentMonthArt(now), mostrarEstimados);

  /** @type {DashboardResponse} */
  const value = {
    kpis,
    topUnidades: sortTop(top, 'uds'),
    topDinero: sortTop(top, 'ars'),
    serieVentas,
    serieBoUds: bo.uds,
    serieBoArs: bo.ars,
    opciones: buildOpciones(opcRows),
    dataUpdatedAt: new Date(now).toISOString(),
  };

  if (deps.cache) deps.cache.set(cacheKey, { at: now, value: structuredClone(value) });
  return value;
}
