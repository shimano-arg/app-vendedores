// @ts-check
/**
 * INCIDENTE 2026-10-23 17:52 ART (reportado 25/10): desde que el workflow
 * Python volvió a escribir el snapshot con shape correcto (JSON strings,
 * patrón v368+/v377+), todo pedido confirmado por commitPedidoCF quedó en
 * stage=confirmed + transferidoSAP.via='app_only' +
 * reason='all_lines_bo_server_detected' aunque los SKUs tenían stock.
 *
 * ROOT CAUSE
 * functions/core/commit-pedido-core.js:250:
 *   const warehouseBreakdown =
 *     stockConfig.warehouseBreakdown && typeof stockConfig.warehouseBreakdown === 'object'
 *       ? stockConfig.warehouseBreakdown : {};
 *
 * Cuando Python escribe JSON string (correcto), typeof === 'string', NO
 * 'object' → `warehouseBreakdown = {}` → fisicoDep11 = 0 para todo SKU →
 * qtyBO = cantidad_pedida → TODO va a BO.
 *
 * Paridad con client (index.html:31987-31989):
 *   if (typeof d.warehouseBreakdown === 'string') {
 *     STOCK_WAREHOUSE_BREAKDOWN = JSON.parse(d.warehouseBreakdown) || {};
 *   }
 *
 * ESTE TEST reproduce el bug: snapshot con warehouseBreakdown=JSON_STRING,
 * SKU con stock, pedido pide 1 unidad → DEBE confirmar con stock, no BO.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeMockDb(fixture) {
  const state = fixture || {};
  const makeDoc = (col, id) => ({
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
      doc(path) {
        const [c, id] = path.split('/');
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

const nowRef = new Date('2026-10-25T19:00:00Z');

function makeSnapshotStringPatron(breakdown) {
  // Patrón Python: warehouseBreakdown y quantities como JSON STRING.
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        source: 'gha-cron',
        warehouseBreakdown: JSON.stringify(breakdown), // STRING, NO dict
        quantities: JSON.stringify(
          Object.fromEntries(Object.entries(breakdown).map(([sku, whs]) => [sku, whs['11'] || 0]))
        ),
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('INCIDENTE 2026-10-23 17:52: commitPedidoCore con snapshot JSON string', () => {
  it('REPRO BUG: snapshot con warehouseBreakdown=JSON_STRING + SKU con stock → antes del fix TODO va a BO', async () => {
    // Fixture replica del snapshot que escribe Python post-PR #1199.
    const state = makeSnapshotStringPatron({
      '21100100100E': { 11: 26 },
      '21100100150W': { 11: 22 },
    });
    const { fbDb, _state } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-repro',
        cardCode: 'C-BROBRO',
        clientName: 'BROBRO SA',
        origen: 'manual',
        lines: [
          { sku: '21100100100E', cantidad: 1, precio: 100 },
          { sku: '21100100150W', cantidad: 1, precio: 100 },
        ],
        clientVersion: 'v1447',
        ownerUid: 'U1',
        ownerEmail: 'u1@test.com',
      }
    );
    expect(r.ok).toBe(true);
    // POST FIX: cada línea debe quedar como confirmed con qty=1, qtyBO=0.
    // ANTES DEL FIX esto falla porque el read del snapshot no parsea string.
    expect(r.lines).toBeTruthy();
    const l1 = r.lines.find((l) => l.sku === '21100100100E');
    const l2 = r.lines.find((l) => l.sku === '21100100150W');
    expect(l1).toBeTruthy();
    expect(l2).toBeTruthy();
    expect(l1.qtyConfirmed).toBe(1); // ← FALLA pre-fix (qtyConfirmed=0)
    expect(l1.qtyBO).toBe(0); // ← FALLA pre-fix (qtyBO=1)
    expect(l2.qtyConfirmed).toBe(1);
    expect(l2.qtyBO).toBe(0);
    // Verificar que el pedido escrito en Firestore tiene las líneas confirmed.
    const pedidoDocs = Object.values(_state.pedidos || {});
    expect(pedidoDocs.length).toBe(1);
    const ped = pedidoDocs[0];
    const linesConfirmed = (ped.lines || []).filter((l) => l.state === 'confirmed');
    const linesBO = (ped.lines || []).filter((l) => l.state === 'BO');
    expect(linesConfirmed.length).toBe(2); // ← FALLA pre-fix (0 confirmed, 2 BO)
    expect(linesBO.length).toBe(0);
  });

  it('PARIDAD: client-side (index.html) parsea JSON string, server-side DEBE hacer lo mismo', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    // Grep del parse client-side.
    expect(html).toMatch(/typeof\s+d\.warehouseBreakdown\s*===\s*['"]string['"]/);
    expect(html).toMatch(/JSON\.parse\(d\.warehouseBreakdown\)/);
    // El server-side debe hacer la misma transformación.
    const coreJs = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    // Post-fix debe tener JSON.parse del warehouseBreakdown.
    expect(coreJs).toMatch(/typeof\s+rawWhsBd\s*===\s*['"]string['"]/);
    expect(coreJs).toMatch(/JSON\.parse\s*\(\s*rawWhsBd\s*\)/);
  });

  it('EDGE: warehouseBreakdown=dict (snapshot legacy CF v1444) → sigue funcionando', async () => {
    // Si por alguna razón el snapshot vuelve a tener dict (ej. CF que no se
    // actualizó), el fix debe seguir funcionando: `object` → usar directo.
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          warehouseBreakdown: { 'SKU-A': { 11: 5 } }, // dict
        },
      },
      pedidos: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-dict',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 3, precio: 100 }],
        clientVersion: 'v1447',
      }
    );
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.sku === 'SKU-A');
    expect(l.qtyConfirmed).toBe(3);
    expect(l.qtyBO).toBe(0);
  });

  it('EDGE: warehouseBreakdown=JSON string malformado → fallback a {} + log, no crash', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          warehouseBreakdown: '{invalid json', // malformado
        },
      },
      pedidos: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-bad',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 2, precio: 100 }],
        clientVersion: 'v1447',
        autoAcceptStockChange: true,
      }
    );
    if (!r.ok) console.log('T-bad result:', JSON.stringify(r, null, 2));
    // No crash. Snapshot vacío → fisico=0 → qtyBO=2 (comportamiento defensivo).
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.sku === 'SKU-A');
    expect(l.qtyBO).toBe(2);
  });

  it('EDGE: snapshot sin warehouseBreakdown field → fallback a {} limpio', async () => {
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          // Sin warehouseBreakdown
        },
      },
      pedidos: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-empty',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU-A', cantidad: 2, precio: 100 }],
        clientVersion: 'v1447',
        autoAcceptStockChange: true,
      }
    );
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.sku === 'SKU-A');
    expect(l.qtyBO).toBe(2);
  });
});
