# notificaciones.js — doble definición de `window.markAllNotifsRead`

## Estado

Bug conocido, latente desde la extracción del dominio (E2.g, 2026-07-28, verbatim del inline).

## Síntoma

El archivo `src/domains/notificaciones.js` define `window.markAllNotifsRead` dos veces (líneas ~1395 y ~1825). En runtime la segunda asignación sobrescribe la primera.

## Primera definición (~línea 1395)

- Confirm con texto detallado ("No se puede deshacer masivamente…").
- Usa `writeBatch` en chunks de 400 para respetar el límite de Firestore (500 ops).
- Para **cualquier** notificación pendiente setea `status: 'read' + readAt`.
- Deshabilita el botón mientras procesa y restaura el texto si falla.
- Diseñada originalmente en v321+ para limpiar bandejas de 100+ notifs.

## Segunda definición (~línea 1825, la que gana)

- Confirm con texto corto ("¿Marcar las N alertas/tareas como leídas?").
- Loop secuencial con `await` por doc (sin batch).
- Discrimina por tipo:
  - `type === 'task'` → `status: 'done' + doneAt` + crea notif `task_ack` al emisor.
  - resto → `status: 'read' + readAt`.
- No deshabilita el botón ni gestiona estado de UI.

## Impacto

- El batch optimizado no corre nunca.
- El flujo activo manda ACK a los emisores de tareas, lo cual sí es deseable, pero paga el costo de un write secuencial por notif (sin batching).
- El texto de confirmación visible es el corto; el detallado nunca se muestra.

## Acción pendiente

Consolidar en una sola implementación que combine:

- Batch de 400 para performance.
- Discriminación por tipo con ACK a tareas.
- Texto de confirmación acordado.
- Manejo de estado del botón.

Mientras no se resuelva, dejar la referencia desde el header de `src/domains/notificaciones.js`.
