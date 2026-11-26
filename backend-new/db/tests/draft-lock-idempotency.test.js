/**
 * Idempotency §64.3: 2 commits con mismo draft_id -> 1 solo pedido.
 *
 * Shape del lock:
 *   pedido_draft_locks (draft_id PK, pedido_id FK).
 *
 * Flow idempotente (equivalente PG del draft lock Firestore):
 *   1. INSERT INTO pedido_draft_locks (draft_id, pedido_id, ...)
 *      ON CONFLICT (draft_id) DO NOTHING RETURNING pedido_id;
 *   2. Si rowCount == 0 => el lock existia, SELECT pedido_id del lock existente.
 */
import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
  describeIfDb, ensureSchemaApplied, getPool, hasDb, seedFixture,
} from './setup.js';

async function commitPedidoIdempotent(pool, { draftId, orderNumber, cardCode, clientName, vendorUid }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fast-path: ¿el lock ya existe?
    const existing = await client.query(
      `SELECT pedido_id FROM pedido_draft_locks WHERE draft_id = $1`, [draftId]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { pedidoId: existing.rows[0].pedido_id, idempotentHit: true };
    }

    // No existe, creo el pedido y el lock dentro de la misma tx.
    const pedidoRes = await client.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid, origen, draft_id
      ) VALUES ($1, $2, $3, $4, 'VENDEDOR 01', $4, $4, 'manual', $5)
      RETURNING id;
    `, [orderNumber, cardCode, clientName, vendorUid, draftId]);
    const pedidoId = pedidoRes.rows[0].id;

    // Insert lock con ON CONFLICT para el caso race (otro tx escribio primero).
    const lockRes = await client.query(`
      INSERT INTO pedido_draft_locks (draft_id, pedido_id, card_code, origen, owner_uid)
      VALUES ($1, $2, $3, 'manual', $4)
      ON CONFLICT (draft_id) DO NOTHING
      RETURNING pedido_id;
    `, [draftId, pedidoId, cardCode, vendorUid]);

    if (lockRes.rowCount === 0) {
      // Race: alguien me gano. Rollback mi pedido y devuelvo el suyo.
      await client.query('ROLLBACK');
      const winner = await pool.query(
        `SELECT pedido_id FROM pedido_draft_locks WHERE draft_id = $1`, [draftId]
      );
      return { pedidoId: winner.rows[0].pedido_id, idempotentHit: true };
    }

    await client.query('COMMIT');
    return { pedidoId, idempotentHit: false };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

describeIfDb('draft lock idempotency (§64.3)', () => {
  beforeAll(async () => {
    await ensureSchemaApplied();
  });

  beforeEach(async () => {
    const client = await getPool().connect();
    try {
      await client.query('TRUNCATE pedido_lines, pedidos, stock_reservations, stock_snapshot, pedido_draft_locks RESTART IDENTITY CASCADE');
      await seedFixture(client);
    } finally {
      client.release();
    }
  });

  it.skipIf(!hasDb)('commit unico crea pedido + lock', async () => {
    const pool = getPool();
    const r = await commitPedidoIdempotent(pool, {
      draftId: 'C|CABA|CABA|cliente A|3001',
      orderNumber: 3001,
      cardCode: 'C001',
      clientName: 'cliente A',
      vendorUid: 'vendedor-01',
    });
    expect(r.idempotentHit).toBe(false);
    expect(r.pedidoId).toMatch(/^p_[0-9a-f]+$/);

    const { rows } = await pool.query(`SELECT pedido_id FROM pedido_draft_locks WHERE draft_id = $1`,
      ['C|CABA|CABA|cliente A|3001']);
    expect(rows[0].pedido_id).toBe(r.pedidoId);
  });

  it.skipIf(!hasDb)('2 commits secuenciales con mismo draft_id -> 1 solo pedido', async () => {
    const pool = getPool();
    const r1 = await commitPedidoIdempotent(pool, {
      draftId: 'C|CABA|CABA|cliente A|3002',
      orderNumber: 3002,
      cardCode: 'C001',
      clientName: 'cliente A',
      vendorUid: 'vendedor-01',
    });
    const r2 = await commitPedidoIdempotent(pool, {
      draftId: 'C|CABA|CABA|cliente A|3002',
      orderNumber: 3003, // distinto, pero deberia ignorarse porque el draft_id ya tiene pedido.
      cardCode: 'C001',
      clientName: 'cliente A',
      vendorUid: 'vendedor-01',
    });

    expect(r1.idempotentHit).toBe(false);
    expect(r2.idempotentHit).toBe(true);
    expect(r2.pedidoId).toBe(r1.pedidoId);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::INT AS n FROM pedidos WHERE draft_id = $1`,
      ['C|CABA|CABA|cliente A|3002']
    );
    expect(rows[0].n).toBe(1);
  });

  it.skipIf(!hasDb)('2 commits CONCURRENTES Promise.all con mismo draft_id -> 1 solo pedido', async () => {
    const pool = getPool();
    const payload = {
      draftId: 'C|CABA|CABA|cliente A|3004',
      cardCode: 'C001',
      clientName: 'cliente A',
      vendorUid: 'vendedor-01',
    };

    const [rA, rB] = await Promise.all([
      commitPedidoIdempotent(pool, { ...payload, orderNumber: 3004 }),
      commitPedidoIdempotent(pool, { ...payload, orderNumber: 3005 }),
    ]);

    expect(rA.pedidoId).toBe(rB.pedidoId);
    // Exactamente uno marco idempotentHit=false.
    expect([rA.idempotentHit, rB.idempotentHit].filter(x => x === false)).toHaveLength(1);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::INT AS n FROM pedidos WHERE draft_id = $1`,
      [payload.draftId]
    );
    expect(rows[0].n).toBe(1);
  });

  it.skipIf(!hasDb)('UNIQUE constraint rebota INSERT directo con draft_id duplicado', async () => {
    const pool = getPool();
    await pool.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid, draft_id
      ) VALUES (3010, 'C001', 'cliente A',
        'vendedor-01', 'VENDEDOR 01', 'vendedor-01', 'vendedor-01',
        'C|dup|dup|dup|3010');
    `);
    await expect(pool.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid, draft_id
      ) VALUES (3011, 'C001', 'cliente A',
        'vendedor-01', 'VENDEDOR 01', 'vendedor-01', 'vendedor-01',
        'C|dup|dup|dup|3010');
    `)).rejects.toThrow(/duplicate key/i);
  });

  it.skipIf(!hasDb)('pedidos con draft_id NULL no colisionan entre si (partial index)', async () => {
    const pool = getPool();
    for (let i = 0; i < 3; i++) {
      await pool.query(`
        INSERT INTO pedidos (
          order_number, client_card_code, client_name,
          assigned_vendor_uid, assigned_vendor_key,
          owner_uid, cargado_por_uid, draft_id
        ) VALUES ($1, 'C001', 'cliente A',
          'vendedor-01', 'VENDEDOR 01', 'vendedor-01', 'vendedor-01', NULL);
      `, [3020 + i]);
    }
    const { rows } = await pool.query(`
      SELECT COUNT(*)::INT AS n FROM pedidos WHERE draft_id IS NULL;
    `);
    expect(rows[0].n).toBe(3);
  });
});
