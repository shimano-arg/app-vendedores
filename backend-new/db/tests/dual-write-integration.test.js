/**
 * Integration tests para el wiring dual-write Firestore → PG
 * (Stack S-12 Phase 2, ADR-0016).
 *
 * Corre contra Postgres real (staging via Cloud SQL proxy en 127.0.0.1:5433).
 * Si no hay DATABASE_URL, se saltea.
 *
 * Mockeamos solo Firestore `fbDb` (para dual_write_pending) — PG es real.
 *
 * Correr con:
 *   DATABASE_URL="postgresql://crm_app:$PG_PASSWORD@127.0.0.1:5433/crm" \
 *     npx vitest run db/tests/dual-write-integration.test.js
 */
import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
  describeIfDb, ensureSchemaApplied, getPool, hasDb, seedFixture,
} from './setup.js';
import {
  replicatePedidoToPg,
} from '../../../functions/core/dual-write-pg.js';

/**
 * Mock Firestore minimal — solo soporta lo que dual-write-pg necesita:
 *   - fbDb.doc('app_config/feature_flags').get() → flags.
 *   - fbDb.collection('dual_write_pending').doc(id).set(...).
 */
function makeMockFbDb(flags) {
  const pendingWrites = [];
  return {
    pendingWrites,
    doc(path) {
      return {
        async get() {
          if (path === 'app_config/feature_flags') {
            return {
              exists: !!flags,
              data: () => flags || null,
            };
          }
          return { exists: false, data: () => null };
        },
      };
    },
    collection(colName) {
      return {
        doc(docId) {
          return {
            async set(data, mergeOpts) {
              pendingWrites.push({ colName, docId, data, merge: mergeOpts });
            },
          };
        },
      };
    },
  };
}

/**
 * Pedido Firestore fixture para integration.
 *
 * Nota: usamos el cardCode fijo 'C001' + vendorUid 'vendedor-01' que ya viven
 * en seedFixture (si se agrega). Pero el schema no exige FKs a esas entidades,
 * así que podemos usar cualquier string.
 */
function makePedidoDoc(overrides = {}) {
  const nowIso = new Date().toISOString();
  return {
    _fsId: 'pg-dual-write-test-001',
    orderNumber: 100001,
    clientCardCode: 'C001',
    clientName: 'cliente A',
    assignedVendorUid: 'vendedor-01',
    vendorAssigned: 'VENDEDOR 01',
    ownerUid: 'vendedor-01',
    cargadoPorUid: 'vendedor-01',
    origen: 'manual',
    draftId: 'draft-pg-001',
    transferidoSAP: {},
    createdAt: nowIso,
    updatedAt: nowIso,
    closedAt: null,
    lines: [
      {
        code: 'SKU-AAA-001',
        state: 'ASIG',
        qty: 3,
        qtyOpen: 3,
        qtyCancelled: 0,
        price: 1500,
        asigAt: nowIso,
      },
      {
        code: 'SKU-BBB-002',
        state: 'BO',
        qty: 2,
        qtyOpen: 2,
        qtyCancelled: 0,
        price: 2000,
      },
    ],
    ...overrides,
  };
}

describeIfDb('dual-write — integration contra PG real', () => {
  let pgPool;

  beforeAll(async () => {
    await ensureSchemaApplied();
    pgPool = getPool();
  });

  beforeEach(async () => {
    const client = await pgPool.connect();
    try {
      await client.query(
        'TRUNCATE pedido_lines, pedidos, stock_reservations, stock_snapshot, pedido_draft_locks, ingresos_reparto, revision_waitlist RESTART IDENTITY CASCADE'
      );
      await seedFixture(client);
    } finally {
      client.release();
    }
  });

  it.skipIf(!hasDb)('T1: happy path alta con 2 lineas (1 ASIG, 1 BO)', async () => {
    const fbDb = makeMockFbDb({ dual_write_pedidos_enabled: true });
    const res = await replicatePedidoToPg(
      { pgPool, fbDb, log: () => {} },
      'pg-dual-write-test-001',
      makePedidoDoc()
    );
    expect(res.ok).toBe(true);
    // Verificar cabecera.
    const pedido = await pgPool.query('SELECT * FROM pedidos WHERE id = $1', [
      'pg-dual-write-test-001',
    ]);
    expect(pedido.rows).toHaveLength(1);
    expect(pedido.rows[0].order_number).toBe(100001);
    expect(pedido.rows[0].origen).toBe('manual');
    // Verificar lineas.
    const lines = await pgPool.query(
      'SELECT sku, state, qty, qty_open FROM pedido_lines WHERE pedido_id = $1 ORDER BY line_index',
      ['pg-dual-write-test-001']
    );
    expect(lines.rows).toHaveLength(2);
    expect(lines.rows[0].sku).toBe('SKU-AAA-001');
    expect(lines.rows[0].state).toBe('ASIG');
    expect(lines.rows[0].qty).toBe(3);
    expect(lines.rows[1].sku).toBe('SKU-BBB-002');
    expect(lines.rows[1].state).toBe('BO');
    // Verificar stock_reservations (trigger PG) — solo ASIG reserva.
    const reservations = await pgPool.query(
      'SELECT sku, warehouse, qty, state FROM stock_reservations WHERE pedido_id = $1',
      ['pg-dual-write-test-001']
    );
    expect(reservations.rows).toHaveLength(1);
    expect(reservations.rows[0].sku).toBe('SKU-AAA-001');
    expect(reservations.rows[0].warehouse).toBe('dep_11');
    expect(reservations.rows[0].qty).toBe(3);
    expect(reservations.rows[0].state).toBe('ASIG');
    // No se encola en dual_write_pending.
    expect(fbDb.pendingWrites).toHaveLength(0);
  });

  it.skipIf(!hasDb)('T2: modificacion (linea 0 pasa a confirmed) refleja el cambio', async () => {
    const fbDb = makeMockFbDb({ dual_write_pedidos_enabled: true });

    // Primera escritura: estado ASIG.
    const doc1 = makePedidoDoc();
    const r1 = await replicatePedidoToPg(
      { pgPool, fbDb, log: () => {} },
      'pg-dual-write-test-001',
      doc1
    );
    expect(r1.ok).toBe(true);

    // Segunda escritura: linea 0 ahora es confirmed sin asigAt (just confirmedAt).
    const doc2 = makePedidoDoc();
    doc2.lines[0] = {
      ...doc2.lines[0],
      state: 'confirmed',
      confirmedAt: new Date().toISOString(),
      asigAt: null,
    };
    const r2 = await replicatePedidoToPg(
      { pgPool, fbDb, log: () => {} },
      'pg-dual-write-test-001',
      doc2
    );
    expect(r2.ok).toBe(true);

    // Verificar estado final.
    const lines = await pgPool.query(
      'SELECT sku, state FROM pedido_lines WHERE pedido_id = $1 ORDER BY line_index',
      ['pg-dual-write-test-001']
    );
    expect(lines.rows).toHaveLength(2);
    expect(lines.rows[0].state).toBe('confirmed');
    expect(lines.rows[1].state).toBe('BO');

    // Reservations debe tener 1 fila (confirmed sin orderDocEntry reserva).
    const reservations = await pgPool.query(
      'SELECT sku, state FROM stock_reservations WHERE pedido_id = $1',
      ['pg-dual-write-test-001']
    );
    expect(reservations.rows).toHaveLength(1);
    expect(reservations.rows[0].state).toBe('confirmed');
  });

  it.skipIf(!hasDb)('T3: cancelacion completa (lines=[]) vacia stock_reservations', async () => {
    const fbDb = makeMockFbDb({ dual_write_pedidos_enabled: true });

    // Alta inicial.
    await replicatePedidoToPg(
      { pgPool, fbDb, log: () => {} },
      'pg-dual-write-test-001',
      makePedidoDoc()
    );

    // Cancelacion total.
    const cancelado = makePedidoDoc({
      closedAt: new Date().toISOString(),
      closedReason: 'cancelado_cliente',
      closedBy: 'uid_pablo',
      lines: [],
    });
    const r = await replicatePedidoToPg(
      { pgPool, fbDb, log: () => {} },
      'pg-dual-write-test-001',
      cancelado
    );
    expect(r.ok).toBe(true);

    // El pedido existe sin lineas.
    const pedido = await pgPool.query(
      'SELECT closed_at, closed_reason FROM pedidos WHERE id = $1',
      ['pg-dual-write-test-001']
    );
    expect(pedido.rows).toHaveLength(1);
    expect(pedido.rows[0].closed_reason).toBe('cancelado_cliente');

    const lines = await pgPool.query(
      'SELECT COUNT(*)::INT AS n FROM pedido_lines WHERE pedido_id = $1',
      ['pg-dual-write-test-001']
    );
    expect(lines.rows[0].n).toBe(0);

    const reservations = await pgPool.query(
      'SELECT COUNT(*)::INT AS n FROM stock_reservations WHERE pedido_id = $1',
      ['pg-dual-write-test-001']
    );
    expect(reservations.rows[0].n).toBe(0);
  });

  it.skipIf(!hasDb)('T4: reintento idempotente (mismo pedidoId 2 veces) → mismo resultado', async () => {
    const fbDb = makeMockFbDb({ dual_write_pedidos_enabled: true });
    const deps = { pgPool, fbDb, log: () => {} };
    const doc = makePedidoDoc();

    await replicatePedidoToPg(deps, 'pg-dual-write-test-001', doc);
    await replicatePedidoToPg(deps, 'pg-dual-write-test-001', doc);

    // Solo 1 fila en pedidos (no duplicado).
    const pedidos = await pgPool.query(
      'SELECT COUNT(*)::INT AS n FROM pedidos WHERE id = $1',
      ['pg-dual-write-test-001']
    );
    expect(pedidos.rows[0].n).toBe(1);

    // Solo 2 lineas.
    const lines = await pgPool.query(
      'SELECT COUNT(*)::INT AS n FROM pedido_lines WHERE pedido_id = $1',
      ['pg-dual-write-test-001']
    );
    expect(lines.rows[0].n).toBe(2);

    // Solo 1 reservation (de la ASIG).
    const reservations = await pgPool.query(
      'SELECT COUNT(*)::INT AS n FROM stock_reservations WHERE pedido_id = $1',
      ['pg-dual-write-test-001']
    );
    expect(reservations.rows[0].n).toBe(1);
  });

  it.skipIf(!hasDb)('T5: flag OFF → no-op (no toca PG)', async () => {
    const fbDb = makeMockFbDb({ dual_write_pedidos_enabled: false });
    const r = await replicatePedidoToPg(
      { pgPool, fbDb, log: () => {} },
      'pg-dual-write-test-001',
      makePedidoDoc()
    );
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe('flag_off');
    const pedidos = await pgPool.query(
      'SELECT COUNT(*)::INT AS n FROM pedidos WHERE id = $1',
      ['pg-dual-write-test-001']
    );
    expect(pedidos.rows[0].n).toBe(0);
  });
});
