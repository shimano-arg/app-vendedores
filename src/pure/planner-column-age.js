// @ts-check
/**
 * planner-column-age (2026-10-02).
 *
 * Pure helpers para computar y formatear la "edad" de un pedido en su
 * columna actual del Planner Kanban. Usado por el renderPlannerCard del
 * inline (index.html) para mostrar un badge compacto tipo "📅 2/10 · 3d".
 *
 * Timestamps por columna (fuente de verdad por columna, luego fallback):
 *   - lista_espera → pedido.createdAt
 *   - oferta       → pedido.transferidoSAP.transferredAt
 *   - ordenes      → pedido.transferidoSAP.orderSyncedAt
 *   - facturar     → pedido.firstInvoicedAt
 *   - cobrado      → pedido.cobradoAt (o paidAt como alias legacy)
 *
 * Para pedidos viejos que no tienen el timestamp específico (los campos
 * firstInvoicedAt / cobradoAt se agregan en Pack #5A), hacemos fallback
 * progresivo al timestamp más reciente DISPONIBLE que corresponda a una
 * columna igual o anterior a la actual.
 *
 * El módulo es intencionalmente auto-contenido: duplica el helper
 * `toMillisSafe` en vez de importarlo de stock-realmente-disponible.js
 * para no acoplarse a esa fn.
 */

import { computeColumn } from '../domains/planner/compute-column.js';

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 12 * MONTH_MS;

/**
 * Normaliza un valor a timestamp ms. Acepta:
 *   - null/undefined → null
 *   - number → tal cual
 *   - Date → .getTime()
 *   - Firestore Timestamp (toMillis()) → .toMillis()
 *   - plain {seconds, nanoseconds?} → seconds*1000 + nanoseconds/1e6
 *   - string ISO → Date.parse (null si NaN)
 *   - cualquier otro → null
 *
 * Copia inline del helper equivalente en stock-realmente-disponible.js
 * (ver nota 2026-10-02 ahí) para mantener este módulo auto-contenido.
 *
 * @param {any} value
 * @returns {number|null}
 */
function toMillisSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') {
      try {
        const t = value.toMillis();
        return typeof t === 'number' && Number.isFinite(t) ? t : null;
      } catch (_e) {
        return null;
      }
    }
    if (typeof value.seconds === 'number') {
      const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
      return value.seconds * 1000 + nanos / 1e6;
    }
    return null;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Cadenas de fallback por columna. Cada entrada lista los paths "en orden
 * de preferencia". El primer path cuyo valor normaliza a un ms válido gana.
 *
 * Para `cobrado` y `facturar` los primeros son los campos "nuevos" (Pack #5A)
 * y los siguientes caen a los timestamps anteriores del pipeline — así los
 * pedidos viejos que nunca tuvieron `cobradoAt`/`firstInvoicedAt` igual
 * muestran una edad razonable (la última señal temporal que hubo).
 *
 * @type {Record<string, Array<(p:any)=>any>>}
 */
const COLUMN_FALLBACK = {
  cobrado: [
    (p) => p && p.cobradoAt,
    (p) => p && p.paidAt,
    (p) => p && p.firstInvoicedAt,
    (p) => p && p.transferidoSAP && p.transferidoSAP.orderSyncedAt,
    (p) => p && p.transferidoSAP && p.transferidoSAP.transferredAt,
    (p) => p && p.createdAt,
  ],
  facturar: [
    (p) => p && p.firstInvoicedAt,
    (p) => p && p.transferidoSAP && p.transferidoSAP.orderSyncedAt,
    (p) => p && p.transferidoSAP && p.transferidoSAP.transferredAt,
    (p) => p && p.createdAt,
  ],
  ordenes: [
    (p) => p && p.transferidoSAP && p.transferidoSAP.orderSyncedAt,
    (p) => p && p.transferidoSAP && p.transferidoSAP.transferredAt,
    (p) => p && p.createdAt,
  ],
  oferta: [(p) => p && p.transferidoSAP && p.transferidoSAP.transferredAt, (p) => p && p.createdAt],
  lista_espera: [(p) => p && p.createdAt],
};

/**
 * Devuelve el timestamp (ms) en que el pedido entró a su columna actual.
 * Si `column` no se pasa, se calcula con computeColumn(pedido).
 * Fallback progresivo si el timestamp específico no existe (pedidos viejos).
 *
 * @param {any} pedido
 * @param {string} [column] - 'lista_espera' | 'oferta' | 'ordenes' | 'facturar' | 'cobrado'
 * @returns {number|null} ms epoch, o null si no se puede determinar.
 */
export function columnEnteredAt(pedido, column) {
  if (!pedido) return null;
  const col = column || computeColumn(pedido);
  const chain = COLUMN_FALLBACK[col] || COLUMN_FALLBACK.lista_espera;
  for (const picker of chain) {
    let raw;
    try {
      raw = picker(pedido);
    } catch (_e) {
      raw = null;
    }
    const ms = toMillisSafe(raw);
    if (ms !== null) return ms;
  }
  return null;
}

/**
 * Formatea una edad (ms epoch del evento) en una string compacta en español.
 *
 * Reglas:
 *   < 1 min  → "ahora"
 *   < 1 h    → "Nm"
 *   < 1 d    → "Nh" (si h >= 10) o "Nh Nm" (si h < 10 y hay minutos)
 *   < 30 d   → "Nd" (si d >= 10) o "Nd Nh" (si d < 10 y h >= 1)
 *   < 12 meses → "N mes" / "N meses"
 *   >= 12 meses → "N año" / "N años"
 *
 * @param {number} ms timestamp epoch del evento
 * @param {number} [nowMs] - inyectable para tests, default Date.now()
 * @returns {string}
 */
export function formatAge(ms, nowMs) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const delta = Math.max(0, now - ms);

  if (delta < MIN_MS) return 'ahora';

  if (delta < HOUR_MS) {
    const m = Math.floor(delta / MIN_MS);
    return m + 'm';
  }

  if (delta < DAY_MS) {
    const h = Math.floor(delta / HOUR_MS);
    const m = Math.floor((delta - h * HOUR_MS) / MIN_MS);
    if (h >= 10 || m === 0) return h + 'h';
    return h + 'h ' + m + 'm';
  }

  if (delta < MONTH_MS) {
    const d = Math.floor(delta / DAY_MS);
    const h = Math.floor((delta - d * DAY_MS) / HOUR_MS);
    if (d >= 10 || h === 0) return d + 'd';
    return d + 'd ' + h + 'h';
  }

  if (delta < YEAR_MS) {
    const months = Math.floor(delta / MONTH_MS);
    return months + (months === 1 ? ' mes' : ' meses');
  }

  const years = Math.floor(delta / YEAR_MS);
  return years + (years === 1 ? ' año' : ' años');
}

/**
 * Orden canónico del pipeline Planner Kanban. El breakdown por card itera
 * en este orden y encadena enteredAt/exitedAt entre etapas presentes.
 *
 * Mantener en sync con PLANNER_COLUMNS en index.html (sin 'confirmado'
 * desde v1037). computeColumn del dominio Planner también lo respeta.
 *
 * @type {ReadonlyArray<'lista_espera'|'oferta'|'ordenes'|'facturar'|'cobrado'>}
 */
const PLANNER_COLUMN_ORDER = ['lista_espera', 'oferta', 'ordenes', 'facturar', 'cobrado'];

/**
 * Pickers específicos (sin fallback). Al contrario de COLUMN_FALLBACK, acá
 * queremos saber SI y SOLO SI cada columna tiene su timestamp propio
 * registrado — así el breakdown muestra solo las etapas que el pedido tocó
 * realmente, sin interpolar.
 *
 * `cobrado` usa cobradoAt O paidAt como alias legacy (ambos son "el campo
 * dedicado del cobro", igual que en COLUMN_FALLBACK).
 *
 * @type {Record<string, (p:any)=>any>}
 */
const COLUMN_SPECIFIC_PICKER = {
  lista_espera: (p) => p && p.createdAt,
  oferta: (p) => p && p.transferidoSAP && p.transferidoSAP.transferredAt,
  ordenes: (p) => p && p.transferidoSAP && p.transferidoSAP.orderSyncedAt,
  facturar: (p) => p && p.firstInvoicedAt,
  cobrado: (p) => p && (p.cobradoAt || p.paidAt),
};

/**
 * @typedef {Object} ColumnBreakdownEntry
 * @property {'lista_espera'|'oferta'|'ordenes'|'facturar'|'cobrado'} column
 * @property {number} enteredAt - ms epoch en que el pedido entró a esta etapa
 * @property {number|null} exitedAt - ms epoch en que salió, null si es la actual
 * @property {number} durationMs - cuánto tiempo pasó en esta etapa
 */

/**
 * Devuelve el breakdown de tiempo que pasó este pedido en cada columna,
 * en orden secuencial (lista_espera → oferta → ordenes → facturar → cobrado).
 *
 * - Cada etapa tiene {column, enteredAt, exitedAt, durationMs}.
 * - La columna actual (= última etapa de la lista) tiene exitedAt=null y
 *   durationMs = nowMs - enteredAt.
 * - Las columnas que NUNCA alcanzó se omiten (sin interpolar).
 * - Las columnas con timestamp específico ausente se omiten también —
 *   usamos los pickers SIN fallback para no inventar transiciones.
 * - El exitedAt de cada etapa = enteredAt de la siguiente etapa presente.
 *
 * @param {any} pedido
 * @param {number} [nowMs=Date.now()]
 * @returns {Array<ColumnBreakdownEntry>}
 */
export function columnBreakdown(pedido, nowMs) {
  if (!pedido) return [];

  // Resolver enteredAt real para cada columna del orden canónico.
  // Mantener solo las que tienen timestamp válido.
  /** @type {Array<{column: string, enteredAt: number}>} */
  const presentStages = [];
  for (const col of PLANNER_COLUMN_ORDER) {
    const picker = COLUMN_SPECIFIC_PICKER[col];
    if (!picker) continue;
    let raw;
    try {
      raw = picker(pedido);
    } catch (_e) {
      raw = null;
    }
    const ms = toMillisSafe(raw);
    if (ms !== null) presentStages.push({ column: col, enteredAt: ms });
  }

  if (presentStages.length === 0) return [];

  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();

  /** @type {Array<ColumnBreakdownEntry>} */
  const result = [];
  for (let i = 0; i < presentStages.length; i++) {
    const stage = presentStages[i];
    const next = presentStages[i + 1];
    const exitedAt = next ? next.enteredAt : null;
    const durationMs =
      exitedAt !== null
        ? Math.max(0, exitedAt - stage.enteredAt)
        : Math.max(0, now - stage.enteredAt);
    result.push({
      column: /** @type {any} */ (stage.column),
      enteredAt: stage.enteredAt,
      exitedAt,
      durationMs,
    });
  }
  return result;
}

/**
 * @typedef {Object} ColumnStats
 * @property {number} count - cantidad de pedidos considerados
 * @property {number} avgMs - edad promedio en ms
 * @property {number} medianMs - edad mediana en ms (simple, sin interpolación)
 * @property {number} maxMs - edad máxima en ms
 */

/**
 * Estadísticas agregadas de "tiempo en esta columna" para los pedidos
 * actualmente en una columna dada. Usa columnEnteredAt (con fallback) para
 * ser consistente con el badge por card.
 *
 * Un pedido se cuenta solo si:
 *   1. computeColumn(pedido) === column (está realmente en esa columna)
 *   2. columnEnteredAt(pedido, column) devuelve un ms finito
 *
 * @param {Array<any>} pedidos
 * @param {string} column - una de las 5 columnas canónicas
 * @param {number} [nowMs=Date.now()]
 * @returns {ColumnStats | null}
 *   null si no hay pedidos en esa columna o ninguno tiene timestamp resoluble.
 */
export function columnStats(pedidos, column, nowMs) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) return null;
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();

  /** @type {Array<number>} */
  const ages = [];
  for (const p of pedidos) {
    if (!p) continue;
    let col;
    try {
      col = computeColumn(p);
    } catch (_e) {
      continue;
    }
    if (col !== column) continue;
    const entered = columnEnteredAt(p, column);
    if (entered === null || !Number.isFinite(entered)) continue;
    const age = Math.max(0, now - entered);
    ages.push(age);
  }

  if (ages.length === 0) return null;

  const count = ages.length;
  let sum = 0;
  let maxMs = 0;
  for (const a of ages) {
    sum += a;
    if (a > maxMs) maxMs = a;
  }
  const avgMs = sum / count;
  const sorted = ages.slice().sort((x, y) => x - y);
  const medianMs = sorted[Math.floor(count / 2)];

  return { count, avgMs, medianMs, maxMs };
}
