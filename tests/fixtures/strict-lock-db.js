// @ts-check
/**
 * v1535 (APP-02) — mock Firestore STRICT minimo para el lock de sync de
 * clientes SAP: serializa runTransaction (como Firestore real) y tira el
 * error real si hay un tx.get() despues de un write (CLAUDE.md §58).
 */
import { BP_SYNC_LOCK_PATH } from '../../functions/core/bp-sync-lock.js';

export function makeStrictLockDb(/** @type {any} */ initial) {
  /** @type {Record<string, any>} */
  const state = {};
  if (initial) state[BP_SYNC_LOCK_PATH] = initial;
  let chain = Promise.resolve();
  const ref = (/** @type {string} */ path) => ({ path });
  const db = {
    _state: state,
    doc: (/** @type {string} */ p) => ref(p),
    async runTransaction(/** @type {any} */ fn) {
      // Serializa transacciones como Firestore real.
      const prev = chain;
      /** @type {() => void} */
      let release = () => {};
      chain = new Promise((r) => {
        release = r;
      });
      await prev;
      try {
        let wrote = false;
        /** @type {Array<() => void>} */
        const pending = [];
        const tx = {
          async get(/** @type {any} */ r) {
            if (wrote) {
              throw new Error(
                'Firestore transactions require all reads to be executed before all writes.'
              );
            }
            const d = state[r.path];
            return { exists: d !== undefined, data: () => d };
          },
          set(/** @type {any} */ r, /** @type {any} */ d) {
            wrote = true;
            pending.push(() => {
              state[r.path] = { ...d };
            });
          },
          delete(/** @type {any} */ r) {
            wrote = true;
            pending.push(() => {
              delete state[r.path];
            });
          },
        };
        const out = await fn(tx);
        for (const p of pending) p();
        return out;
      } finally {
        release();
      }
    },
  };
  return db;
}
