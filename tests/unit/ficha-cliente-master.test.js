import { describe, expect, it } from 'vitest';
import {
  buildFichaClienteMaster,
  CARGANDO,
  findCarteraCliente,
  fmtArs,
  fmtFecha,
  SIN_INFO,
} from '../../src/pure/ficha-cliente-master.js';

/** @param {any[]} secs @param {string} key */
const sec = (secs, key) => secs.find((s) => s.key === key);
/** @param {any} s @param {string} label */
const val = (s, label) => (s.rows.find((r) => r.label === label) || {}).value;

const ENTRY_PADRON = {
  nombre: 'PESCA LOS AMIGOS',
  localidad: 'QUILMES',
  provincia: 'BUENOS AIRES',
  vendor: 'FEDERICO CASTELANELLI',
  tipo: 'cliente',
};

describe('v1539 APP-04 — cliente del padrón sin datos extra', () => {
  const secs = buildFichaClienteMaster({
    entry: ENTRY_PADRON,
    vendorLabel: 'Z2 - Federico Castelanelli',
    alta: null,
    cm: null,
    meta: null,
    loc: null,
    buyer: null,
    cartera: null,
  });

  it('arma los bloques en orden (sin Adicional si no hay datos)', () => {
    expect(secs.map((s) => s.key)).toEqual([
      'identificacion',
      'comercial',
      'ubicacion',
      'contacto',
      'logistica',
    ]);
  });

  it('campos importantes vacíos dicen Sin información registrada', () => {
    const id = sec(secs, 'identificacion');
    expect(val(id, 'CUIT')).toBe(SIN_INFO);
    expect(val(id, 'Código SAP')).toBe(SIN_INFO);
    expect(val(sec(secs, 'contacto'), 'Email')).toBe(SIN_INFO);
    expect(val(sec(secs, 'logistica'), 'Modalidad')).toBe(SIN_INFO);
    expect(val(sec(secs, 'ubicacion'), 'Dirección')).toBe(SIN_INFO);
  });

  it('campos secundarios vacíos no aparecen', () => {
    const labels = secs.flatMap((s) => s.rows.map((r) => r.label));
    expect(labels).not.toContain('WhatsApp');
    expect(labels).not.toContain('Condición fiscal');
    expect(labels).not.toContain('Fidelidad');
  });

  it('datos básicos del cliente', () => {
    expect(val(sec(secs, 'identificacion'), 'Nombre comercial')).toBe('PESCA LOS AMIGOS');
    expect(val(sec(secs, 'comercial'), 'Vendedor asignado')).toBe('Z2 - Federico Castelanelli');
    expect(val(sec(secs, 'ubicacion'), 'Localidad')).toBe('QUILMES');
  });
});

describe('v1539 APP-04 — alta SAP completa', () => {
  const alta = {
    _fsId: 'abc',
    comercio: 'LOS AMIGOS SRL',
    fantasia: 'Pesca Los Amigos',
    cardCodeSap: 'C30711111111',
    cuit: '30711111111',
    calle: 'José Godoy',
    numero: '234',
    localidadFinal: 'QUILMES',
    provincia: 'BUENOS AIRES',
    codigoPostal: '1878',
    email: 'info@amigos.com',
    telefono: '4250-0000',
    telefonoContacto: '11 5555-0000',
    contactoNombre: 'Juan Pérez',
    contactoWhatsapp: '11 5555-0000',
    sapValid: true,
    sapFrozen: false,
    createdAt: '2026-06-15T12:00:00Z',
    source: 'sap_sync',
    lat: -34.72,
    lng: -58.25,
  };
  const cm = {
    cliTipo: 'A',
    fidelidad: 'ALTA',
    defaultDelivery: {
      tipo: 'TRANSPORTISTA',
      transpNombre: 'Pepe',
      transpDireccion: 'Av. Mitre 100',
      clienteDireccion: 'José Godoy 234, Quilmes',
      updatedAt: '2026-10-30T10:00:00Z',
      updatedBy: 'federico@shimano.com.ar',
    },
  };
  const secs = buildFichaClienteMaster({
    entry: { ...ENTRY_PADRON, tipo: 'sap_alta', sapCardCode: 'C30711111111' },
    alta,
    cm,
    loc: null,
    buyer: {
      stats_12m: {
        montoTotal: 1234567,
        facturasCount: 4,
        ultimaCompra: '2026-10-01',
        topSkus: [{ sku: 'TRX301B' }],
      },
    },
    cartera: { deudaAbierta: 50000, diasSinCompra: 32 },
  });

  it('identificación desde el alta', () => {
    const id = sec(secs, 'identificacion');
    expect(val(id, 'Nombre comercial')).toBe('Pesca Los Amigos');
    expect(val(id, 'Razón social')).toBe('LOS AMIGOS SRL');
    expect(val(id, 'Código SAP')).toBe('C30711111111');
    expect(val(id, 'CUIT')).toBe('30711111111');
    expect(val(id, 'Tipo de cliente')).toBe('A - fijo 3% / anticipado 3%');
    expect(val(id, 'Estado en SAP')).toBe('Activo');
  });

  it('ubicación: calle + número, CP y coordenadas del alta', () => {
    const u = sec(secs, 'ubicacion');
    expect(val(u, 'Dirección')).toBe('José Godoy 234');
    expect(val(u, 'Código postal')).toBe('1878');
    expect(val(u, 'Coordenadas')).toBe('-34.72000, -58.25000 (geolocalización de la dirección)');
  });

  it('contacto: los dos teléfonos con etiqueta', () => {
    const c = sec(secs, 'contacto');
    expect(val(c, 'Teléfono del comercio')).toBe('4250-0000');
    expect(val(c, 'Teléfono (SAP / alta rápida)')).toBe('11 5555-0000');
    expect(val(c, 'Persona de contacto')).toBe('Juan Pérez');
  });

  it('logística: transportista con domicilio de entrega', () => {
    const l = sec(secs, 'logistica');
    expect(val(l, 'Modalidad')).toBe('Entrega a transportista');
    expect(val(l, 'Transportista')).toBe('Pepe');
    expect(val(l, 'Domicilio de entrega del cliente')).toBe('José Godoy 234, Quilmes');
    expect(val(l, 'Última actualización')).toMatch(/^30\/10\/2026 · federico@/);
    expect(l.note).toMatch(/último pedido/);
  });

  it('comercial: ventas y deuda', () => {
    const c = sec(secs, 'comercial');
    expect(val(c, 'Ventas últimos 12 meses')).toBe('$ 1.234.567 en 4 factura(s)');
    expect(val(c, 'Deuda abierta')).toBe('$ 50.000');
    expect(val(c, 'Productos más comprados')).toBe('TRX301B');
    expect(val(c, 'Fidelidad')).toBe('Alta');
  });
});

describe('v1539 APP-04 — entrega por sucursal y retiro', () => {
  it('sucursal', () => {
    const secs = buildFichaClienteMaster({
      entry: ENTRY_PADRON,
      cm: { defaultDelivery: { tipo: 'SUCURSAL', sucursalDireccion: 'Calle 1, Lanús' } },
      loc: null,
      cartera: null,
    });
    const l = sec(secs, 'logistica');
    expect(val(l, 'Modalidad')).toBe('Envío a sucursal');
    expect(val(l, 'Dirección de la sucursal')).toBe('Calle 1, Lanús');
  });
  it('retiro en depósito', () => {
    const secs = buildFichaClienteMaster({
      entry: ENTRY_PADRON,
      cm: {
        defaultDelivery: {
          tipo: 'RETIRO_DEPOSITO',
          retiroNombre: 'Ana',
          retiroApellido: 'Gómez',
          retiroDni: '30111222',
        },
      },
      loc: null,
      cartera: null,
    });
    const l = sec(secs, 'logistica');
    expect(val(l, 'Retira')).toBe('Ana Gómez');
    expect(val(l, 'DNI')).toBe('30111222');
  });
});

describe('v1539 APP-04 — datos que todavía se están cargando', () => {
  it('undefined → Cargando…', () => {
    const secs = buildFichaClienteMaster({
      entry: ENTRY_PADRON,
      cardCode: 'C1',
      loc: undefined,
      buyer: undefined,
      cartera: undefined,
    });
    expect(val(sec(secs, 'ubicacion'), 'Coordenadas')).toBe(CARGANDO);
    expect(val(sec(secs, 'comercial'), 'Ventas últimos 12 meses')).toBe(CARGANDO);
    expect(val(sec(secs, 'comercial'), 'Deuda abierta')).toBe(CARGANDO);
  });
  it('GPS de visita gana sobre geolocalización', () => {
    const secs = buildFichaClienteMaster({
      entry: { ...ENTRY_PADRON, tipo: 'sap_alta' },
      alta: { lat: 1, lng: 2 },
      loc: { lat: -34.5, lon: -58.4 },
      cartera: null,
    });
    expect(val(sec(secs, 'ubicacion'), 'Coordenadas')).toBe('-34.50000, -58.40000 (GPS de visita)');
  });
});

describe('v1539 APP-04 — helpers', () => {
  it('fmtArs y fmtFecha', () => {
    expect(fmtArs(1234567.4)).toBe('$ 1.234.567');
    expect(fmtArs('x')).toBe('');
    // 43200 s = 1970-01-01T12:00Z: cae en 1970 en cualquier zona horaria; {seconds: 0}
    // es el borde del año y en UTC-3 da 31/12/1969 (informe 63).
    expect(fmtFecha({ seconds: 43200 })).toMatch(/1970/);
    expect(fmtFecha('')).toBe('');
  });
  it('findCarteraCliente por cardCode y por nombre', () => {
    const cl = [
      { cardCode: 'C1', clientName: 'A', provincia: 'X' },
      { cardCode: null, clientName: 'B', provincia: 'Y' },
    ];
    expect(findCarteraCliente(cl, { cardCode: 'c1' })).toBe(cl[0]);
    expect(findCarteraCliente(cl, { nombre: 'b', provincia: 'y' })).toBe(cl[1]);
    expect(findCarteraCliente(cl, { nombre: 'Z' })).toBe(null);
    expect(findCarteraCliente(null, { nombre: 'A' })).toBe(null);
  });
  it('no muta los documentos de entrada', () => {
    const cm = Object.freeze({
      cliTipo: 'P',
      defaultDelivery: Object.freeze({ tipo: 'SUCURSAL' }),
    });
    const alta = Object.freeze({ comercio: 'X', fotosLocal: Object.freeze(['a']) });
    expect(() =>
      buildFichaClienteMaster({ entry: { tipo: 'sap_alta' }, cm, alta, loc: null, cartera: null })
    ).not.toThrow();
  });
});
