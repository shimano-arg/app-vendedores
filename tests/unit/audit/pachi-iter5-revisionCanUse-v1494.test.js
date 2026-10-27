// @ts-check
/**
 * v1494 §93 (2026-10-27) PACHI iter 5 — Enviar a lista de espera bloqueado.
 *
 * Bug: PACHI test (pruebas.pachi@shimano.com.ar) toca "Enviar a lista de
 * espera" sobre un borrador nuevo (GRILLO HUGO FELIPE, San Luis, EXG425SURF)
 * y recibe alert "Solo Mariano, Ioannis, Santi o Pablo...".
 *
 * Causa raíz: `_revisionCanUse()` en index.html chequeaba solo
 * `email.endsWith('@shimano.*')` + mensaje stale del whitelist pre-v517.
 * PACHI real `pachinaba@gmail.com` NO cumple. Test user shimano sí
 * cumple pero sensible al race Firebase auth.
 *
 * Fix: `_revisionCanUse` delega a la pure fn `canRevisionEmailOrUid`
 * (v1493 §92 fuente única). Mensaje de alert actualizado — no menciona
 * nombres específicos.
 *
 * Rules: `revision_waitlist.create` requiere `isReader()` + `ownerUid`.
 * `isReader() = isAdmin() OR isViewer() OR isVendor() OR isInterno() OR
 * isGerente()`. PACHI tiene `role='vendedor'` → ya cumple. Sin cambios
 * en rules.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const RULES = readFileSync('firestore.rules', 'utf8');

describe('v1494 §93 — _revisionCanUse usa canRevisionEmailOrUid', () => {
  it('T1 _revisionCanUse delega a la pure fn', () => {
    const idx = INDEX_HTML.indexOf('function _revisionCanUse');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1500);
    expect(slice).toMatch(/canRevisionEmailOrUid/);
    expect(slice).toMatch(/v1494/);
  });

  it('T2 fallback inline hardcodea PACHI_UIDS (SW stale compat)', () => {
    const idx = INDEX_HTML.indexOf('function _revisionCanUse');
    const slice = INDEX_HTML.slice(idx, idx + 1500);
    expect(slice).toMatch(/_PACHI_UIDS\s*=\s*\[/);
    expect(slice).toMatch(/LaBFi1xkSLObzLEdRoP8fonZ06r2/);
    expect(slice).toMatch(/tUJHiLDyLHWvbkpWgCQXWJcucfV2/);
  });

  it('T3 fallback preserva endsWith(@shimano) legacy', () => {
    const idx = INDEX_HTML.indexOf('function _revisionCanUse');
    const slice = INDEX_HTML.slice(idx, idx + 2500);
    expect(slice).toMatch(/endsWith\('@shimano\.com\.ar'\)/);
    expect(slice).toMatch(/endsWith\('@shimano\.uy'\)/);
  });

  it('T4 enviarBorradorAListaEspera: alert message actualizado (sin menciones de los 4)', () => {
    const idx = INDEX_HTML.indexOf('window.enviarBorradorAListaEspera');
    const slice = INDEX_HTML.slice(idx, idx + 2000);
    // Mensaje viejo "Solo Mariano, Ioannis, Santi o Pablo" NO debe estar.
    expect(slice).not.toContain('Solo Mariano, Ioannis, Santi o Pablo');
    expect(slice).toMatch(/No tenes permisos para mover pedidos a la lista de espera/);
  });
});

describe('v1494 §93 — contrato con pure fn canRevisionEmailOrUid', () => {
  it('T10 integración: PACHI real + test user + VDE regular pasan', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    // PACHI real: email NO shimano, UID en PACHI_UIDS → true.
    expect(mod.canRevisionEmailOrUid('pachinaba@gmail.com', 'LaBFi1xkSLObzLEdRoP8fonZ06r2')).toBe(
      true
    );
    // PACHI test user: email shimano → true.
    expect(
      mod.canRevisionEmailOrUid('pruebas.pachi@shimano.com.ar', 'tUJHiLDyLHWvbkpWgCQXWJcucfV2')
    ).toBe(true);
    // VDE regular shimano: email shimano → true.
    expect(mod.canRevisionEmailOrUid('gonzalo.de.la.rosa@shimano.com.ar', 'random-uid')).toBe(true);
    // User random sin match → false.
    expect(mod.canRevisionEmailOrUid('random@gmail.com', 'random-uid')).toBe(false);
  });
});

describe('v1494 §93 — rules revision_waitlist create admite PACHI', () => {
  it('T20 rules.revision_waitlist.create requiere isReader + ownerUid', () => {
    const idx = RULES.indexOf('match /revision_waitlist/{docId}');
    expect(idx).toBeGreaterThan(0);
    const slice = RULES.slice(idx, idx + 500);
    expect(slice).toMatch(
      /allow create: if isReader\(\) && request\.resource\.data\.ownerUid == request\.auth\.uid/
    );
  });

  it('T21 isReader() incluye isVendor() → PACHI (role=vendedor) cubierto', () => {
    const idx = RULES.indexOf('function isReader()');
    const slice = RULES.slice(idx, idx + 200);
    expect(slice).toMatch(/isVendor\(\)/);
  });
});

describe('v1494 — bump versión', () => {
  it('T40 APP_VERSION ≥ v1494 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    // @ts-expect-error — matched above
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1494);
    // @ts-expect-error — matched above
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});
