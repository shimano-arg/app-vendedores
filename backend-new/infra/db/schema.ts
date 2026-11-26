/**
 * Types TS para Kysely contra el schema PG (ADR-001).
 *
 * Mantenido a mano (no codegen) para mantener control explicito sobre:
 *   - Branding de tipos nullable (`Generated<T>` para columns con DEFAULT).
 *   - JSONB shapes tipados (transferido_sap, revision_waitlist.items).
 *   - Enums estrictos (`line_state_enum`, `warehouse_enum`, etc.).
 *
 * Fuente: `backend-new/db/schema/0001_initial.sql`.
 * Si el schema cambia, actualizar este archivo + los repos que lo consumen.
 */

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

// ---------------------------------------------------------------------------
// Enums (match schema.sql CREATE TYPE)
// ---------------------------------------------------------------------------

export type LineState =
  | 'BO'
  | 'ASIG'
  | 'confirmed'
  | 'invoiced'
  | 'cancelled';

export type Warehouse = 'dep_11' | 'dep_12';

export type PedidoOrigen =
  | 'manual'
  | 'cpst'
  | 'excel'
  | 'reparto'
  | 'backorder'
  | 'sap_sync';

export type RepartoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

// ---------------------------------------------------------------------------
// Shape de columnas JSONB
// ---------------------------------------------------------------------------

/**
 * Shape del field `pedidos.transferido_sap` (JSONB).
 * CLAUDE.md §40.8: `orderDocEntry` presente ⇒ confirmed no reserva.
 */
export interface TransferidoSapJson {
  docEntry?: number;
  docNum?: number;
  orderDocEntry?: number;
  orderDocNum?: number;
  transferredAt?: string;
}

/**
 * Shape de `revision_waitlist.items` (JSONB array en v0).
 */
export interface WaitlistItemJson {
  code: string;
  qty: number;
  qtyOpen?: number;
  state?: LineState;
  origen?: 'stock-asignado' | 'manual';
  asigRefs?: Array<{
    pedidoId: string;
    lineIndex: number;
    qtyAsignada: number;
  }>;
}

// ---------------------------------------------------------------------------
// Tabla: stock_snapshot
// ---------------------------------------------------------------------------

export interface StockSnapshotTable {
  sku: string;
  warehouse: Warehouse;
  physical_qty: number;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  source: Generated<string>;
}

export type StockSnapshotRow = Selectable<StockSnapshotTable>;
export type NewStockSnapshot = Insertable<StockSnapshotTable>;
export type StockSnapshotUpdate = Updateable<StockSnapshotTable>;

// ---------------------------------------------------------------------------
// Tabla: pedidos
// ---------------------------------------------------------------------------

export interface PedidosTable {
  id: Generated<string>;
  order_number: number;
  client_card_code: string;
  client_name: string;
  assigned_vendor_uid: string;
  assigned_vendor_key: string;
  owner_uid: string;
  cargado_por_uid: string;
  origen: Generated<PedidoOrigen>;
  draft_id: string | null;
  transferido_sap: ColumnType<TransferidoSapJson, TransferidoSapJson | undefined, TransferidoSapJson>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  first_invoiced_at: Date | null;
  cobrado_at: Date | null;
  closed_at: Date | null;
  closed_reason: string | null;
  closed_by: string | null;
}

export type PedidoRow = Selectable<PedidosTable>;
export type NewPedido = Insertable<PedidosTable>;
export type PedidoUpdate = Updateable<PedidosTable>;

// ---------------------------------------------------------------------------
// Tabla: pedido_lines
// ---------------------------------------------------------------------------

export interface PedidoLinesTable {
  pedido_id: string;
  line_index: number;
  sku: string;
  state: LineState;
  qty: number;
  qty_open: number;
  qty_cancelled: Generated<number>;
  price_ars: ColumnType<string, number | string, number | string>; // NUMERIC → string JS (precision)
  discount_percent: Generated<string>; // NUMERIC → string
  en_transito: Generated<boolean>;
  asig_at_transito: Date | null;
  en_dep11_at: Date | null;
  asig_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  asig_revertida_at: Date | null;
  asig_revertida_by: string | null;
  asig_revertida_reason: string | null;
  split_from_line_index: number | null;
  closed_reason: string | null;
  closed_by: string | null;
  cancelled_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type PedidoLineRow = Selectable<PedidoLinesTable>;
export type NewPedidoLine = Insertable<PedidoLinesTable>;
export type PedidoLineUpdate = Updateable<PedidoLinesTable>;

// ---------------------------------------------------------------------------
// Tabla: stock_reservations
// ---------------------------------------------------------------------------

export interface StockReservationsTable {
  pedido_id: string;
  line_index: number;
  sku: string;
  warehouse: Warehouse;
  qty: number;
  state: LineState;
  asig_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type StockReservationRow = Selectable<StockReservationsTable>;

// ---------------------------------------------------------------------------
// Tabla: revision_waitlist
// ---------------------------------------------------------------------------

export interface RevisionWaitlistTable {
  id: Generated<string>;
  order_number: number;
  client_card_code: string;
  client_name: string;
  assigned_vendor_uid: string;
  owner_uid: string;
  source: Generated<string>;
  items: ColumnType<WaitlistItemJson[], WaitlistItemJson[] | undefined, WaitlistItemJson[]>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type RevisionWaitlistRow = Selectable<RevisionWaitlistTable>;

// ---------------------------------------------------------------------------
// Tabla: waitlist_asig_refs
// ---------------------------------------------------------------------------

export interface WaitlistAsigRefsTable {
  waitlist_id: string;
  item_index: number;
  pedido_origen_id: string;
  line_index_origen: number;
  qty: number;
}

// ---------------------------------------------------------------------------
// Tabla: ingresos_reparto
// ---------------------------------------------------------------------------

export interface IngresosRepartoTable {
  id: Generated<string>;
  sku: string;
  qty: number;
  warehouse: Generated<Warehouse>;
  source: Generated<string>;
  status: Generated<RepartoStatus>;
  closed_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  closed_at: Date | null;
}

export type IngresoRepartoRow = Selectable<IngresosRepartoTable>;

// ---------------------------------------------------------------------------
// Tabla: pedido_draft_locks
// ---------------------------------------------------------------------------

export interface PedidoDraftLocksTable {
  draft_id: string;
  pedido_id: string;
  card_code: string;
  origen: PedidoOrigen | null;
  owner_uid: string;
  created_at: Generated<Date>;
}

export type PedidoDraftLockRow = Selectable<PedidoDraftLocksTable>;

// ---------------------------------------------------------------------------
// View: v_stock_breakdown
// ---------------------------------------------------------------------------

export interface VStockBreakdownView {
  sku: string;
  fisico_dep11: number;
  transito_dep12: number;
  backorder_app: number;
  asignadas_dep11: number;
  confirmadas_dep11: number;
  asignadas_dep12: number;
  confirmadas_dep12: number;
  reservadas_dep11: number;
  libre_dep11: number;
}

export type VStockBreakdownRow = Selectable<VStockBreakdownView>;

// ---------------------------------------------------------------------------
// Root Database interface — lo que Kysely ve
// ---------------------------------------------------------------------------

export interface Database {
  stock_snapshot: StockSnapshotTable;
  pedidos: PedidosTable;
  pedido_lines: PedidoLinesTable;
  stock_reservations: StockReservationsTable;
  revision_waitlist: RevisionWaitlistTable;
  waitlist_asig_refs: WaitlistAsigRefsTable;
  ingresos_reparto: IngresosRepartoTable;
  pedido_draft_locks: PedidoDraftLocksTable;
  v_stock_breakdown: VStockBreakdownView;
}
