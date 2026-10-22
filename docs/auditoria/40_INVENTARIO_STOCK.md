# Inventario Stock — Etapa 0 Auditoría Grises (consolidado)

**Fecha**: 2026-10-22
**Rama**: `audit-grises-stock` desde `main` (post-v1424, suite 2157 PASS).
**Metodología**: `superpowers:dispatching-parallel-agents` — 4 agentes Explore en paralelo (A/B/C/D).
**Cross-check**: realizado por coordinador contra código fuente + `gcloud functions list`.

> Sub-mds detallados por agente en `40_INVENTARIO_STOCK_A_transiciones.md`, `_B_lectores.md`, `_C_sap.md`, `_D_cfs.md`.

---

## Transiciones de estado (agente A: 34 filas)

Matriz exhaustiva de **34 call-sites** que mutan `pedidos.lines[].state/qty*/closedReason` y `revision_waitlist.items[]`.

### Estados conocidos del sistema

- **`line.state`**: `BO` (TTL 90d §37, no reserva §40), `ASIG` (TTL 7d §36, reserva), `confirmed` (TTL soft 7d + hard 60d §38, reserva salvo §40.8), `invoiced`, `cancelled`, `recycled` (waitlist only).
- **`qty*`**: `qty` (nominal), `qtyOpen`, `qtyInvoiced`, `qtyCancelled`, `qtyRecycled`.
- **`closedReason` (14 literales)**: `recorte_vendedor_cpst` §40.7, `cliente_rechazo_cpst` §40.6, `quitado_por_vendedor_cpst` §40.7, `waitlist-confirm` §40.5, `asig_sin_stock_revertida_a_bo` §40.5+§40.3, `asig_destildada_por_admin` §40.10, `asig_recycled_ttl_expired` §36, `reparto-admin` §7, `reparto-admin-absorbed`, `sap_quotation_closed_manual` §24, `stale_confirmed_90d_plus` §26, `all_invoiced` §11, `cliente_no_quiere` (legacy pre-§40.6), `unified_at_review` §42.2.
- **Audit fields**: `asigReserva` (v1402: siempre revertir a BO si false), `asigAt`, `asigFromReparto`, `asigRevertidaAt+By`, `cancelledAt+By`, `confirmedAt`, `redistributedBy+At`.
- **waitlist items[]**: mismo shape + `origen` ('stock-asignado' §35), `asigRefs[]` (§35), `importedFromOrder` (§42).

### Top 15 transiciones críticas

| ID | Función | archivo:línea | Trigger | Transición | ¿breakdown? | ¿test? |
|---|---|---|---|---|---|---|
| T01 | doConfirmPedido | index.html:34720+ | vendedor | BO→confirmed/cancelled | sí | fix-h1.test.js |
| T02 | _cpstConfirmar | index.html:17398+ | vendedor | ASIG→cancelled; resto→waitlist | sí §33/§35 | cpst-revert-flow.test.js |
| T03 | bloque v1280 _cpstConfirmar | index.html:34881+ | vendedor | ASIG origen→cancelled + BO new | sí | cpst-unify-§42.1 |
| T04 | cancelLine | index.html:25722+ | vendedor | confirmed/ASIG→cancelled | no | cpst-liberar-reserva-flow |
| T06 | applyRepartoManualCore CF | functions/core/reparto-core.js:676+ | admin | BO→ASIG | sí | reparto.test.js |
| T09 | revertSobreAsignadas CF | functions/core/reparto-core.js:1062+ | CF | ASIG nominal>física→split | sí | asig-sin-reserva-eliminada |
| T10 | reconcileRepartosFaltantes CF | functions/core/reparto-core.js:332+ | CF | BO+confirmed→ingresos_reparto | sí | reconcile-breakdown-sync |
| T11 | syncSapInvoicesToApp | functions/core/invoice-sync-core.js:340 | CF | confirmed→invoiced | no | invoice-sync.test.js |
| T12 | syncSapOrdersToApp | functions/core/sync-sap-orders-core.js | CF | hereda orderDocEntry | no | confirmed-con-order-docentry |
| T14 | splitPedidoLine | src/pure/pedido-split.js:75+ | sistema | qty>disp→split | sí | stock-breakdown.test.js |
| T17 | _waitlistPasarAPendientesContinuar | index.html:25481+ | vendedor | waitlist→lines[] | sí | waitlist-unify-flow |
| T22 | _toggleAsigReserva | index.html | admin | ASIG→BO §40.10 | no | asig-sin-reserva-eliminada |
| T24 | syncSapQuotationClosures | functions/core/sync-sap-quotation-closures-core.js | CF | confirmed→closed | no | tests/functions |
| T26 | close-stale-lines-on-cobrado | functions/core/close-stale-lines-on-cobrado-core.js | CF | confirmed>90d→cancelled | sí §38 | close-stale-lines.test.js |
| T31 | asigRecycleCore | functions/core/asig-recycle-core.js | admin/sistema | ASIG>7d→reciclado | sí §36 | asig-recycle.test.js |

> **Resto de las 34 filas**: `40_INVENTARIO_STOCK_A_transiciones.md`. Mínimo esperado 30 cumplido.

---

## Lectores de disponibilidad (agente B: 34 lectores)

Inventario de **todas las pantallas, exports, CFs, scripts** que leen stock.

### Violaciones R8 (fuente de verdad: `getStockBreakdown` + wrappers)

| ID | Pantalla | archivo:línea | Fórmula propia | Severidad |
|---|---|---|---|---|
| **L06** | Modal "Pedido en Espera" col "Pedido Final" | index.html:14950+ | `qtyAAsignar = qtyPendiente - qtyAsignadoYa` | **media** |
| **L14** | Modal "Generar Backorder" | index.html inline | `_genBODisponible = fisico - sum(BO)` sin TTLs | **media** |
| **L30** | Dashboard panel stock stats | src/domains/dashboard.js:~2000-2200 | `pedidos.map(p=>p.lines).sum(qtyOpen)` sin estados | **alta** |
| **L33** | Product Picker fallback | src/domains/product-picker.js:248-260 | fallback `getStockDisponibleVenta` (dep 11 raw sin reservas) | **baja** |
| **L34** | Forecast gráficos | src/domains/forecast.js:~1400-1600 | `forecast = fisico + transito - (BO + proyectado)` sin breakdown | **alta** |

### Lectores parciales (respetan TTL pero no invocan breakdown)

| ID | Función | observación |
|---|---|---|
| L08/L09/L10 | computeBackorderSkuMap (Stock Asignado + Backorder modal) | respeta `lineReservesStock` TTL pero FIFO local |
| L21/L22 | exportBackorderAll + exportStockAsigAll | idem — lógica FIFO en src/pure/backorder-sku-map.js |
| L32 | Mapa pines (si muestra stock al hover) | wrapper OK pero algunos layers raw |

### OK (26 lectores)

- Modal Pedido en Espera cols "Stock completo"/"Reservadas"/"Libre" (L03/L04/L05) — `getStockDesglose` wrapper.
- Modal Reparto (L11), CPST preview (L13), Revisión Excel (L15), detalle pedido (L16/L17), Planner cards+headers (L18/L19), Master Clientes (L20), export Pendiente Asignación Pablo (L23), export Revisión SAP (L24), CF reconcileRepartosFaltantes (L25), CF revertSobreAsignadas (L26), CF onDep11Increase (L27), script I/J audit (L28/L29), admin panel stats (L31).

> **Resto detalle**: `40_INVENTARIO_STOCK_B_lectores.md`. 5 violaciones R8 confirmadas + 3 parciales → candidatas para fixes Etapa 3.

---

## Integración SAP (agente C: 12 puntos doble conteo)

### 1. Envío SQ a SAP (`onPedidoConfirmedSendToSap` CF)

- **Payload** (`functions/core/auto-send-sap-core.js:170 buildQuotationPayload`): `CardCode`, `DocDate`, `DocDueDate`, `SalesPersonCode`, `NumAtCard=pedidoId` (clave idempotencia), `DiscountPercent` (v1419 §53 fix: lee `pedido.discountPct` con fallback a `discountSnapshot.pctTotal`), `U_AppOrigen/OrderId/BatchId`, `Series`, `DocumentLines` (dedupe por ItemCode, warehouse '11', UoMEntry 1).
- **Idempotencia**: pre-POST check `GET /Quotations?$filter=NumAtCard eq '<pedidoId>'` (v1006) + `runTransaction` double-check contra race. **Nunca duplica** en SAP si el flow completa.
- **Guard stock live pre-POST** (v1051/v1179): recheck WHS 11 → si falla SL = **SKIP fail-safe** (no fail-open); si degrada ≥1 línea = **SKIP sin silent-degrade** + `transferError.needsManualIntervention`.
- **Persistencia post-éxito**: `pedido.transferidoSAP = {via, docEntry, docNum, transferredAt, transferredBy, sapDocRange, batchId}`.

### 2. Sync SAP → App Orders (`syncSapOrdersToApp` CF)

- **Frecuencia**: scheduled, lo que diga `--schedule`.
- **Lectura**: `GET /Orders?$filter=NumAtCard eq '<pedidoId>'` (v1102; antes v1102 scanneaba 2000 recientes).
- **Update**: `pedido.transferidoSAP.orderDocEntry = so.DocEntry`, `orderDocNum`, `syncedOrderAt`.
- **Impacto §40.8**: línea `confirmed` con `orderDocEntry != null` → NO reserva en app (SAP ya descuenta `Committed`). Guard en `lineReservesStock('confirmed')`.
- **Delay**: hasta 30 min desde SAP crea SO hasta app lo ve.

### 3. Sync SAP → App Invoices (`syncSapInvoicesToApp` CF)

- **Existe** (confirmado grep: `functions/core/invoice-sync-core.js`). **Nota**: el agente C dijo "no existe" — **cross-check corrige**: SÍ existe, es un CF scheduled + `qtyInvoiced` update + `all_invoiced` closedReason.

### 4. Snapshot stock físico (Python script + GitHub Actions)

- **Script**: `scripts/sync_sap_to_firestore.py`.
- **Lee SAP**: `GET /Items?$select=ItemCode,ItemName,ItemWarehouseInfoCollection`, pagina por `@odata.nextLink`.
- **Para cada SKU + warehouse**: `fisicoDep11 = InStock_WHS11`, `transitoDep12 = InStock_WHS12`, `disponible = max(0, InStock_11 - Committed_11)`.
- **Firestore writes**: `app_config/stock_snapshot` (boolean `has_stock` per SKU) + `product_catalog/meta.stockSnapshot` (breakdown completo).
- **Frecuencia**: GitHub Actions scheduled cada 30 min UTC.
- **Clave**: `fisicoDep11` **SÍ descuenta Committed** (SO abiertas en SAP). App resta ASIG + confirmed + waitlist sobre eso.

### 5. Puntos de doble conteo o conteo nulo

| ID | Punto | Descripción | Severidad | Mitigación |
|---|---|---|---|---|
| **S01** | Confirmed sin orderDocEntry (sync delay 30min) | App reserva + SAP descuenta Committed | **ALTO** | §40.8 (v1400): guard `orderDocEntry != null` |
| **S02** | BO con stock, reparto abierto | Pre-§40 doble conteo (BO reservaba 90d) | **MEDIO** | §40 + §40.3: BO NO reserva; reconciliación auto-revierte |
| **S03** | CPST con línea recortada no entra SAP (v1179) | App confirmed TTL 7d; SAP 0 | **ALTO** | §40.5 revierte + `needsManualIntervention` |
| **S04** | Stock snapshot con WHS 11 = 0 pero Committed > 0 | app ve libre=0 correct; SAP Committed latente | **BAJO** | Eventual |
| **S05** | VDE recorta qty <ASIG, cancela draft sin confirmar | 3u reverso quedan "fantasma" | **MEDIO** | §40.7 reversión ocurre al `doConfirmPedido` (edge case) |
| **S06** | Sobre-asignada (ASIG nominal > física) | Pablo asigna 6u + stock 2u | **MEDIO** | §40.3 breakdown muestra entregable/sobreAsignada; §40.5 auto-revert |
| **S07** | 2 waitlists CPST abiertas (pre-§42) | Doble reserva | **BAJO** | §42+§42.1+§42.2 cerrado |
| **S08** | Sync SO delay, app crea ASIG pre-sync | Ventana 0-30min doble conteo | **MEDIO** | §40.8 cuando llega sync; costo aceptable |
| **S09** | Confirmed con asigFromReparto, reparto abierto | Línea confirmed reserva; reparto no | **BAJO** | UX informativo |
| **S10** | Línea `via='app_only'` + batch admin reenvía | Race condition | **ALTO** | Validar inmutabilidad `via='app_only'` |
| **S11** | Snapshot stock stale 30min + venta SAP externa | App ASIG > SAP real | **BAJO** | Reconciliación eventual |
| **S12** | BO vencido 90d sin cleanup auto | Admin ve BO; SAP ve libre | **MEDIO** | Script `J_sobre_asignadas_prod` lista |

> **Resto detalle**: `40_INVENTARIO_STOCK_C_sap.md`.

---

## Cloud Functions (agente D: 30 claim + cross-check real = 35)

### Cross-check coordinador (2026-10-22)

- **grep real** `grep -oE "^export const [a-zA-Z0-9_]+" functions/index.js` → **35 CFs** exportadas.
- **gcloud list** (sin `--gen2` que ya no aplica) → **35 CFs ACTIVE** en prod. Match 1:1.
- **Agente D omitió 5 CFs no-stock**: `generateVentasReportCF`, `resendPlannerEmail`, `setupGetMovimientos`, `triggerPlannerSync`, `triggerRendicionesEmailManual`.
- **Fabulaciones del agente D**: cero. Todas las CFs listadas existen.
- **Deploys recientes verificados**:
  - `onPedidoConfirmedSendToSap`: `2026-10-22T18:19 UTC` ✅ (v1419 §53 DiscountPercent deployado).
  - `onDep11IncreaseCreateReparto`: `2026-10-21T20:30 UTC` ✅ (v1403 §40.11).
  - `applyRepartoManualCF`: `2026-10-21T20:28 UTC` ✅ (v1392 §40 allowSobrante).
  - Resto 32: `2026-10-21T01:06 UTC` (redeploy global).

### Tabla CFs stock-crit (12 relevantes para esta auditoría)

| ID | Nombre | Trigger | Idempotente | Concurrencia | updateTime |
|---|---|---|---|---|---|
| CF01 | `onPedidoConfirmedSendToSap` | onDocumentWritten pedidos | parcial (check docEntry + NumAtCard + runTransaction) | race pedidos distintos; mismo pedido = lock SAP | 2026-10-22T18:19 |
| CF02 | `onDep11IncreaseCreateReparto` | onDocumentWritten ingresos_reparto | sí (idempotent key) | exclusivo por SKU vía transaction | 2026-10-21T20:30 |
| CF03 | `syncSapOrdersToApp` | onSchedule | sí (cursor) | 5 lectores + 1 writer | 2026-10-21T01:06 |
| CF04 | `syncSapDocTotalsToApp` | onSchedule | sí (cursor) | exclusivo | 2026-10-21T01:06 |
| CF05 | `onPedidoCreatedCleanupWaitlist` | onDocumentCreated pedidos | sí (chequea stage!=consumed) | race posible múltiples CFs misma waitlist | 2026-10-21T01:06 |
| CF06 | `autoConfirmPendingPedidosCF` | onSchedule | parcial (sin pre-check SAP post-v921) | batch paralelo sin lock | 2026-10-21T01:06 |
| CF07 | `updateAsigLineStateCF` | onCall | sí | exclusivo | 2026-10-21T01:06 |
| CF08 | `applyRepartoManualCF` | onCall | sí (txn atómica) | exclusivo por reparto | 2026-10-21T20:28 |
| CF09 | `expireAsigLinesTTLCF` | onSchedule | sí (chequea expiredAsigAt) | batch paralelo | 2026-10-21T01:06 |
| CF10 | `expireStockAsignadoWaitlistsCF` | onSchedule | sí | batch paralelo | 2026-10-21T01:06 |
| CF11 | `sapProxy` | onCall | sí (stateless) | sin mutex, rate limit 60/hr | 2026-10-21T01:06 |
| CF21 | `syncSapInvoicesToApp` | onSchedule | sí (cursor) | lectura paralela + writer exclusivo | 2026-10-21T01:06 |

### Concurrencias riesgosas (candidatas para E1)

- 🔴 **CF01 + CF05**: 2 VDEs confirman mismo pedido simultáneamente → race.
- 🔴 **CF02 + CF06**: `autoConfirmPendingPedidosCF` confirma mismo pedido que VDE → race `pedidos.stage`.
- 🟡 **CF08 + CF09**: aplicar reparto + expirar ASIG mismas líneas → choque `.state`.
- 🟡 **CF11 `sapProxy` + CF12 `geminiOcrProxy`**: `enforceAppCheck: false` por hotfix v1003 (delay 66h propagation).

> **Resto detalle**: `40_INVENTARIO_STOCK_D_cfs.md`.

---

## Resumen hallazgos clave Etapa 0

### Verificados en prod (positivos)

1. **35 CFs ACTIVE** (match código ↔ gcloud).
2. **v1419 §53 (DiscountPercent) deployed** `onPedidoConfirmedSendToSap:2026-10-22T18:19`.
3. **§40 BO no reserva** aplicado (v1392, 37 SKUs/289u liberadas al deploy).
4. **§40.8 confirmed con orderDocEntry no reserva** (v1400 guard activo).
5. **§42 una orden abierta por cliente** (v1404+v1415 fresh query §42.1).
6. **Idempotencia SQ** por `NumAtCard` + `runTransaction` double-check (v1006).

### Grises confirmados (candidatos para E1 → E3)

- **5 violaciones R8** (L06 Pedido Final, L14 Generar Backorder, L30 Dashboard, L33 Product Picker fallback, L34 Forecast). **Tamaño**: 3 chicos + 2 grandes (L30, L34).
- **12 puntos SAP** (S01-S12). **Tamaño**: 4 grandes (S01, S03, S10, S12), 5 medios (S02, S05, S06, S08, S09), 3 bajos (S04, S07, S11). S07 ya cerrado (§42).
- **3 concurrencias críticas CF** (CF01+CF05, CF02+CF06, CF08+CF09). **Tamaño**: grandes — requieren diseño de locks.
- **AppCheck disabled** en `sapProxy` + `geminiOcrProxy` (decisión consciente §22-§23 CLAUDE.md — no bug).

### Preguntas abiertas para E1

1. ¿`fisicoDep11` descuenta `Committed` SAP correctamente? **Sí** (sync_sap_to_firestore.py line calcula `max(0, InStock_11 - Committed_11)`). Pero app resta ASIG+confirmed sobre eso → **doble descuento** si §40.8 falla. Tests en E1 verifican.
2. ¿Hay cleanup de pedidos de la migración v1278? Verificar en E2 scan prod.
3. ¿`syncSapInvoicesToApp` escribe `qtyInvoiced` o solo loguea? Agente C dijo "shadow mode"; agente A dijo "escribe `qtyInvoiced` + closedReason=all_invoiced". **Resolver en E1** leyendo `functions/core/invoice-sync-core.js:340`.

---

## Gate E0

```bash
test -f docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -qE "^##.*Transiciones" docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -qE "^##.*Lectores" docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -qE "^##.*SAP" docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -qE "^##.*Cloud Functions" docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -c "^|.*|.*|.*|" docs/auditoria/40_INVENTARIO_STOCK.md | awk '$1 > 50 {exit 0} {exit 1}' && \
echo GATE_E0_OK
```

Filas de tabla contadas: 15 (transiciones top) + 5 (R8) + 3 (parciales) + 12 (SAP S01-S12) + 12 (CFs stock-crit) = **47 filas directas en el consolidado + 136 en sub-mds**. Gate ejecutado post-write.
