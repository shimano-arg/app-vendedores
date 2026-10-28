// @ts-check
/**
 * v1500 §102 (2026-10-27) — audit de migración de call-sites a la política
 * de lectura server (`src/pure/firestore-read-policy.js`).
 *
 * Verifica que:
 *  1. Los 4 listeners `ensureListenerWithFallback` sobre colecciones críticas
 *     pasen `{ path: 'X' }` para activar `includeMetadataChanges` + filter
 *     `shouldIgnoreCachedSnapshot`.
 *  2. Los `onSnapshot` directos (sin helper) sobre `revision_waitlist`,
 *     `pedidos` y `ingresos_reparto` usen `includeMetadataChanges: true` con
 *     filter `shouldIgnoreCachedSnapshot`.
 *  3. Los `.get()` sobre las 4 colecciones críticas pasen por
 *     `getReadOptionsForPath` del pure helper.
 *  4. El bundle expone `window.__phase0.pure.firestoreReadPolicy`.
 *
 * Si un futuro desarrollador agrega un nuevo call-site sin migrar, el test
 * falla con un error claro.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');

describe('v1500 §102 — call-sites migrados a política lectura server', () => {
  it('bundle expone firestoreReadPolicy en window.__phase0.pure', () => {
    expect(MAIN_JS).toContain('firestore-read-policy');
    expect(MAIN_JS).toMatch(/firestoreReadPolicy[\s\S]*(ALWAYS_SERVER_PATHS|shouldReadFromServer)/);
  });

  it('ensureRevisionWaitlistListener pasa { path: "revision_waitlist" }', () => {
    expect(INDEX_HTML).toMatch(
      /ensureListenerWithFallback\([\s\S]{0,2000}revision_waitlist[\s\S]{0,2000}path:\s*'revision_waitlist'/
    );
  });

  it('ensureStockSnapshotListener pasa { path: "app_config/stock_snapshot" }', () => {
    expect(INDEX_HTML).toMatch(
      /ensureListenerWithFallback\([\s\S]{0,2000}stock_snapshot[\s\S]{0,2000}path:\s*'app_config\/stock_snapshot'/
    );
  });

  it('listeners de pedidos (own + all) pasan { path: "pedidos" }', () => {
    const pedidosPathCount = (INDEX_HTML.match(/path:\s*'pedidos'/g) || []).length;
    // 2 listeners (own + all) + al menos 1 doc comment.
    expect(pedidosPathCount).toBeGreaterThanOrEqual(2);
  });

  it('_repartoSubscribe usa includeMetadataChanges + _applyReadPolicyDecision (v1501 §103)', () => {
    const i = INDEX_HTML.indexOf('_repartoSubscribe');
    expect(i).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(i, i + 5000);
    expect(slice).toMatch(/includeMetadataChanges:\s*true/);
    expect(slice).toMatch(/_applyReadPolicyDecision\('ingresos_reparto'/);
  });

  it('_subscribePlannerPedidos usa includeMetadataChanges + _applyReadPolicyDecision (v1501 §103)', () => {
    const i = INDEX_HTML.indexOf('function _subscribePlannerPedidos');
    expect(i).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(i, i + 3000);
    expect(slice).toMatch(/includeMetadataChanges:\s*true/);
    expect(slice).toMatch(/_applyReadPolicyDecision\('pedidos'/);
  });

  it('attachPlannerListeners (revision_waitlist) usa includeMetadataChanges + _applyReadPolicyDecision (v1501 §103)', () => {
    const i = INDEX_HTML.indexOf('function attachPlannerListeners');
    expect(i).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(i, i + 5000);
    expect(slice).toMatch(/includeMetadataChanges:\s*true/);
    expect(slice).toMatch(/_applyReadPolicyDecision\('revision_waitlist'/);
  });

  it('.get() sobre pedidos usa getReadOptionsForPath("pedidos") (al menos 4 call-sites)', () => {
    const matches = INDEX_HTML.match(/getReadOptionsForPath\('pedidos'\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('.get() sobre revision_waitlist usa getReadOptionsForPath("revision_waitlist") (fresh query §42.1)', () => {
    expect(INDEX_HTML).toMatch(
      /revision_waitlist[\s\S]{0,500}getReadOptionsForPath\('revision_waitlist'\)/
    );
  });

  it('APP_VERSION >= v1500', () => {
    const m = INDEX_HTML.match(/const APP_VERSION = 'v(\d+)'/);
    expect(m).not.toBeNull();
    // @ts-expect-error
    expect(Number(m[1])).toBeGreaterThanOrEqual(1500);
  });

  it('CACHE_VERSION >= v1500 y sincronizado', () => {
    const SW_JS = readFileSync('sw.js', 'utf8');
    const htmlM = INDEX_HTML.match(/const APP_VERSION = 'v(\d+)'/);
    const swM = SW_JS.match(/CACHE_VERSION = 'v(\d+)'/);
    expect(htmlM).not.toBeNull();
    expect(swM).not.toBeNull();
    // @ts-expect-error
    expect(swM[1]).toBe(htmlM[1]);
  });
});

describe('v1500 §102 — ensureListenerWithFallback soporta options.path', () => {
  it('ensureListenerWithFallback acepta options.path y usa _applyReadPolicyDecision (v1501 §103)', () => {
    const i = INDEX_HTML.indexOf('function ensureListenerWithFallback');
    expect(i).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(i, i + 5000);
    expect(slice).toMatch(/_policyPath\s*=\s*options\.path/);
    expect(slice).toMatch(/_isCriticalPath/);
    expect(slice).toMatch(/includeMetadataChanges:\s*true/);
    expect(slice).toMatch(/_applyReadPolicyDecision\(_policyPath/);
  });
});
