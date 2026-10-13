# Code Quality Audit — 2026-10-13

## Executive summary

- **Dead code volume: medium.** The clearest wins are the `markAllNotifsRead` double-declaration (CLAUDE.md KNOWN BUG, still live), the `DISCONTINUED_SKUS` + `volverABorrador` deprecated-but-preserved blocks, 9 cleanup `localStorage.removeItem` calls for versions `v4-v12` of outlines cache, and 22 one-shot `_<name>.cjs|.py` scripts that could be archived. Est. ~1,200 LOC removable in `index.html` + ~300 LOC across modules without changing behavior.
- **Biggest consistency drift: client naming.** The same concept appears as `clientName`, `cliente`, `clienteNombre`, `cardName`, `customerName`, and the SAP identifier as `cardCode` / `clientCardCode` / `clientCode`. Fallback chains like `pedido.clientName || pedido.cardName || pedido.clientCardCode || pedido.cardCode || ''` appear verbatim in 3 locations of `index.html` and `functions/core/planner-stage-change-core.js`. Same drift on `vendorKey` vs `vendedor` vs `ownerVendor` (3 names, 10+ files each) and `sl.username` vs `sl.userName` (fallback pattern used 14 times in `functions/index.js` — root cause of CLAUDE.md #24).
- **Top refactoring opportunity: lifecycle-state enum.** 51 inline `===` checks against magic strings `'confirmed' | 'BO' | 'ASIG' | 'pending' | 'borrador'` + 128 role-string literals (`'admin'|'gerente'|...`) spread across 20+ files, with the identical `WarehouseCode: '11'` logic duplicated between CF-core and client (and the only shared constant file `sap-lock-constants.js` sits in `src/domains/`, not reachable from CFs). Extracting a `src/shared/constants.js` consumable from both frontend and `functions/core/` would retire 300+ magic literals and eliminate the "I set it in one place but the other diverged" bug class (precedent v1004 and v924).
- **God functions remain concentrated in the pedido lifecycle.** `renderDashboard` (771 LOC), `renderMasterClientesTable` (601), `exportSapReadyCsv` (564), `renderReviewLines` (481), `exportMasterClientes` (446), `_exportLegacyFull` (565 inline). Overlaps with the Architecture audit `A1` recommendation (pedido-lifecycle extraction).
- **Positive observations well worth preserving.** 670/670 unit tests, 19 `src/pure/` modules, CLAUDE.md discipline (`v471/v505 etc` provenance comments), `functions/core/` wrapper split (rule #7), KNOWN BUG documentation, dual-impl checked by test `sap-lock-ttl.test.js`.

---

## Dead code / unused exports

| File:Line | Symbol | Status | Safe to delete? |
|-----------|--------|--------|-----------------|
| `index.html:6655-6658` + `27090-27091` + `27142-27143` | `DISCONTINUED_SKUS = new Set()` | Rollback comment says "feature completo removido" (v1120). Set is never populated; `.forEach` filter blocks are permanent no-ops. | Yes. 7 LOC + 2 code blocks. |
| `src/domains/notificaciones.js:1355` AND `:1773` | `window.markAllNotifsRead` | DUPLICATE: 2nd def (sequential + task_ack) overrides 1st (chunked batches). Documented as "KNOWN BUG preservado". | Behavioural — delete the dead 1st def (lines 1355-1405). Confirm the active one (1773) is what prod wants. |
| `index.html:31795-31828` | `window.volverABorrador` override | Logs warn + `return;` + 25 LOC "legacy body preservado como referencia — inalcanzable". `eslint-disable no-unreachable` suppresses lint. | Yes, after confirming callers log the warn ≠ non-zero (grep: only 1 call site at line 23851 as doc). |
| `index.html:6946-6954` | 9 × `localStorage.removeItem('shimano_vendor_outlines_v4..v12')` | Cleanup for versions 2+ years out of rotation. Current key is `v16`. | Yes. 9 LOC. Users on `v4`-era localStorage no longer exist. |
| `index.html:7847-7850` | `ORDERS_KEY` + `saveOrders()` no-op | v862 wiped the feature but kept name + no-op shim. 4 LOC. | Keep until `src/domains/pedidos-modal.js` closes the dependency (it still references `saveOrders` as free identifier). |
| `index.html:6442-6465` | `_safeOpenExportFormatModal` | Band-aid for v372 SW cache mismatch; now that chunks are stable it should be redundant. Verify Sentry has no issues in last 90d, then delete. | Likely yes. 24 LOC + 2 HTML onclick refs. |
| `src/domains/pedidos-modal.js:1574-1578` | Comment-only block for deleted stub `window.doConfirmPedido` | Already documented as deleted in v1172. Comment is historical context. | Keep for 1 more cycle (CLAUDE.md #30 — provenance). |
| `functions/index.js:109-110` | `setupProductosCache` + `setupProductosCacheAt` module-level cache | Only populated inside `setupGetMovimientos`. Fine. Not dead. | — |
| `scripts/_*.{py,cjs,mjs}` (22 files) | One-shot diagnose/fix scripts (`_diagnose_soledad`, `_reopen_soledad_pedido`, `_split_catana_gonzalo`, `_fix_dup_order_numbers`, etc.) | README already explains the `_` prefix convention. These have run exactly once. | Move to `scripts/archive/` — ~1,200 LOC off the hot path. |
| `scripts/audit_backorder_overlap_adc.py` + `scripts/bo_daily_audit_dryrun_adc.py` | ADC wrapper around the non-`_adc` version | Wrapper duplicates boilerplate (~200 LOC). | Replace with a `--use-adc` flag on the main scripts. |
| `index.html:6310-6316` | `window.isPedidoSplitEnabled` | Default now `true` since v620 (2026-08-25). Only `split_enabled='0'` disables. All 4 call sites fall into the enabled branch. | Inline the `true` and delete the flag + 4 branches. |
| `index.html:19646-19652` | `window.isE4BEnabled` | Default returns `true` for admin/gerente/vendedor/interno. Only `localStorage.e4b_disabled='1'` disables. 4 call sites. | Candidate to inline (same pattern as `isPedidoSplitEnabled`). |

---

## Duplicated logic

#### Q1. `window.markAllNotifsRead` defined twice (same file, different behavior)

- **Locations:** `src/domains/notificaciones.js:1355-1405` AND `src/domains/notificaciones.js:1773-1813`
- **Diff:** 1st def uses Firestore batches of 400 writes (fast, atomic chunk, no task_ack). 2nd def does sequential `await update()` per notification + sends `task_ack` notifications when `type==='task'`. The 2nd wins at runtime (overrides 1st).
- **Risk:** The 1st def is dead and misleading. Someone grepping for `markAllNotifsRead` lands on the batched version first, assumes that's prod behavior, and iterates against a false mental model (precedent v469 "pending fantasma" bug — CLAUDE.md #30).
- **Suggestion:** Pick one. If prod expects task_ack side-effects (confirming to the sender), keep 2nd and delete 1st. If chunked speed matters more (bulk operation ~500 notifs), merge both — chunked batch for `read` with task_ack side-effects enqueued separately. Document choice in README §41.

#### Q2. `buildQuotationPayload` has two implementations (CF + client)

- **Locations:** `functions/core/auto-send-sap-core.js:170` (`export function buildQuotationPayload(pedido, pedidoId, deps, trueVendor)`) AND `src/domains/sap-service-layer.js:487` (`sapSL.buildQuotationPayload(pedido)`)
- **Diff:** Different signatures (CF receives explicit deps + trueVendor; client reads globals `sapGetClienteCode`, `getVendorForKey`, `sapConfigCache`). Both must emit identical OQUT payload (same ItemCode dedup, same WarehouseCode `'11'`, same UoMEntry `1`, same filterLines by `state==='confirmed'`). No automated check that they match (unlike `planner-compute-column` which has an identical-file invariant).
- **Risk:** CF trigger (auto-send) and client batch handler can emit slightly different payloads. FATECHI 2026-10-06 ($7.3M duplicate SQ) root cause was asymmetry between CF-trigger idempotent check and client-batch — not payload build, but same class of bug.
- **Suggestion:** Extract `src/pure/build-quotation-payload.js` with explicit deps (same shape as `functions/core/sap-sl-client.js`). Both CF and client import. Add Vitest unit tests that both callers produce byte-identical payloads for a snapshot pedido fixture.

#### Q3. `planner-compute-column` is a byte-identical dual file

- **Locations:** `functions/core/planner-compute-column.js` AND `src/domains/planner/compute-column.js` (79 LOC each, md5 identical)
- **Diff:** None. Deliberate duplication documented in the header comment.
- **Risk:** Keeping two copies in sync is a CLAUDE.md #27 trap waiting to happen — a hotfix landed in one and missed in the other via merge. The "they must match" invariant is maintained by convention, not a test.
- **Suggestion:** Promote to `src/pure/planner-column.js` with ESM export. CF import works (functions/package.json uses `"type":"module"` already — same pattern as `functions/core/rendicion-duplicate-pure.js` which lives in `functions/core/` AND is bundled into `src/pure/rendicion-duplicate.js`). Alternately, pick one source of truth and symlink the other (git supports it on all OS post-2.19).

#### Q4. `rendicion-duplicate-pure` has an identical copy in two trees

- **Locations:** `functions/core/rendicion-duplicate-pure.js` AND `src/pure/rendicion-duplicate.js` (md5 identical)
- **Diff:** None.
- **Risk:** Same as Q3.
- **Suggestion:** Same as Q3. One root of truth.

#### Q5. `normStr` lambda redeclared 4+ times in `index.html` with different implementations

- **Locations:** `index.html:7550` (`s => (s == null ? '' : String(s).trim().replace(/\s+/g, ' '))`), `index.html:10572`, `index.html:17317`, `index.html:28953` (`(s || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()`)
- **Diff:** Line 7550 does NOT uppercase or strip diacritics. The others DO. Any address/city comparison depending on the "wrong" variant silently fails to match.
- **Risk:** Address normalization differs by call site. Bug territory: compared `"S.M. de Tucumán"` vs `"S.M. DE TUCUMAN"` — line 7550 variant says false, others say true.
- **Suggestion:** Replace all 4 with `window.normClientName` (already in `src/pure/normalize.js` and bound to window at `index.html:6499`). If a non-uppercase variant is needed, add it to `src/pure/normalize.js` as `normClientNameNoUpper`.

#### Q6. `sl.username || sl.userName` fallback repeated 14 times in `functions/index.js`

- **Locations:** `functions/index.js:175, 234, 300, 351, 408, 458, 693, 1146, 1219, 1261, 1376, 2178` + 2 more
- **Diff:** None — identical fallback pattern. CLAUDE.md rule #24 was created because one of the 15 (line 446) didn't have it, breaking `onPedidoConfirmedSendToSap` silently for weeks.
- **Risk:** Any new CF added by any agent without this fallback inherits the v918→v999 silent bug. Pattern depends on human discipline (CLAUDE.md rule #24).
- **Suggestion:** Extract `function buildSapDeps(sl, password)` helper or constant at the top of `functions/index.js` (or in `functions/core/sap-sl-client.js`), returning `{url, companyDB, userName, password}`. All 14 call sites become `const sapDeps = {fetch: globalThis.fetch, sapConfig: buildSapConfig(sl), log}`. Zero risk since the current fallback is already applied in every live callsite.

#### Q7. `SALES_WAREHOUSE = '11'` constant duplicated in 2 CF cores, inline literal `'11'` in a third

- **Locations:** `functions/core/auto-confirm-pending-core.js:44`, `functions/core/sap-stock-recheck-core.js:38`, `functions/core/auto-send-sap-core.js:203` (literal `WarehouseCode: '11'`)
- **Diff:** Constant is the same string, but defined independently. The 3rd location uses the raw string.
- **Risk:** If Shimano changes the sales warehouse (hypothetical BIKE expansion), 3 places to update — easy to miss the inline literal. Same drift class caused the 2026-09-21 `has_stk` sync bug (CLAUDE.md #26: whs 11 vs totalQty).
- **Suggestion:** Promote to `functions/core/sap-constants.js` (new 10-LOC file). Export `SALES_WAREHOUSE`, `NON_SALES_WHS` set, `SAP_LOCK_TTL_MS` (currently in `src/domains/sap-lock-constants.js`). Then both frontend and CFs import from one place.

#### Q8. `_closeAsigResolveModal` and 3 handler closures reset per modal open

- **Location:** `index.html:22004-22107` — inside `window._showAsigResolveModal`, defines `window._asigLineChoose`, `window._asigLinePartialQty`, `window._asigResolveApply`, `window._closeAsigResolveModal` **every call**.
- **Diff:** Each modal open overwrites window handlers with new closures referencing the current `asigLines` + `onDone` callback.
- **Risk:** If a 2nd modal opens before the first closes (double tap, race), handlers point to the latest modal's closure but the DOM still shows the first modal. Rare but visible as "clicks on modal 1 affect modal 2".
- **Suggestion:** Store the state in a module-level `let _currentAsigResolveState` and let the 4 handlers be defined once at module init. Mitigation only (true 2 concurrent modals is unlikely).

#### Q9. "SAP SL config incompleta" check repeated at 6 CF entry points without a helper

- **Location:** `functions/index.js:1138-1140` + 5 more copies. Each callable checks `if (!sl.url) throw new HttpsError('failed-precondition', ...)`.
- **Diff:** Minor wording differences in some.
- **Risk:** CF added without this check (e.g. a quick patch during an incident) silently calls SL with `undefined` URL → confusing 500 instead of actionable error.
- **Suggestion:** Add `assertSapConfig(sl)` helper in `functions/core/sap-sl-client.js`.

---

## Shadowing / redeclaration risks

| Symbol | Risk | Verdict |
|--------|------|---------|
| `window.markAllNotifsRead` | 2 live defs in same file. 2nd wins. See Q1. | **Live bug class** (documented but not fixed). |
| `window.doConfirmPedido` | Was duplicated inline+bundle; bundle stub deleted in v1172 (`src/domains/pedidos-modal.js:1574`). Only the inline live version remains at `index.html:31057`. | Fixed. |
| `window.volverABorrador` | 1 live def that returns immediately. Legacy preserved as unreachable. See dead code table. | Dead, keep until grep confirms no caller. |
| `window.renderPanelControl`, `window._updateSapHealthBadge`, `window.applyThemeTilesSwap`, etc. | Earlier `uniq -c` showed `>1` matches, all turn out to be `typeof window.X === 'function'` checks (feature detection), NOT redeclarations. | OK — false positive from loose grep. |
| `window.escapeHtml`, `window.normClientName`, `window.titleCase`, `window.calcClientDiscount` | Bound once from `window.__phase0.pure` at `index.html:6499-6506`. No shadow. | OK. |
| `function _makeRow` | Defined twice at `index.html:10868` AND `index.html:19799`, but both are nested inside closures (different enclosing functions). No scope collision. | OK — different closure scopes. |
| `function findKey` | Defined at `index.html:27438` AND `src/domains/master-clientes.js:575` — both local to closures (xlsx header lookup). | OK — intentional, closure-local. |
| Top-level `let/const/var` names | Checked 85 var + 92 let + 77 const at indent-0: zero duplicate top-level identifiers. | OK. |
| 254 global `var/let/const` at top level | Not shadowing, but excessive global surface area. See God globals section. | Hygiene issue. |

Overall the "silent cross-scope let" trap of CLAUDE.md rule #17 appears **well mitigated** — the `tests/unit/listeners.test.js` lint plus the `window.X` discipline in modules (`src/domains/notificaciones.js:usersCache`, `src/domains/sap-service-layer.js:sapConfigCache`, etc.) prevents accidental scope breaks.

---

## Naming inconsistencies

| Concept | Names found | Example locations | Suggested canonical |
|---------|-------------|-------------------|---------------------|
| Client display name | `clientName`, `cliente`, `clienteNombre`, `cardName`, `nombreCliente`, `customerName` | `index.html:12948, 29734, 30038`, `functions/core/planner-stage-change-core.js:299` all have the fallback chain `clientName \|\| cardName \|\| clientCardCode \|\| cardCode` | `clientName` everywhere; migrate `cardName` → `clientName` with a one-shot script. |
| Client SAP code | `cardCode`, `clientCardCode`, `clientCode` | `index.html:29734`, `functions/core/resolve-pedido-cardcode-core.js`, `functions/core/ventas-report-core.js` | `cardCode` (matches SAP native field). |
| Vendor key | `vendorKey`, `vendedor`, `ownerVendor`, `vendorCode` | `index.html:3418 (vendor key)`, `functions/core/auto-send-sap-core.js:433`, 10+ modules | `vendorKey` for the key, `ownerVendor` for the pedido-owner distinction (semantic difference — document). |
| User display | `displayName`, `userName`, `username`, `userEmail` | `functions/core/sap-sl-client.js:userName`, `functions/index.js: sl.username \|\| sl.userName (14x)`, `src/domains/notificaciones.js: displayName` | `displayName` for UI; `username`/`userName` is a SAP SL property — stop normalizing in CFs, use a single `getSapUserName(sl)` helper (Q6). |
| Warehouse code | `WarehouseCode: '11'` literal + `SALES_WAREHOUSE` constant + `whs 11` strings | 3 CF cores + 7 scripts + 13 refs in `index.html` | Shared constant `SALES_WAREHOUSE` in `functions/core/sap-constants.js` (Q7). |
| Line state | `'confirmed'`, `'BO'`, `'ASIG'`, `'pending'`, `'borrador'` | 51 inline `===` comparisons across `index.html` + CF cores | Enum module `src/shared/pedido-states.js`: `export const STATE = { CONFIRMED:'confirmed', BO:'BO', ASIG:'ASIG', ... }`. |
| Role string | `'admin' \| 'gerente' \| 'vendedor' \| 'interno' \| 'invitado' \| 'bodega' \| 'contador'` | 128 refs in `index.html`, 29 in `sap-admin-panel.js` | Enum module `src/shared/roles.js`. CLAUDE.md references this convention already. |
| Email domain gate | `@shimano.com.ar`, `@shimano.uy` string literals | 38 inline + 7 CF + 3 rendiciones | Constant `SHIMANO_DOMAINS` array. |
| Pedido line container | `lines` vs `items` (fallback pattern) | `functions/core/planner-compute-column.js:58-60` fallback for "schema histórico". CLAUDE.md feedback has a precedent (schema check). | `lines` only post-v1013. Deprecate `items` fallback with a `console.warn` + 30d sunset. |
| Short "disp" (stock disponible) | `disp`, `dispReal`, `stkD`, `stockDep11`, `stockLibre`, `stockLibreBo`, `physical` | `index.html:15368, 15433, 17725, 13608, 13861, 13950, 14133` | Pick one. Suggest `dispSales11` (dep 11 only, net of commitments). |

---

## Comment rot

| Location | Comment | Issue |
|----------|---------|-------|
| `index.html:6655` | `// v1120 ROLLBACK: DISCONTINUED_SKUS feature completo removido.` | Code block below (6658, 27090-27143) is now a no-op. Comment accurate but points at dead code. Delete both. |
| `index.html:31798` | `// Legacy body preservado como referencia — inalcanzable.` | 25 LOC of unreachable code. Preserved intentionally per CLAUDE.md #30, but should be moved to `docs/CHANGELOG-ARCHIVE-*.md` and removed from live file. |
| `index.html:6655-6658` | 4 lines of v-tag comments on 1 LOC of code | Over-detailed version history inline. |
| `src/domains/notificaciones.js:25-28` | `// KNOWN BUG (verbatim preservado): window.markAllNotifsRead está declarada 2 veces` | Comment is accurate. The fix was deferred to "E6 code review" which hasn't happened in 3+ months. |
| `src/domains/pedidos-modal.js:16-19` | Similar "KNOWN BUG preservado verbatim: doConfirmPedido…" | Partially resolved (doConfirmPedido fixed in v1172). Comment is stale — update to reflect current reality. |
| `src/main.js:177-179` | `// v1178 (2026-10-07) Perf C1: notificaciones chunk. KNOWN BUG preservado del legacy: window.markAllNotifsRead esta declarada 2 veces en el chunk; la 2da pisa a la 1ra en runtime. TODO code review consolidar.` | Fresh TODO (6 days old at audit date) that just gives up on fixing while extracting to chunk. |
| `functions/index.js:92-102` | `// v937 (2026-09-14, SecAudit Sprint 2 MED-12 VULN-301+711): redactado el valor literal de user/password que estaba en este comment` + `// user "nur" era un secret weak (4 digitos) leaked en el codigo fuente del repo publico` + `// TODO Sprint 3.` | ~11 LOC of pre-redaction security history. Historical context useful; move to AUDIT_SHIMANO or SECURITY_AUDIT. The `const SETUP_USER = 'nur'` at line 1508 is still inline though. |
| `index.html:6946-6954` | `// Invalidar tambien el cache de outlines (vive en localStorage) por si los cambios traen depts reasignados.` | Comment accurate; the cleanup code it precedes removes keys from `v4-v12`. Current users have `v16` cache. The cleanup is dead code (2+ years old users don't exist). |
| `index.html:6318-6329` | 12 LOC comment on `getStockRealmenteDisponible` saying "Deprecacion gradual: las 2 funciones viejas siguen existiendo para UI que aun no migro" | Checked grep — `getStockDisponibleVenta` has 60+ live uses. The "deprecation" is not progressing. Either kill the plan (keep both) or schedule the migration — comment is misleading. |
| `src/domains/sap-service-layer.js:5-10` | Verbatim-extraction header listing 10 methods | Accurate 2 months ago. Methods still match — OK. |
| `index.html:7832-7846` | 15 LOC comment explaining `orders` scratch pad is EN MEMORIA, `saveOrders` is no-op, consequences list | Accurate, useful. Don't rot. |
| `index.html:6305-6316` | Comment on `isPedidoSplitEnabled` says default is on since v620 | Feature flag now permanently on. Comment is accurate; the code is the one that should be inlined. |

---

## Magic numbers / strings

- **Warehouse code `'11'`:** 13 refs in `index.html`, 3 in `src/domains/sap-service-layer.js`, 2 in `functions/core/auto-confirm-pending-core.js`, 1 inline `WarehouseCode: '11'` in `auto-send-sap-core.js:203` (should be the `SALES_WAREHOUSE` constant). See Q7.
- **SAP timeouts:** `SAP_REQUEST_TIMEOUT_MS = 90_000` in `functions/core/sap-sl-client.js:40`. `SAP_LOCK_TTL_MS = 300000` in `src/domains/sap-lock-constants.js`. CF timeout `120s`. All three related numbers (lock > request-timeout < CF-timeout) are checked by a dedicated test, but there is no central doc explaining the invariant. Suggest a short comment or `functions/core/sap-constants.js` with the 3 numbers + a comment on the inequality.
- **Role strings:** `'admin' | 'gerente' | 'vendedor' | 'interno' | 'invitado' | 'bodega' | 'contador'` appear 128 times in `index.html` alone. No enum. See Naming table.
- **State strings:** `'confirmed' | 'BO' | 'ASIG' | 'pending' | 'borrador'` — 51 inline `===` comparisons. No enum.
- **`'stock-asignado-batch'`:** waitlist entry source magic string in 7 places (`index.html:15617, 18120, 6335`, `src/pure/stock-realmente-disponible.js:38, 46, 242, 320, 451`). Promote to constant `WAITLIST_SOURCE.CPST_BATCH`.
- **Email domains:** `@shimano.com.ar` + `@shimano.uy` hardcoded 38 times in `index.html`, 7 in `functions/index.js`, 3 in `rendiciones.js`. Should be a `SHIMANO_DOMAINS` config.
- **SETUP integration:** `functions/index.js:1507-1508` has `const SETUP_URL = 'https://nur-integra.setuponline.com.ar'` and `const SETUP_USER = 'nur'` hardcoded inside the CF handler. Should be in app_config/`SETUP` doc or Secret Manager (user is a shared-secret-ish identifier per CLAUDE.md security audit note).
- **setTimeout literals:** 22 inline numeric values in `index.html`: `1100`, `1500`, `2500`, `3000`, `5000`, `10000`, `15000`. Most are UX timings (toast duration, retry window). Document which are "intentional UX feel" (keep inline + comment) vs "arbitrary throttle" (promote to constant).
- **`localStorage` keys:** `'shimano_zonas_orders_v1' | 'shimano_zonas_pending_v1' | ...` — 11 distinct keys. If any key is bumped (ever), every reader must bump too. No central registry.

---

## Error handling asymmetry

- **Empty catches:** 181 silent `catch(e) {}` or `catch { }` in `index.html`, 16 in `src/domains/pedidos-modal.js`, 12 in `src/domains/sap-admin-panel.js`, 10 in `src/domains/admin-users.js`. Not all are bugs (many are legitimate "fire-and-forget" cleanups), but the volume means any ADD of a swallowing catch requires a reviewer to understand "why is this one OK?". Suggest a lightweight comment convention `catch(e){ /* intentional: localStorage access denied is fine */ }`.
- **FATECHI-class asymmetry (fixed in v1172 but check for regression):** `src/domains/sap-admin-panel.js:1055-1097` has the idempotent check. CF trigger `functions/core/auto-send-sap-core.js` has the same at ~line 400+. Client listener `src/domains/sap-auto-send-listener.js` has it. No test guarantees symmetry.
- **`sap-service-layer.js` has NO timeout** on client-side fetches, but it routes via `sapProxy` CF which does have `AbortSignal.timeout(90000)`. So client is protected transitively. Document this.
- **`findQuotationByNumAtCard` fallback:** All 3 callers wrap in `try{if (typeof sapSL.findQuotationByNumAtCard === 'function') ...}`. If method ever stops being exported, the 3 try/catches swallow it silently and the FATECHI defense evaporates. Suggest making `findQuotationByNumAtCard` always-exported (no optional), add unit test that it's a function.

---

## God functions / deep nesting

Top 15 longest functions (combined inline + bundle):

| LOC | File:Line | Name |
|-----|-----------|------|
| 771 | `src/domains/dashboard.js:283` | `renderDashboard` |
| 601 | `src/domains/master-clientes.js:1953` | `renderMasterClientesTable` |
| 565 | `index.html:12278` | `_exportLegacyFull` |
| 564 | `src/domains/exports-sap.js:68` | `exportSapReadyCsv` |
| 481 | `index.html:31057` | `window.doConfirmPedido` |
| 481 | `src/domains/pedidos-modal.js:868` | `renderReviewLines` |
| 467 | `index.html:14273` | `window.renderBackordersTab` |
| 461 | `index.html:20606` | `_renderWaitlistCard` |
| 446 | `src/domains/exports-core.js:17` | `exportMasterClientes` |
| 367 | `src/domains/rutas.js:104` | `generarRutasVendor` |
| 366 | `index.html:23351` | `window.viewPedido` |
| 358 | `index.html:10300` | `renderClients` |
| 352 | `src/domains/master-clientes.js:1120` | `renderMcProvisoriosTable` |
| 343 | `src/domains/sap-auto-send-listener.js:30` | `ensureSapAutoSendListener` |
| 311 | `src/domains/admin-users.js:482` | `openAdminPanel` |

**Deep nesting:** Minimal. Max observed is 16-space indent at `index.html:29674-29675` (inside `attachFirebaseListeners` → inside a reduce → inside a conditional). No functions exceed 5 nesting levels in the sampled hot zones. **This is a strength** — nesting discipline is tight despite function length.

**Recommended extraction order (LOC × crit path × test gap):**
1. `renderDashboard` (771 LOC) — pure render + computation + listener wiring entangled. Split into `computeDashboardMetrics` (pure, testable) + `renderDashboardDOM`.
2. `doConfirmPedido` (481 LOC) — the critical money flow. Split into validation (pure), orderNumber reservation, Firestore write, splitLines (already pure), legacy orders cleanup. Each step testable.
3. `_renderWaitlistCard` (461 LOC) + architecture audit A1 point.
4. `exportSapReadyCsv` + `exportMasterClientes` + `_exportLegacyFull` — three export flows with the same shape (collect, format, download). Shared "collect" step would retire ~400 LOC.

---

## Positive observations

- **CLAUDE.md discipline is strong.** 30 numbered rules each tied to an incident/precedent + fix. New rules (29.1-29.7 skills) show the discipline is still growing.
- **`src/pure/` is clean.** 19 modules, zero TODOs, zero empty catches, Vitest-tested, no inline duplication beyond Q3/Q4 (which are *conscious* dual-impls to avoid CF↔bundle import). CLAUDE.md #6 ("verbatim first, refactor later") is respected.
- **Functions/core wrapper split (rule #7) is consistent.** 29 core modules, all pure (import `fetch`/firestore from deps). `functions/index.js` is the thin wiring layer. Deploy risk is minimized.
- **Version provenance comments (`v600`, `v820`, `v1172 (audit 2026-10-07)`) make bisecting easy.** `git log --grep v1172` lands on 5-15 commits around 2026-10-07. This is a real asset for incident response. Keep.
- **No orphan `onclick=` handlers.** Spot-checked 10 `onclick="..."` in `index.html`; each symbol is defined somewhere (chunk stub or window assignment).
- **No top-level duplicate `var/let/const`** across inline `index.html`. The `window.X` cross-scope pattern (CLAUDE.md #13, #17) is consistently applied — one leak was caught by `tests/unit/listeners.test.js` before shipping.
- **Dual-file sync enforced by test** for `SAP_LOCK_TTL_MS` (via `tests/unit/sap-lock-ttl.test.js`). Pattern can be extended to the other dual files (Q3, Q4).
- **`functions/core/sap-sl-client.js` has defensive `AbortSignal.timeout`** with explicit fallback for Node < 22, plus explanatory comment linking to FATECHI incident. Good example of "fix + document why".
- **README.md §41 changelog is current** (bumped per CLAUDE.md rule #30 feedback).
- **Scripts folder README** categorizes active vs bootstrap vs one-shot. Convention `_<name>` is well established.
- **Error handling discipline on new CFs** — rate limit (`checkAndIncrementRateLimit`), role check, idempotency hint, cardCode scoping (v994) applied consistently in `setupGetMovimientos`, `sapProxy`, `geminiOcrProxy`.

---

## Suggested cleanup sequence

Priority list for cleanup PRs (effort estimates assume one dev + one review cycle):

1. **DELETE `markAllNotifsRead` dead def + `volverABorrador` legacy body + `DISCONTINUED_SKUS` no-op + 9 outline-cache `removeItem` calls** (Q1 + 3 dead code rows). Effort: 2 hrs. Impact: ~70 LOC + mental overhead. Risk: nil.
2. **Extract `functions/core/sap-constants.js`** with `SALES_WAREHOUSE`, `NON_SALES_WHS`, `SAP_REQUEST_TIMEOUT_MS`, `SAP_LOCK_TTL_MS`, `assertSapConfig(sl)`, `buildSapDeps(sl, password)`. Update 14 call sites in `functions/index.js` + 3 CF cores (Q6, Q7, Q9). Effort: 4 hrs. Impact: retires 20+ magic literals + closes the CLAUDE.md #24 recurrence vector.
3. **Promote planner-compute-column + rendicion-duplicate** to a single root (Q3, Q4). Effort: 3 hrs. Impact: eliminates dual-sync risk for 160 LOC of logic.
4. **Extract `build-quotation-payload` pure module** (Q2). Add Vitest snapshot test on 3-4 fixtures (confirmed-only, split BO+confirmed, dedup, legacy state). Effort: 1 day. Impact: closes a FATECHI-class vector.
5. **Replace 4 inline `normStr` lambdas with `window.normClientName`** (Q5). Effort: 2 hrs. Impact: eliminates silent address-match bug class.
6. **Create `src/shared/constants.js` + `src/shared/pedido-states.js` + `src/shared/roles.js`** (naming inconsistencies). Replace 128 role literals, 51 state literals, 38 email literals with named refs. Effort: 1-2 days (can be partial — do roles first). Impact: 300+ magic literals retired; CLAUDE.md role-based `vendedor` typos caught at compile time (with JSDoc @ts-check).
7. **Delete `isPedidoSplitEnabled` + `isE4BEnabled` feature flags** (dead code table). Inline the `true` branch. 20 LOC + 8 call-site simplifications. Effort: 3 hrs. Risk: low (just inline).
8. **Archive 22 one-shot `_<name>.{py,cjs,mjs}` scripts** to `scripts/archive/` + 2 `_adc` wrapper duplicates to `--use-adc` flags on main scripts. Effort: 2 hrs. Impact: ~1,200 LOC off the active surface.
9. **Comment rot cleanup pass:** move overly detailed version-history inline comments (DISCONTINUED_SKUS, outline cache, 24997 verbatim-extraction headers that reference removed features) to README.md §41 or CHANGELOG-ARCHIVE. Effort: 4 hrs. Impact: better signal-to-noise during code review.
10. **God function refactor pilot:** `renderDashboard` → `computeDashboardMetrics` + `renderDashboardDOM` (first). Effort: 2 days. Impact: unlocks Vitest coverage on the heaviest render. Followup PRs on `doConfirmPedido` and `_renderWaitlistCard`.

---

## Files referenced in this audit

- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\index.html`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\notificaciones.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\pedidos-modal.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\sap-admin-panel.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\sap-service-layer.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\dashboard.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\master-clientes.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\exports-sap.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\rutas.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\admin-users.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\sap-auto-send-listener.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\sap-lock-constants.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\planner\compute-column.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\pure\normalize.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\pure\duplicate.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\pure\stock-realmente-disponible.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\pure\rendicion-duplicate.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\pure\pedido-split.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\main.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\loader.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\index.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\sap-sl-client.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\auto-send-sap-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\auto-confirm-pending-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\sap-stock-recheck-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\planner-compute-column.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\rendicion-duplicate-pure.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\planner-stage-change-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\scripts\audit_backorder_overlap.py`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\scripts\audit_backorder_overlap_adc.py`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\scripts\bo_daily_audit.py`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\scripts\bo_daily_audit_dryrun_adc.py`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\scripts\README.md`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\docs\AUDIT_SHIMANO_2026-10-07.md`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\CLAUDE.md`
