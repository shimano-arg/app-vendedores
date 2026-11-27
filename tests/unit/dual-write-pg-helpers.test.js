// @ts-check
/**
 * S-12 Phase 2 (ADR-0016): unit tests de los helpers puros de SQL
 * building para el wiring dual-write Firestore → PG.
 *
 * Mirror obligatorio §57: `src/pure/dual-write-pg-helpers.js` +
 * `functions/core/dual-write-pg-helpers.js` deben ser byte-equivalente
 * (verificado por otro test de sync).
 */
import { describe, expect, it } from 'vitest';
import {
  buildDualWritePendingEntry,
  buildPedidoDelete,
  buildPedidoInsert,
  buildPedidoLinesInsert,
  buildPlaceholders,
  buildReplicationStatements,
  PEDIDO_COLUMNS,
  PEDIDO_LINE_COLUMNS,
  serializeValue,
} from '../../src/pure/dual-write-pg-helpers.js';

describe('dual-write-pg-helpers — SQL building', () => {
  it('T1: buildPlaceholders arma $1, $2, ... con count correcto', () => {
    expect(buildPlaceholders(1)).toBe('$1');
    expect(buildPlaceholders(3)).toBe('$1, $2, $3');
    expect(buildPlaceholders(0)).toBe('');
    expect(buildPlaceholders(2, 5)).toBe('$5, $6');
  });

  it('T2: serializeValue pasa primitivas tal cual', () => {
    expect(serializeValue('order_number', 123)).toBe(123);
    expect(serializeValue('client_name', 'ACME')).toBe('ACME');
    expect(serializeValue('closed_at', null)).toBe(null);
    expect(serializeValue('en_transito', true)).toBe(true);
  });

  it('T3: serializeValue stringifica JSONB (transferido_sap)', () => {
    const transferido = { docEntry: 123, docNum: 456, transferredAt: '2026-11-26' };
    const serialized = serializeValue('transferido_sap', transferido);
    expect(typeof serialized).toBe('string');
    expect(JSON.parse(/** @type {string} */ (serialized))).toEqual(transferido);
  });

  it('T4: buildPedidoInsert genera INSERT con placeholders correctos', () => {
    const pedido = {
      id: 'p_abc',
      order_number: 100,
      client_card_code: 'C001',
      client_name: 'ACME',
      assigned_vendor_uid: 'uid_123',
      assigned_vendor_key: 'MAURICIO GIL',
      owner_uid: 'uid_123',
      cargado_por_uid: 'uid_123',
      origen: 'manual',
      draft_id: null,
      transferido_sap: {},
      created_at: '2026-11-26T12:00:00.000Z',
      updated_at: '2026-11-26T12:00:00.000Z',
      first_invoiced_at: null,
      cobrado_at: null,
      closed_at: null,
      closed_reason: null,
      closed_by: null,
    };
    const stmt = buildPedidoInsert(pedido);
    expect(stmt.text).toMatch(/^INSERT INTO pedidos \(.+\) VALUES \(.+\)$/);
    expect(stmt.text).toContain('id, order_number');
    expect(stmt.values).toHaveLength(PEDIDO_COLUMNS.length);
    expect(stmt.values[0]).toBe('p_abc');
    expect(stmt.values[1]).toBe(100);
    // transferido_sap serializado a string JSON.
    expect(typeof stmt.values[10]).toBe('string');
  });

  it('T5: buildPedidoDelete tira cuando pedidoId es invalido', () => {
    expect(() => buildPedidoDelete('')).toThrow();
    expect(() => buildPedidoDelete(/** @type {any} */ (null))).toThrow();
    const ok = buildPedidoDelete('p_abc');
    expect(ok.text).toBe('DELETE FROM pedidos WHERE id = $1');
    expect(ok.values).toEqual(['p_abc']);
  });

  it('T6: buildPedidoLinesInsert genera multi-row INSERT', () => {
    const lines = [
      {
        pedido_id: 'p_abc',
        line_index: 0,
        sku: 'SKU-AAA-001',
        state: 'ASIG',
        qty: 3,
        qty_open: 3,
        qty_cancelled: 0,
        price_ars: 1500,
        discount_percent: 0,
        en_transito: false,
        asig_at_transito: null,
        en_dep11_at: null,
        asig_at: '2026-11-26T12:00:00.000Z',
        confirmed_at: null,
        cancelled_at: null,
        asig_revertida_at: null,
        asig_revertida_by: null,
        asig_revertida_reason: null,
        split_from_line_index: null,
        closed_reason: null,
        closed_by: null,
        cancelled_by: null,
      },
      {
        pedido_id: 'p_abc',
        line_index: 1,
        sku: 'SKU-BBB-002',
        state: 'BO',
        qty: 5,
        qty_open: 5,
        qty_cancelled: 0,
        price_ars: 2000,
        discount_percent: 10,
        en_transito: false,
        asig_at_transito: null,
        en_dep11_at: null,
        asig_at: null,
        confirmed_at: null,
        cancelled_at: null,
        asig_revertida_at: null,
        asig_revertida_by: null,
        asig_revertida_reason: null,
        split_from_line_index: null,
        closed_reason: null,
        closed_by: null,
        cancelled_by: null,
      },
    ];
    const stmt = buildPedidoLinesInsert(lines);
    expect(stmt).not.toBeNull();
    expect(stmt?.text).toMatch(/^INSERT INTO pedido_lines \(.+\) VALUES \(.+\), \(.+\)$/);
    expect(stmt?.values).toHaveLength(PEDIDO_LINE_COLUMNS.length * 2);
    expect(stmt?.values[0]).toBe('p_abc');
    expect(stmt?.values[2]).toBe('SKU-AAA-001');
    expect(stmt?.values[PEDIDO_LINE_COLUMNS.length]).toBe('p_abc'); // start of line 2
    expect(stmt?.values[PEDIDO_LINE_COLUMNS.length + 2]).toBe('SKU-BBB-002');
  });

  it('T7: buildPedidoLinesInsert devuelve null para array vacio', () => {
    expect(buildPedidoLinesInsert([])).toBeNull();
    expect(buildPedidoLinesInsert(/** @type {any} */ (null))).toBeNull();
  });

  it('T8: buildReplicationStatements genera DELETE + INSERT pedido + INSERT lines', () => {
    const result = {
      pedido: {
        id: 'p_abc',
        order_number: 100,
        client_card_code: 'C001',
        client_name: 'ACME',
        assigned_vendor_uid: 'u1',
        assigned_vendor_key: 'VK',
        owner_uid: 'u1',
        cargado_por_uid: 'u1',
        origen: 'manual',
        draft_id: null,
        transferido_sap: null,
        created_at: '2026-11-26T12:00:00.000Z',
        updated_at: '2026-11-26T12:00:00.000Z',
        first_invoiced_at: null,
        cobrado_at: null,
        closed_at: null,
        closed_reason: null,
        closed_by: null,
      },
      lines: [
        {
          pedido_id: 'p_abc',
          line_index: 0,
          sku: 'SKU-X',
          state: 'ASIG',
          qty: 1,
          qty_open: 1,
          qty_cancelled: 0,
          price_ars: 100,
          discount_percent: 0,
          en_transito: false,
          asig_at_transito: null,
          en_dep11_at: null,
          asig_at: '2026-11-26T12:00:00.000Z',
          confirmed_at: null,
          cancelled_at: null,
          asig_revertida_at: null,
          asig_revertida_by: null,
          asig_revertida_reason: null,
          split_from_line_index: null,
          closed_reason: null,
          closed_by: null,
          cancelled_by: null,
        },
      ],
      reservations: [],
      warnings: [],
    };
    const stmts = buildReplicationStatements(result);
    expect(stmts).toHaveLength(3);
    expect(stmts[0].text).toBe('DELETE FROM pedidos WHERE id = $1');
    expect(stmts[0].values).toEqual(['p_abc']);
    expect(stmts[1].text).toContain('INSERT INTO pedidos');
    expect(stmts[2].text).toContain('INSERT INTO pedido_lines');
  });

  it('T9: buildReplicationStatements omite INSERT lines si no hay lineas (cancelacion)', () => {
    const result = {
      pedido: {
        id: 'p_abc',
        order_number: 100,
        client_card_code: 'C001',
        client_name: 'ACME',
        assigned_vendor_uid: 'u1',
        assigned_vendor_key: 'VK',
        owner_uid: 'u1',
        cargado_por_uid: 'u1',
        origen: 'manual',
        draft_id: null,
        transferido_sap: null,
        created_at: '2026-11-26T12:00:00.000Z',
        updated_at: '2026-11-26T12:00:00.000Z',
        first_invoiced_at: null,
        cobrado_at: null,
        closed_at: '2026-11-26T13:00:00.000Z',
        closed_reason: 'cancelado_cliente',
        closed_by: 'uid_pablo',
      },
      lines: [],
      reservations: [],
      warnings: [],
    };
    const stmts = buildReplicationStatements(result);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].text).toContain('DELETE');
    expect(stmts[1].text).toContain('INSERT INTO pedidos');
  });

  it('T10: buildDualWritePendingEntry setea shape correcto + firstFailedAt', () => {
    const err = new Error('connection refused 127.0.0.1:5433');
    /** @type {any} */ (err).code = 'ECONNREFUSED';
    const entry = buildDualWritePendingEntry('p_abc', err, {
      nowIso: '2026-11-26T15:00:00.000Z',
    });
    expect(entry.pedidoId).toBe('p_abc');
    expect(entry.errorMessage).toContain('connection refused');
    expect(entry.errorCode).toBe('ECONNREFUSED');
    expect(entry.failedAt).toBe('2026-11-26T15:00:00.000Z');
    expect(entry.firstFailedAt).toBe('2026-11-26T15:00:00.000Z');
    expect(entry.attempts).toBe(1);
    expect(entry.resolvedAt).toBeNull();
  });
});
