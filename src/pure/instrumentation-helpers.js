// @ts-check
/**
 * Pure helpers for client-side instrumentation (Stack S-2 T4).
 *
 * Responsibilities:
 *   - Sampling decision: deterministic per userUid, 20% default.
 *   - Batching: accumulate events in-memory, flush when threshold reached.
 *
 * Non-responsibilities (these live in src/domains/instrumentation.js):
 *   - PerformanceObserver registration.
 *   - Firestore writes.
 *   - window event listeners.
 */

/**
 * Deterministic hash → integer [0, 100). Uses djb2 (fast, enough for sampling).
 *
 * @param {string} s
 * @returns {number}
 */
export function hashToBucket(s) {
  const str = String(s || '');
  if (!str) return 0;
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

/**
 * Should this user emit instrumentation events?
 *
 * @param {string} userUid
 * @param {number} samplingPercent 0-100
 * @returns {boolean}
 */
export function shouldSampleUser(userUid, samplingPercent) {
  const pct = Math.max(0, Math.min(100, Number(samplingPercent) || 0));
  if (pct === 0) return false;
  if (pct >= 100) return true;
  return hashToBucket(userUid) < pct;
}

/**
 * Creates a batch collector. Events accumulate in memory; flushed when
 * `maxBatchSize` or `maxAgeMs` reached, or on manual flush() call.
 *
 * NOT TIME-BASED: this is a pure helper. The caller (domain/wiring layer)
 * is responsible for calling `shouldFlush(now)` + `flush()` based on a
 * timer or event (e.g. page unload).
 *
 * @param {object} opts
 * @param {number} opts.maxBatchSize
 * @param {number} opts.maxAgeMs
 * @returns {{
 *   push: (event: object) => void,
 *   shouldFlush: (now: number) => boolean,
 *   drain: () => Array<object>,
 *   size: () => number,
 * }}
 */
export function createBatchCollector(opts) {
  const maxBatchSize = Math.max(1, Number(opts && opts.maxBatchSize) || 20);
  const maxAgeMs = Math.max(0, Number(opts && opts.maxAgeMs) || 60000);
  /** @type {Array<object>} */
  let buffer = [];
  let firstPushMs = 0;

  return {
    push(event) {
      if (buffer.length === 0) firstPushMs = Date.now();
      buffer.push(event);
    },
    shouldFlush(now) {
      if (buffer.length === 0) return false;
      if (buffer.length >= maxBatchSize) return true;
      const age = (typeof now === 'number' ? now : Date.now()) - firstPushMs;
      return age >= maxAgeMs;
    },
    drain() {
      const out = buffer;
      buffer = [];
      firstPushMs = 0;
      return out;
    },
    size() {
      return buffer.length;
    },
  };
}

/**
 * Build the operations_log entry shape for an instrumentation batch.
 * Keeps all metadata flat so BQ queries are simple.
 *
 * @param {object} args
 * @param {Array<object>} args.events
 * @param {string} args.userUid
 * @param {string} args.userEmail
 * @param {string} args.clientVersion
 * @returns {object}
 */
export function buildInstrumentationBatchEntry(args) {
  return {
    type: 'client_instrumentation',
    userUid: String(args.userUid || ''),
    userEmail: String(args.userEmail || ''),
    clientVersion: String(args.clientVersion || ''),
    events: Array.isArray(args.events) ? args.events.slice(0, 50) : [],
    eventCount: Array.isArray(args.events) ? args.events.length : 0,
    timestamp: new Date(),
  };
}
