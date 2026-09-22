# Planner Kanban Implementation Plan (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Planner Kanban section (Mariano-only in dev) with 6 columns showing pedido lifecycle end-to-end, per-column responsables, transition emails, and file attachments.

**Architecture:** New `pane-planner` in `index.html` gated to Mariano. Card = doc `pedidos` (col 1 also reads `revision_waitlist`). Column derived via pure `computeColumn(pedido)` (dupe client + CF). New CF `onPlannerStageChanged` triggers idempotent emails via nodemailer. Attachments in Storage `/planner-attachments/{pedidoId}/`. Config responsables in Firestore `app_config/planner_responsables`. Styling via `apple-design` (glass, spring motion, `motion` lib already in deps).

**Tech Stack:** Firebase (Firestore + Cloud Functions v2 + Storage + Auth), Nodemailer 10 + Gmail SMTP + Secret Manager, Vitest 4 + `@firebase/rules-unit-testing`, Biome, `motion` 13 for animations, vanilla JS inline in `index.html` (SPA convention).

**Design spec:** `docs/specs/2026-09-22-planner-design.md`.

## Global Constraints

- **Region CFs**: `southamerica-east1` (matches `functions/index.js:89`).
- **CF pattern**: core/wrapper split — pure logic in `functions/core/*-core.js` with deps injected, thin wrapper in `functions/index.js` (CLAUDE.md regla #7).
- **Listeners cleanup**: every new `onSnapshot()` requires `off(...)` in `detachFirebaseListeners()` (~index.html:26856). Test `tests/unit/listeners.test.js` enforces (CLAUDE.md regla #12).
- **Bundle scope**: `let`/`const` in inline `<script>` NOT visible to `app.bundle.js`. Use `var` for cross-scope state (CLAUDE.md regla #13).
- **Rules whitelist**: new fields on `pedidos` require adding to `hasOnly` list in `firestore.rules`.
- **Version bump discipline**: `APP_VERSION` + `CACHE_VERSION` must bump on any UI-affecting deploy.
- **Branch workflow**: work on `dev`, merge via `gh pr create` + `gh pr merge --squash --delete-branch`, never push directly to `main`.
- **Gate producción**: `body.is-mariano` CSS class, whitelist emails `erbinomariano@gmail.com` + `mariano.erbino@shimano.com.ar` + `userRole === 'admin'` double-gate.
- **Firebase Functions v2**: `defineSecret`, `onDocumentWritten`, `onCall` from `firebase-functions/v2/*`.
- **Nodemailer transporter**: reuse `GMAIL_APP_PASSWORD` secret; from address `bot.shimano.pesca@gmail.com`.
- **Storage rules idiom**: MIME whitelist + size limit + role-based access (precedente `/rendiciones/`).
- **App Check**: DO NOT enforce on new callable CFs (rollback v1003).

## Security Note (UI templating)

The UI task snippets follow the existing codebase pattern: `element.innerHTML = literal HTML + escapeHtml(userData)` — the same pattern used by Rendiciones, MERCADOLIBRE, Panel de Control. All variable interpolation MUST pass through `escapeHtml()` (already defined in the codebase). The engineer MUST verify no unescaped user data reaches the template. Follow-up hardening (out of scope F1): migrate to DOMPurify or DOM builders.

Reference implementations to mirror:
- `renderRendicionesList()` in `index.html` — pattern for card grid with escapeHtml.
- `functions/core/notify-quotation-sent-core.js:70-118` — HTML email body building.
- `openMeliModal()` in `index.html` — modal open/close with tabs.

---

## File Structure

**Create:**
- `functions/core/planner-compute-column.js` — pure `computeColumn(pedido)` (server canonical).
- `functions/core/planner-stage-change-core.js` — CF core logic.
- `functions/core/planner-resend-email-core.js` — callable resend logic.
- `src/domains/planner/compute-column.js` — client copy of `computeColumn`.
- `tests/unit/planner-compute-column.test.js` — parity + column derivation.
- `tests/functions/planner-stage-change.test.js` — CF core tests.
- `tests/functions/planner-resend-email.test.js` — callable core tests.
- `tests/rules/planner-rules.test.js` — Firestore rules assertions.
- `scripts/backfill-role-emails.mjs` — one-shot backfill.

**Modify:**
- `firestore.rules` — pedidos whitelist + planner_responsables + planner_config + roles.email gate.
- `storage.rules` — /planner-attachments/{pedidoId}/{fileName} match block.
- `functions/index.js` — import cores, register 2 new CFs, extend role CF for email.
- `index.html` — tab button, pane-planner, sub-tabs, styles, listeners, Kanban render, drag-drop, modal, config form; bump APP_VERSION.
- `README.md` — new section pointing to spec+plan.
- `sw.js` — bump cache version.

---

## Task Overview

- **T0** — v1004 bump + README stub + branch check.
- **T1** — `computeColumn` pure fn (server + client) + parity tests.
- **T2** — Firestore rules: pedidos whitelist + 2 new app_config + roles.email gate.
- **T3** — Storage rules /planner-attachments/.
- **T4** — CF `onPlannerStageChanged` core + 9 unit tests.
- **T5** — CF wrapper + deploy + smoke.
- **T6** — CF `resendPlannerEmail` callable + tests.
- **T7** — Persist `roles.email` (CF extension + backfill).
- **T8** — UI shell: tab, pane, gate, sub-tabs.
- **T9** — UI Kanban render + Firestore listeners + card component.
- **T10** — UI Lista de espera toggle (Cargado ⇄ Confirmado).
- **T11** — UI drag-drop entre columnas + motion spring.
- **T12** — UI modal detalle tab Líneas.
- **T13** — UI modal detalle tab Adjuntos (Storage upload/list/delete).
- **T14** — UI modal detalle tab Historial + reenviar botón.
- **T15** — UI Config sub-tab (form responsables).
- **T16** — Smoke E2E manual + version final + PR to main.

---

## Task 0: Version bump + README stub + branch check

**Files:** Modify `README.md`, `index.html:5503` (APP_VERSION), `sw.js`.

**Interfaces:** Produces `APP_VERSION = 'v1004'`, `CACHE_VERSION` bumped, README stub linking spec + plan.

- [ ] **Step 1** — `git status` + `git branch --show-current`. Expected `dev`, clean.
- [ ] **Step 2** — read current versions: `grep -n "const APP_VERSION" index.html` + `grep -n "CACHE" sw.js`.
- [ ] **Step 3** — bump `APP_VERSION = 'v1004'` in `index.html:5503`.
- [ ] **Step 4** — bump CACHE version string in `sw.js`.
- [ ] **Step 5** — find next README section: `grep -n "^## §" README.md | tail -5`. Use N+1.
- [ ] **Step 6** — append README section with title "Planner Kanban (Mariano-only, en desarrollo)", state "En desarrollo (F1)", spec+plan paths, brief description.
- [ ] **Step 7** — commit: `chore(planner): v1004 bump + README section stub`.

---

## Task 1: `computeColumn` core module + parity tests

**Files:**
- Create: `functions/core/planner-compute-column.js`, `src/domains/planner/compute-column.js`, `tests/unit/planner-compute-column.test.js`.

**Interfaces:** `computeColumn(pedido) → 'lista_espera' | 'oferta' | 'ordenes' | 'confirmado' | 'facturar' | 'cobrado'`. Pure. Same signature both files. Test enforces parity.

**Algorithm** (priority top-down, matches spec §4.5):
1. `plannerStage === 'confirmado'` → `confirmado`.
2. `plannerStage === 'cobrado_parcial' | 'cobrado_full'` → `cobrado`.
3. `paidStatus === 'partial' | 'paid'` → `cobrado`.
4. any `items[i].qtyInvoiced > 0` → `facturar`.
5. `transferidoSAP.orderDocEntry` set → `ordenes`.
6. `transferidoSAP.docNum` set → `oferta`.
7. default → `lista_espera`.

Use `Array.isArray(pedido?.items) ? pedido.items : []` for safe defaulting.

- [ ] **Step 1** — write failing test file with 9 cases (see below), imports both implementations, runs suite twice in a `for` loop for parity:
  - Empty pedido → `lista_espera`.
  - `transferidoSAP.docNum` only → `oferta`.
  - `orderDocEntry` set → `ordenes`.
  - Any `qtyInvoiced > 0` in items → `facturar`.
  - `paidStatus='partial'` OR `'paid'` → `cobrado`.
  - `plannerStage='confirmado'` overrides docNum → `confirmado`.
  - `plannerStage='cobrado_parcial'` → `cobrado`.
  - `plannerStage=null` + docNum → `oferta` (fallthrough).
  - `qtyInvoiced=0` + docNum → `oferta` (not facturar).
  - Undefined items array → no crash.
- [ ] **Step 2** — run `npm run test:unit -- planner-compute-column` → FAIL (module missing).
- [ ] **Step 3** — implement `functions/core/planner-compute-column.js` per algorithm above. Use `@ts-check` JSDoc. Export `computeColumn`.
- [ ] **Step 4** — copy identical body to `src/domains/planner/compute-column.js`.
- [ ] **Step 5** — run test → PASS (18 assertions: 9 cases × 2 files).
- [ ] **Step 6** — commit: `feat(planner): computeColumn pure fn (server + client) + parity tests`.

---

## Task 2: Firestore rules — new collections + `pedidos` whitelist + `roles.email` gate

**Files:** Modify `firestore.rules`; create `tests/rules/planner-rules.test.js`.

**Interfaces:** Consumes existing `isMariano()`, `isAdmin()`, `isGerente()` helpers. Produces 3 new rule blocks + extended `pedidos` whitelist.

**Rules to add:**

1. `match /app_config/planner_responsables` — read `isAdmin() || isGerente() || isMariano()`, write `isMariano()`.
2. `match /app_config/planner_config` — read `request.auth != null`, write `isMariano()`.
3. Extend `pedidos.hasOnly([...])` with 7 fields: `plannerStage`, `plannerHistory`, `plannerEmails`, `plannerAttachments`, `paidStatus`, `paidAmount`, `paidToDate`.
4. Tighten `match /roles/{uid}` read: `request.auth.uid == uid || isAdmin() || isGerente() || isMariano()`.

- [ ] **Step 1** — `grep -n "isMariano\|/pedidos/{" firestore.rules` to locate helpers + pedidos block.
- [ ] **Step 2** — write failing test `tests/rules/planner-rules.test.js` using `@firebase/rules-unit-testing` with 4 assertions: Mariano can write planner_responsables; other admin cannot; any auth can read planner_config; only Mariano writes planner_config; Mariano can write pedidos with `plannerStage`.
- [ ] **Step 3** — `npm run test:rules -- planner-rules` → FAIL.
- [ ] **Step 4** — add the 4 rule changes.
- [ ] **Step 5** — `npm run test:rules -- planner-rules` → PASS.
- [ ] **Step 6** — `npm run test:rules` full suite still green.
- [ ] **Step 7** — deploy: `firebase deploy --only firestore:rules`.
- [ ] **Step 8** — commit: `feat(planner): firestore rules for planner_responsables + planner_config + pedidos whitelist + roles.email gate`.

---

## Task 3: Storage rules — `/planner-attachments/`

**Files:** Modify `storage.rules`.

**Interfaces:** Produces match block for `/planner-attachments/{pedidoId}/{fileName}` with MIME whitelist + 10MB size cap + role gates.

**Rule spec:**
- `read`: `request.auth != null && (role in [admin,gerente] OR email in Mariano whitelist)`.
- `write` (F1 restricts to Mariano/admin): `request.auth != null && (email in Mariano whitelist OR role == 'admin') && request.resource.size < 10 * 1024 * 1024 && request.resource.contentType.matches('application/pdf|image/jpeg|image/png')`.

- [ ] **Step 1** — read current `storage.rules`; note existing patterns for `/rendiciones/`.
- [ ] **Step 2** — insert match block before default deny.
- [ ] **Step 3** — deploy: `firebase deploy --only storage`.
- [ ] **Step 4** — Firebase Console → Storage → Rules Playground. 4 cases: Mariano PDF 1MB allow / VDE PDF deny / Mariano 12MB deny / Mariano .exe deny.
- [ ] **Step 5** — commit: `feat(planner): storage rules /planner-attachments/{pedidoId}/{fileName}` with Playground output.

---

## Task 4: CF `onPlannerStageChanged` core + 9 unit tests

**Files:** Create `functions/core/planner-stage-change-core.js`, `tests/functions/planner-stage-change.test.js`.

**Interfaces:**
- Consumes: `computeColumn` from sibling module; deps `{db, transporter, log, now: () => Date}` injected.
- Produces: `async handlePlannerStageChanged(event, deps)` returning `{skipped: string}` or `{sent: {to, column}}`.

**Logic:**
1. `after = event.data.after?.data()`. If null → `{skipped: 'no-after'}`.
2. `before = event.data.before?.data()`; compute both cols. If equal → `{skipped: 'no-column-change'}`.
3. If `after.plannerEmails[afterCol]?.sentAt` → `{skipped: 'already-sent'}`.
4. Load `app_config/planner_responsables`. No config → `{skipped: 'no-config'}`. `notifyOnEnter` false → `{skipped: 'notify-disabled'}`.
5. Build `recipients = [columnConfig.email]`. If `afterCol === 'facturar' && columnConfig.sendToVdi && after.vendorKey`: `resolveVdiEmail(vendorKey, db)` → append or `log.warn` if missing.
6. Empty recipients → `{skipped: 'no-recipients'}`.
7. `buildEmailBody(after, afterCol)` returns `{subject, html, text}`. Send via `deps.transporter.sendMail({from: 'bot.shimano.pesca@gmail.com', to: recipients.join(','), subject, html, text})`.
8. `event.data.after.ref.update({['plannerEmails.'+afterCol]: {sentAt: deps.now(), to: recipients.join(',')}})`.
9. Return `{sent: {to, column: afterCol}}`.

**`resolveVdiEmail`**: `db.collection('roles').where('vendor','==',vendorKey).limit(1).get()` → `docs[0].data().email` or null.

**`buildEmailBody`**: subject `[Planner] Pedido {num} entró a {label}`; HTML template uses inline `-apple-system` font, Shimano blue `#003366`, table Cliente/VDI/Total. Text version for fallback. Pattern precedent: `functions/core/notify-quotation-sent-core.js:70-118`.

**COLUMN_LABELS constant**: `lista_espera → 'Lista de espera'`, `oferta → 'Oferta SAP'`, `ordenes → 'Órdenes SAP'`, `confirmado → 'Confirmado'`, `facturar → 'Facturar'`, `cobrado → 'Cobrado'`.

- [ ] **Step 1** — write failing test with 9 cases. Mocks: event with `before/after.data()`, `after.ref.update = vi.fn()`. Deps: `db.doc(path).get()` for `app_config/planner_responsables` and `roles/{uid}`; `db.collection('roles').where(...).limit(1).get()`. transporter.sendMail = vi.fn. Cases:
  1. Transition lista→oferta sends to `of@x.com`.
  2. No column change → no sendMail.
  3. `plannerEmails.oferta.sentAt` set → no sendMail.
  4. Entering confirmado sends to Mariano hardcoded.
  5. Entering facturar with sendToVdi calls resolveVdiEmail; recipients include both config email + VDI email.
  6. After send, `ref.update` called with `plannerEmails.{col}` payload.
  7. `notifyOnEnter=false` skips.
  8. Delete (after=null) safe, no throw.
  9. Facturar+sendToVdi with orphan VDI → log.warn + still sends to primary.
- [ ] **Step 2** — `npm run test:unit -- planner-stage-change` → FAIL.
- [ ] **Step 3** — implement core per logic above.
- [ ] **Step 4** — run test → PASS (9 assertions).
- [ ] **Step 5** — commit: `feat(planner): CF core onPlannerStageChanged with 9 unit tests`.

---

## Task 5: CF `onPlannerStageChanged` wrapper + deploy

**Files:** Modify `functions/index.js`.

**Interfaces:** Produces exported `onPlannerStageChanged` Firestore onDocumentWritten trigger for `pedidos/{id}`.

**Wrapper:**
- Import `handlePlannerStageChanged` + `nodemailer`.
- `onDocumentWritten({document: 'pedidos/{id}', region: REGION, secrets: [GMAIL_APP_PASSWORD]}, async event => {...})`.
- Inside handler: build transporter fresh with `GMAIL_APP_PASSWORD.value()` (service:'gmail', auth: {user: 'bot.shimano.pesca@gmail.com', pass: ...}).
- Try-catch around `handlePlannerStageChanged(event, {db: getFirestore(), transporter, log: console, now: () => new Date()})`.
- On error: `console.error` and return `{skipped: 'error', error: err.message}` (never throw — retries would duplicate emails).

- [ ] **Step 1** — add import lines near existing core imports (~line 43-54).
- [ ] **Step 2** — add wrapper CF at end of file.
- [ ] **Step 3** — `npm run typecheck && npm run lint`. Fix red.
- [ ] **Step 4** — verify secret: `firebase functions:secrets:access GMAIL_APP_PASSWORD --project app-vendedores-shimano`.
- [ ] **Step 5** — deploy: `firebase deploy --only functions:onPlannerStageChanged`.
- [ ] **Step 6** — smoke (emulator preferred): `firebase emulators:start --only firestore,functions`. Seed `app_config/planner_responsables`. Create `pedidos/planner-smoke-1` empty then update with `transferidoSAP.docNum=99999`. Verify email log via `gcloud logging read` (CLAUDE.md §22 pattern) OR emulator UI.
- [ ] **Step 7** — commit: `feat(planner): deploy onPlannerStageChanged Firestore trigger`.

---

## Task 6: CF `resendPlannerEmail` callable + tests

**Files:** Create `functions/core/planner-resend-email-core.js`, `tests/functions/planner-resend-email.test.js`; modify `functions/index.js`.

**Interfaces:** Produces exported callable `resendPlannerEmail({pedidoId, column})` → `{ok: true, result: ...}` or `HttpsError`.

**Core logic** `handleResendPlannerEmail(data, auth, deps)`:
1. `!auth?.uid` → throw `{code:'unauthenticated'}`.
2. `!MARIANO_EMAILS.has(auth.token.email)` → throw `{code:'permission-denied'}`.
3. `!data.pedidoId || !VALID_COLUMNS.has(data.column)` → throw `{code:'invalid-argument'}`.
4. `snap = db.doc('pedidos/'+data.pedidoId).get()`; `!snap.exists` → throw `{code:'not-found'}`.
5. `snap.ref.update({['plannerEmails.'+data.column]: null})` — clear idempotency.
6. Build synthetic event with `before={}` (fresh transition) and `after` = current data with `plannerEmails[column]` cleared. Invoke `deps.stageHandler(event, deps)`.
7. Return `{ok: true, result}`.

**Constants:**
- `VALID_COLUMNS = new Set(['lista_espera','oferta','ordenes','confirmado','facturar','cobrado'])`.
- `MARIANO_EMAILS = new Set(['erbinomariano@gmail.com','mariano.erbino@shimano.com.ar'])`.

**Wrapper** in `functions/index.js`: `onCall({region: REGION, secrets: [GMAIL_APP_PASSWORD]}, async request => {...})`. Builds fresh transporter, delegates to core with `stageHandler = (event, deps) => handlePlannerStageChanged(event, {...deps, transporter, now: () => new Date()})`. Translates thrown `{code, message}` → `HttpsError`.

- [ ] **Step 1** — write failing test with 4 cases: unauthenticated throws; non-Mariano throws; invalid column throws; happy path clears sentAt + invokes stageHandler.
- [ ] **Step 2** — `npm run test:unit -- planner-resend-email` → FAIL.
- [ ] **Step 3** — implement core.
- [ ] **Step 4** — run test → PASS (4).
- [ ] **Step 5** — add wrapper in `functions/index.js`.
- [ ] **Step 6** — deploy: `firebase deploy --only functions:resendPlannerEmail`.
- [ ] **Step 7** — commit: `feat(planner): callable resendPlannerEmail (Mariano only)`.

---

## Task 7: Persist `roles.email` (CF extension + backfill)

**Files:** Modify `functions/index.js`; create `scripts/backfill-role-emails.mjs`.

**Interfaces:** `roles/{uid}.email` populated with `auth.token.email.toLowerCase()`. Needed for `resolveVdiEmail` in Task 4.

**Two paths:**
1. **Extend existing role-writing CF** (if there is one — grep first). Add `email` to the payload when `auth.token.email` is available.
2. **OR create new callable `setUserRoleEmail`** that just writes email from `auth.token.email` on first call. Client calls it once at login when `roles/{uid}.email` is missing.

**Backfill script** iterates `admin.auth().listUsers(1000, pageToken)`, for each user with matching `roles/{uid}` doc missing `email` OR with different email, `set({email: u.email.toLowerCase()}, {merge:true})`. Logs each update. Total processed/updated/skipped at end.

- [ ] **Step 1** — `grep -n "setUserRole\|setRole\|updateRole" functions/index.js` to find existing.
- [ ] **Step 2** — read the found function (or note if missing).
- [ ] **Step 3** — extend payload OR create new callable (per findings).
- [ ] **Step 4** — write backfill script `scripts/backfill-role-emails.mjs` using firebase-admin.
- [ ] **Step 5** — run backfill: `node scripts/backfill-role-emails.mjs`. Capture stdout.
- [ ] **Step 6** — deploy modified/new CF.
- [ ] **Step 7** — commit: `feat(planner): persist email in roles/{uid} for VDI notif` with backfill stats in body.

---

## Task 8: UI shell — tab button, `pane-planner`, gate CSS, sub-tabs

**Files:** Modify `index.html`.

**Interfaces:** Consumes existing `setTab()`, `applyRolePermissions()`. Produces `#pane-planner` container with sub-tabs `#planner-pane-tablero` + `#planner-pane-config`, `setPlannerSubtab(key)`.

**Changes:**
1. New tab button (~line 4646 next to Rendiciones): `class="tab-btn" data-tab="planner" onclick="setTab('planner')"` with `📋 Planner` label. `style="display:none;"` default.
2. CSS gate: `body.is-mariano .tab-btn[data-tab="planner"] { display: inline-block !important; }`. Also `body.planner-enabled-all .tab-btn[data-tab="planner"]` for future flag.
3. In `applyRolePermissions()` (~23140): `document.body.classList.toggle('is-mariano', marianoEmails.has(email) && userRole === 'admin')`.
4. New `pane-planner` container after last existing pane (~4940+). Two sub-panes inside, using existing `rd-subtabs` styling class for tabs bar.
5. Function `setPlannerSubtab(key)` — toggle `.planner-subpane` display + `.active` class on buttons (pattern precedente: `setRendSubtab` en index.html).

- [ ] **Step 1** — add tab button.
- [ ] **Step 2** — add gate CSS.
- [ ] **Step 3** — add body class toggle in `applyRolePermissions()`.
- [ ] **Step 4** — add pane container with 2 placeholder sub-panes ("Kanban en Task 9", "Config en Task 15").
- [ ] **Step 5** — add `setPlannerSubtab(key)` function.
- [ ] **Step 6** — manual browser check: `python -m http.server 8000` → login as Mariano → tab visible + switching. Incognito other admin → tab hidden.
- [ ] **Step 7** — commit: `feat(planner): UI shell — tab button, pane, gate CSS, sub-tabs`.

---

## Task 9: UI Kanban render + Firestore listeners + card component

**Files:** Modify `index.html`.

**Interfaces:** Consumes inline `computeColumn` (copied from client canonical). Produces `renderPlannerKanban()`, `attachPlannerListeners()`, `renderPlannerCard(pedido, column)`, `computePlannerCardStateClass(pedido, column)`, `openPlannerCardModal(id)` stub. All 3 listeners registered in `detachFirebaseListeners()`.

**State vars** (must be `var` — CLAUDE.md #13):
`unsubPlannerPedidos`, `unsubPlannerWaitlist`, `unsubPlannerConfig`, `plannerPedidosCache = new Map()`, `plannerWaitlistCache = new Map()`, `plannerResponsablesCache = {}`.

**Listeners:**
- `fbDb.doc('app_config/planner_responsables').onSnapshot` → cache + re-render.
- `fbDb.collection('pedidos').where('closedAt','==',null).onSnapshot` → cache open pedidos.
- `fbDb.collection('revision_waitlist').where('stage','!=','consumed').onSnapshot` → cache waitlist.

Each snapshot handler calls `renderPlannerKanban()`.

**`renderPlannerKanban()`** — bucket by `computeColumn(p)`, sort desc by `updatedAt/createdAt` millis, render 6 columns using `PLANNER_COLUMNS` const array (keys+labels). For each column: header (label + count + responsable email chip) + card list.

**`renderPlannerCard(pedido, column)`** — ALL user data through `escapeHtml()`. Structure:
- Fila 1: `escapeHtml(pedido.cardName || pedido.cardCode || '(sin cliente)')`.
- Fila 2: `escapeHtml(pedido.vendorKey || '—')` · `fmtDateShort(pedido.createdAt)` · total ARS format.
- Fila 3: badges array (SAP:docNum, SO:orderDocEntry, 📎N adjuntos).
- Root div: `class="planner-card ${stateClass}" data-pedido-id data-column draggable="true" onclick="openPlannerCardModal(id)"`.

**`computePlannerCardStateClass(pedido, column)`** returns:
- `column === 'lista_espera'`: `state-cargado` OR `state-confirmado-vendedor` if any `items[i].vendorConfirmed`.
- `column === 'facturar'`: `state-facturado` if all `qtyInvoiced === qty`, else `state-fact-pendiente`.
- `column === 'cobrado'`: `state-cobrado-full` if `paidStatus==='paid' || plannerStage==='cobrado_full'`, else `state-cobrado-parcial`.
- Otherwise: empty.

**CSS** (Apple design):
- `.planner-kanban` flex row, scroll-x, scroll-snap.
- `.planner-col` flex-basis 320px, `backdrop-filter: blur(20px) saturate(180%)`, `border-radius:16px`, dark variant `body.dark`.
- `.planner-col-header` flex row baseline, letter-spacing tight.
- `.planner-card` white bg, `border-radius:12px`, subtle shadow, `cursor:grab`, transition transform + shadow with `cubic-bezier(0.32,0.72,0,1)` 320ms. Dark variant `#2c2c2e`. Hover `translateY(-1px)`.
- `.planner-card.dragging` opacity 0.7, scale 1.02 rotate 1deg.
- State color classes as left `border-left: 3px solid`: `state-cargado #FFCC00`, `state-confirmado-vendedor #34C759`, `state-facturado #34C759`, `state-fact-pendiente #FFCC00`, `state-cobrado-parcial #FF9500`, `state-cobrado-full #34C759`.
- `@media (prefers-reduced-motion: reduce)` → disable transitions and transforms.

**Cleanup**: 3 lines in `detachFirebaseListeners()` (~26856): `n += off('unsubPlannerPedidos', unsubPlannerPedidos, () => unsubPlannerPedidos = null);` and same for waitlist + config.

- [ ] **Step 1** — inline `computeColumn` copy in the inline `<script>` (mirror `src/domains/planner/compute-column.js`).
- [ ] **Step 2** — add `var` state declarations.
- [ ] **Step 3** — register listeners cleanup.
- [ ] **Step 4** — `npm run test:unit -- listeners` → PASS.
- [ ] **Step 5** — add Kanban CSS (Apple glass + spring + dark + state colors + reduced-motion).
- [ ] **Step 6** — replace `#planner-pane-tablero` placeholder with `<div class="planner-kanban" id="planner-kanban-root"></div>`.
- [ ] **Step 7** — implement `attachPlannerListeners()` with 3 onSnapshot subs.
- [ ] **Step 8** — implement `renderPlannerKanban()` bucketing + rendering.
- [ ] **Step 9** — implement `renderPlannerCard(pedido, column)` with `escapeHtml` on ALL user data.
- [ ] **Step 10** — implement `computePlannerCardStateClass(pedido, column)`.
- [ ] **Step 11** — add stub `openPlannerCardModal(id)` (logs to console; real modal en T12).
- [ ] **Step 12** — wire `attachPlannerListeners()` invocation from `setTab('planner')`.
- [ ] **Step 13** — manual smoke: como Mariano abrir Planner. 6 columnas + counts + open pedidos en columna correcta + waitlist items en lista_espera.
- [ ] **Step 14** — commit: `feat(planner): Kanban render with 6 columns + Firestore listeners`.

---

## Task 10: UI Lista de Espera toggle buttons

**Files:** Modify `index.html`.

**Interfaces:** Produces `togglePlannerWaitlistState(waitlistId, confirmed)`. Extends `renderPlannerCard` for `column === 'lista_espera' && pedido._isWaitlist`.

**UI addition** dentro de card:
- Container `.planner-card-toggles` con `onclick="event.stopPropagation();"` (para no disparar modal).
- Botón "Cargado" con class `active` si NO hay `items.some(i => i.vendorConfirmed)`.
- Botón "Confirmado" con class `active` si sí. Colores via CSS: primer botón activo yellow, segundo verde.

**Handler**:
`togglePlannerWaitlistState(waitlistId, confirmed)`:
1. `ref = fbDb.collection('revision_waitlist').doc(waitlistId)`.
2. `snap = await ref.get()`; items = `snap.data().items || []`.
3. `nextItems = items.map(i => ({...i, vendorConfirmed: !!confirmed}))`.
4. `await ref.update({items: nextItems, updatedAt: FieldValue.serverTimestamp()})`.

- [ ] **Step 1** — extend `renderPlannerCard` conditional block.
- [ ] **Step 2** — add CSS `.planner-card-toggles` + `.planner-toggle-btn` + active state colors + dark mode.
- [ ] **Step 3** — implement handler.
- [ ] **Step 4** — manual test: click Confirmado → verde + Firestore update visible. Click Cargado → yellow.
- [ ] **Step 5** — commit: `feat(planner): Lista de espera toggle Cargado / Confirmado por vendedor`.

---

## Task 11: UI drag-drop entre columnas con `motion` (spring)

**Files:** Modify `index.html`.

**Interfaces:** Consumes `motion` (deps line 32) — use ESM import from bundle OR CDN fallback `import('https://cdn.jsdelivr.net/npm/motion@13/+esm')` into `window._motion`. Produces HTML5 drag-drop handlers + writes `plannerStage` + `plannerHistory` on drop.

**Handlers** (attached after each `renderPlannerKanban()`):
- `dragstart`: set `plannerDragged = {id, from}`, add `.dragging` class, `dataTransfer.effectAllowed = 'move'`.
- `dragend`: remove `.dragging`, clear `plannerDragged`, remove `.drop-target` from all cols.
- `dragover` on col: `preventDefault()`, add `.drop-target` class.
- `dragleave` on col: remove `.drop-target`.
- `drop` on col:
  1. `preventDefault()`, extract `dst = col.dataset.col`.
  2. `MANUAL_TARGETS = new Set(['confirmado', 'cobrado'])`. If `!MANUAL_TARGETS.has(dst)` → `alert('Columna automática')` + return.
  3. `plannerStage = dst === 'confirmado' ? 'confirmado' : dst === 'cobrado' ? 'cobrado_parcial' : null`.
  4. `fbDb.collection('pedidos').doc(draggedId).update({plannerStage, plannerHistory: FieldValue.arrayUnion({stage: plannerStage, movedAt: serverTimestamp, movedBy: uid, movedByEmail}), updatedAt: serverTimestamp})`.
  5. `requestAnimationFrame` → `motion.animate(dropped, {scale: [0.96, 1]}, {duration: 0.32, easing: 'ease-out'})`.

**Drop-target CSS**: `outline: 2px dashed rgba(0,122,255,0.6); outline-offset: -4px`. reduced-motion → solid outline.

- [ ] **Step 1** — import motion (bundle if possible, CDN fallback into `window._motion`).
- [ ] **Step 2** — attach handlers after `renderPlannerKanban()` (find/each on `.planner-card` and `.planner-col`).
- [ ] **Step 3** — implement `plannerDragged` state + all 5 handlers.
- [ ] **Step 4** — CSS for `.dragging` (already in T9) + `.drop-target`.
- [ ] **Step 5** — manual test: drag Órdenes → Confirmado. Card moves, `plannerStage`, `plannerHistory` grow, email al Mariano. Drag → Oferta = alert bloquea.
- [ ] **Step 6** — commit: `feat(planner): drag-drop entre columnas con feedback spring`.

---

## Task 12: UI modal detalle — tab Líneas

**Files:** Modify `index.html`.

**Interfaces:** Produces `openPlannerCardModal(id)`, `closePlannerModal()`, `setPlannerModalTab(tab)`, `renderPlannerModal()`, `renderPlannerModalLineas(pedido)`.

**Modal HTML** at end of `<body>`: backdrop + centered modal card. Header row with title + close ✕. Tabs row (Líneas / Adjuntos / Historial) with `data-plmodal` attr. Body div where content renders. Click backdrop OR ✕ closes; content clicks `event.stopPropagation()`.

**State vars** (var): `_plannerModalPedidoId`, `_plannerModalTab = 'lineas'`.

**Open**: reads `plannerPedidosCache.get(id) || plannerWaitlistCache.get(id)`. Sets `display:flex` on backdrop.

**`renderPlannerModal()`** — pedido = cache lookup. If missing, show "Pedido no encontrado". Otherwise route to renderer per `_plannerModalTab`.

**`renderPlannerModalLineas(pedido)`** — table with cols SKU / Descripción / Qty / qtyInvoiced / Precio. ALL cells through `escapeHtml`. Numeric cols right-aligned. Precio formatted es-AR.

**CSS** — Apple modal: backdrop `rgba(0,0,0,0.4) + blur(8px)`, modal white/`#1c1c1e` dark, `border-radius:20px`, `box-shadow: 0 20px 60px rgba(0,0,0,0.3)`, fade-in animation `plannerFadeIn` respecting reduced-motion. Tabs: opacity 0.55 idle → 1 active with 2px bottom border `#007AFF`.

- [ ] **Step 1** — add modal HTML at end of body.
- [ ] **Step 2** — add CSS (backdrop, modal, tabs, animation, dark).
- [ ] **Step 3** — implement open/close/setTab functions (replace stub `openPlannerCardModal` from T9).
- [ ] **Step 4** — implement `renderPlannerModal()` router.
- [ ] **Step 5** — implement `renderPlannerModalLineas(pedido)`. Adjuntos + Historial stub for T13/T14.
- [ ] **Step 6** — manual test: click card → modal abre con Líneas. ✕ cierra. Backdrop click cierra. Tabs switch.
- [ ] **Step 7** — commit: `feat(planner): modal detalle con tab Líneas`.

---

## Task 13: UI modal detalle — tab Adjuntos (Storage upload/list/delete)

**Files:** Modify `index.html`.

**Interfaces:** Consumes Firebase Storage SDK. Produces `renderPlannerModalAdjuntos(pedido)`, `handlePlannerAttachmentUpload(files)`, `deletePlannerAttachment(idx)`.

**`handlePlannerAttachmentUpload(files)`**:
1. Load current pedido's `plannerAttachments` (via cache OR fresh get).
2. If `current.length + files.length > 10` → alert + return.
3. For each file in `Array.from(files)`:
   - Validate MIME ∈ `{application/pdf, image/jpeg, image/png}` — else alert + continue.
   - Validate size < 10 * 1024 * 1024 — else alert + continue.
   - `ts = Date.now()`, `safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')`.
   - `path = 'planner-attachments/'+pedidoId+'/'+ts+'_'+safe`.
   - `ref = firebase.storage().ref(path)`.
   - `uploadRes = await ref.put(file, {contentType: file.type})`.
   - `url = await uploadRes.ref.getDownloadURL()`.
   - Push `{name: file.name, url, size, mime: file.type, uploadedAt: Timestamp.now(), uploadedBy: uid}` to `additions[]`.
4. If additions: `pedidoRef.update({plannerAttachments: FieldValue.arrayUnion(...additions), updatedAt: serverTimestamp})`.
5. `renderPlannerModal()` immediate feedback.

**`deletePlannerAttachment(idx)`**:
1. `confirm(...)`, get pedido, `att = attachments[idx]`. Return if not found.
2. Parse Storage path from URL: `new URL(att.url).pathname.split('/o/')[1].split('?')[0]` → `decodeURIComponent`.
3. Try `firebase.storage().ref(path).delete()`. Catch warn (may not exist).
4. `nextAttachments = attachments.filter((_, i) => i !== idx)`. Update Firestore.

**`renderPlannerModalAdjuntos(pedido)`**:
- Header row: count `N / 10` + upload button (`<label>` wrapping hidden `<input type="file" multiple accept="application/pdf,image/jpeg,image/png">`). Disable input if `10 - count === 0`.
- Grid: for each attachment, thumbnail (img src for images, 📄 for PDFs), name (escapeHtml), size (fmtBytes helper), delete button.
- Empty state message.

**`fmtBytes(n)`** helper: `<1024 B`, `<1024*1024 KB`, else `MB`.

- [ ] **Step 1** — implement `handlePlannerAttachmentUpload(files)` with all validations.
- [ ] **Step 2** — implement `deletePlannerAttachment(idx)`.
- [ ] **Step 3** — implement `renderPlannerModalAdjuntos(pedido)` grid + upload. ALL user data through `escapeHtml`.
- [ ] **Step 4** — implement `fmtBytes(n)` helper (or reuse if exists).
- [ ] **Step 5** — update `renderPlannerModal()` route.
- [ ] **Step 6** — manual test: upload PDF ok + aparece en Storage + array grows. Upload .exe deny. Upload archivo #11 deny. Delete → gone from both.
- [ ] **Step 7** — commit: `feat(planner): modal tab Adjuntos — upload/list/delete PDFs+images`.

---

## Task 14: UI modal detalle — tab Historial + reenviar notif

**Files:** Modify `index.html`.

**Interfaces:** Consumes `pedido.plannerHistory`, `pedido.plannerEmails`, callable `resendPlannerEmail`. Produces `renderPlannerModalHistorial(pedido)`, `resendPlannerNotif(column)`.

**`renderPlannerModalHistorial(pedido)`**:
- Botón arriba: "Reenviar/Enviar notif de columna actual (X)" — texto depende de si `plannerEmails[currentCol]?.sentAt` existe. onclick `resendPlannerNotif(currentCol)`.
- Sección "Transiciones": timeline vertical de `plannerHistory` reversed (newest first). Each entry: 8px dot + `Movido a {stage}` bold + `{movedByEmail} · {fmtDateTime(movedAt)}` small. ALL via escapeHtml.
- Sección "Emails": for each `plannerEmails[col].sentAt`, entry con 📧 + column label + `A: {to}` + timestamp.

**`resendPlannerNotif(column)`**:
1. `confirm(...)`. Cancel → return.
2. `callable = firebase.functions().httpsCallable('resendPlannerEmail')`.
3. `await callable({pedidoId, column})`.
4. Alert result. Re-render modal.
5. Catch → alert error message.

- [ ] **Step 1** — implement `renderPlannerModalHistorial(pedido)`.
- [ ] **Step 2** — implement `resendPlannerNotif(column)`.
- [ ] **Step 3** — update `renderPlannerModal()` route.
- [ ] **Step 4** — manual test: open card con `plannerHistory` (mover en T11 antes). Historial muestra timeline + emails. Click Reenviar → nuevo `sentAt`.
- [ ] **Step 5** — commit: `feat(planner): modal tab Historial con timeline + botón reenviar`.

---

## Task 15: UI Config sub-tab (form responsables)

**Files:** Modify `index.html`.

**Interfaces:** Produces `renderPlannerConfig()`, `savePlannerResponsables(event)`.

**`renderPlannerConfig()`** builds form with 6 rows (one per column):
- Label (col.label).
- Email input `name="{col.key}_email"` value from cache. `readonly` if `col.key === 'confirmado'`.
- Checkbox `name="{col.key}_notify"` for `notifyOnEnter`. Default checked.
- Confirmado row shows nota "Hardcoded a Mariano".
- Facturar row extra checkbox `name="facturar_vdi"` label "Además enviar email al VDI del pedido".
- Submit button "Guardar".

**`savePlannerResponsables(ev)`**:
1. `ev.preventDefault()`.
2. Build payload iterating `PLANNER_COLUMNS`:
   - `email`: form field lowercased. Force `mariano.erbino@shimano.com.ar` if col === 'confirmado'.
   - `name`: derivar (email prefix, o 'Mariano' para confirmado).
   - `notifyOnEnter`: checkbox.
   - `hardcoded: true` si confirmado.
   - `sendToVdi: !!form.facturar_vdi.checked` si facturar.
3. `fbDb.doc('app_config/planner_responsables').set(payload)`.
4. Alert "Config guardada" o error.

Wire: `setPlannerSubtab('config')` calls `renderPlannerConfig()`.

- [ ] **Step 1** — replace `#planner-pane-config` placeholder with `<div id="planner-config-root"></div>`.
- [ ] **Step 2** — implement `renderPlannerConfig()`. ALL user data through escapeHtml.
- [ ] **Step 3** — implement `savePlannerResponsables(ev)` (bound to form onsubmit).
- [ ] **Step 4** — call from `setPlannerSubtab`.
- [ ] **Step 5** — manual test: como Mariano, editar emails, guardar. Verificar Firestore. Uncheck notify → transición no envía email.
- [ ] **Step 6** — commit: `feat(planner): sub-tab Config para editar responsables`.

---

## Task 16: Smoke E2E manual + version final + PR to main

**Files:** Modify `index.html:5503` (v1005), `sw.js`, `README.md`.

**Interfaces:** Produces final commit + PR + squash merge a main.

**10-case E2E smoke** (paste ✓/✗ en commit body):
1. 6 columnas render + counts correctos + responsable emails visibles.
2. Lista espera toggle Cargado ⇄ Confirmado por vendedor → Firestore update.
3. Drag manual Órdenes → Confirmado → email a Mariano llega.
4. Drag manual → Oferta (auto column) → alert bloquea.
5. Modal → tab Líneas muestra items con qtyInvoiced.
6. Modal → tab Adjuntos: upload PDF ok, .exe deny, #11 deny.
7. Modal → tab Historial: timeline + botón Reenviar dispara nuevo email.
8. Config: editar emails + toggle "enviar a VDI" en Facturar → guardado.
9. Idempotencia: mover 2 veces a Confirmado sin borrar `plannerEmails.confirmado` → 2do movimiento no envía.
10. Gate: incognito con otro admin (no Mariano) → tab NO visible.

- [ ] **Step 1** — run 10-case smoke, capture results.
- [ ] **Step 2** — verify listeners cleanup on logout: DevTools Network + `npm run test:unit -- listeners`.
- [ ] **Step 3** — no regressions: `npm run test:unit && npm run test:smoke && npm run typecheck && npm run lint`.
- [ ] **Step 4** — bump `APP_VERSION = 'v1005'` + `sw.js` CACHE + README marca sección shipped en dev.
- [ ] **Step 5** — `git push origin dev`.
- [ ] **Step 6** — `gh pr create --title "feat(planner): Fase 1 Kanban punta a punta (Mariano-only en producción)"` with summary + test plan (10 cases + npm test outputs).
- [ ] **Step 7** — `gh pr merge --squash --delete-branch`.
- [ ] **Step 8** — `firebase deploy --only hosting`.
- [ ] **Step 9** — verificación post-deploy: abrir app prod como Mariano, E2E de nuevo.

---

## Self-Review Checklist

**1. Spec coverage:**
- Spec §1 Objetivo → whole plan.
- Spec §2 Audiencia → T2 rules + T6 CF auth + T8 gate CSS.
- Spec §3 Fase 1 → T0–T16 completo. Fases 2/3 = plans futuros separados.
- Spec §4.1 pedidos fields → T2 whitelist + T4 CF + T11–14 UI.
- Spec §4.2 planner_responsables → T2 rules + T15 UI.
- Spec §4.3 planner_config flag → T2 rules (UI toggle deferred).
- Spec §4.4 roles.email → T7 + backfill.
- Spec §4.5 computeColumn → T1.
- Spec §5 UI Apple → T8–15 CSS glass + T11 spring.
- Spec §6 Emails → T4–6.
- Spec §7 Storage → T3 + T13.
- Spec §8 Rules → T2.
- Spec §9 Tests → T1/T4/T6 test-first + T16 smoke.
- Spec §10 Deploy → mapea T0–T16.
- Spec §11 Riesgos: R1 backfill T7, R2 idempotencia T4, R3 drag mobile T11, R4 parity T1, R5 array limit T13, R6 override doc en spec.

**2. Placeholder scan:**
- T7 Step 3 says "adapt to actual code" — intentional (existing CF shape not fully confirmed). Engineer adapts.
- No TBD / TODO / "appropriate error handling" strings.

**3. Type consistency:**
- `computeColumn` return type consistent T1/T4/T9.
- `plannerEmails.{column}.sentAt` consistent T4/T6/T14.
- Column keys consistent everywhere.
- `handlePlannerStageChanged` deps shape consistent T4/T5.

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-09-22-planner-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a plan this long — protects your context window and each subagent gets a clean slate per task.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review.

**Which approach?**
