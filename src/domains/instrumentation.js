// @ts-nocheck
/**
 * Client-side instrumentation (Stack S-2 T4).
 *
 * Captures:
 *   - Core Web Vitals (LCP, CLS, INP) via native PerformanceObserver.
 *   - Cache hit/miss counters (manually marked by callers).
 *   - Commit phase timers (manually marked by callers).
 *
 * All events accumulate in an in-memory batch and flush to operations_log
 * fire-and-forget. Sampling: 20% per userUid (deterministic).
 *
 * NO behavior change: this module is pure instrumentation. Fails silently
 * if Firestore/firebase are not loaded.
 *
 * Usage:
 *   import { initInstrumentation, trackEvent } from 'src/domains/instrumentation.js';
 *   initInstrumentation({ fbDb, userUid, userEmail, clientVersion });
 *   trackEvent({ kind: 'cache_hit', name: 'stock_snapshot' });
 */

import {
  buildInstrumentationBatchEntry,
  createBatchCollector,
  INSTRUMENTATION_COLLECTION,
  shouldSampleUser,
} from '../pure/instrumentation-helpers.js';

const SAMPLING_PERCENT = 20;
const MAX_BATCH_SIZE = 20;
const MAX_BATCH_AGE_MS = 60_000;

/** @type {ReturnType<typeof createBatchCollector> | null} */
let _collector = null;
/** @type {object | null} */
let _ctx = null;
let _enabled = false;
let _flushTimer = null;
// S-3 adversarial fix F6 (2026-11-25): guard contra re-init duplicado.
// `initInstrumentation` se llama en cada login exitoso
// (attachFirebaseListeners). Sin guard, cada re-login registra listeners
// nuevos (visibilitychange) + crea PerformanceObservers nuevos sin
// disconnect. En una sesión con 5 re-logins → 5 observers LCP + 5 observers
// INP + 5 observers CLS + 5 visibility listeners → cada LCP dispara
// trackEvent 5 veces + cada hide dispara flush 5 veces.
let _observersRegistered = false;
let _unloadListenerRegistered = false;

/**
 * Initialize instrumentation. Idempotent — re-usa el collector existente
 * y actualiza el ctx; además, S-3 adversarial fix F6: NO re-registra
 * PerformanceObservers ni visibilitychange listeners. Si el usuario
 * ya fue inicializado antes (mismo o distinto uid), la segunda llamada
 * solo refresca el ctx.
 *
 * @param {object} opts
 * @param {object} opts.fbDb Firestore instance (compat v8).
 * @param {string} opts.userUid
 * @param {string} opts.userEmail
 * @param {string} opts.clientVersion
 */
export function initInstrumentation(opts) {
  _ctx = {
    fbDb: opts && opts.fbDb,
    userUid: String((opts && opts.userUid) || ''),
    userEmail: String((opts && opts.userEmail) || ''),
    clientVersion: String((opts && opts.clientVersion) || ''),
  };

  // Opt-out via localStorage (debug/testing).
  try {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('instrumentation_off') === '1'
    ) {
      _enabled = false;
      return;
    }
  } catch (_e) {
    /* fail-open */
  }

  _enabled = shouldSampleUser(_ctx.userUid, SAMPLING_PERCENT);
  if (!_enabled) return;

  if (!_collector) {
    _collector = createBatchCollector({
      maxBatchSize: MAX_BATCH_SIZE,
      maxAgeMs: MAX_BATCH_AGE_MS,
    });
  }

  // S-3 adversarial fix F6 (2026-11-25): guards para no leak-ear
  // observers ni listeners al re-loginear. Los observers+listener son
  // singleton por lifetime de la pagina; el ctx (quién es el user,
  // qué fbDb) se refresca arriba.
  if (!_observersRegistered) {
    _registerWebVitals();
    _observersRegistered = true;
  }
  _scheduleFlushTimer();
  if (!_unloadListenerRegistered) {
    _registerUnloadFlush();
    _unloadListenerRegistered = true;
  }
}

/**
 * Track a single instrumentation event. Fire-and-forget — never throws.
 *
 * @param {object} event
 */
export function trackEvent(event) {
  if (!_enabled || !_collector) return;
  try {
    const evt = {
      kind: String(event && event.kind) || 'unknown',
      ts: Date.now(),
    };
    for (const k of Object.keys(event || {})) {
      if (k === 'kind' || k === 'ts') continue;
      evt[k] = event[k];
    }
    _collector.push(evt);
    if (_collector.shouldFlush(Date.now())) _flushNow();
  } catch (_e) {
    /* fail-open */
  }
}

/**
 * Track a cache hit/miss. Caller maintains the counter name.
 *
 * @param {string} name
 * @param {boolean} hit
 */
export function trackCacheEvent(name, hit) {
  trackEvent({ kind: 'cache', name, hit: !!hit });
}

/**
 * Track a duration measurement (in ms).
 *
 * @param {string} name
 * @param {number} durationMs
 * @param {object} [extra]
 */
export function trackTiming(name, durationMs, extra) {
  const evt = { kind: 'timing', name, durationMs: Math.round(Number(durationMs) || 0) };
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(extra)) evt[k] = extra[k];
  }
  trackEvent(evt);
}

/**
 * Manual flush. Returns a promise that resolves after the write completes
 * (or rejects silently if Firestore is unavailable).
 */
export function flushInstrumentation() {
  return _flushNow();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _registerWebVitals() {
  if (typeof PerformanceObserver === 'undefined') return;

  // LCP — largest contentful paint.
  try {
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        trackEvent({
          kind: 'web_vitals',
          name: 'lcp',
          value: Math.round(last.startTime),
        });
      }
    });
    po.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_e) {
    /* fail-open */
  }

  // CLS — cumulative layout shift.
  try {
    let cls = 0;
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // @ts-expect-error
        if (!entry.hadRecentInput) cls += entry.value;
      }
    });
    po.observe({ type: 'layout-shift', buffered: true });
    // Emit final CLS on page hide.
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'hidden') {
            trackEvent({ kind: 'web_vitals', name: 'cls', value: Number(cls.toFixed(4)) });
          }
        },
        { once: true }
      );
    }
  } catch (_e) {
    /* fail-open */
  }

  // INP — approximate via event.duration (modern browsers only).
  try {
    const po = new PerformanceObserver((list) => {
      let maxDur = 0;
      for (const entry of list.getEntries()) {
        if (entry.duration > maxDur) maxDur = entry.duration;
      }
      if (maxDur > 0) {
        trackEvent({
          kind: 'web_vitals',
          name: 'inp',
          value: Math.round(maxDur),
        });
      }
    });
    po.observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch (_e) {
    /* fail-open */
  }
}

function _scheduleFlushTimer() {
  if (_flushTimer) return;
  if (typeof setInterval === 'undefined') return;
  _flushTimer = setInterval(() => {
    if (_collector && _collector.shouldFlush(Date.now())) _flushNow();
  }, 15_000);
}

function _registerUnloadFlush() {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _flushNow();
  });
}

function _flushNow() {
  if (!_collector || !_ctx || !_ctx.fbDb) return Promise.resolve();
  const events = _collector.drain();
  if (events.length === 0) return Promise.resolve();
  const entry = buildInstrumentationBatchEntry({
    events,
    userUid: _ctx.userUid,
    userEmail: _ctx.userEmail,
    clientVersion: _ctx.clientVersion,
  });
  try {
    // S-3 adversarial fix F1 (2026-11-25): escribir a instrumentation_log
    // (NO operations_log). Rules operations_log §A2.3 NO permite
    // type='client_instrumentation' ni las keys events/eventCount, lo
    // que rechaza 100% de los writes. instrumentation_log tiene su
    // propia rule que permite esta shape.
    return _ctx.fbDb
      .collection(INSTRUMENTATION_COLLECTION)
      .add(entry)
      .catch(() => {
        // Fire-and-forget: if the write fails, log goes nowhere. We do NOT
        // re-queue to avoid memory leaks if Firestore is persistently down.
      });
  } catch (_e) {
    return Promise.resolve();
  }
}

// Exposed for testing: reset state. Only callable in test env.
export function _resetInstrumentationForTests() {
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  _collector = null;
  _ctx = null;
  _enabled = false;
  _observersRegistered = false;
  _unloadListenerRegistered = false;
}

// Side-effect wiring: expose on window.__phase0.domains.instrumentation so
// the inline script (index.html attachFirebaseListeners) can call init.
if (typeof window !== 'undefined') {
  if (!window.__phase0) window.__phase0 = {};
  if (!window.__phase0.domains) window.__phase0.domains = {};
  window.__phase0.domains.instrumentation = {
    initInstrumentation,
    trackEvent,
    trackCacheEvent,
    trackTiming,
    flushInstrumentation,
  };
}
