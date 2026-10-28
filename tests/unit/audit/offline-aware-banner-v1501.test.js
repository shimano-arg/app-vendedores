// @ts-check
/**
 * v1501 §103 (2026-10-27) — audit del wiring offline-aware + banner.
 *
 * Verifica que:
 *   1. El banner `<div id="offline-stale-banner">` existe en index.html con
 *      los atributos correctos.
 *   2. El helper `window._applyReadPolicyDecision` + `window._setOfflineStaleBanner`
 *      + `window._lastServerSnapshotMs` están definidos en el inline.
 *   3. El listener `window.addEventListener('online', ...)` limpia el banner.
 *   4. Los 3 listeners inline (`_repartoSubscribe`, `_subscribePlannerPedidos`,
 *      `attachPlannerListeners`) usan `_applyReadPolicyDecision` (reemplazó
 *      a `shouldIgnoreCachedSnapshot` v1500 §102).
 *   5. El pure `shouldAcceptSnapshot` está exportado en el bundle.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const BUNDLE = readFileSync('app.bundle.js', 'utf8');

describe('v1501 §103 — banner "Sin conexión"', () => {
  it('existe <div id="offline-stale-banner"> con role=status', () => {
    expect(INDEX_HTML).toMatch(/<div id="offline-stale-banner"[^>]*role="status"/);
    expect(INDEX_HTML).toMatch(/aria-live="polite"/);
    expect(INDEX_HTML).toContain('Sin conexión: los datos pueden estar desactualizados');
  });

  it('banner default display:none (invisible hasta que se dispara)', () => {
    const i = INDEX_HTML.indexOf('offline-stale-banner');
    const slice = INDEX_HTML.slice(i, i + 500);
    expect(slice).toMatch(/display:\s*none/);
  });

  it('banner tiene z-index alto para quedar arriba de todo', () => {
    const i = INDEX_HTML.indexOf('offline-stale-banner');
    const slice = INDEX_HTML.slice(i, i + 500);
    expect(slice).toMatch(/z-index:\s*\d{4,}/);
  });
});

describe('v1501 §103 — helpers window._*', () => {
  it('window._lastServerSnapshotMs inicializado', () => {
    expect(INDEX_HTML).toMatch(
      /window\._lastServerSnapshotMs\s*=\s*window\._lastServerSnapshotMs\s*\|\|/
    );
  });

  it('window._setOfflineStaleBanner definido', () => {
    expect(INDEX_HTML).toMatch(/window\._setOfflineStaleBanner\s*=\s*function/);
  });

  it('window._applyReadPolicyDecision definido + usa shouldAcceptSnapshot', () => {
    expect(INDEX_HTML).toMatch(/window\._applyReadPolicyDecision\s*=\s*function/);
    const i = INDEX_HTML.indexOf('_applyReadPolicyDecision = function');
    const slice = INDEX_HTML.slice(i, i + 2000);
    expect(slice).toMatch(/shouldAcceptSnapshot/);
    expect(slice).toMatch(/navigator\.onLine/);
  });

  it('listener window.addEventListener("online") limpia el banner', () => {
    expect(INDEX_HTML).toMatch(/window\.addEventListener\('online'/);
    // Verificar que limpia el display + el set.
    const i = INDEX_HTML.indexOf("window.addEventListener('online'");
    const slice = INDEX_HTML.slice(i, i + 1000);
    expect(slice).toMatch(/offline-stale-banner/);
    expect(slice).toMatch(/clear\(\)/);
  });
});

describe('v1501 §103 — pure fn exportada', () => {
  it('shouldAcceptSnapshot exportada del pure', () => {
    const policy = readFileSync('src/pure/firestore-read-policy.js', 'utf8');
    expect(policy).toMatch(/export function shouldAcceptSnapshot/);
  });

  it('bundle expone shouldAcceptSnapshot en firestoreReadPolicy', () => {
    expect(BUNDLE).toMatch(/shouldAcceptSnapshot/);
  });
});

describe('v1501 §103 — listeners críticos usan _applyReadPolicyDecision', () => {
  it('_repartoSubscribe NO usa shouldIgnoreCachedSnapshot (eliminado)', () => {
    const i = INDEX_HTML.indexOf('_repartoSubscribe');
    const slice = INDEX_HTML.slice(i, i + 5000);
    expect(slice).not.toMatch(/shouldIgnoreCachedSnapshot\('ingresos_reparto'/);
    expect(slice).toMatch(/_applyReadPolicyDecision\('ingresos_reparto'/);
  });

  it('_subscribePlannerPedidos NO usa shouldIgnoreCachedSnapshot (eliminado)', () => {
    const i = INDEX_HTML.indexOf('function _subscribePlannerPedidos');
    const slice = INDEX_HTML.slice(i, i + 3000);
    expect(slice).not.toMatch(/shouldIgnoreCachedSnapshot\('pedidos'/);
    expect(slice).toMatch(/_applyReadPolicyDecision\('pedidos'/);
  });

  it('attachPlannerListeners (revision_waitlist) NO usa shouldIgnoreCachedSnapshot', () => {
    const i = INDEX_HTML.indexOf('function attachPlannerListeners');
    const slice = INDEX_HTML.slice(i, i + 5000);
    expect(slice).not.toMatch(/shouldIgnoreCachedSnapshot\('revision_waitlist'/);
    expect(slice).toMatch(/_applyReadPolicyDecision\('revision_waitlist'/);
  });

  it('ensureListenerWithFallback NO usa shouldIgnoreCachedSnapshot directo', () => {
    const i = INDEX_HTML.indexOf('function ensureListenerWithFallback');
    const slice = INDEX_HTML.slice(i, i + 5000);
    expect(slice).not.toMatch(/_policyMod\.shouldIgnoreCachedSnapshot/);
    expect(slice).toMatch(/_applyReadPolicyDecision\(_policyPath/);
  });
});

describe('v1501 §103 — version bump', () => {
  it('APP_VERSION bumpeado a v1501', () => {
    expect(INDEX_HTML).toMatch(/const APP_VERSION = 'v1501'/);
  });

  it('CACHE_VERSION bumpeado a v1501', () => {
    const SW_JS = readFileSync('sw.js', 'utf8');
    expect(SW_JS).toMatch(/CACHE_VERSION = 'v1501'/);
  });
});
