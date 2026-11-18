# CHANGELOG — Refactor modal "Reportes Excel" (v1565, 2026-11-18)

Pedido Mariano: modificar las columnas exportadas + renombrar opciones y archivos + eliminar categorias que no se usan. Captura adjunta del modal como fuente de verdad.

## Antes

El modal `#export-modal` listaba 11 opciones con nombres mezclados (titulo, sentence case, mayusculas inconsistentes). Cada export generaba un `.xlsx` con 15-32 columnas que no estaban alineadas con el uso que Mariano hace del dato.

## Problema

- 5 opciones ya no se usan y confunden al usuario: "Altas de clientes", "Pendiente de Asignacion - Pablo", "Stock Asignado - lineas", "Ventas x articulo x cliente / vendedor", "Infracciones MELI (MAP)".
- Nombres del modal no coinciden con los nombres de archivo ni con los que Mariano usa internamente en Power BI / informes.
- Columnas tienen nombres tecnicos (ej. "Pond Mostrador", "Importe USD", "GPS Dist (m)") en vez de los nombres estandar que Mariano pidio (ej. "PONDERACION_MOSTRADOR", "IMPORTE").

## Cambio

### Eliminaciones (modal + dispatcher)

- `Altas de clientes` (`data-exp-kind="ALTAS"`).
- `Pendiente de Asignacion - Pablo` (`PENDIENTE_ASIG_PABLO`).
- `Stock Asignado - lineas` (`STOCK_ASIG`).
- `Ventas × articulo × cliente / vendedor` (`VENTAS_ART_CLI`).
- `Infracciones MELI (MAP)` (`INFRACCIONES_MELI`).

Los `<div class="exp-opt">` correspondientes se borraron del `#export-modal`. El dispatcher `showMonthPicker → exportXxxForMonth` perdio las ramas `ALTAS`/`VENTAS_ART_CLI`/`STOCK_ASIG`. Los handlers JS (`exportAltasForMonth`, `exportStockAsigAll`, `exportPendienteDeAsignacionPablo`, `exportVentasArtCliForMonth`, `exportInfraccionesMeli`) **quedan como funciones dormidas** en `src/domains/exports-*.js` (no se exportan al modal, pero el codigo sigue vivo por si Mariano los reactiva). El flag `INFRACCIONES_MELI_READERS` y el gate client-side quedan intactos — no se accionan sin boton. Esto permite rollback rapido si Mariano cambia de idea.

### Renombres (UI + archivo)

| Opcion UI (antes) | Opcion UI (ahora) | Archivo `.xlsx` (antes) | Archivo `.xlsx` (ahora) |
|---|---|---|---|
| Visitas y Contactos | **VISITAS** | `Shimano_Visitas_<period>.xlsx` | `VISITAS_<period>.xlsx` |
| Masterfile Clientes | **Master Clientes** | `Masterfile_Clientes_SAP_<scope>_<ts>.xlsx` | `Master Clientes_<scope>_<ts>.xlsx` |
| Backorder | **BACKORDER** | `Shimano_Backorder_Snapshot_<ts>.xlsx` | `BACKORDER_<ts>.xlsx` |
| Pedidos del mes | **PEDIDOS DEL MES** | `Shimano_PedidosDelMes_<period>.xlsx` | `PEDIDOS DEL MES_<period>.xlsx` |
| Rendiciones | Rendiciones (sin cambio) | `Shimano_Rendiciones_<period>.xlsx` | `Rendiciones_<period>.xlsx` |
| Lista de precios - disponible | — sin cambio — | — sin cambio — | — sin cambio — |

### Columnas exactas

Para los 5 exports modificados, las columnas quedan EXACTAMENTE como Mariano dicto (mayusculas, underscores, acentos, slash, parentesis):

**Rendiciones.xlsx** (10 columnas):

`FECHA_DE_RENDICION | TIPO | VENDEDOR | CONCEPTO | N° TICKET | TIPO_DE_GASTO | IMPORTE | OBSERVACIONES | FOTO_TICKET | ESTADO`

| Columna | Fuente de datos (Firestore `rendiciones/{id}`) |
|---|---|
| FECHA_DE_RENDICION | `r.fecha` |
| TIPO | `r.tipo` |
| VENDEDOR | `r.ownerName \|\| r.vendorName \|\| r.ownerEmail` |
| CONCEPTO | `r.descripcion` (gasto) / `r.tipoOperacion \|\| r.motivo` (anticipo) |
| N° TICKET | `r.numeroTicket` |
| TIPO_DE_GASTO | `r.tipoGasto` |
| IMPORTE | `r.importe` |
| OBSERVACIONES | `r.observaciones \|\| r.notas` + `+ Solicitado por: X` cuando aplica |
| FOTO_TICKET | imagen embebida (ExcelJS addImage) desde `r.fotoTicket` (base64) o `r.fotoTicketUrl` (Storage) |
| ESTADO | `r.status \|\| r.estado` |

**BACKORDER.xlsx** — 2 hojas:

Hoja `Backorder_Clientes` (6 columnas):

`SKU | NOMBRE_DEL_PRODUCTO | CANTIDAD_BACKORDER | SUBTOTAL | CLIENTE | ID_PEDIDO`

Hoja `Backorder_SKU` (4 columnas):

`SKU | CANTIDAD_BACKORDER | SUBTOTAL | PROMEDIO_VENTA_3M`

| Columna | Fuente de datos |
|---|---|
| SKU | `computeBackorderExportRows` row `SKU` |
| NOMBRE_DEL_PRODUCTO | `r.Producto` |
| CANTIDAD_BACKORDER | `r.Cantidad_Pendiente_BO` |
| SUBTOTAL | `r.Subtotal_BO_ARS` |
| CLIENTE | `r.Cliente` |
| ID_PEDIDO | `r.Pedidos` (ID de pedido Firestore cuando hay 1 fuente; si son varios, aparecen separados por ", ") |
| PROMEDIO_VENTA_3M | **vacio** (pendiente; requiere agregado desde BigQuery `v_ventas_lineas` sum(qty) last 90d / 3 — no implementado en este PR) |

Hoja Backorder_SKU se calcula client-side con reduce por SKU de los rows de Backorder_Clientes (suma `CANTIDAD_BACKORDER` + `SUBTOTAL`, mantiene `NOMBRE_DEL_PRODUCTO` del primer match). Order DESC por SUBTOTAL.

**PEDIDOS DEL MES.xlsx** (8 columnas):

`FECHA_DE_PEDIDO | CLIENTE | ID_PEDIDO | SKU | NOMBRE_DEL_PRODUCTO | CANTIDAD | SUBTOTAL | LOCALIDAD`

| Columna | Fuente de datos (`pedidos.lines[]`) |
|---|---|
| FECHA_DE_PEDIDO | `fecha` (derivada de `pedido.createdAt`) |
| CLIENTE | `p.clientName` |
| ID_PEDIDO | `p._fsId` |
| SKU | `l.code` |
| NOMBRE_DEL_PRODUCTO | `l.desc \|\| l.name` |
| CANTIDAD | `l.qty` |
| SUBTOTAL | `round(l.qty * (l.priceAtCreation \|\| l.precio))` |
| LOCALIDAD | `p.locName` |

**Master Clientes.xlsx** (17 columnas):

`CARDCODE_SAP | NOMBRE_TIENDA | TIPO_CLIENTE | PROVINCIA | LOCALIDAD | DIRECCION | TIPO_DE_CLIENTE | TAMAÑO | ESPECIALIZACION | TIPO_DE_LOCAL | PREFERENCIAS_CONTACTO | CREDITO_CHEQUE | FACTURACION_ACUMULADA_12MESES | FRECUENCIA_COMPRA(DIAS) | ULTIMA_COMPRA | VENDEDOR_ASIGNADO | ULTIMA_VISITA/CONTACTO_FECHA`

El export se construye con los rows internos del handler historico (`CardCode SAP`, `Nombre tienda`, `Tipo`, etc.) y se remapea al shape pedido ANTES del `downloadXlsx`. La hoja `Resumen por zona` que el export generaba junto con la hoja de clientes **no va mas** (Mariano pidio una sola hoja con las 17 columnas).

| Columna | Fuente interna |
|---|---|
| CARDCODE_SAP | `CardCode SAP` |
| NOMBRE_TIENDA | `Nombre tienda` |
| TIPO_CLIENTE | `Tipo` ("Cliente actual" / "Provisorio (Alta rapida)") |
| PROVINCIA | `Provincia` (title case) |
| LOCALIDAD | `Localidad (mapa)` (fallback `Localidad declarada`) |
| DIRECCION | `Direccion` |
| TIPO_DE_CLIENTE | `Tipo de cliente` (Ficha Cliente — clasif) |
| TAMAÑO | `Tamaño` / `Tamano` (Ficha Cliente) |
| ESPECIALIZACION | `Especialización` (Ficha Cliente) |
| TIPO_DE_LOCAL | `Tipo de local` (Ficha Cliente) |
| PREFERENCIAS_CONTACTO | `Preferencia de contacto` (Ficha Cliente) |
| CREDITO_CHEQUE | `Crédito cheque (ARS)` (Ficha Cliente) |
| FACTURACION_ACUMULADA_12MESES | `Monto total (12m)` (client_buyer_stats.stats_12m) |
| FRECUENCIA_COMPRA(DIAS) | `Frecuencia (días entre compras)` (client_buyer_stats) |
| ULTIMA_COMPRA | `Última compra` (client_buyer_stats.stats_12m.ultimaCompra) |
| VENDEDOR_ASIGNADO | `Vendedor externo (VDE)` |
| ULTIMA_VISITA/CONTACTO_FECHA | **vacio** (pendiente: requiere query extra a `visits` por cliente para ultima fecha — no implementado en este PR) |

**VISITAS.xlsx** (16 columnas):

`FECHA_DE_VISITAS | VENDEDOR | INTERACCION | TIPO | LOCAL | TAMAÑO | FIDELIDAD | RELEVANCIA | POP | MAS_VENDIDO | MAS_PREGUNTAN | AYUDA_TIENDA | TIPO_DE_VENTA | PONDERACION_MOSTRADOR | PONDERACION_ECOMMERCE | FOTO_FRENTE`

| Columna | Fuente de datos (`visits/{id}`) |
|---|---|
| FECHA_DE_VISITAS | `v.fecha` |
| VENDEDOR | `titleCase(v.vendor)` |
| INTERACCION | "Visita" / "Contacto" (segun `v.interactionType`) |
| TIPO | `v.tipo` |
| LOCAL | `v.local` |
| TAMAÑO | `v.tamano` |
| FIDELIDAD | `v.fidelidad` |
| RELEVANCIA | `v.relevancia` |
| POP | `v.pop` |
| MAS_VENDIDO | `v.masVendido` |
| MAS_PREGUNTAN | `v.masPreguntan` |
| AYUDA_TIENDA | `v.ayudaTienda` |
| TIPO_DE_VENTA | `v.tipoVenta` (normalizado MOSTRADO -> MOSTRADOR) |
| PONDERACION_MOSTRADOR | `v.ponderacionMostrado` |
| PONDERACION_ECOMMERCE | `v.ponderacionEcommerce` |
| FOTO_FRENTE | imagen embebida (ExcelJS addImage) desde `v.frentePhoto` o `v.frentePhotoUrl` |

## Por que

Mariano le pide al export que coincida 1:1 con las columnas que necesita en Power BI (y con los nombres que uso internamente en el equipo). Al unificar los nombres de columna en mayusculas con underscores, se evitan errores de match / mapping cuando alimenta otras tablas. Las 5 opciones eliminadas tenian baja frecuencia de uso y confundian al resto del equipo.

## Verificacion

- `node build.js` → bundle regenerado.
- `npm run test:unit` → suite previa + nuevos tests de contrato (grep del modal + grep de columnas exactas).
- Inspeccion manual del modal: 6 opciones visibles (VISITAS, Rendiciones, Master Clientes, Lista de precios - disponible, BACKORDER, PEDIDOS DEL MES). El resto NO esta.
- Suite de smoke del bundle sigue pasando (chunks sincronizados, filesystem).

## Diferido (NO resuelto en este PR)

- **PROMEDIO_VENTA_3M** (hoja Backorder_SKU): requiere query a BigQuery `v_ventas_lineas` filtrada por `fecha >= today - 90d`, sumada por SKU y dividida por 3. Sin esa agregacion, la columna queda vacia. Candidato para proxima iteracion: usar un callable `generateBackorderPromedioCF` o integrar el agregado dentro del mismo callable `generateVentasReportCF` que ya existe.
- **ULTIMA_VISITA/CONTACTO_FECHA** (Master Clientes): requiere iterar `visits` por `cardCode` y traer la `fecha` mas reciente. Alternativa: materializar un indice `client_last_visit_at` en Firestore (updated via trigger `onCreate` sobre `visits`) y leerlo aqui.
- **TIPO_CLIENTE vs TIPO_DE_CLIENTE** (Master Clientes): Mariano pide ambas. La primera la mapeamos a `Tipo` (Cliente actual / Provisorio). La segunda al `Tipo de cliente` de la Ficha Cliente. Si hay que invertirlas, es un edit de 1 linea.
- **Handlers JS dormidos**: `exportAltasForMonth`, `exportStockAsigAll`, `exportPendienteDeAsignacionPablo`, `exportVentasArtCliForMonth`, `exportInfraccionesMeli` quedan vivos en el bundle. Costa de bundle ~15 KB. Si se quiere reducir, se pueden borrar en un PR separado.

## Rollback

- `git revert <sha>` de este PR vuelve el modal al estado previo + restaura las columnas historicas.
- Los `.xlsx` ya generados antes del deploy siguen abriendose (shape previo). Las columnas nuevas no rompen formatos abiertos; son archivos autonomos.

## Precedente

- `v1396` (2026-10-21): Mariano habia depurado antes el modal ("Pendiente de Asignacion - Pablo" nueva primary, "Stock Asignado - lineas" renombrada). Este PR termina el trabajo eliminando esas opciones que no se consolidaron en uso.
- `v1413` §51 (2026-10-22): INFRACCIONES_MELI agregada Mariano-only. Hoy se decide eliminarla del modal (la exportacion sigue disponible via consola/bookmarklet para los 3 emails autorizados; el gate `INFRACCIONES_MELI_READERS` queda vivo).

## Archivos tocados

- `index.html` (modal depurado + comentario v1565).
- `src/domains/exports-core.js` (5 exports modificados + dispatcher reducido).
- `app.bundle.js` (regenerado).
- `chunks/*.js` (regenerados).
- `docs/CHANGELOG-exports-columns-refactor.md` (nuevo — este archivo).

CLAUDE.md §30: documentacion completa pre-commit.
