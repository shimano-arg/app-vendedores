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
  monthsBetween,
  SERIE_DESDE,
} from './dashboard-ventas-queries.js';

import { buildCampaniasQuery } from './dashboard-ventas-queries-campanias.js';
import { buildGestionQueries } from './dashboard-ventas-queries-gestion.js';
import { buildProductosQueries } from './dashboard-ventas-queries-productos.js';

export { buildQueries } from './dashboard-ventas-queries.js';

/** @typedef {import('./dashboard-ventas-queries.js').DashboardFilters} DashboardFilters */
/** @typedef {import('./dashboard-ventas-queries.js').BqQuery} BqQuery */

/**
 * @typedef {{ sku: string, desc: string, uds: number, ars: number }} TopSku
 * @typedef {{ mes: string, valor: number }} PuntoVentas
 * @typedef {{ mes: string, valor: number|null, estimado: boolean }} PuntoBackorder
 * @typedef {{ cliente: string, fecha: string, vendedor: string, tipo: string }} FilaInteraccion
 * @typedef {{
 *   target: number|null, cumplimientoPct: number|null, rendicionesArs: number,
 *   baseActiva: number, ticketPromedio: number, visitas: number, contactados: number,
 *   interacciones: number,
 *   tablaInteracciones: { rows: FilaInteraccion[], total: number },
 *   filtrosNoAplican: boolean,
 * }} Gestion
 * @typedef {{ categoria: string, familia: string, sku: string, udsVendidas: number,
 *   facturado: number, udsBackorder: number }} FilaProducto
 * @typedef {{ vendedor: string, dadosAlta: number, compraron: number, pct: number|null }} FilaCobertura
 * @typedef {{ code: string, nombre: string, facturado: number }} FilaCliente
 * @typedef {{ id: string, nombre: string, desde: string, hasta: string,
 *   objetivoTipo: string, objetivo: number|null, uds: number, ars: number,
 *   pct: number|null }} FilaCampania
 * @typedef {{
 *   kpis: { facturado: number, backorderArs: number, pedidos: number, pedidosUnicos: number },
 *   topUnidades: TopSku[], topDinero: TopSku[],
 *   serieVentas: PuntoVentas[], serieBoUds: PuntoBackorder[], serieBoArs: PuntoBackorder[],
 *   opciones: { vendedores: string[], clientes: {code: string, name: string}[],
 *     provincias: string[], categorias: string[], skus: {code: string, desc: string}[] },
 *   gestion: Gestion|null,
 *   productos: FilaProducto[]|null,
 *   cobertura: FilaCobertura[]|null,
 *   clientes: FilaCliente[]|null,
 *   campanias: FilaCampania[]|null,
 *   secciones: { gestion?: { error: true }, productos?: { error: true },
 *     cobertura?: { error: true }, clientes?: { error: true },
 *     campanias?: { error: true } },
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
// Tope por sección opcional: la CF tiene 60 s y las 5 queries obligatorias no deben perderse.
export const SECCION_TIMEOUT_MS = 25000;

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
      let s = String(v).trim();
      // Vendedor en mayúsculas: igual que UPPER(TRIM(assigned_vendor)) en SQL.
      if (k === 'vendedores') s = s.toUpperCase();
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
  if (role === 'admin' || role === 'gerente') return { ...filters, scopeVendedores: [] };
  if (role === 'vendedor') {
    const vendor = String((roleInfo && roleInfo.vendor) || '')
      .trim()
      .toUpperCase();
    if (!vendor) throw mkErr('permission-denied', 'vendedor sin vendor asignado en roles');
    return { ...filters, vendedores: [vendor], scopeVendedores: [vendor] };
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
  const o = {
    vendedores: [],
    clientes: [],
    provincias: [],
    categorias: [],
    skus: [],
  };
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
 * Corre un grupo de queries de una sección. Si CUALQUIERA falla (o pasa el
 * timeout) devuelve { ok: false }: la sección se marca con error y el resto
 * del dashboard sigue. El motivo se registra en el log (Cloud Logging).
 * @param {(q: BqQuery) => Promise<any[]>} run
 * @param {Record<string, BqQuery>} queries
 * @param {{ timeoutMs?: number, log?: Function, nombre?: string }} [opts]
 * @returns {Promise<{ ok: true, rows: Record<string, any[]> } | { ok: false }>}
 */
export async function runSeccion(run, queries, opts) {
  const o = opts || {};
  const timeoutMs = typeof o.timeoutMs === 'number' ? o.timeoutMs : SECCION_TIMEOUT_MS;
  /** @type {any} */
  let timer = null;
  try {
    const names = Object.keys(queries);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout de ${timeoutMs} ms`)), timeoutMs);
    });
    const results = /** @type {any[]} */ (
      await Promise.race([Promise.all(names.map((n) => run(queries[n]))), timeout])
    );
    /** @type {Record<string, any[]>} */
    const rows = {};
    names.forEach((n, i) => {
      rows[n] = results[i] || [];
    });
    return { ok: true, rows };
  } catch (e) {
    if (typeof o.log === 'function') {
      const msg = e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e);
      o.log(`[dashboardVentas] seccion ${o.nombre || '?'} fallo: ${msg}`);
    }
    return { ok: false };
  } finally {
    // Sin timers colgados: el de la carrera se limpia siempre.
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {Record<string, any[]>} rows
 * @param {{ facturado: number, pedidos: number }} kpis
 * @param {DashboardFilters} filters
 * @returns {Gestion}
 */
function buildGestion(rows, kpis, filters) {
  const t = rows.target && rows.target[0] ? num(rows.target[0].target_ars) : 0;
  const target = t > 0 ? t : null;
  const cumplimientoPct =
    target === null ? null : Math.round((kpis.facturado / target) * 100 * 100) / 100;
  const act = (rows.actividad && rows.actividad[0]) || {};
  const visitas = num(act.visitas);
  const contactados = num(act.contactados);
  const inter = rows.interacciones || [];
  return {
    target,
    cumplimientoPct,
    rendicionesArs: num(rows.rendiciones && rows.rendiciones[0] && rows.rendiciones[0].monto_ars),
    baseActiva: num(rows.baseActiva && rows.baseActiva[0] && rows.baseActiva[0].clientes),
    ticketPromedio: kpis.pedidos > 0 ? kpis.facturado / kpis.pedidos : 0,
    visitas,
    contactados,
    interacciones: visitas + contactados,
    tablaInteracciones: {
      rows: inter.map((r) => ({
        cliente: r.cliente === null || r.cliente === undefined ? '' : String(r.cliente),
        fecha: r.fecha === null || r.fecha === undefined ? '' : String(r.fecha),
        vendedor: r.vendedor === null || r.vendedor === undefined ? '' : String(r.vendedor),
        tipo: r.tipo === null || r.tipo === undefined ? '' : String(r.tipo),
      })),
      total: inter.length ? num(inter[0].total) : 0,
    },
    // Target y rendiciones no se filtran por cliente/producto (la UI aclara el texto).
    filtrosNoAplican: ['clientes', 'skus', 'categorias', 'provincias'].some(
      (k) => /** @type {any} */ (filters)[k].length > 0
    ),
  };
}

/** Texto seguro desde una celda de BigQuery. */
function str(/** @type {any} */ v) {
  return String(v ?? '');
}

/** @param {any[]} rows */
function buildProductos(rows) {
  return (
    (rows || [])
      .map((r) => ({
        categoria: str(r.categoria),
        familia: str(r.familia),
        sku: str(r.sku),
        // SKU solo con back order: la query devuelve uds_vendidas/facturado nulos → 0.
        udsVendidas: num(r.uds_vendidas),
        facturado: num(r.facturado),
        udsBackorder: num(r.uds_backorder),
      }))
      // Orden estable (la UI corta en 200 filas): facturado desc, back order desc, sku.
      .sort(
        (a, b) =>
          b.facturado - a.facturado || b.udsBackorder - a.udsBackorder || a.sku.localeCompare(b.sku)
      )
  );
}

/** @param {any[]} rows */
function buildCobertura(rows) {
  return (rows || [])
    .map((r) => {
      const dadosAlta = num(r.dados_alta);
      const compraron = num(r.compraron);
      return {
        vendedor: str(r.vendedor),
        dadosAlta,
        compraron,
        pct: dadosAlta > 0 ? Math.round((compraron / dadosAlta) * 100 * 100) / 100 : null,
      };
    })
    .sort((a, b) => a.vendedor.localeCompare(b.vendedor));
}

/** @param {any[]} rows */
function buildClientes(rows) {
  // Se mantiene el orden del servidor (facturado desc).
  return (rows || []).map((r) => ({
    code: str(r.card_code),
    nombre: str(r.nombre),
    facturado: num(r.facturado),
  }));
}

/** @param {any[]} rows */
function buildCampanias(rows) {
  // Se mantiene el orden del servidor (fin de campaña asc, nombre).
  return (rows || []).map((r) => {
    const tipo = str(r.target_type);
    const objetivo =
      r.target_amount === null || r.target_amount === undefined ? null : num(r.target_amount);
    const uds = num(r.realizado_qty);
    const ars = num(r.realizado_ars);
    // units → unidades / objetivo, money → pesos / objetivo; objetivo 0 o vacío → sin %.
    const avance = tipo === 'money' ? ars : uds;
    return {
      id: str(r.campaign_id),
      nombre: str(r.nombre),
      desde: str(r.start_date),
      hasta: str(r.end_date),
      objetivoTipo: tipo,
      objetivo,
      uds,
      ars,
      pct: objetivo ? Math.round((avance / objetivo) * 100 * 100) / 100 : null,
    };
  });
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
  const secOpts = (/** @type {string} */ nombre) => ({ log: deps.log, nombre });
  const gestionP = runSeccion(run, buildGestionQueries(filters, now), secOpts('gestion'));
  // Cada sección corre aparte: si una falla, las demás siguen.
  const pq = buildProductosQueries(filters, now);
  const productosP = runSeccion(run, { productos: pq.productos }, secOpts('productos'));
  const coberturaP = runSeccion(run, { cobertura: pq.cobertura }, secOpts('cobertura'));
  const clientesP = runSeccion(run, { clientes: pq.clientes }, secOpts('clientes'));
  const campaniasP = runSeccion(
    run,
    { campanias: buildCampaniasQuery(filters, now) },
    secOpts('campanias')
  );
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

  const meses = monthsBetween(SERIE_DESDE, filters.mes);
  /** @type {Map<string, number>} */
  const ventasPorMes = new Map();
  for (const r of ventasRows || []) {
    if (!r) continue;
    const mes = `${num(r.anio)}-${String(num(r.mes)).padStart(2, '0')}`;
    ventasPorMes.set(mes, num(r.valor));
  }
  const serieVentas = meses.map((mes) => ({
    mes,
    valor: ventasPorMes.get(mes) || 0,
  }));

  const bo = buildSeriesBackorder(boRows, meses, currentMonthArt(now), mostrarEstimados);

  const [g, pr, co, cl, ca] = await Promise.all([
    gestionP,
    productosP,
    coberturaP,
    clientesP,
    campaniasP,
  ]);
  /** @type {DashboardResponse['secciones']} */
  const secciones = {};
  if (!g.ok) secciones.gestion = { error: true };
  if (!pr.ok) secciones.productos = { error: true };
  if (!co.ok) secciones.cobertura = { error: true };
  if (!cl.ok) secciones.clientes = { error: true };
  if (!ca.ok) secciones.campanias = { error: true };

  /** @type {DashboardResponse} */
  const value = {
    kpis,
    topUnidades: sortTop(top, 'uds'),
    topDinero: sortTop(top, 'ars'),
    serieVentas,
    serieBoUds: bo.uds,
    serieBoArs: bo.ars,
    opciones: buildOpciones(opcRows),
    gestion: g.ok ? buildGestion(g.rows, kpis, filters) : null,
    productos: pr.ok ? buildProductos(pr.rows.productos) : null,
    cobertura: co.ok ? buildCobertura(co.rows.cobertura) : null,
    clientes: cl.ok ? buildClientes(cl.rows.clientes) : null,
    campanias: ca.ok ? buildCampanias(ca.rows.campanias) : null,
    secciones,
    dataUpdatedAt: new Date(now).toISOString(),
  };

  // Una sección caída no se cachea: el próximo pedido la reintenta en vez de esperar 10 min.
  if (deps.cache && Object.keys(secciones).length === 0) {
    deps.cache.set(cacheKey, { at: now, value: structuredClone(value) });
  }
  return value;
}
