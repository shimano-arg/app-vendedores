// @ts-check
import { describe, expect, it } from 'vitest';
import { applyChipFilter, sortClientes } from '../../src/pure/cartera-vendor-filter.js';

const SAMPLE = [
  { clientId: 'a', clientName: 'ALPHA S.A.',   ultimaVisitaPresencial: '2026-10-15', diasSinVisitaPresencial: 5,  ultimaCompra: '2026-10-10', diasSinCompra: 10,  facturado12M: 100, deudaAbierta: 0 },
  { clientId: 'b', clientName: 'BETA S.R.L.',  ultimaVisitaPresencial: null,         diasSinVisitaPresencial: null, ultimaCompra: null,       diasSinCompra: null, facturado12M: 0,   deudaAbierta: 0 },
  { clientId: 'c', clientName: 'GAMMA LTDA.',  ultimaVisitaPresencial: '2026-08-01', diasSinVisitaPresencial: 80, ultimaCompra: '2026-06-01', diasSinCompra: 141, facturado12M: 500, deudaAbierta: 1000 },
  { clientId: 'd', clientName: 'DELTA PESCA',  ultimaVisitaPresencial: null,         diasSinVisitaPresencial: null, ultimaCompra: '2026-10-01', diasSinCompra: 19,  facturado12M: 200, deudaAbierta: 0 },
];

describe('applyChipFilter', () => {
  it("'todos' -> devuelve el array completo", () => {
    expect(applyChipFilter(SAMPLE, 'todos')).toHaveLength(4);
  });
  it("'baseActiva90d' -> solo diasSinCompra <= 90", () => {
    const r = applyChipFilter(SAMPLE, 'baseActiva90d');
    expect(r.map((c) => c.clientId).sort()).toEqual(['a', 'd']);
  });
  it("'dormidosVisita30d' -> solo diasSinVisitaPresencial > 30", () => {
    const r = applyChipFilter(SAMPLE, 'dormidosVisita30d');
    expect(r.map((c) => c.clientId)).toEqual(['c']);
  });
  it("'dormidosCompra90d' -> solo diasSinCompra > 90", () => {
    const r = applyChipFilter(SAMPLE, 'dormidosCompra90d');
    expect(r.map((c) => c.clientId)).toEqual(['c']);
  });
  it("'nuncaVisitados' -> ultimaVisitaPresencial === null", () => {
    const r = applyChipFilter(SAMPLE, 'nuncaVisitados');
    expect(r.map((c) => c.clientId).sort()).toEqual(['b', 'd']);
  });
  it("'nuncaCompraron' -> ultimaCompra === null", () => {
    const r = applyChipFilter(SAMPLE, 'nuncaCompraron');
    expect(r.map((c) => c.clientId)).toEqual(['b']);
  });
  it('chip desconocido -> fallback a todos', () => {
    expect(applyChipFilter(SAMPLE, 'bogus')).toHaveLength(4);
  });
});

describe('sortClientes', () => {
  it("sortBy='clientName' asc -> alfa", () => {
    const r = sortClientes(SAMPLE, 'clientName', 'asc');
    expect(r.map((c) => c.clientId)).toEqual(['a', 'b', 'd', 'c']);
  });
  it("sortBy='diasSinCompra' desc -> nulls al final", () => {
    const r = sortClientes(SAMPLE, 'diasSinCompra', 'desc');
    expect(r.map((c) => c.clientId)).toEqual(['c', 'd', 'a', 'b']);
  });
  it("sortBy='diasSinCompra' asc -> nulls al final tambien", () => {
    const r = sortClientes(SAMPLE, 'diasSinCompra', 'asc');
    expect(r.map((c) => c.clientId)).toEqual(['a', 'd', 'c', 'b']);
  });
  it("sortBy='facturado12M' desc -> mayor a menor", () => {
    const r = sortClientes(SAMPLE, 'facturado12M', 'desc');
    expect(r.map((c) => c.clientId)).toEqual(['c', 'd', 'a', 'b']);
  });
  it('no muta el array de entrada (pureza)', () => {
    const original = SAMPLE.map((c) => c.clientId);
    sortClientes(SAMPLE, 'clientName', 'asc');
    expect(SAMPLE.map((c) => c.clientId)).toEqual(original);
  });
});
