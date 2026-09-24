# Plan Power BI — Sincronización real-time desde la app

Fecha de armado: 2026-06-29
Owner: Mariano Erbino (mariano.erbino@shimano.com.ar)
Arranque: 2026-06-30
Estado: en ejecución — pausa esperando upgrade a Blaze (~12:00 cuando llegue Diego).

---

## v1056 (2026-09-24) — Enriquecimiento vista Clientes (F1-F4)

Pedido Mariano: sumar a la vista Clientes de la app + PowerBI los campos que
el vendedor ya carga en cada visita (Tipo de cliente, Fidelidad, Especialización
por tipo de pesca, Canal de compra, Tipo de venta) + email + Crédito cheque
(ARS), con regla "última visita gana".

Fases:
- **F1 (frontend, v1056)** ✅ shipped — input Crédito cheque en modal cliente
  individual (admin/gerente). Complementa la columna del Master Clientes UI
  (v1055). Mismo campo `client_master.creditoCheque`.
- **F2 (CF, v1056)** ✅ shipped — `onVisitCreatedDenormToClientMaster` copia
  attrs de cada visita nueva a `client_master.{docId}.lastVisit` con LWW por
  `visit.fecha`. Deploy pendiente aprobación: `firebase deploy --only
  functions:onVisitCreatedDenormToClientMaster`.
- **F3 (backfill, v1056)** ✅ shipped — `scripts/backfill_visits_to_client_master.py`
  para poblar `lastVisit` con visitas históricas. Run:
  1. `gcloud auth application-default login`
  2. `python scripts/backfill_visits_to_client_master.py` (dry-run)
  3. `python scripts/backfill_visits_to_client_master.py --apply`
- **F4 (BQ, v1056)** ✅ shipped SQL — ver Apéndice A.2 (extendida con email,
  telefono, credito, sap_health, geo, lead_estado), A.2b (nueva
  `client_master_view` con `lastVisit.*` aplanado), A.2c (nueva
  `clientes_360_view` — join key normalizado espeja `clientLocId`).

**Pasos manuales pendientes para cerrar F4** (Firebase Console — no automatizable
con CLI):
1. Extensions → "Stream Firestore to BigQuery" → install nueva instancia:
   - Collection path: `client_master`
   - Dataset ID: `shimano_app`
   - Table ID: `client_master_raw`
   - Location: `us-central1`
2. Correr backfill de la extension: `npx --package=@firebaseextensions/fs-bq-import-collection fs-bq-import-collection`
3. Ejecutar los 3 CREATE OR REPLACE VIEW del Apéndice A.2 / A.2b / A.2c en BQ.
4. En Power BI Desktop: agregar `clientes_360_view` como nuevo dataset, retirar
   el modelo viejo de `client_applications_view` (queda como fuente de dato pero
   los reports leen la 360).

---

## CHECKLIST DE EJECUCIÓN (live status)

### ✅ Hecho hoy
- [x] Verificar Project ID Firebase → `app-vendedores-shimano` (núm 746111030735)
- [x] Login a Google Cloud Console con `erbinomariano@gmail.com` (owner del proyecto)
- [x] Habilitar BigQuery API en GCP
- [x] Crear dataset `shimano_app` en us-central1 (Iowa)

### ⏳ Bloqueado — esperando OK Diego (~12:00)
- [ ] **Diego confirma cargo de Blaze a tarjeta corporativa**
- [ ] **Upgrade Firebase Spark → Blaze**
  - Link: https://console.firebase.google.com/project/app-vendedores-shimano/usage/details
  - Click "Modificar plan" → Blaze → vincular tarjeta de Diego
  - Setear budget alert en **USD 25/mes** (paso obligatorio antes de confirmar)

### ⬜ Después de Blaze (Día 1, cuando esté activo)
Estimación: 2.5 horas hasta cierre del Día 1.

#### Paso 4.3 — Instalar 6 extensiones Stream Firestore to BigQuery (~30 min)
Por cada colección, en Firebase Console → Extensions → "Stream Firestore to BigQuery":
- [ ] `pedidos` → tabla `pedidos_raw`
- [ ] `visits` → tabla `visits_raw`
- [ ] `client_applications` → tabla `client_applications_raw`
- [ ] `campaigns` → tabla `campaigns_raw`
- [ ] `targets` → tabla `targets_raw`
- [ ] `roles` → tabla `roles_raw`

Config común para todas:
- Dataset ID: `shimano_app`
- Location: `us-central1`
- Backup collection: vacío
- Excluded fields: vacío

#### Paso 4.4 — Verificar que llega data (~10 min)
- [ ] En la app: hacer un cambio chico en cualquier colección (ej. modificar una visita de prueba).
- [ ] En BigQuery: confirmar que aparece la row en `*_raw_changelog`.
- [ ] Si no llega: revisar logs de Cloud Function de la extension.

#### Paso 4.5 — Backfill histórico (~30 min)
Solo trae lo que se escribe DESDE que se instala la extension. Para histórico:
- [ ] Backfill `pedidos` (sin confirmados todavía → costo cero)
- [ ] Backfill `visits` (visitas de prueba acumuladas)
- [ ] Backfill `client_applications` (altas SAP cargadas hasta hoy)
- [ ] Backfill `campaigns` (campañas creadas)
- [ ] Backfill `targets` (targets cargados)
- [ ] Backfill `roles` (todos los users registrados)

Comando: `npx --package=@firebaseextensions/fs-bq-import-collection fs-bq-import-collection`

#### Paso 4.6 — Crear 6 vistas SQL planas (~1 hora)
Pegar desde el Apéndice A de este plan. En orden:
- [ ] `pedidos_view` + `pedido_lines_view`
- [ ] `visits_view`
- [ ] `client_applications_view`
- [ ] `campaigns_view`
- [ ] `targets_view`
- [ ] `roles_view`

#### Paso 4.7 — Smoke test SQL (~15 min)
- [ ] Query: contar pedidos confirmados → matchea Dashboard de la app
- [ ] Query: facturación mes actual → matchea Dashboard
- [ ] Query: top 5 SKUs por unidades → matchea

#### Paso 8 — Billing alert (al cierre del Día 1, ~5 min)
- [ ] GCP Console → Billing → Budgets & alerts → Create budget
- [ ] Monto: USD 25/mes
- [ ] Alertas: 50%, 90%, 100% (a `mariano.erbino@shimano.com.ar`)

### 📋 Tasks offline mientras esperás a Diego
Cosas productivas que NO requieren Blaze:
- [ ] **Confirmar emails Pablo + Ioannis** para Power BI workspace.
  - Pablo: ¿`pablo.<apellido>@shimano.uy`? necesito el email exacto
  - Ioannis: ¿`ioannis.<apellido>@shimano.uy`? idem
- [ ] **Releer el plan** (este documento) sección por sección para que llegues familiarizado al Día 2-3.
- [ ] **Confirmar password de `erbinomariano@gmail.com`** está a mano. Lo vamos a usar para instalar las extensions cuando arranquemos.
- [ ] **Verificar que tenés Node.js instalado** (para el backfill paso 4.5). En PowerShell: `node --version`. Si no está, instalar de https://nodejs.org/

### ⬜ Día 2 (mañana 01/07) — Power BI Desktop
- [ ] Crear Service Account `powerbi-reader` en GCP IAM
- [ ] Descargar JSON key del Service Account (guardar en password manager, NO commitear)
- [ ] Conectar Power BI Desktop a BigQuery via Service Account
- [ ] Cargar las 6 vistas como modelos
- [ ] Modelar relaciones entre tablas
- [ ] Crear medidas DAX base (Pedidos Confirmados, Facturado ARS, Conv v→p, etc.)
- [ ] Armar página 1: Resumen ejecutivo
- [ ] Armar página 2: Pedidos & Facturación

### ⬜ Día 3 (jueves 02/07) — Tableros + publish
- [ ] Armar página 3: Visitas & Conversión
- [ ] Armar página 4: Campañas activas
- [ ] Publish a Power BI Service
- [ ] Crear workspace "Shimano Vendedores"
- [ ] Asignar viewers (Diego, Santi, Pablo, Ioannis)
- [ ] Configurar refresh automático c/30 min
- [ ] Test refresh end-to-end

### ⬜ Día 4 (viernes 03/07) — Demo + ajustes
- [ ] Demo a Diego + Pablo
- [ ] Capturar feedback y armar lista de ajustes
- [ ] Implementar ajustes top priority
- [ ] Documentar uso del tablero (cómo filtrar, qué significa cada KPI)

---

---

## 1. Objetivo y alcance

Construir un tablero de Power BI alimentado por la app Shimano Vendedores con
**latencia cuasi-real-time** (5–30 segundos) para que gerencia (Diego, Pablo, vos)
vea la performance comercial sin esperar exports manuales.

**Alcance fase 1 (lo que se entrega):**
- Pipeline Firestore → BigQuery vía Firebase Extension oficial.
- 6 colecciones sincronizadas: `pedidos`, `visits`, `client_applications`,
  `campaigns`, `targets`, `roles`.
- Vistas SQL en BigQuery que aplanan el JSON crudo para Power BI.
- Tablero Power BI con 4 páginas: Resumen ejecutivo, Pedidos & Facturación,
  Visitas & Conversión, Campañas activas.
- Publicación en Power BI Service con refresh DirectQuery (live) o cada 30 min.

**Fuera de alcance fase 1 (para más adelante):**
- Rendiciones (ya las tenés en SharePoint).
- Stock y Precios (snapshots, no transaccionales).
- Audit log (`operations_log`) — privacy review pendiente.
- Backups de fotos (almacenamiento Storage, no Firestore).

---

## 2. Arquitectura

```
┌──────────────────────┐
│  App Shimano (PWA)   │  Usuarios escriben pedidos / visitas / etc.
│  (index.html)        │
└──────────┬───────────┘
           │ writes
           ▼
┌──────────────────────┐
│  Firestore           │  Source of truth de la app.
│  /pedidos /visits ...│
└──────────┬───────────┘
           │ onWrite trigger (extension)
           ▼
┌──────────────────────┐
│  Firebase Extension  │  "Stream Firestore to BigQuery"
│  "stream-firestore-  │  Una instancia por colección. Lag típico: 5-30s.
│   bigquery"          │
└──────────┬───────────┘
           │ insert/update
           ▼
┌──────────────────────┐
│  BigQuery dataset    │  Tablas raw:
│  shimano_app         │   pedidos_raw_changelog (cada cambio)
│                      │   pedidos_raw_latest (vista del estado actual)
│                      │  + vistas SQL planas: pedidos_view, visits_view, etc.
└──────────┬───────────┘
           │ connector nativo
           ▼
┌──────────────────────┐
│  Power BI Desktop    │  Modelo de datos + visuals + DAX.
│                      │
└──────────┬───────────┘
           │ publish
           ▼
┌──────────────────────┐
│  Power BI Service    │  Dashboards online compartidos con el equipo.
│  (powerbi.com)       │  DirectQuery o refresh c/30 min.
└──────────────────────┘
```

---

## 3. Pre-requisitos (TENER LISTO ANTES DE MAÑANA)

| # | Item | Cómo se consigue | Estado |
|---|------|------------------|--------|
| 1 | Plan Blaze de Firebase activo | Ya lo activamos para Storage | ✅ |
| 2 | Acceso owner al proyecto Firebase | Login con tu cuenta Google | ✅ |
| 3 | Cuenta Google Cloud Console (mismo proyecto que Firebase) | Auto-creada con Firebase | ✅ |
| 4 | Power BI Desktop instalado | https://aka.ms/pbidesktop (free) | ✅ instalado |
| 5 | Licencia Power BI Pro | Para publicar y compartir online | ✅ confirmada |
| 6 | Cuenta de servicio Google Cloud (Service Account) para Power BI | La creamos juntos en el paso 5.1 | ❌ Día 2 |
| 7 | Habilitar BigQuery API en GCP | Auto-habilita la extension | ❌ Día 1, paso 4.1 |
| 8 | Confirmar billing alert: límite 20 USD/mes para BigQuery + extension | GCP Console → Billing → Budgets | ❌ Día 1, al final |

**Decisiones tomadas (lock-in 2026-06-29):**
- ✅ **Usuario titular Power BI**: `mariano.erbino@shimano.com.ar` (corporativo).
  Toda licencia Pro, workspace y Service Account se asocian a este email.
- ✅ **Refresh mode**: Import + refresh automático cada 30 min. Migrar a
  DirectQuery solo si Diego pide vista 100% live.
- ⚠️ **Audiencia del tablero (pendiente de confirmar mañana)**: Diego,
  Pablo, Santi, Ioannis con rol viewer. Confirmar emails exactos antes del
  paso 7.2.

---

## 4. Fase 1 — Setup base (DÍA 1: 2026-06-30, ~4 horas)

### 4.1. Habilitar BigQuery API (5 min)
1. Ir a [console.cloud.google.com](https://console.cloud.google.com).
2. Seleccionar el proyecto Firebase (el mismo que usás para Firestore).
3. Menú → APIs & Services → Library → buscar "BigQuery API" → Enable.

### 4.2. Crear dataset BigQuery vacío (5 min)
1. GCP Console → BigQuery → en el árbol izquierdo, click el proyecto.
2. Botón "Create dataset":
   - Dataset ID: `shimano_app`
   - Region: **us-central1** (mismo region que Firestore — minimiza latencia y costo de transferencia).
   - Default table expiration: vacío (queremos histórico completo).
3. Click Create.

### 4.3. Instalar la extension por cada colección (~30 min total)
La extension oficial: **Stream Firestore to BigQuery**
(`firebase/firestore-bigquery-export`).

Repetir el siguiente proceso 6 veces, una por colección:

1. Firebase Console → Extensions → Browse → buscar "Stream Firestore to BigQuery".
2. Click Install.
3. Cuando pida config:
   - **Collection path**: el nombre de la colección (`pedidos`, `visits`, etc.).
   - **Dataset ID**: `shimano_app`.
   - **Table ID**: `<colección>_raw` (ej. `pedidos_raw`).
   - **BigQuery project**: dejar default (mismo que Firebase).
   - **BigQuery dataset location**: us-central1 (debe matchear el del dataset).
   - **Backup collection**: dejar vacío.
   - **Excluded fields**: vacío (queremos todo). Excepción: en `roles` excluir nada sensible (no hay password en doc).
   - **Transform function URL**: vacío.
   - **Wildcard IDs**: No.
4. Click Install Extension. Toma 3-5 min en deployar (genera una Cloud Function por colección).

**Lista a configurar (por orden de prioridad):**

| Colección | Razón | Comentario |
|-----------|-------|------------|
| `pedidos` | Core — facturación, conversión, performance | Volumen alto, hereda la mayoría de queries |
| `visits` | Actividad campo | Joinear con pedidos para conversión v→p |
| `client_applications` | Altas SAP, tracking de habilitación | Estado del padrón comercial |
| `campaigns` | Targets de productos por scope | Para ver % cumplimiento por campaña |
| `targets` | Targets ARS mensuales por vendor | Para % de cumplimiento del vendor |
| `roles` | Mapeo uid → vendor → role | Dimensión: joinear pedidos por ownerUid |

### 4.4. Verificar que llega data (~10 min)
1. En la app, hacé un cambio chico: confirmar un pedido de prueba o
   modificar una visita.
2. BigQuery Console → buscar `shimano_app.pedidos_raw_changelog` → Preview.
3. Tiene que aparecer una row con `operation = CREATE` o `UPDATE` y el campo
   `data` con el JSON del doc.

Si no aparece después de 1 minuto:
- Firebase Console → Functions → ver logs de `ext-firestore-bigquery-export-pedidos-fsexportbigquery`.
- Causa típica: la API BigQuery no está habilitada en GCP. Volver al paso 4.1.

### 4.5. Backfill del histórico (~30 min)
La extension solo trae cambios DESDE que se instala. Para traer todo lo
viejo (pedidos previos al arranque, visits de prueba, altas SAP cargadas
antes del go-live) hay que correr backfill.

**Estado actual confirmado por Mariano**: no hay pedidos confirmados todavía
(la app está arrancando). El backfill va a ser cuasi-cero costo en
`pedidos` y va a traer el grueso de altas (`client_applications`) +
visitas de prueba acumuladas.

1. Firebase Console → Extensions → tu extension de `pedidos` → "How this
   extension works" → seguir link al script `fs-bq-import-collection`.
2. Instalar node.js si no lo tenés (probablemente ya).
3. En PowerShell:
```powershell
npx --package=@firebaseextensions/fs-bq-import-collection fs-bq-import-collection
```
4. Te va a preguntar:
   - Project ID
   - Source collection path: `pedidos`
   - Dataset ID: `shimano_app`
   - Table ID prefix: `pedidos_raw`
5. Repetir para las otras 5 colecciones.

**Costo aproximado del backfill:** USD 0.10–0.50 según volumen.

### 4.6. Crear vistas SQL planas (~1 hora)
Las tablas `*_raw_changelog` traen el JSON del doc en una columna `data`
serializada como STRING. Para Power BI conviene crear vistas con cada
campo extraído. Ejemplo para pedidos:

```sql
-- En BigQuery Console, abrir editor de queries
CREATE OR REPLACE VIEW `shimano_app.pedidos_view` AS
WITH latest AS (
  SELECT
    document_id,
    document_name,
    timestamp,
    operation,
    data,
    ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY timestamp DESC) AS rn
  FROM `shimano_app.pedidos_raw_changelog`
  WHERE operation != 'DELETE'
)
SELECT
  document_id AS pedido_id,
  JSON_VALUE(data, '$.ownerUid') AS owner_uid,
  JSON_VALUE(data, '$.ownerEmail') AS owner_email,
  JSON_VALUE(data, '$.stage') AS stage,
  JSON_VALUE(data, '$.tipo') AS tipo,
  JSON_VALUE(data, '$.province') AS province,
  JSON_VALUE(data, '$.locName') AS localidad,
  JSON_VALUE(data, '$.clientName') AS cliente,
  JSON_VALUE(data, '$.month') AS mes,
  CAST(JSON_VALUE(data, '$.year') AS INT64) AS anio,
  TIMESTAMP(JSON_VALUE(data, '$.confirmedAt')) AS confirmed_at,
  TIMESTAMP(JSON_VALUE(data, '$.finalizedAt')) AS finalized_at,
  CAST(JSON_VALUE(data, '$.subtotalArs') AS NUMERIC) AS subtotal_ars,
  CAST(JSON_VALUE(data, '$.netAmountArs') AS NUMERIC) AS net_amount_ars,
  CAST(JSON_VALUE(data, '$.discountPct') AS NUMERIC) AS discount_pct,
  -- transferido a SAP?
  JSON_VALUE(data, '$.transferidoSAP.batchId') AS sap_batch_id,
  TIMESTAMP(JSON_VALUE(data, '$.transferidoSAP.transferredAt')) AS sap_transferred_at,
  -- líneas del pedido (array → JSON)
  data
FROM latest
WHERE rn = 1;
```

Vistas equivalentes para `visits_view`, `client_applications_view`,
`campaigns_view`, `targets_view`, `roles_view`. Las dejo armadas en el
Apéndice A al final del documento.

**Vista de líneas (un row por línea de pedido):**
```sql
CREATE OR REPLACE VIEW `shimano_app.pedido_lines_view` AS
SELECT
  pedido_id,
  owner_email,
  cliente,
  province,
  confirmed_at,
  stage,
  JSON_VALUE(line, '$.code') AS sku,
  JSON_VALUE(line, '$.desc') AS sku_desc,
  JSON_VALUE(line, '$.fam') AS familia,
  JSON_VALUE(line, '$.sub') AS subfamilia,
  JSON_VALUE(line, '$.cat') AS categoria,
  CAST(JSON_VALUE(line, '$.qty') AS NUMERIC) AS unidades,
  CAST(JSON_VALUE(line, '$.precio') AS NUMERIC) AS precio_unitario,
  CAST(JSON_VALUE(line, '$.qty') AS NUMERIC) *
    CAST(JSON_VALUE(line, '$.precio') AS NUMERIC) AS importe_linea
FROM `shimano_app.pedidos_view`,
  UNNEST(JSON_EXTRACT_ARRAY(data, '$.lines')) AS line;
```

### 4.7. Smoke test SQL en BigQuery (~15 min)
Antes de tocar Power BI, validar que los datos cierran con la app:

```sql
-- Cuántos pedidos confirmados hay en total
SELECT COUNT(*) FROM `shimano_app.pedidos_view` WHERE stage = 'confirmed';

-- Facturación junio 2026
SELECT SUM(net_amount_ars) FROM `shimano_app.pedidos_view`
WHERE stage = 'confirmed' AND DATE(confirmed_at) BETWEEN '2026-06-01' AND '2026-06-30';

-- Top 5 SKUs por unidades
SELECT sku, sku_desc, SUM(unidades) AS u
FROM `shimano_app.pedido_lines_view`
WHERE stage = 'confirmed'
GROUP BY sku, sku_desc
ORDER BY u DESC
LIMIT 5;
```

Comparar contra el Dashboard de la app. Tienen que matchear (off-by-one
horario UTC es esperable, ajustar con `DATE(confirmed_at, 'America/Argentina/Buenos_Aires')`).

---

## 5. Fase 2 — Power BI Desktop modelo (DÍA 2, ~3 horas)

### 5.1. Crear Service Account en GCP para Power BI (~15 min)
Power BI conecta como una identidad. No queremos que use tu Google personal.

1. GCP Console → IAM & Admin → Service Accounts → Create Service Account.
   - Name: `powerbi-reader`
   - Description: "Read-only access para Power BI desktop + service"
2. Roles:
   - BigQuery Data Viewer
   - BigQuery Job User
3. Create Key → JSON → descargar y guardar (NO commitear, NO compartir).

### 5.2. Conectar Power BI Desktop (~30 min)
1. Open Power BI Desktop → Get Data → Google BigQuery.
2. Sign in con la cuenta del Service Account (importás el JSON).
3. Seleccionar el proyecto Shimano.
4. Seleccionar dataset `shimano_app`.
5. Marcar las 6 vistas (NO las raw tables — solo `*_view` y `pedido_lines_view`).
6. Load (no Transform — el modelo limpio ya viene de las vistas SQL).

### 5.3. Modelar relaciones (~30 min)
En la pestaña "Model view":
- `pedidos_view.owner_uid` → `roles_view.uid` (many-to-one)
- `pedido_lines_view.pedido_id` → `pedidos_view.pedido_id` (many-to-one)
- `visits_view.owner_uid` → `roles_view.uid` (many-to-one)
- `campaigns_view`: relación lógica por scope (no FK directa, dejarla independiente y usar measures DAX).

Crear tabla calendario:
```dax
Calendar = CALENDAR(DATE(2025,1,1), DATE(2027,12,31))
```
Marcar como tabla de fechas. Relacionar con `pedidos_view.confirmed_at` y `visits_view.fecha`.

### 5.4. Medidas DAX base (~1 hora)
```dax
Pedidos Confirmados = CALCULATE(COUNTROWS(pedidos_view), pedidos_view[stage] = "confirmed")

Facturado ARS = CALCULATE(SUM(pedidos_view[net_amount_ars]), pedidos_view[stage] = "confirmed")

Visitas Realizadas = COUNTROWS(visits_view)

Conversion V to P = DIVIDE([Pedidos Confirmados], [Visitas Realizadas], 0)

Target Mensual ARS = SUM(targets_view[target_ars])

Cumplimiento % = DIVIDE([Facturado ARS], [Target Mensual ARS], 0)

Pedidos Pendientes = CALCULATE(COUNTROWS(pedidos_view), pedidos_view[stage] = "pending")
```

---

## 6. Fase 3 — Páginas del tablero (DÍA 2-3, ~4 horas)

### Página 1 — Resumen ejecutivo
- KPI cards: Facturado mes / Target mes / Cumplimiento % / Conversión v→p
- Sparkline facturación últimos 6 meses
- Top 5 vendedores por facturado
- Top 5 SKUs por unidades
- Mapa de Argentina con provincia coloreada por facturado (BigQuery tiene
  campo `province` ya — Power BI lo mapea nativo).

### Página 2 — Pedidos & Facturación
- Tabla: pedido_id / vendedor / cliente / provincia / fecha / importe / estado
  + filtros (vendedor, provincia, estado, rango fecha).
- Gráfico líneas: facturación diaria últimos 90 días.
- Barras: pedidos por estado (pending / confirmed / finalized).
- Donut: facturación por categoría.

### Página 3 — Visitas & Conversión
- Tabla visitas con observaciones (campo `comentario` del doc).
- Heatmap: visitas por vendedor × semana.
- Funnel: visitas → pedidos pending → confirmed.
- Lista de "visitas sin pedido en 7 días" (alimenta las acciones de Seguimiento).

### Página 4 — Campañas activas
- Una row por campaña: target / realizado / % cumplimiento / días restantes.
- Drill: SKUs involucrados + pedidos contabilizados.
- Comparativa entre campañas activas (mismo formato que el modal de
  campañas en la app, pero con drill).

---

## 7. Fase 4 — Publicación y permisos (DÍA 3, ~1 hora)

### 7.1. Publish a Power BI Service
1. En Power BI Desktop → File → Publish → New Workspace "Shimano Vendedores".
2. Asignar storage mode: Import + refresh c/30 min (más simple para arrancar).
3. Configurar gateway si querés DirectQuery (más complejo, se hace después).

### 7.2. Permisos del workspace
| Usuario | Email | Rol |
|---------|-------|-----|
| Mariano Erbino | mariano.erbino@shimano.com.ar | Admin |
| Diego Valsi | diego.valsi@shimano.uy | Viewer |
| Santiago Beron | santiago.beron@shimano.uy | Viewer |
| Pablo (gerente) | _pendiente de confirmar_ | Member |
| Ioannis (VDI) | _pendiente de confirmar_ | Viewer |

### 7.3. Refresh automático
- Service → Dataset → Schedule refresh → cada 30 minutos.
- Credenciales: el Service Account del paso 5.1.
- Configurar email alert si el refresh falla (a tu mail).

### 7.4. Row-level security (opcional)
Si se quiere que cada vendedor vea solo su data:
- DAX role: `[owner_email] = USERPRINCIPALNAME()`.
- En Power BI Service → Manage roles → asignar usuarios al rol "Vendedor".

---

## 8. Costos estimados

### Mensuales (en USD)
| Item | Costo estimado | Notas |
|------|----------------|-------|
| Firebase Blaze (Cloud Functions de la extension) | 1.00 – 3.00 | 6 funciones × ~1000 invocaciones/día |
| BigQuery storage | 0.10 – 0.50 | <1 GB en fase 1 |
| BigQuery queries (Power BI refresh) | 0.50 – 2.00 | Refresh c/30 min × 24 hs × 6 vistas |
| Power BI Pro × 1 usuario | 14.00 | Necesario para publicar y compartir |
| Power BI Pro × 4 usuarios viewers | 56.00 | Diego, Pablo, Santi, Ioannis |
| **Total mensual** | **~71 – 75 USD** | |

### Setup one-shot
| Item | Costo |
|------|-------|
| Backfill BigQuery | 0.10 – 0.50 |
| Tu tiempo (2.5 días) | — |

### Mitigación de costo
- Si los viewers no editan, podés usar Power BI **Embedded** y bajar a ~30 USD/mes total para 5 usuarios.
- Si el refresh c/30 min es excesivo, bajar a c/4 hs ahorra ~1 USD/mes.
- Set billing alert en GCP a 20 USD para que te avise si algo se desboca.

---

## 9. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Schema de docs cambia (ej. agregamos un campo a pedidos) | Power BI no lo ve hasta refresh | Las vistas SQL se actualizan en 5 min, rebuildeas el modelo en Desktop |
| Extension queda colgada (typical 1 vez al mes) | Pierde datos | Cloud Function alert + backfill manual con `fs-bq-import-collection` |
| Costo BigQuery se dispara | Sobrecosto inesperado | Billing alert a 20 USD/mes. Reducir frecuencia de refresh si pasa |
| Power BI Service cae | Tablero offline temporal | SLA Microsoft 99.9%. Backup: PDF export semanal |
| Service Account key expuesta | Acceso no autorizado a BigQuery | Guardar key en password manager. Rotar cada 6 meses |
| GDPR / privacidad de emails de vendedores | Compliance | Excluir campo `ownerEmail` en la extension config si Legal lo pide |

---

## 10. Mantenimiento ongoing

- **Semanal**: revisar logs de la extension (Firebase Console → Functions).
- **Mensual**: validar el cuadre del cuadro de Facturación contra el Dashboard de la app.
- **Trimestral**: rotar Service Account key.
- **Cada release de la app que agregue colección nueva**: instalar otra instancia de la extension.

---

## 11. Cronograma sugerido

| Día | Tareas | Duración |
|-----|--------|----------|
| **Día 1** (mar 30/06) | Fase 1: BigQuery setup + extension × 6 + backfill + vistas SQL + smoke test | 4 hs |
| **Día 2** (mié 01/07) | Fase 2: Power BI Desktop + modelo + medidas DAX. Fase 3: 2 primeras páginas | 4 hs |
| **Día 3** (jue 02/07) | Fase 3: 2 páginas restantes. Fase 4: publish + permisos + refresh | 3 hs |
| **Día 4** (vie 03/07) | Demo a Diego + Pablo. Ajustes. Documentación de uso | 2 hs |

**Total**: ~13 horas reales (2.5 días laborales).

---

## 12. Definitions of Done

- [ ] Las 6 colecciones tienen su tabla `*_raw_changelog` en BigQuery.
- [ ] Las 6 vistas SQL devuelven datos cuando se corren manualmente.
- [ ] Smoke test SQL (sección 4.7) matchea el Dashboard de la app ±5%.
- [ ] Power BI Desktop abre el .pbix y muestra las 4 páginas sin error.
- [ ] Publish a Power BI Service exitoso.
- [ ] Diego accede al workspace desde su email y ve datos.
- [ ] Refresh automático configurado y un primer ciclo verificado.
- [ ] Billing alert configurado a 20 USD/mes en GCP.
- [ ] Plan documentado en este archivo y commiteado al repo.

---

## Apéndice A — Vistas SQL completas

(Quedan acá para que las pegues directo en BigQuery Console.)

### A.1. visits_view
```sql
CREATE OR REPLACE VIEW `shimano_app.visits_view` AS
WITH latest AS (
  SELECT document_id, timestamp, operation, data,
    ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY timestamp DESC) AS rn
  FROM `shimano_app.visits_raw_changelog`
  WHERE operation != 'DELETE'
)
SELECT
  document_id AS visit_id,
  JSON_VALUE(data, '$.ownerUid') AS owner_uid,
  JSON_VALUE(data, '$.ownerEmail') AS owner_email,
  JSON_VALUE(data, '$.vendor') AS vendor,
  JSON_VALUE(data, '$.tienda') AS cliente,
  JSON_VALUE(data, '$.provincia') AS province,
  JSON_VALUE(data, '$.localidad') AS localidad,
  DATE(JSON_VALUE(data, '$.fecha')) AS fecha,
  JSON_VALUE(data, '$.mes') AS mes,
  CAST(JSON_VALUE(data, '$.anio') AS INT64) AS anio,
  JSON_VALUE(data, '$.comentario') AS comentario,
  JSON_VALUE(data, '$.observaciones') AS observaciones,
  JSON_VALUE(data, '$.proximaAccion') AS proxima_accion,
  JSON_VALUE(data, '$.tipoContacto') AS tipo_contacto
FROM latest WHERE rn = 1;
```

### A.2. client_applications_view
```sql
CREATE OR REPLACE VIEW `shimano_app.client_applications_view` AS
WITH latest AS (
  SELECT document_id, timestamp, operation, data,
    ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY timestamp DESC) AS rn
  FROM `shimano_app.client_applications_raw_raw_changelog`
  WHERE operation != 'DELETE'
)
SELECT
  document_id AS application_id,
  JSON_VALUE(data, '$.status') AS status,
  JSON_VALUE(data, '$.cardCodeSap') AS card_code_sap,
  JSON_VALUE(data, '$.titular') AS titular,
  JSON_VALUE(data, '$.comercio') AS comercio,
  JSON_VALUE(data, '$.fantasia') AS fantasia,
  JSON_VALUE(data, '$.cuit') AS cuit,
  JSON_VALUE(data, '$.calle') AS calle,
  JSON_VALUE(data, '$.localidad') AS localidad,
  JSON_VALUE(data, '$.localidadFinal') AS localidad_final,
  JSON_VALUE(data, '$.provincia') AS provincia,
  JSON_VALUE(data, '$.codigoPostal') AS codigo_postal,
  -- v1056: contactabilidad (existen en Firestore desde sync SAP hace tiempo,
  -- solo faltaba proyectarlos a BQ).
  JSON_VALUE(data, '$.email') AS email,
  JSON_VALUE(data, '$.telefonoContacto') AS telefono_contacto,
  JSON_VALUE(data, '$.assignedVendor') AS assigned_vendor,
  JSON_VALUE(data, '$.coverageBy') AS coverage_by,
  JSON_VALUE(data, '$.precaucion') = 'true' AS precaucion,
  JSON_VALUE(data, '$.precaucionReason') AS precaucion_reason,
  -- v1056: campo financiero para PowerBI (admin/gerente carga en client_master
  -- Y en client_applications desde v1055 Master Clientes UI).
  CAST(JSON_VALUE(data, '$.creditoCheque') AS NUMERIC) AS credito_cheque_ars,
  -- v1056: metadata SAP health + funnel LEAD.
  JSON_VALUE(data, '$.sapCardType') AS sap_card_type,
  JSON_VALUE(data, '$.sapValid') AS sap_valid,
  JSON_VALUE(data, '$.sapFrozen') AS sap_frozen,
  JSON_VALUE(data, '$.sapReadyForSL') = 'true' AS sap_ready_for_sl,
  JSON_VALUE(data, '$.source') AS source,
  JSON_VALUE(data, '$.leadEstado') AS lead_estado,
  JSON_VALUE(data, '$.manualSapPending') = 'true' AS manual_sap_pending,
  CAST(JSON_VALUE(data, '$.lat') AS FLOAT64) AS lat,
  CAST(JSON_VALUE(data, '$.lng') AS FLOAT64) AS lng,
  JSON_VALUE(data, '$.geoProvider') AS geo_provider,
  JSON_VALUE(data, '$.geoPrecision') AS geo_precision,
  TIMESTAMP(JSON_VALUE(data, '$.createdAt')) AS created_at,
  TIMESTAMP(JSON_VALUE(data, '$.updatedAt')) AS updated_at,
  JSON_VALUE(data, '$.updatedBy') AS updated_by
FROM latest WHERE rn = 1;
```

### A.2b. client_master_view (v1056, requiere extension Stream to BQ nueva)
Prerequisito: instalar la extension **`firestore-bigquery-export`** apuntando
a la coleccion `client_master` → tabla `client_master_raw` en dataset
`shimano_app`. Config: dataset `shimano_app`, location `us-central1`, backup
collection vacio, excluded fields vacio. Ver Paso 4.3 del checklist original.

```sql
CREATE OR REPLACE VIEW `shimano_app.client_master_view` AS
WITH latest AS (
  SELECT document_id, timestamp, operation, data,
    ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY timestamp DESC) AS rn
  FROM `shimano_app.client_master_raw_raw_changelog`
  WHERE operation != 'DELETE'
)
SELECT
  document_id AS doc_id,
  JSON_VALUE(data, '$.provincia') AS provincia,
  JSON_VALUE(data, '$.localidad') AS localidad,
  JSON_VALUE(data, '$.clientName') AS client_name,
  JSON_VALUE(data, '$.vendor') AS vendor,
  JSON_VALUE(data, '$.address') AS address,
  JSON_VALUE(data, '$.addressExplicit') = 'true' AS address_explicit,
  JSON_VALUE(data, '$.sapCity') AS sap_city,
  JSON_VALUE(data, '$.sapZip') AS sap_zip,
  -- Categorizacion comercial editada por admin
  JSON_VALUE(data, '$.cliTipo') AS cli_tipo,
  CAST(JSON_VALUE(data, '$.creditoCheque') AS NUMERIC) AS credito_cheque_ars,
  -- v1056: subobjeto lastVisit poblado por CF onVisitCreatedDenormToClientMaster.
  -- "Ultima gana" — la visita mas reciente por fecha sobreescribe.
  JSON_VALUE(data, '$.lastVisit.fidelidad') AS last_visit_fidelidad,
  JSON_QUERY_ARRAY(data, '$.lastVisit.tamanos') AS last_visit_tamanos,
  JSON_QUERY_ARRAY(data, '$.lastVisit.especializaciones') AS last_visit_especializaciones,
  JSON_VALUE(data, '$.lastVisit.canalCompra') AS last_visit_canal_compra,
  JSON_VALUE(data, '$.lastVisit.tipoVenta') AS last_visit_tipo_venta,
  CAST(JSON_VALUE(data, '$.lastVisit.ponderacionMostrado') AS NUMERIC) AS last_visit_pond_mostrado,
  CAST(JSON_VALUE(data, '$.lastVisit.ponderacionEcommerce') AS NUMERIC) AS last_visit_pond_ecommerce,
  DATE(JSON_VALUE(data, '$.lastVisit.fecha')) AS last_visit_fecha,
  JSON_VALUE(data, '$.lastVisit.byDisplayName') AS last_visit_by,
  JSON_VALUE(data, '$.lastVisit.visitId') AS last_visit_id,
  -- Default delivery persistido (v785)
  JSON_VALUE(data, '$.defaultDelivery.tipo') AS default_delivery_tipo,
  TIMESTAMP(JSON_VALUE(data, '$.updatedAt')) AS updated_at,
  JSON_VALUE(data, '$.updatedBy') AS updated_by
FROM latest WHERE rn = 1;
```

### A.2c. clientes_360_view (v1056, join master enriquecido)
Vista principal para PowerBI. Une `client_applications_view` (padron SAP) con
`client_master_view` (overrides + lastVisit denormalizado) por `provincia +
localidad + comercio`. Es el reemplazo natural de leer las 2 vistas separadas
y joinearlas en el modelo Power BI.

```sql
CREATE OR REPLACE VIEW `shimano_app.clientes_360_view` AS
WITH
  ca AS (
    SELECT
      *,
      -- Espeja clientLocId de src/domains/visitas.js:43 en SQL para poder
      -- joinear contra client_master.doc_id (que usa esta misma key).
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          LOWER(NORMALIZE_AND_CASEFOLD(COALESCE(provincia, ''), NFD)),
          r'[^a-z0-9]+', '_'
        ), r'^_|_$', ''
      ) || '__' ||
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          LOWER(NORMALIZE_AND_CASEFOLD(COALESCE(localidad, ''), NFD)),
          r'[^a-z0-9]+', '_'
        ), r'^_|_$', ''
      ) || '__' ||
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          LOWER(NORMALIZE_AND_CASEFOLD(COALESCE(comercio, ''), NFD)),
          r'[^a-z0-9]+', '_'
        ), r'^_|_$', ''
      ) AS join_key
    FROM `shimano_app.client_applications_view`
  )
SELECT
  ca.application_id,
  ca.card_code_sap,
  ca.status,
  ca.titular,
  ca.comercio,
  ca.fantasia,
  ca.cuit,
  ca.email,
  ca.telefono_contacto,
  ca.calle,
  ca.localidad,
  ca.provincia,
  ca.codigo_postal,
  ca.assigned_vendor,
  ca.coverage_by,
  ca.precaucion,
  ca.precaucion_reason,
  -- credito_cheque_ars puede venir de client_applications (altas SAP editadas
  -- desde Master Clientes UI) o de client_master (POINTS). Coalesce prioriza
  -- el mas reciente actualizado por admin.
  COALESCE(ca.credito_cheque_ars, cm.credito_cheque_ars) AS credito_cheque_ars,
  cm.cli_tipo,
  cm.vendor AS master_vendor,
  cm.default_delivery_tipo,
  -- Ultima visita (denormalizada por CF F2)
  cm.last_visit_fidelidad,
  cm.last_visit_tamanos,
  cm.last_visit_especializaciones,
  cm.last_visit_canal_compra,
  cm.last_visit_tipo_venta,
  cm.last_visit_pond_mostrado,
  cm.last_visit_pond_ecommerce,
  cm.last_visit_fecha,
  cm.last_visit_by,
  ca.sap_card_type,
  ca.sap_valid,
  ca.sap_frozen,
  ca.sap_ready_for_sl,
  ca.source,
  ca.lead_estado,
  ca.manual_sap_pending,
  ca.lat,
  ca.lng,
  ca.geo_provider,
  ca.geo_precision,
  ca.created_at,
  ca.updated_at
FROM ca
LEFT JOIN `shimano_app.client_master_view` cm
  ON ca.join_key = cm.doc_id;
```

### A.3. campaigns_view
```sql
CREATE OR REPLACE VIEW `shimano_app.campaigns_view` AS
WITH latest AS (
  SELECT document_id, timestamp, operation, data,
    ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY timestamp DESC) AS rn
  FROM `shimano_app.campaigns_raw_changelog`
  WHERE operation != 'DELETE'
)
SELECT
  document_id AS campaign_id,
  JSON_VALUE(data, '$.name') AS name,
  JSON_VALUE(data, '$.scope') AS scope,
  DATE(JSON_VALUE(data, '$.startDate')) AS start_date,
  DATE(JSON_VALUE(data, '$.endDate')) AS end_date,
  JSON_VALUE(data, '$.targetType') AS target_type,
  CAST(JSON_VALUE(data, '$.targetAmount') AS NUMERIC) AS target_amount,
  JSON_VALUE(data, '$.archivedManually') = 'true' AS archived_manually,
  JSON_EXTRACT(data, '$.skus') AS skus_json,
  JSON_EXTRACT(data, '$.scopeValues') AS scope_values_json
FROM latest WHERE rn = 1;
```

### A.4. targets_view
```sql
CREATE OR REPLACE VIEW `shimano_app.targets_view` AS
WITH latest AS (
  SELECT document_id, timestamp, operation, data,
    ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY timestamp DESC) AS rn
  FROM `shimano_app.targets_raw_changelog`
  WHERE operation != 'DELETE'
)
SELECT
  document_id AS target_id,
  JSON_VALUE(data, '$.vendor') AS vendor,
  CAST(JSON_VALUE(data, '$.year') AS INT64) AS anio,
  CAST(JSON_VALUE(data, '$.monthIdx') AS INT64) AS mes_idx,
  CAST(JSON_VALUE(data, '$.targetArs') AS NUMERIC) AS target_ars
FROM latest WHERE rn = 1;
```

### A.5. roles_view
```sql
CREATE OR REPLACE VIEW `shimano_app.roles_view` AS
WITH latest AS (
  SELECT document_id, timestamp, operation, data,
    ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY timestamp DESC) AS rn
  FROM `shimano_app.roles_raw_changelog`
  WHERE operation != 'DELETE'
)
SELECT
  document_id AS uid,
  JSON_VALUE(data, '$.email') AS email,
  JSON_VALUE(data, '$.displayName') AS display_name,
  JSON_VALUE(data, '$.role') AS role,
  JSON_VALUE(data, '$.vendor') AS vendor,
  JSON_VALUE(data, '$.internalPartnerUid') AS internal_partner_uid
FROM latest WHERE rn = 1;
```

---

## Apéndice B — Links de referencia

- Extension repo: https://github.com/firebase/extensions/tree/master/firestore-bigquery-export
- Power BI BigQuery connector docs: https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-connect-bigquery
- BigQuery JSON functions: https://cloud.google.com/bigquery/docs/reference/standard-sql/json_functions
- Firebase Blaze pricing: https://firebase.google.com/pricing
- Power BI Pro vs Premium: https://learn.microsoft.com/en-us/power-bi/admin/service-admin-licensing-organization
