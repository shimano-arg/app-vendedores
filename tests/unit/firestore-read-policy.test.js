// @ts-check
/**
 * v1499 §98 (2026-10-27) — tests política lectura Firestore.
 */
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_SERVER_PATHS,
  getReadOptionsForPath,
  shouldAcceptSnapshot,
  shouldIgnoreCachedSnapshot,
  shouldReadFromServer,
} from '../../src/pure/firestore-read-policy.js';

describe('v1499 §98 — ALWAYS_SERVER_PATHS', () => {
  it('T1 lista frozen + contiene colecciones críticas', () => {
    expect(Object.isFrozen(ALWAYS_SERVER_PATHS)).toBe(true);
    expect(ALWAYS_SERVER_PATHS).toContain('app_config/stock_snapshot');
    expect(ALWAYS_SERVER_PATHS).toContain('ingresos_reparto');
    expect(ALWAYS_SERVER_PATHS).toContain('revision_waitlist');
    expect(ALWAYS_SERVER_PATHS).toContain('pedidos');
  });
});

describe('v1499 §98 — shouldReadFromServer', () => {
  it('T10 doc path exacto', () => {
    expect(shouldReadFromServer('app_config/stock_snapshot')).toBe(true);
    expect(shouldReadFromServer('app_config/live_sl')).toBe(false);
  });

  it('T11 colección match prefix', () => {
    expect(shouldReadFromServer('pedidos')).toBe(true);
    expect(shouldReadFromServer('pedidos/XYZ123')).toBe(true);
    expect(shouldReadFromServer('ingresos_reparto')).toBe(true);
    expect(shouldReadFromServer('ingresos_reparto/abc')).toBe(true);
    expect(shouldReadFromServer('revision_waitlist/w1')).toBe(true);
  });

  it('T12 NO matchea colecciones no listadas', () => {
    expect(shouldReadFromServer('users')).toBe(false);
    expect(shouldReadFromServer('roles')).toBe(false);
    expect(shouldReadFromServer('client_applications')).toBe(false);
    expect(shouldReadFromServer('operations_log')).toBe(false);
  });

  it('T13 NO matchea prefix accidental', () => {
    // `pedidos` NO debe matchear `pedidos_draft_locks`.
    expect(shouldReadFromServer('pedidos_draft_locks')).toBe(false);
    expect(shouldReadFromServer('pedidos_draft_locks/xxx')).toBe(false);
  });

  it('T14 input inválido → false', () => {
    expect(shouldReadFromServer('')).toBe(false);
    expect(shouldReadFromServer(/** @type {any} */ (null))).toBe(false);
    expect(shouldReadFromServer(/** @type {any} */ (undefined))).toBe(false);
    expect(shouldReadFromServer(/** @type {any} */ (123))).toBe(false);
  });
});

describe('v1499 §98 — getReadOptionsForPath', () => {
  it('T20 path crítico → {source:"server"}', () => {
    expect(getReadOptionsForPath('pedidos')).toEqual({ source: 'server' });
    expect(getReadOptionsForPath('app_config/stock_snapshot')).toEqual({ source: 'server' });
  });

  it('T21 path no crítico → undefined (default)', () => {
    expect(getReadOptionsForPath('users')).toBeUndefined();
    expect(getReadOptionsForPath('operations_log')).toBeUndefined();
  });
});

describe('v1499 §98 — shouldIgnoreCachedSnapshot', () => {
  it('T30 cache + path crítico → ignorar', () => {
    expect(shouldIgnoreCachedSnapshot('pedidos', { fromCache: true })).toBe(true);
    expect(shouldIgnoreCachedSnapshot('ingresos_reparto/x', { fromCache: true })).toBe(true);
  });

  it('T31 cache + path NO crítico → NO ignorar', () => {
    expect(shouldIgnoreCachedSnapshot('users', { fromCache: true })).toBe(false);
  });

  it('T32 fresh (no cache) → NO ignorar', () => {
    expect(shouldIgnoreCachedSnapshot('pedidos', { fromCache: false })).toBe(false);
  });

  it('T33 hasPendingWrites → NO ignorar (write local pendiente)', () => {
    // Si el user acaba de escribir, le mostramos aunque sea cache.
    expect(shouldIgnoreCachedSnapshot('pedidos', { fromCache: true, hasPendingWrites: true })).toBe(
      false
    );
  });

  it('T34 metadata vacía → NO ignorar', () => {
    expect(shouldIgnoreCachedSnapshot('pedidos', {})).toBe(false);
    expect(shouldIgnoreCachedSnapshot('pedidos', /** @type {any} */ (null))).toBe(false);
  });
});

describe('v1501 §103 — shouldAcceptSnapshot offline-aware (4 casos canonicos)', () => {
  const NOW = 1_700_000_000_000; // instante fijo para los tests.
  const RECENT = NOW - 10_000; // 10s atras.
  const STALE = NOW - 60_000; // 60s atras.

  it('T60 CASO 1: online=true + cache stale → RECHAZA (prefer servidor)', () => {
    const r = shouldAcceptSnapshot(
      'pedidos',
      { fromCache: true, hasPendingWrites: false },
      true,
      STALE,
      NOW
    );
    expect(r.accept).toBe(false);
    expect(r.reason).toBe('online_or_recent_server');
    expect(r.showStaleBanner).toBe(false);
  });

  it('T61 CASO 2: online=false + último server < 30s → RECHAZA (recent server)', () => {
    const r = shouldAcceptSnapshot(
      'pedidos',
      { fromCache: true, hasPendingWrites: false },
      false,
      RECENT,
      NOW
    );
    expect(r.accept).toBe(false);
    expect(r.reason).toBe('online_or_recent_server');
    expect(r.showStaleBanner).toBe(false);
  });

  it('T62 CASO 3: online=false + sin server reciente → ACEPTA + banner', () => {
    const r = shouldAcceptSnapshot(
      'pedidos',
      { fromCache: true, hasPendingWrites: false },
      false,
      STALE,
      NOW
    );
    expect(r.accept).toBe(true);
    expect(r.reason).toBe('offline_fallback');
    expect(r.showStaleBanner).toBe(true);
  });

  it('T63 CASO 4: online=false + nunca llegó server (null) → ACEPTA + banner', () => {
    const r = shouldAcceptSnapshot(
      'pedidos',
      { fromCache: true, hasPendingWrites: false },
      false,
      null,
      NOW
    );
    expect(r.accept).toBe(true);
    expect(r.reason).toBe('offline_fallback');
    expect(r.showStaleBanner).toBe(true);
  });

  it('T64 EDGE: snapshot del server (fromCache=false) → ACEPTA siempre', () => {
    const r1 = shouldAcceptSnapshot('pedidos', { fromCache: false }, true, STALE, NOW);
    expect(r1.accept).toBe(true);
    expect(r1.reason).toBe('from_server');
    const r2 = shouldAcceptSnapshot('pedidos', { fromCache: false }, false, null, NOW);
    expect(r2.accept).toBe(true);
  });

  it('T65 EDGE: hasPendingWrites=true → ACEPTA (write local propio)', () => {
    const r = shouldAcceptSnapshot(
      'pedidos',
      { fromCache: true, hasPendingWrites: true },
      true,
      STALE,
      NOW
    );
    expect(r.accept).toBe(true);
    expect(r.reason).toBe('has_pending_writes');
    expect(r.showStaleBanner).toBe(false);
  });

  it('T66 EDGE: path no crítico → ACEPTA siempre (política default)', () => {
    const r = shouldAcceptSnapshot(
      'users',
      { fromCache: true, hasPendingWrites: false },
      false,
      null,
      NOW
    );
    expect(r.accept).toBe(true);
    expect(r.reason).toBe('non_critical_path');
    expect(r.showStaleBanner).toBe(false);
  });

  it('T67 BORDE 30s exacto: server a los 30000ms → RECHAZA (no "<30s", es "<"))', () => {
    const r = shouldAcceptSnapshot('pedidos', { fromCache: true }, false, NOW - 30_000, NOW);
    // 30_000 - 30_000 = 0 → 0 < 30_000 false → recentServer false → offline fallback.
    expect(r.accept).toBe(true);
    expect(r.reason).toBe('offline_fallback');
  });

  it('T68 BORDE 29999ms: server reciente → RECHAZA cache', () => {
    const r = shouldAcceptSnapshot('pedidos', { fromCache: true }, false, NOW - 29_999, NOW);
    expect(r.accept).toBe(false);
    expect(r.reason).toBe('online_or_recent_server');
  });

  it('T69 metadata vacía → ACEPTA (fromCache undefined = treated as server)', () => {
    const r = shouldAcceptSnapshot('pedidos', {}, false, null, NOW);
    expect(r.accept).toBe(true);
    expect(r.reason).toBe('from_server');
  });

  it('T70 nowMs default a Date.now() si no se pasa', () => {
    const r = shouldAcceptSnapshot('pedidos', { fromCache: true }, true, Date.now() - 100);
    expect(r.accept).toBe(false);
  });
});

describe('v1499 §98 — contrato index.html + bundle', () => {
  it('T40 index.html detecta cambio versión antes de enablePersistence', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/shimano_app_version_last/);
    expect(html).toMatch(/clearPersistence/);
    expect(html).toMatch(/\[v1499 §98\] version change/);
  });

  it('T41 forceUpdateApp preserva borradores', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/CLEAN_RELOAD_PRESERVE_KEYS/);
    expect(html).toMatch(/shimano_zonas_pending_v1/);
    expect(html).toMatch(/shimano_theme/);
  });

  it('T42 forceUpdateApp hace terminate + clearPersistence + overlay', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('async function forceUpdateApp()');
    const slice = html.slice(idx, idx + 6000);
    expect(slice).toMatch(/w\.fbDb\.terminate/);
    expect(slice).toMatch(/\.clearPersistence\(\)/);
    expect(slice).toMatch(/clean-reload-overlay/);
    expect(slice).toMatch(/Limpiando datos locales y recargando/);
    expect(slice).toMatch(/sessionStorage\.clear/);
  });

  it('T43 tooltip del botón actualizado', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/Recargar limpio: borra la cache local/);
  });

  it('T44 main.js expone firestoreReadPolicy', async () => {
    const { readFileSync } = await import('node:fs');
    const m = readFileSync('src/main.js', 'utf8');
    expect(m).toMatch(/firestoreReadPolicy: \{/);
    expect(m).toMatch(/ALWAYS_SERVER_PATHS/);
  });
});

describe('v1499 — bump versión', () => {
  it('T50 APP_VERSION ≥ v1499 + sync SW', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    // @ts-expect-error
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1499);
    // @ts-expect-error
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});
