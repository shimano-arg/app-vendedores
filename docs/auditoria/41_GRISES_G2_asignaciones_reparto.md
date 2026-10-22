# Grises G2 — Asignaciones (ASIG) + Reparto

**Agente**: general-purpose G2 · 223s · 13 tool uses.
**18 casos G2.01-G2.18** (15 obligatorios + 3 extras).

## Severidad

- **ALTA**: 7 (G2.01, G2.02, G2.06, G2.09, G2.10, G2.14, G2.15).
- **MEDIA**: 7 (G2.03, G2.04, G2.05, G2.08, G2.13, G2.16).
- **BAJA**: 4 (G2.07, G2.11, G2.12, G2.17, G2.18).

## Tamaño

- **S**: 9 · **M**: 7 · **L**: 2 (G2.03, G2.05).

## Tabla

| ID | Caso | Regla | Sev | Tam |
|---|---|---|---|---|
| G2.01 | ASIG vence entre waitlist→confirm: v1280 skip silente, pedido B creado sin cancel origen | §40+§42+v1280 | ALTA | M |
| G2.02 | Confirmed sin `transferidoSAP.docEntry` + 60d: no reserva (§38) + no cerrado (CF T26 solo 90d) + no SAP → zombie 60-90d | §38+T26 | ALTA | M |
| G2.03 | Cliente con ASIG viva + carga orden normal mismo SKU (no CPST): va a BO. 2 docs, no unifica (R5 solo waitlist) | §33+§35+§42 | MEDIA | L |
| G2.04 | Pablo reasigna reparto a cliente con ASIG viva mismo SKU: 2 ASIG en pedidos distintos (no se suman) | §40 breakdown | MEDIA | M |
| G2.05 | Excel importado con SKU que cliente ya tiene ASIG: no marca `origen=stock-asignado` → fórmula global, va a BO | §35+§42 | MEDIA | L |
| G2.06 | ASIG facturada por sync SAP entre waitlist→confirm: v1280 skip, pedido B creado con stock ya SAP | §40.8+v1280 | ALTA | S |
| G2.07 | Pablo cierra reparto con sobrante + stock entra mismo tick: `reconcileRepartosFaltantes` async | §40 reparto async | BAJA | S |
| G2.08 | Reparto con `clientesBO=[]` post-cancelaciones: queda pending abandonado | B14 brainstorming | MEDIA | S |
| G2.09 | Reparto físico 0 por venta SAP externa: `applyRepartoManualCore` escribe `lockedAt` + error path NO limpia → próximo intento falla | T06+SAP race | ALTA | M |
| G2.10 | 2 repartos abiertos mismo SKU por race `detectDep11Increases`: Pablo aplica ambos → doble ASIG | S10 §40 race | ALTA | M |
| G2.11 | `qty <= 0 + qtyOpen > 0` (data corrupta): `applyRepartoManualCore` no valida, crea ASIG | B06 | BAJA | S |
| G2.12 | `asigAt != null + state != 'ASIG'` (data corrupta pre-v1402): vestigial, no impacta breakdown | B09 | BAJA | S |
| G2.13 | VDE recorta ASIG 10→7: 3u van a libre (no vuelven a BO cliente). Asimetría con §40.5 | §40.7 | MEDIA | M |
| G2.14 | Línea `origen='stock-asignado'` con `asigRefs=[]` (shape incompleto): v1280 no cancela, §35 por línea da fórmula cliente → doble reserva | §35+B12 | ALTA | S |
| G2.15 | `pedido.asigRefs` apunta a pedido ya cerrado (invoiced/closedAt): v1280 skip silente, pedido B queda con stock fantasma SAP | §40.8+v1280 | ALTA | M |
| G2.16 | `redistributeAsigLine` inline usa `getStockRealmenteDisponible` global (no `getStockUtilizableParaClienteExAsig`): admin aumenta ASIG 10→15 ve "sin stock" | §33 omitida | MEDIA | S |
| G2.17 | `getStockBreakdown.asignadas` ¿respeta hard-cap 60d §38? Verificar vs state-only | §38 cadence | BAJA | S |
| G2.18 | `_buildAsigLine` no hereda `splitFromLineIndex` del padre BO: pierde breadcrumb | §40.11+v1382 | BAJA | S |

## Prioridades fix (sugerencia agente)

1. G2.01+G2.06+G2.15 — fresh re-check atómico `pedidosOrigenes` en `doConfirmPedido` (bug stock real).
2. G2.10 — dedupe repartos activos mismo SKU.
3. G2.09 — unlock reparto en error path.
4. G2.14 — invariante `origen='stock-asignado' ⇒ asigRefs.length>=1`.
5. G2.02 — confirmed sin SAP + 60d scheduled cleanup.
