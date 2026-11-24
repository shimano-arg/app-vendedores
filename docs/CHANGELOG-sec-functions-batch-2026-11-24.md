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
