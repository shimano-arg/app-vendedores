# APP-RECLAMOS — Reclamos Shimano ↔ Depósito

Kanban tipo Trello para gestionar reclamos entre Shimano y el depósito.

- **Stack:** Next.js 16 (App Router + Server Actions) + Supabase (Postgres + Auth + Storage + Realtime) + Gmail SMTP (nodemailer) + dnd-kit + shadcn/ui + Tailwind v4
- **Deploy:** Vercel (main = prod, PRs = preview)
- **Auth:** email + password. Los usuarios los da de alta el admin desde Supabase Dashboard (V1 tendrá UI).

## Estado

- **2026-09-21** — MVP shipped en producción: https://app-reclamos-shimano.vercel.app
  6 columnas, DnD, adjuntos, comentarios, timeline, email al assignee (best-effort). Base para V1.
- **2026-09-25** — Post-MVP en un dia: rediseño Apple (glass, foto de fondo, motion), responsables default por columna, eliminar reclamo, campos extra (Nº factura / Cliente / Nombre fantasía) + checklist videos, botón "Pasar a <col>" en modal detalle, layout kanban full-width con `grid-cols-6` en desktop, modal detalle 2 columnas, `DragOverlay` para arrastre por encima de backdrop-blur de columnas hermanas.
- **2026-09-25** — **Contador de tiempo por card + breakdown por columna**: badge redondeado en la card (`recién` / `5h` / `3d`, con tone `neutral < 24h`, `warning 24–72h`, `danger > 72h`, verde `closed` cuando llega a Cerrado); sección "Tiempos" en el modal con total end-to-end + barra proporcional por columna para ver cuellos de botella (helpers en `lib/timeInColumn.ts`).
- **2026-09-25** — Migración de Resend → **Gmail SMTP (nodemailer)** con la cuenta bot `bot.shimano.pesca@gmail.com` (misma que app-vendedores). Sin dependencia de dominio verificado ni cuenta Resend.
- **2026-09-29** — `notifyAssignee` corre **siempre** que hay una asignación, incluso auto-asignación (audit trail completo por email). Timeline `<ol>` con `max-h + overflow-y-auto` interno para que el modal no scrollee globalmente.

**Prod:** Vercel scope `erbinomariano-propio` / project `app-reclamos-shimano`.
**DB/Auth/Storage:** Supabase Cloud (project ref `bgbfdfncgxqmlktbewgz`, región `sa-east-1`).
**Emails:** Gmail SMTP vía nodemailer con la cuenta bot `bot.shimano.pesca@gmail.com` (reusa el app password de app-vendedores).

## Features actuales

**Board (Kanban):**
- 6 columnas fijas: Nuevo → Depósito revisa → Respuesta depósito → Shimano valida → Resuelto → Cerrado.
- Drag & drop entre columnas con `@dnd-kit/core` + `<DragOverlay>` (portal para no quedar tapado por columnas hermanas con backdrop-blur).
- Badge de tiempo por card (compact + color por threshold; verde congelado en Cerrado).
- Grid `grid-cols-6` en desktop (sin scroll horizontal), `flex overflow-x-auto` en mobile.
- Botón **Responsables**: setear default assignee por columna (tabla `column_defaults`, RLS admin-only).
- Botón **Nuevo reclamo**: modal sheet con Nº factura / Cliente / Nombre fantasía + checklist videos + file picker múltiple.

**Detalle del reclamo (modal 2 columnas):**
- Izquierda: **Tiempos** (total + barra por columna), Datos, Observaciones, Checklist videos (`video_armado_reviewed` / `video_cliente_reviewed`), Adjuntos, botones **Eliminar** + **Pasar a `<col>`**.
- Derecha: **Actividad** (timeline con scroll interno max-h 38vh) + **Comentar**.
- Datos y Observaciones con `break-words` para no romper layout con remitos largos.

**Emails:**
- Nodemailer + Gmail SMTP, from `bot.shimano.pesca@gmail.com`.
- Se dispara en `createClaim` y en `moveClaim` (incluso auto-asignación). Best-effort: si falla, no rompe la operación y queda un evento `email_failed` en el timeline con el error.

**Realtime:**
- Supabase Realtime en tabla `claims`. Al cambio → `window.location.reload()` (todavía no optimista para no lidiar con conflictos entre pestañas).

## Docs

- [Design doc](./docs/specs/2026-09-21-app-reclamos-shimano-design.md)
- [Implementation plan MVP](./docs/superpowers/plans/2026-09-21-mvp-app-reclamos.md)

## Setup local

**Prerrequisitos:** Node 20+ (usamos 24), npm, [Supabase CLI](https://supabase.com/docs/guides/cli).

```powershell
git clone <este-repo>
cd APP-RECLAMOS
npm install
cp .env.local.example .env.local  # completar con URLs y keys del proyecto Supabase Cloud
npm run dev
```

Abrir http://localhost:3000 → redirige a `/login`. Loguearse con un usuario creado en Supabase Dashboard (ver "Crear usuarios" abajo).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Dev server (Turbopack) en http://localhost:3000 |
| `npm run build` | Build de producción |
| `npm run typecheck` | `tsc --noEmit` (sin generar código) |
| `npm test` | Unit tests (Vitest) — 14 tests, sin DB |
| `npm run gen:types` | Regenera `lib/supabase/types.ts` desde el proyecto Supabase linkeado |
| `supabase db push` | Aplica migrations pendientes a cloud (require `supabase login` + `link`) |

## Estructura

```
app/
├── login/            # Login page + Server Actions (login + logout)
├── board/
│   ├── page.tsx                    # Server Component; carga claims + profiles + column_defaults + eventos y computa cardDurations
│   ├── Board.tsx                   # DndContext + <DragOverlay> + realtime; propaga cardDurations
│   ├── Column.tsx                  # droppable con backdrop-blur + tint
│   ├── ClaimCard.tsx               # draggable + CardBody compartido + <ClaimCardOverlay>
│   ├── NewClaimDialog.tsx          # modal creación (campos extra + checklist + files)
│   ├── ClaimDetailDialog.tsx       # modal detalle 2 columnas (sideContent slot)
│   ├── TimeBreakdown.tsx           # sección Tiempos: total + barra por columna
│   ├── Timeline.tsx                # <ol> Actividad con scroll interno
│   ├── CommentBox.tsx              # Server Action addComment
│   ├── Attachments.tsx             # upload a Storage + list + URL firmada
│   ├── DeleteClaimButton.tsx       # pill rojo + confirm + cascade delete
│   ├── NextColumnButton.tsx        # botón "Pasar a <col>" (respeta default assignee)
│   ├── VideoReviewToggle.tsx       # checklist videos con toggle en vivo
│   ├── ColumnDefaultsDialog.tsx    # UI Responsables (default por columna)
│   └── actions.ts                  # todas las Server Actions del board
├── api/health/       # GET {ok:true}
├── layout.tsx        # Shell base con header + logo + logout
└── page.tsx          # Redirect a /board

lib/
├── supabase/         # 3 clientes (browser/server RSC/service_role) + types generados
├── email/            # nodemailer wrapper (Gmail SMTP) + template assignmentEmail
├── columns.ts        # 6 columnas del kanban con label + tint + COLUMN_KEYS
├── timeInColumn.ts   # helpers de tiempo: formatCompact, formatLong, getCardDurationBadge, getColumnBreakdown
├── validators.ts     # Zod schemas (CreateClaim, MoveClaim, ToggleVideoReview)
└── permissions.ts    # isAdmin, canMoveClaim

supabase/migrations/  # 6 migrations (init, RLS, indices, realtime, column_defaults, claim_extra_fields)
proxy.ts              # Auth guard (Next 16 renombra middleware → proxy)
scripts/              # Utilidades (crear admin, seeds, etc.)
tests/                # unit/ (14 verde) + rls/ (.skip) + e2e/ (.skip)
```

## Crear usuarios

**Admin (via Supabase Dashboard):**
1. Auth > Users > Add User → email + password + "Auto Confirm User" ✓
2. SQL Editor:
   ```sql
   insert into public.profiles (id, email, role, display_name)
   select id, email, 'shimano', 'Nombre Persona' from auth.users where email='<mail>';
   -- role: 'shimano' | 'deposito' | 'admin'
   ```

(V1 tendrá UI `/admin/users` para no abrir Dashboard cada vez.)

## Deploy (Vercel)

1. Fork/push este repo a GitHub.
2. Vercel > New Project > importar el repo.
3. Env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (nueva key `sb_publishable_...` o legacy anon)
   - `SUPABASE_SERVICE_ROLE_KEY` (nueva `sb_secret_...` o legacy service_role)
   - `GMAIL_USER=bot.shimano.pesca@gmail.com` (Plain Text)
   - `GMAIL_APP_PASSWORD` (Secret; 16 chars generado en https://myaccount.google.com/apppasswords). Sin estos, los emails se registran como `email_failed` en el timeline pero la operación de mover claim no rompe.
   - `NEXT_PUBLIC_APP_URL` (URL prod después del primer deploy)

## Post-MVP (V1 / V2)

Ver plan de implementación para el backlog completo. En corto:

- V1: UI `/admin/users`, filtros/búsqueda en board, dashboard métricas, export CSV, gate visual del botón "Responsables" y "Eliminar" a rol admin (hoy visible para todos, RLS bloquea de todos modos).
- V2: Lookup remito vs SAP/BigQuery, WhatsApp (Twilio/WA Cloud API) como canal extra al email, PWA mobile-first para depósito, restricciones de transición de columna (state machine explícita), tests RLS+E2E activados con Docker/test project.
