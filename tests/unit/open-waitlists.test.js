// @ts-check
/**
 * §57 (2026-10-23) — Unit tests para `src/pure/open-waitlists.js`.
 *
 * Repro directa del bug reportado 23/10 11:37 (ORDEN X recién marcada
 * `pedidos.add` pero la waitlist de origen aún abierta → CF devolvía
 * CLIENT_HAS_OPEN_WAITLIST sobre sí misma).
 *
 * Casos cubiertos:
 *   - Cliente con waitlist X abierta, confirmar X excluyéndola → vacío.
 *   - Cliente con waitlist X abierta + Y abierta, confirmar X → [Y].
 *   - Cliente con waitlist X consumed + Y abierta → [Y] (X filtrada por consumed).
 *   - Cliente con X cerrada (closedAt set) + Y abierta → [Y].
 *   - Casos borde: docs vacío, cardCode vacío, excludeId null/undefined.
 *   - Normalización cardCode: trim de los dos lados.
 *   - Ordenamiento DESC por createdAt.
 */

import { describe, expect, it } from 'vitest';
import { findOpenWaitlistsForClient } from '../../src/pure/open-waitlists.js';

describe('v<X> §57 findOpenWaitlistsForClient', () => {
  it('cliente con waitlist X abierta, confirmar X excluyéndola → vacío', () => {
    const docs = [
      { _id: 'wX', clientCardCode: 'C001', closedAt: null, stage: 'pending', orderNumber: 100 },
    ];
    const r = findOpenWaitlistsForClient('C001', 'wX', docs);
    expect(r).toEqual([]);
  });

  it('cliente con waitlist X abierta + Y abierta, confirmar X → [Y]', () => {
    const docs = [
      {
        _id: 'wX',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        orderNumber: 100,
        createdAt: '2026-10-23T10:00:00Z',
      },
      {
        _id: 'wY',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        orderNumber: 101,
        createdAt: '2026-10-23T11:00:00Z',
      },
    ];
    const r = findOpenWaitlistsForClient('C001', 'wX', docs);
    expect(r).toHaveLength(1);
    expect(r[0]._id).toBe('wY');
  });

  it('cliente con waitlist X consumed + Y abierta → [Y] (X filtrada por consumed)', () => {
    const docs = [
      {
        _id: 'wX',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'consumed',
        orderNumber: 100,
      },
      {
        _id: 'wY',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        orderNumber: 101,
      },
    ];
    // Pasamos excludeId = null para asegurar que el filtro consumed funciona
    // independiente del exclude.
    const r = findOpenWaitlistsForClient('C001', null, docs);
    expect(r).toHaveLength(1);
    expect(r[0]._id).toBe('wY');
  });

  it('cliente con X cerrada (closedAt set) + Y abierta → [Y]', () => {
    const docs = [
      {
        _id: 'wX',
        clientCardCode: 'C001',
        closedAt: '2026-10-23T10:00:00Z',
        stage: 'pending',
        orderNumber: 100,
      },
      {
        _id: 'wY',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        orderNumber: 101,
      },
    ];
    const r = findOpenWaitlistsForClient('C001', null, docs);
    expect(r).toHaveLength(1);
    expect(r[0]._id).toBe('wY');
  });

  it('excludeId null/undefined: no excluye nada', () => {
    const docs = [
      { _id: 'wX', clientCardCode: 'C001', closedAt: null, stage: 'pending' },
      { _id: 'wY', clientCardCode: 'C001', closedAt: null, stage: 'pending' },
    ];
    expect(findOpenWaitlistsForClient('C001', null, docs)).toHaveLength(2);
    expect(findOpenWaitlistsForClient('C001', undefined, docs)).toHaveLength(2);
    expect(findOpenWaitlistsForClient('C001', '', docs)).toHaveLength(2);
  });

  it('docs vacío o no-array → []', () => {
    expect(findOpenWaitlistsForClient('C001', null, [])).toEqual([]);
    expect(findOpenWaitlistsForClient('C001', null, /** @type {any} */ (null))).toEqual([]);
    expect(findOpenWaitlistsForClient('C001', null, /** @type {any} */ (undefined))).toEqual([]);
    expect(findOpenWaitlistsForClient('C001', null, /** @type {any} */ ('not-array'))).toEqual([]);
  });

  it('cardCode vacío → []', () => {
    const docs = [{ _id: 'w1', clientCardCode: 'C001', closedAt: null }];
    expect(findOpenWaitlistsForClient('', null, docs)).toEqual([]);
    expect(findOpenWaitlistsForClient('   ', null, docs)).toEqual([]);
    expect(findOpenWaitlistsForClient(/** @type {any} */ (null), null, docs)).toEqual([]);
  });

  it('cardCode con whitespace: se normaliza por trim en ambos lados', () => {
    const docs = [{ _id: 'w1', clientCardCode: '  C001  ', closedAt: null }];
    expect(findOpenWaitlistsForClient('C001', null, docs)).toHaveLength(1);
    expect(findOpenWaitlistsForClient('  C001  ', null, docs)).toHaveLength(1);
  });

  it('cardCode distinto: no matchea', () => {
    const docs = [{ _id: 'w1', clientCardCode: 'C002', closedAt: null }];
    expect(findOpenWaitlistsForClient('C001', null, docs)).toEqual([]);
  });

  it('ordenamiento DESC por createdAt (más nueva primero)', () => {
    const docs = [
      {
        _id: 'wVieja',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: '2026-10-23T09:00:00Z',
      },
      {
        _id: 'wNueva',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: '2026-10-23T13:00:00Z',
      },
      {
        _id: 'wMedia',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: '2026-10-23T11:00:00Z',
      },
    ];
    const r = findOpenWaitlistsForClient('C001', null, docs);
    expect(r.map((w) => w._id)).toEqual(['wNueva', 'wMedia', 'wVieja']);
  });

  it('createdAt como Firestore Timestamp (toMillis)', () => {
    const docs = [
      {
        _id: 'wA',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: { toMillis: () => 1000 },
      },
      {
        _id: 'wB',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: { toMillis: () => 2000 },
      },
    ];
    const r = findOpenWaitlistsForClient('C001', null, docs);
    expect(r[0]._id).toBe('wB');
    expect(r[1]._id).toBe('wA');
  });

  it('REPRO BUG 23/10 11:37: pedido con waitlist origen + sin otras abiertas → sin falso positivo', () => {
    // Repro directa del bug: un pedido en curso (originado en waitlist wX)
    // se está confirmando. Antes del fix, la CF buscaba por cardCode y
    // encontraba wX (todavía abierta porque el cliente la marca después del
    // pedidos.add legacy) → false positive sobre sí misma.
    const docs = [
      {
        _id: 'wX_origen_pedido_en_curso',
        clientCardCode: 'C_PONTORIERO',
        closedAt: null,
        stage: 'pending', // Aún no 'consumed' — ese paso vendría POST pedidos.add.
        orderNumber: 524,
        items: [{ code: 'SKU-A', qty: 1 }],
      },
    ];
    const r = findOpenWaitlistsForClient('C_PONTORIERO', 'wX_origen_pedido_en_curso', docs);
    expect(r).toEqual([]);
  });

  it('idempotencia: mismo input → mismo output', () => {
    const docs = [
      { _id: 'w1', clientCardCode: 'C001', closedAt: null, createdAt: '2026-10-23T10:00:00Z' },
      { _id: 'w2', clientCardCode: 'C001', closedAt: null, createdAt: '2026-10-23T11:00:00Z' },
    ];
    const r1 = findOpenWaitlistsForClient('C001', null, docs);
    const r2 = findOpenWaitlistsForClient('C001', null, docs);
    expect(r1).toEqual(r2);
  });

  it('no muta el input', () => {
    const docs = [
      { _id: 'w1', clientCardCode: 'C001', closedAt: null, createdAt: '2026-10-23T10:00:00Z' },
      { _id: 'w2', clientCardCode: 'C001', closedAt: null, createdAt: '2026-10-23T11:00:00Z' },
    ];
    const docsCopy = JSON.parse(JSON.stringify(docs));
    findOpenWaitlistsForClient('C001', 'w1', docs);
    expect(docs).toEqual(docsCopy);
  });
});
