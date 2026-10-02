import { describe, expect, it } from 'vitest';
import { columnEnteredAt, formatAge } from '../../src/pure/planner-column-age.js';

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
