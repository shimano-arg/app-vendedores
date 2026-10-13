-- Migration 004: habilitar realtime en claims

alter publication supabase_realtime add table public.claims;
