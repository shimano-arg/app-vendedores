// @ts-check
/**
 * Dashboard de Ventas fase 2 (2026-10-29) — queries de gestión.
 *
 * Target, rendiciones, visitas/contactos y base activa de clientes.
 * Mismas reglas que `dashboard-ventas-queries.js`: valores del usuario solo
 * como parámetros, arrays con tipo STRING, fechas como STRING + DATE() en el SQL.
 * Cada query arranca con el marcador `-- dashboard:<nombre>`.
 *
 * Tarea 0: actividad e interacciones salen de `v_visitas_full` (card_code).
 */
import {
  arrayPredicate,
  filterParams,
  filterPredicate,
  shiftMonth,
  TZ_ART,
  VENTAS_BASE,
} from './dashboard-ventas-queries.js';

const DS = 'app-vendedores-shimano.shimano_app';
const T_VENTAS = `\`${DS}.v_ventas_lineas\``;
const T_TARGETS = `\`${DS}.v_targets\``;
const T_RENDICIONES = `\`${DS}.v_rendiciones\``;
const T_VISITAS = `\`${DS}.v_visitas_full\``;

/** Tope de filas de la tabla de interacciones (se devuelve también el total). */
export const MAX_INTERACCIONES = 500;
/** Días de la ventana de base activa (inclusive). */
const DIAS_BASE_ACTIVA = 90;

/**
 * Suma `dias` a una fecha AAAA-MM-DD (en UTC, sin horario de verano).
 * @param {string} ymd
 * @param {number} dias
 */
function addDays(ymd, dias) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
}

/**
 * Hoy (AAAA-MM-DD) en hora Argentina.
 * @param {number} nowMs
 */
function todayArt(nowMs) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_ART,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

/**
 * Último día del mes AAAA-MM.
 * @param {string} mes
 */
function lastDayOfMonth(mes) {
  return addDays(`${shiftMonth(mes, 1)}-01`, -1);
}

/**
 * Ventana de 90 días para la base activa: termina el último día del mes
 * elegido (o hoy ART si es el mes en curso) e incluye 90 días.
 * @param {string} mes AAAA-MM
 * @param {number} nowMs
 * @returns {{ desde: string, hasta: string }}
 */
export function ventanaBaseActiva(mes, nowMs) {
  const hoy = todayArt(nowMs);
  const fin = lastDayOfMonth(mes);
  // Mes cerrado: su último día. Mes en curso: hoy.
  const hasta = fin < hoy ? fin : hoy;
  return { desde: addDays(hasta, -(DIAS_BASE_ACTIVA - 1)), hasta };
}

/**
 * @param {import('./dashboard-ventas-queries.js').DashboardFilters} f
 * @param {number} [nowMs]
 * @returns {{ target: import('./dashboard-ventas-queries.js').BqQuery,
 *   rendiciones: import('./dashboard-ventas-queries.js').BqQuery,
 *   actividad: import('./dashboard-ventas-queries.js').BqQuery,
 *   interacciones: import('./dashboard-ventas-queries.js').BqQuery,
 *   baseActiva: import('./dashboard-ventas-queries.js').BqQuery }}
 */
export function buildGestionQueries(f, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const [anio, mesNum] = f.mes.split('-').map(Number);
  const desdeMes = `${f.mes}-01`;
  const hastaMes = lastDayOfMonth(f.mes);
  const fp = filterParams(f);

  // Solo vendedor (y cliente donde corresponde): se toman del set común de params.
  const vend = { vendedores: fp.params.vendedores };
  const vendT = { vendedores: fp.types.vendedores };
  const cli = { clientes: fp.params.clientes };
  const cliT = { clientes: fp.types.clientes };

  const target = {
    query: `-- dashboard:target
SELECT COALESCE(SUM(target_ars), 0) AS target_ars
FROM ${T_TARGETS}
WHERE anio = @anio AND mes = @mesNum
  AND ${arrayPredicate('vendedores', 'UPPER(TRIM(vendedor))')}`,
    params: { ...vend, anio, mesNum },
    types: { ...vendT, anio: 'INT64', mesNum: 'INT64' },
  };

  const rangoMes = { desde: desdeMes, hasta: hastaMes };
  const rangoMesT = { desde: 'STRING', hasta: 'STRING' };

  const rendiciones = {
    query: `-- dashboard:rendiciones
SELECT COALESCE(SUM(importe_ars), 0) AS monto_ars
FROM ${T_RENDICIONES}
WHERE fecha_gasto BETWEEN DATE(@desde) AND DATE(@hasta)
  AND NOT IFNULL(rechazada, FALSE)
  AND ${arrayPredicate('vendedores', 'UPPER(TRIM(vendor))')}`,
    params: { ...vend, ...rangoMes },
    types: { ...vendT, ...rangoMesT },
  };

  const visitasWhere = `fecha_visita BETWEEN DATE(@desde) AND DATE(@hasta)
  AND ${arrayPredicate('vendedores', 'UPPER(TRIM(vendedor))')}
  AND ${arrayPredicate('clientes', 'card_code')}`;
  const visitasParams = { ...vend, ...cli, ...rangoMes };
  const visitasTypes = { ...vendT, ...cliT, ...rangoMesT };

  const actividad = {
    query: `-- dashboard:actividad
SELECT
  COUNTIF(NOT IFNULL(es_contacto, FALSE)) AS visitas,
  COUNTIF(IFNULL(es_contacto, FALSE)) AS contactados
FROM ${T_VISITAS}
WHERE ${visitasWhere}`,
    params: { ...visitasParams },
    types: { ...visitasTypes },
  };

  const interacciones = {
    query: `-- dashboard:interacciones
SELECT
  COALESCE(card_name_sap, tienda) AS cliente,
  FORMAT_DATE('%Y-%m-%d', fecha_visita) AS fecha,
  vendedor,
  IF(IFNULL(es_contacto, FALSE), 'contacto', 'visita') AS tipo,
  COUNT(*) OVER () AS total
FROM ${T_VISITAS}
WHERE ${visitasWhere}
ORDER BY fecha_visita DESC, cliente, vendedor
LIMIT ${MAX_INTERACCIONES}`,
    params: { ...visitasParams },
    types: { ...visitasTypes },
  };

  // Base activa: clientes con factura en los 90 días previos al fin del mes.
  const ventana = ventanaBaseActiva(f.mes, now);
  const baseActiva = {
    query: `-- dashboard:baseActiva
SELECT COUNT(DISTINCT card_code) AS clientes
FROM ${T_VENTAS}
WHERE ${VENTAS_BASE}
  AND doc_kind = 'INVOICE'
  AND doc_date BETWEEN DATE(@desde) AND DATE(@hasta)
  AND ${filterPredicate()}`,
    params: { ...fp.params, desde: ventana.desde, hasta: ventana.hasta },
    types: { ...fp.types, desde: 'STRING', hasta: 'STRING' },
  };

  return { target, rendiciones, actividad, interacciones, baseActiva };
}
