-- Migration 001: schema base (profiles, claims, claim_events, attachments)
-- Enums via CHECK constraints (mas flexible que type enum para agregar valores en el futuro)

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('shimano','deposito','admin')),
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.claims (
  id bigserial primary key,
  remito_number text not null,
  observations text not null,
  current_column text not null check (current_column in (
    'nuevo','deposito_revisa','respuesta_deposito','shimano_valida','resuelto','cerrado'
  )),
  assignee_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.claim_events (
  id bigserial primary key,
  claim_id bigint not null references public.claims(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  event_type text not null check (event_type in (
    'created','moved','assigned','commented','attached','email_sent','email_failed'
  )),
  from_column text,
  to_column text,
  comment_text text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table public.attachments (
  id bigserial primary key,
  claim_id bigint not null references public.claims(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size integer,
  mime_type text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
