/**
 * FIFO ASIG (§40.3): 2 lineas ASIG mismo SKU, orden por asig_at ASC.
 *
 * El indice ix_pedido_lines_fifo_asig soporta la query.
 */
import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
  describeIfDb, ensureSchemaApplied, getPool, hasDb, seedFixture,
} from './setup.js';

describeIfDb('FIFO ASIG por asig_at (§40.3)', () => {
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

  async function createPedido(pool, orderNumber, vendorUid = 'vendedor-01') {
    const res = await pool.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid
      ) VALUES ($1, 'C001', 'cliente A', $2, 'VENDEDOR 01', $2, $2)
      RETURNING id;
    `, [orderNumber, vendorUid]);
    return res.rows[0].id;
  }

  it.skipIf(!hasDb)('2 ASIG mismo SKU: orden por asig_at ASC', async () => {
    const pool = getPool();
    const pedidoAId = await createPedido(pool, 4001);
    const pedidoBId = await createPedido(pool, 4002);

    const tMas_viejo = '2026-11-20T10:00:00Z';
    const tMas_nuevo = '2026-11-25T10:00:00Z';

    // Ojo: SKU-AAA-001 tiene 10 u fisico, 3 + 2 = 5 cabe.
    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-AAA-001', 'ASIG', 3, 3, 100, $2::timestamptz);
    `, [pedidoAId, tMas_viejo]);

    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-AAA-001', 'ASIG', 2, 2, 100, $2::timestamptz);
    `, [pedidoBId, tMas_nuevo]);

    // Query FIFO desde stock_reservations: primero el asig_at mas viejo.
    const { rows } = await pool.query(`
      SELECT pedido_id, qty, asig_at
      FROM stock_reservations
      WHERE sku = 'SKU-AAA-001' AND warehouse = 'dep_11' AND state = 'ASIG'
      ORDER BY asig_at ASC;
    `);
    expect(rows).toHaveLength(2);
    expect(rows[0].pedido_id).toBe(pedidoAId);
    expect(rows[0].qty).toBe(3);
    expect(rows[1].pedido_id).toBe(pedidoBId);
    expect(rows[1].qty).toBe(2);
  });

  it.skipIf(!hasDb)('v_stock_breakdown agrega correctamente para SKU-AAA-001', async () => {
    const pool = getPool();
    const pedidoAId = await createPedido(pool, 4003);
    const pedidoBId = await createPedido(pool, 4004);

    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-AAA-001', 'ASIG', 4, 4, 100, NOW() - INTERVAL '1 day');
    `, [pedidoAId]);

    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, confirmed_at)
      VALUES ($1, 0, 'SKU-AAA-001', 'confirmed', 2, 2, 100, NOW());
    `, [pedidoBId]);

    const { rows } = await pool.query(`
      SELECT fisico_dep11, asignadas_dep11, confirmadas_dep11, reservadas_dep11, libre_dep11
      FROM v_stock_breakdown WHERE sku = 'SKU-AAA-001';
    `);
    expect(rows[0].fisico_dep11).toBe(10);
    expect(rows[0].asignadas_dep11).toBe(4);
    expect(rows[0].confirmadas_dep11).toBe(2);
    expect(rows[0].reservadas_dep11).toBe(6);
    expect(rows[0].libre_dep11).toBe(4);
  });

  it.skipIf(!hasDb)('BO aparece en backorder_app pero NO suma a reservadas', async () => {
    const pool = getPool();
    const pedidoAId = await createPedido(pool, 4005);
    const pedidoBId = await createPedido(pool, 4006);

    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars)
      VALUES ($1, 0, 'SKU-AAA-001', 'BO', 8, 8, 100);
    `, [pedidoAId]);

    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-AAA-001', 'ASIG', 3, 3, 100, NOW());
    `, [pedidoBId]);

    const { rows } = await pool.query(`
      SELECT backorder_app, asignadas_dep11, reservadas_dep11, libre_dep11
      FROM v_stock_breakdown WHERE sku = 'SKU-AAA-001';
    `);
    expect(rows[0].backorder_app).toBe(8);
    expect(rows[0].asignadas_dep11).toBe(3);
    expect(rows[0].reservadas_dep11).toBe(3);
    expect(rows[0].libre_dep11).toBe(7);
  });
});
