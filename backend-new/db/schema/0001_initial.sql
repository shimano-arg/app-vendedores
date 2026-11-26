-- ============================================================================
-- Migration 0001 — Initial schema for pedidos + lines + reservations
-- ============================================================================
-- Context: ADR-001 (docs/adr/0001-modelo-datos-pedidos-pg.md)
-- Scope:   Schema v0 para migracion gradual Firestore -> PostgreSQL.
--          No production-ready. No incluye `clientes`, `roles`, `app_config`,
--          `operations_log` (fuera de scope v0).
-- Author:  database-architect (branch feat/s10-pg-schema-adr001)
-- Date:    2026-11-26
-- ============================================================================
-- Convenciones:
--   - snake_case para tablas y columnas.
--   - TIMESTAMPTZ para todas las fechas (UTC, nunca TIMESTAMP sin TZ).
--   - Primary keys TEXT (compat con doc IDs Firestore) o SERIAL donde no hay
--     equivalente Firestore.
--   - Enums para estados estables (line_state_enum).
--   - Triggers y advisory locks para invariantes agregadas (reserva <= fisico).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensiones y tipos
-- ---------------------------------------------------------------------------

-- UUID gen (si en el futuro queremos UUID en vez de IDs Firestore).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Estados de linea (§40 CLAUDE.md).
-- BO         = back order, cola; NO reserva.
-- ASIG       = asignado a cliente con TTL 7d; reserva.
-- confirmed  = confirmado sin facturar, TTL soft 7d + hard 60d; reserva
--              EXCEPTO si tiene orderDocEntry SAP (§40.8 — doble conteo).
-- invoiced   = facturado, ya salio de stock; NO reserva.
-- cancelled  = cancelado por VDE o admin; NO reserva.
CREATE TYPE line_state_enum AS ENUM (
  'BO',
  'ASIG',
  'confirmed',
  'invoiced',
  'cancelled'
);

-- Warehouse: 11 = fisico vendible Argentina; 12 = transito Uruguay.
-- Expansion futura (ej. deposito VIP cliente) agrega valores aca.
CREATE TYPE warehouse_enum AS ENUM ('dep_11', 'dep_12');

-- Origen del pedido — para auditoria y filtros de scope (§33).
CREATE TYPE pedido_origen_enum AS ENUM (
  'manual',       -- VDE carga normal.
  'cpst',         -- Crear Pedido Desde Stock Asignado.
  'excel',        -- Importacion Excel.
  'reparto',      -- Reparto Pablo convierte BO en ASIG.
  'backorder',    -- Generar Backorder (§40.9).
  'sap_sync'      -- Pedidos ingestados por sync SAP -> app.
);

-- ---------------------------------------------------------------------------
-- 1. Stock snapshot (fuente de verdad del fisico)
-- ---------------------------------------------------------------------------
-- Alimentada por el sync SAP (fuera de scope de este schema; ADR-008 cubrira
-- la ingesta). Aca solo definimos el shape + el trigger defensivo que rechaza
-- updates que dejen reservaciones sin cobertura.

CREATE TABLE stock_snapshot (
  sku            TEXT NOT NULL,
  warehouse      warehouse_enum NOT NULL,
  physical_qty   INTEGER NOT NULL CHECK (physical_qty >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source         TEXT NOT NULL DEFAULT 'manual',  -- 'sap_sync' | 'manual' | 'seed'
  PRIMARY KEY (sku, warehouse)
);

COMMENT ON TABLE stock_snapshot IS
  'Fisico actual por SKU y warehouse. Fuente: sync SAP (via ADR-008). ' ||
  'Trigger t_stock_snapshot_guard protege contra bajar debajo de reservations activas.';

COMMENT ON COLUMN stock_snapshot.physical_qty IS
  'Unidades fisicas disponibles en el warehouse. Nunca negativo (CHECK). ' ||
  'Puede subir por ingreso o bajar por venta real (invoiced). ' ||
  'El trigger no deja bajar debajo de SUM(stock_reservations.qty) activas.';


-- ---------------------------------------------------------------------------
-- 2. Pedidos (cabecera)
-- ---------------------------------------------------------------------------

CREATE TABLE pedidos (
  -- Primary key: mantenemos TEXT para compat con IDs Firestore auto-generados
  -- durante la migracion. En v1 se puede migrar a UUID.
  id                     TEXT PRIMARY KEY DEFAULT ('p_' || encode(gen_random_bytes(10), 'hex')),

  -- Numero visible al vendedor. Unico global (§912, counters/orderNumber).
  order_number           INTEGER NOT NULL UNIQUE CHECK (order_number > 0),

  -- Cliente — FK a tabla clientes (fuera de scope v0). Aca solo codigo + nombre
  -- desnormalizado para search rapido.
  client_card_code       TEXT NOT NULL,          -- ej. 'C001'
  client_name            TEXT NOT NULL,          -- ej. 'cliente A'

  -- Vendor asignado. VDE que es dueno de este pedido segun §44 (viene del
  -- master del cliente). Usado para filtros VDE (§59) — index obligatorio.
  assigned_vendor_uid    TEXT NOT NULL,          -- ej. 'vendedor-01'
  assigned_vendor_key    TEXT NOT NULL,          -- VendorKey del master (§44)

  -- Quien cargo el pedido. Normalmente == assigned_vendor_uid; para Pablo
  -- cargando por el equipo (§108.2) es distinto.
  owner_uid              TEXT NOT NULL,
  cargado_por_uid        TEXT NOT NULL,          -- v1-equivalente de cargadoPorUid

  -- Origen del flow (auditoria + scope).
  origen                 pedido_origen_enum NOT NULL DEFAULT 'manual',

  -- Idempotency key. UNIQUE con partial index para permitir NULLs sin colision.
  -- Draft lock (§64.3) tambien escribe aca.
  draft_id               TEXT,

  -- Flags SAP (sync-sap-orders-core.js §40.8).
  transferido_sap        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Shape: { docEntry?, docNum?, orderDocEntry?, orderDocNum?, transferredAt? }
  -- orderDocEntry presente => linea confirmed NO reserva (doble conteo §40.8).

  -- Timestamps.
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_invoiced_at      TIMESTAMPTZ,            -- Planner timing (§1128+1129)
  cobrado_at             TIMESTAMPTZ,            -- Planner timing

  -- closed_at NULL = abierto. Query dominante `WHERE closed_at IS NULL` (14+
  -- call-sites) se beneficia de partial index + cardinalidad baja de abiertos.
  closed_at              TIMESTAMPTZ,

  -- Audit soft-delete (nunca borramos pedidos).
  closed_reason          TEXT,
  closed_by              TEXT,

  CHECK (
    (closed_at IS NULL AND closed_reason IS NULL AND closed_by IS NULL) OR
    (closed_at IS NOT NULL AND closed_reason IS NOT NULL)
  )
);

-- Partial unique sobre draft_id — permite NULLs sin colision.
CREATE UNIQUE INDEX uq_pedidos_draft_id
  ON pedidos (draft_id)
  WHERE draft_id IS NOT NULL;

-- Query dominante: VDE ve sus pedidos abiertos.
CREATE INDEX ix_pedidos_vendor_open
  ON pedidos (assigned_vendor_uid)
  WHERE closed_at IS NULL;

-- Query de scope admin: todos los pedidos abiertos ordenados por fecha.
CREATE INDEX ix_pedidos_open_created
  ON pedidos (created_at DESC)
  WHERE closed_at IS NULL;

-- Query por cliente (ver todos los pedidos de un cliente).
CREATE INDEX ix_pedidos_client
  ON pedidos (client_card_code, created_at DESC);

-- Query por owner (auditoria + legacy pre-§44).
CREATE INDEX ix_pedidos_owner_open
  ON pedidos (owner_uid)
  WHERE closed_at IS NULL;


-- ---------------------------------------------------------------------------
-- 3. Pedido lines
-- ---------------------------------------------------------------------------
-- 1 fila por (pedido_id, line_index). La line_index preserva el orden visual
-- del pedido en la UI + sirve de clave estable para `splitFromLineIndex`.

CREATE TABLE pedido_lines (
  pedido_id              TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  line_index             INTEGER NOT NULL CHECK (line_index >= 0),

  sku                    TEXT NOT NULL,
  state                  line_state_enum NOT NULL,

  qty                    INTEGER NOT NULL CHECK (qty > 0),
  qty_open               INTEGER NOT NULL CHECK (qty_open >= 0),
  qty_cancelled          INTEGER NOT NULL DEFAULT 0 CHECK (qty_cancelled >= 0),

  -- Precio para calcular Va a SAP (§53). Decimal para plata.
  price_ars              NUMERIC(14,2) NOT NULL CHECK (price_ars >= 0),
  discount_percent       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),

  -- Dep 12 flags (§107).
  en_transito            BOOLEAN NOT NULL DEFAULT FALSE,
  asig_at_transito       TIMESTAMPTZ,
  en_dep11_at            TIMESTAMPTZ,

  -- Timestamps para TTL (§37, §38, §40 FIFO).
  asig_at                TIMESTAMPTZ,            -- Cuando paso a ASIG (FIFO).
  confirmed_at           TIMESTAMPTZ,            -- Cuando paso a confirmed.
  cancelled_at           TIMESTAMPTZ,

  -- Audit de reversiones (§40.5, §40.6, §40.7).
  asig_revertida_at      TIMESTAMPTZ,
  asig_revertida_by      TEXT,
  asig_revertida_reason  TEXT,
  split_from_line_index  INTEGER,                -- Apunta a la linea padre del split.

  closed_reason          TEXT,
  closed_by              TEXT,
  cancelled_by           TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (pedido_id, line_index),

  -- Invariantes de shape.
  CHECK (qty_open + qty_cancelled <= qty),
  CHECK (
    -- Solo lineas activas (BO/ASIG/confirmed) pueden tener qty_open > 0.
    (state IN ('invoiced', 'cancelled') AND qty_open = 0) OR
    (state IN ('BO', 'ASIG', 'confirmed'))
  ),
  CHECK (
    -- en_transito solo tiene sentido en ASIG o confirmed.
    (en_transito = FALSE) OR
    (en_transito = TRUE AND state IN ('ASIG', 'confirmed'))
  ),
  CHECK (
    -- Si la linea cruzo a dep 11, asig_at_transito debe ser anterior.
    en_dep11_at IS NULL OR
    asig_at_transito IS NULL OR
    en_dep11_at >= asig_at_transito
  )
);

-- Un SKU aparece una sola vez por pedido (§56, v1435).
-- Solo aplicamos esta regla a lineas vivas (qty_open > 0) para permitir que
-- cancellations + splits con mismo SKU convivan como registros historicos.
CREATE UNIQUE INDEX uq_pedido_lines_sku_unique_active
  ON pedido_lines (pedido_id, sku)
  WHERE state IN ('BO', 'ASIG', 'confirmed') AND qty_open > 0;

-- Query dominante del breakdown: que lineas reservan para un SKU dado.
CREATE INDEX ix_pedido_lines_sku_reserving
  ON pedido_lines (sku, state, asig_at)
  WHERE state IN ('ASIG', 'confirmed') AND qty_open > 0;

-- Query por pedido (JOIN desde pedidos).
CREATE INDEX ix_pedido_lines_pedido
  ON pedido_lines (pedido_id);

-- FIFO ASIG (§40.3): orden por asig_at ASC entre lineas del mismo SKU en estado
-- ASIG y vivas.
CREATE INDEX ix_pedido_lines_fifo_asig
  ON pedido_lines (sku, asig_at)
  WHERE state = 'ASIG' AND qty_open > 0;


-- ---------------------------------------------------------------------------
-- 4. Stock reservations — invariante central (reserva <= fisico libre)
-- ---------------------------------------------------------------------------
-- Tabla 1:1 con pedido_lines que reservan stock. Mantenida por triggers sobre
-- pedido_lines INSERT/UPDATE/DELETE. La consistencia con pedido_lines queda
-- blindada; la invariante (reserva <= fisico) tambien.

CREATE TABLE stock_reservations (
  pedido_id              TEXT NOT NULL,
  line_index             INTEGER NOT NULL,

  sku                    TEXT NOT NULL,
  warehouse              warehouse_enum NOT NULL,
  qty                    INTEGER NOT NULL CHECK (qty > 0),
  state                  line_state_enum NOT NULL,

  -- Para FIFO (§40.3). Mantenido en sync con pedido_lines.asig_at por el
  -- trigger (no es columna "derivada" en el sentido SQL — es espejo).
  asig_at                TIMESTAMPTZ,

  -- Para auditoria.
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (pedido_id, line_index),
  FOREIGN KEY (pedido_id, line_index) REFERENCES pedido_lines(pedido_id, line_index) ON DELETE CASCADE,
  FOREIGN KEY (sku, warehouse) REFERENCES stock_snapshot(sku, warehouse)
);

-- Index para la query dominante del trigger: SUM(qty) WHERE sku + warehouse.
CREATE INDEX ix_stock_reservations_sku_warehouse
  ON stock_reservations (sku, warehouse);

COMMENT ON TABLE stock_reservations IS
  'Tabla sincronizada con pedido_lines (via trigger t_reservations_sync). ' ||
  'Invariante: SUM(qty) WHERE sku+warehouse <= stock_snapshot.physical_qty. ' ||
  'Garantizada por t_reservations_check_invariant.';


-- ---------------------------------------------------------------------------
-- 5. Revision waitlist (CPST — §40.6)
-- ---------------------------------------------------------------------------

CREATE TABLE revision_waitlist (
  id                     TEXT PRIMARY KEY DEFAULT ('w_' || encode(gen_random_bytes(10), 'hex')),
  order_number           INTEGER NOT NULL,

  client_card_code       TEXT NOT NULL,
  client_name            TEXT NOT NULL,
  assigned_vendor_uid    TEXT NOT NULL,
  owner_uid              TEXT NOT NULL,

  -- Source = 'stock-asignado-batch' discrimina CPST de drafts comunes.
  source                 TEXT NOT NULL DEFAULT 'manual',

  -- Items aqui como JSONB para v0 (shape dinamico de la UI). La tabla
  -- waitlist_asig_refs cubre las refs cross-pedido (ver abajo).
  items                  JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_revision_waitlist_vendor
  ON revision_waitlist (assigned_vendor_uid);

CREATE INDEX ix_revision_waitlist_client
  ON revision_waitlist (client_card_code);


-- Refs de ASIG -> waitlist (§40.6 collectAsigRefsForCancel).
CREATE TABLE waitlist_asig_refs (
  waitlist_id            TEXT NOT NULL REFERENCES revision_waitlist(id) ON DELETE CASCADE,
  item_index             INTEGER NOT NULL CHECK (item_index >= 0),

  pedido_origen_id       TEXT NOT NULL,
  line_index_origen      INTEGER NOT NULL,
  qty                    INTEGER NOT NULL CHECK (qty > 0),

  PRIMARY KEY (waitlist_id, item_index, pedido_origen_id, line_index_origen),
  FOREIGN KEY (pedido_origen_id, line_index_origen) REFERENCES pedido_lines(pedido_id, line_index) ON DELETE CASCADE
);


-- ---------------------------------------------------------------------------
-- 6. Ingresos reparto (Pablo distribuye stock a clientes BO)
-- ---------------------------------------------------------------------------

CREATE TYPE reparto_status_enum AS ENUM ('pending', 'in_progress', 'done', 'cancelled');

CREATE TABLE ingresos_reparto (
  id                     TEXT PRIMARY KEY DEFAULT ('r_' || encode(gen_random_bytes(10), 'hex')),
  sku                    TEXT NOT NULL,
  qty                    INTEGER NOT NULL CHECK (qty > 0),
  warehouse              warehouse_enum NOT NULL DEFAULT 'dep_11',
  source                 TEXT NOT NULL DEFAULT 'dep11',    -- 'dep11' | 'dep12' (§107)
  status                 reparto_status_enum NOT NULL DEFAULT 'pending',

  closed_reason          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at              TIMESTAMPTZ
);

-- Dedupe §107 §40: un SKU puede tener solo un reparto activo por source.
CREATE UNIQUE INDEX uq_ingresos_reparto_sku_source_active
  ON ingresos_reparto (sku, source)
  WHERE status IN ('pending', 'in_progress');


-- ---------------------------------------------------------------------------
-- 7. Pedido draft locks (§64.3 idempotency)
-- ---------------------------------------------------------------------------

CREATE TABLE pedido_draft_locks (
  draft_id               TEXT PRIMARY KEY,
  pedido_id              TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  card_code              TEXT NOT NULL,
  origen                 pedido_origen_enum,
  owner_uid              TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pedido_draft_locks IS
  'Idempotency key para commits concurrentes (§64.3). INSERT con ON CONFLICT ' ||
  'DO NOTHING RETURNING pedido_id. Si no devuelve filas, el lock existia y el ' ||
  'caller debe hacer SELECT pedido_id FROM pedido_draft_locks WHERE draft_id=$1.';


-- ============================================================================
-- TRIGGERS Y FUNCIONES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: lineReservesStock (espejo de src/pure/stock-realmente-disponible.js)
-- ---------------------------------------------------------------------------
-- Dado una fila de pedido_lines (y el doc pedido), decide si reserva stock.
-- Reglas §40:
--   - BO     => NO reserva.
--   - ASIG   => reserva (sin excepciones post-v1402, §40.10).
--   - confirmed => reserva EXCEPTO si pedido.transferido_sap.orderDocEntry
--                  esta presente (§40.8).
--   - invoiced / cancelled => NO reserva.
--   - qty_open=0 => NO reserva (no queda nada para entregar).
CREATE OR REPLACE FUNCTION line_reserves_stock(
  p_state line_state_enum,
  p_qty_open INTEGER,
  p_transferido_sap JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_qty_open <= 0 THEN
    RETURN FALSE;
  END IF;

  CASE p_state
    WHEN 'BO' THEN RETURN FALSE;
    WHEN 'invoiced' THEN RETURN FALSE;
    WHEN 'cancelled' THEN RETURN FALSE;
    WHEN 'ASIG' THEN RETURN TRUE;
    WHEN 'confirmed' THEN
      -- §40.8: confirmed con orderDocEntry en SAP ya esta descontado alla.
      IF p_transferido_sap IS NOT NULL
         AND p_transferido_sap ? 'orderDocEntry'
         AND p_transferido_sap->>'orderDocEntry' IS NOT NULL
         AND p_transferido_sap->>'orderDocEntry' <> '' THEN
        RETURN FALSE;
      END IF;
      RETURN TRUE;
  END CASE;
END;
$$;


-- ---------------------------------------------------------------------------
-- Trigger: sync pedido_lines -> stock_reservations
-- ---------------------------------------------------------------------------
-- AFTER INSERT/UPDATE/DELETE sobre pedido_lines, mantiene stock_reservations
-- en espejo.

CREATE OR REPLACE FUNCTION fn_sync_stock_reservations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_transferido_sap JSONB;
  v_reserves BOOLEAN;
  v_warehouse warehouse_enum;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM stock_reservations
      WHERE pedido_id = OLD.pedido_id AND line_index = OLD.line_index;
    RETURN OLD;
  END IF;

  -- INSERT u UPDATE: resolver si reserva.
  SELECT transferido_sap INTO v_transferido_sap
    FROM pedidos WHERE id = NEW.pedido_id;

  v_reserves := line_reserves_stock(NEW.state, NEW.qty_open, v_transferido_sap);
  v_warehouse := CASE WHEN NEW.en_transito THEN 'dep_12'::warehouse_enum ELSE 'dep_11'::warehouse_enum END;

  IF v_reserves THEN
    -- Advisory lock sobre (sku, warehouse) para serializar con otros
    -- reservations concurrentes del mismo SKU.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.sku || v_warehouse::TEXT, 0));

    INSERT INTO stock_reservations (
      pedido_id, line_index, sku, warehouse, qty, state, asig_at, updated_at
    ) VALUES (
      NEW.pedido_id, NEW.line_index, NEW.sku, v_warehouse,
      NEW.qty_open, NEW.state, NEW.asig_at, NOW()
    )
    ON CONFLICT (pedido_id, line_index) DO UPDATE SET
      sku        = EXCLUDED.sku,
      warehouse  = EXCLUDED.warehouse,
      qty        = EXCLUDED.qty,
      state      = EXCLUDED.state,
      asig_at    = EXCLUDED.asig_at,
      updated_at = NOW();
  ELSE
    DELETE FROM stock_reservations
      WHERE pedido_id = NEW.pedido_id AND line_index = NEW.line_index;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER t_pedido_lines_sync_reservations
  AFTER INSERT OR UPDATE OR DELETE ON pedido_lines
  FOR EACH ROW EXECUTE FUNCTION fn_sync_stock_reservations();


-- ---------------------------------------------------------------------------
-- Trigger: invariante reserva <= fisico libre
-- ---------------------------------------------------------------------------
-- AFTER INSERT/UPDATE sobre stock_reservations, valida que
-- SUM(qty) <= stock_snapshot.physical_qty para (sku, warehouse). Si no, raise.
-- El advisory lock del trigger anterior (fn_sync_stock_reservations) impide
-- race con otras transacciones.

CREATE OR REPLACE FUNCTION fn_check_reservation_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_reserved INTEGER;
  v_physical_qty   INTEGER;
BEGIN
  SELECT COALESCE(SUM(qty), 0) INTO v_total_reserved
    FROM stock_reservations
    WHERE sku = NEW.sku AND warehouse = NEW.warehouse;

  SELECT physical_qty INTO v_physical_qty
    FROM stock_snapshot
    WHERE sku = NEW.sku AND warehouse = NEW.warehouse;

  -- Si no existe snapshot para el SKU, physical_qty = 0 => cualquier reserva viola.
  v_physical_qty := COALESCE(v_physical_qty, 0);

  IF v_total_reserved > v_physical_qty THEN
    RAISE EXCEPTION
      'STOCK_RESERVATION_OVERRUN: sku=%, warehouse=%, reserved=%, physical=%',
      NEW.sku, NEW.warehouse, v_total_reserved, v_physical_qty
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER t_stock_reservations_check_invariant
  AFTER INSERT OR UPDATE ON stock_reservations
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION fn_check_reservation_invariant();


-- ---------------------------------------------------------------------------
-- Trigger: proteger stock_snapshot de bajar debajo de reservations activas
-- ---------------------------------------------------------------------------
-- Si el sync SAP intenta bajar physical_qty por debajo de SUM(reservations),
-- rechazamos el update. En v0 esta politica es conservadora; en v1 podemos
-- cambiar a "aceptar + marcar sobre_asignada" (§40.11).

CREATE OR REPLACE FUNCTION fn_check_snapshot_decrease()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_reserved INTEGER;
BEGIN
  IF NEW.physical_qty >= COALESCE(OLD.physical_qty, 0) THEN
    -- Sube o igual: siempre OK.
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(qty), 0) INTO v_total_reserved
    FROM stock_reservations
    WHERE sku = NEW.sku AND warehouse = NEW.warehouse;

  IF NEW.physical_qty < v_total_reserved THEN
    RAISE EXCEPTION
      'STOCK_SNAPSHOT_UNDERRUN: sku=%, warehouse=%, new_physical=%, reserved=%',
      NEW.sku, NEW.warehouse, NEW.physical_qty, v_total_reserved
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER t_stock_snapshot_guard
  BEFORE UPDATE ON stock_snapshot
  FOR EACH ROW EXECUTE FUNCTION fn_check_snapshot_decrease();


-- ---------------------------------------------------------------------------
-- Trigger: updated_at automatico en todas las tablas con ese campo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER t_pedidos_touch
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TRIGGER t_pedido_lines_touch
  BEFORE UPDATE ON pedido_lines
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TRIGGER t_revision_waitlist_touch
  BEFORE UPDATE ON revision_waitlist
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TRIGGER t_ingresos_reparto_touch
  BEFORE UPDATE ON ingresos_reparto
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();


-- ---------------------------------------------------------------------------
-- VIEW: stock_breakdown (equivalente a getStockBreakdown §39)
-- ---------------------------------------------------------------------------
-- Scope v0: VIEW regular (siempre fresca). En v1 podemos migrar a
-- MATERIALIZED VIEW + REFRESH CONCURRENTLY si profiling lo justifica.
-- Shape minimo — solo los campos criticos para el piloto. Expandible.

CREATE OR REPLACE VIEW v_stock_breakdown AS
WITH reservations_by_sku AS (
  SELECT
    sku,
    warehouse,
    SUM(qty) FILTER (WHERE state = 'ASIG')       AS qty_asig,
    SUM(qty) FILTER (WHERE state = 'confirmed')  AS qty_confirmed,
    SUM(qty)                                     AS qty_total
  FROM stock_reservations
  GROUP BY sku, warehouse
),
backorder_by_sku AS (
  SELECT
    pl.sku,
    SUM(pl.qty_open) AS qty_bo
  FROM pedido_lines pl
  WHERE pl.state = 'BO' AND pl.qty_open > 0
  GROUP BY pl.sku
)
SELECT
  s.sku,
  COALESCE(d11.physical_qty, 0)        AS fisico_dep11,
  COALESCE(d12.physical_qty, 0)        AS transito_dep12,
  COALESCE(bo.qty_bo, 0)               AS backorder_app,
  COALESCE(r11.qty_asig, 0)            AS asignadas_dep11,
  COALESCE(r11.qty_confirmed, 0)       AS confirmadas_dep11,
  COALESCE(r12.qty_asig, 0)            AS asignadas_dep12,
  COALESCE(r12.qty_confirmed, 0)       AS confirmadas_dep12,
  COALESCE(r11.qty_total, 0)           AS reservadas_dep11,
  GREATEST(COALESCE(d11.physical_qty, 0) - COALESCE(r11.qty_total, 0), 0) AS libre_dep11
FROM (
  SELECT DISTINCT sku FROM stock_snapshot
  UNION
  SELECT DISTINCT sku FROM pedido_lines WHERE qty_open > 0
) s
LEFT JOIN stock_snapshot d11
  ON d11.sku = s.sku AND d11.warehouse = 'dep_11'
LEFT JOIN stock_snapshot d12
  ON d12.sku = s.sku AND d12.warehouse = 'dep_12'
LEFT JOIN reservations_by_sku r11
  ON r11.sku = s.sku AND r11.warehouse = 'dep_11'
LEFT JOIN reservations_by_sku r12
  ON r12.sku = s.sku AND r12.warehouse = 'dep_12'
LEFT JOIN backorder_by_sku bo
  ON bo.sku = s.sku;

COMMENT ON VIEW v_stock_breakdown IS
  'Equivalente minimo de getStockBreakdown (§39). V0 shape: fisico, transito, ' ||
  'backorder app, asignadas por warehouse, confirmadas por warehouse, libre_dep11. ' ||
  'En v1 extender con waitlist_cpst, reparto_abierto, sobre_asignada FIFO.';


-- ============================================================================
-- Fin migracion 0001.
-- ============================================================================
