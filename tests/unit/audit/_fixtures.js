// @ts-check
/**
 * Fixtures para auditoria flujo stock CRM (2026-10-20).
 *
 * Shape alineado al modelo real de Firestore:
 *   - pedidos: { _fsId, clientCardCode, createdAt, closedAt?, confirmedAt?, lines: Line[] }
 *   - line: { code, qty, qtyOpen, state ('confirmed'|'BO'|'ASIG'|...),
 *             asigReserva?, asigAt?, priceAtCreation }
 *   - stock_snapshot proxy: deps.getStockFisico(sku) devuelve dep 11 fisico
 *   - waitlistEntries: { source, clientCardCode, items: [{ code, qty }] }
 *       solo entries con source='stock-asignado-batch' (CPST) reservan stock
 *
 * Convencion fechas: todas las fechas de fixture son 2026-10-18T10:00:00Z (hace 2 dias).
 * El `now` del test fija 2026-10-20T10:00:00Z para que ninguna reserva expire
 * por TTL 7d (v1198) ni por TTL 15d legacy.
 */

const NOW_ISO = '2026-10-20T10:00:00.000Z';
export const NOW_MS = Date.parse(NOW_ISO);

const RECENT_ISO = '2026-10-18T10:00:00.000Z'; // 2 dias antes del NOW
const RECENT_MS = Date.parse(RECENT_ISO);

/**
 * Factory de linea confirmed.
 */
export const lineConfirmed = (sku, qty, extra = {}) => ({
  code: sku,
  sku,
  qty,
  qtyOpen: qty,
  state: 'confirmed',
  asigReserva: true, // confirmed default reserva (v1269)
  priceAtCreation: 1000,
  ...extra,
});

/**
 * Factory de linea BO.
 */
export const lineBO = (sku, qty, extra = {}) => ({
  code: sku,
  sku,
  qty,
  qtyOpen: qty,
  state: 'BO',
  asigReserva: false,
  asigAt: null,
  priceAtCreation: 1000,
  ...extra,
});

/**
 * Factory de linea ASIG (BO que recibio stock por FIFO).
 */
export const lineASIG = (sku, qty, extra = {}) => ({
  code: sku,
  sku,
  qty,
  qtyOpen: qty,
  state: 'ASIG',
  asigReserva: true,
  asigAt: RECENT_ISO,
  asigCliTipo: 'A',
  priceAtCreation: 1000,
  ...extra,
});

/**
 * Factory de pedido abierto (open).
 *
 * @param {string} fsId identificador unico de Firestore
 * @param {string} cardCode CardCode del cliente (ej. 'NORTE', 'SUR', 'OESTE')
 * @param {Array<any>} lines
 * @param {object} extra campos opcionales
 */
export const pedidoOpen = (fsId, cardCode, lines, extra = {}) => ({
  _fsId: fsId,
  _id: fsId,
  clientCardCode: cardCode,
  createdAt: RECENT_ISO,
  closedAt: null,
  lines,
  ...extra,
});

/**
 * Factory de waitlist entry CPST (ex-Stock Asignado).
 * Entries con source='stock-asignado-batch' reservan stock (v1198).
 */
export const waitlistCPST = (cardCode, items) => ({
  source: 'stock-asignado-batch',
  clientCardCode: cardCode,
  items,
});

/**
 * Factory de waitlist entry normal (VDE cargando pedido manual).
 * NO reserva stock (es pre-carga).
 */
export const waitlistNormal = (cardCode, items) => ({
  source: 'manual',
  clientCardCode: cardCode,
  items,
});

/**
 * Factory de `deps` para `getStockRealmenteDisponible` / `getStockPorCliente`.
 *
 * @param {object} opts
 * @param {Record<string, number>} opts.fisicoBySku - mapa sku -> stock fisico dep 11
 * @param {Array<any>} opts.pedidos
 * @param {Array<any>} [opts.waitlistEntries]
 */
export const makeDeps = ({ fisicoBySku, pedidos, waitlistEntries = [] }) => ({
  getStockFisico: (sku) => fisicoBySku[String(sku).toUpperCase()] || 0,
  pedidos,
  waitlistEntries,
});

/**
 * Clientes del caso end-to-end.
 */
export const NORTE = 'C-NORTE';
export const SUR = 'C-SUR';
export const OESTE = 'C-OESTE';
export const CUARTO = 'C-CUARTO'; // cliente adicional para ventana H6

/**
 * SKU del caso end-to-end.
 */
export const SKU_STRADIC = 'STRADIC-2500';

/**
 * Options object with `now` fijo para que los TTL de reserva no expiren.
 */
export const AT_NOW = { now: NOW_MS };
