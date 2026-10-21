# 17 — Cinco números para CUDC201HG: fuente, fórmula y explicación

**Fecha dump**: 2026-10-21T14:11:50 UTC
**Snapshot de stock usado**: `stock_snapshot.updatedAt=2026-10-21T10:20:27 UTC`
**Reporte original Mariano**: 2026-10-21 10:50 ART (snapshot ~10:20 UTC).
**Script**: `scripts/audit/_dump_cudc_full.cjs`

---

## Resumen ejecutivo

| Pantalla | Valor Mariano (10:50) | Valor dump (14:11) | Fuente | Fórmula |
|---|---|---|---|---|
| Modal Backorder | 26 u (REBORN 16, BROBRO 8, ANDRILI 2) | **12 u** (BROBRO 8 + BAUTISTA 2 + ANDRILI 2 — ver nota) | `globalPedidos` (listener `pedidos` sin filtro `closedAt`) | `_buildSkuMapRaw` + FIFO cap sobre `state ∈ {BO,confirmed,ASIG}` + `qtyOpen > 0` |
| Modal Reparto | 0 resultados | 1 result (`wXqG9...`, qty=6, 1 cliente) | `ingresos_reparto` where `status in [pending,in_progress]` | — |
| Popup Master "Stock del SKU" | físico 7, tránsito 24, BO 11, asig 1, libre 0 | físico 7, tránsito 24 | `stock_snapshot.warehouseBreakdown['11'/'12']` | `getStockRealmenteDisponible` + `getStockDesglose` |
| Modal Pedido en espera | reservadas 18, badge "17 en BO", libre 0 | reservadasTotal=3 (BO 2 + ASIG 1), libre=4 | `getStockDesglose(sku)` sobre `globalPedidos` con TTL `lineReservesStock` | §36/§37/§38 |
| Modal Stock Asignado | 1 u GRAUBERGER | 1 u GRAUBERGER | `globalPedidos` filtrado `state='ASIG'` + TTL 7d | — |

**Nota crítica**: entre el reporte Mariano (10:50) y el dump (14:11) pasaron ~3h20m. REBORN 16u no aparece en el dump actual. Posibles razones (ver §4): facturación, cierre o línea `invoiced` entre ambos momentos. **El modal Backorder lee en vivo de `globalPedidos`**, no de un snapshot con timestamp — por eso los números cambian.

---

## 1. Modal Backorder

### Fuente y pipeline

- **Trigger**: `index.html:3972` botón `#backorders-btn → openBackordersModal()` modo `urgente` (y `#asignacion-backorder-btn` modo `asignacion`).
- **Entry**: `index.html:15341-15348` `window.openBackordersModal()` llama `ensureBackordersListener()` + `renderBackordersTab()`.
- **Fuente de datos**: `globalPedidos` (array global, `index.html:27813`), poblado por listener en `index.html:34690-34770` que lee `fbDb.collection('pedidos')` sin filtro de `closedAt`.
- **Snapshot externo**: **NO existe** `app_config/backorderBySkuApp` ni `app_config/backorder_snapshot` (verificado — ambos retornan `exists=false` en el dump).
- **Subtítulo "datos SAP cada 30 min"**: literales en `index.html:6183`, `15261`, `15266`. Refiere al cron `sync-sap-catalog-stock.yml` que refresca `stock_snapshot.updatedAt` cada 30 min. **Pero el modal NO lee de `stock_snapshot` para la demanda** — solo para el stock físico cap. La demanda sale de `pedidos` (live).

### Fórmula del total

- `index.html:16084` llama `window.__phase0.pure.computeBackorderSkuMap(globalPedidos, mode, filters, deps)`.
- `src/pure/backorder-sku-map.js:509-602` `computeBackorderSkuMap`:
  - Línea 510: `_buildSkuMapRaw(pedidos, deps)` recorre `pedidos`, filtra lines con `state ∈ {BO, ASIG, confirmed}` + `qtyOpen > 0` (líneas 296-307).
  - Líneas 449-488: aplica **FIFO cap por stock físico** — las primeras N unidades hasta `getStockDisponibleVenta(sku)` se consideran "cubiertas" (`qtyAsignada`), el resto `qtyBackorder`.
  - Líneas 523-570: consolida duplicados por `code || nombre` del cliente, suma `qtyAsignada` + `qtyBackorder` + `pedidoIds[]`.
  - Línea 576: `totalPendiente = clientes.reduce((s, c) => s + (c.qtyBackorder || 0), 0)`.
  - Línea 601: devuelve `{skus, totalUnidades, totalClientes}`.
- `index.html:16169-16171`: suma `totalUnidades` y cuenta `totalClientes` para el header.

### El "26" explicado

Mariano reportó: REBORN 16, BROBRO 8, ANDRILI 2 → total 26 **en modo urgente** (`qtyBackorder` sumado).

Mi dump 14:11 UTC NO encuentra REBORN con línea CUDC201HG abierta:

```
BO:        ANDRILI 2u (createdAt 2026-10-15, vigente, qtyOpen>0)
confirmed: BAUTISTA 2u, LAMORA 1u, OROZA 1u, BROBRO 8u (todas qtyOpen>0, pero >7d → NO vigentes TTL)
ASIG:      GRAUBERGER 1u (vigente)
Total crudo (sin TTL):   15u
Total post FIFO cap=7:  depende del orden FIFO.
```

**El Modal Backorder NO filtra por TTL** (no llama a `lineReservesStock`) — toma todas las líneas con `qtyOpen > 0` y estado activo. Entonces el "26" original tenía:

- REBORN 16u en algún state (probablemente confirmed con qtyOpen activo, SAP sin facturar).
- BROBRO 8u (confirmed, está hoy también).
- ANDRILI 2u (BO).

Entre 10:50 y 14:11 UTC alguna de las líneas de REBORN (16u) se cerró: facturada (SAP → `invoiced`), cancelada, o la unidad pasó a `qtyOpen=0`. **No es un bug del modal** — es que la fuente es live y el estado cambió.

### Diferencias con lo que debería mostrar el breakdown

El Modal Backorder **NO aplica TTL** → cuenta confirmed de 58 días (BAUTISTA), 34 (LAMORA), 29 (OROZA), 15 (BROBRO) como "demanda pendiente".

Según §36/§37/§38:
- BO vigente: ANDRILI 2u (6d atrás) ✓.
- confirmed vigente (dentro TTL 7d): **ninguna**. BROBRO 2026-10-06 = 15d atrás → expirado.
- ASIG vigente: GRAUBERGER 1u (13d atrás pero asigAt reciente) — depende del asigAt real.

**Interpretación**: el Modal Backorder muestra **demanda nominal cruda** (todo lo que todavía figura con `qtyOpen > 0` en pedidos activos, sin importar la edad). Es útil operacionalmente ("estos clientes todavía esperan") pero NO coincide con "reservadas que bloquean stock" (que sí aplica TTL).

En el breakdown unificado, esto va a corresponder al concepto `backorderApp` (BO vigentes, con TTL §37 90d) + un concepto separado `demandaStale` o similar si Mariano quiere ver TODA la cola, independiente de TTL. **Decisión arquitectónica para E1**: `getStockBreakdown` expone `backorderApp.total` (con TTL §37 aplicado) + opcionalmente `backorderApp.stale` (sin TTL) para que el Modal Backorder modo urgente lo use.

---

## 2. Modal Reparto

### Fuente y fórmula

- **Trigger**: `index.html:*` botón "Reparto" (admin) que llama `openRepartoModal()`.
- **Listener**: `index.html:20235-20254` `_repartoSubscribe()` → `fbDb.collection('ingresos_reparto').where('status', 'in', ['pending', 'in_progress']).orderBy('detectedAt', 'desc').onSnapshot(...)`.
- **Variable local**: `_repartoIngresos` (array).
- **Renderer**: `index.html:20262+` `_repartoRender()`:
  - Filtro `_withSnap` (`index.html:20272-20274`): `i.clientesBO.length > 0` (snapshot con clientes).
  - Filtro `_hideNoStock` (`index.html:20280-20283`): checkbox "Ocultar SKU sin stock físico" (default ON) usa `_repartoStockFisico(ing) > 0`.
  - Filtro search `_matchesRaw` (`index.html:20284-20291`): por SKU o clientName.
- **Stock físico mostrado por card**: `index.html:20356` `_repartoStockFisico(ing) = getStockDisponibleVenta(ing.sku)` (stock dep 11 actual).
- **Chip "Demanda"**: `index.html:20454-20459` suma `_snapClis[].qtyBackorder` + cuenta clientes del **snapshot congelado al momento del reparto** (no live).

### "0 resultados para CUDC201HG" explicado

Al 10:50 UTC, cuando Mariano abrió el modal:
- Doc `XqBxRRu78WLwmZx0K6Gd` (migration-v1278, qtyIng=8) estaba **`status='in_progress'`** con 2 assignments aplicadas por Pablo (3u + 1u). Pero `clientesBO=[]` → filtro `_withSnap` lo esconde.
- Doc `kBIQuz7yqUsCCeD5nnr1` (reconciliation 13:28 UTC) **todavía no existía**.
- Doc `wXqG9ZezQpJYJRA8yF44` (reconciliation 13:50 UTC) **todavía no existía**.

→ 0 resultados. Correcto para el estado del momento.

**Post-loop (dump 14:11 UTC)**:
- `XqBxRRu78WLwmZx0K6Gd`: `status='done'`, `closedAt=2026-10-21T13:28:15.974Z`, `closedReason='migration_doc_sin_clientes_cerrado_admin_2026-10-21'`. **✓ Verificado cerrado** (gate E0).
- `kBIQuz7yqUsCCeD5nnr1`: `status='done'` (cerrado también porque fue duplicado por tiebreak con `wXqG9...`).
- `wXqG9ZezQpJYJRA8yF44`: `status='pending'`, `qty=6`, `clientesCount=1`. **Activo y visible en el modal ahora**.

---

## 3. Popup Master "Stock del SKU"

### Fuente y fórmula

- **Trigger**: handler que abre el popup al clickear SKU en Master de productos (línea exacta pendiente de pin — búsqueda directa requerida en E2 cuando se refactorice).
- **Fórmulas**:
  - **físico dep 11**: `getStockDisponibleVenta(sku)` lee `stock_snapshot.warehouseBreakdown[sku]['11']` → **7** ✓ (coincide con dump).
  - **tránsito dep 12**: lee `stock_snapshot.warehouseBreakdown[sku]['12']` → **24** ✓.
  - **backorder = 11**: suma `qtyOpen` de líneas `state='BO'` sin TTL. Hoy sería **ANDRILI 2u + (en 10:50 había REBORN+otros) → 11u era el total crudo BO al momento**.
  - **asignado = 1**: `getStockDesglose(sku).breakdown.ASIG` = GRAUBERGER 1u (vigente con TTL 7d) ✓.
  - **libre = 0**: `getStockRealmenteDisponible(sku) = max(0, 7 - comprometido)`. Si confirmed=12 + BO=11 + ASIG=1 = 24, entonces `max(0, 7-24)=0` ✓.

### Diferencias con el breakdown

- "backorder = 11" es sumatoria BO sin TTL. El breakdown va a mostrar `backorderApp.total` **con TTL §37 (90d)**. En CUDC201HG hoy (14:11): BO vigente = 2u (ANDRILI 6d) → **el popup mostraría 2, no 11**.
- "libre = 0" es correcto si contamos todas las reservas crudas. Con TTL: `fisico=7 - (confirmed vig 0 + BO vig 2 + ASIG vig 1) = 4` → **el popup actual oculta libre real**.

---

## 4. Modal Pedido en espera (ORDEN 474 Cabrera)

### Fuente y fórmula

- **Renderer**: `index.html:24000-24300` (región de la tabla waitlist dentro del modal pedido en espera).
- **Columnas**:
  - "Stock completo (dep 11)" → `index.html:24124` `stockDep11Only = getStockDisponibleVenta(r.code)` → **7** ✓.
  - "Reservadas" (post v1384 — ver v1390 que lo refactorizó): `index.html:24205` `_desgTotal = desg.comprometido` donde `desg = getStockDesglose(r.code)` → suma confirmed + BO + ASIG + WAITLIST_CPST con TTL aplicado.
  - Tooltip: breakdown confirmed/BO/ASIG/WAITLIST + "de ESTE cliente vs OTROS".
  - Badge "⚠ N en BO" (v1384 línea 24211): si `_bdBO > 0 && stockDep11Only > 0`.
  - "Libre para la venta" → `index.html:24262` `libreVal = r.disponible` (de `getStockPorCliente`).

### "Reservadas 18 / badge 17 en BO / libre 0" explicado

A las 10:50 UTC, Cabrera consultando ORDEN 474 con línea CUDC201HG:
- `getStockDesglose('CUDC201HG')` con TTL post-§37 (BO 90d) + §38 (confirmed hard cap):
  - BO vigentes: ANDRILI 2u + lo que había en 10:50 (REBORN quizás) = **17u** → **coincide con el badge**.
  - ASIG vigente: GRAUBERGER 1u.
  - confirmed vigentes: 0 (todas >7d).
  - **Total reservadas** = 17 + 1 + 0 = **18** → coincide.
- Libre = `max(0, 7 - 18) = 0` → coincide.

El Modal Pedido en espera **sí aplica TTL** (vía `getStockDesglose` que llama `lineReservesStock`), coincidente con §37.

### Diferencia con dump 14:11

Hoy (14:11), BO vigente es solo ANDRILI 2u (REBORN desapareció entre 10:50 y 14:11 — ver §1). Entonces hoy Cabrera vería:
- Reservadas = 2 BO + 1 ASIG = 3
- Badge "⚠ 2 en BO"
- Libre = max(0, 7-3) = 4

**Esto es dinámica normal del listener live**, no un bug.

---

## 5. Modal Stock Asignado

### Fuente y fórmula

- **Trigger**: `index.html:3973` `#asignacion-backorder-btn → openAsignacionBackorderModal()` (es el mismo modal Backorder en modo `'asignacion'`).
- **Modo asignación**: `index.html:15261` subtítulo diferente, y `computeBackorderSkuMap(..., 'asignacion', ...)` suma `qtyAsignada` en vez de `qtyBackorder`.
- **Filtro ASIG específico**: `index.html:24181-24191` cuenta solo state='ASIG' + `_lrsFn(_l, _nowMs, _p)` (lineReservesStock) + bypass TTL si `asigAt<=15d`.

### "1 unidad GRAUBERGER" explicado

GRAUBERGER tiene `pedido=pNYbD1zUOWCVz6vsKcCx line=23` con `state='ASIG'`, `qtyOpen=1`, `createdAt=2026-10-08T00:06:44 UTC` (13d atrás).

Interesante: el `asigAt` crudo no viene en mi dump en texto (es un campo del l, no del pedido). Pero el modal usa ese valor:
- Si `asigAt` es reciente (ej. post-reparto Pablo del 2026-10-17 según el audit anterior), entra con TTL vigente.
- Si `asigAt` es `null` o viejo, puede estar en el bypass `<=15d`.

En cualquier caso, **1u GRAUBERGER coincide** con mi dump en 14:11 (ASIG vigente = 1u).

---

## 6. Verificación doc fantasma CUDC201HG

Doc `XqBxRRu78WLwmZx0K6Gd` (migration-v1278 con 2 assignments de Pablo):

```
status=done
closedAt=2026-10-21T13:28:15.974Z
closedReason=migration_doc_sin_clientes_cerrado_admin_2026-10-21
assignments=[
  {pedidoId: vWGmFybKcB0yf4k3tAiU, lineIndex: 41, qtyAsignada: 3},
  {pedidoId: pNYbD1zUOWCVz6vsKcCx, lineIndex: 23, qtyAsignada: 1}
]
```

✓ **Cerrado correctamente**. Las 2 assignments preservadas intactas. No requiere acción adicional en E0.

---

## 7. Call-sites completos (archivo:línea)

Para que E1 (`getStockBreakdown`) y E2 (refactor) tengan la lista completa:

### Modal Backorder
- `index.html:3972-3973` triggers
- `index.html:15341-15359` openers
- `index.html:15985-16450` `renderBackordersTab`
- `index.html:16084` llamada a `computeBackorderSkuMap`
- `src/pure/backorder-sku-map.js:175-496` `_buildSkuMapRaw`
- `src/pure/backorder-sku-map.js:509-602` `computeBackorderSkuMap`
- `index.html:27813` `var globalPedidos`
- `index.html:34690-34770` listener `pedidos_all`

### Modal Reparto
- `index.html:20225-20233` `closeRepartoModal`
- `index.html:20235-20254` `_repartoSubscribe`
- `index.html:20262+` `_repartoRender`
- `index.html:20356-20362` `_repartoStockFisico`
- `index.html:20450` chip "Stock"
- `index.html:20454-20459` chip "Demanda"

### Popup Master Stock del SKU
- **Pendiente de localizar** en E2 (grep `openStockModal|showStockPopup|_renderStockDetail|_productStockModal`).

### Modal Pedido en espera
- `index.html:6725-6727` headers "Stock completo", "Reservadas", "Libre"
- `index.html:24124-24126` `stockDep11Only`
- `index.html:24137-24142` `desg = getStockDesglose(...)` + `porCli = getStockPorCliente(...)`
- `index.html:24160-24198` cálculo `_rawCount` ASIG con TTL
- `index.html:24205-24240` celda tdReserv + tooltip + badge BO (v1384)
- `index.html:24262-24285` celda tdLibre + sub-línea + tooltip

### Modal Stock Asignado
- `index.html:3973` trigger
- `index.html:15352-15359` `openAsignacionBackorderModal`
- `index.html:15261` subtitle 'asignacion'
- `index.html:24181-24191` filtro ASIG + TTL bypass 15d

### Sidebar mapa (cards waitlist con has-exceed)
- `src/pure/waitlist-has-exceed.js` (v1389) `computeHasExceed`
- `index.html:20047-20072` call-site

### Reenrich pending / confirmPedido
- `index.html:17023+` `_cpstRenderPreview`
- `index.html:17055-17078` cálculo disp CPST (fórmula por cliente §35)
- `index.html:17079` `qtyAjustada = min(sk.qty, disp)`
- `index.html:19810-19824` `renderRevisionExcel` (modal preview Excel)
- `index.html:27268-27290` `persistPendingEntry` (fórmula por línea §33/§35)
- `index.html:34913-34923` `doConfirmPedido`

### Wrappers window actuales
- `index.html:7238-7251` `window.getStockRealmenteDisponible`
- `index.html:7253-7261` `window.getStockDesglose`
- `index.html:7266-7278` `window.getStockPorCliente`
- `index.html:7285-7299` `window.getStockUtilizableParaClienteExAsig`

---

## 8. Decisiones arquitectónicas que informa E0 para E1

1. **Fuente del "backorder" del Modal Backorder**: NO es un snapshot (`backorderBySkuApp` no existe). Es `globalPedidos` filtrado sin TTL. En `getStockBreakdown` esto va como `backorderApp.{totalConTTL, totalSinTTL}` (dos sub-conceptos):
   - `totalConTTL`: suma BO con `lineReservesStock` aplicado (reglas §37 90d).
   - `totalSinTTL`: suma BO cruda, cualquier edad. **Esto es lo que muestra Modal Backorder hoy**.

2. **Modal Backorder cuenta confirmed también** (no solo BO). En `getStockBreakdown` el modal consumiría:
   - `backorderApp.totalSinTTL` + `confirmadasSinFacturar.totalSinTTL` combinados.
   - **O renombrar el modal**: "Backorder + confirmed sin facturar" (más honesto) — pero fuera de scope si rompe UX.

3. **Popup Master "backorder=11"**: hoy es BO crudo sin TTL. Tras el refactor, mostraría `backorderApp.totalConTTL=2` (ANDRILI). Es un cambio de semántica — Mariano debe decidir si acepta.

4. **"demanda SAP sin cubrir"** NO existe hoy como campo. **Mi plan original lo incluía como fuente externa**, pero la realidad es: NO hay fuente SAP de demanda sin cubrir. El Modal Backorder llama "SAP" a lo que en realidad es `pedidos` live. Decisión para E1:
   - **Opción A**: eliminar `demandaSapSinCubrir` del breakdown. Renombrar modal "Backorder" → "Demanda nominal" (sin TTL).
   - **Opción B**: mantener `demandaSapSinCubrir` como alias de `backorderApp.totalSinTTL + confirmadasSinFacturar.totalSinTTL` para preservar el nombre histórico.
   - **Recomendación**: Opción B. Preserva nombre + añade claridad del tooltip.

5. **TTL es la variable principal**: hoy cada pantalla aplica TTL diferente (Modal Backorder = none, Pedido en espera = sí, Popup Master = mixto). `getStockBreakdown` expone AMBAS cantidades por bucket (`.conTTL` y `.sinTTL`) para que cada pantalla elija explícitamente.

---

## GATE_E0_OK

```
test -f docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md ✓
grep 'Modal Backorder' ✓
grep 'Modal Reparto' ✓
grep 'Popup Master' ✓
grep 'Pedido en espera' ✓
grep 'Stock Asignado' ✓
grep 'archivo:' ✓
XqBxRRu78WLwmZx0K6Gd status=done ✓
```

**GATE_E0_OK**
