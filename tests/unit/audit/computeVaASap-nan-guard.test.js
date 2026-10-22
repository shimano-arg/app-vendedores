// @ts-check
/**
 * E3 §auditgrises G5.30 — `computeVaASap` NaN/Infinity guard:
 * una línea con `qty=Infinity`, `precio=NaN`, o `pedido.sapDocTotal=Infinity`
 * no debe propagar valores no-finitos al UI/payload SL. Cualquier input
 * no-finite devuelve `null`, no "Infinity" o "NaN" en el modal detalle.
 */
import { describe, expect, it } from 'vitest';
import {
  computeVaASap,
  readDiscountPct,
  sumConfirmedBruto,
} from '../../../src/pure/pedido-va-a-sap.js';

describe('G5.30 — computeVaASap guards contra NaN/Infinity', () => {
  it('sapDocTotal=Infinity → cae a compute (no retorna Infinity)', () => {
    const pedido = {
      sapDocTotal: Infinity,
      lines: [{ state: 'confirmed', qty: 2, precio: 100 }],
    };
    const r = computeVaASap(pedido);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(200);
  });

  it('sapDocTotal=NaN → cae a compute', () => {
    const pedido = {
      sapDocTotal: Number.NaN,
      lines: [{ state: 'confirmed', qty: 2, precio: 100 }],
    };
    const r = computeVaASap(pedido);
    expect(r).toBe(200);
  });

  it('línea con qty=Infinity → ignorada', () => {
    const bruto = sumConfirmedBruto([{ state: 'confirmed', qty: Infinity, precio: 100 }]);
    expect(bruto).toBe(0);
  });

  it('línea con precio=NaN → ignorada', () => {
    const bruto = sumConfirmedBruto([{ state: 'confirmed', qty: 2, precio: Number.NaN }]);
    expect(bruto).toBe(0);
  });

  it('discountPct=Infinity → clamp 0', () => {
    expect(readDiscountPct({ discountPct: Infinity })).toBe(0);
  });

  it('discountPct=-5 → clamp 0', () => {
    expect(readDiscountPct({ discountPct: -5 })).toBe(0);
  });

  it('discountPct=150 → clamp 100', () => {
    expect(readDiscountPct({ discountPct: 150 })).toBe(100);
  });

  it('netAmountArs=Infinity → devuelve null', () => {
    const pedido = { netAmountArs: Infinity };
    const r = computeVaASap(pedido);
    expect(r).toBeNull();
  });

  it('subtotalArs=NaN → devuelve null', () => {
    const pedido = { subtotalArs: Number.NaN };
    const r = computeVaASap(pedido);
    expect(r).toBeNull();
  });

  it('pedido vacío → null', () => {
    expect(computeVaASap(null)).toBeNull();
    expect(computeVaASap(undefined)).toBeNull();
    expect(computeVaASap({})).toBeNull();
  });
});
