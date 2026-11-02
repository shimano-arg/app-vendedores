// @ts-check
/**
 * Pedidos del mes (v1540, 2026-11-02, APP-06) — core puro (CLAUDE.md §7).
 *
 * Facturación efectivamente emitida por cliente y SKU en un mes. La lógica
 * vive acá con dependencias inyectables; el wrapper `pedidosDelMesCF` en
 * functions/index.js solo hace el plumbing Firebase/BigQuery.
 *
 * Fuente de verdad: BigQuery `v_ventas_lineas` (facturas + notas de crédito
 * de SAP, sincronizadas cada ~30 min por scripts/sync_sap_to_bigquery.py).
 * Informe: docs/auditoria/49_PEDIDOS_DEL_MES.md.
 *
 * Criterios (decisiones de Mariano 2026-11-02, iguales al Dashboard de Ventas):
 *   - Solo documentos no anulados (la vista filtra cancelled = 'tNO').
 *   - Importe por línea NETO del descuento de cabecera (importe_linea_ars) y
 *     sin IVA. Notas de crédito restan (cantidad e importe con signo -1).
 *   - Mes = mes contable (anio_contable/mes_contable): la NC resta en el mes
 *     de la factura original; una NC sin factura base queda en su propio mes.
 *   - Solo productos de pesca (is_pesca = TRUE).
 *   - Vendedor = assigned_vendor (vendedor asignado al cliente en la app).
 *
 * Alcance por rol (lo decide el servidor, nunca el navegador):
 *   - admin / gerente: todo el país.
 *   - vendedor: solo clientes con assigned_vendor = roles/{uid}.vendor.
 *     Sin vendor cargado → permission-denied.
 *   - otro rol → permission-denied.
 *
 * Errores: objetos Error con `.code` ('unauthenticated', 'permission-denied',
 * 'invalid-argument'), sin importar firebase-functions.
 */

const DS = 'app-vendedores-shimano.shimano_app';
const T_VENTAS = `\`${DS}.v_ventas_lineas\``;
const T_ALTAS = `\`${DS}.client_applications_raw_raw_latest\``;
const TZ_ART = 'America/Argentina/Buenos_Aires';

export const CACHE_TTL_MS = 10 * 60 * 1000;
export const ANIO_MIN = 2020;

/** @typedef {{ query: string, params: Record<string, any>, types: Record<string, any> }} BqQuery */

/**
 * @typedef {{ tipo: 'FACTURA'|'NOTA_CREDITO', numero: string, fecha: string, uds: number, ars: number }} FacturaSku
 * @typedef {{ sku: string, desc: string, uds: number, ars: number, precio: number|null, facturas: FacturaSku[] }} SkuFacturado
 * @typedef {{ cardCode: string, nombre: string, localidad: string, provincia: string,
 *   vendedor: string, skus: SkuFacturado[], totalUds: number, totalArs: number,
 *   skuCount: number, facturasCount: number, notasCreditoCount: number }} ClienteFacturado
 * @typedef {{
 *   periodo: { anio: number, mes: number },
 *   alcance: { nacional: boolean, vendedor: string|null },
 *   kpis: { clientes: number, skus: number, uds: number, ars: number, facturas: number },
 *   clientes: ClienteFacturado[],
 *   generadoAt: string,
 * }} PedidosDelMesResponse
 * @typedef {{
 *   runQuery: (q: BqQuery) => Promise<any[]>,
 *   getUserRole: (uid: string) => Promise<{ role?: string, vendor?: string }|null>,
 *   cache?: { get: (k: string) => any, set: (k: string, v: any) => any },
 *   now?: () => number,
 *   log?: (msg: string, extra?: any) => void,
 * }} PedidosDelMesDeps
 */

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

/** Texto seguro (BigQuery DATE puede venir como {value}). */
function txt(/** @type {any} */ v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v && 'value' in v) return String(v.value);
  return String(v).trim();
}

/** Redondeo a 2 decimales (evita 0.30000000000000004 en sumas). */
function r2(/** @type {number} */ n) {
  return Math.round(n * 100) / 100;
}

/**
 * Año y mes actuales en hora Argentina.
 * @param {number} nowMs
 * @returns {{ anio: number, mes: number }}
 */
export function mesActualArt(nowMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_ART,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(nowMs));
  return {
    anio: Number(parts.find((p) => p.type === 'year')?.value || 1970),
    mes: Number(parts.find((p) => p.type === 'month')?.value || 1),
  };
}

/**
 * Valida el período pedido. Sin datos → mes actual (ART). No acepta meses
 * futuros ni anteriores a ANIO_MIN.
 * @param {any} data
 * @param {number} nowMs
 * @returns {{ anio: number, mes: number }}
 */
export function normalizePeriodo(data, nowMs) {
  const actual = mesActualArt(nowMs);
  const d = data || {};
  if (d.anio === undefined && d.mes === undefined) return actual;
  const anio = Number(d.anio);
  const mes = Number(d.mes);
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw mkErr('invalid-argument', 'período inválido');
  }
  if (anio < ANIO_MIN || anio * 12 + mes > actual.anio * 12 + actual.mes) {
    throw mkErr('invalid-argument', 'período fuera de rango');
  }
  return { anio, mes };
}

/**
 * Alcance por rol. Devuelve el vendedor forzado (vendedor) o null (nacional).
 * @param {{ role?: string, vendor?: string }|null} roleInfo
 * @returns {{ nacional: boolean, vendedor: string|null }}
 */
export function resolveAlcance(roleInfo) {
  const role = String((roleInfo && roleInfo.role) || '').toLowerCase();
  if (role === 'admin' || role === 'gerente') return { nacional: true, vendedor: null };
  if (role === 'vendedor') {
    const vendor = String((roleInfo && roleInfo.vendor) || '')
      .trim()
      .toUpperCase();
    if (!vendor) throw mkErr('permission-denied', 'vendedor sin vendor asignado en roles');
    return { nacional: false, vendedor: vendor };
  }
  throw mkErr('permission-denied', 'rol sin acceso a Pedidos del mes');
}

/**
 * Query única: líneas del mes agrupadas por cliente + SKU + documento, con la
 * localidad del alta del cliente. Valores del usuario solo como parámetros.
 * @param {{ anio: number, mes: number }} periodo
 * @param {{ nacional: boolean, vendedor: string|null }} alcance
 * @returns {BqQuery}
 */
export function buildPedidosDelMesQuery(periodo, alcance) {
  const vendedores = alcance.vendedor ? [alcance.vendedor] : [];
  return {
    query: `-- pedidosDelMes:lineas
WITH loc AS (
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ANY_VALUE(COALESCE(
      NULLIF(TRIM(JSON_VALUE(data, '$.localidadFinal')), ''),
      NULLIF(TRIM(JSON_VALUE(data, '$.localidad')), '')
    )) AS localidad
  FROM ${T_ALTAS}
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
  GROUP BY 1
)
SELECT
  v.card_code,
  ANY_VALUE(v.card_name) AS card_name,
  ANY_VALUE(UPPER(TRIM(v.assigned_vendor))) AS vendedor,
  ANY_VALUE(v.provincia_cliente) AS provincia,
  ANY_VALUE(loc.localidad) AS localidad,
  v.item_code AS sku,
  ANY_VALUE(COALESCE(v.item_name_catalogo, v.descripcion_linea)) AS descr,
  v.doc_kind,
  v.doc_entry,
  ANY_VALUE(v.doc_num) AS doc_num,
  ANY_VALUE(CAST(v.doc_date AS STRING)) AS fecha,
  SUM(v.cantidad) AS uds,
  SUM(v.importe_linea_ars) AS ars
FROM ${T_VENTAS} v
LEFT JOIN loc ON loc.card_code = v.card_code
WHERE v.is_pesca = TRUE
  AND v.assigned_vendor IS NOT NULL
  AND v.anio_contable = @anio AND v.mes_contable = @mesNum
  AND (COALESCE(ARRAY_LENGTH(@vendedores), 0) = 0 OR UPPER(TRIM(v.assigned_vendor)) IN UNNEST(@vendedores))
GROUP BY v.card_code, v.item_code, v.doc_kind, v.doc_entry`,
    params: { anio: periodo.anio, mesNum: periodo.mes, vendedores },
    types: { anio: 'INT64', mesNum: 'INT64', vendedores: ['STRING'] },
  };
}

/**
 * Arma la respuesta desde las filas (cliente, SKU, documento). Puro.
 * - Una fila por (cliente, SKU, doc_kind, doc_entry): cada línea de
 *   factura/NC se cuenta una sola vez.
 * - SKU: uds/ars = suma neta (NC con signo negativo); precio = ars / uds.
 * - Clientes y SKU ordenados por importe descendente.
 * @param {any[]} rows
 * @returns {{ clientes: ClienteFacturado[], kpis: PedidosDelMesResponse['kpis'] }}
 */
export function agruparFacturacion(rows) {
  /** @type {Map<string, any>} */
  const porCliente = new Map();
  const skusGlobal = new Set();
  const facturasGlobal = new Set();
  for (const r of rows || []) {
    if (!r) continue;
    const cc = txt(r.card_code);
    const sku = txt(r.sku);
    if (!cc || !sku) continue;
    let c = porCliente.get(cc);
    if (!c) {
      c = {
        cardCode: cc,
        nombre: txt(r.card_name) || cc,
        localidad: txt(r.localidad),
        provincia: txt(r.provincia),
        vendedor: txt(r.vendedor),
        skusMap: new Map(),
        facturas: new Set(),
        notas: new Set(),
      };
      porCliente.set(cc, c);
    }
    let s = c.skusMap.get(sku);
    if (!s) {
      s = { sku, desc: txt(r.descr), uds: 0, ars: 0, facturas: [] };
      c.skusMap.set(sku, s);
    }
    const esNc = txt(r.doc_kind) === 'CREDIT_NOTE';
    const uds = num(r.uds);
    const ars = num(r.ars);
    s.uds += uds;
    s.ars += ars;
    s.facturas.push({
      tipo: esNc ? 'NOTA_CREDITO' : 'FACTURA',
      numero: txt(r.doc_num) || txt(r.doc_entry),
      fecha: txt(r.fecha).slice(0, 10),
      uds: r2(uds),
      ars: r2(ars),
    });
    const docKey = txt(r.doc_kind) + ':' + txt(r.doc_entry);
    if (esNc) c.notas.add(docKey);
    else {
      c.facturas.add(docKey);
      facturasGlobal.add(docKey);
    }
    skusGlobal.add(sku);
  }
  /** @type {ClienteFacturado[]} */
  const clientes = [];
  let totUds = 0;
  let totArs = 0;
  for (const c of porCliente.values()) {
    /** @type {SkuFacturado[]} */
    const skus = [...c.skusMap.values()].map((s) => {
      const uds = r2(s.uds);
      const ars = r2(s.ars);
      s.facturas.sort(
        (/** @type {FacturaSku} */ a, /** @type {FacturaSku} */ b) =>
          a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero)
      );
      return {
        sku: s.sku,
        desc: s.desc,
        uds,
        ars,
        precio: uds !== 0 ? r2(ars / uds) : null,
        facturas: s.facturas,
      };
    });
    skus.sort((a, b) => b.ars - a.ars || a.sku.localeCompare(b.sku));
    const totalUds = r2(skus.reduce((a, s) => a + s.uds, 0));
    const totalArs = r2(skus.reduce((a, s) => a + s.ars, 0));
    totUds += totalUds;
    totArs += totalArs;
    clientes.push({
      cardCode: c.cardCode,
      nombre: c.nombre,
      localidad: c.localidad,
      provincia: c.provincia,
      vendedor: c.vendedor,
      skus,
      totalUds,
      totalArs,
      skuCount: skus.length,
      facturasCount: c.facturas.size,
      notasCreditoCount: c.notas.size,
    });
  }
  clientes.sort((a, b) => b.totalArs - a.totalArs || a.nombre.localeCompare(b.nombre));
  return {
    clientes,
    kpis: {
      clientes: clientes.length,
      skus: skusGlobal.size,
      uds: r2(totUds),
      ars: r2(totArs),
      facturas: facturasGlobal.size,
    },
  };
}

/**
 * @param {PedidosDelMesDeps} deps
 * @param {{ auth: any, data: any }} params
 * @returns {Promise<PedidosDelMesResponse>}
 */
export async function pedidosDelMesCore(deps, params) {
  const nowFn = deps && typeof deps.now === 'function' ? deps.now : Date.now;
  const now = nowFn();
  const { auth, data } = params || {};
  if (!auth || !auth.uid) throw mkErr('unauthenticated', 'login requerido');

  const alcance = resolveAlcance(await deps.getUserRole(auth.uid));
  const periodo = normalizePeriodo(data, now);

  // La clave usa el alcance (no el uid): dos admins comparten la misma vista.
  const cacheKey = `${alcance.vendedor || '*'}|${periodo.anio}-${periodo.mes}`;
  const cached = deps.cache ? deps.cache.get(cacheKey) : null;
  if (cached && now - cached.at < CACHE_TTL_MS) return structuredClone(cached.value);

  const rows = await deps.runQuery(buildPedidosDelMesQuery(periodo, alcance));
  const { clientes, kpis } = agruparFacturacion(rows);
  /** @type {PedidosDelMesResponse} */
  const value = {
    periodo,
    alcance,
    kpis,
    clientes,
    generadoAt: new Date(now).toISOString(),
  };
  if (deps.cache) deps.cache.set(cacheKey, { at: now, value: structuredClone(value) });
  if (deps.log)
    deps.log('pedidosDelMes ok', {
      uid: auth.uid,
      vendedor: alcance.vendedor,
      periodo,
      clientes: kpis.clientes,
    });
  return value;
}
