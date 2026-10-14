-- v1263 (2026-10-13): index para query de "stuck claims".
-- Query típica: claims abiertos sin movimiento (move/comment) > N horas.
-- Compound index acelera el filtro updated_at + current_column.

create index if not exists claims_updated_at_open_idx
  on claims (updated_at)
  where current_column not in ('resuelto', 'cerrado');

comment on index claims_updated_at_open_idx is
  'Partial index para query de reclamos stuck. v1263 (2026-10-13).';
