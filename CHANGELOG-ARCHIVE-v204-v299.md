# CHANGELOG — v204 → v299 (archivado 2026-08-02, poda v380)

Este archivo contiene las entradas del changelog para las versiones **v204 a v299** que se movieron desde `README.md` §41 en la poda v380 (2026-08-02). Motivación: el §41 del README había crecido a ~2.380 líneas (36% del README). Estas 96 entries pre-v300 son de referencia histórica y no operativas para la app actual.

El changelog **vigente** (v300 → actual) sigue en `README.md` §41. Si necesitás contexto de una versión archivada aquí, buscá en este archivo. Si necesitás contexto de v300 en adelante, buscá en el README.

Las entradas se dejan **verbatim** como estaban en el README original — dos bloques concatenados por diferencia de orden en el archivo fuente:
- **Bloque A (v204 → v292)** en orden ascendente (cronológico, viejo → nuevo). Corresponde a las líneas 5066-5410 del README pre-v380.
- **Bloque B (v299 → v293)** en orden descendente (nuevo → viejo). Corresponde a las líneas 5466-5575 del README pre-v380.

---

## Bloque A — v204 a v292 (orden ascendente / cronológico)

### v204
- Internos preview del panel Seguimiento (esqueleto de tabs, sin acciones de borrado todavía).

### v205 — `canWrite()` incluye `gerente`
- `function canWrite(){ return userRole === 'admin' || userRole === 'vendedor' || userRole === 'gerente'; }`
- **Destraba en la UI**: cambiar estado de cliente, renombrar, categorización, marcar tienda contactada, tildar contactado. Hasta v204 Pablo abría la app y los toggles le quedaban inertes.

### v206 — Card precaución más visible
- Background pasa de `#fffbeb` (casi blanco) a `#fde68a` (amber-200).
- Franja izquierda 5px en marrón (`#b45309`).
- Aplica a tiendas POINTS, SAP huérfanas y POINTS legacy.

### v207 — Progreso de campañas GLOBAL
- Antes: cada vendedor veía solo SU aporte sobre el target → confundía.
- Ahora: suma TODOS los pedidos del scope de la campaña. Source cambia de `confirmed{}` a `globalPedidos`.
- Helper interno `passesCampScope(p)` filtra por `scope: 'all' | 'vendor' | 'province'`.
- Admin/gerente ven igual número que vendedor (todos ven el progreso del equipo).

### v208 — Gerente abre CAMPAÑAS/SAP + TARGETS-ZONAS base SAP + Análisis solo Mariano
- `openCampaignsPanel` y `openSapPanel` aceptan `gerente`.
- Botón renombrado **"Excel TARGETS-ZONAS (con altas)"** → **"TARGETS-ZONAS"**.
- `exportTargetsZonas` reescrita: solo `client_applications` con `status='approved'` Y `cardCodeSap`. Excluye POINTS, distribuidores, prospectos, mocks sin SAP.
- Columna nueva **CARDCODE SAP**.
- Botón "Exportar para Análisis" pasa de admin+gerente a **solo `erbinomariano@gmail.com`**.

### v209 — SEGUIMIENTO (esqueleto operativo)
- Botón teal "Seguimiento" en header.
- Helpers `canViewSeguimiento()`, `getSeguimientoExternalSet()`, `vendorInSeguimientoScope()`.
- Mapping configurable interno→externo via `myExternalPartners` (cargado desde `roles` con `where internalPartnerUid == uid`).
- Fallback admin/gerente: `VENDOR_INCLUDES_OTHERS`.
- Modal con barra de filtros + 8 stats cards + 7 tabs.
- Nuevas colecciones Firestore: `seguimiento_notes`, `seguimiento_status`.
- Rules nuevas con helper `isSeguimientoUser()`.

### v210-v212 — SEGUIMIENTO acciones de borrar / resolver
- Tab Visitas: botón **Borrar** por fila (admin/gerente) → delete en `/visits`.
- Tab Pedidos: botón **Borrar** por fila (admin/gerente) → delete en `/pedidos`. Útil para limpiar pedidos TEST.
- Tab Pendientes: acciones por tipo de origen. Borrar pedido si `pending_order`, marcar resuelto en `seguimiento_status` si `visit_no_order`.
- Timeline cliente: notas internas + cambio de status (pendiente/revisado/resuelto).

### v213 — Botón "Recalcular contornos de zonas"
- Tercer botón en topleft del mapa (debajo de ↻ Forzar actualización y 📍 Reubicar pines).
- Icono ⏣ polygon outline. Solo admin/gerente.
- Limpia `_vendorOutlinesCache` + `localStorage[VENDOR_OUTLINES_CACHE_KEY]` + llama a `restyleZoneLayers()` + `drawVendorOutlines()`.
- Útil después de reasignar zonas con el modal ZONAS.

### v214 — Botón ZONAS sin emoji + cargar visita para gerente/interno
- Eliminado el `.btn-zonas::before` (estaba metiendo emoji rolled-up map `🗺️`).
- `allowEdit` en `renderRutaDetalle` ampliado: **gerente** (cualquier ruta) e **interno** (zonas de sus VDEs pareja). Pablo ahora ve los botones "Cargar visita" y "Marcar como contactado" en cada tienda de la ruta del mes actual.

### v215 — Gerente lee TODOS los pedidos
- `unsubPedidosOwn`: la query branch para admin/gerente/viewer es `fbDb.collection('pedidos')` sin filter. Antes gerente quedaba con `where ownerUid == his_uid` → `confirmed{}` vacío → tab PEDIDOS > CONFIRMADOS sin contenido y filtros sin opciones.

### v216 — Fix tildar pedido bloqueado en SAP
- `renderSapPedidos`: la cleanup de `sapPendSelection` solo conservaba ids de `listos`. Al tildar un pedido BLOQUEADO el id se borraba en el siguiente render → checkbox volvía a quedar sin tildar.
- Ahora cleanup acepta `listos + bloqueados`.

### v217 — Rendiciones v2 (Híbrida Opción C) + Bucket Storage nuevo + Filtros Seguimiento
- `scripts/send_rendiciones_email.py`: import `from collections import defaultdict`.
- `build_excel` produce 3 hojas: **Gastos** agrupado por dupla `(ownerEmail, tipoGasto)` (10 columnas, lee Power Automate), **Detalle** sin agrupar (15 columnas, auditoría humana — no se mapea a SharePoint), **Solicitudes** sin agrupar.
- Pre-sube TODAS las fotos a Firebase Storage primero (cache `foto_url_by_id`), después agrupa. Las URLs van concatenadas con `;` en `Fotos URLs`.
- Bucket name actualizado a `<project>.firebasestorage.app` (formato nuevo Firebase post-2024). Env var `STORAGE_BUCKET` para forzar legacy si necesario.
- Power Automate flow se rearma: lee 10 columnas, idempotencia con `Get items` + Condition sobre `Title` único. Bloque attachments: `Compose split → For each foto URL → HTTP GET → Add attachment`. Requiere **Premium HTTP connector** (trial 90 días activo).
- Lista SharePoint SAR: columnas nuevas `Tipo comprobante` (Choice), `Cant rendiciones` (Number), `Desde`, `Hasta`, `Rendiciones IDs`.
- Seguimiento: botón APLICAR centrado en su propia fila, separado del flex de filtros.

### v218 — Fix SAP > Pendientes CardCode fallback
- `sapGetClienteCode` prioriza `sap_clients` (mapeo manual) pero cae a `approvedAltasList` con match por comercio/titular/fantasia. Antes clientes recién dados de alta sin mapeo manual quedaban como "bloqueados" en Pendientes.

### v219-v220 — Envio a SAP via Service Layer (botón + auto-envio)
- Nueva UI: botón "Enviar a SAP via SL" en tab Pendientes. Solo admin/gerente. Manda pedidos LISTOS uno por uno como Sales Quotations via `POST /b1s/v1/Quotations`.
- Toggle "AUTO-ENVIO ACTIVO" en config: cuando el vendedor confirma un pedido, se manda automáticamente a SAP sin intervención manual del admin.
- Listener SAP auto-envio (`ensureSapAutoSendListener`) watchea pedidos `stage=confirmed` y `!transferidoSAP`.

### v221-v222 — Detalle del pedido confirmado: método de pago + descuentos
- Modal "Ver pedido" ahora muestra `condicionPago`, `discountPct`, `discountSnapshot.total` para que Santiago/gerente puedan revisar cómo se armó el precio final.

### v223 — Export Excel "Precios + Stock por SKU"
- Nueva opción en el menú Exportar: baja lista completa con SKU, descripción, precio ARS, estado stock. Útil para revisar disponibilidad + reposición fuera de la app.

### v224-v226 — Fix stage='confirmed' + outlines persistence + Precaución mobile
- Fix v224: al enviar a SAP el pedido conserva `stage='confirmed'`, agrega `transferidoSAP: {at: iso, source: 'sl'}`. Antes ponía `stage='sap_imported'` y el pedido desaparecía de "Confirmados".
- Fix v225: outlines de zonas (union polygon-clipping) persisten en localStorage con signature; check de signature ANTES del listener para no invalidar el cache prematuramente.
- Fix v226/v229: cliente SOUTO aparecía sin resaltado amarillo en mobile por bug de precaución. Corregido en 4 render paths.

### v227/v230/v231/v232 — Ajustes visuales mobile
- v227/v232: ACTIVAS/HISTÓRICAS centradas en el modal Campañas.
- v228: menú hamburguesa en mobile (SALIR/exportar/etc) + logo del otro lado.
- v230: contenido de botón SEGUIMIENTO centrado.
- v231: modal Zonas full-screen en mobile.

### v233-v234 — Precaución en pedidos + real-time outlines
- Cards de pedidos con clientes precaución muestran resaltado amarillo (antes solo en Clientes).
- Nuevo listener `unsubOutlinesInvalidation` reacciona a cambios en `route_overrides` y recalcula outlines sin recarga.

### v235-v238 — Sync catálogo de productos desde SAP (manual desde cliente admin)
- Nueva pestaña "Catálogo" en modal SAP. Admin toca "Sincronizar catálogo desde SAP" → `sapSL.getAllItems()` itera `Items?$select=ItemCode,ItemName` paginando via `@odata.nextLink`.
- Escribe `product_catalog/chunk_N` chunkeado en Firestore (~4000 items/chunk).
- Listener `ensureProductCatalogListener` en cliente reemplaza `PRODUCTS` con lo de Firestore en tiempo real.
- v236: sacar filtro `Valid=Y` (SAP no siempre lo respeta, dejaba items fuera). v237: paginación via nextLink en vez de $skip. v238: quitar header `Prefer` que CORS bloqueaba.

### v239-v240 — STOCK button → Master de Productos search + eliminar botones obsoletos
- El botón STOCK del header se repurposó a "Master de Productos": modal con searchbox contra todo el catálogo SAP, muestra descripción + precio + stock en tiempo real (`sapSL.getStock(sku, 'ALL')` on-demand).
- v240: eliminados los botones PRECIOS y AUDITORÍA del header (funcionalidad migrada / obsoleta).

### v241/v243 — Sync stock manual desde cliente admin + fix duplicate declaration
- v241: botón "Sincronizar stock ahora" en modal Master Productos. Admin corre `sapSL.getAllStock('07')` en el cliente, escribe a `app_config/stock_snapshot`. Listener refresca `STOCK_MAP` para todos.
- v243 hotfix: eliminé duplicado `let unsubStockSnapshot` que rompía todo el bundle con `SyntaxError: Identifier already declared` → app quedaba colgada en "Cargando sesión...".

### v242 — LOCAL/Titular en cards (swap de display)
- En 3 render paths (SAP huérfana, POINTS, PEDIDOS CREAR): fantasía en grande + titular como subtítulo "Titular:" en chico. Antes era al revés y el vendedor buscaba por el fantasía.

### v244 — Stock SL suma warehouses vendibles (no solo W07)
- Antes: SKU `471512` decía 0 unidades en la app pero SAP tenía 20 en W12. `sapSL.getStock(sku, 'ALL')` ahora suma TODOS los warehouses **excepto W05 (Marketing) y W06 (Devoluciones)**. Los items comerciales se muestran con stock real.
- Impact: `withStock` en el snapshot pasó de ~2 (con W07 vacío) a ~3.459 reales.

### v245 — Fix cuelgue de "DISPONIBLES" en picker con 10k SKUs
- `hasStock()` hacía `Object.keys(STOCK_MAP).length` en cada llamada. Con 10.657 SKUs y el filtro DISPONIBLES iterando `PRODUCTS.filter(...)`, eran ~113M ops → thread bloqueado varios segundos.
- Fix: flag `_STOCK_MAP_HAS_DATA` O(1) actualizado cuando STOCK_MAP muta.

### v246 — 🎯 Sync automático SAP → Firestore + stock.json (GH Actions cron 30min)
**Hito grande.** Fin del CSV manual de David.

- Nuevo script `scripts/sync_sap_to_firestore.py` (Python + firebase-admin + requests):
  - Lee credenciales SL de Firestore (`app_config/sap_integration.serviceLayer`).
  - Login SL, itera Items paginando via `@odata.nextLink`.
  - Extrae stock sumando warehouses vendibles.
  - Merge con categorización del CSV inline en `index.html` (fuente de `cat/fam/sub` para los ~665 items de pesca).
  - Filtro: solo escribe al `product_catalog` los items categorizados (665). Los ~10.000 SKUs de bici/otras líneas van al `stock_snapshot` pero NO al catálogo → no ensucian el picker.
  - Escribe: `product_catalog/chunk_N`, `app_config/product_catalog_meta`, `app_config/stock_snapshot`, `stock.json` en raíz del repo.
- Nuevo workflow `.github/workflows/sync-sap-catalog-stock.yml` con cron `13,43 * * * *` (desfasado para evitar throttling en :00/:30).
- Permisos `contents: write` para poder commitear `stock.json` cuando cambia.
- Legacy `sync-stock.yml` con cron desactivado (queda como respaldo dispatch manual).

### v247 — Debug log de precios faltantes
- `getDefaultPrice` loguea en consola cuando no encuentra precio para un SKU (para diagnosticar mismatches SAP ↔ lista de precios).

### v248 — Fix "Enviar ruta por WhatsApp" colgado en iOS
- Dos bugs combinados:
  1. GPS con `enableHighAccuracy: true` + timeout 12s → colgaba en iOS con GPS del sistema apagado.
  2. `window.open(_blank)` post-`await` bloqueado por popup blocker (perdía la user gesture chain).
- Fix: nuevo `captureGpsPositionFast` con `enableHighAccuracy: false` + timeout 5s + check previo de `navigator.permissions`. En iOS abrimos una tab placeholder al toque del botón (dentro del gesture) y solo cambiamos su location cuando el mensaje está listo.

### v249 — Ocultar bloque "Precaución" a vendedores
- Info sensible (mora con distribuidores, cheques rechazados) ahora solo visible para admin/gerente. Los vendedores ven la card en amarillo y el alert al crear pedido, pero no la UI de edición del toggle/motivo.

### v250 — Fix contador HABILITADOS inconsistente
- `updateContactSummary` contaba solo clientes POINTS. `updateStats` sumaba además `approvedAltasList`. Con vendedores 100% SAP el header decía "97 habilitados" y el sub-título "0/28". Fix: replicar la misma lógica de altas SAP en `updateContactSummary`.

### v251 — MIS RENDICIONES cards clickeables
- Cada card en la lista de rendiciones del vendedor ahora abre `openRendicionDetail` con el detalle completo + foto del ticket (con zoom) + adjunto descargable. Reutiliza el mismo modal que usaba admin desde notificaciones.

### v252 — Fix CANCELAR PEDIDO (feedback + logs)
- Siempre pide confirmación (antes con 0 items cerraba silencioso). Toast al final "Pedido cancelado (N items eliminados)". Logs de diagnóstico en consola para casos edge. Rerender defensivo de picker + orderLines antes de cerrar.

### v252-post — .nojekyll para GitHub Pages
- Commit `a6b28d5`: agrego `.nojekyll` en la raíz para skipear procesamiento Jekyll (los builds Pages venían fallando con "Page build failed" sin más info). No usamos Jekyll para nada — la app es una PWA estática. Efecto colateral: builds más rápidos.

### v253-v260 — Vendedores ven cantidad de stock + fix sync 40k index limit
- v253: vendedores/internos pueden tocar "STOCK" en el picker/Master de Productos y ver la cantidad exacta del SKU (antes solo admin/gerente porque requería login SL desde el browser). Nueva key `quantities` en el snapshot Firestore (dict `{sku: qty}`) escrita por el sync automático. El cliente vendedor lee esa key + muestra "Total vendible: N unidades" + fecha de la última actualización.
- v257-v259: unificar botón "Stock" para todos los roles (sacado el "SAP LIVE" del admin que fallaba por sesión expirada / CORS). Fix: `getPriceInfo(sku)` distingue entre "no tengo el número" y "el número es 0" para no mentir con "0 unidades".
- v260: fix sync fallando con `INDEX_ENTRIES_COUNT_LIMIT_EXCEEDED`. Firestore tiene límite ~40k index entries por doc. Con `stock` (10.684 keys) + `quantities` (otras 10.684 como map) exedíamos el límite y el sync fallaba. Fix: serializar `quantities` como STRING JSON en vez de map. Firestore no indexa el contenido de un string. El cliente hace `JSON.parse` en el listener.

### v261-v266 — UI ajustes mobile + badge categoría clientes + búsqueda por fantasía
- v261: SAP Config → botón "Guardar" de Serie APP centrado abajo en mobile (no al costado del input).
- v262: fix inputs `type=date` en Seguimiento se salían del ancho en Safari iOS (`-webkit-appearance:none` + `max-width:100%` + `font-size:16px` para evitar zoom automático).
- v263: botón **🗑 Eliminar visita** en cada card de "MIS VISITAS". Admin/gerente puede borrar cualquiera; vendedor solo las suyas. Confirmación + delete de Firestore + log en `operations_log`.
- v264: **Badge de categoría (P/A/B/C) visible en cards de CLIENTES y PEDIDOS**. Colores por tipo (P morado, A verde, B azul, C gris). Tooltip con detalle del descuento aplicable.
- v265: buscadores de CLIENTES y PEDIDOS matchean también nombre del local (fantasía), no solo el titular. Nuevo helper `clientMatchesQuery` que busca en 4 fuentes: nombre titular, localidad, `customFantasia` de `clientMeta`, y `fantasia` de `approvedAltasList`.
- v266: fix badge categoría no aparecía en cards de clientes SAP. Master Clientes guarda `cliTipo` de clientes SAP en `client_applications` (no en `client_master`). Helper `getClientCategoryBadgeHtml` ahora chequea 2 fuentes: `clientMasterCache` (POINTS) + `approvedAltasList` (SAP altas) matcheando por nombre normalizado + provincia.

### v267 — Alta rápida ahora visible en VISITAS y RUTAS
- Reporte: cliente creado con "Alta rápida" (`manualSapPending: true`, sin `cardCodeSap`) aparece en CLIENTES en amarillo y en PEDIDOS, pero **NO aparecía en VISITAS ni RUTAS**.
- Causa 1 (RUTAS - `generarRutasVendor`): el filtro exigía `calle` o `address` para incluir el alta en el ruteo. Las altas rápidas muchas veces se crean sin dirección exacta → quedaban fuera silenciosamente. Fix: exigir dirección **solo** para BPs con `cardCodeSap` (oficiales SAP). Las provisorias con `manualSapPending` se rutean con centroide de la localidad.
- Causa 2 (VISITAS - `onLocalidadChange`): comparación `aLoc !== name` case-sensitive. Si POINTS tenía "Balcarce" y el vendedor tipeó "balcarce" en el alta rápida, la tienda no aparecía. Fix: comparación case-insensitive con `_normLoc(s)` (toLowerCase + trim).

### v268 — 💰 Sync automático de precios desde SAP (lista PESCA #12 ARS)
- Antes v240 eliminamos el botón PRECIOS del header. La lógica de escritura a `app_config/price_list` quedó huérfana → precios congelados desde la última carga manual (~629 SKUs desactualizados). SKUs nuevos aparecían como "(sin precio)".
- **Fix**: extender el sync automático (cron 30 min) para también traer precios de SAP y escribirlos a `app_config/price_list`. Fuente: **lista "PESCA" #12 en SAP** (ARS, factor 1), confirmada con Mariano.
- Cambios en `sync_sap_to_firestore.py`:
  - Nueva constante `PESCA_PRICE_LIST_NUM = 12`
  - En `sl_fetch_items_and_stock`: agregar `ItemPrices` al `$select` (mismo query, sin requests adicionales). Extraer precio de lista #12 por cada item → `price_map`. Solo se escribe si Price > 0.
  - Nueva función `write_price_list` que escribe a `app_config/price_list` en el mismo formato que espera el listener actual del cliente.
- Cuando administración carga un precio nuevo en SAP → aparece en la app en máximo 30 min (cron) sin acción manual.
- Filtro server-side por Item Group PESCA (`Number=102`, resuelto dinámicamente por nombre) → 755 items de pesca en el catálogo (antes 665, quedaban 90 SKUs de pesca invisibles porque no estaban en el CSV inline de `index.html`).

### v269 — Forma de entrega en el modal "Revisá tu pedido"
- Nuevo dropdown obligatorio en el modal "Revisá tu pedido" — abajo del "Forma de pago" — con 2 opciones:
  - **TRANSPORTISTA** ("Entregar a transportista") → pide nombre + dirección del transportista.
  - **SUCURSAL** ("Envío a sucursal") → pide dirección de entrega.
- Al cambiar de opción, los campos que ya no aplican se ocultan y se limpian.
- Al confirmar el pedido: si `Forma de entrega` está vacía o falta algún campo condicional, sale un alert y vuelve al modal review.
- Guardado en `docData.formaEntrega = {tipo, transpNombre, transpDireccion, sucursalDireccion}`.

### v270 — Precios TEMPORALES para SKUs sin precio en SAP
- Admin/gerente puede asignar un **precio temporal** desde el modal Master de Productos para SKUs que aún no tienen precio cargado en SAP.
- Prioridad: SAP > temporal (cuando SAP tiene precio, gana automático).
- Nueva colección Firestore: `app_config/price_list_temporal` con estructura `{prices: {SKU: number}, entries: {SKU: {price, by, at}}}`.
- Nueva función `getPriceInfo(sku)` que devuelve `{source: 'sap'|'temporal'|null, price}`. `getDefaultPrice` es un wrapper.
- Modal Master de Productos:
  - Nuevo checkbox **"Solo sin precio"** junto a "Solo con stock" → filtra SKUs sin precio en SAP NI temporal (útil para asignar precios).
  - Badge amarillo `⏱ TEMPORAL` al lado del precio cuando la fuente es temporal.
  - Botón por SKU (solo admin/gerente): **"💵 Cargar $"** (rojo, sin precio), **"✎ Editar $"** (amber, con temporal), **"✎ Temp"** (gris, ya tiene SAP).
  - Prompt con contexto claro sobre la prioridad SAP > temporal.

### v271 — Forma de entrega al Remarks del Sales Quotation
- Hasta que Ezequiel Mendoza (SEIDOR) cree UDFs dedicados para forma de entrega en SAP, se guarda la info dentro del campo Remarks (=Comments en OQUT / Sales Quotation).
- Nuevo helper `buildEntregaSuffixForRemarks(pedido)` usado en:
  1. `sapSL.buildQuotationPayload` → Comments (Service Layer)
  2. `exportSapReadyCsv` → Comments (DTW CSV OQUT)
- Formato del suffix:
  - `Entrega TRANSPORTISTA: <nombre> - <direccion>`
  - `Entrega SUCURSAL: <direccion>`

### v272 — Fix "Pasar a Pendientes" fallando silencioso post-Excel
- Reporte del vendedor cargando pedido desde Excel: al tocar "Pasar a Pendientes" "no pasaba nada". Causa: la validación de forma de entrega (obligatoria desde v269) se hacía **dentro** de `doConfirmPedido` — después de cerrar el modal review y abrir el confirm-dialog (mes/año). Cuando fallaba, salía `alert()` + cierre del confirm-dialog + apertura del review de nuevo, pero el vendedor no lo entendía.
- **Fix**: nueva función `validateReviewAndPasarAPendientes()` que hace TODAS las validaciones ANTES de cerrar el review. Si algo falla, muestra un **banner rojo visible dentro del modal** review + focus/scroll al campo faltante. El review NO se cierra hasta que esté todo OK.
- **STOCK sin cambios**: SKUs sin stock nunca bloquearon el pedido. Salen en rojo como advertencia visual solamente. El parser Excel distingue entre "SKU inexistente" (se ignora + advierte) y "SKU reconocido pero sin stock" (se agrega normal).

### v273 — Entregar a transportista: 3er campo "Dirección de entrega al cliente"
- En el bloque TRANSPORTISTA del modal Revisá tu pedido ahora se piden **3 campos obligatorios** (antes eran 2):
  1. Nombre del transportista
  2. Dirección del transportista
  3. **Dirección de entrega al cliente** (NUEVO) — dirección final donde el transportista deja el pedido para el cliente.
- Persistencia: `docData.formaEntrega.clienteDireccion` guardado al confirmar. Compat con pedidos previos (sin `formaEntrega`).
- Vista del pedido confirmado: muestra la nueva línea "Dirección entrega al cliente: <valor>".
- Remarks del Sales Quotation SAP: agrega `| Entrega al cliente: <direccion>` al string existente. Aplicado a SL + DTW.

### v274 — VISITAS: foto desde galería + búsqueda en Localidad/Tienda
- **Fix 1 - carga de fotos desde galería**: los inputs de foto en VISITAS tenían `capture="environment"` que en mobile forzaba abrir SOLO la cámara. Removido en los 4 lugares (vf-espacio + vf-frente, static y dinámicos). Ademas agregado `image/heic,image/heif` al `accept` para que iPhone pueda subir sus fotos nativas.
- **Fix 2 - búsqueda escribiendo en Localidad y Tienda**: antes eran `<select>` nativos con listas larguísimas (~500 localidades) que obligaban a scrollear mucho en mobile. Reemplazados por un componente **filter-select** custom (input de texto que filtra un dropdown al escribir, tolerante a mayús/minús y acentos).
- Nuevas funciones globales: `fsPopulate(fsId, options, onChangeCb)`, `fsSetValue(fsId, value, label)`, `fsReset(fsId)`, `fsClear(fsId)` + handlers UI. Enter selecciona el primer match, Escape cierra el dropdown.
- El hidden input mantiene el id `vf-localidad` / `vf-tienda` para que el submit del form siga funcionando sin cambios.

### v275 — Fix flujo Excel → Pasar a Pendientes (defensive)
- `openExcelPedidoModal`: agregar `stage: 'crear'` al `currentOrderClient` para diferenciar explícito de `pending` (antes era undefined y podía confundir el flow).
- `openConfirmDialog`: defensivo contra `currentOrderClient` null. Si está null, reconstruye el nombre desde `currentOrderKey.split('|')` + rebuild `currentOrderClient` con datos mínimos así `doConfirmPedido` no crashea después.
- `validateReviewAndPasarAPendientes`: wrap todo en try/catch. `console.log` al inicio + antes de `openConfirmDialog`. setTimeout 200ms para verificar que el confirm-dialog quedó abierto — si no, alert al user y reabre el review.

### v276 — Fix CANCELAR pedido no vaciaba realmente el borrador
- **Bug**: al tocar CANCELAR en pedido EN CURSO, el borrador se borraba en localStorage pero **revivía** al volver el listener y quedaba EN CURSO de nuevo. Los SKUs no se deseleccionaban.
- **Causa raíz**: `saveOrders` hace `.set({orders}, {merge: true})` en Firestore. Con `merge:true`, Firestore aplica **deep merge** de objetos anidados → las keys borradas localmente NO se borran en el server (se mantienen con su valor anterior porque no están en el nuevo payload). El siguiente snapshot del listener trae `orders` con las keys zombie → el pedido cancelado "revive".
- **Fix**: `cancelPedido` ahora usa `FieldPath('orders', key)` + `FieldValue.delete()` para borrar la key específica en Firestore (FieldPath es necesario porque las keys tienen `|` que rompe dot notation). `suppressCloudSave = true` durante la operación para evitar re-escribir el objeto viejo.

### v277 — Fix banner de error stuck en modal review
- **Bug UX**: cuando el vendedor tocaba "Pasar a Pendientes" antes de elegir Forma de Pago / Forma de Entrega, el banner rojo aparecía. Al corregir el campo faltante, el `onchange` de los selects **solo recalculaba el descuento** pero NO limpiaba el banner. Quedaba visible aunque el error ya no aplicara → confusión del vendedor ("¿por qué no me deja pasar si ya lo puse?").
- **Fix**: nueva función `revalidateReviewSilently()` que chequea el estado completo de los campos del review y limpia el banner si todo está OK. Se dispara en `onchange` de los selects (Forma Pago, Forma Entrega) y en `oninput` de los 4 inputs de dirección (`rv-transp-nombre`, `rv-transp-direccion`, `rv-cliente-direccion`, `rv-sucursal-direccion`). No introduce errores nuevos — solo LIMPIA silenciosamente cuando corresponde.

### v278 — Pasar a Pendientes ahora pasa DIRECTO (sin paso intermedio de mes/año)
- **Bug estructural**: el diálogo de mes/año (`.confirm-dialog`) tenía CSS `position:absolute;inset:0;z-index:10` anidado dentro del `#pedido-modal`. En el flujo Excel (que abre `#review-modal` **sin abrir** `#pedido-modal`), al tocar "Pasar a Pendientes" el `openConfirmDialog()` "abría" el diálogo pero **sin contenedor visible → invisible**. `doConfirmPedido` nunca corría, el pedido quedaba en `orders[]` con badge "En curso" y el vendedor no entendía por qué.
- **Fix funcional**: `validateReviewAndPasarAPendientes` ahora popula `cd-mes`/`cd-anio` con el mes/año actual y llama **directo** a `doConfirmPedido`, saltándose el `confirm-dialog` intermedio. El vendedor ve el `confirm()` nativo del navegador ("Confirmar pedido de X para <mes actual>?") — imposible de perder. Si necesita cambiar el mes/año lo edita después desde el pendiente.
- **Fix defensivo (por si algún flujo futuro sigue abriendo el confirm-dialog)**: cambio CSS `.confirm-dialog { position:fixed; z-index:9999; border-radius:0 }` para que sea full-screen y no dependa del pedido-modal.

### v279 — Fix pedido aparece y desaparece cuando Firestore rechaza por permisos + rules para interno
- **Bug UX**: cuando `pedidos.add()` fallaba con `Missing or insufficient permissions`, el `.catch()` mostraba el alert pero el bloque de **fallback local** seguía ejecutándose → el pedido se metía en `pending[currentOrderKey]` y aparecía momentáneamente en la pestaña PENDIENTES. Cuando el listener del snapshot rerenderizaba con datos del server (que NO tenía el pedido), la lista se refrescaba y el pedido "desaparecía". Confusión total del vendedor.
- **Fix del frontend**: en `doConfirmPedido`, la escritura local a `pending[]` ahora ocurre **dentro del `.then()`** de Firestore, no fuera. En el `.catch()`, si el error es `permission-denied` / `unauthenticated`, NO se toca `pending[]` local — el borrador queda vivo en `orders[]` (badge "En curso") con un alert claro incluyendo email del user, cliente y error code. Para errores de red / timeout / quota SÍ se guarda local (offline-first) para no perder el trabajo.
- **Fix de las Rules (Firebase Console)**: la Rule original de `pedidos` **solo permitía a un usuario interno (VDI) crear pedidos EN NOMBRE de un VDE pareja** (`onBehalfOf: true`). Cuando Santiago (interno) intentaba cargar un pedido para sí mismo (`onBehalfOf: false`), la Rule lo rechazaba. Se agregaron 2 líneas a `/pedidos/{pedidoId}` (create y update/delete):
  ```
  || (isInterno()
      && request.resource.data.ownerUid == request.auth.uid
      && request.resource.data.onBehalfOf == false)
  ```
  Con esto, un interno también puede crear/editar/borrar sus propios pedidos (mirror de la Rule de visitas que ya lo permitía).

### v280 — Excel: incluir SKUs no encontrados con badge REVISAR EN SAP + matching case-insensitive
- **Bug reportado**: la app descartaba silenciosamente cualquier SKU del Excel que no matcheara **exacto y case-sensitive** con el catálogo. Ejemplo real: el vendedor cargó `GLF-26BLUE` (con L y todo mayúsculas) pero el SKU real en el master SAP era `GLF-26B1ue` (con **1** en lugar de L + minúsculas). El pedido llegaba sin esa línea y el vendedor no se enteraba.
- **Fix 1 — matching case-insensitive**: `parseExcelPedidoFile` ahora compara `codeLower` contra `p.code.toLowerCase()`. Si el vendedor escribió `glf-26b1ue` (todo minúscula) o `GLF-26B1UE`, igual matchea con `GLF-26B1ue`. Al hacer match, se guarda el código CANÓNICO del master (no la capitalización del vendedor) para que SAP reciba el código bien formado.
- **Fix 2 — SKUs no encontrados se incluyen con needsReview**: cuando aun con case-insensitive no hay match, la línea se **agrega igual** al pedido con `needsReview: true`, `desc: "⚠ REVISAR EN SAP - SKU no encontrado en catalogo"`, `precio: 0`, sin cat/fam/sub. Preview del Excel cambia el warning: antes decía *"se ignoraron"*, ahora dice *"se incluyen en el pedido con marca ‹REVISAR EN SAP› para que Administración los verifique antes de cargarlo"*.
- **Highlight visual** en el modal review: líneas con `needsReview` salen con fondo amarillo, dot naranja y badge `🔍 REVISAR EN SAP`.
- **Persistencia**: `docData.lines[].needsReview` se guarda a Firestore + 2 flags top-level nuevos: `docData.hasSkusToReview: true` y `docData.skusToReviewCount: N`. Admin puede filtrar pedidos con SKUs pendientes con `WHERE hasSkusToReview = true` (en Firestore o desde Power BI cuando esté conectado).

### v281 — Buscador con lupa dentro del modal Revisá tu pedido
- Con pedidos de ~150 SKUs (típico de un Excel completo) el vendedor tenía que scrollear mucho para encontrar un producto puntual y verificar precio o cantidad.
- Nuevo input con lupa arriba del listado que filtra las líneas en tiempo real por código o descripción (case-insensitive, sensible a substring).
- **Los totales NO se ven afectados por el filtro** (siguen sumando sobre TODO el pedido). El filtro es solo visual, para navegar. El vendedor puede buscar sin miedo de estar viendo un total falso.
- Contador *"N de M productos"* a la derecha del label "Pedido actual" cuando el buscador está activo.
- Botón (×) para limpiar el filtro con un click. El buscador se resetea al abrir el modal (no arrastra filtros de sesiones previas).
- Si el filtro no matchea nada, mensaje *"Ningún producto matchea «X»"*.

### v282 — Sync automático de BPs pesca (primera versión, luego iterada)
- Nueva función `sync_bp_pesca()` en `scripts/sync_sap_to_firestore.py`. Corre en la misma corrida del cron cada 30 min que ya trae items+stock+precios.
- **Objetivo**: cerrar el gap donde los BPs nuevos de SAP quedaban invisibles en la app hasta que admin subía manualmente un CSV desde el panel Integración.
- Primera versión filtraba por `SalesPersonCode IN {50-55}` (los 6 vendedores pesca) pero devolvió 0 BPs — el campo del header viene `-1` "No Sales Employee" para todos los BPs pesca. Se iteró hasta v288.

### v283 — Fix banner de error stuck + revertir Confirmado → Pendientes + card fallback + Opción A
Múltiples cambios agrupados:
- **Banner de error auto-clear**: cuando el vendedor corregía los campos faltantes (Forma Pago, Forma Entrega, direcciones), el banner rojo se quedaba visible aunque el error ya no aplicara. Nueva función `revalidateReviewSilently()` que chequea el estado completo en cada `onchange`/`oninput` y limpia el banner si todo está OK.
- **Botón "Volver a Pendientes"** en modo Confirmado (solo admin/gerente): permite revertir un pedido de la pestaña Confirmados de vuelta a Pendientes para editarlo o retener el envío a SAP. Si el pedido ya se transfirió a SAP (`transferidoSAP.docNum` seteado), avisa que la Sales Quotation en SAP NO se elimina y hay que cancelarla manualmente. Guarda auditoría en `revertedFromConfirmedAt`, `revertedBy`, `previousSapDocNum`.
- **Fix `approvedAltas` listener con fallback**: cuando el sync o el admin agregaba clientes nuevos, las cards del header (Localidades/Habilitados/Pendientes/Tiendas) no se actualizaban silenciosamente si `drawMarkers()` throweaba. Fix defensivo: log explícito del error + fallback que llama `updateStats(filteredPoints())` directo para asegurar el update.
- **Opción A — Alinear contador '97 / 137' con card TIENDAS**: `updateContactSummary()` ahora usa `effClients`/`effProspects` (misma lógica que `updateStats`). Antes contaba clientes del padrón viejo sin CardCode SAP; ahora ambos indicadores muestran el mismo criterio (solo SAP-confirmados). Coherencia total entre el header y la lista.

### v284-v287 — Iteraciones del sync BPs pesca (ver sección 40-bis)
Cronología de bugs y fixes:
- **v284**: try filtrar por `U_DIVISION eq 'PESCA'` en OData → SL no matchea UDF en `$filter`. Además intento asignar vendedor por provincia con mapping hardcoded en el script (mismo mapping que index.html:~8160).
- **v285**: cambio a filtrar UDF en Python. Paginado se cortaba porque el `nextLink` viene sin `@` en algunas versiones SL. Fix: chequear `@odata.nextLink` OR `odata.nextLink`. Agregado safety cap 500 páginas.
- **v286**: filtro `U_DIVISION == '1'` (creyendo que era PESCA) → trajo 2506 BPs de BICICLETAS.
- **v287**: **simplificación** — el user aclaró que solo quiere los BPs en la app, la asignación de vendedor+zona la hace admin/gerente manualmente. Se removió toda la lógica de "asignar vendedor por provincia". El sync deja `assignedVendor` y `ownerUid` vacíos en el CREATE inicial; en UPDATE no los toca (para no pisar reasignaciones del gerente).

### v288 — FIX definitivo sync BPs pesca + poblar provincia canónica
**El filtro correcto de U_DIVISION** después de capturas del BP master data en SAP:
```
1 = BIKE
2 = PESCA
3 = BIKE & PESCA
```
Anterior v286 filtraba por `'1'` (BIKE), causando la explosión de 2506 clientes bike en la app. Fix v288: `U_DIVISION IN ('2', '3', 'PESCA', 'BIKE & PESCA')`.

**Provincia canónica**: el UDF `U_SH_PCIA` guarda el código interno (ej: `'2'`), no el nombre. El sync ahora hace lookup a `/States?$filter=Country eq 'AR'` al inicio para tener el mapping `{'2': 'SALTA', '3': 'BUENOS AIRES', ...}` y convierte el código al nombre canónico UPPERCASE. Se guarda en el campo `provincia` que la app usa para filtrar/agrupar clientes por localidad. Sin esto, los BPs sincronizados no aparecían en la lista de la app (aparecían en Firestore pero invisibles en la UI).

**Nuevo script de limpieza** `scripts/cleanup_bad_bp_sync.py` — borrar de Firestore SOLO docs con `source='sap_sync'` + `createdAt > cutoff`. Con este script se limpiaron los 2506 clientes BIKE mal cargados por v286. Nunca toca SAP.

**Volumen final actual**: ~103 BPs pesca. De los 2600 BPs Customer/Lead totales en SAP, 2506 son BIKE (se descartan).

Detalles completos + troubleshooting en la sección 40-bis del README.

### v289 — README como fuente de verdad (regla dura para IA)
- Bloque destacado al inicio del README obligando a mantenerlo actualizado en cada commit que toque `index.html`, `sw.js` u otro archivo del repo.
- Bump de la tabla "Versión actual" / "APP_VERSION" a v290. Sin cambios funcionales en la app.

### v290 — Botón "👤 Provisorios" en Master Clientes
- Toolbar violeta al lado de "Masterfile-Base" con badge de conteo en tiempo real.
- Filtra `approvedAltasList` por `manualSapPending === true && !cardCodeSap` → clientes de Alta Rápida que faltan cargar a SAP.
- Al tocarlo, la tabla del Master Clientes reemplaza sus filas por los provisorios: fondo crema, badge morado ⚡ PROVISORIO, columnas Comercio (con dueño + teléfono) / Localidad / Provincia / Vendedor asignado / Dirección de Alta Rápida / Fecha alta.
- Reutiliza `approvedAltasList` (no crea listener nuevo). Actualiza el badge desde `ensureApprovedAltasListener` cada vez que llega snapshot.

### v291 — Autosave debounced + fix crítico del sync SAP

**Autosave en Master Clientes filas SAP:**
- Antes localidad/provincia solo se guardaban al tocar GUARDAR y el aviso "cambios sin guardar" solo detectaba la dirección. Se perdían silenciosamente al cerrar.
- Ahora cada cambio dispara `scheduleMcAutosave(docId, row, 900)` → mismo `saveMcAddr` con merge + geocode.
- Badge amarillo en stats: `Guardando N` / `Pendientes: N`.
- Listener de `approvedAltasList` difiere el re-render de la tabla si hay saves en vuelo (evita reventar inputs de filas todavía sin guardar).
- `closeMasterClientesPanel` chequea también `mcPendingRowIds` y `mcAutosaveInFlight`.

**Fix crítico `sync_sap_to_firestore.py` (backend):**
- Bug reportado: Mariano completó ~20 tiendas SAP con localidad+provincia a la mañana; a las pocas horas volvían a `(sin localidad)`/`(sin provincia)`.
- Causa: `sync_bp_pesca()` hacía `set({merge:True})` con `base_payload` que **siempre** incluía `localidad`, `localidadFinal`, `provincia` — aunque SAP los tenga vacíos. Cada corrida del workflow scheduled (`cron: '13,43 * * * *'`) escribía `''` sobre esos campos y destruía el trabajo manual del admin.
- Fix: `pop()` de esos campos del payload cuando SAP viene sin valor. Merge preserva lo cargado a mano.
- Trade-off consciente: si SAP tiene un valor distinto al que cargó el admin, el sync sigue pisando (comportamiento "SAP siempre gana", consistente con `runRevisarDireccionesSap`). Para bloquearlo completamente habría que agregar un flag `localidadManualOverride: true` que el sync respete.

### v292 — KPI "PENDIENTES" del header = badge "Provisorios" del Master Clientes
- Antes `updateStats()` contaba `pendientes` = POINTS/prospectos no contactados + SAP altas sin `provincia + geo + dirección`, filtrados por vendor/provincia/localidad.
- Ahora `.js-stat-p` usa `getProvisoriosList().length` — mismo total global que el badge del botón Provisorios.
- Ambos KPIs coinciden y significan lo mismo: **provisorios de Alta Rápida pendientes de cargar a SAP**.
- Se pierde la métrica "cuántas tiendas de mi zona me faltan visitar/geolocalizar" como KPI destacado. La variable `pendientes` local sigue disponible en el scope de `updateStats()` si algún día se rescata.

---

## Bloque B — v293 a v299 (orden descendente / nuevo a viejo dentro del archive)

### v299 — Form Visita: buscar directo por tienda, localidad se autocompleta

**Pedido de los vendedores**: en el form de Visita perdían tiempo eligiendo primero la Localidad y "a veces no saben bien la localidad del cliente". Que puedan **ir directo a la tienda**.

**Cambio**: la Tienda es ahora la fuente única de búsqueda. La Localidad se infiere automáticamente al elegir la tienda y se muestra como confirmación visual.

**Antes** (v274 → v298): 2 pasos secuenciales
1. Buscar localidad en `vf-localidad` (filter-select, deshabilita `vf-tienda`).
2. Buscar tienda en `vf-tienda` (filtrada por localidad elegida).

**Ahora** (v299+): 1 paso directo
1. Buscar tienda en `vf-tienda` — cada opción muestra `"Nombre — Localidad, Provincia"` para desambiguar homónimos (ej. "El Delfín — Quilmes, Buenos Aires" vs "El Delfín — Tigre, Buenos Aires").
2. Al elegir → badge celeste debajo del input: **"📍 Localidad detectada: Quilmes — Buenos Aires"**.

**Implementación técnica**:
- HTML: bloque de Localidad convertido en `display:none` (el `<input hidden id="vf-localidad">` sigue existiendo para no romper `readField` ni el schema del save). Tienda ahora arranca habilitada con placeholder "Escribí el nombre de la tienda...".
- Nuevo div `#vf-loc-detected` (celeste, oculto por default) debajo de Tienda con el badge de localidad.
- `populateVisitaLocalidades()` reescrita: en vez de armar `Set<PROV||Loc>`, arma `items[]` con `value = "PROV||Loc||Tienda"` y `label = "Tienda — Loc, Prov"`. Dedup case-insensitive. Recorre POINTS + `approvedAltasList` (incluye provisorios con badge ⚡).
- Nuevo `onTiendaChange(val)`: parsea `val = "PROV||Loc||Tienda"`, setea el hidden `vf-localidad` con `"PROV||Loc"` (formato que espera el save en línea 24904 `const [prov, locName] = readField('vf-localidad').split('||')`), pisa el hidden `vf-tienda` con solo el nombre, y muestra el badge de confirmación.
- `onLocalidadChange` queda como no-op para no romper referencias externas (era llamada por `abrirVisitaParaTienda_real` desde rutas).
- `viewVisit()` y `abrirVisitaParaTienda_real()` actualizados: setean `vf-tienda` con el value compuesto y llaman `onTiendaChange`.

**Data en Firestore sin cambios**: el schema del doc `visits` sigue igual (`provincia`, `localidad`, `tienda` como campos separados). Solo cambia la UX de captura.

**Retrocompat**: visitas viejas se abren con el nuevo formato automáticamente (el `viewVisit` arma el compuesto desde los 3 campos). Sin migración de datos.

### v298 — Gerente ve todas las visitas + comentarios (pedido de Pablo)

**Pedido**: Pablo (gerente) por Teams: "si me podes habilitar para ver los comentarios de las visitas que dejan los vendedores en el CRM".

**Diagnóstico**: Firestore Rules línea `visits` ya permitía `reads = todos` para cualquier autenticado (ver sección 9). El bloqueo era 100% client-side: 2 listeners de `visits` filtraban por `.where('ownerUid', '==', currentUser.uid)` para cualquier rol que no fuera `admin` o `viewer`. Gerente caía en el else → solo veía sus propias visitas (que son 0 porque no visita clientes, solo aprueba).

**Fix** (2 líneas): sumar `'gerente'` al bucket del listener sin filtro:
- `index.html:12243` — listener de `ensureVisitsListener()` (rutas + mapa)
- `index.html:24447` — listener del pane Visitas (`MIS VISITAS` → renderVisitasList)

Ahora gerente:
- Ve TODAS las visitas de todos los vendedores en el tab VISITAS.
- Puede leer el comentario, tipo de venta, oportunidad, foto del frente, etc.
- Puede eliminarlas (el permiso ya lo tenía en `canDeleteThis` desde antes, pero como no le llegaba la lista era inútil).
- Las rutas del mes se pintan con visitas de todos.

**Impacto en Firestore reads**: gerente ahora suscribe a la colección entera (~50-100 docs). Costo mínimo, dentro del free tier.

### v297 — Export Excel de Targets en formato largo (SAP / Power BI)

**Pedido del usuario**: exportar los targets mensuales a Excel con formato "una fila por vendedor+mes" — específicamente con columnas `SlpCode | Vendedor | Año | Mes | Meta`. Uso: importar el master de targets a SAP o alimentar directamente Power BI.

**Implementación**:
- Nuevo botón verde **📊 Exportar Excel** en el footer del modal Targets (a la izquierda de "Cerrar" / "Guardar Targets").
- `exportTargetsExcel()` itera `targetsCache` (todos los meses de todos los vendedores) y emite una fila por cada entrada con `targetArs > 0`. Meses sin cargar o con valor 0 se omiten.
- **Columnas**:
  - `SlpCode`: resuelto vía `sapGetSlpCodeForVendor(vendorKey)` desde `sap_vendors`. Si el vendedor no está mapeado a SAP, queda vacío (admin lo completa a mano).
  - `Vendedor`: preferencia `slpName` de `sap_vendors` (formato SAP "Gonzalo de la Rosa"). Fallback: `titleCase(vendorKey)` (formato "Gonzalo De La Rosa").
  - `Año`: número.
  - `Mes`: **1-12** en el Excel (más legible), aunque Firestore guarda 0-11.
  - `Meta`: `parseFloat(targetArs)` redondeado a entero.
- **Orden**: SlpCode asc → Vendedor → Año → Mes.
- **Nombre archivo**: `Targets_Shimano_YYYY-MM-DD.xlsx`.
- Anchos de columna razonables via `ws['!cols']`.

**Permisos**: `canManageTargets()` (admin/gerente + emails allowlist).

### v296 — Ortografía "MOSTRADO" → "MOSTRADOR" (reporte de vendedor)
- Vendedor reportó "Abajo de todo en el registro de la visita, en la opción TIPO DE VENTA, dice 'MOSTRADO' en vez de MOSTRADOR".
- Fix quirúrgico manteniendo compatibilidad de datos:
  - `<option value="MOSTRADO">MOSTRADOR</option>` en dos selects: **Tipo de venta** (`vf-tipoventa`) y **Necesidad puntual** (`vf-necesidad`).
  - Label del input de ponderación: `Mostrado %` → `Mostrador %`.
  - Modal detalle de visita (`cv-section` Tipo de venta): si `v.tipoVenta === 'MOSTRADO'` mapea display a `MOSTRADOR`.
  - Excel exports (3 puntos: `exportVisitasWithPhotos`, export visitas simple, export análisis): headers `Pond Mostrador` / `% Mostrador` y valores mapeados.
- **Value en Firestore sigue siendo `'MOSTRADO'`**. No se migra data histórica ni se toca el campo `ponderacionMostrado`. El único cambio es display. Motivo: `readField('vf-tipoventa').value` sigue devolviendo `'MOSTRADO'` porque el `value=` del option no cambia. Cero riesgo de romper visitas viejas o filtros.

### v295 — Badge Categoría (Cat P/A/B/C) fijo en esquina de card
- Pedido del usuario: que el badge de categoría comercial aparezca **siempre en la esquina superior derecha** de cada card en CLIENTES y PEDIDOS, no inline al lado del nombre (donde se movía según el largo del texto).
- `getClientCategoryBadgeHtml(province, locName, name, opts)` acepta ahora `opts.corner`:
  - `{corner: true}` → renderea `<span class="cli-cat-corner" ...>` con `position:absolute;top:6px;right:8px` + `pointer-events:none` (no roba el click de la card).
  - Sin opts → sigue emitiendo el badge inline como antes (usado en el modal de cliente y otros lugares).
- CSS: `.client-card` y `.pedido-client-card` ahora tienen `position:relative`. `.client-card` gana `padding-right:62px` para reservar el espacio del badge y evitar que el nombre se meta debajo.
- Cards de **CLIENTES** (2 puntos de render en `renderClients()`) usan modo corner absoluto.
- Cards de **PEDIDOS** (`renderPedidosClientes`): el CAT va dentro del cluster derecho arriba del badge Habilitado/Provisorio (inline, no absoluto) porque el `top-right` chocaba con "Habilitado" que ya vive ahí.

### v294 — Vincular provisorios con BPs de SAP: CUIT en Alta Rápida + botón manual "Vincular"

**Problema**: Cuando el admin cargaba un cliente a SAP (que la app tenía como provisorio), el sync `sync_bp_pesca()` corría cada 30 min y usaba `find_match()` para vincular. El match automático se hacía por: (1) `cardCodeSap`, (2) `cuit` normalizado, (3) nombre en `comercio`/`fantasia`/`razonSocial` uppercase+trim exacto. Los provisorios de Alta Rápida no guardaban CUIT y su nombre (nombre comercial, ej. "El Delfin") casi nunca matchea con el CardName de SAP (razón social del titular, ej. "BARGELLINI, GUSTAVO"). Resultado: el sync creaba un BP nuevo en `client_applications` y el provisorio quedaba huérfano en NO CONFIRMADOS para siempre.

**Fix 1 — CUIT opcional en form Alta Rápida** (`ar-cuit`): input debajo de teléfono. Guardado en `client_applications.cuit` normalizado (solo dígitos). Aviso de confirmación si tiene ≠ 11 dígitos. El sync ya lo consume vía `_norm_cuit()` sin cambios. Vuelve el match 100% confiable para altas futuras.

**Fix 2 — Botón "🔗 Vincular con SAP" en Master Clientes → tab Provisorios** (solo admin, columna "Acción"). Abre modal con:
- Info del provisorio arriba (nombre + localidad + provincia + CUIT + dirección).
- Buscador (nombre / CardCode / CUIT).
- Lista de BPs SAP disponibles (`approvedAltasList` con `cardCodeSap` truthy y `!manualSapPending`).
- **Auto-ranking**: los BPs cuyo CUIT matchea el CUIT del provisorio aparecen primero con badge verde "✓ CUIT MATCH".
- Botón "Vincular" por fila → confirm → `batch.set` sobre el provisorio con `cardCodeSap` + `manualSapPending: false` + `source: 'sap_sync_manual_link'` + campos SAP (sapCardType, sapDivision, sapValid, sapFrozen, sapSalesPersonCode, sapReadyForSL) + `linkedFromSapDocId` + `linkedBy` + `linkedAt` de auditoría. Completa campos vacíos del provisorio (cuit/calle/localidad/provincia/email/tel/CP) con los de SAP sin pisar los cargados. `batch.delete(sapRef)` elimina el BP SAP duplicado.
- **Permisos**: solo admin (gerente no puede delete del doc SAP porque no es owner, Firestore Rules línea "delete: admin O owner si NO tiene cardCodeSap"). Para gerente/interno la columna muestra "(admin)".

**Resultado**: Los 16 provisorios existentes ahora se vinculan uno a uno vía UI sin esperar match automático. Los provisorios futuros con CUIT cargado se resuelven solos en el próximo cron (13,43 * * * *).

**Trade-off consciente**: si admin vincula el provisorio con el BP SAP equivocado, no hay undo automático. Auditoría en `linkedFromSapDocId` (guarda el ID del BP borrado) permite reconstruir manualmente si hace falta.

### v293 — Fix tab "NO CONFIRMADOS" mostraba 3 items cuando el KPI PENDIENTES decía 16
- Reporte del usuario: el header decía "16 PENDIENTES" pero al abrir CLIENTES → NO CONFIRMADOS aparecían solo 3 (los 3 tenían provincia = Capital Federal).
- Causa: en `renderClients()` la inyección de altas SAP/provisorios tenía dos filtros incompatibles con el criterio del KPI:
  1. `if (!prov) return;` — skipeaba todo provisorio SIN provincia asignada (los 13 faltantes no tenían provincia todavía porque el vendedor no la completó en el alta rápida).
  2. `if (stateFilter === 'pendientes' && (hasGeo && hasAddr)) return;` — un provisorio con geo + address se excluía del filtro "pendientes" aunque siga siendo provisorio (no cargado a SAP).
- Fix: nuevo flag `isProvisorio = !cardCodeSap && !!manualSapPending` (mismo criterio que `getProvisoriosList()`). Los provisorios ahora:
  - Pasan aunque no tengan provincia (no aplica el guard `!prov`).
  - Siempre pasan el filtro "No confirmados" (nunca son "confirmados").
  - Nunca aparecen en el filtro "Confirmados" aunque tengan lat/lng+dirección (siguen siendo provisorios hasta cargarlos a SAP).
- Bonus render: cuando un provisorio no tiene provincia, la card muestra badge naranja "⚠️ sin provincia" en lugar de un `/` suelto.
