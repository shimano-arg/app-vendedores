// @ts-check
/**
 * v1496 §95 (2026-10-27) PACHI iter 6 — 3 bugs del modal "Pedido en espera":
 *
 *  1. Botón "Eliminar" oculto para PACHI (gate email-only).
 *  2. Timestamp "01:55:15" ambiguo (12h sin AM/PM) para hora de la tarde.
 *  3. Badge "Stock del snapshot" aunque flag live_sl=on
 *     (fetchStockLiveCF rechazaba por dominio-only).
 *
 * Fix fuente única:
 *   - `canDeleteOwnWaitlist(w, uid, email)` en pachi-restrictions.js
 *     — PACHI puede borrar sólo si `w.ownerUid === uid`.
 *   - `formatFirestoreDate` extendido con `{timeZone, hour12}` opts.
 *   - `fetchStockLiveCF` acepta PACHI_UIDS además de shimano domain.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PACHI_SRC = readFileSync('src/pure/pachi-restrictions.js', 'utf8');
const PARSE_DATE = readFileSync('src/pure/parse-date-flexible.js', 'utf8');
const INDEX_HTML = readFileSync('index.html', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');
const FUNCTIONS_INDEX = readFileSync('functions/index.js', 'utf8');

describe('v1496 §95 — canDeleteOwnWaitlist pure fn', () => {
  it('T1 export canDeleteOwnWaitlist presente', () => {
    expect(PACHI_SRC).toMatch(/export function canDeleteOwnWaitlist/);
  });

  it('T2 PACHI real: puede borrar su propio pedido', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    const w = { ownerUid: 'LaBFi1xkSLObzLEdRoP8fonZ06r2' };
    expect(mod.canDeleteOwnWaitlist(w, 'LaBFi1xkSLObzLEdRoP8fonZ06r2', 'pachinaba@gmail.com')).toBe(
      true
    );
  });

  it('T3 PACHI real: NO puede borrar pedido de otro VDE', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    const w = { ownerUid: 'OTRO_VDE_UID' };
    expect(mod.canDeleteOwnWaitlist(w, 'LaBFi1xkSLObzLEdRoP8fonZ06r2', 'pachinaba@gmail.com')).toBe(
      false
    );
  });

  it('T4 VDE regular shimano: puede borrar cualquier pedido (comportamiento v540)', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    const w = { ownerUid: 'ALGUIEN' };
    expect(mod.canDeleteOwnWaitlist(w, 'gonzalo-uid', 'gonzalo.de.la.rosa@shimano.com.ar')).toBe(
      true
    );
  });

  it('T5 Random user gmail (no PACHI): NO puede borrar', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    expect(mod.canDeleteOwnWaitlist({ ownerUid: 'X' }, 'random-uid', 'random@gmail.com')).toBe(
      false
    );
  });

  it('T6 PACHI test user: comportamiento igual a PACHI real', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    const own = { ownerUid: 'tUJHiLDyLHWvbkpWgCQXWJcucfV2' };
    const ajeno = { ownerUid: 'OTRO' };
    expect(
      mod.canDeleteOwnWaitlist(own, 'tUJHiLDyLHWvbkpWgCQXWJcucfV2', 'pruebas.pachi@shimano.com.ar')
    ).toBe(true);
    expect(
      mod.canDeleteOwnWaitlist(
        ajeno,
        'tUJHiLDyLHWvbkpWgCQXWJcucfV2',
        'pruebas.pachi@shimano.com.ar'
      )
    ).toBe(false);
  });

  it('T7 waitlist sin ownerUid: PACHI no puede (defensivo)', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    expect(
      mod.canDeleteOwnWaitlist({}, 'LaBFi1xkSLObzLEdRoP8fonZ06r2', 'pachinaba@gmail.com')
    ).toBe(false);
    expect(
      mod.canDeleteOwnWaitlist(null, 'LaBFi1xkSLObzLEdRoP8fonZ06r2', 'pachinaba@gmail.com')
    ).toBe(false);
  });
});

describe('v1496 §95 — main.js expone canDeleteOwnWaitlist', () => {
  it('T10 import en main.js', () => {
    expect(MAIN_JS).toMatch(/canDeleteOwnWaitlist,/);
  });

  it('T11 export en __phase0.pure.pachiRestrictions', () => {
    const idx = MAIN_JS.indexOf('pachiRestrictions: {');
    const slice = MAIN_JS.slice(idx, idx + 900);
    expect(slice).toMatch(/canDeleteOwnWaitlist/);
  });
});

describe('v1496 §95 — index.html gate wcard-delete-btn usa canDeleteOwnWaitlist', () => {
  it('T20 el gate delega a la pure fn', () => {
    const idx = INDEX_HTML.indexOf("getElementById('wcard-delete-btn')");
    expect(idx).toBeGreaterThan(0);
    const pre = INDEX_HTML.slice(Math.max(0, idx - 2200), idx);
    expect(pre).toMatch(/canDeleteOwnWaitlist/);
    expect(pre).toMatch(/v1496.*§95/);
  });

  it('T21 fallback inline incluye PACHI_UIDS hardcoded', () => {
    const idx = INDEX_HTML.indexOf("getElementById('wcard-delete-btn')");
    const pre = INDEX_HTML.slice(Math.max(0, idx - 2200), idx);
    expect(pre).toMatch(/LaBFi1xkSLObzLEdRoP8fonZ06r2/);
    expect(pre).toMatch(/tUJHiLDyLHWvbkpWgCQXWJcucfV2/);
  });
});

describe('v1496 §95 — timestamp 24h ART', () => {
  it('T30 formatFirestoreDate acepta timeZone + hour12 opts', () => {
    expect(PARSE_DATE).toMatch(/opts\.timeZone/);
    expect(PARSE_DATE).toMatch(/opts\.hour12/);
    expect(PARSE_DATE).toMatch(/v1496.*§95/);
  });

  it('T31 pure fn formatea en 24h ART cuando se le pasan opts', async () => {
    const mod = await import('../../../src/pure/parse-date-flexible.js');
    // 2026-10-27T16:55:15Z = 2026-10-27 13:55:15 ART.
    const r = mod.formatFirestoreDate('2026-10-27T16:55:15Z', {
      style: 'datetime',
      timeZone: 'America/Argentina/Buenos_Aires',
      hour12: false,
    });
    expect(r).toMatch(/13:55:15/);
    // NO debe contener AM ni PM.
    expect(r).not.toMatch(/\bAM\b|\bPM\b/i);
  });

  it('T32 index.html usa el pure fn con timeZone ART + hour12=false en wcard-subt', () => {
    // Buscar el bloque v1496 §95 PACHI iter 6 que precede al render de wcard-subt.
    const idx = INDEX_HTML.indexOf('v1496 §95 (2026-10-27) PACHI iter 6: formatear createdAt');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1500);
    expect(slice).toMatch(/formatFirestoreDate/);
    expect(slice).toMatch(/America\/Argentina\/Buenos_Aires/);
    expect(slice).toMatch(/hour12:\s*false/);
  });
});

describe('v1496 §95 — fetchStockLiveCF acepta PACHI_UIDS', () => {
  it('T40 functions/index.js include PACHI_UIDS en el gate', () => {
    const idx = FUNCTIONS_INDEX.indexOf('const fetchStockLiveCF = onCall');
    expect(idx).toBeGreaterThan(0);
    const slice = FUNCTIONS_INDEX.slice(idx, idx + 2500);
    expect(slice).toMatch(/PACHI_UIDS/);
    expect(slice).toMatch(/LaBFi1xkSLObzLEdRoP8fonZ06r2/);
    expect(slice).toMatch(/tUJHiLDyLHWvbkpWgCQXWJcucfV2/);
  });

  it('T41 el gate acepta Shimano domain OR PACHI_UIDS', () => {
    const idx = FUNCTIONS_INDEX.indexOf('const fetchStockLiveCF = onCall');
    const slice = FUNCTIONS_INDEX.slice(idx, idx + 2500);
    expect(slice).toMatch(/_isShimanoDomain/);
    expect(slice).toMatch(/_isPachi/);
    expect(slice).toMatch(/!_isShimanoDomain && !_isPachi/);
  });
});

describe('v1496 — bump versión', () => {
  it('T50 APP_VERSION ≥ v1496 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    // @ts-expect-error
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1496);
    // @ts-expect-error
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});
