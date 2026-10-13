-- v1259 (2026-10-13): columna claim_type al crear reclamo.
-- Pedido Mariano: lista desplegable obligatoria con 5 tipos al cargar.
--
-- Nullable para no romper reclamos existentes (no tenian este campo).
-- CHECK constraint permite null + los 5 valores canonicos.

alter table claims
  add column claim_type text;

alter table claims
  add constraint claims_claim_type_check
  check (
    claim_type is null or claim_type in (
      'transporte_rotura',
      'faltante',
      'error_armado',
      'sobrante',
      'producto_erroneo'
    )
  );

comment on column claims.claim_type is
  'Tipo de reclamo elegido al crear. Introducido v1259 (2026-10-13). Nullable para reclamos pre-v1259.';
