// v1525 (2026-10-29) — applyRepartoManualCore aplica todo el reparto en UNA
// transaccion. Precedente: LUGC22 / BALTICA20LG / CVL401 quedaron in_progress
// el 28/10 18:49 con la mitad aplicada (1 transaccion por linea, en serie).
import { describe, expect, it } from 'vitest';
import { applyRepartoManualCore } from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-29T15:00:00Z');

function makeDb({ ingreso, pedidos, fisico = 50, asig = 0 }) {
  const mem = { ingreso: { ...ingreso }, pedidos: JSON.parse(JSON.stringify(pedidos)) };
  const stats = { tx: 0, writes: [], directWrites: [] };
  const refOf = (col, id) => ({ col, id });
  const read = (ref) => {
    if (ref.col === 'ingresos_reparto') return { exists: true, data: () => ({ ...mem.ingreso }) };
    if (ref.col === 'app_config')
      return {
        exists: true,
        data: () => ({
          warehouseBreakdown: { SKU1: { 11: fisico } },
          asigBySkuApp: { SKU1: asig },
        }),
      };
    const p = mem.pedidos[ref.id];
    return { exists: !!p, data: () => (p ? JSON.parse(JSON.stringify(p)) : undefined) };
  };
  const fbDb = {
    collection(col) {
      return {
        doc(id) {
          const r = refOf(col, id);
          return {
            ...r,
            get: async () => read(r),
            update: async (data) => {
              stats.directWrites.push({ col, id, data });
            },
          };
        },
        add: async () => ({ id: 'log' }),
      };
    },
    async runTransaction(fn) {
      stats.tx++;
      let wrote = false;
      const pending = [];
      const tx = {
        get: async (ref) => {
          if (wrote) throw new Error('reads after writes (§58)');
          return read(ref);
        },
        update: (ref, data) => {
          wrote = true;
          pending.push({ ref, data });
        },
      };
      const out = await fn(tx);
      for (const w of pending) {
        stats.writes.push({ col: w.ref.col, id: w.ref.id, data: w.data });
        if (w.ref.col === 'ingresos_reparto') Object.assign(mem.ingreso, w.data);
        else mem.pedidos[w.ref.id] = { ...mem.pedidos[w.ref.id], ...w.data };
      }
      return out;
    },
  };
  return { fbDb, mem, stats };
}

const deps = (fbDb) => ({ fbDb, now: () => NOW, log: () => {} });
const bo = (qty) => ({ code: 'SKU1', state: 'BO', qty, qtyOpen: qty });

function base() {
  return {
    ingreso: { sku: 'SKU1', status: 'pending', qtyIngresada: 10, clientesBO: [] },
    pedidos: {
      p1: { lines: [bo(2)] },
      p2: { lines: [bo(3)] },
      p3: { lines: [{ code: 'SKU1', state: 'ASIG', qty: 1, qtyOpen: 1 }] },
    },
  };
}

describe('v1525 reparto en una sola transaccion', () => {
  it('T1 una sola transaccion; linea ya asignada se saltea sin error; status done', async () => {
    const { fbDb, mem, stats } = makeDb(base());
    const r = await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 },
        { pedidoId: 'p2', lineIndex: 0, qtyAsignada: 3 },
        { pedidoId: 'p3', lineIndex: 0, qtyAsignada: 1 },
      ],
    });
    expect(stats.tx).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.applied).toHaveLength(2);
    expect(r.skipped).toEqual([expect.objectContaining({ pedidoId: 'p3', lineIndex: 0 })]);
    expect(mem.pedidos.p1.lines[0]).toMatchObject({ state: 'ASIG', qtyOpen: 2 });
    expect(mem.pedidos.p3.lines[0]).toMatchObject({ state: 'ASIG', qtyOpen: 1 });
    expect(mem.ingreso.status).toBe('done');
    // Sin lock previo fuera de la transaccion.
    expect(stats.directWrites).toEqual([]);
  });

  it('T2 si el stock bajó, aborta todo: nada escrito y el ingreso sigue pending', async () => {
    const b = base();
    let calls = 0;
    const { fbDb, mem, stats } = makeDb(b);
    const orig = fbDb.collection;
    fbDb.collection = (col) => {
      const c = orig(col);
      if (col !== 'app_config') return c;
      return {
        ...c,
        doc: (id) => {
          const d = c.doc(id);
          return {
            ...d,
            get: async () => {
              calls++;
              return {
                exists: true,
                data: () => ({ warehouseBreakdown: { SKU1: { 11: calls === 1 ? 50 : 4 } } }),
              };
            },
          };
        },
      };
    };
    // tx.get usa read() del mock (fisico 50), forzamos el valor en tx via ref.get.
    const runTx = fbDb.runTransaction;
    fbDb.runTransaction = (fn) =>
      runTx.call(fbDb, (tx) =>
        fn({ ...tx, get: (ref) => (ref.col === 'app_config' ? ref.get() : tx.get(ref)) })
      );
    const r = await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/E5 stock físico bajó/);
    expect(stats.writes).toEqual([]);
    expect(mem.ingreso.status).toBe('pending');
  });

  it('T3 ingreso trabado in_progress de hace 1 h se acepta (version vieja)', async () => {
    const b = base();
    b.ingreso = { ...b.ingreso, status: 'in_progress', lockedAt: '2026-10-29T14:00:00Z' };
    const { fbDb, mem } = makeDb(b);
    const r = await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
    });
    expect(r.ok).toBe(true);
    expect(mem.ingreso.status).toBe('done');
    expect(mem.ingreso.lockedAt).toBeNull();
  });

  it('T4 in_progress de hace 30 s se rechaza (posible doble clic)', async () => {
    const b = base();
    b.ingreso = { ...b.ingreso, status: 'in_progress', lockedAt: '2026-10-29T14:59:30Z' };
    const { fbDb, stats } = makeDb(b);
    const r = await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
    });
    expect(r.ok).toBe(false);
    expect(stats.writes).toEqual([]);
  });

  it('T5 todo salteado: ok=false "nada para aplicar" y el ingreso no cambia', async () => {
    const { fbDb, mem, stats } = makeDb(base());
    const r = await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [{ pedidoId: 'p3', lineIndex: 0, qtyAsignada: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/nada para aplicar/);
    expect(stats.writes).toEqual([]);
    expect(mem.ingreso.status).toBe('pending');
  });

  it('T6 las asignaciones nuevas se suman a las de un intento anterior', async () => {
    const b = base();
    b.ingreso = {
      ...b.ingreso,
      assignments: [{ pedidoId: 'pX', lineIndex: 0, qtyAsignada: 4 }],
    };
    const { fbDb, mem } = makeDb(b);
    await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
    });
    expect(mem.ingreso.assignments.map((a) => a.pedidoId)).toEqual(['pX', 'p1']);
    // sobrante = 10 - 4 - 2
    expect(mem.ingreso.sobranteLibre).toBe(4);
  });

  it('T7 dos asignaciones al mismo pedido: un solo update con ambas lineas', async () => {
    const b = base();
    b.pedidos.p1 = { lines: [bo(2), bo(5)] };
    const { fbDb, mem, stats } = makeDb(b);
    const r = await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [
        { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 },
        { pedidoId: 'p1', lineIndex: 1, qtyAsignada: 2 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(stats.writes.filter((w) => w.col === 'pedidos')).toHaveLength(1);
    const lines = mem.pedidos.p1.lines;
    expect(lines[0]).toMatchObject({ state: 'ASIG', qtyOpen: 2 });
    expect(lines[1]).toMatchObject({ state: 'BO', qtyOpen: 3 });
    expect(lines[2]).toMatchObject({ state: 'ASIG', qtyOpen: 2, splitFromLineIndex: 1 });
  });
});
