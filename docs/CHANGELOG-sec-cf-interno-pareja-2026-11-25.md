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
- Post-revisión: `tests/functions/commit-pedido-interno-pareja.test.js` (A2), casos A1/M3/B1/B6 en `interno-pareja-cfs.test.js`, `tests/rules/sec-rules-vdi-waitlist-2026-11-25.test.js` (M1/M2, emulador).

## Ajustes post-revisión adversarial (2026-11-25)

Revisión adversarial del PR #1422. Lo que se corrigió en el mismo PR:

### A1 (alta): `releaseAsigCF` evalúa el alcance sobre cada pedido que modifica

- **Antes**: el alcance del interno se evaluaba solo sobre la orden en espera. Los pedidos de origen cuya reserva se cancela solo se comparaban por cliente.
- **Problema**: una orden propia (o de la pareja) podía apuntar a pedidos de otra pareja del mismo cliente; la reserva de esos pedidos se cancelaba.
- **Cambio** (`functions/core/release-asig-core.js`): para el interno, dentro de la transacción y con los pedidos ya leídos (antes de cualquier escritura, §58), se evalúa `evaluatePedidoScopeInterno` sobre cada pedido de origen. Si alguno queda fuera, se aborta todo sin escribir con `INTERNO_FUERA_DE_PAREJA`, y el rechazo queda en `operations_log` con await (§64.2, `type: release_asig_rejected`, `aborted: true`). Las lecturas de roles van fuera de la transacción (no son `tx.get`).
- Vendedor sin cambio (ver Residual).

### A2 (alta): `commitPedidoCF` aplica el alcance del interno

- **Antes**: la función solo exigía rol aprobado. Consumía la orden en espera de origen (`waitlistOrigenId`) y cancelaba reservas de los pedidos de `asigRefs` sin mirar a qué pareja pertenecían.
- **Cambio**:
  - `functions/index.js`: el wrapper pasa en `deps` (nunca en el payload) el rol leído en el servidor (`callerRole`) y `getRoleDoc`.
  - `functions/core/commit-pedido-core.js` (paso 5.7b'): si `callerRole === 'interno'`, la orden en espera de origen y cada pedido de `asigRefs` (los que se modifican, `origen: 'cpst'`) tienen que ser propios o de la pareja. Se evalúa con los datos leídos en la transacción, antes de cualquier escritura (§58). Rechazo `INTERNO_FUERA_DE_PAREJA` vía `throwError`, que el retry loop registra con await en `logCommitRejection` (§64.2, con `fueraDeAlcance` en el registro y no en la respuesta).
  - Pedidos directos (sin orden de origen ni reservas) no cambian.
- El cliente ya muestra el mensaje: el código está en `MENSAJES_VENDEDOR` y el handler de `commitPedidoCF` busca el texto por código.

### M1 + M2 (media): rules de `revision_waitlist` para el interno

- **Antes**: el interno editaba y consumía cualquier orden en espera, la podía borrar aunque no fuera suya, y en órdenes viejas sin `assignedVendorUid` podía escribir el uid de su VDE pareja para "adjudicársela" (y así entrar en el alcance de las CFs).
- **Cambio** (`firestore.rules`): helpers `waitlistPropiaDelInterno()` (`ownerUid` o `cargadoPorUid`) y `waitlistDeMiParejaVDE()` (mismo criterio que pedidos).
  - `update`: además de la lista de campos y el guard de §44, el interno solo edita órdenes propias o de su pareja, evaluado sobre el documento antes del cambio. Eso cierra M1: sobre una orden de otra pareja no puede escribir nada, tampoco `assignedVendorUid`.
  - `delete`: el interno solo borra órdenes propias.
  - Vendedor, admin y gerente sin cambio. El vendedor sigue pudiendo re-resolver el vendedor en órdenes viejas (§44).
- Por qué se resolvió en las rules y no en la CF: en el cliente, el único que escribe `assignedVendorUid` en una orden existente es la re-resolución §44 de `_createOrUnifyWaitlistPayload`, y sobre órdenes propias o de la pareja sigue permitida. `ownerUid` y `cargadoPorUid` ya estaban fuera de la lista editable.
- **Cliente** (`index.html`): los tres borrados directos de una orden en espera (borrar orden normal, quitar el último producto sin reserva y "solo borrar el borrador") muestran `WAITLIST_BORRAR_SOLO_PROPIA` (§68, nuevo en `MENSAJES_VENDEDOR`) cuando vuelven sin permiso. Cuando el interno confirma un pedido de una orden de la pareja, el borrado posterior de la orden es best-effort: falla en silencio y la orden ya quedó consumida por la CF.

### M3 (media): `CLIENT_DATA_MISSING` para el interno de la pareja

Al dejar de ser privilegiado en `releaseAsigCF`, el interno pasa por el chequeo de mismo cliente. Si la orden o el pedido de origen no tienen `clientCardCode` (pedidos viejos), recibe `CLIENT_DATA_MISSING` y no se modifica nada, donde antes operaba. Es intencional (mismo criterio que el vendedor). Test en `interno-pareja-cfs.test.js`. Antes de desplegar conviene contar cuántos pedidos abiertos con reserva no tienen `clientCardCode`.

### B1 (baja): `updateAsigLineStateCF` no cierra pedidos de la pareja

Sobre un pedido de la pareja (no propio), cancelar o reciclar la última reserva cambia la línea pero ya no setea `closedAt` (las rules tampoco se lo permiten a la pareja). Pedido propio, admin y gerente: sin cambio, el pedido se cierra.

### B6 (baja): tests

- Comentarios de `release-asig-core.test.js` y `asig-recycle.test.js` apuntan al archivo real (`interno-pareja-cfs.test.js`).
- `release-asig-core.test.js` T3: el pedido de origen ahora es de la pareja (el escenario anterior era justamente A1). Ajuste de test por cambio intencional (§6).
- `movePedidoToWaitlistCF` "rol ilegible": verifica que se intentó leer el rol y que el código pasa de `INTERNO_SOLO_PEDIDO_PROPIO` (pareja reconocida) a `INTERNO_FUERA_DE_PAREJA` (pareja no reconocida). Más un caso de pedido propio con roles ilegibles → OK.
- `rules.test.js`: el caso "interno borra cualquier orden" documentaba el comportamiento viejo; ahora "interno solo borra órdenes propias" (§6).

### Residual

- Vendedor (rol `vendedor`) en `releaseAsigCF` y `commitPedidoCF`: los pedidos de origen se validan solo por cliente, no por dueño. Es previo a este PR y se dejó igual por la consigna de no cambiar el comportamiento del vendedor.
- `commitPedidoCF`: el interno puede crear pedidos para clientes de otra pareja, y la absorción de back order (§J) puede tocar pedidos del mismo cliente de otra pareja. Decisión de negocio pendiente.
- El vendedor puede seguir escribiendo `assignedVendorUid` en órdenes viejas sin ese campo (§44). Un VDE puede así meter una orden vieja en el alcance de su interno pareja. Requiere al VDE de la pareja; queda anotado.
- B2 (alcance de la orden en `releaseAsigCF` evaluado antes de la transacción), B3 (propio por `createdByUid`/`cargadoPorUid`), B4, B5 y B7: sin cambio.

## Deploy

Funciones:

```bash
firebase deploy --only functions:updatePedidoLinesCF,functions:movePedidoToWaitlistCF,functions:releaseAsigCF,functions:updateAsigLineStateCF,functions:unifyWaitlistsCF,functions:commitPedidoCF
```

Rules (cambio en `revision_waitlist`):

```bash
firebase deploy --only firestore:rules
```

El cliente (v1571) sale con el merge a `main` (Pages). Conviene desplegar cliente, funciones y rules juntos para que los mensajes nuevos estén disponibles; si las funciones o las rules salen antes, el cliente viejo muestra su mensaje genérico.

## Rollback

- Funciones: redeploy de las 6 desde el `main` previo a este cambio (mismo comando sobre ese commit).
- Rules: `git checkout <main previo> -- firestore.rules` + `firebase deploy --only firestore:rules`.
- Cliente: PR de revert; los textos nuevos no afectan a otros flujos.
