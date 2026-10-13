-- Extra fields on claims: invoice, cliente, fantasía + checklist de videos revisados.
-- Nullable en text para no romper reclamos existentes; booleans con default false.

alter table claims
  add column invoice_number         text,
  add column client_name            text,
  add column fantasy_name           text,
  add column video_armado_reviewed  boolean not null default false,
  add column video_cliente_reviewed boolean not null default false;
