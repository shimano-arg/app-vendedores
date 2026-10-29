# Dashboard de Ventas fase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sumar al Dashboard de Ventas tarjetas de gestión, tabla de interacciones, tabla de productos, cobertura de cartera, facturación por cliente, campañas activas, estilo Apple, etiquetas de dato y evolución desde jun-26.

**Architecture:** Misma callable `dashboardVentasCF`. Las queries nuevas viven en módulos propios (`dashboard-ventas-queries-gestion.js`, `-productos.js`, `-campanias.js`) y el core las corre en paralelo con las 5 de v1529. Cada sección nueva falla sola (`secciones.<x> = {error:true}`). El front (`src/domains/dashboard-ventas.js`) suma una sección por bloque; reservadas/libre/stock salen de `getStockBreakdown` del navegador.

**Tech Stack:** Firebase Functions Gen2 (Node 22), `@google-cloud/bigquery`, BigQuery `shimano_app`, Chart.js 4.4.1 (cdnjs), Vitest, biome.

**Spec:** `docs/superpowers/specs/2026-10-29-dashboard-ventas-fase2-design.md`

## Global Constraints

- Fechas como parámetro SIEMPRE `STRING` + `DATE(@x)` en el SQL; nunca tipo `'DATE'` (hotfix #1300).
- Valores del usuario solo como parámetros; arrays con `types: ['STRING']`; predicado `(COALESCE(ARRAY_LENGTH(@p),0)=0 OR UPPER(TRIM(col)) IN UNNEST(@p))` (patrón `arrayPredicate` existente).
- Vendedor: el servidor fuerza `filters.vendedores=[vendor]` para rol vendedor (`applyRoleScope`, ya existe); toda query nueva lo usa.
- Vendedor en `v_targets` viene en mayúsculas/minúsculas mixtas: comparar `UPPER(TRIM(vendedor))`.
- Cobertura: inicio fijo `'2026-06-01'`; resultado = compraron / dados de alta (36/66 → 54.55).
- Base activa: 90 días previos al fin del mes elegido; si el mes es el en curso, hasta hoy (ART).
- Ticket promedio = facturado / pedidos; pedidos = 0 → 0.
- Evolución (ventas y back order) desde `'2026-06'` hasta el mes elegido (`SERIE_DESDE = '2026-06'`).
- Interacciones: tope 500 filas (`MAX_INTERACCIONES = 500`); se devuelve `total`.
- Textos para vendedores sin jerga (§68): "No disponible", "Sin target", "no se filtra por cliente/producto".
- Chunk lazy: si se agregan exports, sincronizar `build.js`, `src/main.js`, `sw.js` (§18); bump `APP_VERSION`/`CACHE_VERSION`; `node build.js` y commitear bundle + chunks.
- Antes de cada push: `npm run lint` (repo entero, incluye formato), `npm run typecheck`, `npm run test:unit`, `npm run test:smoke`, `npx vitest run tests/functions/dashboard-ventas-*.test.js`.
- README §41 entrada por entrega (formato §30). Deploy por entrega: `firebase deploy --only functions:dashboardVentasCF`.

## Review Focus

- Filtro por Cliente/SKU/Categoría con target/rendiciones: las tarjetas no deben dar 0 ni mezclar; muestran el valor del vendedor+mes con la nota. Test en Task 2.
- Vendedor sin target (PACHI) o mes sin target: "Sin target" y cumplimiento null, nunca división por cero ni "Infinity%". Test en Task 2.
- Mes en curso para base activa: ventana termina hoy, no el último día del mes. Test en Task 1.
- Producto con back order y sin venta en el mes (y viceversa): aparece en la tabla con 0 en lo que falta. Test en Task 6.
- Mes elegido anterior a jun-26 (ej. 2026-03): la serie de evolución no queda vacía ni invertida; arranca en el mes elegido si es anterior a jun-26. Test en Task 11.

---

## Entrega A — tarjetas, interacciones, estilo Apple

### Task 0: Confirmar columnas en BigQuery (gate humano)

`v_visitas_full` (usada por `v_cartera_vendor`) no está en `bigquery/views.sql`. Mariano corre en BigQuery y pega el resultado:

```sql
SELECT table_name, column_name, data_type
FROM `app-vendedores-shimano.shimano_app.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name IN ('v_visitas','v_visitas_full','v_targets','v_rendiciones','v_cartera_vendor','v_campanias_progreso','v_campanias_ventas_detalle')
ORDER BY table_name, ordinal_position
```

- [ ] Si `v_visitas_full` tiene `card_code`: interacciones leen de `v_visitas_full` y respetan el filtro Cliente.
- [ ] Si no: leen de `v_visitas` (`tienda` como cliente) y la tabla muestra la nota "no se filtra por cliente". Anotar la decisión en el commit de Task 1.

### Task 1: Queries de gestión

**Files:**
- Create: `functions/core/dashboard-ventas-queries-gestion.js`
- Modify: `functions/core/dashboard-ventas-queries.js` (exportar `arrayPredicate`, `filterParams`, `currentMonthArt` si no lo están)
- Test: `tests/functions/dashboard-ventas-gestion-queries.test.js`

**Interfaces:**
- Consumes: `DashboardFilters`, `BqQuery`, `arrayPredicate`, `filterParams`, `currentMonthArt` de `dashboard-ventas-queries.js`.
- Produces: `buildGestionQueries(f: DashboardFilters, nowMs: number) -> { target: BqQuery, rendiciones: BqQuery, actividad: BqQuery, interacciones: BqQuery, baseActiva: BqQuery }`; `ventanaBaseActiva(mes: string, nowMs: number) -> { desde: string, hasta: string }` (AAAA-MM-DD); `MAX_INTERACCIONES = 500`.

Columnas esperadas por el core: `target` → `target_ars`; `rendiciones` → `monto_ars`; `actividad` → `visitas, contactados`; `interacciones` → `cliente, fecha (STRING AAAA-MM-DD), vendedor, tipo ('visita'|'contacto'), total`; `baseActiva` → `clientes`.
Target, rendiciones y actividad filtran SOLO por vendedor + mes; interacciones además por cliente si Task 0 lo habilita; baseActiva usa todos los filtros de ventas (`VENTAS_BASE` + `doc_kind='INVOICE'`).

- [ ] **Step 1: Tests**

```js
it('ventanaBaseActiva: mes cerrado = 90 días al último día', () => {
  expect(ventanaBaseActiva('2026-09', Date.parse('2026-10-29T15:00:00Z'))).toEqual({ desde: '2026-07-03', hasta: '2026-09-30' });
});
it('ventanaBaseActiva: mes en curso termina hoy (ART)', () => {
  expect(ventanaBaseActiva('2026-10', Date.parse('2026-10-29T15:00:00Z'))).toEqual({ desde: '2026-07-31', hasta: '2026-10-29' });
});
it('ningún parámetro llega vacío a BigQuery', () => { /* mismo patrón que dashboard-ventas-core.test.js: valueToQueryParameter_ sobre cada param de cada query */ });
it('target/rendiciones/actividad no usan filtros de cliente/sku/categoría', () => {
  const qs = buildGestionQueries(normalizeFilters({ mes: '2026-09', clientes: ['C1'], skus: ['X'] }, NOW), NOW);
  for (const k of ['target', 'rendiciones', 'actividad']) expect(Object.keys(qs[k].params)).not.toContain('clientes');
});
it('interacciones: LIMIT 500 y total con COUNT(*) OVER()', () => {
  const q = buildGestionQueries(normalizeFilters({ mes: '2026-09' }, NOW), NOW).interacciones.query;
  expect(q).toContain('LIMIT 500'); expect(q).toMatch(/COUNT\(\*\) OVER\s*\(\)/);
});
```

- [ ] **Step 2:** `npx vitest run tests/functions/dashboard-ventas-gestion-queries.test.js` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementar. `ventanaBaseActiva`: `hasta` = min(último día del mes, hoy ART); `desde` = `hasta` − 89 días (90 días inclusive).
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `feat(dashboard): queries de gestión (target, rendiciones, actividad, interacciones, base activa)`.

### Task 2: Core — sección gestión con falla parcial

**Files:**
- Modify: `functions/core/dashboard-ventas-core.js`
- Test: `tests/functions/dashboard-ventas-core.test.js`

**Interfaces:**
- Consumes: `buildGestionQueries`, `MAX_INTERACCIONES` (Task 1).
- Produces en `DashboardResponse`:
  `gestion: { target: number|null, cumplimientoPct: number|null, rendicionesArs: number, baseActiva: number, ticketPromedio: number, visitas: number, contactados: number, interacciones: number, tablaInteracciones: { rows: {cliente: string, fecha: string, vendedor: string, tipo: string}[], total: number }, filtrosNoAplican: boolean } | null`
  y `secciones: { gestion?: { error: true } }`.
  Helper exportado `runSeccion(run, queries) -> Promise<{ ok: true, rows: Record<string, any[]> } | { ok: false }>` (reutilizado por Tasks 7 y 10).

Reglas: target 0 o sin filas → `target: null`, `cumplimientoPct: null`. `cumplimientoPct = round(facturado / target × 100, 2)`. `ticketPromedio = pedidos > 0 ? facturado / pedidos : 0`. `interacciones = visitas + contactados`. `filtrosNoAplican = clientes|skus|categorias|provincias no vacíos`. Si cualquier query de gestión rechaza → `gestion: null`, `secciones.gestion = {error:true}`, el resto de la respuesta igual.

- [ ] **Step 1: Tests**

```js
it('cumplimiento = facturado / target', async () => { /* mock: facturado 800000, target_ars 1000000 */ expect(r.gestion.cumplimientoPct).toBe(80); });
it('sin target → null, nunca Infinity', async () => { /* target sin filas */ expect(r.gestion.target).toBeNull(); expect(r.gestion.cumplimientoPct).toBeNull(); });
it('ticket sin facturas = 0', async () => { /* pedidos 0 */ expect(r.gestion.ticketPromedio).toBe(0); });
it('falla de una query de gestión no rompe el resto', async () => { /* runQuery rechaza solo la query '-- dashboard:target' */ expect(r.gestion).toBeNull(); expect(r.secciones.gestion).toEqual({ error: true }); expect(r.kpis.facturado).toBe(800000); });
it('filtro cliente → filtrosNoAplican true', async () => { expect(r.gestion.filtrosNoAplican).toBe(true); });
it('vendedor: queries de gestión reciben solo su vendor', async () => { /* rol vendedor PACHI pide vendedores:['GONZALO DE LA ROSA'] */ /* todos los params vendedores de gestión === ['PACHI'] */ });
```

Las queries se identifican en el mock por el comentario `-- dashboard:<nombre>` de la primera línea (convención existente).

- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS (+ los 24 tests previos). **Step 5:** Commit `feat(dashboard): sección gestión con falla parcial`.

### Task 3: Pantalla — tarjetas de gestión y tabla de interacciones

**Files:**
- Modify: `src/domains/dashboard-ventas.js` (`renderResults`, `_card`)
- Test: `tests/unit/audit/dashboard-ventas-ui.test.js`

**Interfaces:**
- Consumes: `d.gestion`, `d.secciones` (Task 2).
- Produces: `_gestionSection(g, secciones) -> string` (HTML), `_interaccionesSection(t) -> string`; ids `dv-gestion`, `dv-interacciones`, buscador `dv-interacciones-buscar`.

Tarjetas en este orden: Target, % cumplimiento, Rendiciones – monto, Base activa, Ticket promedio, N° visitas, N° contactados, N° interacciones. `target null` → "Sin target"; `gestion null` → una tarjeta "No disponible" en lugar del bloque. `filtrosNoAplican` → nota "Target, rendiciones y actividad: no se filtra por cliente/producto". Tabla: Cliente, Fecha (DD/MM/AAAA), Vendedor, Tipo; buscador filtra por DOM (mismo patrón CodeQL-safe que "Ver más": valor seteado por DOM, `_escHtml` local); si `total > rows.length` → "Mostrando 500 de N". Scroll interno con `max-height` + `overflow-y:auto` (§49).

- [ ] **Step 1:** Tests de contrato (grep de ids, textos exactos "Sin target", "No disponible", "Mostrando ", y que `_interaccionesSection` escape el cliente: render con `cliente:'<img src=x>'` no contiene `<img`).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5:** Commit.

### Task 4: Estilo Apple

**Files:**
- Modify: `styles/apple-design.css` (bloque nuevo al final, todo bajo `#dashboard-ventas-modal`)
- Modify: `src/domains/dashboard-ventas.js` (opciones de Chart.js: grillas `rgba(0,0,0,.06)`, sin borde de ejes, fuente system)
- Test: `tests/unit/audit/dashboard-ventas-apple.test.js`

Valores (spec §5): overlay `backdrop-filter: blur(20px) saturate(180%)`; fondo cuerpo `#f5f5f7`; tarjetas `#fff`, radio 16px, `box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.06)`, sin borde; acento `#49A2DA`; font `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif`; números de tarjeta `letter-spacing:-0.02em`; `:active{transform:scale(.97)}` con `transition:100ms ease-out` en botones; `@media (prefers-reduced-motion: reduce)` sin transform.

- [ ] **Step 1:** Test: todas las reglas nuevas del bloque empiezan con `#dashboard-ventas-modal`; contiene `backdrop-filter`, `#f5f5f7`, `#49A2DA`, `prefers-reduced-motion`.
- [ ] **Step 2:** FAIL. **Step 3:** CSS. **Step 4:** PASS. **Step 5:** Commit.

### Task 5: Release A

- [ ] Bump `APP_VERSION`/`CACHE_VERSION` (próximo libre), `node build.js`, README §41 (Antes/Problema/Cambio/Por qué/Verificación/Deploy/Rollback), checks de Global Constraints, PR. Deploy `dashboardVentasCF`. Prueba manual admin + PACHI (§90).

---

## Entrega B — productos, cobertura, facturación por cliente

### Task 6: Queries de productos, cobertura y clientes

**Files:**
- Create: `functions/core/dashboard-ventas-queries-productos.js`
- Test: `tests/functions/dashboard-ventas-productos-queries.test.js`

**Interfaces:**
- Produces: `buildProductosQueries(f, nowMs) -> { productos: BqQuery, cobertura: BqQuery, clientes: BqQuery }`; `COBERTURA_DESDE = '2026-06-01'`.

Columnas: `productos` → `categoria, familia, sku, uds_vendidas, facturado, uds_backorder` (FULL OUTER JOIN por SKU entre ventas del mes y `backorder_dashboard_actual`, `COALESCE(...,0)`); `cobertura` → `vendedor, dados_alta, compraron` (`v_cartera_vendor` con `card_code` no nulo, por `UPPER(TRIM(vendor_key))`, LEFT JOIN a clientes con factura entre `DATE(@coberturaDesde)` y `LAST_DAY(DATE(@hasta))`; filtra por `vendedores`); `clientes` → `card_code, nombre, facturado` (mes + filtros, orden desc).

- [ ] **Step 1:** Tests: params no vacíos; `productos` contiene `FULL OUTER JOIN`; `cobertura` usa `@coberturaDesde = '2026-06-01'`; `cobertura` no recibe filtro de SKU/categoría.
- [ ] **Step 2-5:** FAIL → implementar → PASS → commit.

### Task 7: Core — secciones productos, cobertura y clientes

**Files:** Modify `functions/core/dashboard-ventas-core.js`; Test `tests/functions/dashboard-ventas-core.test.js`

**Interfaces:**
- Consumes: `runSeccion` (Task 2), `buildProductosQueries` (Task 6).
- Produces: `productos: {categoria, familia, sku, udsVendidas, facturado, udsBackorder}[] | null`; `cobertura: {vendedor, dadosAlta, compraron, pct}[] | null` (`pct = dadosAlta>0 ? round(compraron/dadosAlta×100, 2) : null`, orden vendedor asc); `clientes: {code, nombre, facturado}[] | null`; `secciones.productos|cobertura|clientes`.

- [ ] **Step 1:** Tests: `pct` 36/66 → `54.55`; `dadosAlta 0` → `pct null`; SKU solo con back order aparece con `udsVendidas 0`; falla de `cobertura` no afecta `productos`.
- [ ] **Step 2-5.**

### Task 8: Pantalla — tabla de productos, cobertura, facturación por cliente

**Files:** Modify `src/domains/dashboard-ventas.js`; Test `tests/unit/audit/dashboard-ventas-ui.test.js`

**Interfaces:**
- Consumes: `d.productos`, `d.cobertura`, `d.clientes`; `window.getStockBreakdown(sku)` (wrapper global en `index.html:7414`, el mismo que usa el popup "Stock del SKU").
- Produces: `_stockColumnas(sku) -> { reservadas: number|null, libre: number|null, stock: number|null }` (null si el stock de la app no cargó → "…"); ids `dv-productos`, `dv-cobertura-chart`, `dv-clientes-chart`.

Productos: columnas exactas `CATEGORIA, FAMILIA, SKU, UNIDADES VENDIDAS, FACTURADO, UNIDADES BACKORDER, UNIDADES RESERVADAS, UNIDADES LIBRE PARA LA VENTA, UNIDADES EN STOCK`; reservadas = `reservadasTotal`, libre = `libre`, stock = `fisicoDep11`. Cobertura: barras horizontales, etiqueta `"<compraron> de <dadosAlta> · <pct>%"` con coma decimal. Clientes: Top 20 + "Ver más" reutilizando `_verMasTabla`.

- [ ] **Step 1:** Tests: headers exactos; `_stockColumnas` con breakdown mock `{reservadasTotal:3, libre:2, fisicoDep11:5}` → `{3,2,5}`; sin breakdown → nulls; etiqueta cobertura `"36 de 66 · 54,55%"`.
- [ ] **Step 2-5.**

### Task 9: Release B (igual que Task 5)

---

## Entrega C — campañas, etiquetas de dato, evolución desde jun-26

### Task 10: Campañas activas (query + core)

**Files:** Create `functions/core/dashboard-ventas-queries-campanias.js`; Modify core; Tests `tests/functions/dashboard-ventas-campanias.test.js`

**Interfaces:**
- Produces: `buildCampaniasQuery(f, nowMs) -> BqQuery` con columnas `campaign_id, nombre, start_date (STRING), end_date (STRING), target_type, target_amount, realizado_qty, realizado_ars`; en la respuesta `campanias: {id, nombre, desde, hasta, objetivoTipo, objetivo, uds, ars, pct}[] | null` (`pct` por `target_type`: units → uds/objetivo, money → ars/objetivo; objetivo 0 → null).

SQL: campañas `activa = TRUE` de `v_campanias_progreso`; realizado desde `v_campanias_ventas_detalle` filtrado por `vendedores` (sobre `assigned_vendor`) y `doc_date` entre las fechas de la campaña. Sin filtro vendedor → toda la campaña. Con filtro → campañas donde el vendedor tiene alcance (`scope='all'`, `scope='vendor'` con el vendedor en `scope_values`, `scope='province'` y al menos una venta/cliente del vendedor en esas provincias) — si no tiene venta, igual aparece con 0.

- [ ] **Step 1:** Tests: params no vacíos; vendedor solo ve campañas con su alcance; `pct` units vs money; objetivo 0 → null.
- [ ] **Step 2-5.**

### Task 11: Etiquetas de dato + evolución desde jun-26 + pantalla de campañas

**Files:** Modify `functions/core/dashboard-ventas-queries.js` (`desde` de series), `functions/core/dashboard-ventas-core.js` (`meses`), `src/domains/dashboard-ventas.js`; Tests en los archivos existentes.

**Interfaces:**
- Produces: `SERIE_DESDE = '2026-06'`; `monthsBetween(desde: string, hasta: string) -> string[]` (inclusive; si `hasta < desde`, devuelve `[hasta]`); plugin Chart.js `dvDataLabels` registrado al cargar Chart.js, que dibuja `fmt(valor)` al final de cada barra en todos los `type:'bar'`.

- [ ] **Step 1:** Tests: `monthsBetween('2026-06','2026-10')` → 5 meses; `monthsBetween('2026-06','2026-03')` → `['2026-03']`; `serieVentas` con mes `2026-10` tiene 5 puntos y arranca en `2026-06`; `desde` de la query = `'2026-06-01'`; el UI registra `dvDataLabels` y lo usa en `_barChart`; sección campañas con id `dv-campanias` muestra "Sin campañas activas" si la lista está vacía.
- [ ] **Step 2-5.**

### Task 12: Release C (igual que Task 5)
