// v1523 (2026-10-29) — cache local de la lista de precios + fecha de stock
// del Master de Productos que se refresca al llegar el snapshot.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

/** Extrae el bloque de cache y lo ejecuta con un localStorage falso. */
function runCacheBlock(storage, initial = {}) {
  const start = html.indexOf("const PRICE_CACHE_KEY = 'shimano_price_cache_v1';");
  const end = html.indexOf('_loadPriceCache();', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const block = html.slice(start, end);
  const fn = new Function(
    'localStorage',
    'init',
    `let PRICE_LIST_MAP = init.prices || {};
     let PRICE_LIST_CURRENCY = 'ARS';
     let PRICE_LIST_UPDATED_AT = null;
     let TEMPORAL_PRICE_LIST_MAP = init.temporal || {};
     let TEMPORAL_PRICE_LIST_UPDATED_AT = null;
     ${block}
     _loadPriceCache();
     return {
       get: () => ({ PRICE_LIST_MAP, PRICE_LIST_CURRENCY, PRICE_LIST_UPDATED_AT, TEMPORAL_PRICE_LIST_MAP }),
       set: (p, t) => { PRICE_LIST_MAP = p; TEMPORAL_PRICE_LIST_MAP = t; },
       save: () => _savePriceCache(),
     };`
  );
  return fn(storage, initial);
}

function fakeStorage(data = {}) {
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('cache local de precios', () => {
  it('sin cache: arranca vacío (muestra "Cargando precios…")', () => {
    const r = runCacheBlock(fakeStorage());
    expect(r.get().PRICE_LIST_MAP).toEqual({});
  });

  it('guarda y al recargar hidrata los precios al instante', () => {
    const st = fakeStorage();
    const a = runCacheBlock(st);
    a.set({ CLC66H2PY: 150000 }, { X1: 10 });
    a.save();
    const b = runCacheBlock(st);
    expect(b.get().PRICE_LIST_MAP).toEqual({ CLC66H2PY: 150000 });
    expect(b.get().TEMPORAL_PRICE_LIST_MAP).toEqual({ X1: 10 });
  });

  it('no pisa datos reales si el listener ya los trajo', () => {
    const st = fakeStorage({
      shimano_price_cache_v1: JSON.stringify({ prices: { A: 1 }, temporal: {} }),
    });
    const r = runCacheBlock(st, { prices: { A: 2 } });
    expect(r.get().PRICE_LIST_MAP).toEqual({ A: 2 });
  });

  it('cache corrupto o storage que tira error: no rompe', () => {
    expect(() => runCacheBlock(fakeStorage({ shimano_price_cache_v1: '{no-json' }))).not.toThrow();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const r = runCacheBlock(broken);
    expect(() => r.save()).not.toThrow();
  });

  it('los listeners guardan el cache y el logout lo borra', () => {
    expect(html).toMatch(/\[precios\] SAP: [^\n]+\n\s+_savePriceCache\(\);/);
    expect(html).toMatch(/\[precios\] temporales: [^\n]+\n\s+_savePriceCache\(\);/);
    const so = html.slice(html.indexOf('window.signOut = function(){'));
    expect(so.slice(0, 400)).toContain("localStorage.removeItem('shimano_price_cache_v1')");
  });
});

describe('fecha de stock del Master de Productos', () => {
  it('el snapshot de Firestore refresca la fecha si el modal está abierto', () => {
    const i = html.indexOf("console.log('[stock] desde Firestore (");
    const tail = html.slice(i, i + 600);
    expect(tail).toContain('_renderPmMasterStockUpdatedAt()');
    expect(tail).toContain('renderProductMaster()');
  });
  it('el modal usa el mismo helper al abrir', () => {
    const i = html.indexOf('window.openProductMasterModal = function(){');
    expect(html.slice(i, i + 1500)).toContain('_renderPmMasterStockUpdatedAt();');
  });
});
