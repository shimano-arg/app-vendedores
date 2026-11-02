// v1542 APP-07: Buyer (Ficha Cliente) — facturas vs notas de crédito.
// Filas como las devuelve _buyerFetchVentasRows (v_ventas_lineas): las NC
// llegan con doc_kind = 'CREDIT_NOTE' y cantidad/importe ya negativos; la
// fecha es fecha_contable (NC con factura base = fecha de esa factura; NC sin
// base = su propia fecha). Los anulados no llegan (la vista filtra tNO).
import { describe, expect, it } from 'vitest';
import {
  aggregateVentasIntoBuyerStats,
  computeWindowStats,
} from '../../functions/core/buyer-stats-core.js';

const NOW = new Date('2026-11-02T12:00:00Z');

function fac(entry, fecha, o = {}) {
  return {
    card_code: 'C1',
    card_name: 'CLIENTE',
    item_code: 'SKU-A',
    descripcion_linea: 'Reel A',
    cantidad: 1,
    importe_linea_ars: 1000,
    doc_entry: entry,
    doc_kind: 'INVOICE',
    fecha,
    categoria: 'REELS',
    ...o,
  };
}
function nc(entry, fecha, o = {}) {
  return fac(entry, fecha, {
    doc_kind: 'CREDIT_NOTE',
    cantidad: -1,
    importe_linea_ars: -1000,
    ...o,
  });
}
const cinco = () =>
  ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((f, i) =>
    fac(100 + i, f)
  );

describe('v1542 APP-07 — Buyer: facturas vs notas de crédito', () => {
  it('Caso A: 5 facturas + 3 NC → Facturas = 5', () => {
    const rows = [...cinco(), nc(1, '2026-06-01'), nc(2, '2026-07-01'), nc(3, '2026-08-01')];
    const s = computeWindowStats(rows, NOW, 12);
    expect(s.facturasCount).toBe(5);
    expect(s.notasCreditoCount).toBe(3);
    expect(s.montoBruto).toBe(5000);
    expect(s.notasCreditoArs).toBe(-3000);
    expect(s.montoTotal).toBe(2000);
    expect(s.montoPromedio).toBe(400); // neto / facturas válidas
  });

  it('Caso B: 5 facturas sin NC → Facturas = 5, neto = bruto', () => {
    const s = computeWindowStats(cinco(), NOW, 12);
    expect(s).toMatchObject({
      facturasCount: 5,
      montoTotal: 5000,
      montoBruto: 5000,
      notasCreditoArs: 0,
    });
    expect(s.frecuenciaDias).toBeCloseTo(30.5, 0); // 122 días / 4
  });

  it('Caso C: NC total de una factura → neto y cantidades ajustados, Facturas = 5', () => {
    const rows = [...cinco(), nc(9, '2026-10-01', { cantidad: -1, importe_linea_ars: -1000 })];
    const s = computeWindowStats(rows, NOW, 12);
    expect(s.facturasCount).toBe(5);
    expect(s.montoTotal).toBe(4000);
    expect(s.topSkus[0]).toMatchObject({ sku: 'SKU-A', qty: 4, monto: 4000 });
  });

  it('Caso D: 2 NC parciales sobre SKU distintos → impactan en su SKU', () => {
    const rows = [
      fac(1, '2026-09-01', { item_code: 'A', cantidad: 3, importe_linea_ars: 3000 }),
      fac(1, '2026-09-01', {
        item_code: 'B',
        cantidad: 2,
        importe_linea_ars: 4000,
        categoria: 'CAÑAS',
      }),
      fac(2, '2026-10-01', { item_code: 'A', cantidad: 1, importe_linea_ars: 1000 }),
      nc(50, '2026-09-01', { item_code: 'A', cantidad: -1, importe_linea_ars: -1000 }),
      nc(51, '2026-10-01', {
        item_code: 'B',
        cantidad: -1,
        importe_linea_ars: -2000,
        categoria: 'CAÑAS',
      }),
    ];
    const s = computeWindowStats(rows, NOW, 12);
    expect(s.facturasCount).toBe(2);
    const a = s.topSkus.find((x) => x.sku === 'A');
    const b = s.topSkus.find((x) => x.sku === 'B');
    expect(a).toMatchObject({ qty: 3, monto: 3000 });
    expect(b).toMatchObject({ qty: 1, monto: 2000 });
    // Consistencia: suma de SKU = suma de categorías = monto total.
    const sumSku = s.topSkus.reduce((t, x) => t + x.monto, 0);
    const sumCat = s.topCategorias.reduce((t, x) => t + x.monto, 0);
    expect(sumSku).toBe(s.montoTotal);
    expect(sumCat).toBe(s.montoTotal);
    expect(s.topCategorias.reduce((t, x) => t + x.pctMonto, 0)).toBeCloseTo(100, 0);
  });

  it('Caso E: NC sin factura base, posterior, NO es una compra nueva (fechas solo de facturas)', () => {
    const rows = [fac(1, '2026-08-10'), fac(2, '2026-09-10'), nc(7, '2026-10-25')];
    const s = computeWindowStats(rows, NOW, 12);
    expect(s.ultimaCompra).toBe('2026-09-10'); // antes daba 2026-10-25 (la NC)
    expect(s.primeraCompra).toBe('2026-08-10');
    expect(s.diasDesdeUltima).toBe(53);
    expect(s.frecuenciaDias).toBe(31); // 31 días / (2 − 1), sin la fecha de la NC
    expect(s.montoTotal).toBe(1000);
  });

  it('Caso E (ventanas): NC con base fuera de la ventana no entra a la ventana corta', () => {
    const rows = [fac(1, '2026-01-15'), fac(2, '2026-10-20'), nc(8, '2026-01-15')];
    const m = aggregateVentasIntoBuyerStats(rows, NOW).get('C1');
    expect(m.stats_3m).toMatchObject({ facturasCount: 1, montoTotal: 1000, notasCreditoCount: 0 });
    expect(m.stats_12m).toMatchObject({ facturasCount: 2, montoTotal: 1000, notasCreditoCount: 1 });
  });

  it('Caso F: factura anulada (no llega desde la vista) + su NC → la NC resta una sola vez', () => {
    // La vista excluye la factura anulada; si SAP además emitió una NC sobre
    // ella, la NC llega sola. Se resta una vez (no se duplica) y no cuenta
    // como factura ni como compra. Limitación documentada en el informe 50.
    const rows = [fac(1, '2026-09-01'), nc(9, '2026-09-15')];
    const s = computeWindowStats(rows, NOW, 12);
    expect(s).toMatchObject({
      facturasCount: 1,
      notasCreditoCount: 1,
      montoTotal: 0,
      ultimaCompra: '2026-09-01',
    });
  });

  it('Caso G: cliente sin facturación válida (solo NC) → sin compras ni divisiones por cero', () => {
    const s = computeWindowStats([nc(1, '2026-10-01')], NOW, 12);
    expect(s).toMatchObject({
      facturasCount: 0,
      montoPromedio: 0,
      primeraCompra: null,
      ultimaCompra: null,
      diasDesdeUltima: null,
      frecuenciaDias: null,
      facturasPorMes: 0,
    });
    expect(s.topSkus.every((x) => Number.isFinite(x.pctMonto))).toBe(true);
  });

  it('Caso G: sin filas → todo en cero', () => {
    expect(computeWindowStats([], NOW, 12)).toMatchObject({
      facturasCount: 0,
      montoTotal: 0,
      ultimaCompra: null,
      notasCreditoCount: 0,
    });
  });

  it('una factura con varias líneas cuenta una sola vez', () => {
    const rows = [
      fac(1, '2026-10-01', { item_code: 'A' }),
      fac(1, '2026-10-01', { item_code: 'B' }),
    ];
    expect(computeWindowStats(rows, NOW, 12).facturasCount).toBe(1);
  });
});
