// @ts-check
/**
 * Regresión del incidente 2026-11-17 02:15 UTC.
 *
 * Bug reportado: email dijo "SNAPSHOT_MAX_AGE_MS (hoy 8h), commitPedidoCF
 * sigue validando contra el snapshot stale sin bloquear ventas". La
 * constante real en `commit-pedido-core.js` es 30 min desde v1456
 * (2026-10-25). Durante 49 min (T+30 → T+79) commitPedidoCF rechazaba
 * con SNAPSHOT_TOO_OLD mientras el email le decía al admin que "no
 * bloquea".
 *
 * Fix verificado:
 *   1. `SNAPSHOT_MAX_AGE_MS` es export único desde commit-pedido-core.js.
 *   2. El email usa el valor real (30 min) no un literal de texto.
 *   3. Si ya está bloqueando, el email lo DICE ("⚠ IMPORTANTE").
 *   4. El email incluye los `errors[]` recientes del `_syncRun` para
 *      diagnóstico rápido sin ir a Cloud Logging.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  checkStockSyncStale,
  SNAPSHOT_MAX_AGE_MS,
  STALE_THRESHOLD_MS,
} from '../../functions/core/stock-sync-alert-core.js';
import { SNAPSHOT_MAX_AGE_MS as CORE_MAX } from '../../functions/core/commit-pedido-core.js';

function makeFirestore(state) {
  const written = [];
  const makeDoc = (col, id) => ({
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data, opts) {
      state[col] ||= {};
      if (opts?.merge) state[col][id] = { ...(state[col][id] || {}), ...data };
      else state[col][id] = data;
      written.push({ op: 'set', path: `${col}/${id}`, data, merge: !!opts?.merge });
    },
  });
  return {
    fbDb: {
      collection: (c) => ({ doc: (id) => makeDoc(c, id) }),
    },
    _written: written,
  };
}

const now = 1_700_000_000_000;

describe('Incidente 2026-11-17 — SNAPSHOT_MAX_AGE_MS centralizado', () => {
  it('stock-sync-alert reexporta el mismo valor que commit-pedido-core', () => {
    expect(SNAPSHOT_MAX_AGE_MS).toBe(CORE_MAX);
  });

  it('SNAPSHOT_MAX_AGE_MS = 30 min (post-v1456, no 8h legacy)', () => {
    expect(SNAPSHOT_MAX_AGE_MS).toBe(30 * 60 * 1000);
  });

  it('STALE_THRESHOLD_MS = 15 min (alerta antes del bloqueo de 30 min)', () => {
    expect(STALE_THRESHOLD_MS).toBe(15 * 60 * 1000);
    expect(STALE_THRESHOLD_MS).toBeLessThan(SNAPSHOT_MAX_AGE_MS);
  });
});

describe('Incidente 2026-11-17 — texto del email corregido', () => {
  function stuckAgeMinutes(minutes) {
    return {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - minutes * 60 * 1000 },
          source: 'cf-scheduled',
        },
      },
      alerts: {},
    };
  }

  it('T1 — snapshot 20 min stale (>15 pero <30) → email dice umbral REAL 30 min + NO dice "8h" ni "bloquea"', async () => {
    const state = stuckAgeMinutes(20);
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    const call = sendEmail.mock.calls[0][0];
    expect(call.text).toContain('SNAPSHOT_MAX_AGE_MS (30 min');
    expect(call.text).not.toContain('(hoy 8h)');
    expect(call.text).not.toContain('8 horas');
    // Antes de los 30 min: dice "sin rechazar confirmaciones".
    expect(call.text).toContain('sin rechazar confirmaciones');
    // Umbral de alerta en el cuerpo.
    expect(call.text).toContain('Umbral de alerta (stale): 15 min');
    expect(call.text).toContain('Umbral de bloqueo commit (SNAPSHOT_MAX_AGE_MS): 30 min');
  });

  it('T2 — snapshot 79 min stale (incidente 2026-11-17) → email marca "⚠ IMPORTANTE" + rechaza con SNAPSHOT_TOO_OLD', async () => {
    const state = stuckAgeMinutes(79);
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    const call = sendEmail.mock.calls[0][0];
    // Marca advertencia explícita.
    expect(call.text).toContain('⚠ IMPORTANTE');
    // Dice el nombre del errorCode real.
    expect(call.text).toContain('SNAPSHOT_TOO_OLD');
    // Reporta el gap: 79 - 30 = 49 min bloqueando.
    expect(call.text).toMatch(/Hace ~4[89] min que commitPedidoCF rechaza/);
    // Menciona el fallback live_sl.enabled.
    expect(call.text).toContain('live_sl.enabled=true');
  });

  it('T3 — snapshot 45 min stale → email dice "ya superó el umbral de bloqueo (30 min)"', async () => {
    const state = stuckAgeMinutes(45);
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    const call = sendEmail.mock.calls[0][0];
    expect(call.text).toContain('superó el umbral de bloqueo');
    expect(call.text).toContain('(30 min)');
  });

  it('T4 — snapshot._syncRun.errors → email incluye los primeros 5 errores con prefijo "•"', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - 60 * 60 * 1000 },
          source: 'cf-scheduled',
          _syncRun: {
            finishedAt: '2026-11-17T01:05:00.000Z',
            errors: [
              'SL login failed status=401',
              'bp-sync: fetch failed',
              'backorder-fetch: TimeoutError',
            ],
          },
        },
      },
      alerts: {},
    };
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    const call = sendEmail.mock.calls[0][0];
    expect(call.text).toContain('Errores de la última corrida intentada (2026-11-17T01:05:00.000Z)');
    expect(call.text).toContain('• SL login failed status=401');
    expect(call.text).toContain('• bp-sync: fetch failed');
    expect(call.text).toContain('• backorder-fetch: TimeoutError');
  });

  it('T5 — snapshot sin _syncRun.errors → email indica dónde buscarlos (operations_log)', async () => {
    const state = stuckAgeMinutes(60);
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    const call = sendEmail.mock.calls[0][0];
    expect(call.text).toContain('No hay errores registrados');
    expect(call.text).toContain("operations_log");
    expect(call.text).toContain("type='stock_sync_run'");
  });

  it('T6 — cooldown 1h sigue respetándose (no cambia por el fix)', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - 60 * 60 * 1000 },
          source: 'cf-scheduled',
        },
      },
      alerts: {
        stock_sync_stale_meta: {
          lastEmailAt: { toMillis: () => now - 10 * 60 * 1000 }, // 10 min atrás
        },
      },
    };
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    const r = await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    expect(r.alertSent).toBe(true);
    expect(r.emailSent).toBe(false); // cooldown
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('Incidente 2026-11-17 — recuperación', () => {
  it('post-recuperación: snapshot fresh (<15 min) resuelve el alert previo', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => now - 2 * 60 * 1000 }, // 2 min, fresh
          source: 'cf-scheduled',
        },
      },
      alerts: {
        stock_sync_stale: {
          status: 'firing',
          lastCheckedAt: { toMillis: () => now - 30 * 60 * 1000 },
        },
      },
    };
    const { fbDb } = makeFirestore(state);
    const sendEmail = vi.fn();
    const r = await checkStockSyncStale({ fbDb, now: () => now, sendEmail });
    expect(r.alertSent).toBe(false);
    expect(r.emailSent).toBe(false);
    expect(state.alerts.stock_sync_stale.status).toBe('resolved');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
