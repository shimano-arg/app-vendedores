// @ts-check
/**
 * v1516 §TBD — Dry-run test del script X_destrabar_in_progress_eterno.cjs.
 *
 * Verifica la logica pura de threshold filtering: given una lista de docs
 * in_progress con distintos lockedAt, filtrar los que superan el threshold.
 */
import { describe, expect, it } from 'vitest';

/**
 * Replica la logica pura del script X sin admin SDK.
 * @param {Array<{id: string, data: any}>} docs
 * @param {number} nowMs
 * @param {number} thresholdHours
 * @returns {Array<{id: string, ageMs: number | null, isStuck: boolean}>}
 */
function filterStuck(docs, nowMs, thresholdHours) {
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  return docs.map((d) => {
    const lockedAt = d.data.lockedAt;
    let lockedMs = null;
    if (typeof lockedAt === 'string') {
      lockedMs = Date.parse(lockedAt) || null;
    } else if (lockedAt instanceof Date) {
      lockedMs = lockedAt.getTime();
    } else if (lockedAt && typeof lockedAt.toMillis === 'function') {
      try {
        lockedMs = lockedAt.toMillis();
      } catch {
        lockedMs = null;
      }
    }
    const ageMs = lockedMs !== null ? nowMs - lockedMs : null;
    const isStuck = ageMs === null || ageMs > thresholdMs;
    return { id: d.id, ageMs, isStuck };
  });
}

describe('X_destrabar — dry-run threshold logic', () => {
  const NOW_MS = new Date('2026-10-28T12:00:00Z').getTime();

  it('mix in_progress stuck + reciente → threshold 1h detecta solo stuck', () => {
    const docs = [
      // Stuck: lockedAt hace 5 horas.
      { id: 'stuck_5h', data: { lockedAt: new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString() } },
      // Stuck: lockedAt hace 24h.
      { id: 'stuck_24h', data: { lockedAt: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString() } },
      // Reciente: lockedAt hace 15 min.
      { id: 'reciente_15m', data: { lockedAt: new Date(NOW_MS - 15 * 60 * 1000).toISOString() } },
      // Reciente: lockedAt hace 50 min (dentro del threshold 1h).
      { id: 'reciente_50m', data: { lockedAt: new Date(NOW_MS - 50 * 60 * 1000).toISOString() } },
    ];
    const result = filterStuck(docs, NOW_MS, 1);
    expect(result.find((r) => r.id === 'stuck_5h').isStuck).toBe(true);
    expect(result.find((r) => r.id === 'stuck_24h').isStuck).toBe(true);
    expect(result.find((r) => r.id === 'reciente_15m').isStuck).toBe(false);
    expect(result.find((r) => r.id === 'reciente_50m').isStuck).toBe(false);
  });

  it('threshold 24h: solo 24h stuck pasa', () => {
    const docs = [
      { id: 'stuck_5h', data: { lockedAt: new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString() } },
      {
        id: 'stuck_24h_1m',
        data: { lockedAt: new Date(NOW_MS - 24 * 60 * 60 * 1000 - 60000).toISOString() },
      },
    ];
    const result = filterStuck(docs, NOW_MS, 24);
    expect(result.find((r) => r.id === 'stuck_5h').isStuck).toBe(false);
    expect(result.find((r) => r.id === 'stuck_24h_1m').isStuck).toBe(true);
  });

  it('doc sin lockedAt (null/undefined) → tratado como stuck (defensa)', () => {
    const docs = [
      { id: 'no_locked', data: {} },
      { id: 'null_locked', data: { lockedAt: null } },
    ];
    const result = filterStuck(docs, NOW_MS, 1);
    expect(result.every((r) => r.isStuck)).toBe(true);
  });

  it('lockedAt como Date (no string) tambien parseado correctamente', () => {
    const docs = [{ id: 'as_date', data: { lockedAt: new Date(NOW_MS - 2 * 60 * 60 * 1000) } }];
    const result = filterStuck(docs, NOW_MS, 1);
    expect(result[0].isStuck).toBe(true);
    expect(result[0].ageMs).toBe(2 * 60 * 60 * 1000);
  });

  it('lockedAt tipo Timestamp (toMillis) tambien parseado', () => {
    const docs = [
      {
        id: 'as_ts',
        data: {
          lockedAt: {
            toMillis: () => NOW_MS - 3 * 60 * 60 * 1000,
          },
        },
      },
    ];
    const result = filterStuck(docs, NOW_MS, 1);
    expect(result[0].isStuck).toBe(true);
    expect(result[0].ageMs).toBe(3 * 60 * 60 * 1000);
  });

  it('threshold 0 (edge): todo stuck', () => {
    const docs = [{ id: 'recent', data: { lockedAt: new Date(NOW_MS - 1000).toISOString() } }];
    const result = filterStuck(docs, NOW_MS, 0);
    expect(result[0].isStuck).toBe(true);
  });
});
