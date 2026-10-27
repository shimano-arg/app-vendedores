// @ts-check
/**
 * ficha-cliente-labels (v1482, 2026-10-27) — fuente única de labels y
 * compose-row para los campos de la Ficha Cliente (modal
 * #ficha-cliente-modal, pestañas Clasificación + Buyer).
 *
 * Mariano v1482: reusar en Masterfile export + Análisis de Cartera por
 * Vendedor para no duplicar el mapeo de etiquetas. Los labels son los
 * EXACTOS que aparecen en los `<option>` del modal (ver index.html:5919+).
 *
 * Regla de llenado: si el cliente tiene el dato, va el valor tal cual se
 * muestra en la Ficha ("B - sin descuento", no el código "B"); si no lo
 * tiene, va "-". Ninguna celda queda vacía.
 *
 * Fuentes:
 *   - cmData = client_master/{docId}: cliTipo, fidelidad, prefContacto,
 *     tamano, especializacion, tipoLocal, creditoCheque (campos de la
 *     pestaña Clasificación de la Ficha).
 *   - buyerStats = client_buyer_stats/{cardCode}: stats_12m con montoTotal,
 *     facturasCount, montoPromedio, frecuenciaDias, facturasPorMes,
 *     ultimaCompra, diasDesdeUltima, primeraCompra (pestaña Buyer, ventana
 *     por default 12 meses — misma que arranca el modal).
 */

/**
 * Labels de los selects de la pestaña Clasificación. Mapea código interno
 * (lo que se persiste en Firestore) → label legible (lo que muestra el
 * modal). Fuente: index.html:5919-5977 (option values + display text).
 *
 * Opción "" (sin clasificar) NO se mapea acá — se trata como "sin valor"
 * en labelForFichaField → devuelve "-".
 */
export const FICHA_CLASIF_LABELS = Object.freeze({
  cliTipo: Object.freeze({
    P: 'P (Premium) - fijo 6% / anticipado 5%',
    A: 'A - fijo 3% / anticipado 3%',
    B: 'B - sin descuento',
    C: 'C - sin descuento',
  }),
  fidelidad: Object.freeze({
    ALTA: 'Alta',
    MEDIA: 'Media',
    BAJA: 'Baja',
  }),
  prefContacto: Object.freeze({
    CALL_CENTER: 'Call Center',
    PRESENCIAL: 'Presencial',
    AMBOS: 'Ambos',
    AUTOGESTION_B2B: 'Autogestión (B2B)',
  }),
  tamano: Object.freeze({
    GRANDE: 'Grande',
    MEDIANO: 'Mediano',
    CHICA: 'Chica',
    LODGE: 'Lodge',
    GUIA_DE_PESCA: 'Guía de pesca',
    VENTAS_ESPECIALES: 'Ventas especiales',
  }),
  especializacion: Object.freeze({
    AGUA_DULCE: 'Agua dulce',
    PESCA_DE_MAR: 'Pesca de mar',
    ALTA_GAMA: 'Alta gama',
    BAJA_GENERAL: 'Baja - General',
  }),
  tipoLocal: Object.freeze({
    FISICO: 'Físico',
    ECOMMERCE: 'E-commerce',
  }),
});

/**
 * Devuelve el label legible de un campo de la Ficha. Si el value está
 * vacío/null/undefined o no mapeado, devuelve "-".
 *
 * @param {string} field  nombre del campo (cliTipo, fidelidad, ...).
 * @param {string | null | undefined} value  valor persistido en Firestore.
 * @returns {string}
 */
export function labelForFichaField(field, value) {
  if (value === null || value === undefined || value === '') return '-';
  const map = /** @type {Record<string, Record<string, string>>} */ (FICHA_CLASIF_LABELS)[field];
  if (!map) return '-';
  const key = String(value).toUpperCase();
  return map[key] || '-';
}

/**
 * Busca el doc `client_master` que corresponde a un cardCode SAP.
 * Scan `clientMasterCache` por `sapCardCode` OR `cardCodeSap` (ambos aliases
 * aparecen en prod según el flow que creó el doc).
 *
 * **Por qué existe (v1485 §84, 2026-10-27 bug fix)**: en v1482 el export
 * buscaba `clientMasterCache.get(clientLocId(point.province, point.name, name))`
 * — slug derivado del padrón POINTS. Para clientes como ALBERTO MAXERA, el
 * POINTS dice `name="Palermo (C14)"` pero la Ficha persiste con
 * `localidad="COLEGIALES"` → genera docId distinto → cmData undefined → los
 * 6 campos salían "-" aunque la Ficha estaba cargada. `sapCardCode` es único
 * y SIEMPRE identifica el doc correcto. Pattern ya existente en
 * `index.html:_resolveVendorFallback` (línea 15788+).
 *
 * @param {string | null | undefined} cardCode  ej. "C20110561068".
 * @param {Map<string, any> | null | undefined} clientMasterCache
 * @returns {any | null}  cmData o null si no se encuentra / cardCode vacío.
 */
export function findCmDataByCardCode(cardCode, clientMasterCache) {
  const cc = String(cardCode || '').trim();
  if (!cc || !clientMasterCache || typeof clientMasterCache.forEach !== 'function') {
    return null;
  }
  // Scan TODOS los docs con el cardCode (puede haber duplicados: uno
  // importado SAP sin Ficha + otro con Ficha populated). Preferir el que
  // tiene al menos un campo Ficha populated. Caso MAXERA: hay 2 docs; el
  // slug SAP-import no tiene campos Ficha, el slug Ficha sí.
  /** @type {Array<any>} */
  const candidates = [];
  clientMasterCache.forEach((cmData) => {
    if (!cmData) return;
    const cc1 = String(cmData.sapCardCode || '').trim();
    const cc2 = String(cmData.cardCodeSap || '').trim();
    if (cc1 === cc || cc2 === cc) {
      candidates.push(cmData);
    }
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Múltiples docs: preferir el que tenga al menos UN campo Ficha populated.
  const FICHA_FIELDS = [
    'cliTipo',
    'fidelidad',
    'prefContacto',
    'tamano',
    'especializacion',
    'tipoLocal',
    'creditoCheque',
  ];
  for (const c of candidates) {
    for (const f of FICHA_FIELDS) {
      if (c[f] !== null && c[f] !== undefined && c[f] !== '') {
        return c;
      }
    }
  }
  // Ninguno tiene Ficha populated → devolver el primero (ambos equivalentes).
  return candidates[0];
}

/**
 * Compone la fila de columnas de la pestaña Clasificación para un cliente.
 * Nombres de columnas exactos como pide Mariano en el pedido. Celdas vacías
 * se completan con "-".
 *
 * @param {any} cmData  client_master/{docId}.data()
 * @returns {Object<string, string | number>}
 */
export function fichaClienteClasifRow(cmData) {
  const d = cmData || {};
  const credito = d.creditoCheque;
  const creditoNum = credito != null && credito !== '' ? Number(credito) : null;
  return {
    'Tipo de cliente': labelForFichaField('cliTipo', d.cliTipo),
    Fidelidad: labelForFichaField('fidelidad', d.fidelidad),
    'Preferencia de contacto': labelForFichaField('prefContacto', d.prefContacto),
    Tamaño: labelForFichaField('tamano', d.tamano),
    Especialización: labelForFichaField('especializacion', d.especializacion),
    'Tipo de local': labelForFichaField('tipoLocal', d.tipoLocal),
    'Crédito cheque (ARS)':
      creditoNum != null && Number.isFinite(creditoNum) && creditoNum > 0
        ? Math.round(creditoNum)
        : '-',
  };
}

/**
 * Compone la fila de columnas de la pestaña Buyer para un cliente.
 * Ventana default 12m (la que arranca el modal; ver _fcBuyerCurrentPeriod).
 * Mariano: si el valor no existe, va "-".
 *
 * @param {any} buyerStats  client_buyer_stats/{cardCode}.data()
 * @param {string} [period]  '3m' | '6m' | '12m' | '24m'. Default '12m'.
 * @returns {Object<string, string | number>}
 */
export function fichaClienteBuyerRow(buyerStats, period) {
  const p = period || '12m';
  const bs = buyerStats || {};
  const stats = /** @type {any} */ (bs)['stats_' + p] || {};
  const monto = Number(stats.montoTotal) || 0;
  const facturas = Number(stats.facturasCount) || 0;
  const promedio = Number(stats.montoPromedio) || 0;
  const frec = stats.frecuenciaDias;
  const facxMes = stats.facturasPorMes;
  const dias = stats.diasDesdeUltima;
  return {
    'Monto total (12m)': monto > 0 ? Math.round(monto) : '-',
    'Facturas (12m)': facturas > 0 ? facturas : '-',
    'Promedio por factura (12m)': promedio > 0 ? Math.round(promedio) : '-',
    'Frecuencia (días entre compras)':
      frec != null && Number.isFinite(Number(frec)) ? Math.round(Number(frec)) : '-',
    'Facturas por mes (12m)':
      facxMes != null && Number.isFinite(Number(facxMes))
        ? Math.round(Number(facxMes) * 10) / 10
        : '-',
    'Primera compra': stats.primeraCompra || '-',
    'Última compra': stats.ultimaCompra || '-',
    'Días desde última compra':
      dias != null && Number.isFinite(Number(dias)) ? Math.round(Number(dias)) : '-',
  };
}

/**
 * Reemplaza cada celda vacía (null / undefined / '' / 0 cuando el campo
 * requiere valor significativo) por "-". Centraliza la regla de Mariano
 * "ninguna celda queda vacía, en ninguna columna, incluidas las que ya
 * existen".
 *
 * Excepción: campos numéricos listados en `numericZeroOk` conservan 0.
 * Hoy ninguno; se deja la hook por si en el futuro aparece "Total visitas".
 *
 * @param {any} row
 * @param {Set<string>} [numericZeroOk]
 * @returns {Object<string, any>}
 */
export function fillDashInEmpty(row, numericZeroOk) {
  const ok = numericZeroOk instanceof Set ? numericZeroOk : new Set();
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of Object.keys(row || {})) {
    const v = row[k];
    if (v === null || v === undefined || v === '') {
      out[k] = '-';
    } else if (v === 0 && !ok.has(k)) {
      out[k] = '-';
    } else {
      out[k] = v;
    }
  }
  return out;
}
