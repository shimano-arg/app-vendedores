// @ts-check
/**
 * v1520 §103 (2026-10-29) — Popup "Stock del SKU" muestra TODO lo que
 * resta hasta llegar a Libre + fórmula explícita.
 *
 * Caso emblemático TRX301B (29/10 09:04):
 *   físico 16, tránsito 0, BO 1 (no reserva), asig 7, confirmed sin SAP 7
 *   → libre 2 = max(0, 16 − min(7+7, 16))
 *
 * Antes (§40.11 v1403): popup mostraba físico/tránsito/BO/asig/libre y
 * escondía las 7u de confirmed. Mariano reportó: "16 menos 7 son 9, no 2;
 * faltan 7 unidades sin explicar".
 *
 * Después: popup lista asignados Y confirmed sin facturar + fórmula que
 * cierra la cuenta a ojo.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPopupStockSkuLineas,
  renderPopupStockSkuPlainText,
} from '../../../src/pure/popup-stock-sku-lineas.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

const NOW = Date.parse('2026-10-29T12:04:00Z');
const nowIso = new Date(NOW).toISOString();

function makeTrx301bDeps() {
  const asigAt = '2026-10-28T18:49:23.159Z';
  return {
    getStockFisico: (sku) => (sku === 'TRX301B' ? 16 : 0),
    getStockTransito: () => 0,
    pedidos: [
      // --- 5 líneas ASIG = 7u (desde snapshot prod O_breakdown_trx301b.cjs 29/10) ---
      {
        _fsId: 'YJdNBOtxnKHU5ee0oeYk',
        orderNumber: 158,
        closedAt: null,
        clientCardCode: 'CWEEKEND',
        clientName: 'WEEKEND OUTDOOR S.R.L.',
        lines: [{ code: 'TRX301B', state: 'ASIG', qtyOpen: 2, asigAt }],
      },
      {
        _fsId: 'YP03B0yknM6MyYmTTTtE',
        orderNumber: 162,
        closedAt: null,
        clientCardCode: 'CBLANCO',
        clientName: 'RICARDO FABIAN BLANCO GOITIA',
        lines: [{ code: 'TRX301B', state: 'ASIG', qtyOpen: 2, asigAt }],
      },
      {
        _fsId: 'dGw6k6VSdIE9IYheA5uy',
        orderNumber: 316,
        closedAt: null,
        clientCardCode: 'CACOSTA',
        clientName: 'CRISTIAN JOSE ACOSTA',
        lines: [{ code: 'TRX301B', state: 'ASIG', qtyOpen: 1, asigAt }],
      },
      {
        _fsId: 'pzBxDv50S4m6LJb6WxQM',
        orderNumber: 173,
        closedAt: null,
        clientCardCode: 'CDINKELDEIN',
        clientName: 'ESTACION DINKELDEIN S.R.L.',
        lines: [{ code: 'TRX301B', state: 'ASIG', qtyOpen: 1, asigAt }],
      },
      {
        _fsId: 'v5ZFu6QukN7e3UNrmIk9',
        orderNumber: 202,
        closedAt: null,
        clientCardCode: 'CSFRAMELI',
        clientName: 'DANIEL SANTOS SFRAMELI',
        lines: [{ code: 'TRX301B', state: 'ASIG', qtyOpen: 1, asigAt }],
      },
      // --- 2 líneas confirmed sin SAP = 7u ---
      {
        _fsId: 'sVBLaEAI0Z9BXsy3PiNW',
        orderNumber: 419,
        closedAt: null,
        clientCardCode: 'CIUALE',
        clientName: 'LEONARDO ARIEL IUALE',
        confirmedAt: '2026-10-27T16:12:49.072Z',
        lines: [{ code: 'TRX301B', state: 'confirmed', qtyOpen: 1 }],
      },
      {
        _fsId: 'DlzjtFlqyPs6fuQRwCn4',
        orderNumber: 615,
        closedAt: null,
        clientCardCode: 'CPESCAR',
        clientName: 'PESCAR.INFO SHOP S.R.L.',
        confirmedAt: '2026-10-29T00:34:11.063Z',
        lines: [{ code: 'TRX301B', state: 'confirmed', qtyOpen: 6 }],
      },
    ],
    waitlistEntries: [],
    ingresosRepartoActivos: [],
  };
}

describe('v1520 §103 — popup Stock del SKU: fórmula cierra a ojo', () => {
  it('fixture real TRX301B 29/10: fisico 16 − asig 7 − conf 7 = libre 2', () => {
    const deps = makeTrx301bDeps();
    const b = getStockBreakdown('TRX301B', deps, { now: NOW });
    expect(b.fisicoDep11).toBe(16);
    expect(b.transitoDep12).toBe(0);
    expect(b.backorderApp.total).toBe(0);
    expect(b.asignadas.total).toBe(7);
    expect(b.confirmadasSinFacturar.total).toBe(7);
    expect(b.libre).toBe(2);

    const { lineas, formula } = buildPopupStockSkuLineas(b);

    // Las 3 líneas que entran en la cuenta están presentes + libre.
    const porLabel = Object.fromEntries(lineas.map((l) => [l.label, l]));
    expect(porLabel['Stock físico (dep 11)'].qty).toBe(16);
    expect(porLabel['Pedidos asignados'].qty).toBe(7);
    expect(porLabel['Pedidos confirmados sin facturar'].qty).toBe(7);
    expect(porLabel['Libre para la venta'].qty).toBe(2);

    // Fórmula explícita.
    expect(formula).toContain('16 físico');
    expect(formula).toContain('7 asignados');
    expect(formula).toContain('7 confirmados sin facturar');
    expect(formula).toContain('= 2');

    // Invariante aritmética: la cuenta cierra con lo que se muestra.
    const asigLine = porLabel['Pedidos asignados'].qty;
    const confLine = porLabel['Pedidos confirmados sin facturar'].qty;
    const fisicoLine = porLabel['Stock físico (dep 11)'].qty;
    const libreLine = porLabel['Libre para la venta'].qty;
    expect(fisicoLine - asigLine - confLine).toBe(libreLine);
  });

  it('NO esconde confirmadas sin facturar cuando > 0 (regresión §40.11)', () => {
    const b = getStockBreakdown('TRX301B', makeTrx301bDeps(), { now: NOW });
    const { lineas } = buildPopupStockSkuLineas(b);
    const labels = lineas.map((l) => l.label);
    expect(labels).toContain('Pedidos confirmados sin facturar');
    // Esto es lo que fallaba en v1403-v1519: la línea no existía.
  });

  it('texto plano del alert incluye todo y la fórmula', () => {
    const b = getStockBreakdown('TRX301B', makeTrx301bDeps(), { now: NOW });
    const text = renderPopupStockSkuPlainText(b);
    expect(text).toContain('Stock físico (dep 11): 16 unidades');
    expect(text).toContain('Pedidos asignados: 7 unidades');
    expect(text).toContain('Pedidos confirmados sin facturar: 7 unidades');
    expect(text).toContain('Libre para la venta: 2 unidades');
    expect(text).toContain('Cuenta: 16 físico − 7 asignados − 7 confirmados sin facturar = 2');
  });

  it('BO > 0 se muestra como línea informativa (no entra en la cuenta)', () => {
    // Variante: TRX301B con 1u BO adicional para probar que BO sale como info.
    const deps = makeTrx301bDeps();
    deps.pedidos.push({
      _fsId: 'BO_FAKE',
      orderNumber: 999,
      closedAt: null,
      clientCardCode: 'CFAKE',
      clientName: 'FAKE',
      createdAt: nowIso,
      lines: [{ code: 'TRX301B', state: 'BO', qtyOpen: 1 }],
    });
    const b = getStockBreakdown('TRX301B', deps, { now: NOW });
    expect(b.backorderApp.total).toBe(1);
    const { lineas, formula } = buildPopupStockSkuLineas(b);
    const boLine = lineas.find((l) => l.label === 'En back order');
    expect(boLine).toBeDefined();
    expect(boLine && boLine.qty).toBe(1);
    expect(boLine && boLine.entraEnCuenta).toBe(false);
    // La fórmula NO suma BO.
    expect(formula).toContain('16 físico − 7 asignados − 7 confirmados sin facturar = 2');
  });

  it('BO = 0 → línea de back order NO se muestra (ruido evitado)', () => {
    const b = getStockBreakdown('TRX301B', makeTrx301bDeps(), { now: NOW });
    expect(b.backorderApp.total).toBe(0);
    const { lineas } = buildPopupStockSkuLineas(b);
    const labels = lineas.map((l) => l.label);
    expect(labels).not.toContain('En back order');
  });

  it('conf = 0: línea sigue mostrándose con 0 (coherencia visual + fórmula explícita)', () => {
    // Caso borde: SKU sin confirmed. La línea sigue para que la fórmula sea
    // siempre la misma forma — no obliga a Mariano a adivinar si se omitió.
    const deps = {
      getStockFisico: () => 10,
      pedidos: [
        {
          _fsId: 'P1',
          closedAt: null,
          clientCardCode: 'C1',
          clientName: 'C1',
          lines: [{ code: 'SKU1', state: 'ASIG', qtyOpen: 3, asigAt: nowIso }],
        },
      ],
      waitlistEntries: [],
      ingresosRepartoActivos: [],
    };
    const b = getStockBreakdown('SKU1', deps, { now: NOW });
    const { lineas, formula } = buildPopupStockSkuLineas(b);
    const confLine = lineas.find((l) => l.label === 'Pedidos confirmados sin facturar');
    expect(confLine).toBeDefined();
    expect(confLine && confLine.qty).toBe(0);
    expect(formula).toContain('10 físico − 3 asignados − 0 confirmados sin facturar = 7');
  });
});
