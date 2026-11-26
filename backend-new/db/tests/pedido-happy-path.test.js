/**
 * Happy path: crear pedido con linea ASIG dispara trigger de sync a
 * stock_reservations.
 */
import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
  describeIfDb, ensureSchemaApplied, getPool, hasDb, seedFixture,
} from './setup.js';

describeIfDb('pedido happy path', () => {
  beforeAll(async () => {
    await ensureSchemaApplied();
  });

  beforeEach(async () => {
    const client = await getPool().connect();
    try {
      await client.query('TRUNCATE pedido_lines, pedidos, stock_reservations, stock_snapshot RESTART IDENTITY CASCADE');
      await seedFixture(client);
    } finally {
      client.release();
    }
  });

  it.skipIf(!hasDb)('INSERT pedido + line ASIG crea stock_reservation en dep_11', async () => {
    const pool = getPool();
    const pedidoRes = await pool.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid, origen
      ) VALUES (
        1001, 'C001', 'cliente A',
        'vendedor-01', 'VENDEDOR 01',
        'vendedor-01', 'vendedor-01', 'manual'
      ) RETURNING id;
    `);
    const pedidoId = pedidoRes.rows[0].id;

    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state,
        qty, qty_open, price_ars, asig_at
      ) VALUES (
        $1, 0, 'SKU-AAA-001', 'ASIG',
        3, 3, 1500.00, NOW()
      );
    `, [pedidoId]);

    const { rows } = await pool.query(`
      SELECT sku, warehouse, qty, state
      FROM stock_reservations
      WHERE pedido_id = $1;
    `, [pedidoId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sku: 'SKU-AAA-001',
      warehouse: 'dep_11',
      qty: 3,
      state: 'ASIG',
    });
  });

  it.skipIf(!hasDb)('INSERT line state=BO NO crea stock_reservation (§40)', async () => {
    const pool = getPool();
    const pedidoRes = await pool.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid, origen
      ) VALUES (
        1002, 'C001', 'cliente A',
        'vendedor-01', 'VENDEDOR 01',
        'vendedor-01', 'vendedor-01', 'manual'
      ) RETURNING id;
    `);
    const pedidoId = pedidoRes.rows[0].id;

    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state,
        qty, qty_open, price_ars
      ) VALUES (
        $1, 0, 'SKU-AAA-001', 'BO',
        5, 5, 1500.00
      );
    `, [pedidoId]);

    const { rows } = await pool.query(`
      SELECT COUNT(*)::INT AS n
      FROM stock_reservations
      WHERE pedido_id = $1;
    `, [pedidoId]);

    expect(rows[0].n).toBe(0);
  });

  it.skipIf(!hasDb)('UPDATE line state BO -> ASIG crea reservation al promover', async () => {
    const pool = getPool();
    const pedidoRes = await pool.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid
      ) VALUES (
        1003, 'C001', 'cliente A',
        'vendedor-01', 'VENDEDOR 01',
        'vendedor-01', 'vendedor-01'
      ) RETURNING id;
    `);
    const pedidoId = pedidoRes.rows[0].id;

    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state,
        qty, qty_open, price_ars
      ) VALUES (
        $1, 0, 'SKU-AAA-001', 'BO',
        2, 2, 1000.00
      );
    `, [pedidoId]);

    let { rows: beforePromote } = await pool.query(
      `SELECT COUNT(*)::INT AS n FROM stock_reservations WHERE pedido_id = $1`, [pedidoId]
    );
    expect(beforePromote[0].n).toBe(0);

    await pool.query(`
      UPDATE pedido_lines
      SET state = 'ASIG', asig_at = NOW()
      WHERE pedido_id = $1 AND line_index = 0;
    `, [pedidoId]);

    const { rows: afterPromote } = await pool.query(
      `SELECT qty FROM stock_reservations WHERE pedido_id = $1`, [pedidoId]
    );
    expect(afterPromote).toHaveLength(1);
    expect(afterPromote[0].qty).toBe(2);
  });

  it.skipIf(!hasDb)('UPDATE line qty_open=0 remueve la reservation (invoiced)', async () => {
    const pool = getPool();
    const pedidoRes = await pool.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid
      ) VALUES (
        1004, 'C001', 'cliente A',
        'vendedor-01', 'VENDEDOR 01',
        'vendedor-01', 'vendedor-01'
      ) RETURNING id;
    `);
    const pedidoId = pedidoRes.rows[0].id;

    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state,
        qty, qty_open, price_ars, asig_at
      ) VALUES (
        $1, 0, 'SKU-AAA-001', 'ASIG',
        2, 2, 1000.00, NOW()
      );
    `, [pedidoId]);

    await pool.query(`
      UPDATE pedido_lines
      SET state = 'invoiced', qty_open = 0
      WHERE pedido_id = $1 AND line_index = 0;
    `, [pedidoId]);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::INT AS n FROM stock_reservations WHERE pedido_id = $1`, [pedidoId]
    );
    expect(rows[0].n).toBe(0);
  });
});
