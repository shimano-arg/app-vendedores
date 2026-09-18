# Sección MERCADOLIBRE en app-vendedores — Design Spec

**Fecha**: 2026-09-18
**Autor**: Mariano Erbino + Claude (brainstorming session)
**Estado**: Aprobado (usuario confirmó el diseño completo)
**Repos involucrados**: `shimano-arg/app-vendedores` (UI + rules) + `botshimanopesca-beep/mercado-intelligence` (workflow de sync). Ver §9 para el plan de deploy en 7 etapas.

---

## 1. Objetivo

Integrar los datos del pipeline `mercado-intelligence` (proyecto GCP `shimano-mi`) al CRM `app-vendedores` como una nueva sección accesible solo para Mariano. La sección expone:

1. **Violaciones MAP del día** — tabla accionable equivalente al email diario `[MAP Alert]`.
2. **Top productos Shimano en MELI** — catálogo con precios, sellers y visitas.
3. **Análisis por categoría** — share Shimano, competidores, precios agregados.

**Fuera de scope (MVP)**:
- Ventas MELI mensual (feed comercial NMV/NSI/ASP). Fase 2.
- Cruce nickname MELI ↔ CardCode SAP. Fase 2.
- Realtime `onSnapshot` listeners. Diaria alcanza.
- Acceso para roles distintos de Mariano.

---

## 2. Audiencia y permisos

Solo Mariano (`erbinomariano@gmail.com` o `mariano.erbino@shimano.com.ar`) puede ver la sección. Gate por `token.email` en Firestore rules + en el frontend (esconder botón de acceso). Precedente en el repo: Panel de Control (v611+, mismo gate).

Los otros roles (admin no-Mariano, gerente, vendedor, interno, viewer) no tienen visibilidad ni acceso. Rules bloquean lecturas explícitamente aunque conozcan el nombre de las colecciones.

---

## 3. Arquitectura

Sync unidireccional diario `mercado-intelligence` → `app-vendedores`. La app siempre lee de su propio Firestore, nunca cross-project desde el browser.

```
┌─────────────────────────────────────────────────────────────────────┐
│ REPO botshimanopesca-beep/mercado-intelligence  (GCP shimano-mi)   │
│                                                                     │
│  ├── weekly-run.yml    (jueves 15:00 ARG · escribe Firestore MI)   │
│  ├── map-daily.yml     (diario  9:00 ARG · BQ query + email)       │
│  └── sync-to-app.yml   (NUEVO   diario  9:20 ARG · escribe AV)     │
│                                                                     │
│                    ↓ Service Account "mi-sync-writer"               │
│                    ↓ rol Cloud Datastore User en AV                 │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ REPO shimano-arg/app-vendedores  (GCP app-vendedores-shimano)       │
│                                                                     │
│  Firestore collections nuevas:                                      │
│    meli/state                singleton (last_sync, snapshot_date)   │
│    meli_products             ~231 docs (mirror market_products)     │
│    meli_categories           ~11 docs (mirror market_categories)    │
│    meli_map_alerts           4-60 docs por snapshot (from BQ)       │
│                                                                     │
│  UI:                                                                │
│    Panel de Control (existente, modal Mariano-only)                │
│      → botón "🛒 Mercado Libre"                                     │
│      → openMeliModal()                                              │
│    Modal MERCADOLIBRE (nuevo, chunk lazy)                          │
│      → 3 sub-tabs: MAP · Productos · Categorías                     │
│      → firestore().get() one-shot (no onSnapshot)                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Trade-off**: sync diario, no realtime. Si a futuro querés realtime, migrás a `onSnapshot` sin cambiar el modelo de datos. Costo actual: ~250 docs duplicados en Firestore de AV (insignificante vs free tier).

---

## 4. Modelo de datos

### 4.1 · `meli/state` (doc singleton, id fijo `state`)

```json
{
  "last_sync": Timestamp,
  "snapshot_date": "2026-09-17",
  "counts": {
    "products": 231,
    "categories": 11,
    "map_alerts": 4
  },
  "sync_run_id": "35392561156",
  "sync_status": "ok"
}
```

Campos:
- `last_sync` (Timestamp): cuándo corrió `sync-to-app.yml` por última vez.
- `snapshot_date` (string YYYY-MM-DD): fecha del snapshot BigQuery que se propagó.
- `counts` (object): número de docs escritos en cada colección para verificación rápida.
- `sync_run_id` (string): ID del run de GitHub Actions (permite armar link a Actions).
- `sync_status` (string): `"ok"` | `"partial"` | `"failed"`.

### 4.2 · `meli_products/{catalog_product_id}` (~231 docs)

Mirror directo del schema `market_products` del pipeline MI. Sin transformación:

```json
{
  "catalog_product_id": "MLA69077257",
  "name": "Reel Miravel C5000XG",
  "brand": "Shimano",
  "is_shimano": true,
  "model": "MIRAVEL C5000XG",
  "category_id": "MLA1979",
  "category_name": "Reeles",
  "domain_id": "MLA-FISHING_REELS",
  "price_min": 240000,
  "price_avg": 254000,
  "price_max": 274000,
  "currency_id": "ARS",
  "n_listings": 8,
  "n_sellers_competing": 8,
  "visits_7d_sum": 208,
  "top_sellers": [
    { "seller_id": 82746273, "nickname": "PESCAPLAY", "state": "AR-C", "price": 240000 }
  ],
  "snapshot_date": "2026-09-17",
  "updated_at": Timestamp
}
```

### 4.3 · `meli_categories/{category_id}` (~11 docs)

Mirror directo de `market_categories`:

```json
{
  "category_id": "MLA4283",
  "category_name": "Reeles",
  "n_listings": 346,
  "n_products": 103,
  "n_shimano": 342,
  "pct_shimano": 98.8,
  "n_sellers": 75,
  "price_min": 28000,
  "price_avg": 284892,
  "price_max": 3729629,
  "snapshot_date": "2026-09-17",
  "updated_at": Timestamp
}
```

### 4.4 · `meli_map_alerts/{item_id}` (4-60 docs por snapshot)

Salida de `mi.map_monitor.detect_violations()` serializada. Cada corrida diaria **borra la colección entera y la reescribe** (patrón snapshot: history vive en BQ, no en la app).

```json
{
  "item_id": "MLA2856524534",
  "sku": "MIRC5000XG",
  "product_name": "Reel Frontal Miravel Mirc5000xg",
  "seller_id": 82746273,
  "seller_nickname": "PESCAPLAY",
  "seller_state": "AR-C",
  "precio_publicado": 240000,
  "precio_sugerido": 254000,
  "diferencia_pct": -5.5,
  "ml_url": "https://articulo.mercadolibre.com.ar/MLA-2856524534-_JM",
  "snapshot_date": "2026-09-17",
  "detected_at": Timestamp
}
```

### 4.5 · Índices Firestore

Ninguno. Todas las queries son `.get()` de la colección entera (máx ~250 docs). Sort/filter client-side en JS.

### 4.6 · Estimación de tamaño y cost

| Colección | Docs | Bytes/doc | Total |
|---|---|---|---|
| meli/state | 1 | 300 B | 300 B |
| meli_products | 231 | ~1.5 KB | ~350 KB |
| meli_categories | 11 | 400 B | 4 KB |
| meli_map_alerts | 4-60 | 500 B | 2-30 KB |
| **Storage total** | | | **~380 KB** |
| **Reads/día** | | | ~250 (una vez al abrir modal) |
| **Writes/día** | | | ~250 (sync diario) |

Dentro del free tier de Firebase por varios órdenes de magnitud.

---

## 5. Security Rules

Extensión de `firestore.rules` con helper `isMariano()` y bloqueo total de escritura desde client. El sync GHA usa Service Account (Admin SDK, bypasea rules).

```
// Sección MERCADOLIBRE — solo Mariano lee, nadie escribe desde client.
function isMariano() {
  return request.auth != null
    && request.auth.token.email in [
      'erbinomariano@gmail.com',
      'mariano.erbino@shimano.com.ar'
    ];
}

match /meli/{docId} {
  allow read: if isMariano();
  allow write: if false;
}
match /meli_products/{productId} {
  allow read: if isMariano();
  allow write: if false;
}
match /meli_categories/{categoryId} {
  allow read: if isMariano();
  allow write: if false;
}
match /meli_map_alerts/{alertId} {
  allow read: if isMariano();
  allow write: if false;
}
```

Notas:
- `isMariano()` chequea `token.email` directo (no requiere `get()`, más rápido).
- `allow write: if false` cierra escritura desde browser. SA del GHA bypasea rules.
- Tests nuevos en `tests/rules/meli.test.js` cubren regresión.

---

## 6. Componentes UI

### 6.1 · Entry point — Panel de Control extendido

Diff en `src/domains/panel-control.js`: agregar botón "🛒 Mercado Libre" en el render del modal existente. Solo visible si `isMariano()`. Al click llama `openMeliModal()` (declarada en `meli.js`).

### 6.2 · Chunk lazy `src/domains/meli.js` (~400-500 LOC estimadas)

Sin listeners `onSnapshot` → no requiere entrar al patrón `unsub*`/`detachFirebaseListeners` (regla #17 CLAUDE.md). Sin cross-scope vars.

API pública (window.*):
- `openMeliModal()` — abre modal + carga data si no cacheada.
- `closeMeliModal()` — cierra modal, mantiene cache en memoria.
- `setMeliSubtab(name)` — switch entre `'map'` | `'products'` | `'categories'`.

API interna:
- `loadMeliData()` — `firestore().get()` de las 4 colecciones en paralelo, cachea en memoria durante la sesión. Bypass cache si click en botón `⟳`.
- `renderMeliModal(body)` — arma HTML del skeleton (header + sub-tabs).
- `renderMapSection(data)` — KPIs + tabla de violaciones ordenada por Δ% asc.
- `renderProductsSection(data)` — KPIs + tabla con filtro categoría + search + sort.
- `renderCategoriesSection(data)` — tabla comparativa con barra % Shimano.
- `formatSnapshotAge(date)` — "hoy 09:20" / "hace 3 días".
- `getSeverityColor(pct)` — rojo si ≤-10%, ámbar si -10% < x ≤ -2%, gris si > -2%.

Registro del chunk (regla #18 CLAUDE.md):
- `build.js` → `LAZY_CHUNKS = { ..., meli: ['openMeliModal', 'closeMeliModal', 'setMeliSubtab'] }`
- `src/main.js` → `installChunkStubs('meli', ['openMeliModal', 'closeMeliModal', 'setMeliSubtab'])`
- `sw.js` → agregar `'./chunks/meli.js'` a `STATIC_ASSETS` + bumpear `CACHE_VERSION`

### 6.3 · Modal HTML en `index.html`

```html
<div class="modal-overlay" id="meli-modal" onclick="if(event.target===this)closeMeliModal()" style="z-index:1200">
  <div class="modal-content" style="max-width:1100px;max-height:90vh">
    <div class="modal-header" id="meli-modal-header"><!-- populated by JS --></div>
    <div class="meli-subtabs" id="meli-subtabs"><!-- populated by JS --></div>
    <div id="meli-modal-body" style="flex:1;overflow:auto"><!-- populated by JS --></div>
  </div>
</div>
```

CSS scoped bajo `#meli-modal`. Paleta MELI: amarillo `#FFE600` para sub-tab activa y acentos, azul `#2d3277` opcional. Resto usa variables CSS del theme existente (`var(--bg-elevated)`, etc.) para respetar dark mode.

### 6.4 · Sub-tab MAP (default al abrir)

- 3 KPI cards: `N violaciones` (color según severidad), `Descuento promedio %`, `N sellers involucrados`.
- Tabla: Seller · SKU · Producto · Publicado · Sugerido · Δ% · Link. Ordenada por Δ% asc.
- Filtro: input search por nickname.
- Colores por fila: rojo si Δ ≤ -10%, ámbar si -10% < Δ ≤ -2%, gris si Δ > -2%.

### 6.5 · Sub-tab Productos

- 3 KPI cards: `Total productos Shimano`, `Precio promedio`, `Visitas 7d totales`.
- Tabla: Producto · Categoría · Precio min/avg/max · N° sellers · Visitas 7d · Top seller.
- Filtros: dropdown categoría + input search sobre nombre.
- Sort default: `visits_7d_sum` descendente. Click en headers para re-ordenar.

### 6.6 · Sub-tab Categorías

- Tabla: Categoría · N° listings · N° productos · % Shimano · Precio min/avg/max · N° sellers.
- Sin filtros (11 filas). Barra de progreso visual en `pct_shimano` (verde >80%, ámbar 50-80%, rojo <50%).

### 6.7 · Freshness handling en el header

Al abrir el modal, `loadMeliData()` lee `meli/state` primero:

| `snapshot_date` vs hoy | `sync_status` | UX |
|---|---|---|
| ≤ 1 día | `ok` | Header verde: "sincronizado hoy 09:20" |
| 2-7 días | `ok` | Header ámbar: "última sync hace 3 días" |
| > 7 días | `ok` | Banner rojo: "⚠️ Data > 7 días. Revisar GHA sync-to-app.yml" + link a Actions |
| — | `failed` | Banner rojo con mensaje de error + link al run del GHA |
| — | ausente | Estado vacío: "No hay data todavía. El primer sync corre mañana 9:20 ARG" |

---

## 7. Sync pipeline (`sync-to-app.yml`)

### 7.1 · Setup GCP

Service Account nueva en el proyecto `app-vendedores-shimano`:
- Email: `mi-sync-writer@app-vendedores-shimano.iam.gserviceaccount.com`
- Rol: `Cloud Datastore User` (permite read/write Firestore, nada más).
- Key JSON descargada → GH Secret `APP_VENDEDORES_SA_KEY` en `botshimanopesca-beep/mercado-intelligence`.

### 7.2 · Workflow `.github/workflows/sync-to-app.yml`

- **Cron**: `20 12 * * *` (12:20 UTC = 9:20 ARG, 20 min después del `map-daily.yml`).
- **Concurrency**: `group: sync-to-app, cancel-in-progress: false`.
- **Trigger manual**: `workflow_dispatch` habilitado para runs on-demand.
- **Pasos**:
  1. Checkout + Setup Python 3.11.
  2. `pip install -e ".[gcp]"`.
  3. Materializar `.secrets/gcp_sa_key.json` + `.secrets/app_vendedores_sa.json` desde GH Secrets.
  4. Ejecutar `python scripts/sync_to_app.py`.
  5. Reportar counts al `$GITHUB_STEP_SUMMARY`.

### 7.3 · Script `scripts/sync_to_app.py`

Lógica secuencial:

1. Instanciar client Firestore MI (project=`shimano-mi`, database=`mi-pipeline-bq-meli-shimano-new`, credentials=SA MI).
2. Instanciar client Firestore AV (project=`app-vendedores-shimano`, database default, credentials=SA AV).
3. Instanciar client BigQuery (project=`shimano-mi`, credentials=SA MI).
4. Leer snapshot MI:
   - `products = list(MI.collection('market_products').stream())`
   - `categories = list(MI.collection('market_categories').stream())`
5. Detectar MAP alerts (reusar módulo del proyecto MI):
   - `from mi.map_monitor import detect_violations, load_precios_sugeridos`
   - `from mi.sku_matcher import load_sku_catalog`
   - `violations = detect_violations(bq_client, precios, catalog, tolerance_pct=0.0)`
6. Batch write a AV:
   - Borrar `meli_map_alerts` entera + reescribirla.
   - Upsert `meli_products` (chunks de 500 por commit).
   - Upsert `meli_categories`.
   - Escribir `meli/state` con `last_sync=SERVER_TIMESTAMP`, `snapshot_date=<hoy>`, `counts={...}`, `sync_status='ok'`, `sync_run_id=$GITHUB_RUN_ID`.
7. Manejo de errores:
   - `try/except Exception` global → escribe `meli/state` con `sync_status='failed'` + `sync_error=str(e)[:500]` + `last_attempt=SERVER_TIMESTAMP` → re-raise para que el step falle y GitHub alerte al owner.
8. Flag `--dry-run` opcional: imprime counts sin escribir en AV.

---

## 8. Testing

### 8.1 · Unit tests nuevos en app-vendedores (Vitest)

Archivo `tests/unit/meli-dom.test.js`:
- `formatSnapshotAge(date)` → strings esperados según edad.
- `sortMapAlerts([...])` → orden por `diferencia_pct` asc.
- `filterProducts(list, {category, search})` → filtro combinado.
- `getSeverityColor(pct)` → rojo/ámbar/gris según threshold.

### 8.2 · Smoke test extendido

En `tests/smoke/bundle-runtime.test.js`: assertion que `import('./chunks/meli.js')` en `runInNewContext` no tira `ReferenceError` (sin IIFE al top-level dependiente de globals inline, regla #15).

### 8.3 · Rules test nuevo

Archivo `tests/rules/meli.test.js`:
- Vendor autenticado NO lee `meli_products` → permission-denied.
- Admin no-Mariano NO lee `meli_products` → permission-denied.
- Mariano lee `meli_products` → OK.
- Ningún user escribe (ni Mariano) → permission-denied.

### 8.4 · Sync script en mercado-intelligence

Sin tests unitarios (glue code + I/O real). Verificación:
- `python scripts/sync_to_app.py --dry-run` imprime counts esperados.
- Módulos que consume (`mi.map_monitor`, `mi.sku_matcher`) ya tienen 94 tests.
- Quality gates del repo MI (ruff + format + mypy + pytest) verdes antes de commit.

### 8.5 · Verificación end-to-end en dev local (previo E5)

1. Correr `python -m http.server 8000` en root de APP VENDEDORES.
2. Login como `erbinomariano@gmail.com` en `http://localhost:8000`.
3. Abrir Panel de Control → botón "🛒 Mercado Libre" visible.
4. Click → modal abre con las 3 sub-tabs.
5. Sub-tab MAP muestra las 4 filas con la data real del último sync.
6. Filtro por seller filtra correctamente.
7. Link "🔗" abre publicación MELI real.
8. Sub-tab Productos: dropdown categoría filtra + sort por visitas descendente por default.
9. Sub-tab Categorías: barra % Shimano se renderiza correctamente.
10. Login como cuenta no-Mariano → botón NO aparece.
11. Attempt manual `firebase.firestore().collection('meli_products').get()` desde consola browser con cuenta no-Mariano → `permission-denied`.

---

## 9. Plan de deploy (7 etapas)

| # | Etapa | Repo | Deliverable | Gate |
|---|---|---|---|---|
| **E0** | Setup GCP | Config manual GCP | SA `mi-sync-writer` en AV con rol Datastore User + GH Secret `APP_VENDEDORES_SA_KEY` cargado | `gcloud iam service-accounts describe` responde 200 |
| **E1** | Script sync + dry-run | MI · rama `feat/sync-to-app` | `scripts/sync_to_app.py` con `--dry-run` funcional | Dry-run imprime `[DRY] products=231 categories=11 alerts=4` |
| **E2** | Rules meli_* + tests | AV · rama `dev` | `firestore.rules` extendido + `tests/rules/meli.test.js` verde | `npm test tests/rules/meli.test.js` verde |
| **E3** | Deploy rules + sync productivo | Ambos | Merge PR rules a `main` AV + `firebase deploy --only firestore:rules`. Merge PR sync a `main` MI + primer trigger manual | Firestore Console → 4 colecciones nuevas pobladas |
| **E4** | Chunk meli.js + tests unit | AV · rama `dev` | `src/domains/meli.js` + `tests/unit/meli-dom.test.js` verde + smoke test verde + registro `build.js`/`main.js`/`sw.js` | `npm test` full suite verde |
| **E5** | Modal en index.html + botón Panel de Control | AV · rama `dev` | HTML del modal + `panel-control.js` extendido con botón + `openMeliModal()` conectado. Bump `APP_VERSION` + `CACHE_VERSION`. README §50 nueva | Verificación end-to-end de §8.5 pasa |
| **E6** | Cron activo + monitoreo | MI | Descomentar `schedule` en `sync-to-app.yml` (E1-E3 corrieron manual) | 2 corridas automáticas consecutivas OK. `meli/state.last_sync` avanza |

**Duración estimada**: E0-E3 en 1 sesión (~2 hs), E4-E5 en otra sesión (~3 hs), E6 es 5 min post-merge.

---

## 10. Rollback

Cada etapa es independiente:

- **E1-E2**: revertir el PR en la rama, no afecta prod.
- **E3 rules**: revertir commit rules + `firebase deploy --only firestore:rules`. Datos escritos quedan inaccesibles hasta re-deploy.
- **E3 sync**: comentar `schedule` del workflow → siguen las corridas manuales para debug.
- **E4-E5**: revertir squash commit en `main` AV + re-deploy GitHub Pages. Bumpear `CACHE_VERSION` para invalidar SW.
- **E6**: comentar `schedule` del workflow. Corridas manuales siguen funcionando.

Sin backup necesario: source of truth vive en Firestore MI + BQ, todo re-generable.

---

## 11. Success criteria (feature done)

- [ ] Los 5 tests nuevos (4 unit + 1 rules) pasan en CI.
- [ ] Smoke test de bundle verde.
- [ ] 2 corridas consecutivas del cron `sync-to-app.yml` OK, con `meli/state.sync_status='ok'`.
- [ ] Al abrir el modal con cuenta Mariano se ven las 4 sub-secciones cargadas.
- [ ] Cuenta no-Mariano: botón invisible + rules bloquean lecturas.
- [ ] README de APP VENDEDORES actualizado con §50 "MERCADOLIBRE (Mariano-only)".
- [ ] README de mercado-intelligence actualizado con `sync-to-app.yml`.
- [ ] `APP_VERSION` + `CACHE_VERSION` bumpeadas.

---

## 12. Roadmap post-MVP (fuera del scope de esta spec)

Ordenados por valor esperado. Cada uno requiere su propia spec + plan.

1. **Ventas MELI mensual** (sub-tab nueva). Data ya está en `market_sales` (14 períodos). Agregar tab con gráfico de tendencia NMV/NSI/ASP + top 10 sellers + mapa de calor por provincia.
2. **Mapping nickname MELI ↔ CardCode SAP** (colección `meli_sap_mapping` editada por Mariano en la UI). Habilita botón "Ver cliente en Master Clientes" desde una violación MAP.
3. **Alertas proactivas** vía Cloud Function que trigger cuando nueva violación MAP aparece en `meli_map_alerts` (push notif al mobile).
4. **Sub-tab Vendedores** con ranking de sellers Shimano por NMV, sus provincias, y comparativa mes contra mes.
5. **Multi-marca sniper** en el pipeline MI upstream (Daiwa/Okuma/Penn) → propaga automáticamente a esta sección sin cambios en app-vendedores.
