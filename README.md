# Shimano App Vendedores — Documentación técnica completa

> ⚠️ **REGLA DURA PARA CLAUDE / IA COLABORADORA** ⚠️
> **Después de CUALQUIER cambio en `index.html`, `sw.js` u otro archivo del repo, ACTUALIZAR ESTE README.md en la misma tanda de commits.** El README es la fuente de verdad viva del proyecto: si un cambio no queda reflejado acá (nueva sección, campo Firestore, botón, función, versión, etc), se considera trabajo incompleto. Bumpear también `APP_VERSION` / `CACHE_VERSION` y la fila "Versión actual" en la tabla de abajo. Nunca hacer `git push` sin haber tocado el README si el cambio es visible al usuario o al modelo de datos.

App web para el equipo comercial de **Shimano Argentina** durante la transición de Baraldo (distribuidor histórico) a venta directa. Cubre todo el ciclo: gestión territorial por zona, alta de clientes, visitas con GPS, armado de pedidos, rendiciones de gastos con OCR de tickets, rutas optimizadas, tareas entre usuarios, integración con SAP B1 (DTW manual + Service Layer directo), backup total y reasignación de zonas.

| | |
|---|---|
| **URL pública** | https://shimano-arg.github.io/app-vendedores/ |
| **Repo** | https://github.com/shimano-arg/app-vendedores |
| **Firebase project** | `app-vendedores-shimano` |
| **Admin bootstrap** | `bot.shimano.pesca@gmail.com` (auto-elevación al primer login) |
| **Admin backup** | `erbinomariano@gmail.com` (Mariano Erbino) |
| **SAP Service Layer URL** | `https://shimano-sap.seidor.com.ar:50000` |
| **SAP CompanyDB PROD** | `SHIMANO_SAU` |
| **SAP CompanyDB TEST** | `SHIMANO_TST_06` |
| **Stack** | HTML5 + Vanilla JS + Firebase Firestore + Gemini API (OCR) |
| **Build pipeline** | Python (openpyxl) genera el HTML autosuficiente desde Excels master |
| **Versión actual** | SW v396 |
| **APP_VERSION** | `v396` (sincronizada con `sw.js` CACHE_VERSION; banner en console al arrucar + chequeo HTML vs SW). **Bloque 2026-08-04 tarde/noche** (v390→v396 + vistas `v_ofertas_lineas` + `v_conversion_leads_mensual`): v396 = **3 botones ESTADO en el modal Alta SAP para marcar follow-up de LEADs**. Pedido de Mariano 2026-08-04 tarde: al tocar la card de un LEAD (sin CardCode) en el sidebar CLIENTES, el modal "Alta SAP" ahora muestra un bloque nuevo "Estado del LEAD" con 3 botones apilados: (a) **✅ CONTACTADO - ENVIÓ DOCUMENTACIÓN** (verde `#16a34a`, estado `contactado_con_doc`) — próximo a convertirse en alta SAP; (b) **⏳ CONTACTADO - SIN DOCUMENTACIÓN AÚN** (ámbar `#f59e0b`, estado `contactado_sin_doc`) — hubo contacto pero pendiente de recibir papeles; (c) **🗑️ LEAD PARA ELIMINAR** (rojo `#dc2626`, estado `eliminar`, con confirm nativo) — cliente descartado. Al tocar cualquiera se persiste `leadEstado + leadEstadoAt + leadEstadoBy` en `client_applications/{fsId}`, se muestra el `showSyncTag` con el label del estado, y se cierra el modal. Si ya hay estado previo el modal lo muestra al abrir como "Actual: X" con el color correspondiente. Sub-effect: cada card LEAD del sidebar CLIENTES ahora renderiza un badge extra al lado de "⚡ LEAD" con el label del estado marcado (verde/ámbar/rojo). Solo aparece en LEADs sin `cardCodeSap` (los clientes ya SAP no lo ven). Diccionarios globales `window.LEAD_ESTADO_LABELS` + `window.LEAD_ESTADO_COLORS` para consistencia visual. Firestore rules `firestore.rules` extendidas: los vendedores (reader no admin/gerente/interno) ahora pueden updatear SOLO los 4 campos `[leadEstado, leadEstadoAt, leadEstadoBy, updatedAt]` en cualquier doc `client_applications/{id}` — sin afectar la restricción existente sobre todos los demás campos (que sigue admin/gerente/interno only). ⚠️ Requiere deploy manual: `firebase deploy --only firestore:rules --project shimano-app-vendedores` — hasta que se ejecute, los vendedores verán `permission-denied` al tocar los botones (admin/gerente/interno funcionan normal). v395 = **Fix cards superiores del sidebar CLIENTES no cambiaban al tocar sub-filtros TODOS/CLIENTE EN SAP/LEADS**. Reporte de Mariano 2026-08-04 (post-v394): al tocar los botones del panel de clientes las 4 cards del stat-box (LOCALIDADES / CLIENTES EN SAP / LEADS / TIENDAS) quedaban fijas con los totales globales aunque el listado debajo sí filtraba (capturas comparativas confirman `111 / 179 / 134 / 180` idéntico en TODOS y en CLIENTE EN SAP mientras el "N / N habilitados" cambiaba de `179 / 180` a `46 / 46`). Causa: `updateStats()` ignoraba `clientStateFilter` — solo consideraba filtros globales (vendor / provincia / localidad / tipo). Además `setClientStateFilter()` no llamaba a `updateStats()`. Fix en `index.html`: (a) `updateStats` lee `clientStateFilter` al arrancar; (b) loop POINTS acumula `habEnPt` / `pendEnPt` locales y suma solo lo que corresponde al sub-filtro (0 en habilitados si filter='pendientes', 0 en pendientes si filter='confirmados'); (c) loop SAP altas huérfanas aplica el mismo skip antes de contar `total++`; (d) LOCALIDADES con sub-filtro activo usa `locsConTiendas + sapLocs.size` (solo localidades con al menos una tienda del tipo seleccionado); (e) LEADS card = 0 cuando filter='confirmados'. Además `setClientStateFilter()` ahora llama a `updateStats(filteredPoints())` al final. Comportamiento resultante: TODOS mantiene totales globales; CLIENTE EN SAP → LOCALIDADES/TIENDAS bajan al subset habilitado + LEADS=0; LEADS → LOCALIDADES/TIENDAS bajan al subset pendiente + CLIENTES EN SAP=0. Sin cambios en `renderClients()` ni `updateContactSummary()`. v394 = **Fix contador card "Clientes en SAP" no matcheaba con el tab** — bug reportado por Federico/Mariano: card mostraba 106 (o 687 en captura anterior) mientras el tab del sidebar mostraba 51. Causa: v393 había cambiado a `isSapConfirmed()` que cuenta todos los POINTS con CardCode en `client_master`, pero el tab usa `contacted.has(k)` (solo los marcados manualmente con checkbox verde legacy). Revert de v393: `updateStats()` vuelve a usar `contacted.has(kC) || contacted.has(kP)` para consistencia con `updateContactSummary()`. Ambos ahora muestran el mismo número (POINTS marcados manualmente + altas SAP con geo+addr). v393 = intento fallido (cambió a `isSapConfirmed`, revertido en v394). v392 = **Rename label "HABILITADOS" → "CLIENTES EN SAP"** en las 2 stat-boxes del sidebar (mobile header + desktop sidebar). Cambio cosmético sin lógica. v391 = **Remover 3 cards del Dashboard que mostraban $0**: (1) "Mes en curso · pedidos de la app", (2) "Acumulado anual · pedidos de la app", (3) "Target Jul-Dic 2026 · Segundo semestre". Motivación: en la transición Baraldo→venta directa la mayoría de los pedidos van directo a SAP y no via la app → esas cards siempre marcaban $0. Se mantienen las cards SAP (con data real de BQ) + Campañas activas. v390 = **Fix dedupe automático ItemCode en payload SAP (error 23105 "Uno o más artículos se repiten")**. Reporte 2026-08-04 post-v389: fallo el envío del pedido SANDOVAL a SAP porque el vendedor había cargado `SLXC70HASA` 2 veces en el mismo pedido (SAP rechaza líneas duplicadas del mismo SKU). REBORN SRL con 3 duplicados. Fix en `src/domains/sap-service-layer.js` `buildQuotationPayload()`: dedupe automático agrupando por ItemCode y sumando Quantities antes de enviar. Mantiene el importe total idéntico. **Vista BQ nueva `v_ofertas_lineas` (2026-08-04)**: total de Sales Quotations (Ofertas de Venta) — lo pedido por el vendedor sin importar stock. Alineada 1:1 con `v_ventas_lineas` y `v_remitos_lineas`, aplica prorrateo del `total_discount` de cabecera (fix v388.1). Snapshot julio 2026 pesca: **$557.42M** ofertas vs $254.79M facturado = **~$302M no convertidos** (stock/rechazo/pendiente). Ver §40 subsección "Vista TOTAL / Ofertas de Venta". v389 = **Fix pedidos rechazados por SAP con error "Value in Discount field is greater than permitted"** (10000724). Reporte 2026-08-04: pedido de SANDOVAL con 4% de descuento cargado por Pablo era rechazado por SAP. Investigación via probe workflow: el user SAP `APP_VENDEDORES` con el que la app se autentica en SL tiene `MaxDiscountSales` no configurado (default 0%). SAP rechaza cualquier `DiscountPercent > 0`. Fix en `src/domains/sap-service-layer.js` `buildQuotationPayload()`: (a) siempre envía `DiscountPercent: 0` (no importa lo que puso el vendedor); (b) agrega `| DESCUENTO SOLICITADO: X%` al final del campo `Comments` de la Oferta para que Santi/Admin lo vea al aprobar y lo aplique manualmente con sus permisos superuser; (c) el `discountPct` sigue persistiendo en Firestore para trazabilidad. Alternativa arquitectural NO elegida (queda como TODO futuro): pedir a Santi (SEIDOR) que suba `MaxDiscount` del user `APP_VENDEDORES` a 100% en SAP — permite volver a enviar el descuento en el header directamente y evita el paso manual de Santi. Tests 168 unit + 25 smoke = 193/193 verdes. Bundle regenerado. v388 = **Fix urgente Federico: visita con 8+ fotos excedía el límite Firestore de 1 MB por doc**. Reporte 2026-08-04: al submitear una visita con las 8 fotos de ESPACIO + FRENTE, Firestore rechazaba con `Document ... cannot be written because its size (1,637,113 bytes) exceeds the maximum allowed size of 1,048,576 bytes`. Causa: la compresión previa (`compressImage(f, 800, 0.7)` para ESPACIO + `(f, 1000, 0.75)` para FRENTE) dejaba fotos de ~180 KB base64 → 9 fotos = ~1.6 MB > 1 MB límite hard de Firestore. Fix en `src/domains/visitas.js`: (a) ESPACIO comprime más agresivo a `500 px / quality 0.5` (~60 KB por foto → 8 × 60 = 480 KB); (b) FRENTE a `700 px / quality 0.6` (~100 KB); (c) guard pre-submit en `submitVisita()` que calcula `new Blob([JSON.stringify(data)]).size` y si excede 950 KB (margen 100 KB para overhead JSON + metadata Firestore) muestra alert claro pidiendo borrar alguna foto en vez de fallar con error opaco. Total esperado post-fix: 9 fotos × ~65 KB ≈ 580 KB, entra cómodo. Trade-off: fotos un poco más chicas visualmente (500 px de ancho en vez de 800). Fix definitivo pendiente: migrar fotos a Firebase Storage con URL en el doc (mismo patrón que `fotoTicketUrl` de rendiciones) — no bloqueante para hoy. Tests 168 unit + 25 smoke = 193/193 verdes. Bundle regenerado: 2.56 MB total. v387 = **Renombrar "Provisorio(s)" → "Leads/LEAD" en el sidebar CLIENTES + badges de cards + popups del mapa + modal Zonas**. Pedido de Mariano: consistencia terminológica con el KPI "LEADS" del header (renombrado en v386). Cambios en `index.html`: (a) botón filtro sidebar CLIENTES `Provisorios` → `Leads` (L2949); (b) badge popup del mapa `⚡ PROVISORIO (cargar a SAP manual)` → `⚡ LEAD (cargar a SAP manual)` (L5483); (c) badge inline de las cards del sidebar CLIENTES `⚡ PROVISORIO` → `⚡ LEAD` (L6465); (d) badge del modal Zonas para altas SAP `⚡ PROVISORIO` → `⚡ LEAD` (L13528). **NO se cambian**: el botón "👤 Provisorios" del Master Clientes admin panel (L2673) que es para admin/gerente y usa la definición canónica de v292; el tipo interno `PROVISORIO` (L6843) que es un valor de exportación de datos usado en exports/downstream (cambiar rompería consumidores del export). Sin cambios de lógica ni de datos — solo textos visibles. Sin cambios al bundle. v386 = **Renombrar sidebar "Pendientes" → "LEADS" + fix contador que ignoraba filtros de zona/provincia/localidad**. Bug reportado por Mariano: al cambiar el dropdown de zona (Z4 Martin, Z2 Federico, etc.), 3 de 4 stat-boxes del sidebar se actualizaban (Localidades, Habilitados, Tiendas) pero **PENDIENTES quedaba siempre en 379** — sin importar la zona seleccionada. Causa: en v292 (2026-07-13) el cálculo se había cambiado a `getProvisoriosList().length` (total GLOBAL) para que coincidiera con el badge "Provisorios" del Master Clientes; el efecto colateral era que el contador del sidebar principal ignoraba los filtros. Fix en `updateStats()` de `index.html` (~L6167): (a) label renombrado "Pendientes" → "Leads" en las 2 copias de la stats-bar (header + sidebar) con clase `js-stat-p`; (b) `_provisoriosCount` ahora filtra por vendor (`getEffectiveVendorSet(currentVendor)`) + provincia (`currentProvince`) + localidad (`currentLocality`) con el mismo criterio que el bloque `sapLocs` de más arriba (altas sin `assignedVendor` cuentan en todos los filtros — comportamiento estándar). El badge "Provisorios" del Master Clientes (`updateMcProvisorioCount` en `src/domains/master-clientes.js:123`) sigue usando `getProvisoriosList().length` sin cambio → sigue mostrando el total global, que es lo que ese contexto necesita. Sin cambios al bundle (`updateStats` vive en el inline HTML, no en el bundle). v385 = **Fix export Visitas → incluye Contactos con columnas nuevas (Interaccion, Forma Contacto, Resultado Contacto)**. Bug reportado por Mariano: al exportar la opción "Visitas" del modal "Que queres exportar?", en el Excel resultante los contactos no presenciales (WhatsApp/Tel/SMS de v304+/v365) NO se distinguían de las visitas presenciales — la única columna "Tipo Contacto" leía un campo legacy inexistente (`v.tipoContacto`) y todas las filas terminaban diciendo "Presencial". Los contactos SÍ estaban en el Excel (misma colección Firestore `visits`, mismo filtro por `mes`/`anio`), solo que eran indistinguibles visualmente. Fix en `src/domains/exports-core.js` `exportVisitasForMonth()`: (a) sheet renombrado "Visitas" → "Visitas y Contactos"; (b) columna "Tipo Contacto" reemplazada por 3 columnas nuevas: **Interaccion** (Visita/Contacto derivada de `v.interactionType`), **Forma Contacto** (`Presencial` para visitas, `LLAMADA TELEFONICA`/`MENSAJE DE WHATSAPP`/`MENSAJE SMS` para contactos leyendo `v.formaContacto`, o `Sin especificar` si el campo está vacío), **Resultado Contacto** (para contactos: `Respondio`/`No respondio`/`Sin marcar` leyendo `v.contactoResultado` de v365; vacío para visitas); (c) sync tag y filename actualizados: "Generando Excel: N visitas + M contactos..." + "Export listo: N visitas + M contactos"; (d) UI del modal exportar (`index.html` L1750-1755) actualizada: card renombrada "Visitas" → "Visitas y Contactos" con descripción explícita que menciona WhatsApp/Tel/SMS. Tests: 168 unit + 25 smoke = 193/193 verdes. Bundle regenerado: 2.54 MB total. **Adicional en el mismo PR (fixes CodeQL bloqueantes)**: CodeQL detectó 2 alerts high severity al escanear el `app.bundle.js` regenerado (no introducidos por este PR — el escáner re-analiza todo el bundle cada vez que cambia): (1) `sap-admin-panel.js:846` — otro `Math.random().toString(36).slice(2, 8)` en contexto de session ID para lock cross-session (mismo patrón que v384 en otro archivo). Fix idéntico: `crypto.randomUUID().slice(0, 8)`. (2) `sap-integration-modal.js:90` — `innerHTML` con concatenación de `f.name` (nombre del archivo del `<input type="file">`, user-controlled) → CodeQL marcaba "DOM text reinterpreted as HTML" (XSS). Fix: reemplazado por composición DOM segura (`replaceChildren()` + `createElement('b')` + `textContent` + `createTextNode`). (3) Fix preventivo adicional: `exports-sap.js:175` — mismo `Math.random().toString(36)` para el `randomSuffix` del batch id DTW. Cambiado a `crypto.randomUUID().slice(0, 4).toUpperCase()` para no bloquear el próximo PR. Los 3 usos son NO criptográficos pero adoptar `crypto.randomUUID()` en todos los contextos donde CodeQL escanea (auth/session/token/batch id) elimina los alerts legítimamente. v384 = **Fix CodeQL "insecure randomness" en `sap-auto-send-listener.js` + reemplazo `Math.random()` → `crypto.randomUUID().slice(0, 8)`**. Cambio funcional trivial + bloqueante operativo eliminado. Motivación: al abrir el PR #39 de v383, GitHub Advanced Security (CodeQL) creó una review thread automática sobre `src/domains/sap-auto-send-listener.js:80` marcando `Math.random().toString(36).slice(2, 8)` como "cryptographically insecure random number generated in a security context". Con `required_conversation_resolution: true` en la branch protection (§34.1), esa thread bloqueó el squash-merge del PR hasta resolverla manualmente vía `graphql mutation resolveReviewThread`. Cada PR futuro que tocara ese archivo o cualquier `Math.random()` en contexto de "security" (auth, session, token) iba a repetir el bloqueo. **Análisis del uso**: el `Math.random()` genera un **session ID para lock cross-session** (v344+ fix duplicados SAP) que se combina con `currentUser.uid + Date.now()`. El propósito real NO es criptográfico (no cifra, no autentica), es solo un identifier semi-único para diferenciar sesiones concurrentes en un `runTransaction` de Firestore. Colisión requeriría mismo user + mismo millisegundo + mismos 6 chars random. **Fix**: reemplazar por `crypto.randomUUID().slice(0, 8)` — misma simplicidad, entropía 128 bits (vs ~30 bits de `Math.random()`), disponible en todos los browsers modernos como Web Crypto API estándar, elimina el CodeQL alert legítimamente (mejor práctica, no supresión). Comentario del código actualizado explicando la decisión. Bundle regenerado: 2.53 MB total. Baseline lint: **0 errors, 73 warnings** (mismo que v383). Tests: 168 unit + 25 smoke = 193/193 verdes. **Nota operativa**: si en el futuro alguien agrega `Math.random()` en cualquier archivo con contexto de auth/session/token, CodeQL va a volver a abrir una review thread que bloqueará el PR. Convención: usar siempre `crypto.randomUUID()` (para IDs) o `crypto.getRandomValues(new Uint8Array(N))` (para bytes) en cualquier lugar que un scanner pueda flagear. v383 = **Setup de Biome (lint + format) como guardrail principal contra bugs de scope tipo v382**. Cambio infra-only sin efectos visibles en la app. Motivación: v358, v362, v382 fueron todos el mismo pattern (identificador declarado en un IIFE del bundle, leído como free reference desde otro módulo → `ReferenceError` en runtime que solo Sentry captura post-deploy). La regla `noUndeclaredVariables` de Biome catchea esta clase entera **antes** del deploy. Setup: (a) `@biomejs/biome@2.5.6` como devDep. (b) `biome.json` con `preset: recommended` + 213 identifiers globales del inline declarados en `javascript.globals` (auto-extraídos del baseline: PRODUCTS, VENDORS, currentUser, userRole, escapeHtml, fbDb, sapConfigCache, etc — la lista completa cubre TODAS las free references legítimas de `src/domains/*.js`). Reglas explícitamente ajustadas: `noUndeclaredVariables: error` (fuerza declarar todo nuevo identifier), `noGlobalAssign: error`, `noUnusedVariables: warn`, `useTemplate/useArrowFunction/useOptionalChain/noApproximativeNumericConstant/noAssignInExpressions: off` (cosméticos ruidosos o false positives), `useIterableCallbackReturn: warn` (72 casos idiomáticos de forEach side-effect). (c) 3 scripts nuevos en `package.json`: `lint` (biome check), `lint:fix` (biome check --write), `format` (biome format --write). (d) Nuevo step "Lint (Biome)" en workflow `.github/workflows/test-and-lint.yml` — corre antes de los tests. Cualquier PR con undeclared identifier queda bloqueado por CI + branch protection. (e) Autofix ejecutado en la corrida inicial: 58 archivos formateados (imports organizados, useConst, comillas single, indent 2 spaces, lineWidth 100), 1 test bug detectado y arreglado (`Math.PI` vs literal `3.14159` en `csv-serializer.test.js`). Baseline final: **0 errors, 73 warnings** (72 useIterableCallbackReturn + 1 noArguments — todos visibles como recordatorio de refactor futuro, no bloquean CI). Tests: 168 unit + 25 smoke = 193/193 verdes. Bundle regenerado (2.53 MB total, +50 KB vs v382 por indentación cosmética de autofix — sin cambios funcionales). **Nota para próximas iteraciones**: cuando E4 termine la extracción del inline HTML al src/domains, los identifiers que ya no vivan en el inline se pueden quitar de `javascript.globals` y volver a ser error — devolviendo la regla a su máxima potencia. v382 = **Fix ReferenceError `sapClienteSearch`/`sapProductoSearch` reportado por Sentry (JAVASCRIPT-J, 2026-08-02 23:12 UTC)**. Bug funcional: al abrir el panel SAP admin y tocar la tab "Clientes" o "Productos", la lista quedaba en blanco y console tiraba `ReferenceError: sapClienteSearch is not defined` (o `sapProductoSearch`). Causa raíz: las 2 vars estaban declaradas con `var` en el top-level de `src/domains/sap-admin-panel.js` con un comentario erróneo que asumía que `var` iba a `window` global — pero el bundle esbuild es un IIFE por módulo, así que `var` queda encerrada en el scope del IIFE y NO en `window`. `src/domains/exports-sap.js` las leía como free reference → resolvía a `window.sapClienteSearch = undefined` → ReferenceError al llegar a `sapNorm(sapClienteSearch)` dentro de `renderSapClientes`/`renderSapProductos`. Es exactamente el mismo pattern que v362 (`pendingNotifIdToMarkRead` entre `notificaciones.js` y `visitas.js`) — **extensión intra-bundle de regla #17 de CLAUDE.md**. Fix: (a) `sap-admin-panel.js` L28-29 → patrón `if (typeof window.X === 'undefined') window.X = ''` con comentario explicativo; (b) `exports-sap.js` L468/480/505/585/597/622 → prefix `window.` en las 6 lecturas/escrituras. Tests: 168 unit + 25 smoke = 193/193 verdes. Bundle regenerado (2.0 MB shell). Deploy: bump `CACHE_VERSION` v381→v382 dispara `activate` del SW y purga cache viejo → todos los users que abran el panel SAP admin post-deploy no verán más el error. v381 = **Cleanup docs post-branch-protection (v380.5)**. Post-activación de branch protection en `main` (documentada en §34.1 por Mariano), quedaron 2 referencias stale en el README: (a) la celda APP_VERSION mencionaba "NO se activó branch protection en main (requiere confirmación explícita del user — ver TODO)" en la descripción heredada de v379; (b) §41 v379 tenía un bloque "TODO pendiente" con el comando `gh api` para activar. Ambos apuntaban a un TODO que YA se resolvió. Fix: reemplazadas por notas cortas "Branch protection activada 2026-08-02 — ver §34.1" con link a la sección canónica. Sin cambios funcionales — bundle intacto, cero riesgo. v380 = **Poda §41 changelog v204-v299 a `CHANGELOG-ARCHIVE-v204-v299.md`**. Cambio doc-only, sin efectos visibles en la app. Motivación: §41 había crecido a ~2.380 líneas (36% del README, 6.609 líneas totales) con 96+ entries pre-v300 que ningún vendedor consultaría hoy. Poda: se movieron 2 bloques al archive: **bloque A** (v204-v292, ~345 líneas, entries cortas ~6 líneas c/u) y **bloque B** (v293-v299, ~110 líneas, entries medio-detalle). Ambos bloques quedaron íntegros en `CHANGELOG-ARCHIVE-v204-v299.md`. En §41 quedaron 2 pointers concisos con titulares de cada bloque para que un dev pueda saber qué archivar hay sin abrir el archivo. Título §41 renombrado `Changelog v204 → v379` → `Changelog v300 → v380`. Reducción: README pasó de 6.609 → ~5.900 líneas (~10% menor). Bundle sin cambios (no se tocó `src/**`). v379 = **Hygiene sweep infra: `.gitignore` extendido + `scripts/README.md` + CI test-and-lint workflow**. Cambio infra-only, sin efectos visibles en la app. Motivación: auditoría 2026-08-02 detectó 3 riesgos altos en el repo: (a) `github-recovery-codes-IMPORTANT.txt` untracked en raíz sin cubrir por `.gitignore` → un `git add .` accidental commiteaba los códigos 2FA de Mariano en un repo público. (b) 15+ archivos sueltos en raíz (`.docx`, `_dtw_*` legacy, 9 scripts one-shot en `scripts/check_*`) sin patrones ignore claros. (c) los 193 tests unit+smoke corrían solo local antes del PR — cualquier merge accidental sin correrlos llegaba a main. Fixes: (1) `.gitignore` ahora cubre `github-recovery-codes-*.txt`, `*.docx`, `_*.json`, `_*.txt`, `scripts/check_*.py`, `scripts/count_*.py`, `scripts/find_*.py`, `scripts/query_*.py`, `scripts/replay_*.py`. Verificado post-cambio: `git status` bajó de 13 archivos untracked a 0. (2) Nuevo `scripts/README.md` con matriz de ~50 scripts categorizados en 5 grupos: 🟢 ACTIVOS (3 cronjobs prod), 🟡 BOOTSTRAP/DEPLOY (10 apply/deploy manuales), 🟠 AUDIT/VERIFY (5 chequeos post-deploy), 🔵 BUILD DOCS (2 generadores), ⚪ LEGACY one-shot (18 documentados como "no ejecutar de nuevo"). Convención nueva: prefix `check_/count_/find_/query_/replay_` = automáticamente gitignored (investigation ad-hoc no versionada). (3) Nuevo workflow `.github/workflows/test-and-lint.yml` que corre `npm ci + npm run typecheck + npm run test:unit + npm run test:smoke` en cada PR a main + cada push a main/dev. Timeout 5 min, concurrency cancel-in-progress, Node 20 (alineado con Cloud Functions v378). Duración típica ~1-2 min. NO reemplaza el smoke E2E manual antes del squash-merge, pero garantiza que ningún test roto llegue a main jamás. Branch protection en main activada el 2026-08-02 post-v380 (ver §34.1). Bundle sin cambios (no se tocó `src/**`), no se regenera `app.bundle.js`. Tests: 193/193 verdes locales, mismo suite que corre ahora en CI. v378 = **Estado SAP del pedido en cards CONFIRMADOS (OFERTA → ORDEN → FACTURADO → COBRADO PARCIAL/COMPLETO / CERRADO)**. Pedido de Mariano: que el vendedor pueda ver en qué instancia del flujo SAP está su pedido sin preguntarle al admin. Backend: nueva fn `sync_pedido_estados_to_firestore()` en `sync_sap_to_bigquery.py` que corre al final del cron (cada 30 min, después del snapshot Dashboard). Deriva el estado macro leyendo `sap_quotations_raw` + `sap_orders_raw` + `sap_invoices_raw` (todos ya en BQ) y linkea SQ → SO → Invoice a través de `lines_json[].BaseType='17' + BaseEntry` de las Orders/Invoices. Escribe `sapEstado` + `sapEstadoDetalles` + `sapEstadoUpdatedAt` de vuelta al doc `pedidos/{id}` de Firestore. Estados: `OFERTA_VENTA` (naranja: SQ open sin SO), `ORDEN_VENTA` (azul: SO creada sin factura), `FACTURADO` (violeta: invoice con paid_to_date=0), `COBRADO_PARCIAL` (naranja intenso: 0 < paid < total, muestra `%` cobrado en el badge), `COBRADO_COMPLETO` (verde: paid ≥ total), `CERRADO` (gris: SQ cancelada/vencida sin llegar a SO). Frontend: listeners de `pedidos` (own + all) extendidos para leer `sapEstado*`, nuevo helper `renderSapEstadoBadge()` + mapping `SAP_ESTADO_LABELS`, CSS `.cc-sap-estado` con clases por estado. En `renderConfirmadosList` cada card muestra el badge si `transferidoSAP.docNum` está seteado (si no aparece nada = pedido aún no transferido). Ventana BQ: SQ con `doc_date >= CURRENT_DATE - 365d` (~7.191 SQ en el ambiente actual). Deploy 2026-08-02: sync manual ejecutado, 5 pedidos actualizados (0 unmatched), ejemplo real: `CASA EL DELFIN DESDE 1976 S. R. L.` doc#2000010 → OFERTA_VENTA (SQ abierta), otros 3 → CERRADO (SQ canceladas por admin). Fault-tolerant: si esta parte del cron falla, no aborta el sync entero (bloque try/except al final del `main()`, mismo patrón que sync_dashboard_snapshot v367). v377 = **Stock Liberado en el alert de búsqueda de SKU (tránsito − backorder)**. Feature pedida por Mariano: al buscar un SKU en el picker y tocar el chip de stock, además de las líneas "DISPONIBLE venta" y "EN TRANSITO" ya existentes, mostrar 2 líneas nuevas cuando hay backorder: `🔒 BACKORDER (reservado a clientes): X unidades` y `🟢 STOCK LIBERADO (transito − backorder): max(transito − backorder, 0) unidades`. Ejemplo: 180 en tránsito + 20 backorder → stock liberado = 160. Backend: nueva fn `sl_fetch_backorder_by_sku()` en `sync_sap_to_firestore.py` que pagina `/b1s/v1/Quotations` open no canceladas y agrega `RemainingOpenQuantity` por `ItemCode`. Fault-tolerant: si SL falla, `backorder_map={}` y la UI hace fallback silencioso. `write_stock_snapshot()` persiste `backorderBySku` como JSON string (mismo patrón que `warehouseBreakdown`/`quantities` para evitar el límite de 40k index entries de Firestore). Frontend: nueva var global `STOCK_BACKORDER = {}` + parse en `ensureStockSnapshotListener` + cómputo de liberado en el alert. Las 2 líneas nuevas SOLO se muestran si `STOCK_BACKORDER[sku] > 0` (evita ruido en SKUs sin SQ abiertas). Mismo criterio que `v_backorder_lineas` en BQ (SQ open + Cancelled=tNO + RemainingOpenQuantity>0) → los números de la app y Data Studio coinciden 1:1. Deploy 2026-08-02: sync manual ejecutado → 1.830 SKUs con backorder poblado, top backorder actual `ICNLG500126Q` (1.126 uds), `ASLM3158RA` (1.072 uds). Costo: 1 fetch extra a SL por corrida del cron (~5 páginas, <10s adicional). v376 = **Fix Dashboard — dropdown de vendedor visible también para rol `interno` (VDI)**. Santiago Esteban reportó que al abrir Dashboard + elegir "Julio 2026" todo daba $0. Causa: la lógica de render del `<select>` de vendedor estaba limitada a `admin || viewer`. Los VDIs (rol `interno` — Santiago + Ioannis) NO tienen `assignedVendor` propio (son VDI, no VDE), entonces `dashboardVendorForTargets` quedaba en null → cards SAP nunca aparecían → todo se veía en 0 aunque hubiera facturación real de sus VDEs pareja. Fix: extender la condición a `admin || viewer || interno`. Para `interno`, las opciones se filtran con `getMyAllowedVendorKeys()` (helper global del inline) que devuelve `Set(['MAURICIO GIL', 'MARTIN BOIERO'])` para Santiago y `Set(['FEDERICO CASTELANELLI', 'GONZALO DE LA ROSA'])` para Ioannis. Label del "Todos" también cambia: para interno dice "Todas mis parejas (sumado)" en vez de "Todos los vendedores (sumado)". Cuando Santiago elige "Mauricio Gil", `dashboardVendorForTargets='MAURICIO GIL'` → cards SAP se activan con la data real. Skip v375 en APP_VERSION porque fue backend Functions only (fast-xml-parser fix, sin cambios frontend). v374 = **Selector de mes en Dashboard de ventas**. Pedido de vendedores: hasta v373 el modal Dashboard mostraba fijo "MES EN CURSO" (agosto 2026 al abrir en agosto), sin forma de ver cómo les fue en meses anteriores. Ahora hay un dropdown ámbar arriba del bloque MES con las opciones: `"Agosto 2026 (mes actual)"` + últimos 11 meses anteriores. El selector afecta: (a) card "Mes en curso · pedidos de la app" (filtro por `confirmed_at` startsWith YYYY-MM), (b) card "SAP · Mes en curso" (busca `sap_snapshot/{vendor}_{YYYY}_{MM}`), (c) target mensual del bloque (`getMonthlyTargetArs(vendor, year, monthIdx)`), (d) resumen equipo consolidado admin (visitsCache por mes/año + sap_snapshot por vendor). **NO afecta** el bloque "Acumulado anual" que queda YTD del año actual siempre — no tiene sentido cambiar el YTD con un selector de mes puntual. Cuando el user selecciona un mes distinto al actual, el título cambia de "Mes en curso" a "Mes de JULIO" para dejar claro que la vista es histórica. State: `let dashboardSelectedMonth = null` (null = default actual) + `window.setDashboardMonth(value)`. Sin cambios en backend — todo con la data que ya tenemos. v373 = **Fix `sync_campaigns` — wrapper defensivo del botón "Exportar a Excel" + cache invalidation forzada**. Sentry reportó desde iPhone Safari (release=v371) el error `ReferenceError: Can't find variable: openExportFormatModal` al tocar el botón. Causa raíz: **mismatch shell/chunk clásico** — el SW sirvió el HTML v371 (con `onclick="openExportFormatModal()"`) pero el `app.bundle.js` que estaba en cache era v370 (SIN el stub instalado por `installChunkStubs`). El stale-while-revalidate del SW v335+ funciona en desktop pero en iOS Safari con PWA standalone puede tardar más de lo esperado en activar el SW nuevo. Fix aditivo: **onclick pasa de `openExportFormatModal()` directo a `_safeOpenExportFormatModal()`**, un wrapper inline (no en bundle) definido en el `<script>` del HEAD del index.html que: (1) si `openExportFormatModal` es function → llama directo; (2) si no existe pero `loadChunk` sí → fuerza `loadChunk('exports-advanced')` y después llama la función real; (3) si nada existe → alert claro pidiendo refresh. Como el wrapper vive en el inline (no en el bundle), garantiza que existe en cualquier versión del HTML sin depender del bundle. Bump `CACHE_VERSION` v371→v372 dispara `activate` del SW y purga cache viejo → todos los usuarios reciben el bundle nuevo al próximo load. v371 = **Export dataset ZIP para pipelines de ML externos (Microsoft Fabric, Databricks, Python)**. El botón "Exportar a Excel" ahora abre un modal chico con 2 opciones: (a) **Reportes Excel** (comportamiento actual, todos los roles) y (b) **Dataset para análisis (ZIP)** — nueva, solo admin/gerente. La opción dataset genera un ZIP con 11 CSVs (pedidos con líneas desnormalizadas, visitas, clientes, client_master, rendiciones, campañas, targets, productos, vendor_overrides, custom_routes, seguimiento_notes) + `manifest.json` con schema completo por columna + matriz de casos de uso ML (A conversión visita→pedido, B churn clientes, C forecast SKU, D anomalías rendiciones, E estacionalidad zona/campaña) + `nullRateByField` por caso + `limitations` cuando falta data. Convenciones: UTF-8, separador `,`, fechas ISO 8601 UTC, decimales con `.`, nulls como campo vacío, arrays y objetos como JSON stringified. Datos crudos sin transformaciones derivadas — la transformación es del pipeline downstream. Fotos base64 y datos sensibles (`roles`, `app_config`) excluidos. Rendiciones exportan solo `fotoTicketUrl` (nunca `fotoTicket` base64 legacy). Volumen estimado: ~1.322 filas exportables, ~10-30 seg de ejecución, sin paginación (todo cabe en memoria). Implementación: nuevo módulo puro `src/pure/csv-serializer.js` con helpers `csvEscape`/`csvRow`/`firestoreValueToCsv`/`buildCsv`/`computeNullRates` + `DATASET_SCHEMAS` (11 colecciones) + `DATASET_USE_CASE_MATRIX` (5 casos) + row builders por colección. `exportDatasetZip()` en `src/domains/exports-advanced.js` (chunk lazy, reusa JSZip que ya estaba para `exportPhotosZip`). Modal `#export-format-modal` en `index.html` con progress bar y guard de rol. Firestore Rules sin cambios (admin/gerente ya podían listar todas las colecciones exportables). 62 tests unit del serializer + 25 tests integración pipeline completo con seed representativa. Total suite: 193/193 verdes. v370 = **Split pedido usa `disponible venta` (whs 11) + picker con estado ámbar para tránsito**. Extensión de v369. El split de v347 (`confirmExcelPedido`) ahora usa `getStockDisponibleVenta(sku)` = solo warehouse 11 (Mercadería NUR PESCA), en vez de `getStockQty` que sumaba todos los almacenes vendibles. Impacto: si un vendedor pide 30 unidades de SN2000FG (que tiene `0 en whs 11 + 180 en whs 12`), ahora las 30 unidades se splitean como TODAS SIN STOCK (van a backorder), no como "180 disponibles" que era el bug. Además: 2 helpers nuevos `getStockDisponibleVenta` + `getStockTransito`. Preview de pedido: líneas `sinStock=true` con `transitoQty>0` muestran badge extra ámbar `🚚 N EN TRANSITO` junto al rojo `SIN STOCK` — signal para el vendedor de "backorder con fecha estimada, no sin fecha". Product picker: nuevo estado ámbar del `stock-dot` cuando `0 disponible + N en tránsito` con tooltip enriquecido `"Disponible venta (dep. 11): 20 uds + 180 en tránsito"`. Retrocompat: pedidos pre-v370 sin `transitoQty` no rompen (chequeo condicional); SKUs con snapshot pre-v369 sin `warehouseBreakdown` caen al fallback `getStockQty` (comportamiento anterior). v369 = **Stock por warehouse — separa Disponible venta (11) vs Tránsito (12) en la card de la app**. Bug reportado por Mariano: buscando `SN2000FG` la app decía "Total vendible: 180 unidades" pero en SAP esas 180 estaban en almacén 12 (tránsito) y almacén 11 (venta directa) tenía 0. El vendedor pensaba que podía vender 180 cuando no había nada disponible AÚN. Causa: `sync_sap_to_firestore.py` sumaba TODOS los warehouses vendibles (excluyendo solo 05 Marketing y 06 Devoluciones) en un único total sin guardar el desglose. Fix backend: nuevo `whs_map` construido en el mismo bucle del fetch (línea 312+), escrito a Firestore como `warehouseBreakdown` (JSON string, mismo patrón que `quantities` para no romper el límite de 40k index entries del doc). Fix frontend: nueva var global `STOCK_WAREHOUSE_BREAKDOWN` parseada del listener + alert de stock ahora muestra `✅ DISPONIBLE venta (dep. 11): X / 🚚 EN TRANSITO (dep. 12): Y / Otros: Z / Total: X+Y+Z`. Convención warehouses SAP PESCA hardcoded: `11`=NUR PESCA vendible, `12`=EN TRANSITO PESCA, `98`=Cuarentena, `01/03/04/07`=Otros (agrupados). Deploy 2026-07-31: sync manual ejecutado tras el bump, 442 SKUs con breakdown poblado (`SN2000FG: {"12": 180}` confirmado). Cron GH Actions cada 30 min lo mantiene fresco. v368 = **Fix Dashboard consolidado admin: usa `sap_snapshot` para el ranking del equipo (antes mostraba `$0` porque leía solo pedidos app)**. Bug reportado por Mariano al abrir el Dashboard como admin con filtro "Todos los vendedores (sumado)": todas las cards del ranking mostraban `$0 / $57M` y `0% cumplimiento` porque el bloque consolidado (línea ~194 de `dashboard.js`) usa `byV[v].money` calculado desde `confirmed` (pedidos que los vendedores cargan en la app) — durante la transición Baraldo → venta directa esos pedidos son casi 0 porque la mayoría van directo a SAP. En v367 sub-c agregué las cards SAP azules pero SOLO cuando hay vendedor específico seleccionado; el modo consolidado admin quedó sin datos. Fix: en el ranking cada `item` ahora computa `moneyForRank = sap_snapshot.facturadoArsNeto` (si hay snapshot) o cae a `s.money` (fallback pedidos app). Los KPIs del "Resumen equipo" (Facturado ARS, Cumplimiento %) y las barras individuales del ranking usan este nuevo valor. Cada card del ranking muestra un badge chico `SAP` (celeste) o `pedidos app` (gris) para que se sepa qué fuente alimenta ese vendedor. Footer del resumen del equipo agrega "N/6 con facturado SAP este mes" para ver rápido la cobertura del snapshot. Unidades del equipo también priorizan SAP cuando hay datos. v367 = **Dashboard app consume `sap_snapshot` — facturado real SAP + unidades + % cumplimiento por vendedor, alineado con TABLERO SAR de Power BI**. Objetivo: hasta hoy los vendedores en su modal Dashboard solo veían el target + los pedidos que ellos mismos cargan en la app (que en la transición Baraldo → venta directa son pocos). Ahora ven **también** 2 cards azules nuevas ("SAP · Mes en curso" y "SAP · Acumulado anual") con el facturado real SAP neto de notas de crédito, actualizado cada 30 min desde el cron BQ. Backend: nueva función `sync_dashboard_snapshot_to_firestore()` en `sync_sap_to_bigquery.py` que agrega `v_facturas_sap + v_ventas_lineas` por `(assigned_vendor, año, mes)` y escribe a Firestore `sap_snapshot/{VENDOR_NORM}_{YYYY}_{MM}` con campos `facturadoArsNeto, facturadoArsBruto, ncsArs, facturasCount, ncsCount, unidadesNeto, importeLineasArsNeto`. Frontend: `src/domains/dashboard.js` con nuevo listener `listenSapSnapshot()` (cross-scope pattern regla #17, cleanup en `detachFirebaseListeners` regla #12), helpers `getSapSnapshotFor(vendor, y, m)` y `getSapSnapshotYtd(vendor, y, upToM)`, 2 cards renderizadas cuando hay vendedor específico seleccionado. Rules: `sap_snapshot` read para todos los autenticados (filtro por vendedor client-side vía `getMyAllowedVendorKeys()`), write bloqueado (solo bypass del service account server-side). Verificado 2026-07-30: Gonzalo julio 2026 muestra $110.2M neto (bruto $130.9M − NCs $20.7M) — matchea 1:1 con la card "Cumplimiento mensual" del Tablero SAR. Sincronización automática cada 30 min via cron GH Actions. **Nota**: la vista consolidada admin/viewer con filtro "Todos" mantiene la UI de ranking existente (las cards SAP solo aparecen cuando se selecciona un vendedor específico). v366 = **Fix z-index del modal `#contacto-estado-modal`**: el modal ESTADO quedaba tapado por el modal Contactado padre (`#visita-modal`) porque ambos usan `.modal-overlay` con `z-index:3000` base, y el visita-modal está declarado después en el DOM → gana el stacking. Fix: `style="z-index:4000"` inline en el `#contacto-estado-modal` (mismo nivel que `.qmodal-overlay`). Ahora al tocar el botón ESTADO se ve el modal arriba del Contactado sin necesidad de cerrarlo. Regla para futuros modales que se abran DESDE OTRO modal: bumpear z-index para no quedar atrapados en el stacking. v365 = **Boton ESTADO + modal para marcar resultado de contactos no presenciales**: cada card en "MIS CONTACTOS" (dentro del modal Contactado) ahora muestra un badge visual con el estado (`⏳ Sin marcar` ámbar / `✅ Respondió` verde / `❌ No respondió` gris) al lado del badge `📱 CONTACTO`. Boton nuevo teal `📋 ESTADO` (reemplaza al ELIMINAR rojo solo en cards de tipo contacto) abre modal chico con 3 opciones: **RESPONDIÓ → solicitar documentación para alta SAP**, **NO RESPONDIÓ → queda registrado el intento**, **ELIMINAR CONTACTO → borra el registro**. Motivación: llevar registro sistemático de qué contactos no presenciales dieron resultado — permite decidir a quién enviarle documentación para alta SAP (salir de "Provisorios") y a quién directamente eliminar. Cards de visitas presenciales (`interactionType !== 'contacto'`) mantienen el botón ELIMINAR directo sin pasar por el modal. Firestore: nuevo campo `contactoResultado: 'respondio' | 'no_respondio'` (default undefined = sin marcar) + `contactoResultadoAt` (serverTimestamp) + `contactoResultadoBy` + `contactoResultadoByEmail` en el doc `visits/{visitId}`. Permisos: admin/gerente marcan cualquier contacto; vendedores solo los propios (mismo criterio que `deleteVisit`). Auditado via `logOp('contacto_resultado', ...)`. Modal expuesto como `#contacto-estado-modal` en index.html, handlers `openContactoEstadoModal`/`setContactoResultado`/`closeContactoEstadoModal`/`deleteContactoFromEstadoModal` en `src/domains/visitas.js`. v364 = **Fix contador "X / Y habilitados" del sidebar CLIENTES no cambiaba al tocar sub-filtro TODOS/CLIENTE EN SAP/PROVISORIOS**: el contador `#contact-summary` siempre mostraba `527 / 527` (total global) sin importar qué botón se tocara, aunque las cards debajo sí filtraban correctamente. Bug en 2 puntos: (1) `updateContactSummary()` ignoraba `clientStateFilter` — sumaba todos los POINTS + todos los SAP altas siempre; (2) `setClientStateFilter()` solo llamaba `renderClients()` y no `updateContactSummary()` al cambiar de sub-filtro. Fix: la función `updateContactSummary` ahora replica el mismo criterio de `renderClients` — en POINTS respeta `getClientState()` (habilitado/pendiente); en SAP altas, `confirmados` = SAP con geo+addr, `pendientes` = provisorio O SAP sin geo/addr. Además `setClientStateFilter` ahora llama `updateContactSummary()` al final. Pedido de Mariano al observar que "527/527" no cambiaba visualmente al probar los 3 botones. v363 = **Modal Zonas: filtro "Solo sin asignar"**: botón toggle nuevo en la barra de filtros del modal `#zonas-modal`, entre "Masterfile-Base" y el select de provincias. Cuando está activo (fondo rojo `#b91c1c`), `renderZonasList()` esconde toda fila cuyo vendor efectivo NO sea vacío en los 4 puntos de render: (1) shop POINTS via `getEffectiveVendorForClient`, (2) shop SAP altas via `a.assignedVendor`, (3) loc via `getEffectiveVendorForPoint`, (4) prov via override+mayoría. Pedido de Mariano post-observación de que muchas tiendas SAP nuevas quedaban con "SIN ASIGNAR" gris y era tedioso encontrarlas paginando entre las ya asignadas. State: `let zonasFilterUnassigned = false;` + `window.toggleZonasFilterUnassigned()`. v362 = **Fix `pendingNotifIdToMarkRead` cross-module scope**: al submitear cualquier form de visita/contacto tiraba `Error guardando: Can't find variable: pendingNotifIdToMarkRead`. La variable estaba declarada como `let` en `src/domains/notificaciones.js` (renombrada por esbuild a `pendingNotifIdToMarkRead2` en su scope) y leída/escrita desde `src/domains/visitas.js` sin sufijo → free variable → resolvía a `window.pendingNotifIdToMarkRead` (undefined) → `ReferenceError` al llegar al bloque de "marcar notif como leída post-visita" dentro de `submitVisita`. Extensión de la regla #17 de CLAUDE.md: aplica también **entre módulos del bundle**, no solo bundle↔inline — cada `src/domains/*.js` tiene su propio scope IIFE en el bundle esbuild. Fix: `let pendingNotifIdToMarkRead = null;` → `if (typeof window.pendingNotifIdToMarkRead === 'undefined') window.pendingNotifIdToMarkRead = null;` en notificaciones.js + prefix `window.` en las 3 referencias de visitas.js. v361 = **Fix bug latente post-E2: `_fsSelect` no estaba expuesto en `window`**: el bug real detrás de "cuando toco 'Tienda de pesca' no pasa nada" (Mariano, 2026-07-29). El dropdown del filter-select genera items con inline handler `onmousedown="_fsSelect(event)"`, pero al extraer visitas al bundle IIFE (E2.k) esbuild **tree-shakea** la función `_fsSelect` porque no ve ninguna referencia JS a ella — el HTML inline no cuenta como uso. Al hacer click, el browser hace lookup en `window`, no encuentra `_fsSelect`, tira `ReferenceError` silencioso, click no hace nada. Los otros handlers `fsOn*` (input/focus/blur/keydown) sí estaban expuestos con `window.fsOn* = function(...)` porque están referenciados como atributos `<input oninput=... onfocus=... onblur=... onkeydown=...>` — el único que faltaba era `_fsSelect`. Fix: cambio `function _fsSelect(evt){...}` por `window._fsSelect = function(evt){...}`. Por qué solo se notó ahora: Enter en el input dispara `fsOnKeydown` que ejecuta la misma lógica sin tocar `_fsSelect` — el user probablemente venía usando Enter sin darse cuenta, o el bug estaba oculto detrás del bug del preservado v359/v360. Post-E2 esto siempre estuvo roto para touch/mouse click puro. v360 = **Fix REAL del bug v359 — el selector "Tienda de pesca" seguía sin quedar seleccionado**: v359 introdujo la lógica de preservar la selección previa entre re-populates de `populateVisitaLocalidades` (disparados por `onSnapshot` de `approvedAltasList` con el modal abierto), pero comparaba `vf-tienda.value` directamente contra `items[].value`. Nunca matcheaba: `_fsSelect` pone el value compuesto `"PROV||Loc||Tienda"` en el hidden, pero inmediatamente después `onTiendaChange` (v298+) lo pisa con **solo el nombre plano** de la tienda, mientras los `items[].value` mantienen el formato compuesto. El `items.find(i => i.value === _prevTiendaVal)` devolvía `undefined` siempre → caía al `fsReset` → borraba igual que pre-v359. Bug reportado por Mariano: "cuando toco 'Tienda de pesca' en 'Registro de Contacto (no presencial)' no la selecciona". Fix: reconstruir el value compuesto usando `vf-localidad` (`"PROV||Loc"`, que `onTiendaChange` deja en paralelo) + `vf-tienda` (nombre plano) → `"PROV||Loc||Tienda"`. Con eso `items.find` matchea, `fsSetValue` restaura el compuesto en el hidden + label completo en el input search, y una llamada extra a `onTiendaChange(_prevCompositeVal)` re-pisa el hidden con el nombre plano y re-setea `vf-localidad` (mismo camino que `_fsSelect` original). El bug afectaba a AMBOS modos (visita + contacto), pero se notaba más en el modo Contactado porque es el flow nuevo y recién testeado. v359 = **Fix selector "Tienda de pesca" se borraba al llegar update de Firestore** (ROTO — reemplazado por v360): bug reportado en el modal Contactado — al elegir una tienda del dropdown, el input quedaba vacío después. Causa raíz: el listener `onSnapshot` de `approvedAltasList` (index.html:3707) re-llama `populateVisitaLocalidades()` cuando dispara con el modal abierto. Esa función hacía `fsReset('vf-tienda')` **incondicional** → borraba la selección. El "guardian" existente solo protegía si el user estaba escribiendo (foco activo en el input), pero después del click en la opción `_fsSelect` hace `inp.blur()` → sin foco → el guardian no aplicaba → siguiente onSnapshot borraba la selección. Fix: preservar el value previo del hidden `vf-tienda` si sigue existiendo en la nueva lista de opciones (mismo para `vf-localidad`). Bug era GENERAL para ambos modos (visita + contacto), no específico de contacto — solo se notó ahora al testear el flow nuevo. v358 = **Fix validación submit — v357 quedó incompleta**: v357 ocultó la fila "Especialización por tipo de pesca" en modo contacto y quitó el `required` HTML, pero la validación JS en `submitVisita()` seguía chequeándolo (`if (!readField('vf-especializacion'))`). Al submitear un contacto el alert "Faltan completar: Especialización por tipo de pesca" aparecía aunque el campo estuviera invisible. Fix: agregado guard `!_isContacto &&` a la validación, igual patrón que Fidelidad/POP/TipoVenta. v357 = **Ocultar "Especialización por tipo de pesca" en modo Contactado**: se suma este campo al conjunto de filas que se ocultan cuando el usuario abre el modal en modo contacto no presencial (WhatsApp/tel/email). Sigue la misma lógica que Fidelidad + POP + Tipo de venta (agregados en v339): no aplican a una interacción no presencial. También quita `required` para que el submit no falle por validación. v356 = **Fix zonas con aspecto "moteado" en zoom lejano**: cada dept se simplifica independientemente (Douglas-Peucker en v351 + `smoothFactor: 3.0` en v354), sus bordes no coincidían pixel-perfect con los depts vecinos → aparecían gaps microscópicos que dejaban ver el fondo blanco → la zona se veía fragmentada en zoom lejos, uniforme en zoom cerca. Fix: en `deptStyle`, ambos casos que antes usaban `stroke: false` ahora usan un stroke MUY sutil del mismo color que el fill + misma opacity (no visible como línea, tapa los gaps). El contorno externo grueso de la zona lo sigue dibujando `vendorOutlineLayer` aparte. v355 = **Revert skip deptLayer (v354 fix B)**: la optimización de remover `deptLayer` en zoom <8 rompía los rellenos coloreados por vendor — `deptLayer` no era solo "detalle de departamentos", era la ÚNICA fuente del `fillColor` por zona. En country view los outlines seguían viéndose (los pinta `vendorOutlineLayer` aparte) pero las provincias quedaban blancas por dentro. Rebertido el toggle por zoom. Mantiene el `smoothFactor: 3.0` de v354 fix A (que no cambia semántica). Para bajar el costo de render en country view queda como opción el fix C (mergear depts por vendor en 6 polygons pre-computados via `polygon-clipping.union`). v354 = **Perf mapa: smoothFactor + skip depts en zoom lejos** (skip revertido en v355 — dejaba las zonas sin fill): (1) `smoothFactor: 3.0` en `deptLayer` + `provLayer` + polilíneas de `vendorOutlineLayer`. v353 = **Fix cluster fragmentado**: v352 creaba 3 `markerClusterGroup` separados (client / sap alta / agregado) → pines verdes solitarios de una layer NO se agrupaban con clusters vecinos de otra layer. Ahora hay UN solo `_sharedCluster` compartido; cada "layer" (`clientPinLayer` / `sapAltaPinLayer` / `markerLayer`) es un proxy con un `Set` propio de markers que forwardea `addLayer/removeLayer/clearLayers` al cluster global. Resultado: todos los pines cercanos se mergean en la misma burbuja sin importar la fuente, y cada layer puede seguir haciendo `clearLayers()` en su redraw sin tocar las otras. v352 = **Perf mapa: marker clustering**: los ~1000 pines de tiendas ahora se agrupan en burbujas con número cuando el zoom está lejos (Argentina view). Usa plugin `leaflet.markercluster@1.5.3` (CDN unpkg). Opciones: `maxClusterRadius: 60`, `disableClusteringAtZoom: 12` (a partir de zoom 12 se ven todos individuales), `showCoverageOnHover: false`, `chunkedLoading: true`, `spiderfyOnMaxZoom: true`. Aplica a `clientPinLayer` + `sapAltaPinLayer` + `markerLayer`. Fallback a `L.layerGroup()` si el plugin no cargó (offline con SW viejo o CDN caído) — la app sigue funcional. v351 = **Perf mapa: preferCanvas + geo.json simplificado**: (1) `L.map()` ahora usa `preferCanvas: true` — polygonos (24 provincias + 527 departamentos + zonas) se pintan en `<canvas>` en vez de SVG, elimina el lag de zoom in/out cuando hay muchos polígonos superpuestos. (2) `geo.json` simplificado con Douglas-Peucker (script nuevo `scripts/simplify-geo.js`): dept tol 0.005° (~555 m, invisible en zoom 4-9), prov tol 0.003° (~333 m). Coordenadas redondeadas a 4 decimales. Reducción: 1602 KB → 885 KB (**45% menor**), dept coords 60,692 → 26,215 (57% menos), prov coords 20,426 → 17,322 (15% menos). Backup en `geo.json.bak` (untracked, no se sube). v350 = **Fix layout toolbar Master Clientes**: grid de 12 botones/selects hacía overflow del modal (el botón "SAP" quedaba solito en una segunda fila desbordada). Cambio `grid-template-columns` de `repeat(5,1fr) auto` (5 columnas fijas) a `repeat(auto-fill, minmax(150px, 1fr))` — se acomoda dinámicamente según ancho del modal (7-8 columnas en 1200px, 5-6 en 900px, wrap automático). v349 = **Botón "SAP" en Master Clientes + default TIPO='C'**: nuevo botón toggle 🏭 SAP al lado de "Provisorios" que filtra la vista para mostrar SOLO tiendas con CardCode (contraparte de Provisorios; modos mutuamente exclusivos). El dropdown "TIPO" del Master Clientes ahora arranca en **'C'** cuando el cliente no tiene `cliTipo` guardado (antes arrancaba en '(sin clasificar)'). No auto-persiste — el usuario tiene que apretar "Guardar" para que quede grabado en Firestore. v348 = **"Reubicar pines" con modo FORZOSO + feedback al editar dirección**: el botón `runBulkGeocodeSapAltas` ahora ofrece 2 modos (ACEPTAR = forzar re-geocode de TODAS las tiendas con dirección, aunque ya tengan lat/lng; CANCELAR = solo las que faltan). `openSapAltaAddressModal` (v342+) también compara lat/lng nuevas vs previas post-geocode y avisa explícito cuando Google/OSM devolvió el MISMO punto (tolerancia ~15m). Bloque de bumps recientes: v333 = **E3 code splitting** (shell + 3 chunks lazy) + hotfixes v334-v338; v339 = **modo Contactado sin Fidelidad/POP/Tipo de venta**; v340 = **fix visual "Aun no transferido a SAP"** en pedidos ya transferidos; v341 = **remove sub-tab "Nueva Solicitud"** de Alta Clientes; v342 = **vendedor edita Nombre Fantasia + Dirección + Localidad**; v343 = **"Descuento total (%)"** en review dialog → SAP DiscountPercent header; v344 = **fix duplicados SAP** via Firestore transaction lock cross-session; v345/v346 = **Excel loader prioriza precios del archivo** con alias `PRECIO VTA SHIMANO $ (SIN IVA)`; v347 = **split líneas por stock** (verde con stock suficiente / rojo SIN STOCK) en pedido confirmado. |
| **Firebase plan** | **Blaze** activo (necesario para Storage + extensions BigQuery) |
| **Pipeline Power BI** | Firestore → BigQuery (Extension `firestore-bigquery-export`, 7 colecciones + `targets` + `campaigns` via sync propio) + SAP → BigQuery (`sync_sap_to_bigquery.py`, **9 tablas raw**: BPs, Items, Invoices, Credit Notes, Quotations, Orders, POs, **Deliveries**, **Returns**) → **20 vistas curadas** (base: `v_pedidos_header`, `v_pedidos_lines`, `v_visitas` **con `interaction_type`+`es_contacto`+`forma_contacto`**, `v_facturas_sap` **con `paid_to_date`+`saldo_ars`+`assigned_vendor`**, `v_inventario` **con alias `qty_quotations_open`**, `v_inventario_por_warehouse`, `v_ventas_lineas` **con `cobrado_prorrateado_ars`+`deuda_prorrateada_ars`+`assigned_vendor`**, `v_backorder_lineas`, `v_targets` **con `target_reel/canas/lineas_ars`**; **deuda 2026-07-20**: `v_deuda_por_vendedor`, `v_deuda_facturas_detalle`, `v_facturado_cobrado_deuda_por_vendedor`; **rendiciones 2026-07-22**: `v_rendiciones`, `v_rendiciones_duplicados`; **campañas 2026-07-30**: `v_campanias_progreso`, `v_campanias_evolucion_diaria`, `v_campanias_ventas_detalle`; **leads 2026-08-03**: `v_leads_vs_clientes_por_vendedor`; **remitos 2026-08-03/04**: `v_remitos_lineas` con match determinista Delivery↔Invoice `BaseType=13+BaseEntry=Invoice.DocEntry` confirmado por Santi/SEIDOR; **ofertas 2026-08-04**: `v_ofertas_lineas` = total de Sales Quotations sin recortar por stock para card "TOTAL" en PBI) → **Power BI Desktop TABLERO SAR publicado con 8+ páginas (Desempeño-Pesca, Ventas, Pedidos, Visitas, Facturación por vendedor, Backorder, Inventario, Rendiciones, Campañas), slicer de vendedor migrado a `assigned_vendor` (fuente de verdad app, no SlpCode SAP inconsistente)**. Ver sección 40 |
| **Sync SAP automático** | Service Layer → Firestore + `stock.json` **+ BPs pesca cada 30 min** (cron GH Actions `13,43 * * * *`). Desde v288 sincroniza también BPs con `U_DIVISION ∈ {2 PESCA, 3 BIKE&PESCA}` a `client_applications` — los altas SAP aparecen en la app sin acción manual del admin |
| **Bot Inventario Google Sheet** | Lee `raw.githubusercontent.com/shimano-arg/app-vendedores/main/stock.json` cada 30 min — datos frescos garantizados |

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Estado actual del lanzamiento](#2-estado-actual-del-lanzamiento)
3. [Stack técnico](#3-stack-técnico)
4. [Estructura del repo](#4-estructura-del-repo)
5. [Pipeline de build](#5-pipeline-de-build)
6. [Sistema de autenticación y autorización](#6-sistema-de-autenticación-y-autorización)
7. [Roles y permisos](#7-roles-y-permisos)
8. [Modelo de datos Firestore](#8-modelo-de-datos-firestore)
9. [Firestore Security Rules](#9-firestore-security-rules)
10. [Estructura de la UI](#10-estructura-de-la-ui)
11. [Sistema de zonas y vendedores](#11-sistema-de-zonas-y-vendedores)
12. [Sección: Localidades / Clientes / Pedidos](#12-sección-localidades--clientes--pedidos)
13. [Sección: Rutas](#13-sección-rutas)
14. [Sección: Visita](#14-sección-visita)
15. [Sección: Dashboard](#15-sección-dashboard)
16. [Sección: Rendiciones](#16-sección-rendiciones)
17. [Sección: Alta Clientes](#17-sección-alta-clientes)
18. [Sección: Notificaciones](#18-sección-notificaciones-alertas-y-tareas)
19. [Sistema VDE-VDI (vendedor externo / interno)](#19-sistema-vde-vdi-vendedor-externo--interno)
20. [Provincias hardcoded a VDIs](#20-provincias-hardcoded-a-vdis)
21. [Campañas comerciales](#21-campañas-comerciales)
22. [Targets mensuales](#22-targets-mensuales)
23. [Panel Master Clientes + import SAP](#23-panel-master-clientes--import-sap)
24. [Modal Zonas (reasignación)](#24-modal-zonas-reasignación)
25. [Integración SAP B1](#25-integración-sap-b1)
26. [Stock SAP](#26-stock-sap)
27. [OCR de tickets con Gemini API](#27-ocr-de-tickets-con-gemini-api)
28. [PWA installable](#28-pwa-installable)
29. [Backup TOTAL de la app](#29-backup-total-de-la-app)
30. [Exports a Excel / Power BI / ML](#30-exports-a-excel--power-bi--ml)
31. [Panel admin "Usuarios"](#31-panel-admin-usuarios)
32. [URLs externas e integraciones](#32-urls-externas-e-integraciones)
33. [Convenciones de código](#33-convenciones-de-código)
34. [Regenerar y deployar](#34-regenerar-y-deployar)
35. [Troubleshooting](#35-troubleshooting)
36. [Ciberseguridad y hardening](#36-ciberseguridad-y-hardening)
37. [Contactos clave](#37-contactos-clave)
38. [Roadmap / pendientes](#38-roadmap--pendientes)
39. [Seguimiento (panel VDIs)](#39-seguimiento-panel-vdis)
40. [Power BI / BigQuery](#40-power-bi--bigquery)
41. [Changelog v300 → v380](#41-changelog-v300--v380)
42. [Setup de desarrollo local (2026-07-24)](#42-setup-de-desarrollo-local-2026-07-24)
43. [Fase 0 — Progreso 2026-07-24 (rama `fase-0`)](#43-fase-0--progreso-2026-07-24-rama-fase-0)
44. [Estado de fin de sesión 2026-07-27 — dónde retomar en la próxima](#44-estado-de-fin-de-sesión-2026-07-27--dónde-retomar-en-la-próxima)
45. [E2.b performance + code splitting (rama `e2b-perf`)](#45-e2b-performance--code-splitting-rama-e2b-perf)

---

## 1) Resumen ejecutivo

### Para qué sirve

Shimano Argentina necesita gestionar la operación de **4 vendedores externos (VDE)** y **2 vendedores internos (VDI)** que recorren tiendas de pesca en todo el país después de la salida del distribuidor histórico (Baraldo). La app cubre:

- **Mapa interactivo** de Argentina con 24 provincias + 527 departamentos pintados por zona de vendedor.
- **~1.000 tiendas** pre-cargadas (clientes + prospectos + distribuidores) con sistema de habilitación.
- **665 SKUs** del master de productos (pesca).
- **6 zonas**: Z1 Gonzalo, Z2 Federico, Z4 Martin, Z5 Mauricio, Z6 Ioannis (VDI), Z7 Santiago (VDI).
- **Provincias hardcoded a VDIs** (Patagonia → Ioannis, NOA + NEA → Santiago).
- **Rutas mensuales** auto-generadas por proximidad (10-15 tiendas por ruta).
- **Visitas a tiendas** con formulario completo + foto + GPS doble-check.
- **Pedidos** confirmados con condición de pago → exportables como ZIP DTW o enviados directo por Service Layer.
- **Rendiciones de gastos** con OCR de tickets (Gemini) y aprobación por gerente.
- **Alta de clientes nuevos** con doble aprobación + auto-aparición en el mapa al aprobar.
- **Reasignación de zonas** desde modal admin (overrides por tienda o por localidad).
- **Master Clientes** con direcciones exactas + import masivo desde SAP B1.
- **Stock SAP** vía CSV manual (3x día) o Service Layer real-time.
- **Notificaciones y tareas** entre usuarios con imágenes (con botón Eliminar por card desde v179+).
- **Dashboard** comparativo del equipo + por vendedor individual.
- **Campañas comerciales** vigentes con tracking de SKUs.
- **Targets mensuales en ARS** cargados por gerente.
- **PWA installable** en celular como app nativa.
- **Backup TOTAL** mensual con TODAS las colecciones Firestore + fotos.
- **Sistema VDE-VDI** con pareja: VDI puede crear pedidos/visitas en nombre de su VDE pareja.
- **Rutas personalizadas** (colección `custom_routes`): el vendedor arma su propia ruta con tiendas + fecha + orden, complementando las rutas auto-recomendadas.
- **Alta rápida** de clientes provisorios (`source: 'alta_rapida'`, `manualSapPending: true`) para no bloquear pedidos mientras Admin carga el cliente a SAP.

### Filosofía de diseño

- **App estática en GitHub Pages** (sin backend propio). Toda la lógica corre en el navegador.
- **Firebase Firestore** como backend real (auth + DB).
- **Sin framework** (JS vanilla): un solo `index.html` ~3.2 MB con todo embebido.
- **Build offline en Python** genera el HTML desde Excels master cuando hay que actualizar datos estáticos.
- **Datos vivos** (pedidos, visitas, usuarios, alta clientes, etc.) viven 100% en Firestore.
- **Tiempo real** via `onSnapshot` listeners.
- **Offline-friendly**: persistencia IndexedDB activada en Firestore.
- **SAP B1 con doble vía**: DTW manual (probado y funcional) + Service Layer (preparado, en espera de bloqueantes SEIDOR/IT).

---

## 2) Estado actual del lanzamiento

### Funcionalidades implementadas (✅ todas)

```
[X] Mapa interactivo con 6 zonas + filtros
[X] Sistema de roles (admin / gerente / vendedor / interno / viewer / unassigned)
[X] Auth Google + Microsoft (Azure AD) + Email/password + Magic link (passwordless)
[X] Reset password vía Firebase Auth (panel Usuarios → 2 opciones: reset email / PIN legacy)
[X] 2FA opcional para todos los roles (antes era obligatorio admin)
[X] Alta de clientes con flujo de aprobación 2 aprobadores
[X] Alta rapida: cliente provisorio sin doble aprobacion (badge "⚡ PROVISORIO" + fondo crema)
[X] Auto-aparición en mapa al aprobar alta + al crear alta rapida
[X] Modal Zonas (admin): reasignar tienda o localidad con historial
[X] Outlines de zonas: hibrido provincia+dept con union polygon-clipping + cache localStorage
[X] PROVINCE_VENDOR_OVERRIDE (hoy: SAN LUIS → MARTIN BOIERO)
[X] Master Clientes: direcciones + CardCode SAP + dropdown provincia editable
[X] Import masivo desde SAP B1 (fuzzy matching + auto-habilitar + crear nuevas + ownerUid)
[X] Stock SAP via CSV upload manual (Stock panel admin) + GitHub Actions sync 30min
[X] Cliente Service Layer JS + pestaña config en SAP modal (en espera de cableado UI)
[X] ZIP DTW funcional, probado E2E en TST_06 con OQUT + UDFs + Series APP
[X] Backup TOTAL: ZIP con 19 colecciones Firestore + fotos + metadata
[X] Sugerencias de SKUs basadas en historial real de pedidos (no MELI)
[X] Provincias hardcoded a VDIs (Patagonia/Mendoza→Ioannis, NOA/NEA→Santiago)
[X] Rutas auto-generadas + recalcular manual
[X] Rutas personalizadas (collection custom_routes con toggle "Recomendadas/Personalizadas")
[X] Rendiciones con OCR Gemini de tickets + foto y N° ticket opcionales
[X] Export Rendiciones mensual desde la UI con foto embebida (ExcelJS local) + columnas SAP
[X] Export Visitas mensual con foto del frente embebida (ExcelJS)
[X] Mail Rendiciones cron Lun/Mie (Python + openpyxl) con hyperlink Firebase Storage a foto del ticket
[X] Dashboard comparativo
[X] Export Excel TARGETS-ZONAS con altas integradas
[X] Notificaciones entre usuarios con imágenes + boton Eliminar por card
[X] Sistema VDI/VDE con pareja + restricción de filtro por rol
[X] Gerente ve todo el mapa (fix getMyAllowedVendorKeys)
[X] Targets mensuales por vendedor
[X] Campañas comerciales con tracking de SKUs
[X] Vista preliminar de pedido (puntos verde/rojo por stock, subtotales disponibles/no)
[X] Filtro stock en picker (Todos / Disponibles / No disp.)
[X] Confirmados con filtros mes/tienda/año
[X] PWA con SW v217 + login bg con foto del río
[X] Boton "Forzar actualizacion" (↻) + "Reubicar pines" (📍) + "REFRESCAR APP" mobile
[X] Banner version + chequeo sync HTML vs SW en console al arrancar
[X] Botón Recalcular Rutas en la pestaña Rutas
[X] Sidebar Localidades incluye altas SAP (suma POINTS + sapLocs) + modal localidad con detalle por tienda (v198+)
[X] Burbujas agregadas del mapa OFF por flag SHOW_AGG_BUBBLES = false (v199+)
[X] Master Clientes: botón Eliminar 🗑 por fila (admin/gerente) — SAP altas y POINTS legacy (v200+)
[X] Zonas: gerente puede reasignar + scope "Por provincia" + toast verde con detalle de cambios (v201/v203)
[X] Mail Rendiciones cron Lun/Mie 9am AR con hyperlink Firebase Storage a foto del ticket + Tablas Excel nombradas (v202+)
[X] Integración SharePoint + Power Automate: ítems creados automáticamente en lista "ANTICIPO Y RENDICION DE GASTO" del team SAR (v203)
[X] Gerente: canWrite + abre CAMPAÑAS/SAP + ve todos los pedidos (lista CONFIRMADOS poblada) + edita rutas del mes (v205/v208/v214/v215)
[X] Card precaución más visible: amber-200 + franja marrón izquierda 5px (v206)
[X] Progreso de campañas GLOBAL (suma todos los vendedores del scope, no solo el propio) (v207)
[X] TARGETS-ZONAS reescrito: solo BPs vivos con CardCode SAP + columna CARDCODE SAP (v208)
[X] "Exportar para Análisis" restringido a Mariano (v208)
[X] **SEGUIMIENTO**: panel comercial completo para admin/gerente/interno con 7 tabs + timeline cliente + notas internas + status flow (v209-v212)
[X] Botón "Recalcular contornos de zonas" en topleft del mapa (admin/gerente) (v213)
[X] Botón ZONAS sin ícono emoji (v214)
[X] Tildar pedido bloqueado en SAP — fix cleanup de sapPendSelection (v216)
[X] Rendiciones v2: TablaGastos agrupada por dupla (vendedor, tipoGasto) + hoja "Detalle" sin agrupar para auditoría + fotos pre-subidas a Storage y concatenadas (v217)
[X] Master Clientes: botón "👤 Provisorios" violeta filtra altas rápidas pendientes de SAP (manualSapPending && !cardCodeSap) con badge de conteo en tiempo real (v290+)
[X] Master Clientes: autosave debounced 900ms en localidad/provincia/dirección de filas SAP + listener de approvedAltas no re-renderea si hay saves en vuelo (v291+)
[X] Fix crítico sync SAP: sync_sap_to_firestore.py ya NO pisa localidad/provincia con vacío si SAP no trae valor (evita destruir edits manuales del admin cada 30 min) (v291+)
[X] KPI **LEADS** del header (renombrado de "PENDIENTES" en v386) = provisorios de Alta Rápida pendientes de cargar a SAP (`manualSapPending && !cardCodeSap`), **filtrado por zona/provincia/localidad activos** (v386). El badge "Provisorios" del Master Clientes sigue mostrando el total global (v292+, sin cambio)
[X] Fix tab "NO CONFIRMADOS" en CLIENTES: mostraba solo 3 cuando el KPI decía 16. Ahora todo provisorio (manualSapPending && !cardCodeSap) aparece siempre en "No confirmados", sin requerir provincia y sin filtrar por hasGeo/hasAddr — mismo criterio que getProvisoriosList() (v293+)
[X] CUIT opcional en form Alta Rápida — habilita match automático confiable cuando el sync SAP corre (find_match usa CUIT como criterio prioritario después de CardCode) (v294+)
[X] Botón "🔗 Vincular con SAP" en Master Clientes → Provisorios: modal con lista de BPs SAP disponibles, buscador y auto-ranking por CUIT match. Copia CardCode al provisorio + elimina el BP SAP duplicado + preserva assignedVendor/approvals/notas (v294+)
[X] Badge de categoría (Cat P/A/B/C) fijado en la esquina superior derecha de cada card de CLIENTES (`position:absolute` + padding-right en la card) — siempre visible al escanear la lista. En PEDIDOS va en el cluster derecho arriba del badge Habilitado (v295+)
[X] Ortografía "MOSTRADO" → "MOSTRADOR" en form de visita (Tipo de venta + Necesidad puntual + label ponderación) + display en modal cliente + headers Excel (`Pond Mostrador`, `% Mostrador`). Value en DB sigue siendo `MOSTRADO` para no romper visitas históricas; se mapea al mostrar (v296+)
[X] Botón "📊 Exportar Excel" en modal Targets → XLSX formato largo (SlpCode, Vendedor, Año, Mes, Meta) — una fila por vendedor+mes con target > 0. SlpCode resuelto desde `sap_vendors`, Vendedor usa `slpName` de SAP (fallback titleCase). Uso: importar a SAP / Power BI (v297+)
[X] Gerente ve TODAS las visitas de todos los vendedores + comentarios (pedido de Pablo). Fix client-side de 2 líneas — Firestore Rules ya lo permitía (v298+)
[X] Form Visita: buscar directo por tienda (localidad se autocompleta) — pedido vendedores, ahorra un paso y evita el problema "no sé qué localidad es". Badge celeste 📍 muestra la localidad detectada (v299+)
[X] Bulk import de 103 nombres de fantasía desde Excel formulario (match por CUIT) + fix del cron `sync_sap_to_firestore.py` que pisaba fantasías manuales cada 30 min (mismo patrón v291 con localidad/provincia). Los nombres cargados ahora sobreviven al sync
[X] Buscador de tienda en form Visita ahora matchea por fantasía **O** titular (label muestra `"Fantasía (Titular) — Loc, Prov"`) — antes solo por titular (v300+)
[X] **Bulk fix de 22 provincias mal cargadas** (bug SAP prod - YAMIN CHUBUT→SALTA, TOMPY CHUBUT→SALTA, etc.) cruzando por CUIT contra el Excel formulario. Con validación de lista canónica (24 provincias AR + CABA) para no aceptar valores raros como "BS AS" o "7600.0". Sync SAP extendido con protección analog a fantasía: si `provinciaLocSource != 'sap_sync'`, no pisa provincia/localidad
[X] Modal de pedido PENDIENTE ahora muestra **vista previa del pedido cargado + sugeridos side-by-side** para poder comparar (antes solo sugeridos ocupando todo el ancho). Read-only, click "Volver a borrador" para editar (v301+)
[X] **Modal ZONAS ahora muestra provisorios (Alta Rápida sin cardCodeSap)** con badge amarillo "⚡ PROVISORIO" para que el gerente pueda asignarles vendedor apenas se dan de alta. Antes el filtro `!cardCodeSap → skip` los excluía y quedaban sin vendedor hasta que finanzas los cargara a SAP. Ya no requiere dirección tampoco (los provisorios pueden entrar sin calle) (v302+)
[X] **Master Clientes → tab Provisorios**: nombre del comercio y vendedor ahora **editables inline** con autosave. Nombre: input que escribe a `comercio` (o `fantasia` si no había comercio). Vendedor: `<select>` con VDE + VDI que escribe a `assignedVendor` y resuelve `ownerUid` matcheando displayName en roles (así el vendedor asignado ve el provisorio en su lista personal). Antes eran texto readonly y solo se podía editar desde el modal ZONAS (v302+)
[X] **Master Clientes vista normal**: mismo edit inline (nombre + vendedor) para filas provisorias mezcladas con SAP habilitados. Antes v302 solo funcionaba en el modo botón violeta "Provisorios"; ahora también en la vista default cuando el filtro devuelve un provisorio (v303+)
[X] **Reorganización barra superior**: botón "Dashboard" movido desde la grilla de tabs (Localidades/Clientes/Pedidos/etc) hacia la barra superior derecha, al lado de "Campañas Activas" (mismo estilo turquesa `.btn-dashboard` que ya existía). Nueva tab **"Contactado"** ocupa el lugar donde estaba Dashboard en la grilla — sección placeholder en construcción, a definir contenido en próxima iteración (v304+)
[X] **Tab Contactado funcional (Fase A)**: reutiliza el modal Visita en modo `contacto`. Cambios visuales: header teal, título "Registro de Contacto (no presencial)", oculta filas de fotos (Espacio + Frente del local), botón dice "Registrar contacto". Guarda en la misma colección `visits` con nuevo campo `interactionType='contacto'` (default `'visita'` para retro-compat). Los docs viejos sin el campo se leen como visita. Fase B pendiente: badges "Visita"/"Contactado" en renderers de "última interacción" en Pedidos/Rutas/Dashboard (v305+)
[X] **UI polish**: tab Contactado pasa de teal a celeste `#00A9E0` (mismo grupo que Rutas y Visita para consistencia visual). Botón Dashboard de la barra superior pasa de celeste a bordó `#7f1d1d` para diferenciarse del grupo tabs celeste. Master Clientes → Provisorios: Localidad y Provincia editables inline con autosave (mismo patrón que las filas SAP habilitadas), marcan `provinciaLocSource='manual'` y limpian lat/lng para forzar re-geocoding (v306+)
[X] **Tab Contactado Fase B — última interacción**: 1) Menú contextual de cliente: "Revisar última visita" → "Última interacción". 2) Modal cv-modal: título → "Última interacción" + badge visual por tipo (`🟣 Visita` violet / `📱 Contacto` teal) en el header de la interacción más reciente. 3) Contador de anteriores desglosa "+ N interacciones (X visitas + Y contactos)". 4) Lista "Mis visitas": nuevo filtro dropdown "Visitas + Contactos / Solo visitas / Solo contactos" + badge visual por card. Renderer trata docs sin `interactionType` como visita (retro-compat) (v307+)
[X] **Rendiciones: foto ticket migrada a Firebase Storage** (v308). El submit ahora sube la foto a Storage (bucket `rendiciones/{ownerUid}/{ts}_ticket.{ext}`) y guarda solo `fotoTicketUrl` en Firestore (vs base64 embebido pre-v308 que pesaba 50-500KB/doc y rompía Power BI Import mode a escala). Retro-migradas 45 fotos históricas con `scripts/migrate_rendiciones_foto_to_storage.py`. Retro-compat en `openRendicionDetail` y export Excel: prefieren `fotoTicketUrl` sino caen a `fotoTicket` base64. 2 vistas nuevas en BigQuery: **`v_rendiciones`** (46 filas, todos los campos aplanados + flags `tiene_comprobante_fiscal`/`pendiente_aprobacion`) y **`v_rendiciones_duplicados`** (alerta: mismo vendor + fecha + importe con count>1). Total actual: $1.86M en 46 tickets (v308+)
[X] **Directores del área: auto-aprobación de rendiciones** (v309). Lista blanca `SELF_APPROVE_RENDICIONES_EMAILS` con `diego.valsi@shimano.uy` (director). Diego (o cualquier email agregado a la lista) puede rendir gastos + solicitudes sin necesidad de un approver externo asignado en Panel Usuarios. El doc queda con `status='approved'` desde el submit + `approvedBy=self` + `approvalNote='Auto-aprobada (director del area)'`. Skip de notificación al approver. Aplica a `submitRendGasto` y `submitRendSolicitud` (v309+)
[X] **Targets: autosave al escribir** (v310). Antes: el usuario tenía que apretar "Guardar Targets" al final; si cerraba el modal antes se perdían los cambios. Ahora: `onTgtInputChange` programa `_saveTargetFor(id)` con debounce 900ms, guarda automáticamente. Feedback visual con clases `.saving` (azul) y `.saved` (verde flash 1.2s). `closeTargetsPanel` hace flush sync de cualquier pendiente antes de cerrar (safety para cierre inmediato). El botón "Guardar Targets" queda como fallback (v310+)
[X] **Targets descompuestos por familia REEL/CAÑAS/LÍNEAS** (v311). El modal Targets ahora tiene 3 columnas de familia (Reel/Cañas/Líneas) + columna Total (readonly, calculado en vivo). Cargás cada familia y el total del mes es la suma. Firestore: doc `targets/{seller}_{y}_{MM}` agrega campo `targetByFamily: {REEL, CANAS, LINEAS}`. `targetArs` se mantiene como suma (retro-compat con v_targets, PBI, exports). Sync grande: `sync_sap_to_bigquery.py` aplana el map a 3 columnas explícitas `target_reel_ars`, `target_canas_ars`, `target_lineas_ars`. Vista `v_targets` amplía con esas 3 columnas — docs pre-v311 quedan con null (retro-compat total, `target_ars` sigue funcionando) (v311+)
[X] **Export masterfile de Clientes incluye provisorios** (v312). Antes el export "Clientes (masterfile)" filtraba `!cardCodeSap → skip`, dejando afuera todos los provisorios (Alta rápida). Ahora se detecta `isProvisorio = manualSapPending && !cardCodeSap` y entran con `Tipo="Provisorio (Alta rapida)"` + `Estado="Provisorio"`. El gerente ve el universo comercial completo, no solo lo cerrado en SAP. Fix menor: `seen.add(dupKey)` que faltaba (evita duplicados si un habilitado y un provisorio tenían el mismo nombre) (v312+)
[X] **Buscadores flexibles multi-token AND** (v313). Nuevo helper `matchesAllTokens(haystack, query)` divide el query por espacios y exige que TODOS los tokens aparezcan en el haystack concatenado. Normaliza acentos vía NFD (á→a, ñ→n). Aplicado en 4 buscadores: (1) CLIENTES sidebar (`clientMatchesQuery` + SAP altas inline), (2) PEDIDOS sidebar (fallback SAP altas), (3) Master Clientes vista normal, (4) Master Clientes tab Provisorios. Ejemplos que ahora funcionan: `"el pez gordo quilmes"`, `"pescamagic buenos aires"`, `"gonzalo cordoba"`. Orden no importa (v313+)
[X] **Registro de Contacto agrega campo Forma de contacto** (v314). En el modal Visita en modo `contacto`, después de "Tipo de tienda" aparece un select nuevo obligatorio con 3 opciones: `LLAMADA TELEFONICA / MENSAJE DE WHATSAPP / MENSAJE SMS`. `applyVisitModeUI` lo muestra/oculta según modo. `submitVisita` agrega validación y guarda `formaContacto` en el doc (queda `''` en modo visita presencial). BQ: `v_visitas` expone nueva columna `forma_contacto` (STRING) para desglose PBI "Contactos por canal" (v314+)
[X] **Buscador de tiendas del form Visita: badge "⚡ PROVISORIO" + refresh en vivo** (v315). Antes en el dropdown solo aparecía un emoji chico `⚡` que se pasaba por alto y provocaba que el vendedor picara un POINT del padrón por error. Ahora el badge es texto llamativo `⚡ PROVISORIO`. Además, cuando llega snapshot de `approvedAltasList` y el modal Visita está abierto (form "Nueva"), se re-populate el dropdown para incluir provisorios recién creados. Guardián: si el input `vf-tienda-search` tiene foco (usuario escribiendo), difiere el re-populate para no interrumpir la búsqueda (v315+)
[X] **Detector de duplicados SAP vs Provisorios (visual, sin borrar)** (v316). Cuando finanzas carga a SAP un cliente que ya existía como Alta Rápida, la app termina con 2 docs. Helper `findSapDuplicateForProvisorio(prov)` busca en `approvedAltasList` un SAP habilitado con misma provincia + localidad + nombre similar (contains cruzado o ≥2 tokens significativos comunes de ≥3 letras, excluyendo stopwords `de/la/el/pesca/tienda/store/srl/etc`). Si detecta match: fila roja `#fee2e2` + borde izquierdo rojo + badge `⚠ DUPLICADO SAP CXXXXXX` + tooltip con nombre del SAP. Aplica en Master Clientes tab Provisorios + vista normal. Cero deleteo automático — admin decide manualmente (v316+)
[X] **Cards de clientes coloreadas por origen** (v317). Sidebar CLIENTES + tab PEDIDOS: cards ahora tienen fondo distintivo según el origen del cliente. **Celeste clarito `#e0f2fe`** (con borde izquierdo azul) para **Provisorios** (`manualSapPending && !cardCodeSap`). **Verde clarito `#dcfce7`** (borde izquierdo verde) para **SAP habilitados** (con `cardCodeSap`). Precaución (amarillo `#fde68a`) mantiene prioridad máxima sobre ambos. El vendedor distingue de un vistazo qué clientes ya están en SAP vs cuáles todavía son alta rápida pendiente (v317+)
[X] **Badge SAP/PROVISORIO en línea meta** (v319, iteración desde v318). El badge del cardCode / PROVISORIO se movió de al lado del nombre (que apretaba nombres largos) a la **línea meta abajo**, junto al `✓ SAP EN MAPA` y la localidad. Estilo `cli-origen-inline` (display inline-flex sin position:absolute). Colores mantenidos: verde clarito para SAP habilitado, ámbar para provisorio (v319+)
[X] **Filtros sidebar CLIENTES renombrados**: `CONFIRMADOS` → **`CLIENTE EN SAP`** y `NO CONFIRMADOS` → **`PROVISORIOS`**. Alineación semántica con los colores de cards (verde=SAP, celeste=provisorio). Los valores internos siguen siendo `confirmados`/`pendientes` para no romper referencias del código (v320+)
[X] **Cards SAP: localidad y provincia en línea separada** (v321). Antes badges + localidad + provincia iban todos en la misma línea `client-meta`; con CardCodes largos o localidades extensas se apretaba y la provincia bajaba sola (roto visual). Ahora `client-meta` se divide en 2 divs consecutivos: fila 1 con badges (SAP EN MAPA + SAP/PROVISORIO), fila 2 con Localidad / Provincia. Layout consistente sin importar largo de los datos (v321+)
[X] **Notificaciones: botón "Marcar todas como leídas"** (v322). En la tab Recibidas, un header nuevo arriba de la lista muestra `N pendientes` + botón teal. Al apretar: confirm previo (con el N para evitar accidentes con 280+ ops) → **batch write en Firestore** (loops de 400 ops por batch, respeta límite de 500). El listener `onSnapshot` limpia la lista al toque. Reversible una por una desde tab "Realizadas" (v322+)
[X] **Performance: geometrías del mapa lazy-loaded** (v323). Las constantes `DEPT_GEO` (1.37 MB, 527 departamentos) y `PROV_GEO` (400 KB, 24 provincias) se extrajeron a `geo.json` externo (1.56 MB). El HTML principal baja de **3.74 MB → 2.01 MB (-46%)**. Al arranque las variables son `{features: []}` vacías; un `fetch('./geo.json')` async las popula y re-renderiza `deptLayer`/`provLayer`/`vendorProvinces`/outlines. Login más rápido (menos parseo JS bloqueante). SW pre-cachea `geo.json` al instalar para que la segunda carga sea instant (v323+)
```

### Bloqueantes externos para el lanzamiento

| # | Bloqueante | Responsable | Estado |
|---|---|---|---|
| 1 | **CORS habilitado en Apache** delante del Service Layer | Alejandro Caracchi (SEIDOR) | ✅ Resuelto (SL responde desde el browser + GitHub Actions) |
| 2 | **Usuario integración** en SAP (licencia Limited CRM o Logistics) | Juan (IT Shimano) | ✅ Resuelto (`APP_VENDEDORES` operativo) |
| 3 | **UDFs + Serie APP 103 en PROD** (SHIMANO_SAU) | Ezequiel Mendoza (SEIDOR) | ⏳ Pendiente confirmación en PROD (funciona en TST_06) |

### Plan de contingencia

Si el punto 3 no llega a tiempo, **arrancamos con el ZIP DTW manual** que ya está probado y funcional. Admin descarga el ZIP de pedidos confirmados, lo importa en DTW, los pedidos entran como Quotations. El DTW manual queda como **backup permanente** incluso con Service Layer operativo.

### Última prueba E2E exitosa

**Fecha**: 2026-06-19 — DTW import OK en SHIMANO_TST_06.
- **Pedido**: `f896nK70TWpu9KJxSs6j`
- **Sales Quotation creada**: APP-2000000
- **Cliente**: GUSTAVO BARGELLINI (CardCode `C20220956513`)
- **2 líneas**: `CAC58MH2UR` x 2 + `CAC66MH2UR` x 2 en W07
- **UDFs poblados OK**: `U_AppOrigen = SHIMANO_APP_VENDEDORES`, `U_AppOrderId`, `U_AppBatchId`, `U_TipoGasto = CONDICION`
- **Sales Employee**: Gonzalo de la Rosa (mapeo SlpCode OK)
- **Status**: Open (sin Approval Procedure — Santiago aprueba manualmente)

---

## 3) Stack técnico

| Capa | Tecnología | Versión / detalle |
|---|---|---|
| Frontend | HTML5 + CSS3 + Vanilla JavaScript | — |
| Mapa | Leaflet | 1.9.4 (CDN unpkg) |
| Tiles | CartoDB Positron | OSM stack |
| Excel | SheetJS (xlsx) | 0.18.5 (CDN jsdelivr) |
| Excel con fotos embebidas | ExcelJS | 4.4.0 (lazy load, solo al exportar) |
| ZIP | JSZip | 3.10.1 (CDN cloudflare) |
| Auth + DB | Firebase compat SDK | 10.7.1 (auth + firestore) |
| QR | qrcode.js (davidshimjs) | 1.0.0 (CDN cloudflare cdnjs) — para setup 2FA |
| OCR | Google Gemini API | `gemini-2.5-flash` (REST) |
| Geocoding | OpenStreetMap Nominatim | gratis, country=AR |
| Hosting | GitHub Pages | rama `main` |
| Build offline | Python 3 + openpyxl | genera HTML desde Excels |
| Storage local | localStorage + IndexedDB | persistencia y cache |
| SAP B1 backend (futuro) | Service Layer v1 | puerto 50000, https con cert GoDaddy |

**Sin Node, sin Webpack, sin TypeScript, sin React.** Una elección deliberada para minimizar fricciones de mantenimiento: cualquier persona con conocimientos de JS y HTML puede editar el código.

---

## 4) Estructura del repo

```
shimano-arg/app-vendedores/
├── index.html                # App completa (~3.2 MB - todo embebido)
├── alta-cliente.html         # Formulario público standalone (link compartible)
├── manifest.json             # PWA manifest
├── sw.js                     # Service Worker (CACHE_VERSION sincronizada con APP_VERSION; hoy v364)
├── login-bg.jpg              # Foto de fondo del login (río al amanecer)
├── stock.json                # Snapshot fresco del stock SAP (autogenerado por
│                             #  sync_sap_to_firestore.py cada 30 min - lo consume
│                             #  el Google Sheet "Inventario-Bot" via raw.github)
├── firebase.json             # Config de firebase deploy (firestore rules + functions + storage rules)
├── firestore.rules           # Security rules de Firestore (deployadas 2026-07-27, sección 9)
├── firestore.indexes.json    # Indices compuestos de Firestore
├── storage.rules             # (v364+) Security rules de Cloud Storage — path rendiciones/{ownerUid}/*.
│                             #  Reemplazan las test-mode que expiraban 2026-07-30. Deploy con
│                             #  `firebase deploy --only storage --project=app-vendedores-shimano`.
├── .nojekyll                 # (v252+) Deshabilita procesamiento Jekyll en Pages
├── Shimano-Logo.png          # Logo (header + splash)
├── icon-180-v3.png           # PWA icon iOS 180×180
├── icon-192-v3.png           # PWA icon Android 192×192
├── icon-512-v3.png           # PWA icon 512×512 (any)
├── icon-512-maskable-v3.png  # PWA icon 512×512 (maskable Android adaptive)
├── .github/
│   └── workflows/
│       ├── sync-sap-catalog-stock.yml  # (v246+) Cron 13,43 * * * * : Service Layer
│       │                               #  → Firestore (catalog + stock_snapshot) +
│       │                               #  commit stock.json si cambia. Reemplazo
│       │                               #  del legacy sync-stock (CSV manual).
│       ├── sync-stock.yml              # LEGACY (cron desactivado). Dispatch manual
│       │                               #  como respaldo. Depende del CSV que David
│       │                               #  subia a Drive - ya no se usa.
│       └── send-rendiciones-email.yml  # Cron Lun/Mie 9am AR: Excel + mail rendiciones aprobadas
├── scripts/                     # ~30 scripts Python, agrupados por rol:
│   ├── sync_sap_to_firestore.py     # Cron cada 30min: SAP → Firestore (BPs, items, stock)
│   ├── sync_sap_to_bigquery.py      # Cron cada 30min: SAP + Firestore.targets → BigQuery
│   ├── send_rendiciones_email.py    # Cron Lun/Mie: mail de rendiciones aprobadas
│   ├── sync_stock.py                # LEGACY (deprecated 2026-06-18)
│   ├── bootstrap_targets_to_bigquery.py     # Carga inicial de targets a BQ
│   ├── bulk_import_fantasias_from_excel.py  # Cargar 103 fantasías por CUIT match
│   ├── bulk_fix_provincia_localidad_from_excel.py # Fix 22 provincias mal cargadas
│   ├── audit_targets.py             # Diagnóstico read-only de la colección targets
│   ├── verify_fantasias_in_firestore.py     # Verifica fantasías post bulk
│   ├── check_provincias_salta.py    # Debug de valores de provincia
│   ├── check_salta_matching.py      # Cruce POINTS vs client_applications
│   ├── query_sap_sales_persons.py   # Consulta /SalesPersons de SAP prod
│   ├── query_sap_sales_persons_test.py # Idem TEST DB (SHIMANO_TST_06)
│   ├── diagnose_inventario_gap.py   # Diagnóstico del gap backorder vs inventario
│   ├── test_inventario_fix.py       # Dry-run del fix del enriched view
│   ├── dryrun_new_views.py          # Dry-run 4 CREATE OR REPLACE VIEW
│   ├── verify_inventario_post_deploy.py # Verificaciones de aceptación post deploy
│   ├── apply_v_targets.py           # Aplica solo v_targets + verificaciones
│   ├── apply_v_campanias.py         # (v367+) Bootstrap: sync campaigns + aplica 3 vistas v_campanias_*
│   ├── apply_credit_notes_fix.py    # (v367+) Bootstrap: fetch inicial /b1s/v1/CreditNotes + aplica v_facturas_sap/v_ventas_lineas con UNION
│   ├── apply_dashboard_snapshot.py  # (v367+) Bootstrap: query BQ agregada + escribe sap_snapshot en Firestore (alimenta Dashboard app)
│   ├── apply_facturas_sap_slim.py   # Aplica v_facturas_sap sin lines_json (fix VertiPaq)
│   ├── rollback_v_inventario.py     # Rollback quirúrgico v_inventario a pre-fix
│   ├── redeploy_views.py            # Aplica todos los CREATE OR REPLACE VIEW
│   ├── smoke_inventario.py          # Smoke test de v_inventario post-deploy
│   ├── smoke_ventas_backorder.py    # Smoke test de ventas y backorder
│   ├── smoke_pedidos_lines.py       # Smoke test rápido de vistas BQ
│   ├── explore_targets_pipeline.py  # Investigación inicial pre-v_targets
│   ├── validate_slp_mapping.py      # Validar mapeo canónico app → SlpCode SAP
│   ├── inspect_shimano_fishing_excel.py  # Inspección Excel formulario alta
│   ├── build_manual_shimano.py      # Generador PDF "APP SHIMANO MANUAL" (33 pág)
│   ├── build_mejoras_shimano.py     # Generador PDF "MEJORAS" (21 pág, análisis crítico)
│   └── [otros scripts diagnóstico legacy]
├── bigquery/
│   └── views.sql                # 9 vistas curadas para Power BI
├── PLAN_POWERBI.md              # Plan 4 días Firestore → BigQuery → Power BI
├── POWER_AUTOMATE_RENDICIONES.md # Doc operativo del flow de SharePoint
├── Roadmap_Integracion_App_SAP.md
├── Solicitud_SEIDOR_Integracion_App.md
├── Pitch_Lunes_App_Vendedores.md
└── README.md                    # Este archivo (documentación viva del proyecto)
```

**Docs complementarias en Desktop** (generadas por scripts, no versionadas en Git):
- `~/Desktop/APP SHIMANO MANUAL.pdf` (33 pág) — Manual técnico completo pensado para sucesor: qué usa la app, cómo funciona cada componente, roles, contactos, runbook. Se regenera con `python scripts/build_manual_shimano.py`.
- `~/Desktop/MEJORAS.pdf` (21 pág) — Análisis crítico del estado actual con 12 puntos débiles priorizados + roadmap por horizontes (Sprint 1, Sprint 2, Q1, S1). Se regenera con `python scripts/build_mejoras_shimano.py`.

### Archivos generados (no en repo)

Los siguientes archivos viven en el desktop de Mariano (fuera del repo):

- `C:\Users\shimano.sandbox\Desktop\MASTERFILES\PROSPECTOS\MAPAS\_build_argentina_zonas_v2.py` — Build script principal
- `C:\Users\shimano.sandbox\Desktop\MASTERFILES\PROSPECTOS\MAPAS\Mapa_Argentina_Shimano_Zonas.html` — Output del build (= `index.html`)
- `C:\Users\shimano.sandbox\Desktop\MASTERFILES\ZONAS\TARGETS VENDEDORES-ZONAS.xlsx` — Excel master con clientes
- `C:\Users\shimano.sandbox\Desktop\FORECAST\DATOS_CRUDOS\Masterfile Shimano Venta Ult 365 Días.xlsx` — Excel histórico ventas MELI (deprecado, ahora se usa historial app)
- `C:\Users\shimano.sandbox\Desktop\LANZAMIENTO-APP-FALTANTES.txt` — Punteo de bloqueantes para lanzamiento

---

## 5) Pipeline de build

### Cuándo regenerar el HTML

- Cambios en el código JS/CSS embebido en el build script
- Actualización del Excel master de clientes
- Actualización del Excel de productos
- Actualización de polígonos geo (mapas provinciales)
- Cambio de provincias asignadas a VDIs

### Cómo regenerar

```bash
cd "C:/Users/shimano.sandbox/Desktop/MASTERFILES/PROSPECTOS/MAPAS"
python -c "import sys; sys.stdout.reconfigure(encoding='utf-8'); exec(open(r'_build_argentina_zonas_v2.py', encoding='utf-8').read())"
```

El script:
1. Lee los HTMLs provinciales en `MASTERFILES/PROSPECTOS/MAPAS/` (uno por provincia).
2. Lee el Excel master de clientes (`TARGETS VENDEDORES-ZONAS.xlsx`).
3. Lee el Excel histórico de ventas MELI (deprecado, ahora se usa historial app).
4. Lee el Excel de targets de vendedores.
5. Lee el Excel master de productos (665 SKUs).
6. Calcula asignaciones por provincia (incluyendo el hardcode VDI Patagonia/NOA-NEA).
7. Aplica el guardrail para excluir distribuidores en BA/CABA/Córdoba/Santa Fe.
8. Inyecta TODO en el template HTML.
9. Genera `Mapa_Argentina_Shimano_Zonas.html`.

### Deploy

```bash
cp "C:/Users/shimano.sandbox/Desktop/MASTERFILES/PROSPECTOS/MAPAS/Mapa_Argentina_Shimano_Zonas.html" \
   "C:/Users/shimano.sandbox/Desktop/APP VENDEDORES/index.html"
cd "C:/Users/shimano.sandbox/Desktop/APP VENDEDORES"
# Bumpear sw.js: CACHE_VERSION = 'v217' → 'v218' (+ APP_VERSION en index.html)
git add index.html sw.js
git commit -m "Mensaje claro de cambio"
git push
```

GitHub Pages propaga en 1-5 minutos. Los usuarios reciben el SW nuevo cuando cierran y abren la PWA (o hacen Ctrl+Shift+R).

---

## 6) Sistema de autenticación y autorización

### Flujo de login

1. **Usuario abre la URL** → ve splash + spinner "Cargando sesión..." (foto fondo: río al amanecer).
2. **Firebase auth.onAuthStateChanged()** chequea si hay sesión guardada en IndexedDB.
3. Si **hay sesión** → directo al password gate (PIN de 4 dígitos).
4. Si **no hay sesión** → la pantalla muestra **4 alternativas** de login:
   - **Continuar con Google** (`signInWithRedirect` + provider Google).
   - **Continuar con Microsoft** (`signInWithRedirect` + `OAuthProvider('microsoft.com')`, Azure AD).
   - **Email + contraseña** (`signInWithEmailAndPassword`).
   - **Continuar con email** (magic link / passwordless: `sendSignInLinkToEmail` → el usuario clickea el link recibido por mail → `signInWithEmailLink` cierra el flow).
5. **Password gate** (PIN) → admin lo configura desde panel Usuarios (legacy, sigue funcionando).
6. **2FA** (opcional para cualquier rol) → Authenticator de Google con QR.

### Persistencia de sesión

- `setPersistence(LOCAL)` → IndexedDB.
- En iOS PWA standalone hay un edge case conocido: iOS borra IndexedDB de PWAs "inactivas" después de 7 días. Si el usuario abre la app esporádicamente, se le pide login de nuevo.

### Roles

- **Bootstrap**: el primer email en hacer login se auto-eleva a `admin` si está en la lista de `BOOTSTRAP_ADMIN_EMAILS` (hardcoded en el código): `bot.shimano.pesca@gmail.com` y `erbinomariano@gmail.com`.
- **Otros usuarios**: arrancan como `unassigned` y el admin les asigna rol desde el panel Usuarios.

### 2FA (Two-Factor Authentication)

- **Opcional para todos los roles** (antes era obligatorio para admin; desde v178+ ya no se fuerza).
- Path: panel Usuarios → botón `🔐 2FA` del usuario → genera QR → usuario escanea con Google Authenticator → ingresa 6 dígitos para validar.
- Si el rol requiere 2FA y no está configurado, la app muestra pantalla bloqueante "Pedile al admin que te configure el 2FA".
- TTL del último check: 30 días (se guarda timestamp en localStorage).

### Reset de password

Panel Usuarios → botón **🔐 Contraseña** del usuario abre un modal con **2 opciones**:

1. **Mandar mail de reset** (`fbAuth.sendPasswordResetEmail(email)`): el usuario recibe un link de Firebase para fijarse una contraseña nueva. Recomendado para usuarios con login Email/contraseña o Magic link.
2. **PIN legacy** (gate de 4 dígitos): se mantiene para no romper el flow histórico de los usuarios que ya tenían PIN configurado.

### `allowed_emails` (pre-autorizaciones)

Admin puede pre-autorizar emails desde el panel admin antes de que se logueen. Cuando ese email se loguea por primera vez, se le asigna el rol pre-cargado.

---

## 7) Roles y permisos

| Rol | Quién | Qué puede hacer |
|---|---|---|
| **`admin`** | Mariano, Diego | Todo: panel admin, modal Zonas, Master Clientes, SAP, Stock, Backup, Targets, aprobar altas, Auditoría, Seguimiento, "Exportar para Análisis" (solo Mariano desde v208) |
| **`gerente`** | Pablo Maraschin | Casi todo lo de admin **excepto** USUARIOS, STOCK, PRECIOS y AUDITORIA. Ve todo el mapa, aprueba Altas Clientes, aprueba Rendiciones, edita Master Clientes, reubica pines. **Desde v205+ entra a `canWrite()`** (cambia estado de cliente, renombra, categoriza, marca contactado). **Abre CAMPAÑAS + SAP + Seguimiento** (v208+). **Lee TODOS los pedidos** (necesario para tab CONFIRMADOS y filtros, v215+). **Carga visitas / marca contactado en cualquier ruta del mes** (v214+). |
| **`vendedor`** | VDEs (Mauricio, Martin, Gonzalo, Federico) | Ver SOLO su zona, crear pedidos/visitas propios, cargar Alta Cliente |
| **`interno`** | VDIs (Santiago, Ioannis) | Ver zonas de sus VDEs pareja, crear pedidos/visitas en nombre del VDE pareja. **Acceso a SEGUIMIENTO** (con scope acotado a sus parejas, v209+). **Carga visitas / marca contactado en rutas de sus VDEs** (v214+). |
| **`viewer`** | Solo lectura | Ve todo pero no escribe nada |
| **`unassigned`** | Usuarios nuevos sin rol | Pantalla "Tu usuario aún no tiene rol asignado. Pedile al admin que te habilite." |

### Restricción por rol al filtrar mapa

Implementado en `getMyAllowedVendorKeys()`:
- **admin / gerente / viewer**: `null` (sin restricción, ven todo) — `gerente` se sumó al null-bucket en v182+ para que pueda ver el mapa completo.
- **vendedor**: `Set([assignedVendor])` (solo su zona)
- **interno**: `Set([vendorKeys de sus parejas VDE])` (ej: Santiago ve Z4+Z5)
- **unassigned**: `Set()` (no ve nada)

### Pareja VDI ↔ VDE

Configurado en `roles/{uid}.internalPartnerUid`. Cada VDE tiene un VDI asignado como pareja. El VDI puede:
- Ver las tiendas del VDE en su filtro Zona.
- Crear pedidos/visitas en nombre del VDE (`onBehalfOf: true` + `createdByUid: VDI` + `ownerUid: VDE`).
- Aprobar Altas Clientes.

Las parejas estándar son:
- **Federico** (Z2) ↔ Ioannis (VDI)
- **Gonzalo** (Z1) ↔ Ioannis (VDI)
- **Mauricio** (Z5) ↔ Santiago (VDI)
- **Martin** (Z4) ↔ Santiago (VDI)

---

## 8) Modelo de datos Firestore

22 colecciones activas en el proyecto `app-vendedores-shimano` (las 2 nuevas son `seguimiento_notes` y `seguimiento_status`, agregadas en v209+):

### Auth y usuarios

#### `roles/{uid}`
```js
{
  email: "vendedor@shimano.com.ar",
  displayName: "Mauricio Gil",
  role: "vendedor",              // admin | vendedor | interno | viewer | gerente | unassigned
  vendor: "MAURICIO GIL",        // VENDORS.key cuando role = vendedor
  internalPartnerUid: "uid_santiago",  // VDI asignado al VDE
  whatsapp: "5491126762031",     // sin + ni espacios
  rendicionesApproverUid: "uid_gerente",
  totpEnabled: true,
  totpSecret: "BASE32...",       // base32 del secret TOTP
  totpEnabledAt: <Timestamp>,
  pin: "1234",                   // PIN encriptado (legacy)
  pinHash: "...",                // bcrypt del PIN
  protectedAdmin: true,          // los 2 admins iniciales no se pueden borrar
}
```

#### `userData/{uid}`
Estado per-usuario (sincronizado entre dispositivos):
```js
{
  contacted: ["C|BUENOS AIRES|Quilmes|JUAN PESCA", ...],   // tiendas habilitadas
  canceled: ["P|...", ...],                                  // tiendas canceladas
  orders: {key: [...lines]},                                 // pedidos en borrador
  clientMeta: {                                              // metadata custom por cliente
    "C|prov|loc|name": {
      customName: "...",
      customFantasia: "Pesca Total",   // fantasia local mostrada como "Local: XXX" en la card cliente (NUEVO)
      address: "Av. Corrientes 1234",
      locality: "Palermo",
      lat: -34.5879,
      lng: -58.4321,
      updatedAt: 1718812345678
    }
  },
  email: "user@...",
  displayName: "...",
  lastSeen: <Timestamp>,
}
```

#### `allowed_emails/{docId}`
Pre-autorizaciones. Cuando el email se loguea, se eleva al rol pre-cargado.

### Operación comercial

#### `pedidos/{pedidoId}`
```js
{
  ownerUid: "uid_vde",           // dueño del pedido (vendedor)
  ownerEmail: "...",
  createdByUid: "uid_vdi",       // quien lo cargó (puede ser VDI en nombre del VDE)
  onBehalfOf: true,              // si VDI cargó en nombre de VDE
  key: "C|prov|loc|cliente",
  stage: "pending" | "confirmed" | "sap_imported",
  tipo: "C" | "P",
  province: "BUENOS AIRES",
  locName: "Quilmes",
  clientName: "JUAN PESCA",
  month: "Junio 2026",
  monthIdx: 5,
  year: 2026,
  confirmedAt: "ISO date",
  condicionPago: "CTA CTE",      // → U_TipoGasto en SAP
  formaEntrega: {                 // v269+ (v273: agregado clienteDireccion)
    tipo: "TRANSPORTISTA" | "SUCURSAL",
    // Solo si tipo === "TRANSPORTISTA":
    transpNombre: "Cruz del Sur",
    transpDireccion: "Av. Corrientes 1234, CABA",
    clienteDireccion: "Av. Belgrano 4567, Rio Cuarto",  // destino final
    // Solo si tipo === "SUCURSAL":
    sucursalDireccion: "Av. Cabildo 4567, CABA"
  },
  lines: [
    {code: "CAC58MH2UR", desc: "...", qty: 2, precio: 12500, cat: "...", fam: "...", sub: "..."}
  ],
  transferidoSAP: {              // populado al exportar ZIP DTW o enviar por SL
    via: "dtw_manual" | "service_layer",
    docEntry: 12345,             // SL only: número interno SAP
    docNum: 2000001,             // SL only: número de Quotation
    batchId: "BATCH-20260619-...",  // DTW only
    at: <Timestamp>,
    by: "..."
  },
  createdAt: <Timestamp>,
}
```

#### `visits/{visitId}`
```js
{
  ownerUid: "...",
  ownerEmail: "...",
  fecha: "2026-06-19",
  mes: "JUNIO",
  anio: 2026,
  vendor: "MAURICIO GIL",
  provincia: "BUENOS AIRES",
  localidad: "Quilmes",
  tienda: "JUAN PESCA",
  tipo: "C",
  local: "Propio",
  tamano: "Mediano",
  fidelidad: "Alta",
  relevancia: "Alta",
  pop: "Stickers Shimano + display",
  necesidadPuntual: "...",
  tipoVenta: "Casa de pesca + ecommerce",
  ponderacionMostrado: 80,
  ponderacionEcommerce: 60,
  competencia: "Daiwa, Penn",
  oportunidad: "...",
  masVendido: "Línea Stradic",
  masPreguntan: "Cañas Caius",
  ayudaTienda: "Capacitación productos",
  frenteLocal: "data:image/jpeg;base64,...",   // foto del frente
  espacio: ["data:image/jpeg;base64,...", ...], // hasta 5 fotos
  gpsStatus: "ok" | "outside" | "noloc",
  gpsDistanceM: 25.4,
  createdAt: <Timestamp>,
}
```

#### `route_overrides/{docId}`
Derivaciones y reagendas de rutas. Cuando un vendedor deriva una tienda al VDI o reagenda para otra fecha.

#### `custom_routes/{routeId}` (NUEVO desde v182+)
Rutas armadas a medida por el propio vendedor (modo "Rutas personalizadas"):
```js
{
  ownerUid: "...",                // dueño de la ruta
  ownerEmail: "...",
  name: "Ruta Mar del Plata Mayo",
  plannedDate: "2026-06-29",      // ISO YYYY-MM-DD
  notes: "Cargar Stradic en Mostacciuolo, retirar POP en La Marea",
  stops: [
    {
      order: 0,
      key: "C|BUENOS AIRES|Mar del Plata|JUAN PESCA",
      tipo: "C" | "P",
      provincia: "BUENOS AIRES",
      localidad: "Mar del Plata",
      clientName: "JUAN PESCA",
      isProvisorio: false,        // true si es alta provisoria (manualSapPending)
      sapAltaId: "abc123",        // cuando viene de client_applications
    }
  ],
  createdAt: <Ts>,
  updatedAt: <Ts>,
}
```
El picker de tiendas para agregar stops busca en POINTS + altas SAP aprobadas + provisorias (alta rápida), respetando el filtro de vendor del usuario.

#### `campaigns/{campaignId}`
Campañas comerciales: nombre, fechas vigencia, SKUs incluidos, zonas aplicables.

#### `targets/{docId}`
Targets mensuales en ARS por vendedor + mes + año. Cargados por admin/gerente.

#### `rendiciones/{docId}`
Rendiciones de gastos con OCR Gemini de tickets. Tiene `status: pending_approval | approved | rejected`.

### Alta clientes + master

#### `client_applications/{appId}`
Solicitudes de alta de cliente con flujo de doble aprobación:
```js
{
  ownerUid: "uid_vendedor",
  ownerEmail: "...",
  ownerName: "Mauricio Gil",
  comercio: "PESCA TOTAL S.A.",
  fantasia: "Pesca Total",
  cuit: "30-12345678-9",          // v294+: opcional en Alta Rapida (input ar-cuit).
                                  // Normalizado a solo digitos. Habilita match automatico
                                  // con SAP en find_match() paso 2 (mas confiable que nombre).
  condicionFiscal: "Responsable Inscripto",
  calle: "Av. Corrientes",
  numero: "1234",
  localidad: "Palermo",
  provincia: "BUENOS AIRES",
  localidadFinal: "Palermo",     // override del aprobador si la declarada no matcheaba
  cardCodeSap: "C-12345",        // cargado por el aprobador (o por el sync SAP)
  assignedVendor: "FEDERICO CASTELANELLI",  // cargado por el aprobador
  constanciaArca: "data:image/...",
  constanciaIIBB: "data:image/...",
  fotosLocal: ["data:image/...", ...],
  status: "pending_approval" | "approved" | "rejected",
  // v294+: sap_sync_manual_link se setea cuando admin vincula manualmente un
  // provisorio con un BP SAP desde Master Clientes -> Provisorios -> Vincular.
  source: "manual" | "sap_bulk_import" | "alta_rapida" | "sap_sync" | "sap_sync_manual_link",
  manualSapPending: true,         // si vino por alta_rapida y todavía no se cargó a SAP
  // v294+ auditoria de vinculacion manual admin:
  linkedFromSapDocId: "abc123",   // fsId del BP SAP con el que se vinculo (se borra ese doc)
  linkedBy: "admin@shimano.com",  // email/uid del admin que ejecuto la vinculacion
  linkedAt: <Timestamp>,
  approvals: {
    "uid_admin": {approvedAt: <Ts>, email: "...", name: "..."},
    "uid_gerente": {approvedAt: <Ts>, email: "...", name: "..."}
  },
  approvedAt: <Timestamp>,
  rejectedByEmail: "...",
  rejectedReason: "...",
  submittedByPublicForm: false,  // true si vino del alta-cliente.html público
  createdAt: <Timestamp>,
  updatedAt: <Timestamp>,
}
```

#### `client_locations/{docId}`
GPS preciso de cada tienda (cargado durante visitas con GPS).

#### `client_master/{docId}`
Master de direcciones exactas + CardCode SAP:
```js
{
  clientName: "JUAN PESCA",
  provincia: "BUENOS AIRES",
  localidad: "Quilmes",
  vendor: "FEDERICO CASTELANELLI",
  address: "Av. Mitre 2345",
  sapCardCode: "C-12345",        // NUEVO: usado por DTW/SL
  sapAddress: "AV MITRE 2345",   // direccion raw del SAP
  sapCity: "QUILMES",
  sapState: "BUENOS AIRES",
  sapImportedAt: <Ts>,
  sapImportedBy: "admin@...",
  clientNameOriginal: "Juan Pesca",  // backup del nombre antes del import SAP
  localidadOriginal: "Quilmes",      // backup de la localidad
  matchType: "exact" | "fuzzy",
  matchSimilarity: 1.0,
  updatedAt: <Ts>,
  updatedBy: "...",
}
```

### Reasignaciones (modal Zonas)

#### `vendor_overrides/{docId}`
Reasignación de tiendas/localidades a otro vendedor:
```js
{
  scope: "shop" | "loc",
  province: "BUENOS AIRES",
  localityName: "Santa Fe",
  clientName: "AZZONI LUCAS",    // solo si scope = "shop"
  originalVendor: "MARTIN BOIERO",
  newVendor: "MAURICIO GIL" | "IOANNIS PALKOUDAKIS" | "__DISTRIBUTOR__",
  newType: "VDE" | "VDI" | "DISTRIBUIDOR" | "OTRO",
  updatedAt: <Timestamp>,
  updatedByUid: "...",
  updatedByEmail: "...",
  updatedByDisplayName: "Mariano Erbino",
}
```

### Integración SAP

#### `sap_clients/{docId}`
Mapeo `clientName → CardCode SAP`.

#### `sap_products/{docId}`
Mapeo `productCode → ItemCode SAP`.

#### `sap_vendors/{docId}`
Mapeo `vendorKey → SlpCode SAP`.

#### `app_config/{docId}`
Configuraciones globales:
- `gemini`: API key para OCR.
- `sap_integration`: Series ID, Service Layer config.
- `stock_snapshot`: snapshot actual del stock W07.

### Notificaciones y log

#### `notifications/{docId}`
Alertas + tareas + derivaciones VDI. Con imágenes embebidas.

#### `operations_log/{logId}`
Log inmutable de acciones para auditoría. Solo admin/viewer leen.

### Seguimiento (NUEVO desde v209+)

#### `seguimiento_notes/{noteId}`
Notas internas que admin/gerente/interno escriben sobre un cliente o pedido desde el Timeline de Seguimiento:
```js
{
  vendorExt: "MARTIN BOIERO",        // VDE al que aplica (clave del scope)
  clientKey: "C|CORDOBA|Rio Cuarto|PESCA TOTAL",
  clientName: "PESCA TOTAL",
  province: "CORDOBA",
  locality: "Rio Cuarto",
  text: "Pidio catalogo nuevo. Llamar 22/Jun.",
  authorUid: "uid_pablo",
  authorEmail: "pablo@shimano.uy",
  authorName: "Pablo Maraschin",
  authorRole: "gerente",             // admin | gerente | interno
  createdAt: <Timestamp>,
}
```

#### `seguimiento_status/{statusId}`
Estado de un item pendiente o oportunidad. Permite cerrar manualmente un pendiente auto-detectado:
```js
{
  vendorExt: "MARTIN BOIERO",
  itemId: "<id de la visita o pedido>",
  itemType: "visit_no_order" | "pending_order" | "opportunity",
  status: "pendiente" | "revisado" | "resuelto",
  updatedByUid: "...",
  updatedByEmail: "...",
  updatedAt: <Timestamp>,
}
```

---

## 9) Firestore Security Rules

Reglas vigentes (versión actual). Resumen de qué puede hacer cada rol:

| Colección | Read | Write |
|---|---|---|
| `roles` | propio doc + admin | admin (update/delete), usuario propio (create con role unassigned/admin) |
| `userData` | propio + admin/viewer | propio + admin |
| `pedidos` | todos los readers | admin/gerente / vendedor (su propio) / **interno propio (v279+)** / interno en nombre del VDE pareja |
| `visits` | todos | admin / vendedor / interno propio / VDI en nombre del VDE pareja |
| `campaigns` | todos | admin |
| `notifications` | targetUid o fromUid o admin | propio crea, propio update si es targetUid, **delete: target o admin** (NUEVO: el target puede borrar la card desde Recibidas) |
| `targets` | todos | admin / gerente |
| `client_locations` | todos | admin / vendedor / interno (create), admin (update/delete) |
| `client_master` | todos | admin / gerente (incluye dropdown provincia editable + auto-infer vendor) |
| `allowed_emails` | autenticados | admin |
| `client_applications` | todos | propio crea, admin/gerente/interno update, **delete: admin O owner si NO tiene cardCodeSap** (NUEVO: el vendedor puede eliminar sus Mis Solicitudes mientras no estén cargadas a SAP) |
| `rendiciones` | todos | propio crea, admin/gerente update, admin delete |
| `app_config` | todos | admin |
| `vendor_overrides` | todos | admin (cambios globales) |
| `route_overrides` | todos | admin / vendedor (su propio), admin (update/delete) |
| `custom_routes` (NUEVO) | todos los readers | propio crea/update/delete (filtrado por ownerUid) |
| `sap_clients`, `sap_products`, `sap_vendors` | todos | admin |
| `operations_log` | admin / viewer | autenticado crea (userUid == auth.uid), nadie update/delete |
| `seguimiento_notes` (NUEVO v209+) | `isSeguimientoUser()` (admin/gerente/interno) | `isSeguimientoUser()` crea/update/delete |
| `seguimiento_status` (NUEVO v209+) | `isSeguimientoUser()` | `isSeguimientoUser()` crea/update/delete |

Helper `isMyPartnerVDE(targetUid)`: para que un VDI pueda actuar en nombre de un VDE solo si el VDE tiene a ese VDI como `internalPartnerUid`. Esto bloquea que un VDI cualquiera cargue pedidos a nombre de cualquier VDE.

Helper `isSeguimientoUser()` (v209+): `userRole in ['admin', 'gerente', 'interno']`. Lo usan las rules de `seguimiento_notes` y `seguimiento_status` para evitar que un vendedor pueda leer las notas internas que se escriben sobre él.

### Rendiciones — fix de resolveApprover (v189+)

Antes el vendedor no podía mandar rendiciones si tenía responsable asignado (las rules intentaban resolver el aprobador leyendo `/roles/{approverUid}` directo, lo cual no era legible por el VDE). El fix:
- El cliente lee `app_config/users_directory` (público) para encontrar el aprobador por email.
- Cachea el email en localStorage para no pegar Firestore en cada submit.
- Las rules permiten escribir la rendición sin necesitar leer `/roles` del aprobador.

### Cloud Storage Security Rules (v364+, deployadas 2026-07-30)

Firebase mandó email 2026-07-29 avisando que las rules "test mode" originales del bucket expiraban el 2026-07-30 (allow read/write hasta esa fecha, cero validación después). Se reemplazaron pre-expiración con rules estrictas en `storage.rules`:

| Path | Read | Write |
|---|---|---|
| `rendiciones/{ownerUid}/{allFiles=**}` | cualquier autenticado (admin/gerente aprueban) | `auth.uid == ownerUid` + size < 10 MB + `contentType image/*` |
| `/{allPaths=**}` (default) | ❌ | ❌ (bloqueo explícito) |

**Deploy**: `firebase deploy --only storage --project=app-vendedores-shimano`. La regla queda versionada en el repo (`storage.rules` + config en `firebase.json`).

**Único uso actual de Storage**: foto de ticket de rendiciones (v308+, `rendiciones/{ownerUid}/{ts}_ticket.{ext}`). Fotos de visitas y altas siguen como base64 embebido en Firestore.

---

## 10) Estructura de la UI

### Header superior
- **Logo Shimano** + título "MAPA DE VENTAS - ARGENTINA"
- **Badge ADMIN** (violeta, centrado) — solo si rol = admin
- **Stat cards** (4): Localidades / Habilitados / **Leads** / Tiendas (renombrado de "Pendientes" en v386; los 4 respetan el filtro activo de zona/provincia/localidad)
- **Botones admin** (a la derecha): TARGETS / CAMPAÑAS / SAP / MASTER CLIENTES / USUARIOS / STOCK / AUDITORÍA / SALIR

Header + Controls tienen `border-bottom-radius: 22px` para look "pill flotante".

### Controls (filtros del mapa)
- Selector **Zona** (filtro por vendedor)
- Selector **Provincia**
- Selector **Localidad**
- Selector **Tipo** (Todos / Existentes / Prospectos / Distribuidores / Ventas Especiales)
- Botones (derecha): **Campañas Activas** (amarillo) / **Exportar para Análisis** (verde, solo Mariano desde v208) / **Seguimiento** (teal, admin/gerente/interno desde v209+) / **Exportar a Excel** (celeste) / **Zonas** (azul marino, sin emoji desde v214)

### Cuerpo
- **Mapa Leaflet** (izquierda, ocupa gran parte de la pantalla).
- **Sidebar derecha** con tabs: Localidades / Clientes / Pedidos / Rutas / Visita / Dashboard / Rendiciones / Alta Clientes / Notificaciones.

### Controles topleft del mapa (debajo de zoom Leaflet)

- **↻ Forzar actualización**: hace `unregister()` del SW, limpia caches y recarga con cache-bust. Útil cuando el banner del console marca DESYNC HTML vs SW.
- **📍 Reubicar pines** (solo admin/gerente): triggea `runBulkGeocodeSapAltas()` para correr geocoding bulk de altas SAP que no tengan lat/lng.
- **⏣ Recalcular contornos de zonas** (NUEVO v213, solo admin/gerente): limpia `_vendorOutlinesCache` + `localStorage[VENDOR_OUTLINES_CACHE_KEY]` y llama a `restyleZoneLayers()` + `drawVendorOutlines()`. Útil después de reasignar localidades/provincias en el modal ZONAS — sin esto los outlines viejos quedan cacheados y muestran fronteras que ya no aplican.

### Mobile

Botón **REFRESCAR APP** ocupa la celda libre al lado del selector Localidad (atajo equivalente al ↻ del desktop).

### Body background
Color celeste claro `#dbeafe` (matchea con el color base de `.controls`).

### Login background
Foto: `login-bg.jpg` (río al amanecer con lancha de pesca) + overlay oscuro semi-transparente para contraste del cuadro blanco del login/PIN.

---

## 11) Sistema de zonas y vendedores

### Las 6 zonas (`VENDORS` array)

```js
[
  {key: 'GONZALO DE LA ROSA',    zone: 'Z1', color: '#00A9E0', label: 'CABA + AMBA Norte/Oeste'},
  {key: 'FEDERICO CASTELANELLI', zone: 'Z2', color: '#003366', label: 'AMBA Sur + BA Interior + Costa'},
  {key: 'MARTIN BOIERO',         zone: 'Z4', color: '#E83A2E', label: 'Cordoba + Cuyo + SF Oeste'},
  {key: 'MAURICIO GIL',          zone: 'Z5', color: '#F97316', label: 'Litoral + Norte BA'},
  {key: 'IOANNIS PALKOUDAKIS',   zone: 'Z6', color: '#8E44AD', label: 'Patagonia + Mendoza + apoyo Federico/Gonzalo'},
  {key: 'SANTIAGO ESTEBAN',      zone: 'Z7', color: '#F39C12', label: 'NOA + NEA + Cuyo norte + apoyo Mauricio/Martin'},
]
```

### Clasificación operativa

```js
VDE_VENDOR_KEYS = {'MAURICIO GIL', 'MARTIN BOIERO', 'GONZALO DE LA ROSA', 'FEDERICO CASTELANELLI'}
VDI_VENDOR_KEYS = {'IOANNIS PALKOUDAKIS', 'SANTIAGO ESTEBAN'}
```

Ioannis y Santiago están en `VENDORS` históricamente (Z6, Z7), pero operativamente son VDIs.

### Inclusión cruzada VDI → VDEs pareja

Cuando se filtra Ioannis o Santiago en el header, automáticamente se incluyen las zonas de sus VDEs pareja:

```js
VENDOR_INCLUDES_OTHERS = {
  'IOANNIS PALKOUDAKIS': ['FEDERICO CASTELANELLI', 'GONZALO DE LA ROSA'],
  'SANTIAGO ESTEBAN':    ['MAURICIO GIL', 'MARTIN BOIERO'],
}
```

### Asignación automática a tienda

Una tienda se asigna a un vendor según la columna `ASESOR EXTERNO` del Excel master:
- `MAURICIO GIL`, `MARTIN BOIERO`, `GONZALO DE LA ROSA`, `FEDERICO CASTELANELLI` → VDE.
- `DISTRIBUIDORES` → entra al filtro "Distribuidores" (no cuenta como venta directa).
- `VENTAS ESPECIALES` → entra al filtro "Ventas Especiales".

La columna `ASESOR INTERNO` siempre dice Ioannis o Santiago según la pareja del VDE.

### `PROVINCE_VENDOR_OVERRIDE` (override hardcoded por provincia)

Constante en `index.html` que pisa el vendor de TODOS los departamentos de una provincia, independientemente del Excel master y de `vendor_overrides`. Hoy:

```js
const PROVINCE_VENDOR_OVERRIDE = {
  'SAN LUIS': 'MARTIN BOIERO',
};
```

Útil cuando el GeoJSON tiene depts mal etiquetados o cuando se decidió mover toda una provincia a otro vendor sin pasar por modal Zonas. Se aplica en:
- `deptEffectiveVendor(feat)` (color del polígono dept).
- `_buildVendorOutlinesCache` (clasificación SINGLE-VENDOR forzada).
- Marker color y filtros.

### Outlines de zonas (contornos visuales por vendor)

El contorno de cada zona pasó por **varias iteraciones**:
1. ~~Union polygon-clipping sobre TODOS los depts INDEC (~3.000 features).~~ Demasiado lento y dejaba microgaps por vertices que no matcheaban entre depts vecinos.
2. ~~Edge-counting (contar aristas compartidas y dibujar las únicas).~~ Sigue dejando lineas internas.
3. ~~Convex hull por vendor.~~ Pierde detalle de borde y se mete en zonas de otros vendors.
4. **Híbrido provincia + dept (actual, desde v182)**: clasifica cada provincia como **single-vendor** (≥90% de sus depts con un mismo vendor → usa el polígono provincial entero de `PROV_GEO`) o **split** (varios vendors significativos → union de los depts de cada vendor SOLO dentro de esa provincia). `PROVINCE_VENDOR_OVERRIDE` fuerza el modo single.

Esto resuelve casos como **Buenos Aires** (dividida entre Gonzalo en CABA+AMBA Norte/Oeste y Federico en AMBA Sur+Interior): la provincia es SPLIT, así que se unionan los depts por vendor por separado y queda un borde limpio para cada uno.

### Optimización + cache

- Union via **tree reduction** O(N log N) en `unionTree()` cuando `polygonClipping.union(...mps)` falla (fallback resistente).
- `_vendorOutlinesCache` se persiste en `localStorage` (key `VENDOR_OUTLINES_CACHE_KEY`). La próxima vez que se abre el mapa, el cache se reutiliza inmediatamente.
- `polygon-clipping` se carga **defer** (es un blob ~150KB que sólo hace falta para los outlines).

### Burbujas agregadas del mapa — desactivadas (v199+)

Históricamente el mapa dibujaba **burbujas numéricas blancas con número** superpuestas a los pines individuales en 3 modos:

- Por **vendedor** (zoom out, sin filtro).
- Por **provincia** (zoom medio, filtro vendor).
- Por **localidad** (zoom alto, filtro prov).

En la práctica generaban confusión visual: los usuarios veían un "8" gigante encima de 8 pines individuales y no sabían si era stock, cantidad de pedidos, o tiendas.

Desde v199+ están **gateadas detrás de un flag** en `drawMarkers`:

```js
const SHOW_AGG_BUBBLES = false;  // ← cambiar a true para re-habilitarlas
```

Con el flag en `false`, los 3 modos no se dibujan. Los pines individuales (`drawHabilitadosPins` + `drawSapAltaPins`) siguen apareciendo igual.

Para re-habilitar puntualmente: cambiar el flag a `true` en `drawMarkers` y recompilar.

---

## 12) Sección: Localidades / Clientes / Pedidos

### Localidades

Tab "Localidades" del sidebar. Lista todas las localidades visibles según los filtros del header, ordenadas por cantidad de tiendas.

#### Fuente del listado (v198+)

Antes el listado iteraba **solo POINTS**: para vendedores 100% SAP (ej. Martin Boiero) decía "Sin localidades con datos" aunque hubiera 10 pines en el mapa porque sus tiendas vivían en `client_applications` y no en POINTS.

Ahora suma localidades desde 2 fuentes:
- **POINTS** del Excel master (legacy).
- **`approvedAltasList`** agrupadas por `(provincia, localidad)` — incluye altas SAP aprobadas + provisorias (alta rápida).

El listado respeta los filtros vendor/provincia/localidad del header. El contador **"LOCALIDADES"** del header ahora suma `POINTS + sapLocs` (antes era solo `pts.length`, que daba 0 para vendedores 100% SAP).

#### Modal "Localidad" (v198+)

Click en la card de una localidad ya **no hace zoom al mapa**: abre un nuevo modal `localidad-modal` que lista **todas las tiendas de esa localidad con su dirección**, agrupadas por tipo:

| Badge | Tipo | Origen |
|---|---|---|
| **CLIENTE** | POINTS SAP-confirmed | `contacted` set, hay match con SAP |
| **PROSPECTO** | POINTS prospecto | sin habilitar todavía |
| **SAP** + cardCode | Altas SAP aprobadas | `client_applications` con `cardCodeSap` |
| **PROVISORIO** | Altas provisorias | `client_applications` con `manualSapPending: true` |

- La **dirección** se busca en este orden: `cliente_master.address` → `clientMeta.address` → `alta.calle`. Si no hay ninguna, aparece en rojo: **"(sin dirección cargada)"**.
- Si el alta tiene `fantasia` distinta del comercio legal, debajo del nombre se muestra **"Local: <fantasia>"**.

### Clientes

Tab "Clientes". Lista todas las tiendas visibles. Estados:
- **Pendiente**: badge ámbar (no se le pueden crear pedidos todavía).
- **Habilitado**: badge verde (puede crear pedidos).
- **Cancelado**: badge rojo (oculto del flujo).

#### Filtros del tab (v264+)
- **TODOS** — todo el listado.
- **CONFIRMADOS** — solo clientes con estado `habilitado` (POINTS con match) + SAP altas con geo+dirección. Excluye provisorios.
- **NO CONFIRMADOS** — provisorios (`manualSapPending && !cardCodeSap`) sin importar si tienen provincia/geo/addr **(v293+ fix)** + POINTS/prospectos pendientes de habilitar. Nota (v386): el KPI **LEADS** del header ahora respeta el filtro de zona/provincia/localidad, así que puede no coincidir con este tab si el usuario tiene un filtro activo — es intencional (el tab lista, el KPI resume el scope actual).

#### Badge de categoría comercial fijo en esquina (v295+)
Cada card de CLIENTES muestra el badge `Cat P/A/B/C` en la **esquina superior derecha** vía `position:absolute; top:6px; right:8px` (CSS `.cli-cat-corner`). `padding-right:62px` en `.client-card` reserva el espacio para que nombres largos no se solapen con el badge. `pointer-events:none` para no robar el click de la card.

Colores: **P** violeta (`#7c3aed`), **A** verde (`#059669`), **B** celeste (`#0284c7`), **C** gris (`#64748b`). El `cliTipo` se lee de `client_master` (POINTS) o de `client_applications.cliTipo` (SAP altas) — helper `getClientCategoryBadgeHtml(province, locName, name, {corner:true})`.

En **PEDIDOS** (`.pedido-client-card`) el badge va inline dentro del cluster derecho arriba del Habilitado/Provisorio, no absoluto (para no chocar con el badge de estado que ya vive en top-right).

### Flujo de "dar de alta" una tienda

Al tocar una tienda se abre el modal:
1. **Nombre editable** (click en el título → contenteditable).
2. **Dirección exacta** (input obligatorio).
3. **Localidad** (input obligatorio, precarga la del mapa).
4. **Botón "Dar de alta"** se habilita cuando los 2 inputs están llenos.
5. **Geocoding** con OpenStreetMap Nominatim (Argentina-only).
6. Si encuentra → guarda lat/lng en `clientMeta`. Si no → ofrece habilitar igual.
7. Marca el cliente como Habilitado y aparece un **pin verde** en el mapa.

### Pedidos

Tab "Pedidos". 3 sub-tabs:
- **Crear**: lista de clientes habilitados con búsqueda. **Incluye las altas SAP aprobadas + las provisorias (alta rápida)** vía `buildPedidoVisibleKeysSet()` (antes sólo POINTS).
- **Pendientes**: pedidos confirmados pero no transferidos a SAP. Con filtros mes / tienda / año.
- **Confirmados**: pedidos transferidos a SAP (DTW o Service Layer). Con filtros mes / tienda / año (igual que Mis Visitas).

### Modal Crear Pedido

Picker de productos con:
- Filtros: Categoría / Familia / Subfamilia / Buscar.
- **Filtro stock** (3 botones en la celda libre al lado de Subfamilia): `Todos` / `Disponibles` / `No disp.` — filtra el listado del picker según `hasStock(code)`.
- **Indicador de stock** verde/rojo al lado de cada SKU (basado en `STOCK_MAP`).
- Stepper `[-][n][+]` para cantidad.
- **Sugeridos**: SKUs que vecinos pidieron en pedidos confirmados (umbral 3 casas, basado en historial real de la app no MELI).

### Botón "Vista preliminar" (antes "Confirmar pedido")

Renombrado en v190+. Abre un modal de revisión antes de confirmar:

- **Líneas con punto verde/rojo** según `hasStock(code)`. Las líneas sin stock tienen **fondo rosa** + label inline **"SIN STOCK"**.
- Debajo del bloque "Descuento estimado" aparecen **2 cuadrantes (verde + rojo)**:
  - `Subtotal disponibles` — suma de líneas con stock.
  - `Subtotal no disponibles` — suma de líneas sin stock.
  - Estos subtotales **sólo se muestran si hay al menos 1 item sin stock**.
- Botón "Confirmar pedido" para cerrar el flow.

### Modal Confirmar Pedido (paso final)

Antes de enviar a SAP:
- Mes / año.
- **Condición de pago** obligatoria: CONTADO / CHEQUE / CTA CTE / VTA ESP / CON CHEQ.
- (VDI) Dropdown "Crear en nombre de" si tiene parejas VDE.

Al confirmar:
- Si Service Layer enabled → POST a `/b1s/v1/Quotations` (**hoy no cableado** — la función `enviarPedidosASAPViaServiceLayer` existe pero no se llama desde ningún botón).
- Si NO → queda en estado `pending` para luego "Listo para SAP" + ZIP DTW.

### Helpers de visibilidad

`buildPedidoVisibleKeysSet()` arma el set de keys (`tipo|prov|loc|name`) visibles para Pendientes/Confirmados. Desde v183+ incluye:
- Tiendas POINTS habilitadas (`contacted`).
- Altas SAP con `cardCodeSap` (aprobadas formalmente).
- Altas con `manualSapPending` (provisorias, vienen del flow Alta Rápida).

### Card de cliente — Fantasía editable + badge PROVISORIO

- La card del cliente muestra `Local: XXX` cuando hay fantasía distinta del nombre legal. La fantasía se edita con un **modal HTML** (reemplaza el chain `prompt() + confirm()` que existía hasta v177).
- La fantasía se guarda en `clientMeta[key].customFantasia`.
- Tiendas con `manualSapPending: true` muestran badge **"⚡ PROVISORIO (cargar a SAP manual)"** + fondo crema para que Admin las detecte.

### Card de cliente — Precaución (más visible desde v206)

Cuando una tienda tiene `clientMeta[key].precaucion = true` (problema de cobro, fraude reportado, etc.), la card sale destacada:
- Fondo `#fde68a` (amber-200, fuerte; antes era `#fffbeb` que casi no se distinguía).
- Franja izquierda de 5px en marrón (`#b45309`).
- Badge naranja **"⚠️ PRECAUCIÓN"** al lado del nombre (con tooltip de `precaucionReason`).
- Aplica tanto a tiendas POINTS como a altas SAP/POINTS huérfanos.

---

## 13) Sección: Rutas

Tab "Rutas" del sidebar. Arriba hay un **toggle de modo** con 2 botones (ambos `flex: 1`, texto centrado):
- **Rutas recomendadas** (auto-generadas, modo histórico).
- **Rutas personalizadas** (custom_routes, NUEVO desde v182+).

### Modo "Rutas recomendadas"

Auto-genera rutas mensuales por proximidad geográfica:

- Recolecta localidades del vendedor con tiendas.
- Ordena por lat (Norte → Sur).
- Agrupa por proximidad (~10-15 tiendas por ruta).
- Asigna fechas distribuidas por semanas del mes.

### Modo "Rutas personalizadas" (NUEVO)

Lista de rutas armadas a medida por el vendedor (colección `custom_routes`, filtrada por `ownerUid`). Cada ruta tiene:
- **Nombre** (libre).
- **Fecha planeada** (YYYY-MM-DD).
- **Notas** (texto largo).
- **Stops**: lista de tiendas con orden, agregar/quitar/reordenar.

El picker para agregar una tienda al stop busca en POINTS + altas SAP aprobadas + altas provisorias (alta rápida), respetando el filtro de vendor del usuario. Las provisorias se marcan con badge **PROVISORIO** dentro del picker.

Operaciones:
- Crear ruta (form vacío).
- Editar nombre / fecha / notas / stops.
- Eliminar ruta (la collection `custom_routes` permite delete sólo al ownerUid).
- "Enviar por WhatsApp" reutiliza el mismo helper de las rutas recomendadas.

### Estados de tienda en ruta

- **Pendiente** (gris).
- **Visitada** (verde) — si hay visita registrada para esa tienda en el mes.
- **Derivada VDI** (ámbar) — si el VDE delegó al VDI.
- **Reagendada** (azul) — si se movió a otra fecha.

### Botón "Recalcular Rutas"

Refresca con datos más recientes:
- Re-aplica overrides de Zonas a POINTS.
- Refresca listeners de visitas y route_overrides.
- Resetea vista detalle al listado.
- Re-renderiza con conteos actualizados.

### "Enviar ruta por WhatsApp"

Genera un link de Google Maps con todas las tiendas de la ruta como waypoints. Si la tienda tiene `client_master.address`, usa esa dirección exacta. Sino usa el nombre + localidad. Abre WhatsApp con un mensaje preformateado.

---

## 14) Sección: Visita

Formulario completo para registrar una visita a tienda:

- **Selector de localidad** → incluye localidades de POINTS + altas SAP aprobadas + provisorias (alta rápida).
- **Dropdown "Tienda de pesca"** → sólo muestra tiendas habilitadas en SAP (filtra prospectos y legacy desde v185+; antes traía todo). Las provisorias también aparecen porque tienen `manualSapPending`.
- Datos del local: Propio / Alquilado / Compartido, Tamaño, Fidelidad, Relevancia.
- POP: stickers, displays, banners.
- Necesidad puntual (opciones: CAÑERO, CARTEL, MOSTRADOR, OTROS — v296+ era "MOSTRADO").
- Tipo de venta: MOSTRADOR, ECOMMERCE, AMBOS (label visible v296+; value en DB sigue siendo `MOSTRADO` por retrocompat).
- % Mostrador / % Ecommerce (sliders 0-100, aparecen solo si Tipo=AMBOS).
- Competencia (texto libre).
- Oportunidad detectada.
- Lo más vendido Shimano.
- Lo que más preguntan.
- Ayuda que necesita la tienda.
- **Foto del frente del local** (obligatoria).
- **Hasta 5 fotos del espacio interior** (opcionales).
- **GPS doble-check**: la app saca lat/lng al iniciar el form y al guardar; si la distancia con `client_locations` es > 500m, marca `gpsStatus: 'outside'`.

VDI puede cargar visitas en nombre de un VDE pareja.

### Export Visitas mensual (NUEVO)

Botón "Exportar visitas del mes" → genera un Excel con **foto del frente embebida** (vía **ExcelJS** lazy-load). Las columnas incluyen todos los campos del formulario + fecha + vendedor + provincia + localidad. La foto va incrustada en la celda correspondiente (no como link).

---

## 15) Sección: Dashboard

Dashboard comparativo con:
- KPIs del mes vs target (% cumplimiento ARS).
- Comparativa entre vendedores (tabla + gráfico).
- Top SKUs vendidos.
- Top clientes por facturación.
- Filtros: mes / año / vendedor / categoría.

---

## 16) Sección: Rendiciones

Carga de gastos del vendedor con OCR automático:

1. Vendedor saca foto del ticket (**foto y N° de ticket son opcionales desde v188+**; antes la foto era bloqueante).
2. La foto se manda a **Gemini API** (`gemini-2.5-flash`) con un prompt estructurado.
3. Gemini devuelve JSON con: fecha, monto, comercio, tipo de gasto.
4. Vendedor verifica y ajusta si hace falta.
5. Se guarda en `rendiciones/{docId}` con `status: pending_approval`.
6. El aprobador (configurado en `roles/{vde}.rendicionesApproverUid`) la aprueba o rechaza.

### Tipos de gasto

Combustible, peajes, alojamiento, comidas, varios.

### Export Rendiciones mensual (Excel local)

Botón "Exportar rendiciones del mes" → Excel con **foto del ticket embebida** (ExcelJS lazy-load) + más columnas:

- Concepto
- N° Ticket
- Modo de pago
- Tipo de gasto
- División
- Importe USD (calculado con TC del período)
- Aprobador
- Aprobado en (timestamp)

### Fix de Firestore Rules (v189+)

Antes: el vendedor no podía submitter si tenía aprobador asignado porque las rules intentaban leer `/roles/{approverUid}` (que el VDE no tenía permiso de leer). Fix:
- El cliente lee `app_config/users_directory` (público) para resolver el email del aprobador.
- Se cachea el email en `localStorage` con TTL.
- Las rules permiten escribir la rendición sin necesitar leer `/roles` ajenos.

### Mail Rendiciones cron — Lunes y Miércoles 9am AR (v202+)

Cron automatizado en GitHub Actions: `scripts/send_rendiciones_email.py` corre **Lunes y Miércoles 9am hora Argentina** y manda un mail desde `bot.shimano.pesca@gmail.com` a `mariano.erbino@shimano.com.ar` (Outlook 365) con un Excel de las rendiciones aprobadas desde la última corrida.

#### Estructura del Excel — v2 desde v217 (3 hojas)

| Hoja | Tabla nombrada | Granularidad | Mapea a Power Automate? |
|---|---|---|---|
| **Gastos** (default) | `TablaGastos` | **UNA fila por dupla (ownerEmail, tipoGasto)** | **SÍ** — la lee Power Automate y crea UN item SharePoint por dupla |
| **Detalle** (NUEVA en v217) | — | UNA fila por gasto individual (15 columnas) | NO — solo auditoría humana |
| **Solicitudes** | `TablaSolicitudes` | UNA fila por anticipo | SÍ |

> La hoja "Resumen" fue **eliminada** en v202+. El Excel queda compacto y mappeable a Power Automate.

> Los nombres de tabla (`TablaGastos`, `TablaSolicitudes`) son **Excel Tables reales** (no rangos). Power Automate los necesita para el step `List rows present in a table`.

#### Cambio v2 — Agrupación por dupla (v217, pedido de Fernando)

**Antes (v202–v216)**: `TablaGastos` tenía **15 columnas** y **una fila por gasto**. Si Gonzalo cargaba 3 facturas A en una semana, Power Automate creaba 3 items separados en SharePoint → confundía la rendición consolidada.

**Ahora (v217)**: agrupación por `(ownerEmail, tipoGasto)`. Los 3 tipos típicos son `Factura A`, `Gastos con comprobante`, `Gastos sin comprobante` → max 3 filas por persona por período.

`TablaGastos` v2 — **10 columnas**:

| # | Columna | Tipo | Detalle |
|---|---|---|---|
| 1 | `Vendedor (email)` | texto | `gonzalo.delarosa@shimano.uy` |
| 2 | `Tipo gasto` | texto | `Factura A` / etc. |
| 3 | `Cant Rendiciones` | número | Cuántos gastos hay en la dupla |
| 4 | `Importe Total` | número | Suma del grupo |
| 5 | `Importe USD Total` | número | Suma USD (vacío si ninguno tenía USD) |
| 6 | `Moneda` | texto | Una moneda si todas iguales, `MIXTO` si conviven varias |
| 7 | `Periodo Desde` | texto fecha | `createdAt` más antigua del grupo |
| 8 | `Periodo Hasta` | texto fecha | `createdAt` más reciente del grupo |
| 9 | `Rendiciones IDs` | texto | IDs Firestore concatenados con `;` |
| 10 | `Fotos URLs` | texto | URLs públicas Firebase Storage concatenadas con `;` — Power Automate hace `split` y adjunta cada foto al item |

> **Detalle**: la hoja nueva tiene las 15 columnas viejas sin agrupar (ID, Fecha carga, N° Ticket, Descripcion, Modo pago, Tipo gasto, Division gasto, Moneda, Importe, Importe USD, Observaciones, Aprobado por, Fecha aprobacion, Ticket hyperlink). Fernando o Mariano la abren si quieren ver línea por línea.

#### Pre-upload de fotos antes de agrupar (v217)

Para que el grupo pueda concatenar URLs, el script:
1. Recorre TODAS las rendiciones de tipo `gasto` ANTES de agrupar.
2. Llama `upload_foto_to_storage(rendicion_id, foto_dataurl)` por cada foto y cachea en `foto_url_by_id = {id: url}`.
3. Agrupa por dupla.
4. Al armar cada fila, concatena `foto_url_by_id[id]` solo de los gastos cuyo upload fue exitoso. Una foto rota no rompe la fila — simplemente no entra al `;`.

#### Bucket de Storage — formato nuevo `.firebasestorage.app` (v217)

Firebase post-2024 usa `<project-id>.firebasestorage.app` como nombre default del bucket (antes era `.appspot.com`). `init_firestore()` ahora arma:

```python
default_bucket = f"{project_id}.firebasestorage.app"
storage_bucket = os.environ.get("STORAGE_BUCKET") or default_bucket
```

Override via env var `STORAGE_BUCKET` si por alguna razón el proyecto sigue en el bucket legacy.

#### Columna "Imagen ticket" — hyperlink a Firebase Storage (v202+)

Hasta v201 se intentó embebir la foto directamente con openpyxl + Pillow → quedaba apretada en Excel y el archivo pesaba mucho.

Desde v202+ cada foto se sube a **Firebase Storage** y la celda queda con un hyperlink:

1. Función `upload_foto_to_storage(rendicion_id, foto_dataurl)` sube el blob a `rendiciones-tickets/<rendicion_id>.<ext>`.
2. `blob.make_public()` para que la URL sea permanente y abrible sin auth.
3. En la celda Excel queda hyperlink azul **"📷 Ver ticket"** que abre la imagen a tamaño original en el navegador.
4. Sin foto → celda dice **"(sin foto)"**.
5. Foto corrupta → **"(error al subir)"**.

`init_firestore()` configura `storageBucket = <project-id>.firebasestorage.app` (formato nuevo Firebase, v217+; antes era `.appspot.com`).

> **REQUIERE plan Firebase Blaze** activado: Firebase Storage no funciona en Spark (free tier). **Blaze ya activo en el proyecto desde 2026-06-30**.

#### Inputs del workflow_dispatch (v202+)

El workflow acepta dos inputs para uso manual:

| Input | Para qué |
|---|---|
| `force=true` | Ignora el filtro `notifiedAt`, trae **TODAS** las aprobadas (testing/reenvío completo) |
| `skip_mark=true` | No marca como `notifiedAt` después del envío (reenvíos sin afectar el estado del flow) |

El cron Lun/Mie normal usa ambos en `false`.

---

## 16-bis) Integración SharePoint + Power Automate (NUEVO en v203)

Sección entera nueva: el flow de **Power Automate** que carga automáticamente las rendiciones aprobadas a la lista de **SharePoint** del team **SAR** (Admin & Finanzas).

### Stack end-to-end

```
GitHub Actions (Lun/Mie 9am AR)
   ↓ Python script
   ↓ Genera Excel (TablaGastos + TablaSolicitudes)
   ↓ Sube fotos a Firebase Storage (hyperlinks)
Mail desde bot.shimano.pesca@gmail.com
   ↓
Outlook 365 (mariano.erbino@shimano.com.ar)
   ↓ Trigger Power Automate
Flow "Cargar rendiciones aprobadas a SharePoint"
   ↓ Create file en OneDrive
   ↓ List rows in TablaGastos
   ↓ For each row → Create item
Lista SharePoint "ANTICIPO Y RENDICION DE GASTO"
   ↓
Equipo SAR (Fernando Gamboa — Admin/Finanzas) ve los ítems
```

### Lista SharePoint destino

| Dato | Valor |
|---|---|
| Site URL | `https://teamshimano.sharepoint.com/teams/SLA_int_00002` |
| Lista | `ANTICIPO Y RENDICION DE GASTO` |
| Contacto Admin/Finanzas | **Fernando Gamboa** |

### Flow Power Automate

Vive en `make.powerautomate.com` bajo la cuenta `mariano.erbino@shimano.com.ar`.

- **Nombre**: `Cargar rendiciones aprobadas a SharePoint`
- **Trigger**: `When a new email arrives (V3)` → Office 365 Outlook.
  - From: `bot.shimano.pesca@gmail.com`
  - Subject Filter: `Rendiciones aprobadas`
  - Include Attachments: **Yes**

Estructura:

```
Trigger
└── For each (attachments)
     ├── Create file (OneDrive Business) → /shimano-rendiciones/rendiciones-temp.xlsx
     ├── List rows present in a table (Excel Online Business) → TablaGastos
     └── For each 1 (rows)
          └── Create item (SharePoint)
```

### Mapeo Excel → SharePoint (Schema v2, v217)

> **Detalle operativo completo** en `POWER_AUTOMATE_RENDICIONES.md` (archivo separado, mismo repo).

Columnas nuevas creadas en la lista SharePoint **"ANTICIPO Y RENDICION DE GASTO"** (2026-06-30):

| Columna SharePoint | Tipo | Source columna Excel v2 |
|---|---|---|
| `Tipo comprobante` | Choice (FACTURA A / GASTO CON COMPROBANTE / GASTO SIN COMPROBANTE) | `Tipo gasto` |
| `Cant rendiciones` | Number | `Cant Rendiciones` |
| `Desde` | Single line text | `Periodo Desde` |
| `Hasta` | Single line text | `Periodo Hasta` |
| `Rendiciones IDs` | Multiple lines text | `Rendiciones IDs` |

Mapeo total v2:

| Campo SharePoint | Valor / fuente Excel |
|---|---|
| `Title` | `{Vendedor (email)} \| {Tipo gasto} \| <12 chars primer ID>` (idempotency key) |
| `Importe` | `float(item()?['Importe Total'])` |
| `Moneda Value` | `Moneda` (puede valer `MIXTO`) |
| `Tipo comprobante Value` | `Tipo gasto` |
| `Cant rendiciones` | `Cant Rendiciones` |
| `Desde` / `Hasta` | `Periodo Desde` / `Periodo Hasta` |
| `Rendiciones IDs` | `Rendiciones IDs` |
| `Solicitado por Claims` | `Vendedor (email)` |
| `Tipo de Operacion Value` | `"Rendicion de Gasto"` (literal) |
| `Estado Value` | `"Abierto"` (default) |
| `SAP Value` | `"No Registrado"` (default) |

### Estructura del flow (v3 — 2026-07-29)

Cambios v3 vs v2:
1. **Rama nueva para solicitudes** (`TablaSolicitudes`): antes el flow ignoraba las solicitudes de recarga/anticipo, solo procesaba `TablaGastos`. Ahora hay un bloque paralelo para ambas tablas.
2. **Excel filtrado por dupla adjunto en gastos**: antes se adjuntaba el Excel MAESTRO completo a cada item (56 rendiciones visibles en cada uno). Ahora el Python genera un mini-Excel por dupla y lo sube a Firebase Storage; el flow lo baja por HTTP GET y lo adjunta al item específico.
3. **`Create file` con nombre único**: antes `rendiciones-temp.xlsx` fijo → colisionaba con file lock si el user tenía Excel abierto. Ahora `concat('rendiciones-', utcNow('yyyy-MM-dd-HHmmssfff'), '.xlsx')`.
4. **`List rows` con Configure run after tolerante**: si un mail viene solo con gastos o solo con solicitudes, la tabla ausente hace fallar `List rows` con `NotFound`. Ambos `List rows` tienen configurado `is successful + has failed + is skipped` para que el flow continúe.

```
Trigger: When a new email arrives (V3)
└── For each (attachments)
     ├── Create file (OneDrive Business) → /shimano-rendiciones/rendiciones-<utcNow>.xlsx
     ├── List rows present in a table → TablaGastos
     │      ↳ Configure run after: tolera has failed + is skipped
     ├── List rows Solicitudes → TablaSolicitudes
     │      ↳ Configure run after: tolera has failed + is skipped
     ├── For each 1 (rows de TablaGastos)
     │    └── Apply to each
     │         ├── Check duplicate
     │         └── Condition (rowCount == 0)
     │              └── True:
     │                   ├── Create item SharePoint (todos los campos de gasto)
     │                   ├── Bajar Excel Dupla (HTTP GET → item()?['Excel Dupla URL'])
     │                   ├── Adjuntar Excel a item (SharePoint Add attachment con nombre
     │                   │      `concat('Rendiciones_', vendedor, '_', replace(tipo, ' ', '_'), '.xlsx')`)
     │                   ├── Split Fotos URLs
     │                   └── For each foto URL
     │                        ├── HTTP GET Storage
     │                        └── Add attachment
     └── Apply to each Solicitud (rows de TablaSolicitudes)
          │      ↳ Configure run after de For each 1: tolera has failed + is skipped
          └── Create item 1 SharePoint (mapeo específico solicitud)
               ├── Title: concat(vendedor, ' | ', tipo operacion, ' | ', ID)
               ├── Tipo de Operacion: if(equals(tipo, 'RECARGA'), 'Recarga',
               │                       if(equals(tipo, 'ANTICIPO DE EFECTIVO'), 'Anticipo en efectivo',
               │                          'Rendicion de Gasto'))
               ├── Moneda: if(equals(moneda, 'PESOS ARGENTINOS'), 'PESOS', ...)
               ├── Solicitado por Claims: Vendedor (email)
               ├── Comentarios: concat('Motivo: ', motivo, ' — Obs: ', observaciones)
               ├── Rendiciones IDs / Desde / Hasta / Importe: 1 fila del Apply to each
               └── Cant rendiciones: 1 (fijo)
```

### Mapeo Excel → SharePoint (Schema v3, 2026-07-29)

Columnas nuevas del Excel en v3:

| Columna Excel | Nueva en v3 | Uso |
|---|---|---|
| `Excel Dupla URL` (en `TablaGastos`) | ✓ | Público en Firebase Storage. El flow hace HTTP GET y adjunta el binario al item. |
| Todas las de `TablaSolicitudes` | (existían pero sin uso) | Ahora el flow lee esta tabla también. |

Mapeo total v3 — **TablaGastos → Items SharePoint tipo Rendicion de Gasto**:

| Campo SharePoint | Valor / fuente Excel |
|---|---|
| `Title` | `{Vendedor (email)} \| {Tipo gasto} \| <12 chars primer ID>` |
| `Importe` | `float(item()?['Importe Total'])` |
| `Moneda Value` | `Moneda` (puede valer `MIXTO`) |
| `Tipo comprobante Value` | `Tipo gasto` |
| `Cant rendiciones` | `Cant Rendiciones` |
| `Desde` / `Hasta` | `Periodo Desde` / `Periodo Hasta` |
| `Rendiciones IDs` | `Rendiciones IDs` (concatenado por `;`) |
| `Solicitado por Claims` | `Vendedor (email)` |
| `Tipo de Operacion Value` | `"Rendicion de Gasto"` (literal) |
| `Estado Value` | `"Abierto"` |
| `SAP Value` | `"No Registrado"` |
| **Attachment Excel** | Excel dupla bajado de `Excel Dupla URL` |
| **Attachments fotos** | Cada URL del campo `Fotos URLs` splitteado por `;` |

Mapeo v3 — **TablaSolicitudes → Items SharePoint tipo Recarga / Anticipo / Rendicion de Gasto**:

| Campo SharePoint | Expression |
|---|---|
| `Title` | `concat(items('Apply_to_each_Solicitud')?['Vendedor (email)'], ' \| ', ...?['Tipo operacion'], ' \| ', ...?['ID'])` |
| `Solicitado por Claims` | `items('Apply_to_each_Solicitud')?['Vendedor (email)']` |
| `Tipo de Operacion Value` | `if(equals(?['Tipo operacion'], 'RECARGA'), 'Recarga', if(equals(...,'ANTICIPO DE EFECTIVO'), 'Anticipo en efectivo', 'Rendicion de Gasto'))` |
| `Moneda Value` | `if(equals(?['Moneda'], 'PESOS ARGENTINOS'), 'PESOS', if(equals(...,'DOLARES'), 'DOLARES', 'OTRAS MONEDAS'))` |
| `Importe` | `items('Apply_to_each_Solicitud')?['Importe']` |
| `Comentarios` | `concat('Motivo: ', ?['Motivo'], if(empty(?['Observaciones']), '', concat(' — Obs: ', ?['Observaciones'])))` |
| `Rendiciones IDs` | `items('Apply_to_each_Solicitud')?['ID']` (solo 1) |
| `Cant rendiciones` | `1` (fijo) |
| `Desde` / `Hasta` | `items('Apply_to_each_Solicitud')?['Fecha aprobacion']` (mismo valor) |
| `Estado Value` | `"Abierto"` |
| `Registrado` | `No` |
| `SAP Value` | `"No Registrado"` |

⚠️ **Importante**: NO usar `item()?['X']` en el Create item de solicitudes — usar SIEMPRE `items('Apply_to_each_Solicitud')?['X']` explícito. Si algún token queda apuntando implícitamente al `Create_item` de gastos, el save falla con:

```
InvalidTemplate: 'Create_item_1' cannot reference action 'Create_item'.
The action 'Create_item' is nested in a foreach scope of multiple levels.
Referencing repetition actions from outside the scope is supported only
when there are no multiple levels of nesting.
```

Chequear en **Code view** del `Create item 1` que no haya `outputs('Create_item')` en ningún campo.

### Particularidades técnicas conocidas

- **Idempotencia por Title**: el script genera el Title como `{vendedor} | {tipoGasto} | {primeros 12 chars de Rendiciones IDs}`. Si el flow corre 2 veces sobre el mismo Excel, el `Get items` con `$filter` detecta el item existente y no se duplica.
- **Premium HTTP connector**: los steps `HTTP GET` (para bajar foto Y Excel Dupla) requieren **Power Automate Premium**. Mariano tiene **trial Premium de 90 días activado** (2026-06-30). Después hay que comprar licencia.
- **Nombre único del Excel (v3)**: `Create file` usa `concat('rendiciones-', utcNow('yyyy-MM-dd-HHmmssfff'), '.xlsx')` para evitar file lock cuando el user tiene Excel abierto en OneDrive/Desktop.
- **Detección del schema de TablaGastos / TablaSolicitudes**: para que el step `List rows` detecte las columnas nuevas, necesitamos un Excel ya en OneDrive antes de configurar `Create item`. Si `Excel Dupla URL` no aparece en Dynamic content, usar expression manual `item()?['Excel Dupla URL']`.
- **`Importe` como Number**: usar `float(item()?['Importe Total'])` (gastos) o `items('Apply_to_each_Solicitud')?['Importe']` (solicitudes) para forzar conversión.
- **Document Library aparece como "ドキュメント"** (japonés): es el OneDrive normal, bug conocido de localización de Microsoft Connectors. Funciona sin problema.
- **Configure run after tolerante**: cuando un mail tiene solo gastos, `TablaSolicitudes` no existe → `List rows Solicitudes` falla con `NotFound`. Y viceversa. Ambos `List rows` deben tener `is successful + has failed + is skipped` marcado. El `Apply to each Solicitud` también debe tener `has failed + is skipped` respecto a `For each 1` (que puede fallar si `TablaGastos` no existe).
- **File lock 502 del Excel Online**: si aparece `List rows failed: BadGateway (502)`, chequear que el archivo Excel no esté abierto en Excel Desktop / Excel Online / Teams. El nombre único de v3 previene esto pero puede pasar si alguien abre el archivo cacheado.

### Estado actual del flow

> **v3 en producción** (2026-07-29): pipeline completo funcional para gastos + solicitudes. Cada item de SharePoint tiene su Excel filtrado adjunto (`Rendiciones_<vendedor>_<tipo>.xlsx`) — al abrirlo se ven SOLO las rendiciones de esa dupla, no las de todos los vendedores. Ver `POWER_AUTOMATE_RENDICIONES.md` para el manual operativo y el `Plan de migración v3`.

---

## 17) Sección: Alta Clientes

Tab con **3 sub-tabs**:
1. **Nuevo cliente** (formal, doble aprobación).
2. **Alta rápida** (provisorio, NUEVO desde v183+).
3. **Mis solicitudes** (ver/eliminar las propias).

### Flujo formal "Nuevo cliente" (doble aprobación)

End-to-end:

1. **Vendedor (o público vía `alta-cliente.html`)** carga la solicitud con:
   - Datos del comercio (razón social, fantasía, CUIT, condición fiscal).
   - Dirección completa.
   - Foto ARCA + IIBB + hasta 3 fotos del local.

2. **Estado**: `pending_approval`.

3. **Aprobador** (admin / gerente / interno) ve la notificación.

4. **Modal de aprobación** con campos extras:
   - **CardCode SAP B1** (input — sin esto no se pueden crear pedidos).
   - **Vendedor asignado** (dropdown VDE / VDI / Distribuidor).
   - **Localidad final** (override si la declarada no matchea).

5. Necesita **2 aprobaciones** distintas para pasar a `approved`.

6. Cuando se aprueba → listener `ensureApprovedAltasListener` la agrega al mapa en su provincia/localidad con el vendor asignado.

7. El vendedor entra a la app y ve la tienda en su zona como "Habilitada" lista para crear pedidos.

### Flujo "Alta rápida" (NUEVO en v183+)

Para cuando el vendedor necesita crear un pedido **YA** y no puede esperar la doble aprobación + carga en SAP:

1. Sub-tab **"Alta rápida"** → formulario corto: comercio, dirección, **provincia + localidad obligatorias**, dueño, teléfono opcional, **CUIT opcional (v294+)**.
2. Crea un documento en `client_applications` con:
   - `source: 'alta_rapida'`
   - `manualSapPending: true`
   - `status: 'approved'` (la app no exige doble aprobación para alta rápida).
   - `cuit: <solo digitos>` si el vendedor lo cargó — habilita match automático confiable en el próximo sync SAP.
3. **Notifica automáticamente a admin** (`type: 'alta_rapida_creada'`) con texto "X dio de alta rápida a ... — hay que cargarlo manualmente en SAP".
4. La tienda aparece **al instante** en:
   - Mapa (pin SAP).
   - Picker de Pedidos (`buildPedidoVisibleKeysSet`).
   - Visitas (dropdown localidad + tienda).
   - Rutas (picker custom).
5. Se identifica con badge **"⚡ PROVISORIO (cargar a SAP manual)"** + fondo crema en todas las vistas.
6. Admin más tarde la carga formalmente a SAP:
   - **Con CUIT (v294+)**: el próximo cron `sync_bp_pesca` (cada 30 min) matchea por CUIT en `find_match()` → `PROV→CONF` automático. Sin intervención manual.
   - **Sin CUIT o si el nombre no matchea exacto**: admin abre **Master Clientes → 👤 Provisorios → 🔗 Vincular con SAP** y elige el BP correcto (auto-ranking por CUIT match si hubiera; ordenado alfabético si no). Setea `cardCodeSap` + `manualSapPending: false` + `source: 'sap_sync_manual_link'` + auditoría (`linkedFromSapDocId`, `linkedBy`, `linkedAt`) y **elimina el BP SAP duplicado** que había creado el sync.

### Sub-tab "Mis solicitudes"

Lista las altas creadas por el usuario. **Botón Eliminar** (NUEVO v184+) con guard: **NO permite borrar altas que ya tienen `cardCodeSap`** (porque significa que están cargadas en SAP). Las rules también validan esto server-side.

### Auto-aparición en el mapa

Implementado con un index global `approvedAltasByLoc[PROV|LOCALIDAD]`. `effClients(p)` suma las altas de esa localidad al listado del point. `filteredPoints()` incluye points cuya localidad tenga alguna alta asignada al vendor del filtro.

### `drawSapAltaPins` — anclaje a centroide de localidad (v186+)

Cuando un alta SAP no tiene `lat/lng` (no se geocodificó todavía), el pin se dibuja en el **centroide de su localidad** si se conoce, no en el medio de la provincia. Esto evita el problema visual histórico de tiendas SAP apiladas en el centro de la provincia.

Además respeta `vendor_overrides` vía `getEffectiveVendorForSapAlta(a)`: si la tienda fue reasignada por modal Zonas, el pin se pinta con el color del vendor efectivo.

---

## 18) Sección: Notificaciones (Alertas y tareas)

3 sub-tabs:
- **Recibidas**: alertas + tareas + derivaciones VDI pendientes.
- **Realizadas**: las ya cerradas.
- **Crear tarea**: form para mandarle una tarea a otro usuario con texto + imágenes.

Tipos de notificación:
- `partner_action` (subtype `order_created`): VDI cargó un pedido en nombre del VDE.
- `client_approval_ack`: tu alta cliente fue aprobada.
- `alta_rapida_creada`: notifica a admin cuando un vendedor crea un cliente provisorio que hay que cargar a SAP manual.
- Derivaciones de ruta.
- Tareas manuales entre usuarios.

### Botón Eliminar por card (NUEVO en v179+)

Cada notificación recibida tiene un **botón Eliminar rojo** alineado a la derecha. Borra el doc de `notifications/{fsId}` (las rules permiten delete si auth.uid == targetUid). Funciona para **todos los tipos**, no sólo tareas. Útil para limpiar la bandeja sin esperar a marcar como hecho.

---

## 19) Sistema VDE-VDI (vendedor externo / interno)

### Concepto

- **VDE** (vendedor externo): visita las tiendas, recibe pedidos. Su zona es restringida geográficamente.
- **VDI** (vendedor interno): hace soporte desde la oficina. Atiende llamadas de tiendas, carga pedidos en nombre de un VDE pareja cuando este está en ruta.

### Configuración de pareja

En el panel admin "Usuarios", al vendedor VDE le aparece un campo dropdown "**Pareja interno**". Se elige un usuario con rol `interno`. Esto setea `roles/{vde}.internalPartnerUid = uid_vdi`.

### Filtrado para VDI

El VDI ve en el mapa **solo las zonas de sus VDEs pareja**. Implementado en `loadMyExternalPartners()`:
1. Listener `where('internalPartnerUid', '==', currentUser.uid)` sobre `roles`.
2. Filtra los que tienen `role = 'vendedor'`.
3. Construye `myExternalPartners` con vendor key de cada VDE.

Cuando el VDI abre el header, el dropdown Zona muestra sus VDEs como opciones.

### Acción en nombre de

En el modal "Confirmar Pedido" y "Visita", si el usuario es VDI con parejas, aparece un dropdown "**Crear en nombre de**" con opciones VDE.

Al confirmar:
- `ownerUid = uid_vde` (dueño es el VDE).
- `createdByUid = uid_vdi` (auditoría).
- `onBehalfOf = true`.

El VDE recibe una notificación automática "X cargó un pedido en tu nombre".

---

## 20) Provincias hardcoded a VDIs

Para que sin filtros el mapa muestre las regiones de distribuidores con el color del VDI correspondiente:

```python
IOANNIS_PROVINCES = {
    'TIERRA DEL FUEGO', 'SANTA CRUZ', 'CHUBUT', 'RIO NEGRO',
    'NEUQUEN', 'LA PAMPA', 'MENDOZA',
}
SANTIAGO_PROVINCES = {
    'SAN JUAN', 'SAN LUIS', 'JUJUY', 'SALTA', 'CATAMARCA',
    'SANTIAGO DEL ESTERO', 'FORMOSA', 'CHACO', 'MISIONES',
    'LA RIOJA', 'TUCUMAN',
}
```

Aplicado en el build script al asignar `dept['vendor']`: si la provincia está en uno de los sets, sobreescribe el vendor por el VDI correspondiente.

Cuando se filtra Ioannis → ve **sus provincias + Federico + Gonzalo**. Idem Santiago con Mauricio + Martin.

---

## 21) Campañas comerciales

Admin (+ gerente desde v208+) crea campañas con:
- Nombre + descripción.
- Fechas vigencia (desde / hasta).
- SKUs incluidos.
- Zonas / vendedores aplicables.

En el picker de productos del pedido, los SKUs en campaña activa aparecen marcados con badge **★ CAMP**.

Tab "Campañas Activas" (botón amarillo del header) muestra el detalle.

### Progreso GLOBAL (v207+)

Antes, cada vendedor veía solo **su aporte** sobre el target de la campaña — un VDE podía ver "12 / 200 unidades" aunque entre el equipo ya hubieran cargado 180. Confundía la lectura.

Desde v207+ el progreso se calcula **sobre el scope de la campaña**:
- Source: `globalPedidos` (todos los pedidos confirmados de todos los users, no solo `confirmed{}` del propio).
- Helper `passesCampScope(p)`: filtra según el `scope` configurado en la campaña:
  - `all` → cuenta todos los pedidos.
  - `vendor` → solo del vendor target.
  - `province` → solo de la provincia target.
- Admin/gerente y vendedor/interno ven exactamente el mismo número (el progreso del equipo, no el aporte individual).

---

## 22) Targets mensuales

Admin/gerente carga el objetivo de facturación en ARS por vendedor + año + mes desde el modal **Targets mensuales** (header → botón Targets).

Colección Firestore: `targets`. Doc ID: `{vendorKey_normalizado}_{year}_{monthPadded2}` (ej: `GONZALO_DE_LA_ROSA_2026_07`). Payload:
```js
{
  sellerId: "GONZALO DE LA ROSA",  // vendorKey (el UPPERCASE del array VENDORS)
  year: 2026,
  month: 6,                        // 0-11 (índice del array MESES)
  targetArs: 120000000,
  updatedAt: <Ts>,
  updatedBy: "<uid>",
  updatedByEmail: "..."
}
```

- Meses vacíos se persisten como `delete()` del doc (no se guarda 0).
- Autosave por click en Guardar (no debounced).
- El dashboard suma `getCumulativeTargetArs(vendorKey, year, throughMonthIdx)` para el % de cumplimiento acumulado.

### Export Excel formato largo (v297+)

Botón verde **📊 Exportar Excel** en el footer del modal Targets → descarga `Targets_Shimano_YYYY-MM-DD.xlsx` con una fila por (vendedor, mes) con target > 0.

Columnas exactas (matchea el master que sube gerente a SAP / Power BI):

| SlpCode | Vendedor | Año | Mes | Meta |
|---|---|---|---|---|
| 50 | Gonzalo de la Rosa | 2026 | 7 | 120000000 |
| 50 | Gonzalo de la Rosa | 2026 | 8 | 125000000 |

- `SlpCode` ← `sapGetSlpCodeForVendor(vendorKey)` desde `sap_vendors` (vacío si el vendedor no está mapeado a SAP).
- `Vendedor` ← preferencia `sap_vendors.slpName` (formato SAP "Gonzalo de la Rosa"). Fallback: `titleCase(vendorKey)`.
- `Año` / `Mes` / `Meta` — directo del doc. **`Mes` se convierte 0-11 → 1-12** para el Excel.

Orden: SlpCode → Vendedor → Año → Mes. Anchos de columna razonables via `ws['!cols']`.

Permisos: `canManageTargets()` (admin/gerente + emails allowlist).

### Sync a BigQuery — vista `v_targets` (2026-07-14)

Además del Excel manual, los targets se sincronizan **cada 30 min automáticamente** al modelo Power BI. Pipeline:

```
Firestore.targets ──► sync_sap_to_bigquery.py:sync_targets_from_firestore()
                     ──► BigQuery.shimano_app.targets_raw (WRITE_TRUNCATE)
                     ──► v_targets (CREATE OR REPLACE VIEW en bigquery/views.sql)
                     ──► Power BI Import
```

`v_targets` expone las metas al modelo con **SlpCode SAP ya traducido desde el vendorKey app** (mapeo hardcoded en el CASE de la vista). Ver **sección 40** para el mapeo canónico completo, discrepancias detectadas contra SAP prod, y verificaciones de aceptación.

**Uso en Power BI**:
- Import como tabla nueva `v_targets` (BigQuery connector, dataset `shimano_app`).
- Relación: `v_targets[slp_code]` ↔ `Vendedores[SlpCode]` (o dim equivalente).
- Medidas típicas:
  ```dax
  Target Mensual = SUM ( v_targets[target_ars] )
  Pct Cumplimiento = DIVIDE ( [Facturación Total], [Target Mensual], 0 )
  Color Cumplimiento =
      VAR Ratio = DIVIDE ( [Facturación Total], [Target Mensual], 0 )
      RETURN SWITCH ( TRUE (),
          Ratio >= 1,    "#22C55E",   -- verde: cumplió/superó
          Ratio >= 0.9,  "#F59E0B",   -- amarillo: 90-99%
          "#EF4444"                    -- rojo: < 90%
      )
  ```
  El `Color Cumplimiento` se aplica en formato condicional de cards/tablas: **Formato → Fondo → f(x) → Basado en valor de campo → Color Cumplimiento**.

---

## 23) Panel Master Clientes + import SAP

### Master Clientes — Direcciones

Tab que lista todas las tiendas del mapa con un input para cargar la **dirección exacta** de cada una. Mejora la precisión del link de Google Maps al enviar la ruta por WhatsApp.

Filtros: vendor / provincia / localidad / estado / búsqueda.

### Dropdown editable de provincia para altas SAP (NUEVO en v185+)

Las filas que son altas SAP (no POINTS originales) tienen un **dropdown editable de provincia** en la columna provincia. Al cambiar la provincia:
- Se actualiza `client_applications.{id}.provincia`.
- Se **auto-infiere el vendor** según `inferVendorFromProvince()` + `PROVINCE_VENDOR_OVERRIDE` + sets VDI hardcoded.
- Se **limpian `lat/lng`** para forzar re-geocodificación en la próxima corrida de "Reubicar pines".

### Altas SAP sin provincia → grupo "(sin provincia)" (v186+)

Antes: las altas que se importaban sin provincia quedaban invisibles (no se mostraban en Master Clientes). Ahora aparecen bajo un grupo virtual **"(sin provincia)"** así Admin las puede ver y completarles la provincia con el dropdown.

### KPI "LEADS" del header — evolución del contador (v292 → v386)

**v292 (2026-07-13) — Antes:** `updateStats()` contaba como `pendientes`:
- POINTS/prospectos no contactados +
- SAP altas sin `provincia + geo + dirección`, filtradas por vendor/provincia/localidad activos.

Mientras que el badge del botón **👤 Provisorios** (v290+) contaba los `approvedAltasList.filter(a => a.manualSapPending && !a.cardCodeSap)` **totales globales**. Confundía porque los números no coincidían (ej: 3 vs 16).

**v292 fix:** el KPI del header (`.js-stat-p`) pasó a usar `getProvisoriosList().length` — el mismo total global que el badge. Ambos mostraban los provisorios de Alta Rápida pendientes de cargar a SAP.

**Efecto colateral:** el KPI dejó de responder al filtro de zona/provincia/localidad → confundía en la operación diaria del vendedor que cambia de zona (todos los demás contadores se actualizaban menos "PENDIENTES").

**v386 (2026-08-03) — Ahora:**
1. Label renombrado **PENDIENTES → LEADS** en las 2 stat-boxes (mobile header + desktop sidebar) para dejar claro que es un contador de oportunidades comerciales, no un "backlog administrativo".
2. `_provisoriosCount` **vuelve a respetar los filtros activos** (`getEffectiveVendorSet(currentVendor)` + `currentProvince` + `currentLocality`), pero mantiene la definición semántica de v292 (solo provisorios `manualSapPending && !cardCodeSap`, no POINTS/prospectos legacy).
3. El badge del botón **👤 Provisorios** del Master Clientes (`updateMcProvisorioCount` en `src/domains/master-clientes.js:123`) sigue global — es lo que ese contexto necesita, no se toca.

Resultado: KPI LEADS del header respeta el scope activo (útil para el vendedor), badge Provisorios del Master Clientes muestra el total global (útil para el admin).

### Fix crítico: sync SAP pisaba localidad/provincia manuales (v291+, 2026-07-13)

**Bug reportado por Mariano:** completó a mano ~20 tiendas SAP con localidad + provincia en Master Clientes, guardó fila por fila. A las pocas horas, todas volvían a aparecer con `(sin localidad)` y `(sin provincia)`.

**Causa raíz:** el workflow `sync-sap-catalog-stock.yml` corre cada 30 min (`cron: '13,43 * * * *'`) y ejecuta `scripts/sync_sap_to_firestore.py`, que dentro de `sync_bp_pesca()` hace `set({merge:True})` sobre cada BP con un `base_payload` que **siempre incluye** `localidad`, `localidadFinal`, `provincia` — aunque SAP los tenga vacíos. Como muchos BPs argentinos vienen sin `City`/`State` cargados desde SAP B1, cada corrida escribía `''` sobre esos campos y **destruía el trabajo manual del admin**.

**Fix:** justo después de construir `base_payload` se hace `pop()` de `localidad` / `localidadFinal` cuando `bp.City` viene vacío, y de `provincia` cuando `provincia_final` viene vacío. Así el merge preserva lo que el admin ya cargó.

**Trade-off consciente:** si en el futuro el admin edita localidad/provincia y en SAP B1 alguien carga un valor DISTINTO, el sync va a pisar el edit del admin con lo de SAP (comportamiento "SAP siempre gana", consistente con `runRevisarDireccionesSap`). Si eso también molesta, hay que agregar un flag `localidadManualOverride:true` que el sync respete.

### Autosave debounced en filas SAP (v291+)

**Problema previo:** el input de localidad y el dropdown de provincia de las filas SAP solo se persistían cuando el admin tocaba GUARDAR de la fila. Además `mcPendingChanges` solo trackeaba el input de dirección, así que el aviso "Hay cambios sin guardar" al cerrar el modal NO detectaba localidad/provincia sin guardar → se perdían silenciosamente al cerrar. Peor: el listener `ensureApprovedAltasListener` re-renderea toda la tabla ante cualquier snapshot (`cont.innerHTML = html`), lo que borraba inputs no guardados de otras filas mientras trabajabas.

**Fix:**
- Cada cambio en localidad / provincia / dirección de una fila SAP dispara `scheduleMcAutosave(docId, row, 900)`.
- Cae dentro del mismo `saveMcAddr` que ya usa el botón GUARDAR (misma lógica de merge + geocode).
- Se muestra un badge amarillo en las stats: `Guardando 3...` o `Pendientes: 3`.
- El listener de `approvedAltasList` NO re-renderea la tabla si hay saves en vuelo (`mcAutosaveInFlight > 0`) o inputs con debounce pendiente. Difiere el re-render con `mcRenderDeferred = true` hasta que todo esté commiteado, y ahí sí lo aplica.
- `closeMasterClientesPanel` ahora también chequea `mcPendingRowIds` y `mcAutosaveInFlight` — si hay algo pendiente, confirmación al cerrar.

Válido solo para altas SAP (filas con `tipo='sap_alta'`). Los POINTS legacy siguen con el botón GUARDAR clásico porque su localidad/provincia están atadas al docId del padrón.

### Botón "👤 Provisorios" — filtrar altas rápidas pendientes de SAP (v290+)

Toolbar violeta al lado de "Masterfile-Base". Muestra el conteo pendiente en un badge (ej. `👤 Provisorios 4`).

Filtra `approvedAltasList` por `manualSapPending === true && !cardCodeSap` — o sea, los clientes que un vendedor dio de alta por **Alta Rápida** y que todavía no fueron cargados a SAP manualmente por admin.

Al tocarlo:
- La tabla del Master Clientes reemplaza sus filas por los provisorios (fondo crema `#fffbeb`, badge morado **⚡ PROVISORIO**).
- Columnas: Comercio (con dueño + teléfono), Localidad, Provincia, Vendedor asignado / dado de alta por, Dirección de Alta Rápida (`calle`), Fecha de alta.
- Los filtros vendor / provincia / localidad / búsqueda siguen aplicando. El filtro "Con/Sin dirección" se ignora porque no aplica a solicitudes.
- Segundo click → vuelve al modo default (Master SAP).

El badge se actualiza en tiempo real vía `updateMcProvisorioCount()` disparado dentro del listener `ensureApprovedAltasListener`.

### Botón "🔗 Vincular con SAP" en cada fila provisorio (v294+, admin only)

Cuando el auto-match del cron `sync_bp_pesca` falla (nombre normalizado difiere entre el provisorio y el CardName SAP, o el provisorio no tiene CUIT cargado), admin puede vincular manualmente:

1. Master Clientes → **👤 Provisorios** → columna "Acción" → **🔗 Vincular con SAP**.
2. Modal `#vincular-sap-modal` abre con:
   - **Info del provisorio** (nombre + localidad + provincia + CUIT + dirección).
   - **Buscador** por nombre / CardCode / CUIT (default: pre-populado con el CUIT o comercio del provisorio).
   - **Lista de BPs SAP disponibles** (filtro: `approvedAltasList` con `cardCodeSap` truthy y `!manualSapPending`).
   - **Auto-ranking**: los BPs cuyo CUIT matchea el CUIT del provisorio aparecen primero con badge verde "✓ CUIT MATCH".
3. Click en **Vincular** → confirm → batch:
   - `set(provisorio, {cardCodeSap, manualSapPending: false, source: 'sap_sync_manual_link', linkedFromSapDocId, linkedBy, linkedAt, ...camposSAP}, {merge: true})`.
   - Completa campos vacíos del provisorio (cuit/calle/localidad/provincia/email/tel/CP) con los de SAP sin pisar los cargados.
   - `delete(bpSap)` — elimina el BP SAP duplicado que había creado el cron.
4. El listener `approvedAltasList` repinta todo automático. El provisorio salta a CONFIRMADOS.

**Permisos**: solo `admin` (columna muestra "(admin)" para gerente/interno). Motivo: el batch.delete del doc SAP con `cardCodeSap` requiere `role=admin` en Firestore Rules — gerente no es owner del doc creado por el sync.

**Retrocompat**: la auditoría en `linkedFromSapDocId` guarda el ID del BP borrado para reconstruir manualmente si admin se equivocó de match.

### Botón Eliminar 🗑 por fila (v200+)

Cada fila tiene un **botón rojo 🗑** al lado de Guardar. Sólo visible para **admin / gerente**. Comportamiento según el tipo de fila:

| Tipo | Acción | Confirmación |
|---|---|---|
| **Alta SAP** (`sapFsId`) | Borra el doc de `client_applications` | Confirm extra con **warning** si la tienda ya tiene `cardCodeSap` (está en SAP) |
| **POINTS legacy** | Borra el doc de `client_master` (limpia dirección) | Confirm simple. El nombre del cliente queda en el padrón POINTS hasta el próximo rebuild del HTML |

Útil para limpiar tiendas duplicadas que aparecen post-import SAP (mismo cliente con razón social y fantasía).

### Import desde SAP B1

Botón naranja **📥 Importar desde SAP** abre un sub-modal con drop zone para subir el master de Business Partners exportado de SAP B1 (CSV o XLSX).

### Lógica del import

1. **Parsing tolerante de columnas**:
   - SKU/CardCode: `CardCode`, `Codigo`, `Code`, `ID`.
   - Nombre: `CardName`, `Name`, `Nombre`, `Razon Social`.
   - Dirección: `Address`, `Direccion`, `Street`, `Calle`.
   - Ciudad: `City`, `Ciudad`, `Localidad`.
   - Provincia: `State`, `Province`, `Provincia`.

2. **Matching de 3 niveles** entre `cardName` SAP y `clientName` POINTS:
   - **Exact**: mismo nombre normalizado (uppercase, sin acentos, sin caracteres especiales, sin sufijos `SA`, `SRL`, `SAS`, `EIRL`, `LTDA`).
   - **Fuzzy**: similitud Levenshtein ≥ 0.82 + misma provincia.
   - **Sin match**: se crea como cliente nuevo.

3. **Preview** con stats:
   - Filas en el archivo.
   - Matches exactos (verde) + fuzzy (ámbar) + nuevas (azul).
   - Lista de fuzzy con porcentaje (para verificación manual).
   - Lista de nuevas con CardCode + ciudad.

4. **Apply**:
   - **Matcheadas**: sobrescribe `client_master` con datos SAP (nombre, dirección, localidad). El nombre/localidad originales se guardan como backup en `clientNameOriginal`/`localidadOriginal`. Se agrega al set `contacted` (auto-habilitar).
   - **Nuevas**: se crean como `client_applications` con `status: 'approved'` + `source: 'sap_bulk_import'` + **`ownerUid` populado** (fix de permisos: antes las rules rechazaban escrituras sin owner). El vendor se infiere de la provincia con `inferVendorFromProvince()`. Aparecen al instante en el mapa vía `ensureApprovedAltasListener`.

5. **Batches** de 400 docs (límite Firestore es 500). Si el batch falla, **fallback individual** doc-por-doc con log de errores.

6. **Alert visible al final** con conteo real de tiendas creadas + cuántas quedaron **sin provincia** (para que Admin las complete vía el dropdown del Master).

---

## 24) Modal Zonas (reasignación)

**Admin y gerente** (desde v201+). Botón violeta **🗺️ Zonas** en el header.

> Antes `openZonasModal` bloqueaba a `gerente` con "Solo el administrador puede reasignar zonas". Desde v201+ el guard se removió — las Firestore rules de `vendor_overrides` ya permitían gerente.

### Tabs (4 desde v201+)

1. **Por tienda**: lista de cada tienda con dropdown para cambiar de vendor.
2. **Por localidad**: igual pero a nivel localidad (afecta todas sus tiendas).
3. **Por provincia** (NUEVO en v201+): una fila por provincia con conteo de tiendas + vendor dominante actual.
4. **Historial**: últimos 50 cambios con quién, cuándo, de quién a quién. El historial muestra `scope='prov'` con icono globo 🌎.

### Destinos disponibles

- **Vendedores externos** (VDE): los 4 reales (Mauricio, Martin, Gonzalo, Federico).
- **Vendedores internos** (VDI): Ioannis, Santiago.
- **Otros (admins)**: cargados de Firestore con rol `admin`.
- **DISTRIBUIDOR**: sale de venta directa, aparece solo en filtro Distribuidores.

### Cascada de prioridades (v201+)

Cuando hay overlap entre scopes, se respeta esta cascada (más específico gana):

```
Override localidad   ← más específico
Override provincia   ← nuevo en v201+
PROVINCE_VENDOR_OVERRIDE hardcoded
Vendor original del POINT
```

`applyVendorOverridesToPoints` aplica `scope='prov'` **antes** de `scope='loc'`, así un override de localidad puntual puede sobreescribir al override provincial.

### Persistencia

Colección `vendor_overrides/{docId}` con campo `scope: 'shop' | 'loc' | 'prov'`. Listener `ensureVendorOverridesListener` aplica los cambios en tiempo real:
- **Override de provincia** (nuevo): muta `p.vendor` de todos los POINTS de esa provincia.
- **Override de localidad**: muta `p.vendor` del POINT → automáticamente afecta el filtro, marker color, contadores.
- **Override de tienda**: `getEffectiveVendorForClient(p, name)` lo respeta en `effClients(p)`, `filteredPoints()`, y `deptStyle()` (via `deptEffectiveVendor`).

### Distribuidor en deptStyle

Cuando el vendor mayoritario de un dept es `__DISTRIBUTOR__`, **solo se pinta azul si el filtro Tipo = Distribuidores está activo**. Sino, ignora `__DISTRIBUTOR__` del conteo y usa el segundo vendor mayoritario (o el original del Excel).

### Toast verde con detalle (v203)

Nueva función `showZonasToast(title, items)`: toast **fixed arriba al centro**, gradiente verde, fade in/out, max 560px de ancho, **auto-close 5 seg**.

Se dispara después de:
- `saveZonasChanges` (Save explícito).
- `onZonasSapAltaChange` (instant save al cambiar vendor de un alta SAP).

Mensajes según el `scope` del override aplicado:

| Scope | Texto del item |
|---|---|
| `prov` | `Provincia X → <Vendor>` |
| `loc` | `Localidad X (Provincia) → <Vendor>` |
| `shop` | `Tienda X en Localidad → <Vendor>` |

Si hay más de 5 cambios en el save, el toast muestra los **primeros 5 + "y N más"**.

---

## 25) Integración SAP B1

Dos vías paralelas (no excluyentes):

### Vía 1: ZIP DTW manual (funcional desde 2026-06-19)

Estado: **OPERATIVO** — probado E2E en SHIMANO_TST_06.

#### Cómo funciona

1. Vendedor confirma pedido en la app.
2. Pasa a estado `pending`.
3. Admin (vos) marca el pedido como "Listo para SAP" en el panel Pedidos.
4. Pestaña "Listos" → botón **"Exportar ZIP DTW"**.
5. Se descarga un ZIP con:
   - `OQUT - Documents.csv` (cabecera Sales Quotation).
   - `QUT1 - Document_Lines.csv` (líneas).
   - `_README.txt` con instrucciones.
6. Abrir DTW conectado a SAP B1 base correcta.
7. Import → Transactional Data → Add New Data → Sales → Sales Quotation.
8. Apuntar a los 2 CSV → Next → Next → Run.
9. Verificar en SAP que las Quotations se crearon con serie APP + UDFs poblados.

#### Headers del CSV (formato DTW oficial)

Header fila 1: nombres "user-friendly" (UserSign, DocCur, etc).
Header fila 2: nombres internos SAP (DataSource columns).
A partir de fila 3: datos.

Total: ~180 columnas. Solo poblamos las necesarias:
- `DocNum`, `DocType=dDocument_Items`, `HandWritten=tNO`, `Printed=psNo`.
- `DocDate`, `DocDueDate` (+30 días), `TaxDate`.
- `CardCode` (del mapeo `sap_clients` o `client_master.sapCardCode`).
- `Comments` (`AppShimano | cliente | mes | email`).
- `NumAtCard` (= `_fsId` del pedido en Firestore para trazabilidad legible).
- `SalesPersonCode` (SlpCode del mapeo `sap_vendors`).
- `Series` (id 103 PROD / 104 TEST configurado en `app_config.sap_integration.appSeriesId`).
- `DocObjectCode = '23'` (Sales Quotation — el código numérico, NO el enum string `oQuotations`).
- `U_AppOrigen = 'SHIMANO_APP_VENDEDORES'`.
- `U_AppOrderId = <FSId>`.
- `U_AppBatchId = 'BATCH-YYYYMMDD-HHMMSS-XXXX'` (todos los pedidos del ZIP comparten el BatchId).
- `U_TipoGasto = <condicionPago>` o `'CONDICION'` si no se eligió.
- **Comments extendido con "Forma de entrega"** (v271, v273+): se agrega un sufijo al string base con la info logística que el vendedor cargó en el modal review. Formato:
  - **TRANSPORTISTA**: `| Entrega TRANSPORTISTA: <nombre> - <direccion transportista> | Entrega al cliente: <direccion cliente>`
  - **SUCURSAL**: `| Entrega SUCURSAL: <direccion>`
  - Ejemplo completo: `AppShimano | GUSTAVO BARGELLINI | Junio 2026 | vendedor@shimano.com.ar | Entrega TRANSPORTISTA: Cruz del Sur - Av. Corrientes 1234, CABA | Entrega al cliente: Av. Belgrano 4567, Rio Cuarto`
  - Implementado en `buildEntregaSuffixForRemarks(pedido)` — usado por SL y DTW CSV.
  - Cuando Ezequiel Mendoza (SEIDOR) cree UDFs dedicados (`U_FormaEntrega`, `U_TransportistaNombre`, `U_TransportistaDireccion`, `U_DireccionEntregaCliente`), reemplazar el sufijo por campos separados en el payload y sacar la info del Comments.

Líneas (`QUT1`):
- `ParentKey` = `DocNum` del header.
- `LineNum`, `ItemCode` (mapeo `sap_products`), `Quantity`, `WarehouseCode='07'`.

### Vía 2: Service Layer directo (preparado, esperando bloqueantes)

Estado: **CÓDIGO LISTO** — en espera de CORS + usuario integración.

#### Configuración

Panel admin → SAP → pestaña **🔗 Service Layer**:
- URL: `https://shimano-sap.seidor.com.ar:50000`
- CompanyDB: `SHIMANO_SAU` (PROD)
- Usuario: `APP_VENDEDORES` (a crear con Juan IT)
- Password: a definir
- Toggle: **enabled**

#### Cliente JS (`window.sapSL`)

```js
sapSL.login()                    // POST /b1s/v1/Login
sapSL.ensureSession()             // TTL 25 min
sapSL.fetchWithSession(path, opts) // wrapper con retry 401
sapSL.createQuotation(payload)    // POST /b1s/v1/Quotations
sapSL.getStock(itemCode, whsCode) // GET stock por SKU
sapSL.buildQuotationPayload(pedido) // pedido app → JSON OQUT
```

#### Cómo funciona el envío automático

Cuando el toggle SL está ON, al confirmar un pedido en la app:
1. Se arma el payload JSON con `buildQuotationPayload(pedido)`.
2. Se hace `POST /b1s/v1/Quotations`.
3. SAP devuelve `{DocEntry, DocNum, ...}` con el número real de la Quotation.
4. La app marca el pedido con `transferidoSAP.via = 'service_layer' + docEntry + docNum`.
5. El pedido pasa a estado `sap_imported`.

#### Diagnóstico de errores en "Probar conexión"

- **CORS bloqueado**: "Error de red o CORS" → escalar a Alejandro Caracchi.
- **Credenciales mal**: "HTTP 401" → revisar usuario/pass.
- **CompanyDB incorrecta**: "DB not found" → verificar nombre exacto.
- **Sin licencia**: "User has no permission" → escalar a Juan/SEIDOR.

### UDFs creados en SAP B1

| UDF | Tipo | Campo | Para qué |
|---|---|---|---|
| `U_AppOrigen` | Alphanumeric (30) | Marketing Doc Title | Constante `SHIMANO_APP_VENDEDORES` para filtrar pedidos de la app |
| `U_AppOrderId` | Alphanumeric (30) | Marketing Doc Title | ID Firestore del pedido (28 chars) |
| `U_AppBatchId` | Alphanumeric (40) | Marketing Doc Title | ID del lote de export ZIP |
| `U_TipoGasto` | Alphanumeric (10) | Marketing Doc Title (ya existía) | Condición de pago, default CONDICION |

UDFs aplican a OQUT (Sales Quotation) y ORDR (Sales Order).

### Series APP

- TEST_06: id **104** (autogenerado, rango 2000000-2999999).
- PROD: id **103** (a confirmar por Ezequiel).

Configurada en `app_config/sap_integration.appSeriesId`. Si está vacía, DTW usa serie default del usuario.

### Stock W07

El depósito 07 es el único que la app consulta para el indicador verde/rojo. NUR (operaciones internas) carga stock a W07 cuando llega mercadería.

---

## 26) Stock SAP

### Vía principal: Sync automático Service Layer (v246+)

Estado: **OPERATIVO desde 2026-07-01**.

**Flujo (GitHub Actions cron `13,43 * * * *`, cada 30 min):**

1. `scripts/sync_sap_to_firestore.py` corre en Actions.
2. Lee credenciales del SL desde `app_config/sap_integration.serviceLayer` (Firestore).
3. Login `POST /b1s/v1/Login`, itera `Items?$select=ItemCode,ItemName,ItemWarehouseInfoCollection` paginando via `@odata.nextLink` (SL responde ~20 items por página).
4. Por cada item calcula `stock total = suma de InStock en warehouses vendibles`. **Excluye W05 (Marketing) y W06 (Devoluciones)**. Suma W01/02/03/04/07/10/11/12.
5. **Filtro por Item Group PESCA** (v268+): en vez de filtrar client-side por el CSV inline de `index.html` (que dejaba fuera SKUs nuevos de pesca cargados directo en SAP), ahora se hace `?$filter=ItemsGroupCode eq <PESCA_NUMBER>` server-side. `PESCA_NUMBER` se resuelve dinámicamente vía `/b1s/v1/ItemGroups?$filter=GroupName eq 'PESCA'` (es `102` en SAP). Resultado: 755 items de pesca traídos (antes 665 con SKUs invisibles).
6. **Precios** (v268+): en el mismo query se agrega `ItemPrices` al `$select`. Extrae precio de la **lista PESCA #12 en ARS** (ver constante `PESCA_PRICE_LIST_NUM = 12` en el script) por cada item. Solo se escribe si `Price > 0`.
7. **Cantidades exactas** (v253+): además del `stock: {SKU: bool}` legacy se escribe `quantities: <JSON string>` con la cantidad por SKU. Serializado como STRING porque map con 10k+ keys exedía el límite de 40k index entries de Firestore por doc. El cliente hace `JSON.parse` en el listener.
8. **Backorder por SKU** (v377+, 2026-08-02): fetch adicional `sl_fetch_backorder_by_sku()` sobre `/b1s/v1/Quotations?$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'` que agrega `RemainingOpenQuantity` por `ItemCode`. Persistido como `backorderBySku: <JSON string>` (mismo patrón para evitar límite de 40k index entries). Fault-tolerant: si SL falla, `backorder_map={}` y la UI hace fallback silencioso. Se usa en el alert de stock del picker para computar **Stock Liberado = `max(transito(whs 12) − backorder, 0)`**. Mismo criterio que `v_backorder_lineas` de BQ, así los números coinciden con Data Studio.
9. Escribe a Firestore:
   - `product_catalog/chunk_N` (755 items en chunks de 4000)
   - `app_config/product_catalog_meta` (dispara listener)
   - `app_config/stock_snapshot` con `{stock: {SKU: bool}, quantities: "<json string>", warehouseBreakdown: "<json string>" (v368+), backorderBySku: "<json string>" (v377+), warehouse: 'ALL_SALES', ...}`
   - `app_config/price_list` con `{prices: {SKU: number}, currency: 'ARS', priceListNum: 12, priceListName: 'PESCA', ...}`
10. Escribe también `stock.json` en la raíz del repo y hace commit si cambió (consumido por el Google Sheet Inventario-Bot — ver sección específica).
11. Cliente: `ensureStockSnapshotListener`, `ensureProductCatalogListener` y `ensurePriceListListener` reciben los cambios en tiempo real. `PRODUCTS`, `STOCK_MAP`, `STOCK_QUANTITIES`, `STOCK_WAREHOUSE_BREAKDOWN`, `STOCK_BACKORDER` y `PRICE_LIST_MAP` se actualizan en memoria.

**Diferencia clave vs legacy**: antes se usaba W07 (PESCA EEUU, casi siempre vacío) → `withStock: 2`. Ahora `ALL_SALES` → `withStock: ~3459` reales.

**Workflow**: `.github/workflows/sync-sap-catalog-stock.yml`
**Permisos**: `contents: write` (para commitear `stock.json`)
**Cron desfasado** `13,43 * * * *` en vez de `*/30` para evitar throttling GitHub Actions en :00/:30.

### Vía manual: consulta live SKU (modal Master Productos)

Admin puede tocar botón "Consultar stock live" en el modal para un SKU específico → `sapSL.getStock(sku, 'ALL')` hace request directo al SL en el momento (no espera al cron). Muestra desglose por warehouse.

### Vía legacy (deprecada, cron desactivado)

`.github/workflows/sync-stock.yml` + `scripts/sync_stock.py`: leía un CSV que David subía a Drive. Dejó de actualizarse el 2026-06-18 (David dejó de subir el CSV). El schedule está comentado, solo queda `workflow_dispatch` manual como respaldo.

### Vía manual: CSV upload por admin (panel "Stock")

Sigue disponible como fallback pero rara vez se usa (sync automático la cubre). Botón **Stock** en header → drop zone del CSV → publicar. Escribe a `app_config/stock_snapshot` con `source: 'csv_manual'`.

### Precios: fuentes y prioridad (v268+, v270+)

La app resuelve el precio de un SKU consultando **2 fuentes** en orden:

1. **SAP** (`app_config/price_list.prices[SKU]`) — sync automático cada 30 min desde la lista PESCA #12 en ARS. Cuando administración carga un precio nuevo en SAP, aparece en la app en máximo 30 min sin acción manual.
2. **Temporal** (`app_config/price_list_temporal.prices[SKU]`) — fallback cargado por admin/gerente desde el modal Master de Productos para SKUs que aún no tienen precio en SAP.

**Resolución (`getPriceInfo(sku)`):**
- Si SAP tiene el SKU con precio > 0 → `{source: 'sap', price}` (SAP siempre gana)
- Si SAP no lo tiene pero temporal sí → `{source: 'temporal', price}` (fallback)
- Si ninguna fuente lo tiene → `{source: null, price: 0}` → UI muestra "(sin precio)"

**Cuando administración carga el precio real en SAP**, el próximo sync automático lo trae y `PRICE_LIST_MAP` ganará prioridad automáticamente. El precio temporal queda en Firestore pero se ignora (no hay que borrarlo manual).

**UI en Master de Productos (solo admin/gerente):**
- Nuevo checkbox **"Solo sin precio"** → filtra SKUs sin precio SAP NI temporal (lista de trabajo del admin).
- Badge amarillo `⏱ TEMPORAL` al lado del precio cuando la fuente es temporal.
- Botón por SKU:
  - **"💵 Cargar $"** (rojo) — SKU sin precio ninguno
  - **"✎ Editar $"** (amber) — SKU con precio temporal (editar o borrar con 0)
  - **"✎ Temp"** (gris) — SKU con precio SAP (permite cargar temporal pero no se usará)
- Prompt con contexto claro sobre la prioridad SAP > temporal + confirmación antes de escribir.

**Colección Firestore `app_config/price_list_temporal`:**
```
{
  prices: {SKU: number},         // fallback usado por getPriceInfo
  entries: {SKU: {price, by, byName, at}},  // metadata para auditoría
  updatedAt, updatedBy
}
```

Los writes usan dot notation (`prices.{SKU}` y `entries.{SKU}`) con `set/merge` para no pisar otros SKUs. Borrado usa `FieldValue.delete()`. Solo admin/gerente tienen permiso (validado en el cliente + rules).

### Bot Google Sheet "Inventario-Bot"

Sistema paralelo (mantenido por Federico) que lee `stock.json` cada 30 min y llena una columna "STOCK DISPONIBLE" en un Sheet con DISPONIBLE / NO DISPONIBLE / NO ENCONTRADO. **URL que consume**:

```
https://raw.githubusercontent.com/shimano-arg/app-vendedores/main/stock.json
```

(No usa GitHub Pages: los builds Jekyll venían fallando y el CDN cachea 10 min. `raw.githubusercontent` sirve directo del branch, ~30 seg de propagación y sin build.)

El script Apps Script hace `UrlFetchApp.fetch` con `?t=${Date.now()}` para bustear cache. Ver historial de commits para el código completo.

---

## 27) OCR de tickets con Gemini API

### Cómo funciona

1. Vendedor abre Rendiciones → Cargar gasto.
2. Saca foto del ticket.
3. La foto (data URL base64) se manda a Gemini con prompt:
   ```
   Extraé estos datos del ticket en JSON:
   - fecha (ISO YYYY-MM-DD)
   - monto (number, sin símbolos)
   - comercio (string)
   - tipoGasto (Combustible / Peaje / Alojamiento / Comida / Varios)
   Solo devolveme el JSON crudo, sin markdown.
   ```
4. Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=<API_KEY>`.
5. Vendedor verifica y confirma.
6. Se guarda en `rendiciones/{docId}` con la foto + datos.

### API Key

Almacenada en `app_config/gemini.apiKey`. Solo admin edita. Lectura general para que cualquier vendedor pueda OCRizar.

---

## 28) PWA installable

### Manifest

```json
{
  "name": "Shimano Vendedores",
  "short_name": "Shimano",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#dbeafe",
  "theme_color": "#00A9E0",
  "icons": [/* 4 tamaños */]
}
```

### Service Worker

`sw.js` — estrategia:
- **HTML / root**: network-first con fallback a cache.
- **Assets locales** (manifest, iconos, logo, login-bg): cache-first.
- **CDNs** (firebase, leaflet, sheetjs, jszip, OSM tiles): pasan directo a la red.
- **OAuth callbacks Firebase** (URLs con `state=`, `apiKey=`, etc): pasan directo a la red.
- **`stock.json`**: siempre network-first (sin cache) para datos frescos.

Cuando se bumpea `CACHE_VERSION` (cada deploy), el SW viejo borra sus caches y carga los nuevos al reabrir la PWA.

### Instalación

- **Android**: menú navegador → "Agregar a pantalla inicio".
- **iOS**: Safari → Compartir → "Agregar a pantalla inicio".

---

## 29) Backup TOTAL de la app

Botón en **Exportar para Análisis** → tarjeta naranja **"Backup TOTAL"** (solo admin).

### Qué descarga

Un ZIP único con:

#### `/firestore/` — 19 colecciones en JSON

```
roles.json, userData.json, pedidos.json, visits.json, campaigns.json,
notifications.json, client_applications.json, client_master.json,
client_locations.json, vendor_overrides.json, route_overrides.json,
targets.json, rendiciones.json, sap_clients.json, sap_products.json,
sap_vendors.json, app_config.json, allowed_emails.json,
operations_log.json
```

Cada archivo es un array de `{_id, _data}`. Los `Timestamp` se serializan como `{__type__: 'timestamp', iso: '...'}` para reconvertir al restaurar.

#### `/photos/{col}/` — fotos extraídas

```
photos/visits/<visitId>__frente.jpg
photos/visits/<visitId>__espacio_1.jpg ...
photos/client_applications/<id>__arca.jpg
photos/client_applications/<id>__iibb.jpg
photos/client_applications/<id>__local_1.jpg ...
photos/rendiciones/<id>__comprobante_1.jpg
photos/notifications/<id>__image_1.jpg
```

#### `/metadata/info.json`

Resumen estructurado: cantidad de docs por colección, fecha, usuario, errores.

#### `README.txt`

Instrucciones de restauración.

### Frecuencia recomendada

1 vez por mes. Calendarizar el día 1.

### Cómo restaurar

1. Abrir Firebase Console → Firestore → limpiar/crear colecciones.
2. Para cada `/firestore/<col>.json`:
   - Iterar el array.
   - Convertir Timestamps: `Timestamp.fromDate(new Date(iso))` antes de escribir.
   - `await fbDb.collection(col).doc(item._id).set(item._data)`.
3. Las fotos NO se restauran automáticamente — quedan como respaldo visual.

---

## 30) Exports a Excel / Power BI / ML

Botón **Exportar a Excel** (celeste) → **desde v371, dispatcher modal con 2 formatos**:

**Opción 1 · Reportes Excel** (todos los roles, comportamiento clásico) → 6 sub-opciones:
- **Ventas** (pedidos confirmados del mes).
- **Visitas** (con detalle por tienda).
- **Rendiciones** (gastos del período).
- **Rutas** (con cumplimiento).
- **Altas de clientes** (del período).
- **Clientes (masterfile)**: listado completo de tiendas con zona/vendedor/dirección/estado.

**Opción 2 · Dataset para análisis (ZIP)** — **v371+, solo admin/gerente** → 1 ZIP con 11 CSVs + `manifest.json` para pipelines de ML externos (Microsoft Fabric, Databricks, pandas). Ver §41 v371 para detalle completo del schema, matriz de casos de uso ML (A conversión visita→pedido, B churn, C forecast SKU, D anomalías rendiciones, E estacionalidad), convenciones RFC 4180, y gaps documentados. Ejecución ~10-30 seg client-side, ~1.322 filas exportables, sin fotos ni datos sensibles (`roles`/`app_config` excluidos por construcción).

Botón **Exportar para Análisis** (verde) → **visible SOLO para `erbinomariano@gmail.com`** desde v208+ (antes era admin + gerente). 5 opciones avanzadas:
- **Power BI** (fact + dim tables).
- **Python / IA / ML** (tabla larga).
- **Fotos de visitas (ZIP)**.
- **Excel con fotos embebidas**.
- **TARGETS-ZONAS** ← reescrito en v208+. Antes generaba el master full con todas las tiendas POINTS + altas mezcladas; ahora genera **UNA fila por BP vivo en SAP** (solo `client_applications` con `status='approved'` Y `cardCodeSap` no vacío). Excluye POINTS, distribuidores, prospectos y mocks. Columnas: TIPO / NRO CTE / REGION / PROVINCIA / ASESOR EXTERNO / ASESOR INTERNO / CALLE / NUMERO / LOCALIDAD / CP / NOMBRE COMERCIAL / NOMBRE DE FANTASIA / CUIT / CONDICION FISCAL / TELEFONO / **CARDCODE SAP** (columna nueva).
- **Backup TOTAL** ← ZIP con todo.

### Export desde modal Targets (v297+)

Aparte del botón "Exportar para Análisis" (admin only), el modal **Targets mensuales** tiene su propio botón **📊 Exportar Excel** que emite el master de targets en formato largo:

| Columna | Fuente | Notas |
|---|---|---|
| `SlpCode` | `sap_vendors.slpCode` | vacío si el vendedor no está mapeado |
| `Vendedor` | `sap_vendors.slpName` (fallback `titleCase(vendorKey)`) | formato "Gonzalo de la Rosa" |
| `Año` | `targets.year` | number |
| `Mes` | `targets.month + 1` | convertido a 1-12 |
| `Meta` | `targets.targetArs` | redondeado a entero |

Uso operativo: gerente exporta a Excel, ajusta si hace falta, y sube el master a SAP o a Power BI (fuente para la vista de cumplimiento). Ver sección 22 para detalles.

---

## 31) Panel admin "Usuarios"

Tabla con todos los usuarios:

- Email + displayName.
- Rol (dropdown).
- Vendor key (si es VDE).
- Pareja interno (dropdown VDI para VDEs).
- WhatsApp.
- Responsable de rendiciones (dropdown).
- Botón **🔐 Contraseña** (cambiar PIN del usuario).
- Botón **🔐 2FA** (configurar Authenticator).
- Botón **Eliminar** (no disponible para los 2 admins protegidos).
- Botón **Guardar**.

Mobile: layout cards en vez de tabla.

### Sección `allowed_emails`

Arriba de la tabla. Permite pre-autorizar emails antes del primer login.

---

## 32) URLs externas e integraciones

| Servicio | URL | Para qué |
|---|---|---|
| Firebase project | https://console.firebase.google.com/project/app-vendedores-shimano | Console |
| Firebase Auth | (mismo) → Authentication | Manage users |
| Firestore | (mismo) → Firestore Database | Manage data |
| Firestore Rules | (mismo) → Firestore → Rules | Edit security rules |
| GitHub repo | https://github.com/shimano-arg/app-vendedores | Code |
| GitHub Actions | (mismo) → Actions | Workflows |
| GitHub Secrets | (mismo) → Settings → Secrets | `SAP_STOCK_CSV_URL` |
| GitHub Pages | (mismo) → Settings → Pages | Deploy URL |
| Gemini API | https://generativelanguage.googleapis.com | OCR de tickets |
| OSM Nominatim | https://nominatim.openstreetmap.org | Geocoding |
| **SAP Service Layer** | **https://shimano-sap.seidor.com.ar:50000** | **API REST SAP B1** |
| SEIDOR Freshdesk | https://seidorb1arg.freshdesk.com | Tickets de soporte |
| **SharePoint team SAR** | **https://teamshimano.sharepoint.com/teams/SLA_int_00002** | **Lista "ANTICIPO Y RENDICION DE GASTO"** (Admin/Finanzas) |
| Power Automate | https://make.powerautomate.com | Flow "Cargar rendiciones aprobadas a SharePoint" (cuenta `mariano.erbino@shimano.com.ar`). **Trial Premium 90 días activo desde 2026-06-30** (HTTP connector) |
| Firebase Storage | https://console.firebase.google.com/project/app-vendedores-shimano/storage | Bucket `<project>.firebasestorage.app/rendiciones-tickets/` (requiere plan Blaze). **Inicializado 2026-06-30** |
| BigQuery | https://console.cloud.google.com/bigquery?project=app-vendedores-shimano | Dataset `shimano_app` (us-central1). **Creado 2026-06-30** — destino del pipeline `firestore-bigquery-export` (ver `PLAN_POWERBI.md`) |
| Power BI Service | https://app.powerbi.com | Workspace "Shimano Vendedores" (en armado). Viewers: Mariano (admin), Diego Valsi, Santiago Beron, Pablo + Ioannis (emails pendientes) |

---

## 33) Convenciones de código

### Estilo
- Indentación: 2 espacios.
- Strings: single quotes en JS, double en Python.
- Comentarios técnicos en castellano.
- Variables descriptivas (no `x`, `tmp`).

### Naming
- camelCase en JS.
- snake_case en Python.
- SCREAMING_SNAKE para constantes.
- Funciones helper privadas con prefijo `_`.

### `var` vs `let` para variables globales del bootstrap
Las variables que pueden ser consultadas por funciones que corren en el bootstrap inicial (antes de que se declaren con `let`) deben usar `var` para evitar TDZ. Ejemplos:
```js
var userRole = null;
var assignedVendor = null;
var vendorOverrides = {};
var approvedAltasByLoc = {};
```

### Defensive coding
Las helpers que pueden ser llamadas antes del bootstrap completo (ej. `getEffectiveVendorForClient`) chequean `typeof functionName === 'function'` antes de invocarlas para evitar ReferenceError.

### Banner de versión + chequeo HTML vs SW

Al arrancar la app, en console se imprime:
- `Shimano App v217 — <timestamp ISO>` (banner con styled console.log).
- **Chequeo de sync**: fetcheaq `sw.js`, parsea su `CACHE_VERSION` y compara con `APP_VERSION` del HTML.
  - Si coinciden: `[version] HTML v217 === SW v217 OK` en verde.
  - Si difieren: `[version] DESYNC: HTML=v217 vs SW=v216 - tocar ↻ en el mapa para refrescar` en rojo.

`APP_VERSION` se exporta en `window.APP_VERSION` para que se pueda consultar desde la consola. **Bumpear las dos constantes (HTML + SW) en cada release.**

### CSS
- Clases con prefijo por sección: `.mc-*` (Master Clientes), `.bk-*` (Backup), `.sl-*` (Service Layer), `.zonas-*` (Zonas), `.stock-*` (Stock).
- Colores: usar la paleta Shimano (`#00A9E0` celeste, `#003366` azul marino, `#E83A2E` rojo, `#F97316` naranja, `#8E44AD` violeta, `#F39C12` amarillo) o Tailwind (`#1e3a8a` blue-900, `#166534` green-800, etc.).

---

## 34) Regenerar y deployar

### Workflow actual (2026-07-30+): rama `dev` + PR squash a `main`

Desde el 2026-07-30 se trabaja en la rama `dev`; los deploys a prod pasan por PR + squash-merge a `main` (evita el bloqueo del harness Claude Code sobre push directo a default branch). Desde el **2026-08-02** además `main` tiene **branch protection activa** vía GitHub API con el status check `test` del workflow Test & Lint como required — detalle completo en §34.1. Ver también CLAUDE.md regla #20 en el root del repo.

```bash
cd "C:/Users/shimano.sandbox/Desktop/APP VENDEDORES"
git checkout dev
git pull --rebase --autostash

# 1. Editar directo en index.html / src/domains/*.js / sw.js (NO regenerar desde el _build_argentina_zonas_v2.py legacy — pisa cambios).

# 2. Bumpear AMBAS versiones (deben quedar sincronizadas):
#    - index.html: const APP_VERSION = 'vXX' → 'vYY'
#    - sw.js:      const CACHE_VERSION = 'vXX' → 'vYY'
#    Si quedan desincronizadas, el banner en console marca DESYNC.

# 3. Si tocaste src/**/*.js, regenerar el bundle:
npm run build          # produce app.bundle.js + chunks/

# 4. Actualizar README (regla dura del proyecto) y CLAUDE.md si aplica.

# 5. Commit y push a dev
git add index.html sw.js README.md app.bundle.js chunks/
git commit -m "vYY: mensaje claro del cambio"
git push origin dev

# 6. Deploy a prod = PR + squash-merge (no requiere autorización adicional del harness)
gh pr create --base main --head dev --title "vYY: <resumen>" --body "..."
gh pr merge dev --squash --delete-branch

# 7. Sincronizar local post-merge (recrear dev limpia desde main actualizado)
git checkout main
git pull origin main
git branch -D dev
git checkout -b dev
git push -u origin dev
```

### Deploy de Firebase (rules + functions)

Independiente del git push a Pages. Cada tipo requiere su comando propio:

```bash
# Firestore Rules (sección 9)
firebase deploy --only firestore:rules --project=app-vendedores-shimano

# Storage Rules (sección 9, subsección Cloud Storage Security Rules)
firebase deploy --only storage --project=app-vendedores-shimano

# Cloud Functions (sapProxy + dailyFirestoreBackup)
firebase deploy --only functions --project=app-vendedores-shimano
# O una function específica:
firebase deploy --only functions:sapProxy --project=app-vendedores-shimano
```

### Legacy: build Python del HTML (deprecated)

El build script `_build_argentina_zonas_v2.py` en `MASTERFILES/PROSPECTOS/MAPAS/` es de la era pre-Fase 0 y **ya no se usa**. La app se edita directo en `index.html` + `src/domains/*.js`. Si necesitás regenerar polígonos geo, tocá `geo.json` (v323+ es external).

### Tiempo de propagación

- Commit → GitHub Pages: 1-5 min.
- GitHub Pages → cache de usuarios: instantáneo al cerrar/abrir PWA o Ctrl+Shift+R.

### Bumpear SW

**SIEMPRE** bumpear `CACHE_VERSION` en `sw.js` Y `APP_VERSION` en `index.html` cuando hay cambios en HTML/JS/CSS. Sino el SW viejo sirve el HTML cacheado y los usuarios no ven el cambio. El banner en console marca DESYNC si se olvida una de las dos.

### Forzar refresh desde el mapa

Para usuarios que ven la app cacheada y no quieren cerrar la PWA: tocar el botón **↻ "Forzar actualización"** en el topleft del mapa (debajo del zoom). Hace `unregister()` del SW, limpia caches y recarga con cache-bust.

### 34.1) Branch protection en `main` (activada 2026-08-02, post-v379)

`main` está protegida vía GitHub Branch Protection API. Cierra el TODO explícito de v379 ("NO se activó branch protection en main — requiere confirmación explícita del user"). Sin protection, el workflow Test & Lint agregado en v379 corría pero NO bloqueaba merges rojos — un `gh pr merge --squash` podía completar aunque el CI fallara, o alguien podía hacer `git push origin main` directo saltándose el PR entero.

**Reglas activas** (verificable con `gh api repos/shimano-arg/app-vendedores/branches/main/protection`):

| Regla | Valor | Efecto |
|---|---|---|
| `required_status_checks.contexts` | `["test"]` | El job `test` del workflow `.github/workflows/test-and-lint.yml` DEBE pasar verde antes del merge |
| `required_status_checks.strict` | `true` | El branch del PR debe estar al día con `main` (rebase de `dev` sobre `main` antes de mergear si `main` avanzó) |
| `required_pull_request_reviews` | `null` | Sin reviewer humano requerido (equipo chico; el CI garantiza calidad) |
| `enforce_admins` | `false` | Escape hatch: Mariano como owner puede bypass en emergencia (ver sección abajo) |
| `allow_force_pushes` | `false` | `git push --force origin main` falla |
| `allow_deletions` | `false` | `git push origin :main` falla (no se puede borrar la rama) |
| `required_conversation_resolution` | `true` | Todas las conversations del PR deben resolverse antes del merge |

**Consecuencia práctica**: un PR de `dev` → `main` queda con el botón "Squash and merge" **deshabilitado** hasta que aparece el check verde `test`. Si el CI falla, el merge queda bloqueado hasta que se pushee un fix a `dev` y la re-corrida del workflow pase.

**Cómo bypass en emergencia** (solo Mariano, solo si el CI se rompe y necesitás hotfix urgente):

```powershell
# 1. Desactivar temporal (elimina toda la config de protection)
gh api --method DELETE repos/shimano-arg/app-vendedores/branches/main/protection

# 2. Hacer el push/merge directo que necesites

# 3. Re-activar corriendo el snippet de setup de abajo
```

**Snippet de setup / re-activación** (PowerShell — WriteAllText sin BOM es obligatorio, PS 5.1 default emite BOM que GitHub API rechaza con 400 "Problems parsing JSON"):

```powershell
$body = @{
  required_status_checks = @{ strict = $true; contexts = @("test") }
  enforce_admins = $false
  required_pull_request_reviews = $null
  restrictions = $null
  allow_force_pushes = $false
  allow_deletions = $false
  required_conversation_resolution = $true
} | ConvertTo-Json -Depth 5

$path = Join-Path $env:TEMP "bp.json"
[System.IO.File]::WriteAllText($path, $body, [System.Text.UTF8Encoding]::new($false))
gh api --method PUT repos/shimano-arg/app-vendedores/branches/main/protection --input $path
Remove-Item $path
```

**Si se agregan más jobs al workflow Test & Lint**: actualizar `contexts` para incluir los nuevos context names. Los context names son los nombres exactos de los jobs en el YAML (`jobs.<name>:`) — visibles en `gh pr checks <PR>` en la primera columna.

---

## 35) Troubleshooting

### "Cargando sesión..." infinito al abrir la app

**Causa probable**: error JS en el bootstrap (TDZ con `let`, función llamada antes de declararse).

**Fix**:
1. F12 → Console → leer el error.
2. Si dice "Cannot access 'X' before initialization" → cambiar `let X` por `var X`.
3. Sino, buscar el error y aplicar el fix correspondiente.

Histórico: este bug pasó 3 veces con `userRole`, `vendorOverrides`, `approvedAltasByLoc`. Todos fueron arreglados con `let → var`.

### Cambios no aparecen después de deploy

**Causa**: cache del SW.

**Fix**:
1. Esperar 5 min (propagación Pages).
2. PC: F12 → Application → Service Workers → Unregister + Storage → Clear site data + Ctrl+Shift+R.
3. Mobile: cerrar PWA del switcher + desinstalar + reinstalar.

### Firestore "Missing or insufficient permissions"

**Causa**: colección sin regla de seguridad o regla mal escrita.

**Fix**: Firebase Console → Firestore → Rules → agregar la regla. Estructura tipo:
```
match /coleccion/{docId} {
  allow read: if isReader();
  allow write: if isAdmin();
}
```

### DTW falla en import: "X is not valid value for property"

**Causa**: el CSV tiene un valor enum string en lugar del código numérico.

Conocidos:
- `DocObjectCode = 'oQuotations'` → debe ser `'23'`.

### Service Layer falla: "Error de red o CORS"

**Causa**: el server Apache no tiene los headers CORS.

**Fix**: escalar a Alejandro Caracchi (SEIDOR) para que habilite (ver sección 25).

### Stock no aparece

**Causa**: `app_config/stock_snapshot` está vacío.

**Fix**: admin sube un CSV nuevo desde el panel Stock.

### "Pedile al admin que te configure el 2FA"

**Causa**: el rol del usuario requiere 2FA pero no está configurado.

**Fix**: admin entra al panel Usuarios → botón 🔐 2FA del usuario → escanea QR con Authenticator → ingresa código → activado.

### El usuario olvidó su contraseña (login Email/contraseña)

**Fix**: admin entra al panel Usuarios → botón 🔐 Contraseña → opción **"Mandar mail de reset"** → Firebase manda link de reset al email del usuario.

### Magic link no llega

**Causa**: el email del usuario terminó en spam, o el dominio del email no está en la whitelist de Firebase Auth.

**Fix**: chequear spam primero. Si no llega, ir a Firebase Console → Authentication → Settings → Authorized domains.

### El gerente no ve todo el mapa

**Causa**: `getMyAllowedVendorKeys()` no contemplaba el rol `gerente` (fix en v182+).

**Fix**: actualizar a v182+ o asegurarse que la rama `if (rol === 'admin' || rol === 'gerente' || rol === 'viewer') return null` esté presente.

### El badge ADMIN se ve corrido del centro

**Causa**: alguien volvió a poner `badge.style.display = 'inline-block'`.

**Fix**: cambiar a `'flex'` para que `align-items: center` + `justify-content: center` apliquen.

### Polígonos de Tucumán/etc. pintados de un vendedor que ya no es

**Causa**: hay un override en `vendor_overrides` que afecta el dept.

**Fix**: modal Zonas → tab Historial → revisar y revertir si fue erróneo. O mejor: ajustar la lógica de `deptEffectiveVendor` para tratar mejor el caso.

---

## 36) Ciberseguridad y hardening

### Capas de seguridad

1. **Firebase Auth**: Google OAuth → tokens JWT con expiración.
2. **Password gate**: PIN de 4 dígitos después del OAuth (configurado por admin).
3. **2FA TOTP**: opcional pero recomendado para admin.
4. **Firestore Rules**: validación server-side de TODA escritura (deployadas 2026-07-27, ver sección 9).
5. **Storage Rules**: `rendiciones/{ownerUid}/*` restringido a su dueño + límite 10 MB + `image/*` (v364+, sección 9). Deployadas 2026-07-30 reemplazando las test-mode que expiraban ese día.
6. **AppCheck reCAPTCHA v3**: protege contra abuso de API. Lazy-load post-login.
7. **CSP** (Content Security Policy): limita los dominios desde donde se cargan scripts/imagenes/conexiones.
8. **SW**: intercepta callbacks OAuth para no romper Firebase Auth.
9. **Cloud Function `sapProxy`**: creds del Service Layer viven en Google Secret Manager, no en Firestore (v330+, sección 43.8).

### CSP actual

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval'
  https://www.gstatic.com https://www.google.com https://*.google.com
  https://apis.google.com https://www.googletagmanager.com
  https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com
  https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com
  https://*.recaptcha.net https://recaptcha.net;
connect-src 'self' https://*.googleapis.com https://*.firebaseio.com
  https://*.firebaseapp.com https://generativelanguage.googleapis.com
  https://www.google.com https://*.google.com https://apis.google.com
  https://*.gstatic.com https://*.recaptcha.net https://recaptcha.net
  https://nominatim.openstreetmap.org
  wss://*.firebaseio.com wss://*.googleapis.com;
... etc.
```

> Cuando esté Service Layer activo, agregar `https://shimano-sap.seidor.com.ar:50000` a `connect-src`.

### Audit log

Colección `operations_log` registra acciones críticas (no editable después de creada). Solo admin/viewer leen.

### Acciones protegidas

Los 2 admins iniciales (`bot.shimano.pesca@gmail.com` y `erbinomariano@gmail.com`) tienen `protectedAdmin: true` → no se pueden eliminar desde el panel Usuarios.

### Secrets

- **API Keys** (Gemini): en `app_config/gemini` (solo admin lee/escribe). Eventualmente migrar a Firebase Functions con env vars.
- **Service Layer password**: en `app_config/sap_integration.serviceLayer.password`. Solo admin lee/escribe vía Firestore rules. Mejor a futuro: variable de entorno de Cloud Function.

---

## 37) Contactos clave

### SEIDOR (consultora SAP)

| Persona | Rol | Contacto |
|---|---|---|
| **Eliana Morgan** | Consultora SAP — punto de entrada inicial | (delegó en Ezequiel) |
| **Ezequiel Mendoza** | Consultor proyecto Integración App | `serviciosalcliente@seidorb1arg.freshdesk.com` (Ticket #105768) |
| **Alejandro Caracchi** | Analista Infraestructura TI — CORS + Service Layer | `serviciosalcliente@seidorb1arg.freshdesk.com` (Ticket #105771) |

### Shimano Argentina

| Persona | Rol | Para qué |
|---|---|---|
| **Juan** | IT | Crear usuarios SAP, manejar infra |
| **Santiago Esteban** | VDI | Aprobar Quotations manualmente, copia a Sales Order |
| **David Daiub** | Funcional SAP | Consulta funcional (ya no es bloqueante) |
| **NUR (operaciones)** | Almacén | Cargar stock W07 cuando llega mercadería |
| **Fernando Gamboa** | Admin & Finanzas (team SAR) | Recibe rendiciones aprobadas en la lista SharePoint vía Power Automate |

---

## 38) Roadmap / pendientes

### Sprint actual

- [ ] Esperar respuesta de Ezequiel sobre UDFs + Serie 103 en PROD.
- [ ] Esperar respuesta de Alejandro sobre CORS.
- [ ] Esperar respuesta de Juan sobre usuario integración.
- [ ] Cuando estén los 3 → pasos 1-11 del archivo `LANZAMIENTO-APP-FALTANTES.txt`.

### Próximo sprint

- [ ] **Cablear `enviarPedidosASAPViaServiceLayer` a un botón**: la función ya existe en `index.html` pero hoy no se llama desde ninguna parte de la UI. Cuando los 3 bloqueantes externos estén resueltos, agregar un botón "Enviar a SAP por Service Layer" en la pestaña de Pedidos Pendientes/Confirmados.
- [ ] Documentación operativa para vendedores (manual de uso).
- [ ] Capacitación de los 6 vendedores en la app.
- [ ] Definir ritmo de revisión de Quotations con Santiago (1x día recomendado).
- [ ] Migrar API keys / passwords a variables de entorno con Cloud Functions.
- [ ] Restauración automatizada del backup (script Node.js que lee el ZIP).
- [ ] Telemetría de uso (qué pestañas se abren más, latencias).

### Hecho recientemente (✅)

**Sesión completa 2026-07-14 (v298 → v301 + BigQuery + PDFs):**

*Documentos de referencia generados:*
- [X] **`APP SHIMANO MANUAL.pdf`** (33 pág) — Manual técnico completo pensado para sucesor. Cubre negocio, arquitectura, Firebase, GitHub, SAP, BQ, Power BI, cron jobs, modelo de datos, roles, scripts, costos, contactos, runbook, roadmap y glosario. Generador en `scripts/build_manual_shimano.py`.
- [X] **`MEJORAS.pdf`** (21 pág) — Análisis crítico del estado actual con 12 puntos débiles priorizados (severidad + esfuerzo + impacto + evidencia + solución) + roadmap por horizontes (Sprint 1 dos semanas, Sprint 2 un mes, Q1 tres meses, S1 seis meses). Incluye anexo de 5 bugs reales con commit hash + deuda técnica cuantificada. Generador en `scripts/build_mejoras_shimano.py`.

*Cambios frontend (v298 → v301):*
- [X] **v298 - Gerente ve todas las visitas** (pedido de Pablo por Teams) — fix client-side de 2 líneas, Firestore Rules ya lo permitía.
- [X] **v299 - Form Visita simplificado** (pedido vendedores): buscar directo por tienda, localidad se autocompleta con badge celeste "📍 Localidad detectada".
- [X] **v300 - Buscador de tienda matchea por fantasía O titular** — label ahora `"Fantasía (Titular) — Loc, Prov"`.
- [X] **v301 - Modal pedido PENDIENTE con vista previa** — layout 2 columnas: sugeridos | pedido ya cargado. Read-only.

*Datos y pipeline (BigQuery + Firestore + Power BI):*
- [X] **Suscripción diaria de Power BI por email a Mariano** (`Desempeño diario de ventas SAR - PESCA` @ 15:00 AR, con miniatura + PDF adjunto). Refresh programado 14:30 previo.
- [X] **Publish del `.pbix` a Power BI Service** (workspace de Mariano). Dataset y reporte "TABLERO SAR" operativos.
- [X] **Pipeline `v_targets` end-to-end**: sync Firestore → BQ + vista con SlpCode traducido (mapeo hardcoded 50-55).
- [X] **`v_facturas_sap` sin `lines_json`**: fix crítico que destrabó el freeze de Power BI Desktop (VertiPaq explotaba con el JSON string gigante).
- [X] **Rollback completo del intento "gap huérfano"** en `v_backorder_lineas`: `v_sap_items_enriched` vuelve al schema pre-fix. Reintroducir cuando la máquina del user tenga más RAM o migre a Power BI Service.
- [X] **`sync_sap_to_bigquery.py` con nuevo paso 7 (targets)**: se ejecuta cada 30 min junto al resto del pipeline SAP.
- [X] **Auditoría SlpCode contra SAP prod** vía `/SalesPersons`: confirmado que 50-55 aún no existen en `SHIMANO_SAU`, pendiente que SEIDOR los cree como parte del lanzamiento.

*Bulk imports desde Excel del formulario + fixes del sync SAP:*
- [X] **Bulk import de 103 nombres de fantasía** desde Excel del formulario, match por CUIT + fix del cron `sync_sap_to_firestore.py` que las pisaba cada 30 min. Ejemplo: "GABRIEL ALEJANDRO YAMIN" ahora aparece como "ARMERIA EL COLORADO".
- [X] **Bulk fix de 22 provincias mal cargadas** (bug SAP prod: YAMIN CHUBUT→SALTA, TOMPY CHUBUT→SALTA, etc.) con validación de lista canónica de 24 provincias AR + CABA. Sync extendido para respetar `provinciaLocSource != 'sap_sync'`.

**v290 → v297 (2026-07-13):**
- [X] **Export Excel de Targets en formato largo** (SlpCode/Vendedor/Año/Mes/Meta) desde el modal Targets (v297).
- [X] **Botón "👤 Provisorios"** violeta en Master Clientes para filtrar altas rápidas pendientes de SAP (v290).
- [X] **Autosave debounced 900ms** en localidad/provincia/dirección de filas SAP (v291) + listener no re-renderea si hay saves en vuelo.
- [X] **Fix crítico sync SAP** — `sync_sap_to_firestore.py` ya NO pisa localidad/provincia con vacío si SAP no trae valor (v291).
- [X] **KPI PENDIENTES header = badge Provisorios Master Clientes** (v292) — ambos usan `getProvisoriosList()`.
- [X] **Fix tab NO CONFIRMADOS** mostraba 3 items cuando el KPI decía 16 (v293) — provisorios sin provincia + con geo+addr ahora pasan siempre el filtro pendientes.
- [X] **CUIT opcional en Alta Rápida** para habilitar match automático confiable con SAP (v294).
- [X] **Botón "🔗 Vincular con SAP"** (admin only) en Master Clientes → Provisorios: modal con auto-ranking por CUIT match + batch set del cardCodeSap + delete del BP SAP duplicado (v294).
- [X] **Badge Categoría (Cat P/A/B/C) fijo en esquina** de cards CLIENTES/PEDIDOS (v295).
- [X] **Fix ortografía "MOSTRADO" → "MOSTRADOR"** en form de visita + Excel exports (v296, reporte vendedor). Value en DB se preserva.

**v218 → v289 (2026-06 a 2026-07-12):**
- [X] **Stock auto-sync vía GitHub Actions** (`sync-stock.yml` corre cada 30 min, funcionando como sistema legacy + el upload manual del panel admin Stock).
- [X] Banner versión + chequeo HTML vs SW en console.
- [X] Botón "Forzar actualización" + "Reubicar pines" + "REFRESCAR APP" mobile.
- [X] **Sidebar Localidades** suma altas SAP + modal localidad con detalle de tiendas y direcciones (v198+).
- [X] Burbujas agregadas del mapa OFF por flag (v199+).
- [X] Master Clientes: botón Eliminar 🗑 por fila (SAP altas + POINTS legacy) — admin/gerente (v200+).
- [X] Modal Zonas: gerente puede reasignar + scope "Por provincia" + toast verde de confirmación (v201/v203).
- [X] **Mail Rendiciones cron Lun/Mie 9am AR** con Excel (Tablas nombradas TablaGastos/TablaSolicitudes) + hyperlink Firebase Storage para fotos de ticket (v202+).
- [X] **Integración SharePoint + Power Automate** end-to-end: el flow carga rendiciones aprobadas a la lista del team SAR (v203).
- [X] Gerente: `canWrite()` + apertura de CAMPAÑAS/SAP + lee todos los pedidos + edita rutas del mes (v205/v208/v214/v215).
- [X] Card precaución más visible: amber-200 + franja marrón izquierda 5px (v206).
- [X] Progreso de campañas GLOBAL sobre el scope, no aporte propio (v207).
- [X] TARGETS-ZONAS solo BPs vivos con CardCode SAP + "Exportar para Análisis" restringido a Mariano (v208).
- [X] **SEGUIMIENTO** — panel comercial completo (v209–v212).
- [X] Botón Recalcular contornos de zonas (v213).
- [X] Tildar pedido bloqueado en SAP — fix cleanup (v216).
- [X] **Rendiciones v2** — TablaGastos agrupada por dupla + hoja Detalle + fotos pre-subidas + bucket `.firebasestorage.app` (v217).
- [X] **Sync automático SAP → Firestore + stock.json cada 30 min via GitHub Actions** (v246).
- [X] **Sync BPs pesca de SAP → app** cada 30 min (v282-v288) — U_DIVISION filter fix.
- [X] **Sync SAP → BigQuery** — **9 tablas raw** (`sap_bp_raw`, `sap_items_raw`, `sap_invoices_raw`, `sap_credit_notes_raw`, `sap_quotations_raw`, `sap_orders_raw`, `sap_purchase_orders_raw`, `sap_deliveries_raw`, `sap_returns_raw`) via `sync_sap_to_bigquery.py` (v282+, extendido en v367 con NCs, v386.2 con Deliveries + Returns).
- [X] **Vistas BigQuery curadas** — `v_pedidos_header`, `v_pedidos_lines`, `v_visitas`, `v_facturas_sap`, `v_ventas_lineas`, `v_backorder_lineas` (v282-v289).
- [X] **Power BI Desktop conectado** al dataset `shimano_app` con 12+ medidas DAX + dashboard "Resumen-Desempeño" en armado (v282+).
- [X] **Firebase Storage** inicializado + **plan Blaze** activo + **BigQuery dataset** creado + **Power Automate Premium trial** (2026-06-30).

### Costos / infraestructura externa

| Servicio | Plan | Costo estimado | Estado |
|---|---|---|---|
| **Firebase** (Auth + Firestore + Storage + Extensions) | **Blaze** (pay-as-you-go) | ~5 USD/mes (free tier cubre la mayor parte) | Activo |
| **BigQuery** | Free tier | ~0 USD/mes (queries < 1 TB/mes, storage < 10 GB) | Dataset `shimano_app` creado |
| **Power Automate Premium** | Trial 90 días → licencia | ~15 USD/mes/usuario después del trial | Trial activo (Mariano) |
| **Power BI Pro** | Por usuario | ~10 USD/mes × 5 viewers = 50 USD/mes | Workspace en armado |
| **GCP** (BigQuery export storage) | Pago por uso | ~5 USD/mes | Activo |
| Gmail App Password (`bot.shimano.pesca`) | Free | 0 USD | Activo |
| GitHub (repo + Actions) | Free | 0 USD | Activo |
| **Total estimado** | | **~89 USD/mes** | |

Budget alert configurado a **25 USD/mes** en GCP (alertas a `mariano.erbino@shimano.com.ar` al 50/90/100%). Confirmado por Diego — cargo a tarjeta corporativa.

### Mejoras futuras

- [ ] Migrar de password Firestore a Cloud KMS para credenciales SAP.
- [ ] Modo offline real (cola de pedidos cuando no hay red, sync al volver).
- [ ] Notificaciones push nativas via FCM.
- [ ] Webhooks SAP → app: cuando Santiago copia Quotation a SO, la app se entera y refleja el cambio.
- [ ] Heatmap de visitas en el mapa.
- [ ] Filtro por fecha en el dashboard.
- [ ] Comparativa de targets vs facturación real con gráficos.

### Cosas que NO se van a hacer (decisión explícita)

- **Middleware intermedio**: descartado el 2026-06-19. Service Layer directo es suficiente.
- **Approval Procedure sobre OQUT**: descartado el 2026-06-19. Santiago revisa manual.
- **Migrar a React/Vue/Angular**: no aporta valor proporcional al esfuerzo. La app es manejable como vanilla.
- **Backend Node/Python propio**: Firestore Rules + Cloud Functions cuando necesitemos sólo lo justo.

---

## 39) Seguimiento (panel VDIs)

**Nuevo bloque grande introducido entre v209 y v212**. Es el panel de gestión comercial diaria, pensado originalmente para **vendedores internos** (Santiago Esteban e Ioannis Palkoudakis) y extendido a admin/gerente para que vean todo el equipo.

### Botón en el header

Botón **"Seguimiento"** teal al lado de "Exportar a Excel". Visible cuando `canViewSeguimiento()` devuelve `true`:

```js
function canViewSeguimiento(){
  if (userRole === 'admin' || userRole === 'gerente') return true;
  if (userRole === 'interno') return true;
  return false;
}
```

Vendedores externos (VDEs) y viewer NO ven el botón. El check se replica del lado JS en cada render (no es solo CSS) y los listeners de `visits` / `pedidos` re-validan el scope antes de pintar para que no se pueda forzar acceso con devtools.

### Mapping interno → externo (`myExternalPartners`)

El conjunto de VDEs que un VDI puede gestionar viene de `loadMyExternalPartners()` — listener sobre `/roles` con `where internalPartnerUid == currentUser.uid`. Es **configurable desde el panel Usuarios**, sin hardcodear nombres en el código:

```js
function getSeguimientoExternalSet(){
  if (userRole === 'admin' || userRole === 'gerente') {
    // Fallback: arma el set desde VENDOR_INCLUDES_OTHERS (constante existente).
    const all = new Set();
    Object.values(VENDOR_INCLUDES_OTHERS).forEach(arr => arr.forEach(v => all.add(v)));
    return all;
  }
  if (userRole === 'interno') {
    return new Set((myExternalPartners || []).map(p => p.vendor).filter(Boolean));
  }
  return new Set();
}

function vendorInSeguimientoScope(vendorKey){
  return !!vendorKey && getSeguimientoExternalSet().has(vendorKey);
}
```

### Modal — barra de filtros + 8 stats cards + 7 tabs

**Filtros** (arriba del modal):
- **Vendedor** (dropdown de VDEs del scope).
- **Fechas** (default últimos 90 días).
- **Cliente** (búsqueda libre).
- **Estado** (verde / amarillo / rojo).
- **Solo pendientes / oportunidades** (checkbox).
- Botón **APLICAR** centrado en su propia fila (v217, antes estaba en el flex de filtros y rompía el layout).

**Stats cards** (8 contadores: visitas, pedidos, facturación, conversión visita→pedido, clientes únicos, etc.) que recalculan según filtros.

**Tabs** (7):

| Tab | Qué muestra | Acciones por fila |
|---|---|---|
| **Resumen** | 1 card por VDE con visitas / pedidos / facturación / conversión / clientes únicos | Click abre Timeline del VDE |
| **Visitas** | Lista filtrable de visitas | Click → Timeline cliente. Botón **Borrar** (admin/gerente) → delete en `/visits` |
| **Pedidos** | Lista filtrable de pedidos | Botón **Borrar** (admin/gerente) → delete en `/pedidos` (útil para limpiar pedidos TEST) |
| **Pendientes** | Heurística auto-detección: visitado sin pedido > 7 días (amarillo) o > 14 días (rojo); pedido pending > 5 días (rojo) | Borrar pedido (si origen `pending`) o marcar resuelto en `seguimiento_status` (si origen `visit_no_order`) |
| **Sin movimiento** | Sin visita > 30 días Y sin pedido > 45 días. **Critical** si facturación > 100k ARS y > 60 días | Timeline cliente |
| **Oportunidades** | Visitas cuyos `comentarios` contienen keywords (interés en producto, posible cambio de marca, etc.) | Timeline cliente |
| **Métricas duplas** | Conversión visita→pedido por dupla VDI/VDE | — |

### Timeline cliente

Click en cualquier fila de Visitas/Pedidos/Pendientes/etc. abre un modal **Timeline del cliente** con:
- Lista cronológica ordenada de **visitas + pedidos + notas internas**.
- Botones de estado: **pendiente / revisado / resuelto** (escriben a `seguimiento_status`).
- Form para agregar **nota interna** (escribe a `seguimiento_notes`).

### Colecciones Firestore nuevas

- `seguimiento_notes` — notas internas (texto + autor + clientKey + vendorExt).
- `seguimiento_status` — estado de items pendientes/oportunidades (pendiente/revisado/resuelto).

Ver schema completo en sección 8.

### Rules nuevas requeridas

Las dos colecciones requieren rules con helper `isSeguimientoUser()` (admin/gerente/interno). Ya están aplicadas en Firebase Console (Mariano las pegó el día del lanzamiento de v209). Si se hace un reset de rules, **hay que volver a aplicarlas** o el modal abre pero no puede escribir notas/estados.

---

## 40) Power BI / BigQuery

**Estado a 2026-07-23**:
- ✅ **Fase 1.1** Firestore → BigQuery (7 collecciones + backfill)
- ✅ **Fase 1.2** SAP → BigQuery (**9 tablas raw**: BPs, Items, Invoices, Credit Notes, Quotations, Orders, POs, Deliveries, Returns)
- ✅ **Fase 2** Modelo de datos: **22 vistas SQL curadas** (9 base + 3 deuda 2026-07-20 + 2 rendiciones 2026-07-22 + 3 campañas 2026-07-30 + 1 leads 2026-08-03 + 1 remitos 2026-08-03 + 1 ofertas/TOTAL 2026-08-04 + 1 conversion leads mensual 2026-08-04 + 1 leads contactos mensual 2026-08-04)
- ✅ **Fase 3** Power BI Desktop → Service: **TABLERO SAR publicado en `Mi área de trabajo`**. Modelo con 12 vistas + `sap_items_raw` + `Vendedores` + `Origenes` + `Medidas` + `Date`. Páginas operativas: Desempeño-Pesca, Ventas, Pedidos, Visitas, **Facturación por Vendedor** (con Cobrado + Deuda), Backorder, Inventario.
- ✅ **Fase 3.5** Distribución automática: **suscripción diaria a Mariano** ("Desempeño diario de ventas SAR - PESCA") @15:00 AR + refresh programado @14:30. Ver subsección abajo.
- ✅ **Fase 3.6 (2026-07-21)** Deuda por vendedor de la app: 3 vistas + cards Cobrado/Deuda en hoja Facturación por Vendedor. Ver subsección "Vistas de deuda" abajo.
- ⏳ **Fase 4** Alertas: pendiente

### Vista TOTAL / Ofertas de Venta (2026-08-04) — NUEVO

Pedido de Mariano: card "TOTAL" en TABLERO SAR que muestre cuánto hubiese sido la facturación si Shimano tenía TODO el stock pedido. Es la suma de las Sales Quotations (Ofertas de Venta) originales del vendedor, antes de que Administración recorte por stock disponible.

**Vista nueva** en `bigquery/views.sql`:

| Vista | Granularidad | Columnas |
|---|---|---|
| `v_ofertas_lineas` | 1 fila por línea de Sales Quotation | `doc_entry, doc_num, doc_date, anio, mes, card_code, card_name, item_code, descripcion_linea, cantidad, precio_unitario, importe_linea_ars, familia, subfamilia, is_pesca, doc_currency, doc_rate, document_status, sales_person_code, SlpCode Asignado, assigned_vendor, _sync_timestamp` |

**Alineada 1:1 con `v_ventas_lineas` y `v_remitos_lineas`** — mismas columnas + mismo prorrateo del `total_discount` de cabecera (fix v388.1). Permite comparar Ofertas vs Facturado vs Remitido con el mismo criterio de descuento aplicado.

**Filtros**: `cancelled='tNO'` (excluye SQs canceladas por Admin/rechazadas). Ventana 24 meses (misma que `sap_quotations_raw`).

**⚠️ IMPORTANTE — qué mide TOTAL** (aclarado 2026-08-04): NO es exactamente "lo que se hubiera facturado con 100% de stock". Es "el pipeline SAP activo" — SQs abiertas o parcialmente cumplidas que quedaron en el sistema. Casos:
- ✅ SQ abierta con backorder parcial (100 pedidas, 60 facturadas, 40 pendientes) → cuenta las 100.
- ✅ SQ sin stock pero no cancelada → cuenta las 100.
- ❌ **SQ cancelada completa por Admin** (por falta total de stock O por otras razones: error de carga, cliente arrepentido, doble pedido) → NO cuenta. Estas quedan invisibles en el TOTAL.

Trade-off aceptado (Mariano 2026-08-04): mantener el filtro `cancelled='tNO'` porque las cancelaciones incluyen razones no-stock (errores, arrepentidos), no siempre son "oportunidad perdida por stock". Es más pragmático mostrar el pipeline activo que el universo total con ruido.

**Snapshot 2026-08-04 (post-dedupe v2)**:

| Métrica julio 2026 pesca | $ ARS |
|---|---:|
| **Ofertas (TOTAL)** | **$463.75M** (post-dedupe) |
| Facturado (real, v_ventas_lineas) | $254.79M |
| Remitido (real, v_remitos_lineas) | $259.09M |
| **Oportunidad perdida** (Ofertas − Facturado) | **~$209M** |
| **% Conversión Ofertas** (Facturado / Ofertas) | ~55% |

**Dedupe automático (v2 2026-08-04)**: los vendedores a veces recargan el mismo pedido varias veces cuando SAP no confirma stock, creando SQ duplicadas que inflan el TOTAL. Ejemplo: SANTIAGO ESTEBAN tenía 3 SQ idénticas de RICARDO BLANCO GOITIA en julio (SQs 25797/25827/25879, 67 líneas c/u, mismo importe) que inflaban su total de $31M a $68M. Fix: dedupe por `(card_code, año, mes, lines_hash)` manteniendo el `doc_entry` más reciente. Impacto global julio pesca: $557M → **$463M** (bajaron 23 SQ duplicadas). Preserva pedidos recurrentes legítimos entre meses (partición año+mes calendario).

Los $302M no convertidos son por: (a) stock insuficiente al momento de armar el SO desde la SQ, (b) SQs canceladas por Admin (excluidas del cálculo), (c) SQs aún abiertas pendientes de convertirse en SO.

**Deploy 2026-08-04**: `CREATE OR REPLACE VIEW v_ofertas_lineas` aplicado en BQ.

**Uso en Power BI Desktop — armar medida "TOTAL"**:
1. **Get Data → BigQuery → v_ofertas_lineas** → Load.
2. Nueva columna calculada `Fecha = DATE(anio, mes, 1)` para relacionar con la tabla `Date`.
3. Model view: relación `Date[Date] ↔ v_ofertas_lineas[Fecha]` (M:1) + `v_targets[slp_code] ↔ v_ofertas_lineas[SlpCode Asignado]` (M:1).
4. Nueva medida DAX:
   ```dax
   TOTAL = CALCULATE(SUM(v_ofertas_lineas[importe_linea_ars]), v_ofertas_lineas[is_pesca] = TRUE)
   ```
5. Card nueva "TOTAL" en la hoja Facturación por Vendedor (al lado de Facturado / Remitido / Cobrado).
6. Bonus — medida derivada:
   ```dax
   % Conversion Ofertas = DIVIDE([Facturación Total], [TOTAL], 0)
   ```

### Vista Conversión LEAD → CLIENTE EN SAP mensual (2026-08-04) — NUEVO

Pedido de Mariano: seguimiento mes a mes de cuántos LEADs convierte cada vendedor a CLIENTES EN SAP. Mide la velocidad con que cada vendedor procesa su backlog de leads pendientes.

**Vista nueva** en `bigquery/views.sql`:

| Vista | Granularidad | Columnas |
|---|---|---|
| `v_conversion_leads_mensual` | 1 fila por `(mes, assigned_vendor)` | `mes, assigned_vendor, stock_leads_inicio_mes, conversiones_mes, pct_conversion_mes` |

**Definición**: `pct_conversion_mes = conversiones_mes / stock_leads_inicio_mes`. Denominador = LEADs (`manualSapPending=true`, sin `cardCodeSap`) que existían en la última operación previa al arranque del mes M. NO incluye leads recibidos durante el mes → mide velocidad de procesamiento del backlog puro.

**Cómo se reconstruye la historia**: usa `client_applications_raw_raw_changelog` (Firebase Extension guarda cada cambio con `timestamp`, `data`, `old_data`). Cada vez que `cardCodeSap` pasa de vacío → con valor cuenta 1 conversión, y el timestamp del evento define el mes. Para el `stock_inicio` toma el último snapshot de cada documento ANTES del arranque del mes.

**Vendor**: se atribuye al `assigned_vendor` **actual** (del snapshot latest). Si un doc cambió de vendor a lo largo del tiempo, todas sus conversiones cuentan para el vendor actual. Simplificación aceptada (cambios de vendor son raros).

**Nota importante — julio 2026 arranca en 0 de stock**: el sistema arrancó ese mes → no hay historia previa en el changelog. Los meses siguientes (agosto en adelante) muestran datos completos.

**Snapshot 2026-08-04 (día 4 de agosto)**:

| Mes | Vendedor | Stock inicio | Conversiones mes | % Conv |
|---|---|---:|---:|---:|
| ago-26 | GONZALO DE LA ROSA | 10 | 2 | 20.0% |
| ago-26 | SANTIAGO ESTEBAN | 96 | 1 | 1.0% |
| ago-26 | MARTIN BOIERO | 68 | 0 | 0% |
| ago-26 | MAURICIO GIL | 76 | 0 | 0% |
| ago-26 | FEDERICO CASTELANELLI | 48 | 0 | 0% |
| ago-26 | IOANNIS PALKOUDAKIS | 70 | 0 | 0% |
| jul-26 | FEDERICO CASTELANELLI | 0 | 52 | — |
| jul-26 | GONZALO DE LA ROSA | 0 | 44 | — |
| jul-26 | MAURICIO GIL | 0 | 30 | — |
| jul-26 | MARTIN BOIERO | 0 | 23 | — |
| jul-26 | IOANNIS PALKOUDAKIS | 0 | 17 | — |
| jul-26 | SANTIAGO ESTEBAN | 0 | 14 | — |

**Deploy 2026-08-04**: `CREATE OR REPLACE VIEW v_conversion_leads_mensual` aplicado en BQ.

**Uso Power BI Desktop** — armar visual en TABLERO SAR:
1. **Get Data → BigQuery → v_conversion_leads_mensual** → Load.
2. Line chart en hoja Desempeño-Pesca:
   - Eje X: `mes`
   - Series: `assigned_vendor`
   - Valor 1 (barras): `conversiones_mes`
   - Valor 2 (línea): `pct_conversion_mes`
3. Card individual "Conversión del mes" con `pct_conversion_mes` filtrada por vendor y mes actual.
4. Sin medidas DAX nuevas — los campos vienen calculados de la vista.

### Vista Contactos a LEADs mes a mes (2026-08-04) — NUEVO

Pedido de Mariano: ver mes a mes cuántos LEADs fueron contactados (con o sin documentación) y cuántos de esos terminaron convirtiéndose en CLIENTES EN SAP, **sin que la data se pierda mes a mes**. Complementa `v_conversion_leads_mensual` — mientras esa vista mide la velocidad de procesamiento del backlog puro, esta mide el rendimiento efectivo de los contactos hechos.

**Vista nueva** en `bigquery/views.sql`:

| Vista | Granularidad | Columnas |
|---|---|---|
| `v_leads_contactos_mensual` | 1 fila por `(mes, assigned_vendor)` | `mes, assigned_vendor, leads_contactados_con_doc_mes, leads_contactados_sin_doc_mes, leads_contactados_total_mes, leads_convertidos_ever, pct_conversion_ever` |

**Definición** (acordada con Mariano 2026-08-04): `pct_conversion_ever = leads_convertidos_ever / leads_contactados_total_mes` donde `leads_convertidos_ever` cuenta cualquier LEAD contactado en M que **hoy** tiene `cardCodeSap`, sin importar en qué mes terminó convirtiendo. La métrica sube con el tiempo — refleja "de los que contacté en agosto, cuántos terminaron siendo clientes SAP a hoy". La alternativa "convertido mismo mes" quedó descartada por ser más volátil.

**Cómo se reconstruye la historia**: usa `client_applications_raw_raw_changelog` — cada vez que un vendedor marca un LEAD con estado `contactado_con_doc` o `contactado_sin_doc` (feature v396, botones ESTADO en el modal Alta SAP), la Firebase Extension guarda un evento con `timestamp`. La vista agrupa esos eventos por mes calendario y por `assigned_vendor` actual.

**Persistencia histórica** — nada se pierde: si un lead marcado "contactado_con_doc" en agosto luego cambia a "contactado_sin_doc" en septiembre, cuenta en agosto Y en septiembre (una vez por mes con contacto). Aunque el vendedor cambie el estado del lead o lo mande a "eliminar", los eventos anteriores permanecen en el changelog.

**Snapshot 2026-08-04 (día del deploy v396)**: 0 filas — el campo `leadEstado` recién se introdujo hoy, no hay eventos previos en el changelog. A medida que los vendedores marquen leads con los 3 botones nuevos, la vista se va poblando automáticamente.

**Deploy 2026-08-04**: `CREATE OR REPLACE VIEW v_leads_contactos_mensual` aplicado en BQ.

**Uso Power BI Desktop** — armar visual en TABLERO SAR:
1. **Get Data → BigQuery → v_leads_contactos_mensual** → Load.
2. Tabla en hoja Desempeño-Pesca:
   - Filas: `assigned_vendor`
   - Columnas: `mes`
   - Valores: `leads_contactados_total_mes` (barras) + `pct_conversion_ever` (indicador)
3. Barras apiladas para desglose con doc vs sin doc:
   - Eje X: `mes`
   - Series apiladas: `leads_contactados_con_doc_mes` (verde) + `leads_contactados_sin_doc_mes` (ámbar)
   - Slicer: `assigned_vendor`
4. Card individual "Contactos del mes" con `leads_contactados_total_mes` filtrada por vendor y mes actual + "% Conversión ever" con `pct_conversion_ever`.

**Sin medidas DAX nuevas** — todos los cálculos vienen resueltos de la vista.

### Vista REMITIDO (2026-08-03) — NUEVO

Pedido de Mariano: el % Cumplimiento del vendedor debe medirse sobre lo **REMITIDO** (pase a depósito / transferencia de propiedad al cliente), no sobre facturado ni cobrado. Investigación completa en la conversación 2026-08-03.

**Hallazgo del proceso comercial Shimano** — coexisten 2 caminos en SAP:

| Camino | Descripción | Evidencia |
|---|---|---|
| **A. SO → Invoice directo** | Facturan sin emitir Delivery Note. El SO pasa a `DocumentStatus=bost_Close` cuando la factura cubre todo. El "remitido" NO existe como documento formal en SAP | Ejemplo: factura 18364 SEBASTIAN SALES → 0 deliveries para ese cliente en julio; SO 35063 cerrado directamente |
| **C. SO → Delivery paralela + Invoice paralela** | Existen 18k+ DeliveryNotes pero NO se linkean doc-a-doc con la Invoice (`BaseType=15` en solo 5 de 4.681 facturas). Delivery y Invoice apuntan al mismo SO como bases separadas | Probe via SL: `@odata.count = 18237` DeliveryNotes totales, ratio ~3.9x sobre invoices |

**Regla híbrida** implementada: `remitido = MAX(delivery, invoice)`:
1. Si la línea del SO tiene Delivery paralela → `fecha_remito = ODLN.DocDate`, `source='DELIVERY'`.
2. Si no → fallback a `fecha_remito = OINV.DocDate`, `source='INVOICE_NO_DELIVERY'`.

**Match determinista (v386.3, 2026-08-04)** — **confirmado por Santi (SEIDOR)**: en Shimano el flujo real es **SO → Invoice → Delivery** (94% de casos, 4.478 de 4.743 deliveries en 12 meses). Las líneas del Delivery tienen `BaseType=13` (A/R Invoice) + `BaseEntry=Invoice.DocEntry`, no BaseType=17 (SO) como yo asumía inicialmente. **Ejemplo caso SEBASTIAN SALES**: la Delivery 18237 apunta directo a la Factura 18364 (DocEntry 32573) via BaseType=13 — no a un SO distinto. Fix implementado: excluye del fallback INVOICE_NO_DELIVERY las facturas que tienen alguna Delivery con `BaseType=13 AND BaseEntry=Invoice.DocEntry`. Match secundario canónico (5% restante): `BaseType=17` (flujo SO→Delivery). **Reemplaza la heurística de ±10 días de v386.1** — sin riesgo residual de match cruzado. Impacto vs heurística previa: Remitido julio 2026 pesca subió de $259.28M a **$287.63M** (+$28.35M) porque la heurística sobre-excluía casos válidos. Ahora Remitido > Facturado ($287M vs $283M) — coherente con la realidad comercial: los $4M extra son remitos de julio que se van a facturar en agosto. Columnas nuevas expuestas: `base_type, base_entry, base_line` (reemplazan al viejo `so_doc_entry`).

**Vista nueva** en `bigquery/views.sql`:

| Vista | Granularidad | Columnas |
|---|---|---|
| `v_remitos_lineas` | 1 fila por línea remitida (delivery, return con sign=-1, o invoice-fallback) | `source, remito_doc_entry, remito_doc_num, doc_date, anio, mes, card_code, card_name, item_code, descripcion_linea, cantidad, importe_linea_ars, is_pesca, familia, subfamilia, sales_person_code, SlpCode Asignado, assigned_vendor, base_type, base_entry, base_line, doc_currency, doc_rate` |

**Nombres alineados 1:1 con `v_ventas_lineas`** → Power BI puede clonar la card "Facturación por Vendedor" cambiando SOLO la fuente. `SlpCode Asignado` con la misma lógica 50-55; `assigned_vendor` con la misma fórmula (lookup a `client_applications`).

**Columnas `base_type / base_entry / base_line`** (v386.3, 2026-08-04): expuestas para trazabilidad del match determinista. En Shimano `base_type=13` (A/R Invoice) en el 94% de los Deliveries → `base_entry` apunta al `DocEntry` de la Factura. En el 5% restante `base_type=17` (SO) y `base_entry`/`base_line` apuntan al SO+línea de origen. Ver §40 subsección "Match determinista".

**Pipeline extendido** — `scripts/sync_sap_to_bigquery.py`:
- Nuevas tablas `sap_deliveries_raw` (v386, 2026-08-03) y `sap_returns_raw` (v386.2, 2026-08-04), ambas con misma estructura que `sap_invoices_raw`.
- Bloque "=== 7. DeliveryNotes" + "=== 8. Returns" reusan `sl_fetch_all` + `flatten_doc` + `load_to_bq`. Ventana 12 meses (menor que 24m de Invoices para no timeoutear el cron; suficiente para % Cumplimiento del vendedor).
- Cron cada 30 min lo mantiene fresco. Volumen actual: ~4.743 deliveries + ~124 returns en 12 meses (~15 MB adicionales en BQ, +30-45 seg por corrida).
- Timeout del workflow subido de 45 a 60 min tras primer fallo del fetch inicial (v386.2).

**Match determinista Delivery↔Invoice (v386.3, 2026-08-04, confirmado por Santi/SEIDOR)**:
En Shimano el flujo real es **SO → Invoice → Delivery** (NO el canónico SO → Delivery → Invoice). Las líneas del Delivery tienen `BaseType=13` (A/R Invoice) + `BaseEntry=Invoice.DocEntry` en el 94% de los casos (4.478 de 4.743 deliveries en 12 meses). Ejemplo caso SEBASTIAN SALES: Delivery 18237 apunta directo a la Factura 18364 (DocEntry 32573) via `BaseType=13`. El `invoices_sin_delivery` CTE excluye del fallback las facturas con match por `(base_type=13 AND base_entry=Invoice.DocEntry)` o `(base_type=17 AND base_entry/base_line coincidentes)` para el 5% restante. Sin heurísticas ni riesgo de match cruzado.

**Snapshot 2026-08-04 (post-fix determinista)**:
- `sap_deliveries_raw`: 4.743 docs (jul 2025 → hoy).
- `sap_returns_raw`: 124 docs (mismos criterios).
- Julio 2026 pesca: **$287.63M Remitido** ($258.84M DELIVERY + $28.79M INVOICE_NO_DELIVERY, 0 RETURN pesca — los Returns existentes son movimientos internos NUR CONO SUR no-pesca).
- vs. Facturado julio $283.4M → **Remitido > Facturado** ($4M extra son remitos que se van a facturar en agosto). Coherente con la realidad comercial.

**Uso en Power BI Desktop** (pasos para agregar la card "REMITIDO" al TABLERO SAR):
1. `Home → Transform data → Get Data → BigQuery → v_remitos_lineas`.
2. Model view: chequear que auto-detect no arme relaciones falsas (mismo aprendizaje que Campañas 2026-08-01).
3. Nueva card en hoja "Facturación por Vendedor":
   - Tarjeta: `SUM(importe_linea_ars)` filtrado por mes actual.
   - Slicer: `assigned_vendor`.
   - Comparativa: pegar al lado la card "Facturado" existente (v_ventas_lineas) para ver diferencia.
4. **Recalcular % Cumplimiento del vendedor** usando esta vista en vez de `v_ventas_lineas`.
5. Publish al workspace.

**Validación caso concreto (SEBASTIAN SALES 18364)** — post-fix determinista v386.3:
- Aparece con `source=DELIVERY, remito_doc_num=18237, doc_date=2026-08-03, base_type=13, base_entry=32573` (DocEntry de la Factura 18364). 1 sola entrada por $15.61M — la factura NO aparece como INVOICE_NO_DELIVERY porque el match determinista la excluye correctamente.

**Reconciliación TABLERO vs Mayor Contable / Reporte "Análisis Ventas por Artículo" (2026-08-04, v388.1 fix)** — investigación completa realizada con Mariano:

**Hallazgo**: la diferencia $283M (TABLERO original) vs $254M (Mayor Contable) NO era por Notas de Crédito ni por método de cálculo distinto. La causa REAL era que `v_ventas_lineas` y `v_remitos_lineas` **no descontaban el `total_discount` de cabecera de la factura** (descuento global típico del 17% en Shimano). Ejemplo factura 18262 (SEBASTIAN SALES): suma de `LineTotal` = $32.86M, descuento cabecera $5.59M, total contable $27.27M. El descuento va a la cuenta contable "Descuentos Concedidos" aparte, no resta del `LineTotal` por línea. **Fix v388.1**: agregado CTE `sum_lines_per_doc` + prorrateo del descuento global por línea (formula: `LineTotal * (1 - total_discount / suma_lineas)`). Aplicado a `importe_linea_ars`, `cobrado_prorrateado_ars`, `deuda_prorrateada_ars` en `v_ventas_lineas` + a `deliveries/returns/invoices_sin_delivery` en `v_remitos_lineas`. **Resultado post-fix (julio 2026 pesca)**: Facturado NETO $254.79M ✓ matchea EXACTO con Mayor Contable + Reporte Santi; Remitido NETO $259.09M (levemente mayor porque incluye remitos aún no facturados). Los 3 reportes ahora convergen a la misma realidad.

**Impacto operativo** (comunicar al equipo comercial): TODOS los importes del TABLERO SAR (Facturado, Cobrado, Deuda, % Cumplimiento) van a bajar ~10% post-refresh porque ahora reflejan la venta neta post-descuento comercial. Es la venta REAL que cobra el vendedor. Las comisiones se calculan sobre el NETO — no cambia el negocio, solo la exhibición del número. Antes se sobre-estimaba en ~10% por no restar el descuento global.

El TABLERO SAR (visión comercial) puede seguir difiriendo levemente del Mayor Contable por 2 factores residuales: (a) fecha de contabilización vs fecha de emisión (facturas del 30-31 del mes se asientan el 1-2 del siguiente); (b) ítems del grupo PESCA imputados a cuentas contables distintas a `4.1.010.10.002` (típicamente <2% del total). **No es un bug — son 3 lentes distintas sobre la misma data SAP**:

| Reporte | Base de cálculo | Uso |
|---|---|---|
| **TABLERO SAR** | `LineTotal` NETO POST-descuento global de cabecera (v388.1) POR FECHA DE EMISIÓN. NCs restadas (v367). | Comisiones vendedor, % Cumplimiento, dashboard operativo diario. Es lo que el vendedor efectivamente cobra (neto post-descuento). Matchea el Mayor Contable salvo por fecha de contabilización y cuentas de imputación distintas. |
| **Reporte SAP anual** | Precio ponderado del período extendido (moving average) × cantidad. | Análisis de rentabilidad interanual con precios homologados (evita distorsión inflacionaria). |
| **Mayor Contable FISH** | Asientos contables POR FECHA DE CONTABILIZACIÓN, con criterios de imputación por ítem. | Balance, IVA, reporte fiscal, cierres contables. |

**Causas típicas del gap**:
1. Facturas emitidas el 29-31 del mes que Contabilidad asienta recién los primeros días del mes siguiente (~$15-20M típico).
2. Ítems del grupo PESCA facturados pero configurados en SAP con cuenta contable distinta a la 4.1.010.10.002 (ej: "Venta Muestras", "Venta Bonificaciones", "Venta Servicios") — cuentan en el TABLERO como venta pesca pero no en la cuenta FISH.
3. Ajustes contables manuales de cierre que Juan/Contabilidad carga aparte, sin factura de origen.

**Decisión (2026-08-04)**: NO se modifica el TABLERO SAR para que coincida con el Mayor Contable. Cambiar la lógica del TABLERO a criterio contable rompería comisiones (el vendedor cobraría según fecha de asiento, no de venta), timing de cierre de mes (no sabríamos el número final hasta el 5-10 del mes siguiente) y trazabilidad directa contra las facturas SAP. Los 3 números son correctos para sus respectivos usos.

### Vista de conversión LEADS → Clientes SAP (2026-08-03) — NUEVO

Pedido de Mariano: card en TABLERO SAR para trackear del total de altas asignadas a cada vendedor cuántas ya están en SAP (con CardCode) y cuántas siguen como LEADS (provisorios de Alta Rápida). Base para seguimiento mes a mes de conversión.

**Vista nueva** en `bigquery/views.sql`:

| Vista | Granularidad | Columnas |
|---|---|---|
| `v_leads_vs_clientes_por_vendedor` | 1 fila por `assigned_vendor` | `assigned_vendor, clientes_sap, leads, total_universo, pct_conversion (0..1), snapshot_at` |
| `v_conversion_leads_mensual` | 1 fila por `(mes, assigned_vendor)` | `mes, assigned_vendor, stock_leads_inicio_mes, conversiones_mes, pct_conversion_mes` |

**Definición de las 2 categorías** (mutuamente excluyentes, matchean con la app):
- **`clientes_sap`**: alta approved con `cardCodeSap` NO nulo/vacío → cerrado en SAP.
- **`leads`**: alta approved con `manualSapPending=true` y sin `cardCodeSap` → provisorio de Alta Rápida pendiente de cargar a SAP (misma definición del KPI **LEADS** del sidebar de la app v386).

**Filtros del universo**:
- `status = 'approved'` — excluye pending_approval / rejected / draft.
- Vendedores con nombre tipo `ADMIN_<uid>` excluidos (docs de testing).
- Altas huérfanas sin `assignedVendor` van al bucket `(SIN ASIGNAR)` para que Admin las vea y las asigne.

**Snapshot 2026-08-03 (validación inicial)**:

| Vendedor | Clientes SAP | LEADS | Total | % Conversión |
|---|---:|---:|---:|---:|
| GONZALO DE LA ROSA | 44 | 42 | 86 | **51.2%** |
| FEDERICO CASTELANELLI | 52 | 52 | 104 | 50.0% |
| MAURICIO GIL | 30 | 77 | 107 | 28.0% |
| MARTIN BOIERO | 23 | 68 | 91 | 25.3% |
| IOANNIS PALKOUDAKIS | 17 | 70 | 87 | 19.5% |
| SANTIAGO ESTEBAN | 14 | 96 | 110 | 12.7% |
| (SIN ASIGNAR) | 1 | 69 | 70 | 1.4% |

Total: 181 clientes SAP + 474 leads = 655 altas approved. Conversión global ~27.6%.

**Deploy (2026-08-03)**: `bq query --use_legacy_sql=false` con el CREATE OR REPLACE VIEW directo. La vista se refresca en cada query — no hay materialización ni cron. Costo por query: <1 KB scanned (el JSON de `client_applications_raw_raw_latest` es <200 KB).

**Uso en Power BI Desktop (pasos para agregar a TABLERO SAR)**:
1. Abrir el `.pbix` de TABLERO SAR → **Home → Transform data → Get Data → BigQuery**.
2. Elegir project `app-vendedores-shimano` → dataset `shimano_app` → chequear `v_leads_vs_clientes_por_vendedor` → **Load**.
3. **Model view**: verificar que auto-detect NO cree relaciones falsas (mismo aprendizaje que Campañas — auto-detect matchea `assigned_vendor` STRING contra columnas TIMESTAMP). Si hay que joinear, hacerlo M:1 contra la tabla `Vendedores` existente.
4. **Nueva página** "LEADS" o agregar a "Desempeño-Pesca":
   - **Slicer** `assigned_vendor` (dropdown, single-select).
   - **3 tarjetas**: `SUM(clientes_sap)`, `SUM(leads)`, `AVG(pct_conversion)` (formato %).
   - **Tabla** con las 6 columnas del snapshot (ordenada por `pct_conversion` DESC).
   - **Gráfico de barras apiladas 100%**: eje X `assigned_vendor`, apilado `clientes_sap` (verde) + `leads` (ámbar).
5. **Publish** al workspace `Mi área de trabajo` para que se sincronice con la suscripción diaria @15:00.

**Nota sobre snapshot histórico (mes a mes)**: la vista actual es la FOTO ACTUAL. Para trackear evolución mes-a-mes se necesita agregar una tabla `leads_snapshot_raw` populada mensualmente (write append con `snapshot_date`) + una vista `v_leads_evolucion_mensual`. **Recomendación**: dejar solo la foto actual por ahora; si a 30 días Mariano necesita ver la evolución, hacemos el snapshot histórico (arrancaría a acumular desde ese momento, no retroactivo — la data actual solo captura estado presente).

### Vistas de campañas comerciales (2026-07-30) — NUEVO

Pedido de Mariano: hoja "CAMPAÑAS" en TABLERO SAR para ver evolución de campañas que Pablo carga desde la app (modal Campañas comerciales, `campaigns/{id}` en Firestore).

**Pipeline nuevo**:
- `scripts/sync_sap_to_bigquery.py` — nueva función `sync_campaigns_from_firestore()` corre en el mismo cron GH Actions cada 30 min. Snapshot WRITE_TRUNCATE a `campaigns_raw` (schema explícito). Filtra campañas sin `name` o `targetAmount<=0`.
- `campaigns_raw` — 1 fila por campaña con: `campaign_id, name, familia, subfamilia, skus_json (STRING), skus_count, target_type ('units'|'money'), target_amount, start_date, end_date, scope ('all'|'province'|'vendor'), scope_values_json (STRING), created_by_email, created_at, archived, archived_at`.

**3 vistas nuevas en `bigquery/views.sql`**:

| Vista | Granularidad | Uso PBI |
|---|---|---|
| `v_campanias_progreso` | 1 fila por campaña | Tarjetas + tabla resumen: `realizado_qty`, `realizado_ars`, `pct_cumplimiento`, `dias_totales`, `dias_transcurridos`, `dias_restantes`, `activa` (bool). Progresión total del rango [start_date, end_date] |
| `v_campanias_evolucion_diaria` | 1 fila por (campaña × día facturado) | Line chart: curva acumulada `qty_acumulado`/`ars_acumulado`/`pct_acumulado` día a día usando window functions |
| `v_campanias_ventas_detalle` | 1 fila por (campaña × línea de factura SAP) | **Matrices tipo "quién vendió qué a quién dentro de una campaña"**. Sin agregar — expone `card_name`, `item_code`, `assigned_vendor`, `provincia_cliente`, `cantidad`, `importe_linea_ars`, `familia`, `subfamilia`, `is_pesca`, `anio`, `mes`. Necesaria porque `v_campanias_progreso` YA está agregada por `campaign_id` y perdía esas dimensiones — sin esta vista, matrices multi-nivel en PBI tiran `InvalidUnconstrainedJoin` |

**Fuente de ventas**: cruza contra `v_ventas_lineas` (facturado SAP — venta real, no pedido). Filtros: `doc_date BETWEEN start_date AND end_date`, `item_code IN UNNEST(skus)`, y scope condicional (`all` sin filtro / `province` filtra `provincia_cliente` / `vendor` filtra `assigned_vendor`).

**Bootstrap inicial + deploy**: `python scripts/apply_v_campanias.py` (helper que combina: sync inicial de campaigns Firestore→BQ + CREATE OR REPLACE de las 3 vistas + verificación de schema). Después del bootstrap, el cron mantiene `campaigns_raw` actualizada automáticamente.

**Layout sugerido de la hoja "CAMPAÑAS" en Power BI**:
1. **Slicers**: `name` (dropdown), `familia`, `activa` (bool), `target_type`.
2. **Tarjetas**: cantidad de campañas activas, total realizado ARS, pct cumplimiento promedio.
3. **Tabla `v_campanias_progreso`**: columna con **barra de datos** en `pct_cumplimiento`, muestra `name / familia / target / realizado / % / dias_restantes / activa`.
4. **Line chart** `v_campanias_evolucion_diaria`: eje X `doc_date`, eje Y `pct_acumulado`, breakdown por `campaign_id` (varias líneas si hay campañas paralelas).
5. **Matrix `v_campanias_ventas_detalle`** (agregada v367 sub-b): filas `campaign_name > assigned_vendor > card_name > item_code`, valores `Sum(cantidad)` + `Sum(importe_linea_ars)`. Responde "qué vendió cada vendedor a qué cliente dentro de la campaña X". Todo desde la misma vista → sin relaciones cruzadas ni ambiguedades PBI.

### ✅ EJECUTADO — Fix hoja "Campañas" TABLERO SAR (2026-08-01 vía Claude Cowork MCP)

**Estado**: 2 medidas creadas + 1 relación crítica corregida en el modelo Power BI Desktop + capa de reporte aplicada y publicada al workspace por Mariano el 2026-08-02. Fix 100% completo.

**Problema reportado**: al crear la campaña "POWER PRO" en la app el 2026-07-31 y abrir la hoja Campañas en Power BI al día siguiente:
- Card superior "Campañas" mostraba el `campaign_id` crudo (`6w4JqjWXQ2SBOCyob...`) en vez del nombre "POWER PRO".
- Card "Remitido" y "% Cumplimiento" en `--` y `0,00`.
- Tabla del medio con header `campaign_name` pero vacía.
- Filtros de página `is_pesca = True` y `provincia_cliente no está vacío` ocultaban data (los campos viven en `v_campanias_ventas_detalle` que está vacía cuando la campaña no tiene facturas todavía).

**2 medidas nuevas** en el modelo:

| Medida | Definición | Formato |
|---|---|---|
| `Facturación Campaña` | `SUM(v_campanias_progreso[realizado_ars])` | Moneda ARS, 0 decimales |
| `% Cumplimiento Campaña` | `DIVIDE(SUM(v_campanias_progreso[realizado_ars]), SUM(v_campanias_progreso[target_amount]), 0)` | Porcentaje, 2 decimales |

**Fix arquitectural crítico** — relación mal armada por auto-detect de Power BI:
- **Antes**: `v_campanias_ventas_detalle[campaign_id]` → `v_campanias_progreso[created_at]` (¡unía **STRING campaign_id** contra **TIMESTAMP created_at**!). Auto-detect matcheó por columnas con nombre similar pero semántica opuesta. Silencioso — no rompía queries, solo devolvía resultados vacíos o cross-joins inesperados.
- **Después**: `v_campanias_ventas_detalle[campaign_id]` ↔ `v_campanias_progreso[campaign_id]` (M:1, single-direction). Ahora los slicers de campaña filtran ambas vistas coherentemente.

**Validación con `POWER PRO` (2026-08-01)**:
- `Facturación Campaña` = `$0` ✓ (correcto — arrancó 2026-07-31, sin facturas SAP en la ventana todavía).
- `% Cumplimiento Campaña` = `0,00%` ✓ (correcto por lo mismo).
- Vistas `v_campanias_evolucion_diaria` y `v_campanias_ventas_detalle` = 0 filas ✓ (esperado — se poblarán cuando el cron detecte facturas SAP de los 25 SKUs de POWER PRO dentro del rango `[2026-07-31, 2026-09-29]`).

**Capa de reporte aplicada por Mariano el 2026-08-02** (Power BI Desktop → Publish al workspace):
1. ✅ Cards de arriba reemplazadas por: `name` / `Facturación Campaña` / `% Cumplimiento Campaña`.
2. ✅ Filtros `is_pesca = True` y `provincia_cliente no está vacío` sacados del panel "Filtros de esta página".
3. ✅ Tabla del medio apuntando a `v_campanias_progreso` con las 6 columnas.
4. ✅ Slicer "Campaña" cambiado a `v_campanias_progreso[name]`.
5. ✅ `.pbix` publicado — POWER PRO aparece con `$0 / 0,00%` (correcto — campaña arrancó 2026-07-31 sin facturas todavía).

**Aprendizaje capturado** — al importar tablas nuevas a Power BI, **desactivar auto-detect de relaciones** (`File → Options → Data Load → Autodetect new relationships after data is loaded`). Power BI matchea por nombre de columna similar sin chequear el tipo semántico (`campaign_id STRING` vs `created_at TIMESTAMP` es un mismatch obvio para un humano pero auto-detect lo ignora). Alternativa: dejarlo activado pero **auditar todas las relaciones en Model view** después de cada import y borrar/corregir las que no tengan sentido semántico. Complementa el aprendizaje del fix Backorder (evitar fact-fact via TREATAS).

### Fix Notas de crédito SAP (2026-07-30) — NUEVO

Bug reportado por Mariano: en el TABLERO SAR, Santiago Esteban aparecía con `$29.09M` remitido en jul 2026 cuando el neto real era `$18.9M`. Ejemplo concreto: cliente **Ricardo Fabian Blanco Goitia** (`C20351155354`) tenía factura RF 18226 (+$10.1M) y **nota de crédito RC 1810 (-$10.1M)** que se cancelaban, dejando solo la RF 18291 ($9.3M) como venta real. Pero en BigQuery solo aparecía la parte positiva → sobreestimación sistemática de facturación cada vez que hay devoluciones/anulaciones.

**Causa raíz**: el pipeline `sync_sap_to_bigquery.py` solo sincronizaba `/b1s/v1/Invoices` (facturas). Las notas de crédito viven en un endpoint SAP separado `/b1s/v1/CreditNotes` y **nunca llegaban a BigQuery** → no restaban de ningún `SUM(doc_total)` ni `SUM(importe_linea_ars)`.

**Fix aplicado**:

1. **Nueva tabla `sap_credit_notes_raw`** — misma estructura que `sap_invoices_raw` (mismo `flatten_doc` con `doc_type='CREDIT_NOTE'`). Populada por `sync_sap_to_bigquery.py` extendido (fetch de `/b1s/v1/CreditNotes` con mismo `doc_select` + `history_months`). Snapshot 413 CNs iniciales al bootstrap 2026-07-30; cron GH Actions mantiene sync cada 30 min.
2. **`v_facturas_sap` extendida** con CTE `invoices_and_cns`:
   ```sql
   invoices_and_cns AS (
     SELECT *, 1 AS sign, 'INVOICE' AS doc_kind
     FROM sap_invoices_raw
     UNION ALL
     SELECT *, -1 AS sign, 'CREDIT_NOTE' AS doc_kind
     FROM sap_credit_notes_raw
   )
   ```
   Y multiplica por `sign` en las columnas monetarias: `doc_total * sign`, `paid_to_date * sign`, `total_discount * sign`, `saldo_ars`. Nueva columna `doc_kind` (`INVOICE`|`CREDIT_NOTE`) para desglose.
3. **`v_ventas_lineas` extendida** igual: `cantidad * sign`, `importe_linea_ars * sign`, prorrateos `cobrado_prorrateado_ars` y `deuda_prorrateada_ars` también multiplicados.

**Efecto cascada — todas las vistas derivadas heredan el fix sin tocarlas**:
- `v_deuda_por_vendedor`, `v_deuda_facturas_detalle`, `v_facturado_cobrado_deuda_por_vendedor` — heredan de `v_facturas_sap`.
- `v_campanias_progreso`, `v_campanias_evolucion_diaria`, `v_campanias_ventas_detalle` — heredan de `v_ventas_lineas`.
- Power BI actualiza el neto correcto al hacer `Refresh` — **cero cambios en medidas DAX**.

**Verificación post-deploy (jul 2026, doc_total con IVA)**:

| Vendedor | Facturado bruto | Notas de crédito | NETO |
|---|---|---|---|
| Santiago Esteban | $34.5M | -$12.3M | $22.2M |
| Gonzalo de la Rosa | $130.9M | -$20.7M | $110.2M |
| Federico | $110.9M | $0 | $110.9M |
| Mauricio | $29.7M | $0 | $29.7M |
| Martin | $26.3M | -$2K | $26.3M |
| Ioannis | $2.9M | $0 | $2.9M |

**Bootstrap + deploy inicial**: `python scripts/apply_credit_notes_fix.py` (helper que fetchea CNs, aplica las 2 vistas, y muestra verify query del ejemplo Ricardo Blanco). Después el cron GH Actions mantiene sync sin intervención.

**Nuevo insight aprovechable**: agregar a Power BI una card/tabla filtrada por `doc_kind = 'CREDIT_NOTE'` muestra el volumen de devoluciones por vendedor/mes. Herramienta de gestión — ej: Gonzalo tuvo $20.7M en NCs jul 2026, vale la pena investigar la causa.

**Regla derivada del fix**: cuando un pipeline sincroniza N entities de un ERP, chequear siempre si existe una entity "inversa" (Credit Notes para Invoices, Return Orders para Sales Orders, etc.) y decidir explícitamente si va o no. Un endpoint faltante genera sobreestimación silenciosa que solo se detecta cross-checkeando con SAP mano a mano.

### ✅ RESUELTO — Fix hoja "Backorder" TABLERO SAR (stock disponible vs tránsito) — 2026-07-31 vía Claude Cowork MCP

**Estado**: medidas creadas/corregidas y validadas por DAX contra datos de BigQuery. Capa de reporte aplicada y publicada al workspace por Mariano el 2026-08-02. Fix 100% completo — Diego/Pablo ya ven el tablero actualizado.

**Problema**: la hoja Backorder tomaba como stock disponible la suma de todos los depósitos vendibles (whs 11 + whs 12), mezclando lo vendible hoy (whs 11) con lo que está en tránsito (whs 12). Resultado: SKUs figuraban con stock cuando no había nada para entregar. Ejemplo `SN2000FG`: card "Stock Total Unidades" mostraba `180` cuando el disponible venta real era `0` (todo en tránsito).

**4 medidas nuevas** creadas en el modelo Power BI Desktop (ejecución vía MCP el 2026-07-31):

| Medida | Definición | Propósito |
|---|---|---|
| `Stock Disponible Venta` | `SUM(v_inventario_por_warehouse[stock_qty])` con `warehouse_code = "11"` + `TREATAS(VALUES(v_backorder_lineas[sku]) → v_inventario_por_warehouse[item_code])` | Vendible hoy (WHS 11 real) |
| `Unidades en Tránsito` | Igual pero con `warehouse_code = "12"` | Va a entrar (WHS 12) |
| `Unidades Asignadas` | `SUM(v_backorder_lineas[pendiente])` | Comprometido a clientes vía SQ abiertas |
| `Unidades Liberadas` | `SUMX` por SKU de `MAX(Tránsito − Asignadas, 0)` (aditiva) | Lo que queda libre cuando llegue el embarque |

**2 medidas corregidas**:
- `Próx Embarque` → si no hay fecha de PO pero hay tránsito (whs 12 > 0), devuelve `"Hay embarque"` en vez de `"—"`.
- `Estado Agregado` → prioriza el tránsito real: `"ASIGNADAS (asignadas/tránsito)"` / `"✓ EN TRÁNSITO (n libres)"` antes de las ramas por columna `estado` (que mantienen `✓ CON EMBARQUE / SIN REPOSICIÓN / PARCIAL` como fallback).

**Decisión de arquitectura — corrección al prompt original**: **NO se creó la relación** `v_inventario_por_warehouse → v_backorder_lineas` (sería hecho-con-hecho, rompe el esquema estrella). Ambas tablas ya se relacionan con `dim_Producto[SKU]`; el cruce por SKU en la tabla de backorder se resuelve con `TREATAS` (mismo patrón que la medida existente `Stock Actual SKU`). `v_inventario_por_warehouse` ya estaba en el modelo → no hubo que importarla.

**Validación con `SN2000FG` (2026-07-31, medidas DAX contra datos BQ)**:
| Métrica | Valor obtenido | Esperado |
|---|---|---|
| Stock Disponible Venta (whs 11) | 0 | 0 ✓ |
| Unidades en Tránsito (whs 12) | 180 | 180 ✓ |
| Unidades Asignadas | 20 | 20 ✓ |
| Unidades Liberadas | 160 | 160 ✓ |
| Próx Embarque | "Hay embarque" | ✓ |
| Estado Agregado | "ASIGNADAS (20/180)" | ✓ |

**Vistas BQ consumidas por la hoja Backorder post-fix**:
- `v_inventario_por_warehouse` — 1 fila por (item_code, warehouse_code) con `stock_qty`, `is_non_sales`. Ya estaba en el modelo.
- `v_backorder_lineas` — 1 fila por (Sales Quotation abierta, SKU, cliente) con `pendiente`, `prox_embarque_date`, `estado`, `qty_incoming`.
- `dim_Producto[SKU]` — dimensión existente, hub del star schema para relacionar ambas vistas.

**Capa de reporte aplicada por Mariano el 2026-08-02** (Power BI Desktop → Publish al workspace `bot.shimano.pesca`):
1. ✅ Card "Stock Total Unidades" repuntada a `Stock Disponible Venta`.
2. ✅ Columna "Stock Actual SKU" de la tabla → `Stock Disponible Venta`.
3. ✅ Cards nuevos agregados: `Unidades en Tránsito`, `Unidades Asignadas`, `Unidades Liberadas`.
4. ✅ Columna `Unidades Liberadas` agregada a la tabla del backorder.
5. ✅ `.pbix` guardado y publicado al workspace — Diego/Pablo ya ven el tablero actualizado.

**Consistencia entre plataformas** — con este fix + v369/v370 de la app, ambas UIs cuentan la misma historia sobre el stock:
- **App vendedor** → semáforo del picker en ámbar cuando hay tránsito sin disponible, split del pedido marca todo SIN STOCK con badge `🚚 EN TRANSITO`.
- **Tablero gerente** → cards separadas para disponible/tránsito/asignadas/liberadas + estado agregado que refleja la realidad de reposición.

**Aprendizaje capturado (para futuros prompts a Cowork MCP)**: al agregar métricas que cruzan 2 vistas fact (backorder × inventario), **evitar crear relación directa entre ellas** — usa el hub dim compartido + `TREATAS` para trasladar el contexto. Es el patrón limpio de star schema y respeta lo que ya existía en el modelo.

### Sincronización Dashboard app ↔ TABLERO SAR (v367+ sub-c)

Pedido de Mariano: el modal Dashboard de la app y el TABLERO SAR de Power BI deben mostrar los mismos números para el mismo vendedor. Hasta v367 sub-b, el Dashboard app solo veía pedidos que los vendedores cargaban internamente (pocos, por la transición). Ahora también ve la facturación real SAP neta de credit notes.

**Arquitectura elegida (Opción A del diseño)**: snapshot BQ → Firestore cada 30 min, la app lee de Firestore como cualquier otra colección.

**Por qué NO Cloud Function con BQ on-demand**: costo BQ por dashboard abierto (~$0.005 × N vendedores × N loads/día) + latencia visible (500ms-2s por query) + más superficie de seguridad. El snapshot cachado es <10 KB por vendedor+mes → Firestore reads baratos, latencia local, y consistencia 100% con Power BI porque ambos derivan de `v_facturas_sap`.

**Flujo end-to-end**:
1. Cron GH Actions cada 30 min → `sync_sap_to_bigquery.py` corre. Al final llama `sync_dashboard_snapshot_to_firestore(bq_client, db)`.
2. Query BQ agregada por `(assigned_vendor, año, mes)` cruzando `v_facturas_sap` (para facturado neto + count invoices/NCs) + `v_ventas_lineas` (para unidades).
3. WRITE por doc a Firestore `sap_snapshot/{VENDOR_NORM}_{YYYY}_{MM}`. Convención doc ID idéntica a `targets_raw` para permitir joins cliente-side.
4. La app (dashboard.js) tiene `listenSapSnapshot()` que dispara al abrir sesión → cache local. `renderDashboard()` lee del cache y muestra 2 cards azules.

**Schema del doc Firestore `sap_snapshot/{docId}`**:

```js
{
  vendorKey: 'GONZALO DE LA ROSA',     // string legible, matching VENDORS[].key
  anio: 2026,                          // int
  mes: 7,                              // int 1-12 (no 0-11 como JS Date!)
  facturadoArsNeto: 110249023.69,      // SUM(doc_total) con NCs restadas
  facturadoArsBruto: 130924817.29,     // SUM solo invoices
  ncsArs: -20675793.60,                // SUM solo credit notes (negativo)
  facturasCount: 13,                   // COUNTIF doc_kind='INVOICE'
  ncsCount: 1,                         // COUNTIF doc_kind='CREDIT_NOTE'
  unidadesNeto: 1785,                  // SUM(cantidad) neto
  importeLineasArsNeto: ...,           // SUM(importe_linea_ars) sin IVA (para cross-check)
  updatedAt: <serverTimestamp>
}
```

**Bootstrap inicial + deploy**: `python scripts/apply_dashboard_snapshot.py` (fetch primero + verify Gonzalo julio 2026). Después el cron mantiene la data. Rules `sap_snapshot`: read para todos autenticados, write bloqueado (solo bypass del service account server-side).

**Verificación post-deploy 2026-07-30** (matchea 1:1 con Tablero SAR):
| Vendedor | Facturado neto jul 2026 | Unidades | # Facturas | # NCs |
|---|---|---|---|---|
| Gonzalo de la Rosa | $110.2M | 1.785 | 13 | 1 |
| Federico | $110.9M | ~1.500 | 12 | 0 |
| Mauricio | $29.7M | ~600 | 9 | 0 |
| Santiago Esteban | $22.2M | ~1.000 | 4 | 1 |
| Martin Boiero | $26.3M | ~800 | 12 | 1 |
| Ioannis | $2.9M | ~150 | 1 | 0 |

**Beneficio operativo**: cada vendedor abre su dashboard en la app y ve **su cumplimiento real vs target** en el mes. Antes tenían que abrir Power BI (que la mayoría no tiene instalado). Ahora es la misma info dentro de la PWA que ya usan diariamente.

**Regla derivada**: cuando 2 UIs distintas necesitan mostrar la misma métrica, la respuesta correcta rara vez es "duplicar la lógica en ambas capas". La solución limpia es **cachar el resultado agregado en la capa más rápida** (Firestore) y hacer que ambos consumidores (Power BI y web app) lo lean de ahí — así la vista siempre coincide sin depender de sincronizar código en 2 lados.

### Helper `extract_view_sql()` para scripts apply_* (v367+)

Regla derivada del deploy 2026-07-30: cuando un script Python aplica un CREATE OR REPLACE VIEW desde `bigquery/views.sql`, **no usar la regex simple `[^;]+;`** — se corta en el primer `;` que aparezca dentro de un comentario SQL (`-- por assigned_vendor de la app;`). Usar el helper `extract_view_sql(views_sql, 'view_name')` de `scripts/apply_credit_notes_fix.py` que busca desde el CREATE hasta el próximo CREATE (o EOF) y toma hasta el último `;` del chunk. Idea para futuro refactor: mover el helper a un módulo común `scripts/_view_extract.py` cuando aparezca el 3er caller.

### Vistas de deuda por vendedor (2026-07-20/21) — NUEVO

Pedido de Pablo por Teams: *"quiero ver cuánto lleva facturado cada vendedor, por el tema del target también, y si tiene pedidos pendientes de pagar por ejemplo"*.

**3 vistas nuevas en `bigquery/views.sql`**:

| Vista | Granularidad | Uso PBI |
|---|---|---|
| `v_deuda_por_vendedor` | 1 fila por `assigned_vendor` | Card/tabla resumen: total facturas pendientes, deuda total, vencida, al día, próxima fecha vencimiento |
| `v_deuda_facturas_detalle` | 1 fila por factura abierta | Drill-down: cliente, doc_num, días vencido, saldo, estado (VENCIDA/AL DIA) |
| `v_facturado_cobrado_deuda_por_vendedor` | 1 fila por (vendedor, año, mes) | Serie temporal: facturado + cobrado + deuda por mes. Verifica: facturado = cobrado + deuda ± redondeo |

**Agrupan por `assignedVendor` de la app** (no `SalesPersonCode` de SAP) porque SAP prod aún tiene facturas históricas con SlpCodes 1-19 / 23-34 (era Baraldo). Los códigos 50-55 se están adoptando pero parcialmente. Filtro implícito: solo los 6 vendedores pesca (`GONZALO DE LA ROSA`, `MAURICIO GIL`, `IOANNIS PALKOUDAKIS`, `SANTIAGO ESTEBAN`, `FEDERICO CASTELANELLI`, `MARTIN BOIERO`).

**Deuda actual Julio 2026** (verificado 2026-07-21):
- Gonzalo: $33.6M (1 factura — REBORN SRL / Xplora La Triestina)
- Federico: $6.4M (2 facturas)
- Martin: $2.4M (1 factura)
- **Total: $42.4M en 4 facturas abiertas** (todas AL DIA, ninguna vencida al 2026-07-21)

**Facturado Julio 2026** por vendedor (facturado = cobrado + deuda):
- Gonzalo: $80.4M | cobrado $46.7M | deuda $33.6M
- Federico: $32.0M | cobrado $25.6M | deuda $6.4M
- Santiago: $23.2M | cobrado 100% | deuda $0
- Martin: $11.9M | cobrado $9.5M | deuda $2.4M
- Mauricio: $5.9M | cobrado 100% | deuda $0
- Ioannis: $2.9M | cobrado 100% | deuda $0

### Fix `paid_to_date` en `sap_invoices_raw` (2026-07-21)

**Bug detectado**: el sync grande `sync_sap_to_bigquery.py` usa `autodetect=True` sin schema explícito. Como `paid_to_date` viene null para la mayoría de facturas cerradas antiguas, autodetect dropea la columna. Resultado: las 3 vistas de deuda tiraban `Name paid_to_date not found inside inv` en BigQuery.

**Fix aplicado en 2 partes**:

1. **`sync_sap_to_bigquery.py`** — agrega `PaidToDate` al `$select` de Invoices (líneas 690-694). Cotizaciones/Ordenes/PO no lo llevan (no aplica).
2. **`scripts/patch_paid_to_date.py`** — one-off que agrega la columna manualmente via `ALTER TABLE ADD COLUMN paid_to_date FLOAT64` + staging table con schema explícito + `UPDATE ... FROM staging` (evita tocar `lines_json`). Idempotente, se puede correr las veces que sea.

**Cuando volver a correr `patch_paid_to_date.py`**: si `sap_invoices_raw` pierde la columna `paid_to_date` (típicamente si alguien corre un sync ligero con schema viejo). Comando:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
python scripts/patch_paid_to_date.py
```

### Cards Cobrado + Deuda en hoja "Facturación por Vendedor" (2026-07-21)

Nuevas medidas DAX pedidas por Pablo:

```dax
Cobrado ARS = 
CALCULATE(
    SUM('v_ventas_lineas'[cobrado_prorrateado_ars]),
    'v_ventas_lineas'[is_pesca] = TRUE
)

Deuda ARS = 
CALCULATE(
    SUM('v_ventas_lineas'[deuda_prorrateada_ars]),
    'v_ventas_lineas'[is_pesca] = TRUE
)
```

Usan **prorrateo por línea** (v_ventas_lineas tiene ahora `cobrado_prorrateado_ars` + `deuda_prorrateada_ars`) para que **[Cobrado ARS] + [Deuda ARS] = [Facturación Total]** exactamente. Julio 2026: $100.2M cobrado + $40.6M deuda = $140.8M facturado ✓.

### Fix estructural del slicer de vendedor: `assigned_vendor` (2026-07-22)

**Problema raíz**: SAP tiene decenas de facturas cargadas con **SlpCodes históricos** (49 = Mariano admin, 34, 23, 11) para clientes que en la app están asignados a otros vendedores. El slicer del TABLERO SAR (que usaba `sales_person_code_invoice` como llave) mostraba tiendas bajo el vendedor equivocado.

**Ejemplo confirmado**: FATECHI (Presi Store, Río Tercero, Córdoba). App: `assignedVendor="MARTIN BOIERO"`. SAP factura #18216 Julio 2026: `SlpCode=54` (Federico). El TABLERO SAR la mostraba bajo Federico.

**Fix**: agregar campo `assigned_vendor` (STRING, tomado del app vía LEFT JOIN a `client_applications`) en **`v_facturas_sap`** y **`v_ventas_lineas`**. En Power BI se relacionó `Vendedores[VendorKey]` (columna calculada `UPPER([Nombre])`) → `assigned_vendor` en lugar de la relación por SlpCode.

**Impacto Julio 2026**: 29 facturas mapeadas al vendedor real de la app, 141 sin mapear (BPs históricos/BIKE sin registro app). Números por vendedor cerraron con la realidad operativa.

**Deuda técnica pendiente en SAP**: setear `SalesPersonCode=55` (Martin) en la ficha del BP de FATECHI (y otros clientes similares) para que futuras facturas vengan bien por default.

### Rendiciones (2026-07-22)

**Foto ticket migrada a Firebase Storage** (v308): antes se guardaba base64 en el doc Firestore (50-500KB por doc → rompía Power BI Import mode a escala). Ahora sube a bucket `rendiciones/{ownerUid}/{ts}_ticket.{ext}` y el doc queda con solo `fotoTicketUrl` (~1KB). Retro-migradas 45 fotos históricas con `scripts/migrate_rendiciones_foto_to_storage.py`.

**Vistas nuevas**:

| Vista | Contenido |
|---|---|
| `v_rendiciones` | 1 fila por gasto (`tipo='gasto'`). Campos aplanados: `concepto` (COMBUSTIBLE/COMIDA/HOSPEDAJE/PEAJE/TRASLADO/OTROS), `tipo_gasto` (FACTURA A / CON COMPROBANTE / SIN COMPROBANTE), `modo_pago` (RECARGABLE/CORPORATIVA/EFECTIVO), `division_gasto` (LOCAL/REGIONAL), `importe_ars/usd`, `moneda`, `vendor`, `status`, `foto_ticket_url`. Flags `tiene_comprobante_fiscal`, `pendiente_aprobacion`, `rechazada`. Fecha parseada con timezone AR. |
| `v_rendiciones_duplicados` | Alerta: agrupa por `(vendor, fecha, importe)` con `count > 1`. Detecta duplicados sospechosos. |

**Números actuales 2026-07-23**: $1.86M en 46 tickets · aprobado $1.55M · pendiente $307k · 45/45 fotos en Storage · 3 duplicados sospechosos (Martin 3 peajes $1500 el 30/6, Gonzalo y Federico 2 traslados $21k c/u el 26/6).

**Auto-aprobación directores** (v309): lista blanca `SELF_APPROVE_RENDICIONES_EMAILS` con `diego.valsi@shimano.uy`. Diego rinde sin approver externo; doc queda `status='approved'` desde el submit + `approvalNote='Auto-aprobada (director del area)'`.

### Targets descompuestos por familia (2026-07-21)

Modal Targets ahora carga 3 sub-targets por mes: **REEL / CAÑAS / LÍNEAS**. Total del mes = suma automática. Autosave con debounce 900ms + flush sync al cerrar el modal.

Firestore doc `targets/{seller}_{y}_{MM}` agrega `targetByFamily: {REEL, CANAS, LINEAS}`. `targetArs` se mantiene como total (retro-compat).

BQ: `v_targets` amplía con `target_reel_ars`, `target_canas_ars`, `target_lineas_ars`. Docs pre-v311 aparecen con NULL en esas 3 (retro-compat 100%). Uso PBI: cumplimiento por familia (facturación pesca por familia / target por familia).

`sync_sap_to_bigquery.py` usa **schema explícito** para targets (nueva función `_load_to_bq_with_schema`) para evitar el bug conocido de autodetect que dropea columnas todas-null.

### Contactado: distinción visita vs contacto no presencial

`v_visitas` expone 3 columnas nuevas para separar visitas físicas de contactos remotos:
- `interaction_type` (STRING): `'visita'` o `'contacto'`. Docs pre-v305 quedan como `'visita'` por COALESCE.
- `es_contacto` (BOOL): shortcut con `COALESCE(..., FALSE)` para filtros DAX simples.
- `forma_contacto` (STRING, v314+): `LLAMADA TELEFONICA` / `MENSAJE DE WHATSAPP` / `MENSAJE SMS`. NULL para visitas físicas.

Uso PBI: cards separados "Visitas físicas" vs "Contactos", donut por canal de contacto.

### Issue conocido: SlpCode 49 (Mariano admin) mal asignado a facturas de Gonzalo

**Detectado 2026-07-21**: 7 facturas de Julio 2026 quedaron cargadas con `SalesPersonCode=49` (Mariano admin) en vez de `SalesPersonCode=50` (Gonzalo de la Rosa). Total: $80.4M facturado + $33.6M de deuda.

**Consecuencia**: en el visual "Facturación por Origen por Tipo de Vendedor" del Dashboard, VDE + VDI ≠ VDT porque esos $80.4M no clasifican como VDE ni VDI.

**Facturas afectadas** (todas → asignar a SlpCode 50):

| # Factura | DocEntry | Cliente | Total ARS |
|---|---|---|---:|
| 18165 | 32150 | Nicolás Rinaldi (Mercadito Señuelero) | $2.610.000 |
| 18180 | 32187 | María Prat (Pescamagic Bait Shop) | $2.390.000 |
| 18224 | 32296 | Mundo Esturión | $20.676.000 |
| 18233 | 32309 | Mundo Esturión | $19.501.000 |
| 18242 | 32323 | Jonatan Angelino | $1.275.000 |
| 18244 | 32333 | Jonatan Angelino | $284.000 |
| 18262 | 32368 | REBORN SRL (Xplora La Triestina) | $33.624.000 |

**Fix intentado via Service Layer PATCH**: falló con `-5002 "Value in Discount field is greater than permitted"` (usuario `APP_VENDEDORES` tiene límite de descuento bajo y SAP re-valida toda la factura al hacer PATCH). Se resolvió manualmente desde SAP B1 desktop con user admin.

**Fix definitivo pendiente**: setear `SalesPersonCode=50` en la ficha del BP en SAP para los 5 clientes de Gonzalo (Mundo Esturión, REBORN, Rinaldi, Prat, Angelino), así el default de futuras facturas ya viene bien.

### v_targets — pipeline de metas (2026-07-14)

Sync Firestore.`targets` → BigQuery.`targets_raw` → view `v_targets`. Detalle en sección **22 (Targets mensuales)**.

**Schema `v_targets`** consumido por PBI (una fila por vendedor+año+mes con target > 0):

```
slp_code         INT64      Código SAP (mapeo hardcoded en el CASE de la vista)
vendedor         STRING     Nombre completo en formato SAP
anio             INT64
mes              INT64      1-12 (convertido desde 0-11 de Firestore)
target_ars       FLOAT64
_sync_timestamp  TIMESTAMP
```

**Mapeo canónico vendorKey → SlpCode** (única fuente de verdad, en el CASE de la vista):

| vendorKey app | SlpCode | Zona |
|---|---:|---|
| GONZALO DE LA ROSA | 50 | Z1 |
| MAURICIO GIL | 51 | Z5 |
| IOANNIS PALKOUDAKIS | 52 | Z6 |
| SANTIAGO ESTEBAN | 53 | Z7 |
| FEDERICO CASTELANELLI | 54 | Z2 |
| MARTIN BOIERO | 55 | Z4 |

**Discrepancias auditadas y documentadas en la vista**:
- **Firestore `sap_vendors` está corrido en -1** (49-54). Ignorado; el CASE hardcoded es la única fuente.
- **SAP prod `SHIMANO_SAU` al 2026-07-14 NO tiene creados los SlpCodes 50-55.** Solo hay 1-19, 33 (Mariano) y 56 (Santiago Beron). SEIDOR debe crearlos como parte del lanzamiento. Verificar con `python scripts/query_sap_sales_persons.py` cuando confirmen.
- **SlpCode 49 = Mariano Erbino (admin), NUNCA vendedor comercial**. Excluido explícitamente.

**Verificaciones de aceptación** (pasadas al deploy):
- `SELECT * WHERE anio=2026 AND mes=7`: Julio Gonzalo → `slp_code=50, target_ars=57.000.000` ✅
- Ningún `slp_code=49` ni NULL ✅
- Sin duplicados (`COUNT = COUNT DISTINCT` por seller+año+mes) ✅

**Sync**: `sync_sap_to_bigquery.py` → función `sync_targets_from_firestore()` — se ejecuta cada 30 min como paso 7 del pipeline. WRITE_TRUNCATE garantiza dedup.

### Suscripción diaria por email (2026-07-14)

Distribución automática del tablero por email vía **Power BI Service — Suscripciones estándar**. Nativa del servicio, sin código propio.

**Config actual**:

| Campo | Valor |
|---|---|
| Nombre suscripción | `Desempeño diario de ventas SAR - PESCA` |
| Destinatario | `mariano.erbino@shimano.com.ar` |
| Asunto | `Desempeño diario de ventas SAR - PESCA` |
| Frecuencia | Diaria |
| Hora envío | **15:00** (`UTC-03:00` Buenos Aires) |
| Contenido | Miniatura de la página TABLERO SAR + link "Open report in Power BI" + PDF adjunto con todas las páginas |
| Refresh dataset previo | **14:30** (30 min antes) — actualización programada del modelo semántico `TABLERO SAR` |
| Ejecución de prueba | 2026-07-14 11:33 — llegó OK a Mariano con snapshot completo |

**Cómo se configuró** (para replicar / agregar destinatarios):

1. Publicar el `.pbix` a Power BI Service: Desktop → `Archivo → Publicar → seleccionar workspace`.
2. En [app.powerbi.com](https://app.powerbi.com/) → workspace donde vive el informe → click en **TABLERO SAR (tipo Informe)** (icono barras naranjas).
3. Toolbar superior → **Suscribirse a informe** → **+ Agregar nueva suscripción** → tipo **Estándar** (NO dinámico por destinatario, ese es para RLS con vista personalizada por user).
4. Completar campos: nombre, destinatarios (`;` para múltiples), asunto, frecuencia diaria, hora `15:00`, zona `Buenos Aires`, activar **"Incluir la vista actual del informe"** (miniatura) y **"Adjuntar el informe completo (PDF)"** para que llegue TODO el reporte, no solo una página.
5. **Guardar y cerrar**. Ejecutar "Ejecutar ahora" para probar sin esperar al día siguiente.

**Refresh programado del dataset** (para que el mail traiga datos del día):

- En el workspace → click en **TABLERO SAR (tipo Modelo semántico)** (icono cilindro) → **Configuración** → **Actualización programada** ON.
- Frecuencia: Diaria, zona `Buenos Aires`.
- Hora: `14:30`.
- Credenciales del origen BigQuery: revisar que no digan "Editar credenciales" en rojo — si sí, autenticar con Google.

**Para agregar destinatarios** (ej: Diego, Pablo): editar la suscripción existente en el panel "Suscribirse a informe" y sumar los emails separados por `;`. Los destinatarios externos al tenant `shimano.com.ar` requieren que IT habilite "External sharing" en Azure AD / Power BI Admin Portal.

**Trade-off Estándar vs Dinámico por destinatario**:
- **Estándar** = 1 snapshot igual para todos (el que tenemos). Simple.
- **Dinámico** = usa RLS del modelo para mandar a cada usuario su vista filtrada (ej: cada vendedor solo ve sus targets). Requiere RLS configurado en el modelo. No implementado hoy.

### Rollback del fix "gap huérfano" en v_backorder_lineas (2026-07-13/14)

**Contexto**: `v_backorder_lineas` mostraba 1454 SKUs BIKE con `producto/familia/stock_actual` en blanco porque `sap_items_raw` solo trae grupo PESCA (755 items). Los SKUs BIKE con backorder existen en SQ pero no en el maestro.

**Intento de fix** (commit `e5cef77`): ampliar `v_sap_items_enriched` para incluir SKUs de SQ/SO/PO abiertos como universo (3042 filas total). Nueva columna `is_in_master`. Todo funcionaba en SQL — verificaciones pasaron 0 huérfanos.

**Problema en cliente**: Power BI Desktop del usuario (máquina con 8GB RAM, 95% memoria durante refresh) se colgaba 30+ min en el modal Actualizar. Los datos bajaban pero VertiPaq no lograba recomprimir el nuevo schema. Confirmado con Task Manager (CPU 0%, disco 0 MB/s durante freeze).

**Rollback en 2 pasos**:
1. Rollback quirúrgico (`7729ced`): dejar `v_inventario` con `WHERE is_in_master = TRUE` (755 filas, schema idéntico al pre-fix). No bastó.
2. Rollback total (`f1f441a`): las 4 vistas afectadas vueltas exactas al estado pre-fix. `v_sap_items_enriched` vuelve a ser `SELECT * FROM sap_items_raw` con `familia_norm`.

**Bonus fix mientras tanto** (commit `6f6397a`): `v_facturas_sap` — removida la columna `lines_json` (JSON string de 5-50KB por fila × 4776 = 20-200MB en un solo campo). VertiPaq no puede comprimir strings JSON únicos → explotaba RAM. El aplanamiento ya vive en `v_ventas_lineas`. Con eso el refresh de PBI se destrabó.

**Pendiente / reintroducir cuando**:
- El user tenga máquina con ≥16GB RAM, o
- Se migre el modelo a Power BI Service (corre en servidor Microsoft con recursos garantizados).

El SQL amplio para reintroducir el fix vive en git (commit `e5cef77`). Los scripts `diagnose_inventario_gap.py`, `test_inventario_fix.py`, `dryrun_new_views.py` permiten verificar el gap actual y validar el fix antes de aplicar.

### Estado inicial pre-2026-07-13

### Objetivo

Tablero Power BI alimentado casi real-time (5-30s de lag desde Firestore, ~30 min desde SAP) para que Diego, Pablo, Mariano y jefes de equipo vean performance comercial sin esperar exports manuales. KPIs Ola 1 (Ventas + Campo + Inventario + Campañas): facturación MTD, ticket promedio, visitas ejecutadas, cobertura padrón, conversión visita→pedido, stock crítico, progreso campañas, deuda vencida.

### Arquitectura

```
┌─ Firestore (app vive aquí) ───────────────┐
│    ↓ 7 Firebase Extensions                │
│      firestore-bigquery-export (uno por   │
│      colección — trigger nativo)          │
│                                            │
├─ SAP B1 Service Layer ────────────────────┤
│    ↓ script Python + GH Actions cron      │
│      sync_sap_to_bigquery.py              │
│                                            │
└─→ BigQuery dataset shimano_app            │
    (southamerica-east1 - Sao Paulo)       │
        ↓ Vistas SQL curadas (Fase 2)      │
        ↓ Power BI Desktop DirectQuery     │
        ↓ Publish → Workspace "Shimano"    │
```

**Regla: todo en `southamerica-east1` (Sao Paulo)** — Firestore + BigQuery + Cloud Functions de las Extensions. Latencia mínima, sin cargos cross-region.

### Fase 1.1 — Firestore → BigQuery — ✅ HECHO 2026-07-07

**7 instancias de la extension `firestore-bigquery-export@0.3.2`** instaladas, todas en dataset `shimano_app`:

| # | Colección Firestore | Table ID en BQ | Docs backfill 2026-07-07 |
|---|---|---|---|
| 1 | `pedidos` | `pedidos_raw` → `_raw_changelog` + `_raw_latest` | 4 |
| 2 | `visits` | `visits_raw` → `_raw_changelog` + `_raw_latest` | 8 |
| 3 | `client_master` | `client_master_raw` → `_raw_changelog` + `_raw_latest` | 105 |
| 4 | `sap_clients` | `sap_clients_raw` → `_raw_changelog` + `_raw_latest` | 4 |
| 5 | `client_applications` | `client_applications_raw` → `_raw_changelog` + `_raw_latest` | 109 |
| 6 | `rendiciones` | `rendiciones_raw` → `_raw_changelog` + `_raw_latest` | 34 |
| 7 | `campaigns` | `campaigns_raw` → `_raw_changelog` + `_raw_latest` | 0 (colección vacía, se llenará cuando se cree la 1ª campaña) |

**Total: 264 documentos históricos importados.** Cada write futuro se sincroniza automáticamente (trigger nativo de Firestore, sin código adicional).

**Fuera de alcance Fase 1.1** (posible ampliación futura): `notifications`, `custom_routes`, `route_overrides`, `vendor_overrides`, `roles`, `userData`, `product_catalog` (chunks), `sap_products`, `sap_vendors`, `client_locations`, `operations_log`, `targets`, `allowed_emails`, `app_config`. Se pueden sumar 1x1 con más instancias si Power BI las necesita.

#### Estructura de cada tabla stream

Para cada colección se generan **2 objetos** en BigQuery:

- **`<prefix>_raw_changelog`** (tabla): 1 fila por cada evento Firestore (`CREATE` / `UPDATE` / `DELETE` / `IMPORT`). Columnas: `document_name`, `document_id`, `operation`, `timestamp`, `data` (JSON), `old_data` (JSON del estado anterior en UPDATEs). Es la fuente de verdad para audit trail y para reconstruir el estado en cualquier momento.
- **`<prefix>_raw_latest`** (view materializada): última versión de cada `document_id` que existe hoy (DELETEs quedan excluidos). Es la que usa Power BI por default.

**Convención de nombre**: Table ID `pedidos_raw` → tablas reales `pedidos_raw_raw_changelog` y `pedidos_raw_raw_latest` (el sufijo `_raw_*` es literal del template de la Extension; podríamos haber puesto `pedidos` como Table ID para que quedara `pedidos_raw_changelog`, pero mantenemos `_raw` por consistencia con el resto).

#### Config común de todas las Extensions

- **Cloud Functions location**: `southamerica-east1`
- **BigQuery Dataset location**: `southamerica-east1`
- **BigQuery Project ID**: `app-vendedores-shimano`
- **Firestore Instance ID**: `(default)`
- **Firestore Instance Location**: `southamerica-east1`
- **Dataset ID**: `shimano_app`
- **Wildcard Column**: `false`
- **Time Partitioning**: `NONE` / `omit`
- **Clustering**: default (`data,document_id,timestamp`)
- **View Type**: `View` (materializada, refresh 60 min)
- **Max synced docs/sec**: 100
- **Habilitar eventos (Eventarc)**: **desmarcado** — no se usan custom event handlers y evita el bug de permisos IAM que teníamos con `cloudtasks.tasks.create` en Service Agent Eventarc.
- **Excluir old payloads**: `no` (queremos `old_data` para poder trackear cambios)

#### Backfill del histórico

Se hace **UNA vez por colección** con el script `@firebaseextensions/fs-bq-import-collection` (npx). Después del install la Extension solo captura writes futuros; sin backfill los docs previos quedan invisibles a Power BI.

**Requisitos**:
- Node.js 14+ (funciona con 22 y 24)
- Service account key JSON descargado desde Firebase Console → Configuración → Cuentas de servicio (guardado como `~/Desktop/sa-key.json`, no commitear)
- El service account necesita 2 roles adicionales en IAM (por default solo trae permisos de Firebase, no BigQuery):
  - **BigQuery Data Editor** (`roles/bigquery.dataEditor`)
  - **BigQuery Job User** (`roles/bigquery.jobUser`)

**Script**: `~/Desktop/backfill-all.ps1` procesa las 6 colecciones nuevas en secuencia (pedidos ya se hizo aparte). Ejemplo de comando por colección:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\shimano.sandbox\Desktop\sa-key.json"
npx --yes @firebaseextensions/fs-bq-import-collection `
  --non-interactive `
  --project=app-vendedores-shimano `
  --source-collection-path=<colección> `
  --dataset=shimano_app `
  --table-name-prefix=<colección>_raw `
  --dataset-location=southamerica-east1 `
  --batch-size=300 `
  --query-collection-group=false
```

**Verificación post-backfill** (query BigQuery para cualquier colección):
```sql
SELECT operation, COUNT(*) AS cnt
FROM `app-vendedores-shimano.shimano_app.<prefix>_raw_changelog`
GROUP BY operation;
```

Debe mostrar `IMPORT` con el conteo real de docs existentes.

### Fase 1.2 — SAP → BigQuery — ✅ HECHO 2026-07-08 (ampliado 2026-07-14)

**Script**: `scripts/sync_sap_to_bigquery.py` (~750 líneas). Corre en GH Actions cron `13,43 * * * *` (mismo patrón que el sync a Firestore) mediante `.github/workflows/sync-sap-to-bigquery.yml`.

**9 tablas SAP + 2 tablas desde Firestore en BigQuery** (dataset `shimano_app`):

| Tabla | Endpoint / Fuente | Contenido | Volumen 2026-08-04 |
|---|---|---|---|
| `sap_bp_raw` | `/BusinessPartners?$filter=CardType eq 'cCustomer'` | Padrón Customers | ~20 rows |
| `sap_items_raw` | `/Items?$filter=ItemsGroupCode eq <PESCA>` | Catálogo pesca con stock + precio | ~755 rows |
| `sap_invoices_raw` | `/Invoices?$filter=DocDate ge '<24m>'` | Facturas últimos 24 meses | ~4.700 rows |
| **`sap_credit_notes_raw`** ← 2026-07-30 | `/CreditNotes?$filter=DocDate ge '<24m>'` | Notas de crédito últimos 24 meses (restan del Facturado). Fix v367 | ~500 rows |
| `sap_quotations_raw` | `/Quotations?$filter=DocDate ge '<24m>'` | Cotizaciones últimos 24 meses | ~7.000 rows |
| `sap_orders_raw` | `/Orders?$filter=DocDate ge '<24m>'` | Sales Orders últimos 24 meses | ~5.000 rows |
| `sap_purchase_orders_raw` | `/PurchaseOrders?$filter=DocDate ge '<24m>'` | POs (mercadería incoming) | ~5.650 rows |
| **`sap_deliveries_raw`** ← 2026-08-03 | `/DeliveryNotes?$filter=DocDate ge '<12m>'` | Remitos últimos 12 meses. Alimenta `v_remitos_lineas` | ~4.743 rows |
| **`sap_returns_raw`** ← 2026-08-04 | `/Returns?$filter=DocDate ge '<12m>'` | Devoluciones últimos 12 meses (restan del Remitido). Fix v386.2 | ~124 rows |
| **`targets_raw`** ← 2026-07-14 | Firestore `targets` (sync propio) | Metas mensuales cargadas por gerente | 4 rows (Julio 2026) |
| **`campaigns_raw`** ← 2026-07-30 | Firestore `campaigns` (sync propio) | Campañas comerciales de Pablo | ~5 rows |

**Estrategia**: `WRITE_TRUNCATE` cada corrida (full snapshot). Cuando el volumen escale (miles de facturas), migrar a delta por `UpdateDate`.

Cada row incluye `_sync_timestamp` (UTC ISO) para trazabilidad de la corrida.

**DocumentLines** de invoices/quotations se guarda como JSON string en la columna `lines_json` para no explotar el schema. Fase 2 hace `UNNEST(JSON_EXTRACT_ARRAY(lines_json))` en las vistas cuando hace falta.

**Bugs encontrados y solucionados durante el desarrollo (2026-07-08)**:
- `Property 'State1' of 'BusinessPartner' is invalid`: campo removido del schema SL de Shimano. Fix: quitar del `$select`, el `state` en `sap_bp_raw` queda `null` (se puede extraer de `BPAddresses` en vistas Fase 2 si Power BI lo necesita).
- `Property 'CreditLine' of 'BusinessPartner' is invalid`: idem. También removidos `CurrentAccountBalance` y `Notes` como preventivo.
- Volumen bajo confirmado con el user: es normal en esta etapa temprana de venta directa PESCA post-Baraldo.

### Fase 2 — Vistas curadas — ✅ HECHO 2026-07-08

**Archivo con SQL**: `bigquery/views.sql`. Se ejecuta manualmente **una vez** desde BigQuery Console; después se puede re-correr con cambios (todas usan `CREATE OR REPLACE VIEW`).

**4 vistas creadas en `shimano_app`**:

| Vista | Descripción | Fuente |
|---|---|---|
| `v_pedidos_header` | 1 fila por pedido, con todos los campos del header aplanados desde el JSON de Firestore (cliente, mes, forma pago, forma entrega, subtotales, discountSnapshot, hasSkusToReview, etc.) | `pedidos_raw_raw_latest` |
| `v_pedidos_lines` | 1 fila POR LÍNEA (explota el array `lines` del pedido). Incluye contexto denormalizado del pedido (cliente_nombre, provincia, mes, etc.) para queries rápidos sin joins. | `pedidos_raw_raw_latest` con `UNNEST(JSON_EXTRACT_ARRAY(data, '$.lines'))` |
| `v_visitas` | 1 fila por visita con todos los campos del formulario aplanados. Incluye VDE-VDI con `on_behalf_of` para detectar cargas hechas por VDI en nombre de VDE. **Fix v283**: los campos `provincia` y `localidad` en español (no `province`/`locName` como pedidos). | `visits_raw_raw_latest` |
| `v_facturas_sap` | Facturas SAP + `LEFT JOIN` con `sap_bp_raw` para tener nombre del cliente + tipo + moneda + ciudad al lado, sin que Power BI tenga que hacer el join. | `sap_invoices_raw` + `sap_bp_raw` |

**Convenciones**:
- Nombres de columnas en **snake_case latino** natural para el usuario final (`cliente_nombre` en vez de `clientName`).
- `SAFE_CAST` en todos los conversions para robustez (dato malformado → `NULL`, no rompe la vista).
- `CREATE OR REPLACE VIEW`, ejecutables idempotentes.

**Documentar cada vista** en `bigquery/views.sql` con comentarios en el propio SQL (ya está hecho).

### Fase 3 — Power BI Desktop — 🔨 EN CURSO 2026-07-08

**Estado**: conectado a BigQuery via conector nativo, 5 tablas cargadas en modo **Import**, medidas DAX básicas armadas, primer dashboard "Resumen-Desempeño" en armado.

#### Setup

- Power BI Desktop instalado en la máquina.
- Conector: **Google BigQuery** (nativo, no Azure AD).
- Modo: **Import** (más rápido que DirectQuery para los volúmenes actuales; migrar a DirectQuery cuando la data crezca).
- Login: `bot.shimano.pesca@gmail.com` con OAuth.

#### Tablas cargadas

- `v_pedidos_header`, `v_pedidos_lines`, `v_visitas`, `v_facturas_sap` (las 4 vistas)
- `sap_items_raw` (catálogo con stock/precio)
- + tabla auxiliar `Vendedores` creada con **DATATABLE** en Power BI Desktop (6 filas hardcoded: SlpCode 50-55, Nombre, Tipo VDI/VDE, Región)
- + tabla auxiliar `Origenes` (VDT, VDI, VDE) para el visual "Facturación por Origen"

#### Relaciones

- `v_pedidos_lines[pedido_id]` → `v_pedidos_header[pedido_id]` (many-to-one, autodetectada)
- `Vendedores[SlpCode]` → `v_facturas_sap[sales_person_code_invoice]` (uno-a-varios, creada a mano)

#### Medidas DAX principales (bajo `v_facturas_sap`)

| Medida | Fórmula | Formato |
|---|---|---|
| Facturación Total | `CALCULATE(SUM('v_facturas_sap'[doc_total]), 'v_facturas_sap'[sales_person_code_invoice] IN {50, 51, 52, 53, 54, 55})` | Moneda ARS |
| Ticket Promedio | `CALCULATE(AVERAGE(...), 'v_facturas_sap'[sales_person_code_invoice] IN {50..55})` | Moneda ARS |
| Cuentas Atendidas | `DISTINCTCOUNT('v_facturas_sap'[card_code])` | Entero |
| Pedidos Ingresados | `COUNTROWS('v_pedidos_header')` | Entero |
| SKUs Únicos | `DISTINCTCOUNT('v_pedidos_lines'[sku])` | Entero |
| Target Mensual | `50000000` (hardcoded temporal, migrar a tabla de targets después) | Moneda ARS |
| % Cumplimiento | `DIVIDE([Facturación Total], [Target Mensual], 0)` | Porcentaje |
| Desviación | `[Target Mensual] - [Facturación Total]` | Moneda ARS |
| Descuento Medio | `AVG(discount_percent)` filtrado por PESCA | Porcentaje |
| Facturación VDE | `CALCULATE(SUM(doc_total), sales_person_code_invoice IN {50, 51, 54, 55})` | Moneda |
| Facturación VDI | `CALCULATE(SUM(doc_total), sales_person_code_invoice IN {52, 53})` | Moneda |
| Peso VDE % / VDI % | `DIVIDE(...)` | Porcentaje |
| Facturación por Origen | `SWITCH(TRUE(), SELECTEDVALUE('Origenes'[Origen]) = "VDT", [Facturación Total], ...)` | Moneda |
| SKU Cliente | `DIVIDE([SKUs Únicos], [Cuentas Atendidas], 0)` | Entero |

#### Columnas calculadas para slicers

- `v_facturas_sap[Año]` = `YEAR(doc_date)`
- `v_facturas_sap[Mes Nombre]` = `FORMAT(doc_date, "MMMM")` (ordenado por Mes Num)
- `v_facturas_sap[Mes Num]` = `MONTH(doc_date)`
- `v_facturas_sap[Día]` = `FORMAT(doc_date, "dd")` (para ejes de gráficos por día)

#### Visuales en armado ("Resumen-Desempeño")

- Header oscuro con título + slicers Año/Mes arriba a la derecha.
- **Gauge "Facturación mensual"** (semicircular): valor actual / target.
- **Gauge "% Cumplimiento"**.
- **Card grande "Facturación Real"** con Desviación + Descuento Medio debajo.
- **Grilla 2x3 de 6 KPIs pequeños**: Ticket Promedio, Peso VDE %, Peso VDI %, Cuentas Atendidas, Pedidos Ingresados, SKU Cliente.
- **Bar chart "Facturación por Día"** (día del mes en eje X).
- **Bar chart "Facturación por Región"** (barras verticales por región de vendedor).
- **Bar chart "Facturación por Origen de Pedido"** (VDT/VDI/VDE).
- **Bar chart horizontal "Regiones - TOP"**.

#### Trabajo pendiente Fase 3

- Publish al **Power BI Service** (workspace Shimano). Requiere licencia Pro para los viewers.
- Configurar **Scheduled Refresh** cada 30 min (aligned con el cron del sync SAP → BigQuery).
- Dashboards adicionales por pilar: Ventas · Campo · Inventario · Campañas (los 4 slides de `Real-Time.pptx`).
- Compartir con stakeholders (roles: gerencia, jefe ventas, oncall inventario).
- Cuando el volumen escale: considerar migrar a **DirectQuery** en las tablas críticas (facturas) para tener latencia ~30 seg desde SAP → dashboard.

### Fase 4 — Alertas — ⏳ PENDIENTE

Alertas automáticas Ola 1 (6):
- Meta a mitad de mes
- Cliente Premium dormido
- Stock quebrado con demanda
- Vendedor bajo target día 20
- Cotización sin cerrar >15 días
- Meta superada (motivación)

Canal a decidir: **Power BI Data Alerts** (email nativo) o **Cloud Function + Slack/WhatsApp**.

### Viewers del workspace (Fase 3)

- **Mariano Erbino** (admin) — `mariano.erbino@shimano.com.ar`
- **Diego Valsi** — `diego.valsi@shimano.uy`
- **Santiago Beron** — `santiago.beron@shimano.uy`
- **Pablo Maraschin** — email pendiente confirmación
- **Ioannis Palkoudakis** — email pendiente confirmación

### Troubleshooting Extensions

**Síntoma: Extension queda "En proceso · Configuring BigQuery Sync" por días.** Está colgada (permisos IAM incompletos o timeout). Desinstalar y reinstalar limpio (los permisos ya deberían haber propagado; si es la primera vez y falla, esperar 30 min y reintentar).

**Síntoma: Extension "Instalada" ✅ pero tabla no aparece en BigQuery.** Verificar en el sidebar "Estado del entorno de ejecución" que diga "Processing" en verde. Si dice "En proceso" o error, revisar logs de la Cloud Function `ext-*-syncBigQuery` en Google Cloud Console → Cloud Functions.

**Síntoma: Backfill falla con "Access Denied: Permission bigquery.tables.get denied".** El service account `firebase-adminsdk-*` viene con permisos de Firebase pero NO de BigQuery. Agregar en IAM los roles `BigQuery Data Editor` + `BigQuery Job User`.

**Síntoma: Backfill falla con "QueryCollectionGroup is not specified".** Falta el flag `--query-collection-group=false` en el comando `fs-bq-import-collection` (la versión nueva lo pide).

**Síntoma: Dataset ID quedó en `firestore_export` en lugar de `shimano_app`.** El wizard de la Extension trae `firestore_export` como default y es fácil pasarlo por alto. Corregir: desinstalar la Extension mal configurada y reinstalar poniendo `shimano_app` a mano. Después, en BigQuery Console borrar el dataset huérfano `firestore_export` si quedó vacío.

---

## 40-bis) Sync automático de BPs pesca (v282-v288, 2026-07-08)

**Objetivo**: cuando administración da de alta un cliente en SAP, aparece automáticamente en la app en la siguiente corrida del cron (~30 min). Sin acción manual del admin.

### Contexto histórico

**Antes** (v281 y anteriores) la única forma de que un cliente SAP apareciera en la app era:
1. Admin exportaba CSV de BPs desde SAP.
2. Iba al panel **SAP → Integración** en la app.
3. Subía el archivo.
4. La app hacía match contra `POINTS` (hardcoded).
5. Los matches se guardaban en `sap_clients`; los no-match quedaban invisibles.

**Fricción**: nadie lo corría rutinariamente. Los BPs SAP nuevos quedaban en limbo por semanas.

### Fix v282-v288

Nueva función `sync_bp_pesca()` dentro de `scripts/sync_sap_to_firestore.py` que corre en la misma corrida del cron cada 30 min. Después de items+stock+precios, también sincroniza BPs pesca desde `/BusinessPartners` → `client_applications` en Firestore.

**Filtro correcto (v288)**:
```
U_DIVISION IN ('2', '3', 'PESCA', 'BIKE & PESCA')
```
Donde:
- `1` = BIKE
- `2` = PESCA
- `3` = BIKE & PESCA (mixto, se incluye porque el user lo considera pesca)

Además: `CardType IN ('cCustomer', 'cLid')` — incluye Leads (los BPs pesca empiezan como Lead esperando validación de finanzas).

**Volumen actual**: ~103 BPs pesca. De 2600 BPs Customer/Lead totales, 2506 son BIKE (se descartan).

### Provincia canónica

El UDF `U_SH_PCIA` en SAP guarda el código interno de provincia (ej: `'2'`), no el nombre. El sync trae el mapping desde `/States?$filter=Country eq 'AR'` al inicio de cada corrida y convierte `'2'` → `'SALTA'` (uppercase para matchear con las zonas hardcoded de la app).

Se guarda en el campo `provincia` del doc `client_applications` (el que usa la app para filtrar/agrupar). Fallback: si el UDF está vacío, buscar en `BPAddresses[].State`.

### Comportamiento del upsert

Matching en orden de prioridad:
1. **`cardCodeSap`** (más confiable).
2. **`cuit` normalizado** (solo dígitos).
3. **Nombre normalizado** como fallback (`sapNorm(name)`).

Tres casos:
- **CASO 1** — Existe como PROVISORIO (`manualSapPending=true`): pisar con datos SAP + `status='approved'` + `cardCodeSap` poblado + `manualSapPending=false`. La app actualiza el badge de 🟡 PROVISORIO a 🟢 HABILITADO automáticamente vía listener.
- **CASO 2** — Existe como HABILITADO: actualizar datos SAP (dirección, phone, email). **NO se toca** `assignedVendor`/`ownerUid` para no pisar reasignaciones manuales del gerente.
- **CASO 3** — No existe: crear nuevo doc con `status='approved'`, `source='sap_sync'`, y `assignedVendor`/`ownerUid` vacíos. Admin/gerente los asigna en la app.

### Vendedor por asignación manual

**Decisión de diseño 2026-07-08**: NO asignar vendedor automáticamente en el sync. Razones:
- El campo `SalesPersonCode` en el header del BP en SAP viene como `-1` (No Sales Employee) para todos los BPs pesca.
- Mapping por provincia → vendedor podría ser incorrecto (una provincia grande tiene sub-zonas con distintos vendedores).
- El gerente prefiere el control manual.

El admin/gerente entra a la app y asigna vendedor+zona desde el panel Master Clientes o Alta Clientes.

### Metadata SAP guardada en el doc

Además de los campos estándar (`comercio`, `cardCodeSap`, `cuit`, `calle`, `localidad`, `provincia`), el sync guarda:
- `sapCardType` — `cCustomer` | `cLid`.
- `sapDivision` — código de U_DIVISION (`'2'` o `'3'`).
- `sapValid` / `sapFrozen` — flags de estado en SAP.
- `sapReadyForSL` — bool convenience. `true` sólo si `CardType='cCustomer' + Valid='tYES' + Frozen!='tYES'`. La app puede usar este flag para skip el auto-envío a Service Layer (evita el spam de errores 400 en consola cuando el BP es Lead o Inactive).
- `sapSalesPersonCode` — el número del header (típicamente -1 para pesca).
- `sapProvinceRaw` — el código interno de U_SH_PCIA para auditoría.
- `source` — `'sap_sync'` (permite filtrar/limpiar docs del sync sin tocar altas manuales).

### Script de limpieza

`scripts/cleanup_bad_bp_sync.py` — herramienta para borrar docs mal cargados por el sync. Solo borra de **Firestore** (nunca de SAP).

**Filtros de seguridad**:
- `source == 'sap_sync'` (no toca altas manuales).
- `createdAt > CUTOFF_DATE` (default `2026-07-08T00:00:00Z`; safety para no tocar docs viejos).

**Uso**:
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\shimano.sandbox\Desktop\sa-key.json"
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content C:\Users\shimano.sandbox\Desktop\sa-key.json -Raw
$env:DRY_RUN = "true"
python scripts/cleanup_bad_bp_sync.py    # Ver qué va a borrar sin borrar
# Después de confirmar en DRY_RUN:
Remove-Item Env:\DRY_RUN
python scripts/cleanup_bad_bp_sync.py    # Borrar de verdad
```

Borra en batches de 500 (max Firestore). ~2500 docs se borran en ~10 segundos.

### Bugs superados durante el desarrollo (v282→v288)

Cronología resumida:
1. **v282**: filtro por `SalesPersonCode IN {50-55}` → 0 resultados (todos vienen -1 en el header).
2. **v283**: intento con `U_DIVISION eq 'PESCA'` en OData → SL no matchea UDF en `$filter`.
3. **v285**: filtrar UDF en Python → paginado se corta (nextLink sin `@` en algunas versiones SL).
4. **v286**: fix paginado + filtro `U_DIVISION == '1'` → 2506 rows (¡BIKE!).
5. **v287**: simplificado, no asignar vendedor auto.
6. **v288 FINAL**: `U_DIVISION IN ('2', '3')` (PESCA + BIKE&PESCA), poblar `provincia` canónica desde mapping de SAP States.

Total: ~15 iteraciones para llegar al fix correcto por la naturaleza propietaria del schema SL de este SAP.

---

## 42) Setup de desarrollo local (2026-07-24)

Todo lo instalado en la máquina de Mariano (`shimano.sandbox` — Windows 11) para poder trabajar la app localmente + operar la infra remota desde terminal sin depender de consolas web.

### 42.1 Herramientas CLI instaladas

| Herramienta | Versión | Loggeado como |
|---|---|---|
| Node.js | 24.15.0 (LTS) | — |
| npm | 11.12.1 | — |
| Python | 3.13.14 | — |
| Git | 2.54.0 (Windows) | — |
| **Firebase CLI** | 15.24.0 | `bot.shimano.pesca@gmail.com` |
| **Google Cloud SDK** | 577.0.0 | `bot.shimano.pesca@gmail.com` |
| **bq** (BigQuery CLI) | 2.1.35 | (usa ADC de gcloud) |
| **gsutil** (Storage CLI) | incluido en gcloud | (usa ADC de gcloud) |
| **ADC** (App Default Creds) | activo | `bot.shimano.pesca@gmail.com` |
| **Java Temurin JRE 21 LTS** | 21.0.11+10 | — (requisito para Firestore Emulator; el JDK 25 MSI requería UAC → se bajó ZIP portable de JRE 21 a `C:\Users\shimano.sandbox\Java\jdk-21.0.11+10-jre`) |

Config gcloud default:
- Proyecto: `app-vendedores-shimano`
- Región: `southamerica-east1`
- Zona: `southamerica-east1-a`

### 42.2 Comandos útiles que ahora funcionan desde terminal

```powershell
# Queries BigQuery ad-hoc
bq query --nouse_legacy_sql --project_id=app-vendedores-shimano "SELECT COUNT(*) FROM shimano_app.v_ventas_lineas WHERE anio=2026 AND mes=7"

# Listar vistas del dataset
bq ls --project_id=app-vendedores-shimano shimano_app

# Ver proyectos GCP
gcloud projects list

# Firestore Emulator local (para testear Security Rules sin tocar prod)
firebase emulators:start --only firestore

# Deploy Firestore Rules
firebase deploy --only firestore:rules

# Ver / gestionar archivos de Firebase Storage
gsutil ls gs://app-vendedores-shimano.firebasestorage.app/rendiciones/
gsutil cp gs://app-vendedores-shimano.firebasestorage.app/rendiciones/uid/foto.jpg .

# Backup Firestore a Storage (una vez que esté armado)
gcloud firestore export gs://backup-bucket
```

### 42.3 Sentry (monitoring de errores) — INTEGRADO en v324 (Fase 0 E7), CSP arreglado en v326+v327

**Public key**: `7cbe790b32043d72a1b147a2f7f0c641` (cuenta Sentry de Mariano).
**DSN completo** (público, embebido en el loader): `https://7cbe790b32043d72a1b147a2f7f0c641@o4511788116344832.ingest.us.sentry.io/4511788136071168`
**Org slug**: `shimano` (URL: `https://shimano.sentry.io/`)
**Project ID**: `4511788136071168`

**Estado**: **operativo end-to-end desde v327** (verificado 2026-07-25 con 2 test events capturados: `Sentry.captureMessage(...)` + `Sentry.captureException(...)`, ambos aparecen en https://shimano.sentry.io/issues/ con event IDs asignados y tags `role`, `vendor`, `release`).

**Historia del rollout**:
- **v324 (E7)**: loader agregado, `Sentry.init` config OK, pero CSP no incluía Sentry — loader bloqueado por `script-src`. Blackout total ~24h.
- **v326**: agregado `https://*.sentry-cdn.com` a `script-src` → loader baja OK. Agregado `https://*.ingest.sentry.io` a `connect-src`, pero el host real del ingest es `<org>.ingest.us.sentry.io` (subdominio regional US) y el wildcard `*.ingest.sentry.io` NO matchea `.us.sentry.io`. POSTs bloqueados silenciosamente. Otro ~1h de blackout.
- **v327**: `connect-src` corregido a `https://*.sentry.io` (cubre US/EU/futuras regiones). POSTs pasan con 200. Sentry.io recibe eventos. ✅

**Cómo funciona**:
- `<script src="https://js.sentry-cdn.com/{publicKey}.min.js">` en el `<head>` después de los SDKs de Firebase.
- `Sentry.onLoad(...)` dispara `Sentry.init({release: APP_VERSION, environment:'production', tracesSampleRate: 0.0})` una vez que el SDK terminó de cargar (async).
- Helper `applySentryUserContext(sentry, user, role, vendor)` **vive en `src/sentry.js` y se expone como `window.applySentryUserContext` vía el bundle `app.bundle.js`** (v325+). Se llama post-login desde `fetchAndApplyRole` — setea `Sentry.setUser({id, email})` + `setTag('role')` + `setTag('vendor')`. Todo error subsiguiente viaja con esos tags.

**CSP requerida** (en `index.html:8`, agregada en v326 + corregida en v327 + source map fix en v328):
- `script-src` debe incluir `https://*.sentry-cdn.com` (cubre `js.sentry-cdn.com` + `browser.sentry-cdn.com`; el loader carga el SDK desde estos hosts).
- `connect-src` debe incluir `https://*.sentry.io` (endpoint donde Sentry POST-ea los eventos) **Y** `https://*.sentry-cdn.com` (para que DevTools baje el source map del SDK sin CSP violation).
- **Ojo con el wildcard**: v326 tuvo `*.ingest.sentry.io` que NO matchea `<org>.ingest.us.sentry.io` (el host real del ingest usa subdominio regional `.us.sentry.io`). CSP wildcards requieren sufijo exacto: `*.ingest.sentry.io` solo matchea hosts que terminen en `.ingest.sentry.io`. v327 usa `*.sentry.io` para cubrir todas las regiones (US, EU, futuras).

**Cómo desactivar / rotar public key**: editar el `<script src=...>` en `index.html` líneas post-Firebase-SDKs + bumpear APP_VERSION.

**Pendientes** (no bloqueantes):
- Configurar sample rate de `tracesSampleRate` si se quiere performance monitoring (hoy 0.0 = solo errores).
- Definir alerta en dashboard Sentry (email al superar N errores/hora).
- Elegir plan pago si supera 5k eventos/mes del free tier.
- Errores dentro del Service Worker (`sw.js`) NO son capturados por este snippet — requieren init separado. Fuera de scope Fase 0.

### 42.4 Cuentas y sus roles reales

- **`erbinomariano@gmail.com`** — Owner del proyecto GCP + creador Firebase project. Tiene todos los permisos IAM. Usar para operaciones privilegiadas (crear buckets, cambiar IAM, deploy funciones).
- **`bot.shimano.pesca@gmail.com`** — Admin bootstrap de la APP (auto-elevación al primer login). Rol admin en Firestore. Firebase CLI + gcloud + ADC quedaron loggeados con esta cuenta — cubre 95% de operaciones. Si algún comando falla con `permission denied`, cambiar a `erbinomariano@gmail.com` con `gcloud auth login --account=erbinomariano@gmail.com`.

### 42.5 Documento arquitectónico separado

Archivo **`APP-CONTEXTO.md`** en `C:\Users\shimano.sandbox\Desktop\` — análisis completo del stack actual + evaluación de migrar a React/Node.js + roadmap Fase 0/1/2/3 sugerido + riesgos operativos. Documento autocontenido pensado para pasarle a Claude Cowork u otro dev consultor externo sin contexto previo.

**TL;DR del documento**: NO migrar todo a React ahora (rewrites de apps en producción fallan 60-70% de las veces). SÍ refactor gradual en 12-18 meses. Primero cerrar security holes + agregar monitoring (Sentry) + backup automático diario. Recién después pensar en React/Next.js.

### 42.6 Próximos pasos sugeridos para arrancar Fase 0

Cuando el user quiera empezar el trabajo estructural (post-features):

1. **Testear Firestore Rules localmente** — arrancar el emulator, escribir tests de acceso por rol (admin vs vendedor vs gerente), correr `firebase emulators:exec --only firestore "npm test"`.
2. **Integrar Sentry** en `index.html` con el snippet del 42.3. Bumpear a v324.
3. **Backup automático diario** de Firestore → Storage con `gcloud scheduler` + Cloud Function.
4. **Mover credenciales SAP a Cloud Functions** (hoy están en `app_config/sap_integration` doc de Firestore, cualquier user autenticado las lee).
5. **Auditar Security Rules** — hay áreas laxas ("cualquier user autenticado puede leer `visits`"). Restringir por role/ownerUid.

Estos 5 items son la Fase 0 del roadmap detallado en `APP-CONTEXTO.md`. Trabajo estimado: 2-4 semanas.

---

## 41) Changelog v300 → v380

Solo las versiones nuevas — el histórico anterior está en la última entrada de la sección 38 (Hecho recientemente) y al pie del documento.

Versiones **v204 → v299 archivadas** en [`CHANGELOG-ARCHIVE-v204-v299.md`](./CHANGELOG-ARCHIVE-v204-v299.md) (poda v380, 2026-08-02).

### v381 (2026-08-02) — Cleanup docs post-activación de branch protection

**Cambio doc-only** (bundle intacto). Mariano activó branch protection en `main` en otra terminal y documentó los detalles técnicos en la nueva **§34.1** (config exacta + snippet PS de re-activación + escape hatch `enforce_admins: false` para emergencias). Este commit limpia las **2 referencias stale** que quedaron apuntando al TODO ya cerrado:

1. **Celda APP_VERSION** (tabla superior, en la descripción heredada de v379): decía "NO se activó branch protection en main (requiere confirmación explícita del user — ver TODO)" → ahora dice "Branch protection en main activada el 2026-08-02 post-v380 (ver §34.1)".
2. **§41 v379** (bloque "TODO pendiente"): tenía el comando `gh api` sugerido para activar la protection → ahora dice "TODO cerrado en v381 — detalle completo en §34.1".

**Config real activa** (verificado con `gh api repos/shimano-arg/app-vendedores/branches/main/protection`):
- `required_status_checks.contexts: ["test"]` — el job `test` del workflow `test-and-lint.yml` debe pasar verde.
- `required_status_checks.strict: true` — `dev` debe estar al día con `main` antes del merge.
- `enforce_admins: false` — Mariano puede bypass en emergencia (escape hatch documentado).
- `allow_force_pushes: false` + `allow_deletions: false` — `main` no se puede borrar ni forzar push.
- `required_conversation_resolution: true` — comments del PR deben resolverse antes del merge.

**Consecuencia práctica**: el ciclo v379 (test en CI) + v381 (checks obligatorios) queda cerrado. Ningún merge a `main` puede completarse si los tests están rojos.

**Alcance**:
- `README.md` — 2 reemplazos de texto stale, entrada §41 v381 nueva, tabla superior + celda APP_VERSION bumpeadas.
- `index.html` — `APP_VERSION` v380 → v381.
- `sw.js` — `CACHE_VERSION` v380 → v381.
- **Bundle sin cambios** — no se tocó `src/**`, no se regenera `app.bundle.js`.

### v380 (2026-08-02) — Poda §41 changelog: v204-v299 al archive

**Cambio doc-only** (bundle intacto, cero cambios en app frontend). Motivación: `§41` había crecido a **2.380 líneas** (36% del README, 6.609 líneas totales). 96+ entries pre-v300 son de referencia histórica y no operativas — ningún vendedor consultaría "qué pasó en v210" hoy.

**Ejecución**:

1. **Bloque A** (v204-v292, ~345 líneas — entries cortas de ~6 líneas c/u, orden ascendente en el README original) movido a `CHANGELOG-ARCHIVE-v204-v299.md`.
2. **Bloque B** (v293-v299, ~110 líneas — entries medio-detalle de ~15 líneas c/u, orden descendente en el README original) movido al mismo archive.
3. Ambos bloques quedan **íntegros verbatim** en el archive (formato original preservado). El archive tiene header explicativo indicando por qué está separado y cómo consultarlo.
4. En §41 los 2 rangos quedan reemplazados por **pointers concisos** con titulares destacados para orientar al lector sin obligarlo a abrir el archive:
   - `### v293 → v299 — Archivadas en poda v380` (7 versiones)
   - `### v204 → v292 — Archivadas en poda v380` (89 versiones)
5. Título §41 renombrado `Changelog v204 → v379` → `Changelog v300 → v380`. TOC actualizado.
6. Nota introductoria en §41 apunta al archive.

**Métricas**:

| Métrica | Antes v380 | Después v380 | Δ |
|---|---|---|---|
| README líneas | 6.609 | 6.249 | -360 (-5%) |
| §41 líneas | 2.380 | 1.399 | **-981 (-41%)** |
| README tamaño | 520 KB | ~470 KB | -50 KB |
| §41 % del README | 36% | 22% | **-14pp** |

**Convención nueva**: cuando §41 vuelva a pasar las ~2.000 líneas (probablemente en v450-v500 al ritmo actual de ~1 versión/día), aplicar la misma poda: extraer las ~80 versiones más viejas a un archivo `CHANGELOG-ARCHIVE-v300-vXXX.md`.

**Alcance**:
- `README.md` — extraccion de 2 bloques, título §41 renombrado, TOC actualizado, tabla superior + celda APP_VERSION bumpeadas a v380.
- `CHANGELOG-ARCHIVE-v204-v299.md` (nuevo) — contenido íntegro de los 2 bloques + header explicativo.
- `sw.js` — `CACHE_VERSION` v379 → v380.
- `index.html` — `APP_VERSION` v379 → v380 (feedback: bump ante cualquier cambio del repo).
- **Bundle sin cambios** — no se tocó `src/**`, no se regenera `app.bundle.js`.

**Verificación**: tests locales 193/193 verdes antes de commit. CI `test-and-lint.yml` (v379) también correrá sobre el PR.

### v379 (2026-08-02) — Hygiene sweep infra: `.gitignore` + `scripts/README.md` + CI test-and-lint workflow

**Cambio infra-only** (sin bundle rebuild, sin efectos visibles en la app). Motivación: auditoría automática del repo (delegada a un agent Explore) detectó 3 issues del bloque ALTO:

1. **Secretos untracked sin `.gitignore`**: `github-recovery-codes-IMPORTANT.txt` estaba en la raíz como untracked. Un `git add .` accidental hubiera commiteado los códigos de recuperación 2FA de la cuenta de Mariano al repo público — equivalente a filtrar la clave maestra del dev.
2. **Root desorganizado**: 15+ archivos sueltos sin patrones ignore (`.docx`, `_dtw_*` legacy, 9 scripts one-shot `scripts/check_*`).
3. **Tests solo local antes del PR**: los 193 unit+smoke corrían en la máquina de Mariano antes del squash-merge. Si un día alguien olvidaba correrlos, un test roto llegaba a main.

**Cambios**:

- **`.gitignore` extendido**:
  - `github-recovery-codes-*.txt` (crítico).
  - `*.docx` (informes generados por scripts one-shot).
  - `_*.json`, `_*.txt` (completa el patrón que ya tenía `_*.md` y `_*.py`).
  - `scripts/check_*.py`, `scripts/count_*.py`, `scripts/find_*.py`, `scripts/query_*.py`, `scripts/replay_*.py` (patterns claros de investigation ad-hoc).
  - Verificación post-cambio: `git status` bajó de 13 archivos untracked a 0.

- **`scripts/README.md` nuevo**: matriz de ~50 scripts Python categorizados en 5 grupos:
  - 🟢 ACTIVOS (3): `sync_sap_to_firestore.py`, `sync_sap_to_bigquery.py`, `send_rendiciones_email.py` (los 3 cronjobs de prod).
  - 🟡 BOOTSTRAP/DEPLOY (10): `apply_v_*.py`, `deploy_inventario_views.py`, `bootstrap_targets_to_bigquery.py`, etc.
  - 🟠 AUDIT/VERIFY (5): `audit_targets.py`, `verify_*`, `smoke_*`.
  - 🔵 BUILD DOCS (2): `build_manual_shimano.py`, `build_mejoras_shimano.py`.
  - ⚪ LEGACY one-shot (18): documentados como "mantener por historial pero NO ejecutar de nuevo" (ej: `bulk_fix_provincia_localidad_from_excel.py`, `migrate_rendiciones_foto_to_storage.py`, `patch_paid_to_date.py`).
  - Convención nueva documentada: prefix `check_/count_/find_/query_/replay_` = automáticamente gitignored.

- **`.github/workflows/test-and-lint.yml` nuevo**:
  - Triggers: `pull_request` a `main` + `push` a `main`/`dev` + `workflow_dispatch`.
  - Steps: `checkout` → `setup-node@v4 node 20 + npm cache` → `npm ci` → `npm run typecheck` → `npm run test:unit` → `npm run test:smoke`.
  - `timeout-minutes: 5`, `concurrency cancel-in-progress` (evita gastar minutos en versiones viejas del mismo PR).
  - NO corre `test:rules` ni `test:functions` (requieren firebase-emulator + Java 21, agregan ~2 min de setup por corrida — se dejan para el smoke local pre-PR).
  - NO reemplaza el smoke E2E manual antes del squash-merge; SÍ garantiza que ningún test roto llegue a main jamás.

**Alcance**:
- `.gitignore` (+31 líneas de patterns + comentarios).
- `scripts/README.md` (nuevo, ~90 líneas de matriz + convención).
- `.github/workflows/test-and-lint.yml` (nuevo, ~50 líneas).
- `README.md` — bump SW v378 → v379, tabla APP_VERSION actualizada, entrada §41.
- **Bundle SIN cambios** — no se tocó `src/**`, no se regenera `app.bundle.js`. Los bumps de `APP_VERSION`/`CACHE_VERSION` son sólo para respetar la convención "cualquier cambio del repo" del feedback.

**TODO cerrado en v381**: la activación pendiente de branch protection en `main` (que se dejó como TODO explícito en v379) se completó el **2026-08-02 post-v380**. Detalle completo en **§34.1** (config exacta + snippet de re-activación + escape hatch para emergencias). Los checks del workflow `test-and-lint` son ahora **obligatorios** — un CI rojo bloquea el squash-merge.

**Tests**: 193/193 verdes locales antes de commitear, mismo suite que ahora corre en CI en cada PR.

### v378 (2026-08-02) — Estado SAP del pedido en cards CONFIRMADOS (OFERTA → ORDEN → FACTURADO → COBRADO / CERRADO)

**Feature pedida por Mariano**: cuando el vendedor abre la pestaña PEDIDOS → CONFIRMADOS, quiere ver en qué instancia del flujo SAP está cada uno de sus pedidos, sin tener que preguntarle al admin. Ahora cada card muestra un badge de color con el estado actual, actualizado cada 30 min desde el cron BQ.

**Estados posibles**:

| Estado | Color | Significado |
|---|---|---|
| `OFERTA_VENTA` | 🟠 Naranja | SQ abierta (`bost_Open`), sin SO copiada aún — admin todavía no la procesó. |
| `ORDEN_VENTA` | 🔵 Azul | SO creada a partir de la SQ, sin factura aún — está en logística. |
| `FACTURADO` | 🟣 Violeta | Invoice creada con `paid_to_date = 0` — pendiente de cobro. |
| `COBRADO_PARCIAL` | 🟧 Naranja intenso | Invoice con `0 < paid < total`. El badge muestra `%` cobrado (ej: "Estado: COBRADO PARCIAL (35%)"). |
| `COBRADO_COMPLETO` | 🟢 Verde | Invoice con `paid ≥ total` — flujo cerrado exitosamente. |
| `CERRADO` | ⚪ Gris | SQ cancelada (`Cancelled=tYES`) o cerrada (`bost_Close`) sin llegar a SO — cliente no confirmó, se venció o admin la anuló. |

Cuando el pedido tiene `transferidoSAP.docNum` pero aún no llegó el snapshot BQ (primera media hora post-transferencia), el badge muestra "Estado: aguardando snapshot SAP" en gris chico.

**Cambios técnicos**:

1. `scripts/sync_sap_to_bigquery.py`:
   - Nueva fn `sync_pedido_estados_to_firestore(bq_client, db)` que corre al final del `main()` (paso 10, después del snapshot Dashboard v367). Fault-tolerant con try/except.
   - Query BQ con 4 CTEs: `sq_base` (SQ del último año), `so_to_sq` (SO linkeadas via `JSON_QUERY_ARRAY(lines_json)` + `BaseType='17'` + `BaseEntry`), `inv_to_so` (Invoices linkeadas a SOs), `sq_agg` (JOIN + `CASE` para derivar el estado macro).
   - Escribe a `pedidos/{firestoreId}.sapEstado` + `sapEstadoDetalles: {sqDocEntry, sqDocNum, sqStatus, sqCancelled, soDocEntry, soDocNum, soStatus, invoiceDocEntry, invoiceDocNum, invoiceTotal, invoicePaidToDate, invoiceStatus}` + `sapEstadoUpdatedAt: SERVER_TIMESTAMP`.
   - Batch updates de 400 (max Firestore 500).

2. `index.html`:
   - Listeners `unsubPedidos` (own) y `unsubPedidosAll` (global) extendidos para leer `sapEstado` + `sapEstadoDetalles` + `sapEstadoUpdatedAt` del snapshot Firestore.
   - Nueva const `SAP_ESTADO_LABELS` (mapping estado → `{label visible, css class}`).
   - Nuevo helper `renderSapEstadoBadge(estado, detalles)` que devuelve el `<div>` del badge con el label ya formateado (incluye % cobrado para `COBRADO_PARCIAL`).
   - `renderConfirmadosList` agrega `renderSapEstadoBadge(it.conf.sapEstado, it.conf.sapEstadoDetalles)` al final de cada card, condicional a `transferidoSAP.docNum` seteado.
   - CSS `.confirmed-card .cc-sap-estado` con 7 clases (`est-oferta` naranja, `est-orden` azul, `est-facturado` violeta, `est-cobrado-parcial` naranja intenso, `est-cobrado-completo` verde, `est-cerrado` gris, `est-desconocido` gris chico).

3. `sw.js`: `CACHE_VERSION` v377 → v378.
4. `index.html`: `APP_VERSION` v377 → v378.
5. `firestore.rules`: **sin cambios** — el service account bypassa las Rules, y la lectura de `pedidos` ya la permitía el rol vendedor (`ownsDoc()`).

**Costo BQ**: 1 query extra por corrida del cron (~9s de latencia, 7.191 SQ del último año → ~5 MB scan → ~$0.00003 USD por corrida, negligible).

**Consistencia con Power BI**: mismo criterio de `document_status`/`cancelled`/`paid_to_date` que ya usa Power BI en las páginas Facturación y Backorder. Si Mariano ve "COBRADO_COMPLETO" en un pedido de la app, ese pedido también aparece con saldo 0 en el TABLERO SAR.

**Deploy 2026-08-02**: sync manual ejecutado post-merge. Resultados sobre los 5 pedidos confirmados actuales:
- `CASA EL DELFIN DESDE 1976 S. R. L.` (doc#2000010, 7/30) → OFERTA_VENTA (SQ abierta en SAP)
- `GUSTAVO EMILIO DESIATA` (doc#2000009, 7/28), `SEBASTIAN LUIS VILLARREAL` (doc#2000005, 7/27), `REBORN SRL` (doc#2000007, 7/27) → CERRADO (SQ canceladas por admin — patrón esperado durante la transición Baraldo → venta directa)

Cero unmatched (todos los pedidos con `docNum` matchearon a una SQ real en BQ).

### v377 (2026-08-02) — Stock Liberado en el alert de búsqueda de SKU (transito − backorder)

**Feature pedida por Mariano**: cuando un vendedor busca un SKU en el picker y toca el chip de stock, además de las líneas "DISPONIBLE venta" y "EN TRANSITO" existentes, mostrar dos líneas nuevas cuando hay backorder:
- **🔒 BACKORDER (reservado a clientes)**: sumatoria de `RemainingOpenQuantity` de todas las Sales Quotations `bost_Open` no canceladas para ese SKU.
- **🟢 STOCK LIBERADO (transito − backorder)**: `max(transito(whs 12) − backorder, 0)` — cuánto del tránsito NO está ya reservado y por lo tanto quedará libre cuando llegue la mercadería.

**Motivación** (ejemplo del user): "hay 180 unidades en tránsito pero hay backorder de 20 → el stock liberado es 160 unidades". Esto ayuda al vendedor a saber si vale la pena prometer entrega futura al cliente o si el tránsito ya está todo asignado.

**Cambios técnicos**:

1. `scripts/sync_sap_to_firestore.py`:
   - Nueva función `sl_fetch_backorder_by_sku(cfg, session)` que pagina `/b1s/v1/Quotations?$select=DocEntry,DocumentStatus,Cancelled,DocumentLines&$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'`, itera todas las líneas y agrega `RemainingOpenQuantity` por `ItemCode`. Fetch fault-tolerante: si SL falla o timeout, `backorder_map = {}` y la UI simplemente no muestra las 2 líneas (fallback al comportamiento pre-v377). No aborta el sync general.
   - `write_stock_snapshot` firma extendida: acepta `backorder_map` y persiste `backorderBySku` como JSON string (mismo patrón que `warehouseBreakdown` y `quantities`, para evitar el límite de 40k index entries de Firestore).
   - Main flow: llama al fetch de backorder antes de escribir el snapshot, dentro de try/except.

2. `index.html`:
   - Nueva global `let STOCK_BACKORDER = {}` junto a las otras vars de stock.
   - `ensureStockSnapshotListener` parsea `d.backorderBySku` (JSON string). Snapshot pre-v377 no lo tiene → queda `{}` y la UI hace fallback.
   - El alert que se dispara al tocar el chip de stock computa `backorder = STOCK_BACKORDER[k] || 0` y `liberado = max(transito − backorder, 0)`, agrega las 2 líneas nuevas SÓLO si `backorder > 0` (evita ruido para SKUs sin SQ abiertas).

3. `sw.js`: `CACHE_VERSION` v376 → v377.
4. `index.html`: `APP_VERSION` v376 → v377.

**Alcance snapshot Firestore**: el campo nuevo `backorderBySku` es aditivo — snapshots viejos siguen funcionando; la UI sólo agrega las líneas cuando el campo está presente y el SKU tiene backorder > 0.

**Costo estimado**: 1 fetch adicional a SL por corrida del cron (cada 30 min). Las SQ abiertas de Shimano rara vez pasan de ~2000 documentos → ~5 páginas de 400 docs, <10 seg extra al sync. Fault-tolerante: si SL rate-limita esta call, el resto del sync sigue OK.

**Consistencia con BQ**: el criterio "SQ open + Cancelled=tNO + RemainingOpenQuantity > 0" es el MISMO que usa la vista `v_backorder_lineas` en BigQuery (`bigquery/views.sql`), así el número que ve el vendedor en la app y el que ve el equipo comercial en Data Studio coinciden.

### v376 (2026-08-02) — Fix Dashboard: dropdown de vendedor visible también para rol `interno` (VDI)

**Bug reportado por Santiago Esteban** (screenshot 2026-08-02): al abrir el Dashboard + seleccionar "Julio 2026" en el selector nuevo de v374, todos los KPIs mostraban $0 / 0 unidades. Su rol es `interno` (VDI para Mauricio + Martin).

**Causa raíz**:

1. La lógica de render del `<select>` de vendedor en `dashboard.js:212` estaba limitada a `admin || viewer`.
2. Rol `interno` (VDI) **no tiene `assignedVendor` propio** (son VDI, no VDE — cubren a otros).
3. `dashboardVendorForTargets` computa así: `(userRole === 'vendedor') ? assignedVendor : (dashboardVendorFilter && dashboardVendorFilter !== 'ALL' ? dashboardVendorFilter : null)`. Para interno con `dashboardVendorFilter='ALL'` (default) → devuelve `null`.
4. Las cards "SAP · Mes en curso" y "SAP · Acumulado anual" **solo se muestran si `dashboardVendorForTargets` es truthy**.
5. **Resultado**: Santiago NO veía el dropdown para elegir un vendor, NO tenía `assignedVendor` propio, y las cards SAP nunca aparecían — todo en $0 aunque hubiera facturación real de sus VDEs pareja.

**Fix** (`src/domains/dashboard.js:212`):
- Extender condición del render del `<select>` a `admin || viewer || interno`.
- Para `interno`, filtrar opciones con `getMyAllowedVendorKeys()` (helper global del inline, ya existente):
  - Santiago → `Set(['MAURICIO GIL', 'MARTIN BOIERO'])`.
  - Ioannis → `Set(['FEDERICO CASTELANELLI', 'GONZALO DE LA ROSA'])`.
- Label del "Todos" cambia según rol: para interno dice `"Todas mis parejas (sumado)"` en vez de `"Todos los vendedores (sumado)"` — más natural.
- Cuando el interno elige un VDE específico → `dashboardVendorForTargets` queda con esa key → cards SAP se activan con la data real del snapshot (`sap_snapshot/MAURICIO_GIL_2026_07`, etc.).

**Cero cambios adicionales**: la lógica del selector de mes de v374 sigue funcionando igual, la data ya está en `sap_snapshot` desde v367 sub-c, y `getMyAllowedVendorKeys()` ya se usaba en varios otros lugares del inline (mapa, filtros de zonas, seguimiento).

**Aprendizaje** (candidato regla #22 CLAUDE.md):

> Al agregar features nuevas que dependan de un dropdown de vendedor, chequear que la condición de render cubra los 3 roles con visibilidad amplia: `admin`, `viewer`, **`interno`**. El rol interno tiene UI + data particulares (parejas VDE) que se olvidan porque son minoría numérica (2 de 6 vendedores).

Alcance:
- `src/domains/dashboard.js` — 1 bloque `if` extendido de 2 roles a 3 + filtro por `getMyAllowedVendorKeys()` + label dinámico.
- `app.bundle.js` regenerado.
- `APP_VERSION` v374 → v376 (skip v375 que fue backend Functions only, sin bump frontend).
- `CACHE_VERSION` v374 → v376.

Tests: 193/193 verdes.

### v375 (2026-08-02) — Fix Dependabot HIGH: `fast-xml-parser` 5.9.x → 5.10.1

**Alerta Dependabot HIGH** (GHSA-8r6m-32jq-jx6q): `fast-xml-parser: Repeated DOCTYPE declarations reset entity expansion limits`. Vulnerabilidad de **denial-of-service** (billion laughs attack variant) que permite consumo infinito de memoria/CPU al parsear XML malicioso.

**Ubicación**: `functions/package-lock.json` — dependencia transitiva vía Firebase SDK. **No en el bundle del frontend** (los vendedores nunca la ven).

**Riesgo real pre-fix**: **prácticamente cero**. Las 2 Cloud Functions actuales (`dailyFirestoreBackup` y `sapProxy`) no procesan XML de fuentes externas:
- `dailyFirestoreBackup` — cron interno, sin input externo.
- `sapProxy` — recibe JSON del browser y hace HTTP proxy a SAP Service Layer, no parsea XML.

**Por qué se cerró igual**: higiene de seguridad + preventivo (si mañana se agrega una Function que sí procese XML, ya queda cubierta) + baja las alertas Dependabot abiertas de 9 → 8 (deja las 8 moderate transitivas conocidas que requieren `--force` con breaking changes — política aceptada).

**Fix**: `cd functions && npm audit fix`. Bump minor `5.9.x → 5.10.1` sin cambios de API pública. Cleanup transitivo natural: `-118 líneas / +53` en `package-lock.json` por dedup.

**Verificación**:
- Tests functions: **37/37** verdes (`sapProxy` + `dailyFirestoreBackup`).
- Suite full: **230/230** verdes.
- `npm audit`: **9 vulns → 8** (1 HIGH resuelta, 8 moderate transitivas se mantienen).

**Deploy**: `firebase deploy --only functions --project=app-vendedores-shimano` (requiere autorización explícita del user). El fix está en el repo, pero las Cloud Functions en prod siguen con `fast-xml-parser` 5.9.x hasta el próximo deploy manual.

**Sin bump de `APP_VERSION`**: es backend Functions, no cambia el HTML/JS del bundle. Los usuarios frontend no ven diferencia.

### v374 (2026-08-02) — Selector de mes en Dashboard de ventas

**Pedido de vendedores** (Santiago Esteban + otros VDIs/VDEs): el modal Dashboard mostraba fijo "MES EN CURSO" con el mes actual, sin forma de ver rendimiento histórico ("¿cómo me fue en junio?"). Feature simple pero muy pedida.

**Implementación**:

1. **Nuevo state global** en `src/domains/dashboard.js`:
   ```js
   let dashboardSelectedMonth = null;   // null = default mes actual
   window.setDashboardMonth = function(v){
     dashboardSelectedMonth = (v && v !== 'current') ? v : null;
     renderDashboard();
   };
   ```

2. **UI del selector** (ámbar, visible para todos los roles): dropdown con `"Agosto 2026 (mes actual)"` como default + últimos 11 meses anteriores generados dinámicamente. Se inserta después del filtro de vendedor.

3. **Al inicio de `renderDashboard()`** se computa el mes a mostrar:
   ```js
   let selYear = now.getFullYear(), selMonthIdx = now.getMonth();
   if (dashboardSelectedMonth && /^\d{4}-\d{2}$/.test(dashboardSelectedMonth)) {
     const parts = dashboardSelectedMonth.split('-');
     selYear = parseInt(parts[0], 10);
     selMonthIdx = parseInt(parts[1], 10) - 1;
   }
   const isCurrentMonth = (selYear === now.getFullYear() && selMonthIdx === now.getMonth());
   const ymPrefix = selYear + '-' + String(selMonthIdx + 1).padStart(2, '0');
   ```

4. **El selector afecta 4 cosas** (todo en el bloque MES):
   - Card **"Mes en curso · pedidos de la app"** — filtro por `confirmed_at.startsWith(ymPrefix)`.
   - Card **"SAP · Mes en curso"** — busca `sap_snapshot/{vendor_norm}_{selYear}_{MM}`.
   - **Target mensual** — `getMonthlyTargetArs(vendor, selYear, selMonthIdx)`.
   - **Dashboard consolidado admin** (ranking equipo) — items map + visitas del mes + resumen equipo.

5. **`isCurrentMonth` cambia labels**: cuando el user selecciona un mes distinto al actual, título pasa de `"Mes en curso"` → `"Mes de JULIO"`. En el consolidado admin agrega `(mes seleccionado)` al lado del `MES YYYY`.

6. **NO se afecta** el bloque **"Acumulado anual"** (queda YTD del año actual siempre). Diseño intencional: mezclar "Julio 2025" con "2026 YTD" sería confuso. El acumulado siempre habla del año en curso.

**Escala de opciones**: 12 meses (mes actual + 11 anteriores). Después de eso el snapshot SAP puede no tener data (el cron solo pobla el año actual). Si el user selecciona un mes de año pasado con snapshot vacío, la card SAP dice "Sin datos SAP para ese mes" — no rompe.

**Sin cambios en backend** — todo con la data que ya tenemos en `confirmed` (pedidos app) y `sap_snapshot` (facturado SAP). Nada nuevo en Firestore ni en BQ.

**Retrocompat**: si el user no toca el selector, `dashboardSelectedMonth = null` y todo funciona igual que v373. Comportamiento default preservado.

Alcance:
- `src/domains/dashboard.js` — nueva var + handler + UI del selector + reemplazo de `now.getMonth()/getFullYear()` por `selMonthIdx/selYear` en 6 lugares del bloque MES + consolidado.
- `app.bundle.js` regenerado.
- `APP_VERSION` v372 → v374, `CACHE_VERSION` v372 → v374 (skip v373 porque no bumpea APP — solo cambió backend BQ).

### v373 (2026-08-02) — Fix `sync_campaigns` limpia BQ cuando Firestore queda vacía (POWER PRO zombie)

**Bug reportado** — hallado durante el smoke E2E del dataset v371 (`smoke_v371_dataset.py`):

```
Firestore campaigns:  0 docs  (Pablo borró POWER PRO desde la app)
BQ campaigns_raw:     1 doc   (POWER PRO todavía presente, campaign_id 6w4JqjWXQ2SBOCyob)
```

**Impacto**: el TABLERO SAR seguía mostrando POWER PRO en las 3 vistas derivadas (`v_campanias_progreso`, `v_campanias_evolucion_diaria`, `v_campanias_ventas_detalle`). Cualquier caso E de la matriz ML también arrastraba el zombie.

**Causa raíz** — `scripts/sync_sap_to_bigquery.py:809` (`_load_to_bq_with_schema`):

```python
if not rows:
    log(f'[BQ/{entity_name}] 0 rows, nada que cargar')
    return   # ← Early return SIN WRITE_TRUNCATE
```

Cuando Firestore devuelve 0 campañas, el loader hace **early return** sin tocar BQ → la tabla queda con el snapshot anterior indefinidamente. Este comportamiento era **correcto** para `sap_bp_raw`/`sap_items_raw`/`targets_raw` (0 rows casi siempre es un bug de sync SAP, no un delete legítimo — mejor conservar data stale hasta que un humano investigue) pero es **incorrecto** para `campaigns` donde borrar la última campaña activa es un flujo válido operativo.

**Fix** — parametrizar el comportamiento por caller:

1. **`_load_to_bq_with_schema` acepta `truncate_on_empty=False`** (default preserva comportamiento anterior para las tablas SAP + targets).
2. Cuando `rows=[]` **Y** `truncate_on_empty=True`, ejecuta `TRUNCATE TABLE <ref>` explícito → BQ refleja el estado real de la fuente.
3. **`campaigns` caller pasa `truncate_on_empty=True`** — semántica correcta: la tabla debe reflejar Firestore, no un histórico.
4. Todos los demás callers (SAP raw + targets) sin cambio.

**Docstring nueva** documenta explícitamente ambos casos:
- `truncate_on_empty=True`: `campaigns_raw` (delete legítimo desde la app).
- `truncate_on_empty=False` (default): `sap_*_raw`, `targets_raw` (0 rows = probable bug de sync).

**Bootstrap manual** para limpiar el zombie YA sin esperar el próximo cron: `python scripts/apply_v_campanias.py` (helper actualizado con el mismo flag).

**Efecto cascada** — todas las vistas derivadas se actualizan sin cambios:
- `v_campanias_progreso` → 0 filas.
- `v_campanias_evolucion_diaria` → 0 filas.
- `v_campanias_ventas_detalle` → 0 filas.
- TABLERO SAR hoja "Campañas" → limpia al próximo refresh.

**Regla derivada** (candidata a #21 CLAUDE.md):

> Cuando un sync source→sink puede tener 0 rows como estado válido (delete legítimo), el loader debe soportar TRUNCATE explícito. Cuando 0 rows es siempre indicativo de bug de sync (SAP down, network), mejor conservar snapshot anterior. La decisión es del caller, no del helper. Parametrizarlo con flag explícito.

Alcance:
- `scripts/sync_sap_to_bigquery.py` — `_load_to_bq_with_schema` acepta `truncate_on_empty` (~15 líneas nuevas). Caller de `campaigns` con flag=True.
- `scripts/apply_v_campanias.py` — mismo flag para bootstrap manual.
- **NO se toca**: app, tests, rules, vistas BQ. Fix backend puro.
- Sin bump `APP_VERSION` (no cambia código de la app).

### v372 (2026-08-02) — Hotfix v371: wrapper defensivo del botón Exportar + cache invalidation forzada

**Bug reportado por Sentry** (2026-08-02 14:31 AR, release=v371, iPhone iOS 18.7 + Mobile Safari 26.5, environment=production):

```
ReferenceError: Can't find variable: openExportFormatModal
at onclick (/app-vendedores/:1652:22)
```

**Causa raíz** — **mismatch shell/chunk** (patrón conocido documentado en el fix v335 del SW stale-while-revalidate):
- El SW sirvió el HTML v371 desde cache (con `onclick="openExportFormatModal()"`).
- El `app.bundle.js` en cache era todavía v370 (SIN los stubs `openExportFormatModal`/`closeExportFormatModal`/`exportDatasetZip` que agregué en v371 a `installChunkStubs('exports-advanced', [...])`).
- Usuario toca el botón → función no existe en `window` → `ReferenceError` propaga como `onerror` → Sentry.

**Por qué no lo cubrió v335**: stale-while-revalidate funciona bien en desktop porque el `activate` del SW purga cache rápido. En **iOS Safari con PWA standalone** puede haber una ventana de segundos/minutos donde el shell nuevo convive con chunks viejos hasta que Safari decide activar el SW nuevo.

**Fix aditivo** (sin tocar la lógica del bundle):

1. **`onclick` del botón pasa de directo a wrapper**: `onclick="openExportFormatModal()"` → `onclick="_safeOpenExportFormatModal()"`.
2. **`_safeOpenExportFormatModal` definido en el `<script>` del HEAD** de `index.html` (línea ~3355, junto al `APP_VERSION`). Vive en el HTML inline, NO en el bundle. Garantiza que existe en cualquier versión del HTML sin depender del bundle:
   - Si `window.openExportFormatModal` es function → llama directo.
   - Si no existe pero `window.loadChunk` sí (bundle cargó parcialmente o los stubs no se instalaron) → fuerza `loadChunk('exports-advanced')` y post-load llama la función real.
   - Si `loadChunk` tampoco existe (bundle no cargó nada) → alert claro pidiendo Ctrl+Shift+R (desktop) o cerrar + abrir la PWA (mobile).
3. **Bump `CACHE_VERSION` v371→v372**: dispara `activate` del SW en todos los usuarios al próximo load → cache viejo purgado → el bundle nuevo (con stubs OK) llega garantizado.

**Aprendizaje capturado** (agregar a CLAUDE.md eventualmente como regla #21):

> Cuando agregás funciones nuevas al bundle que van a chunks lazy Y agregás su `onclick` directo en HTML inline, envolvé el onclick en un wrapper defensivo definido en el HTML inline. El motivo es que el HTML puede llegar a producción antes que el bundle (SW cache mismatch), y el `onclick` directo tira `ReferenceError` sin degradación. El wrapper inline sobrevive a cualquier estado del bundle.

Alcance:
- `index.html` — 1 línea del `<button>` (nuevo `onclick`) + 24 líneas de definición del wrapper `_safeOpenExportFormatModal` en el `<script>` del HEAD.
- `sw.js` — bump `CACHE_VERSION` v371→v372.
- **NO se toca**: bundle, chunks, tests, rules, config. Fix mínimo.

Sin nuevos tests (el fix es defensivo puro del wrapper, no cambia el flujo happy path).

### v371 (2026-08-02) — Export dataset ZIP para pipelines de ML externos (Fabric / Databricks / Python)

**Pedido de Mariano** (Shimano data scientist): alimentar pipelines de ML externos en Microsoft Fabric con datasets limpios y estables. La app tenía "Exportar a Excel" para uso operativo pero no un dataset crudo apto para modelado. 5 casos de uso downstream priorizados:
- **A. Conversión visita→pedido** (clasificación, prio 1): predecir qué visitas terminan en pedido para priorizar rutas.
- **B. Riesgo de churn de clientes** (prio 2): detectar cuentas enfriándose.
- **C. Forecast de demanda por SKU** (series temporales, prio 3).
- **D. Anomalías en rendiciones** (exploratorio).
- **E. Estacionalidad por zona/campaña** (exploratorio).

**Diseño**:

- El botón "Exportar a Excel" ahora dispara un **modal chico dispatcher** (`#export-format-modal`) con 2 tarjetas:
  - **Reportes Excel** — `exportToExcel()` existente, todos los roles.
  - **Dataset para análisis (ZIP)** — `exportDatasetZip()` nueva, solo admin/gerente (guard en `openExportFormatModal`).
- Progress bar en el modal (~10-30 seg de ejecución).

**Estructura del ZIP** `shimano-dataset-YYYY-MM-DDTHH-MM-SSZ.zip`:

```
├── pedidos.csv          # 1 fila por (pedido × línea) — desnormalizado
├── visitas.csv          # 1 fila por visita/contacto
├── clientes.csv         # 1 fila por client_application
├── client_master.csv    # 1 fila por doc (direcciones curadas admin)
├── rendiciones.csv      # 1 fila por rendición (sin fotoTicket base64)
├── campanias.csv        # 1 fila por campaña
├── targets.csv          # 1 fila por (vendedor, año, mes)
├── productos.csv        # 1 fila por SKU (desde stock.json con warehouseBreakdown v369+)
├── vendor_overrides.csv # 1 fila por reasignación
├── custom_routes.csv    # 1 fila por (ruta × stop) — desnormalizado
├── seguimiento_notes.csv# 1 fila por nota interna
└── manifest.json        # schema + useCaseMatrix + rowCounts + nullRates + limitations
```

**Convenciones CSV** (RFC 4180 + adaptaciones para ML):
- Encoding UTF-8, separador `,`, quote `"`, escape `""`, line terminator `\r\n`.
- Fechas Firestore Timestamp → ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SS.sssZ`).
- Decimales con punto `.`.
- Null / undefined → **campo vacío** (nunca `"N/A"`, `"-"`, `"null"`).
- Arrays y objetos anidados → `JSON.stringify` (útil para `skus[]` en campañas).
- Firestore Timestamps detectados por presencia de `.toDate()`.
- `NaN` / `Infinity` → campo vacío (no romper pipelines downstream).

**Manifest.json**: bloque `useCaseMatrix` documenta explícitamente qué caso funciona y con qué tasa de nulls por campo requerido. Si un caso queda **incompleto** por datos ausentes en el origen (no por bug), se marca `"status": "PARTIAL"` o `"EMPTY"` con `"limitations": [...]` explícitas — no se silencia. `nullRateByField` computed sobre cada CSV real (no sobre el schema).

**Gaps documentados** en la matriz (van a `limitations`):
- Casos A/B: convención de cliente inconsistente entre `visits`/`pedidos` (`key` compuesto) vs `client_applications` (`cardCodeSap`). El pipeline downstream debe hacer match difuso o normalizar antes.
- Caso C: descuento aplicado a nivel pedido header (`discount_pct`), no por línea. El pipeline debe prorratear proporcional al subtotal bruto.

**Exclusiones** (documentadas en `manifest.exclusions`):
- Colecciones sensibles: `roles` (pinHash, totpSecret), `app_config/*` (creds SAP, API keys Gemini), `sap_snapshot` (deriva de BQ), `notifications`/`operations_log` (volumen alto sin uso ML).
- Campos base64: `visits.frenteLocal/espacio[]`, `client_applications.constanciaArca/IIBB/fotosLocal[]`, `rendiciones.fotoTicket` (pre-v308 legacy).

**Escala** (verificado con `count.get()` 2026-08-02):
- Pedidos: 9 · Visits: 187 · Clientes: 558 · Master: 105 · Rendiciones: 87 · Campañas: 1 · Targets: 6 · Overrides: 365 · Custom routes: 4 · Seguimiento notes: 0 · Productos (stock.json): ~757.
- **Total: ~1.322 filas exportables**. Cabe todo en memoria — sin paginación. Lecturas Firestore facturadas: ~1.322 por corrida (~$0.00001 USD, despreciable).

**Robustez** (riesgos de falso verde cubiertos por tests):
- CSV con columnas corridas por comas → **test específico** con round-trip via papaparse verifica que cliente `"Pesca, Total SA"` no rompe columnas.
- Export parcial silencioso → si CUALQUIER `.get()` de Firestore rechaza, `Promise.allSettled` detecta y aborta con `alert` + no descarga (nunca ZIP parcial). Solo `stock.json` puede fallar sin bloquear (productos.csv queda vacío con warning).
- Campos presentes pero vacíos → `nullRateByField` computed real por CSV, `useCaseMatrix.status` marca `PARTIAL` si algún campo requerido tiene `>50%` nulls.
- Fotos base64 legacy → **test específico** verifica que la exportación de `rendiciones.csv` NO contiene la substring `base64` ni el largo string binario.
- Datos sensibles → `roles` y `app_config` **no están en los 11 CSVs** por construcción (hardcoded en el dispatcher).

**Files nuevos/modificados**:
| Path | Tipo | Notas |
|---|---|---|
| `src/pure/csv-serializer.js` | Nuevo | Helpers puros + `DATASET_SCHEMAS` + `DATASET_USE_CASE_MATRIX` + row builders (~870 LOC) |
| `src/domains/exports-advanced.js` | Editar | Import de csv-serializer + `exportDatasetZip()` + `openExportFormatModal()` + `closeExportFormatModal()` (+200 LOC). Chunk lazy `chunks/exports-advanced.js` pasa de 91 KB → 228 KB |
| `index.html` | Editar | Modal `#export-format-modal` con 2 tarjetas + progress bar. Botón "Exportar a Excel" cambia `onclick` a `openExportFormatModal()` |
| `build.js` + `src/main.js` | Editar | Agregar 3 funciones nuevas al chunk `exports-advanced` (regla CLAUDE.md #18: 3 archivos sincronizados) |
| `tests/unit/csv-serializer.test.js` | Nuevo | 62 tests unit del serializer (casos borde: nulls, comas, quotes, saltos, Timestamps, decimales, arrays, objetos, PII, escape end-to-end) |
| `tests/unit/dataset-export-integration.test.js` | Nuevo | 25 tests integración con seed representativa: pipeline end-to-end, joins entre tablas, casos A-E, rendiciones legacy sin base64 |
| `package.json` | Editar | Agregar `papaparse` como devDep (parser CSV independiente para round-trip en tests) |
| `firestore.rules` | **NO se toca** | admin/gerente ya podían listar todas las colecciones exportables |
| `sw.js` | Editar | Bump `CACHE_VERSION` v370 → v371 |

Total suite post-v371: **193 tests verdes** (168 previos + 25 nuevos de integración). Typecheck: sin errores.

**Uso operativo** (para admin/gerente):
1. Click botón "Exportar a Excel" (barra superior derecha).
2. En el modal, elegir "Dataset para análisis (ZIP)".
3. Esperar ~10-30 seg (progress bar).
4. Se descarga automático `shimano-dataset-<timestamp>.zip`.
5. Descomprimir. Abrir `manifest.json` primero para ver schemas + calidad por caso.
6. Cargar cada CSV en Fabric / pandas con `read_csv(encoding='utf-8')`.

### v370 (2026-07-31) — Split pedido usa disponible venta (whs 11) + picker con estado ámbar para tránsito

**Extensión del fix v369**: la infraestructura del `warehouseBreakdown` estaba lista, pero el split de v347 en `confirmExcelPedido` seguía usando `getStockQty` (total todos los warehouses vendibles) para decidir cuántas unidades marcaba como SIN STOCK. Resultado: SKUs como `SN2000FG` con `0 en whs 11 + 180 en whs 12` se marcaban como "180 disponibles" y solo si el vendedor pedía más de 180 aparecía el rojo — mentira, no había 180 disponibles, había 180 en tránsito.

**Cambios**:

1. **2 helpers nuevos** en `index.html` (junto a `getStockQty`):
   - `getStockDisponibleVenta(sku)` → retorna `STOCK_WAREHOUSE_BREAKDOWN[sku]['11']` (Mercadería NUR PESCA, vendible ahora). Fallback: si el SKU no tiene breakdown (snapshot pre-v369), retorna `getStockQty` — mejor tener aprox que null.
   - `getStockTransito(sku)` → retorna `STOCK_WAREHOUSE_BREAKDOWN[sku]['12']` (En tránsito PESCA).

2. **Split de v347 en `confirmExcelPedido`** ahora usa `getStockDisponibleVenta` en vez de `getStockQty`. Nueva var `transitoQty` se adjunta a cada `outLine` cuando hay unidades en whs 12 → preserva la info para el render.

3. **Preview de pedido confirmado** (`renderConfirmedPedido` ~línea 10011): líneas con `sinStock=true` que además tienen `transitoQty>0` muestran badge extra ámbar `🚚 N EN TRANSITO` al lado del rojo `SIN STOCK`. Signal para el vendedor: "el backorder no es sin fecha, hay mercadería en camino".

4. **Product picker** (`src/domains/product-picker.js:144+`): nuevo estado ámbar del `stock-dot`:
   - 🟢 Verde: `disp > 0` (hay disponible venta whs 11).
   - 🟠 Ámbar (nuevo): `disp === 0 && trans > 0` (solo tránsito, se puede vender como backorder con fecha estimada).
   - 🔴 Rojo: `disp === 0 && trans === 0` (sin stock en ningún warehouse vendible).
   - ⚫ Gris: sin datos.

   Tooltip enriquecido: `"Disponible venta (dep. 11): 20 uds + 180 en tránsito"`.

**Retrocompat**: pedidos pre-v370 sin `transitoQty` en las líneas no rompen (chequeo `l.transitoQty && > 0` antes de mostrar badge). SKUs con snapshot pre-v369 sin `warehouseBreakdown` caen al fallback `getStockQty`.

Alcance:
- `index.html` — 2 helpers nuevos + fix del split + badge tránsito en preview.
- `src/domains/product-picker.js` — 4 estados del stock-dot + tooltip enriquecido.
- `app.bundle.js` regenerado.
- `APP_VERSION` v369 → v370, `CACHE_VERSION` v369 → v370.

### v369 (2026-07-31) — Stock por warehouse: separar Disponible venta (11) vs Tránsito (12)

**Bug reportado por Mariano** al buscar el SKU `SN2000FG` en el Master de Productos → botón STOCK:

- App decía: *"Total vendible: 180 unidades"*.
- SAP decía: 180 unidades **todas en almacén 12 (Mercadería en TRANSITO PESCA)**, 0 unidades en almacén 11 (Mercadería NUR PESCA = disponible venta).

El vendedor tomaba la app como fuente de verdad y pensaba que podía vender 180 unidades hoy cuando en realidad no había nada disponible — todo era mercadería en camino (backorder futuro).

**Causa raíz**: `scripts/sync_sap_to_firestore.py:312-322` sumaba `InStock` de TODOS los warehouses del `ItemWarehouseInfoCollection` que no estuvieran en `NON_SALES_WHS = {'05', '06'}` (Marketing y Devoluciones). Esos warehouses "vendibles" incluían tanto 11 (real disponible) como 12 (tránsito) → total falso. El desglose por warehouse se perdía.

**Fix backend** (`scripts/sync_sap_to_firestore.py`):

1. Nueva variable `whs_map = {sku: {whs_code: int}}` construida en el mismo bucle del fetch (línea 312+). Solo se guarda si el SKU tiene al menos 1 warehouse con stock > 0.
2. `sl_fetch_items_and_stock()` retorna `whs_map` como campo nuevo.
3. `write_stock_snapshot()` acepta `whs_map` y lo escribe como `warehouseBreakdown` (JSON string, mismo patrón que `quantities` para no romper el límite de 40k index entries de Firestore).

**Fix frontend** (`index.html`):

1. Nueva variable global `STOCK_WAREHOUSE_BREAKDOWN = {}` parseada del snapshot en `ensureStockSnapshotListener` (línea 12478+). Fallback a `{}` si el snapshot es pre-v369.
2. El alert de stock (`checkStock` ~línea 12298) ahora muestra:
   ```
   ✅ DISPONIBLE venta (dep. 11): 0 unidades
   🚚 EN TRANSITO (dep. 12): 180 unidades
   🔒 BACKORDER (reservado a clientes): 20 unidades       ← v377+
   🟢 STOCK LIBERADO (transito - backorder): 160 unidades ← v377+
   ──────────────
   Total: 180 unidades
   ```
   Las 2 líneas de backorder / stock liberado se muestran SOLO si `STOCK_BACKORDER[sku] > 0`. Si el SKU tiene stock en otros warehouses (98 Cuarentena, etc.) → línea extra `⚠️ Otros almacenes: N unidades (98:N)`.

**Convención warehouses SAP PESCA** (hardcoded según estructura observada):
- `11` Mercadería NUR PESCA — **disponible para venta ahora**.
- `12` Mercadería en TRANSITO PESCA — **va a entrar, sirve para backorder**.
- `98` Cuarentena PESCA — bloqueado (no vendible aún).
- `01/03/04/07` Andreani / Zona franca / EEUU / Pesca EEUU — otros (no aplican típicamente al stock vendible de pesca).

**Deploy 2026-07-31**: sync manual ejecutado tras el bump — 442 SKUs con `warehouseBreakdown` poblado. Verificación en Firestore: `SN2000FG: {"12": 180}` confirmado (0 en almacén 11, 180 en 12). Cron GH Actions cada 30 min lo mantiene fresco.

Alcance:
- `scripts/sync_sap_to_firestore.py` — `whs_map` en fetch + `warehouseBreakdown` en escritura.
- `index.html` — global var + parse en listener + fix del alert de stock.
- `APP_VERSION` v368 → v369, `CACHE_VERSION` v368 → v369.

**Regla derivada**: cuando se sincroniza data agregada de un sistema origen (SAP → Firestore), guardar SIEMPRE el desglose crudo si es plausible que las UI consumidoras necesiten discriminar dimensiones más adelante. Un total sin desglose es información perdida sin backfill posible sin re-fetch.

### v368 (2026-07-30) — Fix Dashboard consolidado admin: ranking usa `sap_snapshot`

**Bug reportado por Mariano al abrir el Dashboard como admin con filtro "Todos los vendedores (sumado)"**: todas las cards del ranking mostraban `$0 / $57M` y `0% cumplimiento` aunque en Power BI Gonzalo marcaba `$110M` y `152%`. El F12 console confirmaba que la app cargó v367 OK — el bug era de lógica de render, no de despliegue.

**Causa**: en v367 sub-c agregué las 2 cards SAP nuevas (`SAP · Mes en curso` y `SAP · Acumulado anual`) SOLO cuando hay vendedor específico seleccionado. El bloque del ranking consolidado admin (`dashboard.js:~194` post-E2.h) sigue usando `byV[v].money` calculado desde `confirmed` (pedidos que los vendedores cargan en la app). Durante la transición Baraldo → venta directa, los vendedores casi no cargan pedidos en la app porque los pedidos reales entran directo a SAP → `byV[v].money = 0` para todos → ranking con puros ceros.

**Fix** (aditivo, sin romper el fallback):

1. Cada `item` del ranking (línea 225+) ahora computa:
   ```js
   const sapSnap = getSapSnapshotFor(v.key, now.getFullYear(), now.getMonth());
   const facSap = sapSnap ? Number(sapSnap.facturadoArsNeto || 0) : 0;
   const moneyForRank = sapSnap ? facSap : s.money;  // SAP prioridad, pedidos app fallback
   ```

2. Totales del equipo (`teamMoney`, `teamUnits`) priorizan SAP cuando hay snapshot.

3. Cada card individual del ranking muestra `fmtMoney(it.moneyForRank)` en la barra + monto, con badge chico a la derecha:
   - `SAP` (celeste `#0284c7`) si el número vino del snapshot.
   - `pedidos app` (gris `#94a3b8`) si cayó al fallback.

4. Footer del bloque "Resumen equipo" agrega la línea `"N/6 con facturado SAP este mes"` (usa `vendorsConSap = items.filter(i => i.hasSap).length`) → visibilidad rápida de la cobertura del snapshot.

5. Unidades del equipo también priorizan `unidSap` cuando hay datos SAP; caen a `units` (pedidos app) sino.

**Sin cambios en la vista de vendedor específico** — las 2 cards SAP de v367 sub-c siguen apareciendo iguales al filtrar por un vendedor.

**Post-deploy 2026-07-30**: al abrir Dashboard admin con "Todos", ranking muestra ordenado por % cumplimiento real SAP (Gonzalo `$110.2M / 193%`, Federico `$110.9M / 163%`, etc.) — matchea el card "Cumplimiento mensual" del Tablero SAR PBI. Footer confirma "6/6 con facturado SAP este mes".

Alcance:
- `src/domains/dashboard.js` — 3 bloques modificados en el consolidado admin (items map, teamMoney, render del ranking).
- `app.bundle.js` regenerado con esbuild.
- `APP_VERSION` v367 → v368, `CACHE_VERSION` v367 → v368.

**Regla derivada**: cuando agregás una fuente de datos nueva a una UI con 2 renderers distintos (vista consolidada vs vista de detalle), auditar ambos para no dejar uno con la lógica vieja. En este caso: v367 sub-c cubrió el detalle pero olvidé el consolidado → hotfix v368.

### v367 (2026-07-30) — Pipeline BigQuery + Dashboard app sincronizado con TABLERO SAR

Sesión intensiva de infra BQ + integración app↔BI. **4 PRs consecutivos** (#10, #12, #13, #15) que amplían el modelo de datos de Power BI y llevan esos datos al Dashboard de la app. `APP_VERSION` sí bumpea a v367 (sub-c toca `dashboard.js` + `index.html` + rules):

**a) Pipeline campañas comerciales → BQ** (PR #10, #12)

- Sync `campaigns` de Firestore → tabla `campaigns_raw` (WRITE_TRUNCATE cada 30 min via cron GH Actions, mismo patrón que `targets`).
- 3 vistas nuevas en `bigquery/views.sql`:
  - `v_campanias_progreso` — 1 fila por campaña (agregado): `realizado_qty`, `realizado_ars`, `pct_cumplimiento`, `dias_restantes`, `activa` (bool).
  - `v_campanias_evolucion_diaria` — 1 fila por (campaña × día): `qty_acumulado`, `ars_acumulado`, `pct_acumulado` usando window functions.
  - `v_campanias_ventas_detalle` — 1 fila por (campaña × línea de factura): 32 columnas (`card_name`, `item_code`, `assigned_vendor`, `provincia_cliente`, `familia`, `subfamilia`, `is_pesca`, `cantidad`, `importe_linea_ars`, etc.). **Necesaria** porque `v_campanias_progreso` viene agregada y las matrices multi-nivel PBI (por vendedor × cliente × SKU) tiraban `InvalidUnconstrainedJoin`.
- Helper `scripts/apply_v_campanias.py` — bootstrap: sync inicial + CREATE OR REPLACE de las 3 vistas + verify.
- Cruza contra `v_ventas_lineas` (facturado SAP = venta real, no pedido app). Filtros de scope (all/province/vendor) via WHERE conditional.
- Objetivo: hoja "CAMPAÑAS" nueva del TABLERO SAR para ver progreso de campañas que Pablo carga desde la app.

**b) Fix Notas de crédito SAP** (PR #13)

- Bug reportado: Santiago aparecía con `$29.09M` cuando neto real era `$18.9M`. Ejemplo: cliente Ricardo Fabian Blanco Goitia tenía factura RF 18226 (+$10.1M) + nota crédito RC 1810 (-$10.1M) + factura RF 18291 ($9.3M). BQ solo tenía las 2 positivas → sobreestimación.
- Causa: pipeline solo sincronizaba `/b1s/v1/Invoices`. Las NCs viven en `/b1s/v1/CreditNotes` (endpoint SAP separado) → nunca llegaban a BQ.
- Fix: nueva tabla `sap_credit_notes_raw` (413 CNs cargadas 2026-07-30) + `v_facturas_sap` y `v_ventas_lineas` extendidas con `UNION ALL` de CNs usando `sign=-1` en columnas monetarias. Nueva columna `doc_kind` (`INVOICE`|`CREDIT_NOTE`) para desglose. Todas las vistas derivadas (deuda, facturado_cobrado, campañas) heredan el fix.
- Helper `scripts/apply_credit_notes_fix.py` con helper reusable `extract_view_sql()` (extrae CREATE VIEW por nombre robusto frente a `;` en comentarios).

**Total en Power BI post-v394**: **20 vistas curadas** (9 base + 3 deuda + 2 rendiciones + 3 campañas + 1 leads + 1 remitos + 1 ofertas/TOTAL), 4 tablas raw nuevas (`campaigns_raw`, `sap_credit_notes_raw`, `sap_deliveries_raw`, `sap_returns_raw`).

**c) Dashboard app sincronizado con TABLERO SAR** (PR #15)

- Nueva colección Firestore `sap_snapshot/{VENDOR_NORM}_{YYYY}_{MM}` alimentada por función `sync_dashboard_snapshot_to_firestore()` que corre al final del cron cada 30 min. Agrega `v_facturas_sap + v_ventas_lineas` por vendedor+mes con `facturadoArsNeto`, `facturadoArsBruto`, `ncsArs`, `unidadesNeto`, `facturasCount`, `ncsCount`.
- `src/domains/dashboard.js`: nuevo listener `listenSapSnapshot()` + helpers `getSapSnapshotFor(vendor, y, m)` y `getSapSnapshotYtd(vendor, y, upToM)`. 2 cards nuevas en `renderDashboard()` cuando hay vendedor específico: **"SAP · Mes en curso"** y **"SAP · Acumulado anual"** (borde azul 2px + fondo `#f0f9ff` para diferenciarse de las cards "pedidos app" existentes que se mantienen).
- `firestore.rules`: `sap_snapshot` read para todos autenticados, write bloqueado (solo bypass del service account).
- Wire en `index.html`: `listenSapSnapshot()` en `attachFirebaseListeners()`, `off('unsubSapSnapshot', ...)` en `detachFirebaseListeners()` (regla #12 CLAUDE.md).
- Helper standalone `scripts/apply_dashboard_snapshot.py` para bootstrap manual (usado 2026-07-30 para poblar el snapshot sin esperar al próximo cron).
- Objetivo: cada vendedor ve su cumplimiento REAL vs target dentro de la app, sin necesidad de abrir Power BI. Los 6 vendedores + gerente ven exactamente los mismos números en ambas UIs porque derivan de la misma vista BQ.

**Verificación post-deploy 2026-07-30**: Gonzalo julio 2026 = $110.2M neto (bruto $130.9M − NCs $20.7M) en el dashboard app → matchea 1:1 con "Cumplimiento mensual" del Tablero SAR PBI.

**APP_VERSION bumpea a v367** (por sub-c que sí cambia código de la app). Ver README sección 40 para detalle completo de layout Power BI + arquitectura del snapshot + regla derivada.

### v366 (2026-07-30) — Fix z-index del modal `#contacto-estado-modal`

**Bug reportado por Mariano**: al tocar el botón ESTADO (v365) en una card de MIS CONTACTOS, "no pasaba nada". Solo al cerrar el modal Contactado padre aparecía el modal ESTADO atrás.

**Causa**: ambos modales usan la clase `.modal-overlay` con `z-index:3000` fijo. Como `#visita-modal` (modal Contactado) está declarado DESPUÉS en el DOM que el nuevo `#contacto-estado-modal`, gana el stacking context y lo tapa completo.

**Fix**: `style="z-index:4000"` inline en el `#contacto-estado-modal` (mismo nivel que `.qmodal-overlay` usada para otros modales secundarios).

Alcance:
- `index.html` — 1 línea del `<div id="contacto-estado-modal">`.
- `APP_VERSION` v365→v366, `CACHE_VERSION` v365→v366.

**Regla derivada**: cuando un modal se abre DESDE OTRO modal, bumpearle el z-index sobre el base. Documentar en CLAUDE.md si aparece un tercer caso.

### v365 (2026-07-30) — Botón ESTADO + modal para marcar resultado de contactos no presenciales

**Pedido de Mariano**: llevar registro sistemático de qué contactos no presenciales (WhatsApp/teléfono/email) dieron resultado — para decidir a quién enviarle documentación para alta SAP (salir de "Provisorios") y a quién eliminar del listado.

**UI en MIS CONTACTOS** (dentro del modal Contactado):
- Cada card de contacto muestra un tercer badge al lado de `📱 CONTACTO`: `⏳ SIN MARCAR` (ámbar, default) / `✅ RESPONDIÓ` (verde) / `❌ NO RESPONDIÓ` (gris).
- Botón teal **`📋 ESTADO`** reemplaza al ELIMINAR rojo SOLO en cards de contactos (visitas presenciales mantienen ELIMINAR directo).
- Al tocarlo abre modal `#contacto-estado-modal` con 3 opciones: RESPONDIÓ (badge verde + signal "mandar documentación") / NO RESPONDIÓ (badge gris) / ELIMINAR (dispara `deleteVisit` existente).

**Firestore**: nuevo campo en `visits/{visitId}`:
- `contactoResultado: 'respondio' | 'no_respondio'` (undefined = sin marcar).
- `contactoResultadoAt: serverTimestamp`.
- `contactoResultadoBy: uid`.
- `contactoResultadoByEmail: string`.

**Permisos**: admin/gerente marcan cualquier contacto; vendedores solo los propios (mismo criterio que `deleteVisit`). Auditado en `operations_log` como `contacto_resultado`.

Alcance:
- `index.html` — modal `#contacto-estado-modal` nuevo.
- `src/domains/visitas.js` — `renderVisitasList` con badge + botón condicional; nuevas funciones `openContactoEstadoModal` / `setContactoResultado` / `closeContactoEstadoModal` / `deleteContactoFromEstadoModal`.
- `app.bundle.js` regenerado.
- `APP_VERSION` v364→v365.

### v364 (2026-07-30) — Fix contador "X / Y habilitados" no cambiaba al tocar sub-filtro TODOS/CLIENTE EN SAP/PROVISORIOS

**Bug reportado por Mariano**: el contador `#contact-summary` del sidebar CLIENTES siempre mostraba `527 / 527` sin importar qué sub-filtro se tocara, aunque las cards debajo sí filtraban correctamente.

**Causa** (2 puntos):
1. `updateContactSummary()` ignoraba `clientStateFilter` — sumaba todos los POINTS + todas las SAP altas sin filtrar por confirmados/provisorios.
2. `setClientStateFilter()` solo llamaba `renderClients()`, nunca `updateContactSummary()` al cambiar filtro.

**Fix**: `updateContactSummary` ahora replica el mismo criterio de `renderClients` — POINTS respetan `getClientState()`; SAP altas → `confirmados` = SAP con geo+addr, `pendientes` = provisorio O SAP sin geo/addr. Además `setClientStateFilter` ahora llama `updateContactSummary()` al final.

Alcance:
- `index.html` — `updateContactSummary` (líneas 6067+), `setClientStateFilter` (líneas 10318+).
- `APP_VERSION` v363→v364.

**Aprendizaje**: cuando el mismo state (`clientStateFilter`) impacta múltiples piezas de la UI (lista + contador), vanilla exige acordarse manualmente de disparar cada actualización. React resolvería esto automáticamente al declarar el contador como derivado del state — decisión de mantener vanilla acepta este tipo de bugs a cambio de simplicidad de stack.

### v363 (2026-07-30) — Modal Zonas: filtro toggle "Solo sin asignar"

**Pedido de Mariano**: encontrar rápido las tiendas sin vendedor asignado dentro del modal ZONAS. Antes había que scrollear entre ~500 filas mezcladas para detectar las grises `SIN ASIGNAR`.

**Fix**: botón nuevo `🔴 Solo sin asignar` en la barra de filtros del `#zonas-modal` (entre "Masterfile-Base" y el select de provincias). Cuando está activo (fondo rojo `#b91c1c`), `renderZonasList()` esconde toda fila cuyo vendor efectivo NO sea vacío, en los 4 puntos de render:
- shop POINTS via `getEffectiveVendorForClient`.
- shop SAP altas via `a.assignedVendor`.
- loc via `getEffectiveVendorForPoint`.
- prov via override + mayoría de POINTS.

Alcance:
- `index.html` — botón nuevo `#zonas-filter-unassigned`, state `let zonasFilterUnassigned`, handler `window.toggleZonasFilterUnassigned()`, 4 guards en `renderZonasList`.
- `APP_VERSION` v362→v363.

### v362 (2026-07-30) — Fix `pendingNotifIdToMarkRead` cross-module scope

**Bug reportado**: al submitear cualquier form de visita/contacto tiraba `Error guardando: Can't find variable: pendingNotifIdToMarkRead`.

**Causa**: la variable estaba declarada como `let pendingNotifIdToMarkRead = null;` en `src/domains/notificaciones.js`. Al buildear con esbuild, esa `let` queda en el scope IIFE del módulo notificaciones (esbuild la renombra a `pendingNotifIdToMarkRead2` internamente para evitar collisions). Cuando `src/domains/visitas.js` leía/escribía `pendingNotifIdToMarkRead` sin sufijo `window.`, era una **free variable** → resolvía a `window.pendingNotifIdToMarkRead` (undefined) → `ReferenceError` al llegar al bloque de "marcar notificación como leída post-visita" dentro de `submitVisita`.

**Fix**:
1. En `notificaciones.js`: `let pendingNotifIdToMarkRead = null;` → `if (typeof window.pendingNotifIdToMarkRead === 'undefined') window.pendingNotifIdToMarkRead = null;`
2. En `visitas.js`: prefix `window.` en las 3 referencias.

**Extensión de la regla #17 CLAUDE.md**: aplica también **entre módulos del bundle**, no solo bundle↔inline. Cada `src/domains/*.js` tiene su propio scope IIFE en el bundle esbuild.

Alcance:
- `src/domains/notificaciones.js` — declaración cross-scope.
- `src/domains/visitas.js` — 3 refs con prefix `window.`.
- `app.bundle.js` regenerado.
- `APP_VERSION` v361→v362.

### v361 (2026-07-30) — Expone `_fsSelect` en `window` — click en dropdown no hacía nada

**Bug reportado por Mariano**: "cuando toco 'Tienda de pesca' no pasa nada".

**Causa**: el filter-select genera items con inline handler `onmousedown="_fsSelect(event)"`. Al extraer visitas al bundle IIFE en E2.k (Fase 0), esbuild **tree-shakea** la función `_fsSelect` porque no ve ninguna referencia JS a ella — el HTML inline (atributos `on*=`) no cuenta como uso. Al hacer click, el browser hace lookup en `window`, no encuentra `_fsSelect`, tira `ReferenceError` silencioso, el click no hace nada. Los otros handlers `fsOn*` (input/focus/blur/keydown) sí estaban expuestos con `window.fsOn* = function(...)` porque están referenciados en atributos `<input oninput=... onfocus=... onblur=... onkeydown=...>` — el único que faltaba era `_fsSelect`.

**Por qué solo se notó ahora**: Enter en el input dispara `fsOnKeydown` que ejecuta la misma lógica sin tocar `_fsSelect`. El user probablemente venía usando Enter sin darse cuenta, o el bug estaba oculto detrás del bug del preservado v359/v360. Post-E2 esto siempre estuvo roto para touch/mouse click puro.

**Fix**: cambio `function _fsSelect(evt){...}` por `window._fsSelect = function(evt){...}` en `src/domains/visitas.js`.

Alcance:
- `src/domains/visitas.js` — 1 línea de declaración.
- `app.bundle.js` regenerado.
- `APP_VERSION` v360→v361.

**Aprendizaje**: al extraer código al bundle, cualquier función referenciada solo por HTML inline (atributos `on*`) debe declararse con `window.foo = function(...)` explícito, sino esbuild la marca como muerta y la tree-shakea. Los handlers referenciados por JS del bundle no tienen este problema.

### v360 (2026-07-29) — Fix REAL del bug v359 — el selector "Tienda de pesca" seguía sin quedar seleccionado

**Bug reportado por Mariano**: v359 introdujo la lógica de preservar la selección previa entre re-populates de `populateVisitaLocalidades` (disparados por `onSnapshot` de `approvedAltasList` con el modal abierto), pero **seguía sin funcionar** — al elegir una tienda en el modal Contactado, el input quedaba vacío igual.

**Causa raíz** (que v359 no atacó): la comparación `items.find(i => i.value === _prevTiendaVal)` nunca matcheaba. `_fsSelect` pone en el hidden el value compuesto `"PROV||Loc||Tienda"`, pero **inmediatamente después** `onTiendaChange` (v298+) lo pisa con solo el nombre plano de la tienda. Los `items[].value` mantienen el formato compuesto. Entonces al comparar `_prevTiendaVal` (nombre plano) contra `items[].value` (compuesto) → siempre `undefined` → caía al `fsReset` → borraba igual que pre-v359.

**Fix**: reconstruir el value compuesto usando `vf-localidad` (`"PROV||Loc"`, que `onTiendaChange` deja en paralelo) + `vf-tienda` (nombre plano) → `"PROV||Loc||Tienda"`. Con eso `items.find` matchea, `fsSetValue` restaura el compuesto en el hidden + label completo en el input search, y una llamada extra a `onTiendaChange(_prevCompositeVal)` re-pisa el hidden con el nombre plano y re-setea `vf-localidad` (mismo camino que `_fsSelect` original).

El bug afectaba a AMBOS modos (visita + contacto), pero se notaba más en el modo Contactado porque es el flow nuevo y recién testeado.

Alcance:
- `src/domains/visitas.js` — reconstrucción del value compuesto en la lógica de preservación de v359.
- `app.bundle.js` regenerado.
- `APP_VERSION` v359→v360.

**Aprendizaje**: cuando aparecen 2 funciones que escriben al mismo `<input hidden>` con formatos distintos (una con value compuesto, otra con nombre plano), la lógica de "preservar el value" debe conocer AMBAS convenciones. Idealmente unificar el formato del hidden, pero sin refactor el mínimo es reconstruir siempre desde los inputs paralelos.

### v359 (2026-07-29) — Fix selector "Tienda de pesca" se borraba al llegar update de Firestore

**Bug reportado**: en el modal Contactado (`openVisitaModal('contacto')`), al elegir una tienda del dropdown filter-select `vf-tienda`, el input quedaba vacío después. El dropdown se cerraba correctamente pero el value no se preservaba. El bug también existía en modo Visita presencial pero no se había notado.

**Causa raíz**: `index.html:3707-3793` tiene un listener `onSnapshot` de la colección `client_applications` (`approvedAltasList`). Cada vez que Firestore dispara update, si el modal Visita está abierto se re-llama `populateVisitaLocalidades()` (para incluir posibles alta-rápidas nuevas en el dropdown).

`populateVisitaLocalidades()` (`src/domains/visitas.js:485`) hacía:
```js
fsPopulate('vf-tienda', items, function(val){ onTiendaChange(val); });
fsReset('vf-tienda');  // ← esto borraba la seleccion del user
```

El `fsReset` es incondicional. El "guardian" de `index.html:3785` (`if (!escribiendo) populateVisitaLocalidades()`) solo protegía si el user estaba **escribiendo** (foco activo). Pero después de que el user hace click en una opción, `_fsSelect` (`src/domains/visitas.js:551`) hace `inp.blur()` → el input pierde foco → el próximo `onSnapshot` (cualquier update de Firestore = alta aprobada por otro admin, edit de tienda, cambio de campo, etc.) disparaba el re-populate → `fsReset` → selección borrada. Como Firestore dispara con datos iniciales al bootstrap y a cada write remoto, el race era frecuente.

**Fix** (`src/domains/visitas.js:485-513`):
1. Antes de `fsPopulate`, guardar el value actual del hidden `vf-tienda`.
2. Después de `fsPopulate`, si el value previo sigue existiendo en la nueva lista de opciones, restaurarlo con `fsSetValue`. Si no existe (rara vez pasa), reset normal.
3. Mismo tratamiento para `vf-localidad`.

Alcance:
- `src/domains/visitas.js:485-513` — logica de preservación.
- Bundle rebuild (`node build.js`) → `app.bundle.js` regenerado.
- `APP_VERSION` v358→v359, `CACHE_VERSION` v358→v359.

**Aprendizaje**: cuando un listener `onSnapshot` re-popula UI que puede estar en uso, siempre preservar el estado del user si es válido. El patrón "fsReset incondicional" asume que el dropdown se re-abre desde cero, pero en apps con listeners live el user puede estar en el medio de una interacción. Chequear si hay más lugares en el código con este anti-pattern.

### v358 (2026-07-29) — Fix validación submit — v357 quedó incompleta

**Bug reportado**: al intentar cargar un contactado el alert decía "Faltan completar: Especialización por tipo de pesca" — pero el campo estaba oculto por v357.

**Causa**: v357 escondió el `<div>` de Especialización con `display: none` y quitó el `required` HTML del `<select>`, pero **`submitVisita()` en `src/domains/visitas.js`** tiene una validación JS aparte (líneas 810-837) que iteraba todos los campos requeridos armando un array `errors`. La línea:
```js
if (!readField('vf-especializacion')) errors.push('Especializacion por tipo de pesca');
```
no tenía el guard `!_isContacto`. Como el campo oculto sigue existiendo en el DOM y su value queda vacío, `readField` devolvía `""` → falsy → push al array de errores → alert bloqueaba el submit.

**Fix**: agregado el guard `!_isContacto &&` a esa validación, mismo patrón que Fidelidad/POP/TipoVenta arriba/abajo en la misma función.

Alcance:
- `src/domains/visitas.js:823` — guard `!_isContacto` agregado a la validación de Especialización.
- Bundle rebuild (`node build.js`) → `app.bundle.js` regenerado.
- `APP_VERSION` v357→v358, `CACHE_VERSION` v357→v358.

**Aprendizaje**: cuando "ocultás un campo en modo X", buscar TODAS las referencias al `id` del campo (`vf-especializacion` en este caso) — típicamente hay 3 lugares: (1) el HTML del `<div>`/`<select>`, (2) `applyVisitModeUI` para el toggle visual, (3) `submitVisita` para la validación. Si alguna queda con lógica dura, el bug aparece solo en runtime al submitear.

### v357 (2026-07-29) — Ocultar "Especialización por tipo de pesca" en modo Contactado

**Pedido**: en el botón "Contactado" (registro de contacto no presencial por WhatsApp/tel/email) no tiene sentido pedir el campo "Especialización por tipo de pesca" — es info que se releva en una visita presencial, no en un contacto rápido.

**Fix**: se suma este campo al conjunto ya existente de filas que se ocultan en modo contacto (patrón introducido en v339 con Fidelidad + POP + Tipo de venta):
- HTML: agrego `id="vf-especializacion-row"` al `<div class="vf-row">` que contiene el select.
- `applyVisitModeUI(mode)` en `src/domains/visitas.js`: si `isContacto`, oculta la fila y quita `required` al `<select id="vf-especializacion">`. En modo visita presencial vuelve a mostrarse y a ser requerido.

Alcance:
- `index.html:2237` — id agregado al vf-row.
- `src/domains/visitas.js:326-350` — bloque `applyVisitModeUI` extendido para incluir `rowEsp2` + `selEsp`.
- Bundle rebuild (`node build.js`) → `app.bundle.js` regenerado.
- `APP_VERSION` v356→v357, `CACHE_VERSION` v356→v357.

### v356 (2026-07-29) — Fix zonas con aspecto "moteado" en zoom lejano

**Bug reportado**: el usuario notó que en zoom lejano las zonas se veían fragmentadas / no pintadas uniformemente, pero al hacer zoom in se veían perfectas.

**Causa raíz**: cada dept es un polygon separado. Con:
1. `geo.json` simplificado por Douglas-Peucker en v351 (cada dept simplificado independientemente).
2. `smoothFactor: 3.0` en v354 (simplificación adicional on-the-fly según zoom).

Los vertices del dept-A NO coinciden pixel-perfect con los del dept-B vecino. Aparecen **gaps microscópicos** (1-2 px) entre depts adyacentes del mismo vendor. Como el `deptStyle` tenía `stroke: false` (para dejar el contorno externo a cargo del `vendorOutlineLayer`), esos gaps dejaban ver el fondo blanco → aspecto moteado. En zoom cerca los polygons son mucho más grandes que los gaps → parece uniforme.

**Fix**: en `deptStyle`, ambos casos que antes usaban `stroke: false` ahora usan un stroke MUY sutil con `color: fill` + `opacity: fillOpacity` (mismo color y misma opacity que el fill). No se ve como una línea de borde — se ve como más fill. Pero tapa los gaps de 1-2 px que dejaba la simplificación independiente. El contorno externo grueso de la zona lo sigue dibujando `vendorOutlineLayer` (weight 2.5-3.5).

Alcance:
- `index.html:4636-4649` — caso `currentVendor !== 'ALL'` && `currentLocality === 'ALL'`: agregado `color: fill, weight: 1, opacity: 0.30`.
- `index.html:4655-4671` — caso `currentVendor === 'ALL'`: mismo tratamiento, `opacity: fo` donde `fo` es la fillOpacity (0.22 con vendor, 0.05 sin).
- `APP_VERSION` v355→v356, `CACHE_VERSION` v355→v356.

**Alternativa que se descartó**: bajar `smoothFactor` a 1.5 → menos ganancia de perf. Preferimos mantener la perf + tapar los gaps con stroke sutil. Si aún se ven gaps residuales, el fix real es el fix C (mergear los 527 depts en 6-7 polygons por vendor).

### v355 (2026-07-29) — Revert skip deptLayer del v354 (rompía los fills coloreados)

**Bug**: en country view (zoom 4-7) las provincias quedaban blancas por dentro — solo se veían los outlines de las zonas.

**Causa**: v354 fix B removía `deptLayer` del mapa cuando el zoom era <8, creyendo que solo aportaba "detalle de departamentos". En realidad `deptLayer` es la ÚNICA fuente del `fillColor` por vendor — los polygons de dept se pintan con el color de la zona y esos fills forman visualmente los "colores de las zonas". Los outlines gruesos que se ven vienen de `vendorOutlineLayer`, que sigue vivo.

**Fix**: revertido el toggle `_updateDeptLayerVisibility()` + listener `zoomend`. Mantiene el `smoothFactor: 3.0` del v354 fix A (que no cambia semántica, solo simplifica vertices casi colineales al vuelo).

Alcance:
- `index.html:4696-4712` — solo `smoothFactor: 3.0` en `deptLayer`, sin el toggle.
- `index.html:5000-5017` — `provLayer` mantiene `smoothFactor: 3.0`, se remueve el bloque `DEPT_MIN_ZOOM` + `_updateDeptLayerVisibility()` + listener.
- `APP_VERSION` v354→v355, `CACHE_VERSION` v354→v355.

**Aprendizaje**: antes de "optimizar removiendo un layer" hay que entender qué renderea EXACTAMENTE. En este caso `deptLayer` tiene doble propósito (detalle + fill de zona). Si en el futuro queremos bajar el costo de render en country view, la opción correcta es el **fix C** (mergear depts por vendor con `polygon-clipping.union()` en 6 polygons pre-computados que reemplacen el fill de los 527 depts). Ese cambio es más grande y hay que testear que no rompa la interacción con overrides del modal Zonas.

### v354 (2026-07-29) — Perf mapa: smoothFactor + skip deptLayer en zoom lejos

**Contexto**: post v351-v353 el mapa mejoró mucho pero seguía habiendo un delay perceptible en el zoom, sobre todo al repintar los bordes de las zonas (polilíneas del `vendorOutlineLayer`) y los depts (`deptLayer`).

**Fix 1 — `smoothFactor: 3.0`**: Leaflet's option para simplificar cada path on-the-fly según zoom antes de mandarlo al canvas/svg. Default 1.0 preserva casi todos los vertices. A 3.0 elimina vertices casi colineales — imperceptible al ojo en el rango de zoom 4-14, pero baja significativamente el trabajo por frame en depts complejos (Chubut, Santa Cruz, etc con contornos rugosos). Aplicado a:
- `deptLayer` (L.geoJSON con 527 features).
- `provLayer` (L.geoJSON con 24 features).
- Polilíneas de `vendorOutlineLayer` (edge-cancelled outlines por vendor).

**Fix 2 — Skip `deptLayer` en zoom < 8**: en country view (Argentina completa en pantalla), los depts individuales son invisibles al ojo. La app pintaba 527 polygons complejos de todas formas. Ahora `map.on('zoomend', ...)` remueve `deptLayer` del mapa cuando el zoom baja de 8 y lo re-agrega cuando sube. `map.hasLayer()` guard evita double-add. Estado inicial (setView zoom 4) arranca sin el layer.

En country/regional view el usuario solo ve `provLayer` (24 polygons) + `vendorOutlineLayer` (~6-100 polilineas de zonas) — carga infinitamente más liviana.

Alcance:
- `index.html:4696-4712` — `deptLayer` con `smoothFactor: 3.0`.
- `index.html:5000-5017` — `provLayer` con `smoothFactor: 3.0` + `DEPT_MIN_ZOOM` constant + `_updateDeptLayerVisibility()` + listener `zoomend`.
- `index.html:4956-4966` — `smoothFactor: 3.0` en L.polyline de outlines.
- `APP_VERSION` v353→v354, `CACHE_VERSION` v353→v354.

### v353 (2026-07-29) — Fix cluster fragmentado: pines verdes sueltos se absorben en las burbujas

**Bug reportado**: post v352 quedaban pines verdes sueltos al lado de clusters amarillos, en vez de mergearse con ellos (ej: un pin en Chubut al lado del cluster de 8 no se sumaba).

**Causa raíz**: v352 creaba **3 `markerClusterGroup` independientes** (uno por layer: `clientPinLayer`, `sapAltaPinLayer`, `markerLayer`). Cada `L.markerClusterGroup` agrupa solo sus propios markers. Un pin verde de `clientPinLayer` solitario junto a un cluster de `sapAltaPinLayer` NO se mergea porque son clusters distintos.

**Fix**: **UN solo `_sharedCluster` global**. Cada "layer" pasa a ser un proxy con un `Set` propio de markers que forwardea `addLayer / removeLayer / clearLayers` al cluster compartido. Cada layer sigue pudiendo hacer `clearLayers()` en su redraw (limpia solo sus markers trackeados, no toca los de las otras layers). API expuesta del proxy: `addLayer`, `removeLayer`, `clearLayers`, `hasLayer`, `getLayers` — suficiente para todos los usos actuales (`marker.addTo(layer)` + `layer.clearLayers()`).

Alcance:
- `index.html:5052-5106` — `_CLUSTER_OPTS`, `_sharedCluster`, helper `_mkPinLayer()` con proxy.
- `APP_VERSION` v352→v353, `CACHE_VERSION` v352→v353.

### v352 (2026-07-29) — Perf mapa: marker clustering (~1000 pines agrupados)

**Motivación**: continuación de v351. El bottleneck restante era el freezing al pintar ~1000 divIcons juntos en country view (Argentina zoom 4-8). Un divIcon = un `<div>` DOM por marker; el reflow de 1000 elementos en cada frame de zoom era caro.

**Fix**: agregado plugin `leaflet.markercluster@1.5.3` desde CDN unpkg (1 JS + 2 CSS en `<head>`). Los pines cercanos se agrupan en burbujas con contador (ej: "234 tiendas"). Click en cluster hace zoom automático al bounds.

Opciones tuneadas:
- `maxClusterRadius: 60` (default 80) — clusters más chicos, mejor separación visual.
- `disableClusteringAtZoom: 12` — en zoom ≥12 (city detail) se ven todos los pines individuales, no queremos agrupar cuando el user ya está en una calle.
- `showCoverageOnHover: false` — evita el polígono al hover (ruidoso sobre los outlines de zona).
- `chunkedLoading: true` — agrega markers en chunks (async), evita freeze de 500-1000 `addLayer` síncronos.
- `spiderfyOnMaxZoom: true` (default) — click en cluster en maxZoom → spider los markers.

Fallback a `L.layerGroup()` si el plugin no cargó (offline con SW viejo o CDN caído) — la app sigue funcional.

Aplicado a `clientPinLayer` + `sapAltaPinLayer` + `markerLayer` via helper `_mkPinLayer()`.

Alcance:
- `index.html:23-27` — `<link>` + `<script>` del plugin desde unpkg.
- `index.html:5052-5075` — `_mkPinLayer()` con fallback.
- `APP_VERSION` v351→v352, `CACHE_VERSION` v351→v352.

**Nota**: v352 tenía bug de layers fragmentadas — corregido en v353 abajo.

### v351 (2026-07-29) — Perf mapa: preferCanvas + geo.json simplificado (1.6MB → 885KB)

**Motivación**: usuario reportó zoom in/out laggy en el mapa. Diagnóstico:
- ~1000 markers + 24 provincias + 527 departamentos con polygons superpuestos.
- Renderer default de Leaflet es SVG → cada zoom repintaba cada path.
- `geo.json` 1.6 MB con geometrías full-res innecesarias en zoom 4-14.

**Fix 1 (`preferCanvas: true`)**: `L.map('map', {preferCanvas: true, ...})`. Los polygonos (provincias + departamentos + zonas) ahora se pintan en un `<canvas>` en vez de SVG — un solo paint por frame en vez de re-render SVG de ~550 paths.

**Fix 2 (simplificación `geo.json`)**: nuevo script `scripts/simplify-geo.js` — Douglas-Peucker + round de coordenadas a 4 decimales:
- Dept tol 0.005° (~555 m, invisible en zoom 4-9): **60,692 → 26,215 coords (57% menos)**.
- Prov tol 0.003° (~333 m): **20,426 → 17,322 coords (15% menos)**.
- `geo.json`: **1602 KB → 885 KB (45% menor)**.

Backup local `geo.json.bak` (ignorado por `*.bak` nuevo en `.gitignore`, no se commitea).

Alcance:
- `index.html:3526-3530` — `preferCanvas: true` en `L.map()`.
- `geo.json` regenerado (simplificado).
- `scripts/simplify-geo.js` (nuevo, ~120 LOC) — reusable para re-correr con otra tolerancia.
- `.gitignore` — agregado `*.bak`.
- `APP_VERSION` v350→v351, `CACHE_VERSION` v350→v351.

### v350 (2026-07-29) — Fix layout toolbar Master Clientes (overflow botón SAP)

**Bug**: después de v349, el toolbar del Master Clientes tenía 12 items (5 selects/inputs + 7 botones) pero el grid CSS estaba fijo en `repeat(5,1fr) auto`. En viewports desktop (>880px), esto forzaba layout de fila 1 = 5 selects + Importar (auto), fila 2 = 5 botones, fila 3 = SAP solito → el botón "SAP" quedaba desbordando el modal (visible en captura).

**Fix**: `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))` — el grid ahora crea tantas columnas de 150px mínimo como quepan en el modal, y hace wrap natural. Distribución dinámica:
- Modal 1200px+: 7-8 columnas por fila → 12 items en 2 filas.
- Modal 900-1200px: 5-6 columnas por fila → 12 items en 2-3 filas.
- Modal <520px: 1 columna (mobile media query se mantiene).

También se removió el media query intermedio `@media (max-width:880px)` con `repeat(2,1fr)` que ahora es innecesario (el auto-fill lo maneja).

Alcance:
- `index.html:469-470` — nueva definición `.mc-toolbar` con auto-fill.
- `APP_VERSION` v349→v350, `CACHE_VERSION` v349→v350.

### v349 (2026-07-29) — Botón "SAP" en Master Clientes + TIPO default 'C'

**Pedido**: 
1. Agregar botón "SAP" en el toolbar del Master Clientes al lado de "Provisorios" para filtrar solo tiendas con CardCode (contraparte del filtro Provisorios).
2. Que el campo "TIPO" del Master Clientes arranque en **'C'** por default cuando el cliente no tiene tipo asignado. Si el usuario quiere upgrade a B/A/P, lo cambia manualmente.

**Implementación**:
- Nuevo state `mcSapMode` (paralelo a `mcProvisorioMode`) + funciones `toggleMcSapOnly()` y `getSapList()` en `src/domains/master-clientes.js`. Modos exclusivos: encender uno apaga el otro.
- Filtro en `renderMasterClientesTable`: si `mcSapMode` → `entries.filter(e => e.tipo === 'sap_alta' && e.sapCardCode)`. Aplica antes que los filtros de vendor/provincia/localidad/estado.
- Nuevo botón HTML `#mc-sap-only-btn` (índex.html:2607) con badge de count (`getSapList().length`), gradiente verde teal, ícono 🏭 (factory).
- Reset en `openMasterClientesPanel`: `mcSapMode = false` al reabrir el panel.
- Orden del dropdown TIPO_OPTS invertido: ahora `[C, B, A, P (Premium), (sin clasificar)]` — 'C' primero para reflejar el default.
- `curTipoRender = curTipo || 'C'` en el render de cada fila — cuando no hay tipo guardado, el select muestra 'C' seleccionado. NO auto-persiste; el usuario debe apretar "Guardar" para que el 'C' quede en Firestore.
- `APP_VERSION` v348→v349, `CACHE_VERSION` v348→v349.

### v348 (2026-07-29) — Botón "Geocodificar tiendas SAP" con modo FORZOSO + feedback al editar dirección

**Problema reportado por vendedor**: "cambié la dirección de un cliente pero el pin quedó en el mismo lugar". Investigación reveló dos bugs:

1. **Botón "Geocodificar tiendas SAP" filtraba solo altas sin lat/lng**. `geocodeAllPendingSapAltas` (index.html:3835) tomaba únicamente `(a.lat == null || a.lng == null)`. Si el vendedor editó dirección y el geocoding devolvió lat/lng nuevo pero incorrecto (por ej. Google fuzzy-matcheó ciudad equivocada), el pin quedaba fijo en la coordenada errónea y el botón NO lo re-procesaba. Fix: parámetro `force: true` que procesa TODAS las altas con dirección. Trigger en UI (`runBulkGeocodeSapAltas`) ahora hace `confirm(...)` con 2 opciones: **ACEPTAR = forzar todas**, CANCELAR = solo faltantes.
2. **Edición individual de dirección sin feedback cuando el geocoding devolvía mismas coordenadas**. `openSapAltaAddressModal` (v342+) borraba lat/lng y re-geocodificaba, pero si Google/OSM matcheaba al mismo punto que antes, mostraba "Direccion guardada y geocodificada" sin avisar que el pin no se movió. Fix: v348 compara lat/lng nuevas vs previas (tolerancia ~15m); si son iguales, alerta "el geocoding devolvio EL MISMO punto que antes... probá con dirección más específica o usa el botón geocodificar forzoso". También agrega `console.log('[edit-address]', ...)` con prev/nuevo para diagnosis.

Alcance:
- `index.html:3835-3901` — `geocodeAllPendingSapAltas` acepta `options.force`.
- `index.html:3905-3945` — `runBulkGeocodeSapAltas` prompt de modo (aceptar=forzoso / cancelar=solo faltantes).
- `index.html:5440-5498` — `openSapAltaAddressModal` compara distancia lat/lng prev vs nuevo, alerta si `sameSpot`.
- `APP_VERSION` v347→v348, `CACHE_VERSION` v347→v348.

### v347 (2026-07-28) — Split de líneas por stock en pedido confirmado (verde/rojo)

Cuando un pedido queda confirmado y el admin/vendedor abre el detalle (`viewPedido`), las líneas ahora se **separan en dos grupos visuales**: verde para las que tienen stock suficiente y rojo para las que SIN STOCK.

**Comportamiento nuevo (post `confirmExcelPedido`)**: al cargar un pedido por Excel, si el pedido pide N unidades de un SKU y hay stock M<N disponible, la línea se **divide en 2**:
- Línea A verde con cantidad `M` (cubierta por stock).
- Línea B roja con cantidad `N-M` con badge `SIN STOCK` (backorder).

Si el SKU tiene stock ≥ pedido, queda una única línea verde. Si el SKU no tiene stock alguno, línea única roja.

Alcance:
- `index.html:3467` — nuevo helper `getStockQty(sku)` lee `STOCK_QUANTITIES` (numeric map del snapshot Firestore, no el bool `STOCK_MAP`).
- `confirmExcelPedido` (loader por Excel) — splittea las líneas antes de escribir el pedido a Firestore, marca cada línea con `sinStock: true` cuando aplica.
- `viewPedido` (L9770+, detalle del pedido) — renderiza rojo con `background:#fee2e2;border-left:3px solid #dc2626` + badge SIN STOCK inline al lado del SKU si `line.sinStock`.
- Ejemplo real: pediste 5× FX4000FC, hay 3 en stock → detalle muestra 1 línea verde `FX4000FC × 3` + 1 línea roja `FX4000FC × 2 [SIN STOCK]`.

### v346 (2026-07-28) — Excel loader: alias específico `PRECIO VTA SHIMANO $ (SIN IVA)`

Extensión del v345. Además de los aliases genéricos (`PRECIO`, `PRECIO UNITARIO`, `PRECIO VENTA`, etc.), agregamos la columna EXACTA que el equipo comercial usa en sus templates: **`PRECIO VTA SHIMANO $ (SIN IVA)`** (columna G del Excel oficial).

Alcance:
- `index.html` `PRICE_NAMES` — array con los aliases que el loader busca en el header row del Excel. Match case-insensitive + normalización de acentos + espacios múltiples.

### v345 (2026-07-28) — Excel loader: precios del archivo pisan el catálogo

Cuando el vendedor sube un pedido con **"Cargar pedido por Excel"**, la nueva regla es: **los precios del archivo tienen prioridad sobre los precios del catálogo interno** (`PRODUCTS` bundleado).

Antes, el loader usaba siempre el `unit_price` de PRODUCTS y descartaba lo que viniera en el Excel. Ahora:
1. Si la fila del Excel tiene una columna de precio detectable (alias `PRICE_NAMES`) con valor numérico > 0 → ese precio se usa como `price` en la línea del pedido.
2. Si no, fallback al precio del catálogo.

Motivación: los vendedores hacen negociaciones puntuales con precios que difieren del catálogo (descuento por volumen, ofertas por producto discontinuado, cotizaciones especiales). El Excel refleja el precio acordado con el cliente; la app tiene que respetarlo.

Alcance:
- `confirmExcelPedido` — extrae precio del row, valida `>0`, sino usa catálogo.
- Log en consola cuando el precio del Excel difiere del catálogo (para auditoría).

### v344 (2026-07-28) — Fix duplicados SAP: Firestore transaction lock cross-session

**Bug reportado** (Ioannis): "cargué un pedido y en SAP me quedó la Oferta de Venta DUPLICADA (2 ofertas iguales con distinto DocEntry)".

**Causa raíz**: race condition entre 2 sesiones del mismo admin (2 tabs abiertos, o F5 durante envío). El listener `ensureSapAutoSendListener` corre en **cada sesión admin**; el flag `_autoSendInflight` que prevenía doble envío era **local por sesión** — no coordinaba entre tabs/dispositivos. Ambas sesiones veían el pedido como `stage=confirmed` + `transferidoSAP=null` al mismo tiempo, ambas llamaban `sapSL.createQuotation` en paralelo, SAP creaba 2 documentos.

**Fix**: distributed lock via **Firestore transaction** (`fbDb.runTransaction`) que escribe un campo `sendingSapLock={sessionId, at}` antes de invocar SAP. Solo un session gana la reserva; los demás ven el lock y saltan con `OTHER_SESSION_LOCK`. Lock stale-safe: si otro session lo tomó hace <60s, se respeta; si es más viejo se asume crashed y se puede re-intentar. Happy path libera el lock en <10s (`FieldValue.delete()` cuando se seteó `transferidoSAP`).

Alcance:
- `src/domains/sap-auto-send-listener.js` — envuelve la reserva en `runTransaction` que valida `transferidoSAP + sendingSapLock` antes de tocar SAP.
- `src/domains/sap-admin-panel.js` (`enviarPedidosASAPViaServiceLayer`) — mismo patrón para envío manual (admin aprieta el botón).
- Nuevo campo Firestore `pedidos/*.sendingSapLock: {sessionId, at}` — TTL implícito (60s desde `at`), auto-limpia post-transferido.

Test manual: abrir 2 tabs admin con auto-send ON, generar un pedido → 1 sola oferta en SAP + logs de la 2da sesión reportando `[SAP auto] skip <fsId> - OTHER_SESSION_LOCK:<otherSessionId>`.

### v343 (2026-07-28) — Campo "Descuento total (%)" manual → SAP DiscountPercent header

**Pedido**: el vendedor tiene que poder cargar un **descuento manual por pedido** (no por línea) que se refleje en el campo Descuento % de la Oferta de Ventas de SAP.

**Implementación**:
- Modal *Revisá tu pedido* (`renderReviewLines`) tiene un nuevo input `#rv-manual-discount` — campo numérico 0-100, obligatorio, con onchange que recalcula el total visible.
- Al confirmar (`doConfirmPedido`), el valor se persiste en el pedido como `discountPct`.
- El listener SAP + envío manual (`sapSL.buildQuotationPayload`) mete el valor en `DiscountPercent` del header del Sales Quotation — aparece en OQUT.DiscPrcnt, campo "Descuento %" en el rincón inferior derecho del formulario SAP. Aplica a nivel documento, NO por línea.
- Rango clampeado: `Math.max(0, Math.min(100, parseFloat(p.discountPct) || 0))`.
- Export CSV DTW (`exports-sap.js` → `QUT - Documents.csv`) también incluye el DiscountPercent si el admin descarga el ZIP en vez de auto-enviar por Service Layer.

Ver capturas y confirmación en la sesión 2026-07-29 (Q&A con Mariano): el input marcado con círculo en el review modal = campo Descuento % del OQUT header.

### v342 (2026-07-28) — Vendedor edita Nombre Fantasía + Dirección + Localidad

Antes solo admin/gerente podían editar los campos de una alta SAP existente (cardCodeSap presente). El equipo comercial pidió abrir **Nombre Fantasía, Dirección y Localidad** a **vendedores + internos** para poder corregir dispositivos in-situ.

Alcance:
- `openSapAltaAddressModal` — removido el gate admin/gerente; prompt de calle + prompt de localidad opcional.
- Localidad editable: si el vendedor la corrige, se guarda como override (no la sobre-escribe el geocoding automático).
- Re-geocode automático post-edit: borra `lat/lng` con `FieldValue.delete()` para forzar reprocesamiento (mismo flow que "Cargar dirección" original).
- Cada save graba `updatedBy = currentUser.email` + `updatedAt = serverTimestamp` para auditar quién tocó qué.

**Nombre Fantasía**: mismo pattern en `renderClientCard` — botón "✏️ Editar nombre" ahora visible para vendedor/interno además de admin. `assignedVendor` sigue siendo admin-only (no queremos que vendedor re-asigne clientes entre sí).

### v341 (2026-07-28) — Remove sub-tab "Nueva solicitud" de Alta Clientes

El sub-tab "Nueva solicitud" del panel Alta Clientes ya no se usaba (todas las altas ahora vienen de SAP sync o del flow rápido `openAltaRapidaModal`). Se removieron 62 líneas correspondientes al pane `#ac-pane-nuevo` (L3077-3138 pre-v341) + el botón del sub-tab.

Sub-tabs restantes en Alta Clientes: **Mis solicitudes** (VDE ve sus altas rápidas + SAP asignadas), **Provisorios** (admin/gerente aprueban altas), **Aprobadas** (log de cerradas).

### v340 (2026-07-28) — Fix visual "Aún no transferido a SAP" en pedidos ya transferidos

**Bug**: los vendedores veían el mensaje `⚠️ Aun no transferido a SAP` en el detalle de sus pedidos aunque el pedido YA había entrado a SAP (visible en el panel del admin como "Transferidos").

**Causa raíz**: el listener `unsubPedidosOwn` (que puebla la vista del vendedor) proyectaba solo un subset de campos del doc Firestore — el campo `transferidoSAP` NO estaba en el mapping → siempre llegaba `undefined` al render → siempre mostraba el warning.

**Fix**: `index.html:13748+` — agregar `transferidoSAP: d.transferidoSAP || null` al objeto proyectado por el listener. Ahora el vendedor ve el mismo estado que el admin (badge verde `✓ En SAP - DocNum X` si transferido).

### v339 (2026-07-28) — Modo Contactado: hide Fidelidad + POP + Tipo de Venta

Cuando el vendedor abre el modal Visita en modo **`contacto`** (Registrar contacto, no visita física), los campos **Fidelidad**, **POP** y **Tipo de venta** ya no aparecen ni son obligatorios — no tienen sentido para un contacto telefónico / WhatsApp / mail.

Alcance:
- `src/domains/visitas.js` — `applyVisitModeUI` esconde los 3 rows cuando `visitMode === 'contacto'`.
- `submitVisita` — skip validación de Fidelidad/POP/Tipo si estamos en modo contacto.

Los campos siguen visibles + obligatorios en modo **`visita`** (visita presencial estándar).

### v333-v338 (2026-07-28) — E3 code splitting + hotfixes E6

Bloque de 6 versiones que cierran **E3 (code splitting) + E6 (audit + fixes)** de la rama `e2b-perf`. Ver sección 45 y 46 para detalle técnico. Resumen:

- **v333 — E3 code splitting**: `app.bundle.js` (1 solo archivo monolítico ~1.89 MB) → **`shell.js`** (bundle base) + **`chunks/exports-core.js`**, **`chunks/exports-advanced.js`**, **`chunks/admin-users.js`** (lazy, cargan on-demand via `window.loadChunk(name)`). Loader `src/loader.js` + `installChunkStubs(chunkName, exportNames)` genera stubs `window.*` que triggerean la carga del chunk al primer llamado. SW cachea shell + chunks explícitamente.
- **v334-v337 — E6 code review hotfixes**: subagente de code review contexto limpio detectó **5 ReferenceError** (C1-C5): `usersCache`, `mcShowBaseMaster`, `notifsTab`, `rutaVendorFilter`, `sapCurrentTab` declaradas `let X` dentro del bundle IIFE cuando el inline las leía/escribía → promovidas a `window.*` (regla CLAUDE.md #17). Auditoría sistemática con script Node encontró **13 helpers más sin `window.*` export** (`ensureClientLocsListener`, `dataUrlToBlob`, `renderMisRendiciones`, etc.). Cross-module bugs: **5 funciones referenciadas entre bundle chunks sin `window.*`** (`getCurrentOrderClientData`, `flashSaved`, `notifItemHtml`, `loadExcelJS`, `sapNorm`).
- **v338 — SW stale-while-revalidate + `sw.js` STATIC_ASSETS con chunks**: cambio de estrategia de "cache-first" a **stale-while-revalidate** para assets locales (bundle + chunks + iconos + geo.json). Sirve del cache inmediato (fast path arranque) + fetch en background para refresh. Evita mismatch shell/chunk entre deploys parciales. `STATIC_ASSETS` incluye `./chunks/*.js` explícitamente. Ver sección 45.

**Merge a main**: rama `e2b-perf` se mergea con `git merge --squash` (branch protection prohíbe merge commits). Los 6 bumps (v333-v338) llegan a main en un solo squash commit + los hotfixes que salieron post-merge (v339-v348).

### v332 (2026-07-28) — WarehouseCode 07 → 11 en pedidos a SAP

Los pedidos que salen de la app ahora apuntan al depósito **11 (MERCADERIA)** en vez del 07 histórico (que tenía solo PESCA EEUU y estaba vacío — ver comment `_isSalesWarehouse`). Alcance:

- `index.html:21345` — payload Service Layer (`WarehouseCode: '11'`) en cada `DocumentLine` del Sales Quotation que envía la Cloud Function `sapProxy`.
- `index.html:22142` — CSV `QUT1 - Document_Lines.csv` del ZIP DTW, columna `WarehouseCode = '11'`. Comment `// PESCA` reemplazado por `// MERCADERIA (v332)`.
- `index.html:23116` — tag `warehouse` en el snapshot Firestore que genera la subida manual de CSV (`app_config/stock_snapshot`) sigue el mismo cambio para consistencia (no filtra qué se muestra al vendedor; solo audita).
- Labels UI "W07" → "W11" en 4 lugares: `1774` (descripción modal Exportar → Precios/Stock), `7169` y `7196` (headers Excel `Stock W11`), `23034` (mensaje toast del CSV manual).

**No** se toca `scripts/sync_stock.py` (mantiene `WAREHOUSE_FILTER='07'`) porque el sync automático `sync_sap_to_firestore.py` ya usa `'ALL_SALES'` (suma todos los vendibles ≠ 05 Marketing ≠ 06 Devoluciones — incluye W11). Si en algún momento se vuelve al flujo CSV manual con W11, hay que bumpear también `sync_stock.py`.

### v331 (2026-07-28) — Export Clientes por scope de vendor + fix filtro VDI

Dos cambios pedidos por el equipo comercial (Ioannis / Santiago):

1. **Export Clientes habilitado a vendedores + internos**. Antes la opción "Clientes (masterfile)" del modal *Exportar a Excel* solo aparecía para admin/gerente/viewer (`allowedByRole.vendedor` no la incluía). Ahora `vendedor` e `interno` la ven, y `exportMasterClientes()` filtra por `getEffectiveVendorSet(currentVendor)` — cada usuario descarga solo las tiendas de su scope: VDE su zona, VDI sus parejas + propio o el subset elegido. Incluye habilitados en SAP y provisorios de Alta Rápida. El nombre del archivo lleva sufijo con el scope (`Masterfile_Clientes_SAP_IOANNIS_2026-07-28.xlsx` vs `Masterfile_Clientes_SAP_TODOS_...`).
2. **Fix VDI que selecciona su propio nombre no expanda a parejas**. En `getEffectiveVendorSet(vendor)`, si `userRole === 'interno'` y `vendor === assignedVendor`, NO aplica `VENDOR_INCLUDES_OTHERS`. Antes 'IOANNIS PALKOUDAKIS' en el dropdown expandía a `{IOANNIS, FEDERICO, GONZALO}` — indistinguible de 'Todas mis zonas'. Ahora muestra únicamente los clientes propios del VDI (los de su `assignedVendor`). 'Todas mis zonas' sigue mostrando el union.

Impacto en Excel export: cuando el VDI está posicionado en su propio nombre y descarga el masterfile, el Excel trae únicamente sus tiendas (sin las de sus VDEs pareja).

### v330 (2026-07-27) — E2.b step 3: sapSL rutea via Cloud Function sapProxy — **Fase 0 al 100%**

Cambio funcional real que cierra E5+E2.b: las llamadas SAP dejan de ir directo desde el browser a `shimano-sap.seidor.com.ar` (con creds leídas de Firestore) y pasan por la Cloud Function `sapProxy` en `southamerica-east1` (creds en Secret Manager server-side).

**Cambio en `index.html:21452`** (método `sapSL.fetchWithSession`):
- Feature flag nueva: `sapSL.useCloudProxy = true` (default). Si se flipea a `false` desde Console vuelve al modo legacy sin redeploy.
- Lazy singleton `sapSL._getCloudClient()` obtiene `window.__phase0.sap.createSapClient(firebase, {region: 'southamerica-east1'})` una sola vez.
- Cuando useCloudProxy=true: la llamada rutea via `client.fetchWithSession(path, options)` → `httpsCallable('sapProxy')`.
- Cuando useCloudProxy=false o el bundle no cargó: fallback al fetch inline legacy (mismo código de antes, +warning en console).
- Los otros ~15 métodos del `sapSL` (loadConfig, login, ensureSession, createQuotation, getStock, getBpTemp, admin UI, etc.) NO se tocaron. Siguen funcionando exactamente igual porque llaman a `this.fetchWithSession(...)` que ahora rutea via el proxy.

**Cambio en `src/sap-client.js`**:
- Fix API compat SDK: usar `firebase.app().functions(region)` en vez de `firebase.functions(region)`. El namespace `firebase.functions(x)` solo acepta App instance como arg — pasar region string tiraba `firebase.functions-compat() takes either no argument or a Firebase App instance`. La forma correcta es obtener la App primero (`firebase.app()`) y llamar `.functions(region)` sobre ella.
- Typedef actualizado (`FirebaseAppLike` con `.functions(region?)`, `FirebaseNamespaceLike` ahora tiene `.app()`).
- Tests actualizados con nuevo mock shape.

**Cambio en `functions/index.js`**:
- Fix CORS: `cors: false` → `cors: true` (default). Con false el framework no responde al OPTIONS preflight que el browser manda antes del POST cross-origin — el preflight falla, el browser cachea el fallo, y todos los POSTs subsiguientes se cuelgan indefinidamente en el SDK client-side. Diagnóstico via `gcloud functions logs read sapProxy` que mostró `Request has invalid method. OPTIONS`.
- Ya deployado a prod (commit `9802133`).

**Bumps**:
- APP_VERSION v329 → v330 (index.html).
- CACHE_VERSION v329 → v330 (sw.js).

**Bundle regenerado**: 42.9 KB → 43.4 KB (+0.5 KB por firebase.app() interop).

**Tests**: 129/129 verdes.

**Verificación pre-merge** (F12 Console tras Ctrl+Shift+R):
```js
// Cualquier request SAP ahora rutea por el proxy. Sanity check:
console.log('cloud proxy activo?', sapSL.useCloudProxy);  // true
console.log('cliente listo?', !!sapSL._getCloudClient()); // true
sapSL.fetchWithSession('/b1s/v1/Items?$top=1&$select=ItemCode').then(r => console.log(r));
// Debe devolver {ok: true, body: {value:[...]}, status: 200} en <5 seg
```

**Rollback**: en Console `sapSL.useCloudProxy = false` → app vuelve al fetch legacy inmediato. Sin redeploy necesario.

**Pendiente post-v330** (opcional, cerrar el círculo de seguridad de E5):
- Borrar `app_config/sap_integration.serviceLayer.password` de Firestore (el fetch legacy queda sin creds, pero como useCloudProxy=true los ignora). Antes de borrar, dejar la app corriendo N días para confirmar que useCloudProxy=true no da problemas en operación real.
- Rotar la password (`Shi*99` es débil + leakeada en esta sesión). Ver 43.8.

### v329 (2026-07-27) — Preparación E2.b step 3: SDK + CSP + region

- **Contexto**: E5 sapProxy Cloud Function ya deployada en `southamerica-east1`. Para invocarla desde el browser vía `httpsCallable`, faltaban 3 piezas: (a) el SDK `firebase-functions-compat.js` (nunca se había incluido — la app no usaba Cloud Functions), (b) CSP `connect-src` que permita `*.cloudfunctions.net` (la URL de invocación del callable), y (c) `sap-client.js` acepta la region correcta (default `us-central1` daría 404 vs. deploy en `southamerica-east1`).
- **Cambios en `index.html`**:
  - Agregado `<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-functions-compat.js">` después de los otros 5 SDKs de Firebase.
  - `connect-src` agrega `https://*.cloudfunctions.net` (URL clásica del callable — Firebase la mantiene incluso para gen2).
- **Cambios en `src/sap-client.js`**:
  - `createSapClient(firebase, opts)` ahora acepta `opts.region` (default `'southamerica-east1'`).
  - Interno: `firebase.functions(region).httpsCallable(callableName)` en vez de `firebase.functions().httpsCallable(callableName)`.
  - Typedef `FirebaseNamespaceLike.functions` actualizado a `(region?: string) => FirebaseFunctionsLike`.
- **2 tests nuevos** en `tests/unit/sap-client.test.js` (default region + override) → total 129.
- Bumps: APP_VERSION v328 → v329, CACHE_VERSION v328 → v329.
- Bundle regenerado: 42.4 KB → 42.9 KB (+0.5 KB por region handling).
- **NO cablea el `sapSL` inline todavía**: la app en prod sigue fetcheando directo a SL como antes. E2.b step 3 (v330) es el que hace el swap real.

Test verificación en prod (después del deploy): F12 Console →
```js
const call = firebase.app().functions('southamerica-east1').httpsCallable('sapProxy');
call({ endpoint: '/b1s/v1/Items?$top=1&$select=ItemCode,ItemName', method: 'GET' })
  .then(r => console.log('✅ SAP proxy OK:', r.data))
  .catch(e => console.log('❌ SAP proxy FAIL:', e.code, '-', e.message));
```
Debe devolver `{status:200, body:{value:[{ItemCode:"...",ItemName:"..."}]}}`. Si sí, arrancar v330 (E2.b step 3).

### v328 (2026-07-27) — Fix CSP source map de Sentry SDK

- **Warning cosmético heredado desde v324**: cuando DevTools está abierto, Chrome intenta bajar el source map `https://browser.sentry-cdn.com/10.68.0/bundle.min.js.map` para tener stack traces más legibles al debuggear. `browser.sentry-cdn.com` estaba solo en `script-src` (para bajar el SDK), no en `connect-src` (para fetches AJAX/source maps). CSP bloqueaba el fetch → warning en Console.
- **Fix**: agregar `https://*.sentry-cdn.com` a `connect-src` (además de mantenerlo en `script-src`).
- **Sin impacto operativo**: los stack traces que llegan a sentry.io mantienen la posición del error sin depender del source map local — Sentry hace su propia deminification server-side con los source maps que subís (o si el bundle no está minificado como en nuestro caso, no hace falta).
- Bumps: APP_VERSION v327 → v328, CACHE_VERSION v327 → v328.
- Commit chico: 3 archivos (index.html + sw.js + README).

### v327 (2026-07-25) — Fix CSP wildcard: `*.ingest.sentry.io` → `*.sentry.io`

- **Bug de v326**: mi fix de CSP puso `https://*.ingest.sentry.io` en `connect-src`, pero el host real del ingest de Sentry es `<org>.ingest.us.sentry.io` (subdominio regional US, formato `oXXXXX.ingest.us.sentry.io`). CSP wildcards requieren que el sufijo matchee exacto — `*.ingest.sentry.io` solo matchea hosts que terminen en `.ingest.sentry.io`, no `.us.sentry.io`. Resultado: v326 desbloqueaba el loader (SDK bajaba OK) pero cuando Sentry intentaba POST-ear los eventos al ingest, el browser los bloqueaba silenciosamente por CSP. Sentry seguía sin capturar nada, ~1 día más.
- **Diagnóstico**: fetch al loader `https://js.sentry-cdn.com/{publicKey}.min.js` reveló el DSN completo `https://<publicKey>@o4511788116344832.ingest.us.sentry.io/<projectId>`. El subdominio `.us.` no lo cubre `*.ingest.sentry.io`.
- **Fix**: cambio `connect-src` a `https://*.sentry.io` (cubre todas las regiones: US, EU, futuras — es el pattern recomendado por Sentry para CSP).
- Bumps: APP_VERSION v326 → v327, CACHE_VERSION v326 → v327.
- Commit chico: 4 archivos tocados (index.html + sw.js + README top + README 42.3).

### v326 (2026-07-25) — Fix CSP para Sentry (hotfix sobre E7)

- **Bug de E7**: la CSP en `index.html:8` no incluía los dominios de Sentry, así que el loader `js.sentry-cdn.com` quedaba bloqueado y ningún error se estaba reportando desde el deploy de v324 (~24h de blackout de Sentry).
- Fix:
  - `script-src` agregó `https://*.sentry-cdn.com` (cubre `js.sentry-cdn.com` + `browser.sentry-cdn.com`; el loader carga el SDK desde estos hosts).
  - `connect-src` agregó `https://*.ingest.sentry.io` (endpoint donde Sentry POST-ea los eventos al backend).
- Commit directo a `main` (no rama), 3 archivos tocados, 5 insertions / 5 deletions.
- Verificado en prod (Chrome F12 Console): desaparece el error `Loading the script 'https://js.sentry-cdn.com/...' violates the following Content Security Policy directive`.

### v325 (2026-07-25) — E2.b steps 1+2 (Fase 0): index.html consume 10 fns puras + sentry desde bundle

Split de E2 en dos porque extraer 28K líneas inline en un shot era demasiado riesgo. E2 (v324→v325) dejó el pipeline y el bundle aditivo; **E2.b steps 1+2 (v325)** hace el consumo real desde el bundle.

**Nuevo pipeline `build.js` + `app.bundle.js` en repo root**:
- `npm run build` produce `./app.bundle.js` (41 KB IIFE, sourcemap inline). Bundle de `src/main.js` que importa 10 funciones puras + sentry helper + sap-client factory.
- `app.bundle.js` va commiteado a `main` porque GitHub Pages sirve directo del root sin build step. Regenerar tras cualquier cambio en `src/**`.
- `dist/` deprecated (nota en `.gitignore`).

**Cambios en `index.html`** (v324 → v325):
- `<script src="./app.bundle.js"></script>` blocking en `<head>` después del bloque Sentry.
- Bloque nuevo "Fase 0 E2.b" después del version-check con:
  - **Fail-fast**: `throw` si `window.__phase0` no cargó — no degradación silenciosa.
  - **7 alias byte-idénticos**: `normClientName`, `titleCase`, `escapeHtml`, `normTitle`, `_normalizeSearch` (aliasado a `normalizeSearch` del bundle), `calcClientDiscount`, `matchesAllTokens`.
  - **3 wrappers para fns refactoradas en E4**: `findSapDuplicateForProvisorio(prov)`, `matchSkuFromTitle(meliTitle)`, `passesTypeFilter(name)` — pasan los globales al call time.
  - `applySentryUserContext` movido del `<head>` inline al bloque de assignments del script principal.
- **10 definiciones inline borradas** (~120 LOC): `normClientName`, `titleCase`, `escapeHtml`, `normTitle`, `_normalizeSearch`, `calcClientDiscount`, `matchesAllTokens`, `findSapDuplicateForProvisorio` (+ helpers `_DUP_STOPWORDS`, `_nameTokens`), `matchSkuFromTitle`, `passesTypeFilter`.
- **Inline `window.applySentryUserContext = function...` en `<head>` borrado**.

**Cambios en `sw.js`** (v324 → v325):
- `CACHE_VERSION` bump.
- `./app.bundle.js` agregado a `STATIC_ASSETS` para offline PWA.

**Tests nuevos**:
- `tests/unit/sap-client.test.js`: 8 tests (mock `httpsCallable`, defensa SSRF client-side, error mapping, `createQuotation` compat).
- `tests/smoke/bundle-runtime.test.js`: 19 tests Node-based (`vm.runInNewContext`). Verifica artifacts + wiring del source (script tag + assignments + fail-fast + regex confirma que las 10 defs inline NO existen) + APP_VERSION == CACHE_VERSION + sw.js incluye `./app.bundle.js`.

**Métricas del delta**:
- `index.html`: -79 líneas (28,561 → 28,482), size 2.14 MB (casi igual — assignments block y comments compensan las 10 fns borradas).
- Tests: 100 → 127 (+27: 8 sap-client + 19 smoke).
- Rama `fase-0` cerró con 9 commits (E0–E7 + E2.b), rebase + fast-forward a `main` (regla del repo: no merge commits).

**Verificado en browser real** (Chrome F12 Console):
- `window.__phase0` poblado con `{version, pure, sentry, sap}`.
- `window.titleCase('hola mundo') === 'Hola Mundo'` (bundle sirviendo).
- `window.calcClientDiscount({cliTipo:'P'}, 5_000_000, 'CONTADO').pctTotal === 14` (6% fijo + 3% vol + 5% antic).
- Todos los handlers que dependen de las 10 fns (Firestore listeners, mapa, catálogo, SAP sync, alta cliente) funcionan sin cambios visibles al usuario.

**Pendientes** (E2.b steps 3-4, fuera de este release):
- Step 3: cablear `sap-client.js` (bloqueado hasta E5 en prod + E2E TST_06 OK).
- Step 4: extracción por dominio (auth/clients/orders/etc). Requiere Playwright funcionando.

### v324 (2026-07-24) — Sentry integrado (Fase 0 E7)
- Loader CDN de Sentry (`js.sentry-cdn.com/{publicKey}.min.js`) en el `<head>` después de los SDKs de Firebase.
- `Sentry.onLoad` dispara `Sentry.init({release: APP_VERSION, environment:'production', tracesSampleRate:0.0})`.
- Helper `applySentryUserContext(sentry, user, role, vendor)` inline en `index.html` (duplicado también en `src/sentry.js` para tests). Llamado post-login desde `fetchAndApplyRole` con el rol + vendor del user.
- Errores JS en producción viajan a sentry.io con `tags: {role, vendor}` para poder filtrar.
- 7 tests unitarios de `applySentryUserContext` (happy, logout, defaults, sentry no cargado, sentry sin métodos, setUser lanza, user sin email).
- Ver sección 42.3 para operativa (rotación de public key, disable, etc.).

### v323 (2026-07-23) — Fix A performance: geometrías del mapa lazy-loaded
- Extraídas `DEPT_GEO` (1.37 MB, 527 departamentos) y `PROV_GEO` (400 KB, 24 provincias) a `geo.json` externo (1.56 MB).
- `index.html` baja de **3.74 MB → 2.01 MB (-46%)**.
- Al arranque las variables son `{features: []}` vacías. IIFE `loadGeoAsync()` dispara `fetch('./geo.json')` en background, popula ambas y re-renderiza:
    * `deptLayer` + `provLayer` (Leaflet)
    * `vendorProvinces` (set por vendor → provincias)
    * `_vendorOutlinesCache` invalidado + `drawVendorOutlines()`
    * `updateStats` con `filteredPoints`
- `sw.js` v323 agrega `geo.json` a `STATIC_ASSETS` (pre-cache al instalar). Segunda carga: instantánea desde cache SW.
- Reversible: git revert restaura DEPT_GEO/PROV_GEO hardcoded.

### v322 (2026-07-23) — Notificaciones: "Marcar todas como leídas"
- Nuevo header arriba de la lista Recibidas: `N pendientes` + botón teal.
- `markAllNotifsRead()`: confirm previo con N + batch write en Firestore (loops de 400 ops por batch, respeta límite de 500).
- Listener `onSnapshot` limpia la lista al toque cuando llegan los updates.
- Casos como 280+ notificaciones se limpian en un solo click.

### v321 (2026-07-23) — Cards SAP: localidad/provincia en línea separada abajo
- `client-meta` se divide en 2 divs consecutivos:
    * Línea 1: badges `[SAP EN MAPA]` + `[SAP CXXXX]` o `[PROVISORIO]`
    * Línea 2: `Localidad / Provincia`
- Fix layout cuando CardCodes largos o nombres de localidad extensos causaban wrap desprolijo.

### v320 (2026-07-23) — Filtros CLIENTES renombrados a lenguaje del negocio
- Botón `CONFIRMADOS` → **`CLIENTE EN SAP`**.
- Botón `NO CONFIRMADOS` → **`PROVISORIOS`**.
- Alineación semántica con colores de cards (v317). Valores internos (`confirmados`/`pendientes`) sin cambios.

### v319 (2026-07-23) — Badge SAP/PROVISORIO a línea meta (después de v318 UX)
- Fix del intento v318 (badge absolute arriba a la derecha) que apretaba nombres largos.
- Nueva CSS `.cli-origen-inline` (display inline-flex).
- El badge se emite dentro de `<div class="client-meta">` entre el `SAP EN MAPA` y la localidad.
- Padding-right de card vuelve a 62px.

### v318 (2026-07-23) — Intento inicial: badge SAP/PROVISORIO a esquina superior
- Movió el badge de al lado del nombre a esquina superior derecha (`.cli-origen-corner` absolute).
- Padding-right de card aumentado a 200px.
- **Deprecado en v319** por feedback UX del user: apretaba nombres/titulares largos.

### v317 (2026-07-23) — Cards CLIENTES/PEDIDOS coloreadas por origen
- Sidebar CLIENTES (`renderClients`): cards SAP con `background:#e0f2fe` (celeste clarito) si es provisorio, `#dcfce7` (verde clarito) si es SAP habilitado con cardCode. Precaución (amarillo) mantiene prioridad.
- Tab PEDIDOS (`renderCrearList`): cards con el mismo esquema + borde izquierdo del color acorde (azul para provisorio, verde para SAP habilitado, ámbar oscuro para precaución).
- Antes: todas las cards tenían el mismo fondo blanco/default, imposible distinguir origen del cliente de un vistazo.

### v316 (2026-07-23) — Detector de duplicados SAP vs Provisorios
- Nuevo helper `findSapDuplicateForProvisorio(prov)`: busca en `approvedAltasList` un SAP habilitado con misma provincia + misma localidad + nombre "similar".
- Similaridad: `contains` cruzado (uno dentro del otro) o ≥2 tokens significativos comunes (≥3 letras, sin stopwords tipo `de/la/el/pesca/tienda/store/srl`).
- Prefiere falsos positivos que falsos negativos (mejor ver muchas cards rojas y descartar que perder duplicados).
- Aplicado en `renderMcProvisoriosTable` + `renderMasterClientesTable`: fila roja `#fee2e2` + borde izquierdo rojo + badge `⚠ DUPLICADO SAP CXXXXXX` + tooltip.
- Sin borrado automático — admin decide qué eliminar.

### v315 (2026-07-23) — Buscador de tiendas form Visita: badge visible + refresh en vivo
- Fix A: badge `⚡ PROVISORIO` texto llamativo en el dropdown `vf-tienda` (antes solo un emoji chico ignorado, causaba que el vendedor picara POINT del padrón por error).
- Fix C: hook en el listener de `approvedAltasList` que re-llama a `populateVisitaLocalidades()` cuando el modal Visita está abierto en tab "Nueva". Los provisorios recién creados aparecen al toque en el dropdown sin cerrar/reabrir el modal.
- Guardián: si el input `vf-tienda-search` tiene foco (usuario escribiendo), difiere el re-populate para no cortar la búsqueda.

### v314 (2026-07-23) — Registro de Contacto: campo Forma de contacto
- Modal Visita en modo `contacto`: nueva fila **"Forma de contacto"** después de "Tipo de tienda". Opciones: LLAMADA TELEFONICA / MENSAJE DE WHATSAPP / MENSAJE SMS. Obligatorio.
- `applyVisitModeUI` muestra/oculta la fila según modo. `submitVisita` valida y guarda como `formaContacto`.
- BQ: `v_visitas` agrega columna `forma_contacto` (STRING). NULL para docs pre-v314 y visitas físicas.

### v313 (2026-07-23) — Buscadores flexibles multi-token AND
- Nuevo helper `matchesAllTokens(haystack, query)`: divide query por espacios, exige que TODOS los tokens aparezcan en el haystack. Normaliza acentos vía NFD.
- Aplicado en 4 buscadores: CLIENTES sidebar (`clientMatchesQuery` + SAP altas), PEDIDOS sidebar, Master Clientes vista normal, Master Clientes Provisorios.
- Ejemplos que ahora funcionan: `"el pez gordo quilmes"`, `"pescamagic buenos aires"`, `"gonzalo cordoba"`.
- Pendientes de aplicar el mismo helper: Localidades, form Visita tienda, Vincular con SAP, Rendiciones TODAS, Zonas.

### v312 (2026-07-23) — Export masterfile Clientes incluye Provisorios
- Antes: `exportMasterClientes` filtraba `!cardCodeSap → skip`. Los provisorios (Alta rápida) quedaban afuera del Excel.
- Ahora: detecta `isProvisorio = manualSapPending && !cardCodeSap` y los incluye con `Tipo="Provisorio (Alta rapida)"` + `Estado="Provisorio"`. Se aceptan sin dirección.
- Bugfix: `seen.add(dupKey)` que faltaba (evitaba duplicados si un habilitado y un provisorio compartían nombre+provincia).

### v311 (2026-07-22) — Targets descompuestos por familia REEL/CAÑAS/LÍNEAS
- Modal Targets: 3 columnas de familia + columna Total (readonly, calculado en vivo).
- Firestore: doc agrega `targetByFamily: {REEL, CANAS, LINEAS}` map. `targetArs` sigue siendo el total (retro-compat).
- BQ: `v_targets` amplía con `target_reel_ars` / `target_canas_ars` / `target_lineas_ars`.
- Sync grande: nueva función `_load_to_bq_with_schema` con schema explícito para targets (evita drop de columnas null por autodetect).
- Fix `ALTER TABLE targets_raw ADD COLUMN` aplicado en BQ para docs pre-v311.

### v310 (2026-07-21) — Targets autosave al escribir
- Antes: había que apretar "Guardar Targets" al final; si cerrabas el modal antes, se perdían los cambios.
- Ahora: `onTgtInputChange` programa `_saveTargetFor(id)` con debounce 900ms. Feedback visual (`.saving` azul / `.saved` verde flash).
- `closeTargetsPanel` hace flush sync de cualquier pendiente antes de cerrar. Cero pérdida de datos.

### v309 (2026-07-21) — Directores auto-aprueban rendiciones
- Nueva `SELF_APPROVE_RENDICIONES_EMAILS = Set(['diego.valsi@shimano.uy'])`. Emails en la lista no necesitan responsable de rendiciones.
- `submitRendGasto` + `submitRendSolicitud`: bypass del check + doc queda `status='approved'` desde el submit + `approvalNote='Auto-aprobada (director del area)'`. Skip notificación.
- Extensible: sumar emails al Set para agregar otros directores.

### v308 (2026-07-21) — Rendiciones foto a Firebase Storage + vistas BQ
- Cargar Firebase Storage SDK 10.7.1.
- `submitRendGasto` sube foto a `rendiciones/{ownerUid}/{ts}_ticket.{ext}` y guarda solo `fotoTicketUrl`. Doc pasa de 50-500KB a ~1KB.
- Retro-migración: `scripts/migrate_rendiciones_foto_to_storage.py` movió 45/45 fotos históricas.
- BQ: nuevas vistas `v_rendiciones` (46 filas) + `v_rendiciones_duplicados` (3 casos sospechosos).
- Retro-compat: `openRendicionDetail` y export Excel prefieren `fotoTicketUrl` sino caen a `fotoTicket` base64.

### v307 (2026-07-21) — Contactado Fase B: badges + filtro por tipo
- Menú contextual del cliente: "Revisar última visita" → **"Última interacción"**.
- Modal `cv-modal`: título renombrado + badge visual `🟣 Visita` (violeta) o `📱 Contactado` (teal) al lado de la fecha.
- Contador de anteriores desglosa: `+ N interacciones anteriores (X visitas + Y contactos)`.
- Lista "Mis visitas" (modal Visita → tab list): **nuevo filtro** dropdown `Visitas + Contactos / Solo visitas / Solo contactos` + badge por card.
- Retro-compat: docs sin `interactionType` se tratan como visita.

### v306 (2026-07-21) — Contactado celeste + Dashboard bordó + editar prov/loc en Provisorios
- Tab Contactado pasa de teal a **celeste `#00A9E0`** (mismo grupo CSS que Rutas y Visita).
- Botón Dashboard (barra superior) pasa de celeste a **bordó `#7f1d1d`** / hover `#991b1b`.
- Master Clientes → Provisorios: columnas **Localidad** y **Provincia** editables inline con autosave. Marcan `provinciaLocSource='manual'` para que el sync SAP no las pise. Limpian `lat/lng` para forzar re-geocoding.

### v305 (2026-07-21) — Contactado Fase A: modal Visita en modo `contacto`
- Nueva variable global `window.visitMode = 'visita' | 'contacto'`.
- `openVisitaModal(mode)` acepta parámetro (default `'visita'`, retro-compat).
- `applyVisitModeUI(mode)` cambia visualmente el modal: header teal, título "Registro de Contacto (no presencial)", ocultar filas de fotos (`vf-espacio-row` + `vf-frente-row`), botón submit teal "Registrar contacto".
- `submitVisita` agrega campo `interactionType='contacto'` al doc de `visits`.
- Tab Contactado ahora abre `openVisitaModal('contacto')`.
- Pane placeholder eliminado (ya no se usa).

### v304 (2026-07-21) — Reorganizar barra superior: Dashboard como botón + tab Contactado (placeholder)
- Botón Dashboard movido desde la grilla de tabs (posición 6) hacia la barra superior derecha, al lado de "Campañas Activas". Estilo turquesa `.btn-dashboard` (ya existía en CSS + media queries mobile).
- Nueva tab **Contactado** en el slot donde estaba Dashboard. En v304 era placeholder; funcional desde v305.
- `setTab` contempla el nuevo pane.

### v303 (2026-07-21) — Edit inline nombre+vendedor también en Master Clientes vista normal
- Fix del v302: los inputs editables solo aparecían en el modo "botón violeta Provisorios" (`renderMcProvisoriosTable`). En la vista default de Master Clientes (`renderMasterClientesTable`) las filas provisorias seguían mostrando texto readonly.
- Ahora en `renderMasterClientesTable`, cuando `isSap && !e.sapCardCode` (provisorio) y `userRole` es admin/gerente:
  - Columna Tienda: input editable → `saveMcProvisorioComercio`
  - Columna Vendedor: `<select>` VDE+VDI → `saveMcProvisorioVendor`
- Las 2 funciones ya existían del v302, solo faltaba invocarlas desde este renderer.

### v302 (2026-07-21) — Modal ZONAS + Master Clientes editables para provisorios
- **Modal ZONAS** acepta provisorios (`manualSapPending && !cardCodeSap`) con badge amarillo "⚡ PROVISORIO". Ya no exige `cardCode` ni dirección para incluirlos en el listado.
- **Master Clientes tab Provisorios**: nombre del comercio y vendedor editables inline con autosave. Nombre escribe a `comercio` (o `fantasia` si no había comercio). Vendedor escribe a `assignedVendor` + resuelve `ownerUid` matcheando displayName en `roles` (así el vendedor asignado ve el provisorio en su lista personal).
- **BigQuery paralelo (mismo día)**:
  - `v_facturas_sap` agrega `paid_to_date` + `saldo_ars` (compat medidas PBI que respetan criterio SlpCode).
  - `v_ventas_lineas` agrega `cobrado_prorrateado_ars` + `deuda_prorrateada_ars` a nivel línea. Permite `[Cobrado ARS] + [Deuda ARS] = [Facturación Total]` exacto.
  - `sync_sap_to_bigquery.py` agrega `PaidToDate` al `$select` de Invoices (evita que autodetect dropee la columna en cargas futuras).
  - `patch_paid_to_date.py` one-off idempotente que agrega la columna sin tocar `lines_json`.
  - 3 vistas nuevas de deuda (creadas 2026-07-20, aplicadas hoy): `v_deuda_por_vendedor`, `v_deuda_facturas_detalle`, `v_facturado_cobrado_deuda_por_vendedor`.

### v204 → v292 — Archivadas en poda v380

> Contenido movido a [`CHANGELOG-ARCHIVE-v204-v299.md`](./CHANGELOG-ARCHIVE-v204-v299.md) (bloque A) el 2026-08-02. Son ~90 entries cortas (~6 líneas c/u) del histórico pre-v300, referencia opcional. Titulares destacados: **v217** Rendiciones v2 (Híbrida Opción C) + bucket Storage nuevo · **v219-v220** envío a SAP via Service Layer · **v246** 🎯 sync automático SAP → Firestore + stock.json (fin del CSV manual de David) · **v268** 💰 sync automático de precios desde SAP · **v274** VISITAS: foto desde galería + filter-select búsqueda · **v288** fix definitivo sync BPs pesca `U_DIVISION IN ('2','3')` + provincia canónica · **v291** autosave debounced + fix crítico sync SAP (preserve manual localidad/provincia).


### v301 — Modal de pedido PENDIENTE muestra vista previa del pedido + sugeridos side-by-side

**Pedido**: en modal de pedido PENDIENTE, además de ver "Sugeridos para este cliente" (que ya estaba), ver también una **vista preliminar del pedido cargado** para contrastar contra los sugeridos y decidir qué agregar.

**Antes**: la clase CSS `pending-suggest-only` explícitamente ocultaba `#pm-current-wrap` (línea 1320 del CSS antiguo) — solo se veían los sugeridos ocupando todo el ancho.

**Ahora**: layout 2 columnas dentro de `.pedido-right`:
- Izquierda: **Sugeridos para este cliente** (naranja) — sin cambios.
- Derecha: **Ya cargado en este pedido** (verde `#f0fdf4` + border `#86efac`, sticky top) — muestra las líneas del pedido con precio y cantidad como texto plano (los inputs quedan sin borde, sin background, `pointer-events:none`).

**Título dinámico**: `"Ya cargado en este pedido · N producto(s) · M unidades"` (calculado en JS al abrir).

**Read-only en pending**: los inputs de cantidad/precio y el botón X (eliminar) se ocultan. Para editar el pedido, el user debe usar el botón **"Volver a borrador"** que ya existía. Esta es una vista de comparación, no de edición.

**Mobile (<900px)**: los 2 bloques se apilan verticalmente, el pedido actual pierde el `max-height:65vh` para poder scrollear la página entera.

**Backend sin cambios**. Todo es CSS + un par de líneas en `openPedidoModal` para actualizar el título del bloque.

### v300 — Buscador de tienda en Visita: matchea por fantasía O titular

**Bug reportado**: en el form de Visita el vendedor buscaba por fantasía (ej. "LA PALOMETA") y no encontraba la tienda porque el label del dropdown solo mostraba el titular ("ALAN OSCAR NICOLAS RODRIGUEZ — MUNRO, Buenos Aires"). El filter-select del componente `fs` matchea por substring del label, entonces si la fantasía no está en el label, no se encuentra.

**Fix** en `populateVisitaLocalidades()`:
- Nuevo pre-índice `fantasiaByName: Map<nombre_normalizado, fantasia>` construido desde `approvedAltasList` — cubre las 3 rutas de match (comercio, titular, fantasia) para que POINTS legacy también sepa qué fantasía usar.
- Nuevo helper `buildLabel(titular, fantasia, loc, prov, badge)`: emite `"Fantasía (Titular) — Loc, Prov"` cuando la fantasía es distinta del titular, o solo `"Titular — Loc, Prov"` si son iguales o no hay fantasía. El filter matchea el label completo → **busca por fantasía o por titular indistintamente**.
- Sort key: usa el nombre grande (fantasía cuando existe, sino titular) para que el dropdown salga alfabéticamente por lo que el vendedor ve primero.
- El `value` del filter-select sigue siendo `"PROV||Loc||Titular"` (el save espera el titular en `v.tienda`).

**Antes**:
```
ALAN OSCAR NICOLAS RODRIGUEZ — MUNRO, Buenos Aires
```
Buscar "PALOMETA" → 0 resultados.

**Ahora**:
```
LA PALOMETA BAIT SHOP (ALAN OSCAR NICOLAS RODRIGUEZ) — MUNRO, Buenos Aires
```
Buscar "PALOMETA" ✅ / Buscar "ALAN" ✅ / Buscar "MUNRO" ✅.

**Schema del doc `visits` sin cambios**: sigue guardando `tienda: "ALAN OSCAR NICOLAS RODRIGUEZ"` (el titular). Los reportes y timeline por cliente siguen agrupando por titular.

### Fix sync SAP: preservar nombre de fantasía manual (2026-07-14, script)

**Bug reportado por Mariano**: cargó manualmente ~10 nombres de fantasía en clientes; a los 2-3 días desaparecieron. Después el bulk import (103 fantasías desde el Excel del formulario alta) — mismo riesgo: el próximo cron los pisaría.

**Causa**: `sync_sap_to_firestore.py:upsert_bp_pesca_to_firestore()` incluía siempre `'fantasia': cardname` en el `base_payload`. El `set(merge=True)` cada 30 min pisaba la fantasía manual con el CardName raw de SAP ("GABRIEL ALEJANDRO YAMIN" en vez de "ARMERIA EL COLORADO").

**Fix**: mismo patrón que aplicamos en v291 para localidad/provincia. Después de armar el `base_payload` y antes del write, chequeamos si el doc en Firestore ya tiene `fantasia` distinta del `comercio` y distinta del `cardname` — si sí, es una fantasía manual real → `pop('fantasia')`. El sync solo setea fantasia default (cardname) cuando el doc no la tenía cargada (CREATE) o cuando estaba vacía / igual al comercio.

**Auditoría**: log line `[bp] preserva fantasia manual: C{cuit} keep='X' (sap dice 'Y')` en cada corrida del cron — permite ver en logs de GH Actions cuántas fantasías está preservando y cuáles.

**No es un cambio en la app frontend** — el fix vive en el script Python del cron. `APP_VERSION` no cambia. El proximo corrida del workflow `.github/workflows/sync-sap-catalog-stock.yml` a hh:13/hh:43 ya lo va a aplicar.

### v293 → v299 — Archivadas en poda v380

> Contenido movido a [`CHANGELOG-ARCHIVE-v204-v299.md`](./CHANGELOG-ARCHIVE-v204-v299.md) (bloque B) el 2026-08-02 como parte de la poda v380. Titulares: **v293** fix tab "NO CONFIRMADOS" vs KPI PENDIENTES · **v294** vincular provisorios con BPs SAP (CUIT + botón manual) · **v295** badge Cat P/A/B/C fijo en esquina de card · **v296** ortografía "MOSTRADO" → "MOSTRADOR" · **v297** export Excel targets formato largo (SAP/PBI) · **v298** gerente ve todas las visitas + comentarios · **v299** form Visita busca directo por tienda + localidad autocompleta.

---

## Convenciones del documento

**Cuando se actualice esta app**, mantener este README sincronizado con:
1. Nuevas features → agregar sección o ampliar la existente.
2. Cambios en modelo de datos → actualizar sección 8.
3. Cambios en Firestore Rules → actualizar sección 9.
4. Nuevos roles → actualizar sección 7.
5. Nuevas colecciones → actualizar secciones 8 y 9.
6. Cambios en el lanzamiento (bloqueantes resueltos) → actualizar sección 2.
7. SW version → actualizar el header del documento + sección 41 (Changelog).
8. Cambios en el flow SharePoint / Power Automate → actualizar sección 16-bis + `POWER_AUTOMATE_RENDICIONES.md`.
9. Cambios en `scripts/send_rendiciones_email.py` (estructura del Excel, columnas, tablas) → actualizar el subapartado del cron en sección 16 (Mail Rendiciones).
10. Cambios en SEGUIMIENTO (tabs, heurísticas, scope, status flow) → sección 39.
11. Avance del plan Power BI → sección 40 (resumen) + `PLAN_POWERBI.md` (detalle).

---

**Última actualización**: 2026-07-14 — SW v301. Día intenso con múltiples pedidos del gerente + vendedores + refactor de UX + pipeline BigQuery → Power BI completo + 2 documentos PDF de referencia (Manual técnico + Análisis crítico con roadmap).

Highlights sesión completa 2026-07-14 (detalle en sección 41):

- **📄 2 documentos PDF para sucesor** — `APP SHIMANO MANUAL.pdf` (33 pág) doc técnica completa + `MEJORAS.pdf` (21 pág) análisis crítico con 12 puntos débiles priorizados y roadmap por horizontes. Generadores versionados en `scripts/build_manual_shimano.py` y `scripts/build_mejoras_shimano.py`.
- **🛒 v301 - Modal pedido PENDIENTE con vista previa** — antes solo se veían sugeridos ocupando todo el ancho; ahora layout 2 columnas (sugeridos | pedido ya cargado) para poder comparar. Read-only, editar sigue siendo con "Volver a borrador".
- **🔍 v300 - Buscador de tienda en Visita matchea por fantasía O titular** — label ahora "Fantasía (Titular) — Loc, Prov". Buscar "PALOMETA" encuentra a "ALAN OSCAR NICOLAS RODRIGUEZ (LA PALOMETA BAIT SHOP)".
- **🏪 v299 - Form Visita simplificado: ir directo a tienda** (pedido de vendedores) — sacar el paso de elegir localidad primero. Al elegir tienda, se autocompleta la localidad con badge celeste "📍 Localidad detectada".
- **👥 v298 - Gerente ve todas las visitas + comentarios** (pedido de Pablo por Teams) — fix client-side de 2 líneas, Firestore Rules ya lo permitía.
- **🔧 Bulk import 103 fantasías desde Excel formulario** cruzando por CUIT + fix crítico del sync SAP que las pisaba cada 30 min (mismo patrón v291 con localidad/provincia). Ejemplo: "GABRIEL ALEJANDRO YAMIN" ahora muestra "ARMERIA EL COLORADO" como nombre grande.
- **🗺️ Bulk fix 22 provincias mal cargadas** (bug SAP prod: YAMIN CHUBUT→SALTA, TOMPY CHUBUT→SALTA, etc.) cruzando por CUIT contra Excel formulario, con validación de lista canónica de 24 provincias AR + CABA para no aceptar valores raros como "BS AS" o "7600.0". Sync SAP extendido con protección análoga a fantasía.
- **📧 Suscripción diaria de Power BI por email a Mariano** — Power BI Service manda automáticamente a las 15:00 AR el snapshot del tablero "Desempeño-Pesca" + PDF con todas las páginas. Refresh programado del modelo semántico a las 14:30.
- **📊 Pipeline `v_targets` (Firestore → BigQuery)** — nueva función `sync_targets_from_firestore()` en el cron. Nueva vista `v_targets` con schema pedido: `slp_code, vendedor, anio, mes (1-12), target_ars, _sync_timestamp`. Mapeo vendorKey → SlpCode hardcoded en un CASE (50-55).
- **⚠️ Discrepancia SlpCode confirmada contra SAP prod** — SlpCodes 50-55 NO existen aún en `SHIMANO_SAU` (consultado `/SalesPersons`). Firestore `sap_vendors` tenía mapeo corrido en -1. SEIDOR debe crearlos como parte del lanzamiento.
- **🩹 `v_facturas_sap` sin `lines_json`** — el JSON string gigante hacía explotar VertiPaq en Power BI Desktop y colgaba el refresh 30+ min. Removida esa columna.
- **🔄 Rollback completo del fix "gap huérfano"** en `v_backorder_lineas` — el intento de ampliar `v_sap_items_enriched` para incluir 2287 SKUs BIKE con backorder colgaba Power BI del user. Rollback en 2 pasos (quirúrgico → total). SQL amplio queda en git como referencia (commit `e5cef77`).

Highlights v290→v297 (2026-07-13, frontend, detalle en sección 41):

- **📊 Export Excel de Targets en formato largo** (v297, para SAP / Power BI). Botón verde en el modal Targets → `Targets_Shimano_YYYY-MM-DD.xlsx` con columnas `SlpCode | Vendedor | Año | Mes | Meta`, una fila por (vendedor, mes) con target > 0. SlpCode y Vendedor resueltos desde `sap_vendors`. Detalle en sección 22.
- **✍️ Fix ortográfico "MOSTRADO" → "MOSTRADOR"** (v296, reportado por vendedor). Selects Tipo de venta + Necesidad puntual + label ponderación + Excel exports. Value en Firestore sigue siendo `'MOSTRADO'` (retrocompat), solo se mapea el display.
- **🏷️ Badge Categoría (Cat P/A/B/C) fijo en esquina de card** (v295). En CLIENTES `position:absolute; top:6px; right:8px` — siempre visible sin importar el largo del nombre. En PEDIDOS va en el cluster derecho arriba del Habilitado (para no chocar). `padding-right:62px` reservado en `.client-card`.
- **🔗 Vincular provisorio con BP SAP** (v294). Cuando el auto-match del cron falla (nombre difiere, provisorio sin CUIT), admin va a **Master Clientes → 👤 Provisorios → 🔗 Vincular con SAP** y elige manualmente el BP correcto. Auto-ranking con badge verde "✓ CUIT MATCH" si los CUITs coinciden. `batch.set(provisorio) + batch.delete(bp_duplicado)`. Preserva assignedVendor/approvals/notas. Solo admin (por Firestore Rules).
- **📋 CUIT opcional en form Alta Rápida** (v294). Nuevo input `ar-cuit` normalizado (solo dígitos). Aviso si != 11 dígitos. Blinda el auto-match futuro por CUIT (el sync ya lo consume vía `_norm_cuit()` sin cambios).
- **🐛 Fix tab "NO CONFIRMADOS" mostraba 3 items cuando el KPI PENDIENTES decía 16** (v293). El filtro descartaba provisorios sin provincia y los que tuvieran geo+addr. Ahora todo provisorio (`manualSapPending && !cardCodeSap`) siempre pasa el filtro "pendientes" y no requiere provincia. Bonus: badge naranja "⚠️ sin provincia" en lugar de `/` suelto.
- **🐛 Fix `sync_sap_to_firestore.py` pisaba localidad/provincia manuales** (v291, 2026-07-13 mañana). El sync cada 30 min hacía `set(merge=True)` con string vacío si SAP no traía valor → destruía el trabajo manual del admin en Master Clientes. Fix: `base_payload.pop('localidad', None)` si `bp.City` viene vacío, mismo para provincia.
- **💾 Autosave debounced en localidad/provincia/dirección del Master Clientes** (v291, filas SAP). Guarda 900ms después del último tipeo. El listener de `approvedAltasList` ya no re-renderea si hay saves en vuelo (evita perder texto por race con el snapshot).
- **👤 Botón "Provisorios" violeta en Master Clientes** (v290). Filtra altas rápidas pendientes de SAP (`manualSapPending && !cardCodeSap`). Badge de conteo en tiempo real. Tabla dedicada `renderMcProvisoriosTable()` con columna "Acción" (v294).

Highlights v282→v289 (BigQuery views para hoja Inventario + sync BPs pesca, 2026-07-08→2026-07-12):

- **📊 Vistas nuevas `v_ventas_lineas` + `v_backorder_lineas` para hoja "Inventario" de Power BI** (2026-07-10). `v_ventas_lineas` explota `lines_json` de facturas con `LEFT JOIN` a `sap_items_raw` para tener familia/subfamilia + flag `is_pesca`. `v_backorder_lineas` idem sobre `sap_orders_raw` (SO abiertas) con `LEFT JOIN` a próximos PO por SKU para columna `prox_embarque_date` y estado ASIGNADO/SIN ASIGNAR.
- **🩹 Parche encoding + familias manuales en `v_ventas_lineas`/`v_backorder_lineas`** (2026-07-12). El catálogo embebido en `index.html` perdió acentos/eñes (bytes latin-1 leídos como UTF-8 → `U+FFFD`). Parche con REPLACE encadenados en las views SQL para mostrar `Caña`/`Tamaño`/`Acción`/etc correctos en Power BI. Además, 7 SKUs pesca reales facturaron `~1.96M ARS` con `familia=''` (sin match en catálogo): parche manual con `CASE WHEN item_code IN (...)` mapea `CVC66H2CSA`, `CVC66MH2`, `CVC66MH4SACO`, `FXPR410`, `12843-01`, `55CRT12524` → `CAÑAS`; `471512` → `FG`. Fix definitivo pendiente en el build del catálogo maestro (`_build_argentina_zonas_v2.py`).
- **🔍 Scripts diagnóstico** (`scripts/check_ventas_facturado.py`, `scripts/investigate_pesca_sin_familia.py`, `scripts/check_encoding_bytes.py`). El primero mide cobertura de familia + top SKUs por unidades/facturado. El segundo lista SKUs `is_pesca=TRUE` con `familia=''` para identificar los que faltan en el catálogo. El tercero valida con `TO_HEX(CAST(x AS BYTES))` que los bytes UTF-8 en BQ son correctos (`0xC3B1=ñ`, `0xC3B3=ó`) — útil porque PowerShell renderiza los `�` aunque los datos estén bien.

Highlights v282→v288 (changelog detallado en sección 41 — sync BPs pesca + BigQuery + Power BI):

- **🎯 Sync automático de BPs pesca de SAP → app** (v282-v288, 2026-07-08). Nueva función `sync_bp_pesca()` dentro del cron cada 30 min. Filtro correcto (v288): `U_DIVISION IN ('2', '3', 'PESCA', 'BIKE & PESCA')` — los códigos internos del dropdown en SAP son 1=BIKE, 2=PESCA, 3=BIKE&PESCA. Provincia canónica poblada desde lookup a `/States?filter=Country eq 'AR'` para convertir código interno (`'2'`) a nombre (`'SALTA'`). ~103 BPs pesca sincronizando cada 30 min. Ver sección **40-bis** con contexto histórico + comportamiento del upsert + 15 iteraciones que llevaron al fix definitivo.
- **📊 Fase 1.2 SAP → BigQuery completa** (2026-07-08). Nuevo `scripts/sync_sap_to_bigquery.py` + workflow `.github/workflows/sync-sap-to-bigquery.yml`. 4 tablas SAP en dataset `shimano_app`: `sap_bp_raw`, `sap_items_raw`, `sap_invoices_raw`, `sap_quotations_raw`. Full snapshot cada 30 min con `WRITE_TRUNCATE`.
- **📊 Fase 2 vistas curadas BigQuery** (2026-07-08). Archivo `bigquery/views.sql` con 4 vistas SQL: `v_pedidos_header`, `v_pedidos_lines` (con `UNNEST` del array lines), `v_visitas`, `v_facturas_sap` (con `LEFT JOIN` BPs). Aplanan el JSON de las Extensions con `JSON_VALUE`, tipado con `SAFE_CAST`, columnas en snake_case latino natural. Listas para Power BI sin `JSON_VALUE()` en cada medida.
- **📊 Fase 3 Power BI Desktop conectado** (2026-07-08). Modo Import con las 4 vistas + `sap_items_raw` + 2 tablas auxiliares (`Vendedores`, `Origenes`). 12+ medidas DAX básicas. Dashboard "Resumen-Desempeño" en armado: gauges de Facturación mensual y % Cumplimiento, cards de KPIs principales, bar charts por Día/Región/Origen. Ver sección 40 con lista completa de medidas y visuales.
- **↩️ Volver a Pendientes desde Confirmados** (v283, solo admin/gerente). Botón naranja en el footer del modal cuando el pedido está en Confirmados. Si el pedido ya se transfirió a SAP, aviso explícito que la Sales Quotation en SAP NO se elimina (hay que cancelarla manualmente). Guarda auditoría en `revertedFromConfirmedAt`, `revertedBy`, `previousSapDocNum`.
- **🔗 Cards del header y contador de lista COINCIDEN** (v283, opción A elegida). `updateContactSummary()` ahora usa `effClients`/`effProspects` (misma lógica que `updateStats`). Antes contaba clientes del padrón viejo sin CardCode SAP; ahora ambos indicadores muestran solo SAP-confirmados. Fin de la discrepancia "97 / 137 habilitados" vs "TIENDAS 109".
- **🐛 Fix `approvedAltas` listener con fallback defensivo** (v283). Cuando el sync o el admin agregaba clientes nuevos, las 4 cards del header no se actualizaban silenciosamente si `drawMarkers()` throweaba. Fix: log explícito del error + fallback que llama `updateStats(filteredPoints())` directo.

Highlights v277→v281 (changelog detallado en sección 41):

- **📊 Fase 1.1 pipeline Power BI COMPLETA** (2026-07-07). 7 instancias de la Firebase Extension `firestore-bigquery-export` sincronizando en tiempo real → dataset `shimano_app` en `southamerica-east1`. Backfill del histórico ejecutado con `fs-bq-import-collection`: 264 documentos importados (pedidos, visits, client_master, sap_clients, client_applications, rendiciones, campaigns). Cada write futuro se sincroniza automáticamente sin código adicional. Detalles + troubleshooting en sección 40.
- **🔍 Buscador con lupa en modal Revisá tu pedido** (v281). Input arriba del listado que filtra por código o descripción. Los totales NO se ven afectados (siguen sumando sobre TODO el pedido). Contador "N de M productos" + botón (×) para limpiar. Útil para pedidos Excel de ~150 SKUs donde scrollear era tedioso.
- **⚠ Excel: SKUs no encontrados se incluyen con badge REVISAR EN SAP** (v280). Antes se descartaban silenciosamente si no matcheaban exactos con el catálogo. Ahora se agregan igual con `needsReview: true`, fondo amarillo en el review, badge `🔍 REVISAR EN SAP` y precio 0. Admin los ve claros antes de cargar a SAP. También se agregaron flags `hasSkusToReview` + `skusToReviewCount` al pedido para poder filtrar en BigQuery. Bonus: matching case-insensitive contra el master para reducir falsos negativos por capitalización (`glf-26b1ue` matchea `GLF-26B1ue`).
- **🐛 Fix pedido aparece y desaparece en Pendientes** (v279). Cuando Firestore rechazaba el `pedidos.add()` por permisos, el fallback local pushea a `pending[]` local y el pedido aparecía momentáneamente en la pestaña PENDIENTES. Cuando el listener del snapshot rerenderizaba, la lista se refrescaba y "desaparecía". Ahora: si el error es `permission-denied` no se toca `pending[]` local — el borrador queda vivo en "En curso" con alert claro incluyendo email + cliente + error code. **Fix relacionado en Firestore Rules**: interno (VDI) ahora puede crear/editar/borrar sus PROPIOS pedidos (`onBehalfOf: false` + `ownerUid == request.auth.uid`), no solo en nombre de VDE pareja como antes.
- **🚀 "Pasar a Pendientes" ahora pasa DIRECTO** (v278). Antes había un paso intermedio con diálogo de mes/año (`.confirm-dialog`) que en el flujo Excel resultaba INVISIBLE por bug de CSS `position:absolute` anidado. El pedido quedaba en `orders[]` como "En curso" y el vendedor no entendía por qué. Ahora `validateReviewAndPasarAPendientes` popula el mes/año actual y llama directo a `doConfirmPedido` — el vendedor ve el `confirm()` nativo del navegador. Si necesita cambiar el mes/año lo edita después. Bonus defensivo: CSS de `.confirm-dialog` cambió a `position:fixed;z-index:9999` para que si algún flujo futuro lo abre, no quede invisible.
- **✨ Auto-clear del banner de error en modal review** (v277). Cuando el vendedor completaba los campos faltantes (Forma Pago, Forma Entrega, direcciones), el banner rojo quedaba stuck aunque el error ya no aplicara. Nueva función `revalidateReviewSilently()` chequea el estado completo en cada `onchange`/`oninput` y limpia el banner cuando todo está OK. No introduce errores nuevos — solo LIMPIA silenciosamente.

Highlights v253→v276 (changelog detallado en sección 41):

- **💰 Sync automático de precios desde SAP** (v268). Extendido el `sync_sap_to_firestore.py` para traer precios de la **lista PESCA #12 ARS** cada 30 min. Antes: precios congelados desde la última carga manual (629 SKUs desactualizados) porque el botón PRECIOS del header se eliminó en v240 y la lógica quedó huérfana. Ahora: cuando administración carga un precio en SAP, aparece en la app en máximo 30 min sin acción manual. Filtro server-side por Item Group PESCA (Number=102, resuelto dinámicamente) → 755 items en el catálogo (antes 665 con SKUs invisibles).
- **Precios TEMPORALES** (v270). Admin/gerente puede asignar un precio temporal a SKUs sin precio en SAP desde el modal Master de Productos. Prioridad SAP > temporal (cuando SAP tiene precio, gana automático). Nuevo checkbox "Solo sin precio" para filtrar la lista de trabajo. Badge amarillo `⏱ TEMPORAL` en cards. Coleccion `app_config/price_list_temporal`.
- **Forma de entrega en pedidos** (v269, v271, v273). Nuevo dropdown obligatorio "Forma de entrega" en el modal review con 2 opciones: **TRANSPORTISTA** (3 campos: nombre + dirección del transportista + dirección de entrega al cliente) y **SUCURSAL** (dirección de entrega). Se agrega al Remarks del Sales Quotation SAP (mientras Ezequiel Mendoza no cree UDFs dedicados). Aplicado a Service Layer y DTW CSV.
- **VISITAS mejorado** (v274). Fotos ahora se pueden cargar desde galería (removido `capture="environment"` en los 4 inputs) + accept HEIC/HEIF para iPhone. Selects de Localidad/Tienda reemplazados por un componente **filter-select** custom con búsqueda escribiendo (tolerante a mayús/minús y acentos: "cordoba" matchea "Córdoba"). Enter selecciona primer match, Escape cierra.
- **Vendedores ven cantidad exacta de stock** (v253-v260). Antes solo admin/gerente porque requería login SL desde el browser. Nueva key `quantities` en el snapshot Firestore (serializada como JSON string para evitar el límite de 40k index entries por doc). Botón "Stock" unificado para todos los roles.
- **Alta rápida ahora en VISITAS y RUTAS** (v267). Antes las provisorias con `manualSapPending` sin dirección no aparecían en RUTAS (filtro exigía calle/address) y case-sensitivity en VISITAS (Balcarce vs balcarce). Ambos corregidos.
- **Búsqueda por fantasía en CLIENTES y PEDIDOS** (v265). Los buscadores matchean también el nombre del local (fantasía) además del titular. Ej: "Pescaplay" encuentra al cliente aunque el titular sea "Juan Pérez".
- **Badge de categoría (P/A/B/C) en cards** (v264, v266). Colores por tipo. Fix: para clientes SAP el `cliTipo` está en `client_applications`, no en `client_master`. Helper chequea ambas fuentes.
- **Fixes flujo pedidos** (v272, v275, v276). v272: banner rojo visible en modal review cuando falta forma de pago/entrega (antes salía alert después de cerrar el modal y el vendedor no lo veía). v275: defensive contra `currentOrderClient` null post-Excel + logs de diagnóstico. v276: fix CANCELAR pedido que no vaciaba realmente el borrador — Firestore deep merge no borraba las keys removidas localmente, ahora se usa `FieldPath` + `FieldValue.delete()`.
- **Otros ajustes UI mobile** (v261-v263): botón Guardar Serie APP centrado; fix inputs date en Safari iOS; botón Eliminar visita en MIS VISITAS.

Highlights v218→v252 (changelog detallado en sección 41):

- **🎯 Sync automático SAP → Firestore + stock.json cada 30 min via GitHub Actions** (v246). Fin del CSV manual de David. `sync_sap_to_firestore.py` corre en cron `13,43 * * * *`, escribe `product_catalog` (665 items filtrados por categorización) + `app_config/stock_snapshot` + `stock.json` en el repo. El bot Inventario-Bot de Google Sheet ahora lee datos frescos vía `raw.githubusercontent.com`.
- **Stock real de warehouses vendibles** (v244). Antes se filtraba solo W07 (PESCA EEUU, casi vacío) → `withStock: 2`. Ahora suma todos EXCEPTO W05 (Marketing) y W06 (Devoluciones) → `withStock: ~3.459` reales.
- **Sync de catálogo desde SL** (v235-v240). Master de Productos con búsqueda live + consulta stock on-demand por SKU. Elimina dependencia de mantener PRODUCTS hardcoded.
- **Envío directo a SAP via Service Layer** (v219-v220). Botón manual + toggle auto-envio (pedido confirmado → Sales Quotation automático). CORS + usuario SL resueltos.
- **Fix perf DISPONIBLES en picker** (v245). Antes con 10k SKUs bloqueaba el thread ~113M ops. Ahora flag O(1).
- **Fix WhatsApp ruta en iOS** (v248). GPS con `enableHighAccuracy: false` + timeout 5s + `window.open` placeholder para no perder user gesture.
- **Precaución solo admin/gerente** (v249). Info sensible oculta a vendedores.
- **Fix contador habilitados inconsistente** (v250). Header y sub-título ahora coinciden.
- **MIS RENDICIONES clickeables** (v251). Vendedor puede ver detalle + foto del ticket de rendiciones pasadas.
- **UI ajustes mobile varios** (v226-v233): resaltado precaución en pedidos, hamburger menu, botones centrados, modal Zonas full-screen.

Highlights v204→v217 (histórico anterior):
- **SEGUIMIENTO** — panel comercial completo para admin/gerente/interno, 7 tabs + Timeline cliente + notas internas + 2 colecciones Firestore nuevas (v209-v212).
- **Gerente desbloqueado** — `canWrite()`, CAMPAÑAS, SAP, lee todos los pedidos, edita rutas, recalcular contornos (v205/v208/v213/v214/v215).
- **Card precaución más visible** (v206) y **progreso de campañas global** (v207).
- **TARGETS-ZONAS reescrito** — solo BPs vivos con CardCode SAP, columna CARDCODE SAP. "Exportar para Análisis" solo Mariano (v208).
- **Rendiciones v2 (Híbrida Opción C)** — TablaGastos agrupada por dupla `(vendedor, tipoGasto)`, hoja Detalle nueva sin agrupar, fotos pre-subidas a Firebase Storage y concatenadas con `;`. Bucket `<project>.firebasestorage.app` (post-2024). Power Automate flow rearmado con HTTP GET de fotos (Premium) + idempotencia por Title (v217).
- **Fix tildar pedido bloqueado en SAP** (v216) y **botón ZONAS sin emoji** (v214).
- **Infra externa nueva** — **Firebase Blaze** activo, **Firebase Storage** inicializado, **BigQuery dataset** `shimano_app` creado, **Power Automate Premium** trial 90 días. Plan Power BI 4 días.

Histórico previo (v197-v203): Sidebar Localidades amplió a altas SAP + modal localidad (v198), burbujas agregadas OFF (v199), Master Clientes botón Eliminar 🗑 (v200), Modal Zonas gerente + scope provincia + toast (v201/v203), mail Rendiciones cron Lun/Mie (v202), SharePoint + Power Automate schema v1 (v203).

---

## 43) Fase 0 — Progreso 2026-07-24 (rama `fase-0`)

Trabajo iniciado el 2026-07-24 para consolidar la app **sin migrar stack**. Base: `APP-CONTEXTO.md` sección 6 del Desktop (roadmap Fase 0/1/2/3). Todo en rama `fase-0` — **NO** hay push a `main` ni deploys hechos por Claude. Cada etapa mergea + deploya vos manualmente en tu propia ventana.

Plan completo en `C:\Users\shimano.sandbox\.claude\plans\peppy-puzzling-bengio.md`. Reglas durables aprendidas durante la ejecución en `CLAUDE.md` (raíz del repo).

### 43.1 Status global de las 8 etapas

| # | Etapa | Estado | Gate | Commit | Turnos (u/b) | Tu acción para deploy |
|---|---|---|---|---|---|---|
| E0 | Setup rama + tooling | ✅ | 7 archivos scaffolded + npx vitest/tsc/esbuild/firebase --version OK | `1a373c1` | 4/3 | Ninguna (sin push) |
| E1 | Firestore Rules cerradas | ✅ | Emulator + 96 tests verdes + audit 23/23 cobertura | `6a3cbb2` | 9/6 | `firebase deploy --only firestore:rules` |
| E2 | Pipeline esbuild + bundle aditivo + smoke Node | ✅ | `npm run build` OK (`app.bundle.js` 41 KB en root) + 27 tests nuevos (8 sap-client + 19 smoke). Ver 43.5 + 43.5.b (steps 1+2 hechos) | 2026-07-25 | 12/8 (overrun por E2.b) | Merge normal + `git add app.bundle.js` |
| E3 | ts-check + JSDoc | ✅ | `tsc --noEmit` exit 0 + 7 archivos con `@ts-check` | `672b867` | 3/3 | Ninguna |
| E4 | Tests unitarios Vitest | ✅ | 56 tests verdes sobre 10 funciones puras | `710efc6` | 4/4 | Ninguna |
| E5 | Cloud Function sapProxy + Secret Manager | ✅ | 25 tests verdes con mocks | `c25a983` | 4/6 | Crear secret + IAM + `firebase deploy --only functions:sapProxy` (checklist 43.8) |
| E6 | Backup automático diario Firestore → Storage | ✅ | 12 tests verdes con mocks | `ca71df1` | 3/4 | Crear bucket + IAM + `firebase deploy --only functions:dailyFirestoreBackup` (checklist 43.9) |
| E7 | Sentry integrado con loader CDN + tags | ✅ | 7 tests verdes + presencia inline + APP_VERSION v324 | `37f81d5` | 3/2 | Merge + deploy GitHub Pages (checklist 43.10) |

**Totales**: 8 de 8 etapas cerradas. E2 incluye E2.b steps 1+2 (extracción de 10 fns puras + sentry helper del inline al bundle). **127 tests locales** verdes (56 unit + 8 sap-client + 25 sapProxy + 12 backup + 7 sentry + 19 smoke). Solo `git log fase-0 --oneline` para ver los 9 commits.

Para ver el diff completo entre `main` y `fase-0`:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
git log main..fase-0 --oneline
git diff main..fase-0 --stat
```

### 43.2 Infraestructura nueva incorporada al repo

Archivos y carpetas creados en `fase-0` (todos nuevos, ninguno pisa código de la app en producción):

```
APP VENDEDORES/
├── package.json                        ← devDeps: vitest, esbuild, typescript, fast-glob, @firebase/rules-unit-testing
├── package-lock.json
├── tsconfig.json                       ← allowJs + checkJs + strictNullChecks + noImplicitAny
├── firebase.json                       ← config emulator + functions codebase
├── .firebaserc                         ← default project: app-vendedores-shimano
├── firestore.rules                     ← REESCRITAS (2 closures Fase 0 — ver 43.4)
├── firestore.rules.baseline            ← snapshot histórico de las rules de prod pre-refactor
├── firestore.indexes.json              ← vacío (no hay indexes composite hoy)
├── .gitignore                          ← extendido con node_modules/, dist/, .firebase/, coverage/, __pycache__/
├── CLAUDE.md                           ← NUEVO. 7 reglas durables aprendidas durante Fase 0 (ver 43.13)
├── build.js                            ← NUEVO (E2). esbuild → app.bundle.js en repo root. Idempotente.
├── app.bundle.js                       ← NUEVO (E2.b). Build artifact commiteado — GitHub Pages lo sirve directo.
├── index.html                          ← MODIFICADO (E2.b): <script src="./app.bundle.js"> en <head>; 10 fns puras + sentry helper consumidos del bundle. APP_VERSION v325.
├── sw.js                               ← MODIFICADO (E2.b): CACHE_VERSION v325 + './app.bundle.js' agregado a STATIC_ASSETS.
├── src/                                ← NUEVO. Módulos ES pequeños con lógica testeable.
│   ├── types.js                        ← Typedefs JSDoc: UserRole, ClientTipo, PedidoDoc, ProductoDoc, etc.
│   ├── sentry.js                       ← applySentryUserContext (E7) — helper testeable de Sentry
│   ├── sap-client.js                   ← NUEVO (E2). createSapClient(firebase) → fetchWithSession compat sapSL.
│   ├── main.js                         ← NUEVO (E2). Entrypoint del bundle. Registra window.__phase0.
│   └── pure/                           ← 10 funciones puras extraídas de index.html
│       ├── normalize.js                ← normClientName, titleCase, escapeHtml, normTitle, normalizeSearch
│       ├── discount.js                 ← calcClientDiscount (P/A/B/C + volumen + CONTADO)
│       ├── search.js                   ← matchesAllTokens (buscador v313)
│       ├── duplicate.js                ← findSapDuplicateForProvisorio (detector v316)
│       ├── product-match.js            ← matchSkuFromTitle (SKU matching MELI)
│       └── filters.js                  ← passesTypeFilter (VENTAS_ESPECIALES filter)
├── functions/                          ← NUEVO. Cloud Functions v2 (Firebase Functions).
│   ├── package.json                    ← firebase-admin, firebase-functions, @google-cloud/firestore
│   ├── package-lock.json
│   ├── index.js                        ← Wrappers: sapProxy (E5) + dailyFirestoreBackup (E6)
│   └── core/                           ← Lógica pura de las functions (testeable sin emulator)
│       ├── sap-proxy-core.js           ← handleSapProxy con deps inyectables (E5)
│       └── backup-core.js              ← runDailyBackup con exportDocuments inyectable (E6)
├── tests/                              ← NUEVO. Suite completa de tests (119 assertions).
│   ├── rules/                          ← Firestore Rules contra emulator (E1)
│   │   ├── setup.js                    ← Helpers: initTestEnv, seedCanonicalRoles, UIDs canónicos
│   │   └── rules.test.js               ← 96 assertions (23 colecciones × 6 roles × 5 acciones)
│   ├── unit/                           ← Funciones puras (E4 + E7 + E2)
│   │   ├── normalize.test.js           ← 16 tests
│   │   ├── discount.test.js            ← 11 tests
│   │   ├── search.test.js              ← 5 tests
│   │   ├── duplicate.test.js           ← 12 tests
│   │   ├── product-match.test.js       ← 7 tests
│   │   ├── filters.test.js             ← 5 tests
│   │   ├── sentry.test.js              ← 7 tests
│   │   └── sap-client.test.js          ← NUEVO (E2). 8 tests: httpsCallable mock, SSRF client-side, error mapping
│   ├── functions/                      ← Cloud Functions core con mocks (E5 + E6)
│   │   ├── sap-proxy.test.js           ← 25 tests
│   │   └── backup-scheduled.test.js    ← 12 tests
│   └── smoke/                          ← NUEVO (E2). Runtime del bundle en Node vm.Context.
│       └── bundle-runtime.test.js      ← 11 tests: artifacts, tamaño, script tag, window.__phase0 shape
└── scripts/
    └── audit-rules-coverage.js         ← NUEVO. Verifica que cada colección grep de index.html
                                        #   tenga match en firestore.rules Y aparezca en algún test.
```

**index.html** y **sw.js** también fueron tocados por E7 (solo Sentry loader + bump versión). Todo lo demás en el HTML monolítico permanece intacto (E2 lo va a modularizar mañana).

### 43.3 Scripts npm disponibles (ejecutar desde `Desktop\APP VENDEDORES`)

```powershell
# Build del bundle E2 → app.bundle.js en repo root (E2.b: dist/ deprecated)
npm run build
# → esbuild produce ./app.bundle.js (41 KB IIFE). Idempotente.
# Committeá app.bundle.js después de cualquier cambio en src/**.

# Smoke del bundle (Node vm.Context, sin Playwright)
npm run test:smoke
# → 11 verdes: artifacts existen, tamaño ok, __phase0 poblado, funciones puras callables post-bundle

# Todos los tests unitarios (funciones puras + sentry + sap-client)
npm run test:unit
# Alternativa directa:
npx vitest run tests/unit/

# Tests de rules (levanta Firestore emulator)
$env:JAVA_HOME = "C:\Users\shimano.sandbox\Java\jdk-21.0.11+10-jre"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
firebase emulators:exec --only firestore --project demo-app-vendedores "npx vitest run tests/rules/"

# Tests de Cloud Functions core (sap-proxy + backup)
npx vitest run tests/functions/

# Todos los suites de una (unit + functions + smoke): 127 tests
npx vitest run tests/unit/ tests/functions/ tests/smoke/

# TypeScript check
npm run typecheck
# = npx tsc --noEmit --project tsconfig.json

# Audit de cobertura de rules
npm run audit:rules
# = node scripts/audit-rules-coverage.js
```

Java Temurin JRE 21 requerido solo para tests de rules (levanta emulator jar). Instalado en `C:\Users\shimano.sandbox\Java\jdk-21.0.11+10-jre` (ver 42.1 — JRE 21, no JDK 25 como decía originalmente el README).

### 43.4 E1 — Firestore Rules (deploy manual pendiente tuyo)

**Baseline**: guardada en `firestore.rules.baseline`. Es el snapshot que me pasaste de Firebase Console el 2026-07-24. NO se deploya — es referencia histórica.

**Refactor** aplicado sobre baseline (2 closures documentadas):

1. **`pedidos` / `visits` / `rendiciones`**: vendor `list` requiere `resource.data.ownerUid == request.auth.uid`. Antes cualquier reader listaba todo → vendor con consola browser podía enumerar visitas/pedidos/rendiciones ajenas. Verificado en `index.html:12775, 25247` que el vendor UI ya usa `where('ownerUid','==',uid)` — no rompe nada, solo cierra el bypass via consola.

2. **`app_config/sap_integration`**: read restringido a admin+gerente (antes viewer también leía las creds SAP). E5 mueve las creds a Secret Manager y esta rule podrá cerrarse aún más.

**Deploy** (tu terminal):
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
firebase deploy --only firestore:rules --project app-vendedores-shimano
```

**QA post-deploy** (5 min):
- Loggeate como vendedor en la app real (bot.shimano.pesca u otro con `role='vendedor'`).
- Abrí tabs Pedidos/Visitas/Rendiciones → deben renderizar tus datos igual que antes.
- Si alguien reporta "no ve nada", buscar en `index.html` `.collection('pedidos').get()` o similar sin `where` — posiblemente algún path que no filtra por ownerUid.
- En Console del browser: `firebase.firestore().collection('app_config').doc('sap_integration').get()` como vendor → debe devolver `permission-denied`.

**Riesgos**:
- Rules pasan contra emulator ≠ pasan en prod si `App Check` está enforced.
- Grep detecta solo `collection('literal')`. Si `index.html` usa `collection(varName)` con nombre dinámico, no está cubierto por el audit.

### 43.5 E2 — Pipeline esbuild + bundle aditivo + smoke Node (2026-07-25)

E2 partido en dos: **E2 (hoy)** deja el pipeline listo y un bundle aditivo NO-BREAKING; **E2.b (siguiente)** hará la extracción real de índex.html. Motivo del split: extraer 28K líneas inline con paridad funcional en un solo shot es demasiado riesgo con 6 vendedores en prod. Con el pipeline armado y el bundle probado, E2.b puede migrar dominio por dominio, cada uno con smoke propio.

**Hecho hoy** (commit único E2 en `fase-0`):

1. **`build.js`** (esbuild): produce `dist/` con:
   - `dist/app.bundle.js` — IIFE de 41 KB con sourcemap inline. Bundle de `src/main.js` que importa `src/pure/*.js` (10 funciones) + `src/sentry.js` + `src/sap-client.js`. Registra `window.__phase0 = { version, pure, sentry, sap }`.
   - `dist/index.html` — copia byte-exacta de source + `<script src="./app.bundle.js" defer></script>` inyectado antes de `</head>` (idempotente). **NO** modifica APP_VERSION ni CACHE_VERSION — build es puramente idempotente, bumpear versiones sigue siendo responsabilidad tuya al mergear (regla dura del README top).
   - `dist/sw.js`, `dist/manifest.json`, `dist/geo.json`, `dist/stock.json`, `dist/login-bg.jpg`, `dist/Shimano-Logo.png`, `dist/alta-cliente.html`, `dist/politica-privacidad.html`, 7 `dist/icon-*.png` — copiados verbatim.
   - Warn logueado si `APP_VERSION` (index.html) ≠ `CACHE_VERSION` (sw.js).

2. **`src/main.js`** — entrypoint del bundle. Expone `window.__phase0.{pure, sentry, sap, version}`. **Aditivo**: no pisa nada del inline actual de index.html; la app en prod sigue usando sus copias inline (idénticas por construcción a lo que vive en `src/pure/*.js` — verificado por los 63 tests unitarios).

3. **`src/sap-client.js`** — helper `createSapClient(firebase)` que rutea por `httpsCallable('sapProxy')` con el MISMO shape `fetchWithSession(path, options) → {ok, body, status, error}` que usa hoy el `sapSL` inline (`index.html:21481`). Migración de E2.b será un swap 1:1 sin tocar callers. **Sin cablear todavía** — index.html sigue con el sapSL legacy hasta que Mariano deploye sapProxy en prod (checklist 43.8) y confirme E2E en TST_06.
   - 8 tests unitarios cubren: GET happy path, POST con body serializado, path fuera de `/b1s/v1/` rechazado client-side, body no-JSON rechazado, status 4xx con detail SL, callable throw con code mapeado, override `callableName`, `createQuotation` compat.

4. **`tests/smoke/bundle-runtime.test.js`** — 11 smoke tests Node-based (no Playwright):
   - Existencia de los 3 artifacts (`app.bundle.js`, `index.html`, `sw.js`).
   - `dist/index.html` en rango [1.5 MB, 3.5 MB] (2.05 MB actual).
   - Script tag inyectado idempotentemente.
   - APP_VERSION == CACHE_VERSION.
   - Bundle carga en `vm.runInNewContext` sin throw.
   - `window.__phase0` estructura correcta.
   - Las 10 funciones puras callable post-bundling.
   - Sanity: `titleCase('hola mundo') === 'Hola Mundo'`, `normClientName('Café López') === 'CAFE LOPEZ'`.
   - `createSapClient` es factory, `applySentryUserContext(null,…)` no tira.

**Por qué smoke Node y no Playwright**: el chromium download (~150-600 MB según OS) está bloqueado por la red actual (documentado ayer en esta misma sección). El smoke Node cubre la aserción crítica de E2 no-breaking — "el bundle carga sin throw y expone la API prometida" — sin necesidad de headless browser. La verificación DOM/Firebase real queda como gate humano manual pre-merge, mismo patrón que se usó para E1 (Rules).

**Gate ejecutable** (correr desde repo root):
```powershell
npm run build                                                  # exit 0
node -e "const s=require('fs').statSync('dist/index.html').size; if(s<1_500_000||s>3_500_000) process.exit(1); console.log('size OK', s)"
npm run test:smoke                                             # 11 verdes
npx vitest run tests/unit/ tests/functions/ tests/smoke/       # 119 verdes total
npm run typecheck                                              # exit 0
```

**Cambios en repo** (todos en `fase-0`, ninguno pisa código de la app en prod):

- `build.js` (nuevo, 130 LOC)
- `src/main.js` (nuevo, entrypoint)
- `src/sap-client.js` (nuevo, helper Cloud Function)
- `tests/unit/sap-client.test.js` (nuevo, 8 tests)
- `tests/smoke/bundle-runtime.test.js` (nuevo, 11 tests)
- `package.json` — `test:smoke` cambiado de `playwright test` a `vitest run tests/smoke/`
- `README.md` — esta sección + tabla 43.1 + tree 43.2

**Qué te toca hoy**: nada — es todo local, no hay deploy ni push involucrado. Si querés inspeccionar: `npm run build && ls dist/` y abrí `dist/index.html` en el browser local (`file:///`) para que veas que carga como el original + con `window.__phase0` accesible en la console.

### 43.5.b E2.b — Extracción real (2026-07-25)

Split del plan original de E2. Se hace incremental, un paso por commit, cada uno con smoke propio.

**Steps 1 + 2 (HECHO 2026-07-25 — commit combinado):**

Motivo del commit combinado: por hoisting de `function foo(){}`, no se puede dejar la definición inline "por un rato" mientras se cablea el bundle — el binding local shadowaría al `window.foo` asignado desde el bundle. Ergo, agregar assignments + borrar inline tiene que ir junto.

Cambios en source `index.html`:
1. `<script src="./app.bundle.js"></script>` inyectado en `<head>` (blocking, después del bloque Sentry).
2. `APP_VERSION` bumpeado v324 → v325.
3. Bloque de assignments después del version-check (`Fase 0 E2.b (2026-07-25): consumir funciones del bundle`):
   - **Fail-fast**: `if (!window.__phase0 || !window.__phase0.pure) throw new Error(...)` — si el bundle no cargó, la app se detiene con mensaje claro en vez de romper silencioso.
   - **7 alias byte-idénticos**: `window.{normClientName,titleCase,escapeHtml,normTitle,_normalizeSearch (aliasado a normalizeSearch del bundle),calcClientDiscount,matchesAllTokens} = _P.foo`.
   - **3 wrappers para las fns refactoradas en E4** (que reciben globales como params):
     - `window.findSapDuplicateForProvisorio(prov) → _P.findSapDuplicateForProvisorio(prov, approvedAltasList)`
     - `window.matchSkuFromTitle(meliTitle) → _P.matchSkuFromTitle(meliTitle, SKU_INDEX, SKU_TOKENS)`
     - `window.passesTypeFilter(name) → _P.passesTypeFilter(name, currentTypeFilter, CLIENT_SPECIAL_SALES_SET)`
     - Los globals se resuelven al CALL time (no define time), safe porque todos los callers son user-triggered post-init.
   - **Sentry helper**: `window.applySentryUserContext = window.__phase0.sentry.applySentryUserContext`.
4. **10 definiciones inline borradas** de `index.html`:
   - `normClientName` (era línea 3407-3410)
   - `passesTypeFilter` (3696-3703)
   - `titleCase` (4434-4436)
   - `escapeHtml` (5618-5620)
   - `calcClientDiscount` + `window.calcClientDiscount = calcClientDiscount` redundante (9617-9643)
   - `normTitle` (18633-18635)
   - `matchSkuFromTitle` (18665-18684)
   - `_normalizeSearch` + `matchesAllTokens` (25012-25023)
   - `_DUP_STOPWORDS` + `_nameTokens` + `findSapDuplicateForProvisorio` (25041-25078) — helpers de dup detector solo usados adentro, se borraron los 3 juntos.
5. **`window.applySentryUserContext = function...` inline en `<head>` (líneas 55-70) borrado**. Nuevo home: bloque de assignments del script principal.

Cambios en `sw.js`:
- `CACHE_VERSION` v324 → v325.
- `./app.bundle.js` agregado a `STATIC_ASSETS` para offline PWA.

Cambios en tooling:
- `build.js` refactoreado: output a `app.bundle.js` en repo root (no `dist/`), idempotente, sin manipulación de versions.
- `dist/` deprecated (comentado en `.gitignore`).
- `tests/smoke/bundle-runtime.test.js` reescrito con 19 tests: verifica bundle + wiring del source `index.html` + `sw.js` + regex que confirma que las 10 defs inline NO existen.

**Métricas del delta**:
- `index.html`: -79 líneas netas (28,561 → 28,482), size 2.05 MB (casi igual — assignments block y comments compensan las 10 fns borradas).
- `app.bundle.js`: 41 KB nuevo artifact en root.
- Tests: 119 → 127 (+8 smoke).

**Riesgo residual**:
- Si `app.bundle.js` no está en el repo cuando se sirve `index.html`, la app tira `Error('Bundle window.__phase0 no cargó...')` con instrucciones claras. Mitigación operativa: incluir `git add app.bundle.js` en el flujo de merge (documentado en 43.11).
- El bundle es `<script>` blocking (no defer). Suma ~40 KB de download blocking en initial load. Aceptable dado que Firebase SDKs ya suman ~600 KB blocking; contexto pinta que la app no es latency-critical.
- **Manual gate humano pre-merge**: abrir `http://localhost:8000/index.html` (via `python -m http.server 8000` desde el repo) y verificar en F12 Console: (1) banner `Shimano App v325`, (2) `[version] HTML v325 === SW v325 OK`, (3) `window.__phase0` accesible y con estructura correcta, (4) cero errores rojos durante carga, (5) tabs abren normalmente.

**Steps 3 y 4 (pendientes, sin fecha):**

3. **Cablear `src/sap-client.js`**: reemplazar el objeto `sapSL` inline en `index.html` (~21470-21620, 150 LOC) por `const sapSL = window.__phase0.sap.createSapClient(firebase)`. **Bloqueado** hasta que Mariano deploye sapProxy en prod (checklist 43.8) y confirme E2E en TST_06.
4. **Extracciones por dominio** (opcional, mucha ganancia poca urgencia): auth, clients, orders, visits, rendiciones, geo, ui. Cada uno commit + smoke + QA humano de flujo crítico. Pre-req: Playwright funcionando (o smoke DOM equivalente).

### 43.6 E3 — ts-check + JSDoc

`tsconfig.json`: `allowJs + checkJs + noEmit + strictNullChecks + noImplicitAny + noImplicitThis`. Cubre `src/**/*.js`, `functions/core/**/*.js`, `functions/index.js`.

**7 archivos con `// @ts-check`**:
- `src/types.js` (typedefs)
- `src/sentry.js`
- `src/pure/normalize.js` / `discount.js` / `search.js` / `duplicate.js` / `product-match.js` / `filters.js`
- `functions/core/sap-proxy-core.js` (agregado en E5)
- `functions/core/backup-core.js` (agregado en E6)
- `functions/index.js`

**Errores reales de tipos fixed durante el gate**: 3 (indexing de `Record` sin declarar, resueltos con `@type {Record<string,number>}` explícito). Sin regresión en tests.

**Deploy**: no requiere — es dev tooling, no toca prod.

### 43.7 E4 — Tests unitarios (56 tests)

10 funciones puras extraídas verbatim de `index.html` a `src/pure/*.js` con **dependencies inyectables** para testeabilidad. Refactor de 3 fns para recibir globales como params:
- `findSapDuplicateForProvisorio(prov, approvedAltasList)` (antes leía `approvedAltasList` global)
- `matchSkuFromTitle(title, skuIndex, skuTokens)` (antes leía `SKU_INDEX`/`SKU_TOKENS` globales)
- `passesTypeFilter(name, filter, specialSalesSet)` (antes leía `currentTypeFilter`/`CLIENT_SPECIAL_SALES_SET` globales)

Cuando E2 modularice, los callers en `index.html` pasan los params. Hasta entonces, el `index.html` original sigue usando las versiones inline con globales — cero riesgo.

**Deploy**: no requiere — módulos aún no importados desde el HTML productivo. E2 los cablea.

### 43.8 E5 — Cloud Function `sapProxy` (deploy manual tuyo, pendiente)

**Arquitectura core+wrapper** (documentada como regla 7 en CLAUDE.md):
- `functions/core/sap-proxy-core.js` (~150 LOC): lógica pura `handleSapProxy(data, auth, deps)` con `deps.{fetch, getUserRole, sapConfig, log}` inyectables.
- `functions/index.js`: wrapper Cloud Functions v2 que plumbea request → core y lee el secret real.

**Reglas de autorización dentro de la function**:
| Rol | Reads GET /Items /BusinessPartners /Warehouses /SalesPersons /Inventory | Writes POST/PATCH/DELETE |
|---|---|---|
| `anon` | ❌ unauthenticated | ❌ |
| sin rol | ❌ permission-denied | ❌ |
| `viewer` | ❌ | ❌ |
| `vendedor` | ✅ | ❌ |
| `interno` | ✅ | ❌ |
| `admin` / `gerente` | ✅ | ✅ |

**Sanitización SSRF**: endpoint debe empezar con `/b1s/v1/`. Method whitelist GET/POST/PATCH/DELETE. Password nunca en logs ni response (2 tests dedicados).

**Deploy — checklist tuyo** (ejecutar en tu terminal, en orden):

**Estado al 2026-07-27**: Secret Manager API YA habilitada (E6 la habilitó) y secret `SAP_SL_PASSWORD` YA creado con valor **placeholder** (`placeholder-hasta-E5-no-usar`). El paso "crear secret" del checklist original ya no aplica — hay que **actualizar el valor** con la password real.

```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"

# 1) Actualizar el valor del secret con la password real del usuario APP_VENDEDORES.
# NOTA WINDOWS: `--data-file=-` (stdin) NO funciona en Windows PowerShell (gcloud
# lo interpreta como filename literal). Escribir a archivo temp y pasar el path.
Set-Content -Path secret-tmp.txt -Value "<PASSWORD REAL APP_VENDEDORES>" -Encoding ascii -NoNewline
gcloud secrets versions add SAP_SL_PASSWORD --data-file=secret-tmp.txt --project=app-vendedores-shimano
Remove-Item secret-tmp.txt

# 2) Grant al Compute Engine default service account (Firebase Functions v2 runtime).
# El default App Engine SA (<PROJECT>@appspot...) NO existe en este proyecto (ver
# gotcha #1 en sección 43.9). Usar Compute Engine default:
gcloud secrets add-iam-policy-binding SAP_SL_PASSWORD `
  --member="serviceAccount:746111030735-compute@developer.gserviceaccount.com" `
  --role="roles/secretmanager.secretAccessor" `
  --project=app-vendedores-shimano

# 3) Deploy. Como el secret ya existe, no debería aparecer el prompt interactivo.
# Cleanup policy de Artifact Registry ya seteada en E6 (30 días).
firebase deploy --only functions:sapProxy --project=app-vendedores-shimano

# 4) Test E2E contra TST_06 (NO prod SHIMANO_SAU):
#    en la app, crear un pedido de prueba que use la nueva ruta callable.
#    Verificar en SAP TST_06 que la Quotation entró.
```

**Nota importante sobre secret versioning**: `gcloud secrets versions add` crea una versión nueva del secret y la marca como LATEST. La versión placeholder anterior queda inactiva pero disponible en el histórico. Si querés borrar la vieja explícitamente: `gcloud secrets versions destroy 1 --secret=SAP_SL_PASSWORD --project=app-vendedores-shimano`.

**Cambio en cliente pendiente** (parte de E2 o commit aparte): reemplazar `fetch('https://shimano-sap.seidor.com.ar:50000/b1s/v1/...')` en `index.html` por:
```js
const call = firebase.functions().httpsCallable('sapProxy');
const result = await call({ endpoint: '/b1s/v1/Quotations', method: 'POST', body: {...} });
```

**Borrar creds de `app_config/sap_integration`**: SOLO después de confirmar que la nueva ruta funciona en TST_06 Y en prod. Borrar el campo `serviceLayer.password` — dejar `url`, `companyDB`, `username` (no sensibles).

**Riesgos deploy real**:
- Service account default sin `secretmanager.secretAccessor` sobre `SAP_SL_PASSWORD` → tests locales pasan pero prod falla al leer el secret.
- Cloud Functions v2 requiere Eventarc/Cloud Run APIs habilitados.
- SL está en on-premise Seidor: latencia + CORS + timeouts desde GCP región `southamerica-east1` no probados; puede requerir ajuste de timeout de la function (hoy 60s default).
- `App Check` disabled en el callable (TODO cuando configuren). Cualquier user autenticado con Firebase Auth puede invocar `sapProxy` directamente por HTTP — el filtro de rol es la única defensa.

### 43.9 E6 — Backup automático diario ✅ DEPLOYADO 2026-07-27

Scheduled function `dailyFirestoreBackup` activa en prod:
- Cron: `0 2 * * *` en `America/Argentina/Buenos_Aires` (2am AR).
- Región `southamerica-east1`, retry 2, memory 256MiB, timeout 540s.
- Exporta Firestore a `gs://app-vendedores-shimano-backups/firestore/{YYYY-MM-DD}/`.
- Bucket con lifecycle rule: objetos con >90 días se auto-borran.
- Cleanup policy Artifact Registry: container images >30 días auto-borradas (evita bill inflation por accumulación de builds).
- **`window.runFullBackup` intacto** — el botón manual admin (`index.html:10517`) sigue siendo el ZIP con fotos + JSON + metadata. Este scheduled es hot-restore-ready oficial de Firestore.

**Checklist de deploy** (ejecutado 2026-07-27, guardar como referencia para futuros proyectos):

```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"

# 1) Crear bucket destino en South America (uniform bucket-level access simplifica IAM)
gcloud storage buckets create gs://app-vendedores-shimano-backups `
  --location=southamerica-east1 `
  --project=app-vendedores-shimano `
  --uniform-bucket-level-access

# 2) Retention 90 días. NOTA WINDOWS: `--lifecycle-file=-` (stdin) NO funciona
# en Windows PowerShell (gcloud lo interpreta como filename literal). Escribir
# a archivo temp y pasar el path:
Set-Content -Path lifecycle.json -Value '{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}}' -Encoding ascii
gcloud storage buckets update gs://app-vendedores-shimano-backups --lifecycle-file=lifecycle.json
Remove-Item lifecycle.json

# 3) Habilitar APIs necesarias
gcloud services enable cloudscheduler.googleapis.com firestore.googleapis.com secretmanager.googleapis.com --project=app-vendedores-shimano
# Nota: secretmanager.googleapis.com hace falta porque functions/index.js
# también exporta sapProxy (E5) que declara `defineSecret('SAP_SL_PASSWORD')`;
# aunque estemos deployando solo dailyFirestoreBackup con `--only`, Firebase CLI
# analiza el módulo entero y falla si Secret Manager API no está habilitada.

# 4) Grant IAM al Compute Engine default service account.
# IMPORTANTE: en proyectos Firebase nuevos (~2024+) el default App Engine SA
# `<PROJECT>@appspot.gserviceaccount.com` NO existe; el runtime real de Cloud
# Functions v2 es el Compute Engine default: `<PROJECT_NUMBER>-compute@developer...`.
# Encontrar el número del proyecto con:
#   gcloud iam service-accounts list --project=app-vendedores-shimano
# Para app-vendedores-shimano el número es 746111030735.
gcloud projects add-iam-policy-binding app-vendedores-shimano `
  --member="serviceAccount:746111030735-compute@developer.gserviceaccount.com" `
  --role="roles/datastore.importExportAdmin"

gcloud storage buckets add-iam-policy-binding gs://app-vendedores-shimano-backups `
  --member="serviceAccount:746111030735-compute@developer.gserviceaccount.com" `
  --role="roles/storage.objectAdmin"

# 5) Deploy. Primer deploy en el proyecto puede tardar 3-10 min (Firebase
# habilita run/eventarc/pubsub/storage APIs + primer container build).
firebase deploy --only functions:dailyFirestoreBackup --project=app-vendedores-shimano
# Si prompt "Enter a value for SAP_SL_PASSWORD": es porque sapProxy declara
# ese secret y CLI intenta crearlo si no existe. Poner un placeholder como
# "placeholder-hasta-E5-no-usar" — E5 lo sobrescribe con el real.
# Si prompt "How many days do you want to keep container images": responder 30.

# 6) Verificar al día siguiente (~2:05 AR)
gcloud storage ls gs://app-vendedores-shimano-backups/firestore/
# Debe listar una carpeta con la fecha del día. Adentro: metadata + output-0.

# 7) Verificar el cron scheduler job + function existen
gcloud scheduler jobs list --location=southamerica-east1 --project=app-vendedores-shimano
gcloud functions list --project=app-vendedores-shimano --regions=southamerica-east1

# 8) Logs del run del día
gcloud functions logs read dailyFirestoreBackup --region=southamerica-east1 --limit=20 --project=app-vendedores-shimano
```

**Gotchas descubiertos durante deploy 2026-07-27** (documentados para no re-tropezar):

1. **SA email cambió**: el checklist original usaba `<PROJECT>@appspot.gserviceaccount.com` (default App Engine SA). GCP dejó de crearlo automáticamente en proyectos nuevos. Ahora hay que usar el Compute Engine default (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`).
2. **`--lifecycle-file=-` no anda en Windows**: gcloud interpreta `-` como filename literal en vez de leer de stdin. Escribir el JSON a archivo temporal y pasar el path.
3. **Secret Manager API needs enabling**: aunque solo deployes `dailyFirestoreBackup` con `--only`, el CLI analiza el módulo entero, ve `sapProxy` con `defineSecret('SAP_SL_PASSWORD')`, y falla si la API está deshabilitada. Habilitar antes.
4. **Prompt interactivo para secret**: si el secret no existe, el CLI lo crea interactivamente pidiendo valor. Dar placeholder identificable (`placeholder-hasta-E5-no-usar`) — el real va cuando toque E5.
5. **`@google-cloud/firestore` es pesado**: cargar el package top-level en `functions/index.js` exhausta el timeout de 10s del "backend spec analysis" del CLI. Fix: dynamic import lazy dentro de la function body (ver `functions/index.js` línea ~100).
6. **Cleanup policy de Artifact Registry**: al primer deploy, el CLI pregunta cuántos días retener container images (Cloud Run v2 acumula uno por deploy). Responder 30 (balance costo/rollback).

**Alerta de fallo (recomendado, pendiente)**: en Cloud Logging → crear log-based metric sobre `severity>=ERROR AND resource.labels.function_name="dailyFirestoreBackup"` → Alerting policy → channel email a `bot.shimano.pesca@gmail.com`. Sin esta alerta, un fallo del cron queda solo en Cloud Logging sin nadie mirando.

**Riesgos residuales**:
- La function devuelve `operationName` (long-running op) pero NO espera a que termine. Un fail parcial post-inicio no queda flaggeado por esta lógica. El log del cron dice "OK" aunque el export en background falle.
- El cron corre en zona horaria AR pero Cloud Scheduler ejecuta en UTC internamente. Verificar en scheduler jobs list que aparece con timezone correcto.
- El bucket `gs://app-vendedores-shimano-backups` tiene lifecycle 90d pero no versioning. Si alguien borra manualmente objetos, no hay recovery.

### 43.10 E7 — Sentry integrado (deploy en merge de rama)

**Ya integrado en `index.html` (v324)**:
- Loader CDN `https://js.sentry-cdn.com/7cbe790b32043d72a1b147a2f7f0c641.min.js` (public key del README 42.3) después de los 5 SDKs de Firebase.
- `Sentry.onLoad → Sentry.init({release: APP_VERSION, environment:'production', tracesSampleRate:0.0})`.
- `window.applySentryUserContext(sentry, user, role, vendor)` inline (duplicado de `src/sentry.js` para tests).
- Wire post-login en `fetchAndApplyRole`: setea `Sentry.setUser({id, email}) + setTag('role') + setTag('vendor')`. Todo error subsecuente viaja con esos tags.

**Deploy**: es parte del merge normal a `main` + push a GitHub Pages. Bumpeo ya hecho: `APP_VERSION` v324 en `index.html`, `CACHE_VERSION` v324 en `sw.js`.

**Verificación E2E post-deploy** (5 min):
1. Abrir la URL pública en browser, F12 → Console → verificar banner `v324`.
2. En Console: `throw new Error('Sentry test post-deploy 2026-07-24');`
3. Ir a sentry.io/organizations/<org>/issues/ (tu cuenta) → debería aparecer el error con `tags: {role: '<tu-rol>', vendor: '<tu-vendor>'}`.

**Riesgos**:
- Loader async: errores en los primeros ~200ms antes de que baje el SDK pueden perderse.
- Service Worker (`sw.js`) NO capturado por este snippet — requiere init separado, fuera de scope Fase 0.
- Free tier Sentry: 5k eventos/mes. Configurar alerta de quota en dashboard.
- `tracesSampleRate: 0.0` = solo errores, no performance. Subir si quieren traces (empezar con 0.01).

### 43.11 Checklist consolidado — qué te toca mergear/deployar

En orden sugerido (etapas independientes se pueden reordenar):

1. **E3 + E4 (sin efecto en prod)**: merge sin deploy. Habilita tests + typecheck localmente.
1.b **E2 + E2.b steps 1+2 (EFECTO EN PROD — merge + push GitHub Pages)**: source `index.html` v325 consume 10 fns puras + sentry helper desde `app.bundle.js`. Regenerá el bundle antes del merge (`npm run build && git add app.bundle.js`). Verificación manual pre-merge: `python -m http.server 8000` → abrir `http://localhost:8000/` → F12 Console → banner v325 + `[version] HTML v325 === SW v325 OK` + cero errores rojos + tabs abren. **QA humano de 5 flujos críticos post-merge**: crear pedido, subir rendición, alta rápida, ver mapa, backup.
2. **E7 (Sentry)**: merge + push a GitHub Pages. Verificación E2E post-deploy (43.10).
3. **E1 (Rules)**: `firebase deploy --only firestore:rules --project=app-vendedores-shimano`. QA vendor tabs (43.4).
4. **E5 (sapProxy)**: checklist 43.8 completo (crear secret + IAM + deploy). Test E2E en TST_06 antes de borrar creds de `app_config/sap_integration`.
5. **E6 (backup)**: checklist 43.9 completo (bucket + retention + APIs + IAM + deploy). Verificar al día siguiente que hay backup en Storage.
6. **E2.b (extracción real)**: recién después de que E5 esté en prod y sapProxy esté testeado E2E. Ver 43.5.b para orden sugerido.

Después de todo mergeado + deployado: **la app está en Fase 0 completa**. Base sólida para arrancar Fase 1 (backend propio) si se decide, sin haber tocado el stack.

### 43.12 Regression armor (por si tocás la app y querés validar)

Antes de cualquier commit en `fase-0`, o antes de mergear a `main`:

```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"

# 1) Type-check
npm run typecheck

# 2) Todos los unit + function tests (rápido, ~1s)
npx vitest run tests/unit/ tests/functions/

# 3) Rules tests (requiere Java + emulator, ~1 min)
$env:JAVA_HOME = "C:\Users\shimano.sandbox\Java\jdk-21.0.11+10-jre"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
firebase emulators:exec --only firestore --project demo-app-vendedores "npx vitest run tests/rules/"

# 4) Audit de rules cobertura
npm run audit:rules
```

Todos verdes → puede mergear. Alguno rojo → causa raíz.

### 43.13 `CLAUDE.md` — 7 reglas durables aprendidas hoy

Archivo nuevo en la raíz del repo. Reglas capturadas para que futuras sesiones no repitan los mismos aprendizajes:

1. **Deps npm por etapa, no big-bang** — Windows red inestable + `npm install` con muchas deps grandes = `ECONNRESET`. Instalar incremental por etapa.
2. **`firebase init` es interactivo — scaffold manual** — no correr `firebase init` en scripts automatizados; crear config files a mano.
3. **`npx --no-install <bin>` no funciona con devDeps** — usar `npx <bin>` o `node_modules/.bin/<bin>` directo.
4. **Ejecución en loop (act → verify → re-prompt)** — nunca declarar "done" desde una edición exitosa; siempre correr el gate y pegar salida real.
5. **Rescope justificado ≠ relajar el gate** — si aparecen dependencias que no eran necesarias en esa etapa, moverlas a otra + documentar en plan + CLAUDE.md, no bajarlas del gate calladamente.
6. **Test bug vs SUT bug: distinguir antes de "arreglar"** — cuando un test falla, primero determinar si el bug está en el TEST (asserción fantasía) o en el SUT (comportamiento incorrecto).
7. **Cloud Functions: separar core puro del wrapper Firebase** — lógica de negocio en `functions/core/*.js` con deps inyectables; `functions/index.js` solo hace plumbing.

Ver `CLAUDE.md` en la raíz del repo para el texto completo con contexto y ejemplos.

### 43.14 Referencias operativas rápidas

- **Plan Fase 0**: `C:\Users\shimano.sandbox\.claude\plans\peppy-puzzling-bengio.md` — plan completo con budgets, gates, riesgos por etapa.
- **CLAUDE.md**: `Desktop\APP VENDEDORES\CLAUDE.md` — reglas durables.
- **APP-CONTEXTO.md**: `Desktop\APP-CONTEXTO.md` sección 6 — origen del roadmap Fase 0/1/2/3.
- **Rama activa**: `main` (fase-0 ya mergeada 2026-07-25 via rebase + fast-forward por regla "no merge commits"). Última commit al cierre de sesión 2026-07-25: `523b3e1` (v327 CSP wildcard fix).
- **Emulator jar cacheado**: `~/.cache/firebase/emulators/cloud-firestore-emulator-v1.21.0.jar` (138 MB, ya no re-descarga).
- **Java para emulator**: Temurin JRE 21 en `C:\Users\shimano.sandbox\Java\jdk-21.0.11+10-jre` (README 42.1 pero corrección: es JRE 21, no JDK 25).

---

## 44) Estado de fin de sesión 2026-07-27 — Fase 0 CERRADA AL 100%

**Fase 0 completada** después de 3 sesiones (2026-07-24 setup + E0/E3/E4/E7, 2026-07-25 merge fase-0 + Sentry hotfixes, 2026-07-27 QA + E1 + E6 + E5 + E2.b step 3). Todas las 8 etapas del roadmap original operativas en prod, con hotfixes de CSP + CORS que aparecieron en el camino.

### 44.1 Progreso final 2026-07-24 → 2026-07-27

| Etapa | Estado | Fecha cierre | Deploy en prod |
|---|---|---|---|
| E0 setup + tooling | ✅ | 2026-07-24 | — (local) |
| E1 Firestore Rules | ✅ | 2026-07-27 | ✅ deployado |
| E2 pipeline esbuild + bundle aditivo | ✅ | 2026-07-25 | ✅ v325 |
| E2.b steps 1+2 (index.html consume del bundle) | ✅ | 2026-07-25 | ✅ v325 |
| E2.b step 3 (sapSL rutea via sapProxy) | ✅ | **2026-07-27** | ✅ v330 |
| E3 ts-check + JSDoc | ✅ | 2026-07-24 | — (dev tooling) |
| E4 tests unitarios | ✅ | 2026-07-24 | — (dev tooling) |
| E5 sapProxy Cloud Function | ✅ | **2026-07-27** | ✅ deployado |
| E6 backup diario Firestore | ✅ | 2026-07-27 | ✅ deployado |
| E7 Sentry integrado | ✅ | 2026-07-24 | ✅ v324 → operativo desde v327 |
| Hotfix CSP Sentry (v326, v327) | ✅ | 2026-07-25 | ✅ v327 |
| Hotfix source map Sentry (v328) | ✅ | 2026-07-27 | ✅ v328 |
| Prep E2.b step 3 (v329: SDK + CSP + region) | ✅ | 2026-07-27 | ✅ v329 |
| Hotfix CORS sapProxy | ✅ | 2026-07-27 | ✅ deployado |

### 44.2 Commits acumulados en `main` (post-fase-0-merge)

De la sesión 2026-07-25:
| Commit | Descripción |
|---|---|
| `ea9eba3` | E2: pipeline esbuild + bundle aditivo + smoke Node |
| `285ae25` | E2.b steps 1+2 → v325 |
| `3d8cd19` | v326: fix CSP para Sentry (script-src) |
| `b1b9225` | README docs v325+v326 |
| `1926b5e` | deps: root package 0 vulns (esbuild+vitest major bump) |
| `523b3e1` | v327: fix CSP wildcard `*.sentry.io` |
| `ce261b4` | README sección 44 fin de sesión 2026-07-25 |

De la sesión 2026-07-27 (esta):
| Commit | Descripción |
|---|---|
| `<pendiente>` | E6 fix + docs 43.8/43.9 gotchas + sección 44 actualizada |

### 44.3 Deployments en prod (Firebase / GCS)

- ✅ **`firestore.rules` v1.0** — deployado 2026-07-27 con `firebase deploy --only firestore:rules`. 2 closures activas: `pedidos/visits/rendiciones` list requiere ownerUid; `app_config/sap_integration` restringido a admin+gerente. Admin path verificado con 3 smoke commands en F12 Console (leer sap_integration + list pedidos + list visits, todos OK).
- ✅ **`dailyFirestoreBackup` Cloud Function v2** — deployado 2026-07-27 en `southamerica-east1`. Cron `0 2 * * *` en zona `America/Argentina/Buenos_Aires`. Exporta a `gs://app-vendedores-shimano-backups/firestore/{YYYY-MM-DD}/`. Bucket con lifecycle 90d + Artifact Registry cleanup 30d.
- ✅ **Bucket `gs://app-vendedores-shimano-backups`** creado en `southamerica-east1` con uniform bucket-level access. IAM otorgada al Compute Engine default SA (`746111030735-compute@developer...`) con roles `datastore.importExportAdmin` (project-wide) + `storage.objectAdmin` (bucket).
- ✅ **Secret Manager**: `SAP_SL_PASSWORD` creado con valor placeholder `placeholder-hasta-E5-no-usar`. Se sobrescribe con password real cuando toque E5.
- ✅ **APIs habilitadas 2026-07-27**: `cloudscheduler`, `firestore`, `secretmanager`, `run`, `eventarc`, `pubsub`, `storage`, `artifactregistry`, `cloudbuild`, `cloudfunctions`, `firebaseextensions` (varias las habilitó el CLI automáticamente al primer deploy Functions v2).

### 44.4 Pendientes (post Fase 0, no bloqueantes)

**Cerrar el círculo de seguridad E5** (recomendado semana próxima):
1. **Rotar la password de `APP_VENDEDORES` en SAP**: la actual `Shi*99` es débil (6 chars) y quedó leakeada en el transcript del chat 2026-07-27. Pedir a Seidor password nueva 16+ chars. Actualizar Secret Manager: `Set-Content -Path secret-tmp.txt -Value "<nueva>" -Encoding ascii -NoNewline; gcloud secrets versions add SAP_SL_PASSWORD --data-file=secret-tmp.txt --project=app-vendedores-shimano; Remove-Item secret-tmp.txt`. La función `sapProxy` lee `LATEST` automáticamente.
2. **Borrar `app_config/sap_integration.serviceLayer.password` de Firestore**: solo el campo `password`, dejar `url`, `companyDB`, `username` (no sensibles). Precondición: dejar la app corriendo N días con `sapSL.useCloudProxy=true` para confirmar que no da problemas en operación real. Después de borrar la password, el fallback legacy (useCloudProxy=false) queda sin creds — pero como useCloudProxy=true no lo usa, todo sigue funcionando. Si algún día se necesita rollback: la password nueva en Secret Manager es reversible, se puede volver a poner en Firestore temporalmente.
3. **Verificar cada mañana los primeros días** que el backup diario corrió: `gcloud storage ls gs://app-vendedores-shimano-backups/firestore/` debe listar folder de la fecha. Sino: `gcloud functions logs read dailyFirestoreBackup --region=southamerica-east1 --limit=20`.
4. **Configurar alerta email de fallo del backup**: Cloud Logging → log-based metric sobre `severity>=ERROR AND resource.labels.function_name="dailyFirestoreBackup"` → Alerting policy → email a `bot.shimano.pesca@gmail.com`.

**Mantenimiento (sin urgencia)**:
5. **Runtime Node.js 20 deprecation**: los deploys de Cloud Functions warnean que Node 20 fue deprecado el 2026-04-30 y decommissioned el 2026-10-30. Antes de octubre 2026, migrar `functions/package.json` engines a `"node": "22"` y `firebase-functions@latest`.
6. **Dependabot functions/**: 8 vulns moderate transitivas (uuid/retry-request/teeny-request/gaxios via firebase-admin). `npm audit fix --force` empeora. Se aceptan como riesgo bajo (server-side sandbox, code paths no procesan input arbitrario). Silenciar en GitHub Security → Dependabot alerts con "Dismiss → Risk: Tolerable" cuando quieras.
7. **AppCheck 403 throttled** (pre-existente): reCAPTCHA v3 rechaza tokens con throttle 24h. Investigar en panel Firebase App Check el registration del dominio + site key. No bloquea operativa.
8. **QA humano vendor-path** (implícito por uso diario): validar con una cuenta rol `vendedor` real que Pedidos/Visitas/Rendiciones renderean OK después del deploy de rules. Rollback: `firebase rollback firestore:rules`.
9. **Después de N días con sapSL.useCloudProxy=true**: borrar el fallback legacy del `sapSL.fetchWithSession` en `index.html` (líneas ~21467-21496). Con eso el bundle es la única ruta de SL y el código queda 30 líneas más chico.

### 44.5 Estado técnico snapshot (post cierre Fase 0)

- **Prod URL**: https://shimano-arg.github.io/app-vendedores/
- **Prod version**: v330 (index.html + sw.js sincronizadas)
- **`app.bundle.js`**: commiteado en root, 43.4 KB IIFE, esbuild 0.28.1.
- **Tests locales**: 129/129 verdes (66 unit + 25 sapProxy + 12 backup + 19 smoke + 7 sentry) + 96 rules contra emulator.
- **`npm audit` root**: 0 vulnerabilities.
- **`npm audit` functions/**: 8 moderate transitivas (aceptadas).
- **Cloud Functions activas** (ambas en southamerica-east1):
  - `dailyFirestoreBackup` — cron 2am AR → gs://app-vendedores-shimano-backups/firestore/{YYYY-MM-DD}/
  - `sapProxy` — callable, invocada desde el browser via `httpsCallable` cada vez que la app hace una request SAP
- **Bucket backups**: `gs://app-vendedores-shimano-backups` (populated diariamente).
- **Secret Manager**: `SAP_SL_PASSWORD` versión 3 con valor real (`Shi*99`, débil — rotar).
- **IAM Compute Engine SA** (`746111030735-compute@developer.gserviceaccount.com`): `roles/datastore.importExportAdmin` + `roles/storage.objectAdmin` sobre bucket + `roles/secretmanager.secretAccessor` sobre SAP_SL_PASSWORD.
- **Rollback rápido sap-client**: `sapSL.useCloudProxy = false` en F12 Console (sin redeploy).

### 44.6 QA validado (sesión 2026-07-27)

- **B1-B5**: los 5 flujos críticos validados en prod (crear pedido, mapa+popup, alta rápida, rendición implícita por uso diario, backup manual). Cero errores.
- **Callable sapProxy**: verificado end-to-end con `sapSL.fetchWithSession('/b1s/v1/Items?$top=1')` — devolvió `{ok:true, status:200, body:{value:[...]}}` en <5 seg.
- **Pedido real con proxy**: creado pedido para Acquaroli Armeria (Santa Fe, Reconquista) — validación OK, pasó a Pendientes. Consultó stock via sapSL.getStock() que rutea via proxy sin issues.
- **E1 Rules**: admin path smoke (3 comandos F12) todos verdes.
- **E6 backup**: cron scheduler ENABLED, function ACTIVE. Primer cron corre 2026-07-28 02:00 AR (verificar mañana).

Ruidos conocidos que aparecen y NO son bugs: Kaspersky CSP, AppCheck 403, source maps de leaflet/polygon-clipping, `apple-mobile-web-app-capable` deprecated, `[gmaps] REQUEST_DENIED`.

### 44.7 Cómo seguir después de Fase 0

Ninguna acción bloqueante. Cuando quieras avanzar, prioridad recomendada:

1. **Después del test humano en operación diaria (3-7 días)**: correr el checklist post-Fase 0 (sección 44.4 puntos 1-2) — rotar password + borrar creds de Firestore. Con eso cierra oficialmente el ciclo de E5 (creds fuera de Firestore).
2. **Alerta email backup** (44.4 punto 4): 15 min de configuración, previene fallos silenciosos.
3. **Mantenimiento Node 20 → 22** (44.4 punto 5): antes de octubre 2026.

Para nuevos features de la app: no hay bloqueo de Fase 0. Podés arrancar cualquier cosa. La infraestructura queda como base sólida (tests + build pipeline + Cloud Functions + backups + monitoring).

### 44.8 Commits de la sesión 2026-07-27 (todos pusheados a `main`)

| Commit | Descripción |
|---|---|
| `cea25ed` | E1 + E6 deployados + fix functions/index.js lazy import + docs |
| `c1da20e` | v328: fix CSP source map Sentry SDK |
| `63857e4` | v329: preparación E2.b step 3 (SDK + CSP + region) |
| `9802133` | fix sapProxy CORS: `cors:true` (colgaba client-side) |
| `6209126` | v330: E2.b step 3 — sapSL rutea via Cloud Function sapProxy |
| `<pendiente>` | Este commit: docs finales sección 44 |
3. Si algún flujo rompe → pegar error → diagnosticar.
4. Si todo pasa → arrancar deploy de E1 Rules (comando en 44.3 punto 3, 5 min de trabajo).
5. Si vas por E5 o E6, allocá 30 min uninterrumpidos por checklist.

---

## 45) E2.b performance + code splitting (rama `e2b-perf`)

Trabajo iniciado 2026-07-27 después de cerrar Fase 0. **Rama `e2b-perf`**, NO mergeada a `main` todavía. Nada tocado de `main` hasta el gate final de E6 con Mariano.

Plan completo: `C:\Users\shimano.sandbox\.claude\plans\majestic-seeking-avalanche.md`.

### 45.1 Por qué hacemos esto

**Problema observado cualitativamente**: la app se tilda al cargar (main thread bloqueado durante segundos) y el mapa tiene delay notable al abrir y al panear/zoomear. En desktop es visible, en celular con 4G (donde realmente la usan los 6 vendedores en la calle) es peor.

**Problema medido cuantitativamente** (post E0 — ver `scripts/perf/BASELINE.md`): en Slow 4G emulado con CPU 4x, la app toma **28.6 segundos** hasta el LCP (Largest Contentful Paint). Transfer inicial de **5.3 MB**. Score Lighthouse mobile: **26/100** (red zone). Peor long task durante pan/zoom del mapa: **3.35 segundos** en un solo tick — literalmente el thread principal bloqueado 3+ seg cuando el vendedor mueve el mapa.

**Root cause identificado en el trace de E0**: 
1. Script inline de 28K líneas evaluado sincrónicamente al load (~4.4 seg de scriptEvaluation + parseCompile main thread breakdown).
2. Scripts CDN sync bloqueantes (Leaflet 883ms, xlsx 479ms, jszip 154ms).
3. Transfer 5.3 MB (geo.json 1.6 MB async pero pesa; Firebase SDKs 500 KB; etc.).
4. `drawMarkers()` sync loop en cada `zoomend` recorriendo 2000+ elementos.

**Outcome esperado post-E6**: shell inicial <500 KB, LCP mejora ≥40% vs baseline (target <17.2 s), cero long tasks >500ms en carga inicial, pan/zoom del mapa sin frames >200ms. **Cada mejora justificada por un número medido, no por hipótesis.**

### 45.2 Estado actual de las 7 etapas — TODAS CERRADAS 2026-07-28

| # | Etapa | Estado | Commit(s) | LOC extraídos / KB |
|---|---|---|---|---|
| E0 | Línea base medida (`scripts/perf/`) | ✅ | `addfa57` | — (~440 LOC scripts) |
| E1 | Fix leak de 23/31 listeners onSnapshot | ✅ | `ea59a77` | — (fix defensive) |
| E2 | Extracción por dominio VERBATIM (19 sub-commits) | ✅ | `9d2ef4f`..`db8bf46` | 14,275 LOC (50.1%) |
| E3 | Code splitting: shell + 3 chunks lazy | ✅ | `a99ddd5` | 359 KB chunks |
| E4 | Viewport filter en drawMarkers (culpable trace E0) | ✅ | `eb48c0a` | +18 LOC (fix quirúrgico) |
| E5 | SW stale-while-revalidate + reglas #18/#19 | ✅ | `7da1ce3` | — (arquitectural) |
| E6 | Fixes C1-C5 code review + FINAL-REPORT + docs | ✅ | `2b278e9` + este commit | 5 ReferenceError latentes |

**Total commits**: 24 en branch `e2b-perf`. **`main` intacto hasta merge post-smoke**.

Ver `scripts/perf/FINAL-REPORT.md` para: (a) instrucciones re-medición gate humano, (b) gates del plan pendientes de confirmar con números.

### 45.3 E0 — Línea base medida ✅ (2026-07-27, commit `addfa57`)

**Qué se hizo**:
- `scripts/perf/` nuevo con `lighthouse-baseline.js` + `trace-map.js` + `compare-vs-baseline.js` + `config.js` + `README.md`.
- devDeps: `lighthouse@12.9.0` + `puppeteer-core@24.24.0` (regla 1 CLAUDE.md incremental).
- 3 corridas de Lighthouse (median) + 2/3 corridas de trace-map (tolerante a fallos).
- **`scripts/perf/BASELINE.md`**: reporte con números + ranking de culpables **MEDIDOS**.

**Números baseline oficial** (2026-07-27 pre-E1, en `scripts/perf/baseline-*-2026-07-27.json`):
- Shell load: LCP **28.6 s**, FCP 14.5 s, TBT 1.5 s, transfer 5.3 MB, score **26/100**, 2 long tasks >500ms.
- Map paint post-login: **17.3 s**.
- Pan/zoom: peor long task **3.35 s**, 6 long tasks >200ms mediana, 2 long tasks >500ms mediana.

**Ranking de culpables medidos**:
1. Script inline 28K líneas: 3.55 s scriptEvaluation + 851 ms parseCompile + 2.34 s "Unattributable" long task.
2. CDN sync bloqueantes en `<head>`: Leaflet 883 ms + xlsx 479 ms + jszip 154 ms.
3. Transfer 5.3 MB: geo.json (1.6 MB async), Firebase SDKs (~500 KB), Leaflet CSS+JS (~150 KB).
4. Mapa pan/zoom: 3.35 s peor long task, candidato #1 `drawMarkers()` sync loop (sin stack sampling no lo confirmo — E4 con sampling identifica función exacta).

**Reglas nuevas en CLAUDE.md** (aprendidas durante E0):
- **8**: Puppeteer + Google OAuth no funciona — conectar a Chrome real via `--remote-debugging-port=9222`.
- **9**: `import.meta.url.pathname` deja `%20` en Windows — usar `fileURLToPath` de `node:url`.
- **10**: CDP con throttling puede timeoutear — dispatch events via `page.evaluate` con `MouseEvent`/`WheelEvent`.
- **11**: Scripts de perf en env inestable — tolerar fallos individuales si ≥2/3 corridas OK.

**Cómo re-correr** (para gate humano de Mariano post-cada-etapa o E6 final):
```powershell
# En otra consola:
python -m http.server 8000
# En una tercera, para trace-map (una sola vez la 1ra):
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\temp\perf-chrome"
# Loggeate en ese Chrome, después:
node scripts/perf/lighthouse-baseline.js
node scripts/perf/trace-map.js
```

### 45.4 E1 — Fix leak de 23/31 listeners onSnapshot ✅ (2026-07-27, commit `ea59a77`)

**Qué se hizo**:
- Audit del `index.html` reveló **31 listeners `onSnapshot` declarados**, pero `detachFirebaseListeners()` solo cerraba 8. Los otros **23 quedaban vivos al logout** → acumulaban memoria + CPU + network si el user logout/login repetidamente (session refresh, cambio de cuenta, TOTP, security code de Google, etc.).
- `detachFirebaseListeners()` reescrito con helper local `off(name, fn, setNull)` — reduce repetición + tolera fallos (leak parcial > leak total). Cubre los 31.
- Los 23 agregados: `unsubApprovedAltas`, `unsubClientMaster`, `unsubSapVendors`, `unsubTargets`, `unsubCustomRoutes`, `unsubRouteOverrides`, `unsubMyNotifs`, `unsubMyExternalPartners`, `unsubVisitsPartner`, `unsubMySentTasks`, `unsubAltaCliMine`, `unsubMisRendiciones`, `unsubTodasRendiciones`, `unsubSapConfig`, `unsubProductCatalog`, `unsubStockSnapshot`, `unsubPriceList`, `unsubTemporalPriceList`, `unsubVendorOverrides`, `unsubClientLocs`, `unsubSegNotes`, `unsubSegStatus`, `_unsubAutoSendPedidos`.
- `tests/unit/listeners.test.js` nuevo (8 tests): **linting automático** — parsea `index.html`, extrae `let/var unsub*` y compara contra `off('name', ...)` del detach. Si en el futuro se agrega un listener sin su `off()`, el test falla con el nombre exacto.

**False positive descartado**: el Explore agent había marcado el `unsubVisits` en `openVisitaModal` línea 25249 como "critical leak con double-binding". Re-verificado del código: **ya tenía guard** `if (!unsubVisits && currentUser)` — solo asigna si no existe. No es leak. Se documentó pero no se cambió la lógica.

**Regla 12 nueva en CLAUDE.md**: todo `onSnapshot()` debe tener su `unsub*` en `detachFirebaseListeners()`. El test unitario es la red de seguridad.

**Gate humano de E1** (Mariano — cuando quieras, no es bloqueante para E2): logout → login × 3 en la app real, F12 → Memory → heap snapshots antes/después. Sin acumulación de "Detached HTMLDivElement" u "onSnapshot" entre snapshots.

> **Actualización 2026-07-29**: TODAS las etapas de este plan están cerradas y mergeadas a `main` desde 2026-07-28 (squash merge en un solo commit por branch protection — la rama prohíbe merge commits). Ver sección 46 para resumen ejecutivo + los cambios adicionales v339-v348 en el changelog sección 41 (hotfixes post-merge pedidos por el equipo comercial: modo Contactado, edición de dirección por vendedor, descuento manual, fix duplicados SAP via transaction, Excel loader con precios del archivo, split líneas por stock, y modo forzoso del botón "Reubicar pines").

### 45.5 E2 COMPLETADO — Extracción por dominio VERBATIM (19 sub-etapas)

**Objetivo**: mover cada dominio del inline gigante a `src/domains/<name>.js` preservando cada `window.foo = ...` intacto. Cada sub-etapa una por commit, orden por menor dependencia primero.

**Orden planificado** (una sub-etapa por commit):

| # | Dominio | Líneas aprox. | LOC | Justificación del orden |
|---|---|---|---|---|
| E2.a | admin-users | 20700-21200 | ~500 | Menos deps, buen primer test del pattern |
| E2.b | targets | 11126-11500 | ~370 | Chico, aislable |
| E2.c | campañas | 26488-26800 | ~310 | Aislable |
| E2.d | seguimiento | 27734-28380 | ~646 | Deps: mapa (lookup clientes) |
| E2.e | rendiciones | 14700-16000 | ~1,300 | Deps: Storage, Gemini |
| E2.f | rutas | 12900-13500 | ~600 | Deps: mapa |
| E2.g | notificaciones + OCR | 14213-16060 | ~1,847 | Comparte helpers con rendiciones |
| E2.h | dashboard | 26114-26490 | ~376 | Deps: Firestore, POINTS |
| E2.i | product-picker | 18800-20400 | ~1,600 | Deps: Firestore products |
| E2.j | pedidos | 16320-18980 | ~2,660 | Grande, deps: mapa, product-picker, sap-client |
| E2.k | visitas | 14036-16100 | ~2,064 | Grande, deps: Storage, Gemini, mapa |
| E2.l | master-clientes | 6900-10600 | ~3,700 | El más grande, deps: Firestore, mapa, xlsx |
| E2.m | sap-integrations | 18995-23000 | ~4,005 | Grande, mostly autocontenido |
| E2.n | exports | 10687-12850 | ~2,163 | Depende de todos, último |

**Acciones por sub-etapa** (pattern idéntico):
1. Grep + lee las líneas del dominio en `index.html`.
2. Crear `src/domains/<name>.js`. Copiar **verbatim**, cada `window.foo = ...` intacto.
3. Agregar `import './domains/<name>.js';` (side-effect) en `src/main.js`.
4. Eliminar las líneas equivalentes del inline en `index.html`.
5. `npm run build` regenera `app.bundle.js`.
6. Suite: `npx vitest run tests/unit/ tests/functions/ tests/smoke/` (137 verdes actualmente + 8 listeners) + `npm run typecheck`.
7. Smoke manual del dominio en el browser (gate humano de Mariano, ~1 min).
8. Commit: `E2.x: extract <dominio> to src/domains (verbatim)`.

**Gate ejecutable por sub-etapa** (ver plan file 45.5 detalle):
- `npm run build` exit 0
- Bundle sigue conteniendo el `window.foo` esperado (verificado con `vm.runInNewContext`)
- 137+ tests verdes + typecheck exit 0
- Smoke manual del dominio (feature funciona sin console.error rojo)

**Riesgos de falso verde** (críticos):
- **Hoisting de `function foo(){}`**: mover un `function foo(){}` del inline al bundle → declaración se hoista en el bundle scope (que carga blocking en `<head>`, antes que inline). Si algún código inline restante llama `foo` — resuelve al `window.foo` del bundle. OK. Pero si borrás la definición inline SIN agregar el `import` — llama `foo` sin scope → undefined. Mitigar: verbatim copy + import side-effect al inicio de `main.js`.
- **Closures rotas**: el inline usa vars locales del `<script>`. Si un dominio las lee después de extracción, no las encuentra. Mitigar: verbatim COPY incluye las vars accedidas. Si dos dominios comparten una var, dejarla en `main.js` o `src/shared/*.js`.
- **Handlers `onclick="foo()"` HTML**: si `window.foo` no se preserva → click no hace nada, sin error visible. Test manual del dominio es la única detección. Gate humano crítico.

**Budget total E2**: 12 turnos (~1 turno cada 2 sub-etapas chicas, ~2 turnos para las 4 grandes).

### 45.6 E3 COMPLETADO — Code splitting con esbuild

Refactor `build.js` multi-entry: `src/main.js` → `shell.js` (nuevo nombre, mismo lugar que `app.bundle.js`), + `src/domains/<name>.js` → `chunks/<name>.js`. Loader dinámico `window.loadChunk(name)` con `<script>` injection (no eval, no dynamic import). Bump v330 → v331.

**Gate**: shell < 500 KB, cada chunk < 400 KB, suite verde, smoke manual con Network tab mostrando chunks descargándose on-demand.

Budget: 8 turnos.

### 45.7 E4 COMPLETADO — Fix mapa según trace de E0

**No hay decisión previa** — se elige el fix según lo que E0 confirmó + un trace refinado con stack sampling activado durante E4. Candidatos (uno o combinación):
- A: `polygon-clipping.union()` sin caché → mover a Web Worker
- B: `geo.json` JSON.parse main thread → stream o pre-split
- C: `drawMarkers()` sync loop → clustering con Leaflet.markercluster o batch con `requestIdleCallback` o viewport-based
- D: listeners cascade durante pan → debounce
- E: no anticipado

**Gate**: re-medición con scripts de E0 confirma culpable identificado mejora ≥40% del long task específico.

Budget: 6 turnos.

> **Update 2026-07-29 (post E4)**: fuera del plan formal, sobre `main` se aplicaron 3 mejoras adicionales al mapa en respuesta a report de usuario ("zoom laggy"):
> - **v351** — candidato B parcial: `geo.json` simplificado con Douglas-Peucker (1602 → 885 KB, -45%) + `preferCanvas: true` (polygonos en `<canvas>` en vez de SVG). Ver sección 41.
> - **v352** — candidato C: clustering con `leaflet.markercluster@1.5.3`.
> - **v353** — fix del bug de layers fragmentadas de v352 (cluster compartido con proxies por layer).

### 45.8 E5 COMPLETADO — SW audit + cache chunks

Extender `sw.js` STATIC_ASSETS con `./shell.js` + todos los `./chunks/*.js`. Cache-first + background update. Smoke offline + smoke bump `CACHE_VERSION` (verifica caché limpio sin mezcla vieja/nueva).

Budget: 3 turnos.

### 45.9 E6 COMPLETADO — Re-medición final + code review + docs

Correr scripts de perf sobre `e2b-perf` HEAD. `scripts/perf/compare-vs-baseline.js` emite diff numérico + assertion. Code review del diff completo con subagente `general-purpose` contexto limpio. `FINAL-REPORT.md` con before/after. README sección 45 actualizada.

**Gates finales** (todos deben pasar antes de merge a main):
- LCP shell **≥40% mejor** vs baseline E0 (target <17.2 s)
- Shell inicial **<500 KB** transferidos
- **Cero long tasks >500ms** en carga inicial
- Pan/zoom del mapa **sin frames >200ms**
- 137+ tests verdes + typecheck OK
- Smoke navegación cada módulo lazy sin errores console
- Code review del subagente sin flags

Budget: 3 turnos.

### 45.10 Cómo retomar mañana

1. `cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"`
2. `git checkout e2b-perf` (chequear con `git branch --show-current`)
3. `git log --oneline -5` — debería ver `ea59a77 E1` y `addfa57 E0` en top.
4. Al Claude: **"leé README sección 45 y arrancá con E2.a (admin-users)"**.
5. Sub-etapas se hacen una por commit, orden por menor dependencia (E2.a → E2.n).
6. Gate humano tuyo: smoke manual del dominio extraído tras cada sub-etapa (~1 min c/u).

**Al final de E2** (14 sub-etapas): pausar antes de arrancar E3 para que Mariano revise el diff acumulado y decida si mergear a main un "E2 completo" antes de E3, o esperar hasta E6 completo.

**Verificación de sanidad en cualquier momento** (sin correr scripts perf pesados):
```powershell
npx vitest run tests/unit/ tests/functions/ tests/smoke/
npm run typecheck
npm run build
```

Los 137 tests + typecheck son el "canario" de regresiones. Si rompe algo → freno + causa raíz (regla 4 CLAUDE.md).

### 45.11 Commits de la sesión 2026-07-27 (rama `e2b-perf`, NO pusheados a origen)

| Commit | Descripción |
|---|---|
| `addfa57` | E0: línea base medida con Lighthouse + Puppeteer CDP + baseline JSON + BASELINE.md + reglas 8-11 CLAUDE.md |
| `ea59a77` | E1: fix leak 23/31 listeners onSnapshot + test linting listeners + regla 12 CLAUDE.md |

Ambos en `e2b-perf` local, sin push a origen. El branch queda listo para arrancar E2 mañana.

## 46) E2-E6 completados 2026-07-28 — resumen ejecutivo

Cerradas E2 (19 extracciones), E3 (code splitting), E4 (fix mapa), E5 (SW), E6 (code review + fixes + docs) en 24 commits del branch `e2b-perf`. **Aún no mergeado a `main`** — pendiente re-medición + smoke manual (ver `scripts/perf/FINAL-REPORT.md`).

### 46.1 Métricas hard (post-E6)

| | Pre-E2 | Post-E6 | Delta |
|---|---|---|---|
| `index.html` líneas | 28,511 | **14,236** | **-50.1%** |
| Dominios en `src/domains/*.js` | 0 | **19** | +19 archivos |
| `app.bundle.js` (shell) | 44 KB | **1.89 MB** | shell contiene 17 dominios |
| `chunks/*.js` (lazy) | — | **359 KB** (3 chunks) | nuevo, on-demand |
| Tests smoke/unit/functions | 129 | **143** | +14 nuevos |
| CLAUDE.md reglas | 12 | **19** | +7 nuevas |
| APP_VERSION | v330 | **v336** | +6 versiones (v331 hotfix, v332 W07→11, v333 E3, v334 E4, v335 E5, v336 fixes) |

### 46.2 Los 19 dominios extraídos (bundle IIFE via esbuild)

- **Shell** (16 dominios, cargados al load): `targets`, `campanias`, `dashboard`, `seguimiento`, `rutas`, `rendiciones`, `notificaciones` (parcial), `product-picker`, `visitas`, `pedidos-modal`, `master-clientes`, `sap-integration-modal`, `sap-service-layer`, `sap-auto-send-listener`, `sap-admin-panel`, `exports-sap`.
- **Chunks lazy** (3 dominios, cargados on-demand): `exports-core`, `exports-advanced`, `admin-users`.

Cada `src/domains/*.js` es verbatim del inline: 0 refactor de lógica, solo el pattern cross-scope (regla #13/#17) donde una variable es leída/escrita entre bundle e inline.

### 46.3 Bugs latentes descubiertos por code review E6 (commit `2b278e9`)

Subagent con contexto limpio detectó 5 `ReferenceError` runtime silenciados por `try/catch` que ningún test unitario capturaba. Todos son del patrón regla #17: `let X` en bundle donde inline lee/escribe X sin prefix window.

| Bug | Var | Bundle | Inline | Impacto |
|---|---|---|---|---|
| C1 | `usersCache` | admin-users (chunk) | notificaciones (shell) `syncUsersDirectory` | users_directory nunca publica → dropdown tareas vacío |
| C2 | `mcShowBaseMaster` | master-clientes | `toggleMcBaseMaster` L4048 | Botón Masterfile-Base tira excepción |
| C3 | `notifsTab` | notificaciones | `updateNotifsBadge` L8519 | Notif no re-renderea live cuando pane abierto |
| C4 | `rutaVendorFilter` | rutas | derivar/reagendar tiendas | admin sin `assignedVendor` no puede derivar |
| C5 | `sapCurrentTab` | sap-admin-panel | callback `unsubPedidosAll` | Panel SAP no refresca pedidos en tiempo real |

Todos corregidos con el patrón cross-scope estándar (`if (typeof window.X === 'undefined') window.X = ...` + reads/writes explícitos con `window.` prefix).

### 46.4 Warnings del code review pendientes de fix (no bloqueantes)

- **W1** `mcRenderDeferred`: silent divergence (inline crea `window.X`, bundle usa `let` local sin sync). Renders diferidos pueden perderse en race condition poco frecuente.
- **W2** `_origListenSapConfig`: dead code en `sap-auto-send-listener.js:111` (`const X = (...) ? null : null;`). Sin impacto runtime.
- **W3** `window.unsubVisits` doble asignación en rutas + visitas (guards previenen doble listener, pero patrón frágil).

Fixear en commits futuros post-merge.

### 46.5 Gates del plan — assessment

| Gate | Objetivo | Status |
|---|---|---|
| LCP ≥40% mejor vs baseline (target <17.2s) | Métrica externa | **PENDIENTE** re-medición local |
| Shell inicial <500 KB transferidos | Meta hard | ❌ **NO** — shell 1.89 MB (contiene 17 dominios). Requiere split más agresivo. |
| Cero long tasks >500ms carga inicial | Meta hard | **PENDIENTE** re-medición |
| Pan/zoom sin frames >200ms | Meta hard | **PENDIENTE** re-medición (E4 aplicado viewport filter, debería lograrlo) |
| 129+ tests locales verdes | ✅ **143/143** | Superado |
| Typecheck | ✅ 0 errores | Superado |
| Smoke navegación cada módulo | Gate humano | **PENDIENTE** — ver `scripts/perf/FINAL-REPORT.md` §Follow-up |

**Meta del shell < 500 KB no alcanzada en este ciclo**: la mayoría de los dominios tienen `ensure*Listener` que se llama al login (attachFirebaseListeners en el inline), obligándolos a estar en el shell. Solo pudimos hacer lazy los 3 que se abren claramente al click (exports-core, exports-advanced, admin-users). Alcanzar < 500 KB requiere refactor de attachFirebaseListeners para pre-loadear chunks en lugar de importarlos estáticamente. Fuera de scope de este ciclo.

### 46.6 Next steps

1. **Re-medición local** (10 min): seguir instrucciones en `scripts/perf/FINAL-REPORT.md`.
2. **Smoke manual completo**: 19 dominios × 30 seg cada uno ≈ 10 min. Confirmar que cada tab funciona post-fixes C1-C5.
3. **Rebase clean + squash o keep-commits** según preferencia antes de merge.
4. **Merge a `main` + push + GitHub Pages auto-deploy** con APP_VERSION v336.
5. **Post-deploy**: monitorear Sentry por nuevas issues (`ChunkLoadError` es la nueva superficie).
6. **Follow-ups** (commits futuros): warnings W1-W3, más chunks lazy (product-picker, pedidos-modal, visitas si se logra desacoplar listeners al login).

