// @ts-check
/**
 * v1519 §64.3 — reconcileRepartosFaltantes auto-close de ingresos stale.
 *
 * Precedente SATO 2026-10-23: draft_lock creó 2 pedidos SATO que se
 * facturaron/cancelaron antes del reparto. El ingreso para EDUARDO SATO
 * 21100400100E seguía abierto con `clientesBO` apuntando a esas líneas con
 * qtyOpen=0 → al apretar "Aplicar reparto" la CF rechazaba por "linea con
 * qtyOpen=0".
 *
 * Fix v1519: si `boVig <= 0` para un SKU con reparto abierto, auto-close con
 * `closureReason='bo_vigente_cero_auto'`. Idempotente (status='done' no se
 * re-cierra). Batch de hasta 500 ops por invocación.
 */
import { describe, expect, it } from 'vitest';
import { reconcileRepartosFaltantes } from '../../functions/core/reparto-core.js';

const NOW = new Date('2026-10-28T12:00:00Z');
const nowIso = NOW.toISOString();

const _snap = (whs) => ({ warehouseBreakdown: JSON.stringify(whs) });

const pedidoDoc = (id, data) => ({ id, data: () => data });

/**
 * Fake fbDb que soporta:
 *   - collection(name).where('status','in',[...]).get() → forEach callbacks.
 *   - collection(name).where(...)...for pedidos (iterar via forEach también).
 *   - collection(name).add(data) → return {id}
 *   - collection(name).doc(id) → DocumentReference ligero
 *   - fbDb.batch() → batch con update(ref, data) + commit()
 */
function makeFakeFbDb({ pedidos = [], ingresosActivos = [] } = {}) {
  const writes = []; // creates via .add()
  const updates = []; // updates via batch.update() OR doc.update()
  /**
   * @type {Array<{id:string}>}
   */
  const batchesCommitted = [];
  return {
    _writes: writes,
    _updates: updates,
    _batchesCommitted: batchesCommitted,
    collection(name) {
      return {
        _name: name,
        where() {
          return {
            _name: name,
            get: async () => {
              if (name === 'pedidos') {
                return { forEach: (cb) => pedidos.forEach(cb) };
              }
              if (name === 'ingresos_reparto') {
                return { forEach: (cb) => ingresosActivos.forEach(cb) };
              }
              return { forEach: () => {} };
            },
            where() {
              return this;
            },
            limit() {
              return this;
            },
          };
        },
        doc(id) {
          return {
            _collection: name,
            _id: id,
            async update(data) {
              updates.push({ collection: name, id, data, via: 'doc.update' });
              return undefined;
            },
          };
        },
        async add(data) {
          const id = `fake_id_${writes.length + 1}`;
          writes.push({ collection: name, id, data });
          return { id };
        },
      };
    },
    batch() {
      const ops = [];
      return {
        update(ref, data) {
          ops.push({ ref, data });
        },
        set(ref, data) {
          ops.push({ ref, data, kind: 'set' });
        },
        delete(ref) {
          ops.push({ ref, kind: 'delete' });
        },
        async commit() {
          for (const op of ops) {
            updates.push({
              collection: op.ref._collection,
              id: op.ref._id,
              data: op.data,
              via: 'batch.' + (op.kind || 'update'),
            });
          }
          batchesCommitted.push({ opsCount: ops.length });
          return undefined;
        },
      };
    },
  };
}

const deps = (fbDb) => ({ fbDb, now: () => NOW, log: () => {} });

describe('reconcileRepartosFaltantes v1519 §64.3 auto-close', () => {
  // ---------------------------------------------------------------------------
  // T1a: reparto activo con BO vigente > 0 → sin cambio (no auto-close).
  // ---------------------------------------------------------------------------
  it('T1a: reparto activo con BO vigente > 0 → sin cambio', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('pA', {
          clientCardCode: 'CA',
          clientName: 'ANDRILI',
          createdAt: nowIso,
          lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 5 }],
        }),
      ],
      ingresosActivos: [
        {
          id: 'ir_1',
          data: () => ({
            sku: 'STRADIC',
            status: 'pending',
            qtyIngresada: 5,
            clientesBO: [{ clientCardCode: 'CA', qtyBackorder: 5 }],
          }),
        },
      ],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ STRADIC: { 11: 5 } }));
    expect(r.autoCerrados).toEqual([]);
    expect(fbDb._updates).toHaveLength(0);
    // qty del reparto activo = qtyARepartir (5) → reason 'reparto_activo_qty_ok'
    expect(r.skipped.find((s) => s.sku === 'STRADIC')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // T1b: reparto activo con BO vigente = 0 → auto-close con closureReason.
  // Precedente SATO: 2 pedidos facturados/cancelados, qtyOpen=0 en ambos.
  // ---------------------------------------------------------------------------
  it('T1b: reparto activo con BO vigente = 0 → auto-close (caso SATO)', async () => {
    const sato1 = {
      pedidoId: '6LhigQdzUmEcOHcRUEjl',
      lineIndex: 5,
      clientCardCode: 'C-SATO',
      clientName: 'EDUARDO SATO',
      qtyBackorder: 2,
    };
    const sato2 = {
      pedidoId: 'qlB4FpI3R9Rhu5sLZvbf',
      lineIndex: 5,
      clientCardCode: 'C-SATO',
      clientName: 'EDUARDO SATO',
      qtyBackorder: 2,
    };
    const fbDb = makeFakeFbDb({
      pedidos: [
        // Los 2 pedidos SATO ya facturados/cancelados: qtyOpen=0.
        pedidoDoc('6LhigQdzUmEcOHcRUEjl', {
          clientCardCode: 'C-SATO',
          clientName: 'EDUARDO SATO',
          createdAt: nowIso,
          lines: [
            { code: 'OTRO', state: 'confirmed', qtyOpen: 0 },
            { code: 'OTRO2', state: 'BO', qtyOpen: 0 },
            { code: 'OTRO3', state: 'confirmed', qtyOpen: 0 },
            { code: 'OTRO4', state: 'confirmed', qtyOpen: 0 },
            { code: 'OTRO5', state: 'confirmed', qtyOpen: 0 },
            // Index 5: SATO SKU, qtyOpen=0 (ya facturado o cancelado).
            { code: '21100400100E', state: 'BO', qtyOpen: 0 },
          ],
        }),
        pedidoDoc('qlB4FpI3R9Rhu5sLZvbf', {
          clientCardCode: 'C-SATO',
          clientName: 'EDUARDO SATO',
          createdAt: nowIso,
          lines: [
            { code: 'OTRO', state: 'confirmed', qtyOpen: 0 },
            { code: 'OTRO2', state: 'BO', qtyOpen: 0 },
            { code: 'OTRO3', state: 'confirmed', qtyOpen: 0 },
            { code: 'OTRO4', state: 'confirmed', qtyOpen: 0 },
            { code: 'OTRO5', state: 'confirmed', qtyOpen: 0 },
            { code: '21100400100E', state: 'BO', qtyOpen: 0 },
          ],
        }),
      ],
      ingresosActivos: [
        {
          id: 'ir_sato_stale',
          data: () => ({
            sku: '21100400100E',
            status: 'pending',
            qtyIngresada: 4,
            clientesBO: [sato1, sato2],
          }),
        },
      ],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ '21100400100E': { 11: 4 } }));
    expect(r.autoCerrados).toEqual(['ir_sato_stale']);
    expect(fbDb._updates).toHaveLength(1);
    const upd = fbDb._updates[0];
    expect(upd.collection).toBe('ingresos_reparto');
    expect(upd.id).toBe('ir_sato_stale');
    expect(upd.via).toBe('batch.update');
    expect(upd.data.status).toBe('done');
    expect(upd.data.appliedAt).toBe(nowIso);
    expect(upd.data.appliedBy).toBe('system:reconcileRepartosFaltantes');
    expect(upd.data.closureReason).toBe('bo_vigente_cero_auto');
    expect(upd.data._autoClose).toBeDefined();
    expect(upd.data._autoClose.at).toBe(nowIso);
    expect(upd.data._autoClose.reason).toBe('bo_vigente_cero_detected_in_reconcile');
    expect(upd.data._autoClose.previousValues).toBeDefined();
    expect(upd.data._autoClose.previousValues.status).toBe('pending');
    expect(upd.data._autoClose.previousValues.clientesBO).toEqual([sato1, sato2]);
    expect(fbDb._batchesCommitted).toHaveLength(1);
    expect(fbDb._batchesCommitted[0].opsCount).toBe(1);
    expect(r.created).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T1c: reparto status='done' → NO se re-cierra (idempotente).
  // ---------------------------------------------------------------------------
  it('T1c: reparto status=done → no re-cierra (idempotente)', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('pA', {
          clientCardCode: 'CA',
          clientName: 'DONE',
          createdAt: nowIso,
          lines: [{ code: 'DONESKU', state: 'BO', qtyOpen: 0 }],
        }),
      ],
      // Status='done' NO coincide con el where('in',['pending','in_progress'])
      // en prod, pero el test lo expone intencionalmente para verificar que
      // SI se expone, el core lo ignora (defensive idempotency).
      ingresosActivos: [
        {
          id: 'ir_already_done',
          data: () => ({
            sku: 'DONESKU',
            status: 'done',
            qtyIngresada: 5,
            clientesBO: [],
          }),
        },
      ],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ DONESKU: { 11: 5 } }));
    expect(r.autoCerrados).toEqual([]);
    expect(fbDb._updates).toHaveLength(0);
    expect(r.skipped.find((s) => s.sku === 'DONESKU')).toEqual({
      sku: 'DONESKU',
      reason: 'ya_cerrado',
    });
  });

  // ---------------------------------------------------------------------------
  // T1d: 3 ingresos simultáneos a cerrar → batch de 3 ops en 1 solo commit.
  // ---------------------------------------------------------------------------
  it('T1d: 3 ingresos simultáneos → 1 batch con 3 ops', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        // SKU-A: pedido con qtyOpen=0 (ya facturado).
        pedidoDoc('pA', {
          clientCardCode: 'C-A',
          clientName: 'A',
          createdAt: nowIso,
          lines: [{ code: 'SKU-A', state: 'BO', qtyOpen: 0 }],
        }),
        // SKU-B: pedido con qtyOpen=0.
        pedidoDoc('pB', {
          clientCardCode: 'C-B',
          clientName: 'B',
          createdAt: nowIso,
          lines: [{ code: 'SKU-B', state: 'BO', qtyOpen: 0 }],
        }),
        // SKU-C: pedido con qtyOpen=0.
        pedidoDoc('pC', {
          clientCardCode: 'C-C',
          clientName: 'C',
          createdAt: nowIso,
          lines: [{ code: 'SKU-C', state: 'BO', qtyOpen: 0 }],
        }),
      ],
      ingresosActivos: [
        { id: 'ir_a', data: () => ({ sku: 'SKU-A', status: 'pending', clientesBO: [] }) },
        { id: 'ir_b', data: () => ({ sku: 'SKU-B', status: 'in_progress', clientesBO: [] }) },
        { id: 'ir_c', data: () => ({ sku: 'SKU-C', status: 'pending', clientesBO: [] }) },
      ],
    });
    const r = await reconcileRepartosFaltantes(
      deps(fbDb),
      _snap({ 'SKU-A': { 11: 1 }, 'SKU-B': { 11: 1 }, 'SKU-C': { 11: 1 } })
    );
    expect(r.autoCerrados.sort()).toEqual(['ir_a', 'ir_b', 'ir_c']);
    expect(fbDb._batchesCommitted).toHaveLength(1);
    expect(fbDb._batchesCommitted[0].opsCount).toBe(3);
    expect(fbDb._updates).toHaveLength(3);
    // Verify preservedStatus is correct per each.
    const byId = Object.fromEntries(fbDb._updates.map((u) => [u.id, u.data]));
    expect(byId.ir_a._autoClose.previousValues.status).toBe('pending');
    expect(byId.ir_b._autoClose.previousValues.status).toBe('in_progress');
    expect(byId.ir_c._autoClose.previousValues.status).toBe('pending');
  });

  // ---------------------------------------------------------------------------
  // T1e: SKU con fisico=0 → no auto-close aunque haya reparto abierto
  //      (fisico=0 → continue early; no entra al breakdown).
  // ---------------------------------------------------------------------------
  it('T1e: fisico=0 → NO auto-close (continue early en fisico<=0)', async () => {
    const fbDb = makeFakeFbDb({
      pedidos: [
        pedidoDoc('p0', {
          clientCardCode: 'C-0',
          clientName: 'ZERO',
          createdAt: nowIso,
          lines: [{ code: 'SKU-0', state: 'BO', qtyOpen: 0 }],
        }),
      ],
      ingresosActivos: [
        { id: 'ir_zero', data: () => ({ sku: 'SKU-0', status: 'pending', clientesBO: [] }) },
      ],
    });
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({ 'SKU-0': { 11: 0 } }));
    expect(r.autoCerrados).toEqual([]);
    expect(fbDb._updates).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // T1f: return shape incluye `autoCerrados`.
  // ---------------------------------------------------------------------------
  it('T1f: return shape incluye autoCerrados[] siempre (aun vacío)', async () => {
    const fbDb = makeFakeFbDb();
    const r = await reconcileRepartosFaltantes(deps(fbDb), _snap({}));
    expect(r).toHaveProperty('created');
    expect(r).toHaveProperty('skipped');
    expect(r).toHaveProperty('errors');
    expect(r).toHaveProperty('autoCerrados');
    expect(Array.isArray(r.autoCerrados)).toBe(true);
  });
});
