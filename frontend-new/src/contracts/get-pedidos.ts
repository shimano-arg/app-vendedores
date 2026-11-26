/**
 * Contrato Zod del endpoint `GET /api/pedidos?cardCode=<C>&cursor=<opaque>` (ADR-013 P1.6).
 *
 * Shape alineado con #1477 `backend-new/shared/contracts/get-pedidos.ts`. Keyset paginated.
 */

import { z } from 'zod';
import { apiOkEnvelope, CardCode, IsoTimestamp, PageInfo, Pagination } from './common.js';

export const PedidoStageFilter = z.enum(['open', 'closed']);
export type PedidoStageFilter = z.infer<typeof PedidoStageFilter>;

export const GetPedidosByClientQuery = z.object({
  cardCode: CardCode,
  stage: PedidoStageFilter.default('open'),
  ...Pagination.shape,
});
export type GetPedidosByClientQuery = z.infer<typeof GetPedidosByClientQuery>;

export const PedidoLineSlim = z.object({
  sku: z.string(),
  state: z.enum(['BO', 'ASIG', 'confirmed', 'invoiced', 'cancelled']),
  qty: z.number().int().positive(),
  qtyOpen: z.number().int().nonnegative(),
  priceArs: z.number().nonnegative(),
  discountPercent: z.number().min(0).max(100),
});
export type PedidoLineSlim = z.infer<typeof PedidoLineSlim>;

export const PedidoSlim = z.object({
  id: z.string(),
  orderNumber: z.number().int().positive(),
  clientCardCode: z.string(),
  clientName: z.string(),
  stage: PedidoStageFilter,
  origen: z.enum(['manual', 'cpst', 'excel', 'reparto', 'backorder', 'sap_sync']),
  createdAt: IsoTimestamp,
  confirmedAt: IsoTimestamp.nullable(),
  netAmountArs: z.number().nullable(),
  lines: z.array(PedidoLineSlim),
});
export type PedidoSlim = z.infer<typeof PedidoSlim>;

export const GetPedidosByClientOutput = z.object({
  items: z.array(PedidoSlim),
  pageInfo: PageInfo,
});
export type GetPedidosByClientOutput = z.infer<typeof GetPedidosByClientOutput>;

export const GetPedidosByClientResponse = apiOkEnvelope(GetPedidosByClientOutput);
export type GetPedidosByClientResponse = z.infer<typeof GetPedidosByClientResponse>;
