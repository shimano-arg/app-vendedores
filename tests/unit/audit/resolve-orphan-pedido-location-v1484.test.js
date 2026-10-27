// @ts-check
/**
 * v1484 §83 (2026-10-27) — resolver prov/loc de pedidos huérfanos desde
 * client_master (fuente 1) + POINTS por clientName (fuente 2).
 *
 * Mariano pidió 3 casos de test:
 *   T1: pedido con datos (province + locName presentes) → sin cambio.
 *   T2: pedido vacío con cliente master completo → resuelto.
 *   T3: pedido vacío con cliente master incompleto → queda huérfano.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveOrphanPedidoLocation } from '../../../src/pure/resolve-orphan-pedido-location.js';

describe('v1484 §83 — resolveOrphanPedidoLocation (pure fn)', () => {
  it('T1 pedido con datos (prov + loc completos) → devuelve lo original sin cambio', () => {
    const pedido = {
      province: 'CHUBUT',
      locName: 'COMODORO RIVADAVIA',
      clientCardCode: 'C20293164852',
      clientName: 'JUAN MIGUEL BENGOCHEA',
    };
    const cache = new Map();
    const r = resolveOrphanPedidoLocation(pedido, cache, []);
    // Pedido ya tiene datos; el pure devuelve originales (no "resolvedFromMaster"
    // porque es un llamado "limpio"; la UI sólo invoca esta fn cuando el
    // pedido ES huérfano por !visibleKeys.has(key)).
    expect(r.province).toBe('CHUBUT');
    expect(r.locName).toBe('COMODORO RIVADAVIA');
    expect(r.resolvedFromMaster).toBe(false);
    expect(r.source).toBe('none');
  });

  it('T2 pedido vacío + client_master completo → resuelto desde master', () => {
    const pedido = {
      province: '',
      locName: '',
      clientCardCode: 'C20110561068',
      clientName: 'ALBERTO MAXERA',
    };
    const cache = new Map();
    cache.set('(sin provincia)__(sin localidad)__ALBERTO MAXERA', {
      sapCardCode: 'C20110561068',
      provincia: 'BUENOS AIRES',
      localidad: 'CABA',
      clientName: 'ALBERTO MAXERA',
    });
    const r = resolveOrphanPedidoLocation(pedido, cache, []);
    expect(r.province).toBe('BUENOS AIRES');
    expect(r.locName).toBe('CABA');
    expect(r.resolvedFromMaster).toBe(true);
    expect(r.source).toBe('master');
  });

  it('T3 pedido vacío + client_master INCOMPLETO (sin prov/loc) → queda huérfano', () => {
    const pedido = {
      province: '',
      locName: '',
      clientCardCode: 'C20110561068',
      clientName: 'ALBERTO MAXERA',
    };
    const cache = new Map();
    // Master existe pero con placeholders "(sin provincia)" (padrón real).
    cache.set('X', {
      sapCardCode: 'C20110561068',
      provincia: '(sin provincia)',
      localidad: '(sin localidad)',
    });
    const r = resolveOrphanPedidoLocation(pedido, cache, []);
    expect(r.province).toBe('');
    expect(r.locName).toBe('');
    expect(r.resolvedFromMaster).toBe(false);
    expect(r.source).toBe('none');
  });
});

describe('v1484 §83 — fuente 2: POINTS fallback por clientName', () => {
  it('T10 pedido vacío + no en master + sí en POINTS → resuelto desde points', () => {
    const pedido = {
      province: '',
      locName: '',
      clientCardCode: 'CXXX',
      clientName: 'ALGUN CLIENTE',
    };
    const cache = new Map(); // vacío
    const points = [{ province: 'CHUBUT', name: 'COMODORO RIVADAVIA', clients: ['ALGUN CLIENTE'] }];
    const r = resolveOrphanPedidoLocation(pedido, cache, points);
    expect(r.province).toBe('CHUBUT');
    expect(r.locName).toBe('COMODORO RIVADAVIA');
    expect(r.resolvedFromMaster).toBe(true);
    expect(r.source).toBe('points');
  });

  it('T11 master gana sobre points si ambos resuelven', () => {
    const pedido = { province: '', locName: '', clientCardCode: 'CYYY', clientName: 'X' };
    const cache = new Map([
      ['A', { sapCardCode: 'CYYY', provincia: 'MASTER_PROV', localidad: 'MASTER_LOC' }],
    ]);
    const points = [{ province: 'POINTS_PROV', name: 'POINTS_LOC', clients: ['X'] }];
    const r = resolveOrphanPedidoLocation(pedido, cache, points);
    expect(r.province).toBe('MASTER_PROV');
    expect(r.source).toBe('master');
  });

  it('T12 points match case-insensitive por clientName uppercase', () => {
    const pedido = { province: '', locName: '', clientCardCode: '', clientName: 'juan perez' };
    const points = [{ province: 'PROV', name: 'LOC', clients: ['JUAN PEREZ'] }];
    const r = resolveOrphanPedidoLocation(pedido, null, points);
    expect(r.resolvedFromMaster).toBe(true);
    expect(r.source).toBe('points');
  });
});

describe('v1484 §83 — edge cases', () => {
  it('T20 cache null → devuelve originales', () => {
    const r = resolveOrphanPedidoLocation(
      { province: 'A', locName: 'B', clientCardCode: 'C' },
      null,
      null
    );
    expect(r.province).toBe('A');
    expect(r.source).toBe('none');
  });

  it('T21 pedido sin cardCode → no busca en master, intenta POINTS si hay clientName', () => {
    const r = resolveOrphanPedidoLocation(
      { province: '', locName: '', clientName: 'TIENDA X' },
      new Map(),
      [{ province: 'P', name: 'L', clients: ['TIENDA X'] }]
    );
    expect(r.resolvedFromMaster).toBe(true);
    expect(r.source).toBe('points');
  });

  it('T22 pedido null/undefined → no crash', () => {
    const r = resolveOrphanPedidoLocation(null, null, null);
    expect(r.province).toBe('');
    expect(r.locName).toBe('');
    expect(r.resolvedFromMaster).toBe(false);
  });

  it('T23 master con sapState/sapCity (fallback a campos sin tildes)', () => {
    const cache = new Map([
      [
        'X',
        {
          sapCardCode: 'CZ',
          provincia: '',
          localidad: '',
          sapState: 'CORDOBA',
          sapCity: 'VILLA MARIA',
        },
      ],
    ]);
    const r = resolveOrphanPedidoLocation(
      { province: '', locName: '', clientCardCode: 'CZ' },
      cache
    );
    expect(r.province).toBe('CORDOBA');
    expect(r.locName).toBe('VILLA MARIA');
    expect(r.source).toBe('master');
  });

  it('T24 cardCodeSap alias (algunos docs lo tienen en vez de sapCardCode)', () => {
    const cache = new Map([['X', { cardCodeSap: 'CA', provincia: 'SALTA', localidad: 'ORAN' }]]);
    const r = resolveOrphanPedidoLocation(
      { province: '', locName: '', clientCardCode: 'CA' },
      cache
    );
    expect(r.source).toBe('master');
    expect(r.province).toBe('SALTA');
  });
});

describe('v1484 §83 — contrato index.html usa el pure fn', () => {
  const HTML = readFileSync('index.html', 'utf8');

  it('T30 renderPendientesList invoca resolveOrphanPedidoLocation (pure)', () => {
    const idx = HTML.indexOf('function renderPendientesList()');
    expect(idx).toBeGreaterThan(0);
    const slice = HTML.slice(idx, idx + 3500);
    expect(slice).toMatch(/resolveOrphanPedidoLocation/);
    // Flag isOrphan se puede flipar a false si r.resolvedFromMaster.
    expect(slice).toMatch(/r\.resolvedFromMaster/);
    expect(slice).toMatch(/isOrphan = false/);
  });

  it('T31 renderConfirmadosList invoca el mismo pure fn', () => {
    const idx = HTML.indexOf('function renderConfirmadosList()');
    expect(idx).toBeGreaterThan(0);
    const slice = HTML.slice(idx, idx + 2500);
    expect(slice).toMatch(/resolveOrphanPedidoLocation/);
    expect(slice).toMatch(/r\.resolvedFromMaster/);
    expect(slice).toMatch(/isOrphan = false/);
  });

  it('T32 ambas listas pasan POINTS como 3er argumento', () => {
    // Grep: "clientMasterCache, typeof POINTS !== 'undefined' ? POINTS : null"
    const matches =
      HTML.match(/clientMasterCache,\s*typeof POINTS !== 'undefined' \? POINTS : null/g) || [];
    expect(
      matches.length,
      'POINTS pasado a resolveOrphanPedidoLocation en ambos sitios'
    ).toBeGreaterThanOrEqual(2);
  });

  it('T33 main.js expone resolveOrphanPedidoLocation en window.__phase0.pure', () => {
    const MAIN = readFileSync('src/main.js', 'utf8');
    expect(MAIN).toMatch(/resolveOrphanPedidoLocation/);
    expect(MAIN).toMatch(/resolveOrphanPedidoLocation: \{/);
  });
});

describe('v1484 — bump versión', () => {
  it('T40 APP_VERSION ≥ v1484 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch, 'APP_VERSION').not.toBeNull();
    expect(swMatch, 'CACHE_VERSION').not.toBeNull();
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1484);
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});
