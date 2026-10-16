# Buyer-Cliente (perfil de compra automático) — Diseño v1

**Fecha**: 2026-10-16
**Autor**: Mariano Shimano + Claude Code
**Rama destino**: `dev-v1350`
**Versión app destino**: v1350
**Estado**: Diseño aprobado, en implementación.

---

## 1. Objetivo

Cuando un vendedor abre la Ficha Cliente de cualquier cliente, poder ver en una **tab "Buyer"** las métricas automáticas de ese cliente: qué SKUs compra más, con qué frecuencia, monto promedio por factura, días desde última compra, mix por categoría, última visita, y pedidos en vuelo.

### Problema que resuelve

Hoy la Ficha Cliente es solo un **formulario de clasificación manual** (fidelidad, tamaño, especialización, tipo cliente). No tiene nada de **analytics observable** del cliente.

Un vendedor que va a contactar/visitar a un cliente necesita saber:
- ¿Qué le gusta comprar?
- ¿Cuándo compró por última vez? ¿Hace cuánto que no?
- ¿Cuál es su ticket promedio?
- ¿Dónde está?
- ¿Tiene algún pedido abierto?

Sin este contexto, el vendedor va "a ciegas" o pierde tiempo buscando en Power BI / SAP.

---

## 2. Alcance v1

### Incluido

- Nueva tab **"Buyer"** dentro del modal `#ficha-cliente-modal` (al lado de `Clasificación` que es el formulario actual).
- Modal se ensancha a `min(900px, 95vw)` cuando se activa Buyer, vuelve a 460px en Clasificación.
- Visible para **todos los roles autenticados** (consistente con precedentes del repo).
- Período: **12m default** + toggle `3m / 6m / 12m / 24m`.
- Métricas:
  - **KPIs**: monto total período · facturas · monto promedio por factura · frecuencia (días promedio entre facturas, facturas/mes) · última compra (fecha + hace cuántos días) · días desde última compra · última visita (fecha + vendedor + tipo) · provincia/localidad/dirección.
  - **Top 25 SKUs** (por qty + monto, tabla).
  - **Mix por categoría** (CAÑAS/REELS/LÍNEAS/FG/COMBO con barras CSS y %).
  - **Indicador live**: pedidos en vuelo últimos 30d (Firestore, no snapshot).
- Pre-cómputo nocturno (03:00 ART) → Firestore `client_buyer_stats/{cardCode}`.
- Scope del pre-cómputo: **todos los clientes** con card_code en SAP (~2400).

### Excluido (v2)

- Trend mensual (gráfico monto por mes).
- % share del vendedor asignado (cuánto pesa este cliente en el VDE).
- Estacionalidad (meses de más compra).
- Marcas competidoras.
- Export a Excel/PDF.
- Drill-down al detalle de una factura.
- Botón "Refrescar buyer de este cliente" (trigger manual del CF).
- Reglas por rol (hoy todos ven todo).
- Buyer accesible desde otros modales (hoy solo desde Ficha Cliente).

---

## 3. Arquitectura

Tres piezas:

```
┌───────────────────────────────────────────────────────────┐
│  P1: Cloud Function scheduled                             │
│  functions/index.js :: recomputeClientBuyerStats          │
│                                                            │
│  Cron: 03:00 ART diario                                   │
│  Lee BQ v_ventas_lineas últimos 24m                       │
│  Agrega por card_code en 4 ventanas (3/6/12/24m)          │
│  Escribe Firestore client_buyer_stats/{cardCode}          │
└───────────────┬───────────────────────────────────────────┘
                │
                ▼ (lectura)
┌───────────────────────────────────────────────────────────┐
│  P2: Collection Firestore client_buyer_stats/{cardCode}   │
│  { stats_3m, stats_6m, stats_12m, stats_24m,              │
│    computedAt, cardName, provincia, localidad, direccion }│
└───────────────┬───────────────────────────────────────────┘
                │
                ▼ (lectura)
┌───────────────────────────────────────────────────────────┐
│  P3: UI tab "Buyer" en #ficha-cliente-modal               │
│  + Query live Firestore visitas (última visita)           │
│  + Query live Firestore pedidos+waitlist (en vuelo)       │
│  → render KPIs + Top 25 + mix categoría + indicador live  │
└───────────────────────────────────────────────────────────┘
```

---

## 4. Pieza 1 — Cloud Function

### Archivo
`functions/index.js` → nueva export `recomputeClientBuyerStats`

### Flujo

1. Conectar a BQ (`google-cloud/bigquery` ya instalado en functions/package.json).
2. Correr query (ver §4.2) sobre `v_ventas_lineas` filtrado por `fecha_contable >= 24 meses atrás`.
3. Agrupar en memoria por `card_code` + por ventana (3m/6m/12m/24m).
4. Para cada card_code calcular:
   - `monto_total`
   - `facturas_count` (DISTINCT doc_entry WHERE doc_kind = 'INVOICE')
   - `monto_promedio` = monto_total / facturas_count
   - `primera_compra`, `ultima_compra` (MIN/MAX fecha_contable)
   - `frecuencia_dias` = (ultima - primera) / facturas_count (si facturas ≥ 2)
   - `facturas_por_mes` = facturas / (meses_ventana activos)
   - `dias_desde_ultima` = TODAY - ultima_compra
   - `top_skus`: top 25 agrupados por item_code con sum(qty) + sum(importe) + categoria
   - `top_categorias`: agrupados por categoria con sum(importe) + % share
5. Enriquecer con `provincia/localidad/direccion` desde `client_master/{cardCode}`.
6. Escribir batch a Firestore `client_buyer_stats/{cardCode}`.
7. Log duración + conteos + Sentry errores.

### 4.2 Query BQ principal

```sql
SELECT
  card_code,
  card_name,
  item_code,
  descripcion_linea,
  cantidad,
  importe_linea_ars,
  doc_entry,
  doc_kind,
  DATE(fecha_contable) AS fecha,
  categoria       -- del catalogo (CAÑAS/REELS/LINEAS/FG/COMBO)
FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
WHERE fecha_contable >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 24 MONTH)
  AND card_code IS NOT NULL
  AND card_code != ''
ORDER BY card_code, fecha DESC
```

Carga esperada: ~50k-200k rows por 24m. Procesable en memoria del Cloud Function (`memory: '1GiB'`).

### 4.3 Schema `client_buyer_stats/{cardCode}`

```json
{
  "cardCode": "C00001",
  "cardName": "GUSTAVO EMILIO DESIATA",
  "provincia": "BUENOS AIRES",
  "localidad": "CIUDADELA",
  "direccion": "Av. Siempre Viva 123",
  "computedAt": "2026-10-17T06:00:00Z",
  "stats_3m": { ...windowStats },
  "stats_6m": { ...windowStats },
  "stats_12m": { ...windowStats },
  "stats_24m": { ...windowStats }
}
```

`windowStats`:
```json
{
  "montoTotal": 4850000,
  "facturasCount": 24,
  "montoPromedio": 202083,
  "primeraCompra": "2025-10-20",
  "ultimaCompra": "2026-10-09",
  "frecuenciaDias": 15.2,
  "facturasPorMes": 2.0,
  "diasDesdeUltima": 7,
  "topSkus": [
    { "sku": "CLC70H2PY", "nombre": "Clarus Casting...", "qty": 45, "monto": 1530000, "pctMonto": 31.5, "categoria": "CAÑAS" },
    ...
  ],
  "topCategorias": [
    { "categoria": "CAÑAS", "monto": 2667500, "pctMonto": 55 },
    { "categoria": "REELS", "monto": 1358000, "pctMonto": 28 },
    ...
  ]
}
```

### 4.4 Scheduling

```js
export const recomputeClientBuyerStats = onSchedule(
  {
    region: REGION,
    schedule: '0 3 * * *',          // 03:00 ART diario
    timeZone: 'America/Argentina/Buenos_Aires',
    retryCount: 1,
    memory: '1GiB',
    timeoutSeconds: 540,            // 9 min hard limit
  },
  async () => { /* ... */ }
);
```

### 4.5 Gate de verificación

- CF completa en <5 min.
- ≥95% de cards con `stats_12m` no vacíos (algunos cards son dormidos y es OK que tengan `stats_12m.facturasCount === 0`).
- `_meta/buyer_stats_last_run` con `durationMs`, `cardsProcesados`, `rowsBQ`, `error?`.

---

## 5. Pieza 2 — Rules + indexes

```js
// firestore.rules
match /client_buyer_stats/{cardCode} {
  allow read: if request.auth != null;
  allow write: if false;  // solo CF via admin SDK (bypass rules)
}

match /client_buyer_stats/_meta_ {
  allow read: if isAdminOrGerente();
  allow write: if false;
}
```

Indexes: Firestore ya tiene `pedidos.clientCardCode` indexado (precedente del Planner). `revision_waitlist.clientCardCode` lo mismo. Para `visitas` filtradas por tienda, puede faltar indice compuesto → se agrega si en runtime pide con error.

---

## 6. Pieza 3 — UI

### 6.1 Tabs en Ficha Cliente

Dos buttons tabs arriba del modal body:

```
┌────────────────────────────────────────────────────────────┐
│ FICHA CLIENTE                                              │
│ GUSTAVO EMILIO DESIATA                               [X]   │
│ C00001 · GONZALO                                           │
├────────────────────────────────────────────────────────────┤
│ ┌─[Clasificación]─┐ ┌─ Buyer ─┐                            │
│ └─────────────────┘ └─────────┘                            │
│                                                             │
│  (contenido según tab activa)                              │
└────────────────────────────────────────────────────────────┘
```

- Tab activa: fondo azul `#2563eb`, texto blanco.
- Tab inactiva: borde sutil, texto gris.
- Default: `Clasificación` (preservar comportamiento actual).
- Al activar `Buyer`: `modal-box` se ensancha a `min(900px, 95vw)`.
- Al activar `Clasificación`: `modal-box` vuelve a `max-width: 460px`.

### 6.2 Tab Buyer

Layout vertical, scroll interno:

```
┌─ Período: [3m] [6m] [▮12m▮] [24m] ────────────────────────┐
│                                                             │
│ ┌─ KPIs grid 3x2 ──────────────────────────────────────┐  │
│ │ Monto total       │ Facturas    │ Promedio          │  │
│ │ $4.850.000        │ 24          │ $202.083           │  │
│ ├───────────────────┼─────────────┼───────────────────┤  │
│ │ Frecuencia        │ Última      │ Última visita     │  │
│ │ 1 cada 15 días    │ Hace 7 días │ Hace 3 días       │  │
│ │ (2 por mes)       │ 2026-10-09  │ GONZALO · PRES.   │  │
│ └───────────────────┴─────────────┴───────────────────┘  │
│                                                             │
│ 📍 BUENOS AIRES · CIUDADELA · Av. Siempre Viva 123        │
│                                                             │
│ ⚡ En vuelo: 3 pedidos · $320.000 (últimos 7 días)         │
│                                                             │
│ ┌─ Top 25 SKUs ────────────────────────────────────────┐  │
│ │ #   SKU             Nombre               Qty    Monto│  │
│ │ 1   CLC70H2PY       Clarus Casting...    45     $1.5M│  │
│ │ 2   STLA4000HG      Stella Spinning...   8      $800k│  │
│ │ ...                                                  │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                             │
│ ┌─ Mix por categoría ──────────────────────────────────┐  │
│ │ CAÑAS   ████████████ 55%  $2.67M                     │  │
│ │ REELS   ██████ 28%  $1.36M                           │  │
│ │ LÍNEAS  ███ 12%  $585k                               │  │
│ │ FG      █ 5%  $240k                                  │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                             │
│ Última actualización: hoy 03:00 (actualizado diariamente)  │
└────────────────────────────────────────────────────────────┘
```

### 6.3 Query live (al abrir tab Buyer)

1. **Última visita**: `fbDb.collection('visitas').where('tienda','==', clientName).orderBy('fecha','desc').limit(1)`.
2. **Pedidos en vuelo**: 
   - `fbDb.collection('pedidos').where('clientCardCode','==', cardCode).where('createdAt','>=', ThisDate-30d)` + mismo query en `revision_waitlist`.
   - Agrega monto + conteo.
3. **Stats pre-computado**: `fbDb.collection('client_buyer_stats').doc(cardCode).get()`.

Las 3 queries en paralelo con `Promise.all`.

### 6.4 Estados especiales

- **Loading**: spinner "Cargando buyer…"
- **No existe stats**: cartel "Buyer no computado todavía — se calcula cada noche 03:00 ART. Avisá a admin si no aparece después de 24h."
- **Stats pero windowStats vacío**: "Sin compras en últimos N meses"
- **Error red/rules**: cartel + Sentry

### 6.5 Toggle de período

Botones `[3m] [6m] [12m] [24m]`. Click cambia la ventana leyendo `stats_3m` vs `stats_12m` etc. Zero re-query (todo ya cargado). Default 12m.

---

## 7. Edge cases

| Caso | Comportamiento |
|---|---|
| Cliente sin cardCode SAP (solo app) | Tab Buyer deshabilitada con tooltip "Buyer requiere card_code SAP" |
| Cliente nuevo (sin stats computados aún) | Cartel "Buyer se computa en próxima corrida (03:00 ART)" |
| Cliente dormido (sin compras 24m) | KPIs todos en 0, cartel "Sin compras en últimos N meses" |
| CF falla una noche | Modal muestra `computedAt` de hace >24h con warning amarillo |
| BQ query timeout | CF reintenta 1 vez (`retryCount: 1`); si falla queda sin update esa noche |
| Firestore write batch excede 500 | Chunking de 400 por batch (patrón del repo) |
| Visitas sin link al cliente por nombre exacto | Fallback: ignora última visita, muestra "No encontrada" |

---

## 8. Plan de implementación

| Fase | Trabajo | Tiempo |
|---|---|---|
| F0 | Design doc + rama dev-v1350 | 0.5h |
| F1 | CF recomputeClientBuyerStats + query BQ | 2h |
| F2 | firestore.rules + deploy | 0.5h |
| F3 | UI tabs + render buyer + query live | 2.5h |
| F4 | Query live pedidos en vuelo (helper) | 0.5h |
| F5 | Review paralela + PR + merge | 1h |
| F6 | Post-deploy + first manual compute | 0.5h |

**Total**: ~7h.

### Verificación por fase

- F1: Trigger manual del CF una vez, verificar sample de 3 cardCodes en Firestore.
- F2: `firebase deploy --only firestore:rules` dry-run.
- F3: Build + tsc + biome + abrir modal real.
- F6: Query Firestore `client_buyer_stats` count > 2000.

---

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| BQ query ~500MB scan por noche. Costo mensual Firestore + BQ ~$5 USD extra | Aceptable (ya pagamos $100/mes GCP). Query es predictable |
| 2400 docs x 4 ventanas × 25 top SKUs = ~2MB total colección | Chico comparado a `pedidos` que es ~100MB |
| CF timeout 9min si BQ query es lenta | Query simple sin JOIN pesado, debería ser <3min |
| Vendedores malinterpretan "frecuencia" si cliente tuvo 1 solo pedido | Mostrar "N/A — necesita 2+ compras" cuando facturas < 2 |
| Categoria del catálogo no viene en algunos items | Clasificar como "OTRO" |

---

## 10. v2 fuera de scope

- Dashboard analítico comparativo (buyer de top 10 clientes vs cliente)
- Trend mensual con gráfico de línea (requiere Chart.js)
- Botón "Refrescar buyer" manual
- Export a Excel desde Ficha Cliente
- Alertas "este cliente lleva N días sin comprar" en Panel de Control
- Buyer accesible desde Backorder / Stock Asignado / Planner (otros modales)
- Fuzzy matching de visitas por nombre normalizado para linkear a card_code
