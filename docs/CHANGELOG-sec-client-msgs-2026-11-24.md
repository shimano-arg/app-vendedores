# v1570 (2026-11-24) — Mensajes para los códigos de error nuevos del servidor y ajustes de la revisión de #1415

## Antes

- El servidor empezó a devolver códigos de error nuevos (en `details.errorCode` del error de la función, o en `errorCode` del resultado de `commitPedidoCF`): `ROLE_CHECK_UNAVAILABLE`, `CLIENT_DATA_MISSING`, `RELEASE_CROSS_CLIENT`, `TOO_MANY_SKUS`, `GEMINI_OCR_FAILED`. El cliente no los conocía:
  - `releaseAsigCF` mostraba `Error aplicando el cambio: <mensaje del error>` o `Error guardando: <mensaje>`, con el texto crudo.
  - `commitPedidoCF` trataba `ROLE_CHECK_UNAVAILABLE` (code `unavailable`) como caída de red y mostraba "No se pudo contactar al servidor". `TOO_MANY_SKUS` caía en `UNKNOWN`.
  - `fetchStockLiveCF` registraba todo como `callable_error`.
  - El OCR de rendiciones mostraba `OCR fallo: <mensaje>`.
  - El reenvío de mails del planner mostraba `Error al reenviar: <mensaje>`.
- Al quitar un producto con reserva, el cartel "Producto quitado · N u liberadas" usaba `d.unitsCancelled || unitsToFree`: si el servidor devolvía 0, mostraba lo que el cliente estimaba.
- Revisión de #1415 (A-2, A-3, A-5):
  - A-2: si el primer intento de OCR fallaba por sesión y el reintento lo rechazaba el control de rol, se mostraba el cartel de App Check ("borrá los datos del sitio").
  - A-3: `safeDownloadHref` aceptaba cualquier URL `https:`.
  - A-5: `data-uid` del panel de usuarios (`src/domains/admin-users.js`) se armaba sin escapar.

## Problema

El vendedor veía textos técnicos o mensajes que no correspondían a lo que pasó (§68). En el caso de A-2 le pedían borrar los datos del sitio cuando el problema era de permiso. Con A-3, un adjunto con URL externa mostraba un link "Descargar" a otro sitio.

## Cambio

- `src/pure/mensajes-vendedor.js`:
  - Entradas §68 para `ROLE_CHECK_UNAVAILABLE`, `CLIENT_DATA_MISSING`, `RELEASE_CROSS_CLIENT`, `TOO_MANY_SKUS`, `GEMINI_OCR_FAILED` y `EMAIL_SEND_FAILED`.
  - Helpers nuevos: `SERVER_ERROR_CODES_MAPEADOS`, `getServerErrorCode(e)` y `formatServerErrorAlert(e)` (devuelve el mensaje o `null`). Expuestos en `window.__phase0.pure.mensajesVendedor`.
- `index.html`:
  - `window._serverErrorAlertText(e)` generaliza `_roleRequiredAlertText` (que queda como alias de ROLE_REQUIRED), con textos inline de respaldo (`window._SERVER_ERROR_FALLBACK_TEXTS`) por si el bundle viene stale.
  - Los dos `catch` de `releaseAsigCF` usan `_serverErrorAlertText(e) || _releaseFailedAlertText()` (`RELEASE_FAILED`), sin concatenar el mensaje crudo.
  - Quitar producto con reserva: el cartel y el `logOp` usan solo `d.unitsCancelled` / `d.linesCancelled` del servidor.
  - `_tryCommitPedidoCF`: `ROLE_CHECK_UNAVAILABLE` se devuelve como error de negocio antes de la rama de red (el servidor corta antes de escribir, no hay pedido que recuperar). `TOO_MANY_SKUS` en `details` se mapea a su código. El `else` final usa el texto inline si el bundle no tiene el código.
  - `fetchStockLiveCF`: motivos `role_check_unavailable` y `too_many_skus` en `_liveStockMeta` (sigue el fallback silencioso al snapshot).
  - Reenvío de mails del planner: mensaje del código del servidor si lo hay; si no, `EMAIL_SEND_FAILED`.
- `src/domains/rendiciones.js` (OCR):
  - `ROLE_CHECK_UNAVAILABLE` en el primer intento corta antes del recovery de App Check.
  - A-2: si el reintento falla con `ROLE_REQUIRED` o `ROLE_CHECK_UNAVAILABLE`, se muestra ese mensaje en lugar del de App Check.
  - `GEMINI_OCR_FAILED` con code `internal` (texto genérico del servidor) muestra el mensaje §68. Con otro code, el servidor manda un texto fijo y útil (imagen grande, tipo no soportado) y se conserva.
- A-3, `src/pure/html-safe.js`: `safeDownloadHref` acepta `https:` solo si el host es exactamente `firebasestorage.googleapis.com` o `storage.googleapis.com` (`DOWNLOAD_HOSTS_PERMITIDOS`). El único call-site es el adjunto de rendiciones, que hoy se guarda como `data:` desde `FileReader`; las URLs de Storage de la app salen de `getDownloadURL()`, con host `firebasestorage.googleapis.com`. `safeImgSrc` no cambia.
- A-5, `src/domains/admin-users.js`: los dos `data-uid` pasan por `escapeHtml(docId)`. Quien lee el atributo recibe el mismo valor.
- Rebuild de `app.bundle.js` y `chunks/`. `APP_VERSION` y `CACHE_VERSION` a v1570.

## Por qué

§68: el vendedor tiene que ver qué pasó y qué hacer, con el código técnico al final para mandarlo por WhatsApp. Las unidades liberadas tienen que ser las que liberó el servidor. A-3 y A-5 son defensa en profundidad pendiente de la revisión de #1415.

## Verificación

- Test nuevo: `tests/unit/audit/server-error-codes-cliente.test.js`, que cubre los textos (sin jerga, dos oraciones, código al final), la paridad entre el pure y el fallback inline, los helpers y el cableado en `index.html`, `rendiciones.js` y `admin-users.js`.
- Actualizados: `tests/unit/audit/html-safe.test.js` (hosts permitidos y rechazados) y `tests/unit/audit/role-required-cliente.test.js` (nuevo nombre del helper e import).
- Corridas: `npx vitest run tests/unit`, `tests/smoke`, `npx biome check` sobre los archivos tocados y `npm run typecheck`. Los resultados están en el PR.
- No se probó en un navegador real ni contra las funciones desplegadas. Los códigos nuevos dependen del PR de `functions/` (#1419). Hasta que se despliegue, el cliente sigue mostrando los mensajes de antes para los errores que el servidor hoy no etiqueta.

## Rollback

Revertir el commit y reconstruir el bundle. No hay cambios de datos ni de reglas.
