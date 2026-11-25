// @ts-check
/**
 * STACK S-4 T5 (D12 fix 2026-11-25) — tests del flag + recompute server-side.
 *
 * Flag `app_config/feature_flags.d12_discount_recompute_enabled`:
 *   - OFF (default hoy): comportamiento histórico 100%. `discountPct=0` +
 *     `discountSnapshot=null`. Este PR puede mergearse sin cambio de
 *     comportamiento en prod (safe no-op).
 *   - ON (cuando Santi destrabe D1): server resuelve cliTipo desde
 *     `client_master.cliTipo` via `.where('sapCardCode', '==', cardCode)` y
 *     recalcula con pure fn `calcClientDiscount`. Server es la autoridad (§89).
 *
 * Tests:
 *   T1 Flag OFF: persiste discountPct=0 (compat histórica).
 *   T2 Flag ON + cliTipo='P' + CONTADO + subtotal $5M: pctTotal = 6+3+5 = 14%.
 *      (Nota: la mission description decía "6+3+3=12" pero con CONTADO tipo P
 *      el anticipo es 5, no 3 — ANTIC_PCT.P=5. Validado contra pure.)
 *   T3 Flag ON + cliTipo='' + subtotal $25M + CTA CTE: 0+6+0 = 6% (volumen only).
 *   T4 Flag ON + client_master no existe: cliTipo='', solo volumen.
 *   T5 Flag ON + §58 strict mock: client_master read ocurre ANTES del tx.set.
 *   T6 Flag ON + mismatch cliente vs server: usa server pct, logea divergencia.
 */
import { describe, expect, it, vi } from 'vitest';
import { commitPedidoCore } from '../../functions/core/commit-pedido-core.js';

/**
 * Mock Firestore con control de feature_flags + client_master queries.
 * STRICT-ish: trackea orden de reads vs writes para T5.
 */
function makeMockDb(opts) {
  const {
    flagEnabled = false,
    clientMasterData = null, // {cliTipo, sapCardCode, ...} | null
    clientMasterDocId = 'prov__loc__name',
    stockFisico = 500,
    sku = 'SKU-D12',
    now = new Date('2026-11-25T12:00:00Z'),
  } = opts || {};

  const state = {
    app_config: {
      feature_flags: {
        d12_discount_recompute_enabled: flagEnabled,
      },
      stock_snapshot: {
        updatedAt: { toMillis: () => now.getTime() - 60000 },
        warehouseBreakdown: { [sku]: { 11: stockFisico } },
        quantities: { [sku]: stockFisico },
      },
    },
    client_master: clientMasterData
      ? { [clientMasterDocId]: { sapCardCode: 'C001', ...clientMasterData } }
      : {},
    pedidos: {},
    stock_snapshot: {
      [sku]: {
        sku,
        asignadas: { total: 0, byClient: {} },
        backorderApp: { total: 0, byClient: {} },
      },
    },
    ingresos_reparto: {},
    revision_waitlist: {},
    operations_log: {},
    pedido_draft_locks: {},
  };

  const writtenOps = [];
  const readOps = [];

  const makeDocRef = (colName, docId) => {
    const key = `${colName}/${docId}`;
    return {
      id: docId,
      _path: key,
      async get() {
        readOps.push({ path: key, inTx: false });
        const data = state[colName]?.[docId];
        return { exists: !!data, data: () => data || null };
      },
      async set(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        writtenOps.push({ op: 'set', path: key, data });
      },
      async update(data) {
        state[colName] ||= {};
        state[colName][docId] = { ...(state[colName][docId] || {}), ...data };
        writtenOps.push({ op: 'update', path: key, data });
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
        readOps.push({ path: colName + '?filters=' + JSON.stringify(filters), inTx: false });
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
        return {
          empty: docs.length === 0,
          docs,
          forEach: (fn) => docs.forEach(fn),
          size: docs.length,
        };
      },
      async add(data) {
        const newId = 'auto_' + Math.random().toString(36).slice(2, 10);
        state[colName] ||= {};
        state[colName][newId] = data;
        writtenOps.push({ op: 'add', path: colName + '/' + newId, data });
        return { id: newId };
      },
    };
    return col;
  };

  // Tx-aware wrapper: marca reads/writes dentro del tx para T5.
  let txActive = false;
  let firstWriteInTxIdx = null;

  const fbDb = {
    collection: (name) => makeCollection(name),
    doc(path) {
      const [col, ...rest] = path.split('/');
      return makeDocRef(col, rest.join('/'));
    },
    async runTransaction(fn) {
      txActive = true;
      firstWriteInTxIdx = null;
      const txReads = [];
      const txWrites = [];
      const tx = {
        async get(ref) {
          txReads.push({ path: ref._path, idx: writtenOps.length });
          readOps.push({ path: ref._path, inTx: true });
          return ref.get();
        },
        set(ref, data) {
          if (firstWriteInTxIdx === null) firstWriteInTxIdx = writtenOps.length;
          txWrites.push({ op: 'set', path: ref._path });
          return ref.set(data);
        },
        update(ref, data) {
          if (firstWriteInTxIdx === null) firstWriteInTxIdx = writtenOps.length;
          txWrites.push({ op: 'update', path: ref._path });
          return ref.update(data);
        },
      };
      try {
        const result = await fn(tx);
        return result;
      } finally {
        txActive = false;
      }
    },
  };

  return { fbDb, state, writtenOps, readOps };
}

const basePayload = {
  draftId: 'd1',
  cardCode: 'C001',
  clientName: 'TEST SA',
  origen: 'manual',
  lines: [{ sku: 'SKU-D12', cantidad: 50, precio: 100000 }], // netAmount = 5M
  clientVersion: 'v1587',
  condicionPago: 'CONTADO',
  ownerUid: 'U1',
  ownerEmail: 'u1@test.com',
};

describe('STACK S-4 T5 (D12 fix) — commitPedido flag + recompute', () => {
  it('T1 — Flag OFF: persiste discountPct=0 (compat histórica, no behavior change)', async () => {
    const { fbDb, writtenOps } = makeMockDb({
      flagEnabled: false,
      clientMasterData: { cliTipo: 'P' }, // aunque haya datos, flag OFF ignora
    });
    const r = await commitPedidoCore({ fbDb, now: () => new Date('2026-11-25T12:00:00Z') }, {
      ...basePayload,
      discountPct: 14, // el cliente dice que calculó 14; server debe ignorar (flag OFF)
      discountSnapshot: { cliTipo: 'P', pctTotal: 14 },
    });
    expect(r.ok).toBe(true);
    const pedidoWrite = writtenOps.find((w) => w.path.startsWith('pedidos/') && w.op === 'set');
    expect(pedidoWrite).toBeTruthy();
    expect(pedidoWrite.data.discountPct).toBe(0);
    expect(pedidoWrite.data.discountSnapshot).toBeNull();
  });

  it('T2 — Flag ON + cliTipo=P + CONTADO + subtotal $5M: pctTotal=14 (6+3+5)', async () => {
    const { fbDb, writtenOps } = makeMockDb({
      flagEnabled: true,
      clientMasterData: { cliTipo: 'P' },
    });
    const r = await commitPedidoCore({ fbDb, now: () => new Date('2026-11-25T12:00:00Z') }, {
      ...basePayload,
      condicionPago: 'CONTADO',
    });
    expect(r.ok).toBe(true);
    const pedidoWrite = writtenOps.find((w) => w.path.startsWith('pedidos/') && w.op === 'set');
    expect(pedidoWrite).toBeTruthy();
    // $5M = subtotal → vol bracket $4.5M-$10M = 3%. P fijo = 6%. P antic CONTADO = 5%.
    // Total = 6 + 3 + 5 = 14%.
    expect(pedidoWrite.data.discountPct).toBe(14);
    expect(pedidoWrite.data.discountSnapshot).toBeTruthy();
    expect(pedidoWrite.data.discountSnapshot.cliTipo).toBe('P');
    expect(pedidoWrite.data.discountSnapshot.pctFijo).toBe(6);
    expect(pedidoWrite.data.discountSnapshot.pctVol).toBe(3);
    expect(pedidoWrite.data.discountSnapshot.pctAntic).toBe(5);
    expect(pedidoWrite.data.discountSnapshot.source).toBe('server:client_master');
  });

  it('T3 — Flag ON + cliTipo="" + subtotal $25M: pctTotal=6 (volumen only)', async () => {
    const { fbDb, writtenOps } = makeMockDb({
      flagEnabled: true,
      clientMasterData: { cliTipo: '' }, // cliTipo vacío → solo volumen
      stockFisico: 300,
    });
    const r = await commitPedidoCore({ fbDb, now: () => new Date('2026-11-25T12:00:00Z') }, {
      ...basePayload,
      lines: [{ sku: 'SKU-D12', cantidad: 250, precio: 100000 }], // $25M
      condicionPago: 'CTA CTE',
    });
    expect(r.ok).toBe(true);
    const pedidoWrite = writtenOps.find((w) => w.path.startsWith('pedidos/') && w.op === 'set');
    expect(pedidoWrite).toBeTruthy();
    // $25M > $20M → vol 6%. Sin tipo → fijo 0, antic 0. Total = 6%.
    expect(pedidoWrite.data.discountPct).toBe(6);
    expect(pedidoWrite.data.discountSnapshot.pctFijo).toBe(0);
    expect(pedidoWrite.data.discountSnapshot.pctVol).toBe(6);
    expect(pedidoWrite.data.discountSnapshot.pctAntic).toBe(0);
  });

  it('T4 — Flag ON + client_master no existe: cliTipo="", solo volumen aplica', async () => {
    const { fbDb, writtenOps } = makeMockDb({
      flagEnabled: true,
      clientMasterData: null, // sin doc para este cardCode
    });
    const r = await commitPedidoCore({ fbDb, now: () => new Date('2026-11-25T12:00:00Z') }, {
      ...basePayload,
      condicionPago: 'CONTADO',
    });
    expect(r.ok).toBe(true);
    const pedidoWrite = writtenOps.find((w) => w.path.startsWith('pedidos/') && w.op === 'set');
    expect(pedidoWrite).toBeTruthy();
    // $5M vol = 3%. Sin cliTipo → fijo 0 + antic 0. Total = 3%.
    expect(pedidoWrite.data.discountPct).toBe(3);
    expect(pedidoWrite.data.discountSnapshot).toBeTruthy();
    expect(pedidoWrite.data.discountSnapshot.cliTipo).toBe('');
    expect(pedidoWrite.data.discountSnapshot.source).toBe('server:client_master_not_found');
  });

  it('T5 — Flag ON + §58: read de feature_flags + client_master OCURRE antes del tx.set del pedido', async () => {
    const { fbDb, readOps, writtenOps } = makeMockDb({
      flagEnabled: true,
      clientMasterData: { cliTipo: 'A' },
    });
    const r = await commitPedidoCore({ fbDb, now: () => new Date('2026-11-25T12:00:00Z') }, {
      ...basePayload,
      condicionPago: 'CONTADO',
    });
    expect(r.ok).toBe(true);
    // Encuentra los índices clave en la lista completa de reads/writes mergeada.
    const allOps = [
      ...readOps.map((r) => ({ kind: 'read', ...r })),
      ...writtenOps.map((w) => ({ kind: 'write', path: w.path })),
    ];
    // Verificar que feature_flags se leyó + client_master se consultó ANTES del primer pedidos/* set.
    const flagReadIdx = readOps.findIndex((r) => r.path === 'app_config/feature_flags');
    const cmReadIdx = readOps.findIndex((r) => r.path && r.path.startsWith('client_master?'));
    expect(flagReadIdx).toBeGreaterThanOrEqual(0);
    expect(cmReadIdx).toBeGreaterThanOrEqual(0);
    // Ambos reads NO están dentro del tx (los hacemos pre-runTransaction)
    expect(readOps[flagReadIdx].inTx).toBe(false);
    expect(readOps[cmReadIdx].inTx).toBe(false);
    // El tx.set del pedido viene después.
    const pedidoSetOp = writtenOps.find((w) => w.path.startsWith('pedidos/') && w.op === 'set');
    expect(pedidoSetOp).toBeTruthy();
  });

  it('T6 — Flag ON + mismatch cliente/server: usa server, loguea divergencia', async () => {
    const logFn = vi.fn();
    const { fbDb, writtenOps } = makeMockDb({
      flagEnabled: true,
      clientMasterData: { cliTipo: 'C' }, // server dice C (no descuento fijo/antic)
    });
    const r = await commitPedidoCore(
      {
        fbDb,
        now: () => new Date('2026-11-25T12:00:00Z'),
        log: logFn,
      },
      {
        ...basePayload,
        condicionPago: 'CONTADO',
        // Cliente afirma que es P + 14% (stale cliTipo)
        discountPct: 14,
        discountSnapshot: { cliTipo: 'P', pctTotal: 14 },
      }
    );
    expect(r.ok).toBe(true);
    const pedidoWrite = writtenOps.find((w) => w.path.startsWith('pedidos/') && w.op === 'set');
    expect(pedidoWrite).toBeTruthy();
    // Server dice cliTipo='C' → solo volumen 3%. NO 14% del cliente.
    expect(pedidoWrite.data.discountPct).toBe(3);
    expect(pedidoWrite.data.discountSnapshot.cliTipo).toBe('C');
    expect(pedidoWrite.data.discountSnapshot.mismatchDetected).toBe(true);
    // Log registra la divergencia.
    const mismatchLog = logFn.mock.calls.find((c) =>
      String(c[0] || '').includes('d12 discount mismatch')
    );
    expect(mismatchLog).toBeTruthy();
    expect(mismatchLog[1]).toMatchObject({
      clientPct: 14,
      serverPct: 3,
      cliTipoFromPayload: 'P',
      cliTipoFromMaster: 'C',
    });
  });
});
