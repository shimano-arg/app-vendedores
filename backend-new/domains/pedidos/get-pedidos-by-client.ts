/**
 * Domain fn `getPedidosByClient(cardCode, filters)` — ADR-013 piloto.
 *
 * Logica pura: recibe un `PedidosRepo` + filters validados. Mapea el shape
 * crudo del repo al shape `PedidoSlim` del contrato Zod (camelCase + ISO
 * strings + netAmountArs computed).
 */

import {
  GetPedidosByClientOutput,
  type GetPedidosByClientOutput as TOutput,
  type PedidoSlim,
  type PedidoLineSlim,
} from '../../shared/contracts/get-pedidos.js';
import { BusinessError, ERROR_CODES } from '../../shared/errors/business-errors.js';
import type { PedidosRepo, PedidoRaw, PedidoLineRaw } from '../../infra/db/repos/pedidos-repo.js';
import { IsoTimestamp } from '../../shared/contracts/common.js';

export interface GetPedidosByClientDeps {
  repo: PedidosRepo;
}

export interface GetPedidosByClientInput {
  cardCode: string;
  stage: 'open' | 'closed';
  limit: number;
  cursor?: string | undefined;
}

export async function getPedidosByClient(
  input: GetPedidosByClientInput,
  deps: GetPedidosByClientDeps,
): Promise<TOutput> {
  let result;
  try {
    const filters: Parameters<typeof deps.repo.getPedidosByClient>[0] = {
      cardCode: input.cardCode,
      stage: input.stage,
      limit: input.limit,
    };
    if (input.cursor !== undefined) {
      filters.cursor = input.cursor;
    }
    result = await deps.repo.getPedidosByClient(filters);
  } catch (e) {
    if (e instanceof Error && e.message === 'CURSOR_INVALID') {
      throw new BusinessError(ERROR_CODES.PEDIDOS_CURSOR_INVALIDO, {
        data: { cursor: input.cursor },
      });
    }
    throw e;
  }

  const items: PedidoSlim[] = result.items.map((p) => mapPedidoToSlim(p, input.stage));

  const output: TOutput = {
    items,
    pageInfo: {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    },
  };

  // Validar shape antes de devolver — defensa contra drift.
  return GetPedidosByClientOutput.parse(output);
}

// ---------------------------------------------------------------------------
// Mappers internos
// ---------------------------------------------------------------------------

function mapLineToSlim(line: PedidoLineRaw): PedidoLineSlim {
  return {
    sku: line.sku,
    state: line.state,
    qty: line.qty,
    qtyOpen: line.qtyOpen,
    priceArs: line.priceArs,
    discountPercent: line.discountPercent,
  };
}

/**
 * Deriva `confirmedAt` del pedido = min de `line.confirmedAt` entre lineas
 * confirmed. Null si no hay ninguna.
 */
function derivePedidoConfirmedAt(lines: PedidoLineRaw[]): Date | null {
  let min: Date | null = null;
  for (const l of lines) {
    if (l.state === 'confirmed' && l.confirmedAt) {
      if (!min || l.confirmedAt < min) {
        min = l.confirmedAt;
      }
    }
  }
  return min;
}

/**
 * Calcula `netAmountArs` = sum(qtyOpen * priceArs * (1-discountPercent/100))
 * sobre lineas confirmed. Null si no hay ninguna confirmed.
 */
function computeNetAmountArs(lines: PedidoLineRaw[]): number | null {
  let total = 0;
  let hasConfirmed = false;
  for (const l of lines) {
    if (l.state !== 'confirmed') continue;
    hasConfirmed = true;
    const discount = Math.min(Math.max(l.discountPercent, 0), 100) / 100;
    total += l.qtyOpen * l.priceArs * (1 - discount);
  }
  return hasConfirmed ? Math.round(total * 100) / 100 : null;
}

function mapPedidoToSlim(p: PedidoRaw, stage: 'open' | 'closed'): PedidoSlim {
  const confirmedAtDate = derivePedidoConfirmedAt(p.lines);
  const netAmountArs = computeNetAmountArs(p.lines);

  return {
    id: p.id,
    orderNumber: p.orderNumber,
    clientCardCode: p.clientCardCode,
    clientName: p.clientName,
    stage,
    origen: p.origen,
    createdAt: IsoTimestamp.parse(p.createdAt.toISOString()),
    confirmedAt: confirmedAtDate
      ? IsoTimestamp.parse(confirmedAtDate.toISOString())
      : null,
    netAmountArs,
    lines: p.lines.map(mapLineToSlim),
  };
}
