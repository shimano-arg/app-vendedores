# fix-pendientes-21-10 — Plan de cierre

**Goal:** Cerrar 4 ítems pendientes del 21/10 — popup Stock del SKU migrado al breakdown, decisión D3 doble conteo SAP, tabla de pendientes con cierre de los chicos, y suite completa en verde sin excepciones.

**Rama:** `fix-pendientes-21-10` desde `main`.

**Metodología:** superpowers (brainstorming → systematic-debugging → test-driven-development → verification-before-completion). Plan primero (este doc), 1 pausa humana en el punto 2 D3 pre-merge si el efecto en prod supera 50u.

---

## Punto 1 — Popup "Stock del SKU" al breakdown

**Qué**: la última pantalla que calcula por su cuenta usando `computeBackorderSkuMap` legacy. Migrarla a `getStockBreakdown` + `STOCK_LABELS` del mismo pure que todas las demás.

**Dónde** (`index.html`):
- `openStockModal` en `index.html:30963+`.
- Bloque de cómputo en `index.html:30855-30889` que llama a `computeBackorderSkuMap`.

**Shape de salida en el popup** (coinciden con `STOCK_LABELS` ya definido):
- Stock físico (dep 11) — `fisicoDep11`
- En tránsito (dep 12) — `transitoDep12`
- Back order (app) — `backorderApp.total`
- Confirmadas sin facturar — `confirmadasSinFacturar.total`
- Asignadas — `asignadas.total` (nominal; opcionalmente agregar `totalEntregable` + `totalSobreAsignada` v1395 §40.3)
- Reservadas — `reservadasTotal` (cap por físico v1394)
- Libre para la venta — `libre`
- Pendientes de reparto — `pendienteReparto.qty` (alias de `repartoAbierto` v1392)

**Eliminación de `demandaSapSinCubrir`**:
- `src/pure/stock-breakdown.js`: borrar el campo del shape (ya es `null` siempre en v1392); borrar `includeStale` opt + buckets stale.
- Mirror `functions/core/pedido-snapshot-core.js`: idem.
- `STOCK_LABELS`: no incluye el campo (ya está limpio desde v1393).
- Tests legacy: ajustar los que esperan `demandaSapSinCubrir: null` en el shape → sacar expectativa.
- Bumpear `_version` 5 → 6.

**Test integración**: fixture con 1 SKU y 2 pedidos (uno ASIG + uno BO). Correr el breakdown que usa el popup y el que usa la lista de espera (`_renderWaitlistCard` tooltip línea 24448+); verificar `fisicoDep11`, `libre`, `reservadasTotal`, `asignadas.total`, `backorderApp.total` idénticos.

**Verificación prod post-deploy** (en informe):
- `CUDC201HG` y `EXGC80HBAR2AR`.
- Comparar popup + modal Pedidos en Espera + modal Backorder.

---

## Punto 2 — D3 doble conteo con SAP

### Datos disponibles (10 líneas)

- Cada SQ enviada a SAP por `auto-send-sap-core` lleva `NumAtCard = pedidoId` (Firestore doc id).
- `functions/core/sync-sap-orders-core.js` (v1102, 2026-09-30) corre scheduled cada 60min. Busca `/Orders?$filter=NumAtCard eq '<pedidoId>'` para cada pedido con `transferidoSAP.docEntry` set y sin `transferidoSAP.orderDocEntry`.
- Al encontrar el SO, escribe `pedido.transferidoSAP.orderDocEntry` + `orderDocNum` en Firestore.
- Entonces la app **sí sabe** cuándo una SQ se convirtió en orden: `pedido.transferidoSAP?.orderDocEntry != null`.
- `invoice-sync-core.js` escribe `pedido.transferidoSAP.invoiceDocEntry` cuando se factura.
- Conclusión: la data existe sin sync nuevo. **Se puede implementar**.

### Hallazgo pre-conteo (en informe)

Antes del fix, correr script `scripts/audit/K_confirmed_con_order_docentry.cjs` (read-only prod) que cuenta cuántas líneas `state='confirmed' + asigReserva!=false + lineReservesStock=true + pedido.transferidoSAP.orderDocEntry` están reservando hoy. Reportar total líneas, total unidades, lista top 50 por SKU.

### Fix

**Pure** `src/pure/stock-realmente-disponible.js:163-193` (función `lineReservesStock`, rama `state === 'confirmed'`):

```js
if (state === 'confirmed') {
  if (line.asigReserva === false || line.asigReserva === 0) return false;
  if (!pedido || !pedido.confirmedAt) return false;
  const confirmedAtMs = toMillisSafe(pedido.confirmedAt);
  if (confirmedAtMs === null) return false;
  // v1400 §40.8 D3: si la SQ ya se convirtió en SO en SAP (orderDocEntry presente),
  // SAP ya la descuenta de Available → la app NO debe reservarla también (doble conteo).
  if (pedido.transferidoSAP && pedido.transferidoSAP.orderDocEntry != null) return false;
  const ageDays = (now - confirmedAtMs) / DAY_MS;
  if (ageDays > RESERVA_TTL_DAYS) return false;
  if (ageDays > CONFIRMED_HARD_CAP_DAYS) return false;
  return true;
}
```

**Mirror** en `functions/core/pedido-snapshot-core.js`.

### Pausa humana pre-merge (D3)

Correr `K_confirmed_con_order_docentry.cjs --prod` **después** del fix (local, sin pushear). Si el "libre que sube" por SKU supera 50u para algún SKU, o el total supera 200u, pausar y reportar a Mariano con detalle. Si está dentro del umbral, continuar y pushear.

### Tests

- `tests/unit/audit/confirmed-con-order-docentry-no-reserva.test.js`:
  - Pedido confirmed sin orderDocEntry → reserva (TTL vigente).
  - Pedido confirmed con orderDocEntry set → no reserva (SAP cubre).
  - Pedido confirmed con orderDocEntry + confirmedAt > 7d → no reserva (ya no era por TTL).
  - Idempotencia: segundo read sin cambio.

**CLAUDE.md §40.8** regla nueva: "una línea confirmed con `transferidoSAP.orderDocEntry` presente NO reserva — SAP la cubre en Available".

---

## Punto 3 — Tabla de pendientes del 21/10

### Estado conocido (confirmado por reconocimiento)

| Tarea | Estado | Versión | PR | Qué falta |
|---|---|---|---|---|
| Export "Pendiente de Asignación - Pablo" | Cerrado | v1396 | #1132 | — |
| Descripciones modal "¿Qué querés exportar?" | Cerrado | v1396 | #1132 | — |
| Cards STOCK ASIG dos colores | Cerrado | v1396 | #1132 | — |
| Sobre-asignación FIFO + reconcile log | Cerrado | v1395 | #1131 | — |
| Reversión ASIG→BO al pasar por CPST | Cerrado | v1397 | #1133 | — |
| Borrar de espera CPST modal 2-opciones | Cerrado | v1398 | #1134 | — |
| Liberar reserva al quitar/reducir | Cerrado | v1399 | #1135 | — |

### Dudosos (reconocimiento necesario)

- **"Pedidos undefined" del flujo Generar Backorder** — Mariano no me reportó detalle; grep `_boSkipReview = true` + "Generar Backorder" en `index.html:26125+`. Investigar en Task 3a si hay reporte reciente que yo no manejé. Si es chico, cerrarlo acá; si es grande, estimación.
- **"Asignaciones vencidas que se cancelan solas (§41)"** — CLAUDE.md no tiene §41. Puede referirse a un CF que expira ASIG o a un hallazgo que no se documentó. Investigar en Task 3b: hay un CF `expireStockAsignadoWaitlistsCF` (v1280) que **sí** cancela waitlists CPST a los 7d. Si Mariano se refiere a ASIG en pedidos (no waitlist), eso NO existe automático — las ASIG vencidas se liberan solas en el breakdown por TTL (`lineReservesStock` las excluye), pero las líneas quedan vivas en Firestore con `qtyOpen > 0`. Documentar hallazgo + proponer fix (CF scheduled que las cancele explícitamente) con estimación.

Si cualquier de las 2 dudosas es chico (<30 min de código + test), cerrarlo en la rama. Si es grande, dejar listado + estimación en el informe.

---

## Punto 4 — Fallo pre-existente `reparto.test.js`

**Hallazgo**: el test `rechaza assignment que no matchea con ningun cliente BO` (línea 292) está **desactualizado**. v1343 (2026-10-15) removió la validación "esta en boMap" de `validateRepartoPayload` porque el `clientesBO` es un snapshot stale; la validación real ocurre dentro del `runTransaction` en `applyRepartoManualCore`. El comentario del core (línea 616-622) lo documenta explícitamente.

**Fix**: borrar el test. El flujo real sigue siendo validado por otros tests que ejercitan `applyRepartoManualCore` (ver `tests/functions/reparto.test.js:316+` para `createIngresosRepartoFromDelta` y los demás).

Alternativa (si queremos preservar la validación): escribir un test que ejercite `applyRepartoManualCore` con mocks de `runTransaction` que simulen el fallo del lookup en memoria. Pero esto duplica el testing del transaction (ya cubierto por integration tests en otro bloque). YAGNI → borrar el test.

---

## Secuencia de ejecución

1. **Reparto test fix** (orden: primero porque bloquea CI verde para los commits siguientes).
2. **Punto 1 popup Stock del SKU** (contained, bajo riesgo).
3. **Punto 3 investigación dudosos** (si son chicos, cerrarlos; sino listar).
4. **Punto 2 D3** (último porque tiene pausa humana).

Cada punto = 1 commit (o más si hay sub-tasks). Push + PR único al final con todos los commits + merge con `--admin --squash`.

---

## Entregables al cierre

- Rama mergeada a main con todos los commits.
- GitHub Pages auto-deploy post-merge.
- Si D3 agrega cambios en pure → `firebase deploy --only functions:applyRepartoManualCF,onDep11IncreaseCreateReparto` (reutilizan `lineReservesStock` via `pedido-snapshot-core.js`).
- `docs/auditoria/30_D3_DOBLE_CONTEO_SAP.md` con pre-conteo + hallazgo prod post-fix.
- Informe Cowork en `Desktop\INFORME_COWORK_v1400_fix-pendientes-21-10.md` con:
  - Verificación popup con 2 SKUs reales (CUDC201HG + EXGC80HBAR2AR).
  - Decisión D3 + efecto prod.
  - Tabla pendientes.
  - Explicación del fallo `reparto.test.js`.
- CLAUDE.md §40.8 agregada.
- Suite completa en verde (0 FAIL).
