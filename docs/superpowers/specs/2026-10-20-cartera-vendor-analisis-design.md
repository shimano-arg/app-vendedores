# Spec — Análisis de Cartera por Vendedor (v1283)

**Fecha**: 2026-10-20
**Autor**: Mariano + Claude (brainstorming session)
**Status**: Approved, pending implementation plan

## Overview

El modal "Seguimiento" se reemplaza completo por **"Análisis de Cartera por Vendedor"**.

### User story

Un gerente/admin selecciona un vendedor del dropdown y ve en una sola vista:
- KPIs cards: total cartera / base activa 90d / dormidos visita 30d / dormidos compra 90d / nunca visitados / nunca compraron.
- Tabla filtrable con 1 fila por cliente de la cartera del VDE + chips de filtro (mismos 6 recortes).
- Click en fila → abre Ficha Cliente existente.
- Botón "Exportar" baja Excel con lo que el chip filtro muestre.

### Objetivos operativos

- "VDE Gonzalo tiene 180 clientes, 45 llevan >90 días sin comprar → lista para la reunión semanal."
- "20 clientes de la cartera de Federico nunca fueron visitados en 2026 → ¿por qué?"
- "LA LOMITA (deuda $5M, 95 días sin comprar) está dormida con riesgo → acción inmediata."

### Permisos

`canViewCarteraAnalisis()` = admin || gerente || interno (gate idéntico al modal actual `canViewSeguimiento()`). VDE externos NO ven el botón.

### Fuente de verdad

Snapshot BQ → Firestore `cartera_vendor/{vendorKey}` cada noche 04:00 ART. Modal lee 1 doc per selección de vendor. Data con hasta 24h de retraso.

---

## Decisiones clave (12 confirmadas en brainstorming)

| # | Decisión |
|---|---|
| 1 | Reemplaza completo el modal "Seguimiento" |
| 2 | Cartera = `client_master.assignedVendor` Firestore (fuente única) |
| 3 | Visitas: 2 KPIs separados (`interactionType='visita'` presencial vs `'contacto'` rápido) |
| 4 | Compra = factura emitida en SAP (`v_ventas_lineas` tipo INVOICE, neto de NC) |
| 5 | Permisos: admin/gerente/interno (igual que hoy) |
| 6 | Vista única + chips filtro rápido (no tabs) |
| 7 | Umbrales fijos: 30d sin visita / 90d sin compra |
| 8 | Columnas: fechas + cliTipo + geo + facturado 12M + deuda abierta |
| 9 | Click fila → abre Ficha Cliente existente |
| 10 | Export Excel respeta chip filtro + search activos |
| 11 | Snapshot nightly 04:00 ART (CF scheduled, no realtime) |
| 12 | Tirar código viejo + collections `seguimiento_notes`/`seguimiento_status` (backup previo) |

Approach arquitectónico elegido: **A — BQ view + CF scheduled + Firestore doc**. Patrón calco de `syncSapPaymentsToApp`.

---

## Data model

### Collection `cartera_vendor/{vendorKey}`

**ID del doc** = `canonVendor(assignedVendor)` normalizado (aplica alias legacy `MARTIN BOIERO → PACHI`).

**Schema**:

```json
{
  "vendorKey": "GONZALO DE LA ROSA",
  "vendorNameDisplay": "GONZALO DE LA ROSA",
  "snapshotAt": "2026-10-21T07:00:12.000Z",
  "snapshotDate": "2026-10-21",
  "counts": {
    "total": 180,
    "baseActiva90d": 95,
    "dormidosVisita30d": 42,
    "dormidosCompra90d": 45,
    "nuncaVisitados": 18,
    "nuncaCompraron": 7
  },
  "clientes": [
    {
      "clientId": "ba__la_plata__pescar_info_shop",
      "cardCode": "C30711930392",
      "clientName": "PESCAR.INFO SHOP S.R.L.",
      "provincia": "BUENOS AIRES",
      "localidad": "LA PLATA",
      "cliTipo": "A",
      "ultimaVisitaPresencial": "2026-09-15",
      "diasSinVisitaPresencial": 35,
      "ultimoContacto": "2026-10-02",
      "diasSinContacto": 18,
      "ultimaCompra": "2026-10-05",
      "diasSinCompra": 15,
      "facturado12M": 2500000,
      "deudaAbierta": 450000
    }
  ],
  "_sourceBqJobId": "...",
  "_rowsProcessed": 180
}
```

### Reglas de nulls

- Fechas en ISO `YYYY-MM-DD` (sin hora — snapshot diario).
- `null` cuando el cliente nunca tuvo ese evento. Frontend muestra "—" o "Nunca".
- `cardCode: null` si cliente está en `client_master` pero no en SAP → se incluye con columnas de compra vacías.
- Clientes que facturaron en SAP pero NO están en `client_master.assignedVendor` → **no entran** (consistente con decisión #2).

### Naming: BQ view → Firestore doc

La view BQ expone fields con naming source-of-truth (`province`, `locName`, `cliTipo` del client_master). La función `normalizeClienteRow()` dentro de la CF handler los **traduce al español** para el doc Firestore (consistente con los counts `baseActiva90d`, `dormidosVisita30d`, etc.):

| BQ view field | Firestore doc field |
|---|---|
| `province` | `provincia` |
| `locName` | `localidad` |
| `clientName` | `clientName` (igual) |
| `cliTipo` | `cliTipo` (igual) |
| `card_code` | `cardCode` |
| `vendor_key` | `vendorKey` |
| `ultima_visita_presencial` | `ultimaVisitaPresencial` |
| `ultimo_contacto` | `ultimoContacto` |
| `ultima_compra` | `ultimaCompra` |
| `facturado_12m` | `facturado12M` |
| `deuda_abierta` | `deudaAbierta` |
| `dias_sin_visita_presencial` | `diasSinVisitaPresencial` |
| `dias_sin_contacto` | `diasSinContacto` |
| `dias_sin_compra` | `diasSinCompra` |

### Tamaño

~400 bytes/cliente × 500 clientes ≈ 200 KB por VDE. Firestore limit = 1 MiB → OK.

---

## BQ view `v_cartera_vendor`

### Pseudocódigo

```sql
CREATE OR REPLACE VIEW shimano_app.v_cartera_vendor AS

WITH cartera AS (
  SELECT
    document_id       AS client_id,
    cardCodeSap       AS card_code,
    clientName, province, locName,
    cliTipo,
    canonVendor(assignedVendor) AS vendor_key
  FROM client_master_raw_raw_latest
  WHERE assignedVendor IS NOT NULL AND TRIM(assignedVendor) != ''
),
visitas_agg AS (
  SELECT
    client_id,
    MAX(IF(interaction_type = 'visita',   fecha, NULL)) AS ultima_visita_presencial,
    MAX(IF(interaction_type = 'contacto', fecha, NULL)) AS ultimo_contacto
  FROM v_visitas_full
  GROUP BY client_id
),
compras_agg AS (
  SELECT
    card_code,
    MAX(IF(doc_kind='INVOICE', doc_date, NULL)) AS ultima_compra,
    SUM(IF(doc_date >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 12 MONTH),
           importe_linea_ars, 0)) AS facturado_12m
  FROM v_ventas_lineas
  WHERE card_code IS NOT NULL
  GROUP BY card_code
),
deuda_agg AS (
  SELECT card_code, SUM(saldo_ars) AS deuda_abierta
  FROM v_deuda_facturas_detalle
  WHERE saldo_ars > 0
  GROUP BY card_code
)
SELECT
  c.vendor_key, c.client_id, c.card_code, c.clientName,
  c.province, c.locName, c.cliTipo,
  v.ultima_visita_presencial, v.ultimo_contacto,
  co.ultima_compra, COALESCE(co.facturado_12m, 0) AS facturado_12m,
  COALESCE(d.deuda_abierta, 0) AS deuda_abierta,
  DATE_DIFF(CURRENT_DATE('America/Argentina/Buenos_Aires'), v.ultima_visita_presencial, DAY) AS dias_sin_visita_presencial,
  DATE_DIFF(CURRENT_DATE('America/Argentina/Buenos_Aires'), v.ultimo_contacto, DAY)          AS dias_sin_contacto,
  DATE_DIFF(CURRENT_DATE('America/Argentina/Buenos_Aires'), co.ultima_compra, DAY)           AS dias_sin_compra
FROM cartera c
LEFT JOIN visitas_agg v  ON v.client_id = c.client_id
LEFT JOIN compras_agg co ON co.card_code = c.card_code
LEFT JOIN deuda_agg   d  ON d.card_code = c.card_code
```

### Inputs

| Fuente | Usada para |
|---|---|
| `client_master_raw_raw_latest` | cartera + cliTipo + geo |
| `v_visitas_full` | última visita presencial + último contacto |
| `v_ventas_lineas` | última compra + facturado 12M (sólo INVOICE neto NC) |
| `v_deuda_facturas_detalle` | deuda abierta por `card_code` |

### Validaciones durante implementación (TODOs explícitos)

- Confirmar nombre exacto del field `cardCodeSap` vs `cardCode` en `client_master_raw_raw_latest`.
- Confirmar que `v_visitas_full` tiene `client_id` (Firestore ID). Si no, matching por `clientLocId = norm(prov) + norm(loc) + norm(name)`.
- Confirmar schema de `v_deuda_facturas_detalle` (nombre exacto del field saldo).

### Edge cases cubiertos

- Cliente sin `cardCodeSap` → `card_code=null`, `ultima_compra=null`, `facturado_12m=0`, `deuda=0`. Aparece con lo de visitas.
- Cliente con `cardCode` pero sin visitas → columnas visita en `null` → cae en chip "Nunca visitados".
- Cliente que facturó SAP pero sin assignedVendor → no entra (reporte separado "huérfanos SAP" si se pide después).
- Visita a lead (sin cliente aún en client_master) → ignorada.

---

## CF scheduled `syncCarteraVendorScheduled`

### Trigger

```js
export const syncCarteraVendorScheduled = onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    region: 'southamerica-east1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const bqClient = new BigQuery({ projectId: PROJECT });
    const fbDb = getFirestore();
    const r = await handleSyncCarteraVendor({ bqClient, fbDb, log: console.log });
    console.log('syncCarteraVendorScheduled summary', r);
  }
);
```

### Core handler

**Archivo**: `functions/core/sync-cartera-vendor-core.js` (patrón calco de `sync-sap-payments-core.js`).

```js
export async function handleSyncCarteraVendor(deps) {
  const nowIso = new Date().toISOString();
  const snapshotDate = /* YYYY-MM-DD ART */;

  // 1. Query BQ view
  const [rows] = await deps.bqClient.query('SELECT * FROM shimano_app.v_cartera_vendor');

  // 2. Agrupar por vendor_key
  const byVendor = new Map();
  for (const row of rows) {
    const key = row.vendor_key;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key).push(normalizeClienteRow(row));
  }

  // 3. Write 1 doc per vendor con counts + clientes[]
  const writeBatch = deps.fbDb.batch();
  for (const [vendorKey, clientes] of byVendor) {
    const counts = computeCounts(clientes);
    writeBatch.set(
      deps.fbDb.collection('cartera_vendor').doc(vendorKey),
      { vendorKey, vendorNameDisplay: vendorKey, snapshotAt: nowIso, snapshotDate, counts, clientes }
    );
  }
  await writeBatch.commit();

  // 4. Delete docs huerfanos (vendors sin clientes)
  const existingSnap = await deps.fbDb.collection('cartera_vendor').get();
  const deleteBatch = deps.fbDb.batch();
  let deleted = 0;
  existingSnap.forEach(doc => {
    if (!byVendor.has(doc.id)) {
      deleteBatch.delete(doc.ref);
      deleted++;
    }
  });
  if (deleted > 0) await deleteBatch.commit();

  return { vendorsProcessed: byVendor.size, totalClientes: rows.length, deletedOrphans: deleted };
}
```

### Función pura `computeCounts(clientes)`

```js
export function computeCounts(clientes) {
  return {
    total: clientes.length,
    baseActiva90d:       clientes.filter(c => c.diasSinCompra !== null && c.diasSinCompra <= 90).length,
    dormidosVisita30d:   clientes.filter(c => c.diasSinVisitaPresencial !== null && c.diasSinVisitaPresencial > 30).length,
    dormidosCompra90d:   clientes.filter(c => c.diasSinCompra !== null && c.diasSinCompra > 90).length,
    nuncaVisitados:      clientes.filter(c => c.ultimaVisitaPresencial === null).length,
    nuncaCompraron:      clientes.filter(c => c.ultimaCompra === null).length,
  };
}
```

### Costo + idempotencia

- 1 BQ query/día + ~15-30 writes Firestore/día. **< $0.01/mes**.
- `set` overwrite completo → correr dos veces en el mismo día produce resultado idéntico.
- Delete de huérfanos evita docs zombie de vendors re-asignados o baja.

---

## Frontend

### Archivos

- `src/domains/seguimiento.js` → **se reescribe completo** y se renombra a `src/domains/cartera-vendor.js`.
- `build.js`: cambiar entry `seguimiento` → `cartera-vendor`.
- `src/main.js`: idem.
- `index.html`: borrar HTML del modal viejo + reemplazar por shell nuevo.
- `firestore.rules`: borrar reglas `seguimiento_notes`/`seguimiento_status`, agregar read `cartera_vendor` → `isSeguimientoUser()`.

### Botón de entrada

El botón `.btn-seguimiento` del header se mantiene (misma ubicación, mismo gate). Label pasa a **"Análisis de Cartera"** y icono cambia a 📊. Renombrado a `.btn-cartera`.

### Estado interno

```js
let carteraDocCache = new Map();   // vendorKey → doc data (lazy fetch)
let selectedVendor = null;
let activeChip = 'todos';          // 1 activo a la vez
let searchQuery = '';
let sortBy = 'diasSinCompra';      // default
let sortDir = 'desc';
```

### Fetch strategy

Lazy on-demand con cache. Al cambiar vendor en dropdown → `fetchDoc(vendorKey)` → cachea. No `onSnapshot` (data cambia 1x/día).

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ 📊 Análisis de Cartera por Vendedor              [× cerrar]│
├─────────────────────────────────────────────────────────────┤
│ Vendedor: [GONZALO DE LA ROSA ▼]  Snapshot: 21/10 04:00 ART│
├─────────────────────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                 │
│ │Total│ │Base│ │Dorm│ │Dorm│ │Nun│  │Nun│  ← cards clickbl │
│ │ 180 │ │ 95 │ │ 42 │ │ 45 │ │ 18│  │ 7 │   = chip equiv   │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                 │
├─────────────────────────────────────────────────────────────┤
│ [Todos ✓] [Base activa] [Dorm vis] [Dorm com] [Nun v][Nun c]
│ 🔍 [Buscar cliente...]                    [📥 Exportar]    │
├─────────────────────────────────────────────────────────────┤
│ Cliente         Prov/Loc    Tipo Últ.vis   Últ.comp   $12M │
│ ───────────────────────────────────────────────────────────│
│ PESCAR.INFO     BA/La Plata  A   15/09 35d 05/10 15d  2.5M│
│ LA LOMITA       BA/Zárate    B    —        —          0   │
└─────────────────────────────────────────────────────────────┘
```

### Columnas de la tabla

1. **Cliente** (bold)
2. **Prov/Loc** (ej: "BA/La Plata")
3. **Tipo** (badge A/B/C/P)
4. **Última visita presencial** → `dd/MM dXd` o "—". Rojo si >30d.
5. **Último contacto** → `dd/MM dXd` o "—". Gris claro (métrica secundaria).
6. **Última compra** → `dd/MM dXd` o "—". Rojo si >90d.
7. **Facturado 12M** → formato `$ 2,5M` / `$ 450k`.
8. **Deuda** → formato `$ X`. Rojo si > 0.

### Interacciones

| Elemento | Comportamiento |
|---|---|
| Dropdown vendor | VendorKeys ordenados alfa. Default = ninguno. |
| 6 KPI cards | Clickeables = equiv al chip del mismo nombre. Card activa = outline naranja. |
| 6 chips | 1 activo a la vez. "Todos" por default. |
| Search box | Debounce 300ms. Filtra por `clientName.toLowerCase().includes(query)` sobre el chip actual. |
| Botón Exportar | `exportCarteraToExcel()` → xlsx con filtro + search aplicados. |
| Row click | Abre Ficha Cliente existente (`openFichaCliente(clientId)`). |
| Column header click | Toggle sort asc/desc por esa columna. Default `diasSinCompra DESC`. |

### Loading / error states

- Sin vendor seleccionado → placeholder "Elegí un vendedor para ver su cartera".
- Loading → spinner "Cargando cartera...".
- Vendor seleccionado + doc no existe → "Sin cartera para este vendedor. Verificá assignedVendor en client_master o esperá al próximo snapshot (04:00 ART)."
- Snapshot stale (>36hs vs hoy) → warning banner "⚠️ Snapshot del DD/MM — el sync nightly puede haber fallado".

### Mobile

Desktop-only. Si se abre en mobile → mensaje "Mejor abrir desde computadora".

---

## Export Excel

**Función**: `exportCarteraToExcel()` en `src/domains/cartera-vendor.js`.

**Patrón**: reusa `exports-core.js` (ExcelJS, banda verde #22c55e fila 1, headers blanco bold fila 2, money format).

**Nombre archivo**: `Cartera_${vendorKey}_${activeChip}_${snapshotDate}.xlsx`.

**Columnas Excel** (idem tabla + 3 extras útiles solo en xlsx):

1-8. Las mismas que la tabla UI.
9. **Días sin visita (num)** → para ordenar en Excel.
10. **Días sin compra (num)** → idem.
11. **CardCode SAP** → útil para cruzar con otros reportes.

---

## Testing

### Unit (`tests/unit/`)

| Archivo | Qué cubre | # tests |
|---|---|---|
| `compute-counts.test.js` | función pura `computeCounts(clientes)` | ~8 |
| `cartera-filter.test.js` | aplicar chip + search al array | ~6 |
| `cartera-sort.test.js` | sort por columna, nulls al final | ~4 |

### Integration (`tests/functions/`)

| Archivo | Qué cubre |
|---|---|
| `sync-cartera-vendor.test.js` | handler con fakeFbDb + fakeBqClient. 6 casos: 2 vendors+clientes, vendor huérfano se borra, idempotencia, 0 clientes vendor skipea, cliente sin cardCode OK, batch >400 pedidos se splittea |

### Smoke manual post-deploy

1. Trigger manual: `gcloud scheduler jobs run syncCarteraVendorScheduled --project=app-vendedores-shimano --location=southamerica-east1`
2. Verificar Firestore `cartera_vendor/{vendorKey}` existe para VDEs conocidos.
3. Abrir modal en la app → seleccionar vendor → verificar KPIs matchean lo esperado (ej: PACHI ~X clientes).
4. Click en un cliente → abre Ficha Cliente OK.
5. Click chip "Dormidos compra 90d" → tabla se filtra.
6. Click Exportar → baja xlsx con lista filtrada.

---

## Cleanup del modal viejo

### Archivos a tirar / reescribir

- `src/domains/seguimiento.js` → reescribe completo como `src/domains/cartera-vendor.js`.
- `build.js`, `src/main.js`: cambiar entry.
- `index.html`: borrar HTML del modal viejo (6 tabs, listado visitas, listado pedidos, pendientes, oportunidades, duplas) + reemplazar por shell nuevo.
- `firestore.rules`: borrar reglas `seguimiento_notes` + `seguimiento_status` (líneas 156, 179 según inventario).

### Collections Firestore a borrar

Script one-off `scripts/_cleanup_seguimiento_collections.cjs` con `--dry-run`/`--commit`:

- `seguimiento_notes`
- `seguimiento_status`

**Backup previo (safety)**: dumpea JSON a `./backups/seguimiento_backup_${YYYY-MM-DD}.json` antes del delete. Si Mariano quiere recuperar algo después, está el archivo.

### Collection nueva

- `cartera_vendor` → rules nuevo: `read: isSeguimientoUser()`. No hay write client-side (solo escribe la CF).

### Renames

- `canViewSeguimiento()` → `canViewCarteraAnalisis()` (misma lógica).
- Botón header `.btn-seguimiento` → `.btn-cartera` + label "Análisis de Cartera" + icono 📊.

---

## Deploy + rollback

### Orden de deploy

1. Deploy BQ view `v_cartera_vendor` (Python script `scripts/deploy_v_cartera_vendor.py` con `bq query` + UTF-8).
2. Deploy CF `syncCarteraVendorScheduled`: `firebase deploy --only functions:syncCarteraVendorScheduled`.
3. Trigger manual 1x la CF para pre-poblar `cartera_vendor/{vendorKey}` (sino la app abre con "sin cartera" hasta las 04:00 ART de mañana).
4. Deploy frontend: `node build.js` + commit chunks + firebase hosting deploy.
5. Deploy rules: `firebase deploy --only firestore:rules`.
6. Correr script cleanup `--dry-run` → review → `--commit`.

### Smoke post-deploy

Los 6 pasos del smoke manual arriba.

### Rollback

1. `git revert` el commit del PR → re-deploy functions + hosting + rules.
2. Collection `cartera_vendor` queda en Firestore inútil pero sin costo (0 lecturas si la UI vieja no la consulta).
3. Collections viejas `seguimiento_notes` + `seguimiento_status` ya borradas → recuperar del backup JSON (`scripts/_restore_seguimiento_collections.cjs`).

**Rollback timing**: todo reversible en <30min excepto delete de collections viejas que requiere restore del backup (~15min).

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| `v_visitas_full` no tiene `client_id` Firestore (join falla) | Fallback match por `clientLocId = norm(prov) + norm(loc) + norm(name)` (patrón ya usado en reparto-core) |
| Cliente con assignedVendor ambiguo o typo (ej: "GONZALO " con space) | `canonVendor()` + trim + upper. Reusa el helper existente |
| Doc >1MiB para VDE muy grande | Monitor en la CF: si `clientes.length > 2000`, split en subdocs (no esperado hoy, VDE más grande tiene ~500) |
| CF scheduled falla silenciosamente | Alerta: si `snapshotDate < today-2`, warning banner en UI + log GCP WARNING |
| User abre modal justo mientras corre el sync (race) | `set` overwrite es atómico → user ve el doc viejo O el nuevo, nunca un mix |

---

## Status checklist

- [x] Decisiones de product (12/12)
- [x] Approach arquitectónico elegido (A)
- [x] Data model definido
- [x] BQ view pseudocódigo
- [x] CF handler pseudocódigo + trigger
- [x] Frontend layout + componentes + estados
- [x] Export Excel definido
- [x] Testing plan
- [x] Cleanup plan
- [x] Deploy + rollback plan
- [ ] User review del spec
- [ ] Implementation plan (next skill: `writing-plans`)
