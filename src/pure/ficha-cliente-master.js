// @ts-check
/**
 * ficha-cliente-master.js (v1539, 2026-11-02, APP-04)
 *
 * Arma los bloques de la ficha desplegable de un cliente en el Master de
 * Clientes a partir de los datos que la app ya tiene. Función pura: no lee
 * Firestore ni escribe nada. El que la llama le pasa los documentos.
 *
 * Inventario de campos y fuentes: docs/auditoria/47_FICHA_CLIENTE_MASTER.md.
 *
 * Reglas:
 *   - Campos importantes sin dato → «Sin información registrada».
 *   - Campos secundarios sin dato → no se muestran.
 *   - Datos que todavía se están pidiendo (undefined) → «Cargando…».
 *   - Si el mismo dato está en varios lugares, gana la fuente indicada en el
 *     informe 47 (sección 3).
 */

import { FICHA_CLASIF_LABELS } from './ficha-cliente-labels.js';

export const SIN_INFO = 'Sin información registrada';
export const CARGANDO = 'Cargando…';

/**
 * @typedef {Object} FichaRow
 * @property {string} label
 * @property {string} value
 * @property {'empty'|'loading'|''} [state]
 */

/**
 * @typedef {Object} FichaSection
 * @property {string} key
 * @property {string} title
 * @property {FichaRow[]} rows
 * @property {string} [note]
 */

/**
 * @typedef {Object} FichaInput
 * @property {{nombre?: string, localidad?: string, provincia?: string, vendor?: string, tipo?: string, sapCardCode?: string}} entry
 * @property {string} [displayName]
 * @property {string} [vendorLabel]
 * @property {any} [alta]       client_applications (filas sap_alta) o null.
 * @property {any} [cm]         client_master/{slug} o null.
 * @property {any} [meta]       userData.clientMeta del usuario actual o null.
 * @property {string} [cardCode]
 * @property {string} [sapCodeFallback]  sapGetClienteCode(nombre).
 * @property {any} [loc]        client_locations/{slug}; undefined = cargando.
 * @property {any} [buyer]      client_buyer_stats/{cardCode}; undefined = cargando.
 * @property {any} [cartera]    fila del cliente en cartera_vendor/{vendor}.clientes; undefined = cargando.
 */

/** @param {any} v */
function txt(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v).trim();
}

/** @param {...any} vals */
function first(...vals) {
  for (const v of vals) {
    const t = txt(v);
    if (t && t !== '(sin localidad)' && t !== '(sin provincia)') return t;
  }
  return '';
}

/**
 * Fecha legible dd/mm/aaaa desde Timestamp, {seconds}, Date, ISO string.
 * @param {any} v
 * @returns {string}
 */
export function fmtFecha(v) {
  if (!v) return '';
  let d = null;
  try {
    if (typeof v.toDate === 'function') d = v.toDate();
    else if (typeof v.seconds === 'number') d = new Date(v.seconds * 1000);
    else if (v instanceof Date) d = v;
    else if (typeof v === 'string' || typeof v === 'number') d = new Date(v);
  } catch (_e) {
    d = null;
  }
  if (!d || Number.isNaN(d.getTime())) return typeof v === 'string' ? v : '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + '/' + d.getFullYear();
}

/**
 * Pesos con separador de miles: $ 1.234.567.
 * @param {any} n
 * @returns {string}
 */
export function fmtArs(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  const s = Math.round(x)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return x < 0 ? '-$ ' + s.replace('-', '') : '$ ' + s;
}

/**
 * Agrega una fila. `important` → si no hay valor, muestra SIN_INFO; si no es
 * importante y no hay valor, no la agrega.
 * @param {FichaRow[]} rows
 * @param {string} label
 * @param {string} value
 * @param {boolean} [important]
 */
function add(rows, label, value, important) {
  if (value) rows.push({ label, value, state: '' });
  else if (important) rows.push({ label, value: SIN_INFO, state: 'empty' });
}

/**
 * @param {FichaRow[]} rows
 * @param {string} label
 */
function addLoading(rows, label) {
  rows.push({ label, value: CARGANDO, state: 'loading' });
}

/** @param {string} field @param {any} v */
function clasif(field, v) {
  const map = /** @type {Record<string, Record<string,string>>} */ (FICHA_CLASIF_LABELS)[field];
  const t = txt(v);
  if (!t) return '';
  return (map && map[t]) || t;
}

const ENTREGA_TIPOS = Object.freeze({
  TRANSPORTISTA: 'Entrega a transportista',
  SUCURSAL: 'Envío a sucursal',
  RETIRO_DEPOSITO: 'Retiro en el depósito',
});

/**
 * Arma la ficha completa.
 * @param {FichaInput} input
 * @returns {FichaSection[]}
 */
export function buildFichaClienteMaster(input) {
  const i = input || /** @type {FichaInput} */ ({ entry: {} });
  const e = i.entry || {};
  const a = i.alta || null;
  const cm = i.cm || null;
  const meta = i.meta || null;
  const isSap = e.tipo === 'sap_alta';

  /** @type {FichaSection[]} */
  const out = [];

  // ---------- IDENTIFICACIÓN ----------
  /** @type {FichaRow[]} */
  const ident = [];
  const cardCode = first(i.cardCode, a && a.cardCodeSap, cm && cm.sapCardCode, i.sapCodeFallback);
  add(ident, 'Nombre comercial', first(a && a.fantasia, i.displayName, e.nombre), true);
  add(ident, 'Razón social', first(a && a.comercio, cm && cm.clientName), true);
  if (cm && cm.clientNameOriginal && txt(cm.clientNameOriginal) !== txt(cm.clientName))
    add(ident, 'Nombre en el padrón', txt(cm.clientNameOriginal));
  add(ident, 'Código SAP', cardCode, true);
  add(ident, 'CUIT', first(a && a.cuit), true);
  add(ident, 'Condición fiscal', first(a && a.condicionFiscal));
  add(ident, 'Tipo de cliente', clasif('cliTipo', first(cm && cm.cliTipo, a && a.cliTipo)), true);
  const regLabel =
    e.tipo === 'sap_alta'
      ? cardCode
        ? 'Alta SAP'
        : 'Provisorio (sin código SAP)'
      : e.tipo === 'prospecto'
        ? 'Prospecto del padrón'
        : 'Cliente del padrón';
  add(ident, 'Registro en la app', regLabel);
  if (a) {
    add(ident, 'Tipo en SAP', first(a.sapCardType));
    if (a.sapValid !== undefined || a.sapFrozen !== undefined) {
      const est = [];
      if (a.sapValid !== undefined) est.push(a.sapValid ? 'Activo' : 'Inactivo');
      if (a.sapFrozen) est.push('Bloqueado');
      add(ident, 'Estado en SAP', est.join(' · '));
    }
    add(ident, 'División SAP', first(a.sapDivision));
    add(ident, 'Última actualización en SAP', fmtFecha(a.sapUpdateDate));
  }
  out.push({ key: 'identificacion', title: 'Identificación', rows: ident });

  // ---------- INFORMACIÓN COMERCIAL ----------
  /** @type {FichaRow[]} */
  const com = [];
  add(com, 'Vendedor asignado', first(i.vendorLabel, e.vendor), true);
  if (a) add(com, 'Vendedor según SAP (código)', first(a.sapSalesPersonCode));
  add(com, 'Fecha de alta', fmtFecha(a && a.createdAt), isSap);
  if (a) {
    const st = { pending_approval: 'Pendiente de aprobación', approved: 'Aprobada' };
    const sv = txt(a.status);
    add(com, 'Estado del alta', /** @type {Record<string,string>} */ (st)[sv] || sv);
    add(com, 'Estado del lead', first(a.leadEstado));
    add(com, 'Origen del alta', first(a.source === 'sap_sync' ? 'Sincronización SAP' : a.source));
    add(com, 'Tipo de comercio', first(a.tipoComercio));
    add(com, 'Tienda online', first(a.tiendaOnline));
    add(com, 'Web', first(a.web));
    add(com, 'Redes', first(a.redes));
  }
  if (cm) {
    add(com, 'Fidelidad', clasif('fidelidad', cm.fidelidad));
    add(com, 'Tamaño', clasif('tamano', cm.tamano));
    add(com, 'Especialización', clasif('especializacion', cm.especializacion));
    add(com, 'Tipo de local', clasif('tipoLocal', cm.tipoLocal));
    add(com, 'Preferencia de contacto', clasif('prefContacto', cm.prefContacto));
    if (cm.creditoCheque !== undefined && cm.creditoCheque !== null && cm.creditoCheque !== '')
      add(com, 'Crédito en cheques', fmtArs(cm.creditoCheque));
  }
  const prec = a && a.precaucion ? a : meta && meta.precaucion ? meta : null;
  if (prec) add(com, 'Precaución', first(prec.precaucionReason) || 'Sí');
  if (meta && meta.envioGratis) add(com, 'Envío gratis', 'Sí');
  const lv = cm && cm.lastVisit;
  if (lv) {
    const quien = first(lv.byDisplayName);
    add(com, 'Última visita', [fmtFecha(lv.fecha), quien].filter(Boolean).join(' · '));
    add(com, 'Canal de compra (visita)', first(lv.canalCompra));
    add(com, 'Tipo de venta (visita)', first(lv.tipoVenta));
  }
  // Ventas (client_buyer_stats, 12 meses).
  if (cardCode) {
    if (i.buyer === undefined) addLoading(com, 'Ventas últimos 12 meses');
    else {
      const s = i.buyer && (i.buyer.stats_12m || null);
      if (s && Number(s.facturasCount) > 0) {
        add(
          com,
          'Ventas últimos 12 meses',
          fmtArs(s.montoTotal) + ' en ' + s.facturasCount + ' factura(s)'
        );
        add(com, 'Primera compra (12 meses)', fmtFecha(s.primeraCompra));
        add(com, 'Última compra', fmtFecha(s.ultimaCompra));
        if (Array.isArray(s.topSkus) && s.topSkus.length)
          add(
            com,
            'Productos más comprados',
            s.topSkus
              .slice(0, 3)
              .map((/** @type {any} */ t) => t.sku)
              .filter(Boolean)
              .join(', ')
          );
      } else add(com, 'Ventas últimos 12 meses', SIN_INFO);
    }
  }
  // Cartera (deuda).
  if (i.cartera === undefined) addLoading(com, 'Deuda abierta');
  else if (i.cartera) {
    const c = i.cartera;
    if (c.deudaAbierta !== undefined && c.deudaAbierta !== null)
      add(com, 'Deuda abierta', fmtArs(c.deudaAbierta) || '$ 0');
    if (c.facturado12M !== undefined && c.facturado12M !== null && !(i.buyer && i.buyer.stats_12m))
      add(com, 'Facturado 12 meses', fmtArs(c.facturado12M));
    if (c.diasSinCompra !== undefined && c.diasSinCompra !== null)
      add(com, 'Días sin compra', txt(c.diasSinCompra));
  }
  out.push({ key: 'comercial', title: 'Información comercial', rows: com });

  // ---------- UBICACIÓN ----------
  /** @type {FichaRow[]} */
  const ubi = [];
  add(ubi, 'Provincia', first(a && a.provincia, e.provincia, cm && cm.sapState), true);
  add(
    ubi,
    'Localidad',
    first(a && a.localidadFinal, a && a.localidad, e.localidad, cm && cm.sapCity),
    true
  );
  const calle = a ? [txt(a.calle), txt(a.numero)].filter(Boolean).join(' ') : '';
  const dir = isSap ? first(calle, a && a.address) : first(cm && cm.address, meta && meta.address);
  add(ubi, 'Dirección', dir, true);
  add(ubi, 'Código postal', first(a && a.codigoPostal, a && a.cp, cm && cm.sapZip), true);
  if (cm && cm.sapAddress && txt(cm.sapAddress) !== dir)
    add(ubi, 'Dirección en SAP', first(cm.sapAddress));
  // Coordenadas: GPS de la visita > geocoding del alta > dato del vendedor.
  if (i.loc === undefined) addLoading(ubi, 'Coordenadas');
  else {
    const L = i.loc;
    /** @type {[any, any, string]|null} */
    let co = null;
    if (L && L.lat != null && L.lon != null) co = [L.lat, L.lon, 'GPS de visita'];
    else if (a && a.lat != null && a.lng != null)
      co = [a.lat, a.lng, 'geolocalización de la dirección'];
    else if (meta && meta.lat != null && meta.lng != null)
      co = [meta.lat, meta.lng, 'cargada por el vendedor'];
    if (co) {
      const la = Number(co[0]);
      const lo = Number(co[1]);
      if (Number.isFinite(la) && Number.isFinite(lo))
        add(ubi, 'Coordenadas', la.toFixed(5) + ', ' + lo.toFixed(5) + ' (' + co[2] + ')');
    }
  }
  out.push({ key: 'ubicacion', title: 'Ubicación', rows: ubi });

  // ---------- CONTACTO ----------
  /** @type {FichaRow[]} */
  const con = [];
  add(con, 'Email', first(a && a.email), true);
  const telComercio = first(a && a.telefono);
  const telSap = first(a && a.telefonoContacto);
  if (telComercio || telSap) {
    add(con, 'Teléfono del comercio', telComercio);
    if (telSap && telSap !== telComercio) add(con, 'Teléfono (SAP / alta rápida)', telSap);
  } else add(con, 'Teléfono', '', true);
  add(con, 'Persona de contacto', first(a && a.contactoNombre, a && a.duenoNombre), true);
  if (a && a.duenoNombre && txt(a.duenoNombre) !== txt(a.contactoNombre))
    add(con, 'Dueño', txt(a.duenoNombre));
  add(con, 'Teléfono particular del contacto', first(a && a.contactoTelParticular));
  add(con, 'WhatsApp', first(a && a.contactoWhatsapp));
  add(con, 'Email del contacto', first(a && a.contactoEmail));
  out.push({ key: 'contacto', title: 'Contacto', rows: con });

  // ---------- LOGÍSTICA Y ENVÍOS ----------
  /** @type {FichaRow[]} */
  const log = [];
  const dd = cm && cm.defaultDelivery;
  let logNote = '';
  if (dd && dd.tipo) {
    const t = txt(dd.tipo);
    add(log, 'Modalidad', /** @type {Record<string,string>} */ (ENTREGA_TIPOS)[t] || t, true);
    if (t === 'TRANSPORTISTA') {
      add(log, 'Transportista', first(dd.transpNombre), true);
      add(log, 'Dirección del transportista', first(dd.transpDireccion));
      add(log, 'Domicilio de entrega del cliente', first(dd.clienteDireccion));
    } else if (t === 'SUCURSAL') {
      add(log, 'Dirección de la sucursal', first(dd.sucursalDireccion), true);
      add(log, 'Domicilio del cliente', first(dd.clienteDireccion));
    } else if (t === 'RETIRO_DEPOSITO') {
      add(
        log,
        'Retira',
        [txt(dd.retiroNombre), txt(dd.retiroApellido)].filter(Boolean).join(' '),
        true
      );
      add(log, 'DNI', first(dd.retiroDni));
      add(log, 'Patente', first(dd.retiroPatente));
    }
    const upd = [fmtFecha(dd.updatedAt), first(dd.updatedBy)].filter(Boolean).join(' · ');
    add(log, 'Última actualización', upd);
    logNote =
      'Es la forma de entrega del último pedido del cliente; se actualiza sola con cada pedido.';
  } else {
    add(log, 'Modalidad', '', true);
    logNote = 'Se completa sola cuando el cliente tiene un pedido o una orden en espera.';
  }
  out.push({ key: 'logistica', title: 'Logística y envíos', rows: log, note: logNote });

  // ---------- INFORMACIÓN ADICIONAL ----------
  /** @type {FichaRow[]} */
  const adi = [];
  if (a) {
    add(adi, 'Fusionado desde', first(a.mergedFromCardCode));
    if (a.submittedByPublicForm) add(adi, 'Alta por formulario público', 'Sí');
    const docs = [];
    if (a.constanciaArca) docs.push('constancia ARCA');
    if (a.constanciaIIBB) docs.push('constancia IIBB');
    if (Array.isArray(a.fotosLocal) && a.fotosLocal.length)
      docs.push(a.fotosLocal.length + ' foto(s) del local');
    add(adi, 'Documentación cargada', docs.join(', '));
    add(adi, 'Cargado por', first(a.ownerName, a.ownerEmail));
  }
  if (meta && meta.customName && txt(meta.customName) !== txt(e.nombre))
    add(adi, 'Nombre editado por vendedor', txt(meta.customName));
  if (cm && cm.updatedAt) add(adi, 'Última modificación del maestro', fmtFecha(cm.updatedAt));
  if (adi.length) out.push({ key: 'adicional', title: 'Información adicional', rows: adi });

  return out;
}

/**
 * Busca la fila del cliente en cartera_vendor/{vendor}.clientes.
 * @param {any[]|null|undefined} clientes
 * @param {{cardCode?: string, nombre?: string, provincia?: string, localidad?: string}} key
 * @returns {any|null}
 */
export function findCarteraCliente(clientes, key) {
  if (!Array.isArray(clientes) || !key) return null;
  const cc = txt(key.cardCode).toUpperCase();
  if (cc) {
    const hit = clientes.find((c) => c && txt(c.cardCode).toUpperCase() === cc);
    if (hit) return hit;
  }
  const n = txt(key.nombre).toUpperCase();
  if (!n) return null;
  return (
    clientes.find(
      (c) =>
        c &&
        txt(c.clientName).toUpperCase() === n &&
        (!key.provincia || txt(c.provincia).toUpperCase() === txt(key.provincia).toUpperCase())
    ) || null
  );
}
