/**
 * dual-write-pg-helpers.js (pure, zero I/O)
 *
 * Helpers puros para construir SQL + params del wiring dual-write
 * (Stack S-12, ADR-0016). Recibe el output de `transformPedidoToPg`
 * (S-10) y devuelve statements SQL parametrizados listos para ejecutar
 * contra `pg.Client` / `pg.Pool`.
 *
 * ESTE MODULO ES PURO. No conoce Firestore, no abre conexiones PG, no
 * mide tiempo. Idempotente: el shape de output es funcion deterministica
 * del input.
 *
 * Mirror obligatorio en `functions/core/dual-write-pg-helpers.js` (§57).
 *
 * @module src/pure/dual-write-pg-helpers
 */

/**
 * Columnas de la tabla `pedidos` en orden canonico (debe matchear el
 * INSERT statement). El orden es importante para parametrizar bien.
 */
export const PEDIDO_COLUMNS = Object.freeze([
  'id',
  'order_number',
  'client_card_code',
  'client_name',
  'assigned_vendor_uid',
  'assigned_vendor_key',
  'owner_uid',
  'cargado_por_uid',
  'origen',
  'draft_id',
  'transferido_sap',
  'created_at',
  'updated_at',
  'first_invoiced_at',
  'cobrado_at',
  'closed_at',
  'closed_reason',
  'closed_by',
]);

/**
 * Columnas de la tabla `pedido_lines` en orden canonico.
 */
export const PEDIDO_LINE_COLUMNS = Object.freeze([
  'pedido_id',
  'line_index',
  'sku',
  'state',
  'qty',
  'qty_open',
  'qty_cancelled',
  'price_ars',
  'discount_percent',
  'en_transito',
  'asig_at_transito',
  'en_dep11_at',
  'asig_at',
  'confirmed_at',
  'cancelled_at',
  'asig_revertida_at',
  'asig_revertida_by',
  'asig_revertida_reason',
  'split_from_line_index',
  'closed_reason',
  'closed_by',
  'cancelled_by',
]);

/**
 * Construye la lista de placeholders `$1, $2, ..., $N` para N columnas.
 *
 * @param {number} count
 * @param {number} [startIndex=1] - indice inicial (para batches con
 *   offset).
 * @returns {string}
 */
export function buildPlaceholders(count, startIndex = 1) {
  const parts = [];
  for (let i = 0; i < count; i++) parts.push('$' + (startIndex + i));
  return parts.join(', ');
}

/**
 * Serializa el valor de una columna para pasarselo al driver `pg`.
 * Convierte objects a JSON string (para columnas JSONB como
 * `transferido_sap`). Pasa primitivas tal cual. `pg` client ya maneja
 * null + boolean + number + string.
 *
 * @param {string} column
 * @param {unknown} value
 * @returns {unknown}
 */
export function serializeValue(column, value) {
  if (value === null || value === undefined) return null;
  // transferido_sap es JSONB. pg acepta object directo pero JSON.stringify
  // es mas seguro (previene edge cases con BigInt, Date, etc.).
  if (column === 'transferido_sap' && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_e) {
      return null;
    }
  }
  return value;
}

/**
 * Construye el statement + params para insertar la cabecera del pedido.
 *
 * SQL:
 *   INSERT INTO pedidos (col1, col2, ...) VALUES ($1, $2, ...)
 *
 * Se asume que el caller ejecuto antes:
 *   DELETE FROM pedidos WHERE id = $1
 * (cascade sobre pedido_lines + stock_reservations). Ver §58 PG tx safety:
 * el schema tiene ON DELETE CASCADE sobre pedido_lines.pedido_id, por lo
 * que DELETE + INSERT atomico garantiza idempotencia.
 *
 * @param {Record<string, any>} pedido - output de `transformPedidoToPg.pedido`.
 * @returns {{text: string, values: unknown[]}}
 */
export function buildPedidoInsert(pedido) {
  if (!pedido || typeof pedido !== 'object') {
    throw new Error('buildPedidoInsert: pedido invalido');
  }
  const values = PEDIDO_COLUMNS.map((col) => serializeValue(col, pedido[col]));
  const text =
    'INSERT INTO pedidos (' +
    PEDIDO_COLUMNS.join(', ') +
    ') VALUES (' +
    buildPlaceholders(PEDIDO_COLUMNS.length) +
    ')';
  return { text, values };
}

/**
 * Construye el statement DELETE idempotente para el pedido.
 *
 * SQL:
 *   DELETE FROM pedidos WHERE id = $1
 *
 * Cascade elimina `pedido_lines` + `stock_reservations` del pedido.
 * No existe DELETE sobre `revision_waitlist` desde aqui — ese shape
 * no es responsabilidad del dual-write de /pedidos.
 *
 * @param {string} pedidoId
 * @returns {{text: string, values: unknown[]}}
 */
export function buildPedidoDelete(pedidoId) {
  if (!pedidoId || typeof pedidoId !== 'string') {
    throw new Error('buildPedidoDelete: pedidoId invalido');
  }
  return {
    text: 'DELETE FROM pedidos WHERE id = $1',
    values: [pedidoId],
  };
}

/**
 * Construye el statement + params para insertar un batch de lineas de
 * pedido. Usa `INSERT INTO ... VALUES (...), (...), (...)` multi-row.
 *
 * Si `lines` esta vacio, devuelve `null` (el caller skipea).
 *
 * El trigger PG `t_pedido_lines_sync_reservations` se dispara AFTER
 * INSERT y mantiene `stock_reservations` en sincronia — no hay que
 * insertar reservations a mano.
 *
 * @param {Array<Record<string, any>>} lines - output de `transformPedidoToPg.lines`.
 * @returns {{text: string, values: unknown[]} | null}
 */
export function buildPedidoLinesInsert(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const colCount = PEDIDO_LINE_COLUMNS.length;
  const values = [];
  const rowClauses = [];
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    if (!line || typeof line !== 'object') continue;
    const startIdx = values.length + 1;
    const rowPlaceholders = buildPlaceholders(colCount, startIdx);
    rowClauses.push('(' + rowPlaceholders + ')');
    for (const col of PEDIDO_LINE_COLUMNS) {
      values.push(serializeValue(col, line[col]));
    }
  }
  if (rowClauses.length === 0) return null;
  const text =
    'INSERT INTO pedido_lines (' +
    PEDIDO_LINE_COLUMNS.join(', ') +
    ') VALUES ' +
    rowClauses.join(', ');
  return { text, values };
}

/**
 * Construye la secuencia de statements para replicar un pedido entero.
 * Devuelve un array ordenado que el caller ejecuta dentro de una
 * transaccion PG (BEGIN; stmt1; stmt2; stmt3; COMMIT).
 *
 * Orden:
 *   1. DELETE pedidos WHERE id = $1 (cascade limpia lines + reservations).
 *   2. INSERT pedidos (cabecera).
 *   3. INSERT pedido_lines (batch, si hay lineas).
 *
 * Idempotente: 2 ejecuciones consecutivas con mismo pedidoId dan el mismo
 * resultado final (DELETE antes de INSERT garantiza no duplicados).
 *
 * El output de `transformPedidoToPg` incluye `reservations[]` pero NO
 * emitimos INSERT sobre ellas — el trigger PG las deriva de las lineas.
 *
 * @param {{pedido: Record<string, any>, lines: Array<Record<string, any>>, reservations: Array<Record<string, any>>, warnings: string[]}} transformResult
 * @returns {Array<{text: string, values: unknown[]}>}
 */
export function buildReplicationStatements(transformResult) {
  if (!transformResult || typeof transformResult !== 'object') {
    throw new Error('buildReplicationStatements: result invalido');
  }
  const { pedido, lines } = transformResult;
  if (!pedido || !pedido.id) {
    throw new Error('buildReplicationStatements: falta pedido.id');
  }
  const statements = [];
  statements.push(buildPedidoDelete(pedido.id));
  statements.push(buildPedidoInsert(pedido));
  const linesStmt = buildPedidoLinesInsert(lines);
  if (linesStmt) statements.push(linesStmt);
  return statements;
}

/**
 * Shape fijo del entry que `commitPedidoCore` escribe en la coleccion
 * Firestore `dual_write_pending` cuando la replicacion PG falla. Usar
 * `pedidoId` como doc id para dedupe natural + `merge: true` para
 * acumular attempts.
 *
 * @param {string} pedidoId
 * @param {Error | {message?: string, code?: string}} err
 * @param {{nowIso?: string, firstFailedAtIso?: string}} [opts]
 * @returns {Record<string, unknown>}
 */
export function buildDualWritePendingEntry(pedidoId, err, opts) {
  const o = opts || {};
  const nowIso = o.nowIso || new Date().toISOString();
  const anyErr = /** @type {any} */ (err);
  /** @type {Record<string, any>} */
  const entry = {
    pedidoId: String(pedidoId),
    failedAt: nowIso,
    lastAttemptAt: nowIso,
    errorMessage: err && err.message ? String(err.message).slice(0, 2000) : null,
    errorCode: anyErr && anyErr.code ? String(anyErr.code) : null,
    // attempts se incrementa en el .set({merge:true}) via FieldValue.increment(1)
    // en el call-site; aca lo dejamos en 1 para el primer write.
    attempts: 1,
    resolvedAt: null,
  };
  // firstFailedAt se setea solo si es el primer fallo (merge:true no pisa).
  entry.firstFailedAt = o.firstFailedAtIso || nowIso;
  return entry;
}

export const DUAL_WRITE_PG_HELPERS_VERSION = 1;
