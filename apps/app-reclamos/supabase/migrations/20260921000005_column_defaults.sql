-- Migration 005: responsable default por columna
-- Al mover una tarjeta a la columna, el default se preselecciona en el prompt.

create table public.column_defaults (
  column_key text primary key check (column_key in (
    'nuevo','deposito_revisa','respuesta_deposito','shimano_valida','resuelto','cerrado'
  )),
  default_assignee_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.column_defaults enable row level security;

create policy "column_defaults_select_authed" on public.column_defaults
  for select using (auth.role() = 'authenticated');
create policy "column_defaults_insert_admin" on public.column_defaults
  for insert with check (public.is_admin());
create policy "column_defaults_update_admin" on public.column_defaults
  for update using (public.is_admin());
create policy "column_defaults_delete_admin" on public.column_defaults
  for delete using (public.is_admin());

create trigger column_defaults_updated_at
  before update on public.column_defaults
  for each row execute function public.set_updated_at();
