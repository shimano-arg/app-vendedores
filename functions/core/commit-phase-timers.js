// @ts-check
/**
 * Phase timers for commitPedidoCore (Stack S-2 T4).
 *
 * Emits a `commit_phase_timers` entry to operations_log at the end of each
 * invocation with elapsed ms per phase. Fire-and-forget; NO behavior change
 * (never throws, never blocks).
 *
 * Phases tracked:
 *   - validation       (1-2): basic payload + version_minima check
 *   - idempotent_check (3): findExistingByDraftId
 *   - waitlist_check   (4): findOpenWaitlistsForClientExcludingSelf
 *   - vendor_resolve   (4.5.5): resolveClientVendorServerSide
 *   - transaction      (5+): runTransaction (reads + validations + writes)
 *   - total            (overall): end-to-end
 *
 * Sampling: emitted for 20% of invocations (deterministic per userUid).
 */

// Inlined from src/pure/instrumentation-helpers.js to avoid cross-package
// import (Firebase Functions deploys `functions/` isolated). If this PR
// merges, migrate to a shared pure helper per §57 (sync test required).
function _hashToBucket(s) {
  const str = String(s || '');
  if (!str) return 0;
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}
function shouldSampleUser(uid, pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  if (p === 0) return false;
  if (p >= 100) return true;
  return _hashToBucket(uid) < p;
}

const SAMPLING_PERCENT = 20;

/**
 * @typedef {{startedAt: number, phases: Record<string, number>}} PhaseTimers
 */

/** @returns {PhaseTimers} */
export function createPhaseTimers() {
  return { startedAt: Date.now(), phases: {} };
}

/**
 * Mark a phase end. Idempotent per phase name (last call wins).
 *
 * @param {PhaseTimers} timers
 * @param {string} name
 */
export function markPhase(timers, name) {
  if (!timers || typeof name !== 'string') return;
  timers.phases[name] = Date.now() - timers.startedAt;
}

/**
 * Emit the timers to operations_log. Fire-and-forget.
 *
 * @param {any} deps
 * @param {any} payload
 * @param {PhaseTimers} timers
 * @param {string} outcome 'ok' | 'error' | errorCode
 */
export async function emitPhaseTimers(deps, payload, timers, outcome) {
  try {
    if (!deps || !deps.fbDb || !timers) return;
    const userUid = (payload && (payload.ownerUid || payload.userUid)) || '';
    if (!shouldSampleUser(userUid, SAMPLING_PERCENT)) return;
    const totalMs = Date.now() - timers.startedAt;
    await deps.fbDb.collection('operations_log').add({
      type: 'commit_phase_timers',
      outcome: String(outcome || 'unknown'),
      totalMs,
      phases: timers.phases,
      userUid,
      userEmail: (payload && (payload.ownerEmail || payload.userEmail)) || '',
      cardCode: (payload && payload.cardCode) || '',
      origen: (payload && payload.origen) || '',
      clientVersion: (payload && payload.clientVersion) || '',
      timestamp: new Date(),
    });
  } catch (_e) {
    // fire-and-forget: never bubble instrumentation errors.
  }
}
