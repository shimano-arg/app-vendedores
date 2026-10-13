# App Reclamos Shimano ↔ Depósito — Design Doc

**Fecha:** 2026-09-21
**Autor:** Mariano (co-diseñado con Claude Code)
**Estado:** Draft para review

---

## 1. Contexto y objetivo

Gestionar el ida-y-vuelta de reclamos entre Shimano y el depósito (bultos dañados, faltantes, errores de picking, etc.). Hoy no hay sistema — se maneja por mail/WhatsApp y se pierde trazabilidad. Se necesita:

- Un lugar único donde carguen los reclamos con **número de remito** y **observaciones**.
- Un tablero visual estilo **Trello** con columnas por etapa del flujo.
- Que cada tarjeta tenga un **responsable** que reciba **email** cuando la tarjeta le llega.
- Historial auditable de qué pasó con cada reclamo.

Fuera de scope MVP: métricas/dashboard, integración SAP, WhatsApp, mobile-first PWA.

---

## 2. Decisiones tomadas en brainstorming

| Decisión | Elegido | Descarté |
|---|---|---|
| Arquitectura | App standalone nueva (`Desktop\APP-RECLAMOS\`) | Módulo dentro de APP VENDEDORES / App local |
| Columnas del flujo | 6 columnas fijas (Nuevo → Depósito revisa → Respuesta depósito → Shimano valida → Resuelto → Cerrado) | 4 columnas simplificado |
| Responsable por columna | Asignable por tarjeta (cambia al mover) | Fijo por columna / Por rol |
| Notificación | Email transaccional (Resend) | WhatsApp / In-app / Combo |
| Auth | Email + password, admin da de alta | Google login / Magic link |
| Adjuntos | Múltiples archivos por tarjeta | Solo texto / Solo 1 foto al crear |
| Remito | Texto libre (sin validación externa en v1) | Lookup BigQuery / Import CSV |
| Permiso mover | Solo el responsable actual de la tarjeta | Cualquiera del rol / Cualquier logueado |
| Historial | Timeline por tarjeta + comentarios | Solo estado actual / Timeline + dashboard global |
| Deployment | Vercel + Supabase (Postgres + Auth + Storage) | Firebase / Server local |

---

## 3. Stack técnico

| Capa | Herramienta | Razón |
|---|---|---|
| Framework | Next.js 15 (App Router, RSC + Server Actions) | Full-stack de una sola pieza; deploy Vercel one-click |
| Base de datos | Supabase Postgres | Relacional encaja natural con tarjetas ↔ comentarios ↔ adjuntos ↔ historial |
| Auth | Supabase Auth (email + password) | Nativo, incluye recuperación, sin código propio |
| Storage | Supabase Storage | Bucket con policy alineada a la app; URLs firmadas para adjuntos |
| Realtime | Supabase Realtime (Postgres Changes) | Sync de kanban entre usuarios abiertos al mismo tiempo |
| Email | Resend | Nativo Vercel, tier free 100/día, DX simple |
| DnD | @dnd-kit/core + @dnd-kit/sortable | Actively maintained; el ex-react-beautiful-dnd está deprecated |
| UI | shadcn/ui + Tailwind CSS | Componentes accesibles, personalizables, sin lock-in |
| Testing | Vitest (unit) + Playwright (E2E) + Supabase local (docker) para RLS | Estándar del ecosistema Next+Supabase |

---

## 4. Modelo de datos

### 4.1 Tablas

**`profiles`** (extiende `auth.users` de Supabase Auth)
```
id            uuid PK       -- FK a auth.users.id
email         text unique
role          text          -- 'shimano' | 'deposito' | 'admin'
display_name  text
active        boolean       -- soft-delete: false = deshabilitado
created_at    timestamptz
```

**`claims`** (tarjetas del kanban)
```
id                bigserial PK
remito_number     text not null
observations      text not null
current_column    text not null  -- enum via CHECK: nuevo | deposito_revisa | respuesta_deposito | shimano_valida | resuelto | cerrado
assignee_id       uuid FK profiles(id)
created_by        uuid FK profiles(id) not null
created_at        timestamptz default now()
updated_at        timestamptz default now()
```

**`claim_events`** (timeline auditable)
```
id            bigserial PK
claim_id      bigint FK claims(id) not null
actor_id      uuid FK profiles(id) not null
event_type    text not null  -- 'created' | 'moved' | 'assigned' | 'commented' | 'attached' | 'email_sent' | 'email_failed'
from_column   text            -- null si no aplica
to_column     text            -- null si no aplica
comment_text  text            -- null si no aplica
metadata      jsonb           -- { attachment_id, email_to, error, ... }
created_at    timestamptz default now()
```

**`attachments`**
```
id             bigserial PK
claim_id       bigint FK claims(id) not null
storage_path   text not null  -- path en el bucket Supabase Storage
file_name      text not null
file_size      integer
mime_type      text
uploaded_by    uuid FK profiles(id) not null
created_at    timestamptz default now()
```

### 4.2 Row Level Security (RLS)

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | any authed | admin only | self o admin | admin only |
| `claims` | any authed | any authed | `auth.uid() = assignee_id` OR admin | admin only |
| `claim_events` | any authed | any authed | ninguno (append-only) | admin only |
| `attachments` | any authed | any authed | ninguno | uploader o admin |

Storage bucket `claim-attachments`: policy paralela — read para authed, write para authed, delete solo para uploader/admin.

### 4.3 Índices

- `claims(current_column, updated_at desc)` — kanban orden por columna
- `claims(assignee_id)` — filtro "mis tarjetas"
- `claim_events(claim_id, created_at desc)` — timeline
- `attachments(claim_id)` — listar adjuntos

---

## 5. Flujos clave

### 5.1 Crear reclamo
1. Usuario logueado abre `/board` → botón "Nuevo reclamo".
2. Modal con: remito (text), observaciones (textarea), assignee inicial (select de profiles), adjuntos (drop-zone).
3. Submit → Server Action `createClaim(...)`:
   - Insert en `claims` con `current_column='nuevo'`.
   - Sube adjuntos a Storage → insert en `attachments`.
   - Insert `claim_events` (`event_type='created'`).
   - Si `assignee_id != created_by` → dispara email al assignee.
4. Return al board. Realtime empuja la tarjeta a las demás sesiones.

### 5.2 Mover tarjeta (columna + reasignar)
1. Usuario abre modal detalle de la tarjeta → botón "Mover" (solo si `assignee = él` o admin).
2. Elige columna destino + nuevo assignee (select obligatorio).
3. Server Action `moveClaim(claimId, toColumn, newAssigneeId)`:
   - Valida caller = assignee actual (o admin) — RLS lo garantiza a nivel DB.
   - Valida transición: cualquier columna → cualquier columna (no restringimos por ahora; se puede endurecer después).
   - Transacción: update `claims` + insert `claim_events` (event_type='moved').
   - Post-commit: envía email al nuevo assignee via Resend.
   - Registra resultado del email (`event_type='email_sent'` o `'email_failed'` en `claim_events`).
4. Realtime propaga a las otras sesiones.

**Nota diseño:** el email se dispara inline en el Server Action, no via cron/queue. Es más simple y para el volumen esperado (decenas/día) no hace falta cola. Si falla el envío, se loguea en `claim_events` y se muestra un warning al usuario; la tarjeta ya se movió (email es best-effort, no bloquea la transición).

### 5.3 Comentar
- En el modal detalle: textarea + botón "Comentar" → insert `claim_events` (event_type='commented').
- No dispara email (evitamos spam; si se quiere ping, se reasigna).

### 5.4 Adjuntar archivo post-creación
- En el modal detalle: drop-zone → upload a Storage → insert `attachments` + `claim_events` (event_type='attached').

### 5.5 Admin: crear usuarios
- `/admin/users` (solo rol admin): formulario email + password + role + display_name.
- Server Action llama a Supabase Auth Admin API (usa Service Role Key server-side) para crear el user, luego insert en `profiles`.
- Deshabilitar usuario = `active=false` (no borra; RLS puede filtrar por `active=true` si hace falta).

---

## 6. UI / Componentes

### 6.1 Rutas
- `/login` — login email+pass.
- `/board` — kanban principal (6 columnas). Filtros: "Todas" / "Mis tarjetas" / por assignee.
- `/board?claim=<id>` — abre modal detalle sobre el board.
- `/admin/users` — solo admin.

### 6.2 Árbol de componentes

```
app/
  layout.tsx                   -- shell + auth guard
  login/page.tsx
  board/
    page.tsx                   -- server component; fetch inicial
    Board.tsx                  -- client; dnd-kit context; realtime subscription
    Column.tsx                 -- droppable
    ClaimCard.tsx              -- draggable
    NewClaimDialog.tsx
    ClaimDetailDialog.tsx      -- modal (usa query param ?claim=)
      Timeline.tsx
      Attachments.tsx
      CommentBox.tsx
      MoveClaimForm.tsx
  admin/users/
    page.tsx
    NewUserDialog.tsx
    UsersTable.tsx
lib/
  supabase/
    client.ts                  -- para RSC + Server Actions
    server.ts                  -- service role (usar SOLO en server, nunca leak)
  email/
    resend.ts                  -- wrapper Resend con retry
    templates.ts               -- HTML templates por evento
  permissions.ts               -- helpers isAdmin / canMove / etc.
  types.ts                     -- Zod schemas + TS types generados de Supabase
```

### 6.3 Estilo visual
- Base shadcn/ui + Tailwind. Sin custom design system inicial — priorizamos velocidad.
- Board columnas de ancho fijo (~320px), scroll horizontal en mobile.
- Colores por columna (chips sutiles) — un accent color por etapa para escanear rápido.

---

## 7. Notificaciones por email

### 7.1 Cuándo se dispara
- Crear reclamo con assignee ≠ creador.
- Mover tarjeta → email al nuevo assignee.
- (No en comentarios, no en adjuntos post-creación.)

### 7.2 Template
- **Subject:** `[Reclamos Shimano] Tarjeta asignada — Remito #<num>`
- **Body HTML:**
  - Saludo con `display_name`.
  - "Se te asignó una tarjeta en la columna **<columna>**."
  - Bloque con remito, observaciones (primer párrafo), última acción.
  - Botón CTA "Abrir reclamo" → link a `/board?claim=<id>`.
  - Footer con "Enviado por Reclamos Shimano".

### 7.3 From / dominio
- `reclamos@<dominio-verificado>.com` en Resend.
- En v1 se puede usar `onboarding@resend.dev` mientras se configura DNS.

---

## 8. Manejo de errores

| Escenario | Comportamiento |
|---|---|
| Server Action falla (DB error) | Toast rojo con mensaje genérico; log al server; no muta estado local |
| Move válido en DB pero email falla | Tarjeta se movió; toast amarillo "Movida pero falló el aviso"; evento `email_failed` en timeline |
| Upload adjunto falla | Tarjeta se creó/movió; toast rojo del adjunto; el usuario reintenta |
| RLS bloquea update (no soy assignee) | Toast rojo "No sos el responsable actual"; botón "Mover" ocultado también en UI |
| Sesión expirada | Middleware redirige a `/login?next=<url actual>` |
| Realtime desconecta | Banner discreto "Reconectando..."; auto-retry |

---

## 9. Testing

- **Unit (Vitest):** validators de forms, transiciones de columna, permissions helpers.
- **RLS (Supabase local + Vitest):** cada policy tiene un test que verifica allow + deny con distintos roles.
- **E2E (Playwright):** flow completo — admin crea 2 usuarios → user A crea reclamo asignado a user B → user B lo ve, comenta, mueve → user C recibe la tarjeta.
- Sin cobertura mínima obligatoria en v1, pero los caminos críticos (crear/mover/notificar) sí tienen E2E.

---

## 10. Deployment

- Repo GitHub `app-reclamos-shimano` (nuevo).
- Vercel conecta el repo; `main` = prod, PRs = preview.
- Env vars en Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`.
- Supabase project nuevo en la región más cercana (São Paulo).
- Migrations versionadas en `supabase/migrations/*.sql`; deploy via `supabase db push` en CI (GitHub Action al hacer merge a main).

---

## 11. Estructura de carpetas del repo

```
APP-RECLAMOS/
├── app/                    # Next.js App Router
├── components/             # UI compartidos (Button, Dialog, etc. via shadcn)
├── lib/
│   ├── supabase/
│   ├── email/
│   └── permissions.ts
├── supabase/
│   ├── migrations/
│   │   ├── 001_init.sql
│   │   ├── 002_rls.sql
│   │   └── 003_indexes.sql
│   └── seed.sql
├── tests/
│   ├── unit/
│   ├── rls/
│   └── e2e/
├── docs/
│   ├── specs/
│   │   └── 2026-09-21-app-reclamos-shimano-design.md   # este archivo
│   └── README.md
├── .env.local.example
├── .github/workflows/deploy.yml
├── next.config.ts
├── package.json
└── README.md
```

---

## 12. Roadmap por fases

### MVP (v0.1) — objetivo shipping en 1-2 semanas
- Auth email+pass (Supabase Auth).
- Kanban 6 columnas con dnd + realtime.
- Crear/mover/asignar tarjeta.
- Adjuntos múltiples (Supabase Storage).
- Comentarios y timeline por tarjeta.
- Email transaccional al mover (Resend).
- Admin crea usuarios manualmente vía Supabase Studio (sin UI aún).

### V1.0 — post-shipping según feedback
- UI `/admin/users` para gestionar usuarios sin abrir Studio.
- Filtros/búsqueda avanzada en board (por remito, fecha, texto en observaciones).
- Export CSV de reclamos.
- Métricas básicas: reclamos abiertos, tiempo promedio por columna, top responsables.

### V2 — ideas para después
- Lookup remito contra BigQuery/SAP (autocomplete + validación).
- Canal WhatsApp adicional al mail (Twilio o WA Cloud API).
- PWA mobile-optimized para el depósito.
- Restricciones de transición de columna (state machine explícita).

---

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Depósito no lee mails a tiempo | V1.0 evalúa sumar WhatsApp; mientras tanto, badge in-app al login |
| Volumen de adjuntos crece → costo Supabase Storage | Monitorear; policy de retention a 12 meses en V2 |
| RLS mal configurada = leak entre orgs | Tests RLS obligatorios en CI; principio de least privilege por default deny |
| Resend free tier (100/día) se satura | Upgrade a paid ($20/mes por 50k) — trivial cuando pase |
| Realtime cae y las sesiones desincronizan | Reload de página siempre trae estado fresh; realtime es UX bonus |
| Pérdida de accountability porque cualquiera reasigna | Reasignación queda registrada en `claim_events`; auditable |

---

## 14. Preguntas abiertas

Ninguna bloqueante para arrancar la implementación. Ítems que se resolverán durante el build:

- Dominio custom para Resend (¿tenés uno disponible o arrancamos con sandbox de Resend?).
- Región Supabase confirmada (São Paulo por default salvo mejor opción).
- Diseño exacto del email HTML (arranco con un template limpio; iteramos si querés).
