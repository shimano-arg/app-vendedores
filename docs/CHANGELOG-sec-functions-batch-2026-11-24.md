# Lote de seguridad en Cloud Functions — 2026-11-24

Rama `sec/functions-batch-2026-11-24`, base `d2808f44` (incluye el gate de rol de #1414). Integra los grupos 3, 4 y 5 del orden propuesto en `F1B_PRS_HARDENING.md` §7, solo la parte `functions/`. Sin bump de versión: no cambia `index.html`, `src/` ni el bundle.

Un commit por PR, en este orden: #1312 → #1390 → #1395 → #1386 (ajustado, D10) → #1387 → #1394 → #1382 → #1385 (ajustado, D3) → #1398 (solo cores) → #1403 → #1391 → ajuste de rol (pedido del coordinador).

## Antes

- `sapProxy` validaba la ruta del endpoint contra una allowlist por recurso mirando el texto tal cual llegaba, sin contemplar cómo lo normaliza `fetch`.
- `dashboardVentasCF`, `pedidosDelMesCF`, `closeSqsManuallyCF` y `generateVentasReportCF` no tenían rate limit.
- Varios `catch` de callables devolvían al cliente el `message` crudo del error (rutas internas, respuestas de servicios externos).
- `releaseAsigCore` no verificaba que los pedidos de origen de una orden en espera fueran del mismo cliente.
- `commitPedidoCore` validaba sku, estado y cantidad de cada `asigRef`, pero no que el pedido origen fuera del mismo cliente.
- `fetchStockLiveCF` no tenía tope de productos por pedido de stock. `updatePedidoLinesCF` no validaba rangos ni dejaba operar al vendedor asignado del cliente.
- El auto-envío a SAP no registraba los pedidos que llegaban a `confirmed` sin marker de servidor (`_commitVersion`). La auto-confirmación por timeout no escribía marker.
- No había observadores de cambios de líneas en `pedidos` ni de integridad en `revision_waitlist`.
- Si la lectura de `roles/{uid}` fallaba, el gate de #1414 respondía `permission-denied` + `ROLE_REQUIRED`, y el cliente le decía al vendedor que pidiera un rol cuando reintentar alcanzaba. `releaseAsigCF` reenviaba los rechazos sin `details`.

## Problema

Hallazgos de las auditorías HARDENING5/6 y la serie SEC (ver `F1B_PRS_HARDENING.md`, tablas 3.1–3.3): validación de ruta en el proxy SAP, costo sin tope en funciones de BigQuery y Service Layer, filtrado de detalle interno en errores, cruces entre clientes en la liberación y cancelación de reservas, y falta de visibilidad sobre caminos que confirman pedidos fuera de las funciones de servidor.

## Cambio

| Commit | PR | Qué entró | Qué quedó afuera |
|---|---|---|---|
| `75aca859` | #1312 | `validateEndpointPath` en `sap-proxy-core.js` + 25 tests | Bullet de README del PR (reemplazado por este doc) |
| `bd2160a6` | #1390 | 4 presets en `RATE_LIMITS` + chequeo en las 4 funciones | Commit de lint `3adfe36a` (ya estaba en main por #1392/#1407; además revertía cambios posteriores de `pedido-snapshot-core.js` y `stock-breakdown.js`) |
| `189d49b9` | #1395 | Sanitización de 15 `catch` y del summary de `triggerPlannerSync`; `gemini-ocr-core` sin detalle crudo; `geminiOcrProxy` agrega `details.errorCode = 'GEMINI_OCR_FAILED'`; 2 tests nuevos | `src/pure/mensajes-vendedor.js` (entradas `GEMINI_OCR_FAILED`, `EMAIL_SEND_FAILED`): lo edita otro PR (#1415). Conflicto en `commitPedidoCF`: se conservó el registro en `operations_log` que ya estaba en main y se aplicó el mensaje genérico de #1395 |
| `54f9e744` | #1386 | Chequeo de cliente en `releaseAsigCore` con **D10**: para no privilegiados también se saltea si falta el cardCode de la orden o del pedido (reasons `waitlist_sin_cardCode`, `pedido_sin_cardCode`, `cross_client_cardCode_mismatch`). Respeta `isOwner` + rol de #1414 | Commit de lint |
| `cbbfa755` | #1387 | CHECK G en `accumulateCancelAsigMutations` (`CROSS_CLIENT_CARDCODE_MISMATCH`) + 4 tests. Corre antes del self-healing de #1406 | Commit de lint. El fail-open por pedido origen sin `clientCardCode` se mantiene como en el PR (no estaba pedido cerrarlo) |
| `b6a55535` | #1394 | Tope 250 SKUs en `fetchStockLiveCore`; `TOO_MANY_SKUS` en `fetchStockLiveCF` (con registro AWAIT en `operations_log`) y en `commitPedidoCore`; rangos, `qtyOpen <= qty`, vendedor asignado y bloqueo de `stage=confirmed` en `updatePedidoLinesCore`; 4 tests nuevos | `src/pure/mensajes-vendedor.js` (entrada `TOO_MANY_SKUS`), mismo motivo que #1395 |
| `998e5281` | #1382 | Observador SEC-H2 en `handleAutoSendSap` (`sec_h2_commit_version_missing`, no bloquea) | — |
| `b6977dbd` | #1385 | Set de markers: `commitPedidoCore_v1`, **`autoConfirmPendingCore_v1`** (D3), `confirmDefinitivo_v1` (reservado para #1384) | `autoConfirmPending_v1` del PR original: su PR (#1383) se cierra por superado y nadie lo escribe |
| `7bfe7146` | #1398 | Solo `auto-confirm-pending-core.js` (marker) y `reparto-core.js` (fallback `currentAsig = 0` con log) + sus tests | `firestore.rules`, `storage.rules` y tests de rules (van en #1418) |
| `86c68ae4` | #1403 | Trigger `onPedidoLineMutationObserver` + core puro + 41 tests | — |
| `c7673249` | #1391 | Trigger `onWaitlistWriteValidate` + core + 25 tests. Se ubicó antes del JSDoc de `onPedidoCreatedCleanupWaitlist` para no despegarlo | Commit de lint |
| `a24324c1` | (coordinador) | Lectura de rol fallida → `unavailable` + `ROLE_CHECK_UNAVAILABLE` en `caller-role-gate` y en `releaseAsigCore` (sin detalle interno en el mensaje); `releaseAsigCF` reenvía `details.errorCode` (`ROLE_REQUIRED`, `RELEASE_PERMISSION_DENIED`, `ROLE_CHECK_UNAVAILABLE`) | Texto para el vendedor de `ROLE_CHECK_UNAVAILABLE` (lo agrega el coordinador en el cliente) |

Comentarios y mensajes de commit reescritos en términos genéricos (el repo es público).

## Por qué

- Grupos 3–5 de `F1B_PRS_HARDENING.md` §7: comparten `functions/index.js` y `commit-pedido-core.js`, así que se integran en una sola rama para que el deploy sea uno.
- D10: el fail-open por cardCode faltante dejaba pasar justo el caso que no se puede verificar. Se cierra en el core, no con regex en rules.
- D3: el observador acepta el marker que realmente escribe el código de auto-confirmación.
- Rol: una lectura fallida es transitoria; el usuario tiene que reintentar, no pedir permisos.

## Verificación

Corrida local en la rama (sin emulador, sin producción):

- `npx vitest run tests/functions/` → 121 archivos, **1677/1677 pass**.
- `npx vitest run tests/unit/` → 236 archivos, **3131/3131 pass**.
- `npx biome check` sobre los 32 `.js` tocados → sin errores (4 warnings preexistentes).
- `npm run typecheck` → limpio.
- `git merge-tree` contra `origin/main` actual (`f624ea94`, ya con #1415) → sin conflictos.

Tests ajustados (cambio de comportamiento intencional, no test bug):

- `release-asig-core.test.js` SEC-M6 T5: documentaba el fail-open de pedidos sin `clientCardCode`; D10 lo cierra. Se reescribió y se sumaron T6 (orden sin cardCode) y T7 (admin sigue pudiendo).
- `auto-send-sap-sec-h2-observe.test.js` B.2c T1: usa `autoConfirmPendingCore_v1`.
- `caller-role-gate.test.js`: el caso de lectura fallida espera `unavailable` + `ROLE_CHECK_UNAVAILABLE`; el contrato del wrapper acepta `errorCode: r.errorCode || 'ROLE_REQUIRED'`; nuevo contrato para `releaseAsigCF` con `details`.

Después del deploy, verificar (CLAUDE.md §29.5 y §90):

1. Como vendedor: confirmar un pedido, quitar un producto con stock asignado de una orden propia, abrir el dashboard. Ninguno debe rebotar.
2. `operations_log`: buscar `sec_h2_commit_version_missing`, `LINE_MUTATION_OBSERVED`, `sec_m1_waitlist_integrity_violation` y `sec_m6_idor_cross_client_skipped` la primera semana para medir falsos positivos.
3. `gcloud logging` sobre las 4 funciones con rate limit: mirar `resource-exhausted` la primera semana.

## Deploy

No se desplegó nada. Comando (manual, con credenciales):

```bash
firebase deploy --project=app-vendedores-shimano --only \
functions:sapProxy,\
functions:dashboardVentasCF,functions:pedidosDelMesCF,functions:closeSqsManuallyCF,functions:generateVentasReportCF,\
functions:applyRepartoManualCF,functions:releaseAsigCF,functions:updateAsigLineStateCF,functions:geminiOcrProxy,\
functions:setupGetMovimientos,functions:resendPlannerEmail,functions:triggerPlannerSync,functions:triggerRendicionesEmailManual,\
functions:commitPedidoCF,functions:updatePedidoLinesCF,functions:movePedidoToWaitlistCF,functions:unifyWaitlistsCF,\
functions:fetchStockLiveCF,functions:onPedidoConfirmedSendToSap,functions:autoConfirmPendingPedidosCF,\
functions:onPedidoLineMutationObserver,functions:onWaitlistWriteValidate
```

`onPedidoLineMutationObserver` y `onWaitlistWriteValidate` son funciones nuevas (suman una ejecución por cada escritura de `pedidos` y de `revision_waitlist`).

## Rollback

- Todo el lote: redeploy de las mismas funciones desde `d2808f44` (o el `main` previo al merge) y borrar las dos nuevas: `firebase functions:delete onPedidoLineMutationObserver onWaitlistWriteValidate --region=southamerica-east1`.
- Un PR puntual: `git revert <sha>` del commit de la tabla y redeploy de las funciones que toca.
- Los observadores no escriben en `pedidos` ni `revision_waitlist`; borrarlos no deja datos a limpiar.

## Riesgos

- **D10**: un vendedor no puede liberar reservas de pedidos de origen sin `clientCardCode` persistido (pedidos viejos) ni de órdenes en espera sin cardCode. Admin/gerente/interno sí. Se ve en `crossClientSkipped` del resultado y en `operations_log`.
- **#1387**: sigue dejando pasar pedidos origen sin `clientCardCode` (fail-open del PR).
- **Rate limits**: posibles falsos positivos en `pedidosDelMesCF` (120/h) si alguien refresca mucho.
- **#1394**: `updatePedidoLinesCF` ya no edita pedidos `confirmed` (el cliente hoy no la llama). `TOO_MANY_SKUS` todavía no tiene texto en `mensajes-vendedor.js`: el vendedor vería el mensaje genérico hasta que se agregue.
- **#1395**: el cliente pierde el detalle técnico en algunos errores (queda en Cloud Logging). `GEMINI_OCR_FAILED` y `EMAIL_SEND_FAILED` tampoco tienen texto en el cliente todavía.
- **Rol**: el cliente trata `ROLE_REQUIRED`; `ROLE_CHECK_UNAVAILABLE` cae al mensaje genérico hasta que el coordinador agregue el texto.
- Los observadores suman lecturas a `roles` y a `pedidos` por escritura.

## Ajustes post-revisión (2026-11-24)

Fuente: revisión adversarial independiente del PR #1419 (hallazgos H1-H13). Solo se tocaron `functions/`, `tests/` y `docs/`.

### Antes

- **H1** `releaseAsigCore`: para un vendedor, si faltaba el `clientCardCode` de la orden en espera o del pedido de origen (o era de otro cliente), el pedido se salteaba pero la transacción seguía: se quitaba el ítem o se borraba la orden y la respuesta era `ok: true` con `unitsCancelled: 0`. El cliente muestra `unitsCancelled || unitsToFree`, así que el vendedor veía "N u liberadas" con la reserva todavía viva. Los dos registros de éxito en `operations_log` no se esperaban.
- **H2** `onWaitlistWriteValidate`: "sin `stage`" se normalizaba a `''`, que no estaba en el conjunto permitido; `'active'` tampoco. Las 5 rutas de creación del cliente crean sin `stage` y `move-pedido-to-waitlist-core` crea con `'active'`: cada creación daba R2 de severidad alta.
- **H3** `onPedidoLineMutationObserver`: el actor se toma de `updatedByUid`, que ningún escritor de `pedidos` setea. Todo cambio de líneas (incluido el del servidor) quedaba como `severity: 'HIGH'`.
- **H4** `geminiOcrProxy`: todos los mensajes se reemplazaban por "OCR fallo, reintenta en unos segundos", incluso los fijos del core (imagen demasiado grande, tipo no soportado, tiempo agotado).
- **H5** CHECK G de `commitPedidoCore`: el rechazo devolvía al cliente el cardCode del pedido de origen, y la comparación no normalizaba mayúsculas.
- **H6** observador SEC-H2 de `auto-send-sap-core`: registraba en cada escritura de un pedido ya confirmado sin marker, no solo en la transición.

### Problema

H1 da un éxito falso al vendedor y puede borrar una orden sin liberar nada. H2, H3 y H6 llenan la línea de base de falsos positivos. H4 deja al vendedor sin saber por qué falla una foto. H5 expone el cliente de un pedido ajeno.

### Cambio

- **H1** (`functions/core/release-asig-core.js`): para no privilegiados, si algún pedido de origen no se puede verificar, la transacción se aborta en la fase de cómputo, antes de cualquier escritura (§58). Falta de cardCode → `failed-precondition` + `errorCode: 'CLIENT_DATA_MISSING'`. CardCode distinto → `permission-denied` + `errorCode: 'RELEASE_CROSS_CLIENT'` (antes salteaba; ahora es coherente con el caso de dato faltante: nunca éxito con 0 unidades y la orden modificada). El rechazo se registra con `await` en `operations_log` (`release_asig_rejected` o `sec_m6_idor_cross_client_skipped`, con `aborted: true`, `errorCode` y la lista de pedidos) antes de responder (§64.2). El detalle de pedidos no viaja al cliente. Comparación de cardCode con trim + mayúsculas (§46). Admin/gerente/interno siguen operando entre clientes. El registro de éxito ahora se espera. `releaseAsigCF` ya reenviaba `details.errorCode`; se documentaron los códigos nuevos en su cabecera.
- **H2** (`functions/core/waitlist-validate-core.js`): ausente/null/`''` se normalizan a un único valor aceptado; se agrega `'active'`. `consumed` sigue siendo terminal (volver a "sin stage" también es R2). Un stage previo desconocido no se evalúa.
- **H3** (`functions/core/line-mutation-observer-core.js`, `functions/index.js`): el cuerpo del trigger pasó al core (`handleLineMutationObservation`, §7) y el test usa la implementación real. Severidad por actor: sin uid → `LOW` + `actor: 'unknown'`; uid sin rol → `MEDIUM`; uid con rol no privilegiado → `HIGH`. Se descartan (`skipped: 'server_write'`) las escrituras con un marcador de servidor nuevo en alguna línea modificada: `asigRevertidaBy: 'system:*'`, `closedReason` de caminos de servidor (`waitlist-confirm`, `asig_sin_stock_revertida_a_bo`, `partida_cancelada_en_transito`, `asig_transito_cancelada`, `sap_manual_close`, `cliente_rechazo_cpst`, `quitado_por_vendedor_cpst`), `asigFromReparto`, `enDep11At`. Los marcadores viven en el documento y no prueban el origen: reducen ruido, no son un control.
- **H4** (`functions/core/gemini-ocr-core.js`, `functions/index.js`): nuevo `toClientOcrError`. Pasan los mensajes fijos del core (lista cerrada + 3 plantillas con un número); errores nativos, `internal`, la falta de configuración del servidor y cualquier texto con datos externos van con el genérico. Se conserva `details.errorCode: 'GEMINI_OCR_FAILED'` y el `code`.
- **H5** (`functions/core/commit-pedido-core.js`): `payloadCardCode` y `origenCardCode` van a `_logExtra` (se registran, se quitan de la respuesta); comparación con trim + mayúsculas.
- **H6** (`functions/core/auto-send-sap-core.js`): se registra solo cuando `before.stage !== 'confirmed'`. Comentario corregido (el registro se espera, no es fire-and-forget).

### Por qué

Fail-closed sin efectos parciales en la liberación; observadores con línea de base usable antes de pensar en bloquear (§77); mensajes útiles para el vendedor sin filtrar datos internos (§68).

### Verificación

- `npx vitest run tests/functions/`: 121 archivos, 1706/1706.
- `npx vitest run tests/unit/`: 236 archivos, 3131/3131.
- `npx biome check` sobre los 14 archivos tocados: sin errores (1 warning previo en `waitlist-validate-core.test.js`, parámetro sin usar en un mock existente).
- `npm run typecheck`: limpio.
- Tests nuevos o cambiados (test bug vs SUT bug, §6: todos son cambios de SUT pedidos por la revisión):
  - `release-asig-core.test.js`: SEC-M6 T1/T2 pasan de "saltea" a "aborta con `RELEASE_CROSS_CLIENT` sin escrituras fuera de `operations_log`"; T5/T6 pasan a `CLIENT_DATA_MISSING` con la orden intacta; nuevos T2b (mayúsculas/espacios), T6b (`remove_item` no quita el ítem), T6c (ítem sin reserva en orden sin cardCode se puede quitar).
  - `waitlist-validate-core.test.js`: creates con los payloads de las 5 rutas del cliente (verificadas con grep en `index.html`: CPST, Excel, manual, pedido → espera, borrador → espera), `'active'`, transiciones sin stage, reanimación `consumed` → sin stage, stage fuera de lista.
  - `line-mutation-observer-trigger.test.js`: usa el core real; severidad LOW/MEDIUM; 4 escrituras de servidor descartadas; marcador previo sin cambio no excluye; `asigRevertidaBy` no-sistema no excluye.
  - `gemini-ocr.test.js`: `toClientOcrError` (8 casos). `sec-m5-error-sanitization-index.test.js`: el contrato del wrapper ahora exige `toClientOcrError(e)`.
  - `commit-pedido-atk-002-asigrefs-xref.test.js`: T1 verifica que los cardCodes no están en la respuesta y sí en el registro; T1b (mayúsculas).
  - `auto-send-sap-sec-h2-observe.test.js`: pedido ya confirmado no vuelve a registrar.
- No verificado: comportamiento desplegado, emulador de rules, datos de producción (cuántas órdenes/pedidos sin `clientCardCode` hay hoy).

### errorCodes sin texto en el cliente

Hoy caen en el mensaje genérico del cliente (`'Error aplicando el cambio: ' + message` en la liberación, que muestra el mensaje en español del servidor):

- `CLIENT_DATA_MISSING` (nuevo, `releaseAsigCF`).
- `RELEASE_CROSS_CLIENT` (nuevo, `releaseAsigCF`).
- Ya anotados arriba y todavía pendientes: `TOO_MANY_SKUS`, `GEMINI_OCR_FAILED`, `EMAIL_SEND_FAILED`, `ROLE_CHECK_UNAVAILABLE`.

También pendiente en el cliente (otro PR): no usar el fallback `|| unitsToFree` al mostrar las unidades liberadas.

### Pendientes de la revisión (no aplicados)

- **H7**: el marker `_commitVersion` lo puede escribir el cliente; se cierra en `firestore.rules`, fuera del alcance de este ajuste.
- **H5 (parte)**: CHECK G no tiene excepción para roles privilegiados; falta confirmar con Mariano si es intencional.
- **H8**: tope de 250 productos solo con stock en vivo; sin texto para `TOO_MANY_SKUS`; el mensaje del servidor usa "SKUs".
- **H9**: `updatePedidoLinesCore` bloquea `confirmed` también para admin y chequea la invariante en todas las líneas (sin llamadores hoy).
- **H10**: el contador de rate limit se consume antes de validar parámetros; mensaje del cliente al tope no refleja ventanas de hora/día.
- **H11**: aviso de "snapshot degradado" en un caso normal (ruido) y el comentario dice `operations_log` pero solo va a consola.
- **H12**: errores de transacción del reparto se devuelven como texto en `errors[]`; limpiarlo requiere tocar el cliente.
- **H13**: costo de lecturas de `onWaitlistWriteValidate` en órdenes grandes.

### Rollback

`git revert <sha>` de este commit y redeploy de `releaseAsigCF`, `geminiOcrProxy`, `commitPedidoCF`, `onPedidoConfirmedSendToSap`, `onPedidoLineMutationObserver` y `onWaitlistWriteValidate`. Sin datos que limpiar: los cambios de observadores solo afectan qué se registra.
