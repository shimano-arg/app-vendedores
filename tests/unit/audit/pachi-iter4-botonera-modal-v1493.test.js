// @ts-check
/**
 * v1493 §92 (2026-10-27) PACHI iter 4 — botonera del modal pedido carga.
 *
 * Bug reportado: PACHI test (pruebas.pachi@shimano.com.ar) al cargar pedido
 * nuevo (BUEN PIQUE S.R.L.) ve "Cancelar + Vista preliminar + VOLVER A
 * PENDIENTES + ELIMINAR" sin "Enviar a lista de espera". Admin ve "Cancelar
 * + Enviar a lista de espera + Vista preliminar".
 *
 * Dos causas:
 *   1. `openPedidoModal` NO reseteaba `#pm-actions-confirmed` → botonera
 *      residual de pedido confirmed previo quedaba visible.
 *   2. `can-revision` dependía solo de `email.endsWith('@shimano.*')`.
 *      PACHI real `pachinaba@gmail.com` no cumplía. Fuente única: pure fn
 *      `canRevisionEmailOrUid(email, uid)` incluye PACHI_UIDS.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PACHI_SRC = readFileSync('src/pure/pachi-restrictions.js', 'utf8');
const PEDIDOS_MODAL = readFileSync('src/domains/pedidos-modal.js', 'utf8');
const INDEX_HTML = readFileSync('index.html', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');

describe('v1493 §92 — canRevisionEmailOrUid pure fn (fuente única)', () => {
  it('T1 export canRevisionEmailOrUid presente en pachi-restrictions.js', () => {
    expect(PACHI_SRC).toMatch(/export function canRevisionEmailOrUid/);
  });

  it('T2 incluye PACHI_UIDS en la decisión', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    // PACHI real (gmail): email NO cumple pero uid sí → true.
    expect(mod.canRevisionEmailOrUid('pachinaba@gmail.com', 'LaBFi1xkSLObzLEdRoP8fonZ06r2')).toBe(
      true
    );
    // Test user: email @shimano → true por email.
    expect(mod.canRevisionEmailOrUid('pruebas.pachi@shimano.com.ar', 'otro-uid')).toBe(true);
    // VDE regular con email @shimano → true por email.
    expect(mod.canRevisionEmailOrUid('mauricio.gil@shimano.com.ar', 'random-uid')).toBe(true);
    // Random user gmail sin UID PACHI → false.
    expect(mod.canRevisionEmailOrUid('random@gmail.com', 'random-uid')).toBe(false);
    // Email vacío + UID vacío → false.
    expect(mod.canRevisionEmailOrUid('', '')).toBe(false);
  });

  it('T3 acepta sufijos custom (defaults @shimano.com.ar + @shimano.uy)', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    expect(mod.canRevisionEmailOrUid('x@shimano.uy', 'uid')).toBe(true);
    // Con sufijo custom.
    expect(mod.canRevisionEmailOrUid('x@acme.com', 'uid', { emailSuffixes: ['@acme.com'] })).toBe(
      true
    );
    expect(
      mod.canRevisionEmailOrUid('x@shimano.com.ar', 'uid', { emailSuffixes: ['@acme.com'] })
    ).toBe(false);
  });

  it('T4 case-insensitive', async () => {
    const mod = await import('../../../src/pure/pachi-restrictions.js');
    expect(mod.canRevisionEmailOrUid('MAURICIO.GIL@SHIMANO.COM.AR', 'uid')).toBe(true);
  });
});

describe('v1493 §92 — main.js expone canRevisionEmailOrUid en __phase0.pure.pachiRestrictions', () => {
  it('T10 import en main.js', () => {
    expect(MAIN_JS).toMatch(/canRevisionEmailOrUid,?\s*$/m);
  });

  it('T11 export en __phase0.pure.pachiRestrictions', () => {
    const idx = MAIN_JS.indexOf('pachiRestrictions: {');
    const slice = MAIN_JS.slice(idx, idx + 800);
    expect(slice).toMatch(/canRevisionEmailOrUid/);
  });
});

describe('v1493 §92 — index.html usa la pure fn para can-revision', () => {
  it('T20 el toggle can-revision delega a canRevisionEmailOrUid', () => {
    const idx = INDEX_HTML.indexOf("classList.toggle('can-revision'");
    expect(idx).toBeGreaterThan(0);
    const pre = INDEX_HTML.slice(Math.max(0, idx - 2500), idx);
    expect(pre).toMatch(/canRevisionEmailOrUid/);
    expect(pre).toMatch(/v1493/);
  });

  it('T21 fallback inline preserva lógica legacy si bundle no cargó', () => {
    const idx = INDEX_HTML.indexOf("classList.toggle('can-revision'");
    const pre = INDEX_HTML.slice(Math.max(0, idx - 2500), idx);
    expect(pre).toMatch(/endsWith\('@shimano\.com\.ar'\)/);
    expect(pre).toMatch(/endsWith\('@shimano\.uy'\)/);
  });
});

describe('v1493 §92 — openPedidoModal resetea pm-actions-confirmed', () => {
  it('T30 pedidos-modal.js: openPedidoModal setea pm-actions-confirmed display none', () => {
    const idx = PEDIDOS_MODAL.indexOf('function openPedidoModal');
    expect(idx).toBeGreaterThan(0);
    const slice = PEDIDOS_MODAL.slice(idx, idx + 2500);
    expect(slice).toMatch(
      /_actionsConfirmedEl.*=.*getElementById\(['"]pm-actions-confirmed['"]\)/s
    );
    expect(slice).toMatch(/_actionsConfirmedEl.*display.*=.*['"]none['"]/s);
  });

  it('T31 el reset está DESPUÉS de pm-actions-edit y ANTES del open del modal', () => {
    const idx = PEDIDOS_MODAL.indexOf('function openPedidoModal');
    const slice = PEDIDOS_MODAL.slice(idx, idx + 2500);
    const editSetIdx = slice.indexOf('pm-actions-edit');
    const confirmedResetIdx = slice.indexOf('pm-actions-confirmed');
    const modalOpenIdx = slice.indexOf("classList.add('open')");
    expect(editSetIdx).toBeGreaterThan(0);
    expect(confirmedResetIdx).toBeGreaterThan(editSetIdx);
    expect(modalOpenIdx).toBeGreaterThan(confirmedResetIdx);
  });

  it('T32 referencia v1493 §92 en el comentario del reset', () => {
    const idx = PEDIDOS_MODAL.indexOf('function openPedidoModal');
    const slice = PEDIDOS_MODAL.slice(idx, idx + 2500);
    expect(slice).toMatch(/v1493.*§92/);
  });
});

describe('v1493 — bump versión', () => {
  it('T40 APP_VERSION ≥ v1493 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    // @ts-expect-error — matched above
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1493);
    // @ts-expect-error — matched above
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});
