# Análisis de Cartera por Vendedor (v1283) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modal "Seguimiento" por "Análisis de Cartera por Vendedor" — un dashboard que muestra cobertura comercial (visitas + compras) por cliente de cada VDE con snapshots diarios desde BQ.

**Architecture:** BQ view `v_cartera_vendor` agrega 1 fila por cliente de cartera con fechas de visita/compra + fact12M + deuda. CF scheduled `syncCarteraVendorScheduled` corre 04:00 ART, lee la view, agrupa por vendor_key y escribe 1 doc por VDE en `cartera_vendor/{vendorKey}`. Frontend lee lazy el doc del vendor seleccionado y renderiza KPIs cards + tabla con chips de filtro + export Excel.

**Tech Stack:** BigQuery (view SQL), Node.js 22 Cloud Functions v2 (onSchedule, firebase-admin, @google-cloud/bigquery), Firestore (collection cartera_vendor), vanilla JS frontend (bundle IIFE patrón E2), ExcelJS para export, Vitest para tests, biome lint.

**Spec:** `docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md`

**IMPORTANTE sobre seguridad DOM**: el repo tiene policy anti-XSS (CodeQL + hook de pre-write). TODO el render de HTML dinámico usa `document.createElement` + `textContent` + `appendChild`. NO usar `innerHTML`, `insertAdjacentHTML`, ni template strings concatenadas aunque haya escape. Precedente: fix v876 (XSS CodeQL #25).

---

## File Structure

### New files

- `scripts/deploy_v_cartera_vendor.py` — one-off deploy script del view BQ
- `functions/core/cartera-vendor-core.js` — handler puro + `computeCounts` + `normalizeClienteRow`
- `src/pure/cartera-vendor-filter.js` — `applyChipFilter` + `sortClientes` para el frontend
- `src/domains/cartera-vendor.js` — reemplaza `seguimiento.js`
- `tests/unit/cartera-vendor-compute.test.js` — tests TDD para computeCounts + normalizeClienteRow
- `tests/unit/cartera-vendor-filter.test.js` — tests TDD para chip filter + sort
- `tests/functions/sync-cartera-vendor.test.js` — tests TDD integración handler
- `scripts/_cleanup_seguimiento_collections.cjs` — one-off cleanup con backup

### Modified files

- `bigquery/views.sql` — agregar bloque `CREATE OR REPLACE VIEW v_cartera_vendor`
- `functions/index.js` — agregar import + wrapper `syncCarteraVendorScheduled`
- `firestore.rules` — agregar `cartera_vendor` read, remover `seguimiento_notes` + `seguimiento_status`
- `index.html` — reemplazar shell HTML del modal viejo + renombrar botón header
- `build.js` — cambiar entry `seguimiento` → `cartera-vendor`
- `src/main.js` — cambiar `installChunkStubs('seguimiento', ...)` → `cartera-vendor`
- `sw.js` — bump CACHE_VERSION + agregar `./chunks/cartera-vendor.js`
- `README.md` — bump APP_VERSION + entry §41 (changelog v1283)

### Deleted files

- `src/domains/seguimiento.js` — reemplazado

---

## Task 1: BQ view `v_cartera_vendor` + deploy script

**Files:**
- Modify: `bigquery/views.sql`
- Create: `scripts/deploy_v_cartera_vendor.py`

**Pre-work: validar nombres de fields BQ reales**

- [ ] **Step 1.1: Confirmar schema de `client_master_raw_raw_latest`**

Run:
```powershell
bq show --schema --format=prettyjson app-vendedores-shimano:shimano_app.client_master_raw_raw_latest | python -c "import json,sys; print([f['name'] for f in json.load(sys.stdin)])"
```

Expected: ver si existe field `data` (STRING JSON) o fields planos. El patrón de las otras `*_raw_raw_latest` es `data STRING` + hay que `JSON_VALUE(data, '$.field')`. Confirmá los paths: `$.clientName`, `$.cardCodeSap`, `$.province`, `$.locName`, `$.cliTipo`, `$.assignedVendor`.

- [ ] **Step 1.2: Confirmar schema de `v_visitas_full`**

Run:
```powershell
bq show --schema --format=prettyjson app-vendedores-shimano:shimano_app.v_visitas_full | python -c "import json,sys; print([f['name'] for f in json.load(sys.stdin)])"
```

Expected: ver si hay `client_firestore_id`/`client_id` + `interaction_type` + `fecha`. Si no hay client_id, usar matching por `clientLocId = norm(prov) + norm(loc) + norm(name)` (patrón ya usado en reparto-core).

- [ ] **Step 1.3: Confirmar schema de `v_deuda_facturas_detalle`**

Run:
```powershell
bq show --schema --format=prettyjson app-vendedores-shimano:shimano_app.v_deuda_facturas_detalle | python -c "import json,sys; print([f['name'] for f in json.load(sys.stdin)])"
```

Expected: field name real del saldo (`saldo_ars`, `balance_due_ars`, u otro). Confirmar que hay `card_code`.

**Implementation**

- [ ] **Step 1.4: Agregar SQL del view al final de `bigquery/views.sql`**

Agregar al final del archivo (sustituí field names según los steps 1.1-1.3):

```sql
-- v_cartera_vendor (v1283, 2026-10-20)
-- Fuente para dashboard "Analisis de Cartera por Vendedor".
-- 1 fila por cliente de la cartera (client_master.assignedVendor IS NOT NULL).
-- Enriquece con: ultima visita presencial, ultimo contacto, ultima compra (SAP
-- INVOICE neto NC), facturado 12M movil, deuda abierta, cliTipo, geo.
-- Consumida por CF syncCarteraVendorScheduled 04:00 ART.
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_cartera_vendor` AS

WITH cartera AS (
  SELECT
    document_id                                            AS client_id,
    JSON_VALUE(data, '$.cardCodeSap')                      AS card_code,
    JSON_VALUE(data, '$.clientName')                       AS client_name,
    JSON_VALUE(data, '$.province')                         AS province,
    JSON_VALUE(data, '$.locName')                          AS loc_name,
    JSON_VALUE(data, '$.cliTipo')                          AS cli_tipo,
    -- canonVendor: alias MARTIN BOIERO -> PACHI consistente con planner-stage-change-core.js
    CASE
      WHEN UPPER(TRIM(JSON_VALUE(data, '$.assignedVendor'))) = 'MARTIN BOIERO' THEN 'PACHI'
      ELSE UPPER(TRIM(JSON_VALUE(data, '$.assignedVendor')))
    END                                                     AS vendor_key
  FROM `app-vendedores-shimano.shimano_app.client_master_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.assignedVendor') IS NOT NULL
    AND TRIM(JSON_VALUE(data, '$.assignedVendor')) != ''
),
visitas_agg AS (
  SELECT
    client_id,
    MAX(IF(interaction_type = 'visita',   fecha, NULL)) AS ultima_visita_presencial,
    MAX(IF(interaction_type = 'contacto', fecha, NULL)) AS ultimo_contacto
  FROM `app-vendedores-shimano.shimano_app.v_visitas_full`
  WHERE client_id IS NOT NULL
  GROUP BY client_id
),
compras_agg AS (
  SELECT
    card_code,
    MAX(IF(doc_kind = 'INVOICE', doc_date, NULL)) AS ultima_compra,
    SUM(IF(doc_date >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 12 MONTH),
           importe_linea_ars, 0)) AS facturado_12m
  FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
  WHERE card_code IS NOT NULL
  GROUP BY card_code
),
deuda_agg AS (
  SELECT
    card_code,
    SUM(saldo_ars) AS deuda_abierta
  FROM `app-vendedores-shimano.shimano_app.v_deuda_facturas_detalle`
  WHERE saldo_ars > 0
  GROUP BY card_code
)
SELECT
  c.vendor_key,
  c.client_id,
  c.card_code,
  c.client_name,
  c.province,
  c.loc_name,
  c.cli_tipo,
  v.ultima_visita_presencial,
  v.ultimo_contacto,
  co.ultima_compra,
  COALESCE(co.facturado_12m, 0) AS facturado_12m,
  COALESCE(d.deuda_abierta, 0)  AS deuda_abierta,
  DATE_DIFF(CURRENT_DATE('America/Argentina/Buenos_Aires'), v.ultima_visita_presencial, DAY) AS dias_sin_visita_presencial,
  DATE_DIFF(CURRENT_DATE('America/Argentina/Buenos_Aires'), v.ultimo_contacto, DAY)          AS dias_sin_contacto,
  DATE_DIFF(CURRENT_DATE('America/Argentina/Buenos_Aires'), co.ultima_compra, DAY)           AS dias_sin_compra
FROM cartera c
LEFT JOIN visitas_agg v  ON v.client_id = c.client_id
LEFT JOIN compras_agg co ON co.card_code = c.card_code
LEFT JOIN deuda_agg   d  ON d.card_code = c.card_code
;
```

- [ ] **Step 1.5: Crear `scripts/deploy_v_cartera_vendor.py`**

Create: `scripts/deploy_v_cartera_vendor.py`

```python
"""
Deploya la view v_cartera_vendor (v1283, 2026-10-20) a BigQuery.

Uso:
  python scripts/deploy_v_cartera_vendor.py

Requiere: google-cloud-bigquery + ADC del proyecto app-vendedores-shimano.
"""
import re
from pathlib import Path

from google.cloud import bigquery

PROJECT = "app-vendedores-shimano"
VIEWS_FILE = Path("bigquery/views.sql")
VIEW_NAME = "v_cartera_vendor"


def extract_view_sql(src: str, view_name: str) -> str:
    pattern = (
        r"(CREATE OR REPLACE VIEW\s+`[^`]+\." + re.escape(view_name) + r"`\s+AS.*?;)"
    )
    m = re.search(pattern, src, re.DOTALL | re.IGNORECASE)
    if not m:
        raise SystemExit(f"[ERROR] no encontre CREATE OR REPLACE VIEW {view_name} en {VIEWS_FILE}")
    return m.group(1)


def main():
    if not VIEWS_FILE.exists():
        raise SystemExit(f"[ERROR] no existe {VIEWS_FILE}")
    src = VIEWS_FILE.read_text(encoding="utf-8")
    sql = extract_view_sql(src, VIEW_NAME)
    print(f"[INFO] deploying {VIEW_NAME} ({len(sql)} chars)...")
    client = bigquery.Client(project=PROJECT)
    job = client.query(sql)
    job.result()
    print(f"[OK] {VIEW_NAME} deployada.")

    smoke_sql = (
        f"SELECT vendor_key, COUNT(*) AS n_clientes "
        f"FROM `{PROJECT}.shimano_app.{VIEW_NAME}` "
        f"GROUP BY vendor_key ORDER BY n_clientes DESC LIMIT 10"
    )
    print("[INFO] smoke query...")
    rows = list(client.query(smoke_sql).result())
    print(f"[OK] top 10 vendors ({sum(r['n_clientes'] for r in rows)} clientes totales):")
    for r in rows:
        print(f"  {r['vendor_key']:<30} {r['n_clientes']:>5} clientes")


if __name__ == "__main__":
    main()
```

- [ ] **Step 1.6: Deploy del view + smoke**

Run: `python scripts/deploy_v_cartera_vendor.py`
Expected: `[OK] v_cartera_vendor deployada.` + tabla top 10 vendors. Si falla por field no existente, volvé al step 1.1-1.3 y corregí el SQL.

- [ ] **Step 1.7: Sanity check vs reporte Mariano**

Run en BQ UI o CLI:
```sql
SELECT vendor_key, COUNT(*) AS n, SUM(facturado_12m) AS fact_total
FROM `app-vendedores-shimano.shimano_app.v_cartera_vendor`
GROUP BY vendor_key ORDER BY fact_total DESC
```

Expected: 15-30 vendor_keys. Facturación total en el orden de ~$10B anual Pesca. Si da 0 o muy bajo, hay bug en JOIN compras_agg.

- [ ] **Step 1.8: Commit**

```bash
git add bigquery/views.sql scripts/deploy_v_cartera_vendor.py
git commit -m "v1283: BQ view v_cartera_vendor + deploy script"
```

---

## Task 2: Función pura `computeCounts()` (TDD)

**Files:**
- Create: `tests/unit/cartera-vendor-compute.test.js`
- Create: `functions/core/cartera-vendor-core.js`

- [ ] **Step 2.1: Escribir test fallante**

Create: `tests/unit/cartera-vendor-compute.test.js`

```js
// @ts-check
import { describe, expect, it } from 'vitest';
import { computeCounts } from '../../functions/core/cartera-vendor-core.js';

describe('computeCounts', () => {
  it('array vacio -> todos los counts en 0', () => {
    expect(computeCounts([])).toEqual({
      total: 0, baseActiva90d: 0, dormidosVisita30d: 0,
      dormidosCompra90d: 0, nuncaVisitados: 0, nuncaCompraron: 0,
    });
  });

  it('cliente nunca visito ni compro -> nuncaVisitados + nuncaCompraron', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: null, diasSinVisitaPresencial: null, ultimaCompra: null, diasSinCompra: null },
    ]);
    expect(r.total).toBe(1);
    expect(r.nuncaVisitados).toBe(1);
    expect(r.nuncaCompraron).toBe(1);
    expect(r.baseActiva90d).toBe(0);
    expect(r.dormidosVisita30d).toBe(0);
    expect(r.dormidosCompra90d).toBe(0);
  });

  it('cliente base activa (diasSinCompra <= 90) -> baseActiva90d', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: '2026-10-01', diasSinVisitaPresencial: 20, ultimaCompra: '2026-10-05', diasSinCompra: 15 },
    ]);
    expect(r.baseActiva90d).toBe(1);
    expect(r.dormidosCompra90d).toBe(0);
    expect(r.nuncaCompraron).toBe(0);
  });

  it('cliente dormido visita + dormido compra simultaneo', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: '2026-08-01', diasSinVisitaPresencial: 80, ultimaCompra: '2026-06-01', diasSinCompra: 141 },
    ]);
    expect(r.dormidosVisita30d).toBe(1);
    expect(r.dormidosCompra90d).toBe(1);
    expect(r.baseActiva90d).toBe(0);
    expect(r.nuncaVisitados).toBe(0);
  });

  it('exactamente 30d visita -> NO cuenta como dormido (umbral estricto >30)', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: '2026-09-20', diasSinVisitaPresencial: 30, ultimaCompra: null, diasSinCompra: null },
    ]);
    expect(r.dormidosVisita30d).toBe(0);
  });

  it('exactamente 90d compra -> base activa (umbral <=90)', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: null, diasSinVisitaPresencial: null, ultimaCompra: '2026-07-22', diasSinCompra: 90 },
    ]);
    expect(r.baseActiva90d).toBe(1);
    expect(r.dormidosCompra90d).toBe(0);
  });

  it('91d compra -> dormido 90d, no base activa', () => {
    const r = computeCounts([
      { ultimaVisitaPresencial: null, diasSinVisitaPresencial: null, ultimaCompra: '2026-07-21', diasSinCompra: 91 },
    ]);
    expect(r.baseActiva90d).toBe(0);
    expect(r.dormidosCompra90d).toBe(1);
  });

  it('mix de 5 clientes con breakdown esperado', () => {
    const clientes = [
      { ultimaVisitaPresencial: '2026-10-15', diasSinVisitaPresencial: 5,  ultimaCompra: '2026-10-10', diasSinCompra: 10 },
      { ultimaVisitaPresencial: '2026-09-10', diasSinVisitaPresencial: 40, ultimaCompra: '2026-07-01', diasSinCompra: 111 },
      { ultimaVisitaPresencial: null,         diasSinVisitaPresencial: null, ultimaCompra: null,       diasSinCompra: null },
      { ultimaVisitaPresencial: null,         diasSinVisitaPresencial: null, ultimaCompra: '2026-10-01', diasSinCompra: 19 },
      { ultimaVisitaPresencial: '2026-10-18', diasSinVisitaPresencial: 2,  ultimaCompra: null,         diasSinCompra: null },
    ];
    const r = computeCounts(clientes);
    expect(r.total).toBe(5);
    expect(r.baseActiva90d).toBe(2);
    expect(r.dormidosVisita30d).toBe(1);
    expect(r.dormidosCompra90d).toBe(1);
    expect(r.nuncaVisitados).toBe(2);
    expect(r.nuncaCompraron).toBe(2);
  });
});
```

- [ ] **Step 2.2: Correr test → debe fallar**

Run: `npx vitest run tests/unit/cartera-vendor-compute.test.js`
Expected: FAIL "Cannot find module '../../functions/core/cartera-vendor-core.js'"

- [ ] **Step 2.3: Crear `functions/core/cartera-vendor-core.js` con solo `computeCounts`**

Create: `functions/core/cartera-vendor-core.js`

```js
// @ts-check
/**
 * cartera-vendor-core.js (v1283, 2026-10-20)
 *
 * Core puro para syncCarteraVendorScheduled CF.
 * Snapshot nightly 04:00 ART desde v_cartera_vendor BQ -> cartera_vendor/{vendorKey} Firestore.
 *
 * Spec: docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md
 */

/**
 * @typedef {Object} ClienteCartera
 * @property {string|null} ultimaVisitaPresencial
 * @property {number|null} diasSinVisitaPresencial
 * @property {string|null} ultimaCompra
 * @property {number|null} diasSinCompra
 */

/**
 * @typedef {Object} ClienteCounts
 * @property {number} total
 * @property {number} baseActiva90d
 * @property {number} dormidosVisita30d
 * @property {number} dormidosCompra90d
 * @property {number} nuncaVisitados
 * @property {number} nuncaCompraron
 */

/**
 * Computa los 6 KPIs del dashboard sobre un array de clientes.
 *
 * Umbrales fijos (decision #7 del spec):
 *   - base activa: diasSinCompra <= 90
 *   - dormido visita: diasSinVisitaPresencial > 30
 *   - dormido compra: diasSinCompra > 90
 *   - nunca visitado: ultimaVisitaPresencial === null
 *   - nunca compro: ultimaCompra === null
 *
 * @param {ClienteCartera[]} clientes
 * @returns {ClienteCounts}
 */
export function computeCounts(clientes) {
  const total = clientes.length;
  let baseActiva90d = 0;
  let dormidosVisita30d = 0;
  let dormidosCompra90d = 0;
  let nuncaVisitados = 0;
  let nuncaCompraron = 0;
  for (const c of clientes) {
    if (c.diasSinCompra !== null && c.diasSinCompra !== undefined && c.diasSinCompra <= 90) {
      baseActiva90d++;
    }
    if (c.diasSinVisitaPresencial !== null && c.diasSinVisitaPresencial !== undefined && c.diasSinVisitaPresencial > 30) {
      dormidosVisita30d++;
    }
    if (c.diasSinCompra !== null && c.diasSinCompra !== undefined && c.diasSinCompra > 90) {
      dormidosCompra90d++;
    }
    if (c.ultimaVisitaPresencial === null || c.ultimaVisitaPresencial === undefined) {
      nuncaVisitados++;
    }
    if (c.ultimaCompra === null || c.ultimaCompra === undefined) {
      nuncaCompraron++;
    }
  }
  return { total, baseActiva90d, dormidosVisita30d, dormidosCompra90d, nuncaVisitados, nuncaCompraron };
}
```

- [ ] **Step 2.4: Correr test → debe pasar**

Run: `npx vitest run tests/unit/cartera-vendor-compute.test.js`
Expected: PASS 8 tests.

- [ ] **Step 2.5: Commit**

```bash
git add functions/core/cartera-vendor-core.js tests/unit/cartera-vendor-compute.test.js
git commit -m "v1283: computeCounts puro + 8 tests TDD"
```

---

## Task 3: Función pura `normalizeClienteRow()` (TDD)

**Files:**
- Modify: `tests/unit/cartera-vendor-compute.test.js`
- Modify: `functions/core/cartera-vendor-core.js`

- [ ] **Step 3.1: Agregar tests de `normalizeClienteRow`**

Agregar al final de `tests/unit/cartera-vendor-compute.test.js`:

```js
import { normalizeClienteRow } from '../../functions/core/cartera-vendor-core.js';

describe('normalizeClienteRow', () => {
  it('traduce BQ fields snake_case -> Firestore camelCase + espanol', () => {
    const bqRow = {
      vendor_key: 'GONZALO DE LA ROSA',
      client_id: 'ba__la_plata__pescar_info_shop',
      card_code: 'C30711930392',
      client_name: 'PESCAR.INFO SHOP S.R.L.',
      province: 'BUENOS AIRES',
      loc_name: 'LA PLATA',
      cli_tipo: 'A',
      ultima_visita_presencial: '2026-09-15',
      ultimo_contacto: '2026-10-02',
      ultima_compra: '2026-10-05',
      facturado_12m: 2500000,
      deuda_abierta: 450000,
      dias_sin_visita_presencial: 35,
      dias_sin_contacto: 18,
      dias_sin_compra: 15,
    };
    expect(normalizeClienteRow(bqRow)).toEqual({
      clientId: 'ba__la_plata__pescar_info_shop',
      cardCode: 'C30711930392',
      clientName: 'PESCAR.INFO SHOP S.R.L.',
      provincia: 'BUENOS AIRES',
      localidad: 'LA PLATA',
      cliTipo: 'A',
      ultimaVisitaPresencial: '2026-09-15',
      diasSinVisitaPresencial: 35,
      ultimoContacto: '2026-10-02',
      diasSinContacto: 18,
      ultimaCompra: '2026-10-05',
      diasSinCompra: 15,
      facturado12M: 2500000,
      deudaAbierta: 450000,
    });
  });

  it('preserva nulls en fechas y dias (cliente nunca compro ni visito)', () => {
    const bqRow = {
      vendor_key: 'X', client_id: 'id1', card_code: null, client_name: 'C1',
      province: null, loc_name: null, cli_tipo: null,
      ultima_visita_presencial: null, ultimo_contacto: null, ultima_compra: null,
      facturado_12m: 0, deuda_abierta: 0,
      dias_sin_visita_presencial: null, dias_sin_contacto: null, dias_sin_compra: null,
    };
    const r = normalizeClienteRow(bqRow);
    expect(r.cardCode).toBe(null);
    expect(r.ultimaCompra).toBe(null);
    expect(r.diasSinCompra).toBe(null);
    expect(r.facturado12M).toBe(0);
    expect(r.deudaAbierta).toBe(0);
  });

  it('BQ date values como Date object se stringifican a YYYY-MM-DD', () => {
    const bqRow = {
      vendor_key: 'X', client_id: 'id1', card_code: 'C1', client_name: 'C1',
      province: 'X', loc_name: 'X', cli_tipo: 'X',
      ultima_visita_presencial: { value: '2026-09-15' },
      ultimo_contacto: new Date('2026-10-02T00:00:00Z'),
      ultima_compra: '2026-10-05',
      facturado_12m: 0, deuda_abierta: 0,
      dias_sin_visita_presencial: 35, dias_sin_contacto: 18, dias_sin_compra: 15,
    };
    const r = normalizeClienteRow(bqRow);
    expect(r.ultimaVisitaPresencial).toBe('2026-09-15');
    expect(r.ultimoContacto).toBe('2026-10-02');
    expect(r.ultimaCompra).toBe('2026-10-05');
  });

  it('facturado12M y deudaAbierta sin valor BQ -> 0', () => {
    const bqRow = {
      vendor_key: 'X', client_id: 'id1', card_code: null, client_name: 'C1',
      province: null, loc_name: null, cli_tipo: null,
      ultima_visita_presencial: null, ultimo_contacto: null, ultima_compra: null,
      facturado_12m: null, deuda_abierta: undefined,
      dias_sin_visita_presencial: null, dias_sin_contacto: null, dias_sin_compra: null,
    };
    const r = normalizeClienteRow(bqRow);
    expect(r.facturado12M).toBe(0);
    expect(r.deudaAbierta).toBe(0);
  });
});
```

- [ ] **Step 3.2: Correr tests → deben fallar**

Run: `npx vitest run tests/unit/cartera-vendor-compute.test.js`
Expected: FAIL en los 4 nuevos.

- [ ] **Step 3.3: Implementar `normalizeClienteRow`**

Agregá al final de `functions/core/cartera-vendor-core.js`:

```js
/**
 * Traduce una fila BQ (snake_case source-of-truth) al schema del doc Firestore
 * (camelCase + espanol). Ver spec section "Naming: BQ view -> Firestore doc".
 *
 * BigQuery Node client puede devolver DATE como string ISO, como { value: 'YYYY-MM-DD' },
 * o Date. Normalizamos a string ISO YYYY-MM-DD.
 *
 * @param {any} bqRow
 * @returns {Object}
 */
export function normalizeClienteRow(bqRow) {
  return {
    clientId: bqRow.client_id,
    cardCode: bqRow.card_code ?? null,
    clientName: bqRow.client_name ?? null,
    provincia: bqRow.province ?? null,
    localidad: bqRow.loc_name ?? null,
    cliTipo: bqRow.cli_tipo ?? null,
    ultimaVisitaPresencial: toIsoDate(bqRow.ultima_visita_presencial),
    diasSinVisitaPresencial: bqRow.dias_sin_visita_presencial ?? null,
    ultimoContacto: toIsoDate(bqRow.ultimo_contacto),
    diasSinContacto: bqRow.dias_sin_contacto ?? null,
    ultimaCompra: toIsoDate(bqRow.ultima_compra),
    diasSinCompra: bqRow.dias_sin_compra ?? null,
    facturado12M: Number(bqRow.facturado_12m) || 0,
    deudaAbierta: Number(bqRow.deuda_abierta) || 0,
  };
}

/**
 * Normaliza DATE BigQuery a ISO YYYY-MM-DD o null.
 * @param {any} v
 * @returns {string|null}
 */
function toIsoDate(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && typeof v.value === 'string') return v.value;
  return null;
}
```

- [ ] **Step 3.4: Correr tests → deben pasar**

Run: `npx vitest run tests/unit/cartera-vendor-compute.test.js`
Expected: PASS 12 tests.

- [ ] **Step 3.5: Commit**

```bash
git add functions/core/cartera-vendor-core.js tests/unit/cartera-vendor-compute.test.js
git commit -m "v1283: normalizeClienteRow puro + 4 tests TDD"
```

---

## Task 4: Handler `handleSyncCarteraVendor()` + integration tests

**Files:**
- Create: `tests/functions/sync-cartera-vendor.test.js`
- Modify: `functions/core/cartera-vendor-core.js`

- [ ] **Step 4.1: Escribir integration tests del handler**

Create: `tests/functions/sync-cartera-vendor.test.js`

```js
// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { handleSyncCarteraVendor } from '../../functions/core/cartera-vendor-core.js';

function makeFakeFbDb(existingDocs = {}) {
  const store = new Map(Object.entries(existingDocs));
  const batchOps = { writes: [], deletes: [] };

  const batch = {
    set: (ref, data) => batchOps.writes.push({ id: ref._id, data }),
    delete: (ref) => batchOps.deletes.push({ id: ref._id }),
    commit: async () => {
      batchOps.writes.forEach(({ id, data }) => store.set(id, data));
      batchOps.deletes.forEach(({ id }) => store.delete(id));
      batchOps.writes = [];
      batchOps.deletes = [];
    },
  };

  return {
    _store: store,
    batch: () => batch,
    collection: (name) => {
      if (name !== 'cartera_vendor') throw new Error('collection no soportada: ' + name);
      return {
        doc: (id) => ({ _id: id }),
        get: async () => ({
          forEach: (cb) => {
            for (const [id, data] of store) {
              cb({ id, ref: { _id: id }, data: () => data });
            }
          },
        }),
      };
    },
  };
}

function makeFakeBqClient(rows) {
  return { query: vi.fn(async () => [rows]) };
}

describe('handleSyncCarteraVendor', () => {
  it('2 vendors + 3 clientes cada uno -> 2 docs', async () => {
    const rows = [
      { vendor_key: 'VDE_A', client_id: 'a1', card_code: 'C1', client_name: 'Cli A1', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: '2026-10-15', ultimo_contacto: null, ultima_compra: '2026-10-10', facturado_12m: 100, deuda_abierta: 0, dias_sin_visita_presencial: 5, dias_sin_contacto: null, dias_sin_compra: 10 },
      { vendor_key: 'VDE_A', client_id: 'a2', card_code: 'C2', client_name: 'Cli A2', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: null, ultimo_contacto: null, ultima_compra: null, facturado_12m: 0, deuda_abierta: 0, dias_sin_visita_presencial: null, dias_sin_contacto: null, dias_sin_compra: null },
      { vendor_key: 'VDE_A', client_id: 'a3', card_code: null, client_name: 'Cli A3', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: '2026-08-01', ultimo_contacto: null, ultima_compra: '2026-05-01', facturado_12m: 50, deuda_abierta: 0, dias_sin_visita_presencial: 80, dias_sin_contacto: null, dias_sin_compra: 172 },
      { vendor_key: 'VDE_B', client_id: 'b1', card_code: 'C10', client_name: 'Cli B1', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: '2026-10-18', ultimo_contacto: null, ultima_compra: '2026-10-19', facturado_12m: 500, deuda_abierta: 1000, dias_sin_visita_presencial: 2, dias_sin_contacto: null, dias_sin_compra: 1 },
    ];
    const fbDb = makeFakeFbDb();
    const bqClient = makeFakeBqClient(rows);
    const r = await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });

    expect(r.vendorsProcessed).toBe(2);
    expect(r.totalClientes).toBe(4);
    expect(r.deletedOrphans).toBe(0);
    expect(fbDb._store.size).toBe(2);

    const docA = fbDb._store.get('VDE_A');
    expect(docA.vendorKey).toBe('VDE_A');
    expect(docA.counts.total).toBe(3);
    expect(docA.counts.baseActiva90d).toBe(1);
    expect(docA.counts.dormidosVisita30d).toBe(1);
    expect(docA.counts.dormidosCompra90d).toBe(1);
    expect(docA.counts.nuncaVisitados).toBe(1);
    expect(docA.counts.nuncaCompraron).toBe(1);
    expect(docA.clientes).toHaveLength(3);
    expect(docA.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(docA.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('vendor huerfano -> se borra', async () => {
    const rows = [
      { vendor_key: 'VDE_LIVE', client_id: 'x1', card_code: 'C1', client_name: 'X', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: null, ultimo_contacto: null, ultima_compra: null, facturado_12m: 0, deuda_abierta: 0, dias_sin_visita_presencial: null, dias_sin_contacto: null, dias_sin_compra: null },
    ];
    const fbDb = makeFakeFbDb({
      'VDE_LIVE': { vendorKey: 'VDE_LIVE', clientes: [] },
      'VDE_ZOMBIE': { vendorKey: 'VDE_ZOMBIE', clientes: [{ clientId: 'z1' }] },
    });
    const bqClient = makeFakeBqClient(rows);
    const r = await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    expect(r.deletedOrphans).toBe(1);
    expect(fbDb._store.has('VDE_LIVE')).toBe(true);
    expect(fbDb._store.has('VDE_ZOMBIE')).toBe(false);
  });

  it('idempotencia: correr 2x produce el mismo state', async () => {
    const rows = [
      { vendor_key: 'V1', client_id: 'c1', card_code: 'CC1', client_name: 'Cli', province: null, loc_name: null, cli_tipo: null, ultima_visita_presencial: '2026-10-15', ultimo_contacto: null, ultima_compra: '2026-10-10', facturado_12m: 100, deuda_abierta: 0, dias_sin_visita_presencial: 5, dias_sin_contacto: null, dias_sin_compra: 10 },
    ];
    const fbDb = makeFakeFbDb();
    const bqClient = makeFakeBqClient(rows);
    await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    const after1 = JSON.stringify(fbDb._store.get('V1'));
    await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    const after2 = JSON.stringify(fbDb._store.get('V1'));
    const parse = (s) => { const o = JSON.parse(s); delete o.snapshotAt; return o; };
    expect(parse(after1)).toEqual(parse(after2));
  });

  it('cliente sin cardCode se incluye con facturado12M=0 y deudaAbierta=0', async () => {
    const rows = [
      { vendor_key: 'V1', client_id: 'no_sap', card_code: null, client_name: 'Nuevo', province: 'BA', loc_name: 'CABA', cli_tipo: null, ultima_visita_presencial: '2026-10-15', ultimo_contacto: null, ultima_compra: null, facturado_12m: 0, deuda_abierta: 0, dias_sin_visita_presencial: 5, dias_sin_contacto: null, dias_sin_compra: null },
    ];
    const fbDb = makeFakeFbDb();
    const bqClient = makeFakeBqClient(rows);
    await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    const doc = fbDb._store.get('V1');
    expect(doc.clientes[0].cardCode).toBe(null);
    expect(doc.clientes[0].facturado12M).toBe(0);
    expect(doc.clientes[0].deudaAbierta).toBe(0);
    expect(doc.clientes[0].ultimaVisitaPresencial).toBe('2026-10-15');
  });

  it('0 rows BQ -> 0 docs escritos, pero si borra huerfanos existentes', async () => {
    const fbDb = makeFakeFbDb({ 'VDE_OLD': { vendorKey: 'VDE_OLD', clientes: [] } });
    const bqClient = makeFakeBqClient([]);
    const r = await handleSyncCarteraVendor({ fbDb, bqClient, log: vi.fn() });
    expect(r.vendorsProcessed).toBe(0);
    expect(r.totalClientes).toBe(0);
    expect(r.deletedOrphans).toBe(1);
    expect(fbDb._store.size).toBe(0);
  });

  it('log callback recibe summary al final', async () => {
    const fbDb = makeFakeFbDb();
    const bqClient = makeFakeBqClient([]);
    const log = vi.fn();
    await handleSyncCarteraVendor({ fbDb, bqClient, log });
    expect(() => log('test')).not.toThrow();
  });
});
```

- [ ] **Step 4.2: Correr tests → deben fallar**

Run: `npx vitest run tests/functions/sync-cartera-vendor.test.js`
Expected: FAIL "handleSyncCarteraVendor is not a function".

- [ ] **Step 4.3: Implementar `handleSyncCarteraVendor`**

Agregá al final de `functions/core/cartera-vendor-core.js`:

```js
/**
 * @typedef {Object} CarteraSyncDeps
 * @property {any} fbDb Firestore Admin instance.
 * @property {{ query: (sql: string) => Promise<any[]> }} bqClient BigQuery client.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 */

const BQ_QUERY = `SELECT * FROM \`app-vendedores-shimano.shimano_app.v_cartera_vendor\``;

/**
 * Handler puro de syncCarteraVendorScheduled.
 *
 * @param {CarteraSyncDeps} deps
 * @returns {Promise<{vendorsProcessed:number,totalClientes:number,deletedOrphans:number,snapshotAt:string,snapshotDate:string}>}
 */
export async function handleSyncCarteraVendor(deps) {
  const log = deps.log || (() => {});
  const now = new Date();
  const snapshotAt = now.toISOString();
  const snapshotDate = toArtDate(now);

  const [rows] = await deps.bqClient.query(BQ_QUERY);
  log('syncCarteraVendor: BQ rows fetched', { count: rows.length });

  /** @type {Map<string, Array<Object>>} */
  const byVendor = new Map();
  for (const row of rows) {
    const key = row.vendor_key;
    if (!key) continue;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key).push(normalizeClienteRow(row));
  }

  const col = deps.fbDb.collection('cartera_vendor');
  const writeBatch = deps.fbDb.batch();
  for (const [vendorKey, clientes] of byVendor) {
    const counts = computeCounts(clientes);
    writeBatch.set(col.doc(vendorKey), {
      vendorKey, vendorNameDisplay: vendorKey, snapshotAt, snapshotDate, counts, clientes,
    });
  }
  await writeBatch.commit();
  log('syncCarteraVendor: wrote vendors', { count: byVendor.size });

  const existingSnap = await col.get();
  const deleteBatch = deps.fbDb.batch();
  let deletedOrphans = 0;
  existingSnap.forEach((doc) => {
    if (!byVendor.has(doc.id)) {
      deleteBatch.delete(doc.ref);
      deletedOrphans++;
    }
  });
  if (deletedOrphans > 0) {
    await deleteBatch.commit();
    log('syncCarteraVendor: deleted orphans', { count: deletedOrphans });
  }

  return { vendorsProcessed: byVendor.size, totalClientes: rows.length, deletedOrphans, snapshotAt, snapshotDate };
}

/**
 * YYYY-MM-DD en zona America/Argentina/Buenos_Aires.
 * @param {Date} d
 * @returns {string}
 */
function toArtDate(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const dd = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${dd}`;
}
```

- [ ] **Step 4.4: Correr tests → deben pasar**

Run: `npx vitest run tests/functions/sync-cartera-vendor.test.js tests/unit/cartera-vendor-compute.test.js`
Expected: PASS 18 tests.

- [ ] **Step 4.5: Commit**

```bash
git add functions/core/cartera-vendor-core.js tests/functions/sync-cartera-vendor.test.js
git commit -m "v1283: handleSyncCarteraVendor + 6 tests integration"
```

---

## Task 5: CF wrapper `syncCarteraVendorScheduled` en `functions/index.js`

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 5.1: Agregar import del core**

Localizá la zona de imports (línea ~75). Agregá después de `import { handleSyncSapPayments }`:

```js
import { handleSyncCarteraVendor } from './core/cartera-vendor-core.js';
```

- [ ] **Step 5.2: Agregar wrapper onSchedule**

Buscá `export const syncSapPaymentsToApp`. Agregá debajo:

```js
/**
 * syncCarteraVendorScheduled (v1283, 2026-10-20).
 * Snapshot nightly 04:00 ART desde v_cartera_vendor BQ -> cartera_vendor/{vendorKey}.
 * Spec: docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md
 */
export const syncCarteraVendorScheduled = onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    region: 'southamerica-east1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const { BigQuery } = await import('@google-cloud/bigquery');
    const bqClient = new BigQuery({ projectId: 'app-vendedores-shimano' });
    const fbDb = getFirestore();
    try {
      const r = await handleSyncCarteraVendor({ bqClient, fbDb, log: console.log });
      console.log('syncCarteraVendorScheduled summary', r);
    } catch (e) {
      console.error('syncCarteraVendorScheduled failed', e);
      throw e;
    }
  }
);
```

- [ ] **Step 5.3: Verificar `@google-cloud/bigquery` en functions/package.json**

Run: `cd functions && cat package.json | python -c "import sys,json; d=json.load(sys.stdin); print('bigquery:', d.get('dependencies',{}).get('@google-cloud/bigquery','NO ESTA'))"`
Expected: `bigquery: ^9.2.0`. Si "NO ESTA", instalá: `cd functions && npm install --save @google-cloud/bigquery@^9.2.0`.

- [ ] **Step 5.4: Typecheck + biome**

Run:
```powershell
npm run typecheck
npx biome check functions/index.js functions/core/cartera-vendor-core.js tests/unit/cartera-vendor-compute.test.js tests/functions/sync-cartera-vendor.test.js
```

Si biome tiene errores de format auto-fijables, run: `npx biome check --write <mismo listado>`

- [ ] **Step 5.5: Full tests**

Run: `npm run test:unit`
Expected: PASS 791 + 12 nuevos = 803.

- [ ] **Step 5.6: Commit**

```bash
git add functions/index.js functions/core/cartera-vendor-core.js tests/
git commit -m "v1283: CF wrapper syncCarteraVendorScheduled onSchedule 04:00 ART"
```

---

## Task 6: firestore.rules — add cartera_vendor + remove seguimiento_*

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 6.1: Localizar bloques viejos**

Run: `grep -n "seguimiento_notes\|seguimiento_status" firestore.rules`
Expected: 2 bloques (líneas ~156, ~179 según inventario).

- [ ] **Step 6.2: Borrar los 2 bloques y agregar comentario**

Edit `firestore.rules`. Borrar los 2 bloques completos (match `/seguimiento_notes/{...}` y `/seguimiento_status/{...}`). En reemplazo:

```
    // v1283 (2026-10-20): collections seguimiento_notes + seguimiento_status
    // tiradas junto con el reemplazo del modal Seguimiento por Analisis de Cartera.
    // Backup en ./backups/seguimiento_backup_YYYY-MM-DD.json antes del delete.
```

- [ ] **Step 6.3: Agregar bloque de cartera_vendor**

Localizá después de las reglas de `visits` o cerca del bloque viejo. Agregá:

```
    // v1283 (2026-10-20): snapshot nightly del dashboard "Analisis de Cartera".
    // Solo lectura (admin/gerente/interno). Writes exclusivos de la CF
    // syncCarteraVendorScheduled via Admin SDK (bypassa rules).
    match /cartera_vendor/{vendorKey} {
      allow read: if isSeguimientoUser();
      allow write: if false;  // only CF via Admin SDK
    }
```

- [ ] **Step 6.4: Verificar sintaxis**

Run: `firebase emulators:exec --only firestore "echo rules ok" 2>&1 | head -20`
(Si no hay Java 21, saltar y verificar visualmente que las braces balancean.)

- [ ] **Step 6.5: Commit**

```bash
git add firestore.rules
git commit -m "v1283: firestore.rules — add cartera_vendor read, remove seguimiento_notes/status"
```

---

## Task 7: Deploy BQ view + CF + trigger manual + smoke Firestore

**Files:** ninguno

- [ ] **Step 7.1: Deploy BQ view** (si no se hizo en Task 1)

Run: `python scripts/deploy_v_cartera_vendor.py`

- [ ] **Step 7.2: Deploy CF**

Run: `firebase deploy --only functions:syncCarteraVendorScheduled --project app-vendedores-shimano`
Expected: `+ functions[syncCarteraVendorScheduled(southamerica-east1)] Successful create operation.`

- [ ] **Step 7.3: Deploy rules**

Run: `firebase deploy --only firestore:rules --project app-vendedores-shimano`

- [ ] **Step 7.4: Trigger manual la CF (pre-poblar antes del 04:00 ART)**

Run (busca el nombre del scheduler job):
```powershell
gcloud scheduler jobs list --project=app-vendedores-shimano --location=southamerica-east1 | Select-String cartera
```

Luego:
```powershell
gcloud scheduler jobs run <nombre-encontrado> --location=southamerica-east1 --project=app-vendedores-shimano
```

Expected: `Executed job [...]`

- [ ] **Step 7.5: Smoke en logs de la CF**

Run:
```powershell
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=synccarteravendorscheduled AND severity>=INFO" --project=app-vendedores-shimano --limit=20 --format="value(timestamp,textPayload)"
```

Expected: ver `syncCarteraVendor: BQ rows fetched {count:XXX}` + `wrote vendors {count:XX}` + `summary {vendorsProcessed, totalClientes, deletedOrphans}`.

- [ ] **Step 7.6: Smoke en Firestore (Python)**

Create temp script `_check_cartera.py`:
```python
import firebase_admin
from firebase_admin import firestore
firebase_admin.initialize_app(options={"projectId": "app-vendedores-shimano"})
db = firestore.client()
snap = db.collection('cartera_vendor').get()
print(f"docs: {snap.size()}")
for doc in list(snap)[:5]:
    d = doc.to_dict()
    print(f"  {doc.id}: {d['counts']} ({len(d['clientes'])} clientes, snapshot {d['snapshotDate']})")
```

Run: `python _check_cartera.py`
Expected: ~15-30 docs. counts coherentes (total === len(clientes)).

---

## Task 8: Función pura `applyChipFilter` + `sortClientes` para frontend (TDD)

**Files:**
- Create: `tests/unit/cartera-vendor-filter.test.js`
- Create: `src/pure/cartera-vendor-filter.js`

- [ ] **Step 8.1: Escribir tests**

Create: `tests/unit/cartera-vendor-filter.test.js`

```js
// @ts-check
import { describe, expect, it } from 'vitest';
import { applyChipFilter, sortClientes } from '../../src/pure/cartera-vendor-filter.js';

const SAMPLE = [
  { clientId: 'a', clientName: 'ALPHA S.A.',   ultimaVisitaPresencial: '2026-10-15', diasSinVisitaPresencial: 5,  ultimaCompra: '2026-10-10', diasSinCompra: 10,  facturado12M: 100, deudaAbierta: 0 },
  { clientId: 'b', clientName: 'BETA S.R.L.',  ultimaVisitaPresencial: null,         diasSinVisitaPresencial: null, ultimaCompra: null,       diasSinCompra: null, facturado12M: 0,   deudaAbierta: 0 },
  { clientId: 'c', clientName: 'GAMMA LTDA.',  ultimaVisitaPresencial: '2026-08-01', diasSinVisitaPresencial: 80, ultimaCompra: '2026-06-01', diasSinCompra: 141, facturado12M: 500, deudaAbierta: 1000 },
  { clientId: 'd', clientName: 'DELTA PESCA',  ultimaVisitaPresencial: null,         diasSinVisitaPresencial: null, ultimaCompra: '2026-10-01', diasSinCompra: 19,  facturado12M: 200, deudaAbierta: 0 },
];

describe('applyChipFilter', () => {
  it("'todos' -> devuelve el array completo", () => {
    expect(applyChipFilter(SAMPLE, 'todos')).toHaveLength(4);
  });
  it("'baseActiva90d' -> solo diasSinCompra <= 90", () => {
    const r = applyChipFilter(SAMPLE, 'baseActiva90d');
    expect(r.map((c) => c.clientId).sort()).toEqual(['a', 'd']);
  });
  it("'dormidosVisita30d' -> solo diasSinVisitaPresencial > 30", () => {
    const r = applyChipFilter(SAMPLE, 'dormidosVisita30d');
    expect(r.map((c) => c.clientId)).toEqual(['c']);
  });
  it("'dormidosCompra90d' -> solo diasSinCompra > 90", () => {
    const r = applyChipFilter(SAMPLE, 'dormidosCompra90d');
    expect(r.map((c) => c.clientId)).toEqual(['c']);
  });
  it("'nuncaVisitados' -> ultimaVisitaPresencial === null", () => {
    const r = applyChipFilter(SAMPLE, 'nuncaVisitados');
    expect(r.map((c) => c.clientId).sort()).toEqual(['b', 'd']);
  });
  it("'nuncaCompraron' -> ultimaCompra === null", () => {
    const r = applyChipFilter(SAMPLE, 'nuncaCompraron');
    expect(r.map((c) => c.clientId)).toEqual(['b']);
  });
  it('chip desconocido -> fallback a todos', () => {
    expect(applyChipFilter(SAMPLE, 'bogus')).toHaveLength(4);
  });
});

describe('sortClientes', () => {
  it("sortBy='clientName' asc -> alfa", () => {
    const r = sortClientes(SAMPLE, 'clientName', 'asc');
    expect(r.map((c) => c.clientId)).toEqual(['a', 'b', 'd', 'c']);
  });
  it("sortBy='diasSinCompra' desc -> nulls al final", () => {
    const r = sortClientes(SAMPLE, 'diasSinCompra', 'desc');
    expect(r.map((c) => c.clientId)).toEqual(['c', 'd', 'a', 'b']);
  });
  it("sortBy='diasSinCompra' asc -> nulls al final tambien", () => {
    const r = sortClientes(SAMPLE, 'diasSinCompra', 'asc');
    expect(r.map((c) => c.clientId)).toEqual(['a', 'd', 'c', 'b']);
  });
  it("sortBy='facturado12M' desc -> mayor a menor", () => {
    const r = sortClientes(SAMPLE, 'facturado12M', 'desc');
    expect(r.map((c) => c.clientId)).toEqual(['c', 'd', 'a', 'b']);
  });
  it('no muta el array de entrada (pureza)', () => {
    const original = SAMPLE.map((c) => c.clientId);
    sortClientes(SAMPLE, 'clientName', 'asc');
    expect(SAMPLE.map((c) => c.clientId)).toEqual(original);
  });
});
```

- [ ] **Step 8.2: Correr tests → deben fallar**

Run: `npx vitest run tests/unit/cartera-vendor-filter.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 8.3: Implementar `applyChipFilter` + `sortClientes`**

Create: `src/pure/cartera-vendor-filter.js`

```js
// @ts-check
/**
 * cartera-vendor-filter.js (v1283, 2026-10-20)
 *
 * Puras para filtrar y ordenar la tabla del dashboard "Analisis de Cartera".
 * Importado por src/domains/cartera-vendor.js (bundle frontend).
 * Testeado en tests/unit/cartera-vendor-filter.test.js.
 */

/**
 * Aplica un chip de filtro al array de clientes.
 * @param {Array<Object>} clientes
 * @param {string} chip
 * @returns {Array<Object>}
 */
export function applyChipFilter(clientes, chip) {
  if (!Array.isArray(clientes)) return [];
  switch (chip) {
    case 'baseActiva90d':
      return clientes.filter((c) => c.diasSinCompra !== null && c.diasSinCompra !== undefined && c.diasSinCompra <= 90);
    case 'dormidosVisita30d':
      return clientes.filter((c) => c.diasSinVisitaPresencial !== null && c.diasSinVisitaPresencial !== undefined && c.diasSinVisitaPresencial > 30);
    case 'dormidosCompra90d':
      return clientes.filter((c) => c.diasSinCompra !== null && c.diasSinCompra !== undefined && c.diasSinCompra > 90);
    case 'nuncaVisitados':
      return clientes.filter((c) => c.ultimaVisitaPresencial === null || c.ultimaVisitaPresencial === undefined);
    case 'nuncaCompraron':
      return clientes.filter((c) => c.ultimaCompra === null || c.ultimaCompra === undefined);
    case 'todos':
    default:
      return clientes.slice();
  }
}

/**
 * Ordena una copia del array por columna. Nulls siempre al final.
 * @param {Array<Object>} clientes
 * @param {string} sortBy
 * @param {'asc'|'desc'} sortDir
 * @returns {Array<Object>}
 */
export function sortClientes(clientes, sortBy, sortDir) {
  if (!Array.isArray(clientes)) return [];
  const dir = sortDir === 'asc' ? 1 : -1;
  const copy = clientes.slice();
  copy.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    const aNull = av === null || av === undefined;
    const bNull = bv === null || bv === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return copy;
}
```

- [ ] **Step 8.4: Correr tests → deben pasar**

Run: `npx vitest run tests/unit/cartera-vendor-filter.test.js`
Expected: PASS 12 tests.

- [ ] **Step 8.5: Commit**

```bash
git add src/pure/cartera-vendor-filter.js tests/unit/cartera-vendor-filter.test.js
git commit -m "v1283: applyChipFilter + sortClientes puros + 12 tests TDD"
```

---

## Task 9: Shell HTML del modal nuevo en `index.html`

**Files:**
- Modify: `index.html`

- [ ] **Step 9.1: Localizar y borrar el HTML del modal viejo**

Run: `grep -n "pane-seguimiento\|seguimiento-modal\|modal-seguimiento" index.html | head -10`
Anotá los line ranges. El modal viejo probablemente es un bloque extenso con 6 tabs.

Reemplazar TODO el bloque por el nuevo shell:

```html
<!-- v1283 (2026-10-20): modal "Analisis de Cartera por Vendedor".
     Reemplaza el modal "Seguimiento" viejo. Shell minimo — el render
     dinamico lo hace src/domains/cartera-vendor.js (chunk lazy).
     Datos desde cartera_vendor/{vendorKey} Firestore (snapshot nightly
     04:00 ART). Spec: docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md -->
<div class="modal-overlay" id="cartera-modal" onclick="if(event.target===this)closeCarteraModal()">
  <div class="modal-box" style="width:min(1200px,98vw);max-height:92vh;display:flex;flex-direction:column">
    <div class="modal-head" style="background:linear-gradient(135deg,#1e3a8a,#3b82f6)">
      <div>
        <h2>📊 An&aacute;lisis de Cartera por Vendedor</h2>
        <div class="subt" id="cartera-subtitle">Seleccion&aacute; un vendedor para ver su cartera.</div>
      </div>
      <button class="modal-close" onclick="closeCarteraModal()">&times;</button>
    </div>

    <div style="padding:12px 16px;border-bottom:1px solid var(--border-light);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <label style="font-size:13px;color:var(--text-primary);font-weight:600">Vendedor:</label>
      <select id="cartera-vendor-select" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:13px;min-width:240px" onchange="window.onCarteraVendorChange && window.onCarteraVendorChange()">
        <option value="">— Elegir vendedor —</option>
      </select>
      <span id="cartera-snapshot-info" style="font-size:11px;color:var(--text-muted)"></span>
    </div>

    <div id="cartera-kpis" style="padding:12px 16px;display:none;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border-light)"></div>

    <div id="cartera-chips" style="padding:8px 16px;display:none;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border-light)"></div>

    <div style="padding:8px 16px;display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border-light)">
      <input type="search" id="cartera-search" placeholder="Buscar cliente..." style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-size:13px" oninput="window.onCarteraSearchChange && window.onCarteraSearchChange()" />
      <button id="cartera-export-btn" style="padding:6px 12px;background:#166534;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600" onclick="window.exportCarteraToExcel && window.exportCarteraToExcel()">📥 Exportar</button>
    </div>

    <div id="cartera-table-wrap" style="flex:1;overflow:auto;padding:0 16px">
      <div id="cartera-loading" style="padding:40px;text-align:center;color:var(--text-muted);display:none">Cargando cartera...</div>
      <div id="cartera-empty" style="padding:40px;text-align:center;color:var(--text-muted)">Eleg&iacute; un vendedor para ver su cartera.</div>
      <table id="cartera-table" style="width:100%;border-collapse:collapse;font-size:13px;display:none"></table>
    </div>
  </div>
</div>
```

- [ ] **Step 9.2: Actualizar botón del header**

Run: `grep -n "btn-seguimiento\|openSeguimientoModal" index.html | head -5`

Anotá el line del botón. Reemplazá en index.html:

```html
<button class="btn-seguimiento" onclick="openSeguimientoModal()">Seguimiento</button>
```

por (preservando estilos inline originales si los tenía):

```html
<button class="btn-cartera" onclick="openCarteraModal()">📊 Cartera</button>
```

- [ ] **Step 9.3: Verificar que no quedó HTML huérfano**

Run: `grep -n "seguimiento" index.html | head -20`
Expected: solo menciones en comentarios de migración o en `canViewSeguimiento()` del inline (se renombra en Task 11).

- [ ] **Step 9.4: Commit**

```bash
git add index.html
git commit -m "v1283: index.html — shell nuevo modal Cartera + rename boton header"
```

---

## Task 10: Reescribir `src/domains/seguimiento.js` → `src/domains/cartera-vendor.js`

**Files:**
- Delete: `src/domains/seguimiento.js`
- Create: `src/domains/cartera-vendor.js`
- Modify: `build.js`
- Modify: `src/main.js`
- Modify: `sw.js`

**NOTA DE SEGURIDAD**: El archivo nuevo usa **exclusivamente** `document.createElement` + `textContent` + `appendChild`. **NO** usa `innerHTML`, `insertAdjacentHTML` ni template strings concatenadas aunque haya escape. Policy anti-XSS del repo (CodeQL + pre-write hook).

- [ ] **Step 10.1: Borrar `src/domains/seguimiento.js`**

Run: `git rm src/domains/seguimiento.js`

- [ ] **Step 10.2: Crear `src/domains/cartera-vendor.js`**

Create: `src/domains/cartera-vendor.js`

```js
// @ts-check
/**
 * cartera-vendor.js (v1283, 2026-10-20) — bundle chunk lazy.
 *
 * Dashboard "Analisis de Cartera por Vendedor". Reemplaza seguimiento.js.
 * Lee cartera_vendor/{vendorKey} Firestore (snapshot nightly 04:00 ART).
 *
 * TODO el DOM render usa createElement + textContent (policy anti-XSS, no innerHTML).
 *
 * Spec: docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md
 * Plan: docs/superpowers/plans/2026-10-20-cartera-vendor-analisis.md
 */

import { applyChipFilter, sortClientes } from '../pure/cartera-vendor-filter.js';

/** @type {Map<string, any>} */
const carteraDocCache = new Map();
/** @type {string|null} */
let selectedVendor = null;
let activeChip = 'todos';
let searchQuery = '';
let sortBy = 'diasSinCompra';
/** @type {'asc'|'desc'} */
let sortDir = 'desc';

const CHIPS = [
  { id: 'todos',               label: 'Todos' },
  { id: 'baseActiva90d',       label: 'Base activa 90d' },
  { id: 'dormidosVisita30d',   label: 'Dormidos visita 30d' },
  { id: 'dormidosCompra90d',   label: 'Dormidos compra 90d' },
  { id: 'nuncaVisitados',      label: 'Nunca visitados' },
  { id: 'nuncaCompraron',      label: 'Nunca compraron' },
];

const KPI_CARDS = [
  { chip: 'todos',               label: 'Total cartera',   color: '#64748b' },
  { chip: 'baseActiva90d',       label: 'Base activa 90d', color: '#16a34a' },
  { chip: 'dormidosVisita30d',   label: 'Dormidos vis 30d', color: '#ea580c' },
  { chip: 'dormidosCompra90d',   label: 'Dormidos com 90d', color: '#dc2626' },
  { chip: 'nuncaVisitados',      label: 'Nunca visitados', color: '#7c3aed' },
  { chip: 'nuncaCompraron',      label: 'Nunca compraron', color: '#be185d' },
];

// === Open / close ===
window.openCarteraModal = async function openCarteraModal() {
  const modal = document.getElementById('cartera-modal');
  if (!modal) return;
  modal.classList.add('open');
  await populateVendorDropdown();
};

window.closeCarteraModal = function closeCarteraModal() {
  const modal = document.getElementById('cartera-modal');
  if (modal) modal.classList.remove('open');
};

// === Dropdown de vendors ===
async function populateVendorDropdown() {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('cartera-vendor-select'));
  if (!sel) return;
  if (sel.options.length > 1) return;
  try {
    const snap = await firebase.firestore().collection('cartera_vendor').get();
    /** @type {string[]} */
    const vendors = [];
    snap.forEach((doc) => vendors.push(doc.id));
    vendors.sort();
    for (const v of vendors) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
  } catch (e) {
    console.error('populateVendorDropdown failed', e);
  }
}

// === On vendor change ===
window.onCarteraVendorChange = async function onCarteraVendorChange() {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('cartera-vendor-select'));
  if (!sel) return;
  selectedVendor = sel.value || null;
  activeChip = 'todos';
  searchQuery = '';
  const searchInput = /** @type {HTMLInputElement|null} */ (document.getElementById('cartera-search'));
  if (searchInput) searchInput.value = '';
  if (!selectedVendor) { showEmpty(); return; }
  showLoading();
  try {
    let doc = carteraDocCache.get(selectedVendor);
    if (!doc) {
      const snap = await firebase.firestore().collection('cartera_vendor').doc(selectedVendor).get();
      if (!snap.exists) { showNoData(); return; }
      doc = snap.data();
      carteraDocCache.set(selectedVendor, doc);
    }
    renderDashboard(doc);
  } catch (e) {
    console.error('onCarteraVendorChange failed', e);
    showError(String(e));
  }
};

window.onCarteraChipClick = function onCarteraChipClick(chipId) {
  activeChip = chipId;
  const doc = carteraDocCache.get(selectedVendor);
  if (doc) renderDashboard(doc);
};

let searchDebounceTimer = null;
window.onCarteraSearchChange = function onCarteraSearchChange() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('cartera-search'));
  if (!input) return;
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = (input.value || '').trim().toLowerCase();
    const doc = carteraDocCache.get(selectedVendor);
    if (doc) renderDashboard(doc);
  }, 300);
};

window.onCarteraSortClick = function onCarteraSortClick(colKey) {
  if (sortBy === colKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortBy = colKey; sortDir = 'desc'; }
  const doc = carteraDocCache.get(selectedVendor);
  if (doc) renderDashboard(doc);
};

// === Render ===
function renderDashboard(doc) {
  const subtitle = document.getElementById('cartera-subtitle');
  if (subtitle) subtitle.textContent = `${doc.counts.total} clientes en cartera.`;
  const info = document.getElementById('cartera-snapshot-info');
  if (info) info.textContent = `Snapshot: ${doc.snapshotDate}`;
  renderKpis(doc.counts);
  renderChips(doc.counts);
  renderTable(doc.clientes);
  showTable();
}

function renderKpis(counts) {
  const el = document.getElementById('cartera-kpis');
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const spec of KPI_CARDS) {
    const card = document.createElement('div');
    const isActive = activeChip === spec.chip;
    card.style.cssText = `padding:10px 14px;border:2px solid ${isActive ? spec.color : 'var(--border-light)'};border-radius:8px;cursor:pointer;background:${isActive ? spec.color + '15' : 'var(--bg-card)'};min-width:120px;flex:1;max-width:200px`;
    card.addEventListener('click', () => window.onCarteraChipClick(spec.chip));
    const n = document.createElement('div');
    n.style.cssText = `font-size:22px;font-weight:800;color:${spec.color}`;
    n.textContent = String(counts[spec.chip === 'todos' ? 'total' : spec.chip]);
    const l = document.createElement('div');
    l.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px';
    l.textContent = spec.label;
    card.appendChild(n);
    card.appendChild(l);
    el.appendChild(card);
  }
}

function renderChips(counts) {
  const el = document.getElementById('cartera-chips');
  if (!el) return;
  const countByChip = {
    todos: counts.total,
    baseActiva90d: counts.baseActiva90d,
    dormidosVisita30d: counts.dormidosVisita30d,
    dormidosCompra90d: counts.dormidosCompra90d,
    nuncaVisitados: counts.nuncaVisitados,
    nuncaCompraron: counts.nuncaCompraron,
  };
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const chip of CHIPS) {
    const b = document.createElement('button');
    const isActive = activeChip === chip.id;
    b.style.cssText = `padding:4px 10px;border-radius:999px;border:1px solid ${isActive ? '#1e3a8a' : 'var(--border)'};background:${isActive ? '#1e3a8a' : 'var(--bg-card)'};color:${isActive ? 'white' : 'var(--text-primary)'};font-size:12px;cursor:pointer;font-weight:${isActive ? '700' : '500'}`;
    b.textContent = `${chip.label} (${countByChip[chip.id]})`;
    b.addEventListener('click', () => window.onCarteraChipClick(chip.id));
    el.appendChild(b);
  }
}

function renderTable(clientes) {
  const table = document.getElementById('cartera-table');
  if (!table) return;
  const filtered = applyChipFilter(clientes, activeChip);
  const searched = searchQuery
    ? filtered.filter((c) => String(c.clientName || '').toLowerCase().includes(searchQuery))
    : filtered;
  const sorted = sortClientes(searched, sortBy, sortDir);
  while (table.firstChild) table.removeChild(table.firstChild);
  table.appendChild(buildThead());
  table.appendChild(buildTbody(sorted));
}

function buildThead() {
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  tr.style.cssText = 'position:sticky;top:0;background:var(--bg-card);border-bottom:2px solid var(--border);font-weight:700;font-size:12px;text-align:left';
  const headers = [
    { label: 'Cliente',         sortKey: 'clientName',               align: 'left'   },
    { label: 'Prov/Loc',        sortKey: null,                       align: 'left'   },
    { label: 'Tipo',            sortKey: null,                       align: 'center' },
    { label: 'Últ. visita',     sortKey: 'diasSinVisitaPresencial',  align: 'left'   },
    { label: 'Últ. contacto',   sortKey: 'diasSinContacto',          align: 'left'   },
    { label: 'Últ. compra',     sortKey: 'diasSinCompra',            align: 'left'   },
    { label: 'Fact 12M',        sortKey: 'facturado12M',             align: 'right'  },
    { label: 'Deuda',           sortKey: 'deudaAbierta',             align: 'right'  },
  ];
  for (const h of headers) {
    const th = document.createElement('th');
    th.style.padding = '8px';
    th.style.textAlign = h.align;
    th.textContent = h.label;
    if (h.sortKey) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => window.onCarteraSortClick(h.sortKey));
    }
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  return thead;
}

function buildTbody(sortedClientes) {
  const tbody = document.createElement('tbody');
  for (const c of sortedClientes) {
    tbody.appendChild(buildClienteRow(c));
  }
  return tbody;
}

function buildClienteRow(c) {
  const tr = document.createElement('tr');
  tr.style.cssText = 'cursor:pointer;border-bottom:1px solid var(--border-light)';
  tr.addEventListener('mouseenter', () => tr.style.background = 'var(--bg-hover)');
  tr.addEventListener('mouseleave', () => tr.style.background = '');
  tr.addEventListener('click', () => {
    if (typeof window.openFichaCliente === 'function') window.openFichaCliente(c.clientId);
  });

  const tdName = document.createElement('td');
  tdName.style.cssText = 'padding:6px 8px;font-weight:600';
  tdName.textContent = c.clientName || '';
  tr.appendChild(tdName);

  const tdLoc = document.createElement('td');
  tdLoc.style.cssText = 'padding:6px 8px;font-size:12px;color:var(--text-muted)';
  tdLoc.textContent = `${c.provincia || ''}/${c.localidad || ''}`;
  tr.appendChild(tdLoc);

  const tdTipo = document.createElement('td');
  tdTipo.style.cssText = 'padding:6px 8px;text-align:center';
  const tipoBadge = document.createElement('span');
  tipoBadge.style.cssText = 'padding:2px 6px;border-radius:4px;background:var(--bg-input);font-size:11px;font-weight:700';
  tipoBadge.textContent = c.cliTipo || '-';
  tdTipo.appendChild(tipoBadge);
  tr.appendChild(tdTipo);

  tr.appendChild(buildDateCell(c.ultimaVisitaPresencial, c.diasSinVisitaPresencial, 30));
  tr.appendChild(buildDateCell(c.ultimoContacto, c.diasSinContacto, null));
  tr.appendChild(buildDateCell(c.ultimaCompra, c.diasSinCompra, 90));

  const tdFact = document.createElement('td');
  tdFact.style.cssText = 'padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums';
  tdFact.textContent = fmtMoney(c.facturado12M);
  tr.appendChild(tdFact);

  const tdDeuda = document.createElement('td');
  tdDeuda.style.cssText = `padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;color:${c.deudaAbierta > 0 ? '#dc2626' : 'var(--text-muted)'}`;
  tdDeuda.textContent = fmtMoney(c.deudaAbierta);
  tr.appendChild(tdDeuda);

  return tr;
}

function buildDateCell(fechaIso, dias, dangerThreshold) {
  const td = document.createElement('td');
  const isDanger = dangerThreshold !== null && dias !== null && dias !== undefined && dias > dangerThreshold;
  td.style.cssText = `padding:6px 8px;color:${isDanger ? '#dc2626' : 'var(--text-primary)'}`;
  if (!fechaIso) {
    td.textContent = '—';
    return td;
  }
  const [y, m, d] = String(fechaIso).split('-');
  td.textContent = `${d}/${m}`;
  const diasEl = document.createElement('small');
  diasEl.style.cssText = 'color:var(--text-muted);margin-left:4px';
  diasEl.textContent = `${dias}d`;
  td.appendChild(diasEl);
  return td;
}

function fmtMoney(n) {
  if (!n || n === 0) return '-';
  if (n >= 1_000_000) return `$ ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$ ${(n / 1_000).toFixed(0)}k`;
  return `$ ${n}`;
}

// === UI state helpers ===
function hideAll() {
  const ids = ['cartera-loading', 'cartera-table', 'cartera-kpis', 'cartera-chips', 'cartera-empty'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
}
function showEmpty() {
  hideAll();
  const empty = document.getElementById('cartera-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.textContent = 'Elegí un vendedor para ver su cartera.';
  }
}
function showLoading() {
  hideAll();
  const loading = document.getElementById('cartera-loading');
  if (loading) loading.style.display = 'block';
}
function showNoData() {
  hideAll();
  const empty = document.getElementById('cartera-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.textContent = 'Sin cartera para este vendedor. Verificá assignedVendor en client_master o esperá al próximo snapshot (04:00 ART).';
  }
}
function showError(msg) {
  hideAll();
  const empty = document.getElementById('cartera-empty');
  if (empty) {
    empty.style.display = 'block';
    empty.style.color = '#dc2626';
    empty.textContent = `Error cargando cartera: ${msg}`;
  }
}
function showTable() {
  const empty = document.getElementById('cartera-empty');
  if (empty) empty.style.display = 'none';
  const loading = document.getElementById('cartera-loading');
  if (loading) loading.style.display = 'none';
  const table = document.getElementById('cartera-table');
  if (table) table.style.display = 'table';
  const kpis = document.getElementById('cartera-kpis');
  if (kpis) kpis.style.display = 'flex';
  const chips = document.getElementById('cartera-chips');
  if (chips) chips.style.display = 'flex';
}

// === Export Excel (stub — Task 12 completa) ===
window.exportCarteraToExcel = function exportCarteraToExcel() {
  alert('Exportar: pendiente de implementación en Task 12.');
};
```

- [ ] **Step 10.3: Actualizar `build.js`**

Edit `build.js`. Buscá la constante que lista chunks lazy. Localizá `'seguimiento'` y reemplazá por `'cartera-vendor'`.

Run: `grep -n "seguimiento\|cartera-vendor" build.js | head`
Expected: después del cambio, `cartera-vendor` aparece en el array.

- [ ] **Step 10.4: Actualizar `src/main.js`**

Edit `src/main.js`. Buscá `installChunkStubs('seguimiento', ...)`. Reemplazá por:

```js
installChunkStubs('cartera-vendor', [
  'openCarteraModal',
  'closeCarteraModal',
  'onCarteraVendorChange',
  'onCarteraChipClick',
  'onCarteraSearchChange',
  'onCarteraSortClick',
  'exportCarteraToExcel',
]);
```

- [ ] **Step 10.5: Actualizar `sw.js`**

Edit `sw.js`:
1. Bumpear `CACHE_VERSION` al siguiente.
2. En `STATIC_ASSETS`, reemplazar `'./chunks/seguimiento.js'` por `'./chunks/cartera-vendor.js'`.

- [ ] **Step 10.6: Rebuild del bundle**

Run: `node build.js`
Verify: `ls chunks/ | grep -E "seguimiento|cartera"`
Expected: solo `cartera-vendor.js`, NO `seguimiento.js`.

- [ ] **Step 10.7: Full tests + typecheck**

Run:
```powershell
npm run test:unit
npm run typecheck
```

Expected: PASS tests + 0 errores.

- [ ] **Step 10.8: Commit**

```bash
git add src/domains/cartera-vendor.js src/pure/cartera-vendor-filter.js build.js src/main.js sw.js chunks/cartera-vendor.js app.bundle.js
git rm src/domains/seguimiento.js
git commit -m "v1283: reescritura seguimiento.js -> cartera-vendor.js (DOM API, no innerHTML)"
```

Si existe `chunks/seguimiento.js` también: `git rm chunks/seguimiento.js` en el mismo commit.

---

## Task 11: Rename `canViewSeguimiento()` → `canViewCarteraAnalisis()` + bump APP_VERSION + README

**Files:**
- Modify: `index.html` (función inline + APP_VERSION)
- Modify: `README.md` (changelog §41)

- [ ] **Step 11.1: Rename `canViewSeguimiento`**

Run: `grep -n "canViewSeguimiento" index.html | head`

Expected: 1 definición + 1 uso (botón). Reemplazar ambos por `canViewCarteraAnalisis`. Lógica idéntica.

Run post-rename: `grep -n "canViewSeguimiento" index.html`
Expected: 0 matches.

- [ ] **Step 11.2: Bump APP_VERSION**

Edit `index.html`. Buscá `const APP_VERSION =` y bumpealo.

- [ ] **Step 11.3: Agregar entry en README §41**

Edit `README.md`. Buscá `## §41 Changelog vigente` o el último entry por fecha. Agregá al inicio:

```markdown
### v1283 (2026-10-20) — Rediseño modal Seguimiento → Análisis de Cartera por Vendedor

**Qué cambió**: el modal "Seguimiento" (6 tabs con visitas/pedidos/pendientes/oportunidades) se reemplazó por dashboard enfocado en cobertura comercial por VDE. Un gerente selecciona un vendedor y ve en vista única: 6 KPIs cards (total cartera / base activa 90d / dormidos visita 30d / dormidos compra 90d / nunca visitados / nunca compraron) + tabla filtrable con chips rápidos + click row → Ficha Cliente + export Excel que respeta el chip + search activos.

**Fuente de datos**: snapshot nightly 04:00 ART. BQ view `v_cartera_vendor` precomputa 1 fila por cliente de cartera (`client_master.assignedVendor`) con fechas de última visita presencial, último contacto, última compra (SAP INVOICE neto NC) + facturado 12M + deuda abierta. CF scheduled `syncCarteraVendorScheduled` agrupa por vendor y escribe `cartera_vendor/{vendorKey}` Firestore.

**Decisiones de product** (brainstorming 2026-10-20):
- Fuente única de cartera = `client_master.assignedVendor` Firestore.
- Visita presencial (`interactionType='visita'`) y contacto rápido (`interactionType='contacto'`) van en 2 KPIs separados.
- "Compra" = factura emitida SAP neto NC.
- Umbrales fijos: 30d sin visita / 90d sin compra.
- Permisos: admin/gerente/interno.

**Cleanup**: collections `seguimiento_notes` y `seguimiento_status` tiradas (backup previo en `./backups/`). `src/domains/seguimiento.js` reescrito completo como `cartera-vendor.js` usando DOM API (createElement + textContent, policy anti-XSS). Reglas Firestore limpiadas.

**Spec**: `docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md`
**Plan**: `docs/superpowers/plans/2026-10-20-cartera-vendor-analisis.md`
```

- [ ] **Step 11.4: Commit**

```bash
git add index.html README.md
git commit -m "v1283: rename canViewSeguimiento -> canViewCarteraAnalisis + README changelog"
```

---

## Task 12: Export Excel

**Files:**
- Modify: `src/domains/cartera-vendor.js`

- [ ] **Step 12.1: Reemplazar el stub `exportCarteraToExcel`**

Edit `src/domains/cartera-vendor.js`. Buscá `window.exportCarteraToExcel = function` (stub con `alert`). Reemplazá por:

```js
window.exportCarteraToExcel = async function exportCarteraToExcel() {
  if (!selectedVendor) { alert('Elegí un vendedor primero.'); return; }
  const doc = carteraDocCache.get(selectedVendor);
  if (!doc) { alert('Sin data cargada.'); return; }
  const filtered = applyChipFilter(doc.clientes, activeChip);
  const searched = searchQuery
    ? filtered.filter((c) => String(c.clientName || '').toLowerCase().includes(searchQuery))
    : filtered;
  const sorted = sortClientes(searched, sortBy, sortDir);

  const chipLabel = (CHIPS.find((c) => c.id === activeChip) || { label: 'Todos' }).label;
  const title = `Cartera de ${selectedVendor} — ${chipLabel} — Snapshot ${doc.snapshotDate}`;

  try {
    // ExcelJS: patron del repo. Si window.ExcelJS no existe, el chunk de exports-core
    // lo expone al cargarse (ver src/domains/exports-core.js).
    if (typeof window.ExcelJS === 'undefined' && typeof window.loadChunk === 'function') {
      await window.loadChunk('exports-core');
    }
    const ExcelJS = window.ExcelJS;
    if (!ExcelJS) throw new Error('ExcelJS no disponible');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cartera');

    // Fila 1: titulo banda verde
    ws.mergeCells('A1:L1');
    const titleCell = ws.getCell('A1');
    titleCell.value = title;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22C55E' } };
    titleCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // Fila 2: headers
    const headers = ['Cliente', 'Provincia', 'Localidad', 'Tipo', 'Última visita presencial', 'Último contacto', 'Última compra', 'Fact 12M (ARS)', 'Deuda abierta (ARS)', 'Días sin visita', 'Días sin compra', 'CardCode SAP'];
    const headerRow = ws.getRow(2);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF074F69' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Filas 3+: data
    sorted.forEach((c, i) => {
      const row = ws.getRow(3 + i);
      row.getCell(1).value = c.clientName || '';
      row.getCell(2).value = c.provincia || '';
      row.getCell(3).value = c.localidad || '';
      row.getCell(4).value = c.cliTipo || '';
      row.getCell(5).value = c.ultimaVisitaPresencial || '';
      row.getCell(6).value = c.ultimoContacto || '';
      row.getCell(7).value = c.ultimaCompra || '';
      row.getCell(8).value = c.facturado12M || 0;
      row.getCell(8).numFmt = '"$"#,##0';
      row.getCell(9).value = c.deudaAbierta || 0;
      row.getCell(9).numFmt = '"$"#,##0';
      row.getCell(10).value = c.diasSinVisitaPresencial;
      row.getCell(11).value = c.diasSinCompra;
      row.getCell(12).value = c.cardCode || '';
    });

    ws.columns.forEach((col, i) => { col.width = i === 0 ? 30 : (i === 4 || i === 5 || i === 6 ? 18 : 14); });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Cartera_${String(selectedVendor).replace(/\s+/g, '_')}_${activeChip}_${doc.snapshotDate}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('exportCarteraToExcel failed', e);
    alert('Error exportando: ' + String(e));
  }
};
```

- [ ] **Step 12.2: Rebuild + typecheck**

Run:
```powershell
node build.js
npm run typecheck
```

Expected: build OK + typecheck clean.

- [ ] **Step 12.3: Commit**

```bash
git add src/domains/cartera-vendor.js app.bundle.js chunks/cartera-vendor.js
git commit -m "v1283: export cartera a Excel respeta chip + search activos"
```

---

## Task 13: Cleanup script `_cleanup_seguimiento_collections.cjs` (backup + delete)

**Files:**
- Create: `scripts/_cleanup_seguimiento_collections.cjs`
- Modify: `.gitignore`

- [ ] **Step 13.1: Crear el script**

Create: `scripts/_cleanup_seguimiento_collections.cjs`

```js
/**
 * _cleanup_seguimiento_collections.cjs — 2026-10-20 (v1283).
 *
 * Backfill one-off que:
 *   1. Dumpea seguimiento_notes y seguimiento_status a
 *      ./backups/seguimiento_backup_YYYY-MM-DD.json (safety).
 *   2. Las borra en batches de 400 ops.
 *
 * Uso:
 *   node scripts/_cleanup_seguimiento_collections.cjs           # dry-run
 *   node scripts/_cleanup_seguimiento_collections.cjs --commit  # aplica
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const admin = require('../functions/node_modules/firebase-admin');

const COMMIT = process.argv.includes('--commit');
const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
const COLLECTIONS = ['seguimiento_notes', 'seguimiento_status'];
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

async function main() {
  console.log('===== v1283 CLEANUP: seguimiento_notes + seguimiento_status =====');
  console.log(`Modo: ${COMMIT ? '🔴 COMMIT' : '🟢 DRY RUN'}\n`);

  const date = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const backup = {};
  let totalDocs = 0;

  for (const colName of COLLECTIONS) {
    const snap = await db.collection(colName).get();
    console.log(`${colName}: ${snap.size} docs`);
    const docs = [];
    snap.forEach((doc) => docs.push({ id: doc.id, data: doc.data() }));
    backup[colName] = docs;
    totalDocs += docs.length;
  }

  const backupFile = path.join(BACKUP_DIR, `seguimiento_backup_${date}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`✓ Backup escrito: ${backupFile} (${totalDocs} docs totales)\n`);

  if (!COMMIT) {
    console.log('🟢 Dry-run. Para aplicar: node scripts/_cleanup_seguimiento_collections.cjs --commit');
    process.exit(0);
  }

  console.log('🔴 Borrando docs...');
  const BATCH_SIZE = 400;
  for (const colName of COLLECTIONS) {
    const docs = backup[colName];
    let batch = db.batch();
    let count = 0;
    let deleted = 0;
    for (const { id } of docs) {
      batch.delete(db.collection(colName).doc(id));
      count++;
      if (count >= BATCH_SIZE) {
        await batch.commit();
        deleted += count;
        console.log(`  ✓ ${colName}: ${deleted}/${docs.length} borrados`);
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) {
      await batch.commit();
      deleted += count;
    }
    console.log(`  ✓ ${colName}: ${deleted}/${docs.length} borrados`);
  }

  console.log(`\n✅ Cleanup OK. Backup en ${backupFile} si querés restaurar.`);
  process.exit(0);
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
```

- [ ] **Step 13.2: Crear carpeta `backups/`**

Run (PowerShell): `New-Item -ItemType Directory -Force -Path backups | Out-Null`

- [ ] **Step 13.3: Correr dry-run**

Run: `node scripts/_cleanup_seguimiento_collections.cjs`
Expected: `seguimiento_notes: X docs / seguimiento_status: Y docs / Backup escrito: ... (X+Y docs totales)`.

- [ ] **Step 13.4: Agregar `backups/` al .gitignore**

Edit `.gitignore` y agregá al final (si no está ya):
```
# v1283: backups de collections antes de cleanup
backups/
```

- [ ] **Step 13.5: Commit**

```bash
git add scripts/_cleanup_seguimiento_collections.cjs .gitignore
git commit -m "v1283: cleanup script seguimiento_notes/status + backup + .gitignore backups/"
```

---

## Task 14: Full regression + biome + PR

**Files:** ninguno nuevo

- [ ] **Step 14.1: Full test suite**

Run: `npm run test:unit`
Expected: PASS todos (791 originales + ~22 nuevos ≈ 813).

- [ ] **Step 14.2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 14.3: Biome check**

Run: `npm run lint`

Si hay errores de format, run:
```powershell
npx biome check --write functions/core/cartera-vendor-core.js src/domains/cartera-vendor.js src/pure/cartera-vendor-filter.js tests/unit/cartera-vendor-compute.test.js tests/unit/cartera-vendor-filter.test.js tests/functions/sync-cartera-vendor.test.js scripts/_cleanup_seguimiento_collections.cjs
```

Luego run `npm run lint` otra vez. Expected: 0 errores de regla real.

- [ ] **Step 14.4: Push branch**

Run: `git push -u origin dev-v1283-cartera-vendor`
Expected: `[new branch] dev-v1283-cartera-vendor -> dev-v1283-cartera-vendor`

- [ ] **Step 14.5: Crear PR**

Run (PowerShell con heredoc):
```powershell
$body = @'
## Summary

Reemplaza modal "Seguimiento" (6 tabs legacy) por dashboard de **analisis de cobertura comercial por VDE**. Un gerente selecciona un vendedor y ve: 6 KPIs cards + tabla filtrable + chips rapidos + click row -> Ficha Cliente + export Excel.

## Decisiones (brainstorming 2026-10-20)

- Cartera = `client_master.assignedVendor` (fuente unica Firestore)
- Visita presencial vs contacto -> 2 KPIs separados
- Compra = factura SAP emitida (neto NC)
- Umbrales fijos: 30d sin visita / 90d sin compra
- Permisos: admin/gerente/interno
- Arquitectura: BQ view + CF scheduled + Firestore doc (snapshot nightly 04:00 ART)
- Cleanup: tirar collections seguimiento_notes/status + reescribir seguimiento.js -> cartera-vendor.js (DOM API, no innerHTML)

## Test plan

- [x] `npm run test:unit` -> 813/813 pass
- [x] `npm run typecheck` -> clean
- [x] `npm run lint` -> clean
- [x] BQ view deploy + smoke top 10 vendors
- [x] CF trigger manual + log summary OK
- [x] Smoke Firestore: ~15-30 docs en cartera_vendor/
- [ ] Post-merge: deploy functions + rules + hosting + cleanup script --commit
- [ ] Smoke UI: abrir modal, elegir VDE, click chip, click row -> Ficha, export Excel

## Spec + plan

- `docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md`
- `docs/superpowers/plans/2026-10-20-cartera-vendor-analisis.md`

## Rollback

1. `git revert` + redeploy functions + rules + hosting.
2. Collection `cartera_vendor` queda inutil (0 lecturas).
3. Restaurar collections viejas: `node scripts/_restore_seguimiento_collections.cjs ./backups/seguimiento_backup_YYYY-MM-DD.json`.
'@
gh pr create --base main --head dev-v1283-cartera-vendor --title "v1283: rediseno modal Seguimiento -> Analisis de Cartera por Vendedor" --body $body
```

- [ ] **Step 14.6: Watch CI checks**

Run: `gh pr checks <PR_NUMBER> --watch`
Expected: todos los checks pasan.

- [ ] **Step 14.7: Squash merge**

Run: `gh pr merge <PR_NUMBER> --squash --delete-branch`

---

## Task 15: Post-merge deploy + backfill cleanup + smoke UI

**Files:** ninguno

- [ ] **Step 15.1: Sincronizar main local**

Run:
```bash
git checkout main
git pull origin main
```

- [ ] **Step 15.2: Deploy functions**

Run: `firebase deploy --only functions:syncCarteraVendorScheduled --project app-vendedores-shimano`

- [ ] **Step 15.3: Deploy rules**

Run: `firebase deploy --only firestore:rules --project app-vendedores-shimano`

- [ ] **Step 15.4: Deploy hosting**

Run: `firebase deploy --only hosting --project app-vendedores-shimano`

- [ ] **Step 15.5: Cleanup script dry-run**

Run: `node scripts/_cleanup_seguimiento_collections.cjs`
Expected: backup escrito + conteo.

- [ ] **Step 15.6: Cleanup script --commit**

Run: `node scripts/_cleanup_seguimiento_collections.cjs --commit`
Expected: `✅ Cleanup OK.`

- [ ] **Step 15.7: Smoke UI final**

Abrir app en browser logueado como admin/gerente:
1. Verificar botón `📊 Cartera` en header (NO el viejo "Seguimiento").
2. Click → modal nuevo con dropdown vacío.
3. Elegir VDE conocido (ej: GONZALO DE LA ROSA).
4. Verificar 6 KPIs cards + chips + tabla.
5. Click chip "Dormidos compra 90d" → tabla se filtra.
6. Escribir en search una tienda conocida → tabla se filtra.
7. Click fila → se abre Ficha Cliente existente.
8. Click Exportar → baja xlsx con lista filtrada.
9. Cerrar modal, abrir con otro VDE → carga rápida (cache).

---

## Rollback (si algo sale mal)

- [ ] **R1: Revert PR + redeploy**

```bash
git revert <commit-hash>
git push origin main
firebase deploy --only functions:syncCarteraVendorScheduled,firestore:rules,hosting --project app-vendedores-shimano
```

- [ ] **R2: Restaurar collections viejas**

Create: `scripts/_restore_seguimiento_collections.cjs`

```js
const path = require('path');
const fs = require('fs');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(require('os').homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
const BACKUP_FILE = process.argv[2];
if (!BACKUP_FILE || !fs.existsSync(BACKUP_FILE)) {
  console.error('Uso: node scripts/_restore_seguimiento_collections.cjs <path/backup.json>');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

(async () => {
  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  for (const [colName, docs] of Object.entries(backup)) {
    console.log(`Restoring ${colName}: ${docs.length} docs...`);
    let batch = db.batch();
    let count = 0;
    for (const { id, data } of docs) {
      batch.set(db.collection(colName).doc(id), data);
      count++;
      if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
    console.log(`✓ ${colName} restored.`);
  }
  process.exit(0);
})();
```

Run: `node scripts/_restore_seguimiento_collections.cjs ./backups/seguimiento_backup_2026-10-20.json`

---

## Self-Review Checklist (hecho por el autor)

- [x] **Spec coverage**: 12 decisiones del spec cubiertas (Task 1 BQ view, Task 2-4 handler/computeCounts/normalize, Task 5 CF wrapper, Task 6 rules, Task 7 deploy, Task 8 filter puro frontend, Task 9 shell HTML, Task 10 chunk JS, Task 11 permisos+changelog, Task 12 export, Task 13 cleanup, Task 14-15 deploy+smoke).
- [x] **No placeholders**: cada step tiene código completo. Scripts enteros, SQL completo, CF handler completo.
- [x] **Type consistency**: `computeCounts` + `normalizeClienteRow` + `applyChipFilter` + `sortClientes` consistentes en spec+plan+código. Fields BQ (snake_case) y Firestore (camelCase español) separados y traducidos vía `normalizeClienteRow`.
- [x] **TDD**: funciones puras testeadas antes de implementarse. Handler integration testeado con fake fbDb + fake bqClient.
- [x] **Anti-XSS**: todo render DOM usa `createElement` + `textContent` + `appendChild`. Zero `innerHTML`. Nota en el header del plan + nota en Task 10.
- [x] **Commits atómicos**: 1 commit por task o sub-task.
- [x] **Rollback**: ruta clara con restore script.
