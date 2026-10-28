// @ts-check
/**
 * v1499 §98 (2026-10-27) — tests política lectura Firestore.
 */
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_SERVER_PATHS,
  getReadOptionsForPath,
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
