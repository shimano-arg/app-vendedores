# Dashboard de Ventas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pantalla "Dashboard de Ventas" con 6 filtros, 4 tarjetas, 2 Top 20 y 3 gráficos de 12 meses, alimentada por una CF que consulta BigQuery.

**Architecture:** BigQuery (vistas existentes + tabla/vista nuevas de back order) → callable `dashboardVentasCF` (wrapper) → `functions/core/dashboard-ventas-core.js` (lógica pura) → chunk lazy `src/domains/dashboard-ventas.js` con Chart.js on-demand.

**Tech Stack:** BigQuery SQL, Python (sync), Node 22 Cloud Functions Gen2 (`@google-cloud/bigquery` ya instalado en `functions/`), JS vanilla + Chart.js 4.4.1 (cdnjs), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-dashboard-ventas-design.md`

## Global Constraints

- Universo: solo pesca (`is_pesca = TRUE`) y `assigned_vendor IS NOT NULL`.
- Montos sin IVA: `importe_linea_ars` (neto descuento, NC con signo negativo).
- "Pedidos" = facturas: `COUNT(DISTINCT doc_entry)` con `doc_kind = 'INVOICE'`; "pedidos únicos" = `COUNT(DISTINCT card_code)` con `doc_kind = 'INVOICE'`.
- Rol vendedor: el servidor reemplaza el filtro vendedor por `roles/{uid}.vendor`; nunca confía en lo que manda el cliente.
- Queries BQ siempre parametrizadas (`@param`), nunca concatenando valores del usuario.
- Región `southamerica-east1`, `enforceAppCheck: false` (§23), dominios `shimano.com.ar` / `shimano.uy`.
- Mensajes al vendedor desde `MENSAJES_VENDEDOR` (§68).
- Chunk lazy sincronizado en `build.js` + `src/main.js` + `sw.js` (§18); bump `APP_VERSION` + `CACHE_VERSION`.
- Modal con altura fija y scroll interno (§49).
- Documentar en README §41 (§30).
- Meses estimados con desvío de validación > 15% no se muestran.

## Review Focus

1. Vendedor que manda `vendedores: ['OTRO']` en el payload → recibe solo lo suyo (test en Task 3).
2. Vendedor sin `roles.vendor` cargado → `permission-denied`, no "ver todo" (test en Task 3).
3. Filtros que no matchean nada → tarjetas en 0 y listas vacías, sin error (test en Task 3 + estado vacío en Task 5).
4. Mes sin foto real ni reconstrucción (antes de la ventana) → punto `null`, no 0, para no dibujar una caída falsa (test en Task 3).
5. Valores de filtro con comillas o caracteres raros (`O'HIGGINS`) → viajan como parámetro, no rompen la query (test en Task 3).

---

### Task 1: Foto diaria del back order en BigQuery

**Files:**
- Modify: `bigquery/views.sql` (agregar `v_backorder_dashboard`)
- Modify: `scripts/sync_sap_to_bigquery.py` (función nueva + llamada en `main()` después del paso 11)
- Test: `tests/python/test_backorder_daily_snapshot.py`

**Interfaces:**
- Produces: vista `shimano_app.v_backorder_dashboard` con columnas `item_code, card_code, assigned_vendor, provincia_cliente, familia, pendiente_uds, precio_unitario, pendiente_ars` (pesca, vendedor no nulo; vendedor y provincia resueltos con el mismo join que usa `v_ventas_lineas`).
- Produces: tabla `shimano_app.backorder_daily_snapshot` = columnas de la vista + `snapshot_date DATE`, particionada por `snapshot_date`.
- Produces: `sync_backorder_daily_snapshot(bq_client, dry_run=False, now=None) -> int` (filas escritas; 0 si se saltea).

- [ ] **Step 1:** Test `test_skip_before_23h_art`: con `now` = 2026-10-29 15:00 ART devuelve 0 y no llama a `bq_client.query`.
- [ ] **Step 2:** Test `test_idempotent_same_day`: con `now` 23:30 ART ejecuta un `DELETE ... WHERE snapshot_date = @d` antes del `INSERT ... SELECT` (assert sobre el orden de las queries del mock).
- [ ] **Step 3:** Correr `python tests/python/test_backorder_daily_snapshot.py` → FAIL.
- [ ] **Step 4:** Crear la vista y la función. Crear la tabla con `CREATE TABLE IF NOT EXISTS ... PARTITION BY snapshot_date`. Llamada en `main()` envuelta en `try/except` no bloqueante como los pasos vecinos.
- [ ] **Step 5:** Correr el test → PASS. `bq query --dry_run` de la vista → sin error.
- [ ] **Step 6:** Commit `feat(bq): foto diaria del back order para Dashboard de Ventas`.

### Task 2: Reconstrucción estimada + script de validación

**Files:**
- Modify: `bigquery/views.sql` (agregar `v_backorder_reconstruido_mensual`)
- Create: `scripts/audit/BQ_validar_backorder_reconstruido.py`

**Interfaces:**
- Produces: vista con `mes_fin DATE, item_code, card_code, assigned_vendor, provincia_cliente, familia, pendiente_uds, pendiente_ars`, 12 meses previos al primer `snapshot_date`. Algoritmo y limitaciones: spec §3.2 (cadena Invoice `BaseType 17` → SO `BaseType 23` → SQ; clamp 0 por línea).
- Produces: `python scripts/audit/BQ_validar_backorder_reconstruido.py --mes AAAA-MM --valor N --tipo ars|uds` imprime reconstruido vs real y desvío %. Exit 0 si desvío ≤ 15%, exit 2 si no.

- [ ] **Step 1:** `bq query --dry_run` de la vista → sin error; correrla limitada al último mes y comparar a mano contra `SUM(pendiente)` de `v_backorder_lineas` de hoy: deben dar parecido. Pegar ambos números en el commit.
- [ ] **Step 2:** Crear el script (solo lectura).
- [ ] **Step 3:** Commit `feat(bq): reconstrucción estimada del back order mensual + validador`.
- [ ] **Step 4 (gate humano):** pedir a Mariano el mes y el valor real de referencia, correr el validador y pegar la salida. Si sale exit 2, Task 3 devuelve las series sin meses estimados (flag `mostrarEstimados = false` en `app_config/dashboard_ventas`).

### Task 3: Core puro `dashboard-ventas-core.js`

**Files:**
- Create: `functions/core/dashboard-ventas-core.js`
- Test: `tests/functions/dashboard-ventas-core.test.js`

**Interfaces:**
- Produces: `normalizeFilters(raw) -> {mes, vendedores[], clientes[], provincias[], categorias[], skus[]}` (arrays de strings trimmed, sin vacíos, máx 200 valores c/u; `mes` validado `/^\d{4}-\d{2}$/`, default mes en curso ART).
- Produces: `applyRoleScope(filters, {role, vendor}) -> filters` (vendedor: `vendedores = [vendor]`; admin/gerente: sin cambio; vendedor sin vendor u otro rol: throw `{code:'permission-denied'}`).
- Produces: `buildQueries(filters) -> {kpis, topSkus, serieVentas, serieBackorder, opciones}`, cada una `{query, params}` (filtro vacío = condición `(ARRAY_LENGTH(@x) = 0 OR col IN UNNEST(@x))`).
- Produces: `dashboardVentasCore(deps, {auth, data}) -> Promise<DashboardResponse>` con `deps = {runQuery(q, params) -> rows[], getUserRole(uid) -> {role, vendor}, cache, now}`.
- `DashboardResponse = {kpis:{facturado, backorderArs, pedidos, pedidosUnicos}, topUnidades[{sku, desc, uds, ars}], topDinero[...], serieVentas[{mes, valor}], serieBoUds[{mes, valor|null, estimado}], serieBoArs[...], opciones:{vendedores, clientes[{code,name}], provincias, categorias, skus[{code,desc}]}, dataUpdatedAt}`.

- [ ] **Step 1:** Tests (mock `runQuery` que devuelve filas fijas):
  - `vendedor_forzado`: rol vendedor `MAURICIO GIL` pide `vendedores:['PACHI']` → params de todas las queries tienen `vendedores = ['MAURICIO GIL']`.
  - `vendedor_sin_vendor_rechaza`: `{role:'vendedor', vendor:''}` → rechaza `permission-denied`.
  - `rol_desconocido_rechaza`.
  - `admin_sin_filtros`: arrays vacíos en params.
  - `comillas_como_param`: provincia `O'HIGGINS` aparece en `params`, nunca en el texto `query`.
  - `mes_invalido_default`: `mes:'2026-13'` → mes en curso.
  - `top_neto_negativo_al_final`: SKU con `ars < 0` queda último en `topDinero`.
  - `sin_datos`: `runQuery` → `[]` → kpis en 0, listas vacías.
  - `mes_sin_dato_es_null`: serie back order sin fila para un mes → `valor: null`.
  - `estimado_flag`: mes anterior al primer snapshot → `estimado: true`; con `mostrarEstimados=false` → `valor: null`.
  - `cache_hit`: dos llamadas iguales del mismo uid dentro de 10 min → `runQuery` invocado una sola vez.
- [ ] **Step 2:** `npx vitest run tests/functions/dashboard-ventas-core.test.js` → FAIL.
- [ ] **Step 3:** Implementar. Series: 12 meses terminando en `filters.mes`; back order fin de mes = foto del último `snapshot_date` del mes, si no hay → vista reconstruida (`estimado: true`).
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(functions): core del Dashboard de Ventas`.

### Task 4: Wrapper `dashboardVentasCF`

**Files:**
- Modify: `functions/index.js` (export nuevo, patrón de `releaseAsigCF`)
- Modify: `src/pure/mensajes-vendedor.js` (entrada `DASHBOARD_VENTAS_FAILED`)
- Test: `tests/unit/mensajes-vendedor.test.js` (ya cubre jerga para cada entry)

**Interfaces:**
- Consumes: `dashboardVentasCore` (Task 3).
- Produces: callable `dashboardVentasCF(data: filtros) -> DashboardResponse`; errores como `HttpsError` (`unauthenticated`, `permission-denied`, `internal`).

- [ ] **Step 1:** Implementar: `runQuery` con `new BigQuery({projectId:'app-vendedores-shimano'}).query({query, params, location:'southamerica-east1'})`, `getUserRole` leyendo `roles/{uid}`, caché `Map` a nivel módulo. `memory: '512MiB'`, `timeoutSeconds: 60`.
- [ ] **Step 2:** `npx vitest run tests/functions tests/unit/mensajes-vendedor.test.js` → PASS; `npm run typecheck` limpio.
- [ ] **Step 3:** Commit `feat(functions): dashboardVentasCF`.

### Task 5: Pantalla (chunk lazy)

**Files:**
- Create: `src/domains/dashboard-ventas.js`
- Modify: `build.js` (`LAZY_CHUNKS['dashboard-ventas'] = ['openDashboardVentas','closeDashboardVentas']`), `src/main.js` (`installChunkStubs` con la misma lista), `sw.js` (`'./chunks/dashboard-ventas.js'` + `CACHE_VERSION`), `index.html` (botón al lado de `#dashboard-btn` y en `mnav`, modal `#dashboard-ventas-modal`, `APP_VERSION`)
- Modify: CSS de §49 en `index.html` (agregar `#dashboard-ventas-modal .modal-box`)
- Test: `tests/unit/audit/dashboard-ventas-ui.test.js`

**Interfaces:**
- Consumes: `dashboardVentasCF` (Task 4), `formatMensajeConCodigo` (§68).
- Produces: `window.openDashboardVentas()`, `window.closeDashboardVentas()`.

- [ ] **Step 1:** Test de contrato: chunk en los 3 lugares con la misma lista de exports; `#dashboard-ventas-modal` en el bloque CSS §49; botón visible para vendedor (no oculto por rol); textos exactos de las tarjetas `Facturado mensual`, `Valorización backorder`, `Cant. de pedidos del mes`, `Cant. pedidos únicos`; leyenda `Montos sin IVA, con descuento aplicado y notas de crédito restadas.`; títulos `Top 20 SKU - Unidades`, `Top 20 SKU - Dinero`, `Evolución de ventas`, `Evolución del backorder - Unidades`, `Evolución del backorder - Dinero`; botón `Ver más`; Chart.js cargado desde `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar: filtros multiselección con búsqueda (vendedor bloqueado si rol vendedor), "Aplicar" dispara la callable, estado "Cargando…", estado vacío "No hay ventas con esos filtros.", error con `formatMensajeConCodigo('DASHBOARD_VENTAS_FAILED')`. Tarjetas 2×2 en mobile. Top 20 en barras horizontales; "Ver más" abre tabla completa con búsqueda. Líneas de back order: dataset estimado con `borderDash: [6,4]` y leyenda "estimado"; `null` corta la línea (`spanGaps: false`).
- [ ] **Step 4:** `node build.js` + `npm run test:unit` + `npm run test:smoke` + `npx biome check src tests` + `npm run typecheck` → todo verde.
- [ ] **Step 5:** README §41 entrada v152X (Antes/Problema/Cambio/Por qué/Verificación/Rollback) + commit `feat: Dashboard de Ventas`.

### Task 6: Verificación en producción (gate humano)

- [ ] **Step 1:** Mariano mergea; deploy `firebase deploy --only functions:dashboardVentasCF --project app-vendedores-shimano`; aplicar vistas (`bigquery/views.sql`) con el script de deploy de vistas existente.
- [ ] **Step 2:** Con admin: tarjeta "Facturado mensual" del mes anterior, sin filtros, vs `SUM(importe_linea_ars)` de `v_ventas_lineas` pesca de ese mes → iguales.
- [ ] **Step 3:** Con un usuario vendedor (§90): solo ve su vendedor y no lo puede cambiar.
- [ ] **Step 4:** Al día siguiente: `SELECT COUNT(*) FROM backorder_daily_snapshot WHERE snapshot_date = CURRENT_DATE('America/Argentina/Buenos_Aires') - 1` > 0.
- [ ] **Step 5:** Primera semana: medir costo con `INFORMATION_SCHEMA.JOBS` filtrando el service account de la CF y reportar.
