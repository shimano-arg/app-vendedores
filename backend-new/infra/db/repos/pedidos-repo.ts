/**
 * Repo de lectura de pedidos por cliente.
 *
 * Operacion piloto (ADR-013): `getPedidosByClient(cardCode, filters)`.
 * - Filtra por `client_card_code` (indexed: `ix_pedidos_client`).
 * - Filtra por `stage` ('open' → closed_at IS NULL, 'closed' → NOT NULL).
 * - Pagina por keyset `(created_at DESC, id DESC)` — estable para scroll.
 * - Hace JOIN a `pedido_lines` para traer el slim de lineas por pedido.
 *
 * El output es el shape del dominio (camelCase + Dates reales). El domain
 * layer mapea a `PedidoSlim` (Zod) y agrega `netAmountArs` computed.
 */

import type { Kysely } from 'kysely';
import type {
  Database,
  LineState,
  PedidoOrigen,
} from '../schema.js';

export interface PedidoLineRaw {
  pedidoId: string;
  lineIndex: number;
  sku: string;
  state: LineState;
  qty: number;
  qtyOpen: number;
  priceArs: number;
  discountPercent: number;
  confirmedAt: Date | null;
}

export interface PedidoRaw {
  id: string;
  orderNumber: number;
  clientCardCode: string;
  clientName: string;
  origen: PedidoOrigen;
  createdAt: Date;
  closedAt: Date | null;
  firstInvoicedAt: Date | null;
  lines: PedidoLineRaw[];
}

export interface PedidosRepoFilters {
  cardCode: string;
  stage: 'open' | 'closed';
  limit: number;
  /**
   * Cursor opaco. Formato interno: base64(`createdAt_iso|id`).
   * Si se provee, filtra: `(createdAt, id) < (cursor.createdAt, cursor.id)`
   * para traer pagina siguiente.
   */
  cursor?: string;
}

export interface PedidosRepoResult {
  items: PedidoRaw[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PedidosRepo {
  getPedidosByClient(filters: PedidosRepoFilters): Promise<PedidosRepoResult>;
}

// ---------------------------------------------------------------------------
// Cursor encoding — publico para tests
// ---------------------------------------------------------------------------

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parts = raw.split('|');
    if (parts.length !== 2) return null;
    const [iso, id] = parts;
    if (!iso || !id) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return { createdAt: d, id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

export function createPedidosRepo(db: Kysely<Database>): PedidosRepo {
  return {
    async getPedidosByClient(
      filters: PedidosRepoFilters,
    ): Promise<PedidosRepoResult> {
      // Pedimos limit+1 para detectar hasMore sin COUNT extra.
      const fetchLimit = filters.limit + 1;

      let q = db
        .selectFrom('pedidos as p')
        .where('p.client_card_code', '=', filters.cardCode)
        .select([
          'p.id',
          'p.order_number',
          'p.client_card_code',
          'p.client_name',
          'p.origen',
          'p.created_at',
          'p.closed_at',
          'p.first_invoiced_at',
        ])
        .orderBy('p.created_at', 'desc')
        .orderBy('p.id', 'desc')
        .limit(fetchLimit);

      if (filters.stage === 'open') {
        q = q.where('p.closed_at', 'is', null);
      } else {
        q = q.where('p.closed_at', 'is not', null);
      }

      if (filters.cursor) {
        const decoded = decodeCursor(filters.cursor);
        if (!decoded) {
          // Cursor invalido — el domain lo mapea a PEDIDOS_CURSOR_INVALIDO.
          throw new Error('CURSOR_INVALID');
        }
        // Keyset: (created_at, id) < (cursor.createdAt, cursor.id)
        q = q.where((eb) =>
          eb.or([
            eb('p.created_at', '<', decoded.createdAt),
            eb.and([
              eb('p.created_at', '=', decoded.createdAt),
              eb('p.id', '<', decoded.id),
            ]),
          ]),
        );
      }

      const rawPedidos = await q.execute();

      const hasMore = rawPedidos.length > filters.limit;
      const pagePedidos = hasMore
        ? rawPedidos.slice(0, filters.limit)
        : rawPedidos;

      // Fetch lineas de todos los pedidos de la pagina en 1 query (evita N+1).
      const pedidoIds = pagePedidos.map((p) => p.id);
      const lines = pedidoIds.length
        ? await db
            .selectFrom('pedido_lines')
            .where('pedido_id', 'in', pedidoIds)
            .select([
              'pedido_id',
              'line_index',
              'sku',
              'state',
              'qty',
              'qty_open',
              'price_ars',
              'discount_percent',
              'confirmed_at',
            ])
            .orderBy('pedido_id', 'asc')
            .orderBy('line_index', 'asc')
            .execute()
        : [];

      const linesByPedido = new Map<string, PedidoLineRaw[]>();
      for (const l of lines) {
        const arr = linesByPedido.get(l.pedido_id);
        const slim: PedidoLineRaw = {
          pedidoId: l.pedido_id,
          lineIndex: l.line_index,
          sku: l.sku,
          state: l.state,
          qty: l.qty,
          qtyOpen: l.qty_open,
          priceArs: Number(l.price_ars),
          discountPercent: Number(l.discount_percent),
          confirmedAt: l.confirmed_at,
        };
        if (arr) {
          arr.push(slim);
        } else {
          linesByPedido.set(l.pedido_id, [slim]);
        }
      }

      const items: PedidoRaw[] = pagePedidos.map((p) => ({
        id: p.id,
        orderNumber: p.order_number,
        clientCardCode: p.client_card_code,
        clientName: p.client_name,
        origen: p.origen,
        createdAt: p.created_at,
        closedAt: p.closed_at,
        firstInvoicedAt: p.first_invoiced_at,
        lines: linesByPedido.get(p.id) ?? [],
      }));

      const nextCursor =
        hasMore && items.length > 0
          ? (() => {
              const last = items[items.length - 1];
              if (!last) return null;
              return encodeCursor(last.createdAt, last.id);
            })()
          : null;

      return { items, nextCursor, hasMore };
    },
  };
}
