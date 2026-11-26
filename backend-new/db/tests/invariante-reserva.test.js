/**
 * Invariante central: reservar > fisico libre rebota en el trigger.
 *
 * Caso emblematico: SKU-BBB-002 tiene 5 u en dep_11. Dos pedidos intentan
 * reservar 3 u cada uno. El segundo debe rebotar con STOCK_RESERVATION_OVERRUN.
 */
import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
  describeIfDb, ensureSchemaApplied, getPool, hasDb, seedFixture,
} from './setup.js';

async function createPedido(pool, orderNumber) {
  const res = await pool.query(`
    INSERT INTO pedidos (
      order_number, client_card_code, client_name,
      assigned_vendor_uid, assigned_vendor_key,
      owner_uid, cargado_por_uid
    ) VALUES ($1, 'C001', 'cliente A',
      'vendedor-01', 'VENDEDOR 01', 'vendedor-01', 'vendedor-01')
    RETURNING id;
  `, [orderNumber]);
  return res.rows[0].id;
}

describeIfDb('invariante reserva <= fisico', () => {
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

  it.skipIf(!hasDb)('reservar exactamente el fisico (5 u) pasa', async () => {
    const pool = getPool();
    const pedidoId = await createPedido(pool, 2001);
    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at
      ) VALUES ($1, 0, 'SKU-BBB-002', 'ASIG', 5, 5, 100, NOW());
    `, [pedidoId]);

    const { rows } = await pool.query(
      `SELECT qty FROM stock_reservations WHERE sku = 'SKU-BBB-002' AND warehouse = 'dep_11';`
    );
    expect(rows[0].qty).toBe(5);
  });

  it.skipIf(!hasDb)('reservar 6 u sobre 5 u rebota con STOCK_RESERVATION_OVERRUN', async () => {
    const pool = getPool();
    const pedidoId = await createPedido(pool, 2002);
    await expect(pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at
      ) VALUES ($1, 0, 'SKU-BBB-002', 'ASIG', 6, 6, 100, NOW());
    `, [pedidoId])).rejects.toThrow(/STOCK_RESERVATION_OVERRUN/);
  });

  it.skipIf(!hasDb)('dos pedidos reservando 3 + 3 u sobre 5 u: el segundo rebota', async () => {
    const pool = getPool();
    const pedidoAId = await createPedido(pool, 2003);
    const pedidoBId = await createPedido(pool, 2004);

    // Primera reserva: OK (3 <= 5).
    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-BBB-002', 'ASIG', 3, 3, 100, NOW());
    `, [pedidoAId]);

    // Segunda: 3 + 3 = 6 > 5, rebota.
    await expect(pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-BBB-002', 'ASIG', 3, 3, 100, NOW());
    `, [pedidoBId])).rejects.toThrow(/STOCK_RESERVATION_OVERRUN/);
  });

  it.skipIf(!hasDb)('reducir qty_open libera cupo y la proxima reserva entra', async () => {
    const pool = getPool();
    const pedidoAId = await createPedido(pool, 2005);
    const pedidoBId = await createPedido(pool, 2006);

    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-BBB-002', 'ASIG', 5, 5, 100, NOW());
    `, [pedidoAId]);

    // Pedido B quiere 2 u — rebota porque A tiene las 5.
    await expect(pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-BBB-002', 'ASIG', 2, 2, 100, NOW());
    `, [pedidoBId])).rejects.toThrow(/STOCK_RESERVATION_OVERRUN/);

    // A libera 3 u (qty_open 5 -> 2).
    await pool.query(`
      UPDATE pedido_lines SET qty_open = 2, qty_cancelled = 3
      WHERE pedido_id = $1 AND line_index = 0;
    `, [pedidoAId]);

    // Ahora B puede reservar 2 u (2 + 2 = 4 <= 5).
    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-BBB-002', 'ASIG', 2, 2, 100, NOW());
    `, [pedidoBId]);

    const { rows } = await pool.query(`
      SELECT COALESCE(SUM(qty), 0)::INT AS t
      FROM stock_reservations WHERE sku = 'SKU-BBB-002' AND warehouse = 'dep_11';
    `);
    expect(rows[0].t).toBe(4);
  });

  it.skipIf(!hasDb)('stock_snapshot no puede bajar debajo de reservations activas', async () => {
    const pool = getPool();
    const pedidoId = await createPedido(pool, 2007);
    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, asig_at)
      VALUES ($1, 0, 'SKU-BBB-002', 'ASIG', 5, 5, 100, NOW());
    `, [pedidoId]);

    // Intentar bajar snapshot a 3 cuando hay 5 reservadas: rebota.
    await expect(pool.query(`
      UPDATE stock_snapshot SET physical_qty = 3
      WHERE sku = 'SKU-BBB-002' AND warehouse = 'dep_11';
    `)).rejects.toThrow(/STOCK_SNAPSHOT_UNDERRUN/);

    // Subir el snapshot siempre es libre.
    await pool.query(`
      UPDATE stock_snapshot SET physical_qty = 10
      WHERE sku = 'SKU-BBB-002' AND warehouse = 'dep_11';
    `);
  });

  it.skipIf(!hasDb)('confirmed con transferido_sap.orderDocEntry NO reserva (§40.8)', async () => {
    const pool = getPool();
    const pedidoRes = await pool.query(`
      INSERT INTO pedidos (
        order_number, client_card_code, client_name,
        assigned_vendor_uid, assigned_vendor_key,
        owner_uid, cargado_por_uid,
        transferido_sap
      ) VALUES (
        2008, 'C001', 'cliente A',
        'vendedor-01', 'VENDEDOR 01',
        'vendedor-01', 'vendedor-01',
        '{"orderDocEntry":"123","orderDocNum":"SO-123"}'::jsonb
      ) RETURNING id;
    `);
    const pedidoId = pedidoRes.rows[0].id;

    // Line confirmed sobre SKU-BBB-002 (5 u fisico): NO debe crear reservation.
    await pool.query(`
      INSERT INTO pedido_lines (pedido_id, line_index, sku, state, qty, qty_open, price_ars, confirmed_at)
      VALUES ($1, 0, 'SKU-BBB-002', 'confirmed', 5, 5, 100, NOW());
    `, [pedidoId]);

    const { rows } = await pool.query(`
      SELECT COUNT(*)::INT AS n FROM stock_reservations WHERE pedido_id = $1;
    `, [pedidoId]);
    expect(rows[0].n).toBe(0);
  });
});
