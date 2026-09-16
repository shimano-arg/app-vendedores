import { describe, expect, it } from 'vitest';
import { shouldIncludeWaitlistDoc } from '../../src/pure/waitlist-filter.js';

describe('shouldIncludeWaitlistDoc (v953 fix)', () => {
  it('doc normal sin stage → incluir', () => {
    expect(shouldIncludeWaitlistDoc({ clientName: 'ACME', items: [] })).toBe(true);
  });

  it('doc con stage=consumed → SKIPEAR (v953)', () => {
    // Este es el invariante clave del fix v953: si el pedido pasa a
    // Pendientes y luego se confirma, se marca el waitlist doc como
    // consumed. La UI debe ocultarlo aunque el delete falle por rules.
    expect(
      shouldIncludeWaitlistDoc({
        clientName: 'CRISTIAN JOSE SANTORO',
        stage: 'consumed',
        consumedByPedidoId: 'somePedidoId',
      })
    ).toBe(false);
  });

  it('doc con stage=pending → incluir (stage libre)', () => {
    expect(shouldIncludeWaitlistDoc({ stage: 'pending' })).toBe(true);
  });

  it('doc con stage vacio o null → incluir (backward compat pre-v953)', () => {
    expect(shouldIncludeWaitlistDoc({ stage: '' })).toBe(true);
    expect(shouldIncludeWaitlistDoc({ stage: null })).toBe(true);
    expect(shouldIncludeWaitlistDoc({})).toBe(true);
  });

  it('null / undefined / no-object → skipear (defensivo)', () => {
    expect(shouldIncludeWaitlistDoc(null)).toBe(false);
    expect(shouldIncludeWaitlistDoc(undefined)).toBe(false);
    expect(shouldIncludeWaitlistDoc('string')).toBe(false);
    expect(shouldIncludeWaitlistDoc(42)).toBe(false);
  });

  it('scenario end-to-end: post-cleanup, solo docs no-consumed pasan', () => {
    const snapshot = [
      { id: 'a', clientName: 'A', stage: null },
      { id: 'b', clientName: 'B', stage: 'consumed', consumedByPedidoId: 'p1' },
      { id: 'c', clientName: 'C' },
      { id: 'd', clientName: 'D', stage: 'consumed' },
    ];
    const filtered = snapshot.filter((d) => shouldIncludeWaitlistDoc(d));
    expect(filtered.map((d) => d.id)).toEqual(['a', 'c']);
  });
});
