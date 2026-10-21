# 19 — Informe Cowork v1391 — Una sola fuente de verdad para el stock de un SKU (FINDING-04)

**Fecha**: 2026-10-21
**Rama**: `feat-stock-breakdown-unico` → `main`
**SHA merge**: `bc9a451`
**PR**: [#1123](https://github.com/shimano-arg/app-vendedores/pull/1123)
**Deploy**: GitHub Pages auto + `firebase deploy --only functions:onDep11IncreaseCreateReparto` (14:35 UTC)

---

## 1. Problema reportado 2026-10-21 10:50

El mismo SKU **CUDC201HG** mostraba **5 números distintos** en 5 pantallas:

| Pantalla | Valor Mariano (10:50) | Fuente |
|---|---|---|
| Modal Backorder | 26 u (REBORN 16, BROBRO 8, ANDRILI 2) — subtítulo "datos SAP cada 30 min" | `globalPedidos` live `computeBackorderSkuMap` SIN TTL |
| Modal Reparto | 0 resultados | `ingresos_reparto` where `status in [pending, in_progress]` |
| Popup Master "Stock del SKU" | físico 7, tránsito 24, BO 11, asig 1, libre 0 | mezcla: `stock_snapshot` + `computeBackorderSkuMap` + `getStockDesglose` |
| Modal Pedido en espera (ORDEN 474) | reservadas 18, badge "17 en BO", libre 0 | `getStockDesglose(sku)` CON TTL §37 |
| Modal Stock Asignado | 1 u GRAUBERGER | `globalPedidos` filtrado `state='ASIG'` + TTL 7d |

El back order valía **26, 17 u 11** según la pantalla. FINDING-04 de la auditoría 20/10 (`docs/AUDIT_SHIMANO_2026-10-20.md`).

---

## 2. Causa raíz (E0, systematic-debugging)

Cada pantalla aplicaba su **propia fórmula** de disponibilidad/reservas:
- Modal Backorder: **sin TTL** — toma TODA línea con `qtyOpen > 0`.
- Modal Pedido en espera: **con TTL §37** (BO 90d) + §38 (confirmed 60d) — vía `getStockDesglose`.
- Popup Master: **mixto** — `fisico/transito` del snapshot + `computeBackorderSkuMap` sin TTL para BO/ASIG + `getStockRealmenteDisponible` CON TTL para "libre".
- Modal Reparto: lee **`ingresos_reparto`** (otra colección totalmente).
- Modal Stock Asignado: alias del Modal Backorder modo 'asignacion'.

**Hallazgos clave** (`docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md`):
- NO existe `app_config/backorderBySkuApp` ni `app_config/backorder_snapshot` — el "26" no es un snapshot, es live.
- "datos SAP cada 30 min" en el subtítulo del Modal Backorder se refiere al **snapshot de stock físico** (`stock_snapshot.updatedAt`), NO a la demanda. La demanda es live.
- Entre 10:50 (reporte) y 14:11 (dump), REBORN 16u desapareció → la demanda cambió. Es consistente con "live sin TTL".

---

## 3. Solución (E1-E4)

### 3.1 `getStockBreakdown` — fuente única

**File**: `src/pure/stock-breakdown.js` + copia espejo `functions/core/pedido-snapshot-core.js`.

```js
getStockBreakdown(sku, deps, opts) → {
  sku,
  fisicoDep11,
  transitoDep12,
  demandaSapSinCubrir,     // opt-in con opts.includeStale=true (sin TTL)
  backorderApp,            // {total, porCliente} con TTL §37 90d
  confirmadasSinFacturar,  // con TTL §38 7d soft + 60d hard
  asignadas,               // con TTL 7d
  waitlistCpst,            // revision_waitlist source='stock-asignado-batch'
  reservadasTotal,
  libre,
  utilizablePara(cardCode), // fórmula §33/§35
  pendienteReparto: {qty, repartoId},
  _version: 1,
}
```

Reusa `lineReservesStock` (reglas §36 §37 §38 — no reimplementa TTL).

### 3.2 Wrappers finos sobre breakdown

Las 4 fns derivadas (`src/pure/stock-realmente-disponible.js`) ahora son **wrappers de 2-20 líneas**:

- `getStockRealmenteDisponible(sku, deps, opts)` → `breakdown.libre`
- `getStockDesglose(sku, deps, opts)` → mapea al shape viejo `{fisico, comprometido, real, breakdown}`
- `getStockPorCliente(sku, cardCode, deps, opts)` → agrupa buckets `porCliente` filtrando por cardCode
- `getStockUtilizableParaClienteExAsig(sku, cardCode, deps, opts)` → `breakdown.utilizablePara(cardCode)`

### 3.3 Reconcile usa breakdown (ajuste Mariano #1)

**File**: `functions/core/reparto-core.js:reconcileRepartosFaltantes`.

Antes: reimplementaba la fórmula con `lineReservesStock` directo. Podía divergir de las pantallas.

Ahora: usa `getStockBreakdown.pendienteReparto.qty` como autoridad. `clientesBO[]` se construye por separado (shape del doc requiere `clientProvince/Locality/pedidoCreatedAt`).

**Test de divergencia** (`tests/functions/reconcile-breakdown-sync.test.js`): 4 fixtures. Si en el futuro cambia una fórmula sin la otra, falla.

### 3.4 UI expone `getStockBreakdown`

**File**: `index.html`. `window.getStockBreakdown` + `window.STOCK_LABELS` disponibles.

**Call-sites migrados a 1-call breakdown**:
- Modal Pedido en espera (línea 24172+): antes `getStockDesglose + getStockPorCliente` (2 calls/fila), ahora 1 call breakdown + mapeo local al shape viejo.

**Call-sites restantes** (siguen usando wrappers que delegan a breakdown): ver §5.

### 3.5 Labels homogéneas

Exportadas en `STOCK_LABELS`:

| Concepto | Label uniforme |
|---|---|
| `fisicoDep11` | Stock físico (dep 11) |
| `transitoDep12` | En tránsito (dep 12) |
| `demandaSapSinCubrir` | Demanda SAP sin cubrir |
| `backorderApp` | Back order (app) |
| `confirmadasSinFacturar` | Confirmadas sin facturar |
| `asignadas` | Asignadas |
| `waitlistCpst` | En lista de espera (CPST) |
| `reservadasTotal` | Reservadas |
| `libre` | Libre para la venta |
| `pendienteReparto` | Pendientes de reparto |

### 3.6 CLAUDE.md §39 (regla durable)

> Ninguna pantalla, modal, badge, tooltip o CF calcula disponibilidad/reservadas/libre/pendientes de reparto por su cuenta. Toda lectura pasa por `getStockBreakdown(sku, deps, opts)` de `src/pure/stock-breakdown.js` (o copia espejo en functions/core).
>
> Las funciones viejas son wrappers que retornan subsets del breakdown; nunca reimplementar la lógica fuera.
>
> Si necesitás un bucket nuevo (ej. "en cuarentena"), lo agregás a `getStockBreakdown` + al test invariante de schema + al wrapper que corresponda. No improvisar inline.

---

## 4. Verificación en prod (E3)

**Script**: `scripts/audit/I_breakdown_prod_check.cjs` (read-only).

| SKU | fisico | transito | BO | conf | asig | wlCpst | reserv | libre | pendRep | repartoId | ✓ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CUDC201HG | 7 | 24 | 2 | 0 | 1 | 0 | 3 | 4 | 6 | wXqG9ZezQpJYJRA8yF44 | ✓ |
| CLC66H2PY | 9 | 0 | 169 | 2 | 0 | 0 | 171 | 0 | 7 | YlQVZ9YR8MpYUgy9POKx | ✓ |
| CLC66MH2PY | 7 | 0 | 116 | 2 | 0 | 0 | 118 | 0 | 5 | aKGy48sv7147jzai0eYD | ✓ |
| CLC70H2PY | 9 | 0 | 109 | 2 | 0 | 0 | 111 | 0 | 7 | hITGvXIaq9yDqnnL5AtI | ✓ |

**Todos los invariantes pasan**: `reservadasTotal == Σ buckets`, `libre == max(0, fisicoDep11 - reservadasTotal)`, `pendienteReparto` consistente.

---

## 5. Call-sites restantes en `index.html` (follow-ups)

**Audit grep** post-refactor (líneas 7273-7334 son los wrappers; el resto son call-sites de pantalla):

| Línea | Call | Pantalla / contexto | Motivo | Follow-up |
|---|---|---|---|---|
| 7325 | `getStockRealmenteDisponible` | wrapper `getStockUtilizableParaClienteExAsig` fallback | Interno de wrapper (sin cardCode) | ✓ OK |
| 17091 | `getStockPorCliente` | `_cpstRenderPreview` | Shape `porCli.*` usado en CPST preview | Dejar como wrapper |
| 17350 | `getStockRealmenteDisponible` | edición qty flow split | Flujo split (una llamada por SKU) | Dejar como wrapper |
| 17415 | `getStockRealmenteDisponible` | edición qty flow split | idem | Dejar como wrapper |
| 19703 | `getStockRealmenteDisponible` | `renderRevisionExcel` dispReal | Preview Excel import, single call | Dejar como wrapper |
| 19849 | `getStockDesglose` | `renderRevisionExcel` desg | Preview Excel, shape viejo | Dejar como wrapper |
| 23247 | `getStockRealmenteDisponible` | `getDisp` interna modal pedido | Dentro de closure, 1 call | Dejar como wrapper |
| 23890 | `getStockPorCliente` | CPST preview `_porCli` | Shape `yaEnOtroPedido` usado | Dejar como wrapper |
| 24006 | `getStockPorCliente` | fila preview waitlist `_pc` | Shape viejo | Dejar como wrapper |
| 24193 | `getStockPorCliente` | Modal Pedido en espera (post-E2) | `yaEnOtroPedido` necesario para badge repeat-sku | Dejar como wrapper |
| 27332 | `getStockUtilizableParaClienteExAsig` | `persistPendingEntry` ex-ASIG | Flujo §33/§35 | Dejar como wrapper |
| 35121 | `getStockUtilizableParaClienteExAsig` | `doConfirmPedido` ex-ASIG | Flujo §33/§35 | Dejar como wrapper |
| 35126 | `getStockRealmenteDisponible` | `doConfirmPedido` global | Flujo pedidos normales | Dejar como wrapper |
| 30487+ | `getStockDesglose` + `getStockRealmenteDisponible` | Popup Master Stock del SKU | Coincidencia con Modal Backorder legacy (`computeBackorderSkuMap`); si migro a breakdown.demandaSapSinCubrir cambian los números legacy | **Follow-up Mariano**: ¿unificar Modal Backorder + Popup Master en `breakdown.demandaSapSinCubrir`? Cambio de números visibles |

**Interpretación**: los 14 call-sites restantes usan wrappers que delegan a `getStockBreakdown`. Cumplen §39 **por delegación** (no reimplementan). Migración a breakdown directo es optimización de performance (1 call vs 1 wrapper call) o cambio de shape (riesgoso sin test visual).

---

## 6. Modal Backorder: hallazgo abierto

**Hoy**: el Modal Backorder usa `computeBackorderSkuMap` que lee `globalPedidos` **sin TTL**. Esto es inconsistente con las demás pantallas (que aplican TTL via `getStockBreakdown`).

**Opción futura**: migrar Modal Backorder a `getStockBreakdown(sku, deps, {includeStale: true}).demandaSapSinCubrir` para unificar. Cambia los números visibles — Mariano debe autorizar.

El plan original contemplaba este cambio en el refactor. Decidí **no hacerlo** en v1391 porque:
1. Cambia la UX de la pantalla principal donde Mariano "contó" el 26.
2. Toca `src/pure/backorder-sku-map.js` + `renderBackordersTab` (465 líneas).
3. Requiere brainstorming aparte sobre si "26 con TTL" o "26 sin TTL" es el número correcto para esa pantalla.

**Pendiente de decisión**: Mariano autoriza/rechaza migración.

---

## 7. Gates ejecutables

```
GATE_E0_OK ✓ (docs/auditoria/17 + archivo:línea + doc fantasma status=done)
GATE_E1_OK ✓ (19 tests breakdown + 9 sync tests + suite completa 1510 PASS + 1 FAIL pre-existente)
GATE_E2_OK ✓ (wrappers + 14 call-sites listados en §5 + reconcile-breakdown-sync)
GATE_E2.extra_OK ✓ (reconcile qty == breakdown.pendienteReparto.qty, 4 fixtures)
GATE_E3_OK ✓ (4 SKUs verificados en prod, todos invariantes ✓)
GATE_E4_OK ✓ (PR #1123 merged bc9a451 + firebase deploy ACTIVE 14:35 UTC + prod check post-deploy ✓)
GATE_E5_OK ✓ (este informe + CLAUDE.md §39)
```

---

## 8. Tests antes/después

- **Antes del loop**: 1482 PASS + 1 FAIL pre-existente (`reparto.test.js`, no relacionado).
- **Después del loop**: **1514 PASS + 1 FAIL pre-existente** = 32 tests nuevos.
  - +19 `stock-breakdown.test.js`
  - +9 `stock-breakdown-sync.test.js`
  - +4 `reconcile-breakdown-sync.test.js`

---

## 9. Follow-ups pendientes para Mariano

1. **D3** (SQ → Order SAP, resumen 10 líneas en `docs/auditoria/17_RESULTADO_V1390_BO_SIN_TTL.md`): autoría del script de dimensionamiento.
2. **9 SKUs con BO >90d** fuera del reparto por §37: vista admin separada o stale definitivo?
3. **Modal Backorder migración a `demandaSapSinCubrir`**: cambia números visibles. Requiere OK.
4. **Smoke manual post-v1391**: abrir CUDC201HG en las 5 pantallas y confirmar coincidencia con tabla §4.

---

## 10. Entregables shipped

- `src/pure/stock-breakdown.js` (nueva fuente única, ~220 líneas).
- `functions/core/pedido-snapshot-core.js` (copia espejo).
- `src/pure/stock-realmente-disponible.js` (4 wrappers finos).
- `functions/core/reparto-core.js` (reconcile usa breakdown).
- `index.html` (window exports + Modal Pedido en espera migrado).
- `src/main.js` + bundle rebuild.
- `tests/unit/stock-breakdown.test.js` (19).
- `tests/unit/audit/stock-breakdown-sync.test.js` (9).
- `tests/functions/reconcile-breakdown-sync.test.js` (4).
- `scripts/audit/_dump_cudc_full.cjs` + `I_breakdown_prod_check.cjs`.
- `docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md` (E0).
- `docs/auditoria/18_VERIFICACION_V1391_BREAKDOWN.md` (E3).
- Este informe (E5).
- CLAUDE.md §39.
- APP_VERSION v1390 → v1391. CACHE_VERSION v1390 → v1391.
