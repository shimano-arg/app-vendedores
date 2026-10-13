-- Migration 003: indices + trigger updated_at

create index if not exists claims_column_updated_idx
  on public.claims (current_column, updated_at desc);
create index if not exists claims_assignee_idx
  on public.claims (assignee_id);
create index if not exists claim_events_claim_created_idx
  on public.claim_events (claim_id, created_at desc);
create index if not exists attachments_claim_idx
  on public.attachments (claim_id);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger claims_updated_at
  before update on public.claims
  for each row execute function public.set_updated_at();
