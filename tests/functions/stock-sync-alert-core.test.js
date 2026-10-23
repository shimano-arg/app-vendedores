// @ts-check
/**
 * §63 Fase 3 Capa 1 (v1444) — tests para stock-sync-alert-core.
 */
import { describe, expect, it, vi } from 'vitest';
import { checkStockSyncStale } from '../../functions/core/stock-sync-alert-core.js';

function makeFirestore(state) {
  const written = [];
  const makeDoc = (col, id) => ({
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data, opts) {
      state[col] ||= {};
      if (opts?.merge) {
        state[col][id] = { ...(state[col][id] || {}), ...data };
      } else {
        state[col][id] = data;
      }
      written.push({ op: 'set', path: `${col}/${id}`, data, merge: !!opts?.merge });
    },
  });
  const makeCol = (col) => ({
    doc(id) {
      return makeDoc(col, id);
    },
  });
  return {
    fbDb: {
      collection: (c) => makeCol(c),
    },
    _written: written,
  };
}

const now = 1_700_000_000_000;

describe('§63 Capa 1 — stock-sync-alert-core', () => {
  it('T1 — snapshot fresco (<15 min) → no alert, no email', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - 5 * 60 * 1000 },
          source: 'cf-scheduled',
        },
      },
      alerts: {},
    };
    const { fbDb, _written } = makeFirestore(state);
    const sendEmail = vi.fn();
    const r = await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    expect(r.alertSent).toBe(false);
    expect(r.emailSent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('T2 — snapshot stale (>15 min) + sin email previo → alert + email enviado', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - 20 * 60 * 1000 },
          source: 'cf-scheduled',
        },
      },
      alerts: {},
    };
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    const r = await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    expect(r.alertSent).toBe(true);
    expect(r.emailSent).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe('mariano.erbino@shimano.com.ar');
    expect(call.subject).toContain('stale');
    // Alert doc firing.
    expect(state.alerts.stock_sync_stale.status).toBe('firing');
    expect(state.alerts.stock_sync_stale.ageMs).toBeGreaterThan(15 * 60 * 1000);
    // Meta con lastEmailAt.
    expect(state.alerts.stock_sync_stale_meta.lastEmailAt).toBeTruthy();
  });

  it('T3 — stale pero email reciente (<1h) → alert pero email NO enviado (cooldown)', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - 20 * 60 * 1000 },
          source: 'cf-scheduled',
        },
      },
      alerts: {
        stock_sync_stale_meta: {
          lastEmailAt: { toMillis: () => now - 30 * 60 * 1000 }, // hace 30 min
        },
      },
    };
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn();
    const r = await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    expect(r.alertSent).toBe(true);
    expect(r.emailSent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('T4 — stale + email viejo (>1h) → otro email enviado', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - 90 * 60 * 1000 },
          source: 'gha-cron',
        },
      },
      alerts: {
        stock_sync_stale_meta: {
          lastEmailAt: { toMillis: () => now - 2 * 60 * 60 * 1000 },
        },
      },
    };
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    const r = await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    expect(r.emailSent).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('T5 — snapshot vuelve a fresh después de stale → alert resuelta', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - 3 * 60 * 1000 }, // fresco
          source: 'cf-scheduled',
        },
      },
      alerts: {
        stock_sync_stale: { status: 'firing', lastSuccessAt: 'x' },
      },
    };
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn();
    const r = await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    expect(r.alertSent).toBe(false);
    expect(state.alerts.stock_sync_stale.status).toBe('resolved');
  });

  it('T6 — no existe snapshot doc → alert con reason=no_snapshot_doc', async () => {
    const state = { app_config: {}, alerts: {} };
    const { fbDb } = makeFirestore(state);
    const r = await checkStockSyncStale({ fbDb, now: () => now, sendEmail: vi.fn() });
    expect(r.alertSent).toBe(false);
    expect(r.reason).toBe('no_snapshot_doc');
  });
});
