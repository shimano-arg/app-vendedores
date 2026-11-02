import { describe, expect, it } from 'vitest';
import {
  isWaitlistQtyMinusDisabled,
  nextWaitlistQty,
  parseWaitlistQtyInput,
} from '../../src/pure/waitlist-qty-stepper.js';

describe('v1538 APP-03 — nextWaitlistQty', () => {
  it('(+) suma 1', () => {
    expect(nextWaitlistQty(1, 1)).toBe(2);
    expect(nextWaitlistQty('5', 1)).toBe(6);
  });
  it('(−) resta 1', () => {
    expect(nextWaitlistQty(3, -1)).toBe(2);
  });
  it('(−) nunca baja de 1', () => {
    expect(nextWaitlistQty(1, -1)).toBe(1);
    expect(nextWaitlistQty(0, -1)).toBe(1);
  });
  it('valor actual inválido arranca desde 1', () => {
    expect(nextWaitlistQty('', 1)).toBe(2);
    expect(nextWaitlistQty('abc', 1)).toBe(2);
    expect(nextWaitlistQty(null, -1)).toBe(1);
  });
  it('decimales se truncan', () => {
    expect(nextWaitlistQty(2.7, 1)).toBe(3);
  });
});

describe('v1538 APP-03 — parseWaitlistQtyInput', () => {
  it('entero válido', () => {
    expect(parseWaitlistQtyInput('7')).toBe(7);
    expect(parseWaitlistQtyInput(' 12 ')).toBe(12);
  });
  it('inválidos devuelven 0 (waitlistUpdateItemQty los rechaza)', () => {
    for (const v of ['', '0', '-2', '1.5', 'abc', null, undefined]) {
      expect(parseWaitlistQtyInput(v)).toBe(0);
    }
  });
});

describe('v1538 APP-03 — isWaitlistQtyMinusDisabled', () => {
  it('deshabilitado con 1 o menos', () => {
    expect(isWaitlistQtyMinusDisabled(1)).toBe(true);
    expect(isWaitlistQtyMinusDisabled('1')).toBe(true);
    expect(isWaitlistQtyMinusDisabled('')).toBe(true);
  });
  it('habilitado con 2 o más', () => {
    expect(isWaitlistQtyMinusDisabled(2)).toBe(false);
  });
});
