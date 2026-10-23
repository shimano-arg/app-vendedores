// @ts-check
/**
 * §57 (2026-10-23) — Test de sincronía entre `src/pure/open-waitlists.js` y
 * `functions/core/open-waitlists.js`.
 *
 * CLAUDE.md §57: cualquier chequeo de negocio que se evalúe en cliente y
 * servidor DEBE vivir una sola vez en `src/pure/<name>.js` con copia espejo
 * en `functions/core/<name>.js` y test de sincronía
 * `tests/unit/audit/<name>-sync.test.js`.
 *
 * Si los dos archivos divergen, este test falla.
 */
import { describe, expect, it } from 'vitest';
import * as pure from '../../../src/pure/open-waitlists.js';
import * as mirror from '../../../functions/core/open-waitlists.js';

const FIXTURE_SAMPLES = [
  // Caso vacío.
  { cardCode: 'C001', excludeId: null, docs: [] },
  // Cliente sin waitlists.
  {
    cardCode: 'C001',
    excludeId: null,
    docs: [{ _id: 'w1', clientCardCode: 'C999', closedAt: null }],
  },
  // Waitlist X abierta, confirmar X excluyéndola.
  {
    cardCode: 'C001',
    excludeId: 'wX',
    docs: [{ _id: 'wX', clientCardCode: 'C001', closedAt: null, stage: 'pending' }],
  },
  // X abierta + Y abierta, confirmar X.
  {
    cardCode: 'C001',
    excludeId: 'wX',
    docs: [
      {
        _id: 'wX',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: '2026-10-23T10:00:00Z',
      },
      {
        _id: 'wY',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: '2026-10-23T11:00:00Z',
      },
    ],
  },
  // X consumed + Y abierta.
  {
    cardCode: 'C001',
    excludeId: null,
    docs: [
      { _id: 'wX', clientCardCode: 'C001', closedAt: null, stage: 'consumed' },
      { _id: 'wY', clientCardCode: 'C001', closedAt: null, stage: 'pending' },
    ],
  },
  // X cerrada + Y abierta.
  {
    cardCode: 'C001',
    excludeId: null,
    docs: [
      {
        _id: 'wX',
        clientCardCode: 'C001',
        closedAt: '2026-10-23T10:00:00Z',
        stage: 'pending',
      },
      { _id: 'wY', clientCardCode: 'C001', closedAt: null, stage: 'pending' },
    ],
  },
  // excludeId null + 2 abiertas.
  {
    cardCode: 'C001',
    excludeId: null,
    docs: [
      {
        _id: 'wA',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: '2026-10-23T09:00:00Z',
      },
      {
        _id: 'wB',
        clientCardCode: 'C001',
        closedAt: null,
        stage: 'pending',
        createdAt: '2026-10-23T11:00:00Z',
      },
    ],
  },
  // cardCode con whitespace.
  {
    cardCode: '  C001  ',
    excludeId: null,
    docs: [{ _id: 'w1', clientCardCode: 'C001', closedAt: null, stage: 'pending' }],
  },
  // cardCode vacío.
  {
    cardCode: '',
    excludeId: null,
    docs: [{ _id: 'w1', clientCardCode: 'C001', closedAt: null, stage: 'pending' }],
  },
];

describe('v<X> §57 open-waitlists sync: src/pure vs functions/core', () => {
  it('ambos exportan findOpenWaitlistsForClient', () => {
    expect(typeof pure.findOpenWaitlistsForClient).toBe('function');
    expect(typeof mirror.findOpenWaitlistsForClient).toBe('function');
  });

  it('ambos exportan formatWaitlistForMessage', () => {
    expect(typeof pure.formatWaitlistForMessage).toBe('function');
    expect(typeof mirror.formatWaitlistForMessage).toBe('function');
  });

  for (let i = 0; i < FIXTURE_SAMPLES.length; i++) {
    const f = FIXTURE_SAMPLES[i];
    it(`fixture[${i}] (cardCode=${JSON.stringify(f.cardCode)}, exclude=${f.excludeId}) → mismo output`, () => {
      const rPure = pure.findOpenWaitlistsForClient(f.cardCode, f.excludeId, f.docs);
      const rMirror = mirror.findOpenWaitlistsForClient(f.cardCode, f.excludeId, f.docs);
      expect(rPure).toEqual(rMirror);
    });
  }

  it('formatWaitlistForMessage: mismo output sobre waitlist típica', () => {
    const w = {
      orderNumber: 445,
      items: [{ code: 'A', qty: 3 }, { code: 'B', qty: 2 }],
      createdAt: '2026-10-23T10:00:00Z',
      ownerEmail: 'test@shimano.com.ar',
    };
    expect(pure.formatWaitlistForMessage(w)).toBe(mirror.formatWaitlistForMessage(w));
  });

  it('formatWaitlistForMessage: null → mismo fallback', () => {
    expect(pure.formatWaitlistForMessage(null)).toBe(mirror.formatWaitlistForMessage(null));
  });
});
