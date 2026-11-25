# Cloud Functions: alcance del vendedor interno (VDI) limitado a su pareja (2026-11-25, v1571)

Continuación de la auditoría de seguridad. El cambio de `firestore.rules` (PR #1421) limitó al interno a pedidos propios o de su VDE pareja en las escrituras directas desde el navegador. Este cambio aplica el mismo criterio en las Cloud Functions que modifican pedidos u órdenes en espera, que usan Admin SDK y no pasan por las reglas.

## Antes

Cinco funciones trataban al rol `interno` igual que a admin y gerente (sin restricción sobre el documento):

| Función | Core | Chequeo previo |
|---|---|---|
| `updatePedidoLinesCF` | `functions/core/update-pedido-lines-core.js` | `isPrivileged` incluía `interno` |
| `movePedidoToWaitlistCF` | `functions/core/move-pedido-to-waitlist-core.js` | `isPrivileged` incluía `interno` |
| `releaseAsigCF` | `functions/core/release-asig-core.js` | `isPrivileged` incluía `interno` (también salteaba el chequeo de mismo cliente) |
| `updateAsigLineStateCF` | `functions/core/asig-recycle-core.js` | `interno` sin chequeo de dueño |
| `unifyWaitlistsCF` | `functions/core/unify-waitlists-core.js` | `isPrivileged` incluía `interno` |

Revisadas y sin cambio: `pedidosDelMesCF` (solo lectura, ya acotada a zona y parejas), `line-mutation-observer-core` (trigger de auditoría, no da acceso), `planner-stage-change-core` (resuelve el mail de la pareja), `sap-proxy-core` (permisos por endpoint), `resolve-client-vendor-core` (resolución de cartera) y los gates de rol aprobado de `functions/index.js` (solo listan roles válidos).

## Problema

Regla del dueño: un VDI modifica solo pedidos propios o de su VDE pareja (incluidos los que cargó el gerente para clientes de la pareja, vía `assignedVendorUid`). Con las funciones de arriba, un interno podía operar sobre pedidos y órdenes de cualquier otra pareja aunque las reglas ya se lo negaran en el navegador.

## Cambio

**Helper puro nuevo** `functions/core/interno-scope.js` (§7, `getRoleDoc` inyectable):

- `evaluatePedidoScopeInterno({callerUid, pedido, getRoleDoc})` / `isPedidoEnScopeInterno`: propio si `ownerUid`, `createdByUid` o `cargadoPorUid` es el interno; de la pareja si `ownerUid` o `assignedVendorUid` es un VDE con `roles/{uid}.role == 'vendedor'` e `internalPartnerUid == interno`. Mismo criterio que `pedidoPropioDelInterno()` / `pedidoDeMiParejaVDE()` de las reglas.
- `evaluateWaitlistScopeInterno` / `isWaitlistEnScopeInterno`: igual para `revision_waitlist`, con propio = `ownerUid` o `cargadoPorUid`.
- Falla cerrada: si no se puede leer el rol del VDE candidato, ese camino no concede; si ninguno concede, se deniega.
- `makeGetRoleDoc(fbDb)`: lectura por defecto de `roles/{uid}` con cache por invocación.

**Criterio por función** (admin, gerente y vendedor sin cambio):

| Función | Interno: propio | Interno: pareja | Interno: otra pareja |
|---|---|---|---|
| `updatePedidoLinesCF` (editar precio/cantidad/notas) | OK | OK | `INTERNO_FUERA_DE_PAREJA` |
| `updateAsigLineStateCF` (reciclar/cancelar reserva) | OK | OK | `INTERNO_FUERA_DE_PAREJA` |
| `releaseAsigCF` (quitar producto / rechazo de stock asignado) | OK | OK | `INTERNO_FUERA_DE_PAREJA` |
| `unifyWaitlistsCF` (unificar órdenes en espera; target y todas las absorbidas) | OK | OK | `INTERNO_FUERA_DE_PAREJA` |
| `movePedidoToWaitlistCF` (pasar pedido a espera) | OK | `INTERNO_SOLO_PEDIDO_PROPIO` | `INTERNO_FUERA_DE_PAREJA` |

- Rechazo: `permission-denied` con el código en `details.errorCode` (en `updatePedidoLinesCF`, `{ok:false, errorCode}` en la raíz, como sus otros rechazos). No se escribe nada.
- `movePedidoToWaitlistCF` borra el pedido y lo saca del flujo; las reglas ya no le permiten a la pareja cambiar estado ni borrar, y el dueño definió que "modificar" no incluye borrar. Por eso queda solo para pedidos propios.
- `releaseAsigCF`: el interno, al dejar de ser privilegiado, pasa también por el chequeo de mismo cliente que ya tenía el vendedor (no libera reservas de otro cliente).
- Lecturas de roles antes de cualquier write de la transacción (§58). En `movePedidoToWaitlistCF` se re-evalúa el alcance si cambió algún campo de dueño entre la lectura previa y la transacción.
- Log de rechazos: `movePedidoToWaitlistCF` y `unifyWaitlistsCF` ya registraban sus rechazos con await en `operations_log` (§64.2); el código nuevo queda como `errorCode` del registro.
- Wrapper de `updateAsigLineStateCF`: propaga solo `details.errorCode` al cliente.

**Cliente**:

- `src/pure/mensajes-vendedor.js`: `INTERNO_FUERA_DE_PAREJA` y `INTERNO_SOLO_PEDIDO_PROPIO` en `MENSAJES_VENDEDOR` y en `SERVER_ERROR_CODES_MAPEADOS` (§68).
- `index.html`: mismos textos en `window._SERVER_ERROR_FALLBACK_TEXTS`; el catch de reciclar/rechazar reserva (`updateAsigLineStateCF`) usa `_serverErrorAlertText` antes del texto técnico.
- Rebuild de bundle y chunks. `APP_VERSION` y `CACHE_VERSION` a `v1571`.

## Por qué

Las reglas solo cubren escrituras directas desde el navegador. Las funciones del servidor tienen que aplicar el mismo límite por pareja por su cuenta.

## Verificación

- `tests/functions/interno-scope.test.js`: helper (propio por cada campo, pareja por `ownerUid` y por `assignedVendorUid`, otra pareja, rol no vendedor, rol ilegible, sin caller/documento, cache).
- `tests/functions/interno-pareja-cfs.test.js`: para cada una de las 5 funciones, interno pareja / propio / otra pareja (denegado y sin writes de negocio) / rol del VDE ilegible (denegado) / admin y gerente sin cambio. Mock de transacción estricto (§58).
- `tests/unit/audit/interno-pareja-cliente.test.js`: mensaje del cliente y propagación de `details.errorCode`.
- Tests ajustados (comportamiento intencional nuevo, §6): `release-asig-core.test.js` T3 y `asig-recycle.test.js` "rol interno" ahora usan un interno de la pareja; `server-error-codes-cliente.test.js` incluye los dos códigos nuevos.
- `npx vitest run tests/functions`, `npm run test:unit`, `npm run typecheck` y Biome sobre lo tocado.

## Deploy

```bash
firebase deploy --only functions:updatePedidoLinesCF,functions:movePedidoToWaitlistCF,functions:releaseAsigCF,functions:updateAsigLineStateCF,functions:unifyWaitlistsCF
```

El cliente (v1571) sale con el merge a `main` (Pages). Conviene desplegar cliente y funciones juntos para que los mensajes nuevos estén disponibles; si las funciones salen antes, el cliente viejo muestra su mensaje genérico.

## Rollback

Redeploy de las 5 funciones desde el `main` previo a este cambio (mismo comando de arriba sobre ese commit). El cliente se revierte con un PR de revert; los textos nuevos no afectan a otros flujos.
