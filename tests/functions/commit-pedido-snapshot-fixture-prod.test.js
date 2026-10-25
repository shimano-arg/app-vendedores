// @ts-check
/**
 * 2026-10-25 (v1449) — Blindaje con fixture REAL de prod.
 *
 * Mariano pidió "fixture del snapshot real copiado de prod" para asegurar
 * que la paridad client ↔ CF no se rompa si Python cambia el shape del
 * snapshot (precedente 23/10 17:52: paso de dict → JSON string, el CF leía
 * `typeof === 'object'` → TODO BO).
 *
 * Fixture: tests/fixtures/stock_snapshot_prod.json
 *   Generado por: scripts/audit/dump_stock_snapshot_fixture.cjs
 *   Shape REAL: warehouseBreakdown + quantities como JSON strings.
 *
 * Si en el futuro Python cambia el shape (ej. vuelve a dict, agrega campo
 * nuevo), re-correr el dump y validar que estos tests siguen verdes. Si
 * fallan, hay que portar el cambio al parse del CF (commit-pedido-core.js).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/** @type {any} */
const fixture = JSON.parse(readFileSync('tests/fixtures/stock_snapshot_prod.json', 'utf8'));

function makeMockDbFromProdFixture() {
  const state = {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => fixture.data.updatedAt_ms || Date.now() - 60_000 },
        source: fixture.data.source || 'gha-cron',
        // Shape REAL copiado de prod: JSON strings.
        warehouseBreakdown: fixture.data.warehouseBreakdown,
        quantities: fixture.data.quantities,
      },
    },
    pedidos: {},
    pedido_draft_locks: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
  const makeDoc = (col, id) => ({
    id,
    _path: `${col}/${id}`,
    async get() {
      const d = state[col]?.[id];
      return { exists: !!d, data: () => d || null };
    },
    async set(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
    },
    async update(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
    },
    async delete() {
      if (state[col]) delete state[col][id];
    },
  });
  const makeCol = (col, filters = []) => ({
    where(f, op, v) {
      return makeCol(col, [...filters, { f, op, v }]);
    },
    limit() {
      return this;
    },
    doc(id) {
      return makeDoc(col, id || 'auto_' + Math.random().toString(36).slice(2, 10));
    },
    async add(data) {
      const id = 'auto_' + Math.random().toString(36).slice(2, 10);
      state[col] ||= {};
      state[col][id] = data;
      return { id };
    },
    async get() {
      const colData = state[col] || {};
      let docs = Object.entries(colData).map(([id, data]) => ({
        id,
        data: () => data,
        exists: true,
      }));
      for (const f of filters) {
        docs = docs.filter((d) => {
          const v = d.data()[f.f];
          if (f.op === '==') return v === f.v;
          if (f.op === 'in') return Array.isArray(f.v) && f.v.includes(v);
          return true;
        });
      }
      return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
    },
  });
  return {
    fbDb: {
      collection: (c) => makeCol(c),
      doc(p) {
        const [c, id] = p.split('/');
        return makeDoc(c, id);
      },
      async runTransaction(fn) {
        const tx = {
          async get(ref) {
            return ref.get();
          },
          set(ref, data) {
            return ref.set(data);
          },
          update(ref, data) {
            return ref.update(data);
          },
          delete(ref) {
            return ref.delete();
          },
        };
        return fn(tx);
      },
    },
    _state: state,
  };
}

// Datos derivados del fixture real.
const wb = JSON.parse(fixture.data.warehouseBreakdown || '{}');
const skusConStock = Object.keys(wb)
  .filter((sku) => Number(wb[sku]?.['11'] || 0) > 0)
  .slice(0, 3);
const nowRef = new Date((fixture.data.updatedAt_ms || Date.now() - 60_000) + 60_000);

describe('v1449 — Fixture REAL de prod: paridad client ↔ CF blindada', () => {
  it('META: fixture tiene shape esperado (warehouseBreakdown=string JSON)', () => {
    expect(fixture.data._warehouseBreakdown_type).toBe('string');
    expect(fixture.data._quantities_type).toBe('string');
    expect(wb).toBeTruthy();
    expect(Object.keys(wb).length).toBeGreaterThan(10);
    expect(skusConStock.length).toBeGreaterThan(0);
  });

  it('REPRO blindado: pedido 1u sobre SKU real con stock → qtyConfirmed=1, qtyBO=0', async () => {
    const sku = skusConStock[0];
    const stockDisp = Number(wb[sku]['11']);
    expect(stockDisp).toBeGreaterThan(0);

    const { fbDb } = makeMockDbFromProdFixture();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-fixture-prod-1u',
        cardCode: 'C-TESTFIXTURE',
        clientName: 'TEST FIXTURE',
        origen: 'manual',
        lines: [{ sku, cantidad: 1, precio: 100 }],
        clientVersion: 'v1449',
        ownerUid: 'U-fixture',
        ownerEmail: 'fixture@test.com',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.lines).toBeTruthy();
    const l = r.lines.find((x) => x.sku === sku);
    expect(l).toBeTruthy();
    expect(l.qtyConfirmed).toBe(1);
    expect(l.qtyBO).toBe(0);
  });

  it('REPRO blindado: pedido multi-SKU sobre SKUs reales con stock → todos confirmed', async () => {
    expect(skusConStock.length).toBeGreaterThanOrEqual(2);
    const lines = skusConStock.slice(0, Math.min(3, skusConStock.length)).map((sku) => ({
      sku,
      cantidad: 1,
      precio: 100,
    }));
    const { fbDb } = makeMockDbFromProdFixture();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-fixture-prod-multi',
        cardCode: 'C-TESTFIXTURE2',
        clientName: 'TEST FIXTURE MULTI',
        origen: 'manual',
        lines,
        clientVersion: 'v1449',
        ownerUid: 'U-fixture',
        ownerEmail: 'fixture@test.com',
      }
    );
    expect(r.ok).toBe(true);
    for (const line of lines) {
      const l = r.lines.find((x) => x.sku === line.sku);
      expect(l, `línea ${line.sku} debe existir`).toBeTruthy();
      expect(l.qtyConfirmed, `${line.sku} debe confirmar`).toBe(1);
      expect(l.qtyBO, `${line.sku} NO debe ir a BO`).toBe(0);
    }
  });

  it('EXCEDENTE: pedido pide +1 sobre stock disponible → divide confirmed + BO', async () => {
    // Busca un SKU con stock exacto conocido para armar el excedente.
    const sku = skusConStock[0];
    const stockDisp = Number(wb[sku]['11']);
    const { fbDb } = makeMockDbFromProdFixture();
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-fixture-prod-excedente',
        cardCode: 'C-TESTFIXTURE3',
        clientName: 'TEST EXCEDENTE',
        origen: 'manual',
        lines: [{ sku, cantidad: stockDisp + 1, precio: 100 }],
        clientVersion: 'v1449',
        autoAcceptStockChange: true,
        ownerUid: 'U-fixture',
        ownerEmail: 'fixture@test.com',
      }
    );
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.sku === sku);
    expect(l.qtyConfirmed).toBe(stockDisp);
    expect(l.qtyBO).toBe(1);
  });
});
