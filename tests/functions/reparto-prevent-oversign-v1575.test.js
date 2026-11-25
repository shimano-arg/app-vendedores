// @ts-check
/**
 * v1575 (2026-11-25): Test gate preventivo sobre-asignacion en applyRepartoManualCore.
 *
 * El cap v1312 anterior validaba `sum(assignments) <= fisicoDep11` (bruto).
 * El cap v1575 extiende a `sum(assignments) <= fisicoLibre` donde
 *   fisicoLibre = fisicoDep11 - asigExistente - confirmedSinSOExistente - cpstExistente.
 * Previene sobre-asignacion. Precedente Mariano 2026-11-25.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyRepartoManualCore } from '../../functions/core/reparto-core.js';

/** Helper mock fbDb que soporta `.where('closedAt','==',null).get()`. */
function makeDeps({ sku, fisicoDep11, pedidosExistentes, ingresoDoc, pedidoBO }) {
  const state = {
    pedidos: { ...pedidosExistentes, [pedidoBO._fsId]: pedidoBO },
    ingresos_reparto: { [ingresoDoc._fsId]: ingresoDoc },
    app_config: {
      stock_snapshot: {
        warehouseBreakdown: { [sku]: { 11: fisicoDep11 } },
        asigBySkuApp: { [sku]: 0 },
      },
    },
  };
  const writes = [];
  const makeDocRef = (col, id) => ({
    id,
    async get() {
      const d = state[col] && state[col][id];
      return { exists: !!d, data: () => d };
    },
    async update(data) {
      state[col][id] = { ...(state[col][id] || {}), ...data };
      writes.push({ op: 'update', path: `${col}/${id}`, data });
    },
    async set(data) {
      state[col] ||= {};
      state[col][id] = { ...(state[col][id] || {}), ...data };
      writes.push({ op: 'set', path: `${col}/${id}`, data });
    },
  });
  const fbDb = {
    collection(name) {
      return {
        doc(id) {
          return makeDocRef(name, id);
        },
        async add() {
          return { id: 'auto_' + Math.random().toString(36).slice(2, 10) };
        },
        where() {
          return {
            async get() {
              const col = state[name] || {};
              const docs = Object.entries(col)
                .map(([id, d]) => ({ id, data: () => d }))
                .filter(({ data }) => data() && data().closedAt == null);
              return {
                forEach(cb) {
                  docs.forEach(cb);
                },
              };
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        update(ref, data) {
          return ref.update(data);
        },
        set(ref, data) {
          return ref.set(data);
        },
      };
      return fn(tx);
    },
  };
  return { fbDb, log: vi.fn(), _state: state };
}

describe('v1575 §prevent-oversign — cap contra fisico libre, no bruto', () => {
  it('OK: fisico 10 sin reservas, Pablo asigna 5u → aplica', async () => {
    const deps = makeDeps({
      sku: 'SKU-A',
      fisicoDep11: 10,
      pedidosExistentes: {},
      ingresoDoc: {
        _fsId: 'ing1',
        sku: 'SKU-A',
        qtyIngresada: 10,
        status: 'pending',
        clientesBO: [{ pedidoId: 'pA', lineIndex: 0, clientCardCode: 'C1', qtyBackorder: 5 }],
        qtyBackorderTotal: 5,
        clientesCount: 1,
      },
      pedidoBO: {
        _fsId: 'pA',
        closedAt: null,
        clientCardCode: 'C1',
        lines: [{ code: 'SKU-A', state: 'BO', qty: 5, qtyOpen: 5 }],
      },
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ing1',
      assignments: [{ pedidoId: 'pA', lineIndex: 0, qtyAsignada: 5 }],
      eliminations: [],
    });
    expect(r.ok).toBe(true);
    expect(r.applied).toHaveLength(1);
  });

  it('BLOQUEA: fisico 4 pero hay 3 ASIG vivas, Pablo intenta asignar 4 → rechaza', async () => {
    const deps = makeDeps({
      sku: 'SKU-B',
      fisicoDep11: 4,
      pedidosExistentes: {
        // Pedido vivo con 3u ASIG del mismo SKU (consume físico).
        pLegacy: {
          _fsId: 'pLegacy',
          closedAt: null,
          clientCardCode: 'C999',
          lines: [
            {
              code: 'SKU-B',
              state: 'ASIG',
              qty: 3,
              qtyOpen: 3,
              asigAt: new Date().toISOString(),
            },
          ],
        },
      },
      ingresoDoc: {
        _fsId: 'ing2',
        sku: 'SKU-B',
        qtyIngresada: 4,
        status: 'pending',
        clientesBO: [{ pedidoId: 'pNew', lineIndex: 0, clientCardCode: 'C2', qtyBackorder: 4 }],
        qtyBackorderTotal: 4,
        clientesCount: 1,
      },
      pedidoBO: {
        _fsId: 'pNew',
        closedAt: null,
        clientCardCode: 'C2',
        lines: [{ code: 'SKU-B', state: 'BO', qty: 4, qtyOpen: 4 }],
      },
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ing2',
      assignments: [{ pedidoId: 'pNew', lineIndex: 0, qtyAsignada: 4 }],
      eliminations: [],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/stock fisico LIBRE/i);
    expect(r.errors.join(' ')).toMatch(/ya reservado/i);
    // Importante: NO se aplico nada.
    expect(r.applied || []).toHaveLength(0);
  });

  it('BLOQUEA: fisico 6 pero hay 4 confirmed sin SO SAP, Pablo intenta asignar 3 → rechaza', async () => {
    // confirmed SIN orderDocEntry reserva en app (§40.8) — restante libre = 2.
    const now = new Date();
    const deps = makeDeps({
      sku: 'SKU-C',
      fisicoDep11: 6,
      pedidosExistentes: {
        pConf: {
          _fsId: 'pConf',
          closedAt: null,
          clientCardCode: 'C999',
          confirmedAt: now.toISOString(),
          // sin transferidoSAP.orderDocEntry → reserva en app.
          transferidoSAP: {},
          lines: [{ code: 'SKU-C', state: 'confirmed', qty: 4, qtyOpen: 4 }],
        },
      },
      ingresoDoc: {
        _fsId: 'ing3',
        sku: 'SKU-C',
        qtyIngresada: 6,
        status: 'pending',
        clientesBO: [{ pedidoId: 'pNew', lineIndex: 0, clientCardCode: 'C2', qtyBackorder: 3 }],
        qtyBackorderTotal: 3,
        clientesCount: 1,
      },
      pedidoBO: {
        _fsId: 'pNew',
        closedAt: null,
        clientCardCode: 'C2',
        lines: [{ code: 'SKU-C', state: 'BO', qty: 3, qtyOpen: 3 }],
      },
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ing3',
      assignments: [{ pedidoId: 'pNew', lineIndex: 0, qtyAsignada: 3 }],
      eliminations: [],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/stock fisico LIBRE/i);
  });

  it('OK: confirmed CON orderDocEntry (SAP descuenta por §40.8) → no cuenta como reserva', async () => {
    // Con SO SAP, la línea NO reserva en app — Pablo puede repartir el físico.
    const now = new Date();
    const deps = makeDeps({
      sku: 'SKU-D',
      fisicoDep11: 5,
      pedidosExistentes: {
        pSAP: {
          _fsId: 'pSAP',
          closedAt: null,
          clientCardCode: 'C999',
          confirmedAt: now.toISOString(),
          transferidoSAP: { orderDocEntry: 12345 },
          lines: [{ code: 'SKU-D', state: 'confirmed', qty: 2, qtyOpen: 2 }],
        },
      },
      ingresoDoc: {
        _fsId: 'ing4',
        sku: 'SKU-D',
        qtyIngresada: 5,
        status: 'pending',
        clientesBO: [{ pedidoId: 'pNew', lineIndex: 0, clientCardCode: 'C2', qtyBackorder: 5 }],
        qtyBackorderTotal: 5,
        clientesCount: 1,
      },
      pedidoBO: {
        _fsId: 'pNew',
        closedAt: null,
        clientCardCode: 'C2',
        lines: [{ code: 'SKU-D', state: 'BO', qty: 5, qtyOpen: 5 }],
      },
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ing4',
      assignments: [{ pedidoId: 'pNew', lineIndex: 0, qtyAsignada: 5 }],
      eliminations: [],
    });
    expect(r.ok).toBe(true);
  });

  it('BLOQUEA: repro caso CLC66H2PY — fisico 4, 10u confirmed con SO + 4u sin SO, Pablo intenta repartir 2 → rechaza', async () => {
    // Caso focal del reporte Mariano 2026-11-25:
    //   fisico 4, confirmedConSO=8, confirmedSinSO=4 → reservadasTotal=4 (cap §40.2),
    //   libre=0. Pablo no debería poder repartir ninguna unidad adicional.
    const now = new Date();
    const deps = makeDeps({
      sku: 'CLC66H2PY',
      fisicoDep11: 4,
      pedidosExistentes: {
        pSAP: {
          _fsId: 'pSAP',
          closedAt: null,
          clientCardCode: 'C-ARIZAGA',
          confirmedAt: now.toISOString(),
          transferidoSAP: { orderDocEntry: 39310 },
          lines: [{ code: 'CLC66H2PY', state: 'confirmed', qty: 8, qtyOpen: 8 }],
        },
        pCot: {
          _fsId: 'pCot',
          closedAt: null,
          clientCardCode: 'C-ANGLER',
          confirmedAt: now.toISOString(),
          transferidoSAP: { docNum: 2000628 }, // solo Cot, sin orderDocEntry
          lines: [{ code: 'CLC66H2PY', state: 'confirmed', qty: 4, qtyOpen: 4 }],
        },
      },
      ingresoDoc: {
        _fsId: 'ingNew',
        sku: 'CLC66H2PY',
        qtyIngresada: 2,
        status: 'pending',
        clientesBO: [
          { pedidoId: 'pFerracioli', lineIndex: 0, clientCardCode: 'C-FERRA', qtyBackorder: 2 },
        ],
        qtyBackorderTotal: 2,
        clientesCount: 1,
      },
      pedidoBO: {
        _fsId: 'pFerracioli',
        closedAt: null,
        clientCardCode: 'C-FERRA',
        lines: [{ code: 'CLC66H2PY', state: 'BO', qty: 2, qtyOpen: 2 }],
      },
    });
    const r = await applyRepartoManualCore(deps, {
      ingresoId: 'ingNew',
      assignments: [{ pedidoId: 'pFerracioli', lineIndex: 0, qtyAsignada: 2 }],
      eliminations: [],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/stock fisico LIBRE/i);
  });
});
