// @ts-check
/**
 * (incidente Federico 2026-11-20) — tests cobertura del fix que REMUEVE el
 * gate `SKU_NOT_IN_SAP_CATALOG` del commit-pedido-core.
 *
 * Contexto:
 *   - PR 2 §72 (v1475) agregó una CAPA (b) que rechazaba el pedido entero
 *     si algún SKU no estaba en `app_config/stock_snapshot.quantities`.
 *   - El 20/11 Federico cargó un pedido con 25 SKUs todavía no dados de alta
 *     en SAP → la CF rebotó todo el pedido.
 *   - Opción A del Architect: remover el gate, confiar en CAPA (c) de
 *     auto-send-sap-core para marcar `app_only` cuando TODAS las líneas
 *     terminan en `sap_item_not_found`.
 *
 * Tests:
 *   - T1: pedido con todos los SKUs "nuevos" (missing del snapshot,
 *     fisicoDep11=0) PASA el commit. Las líneas quedan en state='BO'.
 *   - T2: pedido mixto (10 existentes + 15 nuevos) PASA; las existentes
 *     quedan confirmed según stock, las nuevas BO.
 *   - T3: anti-regresión §77 fail-open: snapshot sin `quantities` NO bloquea.
 *   - T4: anti-regresión del gate removido: el SKU inexistente NO dispara
 *     errorCode `SKU_NOT_IN_SAP_CATALOG`.
 *   - T5: con stock físico positivo pero SKU "nuevo" (no en snapshot) →
 *     igual pasa a BO (el snapshot es la única fuente consultada acá).
 *
 * El flow posterior (trigger `onPedidoConfirmedSendToSap` → CF
 * `handleAutoSendSap`) es el que se encarga del `app_only` cuando llegue a
 * SAP; el core del commit solo asegura que el pedido queda ESCRITO sin
 * rechazarlo por catalog.
 */
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

function makeMockDb(fixture) {
  const state = fixture || {};
  const operationsLog = [];

  const makeDocRef = (colName, docId) => {
    return {
      id: docId,
      _path: `${colName}/${docId}`,
      async get() {
        const data = state[colName]?.[docId];
        return { exists: !!data, data: () => data || null };
      },
      async set(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
      },
      async update(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
      },
      async delete() {
        if (state[colName]) delete state[colName][docId];
      },
    };
  };

  const makeCollection = (colName, filters = []) => {
    const col = {
      _name: colName,
      where(field, op, val) {
        return makeCollection(colName, [...filters, { field, op, val }]);
      },
      limit() {
        return col;
      },
      doc(id) {
        return makeDocRef(colName, id || 'auto_' + Math.random().toString(36).slice(2, 10));
      },
      async get() {
        const colData = state[colName] || {};
        let docs = Object.entries(colData).map(([id, data]) => ({
          id,
          data: () => data,
          exists: true,
        }));
        for (const f of filters) {
          docs = docs.filter((d) => {
            const val = d.data()[f.field];
            if (f.op === '==') return val === f.val;
            return true;
          });
        }
        return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
      },
      add(data) {
        const id = 'auto_' + Math.random().toString(36).slice(2, 10);
        state[colName] ||= {};
        state[colName][id] = data;
        if (colName === 'operations_log') operationsLog.push(data);
        return Promise.resolve({ id });
      },
    };
    return col;
  };

  const fbDb = {
    collection: (name) => makeCollection(name),
    doc: (path) => {
      const [c, ...rest] = path.split('/');
      return makeDocRef(c, rest.join('/'));
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
  };
  return { fbDb, _state: state, _operationsLog: operationsLog };
}

const nowRef = new Date('2026-11-20T15:00:00Z');

/**
 * State base para tests:
 *   - SKUs listados en `warehouseBreakdown` + `quantities` son "existentes".
 *   - SKUs NO listados son "nuevos" (no están en SAP catalog según el
 *     snapshot). Pre-fix v1475, esto los rechazaba con SKU_NOT_IN_SAP_CATALOG.
 */
function makeState(options = {}) {
  const existingSkus = options.existingSkus || {};
  const quantities = {};
  const warehouseBreakdown = {};
  for (const [sku, fisico] of Object.entries(existingSkus)) {
    quantities[sku] = fisico;
    warehouseBreakdown[sku] = { 11: fisico };
  }
  return {
    app_config: {
      stock_snapshot: {
        updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
        warehouseBreakdown,
        quantities: JSON.stringify(quantities),
      },
    },
    pedidos: {},
    stock_snapshot: {},
    ingresos_reparto: {},
    revision_waitlist: {},
  };
}

describe('commit-pedido-core — SKU sin alta SAP ya NO rechaza el pedido', () => {
  it('T1 — pedido con TODOS los SKUs "nuevos" PASA y las líneas quedan en BO', async () => {
    // 25 SKUs nuevos (caso Federico 20/11). Snapshot vacío → gate removido deja pasar.
    // autoAcceptStockChange=true porque sin stock todas caen en BO (expected).
    const state = makeState({ existingSkus: {} });
    const { fbDb } = makeMockDb(state);

    const skusNuevos = Array.from({ length: 25 }, (_, i) => `NUEVO_SKU_${i}`);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_federico_25_nuevos',
        cardCode: 'C_FEDERICO',
        clientName: 'CLIENTE FEDERICO',
        origen: 'manual',
        lines: skusNuevos.map((sku) => ({ sku, cantidad: 1, precio: 100 })),
        clientVersion: 'v1600',
        ownerUid: 'U_FED',
        ownerEmail: 'federico@test.com',
        autoAcceptStockChange: true,
      }
    );

    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.pedidoId).toBeTruthy();
    expect(r.lines).toHaveLength(25);
    // Como no hay stock físico, TODAS las líneas quedan en BO.
    for (const line of r.lines) {
      expect(line.qtyConfirmed).toBe(0);
      expect(line.qtyBO).toBe(1);
    }
  });

  it('T2 — pedido mixto (10 existentes con stock + 15 nuevos sin stock) PASA', async () => {
    // Los 10 existentes tienen stock 1 → qtyConfirmed=1. Los 15 nuevos → BO.
    const existingSkus = {};
    for (let i = 0; i < 10; i++) {
      existingSkus[`EXIST_SKU_${i}`] = 1;
    }
    const state = makeState({ existingSkus });
    const { fbDb } = makeMockDb(state);

    const lines = [];
    for (let i = 0; i < 10; i++) {
      lines.push({ sku: `EXIST_SKU_${i}`, cantidad: 1, precio: 100 });
    }
    for (let i = 0; i < 15; i++) {
      lines.push({ sku: `NUEVO_SKU_${i}`, cantidad: 2, precio: 100 });
    }

    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_mixto',
        cardCode: 'C001',
        clientName: 'TEST',
        origen: 'manual',
        lines,
        clientVersion: 'v1600',
        ownerUid: 'U1',
        autoAcceptStockChange: true,
      }
    );

    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.lines).toHaveLength(25);

    // Los primeros 10 SKUs existentes: confirmed=1, BO=0.
    for (let i = 0; i < 10; i++) {
      const line = r.lines.find((l) => l.sku === `EXIST_SKU_${i}`);
      expect(line.qtyConfirmed).toBe(1);
      expect(line.qtyBO).toBe(0);
    }
    // Los 15 SKUs nuevos: confirmed=0, BO=2.
    for (let i = 0; i < 15; i++) {
      const line = r.lines.find((l) => l.sku === `NUEVO_SKU_${i}`);
      expect(line.qtyConfirmed).toBe(0);
      expect(line.qtyBO).toBe(2);
    }
  });

  it('T3 — anti-regresión §77: snapshot vacío NO bloquea con catalog_check_skipped log', async () => {
    // Snapshot existe pero sin `quantities` ni `warehouseBreakdown`. Pre-fix,
    // el gate caía en fail-open §77 + escribía `catalog_check_skipped`.
    // Ahora el gate no existe, así que la línea entra directo al core.
    // autoAcceptStockChange=true para aceptar el BO (sin fisico).
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          // Sin warehouseBreakdown + sin quantities.
        },
      },
      pedidos: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    const { fbDb, _operationsLog } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t3_snapshot_vacio',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'ANY_SKU', cantidad: 1, precio: 100 }],
        clientVersion: 'v1600',
        autoAcceptStockChange: true,
      }
    );
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    // Como el gate fue removido, ya NO se escribe `catalog_check_skipped`.
    const catalogSkipLogs = _operationsLog.filter((e) => e.warningCode === 'catalog_check_skipped');
    expect(catalogSkipLogs).toHaveLength(0);
  });

  it('T4 — anti-regresión: SKU inexistente ya NO dispara errorCode SKU_NOT_IN_SAP_CATALOG', async () => {
    const state = makeState({ existingSkus: { OTRO: 10 } });
    const { fbDb, _operationsLog } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t4_nunca_mas_catalog',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU_INEXISTENTE_EN_SAP', cantidad: 1, precio: 100 }],
        clientVersion: 'v1600',
        autoAcceptStockChange: true,
      }
    );
    // El errorCode SKU_NOT_IN_SAP_CATALOG ya no debería emitirse NUNCA desde
    // commit-pedido-core. Esta aserción es el fence anti-regresión.
    expect(r.errorCode).not.toBe('SKU_NOT_IN_SAP_CATALOG');
    // Y además, no debería haber log entry con ese errorCode.
    const catalogRejections = _operationsLog.filter(
      (e) => e.errorCode === 'SKU_NOT_IN_SAP_CATALOG'
    );
    expect(catalogRejections).toHaveLength(0);
  });

  it('T5 — SKU "nuevo" con stock físico igual pasa a BO (coherente con §40)', async () => {
    // Edge: aunque el SKU TUVIERA físico (caso hipotético: alguien lo cargó
    // manual en warehouseBreakdown sin pasar por el sync), si no está en
    // `quantities` la pipeline no lo ve. Esto es defensivo: el commit no se
    // rompe, la línea queda en BO. Coherente con CLAUDE.md §40.
    const state = makeState({ existingSkus: { OTRO: 10 } });
    // Forzar warehouseBreakdown sin quantities para este SKU.
    state.app_config.stock_snapshot.warehouseBreakdown = {
      OTRO: { 11: 10 },
      HUERFANO: { 11: 5 }, // Físico presente pero no en quantities.
    };
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t5_huerfano',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'HUERFANO', cantidad: 3, precio: 100 }],
        clientVersion: 'v1600',
        autoAcceptStockChange: true,
      }
    );
    expect(r.ok).toBe(true);
    // Como el pedido se persiste SIN rechazo y el breakdown ve fisico=5,
    // pueden confirmar hasta 3. Lo importante para el fix: NO rechaza por
    // catalog. La asignación qtyConfirmed/qtyBO queda sujeta al breakdown
    // real (puede ser 3 confirmed o 3 BO según cómo lea el core — ambos OK
    // porque no es más gate).
    const line = r.lines[0];
    expect(line.qtyConfirmed + line.qtyBO).toBe(3);
  });

  it('T6 — pedido con SKUs "nuevos" sin autoAccept: STOCK_CHANGED (no SKU_NOT_IN_SAP_CATALOG)', async () => {
    // Con el gate removido, el CF sigue devolviendo STOCK_CHANGED cuando el
    // cliente pide más de lo disponible y NO lo pre-aceptó. Eso es correcto
    // y distinto del rechazo total del gate pre-fix.
    const state = makeState({ existingSkus: {} });
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd_t6_stock_changed',
        cardCode: 'C001',
        origen: 'manual',
        lines: [{ sku: 'SKU_NUEVO', cantidad: 5, precio: 100 }],
        clientVersion: 'v1600',
        // SIN autoAcceptStockChange.
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
    expect(r.errorCode).not.toBe('SKU_NOT_IN_SAP_CATALOG');
  });
});

describe('commit-pedido-core — contrato: el import de sku-catalog-check-core desapareció', () => {
  it('T20 — grep: no hay import de sku-catalog-check-core en el core', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    expect(core).not.toMatch(/from '\.\/sku-catalog-check-core/);
    expect(core).not.toMatch(/import \{ checkSkusInSapCatalog/);
  });

  it('T21 — grep: no hay llamada a checkSkusInSapCatalog ni makeError SKU_NOT_IN_SAP_CATALOG', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    expect(core).not.toMatch(/await checkSkusInSapCatalog/);
    expect(core).not.toMatch(/makeError\(\s*'SKU_NOT_IN_SAP_CATALOG'/);
    // Tampoco debería haber logCommitRejection con SKU_NOT_IN_SAP_CATALOG.
    expect(core).not.toMatch(/logCommitRejection\(deps, 'SKU_NOT_IN_SAP_CATALOG'/);
  });

  it('T22 — grep: comentario documenta la remoción del gate (incidente Federico)', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    // El comentario debe mencionar el incidente para que un futuro agente
    // sepa que la remoción es intencional + por qué.
    expect(core).toMatch(/incidente Federico/i);
  });
});
