# v1572 — Seguimiento del alcance del vendedor interno (2026-11-25)

Seguimiento de la re-revisión adversarial del PR #1422 (ronda 2). Cierra N1 y
N5, y la parte de N4 que se pidió. N3 queda como residual documentado. No
toca `firestore.rules`.

Regla de negocio (sin cambio): el interno (VDI) modifica pedidos y órdenes en
espera propios o de su VDE pareja (`functions/core/interno-scope.js`). No
borra los de la pareja ni toca otras parejas. Admin, gerente y vendedor no
cambian.

## N1 (Media) — `commitPedidoCF`: absorción de back order de otra pareja

**Antes.** Al confirmar un pedido, `commitPedidoCore` absorbe el back order
vigente del mismo cliente y producto en pedidos abiertos anteriores (§J
v1455): baja `qtyOpen` o cancela esas líneas. Para el interno solo se validaba
el alcance de la orden de origen y de los pedidos de reservas, no los pedidos
a absorber.

**Problema.** Un interno que confirmaba un pedido directo para un cliente con
back order en un pedido de otra pareja dejaba esa línea cancelada
(`absorbed_by_newer_confirmed`) en un pedido que no puede modificar.

**Cambio.** `functions/core/commit-pedido-core.js`, fase de lecturas del paso
5.7c. Si el que llama es interno, cada pedido que la absorción va a tocar se
evalúa con `evaluatePedidoScopeInterno` sobre los datos leídos en la
transacción. Los que quedan fuera (otra pareja o rol ilegible, falla cerrada)
se excluyen y la absorción se recalcula sin ellos (la cantidad puede ir a un
back order más nuevo de la pareja); se repite hasta que no aparezcan
excluidos nuevos. Las lecturas de roles no son `tx.get` y todo ocurre antes
del primer write (§58). El pedido nuevo **no se rechaza**.

- Resultado: `boAbsorbSkippedCount` (conteo de pedidos salteados).
- Log del servidor `bo_absorb_skipped_interno` y entrada en `operations_log`
  `type='bo_absorb_skipped_fuera_de_pareja'` con los ids y el motivo (el
  detalle no viaja al cliente).
- No se decide si el interno puede crear pedidos para clientes de otra
  pareja: queda como decisión de negocio, no se bloquea.

**Por qué.** Es el criterio más restrictivo que no rompe el alta del pedido:
el back order de otra pareja queda como estaba y su vendedor lo gestiona.

## N5 (Baja) — `releaseAsigCF` `rechazo_cpst` sobre orden de la pareja

**Antes.** `rechazo_cpst` borra la orden en espera y el servidor lo hacía para
el interno también sobre órdenes de su pareja, aunque las rules no le dejan
borrarlas.

**Cambio.** `functions/core/release-asig-core.js`: para el interno,
`rechazo_cpst` solo si la orden es propia (`via === 'propio'`). Sobre la de la
pareja: `permission-denied` con `errorCode: WAITLIST_BORRAR_SOLO_PROPIA`
(código que ya tenía mensaje), antes de leer o escribir pedidos. Rechazo
registrado con await en `operations_log` (`release_asig_rejected`,
`reason: 'orden_de_pareja'`). El código se suma a
`SERVER_ERROR_CODES_MAPEADOS` y al fallback inline de `index.html`.

`remove_item` sigue permitido sobre la pareja (es una edición). Si se quita el
último producto, la orden queda vacía y el servidor la borra: residual.

## N4 (Baja, §68) — errores crudos al editar órdenes en espera

**Antes.** Agregar/reemplazar producto, sugerencias, número de orden,
cantidad, quitar producto, Unificar orden y el estado en Planner mostraban
"Error guardando: Missing or insufficient permissions" cuando la orden no
estaba en el alcance del usuario.

**Cambio.**
- Código nuevo `WAITLIST_FUERA_DE_PAREJA` en `MENSAJES_VENDEDOR`.
- Helper `window._waitlistEditErrorText(e)` en `index.html` (como
  `_waitlistDeleteErrorText`): texto humano con código técnico solo para
  `permission-denied`; para otros errores devuelve null y queda el texto de
  antes. Fallback inline si el bundle viene viejo.
- Aplicado en los 9 `alert` de edición de órdenes en espera.
- `src/domains/pedidos-modal.js` (guard §42.2): mezcla las líneas sobre una
  copia y reemplaza el pedido local recién cuando el update de la orden se
  confirma; si falla, el pedido local queda igual (reintentar no duplica). El
  error por permiso usa el mismo texto.

No se deshabilitan los controles de edición ni se revierten los cambios
optimistas en pantalla de los otros sitios (cambio mínimo, pendiente).

## N3 (Baja) — residual

`updateAsigLineStateCF` sobre un pedido de la pareja no setea `closedAt`
(B1). Si el interno cancela o recicla la última reserva, el pedido queda
abierto sin líneas abiertas. Sin cambio: decidir si lo cierra el servidor o un
barrido.

## Verificación

- `npx vitest run tests/functions` y `npm run test:unit`: ver el reporte del PR.
- Tests nuevos: `tests/functions/commit-pedido-interno-pareja.test.js` (N1:
  otra pareja salteada, pareja absorbida, mezcla FIFO, rol ilegible,
  vendedor/gerente/admin sin cambio); `tests/functions/interno-pareja-cfs.test.js`
  y `tests/functions/release-asig-core.test.js` (N5); contrato
  `tests/unit/audit/waitlist-edit-permiso-texto-v1572.test.js` (N4).
- `npm run typecheck`, `biome check` sobre lo tocado.

## Deploy

- Funciones: `commitPedidoCF`, `releaseAsigCF`.
- Hosting (Pages, al merge): `index.html`, `app.bundle.js`, `sw.js` (v1572).
- Rules: sin cambio.

## Rollback

Revertir el commit y redeployar `commitPedidoCF` y `releaseAsigCF`. Sin
cambios de datos ni de rules.
