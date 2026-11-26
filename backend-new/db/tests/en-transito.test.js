/**
 * En transito (§107, v1564): lineas con en_transito=TRUE reservan en dep_12,
 * no en dep_11.
 *
 * SKU-CCC-003 tiene 0 u en dep_11 + 20 u en dep_12.
 */
import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
  describeIfDb, ensureSchemaApplied, getPool, hasDb, seedFixture,
} from './setup.js';

describeIfDb('en_transito: reserva en dep_12 (§107)', () => {
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

  it.skipIf(!hasDb)('ASIG con en_transito=TRUE reserva en dep_12', async () => {
    const pool = getPool();
    const pedidoId = await createPedido(pool, 5001);

    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state, qty, qty_open, price_ars,
        asig_at, en_transito, asig_at_transito
      ) VALUES (
        $1, 0, 'SKU-CCC-003', 'ASIG', 5, 5, 100,
        NOW(), TRUE, NOW()
      );
    `, [pedidoId]);

    const { rows } = await pool.query(`
      SELECT warehouse, qty FROM stock_reservations WHERE pedido_id = $1;
    `, [pedidoId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].warehouse).toBe('dep_12');
    expect(rows[0].qty).toBe(5);
  });

  it.skipIf(!hasDb)('ASIG sin stock en dep_11 pero en_transito=TRUE: pasa porque dep_12 tiene 20 u', async () => {
    const pool = getPool();
    const pedidoId = await createPedido(pool, 5002);

    // SKU-CCC-003 tiene 0 u dep_11. Con en_transito=TRUE, reserva en dep_12.
    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state, qty, qty_open, price_ars,
        asig_at, en_transito, asig_at_transito
      ) VALUES (
        $1, 0, 'SKU-CCC-003', 'ASIG', 15, 15, 100,
        NOW(), TRUE, NOW()
      );
    `, [pedidoId]);

    // Validacion: aparecio en dep_12.
    const { rows } = await pool.query(`
      SELECT warehouse FROM stock_reservations WHERE pedido_id = $1;
    `, [pedidoId]);
    expect(rows[0].warehouse).toBe('dep_12');
  });

  it.skipIf(!hasDb)('reservar 21 u en dep_12 (solo hay 20) rebota', async () => {
    const pool = getPool();
    const pedidoId = await createPedido(pool, 5003);

    await expect(pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state, qty, qty_open, price_ars,
        asig_at, en_transito, asig_at_transito
      ) VALUES (
        $1, 0, 'SKU-CCC-003', 'ASIG', 21, 21, 100,
        NOW(), TRUE, NOW()
      );
    `, [pedidoId])).rejects.toThrow(/STOCK_RESERVATION_OVERRUN/);
  });

  it.skipIf(!hasDb)('UPDATE en_transito=FALSE flipea la reservation a dep_11 (cruce §107)', async () => {
    const pool = getPool();
    const pedidoId = await createPedido(pool, 5004);

    // SKU-BBB-002 tiene 5 u dep_11 + 3 u dep_12. Reservo 2 u en transito.
    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state, qty, qty_open, price_ars,
        asig_at, en_transito, asig_at_transito
      ) VALUES (
        $1, 0, 'SKU-BBB-002', 'ASIG', 2, 2, 100,
        NOW(), TRUE, NOW()
      );
    `, [pedidoId]);

    let { rows } = await pool.query(
      `SELECT warehouse FROM stock_reservations WHERE pedido_id = $1`, [pedidoId]
    );
    expect(rows[0].warehouse).toBe('dep_12');

    // Cruza al fisico: en_transito=FALSE + en_dep11_at=NOW.
    await pool.query(`
      UPDATE pedido_lines
      SET en_transito = FALSE, en_dep11_at = NOW()
      WHERE pedido_id = $1 AND line_index = 0;
    `, [pedidoId]);

    ({ rows } = await pool.query(
      `SELECT warehouse FROM stock_reservations WHERE pedido_id = $1`, [pedidoId]
    ));
    expect(rows[0].warehouse).toBe('dep_11');
  });

  it.skipIf(!hasDb)('v_stock_breakdown reporta asignadas_dep12 cuando hay transito', async () => {
    const pool = getPool();
    const pedidoId = await createPedido(pool, 5005);

    await pool.query(`
      INSERT INTO pedido_lines (
        pedido_id, line_index, sku, state, qty, qty_open, price_ars,
        asig_at, en_transito, asig_at_transito
      ) VALUES (
        $1, 0, 'SKU-CCC-003', 'ASIG', 10, 10, 100,
        NOW(), TRUE, NOW()
      );
    `, [pedidoId]);

    const { rows } = await pool.query(`
      SELECT fisico_dep11, transito_dep12, asignadas_dep11, asignadas_dep12
      FROM v_stock_breakdown WHERE sku = 'SKU-CCC-003';
    `);
    expect(rows[0].fisico_dep11).toBe(0);
    expect(rows[0].transito_dep12).toBe(20);
    expect(rows[0].asignadas_dep11).toBe(0);
    expect(rows[0].asignadas_dep12).toBe(10);
  });
});
