/**
 * Contrato Zod — GET /api/v1/pedidos?cardCode=...
 *
 * Operacion piloto ADR-013. Lista slim de pedidos de un cliente.
 * Solo se exponen campos minimos que el mobile piloto necesita; nunca se
 * expone `transferido_sap`, `closed_reason`, auditoria interna, etc.
 */

import { z } from 'zod';
import {
  CardCode,
  IsoTimestamp,
  PageInfo,
  Pagination,
  apiOkEnvelope,
} from './common.js';

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------

/**
 * Stage del pedido visible al mobile (subset del `line_state_enum`).
 * El piloto ADR-013 muestra pedidos abiertos; en v1 se agregan filtros por
 * fecha, por estado SAP, etc.
 */
export const PedidoStageFilter = z.enum([
  'open', // closed_at IS NULL — todos los pedidos vivos del cliente
  'closed', // closed_at IS NOT NULL — historico
]);
export type PedidoStageFilter = z.infer<typeof PedidoStageFilter>;

/**
 * Query params de `GET /pedidos`.
 */
export const GetPedidosByClientQuery = z.object({
  cardCode: CardCode,
  stage: PedidoStageFilter.default('open'),
  ...Pagination.shape,
});
export type GetPedidosByClientQuery = z.infer<typeof GetPedidosByClientQuery>;

// ----------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------

/**
 * Linea slim — solo info visible en la tarjeta del pedido en mobile.
 * Omite audit (`asig_revertida_*`, `split_from_line_index`, etc.) y SAP
 * flags (`en_transito`, `asig_at_transito`) — se agregan cuando el piloto
 * mobile los necesite explicitamente.
 */
export const PedidoLineSlim = z.object({
  sku: z.string(),
  state: z.enum(['BO', 'ASIG', 'confirmed', 'invoiced', 'cancelled']),
  qty: z.number().int().positive(),
  qtyOpen: z.number().int().nonnegative(),
  priceArs: z.number().nonnegative(),
  discountPercent: z.number().min(0).max(100),
});
export type PedidoLineSlim = z.infer<typeof PedidoLineSlim>;

/**
 * Pedido slim — shape canonico del piloto ADR-013. Campos:
 *   - `id`               : Firestore doc ID (compat).
 *   - `orderNumber`      : numero visible (unique global).
 *   - `clientCardCode`   : cliente del pedido.
 *   - `clientName`       : desnorm para evitar JOIN en mobile.
 *   - `stage`            : "open" | "closed" (derived de `closed_at`).
 *   - `origen`           : flow de creacion (manual, cpst, excel, ...).
 *   - `createdAt`        : ISO timestamp.
 *   - `confirmedAt`      : cuando la primera linea paso a confirmed (null si aun no).
 *   - `netAmountArs`     : suma de (qty_open * price_ars * (1-discount_percent/100))
 *                          sobre lineas confirmed. Null si aun no se calculo.
 *   - `lines`            : lineas slim.
 */
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

/**
 * Output: coleccion de PedidoSlim + pageInfo.
 */
export const GetPedidosByClientOutput = z.object({
  items: z.array(PedidoSlim),
  pageInfo: PageInfo,
});
export type GetPedidosByClientOutput = z.infer<typeof GetPedidosByClientOutput>;

/**
 * Envelope 200 OK.
 */
export const GetPedidosByClientResponse = apiOkEnvelope(GetPedidosByClientOutput);
export type GetPedidosByClientResponse = z.infer<typeof GetPedidosByClientResponse>;
