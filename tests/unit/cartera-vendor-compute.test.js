// @ts-check
import { describe, expect, it } from 'vitest';
import { computeCounts, normalizeClienteRow } from '../../functions/core/cartera-vendor-core.js';

describe('computeCounts', () => {
  it('array vacio -> todos los counts en 0', () => {
    expect(computeCounts([])).toEqual({
      total: 0, baseActiva90d: 0, dormidosVisita30d: 0,
      dormidosCompra90d: 0, nuncaVisitados: 0, nuncaCompraron: 0,
    });
  });

  it('cliente nunca visito ni compro -> nuncaVisitados + nuncaCompraron', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: null, diasSinVisitaPresencial: null, ultimaCompra: null, diasSinCompra: null },
    ]);
    expect(r.total).toBe(1);
    expect(r.nuncaVisitados).toBe(1);
    expect(r.nuncaCompraron).toBe(1);
    expect(r.baseActiva90d).toBe(0);
    expect(r.dormidosVisita30d).toBe(0);
    expect(r.dormidosCompra90d).toBe(0);
  });

  it('cliente base activa (diasSinCompra <= 90) -> baseActiva90d', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: '2026-10-01', diasSinVisitaPresencial: 20, ultimaCompra: '2026-10-05', diasSinCompra: 15 },
    ]);
    expect(r.baseActiva90d).toBe(1);
    expect(r.dormidosCompra90d).toBe(0);
    expect(r.nuncaCompraron).toBe(0);
  });

  it('cliente dormido visita + dormido compra simultaneo', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: '2026-08-01', diasSinVisitaPresencial: 80, ultimaCompra: '2026-06-01', diasSinCompra: 141 },
    ]);
    expect(r.dormidosVisita30d).toBe(1);
    expect(r.dormidosCompra90d).toBe(1);
    expect(r.baseActiva90d).toBe(0);
    expect(r.nuncaVisitados).toBe(0);
  });

  it('exactamente 30d visita -> NO cuenta como dormido (umbral estricto >30)', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: '2026-09-20', diasSinVisitaPresencial: 30, ultimaCompra: null, diasSinCompra: null },
    ]);
    expect(r.dormidosVisita30d).toBe(0);
  });

  it('exactamente 90d compra -> base activa (umbral <=90)', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: null, diasSinVisitaPresencial: null, ultimaCompra: '2026-07-22', diasSinCompra: 90 },
    ]);
    expect(r.baseActiva90d).toBe(1);
    expect(r.dormidosCompra90d).toBe(0);
  });

  it('91d compra -> dormido 90d, no base activa', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: null, diasSinVisitaPresencial: null, ultimaCompra: '2026-07-21', diasSinCompra: 91 },
    ]);
    expect(r.baseActiva90d).toBe(0);
    expect(r.dormidosCompra90d).toBe(1);
  });

  it('mix de 5 clientes con breakdown esperado', () => {
    const clientes = [
      { ultimaVisitaPresencial: '2026-10-15', diasSinVisitaPresencial: 5,  ultimaCompra: '2026-10-10', diasSinCompra: 10 },
      { ultimaVisitaPresencial: '2026-09-10', diasSinVisitaPresencial: 40, ultimaCompra: '2026-07-01', diasSinCompra: 111 },
      { ultimaVisitaPresencial: null,         diasSinVisitaPresencial: null, ultimaCompra: null,       diasSinCompra: null },
      { ultimaVisitaPresencial: null,         diasSinVisitaPresencial: null, ultimaCompra: '2026-10-01', diasSinCompra: 19 },
      { ultimaVisitaPresencial: '2026-10-18', diasSinVisitaPresencial: 2,  ultimaCompra: null,         diasSinCompra: null },
    ];
    const r = computeCounts(clientes);
    expect(r.total).toBe(5);
    expect(r.baseActiva90d).toBe(2);
    expect(r.dormidosVisita30d).toBe(1);
    expect(r.dormidosCompra90d).toBe(1);
    expect(r.nuncaVisitados).toBe(2);
    expect(r.nuncaCompraron).toBe(2);
  });
});

describe('normalizeClienteRow', () => {
  it('traduce BQ fields snake_case -> Firestore camelCase + espanol', () => {
    const bqRow = {
      vendor_key: 'GONZALO DE LA ROSA',
      client_id: 'ba__la_plata__pescar_info_shop',
      card_code: 'C30711930392',
      client_name: 'PESCAR.INFO SHOP S.R.L.',
      province: 'BUENOS AIRES',
      loc_name: 'LA PLATA',
      cli_tipo: 'A',
      ultima_visita_presencial: '2026-09-15',
      ultimo_contacto: '2026-10-02',
      ultima_compra: '2026-10-05',
      facturado_12m: 2500000,
      deuda_abierta: 450000,
      dias_sin_visita_presencial: 35,
      dias_sin_contacto: 18,
      dias_sin_compra: 15,
    };
    expect(normalizeClienteRow(bqRow)).toEqual({
      clientId: 'ba__la_plata__pescar_info_shop',
      cardCode: 'C30711930392',
      clientName: 'PESCAR.INFO SHOP S.R.L.',
      provincia: 'BUENOS AIRES',
      localidad: 'LA PLATA',
      cliTipo: 'A',
      ultimaVisitaPresencial: '2026-09-15',
      diasSinVisitaPresencial: 35,
      ultimoContacto: '2026-10-02',
      diasSinContacto: 18,
      ultimaCompra: '2026-10-05',
      diasSinCompra: 15,
      facturado12M: 2500000,
      deudaAbierta: 450000,
    });
  });

  it('preserva nulls en fechas y dias (cliente nunca compro ni visito)', () => {
    const bqRow = {
      vendor_key: 'X', client_id: 'id1', card_code: null, client_name: 'C1',
      province: null, loc_name: null, cli_tipo: null,
      ultima_visita_presencial: null, ultimo_contacto: null, ultima_compra: null,
      facturado_12m: 0, deuda_abierta: 0,
      dias_sin_visita_presencial: null, dias_sin_contacto: null, dias_sin_compra: null,
    };
    const r = normalizeClienteRow(bqRow);
    expect(r.cardCode).toBe(null);
    expect(r.ultimaCompra).toBe(null);
    expect(r.diasSinCompra).toBe(null);
    expect(r.facturado12M).toBe(0);
    expect(r.deudaAbierta).toBe(0);
  });

  it('BQ date values como Date object se stringifican a YYYY-MM-DD', () => {
    const bqRow = {
      vendor_key: 'X', client_id: 'id1', card_code: 'C1', client_name: 'C1',
      province: 'X', loc_name: 'X', cli_tipo: 'X',
      ultima_visita_presencial: { value: '2026-09-15' },
      ultimo_contacto: new Date('2026-10-02T00:00:00Z'),
      ultima_compra: '2026-10-05',
      facturado_12m: 0, deuda_abierta: 0,
      dias_sin_visita_presencial: 35, dias_sin_contacto: 18, dias_sin_compra: 15,
    };
    const r = normalizeClienteRow(bqRow);
    expect(r.ultimaVisitaPresencial).toBe('2026-09-15');
    expect(r.ultimoContacto).toBe('2026-10-02');
    expect(r.ultimaCompra).toBe('2026-10-05');
  });

  it('facturado12M y deudaAbierta sin valor BQ -> 0', () => {
    const bqRow = {
      vendor_key: 'X', client_id: 'id1', card_code: null, client_name: 'C1',
      province: null, loc_name: null, cli_tipo: null,
      ultima_visita_presencial: null, ultimo_contacto: null, ultima_compra: null,
      facturado_12m: null, deuda_abierta: undefined,
      dias_sin_visita_presencial: null, dias_sin_contacto: null, dias_sin_compra: null,
    };
    const r = normalizeClienteRow(bqRow);
    expect(r.facturado12M).toBe(0);
    expect(r.deudaAbierta).toBe(0);
  });
});
