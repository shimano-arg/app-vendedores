import { describe, expect, it } from 'vitest';
import {
  getStockDesglose,
  getStockRealmenteDisponible,
} from '../../src/pure/stock-realmente-disponible.js';

// Helper: crea un pedido-like
const P = (opts = {}) => ({
  closedAt: null,
  lines: [],
  ...opts,
});

// Helper: crea una linea-like
const L = (opts = {}) => ({
  code: 'SKU1',
  qty: 10,
  qtyOpen: 10,
  state: 'BO',
  ...opts,
});

describe('getStockRealmenteDisponible — casos base', () => {
  it('sin pedidos: devuelve stock fisico', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [],
    });
    expect(r).toBe(20);
  });

  it('stock fisico 0: devuelve 0 (sin ir a mirar pedidos)', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 0,
      pedidos: [P({ lines: [L({ qtyOpen: 5 })] })],
    });
    expect(r).toBe(0);
  });

  it('SKU vacio: devuelve 0', () => {
    const r = getStockRealmenteDisponible('', {
      getStockFisico: () => 20,
      pedidos: [],
    });
    expect(r).toBe(0);
  });
});

describe('getStockRealmenteDisponible — resta compromisos', () => {
  it('un pedido con BO 8u: 20 fisico - 8 comprometido = 12 real', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 8, state: 'BO' })] })],
    });
    expect(r).toBe(12);
  });

  it('confirmed cuenta como reservado', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 8, state: 'confirmed' })] })],
    });
    expect(r).toBe(12);
  });

  it('ASIG cuenta como reservado', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 5, state: 'ASIG' })] })],
    });
    expect(r).toBe(15);
  });

  it('mezcla confirmed + BO + ASIG en pedidos distintos suma toda la reserva', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 30,
      pedidos: [
        P({ lines: [L({ qtyOpen: 8, state: 'confirmed' })] }),
        P({ lines: [L({ qtyOpen: 5, state: 'BO' })] }),
        P({ lines: [L({ qtyOpen: 3, state: 'ASIG' })] }),
      ],
    });
    expect(r).toBe(14); // 30 - 8 - 5 - 3
  });

  it('caso real Mariano: 20 dep 11 + Santiago confirma 8u → Mauricio ve 12', () => {
    const r = getStockRealmenteDisponible('FX4000FCC', {
      getStockFisico: (sku) => (sku === 'FX4000FCC' ? 20 : 0),
      pedidos: [P({ lines: [L({ code: 'FX4000FCC', qtyOpen: 8, state: 'confirmed' })] })],
    });
    expect(r).toBe(12);
  });
});

describe('getStockRealmenteDisponible — no doble descuento', () => {
  it('split v600 (confirmed + BO mismo SKU mismo pedido) cuenta ambas lineas', () => {
    // Caso 100 pedidas / 70 disp: split en 70 confirmed + 30 BO.
    // Total comprometido = 100.
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 100,
      pedidos: [
        P({
          lines: [
            L({ qty: 70, qtyOpen: 70, state: 'confirmed' }),
            L({ qty: 30, qtyOpen: 30, state: 'BO' }),
          ],
        }),
      ],
    });
    expect(r).toBe(0); // 100 - 70 - 30 = 0
  });

  it('dups heredados: 2 pedidos-app distintos mismo cliente mismo SKU → suma ambos', () => {
    // MUNDO ESTURION CAPSH2401 tiene 20u en 2 pedidos migrados (SQ oficina + SQ app).
    // Los 40u totales quedan como demanda real (aunque sea duplicada).
    const r = getStockRealmenteDisponible('CAPSH2401', {
      getStockFisico: () => 50,
      pedidos: [
        P({ lines: [L({ code: 'CAPSH2401', qtyOpen: 20, state: 'BO' })] }),
        P({ lines: [L({ code: 'CAPSH2401', qtyOpen: 20, state: 'BO' })] }),
      ],
    });
    expect(r).toBe(10); // 50 - 20 - 20
  });
});

describe('getStockRealmenteDisponible — exclusiones', () => {
  it('pedidos closedAt no cuentan', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ closedAt: '2026-08-01', lines: [L({ qtyOpen: 8, state: 'BO' })] })],
    });
    expect(r).toBe(20);
  });

  it('lineas invoiced no cuentan (ya se facturaron, stock ya salio)', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 8, state: 'invoiced' })] })],
    });
    expect(r).toBe(20);
  });

  it('lineas cancelled no cuentan', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 8, state: 'cancelled' })] })],
    });
    expect(r).toBe(20);
  });

  it('lineas recycled no cuentan', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 8, state: 'recycled' })] })],
    });
    expect(r).toBe(20);
  });

  it('lineas legacy (pre-v543) no cuentan', () => {
    // Pedidos legacy schemaVersion=1 quedaron con state='legacy'. No participan.
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 8, state: 'legacy' })] })],
    });
    expect(r).toBe(20);
  });

  it('qtyOpen 0 no cuenta', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 0, state: 'BO' })] })],
    });
    expect(r).toBe(20);
  });

  it('lineas de otro SKU no cuentan', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ code: 'OTRO', qtyOpen: 8, state: 'BO' })] })],
    });
    expect(r).toBe(20);
  });
});

describe('getStockRealmenteDisponible — clamp inferior', () => {
  it('si comprometido > fisico, devuelve 0 (no negativo)', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 5,
      pedidos: [P({ lines: [L({ qtyOpen: 10, state: 'BO' })] })],
    });
    expect(r).toBe(0);
  });
});

describe('getStockRealmenteDisponible — case insensitive SKU', () => {
  it('sku lowercase input matches uppercase code', () => {
    const r = getStockRealmenteDisponible('sku1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ code: 'SKU1', qtyOpen: 8, state: 'BO' })] })],
    });
    expect(r).toBe(12);
  });

  it('sku uppercase input matches lowercase code (defensive)', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ code: 'sku1', qtyOpen: 8, state: 'BO' })] })],
    });
    expect(r).toBe(12);
  });
});

describe('getStockDesglose — breakdown por state', () => {
  it('separa fisico, comprometido, real + breakdown por state', () => {
    const d = getStockDesglose('SKU1', {
      getStockFisico: () => 30,
      pedidos: [
        P({ lines: [L({ qtyOpen: 8, state: 'confirmed' })] }),
        P({ lines: [L({ qtyOpen: 5, state: 'BO' })] }),
        P({ lines: [L({ qtyOpen: 3, state: 'ASIG' })] }),
      ],
    });
    expect(d.fisico).toBe(30);
    expect(d.comprometido).toBe(16);
    expect(d.real).toBe(14);
    expect(d.breakdown).toEqual({ confirmed: 8, BO: 5, ASIG: 3 });
  });

  it('sin pedidos: comprometido 0, real = fisico', () => {
    const d = getStockDesglose('SKU1', {
      getStockFisico: () => 20,
      pedidos: [],
    });
    expect(d).toEqual({
      fisico: 20,
      comprometido: 0,
      real: 20,
      breakdown: { confirmed: 0, BO: 0, ASIG: 0 },
    });
  });
});
