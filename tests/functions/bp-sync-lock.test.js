// @ts-check
/**
 * v1535 (APP-02) — lock Firestore `app_config/bp_sync_lock` para que el sync
 * de clientes SAP (boton manual + corrida programada) nunca corra 2 veces a
 * la vez (2 corridas concurrentes podian crear el mismo cliente dos veces).
 *
 * Mock STRICT §58: tx.get despues de un write tira el error real de Firestore.
 */
import { describe, expect, it } from 'vitest';
import {
  acquireBpSyncLock,
  BP_SYNC_LOCK_PATH,
  BP_SYNC_LOCK_TTL_MS,
  releaseBpSyncLock,
} from '../../functions/core/bp-sync-lock.js';
import { makeStrictLockDb } from '../fixtures/strict-lock-db.js';

const NOW = 1_800_000_000_000;

describe('v1535 APP-02 — bp-sync-lock', () => {
  it('L1 lock libre → se adquiere y queda escrito con TTL', async () => {
    const db = makeStrictLockDb(null);
    const r = await acquireBpSyncLock(db, { owner: 'manual:u1', nowMs: NOW });
    expect(r.acquired).toBe(true);
    expect(typeof r.lockId).toBe('string');
    const d = db._state[BP_SYNC_LOCK_PATH];
    expect(d.holder).toBe(r.lockId);
    expect(d.owner).toBe('manual:u1');
    expect(d.expiresAt).toBe(NOW + BP_SYNC_LOCK_TTL_MS);
  });

  it('L2 lock tomado y vigente → no se adquiere', async () => {
    const db = makeStrictLockDb({ holder: 'x', owner: 'cf-scheduled', expiresAt: NOW + 60_000 });
    const r = await acquireBpSyncLock(db, { owner: 'manual:u1', nowMs: NOW });
    expect(r.acquired).toBe(false);
    expect(r.heldBy).toBe('cf-scheduled');
    expect(db._state[BP_SYNC_LOCK_PATH].holder).toBe('x');
  });

  it('L3 lock vencido (corrida que se cayo) → se puede tomar', async () => {
    const db = makeStrictLockDb({ holder: 'x', owner: 'cf-scheduled', expiresAt: NOW - 1 });
    const r = await acquireBpSyncLock(db, { owner: 'manual:u1', nowMs: NOW });
    expect(r.acquired).toBe(true);
  });

  it('L4 TTL es ~10 minutos', () => {
    expect(BP_SYNC_LOCK_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('L5 release solo borra si el holder coincide', async () => {
    const db = makeStrictLockDb(null);
    const r = await acquireBpSyncLock(db, { owner: 'a', nowMs: NOW });
    expect(await releaseBpSyncLock(db, 'otro')).toBe(false);
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeDefined();
    expect(await releaseBpSyncLock(db, /** @type {string} */ (r.lockId))).toBe(true);
    expect(db._state[BP_SYNC_LOCK_PATH]).toBeUndefined();
  });

  it('L6 dos adquisiciones concurrentes → solo una gana', async () => {
    const db = makeStrictLockDb(null);
    const [a, b] = await Promise.all([
      acquireBpSyncLock(db, { owner: 'a', nowMs: NOW }),
      acquireBpSyncLock(db, { owner: 'b', nowMs: NOW }),
    ]);
    expect([a.acquired, b.acquired].filter(Boolean).length).toBe(1);
  });
});
