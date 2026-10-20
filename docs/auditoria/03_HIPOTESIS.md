# E3 — Veredicto por hipótesis H1-H6

> **Tests:** `tests/unit/audit/hipotesis.test.js` — 15 tests PASS.
> Para H1-H4 los tests PASS verifican el bug observado o su ausencia (test ≡ aserto del estado actual). Los tests RED que fallan hasta que se arregle el bug están en `invariants.test.js` (E2).

## Resumen

| ID | Hipótesis | Veredicto | Evidencia |
|----|-----------|-----------|-----------|
| H1 | "Crear Pedido Desde Stock Asignado" resta propia reserva (viola I2) | **CONFIRMADA** | 3 tests + bug reproducido en invariants.test.js (3 FAIL RED) |
| H2 | Reserva no se libera al enviar a SAP (viola I3) | **DESCARTADA** (parcial) + **NO VERIFICABLE** end-to-end | `lineReservesStock` libera invoiced/cancelled OK; query E5-A mide prod |
| H3 | Físico mal leído (otro depósito / snapshot stale) | **DESCARTADA** (parcial) + **NO VERIFICABLE** runtime | pure fn OK; runtime en E5 |
| H4 | Pedido parcial mal partido (viola I7) | **CONFIRMADA** (flag OFF only) / **DESCARTADA** (flag ON) | 2 tests, 2 escenarios |
| H5 | Condición de carrera entre envíos simultáneos | **NO VERIFICABLE** vía unit (requiere orquestación paralela) | Mitigaciones existentes documentadas |
| H6 | Ventana sin protección entre ingreso y reparto (viola O1) | **DESCARTADA** (código actual más protectivo que prompt) | 2 tests |

**Total CONFIRMADAS: 2 (H1 + H4-flagOFF). DESCARTADAS: 2 (H2 + H6). NO VERIFICABLES vía unit: 2 (H5 + partes de H2/H3).**

---

## H1 — Pedido ex-ASIG resta propia reserva — **CONFIRMADA**

**Evidencia primaria (`hipotesis.test.js > H1`):**

```
with fisico=1 + Oeste ASIG 1u:
  getStockRealmenteDisponible(STRADIC) → 0      (bug observado)
  splitPedidoLine(qty=1, disp=0, flagEnabled=true) → [{state:'BO', qty:1}]
  pedido B queda 100% BO → auto 'app_only' → SAP recibe 0 unidades
```

**Fórmula divergente ya identificada:**

| Call-site | Fórmula | Considera cardCode | Valor en el escenario Oeste |
|-----------|---------|---------------------|-----------------------------:|
| Preview CPST (`index.html:16872-16898`, v1362) | `min(fisico, firmesPropias + residual)` | SÍ | 1 ✅ |
| Confirm Pedido B (`index.html:34720`, v1208) | `getStockRealmenteDisponible` (global) | NO | 0 ❌ |

**Impacto:** cuadra exactamente con el síntoma reportado. Un pedido CPST con qty ≤ Reservado(propio cliente) va 100% a BO en lugar de SAP.

**Root cause ubicado:** `window.getStockRealmenteDisponible(sku)` en `index.html:7063-7076` NO toma `cardCode`. El wrapper del split (`index.html:34720`) tampoco lo pasa.

**Fix propuesto (E6):** usar `getStockPorCliente(sku, cardCode)` + sumar `firmesPropias` (misma fórmula que preview CPST).

---

## H2 — Reserva no se libera al enviar a SAP — **DESCARTADA (parcial) + NO VERIFICABLE (end-to-end)**

**Tests PASS en `hipotesis.test.js > H2`:**
- `lineReservesStock({state:'invoiced'})` → `false` ✅
- `lineReservesStock({state:'cancelled'})` → `false` ✅
- TTL 7d: ASIG con `asigAt > 7d atrás` → `false` ✅ (safety net para reservas olvidadas)

**No verificable sin firestore emulator:**
1. `doConfirmPedido._origenesACancelar` (`index.html:34881-34967`) muta cliente-side las ASIG originales a `state='cancelled'`.
2. CF `syncSapInvoicesToApp` → `applyInvoiceMatch` (`functions/core/invoice-sync-core.js:276-402`) marca `state='invoiced'` cuando llega factura SAP.
3. Entre (1) y (2) hay una ventana de ~15 min donde la línea ex-ASIG viajó a SAP pero no se facturó aún. El `state='confirmed'` sigue reservando → correcto (I3 cumple en principio).

**Riesgo residual (query diagnóstico A en E5):** reservas vivas (`state ∈ {ASIG, confirmed}`) de pedidos ya facturados en SAP (lineage via `transferidoSAP.docEntry` + Invoice.BaseEntry). Si hay > 0, hay reservas fantasma.

---

## H3 — Físico mal leído — **DESCARTADA (parcial) + NO VERIFICABLE runtime**

**Tests PASS en `hipotesis.test.js > H3`:**
- `getStockRealmenteDisponible` consulta `getStockFisico` **1 sola vez** por SKU (no suma depósitos). ✅
- Pedidos con `closedAt` se ignoran (safety stale). ✅

**No verificable con unit:**
- `window.getStockDisponibleVenta` (`index.html:7478-7497`) lee `STOCK_WAREHOUSE_BREAKDOWN[sku]['11']`. Que el campo `'11'` sea correctamente el dep 11 depende del pipeline SAP → `scripts/sync_sap_to_firestore.py`. Verificar en query E5 que no haya SKUs con `warehouseBreakdown[11]` vacío y fallback a otros depósitos.

**Note:** `getStockDisponibleVentaNetSap` (`index.html:6644+`) sí resta BO SAP-source y considera `cf_auto`/`cf_auto_partial_stock`. Diferente de `getStockDisponibleVenta`.

---

## H4 — Pedido parcial mal partido — **CONFIRMADA (flag OFF) / DESCARTADA (flag ON)**

**Tests PASS en `hipotesis.test.js > H4`:**
- **Flag ON (default prod)**: `qty 10 disp 7 → 2 líneas {7 confirmed, 3 BO}` ✅
- **Flag OFF (kill switch v600)**: `qty 10 disp 7 → 1 línea 100% BO` ❌ bug

**Reproducibilidad:** cualquier browser con `localStorage.setItem('split_enabled','0')` en la devtools reproduce el bug. No hay telemetría que detecte esos clientes.

**Root cause ubicado:** `src/pure/pedido-split.js:86-90`:
```js
if (!opts.flagEnabled) {
  const state = qty > 0 && disp >= qty ? 'confirmed' : 'BO';
  return [{ ...base, qty, qtyOpen: qty, state }];
}
```

**Fix propuesto (E6):**
- Opción A — remover el flag completamente (`flagEnabled` always true).
- Opción B — telemetría: log si algún browser carga pedidos con `flagEnabled=false`.
- Opción C (más conservadora) — avisar al usuario con alerta si tiene la clave seteada.

---

## H5 — Condición de carrera — **NO VERIFICABLE** vía unit

**Vectores de riesgo documentados:**

1. **`sap-auto-send-listener.js`** — mitigado con `sendingSapLock` TTL 300s + double-check post-createQuotation (v577). Idempotencia SAP-side via `findQuotationByNumAtCard`.
2. **`applyRepartoManualCore`** — mitigado con `runTransaction` + status lock `in_progress` pre-loop.
3. **`doConfirmPedido` NO está dentro de transacción** — el `getDisp` lee `globalPedidos` (snapshot cliente-side). Entre leer disp y commit del pedido, otro cliente puede agregar un BO/confirmed y pisar el stock. **Riesgo real pero bajo** (2 VDEs cargando el mismo SKU simultáneamente).

**Query diagnóstico A en E5** mide overcommit en prod (reservas totales > físico por SKU).

---

## H6 — Ventana sin protección entre ingreso y reparto — **DESCARTADA**

**Test PASS en `hipotesis.test.js > H6`:**
- Fisico=1 + Sur BO 1 + Oeste BO 1 → un cuarto cliente ve `libreParaCliente = 0`. ✅

**Nota de glosario**: el prompt describe un sistema donde BO NO reserva stock físico actual (reserva solo "stock futuro"). El código actual sí cuenta BO como reserva (política v701 "app owns stock" + fix v713.1). El código es **más protectivo** que el prompt → O1 se cumple por diseño conservador.

**Hallazgo tangencial (H6 adyacente, no era H6 original):** el gap operativo del PASO 9+10 (ingresos_reparto marcado `status='done'` con stock sobrante). Documentado en FINDING-05 (`01_MAPA_FLUJO.md`). No es violación de O1 — es GAP operativo distinto.

---

## Conclusión

| Hipótesis | Veredicto | Siguiente paso |
|-----------|-----------|-----------------|
| H1 | CONFIRMADA | Fix en E6 propuesta P1 |
| H2 | DESCARTADA parcial | Query E5-A para end-to-end |
| H3 | DESCARTADA parcial | Query E5-B para runtime |
| H4 | CONFIRMADA (flag OFF) | Fix en E6 propuesta P2 |
| H5 | NO VERIFICABLE unit | Mitigaciones ya existentes + E5 overcommit check |
| H6 | DESCARTADA | Documentar como "nota de glosario" |

**2 bugs CONFIRMADOS** (H1 + H4-flagOFF). Fix candidates documentados en `06_PROPUESTAS_FIX.md` (E6).
