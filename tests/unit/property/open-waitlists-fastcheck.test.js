// @ts-check
/**
 * §57 (2026-10-23) — Property-based tests para `findOpenWaitlistsForClient`.
 *
 * Para cualquier conjunto arbitrario de waitlists del mismo cliente, la
 * función nunca devuelve el id excluido, ninguna waitlist consumida ni
 * ninguna cerrada.
 */
import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { findOpenWaitlistsForClient } from '../../../src/pure/open-waitlists.js';

const stageArb = fc.constantFrom('pending', 'processing', 'consumed', 'confirmed');
const closedAtArb = fc.oneof(
  fc.constant(null),
  fc.constant(''), // falsy
  fc.constantFrom(
    '2026-10-20T10:00:00Z',
    '2026-10-21T10:00:00Z',
    '2026-10-22T10:00:00Z'
  ),
);
const idArb = fc.string({ minLength: 3, maxLength: 20 });
const cardCodeArb = fc.constantFrom('C001', 'C002', 'C003');

const docArb = fc.record({
  _id: idArb,
  clientCardCode: cardCodeArb,
  closedAt: closedAtArb,
  stage: stageArb,
  createdAt: fc.oneof(
    fc.constant(null),
    fc.constantFrom(
      '2026-10-23T09:00:00Z',
      '2026-10-23T11:00:00Z',
      '2026-10-23T13:00:00Z'
    )
  ),
});

describe('v<X> §57 property-based findOpenWaitlistsForClient', () => {
  it('nunca devuelve el id excluido', () => {
    fc.assert(
      fc.property(cardCodeArb, idArb, fc.array(docArb, { maxLength: 8 }), (cardCode, excludeId, docs) => {
        const r = findOpenWaitlistsForClient(cardCode, excludeId, docs);
        return r.every((w) => w._id !== excludeId);
      }),
      { numRuns: 100 }
    );
  });

  it('nunca devuelve waitlists consumidas', () => {
    fc.assert(
      fc.property(cardCodeArb, fc.array(docArb, { maxLength: 8 }), (cardCode, docs) => {
        const r = findOpenWaitlistsForClient(cardCode, null, docs);
        return r.every((w) => w.stage !== 'consumed');
      }),
      { numRuns: 100 }
    );
  });

  it('nunca devuelve waitlists cerradas (closedAt truthy)', () => {
    fc.assert(
      fc.property(cardCodeArb, fc.array(docArb, { maxLength: 8 }), (cardCode, docs) => {
        const r = findOpenWaitlistsForClient(cardCode, null, docs);
        return r.every((w) => !w.closedAt);
      }),
      { numRuns: 100 }
    );
  });

  it('todas las devueltas tienen el mismo clientCardCode (trimmed)', () => {
    fc.assert(
      fc.property(cardCodeArb, fc.array(docArb, { maxLength: 8 }), (cardCode, docs) => {
        const r = findOpenWaitlistsForClient(cardCode, null, docs);
        const cc = String(cardCode).trim();
        return r.every((w) => String(w.clientCardCode || '').trim() === cc);
      }),
      { numRuns: 100 }
    );
  });

  it('resultado ordenado DESC por createdAt (si todos tienen createdAt)', () => {
    const docArbSureCreated = fc.record({
      _id: idArb,
      clientCardCode: cardCodeArb,
      closedAt: fc.constant(null),
      stage: fc.constant('pending'),
      createdAt: fc.constantFrom(
        '2026-10-23T09:00:00Z',
        '2026-10-23T11:00:00Z',
        '2026-10-23T13:00:00Z',
        '2026-10-23T15:00:00Z'
      ),
    });
    fc.assert(
      fc.property(cardCodeArb, fc.array(docArbSureCreated, { maxLength: 8 }), (cardCode, docs) => {
        const r = findOpenWaitlistsForClient(cardCode, null, docs);
        for (let i = 1; i < r.length; i++) {
          const prev = Date.parse(r[i - 1].createdAt);
          const curr = Date.parse(r[i].createdAt);
          if (prev < curr) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('función es pura: no muta el input', () => {
    fc.assert(
      fc.property(cardCodeArb, idArb, fc.array(docArb, { maxLength: 8 }), (cardCode, excludeId, docs) => {
        const snapshot = JSON.stringify(docs);
        findOpenWaitlistsForClient(cardCode, excludeId, docs);
        return JSON.stringify(docs) === snapshot;
      }),
      { numRuns: 100 }
    );
  });

  it('idempotencia: 2 llamadas con mismo input → mismo output', () => {
    fc.assert(
      fc.property(cardCodeArb, idArb, fc.array(docArb, { maxLength: 8 }), (cardCode, excludeId, docs) => {
        const r1 = findOpenWaitlistsForClient(cardCode, excludeId, docs);
        const r2 = findOpenWaitlistsForClient(cardCode, excludeId, docs);
        return JSON.stringify(r1) === JSON.stringify(r2);
      }),
      { numRuns: 100 }
    );
  });
});
