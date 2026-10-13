# Architecture Review — 2026-10-13

## Executive summary (max 5 lines)

The app has made real progress on modularity (23 domains + 8 lazy chunks + 29 CF cores), but the biggest architectural debt now sits in a 26,200-line inline `<script>` in `index.html` that still owns ~75% of client-side state and 25 of 30 `onSnapshot` listeners. The single highest-ROI target for the next 3 months is extracting the **sales/pedido lifecycle (waitlist → pending → confirmed → BO/ASIG → SAP SQ → invoiced → cobrado)** into a dedicated `src/domains/pedido-lifecycle/` package with explicit state transitions and a thin inline shell; secondary opportunity is formalising the implicit "stage machine" that today lives spread across `computeColumn` (client+server dual impl), `auto-send-sap-core`, `auto-confirm-pending-core`, `sap-auto-send-listener`, and ~4 inline `renderX` functions, each with its own interpretation of the same stage transitions. If those two land, bundle shell can realistically drop below 1 MB and the "FATECHI-class" race-condition bug family (2026-10-06, $7.3M duplicate SAP SQ) stops being a recurring tail risk.

## Findings

### Hot zones (highest ROI to tackle first)

#### A1. Monolithic `index.html` inline script still owns the pedido/waitlist domain

- **Area:** modularity
- **Current state:** `index.html` is 32,640 lines total; the inline `<script>` block spans line 6109→32332 (~26,200 LOC). Despite 23 domains already extracted to `src/domains/*`, the single-largest inline functions are all pedido/waitlist-centric: `_renderWaitlistCard` (2,272 LOC at 20606), `_updateBackorderButtonCounts` (1,437 LOC at 13594), `_cpstRenderPreview` (656 LOC at 15173), `renderConfirmadosList` (537 LOC at 23182), `aplicarEstadoCliente` (437 LOC at 11112). `globalPedidos` is read from 98 places in `index.html` alone (vs 23 across the whole bundle).
- **Problem:** The pedido domain is the business-critical path (every $ touches it) and remains the largest, least-tested, least-reviewable surface. Cross-cutting bugs documented in CLAUDE.md (#17 silent cross-scope listener leak, #27 lost hotfix on merge, FATECHI 2026-10-06) all originated here. New features (Planner Kanban, revisionWaitlist, migration backorder-SAP→APP) accrete on top instead of being contained.
- **Suggested direction:** Treat `pedido-lifecycle` as its own bounded context. Extract in 4 sub-stages (per CLAUDE.md #14, no monster PR):
  1. `src/domains/pedido-lifecycle/waitlist.js` (`_renderWaitlistCard`, `_renderWaitlistRows`, `_wcard*` helpers, `_revision*` and the resilient listener registered as `'revision_waitlist'`).
  2. `src/domains/pedido-lifecycle/pending.js` (`renderPendientesList`, `_cpst*`, `_gb*`, `persistPendingEntry`, pending→confirmed transition).
  3. `src/domains/pedido-lifecycle/confirmados.js` (`renderConfirmadosList`, `_renderClienteAllOpenLines`, `_renderE4BBoApp`, `_renderE4BAsigApp`, `classifyTransferError`).
  4. `src/domains/pedido-lifecycle/backorder.js` (`_backordersGraficosData`, `_updateBackorderButtonCounts`, `_sapAsignadoConStockDeCliente`, `_pendingAppDeSku`, `_diagBackorderOverlap`).
- **Effort:** large (multi-week, 4-6 PRs). Risk is non-trivial — each sub-stage must be verified with E2E (manual QA on dev before merge).
- **Impact:** high — unblocks every other refactor on top of pedidos and finally gets the biggest surface under test coverage.

#### A2. Implicit state machine for pedido lifecycle has no single source of truth

- **Area:** flow boundaries / state management
- **Current state:** The pedido "stage machine" is encoded as literals (`'pending' | 'confirmed' | 'borrador'` for `stage`; `'BO' | 'ASIG' | 'confirmed'` for `lines[i].state`; `transferidoSAP?.docNum`, `transferidoSAP?.orderDocEntry`, `qtyInvoiced > 0`, `paidStatus`, `plannerStage='cobrado_parcial|cobrado_full'` as Planner Kanban signals). The rules are duplicated 3+ places: `functions/core/planner-compute-column.js` (server), `src/domains/planner/compute-column.js` (client), and ad-hoc interpretation inside `renderConfirmadosList`, `_renderWaitlistCard`, `auto-send-sap-core`, `auto-confirm-pending-core`.
- **Problem:** no formal transition table. The precedent cases documented in CLAUDE.md (#28 Firestore skip silent, FATECHI race, v1172 idempotent asymmetry client-manual vs CF-trigger, v974 Lista de Espera ≠ compromete stock, LAMORA $3.699.000 vs $1.667.000) are all symptoms of the same root cause: the stage machine is implicit, so each code path interprets it slightly differently and bugs slip into the deltas. The dual-impl rule in `planner-compute-column` ("server and client must match") is a code-review-gated invariant with no automated check.
- **Suggested direction:**
  1. Materialise a single `src/pure/pedido-stage.js` module exporting `computeStage(pedido): LifecycleStage` with an enum `{ WAITLIST, PENDING, CONFIRMED_HELD, OFFERED_TO_SAP, ORDER_IN_SAP, PARTIALLY_INVOICED, FULLY_INVOICED, PARTIALLY_PAID, FULLY_PAID, CANCELLED }`. Make `computeColumn` a thin mapping over that enum (client + CF both import).
  2. Add a `canTransitionTo(from, to)` guard pure fn + unit test it exhaustively.
  3. Treat `operations_log` writes as the audit trail — add a `recordStageTransition(pedidoId, from, to, actor, cause, deps)` helper used by every CF/client site that writes `stage` or `lines[i].state`. This is a lightweight step toward event sourcing without committing to the full pattern.
- **Effort:** medium (3-5 PRs — pure module + migrations in computeColumn + planner CF + 3-4 client sites + tests).
- **Impact:** high — direct mitigation for the FATECHI bug family. ROI compounds because new flows (returns, cancellations, splits) land on top of a stable abstraction.

#### A3. Shell bundle at 2.5 MB blocks first paint; lazy chunks exist but shell carries pedido/dashboard/rutas eagerly

- **Area:** build / bundle
- **Current state:** `app.bundle.js` shell = 2.52 MB (uncompressed, with inline sourcemap). 8 lazy chunks total ~1.37 MB. The shell eagerly imports 15 domains in `src/main.js:72-93` because they attach Firestore listeners at login. Heaviest shell-resident domains per LOC: `master-clientes` (3,255), `sap-admin-panel` (2,640), `rendiciones` (2,079), `visitas` (1,942), `rutas` (1,694), `pedidos-modal` (1,593), `dashboard` (1,407), `exports-sap` (1,279).
- **Problem:** shell is loaded `blocking` in `<head>` and executes before the inline script. 2.5 MB is a lot on 3G/4G Argentina mobile. The architectural root is that each domain couples "listener attach at login" with "UI render on tab open" — can't split them without a refactor. Audit 2026-10-07 Perf C1 identified this as deferred ("mayor scope + requiere coordinacion con regla CLAUDE.md §18").
- **Suggested direction:** split each shell-resident domain into `<domain>-listeners.js` (small, shell-resident, Firestore subscription + state writes) and `<domain>-ui.js` (lazy chunk, DOM render + handlers). Example: `rendiciones-listeners.js` keeps `ensureRendicionesListener` + `misRendicionesCache` wiring (~200 LOC); `rendiciones-ui.js` becomes a lazy chunk (~1,800 LOC loaded only when user opens Rendiciones tab). Pattern already partially done for `notificaciones` (v1178) and `seguimiento` (v811). Repeat for 6 remaining domains → shell should drop to ~1 MB.
- **Effort:** large (6 PRs — one per domain). Risk: cross-scope listener wiring must survive the split (CLAUDE.md #17 is explicit about the trap).
- **Impact:** high — directly cuts time-to-interactive for 100% of users.

### Medium priority

#### M1. Only 5 of 30 `onSnapshot` listeners use the resilient fallback helper

- **Area:** listener lifecycle
- **Current state:** `ensureListenerWithFallback` (index.html:30565) implements zombie-detection + 3s timeout fallback + polling until listener revives (v1077-v1078, 2026-09-25). It's used for `revision_waitlist`, `stock_snapshot`, `pedidos_own`, `pedidos_all`, and `sap_integration`. The other 25 raw `onSnapshot` calls (userData, campaigns, sap_snapshot, approved_altas, client_master, sap_vendors, targets, custom_routes, route_overrides, my_notifs, my_external_partners, visits_partner, my_sent_tasks, alta_cli_mine, backorder_snapshot, mis_rendiciones, todas_rendiciones, sap_clients, sap_products, product_catalog, gh_actions_status, auto_confirm_cfg, sentry_status, sap_sync_state, sap_sl_health, firestore_quota, collections_growth, storage_usage, cf_health, price_list, temporal_price_list, vendor_overrides, client_locs, seg_notes, seg_status, auto_send_pedidos, planner_pedidos, planner_waitlist, planner_config) have no safety net.
- **Problem:** `revisionWaitlist` zombie bug (Mariano, 2026-09-25) was reproducible across *any* listener on bad network. The 25 un-wrapped listeners are latent risks. The `detachFirebaseListeners` test (`tests/unit/listeners.test.js`) covers cleanup but not resilience.
- **Suggested direction:** migrate the 25 remaining listeners to `ensureListenerWithFallback` over 2-3 PRs grouped by domain (dashboard/campaigns, master-clientes/sap-admin, planner, panel-metrics). Add a smoke test that greps for raw `.onSnapshot(` in `src/domains/*.js` and fails if the count stops decreasing (ratchet pattern).
- **Effort:** medium (3 PRs).
- **Impact:** medium — hardens UX on flaky mobile network for ~30 users.

#### M2. Several CF handlers still contain significant business logic inline (CLAUDE.md #7 violation)

- **Area:** CF structure
- **Current state:** `functions/index.js` is 2,561 lines for a "wrapper" file. Three handlers are notably fat:
  - `setupGetMovimientos` (lines 1455→1978 = 523 LOC): all SETUP API client logic (login, product cache, movements fetch, 365-day pagination, vendor cartera scoping, mapping) is inline. No corresponding `functions/core/setup-*-core.js` exists.
  - `onPedidoConfirmedSendToSap` (654→858 = 204 LOC): config loading, mapping Firestore→Map, `appSeriesId` validation, `transferError` writes — all inline. Delegates to `handleAutoSendSap` only after ~140 LOC of setup. Dependency-injection surface is incomplete.
  - `triggerPlannerSync` (2133→2239 = 106 LOC): orchestrates 4 core sync functions with its own `sap_sync_log` write inline. No orchestration core.
  - `generateVentasReportCF` (2388→end = 170+ LOC): lazy-imports BigQuery + exceljs, business logic for ventas report inline. No `functions/core/ventas-report-core.js` wrapper (although the file exists at 427 LOC — the CF should delegate but may not fully).
- **Problem:** these handlers can't be unit-tested without emulators (contradicts CLAUDE.md #7 motivation). FATECHI itself was a CF where the pre-check logic lived client-side but not server-side; the asymmetry comes from these fat handlers evolving independently of their should-be core modules.
- **Suggested direction:** extract `setup-get-movimientos-core.js`, `trigger-planner-sync-core.js`, and finish the delegation inside `onPedidoConfirmedSendToSap` so the inline is purely plumbing. Audit `generateVentasReportCF` to confirm it uses `ventas-report-core.js` as thin wrapper.
- **Effort:** medium (3-4 PRs). Each extraction is <1 day with existing test harness pattern.
- **Impact:** medium — unlocks unit tests for the biggest remaining untested CF surface.

#### M3. Global state scattered across `var`/`window` without a state manager

- **Area:** state management
- **Current state:** cross-scope state uses `var X` (for inline↔bundle sharing) or `window.X` (bundle↔inline). Grepped list of load-bearing globals: `globalPedidos` (197 occurrences across 23 files), `STOCK_MAP`, `STOCK_QUANTITIES`, `STOCK_WAREHOUSE_BREAKDOWN`, `STOCK_WAREHOUSE_COMMITTED`, `STOCK_BACKORDER`, `STOCK_PRE_LANZAMIENTO`, `STOCK_BACKORDER_APP`, `STOCK_ASIG_APP`, `STOCK_ASIG_BY_CLIENT_APP`, `STOCK_BO_BY_CLIENT_APP`, `STOCK_UPDATED_AT`, `revisionWaitlist`, `clientMasterCache`, `sapClientsMap`, `sapProductsMap`, `sapConfigCache`, `approvedAltasList`, `userRole`, `currentUser`, `fbDb`, `firebase`.
- **Problem:** no narration of who writes what. Grep is the only tool to understand dependencies. Change invalidation is implicit (listener fires → mutate global → every subsequent read gets new value, but renders not auto-triggered — functions explicitly call their render helpers). Memoization boundaries are ad-hoc (`getStockPorClienteMemo`). CLAUDE.md #65 ("snapshot projection completeness") exists because snapshot listeners wrote partial field sets.
- **Suggested direction:** mid-term, formalise a minimal state module `src/state/index.js` with named buckets (`stock`, `pedidos`, `clients`, `sap`, `auth`, `config`) and a `subscribe(bucket, cb)` fn. Writers inside listeners call `state.update(bucket, patch)`; readers call `state.get(bucket)`. Zero deps, 100 LOC. Not a reactive framework — just a documented single doorway. Migrate 1 bucket per PR starting with `stock` (already the most-touched + has memoization need).
- **Effort:** medium (one scaffolding PR + 1 PR per bucket; 6 buckets).
- **Impact:** medium — payoff grows with each extracted domain. Prerequisite for making extractions reviewable.

#### M4. The dual implementation of `computeColumn` has no automated parity check

- **Area:** CF structure / flow boundaries
- **Current state:** `functions/core/planner-compute-column.js` (server) and `src/domains/planner/compute-column.js` (client) are intentionally identical. `tests/unit/planner-compute-column.test.js` tests one; `tests/functions/planner-stage-change.test.js` tests the server via its consumer. There is no test that imports both and asserts equivalence on a shared fixture.
- **Problem:** silent drift risk. A frontend hotfix to column rules landing without the CF getting the same fix would cause the Planner UI (column) and the Planner email trigger (which column just changed) to disagree. Precedent: v1013/v1037 both touched the rules; v1037 removed `confirmado` and the comment says server+client are synced "by convention."
- **Suggested direction:** add `tests/smoke/planner-compute-column-parity.test.js` that imports both modules and asserts `computeColumn(fixture) === computeColumnServer(fixture)` for a shared 40-case fixture. Trivial PR. For bigger payoff, extract the rules to `src/pure/planner-column-rules.js` + both callers import.
- **Effort:** small (1 PR).
- **Impact:** medium — zero-cost guardrail against a silent-fail scenario.

#### M5. Service worker strategy is correct but caches 8 chunks + bundle + CSS keyed to `CACHE_VERSION` — any cache-busting bug invalidates all

- **Area:** service worker strategy
- **Current state:** `sw.js` uses network-first for `index.html`, no-cache for `stock.json`, stale-while-revalidate for everything else. `CACHE_VERSION` must be bumped on every deploy (currently v1242) and must match `APP_VERSION` in `index.html` (asserted by `bundle-runtime.test.js`). Chunks referenced in `STATIC_ASSETS` for pre-install cache warming.
- **Problem:** correct strategy choices. Minor gap: `install` event does `cache.addAll(STATIC_ASSETS).catch(()=>{})` which silently swallows any pre-cache failure (e.g., a chunk 404 post-rename). Could pass QA but leave users with partial offline. Also: `stale-while-revalidate` for `.css` and `.bundle.js` is correct, but there's no mechanism to force-refresh when a shell/chunk mismatch would cause a `ReferenceError` on a lazily loaded chunk expecting a shell API that changed. CLAUDE.md #19 flags this exact risk but relies on the user to invalidate via next load.
- **Suggested direction:** (a) replace silent `catch(()=>{})` on `install` with a reporter that posts to Sentry via `self.registration.active.postMessage({...})`; (b) version-stamp each chunk (`chunks/exports-core.v1242.js`) at build time so stale chunks are literally un-cacheable — invalidation becomes impossible to get wrong. Second item is bigger, worth considering if post-deploy "mystery errors" keep appearing.
- **Effort:** small (observability) / medium (version-stamp chunks).
- **Impact:** low-medium — rare but hard-to-reproduce incidents.

#### M6. Bundle growth trend has no automated budget per domain

- **Area:** build / bundle
- **Current state:** `bundle-runtime.test.js` asserts shell ≤ 3.5 MB and chunks ≤ 400 KB each (except per-chunk ratchets). The ceiling has been raised 5 times (CLAUDE.md #16: 200 KB → 500 KB → 1.5 MB → 2.5 MB → 3 MB → 3.5 MB). No baseline per-domain.
- **Problem:** monotonic size growth is OK while extracting domains (the whole-app total shrinks), but post-extraction era (we're nearly there) the next phase should be *shrinking* the shell. The ceiling-only test doesn't incentivise that.
- **Suggested direction:** publish a per-domain budget JSON (`bundle-budget.json`) that CI enforces: shell < 2.5 MB today, down to < 1 MB after A3 extractions. Each chunk capped at its current size + 10%. Fails prevent merge.
- **Effort:** small (1 PR).
- **Impact:** medium — prevents regressions on the A3 refactor.

### Low priority / future consideration

#### L1. Chunk sync (CLAUDE.md #18) requires 3 manual places; tests cover 2

- **Area:** build / tests
- **Current state:** adding a lazy chunk requires editing `build.js:LAZY_CHUNKS`, `src/main.js:installChunkStubs`, and `sw.js:STATIC_ASSETS`. Tests cover (1) and (3) but not (2) — if a developer adds the chunk to build + SW but forgets `installChunkStubs`, the chunk exists but stubs don't wire up until runtime first click fails.
- **Problem:** low frequency failure mode, but preventable.
- **Suggested direction:** have `build.js` be the single source of truth; auto-generate `src/main.js` stub block from `LAZY_CHUNKS` at build time (as a header-inject or as a separate `src/chunk-stubs.generated.js` imported from `main.js`). Removes CLAUDE.md #18 as a landmine.
- **Effort:** small (1 PR).
- **Impact:** low — closes a known gotcha.

#### L2. `installChunkStubs` relies on globals via `window.foo` — same bundle-IIFE gotcha as #17 but less documented

- **Area:** build / state
- **Current state:** stubs register as `window.foo = () => { loadChunk(name).then(() => window.foo(...args)); }`. The replacement `window.foo = realFn` happens on chunk load. If the chunk accidentally declares `export function foo()` without assigning to `window`, stub stays forever and loading loops.
- **Problem:** silent coupling. The chunks (e.g., `chunks/notificaciones.js`) literally overwrite `window.markAllNotifsRead` twice (CLAUDE.md note in `src/main.js:177-179` acknowledges "the 2nd overrides the 1st at runtime; TODO consolidate"). The pattern works but encodes dependencies in global namespace.
- **Suggested direction:** medium-term, replace `window.*` stubs with a `chunkRegistry` map; chunks register themselves via `chunkRegistry.set('name', { foo, bar, ... })` at the top of each chunk. Callers do `chunkRegistry.get('name').foo(...)` — explicit, no global-namespace collisions.
- **Effort:** medium (plumbing + migration of ~90 stubs).
- **Impact:** low — current pattern works. Nice-to-have.

#### L3. Index.html inline logic is largely untested — acceptable but tracked

- **Area:** test strategy
- **Current state:** 699 unit tests, 31 test files. All pure fns in `src/pure/` tested. All CF cores tested. `tests/unit/listeners.test.js` lint-tests `detachFirebaseListeners` cover vs declaration. `tests/smoke/bundle-runtime.test.js` tests build artifacts. Zero coverage for the 26,200 inline LOC (render + modal + handler layer).
- **Problem:** this is the correct priority (test what's testable without a DOM), but the untested surface is the one producing most bugs. The audit 2026-10-07 (QA tests nuevos) explicitly deferred this.
- **Suggested direction:** two complementary moves:
  1. Keep extracting pure fns out of inline into `src/pure/` — testing follows naturally.
  2. Introduce `@vitest/browser` or `happy-dom`-based tests for a handful of critical render fns post-extraction (`renderConfirmadosList`, `_renderWaitlistCard`). Smoke-level: given a `pedido` fixture, assert output HTML contains expected markers. Not full UI testing — guard rails against regressions in the computation that *produces* the HTML.
- **Effort:** medium-large (ongoing; follows A1/A2).
- **Impact:** low-medium — compounds with every extraction.

#### L4. Operations log is only lightly structured — ad-hoc event sourcing opportunity

- **Area:** flow boundaries
- **Current state:** `operations_log/{logId}` is written by 10 CF cores (auto-confirm, auto-send, fifo-assign, invoice-sync, pedido-snapshot, rate-limit, rendicion-duplicate, resolve-pedido-cardcode) with heterogeneous schemas. Rules protect writes; nothing enforces a schema.
- **Problem:** this is already the de-facto event log for pedido lifecycle. With a tiny investment it could be the audit stream for A2's state machine. Today, replaying "what happened to pedido X" requires joining Firestore + Sentry + GH Actions logs.
- **Suggested direction:** adopt a conventional schema `{ ts, actor, scope ('pedido' | 'line' | ...), scopeId, event, before, after, cause, correlationId }` and wrap writes in a `logOperation(deps, event)` helper (new in `functions/core/op-log-core.js`). Add a client-side read helper that filters by scopeId → gives you the per-pedido timeline for free in modal "Historial" tabs (today `renderPlannerModalHistorial` builds its own from scratch, 154 LOC).
- **Effort:** medium (1 PR for helper + 1 PR per core migration; 10 cores).
- **Impact:** low-medium — unlocks faster incident forensics (lost ~6h on FATECHI partly because event trail was fragmented).

#### L5. SAP SL dependency is implicit everywhere — no circuit breaker abstraction

- **Area:** distributed systems / resilience
- **Current state:** 6+ CFs call SAP Service Layer directly via `functions/core/sap-sl-client.js`. The client has an `AbortSignal.timeout(90s)` since v1172 (good) but no circuit breaker, no per-tenant backoff, no shared "SL is unhealthy, skip for 10m" state. `checkSapSlHealthCF` runs on schedule and writes to `sap_sl_health`, but nothing consumes it to short-circuit callers.
- **Problem:** when SL is slow/down (observed: >5min POST), every CF retries independently and consumes quota + Firestore writes + emails. CF cold starts amplify the problem.
- **Suggested direction:** add a tiny `functions/core/sap-sl-circuit-core.js` that reads `sap_sl_health` + maintains a per-process memo "last 5 min error rate"; any `sapPost`/`sapLogin` wraps with `if (circuit.open()) throw CIRCUIT_OPEN`. Admin can override via Firestore flag.
- **Effort:** medium (1 PR + wiring 3-4 call sites).
- **Impact:** low-medium — degraded SAP days become less destructive.

## Positive observations

- **Strong pure-fn layer:** `src/pure/*.js` (18 files, well-structured, each with its own test file) is a real asset. `getStockRealmenteDisponible`, `redistributeAsigLine`, `computeVirtualAsigFifo`, `computeBackorderSkuMap`, `splitPedidoLine` are the kind of pure, memoizable, testable primitives that make the rest of the architecture tractable. Keep extracting into this layer first.
- **CF core/wrapper separation is real:** 29 cores in `functions/core/` with 26 corresponding test files. The pattern described in CLAUDE.md #7 (deps injected, no `firebase-admin` imports in cores) is actually followed. This is unusual discipline for a 1200-version repo.
- **CLAUDE.md as living architecture memory:** 30 rules distilled from real incidents (listener leak, bundle scope, chunk sync, cross-scope state, dev branch workflow, apple-design gates, App Check propagation, SAP SL username casing, Firestore skip silent). This is better documented than most mid-size codebases. The LAZY_CHUNKS + installChunkStubs + sw STATIC_ASSETS trio is a clean lazy-loading contract.
- **Listener audit test** (`tests/unit/listeners.test.js`): parses `index.html` to extract `let/var unsub*` + `window.unsub*` from `src/domains/*.js`, cross-checks against `off('X', ...)` calls in `detachFirebaseListeners`. This is a smart lint-level enforcement of CLAUDE.md #12. Keep this pattern — it caught the `unsubAltaCliMine` leak at E2.g.
- **Resilient listener helper** (`ensureListenerWithFallback`, v1077): zombie detection + fallback `.get({source:'server'})` + continuous polling until listener revives is well-engineered. Expand its adoption (M1).
- **FATECHI post-mortem round** (audit 2026-10-07): the 4-round deploy of 16 fixes in 1 day with full Antes/Problema/Cambio/Por-qué/Verificación/Rollback documentation per fix is best-in-class incident response. CLAUDE.md #30 formalises this; it's being followed.
- **Dual-impl Planner column rules** are each separately tested — not perfect (M4), but far ahead of the typical "it works on the client, who knows about the server."

## Suggested next 3-6 extraction / refactor targets

| Domain | Current LOC in `index.html` | Est effort | Risk | Value |
| --- | --- | --- | --- | --- |
| **Pedido waitlist** (`_renderWaitlistCard`, `_wcard*`, `_revision*`, `revisionWaitlist` listener) | ~3,500 (incl. 2,272 LOC `_renderWaitlistCard` + 650 `_cpst*` + 300 `_revision*`) | large (1-2 PRs with sub-stages) | medium — most frequented screen, visible regressions obvious | **high** — unblocks A1 |
| **Confirmados panel** (`renderConfirmadosList`, `classifyTransferError`, `_renderE4BBoApp`, `_renderE4BAsigApp`, `_renderClienteAllOpenLines`) | ~1,800 | medium | medium | high |
| **Backorder dashboard** (`_updateBackorderButtonCounts`, `_backordersGraficosData`, `_backordersChartHtml`, `_diagBackorderOverlap`, `renderBackordersGraficos`) | ~2,000 | medium | low — admin-only, less time-critical | medium — admin tool but opens lazy if extracted as chunk |
| **Panel-metrics listeners cluster** (`ensureGhActionsStatusListener`, `ensureSentryStatusListener`, `ensureSapSyncStateListener`, `ensureSapSlHealthListener`, `ensureFirestoreQuotaListener`, `ensureAutoConfirmCfgListener`) + `ensureFirestoreQuotaListener`'s inlined 567 LOC body | ~700 (listener wrappers) + 567 (quota body) | small-medium | low — admin panel-only | medium — ties into `panel-control` lazy chunk cleanly |
| **TOTP / password gate** (`showTotpGateModal`, `showPasswordGateModal`, `totpBase32*`, `generatePasswordSalt`, `prefillLoginEmail`) | ~1,100 | small-medium | medium — security-sensitive, needs careful test | medium — reduces shell + logical boundary around auth |
| **Deposito & Zonas** (`_renderDeposito`, `renderZonasList`, `populateZonasFilters*`, `applyVendorOverridesToPoints`, `ensureVendorOverridesListener`) | ~1,500 | medium | low-medium | medium |
