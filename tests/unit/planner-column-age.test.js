import { describe, expect, it } from 'vitest';
import {
  columnBreakdown,
  columnEnteredAt,
  columnStats,
  formatAge,
} from '../../src/pure/planner-column-age.js';

// Fijo arbitrario: 2026-10-02 15:00:00 UTC.
const NOW = Date.parse('2026-10-02T15:00:00.000Z');

// Helpers de timestamps para legibilidad.
const minutes = (n) => n * 60 * 1000;
const hours = (n) => n * 60 * 60 * 1000;
const days = (n) => n * 24 * 60 * 60 * 1000;

describe('columnEnteredAt', () => {
  describe('null-safety', () => {
    it('pedido null → null', () => {
      expect(columnEnteredAt(null)).toBe(null);
    });
    it('pedido undefined → null', () => {
      expect(columnEnteredAt(undefined)).toBe(null);
    });
    it('pedido vacío (lista_espera por default) sin createdAt → null', () => {
      expect(columnEnteredAt({})).toBe(null);
    });
  });

  describe('lista_espera', () => {
    it('usa createdAt (ISO string)', () => {
      const ped = { createdAt: '2026-09-28T10:00:00.000Z' };
      expect(columnEnteredAt(ped, 'lista_espera')).toBe(Date.parse('2026-09-28T10:00:00.000Z'));
    });
    it('usa createdAt (number ms)', () => {
      const ped = { createdAt: 1759046400000 };
      expect(columnEnteredAt(ped, 'lista_espera')).toBe(1759046400000);
    });
    it('usa createdAt (Firestore Timestamp con toMillis)', () => {
      const ped = { createdAt: { toMillis: () => 1759046400000, seconds: 1759046400 } };
      expect(columnEnteredAt(ped, 'lista_espera')).toBe(1759046400000);
    });
    it('usa createdAt (plain {seconds, nanoseconds})', () => {
      const ped = { createdAt: { seconds: 1759046400, nanoseconds: 500000000 } };
      expect(columnEnteredAt(ped, 'lista_espera')).toBe(1759046400500);
    });
    it('sin createdAt → null (no hay fallback)', () => {
      expect(columnEnteredAt({ foo: 'bar' }, 'lista_espera')).toBe(null);
    });
  });

  describe('oferta', () => {
    it('usa transferidoSAP.transferredAt cuando existe', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        transferidoSAP: {
          docNum: 1234,
          transferredAt: '2026-09-29T10:00:00.000Z',
        },
      };
      expect(columnEnteredAt(ped, 'oferta')).toBe(Date.parse('2026-09-29T10:00:00.000Z'));
    });
    it('pedido viejo sin transferredAt → fallback a createdAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        transferidoSAP: { docNum: 1234 },
      };
      expect(columnEnteredAt(ped, 'oferta')).toBe(Date.parse('2026-09-28T10:00:00.000Z'));
    });
  });

  describe('ordenes', () => {
    it('usa transferidoSAP.orderSyncedAt cuando existe', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        transferidoSAP: {
          docNum: 1234,
          transferredAt: '2026-09-29T10:00:00.000Z',
          orderDocEntry: 999,
          orderSyncedAt: '2026-09-30T10:00:00.000Z',
        },
      };
      expect(columnEnteredAt(ped, 'ordenes')).toBe(Date.parse('2026-09-30T10:00:00.000Z'));
    });
    it('pedido viejo sin orderSyncedAt → fallback a transferredAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        transferidoSAP: {
          docNum: 1234,
          transferredAt: '2026-09-29T10:00:00.000Z',
          orderDocEntry: 999,
        },
      };
      expect(columnEnteredAt(ped, 'ordenes')).toBe(Date.parse('2026-09-29T10:00:00.000Z'));
    });
    it('sin transferredAt ni orderSyncedAt → fallback a createdAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        transferidoSAP: { docNum: 1234, orderDocEntry: 999 },
      };
      expect(columnEnteredAt(ped, 'ordenes')).toBe(Date.parse('2026-09-28T10:00:00.000Z'));
    });
  });

  describe('facturar', () => {
    it('usa firstInvoicedAt (nuevo campo Pack #5A) cuando existe', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        firstInvoicedAt: '2026-10-01T10:00:00.000Z',
        transferidoSAP: {
          docNum: 1234,
          transferredAt: '2026-09-29T10:00:00.000Z',
          orderSyncedAt: '2026-09-30T10:00:00.000Z',
        },
      };
      expect(columnEnteredAt(ped, 'facturar')).toBe(Date.parse('2026-10-01T10:00:00.000Z'));
    });
    it('pedido viejo (pre Pack #5A) sin firstInvoicedAt → fallback a orderSyncedAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        transferidoSAP: {
          docNum: 1234,
          transferredAt: '2026-09-29T10:00:00.000Z',
          orderSyncedAt: '2026-09-30T10:00:00.000Z',
        },
        lines: [{ qtyInvoiced: 5 }],
      };
      expect(columnEnteredAt(ped, 'facturar')).toBe(Date.parse('2026-09-30T10:00:00.000Z'));
    });
    it('pedido viejo sin ningun timestamp SAP → fallback a createdAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        lines: [{ qtyInvoiced: 5 }],
      };
      expect(columnEnteredAt(ped, 'facturar')).toBe(Date.parse('2026-09-28T10:00:00.000Z'));
    });
  });

  describe('cobrado', () => {
    it('usa cobradoAt (nuevo campo Pack #5A) cuando existe', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        firstInvoicedAt: '2026-10-01T10:00:00.000Z',
        cobradoAt: '2026-10-02T10:00:00.000Z',
        paidStatus: 'paid',
      };
      expect(columnEnteredAt(ped, 'cobrado')).toBe(Date.parse('2026-10-02T10:00:00.000Z'));
    });
    it('usa paidAt como alias cuando no hay cobradoAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        paidAt: '2026-10-02T10:00:00.000Z',
        paidStatus: 'paid',
      };
      expect(columnEnteredAt(ped, 'cobrado')).toBe(Date.parse('2026-10-02T10:00:00.000Z'));
    });
    it('pedido viejo (pre Pack #5A) sin cobradoAt ni paidAt → fallback a firstInvoicedAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        firstInvoicedAt: '2026-10-01T10:00:00.000Z',
        paidStatus: 'paid',
      };
      expect(columnEnteredAt(ped, 'cobrado')).toBe(Date.parse('2026-10-01T10:00:00.000Z'));
    });
    it('pedido muy viejo sin ningún timestamp intermedio → fallback a createdAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        paidStatus: 'paid',
      };
      expect(columnEnteredAt(ped, 'cobrado')).toBe(Date.parse('2026-09-28T10:00:00.000Z'));
    });
  });

  describe('autodetección de columna (sin pasar `column`)', () => {
    it('pedido lista_espera (sin transferidoSAP) → usa createdAt', () => {
      const ped = { createdAt: '2026-09-28T10:00:00.000Z' };
      expect(columnEnteredAt(ped)).toBe(Date.parse('2026-09-28T10:00:00.000Z'));
    });
    it('pedido oferta (con docNum) → usa transferredAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        transferidoSAP: {
          docNum: 1234,
          transferredAt: '2026-09-29T10:00:00.000Z',
        },
      };
      expect(columnEnteredAt(ped)).toBe(Date.parse('2026-09-29T10:00:00.000Z'));
    });
    it('pedido cobrado (paidStatus=paid) con cobradoAt → usa cobradoAt', () => {
      const ped = {
        createdAt: '2026-09-28T10:00:00.000Z',
        cobradoAt: '2026-10-02T10:00:00.000Z',
        paidStatus: 'paid',
      };
      expect(columnEnteredAt(ped)).toBe(Date.parse('2026-10-02T10:00:00.000Z'));
    });
  });

  describe('column desconocido → fallback a lista_espera', () => {
    it('column "no_existe" → usa createdAt', () => {
      const ped = { createdAt: '2026-09-28T10:00:00.000Z' };
      expect(columnEnteredAt(ped, 'no_existe')).toBe(Date.parse('2026-09-28T10:00:00.000Z'));
    });
  });
});

describe('formatAge', () => {
  describe('null-safety', () => {
    it('null → ""', () => {
      expect(formatAge(null)).toBe('');
    });
    it('undefined → ""', () => {
      expect(formatAge(undefined)).toBe('');
    });
    it('NaN → ""', () => {
      expect(formatAge(Number.NaN)).toBe('');
    });
    it('Infinity → ""', () => {
      expect(formatAge(Number.POSITIVE_INFINITY)).toBe('');
    });
  });

  describe('< 1 minuto → "ahora"', () => {
    it('0 ms (futuro clamp) → "ahora"', () => {
      expect(formatAge(NOW, NOW)).toBe('ahora');
    });
    it('30 segundos → "ahora"', () => {
      expect(formatAge(NOW - 30 * 1000, NOW)).toBe('ahora');
    });
    it('59 segundos → "ahora"', () => {
      expect(formatAge(NOW - 59 * 1000, NOW)).toBe('ahora');
    });
    it('timestamp futuro (reloj mal sincronizado) → "ahora"', () => {
      expect(formatAge(NOW + 5000, NOW)).toBe('ahora');
    });
  });

  describe('< 1 hora → "Nm"', () => {
    it('60 segundos exactos → "1m"', () => {
      expect(formatAge(NOW - minutes(1), NOW)).toBe('1m');
    });
    it('5 minutos → "5m"', () => {
      expect(formatAge(NOW - minutes(5), NOW)).toBe('5m');
    });
    it('59 minutos → "59m"', () => {
      expect(formatAge(NOW - minutes(59), NOW)).toBe('59m');
    });
  });

  describe('< 1 día → "Nh" / "Nh Nm"', () => {
    it('60 minutos exactos → "1h"', () => {
      expect(formatAge(NOW - hours(1), NOW)).toBe('1h');
    });
    it('1h 30m → "1h 30m"', () => {
      expect(formatAge(NOW - (hours(1) + minutes(30)), NOW)).toBe('1h 30m');
    });
    it('5h sin minutos sobrantes → "5h"', () => {
      expect(formatAge(NOW - hours(5), NOW)).toBe('5h');
    });
    it('9h 45m → "9h 45m" (menor a 10h muestra minutos)', () => {
      expect(formatAge(NOW - (hours(9) + minutes(45)), NOW)).toBe('9h 45m');
    });
    it('10h 30m → "10h" (desde 10h se omiten minutos)', () => {
      expect(formatAge(NOW - (hours(10) + minutes(30)), NOW)).toBe('10h');
    });
    it('23h → "23h"', () => {
      expect(formatAge(NOW - hours(23), NOW)).toBe('23h');
    });
  });

  describe('< 30 días → "Nd" / "Nd Nh"', () => {
    it('24h exactas → "1d"', () => {
      expect(formatAge(NOW - days(1), NOW)).toBe('1d');
    });
    it('1d 5h → "1d 5h"', () => {
      expect(formatAge(NOW - (days(1) + hours(5)), NOW)).toBe('1d 5h');
    });
    it('3d sin horas sobrantes → "3d"', () => {
      expect(formatAge(NOW - days(3), NOW)).toBe('3d');
    });
    it('9d 23h → "9d 23h"', () => {
      expect(formatAge(NOW - (days(9) + hours(23)), NOW)).toBe('9d 23h');
    });
    it('10d con horas → "10d" (desde 10d se omiten horas)', () => {
      expect(formatAge(NOW - (days(10) + hours(5)), NOW)).toBe('10d');
    });
    it('29d → "29d"', () => {
      expect(formatAge(NOW - days(29), NOW)).toBe('29d');
    });
  });

  describe('< 12 meses → "N mes" / "N meses"', () => {
    it('30d → "1 mes"', () => {
      expect(formatAge(NOW - days(30), NOW)).toBe('1 mes');
    });
    it('60d → "2 meses"', () => {
      expect(formatAge(NOW - days(60), NOW)).toBe('2 meses');
    });
    it('11 meses (330d) → "11 meses"', () => {
      expect(formatAge(NOW - days(330), NOW)).toBe('11 meses');
    });
  });

  describe('>= 12 meses → "N año" / "N años"', () => {
    it('12 meses (360d) → "1 año"', () => {
      expect(formatAge(NOW - days(360), NOW)).toBe('1 año');
    });
    it('24 meses (720d) → "2 años"', () => {
      expect(formatAge(NOW - days(720), NOW)).toBe('2 años');
    });
  });

  describe('nowMs default', () => {
    it('sin nowMs usa Date.now() implícito y devuelve algo no-vacío', () => {
      const resultado = formatAge(Date.now() - hours(2));
      expect(resultado).toMatch(/h/);
    });
  });
});

describe('columnBreakdown', () => {
  describe('null-safety', () => {
    it('pedido null → []', () => {
      expect(columnBreakdown(null, NOW)).toEqual([]);
    });
    it('pedido undefined → []', () => {
      expect(columnBreakdown(undefined, NOW)).toEqual([]);
    });
    it('pedido vacío (sin ningún timestamp) → []', () => {
      expect(columnBreakdown({}, NOW)).toEqual([]);
    });
    it('pedido con campo irrelevante → []', () => {
      expect(columnBreakdown({ foo: 'bar' }, NOW)).toEqual([]);
    });
  });

  describe('breakdown single-stage', () => {
    it('pedido solo con createdAt → 1 etapa lista_espera (actual)', () => {
      const createdAt = NOW - days(3);
      const ped = { createdAt };
      const res = columnBreakdown(ped, NOW);
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual({
        column: 'lista_espera',
        enteredAt: createdAt,
        exitedAt: null,
        durationMs: days(3),
      });
    });
  });

  describe('breakdown multi-stage completo', () => {
    it('5 etapas (lista_espera → oferta → ordenes → facturar → cobrado) encadenan exitedAt', () => {
      const t0 = NOW - days(10);
      const t1 = NOW - days(8);
      const t2 = NOW - days(6);
      const t3 = NOW - days(3);
      const t4 = NOW - days(1);
      const ped = {
        createdAt: t0,
        transferidoSAP: {
          docNum: 1234,
          transferredAt: t1,
          orderSyncedAt: t2,
          orderDocEntry: 999,
        },
        firstInvoicedAt: t3,
        cobradoAt: t4,
        paidStatus: 'paid',
      };
      const res = columnBreakdown(ped, NOW);
      expect(res).toHaveLength(5);
      expect(res[0]).toEqual({
        column: 'lista_espera',
        enteredAt: t0,
        exitedAt: t1,
        durationMs: t1 - t0,
      });
      expect(res[1]).toEqual({
        column: 'oferta',
        enteredAt: t1,
        exitedAt: t2,
        durationMs: t2 - t1,
      });
      expect(res[2]).toEqual({
        column: 'ordenes',
        enteredAt: t2,
        exitedAt: t3,
        durationMs: t3 - t2,
      });
      expect(res[3]).toEqual({
        column: 'facturar',
        enteredAt: t3,
        exitedAt: t4,
        durationMs: t4 - t3,
      });
      expect(res[4]).toEqual({
        column: 'cobrado',
        enteredAt: t4,
        exitedAt: null,
        durationMs: NOW - t4,
      });
    });
  });

  describe('breakdown con gaps (etapas intermedias ausentes)', () => {
    it('createdAt + firstInvoicedAt (sin transferredAt/orderSyncedAt) → 2 etapas', () => {
      const t0 = NOW - days(5);
      const t3 = NOW - days(1);
      const ped = {
        createdAt: t0,
        firstInvoicedAt: t3,
      };
      const res = columnBreakdown(ped, NOW);
      expect(res).toHaveLength(2);
      expect(res[0].column).toBe('lista_espera');
      expect(res[0].enteredAt).toBe(t0);
      expect(res[0].exitedAt).toBe(t3);
      expect(res[0].durationMs).toBe(t3 - t0);
      expect(res[1].column).toBe('facturar');
      expect(res[1].enteredAt).toBe(t3);
      expect(res[1].exitedAt).toBe(null);
      expect(res[1].durationMs).toBe(NOW - t3);
    });
    it('createdAt + orderSyncedAt (sin transferredAt) → 2 etapas (lista_espera + ordenes)', () => {
      const t0 = NOW - days(7);
      const t2 = NOW - days(2);
      const ped = {
        createdAt: t0,
        transferidoSAP: { docNum: 1234, orderSyncedAt: t2 },
      };
      const res = columnBreakdown(ped, NOW);
      expect(res).toHaveLength(2);
      expect(res.map((r) => r.column)).toEqual(['lista_espera', 'ordenes']);
    });
  });

  describe('última etapa siempre tiene exitedAt=null', () => {
    it('cada caso termina con exitedAt=null en la última entrada', () => {
      const casos = [
        { createdAt: NOW - hours(1) },
        {
          createdAt: NOW - days(3),
          transferidoSAP: { docNum: 1234, transferredAt: NOW - days(2) },
        },
        {
          createdAt: NOW - days(10),
          transferidoSAP: {
            docNum: 1234,
            transferredAt: NOW - days(8),
            orderSyncedAt: NOW - days(5),
          },
          firstInvoicedAt: NOW - days(2),
        },
      ];
      for (const ped of casos) {
        const res = columnBreakdown(ped, NOW);
        expect(res.length).toBeGreaterThan(0);
        expect(res[res.length - 1].exitedAt).toBe(null);
      }
    });
  });

  describe('timestamps como Firestore Timestamp', () => {
    it('toMillis() funciona en TODOS los pickers', () => {
      const t0 = NOW - days(5);
      const t1 = NOW - days(3);
      const ped = {
        createdAt: { toMillis: () => t0, seconds: Math.floor(t0 / 1000) },
        transferidoSAP: {
          docNum: 1234,
          transferredAt: { toMillis: () => t1, seconds: Math.floor(t1 / 1000) },
        },
      };
      const res = columnBreakdown(ped, NOW);
      expect(res).toHaveLength(2);
      expect(res[0].enteredAt).toBe(t0);
      expect(res[1].enteredAt).toBe(t1);
    });
    it('plain {seconds, nanoseconds} funciona', () => {
      const t0 = NOW - days(3);
      const ped = {
        createdAt: { seconds: Math.floor(t0 / 1000), nanoseconds: 0 },
      };
      const res = columnBreakdown(ped, NOW);
      expect(res).toHaveLength(1);
      expect(res[0].enteredAt).toBe(Math.floor(t0 / 1000) * 1000);
    });
  });

  describe('paidAt como fallback de cobradoAt', () => {
    it('sin cobradoAt pero con paidAt → cobrado usa paidAt', () => {
      const t0 = NOW - days(5);
      const t4 = NOW - days(1);
      const ped = {
        createdAt: t0,
        paidAt: t4,
      };
      const res = columnBreakdown(ped, NOW);
      expect(res).toHaveLength(2);
      expect(res.map((r) => r.column)).toEqual(['lista_espera', 'cobrado']);
      expect(res[1].enteredAt).toBe(t4);
    });
    it('cobradoAt gana sobre paidAt cuando ambos existen', () => {
      const t0 = NOW - days(5);
      const tCobrado = NOW - days(1);
      const tPaid = NOW - days(2);
      const ped = {
        createdAt: t0,
        cobradoAt: tCobrado,
        paidAt: tPaid,
      };
      const res = columnBreakdown(ped, NOW);
      expect(res[res.length - 1].enteredAt).toBe(tCobrado);
    });
  });

  describe('nowMs custom', () => {
    it('respeta el nowMs inyectado para la última etapa', () => {
      const customNow = Date.parse('2027-01-01T00:00:00.000Z');
      const t0 = customNow - days(10);
      const ped = { createdAt: t0 };
      const res = columnBreakdown(ped, customNow);
      expect(res[0].durationMs).toBe(days(10));
    });
    it('nowMs no-finito cae a Date.now() implícito', () => {
      const ped = { createdAt: Date.now() - hours(2) };
      const res = columnBreakdown(ped, Number.NaN);
      expect(res).toHaveLength(1);
      expect(res[0].durationMs).toBeGreaterThan(0);
    });
  });
});

describe('columnStats', () => {
  describe('null-safety', () => {
    it('array vacío → null', () => {
      expect(columnStats([], 'lista_espera', NOW)).toBe(null);
    });
    it('null → null', () => {
      expect(columnStats(null, 'lista_espera', NOW)).toBe(null);
    });
    it('undefined → null', () => {
      expect(columnStats(undefined, 'lista_espera', NOW)).toBe(null);
    });
    it('array con solo pedidos de otra columna → null', () => {
      const pedidos = [
        {
          createdAt: NOW - days(2),
          transferidoSAP: { docNum: 1234, transferredAt: NOW - days(1) },
        }, // oferta
      ];
      expect(columnStats(pedidos, 'lista_espera', NOW)).toBe(null);
    });
    it('array con pedidos en la columna pero sin timestamp resoluble → null', () => {
      const pedidos = [{ foo: 'bar' }]; // computeColumn='lista_espera' pero sin createdAt
      expect(columnStats(pedidos, 'lista_espera', NOW)).toBe(null);
    });
  });

  describe('1 pedido', () => {
    it('devuelve avg=median=max=age y count=1', () => {
      const pedidos = [{ createdAt: NOW - days(3) }];
      const stats = columnStats(pedidos, 'lista_espera', NOW);
      expect(stats).not.toBe(null);
      expect(stats.count).toBe(1);
      expect(stats.avgMs).toBe(days(3));
      expect(stats.medianMs).toBe(days(3));
      expect(stats.maxMs).toBe(days(3));
    });
  });

  describe('3 pedidos en la misma columna (ages 1d, 2d, 10d)', () => {
    const pedidos = [
      { createdAt: NOW - days(1) },
      { createdAt: NOW - days(2) },
      { createdAt: NOW - days(10) },
    ];
    it('count=3', () => {
      expect(columnStats(pedidos, 'lista_espera', NOW).count).toBe(3);
    });
    it('avg = (1+2+10)/3 = 13/3 ≈ 4.33 días', () => {
      const stats = columnStats(pedidos, 'lista_espera', NOW);
      expect(stats.avgMs).toBeCloseTo(days(13 / 3), -3);
    });
    it('median = 2d (sorted[1] con count=3)', () => {
      expect(columnStats(pedidos, 'lista_espera', NOW).medianMs).toBe(days(2));
    });
    it('max = 10d', () => {
      expect(columnStats(pedidos, 'lista_espera', NOW).maxMs).toBe(days(10));
    });
  });

  describe('pedidos mixtos (distintas columnas)', () => {
    it('ignora pedidos que no están en la columna solicitada', () => {
      const pedidos = [
        { createdAt: NOW - days(3) }, // lista_espera
        { createdAt: NOW - days(1) }, // lista_espera
        {
          createdAt: NOW - days(5),
          transferidoSAP: { docNum: 1234, transferredAt: NOW - days(2) },
        }, // oferta
      ];
      const statsLista = columnStats(pedidos, 'lista_espera', NOW);
      expect(statsLista.count).toBe(2);
      const statsOferta = columnStats(pedidos, 'oferta', NOW);
      expect(statsOferta.count).toBe(1);
      expect(statsOferta.avgMs).toBe(days(2));
    });
  });

  describe('pedidos con timestamp irresoluble se ignoran', () => {
    it('mezcla de resolubles e irresolubles', () => {
      const pedidos = [
        { createdAt: NOW - days(1) }, // ok
        { foo: 'bar' }, // sin createdAt → ignorado
        { createdAt: NOW - days(3) }, // ok
      ];
      const stats = columnStats(pedidos, 'lista_espera', NOW);
      expect(stats.count).toBe(2);
      expect(stats.maxMs).toBe(days(3));
    });
  });

  describe('columna cobrado', () => {
    it('pedidos en cobrado se cuentan correctamente', () => {
      const pedidos = [
        {
          createdAt: NOW - days(10),
          cobradoAt: NOW - days(2),
          paidStatus: 'paid',
        },
        {
          createdAt: NOW - days(5),
          cobradoAt: NOW - days(1),
          paidStatus: 'paid',
        },
      ];
      const stats = columnStats(pedidos, 'cobrado', NOW);
      expect(stats.count).toBe(2);
      expect(stats.avgMs).toBe((days(2) + days(1)) / 2);
    });
  });

  describe('nowMs default (sin inyectar)', () => {
    it('no explota, devuelve stats con count>=1', () => {
      const pedidos = [{ createdAt: Date.now() - hours(1) }];
      const stats = columnStats(pedidos, 'lista_espera');
      expect(stats).not.toBe(null);
      expect(stats.count).toBe(1);
      expect(stats.avgMs).toBeGreaterThan(0);
    });
  });
});
