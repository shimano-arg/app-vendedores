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

  // v1573 (2026-11-25): defensa-en-profundidad closedAt.
  it('v1573 doc con closedAt string ISO → SKIPEAR (defensa cleanup externo)', () => {
    expect(
      shouldIncludeWaitlistDoc({
        clientName: 'CASA FERRACIOLI SOCIEDAD ANONIMA',
        closedAt: '2026-11-24T17:31:46.746Z',
        closedReason: 'asig_ref_invalid_sku_removed',
        // stage queda undefined - script olvido setearlo. SIN el fix v1573
        // esto pasaba el filter y aparecia vacia en el sidebar.
      })
    ).toBe(false);
  });

  it('v1573 doc con closedAt + stage=consumed → SKIPEAR (ambos criterios)', () => {
    expect(
      shouldIncludeWaitlistDoc({
        clientName: 'X',
        stage: 'consumed',
        closedAt: '2026-11-25T12:00:00Z',
      })
    ).toBe(false);
  });

  it('v1573 doc con closedAt como Firestore Timestamp object → SKIPEAR', () => {
    expect(
      shouldIncludeWaitlistDoc({
        clientName: 'X',
        closedAt: { _seconds: 1764000000, _nanoseconds: 0 },
      })
    ).toBe(false);
  });

  it('v1573 doc con closedAt null o undefined → INCLUIR (el filter no gatilla)', () => {
    expect(shouldIncludeWaitlistDoc({ clientName: 'X', closedAt: null })).toBe(true);
    expect(shouldIncludeWaitlistDoc({ clientName: 'X', closedAt: undefined })).toBe(true);
    expect(shouldIncludeWaitlistDoc({ clientName: 'X', closedAt: '' })).toBe(true);
  });

  it('v1573 repro casos reales ORDEN 927 CASA FERRACIOLI + ORDEN 939 DINKELDEIN', () => {
    // Shape real de los 2 docs huerfanos tras `asig_ref_invalid_sku_cleanup`
    // del 2026-11-24. Pre-v1573 aparecian en el sidebar como ordenes vacias.
    const huerfanas = [
      {
        _id: 'vIiG5WsDLVt4fZ7owJ4D',
        clientName: 'CASA FERRACIOLI SOCIEDAD ANONIMA',
        orderNumber: '927',
        items: [],
        pedidosOrigenes: [],
        closedAt: '2026-11-24T17:31:46.746Z',
        closedReason: 'asig_ref_invalid_sku_removed',
        // stage: undefined
      },
      {
        _id: 'LrDNfda8jJlOeB7kvTlV',
        clientName: 'ESTACION DINKELDEIN S.R.L.',
        orderNumber: '939',
        items: [],
        pedidosOrigenes: [],
        closedAt: '2026-11-24T17:31:46.746Z',
        closedReason: 'asig_ref_invalid_sku_removed',
      },
    ];
    for (const h of huerfanas) {
      expect(shouldIncludeWaitlistDoc(h)).toBe(false);
    }
  });
});
