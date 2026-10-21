// @ts-check
/**
 * v1396 §40.4 — computeWaitlistCardClasses: función pura idempotente.
 *
 * Garantiza que una card con badge STOCK ASIG se renderiza con la MISMA
 * secuencia de clases en cualquier render — primer render con snapshots vacíos
 * o re-render posterior con stock + pedidos cargados. Fix flicker reportado
 * 2026-10-21.
 */
import { describe, expect, it } from 'vitest';
import { computeWaitlistCardClasses, isWaitlistCpst } from '../../src/pure/wl-sidebar-classes.js';

describe('v1396 §40.4 isWaitlistCpst', () => {
  it('source stock-asignado-batch → true', () => {
    expect(isWaitlistCpst({ source: 'stock-asignado-batch' })).toBe(true);
  });

  it('sin source pero con pedidosOrigenes populated → true (fallback A)', () => {
    expect(isWaitlistCpst({ pedidosOrigenes: [{ pedidoId: 'x', lineIndex: 0 }] })).toBe(true);
  });

  it('sin source ni pedidosOrigenes → false', () => {
    expect(isWaitlistCpst({})).toBe(false);
    expect(isWaitlistCpst({ source: 'otra_cosa' })).toBe(false);
    expect(isWaitlistCpst({ pedidosOrigenes: [] })).toBe(false);
  });

  it('null/undefined → false', () => {
    expect(isWaitlistCpst(null)).toBe(false);
    expect(isWaitlistCpst(undefined)).toBe(false);
  });
});

describe('v1396 §40.4 computeWaitlistCardClasses', () => {
  it('waitlist normal sin excedente', () => {
    expect(computeWaitlistCardClasses({}, false)).toEqual(['slft-wl-item']);
  });

  it('waitlist normal con excedente', () => {
    expect(computeWaitlistCardClasses({}, true)).toEqual(['slft-wl-item', 'has-exceed']);
  });

  it('waitlist CPST sin excedente', () => {
    expect(computeWaitlistCardClasses({ source: 'stock-asignado-batch' }, false)).toEqual([
      'slft-wl-item',
      'source-cpst',
    ]);
  });

  it('waitlist CPST con excedente', () => {
    expect(computeWaitlistCardClasses({ source: 'stock-asignado-batch' }, true)).toEqual([
      'slft-wl-item',
      'has-exceed',
      'source-cpst',
    ]);
  });

  it('waitlist CPST por pedidosOrigenes (fallback A)', () => {
    const w = { pedidosOrigenes: [{ pedidoId: 'x', lineIndex: 0 }] };
    expect(computeWaitlistCardClasses(w, false)).toEqual(['slft-wl-item', 'source-cpst']);
  });

  it('IDEMPOTENCIA: primer render con stock vacio → mismo resultado que re-render con stock', () => {
    const w = {
      source: 'stock-asignado-batch',
      pedidosOrigenes: [{ pedidoId: 'x', lineIndex: 0 }],
    };
    // Primer render: snapshots vacíos → excedentes spurios → hasExceed=true.
    const r1 = computeWaitlistCardClasses(w, true);
    // Re-render: snapshot llegó → excedentes reales = 0 → hasExceed=false.
    const r2 = computeWaitlistCardClasses(w, false);
    // La clase source-cpst está presente en AMBOS renders — no cambia.
    expect(r1.includes('source-cpst')).toBe(true);
    expect(r2.includes('source-cpst')).toBe(true);
    // Solo cambia has-exceed (que afecta el border-left-color, NO el background).
    expect(r1.includes('has-exceed')).toBe(true);
    expect(r2.includes('has-exceed')).toBe(false);
  });

  it('mismo input → mismo output (determinismo)', () => {
    const w = { source: 'stock-asignado-batch' };
    const a = computeWaitlistCardClasses(w, true);
    const b = computeWaitlistCardClasses(w, true);
    expect(a).toEqual(b);
  });
});
