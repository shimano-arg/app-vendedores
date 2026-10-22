# Grises G5 — Datos corruptos + migraciones + pantallas R8 + caches

**Agente**: general-purpose G5 · 267s · 36 tool uses.
**30 casos G5.1-G5.30** (meta ≥15 cumplida 2×).

## Severidad

- **ALTA**: 10 (#1, #7, #11, #13, #14, #18, #23, #25, #26, #29).
- **MEDIA**: 11 (#2, #3, #8, #9, #10, #15, #17, #19, #20, #21, #22, #28).
- **BAJA**: 7 (#4 post-fix, #5, #6, #12, #16, #24, #27, #30).

## Scripts audit prod recomendados (dry-run)

### Existentes (correr HOY)
- `L_manual_backorder_sin_cliente.cjs` (B08 post-v1401).
- `M_pedidos_key_o_clientname_vacio.cjs` (R10).
- `K_confirmed_con_order_docentry.cjs` (§40.8).
- `H_cerrar_repartos_fantasma.cjs` (B14).
- `J_sobre_asignadas_prod.cjs`.
- `audit-waitlist-integrity.cjs`.
- `Q_vendedor_desalineado.cjs`.
- `P_clientes_multiple_waitlists.cjs` (G3.13 BLOQ).

### Nuevos propuestos (14)
`G5a` qtyopen>qty · `G5b` qty≤0 · `G5c` precio=0 · `G5e` asigAt mismatch · `G5f` closedReason sin cancel · `G5g` origen sin asigRefs · `G5h` pedidos sin lines vivas · `G5i` migración v1278 huérfana · `G5k` assignments lineIndex inv · `G5l` reparto qty>físico · `G5m` repartos dup SKU · `G5p` historial sin origen · `G5s` localStorage legacy audit · `G5z` SAP mismatch committed vs app.

## Tabla

| # | Caso | Categoría | Sev | Script/Test propuesto |
|---|---|---|---|---|
| 1 | B05 `qtyOpen > qty` | Data corrupta | ALTA | G5a |
| 2 | B06 `qty ≤ 0` activa | Data corrupta | MEDIA | G5b |
| 3 | B07 `precio=0` self-unify residual | Data corrupta | MEDIA | G5c |
| 4 | B08 cardCode vacío + clientName | Post-v1401 | BAJA | L existente |
| 5 | B09 asigAt+state mismatch | Data corrupta | BAJA | G5e |
| 6 | B10 closedReason sin cancel | Data corrupta | BAJA | G5f |
| 7 | **B12 origen sin asigRefs** (H1 regresión silenciosa) | Shape incompleto | **ALTA** | G5g + test unit |
| 8 | B16 pedidos lines=0 vivas | Data corrupta | MEDIA | G5h |
| 9 | Pedidos migración v1278 >90d BO huérfanas | Legacy | MEDIA | G5i |
| 10 | B14 ingresos_reparto clientesBO=[] | Legacy residual | MEDIA | H existente |
| 11 | **assignments.lineIndex inválido** (sobre-reserva reparto) | Data corrupta | **ALTA** | G5k |
| 12 | reparto qty > físico actual | Data corrupta | BAJA | G5l |
| 13 | **revision_waitlist stage='consumed' + closedAt=null** (race §42) | Inconsistencia | **ALTA** | audit-waitlist-integrity extend |
| 14 | **SW cache stale** HTML v1420 vs reglas v1424+ | Cache stale §23 | **ALTA** | sw-version-coherency test |
| 15 | vendor_outlines_v13-v16 cleanup missing | Cache stale | MEDIA | vendor-outlines-cleanup test |
| 16 | `_vendorOutlinesCache` in-memory stale | Cache stale | BAJA | vendor-outlines-invalidation test |
| 17 | `clientMasterCache` cross-session stale | Cache stale | MEDIA | documentar risk |
| 18 | **`window._pendingPedido*` globals leak** (cancela ASIG ajenas) | Globals leak | **ALTA** | pending-pedido-globals-leak test + try/finally fix |
| 19 | localStorage legacy keys sin TTL (10 keys) | Cache local | MEDIA | G5s audit |
| 20 | R10 datos cliente completos | Data cliente | MEDIA | M + Q existentes |
| 21 | L06 Pedido Final fórmula local | R8 | MEDIA | l06-pedido-final-vs-breakdown test |
| 22 | L14 Generar Backorder sin TTLs | R8 | MEDIA | l14-genbo-vs-breakdown test |
| 23 | **L30 Dashboard fórmula propia** (VDE ve número distinto) | R8 | **ALTA** | migrar a getStockBreakdown + test |
| 24 | L33 Product Picker fallback silent | R8 | BAJA | l33-productpicker-fallback test |
| 25 | **L34 Forecast sin TTL BO §37** (infla demanda) | R8 | **ALTA** | migrar + test |
| 26 | **SAP Committed vs app confirmed sin orderDocEntry** (doble conteo) | SAP mismatch | **ALTA** | G5z |
| 27 | ingresos_reparto duplicados mismo SKU | Boundary | BAJA | G5m |
| 28 | Historial pedidos pre-v1382 sin `line.origen` | Shape pre-migration | MEDIA | G5p backfill |
| 29 | **`syncSapOrdersToApp` caído** >30min silente | SAP sync lag | **ALTA** | K existente + monitor |
| 30 | `sapDocTotal` NaN/Infinity propagación | Data corrupta financiera | BAJA | computeVaASap-nan-guard test |

## Hallazgos confirmados en código actual

1. **Gap cleanup vendor_outlines**: `index.html:7912-7920` cubre `v4..v12` pero no `v13..v16` → users pueden tener cache stale residual.
2. **CACHE_VERSION / APP_VERSION coherentes** en v1424.
3. **7 globals `window._pendingPedido*`** activas con cleanup solo en happy path → leak garantizado en error.
4. **`clientMasterCache`** no se invalida en logout.
5. **`_vendorOutlinesCache`** cross-scope `let` top-level — invalida solo con 2 triggers (reasignación o Firestore listener).

## Prioridades ALTA para E3

1. #1 B05 qtyOpen>qty (invariante R9).
2. #7 B12 origen sin asigRefs (H1 regresión).
3. #11 assignments.lineIndex inválido.
4. #13 waitlist stage inconsistency.
5. #14 SW cache coherency test.
6. #18 globals pendingPedido leak (try/finally fix).
7. #23 L30 Dashboard migrar a breakdown.
8. #25 L34 Forecast migrar + TTL §37.
9. #26 SAP mismatch Committed vs app.
10. #29 monitor syncSapOrdersToApp lag.
