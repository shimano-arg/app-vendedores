// @ts-check
/**
 * v1474 PR1 §71 — tests parse-date-flexible.
 * Reportado Federico ORDEN 530 SUSANA ANDRILI ("Invalid Date").
 */
import { describe, expect, it } from 'vitest';
import {
  formatFirestoreDate,
  isFirestoreTimestamp,
  parseFirestoreDate,
  toIsoStringFlexible,
} from '../../src/pure/parse-date-flexible.js';

describe('v1474 §71 — parseFirestoreDate', () => {
  it('T1 string ISO → Date', () => {
    const d = parseFirestoreDate('2026-10-26T21:13:44.030Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-10-26T21:13:44.030Z');
  });

  it('T2 Date nativo → mismo Date', () => {
    const orig = new Date('2026-10-26T21:13:44.030Z');
    expect(parseFirestoreDate(orig)).toBe(orig);
  });

  it('T3 Firestore Timestamp (toDate) → Date', () => {
    const ts = {
      toDate: () => new Date('2026-10-26T21:13:44.030Z'),
    };
    const d = parseFirestoreDate(ts);
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-10-26T21:13:44.030Z');
  });

  it('T4 Firestore Timestamp (seconds/nanoseconds) → Date', () => {
    const ts = { seconds: 1793049224, nanoseconds: 30000000 };
    const d = parseFirestoreDate(ts);
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toContain('2026-10-26T21:13:44');
  });

  it('T5 Firestore Timestamp REST shape (_seconds) → Date', () => {
    const ts = { _seconds: 1793049224, _nanoseconds: 30000000 };
    const d = parseFirestoreDate(ts);
    expect(d).toBeInstanceOf(Date);
  });

  it('T6 number epoch ms → Date', () => {
    expect(parseFirestoreDate(1793049224030).toISOString()).toBe('2026-10-26T21:13:44.030Z');
  });

  it('T7 null, undefined, "", NaN → null', () => {
    expect(parseFirestoreDate(null)).toBeNull();
    expect(parseFirestoreDate(undefined)).toBeNull();
    expect(parseFirestoreDate('')).toBeNull();
    expect(parseFirestoreDate('invalid-date-string')).toBeNull();
    expect(parseFirestoreDate(new Date('invalid'))).toBeNull();
  });

  it('T8 fixture REAL Federico ORDEN 530: Timestamp admin SDK', () => {
    const tsAdminSdk = {
      toDate: () => new Date('2026-10-26T21:13:44.030Z'),
      seconds: 1793049224,
      nanoseconds: 30000000,
    };
    const d = parseFirestoreDate(tsAdminSdk);
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(1793049224030);
    // Y el string ISO que grabamos en v1473:
    expect(parseFirestoreDate('2026-10-26T21:13:44.030Z').getTime()).toBe(1793049224030);
  });
});

describe('v1474 §71 — toIsoStringFlexible', () => {
  it('T10 Timestamp → ISO string', () => {
    const ts = { seconds: 1793049224, nanoseconds: 30000000 };
    expect(toIsoStringFlexible(ts)).toContain('2026-10-26T21:13:44');
  });

  it('T11 string ISO → mismo string ISO (round-trip)', () => {
    expect(toIsoStringFlexible('2026-10-26T21:13:44.030Z')).toBe('2026-10-26T21:13:44.030Z');
  });

  it('T12 null → null', () => {
    expect(toIsoStringFlexible(null)).toBeNull();
    expect(toIsoStringFlexible(undefined)).toBeNull();
  });
});

describe('v1474 §71 — formatFirestoreDate', () => {
  it('T20 Timestamp → string legible es-AR', () => {
    const ts = { seconds: 1793049224, nanoseconds: 30000000 };
    const s = formatFirestoreDate(ts, { locale: 'es-AR', style: 'date' });
    // es-AR date corta: dd/mm/yyyy o similar.
    expect(s).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(s).not.toBe('Invalid Date');
  });

  it('T21 string ISO → string legible', () => {
    const s = formatFirestoreDate('2026-10-26T21:13:44.030Z', { locale: 'es-AR' });
    expect(s).not.toBe('Invalid Date');
    expect(s).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('T22 null → fallback por default "-"', () => {
    expect(formatFirestoreDate(null)).toBe('-');
    expect(formatFirestoreDate(undefined)).toBe('-');
  });

  it('T23 fallback personalizado', () => {
    expect(formatFirestoreDate(null, { fallback: '' })).toBe('');
    expect(formatFirestoreDate(undefined, { fallback: 'sin fecha' })).toBe('sin fecha');
  });

  it('T24 style=datetime incluye hora', () => {
    const s = formatFirestoreDate('2026-10-26T21:13:44Z', { locale: 'es-AR', style: 'datetime' });
    expect(s).toMatch(/\d{1,2}:\d{2}/);
  });

  it('T25 reproduce caso Federico: tanto ISO como Timestamp parsean iguales', () => {
    const iso = formatFirestoreDate('2026-10-26T21:13:44.030Z', { locale: 'es-AR' });
    const ts = formatFirestoreDate(
      { seconds: 1793049224, nanoseconds: 30000000 },
      { locale: 'es-AR' }
    );
    expect(iso).toBe(ts);
  });
});

describe('v1474 §71 — isFirestoreTimestamp', () => {
  it('T30 detecta Timestamp admin SDK (toDate + seconds)', () => {
    expect(isFirestoreTimestamp({ toDate: () => new Date(), seconds: 1, nanoseconds: 0 })).toBe(
      true
    );
    expect(isFirestoreTimestamp({ seconds: 1, nanoseconds: 0 })).toBe(true);
    expect(isFirestoreTimestamp({ _seconds: 1, _nanoseconds: 0 })).toBe(true);
  });

  it('T31 NO es Timestamp: string, Date, number, null, {}', () => {
    expect(isFirestoreTimestamp('2026-10-26')).toBe(false);
    expect(isFirestoreTimestamp(new Date())).toBe(false);
    expect(isFirestoreTimestamp(123456)).toBe(false);
    expect(isFirestoreTimestamp(null)).toBe(false);
    expect(isFirestoreTimestamp({})).toBe(false);
    expect(isFirestoreTimestamp({ foo: 'bar' })).toBe(false);
  });
});

describe('v1474 §71 — contrato index.html usa parseDateFlexible', () => {
  it('T40 tarjeta Pedidos > Confirmados usa el helper', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    // Al menos 2 call-sites (cc-summary normal + warning).
    const matches = (
      html.match(/parseDateFlexible\.formatFirestoreDate\(it\.conf\.confirmedAt/g) || []
    ).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  it('T41 Pedidos > Confirmados detalle usa el helper', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/parseDateFlexible\.formatFirestoreDate\(c\.confirmedAt/);
  });

  it('T42 transferredAt usa el helper', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/parseDateFlexible\.formatFirestoreDate\(ts\.transferredAt/);
  });
});
