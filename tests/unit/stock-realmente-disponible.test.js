import { describe, expect, it } from 'vitest';
import {
  getStockDesglose,
  getStockRealmenteDisponible,
  lineReservesStock,
} from '../../src/pure/stock-realmente-disponible.js';

// Helper: crea un pedido-like
// v1384 (2026-10-21): confirmedAt default = reciente ("ahora"), para que
// lineas confirmed en tests no caigan en el guard "sin fecha → no reserva".
// Tests que quieren probar TTL vencido/sin confirmedAt pasan `confirmedAt`
// explícito en `opts`.
const P = (opts = {}) => ({
  closedAt: null,
  lines: [],
  confirmedAt: new Date().toISOString(),
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
  it('v1392 §40: un pedido con BO 8u NO reserva — 20 fisico - 0 = 20 real', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 8, state: 'BO' })] })],
    });
    expect(r).toBe(20);
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

  it('v1392 §40: mezcla confirmed + BO + ASIG: BO NO reserva, solo confirmed+ASIG', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 30,
      pedidos: [
        P({ lines: [L({ qtyOpen: 8, state: 'confirmed' })] }),
        P({ lines: [L({ qtyOpen: 5, state: 'BO' })] }),
        P({ lines: [L({ qtyOpen: 3, state: 'ASIG' })] }),
      ],
    });
    expect(r).toBe(19); // 30 - 8 - 3 (BO no cuenta)
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
  it('v1392 §40: split v600 (confirmed+BO) solo cuenta confirmed (BO no reserva)', () => {
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
    expect(r).toBe(30); // 100 - 70 (BO no cuenta)
  });

  it('v1392 §40: dups BO en 2 pedidos NO reservan (BO no cuenta)', () => {
    const r = getStockRealmenteDisponible('CAPSH2401', {
      getStockFisico: () => 50,
      pedidos: [
        P({ lines: [L({ code: 'CAPSH2401', qtyOpen: 20, state: 'BO' })] }),
        P({ lines: [L({ code: 'CAPSH2401', qtyOpen: 20, state: 'BO' })] }),
      ],
    });
    expect(r).toBe(50); // BO no reserva
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
      pedidos: [P({ lines: [L({ qtyOpen: 10, state: 'confirmed' })] })],
    });
    expect(r).toBe(0);
  });
});

describe('getStockRealmenteDisponible — case insensitive SKU', () => {
  it('sku lowercase input matches uppercase code (v1392: ASIG en vez de BO para test)', () => {
    const r = getStockRealmenteDisponible('sku1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ code: 'SKU1', qtyOpen: 8, state: 'ASIG', asigReserva: true })] })],
    });
    expect(r).toBe(12);
  });

  it('sku uppercase input matches lowercase code (v1392: ASIG en vez de BO)', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ code: 'sku1', qtyOpen: 8, state: 'ASIG', asigReserva: true })] })],
    });
    expect(r).toBe(12);
  });
});

describe('getStockDesglose — breakdown por state', () => {
  it('v1392 §40: separa fisico, comprometido, real + breakdown por state (BO NO reserva)', () => {
    const d = getStockDesglose('SKU1', {
      getStockFisico: () => 30,
      pedidos: [
        P({ lines: [L({ qtyOpen: 8, state: 'confirmed' })] }),
        P({ lines: [L({ qtyOpen: 5, state: 'BO' })] }),
        P({ lines: [L({ qtyOpen: 3, state: 'ASIG' })] }),
      ],
    });
    expect(d.fisico).toBe(30);
    expect(d.comprometido).toBe(11); // 8 + 3 (BO no cuenta)
    expect(d.real).toBe(19); // 30 - 11
    expect(d.breakdown).toEqual({ confirmed: 8, BO: 5, ASIG: 3, WAITLIST_CPST: 0 });
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
      breakdown: { confirmed: 0, BO: 0, ASIG: 0, WAITLIST_CPST: 0 },
    });
  });
});

// v957 (2026-09-16, Fase 2): asigReserva=false NO resta stock disponible
describe('getStockRealmenteDisponible — v957 asigReserva=false', () => {
  it('ASIG con asigReserva=true reserva stock (comportamiento pre-v956)', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 5, state: 'ASIG', asigReserva: true })] })],
    });
    expect(r).toBe(15);
  });

  // v1402 §40.10 (2026-10-21): ASIG siempre reserva, sin excepción. El guard
  // `asigReserva === false` para state='ASIG' fue eliminado. Si Pablo decide
  // no reservar, la línea revierte a BO (closedReason='asig_destildada_por_admin').
  it('v1402 §40.10: ASIG con asigReserva=false AHORA RESERVA (regla §40 estricta)', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 5, state: 'ASIG', asigReserva: false })] })],
    });
    expect(r).toBe(15);
  });

  it('ASIG sin asigReserva (undefined) reserva por default — retrocompat pre-v956', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [P({ lines: [L({ qtyOpen: 5, state: 'ASIG' })] })],
    });
    // Sin field asigReserva, default true → reserva.
    expect(r).toBe(15);
  });

  it('v1402 §40.10: mix: BO NO reserva, ASIG con y sin reserva AMBAS reservan (§40)', () => {
    const r = getStockRealmenteDisponible('SKU1', {
      getStockFisico: () => 20,
      pedidos: [
        P({ lines: [L({ qtyOpen: 3, state: 'BO' })] }),
        P({ lines: [L({ qtyOpen: 4, state: 'ASIG', asigReserva: true })] }),
        P({ lines: [L({ qtyOpen: 6, state: 'ASIG', asigReserva: false })] }),
      ],
    });
    // 20 - 0 (BO) - 4 - 6 = 10 (ASIG siempre reserva)
    expect(r).toBe(10);
  });
});

describe('getStockDesglose — v1402 §40.10 ASIG siempre reserva', () => {
  it('ASIG con asigReserva=false AHORA cuenta en breakdown.ASIG y en comprometido', () => {
    const d = getStockDesglose('SKU1', {
      getStockFisico: () => 20,
      pedidos: [
        P({ lines: [L({ qtyOpen: 4, state: 'ASIG', asigReserva: true })] }),
        P({ lines: [L({ qtyOpen: 6, state: 'ASIG', asigReserva: false })] }),
      ],
    });
    expect(d.breakdown.ASIG).toBe(10);
    expect(d.comprometido).toBe(10);
    expect(d.real).toBe(10);
  });
});

// v959 (2026-09-16): expiracion de reserva a 15 dias desde asigAt
describe('getStockRealmenteDisponible — v959 expiracion 7 dias', () => {
  const now = new Date('2026-09-16T12:00:00Z').getTime();
  const iso = (daysAgo) => new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  it('ASIG con reserva RECIENTE (<7d) sigue reservando', () => {
    const r = getStockRealmenteDisponible(
      'SKU1',
      {
        getStockFisico: () => 20,
        pedidos: [
          P({ lines: [L({ qtyOpen: 5, state: 'ASIG', asigReserva: true, asigAt: iso(5) })] }),
        ],
      },
      { now }
    );
    expect(r).toBe(15);
  });

  it('ASIG con reserva EXPIRADA (>7d) deja de reservar', () => {
    const r = getStockRealmenteDisponible(
      'SKU1',
      {
        getStockFisico: () => 20,
        pedidos: [
          P({ lines: [L({ qtyOpen: 5, state: 'ASIG', asigReserva: true, asigAt: iso(20) })] }),
        ],
      },
      { now }
    );
    expect(r).toBe(20); // 20 - 0 = 20
  });

  it('ASIG con asigReserva=true justo en el limite (7d) sigue reservando', () => {
    const r = getStockRealmenteDisponible(
      'SKU1',
      {
        getStockFisico: () => 20,
        pedidos: [
          P({ lines: [L({ qtyOpen: 5, state: 'ASIG', asigReserva: true, asigAt: iso(7) })] }),
        ],
      },
      { now }
    );
    expect(r).toBe(15); // <= 7 dias => reserva, 20 - 5 = 15
  });

  it('expiracion aplica a P/A tambien (independiente del cliTipo)', () => {
    // No hay cliTipo en la line — la expiracion se basa solo en asigAt.
    // Aunque asigReserva=true, expira despues de 15d.
    const r = getStockRealmenteDisponible(
      'SKU1',
      {
        getStockFisico: () => 20,
        pedidos: [
          P({ lines: [L({ qtyOpen: 8, state: 'ASIG', asigReserva: true, asigAt: iso(30) })] }),
        ],
      },
      { now }
    );
    expect(r).toBe(20);
  });

  it('ASIG sin asigAt (legacy) sigue reservando por default', () => {
    const r = getStockRealmenteDisponible(
      'SKU1',
      {
        getStockFisico: () => 20,
        pedidos: [P({ lines: [L({ qtyOpen: 5, state: 'ASIG' })] })],
      },
      { now }
    );
    expect(r).toBe(15);
  });

  it('v1402 §40.10: mix expirada + reciente + confirmed + asigReserva=false', () => {
    const r = getStockRealmenteDisponible(
      'SKU1',
      {
        getStockFisico: () => 20,
        pedidos: [
          P({ lines: [L({ qtyOpen: 3, state: 'confirmed' })] }),
          P({ lines: [L({ qtyOpen: 4, state: 'ASIG', asigReserva: true, asigAt: iso(5) })] }),
          P({ lines: [L({ qtyOpen: 6, state: 'ASIG', asigReserva: true, asigAt: iso(20) })] }), // expirada por TTL
          P({ lines: [L({ qtyOpen: 2, state: 'ASIG', asigReserva: false, asigAt: iso(5) })] }), // §40.10 ahora reserva
        ],
      },
      { now }
    );
    // 20 - 3 (confirmed) - 4 (ASIG reciente) - 0 (expirada) - 2 (asigReserva=false ahora reserva) = 11
    expect(r).toBe(11);
  });
});

describe('getStockDesglose — v959 expiracion 7 dias', () => {
  const now = new Date('2026-09-16T12:00:00Z').getTime();
  const iso = (daysAgo) => new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  it('breakdown.ASIG NO cuenta las lineas expiradas (>15d)', () => {
    const d = getStockDesglose(
      'SKU1',
      {
        getStockFisico: () => 20,
        pedidos: [
          P({ lines: [L({ qtyOpen: 3, state: 'ASIG', asigReserva: true, asigAt: iso(5) })] }),
          P({ lines: [L({ qtyOpen: 4, state: 'ASIG', asigReserva: true, asigAt: iso(20) })] }), // expirada
        ],
      },
      { now }
    );
    // El ejemplo de Mariano: de las 4 unid solo 3 con reserva -> muestra 3
    expect(d.breakdown.ASIG).toBe(3);
    expect(d.comprometido).toBe(3);
    expect(d.real).toBe(17);
  });
});

// v963 (2026-09-17): expiracion 15 dias tambien para state='confirmed'
describe('lineReservesStock — v963 confirmed expira a 7d desde confirmedAt', () => {
  const now = new Date('2026-09-17T12:00:00Z').getTime();
  const isoDaysAgo = (d) => new Date(now - d * DAY_MS).toISOString();
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('confirmed RECIENTE (<7d) sigue reservando', () => {
    const line = { state: 'confirmed', qtyOpen: 5 };
    const pedido = { confirmedAt: isoDaysAgo(5) };
    expect(lineReservesStock(line, now, pedido)).toBe(true);
  });

  it('confirmed EXPIRADA (>7d) deja de reservar', () => {
    const line = { state: 'confirmed', qtyOpen: 5 };
    const pedido = { confirmedAt: isoDaysAgo(20) };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('confirmed en el limite exacto (7d) sigue reservando', () => {
    const line = { state: 'confirmed', qtyOpen: 5 };
    const pedido = { confirmedAt: isoDaysAgo(7) };
    expect(lineReservesStock(line, now, pedido)).toBe(true);
  });

  it('confirmed sin pedido (v1384): data corrupta → NO reserva', () => {
    // v1384 (2026-10-21): guard defensivo. Antes (pre-v1384) devolvia true
    // ("backwards-compat pre-v963"). Nuevo comportamiento: sin pedido o
    // sin confirmedAt la linea no reserva. CLAUDE.md §36.
    const line = { state: 'confirmed', qtyOpen: 5 };
    expect(lineReservesStock(line, now)).toBe(false);
  });

  it('confirmed sin confirmedAt en pedido (v1384): data corrupta → NO reserva', () => {
    const line = { state: 'confirmed', qtyOpen: 5 };
    const pedido = {}; // sin confirmedAt
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  // v1392 §40: BO NO reserva stock. Tests invertidos.
  it('v1392 §40: BO sin pedido NO reserva', () => {
    const line = { state: 'BO', qtyOpen: 5 };
    expect(lineReservesStock(line, now)).toBe(false);
  });

  it('v1392 §40: BO con pedido sin createdAt NO reserva', () => {
    const line = { state: 'BO', qtyOpen: 5 };
    const pedido = {};
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('v1392 §40: BO con createdAt reciente NO reserva', () => {
    const line = { state: 'BO', qtyOpen: 5 };
    const pedido = { createdAt: isoDaysAgo(5) };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('v1392 §40: BO con createdAt >90d NO reserva (siempre false)', () => {
    const line = { state: 'BO', qtyOpen: 5 };
    const pedido = { createdAt: isoDaysAgo(91) };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('v1392 §40: BOs vigentes NO bloquean stock — libre completo', () => {
    const r = getStockRealmenteDisponible(
      'SKU1',
      {
        getStockFisico: () => 20,
        pedidos: [
          P({ createdAt: isoDaysAgo(5), lines: [L({ qtyOpen: 5, state: 'BO' })] }),
          P({ createdAt: isoDaysAgo(30), lines: [L({ qtyOpen: 7, state: 'BO' })] }),
        ],
      },
      { now }
    );
    expect(r).toBe(20); // Fisico completo, BO no reserva.
  });
});

describe('getStockRealmenteDisponible — v963 confirmed expirada libera stock', () => {
  const now = new Date('2026-09-17T12:00:00Z').getTime();
  const iso = (d) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

  it('caso ejemplo Mariano: confirmed >7d deja de bloquear stock', () => {
    // v1198: TTL cambiado a 7d. Escenario: 25 en dep 11, 32 confirmed en 5 pedidos.
    // Reservan (≤7d): iso(5)×2 + iso(7) = 5 + 4 + 3 = 12 u. Expiran (>7d): iso(20) + iso(25) = 20 u.
    // Libre = 25 - 12 = 13.
    const r = getStockRealmenteDisponible(
      'SKU1',
      {
        getStockFisico: () => 25,
        pedidos: [
          P({ confirmedAt: iso(5), lines: [L({ qtyOpen: 5, state: 'confirmed' })] }),
          P({ confirmedAt: iso(7), lines: [L({ qtyOpen: 3, state: 'confirmed' })] }),
          P({ confirmedAt: iso(5), lines: [L({ qtyOpen: 4, state: 'confirmed' })] }),
          P({ confirmedAt: iso(20), lines: [L({ qtyOpen: 10, state: 'confirmed' })] }), // expirada >7d
          P({ confirmedAt: iso(25), lines: [L({ qtyOpen: 10, state: 'confirmed' })] }), // expirada >7d
        ],
      },
      { now }
    );
    expect(r).toBe(13);
  });
});

// Fix auditor 2026-10-02 (bugs C1 + C4): soportar Firestore Timestamp
// (toMillis/seconds) y asigReserva=0 (entero) en lineReservesStock.
describe('lineReservesStock — fix auditor 2026-10-02 Timestamp + asigReserva=0', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-10-02T12:00:00Z').getTime();
  // Helpers para fabricar diferentes formatos de timestamp.
  const tsToMillis = (ms) => ({ toMillis: () => ms });
  const tsSeconds = (ms) => ({
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
  });

  it('C1: ASIG con asigAt como Firestore Timestamp (toMillis) expirado -> no reserva', () => {
    const expired = now - 12 * DAY_MS;
    const line = { state: 'ASIG', qtyOpen: 5, asigReserva: true, asigAt: tsToMillis(expired) };
    expect(lineReservesStock(line, now)).toBe(false);
  });

  it('C1: ASIG con asigAt como plain {seconds,nanoseconds} expirado -> no reserva', () => {
    const expired = now - 12 * DAY_MS;
    const line = { state: 'ASIG', qtyOpen: 5, asigReserva: true, asigAt: tsSeconds(expired) };
    expect(lineReservesStock(line, now)).toBe(false);
  });

  it('C1: ASIG con asigAt Timestamp FRESCA (<15d) -> si reserva', () => {
    const fresh = now - 5 * DAY_MS;
    const line = { state: 'ASIG', qtyOpen: 5, asigReserva: true, asigAt: tsToMillis(fresh) };
    expect(lineReservesStock(line, now)).toBe(true);
  });

  it('C4 v1402 §40.10: ASIG con asigReserva=0 (entero legacy/SAP) AHORA RESERVA', () => {
    // SAP serializa booleanos como 0/1 enteros. Pre-v1402 el guard
    // `asigReserva === 0` liberaba la línea. Post-v1402 (§40.10) ASIG siempre
    // reserva, sin excepción.
    const line = { state: 'ASIG', qtyOpen: 5, asigReserva: 0 };
    expect(lineReservesStock(line, now)).toBe(true);
  });

  it('C4: ASIG con asigReserva=1 (entero legacy) -> si reserva (equivalente a true)', () => {
    const line = { state: 'ASIG', qtyOpen: 5, asigReserva: 1 };
    expect(lineReservesStock(line, now)).toBe(true);
  });

  it('C1: BO con pedido.createdAt como Firestore Timestamp expirado (>90d, v1388) -> no reserva', () => {
    const expired = now - 95 * DAY_MS;
    const line = { state: 'BO', qtyOpen: 5 };
    const pedido = { createdAt: tsToMillis(expired) };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('v1392 §40: BO con pedido.createdAt como {seconds} NO reserva', () => {
    const fresh = now - 5 * DAY_MS;
    const line = { state: 'BO', qtyOpen: 5 };
    const pedido = { createdAt: tsSeconds(fresh) };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('C1: confirmed con pedido.confirmedAt como Firestore Timestamp expirado -> no reserva', () => {
    const expired = now - 12 * DAY_MS;
    const line = { state: 'confirmed', qtyOpen: 5 };
    const pedido = { confirmedAt: tsToMillis(expired) };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('C1: confirmed con pedido.confirmedAt como {seconds} expirado -> no reserva', () => {
    const expired = now - 12 * DAY_MS;
    const line = { state: 'confirmed', qtyOpen: 5 };
    const pedido = { confirmedAt: tsSeconds(expired) };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('C1: confirmed con confirmedAt como Date object fresca -> si reserva', () => {
    const fresh = new Date(now - 5 * DAY_MS);
    const line = { state: 'confirmed', qtyOpen: 5 };
    const pedido = { confirmedAt: fresh };
    expect(lineReservesStock(line, now, pedido)).toBe(true);
  });

  it('C1: regresion — pre-fix new Date(timestampObj).getTime() daba NaN y la expiracion se salteaba', () => {
    // Antes del fix: new Date({toMillis: () => X}).getTime() === NaN,
    // Number.isFinite(NaN) === false -> if nunca entraba -> la fn retornaba
    // true "para siempre". Ahora el expired debe devolver false.
    // ASIG/confirmed: expiran a 7d. BO v1388: expira a 90d. Usamos 30d para
    // ASIG+confirmed (expiran) y 95d para BO (expira red seguridad).
    const expired7 = now - 30 * DAY_MS;
    const expired90 = now - 95 * DAY_MS;
    const line1 = { state: 'ASIG', qtyOpen: 5, asigReserva: true, asigAt: tsToMillis(expired7) };
    const line2 = { state: 'confirmed', qtyOpen: 5 };
    const pedido2 = { confirmedAt: tsSeconds(expired7) };
    const line3 = { state: 'BO', qtyOpen: 5 };
    const pedido3 = { createdAt: tsToMillis(expired90) };
    expect(lineReservesStock(line1, now)).toBe(false);
    expect(lineReservesStock(line2, now, pedido2)).toBe(false);
    expect(lineReservesStock(line3, now, pedido3)).toBe(false);
  });

  it('v1269: confirmed con asigReserva=false (toggle admin) -> no reserva', () => {
    // Mariano destildo el checkbox "Reserva stock" en modal Stock Asignado
    // para una linea confirmed. Pre-v1269 el flag se ignoraba en confirmed →
    // las unidades seguian reservadas. Ahora libera igual que en ASIG.
    const fresh = now - 3 * DAY_MS;
    const line = { state: 'confirmed', qtyOpen: 2, asigReserva: false };
    const pedido = { confirmedAt: fresh };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('v1269: confirmed con asigReserva=0 (entero SAP) -> no reserva', () => {
    // SAP serializa booleanos como 0/1 enteros. Mirror del guard de ASIG.
    const fresh = now - 3 * DAY_MS;
    const line = { state: 'confirmed', qtyOpen: 2, asigReserva: 0 };
    const pedido = { confirmedAt: fresh };
    expect(lineReservesStock(line, now, pedido)).toBe(false);
  });

  it('v1269: confirmed con asigReserva=true (default) -> si reserva', () => {
    // Backwards-compat: lineas confirmed pre-v1269 (asigReserva=undefined) y
    // post-v1269 con flag=true siguen reservando normalmente.
    const fresh = now - 3 * DAY_MS;
    const lineUndef = { state: 'confirmed', qtyOpen: 2 };
    const lineTrue = { state: 'confirmed', qtyOpen: 2, asigReserva: true };
    const pedido = { confirmedAt: fresh };
    expect(lineReservesStock(lineUndef, now, pedido)).toBe(true);
    expect(lineReservesStock(lineTrue, now, pedido)).toBe(true);
  });
});
