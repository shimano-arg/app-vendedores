// @ts-check
/**
 * v1522 (2026-10-29) — revertSobreAsignadas no pisa escrituras concurrentes.
 *
 * Antes: leía todos los pedidos abiertos, calculaba el recorte y escribía el
 * array `lines` completo con `update()` fuera de transacción. Si entre la
 * lectura y la escritura Pablo aplicaba un reparto en el mismo pedido, la
 * escritura vieja borraba la asignación de Pablo (lost update).
 *
 * Ahora: cada pedido se escribe en una transacción que re-lee el doc; si las
 * líneas cambiaron desde la lectura, se saltea en esta vuelta (la próxima, a
 * los ~5 min, lo evalúa con datos frescos).
 */
import { describe, expect, it } from 'vitest';
import { revertSobreAsignadas } from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const asigAt = new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));

/**
 * Firestore en memoria con transacciones serializadas.
 * `onAfterLoad` corre después de la lectura masiva de pedidos (simula a Pablo
 * escribiendo mientras el reconcile calcula).
 */
function makeDb(pedidos, onAfterLoad) {
  /** @type {Map<string, any>} */
  const mem = new Map(Object.entries(clone(pedidos)));
  let lock = Promise.resolve();
  const ref = (id) => ({
    id,
    get: async () => ({ exists: mem.has(id), data: () => clone(mem.get(id)) }),
    update: async (d) => mem.set(id, Object.assign({}, mem.get(id), clone(d))),
  });
  return {
    mem,
    collection(name) {
      return {
        where() {
          return {
            get: async () => {
              const docs =
                name === 'pedidos'
                  ? [...mem.entries()].map(([id, d]) => {
                      const copia = clone(d); // foto en el momento de leer
                      return { id, data: () => copia };
                    })
                  : [];
              if (onAfterLoad) await onAfterLoad(mem);
              return { forEach: (cb) => docs.forEach(cb), docs };
            },
            where() {
              return this;
            },
          };
        },
        doc: (id) => ref(id),
      };
    },
    runTransaction: async (fn) => {
      const prev = lock;
      let release;
      lock = new Promise((r) => {
        release = r;
      });
      await prev;
      try {
        /** @type {Array<() => void>} */
        const writes = [];
        const tx = {
          get: (r) => r.get(),
          update: (r, d) =>
            writes.push(() => mem.set(r.id, Object.assign({}, mem.get(r.id), clone(d)))),
        };
        const out = await fn(tx);
        for (const w of writes) w();
        return out;
      } finally {
        release();
      }
    },
  };
}

const pedido = (lines) => ({
  closedAt: null,
  clientCardCode: 'C30710852762',
  clientName: 'REBORN SRL',
  createdAt: asigAt,
  updatedAt: asigAt,
  lines,
});
const snap = (whs) => ({ warehouseBreakdown: JSON.stringify(whs) });
const deps = (fbDb) => ({ fbDb, now: () => NOW, log: () => {} });

describe('revertSobreAsignadas — concurrencia con reparto', () => {
  it('T1 sin escritura concurrente: aplica el recorte como siempre', async () => {
    const db = makeDb({
      P1: pedido([{ code: 'X', state: 'ASIG', qty: 6, qtyOpen: 6, asigReserva: true, asigAt }]),
    });
    const r = await revertSobreAsignadas(deps(db), snap({ X: { 11: 2 } }));
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(db.mem.get('P1').lines.map((l) => [l.state, l.qtyOpen])).toEqual([
      ['ASIG', 2],
      ['BO', 4],
    ]);
  });

  it('T2 Pablo asigna otra línea del mismo pedido mientras corre el reconcile: NO se pisa', async () => {
    const db = makeDb(
      {
        P1: pedido([
          { code: 'X', state: 'ASIG', qty: 6, qtyOpen: 6, asigReserva: true, asigAt },
          { code: 'CLC66H2PY', state: 'BO', qty: 2, qtyOpen: 2 },
        ]),
      },
      async (mem) => {
        // Pablo aplica un reparto: la línea 1 pasa entera a ASIG.
        const p = mem.get('P1');
        p.lines[1] = Object.assign({}, p.lines[1], {
          state: 'ASIG',
          asigAt: NOW.toISOString(),
          asigFromReparto: 'ING_PABLO',
        });
        p.updatedAt = NOW.toISOString();
      }
    );
    const r = await revertSobreAsignadas(deps(db), snap({ X: { 11: 2 }, CLC66H2PY: { 11: 2 } }));
    const lines = db.mem.get('P1').lines;
    // La asignación de Pablo sigue ahí.
    expect(lines[1]).toMatchObject({ state: 'ASIG', asigFromReparto: 'ING_PABLO', qtyOpen: 2 });
    // El recorte de X se pospone a la próxima vuelta (no se escribió nada viejo).
    expect(lines[0]).toMatchObject({ state: 'ASIG', qtyOpen: 6 });
    expect(lines).toHaveLength(2);
    expect(r.skipped).toEqual([{ pedidoId: 'P1', motivo: 'pedido_cambio_durante_reconcile' }]);
    expect(r.errors).toEqual([]);
  });

  it('T3 la vuelta siguiente (datos frescos) sí aplica el recorte', async () => {
    let first = true;
    const db = makeDb(
      {
        P1: pedido([
          { code: 'X', state: 'ASIG', qty: 6, qtyOpen: 6, asigReserva: true, asigAt },
          { code: 'Y', state: 'BO', qty: 2, qtyOpen: 2 },
        ]),
      },
      async (mem) => {
        if (!first) return;
        first = false;
        mem.get('P1').lines[1].state = 'ASIG';
      }
    );
    await revertSobreAsignadas(deps(db), snap({ X: { 11: 2 }, Y: { 11: 5 } }));
    const r2 = await revertSobreAsignadas(deps(db), snap({ X: { 11: 2 }, Y: { 11: 5 } }));
    expect(r2.skipped).toEqual([]);
    expect(db.mem.get('P1').lines.map((l) => [l.code, l.state, l.qtyOpen])).toEqual([
      ['X', 'ASIG', 2],
      ['Y', 'ASIG', 2],
      ['X', 'BO', 4],
    ]);
  });

  it('T4 pedido borrado/cerrado entre lectura y escritura: no se resucita', async () => {
    const db = makeDb(
      { P1: pedido([{ code: 'X', state: 'ASIG', qty: 6, qtyOpen: 6, asigReserva: true, asigAt }]) },
      async (mem) => {
        mem.delete('P1');
      }
    );
    const r = await revertSobreAsignadas(deps(db), snap({ X: { 11: 2 } }));
    expect(db.mem.has('P1')).toBe(false);
    expect(r.skipped).toEqual([{ pedidoId: 'P1', motivo: 'pedido_no_existe' }]);
  });

  it('T5 dryRun no abre transacciones ni escribe', async () => {
    const db = makeDb({
      P1: pedido([{ code: 'X', state: 'ASIG', qty: 6, qtyOpen: 6, asigReserva: true, asigAt }]),
    });
    const before = clone(db.mem.get('P1'));
    const r = await revertSobreAsignadas(deps(db), snap({ X: { 11: 2 } }), { dryRun: true });
    expect(r.revertidas).toHaveLength(1);
    expect(db.mem.get('P1')).toEqual(before);
  });
});
