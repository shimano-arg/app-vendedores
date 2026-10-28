// @ts-check
/**
 * reparto-excel-import-validator (v1505, 2026-10-28) — pure fn para validar
 * las filas parseadas del Excel re-subido por Pablo contra el estado actual
 * del Reparto.
 *
 * Clave de match: `(RepartoId, CardCode, Codigo)` — el mismo SKU puede
 * estar en varios ingresos activos (3 ingresos de CLC66HAR el 2026-10-28),
 * por lo que `(Codigo, CardCode)` SOLO no identifica. El Reparto ID
 * (`ingresos_reparto/{id}`) desambigua.
 *
 * 6 casos de error validados (listados con `type` + `rowIndex`):
 *   1. `asignado_gt_stock`      — Asignado > Stock disponible del reparto.
 *   2. `asignado_elim_gt_bo`    — Asignado + Eliminar > Backorder del cliente.
 *   3. `invalid_number`         — negativos o no numéricos en Asignado/Eliminar.
 *   4. `duplicate`              — misma clave (RepartoId+CardCode+Codigo) 2+ veces.
 *   5. `reparto_cerrado`        — reparto ya resolvió (status != pending/in_progress).
 *   6. `not_found`              — clave no matchea ningún reparto activo.
 *
 * Semantica de la validación:
 *   - Si TODAS las filas tienen Asignado=0 y Eliminar=0 → no se aplica nada
 *     (shape válido, 0 cambios). El caller decide si lo trata como error.
 *   - `conCambios[]`: filas RECONOCIDAS cuya `Asignado>0 || Eliminar>0`.
 *   - `reconocidas[]`: TODAS las filas con match válido (cambios o sin cambios).
 *   - `errores[]`: filas con cualquiera de los 6 casos.
 *
 * Puro, idempotente, sin side effects.
 */

/**
 * Normaliza string (uppercase + trim) para match.
 * @param {any} v
 * @returns {string}
 */
function normStr(v) {
  return String(v == null ? '' : v)
    .trim()
    .toUpperCase();
}

/**
 * Clave canónica para match: `${repartoId}|${cardCode}|${sku}` normalizado.
 * @param {string} repartoId
 * @param {string} cardCode
 * @param {string} sku
 * @returns {string}
 */
function matchKey(repartoId, cardCode, sku) {
  return normStr(repartoId) + '|' + normStr(cardCode) + '|' + normStr(sku);
}

/**
 * Valida que un valor sea un número no negativo (acepta integer o decimal >= 0).
 * Null/undefined → trata como 0 (celda vacía).
 * @param {any} v
 * @returns {boolean}
 */
function isValidNonNegativeNumber(v) {
  if (v == null || v === '') return true;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return true;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0;
  }
  return false;
}

/**
 * @typedef {Object} RepartoActivo
 * @property {string} _id
 * @property {string} sku
 * @property {string} status - 'pending' | 'in_progress' | 'done' | ...
 * @property {Array<{clientCardCode?: string, cardCode?: string, qtyBackorder: number, clientName?: string}>} clientesBO
 * @property {number} [stockDisponible] - stock físico actual del SKU, opcional.
 */

/**
 * @typedef {Object} RepartoImportRow
 * @property {string|number} [Codigo]
 * @property {string} [Cliente]
 * @property {number|string} [Backorder]
 * @property {number|string} [StockDisponible]
 * @property {number|string} [Asignado]
 * @property {string|number} [VueleABackorder]
 * @property {number|string} [Eliminar]
 * @property {string|number} [RepartoId]
 * @property {string|number} [CardCode]
 * @property {number} [__rowIndex] - fila Excel 1-indexed (header=1, primer dato=2).
 */

/**
 * @typedef {Object} RepartoImportError
 * @property {number} rowIndex
 * @property {('asignado_gt_stock'|'asignado_elim_gt_bo'|'invalid_number'|'duplicate'|'reparto_cerrado'|'not_found')} type
 * @property {string} msg
 * @property {string} [sku]
 * @property {string} [cliente]
 */

/**
 * @typedef {Object} RepartoImportMatch
 * @property {number} rowIndex
 * @property {string} repartoId
 * @property {string} cardCode
 * @property {string} sku
 * @property {string} clientName
 * @property {number} backorderActual - BO del cliente HOY (del reparto activo).
 * @property {number} stockDisponibleActual - stock físico HOY.
 * @property {number} asignadoNuevo - lo que escribió Pablo.
 * @property {number} eliminarNuevo - lo que escribió Pablo.
 * @property {boolean} tieneCambios - true si asignado>0 o eliminar>0.
 */

/**
 * Valida un array de filas parseadas del xlsx contra el estado actual de
 * los repartos activos.
 *
 * @param {Array<RepartoImportRow>} filas
 * @param {Array<RepartoActivo>} repartosActivos
 * @returns {{
 *   reconocidas: Array<RepartoImportMatch>,
 *   conCambios: Array<RepartoImportMatch>,
 *   errores: Array<RepartoImportError>,
 *   totalFilas: number,
 *   totalAsignado: number,
 *   totalEliminar: number,
 * }}
 */
export function validateRepartoExcelImport(filas, repartosActivos) {
  if (!Array.isArray(filas)) filas = [];
  if (!Array.isArray(repartosActivos)) repartosActivos = [];

  // Index por matchKey → {reparto, cliente}.
  /** @type {Map<string, {reparto: RepartoActivo, cliente: any}>} */
  const indexMatch = new Map();
  /** @type {Map<string, RepartoActivo>} */
  const indexRepartoId = new Map();
  for (const r of repartosActivos) {
    if (!r || !r._id) continue;
    indexRepartoId.set(normStr(r._id), r);
    const clis = Array.isArray(r.clientesBO) ? r.clientesBO : [];
    for (const c of clis) {
      if (!c) continue;
      const cc = c.clientCardCode || c.cardCode || '';
      if (!cc) continue;
      const key = matchKey(r._id, cc, r.sku || '');
      // Si hay dup en el server-side (misma clave >1 cliente), queda la última.
      indexMatch.set(key, { reparto: r, cliente: c });
    }
  }

  /** @type {Map<string, number>} */
  const seenKeys = new Map();
  for (let i = 0; i < filas.length; i++) {
    const row = filas[i] || {};
    const repartoId = normStr(row.RepartoId);
    const cardCode = normStr(row.CardCode);
    const sku = normStr(row.Codigo);
    if (!repartoId || !cardCode || !sku) continue;
    const key = matchKey(repartoId, cardCode, sku);
    seenKeys.set(key, (seenKeys.get(key) || 0) + 1);
  }

  /** @type {Array<RepartoImportMatch>} */
  const reconocidas = [];
  /** @type {Array<RepartoImportError>} */
  const errores = [];
  /** @type {Set<string>} */
  const dupReported = new Set();
  let totalAsignado = 0;
  let totalEliminar = 0;

  for (let i = 0; i < filas.length; i++) {
    const row = filas[i] || {};
    const rowIdx = typeof row.__rowIndex === 'number' ? row.__rowIndex : i + 2;
    const repartoId = normStr(row.RepartoId);
    const cardCode = normStr(row.CardCode);
    const sku = normStr(row.Codigo);
    const clienteLbl = String(row.Cliente || '').trim();

    // 1. Validar números (Asignado / Eliminar) ANTES de match.
    const asigValid = isValidNonNegativeNumber(row.Asignado);
    const elimValid = isValidNonNegativeNumber(row.Eliminar);
    if (!asigValid || !elimValid) {
      errores.push({
        rowIndex: rowIdx,
        type: 'invalid_number',
        msg:
          'Fila ' +
          rowIdx +
          ': ' +
          (!asigValid ? 'Asignado ' : '') +
          (!asigValid && !elimValid ? 'y ' : '') +
          (!elimValid ? 'Eliminar ' : '') +
          'debe ser un número >= 0',
        sku,
        cliente: clienteLbl,
      });
      continue;
    }

    const asignadoNuevo = Number(row.Asignado || 0) || 0;
    const eliminarNuevo = Number(row.Eliminar || 0) || 0;

    // 2. Duplicados (misma clave 2+ veces).
    const key = matchKey(repartoId, cardCode, sku);
    if ((seenKeys.get(key) || 0) > 1 && !dupReported.has(key)) {
      errores.push({
        rowIndex: rowIdx,
        type: 'duplicate',
        msg:
          'Fila ' + rowIdx + ': fila duplicada (misma Reparto ID + CardCode + Código ' + sku + ')',
        sku,
        cliente: clienteLbl,
      });
      dupReported.add(key);
      continue;
    }
    if ((seenKeys.get(key) || 0) > 1 && dupReported.has(key)) {
      // Ya reportado el primer encontrado — skip las copias.
      continue;
    }

    // 3. Reparto cerrado (status != pending/in_progress).
    const reparto = indexRepartoId.get(repartoId);
    if (reparto) {
      const status = String(reparto.status || '').toLowerCase();
      if (status !== 'pending' && status !== 'in_progress' && status !== '') {
        errores.push({
          rowIndex: rowIdx,
          type: 'reparto_cerrado',
          msg:
            'Fila ' +
            rowIdx +
            ': el reparto ' +
            repartoId +
            ' ya está cerrado (status=' +
            status +
            ')',
          sku,
          cliente: clienteLbl,
        });
        continue;
      }
    }

    // 4. Not found: clave no matchea ningún reparto activo.
    const matched = indexMatch.get(key);
    if (!matched) {
      errores.push({
        rowIndex: rowIdx,
        type: 'not_found',
        msg:
          'Fila ' +
          rowIdx +
          ': no se encontró reparto activo para RepartoID=' +
          repartoId +
          ' / CardCode=' +
          cardCode +
          ' / SKU=' +
          sku +
          ' (puede haber cerrado o backorder cambió)',
        sku,
        cliente: clienteLbl,
      });
      continue;
    }

    const backorderActual = Number(matched.cliente.qtyBackorder) || 0;
    const stockDisponibleActual =
      typeof matched.reparto.stockDisponible === 'number'
        ? matched.reparto.stockDisponible
        : Number(matched.reparto.stockDisponible) || 0;

    // 5. Asignado > StockDisponible.
    if (asignadoNuevo > stockDisponibleActual) {
      errores.push({
        rowIndex: rowIdx,
        type: 'asignado_gt_stock',
        msg:
          'Fila ' +
          rowIdx +
          ': Asignado=' +
          asignadoNuevo +
          ' > Stock disponible=' +
          stockDisponibleActual,
        sku,
        cliente: clienteLbl,
      });
      continue;
    }

    // 6. Asignado + Eliminar > Backorder.
    if (asignadoNuevo + eliminarNuevo > backorderActual) {
      errores.push({
        rowIndex: rowIdx,
        type: 'asignado_elim_gt_bo',
        msg:
          'Fila ' +
          rowIdx +
          ': Asignado(' +
          asignadoNuevo +
          ') + Eliminar(' +
          eliminarNuevo +
          ') > Backorder del cliente=' +
          backorderActual,
        sku,
        cliente: clienteLbl,
      });
      continue;
    }

    // Match válido.
    const tieneCambios = asignadoNuevo > 0 || eliminarNuevo > 0;
    reconocidas.push({
      rowIndex: rowIdx,
      repartoId: String(matched.reparto._id),
      cardCode: String(matched.cliente.clientCardCode || matched.cliente.cardCode || ''),
      sku: String(matched.reparto.sku || ''),
      clientName: String(matched.cliente.clientName || clienteLbl || ''),
      backorderActual,
      stockDisponibleActual,
      asignadoNuevo,
      eliminarNuevo,
      tieneCambios,
    });
    if (tieneCambios) {
      totalAsignado += asignadoNuevo;
      totalEliminar += eliminarNuevo;
    }
  }

  /** @type {Array<RepartoImportMatch>} */
  const conCambios = reconocidas.filter((r) => r.tieneCambios);

  return {
    reconocidas,
    conCambios,
    errores,
    totalFilas: filas.length,
    totalAsignado,
    totalEliminar,
  };
}

/**
 * Agrupa los `conCambios` por `repartoId` para armar los payloads
 * `applyRepartoManualCF` (una invocación por reparto).
 *
 * @param {Array<RepartoImportMatch>} conCambios
 * @returns {Array<{repartoId: string, sku: string, assignments: Array<{cardCode: string, qtyAsignada: number}>, eliminations: Array<{cardCode: string, qtyEliminar: number}>}>}
 */
export function groupImportMatchesByReparto(conCambios) {
  if (!Array.isArray(conCambios)) return [];
  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const m of conCambios) {
    if (!m || !m.repartoId) continue;
    let g = groups.get(m.repartoId);
    if (!g) {
      g = {
        repartoId: m.repartoId,
        sku: m.sku,
        assignments: [],
        eliminations: [],
      };
      groups.set(m.repartoId, g);
    }
    if (m.asignadoNuevo > 0) {
      g.assignments.push({ cardCode: m.cardCode, qtyAsignada: m.asignadoNuevo });
    }
    if (m.eliminarNuevo > 0) {
      g.eliminations.push({ cardCode: m.cardCode, qtyEliminar: m.eliminarNuevo });
    }
  }
  return Array.from(groups.values());
}
