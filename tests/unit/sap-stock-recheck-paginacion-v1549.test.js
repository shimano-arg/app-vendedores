// @ts-nocheck
/**
 * v1549 (2026-11-03) — bug ARIZAGA (SQ 2000476): el re-chequeo de stock en
 * vivo consultaba TODOS los productos en un solo GET (`$top=N`), pero SAP
 * Service Layer devuelve como máximo 20 por página (+ odata.nextLink). Los
 * productos después del 20 no volvían → se clasificaban `sap_item_not_found`
 * → la CAPA (c) los sacaba del envío en silencio. SAP recibió 20 líneas por
 * $2.615.000 de un pedido confirmado por $5.176.000.
 *
 * El simulador reproduce el comportamiento real del SL: filtra por los
 * ItemCode del `$filter`, corta en páginas de 20 y devuelve nextLink.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  fetchLiveWhs11Availability,
  filterLinesByLiveStock,
} from '../../functions/core/sap-stock-recheck-core.js';

const PAGE = 20;

function makeSlSimulado(catalog) {
  const calls = [];
  const fetch = vi.fn(async (url) => {
    calls.push(url);
    const u = new URL(url);
    const filter = u.searchParams.get('$filter') || '';
    const skip = Number(u.searchParams.get('$skip') || 0);
    const codes = [...filter.matchAll(/ItemCode eq '([^']+)'/g)].map((m) => m[1]);
    const matching = catalog.filter((it) => codes.includes(it.ItemCode));
    const page = matching.slice(skip, skip + PAGE);
    const body = { value: page };
    if (skip + PAGE < matching.length) {
      const next = new URL(url);
      next.searchParams.set('$skip', String(skip + PAGE));
      body['odata.nextLink'] = 'Items?' + next.searchParams.toString();
    }
    const txt = JSON.stringify(body);
    return { status: 200, ok: true, text: async () => txt, headers: { get: () => null } };
  });
  return {
    deps: { fetch, sapConfig: { url: 'https://sap.example' }, log: () => {} },
    calls,
  };
}

const item = (code, stock) => ({
  ItemCode: code,
  ItemWarehouseInfoCollection: [{ WarehouseCode: '11', InStock: stock, Committed: 0 }],
});

const session = { cookie: 'B1SESSION=abc' };

describe('v1549 — re-chequeo de stock con más de 20 productos', () => {
  const codes = Array.from({ length: 25 }, (_, i) => 'SKU' + String(i).padStart(2, '0'));
  const catalog = codes.map((c) => item(c, 10));

  it('fetchLiveWhs11Availability trae los 25 productos (no solo la primera página)', async () => {
    const { deps } = makeSlSimulado(catalog);
    const r = await fetchLiveWhs11Availability(session, codes, deps);
    expect(r.ok).toBe(true);
    expect(r.map.size).toBe(25);
    expect(r.map.get('SKU24')).toBe(10);
  });

  it('filterLinesByLiveStock no degrada como "no existe en SAP" a los productos 21 a 25', async () => {
    const { deps } = makeSlSimulado(catalog);
    const lines = codes.map((c, i) => ({ ItemCode: c, Quantity: 1, LineNum: i }));
    const r = await filterLinesByLiveStock(session, lines, deps);
    expect(r.checkSucceeded).toBe(true);
    expect(r.degradedLines).toEqual([]);
    expect(r.keptLines).toHaveLength(25);
  });

  it('un producto que de verdad no existe sigue marcado sap_item_not_found', async () => {
    const { deps } = makeSlSimulado(catalog);
    const lines = [...codes, 'NOEXISTE'].map((c, i) => ({ ItemCode: c, Quantity: 1, LineNum: i }));
    const r = await filterLinesByLiveStock(session, lines, deps);
    expect(r.keptLines).toHaveLength(25);
    expect(r.degradedLines).toEqual([
      { itemCode: 'NOEXISTE', requested: 1, available: 0, reason: 'sap_item_not_found' },
    ]);
  });

  it('pedido grande (124 productos) se consulta completo', async () => {
    const many = Array.from({ length: 124 }, (_, i) => 'P' + i);
    const { deps } = makeSlSimulado(many.map((c) => item(c, 5)));
    const r = await fetchLiveWhs11Availability(session, many, deps);
    expect(r.ok).toBe(true);
    expect(r.map.size).toBe(124);
  });

  it('si una página falla, el chequeo se marca fallido (no se degrada nada en silencio)', async () => {
    const { deps } = makeSlSimulado(catalog);
    let n = 0;
    const orig = deps.fetch;
    deps.fetch = vi.fn(async (url) => {
      n++;
      if (n === 2)
        return { status: 500, ok: false, text: async () => '{}', headers: { get: () => null } };
      return orig(url);
    });
    const r = await fetchLiveWhs11Availability(session, codes, deps);
    expect(r.ok).toBe(false);
  });
});

describe('v1549 — envío manual (navegador) consulta en tandas de 20', () => {
  it('sap-service-layer.js usa CHUNK_SIZE = 20', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/domains/sap-service-layer.js', 'utf8');
    expect(src).toMatch(/const CHUNK_SIZE = 20;/);
    expect(src).not.toMatch(/const CHUNK_SIZE = 50;/);
  });
});
