import { describe, expect, it, vi } from 'vitest';
import {
  applyRepartoManualCore,
  createIngresosRepartoFromDelta,
  detectDep11Increases,
  extractClientesBOForSku,
  validateRepartoPayload,
} from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-14T15:00:00Z');
const nowIso = NOW.toISOString();

const _snap = (whs) => ({
  warehouseBreakdown: JSON.stringify(whs),
});

const _pedidoDoc = (id, data) => ({
  id,
  data: () => data,
});

function makeFakeFbDb(initial = {}) {
  const store = {
    pedidos: initial.pedidos || [], // array de {id, data}
    ingresos_reparto: initial.ingresos_reparto || {}, // {id: data}
    reparto_log: [],
    // v1309: app_config/stock_snapshot para cap stock fisico en applyRepartoManualCore.
    // Formato: { sku: { 11: qty, 12: qty, ... }, ... }. Default: cada SKU con stock
    // 1e9 (sin cap efectivo) para no romper tests existentes.
    stockWhs: initial.stockWhs || null,
  };
  const writes = [];
  return {
    _store: store,
    _writes: writes,
    collection(name) {
      return {
        where(/* field, op, value */) {
          // Dos usos:
          //  (a) ingresos_reparto dedupe query → .limit().get() → empty.
          //  (b) pedidos closedAt==null → .get() con forEach.
          const q = {
            _name: name,
            where() {
              return this;
            },
            limit() {
              return this;
            },
            async get() {
              if (this._name === 'pedidos') {
                return {
                  empty: store.pedidos.length === 0,
                  forEach(cb) {
                    for (const p of store.pedidos) cb(p);
                  },
                };
              }
              return { empty: true, forEach: () => {} };
            },
          };
          return q;
        },
        async get() {
          if (name === 'pedidos') {
            return {
              forEach(cb) {
                for (const p of store.pedidos) cb(p);
              },
            };
          }
          return { forEach: () => {} };
        },
        doc(id) {
          return {
            id,
            async get() {
              if (name === 'ingresos_reparto') {
                const data = store.ingresos_reparto[id];
                return { exists: !!data, data: () => data };
              }
              if (name === 'pedidos') {
                const p = store.pedidos.find((pp) => pp.id === id);
                return { exists: !!p, data: () => (p ? p.data() : {}) };
              }
              if (name === 'app_config' && id === 'stock_snapshot') {
                // v1309: devolver warehouseBreakdown mockeado. Default: stock
                // infinito por SKU para no romper tests que no setean stockWhs.
                const wbs = store.stockWhs || new Proxy({}, { get: () => ({ 11: 1e9 }) });
                return { exists: true, data: () => ({ warehouseBreakdown: wbs }) };
              }
              return { exists: false, data: () => ({}) };
            },
            async update(patch) {
              writes.push({ type: 'update', name, id, patch });
              if (name === 'ingresos_reparto' && store.ingresos_reparto[id]) {
                store.ingresos_reparto[id] = Object.assign({}, store.ingresos_reparto[id], patch);
              }
              if (name === 'pedidos') {
                const p = store.pedidos.find((pp) => pp.id === id);
                if (p) {
                  const data = p.data();
                  p.data = () => Object.assign({}, data, patch);
                }
              }
              return;
            },
          };
        },
        async add(data) {
          writes.push({ type: 'add', name, data });
          const id = 'auto_' + Math.random().toString(36).slice(2, 10);
          if (name === 'ingresos_reparto') store.ingresos_reparto[id] = data;
          if (name === 'reparto_log') store.reparto_log.push({ id, data });
          return { id };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return await ref.get();
        },
        update(ref, patch) {
          // Reuse async update synchronously enough for tests.
          ref.update(patch);
        },
      };
      return await fn(tx);
    },
  };
}

describe('detectDep11Increases', () => {
  it('delta positivo en dep 11 detectado', () => {
    const before = _snap({ FXC: { 11: 20, 12: 0 } });
    const after = _snap({ FXC: { 11: 50, 12: 0 } });
    const d = detectDep11Increases(before, after);
    expect(d.get('FXC')).toBe(30);
  });

  it('delta negativo o cero no se incluye', () => {
    const before = _snap({ FXC: { 11: 50 }, STM: { 11: 10 } });
    const after = _snap({ FXC: { 11: 30 }, STM: { 11: 10 } });
    const d = detectDep11Increases(before, after);
    expect(d.size).toBe(0);
  });

  it('dep 12 que sube pero dep 11 no, no cuenta', () => {
    const before = _snap({ FXC: { 11: 20, 12: 0 } });
    const after = _snap({ FXC: { 11: 20, 12: 100 } });
    const d = detectDep11Increases(before, after);
    expect(d.size).toBe(0);
  });

  it('acepta warehouseBreakdown como objeto (no solo JSON string)', () => {
    const before = { warehouseBreakdown: { FXC: { 11: 20 } } };
    const after = { warehouseBreakdown: { FXC: { 11: 25 } } };
    const d = detectDep11Increases(before, after);
    expect(d.get('FXC')).toBe(5);
  });

  it('warehouseBreakdown JSON malformado → vacio sin error', () => {
    const before = { warehouseBreakdown: 'garbage not json' };
    const after = _snap({ FXC: { 11: 50 } });
    const d = detectDep11Increases(before, after);
    expect(d.get('FXC')).toBe(50);
  });
});

describe('extractClientesBOForSku', () => {
  const p = _pedidoDoc('p1', {
    clientName: 'CLIENTE A',
    clientCardCode: 'C-A',
    province: 'BA',
    locName: 'CABA',
    createdAt: '2026-09-01T10:00:00Z',
    lines: [
      { code: 'FXC', state: 'BO', qtyOpen: 10 },
      { code: 'FXC', state: 'ASIG', qtyOpen: 5 }, // excluir
      { code: 'OTHER', state: 'BO', qtyOpen: 20 }, // excluir
      { code: 'FXC', state: 'BO', qtyOpen: 0 }, // qtyOpen=0 excluir
    ],
  });
  const q = _pedidoDoc('p2', {
    clientName: 'CLIENTE B',
    clientCardCode: 'C-B',
    createdAt: '2026-08-01T10:00:00Z',
    lines: [{ code: 'FXC', state: 'BO', qtyOpen: 15 }],
  });

  it('solo state=BO + qtyOpen>0 + sku matching', () => {
    const r = extractClientesBOForSku([p, q], 'FXC');
    expect(r).toHaveLength(2);
    const [first, second] = r;
    // Orden FIFO por createdAt (p2 is older)
    expect(first.clientName).toBe('CLIENTE B');
    expect(first.qtyBackorder).toBe(15);
    expect(first.lineIndex).toBe(0);
    expect(second.clientName).toBe('CLIENTE A');
    expect(second.lineIndex).toBe(0);
  });

  it('sku sin matches → array vacio', () => {
    const r = extractClientesBOForSku([p, q], 'ZZZ');
    expect(r).toEqual([]);
  });

  it('case-insensitive matching del codigo', () => {
    const r = extractClientesBOForSku([p, q], 'fxc');
    expect(r).toHaveLength(2);
  });
});

describe('validateRepartoPayload', () => {
  const ingreso = {
    sku: 'FXC',
    qtyIngresada: 50,
    status: 'pending',
    qtyBackorderTotal: 100,
    clientesCount: 2,
    clientesBO: [
      { pedidoId: 'p1', lineIndex: 0, qtyBackorder: 60, clientName: 'A' },
      { pedidoId: 'p2', lineIndex: 1, qtyBackorder: 40, clientName: 'B' },
    ],
    detectedAt: nowIso,
    appliedAt: null,
    appliedBy: null,
    assignments: null,
  };

  it('happy path: dos assignments validos sum == qtyIngresada', () => {
    const r = validateRepartoPayload(ingreso, [
      { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 30 },
      { pedidoId: 'p2', lineIndex: 1, qtyAsignada: 20 },
    ]);
    expect(r.valid).toBe(true);
  });

  it('v1309: validateRepartoPayload YA NO rechaza por qtyIngresada (cap vs stock fisico se valida en apply)', () => {
    const r = validateRepartoPayload(ingreso, [
      { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 40 },
      { pedidoId: 'p2', lineIndex: 1, qtyAsignada: 40 },
    ]);
    expect(r.valid).toBe(true);
    expect(r.sumAsignada).toBe(80);
  });

  it('v1338: ACEPTA qtyAsignada > qtyBackorder del cliente (sobre-asignacion permitida de nuevo)', () => {
    // p2 tiene qtyBackorder=40. Asignar 50 > 40 ahora es VALIDO (v1338 revierte v1312).
    const r = validateRepartoPayload(ingreso, [{ pedidoId: 'p2', lineIndex: 1, qtyAsignada: 50 }]);
    expect(r.valid).toBe(true);
  });

  it('v1312: acepta eliminations ademas de assignments', () => {
    const r = validateRepartoPayload(
      ingreso,
      [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 20 }],
      [{ pedidoId: 'p2', lineIndex: 1, qtyEliminar: 15 }]
    );
    expect(r.valid).toBe(true);
    expect(r.sumAsignada).toBe(20);
    expect(r.sumEliminada).toBe(15);
  });

  it('v1312: acepta solo eliminations (sin assignments)', () => {
    const r = validateRepartoPayload(
      ingreso,
      [],
      [{ pedidoId: 'p1', lineIndex: 0, qtyEliminar: 30 }]
    );
    expect(r.valid).toBe(true);
    expect(r.sumEliminada).toBe(30);
  });

  it('v1312: rechaza payload sin assignments NI eliminations', () => {
    const r = validateRepartoPayload(ingreso, [], []);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('vacio'))).toBe(true);
  });

  it('v1338: ACEPTA asig+elim > qtyBackorder del cliente (sobre-asignacion permitida)', () => {
    // p1 qtyBackorder=60. Asignar 50 + eliminar 20 = 70 > 60 ahora es VALIDO.
    const r = validateRepartoPayload(
      ingreso,
      [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 50 }],
      [{ pedidoId: 'p1', lineIndex: 0, qtyEliminar: 20 }]
    );
    expect(r.valid).toBe(true);
  });

  // v1343 (2026-10-15) removió la validación "assignment debe estar en boMap"
  // porque `clientesBO` es un snapshot stale al momento de crear el ingreso.
  // La validación real (line.state='BO' + line.code===sku + qtyOpen>0) ocurre
  // ahora dentro del `runTransaction` de applyRepartoManualCore (ver core
  // línea 616-622). El test anterior ("rechaza assignment que no matchea con
  // ningun cliente BO") quedó obsoleto porque validateRepartoPayload YA NO
  // rechaza eso — delega al transaction. Borrado 2026-10-21.
  it('acepta assignment con pedidoId no presente en clientesBO snapshot (validación delegada a transaction v1343)', () => {
    const r = validateRepartoPayload(ingreso, [{ pedidoId: 'pZ', lineIndex: 9, qtyAsignada: 5 }]);
    expect(r.valid).toBe(true);
  });

  it('rechaza qtyAsignada <= 0', () => {
    const r = validateRepartoPayload(ingreso, [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 0 }]);
    expect(r.valid).toBe(false);
  });

  it('rechaza status != pending', () => {
    const r = validateRepartoPayload(Object.assign({}, ingreso, { status: 'done' }), [
      { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 10 },
    ]);
    expect(r.valid).toBe(false);
  });

  it('acepta sub-reparto (sum < qtyIngresada: sobra queda libre)', () => {
    const r = validateRepartoPayload(ingreso, [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 10 }]);
    expect(r.valid).toBe(true);
  });
});

describe('createIngresosRepartoFromDelta', () => {
  it('crea 1 doc por SKU con delta positivo + clientes BO', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        _pedidoDoc('p1', {
          clientName: 'A',
          clientCardCode: 'C-A',
          createdAt: '2026-09-01T10:00:00Z',
          lines: [{ code: 'FXC', state: 'BO', qtyOpen: 20 }],
        }),
      ],
    });
    const before = _snap({ FXC: { 11: 10 } });
    const after = _snap({ FXC: { 11: 35 } });
    const r = await createIngresosRepartoFromDelta(
      { fbDb, log: vi.fn(), now: () => NOW },
      before,
      after
    );
    expect(r.created).toHaveLength(1);
    expect(r.errors).toEqual([]);
    expect(Object.values(fbDb._store.ingresos_reparto)).toHaveLength(1);
    const doc = Object.values(fbDb._store.ingresos_reparto)[0];
    expect(doc.sku).toBe('FXC');
    expect(doc.qtyIngresada).toBe(25);
    expect(doc.clientesCount).toBe(1);
    expect(doc.qtyBackorderTotal).toBe(20);
    expect(doc.status).toBe('pending');
    expect(doc.dedupeKey).toBe('FXC|35');
  });

  it('skippea SKU con delta positivo pero sin clientes BO', async () => {
    const fbDb = makeFakeFbDb({ pedidos: [] });
    const before = _snap({ FXC: { 11: 0 } });
    const after = _snap({ FXC: { 11: 50 } });
    const r = await createIngresosRepartoFromDelta(
      { fbDb, log: vi.fn(), now: () => NOW },
      before,
      after
    );
    expect(r.created).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].sku).toBe('FXC');
    expect(r.skipped[0].reason).toContain('sin clientes BO');
  });

  it('no crea doc si no hay deltas (empty)', async () => {
    const fbDb = makeFakeFbDb();
    const before = _snap({ FXC: { 11: 50 } });
    const after = _snap({ FXC: { 11: 50 } });
    const r = await createIngresosRepartoFromDelta(
      { fbDb, log: vi.fn(), now: () => NOW },
      before,
      after
    );
    expect(r.created).toEqual([]);
    expect(r.skipped).toEqual([]);
  });
});

describe('applyRepartoManualCore', () => {
  const makeIngresoFixture = () => ({
    pedidos: [
      _pedidoDoc('p1', {
        clientName: 'A',
        clientCardCode: 'C-A',
        lines: [{ code: 'FXC', state: 'BO', qtyOpen: 30, qty: 30, precio: 1000 }],
      }),
      _pedidoDoc('p2', {
        clientName: 'B',
        clientCardCode: 'C-B',
        lines: [{ code: 'FXC', state: 'BO', qtyOpen: 20, qty: 20, precio: 1000 }],
      }),
    ],
    ingresos_reparto: {
      ing1: {
        sku: 'FXC',
        qtyIngresada: 40,
        status: 'pending',
        clientesBO: [
          { pedidoId: 'p1', lineIndex: 0, qtyBackorder: 30, clientName: 'A' },
          { pedidoId: 'p2', lineIndex: 0, qtyBackorder: 20, clientName: 'B' },
        ],
        qtyBackorderTotal: 50,
        clientesCount: 2,
        detectedAt: nowIso,
        appliedAt: null,
        appliedBy: null,
        assignments: null,
      },
    },
  });

  it('happy path: 2 assignments, 1 parcial 1 total', async () => {
    const fbDb = makeFakeFbDb(makeIngresoFixture());
    const r = await applyRepartoManualCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      {
        ingresoId: 'ing1',
        assignments: [
          { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 20 }, // parcial (de 30)
          { pedidoId: 'p2', lineIndex: 0, qtyAsignada: 20 }, // entera (de 20)
        ],
        appliedByEmail: 'pablo@shimano.com.ar',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.applied).toHaveLength(2);
    // Verificar split en p1: linea 0 bajo a qtyOpen=10 + se agrego nueva ASIG
    const p1 = fbDb._store.pedidos.find((p) => p.id === 'p1').data();
    expect(p1.lines[0].qtyOpen).toBe(10);
    expect(p1.lines[0].state).toBe('BO');
    expect(p1.lines[1].state).toBe('ASIG');
    expect(p1.lines[1].qtyOpen).toBe(20);
    expect(p1.lines[1].asigReserva).toBe(true);
    expect(p1.lines[1].asigFromReparto).toBe('ing1');
    // p2: linea 0 entera ASIG
    const p2 = fbDb._store.pedidos.find((p) => p.id === 'p2').data();
    expect(p2.lines[0].state).toBe('ASIG');
    expect(p2.lines[0].qtyOpen).toBe(20);
    expect(p2.lines).toHaveLength(1); // no split
    // Ingreso marked done
    expect(fbDb._store.ingresos_reparto.ing1.status).toBe('done');
    expect(fbDb._store.ingresos_reparto.ing1.appliedBy).toBe('pablo@shimano.com.ar');
  });

  it('v1309: rechaza sum > stock fisico dep 11 actual antes de tocar pedidos', async () => {
    const fixture = makeIngresoFixture();
    // Setear stock fisico FXC dep 11 = 40 (igual al cap viejo qtyIngresada).
    fixture.stockWhs = { FXC: { 11: 40 } };
    const fbDb = makeFakeFbDb(fixture);
    const r = await applyRepartoManualCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      {
        ingresoId: 'ing1',
        assignments: [
          { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 30 },
          { pedidoId: 'p2', lineIndex: 0, qtyAsignada: 20 }, // sum=50 > 40
        ],
        appliedByEmail: 'pablo@shimano.com.ar',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.applied).toEqual([]);
    expect(r.errors.some((e) => e.includes('sobre-reparto'))).toBe(true);
    // Nada se escribio en pedidos
    const p1 = fbDb._store.pedidos.find((p) => p.id === 'p1').data();
    expect(p1.lines[0].state).toBe('BO');
    expect(p1.lines[0].qtyOpen).toBe(30);
  });

  it('v1309: acepta sum > qtyIngresada si stock fisico actual lo cubre', async () => {
    const fixture = makeIngresoFixture();
    // qtyIngresada=40 pero stock fisico=100 (hay stock viejo acumulado).
    fixture.stockWhs = { FXC: { 11: 100 } };
    const fbDb = makeFakeFbDb(fixture);
    const r = await applyRepartoManualCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      {
        ingresoId: 'ing1',
        assignments: [
          { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 30 },
          { pedidoId: 'p2', lineIndex: 0, qtyAsignada: 20 }, // sum=50 (> qtyIng=40 pero < stock=100)
        ],
        appliedByEmail: 'pablo@shimano.com.ar',
      }
    );
    expect(r.ok).toBe(true);
    expect(r.applied).toHaveLength(2);
  });

  it('rechaza ingreso con status != pending', async () => {
    const fixture = makeIngresoFixture();
    fixture.ingresos_reparto.ing1.status = 'done';
    const fbDb = makeFakeFbDb(fixture);
    const r = await applyRepartoManualCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      {
        ingresoId: 'ing1',
        assignments: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 10 }],
        appliedByEmail: 'pablo@shimano.com.ar',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('ya aplicado'))).toBe(true);
  });

  it('ingresoId no encontrado → error claro', async () => {
    const fbDb = makeFakeFbDb(makeIngresoFixture());
    const r = await applyRepartoManualCore(
      { fbDb, log: vi.fn(), now: () => NOW },
      {
        ingresoId: 'noexiste',
        assignments: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 10 }],
        appliedByEmail: 'pablo@shimano.com.ar',
      }
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('no encontrado');
  });
});
