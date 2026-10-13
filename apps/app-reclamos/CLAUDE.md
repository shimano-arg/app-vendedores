@AGENTS.md

# APP-RECLAMOS — Contexto para próximas sesiones

App Kanban tipo Trello para gestionar reclamos entre **Shimano** y el **depósito**.
Shipped 2026-09-21. URL prod: **https://app-reclamos-shimano.vercel.app**

## 0. Migración 2026-10-13 — MONOREPO

**IMPORTANTE**: desde v1254 (2026-10-13) el código vive dentro del repo `shimano-arg/app-vendedores` en la subcarpeta `apps/app-reclamos/`. Antes vivía en el repo separado `erbinomariano-propio/app-reclamos-shimano`.

Qué cambió:
- Path local: `Desktop/APP-RECLAMOS/` → `Desktop/APP VENDEDORES/apps/app-reclamos/`
- Repo GitHub: código nuevo pushea a `shimano-arg/app-vendedores` (branch `dev` → PR `main`)
- Workflows CI: ahora en `.github/workflows/reclamos-ci.yml` y `.github/workflows/reclamos-keepalive.yml` del root, con `paths: ['apps/app-reclamos/**']` para filtrar.
- Botón acceso: desde app-vendedores header hay botón "App Reclamos" (gate admin+whitelist Mariano, mismo que MELI).

**Vercel sigue deployando desde el repo viejo** (`erbinomariano-propio/app-reclamos-shimano`) hasta que Mariano decida migrar la Git integration a `shimano-arg/app-vendedores` con Root Directory = `apps/app-reclamos`. Mientras tanto:
- Para cambios de código: editar acá + commitear al monorepo (histórico/futuro). Si el cambio tiene que deployar YA, también pushear al repo viejo (duplicado temporal).
- O ya migrar Vercel (ver instrucciones abajo) y abandonar el repo viejo.

**Migración de Vercel al monorepo (cuando se quiera)**:
1. En Vercel Dashboard → `app-reclamos-shimano` project → Settings → Git
2. Cambiar "Connected Git Repository" a `shimano-arg/app-vendedores`
3. En Settings → General → "Root Directory" setear a `apps/app-reclamos`
4. En Settings → Git → "Production Branch" dejar en `main`
5. Push a `main` de app-vendedores → Vercel debería buildear desde `apps/app-reclamos/`
6. Una vez confirmado funcional en prod, archive el repo `erbinomariano-propio/app-reclamos-shimano`

---

## 1. Estado actual (léer siempre al abrir sesión)

**Producción:** funcionando en https://app-reclamos-shimano.vercel.app con auth propia (Supabase), 4 usuarios admin activos, feature completa: 6 columnas kanban + DnD + comentarios + adjuntos + timeline + email notif (best-effort) + responsables por columna + eliminar reclamo. Diseño estilo Apple con backgrounds foto (login: pescador al atardecer; board: mar con gaviotas).

**Pendientes conocidos (no bloqueantes):**
- Recovery codes 2FA de Vercel (cuenta `botshimanopesca-1044`) — Mariano se ocupó fuera del repo.
- Cuenta Vercel de prod es `erbinomariano-propio` (personal Hobby team), NO el team `shimano-fishing-argentina` que quedó abandonado con proyecto viejo eliminado. Ver §5.

## 2. Stack técnico

| Capa | Tech | Notas |
|---|---|---|
| Framework | **Next.js 16.3.5** (App Router + Server Actions + Turbopack) | ⚠ Next 16 renombró `middleware` → `proxy`. El file `proxy.ts` en root no es middleware antiguo. |
| React | 19.2.8 con `useTransition` y `<form action={ServerAction}>` | Las Server Actions retornan `void` cuando se atan a `<form action>`. Para retornar objetos con `useActionState`, sí. |
| Styles | **Tailwind v4** con `@theme` inline en `globals.css` | shadcn/ui `sonner` (no `toast` legacy) |
| DB / Auth / Storage / Realtime | **Supabase Cloud** — project ref `bgbfdfncgxqmlktbewgz` (sa-east-1) | New API keys (`sb_publishable_*` + `sb_secret_*`), NO legacy anon/service_role |
| Email | **Gmail SMTP via nodemailer** (wrapper en `lib/email/smtp.ts`) | Reusa la cuenta bot `bot.shimano.pesca@gmail.com` compartida con app-vendedores. App password en env `GMAIL_APP_PASSWORD` |
| DnD | `@dnd-kit/core` + `@dnd-kit/sortable` | Signature: card-dragging class con scale/rotate/shadow ("peso físico" iOS) |
| Deploy | **Vercel** cuenta `erbinomariano-propio` project `app-reclamos-shimano` | Auto-deploy on push a `main` via Git integration nativa |
| Repo | **GitHub** `erbinomariano-propio/app-reclamos-shimano` (private) | Ver §5 sobre por qué NO usar `MarianoErbino` ni `botshimanopesca-beep` |

## 3. Comandos frecuentes

```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\apps\app-reclamos"

npm run dev             # dev server local en http://localhost:3000
npm run build           # build production (verificar antes de push)
npm run typecheck       # tsc --noEmit
npm test                # unit tests (Vitest, 14 tests)
npm run gen:types       # supabase gen types typescript --linked > lib/supabase/types.ts

# Aplicar migrations nuevas a cloud:
supabase db push        # requiere env vars SUPABASE_ACCESS_TOKEN + SUPABASE_DB_PASSWORD
                        # o pasarlos por flag --password

# Deploy manual (solo si Git integration falla):
vercel --prod --yes --token "$VERCEL_TOKEN"
```

**Auto-deploy:** cada `git push origin main` dispara un build en Vercel (~30-40s). Verificar con `vercel ls app-reclamos-shimano --token "$VERCEL_TOKEN"`.

## 4. Autenticación de servicios (cómo re-obtener)

Los tokens **no viven en git**. Están en `.env.local` local (excluido por `.gitignore`) y en Vercel env vars. Si se pierden:

- **Supabase Access Token** (para CLI `db push` / `gen types`): https://supabase.com/dashboard/account/tokens → Create new token, scope Full Access sobre el proyecto. Setear como `SUPABASE_ACCESS_TOKEN` env.
- **Supabase DB password:** setear al crear proyecto. Si se perdió, reset en Dashboard > Settings > Database > "Reset database password". Setear como `SUPABASE_DB_PASSWORD`.
- **Vercel Token** (cuenta `erbinomariano-propio`): https://vercel.com/account/tokens → Create → Full Account scope.
- **GitHub CLI:** `gh auth switch --user erbinomariano-propio` o `gh auth login --hostname github.com --web`.
- **Gmail app password** (para envío de emails): compartida con app-vendedores. Está en `Desktop\Notas\DATOS BOT-TELEFONO.txt` local (fuera del repo). Si hay que regenerar: https://myaccount.google.com/apppasswords logueado como `bot.shimano.pesca@gmail.com` (2FA obligatorio). En Vercel se guarda como `GMAIL_APP_PASSWORD` (Secret) y `GMAIL_USER=bot.shimano.pesca@gmail.com` (Plain Text).

**Emails / passwords de usuarios app:** ver `C:\Users\shimano.sandbox\Desktop\usuarios.txt` (fuera del repo). Emails admin:
- `admin@shimano-reclamos.test` (user de prueba MVP, opcionalmente desactivar con `update profiles set active=false where email='...'`)
- `diego.valsi@shimano.uy`
- `santiago.beron@shimano.uy`
- `mariano.erbino@shimano.com.ar`

## 5. Historia de la infra (importante para no repetir errores)

- **NO usar el repo `MarianoErbino/app-reclamos-shimano`.** Existe pero está congelado. Al crearlo se linkeó al proyecto Vercel de `shimano-fishing-argentina/app-reclamos-shimano`, y esa cuenta Vercel (`botshimanopesca-1044`) tenía fraud-detection que bloqueaba todos los deploys manuales como `BLOCKED`. Se abandonó.
- **NO transferir el repo a `botshimanopesca-beep`.** Se intentó y quedó estado zombie ("Repository name already taken" fantasma sin invitation visible en la API). El nombre queda reservado en esa cuenta ~24-48h.
- **Repo canónico ahora:** `erbinomariano-propio/app-reclamos-shimano`. La cuenta `erbinomariano-propio` tiene el Vercel GitHub App instalado con acceso al repo, y `gh` CLI autenticado en tres cuentas (MarianoErbino, botshimanopesca-beep, erbinomariano-propio) — la activa por default cuando abras nueva terminal puede variar, chequear con `gh auth status`.
- **Cuenta GitHub `MarianoErbino`:** sigue existiendo pero está asociada a `merbino@uade.edu.ar` (UADE) y Mariano no tiene acceso al mail. NO usar.
- **Proyecto Vercel viejo (`shimano-fishing-argentina/app-reclamos-shimano`):** eliminado. NO recrear ahí — el rate-limit persiste en esa cuenta hasta que Vercel manualmente lo levante.

## 6. Modelo de datos (Supabase Postgres)

5 tablas + policies RLS estrictas. Migrations en `supabase/migrations/`:

- `20260921000001_init.sql`: `profiles`, `claims`, `claim_events`, `attachments`
- `20260921000002_rls.sql`: policies + bucket `claim-attachments` + policies bucket
- `20260921000003_indexes_triggers.sql`: 4 índices + trigger `set_updated_at()` en claims
- `20260921000004_realtime.sql`: `alter publication supabase_realtime add table claims`
- `20260921000005_column_defaults.sql`: tabla `column_defaults` (responsable default por columna)

**Reglas RLS clave:**
- `claims_update`: solo `assignee_id = auth.uid()` o `is_admin()` pueden mover una tarjeta.
- `claims_delete`: solo `is_admin()`.
- `claim_events`: append-only para non-admin (no update, no delete).
- `attachments`: uploader o admin pueden borrar.
- `column_defaults`: solo admin puede insertar/actualizar/borrar; cualquier authed lee.

**Función `is_admin()`:** consulta `profiles` con `security definer` para saber si `auth.uid()` tiene role='admin'. Definida en migration 002.

**Enum columnas:** 6 valores fijos vía CHECK constraint. Si se agregan/renombran, tocar:
1. Migration nueva con `alter table claims drop constraint ... add constraint ... check (in ...)` + `alter table column_defaults ...`
2. `lib/columns.ts` (source of truth para orden/label/tint)
3. Regenerar types con `npm run gen:types`

## 7. Estructura de código

```
app/
├── layout.tsx           # header glass + logo Shimano + botón Salir (icon-only)
├── login/
│   ├── page.tsx         # sheet-panel con bg foto pescador (page-bg-login)
│   └── actions.ts       # login (redirect en error a /login?error=…) + logout
├── board/
│   ├── page.tsx         # Server Component: fetch claims+profiles+column_defaults+user; agrupa; renderiza modal si ?claim=X
│   ├── Board.tsx        # DndContext + realtime subscription + saludo por hora local + Responsables + NewClaim
│   ├── Column.tsx       # droppable con backdrop-blur-xl + tint
│   ├── ClaimCard.tsx    # draggable + <a> nativo (NO next/Link, para full page reload al abrir)
│   ├── NewClaimDialog.tsx      # sheet-style modal + Server Action createClaim
│   ├── ClaimDetailDialog.tsx   # sheet-style, cierra a /board (router.push)
│   ├── Timeline.tsx     # renderiza claim_events con formato es-AR
│   ├── CommentBox.tsx   # Server Action addComment (NO envía email)
│   ├── Attachments.tsx  # upload a Storage + list + descarga con URL firmada 5min
│   ├── DeleteClaimButton.tsx    # pill rojo Apple con window.confirm + Server Action deleteClaim (borra storage files best-effort + cascade DB)
│   ├── ColumnDefaultsDialog.tsx # modal para configurar responsable default por columna
│   └── actions.ts       # todas las Server Actions del board
├── api/health/route.ts  # GET {ok:true, ts}
└── page.tsx             # redirect a /board

proxy.ts                 # Auth guard (Next 16 renombra middleware). Redirect a /login si no auth.

lib/
├── supabase/{client,server,admin,types}.ts   # 3 clients + tipos generados
├── email/{smtp,templates}.ts                 # nodemailer wrapper + assignmentEmail template
├── columns.ts           # 6 columnas + labels + tints (CSS vars)
├── validators.ts        # Zod schemas CreateClaim, MoveClaim
├── permissions.ts       # isAdmin, canMoveClaim (utility puro)
└── utils.ts             # cn() de shadcn

supabase/
├── config.toml
├── .temp/               # local state del CLI (linked-project.json, versions)
└── migrations/          # ver §6

public/
├── shimano-logo.png     # logo azul+verde+azul oscuro oficial (copiado de APP VENDEDORES)
├── bg-login.jpg         # 2.2MB pescador atardecer lago
└── bg-board.jpg         # 2.0MB mar con gaviotas horizonte

tests/
├── unit/                # 14 tests verde (permissions + validators)
├── rls/*.ts.skip        # tests RLS escritos pero deshabilitados (requieren Docker o test project)
└── e2e/*.spec.ts.skip   # Playwright idem

scripts/create-admin-user.ts  # tsx script para crear admin con service_role (bloqueado por sandbox default, requiere permission rule)

docs/
├── specs/2026-09-21-app-reclamos-shimano-design.md    # design doc original
└── superpowers/plans/2026-09-21-mvp-app-reclamos.md   # plan implementación MVP (ejecutado)
```

## 8. Sistema de diseño

Ver `app/globals.css` para tokens completos. Resumen:

**Paleta Apple + herencia visual Shimano:**
- Background: `#F5F5F7` (Apple off-white)
- Surface: `#FFFFFF` con shadows layered
- Text: `#1D1D1F` (primary), `#6E6E73` (secondary), `#86868B` (tertiary)
- Accent blue: `#0071E3` (Shimano blue ≈ Apple blue)
- Column tints muy desaturados heredados del CI Shimano

**Typography:** stack SF Pro → Geist → system-ui. `.display` con `letter-spacing: -0.022em` weight 600. `.eyebrow` uppercase + tracking wide + weight 600 en size 11px.

**Motion:** `--ease-out-apple: cubic-bezier(0.16, 1, 0.3, 1)`. Duraciones `--dur-fast: 180ms` / `--dur-med: 280ms`. `prefers-reduced-motion` respetado (todas transitions/animations → 0.01ms).

**Utilities principales** (definidas en `@layer components`):
- `.glass` / `.glass-subtle`: chrome translucido con backdrop-filter blur+saturate
- `.card-elevated`: shadow layered + border hairline + hover lift
- `.card-dragging`: **signature** — scale 1.03 + rotate 1° + shadow profunda al arrastrar
- `.sheet-panel` / `.sheet-backdrop`: modales tipo iOS con rise + fade
- `.pill-primary` / `.pill-outline`: buttons con press feedback scale 0.97
- `.field`: inputs con focus ring blue Shimano
- `.count-badge`, `.eyebrow`: typographic utilities
- `.page-bg-login` / `.page-bg-board`: pseudo-elements con foto fixed cover + overlay ajustable

**Backgrounds foto ajustables:**
- Login: overlay dark radial (efecto cine) para que panel blanco resalte
- Board: overlay off-white 0.18→0.38 (foto muy visible) con backdrop-saturate 120%. Si Mariano pide bajar/subir opacidad, editar `.page-bg-board::after` en `globals.css`.

## 9. Reglas del proyecto (lecciones aprendidas)

### R1: Nunca commitear secretos, ni recovery codes, ni tokens
**Contexto:** Al inicio Mariano pidió guardar recovery codes 2FA de Vercel en el repo. Se rechazó porque expondría el bypass de 2FA a cualquiera con acceso al repo. Vale también para service_role keys, Vercel tokens, Supabase access tokens, contraseñas de users.
**Cómo aplicar:** los secretos van a password manager o `Desktop\Notas\` local (nunca al repo). `.env.local` está en `.gitignore` — no removerlo. Si necesitás env vars en prod, `vercel env add` (no commit).

### R2: Deploy funciona solo via Git push (auto-deploy)
**Contexto:** manual `vercel --prod` puede quedar `BLOCKED` en cuentas con rate-limit. Con Git integration nativa (que ya está configurada), pushes a `main` triggean auto-deploy.
**Cómo aplicar:** hacer cambios → `git add`+`commit`+`push origin main`. Monitorear con `vercel ls`. Si vez `BLOCKED`, no reintentar — es fraud-detection de Vercel, no tu culpa. En este proyecto ya estamos en la cuenta buena (`erbinomariano-propio`) que no tiene ese problema.

### R3: Al modificar el schema, actualizar 3 lugares
Cualquier cambio en migrations requiere:
1. **Migration file** en `supabase/migrations/` con timestamp nuevo
2. **`supabase db push`** contra cloud
3. **`npm run gen:types`** para regenerar `lib/supabase/types.ts`
4. (Opcional) Update RLS tests en `tests/rls/*.ts.skip` para el día que se activen

Si se olvida el paso 3, TypeScript no ve las tablas/columnas nuevas y el código explota en runtime cuando el server intenta usar el shape viejo.

### R4: Email notif es best-effort, no bloqueante
**Contexto:** `notifyAssignee` en `board/actions.ts` corre INLINE después del update del claim. Si el email falla, el claim se movió/creó igual — solo se registra `email_failed` en `claim_events`. **NO** hacer que un fallo del SMTP rompa la operación principal.
**Cómo aplicar:** el helper actual ya está correcto (try/catch + evento log). Al agregar nuevas notif, usar el mismo patrón: operación DB primero, notif después con log del resultado.

### R5: Click en card = full page reload (NO client-side)
**Contexto:** Mariano pidió explícitamente que abrir un ticket recargue la página. La `ClaimCard.tsx` usa `<a href>` nativo en lugar de `<Link>` de next para forzar recarga completa. Trade-off: pierde SPA feel pero muestra siempre datos frescos.
**Cómo aplicar:** al agregar nuevas cards o links a rutas de detalle, usar `<a>` no `<Link>`. Excepción: navegación entre secciones del layout (login → board después de auth) puede seguir usando `redirect()` de next.

### R6: Rol default de usuarios nuevos = admin (solo por decisión del MVP)
**Contexto:** los 4 users actuales tienen `role='admin'`. Fue decisión explícita porque son core team.
**Cómo aplicar:** para user nuevo que NO sea del core, cambiar el role al insertar. Roles válidos: `shimano | deposito | admin`. Ajusta permisos por RLS: shimano y deposito no pueden borrar claims, no ven config Responsables (aunque el botón sí lo muestra — TODO gate por rol en UI).

### R7: Migrations con `column_defaults.column_key` deben usar los 6 valores exactos del CHECK
Los enum-like en Postgres (`current_column` en claims, `column_key` en column_defaults) están CHECK-constrained. Si se agrega una columna al kanban:
1. `alter table claims drop constraint claims_current_column_check; alter table claims add constraint ... check (in ('nuevo',...,'nueva-col'));`
2. Idem `column_defaults`
3. `lib/columns.ts`
4. `gen:types`

### R8: Windows PowerShell + gh + git → ojo con cuenta activa
`gh auth switch` cambia la cuenta activa PARA EL PROCESO ACTUAL. Pero `git push` no usa gh — usa credentials cacheadas de git. Puede que en una sesión nueva la cuenta gh activa sea otra y `git push origin main` use el token equivocado. **Antes de push, siempre:** `gh auth switch --user erbinomariano-propio && git push origin main`.

## 10. Cómo retomar (checklist al abrir sesión)

- [ ] `cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\apps\app-reclamos"`
- [ ] Leer este CLAUDE.md
- [ ] `git status` — chequear si hay cambios sin commitear
- [ ] `git log --oneline | head -20` — ver estado de main
- [ ] `gh auth switch --user erbinomariano-propio` — asegurar cuenta correcta
- [ ] Si tocás migrations: verificar que `supabase link` apunta al project correcto (`.temp/project-ref` debe decir `bgbfdfncgxqmlktbewgz`)
- [ ] `.env.local` presente con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (sb_publishable_*), `SUPABASE_SERVICE_ROLE_KEY` (sb_secret_*), `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NEXT_PUBLIC_APP_URL`. Si falta, restaurar desde `Desktop\Notas\DATOS BOT-TELEFONO.txt` o Vercel envs.

## 11. Roadmap post-MVP

**V1 (backlog cuando se pida):**
- UI `/admin/users` para crear/desactivar users sin Supabase Dashboard
- Filtros/búsqueda avanzada en board (por remito, fecha, texto en observations)
- Dashboard chico de métricas (reclamos abiertos, tiempo promedio por columna, top responsables)
- Export CSV de reclamos
- Gate del botón "Responsables" y "Eliminar" a rol admin (hoy visible para todos aunque la RLS bloquee)

**V2 (ideas más grandes):**
- Lookup remito contra BigQuery/SAP con autocomplete
- Canal WhatsApp adicional al mail (Twilio o WA Cloud API)
- PWA mobile-optimized para el depósito
- Restricciones de transición de columna (state machine explícita, hoy es libre)
- Activar tests RLS + E2E Playwright (requieren Docker local o segundo project Supabase de test)
