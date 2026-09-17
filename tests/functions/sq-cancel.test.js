import { describe, expect, it, vi } from 'vitest';
import {
  cancelSqInSap,
  markLinesCancelled,
  runSqCancelExpired,
  scanExpiredConfirmedSqs,
  verifySqCanBeCancelled,
} from '../../functions/core/sq-cancel-core.js';

const NOW = new Date('2026-09-17T12:00:00Z');
const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

function makeFbDb(initial = {}) {
  const store = {
    syncState: initial.syncState || null,
    pedidos: initial.pedidos || [],
  };
  const writes = [];
  return {
    _writes: writes,
    _store: store,
    async runTransaction(fn) {
      const tx = {
        async get(refLike) {
          return refLike._read();
        },
        update(refLike, data) {
          refLike._commitUpdate(data);
        },
      };
      return await fn(tx);
    },
    doc(path) {
      return {
        async _read() {
          return this.get();
        },
        _commitUpdate(data) {
          if (path.startsWith('pedidos/')) {
            const id = path.split('/')[1];
            const p = store.pedidos.find((x) => x.id === id);
            if (p) p.data = { ...p.data, ...data };
          }
          writes.push({ type: 'update', path, data });
        },
        async get() {
          if (path === 'app_config/sap_sync_state') {
            return { exists: !!store.syncState, data: () => store.syncState || {} };
          }
          if (path.startsWith('pedidos/')) {
            const id = path.split('/')[1];
            const p = store.pedidos.find((x) => x.id === id);
            return { exists: !!p, data: () => (p ? p.data : {}) };
          }
          return { exists: false, data: () => ({}) };
        },
        async set(data) {
          writes.push({ type: 'set', path, data });
        },
        async update(data) {
          if (path.startsWith('pedidos/')) {
            const id = path.split('/')[1];
            const p = store.pedidos.find((x) => x.id === id);
            if (p) p.data = { ...p.data, ...data };
          }
          writes.push({ type: 'update', path, data });
        },
      };
    },
    collection(name) {
      return {
        doc(id) {
          return this._parent.doc(`${name}/${id}`);
        },
        _parent: this,
        where(field, op, value) {
          return {
            async get() {
              if (name !== 'pedidos') return { forEach: () => {} };
              const filtered = store.pedidos.filter((p) => {
                if (field === 'closedAt' && op === '==' && value === null) {
                  return !p.data.closedAt;
                }
                return true;
              });
              return {
                forEach(cb) {
                  for (const p of filtered) cb({ id: p.id, data: () => p.data });
                },
              };
            },
          };
        },
      };
    },
  };
}

describe('scanExpiredConfirmedSqs', () => {
  it('encuentra pedidos con confirmed >15d y transferidoSAP', async () => {
    const fbDb = makeFbDb({
      pedidos: [
        {
          id: 'p_viejo',
          data: {
            stage: 'confirmed',
            closedAt: null,
            confirmedAt: iso(20),
            clientName: 'PIRACUA',
            clientCardCode: 'C-PIR',
            transferidoSAP: { docNum: '2000100' },
            lines: [
              { code: 'X', state: 'confirmed', qtyOpen: 5, priceAtCreation: 100 },
              { code: 'Y', state: 'confirmed', qtyOpen: 3, priceAtCreation: 50 },
              { code: 'Z', state: 'BO', qtyOpen: 2 }, // BO no cuenta
            ],
          },
        },
      ],
    });
    const cands = await scanExpiredConfirmedSqs({ fbDb, now: () => NOW });
    expect(cands).toHaveLength(1);
    expect(cands[0].pedidoId).toBe('p_viejo');
    expect(cands[0].ageDays).toBe(20);
    expect(cands[0].totalUnits).toBe(8);
    expect(cands[0].totalArs).toBe(650); // 5*100 + 3*50
    expect(cands[0].confirmedLineIndexes).toEqual([0, 1]);
  });

  it('skip pedidos con confirmed <15d', async () => {
    const fbDb = makeFbDb({
      pedidos: [
        {
          id: 'p_reciente',
          data: {
            stage: 'confirmed',
            closedAt: null,
            confirmedAt: iso(10),
            transferidoSAP: { docNum: '2000200' },
            lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }],
          },
        },
      ],
    });
    const cands = await scanExpiredConfirmedSqs({ fbDb, now: () => NOW });
    expect(cands).toHaveLength(0);
  });

  it('skip pedidos sin transferidoSAP.docNum', async () => {
    const fbDb = makeFbDb({
      pedidos: [
        {
          id: 'p_sin_sap',
          data: {
            stage: 'confirmed',
            closedAt: null,
            confirmedAt: iso(30),
            transferidoSAP: null,
            lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }],
          },
        },
      ],
    });
    const cands = await scanExpiredConfirmedSqs({ fbDb, now: () => NOW });
    expect(cands).toHaveLength(0);
  });

  it('skip pedidos cerrados', async () => {
    const fbDb = makeFbDb({
      pedidos: [
        {
          id: 'p_closed',
          data: {
            stage: 'confirmed',
            closedAt: '2026-09-01',
            confirmedAt: iso(30),
            transferidoSAP: { docNum: '2000300' },
            lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }],
          },
        },
      ],
    });
    const cands = await scanExpiredConfirmedSqs({ fbDb, now: () => NOW });
    expect(cands).toHaveLength(0);
  });

  it('skip pedidos sin lineas confirmed abiertas', async () => {
    const fbDb = makeFbDb({
      pedidos: [
        {
          id: 'p_facturado',
          data: {
            stage: 'confirmed',
            closedAt: null,
            confirmedAt: iso(30),
            transferidoSAP: { docNum: '2000400' },
            lines: [
              { code: 'X', state: 'invoiced', qtyOpen: 0 },
              { code: 'Y', state: 'confirmed', qtyOpen: 0 }, // qtyOpen 0 no cuenta
            ],
          },
        },
      ],
    });
    const cands = await scanExpiredConfirmedSqs({ fbDb, now: () => NOW });
    expect(cands).toHaveLength(0);
  });
});

describe('verifySqCanBeCancelled', () => {
  it('sin slFetch → cannot cancel (shadow mode safety)', async () => {
    const r = await verifySqCanBeCancelled({ fbDb: null }, '2000100');
    expect(r.canCancel).toBe(false);
    expect(r.reason).toMatch(/slFetch/);
  });

  it('SQ Open sin Delivery → canCancel=true', async () => {
    const slFetch = vi.fn().mockResolvedValue({
      value: [
        {
          DocEntry: 100,
          DocNum: 2000100,
          DocumentStatus: 'bost_Open',
          Cancelled: 'tNO',
          DocumentLines: [{ TargetType: -1 }],
        },
      ],
    });
    const r = await verifySqCanBeCancelled({ fbDb: null, slFetch }, '2000100');
    expect(r.canCancel).toBe(true);
  });

  it('SQ ya cerrada → canCancel=false', async () => {
    const slFetch = vi.fn().mockResolvedValue({
      value: [{ DocumentStatus: 'bost_Close', Cancelled: 'tNO', DocumentLines: [] }],
    });
    const r = await verifySqCanBeCancelled({ fbDb: null, slFetch }, '2000100');
    expect(r.canCancel).toBe(false);
    expect(r.reason).toMatch(/cerrada/);
  });

  it('SQ con Delivery generada → canCancel=false', async () => {
    const slFetch = vi.fn().mockResolvedValue({
      value: [
        { DocumentStatus: 'bost_Open', Cancelled: 'tNO', DocumentLines: [{ TargetType: 15 }] },
      ],
    });
    const r = await verifySqCanBeCancelled({ fbDb: null, slFetch }, '2000100');
    expect(r.canCancel).toBe(false);
    expect(r.reason).toMatch(/Delivery/);
  });

  it('SQ con Order generada (TargetType 17) → canCancel=false', async () => {
    const slFetch = vi.fn().mockResolvedValue({
      value: [
        { DocumentStatus: 'bost_Open', Cancelled: 'tNO', DocumentLines: [{ TargetType: 17 }] },
      ],
    });
    const r = await verifySqCanBeCancelled({ fbDb: null, slFetch }, '2000100');
    expect(r.canCancel).toBe(false);
  });

  it('SQ no encontrada → canCancel=false', async () => {
    const slFetch = vi.fn().mockResolvedValue({ value: [] });
    const r = await verifySqCanBeCancelled({ fbDb: null, slFetch }, '2000100');
    expect(r.canCancel).toBe(false);
    expect(r.reason).toMatch(/no encontrada/);
  });
});

describe('cancelSqInSap', () => {
  it('happy path: POST /Cancel al DocEntry correcto', async () => {
    const slFetch = vi
      .fn()
      .mockResolvedValueOnce({ value: [{ DocEntry: 555 }] }) // GET DocEntry
      .mockResolvedValueOnce(null); // POST Cancel
    const r = await cancelSqInSap({ fbDb: null, slFetch }, '2000100');
    expect(r.ok).toBe(true);
    expect(slFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('2000100'));
    expect(slFetch).toHaveBeenNthCalledWith(2, '/b1s/v1/Quotations(555)/Cancel', {
      method: 'POST',
    });
  });

  it('SQ no encontrada → ok=false', async () => {
    const slFetch = vi.fn().mockResolvedValue({ value: [] });
    const r = await cancelSqInSap({ fbDb: null, slFetch }, '2000100');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no encontrada/);
  });

  it('SL throws → ok=false con error', async () => {
    const slFetch = vi.fn().mockRejectedValue(new Error('SL down'));
    const r = await cancelSqInSap({ fbDb: null, slFetch }, '2000100');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SL down/);
  });
});

describe('markLinesCancelled', () => {
  it('marca solo lineas confirmed en los indexes especificados', async () => {
    const fbDb = makeFbDb({
      pedidos: [
        {
          id: 'p1',
          data: {
            lines: [
              { code: 'A', state: 'confirmed', qtyOpen: 5 },
              { code: 'B', state: 'BO', qtyOpen: 3 },
              { code: 'C', state: 'confirmed', qtyOpen: 2 },
            ],
          },
        },
      ],
    });
    await markLinesCancelled(
      { fbDb, now: () => NOW },
      { pedidoId: 'p1', confirmedLineIndexes: [0, 2] }
    );
    const updated = fbDb._store.pedidos[0].data.lines;
    expect(updated[0].state).toBe('cancelled');
    expect(updated[0].qtyOpen).toBe(0);
    expect(updated[0].cancelledReason).toBe('sq_ttl_expired');
    expect(updated[1].state).toBe('BO'); // no tocado
    expect(updated[1].qtyOpen).toBe(3);
    expect(updated[2].state).toBe('cancelled');
  });

  it('skip lineas que ya cambiaron a otro state (race defense)', async () => {
    const fbDb = makeFbDb({
      pedidos: [
        {
          id: 'p1',
          data: {
            lines: [
              { code: 'A', state: 'invoiced', qtyOpen: 0 }, // ya facturada, no confirmed
            ],
          },
        },
      ],
    });
    await markLinesCancelled(
      { fbDb, now: () => NOW },
      { pedidoId: 'p1', confirmedLineIndexes: [0] }
    );
    expect(fbDb._store.pedidos[0].data.lines[0].state).toBe('invoiced');
  });
});

describe('runSqCancelExpired — shadow mode', () => {
  it('shadow: encuentra candidatos, log al audit, NO cancela SAP', async () => {
    const fbDb = makeFbDb({
      syncState: {}, // sin sqCancelMode → default shadow
      pedidos: [
        {
          id: 'p_viejo',
          data: {
            stage: 'confirmed',
            closedAt: null,
            confirmedAt: iso(20),
            clientName: 'PIRACUA',
            transferidoSAP: { docNum: '2000100' },
            lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5, priceAtCreation: 100 }],
          },
        },
      ],
    });
    const slFetch = vi.fn();
    const r = await runSqCancelExpired({ fbDb, now: () => NOW, slFetch });
    expect(r.mode).toBe('shadow');
    expect(r.candidates).toHaveLength(1);
    expect(r.cancelledCount).toBe(0);
    expect(slFetch).not.toHaveBeenCalled(); // shadow NO llama a SL
    // Pedido NO fue modificado
    expect(fbDb._store.pedidos[0].data.lines[0].state).toBe('confirmed');
    // Audit log en sq_cancel_log_shadow
    const audit = fbDb._writes.find((w) => w.path.startsWith('sq_cancel_log_shadow/'));
    expect(audit).toBeDefined();
    expect(audit.data.mode).toBe('shadow');
    expect(audit.data.candidatesCount).toBe(1);
  });
});

describe('runSqCancelExpired — active mode', () => {
  it('active: cancela SQ + marca linea + log al collection real', async () => {
    const fbDb = makeFbDb({
      syncState: { sqCancelMode: 'active' },
      pedidos: [
        {
          id: 'p_viejo',
          data: {
            stage: 'confirmed',
            closedAt: null,
            confirmedAt: iso(20),
            clientName: 'PIRACUA',
            transferidoSAP: { docNum: '2000100' },
            lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5, priceAtCreation: 100 }],
          },
        },
      ],
    });
    const slFetch = vi
      .fn()
      // verifySqCanBeCancelled: SQ Open sin Delivery
      .mockResolvedValueOnce({
        value: [
          {
            DocEntry: 555,
            DocumentStatus: 'bost_Open',
            Cancelled: 'tNO',
            DocumentLines: [{ TargetType: -1 }],
          },
        ],
      })
      // cancelSqInSap: GET DocEntry
      .mockResolvedValueOnce({ value: [{ DocEntry: 555 }] })
      // cancelSqInSap: POST Cancel
      .mockResolvedValueOnce(null);
    const r = await runSqCancelExpired({ fbDb, now: () => NOW, slFetch });
    expect(r.mode).toBe('active');
    expect(r.cancelledCount).toBe(1);
    expect(r.skipped).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
    // Pedido SI fue modificado
    expect(fbDb._store.pedidos[0].data.lines[0].state).toBe('cancelled');
    // Audit log en sq_cancel_log (no shadow)
    const audit = fbDb._writes.find((w) => w.path.startsWith('sq_cancel_log/'));
    expect(audit).toBeDefined();
    expect(audit.data.cancelledCount).toBe(1);
  });

  it('active: skip si SQ tiene Delivery (salvaguarda)', async () => {
    const fbDb = makeFbDb({
      syncState: { sqCancelMode: 'active' },
      pedidos: [
        {
          id: 'p_viejo',
          data: {
            stage: 'confirmed',
            closedAt: null,
            confirmedAt: iso(20),
            transferidoSAP: { docNum: '2000100' },
            lines: [{ code: 'X', state: 'confirmed', qtyOpen: 5 }],
          },
        },
      ],
    });
    const slFetch = vi.fn().mockResolvedValueOnce({
      value: [
        {
          DocEntry: 555,
          DocumentStatus: 'bost_Open',
          Cancelled: 'tNO',
          DocumentLines: [{ TargetType: 15 }],
        },
      ],
    });
    const r = await runSqCancelExpired({ fbDb, now: () => NOW, slFetch });
    expect(r.cancelledCount).toBe(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/Delivery/);
    expect(fbDb._store.pedidos[0].data.lines[0].state).toBe('confirmed');
    // Skipped log escrito
    const skippedLog = fbDb._writes.find((w) => w.path.startsWith('sq_cancel_skipped_log/'));
    expect(skippedLog).toBeDefined();
  });
});
