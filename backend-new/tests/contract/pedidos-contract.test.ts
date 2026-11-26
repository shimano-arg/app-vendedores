/**
 * Contract test — `getPedidosByClient` output matchea `GetPedidosByClientOutput`.
 * NO toca DB — mock del `PedidosRepo`.
 */

import { describe, it, expect } from 'vitest';
import { getPedidosByClient } from '../../domains/pedidos/get-pedidos-by-client.js';
import {
  GetPedidosByClientOutput,
  type GetPedidosByClientQuery,
} from '../../shared/contracts/get-pedidos.js';
import type { PedidosRepo, PedidoRaw } from '../../infra/db/repos/pedidos-repo.js';
import { ERROR_CODES } from '../../shared/errors/business-errors.js';

function makeMockRepo(result: Awaited<ReturnType<PedidosRepo['getPedidosByClient']>>): PedidosRepo {
  return {
    getPedidosByClient: async () => result,
  };
}

function buildPedidoRaw(overrides: Partial<PedidoRaw> = {}): PedidoRaw {
  const now = new Date('2026-11-26T12:00:00.000Z');
  return {
    id: 'p_abc',
    orderNumber: 123,
    clientCardCode: 'C001',
    clientName: 'cliente A',
    origen: 'manual',
    createdAt: now,
    closedAt: null,
    firstInvoicedAt: null,
    lines: [
      {
        pedidoId: 'p_abc',
        lineIndex: 0,
        sku: 'SKU-001',
        state: 'confirmed',
        qty: 5,
        qtyOpen: 5,
        priceArs: 1000,
        discountPercent: 10,
        confirmedAt: new Date('2026-11-26T13:00:00.000Z'),
      },
    ],
    ...overrides,
  };
}

describe('contract: getPedidosByClient ↔ GetPedidosByClientOutput schema', () => {
  it('maps a single pedido with confirmed lines to the slim shape', async () => {
    const repo = makeMockRepo({
      items: [buildPedidoRaw()],
      nextCursor: null,
      hasMore: false,
    });

    const out = await getPedidosByClient(
      { cardCode: 'C001', stage: 'open', limit: 50 },
      { repo },
    );

    const parsed = GetPedidosByClientOutput.parse(out);
    expect(parsed.items).toHaveLength(1);
    const first = parsed.items[0]!;
    expect(first.id).toBe('p_abc');
    expect(first.orderNumber).toBe(123);
    expect(first.stage).toBe('open');
    expect(first.confirmedAt).toBe('2026-11-26T13:00:00.000Z');
    // netAmountArs = 5 * 1000 * (1 - 0.10) = 4500
    expect(first.netAmountArs).toBe(4500);
    expect(first.lines[0]!.sku).toBe('SKU-001');
  });

  it('netAmountArs is null when no confirmed lines', async () => {
    const pedido = buildPedidoRaw({
      lines: [
        {
          pedidoId: 'p_bo',
          lineIndex: 0,
          sku: 'SKU-BO',
          state: 'BO',
          qty: 2,
          qtyOpen: 2,
          priceArs: 500,
          discountPercent: 0,
          confirmedAt: null,
        },
      ],
    });
    const repo = makeMockRepo({
      items: [pedido],
      nextCursor: null,
      hasMore: false,
    });
    const out = await getPedidosByClient(
      { cardCode: 'C001', stage: 'open', limit: 50 },
      { repo },
    );
    expect(out.items[0]!.netAmountArs).toBeNull();
  });

  it('propagates hasMore + nextCursor', async () => {
    const repo = makeMockRepo({
      items: [buildPedidoRaw()],
      nextCursor: 'opaque_cursor_abc',
      hasMore: true,
    });
    const out = await getPedidosByClient(
      { cardCode: 'C001', stage: 'open', limit: 1 },
      { repo },
    );
    expect(out.pageInfo).toEqual({
      nextCursor: 'opaque_cursor_abc',
      hasMore: true,
    });
  });

  it('maps CURSOR_INVALID from repo to PEDIDOS_CURSOR_INVALIDO', async () => {
    const brokenRepo: PedidosRepo = {
      getPedidosByClient: async () => {
        throw new Error('CURSOR_INVALID');
      },
    };
    await expect(
      getPedidosByClient(
        { cardCode: 'C001', stage: 'open', limit: 50, cursor: 'garbage' },
        { repo: brokenRepo },
      ),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PEDIDOS_CURSOR_INVALIDO });
  });

  it('GetPedidosByClientQuery schema normalizes cardCode (trim + upper)', () => {
    const parsed: GetPedidosByClientQuery = GetPedidosByClientQuery.parse({
      cardCode: '  c001  ',
    });
    expect(parsed.cardCode).toBe('C001');
    expect(parsed.stage).toBe('open'); // default
    expect(parsed.limit).toBe(50); // default
  });

  it('GetPedidosByClientQuery rejects empty cardCode', () => {
    expect(() =>
      GetPedidosByClientQuery.parse({ cardCode: '' }),
    ).toThrow();
  });
});
