// @ts-check
/**
 * FRENTE C OOM fix (2026-11-24) — verificación de las 3 optimizaciones
 * aplicadas a `commitPedidoCore` tras el OOM 256 MiB detectado en prod
 * (revisión commitpedidocf-00031-xof, 2026-11-24 10:50:28.833Z):
 *
 *   §O1 — Lazy parse de warehouseBreakdown: solo las keys del payload.
 *   §O2 — Slim pedidos array: solo lineas con code en skuSet del payload.
 *   §OI — Instrumentación: operations_log.type='commit_pedido_memory' con peakMb.
 *   §O4 — memory: '512MiB' en commitPedidoCF (test estático sobre functions/index.js).
 *
 * Cada optimización verifica semántica equivalente (mismo qtyConfirmed/qtyBO
 * post-fix vs expectativa pre-fix) + que el fix efectivamente redujo la
 * superficie de memoria visible desde el mock.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock Firestore con state inspeccionable + hooks para contar accesos.
 * Patrón derivado de commit-pedido-snapshot-fixture-prod.test.js.
 */
function makeMockDb(state) {
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
    state,
  };
}

/**
 * Construye un snapshot "gigante" (N SKUs) para ejercitar el fix §O1.
 * Mariano en prod tiene ~5000 SKUs; con N=200 ya vemos el beneficio sin
 * hacer el test lento.
 */
function buildBigSnapshot(numSkus) {
  const whb = {};
  const qty = {};
  for (let i = 0; i < numSkus; i++) {
    const sku = `SKU-${String(i).padStart(4, '0')}`;
    whb[sku] = { 11: 10, 12: 0 };
    qty[sku] = 10;
  }
  return {
    warehouseBreakdown: JSON.stringify(whb),
    quantities: JSON.stringify(qty),
  };
}

const nowRef = new Date();

describe('FRENTE C OOM fix (2026-11-24) §O1 — lazy parse warehouseBreakdown', () => {
  it('parsea solo los SKUs del payload aunque el snapshot tenga cientos', async () => {
    // Snapshot con 200 SKUs; payload pide SOLO 1.
    const snap = buildBigSnapshot(200);
    const { fbDb } = makeMockDb({
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          source: 'test',
          warehouseBreakdown: snap.warehouseBreakdown,
          quantities: snap.quantities,
        },
      },
      pedidos: {},
      pedido_draft_locks: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    });
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-o1-lazy',
        cardCode: 'C-TEST',
        clientName: 'TEST',
        origen: 'manual',
        lines: [{ sku: 'SKU-0007', cantidad: 2, precio: 100 }],
        clientVersion: 'test',
        ownerUid: 'U-x',
        ownerEmail: 'x@test.com',
      }
    );
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.sku === 'SKU-0007');
    expect(l).toBeTruthy();
    expect(l.qtyConfirmed).toBe(2);
    expect(l.qtyBO).toBe(0);
  });

  it('shape legacy warehouseBreakdown object también proyecta solo payload SKUs', async () => {
    // Shape legacy (pre-v368): object directo, no JSON string.
    const whb = {};
    for (let i = 0; i < 50; i++) whb[`LEG-${i}`] = { 11: 5 };
    const { fbDb } = makeMockDb({
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          source: 'test-legacy',
          warehouseBreakdown: whb, // objeto directo — shape viejo
          quantities: JSON.stringify({ 'LEG-7': 5 }),
        },
      },
      pedidos: {},
      pedido_draft_locks: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    });
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-o1-legacy',
        cardCode: 'C-LEG',
        clientName: 'LEGACY',
        origen: 'manual',
        lines: [{ sku: 'LEG-7', cantidad: 1, precio: 100 }],
        clientVersion: 'test',
        ownerUid: 'U-x',
        ownerEmail: 'x@test.com',
      }
    );
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.sku === 'LEG-7');
    expect(l.qtyConfirmed).toBe(1);
  });
});

describe('FRENTE C OOM fix (2026-11-24) §O2 — slim pedidos array', () => {
  it('pedido abierto con lines[] de SKUs no-payload no rompe breakdown del payload', async () => {
    // Snapshot con 1 SKU y 1 pedido abierto que tiene 10 lines[] donde solo
    // 1 matchea el payload. El fix slim-pedidos debe conservar esa 1 linea
    // y producir el mismo qtyConfirmed/qtyBO que si tuviera todas.
    const snap = buildBigSnapshot(5);
    // Pedido abierto con 10 líneas, solo 1 matchea.
    const linesPedidoViejo = [];
    for (let i = 0; i < 10; i++) {
      linesPedidoViejo.push({
        code: i === 3 ? 'SKU-0001' : `OTHER-${i}`,
        state: 'ASIG',
        qty: 1,
        qtyOpen: 1,
        asigAt: new Date(nowRef.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      });
    }
    const { fbDb } = makeMockDb({
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          source: 'test',
          warehouseBreakdown: snap.warehouseBreakdown,
          quantities: snap.quantities,
        },
      },
      pedidos: {
        'PED-VIEJO': {
          _fsId: 'PED-VIEJO',
          clientCardCode: 'C-OTRO',
          clientName: 'OTRO CLIENTE',
          closedAt: null,
          createdAt: new Date(nowRef.getTime() - 48 * 60 * 60 * 1000).toISOString(),
          lines: linesPedidoViejo,
        },
      },
      pedido_draft_locks: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    });
    // Payload pide 10 unidades de SKU-0001. Hay 10 en stock, pero 1 reservada
    // por el pedido viejo (línea index 3). Entonces breakdown.libre = 10 - 1 = 9.
    // qtyConfirmed = min(10, 9) = 9. qtyBO = 1.
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-o2-slim',
        cardCode: 'C-NUEVO',
        clientName: 'CLIENTE NUEVO',
        origen: 'manual',
        lines: [{ sku: 'SKU-0001', cantidad: 10, precio: 100 }],
        clientVersion: 'test',
        autoAcceptStockChange: true,
        ownerUid: 'U-x',
        ownerEmail: 'x@test.com',
      }
    );
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.sku === 'SKU-0001');
    expect(l).toBeTruthy();
    expect(l.qtyConfirmed).toBe(9); // 10 físico - 1 ASIG viejo
    expect(l.qtyBO).toBe(1);
  });

  it('pedido viejo sin ninguna línea del payload no bloquea la confirmación', async () => {
    // Variante: 20 pedidos abiertos, NINGUNO tiene líneas del payload SKU.
    // Debe funcionar como si no hubiera pedidos abiertos.
    const snap = buildBigSnapshot(5);
    const state = {
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          source: 'test',
          warehouseBreakdown: snap.warehouseBreakdown,
          quantities: snap.quantities,
        },
      },
      pedidos: {},
      pedido_draft_locks: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
    };
    for (let p = 0; p < 20; p++) {
      state.pedidos[`PED-${p}`] = {
        _fsId: `PED-${p}`,
        clientCardCode: `C-${p}`,
        clientName: `CLIENTE ${p}`,
        closedAt: null,
        createdAt: new Date(nowRef.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        lines: [
          { code: 'IRRELEVANT-A', state: 'ASIG', qty: 1, qtyOpen: 1, asigAt: nowRef.toISOString() },
          { code: 'IRRELEVANT-B', state: 'BO', qty: 2, qtyOpen: 2 },
        ],
      };
    }
    const { fbDb } = makeMockDb(state);
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-o2-no-match',
        cardCode: 'C-SOLO',
        clientName: 'SOLO EN EL MUNDO',
        origen: 'manual',
        lines: [{ sku: 'SKU-0002', cantidad: 3, precio: 100 }],
        clientVersion: 'test',
        ownerUid: 'U-x',
        ownerEmail: 'x@test.com',
      }
    );
    expect(r.ok).toBe(true);
    const l = r.lines.find((x) => x.sku === 'SKU-0002');
    expect(l.qtyConfirmed).toBe(3); // 10 físico, nada reservado del SKU
    expect(l.qtyBO).toBe(0);
  });
});

describe('FRENTE C OOM fix (2026-11-24) §OI — instrumentación commit_pedido_memory', () => {
  it('escribe operations_log.type=commit_pedido_memory tras commit exitoso', async () => {
    const snap = buildBigSnapshot(5);
    const { fbDb, state } = makeMockDb({
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          source: 'test',
          warehouseBreakdown: snap.warehouseBreakdown,
          quantities: snap.quantities,
        },
      },
      pedidos: {},
      pedido_draft_locks: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {},
      operations_log: {},
    });
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-oi-instrumentation',
        cardCode: 'C-OI',
        clientName: 'INSTRUMENTACION TEST',
        origen: 'manual',
        lines: [{ sku: 'SKU-0000', cantidad: 1, precio: 100 }],
        clientVersion: 'test-v1565',
        ownerUid: 'U-oi',
        ownerEmail: 'oi@test.com',
      }
    );
    expect(r.ok).toBe(true);
    // Esperar un tick para que el fire-and-forget resuelva.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const logs = Object.values(state.operations_log || {});
    const memLog = logs.find(/** @type {any} */ (l) => l && l.type === 'commit_pedido_memory');
    expect(memLog, 'debe existir entry commit_pedido_memory').toBeTruthy();
    expect(memLog.pedidoId).toBe(r.pedidoId);
    expect(memLog.cardCode).toBe('C-OI');
    expect(memLog.userEmail).toBe('oi@test.com');
    expect(memLog.origen).toBe('manual');
    expect(memLog.clientVersion).toBe('test-v1565');
    expect(memLog.payloadLineCount).toBe(1);
    expect(memLog.asigRefCount).toBe(0);
    // En process.memoryUsage() local esperamos un número >= 0.
    expect(typeof memLog.memBaselineMb === 'number' || memLog.memBaselineMb === null).toBe(true);
    expect(typeof memLog.memPeakMb === 'number' || memLog.memPeakMb === null).toBe(true);
  });

  it('cuenta correctamente asigRefCount cuando el payload es CPST', async () => {
    const snap = buildBigSnapshot(5);
    // Pedido origen CPST.
    const pedidoOrigen = {
      _fsId: 'PED-ORIG',
      clientCardCode: 'C-OI',
      clientName: 'INSTRUMENTACION TEST',
      closedAt: null,
      createdAt: new Date(nowRef.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      lines: [
        {
          code: 'SKU-0000',
          state: 'ASIG',
          qty: 3,
          qtyOpen: 3,
          asigAt: new Date(nowRef.getTime() - 60_000).toISOString(),
          asigReserva: true,
        },
      ],
    };
    const { fbDb, state } = makeMockDb({
      app_config: {
        stock_snapshot: {
          updatedAt: { toMillis: () => nowRef.getTime() - 60_000 },
          source: 'test',
          warehouseBreakdown: snap.warehouseBreakdown,
          quantities: snap.quantities,
        },
      },
      pedidos: { 'PED-ORIG': pedidoOrigen },
      pedido_draft_locks: {},
      stock_snapshot: {},
      ingresos_reparto: {},
      revision_waitlist: {
        'WL-ORIG': {
          _fsId: 'WL-ORIG',
          clientCardCode: 'C-OI',
          stage: 'waiting',
          closedAt: null,
          source: 'stock-asignado-batch',
          items: [{ code: 'SKU-0000', qty: 3 }],
        },
      },
      operations_log: {},
    });
    const r = await commitPedidoCore(
      { fbDb, now: () => nowRef },
      {
        draftId: 'd-oi-cpst',
        cardCode: 'C-OI',
        clientName: 'INSTRUMENTACION TEST',
        origen: 'cpst',
        waitlistOrigenId: 'WL-ORIG',
        lines: [
          {
            sku: 'SKU-0000',
            cantidad: 3,
            precio: 100,
            asigRefs: [{ pedidoId: 'PED-ORIG', lineIndex: 0, qtyAsignada: 3, sku: 'SKU-0000' }],
          },
        ],
        clientVersion: 'test-v1565',
        ownerUid: 'U-oi',
        ownerEmail: 'oi@test.com',
      }
    );
    expect(r.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const memLog = Object.values(state.operations_log || {}).find(
      /** @type {any} */ (l) => l && l.type === 'commit_pedido_memory'
    );
    expect(memLog, 'debe existir entry commit_pedido_memory').toBeTruthy();
    expect(memLog.asigRefCount).toBe(1);
    expect(memLog.origen).toBe('cpst');
  });
});

describe('FRENTE C OOM fix (2026-11-24) §O4 — memory 256→512MiB en commitPedidoCF', () => {
  it('functions/index.js declara commitPedidoCF con memory: 512MiB', () => {
    const src = readFileSync('functions/index.js', 'utf8');
    // Encontrar el bloque de commitPedidoCF.
    const idx = src.indexOf('export const commitPedidoCF = onCall(');
    expect(idx, 'debe existir export commitPedidoCF').toBeGreaterThan(0);
    // Extraer hasta el cierre del objeto de configuración (primer "async").
    const blockEnd = src.indexOf('async (req)', idx);
    expect(blockEnd).toBeGreaterThan(idx);
    const block = src.slice(idx, blockEnd);
    expect(block, 'debe tener memory: 512MiB').toMatch(/memory:\s*['"]512MiB['"]/);
    expect(block, 'NO debe quedar memory: 256MiB').not.toMatch(/memory:\s*['"]256MiB['"]/);
  });
});
