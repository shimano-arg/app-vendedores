// @ts-nocheck
// Pure: parsea un sheet Sales Plan (formato SUR/SAR de Shimano) a estructura
// normalizada { sku, description, moq, months: {'YYYY-MM': N} }.
// Sin dependencias — recibe el sheet ya deserializado por SheetJS
// (XLSX.utils.sheet_to_json(sheet, {header:1, defval:''})).
// Testeable en vitest sin cargar XLSX.
//
// Contexto: los Sales Plans de Shimano vienen con headers como
// "SKU Code/Part No", "Description", "MOQ 12 months" y columnas de meses
// tipo "Jan 2027", "May 2027" (a veces con año en una fila arriba y el mes
// en la fila header). Esta fn tolera ambos layouts.

const MONTH_ALIASES = {
  jan: 1,
  january: 1,
  ene: 1,
  enero: 1,
  feb: 2,
  february: 2,
  febrero: 2,
  mar: 3,
  march: 3,
  marzo: 3,
  apr: 4,
  april: 4,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  june: 6,
  junio: 6,
  jul: 7,
  july: 7,
  julio: 7,
  aug: 8,
  august: 8,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septiembre: 9,
  oct: 10,
  october: 10,
  octubre: 10,
  nov: 11,
  november: 11,
  noviembre: 11,
  dec: 12,
  december: 12,
  dic: 12,
  diciembre: 12,
};

// Normaliza labels de meses a 'YYYY-MM'. Retorna null si no matchea.
// Formatos soportados: "Jan 2027", "Ene-27", "Jan/2027", "May27",
// "2027-01", "01/2027", "Jan.2027", "2021\nJan" (multi-line Excel).
function normalizeMonthLabel(label) {
  if (label == null) return null;
  // v1104: colapsar newlines/tabs a espacio antes del trim.
  // El formato Excel "2021\nJan" (año en L1, mes en L2 dentro de una celda
  // multi-row) es común en Sales Plans SUR. `\s+` matchea whitespace incluyendo
  // \n y \r\n.
  const s = String(label).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!s) return null;
  let m;
  // "jan 2027" | "jan-27" | "ene/2027" | "may27" | "may.2027"
  m = s.match(/^([a-záéíóú]{3,10})[\s\-/._]*(\d{2,4})$/);
  if (m) {
    const mon = MONTH_ALIASES[m[1]] || MONTH_ALIASES[m[1].slice(0, 3)];
    if (mon) {
      let y = parseInt(m[2], 10);
      if (y < 100) y = 2000 + y;
      return String(y).padStart(4, '0') + '-' + String(mon).padStart(2, '0');
    }
  }
  // "2021 jan" | "2027 dic" (año primero + mes, formato Excel multi-line
  // colapsado tras replace \s+).
  m = s.match(/^(\d{4})[\s\-/._]+([a-záéíóú]{3,10})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mon = MONTH_ALIASES[m[2]] || MONTH_ALIASES[m[2].slice(0, 3)];
    if (mon) return String(y).padStart(4, '0') + '-' + String(mon).padStart(2, '0');
  }
  // "2027-01" | "2027/01"
  m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    if (mon >= 1 && mon <= 12)
      return String(y).padStart(4, '0') + '-' + String(mon).padStart(2, '0');
  }
  // "01/2027" | "01-2027"
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) {
    const mon = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    if (mon >= 1 && mon <= 12)
      return String(y).padStart(4, '0') + '-' + String(mon).padStart(2, '0');
  }
  return null;
}

// Busca la fila header (0-based). Escanea las primeras 30 filas.
function findHeaderRow(rows) {
  const HEADER_MARKERS = [
    'sku code/part no',
    'sku code',
    'sku',
    'part no',
    'part number',
    'itemcode',
    'item code',
    'codigo',
    'código',
  ];
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] || [];
    for (const cell of row) {
      // v1104: colapsar newlines a espacio para matchear headers como
      // "SKU Code/Part No" (ok) o "SKU\nCode" (necesita colapsar).
      const s = String(cell == null ? '' : cell)
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (HEADER_MARKERS.indexOf(s) >= 0) return i;
    }
  }
  return -1;
}

// Detecta índices de columnas y meses. `hintRowAbove` permite combinar año/mes
// cuando el header es multi-row (año arriba, mes abajo o viceversa).
function detectColumns(headerRow, hintRowAbove) {
  let skuIdx = -1;
  let descIdx = -1;
  let moqIdx = -1;
  const monthColumns = [];
  const detectedMonthsSet = new Set();
  for (let i = 0; i < headerRow.length; i++) {
    // v1104: colapsar newlines a espacio antes de comparar. Los Sales Plan
    // SUR tienen headers multi-line como "MOQ\n12 months" o "Base\nFOB(USD)".
    const raw = String(headerRow[i] == null ? '' : headerRow[i])
      .replace(/\s+/g, ' ')
      .trim();
    const s = raw.toLowerCase();
    if (
      skuIdx < 0 &&
      (s === 'sku code/part no' ||
        s === 'sku code' ||
        s === 'sku' ||
        s === 'part no' ||
        s === 'part number' ||
        s === 'itemcode' ||
        s === 'item code' ||
        s === 'codigo' ||
        s === 'código')
    ) {
      skuIdx = i;
      continue;
    }
    if (
      descIdx < 0 &&
      (s === 'description' ||
        s === 'descripcion' ||
        s === 'descripción' ||
        s === 'item name' ||
        s === 'itemname')
    ) {
      descIdx = i;
      continue;
    }
    if (moqIdx < 0 && (s === 'moq 12 months' || s === 'moq' || s.indexOf('moq') === 0)) {
      moqIdx = i;
      continue;
    }
    // Try direct month parse
    let monthKey = normalizeMonthLabel(raw);
    if (!monthKey && hintRowAbove && hintRowAbove[i] != null) {
      const hint = String(hintRowAbove[i]).trim();
      if (hint) {
        monthKey = normalizeMonthLabel(raw + ' ' + hint) || normalizeMonthLabel(hint + ' ' + raw);
      }
    }
    if (monthKey) {
      monthColumns.push({ colIdx: i, monthKey });
      detectedMonthsSet.add(monthKey);
    }
  }
  return {
    skuIdx,
    descIdx,
    moqIdx,
    monthColumns,
    detectedMonths: Array.from(detectedMonthsSet).sort(),
  };
}

// Public: parse full sheet. Throws on missing SKU column / months.
function parseSalesPlanSheet(rows) {
  if (!rows || !rows.length) {
    const err = new Error('Excel vacio');
    err.code = 'EMPTY_SHEET';
    throw err;
  }
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    const err = new Error('No se encontro fila de headers (buscaba "SKU Code/Part No" o "SKU")');
    err.code = 'HEADER_NOT_FOUND';
    throw err;
  }
  const headerRow = rows[headerIdx] || [];
  const rowAbove = headerIdx > 0 ? rows[headerIdx - 1] || [] : null;
  const cols = detectColumns(headerRow, rowAbove);
  if (cols.skuIdx < 0) {
    const err = new Error('No se encontro columna SKU en la fila header');
    err.code = 'SKU_COL_MISSING';
    throw err;
  }
  if (!cols.monthColumns.length) {
    const err = new Error(
      'No se detectaron columnas de meses en el header (ej: "Jan 2027", "May 2027")'
    );
    err.code = 'MONTHS_NOT_FOUND';
    throw err;
  }
  const parsedRows = [];
  const seenSku = new Set();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const skuRaw = row[cols.skuIdx];
    if (skuRaw == null || String(skuRaw).trim() === '') continue;
    const sku = String(skuRaw).trim();
    const upper = sku.toUpperCase();
    // Skip filas TOTAL / SUM / SUBTOTAL
    if (upper === 'TOTAL' || upper === 'SUM' || upper === 'SUBTOTAL' || upper === 'TOTALES')
      continue;
    if (seenSku.has(upper)) continue; // dedupe
    seenSku.add(upper);
    const description =
      cols.descIdx >= 0 ? String(row[cols.descIdx] == null ? '' : row[cols.descIdx]).trim() : '';
    const moqRaw = cols.moqIdx >= 0 ? row[cols.moqIdx] : null;
    const moqNum = Number(moqRaw);
    const moq = Number.isFinite(moqNum) && moqNum > 0 ? Math.round(moqNum) : 0;
    const months = {};
    for (const mc of cols.monthColumns) {
      const v = row[mc.colIdx];
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) {
        months[mc.monthKey] = Math.round(n);
      }
    }
    parsedRows.push({ sku, description, moq, months });
  }
  return {
    headerRowIndex: headerIdx,
    detectedMonths: cols.detectedMonths,
    rowsCount: parsedRows.length,
    rows: parsedRows,
  };
}

// UMD-ish export: para vitest (module.exports) y para bundle browser (window global).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSalesPlanSheet, normalizeMonthLabel, findHeaderRow, detectColumns };
}
if (typeof window !== 'undefined') {
  window.SalesPlanParser = {
    parseSalesPlanSheet,
    normalizeMonthLabel,
    findHeaderRow,
    detectColumns,
  };
}

export { detectColumns, findHeaderRow, normalizeMonthLabel, parseSalesPlanSheet };
