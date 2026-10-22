# Grises G3 — Unificación §42 + R5 + no self-unify §42.2.1

**Agente**: general-purpose G3 · 173s · 5 tool uses.
**15 casos G01-G15**.

> Output full del agente → ver transcript. Para merge en `41_GRISES_ENCONTRADOS.md` final cuando los 5 agentes terminen.

## Severidad

- **BLOQ**: 1 (G13 — correr `scripts/audit/P_clientes_multiple_waitlists.cjs` antes de E2).
- **ALTA**: 5 (G01, G02, G03, G05, G11).
- **MEDIA**: 6 (G04, G06, G08, G09, G12, G15).
- **BAJA**: 3 (G07, G10, G14).

## Tabla

| ID | Caso resumido | Regla | Sev | Tam | Archivo clave |
|---|---|---|---|---|---|
| G01 | Unificar 2 CPST mismo SKU con asigRefs distintas: FIFO corta mal, ASIG huérfana | R2 | ALTA | M | `src/pure/unificar-ordenes.js:119` + `_cpstConfirmar` |
| G02 | Unificar BO + entregable mismo SKU: BO absorbida no se cancela, doble BO cliente | R1+R6 | ALTA | M | `mergeLinesFromOrders` + bloque v1280 |
| G03 | Guard §42.2 ofrece unificar orden de otro vendedor → rules bloquean post-merge local | R5+R7 | ALTA | M | `pedidos-modal.js:validateReviewAndPasarAPendientes` sin filter `assignedVendorUid` |
| G04 | Prospecto sin cardCode: N órdenes abiertas (R5 ignora) | R5 | MEDIA | S | `findOpenWaitlistsForClient` early-exit si cardCode=='' |
| G05 | Race 2 users crean para mismo cliente <500ms: ambos ven openList=[] | R5 | ALTA | L | fresh query NO runTransaction |
| G06 | Self-unify §42.2.1 v1418 ¿sticky? verificar fix en código | R5 | MEDIA | S | `_createOrUnifyWaitlistPayload` check `target._id !== currentWaitlistId` |
| G07 | `pedido.waitlistOrigenId` apunta a doc borrado → drawer vacío silent | R10 | BAJA | S | consumidores `_findAsigDelCliente` |
| G08 | §42.2 review guard NO escribe `unifiedFromWaitlistId` en pedido B | R10 (audit) | MEDIA | S | `doConfirmPedido` post-merge |
| G09 | Excel `revisionDejarRecalculando` absorbe CPST sin check sobre-asignación §40.5 | R2 | MEDIA | S | integrar `computeCpstRevertPlan` en Excel merge |
| G10 | Badge "PEDIDO ANTERIOR" cuenta BO vivo del mismo cliente actual (ruidoso) | R1 (UX) | BAJA | S | `yaEnOtroFiltrado` extend §55 |
| G11 | Unificar vs waitlist ya `stage=consumed` race §40.6 vs §42 | R5 | ALTA | M | `_createOrUnifyWaitlistPayload` sin runTransaction stage-check |
| G12 | Guard §42.2 con `_pendingPedidoWaitlistId=null` + doConfirmPedido doble-consumed | R5 | MEDIA | S | grep post-write en waitlist |
| G13 | **Verificación HOY**: clientes con 2+ waitlists abiertas en prod | R5 | **BLOQ** | S | correr script existente P |
| G14 | SKU case-sensitivity breakdown cache | R8 | BAJA | S | `const sku = String(input).toUpperCase().trim()` en entrypoint |
| G15 | Unificación preserva `vendorAssigned` target → nuevo VDE no visible en Planner | R7 | MEDIA | S | add `mergedByVendorKey` a unifiedFrom[] |

## Hallazgo bloqueante

**G13**: Mariano aprobó autonomía E2 pero el agente sugiere correr `P_clientes_multiple_waitlists.cjs` como pre-check de E1 → E2. Al merge v1404 reportó 0, pero deploys v1405-v1419 pudieron abrir ventanas de SW stale. **Acción**: lo corro al cerrar E1 como primer step de E2.
