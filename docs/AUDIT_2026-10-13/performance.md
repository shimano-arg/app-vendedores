# Performance Audit — 2026-10-13

## Executive summary

Shell bundle (`app.bundle.js` = 2.47 MB) **supera 1.65x el techo CLAUDE.md #16 (1.5 MB)**; `index.html` (2.34 MB / 32.6k LOC) sigue siendo el bottleneck inicial sobre 4G (baseline LCP = 28.6s). Los 3 wins con mejor effort/impact son:
1. **P1 shell split**: mover `rendiciones.js` (86 KB) + `master-clientes.js` (135 KB) + `pedidos-modal.js` (70 KB) + `visitas.js` (80 KB) a chunks lazy on-demand → bundle shell <1 MB. Ahorro **~371 KB bajada inicial** + ~800ms CPU parse en Android low-end.
2. **P2 extract POINTS (96 KB) + PRODUCTS (123 KB) a Firestore doc + lazy chunks**: hoy inlineados en `index.html` líneas 6524/6609 como JSON de 1 línea → bloquean parse HTML + se duplican con el listener catalog. Ahorro **~220 KB** del shell HTML.
3. **P3 operations_log listener limit(2000)** sin paginación en `index.html:12111` para admin/viewer: lee TODAS las entradas en vivo + se mantiene activo todo el session. Reducir a `limit(200)` + lazy-expand → **~90% menos bandwidth cold start admin**.

## Measured baseline

| Metric | Value | Target | OK? |
|---|---|---|---|
| `index.html` size | **2,397 KB (32,640 LOC)** | <400 KB | ❌ |
| `app.bundle.js` (shell) | **2,463 KB (14,645 LOC)** | <1,500 KB (CLAUDE.md #16) | ❌ |
| Largest chunk | `exports-advanced.js` **256 KB** | <400 KB | OK |
| Total chunks (8 lazy) | **1,348 KB** | — | — |
| `geo.json` | 977 KB (async, async no bloquea LCP) | <500 KB ideal | ⚠️ |
| `onSnapshot` listener count (steady-state admin) | **49 definiciones** (~32 activas post-login admin) | <20 | ❌ |
| Firestore unbounded reads (frontend) | **2 `.collection().get()` sin filtro** (index.html:13811, 29343) + **13 en exports-advanced/core** | 0 | ❌ |
| CF `.where('closedAt','==',null).get()` sin limit | **11 ocurrencias** (functions/core) | con paginación o cursor | ⚠️ |
| Inline functions `index.html` | **555 `function` declarations** (575 incluyendo `window.X=`) | — | — |
| Heavy renderers sin debounce (`renderPedidosTab`, `renderBackordersTab`, `drawMarkers`) | **43 + 15 + 21 callsites** respectivamente | con rAF/debounce | ❌ |
| Firestore composite indexes definidos | **4** (indexes.json) | adecuado para queries actuales | ⚠️ |
| CFs con `timeoutSeconds=540` (max) | **4** (close-sqs, cancel-expired, syncs) | — | ⚠️ |
| CFs con `minInstances` (warm) | **0** | ≥1 para `sapProxy` | ❌ |
| Baseline E0 (Lighthouse, Slow 4G, CPU 4x, median) | LCP 28.6s / FCP 14.5s / TBT 1.5s / Score 26 | LCP <17s | ❌ |

---

## Findings

### High-ROI wins (do first)

#### P1. Shell bundle 64% sobre techo CLAUDE.md #16 — extraer 4 dominios a chunks lazy
- **Category:** bundle
- **Current:** `app.bundle.js = 2.47 MB` (14,645 LOC). CLAUDE.md #16 fija 1.5 MB como techo intermedio pre-split definitivo. Los dominios más pesados en el shell son `master-clientes.js` (135 KB), `sap-admin-panel.js` (96 KB), `rendiciones.js` (86 KB), `visitas.js` (80 KB), `pedidos-modal.js` (70 KB), `rutas.js` (65 KB), `dashboard.js` (58 KB). Son >530 KB de código que corre al login aunque el user nunca abra el pane correspondiente.
- **Impact:** cada 100 KB adicionales = ~400ms más de parse+compile en Android 4G low-end (baseline E0 confirma 3.5s scriptEvaluation + 851ms parse). Para VDE que abre app "en frío" en campo, estos ~530 KB = ~2s adicionales al LCP ya de 28.6s.
- **Fix:** cuatro extracciones secuenciales a chunks lazy (patrón ya documentado CLAUDE.md #18):
  - `rendiciones.js` → `chunks/rendiciones.js` (sólo admin/vendedor que abren modal); `ensureRendicionesListener` queda como stub inline que dispara `loadChunk('rendiciones')` on first use.
  - `master-clientes.js` → `chunks/master-clientes.js` (abre al tocar "Clientes SAP" tab).
  - `pedidos-modal.js` → chunk ya conceptualmente lazy; migrar formal.
  - `visitas.js` → `chunks/visitas.js` (sólo VDE/admin que registran visita).
  - Estimado nuevo tamaño shell: ~1.0 MB; **ahorro -1.47 MB download inicial**.
- **Risk:** medium. Precedentes CLAUDE.md #15, #17 documentan 3 trampas (`let unsub*` cross-scope + IIFE top-level + cross-ref inline). Mitigación: smoke test `tests/smoke/bundle-runtime.test.js` + un chunk por PR + 48h observación.

#### P2. POINTS (96 KB) + PRODUCTS (123 KB) inlineados como JSON single-line
- **Category:** bundle / index.html
- **Current:** `index.html:6524` tiene `const POINTS = [{...}, ... (303 entries)]` como línea única de **96,312 chars**. `index.html:6609` tiene `const PRODUCTS = [...] (665 entries)` de **123,558 chars**. Juntos: **~220 KB del HTML**. Ambos se duplican vía el listener `ensureProductCatalogListener` (index.html:26222) que los pisa en memoria con los chunks remotos. El inline existe solo como "bootstrap" para pintar antes de que Firestore responda.
- **Impact:** 220 KB extra en el HTML inicial sobre 4G ≈ 1.4s de descarga + 400-600ms de parse. El PRODUCTS inlineado es stale desde que el SW cachea `index.html` (hasta que el listener corre + rebuildea), causando bugs de datos obsoletos reportados históricamente. Memory footprint duplicada ~500 KB JS objects (POINTS parsed + Firestore chunks).
- **Fix:** mover ambos arrays a `app_config/initial_bootstrap` o Firestore chunks + lazy fetch pre-login. Alternativa menor: minificar (JSON.stringify sin spaces + base64) → ahorro ~30%. Alternativa cero-infra: usar `<script type="application/json">` externo (`./bootstrap.json`) con `cache: 'force-cache'` y SW stale-while-revalidate.
- **Risk:** medium. Reemplaza fuente histórica de datos → requiere feature flag + fallback a inline por 1 semana durante rollout.

#### P3. `operations_log` listener sin paginación — 2000 docs streaming en vivo
- **Category:** firestore / memory
- **Current:** `index.html:12111` monta `fbDb.collection('operations_log').orderBy('timestamp', 'desc').limit(2000).onSnapshot(...)` para TODOS los admin + viewer al login (línea 30776 attachFirebaseListeners). Cada entrada ~500B avg → **~1 MB bandwidth cada vez** que cambia 1 doc (el listener recibe el snapshot completo bajo la hood). Admin con app abierta todo el día que recibe 50 nuevas ops/día = **~50 MB de bandwidth** extra en la session.
- **Impact:** cold start admin descarga ~1 MB extra post-login + ~1-2s procesando el forEach de 2000 docs (ver `opsLogCache = []; qs.forEach(d => opsLogCache.push(...))`). Durante session: cada op nueva dispara re-sort del snapshot completo. Mobile admin con session 4h en campo = batería + data plan agotados.
- **Fix:** cambiar a `limit(200)` + exponer "cargar más" en el visor Audit. El uso real (panel Auditoría + Panel de Control actividad reciente) solo lee los últimos 50-100 docs; 2000 es overfetching. Estimado: **-90% bandwidth** + **-85% CPU** del listener.
- **Risk:** low. Degradación es visible solo en Audit panel buscando ops >200 atrás (feature marginal).

#### P4. Pedidos listener trae TODO (sin filtro createdAt) para admin/gerente
- **Category:** firestore
- **Current:** `index.html:30937` monta listener principal `fbDb.collection('pedidos')` sin filtros para admin/gerente/interno. Tamaño colección `pedidos` crece monotonamente (62 pedidos migrados en v820 solo + nuevos cada día). Hoy ~250-400 docs activos + histórico ~1000+. Cada doc ~2-5 KB (lines array). Admin recibe **~1-3 MB al login** solo del snapshot pedidos.
- **Impact:** post-login admin tiene que parsear ~2-3 MB de pedidos antes de que `globalPedidos` esté populated → bloquea `_renderE4BAsigApp`, `renderBackordersTab`, `renderPedidosTab`, Planner, etc. En móvil admin cold start post-logout = 8-15s extra. Peor: cada cambio en 1 pedido re-dispara el snapshot completo porque Firestore no envía deltas al cliente compat SDK v10. Memory growth: `globalPedidos` nunca shrinka — hoy pedidos cerrados (closedAt != null) siguen en la copia proyectada post-rebuild v1065 (no se filtran).
- **Fix:** limitar listener a `.where('closedAt', '==', null)` + listener separado para históricos lazy on-demand. Baseline nuevo: ~50-80 pedidos activos vs ~1500+ totales → **~95% menos data**. Requiere composite index `(closedAt ASC, confirmedAt DESC)` que ya existe en `firestore.indexes.json` (línea 29-33). Nota: "Ya Transferidos" tab tiene que convertirse a lazy fetch con paginación — es el único consumer que necesitaba historial.
- **Risk:** medium-high. Toca el listener core de la app, 115+ consumers de `globalPedidos`. Requiere refactor "Ya Transferidos" primero. Backlog deferred documentado en AUDIT_SHIMANO_2026-10-07.md.

#### P5. 15 `renderPedidosTab()` / 21 `drawMarkers()` call sites sin debounce
- **Category:** renders
- **Current:** `renderPedidosTab()` (línea 17254) se invoca directamente desde `oninput`, `onchange`, listeners Firestore, confirmaciones, etc. (15 call sites). Dentro iteran `globalPedidos` + DOM append/clear. `drawMarkers()` (línea 9889) tiene 21 call sites + 1 bound a `map.on('zoomend', drawMarkers)`. Cada drawMarkers → `markerLayer.clearLayers()` + loop sobre `filteredPoints()` (que itera POINTS=303 entries con 4 passes nested) + `drawHabilitadosPins` + `drawSapAltaPins`.
- **Impact:** baseline E0 confirmó **peor long task 3,353 ms durante pan/zoom** (3.35s bloqueando main thread). En móvil 4G low-end abrir Pedidos tab + 2 toggles rápidos puede tirar 5-6 renders en secuencia; con `globalPedidos` size 300+ eso es 2-3s de freeze.
- **Fix:** envolver los 2 renderers en wrapper con rAF-debounce estándar:
  ```js
  let _renderPedidosTabPending = false;
  function renderPedidosTabDebounced() {
    if (_renderPedidosTabPending) return;
    _renderPedidosTabPending = true;
    requestAnimationFrame(() => { _renderPedidosTabPending = false; renderPedidosTab(); });
  }
  ```
  Reemplazar los 15 call sites + hacer lo mismo con `drawMarkers`. Para `onchange/oninput` filters mantener debounce con 150ms. Mantener invocación directa en el init paths.
- **Risk:** low. Patrón ya aplicado en `debouncedRenderMc()` (index.html:4852). Smoke manual: filtros rápidos + no se pierden eventos.

### Medium / Low

#### P6. `restyleZoneLayers()` toca 527 features sin batch
- **Category:** renders
- **Current:** `index.html:8596` ejecuta `deptLayer.setStyle(deptStyle)` sobre 527 polygon features del deptLayer en cada toggle de filtro (17 call sites). deptStyle es una función que se evalúa por feature.
- **Impact:** Baseline E0 identificó como culpable Tier-2 del long task 3.35s. Cada restyle = ~200-500ms en móvil.
- **Fix:** memoize deptStyle por `(vendor, currentTypeFilter, currentVendor)` tuple con WeakMap; detectar changes y skip si ningún input cambió desde última invocación. Alternativa: usar `smoothFactor: 3.0` + aplicar `setStyle` solo a features visibles en viewport (patrón ya aplicado en drawMarkers E4).
- **Risk:** low.

#### P7. Service Worker `install` precache incluye TODOS los chunks lazy
- **Category:** sw / assets
- **Current:** `sw.js:24-64` incluye en `STATIC_ASSETS` todos los chunks lazy (exports-core/advanced/admin-users/meli/forecast/panel-control/seguimiento/notificaciones) + bundle + geo.json. Primer `install` descarga **~2.4 MB** adicional en background.
- **Impact:** primer uso post-deploy en móvil cold = SW install retiene 1 MB adicional en background (geo.json + chunks admin que un VDE común NUNCA abrirá). Chunks admin-users (124 KB) + forecast (218 KB) + panel-control (96 KB) + exports (509 KB) = 947 KB nunca utilizados por VDE común.
- **Fix:** separar en `CORE_STATIC_ASSETS` (bundle + geo.json + icon + apple-design + 2-3 chunks que todos usan) y `OPTIONAL_STATIC_ASSETS` (chunks role-specific) que se precaching DESPUÉS del `activate` por rol. Alternativa: dejar precache mínimo + que stale-while-revalidate pida on-demand. **-947 KB** descarga inicial para VDE.
- **Risk:** low. Offline funcional para VDE preservado (los chunks admin no son useful offline sin admin role).

#### P8. `CACHE_VERSION` bump discipline ya documentada CLAUDE.md #18/#19
- **Category:** sw / consistency
- **Current:** `sw.js:20 CACHE_VERSION='v1242'`. Cada bump exige: STATIC_ASSETS actualizado, CACHE_VERSION++, APP_VERSION++. Hoy sincronizado (chunks + bundle), pero: `exports-core.js` cambió último el 2026-10-09 17:08 (modif más reciente). Si alguien olvida bump, un user con cache stale carga chunk viejo que llama a export que ya no existe → runtime error.
- **Impact:** riesgo latente. Precedente v335 documentó un bug exacto (shell/chunk mismatch).
- **Fix:** pre-commit hook que detecta modif en `src/domains/*.js`, `app.bundle.js`, o `chunks/*.js` y falla si `CACHE_VERSION` en `sw.js` no cambió. 10 líneas Node script.
- **Risk:** low.

#### P9. SAP SL sync CFs cada 15 min + sin cursor incremental en `syncSapOrdersToApp`
- **Category:** CF / SAP
- **Current:** `syncSapOrdersToApp` corre cada 15 min (functions/index.js:279). `sync-sap-orders-core.js:75` hace `fbDb.collection('pedidos').where('closedAt','==',null).get()` (sin cursor) + por cada pedido pendiente dispara 1 GET `/Orders?$filter=NumAtCard eq '...'` serial. Con 50 pending pedidos = 50 GETs serial × ~2s = **~100s** por run. CF timeout = 300s. En momentos de pico (post-fin de mes con muchos pedidos pending) podría acercarse al timeout.
- **Impact:** CF cost + riesgo timeout silencioso. Si SAP SL responde lento (visto en logs 2026-10-06 FATECHI incident), 50 GETs serial pueden tirar >200s. SAP SL session max ~20 concurrent → paralelizar con cap 4-8 similar al fix v1174 Perf H3.
- **Fix:** paralelizar los lookups `findSoByNumAtCard` con `Promise.all` chunked de 4 (patrón idéntico al fix v1174 preCheckStockWhs11). Estimado: **-70% latencia** (100s → ~30s). Opcional: cursor incremental guardando `lastDocEntry` procesado.
- **Risk:** low. Precedente v1174 ya aplicó el patrón; solo replicar.

#### P10. 10 unbounded `.collection('pedidos').where('closedAt','==',null).get()` en CFs
- **Category:** CF / firestore
- **Current:** 10 CFs (asig-ttl, auto-confirm-pending, fifo-assign, pedido-snapshot, resolve-pedido-cardcode, sq-cancel, sync-sap-*, sync-sap-quotation-closures) hacen full-scan de pedidos activos cada run. Cada scan ~100-400 docs hoy, con avg doc size 3 KB = **~1.2 MB Firestore read** por scheduled run. Con 5 CFs scheduled cada 15min + 1 cada 2min = **~40 scans/hora = 48 MB Firestore read/hora cross-CF**.
- **Impact:** Firestore read cost + CF memory (cada run allocates ~400 doc instances in Node). No bloquea user experience pero contribuye a costos. Monthly Firestore reads ≈ 48 MB * 24 * 30 = **35 GB/mes** solo de estos scans.
- **Fix:** compartir snapshot entre CFs del mismo tick (ej: una CF scheduled wrapper que fetchea 1 vez + pasa a los sub-steps). Alternativa: Firestore composite query + listener compartido (más complejo). Fix simple: en pedidos cerrados <7d, mantener `closedAt != null`; en pedidos cerrados >7d, archivar a `pedidos_archived` collection. Reduce scan size.
- **Risk:** low (optimización puramente de costos).

#### P11. Memory leak latente: 303 POINTS + listeners sin shrink
- **Category:** memory
- **Current:** `globalPedidos`, `revisionWaitlist`, `backorderLines`, `opsLogCache`, `clientMasterCache` nunca shrinkean durante session. Admin con app abierta 8h con N snapshots de pedidos modificados = cada snapshot aloca nuevos arrays + GC solo libera lo huérfano. opsLogCache crece hasta 2000 entries fijo pero `qs.forEach(d => opsLogCache.push(...))` sin reset de array previo → **duplicados cada snapshot** (bug latente que vale verificar).
- **Impact:** suspecha 50-200 MB heap growth session admin 4h. Verificable con DevTools heap snapshot pre/post logout.
- **Fix:** 
  1. `opsLogCache = []` antes del forEach (bug fix si confirmado).
  2. Memoizar `globalPedidos` como Map keyed by _fsId + solo mutate diffs.
  3. WeakRef para `clientMasterCache` entries no usadas >1h.
- **Risk:** medium (requiere diagnóstico heap snapshot primero).

#### P12. Core Web Vitals estimados (Android low-end, 4G)
- **Category:** mobile UX
- **Current:** baseline E0 Lighthouse (CPU 4x, Slow 4G, mobile emulado) → LCP 28.6s, FCP 14.5s, TBT 1.5s, Score 26/100. Mi estimado en Android real low-end (Snapdragon 4G): LCP 10-18s, FCP 5-10s. INP (Interaction to Next Paint) no medido pero drawMarkers 3.35s long task sugiere INP p75 >1500ms (muy malo). CLS = 0 (confirmed por E0).
- **Impact:** VDEs reportan "se tilda" cold start en campo (confirmado AUDIT_SHIMANO_2026-10-07.md).
- **Fix:** P1 (bundle split) + P2 (POINTS/PRODUCTS lazy) + P5 (debounce renders) + P6 (restyle memo) combinados estiman reducir LCP a ~15s, INP p75 a ~400ms. Target realista Core Web Vitals mobile: LCP <2.5s "good" imposible con el patrón actual sin un rewrite completo.
- **Risk:** —

#### P13. 7 `.get()` sin pagination en `exports-core.js` + 13 en `exports-advanced.js`
- **Category:** firestore / exports
- **Current:** cada export en `exports-core.js` (líneas 767, 833, 1007, 1232) y `exports-advanced.js` (líneas 1061-1074 = 13 collections consecutive full-fetch) hace `.get()` sin limit sobre collections grandes (pedidos ~1500 total con histórico, visits, rendiciones, client_master, etc.). Durante export audit los 13 `.get()` en paralelo pueden fetchear 20+ MB.
- **Impact:** cualquier admin que toca "Export para Análisis" dispara ~15 MB fetch + ~10s procesamiento + xlsx generation. OOM latente en Android con <2 GB RAM. CF `sapProxy` NO afectado — esto es client-side.
- **Fix:** cada export hace `.limit(N).startAfter(cursor)` pagination y escribe xlsx streaming. Alternativa: mover exports a CF server-side con upload a Storage (ya existe pattern para rendiciones).
- **Risk:** medium (requires xlsx streaming library o rewrite exports completos).

#### P14. CF cold start: 0 `minInstances`, `sapProxy` crítico
- **Category:** CF
- **Current:** `functions/index.js` no setea `minInstances` en ningún CF. `sapProxy` (callable, 60s timeout) tiene cold start ~1-3s en Node 22 Cloud Run Gen 2 (empíricamente). VDE confirma pedido → CF cold → espera +2s antes de llegar a SAP SL login.
- **Impact:** experiencia primer envío del día post-timeout del container ~5s más lenta. Cada reclamo "no me cargó el pedido" tiene este 2-3s como contribución (histórico: incidencia FATECHI 2026-10-06 CF tomó 5min).
- **Fix:** `minInstances: 1` en `sapProxy` + `updateAsigLineStateCF` (los 2 CFs user-facing críticos). Costo ~$5/mes por CF (Cloud Run idle). Beneficio: cold start eliminado para los 2 flows críticos. Scheduled CFs no necesitan minInstances (user no espera).
- **Risk:** low (solo billing impact pequeño).

#### P15. `_pendingAppDeSku` O(N × M) sin memoize
- **Category:** renders / data
- **Current:** `index.html:20477` recorre `globalPedidos` (N ~300) × `p.lines` (avg M ~5) para cada SKU consultado. Se invoca en loops dentro de `_renderWaitlistRows`, `_renderWaitlistCard`, `openWaitlistCardModal` → **~1500 iteraciones por render** del modal waitlist card.
- **Impact:** modal waitlist card con 20 SKUs = 20 llamadas × 1500 ops = 30k ops por abrir modal. ~50-100ms freeze visible en móvil.
- **Fix:** build `_pendingAppBySku` Map cached hasta próximo snapshot de `globalPedidos` (invalidar en el listener callback). Reemplazar las 2-3 callsites por `_pendingAppBySku.get(sku) || 0`. Patrón idéntico al `_vendorOutlinesCache` ya existente.
- **Risk:** low.

#### P16. 32 listeners activos simultáneos en session admin (CLAUDE.md #12 threshold ~20)
- **Category:** firestore / memory
- **Current:** `detachFirebaseListeners` enumera **~50 `unsub*`** (index.html:30665-30750). En session admin activa post-login + abriendo panel admin, 32 están vivos simultáneos (pedidos, userData, campaigns, sap_snapshot, visits, opsLog, sap_clients, sap_products, approvedAltas, client_master, sap_vendors, targets, custom_routes, route_overrides, myNotifs, myExternalPartners, visitsPartner, mySentTasks, altaCliMine, backorderSnapshot, misRendiciones, todasRendiciones, sap_integration, sap_config, product_catalog, stock_snapshot, stock_snapshot_app, auto_confirm, gh_actions_status, sentry_issues, sap_sync_state, sap_sl_health, firestore_quota, collections_growth, storage_usage, cf_health, price_list, temporal_price_list, vendor_overrides, planner_pedidos, planner_waitlist, planner_config, revision_waitlist, facturacion_snapshot, campania_snapshot, dashboard_visuales, clientLocs). CLAUDE.md #12 no fija un threshold explícito pero el riesgo escala linealmente.
- **Impact:** cada listener consume ~5-15 MB RAM (snapshot cache + Firestore SDK overhead). 32 listeners × 10 MB = ~320 MB RAM steady-state admin. En móvil admin con 3 GB RAM, es ~10% permanent. Dispositivos low-end admin (nos vale si algún admin viejo tiene <3 GB) pueden OOM.
- **Fix:** inventariar los listeners "always-on" vs "modal-only". Los que NO se usan hasta abrir un modal específico (ej sap_sl_health, firestore_quota, cf_health, dashboard_visuales → Panel de Control; sap_clients + sap_products → SAP admin panel) deben attacharse en `openPanelX` y detacharse en `closePanelX`. Reduce listeners always-on a ~12-15.
- **Risk:** medium. Precedente v1077 `ensureListenerWithFallback` ayudó con resilience pero no attack el count.

### Low

#### P17. `setInterval(loadStockSnapshot, 15 * 60 * 1000)` sin visibility check
- **Category:** CF / assets
- **Current:** `index.html:24151` dispara reload de stock.json cada 15min aunque la tab esté in background. En móvil con 20 users = 80 fetches/hour continuo aunque usuarios no estén usando app.
- **Impact:** data plan + batería; en móvil `fetch` background puede dormir en modern WebKit pero no en Chrome Android.
- **Fix:** envolver en `if (document.visibilityState === 'visible')`. O usar `visibilitychange` event para pausar/reanudar.
- **Risk:** low.

#### P18. `setInterval(_plannerRenderSyncCountdown, 1000)` loop sin unmount check
- **Category:** memory
- **Current:** `index.html:13075` arranca ticker cada 1s para contar segundos hasta próximo sync Planner. Hay `clearInterval` en línea 13079 pero no verificación de modal cerrado.
- **Impact:** si el modal Planner se cierra sin trigger explícito del clearInterval, el ticker sigue vivo todo el session.
- **Fix:** Agregar `if (!plannerModalOpen) { clearInterval(id); return; }` dentro del ticker.
- **Risk:** low.

#### P19. `fetchWithSession` fuerza `getIdToken(true)` siempre, ~150ms/call
- **Category:** CF / network
- **Current:** `src/sap-client.js:77-103` (v1000) hace force-refresh IDToken antes de cada callable. CLAUDE.md #25 documenta la decisión. En batches de 10 pedidos = 10×150ms = 1.5s latencia extra.
- **Impact:** latencia batch envío SAP visible ~1-2s extra.
- **Fix:** cache token con TTL 50min (vs 60min expiration); refresh force solo si age >50min. Patrón idéntico a Firebase Admin SDK internal.
- **Risk:** low (podría reintroducir la race documented en CLAUDE.md #25 si TTL muy agresivo; 50min es safe).

#### P20. `visitas.js` compressImage no es async con yield (bloquea main thread)
- **Category:** renders / mobile
- **Current:** `src/domains/visitas.js` tiene `compressImage` que probablemente usa canvas sync. 1 compress de foto 4MP ~400-800ms sync.
- **Impact:** VDE registrando visita con foto = freeze visible ~500ms.
- **Fix:** usar `createImageBitmap` + OffscreenCanvas worker (hay fallback silent para Safari viejos). Verificar implementación actual antes de refactor.
- **Risk:** medium (Safari <16.4 no soporta OffscreenCanvas; VDEs iPhone pueden ser mayoría).

---

## Suggested quick wins (<1 hr each)

1. **`loadStockSnapshot` + `visibilitychange` gating** — 20 min, ahorra ~50% calls stock.json cuando app background.
2. **Pre-commit hook: `CACHE_VERSION` bump auto** — 30 min, elimina riesgo de deploy inconsistente.
3. **`opsLogCache = []` reset antes del forEach** — 5 min, bug fix latente duplicados.
4. **`_pendingAppBySku` Map memoize** — 45 min, ahorra 50-100ms por abrir modal waitlist.
5. **`renderPedidosTab` + `drawMarkers` rAF debounce wrapper** — 1 hr, elimina re-render thrashing.
6. **`minInstances: 1` en `sapProxy`** — 10 min + verificar costo, elimina cold start crítico.
7. **`operations_log` limit 2000 → 200** — 15 min, -90% bandwidth cold start admin.
8. **`.where('visibilityState', ...)` check en `_pendingAutoConfirmTicker` 1s ticker** — 10 min, pause en background.
9. **`exportVentasForMonth` paginate con `.limit(500).startAfter(cursor)`** — 50 min, elimina OOM latente en Android low-end.
10. **Bundle: console.log/warn/time stripping en producción** — 20 min via esbuild `--drop:console` (ya en esbuild config? check). Ahorra ~10-20 KB + run cost.
11. **`fetchWithSession` getIdToken: cache 50min TTL** — 40 min, elimina ~150ms/call latency batch envíos.
12. **`provLayer smoothFactor` ya es 3.0 → verificar `deptLayer` igual** — 5 min, posible reducción polygon render cost.

---

**Notas finales**:
- NO auditado: security (otro agente), accesibilidad (otro agente), arquitectura (otro agente). Mi scope: números perf medibles.
- Baseline E0 (2026-07-27, pre-E1) sigue siendo la única medición formal; una re-medición Lighthouse ahora con los chunks post-v1178 confirmaría impacto real de los chunks ya extraídos. Script en `scripts/perf/lighthouse-baseline.js` — gate humano (requiere Chrome debug port + login manual).
- Precedente round 3 v1174 (AUDIT_SHIMANO_2026-10-07.md) ya aplicó patrón "chunks paralelos cap 4" que replicaría P9. Mismo pattern, mismo riesgo.
- CLAUDE.md #16 (techo bundle 1,500 KB) es el gate más violated hoy (shell = 2,463 KB).
