// @ts-check
/**
 * Tarea L (v1457, 2026-10-25) — Textos UI para "entrada del backorder".
 *
 * Un solo punto para editar en un PR de 5 min SIN tocar lógica. Todo lo que
 * ve el vendedor sale de acá. Idioma: castellano rioplatense simple, nada
 * de jerga ("backorder", "reconciliar", "unificar"). Palabras permitidas:
 * "esperando stock", "pedido", "producto".
 *
 * Pure: todas las funciones devuelven strings sin side-effects.
 *
 * Wireframes ASCII (ver también docs/plans/2026-10-25-l-bo-entry.md):
 *
 *   Fila roja (modal review #wcard-rows):
 *   | SKU   | Desc      | Stock | Pedido | ... |
 *   | 1234  | TORNILLO  | 0     | 20 ⚠   | ... |   ← fila ROJA
 *   |   > Este cliente ya tiene 20 unidades de este producto esperando
 *   |     stock desde el 12/10. ¿Las 20 que cargaste son las mismas o
 *   |     son 20 más? [?]
 *   |     [Son las mismas (quedan 20)]  [Son 20 más (quedan 40)]
 *
 *   Contador Pasar a Pendientes:
 *   ┌─────────────────────────────────────────────────┐
 *   │  ↓ Te faltan 2 productos por revisar            │
 *   │  [ Pasar a Pendientes ]  (deshabilitado)        │
 *   └─────────────────────────────────────────────────┘
 *
 *   Cartel Excel idéntico:
 *   ┌────────────────────────────────────────────────┐
 *   │  Este Excel es igual al pedido N° 435 que ya   │
 *   │  está cargado desde el 12/10. ¿Es el mismo     │
 *   │  pedido?                                       │
 *   │                                                │
 *   │  [ Sí, no cargar nada ]  [ No, cargarlo igual ]│
 *   └────────────────────────────────────────────────┘
 *
 * Convención: todas las funciones son `fn(args) -> string`. Si se agrega
 * un nuevo texto, agregarlo acá primero y referenciarlo desde el consumer.
 */

/**
 * @param {{cantidad: number, fechaCorta?: string}} args fechaCorta ya
 *   formateada DD/MM (si no, "sin fecha").
 * @returns {string}
 */
export function filaRojaOracion(args) {
  const cantidad = Number(args.cantidad) || 0;
  const fecha = args.fechaCorta ? args.fechaCorta : 'sin fecha';
  return (
    'Este cliente ya tiene ' +
    cantidad +
    ' unidades de este producto esperando stock desde el ' +
    fecha +
    '. ¿Las ' +
    cantidad +
    ' que cargaste son las mismas o son ' +
    cantidad +
    ' más?'
  );
}

/**
 * Botón izquierdo (preseleccionado). "same".
 * @param {{cantidad: number}} args
 * @returns {string}
 */
export function botonSonLasMismas(args) {
  const cantidad = Number(args.cantidad) || 0;
  return 'Son las mismas (quedan ' + cantidad + ')';
}

/**
 * Botón derecho. "additional".
 * @param {{cantidad: number, total: number}} args
 * @returns {string}
 */
export function botonSonMas(args) {
  const cantidad = Number(args.cantidad) || 0;
  const total = Number(args.total) || 0;
  return 'Son ' + cantidad + ' más (quedan ' + total + ')';
}

/**
 * Tooltip del ícono "?" de la fila roja.
 * @returns {string}
 */
export function ayudaFilaRoja() {
  return (
    'Este cliente ya cargó unidades de este producto que están esperando ' +
    'stock. Elegí si lo que cargaste ahora son las mismas (se reemplazan) ' +
    'o son unidades extra (se suman).'
  );
}

/**
 * Contador debajo de la tabla cuando hay rojas sin resolver. Lleva al VDE
 * a la primera fila roja al tocarlo.
 * @param {{faltan: number}} args
 * @returns {string}
 */
export function contadorFilasRojas(args) {
  const n = Number(args.faltan) || 0;
  if (n === 1) return 'Te falta 1 producto por revisar';
  return 'Te faltan ' + n + ' productos por revisar';
}

/**
 * Oración del cartel Excel idéntico.
 * @param {{orderNumber: number|string, fechaCorta?: string}} args
 * @returns {string}
 */
export function excelIdenticoOracion(args) {
  const num = String(args.orderNumber || '?');
  const fecha = args.fechaCorta ? args.fechaCorta : 'sin fecha';
  return (
    'Este Excel es igual al pedido N° ' +
    num +
    ' que ya está cargado desde el ' +
    fecha +
    '. ¿Es el mismo pedido?'
  );
}

/** Botón del cartel Excel idéntico — cancelar carga. */
export function botonExcelCancelar() {
  return 'Sí, no cargar nada';
}

/** Botón del cartel Excel idéntico — seguir con la carga igual. */
export function botonExcelSeguir() {
  return 'No, cargarlo igual';
}

/**
 * Mensaje del CF cuando el payload llegó con filas rojas sin resolver (bug
 * del cliente: no deberían llegar al CF). Español simple para el VDE.
 * @returns {string}
 */
export function cfErrorFilasRojasSinResolver() {
  return 'Tenés productos marcados en rojo sin revisar. Elegí para cada uno si son las mismas unidades o son más.';
}

/**
 * Format DD/MM desde ISO string o Date. Pure. En es-AR.
 * @param {string | Date | null | undefined} iso
 * @returns {string} "" si no se puede parsear.
 */
export function formatFechaCorta(iso) {
  if (!iso) return '';
  let d;
  if (iso instanceof Date) d = iso;
  else if (typeof iso === 'string') d = new Date(iso);
  else return '';
  if (!d || Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm;
}

/**
 * Exports agrupados (para `window.__phase0.pure.boEntry`).
 */
export const L_BO_ENTRY_TEXTS = {
  filaRojaOracion,
  botonSonLasMismas,
  botonSonMas,
  ayudaFilaRoja,
  contadorFilasRojas,
  excelIdenticoOracion,
  botonExcelCancelar,
  botonExcelSeguir,
  cfErrorFilasRojasSinResolver,
  formatFechaCorta,
};
