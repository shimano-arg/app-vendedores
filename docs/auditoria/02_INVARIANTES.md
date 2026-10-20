# E2 — Veredicto por invariante I1-I7

> **Tests:** `tests/unit/audit/invariants.test.js` — 19 tests (14 PASS + **5 FAIL** que son evidencia).
> Los tests VIOLA son **RED (TDD)** — fallan hasta que se arregle el bug; cuando se haga el fix, pasan a verde sin tocar el test.

## Resumen

| ID | Invariante | Veredicto | Tests FAIL (evidencia) |
|----|------------|-----------|-------------------------|
| I1 | Disp = Físico(dep 11) − Reservado ≥ 0, Físico solo dep 11 | **CUMPLE** | 0 |
| I2 | Pedido ex-ASIG: Utilizable(C) = Disp + Reservado(C) | **VIOLA** | 2 (bug root cause: H1) |
| I3 | Reserva libera 1 vez al enviar a SAP | **NO VERIFICABLE** vía unit (requiere emulator CF triggers) | 0 — ver E5 query diagnóstico A |
| I4 | Unidad nunca en 2 estados a la vez | **CUMPLE** | 0 |
| I5 | SKU con Físico>0 + BO pendiente → Reparto, no Backorder | **NO VERIFICABLE** vía unit (depende de modal render) | 0 — ver E5 query diagnóstico B |
| I6 | No autogenerar BO si Disp cubre al momento del envío | **VIOLA** | 2 (bug root cause: H1 + flag OFF v600) |
| I7 | Pedido parcial se parte: cubierto a SAP, resto a BO | **VIOLA** | 1 (bug root cause: flag OFF v600) |

**Total VIOLA documentados: 5. Total tests FAIL: 5. ✅ Gate E2 verde.**

Agrupados por root cause:

| Root cause | Afecta invariantes | FAIL totales |
|------------|--------------------|---------------:|
| **H1** — `doConfirmPedido getDisp` no pasa cardCode al calcular disp | I2 (×2), I6 (×1) | 3 |
| **FLAG-OFF-v600** — kill switch `localStorage.split_enabled='0'` sigue honrado | I6 (×1), I7 (×1) | 2 |

---

## I1 — Disp = Físico − Reservado ≥ 0 — **CUMPLE**

Fórmula central en `src/pure/stock-realmente-disponible.js:212-261` (`getStockRealmenteDisponible`):
```js
return Math.max(0, fisico - comprometido);
```

**Evidencia (4 tests PASS):**
- 3 físico / 0 reservas → disp 3.
- 1 físico / 2 BO → disp max(0, 1-2) = 0.
- Pedidos con `closedAt` se ignoran.
- `getStockFisico` se consulta una sola vez por SKU (no suma depósitos extra).

Depende de que el wrapper runtime (`index.html:7063-7076`) apunte `getStockFisico` a `getStockDisponibleVenta` que lee solo dep 11. **No se audita runtime en E2** (es responsabilidad de E5).

---

## I2 — Pedido ex-ASIG: Utilizable(C) = Disp + Reservado(C) — **VIOLA**

**Veredicto: VIOLA**. Root cause: **H1** (ver `03_HIPOTESIS.md`).

Fórmula teórica (prompt): la reserva del propio cliente NO se resta en su contra.
Fórmula actual del call-site `doConfirmPedido` (`index.html:34720-34722`): `window.getStockRealmenteDisponible(sku)` SIN pasar cardCode.

### Manifestación A — `doConfirmPedido getDisp` devuelve 0

**Test FAIL:** `invariants.test.js > I2 > VIOLA I2 (RED): el call-site de doConfirmPedido deberia devolver utilizable(OESTE)=1`

```
AssertionError: expected +0 to be 1
```

Escenario: fisico=1, Oeste ASIG 1u. `getStockRealmenteDisponible(STRADIC, deps)` devuelve 0 porque la propia ASIG de Oeste cuenta como reserva.

### Manifestación B — `splitPedidoLine` devuelve state=BO en lugar de confirmed

**Test FAIL:** `invariants.test.js > I2 > VIOLA I2 end-to-end (RED): splitPedidoLine deberia dar state=confirmed qty=1`

```
AssertionError: expected 'BO' to be 'confirmed'
```

Cadena completa: el disp=0 de la manifestación A alimenta `splitPedidoLine(qty=1, disp=0)` → caso 2 (`disp <= 0`) → 1 línea `state='BO'`.

**Fórmula ESPERADA (post-fix H1):**
```
Utilizable(C) = min(fisico, firmesPropias(C) + residual)
donde:
  firmesPropias(C) = Σ qtyOpen de líneas ASIG+confirmed VIVAS del cliente C
  residual         = max(fisico − reservadasPorCliente(C) − reservadasPorOtros, 0)
```
Esta fórmula ya existe en el preview CPST (`index.html:16872-16898`, v1362). El fix sería portarla al call-site de `doConfirmPedido`.

**Impacto:** síntoma reportado (3u en SAP, pedido 100% BO) es exactamente este bug cuando el pedido ex-ASIG tiene qty ≤ Reservado(propio cliente).

---

## I3 — Reserva se libera 1 vez — **NO VERIFICABLE** vía unit

Involucra 3 caminos de liberación (ver `01_MAPA_FLUJO.md` PASO 8):
1. Cliente-side cancel al confirmar pedido ex-ASIG (`index.html:34881-34967`).
2. Server-side CF `syncSapInvoicesToApp` → `applyInvoiceMatch` (`functions/core/invoice-sync-core.js:276-402`).
3. Recycle/cancel manual (`functions/core/asig-recycle-core.js:67-202`).

**Tests parciales que SÍ PASAN:**
- `lineReservesStock(linea invoiced) = false` — una línea invoiced ya no reserva.
- `lineReservesStock(linea cancelled) = false` — cancelled tampoco.
- `lineReservesStock(linea confirmed VIVA) = true` — hasta que facture, sigue reservando.

**Lo no verificable:** que las 3 vías no se solapen (ej. mismo ASIG cancelado por camino 1 + invoiced por camino 2 → qtyInvoiced incorrecto). Requiere firestore emulator + CF triggers.

**Query diagnóstico A en E5** mide reservas vivas (`state='ASIG'` o `'confirmed'`) de pedidos ya enviados y facturados en SAP.

---

## I4 — Unidad no en 2 estados — **CUMPLE**

`lineReservesStock` devuelve un único booleano por línea. Enumeración de states → `confirmed`/`BO`/`ASIG` reservan; `invoiced`/`cancelled`/`recycled`/`legacy` no.

**Evidencia (2 tests PASS):**
- Enumeración de los 7 states con el veredicto esperado.
- `getStockRealmenteDisponible` cuenta `qtyOpen` una sola vez por línea (fix v1368 2026-10-19 agregó filtro de waitlist CPST para evitar double-count cuando hereda `pedidosOrigenes`).

**Nota:** la unidad puede estar simultáneamente en el pedido original (ASIG) y en un waitlist CPST (via `source='stock-asignado-batch'` + `pedidosOrigenes`). Es intencional (política v1280): la ASIG queda viva hasta que el VDE confirma el waitlist, y el filtro v1368 impide que el CPST sume reserva adicional. Si se saltea el filtro (CPST sin `pedidosOrigenes`), hay double-count — es el edge case que v1368 corrige.

---

## I5 — SKU Físico>0 + BO → Reparto no Backorder — **NO VERIFICABLE** vía unit

El modal "Reparto" (`#reparto-modal`, `index.html:19997+`) se alimenta de `ingresos_reparto/` que crea la CF `onDep11IncreaseCreateReparto`. El modal "Backorder" (`renderBackordersTab mode='urgente'`) filtra por `state='BO' + qtyOpen>0` sin mirar físico.

Diseño actual (post-v1278): **un SKU con BO vive siempre en Backorder**. Solo aparece en Reparto cuando entra un **delta positivo** al dep 11 (crea un `ingresos_reparto`). Si el stock ya estaba en dep 11 antes del BO (ej. BO viejo + stock que no se repartió), no hay delta reciente → no aparece en Reparto. **GAP operativo** documentado como FINDING-05 (ver `01_MAPA_FLUJO.md`).

**Query diagnóstico B en E5** mide SKUs en `backorderBySkuApp` con Físico dep 11 > 0 que NO están en `ingresos_reparto` activo.

---

## I6 — No autogenerar BO si Disp cubre — **VIOLA**

Dos manifestaciones distintas:

### Manifestación A — Encadenada con H1

**Test FAIL:** `invariants.test.js > I6 > VIOLA I6 (RED, encadenado con H1): pedido ex-ASIG deberia ir a confirmed, no BO`

Mismo escenario que I2 Manifestación B. Como `getStockRealmenteDisponible` devuelve 0 cuando el propio cliente tenía 1u ASIG, el split cae en caso `disp <= 0` y la línea entera queda BO. Fix H1 corrige ambos (I2 y I6-A).

### Manifestación B — Kill switch flag OFF v600 (riesgo persistente)

**Test FAIL:** `invariants.test.js > I6 > VIOLA I6 (RED, flag OFF kill switch v600): parcial disp=5 qty=10 deberia partir en 5+5, no 0+10`

Caso v600 CHALPAC pre-fix: con `localStorage.split_enabled='0'`, el ternario legacy `qty > 0 && disp >= qty ? 'confirmed' : 'BO'` (`src/pure/pedido-split.js:87-89`) sigue vivo. Si el browser del VDE tiene esa clave (p.ej. por testing viejo), **todos** sus pedidos con stock parcial van 100% BO. SAP recibe 0 unidades aunque Disp cubra parte.

Root cause: el kill switch nunca se removió (`index.html:7023-7029` default ON pero respeta `'0'`). Sin telemetría que detecte browsers afectados.

---

## I7 — Parcial se parte — **VIOLA**

**Test FAIL:** `invariants.test.js > I7 > VIOLA I7 (RED, flag OFF): qty 10 disp 7 deberia partir en 7+3, no 1 linea 100% BO`

Mismo root cause que I6-B (flag OFF kill switch). Con flag ON (default), I7 **CUMPLE** (test PASS: `qty 10 disp 7 → 2 líneas {7 confirmed, 3 BO}`).

---

## Conclusión

**2 root causes activos:**

1. **H1** — fórmula de disp sin cardCode en `doConfirmPedido getDisp` → viola I2 e I6 → es la explicación directa del síntoma reportado (3u en SAP → 0 enviadas, 3 en BO).
2. **FLAG-OFF-v600** — kill switch legacy sigue honrado → viola I6 e I7 → riesgo latente para browsers con la clave seteada.

**I3 e I5** quedan como pendientes de verificación en E5 (query diagnóstico).

**Propuestas de fix:** `06_PROPUESTAS_FIX.md` (E6).
