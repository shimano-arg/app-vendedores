// @ts-check
import { describe, expect, it } from 'vitest';
import { computeCounts } from '../../functions/core/cartera-vendor-core.js';

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
