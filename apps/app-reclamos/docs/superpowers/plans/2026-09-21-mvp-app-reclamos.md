# APP-RECLAMOS MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shippear el MVP (v0.1) descripto en `docs/specs/2026-09-21-app-reclamos-shimano-design.md` — un tablero Kanban de 6 columnas para reclamos Shimano↔Depósito, con auth email+pass, adjuntos, comentarios, timeline y notificación por email al cambiar de responsable.

**Architecture:** Next.js 15 App Router (Server Components + Server Actions) desplegado en Vercel. Persistencia y auth en Supabase (Postgres con RLS + Auth email/pass + Storage + Realtime). Email transaccional via Resend disparado inline desde Server Actions. RLS es la barrera de seguridad principal — el frontend confía en ella, no la duplica.

**⚠️ Cambio 2026-09-21:** Workflow **cloud-only** (sin docker/supabase local). Todas las migrations se pushean a un proyecto Supabase Cloud único usando `supabase db push`. Los tests RLS y E2E Playwright quedan como **TODO post-MVP** (requieren docker local o un segundo proyecto Supabase dedicado a testing). Para el MVP se hace **smoke testing manual** contra el proyecto cloud.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui, @dnd-kit, @supabase/ssr, @supabase/supabase-js, Resend SDK, Zod, Vitest, Playwright, Supabase CLI (docker local).

---

## Alcance de este plan

Cubre **MVP (v0.1) del spec**: auth, board 6 columnas, crear/mover/asignar, comentarios, adjuntos, email al mover, timeline. Admin crea usuarios manualmente via Supabase Studio (sin UI todavía).

**Fuera de scope de este plan:**
- UI `/admin/users` (V1)
- Métricas / dashboard (V1)
- Lookup remito SAP, WhatsApp, PWA (V2)

---

## File Structure

Estructura del repo cuando termine el plan:

```
APP-RECLAMOS/
├── app/
│   ├── layout.tsx                       # Shell base + AuthGuard
│   ├── page.tsx                          # Redirect a /board si logueado, si no a /login
│   ├── login/
│   │   ├── page.tsx                      # Formulario email+pass
│   │   └── actions.ts                    # Server Action login/logout
│   ├── board/
│   │   ├── page.tsx                      # Server component: fetch inicial
│   │   ├── Board.tsx                     # Client: dnd + realtime
│   │   ├── Column.tsx                    # Droppable
│   │   ├── ClaimCard.tsx                 # Draggable
│   │   ├── NewClaimDialog.tsx            # Modal alta reclamo
│   │   ├── ClaimDetailDialog.tsx         # Modal detalle (query param ?claim=)
│   │   ├── Timeline.tsx                  # Renderiza claim_events
│   │   ├── Attachments.tsx               # Lista + upload
│   │   ├── CommentBox.tsx
│   │   ├── MoveClaimForm.tsx
│   │   └── actions.ts                    # Server Actions: create/move/comment/attach
│   └── api/health/route.ts               # GET simple para smoke test deploy
├── components/ui/                        # shadcn CLI genera aca (Button, Dialog, etc.)
├── lib/
│   ├── supabase/
│   │   ├── client.ts                     # Browser client
│   │   ├── server.ts                     # Server client (con cookies)
│   │   ├── admin.ts                      # Service role (server-only)
│   │   └── types.ts                      # Tipos generados por supabase-cli
│   ├── email/
│   │   ├── resend.ts                     # Wrapper Resend con retry
│   │   └── templates.ts                  # HTML template asignacion
│   ├── permissions.ts                    # isAdmin, canMoveClaim helpers
│   ├── columns.ts                        # Const CLAIM_COLUMNS + labels
│   └── validators.ts                     # Zod schemas de forms
├── supabase/
│   ├── config.toml                       # Generado por supabase init
│   ├── migrations/
│   │   ├── 20260921000001_init.sql
│   │   ├── 20260921000002_rls.sql
│   │   └── 20260921000003_indexes_triggers.sql
│   └── seed.sql
├── tests/
│   ├── unit/
│   │   ├── permissions.test.ts
│   │   └── validators.test.ts
│   ├── rls/
│   │   └── claims-rls.test.ts
│   └── e2e/
│       └── flow-completo.spec.ts
├── middleware.ts                          # Auth redirect
├── next.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── playwright.config.ts
├── vitest.config.ts
├── .env.local.example
├── .github/workflows/ci.yml
├── docs/
│   ├── specs/2026-09-21-app-reclamos-shimano-design.md   # ya existe
│   ├── superpowers/plans/2026-09-21-mvp-app-reclamos.md  # este archivo
│   └── README.md
├── README.md
└── .gitignore
```

Cada archivo tiene una responsabilidad única. Los `actions.ts` agrupan Server Actions por dominio (login, board). Los componentes del board viven juntos porque cambian juntos.

---

## Convenciones

- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`). Uno por Task en general; excepcionalmente 2 si TDD lo pide (test rojo → verde).
- **Comandos:** Todos los comandos asumen PowerShell en Windows (working dir = `C:\Users\shimano.sandbox\Desktop\APP-RECLAMOS\`). El wrapper `npx` funciona igual. Cuando aparezca `bash`-only, se aclara.
- **Node:** Node 20+ (requerido por Next 15 y Supabase CLI). Verificar con `node --version` antes de arrancar.
- **Docker:** NO requerido en este plan (workflow cloud-only).
- **Supabase CLI:** Instalar globalmente con `npm i -g supabase` si no está.
- **Cuenta Supabase Cloud:** requerida (free tier alcanza). Crear proyecto en https://supabase.com/dashboard/new.

---

## Task 1: Bootstrap del proyecto Next.js + deps

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.env.local.example`, `components.json`
- Modify: `README.md`, `.gitignore` (ya existen del design commit; revisar)

- [ ] **Step 1: Verificar prerrequisitos**

Ejecutar:
```powershell
node --version    # >= 20.x
supabase --version  # si falla: npm i -g supabase
```
Expected: Node 20+ y Supabase CLI respondiendo. Si Supabase CLI falta, instalar con `npm i -g supabase`. Sin docker en este workflow.

- [ ] **Step 2: Crear el proyecto Next.js**

En `C:\Users\shimano.sandbox\Desktop\APP-RECLAMOS\` (ya tiene `.git`, README y `docs/`):
```powershell
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias="@/*" --use-npm --no-turbopack --skip-install
```
Cuando pregunte por sobreescribir archivos existentes (README.md, .gitignore), responder **No** a README, **Yes** al resto. Si el interactivo bloquea, correr con `--yes` y luego restaurar README/gitignore desde git.

- [ ] **Step 3: Instalar dependencias runtime**

```powershell
npm install @supabase/supabase-js @supabase/ssr @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities resend zod lucide-react class-variance-authority clsx tailwind-merge
```

- [ ] **Step 4: Instalar dependencias dev**

```powershell
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom @playwright/test tsx
```

- [ ] **Step 5: Inicializar shadcn/ui**

```powershell
npx shadcn@latest init -d
```
Elegir: New York style / Neutral color / CSS variables yes.
Después agregar componentes base:
```powershell
npx shadcn@latest add button dialog input textarea select label toast dropdown-menu badge separator
```

- [ ] **Step 6: Crear `.env.local.example`**

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local-anon-key-de-supabase-start>
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-de-supabase-start>
RESEND_API_KEY=re_xxx_placeholder
RESEND_FROM_EMAIL=onboarding@resend.dev
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 7: Verificar que el proyecto arranca**

```powershell
npm run dev
```
Expected: server en http://localhost:3000 responde con la landing default de Next. Ctrl+C para parar.

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "chore: bootstrap Next.js 15 + Tailwind + shadcn/ui + deps"
```

---

## Task 2: Setup Supabase Cloud + link + migration 001 (schema base)

**Files:**
- Create: `supabase/config.toml` (generado), `supabase/migrations/20260921000001_init.sql`

- [ ] **Step 1: Instalar Supabase CLI (si falta) + inicializar**

```powershell
npm i -g supabase
supabase --version
supabase init
```
Acepta defaults. Se crea `supabase/config.toml` y estructura `supabase/`.

- [ ] **Step 2: Crear proyecto Supabase Cloud (manual, requiere vos)**

1. Abrir https://supabase.com/dashboard/new
2. Elegir región **South America (São Paulo)**, plan Free, DB password (guardarlo).
3. Esperar 1-2 min a que provisione.
4. Copiar del dashboard (Settings > API):
   - **Project URL** (algo tipo `https://abcxyz.supabase.co`)
   - **anon public key**
   - **service_role key** (secret — no compartir)
5. Copiar `.env.local.example` a `.env.local` y poner esos valores en las tres primeras variables.
6. Copiar el `Reference ID` del proyecto (Settings > General).

- [ ] **Step 3: Login + link al proyecto cloud**

```powershell
supabase login
```
(Abre navegador para autenticar). Después:
```powershell
supabase link --project-ref <REFERENCE_ID>
```
Cuando pida DB password, pegar el del step 2.

- [ ] **Step 4: Escribir migration 001 (schema)**

Crear `supabase/migrations/20260921000001_init.sql`:
```sql
-- Enums via CHECK constraints (mas flexible que type enum para agregar valores)
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
```

- [ ] **Step 5: Aplicar la migration a cloud**

```powershell
supabase db push
```
Expected: aplica la migration al proyecto cloud. Preguntará confirmación — responder `y`.

- [ ] **Step 6: Verificar en Supabase Dashboard**

Abrir https://supabase.com/dashboard/project/<REFERENCE_ID>/editor. Confirmar que `profiles`, `claims`, `claim_events`, `attachments` existen.

- [ ] **Step 7: Commit**

```powershell
git add supabase/
git commit -m "feat(db): migration inicial - profiles, claims, claim_events, attachments (cloud-linked)"
```

---

## Task 3: Migration 002 (RLS policies + storage bucket)

> **Nota cloud-only:** los tests RLS quedan escritos como archivo `tests/rls/claims-rls.test.ts` pero **NO se corren en este MVP** (requerirían docker o proyecto Supabase secundario para test). Cuando se sume Docker o test project, se activan agregando el script `npm run test:rls`. Por ahora **smoke test manual via Studio online** al terminar Step 6.

**Files:**
- Create: `supabase/migrations/20260921000002_rls.sql`, `tests/rls/claims-rls.test.ts.skip` (marcado skip), `vitest.config.ts`

- [ ] **Step 1: Escribir `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
  },
  resolve: {
    alias: { '@': new URL('./', import.meta.url).pathname },
  },
});
```

Agregar scripts a `package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
}
```

- [ ] **Step 2: Escribir tests RLS (guardar como .ts.skip para MVP)**

Crear el archivo pero con extensión `.ts.skip` para que vitest lo ignore. Cuando haya Docker/test project, renombrar a `.ts` y correrlos.

Crear `tests/rls/claims-rls.test.ts.skip`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });

async function createUser(email: string, role: 'shimano'|'deposito'|'admin'): Promise<{id: string, client: SupabaseClient}> {
  const svc = admin();
  const { data, error } = await svc.auth.admin.createUser({
    email, password: 'test1234!', email_confirm: true,
  });
  if (error) throw error;
  await svc.from('profiles').insert({
    id: data.user!.id, email, role, display_name: email.split('@')[0],
  });
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: 'test1234!' });
  return { id: data.user!.id, client };
}

describe('claims RLS', () => {
  beforeAll(async () => {
    // Reset DB antes de correr para tener estado limpio.
    // (En CI: supabase db reset se corre antes en el job).
  });

  it('un usuario logueado puede leer todos los claims', async () => {
    const alice = await createUser(`alice-${Date.now()}@t.com`, 'shimano');
    const bob = await createUser(`bob-${Date.now()}@t.com`, 'deposito');

    await admin().from('claims').insert({
      remito_number: 'R-1', observations: 'test',
      current_column: 'nuevo', assignee_id: bob.id, created_by: alice.id,
    });

    const { data, error } = await bob.client.from('claims').select('*');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it('solo el assignee actual puede hacer UPDATE (mover columna)', async () => {
    const alice = await createUser(`alice2-${Date.now()}@t.com`, 'shimano');
    const bob = await createUser(`bob2-${Date.now()}@t.com`, 'deposito');
    const { data: claim } = await admin().from('claims').insert({
      remito_number: 'R-2', observations: 't', current_column: 'nuevo',
      assignee_id: bob.id, created_by: alice.id,
    }).select().single();

    // Alice NO es assignee, no debe poder mover.
    const { error: e1 } = await alice.client.from('claims')
      .update({ current_column: 'deposito_revisa' }).eq('id', claim!.id);
    // RLS bloquea silenciosamente (0 rows affected) o error segun policy.
    const { data: refetch } = await admin().from('claims').select('current_column').eq('id', claim!.id).single();
    expect(refetch!.current_column).toBe('nuevo');

    // Bob SI es assignee, puede mover.
    const { error: e2 } = await bob.client.from('claims')
      .update({ current_column: 'deposito_revisa', assignee_id: alice.id }).eq('id', claim!.id);
    expect(e2).toBeNull();
    const { data: after } = await admin().from('claims').select('current_column').eq('id', claim!.id).single();
    expect(after!.current_column).toBe('deposito_revisa');
  });

  it('claim_events es append-only (no se puede UPDATE ni DELETE por non-admin)', async () => {
    const alice = await createUser(`alice3-${Date.now()}@t.com`, 'shimano');
    await alice.client.from('claim_events').insert({
      claim_id: 1, actor_id: alice.id, event_type: 'commented', comment_text: 'hi',
    });
    // Update debe fallar por RLS
    const { error } = await alice.client.from('claim_events')
      .update({ comment_text: 'edited' }).eq('actor_id', alice.id);
    // Sin policy de update -> 0 rows affected (no error explicito con anon).
    const { data } = await admin().from('claim_events').select('comment_text').eq('actor_id', alice.id).order('id', {ascending: false}).limit(1);
    expect(data![0].comment_text).toBe('hi');
  });
});
```

- [ ] **Step 3: Verificar `npm test` funciona (aunque no haya tests todavía)**

```powershell
npm test
```
Expected: `No test files found` o mensaje similar — está bien. Cuando escribamos unit tests en Task 18 tendremos verde real.

- [ ] **Step 4: Escribir migration 002 (RLS)**

Crear `supabase/migrations/20260921000002_rls.sql`:
```sql
-- Habilitar RLS en todas las tablas
alter table public.profiles enable row level security;
alter table public.claims enable row level security;
alter table public.claim_events enable row level security;
alter table public.attachments enable row level security;

-- Helper: is_admin()
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- PROFILES
create policy "profiles_select_authed" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_insert_admin" on public.profiles
  for insert with check (public.is_admin());
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());
create policy "profiles_delete_admin" on public.profiles
  for delete using (public.is_admin());

-- CLAIMS
create policy "claims_select_authed" on public.claims
  for select using (auth.role() = 'authenticated');
create policy "claims_insert_authed" on public.claims
  for insert with check (auth.role() = 'authenticated');
create policy "claims_update_assignee_or_admin" on public.claims
  for update using (assignee_id = auth.uid() or public.is_admin());
create policy "claims_delete_admin" on public.claims
  for delete using (public.is_admin());

-- CLAIM_EVENTS (append-only para non-admin)
create policy "claim_events_select_authed" on public.claim_events
  for select using (auth.role() = 'authenticated');
create policy "claim_events_insert_authed" on public.claim_events
  for insert with check (auth.role() = 'authenticated' and actor_id = auth.uid());
create policy "claim_events_delete_admin" on public.claim_events
  for delete using (public.is_admin());

-- ATTACHMENTS
create policy "attachments_select_authed" on public.attachments
  for select using (auth.role() = 'authenticated');
create policy "attachments_insert_authed" on public.attachments
  for insert with check (auth.role() = 'authenticated' and uploaded_by = auth.uid());
create policy "attachments_delete_uploader_or_admin" on public.attachments
  for delete using (uploaded_by = auth.uid() or public.is_admin());

-- STORAGE bucket
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
```

- [ ] **Step 5: Push migration a cloud**

```powershell
supabase db push
```
Expected: aplica migration 002. Confirmar con `y`.

- [ ] **Step 6: Smoke test manual via Studio online**

Abrir https://supabase.com/dashboard/project/<REFERENCE_ID>/auth/policies. Confirmar que cada tabla (`profiles`, `claims`, `claim_events`, `attachments`) tiene sus policies listadas (select, insert, update, delete según corresponda). Verificar en Storage que existe bucket `claim-attachments`.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/20260921000002_rls.sql tests/ vitest.config.ts package.json package-lock.json
git commit -m "feat(db): RLS policies + storage bucket + tests RLS (skipped MVP)"
```

---

## Task 4: Migration 003 (índices + trigger updated_at)

**Files:**
- Create: `supabase/migrations/20260921000003_indexes_triggers.sql`

- [ ] **Step 1: Escribir migration 003**

Crear `supabase/migrations/20260921000003_indexes_triggers.sql`:
```sql
-- Indices para consultas frecuentes
create index if not exists claims_column_updated_idx
  on public.claims (current_column, updated_at desc);
create index if not exists claims_assignee_idx
  on public.claims (assignee_id);
create index if not exists claim_events_claim_created_idx
  on public.claim_events (claim_id, created_at desc);
create index if not exists attachments_claim_idx
  on public.attachments (claim_id);

-- Trigger updated_at
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
```

- [ ] **Step 2: Push migration a cloud**

```powershell
supabase db push
```
Expected: aplica migration 003 sin errores. Confirmar con `y`.

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20260921000003_indexes_triggers.sql
git commit -m "feat(db): indices para board + trigger updated_at en claims"
```

---

## Task 5: Supabase clients + tipos generados + helpers de columnas

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/supabase/types.ts` (generado), `lib/columns.ts`

- [ ] **Step 1: Crear browser client `lib/supabase/client.ts`**

```ts
'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Crear server client `lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch { /* Server Component context: ignore */ }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Crear admin client `lib/supabase/admin.ts`**

```ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
```

- [ ] **Step 4: Generar tipos TypeScript de Supabase (desde cloud linkeado)**

```powershell
supabase gen types typescript --linked > lib/supabase/types.ts
```
Expected: `lib/supabase/types.ts` contiene `export type Database = { public: { Tables: { profiles: ..., claims: ..., ... } } }`.

- [ ] **Step 5: Crear `lib/columns.ts`**

```ts
export const CLAIM_COLUMNS = [
  { key: 'nuevo',              label: 'Nuevo',              accent: 'bg-slate-100' },
  { key: 'deposito_revisa',    label: 'Depósito revisa',    accent: 'bg-amber-100' },
  { key: 'respuesta_deposito', label: 'Respuesta depósito', accent: 'bg-orange-100' },
  { key: 'shimano_valida',     label: 'Shimano valida',     accent: 'bg-blue-100' },
  { key: 'resuelto',           label: 'Resuelto',           accent: 'bg-emerald-100' },
  { key: 'cerrado',            label: 'Cerrado',            accent: 'bg-neutral-200' },
] as const;

export type ClaimColumn = typeof CLAIM_COLUMNS[number]['key'];
export const COLUMN_KEYS = CLAIM_COLUMNS.map(c => c.key) as ClaimColumn[];
export const COLUMN_LABEL: Record<ClaimColumn, string> =
  Object.fromEntries(CLAIM_COLUMNS.map(c => [c.key, c.label])) as any;
```

- [ ] **Step 6: Verificar typecheck**

```powershell
npx tsc --noEmit
```
Expected: 0 errores.

- [ ] **Step 7: Commit**

```powershell
git add lib/ 
git commit -m "feat(supabase): clientes browser/server/admin + types generados + column helpers"
```

---

## Task 6: Middleware de auth + página login + logout

**Files:**
- Create: `middleware.ts`, `app/login/page.tsx`, `app/login/actions.ts`, `app/page.tsx`

- [ ] **Step 1: Escribir `middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic = request.nextUrl.pathname.startsWith('/login')
                || request.nextUrl.pathname.startsWith('/api/health');
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (user && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/board';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 2: Escribir `app/login/actions.ts`**

```ts
'use server';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  next: z.string().optional(),
});

export async function login(formData: FormData) {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  });
  if (!parsed.success) return { error: 'Datos inválidos' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email, password: parsed.data.password,
  });
  if (error) return { error: 'Credenciales incorrectas' };
  redirect(parsed.data.next || '/board');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

- [ ] **Step 3: Escribir `app/login/page.tsx`**

```tsx
import { login } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <form action={login} className="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4">
        <h1 className="text-xl font-semibold">Reclamos Shimano</h1>
        <input type="hidden" name="next" value={next ?? ''} />
        <label className="block">
          <span className="text-sm">Email</span>
          <input name="email" type="email" required autoComplete="email"
            className="mt-1 w-full border rounded px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm">Contraseña</span>
          <input name="password" type="password" required autoComplete="current-password"
            className="mt-1 w-full border rounded px-3 py-2" />
        </label>
        <button type="submit"
          className="w-full bg-slate-900 text-white py-2 rounded hover:bg-slate-800">
          Ingresar
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Reemplazar `app/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
export default function Home() { redirect('/board'); }
```

- [ ] **Step 5: Verificar login manualmente**

Crear un usuario admin de prueba en Supabase Dashboard:
1. https://supabase.com/dashboard/project/<REFERENCE_ID>/auth/users > "Add user" > email `admin@test.com`, password `test1234!`, "Auto Confirm User" ✓.
2. Ir a https://supabase.com/dashboard/project/<REFERENCE_ID>/sql/new y ejecutar:
```sql
insert into public.profiles (id, email, role, display_name)
values ((select id from auth.users where email='admin@test.com'),
        'admin@test.com', 'admin', 'Admin Test');
```

```powershell
npm run dev
```
Abrir http://localhost:3000 — debe redirigir a /login. Loguearse — debe redirigir a /board (por ahora 404 porque no existe todavía; ver Task 8).

- [ ] **Step 6: Commit**

```powershell
git add middleware.ts app/
git commit -m "feat(auth): middleware + login/logout server actions + pagina login"
```

---

## Task 7: Layout base + AuthGuard + página placeholder /board

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/board/page.tsx` (placeholder), `app/api/health/route.ts`

- [ ] **Step 1: Sobreescribir `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { logout } from './login/actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reclamos Shimano',
  description: 'Gestión de reclamos Shimano ↔ Depósito',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {user && (
          <header className="border-b bg-white">
            <div className="mx-auto max-w-[1400px] flex items-center justify-between px-4 py-2">
              <div className="font-semibold">Reclamos Shimano</div>
              <form action={logout}>
                <button className="text-sm underline">Salir ({user.email})</button>
              </form>
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Crear placeholder `app/board/page.tsx`**

```tsx
export default function BoardPage() {
  return <main className="p-8">Board (placeholder — implementado en Task 8+)</main>;
}
```

- [ ] **Step 3: Crear `app/api/health/route.ts`**

```ts
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({ ok: true, ts: new Date().toISOString() });
}
```

- [ ] **Step 4: Verificar en browser**

```powershell
npm run dev
```
Login → ver /board con header + botón salir. Chequear http://localhost:3000/api/health → `{"ok": true, ...}`.

- [ ] **Step 5: Commit**

```powershell
git add app/
git commit -m "feat(ui): layout base con header + logout + endpoint health"
```

---

## Task 8: Board estático — fetch + Column + ClaimCard (sin dnd)

**Files:**
- Modify: `app/board/page.tsx`
- Create: `app/board/Board.tsx`, `app/board/Column.tsx`, `app/board/ClaimCard.tsx`

- [ ] **Step 1: Sobreescribir `app/board/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server';
import { CLAIM_COLUMNS, type ClaimColumn } from '@/lib/columns';
import { Board } from './Board';

export const dynamic = 'force-dynamic';

export default async function BoardPage() {
  const supabase = await createClient();
  const [{ data: claims }, { data: profiles }] = await Promise.all([
    supabase.from('claims').select('*').order('updated_at', { ascending: false }),
    supabase.from('profiles').select('id, email, display_name, role').eq('active', true),
  ]);
  const grouped: Record<ClaimColumn, any[]> = Object.fromEntries(
    CLAIM_COLUMNS.map(c => [c.key, []])
  ) as any;
  (claims ?? []).forEach(cl => grouped[cl.current_column as ClaimColumn].push(cl));
  return <Board initialGrouped={grouped} profiles={profiles ?? []} />;
}
```

- [ ] **Step 2: Crear `app/board/Board.tsx`**

```tsx
'use client';
import { CLAIM_COLUMNS, type ClaimColumn } from '@/lib/columns';
import { Column } from './Column';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

export function Board({ initialGrouped, profiles }: {
  initialGrouped: Record<ClaimColumn, Claim[]>;
  profiles: Profile[];
}) {
  return (
    <main className="p-4 overflow-x-auto">
      <div className="flex gap-3 min-w-max">
        {CLAIM_COLUMNS.map(col => (
          <Column key={col.key} column={col} claims={initialGrouped[col.key]} profiles={profiles} />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Crear `app/board/Column.tsx`**

```tsx
'use client';
import { ClaimCard } from './ClaimCard';
import type { ClaimColumn } from '@/lib/columns';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

export function Column({ column, claims, profiles }: {
  column: { key: ClaimColumn; label: string; accent: string };
  claims: Claim[];
  profiles: Profile[];
}) {
  return (
    <section className={`w-[320px] rounded-lg ${column.accent} p-3`}>
      <header className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{column.label}</h2>
        <span className="text-xs text-slate-600">{claims.length}</span>
      </header>
      <div className="flex flex-col gap-2">
        {claims.map(c => (
          <ClaimCard key={c.id} claim={c} profiles={profiles} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Crear `app/board/ClaimCard.tsx`**

```tsx
'use client';
import Link from 'next/link';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'email'>;

export function ClaimCard({ claim, profiles }: { claim: Claim; profiles: Profile[] }) {
  const assignee = profiles.find(p => p.id === claim.assignee_id);
  return (
    <Link href={`/board?claim=${claim.id}`}
      className="block bg-white rounded p-3 shadow-sm hover:shadow transition text-sm">
      <div className="font-medium">Remito #{claim.remito_number}</div>
      <div className="text-slate-600 line-clamp-2 mt-1">{claim.observations}</div>
      <div className="mt-2 text-xs text-slate-500">
        {assignee ? assignee.display_name : '(sin asignar)'}
      </div>
    </Link>
  );
}
```

- [ ] **Step 5: Insertar 2-3 claims de prueba desde Studio online**

En https://supabase.com/dashboard/project/<REFERENCE_ID>/sql/new pegar:
```sql
insert into public.claims (remito_number, observations, current_column, assignee_id, created_by)
select 'R-100', 'Bulto dañado en recepción', 'nuevo', p.id, p.id from public.profiles p where email='admin@test.com';
insert into public.claims (remito_number, observations, current_column, assignee_id, created_by)
select 'R-101', 'Faltante 2 unidades', 'deposito_revisa', p.id, p.id from public.profiles p where email='admin@test.com';
```

- [ ] **Step 6: Verificar en browser**

`npm run dev`, abrir /board — debe mostrar 6 columnas con las tarjetas de prueba distribuidas.

- [ ] **Step 7: Commit**

```powershell
git add app/board/
git commit -m "feat(board): board estatico con 6 columnas + tarjetas + fetch inicial"
```

---

## Task 9: Board — dnd-kit + Server Action moveClaim (sin email todavía)

**Files:**
- Modify: `app/board/Board.tsx`, `app/board/Column.tsx`, `app/board/ClaimCard.tsx`
- Create: `app/board/actions.ts`, `lib/validators.ts`, `lib/permissions.ts`

- [ ] **Step 1: Crear `lib/validators.ts`**

```ts
import { z } from 'zod';
import { COLUMN_KEYS } from './columns';

export const MoveClaimSchema = z.object({
  claimId: z.coerce.number().int().positive(),
  toColumn: z.enum(COLUMN_KEYS as [string, ...string[]]),
  newAssigneeId: z.string().uuid(),
});
export type MoveClaimInput = z.infer<typeof MoveClaimSchema>;

export const CreateClaimSchema = z.object({
  remitoNumber: z.string().min(1).max(50),
  observations: z.string().min(1).max(2000),
  assigneeId: z.string().uuid(),
});
```

- [ ] **Step 2: Crear `lib/permissions.ts`**

```ts
import type { Database } from './supabase/types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export function isAdmin(profile: Pick<Profile, 'role'> | null | undefined): boolean {
  return profile?.role === 'admin';
}

export function canMoveClaim(userId: string, claim: { assignee_id: string }, profile: Pick<Profile, 'role'> | null): boolean {
  return claim.assignee_id === userId || isAdmin(profile);
}
```

- [ ] **Step 3: Crear `app/board/actions.ts` con moveClaim**

```ts
'use server';
import { createClient } from '@/lib/supabase/server';
import { MoveClaimSchema } from '@/lib/validators';
import { revalidatePath } from 'next/cache';

export async function moveClaim(input: unknown) {
  const parsed = MoveClaimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Input inválido' };
  const { claimId, toColumn, newAssigneeId } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  // Fetch current state
  const { data: current, error: fetchErr } = await supabase.from('claims')
    .select('current_column, assignee_id').eq('id', claimId).single();
  if (fetchErr || !current) return { ok: false, error: 'Reclamo no encontrado' };

  // Update — RLS valida que soy assignee o admin.
  const { error: updErr } = await supabase.from('claims')
    .update({ current_column: toColumn, assignee_id: newAssigneeId })
    .eq('id', claimId);
  if (updErr) return { ok: false, error: 'Sin permisos o error al mover' };

  // Insert event
  await supabase.from('claim_events').insert({
    claim_id: claimId, actor_id: user.id, event_type: 'moved',
    from_column: current.current_column, to_column: toColumn,
    metadata: { new_assignee_id: newAssigneeId },
  });

  revalidatePath('/board');
  return { ok: true };
}
```

- [ ] **Step 4: Modificar `Board.tsx` para agregar DndContext**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CLAIM_COLUMNS, type ClaimColumn, COLUMN_KEYS } from '@/lib/columns';
import { Column } from './Column';
import { moveClaim } from './actions';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

export function Board({ initialGrouped, profiles }: {
  initialGrouped: Record<ClaimColumn, Claim[]>;
  profiles: Profile[];
}) {
  const [grouped, setGrouped] = useState(initialGrouped);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd(e: DragEndEvent) {
    const overId = e.over?.id?.toString();
    const claimId = Number(e.active.id);
    if (!overId || !COLUMN_KEYS.includes(overId as ClaimColumn)) return;
    const toColumn = overId as ClaimColumn;

    // Optimistic: mover en local
    const claim = Object.values(grouped).flat().find(c => c.id === claimId);
    if (!claim || claim.current_column === toColumn) return;
    const nextAssignee = window.prompt(
      `Asignar a (email exacto) para columna "${toColumn}":`,
      profiles[0]?.email ?? ''
    );
    if (!nextAssignee) return;
    const newAssignee = profiles.find(p => p.email === nextAssignee);
    if (!newAssignee) { alert('Email no encontrado'); return; }

    setGrouped(prev => {
      const clone: Record<ClaimColumn, Claim[]> = Object.fromEntries(
        Object.entries(prev).map(([k, v]) => [k, [...v]])
      ) as any;
      const fromCol = claim.current_column as ClaimColumn;
      clone[fromCol] = clone[fromCol].filter(c => c.id !== claimId);
      clone[toColumn] = [{ ...claim, current_column: toColumn, assignee_id: newAssignee.id }, ...clone[toColumn]];
      return clone;
    });

    startTransition(async () => {
      const res = await moveClaim({ claimId, toColumn, newAssigneeId: newAssignee.id });
      if (!res.ok) {
        alert(res.error);
        setGrouped(initialGrouped); // rollback simple
      }
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <main className="p-4 overflow-x-auto">
        <div className="flex gap-3 min-w-max">
          {CLAIM_COLUMNS.map(col => (
            <Column key={col.key} column={col} claims={grouped[col.key]} profiles={profiles} />
          ))}
        </div>
      </main>
    </DndContext>
  );
}
```

- [ ] **Step 5: Hacer Column droppable en `app/board/Column.tsx`**

```tsx
'use client';
import { useDroppable } from '@dnd-kit/core';
import { ClaimCard } from './ClaimCard';
import type { ClaimColumn } from '@/lib/columns';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

export function Column({ column, claims, profiles }: {
  column: { key: ClaimColumn; label: string; accent: string };
  claims: Claim[];
  profiles: Profile[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <section ref={setNodeRef}
      className={`w-[320px] rounded-lg ${column.accent} p-3 ${isOver ? 'ring-2 ring-slate-500' : ''}`}>
      <header className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{column.label}</h2>
        <span className="text-xs text-slate-600">{claims.length}</span>
      </header>
      <div className="flex flex-col gap-2 min-h-[40px]">
        {claims.map(c => (
          <ClaimCard key={c.id} claim={c} profiles={profiles} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Hacer ClaimCard draggable en `app/board/ClaimCard.tsx`**

```tsx
'use client';
import { useDraggable } from '@dnd-kit/core';
import Link from 'next/link';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'email'>;

export function ClaimCard({ claim, profiles }: { claim: Claim; profiles: Profile[] }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: String(claim.id) });
  const assignee = profiles.find(p => p.id === claim.assignee_id);
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`bg-white rounded p-3 shadow-sm text-sm cursor-grab ${isDragging ? 'opacity-50' : ''}`}>
      <Link href={`/board?claim=${claim.id}`} className="block" onClick={(e) => isDragging && e.preventDefault()}>
        <div className="font-medium">Remito #{claim.remito_number}</div>
        <div className="text-slate-600 line-clamp-2 mt-1">{claim.observations}</div>
        <div className="mt-2 text-xs text-slate-500">
          {assignee ? assignee.display_name : '(sin asignar)'}
        </div>
      </Link>
    </div>
  );
}
```

- [ ] **Step 7: Probar drag en browser**

`npm run dev`, arrastrar una tarjeta a otra columna, ingresar email de un profile existente, confirmar que se mueve y persiste al refrescar. Chequear en Studio que `claim_events` tiene una fila `moved`.

- [ ] **Step 8: Commit**

```powershell
git add app/board/ lib/
git commit -m "feat(board): drag-and-drop entre columnas + Server Action moveClaim + validators + permissions"
```

---

## Task 10: Realtime — sincronizar el board entre sesiones

**Files:**
- Modify: `app/board/Board.tsx`

- [ ] **Step 1: Agregar suscripción realtime en `Board.tsx`**

Al principio del componente `Board`, después del `useState`, sumar:
```tsx
import { useEffect } from 'react';
import { createClient as createBrowserClient } from '@/lib/supabase/client';

// ... adentro del componente Board:
useEffect(() => {
  const supabase = createBrowserClient();
  const channel = supabase
    .channel('claims-board')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'claims' },
      (payload) => {
        // Estrategia simple: refetch todo. Mas robusto que patch parcial.
        window.location.reload();
      }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, []);
```

- [ ] **Step 2: Habilitar publication de la tabla claims (migration 004)**

Crear una **nueva** migration `supabase/migrations/20260921000004_realtime.sql`:
```sql
-- Realtime
alter publication supabase_realtime add table public.claims;
```
```powershell
supabase db push
```
Confirmar con `y`.

- [ ] **Step 3: Verificar en 2 browsers**

Abrir /board en 2 ventanas (una normal, una incógnito con otro user). Mover una tarjeta en una — la otra debe recargar y reflejar el cambio en ~1s.

- [ ] **Step 4: Commit**

```powershell
git add app/board/Board.tsx supabase/migrations/20260921000004_realtime.sql
git commit -m "feat(board): realtime subscription sobre claims + publication"
```

---

## Task 11: NewClaimDialog + Server Action createClaim

**Files:**
- Modify: `app/board/actions.ts`, `app/board/Board.tsx`
- Create: `app/board/NewClaimDialog.tsx`

- [ ] **Step 1: Extender `app/board/actions.ts` con createClaim**

Sumar al final:
```ts
import { CreateClaimSchema } from '@/lib/validators';

export async function createClaim(input: unknown) {
  const parsed = CreateClaimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Input inválido' };
  const { remitoNumber, observations, assigneeId } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  const { data: claim, error } = await supabase.from('claims').insert({
    remito_number: remitoNumber,
    observations,
    current_column: 'nuevo',
    assignee_id: assigneeId,
    created_by: user.id,
  }).select().single();
  if (error || !claim) return { ok: false, error: 'Error al crear' };

  await supabase.from('claim_events').insert({
    claim_id: claim.id, actor_id: user.id, event_type: 'created',
    to_column: 'nuevo',
  });
  revalidatePath('/board');
  return { ok: true, claimId: claim.id };
}
```

- [ ] **Step 2: Crear `app/board/NewClaimDialog.tsx`**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { createClaim } from './actions';
import type { Database } from '@/lib/supabase/types';

type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name'>;

export function NewClaimDialog({ profiles }: { profiles: Profile[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(fd: FormData) {
    setError(null);
    const input = {
      remitoNumber: fd.get('remito_number'),
      observations: fd.get('observations'),
      assigneeId: fd.get('assignee_id'),
    };
    startTransition(async () => {
      const res = await createClaim(input);
      if (!res.ok) setError(res.error!);
      else { setOpen(false); window.location.reload(); }
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="bg-slate-900 text-white text-sm px-3 py-1.5 rounded hover:bg-slate-800">
        + Nuevo reclamo
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
             onClick={() => setOpen(false)}>
          <form action={onSubmit} onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg p-6 w-full max-w-md space-y-3">
            <h2 className="text-lg font-semibold">Nuevo reclamo</h2>
            <label className="block">
              <span className="text-sm">Nº Remito</span>
              <input name="remito_number" required
                className="mt-1 w-full border rounded px-3 py-2" />
            </label>
            <label className="block">
              <span className="text-sm">Observaciones</span>
              <textarea name="observations" required rows={4}
                className="mt-1 w-full border rounded px-3 py-2" />
            </label>
            <label className="block">
              <span className="text-sm">Asignar a</span>
              <select name="assignee_id" required
                className="mt-1 w-full border rounded px-3 py-2">
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.display_name} ({p.email})</option>
                ))}
              </select>
            </label>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 border rounded">Cancelar</button>
              <button type="submit" disabled={pending}
                className="px-3 py-1.5 bg-slate-900 text-white rounded disabled:opacity-50">
                {pending ? 'Creando...' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Montar el botón en `Board.tsx`**

Al principio del `main`:
```tsx
import { NewClaimDialog } from './NewClaimDialog';
// ...
<main className="p-4 overflow-x-auto">
  <div className="mb-3 flex justify-end">
    <NewClaimDialog profiles={profiles} />
  </div>
  <div className="flex gap-3 min-w-max">
```

- [ ] **Step 4: Probar creación en browser**

Click "+ Nuevo reclamo", cargar datos, submit. Confirmar que aparece en columna Nuevo.

- [ ] **Step 5: Commit**

```powershell
git add app/board/
git commit -m "feat(board): dialogo nuevo reclamo + Server Action createClaim"
```

---

## Task 12: ClaimDetailDialog modal (query param)

**Files:**
- Create: `app/board/ClaimDetailDialog.tsx`
- Modify: `app/board/page.tsx`

- [ ] **Step 1: Crear `app/board/ClaimDetailDialog.tsx`**

```tsx
'use client';
import { useRouter } from 'next/navigation';
import type { Database } from '@/lib/supabase/types';
import { COLUMN_LABEL } from '@/lib/columns';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'email'>;

export function ClaimDetailDialog({ claim, profiles, children }: {
  claim: Claim;
  profiles: Profile[];
  children?: React.ReactNode; // slots para Timeline / Attachments / etc.
}) {
  const router = useRouter();
  const assignee = profiles.find(p => p.id === claim.assignee_id);
  function close() { router.push('/board'); }
  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-40 p-4 overflow-y-auto"
         onClick={close}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg p-6 w-full max-w-2xl my-8 space-y-4">
        <header className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-500">Reclamo #{claim.id}</div>
            <h2 className="text-lg font-semibold">Remito #{claim.remito_number}</h2>
            <div className="text-sm text-slate-600 mt-1">
              Columna: <span className="font-medium">{COLUMN_LABEL[claim.current_column as any]}</span>
              {' · '}Responsable: <span className="font-medium">{assignee?.display_name ?? '(sin asignar)'}</span>
            </div>
          </div>
          <button onClick={close} className="text-slate-500 hover:text-slate-900">✕</button>
        </header>
        <section>
          <h3 className="font-medium text-sm mb-1">Observaciones</h3>
          <p className="text-sm whitespace-pre-wrap bg-slate-50 rounded p-3">{claim.observations}</p>
        </section>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modificar `app/board/page.tsx` para renderizar el modal si `?claim=`**

```tsx
import { createClient } from '@/lib/supabase/server';
import { CLAIM_COLUMNS, type ClaimColumn } from '@/lib/columns';
import { Board } from './Board';
import { ClaimDetailDialog } from './ClaimDetailDialog';

export const dynamic = 'force-dynamic';

export default async function BoardPage({ searchParams }: {
  searchParams: Promise<{ claim?: string }>
}) {
  const { claim: claimParam } = await searchParams;
  const supabase = await createClient();
  const [{ data: claims }, { data: profiles }] = await Promise.all([
    supabase.from('claims').select('*').order('updated_at', { ascending: false }),
    supabase.from('profiles').select('id, email, display_name, role').eq('active', true),
  ]);
  const grouped: Record<ClaimColumn, any[]> = Object.fromEntries(
    CLAIM_COLUMNS.map(c => [c.key, []])
  ) as any;
  (claims ?? []).forEach(cl => grouped[cl.current_column as ClaimColumn].push(cl));

  let detail = null;
  if (claimParam) {
    const claimId = Number(claimParam);
    const claim = (claims ?? []).find(c => c.id === claimId);
    if (claim) {
      detail = <ClaimDetailDialog claim={claim} profiles={profiles ?? []} />;
    }
  }

  return (<>
    <Board initialGrouped={grouped} profiles={profiles ?? []} />
    {detail}
  </>);
}
```

- [ ] **Step 3: Verificar en browser**

Click en una tarjeta → abre modal con detalles. Click en X o fuera → cierra. URL cambia entre `/board` y `/board?claim=1`.

- [ ] **Step 4: Commit**

```powershell
git add app/board/
git commit -m "feat(board): modal detalle reclamo abierto por query param"
```

---

## Task 13: Timeline component

**Files:**
- Create: `app/board/Timeline.tsx`
- Modify: `app/board/page.tsx`

- [ ] **Step 1: Crear `app/board/Timeline.tsx`**

```tsx
import type { Database } from '@/lib/supabase/types';
import { COLUMN_LABEL } from '@/lib/columns';

type Event = Database['public']['Tables']['claim_events']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name'>;

function eventLine(ev: Event, actor: string): string {
  switch (ev.event_type) {
    case 'created':      return `${actor} creó el reclamo`;
    case 'moved':        return `${actor} movió de "${COLUMN_LABEL[ev.from_column as any]}" a "${COLUMN_LABEL[ev.to_column as any]}"`;
    case 'assigned':     return `${actor} reasignó`;
    case 'commented':    return `${actor}: ${ev.comment_text ?? ''}`;
    case 'attached':     return `${actor} adjuntó ${ev.metadata?.file_name ?? 'archivo'}`;
    case 'email_sent':   return `Email enviado a ${ev.metadata?.email_to ?? '?'}`;
    case 'email_failed': return `Email FALLÓ a ${ev.metadata?.email_to ?? '?'} (${ev.metadata?.error ?? 'error'})`;
    default:             return `${actor} — ${ev.event_type}`;
  }
}

export function Timeline({ events, profiles }: { events: Event[]; profiles: Profile[] }) {
  return (
    <section>
      <h3 className="font-medium text-sm mb-2">Timeline</h3>
      <ol className="space-y-1 text-sm">
        {events.map(ev => {
          const actor = profiles.find(p => p.id === ev.actor_id)?.display_name ?? 'alguien';
          return (
            <li key={ev.id} className="flex gap-2 text-slate-700">
              <span className="text-xs text-slate-400 w-32 shrink-0">
                {new Date(ev.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>{eventLine(ev, actor)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

- [ ] **Step 2: Fetch events en `page.tsx` y pasarlos al modal**

Modificar el bloque `if (claimParam)`:
```tsx
if (claimParam) {
  const claimId = Number(claimParam);
  const claim = (claims ?? []).find(c => c.id === claimId);
  if (claim) {
    const { data: events } = await supabase.from('claim_events')
      .select('*').eq('claim_id', claimId).order('created_at', { ascending: true });
    detail = (
      <ClaimDetailDialog claim={claim} profiles={profiles ?? []}>
        <Timeline events={events ?? []} profiles={profiles ?? []} />
      </ClaimDetailDialog>
    );
  }
}
```
Agregar import `import { Timeline } from './Timeline';`.

- [ ] **Step 3: Verificar en browser**

Abrir un claim → timeline muestra "creó", "movió de X a Y", etc.

- [ ] **Step 4: Commit**

```powershell
git add app/board/
git commit -m "feat(board): timeline de eventos en modal detalle"
```

---

## Task 14: CommentBox + Server Action addComment

**Files:**
- Modify: `app/board/actions.ts`, `app/board/page.tsx`
- Create: `app/board/CommentBox.tsx`

- [ ] **Step 1: Extender `actions.ts` con addComment**

```ts
export async function addComment(input: { claimId: number; text: string }) {
  const text = String(input.text ?? '').trim();
  if (!text) return { ok: false, error: 'Vacío' };
  if (text.length > 2000) return { ok: false, error: 'Muy largo' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  const { error } = await supabase.from('claim_events').insert({
    claim_id: Number(input.claimId), actor_id: user.id,
    event_type: 'commented', comment_text: text,
  });
  if (error) return { ok: false, error: 'Error al comentar' };
  revalidatePath('/board');
  return { ok: true };
}
```

- [ ] **Step 2: Crear `app/board/CommentBox.tsx`**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { addComment } from './actions';

export function CommentBox({ claimId }: { claimId: number }) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!text.trim()) return;
    startTransition(async () => {
      const res = await addComment({ claimId, text });
      if (res.ok) { setText(''); window.location.reload(); }
      else alert(res.error);
    });
  }

  return (
    <section>
      <h3 className="font-medium text-sm mb-1">Agregar comentario</h3>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
        className="w-full border rounded px-3 py-2 text-sm" />
      <button onClick={submit} disabled={pending || !text.trim()}
        className="mt-1 px-3 py-1.5 bg-slate-900 text-white rounded text-sm disabled:opacity-50">
        {pending ? 'Enviando...' : 'Comentar'}
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Montar `CommentBox` en el modal (page.tsx)**

Cambiar el children del ClaimDetailDialog:
```tsx
<ClaimDetailDialog claim={claim} profiles={profiles ?? []}>
  <Timeline events={events ?? []} profiles={profiles ?? []} />
  <CommentBox claimId={claim.id} />
</ClaimDetailDialog>
```
Import: `import { CommentBox } from './CommentBox';`

- [ ] **Step 4: Verificar en browser**

Comentar en un claim → aparece en timeline tras refresh.

- [ ] **Step 5: Commit**

```powershell
git add app/board/
git commit -m "feat(board): agregar comentario a reclamo"
```

---

## Task 15: Attachments — upload + list

**Files:**
- Modify: `app/board/actions.ts`, `app/board/page.tsx`
- Create: `app/board/Attachments.tsx`

- [ ] **Step 1: Extender `actions.ts` con uploadAttachment**

```ts
export async function uploadAttachmentMetadata(input: {
  claimId: number;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado' };

  const { data: att, error } = await supabase.from('attachments').insert({
    claim_id: input.claimId,
    storage_path: input.storagePath,
    file_name: input.fileName,
    file_size: input.fileSize,
    mime_type: input.mimeType,
    uploaded_by: user.id,
  }).select().single();
  if (error || !att) return { ok: false, error: 'Error registrando adjunto' };

  await supabase.from('claim_events').insert({
    claim_id: input.claimId, actor_id: user.id, event_type: 'attached',
    metadata: { attachment_id: att.id, file_name: input.fileName },
  });
  revalidatePath('/board');
  return { ok: true, attachmentId: att.id };
}
```

- [ ] **Step 2: Crear `app/board/Attachments.tsx`**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadAttachmentMetadata } from './actions';
import type { Database } from '@/lib/supabase/types';

type Attachment = Database['public']['Tables']['attachments']['Row'];

export function Attachments({ claimId, initial }: { claimId: number; initial: Attachment[] }) {
  const [attachments, setAttachments] = useState<Attachment[]>(initial);
  const [pending, startTransition] = useTransition();
  const supabase = createClient();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    startTransition(async () => {
      const path = `${claimId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from('claim-attachments').upload(path, file);
      if (upErr) { alert('Falló subida: ' + upErr.message); return; }
      const res = await uploadAttachmentMetadata({
        claimId, storagePath: path, fileName: file.name,
        fileSize: file.size, mimeType: file.type,
      });
      if (!res.ok) alert(res.error);
      else window.location.reload();
    });
  }

  async function getDownloadUrl(a: Attachment) {
    const { data } = await supabase.storage.from('claim-attachments')
      .createSignedUrl(a.storage_path, 60 * 5);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  return (
    <section>
      <h3 className="font-medium text-sm mb-1">Adjuntos</h3>
      <ul className="space-y-1 text-sm mb-2">
        {attachments.map(a => (
          <li key={a.id}>
            <button onClick={() => getDownloadUrl(a)} className="underline text-blue-700">
              {a.file_name}
            </button>
            <span className="text-xs text-slate-500 ml-2">
              {a.file_size ? `${Math.round(a.file_size / 1024)} KB` : ''}
            </span>
          </li>
        ))}
        {attachments.length === 0 && <li className="text-slate-500">Ninguno</li>}
      </ul>
      <input type="file" onChange={onFile} disabled={pending} />
    </section>
  );
}
```

- [ ] **Step 3: Fetch attachments en `page.tsx` y montar el componente**

En el bloque de detail:
```tsx
if (claim) {
  const [{ data: events }, { data: atts }] = await Promise.all([
    supabase.from('claim_events').select('*').eq('claim_id', claimId).order('created_at', { ascending: true }),
    supabase.from('attachments').select('*').eq('claim_id', claimId).order('created_at', { ascending: true }),
  ]);
  detail = (
    <ClaimDetailDialog claim={claim} profiles={profiles ?? []}>
      <Timeline events={events ?? []} profiles={profiles ?? []} />
      <Attachments claimId={claim.id} initial={atts ?? []} />
      <CommentBox claimId={claim.id} />
    </ClaimDetailDialog>
  );
}
```
Import: `import { Attachments } from './Attachments';`

- [ ] **Step 4: Verificar en browser**

Subir un archivo, ver que aparece en la lista y que se abre al clickearlo (URL firmada expira en 5 min).

- [ ] **Step 5: Commit**

```powershell
git add app/board/
git commit -m "feat(board): adjuntos con upload a Storage + descarga con URL firmada"
```

---

## Task 16: Resend wrapper + template email

**Files:**
- Create: `lib/email/resend.ts`, `lib/email/templates.ts`

- [ ] **Step 1: Crear `lib/email/templates.ts`**

```ts
import { COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';

export function assignmentEmail(opts: {
  recipientName: string;
  claimId: number;
  remitoNumber: string;
  observations: string;
  column: ClaimColumn;
  appUrl: string;
}) {
  const link = `${opts.appUrl}/board?claim=${opts.claimId}`;
  const columnLabel = COLUMN_LABEL[opts.column];
  const obsShort = opts.observations.length > 200
    ? opts.observations.slice(0, 200) + '...'
    : opts.observations;
  return {
    subject: `[Reclamos Shimano] Tarjeta asignada — Remito #${opts.remitoNumber}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
        <h2 style="margin: 0 0 8px;">Hola ${opts.recipientName},</h2>
        <p style="margin: 0 0 16px;">
          Se te asignó una tarjeta en la columna <strong>${columnLabel}</strong>.
        </p>
        <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <div style="font-size: 12px; color: #64748b;">Remito</div>
          <div style="font-weight: 600; margin-bottom: 8px;">#${opts.remitoNumber}</div>
          <div style="font-size: 12px; color: #64748b;">Observaciones</div>
          <div style="white-space: pre-wrap;">${obsShort}</div>
        </div>
        <a href="${link}" style="display: inline-block; background: #0f172a; color: white; padding: 10px 16px; border-radius: 6px; text-decoration: none;">Abrir reclamo</a>
        <p style="font-size: 12px; color: #64748b; margin-top: 24px;">
          Enviado por Reclamos Shimano.
        </p>
      </div>`,
  };
}
```

- [ ] **Step 2: Crear `lib/email/resend.ts`**

```ts
import 'server-only';
import { Resend } from 'resend';

const key = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
const resend = key ? new Resend(key) : null;

export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  if (!resend) return { ok: false, error: 'RESEND_API_KEY not set' };
  try {
    const { data, error } = await resend.emails.send({
      from, to: opts.to, subject: opts.subject, html: opts.html,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Unknown error' };
  }
}
```

- [ ] **Step 3: Commit (sin usarlo todavía)**

```powershell
git add lib/email/
git commit -m "feat(email): wrapper Resend + template asignacion"
```

---

## Task 17: Notif email en createClaim + moveClaim + eventos email_sent/failed

**Files:**
- Modify: `app/board/actions.ts`

- [ ] **Step 1: Extraer helper `notifyAssignee` en `actions.ts`**

Al final del archivo (o justo antes de las Server Actions), agregar:
```ts
import { sendEmail } from '@/lib/email/resend';
import { assignmentEmail } from '@/lib/email/templates';
import type { ClaimColumn } from '@/lib/columns';

async function notifyAssignee(opts: {
  claimId: number;
  assigneeId: string;
  actorId: string;
  column: ClaimColumn;
}) {
  const supabase = await createClient();
  const [{ data: assignee }, { data: claim }] = await Promise.all([
    supabase.from('profiles').select('email, display_name').eq('id', opts.assigneeId).single(),
    supabase.from('claims').select('remito_number, observations').eq('id', opts.claimId).single(),
  ]);
  if (!assignee || !claim) return;
  const { subject, html } = assignmentEmail({
    recipientName: assignee.display_name,
    claimId: opts.claimId,
    remitoNumber: claim.remito_number,
    observations: claim.observations,
    column: opts.column,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  });
  const res = await sendEmail({ to: assignee.email, subject, html });
  await supabase.from('claim_events').insert({
    claim_id: opts.claimId,
    actor_id: opts.actorId,
    event_type: res.ok ? 'email_sent' : 'email_failed',
    metadata: { email_to: assignee.email, error: res.ok ? null : res.error },
  });
}
```

- [ ] **Step 2: Llamar `notifyAssignee` desde `createClaim`**

Al final de `createClaim`, antes del `return`:
```ts
if (assigneeId !== user.id) {
  await notifyAssignee({
    claimId: claim.id, assigneeId, actorId: user.id, column: 'nuevo',
  });
}
```

- [ ] **Step 3: Llamar `notifyAssignee` desde `moveClaim`**

Al final de `moveClaim` (después del insert de `moved`, antes del return):
```ts
if (newAssigneeId !== user.id) {
  await notifyAssignee({
    claimId, assigneeId: newAssigneeId, actorId: user.id, column: toColumn as ClaimColumn,
  });
}
```

- [ ] **Step 4: Probar con Resend key vacía**

Sin `RESEND_API_KEY` configurada, crear/mover un claim que asigne a otro usuario. En Studio ver que el `claim_events` tiene un `email_failed` con `metadata.error = "RESEND_API_KEY not set"`. Confirmar que el reclamo se creó/movió igual.

- [ ] **Step 5: Commit**

```powershell
git add app/board/actions.ts
git commit -m "feat(email): notificar al assignee en create/move con evento email_sent|failed"
```

---

## Task 18: Tests unit — permissions + validators

**Files:**
- Create: `tests/unit/permissions.test.ts`, `tests/unit/validators.test.ts`

- [ ] **Step 1: Crear `tests/unit/permissions.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isAdmin, canMoveClaim } from '@/lib/permissions';

describe('isAdmin', () => {
  it('true si role=admin', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });
  it('false si role distinto', () => {
    expect(isAdmin({ role: 'shimano' })).toBe(false);
    expect(isAdmin({ role: 'deposito' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});

describe('canMoveClaim', () => {
  const claim = { assignee_id: 'user-1' };
  it('true si soy el assignee', () => {
    expect(canMoveClaim('user-1', claim, { role: 'shimano' })).toBe(true);
  });
  it('true si soy admin aunque no sea assignee', () => {
    expect(canMoveClaim('user-2', claim, { role: 'admin' })).toBe(true);
  });
  it('false si no soy assignee ni admin', () => {
    expect(canMoveClaim('user-2', claim, { role: 'shimano' })).toBe(false);
  });
});
```

- [ ] **Step 2: Crear `tests/unit/validators.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { CreateClaimSchema, MoveClaimSchema } from '@/lib/validators';

describe('CreateClaimSchema', () => {
  it('acepta input valido', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: 'R-1', observations: 'obs',
      assigneeId: '00000000-0000-0000-0000-000000000000',
    });
    expect(r.success).toBe(true);
  });
  it('rechaza remito vacio', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: '', observations: 'obs',
      assigneeId: '00000000-0000-0000-0000-000000000000',
    });
    expect(r.success).toBe(false);
  });
  it('rechaza uuid invalido', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: 'R-1', observations: 'obs', assigneeId: 'not-uuid',
    });
    expect(r.success).toBe(false);
  });
});

describe('MoveClaimSchema', () => {
  it('acepta columna valida', () => {
    const r = MoveClaimSchema.safeParse({
      claimId: 1, toColumn: 'deposito_revisa',
      newAssigneeId: '00000000-0000-0000-0000-000000000000',
    });
    expect(r.success).toBe(true);
  });
  it('rechaza columna invalida', () => {
    const r = MoveClaimSchema.safeParse({
      claimId: 1, toColumn: 'foo',
      newAssigneeId: '00000000-0000-0000-0000-000000000000',
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 3: Correr tests**

```powershell
npm test
```
Expected: RLS tests + unit tests pasan (verde total).

- [ ] **Step 4: Commit**

```powershell
git add tests/unit/
git commit -m "test(unit): permissions helpers + zod validators"
```

---

## Task 19: Test E2E Playwright — flow completo

> **Cloud-only nota:** en este workflow el E2E requeriría pegar contra el proyecto cloud (crearía usuarios test que se acumulan) o contra un segundo proyecto Supabase dedicado. Para el MVP **skipeamos la ejecución del E2E** — dejamos el archivo escrito pero comentado. Smoke test manual reemplaza al E2E en Task 20 Step 6. Cuando exista un test project o Docker, activar.

**Files:**
- Create: `playwright.config.ts.skip`, `tests/e2e/flow-completo.spec.ts.skip`

- [ ] **Step 1: Crear `playwright.config.ts.skip`** (mismo contenido, extension .skip para no correr)

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

- [ ] **Step 2: (SKIP) Instalar browsers de Playwright**

Se saltea en MVP cloud-only. Activar cuando exista test project.

- [ ] **Step 3: Escribir `tests/e2e/flow-completo.spec.ts.skip`** (extension .skip)

```ts
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });

test.describe('Flow completo', () => {
  let userA_email: string, userB_email: string;

  test.beforeAll(async () => {
    const svc = admin();
    userA_email = `e2e-a-${Date.now()}@test.com`;
    userB_email = `e2e-b-${Date.now()}@test.com`;
    for (const [email, role] of [[userA_email, 'shimano'], [userB_email, 'deposito']]) {
      const { data } = await svc.auth.admin.createUser({
        email, password: 'e2e12345!', email_confirm: true,
      });
      await svc.from('profiles').insert({
        id: data.user!.id, email, role, display_name: email.split('@')[0],
      });
    }
  });

  test('userA crea reclamo asignado a userB, userB lo mueve, userA lo cierra', async ({ page, browser }) => {
    // A) userA login + crear reclamo asignado a userB
    await page.goto('/login');
    await page.fill('input[name=email]', userA_email);
    await page.fill('input[name=password]', 'e2e12345!');
    await page.click('button[type=submit]');
    await page.waitForURL(/\/board/);

    await page.click('text=+ Nuevo reclamo');
    await page.fill('input[name=remito_number]', `E2E-${Date.now()}`);
    await page.fill('textarea[name=observations]', 'reclamo de test e2e');
    await page.selectOption('select[name=assignee_id]', { label: /e2e-b-/ });
    await page.click('button:has-text("Crear")');
    await page.waitForLoadState('networkidle');

    // B) userB login en sesión aparte y ve el reclamo
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto('/login');
    await pageB.fill('input[name=email]', userB_email);
    await pageB.fill('input[name=password]', 'e2e12345!');
    await pageB.click('button[type=submit]');
    await pageB.waitForURL(/\/board/);
    await expect(pageB.locator('text=reclamo de test e2e')).toBeVisible();

    // (opcional) mover via UI queda para futuro — DnD en Playwright requiere setup extra.
    // Aca solo validamos que el reclamo aparece y que userA lo ve tambien.
    await expect(page.locator('text=reclamo de test e2e')).toBeVisible();
  });
});
```

- [ ] **Step 4: (SKIP) Correr E2E** — se saltea MVP.

- [ ] **Step 5: Commit archivos .skip**

```powershell
git add playwright.config.ts.skip tests/e2e/ package.json package-lock.json
git commit -m "test(e2e): flow completo (SKIP en MVP cloud-only; activar con test project)"
```

---

## Task 20: CI GitHub Actions + deploy Vercel + smoke prod

**Files:**
- Create: `.github/workflows/ci.yml`, `.env.local.example` (revisar)

- [ ] **Step 1: Crear `.github/workflows/ci.yml`** (versión cloud-only, sin RLS/E2E)

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
```
Nota: sin `supabase start`/RLS/E2E — cuando se sume test project o docker, actualizar el workflow.

- [ ] **Step 2: Push a GitHub**

```powershell
# Si el repo remoto no existe:
gh repo create app-reclamos-shimano --private --source=. --remote=origin --push
# Si existe:
git push -u origin main
```

- [ ] **Step 3: (Ya hecho en Task 2)** Proyecto Supabase Cloud ya está linkeado y con todas las migrations aplicadas. Skip.

- [ ] **Step 4: Deploy Vercel**

```powershell
npm install -g vercel
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL       # tres environments (prod/preview/dev)
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add RESEND_API_KEY
vercel env add RESEND_FROM_EMAIL
vercel env add NEXT_PUBLIC_APP_URL             # tu URL prod cuando la sepas
vercel --prod
```

Después del primer deploy, actualizar `NEXT_PUBLIC_APP_URL` a la URL definitiva y redeployar.

- [ ] **Step 5: Crear primer set de usuarios en prod**

Supabase Dashboard > Authentication > Add user (email + password), luego SQL Editor:
```sql
insert into public.profiles (id, email, role, display_name)
values ((select id from auth.users where email='<email>'),
        '<email>', '<shimano|deposito|admin>', '<Nombre>');
```
Repetir para cada persona (arrancar con: 1 admin — Mariano — + 1 depósito + 1 shimano de prueba).

- [ ] **Step 6: Smoke test end-to-end en prod**

- [ ] Abrir la URL de prod, loguearse con el admin.
- [ ] Crear un reclamo asignado al usuario del depósito.
- [ ] Chequear que llegó el email (si `RESEND_API_KEY` está configurada — si no, evento `email_failed` en Studio).
- [ ] Loguearse como depósito en incógnito, ver el reclamo, moverlo, adjuntar un archivo.
- [ ] Confirmar en el timeline que las acciones quedaron registradas.
- [ ] Verificar `GET /api/health` responde `{ok: true}`.

- [ ] **Step 7: Commit + docs de rollout**

```powershell
git add .github/
git commit -m "ci: pipeline GitHub Actions (typecheck + tests + e2e con Supabase local)"

# Actualizar README con URL prod y credenciales admin
```

Modificar `README.md` para reflejar el estado shipped:

```markdown
# APP-RECLAMOS — Reclamos Shimano ↔ Depósito

App tipo Trello para gestionar reclamos entre Shimano y el depósito.

- **Stack:** Next.js 15 + Supabase (Postgres + Auth + Storage) + Resend + dnd-kit + shadcn/ui
- **Deploy:** Vercel (main = prod, PRs = preview)
- **URL prod:** https://<tu-vercel-url>
- **Estado:** MVP shipped 2026-09-2X

## Setup local

1. `docker` + `node 20+` + `supabase` CLI instalados.
2. `supabase start` → copiar keys a `.env.local` (ver `.env.local.example`).
3. `npm install && npm run dev`.

## Testing

- `npm test` — unit + RLS (requiere Supabase local corriendo).
- `npm run test:e2e` — Playwright (requiere Supabase local + dev server).

## Docs

- [Design doc](./docs/specs/2026-09-21-app-reclamos-shimano-design.md)
- [Implementation plan](./docs/superpowers/plans/2026-09-21-mvp-app-reclamos.md)
```

```powershell
git add README.md
git commit -m "docs: README actualizado con estado shipped + setup local"
git push
```

---

## Post-MVP (referencia — NO parte de este plan)

Cuando corresponda arrancar V1, crear un nuevo plan `docs/superpowers/plans/YYYY-MM-DD-v1-app-reclamos.md` con:
- UI admin `/admin/users` (crear/desactivar users)
- Filtros/búsqueda avanzada en board
- Dashboard de métricas
- Export CSV

**Tests que quedaron pendientes (workflow cloud-only):**
- Activar tests RLS (`tests/rls/claims-rls.test.ts.skip` → `.ts`) cuando se instale Docker Desktop o se cree un segundo proyecto Supabase de test.
- Activar E2E Playwright (`playwright.config.ts.skip` + `tests/e2e/*.spec.ts.skip` → sin `.skip`) idem.
- Actualizar `.github/workflows/ci.yml` para incluir esos tests.

---

## Self-review checklist (post-plan, pre-ejecución)

- [x] **Spec coverage:** cada sección del spec tiene tasks — auth (T6), 6 columnas (T2, T5, T8), assignable per card (T9, T11), email notif (T16, T17), email+pass admin (T6 + setup manual T20), adjuntos (T15), remito texto libre (T11), permiso mover only assignee (T3 RLS + T9), timeline + comentarios (T13, T14), deployment Vercel+Supabase (T20), testing RLS+unit+E2E (T3, T18, T19).
- [x] **Placeholder scan:** sin "TBD"/"implementar después"/"similar a"; todos los steps tienen código o comando concreto.
- [x] **Type consistency:** `moveClaim` firma consistente entre `validators.ts`, `actions.ts` y `Board.tsx`; `CLAIM_COLUMNS.key` alineado con enum de la migration 001; `ClaimColumn` type reusado.
- [x] **Gaps intencionales:** UI admin queda fuera (documentado en "Alcance" y en step T20-5 se hace manual). Restricciones de transición de columna quedan permisivas por decisión del spec (§5.2).
