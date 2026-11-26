/**
 * Smoke test: la migracion 0001_initial.sql aplica limpia sobre DB vacia y
 * genera todas las tablas, enums, triggers y constraints esperados.
 */
import { beforeAll, expect, it } from 'vitest';
import { describeIfDb, ensureSchemaApplied, getPool, hasDb } from './setup.js';

describeIfDb('schema smoke', () => {
  beforeAll(async () => {
    await ensureSchemaApplied();
  });

  it.skipIf(!hasDb)('todas las tablas v0 existen', async () => {
    const { rows } = await getPool().query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);
    const tables = rows.map(r => r.tablename);
    expect(tables).toEqual(expect.arrayContaining([
      'ingresos_reparto',
      'pedido_draft_locks',
      'pedido_lines',
      'pedidos',
      'revision_waitlist',
      'stock_reservations',
      'stock_snapshot',
      'waitlist_asig_refs',
    ]));
  });

  it.skipIf(!hasDb)('line_state_enum tiene los 5 estados', async () => {
    const { rows } = await getPool().query(`
      SELECT unnest(enum_range(NULL::line_state_enum))::text AS v;
    `);
    const values = rows.map(r => r.v);
    expect(values).toEqual(['BO', 'ASIG', 'confirmed', 'invoiced', 'cancelled']);
  });

  it.skipIf(!hasDb)('warehouse_enum tiene dep_11 y dep_12', async () => {
    const { rows } = await getPool().query(`
      SELECT unnest(enum_range(NULL::warehouse_enum))::text AS v;
    `);
    expect(rows.map(r => r.v)).toEqual(['dep_11', 'dep_12']);
  });

  it.skipIf(!hasDb)('indice partial de draft_id esta en su lugar', async () => {
    const { rows } = await getPool().query(`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'uq_pedidos_draft_id';
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/WHERE \(draft_id IS NOT NULL\)/i);
  });

  it.skipIf(!hasDb)('triggers t_pedido_lines_sync_reservations + t_stock_reservations_check_invariant existen', async () => {
    const { rows } = await getPool().query(`
      SELECT tgname FROM pg_trigger
      WHERE tgname IN (
        't_pedido_lines_sync_reservations',
        't_stock_reservations_check_invariant',
        't_stock_snapshot_guard'
      )
      AND NOT tgisinternal
      ORDER BY tgname;
    `);
    const names = rows.map(r => r.tgname);
    expect(names).toContain('t_pedido_lines_sync_reservations');
    expect(names).toContain('t_stock_reservations_check_invariant');
    expect(names).toContain('t_stock_snapshot_guard');
  });

  it.skipIf(!hasDb)('v_stock_breakdown view existe', async () => {
    const { rows } = await getPool().query(`
      SELECT viewname FROM pg_views
      WHERE schemaname = 'public' AND viewname = 'v_stock_breakdown';
    `);
    expect(rows).toHaveLength(1);
  });

  it.skipIf(!hasDb)('line_reserves_stock(ASIG, 5, {}) devuelve TRUE', async () => {
    const { rows } = await getPool().query(`
      SELECT line_reserves_stock('ASIG'::line_state_enum, 5, '{}'::jsonb) AS r;
    `);
    expect(rows[0].r).toBe(true);
  });

  it.skipIf(!hasDb)('line_reserves_stock(confirmed, 5, {orderDocEntry:123}) devuelve FALSE (§40.8)', async () => {
    const { rows } = await getPool().query(`
      SELECT line_reserves_stock(
        'confirmed'::line_state_enum,
        5,
        '{"orderDocEntry":"123"}'::jsonb
      ) AS r;
    `);
    expect(rows[0].r).toBe(false);
  });

  it.skipIf(!hasDb)('line_reserves_stock(BO, 5, {}) devuelve FALSE (§40)', async () => {
    const { rows } = await getPool().query(`
      SELECT line_reserves_stock('BO'::line_state_enum, 5, '{}'::jsonb) AS r;
    `);
    expect(rows[0].r).toBe(false);
  });
});
