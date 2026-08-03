// @ts-check
/**
 * CSV serializer + dataset schemas + row builders — para exportDatasetZip
 * (v371+). Funciones puras, testeables sin globals del bundle.
 *
 * 5 casos de uso ML documentados en DATASET_USE_CASE_MATRIX:
 *   A) Conversion visita->pedido (prioridad 1, clasificacion)
 *   B) Riesgo de churn de clientes (prioridad 2, alerta)
 *   C) Forecast de demanda por SKU (prioridad 3, series temporales)
 *   D) Anomalias en rendiciones (exploratorio)
 *   E) Estacionalidad por zona/campana (exploratorio)
 *
 * Convenciones (RFC 4180 + adaptaciones para ML pipelines):
 *   - Separator: ","
 *   - Quote char: "\""
 *   - Escape quote: "\"\""
 *   - Line terminator: "\r\n"
 *   - Encoding: UTF-8 (BOM opcional al escribir el ZIP)
 *   - Fechas: ISO 8601 UTC (con "Z" al final)
 *   - Decimales: punto (".")
 *   - Null/undefined: campo vacio (NO "N/A", "-", "null")
 *   - Arrays -> JSON.stringify entre comillas dobles
 *   - Objetos (excepto Timestamp y Date) -> JSON.stringify
 *   - Firestore Timestamps -> toDate().toISOString()
 */

// ============================================================
// Helpers CSV puros
// ============================================================

/**
 * Escapa un valor string para CSV RFC 4180. Wrappea con "..." si contiene
 * ",", "\"", "\r" o "\n". Escapa "\"" -> "\"\"".
 * @param {string} s
 * @returns {string}
 */
export function csvEscape(s) {
  if (s === null || s === undefined) return '';
  const str = String(s);
  if (str === '') return '';
  // Necesita quoting si tiene coma, quote, o line-break
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Convierte un array de valores en una linea CSV (sin trailing newline).
 * Aplica csvEscape a cada campo despues de firestoreValueToCsv.
 * @param {unknown[]} fields
 * @returns {string}
 */
export function csvRow(fields) {
  return fields.map((f) => csvEscape(firestoreValueToCsv(f))).join(',');
}

/**
 * Convierte un valor de Firestore/JS a string apto para CSV.
 * Regla por tipo:
 *   - null / undefined -> ''
 *   - Firestore Timestamp (tiene .toDate) -> ISO 8601 UTC
 *   - Date -> ISO 8601 UTC
 *   - boolean -> 'true' / 'false'
 *   - number -> String(n) con punto decimal
 *   - string -> tal cual (csvEscape wrappea si hace falta)
 *   - Array -> JSON.stringify
 *   - Object -> JSON.stringify
 * @param {unknown} v
 * @returns {string}
 */
export function firestoreValueToCsv(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''; // NaN, Infinity -> vacio (no confundir pipelines)
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  // Firestore Timestamp
  if (
    typeof v === 'object' &&
    v !== null &&
    typeof (/** @type {any} */ (v).toDate) === 'function'
  ) {
    try {
      return /** @type {any} */ (v).toDate().toISOString();
    } catch (_) {
      return '';
    }
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return v.toISOString();
  }
  if (Array.isArray(v)) {
    // JSON.stringify de array. csvEscape luego lo wrappea si hay comas.
    try {
      return JSON.stringify(v);
    } catch (_) {
      return '';
    }
  }
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch (_) {
      return '';
    }
  }
  return String(v);
}

/**
 * Obtiene el valor de un path dot-notation en un objeto anidado.
 * Ej: getPath({a: {b: {c: 1}}}, 'a.b.c') -> 1
 * getPath({}, 'a.b') -> undefined
 * @param {object} obj
 * @param {string} path
 * @returns {unknown}
 */
export function getPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = /** @type {any} */ (obj);
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Construye el CSV completo (header + N rows) para una coleccion segun
 * su schema. Cada builder devuelve un array de filas (cada fila = array
 * de valores en el orden del schema).
 * @param {{columns: {col: string}[]}} schema
 * @param {unknown[][]} rows
 * @returns {string} CSV completo con \r\n como line separator
 */
export function buildCsv(schema, rows) {
  const header = schema.columns.map((c) => csvEscape(c.col)).join(',');
  const body = rows.map((r) => csvRow(r)).join('\r\n');
  return body.length ? header + '\r\n' + body + '\r\n' : header + '\r\n';
}

/**
 * Cuenta null rate por columna requerida. Retorna
 * {colName: rate 0..1}. Un valor es "null" si firestoreValueToCsv devuelve ''.
 * @param {{columns: {col: string}[]}} schema
 * @param {unknown[][]} rows
 * @param {string[]} requiredCols
 * @returns {Record<string, number>}
 */
export function computeNullRates(schema, rows, requiredCols) {
  /** @type {Record<string, number>} */
  const result = {};
  if (!rows.length) {
    // sin datos: null rate = 1 (100% falta) para cada campo requerido
    for (const c of requiredCols) result[c] = 1;
    return result;
  }
  const colIndex = /** @type {Record<string, number>} */ ({});
  schema.columns.forEach((c, i) => {
    colIndex[c.col] = i;
  });
  for (const rc of requiredCols) {
    const idx = colIndex[rc];
    if (idx === undefined) {
      result[rc] = 1; // columna no existe en schema -> considerar como 100% null
      continue;
    }
    let nulls = 0;
    for (const row of rows) {
      const v = row[idx];
      if (firestoreValueToCsv(v) === '') nulls++;
    }
    result[rc] = Math.round((nulls / rows.length) * 10000) / 10000;
  }
  return result;
}

// ============================================================
// DATASET_SCHEMAS — 11 colecciones con columnas + tipos + descripciones
// ============================================================

/** @typedef {{col: string, type: string, desc: string}} SchemaColumn */
/** @typedef {{name: string, source: 'firestore'|'stock_json', collection?: string, rowMode: string, columns: SchemaColumn[]}} DatasetSchema */

/** @type {Record<string, DatasetSchema>} */
export const DATASET_SCHEMAS = {
  pedidos: {
    name: 'pedidos.csv',
    source: 'firestore',
    collection: 'pedidos',
    rowMode: 'flatten_lines', // 1 fila por (pedido, linea)
    columns: [
      { col: 'pedido_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'owner_uid', type: 'string', desc: 'UID del vendedor duenio del pedido' },
      { col: 'owner_email', type: 'string', desc: 'email del vendedor' },
      { col: 'created_by_uid', type: 'string', desc: 'quien cargo (VDI puede cargar por VDE)' },
      { col: 'on_behalf_of', type: 'boolean', desc: 'true si VDI cargo por VDE' },
      { col: 'key', type: 'string', desc: 'clave compuesta tipo|prov|loc|cliente' },
      { col: 'stage', type: 'string', desc: 'pending | confirmed | sap_imported' },
      { col: 'tipo', type: 'string', desc: 'C=cliente | P=prospecto' },
      { col: 'province', type: 'string', desc: 'provincia' },
      { col: 'loc_name', type: 'string', desc: 'localidad' },
      { col: 'client_name', type: 'string', desc: 'nombre cliente' },
      { col: 'month', type: 'string', desc: 'ej "Julio 2026"' },
      { col: 'month_idx', type: 'int', desc: '0-11' },
      { col: 'year', type: 'int', desc: 'ano' },
      { col: 'confirmed_at', type: 'iso8601', desc: 'timestamp UTC de confirmacion' },
      { col: 'condicion_pago', type: 'string', desc: 'ej CTA CTE' },
      { col: 'forma_entrega_tipo', type: 'string', desc: 'TRANSPORTISTA | SUCURSAL' },
      { col: 'forma_entrega_transp_nombre', type: 'string', desc: '' },
      { col: 'forma_entrega_transp_direccion', type: 'string', desc: '' },
      { col: 'forma_entrega_cliente_direccion', type: 'string', desc: 'destino final' },
      { col: 'forma_entrega_sucursal_direccion', type: 'string', desc: '' },
      {
        col: 'discount_pct',
        type: 'number',
        desc: 'descuento total del pedido (aplicado a nivel header, prorratear en pipeline)',
      },
      { col: 'subtotal_ars', type: 'number', desc: 'subtotal bruto ARS' },
      { col: 'net_amount_ars', type: 'number', desc: 'neto ARS post-descuento' },
      { col: 'transferido_sap_via', type: 'string', desc: 'dtw_manual | service_layer' },
      { col: 'transferido_sap_doc_num', type: 'int', desc: 'numero de Quotation SAP' },
      { col: 'transferido_sap_doc_entry', type: 'int', desc: 'doc entry interno SAP' },
      { col: 'transferido_sap_at', type: 'iso8601', desc: 'timestamp UTC' },
      { col: 'created_at', type: 'iso8601', desc: 'timestamp UTC' },
      { col: 'line_index', type: 'int', desc: 'indice de linea 0-based' },
      { col: 'line_code', type: 'string', desc: 'SKU' },
      { col: 'line_desc', type: 'string', desc: 'descripcion producto' },
      { col: 'line_qty', type: 'number', desc: 'cantidad' },
      { col: 'line_precio', type: 'number', desc: 'precio unitario ARS' },
      { col: 'line_cat', type: 'string', desc: 'categoria' },
      { col: 'line_fam', type: 'string', desc: 'familia' },
      { col: 'line_sub', type: 'string', desc: 'subfamilia' },
    ],
  },
  visitas: {
    name: 'visitas.csv',
    source: 'firestore',
    collection: 'visits',
    rowMode: 'one_per_doc',
    columns: [
      { col: 'visit_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'owner_uid', type: 'string', desc: 'UID del vendedor' },
      { col: 'owner_email', type: 'string', desc: 'email del vendedor' },
      { col: 'fecha', type: 'iso8601', desc: 'YYYY-MM-DD (fecha de visita, no UTC)' },
      { col: 'mes', type: 'string', desc: 'JUNIO, JULIO, etc.' },
      { col: 'anio', type: 'int', desc: 'ano' },
      { col: 'vendor', type: 'string', desc: 'nombre canonico vendedor' },
      { col: 'provincia', type: 'string', desc: 'provincia' },
      { col: 'localidad', type: 'string', desc: 'localidad' },
      { col: 'tienda', type: 'string', desc: 'nombre tienda' },
      { col: 'tipo', type: 'string', desc: 'C | P' },
      { col: 'local', type: 'string', desc: 'ej Propio, Alquilado' },
      { col: 'tamano', type: 'string', desc: 'ej Chico, Mediano, Grande' },
      { col: 'fidelidad', type: 'string', desc: 'Alta, Media, Baja' },
      { col: 'relevancia', type: 'int', desc: '0-5' },
      { col: 'pop', type: 'string', desc: 'ej Stickers Shimano' },
      { col: 'necesidad_puntual', type: 'string', desc: '' },
      { col: 'tipo_venta', type: 'string', desc: 'ej Casa de pesca + ecommerce' },
      { col: 'ponderacion_mostrado', type: 'int', desc: '0-100' },
      { col: 'ponderacion_ecommerce', type: 'int', desc: '0-100' },
      { col: 'competencia', type: 'string', desc: '' },
      { col: 'oportunidad', type: 'string', desc: '' },
      { col: 'mas_vendido', type: 'string', desc: '' },
      { col: 'mas_preguntan', type: 'string', desc: '' },
      { col: 'ayuda_tienda', type: 'string', desc: '' },
      { col: 'gps_status', type: 'string', desc: 'ok | outside | noloc' },
      { col: 'gps_distance_m', type: 'number', desc: 'metros' },
      { col: 'interaction_type', type: 'string', desc: 'visita | contacto' },
      {
        col: 'forma_contacto',
        type: 'string',
        desc: 'LLAMADA TELEFONICA | MENSAJE DE WHATSAPP | MENSAJE SMS (si contacto)',
      },
      {
        col: 'contacto_resultado',
        type: 'string',
        desc: 'respondio | no_respondio | vacio (sin marcar, solo aplica a contacto)',
      },
      { col: 'contacto_resultado_at', type: 'iso8601', desc: 'timestamp UTC' },
      { col: 'contacto_resultado_by', type: 'string', desc: 'UID de quien marco' },
      { col: 'created_at', type: 'iso8601', desc: 'timestamp UTC' },
    ],
  },
  clientes: {
    name: 'clientes.csv',
    source: 'firestore',
    collection: 'client_applications',
    rowMode: 'one_per_doc',
    columns: [
      { col: 'app_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'owner_uid', type: 'string', desc: '' },
      { col: 'owner_email', type: 'string', desc: '' },
      { col: 'owner_name', type: 'string', desc: '' },
      { col: 'comercio', type: 'string', desc: 'razon social' },
      { col: 'fantasia', type: 'string', desc: 'nombre comercial' },
      { col: 'cuit', type: 'string', desc: 'solo digitos post-v294' },
      { col: 'condicion_fiscal', type: 'string', desc: '' },
      { col: 'calle', type: 'string', desc: '' },
      { col: 'numero', type: 'string', desc: '' },
      { col: 'localidad', type: 'string', desc: '' },
      { col: 'provincia', type: 'string', desc: '' },
      { col: 'localidad_final', type: 'string', desc: 'override del aprobador' },
      { col: 'card_code_sap', type: 'string', desc: 'CardCode SAP' },
      { col: 'assigned_vendor', type: 'string', desc: 'vendedor asignado (source of truth v311+)' },
      { col: 'status', type: 'string', desc: 'pending_approval | approved | rejected' },
      {
        col: 'source',
        type: 'string',
        desc: 'manual | sap_bulk_import | alta_rapida | sap_sync | sap_sync_manual_link',
      },
      {
        col: 'manual_sap_pending',
        type: 'boolean',
        desc: 'true=provisorio (Alta Rapida sin CardCode)',
      },
      { col: 'precaucion', type: 'boolean', desc: 'true=cliente marcado por impago' },
      { col: 'categoria_cliente', type: 'string', desc: 'P/A/B/C' },
      { col: 'cli_tipo', type: 'string', desc: 'C default post-v349' },
      { col: 'lat', type: 'number', desc: 'geolat' },
      { col: 'lng', type: 'number', desc: 'geolng' },
      { col: 'has_geo', type: 'boolean', desc: 'lat/lng no null' },
      { col: 'has_address', type: 'boolean', desc: 'calle no vacia' },
      { col: 'submitted_by_public_form', type: 'boolean', desc: 'via alta-cliente.html' },
      { col: 'approved_at', type: 'iso8601', desc: '' },
      { col: 'created_at', type: 'iso8601', desc: '' },
      { col: 'updated_at', type: 'iso8601', desc: '' },
    ],
  },
  client_master: {
    name: 'client_master.csv',
    source: 'firestore',
    collection: 'client_master',
    rowMode: 'one_per_doc',
    columns: [
      { col: 'master_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'client_name', type: 'string', desc: '' },
      { col: 'provincia', type: 'string', desc: '' },
      { col: 'localidad', type: 'string', desc: '' },
      { col: 'vendor', type: 'string', desc: 'vendedor curado admin' },
      { col: 'address', type: 'string', desc: 'direccion curada admin' },
      { col: 'sap_card_code', type: 'string', desc: 'CardCode SAP' },
      { col: 'sap_address', type: 'string', desc: 'direccion raw SAP' },
      { col: 'sap_city', type: 'string', desc: '' },
      { col: 'sap_state', type: 'string', desc: '' },
      { col: 'sap_imported_at', type: 'iso8601', desc: '' },
      { col: 'sap_imported_by', type: 'string', desc: '' },
      { col: 'client_name_original', type: 'string', desc: 'backup nombre pre-import' },
      { col: 'localidad_original', type: 'string', desc: 'backup localidad pre-import' },
      { col: 'match_type', type: 'string', desc: 'exact | fuzzy' },
      { col: 'match_similarity', type: 'number', desc: '0-1' },
      { col: 'updated_at', type: 'iso8601', desc: '' },
      { col: 'updated_by', type: 'string', desc: '' },
    ],
  },
  rendiciones: {
    name: 'rendiciones.csv',
    source: 'firestore',
    collection: 'rendiciones',
    rowMode: 'one_per_doc',
    columns: [
      { col: 'rendicion_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'owner_uid', type: 'string', desc: '' },
      { col: 'owner_email', type: 'string', desc: '' },
      { col: 'vendor', type: 'string', desc: '' },
      { col: 'tipo', type: 'string', desc: 'gasto | solicitud' },
      { col: 'tipo_gasto', type: 'string', desc: 'ej PEAJES, FACTURA A, GASTO CON COMPROBANTE' },
      { col: 'importe_ars', type: 'number', desc: 'monto ARS' },
      { col: 'fecha_gasto', type: 'iso8601', desc: 'YYYY-MM-DD del gasto' },
      { col: 'concepto', type: 'string', desc: 'descripcion libre' },
      { col: 'foto_ticket_url', type: 'string', desc: 'URL Firebase Storage v308+ (nunca base64)' },
      { col: 'status', type: 'string', desc: 'pending_approval | approved | rejected' },
      { col: 'approved_by', type: 'string', desc: 'email del aprobador o "self"' },
      { col: 'approved_at', type: 'iso8601', desc: '' },
      { col: 'rejected_by_email', type: 'string', desc: '' },
      { col: 'rejected_reason', type: 'string', desc: '' },
      { col: 'approver_uid', type: 'string', desc: 'UID responsable asignado' },
      { col: 'created_at', type: 'iso8601', desc: '' },
    ],
  },
  campanias: {
    name: 'campanias.csv',
    source: 'firestore',
    collection: 'campaigns',
    rowMode: 'one_per_doc',
    columns: [
      { col: 'campaign_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'name', type: 'string', desc: 'nombre campana' },
      { col: 'familia', type: 'string', desc: 'ej REELS' },
      { col: 'subfamilia', type: 'string', desc: 'ej MULTIPLICADORES' },
      { col: 'filter_type', type: 'string', desc: 'sku (hoy hardcoded)' },
      { col: 'filter_values_json', type: 'json_array', desc: 'copia de skus' },
      { col: 'skus_json', type: 'json_array', desc: 'ItemCodes incluidos' },
      { col: 'skus_count', type: 'int', desc: 'cantidad SKUs' },
      { col: 'target_type', type: 'string', desc: 'units | money' },
      { col: 'target_amount', type: 'number', desc: 'objetivo' },
      { col: 'start_date', type: 'iso8601', desc: 'YYYY-MM-DD' },
      { col: 'end_date', type: 'iso8601', desc: 'YYYY-MM-DD' },
      { col: 'scope', type: 'string', desc: 'all | province | vendor' },
      {
        col: 'scope_values_json',
        type: 'json_array',
        desc: 'provincias o vendor keys si scope != all',
      },
      { col: 'created_by', type: 'string', desc: 'UID admin/gerente' },
      { col: 'created_by_email', type: 'string', desc: '' },
      { col: 'created_at', type: 'iso8601', desc: '' },
      { col: 'archived_manually', type: 'boolean', desc: 'true=finalizada antes de endDate' },
      { col: 'archived_at', type: 'iso8601', desc: '' },
      { col: 'archived_by', type: 'string', desc: '' },
    ],
  },
  targets: {
    name: 'targets.csv',
    source: 'firestore',
    collection: 'targets',
    rowMode: 'one_per_doc',
    columns: [
      { col: 'target_id', type: 'string', desc: 'Firestore doc ID canonico {vendor}_{year}_{MM}' },
      { col: 'seller_id', type: 'string', desc: 'vendorKey uppercase ej GONZALO DE LA ROSA' },
      { col: 'year', type: 'int', desc: 'ej 2026' },
      { col: 'month', type: 'int', desc: '0-11 (indice del array MESES 0-indexed)' },
      { col: 'target_ars', type: 'number', desc: 'objetivo mes ARS (suma familias)' },
      { col: 'target_reel_ars', type: 'number', desc: 'v311+ desglose' },
      { col: 'target_canas_ars', type: 'number', desc: 'v311+ desglose' },
      { col: 'target_lineas_ars', type: 'number', desc: 'v311+ desglose' },
      { col: 'updated_at', type: 'iso8601', desc: '' },
      { col: 'updated_by', type: 'string', desc: 'UID' },
      { col: 'updated_by_email', type: 'string', desc: '' },
    ],
  },
  productos: {
    name: 'productos.csv',
    source: 'stock_json',
    rowMode: 'from_stock_json',
    columns: [
      { col: 'sku', type: 'string', desc: 'SKU (ItemCode SAP)' },
      { col: 'has_stock', type: 'boolean', desc: 'true=hay unidades en algun whs vendible' },
      { col: 'cantidad_total', type: 'int', desc: 'suma total whs vendibles (excluye 05 y 06)' },
      {
        col: 'disponible_venta_whs11',
        type: 'int',
        desc: 'v369+ Mercaderia NUR PESCA (venta directa)',
      },
      { col: 'transito_whs12', type: 'int', desc: 'v369+ En transito PESCA (backorder futuro)' },
      {
        col: 'otros_warehouses_json',
        type: 'json_object',
        desc: 'otros codigos con cantidad, ej {"98": 5}',
      },
      { col: 'source', type: 'string', desc: 'stock.json snapshot' },
      { col: 'snapshot_updated_at', type: 'iso8601', desc: 'timestamp del ultimo sync SAP' },
    ],
  },
  vendor_overrides: {
    name: 'vendor_overrides.csv',
    source: 'firestore',
    collection: 'vendor_overrides',
    rowMode: 'one_per_doc',
    columns: [
      { col: 'override_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'scope', type: 'string', desc: 'shop | loc' },
      { col: 'province', type: 'string', desc: '' },
      { col: 'locality_name', type: 'string', desc: '' },
      { col: 'client_name', type: 'string', desc: 'solo si scope=shop' },
      { col: 'original_vendor', type: 'string', desc: '' },
      { col: 'new_vendor', type: 'string', desc: '' },
      { col: 'new_type', type: 'string', desc: 'VDE | VDI | DISTRIBUIDOR | OTRO' },
      { col: 'updated_at', type: 'iso8601', desc: '' },
      { col: 'updated_by_uid', type: 'string', desc: '' },
      { col: 'updated_by_email', type: 'string', desc: '' },
      { col: 'updated_by_display_name', type: 'string', desc: '' },
    ],
  },
  custom_routes: {
    name: 'custom_routes.csv',
    source: 'firestore',
    collection: 'custom_routes',
    rowMode: 'flatten_stops', // 1 fila por (ruta, stop)
    columns: [
      { col: 'route_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'owner_uid', type: 'string', desc: 'duenio de la ruta' },
      { col: 'owner_email', type: 'string', desc: '' },
      { col: 'name', type: 'string', desc: 'nombre de la ruta' },
      { col: 'planned_date', type: 'iso8601', desc: 'YYYY-MM-DD' },
      { col: 'notes', type: 'string', desc: 'notas libres' },
      { col: 'created_at', type: 'iso8601', desc: '' },
      { col: 'updated_at', type: 'iso8601', desc: '' },
      { col: 'stop_order', type: 'int', desc: 'orden 0-based' },
      { col: 'stop_key', type: 'string', desc: 'clave compuesta tipo|prov|loc|cliente' },
      { col: 'stop_tipo', type: 'string', desc: 'C | P' },
      { col: 'stop_provincia', type: 'string', desc: '' },
      { col: 'stop_localidad', type: 'string', desc: '' },
      { col: 'stop_client_name', type: 'string', desc: '' },
      { col: 'stop_is_provisorio', type: 'boolean', desc: 'true=alta rapida sin CardCode' },
      { col: 'stop_sap_alta_id', type: 'string', desc: 'ID del client_applications si aplica' },
    ],
  },
  seguimiento_notes: {
    name: 'seguimiento_notes.csv',
    source: 'firestore',
    collection: 'seguimiento_notes',
    rowMode: 'one_per_doc',
    columns: [
      { col: 'note_id', type: 'string', desc: 'Firestore doc ID' },
      { col: 'vendor_ext', type: 'string', desc: 'VDE al que aplica la nota' },
      { col: 'client_key', type: 'string', desc: 'clave compuesta cliente' },
      { col: 'client_name', type: 'string', desc: '' },
      { col: 'province', type: 'string', desc: '' },
      { col: 'locality', type: 'string', desc: '' },
      { col: 'text', type: 'string', desc: 'texto libre de la nota' },
      { col: 'author_uid', type: 'string', desc: '' },
      { col: 'author_email', type: 'string', desc: '' },
      { col: 'author_name', type: 'string', desc: '' },
      { col: 'author_role', type: 'string', desc: 'admin | gerente | interno' },
      { col: 'created_at', type: 'iso8601', desc: '' },
    ],
  },
};

// ============================================================
// DATASET_USE_CASE_MATRIX — casos de uso ML con campos requeridos
// ============================================================

/** @typedef {{priority: number|string, description: string, requiredFields: Record<string, string[]>, joinNotes?: string}} UseCase */

/** @type {Record<string, UseCase>} */
export const DATASET_USE_CASE_MATRIX = {
  A_conversion_visita_pedido: {
    priority: 1,
    description: 'Predecir que visitas terminan en pedido para priorizar la ruta del vendedor.',
    requiredFields: {
      'visitas.csv': ['fecha', 'owner_uid', 'provincia', 'localidad', 'tienda'],
      'pedidos.csv': ['confirmed_at', 'owner_uid', 'province', 'loc_name', 'client_name'],
    },
    joinNotes:
      'JOIN por (provincia, localidad, tienda~client_name) en ventana temporal fecha_visita..confirmed_at. No hay cardCodeSap comun entre visits y pedidos.',
  },
  B_churn_clientes: {
    priority: 2,
    description: 'Detectar clientes que se enfrian antes de perderlos.',
    requiredFields: {
      'clientes.csv': ['created_at', 'assigned_vendor', 'provincia', 'status', 'card_code_sap'],
      'pedidos.csv': ['confirmed_at', 'client_name', 'province', 'loc_name'],
    },
    joinNotes:
      'JOIN via client_applications.card_code_sap vs pedidos.key (parseado). Fragil - considerar fuzzy match por nombre.',
  },
  C_forecast_sku: {
    priority: 3,
    description: 'Anticipar que productos se van a pedir por periodo.',
    requiredFields: {
      'pedidos.csv': ['line_code', 'line_qty', 'line_precio', 'confirmed_at', 'province'],
      'productos.csv': ['sku'],
    },
    joinNotes:
      'Descuento aplicado a nivel header (discount_pct) - prorratear en el pipeline downstream proporcional a subtotal_bruto de cada linea. Enriquecer con catalogo BQ (sap_items_raw) si hace falta cat/fam/sub adicional.',
  },
  D_anomalias_rendiciones: {
    priority: 'exploratorio',
    description: 'Detectar outliers de gastos.',
    requiredFields: {
      'rendiciones.csv': ['importe_ars', 'tipo_gasto', 'owner_uid', 'fecha_gasto', 'status'],
    },
  },
  E_estacionalidad_zona_categoria: {
    priority: 'exploratorio',
    description: 'Insumo para armado de campanias estacionales.',
    requiredFields: {
      'pedidos.csv': ['confirmed_at', 'province', 'line_code', 'line_fam', 'line_qty'],
      'clientes.csv': ['provincia', 'assigned_vendor'],
      'campanias.csv': ['start_date', 'end_date', 'skus_json', 'scope'],
      'targets.csv': ['year', 'month', 'target_ars'],
    },
  },
};

// ============================================================
// Row builders — funciones puras (doc -> array de rows)
// ============================================================

/**
 * Extrae valor Firestore de doc con path anidado. Devuelve raw (no CSV).
 * Ej: getField(doc, 'transferidoSAP.docNum')
 * @param {object} doc
 * @param {string} path
 */
function f(doc, path) {
  return getPath(doc, path);
}

/**
 * Row builder generico: mapea un doc a array de valores segun un array de paths.
 * @param {object} doc
 * @param {string[]} paths
 * @returns {unknown[]}
 */
function _buildRow(doc, paths) {
  return paths.map((p) => (p === '__id__' ? /** @type {any} */ (doc)._id : f(doc, p)));
}

/**
 * Pedidos: flatten 1 fila por linea. Header pedido replicado en cada.
 * doc._id es el ID; se espera que el caller lo agregue antes de pasar.
 * @param {any} doc
 * @returns {unknown[][]}
 */
export function buildPedidoRows(doc) {
  const header = [
    doc._id,
    doc.ownerUid,
    doc.ownerEmail,
    doc.createdByUid,
    doc.onBehalfOf,
    doc.key,
    doc.stage,
    doc.tipo,
    doc.province,
    doc.locName,
    doc.clientName,
    doc.month,
    doc.monthIdx,
    doc.year,
    doc.confirmedAt,
    doc.condicionPago,
    doc.formaEntrega ? doc.formaEntrega.tipo : null,
    doc.formaEntrega ? doc.formaEntrega.transpNombre : null,
    doc.formaEntrega ? doc.formaEntrega.transpDireccion : null,
    doc.formaEntrega ? doc.formaEntrega.clienteDireccion : null,
    doc.formaEntrega ? doc.formaEntrega.sucursalDireccion : null,
    doc.discountPct,
    doc.subtotalArs,
    doc.netAmountArs,
    doc.transferidoSAP ? doc.transferidoSAP.via : null,
    doc.transferidoSAP ? doc.transferidoSAP.docNum : null,
    doc.transferidoSAP ? doc.transferidoSAP.docEntry : null,
    doc.transferidoSAP ? doc.transferidoSAP.at : null,
    doc.createdAt,
  ];
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  if (!lines.length) {
    // Pedido sin lineas -> 1 fila con line_* vacios
    return [header.concat([null, null, null, null, null, null, null, null])];
  }
  return lines.map((/** @type {any} */ l, /** @type {number} */ idx) =>
    header.concat([
      idx,
      l ? l.code : null,
      l ? l.desc : null,
      l ? l.qty : null,
      l ? l.precio : null,
      l ? l.cat : null,
      l ? l.fam : null,
      l ? l.sub : null,
    ])
  );
}

/** @param {any} doc @returns {unknown[][]} */
export function buildVisitaRows(doc) {
  return [
    [
      doc._id,
      doc.ownerUid,
      doc.ownerEmail,
      doc.fecha,
      doc.mes,
      doc.anio,
      doc.vendor,
      doc.provincia,
      doc.localidad,
      doc.tienda,
      doc.tipo,
      doc.local,
      doc.tamano,
      doc.fidelidad,
      doc.relevancia,
      doc.pop,
      doc.necesidadPuntual,
      doc.tipoVenta,
      doc.ponderacionMostrado,
      doc.ponderacionEcommerce,
      doc.competencia,
      doc.oportunidad,
      doc.masVendido,
      doc.masPreguntan,
      doc.ayudaTienda,
      doc.gpsStatus,
      doc.gpsDistanceM,
      doc.interactionType,
      doc.formaContacto,
      doc.contactoResultado,
      doc.contactoResultadoAt,
      doc.contactoResultadoBy,
      doc.createdAt,
    ],
  ];
}

/** @param {any} doc @returns {unknown[][]} */
export function buildClienteRows(doc) {
  return [
    [
      doc._id,
      doc.ownerUid,
      doc.ownerEmail,
      doc.ownerName,
      doc.comercio,
      doc.fantasia,
      doc.cuit,
      doc.condicionFiscal,
      doc.calle,
      doc.numero,
      doc.localidad,
      doc.provincia,
      doc.localidadFinal,
      doc.cardCodeSap,
      doc.assignedVendor,
      doc.status,
      doc.source,
      doc.manualSapPending,
      doc.precaucion,
      doc.categoriaCliente,
      doc.cliTipo,
      doc.lat,
      doc.lng,
      doc.lat != null && doc.lng != null,
      !!(doc.calle || doc.address),
      doc.submittedByPublicForm,
      doc.approvedAt,
      doc.createdAt,
      doc.updatedAt,
    ],
  ];
}

/** @param {any} doc @returns {unknown[][]} */
export function buildClientMasterRows(doc) {
  return [
    [
      doc._id,
      doc.clientName,
      doc.provincia,
      doc.localidad,
      doc.vendor,
      doc.address,
      doc.sapCardCode,
      doc.sapAddress,
      doc.sapCity,
      doc.sapState,
      doc.sapImportedAt,
      doc.sapImportedBy,
      doc.clientNameOriginal,
      doc.localidadOriginal,
      doc.matchType,
      doc.matchSimilarity,
      doc.updatedAt,
      doc.updatedBy,
    ],
  ];
}

/** @param {any} doc @returns {unknown[][]} */
export function buildRendicionRows(doc) {
  return [
    [
      doc._id,
      doc.ownerUid,
      doc.ownerEmail,
      doc.vendor,
      doc.tipo,
      doc.tipoGasto,
      doc.importeArs != null ? doc.importeArs : doc.importe,
      doc.fechaGasto,
      doc.concepto,
      // fotoTicketUrl (v308+) prioridad; NUNCA exportar base64 fotoTicket legacy
      doc.fotoTicketUrl || null,
      doc.status,
      doc.approvedBy,
      doc.approvedAt,
      doc.rejectedByEmail,
      doc.rejectedReason,
      doc.approverUid,
      doc.createdAt,
    ],
  ];
}

/** @param {any} doc @returns {unknown[][]} */
export function buildCampaniaRows(doc) {
  return [
    [
      doc._id,
      doc.name,
      doc.familia,
      doc.subfamilia,
      doc.filterType,
      doc.filterValues,
      doc.skus,
      Array.isArray(doc.skus) ? doc.skus.length : 0,
      doc.targetType,
      doc.targetAmount,
      doc.startDate,
      doc.endDate,
      doc.scope,
      doc.scopeValues,
      doc.createdBy,
      doc.createdByEmail,
      doc.createdAt,
      doc.archivedManually,
      doc.archivedAt,
      doc.archivedBy,
    ],
  ];
}

/** @param {any} doc @returns {unknown[][]} */
export function buildTargetRows(doc) {
  return [
    [
      doc._id,
      doc.sellerId,
      doc.year,
      doc.month,
      doc.targetArs,
      doc.targetByFamily ? doc.targetByFamily.REEL : null,
      doc.targetByFamily ? doc.targetByFamily.CANAS : null,
      doc.targetByFamily ? doc.targetByFamily.LINEAS : null,
      doc.updatedAt,
      doc.updatedBy,
      doc.updatedByEmail,
    ],
  ];
}

/** @param {any} doc @returns {unknown[][]} */
export function buildVendorOverrideRows(doc) {
  return [
    [
      doc._id,
      doc.scope,
      doc.province,
      doc.localityName,
      doc.clientName,
      doc.originalVendor,
      doc.newVendor,
      doc.newType,
      doc.updatedAt,
      doc.updatedByUid,
      doc.updatedByEmail,
      doc.updatedByDisplayName,
    ],
  ];
}

/** @param {any} doc @returns {unknown[][]} */
export function buildCustomRouteRows(doc) {
  const header = [
    doc._id,
    doc.ownerUid,
    doc.ownerEmail,
    doc.name,
    doc.plannedDate,
    doc.notes,
    doc.createdAt,
    doc.updatedAt,
  ];
  const stops = Array.isArray(doc.stops) ? doc.stops : [];
  if (!stops.length) {
    return [header.concat([null, null, null, null, null, null, null, null])];
  }
  return stops.map((/** @type {any} */ s) =>
    header.concat([
      s ? s.order : null,
      s ? s.key : null,
      s ? s.tipo : null,
      s ? s.provincia : null,
      s ? s.localidad : null,
      s ? s.clientName : null,
      s ? s.isProvisorio : null,
      s ? s.sapAltaId : null,
    ])
  );
}

/** @param {any} doc @returns {unknown[][]} */
export function buildSeguimientoNoteRows(doc) {
  return [
    [
      doc._id,
      doc.vendorExt,
      doc.clientKey,
      doc.clientName,
      doc.province,
      doc.locality,
      doc.text,
      doc.authorUid,
      doc.authorEmail,
      doc.authorName,
      doc.authorRole,
      doc.createdAt,
    ],
  ];
}

/**
 * Productos desde stock.json (formato Shimano: {stock: {SKU: bool, ...},
 * quantities: JSON string, warehouseBreakdown: JSON string, updatedAt: ...}).
 * @param {object} stockJson
 * @returns {unknown[][]}
 */
export function buildProductoRowsFromStockJson(stockJson) {
  const sj = /** @type {any} */ (stockJson) || {};
  const stockMap = sj.stock || {};
  /** @type {Record<string, number>} */
  let quantities = {};
  /** @type {Record<string, Record<string, number>>} */
  let breakdown = {};
  try {
    quantities = sj.quantities ? JSON.parse(sj.quantities) : sj.quantities_map || {};
  } catch (_) {}
  try {
    breakdown = sj.warehouseBreakdown
      ? JSON.parse(sj.warehouseBreakdown)
      : sj.warehouseBreakdown_map || {};
  } catch (_) {}
  const rows = /** @type {unknown[][]} */ ([]);
  const source = 'stock.json snapshot';
  const updatedAt = sj.updatedAt || sj.snapshotAt || null;
  for (const sku of Object.keys(stockMap)) {
    const has_stock = !!stockMap[sku];
    const total = Number(quantities[sku] || 0);
    const wbs = breakdown[sku] || {};
    const w11 = Number(wbs['11'] || 0);
    const w12 = Number(wbs['12'] || 0);
    /** @type {Record<string, number>} */
    const otros = {};
    for (const k of Object.keys(wbs)) {
      if (k !== '11' && k !== '12') otros[k] = Number(wbs[k] || 0);
    }
    rows.push([
      sku,
      has_stock,
      total,
      w11,
      w12,
      Object.keys(otros).length ? otros : null,
      source,
      updatedAt,
    ]);
  }
  return rows;
}

// ============================================================
// Dispatcher: mapa collection -> row builder
// ============================================================

/** @type {Record<string, (doc: any) => unknown[][]>} */
export const ROW_BUILDERS = {
  pedidos: buildPedidoRows,
  visitas: buildVisitaRows,
  clientes: buildClienteRows,
  client_master: buildClientMasterRows,
  rendiciones: buildRendicionRows,
  campanias: buildCampaniaRows,
  targets: buildTargetRows,
  vendor_overrides: buildVendorOverrideRows,
  custom_routes: buildCustomRouteRows,
  seguimiento_notes: buildSeguimientoNoteRows,
};
