# Reglas: el interno (VDI) solo modifica pedidos propios o de su pareja VDE (2026-11-25)

Hallazgo H3 de la auditoría de seguridad. Cambio solo en `firestore.rules` (match `/pedidos/{pedidoId}`) y tests de reglas. Sin cambio de cliente, Cloud Functions ni versión de la app.

## Antes

- `allow update` para `isInterno()`: lista `hasOnly` de campos + guard `transferidoSapChangeIsAppOnly()`, pero **sin mirar de quién era el pedido**. Cualquier interno podía modificar cualquier pedido de cualquier vendedor (herencia del blanket de v747, que SEC-C1 acotó por campos pero no por dueño).
- `allow delete`: `isAdminOrGerente() || isInterno()`. Cualquier interno podía borrar cualquier pedido.

## Problema

El interno trabaja en pareja con un vendedor (VDE). Con la regla anterior, un interno podía editar el contenido, el estado, la numeración o el cobro de pedidos de **otras parejas**, y borrarlos. No había ningún flujo de negocio que lo necesitara: la operación cross-vendedor legítima (liberar reservas de stock asignado) ya pasa por `releaseAsigCF` en el servidor (CLAUDE.md §63).

## Cambio

Decisión del dueño: un VDI solo puede **modificar** pedidos de su VDE pareja (incluidos los que cargó el gerente para clientes de esa pareja). Nada sobre pedidos de otras parejas. Modificar no incluye borrar, transferir, confirmar ni facturar.

Dos helpers nuevos en `firestore.rules`:

- `pedidoPropioDelInterno()`: `ownerUid`, `createdByUid` o `cargadoPorUid` del pedido == el interno. Ninguno de esos tres campos está en las listas `hasOnly` de VDE o VDI, así que el cliente no puede volver "propio" un pedido ajeno (hay test).
- `pedidoDeMiParejaVDE()`: `ownerUid` o `assignedVendorUid` (vendedor del cliente según el master, §44/§46) es un VDE con `roles/{uid}.internalPartnerUid == interno`. Reusa `isMyPartnerVDE()` sin cambiarla.

`allow update` del interno queda en dos ramas:

| Caso | Campos permitidos |
|---|---|
| Pedido propio | La lista completa de antes + guard `transferidoSapChangeIsAppOnly()` (sin cambio). |
| Pedido de la pareja (y no propio) | `formaEntrega`, `deliveryDetails`, `lines`, `netAmountArs`, `subtotalArs`, `condicionPago`, `observaciones`, `notes`, `clientNotes`, `updatedAt`, `updatedBy`, `month`, `monthIdx`, `year`, `repartoHistory`, `lastRepartoAt`, `lastRepartoBy`, `plannerStage`, `plannerHistory`, `plannerEmails`, `plannerAttachments`. |
| Cualquier otro pedido | Denegado. |

Fuera de la lista de pareja: `stage`, `confirmedAt`, `finalizedAt`, `closedAt`, `orderNumber`, `transferidoSAP` y la auditoría de revert/split (`revertedFromConfirmedAt`, `revertedBy`, `previousSapDocNum`, `previousSapDocEntryCancelled`, `autoSplitByStock`), `paidStatus`, `paidAmount`, `paidToDate`, `invoicedAmount`, `paidSyncedAt`.

`allow delete`: `isAdminOrGerente() || (isInterno() && pedidoPropioDelInterno())`.

La rama del vendedor (`isVendor()`) no se tocó.

### Costo de lecturas en la regla

Peor caso de una evaluación (interno sobre pedido de la pareja): `roles/{auth.uid}` (por `role()`), `roles/{ownerUid}` y `roles/{assignedVendorUid}` (por `isMyPartnerVDE`, que hace `exists` + `get` sobre el mismo doc). Son **3 documentos distintos**; los accesos repetidos al mismo documento dentro de una evaluación se cachean y cuentan una vez. Queda lejos del límite de 10. No hizo falta reescribir `isMyPartnerVDE`.

## Por qué

- Cierra la escritura y el borrado directos (desde el navegador) sobre pedidos de otras parejas, sin romper el trabajo diario del VDI con su VDE. Las Cloud Functions que modifican pedidos aplican su propio control de permisos; el criterio de pareja en el servidor va en un cambio aparte.
- En pedidos de la pareja, el VDI puede mover la tarjeta del Planner pero no a las columnas de cobro (`cobrado_parcial`, `cobrado_full`).
- "Pedido de la pareja" se resuelve por `ownerUid` o `assignedVendorUid`; no hace falta identificar al gerente por UID (los pedidos que él carga para un cliente llevan `assignedVendorUid` = VDE del cliente).
- Falla cerrada: si un VDE no tiene `internalPartnerUid` cargado, su VDI pierde edición sobre esos pedidos (no gana permisos de más).

## Impacto en flujos del cliente (relevamiento, sin cambios en el cliente)

Escrituras directas del navegador a `pedidos` que puede disparar un VDI:

| Flujo (index.html) | Escribe | (a) propio | (b) pareja | (c) otra pareja |
|---|---|---|---|---|
| `persistPendingEntry` | `lines`, `updatedAt` | OK | OK | denegado |
| `deleteBackorderAppLine`, `deleteAllBackorderAppLinesForClient`, `deleteConfirmedAppLinesForClient` | `lines`, `updatedAt` | OK | OK | denegado |
| `_toggleAsigReserva`, `_asigInlineResolve` | `lines`, `updatedAt` | OK | OK | denegado |
| `_adjustAsigQty` (+/- Stock Asignado) | `lines`, `repartoHistory`, `lastRepartoAt/By` | OK | OK | denegado |
| `onPlannerColDrop` (Planner) | `plannerStage`, `plannerHistory`, `updatedAt` | OK | OK | denegado |
| `handlePlannerAttachmentUpload` / `deletePlannerAttachment` | `plannerAttachments`, `updatedAt` | OK | OK | denegado |
| `_doConfirmPedidoImpl`, auto-confirm 100% BO | `stage`, `finalizedAt`, `transferidoSAP` app_only | OK (el pedido recién creado por `commitPedidoCF` tiene `ownerUid` = quien confirma) | n/a | n/a |
| `_doConfirmPedidoImpl`, cancelación de ASIG en pedidos origen | `lines`, `updatedAt` | OK | OK | denegado |
| `confirmarDefinitivo` | `stage`, `finalizedAt`, `lines`, `autoSplitByStock` | OK | **denegado** | denegado |
| `volverAPendientes` | `stage`, `finalizedAt`, `transferidoSAP` (delete), audit revert | OK | **denegado** | denegado |
| `eliminarPendiente`, `volverABorrador`, `volverAListaEspera`, `eliminarPedidoDeRaiz` | delete | OK | **denegado** | denegado |

Los marcados **denegado** en (b) son intencionales (regla: modificar no incluye confirmar, revertir ni borrar). Sobre un pedido de la pareja que no cargó él, el VDI ve el error de permisos; lo hace el VDE, el gerente o un admin. `sap-admin-panel` y `sap-auto-send-listener` son solo admin/gerente: sin impacto.

## Verificación

- Tests nuevos: `tests/rules/sec-rules-vdi-pareja-2026-11-25.test.js` (pareja edita lines/observaciones/planner; pedido del gerente para cliente de la pareja; propio con stage + delete; denegados para interno sin pareja, otra pareja, campos fuera de la lista de pareja, `cargadoPorUid`, y borrado de pedidos de la pareja o del gerente).
- Tests existentes ajustados (CLAUDE.md §6, eran tests del blanket que la decisión elimina): `rules.test.js` (blanket v747 pasa a denegado; bloque SEC-C1 siembra `cargadoPorUid` del interno para seguir probando la lista completa sobre pedido propio) y `sec-rules-batch-2026-11-24.test.js` (`base()` con `cargadoPorUid` del interno; planner y ajuste ASIG divididos en pareja = OK / otra pareja = denegado).
- Emulador, igual que el CI: 448 tests, 437 pasan, 4 fallan (las 4 `seguimiento_*` preexistentes, presentes también en la línea de base sin el cambio), 7 omitidos. Gate `check-known-failures.mjs rules` en verde.
- `npm run test:unit`: 243 archivos, 3226 tests, todos pasan.

## Prerrequisito de deploy

Confirmar en producción que cada VDE tiene `roles/{uid}.internalPartnerUid` con el UID de su VDI. Si falta, ese VDI pierde la edición de los pedidos de esa pareja (falla cerrada, no abre nada).

## Rollback

`firebase deploy --only firestore:rules` desde el commit anterior a este cambio. No hay datos que migrar.
