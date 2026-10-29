// @ts-check
/**
 * v1392 §40 — applyRepartoManualCore con `allowSobrante=true` cierra el
 * ingreso en `status='done'` aunque no se asignen todas las unidades. Lo
 * no asignado queda libre por construcción (bucket repartoAbierto desaparece).
 */
import { describe, expect, it } from 'vitest';
import {
  applyRepartoManualCore,
  validateRepartoPayload,
} from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-21T12:00:00Z');
const nowIso = NOW.toISOString();

function makeIngresoDoc(overrides = {}) {
  return {
    sku: 'STRADIC',
    qtyIngresada: 10,
    detectedAt: new Date(NOW.getTime() - 2 * 60 * 1000).toISOString(), // 2 min atrás
    status: 'pending',
    clientesBO: [
      {
        pedidoId: 'pA',
        lineIndex: 0,
        clientCardCode: 'CA',
        clientName: 'A',
        qtyBackorder: 5,
      },
      {
        pedidoId: 'pB',
        lineIndex: 0,
        clientCardCode: 'CB',
        clientName: 'B',
        qtyBackorder: 5,
      },
    ],
    ...overrides,
  };
}

function makeFakeFbDb({ ingreso, pedidos = [], stockFisico = 10 }) {
  const writes = [];
  const ingresoDocRef = {
    get: async () => ({ exists: true, data: () => ingreso }),
    update: async (data) => {
      writes.push({ col: 'ingresos_reparto', op: 'update', data });
      Object.assign(ingreso, data);
    },
  };
  const stockSnap = {
    exists: true,
    data: () => ({ warehouseBreakdown: JSON.stringify({ STRADIC: { 11: stockFisico } }) }),
  };
  return {
    _writes: writes,
    collection(name) {
      return {
        doc: (id) => {
          if (name === 'ingresos_reparto') return ingresoDocRef;
          if (name === 'app_config' && id === 'stock_snapshot')
            return { get: async () => stockSnap };
          if (name === 'pedidos') {
            const ped = pedidos.find((p) => p.id === id);
            return ped ? ped.ref : { get: async () => ({ exists: false }) };
          }
          return { get: async () => ({ exists: false }) };
        },
        where() {
          return {
            get: async () => ({ forEach: () => {} }),
            where() {
              return this;
            },
            limit() {
              return this;
            },
          };
        },
        async add(data) {
          writes.push({ col: name, op: 'add', data });
          return { id: 'log_' + writes.length };
        },
      };
    },
    runTransaction: async (fn) => {
      const tx = {
        get: async (ref) => ref.get(),
        update: (ref, data) => {
          // v1525: el ingreso se actualiza dentro de la transaccion.
          if (ref === ingresoDocRef) {
            ref.update(data);
            return;
          }
          writes.push({ ref, op: 'update', data });
          if (ref._mem) Object.assign(ref._mem, data);
        },
      };
      return fn(tx);
    },
  };
}

const deps = (fbDb) => ({ fbDb, now: () => NOW, log: () => {} });

describe('v1392 §40 validateRepartoPayload con allowSobrante', () => {
  it('allowSobrante=true permite assignments=[] y eliminations=[]', () => {
    const ingreso = makeIngresoDoc();
    const r = validateRepartoPayload(ingreso, [], [], { allowSobrante: true });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('allowSobrante=false (default) rechaza vacíos', () => {
    const ingreso = makeIngresoDoc();
    const r = validateRepartoPayload(ingreso, [], []);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('vacios'))).toBe(true);
  });

  it('allowSobrante=true con assignments parciales también OK', () => {
    const ingreso = makeIngresoDoc();
    const r = validateRepartoPayload(
      ingreso,
      [{ pedidoId: 'pA', lineIndex: 0, qtyAsignada: 2 }],
      [],
      { allowSobrante: true }
    );
    expect(r.valid).toBe(true);
  });
});

describe('v1392 §40 applyRepartoManualCore allowSobrante', () => {
  it('Pablo cierra con sobrante → status=done + closedReason + sobranteLibre', async () => {
    const ingreso = makeIngresoDoc({ qtyIngresada: 10 });
    const fbDb = makeFakeFbDb({ ingreso, pedidos: [], stockFisico: 10 });
    const r = await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [],
      eliminations: [],
      allowSobrante: true,
      appliedByEmail: 'pablo@shimano.com.ar',
    });
    expect(r.ok).toBe(true);
    // Última update del ingreso debe tener status=done.
    const lastUpdate = fbDb._writes
      .filter((w) => w.col === 'ingresos_reparto' && w.op === 'update')
      .pop();
    expect(lastUpdate.data.status).toBe('done');
    expect(lastUpdate.data.closedReason).toContain('admin_cerrado_con_sobrante');
    expect(lastUpdate.data.sobranteLibre).toBe(10);
    expect(typeof lastUpdate.data.ventanaIngresoARepartoMs).toBe('number');
  });

  it('sin allowSobrante, assignments vacíos → error (comportamiento pre-§40)', async () => {
    const ingreso = makeIngresoDoc({ qtyIngresada: 10 });
    const fbDb = makeFakeFbDb({ ingreso });
    const r = await applyRepartoManualCore(deps(fbDb), {
      ingresoId: 'ing1',
      assignments: [],
      eliminations: [],
      appliedByEmail: 'pablo@shimano.com.ar',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('vacios');
  });
});
