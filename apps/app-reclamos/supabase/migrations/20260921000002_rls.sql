-- Migration 002: RLS policies + storage bucket

alter table public.profiles enable row level security;
alter table public.claims enable row level security;
alter table public.claim_events enable row level security;
alter table public.attachments enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create policy "profiles_select_authed" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_insert_admin" on public.profiles
  for insert with check (public.is_admin());
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());
create policy "profiles_delete_admin" on public.profiles
  for delete using (public.is_admin());

create policy "claims_select_authed" on public.claims
  for select using (auth.role() = 'authenticated');
create policy "claims_insert_authed" on public.claims
  for insert with check (auth.role() = 'authenticated');
create policy "claims_update_assignee_or_admin" on public.claims
  for update using (assignee_id = auth.uid() or public.is_admin());
create policy "claims_delete_admin" on public.claims
  for delete using (public.is_admin());

create policy "claim_events_select_authed" on public.claim_events
  for select using (auth.role() = 'authenticated');
create policy "claim_events_insert_authed" on public.claim_events
  for insert with check (auth.role() = 'authenticated' and actor_id = auth.uid());
create policy "claim_events_delete_admin" on public.claim_events
  for delete using (public.is_admin());

create policy "attachments_select_authed" on public.attachments
  for select using (auth.role() = 'authenticated');
create policy "attachments_insert_authed" on public.attachments
  for insert with check (auth.role() = 'authenticated' and uploaded_by = auth.uid());
create policy "attachments_delete_uploader_or_admin" on public.attachments
  for delete using (uploaded_by = auth.uid() or public.is_admin());

insert into storage.buckets (id, name, public) values ('claim-attachments', 'claim-attachments', false)
  on conflict (id) do nothing;

create policy "attachments_bucket_select" on storage.objects
  for select using (bucket_id = 'claim-attachments' and auth.role() = 'authenticated');
create policy "attachments_bucket_insert" on storage.objects
  for insert with check (bucket_id = 'claim-attachments' and auth.role() = 'authenticated');
create policy "attachments_bucket_delete" on storage.objects
  for delete using (
    bucket_id = 'claim-attachments' and (owner = auth.uid() or public.is_admin())
  );
