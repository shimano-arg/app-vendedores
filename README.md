# Shimano App Vendedores — Documentación técnica completa

> ⚠️ **REGLA DURA PARA CLAUDE / IA COLABORADORA** ⚠️
> **Después de CUALQUIER cambio en `index.html`, `sw.js` u otro archivo del repo, ACTUALIZAR ESTE README.md en la misma tanda de commits.** El README es la fuente de verdad viva del proyecto: si un cambio no queda reflejado acá (nueva sección, campo Firestore, botón, función, versión, etc), se considera trabajo incompleto. Bumpear también `APP_VERSION` / `CACHE_VERSION` y la fila "Versión actual" en la tabla de abajo. Nunca hacer `git push` sin haber tocado el README si el cambio es visible al usuario o al modelo de datos.

App web para el equipo comercial de **Shimano Argentina** durante la transición de Baraldo (distribuidor histórico) a venta directa. Cubre todo el ciclo: gestión territorial por zona, alta de clientes, visitas con GPS, armado de pedidos, rendiciones de gastos con OCR de tickets, rutas optimizadas, tareas entre usuarios, integración con SAP B1 (DTW manual + Service Layer directo), backup total y reasignación de zonas.

| | |
|---|---|
| **URL pública** | https://shimano-arg.github.io/app-vendedores/ |
| **Repo** | https://github.com/shimano-arg/app-vendedores |
| **Firebase project** | `app-vendedores-shimano` |
| **Admin bootstrap** | `bot.shimano.pesca@gmail.com` (auto-elevación al primer login) |
| **Admin backup** | `erbinomariano@gmail.com` (Mariano Erbino) |
| **SAP Service Layer URL** | `https://shimano-sap.seidor.com.ar:50000` |
| **SAP CompanyDB PROD** | `SHIMANO_SAU` |
| **SAP CompanyDB TEST** | `SHIMANO_TST_06` |
| **Stack** | HTML5 + Vanilla JS + Firebase Firestore + Gemini API (OCR) |
| **Build pipeline** | Python (openpyxl) genera el HTML autosuficiente desde Excels master |
| **Versión actual** | SW v315 |
| **APP_VERSION** | `v315` (sincronizada con `sw.js` CACHE_VERSION; banner en console al arrancar + chequeo HTML vs SW) |
| **Firebase plan** | **Blaze** activo (necesario para Storage + extensions BigQuery) |
| **Pipeline Power BI** | Firestore → BigQuery (Extension `firestore-bigquery-export`, 7 colecciones + `targets` via sync propio) + SAP → BigQuery (`sync_sap_to_bigquery.py`, 6 tablas raw) → **14 vistas curadas** (base: `v_pedidos_header`, `v_pedidos_lines`, `v_visitas` **con `interaction_type`+`es_contacto`+`forma_contacto`**, `v_facturas_sap` **con `paid_to_date`+`saldo_ars`+`assigned_vendor`**, `v_inventario` **con alias `qty_quotations_open`**, `v_inventario_por_warehouse`, `v_ventas_lineas` **con `cobrado_prorrateado_ars`+`deuda_prorrateada_ars`+`assigned_vendor`**, `v_backorder_lineas`, `v_targets` **con `target_reel/canas/lineas_ars`**; **deuda 2026-07-20**: `v_deuda_por_vendedor`, `v_deuda_facturas_detalle`, `v_facturado_cobrado_deuda_por_vendedor`; **rendiciones 2026-07-22**: `v_rendiciones`, `v_rendiciones_duplicados`) → **Power BI Desktop TABLERO SAR publicado con 8 páginas (Desempeño-Pesca, Ventas, Pedidos, Visitas, Facturación por vendedor, Backorder, Inventario, Rendiciones), slicer de vendedor migrado a `assigned_vendor` (fuente de verdad app, no SlpCode SAP inconsistente)**. Ver sección 40 |
| **Sync SAP automático** | Service Layer → Firestore + `stock.json` **+ BPs pesca cada 30 min** (cron GH Actions `13,43 * * * *`). Desde v288 sincroniza también BPs con `U_DIVISION ∈ {2 PESCA, 3 BIKE&PESCA}` a `client_applications` — los altas SAP aparecen en la app sin acción manual del admin |
| **Bot Inventario Google Sheet** | Lee `raw.githubusercontent.com/shimano-arg/app-vendedores/main/stock.json` cada 30 min — datos frescos garantizados |

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Estado actual del lanzamiento](#2-estado-actual-del-lanzamiento)
3. [Stack técnico](#3-stack-técnico)
4. [Estructura del repo](#4-estructura-del-repo)
5. [Pipeline de build](#5-pipeline-de-build)
6. [Sistema de autenticación y autorización](#6-sistema-de-autenticación-y-autorización)
7. [Roles y permisos](#7-roles-y-permisos)
8. [Modelo de datos Firestore](#8-modelo-de-datos-firestore)
9. [Firestore Security Rules](#9-firestore-security-rules)
10. [Estructura de la UI](#10-estructura-de-la-ui)
11. [Sistema de zonas y vendedores](#11-sistema-de-zonas-y-vendedores)
12. [Sección: Localidades / Clientes / Pedidos](#12-sección-localidades--clientes--pedidos)
13. [Sección: Rutas](#13-sección-rutas)
14. [Sección: Visita](#14-sección-visita)
15. [Sección: Dashboard](#15-sección-dashboard)
16. [Sección: Rendiciones](#16-sección-rendiciones)
17. [Sección: Alta Clientes](#17-sección-alta-clientes)
18. [Sección: Notificaciones](#18-sección-notificaciones-alertas-y-tareas)
19. [Sistema VDE-VDI (vendedor externo / interno)](#19-sistema-vde-vdi-vendedor-externo--interno)
20. [Provincias hardcoded a VDIs](#20-provincias-hardcoded-a-vdis)
21. [Campañas comerciales](#21-campañas-comerciales)
22. [Targets mensuales](#22-targets-mensuales)
23. [Panel Master Clientes + import SAP](#23-panel-master-clientes--import-sap)
24. [Modal Zonas (reasignación)](#24-modal-zonas-reasignación)
25. [Integración SAP B1](#25-integración-sap-b1)
26. [Stock SAP](#26-stock-sap)
27. [OCR de tickets con Gemini API](#27-ocr-de-tickets-con-gemini-api)
28. [PWA installable](#28-pwa-installable)
29. [Backup TOTAL de la app](#29-backup-total-de-la-app)
30. [Exports a Excel / Power BI / ML](#30-exports-a-excel--power-bi--ml)
31. [Panel admin "Usuarios"](#31-panel-admin-usuarios)
32. [URLs externas e integraciones](#32-urls-externas-e-integraciones)
33. [Convenciones de código](#33-convenciones-de-código)
34. [Regenerar y deployar](#34-regenerar-y-deployar)
35. [Troubleshooting](#35-troubleshooting)
36. [Ciberseguridad y hardening](#36-ciberseguridad-y-hardening)
37. [Contactos clave](#37-contactos-clave)
38. [Roadmap / pendientes](#38-roadmap--pendientes)
39. [Seguimiento (panel VDIs)](#39-seguimiento-panel-vdis)
40. [Power BI / BigQuery](#40-power-bi--bigquery)
41. [Changelog v204 → v292](#41-changelog-v204--v292)

---

## 1) Resumen ejecutivo

### Para qué sirve

Shimano Argentina necesita gestionar la operación de **4 vendedores externos (VDE)** y **2 vendedores internos (VDI)** que recorren tiendas de pesca en todo el país después de la salida del distribuidor histórico (Baraldo). La app cubre:

- **Mapa interactivo** de Argentina con 24 provincias + 527 departamentos pintados por zona de vendedor.
- **~1.000 tiendas** pre-cargadas (clientes + prospectos + distribuidores) con sistema de habilitación.
- **665 SKUs** del master de productos (pesca).
- **6 zonas**: Z1 Gonzalo, Z2 Federico, Z4 Martin, Z5 Mauricio, Z6 Ioannis (VDI), Z7 Santiago (VDI).
- **Provincias hardcoded a VDIs** (Patagonia → Ioannis, NOA + NEA → Santiago).
- **Rutas mensuales** auto-generadas por proximidad (10-15 tiendas por ruta).
- **Visitas a tiendas** con formulario completo + foto + GPS doble-check.
- **Pedidos** confirmados con condición de pago → exportables como ZIP DTW o enviados directo por Service Layer.
- **Rendiciones de gastos** con OCR de tickets (Gemini) y aprobación por gerente.
- **Alta de clientes nuevos** con doble aprobación + auto-aparición en el mapa al aprobar.
- **Reasignación de zonas** desde modal admin (overrides por tienda o por localidad).
- **Master Clientes** con direcciones exactas + import masivo desde SAP B1.
- **Stock SAP** vía CSV manual (3x día) o Service Layer real-time.
- **Notificaciones y tareas** entre usuarios con imágenes (con botón Eliminar por card desde v179+).
- **Dashboard** comparativo del equipo + por vendedor individual.
- **Campañas comerciales** vigentes con tracking de SKUs.
- **Targets mensuales en ARS** cargados por gerente.
- **PWA installable** en celular como app nativa.
- **Backup TOTAL** mensual con TODAS las colecciones Firestore + fotos.
- **Sistema VDE-VDI** con pareja: VDI puede crear pedidos/visitas en nombre de su VDE pareja.
- **Rutas personalizadas** (colección `custom_routes`): el vendedor arma su propia ruta con tiendas + fecha + orden, complementando las rutas auto-recomendadas.
- **Alta rápida** de clientes provisorios (`source: 'alta_rapida'`, `manualSapPending: true`) para no bloquear pedidos mientras Admin carga el cliente a SAP.

### Filosofía de diseño

- **App estática en GitHub Pages** (sin backend propio). Toda la lógica corre en el navegador.
- **Firebase Firestore** como backend real (auth + DB).
- **Sin framework** (JS vanilla): un solo `index.html` ~3.2 MB con todo embebido.
- **Build offline en Python** genera el HTML desde Excels master cuando hay que actualizar datos estáticos.
- **Datos vivos** (pedidos, visitas, usuarios, alta clientes, etc.) viven 100% en Firestore.
- **Tiempo real** via `onSnapshot` listeners.
- **Offline-friendly**: persistencia IndexedDB activada en Firestore.
- **SAP B1 con doble vía**: DTW manual (probado y funcional) + Service Layer (preparado, en espera de bloqueantes SEIDOR/IT).

---

## 2) Estado actual del lanzamiento

### Funcionalidades implementadas (✅ todas)

```
[X] Mapa interactivo con 6 zonas + filtros
[X] Sistema de roles (admin / gerente / vendedor / interno / viewer / unassigned)
[X] Auth Google + Microsoft (Azure AD) + Email/password + Magic link (passwordless)
[X] Reset password vía Firebase Auth (panel Usuarios → 2 opciones: reset email / PIN legacy)
[X] 2FA opcional para todos los roles (antes era obligatorio admin)
[X] Alta de clientes con flujo de aprobación 2 aprobadores
[X] Alta rapida: cliente provisorio sin doble aprobacion (badge "⚡ PROVISORIO" + fondo crema)
[X] Auto-aparición en mapa al aprobar alta + al crear alta rapida
[X] Modal Zonas (admin): reasignar tienda o localidad con historial
[X] Outlines de zonas: hibrido provincia+dept con union polygon-clipping + cache localStorage
[X] PROVINCE_VENDOR_OVERRIDE (hoy: SAN LUIS → MARTIN BOIERO)
[X] Master Clientes: direcciones + CardCode SAP + dropdown provincia editable
[X] Import masivo desde SAP B1 (fuzzy matching + auto-habilitar + crear nuevas + ownerUid)
[X] Stock SAP via CSV upload manual (Stock panel admin) + GitHub Actions sync 30min
[X] Cliente Service Layer JS + pestaña config en SAP modal (en espera de cableado UI)
[X] ZIP DTW funcional, probado E2E en TST_06 con OQUT + UDFs + Series APP
[X] Backup TOTAL: ZIP con 19 colecciones Firestore + fotos + metadata
[X] Sugerencias de SKUs basadas en historial real de pedidos (no MELI)
[X] Provincias hardcoded a VDIs (Patagonia/Mendoza→Ioannis, NOA/NEA→Santiago)
[X] Rutas auto-generadas + recalcular manual
[X] Rutas personalizadas (collection custom_routes con toggle "Recomendadas/Personalizadas")
[X] Rendiciones con OCR Gemini de tickets + foto y N° ticket opcionales
[X] Export Rendiciones mensual desde la UI con foto embebida (ExcelJS local) + columnas SAP
[X] Export Visitas mensual con foto del frente embebida (ExcelJS)
[X] Mail Rendiciones cron Lun/Mie (Python + openpyxl) con hyperlink Firebase Storage a foto del ticket
[X] Dashboard comparativo
[X] Export Excel TARGETS-ZONAS con altas integradas
[X] Notificaciones entre usuarios con imágenes + boton Eliminar por card
[X] Sistema VDI/VDE con pareja + restricción de filtro por rol
[X] Gerente ve todo el mapa (fix getMyAllowedVendorKeys)
[X] Targets mensuales por vendedor
[X] Campañas comerciales con tracking de SKUs
[X] Vista preliminar de pedido (puntos verde/rojo por stock, subtotales disponibles/no)
[X] Filtro stock en picker (Todos / Disponibles / No disp.)
[X] Confirmados con filtros mes/tienda/año
[X] PWA con SW v217 + login bg con foto del río
[X] Boton "Forzar actualizacion" (↻) + "Reubicar pines" (📍) + "REFRESCAR APP" mobile
[X] Banner version + chequeo sync HTML vs SW en console al arrancar
[X] Botón Recalcular Rutas en la pestaña Rutas
[X] Sidebar Localidades incluye altas SAP (suma POINTS + sapLocs) + modal localidad con detalle por tienda (v198+)
[X] Burbujas agregadas del mapa OFF por flag SHOW_AGG_BUBBLES = false (v199+)
[X] Master Clientes: botón Eliminar 🗑 por fila (admin/gerente) — SAP altas y POINTS legacy (v200+)
[X] Zonas: gerente puede reasignar + scope "Por provincia" + toast verde con detalle de cambios (v201/v203)
[X] Mail Rendiciones cron Lun/Mie 9am AR con hyperlink Firebase Storage a foto del ticket + Tablas Excel nombradas (v202+)
[X] Integración SharePoint + Power Automate: ítems creados automáticamente en lista "ANTICIPO Y RENDICION DE GASTO" del team SAR (v203)
[X] Gerente: canWrite + abre CAMPAÑAS/SAP + ve todos los pedidos (lista CONFIRMADOS poblada) + edita rutas del mes (v205/v208/v214/v215)
[X] Card precaución más visible: amber-200 + franja marrón izquierda 5px (v206)
[X] Progreso de campañas GLOBAL (suma todos los vendedores del scope, no solo el propio) (v207)
[X] TARGETS-ZONAS reescrito: solo BPs vivos con CardCode SAP + columna CARDCODE SAP (v208)
[X] "Exportar para Análisis" restringido a Mariano (v208)
[X] **SEGUIMIENTO**: panel comercial completo para admin/gerente/interno con 7 tabs + timeline cliente + notas internas + status flow (v209-v212)
[X] Botón "Recalcular contornos de zonas" en topleft del mapa (admin/gerente) (v213)
[X] Botón ZONAS sin ícono emoji (v214)
[X] Tildar pedido bloqueado en SAP — fix cleanup de sapPendSelection (v216)
[X] Rendiciones v2: TablaGastos agrupada por dupla (vendedor, tipoGasto) + hoja "Detalle" sin agrupar para auditoría + fotos pre-subidas a Storage y concatenadas (v217)
[X] Master Clientes: botón "👤 Provisorios" violeta filtra altas rápidas pendientes de SAP (manualSapPending && !cardCodeSap) con badge de conteo en tiempo real (v290+)
[X] Master Clientes: autosave debounced 900ms en localidad/provincia/dirección de filas SAP + listener de approvedAltas no re-renderea si hay saves en vuelo (v291+)
[X] Fix crítico sync SAP: sync_sap_to_firestore.py ya NO pisa localidad/provincia con vacío si SAP no trae valor (evita destruir edits manuales del admin cada 30 min) (v291+)
[X] KPI "PENDIENTES" del header ahora = mismo total global que badge "Provisorios" del Master Clientes (=provisorios de Alta Rápida pendientes de cargar a SAP) (v292+)
[X] Fix tab "NO CONFIRMADOS" en CLIENTES: mostraba solo 3 cuando el KPI decía 16. Ahora todo provisorio (manualSapPending && !cardCodeSap) aparece siempre en "No confirmados", sin requerir provincia y sin filtrar por hasGeo/hasAddr — mismo criterio que getProvisoriosList() (v293+)
[X] CUIT opcional en form Alta Rápida — habilita match automático confiable cuando el sync SAP corre (find_match usa CUIT como criterio prioritario después de CardCode) (v294+)
[X] Botón "🔗 Vincular con SAP" en Master Clientes → Provisorios: modal con lista de BPs SAP disponibles, buscador y auto-ranking por CUIT match. Copia CardCode al provisorio + elimina el BP SAP duplicado + preserva assignedVendor/approvals/notas (v294+)
[X] Badge de categoría (Cat P/A/B/C) fijado en la esquina superior derecha de cada card de CLIENTES (`position:absolute` + padding-right en la card) — siempre visible al escanear la lista. En PEDIDOS va en el cluster derecho arriba del badge Habilitado (v295+)
[X] Ortografía "MOSTRADO" → "MOSTRADOR" en form de visita (Tipo de venta + Necesidad puntual + label ponderación) + display en modal cliente + headers Excel (`Pond Mostrador`, `% Mostrador`). Value en DB sigue siendo `MOSTRADO` para no romper visitas históricas; se mapea al mostrar (v296+)
[X] Botón "📊 Exportar Excel" en modal Targets → XLSX formato largo (SlpCode, Vendedor, Año, Mes, Meta) — una fila por vendedor+mes con target > 0. SlpCode resuelto desde `sap_vendors`, Vendedor usa `slpName` de SAP (fallback titleCase). Uso: importar a SAP / Power BI (v297+)
[X] Gerente ve TODAS las visitas de todos los vendedores + comentarios (pedido de Pablo). Fix client-side de 2 líneas — Firestore Rules ya lo permitía (v298+)
[X] Form Visita: buscar directo por tienda (localidad se autocompleta) — pedido vendedores, ahorra un paso y evita el problema "no sé qué localidad es". Badge celeste 📍 muestra la localidad detectada (v299+)
[X] Bulk import de 103 nombres de fantasía desde Excel formulario (match por CUIT) + fix del cron `sync_sap_to_firestore.py` que pisaba fantasías manuales cada 30 min (mismo patrón v291 con localidad/provincia). Los nombres cargados ahora sobreviven al sync
[X] Buscador de tienda en form Visita ahora matchea por fantasía **O** titular (label muestra `"Fantasía (Titular) — Loc, Prov"`) — antes solo por titular (v300+)
[X] **Bulk fix de 22 provincias mal cargadas** (bug SAP prod - YAMIN CHUBUT→SALTA, TOMPY CHUBUT→SALTA, etc.) cruzando por CUIT contra el Excel formulario. Con validación de lista canónica (24 provincias AR + CABA) para no aceptar valores raros como "BS AS" o "7600.0". Sync SAP extendido con protección analog a fantasía: si `provinciaLocSource != 'sap_sync'`, no pisa provincia/localidad
[X] Modal de pedido PENDIENTE ahora muestra **vista previa del pedido cargado + sugeridos side-by-side** para poder comparar (antes solo sugeridos ocupando todo el ancho). Read-only, click "Volver a borrador" para editar (v301+)
[X] **Modal ZONAS ahora muestra provisorios (Alta Rápida sin cardCodeSap)** con badge amarillo "⚡ PROVISORIO" para que el gerente pueda asignarles vendedor apenas se dan de alta. Antes el filtro `!cardCodeSap → skip` los excluía y quedaban sin vendedor hasta que finanzas los cargara a SAP. Ya no requiere dirección tampoco (los provisorios pueden entrar sin calle) (v302+)
[X] **Master Clientes → tab Provisorios**: nombre del comercio y vendedor ahora **editables inline** con autosave. Nombre: input que escribe a `comercio` (o `fantasia` si no había comercio). Vendedor: `<select>` con VDE + VDI que escribe a `assignedVendor` y resuelve `ownerUid` matcheando displayName en roles (así el vendedor asignado ve el provisorio en su lista personal). Antes eran texto readonly y solo se podía editar desde el modal ZONAS (v302+)
[X] **Master Clientes vista normal**: mismo edit inline (nombre + vendedor) para filas provisorias mezcladas con SAP habilitados. Antes v302 solo funcionaba en el modo botón violeta "Provisorios"; ahora también en la vista default cuando el filtro devuelve un provisorio (v303+)
[X] **Reorganización barra superior**: botón "Dashboard" movido desde la grilla de tabs (Localidades/Clientes/Pedidos/etc) hacia la barra superior derecha, al lado de "Campañas Activas" (mismo estilo turquesa `.btn-dashboard` que ya existía). Nueva tab **"Contactado"** ocupa el lugar donde estaba Dashboard en la grilla — sección placeholder en construcción, a definir contenido en próxima iteración (v304+)
[X] **Tab Contactado funcional (Fase A)**: reutiliza el modal Visita en modo `contacto`. Cambios visuales: header teal, título "Registro de Contacto (no presencial)", oculta filas de fotos (Espacio + Frente del local), botón dice "Registrar contacto". Guarda en la misma colección `visits` con nuevo campo `interactionType='contacto'` (default `'visita'` para retro-compat). Los docs viejos sin el campo se leen como visita. Fase B pendiente: badges "Visita"/"Contactado" en renderers de "última interacción" en Pedidos/Rutas/Dashboard (v305+)
[X] **UI polish**: tab Contactado pasa de teal a celeste `#00A9E0` (mismo grupo que Rutas y Visita para consistencia visual). Botón Dashboard de la barra superior pasa de celeste a bordó `#7f1d1d` para diferenciarse del grupo tabs celeste. Master Clientes → Provisorios: Localidad y Provincia editables inline con autosave (mismo patrón que las filas SAP habilitadas), marcan `provinciaLocSource='manual'` y limpian lat/lng para forzar re-geocoding (v306+)
[X] **Tab Contactado Fase B — última interacción**: 1) Menú contextual de cliente: "Revisar última visita" → "Última interacción". 2) Modal cv-modal: título → "Última interacción" + badge visual por tipo (`🟣 Visita` violet / `📱 Contacto` teal) en el header de la interacción más reciente. 3) Contador de anteriores desglosa "+ N interacciones (X visitas + Y contactos)". 4) Lista "Mis visitas": nuevo filtro dropdown "Visitas + Contactos / Solo visitas / Solo contactos" + badge visual por card. Renderer trata docs sin `interactionType` como visita (retro-compat) (v307+)
[X] **Rendiciones: foto ticket migrada a Firebase Storage** (v308). El submit ahora sube la foto a Storage (bucket `rendiciones/{ownerUid}/{ts}_ticket.{ext}`) y guarda solo `fotoTicketUrl` en Firestore (vs base64 embebido pre-v308 que pesaba 50-500KB/doc y rompía Power BI Import mode a escala). Retro-migradas 45 fotos históricas con `scripts/migrate_rendiciones_foto_to_storage.py`. Retro-compat en `openRendicionDetail` y export Excel: prefieren `fotoTicketUrl` sino caen a `fotoTicket` base64. 2 vistas nuevas en BigQuery: **`v_rendiciones`** (46 filas, todos los campos aplanados + flags `tiene_comprobante_fiscal`/`pendiente_aprobacion`) y **`v_rendiciones_duplicados`** (alerta: mismo vendor + fecha + importe con count>1). Total actual: $1.86M en 46 tickets (v308+)
[X] **Directores del área: auto-aprobación de rendiciones** (v309). Lista blanca `SELF_APPROVE_RENDICIONES_EMAILS` con `diego.valsi@shimano.uy` (director). Diego (o cualquier email agregado a la lista) puede rendir gastos + solicitudes sin necesidad de un approver externo asignado en Panel Usuarios. El doc queda con `status='approved'` desde el submit + `approvedBy=self` + `approvalNote='Auto-aprobada (director del area)'`. Skip de notificación al approver. Aplica a `submitRendGasto` y `submitRendSolicitud` (v309+)
[X] **Targets: autosave al escribir** (v310). Antes: el usuario tenía que apretar "Guardar Targets" al final; si cerraba el modal antes se perdían los cambios. Ahora: `onTgtInputChange` programa `_saveTargetFor(id)` con debounce 900ms, guarda automáticamente. Feedback visual con clases `.saving` (azul) y `.saved` (verde flash 1.2s). `closeTargetsPanel` hace flush sync de cualquier pendiente antes de cerrar (safety para cierre inmediato). El botón "Guardar Targets" queda como fallback (v310+)
[X] **Targets descompuestos por familia REEL/CAÑAS/LÍNEAS** (v311). El modal Targets ahora tiene 3 columnas de familia (Reel/Cañas/Líneas) + columna Total (readonly, calculado en vivo). Cargás cada familia y el total del mes es la suma. Firestore: doc `targets/{seller}_{y}_{MM}` agrega campo `targetByFamily: {REEL, CANAS, LINEAS}`. `targetArs` se mantiene como suma (retro-compat con v_targets, PBI, exports). Sync grande: `sync_sap_to_bigquery.py` aplana el map a 3 columnas explícitas `target_reel_ars`, `target_canas_ars`, `target_lineas_ars`. Vista `v_targets` amplía con esas 3 columnas — docs pre-v311 quedan con null (retro-compat total, `target_ars` sigue funcionando) (v311+)
[X] **Export masterfile de Clientes incluye provisorios** (v312). Antes el export "Clientes (masterfile)" filtraba `!cardCodeSap → skip`, dejando afuera todos los provisorios (Alta rápida). Ahora se detecta `isProvisorio = manualSapPending && !cardCodeSap` y entran con `Tipo="Provisorio (Alta rapida)"` + `Estado="Provisorio"`. El gerente ve el universo comercial completo, no solo lo cerrado en SAP. Fix menor: `seen.add(dupKey)` que faltaba (evita duplicados si un habilitado y un provisorio tenían el mismo nombre) (v312+)
[X] **Buscadores flexibles multi-token AND** (v313). Nuevo helper `matchesAllTokens(haystack, query)` divide el query por espacios y exige que TODOS los tokens aparezcan en el haystack concatenado. Normaliza acentos vía NFD (á→a, ñ→n). Aplicado en 4 buscadores: (1) CLIENTES sidebar (`clientMatchesQuery` + SAP altas inline), (2) PEDIDOS sidebar (fallback SAP altas), (3) Master Clientes vista normal, (4) Master Clientes tab Provisorios. Ejemplos que ahora funcionan: `"el pez gordo quilmes"`, `"pescamagic buenos aires"`, `"gonzalo cordoba"`. Orden no importa (v313+)
[X] **Registro de Contacto agrega campo Forma de contacto** (v314). En el modal Visita en modo `contacto`, después de "Tipo de tienda" aparece un select nuevo obligatorio con 3 opciones: `LLAMADA TELEFONICA / MENSAJE DE WHATSAPP / MENSAJE SMS`. `applyVisitModeUI` lo muestra/oculta según modo. `submitVisita` agrega validación y guarda `formaContacto` en el doc (queda `''` en modo visita presencial). BQ: `v_visitas` expone nueva columna `forma_contacto` (STRING) para desglose PBI "Contactos por canal" (v314+)
```

### Bloqueantes externos para el lanzamiento

| # | Bloqueante | Responsable | Estado |
|---|---|---|---|
| 1 | **CORS habilitado en Apache** delante del Service Layer | Alejandro Caracchi (SEIDOR) | ✅ Resuelto (SL responde desde el browser + GitHub Actions) |
| 2 | **Usuario integración** en SAP (licencia Limited CRM o Logistics) | Juan (IT Shimano) | ✅ Resuelto (`APP_VENDEDORES` operativo) |
| 3 | **UDFs + Serie APP 103 en PROD** (SHIMANO_SAU) | Ezequiel Mendoza (SEIDOR) | ⏳ Pendiente confirmación en PROD (funciona en TST_06) |

### Plan de contingencia

Si el punto 3 no llega a tiempo, **arrancamos con el ZIP DTW manual** que ya está probado y funcional. Admin descarga el ZIP de pedidos confirmados, lo importa en DTW, los pedidos entran como Quotations. El DTW manual queda como **backup permanente** incluso con Service Layer operativo.

### Última prueba E2E exitosa

**Fecha**: 2026-06-19 — DTW import OK en SHIMANO_TST_06.
- **Pedido**: `f896nK70TWpu9KJxSs6j`
- **Sales Quotation creada**: APP-2000000
- **Cliente**: GUSTAVO BARGELLINI (CardCode `C20220956513`)
- **2 líneas**: `CAC58MH2UR` x 2 + `CAC66MH2UR` x 2 en W07
- **UDFs poblados OK**: `U_AppOrigen = SHIMANO_APP_VENDEDORES`, `U_AppOrderId`, `U_AppBatchId`, `U_TipoGasto = CONDICION`
- **Sales Employee**: Gonzalo de la Rosa (mapeo SlpCode OK)
- **Status**: Open (sin Approval Procedure — Santiago aprueba manualmente)

---

## 3) Stack técnico

| Capa | Tecnología | Versión / detalle |
|---|---|---|
| Frontend | HTML5 + CSS3 + Vanilla JavaScript | — |
| Mapa | Leaflet | 1.9.4 (CDN unpkg) |
| Tiles | CartoDB Positron | OSM stack |
| Excel | SheetJS (xlsx) | 0.18.5 (CDN jsdelivr) |
| Excel con fotos embebidas | ExcelJS | 4.4.0 (lazy load, solo al exportar) |
| ZIP | JSZip | 3.10.1 (CDN cloudflare) |
| Auth + DB | Firebase compat SDK | 10.7.1 (auth + firestore) |
| QR | qrcode.js (davidshimjs) | 1.0.0 (CDN cloudflare cdnjs) — para setup 2FA |
| OCR | Google Gemini API | `gemini-2.5-flash` (REST) |
| Geocoding | OpenStreetMap Nominatim | gratis, country=AR |
| Hosting | GitHub Pages | rama `main` |
| Build offline | Python 3 + openpyxl | genera HTML desde Excels |
| Storage local | localStorage + IndexedDB | persistencia y cache |
| SAP B1 backend (futuro) | Service Layer v1 | puerto 50000, https con cert GoDaddy |

**Sin Node, sin Webpack, sin TypeScript, sin React.** Una elección deliberada para minimizar fricciones de mantenimiento: cualquier persona con conocimientos de JS y HTML puede editar el código.

---

## 4) Estructura del repo

```
shimano-arg/app-vendedores/
├── index.html                # App completa (~3.2 MB - todo embebido)
├── alta-cliente.html         # Formulario público standalone (link compartible)
├── manifest.json             # PWA manifest
├── sw.js                     # Service Worker (CACHE_VERSION sincronizada con APP_VERSION; hoy v292)
├── login-bg.jpg              # Foto de fondo del login (río al amanecer)
├── stock.json                # Snapshot fresco del stock SAP (autogenerado por
│                             #  sync_sap_to_firestore.py cada 30 min - lo consume
│                             #  el Google Sheet "Inventario-Bot" via raw.github)
├── .nojekyll                 # (v252+) Deshabilita procesamiento Jekyll en Pages
├── Shimano-Logo.png          # Logo (header + splash)
├── icon-180-v3.png           # PWA icon iOS 180×180
├── icon-192-v3.png           # PWA icon Android 192×192
├── icon-512-v3.png           # PWA icon 512×512 (any)
├── icon-512-maskable-v3.png  # PWA icon 512×512 (maskable Android adaptive)
├── .github/
│   └── workflows/
│       ├── sync-sap-catalog-stock.yml  # (v246+) Cron 13,43 * * * * : Service Layer
│       │                               #  → Firestore (catalog + stock_snapshot) +
│       │                               #  commit stock.json si cambia. Reemplazo
│       │                               #  del legacy sync-stock (CSV manual).
│       ├── sync-stock.yml              # LEGACY (cron desactivado). Dispatch manual
│       │                               #  como respaldo. Depende del CSV que David
│       │                               #  subia a Drive - ya no se usa.
│       └── send-rendiciones-email.yml  # Cron Lun/Mie 9am AR: Excel + mail rendiciones aprobadas
├── scripts/                     # ~30 scripts Python, agrupados por rol:
│   ├── sync_sap_to_firestore.py     # Cron cada 30min: SAP → Firestore (BPs, items, stock)
│   ├── sync_sap_to_bigquery.py      # Cron cada 30min: SAP + Firestore.targets → BigQuery
│   ├── send_rendiciones_email.py    # Cron Lun/Mie: mail de rendiciones aprobadas
│   ├── sync_stock.py                # LEGACY (deprecated 2026-06-18)
│   ├── bootstrap_targets_to_bigquery.py     # Carga inicial de targets a BQ
│   ├── bulk_import_fantasias_from_excel.py  # Cargar 103 fantasías por CUIT match
│   ├── bulk_fix_provincia_localidad_from_excel.py # Fix 22 provincias mal cargadas
│   ├── audit_targets.py             # Diagnóstico read-only de la colección targets
│   ├── verify_fantasias_in_firestore.py     # Verifica fantasías post bulk
│   ├── check_provincias_salta.py    # Debug de valores de provincia
│   ├── check_salta_matching.py      # Cruce POINTS vs client_applications
│   ├── query_sap_sales_persons.py   # Consulta /SalesPersons de SAP prod
│   ├── query_sap_sales_persons_test.py # Idem TEST DB (SHIMANO_TST_06)
│   ├── diagnose_inventario_gap.py   # Diagnóstico del gap backorder vs inventario
│   ├── test_inventario_fix.py       # Dry-run del fix del enriched view
│   ├── dryrun_new_views.py          # Dry-run 4 CREATE OR REPLACE VIEW
│   ├── verify_inventario_post_deploy.py # Verificaciones de aceptación post deploy
│   ├── apply_v_targets.py           # Aplica solo v_targets + verificaciones
│   ├── apply_facturas_sap_slim.py   # Aplica v_facturas_sap sin lines_json (fix VertiPaq)
│   ├── rollback_v_inventario.py     # Rollback quirúrgico v_inventario a pre-fix
│   ├── redeploy_views.py            # Aplica todos los CREATE OR REPLACE VIEW
│   ├── smoke_inventario.py          # Smoke test de v_inventario post-deploy
│   ├── smoke_ventas_backorder.py    # Smoke test de ventas y backorder
│   ├── smoke_pedidos_lines.py       # Smoke test rápido de vistas BQ
│   ├── explore_targets_pipeline.py  # Investigación inicial pre-v_targets
│   ├── validate_slp_mapping.py      # Validar mapeo canónico app → SlpCode SAP
│   ├── inspect_shimano_fishing_excel.py  # Inspección Excel formulario alta
│   ├── build_manual_shimano.py      # Generador PDF "APP SHIMANO MANUAL" (33 pág)
│   ├── build_mejoras_shimano.py     # Generador PDF "MEJORAS" (21 pág, análisis crítico)
│   └── [otros scripts diagnóstico legacy]
├── bigquery/
│   └── views.sql                # 9 vistas curadas para Power BI
├── PLAN_POWERBI.md              # Plan 4 días Firestore → BigQuery → Power BI
├── POWER_AUTOMATE_RENDICIONES.md # Doc operativo del flow de SharePoint
├── Roadmap_Integracion_App_SAP.md
├── Solicitud_SEIDOR_Integracion_App.md
├── Pitch_Lunes_App_Vendedores.md
└── README.md                    # Este archivo (documentación viva del proyecto)
```

**Docs complementarias en Desktop** (generadas por scripts, no versionadas en Git):
- `~/Desktop/APP SHIMANO MANUAL.pdf` (33 pág) — Manual técnico completo pensado para sucesor: qué usa la app, cómo funciona cada componente, roles, contactos, runbook. Se regenera con `python scripts/build_manual_shimano.py`.
- `~/Desktop/MEJORAS.pdf` (21 pág) — Análisis crítico del estado actual con 12 puntos débiles priorizados + roadmap por horizontes (Sprint 1, Sprint 2, Q1, S1). Se regenera con `python scripts/build_mejoras_shimano.py`.

### Archivos generados (no en repo)

Los siguientes archivos viven en el desktop de Mariano (fuera del repo):

- `C:\Users\shimano.sandbox\Desktop\MASTERFILES\PROSPECTOS\MAPAS\_build_argentina_zonas_v2.py` — Build script principal
- `C:\Users\shimano.sandbox\Desktop\MASTERFILES\PROSPECTOS\MAPAS\Mapa_Argentina_Shimano_Zonas.html` — Output del build (= `index.html`)
- `C:\Users\shimano.sandbox\Desktop\MASTERFILES\ZONAS\TARGETS VENDEDORES-ZONAS.xlsx` — Excel master con clientes
- `C:\Users\shimano.sandbox\Desktop\FORECAST\DATOS_CRUDOS\Masterfile Shimano Venta Ult 365 Días.xlsx` — Excel histórico ventas MELI (deprecado, ahora se usa historial app)
- `C:\Users\shimano.sandbox\Desktop\LANZAMIENTO-APP-FALTANTES.txt` — Punteo de bloqueantes para lanzamiento

---

## 5) Pipeline de build

### Cuándo regenerar el HTML

- Cambios en el código JS/CSS embebido en el build script
- Actualización del Excel master de clientes
- Actualización del Excel de productos
- Actualización de polígonos geo (mapas provinciales)
- Cambio de provincias asignadas a VDIs

### Cómo regenerar

```bash
cd "C:/Users/shimano.sandbox/Desktop/MASTERFILES/PROSPECTOS/MAPAS"
python -c "import sys; sys.stdout.reconfigure(encoding='utf-8'); exec(open(r'_build_argentina_zonas_v2.py', encoding='utf-8').read())"
```

El script:
1. Lee los HTMLs provinciales en `MASTERFILES/PROSPECTOS/MAPAS/` (uno por provincia).
2. Lee el Excel master de clientes (`TARGETS VENDEDORES-ZONAS.xlsx`).
3. Lee el Excel histórico de ventas MELI (deprecado, ahora se usa historial app).
4. Lee el Excel de targets de vendedores.
5. Lee el Excel master de productos (665 SKUs).
6. Calcula asignaciones por provincia (incluyendo el hardcode VDI Patagonia/NOA-NEA).
7. Aplica el guardrail para excluir distribuidores en BA/CABA/Córdoba/Santa Fe.
8. Inyecta TODO en el template HTML.
9. Genera `Mapa_Argentina_Shimano_Zonas.html`.

### Deploy

```bash
cp "C:/Users/shimano.sandbox/Desktop/MASTERFILES/PROSPECTOS/MAPAS/Mapa_Argentina_Shimano_Zonas.html" \
   "C:/Users/shimano.sandbox/Desktop/APP VENDEDORES/index.html"
cd "C:/Users/shimano.sandbox/Desktop/APP VENDEDORES"
# Bumpear sw.js: CACHE_VERSION = 'v217' → 'v218' (+ APP_VERSION en index.html)
git add index.html sw.js
git commit -m "Mensaje claro de cambio"
git push
```

GitHub Pages propaga en 1-5 minutos. Los usuarios reciben el SW nuevo cuando cierran y abren la PWA (o hacen Ctrl+Shift+R).

---

## 6) Sistema de autenticación y autorización

### Flujo de login

1. **Usuario abre la URL** → ve splash + spinner "Cargando sesión..." (foto fondo: río al amanecer).
2. **Firebase auth.onAuthStateChanged()** chequea si hay sesión guardada en IndexedDB.
3. Si **hay sesión** → directo al password gate (PIN de 4 dígitos).
4. Si **no hay sesión** → la pantalla muestra **4 alternativas** de login:
   - **Continuar con Google** (`signInWithRedirect` + provider Google).
   - **Continuar con Microsoft** (`signInWithRedirect` + `OAuthProvider('microsoft.com')`, Azure AD).
   - **Email + contraseña** (`signInWithEmailAndPassword`).
   - **Continuar con email** (magic link / passwordless: `sendSignInLinkToEmail` → el usuario clickea el link recibido por mail → `signInWithEmailLink` cierra el flow).
5. **Password gate** (PIN) → admin lo configura desde panel Usuarios (legacy, sigue funcionando).
6. **2FA** (opcional para cualquier rol) → Authenticator de Google con QR.

### Persistencia de sesión

- `setPersistence(LOCAL)` → IndexedDB.
- En iOS PWA standalone hay un edge case conocido: iOS borra IndexedDB de PWAs "inactivas" después de 7 días. Si el usuario abre la app esporádicamente, se le pide login de nuevo.

### Roles

- **Bootstrap**: el primer email en hacer login se auto-eleva a `admin` si está en la lista de `BOOTSTRAP_ADMIN_EMAILS` (hardcoded en el código): `bot.shimano.pesca@gmail.com` y `erbinomariano@gmail.com`.
- **Otros usuarios**: arrancan como `unassigned` y el admin les asigna rol desde el panel Usuarios.

### 2FA (Two-Factor Authentication)

- **Opcional para todos los roles** (antes era obligatorio para admin; desde v178+ ya no se fuerza).
- Path: panel Usuarios → botón `🔐 2FA` del usuario → genera QR → usuario escanea con Google Authenticator → ingresa 6 dígitos para validar.
- Si el rol requiere 2FA y no está configurado, la app muestra pantalla bloqueante "Pedile al admin que te configure el 2FA".
- TTL del último check: 30 días (se guarda timestamp en localStorage).

### Reset de password

Panel Usuarios → botón **🔐 Contraseña** del usuario abre un modal con **2 opciones**:

1. **Mandar mail de reset** (`fbAuth.sendPasswordResetEmail(email)`): el usuario recibe un link de Firebase para fijarse una contraseña nueva. Recomendado para usuarios con login Email/contraseña o Magic link.
2. **PIN legacy** (gate de 4 dígitos): se mantiene para no romper el flow histórico de los usuarios que ya tenían PIN configurado.

### `allowed_emails` (pre-autorizaciones)

Admin puede pre-autorizar emails desde el panel admin antes de que se logueen. Cuando ese email se loguea por primera vez, se le asigna el rol pre-cargado.

---

## 7) Roles y permisos

| Rol | Quién | Qué puede hacer |
|---|---|---|
| **`admin`** | Mariano, Diego | Todo: panel admin, modal Zonas, Master Clientes, SAP, Stock, Backup, Targets, aprobar altas, Auditoría, Seguimiento, "Exportar para Análisis" (solo Mariano desde v208) |
| **`gerente`** | Pablo Maraschin | Casi todo lo de admin **excepto** USUARIOS, STOCK, PRECIOS y AUDITORIA. Ve todo el mapa, aprueba Altas Clientes, aprueba Rendiciones, edita Master Clientes, reubica pines. **Desde v205+ entra a `canWrite()`** (cambia estado de cliente, renombra, categoriza, marca contactado). **Abre CAMPAÑAS + SAP + Seguimiento** (v208+). **Lee TODOS los pedidos** (necesario para tab CONFIRMADOS y filtros, v215+). **Carga visitas / marca contactado en cualquier ruta del mes** (v214+). |
| **`vendedor`** | VDEs (Mauricio, Martin, Gonzalo, Federico) | Ver SOLO su zona, crear pedidos/visitas propios, cargar Alta Cliente |
| **`interno`** | VDIs (Santiago, Ioannis) | Ver zonas de sus VDEs pareja, crear pedidos/visitas en nombre del VDE pareja. **Acceso a SEGUIMIENTO** (con scope acotado a sus parejas, v209+). **Carga visitas / marca contactado en rutas de sus VDEs** (v214+). |
| **`viewer`** | Solo lectura | Ve todo pero no escribe nada |
| **`unassigned`** | Usuarios nuevos sin rol | Pantalla "Tu usuario aún no tiene rol asignado. Pedile al admin que te habilite." |

### Restricción por rol al filtrar mapa

Implementado en `getMyAllowedVendorKeys()`:
- **admin / gerente / viewer**: `null` (sin restricción, ven todo) — `gerente` se sumó al null-bucket en v182+ para que pueda ver el mapa completo.
- **vendedor**: `Set([assignedVendor])` (solo su zona)
- **interno**: `Set([vendorKeys de sus parejas VDE])` (ej: Santiago ve Z4+Z5)
- **unassigned**: `Set()` (no ve nada)

### Pareja VDI ↔ VDE

Configurado en `roles/{uid}.internalPartnerUid`. Cada VDE tiene un VDI asignado como pareja. El VDI puede:
- Ver las tiendas del VDE en su filtro Zona.
- Crear pedidos/visitas en nombre del VDE (`onBehalfOf: true` + `createdByUid: VDI` + `ownerUid: VDE`).
- Aprobar Altas Clientes.

Las parejas estándar son:
- **Federico** (Z2) ↔ Ioannis (VDI)
- **Gonzalo** (Z1) ↔ Ioannis (VDI)
- **Mauricio** (Z5) ↔ Santiago (VDI)
- **Martin** (Z4) ↔ Santiago (VDI)

---

## 8) Modelo de datos Firestore

22 colecciones activas en el proyecto `app-vendedores-shimano` (las 2 nuevas son `seguimiento_notes` y `seguimiento_status`, agregadas en v209+):

### Auth y usuarios

#### `roles/{uid}`
```js
{
  email: "vendedor@shimano.com.ar",
  displayName: "Mauricio Gil",
  role: "vendedor",              // admin | vendedor | interno | viewer | gerente | unassigned
  vendor: "MAURICIO GIL",        // VENDORS.key cuando role = vendedor
  internalPartnerUid: "uid_santiago",  // VDI asignado al VDE
  whatsapp: "5491126762031",     // sin + ni espacios
  rendicionesApproverUid: "uid_gerente",
  totpEnabled: true,
  totpSecret: "BASE32...",       // base32 del secret TOTP
  totpEnabledAt: <Timestamp>,
  pin: "1234",                   // PIN encriptado (legacy)
  pinHash: "...",                // bcrypt del PIN
  protectedAdmin: true,          // los 2 admins iniciales no se pueden borrar
}
```

#### `userData/{uid}`
Estado per-usuario (sincronizado entre dispositivos):
```js
{
  contacted: ["C|BUENOS AIRES|Quilmes|JUAN PESCA", ...],   // tiendas habilitadas
  canceled: ["P|...", ...],                                  // tiendas canceladas
  orders: {key: [...lines]},                                 // pedidos en borrador
  clientMeta: {                                              // metadata custom por cliente
    "C|prov|loc|name": {
      customName: "...",
      customFantasia: "Pesca Total",   // fantasia local mostrada como "Local: XXX" en la card cliente (NUEVO)
      address: "Av. Corrientes 1234",
      locality: "Palermo",
      lat: -34.5879,
      lng: -58.4321,
      updatedAt: 1718812345678
    }
  },
  email: "user@...",
  displayName: "...",
  lastSeen: <Timestamp>,
}
```

#### `allowed_emails/{docId}`
Pre-autorizaciones. Cuando el email se loguea, se eleva al rol pre-cargado.

### Operación comercial

#### `pedidos/{pedidoId}`
```js
{
  ownerUid: "uid_vde",           // dueño del pedido (vendedor)
  ownerEmail: "...",
  createdByUid: "uid_vdi",       // quien lo cargó (puede ser VDI en nombre del VDE)
  onBehalfOf: true,              // si VDI cargó en nombre de VDE
  key: "C|prov|loc|cliente",
  stage: "pending" | "confirmed" | "sap_imported",
  tipo: "C" | "P",
  province: "BUENOS AIRES",
  locName: "Quilmes",
  clientName: "JUAN PESCA",
  month: "Junio 2026",
  monthIdx: 5,
  year: 2026,
  confirmedAt: "ISO date",
  condicionPago: "CTA CTE",      // → U_TipoGasto en SAP
  formaEntrega: {                 // v269+ (v273: agregado clienteDireccion)
    tipo: "TRANSPORTISTA" | "SUCURSAL",
    // Solo si tipo === "TRANSPORTISTA":
    transpNombre: "Cruz del Sur",
    transpDireccion: "Av. Corrientes 1234, CABA",
    clienteDireccion: "Av. Belgrano 4567, Rio Cuarto",  // destino final
    // Solo si tipo === "SUCURSAL":
    sucursalDireccion: "Av. Cabildo 4567, CABA"
  },
  lines: [
    {code: "CAC58MH2UR", desc: "...", qty: 2, precio: 12500, cat: "...", fam: "...", sub: "..."}
  ],
  transferidoSAP: {              // populado al exportar ZIP DTW o enviar por SL
    via: "dtw_manual" | "service_layer",
    docEntry: 12345,             // SL only: número interno SAP
    docNum: 2000001,             // SL only: número de Quotation
    batchId: "BATCH-20260619-...",  // DTW only
    at: <Timestamp>,
    by: "..."
  },
  createdAt: <Timestamp>,
}
```

#### `visits/{visitId}`
```js
{
  ownerUid: "...",
  ownerEmail: "...",
  fecha: "2026-06-19",
  mes: "JUNIO",
  anio: 2026,
  vendor: "MAURICIO GIL",
  provincia: "BUENOS AIRES",
  localidad: "Quilmes",
  tienda: "JUAN PESCA",
  tipo: "C",
  local: "Propio",
  tamano: "Mediano",
  fidelidad: "Alta",
  relevancia: "Alta",
  pop: "Stickers Shimano + display",
  necesidadPuntual: "...",
  tipoVenta: "Casa de pesca + ecommerce",
  ponderacionMostrado: 80,
  ponderacionEcommerce: 60,
  competencia: "Daiwa, Penn",
  oportunidad: "...",
  masVendido: "Línea Stradic",
  masPreguntan: "Cañas Caius",
  ayudaTienda: "Capacitación productos",
  frenteLocal: "data:image/jpeg;base64,...",   // foto del frente
  espacio: ["data:image/jpeg;base64,...", ...], // hasta 5 fotos
  gpsStatus: "ok" | "outside" | "noloc",
  gpsDistanceM: 25.4,
  createdAt: <Timestamp>,
}
```

#### `route_overrides/{docId}`
Derivaciones y reagendas de rutas. Cuando un vendedor deriva una tienda al VDI o reagenda para otra fecha.

#### `custom_routes/{routeId}` (NUEVO desde v182+)
Rutas armadas a medida por el propio vendedor (modo "Rutas personalizadas"):
```js
{
  ownerUid: "...",                // dueño de la ruta
  ownerEmail: "...",
  name: "Ruta Mar del Plata Mayo",
  plannedDate: "2026-06-29",      // ISO YYYY-MM-DD
  notes: "Cargar Stradic en Mostacciuolo, retirar POP en La Marea",
  stops: [
    {
      order: 0,
      key: "C|BUENOS AIRES|Mar del Plata|JUAN PESCA",
      tipo: "C" | "P",
      provincia: "BUENOS AIRES",
      localidad: "Mar del Plata",
      clientName: "JUAN PESCA",
      isProvisorio: false,        // true si es alta provisoria (manualSapPending)
      sapAltaId: "abc123",        // cuando viene de client_applications
    }
  ],
  createdAt: <Ts>,
  updatedAt: <Ts>,
}
```
El picker de tiendas para agregar stops busca en POINTS + altas SAP aprobadas + provisorias (alta rápida), respetando el filtro de vendor del usuario.

#### `campaigns/{campaignId}`
Campañas comerciales: nombre, fechas vigencia, SKUs incluidos, zonas aplicables.

#### `targets/{docId}`
Targets mensuales en ARS por vendedor + mes + año. Cargados por admin/gerente.

#### `rendiciones/{docId}`
Rendiciones de gastos con OCR Gemini de tickets. Tiene `status: pending_approval | approved | rejected`.

### Alta clientes + master

#### `client_applications/{appId}`
Solicitudes de alta de cliente con flujo de doble aprobación:
```js
{
  ownerUid: "uid_vendedor",
  ownerEmail: "...",
  ownerName: "Mauricio Gil",
  comercio: "PESCA TOTAL S.A.",
  fantasia: "Pesca Total",
  cuit: "30-12345678-9",          // v294+: opcional en Alta Rapida (input ar-cuit).
                                  // Normalizado a solo digitos. Habilita match automatico
                                  // con SAP en find_match() paso 2 (mas confiable que nombre).
  condicionFiscal: "Responsable Inscripto",
  calle: "Av. Corrientes",
  numero: "1234",
  localidad: "Palermo",
  provincia: "BUENOS AIRES",
  localidadFinal: "Palermo",     // override del aprobador si la declarada no matcheaba
  cardCodeSap: "C-12345",        // cargado por el aprobador (o por el sync SAP)
  assignedVendor: "FEDERICO CASTELANELLI",  // cargado por el aprobador
  constanciaArca: "data:image/...",
  constanciaIIBB: "data:image/...",
  fotosLocal: ["data:image/...", ...],
  status: "pending_approval" | "approved" | "rejected",
  // v294+: sap_sync_manual_link se setea cuando admin vincula manualmente un
  // provisorio con un BP SAP desde Master Clientes -> Provisorios -> Vincular.
  source: "manual" | "sap_bulk_import" | "alta_rapida" | "sap_sync" | "sap_sync_manual_link",
  manualSapPending: true,         // si vino por alta_rapida y todavía no se cargó a SAP
  // v294+ auditoria de vinculacion manual admin:
  linkedFromSapDocId: "abc123",   // fsId del BP SAP con el que se vinculo (se borra ese doc)
  linkedBy: "admin@shimano.com",  // email/uid del admin que ejecuto la vinculacion
  linkedAt: <Timestamp>,
  approvals: {
    "uid_admin": {approvedAt: <Ts>, email: "...", name: "..."},
    "uid_gerente": {approvedAt: <Ts>, email: "...", name: "..."}
  },
  approvedAt: <Timestamp>,
  rejectedByEmail: "...",
  rejectedReason: "...",
  submittedByPublicForm: false,  // true si vino del alta-cliente.html público
  createdAt: <Timestamp>,
  updatedAt: <Timestamp>,
}
```

#### `client_locations/{docId}`
GPS preciso de cada tienda (cargado durante visitas con GPS).

#### `client_master/{docId}`
Master de direcciones exactas + CardCode SAP:
```js
{
  clientName: "JUAN PESCA",
  provincia: "BUENOS AIRES",
  localidad: "Quilmes",
  vendor: "FEDERICO CASTELANELLI",
  address: "Av. Mitre 2345",
  sapCardCode: "C-12345",        // NUEVO: usado por DTW/SL
  sapAddress: "AV MITRE 2345",   // direccion raw del SAP
  sapCity: "QUILMES",
  sapState: "BUENOS AIRES",
  sapImportedAt: <Ts>,
  sapImportedBy: "admin@...",
  clientNameOriginal: "Juan Pesca",  // backup del nombre antes del import SAP
  localidadOriginal: "Quilmes",      // backup de la localidad
  matchType: "exact" | "fuzzy",
  matchSimilarity: 1.0,
  updatedAt: <Ts>,
  updatedBy: "...",
}
```

### Reasignaciones (modal Zonas)

#### `vendor_overrides/{docId}`
Reasignación de tiendas/localidades a otro vendedor:
```js
{
  scope: "shop" | "loc",
  province: "BUENOS AIRES",
  localityName: "Santa Fe",
  clientName: "AZZONI LUCAS",    // solo si scope = "shop"
  originalVendor: "MARTIN BOIERO",
  newVendor: "MAURICIO GIL" | "IOANNIS PALKOUDAKIS" | "__DISTRIBUTOR__",
  newType: "VDE" | "VDI" | "DISTRIBUIDOR" | "OTRO",
  updatedAt: <Timestamp>,
  updatedByUid: "...",
  updatedByEmail: "...",
  updatedByDisplayName: "Mariano Erbino",
}
```

### Integración SAP

#### `sap_clients/{docId}`
Mapeo `clientName → CardCode SAP`.

#### `sap_products/{docId}`
Mapeo `productCode → ItemCode SAP`.

#### `sap_vendors/{docId}`
Mapeo `vendorKey → SlpCode SAP`.

#### `app_config/{docId}`
Configuraciones globales:
- `gemini`: API key para OCR.
- `sap_integration`: Series ID, Service Layer config.
- `stock_snapshot`: snapshot actual del stock W07.

### Notificaciones y log

#### `notifications/{docId}`
Alertas + tareas + derivaciones VDI. Con imágenes embebidas.

#### `operations_log/{logId}`
Log inmutable de acciones para auditoría. Solo admin/viewer leen.

### Seguimiento (NUEVO desde v209+)

#### `seguimiento_notes/{noteId}`
Notas internas que admin/gerente/interno escriben sobre un cliente o pedido desde el Timeline de Seguimiento:
```js
{
  vendorExt: "MARTIN BOIERO",        // VDE al que aplica (clave del scope)
  clientKey: "C|CORDOBA|Rio Cuarto|PESCA TOTAL",
  clientName: "PESCA TOTAL",
  province: "CORDOBA",
  locality: "Rio Cuarto",
  text: "Pidio catalogo nuevo. Llamar 22/Jun.",
  authorUid: "uid_pablo",
  authorEmail: "pablo@shimano.uy",
  authorName: "Pablo Maraschin",
  authorRole: "gerente",             // admin | gerente | interno
  createdAt: <Timestamp>,
}
```

#### `seguimiento_status/{statusId}`
Estado de un item pendiente o oportunidad. Permite cerrar manualmente un pendiente auto-detectado:
```js
{
  vendorExt: "MARTIN BOIERO",
  itemId: "<id de la visita o pedido>",
  itemType: "visit_no_order" | "pending_order" | "opportunity",
  status: "pendiente" | "revisado" | "resuelto",
  updatedByUid: "...",
  updatedByEmail: "...",
  updatedAt: <Timestamp>,
}
```

---

## 9) Firestore Security Rules

Reglas vigentes (versión actual). Resumen de qué puede hacer cada rol:

| Colección | Read | Write |
|---|---|---|
| `roles` | propio doc + admin | admin (update/delete), usuario propio (create con role unassigned/admin) |
| `userData` | propio + admin/viewer | propio + admin |
| `pedidos` | todos los readers | admin/gerente / vendedor (su propio) / **interno propio (v279+)** / interno en nombre del VDE pareja |
| `visits` | todos | admin / vendedor / interno propio / VDI en nombre del VDE pareja |
| `campaigns` | todos | admin |
| `notifications` | targetUid o fromUid o admin | propio crea, propio update si es targetUid, **delete: target o admin** (NUEVO: el target puede borrar la card desde Recibidas) |
| `targets` | todos | admin / gerente |
| `client_locations` | todos | admin / vendedor / interno (create), admin (update/delete) |
| `client_master` | todos | admin / gerente (incluye dropdown provincia editable + auto-infer vendor) |
| `allowed_emails` | autenticados | admin |
| `client_applications` | todos | propio crea, admin/gerente/interno update, **delete: admin O owner si NO tiene cardCodeSap** (NUEVO: el vendedor puede eliminar sus Mis Solicitudes mientras no estén cargadas a SAP) |
| `rendiciones` | todos | propio crea, admin/gerente update, admin delete |
| `app_config` | todos | admin |
| `vendor_overrides` | todos | admin (cambios globales) |
| `route_overrides` | todos | admin / vendedor (su propio), admin (update/delete) |
| `custom_routes` (NUEVO) | todos los readers | propio crea/update/delete (filtrado por ownerUid) |
| `sap_clients`, `sap_products`, `sap_vendors` | todos | admin |
| `operations_log` | admin / viewer | autenticado crea (userUid == auth.uid), nadie update/delete |
| `seguimiento_notes` (NUEVO v209+) | `isSeguimientoUser()` (admin/gerente/interno) | `isSeguimientoUser()` crea/update/delete |
| `seguimiento_status` (NUEVO v209+) | `isSeguimientoUser()` | `isSeguimientoUser()` crea/update/delete |

Helper `isMyPartnerVDE(targetUid)`: para que un VDI pueda actuar en nombre de un VDE solo si el VDE tiene a ese VDI como `internalPartnerUid`. Esto bloquea que un VDI cualquiera cargue pedidos a nombre de cualquier VDE.

Helper `isSeguimientoUser()` (v209+): `userRole in ['admin', 'gerente', 'interno']`. Lo usan las rules de `seguimiento_notes` y `seguimiento_status` para evitar que un vendedor pueda leer las notas internas que se escriben sobre él.

### Rendiciones — fix de resolveApprover (v189+)

Antes el vendedor no podía mandar rendiciones si tenía responsable asignado (las rules intentaban resolver el aprobador leyendo `/roles/{approverUid}` directo, lo cual no era legible por el VDE). El fix:
- El cliente lee `app_config/users_directory` (público) para encontrar el aprobador por email.
- Cachea el email en localStorage para no pegar Firestore en cada submit.
- Las rules permiten escribir la rendición sin necesitar leer `/roles` del aprobador.

---

## 10) Estructura de la UI

### Header superior
- **Logo Shimano** + título "MAPA DE VENTAS - ARGENTINA"
- **Badge ADMIN** (violeta, centrado) — solo si rol = admin
- **Stat cards** (4): Localidades / Habilitados / Pendientes / Tiendas
- **Botones admin** (a la derecha): TARGETS / CAMPAÑAS / SAP / MASTER CLIENTES / USUARIOS / STOCK / AUDITORÍA / SALIR

Header + Controls tienen `border-bottom-radius: 22px` para look "pill flotante".

### Controls (filtros del mapa)
- Selector **Zona** (filtro por vendedor)
- Selector **Provincia**
- Selector **Localidad**
- Selector **Tipo** (Todos / Existentes / Prospectos / Distribuidores / Ventas Especiales)
- Botones (derecha): **Campañas Activas** (amarillo) / **Exportar para Análisis** (verde, solo Mariano desde v208) / **Seguimiento** (teal, admin/gerente/interno desde v209+) / **Exportar a Excel** (celeste) / **Zonas** (azul marino, sin emoji desde v214)

### Cuerpo
- **Mapa Leaflet** (izquierda, ocupa gran parte de la pantalla).
- **Sidebar derecha** con tabs: Localidades / Clientes / Pedidos / Rutas / Visita / Dashboard / Rendiciones / Alta Clientes / Notificaciones.

### Controles topleft del mapa (debajo de zoom Leaflet)

- **↻ Forzar actualización**: hace `unregister()` del SW, limpia caches y recarga con cache-bust. Útil cuando el banner del console marca DESYNC HTML vs SW.
- **📍 Reubicar pines** (solo admin/gerente): triggea `runBulkGeocodeSapAltas()` para correr geocoding bulk de altas SAP que no tengan lat/lng.
- **⏣ Recalcular contornos de zonas** (NUEVO v213, solo admin/gerente): limpia `_vendorOutlinesCache` + `localStorage[VENDOR_OUTLINES_CACHE_KEY]` y llama a `restyleZoneLayers()` + `drawVendorOutlines()`. Útil después de reasignar localidades/provincias en el modal ZONAS — sin esto los outlines viejos quedan cacheados y muestran fronteras que ya no aplican.

### Mobile

Botón **REFRESCAR APP** ocupa la celda libre al lado del selector Localidad (atajo equivalente al ↻ del desktop).

### Body background
Color celeste claro `#dbeafe` (matchea con el color base de `.controls`).

### Login background
Foto: `login-bg.jpg` (río al amanecer con lancha de pesca) + overlay oscuro semi-transparente para contraste del cuadro blanco del login/PIN.

---

## 11) Sistema de zonas y vendedores

### Las 6 zonas (`VENDORS` array)

```js
[
  {key: 'GONZALO DE LA ROSA',    zone: 'Z1', color: '#00A9E0', label: 'CABA + AMBA Norte/Oeste'},
  {key: 'FEDERICO CASTELANELLI', zone: 'Z2', color: '#003366', label: 'AMBA Sur + BA Interior + Costa'},
  {key: 'MARTIN BOIERO',         zone: 'Z4', color: '#E83A2E', label: 'Cordoba + Cuyo + SF Oeste'},
  {key: 'MAURICIO GIL',          zone: 'Z5', color: '#F97316', label: 'Litoral + Norte BA'},
  {key: 'IOANNIS PALKOUDAKIS',   zone: 'Z6', color: '#8E44AD', label: 'Patagonia + Mendoza + apoyo Federico/Gonzalo'},
  {key: 'SANTIAGO ESTEBAN',      zone: 'Z7', color: '#F39C12', label: 'NOA + NEA + Cuyo norte + apoyo Mauricio/Martin'},
]
```

### Clasificación operativa

```js
VDE_VENDOR_KEYS = {'MAURICIO GIL', 'MARTIN BOIERO', 'GONZALO DE LA ROSA', 'FEDERICO CASTELANELLI'}
VDI_VENDOR_KEYS = {'IOANNIS PALKOUDAKIS', 'SANTIAGO ESTEBAN'}
```

Ioannis y Santiago están en `VENDORS` históricamente (Z6, Z7), pero operativamente son VDIs.

### Inclusión cruzada VDI → VDEs pareja

Cuando se filtra Ioannis o Santiago en el header, automáticamente se incluyen las zonas de sus VDEs pareja:

```js
VENDOR_INCLUDES_OTHERS = {
  'IOANNIS PALKOUDAKIS': ['FEDERICO CASTELANELLI', 'GONZALO DE LA ROSA'],
  'SANTIAGO ESTEBAN':    ['MAURICIO GIL', 'MARTIN BOIERO'],
}
```

### Asignación automática a tienda

Una tienda se asigna a un vendor según la columna `ASESOR EXTERNO` del Excel master:
- `MAURICIO GIL`, `MARTIN BOIERO`, `GONZALO DE LA ROSA`, `FEDERICO CASTELANELLI` → VDE.
- `DISTRIBUIDORES` → entra al filtro "Distribuidores" (no cuenta como venta directa).
- `VENTAS ESPECIALES` → entra al filtro "Ventas Especiales".

La columna `ASESOR INTERNO` siempre dice Ioannis o Santiago según la pareja del VDE.

### `PROVINCE_VENDOR_OVERRIDE` (override hardcoded por provincia)

Constante en `index.html` que pisa el vendor de TODOS los departamentos de una provincia, independientemente del Excel master y de `vendor_overrides`. Hoy:

```js
const PROVINCE_VENDOR_OVERRIDE = {
  'SAN LUIS': 'MARTIN BOIERO',
};
```

Útil cuando el GeoJSON tiene depts mal etiquetados o cuando se decidió mover toda una provincia a otro vendor sin pasar por modal Zonas. Se aplica en:
- `deptEffectiveVendor(feat)` (color del polígono dept).
- `_buildVendorOutlinesCache` (clasificación SINGLE-VENDOR forzada).
- Marker color y filtros.

### Outlines de zonas (contornos visuales por vendor)

El contorno de cada zona pasó por **varias iteraciones**:
1. ~~Union polygon-clipping sobre TODOS los depts INDEC (~3.000 features).~~ Demasiado lento y dejaba microgaps por vertices que no matcheaban entre depts vecinos.
2. ~~Edge-counting (contar aristas compartidas y dibujar las únicas).~~ Sigue dejando lineas internas.
3. ~~Convex hull por vendor.~~ Pierde detalle de borde y se mete en zonas de otros vendors.
4. **Híbrido provincia + dept (actual, desde v182)**: clasifica cada provincia como **single-vendor** (≥90% de sus depts con un mismo vendor → usa el polígono provincial entero de `PROV_GEO`) o **split** (varios vendors significativos → union de los depts de cada vendor SOLO dentro de esa provincia). `PROVINCE_VENDOR_OVERRIDE` fuerza el modo single.

Esto resuelve casos como **Buenos Aires** (dividida entre Gonzalo en CABA+AMBA Norte/Oeste y Federico en AMBA Sur+Interior): la provincia es SPLIT, así que se unionan los depts por vendor por separado y queda un borde limpio para cada uno.

### Optimización + cache

- Union via **tree reduction** O(N log N) en `unionTree()` cuando `polygonClipping.union(...mps)` falla (fallback resistente).
- `_vendorOutlinesCache` se persiste en `localStorage` (key `VENDOR_OUTLINES_CACHE_KEY`). La próxima vez que se abre el mapa, el cache se reutiliza inmediatamente.
- `polygon-clipping` se carga **defer** (es un blob ~150KB que sólo hace falta para los outlines).

### Burbujas agregadas del mapa — desactivadas (v199+)

Históricamente el mapa dibujaba **burbujas numéricas blancas con número** superpuestas a los pines individuales en 3 modos:

- Por **vendedor** (zoom out, sin filtro).
- Por **provincia** (zoom medio, filtro vendor).
- Por **localidad** (zoom alto, filtro prov).

En la práctica generaban confusión visual: los usuarios veían un "8" gigante encima de 8 pines individuales y no sabían si era stock, cantidad de pedidos, o tiendas.

Desde v199+ están **gateadas detrás de un flag** en `drawMarkers`:

```js
const SHOW_AGG_BUBBLES = false;  // ← cambiar a true para re-habilitarlas
```

Con el flag en `false`, los 3 modos no se dibujan. Los pines individuales (`drawHabilitadosPins` + `drawSapAltaPins`) siguen apareciendo igual.

Para re-habilitar puntualmente: cambiar el flag a `true` en `drawMarkers` y recompilar.

---

## 12) Sección: Localidades / Clientes / Pedidos

### Localidades

Tab "Localidades" del sidebar. Lista todas las localidades visibles según los filtros del header, ordenadas por cantidad de tiendas.

#### Fuente del listado (v198+)

Antes el listado iteraba **solo POINTS**: para vendedores 100% SAP (ej. Martin Boiero) decía "Sin localidades con datos" aunque hubiera 10 pines en el mapa porque sus tiendas vivían en `client_applications` y no en POINTS.

Ahora suma localidades desde 2 fuentes:
- **POINTS** del Excel master (legacy).
- **`approvedAltasList`** agrupadas por `(provincia, localidad)` — incluye altas SAP aprobadas + provisorias (alta rápida).

El listado respeta los filtros vendor/provincia/localidad del header. El contador **"LOCALIDADES"** del header ahora suma `POINTS + sapLocs` (antes era solo `pts.length`, que daba 0 para vendedores 100% SAP).

#### Modal "Localidad" (v198+)

Click en la card de una localidad ya **no hace zoom al mapa**: abre un nuevo modal `localidad-modal` que lista **todas las tiendas de esa localidad con su dirección**, agrupadas por tipo:

| Badge | Tipo | Origen |
|---|---|---|
| **CLIENTE** | POINTS SAP-confirmed | `contacted` set, hay match con SAP |
| **PROSPECTO** | POINTS prospecto | sin habilitar todavía |
| **SAP** + cardCode | Altas SAP aprobadas | `client_applications` con `cardCodeSap` |
| **PROVISORIO** | Altas provisorias | `client_applications` con `manualSapPending: true` |

- La **dirección** se busca en este orden: `cliente_master.address` → `clientMeta.address` → `alta.calle`. Si no hay ninguna, aparece en rojo: **"(sin dirección cargada)"**.
- Si el alta tiene `fantasia` distinta del comercio legal, debajo del nombre se muestra **"Local: <fantasia>"**.

### Clientes

Tab "Clientes". Lista todas las tiendas visibles. Estados:
- **Pendiente**: badge ámbar (no se le pueden crear pedidos todavía).
- **Habilitado**: badge verde (puede crear pedidos).
- **Cancelado**: badge rojo (oculto del flujo).

#### Filtros del tab (v264+)
- **TODOS** — todo el listado.
- **CONFIRMADOS** — solo clientes con estado `habilitado` (POINTS con match) + SAP altas con geo+dirección. Excluye provisorios.
- **NO CONFIRMADOS** — provisorios (`manualSapPending && !cardCodeSap`) sin importar si tienen provincia/geo/addr **(v293+ fix)** + POINTS/prospectos pendientes de habilitar. Este total ahora coincide con el KPI **PENDIENTES** del header.

#### Badge de categoría comercial fijo en esquina (v295+)
Cada card de CLIENTES muestra el badge `Cat P/A/B/C` en la **esquina superior derecha** vía `position:absolute; top:6px; right:8px` (CSS `.cli-cat-corner`). `padding-right:62px` en `.client-card` reserva el espacio para que nombres largos no se solapen con el badge. `pointer-events:none` para no robar el click de la card.

Colores: **P** violeta (`#7c3aed`), **A** verde (`#059669`), **B** celeste (`#0284c7`), **C** gris (`#64748b`). El `cliTipo` se lee de `client_master` (POINTS) o de `client_applications.cliTipo` (SAP altas) — helper `getClientCategoryBadgeHtml(province, locName, name, {corner:true})`.

En **PEDIDOS** (`.pedido-client-card`) el badge va inline dentro del cluster derecho arriba del Habilitado/Provisorio, no absoluto (para no chocar con el badge de estado que ya vive en top-right).

### Flujo de "dar de alta" una tienda

Al tocar una tienda se abre el modal:
1. **Nombre editable** (click en el título → contenteditable).
2. **Dirección exacta** (input obligatorio).
3. **Localidad** (input obligatorio, precarga la del mapa).
4. **Botón "Dar de alta"** se habilita cuando los 2 inputs están llenos.
5. **Geocoding** con OpenStreetMap Nominatim (Argentina-only).
6. Si encuentra → guarda lat/lng en `clientMeta`. Si no → ofrece habilitar igual.
7. Marca el cliente como Habilitado y aparece un **pin verde** en el mapa.

### Pedidos

Tab "Pedidos". 3 sub-tabs:
- **Crear**: lista de clientes habilitados con búsqueda. **Incluye las altas SAP aprobadas + las provisorias (alta rápida)** vía `buildPedidoVisibleKeysSet()` (antes sólo POINTS).
- **Pendientes**: pedidos confirmados pero no transferidos a SAP. Con filtros mes / tienda / año.
- **Confirmados**: pedidos transferidos a SAP (DTW o Service Layer). Con filtros mes / tienda / año (igual que Mis Visitas).

### Modal Crear Pedido

Picker de productos con:
- Filtros: Categoría / Familia / Subfamilia / Buscar.
- **Filtro stock** (3 botones en la celda libre al lado de Subfamilia): `Todos` / `Disponibles` / `No disp.` — filtra el listado del picker según `hasStock(code)`.
- **Indicador de stock** verde/rojo al lado de cada SKU (basado en `STOCK_MAP`).
- Stepper `[-][n][+]` para cantidad.
- **Sugeridos**: SKUs que vecinos pidieron en pedidos confirmados (umbral 3 casas, basado en historial real de la app no MELI).

### Botón "Vista preliminar" (antes "Confirmar pedido")

Renombrado en v190+. Abre un modal de revisión antes de confirmar:

- **Líneas con punto verde/rojo** según `hasStock(code)`. Las líneas sin stock tienen **fondo rosa** + label inline **"SIN STOCK"**.
- Debajo del bloque "Descuento estimado" aparecen **2 cuadrantes (verde + rojo)**:
  - `Subtotal disponibles` — suma de líneas con stock.
  - `Subtotal no disponibles` — suma de líneas sin stock.
  - Estos subtotales **sólo se muestran si hay al menos 1 item sin stock**.
- Botón "Confirmar pedido" para cerrar el flow.

### Modal Confirmar Pedido (paso final)

Antes de enviar a SAP:
- Mes / año.
- **Condición de pago** obligatoria: CONTADO / CHEQUE / CTA CTE / VTA ESP / CON CHEQ.
- (VDI) Dropdown "Crear en nombre de" si tiene parejas VDE.

Al confirmar:
- Si Service Layer enabled → POST a `/b1s/v1/Quotations` (**hoy no cableado** — la función `enviarPedidosASAPViaServiceLayer` existe pero no se llama desde ningún botón).
- Si NO → queda en estado `pending` para luego "Listo para SAP" + ZIP DTW.

### Helpers de visibilidad

`buildPedidoVisibleKeysSet()` arma el set de keys (`tipo|prov|loc|name`) visibles para Pendientes/Confirmados. Desde v183+ incluye:
- Tiendas POINTS habilitadas (`contacted`).
- Altas SAP con `cardCodeSap` (aprobadas formalmente).
- Altas con `manualSapPending` (provisorias, vienen del flow Alta Rápida).

### Card de cliente — Fantasía editable + badge PROVISORIO

- La card del cliente muestra `Local: XXX` cuando hay fantasía distinta del nombre legal. La fantasía se edita con un **modal HTML** (reemplaza el chain `prompt() + confirm()` que existía hasta v177).
- La fantasía se guarda en `clientMeta[key].customFantasia`.
- Tiendas con `manualSapPending: true` muestran badge **"⚡ PROVISORIO (cargar a SAP manual)"** + fondo crema para que Admin las detecte.

### Card de cliente — Precaución (más visible desde v206)

Cuando una tienda tiene `clientMeta[key].precaucion = true` (problema de cobro, fraude reportado, etc.), la card sale destacada:
- Fondo `#fde68a` (amber-200, fuerte; antes era `#fffbeb` que casi no se distinguía).
- Franja izquierda de 5px en marrón (`#b45309`).
- Badge naranja **"⚠️ PRECAUCIÓN"** al lado del nombre (con tooltip de `precaucionReason`).
- Aplica tanto a tiendas POINTS como a altas SAP/POINTS huérfanos.

---

## 13) Sección: Rutas

Tab "Rutas" del sidebar. Arriba hay un **toggle de modo** con 2 botones (ambos `flex: 1`, texto centrado):
- **Rutas recomendadas** (auto-generadas, modo histórico).
- **Rutas personalizadas** (custom_routes, NUEVO desde v182+).

### Modo "Rutas recomendadas"

Auto-genera rutas mensuales por proximidad geográfica:

- Recolecta localidades del vendedor con tiendas.
- Ordena por lat (Norte → Sur).
- Agrupa por proximidad (~10-15 tiendas por ruta).
- Asigna fechas distribuidas por semanas del mes.

### Modo "Rutas personalizadas" (NUEVO)

Lista de rutas armadas a medida por el vendedor (colección `custom_routes`, filtrada por `ownerUid`). Cada ruta tiene:
- **Nombre** (libre).
- **Fecha planeada** (YYYY-MM-DD).
- **Notas** (texto largo).
- **Stops**: lista de tiendas con orden, agregar/quitar/reordenar.

El picker para agregar una tienda al stop busca en POINTS + altas SAP aprobadas + altas provisorias (alta rápida), respetando el filtro de vendor del usuario. Las provisorias se marcan con badge **PROVISORIO** dentro del picker.

Operaciones:
- Crear ruta (form vacío).
- Editar nombre / fecha / notas / stops.
- Eliminar ruta (la collection `custom_routes` permite delete sólo al ownerUid).
- "Enviar por WhatsApp" reutiliza el mismo helper de las rutas recomendadas.

### Estados de tienda en ruta

- **Pendiente** (gris).
- **Visitada** (verde) — si hay visita registrada para esa tienda en el mes.
- **Derivada VDI** (ámbar) — si el VDE delegó al VDI.
- **Reagendada** (azul) — si se movió a otra fecha.

### Botón "Recalcular Rutas"

Refresca con datos más recientes:
- Re-aplica overrides de Zonas a POINTS.
- Refresca listeners de visitas y route_overrides.
- Resetea vista detalle al listado.
- Re-renderiza con conteos actualizados.

### "Enviar ruta por WhatsApp"

Genera un link de Google Maps con todas las tiendas de la ruta como waypoints. Si la tienda tiene `client_master.address`, usa esa dirección exacta. Sino usa el nombre + localidad. Abre WhatsApp con un mensaje preformateado.

---

## 14) Sección: Visita

Formulario completo para registrar una visita a tienda:

- **Selector de localidad** → incluye localidades de POINTS + altas SAP aprobadas + provisorias (alta rápida).
- **Dropdown "Tienda de pesca"** → sólo muestra tiendas habilitadas en SAP (filtra prospectos y legacy desde v185+; antes traía todo). Las provisorias también aparecen porque tienen `manualSapPending`.
- Datos del local: Propio / Alquilado / Compartido, Tamaño, Fidelidad, Relevancia.
- POP: stickers, displays, banners.
- Necesidad puntual (opciones: CAÑERO, CARTEL, MOSTRADOR, OTROS — v296+ era "MOSTRADO").
- Tipo de venta: MOSTRADOR, ECOMMERCE, AMBOS (label visible v296+; value en DB sigue siendo `MOSTRADO` por retrocompat).
- % Mostrador / % Ecommerce (sliders 0-100, aparecen solo si Tipo=AMBOS).
- Competencia (texto libre).
- Oportunidad detectada.
- Lo más vendido Shimano.
- Lo que más preguntan.
- Ayuda que necesita la tienda.
- **Foto del frente del local** (obligatoria).
- **Hasta 5 fotos del espacio interior** (opcionales).
- **GPS doble-check**: la app saca lat/lng al iniciar el form y al guardar; si la distancia con `client_locations` es > 500m, marca `gpsStatus: 'outside'`.

VDI puede cargar visitas en nombre de un VDE pareja.

### Export Visitas mensual (NUEVO)

Botón "Exportar visitas del mes" → genera un Excel con **foto del frente embebida** (vía **ExcelJS** lazy-load). Las columnas incluyen todos los campos del formulario + fecha + vendedor + provincia + localidad. La foto va incrustada en la celda correspondiente (no como link).

---

## 15) Sección: Dashboard

Dashboard comparativo con:
- KPIs del mes vs target (% cumplimiento ARS).
- Comparativa entre vendedores (tabla + gráfico).
- Top SKUs vendidos.
- Top clientes por facturación.
- Filtros: mes / año / vendedor / categoría.

---

## 16) Sección: Rendiciones

Carga de gastos del vendedor con OCR automático:

1. Vendedor saca foto del ticket (**foto y N° de ticket son opcionales desde v188+**; antes la foto era bloqueante).
2. La foto se manda a **Gemini API** (`gemini-2.5-flash`) con un prompt estructurado.
3. Gemini devuelve JSON con: fecha, monto, comercio, tipo de gasto.
4. Vendedor verifica y ajusta si hace falta.
5. Se guarda en `rendiciones/{docId}` con `status: pending_approval`.
6. El aprobador (configurado en `roles/{vde}.rendicionesApproverUid`) la aprueba o rechaza.

### Tipos de gasto

Combustible, peajes, alojamiento, comidas, varios.

### Export Rendiciones mensual (Excel local)

Botón "Exportar rendiciones del mes" → Excel con **foto del ticket embebida** (ExcelJS lazy-load) + más columnas:

- Concepto
- N° Ticket
- Modo de pago
- Tipo de gasto
- División
- Importe USD (calculado con TC del período)
- Aprobador
- Aprobado en (timestamp)

### Fix de Firestore Rules (v189+)

Antes: el vendedor no podía submitter si tenía aprobador asignado porque las rules intentaban leer `/roles/{approverUid}` (que el VDE no tenía permiso de leer). Fix:
- El cliente lee `app_config/users_directory` (público) para resolver el email del aprobador.
- Se cachea el email en `localStorage` con TTL.
- Las rules permiten escribir la rendición sin necesitar leer `/roles` ajenos.

### Mail Rendiciones cron — Lunes y Miércoles 9am AR (v202+)

Cron automatizado en GitHub Actions: `scripts/send_rendiciones_email.py` corre **Lunes y Miércoles 9am hora Argentina** y manda un mail desde `bot.shimano.pesca@gmail.com` a `mariano.erbino@shimano.com.ar` (Outlook 365) con un Excel de las rendiciones aprobadas desde la última corrida.

#### Estructura del Excel — v2 desde v217 (3 hojas)

| Hoja | Tabla nombrada | Granularidad | Mapea a Power Automate? |
|---|---|---|---|
| **Gastos** (default) | `TablaGastos` | **UNA fila por dupla (ownerEmail, tipoGasto)** | **SÍ** — la lee Power Automate y crea UN item SharePoint por dupla |
| **Detalle** (NUEVA en v217) | — | UNA fila por gasto individual (15 columnas) | NO — solo auditoría humana |
| **Solicitudes** | `TablaSolicitudes` | UNA fila por anticipo | SÍ |

> La hoja "Resumen" fue **eliminada** en v202+. El Excel queda compacto y mappeable a Power Automate.

> Los nombres de tabla (`TablaGastos`, `TablaSolicitudes`) son **Excel Tables reales** (no rangos). Power Automate los necesita para el step `List rows present in a table`.

#### Cambio v2 — Agrupación por dupla (v217, pedido de Fernando)

**Antes (v202–v216)**: `TablaGastos` tenía **15 columnas** y **una fila por gasto**. Si Gonzalo cargaba 3 facturas A en una semana, Power Automate creaba 3 items separados en SharePoint → confundía la rendición consolidada.

**Ahora (v217)**: agrupación por `(ownerEmail, tipoGasto)`. Los 3 tipos típicos son `Factura A`, `Gastos con comprobante`, `Gastos sin comprobante` → max 3 filas por persona por período.

`TablaGastos` v2 — **10 columnas**:

| # | Columna | Tipo | Detalle |
|---|---|---|---|
| 1 | `Vendedor (email)` | texto | `gonzalo.delarosa@shimano.uy` |
| 2 | `Tipo gasto` | texto | `Factura A` / etc. |
| 3 | `Cant Rendiciones` | número | Cuántos gastos hay en la dupla |
| 4 | `Importe Total` | número | Suma del grupo |
| 5 | `Importe USD Total` | número | Suma USD (vacío si ninguno tenía USD) |
| 6 | `Moneda` | texto | Una moneda si todas iguales, `MIXTO` si conviven varias |
| 7 | `Periodo Desde` | texto fecha | `createdAt` más antigua del grupo |
| 8 | `Periodo Hasta` | texto fecha | `createdAt` más reciente del grupo |
| 9 | `Rendiciones IDs` | texto | IDs Firestore concatenados con `;` |
| 10 | `Fotos URLs` | texto | URLs públicas Firebase Storage concatenadas con `;` — Power Automate hace `split` y adjunta cada foto al item |

> **Detalle**: la hoja nueva tiene las 15 columnas viejas sin agrupar (ID, Fecha carga, N° Ticket, Descripcion, Modo pago, Tipo gasto, Division gasto, Moneda, Importe, Importe USD, Observaciones, Aprobado por, Fecha aprobacion, Ticket hyperlink). Fernando o Mariano la abren si quieren ver línea por línea.

#### Pre-upload de fotos antes de agrupar (v217)

Para que el grupo pueda concatenar URLs, el script:
1. Recorre TODAS las rendiciones de tipo `gasto` ANTES de agrupar.
2. Llama `upload_foto_to_storage(rendicion_id, foto_dataurl)` por cada foto y cachea en `foto_url_by_id = {id: url}`.
3. Agrupa por dupla.
4. Al armar cada fila, concatena `foto_url_by_id[id]` solo de los gastos cuyo upload fue exitoso. Una foto rota no rompe la fila — simplemente no entra al `;`.

#### Bucket de Storage — formato nuevo `.firebasestorage.app` (v217)

Firebase post-2024 usa `<project-id>.firebasestorage.app` como nombre default del bucket (antes era `.appspot.com`). `init_firestore()` ahora arma:

```python
default_bucket = f"{project_id}.firebasestorage.app"
storage_bucket = os.environ.get("STORAGE_BUCKET") or default_bucket
```

Override via env var `STORAGE_BUCKET` si por alguna razón el proyecto sigue en el bucket legacy.

#### Columna "Imagen ticket" — hyperlink a Firebase Storage (v202+)

Hasta v201 se intentó embebir la foto directamente con openpyxl + Pillow → quedaba apretada en Excel y el archivo pesaba mucho.

Desde v202+ cada foto se sube a **Firebase Storage** y la celda queda con un hyperlink:

1. Función `upload_foto_to_storage(rendicion_id, foto_dataurl)` sube el blob a `rendiciones-tickets/<rendicion_id>.<ext>`.
2. `blob.make_public()` para que la URL sea permanente y abrible sin auth.
3. En la celda Excel queda hyperlink azul **"📷 Ver ticket"** que abre la imagen a tamaño original en el navegador.
4. Sin foto → celda dice **"(sin foto)"**.
5. Foto corrupta → **"(error al subir)"**.

`init_firestore()` configura `storageBucket = <project-id>.firebasestorage.app` (formato nuevo Firebase, v217+; antes era `.appspot.com`).

> **REQUIERE plan Firebase Blaze** activado: Firebase Storage no funciona en Spark (free tier). **Blaze ya activo en el proyecto desde 2026-06-30**.

#### Inputs del workflow_dispatch (v202+)

El workflow acepta dos inputs para uso manual:

| Input | Para qué |
|---|---|
| `force=true` | Ignora el filtro `notifiedAt`, trae **TODAS** las aprobadas (testing/reenvío completo) |
| `skip_mark=true` | No marca como `notifiedAt` después del envío (reenvíos sin afectar el estado del flow) |

El cron Lun/Mie normal usa ambos en `false`.

---

## 16-bis) Integración SharePoint + Power Automate (NUEVO en v203)

Sección entera nueva: el flow de **Power Automate** que carga automáticamente las rendiciones aprobadas a la lista de **SharePoint** del team **SAR** (Admin & Finanzas).

### Stack end-to-end

```
GitHub Actions (Lun/Mie 9am AR)
   ↓ Python script
   ↓ Genera Excel (TablaGastos + TablaSolicitudes)
   ↓ Sube fotos a Firebase Storage (hyperlinks)
Mail desde bot.shimano.pesca@gmail.com
   ↓
Outlook 365 (mariano.erbino@shimano.com.ar)
   ↓ Trigger Power Automate
Flow "Cargar rendiciones aprobadas a SharePoint"
   ↓ Create file en OneDrive
   ↓ List rows in TablaGastos
   ↓ For each row → Create item
Lista SharePoint "ANTICIPO Y RENDICION DE GASTO"
   ↓
Equipo SAR (Fernando Gamboa — Admin/Finanzas) ve los ítems
```

### Lista SharePoint destino

| Dato | Valor |
|---|---|
| Site URL | `https://teamshimano.sharepoint.com/teams/SLA_int_00002` |
| Lista | `ANTICIPO Y RENDICION DE GASTO` |
| Contacto Admin/Finanzas | **Fernando Gamboa** |

### Flow Power Automate

Vive en `make.powerautomate.com` bajo la cuenta `mariano.erbino@shimano.com.ar`.

- **Nombre**: `Cargar rendiciones aprobadas a SharePoint`
- **Trigger**: `When a new email arrives (V3)` → Office 365 Outlook.
  - From: `bot.shimano.pesca@gmail.com`
  - Subject Filter: `Rendiciones aprobadas`
  - Include Attachments: **Yes**

Estructura:

```
Trigger
└── For each (attachments)
     ├── Create file (OneDrive Business) → /shimano-rendiciones/rendiciones-temp.xlsx
     ├── List rows present in a table (Excel Online Business) → TablaGastos
     └── For each 1 (rows)
          └── Create item (SharePoint)
```

### Mapeo Excel → SharePoint (Schema v2, v217)

> **Detalle operativo completo** en `POWER_AUTOMATE_RENDICIONES.md` (archivo separado, mismo repo).

Columnas nuevas creadas en la lista SharePoint **"ANTICIPO Y RENDICION DE GASTO"** (2026-06-30):

| Columna SharePoint | Tipo | Source columna Excel v2 |
|---|---|---|
| `Tipo comprobante` | Choice (FACTURA A / GASTO CON COMPROBANTE / GASTO SIN COMPROBANTE) | `Tipo gasto` |
| `Cant rendiciones` | Number | `Cant Rendiciones` |
| `Desde` | Single line text | `Periodo Desde` |
| `Hasta` | Single line text | `Periodo Hasta` |
| `Rendiciones IDs` | Multiple lines text | `Rendiciones IDs` |

Mapeo total v2:

| Campo SharePoint | Valor / fuente Excel |
|---|---|
| `Title` | `{Vendedor (email)} \| {Tipo gasto} \| <12 chars primer ID>` (idempotency key) |
| `Importe` | `float(item()?['Importe Total'])` |
| `Moneda Value` | `Moneda` (puede valer `MIXTO`) |
| `Tipo comprobante Value` | `Tipo gasto` |
| `Cant rendiciones` | `Cant Rendiciones` |
| `Desde` / `Hasta` | `Periodo Desde` / `Periodo Hasta` |
| `Rendiciones IDs` | `Rendiciones IDs` |
| `Solicitado por Claims` | `Vendedor (email)` |
| `Tipo de Operacion Value` | `"Rendicion de Gasto"` (literal) |
| `Estado Value` | `"Abierto"` (default) |
| `SAP Value` | `"No Registrado"` (default) |

### Estructura del flow (Híbrida Opción C — v217)

```
Trigger: When a new email arrives (V3)
└── For each (attachments)
     ├── Save attachment to OneDrive
     ├── List rows present in a table → TablaGastos (v2: 10 cols)
     ├── Get items SharePoint (filter Title eq <key>)   ← idempotencia
     └── For each row
          ├── Condition: rowCount == 0
          │    └── True: Create item SharePoint (con todos los campos v2)
          ├── Compose: split(Fotos URLs, ';')
          ├── For each foto URL
          │    ├── HTTP GET (foto pública Firebase Storage)
          │    └── Add attachment SharePoint (Id = nuevo item, foto descargada)
          └── Add attachment SharePoint (Id = nuevo item, Excel original)
                via base64ToBinary(items('For_each')?['ContentBytes'])
```

### Particularidades técnicas conocidas

- **Idempotencia por Title**: el script genera el Title como `{vendedor} | {tipoGasto} | {primeros 12 chars de Rendiciones IDs}`. Si el flow corre 2 veces sobre el mismo Excel, el `Get items` con `$filter` detecta el item existente y no se duplica.
- **Premium HTTP connector**: el step `HTTP GET` para bajar la foto requiere **Power Automate Premium**. Mariano tiene **trial Premium de 90 días activado** (2026-06-30). Después hay que comprar licencia o migrar a un paso nativo.
- **Detección del schema de TablaGastos**: para que el step `List rows` detecte las 10 columnas nuevas, necesitamos un Excel ya en OneDrive antes de configurar `Create item`. Workflow recomendado:
  1. Setear `File` temporalmente con una ruta estática (un Excel de prueba ya subido).
  2. Configurar `Create item` con todos los chips dinámicos.
  3. Volver el `File` a chip dinámico `Id` del step `Create file`.
- **`Importe` como Number**: usar `float(item()?['Importe Total'])` para forzar la conversión.
- **Document Library aparece como "ドキュメント"** (japonés): es el OneDrive normal, bug conocido de localización de Microsoft Connectors. Funciona sin problema.

### Estado actual del flow

> **FUNCIONÓ con schema v1** — runs Succeeded en producción. **Schema v2 (agrupado por dupla) en migración hoy 2026-06-30** — ver `POWER_AUTOMATE_RENDICIONES.md` para los cambios exactos al flow.

---

## 17) Sección: Alta Clientes

Tab con **3 sub-tabs**:
1. **Nuevo cliente** (formal, doble aprobación).
2. **Alta rápida** (provisorio, NUEVO desde v183+).
3. **Mis solicitudes** (ver/eliminar las propias).

### Flujo formal "Nuevo cliente" (doble aprobación)

End-to-end:

1. **Vendedor (o público vía `alta-cliente.html`)** carga la solicitud con:
   - Datos del comercio (razón social, fantasía, CUIT, condición fiscal).
   - Dirección completa.
   - Foto ARCA + IIBB + hasta 3 fotos del local.

2. **Estado**: `pending_approval`.

3. **Aprobador** (admin / gerente / interno) ve la notificación.

4. **Modal de aprobación** con campos extras:
   - **CardCode SAP B1** (input — sin esto no se pueden crear pedidos).
   - **Vendedor asignado** (dropdown VDE / VDI / Distribuidor).
   - **Localidad final** (override si la declarada no matchea).

5. Necesita **2 aprobaciones** distintas para pasar a `approved`.

6. Cuando se aprueba → listener `ensureApprovedAltasListener` la agrega al mapa en su provincia/localidad con el vendor asignado.

7. El vendedor entra a la app y ve la tienda en su zona como "Habilitada" lista para crear pedidos.

### Flujo "Alta rápida" (NUEVO en v183+)

Para cuando el vendedor necesita crear un pedido **YA** y no puede esperar la doble aprobación + carga en SAP:

1. Sub-tab **"Alta rápida"** → formulario corto: comercio, dirección, **provincia + localidad obligatorias**, dueño, teléfono opcional, **CUIT opcional (v294+)**.
2. Crea un documento en `client_applications` con:
   - `source: 'alta_rapida'`
   - `manualSapPending: true`
   - `status: 'approved'` (la app no exige doble aprobación para alta rápida).
   - `cuit: <solo digitos>` si el vendedor lo cargó — habilita match automático confiable en el próximo sync SAP.
3. **Notifica automáticamente a admin** (`type: 'alta_rapida_creada'`) con texto "X dio de alta rápida a ... — hay que cargarlo manualmente en SAP".
4. La tienda aparece **al instante** en:
   - Mapa (pin SAP).
   - Picker de Pedidos (`buildPedidoVisibleKeysSet`).
   - Visitas (dropdown localidad + tienda).
   - Rutas (picker custom).
5. Se identifica con badge **"⚡ PROVISORIO (cargar a SAP manual)"** + fondo crema en todas las vistas.
6. Admin más tarde la carga formalmente a SAP:
   - **Con CUIT (v294+)**: el próximo cron `sync_bp_pesca` (cada 30 min) matchea por CUIT en `find_match()` → `PROV→CONF` automático. Sin intervención manual.
   - **Sin CUIT o si el nombre no matchea exacto**: admin abre **Master Clientes → 👤 Provisorios → 🔗 Vincular con SAP** y elige el BP correcto (auto-ranking por CUIT match si hubiera; ordenado alfabético si no). Setea `cardCodeSap` + `manualSapPending: false` + `source: 'sap_sync_manual_link'` + auditoría (`linkedFromSapDocId`, `linkedBy`, `linkedAt`) y **elimina el BP SAP duplicado** que había creado el sync.

### Sub-tab "Mis solicitudes"

Lista las altas creadas por el usuario. **Botón Eliminar** (NUEVO v184+) con guard: **NO permite borrar altas que ya tienen `cardCodeSap`** (porque significa que están cargadas en SAP). Las rules también validan esto server-side.

### Auto-aparición en el mapa

Implementado con un index global `approvedAltasByLoc[PROV|LOCALIDAD]`. `effClients(p)` suma las altas de esa localidad al listado del point. `filteredPoints()` incluye points cuya localidad tenga alguna alta asignada al vendor del filtro.

### `drawSapAltaPins` — anclaje a centroide de localidad (v186+)

Cuando un alta SAP no tiene `lat/lng` (no se geocodificó todavía), el pin se dibuja en el **centroide de su localidad** si se conoce, no en el medio de la provincia. Esto evita el problema visual histórico de tiendas SAP apiladas en el centro de la provincia.

Además respeta `vendor_overrides` vía `getEffectiveVendorForSapAlta(a)`: si la tienda fue reasignada por modal Zonas, el pin se pinta con el color del vendor efectivo.

---

## 18) Sección: Notificaciones (Alertas y tareas)

3 sub-tabs:
- **Recibidas**: alertas + tareas + derivaciones VDI pendientes.
- **Realizadas**: las ya cerradas.
- **Crear tarea**: form para mandarle una tarea a otro usuario con texto + imágenes.

Tipos de notificación:
- `partner_action` (subtype `order_created`): VDI cargó un pedido en nombre del VDE.
- `client_approval_ack`: tu alta cliente fue aprobada.
- `alta_rapida_creada`: notifica a admin cuando un vendedor crea un cliente provisorio que hay que cargar a SAP manual.
- Derivaciones de ruta.
- Tareas manuales entre usuarios.

### Botón Eliminar por card (NUEVO en v179+)

Cada notificación recibida tiene un **botón Eliminar rojo** alineado a la derecha. Borra el doc de `notifications/{fsId}` (las rules permiten delete si auth.uid == targetUid). Funciona para **todos los tipos**, no sólo tareas. Útil para limpiar la bandeja sin esperar a marcar como hecho.

---

## 19) Sistema VDE-VDI (vendedor externo / interno)

### Concepto

- **VDE** (vendedor externo): visita las tiendas, recibe pedidos. Su zona es restringida geográficamente.
- **VDI** (vendedor interno): hace soporte desde la oficina. Atiende llamadas de tiendas, carga pedidos en nombre de un VDE pareja cuando este está en ruta.

### Configuración de pareja

En el panel admin "Usuarios", al vendedor VDE le aparece un campo dropdown "**Pareja interno**". Se elige un usuario con rol `interno`. Esto setea `roles/{vde}.internalPartnerUid = uid_vdi`.

### Filtrado para VDI

El VDI ve en el mapa **solo las zonas de sus VDEs pareja**. Implementado en `loadMyExternalPartners()`:
1. Listener `where('internalPartnerUid', '==', currentUser.uid)` sobre `roles`.
2. Filtra los que tienen `role = 'vendedor'`.
3. Construye `myExternalPartners` con vendor key de cada VDE.

Cuando el VDI abre el header, el dropdown Zona muestra sus VDEs como opciones.

### Acción en nombre de

En el modal "Confirmar Pedido" y "Visita", si el usuario es VDI con parejas, aparece un dropdown "**Crear en nombre de**" con opciones VDE.

Al confirmar:
- `ownerUid = uid_vde` (dueño es el VDE).
- `createdByUid = uid_vdi` (auditoría).
- `onBehalfOf = true`.

El VDE recibe una notificación automática "X cargó un pedido en tu nombre".

---

## 20) Provincias hardcoded a VDIs

Para que sin filtros el mapa muestre las regiones de distribuidores con el color del VDI correspondiente:

```python
IOANNIS_PROVINCES = {
    'TIERRA DEL FUEGO', 'SANTA CRUZ', 'CHUBUT', 'RIO NEGRO',
    'NEUQUEN', 'LA PAMPA', 'MENDOZA',
}
SANTIAGO_PROVINCES = {
    'SAN JUAN', 'SAN LUIS', 'JUJUY', 'SALTA', 'CATAMARCA',
    'SANTIAGO DEL ESTERO', 'FORMOSA', 'CHACO', 'MISIONES',
    'LA RIOJA', 'TUCUMAN',
}
```

Aplicado en el build script al asignar `dept['vendor']`: si la provincia está en uno de los sets, sobreescribe el vendor por el VDI correspondiente.

Cuando se filtra Ioannis → ve **sus provincias + Federico + Gonzalo**. Idem Santiago con Mauricio + Martin.

---

## 21) Campañas comerciales

Admin (+ gerente desde v208+) crea campañas con:
- Nombre + descripción.
- Fechas vigencia (desde / hasta).
- SKUs incluidos.
- Zonas / vendedores aplicables.

En el picker de productos del pedido, los SKUs en campaña activa aparecen marcados con badge **★ CAMP**.

Tab "Campañas Activas" (botón amarillo del header) muestra el detalle.

### Progreso GLOBAL (v207+)

Antes, cada vendedor veía solo **su aporte** sobre el target de la campaña — un VDE podía ver "12 / 200 unidades" aunque entre el equipo ya hubieran cargado 180. Confundía la lectura.

Desde v207+ el progreso se calcula **sobre el scope de la campaña**:
- Source: `globalPedidos` (todos los pedidos confirmados de todos los users, no solo `confirmed{}` del propio).
- Helper `passesCampScope(p)`: filtra según el `scope` configurado en la campaña:
  - `all` → cuenta todos los pedidos.
  - `vendor` → solo del vendor target.
  - `province` → solo de la provincia target.
- Admin/gerente y vendedor/interno ven exactamente el mismo número (el progreso del equipo, no el aporte individual).

---

## 22) Targets mensuales

Admin/gerente carga el objetivo de facturación en ARS por vendedor + año + mes desde el modal **Targets mensuales** (header → botón Targets).

Colección Firestore: `targets`. Doc ID: `{vendorKey_normalizado}_{year}_{monthPadded2}` (ej: `GONZALO_DE_LA_ROSA_2026_07`). Payload:
```js
{
  sellerId: "GONZALO DE LA ROSA",  // vendorKey (el UPPERCASE del array VENDORS)
  year: 2026,
  month: 6,                        // 0-11 (índice del array MESES)
  targetArs: 120000000,
  updatedAt: <Ts>,
  updatedBy: "<uid>",
  updatedByEmail: "..."
}
```

- Meses vacíos se persisten como `delete()` del doc (no se guarda 0).
- Autosave por click en Guardar (no debounced).
- El dashboard suma `getCumulativeTargetArs(vendorKey, year, throughMonthIdx)` para el % de cumplimiento acumulado.

### Export Excel formato largo (v297+)

Botón verde **📊 Exportar Excel** en el footer del modal Targets → descarga `Targets_Shimano_YYYY-MM-DD.xlsx` con una fila por (vendedor, mes) con target > 0.

Columnas exactas (matchea el master que sube gerente a SAP / Power BI):

| SlpCode | Vendedor | Año | Mes | Meta |
|---|---|---|---|---|
| 50 | Gonzalo de la Rosa | 2026 | 7 | 120000000 |
| 50 | Gonzalo de la Rosa | 2026 | 8 | 125000000 |

- `SlpCode` ← `sapGetSlpCodeForVendor(vendorKey)` desde `sap_vendors` (vacío si el vendedor no está mapeado a SAP).
- `Vendedor` ← preferencia `sap_vendors.slpName` (formato SAP "Gonzalo de la Rosa"). Fallback: `titleCase(vendorKey)`.
- `Año` / `Mes` / `Meta` — directo del doc. **`Mes` se convierte 0-11 → 1-12** para el Excel.

Orden: SlpCode → Vendedor → Año → Mes. Anchos de columna razonables via `ws['!cols']`.

Permisos: `canManageTargets()` (admin/gerente + emails allowlist).

### Sync a BigQuery — vista `v_targets` (2026-07-14)

Además del Excel manual, los targets se sincronizan **cada 30 min automáticamente** al modelo Power BI. Pipeline:

```
Firestore.targets ──► sync_sap_to_bigquery.py:sync_targets_from_firestore()
                     ──► BigQuery.shimano_app.targets_raw (WRITE_TRUNCATE)
                     ──► v_targets (CREATE OR REPLACE VIEW en bigquery/views.sql)
                     ──► Power BI Import
```

`v_targets` expone las metas al modelo con **SlpCode SAP ya traducido desde el vendorKey app** (mapeo hardcoded en el CASE de la vista). Ver **sección 40** para el mapeo canónico completo, discrepancias detectadas contra SAP prod, y verificaciones de aceptación.

**Uso en Power BI**:
- Import como tabla nueva `v_targets` (BigQuery connector, dataset `shimano_app`).
- Relación: `v_targets[slp_code]` ↔ `Vendedores[SlpCode]` (o dim equivalente).
- Medidas típicas:
  ```dax
  Target Mensual = SUM ( v_targets[target_ars] )
  Pct Cumplimiento = DIVIDE ( [Facturación Total], [Target Mensual], 0 )
  Color Cumplimiento =
      VAR Ratio = DIVIDE ( [Facturación Total], [Target Mensual], 0 )
      RETURN SWITCH ( TRUE (),
          Ratio >= 1,    "#22C55E",   -- verde: cumplió/superó
          Ratio >= 0.9,  "#F59E0B",   -- amarillo: 90-99%
          "#EF4444"                    -- rojo: < 90%
      )
  ```
  El `Color Cumplimiento` se aplica en formato condicional de cards/tablas: **Formato → Fondo → f(x) → Basado en valor de campo → Color Cumplimiento**.

---

## 23) Panel Master Clientes + import SAP

### Master Clientes — Direcciones

Tab que lista todas las tiendas del mapa con un input para cargar la **dirección exacta** de cada una. Mejora la precisión del link de Google Maps al enviar la ruta por WhatsApp.

Filtros: vendor / provincia / localidad / estado / búsqueda.

### Dropdown editable de provincia para altas SAP (NUEVO en v185+)

Las filas que son altas SAP (no POINTS originales) tienen un **dropdown editable de provincia** en la columna provincia. Al cambiar la provincia:
- Se actualiza `client_applications.{id}.provincia`.
- Se **auto-infiere el vendor** según `inferVendorFromProvince()` + `PROVINCE_VENDOR_OVERRIDE` + sets VDI hardcoded.
- Se **limpian `lat/lng`** para forzar re-geocodificación en la próxima corrida de "Reubicar pines".

### Altas SAP sin provincia → grupo "(sin provincia)" (v186+)

Antes: las altas que se importaban sin provincia quedaban invisibles (no se mostraban en Master Clientes). Ahora aparecen bajo un grupo virtual **"(sin provincia)"** así Admin las puede ver y completarles la provincia con el dropdown.

### KPI "PENDIENTES" del header ahora = badge "Provisorios" del Master Clientes (v292+, 2026-07-13)

**Antes:** `updateStats()` (línea 5586) contaba como `pendientes`:
- POINTS/prospectos no contactados +
- SAP altas sin `provincia + geo + dirección`, filtradas por vendor/provincia/localidad activos.

Mientras que el badge del botón **👤 Provisorios** (v290+) contaba los `approvedAltasList.filter(a => a.manualSapPending && !a.cardCodeSap)` **totales globales**. Confundía porque los números no coincidían (ej: 3 vs 16).

**Ahora:** el KPI del header (`.js-stat-p`) usa `getProvisoriosList().length` — el mismo total global que el badge. Ambos muestran los provisorios de Alta Rápida pendientes de cargar a SAP.

Se pierde la métrica antigua de "cuántas tiendas no contactadas hay en mi contexto" — si algún día se necesita, la lógica original quedó como `pendientes` en la variable local del scope, sólo se cambió el `textContent` final.

### Fix crítico: sync SAP pisaba localidad/provincia manuales (v291+, 2026-07-13)

**Bug reportado por Mariano:** completó a mano ~20 tiendas SAP con localidad + provincia en Master Clientes, guardó fila por fila. A las pocas horas, todas volvían a aparecer con `(sin localidad)` y `(sin provincia)`.

**Causa raíz:** el workflow `sync-sap-catalog-stock.yml` corre cada 30 min (`cron: '13,43 * * * *'`) y ejecuta `scripts/sync_sap_to_firestore.py`, que dentro de `sync_bp_pesca()` hace `set({merge:True})` sobre cada BP con un `base_payload` que **siempre incluye** `localidad`, `localidadFinal`, `provincia` — aunque SAP los tenga vacíos. Como muchos BPs argentinos vienen sin `City`/`State` cargados desde SAP B1, cada corrida escribía `''` sobre esos campos y **destruía el trabajo manual del admin**.

**Fix:** justo después de construir `base_payload` se hace `pop()` de `localidad` / `localidadFinal` cuando `bp.City` viene vacío, y de `provincia` cuando `provincia_final` viene vacío. Así el merge preserva lo que el admin ya cargó.

**Trade-off consciente:** si en el futuro el admin edita localidad/provincia y en SAP B1 alguien carga un valor DISTINTO, el sync va a pisar el edit del admin con lo de SAP (comportamiento "SAP siempre gana", consistente con `runRevisarDireccionesSap`). Si eso también molesta, hay que agregar un flag `localidadManualOverride:true` que el sync respete.

### Autosave debounced en filas SAP (v291+)

**Problema previo:** el input de localidad y el dropdown de provincia de las filas SAP solo se persistían cuando el admin tocaba GUARDAR de la fila. Además `mcPendingChanges` solo trackeaba el input de dirección, así que el aviso "Hay cambios sin guardar" al cerrar el modal NO detectaba localidad/provincia sin guardar → se perdían silenciosamente al cerrar. Peor: el listener `ensureApprovedAltasListener` re-renderea toda la tabla ante cualquier snapshot (`cont.innerHTML = html`), lo que borraba inputs no guardados de otras filas mientras trabajabas.

**Fix:**
- Cada cambio en localidad / provincia / dirección de una fila SAP dispara `scheduleMcAutosave(docId, row, 900)`.
- Cae dentro del mismo `saveMcAddr` que ya usa el botón GUARDAR (misma lógica de merge + geocode).
- Se muestra un badge amarillo en las stats: `Guardando 3...` o `Pendientes: 3`.
- El listener de `approvedAltasList` NO re-renderea la tabla si hay saves en vuelo (`mcAutosaveInFlight > 0`) o inputs con debounce pendiente. Difiere el re-render con `mcRenderDeferred = true` hasta que todo esté commiteado, y ahí sí lo aplica.
- `closeMasterClientesPanel` ahora también chequea `mcPendingRowIds` y `mcAutosaveInFlight` — si hay algo pendiente, confirmación al cerrar.

Válido solo para altas SAP (filas con `tipo='sap_alta'`). Los POINTS legacy siguen con el botón GUARDAR clásico porque su localidad/provincia están atadas al docId del padrón.

### Botón "👤 Provisorios" — filtrar altas rápidas pendientes de SAP (v290+)

Toolbar violeta al lado de "Masterfile-Base". Muestra el conteo pendiente en un badge (ej. `👤 Provisorios 4`).

Filtra `approvedAltasList` por `manualSapPending === true && !cardCodeSap` — o sea, los clientes que un vendedor dio de alta por **Alta Rápida** y que todavía no fueron cargados a SAP manualmente por admin.

Al tocarlo:
- La tabla del Master Clientes reemplaza sus filas por los provisorios (fondo crema `#fffbeb`, badge morado **⚡ PROVISORIO**).
- Columnas: Comercio (con dueño + teléfono), Localidad, Provincia, Vendedor asignado / dado de alta por, Dirección de Alta Rápida (`calle`), Fecha de alta.
- Los filtros vendor / provincia / localidad / búsqueda siguen aplicando. El filtro "Con/Sin dirección" se ignora porque no aplica a solicitudes.
- Segundo click → vuelve al modo default (Master SAP).

El badge se actualiza en tiempo real vía `updateMcProvisorioCount()` disparado dentro del listener `ensureApprovedAltasListener`.

### Botón "🔗 Vincular con SAP" en cada fila provisorio (v294+, admin only)

Cuando el auto-match del cron `sync_bp_pesca` falla (nombre normalizado difiere entre el provisorio y el CardName SAP, o el provisorio no tiene CUIT cargado), admin puede vincular manualmente:

1. Master Clientes → **👤 Provisorios** → columna "Acción" → **🔗 Vincular con SAP**.
2. Modal `#vincular-sap-modal` abre con:
   - **Info del provisorio** (nombre + localidad + provincia + CUIT + dirección).
   - **Buscador** por nombre / CardCode / CUIT (default: pre-populado con el CUIT o comercio del provisorio).
   - **Lista de BPs SAP disponibles** (filtro: `approvedAltasList` con `cardCodeSap` truthy y `!manualSapPending`).
   - **Auto-ranking**: los BPs cuyo CUIT matchea el CUIT del provisorio aparecen primero con badge verde "✓ CUIT MATCH".
3. Click en **Vincular** → confirm → batch:
   - `set(provisorio, {cardCodeSap, manualSapPending: false, source: 'sap_sync_manual_link', linkedFromSapDocId, linkedBy, linkedAt, ...camposSAP}, {merge: true})`.
   - Completa campos vacíos del provisorio (cuit/calle/localidad/provincia/email/tel/CP) con los de SAP sin pisar los cargados.
   - `delete(bpSap)` — elimina el BP SAP duplicado que había creado el cron.
4. El listener `approvedAltasList` repinta todo automático. El provisorio salta a CONFIRMADOS.

**Permisos**: solo `admin` (columna muestra "(admin)" para gerente/interno). Motivo: el batch.delete del doc SAP con `cardCodeSap` requiere `role=admin` en Firestore Rules — gerente no es owner del doc creado por el sync.

**Retrocompat**: la auditoría en `linkedFromSapDocId` guarda el ID del BP borrado para reconstruir manualmente si admin se equivocó de match.

### Botón Eliminar 🗑 por fila (v200+)

Cada fila tiene un **botón rojo 🗑** al lado de Guardar. Sólo visible para **admin / gerente**. Comportamiento según el tipo de fila:

| Tipo | Acción | Confirmación |
|---|---|---|
| **Alta SAP** (`sapFsId`) | Borra el doc de `client_applications` | Confirm extra con **warning** si la tienda ya tiene `cardCodeSap` (está en SAP) |
| **POINTS legacy** | Borra el doc de `client_master` (limpia dirección) | Confirm simple. El nombre del cliente queda en el padrón POINTS hasta el próximo rebuild del HTML |

Útil para limpiar tiendas duplicadas que aparecen post-import SAP (mismo cliente con razón social y fantasía).

### Import desde SAP B1

Botón naranja **📥 Importar desde SAP** abre un sub-modal con drop zone para subir el master de Business Partners exportado de SAP B1 (CSV o XLSX).

### Lógica del import

1. **Parsing tolerante de columnas**:
   - SKU/CardCode: `CardCode`, `Codigo`, `Code`, `ID`.
   - Nombre: `CardName`, `Name`, `Nombre`, `Razon Social`.
   - Dirección: `Address`, `Direccion`, `Street`, `Calle`.
   - Ciudad: `City`, `Ciudad`, `Localidad`.
   - Provincia: `State`, `Province`, `Provincia`.

2. **Matching de 3 niveles** entre `cardName` SAP y `clientName` POINTS:
   - **Exact**: mismo nombre normalizado (uppercase, sin acentos, sin caracteres especiales, sin sufijos `SA`, `SRL`, `SAS`, `EIRL`, `LTDA`).
   - **Fuzzy**: similitud Levenshtein ≥ 0.82 + misma provincia.
   - **Sin match**: se crea como cliente nuevo.

3. **Preview** con stats:
   - Filas en el archivo.
   - Matches exactos (verde) + fuzzy (ámbar) + nuevas (azul).
   - Lista de fuzzy con porcentaje (para verificación manual).
   - Lista de nuevas con CardCode + ciudad.

4. **Apply**:
   - **Matcheadas**: sobrescribe `client_master` con datos SAP (nombre, dirección, localidad). El nombre/localidad originales se guardan como backup en `clientNameOriginal`/`localidadOriginal`. Se agrega al set `contacted` (auto-habilitar).
   - **Nuevas**: se crean como `client_applications` con `status: 'approved'` + `source: 'sap_bulk_import'` + **`ownerUid` populado** (fix de permisos: antes las rules rechazaban escrituras sin owner). El vendor se infiere de la provincia con `inferVendorFromProvince()`. Aparecen al instante en el mapa vía `ensureApprovedAltasListener`.

5. **Batches** de 400 docs (límite Firestore es 500). Si el batch falla, **fallback individual** doc-por-doc con log de errores.

6. **Alert visible al final** con conteo real de tiendas creadas + cuántas quedaron **sin provincia** (para que Admin las complete vía el dropdown del Master).

---

## 24) Modal Zonas (reasignación)

**Admin y gerente** (desde v201+). Botón violeta **🗺️ Zonas** en el header.

> Antes `openZonasModal` bloqueaba a `gerente` con "Solo el administrador puede reasignar zonas". Desde v201+ el guard se removió — las Firestore rules de `vendor_overrides` ya permitían gerente.

### Tabs (4 desde v201+)

1. **Por tienda**: lista de cada tienda con dropdown para cambiar de vendor.
2. **Por localidad**: igual pero a nivel localidad (afecta todas sus tiendas).
3. **Por provincia** (NUEVO en v201+): una fila por provincia con conteo de tiendas + vendor dominante actual.
4. **Historial**: últimos 50 cambios con quién, cuándo, de quién a quién. El historial muestra `scope='prov'` con icono globo 🌎.

### Destinos disponibles

- **Vendedores externos** (VDE): los 4 reales (Mauricio, Martin, Gonzalo, Federico).
- **Vendedores internos** (VDI): Ioannis, Santiago.
- **Otros (admins)**: cargados de Firestore con rol `admin`.
- **DISTRIBUIDOR**: sale de venta directa, aparece solo en filtro Distribuidores.

### Cascada de prioridades (v201+)

Cuando hay overlap entre scopes, se respeta esta cascada (más específico gana):

```
Override localidad   ← más específico
Override provincia   ← nuevo en v201+
PROVINCE_VENDOR_OVERRIDE hardcoded
Vendor original del POINT
```

`applyVendorOverridesToPoints` aplica `scope='prov'` **antes** de `scope='loc'`, así un override de localidad puntual puede sobreescribir al override provincial.

### Persistencia

Colección `vendor_overrides/{docId}` con campo `scope: 'shop' | 'loc' | 'prov'`. Listener `ensureVendorOverridesListener` aplica los cambios en tiempo real:
- **Override de provincia** (nuevo): muta `p.vendor` de todos los POINTS de esa provincia.
- **Override de localidad**: muta `p.vendor` del POINT → automáticamente afecta el filtro, marker color, contadores.
- **Override de tienda**: `getEffectiveVendorForClient(p, name)` lo respeta en `effClients(p)`, `filteredPoints()`, y `deptStyle()` (via `deptEffectiveVendor`).

### Distribuidor en deptStyle

Cuando el vendor mayoritario de un dept es `__DISTRIBUTOR__`, **solo se pinta azul si el filtro Tipo = Distribuidores está activo**. Sino, ignora `__DISTRIBUTOR__` del conteo y usa el segundo vendor mayoritario (o el original del Excel).

### Toast verde con detalle (v203)

Nueva función `showZonasToast(title, items)`: toast **fixed arriba al centro**, gradiente verde, fade in/out, max 560px de ancho, **auto-close 5 seg**.

Se dispara después de:
- `saveZonasChanges` (Save explícito).
- `onZonasSapAltaChange` (instant save al cambiar vendor de un alta SAP).

Mensajes según el `scope` del override aplicado:

| Scope | Texto del item |
|---|---|
| `prov` | `Provincia X → <Vendor>` |
| `loc` | `Localidad X (Provincia) → <Vendor>` |
| `shop` | `Tienda X en Localidad → <Vendor>` |

Si hay más de 5 cambios en el save, el toast muestra los **primeros 5 + "y N más"**.

---

## 25) Integración SAP B1

Dos vías paralelas (no excluyentes):

### Vía 1: ZIP DTW manual (funcional desde 2026-06-19)

Estado: **OPERATIVO** — probado E2E en SHIMANO_TST_06.

#### Cómo funciona

1. Vendedor confirma pedido en la app.
2. Pasa a estado `pending`.
3. Admin (vos) marca el pedido como "Listo para SAP" en el panel Pedidos.
4. Pestaña "Listos" → botón **"Exportar ZIP DTW"**.
5. Se descarga un ZIP con:
   - `OQUT - Documents.csv` (cabecera Sales Quotation).
   - `QUT1 - Document_Lines.csv` (líneas).
   - `_README.txt` con instrucciones.
6. Abrir DTW conectado a SAP B1 base correcta.
7. Import → Transactional Data → Add New Data → Sales → Sales Quotation.
8. Apuntar a los 2 CSV → Next → Next → Run.
9. Verificar en SAP que las Quotations se crearon con serie APP + UDFs poblados.

#### Headers del CSV (formato DTW oficial)

Header fila 1: nombres "user-friendly" (UserSign, DocCur, etc).
Header fila 2: nombres internos SAP (DataSource columns).
A partir de fila 3: datos.

Total: ~180 columnas. Solo poblamos las necesarias:
- `DocNum`, `DocType=dDocument_Items`, `HandWritten=tNO`, `Printed=psNo`.
- `DocDate`, `DocDueDate` (+30 días), `TaxDate`.
- `CardCode` (del mapeo `sap_clients` o `client_master.sapCardCode`).
- `Comments` (`AppShimano | cliente | mes | email`).
- `NumAtCard` (= `_fsId` del pedido en Firestore para trazabilidad legible).
- `SalesPersonCode` (SlpCode del mapeo `sap_vendors`).
- `Series` (id 103 PROD / 104 TEST configurado en `app_config.sap_integration.appSeriesId`).
- `DocObjectCode = '23'` (Sales Quotation — el código numérico, NO el enum string `oQuotations`).
- `U_AppOrigen = 'SHIMANO_APP_VENDEDORES'`.
- `U_AppOrderId = <FSId>`.
- `U_AppBatchId = 'BATCH-YYYYMMDD-HHMMSS-XXXX'` (todos los pedidos del ZIP comparten el BatchId).
- `U_TipoGasto = <condicionPago>` o `'CONDICION'` si no se eligió.
- **Comments extendido con "Forma de entrega"** (v271, v273+): se agrega un sufijo al string base con la info logística que el vendedor cargó en el modal review. Formato:
  - **TRANSPORTISTA**: `| Entrega TRANSPORTISTA: <nombre> - <direccion transportista> | Entrega al cliente: <direccion cliente>`
  - **SUCURSAL**: `| Entrega SUCURSAL: <direccion>`
  - Ejemplo completo: `AppShimano | GUSTAVO BARGELLINI | Junio 2026 | vendedor@shimano.com.ar | Entrega TRANSPORTISTA: Cruz del Sur - Av. Corrientes 1234, CABA | Entrega al cliente: Av. Belgrano 4567, Rio Cuarto`
  - Implementado en `buildEntregaSuffixForRemarks(pedido)` — usado por SL y DTW CSV.
  - Cuando Ezequiel Mendoza (SEIDOR) cree UDFs dedicados (`U_FormaEntrega`, `U_TransportistaNombre`, `U_TransportistaDireccion`, `U_DireccionEntregaCliente`), reemplazar el sufijo por campos separados en el payload y sacar la info del Comments.

Líneas (`QUT1`):
- `ParentKey` = `DocNum` del header.
- `LineNum`, `ItemCode` (mapeo `sap_products`), `Quantity`, `WarehouseCode='07'`.

### Vía 2: Service Layer directo (preparado, esperando bloqueantes)

Estado: **CÓDIGO LISTO** — en espera de CORS + usuario integración.

#### Configuración

Panel admin → SAP → pestaña **🔗 Service Layer**:
- URL: `https://shimano-sap.seidor.com.ar:50000`
- CompanyDB: `SHIMANO_SAU` (PROD)
- Usuario: `APP_VENDEDORES` (a crear con Juan IT)
- Password: a definir
- Toggle: **enabled**

#### Cliente JS (`window.sapSL`)

```js
sapSL.login()                    // POST /b1s/v1/Login
sapSL.ensureSession()             // TTL 25 min
sapSL.fetchWithSession(path, opts) // wrapper con retry 401
sapSL.createQuotation(payload)    // POST /b1s/v1/Quotations
sapSL.getStock(itemCode, whsCode) // GET stock por SKU
sapSL.buildQuotationPayload(pedido) // pedido app → JSON OQUT
```

#### Cómo funciona el envío automático

Cuando el toggle SL está ON, al confirmar un pedido en la app:
1. Se arma el payload JSON con `buildQuotationPayload(pedido)`.
2. Se hace `POST /b1s/v1/Quotations`.
3. SAP devuelve `{DocEntry, DocNum, ...}` con el número real de la Quotation.
4. La app marca el pedido con `transferidoSAP.via = 'service_layer' + docEntry + docNum`.
5. El pedido pasa a estado `sap_imported`.

#### Diagnóstico de errores en "Probar conexión"

- **CORS bloqueado**: "Error de red o CORS" → escalar a Alejandro Caracchi.
- **Credenciales mal**: "HTTP 401" → revisar usuario/pass.
- **CompanyDB incorrecta**: "DB not found" → verificar nombre exacto.
- **Sin licencia**: "User has no permission" → escalar a Juan/SEIDOR.

### UDFs creados en SAP B1

| UDF | Tipo | Campo | Para qué |
|---|---|---|---|
| `U_AppOrigen` | Alphanumeric (30) | Marketing Doc Title | Constante `SHIMANO_APP_VENDEDORES` para filtrar pedidos de la app |
| `U_AppOrderId` | Alphanumeric (30) | Marketing Doc Title | ID Firestore del pedido (28 chars) |
| `U_AppBatchId` | Alphanumeric (40) | Marketing Doc Title | ID del lote de export ZIP |
| `U_TipoGasto` | Alphanumeric (10) | Marketing Doc Title (ya existía) | Condición de pago, default CONDICION |

UDFs aplican a OQUT (Sales Quotation) y ORDR (Sales Order).

### Series APP

- TEST_06: id **104** (autogenerado, rango 2000000-2999999).
- PROD: id **103** (a confirmar por Ezequiel).

Configurada en `app_config/sap_integration.appSeriesId`. Si está vacía, DTW usa serie default del usuario.

### Stock W07

El depósito 07 es el único que la app consulta para el indicador verde/rojo. NUR (operaciones internas) carga stock a W07 cuando llega mercadería.

---

## 26) Stock SAP

### Vía principal: Sync automático Service Layer (v246+)

Estado: **OPERATIVO desde 2026-07-01**.

**Flujo (GitHub Actions cron `13,43 * * * *`, cada 30 min):**

1. `scripts/sync_sap_to_firestore.py` corre en Actions.
2. Lee credenciales del SL desde `app_config/sap_integration.serviceLayer` (Firestore).
3. Login `POST /b1s/v1/Login`, itera `Items?$select=ItemCode,ItemName,ItemWarehouseInfoCollection` paginando via `@odata.nextLink` (SL responde ~20 items por página).
4. Por cada item calcula `stock total = suma de InStock en warehouses vendibles`. **Excluye W05 (Marketing) y W06 (Devoluciones)**. Suma W01/02/03/04/07/10/11/12.
5. **Filtro por Item Group PESCA** (v268+): en vez de filtrar client-side por el CSV inline de `index.html` (que dejaba fuera SKUs nuevos de pesca cargados directo en SAP), ahora se hace `?$filter=ItemsGroupCode eq <PESCA_NUMBER>` server-side. `PESCA_NUMBER` se resuelve dinámicamente vía `/b1s/v1/ItemGroups?$filter=GroupName eq 'PESCA'` (es `102` en SAP). Resultado: 755 items de pesca traídos (antes 665 con SKUs invisibles).
6. **Precios** (v268+): en el mismo query se agrega `ItemPrices` al `$select`. Extrae precio de la **lista PESCA #12 en ARS** (ver constante `PESCA_PRICE_LIST_NUM = 12` en el script) por cada item. Solo se escribe si `Price > 0`.
7. **Cantidades exactas** (v253+): además del `stock: {SKU: bool}` legacy se escribe `quantities: <JSON string>` con la cantidad por SKU. Serializado como STRING porque map con 10k+ keys exedía el límite de 40k index entries de Firestore por doc. El cliente hace `JSON.parse` en el listener.
8. Escribe a Firestore:
   - `product_catalog/chunk_N` (755 items en chunks de 4000)
   - `app_config/product_catalog_meta` (dispara listener)
   - `app_config/stock_snapshot` con `{stock: {SKU: bool}, quantities: "<json string>", warehouse: 'ALL_SALES', ...}`
   - `app_config/price_list` con `{prices: {SKU: number}, currency: 'ARS', priceListNum: 12, priceListName: 'PESCA', ...}`
9. Escribe también `stock.json` en la raíz del repo y hace commit si cambió (consumido por el Google Sheet Inventario-Bot — ver sección específica).
10. Cliente: `ensureStockSnapshotListener`, `ensureProductCatalogListener` y `ensurePriceListListener` reciben los cambios en tiempo real. `PRODUCTS`, `STOCK_MAP`, `STOCK_QUANTITIES` y `PRICE_LIST_MAP` se actualizan en memoria.

**Diferencia clave vs legacy**: antes se usaba W07 (PESCA EEUU, casi siempre vacío) → `withStock: 2`. Ahora `ALL_SALES` → `withStock: ~3459` reales.

**Workflow**: `.github/workflows/sync-sap-catalog-stock.yml`
**Permisos**: `contents: write` (para commitear `stock.json`)
**Cron desfasado** `13,43 * * * *` en vez de `*/30` para evitar throttling GitHub Actions en :00/:30.

### Vía manual: consulta live SKU (modal Master Productos)

Admin puede tocar botón "Consultar stock live" en el modal para un SKU específico → `sapSL.getStock(sku, 'ALL')` hace request directo al SL en el momento (no espera al cron). Muestra desglose por warehouse.

### Vía legacy (deprecada, cron desactivado)

`.github/workflows/sync-stock.yml` + `scripts/sync_stock.py`: leía un CSV que David subía a Drive. Dejó de actualizarse el 2026-06-18 (David dejó de subir el CSV). El schedule está comentado, solo queda `workflow_dispatch` manual como respaldo.

### Vía manual: CSV upload por admin (panel "Stock")

Sigue disponible como fallback pero rara vez se usa (sync automático la cubre). Botón **Stock** en header → drop zone del CSV → publicar. Escribe a `app_config/stock_snapshot` con `source: 'csv_manual'`.

### Precios: fuentes y prioridad (v268+, v270+)

La app resuelve el precio de un SKU consultando **2 fuentes** en orden:

1. **SAP** (`app_config/price_list.prices[SKU]`) — sync automático cada 30 min desde la lista PESCA #12 en ARS. Cuando administración carga un precio nuevo en SAP, aparece en la app en máximo 30 min sin acción manual.
2. **Temporal** (`app_config/price_list_temporal.prices[SKU]`) — fallback cargado por admin/gerente desde el modal Master de Productos para SKUs que aún no tienen precio en SAP.

**Resolución (`getPriceInfo(sku)`):**
- Si SAP tiene el SKU con precio > 0 → `{source: 'sap', price}` (SAP siempre gana)
- Si SAP no lo tiene pero temporal sí → `{source: 'temporal', price}` (fallback)
- Si ninguna fuente lo tiene → `{source: null, price: 0}` → UI muestra "(sin precio)"

**Cuando administración carga el precio real en SAP**, el próximo sync automático lo trae y `PRICE_LIST_MAP` ganará prioridad automáticamente. El precio temporal queda en Firestore pero se ignora (no hay que borrarlo manual).

**UI en Master de Productos (solo admin/gerente):**
- Nuevo checkbox **"Solo sin precio"** → filtra SKUs sin precio SAP NI temporal (lista de trabajo del admin).
- Badge amarillo `⏱ TEMPORAL` al lado del precio cuando la fuente es temporal.
- Botón por SKU:
  - **"💵 Cargar $"** (rojo) — SKU sin precio ninguno
  - **"✎ Editar $"** (amber) — SKU con precio temporal (editar o borrar con 0)
  - **"✎ Temp"** (gris) — SKU con precio SAP (permite cargar temporal pero no se usará)
- Prompt con contexto claro sobre la prioridad SAP > temporal + confirmación antes de escribir.

**Colección Firestore `app_config/price_list_temporal`:**
```
{
  prices: {SKU: number},         // fallback usado por getPriceInfo
  entries: {SKU: {price, by, byName, at}},  // metadata para auditoría
  updatedAt, updatedBy
}
```

Los writes usan dot notation (`prices.{SKU}` y `entries.{SKU}`) con `set/merge` para no pisar otros SKUs. Borrado usa `FieldValue.delete()`. Solo admin/gerente tienen permiso (validado en el cliente + rules).

### Bot Google Sheet "Inventario-Bot"

Sistema paralelo (mantenido por Federico) que lee `stock.json` cada 30 min y llena una columna "STOCK DISPONIBLE" en un Sheet con DISPONIBLE / NO DISPONIBLE / NO ENCONTRADO. **URL que consume**:

```
https://raw.githubusercontent.com/shimano-arg/app-vendedores/main/stock.json
```

(No usa GitHub Pages: los builds Jekyll venían fallando y el CDN cachea 10 min. `raw.githubusercontent` sirve directo del branch, ~30 seg de propagación y sin build.)

El script Apps Script hace `UrlFetchApp.fetch` con `?t=${Date.now()}` para bustear cache. Ver historial de commits para el código completo.

---

## 27) OCR de tickets con Gemini API

### Cómo funciona

1. Vendedor abre Rendiciones → Cargar gasto.
2. Saca foto del ticket.
3. La foto (data URL base64) se manda a Gemini con prompt:
   ```
   Extraé estos datos del ticket en JSON:
   - fecha (ISO YYYY-MM-DD)
   - monto (number, sin símbolos)
   - comercio (string)
   - tipoGasto (Combustible / Peaje / Alojamiento / Comida / Varios)
   Solo devolveme el JSON crudo, sin markdown.
   ```
4. Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=<API_KEY>`.
5. Vendedor verifica y confirma.
6. Se guarda en `rendiciones/{docId}` con la foto + datos.

### API Key

Almacenada en `app_config/gemini.apiKey`. Solo admin edita. Lectura general para que cualquier vendedor pueda OCRizar.

---

## 28) PWA installable

### Manifest

```json
{
  "name": "Shimano Vendedores",
  "short_name": "Shimano",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#dbeafe",
  "theme_color": "#00A9E0",
  "icons": [/* 4 tamaños */]
}
```

### Service Worker

`sw.js` — estrategia:
- **HTML / root**: network-first con fallback a cache.
- **Assets locales** (manifest, iconos, logo, login-bg): cache-first.
- **CDNs** (firebase, leaflet, sheetjs, jszip, OSM tiles): pasan directo a la red.
- **OAuth callbacks Firebase** (URLs con `state=`, `apiKey=`, etc): pasan directo a la red.
- **`stock.json`**: siempre network-first (sin cache) para datos frescos.

Cuando se bumpea `CACHE_VERSION` (cada deploy), el SW viejo borra sus caches y carga los nuevos al reabrir la PWA.

### Instalación

- **Android**: menú navegador → "Agregar a pantalla inicio".
- **iOS**: Safari → Compartir → "Agregar a pantalla inicio".

---

## 29) Backup TOTAL de la app

Botón en **Exportar para Análisis** → tarjeta naranja **"Backup TOTAL"** (solo admin).

### Qué descarga

Un ZIP único con:

#### `/firestore/` — 19 colecciones en JSON

```
roles.json, userData.json, pedidos.json, visits.json, campaigns.json,
notifications.json, client_applications.json, client_master.json,
client_locations.json, vendor_overrides.json, route_overrides.json,
targets.json, rendiciones.json, sap_clients.json, sap_products.json,
sap_vendors.json, app_config.json, allowed_emails.json,
operations_log.json
```

Cada archivo es un array de `{_id, _data}`. Los `Timestamp` se serializan como `{__type__: 'timestamp', iso: '...'}` para reconvertir al restaurar.

#### `/photos/{col}/` — fotos extraídas

```
photos/visits/<visitId>__frente.jpg
photos/visits/<visitId>__espacio_1.jpg ...
photos/client_applications/<id>__arca.jpg
photos/client_applications/<id>__iibb.jpg
photos/client_applications/<id>__local_1.jpg ...
photos/rendiciones/<id>__comprobante_1.jpg
photos/notifications/<id>__image_1.jpg
```

#### `/metadata/info.json`

Resumen estructurado: cantidad de docs por colección, fecha, usuario, errores.

#### `README.txt`

Instrucciones de restauración.

### Frecuencia recomendada

1 vez por mes. Calendarizar el día 1.

### Cómo restaurar

1. Abrir Firebase Console → Firestore → limpiar/crear colecciones.
2. Para cada `/firestore/<col>.json`:
   - Iterar el array.
   - Convertir Timestamps: `Timestamp.fromDate(new Date(iso))` antes de escribir.
   - `await fbDb.collection(col).doc(item._id).set(item._data)`.
3. Las fotos NO se restauran automáticamente — quedan como respaldo visual.

---

## 30) Exports a Excel / Power BI / ML

Botón **Exportar a Excel** (celeste) → 6 opciones:
- **Ventas** (pedidos confirmados del mes).
- **Visitas** (con detalle por tienda).
- **Rendiciones** (gastos del período).
- **Rutas** (con cumplimiento).
- **Altas de clientes** (del período).
- **Clientes (masterfile)**: listado completo de tiendas con zona/vendedor/dirección/estado.

Botón **Exportar para Análisis** (verde) → **visible SOLO para `erbinomariano@gmail.com`** desde v208+ (antes era admin + gerente). 5 opciones avanzadas:
- **Power BI** (fact + dim tables).
- **Python / IA / ML** (tabla larga).
- **Fotos de visitas (ZIP)**.
- **Excel con fotos embebidas**.
- **TARGETS-ZONAS** ← reescrito en v208+. Antes generaba el master full con todas las tiendas POINTS + altas mezcladas; ahora genera **UNA fila por BP vivo en SAP** (solo `client_applications` con `status='approved'` Y `cardCodeSap` no vacío). Excluye POINTS, distribuidores, prospectos y mocks. Columnas: TIPO / NRO CTE / REGION / PROVINCIA / ASESOR EXTERNO / ASESOR INTERNO / CALLE / NUMERO / LOCALIDAD / CP / NOMBRE COMERCIAL / NOMBRE DE FANTASIA / CUIT / CONDICION FISCAL / TELEFONO / **CARDCODE SAP** (columna nueva).
- **Backup TOTAL** ← ZIP con todo.

### Export desde modal Targets (v297+)

Aparte del botón "Exportar para Análisis" (admin only), el modal **Targets mensuales** tiene su propio botón **📊 Exportar Excel** que emite el master de targets en formato largo:

| Columna | Fuente | Notas |
|---|---|---|
| `SlpCode` | `sap_vendors.slpCode` | vacío si el vendedor no está mapeado |
| `Vendedor` | `sap_vendors.slpName` (fallback `titleCase(vendorKey)`) | formato "Gonzalo de la Rosa" |
| `Año` | `targets.year` | number |
| `Mes` | `targets.month + 1` | convertido a 1-12 |
| `Meta` | `targets.targetArs` | redondeado a entero |

Uso operativo: gerente exporta a Excel, ajusta si hace falta, y sube el master a SAP o a Power BI (fuente para la vista de cumplimiento). Ver sección 22 para detalles.

---

## 31) Panel admin "Usuarios"

Tabla con todos los usuarios:

- Email + displayName.
- Rol (dropdown).
- Vendor key (si es VDE).
- Pareja interno (dropdown VDI para VDEs).
- WhatsApp.
- Responsable de rendiciones (dropdown).
- Botón **🔐 Contraseña** (cambiar PIN del usuario).
- Botón **🔐 2FA** (configurar Authenticator).
- Botón **Eliminar** (no disponible para los 2 admins protegidos).
- Botón **Guardar**.

Mobile: layout cards en vez de tabla.

### Sección `allowed_emails`

Arriba de la tabla. Permite pre-autorizar emails antes del primer login.

---

## 32) URLs externas e integraciones

| Servicio | URL | Para qué |
|---|---|---|
| Firebase project | https://console.firebase.google.com/project/app-vendedores-shimano | Console |
| Firebase Auth | (mismo) → Authentication | Manage users |
| Firestore | (mismo) → Firestore Database | Manage data |
| Firestore Rules | (mismo) → Firestore → Rules | Edit security rules |
| GitHub repo | https://github.com/shimano-arg/app-vendedores | Code |
| GitHub Actions | (mismo) → Actions | Workflows |
| GitHub Secrets | (mismo) → Settings → Secrets | `SAP_STOCK_CSV_URL` |
| GitHub Pages | (mismo) → Settings → Pages | Deploy URL |
| Gemini API | https://generativelanguage.googleapis.com | OCR de tickets |
| OSM Nominatim | https://nominatim.openstreetmap.org | Geocoding |
| **SAP Service Layer** | **https://shimano-sap.seidor.com.ar:50000** | **API REST SAP B1** |
| SEIDOR Freshdesk | https://seidorb1arg.freshdesk.com | Tickets de soporte |
| **SharePoint team SAR** | **https://teamshimano.sharepoint.com/teams/SLA_int_00002** | **Lista "ANTICIPO Y RENDICION DE GASTO"** (Admin/Finanzas) |
| Power Automate | https://make.powerautomate.com | Flow "Cargar rendiciones aprobadas a SharePoint" (cuenta `mariano.erbino@shimano.com.ar`). **Trial Premium 90 días activo desde 2026-06-30** (HTTP connector) |
| Firebase Storage | https://console.firebase.google.com/project/app-vendedores-shimano/storage | Bucket `<project>.firebasestorage.app/rendiciones-tickets/` (requiere plan Blaze). **Inicializado 2026-06-30** |
| BigQuery | https://console.cloud.google.com/bigquery?project=app-vendedores-shimano | Dataset `shimano_app` (us-central1). **Creado 2026-06-30** — destino del pipeline `firestore-bigquery-export` (ver `PLAN_POWERBI.md`) |
| Power BI Service | https://app.powerbi.com | Workspace "Shimano Vendedores" (en armado). Viewers: Mariano (admin), Diego Valsi, Santiago Beron, Pablo + Ioannis (emails pendientes) |

---

## 33) Convenciones de código

### Estilo
- Indentación: 2 espacios.
- Strings: single quotes en JS, double en Python.
- Comentarios técnicos en castellano.
- Variables descriptivas (no `x`, `tmp`).

### Naming
- camelCase en JS.
- snake_case en Python.
- SCREAMING_SNAKE para constantes.
- Funciones helper privadas con prefijo `_`.

### `var` vs `let` para variables globales del bootstrap
Las variables que pueden ser consultadas por funciones que corren en el bootstrap inicial (antes de que se declaren con `let`) deben usar `var` para evitar TDZ. Ejemplos:
```js
var userRole = null;
var assignedVendor = null;
var vendorOverrides = {};
var approvedAltasByLoc = {};
```

### Defensive coding
Las helpers que pueden ser llamadas antes del bootstrap completo (ej. `getEffectiveVendorForClient`) chequean `typeof functionName === 'function'` antes de invocarlas para evitar ReferenceError.

### Banner de versión + chequeo HTML vs SW

Al arrancar la app, en console se imprime:
- `Shimano App v217 — <timestamp ISO>` (banner con styled console.log).
- **Chequeo de sync**: fetcheaq `sw.js`, parsea su `CACHE_VERSION` y compara con `APP_VERSION` del HTML.
  - Si coinciden: `[version] HTML v217 === SW v217 OK` en verde.
  - Si difieren: `[version] DESYNC: HTML=v217 vs SW=v216 - tocar ↻ en el mapa para refrescar` en rojo.

`APP_VERSION` se exporta en `window.APP_VERSION` para que se pueda consultar desde la consola. **Bumpear las dos constantes (HTML + SW) en cada release.**

### CSS
- Clases con prefijo por sección: `.mc-*` (Master Clientes), `.bk-*` (Backup), `.sl-*` (Service Layer), `.zonas-*` (Zonas), `.stock-*` (Stock).
- Colores: usar la paleta Shimano (`#00A9E0` celeste, `#003366` azul marino, `#E83A2E` rojo, `#F97316` naranja, `#8E44AD` violeta, `#F39C12` amarillo) o Tailwind (`#1e3a8a` blue-900, `#166534` green-800, etc.).

---

## 34) Regenerar y deployar

### Workflow estándar

```bash
# 1. Editar el build script
# C:/Users/shimano.sandbox/Desktop/MASTERFILES/PROSPECTOS/MAPAS/_build_argentina_zonas_v2.py

# 2. Generar HTML
cd "C:/Users/shimano.sandbox/Desktop/MASTERFILES/PROSPECTOS/MAPAS"
python -c "import sys; sys.stdout.reconfigure(encoding='utf-8'); exec(open(r'_build_argentina_zonas_v2.py', encoding='utf-8').read())"

# 3. Copiar al repo
cp "C:/Users/shimano.sandbox/Desktop/MASTERFILES/PROSPECTOS/MAPAS/Mapa_Argentina_Shimano_Zonas.html" \
   "C:/Users/shimano.sandbox/Desktop/APP VENDEDORES/index.html"

# 4. Bumpear AMBAS versiones (deben quedar sincronizadas):
#    - index.html: const APP_VERSION = 'vXX' → 'vYY'
#    - sw.js:      const CACHE_VERSION = 'vXX' → 'vYY'
#    Si quedan desincronizadas, el banner en console marca DESYNC.

# 5. Commit y push
cd "C:/Users/shimano.sandbox/Desktop/APP VENDEDORES"
git pull --rebase --autostash
git add index.html sw.js
git commit -m "Mensaje claro del cambio"
git push
```

### Tiempo de propagación

- Commit → GitHub Pages: 1-5 min.
- GitHub Pages → cache de usuarios: instantáneo al cerrar/abrir PWA o Ctrl+Shift+R.

### Bumpear SW

**SIEMPRE** bumpear `CACHE_VERSION` en `sw.js` Y `APP_VERSION` en `index.html` cuando hay cambios en HTML/JS/CSS. Sino el SW viejo sirve el HTML cacheado y los usuarios no ven el cambio. El banner en console marca DESYNC si se olvida una de las dos.

### Forzar refresh desde el mapa

Para usuarios que ven la app cacheada y no quieren cerrar la PWA: tocar el botón **↻ "Forzar actualización"** en el topleft del mapa (debajo del zoom). Hace `unregister()` del SW, limpia caches y recarga con cache-bust.

---

## 35) Troubleshooting

### "Cargando sesión..." infinito al abrir la app

**Causa probable**: error JS en el bootstrap (TDZ con `let`, función llamada antes de declararse).

**Fix**:
1. F12 → Console → leer el error.
2. Si dice "Cannot access 'X' before initialization" → cambiar `let X` por `var X`.
3. Sino, buscar el error y aplicar el fix correspondiente.

Histórico: este bug pasó 3 veces con `userRole`, `vendorOverrides`, `approvedAltasByLoc`. Todos fueron arreglados con `let → var`.

### Cambios no aparecen después de deploy

**Causa**: cache del SW.

**Fix**:
1. Esperar 5 min (propagación Pages).
2. PC: F12 → Application → Service Workers → Unregister + Storage → Clear site data + Ctrl+Shift+R.
3. Mobile: cerrar PWA del switcher + desinstalar + reinstalar.

### Firestore "Missing or insufficient permissions"

**Causa**: colección sin regla de seguridad o regla mal escrita.

**Fix**: Firebase Console → Firestore → Rules → agregar la regla. Estructura tipo:
```
match /coleccion/{docId} {
  allow read: if isReader();
  allow write: if isAdmin();
}
```

### DTW falla en import: "X is not valid value for property"

**Causa**: el CSV tiene un valor enum string en lugar del código numérico.

Conocidos:
- `DocObjectCode = 'oQuotations'` → debe ser `'23'`.

### Service Layer falla: "Error de red o CORS"

**Causa**: el server Apache no tiene los headers CORS.

**Fix**: escalar a Alejandro Caracchi (SEIDOR) para que habilite (ver sección 25).

### Stock no aparece

**Causa**: `app_config/stock_snapshot` está vacío.

**Fix**: admin sube un CSV nuevo desde el panel Stock.

### "Pedile al admin que te configure el 2FA"

**Causa**: el rol del usuario requiere 2FA pero no está configurado.

**Fix**: admin entra al panel Usuarios → botón 🔐 2FA del usuario → escanea QR con Authenticator → ingresa código → activado.

### El usuario olvidó su contraseña (login Email/contraseña)

**Fix**: admin entra al panel Usuarios → botón 🔐 Contraseña → opción **"Mandar mail de reset"** → Firebase manda link de reset al email del usuario.

### Magic link no llega

**Causa**: el email del usuario terminó en spam, o el dominio del email no está en la whitelist de Firebase Auth.

**Fix**: chequear spam primero. Si no llega, ir a Firebase Console → Authentication → Settings → Authorized domains.

### El gerente no ve todo el mapa

**Causa**: `getMyAllowedVendorKeys()` no contemplaba el rol `gerente` (fix en v182+).

**Fix**: actualizar a v182+ o asegurarse que la rama `if (rol === 'admin' || rol === 'gerente' || rol === 'viewer') return null` esté presente.

### El badge ADMIN se ve corrido del centro

**Causa**: alguien volvió a poner `badge.style.display = 'inline-block'`.

**Fix**: cambiar a `'flex'` para que `align-items: center` + `justify-content: center` apliquen.

### Polígonos de Tucumán/etc. pintados de un vendedor que ya no es

**Causa**: hay un override en `vendor_overrides` que afecta el dept.

**Fix**: modal Zonas → tab Historial → revisar y revertir si fue erróneo. O mejor: ajustar la lógica de `deptEffectiveVendor` para tratar mejor el caso.

---

## 36) Ciberseguridad y hardening

### Capas de seguridad

1. **Firebase Auth**: Google OAuth → tokens JWT con expiración.
2. **Password gate**: PIN de 4 dígitos después del OAuth (configurado por admin).
3. **2FA TOTP**: opcional pero recomendado para admin.
4. **Firestore Rules**: validación server-side de TODA escritura.
5. **AppCheck reCAPTCHA v3**: protege contra abuso de API. Lazy-load post-login.
6. **CSP** (Content Security Policy): limita los dominios desde donde se cargan scripts/imagenes/conexiones.
7. **SW**: intercepta callbacks OAuth para no romper Firebase Auth.

### CSP actual

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval'
  https://www.gstatic.com https://www.google.com https://*.google.com
  https://apis.google.com https://www.googletagmanager.com
  https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com
  https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com
  https://*.recaptcha.net https://recaptcha.net;
connect-src 'self' https://*.googleapis.com https://*.firebaseio.com
  https://*.firebaseapp.com https://generativelanguage.googleapis.com
  https://www.google.com https://*.google.com https://apis.google.com
  https://*.gstatic.com https://*.recaptcha.net https://recaptcha.net
  https://nominatim.openstreetmap.org
  wss://*.firebaseio.com wss://*.googleapis.com;
... etc.
```

> Cuando esté Service Layer activo, agregar `https://shimano-sap.seidor.com.ar:50000` a `connect-src`.

### Audit log

Colección `operations_log` registra acciones críticas (no editable después de creada). Solo admin/viewer leen.

### Acciones protegidas

Los 2 admins iniciales (`bot.shimano.pesca@gmail.com` y `erbinomariano@gmail.com`) tienen `protectedAdmin: true` → no se pueden eliminar desde el panel Usuarios.

### Secrets

- **API Keys** (Gemini): en `app_config/gemini` (solo admin lee/escribe). Eventualmente migrar a Firebase Functions con env vars.
- **Service Layer password**: en `app_config/sap_integration.serviceLayer.password`. Solo admin lee/escribe vía Firestore rules. Mejor a futuro: variable de entorno de Cloud Function.

---

## 37) Contactos clave

### SEIDOR (consultora SAP)

| Persona | Rol | Contacto |
|---|---|---|
| **Eliana Morgan** | Consultora SAP — punto de entrada inicial | (delegó en Ezequiel) |
| **Ezequiel Mendoza** | Consultor proyecto Integración App | `serviciosalcliente@seidorb1arg.freshdesk.com` (Ticket #105768) |
| **Alejandro Caracchi** | Analista Infraestructura TI — CORS + Service Layer | `serviciosalcliente@seidorb1arg.freshdesk.com` (Ticket #105771) |

### Shimano Argentina

| Persona | Rol | Para qué |
|---|---|---|
| **Juan** | IT | Crear usuarios SAP, manejar infra |
| **Santiago Esteban** | VDI | Aprobar Quotations manualmente, copia a Sales Order |
| **David Daiub** | Funcional SAP | Consulta funcional (ya no es bloqueante) |
| **NUR (operaciones)** | Almacén | Cargar stock W07 cuando llega mercadería |
| **Fernando Gamboa** | Admin & Finanzas (team SAR) | Recibe rendiciones aprobadas en la lista SharePoint vía Power Automate |

---

## 38) Roadmap / pendientes

### Sprint actual

- [ ] Esperar respuesta de Ezequiel sobre UDFs + Serie 103 en PROD.
- [ ] Esperar respuesta de Alejandro sobre CORS.
- [ ] Esperar respuesta de Juan sobre usuario integración.
- [ ] Cuando estén los 3 → pasos 1-11 del archivo `LANZAMIENTO-APP-FALTANTES.txt`.

### Próximo sprint

- [ ] **Cablear `enviarPedidosASAPViaServiceLayer` a un botón**: la función ya existe en `index.html` pero hoy no se llama desde ninguna parte de la UI. Cuando los 3 bloqueantes externos estén resueltos, agregar un botón "Enviar a SAP por Service Layer" en la pestaña de Pedidos Pendientes/Confirmados.
- [ ] Documentación operativa para vendedores (manual de uso).
- [ ] Capacitación de los 6 vendedores en la app.
- [ ] Definir ritmo de revisión de Quotations con Santiago (1x día recomendado).
- [ ] Migrar API keys / passwords a variables de entorno con Cloud Functions.
- [ ] Restauración automatizada del backup (script Node.js que lee el ZIP).
- [ ] Telemetría de uso (qué pestañas se abren más, latencias).

### Hecho recientemente (✅)

**Sesión completa 2026-07-14 (v298 → v301 + BigQuery + PDFs):**

*Documentos de referencia generados:*
- [X] **`APP SHIMANO MANUAL.pdf`** (33 pág) — Manual técnico completo pensado para sucesor. Cubre negocio, arquitectura, Firebase, GitHub, SAP, BQ, Power BI, cron jobs, modelo de datos, roles, scripts, costos, contactos, runbook, roadmap y glosario. Generador en `scripts/build_manual_shimano.py`.
- [X] **`MEJORAS.pdf`** (21 pág) — Análisis crítico del estado actual con 12 puntos débiles priorizados (severidad + esfuerzo + impacto + evidencia + solución) + roadmap por horizontes (Sprint 1 dos semanas, Sprint 2 un mes, Q1 tres meses, S1 seis meses). Incluye anexo de 5 bugs reales con commit hash + deuda técnica cuantificada. Generador en `scripts/build_mejoras_shimano.py`.

*Cambios frontend (v298 → v301):*
- [X] **v298 - Gerente ve todas las visitas** (pedido de Pablo por Teams) — fix client-side de 2 líneas, Firestore Rules ya lo permitía.
- [X] **v299 - Form Visita simplificado** (pedido vendedores): buscar directo por tienda, localidad se autocompleta con badge celeste "📍 Localidad detectada".
- [X] **v300 - Buscador de tienda matchea por fantasía O titular** — label ahora `"Fantasía (Titular) — Loc, Prov"`.
- [X] **v301 - Modal pedido PENDIENTE con vista previa** — layout 2 columnas: sugeridos | pedido ya cargado. Read-only.

*Datos y pipeline (BigQuery + Firestore + Power BI):*
- [X] **Suscripción diaria de Power BI por email a Mariano** (`Desempeño diario de ventas SAR - PESCA` @ 15:00 AR, con miniatura + PDF adjunto). Refresh programado 14:30 previo.
- [X] **Publish del `.pbix` a Power BI Service** (workspace de Mariano). Dataset y reporte "TABLERO SAR" operativos.
- [X] **Pipeline `v_targets` end-to-end**: sync Firestore → BQ + vista con SlpCode traducido (mapeo hardcoded 50-55).
- [X] **`v_facturas_sap` sin `lines_json`**: fix crítico que destrabó el freeze de Power BI Desktop (VertiPaq explotaba con el JSON string gigante).
- [X] **Rollback completo del intento "gap huérfano"** en `v_backorder_lineas`: `v_sap_items_enriched` vuelve al schema pre-fix. Reintroducir cuando la máquina del user tenga más RAM o migre a Power BI Service.
- [X] **`sync_sap_to_bigquery.py` con nuevo paso 7 (targets)**: se ejecuta cada 30 min junto al resto del pipeline SAP.
- [X] **Auditoría SlpCode contra SAP prod** vía `/SalesPersons`: confirmado que 50-55 aún no existen en `SHIMANO_SAU`, pendiente que SEIDOR los cree como parte del lanzamiento.

*Bulk imports desde Excel del formulario + fixes del sync SAP:*
- [X] **Bulk import de 103 nombres de fantasía** desde Excel del formulario, match por CUIT + fix del cron `sync_sap_to_firestore.py` que las pisaba cada 30 min. Ejemplo: "GABRIEL ALEJANDRO YAMIN" ahora aparece como "ARMERIA EL COLORADO".
- [X] **Bulk fix de 22 provincias mal cargadas** (bug SAP prod: YAMIN CHUBUT→SALTA, TOMPY CHUBUT→SALTA, etc.) con validación de lista canónica de 24 provincias AR + CABA. Sync extendido para respetar `provinciaLocSource != 'sap_sync'`.

**v290 → v297 (2026-07-13):**
- [X] **Export Excel de Targets en formato largo** (SlpCode/Vendedor/Año/Mes/Meta) desde el modal Targets (v297).
- [X] **Botón "👤 Provisorios"** violeta en Master Clientes para filtrar altas rápidas pendientes de SAP (v290).
- [X] **Autosave debounced 900ms** en localidad/provincia/dirección de filas SAP (v291) + listener no re-renderea si hay saves en vuelo.
- [X] **Fix crítico sync SAP** — `sync_sap_to_firestore.py` ya NO pisa localidad/provincia con vacío si SAP no trae valor (v291).
- [X] **KPI PENDIENTES header = badge Provisorios Master Clientes** (v292) — ambos usan `getProvisoriosList()`.
- [X] **Fix tab NO CONFIRMADOS** mostraba 3 items cuando el KPI decía 16 (v293) — provisorios sin provincia + con geo+addr ahora pasan siempre el filtro pendientes.
- [X] **CUIT opcional en Alta Rápida** para habilitar match automático confiable con SAP (v294).
- [X] **Botón "🔗 Vincular con SAP"** (admin only) en Master Clientes → Provisorios: modal con auto-ranking por CUIT match + batch set del cardCodeSap + delete del BP SAP duplicado (v294).
- [X] **Badge Categoría (Cat P/A/B/C) fijo en esquina** de cards CLIENTES/PEDIDOS (v295).
- [X] **Fix ortografía "MOSTRADO" → "MOSTRADOR"** en form de visita + Excel exports (v296, reporte vendedor). Value en DB se preserva.

**v218 → v289 (2026-06 a 2026-07-12):**
- [X] **Stock auto-sync vía GitHub Actions** (`sync-stock.yml` corre cada 30 min, funcionando como sistema legacy + el upload manual del panel admin Stock).
- [X] Banner versión + chequeo HTML vs SW en console.
- [X] Botón "Forzar actualización" + "Reubicar pines" + "REFRESCAR APP" mobile.
- [X] **Sidebar Localidades** suma altas SAP + modal localidad con detalle de tiendas y direcciones (v198+).
- [X] Burbujas agregadas del mapa OFF por flag (v199+).
- [X] Master Clientes: botón Eliminar 🗑 por fila (SAP altas + POINTS legacy) — admin/gerente (v200+).
- [X] Modal Zonas: gerente puede reasignar + scope "Por provincia" + toast verde de confirmación (v201/v203).
- [X] **Mail Rendiciones cron Lun/Mie 9am AR** con Excel (Tablas nombradas TablaGastos/TablaSolicitudes) + hyperlink Firebase Storage para fotos de ticket (v202+).
- [X] **Integración SharePoint + Power Automate** end-to-end: el flow carga rendiciones aprobadas a la lista del team SAR (v203).
- [X] Gerente: `canWrite()` + apertura de CAMPAÑAS/SAP + lee todos los pedidos + edita rutas del mes (v205/v208/v214/v215).
- [X] Card precaución más visible: amber-200 + franja marrón izquierda 5px (v206).
- [X] Progreso de campañas GLOBAL sobre el scope, no aporte propio (v207).
- [X] TARGETS-ZONAS solo BPs vivos con CardCode SAP + "Exportar para Análisis" restringido a Mariano (v208).
- [X] **SEGUIMIENTO** — panel comercial completo (v209–v212).
- [X] Botón Recalcular contornos de zonas (v213).
- [X] Tildar pedido bloqueado en SAP — fix cleanup (v216).
- [X] **Rendiciones v2** — TablaGastos agrupada por dupla + hoja Detalle + fotos pre-subidas + bucket `.firebasestorage.app` (v217).
- [X] **Sync automático SAP → Firestore + stock.json cada 30 min via GitHub Actions** (v246).
- [X] **Sync BPs pesca de SAP → app** cada 30 min (v282-v288) — U_DIVISION filter fix.
- [X] **Sync SAP → BigQuery** — 4 tablas raw (`sap_bp_raw`, `sap_items_raw`, `sap_invoices_raw`, `sap_quotations_raw`) via `sync_sap_to_bigquery.py` (v282+).
- [X] **Vistas BigQuery curadas** — `v_pedidos_header`, `v_pedidos_lines`, `v_visitas`, `v_facturas_sap`, `v_ventas_lineas`, `v_backorder_lineas` (v282-v289).
- [X] **Power BI Desktop conectado** al dataset `shimano_app` con 12+ medidas DAX + dashboard "Resumen-Desempeño" en armado (v282+).
- [X] **Firebase Storage** inicializado + **plan Blaze** activo + **BigQuery dataset** creado + **Power Automate Premium trial** (2026-06-30).

### Costos / infraestructura externa

| Servicio | Plan | Costo estimado | Estado |
|---|---|---|---|
| **Firebase** (Auth + Firestore + Storage + Extensions) | **Blaze** (pay-as-you-go) | ~5 USD/mes (free tier cubre la mayor parte) | Activo |
| **BigQuery** | Free tier | ~0 USD/mes (queries < 1 TB/mes, storage < 10 GB) | Dataset `shimano_app` creado |
| **Power Automate Premium** | Trial 90 días → licencia | ~15 USD/mes/usuario después del trial | Trial activo (Mariano) |
| **Power BI Pro** | Por usuario | ~10 USD/mes × 5 viewers = 50 USD/mes | Workspace en armado |
| **GCP** (BigQuery export storage) | Pago por uso | ~5 USD/mes | Activo |
| Gmail App Password (`bot.shimano.pesca`) | Free | 0 USD | Activo |
| GitHub (repo + Actions) | Free | 0 USD | Activo |
| **Total estimado** | | **~89 USD/mes** | |

Budget alert configurado a **25 USD/mes** en GCP (alertas a `mariano.erbino@shimano.com.ar` al 50/90/100%). Confirmado por Diego — cargo a tarjeta corporativa.

### Mejoras futuras

- [ ] Migrar de password Firestore a Cloud KMS para credenciales SAP.
- [ ] Modo offline real (cola de pedidos cuando no hay red, sync al volver).
- [ ] Notificaciones push nativas via FCM.
- [ ] Webhooks SAP → app: cuando Santiago copia Quotation a SO, la app se entera y refleja el cambio.
- [ ] Heatmap de visitas en el mapa.
- [ ] Filtro por fecha en el dashboard.
- [ ] Comparativa de targets vs facturación real con gráficos.

### Cosas que NO se van a hacer (decisión explícita)

- **Middleware intermedio**: descartado el 2026-06-19. Service Layer directo es suficiente.
- **Approval Procedure sobre OQUT**: descartado el 2026-06-19. Santiago revisa manual.
- **Migrar a React/Vue/Angular**: no aporta valor proporcional al esfuerzo. La app es manejable como vanilla.
- **Backend Node/Python propio**: Firestore Rules + Cloud Functions cuando necesitemos sólo lo justo.

---

## 39) Seguimiento (panel VDIs)

**Nuevo bloque grande introducido entre v209 y v212**. Es el panel de gestión comercial diaria, pensado originalmente para **vendedores internos** (Santiago Esteban e Ioannis Palkoudakis) y extendido a admin/gerente para que vean todo el equipo.

### Botón en el header

Botón **"Seguimiento"** teal al lado de "Exportar a Excel". Visible cuando `canViewSeguimiento()` devuelve `true`:

```js
function canViewSeguimiento(){
  if (userRole === 'admin' || userRole === 'gerente') return true;
  if (userRole === 'interno') return true;
  return false;
}
```

Vendedores externos (VDEs) y viewer NO ven el botón. El check se replica del lado JS en cada render (no es solo CSS) y los listeners de `visits` / `pedidos` re-validan el scope antes de pintar para que no se pueda forzar acceso con devtools.

### Mapping interno → externo (`myExternalPartners`)

El conjunto de VDEs que un VDI puede gestionar viene de `loadMyExternalPartners()` — listener sobre `/roles` con `where internalPartnerUid == currentUser.uid`. Es **configurable desde el panel Usuarios**, sin hardcodear nombres en el código:

```js
function getSeguimientoExternalSet(){
  if (userRole === 'admin' || userRole === 'gerente') {
    // Fallback: arma el set desde VENDOR_INCLUDES_OTHERS (constante existente).
    const all = new Set();
    Object.values(VENDOR_INCLUDES_OTHERS).forEach(arr => arr.forEach(v => all.add(v)));
    return all;
  }
  if (userRole === 'interno') {
    return new Set((myExternalPartners || []).map(p => p.vendor).filter(Boolean));
  }
  return new Set();
}

function vendorInSeguimientoScope(vendorKey){
  return !!vendorKey && getSeguimientoExternalSet().has(vendorKey);
}
```

### Modal — barra de filtros + 8 stats cards + 7 tabs

**Filtros** (arriba del modal):
- **Vendedor** (dropdown de VDEs del scope).
- **Fechas** (default últimos 90 días).
- **Cliente** (búsqueda libre).
- **Estado** (verde / amarillo / rojo).
- **Solo pendientes / oportunidades** (checkbox).
- Botón **APLICAR** centrado en su propia fila (v217, antes estaba en el flex de filtros y rompía el layout).

**Stats cards** (8 contadores: visitas, pedidos, facturación, conversión visita→pedido, clientes únicos, etc.) que recalculan según filtros.

**Tabs** (7):

| Tab | Qué muestra | Acciones por fila |
|---|---|---|
| **Resumen** | 1 card por VDE con visitas / pedidos / facturación / conversión / clientes únicos | Click abre Timeline del VDE |
| **Visitas** | Lista filtrable de visitas | Click → Timeline cliente. Botón **Borrar** (admin/gerente) → delete en `/visits` |
| **Pedidos** | Lista filtrable de pedidos | Botón **Borrar** (admin/gerente) → delete en `/pedidos` (útil para limpiar pedidos TEST) |
| **Pendientes** | Heurística auto-detección: visitado sin pedido > 7 días (amarillo) o > 14 días (rojo); pedido pending > 5 días (rojo) | Borrar pedido (si origen `pending`) o marcar resuelto en `seguimiento_status` (si origen `visit_no_order`) |
| **Sin movimiento** | Sin visita > 30 días Y sin pedido > 45 días. **Critical** si facturación > 100k ARS y > 60 días | Timeline cliente |
| **Oportunidades** | Visitas cuyos `comentarios` contienen keywords (interés en producto, posible cambio de marca, etc.) | Timeline cliente |
| **Métricas duplas** | Conversión visita→pedido por dupla VDI/VDE | — |

### Timeline cliente

Click en cualquier fila de Visitas/Pedidos/Pendientes/etc. abre un modal **Timeline del cliente** con:
- Lista cronológica ordenada de **visitas + pedidos + notas internas**.
- Botones de estado: **pendiente / revisado / resuelto** (escriben a `seguimiento_status`).
- Form para agregar **nota interna** (escribe a `seguimiento_notes`).

### Colecciones Firestore nuevas

- `seguimiento_notes` — notas internas (texto + autor + clientKey + vendorExt).
- `seguimiento_status` — estado de items pendientes/oportunidades (pendiente/revisado/resuelto).

Ver schema completo en sección 8.

### Rules nuevas requeridas

Las dos colecciones requieren rules con helper `isSeguimientoUser()` (admin/gerente/interno). Ya están aplicadas en Firebase Console (Mariano las pegó el día del lanzamiento de v209). Si se hace un reset de rules, **hay que volver a aplicarlas** o el modal abre pero no puede escribir notas/estados.

---

## 40) Power BI / BigQuery

**Estado a 2026-07-23**:
- ✅ **Fase 1.1** Firestore → BigQuery (7 collecciones + backfill)
- ✅ **Fase 1.2** SAP → BigQuery (6 tablas raw: BPs, Items, Invoices, Quotations, Orders, PO)
- ✅ **Fase 2** Modelo de datos: **14 vistas SQL curadas** (9 base + 3 deuda 2026-07-20 + 2 rendiciones 2026-07-22)
- ✅ **Fase 3** Power BI Desktop → Service: **TABLERO SAR publicado en `Mi área de trabajo`**. Modelo con 12 vistas + `sap_items_raw` + `Vendedores` + `Origenes` + `Medidas` + `Date`. Páginas operativas: Desempeño-Pesca, Ventas, Pedidos, Visitas, **Facturación por Vendedor** (con Cobrado + Deuda), Backorder, Inventario.
- ✅ **Fase 3.5** Distribución automática: **suscripción diaria a Mariano** ("Desempeño diario de ventas SAR - PESCA") @15:00 AR + refresh programado @14:30. Ver subsección abajo.
- ✅ **Fase 3.6 (2026-07-21)** Deuda por vendedor de la app: 3 vistas + cards Cobrado/Deuda en hoja Facturación por Vendedor. Ver subsección "Vistas de deuda" abajo.
- ⏳ **Fase 4** Alertas: pendiente

### Vistas de deuda por vendedor (2026-07-20/21) — NUEVO

Pedido de Pablo por Teams: *"quiero ver cuánto lleva facturado cada vendedor, por el tema del target también, y si tiene pedidos pendientes de pagar por ejemplo"*.

**3 vistas nuevas en `bigquery/views.sql`**:

| Vista | Granularidad | Uso PBI |
|---|---|---|
| `v_deuda_por_vendedor` | 1 fila por `assigned_vendor` | Card/tabla resumen: total facturas pendientes, deuda total, vencida, al día, próxima fecha vencimiento |
| `v_deuda_facturas_detalle` | 1 fila por factura abierta | Drill-down: cliente, doc_num, días vencido, saldo, estado (VENCIDA/AL DIA) |
| `v_facturado_cobrado_deuda_por_vendedor` | 1 fila por (vendedor, año, mes) | Serie temporal: facturado + cobrado + deuda por mes. Verifica: facturado = cobrado + deuda ± redondeo |

**Agrupan por `assignedVendor` de la app** (no `SalesPersonCode` de SAP) porque SAP prod aún tiene facturas históricas con SlpCodes 1-19 / 23-34 (era Baraldo). Los códigos 50-55 se están adoptando pero parcialmente. Filtro implícito: solo los 6 vendedores pesca (`GONZALO DE LA ROSA`, `MAURICIO GIL`, `IOANNIS PALKOUDAKIS`, `SANTIAGO ESTEBAN`, `FEDERICO CASTELANELLI`, `MARTIN BOIERO`).

**Deuda actual Julio 2026** (verificado 2026-07-21):
- Gonzalo: $33.6M (1 factura — REBORN SRL / Xplora La Triestina)
- Federico: $6.4M (2 facturas)
- Martin: $2.4M (1 factura)
- **Total: $42.4M en 4 facturas abiertas** (todas AL DIA, ninguna vencida al 2026-07-21)

**Facturado Julio 2026** por vendedor (facturado = cobrado + deuda):
- Gonzalo: $80.4M | cobrado $46.7M | deuda $33.6M
- Federico: $32.0M | cobrado $25.6M | deuda $6.4M
- Santiago: $23.2M | cobrado 100% | deuda $0
- Martin: $11.9M | cobrado $9.5M | deuda $2.4M
- Mauricio: $5.9M | cobrado 100% | deuda $0
- Ioannis: $2.9M | cobrado 100% | deuda $0

### Fix `paid_to_date` en `sap_invoices_raw` (2026-07-21)

**Bug detectado**: el sync grande `sync_sap_to_bigquery.py` usa `autodetect=True` sin schema explícito. Como `paid_to_date` viene null para la mayoría de facturas cerradas antiguas, autodetect dropea la columna. Resultado: las 3 vistas de deuda tiraban `Name paid_to_date not found inside inv` en BigQuery.

**Fix aplicado en 2 partes**:

1. **`sync_sap_to_bigquery.py`** — agrega `PaidToDate` al `$select` de Invoices (líneas 690-694). Cotizaciones/Ordenes/PO no lo llevan (no aplica).
2. **`scripts/patch_paid_to_date.py`** — one-off que agrega la columna manualmente via `ALTER TABLE ADD COLUMN paid_to_date FLOAT64` + staging table con schema explícito + `UPDATE ... FROM staging` (evita tocar `lines_json`). Idempotente, se puede correr las veces que sea.

**Cuando volver a correr `patch_paid_to_date.py`**: si `sap_invoices_raw` pierde la columna `paid_to_date` (típicamente si alguien corre un sync ligero con schema viejo). Comando:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
python scripts/patch_paid_to_date.py
```

### Cards Cobrado + Deuda en hoja "Facturación por Vendedor" (2026-07-21)

Nuevas medidas DAX pedidas por Pablo:

```dax
Cobrado ARS = 
CALCULATE(
    SUM('v_ventas_lineas'[cobrado_prorrateado_ars]),
    'v_ventas_lineas'[is_pesca] = TRUE
)

Deuda ARS = 
CALCULATE(
    SUM('v_ventas_lineas'[deuda_prorrateada_ars]),
    'v_ventas_lineas'[is_pesca] = TRUE
)
```

Usan **prorrateo por línea** (v_ventas_lineas tiene ahora `cobrado_prorrateado_ars` + `deuda_prorrateada_ars`) para que **[Cobrado ARS] + [Deuda ARS] = [Facturación Total]** exactamente. Julio 2026: $100.2M cobrado + $40.6M deuda = $140.8M facturado ✓.

### Fix estructural del slicer de vendedor: `assigned_vendor` (2026-07-22)

**Problema raíz**: SAP tiene decenas de facturas cargadas con **SlpCodes históricos** (49 = Mariano admin, 34, 23, 11) para clientes que en la app están asignados a otros vendedores. El slicer del TABLERO SAR (que usaba `sales_person_code_invoice` como llave) mostraba tiendas bajo el vendedor equivocado.

**Ejemplo confirmado**: FATECHI (Presi Store, Río Tercero, Córdoba). App: `assignedVendor="MARTIN BOIERO"`. SAP factura #18216 Julio 2026: `SlpCode=54` (Federico). El TABLERO SAR la mostraba bajo Federico.

**Fix**: agregar campo `assigned_vendor` (STRING, tomado del app vía LEFT JOIN a `client_applications`) en **`v_facturas_sap`** y **`v_ventas_lineas`**. En Power BI se relacionó `Vendedores[VendorKey]` (columna calculada `UPPER([Nombre])`) → `assigned_vendor` en lugar de la relación por SlpCode.

**Impacto Julio 2026**: 29 facturas mapeadas al vendedor real de la app, 141 sin mapear (BPs históricos/BIKE sin registro app). Números por vendedor cerraron con la realidad operativa.

**Deuda técnica pendiente en SAP**: setear `SalesPersonCode=55` (Martin) en la ficha del BP de FATECHI (y otros clientes similares) para que futuras facturas vengan bien por default.

### Rendiciones (2026-07-22)

**Foto ticket migrada a Firebase Storage** (v308): antes se guardaba base64 en el doc Firestore (50-500KB por doc → rompía Power BI Import mode a escala). Ahora sube a bucket `rendiciones/{ownerUid}/{ts}_ticket.{ext}` y el doc queda con solo `fotoTicketUrl` (~1KB). Retro-migradas 45 fotos históricas con `scripts/migrate_rendiciones_foto_to_storage.py`.

**Vistas nuevas**:

| Vista | Contenido |
|---|---|
| `v_rendiciones` | 1 fila por gasto (`tipo='gasto'`). Campos aplanados: `concepto` (COMBUSTIBLE/COMIDA/HOSPEDAJE/PEAJE/TRASLADO/OTROS), `tipo_gasto` (FACTURA A / CON COMPROBANTE / SIN COMPROBANTE), `modo_pago` (RECARGABLE/CORPORATIVA/EFECTIVO), `division_gasto` (LOCAL/REGIONAL), `importe_ars/usd`, `moneda`, `vendor`, `status`, `foto_ticket_url`. Flags `tiene_comprobante_fiscal`, `pendiente_aprobacion`, `rechazada`. Fecha parseada con timezone AR. |
| `v_rendiciones_duplicados` | Alerta: agrupa por `(vendor, fecha, importe)` con `count > 1`. Detecta duplicados sospechosos. |

**Números actuales 2026-07-23**: $1.86M en 46 tickets · aprobado $1.55M · pendiente $307k · 45/45 fotos en Storage · 3 duplicados sospechosos (Martin 3 peajes $1500 el 30/6, Gonzalo y Federico 2 traslados $21k c/u el 26/6).

**Auto-aprobación directores** (v309): lista blanca `SELF_APPROVE_RENDICIONES_EMAILS` con `diego.valsi@shimano.uy`. Diego rinde sin approver externo; doc queda `status='approved'` desde el submit + `approvalNote='Auto-aprobada (director del area)'`.

### Targets descompuestos por familia (2026-07-21)

Modal Targets ahora carga 3 sub-targets por mes: **REEL / CAÑAS / LÍNEAS**. Total del mes = suma automática. Autosave con debounce 900ms + flush sync al cerrar el modal.

Firestore doc `targets/{seller}_{y}_{MM}` agrega `targetByFamily: {REEL, CANAS, LINEAS}`. `targetArs` se mantiene como total (retro-compat).

BQ: `v_targets` amplía con `target_reel_ars`, `target_canas_ars`, `target_lineas_ars`. Docs pre-v311 aparecen con NULL en esas 3 (retro-compat 100%). Uso PBI: cumplimiento por familia (facturación pesca por familia / target por familia).

`sync_sap_to_bigquery.py` usa **schema explícito** para targets (nueva función `_load_to_bq_with_schema`) para evitar el bug conocido de autodetect que dropea columnas todas-null.

### Contactado: distinción visita vs contacto no presencial

`v_visitas` expone 3 columnas nuevas para separar visitas físicas de contactos remotos:
- `interaction_type` (STRING): `'visita'` o `'contacto'`. Docs pre-v305 quedan como `'visita'` por COALESCE.
- `es_contacto` (BOOL): shortcut con `COALESCE(..., FALSE)` para filtros DAX simples.
- `forma_contacto` (STRING, v314+): `LLAMADA TELEFONICA` / `MENSAJE DE WHATSAPP` / `MENSAJE SMS`. NULL para visitas físicas.

Uso PBI: cards separados "Visitas físicas" vs "Contactos", donut por canal de contacto.

### Issue conocido: SlpCode 49 (Mariano admin) mal asignado a facturas de Gonzalo

**Detectado 2026-07-21**: 7 facturas de Julio 2026 quedaron cargadas con `SalesPersonCode=49` (Mariano admin) en vez de `SalesPersonCode=50` (Gonzalo de la Rosa). Total: $80.4M facturado + $33.6M de deuda.

**Consecuencia**: en el visual "Facturación por Origen por Tipo de Vendedor" del Dashboard, VDE + VDI ≠ VDT porque esos $80.4M no clasifican como VDE ni VDI.

**Facturas afectadas** (todas → asignar a SlpCode 50):

| # Factura | DocEntry | Cliente | Total ARS |
|---|---|---|---:|
| 18165 | 32150 | Nicolás Rinaldi (Mercadito Señuelero) | $2.610.000 |
| 18180 | 32187 | María Prat (Pescamagic Bait Shop) | $2.390.000 |
| 18224 | 32296 | Mundo Esturión | $20.676.000 |
| 18233 | 32309 | Mundo Esturión | $19.501.000 |
| 18242 | 32323 | Jonatan Angelino | $1.275.000 |
| 18244 | 32333 | Jonatan Angelino | $284.000 |
| 18262 | 32368 | REBORN SRL (Xplora La Triestina) | $33.624.000 |

**Fix intentado via Service Layer PATCH**: falló con `-5002 "Value in Discount field is greater than permitted"` (usuario `APP_VENDEDORES` tiene límite de descuento bajo y SAP re-valida toda la factura al hacer PATCH). Se resolvió manualmente desde SAP B1 desktop con user admin.

**Fix definitivo pendiente**: setear `SalesPersonCode=50` en la ficha del BP en SAP para los 5 clientes de Gonzalo (Mundo Esturión, REBORN, Rinaldi, Prat, Angelino), así el default de futuras facturas ya viene bien.

### v_targets — pipeline de metas (2026-07-14)

Sync Firestore.`targets` → BigQuery.`targets_raw` → view `v_targets`. Detalle en sección **22 (Targets mensuales)**.

**Schema `v_targets`** consumido por PBI (una fila por vendedor+año+mes con target > 0):

```
slp_code         INT64      Código SAP (mapeo hardcoded en el CASE de la vista)
vendedor         STRING     Nombre completo en formato SAP
anio             INT64
mes              INT64      1-12 (convertido desde 0-11 de Firestore)
target_ars       FLOAT64
_sync_timestamp  TIMESTAMP
```

**Mapeo canónico vendorKey → SlpCode** (única fuente de verdad, en el CASE de la vista):

| vendorKey app | SlpCode | Zona |
|---|---:|---|
| GONZALO DE LA ROSA | 50 | Z1 |
| MAURICIO GIL | 51 | Z5 |
| IOANNIS PALKOUDAKIS | 52 | Z6 |
| SANTIAGO ESTEBAN | 53 | Z7 |
| FEDERICO CASTELANELLI | 54 | Z2 |
| MARTIN BOIERO | 55 | Z4 |

**Discrepancias auditadas y documentadas en la vista**:
- **Firestore `sap_vendors` está corrido en -1** (49-54). Ignorado; el CASE hardcoded es la única fuente.
- **SAP prod `SHIMANO_SAU` al 2026-07-14 NO tiene creados los SlpCodes 50-55.** Solo hay 1-19, 33 (Mariano) y 56 (Santiago Beron). SEIDOR debe crearlos como parte del lanzamiento. Verificar con `python scripts/query_sap_sales_persons.py` cuando confirmen.
- **SlpCode 49 = Mariano Erbino (admin), NUNCA vendedor comercial**. Excluido explícitamente.

**Verificaciones de aceptación** (pasadas al deploy):
- `SELECT * WHERE anio=2026 AND mes=7`: Julio Gonzalo → `slp_code=50, target_ars=57.000.000` ✅
- Ningún `slp_code=49` ni NULL ✅
- Sin duplicados (`COUNT = COUNT DISTINCT` por seller+año+mes) ✅

**Sync**: `sync_sap_to_bigquery.py` → función `sync_targets_from_firestore()` — se ejecuta cada 30 min como paso 7 del pipeline. WRITE_TRUNCATE garantiza dedup.

### Suscripción diaria por email (2026-07-14)

Distribución automática del tablero por email vía **Power BI Service — Suscripciones estándar**. Nativa del servicio, sin código propio.

**Config actual**:

| Campo | Valor |
|---|---|
| Nombre suscripción | `Desempeño diario de ventas SAR - PESCA` |
| Destinatario | `mariano.erbino@shimano.com.ar` |
| Asunto | `Desempeño diario de ventas SAR - PESCA` |
| Frecuencia | Diaria |
| Hora envío | **15:00** (`UTC-03:00` Buenos Aires) |
| Contenido | Miniatura de la página TABLERO SAR + link "Open report in Power BI" + PDF adjunto con todas las páginas |
| Refresh dataset previo | **14:30** (30 min antes) — actualización programada del modelo semántico `TABLERO SAR` |
| Ejecución de prueba | 2026-07-14 11:33 — llegó OK a Mariano con snapshot completo |

**Cómo se configuró** (para replicar / agregar destinatarios):

1. Publicar el `.pbix` a Power BI Service: Desktop → `Archivo → Publicar → seleccionar workspace`.
2. En [app.powerbi.com](https://app.powerbi.com/) → workspace donde vive el informe → click en **TABLERO SAR (tipo Informe)** (icono barras naranjas).
3. Toolbar superior → **Suscribirse a informe** → **+ Agregar nueva suscripción** → tipo **Estándar** (NO dinámico por destinatario, ese es para RLS con vista personalizada por user).
4. Completar campos: nombre, destinatarios (`;` para múltiples), asunto, frecuencia diaria, hora `15:00`, zona `Buenos Aires`, activar **"Incluir la vista actual del informe"** (miniatura) y **"Adjuntar el informe completo (PDF)"** para que llegue TODO el reporte, no solo una página.
5. **Guardar y cerrar**. Ejecutar "Ejecutar ahora" para probar sin esperar al día siguiente.

**Refresh programado del dataset** (para que el mail traiga datos del día):

- En el workspace → click en **TABLERO SAR (tipo Modelo semántico)** (icono cilindro) → **Configuración** → **Actualización programada** ON.
- Frecuencia: Diaria, zona `Buenos Aires`.
- Hora: `14:30`.
- Credenciales del origen BigQuery: revisar que no digan "Editar credenciales" en rojo — si sí, autenticar con Google.

**Para agregar destinatarios** (ej: Diego, Pablo): editar la suscripción existente en el panel "Suscribirse a informe" y sumar los emails separados por `;`. Los destinatarios externos al tenant `shimano.com.ar` requieren que IT habilite "External sharing" en Azure AD / Power BI Admin Portal.

**Trade-off Estándar vs Dinámico por destinatario**:
- **Estándar** = 1 snapshot igual para todos (el que tenemos). Simple.
- **Dinámico** = usa RLS del modelo para mandar a cada usuario su vista filtrada (ej: cada vendedor solo ve sus targets). Requiere RLS configurado en el modelo. No implementado hoy.

### Rollback del fix "gap huérfano" en v_backorder_lineas (2026-07-13/14)

**Contexto**: `v_backorder_lineas` mostraba 1454 SKUs BIKE con `producto/familia/stock_actual` en blanco porque `sap_items_raw` solo trae grupo PESCA (755 items). Los SKUs BIKE con backorder existen en SQ pero no en el maestro.

**Intento de fix** (commit `e5cef77`): ampliar `v_sap_items_enriched` para incluir SKUs de SQ/SO/PO abiertos como universo (3042 filas total). Nueva columna `is_in_master`. Todo funcionaba en SQL — verificaciones pasaron 0 huérfanos.

**Problema en cliente**: Power BI Desktop del usuario (máquina con 8GB RAM, 95% memoria durante refresh) se colgaba 30+ min en el modal Actualizar. Los datos bajaban pero VertiPaq no lograba recomprimir el nuevo schema. Confirmado con Task Manager (CPU 0%, disco 0 MB/s durante freeze).

**Rollback en 2 pasos**:
1. Rollback quirúrgico (`7729ced`): dejar `v_inventario` con `WHERE is_in_master = TRUE` (755 filas, schema idéntico al pre-fix). No bastó.
2. Rollback total (`f1f441a`): las 4 vistas afectadas vueltas exactas al estado pre-fix. `v_sap_items_enriched` vuelve a ser `SELECT * FROM sap_items_raw` con `familia_norm`.

**Bonus fix mientras tanto** (commit `6f6397a`): `v_facturas_sap` — removida la columna `lines_json` (JSON string de 5-50KB por fila × 4776 = 20-200MB en un solo campo). VertiPaq no puede comprimir strings JSON únicos → explotaba RAM. El aplanamiento ya vive en `v_ventas_lineas`. Con eso el refresh de PBI se destrabó.

**Pendiente / reintroducir cuando**:
- El user tenga máquina con ≥16GB RAM, o
- Se migre el modelo a Power BI Service (corre en servidor Microsoft con recursos garantizados).

El SQL amplio para reintroducir el fix vive en git (commit `e5cef77`). Los scripts `diagnose_inventario_gap.py`, `test_inventario_fix.py`, `dryrun_new_views.py` permiten verificar el gap actual y validar el fix antes de aplicar.

### Estado inicial pre-2026-07-13

### Objetivo

Tablero Power BI alimentado casi real-time (5-30s de lag desde Firestore, ~30 min desde SAP) para que Diego, Pablo, Mariano y jefes de equipo vean performance comercial sin esperar exports manuales. KPIs Ola 1 (Ventas + Campo + Inventario + Campañas): facturación MTD, ticket promedio, visitas ejecutadas, cobertura padrón, conversión visita→pedido, stock crítico, progreso campañas, deuda vencida.

### Arquitectura

```
┌─ Firestore (app vive aquí) ───────────────┐
│    ↓ 7 Firebase Extensions                │
│      firestore-bigquery-export (uno por   │
│      colección — trigger nativo)          │
│                                            │
├─ SAP B1 Service Layer ────────────────────┤
│    ↓ script Python + GH Actions cron      │
│      sync_sap_to_bigquery.py              │
│                                            │
└─→ BigQuery dataset shimano_app            │
    (southamerica-east1 - Sao Paulo)       │
        ↓ Vistas SQL curadas (Fase 2)      │
        ↓ Power BI Desktop DirectQuery     │
        ↓ Publish → Workspace "Shimano"    │
```

**Regla: todo en `southamerica-east1` (Sao Paulo)** — Firestore + BigQuery + Cloud Functions de las Extensions. Latencia mínima, sin cargos cross-region.

### Fase 1.1 — Firestore → BigQuery — ✅ HECHO 2026-07-07

**7 instancias de la extension `firestore-bigquery-export@0.3.2`** instaladas, todas en dataset `shimano_app`:

| # | Colección Firestore | Table ID en BQ | Docs backfill 2026-07-07 |
|---|---|---|---|
| 1 | `pedidos` | `pedidos_raw` → `_raw_changelog` + `_raw_latest` | 4 |
| 2 | `visits` | `visits_raw` → `_raw_changelog` + `_raw_latest` | 8 |
| 3 | `client_master` | `client_master_raw` → `_raw_changelog` + `_raw_latest` | 105 |
| 4 | `sap_clients` | `sap_clients_raw` → `_raw_changelog` + `_raw_latest` | 4 |
| 5 | `client_applications` | `client_applications_raw` → `_raw_changelog` + `_raw_latest` | 109 |
| 6 | `rendiciones` | `rendiciones_raw` → `_raw_changelog` + `_raw_latest` | 34 |
| 7 | `campaigns` | `campaigns_raw` → `_raw_changelog` + `_raw_latest` | 0 (colección vacía, se llenará cuando se cree la 1ª campaña) |

**Total: 264 documentos históricos importados.** Cada write futuro se sincroniza automáticamente (trigger nativo de Firestore, sin código adicional).

**Fuera de alcance Fase 1.1** (posible ampliación futura): `notifications`, `custom_routes`, `route_overrides`, `vendor_overrides`, `roles`, `userData`, `product_catalog` (chunks), `sap_products`, `sap_vendors`, `client_locations`, `operations_log`, `targets`, `allowed_emails`, `app_config`. Se pueden sumar 1x1 con más instancias si Power BI las necesita.

#### Estructura de cada tabla stream

Para cada colección se generan **2 objetos** en BigQuery:

- **`<prefix>_raw_changelog`** (tabla): 1 fila por cada evento Firestore (`CREATE` / `UPDATE` / `DELETE` / `IMPORT`). Columnas: `document_name`, `document_id`, `operation`, `timestamp`, `data` (JSON), `old_data` (JSON del estado anterior en UPDATEs). Es la fuente de verdad para audit trail y para reconstruir el estado en cualquier momento.
- **`<prefix>_raw_latest`** (view materializada): última versión de cada `document_id` que existe hoy (DELETEs quedan excluidos). Es la que usa Power BI por default.

**Convención de nombre**: Table ID `pedidos_raw` → tablas reales `pedidos_raw_raw_changelog` y `pedidos_raw_raw_latest` (el sufijo `_raw_*` es literal del template de la Extension; podríamos haber puesto `pedidos` como Table ID para que quedara `pedidos_raw_changelog`, pero mantenemos `_raw` por consistencia con el resto).

#### Config común de todas las Extensions

- **Cloud Functions location**: `southamerica-east1`
- **BigQuery Dataset location**: `southamerica-east1`
- **BigQuery Project ID**: `app-vendedores-shimano`
- **Firestore Instance ID**: `(default)`
- **Firestore Instance Location**: `southamerica-east1`
- **Dataset ID**: `shimano_app`
- **Wildcard Column**: `false`
- **Time Partitioning**: `NONE` / `omit`
- **Clustering**: default (`data,document_id,timestamp`)
- **View Type**: `View` (materializada, refresh 60 min)
- **Max synced docs/sec**: 100
- **Habilitar eventos (Eventarc)**: **desmarcado** — no se usan custom event handlers y evita el bug de permisos IAM que teníamos con `cloudtasks.tasks.create` en Service Agent Eventarc.
- **Excluir old payloads**: `no` (queremos `old_data` para poder trackear cambios)

#### Backfill del histórico

Se hace **UNA vez por colección** con el script `@firebaseextensions/fs-bq-import-collection` (npx). Después del install la Extension solo captura writes futuros; sin backfill los docs previos quedan invisibles a Power BI.

**Requisitos**:
- Node.js 14+ (funciona con 22 y 24)
- Service account key JSON descargado desde Firebase Console → Configuración → Cuentas de servicio (guardado como `~/Desktop/sa-key.json`, no commitear)
- El service account necesita 2 roles adicionales en IAM (por default solo trae permisos de Firebase, no BigQuery):
  - **BigQuery Data Editor** (`roles/bigquery.dataEditor`)
  - **BigQuery Job User** (`roles/bigquery.jobUser`)

**Script**: `~/Desktop/backfill-all.ps1` procesa las 6 colecciones nuevas en secuencia (pedidos ya se hizo aparte). Ejemplo de comando por colección:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\shimano.sandbox\Desktop\sa-key.json"
npx --yes @firebaseextensions/fs-bq-import-collection `
  --non-interactive `
  --project=app-vendedores-shimano `
  --source-collection-path=<colección> `
  --dataset=shimano_app `
  --table-name-prefix=<colección>_raw `
  --dataset-location=southamerica-east1 `
  --batch-size=300 `
  --query-collection-group=false
```

**Verificación post-backfill** (query BigQuery para cualquier colección):
```sql
SELECT operation, COUNT(*) AS cnt
FROM `app-vendedores-shimano.shimano_app.<prefix>_raw_changelog`
GROUP BY operation;
```

Debe mostrar `IMPORT` con el conteo real de docs existentes.

### Fase 1.2 — SAP → BigQuery — ✅ HECHO 2026-07-08 (ampliado 2026-07-14)

**Script**: `scripts/sync_sap_to_bigquery.py` (~750 líneas). Corre en GH Actions cron `13,43 * * * *` (mismo patrón que el sync a Firestore) mediante `.github/workflows/sync-sap-to-bigquery.yml`.

**6 tablas SAP + 1 tabla desde Firestore en BigQuery** (dataset `shimano_app`):

| Tabla | Endpoint / Fuente | Contenido | Volumen 2026-07-14 |
|---|---|---|---|
| `sap_bp_raw` | `/BusinessPartners?$filter=CardType eq 'cCustomer'` | Padrón Customers | ~20 rows |
| `sap_items_raw` | `/Items?$filter=ItemsGroupCode eq <PESCA>` | Catálogo pesca con stock + precio | 755 rows |
| `sap_invoices_raw` | `/Invoices?$filter=DocDate ge '<24m>'` | Facturas últimos 24 meses | 4.776 rows |
| `sap_quotations_raw` | `/Quotations?$filter=DocDate ge '<24m>'` | Cotizaciones últimos 24 meses | ~1.500 rows |
| `sap_orders_raw` | `/Orders?$filter=DocDate ge '<24m>'` | Sales Orders últimos 24 meses | ~500 rows |
| `sap_purchase_orders_raw` | `/PurchaseOrders` | POs abiertas (mercadería incoming) | ~200 rows |
| **`targets_raw`** ← 2026-07-14 | Firestore `targets` (sync propio) | Metas mensuales cargadas por gerente | 4 rows (Julio 2026) |

**Estrategia**: `WRITE_TRUNCATE` cada corrida (full snapshot). Cuando el volumen escale (miles de facturas), migrar a delta por `UpdateDate`.

Cada row incluye `_sync_timestamp` (UTC ISO) para trazabilidad de la corrida.

**DocumentLines** de invoices/quotations se guarda como JSON string en la columna `lines_json` para no explotar el schema. Fase 2 hace `UNNEST(JSON_EXTRACT_ARRAY(lines_json))` en las vistas cuando hace falta.

**Bugs encontrados y solucionados durante el desarrollo (2026-07-08)**:
- `Property 'State1' of 'BusinessPartner' is invalid`: campo removido del schema SL de Shimano. Fix: quitar del `$select`, el `state` en `sap_bp_raw` queda `null` (se puede extraer de `BPAddresses` en vistas Fase 2 si Power BI lo necesita).
- `Property 'CreditLine' of 'BusinessPartner' is invalid`: idem. También removidos `CurrentAccountBalance` y `Notes` como preventivo.
- Volumen bajo confirmado con el user: es normal en esta etapa temprana de venta directa PESCA post-Baraldo.

### Fase 2 — Vistas curadas — ✅ HECHO 2026-07-08

**Archivo con SQL**: `bigquery/views.sql`. Se ejecuta manualmente **una vez** desde BigQuery Console; después se puede re-correr con cambios (todas usan `CREATE OR REPLACE VIEW`).

**4 vistas creadas en `shimano_app`**:

| Vista | Descripción | Fuente |
|---|---|---|
| `v_pedidos_header` | 1 fila por pedido, con todos los campos del header aplanados desde el JSON de Firestore (cliente, mes, forma pago, forma entrega, subtotales, discountSnapshot, hasSkusToReview, etc.) | `pedidos_raw_raw_latest` |
| `v_pedidos_lines` | 1 fila POR LÍNEA (explota el array `lines` del pedido). Incluye contexto denormalizado del pedido (cliente_nombre, provincia, mes, etc.) para queries rápidos sin joins. | `pedidos_raw_raw_latest` con `UNNEST(JSON_EXTRACT_ARRAY(data, '$.lines'))` |
| `v_visitas` | 1 fila por visita con todos los campos del formulario aplanados. Incluye VDE-VDI con `on_behalf_of` para detectar cargas hechas por VDI en nombre de VDE. **Fix v283**: los campos `provincia` y `localidad` en español (no `province`/`locName` como pedidos). | `visits_raw_raw_latest` |
| `v_facturas_sap` | Facturas SAP + `LEFT JOIN` con `sap_bp_raw` para tener nombre del cliente + tipo + moneda + ciudad al lado, sin que Power BI tenga que hacer el join. | `sap_invoices_raw` + `sap_bp_raw` |

**Convenciones**:
- Nombres de columnas en **snake_case latino** natural para el usuario final (`cliente_nombre` en vez de `clientName`).
- `SAFE_CAST` en todos los conversions para robustez (dato malformado → `NULL`, no rompe la vista).
- `CREATE OR REPLACE VIEW`, ejecutables idempotentes.

**Documentar cada vista** en `bigquery/views.sql` con comentarios en el propio SQL (ya está hecho).

### Fase 3 — Power BI Desktop — 🔨 EN CURSO 2026-07-08

**Estado**: conectado a BigQuery via conector nativo, 5 tablas cargadas en modo **Import**, medidas DAX básicas armadas, primer dashboard "Resumen-Desempeño" en armado.

#### Setup

- Power BI Desktop instalado en la máquina.
- Conector: **Google BigQuery** (nativo, no Azure AD).
- Modo: **Import** (más rápido que DirectQuery para los volúmenes actuales; migrar a DirectQuery cuando la data crezca).
- Login: `bot.shimano.pesca@gmail.com` con OAuth.

#### Tablas cargadas

- `v_pedidos_header`, `v_pedidos_lines`, `v_visitas`, `v_facturas_sap` (las 4 vistas)
- `sap_items_raw` (catálogo con stock/precio)
- + tabla auxiliar `Vendedores` creada con **DATATABLE** en Power BI Desktop (6 filas hardcoded: SlpCode 50-55, Nombre, Tipo VDI/VDE, Región)
- + tabla auxiliar `Origenes` (VDT, VDI, VDE) para el visual "Facturación por Origen"

#### Relaciones

- `v_pedidos_lines[pedido_id]` → `v_pedidos_header[pedido_id]` (many-to-one, autodetectada)
- `Vendedores[SlpCode]` → `v_facturas_sap[sales_person_code_invoice]` (uno-a-varios, creada a mano)

#### Medidas DAX principales (bajo `v_facturas_sap`)

| Medida | Fórmula | Formato |
|---|---|---|
| Facturación Total | `CALCULATE(SUM('v_facturas_sap'[doc_total]), 'v_facturas_sap'[sales_person_code_invoice] IN {50, 51, 52, 53, 54, 55})` | Moneda ARS |
| Ticket Promedio | `CALCULATE(AVERAGE(...), 'v_facturas_sap'[sales_person_code_invoice] IN {50..55})` | Moneda ARS |
| Cuentas Atendidas | `DISTINCTCOUNT('v_facturas_sap'[card_code])` | Entero |
| Pedidos Ingresados | `COUNTROWS('v_pedidos_header')` | Entero |
| SKUs Únicos | `DISTINCTCOUNT('v_pedidos_lines'[sku])` | Entero |
| Target Mensual | `50000000` (hardcoded temporal, migrar a tabla de targets después) | Moneda ARS |
| % Cumplimiento | `DIVIDE([Facturación Total], [Target Mensual], 0)` | Porcentaje |
| Desviación | `[Target Mensual] - [Facturación Total]` | Moneda ARS |
| Descuento Medio | `AVG(discount_percent)` filtrado por PESCA | Porcentaje |
| Facturación VDE | `CALCULATE(SUM(doc_total), sales_person_code_invoice IN {50, 51, 54, 55})` | Moneda |
| Facturación VDI | `CALCULATE(SUM(doc_total), sales_person_code_invoice IN {52, 53})` | Moneda |
| Peso VDE % / VDI % | `DIVIDE(...)` | Porcentaje |
| Facturación por Origen | `SWITCH(TRUE(), SELECTEDVALUE('Origenes'[Origen]) = "VDT", [Facturación Total], ...)` | Moneda |
| SKU Cliente | `DIVIDE([SKUs Únicos], [Cuentas Atendidas], 0)` | Entero |

#### Columnas calculadas para slicers

- `v_facturas_sap[Año]` = `YEAR(doc_date)`
- `v_facturas_sap[Mes Nombre]` = `FORMAT(doc_date, "MMMM")` (ordenado por Mes Num)
- `v_facturas_sap[Mes Num]` = `MONTH(doc_date)`
- `v_facturas_sap[Día]` = `FORMAT(doc_date, "dd")` (para ejes de gráficos por día)

#### Visuales en armado ("Resumen-Desempeño")

- Header oscuro con título + slicers Año/Mes arriba a la derecha.
- **Gauge "Facturación mensual"** (semicircular): valor actual / target.
- **Gauge "% Cumplimiento"**.
- **Card grande "Facturación Real"** con Desviación + Descuento Medio debajo.
- **Grilla 2x3 de 6 KPIs pequeños**: Ticket Promedio, Peso VDE %, Peso VDI %, Cuentas Atendidas, Pedidos Ingresados, SKU Cliente.
- **Bar chart "Facturación por Día"** (día del mes en eje X).
- **Bar chart "Facturación por Región"** (barras verticales por región de vendedor).
- **Bar chart "Facturación por Origen de Pedido"** (VDT/VDI/VDE).
- **Bar chart horizontal "Regiones - TOP"**.

#### Trabajo pendiente Fase 3

- Publish al **Power BI Service** (workspace Shimano). Requiere licencia Pro para los viewers.
- Configurar **Scheduled Refresh** cada 30 min (aligned con el cron del sync SAP → BigQuery).
- Dashboards adicionales por pilar: Ventas · Campo · Inventario · Campañas (los 4 slides de `Real-Time.pptx`).
- Compartir con stakeholders (roles: gerencia, jefe ventas, oncall inventario).
- Cuando el volumen escale: considerar migrar a **DirectQuery** en las tablas críticas (facturas) para tener latencia ~30 seg desde SAP → dashboard.

### Fase 4 — Alertas — ⏳ PENDIENTE

Alertas automáticas Ola 1 (6):
- Meta a mitad de mes
- Cliente Premium dormido
- Stock quebrado con demanda
- Vendedor bajo target día 20
- Cotización sin cerrar >15 días
- Meta superada (motivación)

Canal a decidir: **Power BI Data Alerts** (email nativo) o **Cloud Function + Slack/WhatsApp**.

### Viewers del workspace (Fase 3)

- **Mariano Erbino** (admin) — `mariano.erbino@shimano.com.ar`
- **Diego Valsi** — `diego.valsi@shimano.uy`
- **Santiago Beron** — `santiago.beron@shimano.uy`
- **Pablo Maraschin** — email pendiente confirmación
- **Ioannis Palkoudakis** — email pendiente confirmación

### Troubleshooting Extensions

**Síntoma: Extension queda "En proceso · Configuring BigQuery Sync" por días.** Está colgada (permisos IAM incompletos o timeout). Desinstalar y reinstalar limpio (los permisos ya deberían haber propagado; si es la primera vez y falla, esperar 30 min y reintentar).

**Síntoma: Extension "Instalada" ✅ pero tabla no aparece en BigQuery.** Verificar en el sidebar "Estado del entorno de ejecución" que diga "Processing" en verde. Si dice "En proceso" o error, revisar logs de la Cloud Function `ext-*-syncBigQuery` en Google Cloud Console → Cloud Functions.

**Síntoma: Backfill falla con "Access Denied: Permission bigquery.tables.get denied".** El service account `firebase-adminsdk-*` viene con permisos de Firebase pero NO de BigQuery. Agregar en IAM los roles `BigQuery Data Editor` + `BigQuery Job User`.

**Síntoma: Backfill falla con "QueryCollectionGroup is not specified".** Falta el flag `--query-collection-group=false` en el comando `fs-bq-import-collection` (la versión nueva lo pide).

**Síntoma: Dataset ID quedó en `firestore_export` en lugar de `shimano_app`.** El wizard de la Extension trae `firestore_export` como default y es fácil pasarlo por alto. Corregir: desinstalar la Extension mal configurada y reinstalar poniendo `shimano_app` a mano. Después, en BigQuery Console borrar el dataset huérfano `firestore_export` si quedó vacío.

---

## 40-bis) Sync automático de BPs pesca (v282-v288, 2026-07-08)

**Objetivo**: cuando administración da de alta un cliente en SAP, aparece automáticamente en la app en la siguiente corrida del cron (~30 min). Sin acción manual del admin.

### Contexto histórico

**Antes** (v281 y anteriores) la única forma de que un cliente SAP apareciera en la app era:
1. Admin exportaba CSV de BPs desde SAP.
2. Iba al panel **SAP → Integración** en la app.
3. Subía el archivo.
4. La app hacía match contra `POINTS` (hardcoded).
5. Los matches se guardaban en `sap_clients`; los no-match quedaban invisibles.

**Fricción**: nadie lo corría rutinariamente. Los BPs SAP nuevos quedaban en limbo por semanas.

### Fix v282-v288

Nueva función `sync_bp_pesca()` dentro de `scripts/sync_sap_to_firestore.py` que corre en la misma corrida del cron cada 30 min. Después de items+stock+precios, también sincroniza BPs pesca desde `/BusinessPartners` → `client_applications` en Firestore.

**Filtro correcto (v288)**:
```
U_DIVISION IN ('2', '3', 'PESCA', 'BIKE & PESCA')
```
Donde:
- `1` = BIKE
- `2` = PESCA
- `3` = BIKE & PESCA (mixto, se incluye porque el user lo considera pesca)

Además: `CardType IN ('cCustomer', 'cLid')` — incluye Leads (los BPs pesca empiezan como Lead esperando validación de finanzas).

**Volumen actual**: ~103 BPs pesca. De 2600 BPs Customer/Lead totales, 2506 son BIKE (se descartan).

### Provincia canónica

El UDF `U_SH_PCIA` en SAP guarda el código interno de provincia (ej: `'2'`), no el nombre. El sync trae el mapping desde `/States?$filter=Country eq 'AR'` al inicio de cada corrida y convierte `'2'` → `'SALTA'` (uppercase para matchear con las zonas hardcoded de la app).

Se guarda en el campo `provincia` del doc `client_applications` (el que usa la app para filtrar/agrupar). Fallback: si el UDF está vacío, buscar en `BPAddresses[].State`.

### Comportamiento del upsert

Matching en orden de prioridad:
1. **`cardCodeSap`** (más confiable).
2. **`cuit` normalizado** (solo dígitos).
3. **Nombre normalizado** como fallback (`sapNorm(name)`).

Tres casos:
- **CASO 1** — Existe como PROVISORIO (`manualSapPending=true`): pisar con datos SAP + `status='approved'` + `cardCodeSap` poblado + `manualSapPending=false`. La app actualiza el badge de 🟡 PROVISORIO a 🟢 HABILITADO automáticamente vía listener.
- **CASO 2** — Existe como HABILITADO: actualizar datos SAP (dirección, phone, email). **NO se toca** `assignedVendor`/`ownerUid` para no pisar reasignaciones manuales del gerente.
- **CASO 3** — No existe: crear nuevo doc con `status='approved'`, `source='sap_sync'`, y `assignedVendor`/`ownerUid` vacíos. Admin/gerente los asigna en la app.

### Vendedor por asignación manual

**Decisión de diseño 2026-07-08**: NO asignar vendedor automáticamente en el sync. Razones:
- El campo `SalesPersonCode` en el header del BP en SAP viene como `-1` (No Sales Employee) para todos los BPs pesca.
- Mapping por provincia → vendedor podría ser incorrecto (una provincia grande tiene sub-zonas con distintos vendedores).
- El gerente prefiere el control manual.

El admin/gerente entra a la app y asigna vendedor+zona desde el panel Master Clientes o Alta Clientes.

### Metadata SAP guardada en el doc

Además de los campos estándar (`comercio`, `cardCodeSap`, `cuit`, `calle`, `localidad`, `provincia`), el sync guarda:
- `sapCardType` — `cCustomer` | `cLid`.
- `sapDivision` — código de U_DIVISION (`'2'` o `'3'`).
- `sapValid` / `sapFrozen` — flags de estado en SAP.
- `sapReadyForSL` — bool convenience. `true` sólo si `CardType='cCustomer' + Valid='tYES' + Frozen!='tYES'`. La app puede usar este flag para skip el auto-envío a Service Layer (evita el spam de errores 400 en consola cuando el BP es Lead o Inactive).
- `sapSalesPersonCode` — el número del header (típicamente -1 para pesca).
- `sapProvinceRaw` — el código interno de U_SH_PCIA para auditoría.
- `source` — `'sap_sync'` (permite filtrar/limpiar docs del sync sin tocar altas manuales).

### Script de limpieza

`scripts/cleanup_bad_bp_sync.py` — herramienta para borrar docs mal cargados por el sync. Solo borra de **Firestore** (nunca de SAP).

**Filtros de seguridad**:
- `source == 'sap_sync'` (no toca altas manuales).
- `createdAt > CUTOFF_DATE` (default `2026-07-08T00:00:00Z`; safety para no tocar docs viejos).

**Uso**:
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\shimano.sandbox\Desktop\sa-key.json"
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content C:\Users\shimano.sandbox\Desktop\sa-key.json -Raw
$env:DRY_RUN = "true"
python scripts/cleanup_bad_bp_sync.py    # Ver qué va a borrar sin borrar
# Después de confirmar en DRY_RUN:
Remove-Item Env:\DRY_RUN
python scripts/cleanup_bad_bp_sync.py    # Borrar de verdad
```

Borra en batches de 500 (max Firestore). ~2500 docs se borran en ~10 segundos.

### Bugs superados durante el desarrollo (v282→v288)

Cronología resumida:
1. **v282**: filtro por `SalesPersonCode IN {50-55}` → 0 resultados (todos vienen -1 en el header).
2. **v283**: intento con `U_DIVISION eq 'PESCA'` en OData → SL no matchea UDF en `$filter`.
3. **v285**: filtrar UDF en Python → paginado se corta (nextLink sin `@` en algunas versiones SL).
4. **v286**: fix paginado + filtro `U_DIVISION == '1'` → 2506 rows (¡BIKE!).
5. **v287**: simplificado, no asignar vendedor auto.
6. **v288 FINAL**: `U_DIVISION IN ('2', '3')` (PESCA + BIKE&PESCA), poblar `provincia` canónica desde mapping de SAP States.

Total: ~15 iteraciones para llegar al fix correcto por la naturaleza propietaria del schema SL de este SAP.

---

## 41) Changelog v204 → v314

Solo las versiones nuevas — el histórico anterior está en la última entrada de la sección 38 (Hecho recientemente) y al pie del documento.

### v314 (2026-07-23) — Registro de Contacto: campo Forma de contacto
- Modal Visita en modo `contacto`: nueva fila **"Forma de contacto"** después de "Tipo de tienda". Opciones: LLAMADA TELEFONICA / MENSAJE DE WHATSAPP / MENSAJE SMS. Obligatorio.
- `applyVisitModeUI` muestra/oculta la fila según modo. `submitVisita` valida y guarda como `formaContacto`.
- BQ: `v_visitas` agrega columna `forma_contacto` (STRING). NULL para docs pre-v314 y visitas físicas.

### v313 (2026-07-23) — Buscadores flexibles multi-token AND
- Nuevo helper `matchesAllTokens(haystack, query)`: divide query por espacios, exige que TODOS los tokens aparezcan en el haystack. Normaliza acentos vía NFD.
- Aplicado en 4 buscadores: CLIENTES sidebar (`clientMatchesQuery` + SAP altas), PEDIDOS sidebar, Master Clientes vista normal, Master Clientes Provisorios.
- Ejemplos que ahora funcionan: `"el pez gordo quilmes"`, `"pescamagic buenos aires"`, `"gonzalo cordoba"`.
- Pendientes de aplicar el mismo helper: Localidades, form Visita tienda, Vincular con SAP, Rendiciones TODAS, Zonas.

### v312 (2026-07-23) — Export masterfile Clientes incluye Provisorios
- Antes: `exportMasterClientes` filtraba `!cardCodeSap → skip`. Los provisorios (Alta rápida) quedaban afuera del Excel.
- Ahora: detecta `isProvisorio = manualSapPending && !cardCodeSap` y los incluye con `Tipo="Provisorio (Alta rapida)"` + `Estado="Provisorio"`. Se aceptan sin dirección.
- Bugfix: `seen.add(dupKey)` que faltaba (evitaba duplicados si un habilitado y un provisorio compartían nombre+provincia).

### v311 (2026-07-22) — Targets descompuestos por familia REEL/CAÑAS/LÍNEAS
- Modal Targets: 3 columnas de familia + columna Total (readonly, calculado en vivo).
- Firestore: doc agrega `targetByFamily: {REEL, CANAS, LINEAS}` map. `targetArs` sigue siendo el total (retro-compat).
- BQ: `v_targets` amplía con `target_reel_ars` / `target_canas_ars` / `target_lineas_ars`.
- Sync grande: nueva función `_load_to_bq_with_schema` con schema explícito para targets (evita drop de columnas null por autodetect).
- Fix `ALTER TABLE targets_raw ADD COLUMN` aplicado en BQ para docs pre-v311.

### v310 (2026-07-21) — Targets autosave al escribir
- Antes: había que apretar "Guardar Targets" al final; si cerrabas el modal antes, se perdían los cambios.
- Ahora: `onTgtInputChange` programa `_saveTargetFor(id)` con debounce 900ms. Feedback visual (`.saving` azul / `.saved` verde flash).
- `closeTargetsPanel` hace flush sync de cualquier pendiente antes de cerrar. Cero pérdida de datos.

### v309 (2026-07-21) — Directores auto-aprueban rendiciones
- Nueva `SELF_APPROVE_RENDICIONES_EMAILS = Set(['diego.valsi@shimano.uy'])`. Emails en la lista no necesitan responsable de rendiciones.
- `submitRendGasto` + `submitRendSolicitud`: bypass del check + doc queda `status='approved'` desde el submit + `approvalNote='Auto-aprobada (director del area)'`. Skip notificación.
- Extensible: sumar emails al Set para agregar otros directores.

### v308 (2026-07-21) — Rendiciones foto a Firebase Storage + vistas BQ
- Cargar Firebase Storage SDK 10.7.1.
- `submitRendGasto` sube foto a `rendiciones/{ownerUid}/{ts}_ticket.{ext}` y guarda solo `fotoTicketUrl`. Doc pasa de 50-500KB a ~1KB.
- Retro-migración: `scripts/migrate_rendiciones_foto_to_storage.py` movió 45/45 fotos históricas.
- BQ: nuevas vistas `v_rendiciones` (46 filas) + `v_rendiciones_duplicados` (3 casos sospechosos).
- Retro-compat: `openRendicionDetail` y export Excel prefieren `fotoTicketUrl` sino caen a `fotoTicket` base64.

### v307 (2026-07-21) — Contactado Fase B: badges + filtro por tipo
- Menú contextual del cliente: "Revisar última visita" → **"Última interacción"**.
- Modal `cv-modal`: título renombrado + badge visual `🟣 Visita` (violeta) o `📱 Contactado` (teal) al lado de la fecha.
- Contador de anteriores desglosa: `+ N interacciones anteriores (X visitas + Y contactos)`.
- Lista "Mis visitas" (modal Visita → tab list): **nuevo filtro** dropdown `Visitas + Contactos / Solo visitas / Solo contactos` + badge por card.
- Retro-compat: docs sin `interactionType` se tratan como visita.

### v306 (2026-07-21) — Contactado celeste + Dashboard bordó + editar prov/loc en Provisorios
- Tab Contactado pasa de teal a **celeste `#00A9E0`** (mismo grupo CSS que Rutas y Visita).
- Botón Dashboard (barra superior) pasa de celeste a **bordó `#7f1d1d`** / hover `#991b1b`.
- Master Clientes → Provisorios: columnas **Localidad** y **Provincia** editables inline con autosave. Marcan `provinciaLocSource='manual'` para que el sync SAP no las pise. Limpian `lat/lng` para forzar re-geocoding.

### v305 (2026-07-21) — Contactado Fase A: modal Visita en modo `contacto`
- Nueva variable global `window.visitMode = 'visita' | 'contacto'`.
- `openVisitaModal(mode)` acepta parámetro (default `'visita'`, retro-compat).
- `applyVisitModeUI(mode)` cambia visualmente el modal: header teal, título "Registro de Contacto (no presencial)", ocultar filas de fotos (`vf-espacio-row` + `vf-frente-row`), botón submit teal "Registrar contacto".
- `submitVisita` agrega campo `interactionType='contacto'` al doc de `visits`.
- Tab Contactado ahora abre `openVisitaModal('contacto')`.
- Pane placeholder eliminado (ya no se usa).

### v304 (2026-07-21) — Reorganizar barra superior: Dashboard como botón + tab Contactado (placeholder)
- Botón Dashboard movido desde la grilla de tabs (posición 6) hacia la barra superior derecha, al lado de "Campañas Activas". Estilo turquesa `.btn-dashboard` (ya existía en CSS + media queries mobile).
- Nueva tab **Contactado** en el slot donde estaba Dashboard. En v304 era placeholder; funcional desde v305.
- `setTab` contempla el nuevo pane.

### v303 (2026-07-21) — Edit inline nombre+vendedor también en Master Clientes vista normal
- Fix del v302: los inputs editables solo aparecían en el modo "botón violeta Provisorios" (`renderMcProvisoriosTable`). En la vista default de Master Clientes (`renderMasterClientesTable`) las filas provisorias seguían mostrando texto readonly.
- Ahora en `renderMasterClientesTable`, cuando `isSap && !e.sapCardCode` (provisorio) y `userRole` es admin/gerente:
  - Columna Tienda: input editable → `saveMcProvisorioComercio`
  - Columna Vendedor: `<select>` VDE+VDI → `saveMcProvisorioVendor`
- Las 2 funciones ya existían del v302, solo faltaba invocarlas desde este renderer.

### v302 (2026-07-21) — Modal ZONAS + Master Clientes editables para provisorios
- **Modal ZONAS** acepta provisorios (`manualSapPending && !cardCodeSap`) con badge amarillo "⚡ PROVISORIO". Ya no exige `cardCode` ni dirección para incluirlos en el listado.
- **Master Clientes tab Provisorios**: nombre del comercio y vendedor editables inline con autosave. Nombre escribe a `comercio` (o `fantasia` si no había comercio). Vendedor escribe a `assignedVendor` + resuelve `ownerUid` matcheando displayName en `roles` (así el vendedor asignado ve el provisorio en su lista personal).
- **BigQuery paralelo (mismo día)**:
  - `v_facturas_sap` agrega `paid_to_date` + `saldo_ars` (compat medidas PBI que respetan criterio SlpCode).
  - `v_ventas_lineas` agrega `cobrado_prorrateado_ars` + `deuda_prorrateada_ars` a nivel línea. Permite `[Cobrado ARS] + [Deuda ARS] = [Facturación Total]` exacto.
  - `sync_sap_to_bigquery.py` agrega `PaidToDate` al `$select` de Invoices (evita que autodetect dropee la columna en cargas futuras).
  - `patch_paid_to_date.py` one-off idempotente que agrega la columna sin tocar `lines_json`.
  - 3 vistas nuevas de deuda (creadas 2026-07-20, aplicadas hoy): `v_deuda_por_vendedor`, `v_deuda_facturas_detalle`, `v_facturado_cobrado_deuda_por_vendedor`.

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

Detalles completos + troubleshooting en la nueva **sección 40-bis** del README.

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

### v301 — Modal de pedido PENDIENTE muestra vista previa del pedido + sugeridos side-by-side

**Pedido**: en modal de pedido PENDIENTE, además de ver "Sugeridos para este cliente" (que ya estaba), ver también una **vista preliminar del pedido cargado** para contrastar contra los sugeridos y decidir qué agregar.

**Antes**: la clase CSS `pending-suggest-only` explícitamente ocultaba `#pm-current-wrap` (línea 1320 del CSS antiguo) — solo se veían los sugeridos ocupando todo el ancho.

**Ahora**: layout 2 columnas dentro de `.pedido-right`:
- Izquierda: **Sugeridos para este cliente** (naranja) — sin cambios.
- Derecha: **Ya cargado en este pedido** (verde `#f0fdf4` + border `#86efac`, sticky top) — muestra las líneas del pedido con precio y cantidad como texto plano (los inputs quedan sin borde, sin background, `pointer-events:none`).

**Título dinámico**: `"Ya cargado en este pedido · N producto(s) · M unidades"` (calculado en JS al abrir).

**Read-only en pending**: los inputs de cantidad/precio y el botón X (eliminar) se ocultan. Para editar el pedido, el user debe usar el botón **"Volver a borrador"** que ya existía. Esta es una vista de comparación, no de edición.

**Mobile (<900px)**: los 2 bloques se apilan verticalmente, el pedido actual pierde el `max-height:65vh` para poder scrollear la página entera.

**Backend sin cambios**. Todo es CSS + un par de líneas en `openPedidoModal` para actualizar el título del bloque.

### v300 — Buscador de tienda en Visita: matchea por fantasía O titular

**Bug reportado**: en el form de Visita el vendedor buscaba por fantasía (ej. "LA PALOMETA") y no encontraba la tienda porque el label del dropdown solo mostraba el titular ("ALAN OSCAR NICOLAS RODRIGUEZ — MUNRO, Buenos Aires"). El filter-select del componente `fs` matchea por substring del label, entonces si la fantasía no está en el label, no se encuentra.

**Fix** en `populateVisitaLocalidades()`:
- Nuevo pre-índice `fantasiaByName: Map<nombre_normalizado, fantasia>` construido desde `approvedAltasList` — cubre las 3 rutas de match (comercio, titular, fantasia) para que POINTS legacy también sepa qué fantasía usar.
- Nuevo helper `buildLabel(titular, fantasia, loc, prov, badge)`: emite `"Fantasía (Titular) — Loc, Prov"` cuando la fantasía es distinta del titular, o solo `"Titular — Loc, Prov"` si son iguales o no hay fantasía. El filter matchea el label completo → **busca por fantasía o por titular indistintamente**.
- Sort key: usa el nombre grande (fantasía cuando existe, sino titular) para que el dropdown salga alfabéticamente por lo que el vendedor ve primero.
- El `value` del filter-select sigue siendo `"PROV||Loc||Titular"` (el save espera el titular en `v.tienda`).

**Antes**:
```
ALAN OSCAR NICOLAS RODRIGUEZ — MUNRO, Buenos Aires
```
Buscar "PALOMETA" → 0 resultados.

**Ahora**:
```
LA PALOMETA BAIT SHOP (ALAN OSCAR NICOLAS RODRIGUEZ) — MUNRO, Buenos Aires
```
Buscar "PALOMETA" ✅ / Buscar "ALAN" ✅ / Buscar "MUNRO" ✅.

**Schema del doc `visits` sin cambios**: sigue guardando `tienda: "ALAN OSCAR NICOLAS RODRIGUEZ"` (el titular). Los reportes y timeline por cliente siguen agrupando por titular.

### Fix sync SAP: preservar nombre de fantasía manual (2026-07-14, script)

**Bug reportado por Mariano**: cargó manualmente ~10 nombres de fantasía en clientes; a los 2-3 días desaparecieron. Después el bulk import (103 fantasías desde el Excel del formulario alta) — mismo riesgo: el próximo cron los pisaría.

**Causa**: `sync_sap_to_firestore.py:upsert_bp_pesca_to_firestore()` incluía siempre `'fantasia': cardname` en el `base_payload`. El `set(merge=True)` cada 30 min pisaba la fantasía manual con el CardName raw de SAP ("GABRIEL ALEJANDRO YAMIN" en vez de "ARMERIA EL COLORADO").

**Fix**: mismo patrón que aplicamos en v291 para localidad/provincia. Después de armar el `base_payload` y antes del write, chequeamos si el doc en Firestore ya tiene `fantasia` distinta del `comercio` y distinta del `cardname` — si sí, es una fantasía manual real → `pop('fantasia')`. El sync solo setea fantasia default (cardname) cuando el doc no la tenía cargada (CREATE) o cuando estaba vacía / igual al comercio.

**Auditoría**: log line `[bp] preserva fantasia manual: C{cuit} keep='X' (sap dice 'Y')` en cada corrida del cron — permite ver en logs de GH Actions cuántas fantasías está preservando y cuáles.

**No es un cambio en la app frontend** — el fix vive en el script Python del cron. `APP_VERSION` no cambia. El proximo corrida del workflow `.github/workflows/sync-sap-catalog-stock.yml` a hh:13/hh:43 ya lo va a aplicar.

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

---

## Convenciones del documento

**Cuando se actualice esta app**, mantener este README sincronizado con:
1. Nuevas features → agregar sección o ampliar la existente.
2. Cambios en modelo de datos → actualizar sección 8.
3. Cambios en Firestore Rules → actualizar sección 9.
4. Nuevos roles → actualizar sección 7.
5. Nuevas colecciones → actualizar secciones 8 y 9.
6. Cambios en el lanzamiento (bloqueantes resueltos) → actualizar sección 2.
7. SW version → actualizar el header del documento + sección 41 (Changelog).
8. Cambios en el flow SharePoint / Power Automate → actualizar sección 16-bis + `POWER_AUTOMATE_RENDICIONES.md`.
9. Cambios en `scripts/send_rendiciones_email.py` (estructura del Excel, columnas, tablas) → actualizar el subapartado del cron en sección 16 (Mail Rendiciones).
10. Cambios en SEGUIMIENTO (tabs, heurísticas, scope, status flow) → sección 39.
11. Avance del plan Power BI → sección 40 (resumen) + `PLAN_POWERBI.md` (detalle).

---

**Última actualización**: 2026-07-14 — SW v301. Día intenso con múltiples pedidos del gerente + vendedores + refactor de UX + pipeline BigQuery → Power BI completo + 2 documentos PDF de referencia (Manual técnico + Análisis crítico con roadmap).

Highlights sesión completa 2026-07-14 (detalle en sección 41):

- **📄 2 documentos PDF para sucesor** — `APP SHIMANO MANUAL.pdf` (33 pág) doc técnica completa + `MEJORAS.pdf` (21 pág) análisis crítico con 12 puntos débiles priorizados y roadmap por horizontes. Generadores versionados en `scripts/build_manual_shimano.py` y `scripts/build_mejoras_shimano.py`.
- **🛒 v301 - Modal pedido PENDIENTE con vista previa** — antes solo se veían sugeridos ocupando todo el ancho; ahora layout 2 columnas (sugeridos | pedido ya cargado) para poder comparar. Read-only, editar sigue siendo con "Volver a borrador".
- **🔍 v300 - Buscador de tienda en Visita matchea por fantasía O titular** — label ahora "Fantasía (Titular) — Loc, Prov". Buscar "PALOMETA" encuentra a "ALAN OSCAR NICOLAS RODRIGUEZ (LA PALOMETA BAIT SHOP)".
- **🏪 v299 - Form Visita simplificado: ir directo a tienda** (pedido de vendedores) — sacar el paso de elegir localidad primero. Al elegir tienda, se autocompleta la localidad con badge celeste "📍 Localidad detectada".
- **👥 v298 - Gerente ve todas las visitas + comentarios** (pedido de Pablo por Teams) — fix client-side de 2 líneas, Firestore Rules ya lo permitía.
- **🔧 Bulk import 103 fantasías desde Excel formulario** cruzando por CUIT + fix crítico del sync SAP que las pisaba cada 30 min (mismo patrón v291 con localidad/provincia). Ejemplo: "GABRIEL ALEJANDRO YAMIN" ahora muestra "ARMERIA EL COLORADO" como nombre grande.
- **🗺️ Bulk fix 22 provincias mal cargadas** (bug SAP prod: YAMIN CHUBUT→SALTA, TOMPY CHUBUT→SALTA, etc.) cruzando por CUIT contra Excel formulario, con validación de lista canónica de 24 provincias AR + CABA para no aceptar valores raros como "BS AS" o "7600.0". Sync SAP extendido con protección análoga a fantasía.
- **📧 Suscripción diaria de Power BI por email a Mariano** — Power BI Service manda automáticamente a las 15:00 AR el snapshot del tablero "Desempeño-Pesca" + PDF con todas las páginas. Refresh programado del modelo semántico a las 14:30.
- **📊 Pipeline `v_targets` (Firestore → BigQuery)** — nueva función `sync_targets_from_firestore()` en el cron. Nueva vista `v_targets` con schema pedido: `slp_code, vendedor, anio, mes (1-12), target_ars, _sync_timestamp`. Mapeo vendorKey → SlpCode hardcoded en un CASE (50-55).
- **⚠️ Discrepancia SlpCode confirmada contra SAP prod** — SlpCodes 50-55 NO existen aún en `SHIMANO_SAU` (consultado `/SalesPersons`). Firestore `sap_vendors` tenía mapeo corrido en -1. SEIDOR debe crearlos como parte del lanzamiento.
- **🩹 `v_facturas_sap` sin `lines_json`** — el JSON string gigante hacía explotar VertiPaq en Power BI Desktop y colgaba el refresh 30+ min. Removida esa columna.
- **🔄 Rollback completo del fix "gap huérfano"** en `v_backorder_lineas` — el intento de ampliar `v_sap_items_enriched` para incluir 2287 SKUs BIKE con backorder colgaba Power BI del user. Rollback en 2 pasos (quirúrgico → total). SQL amplio queda en git como referencia (commit `e5cef77`).

Highlights v290→v297 (2026-07-13, frontend, detalle en sección 41):

- **📊 Export Excel de Targets en formato largo** (v297, para SAP / Power BI). Botón verde en el modal Targets → `Targets_Shimano_YYYY-MM-DD.xlsx` con columnas `SlpCode | Vendedor | Año | Mes | Meta`, una fila por (vendedor, mes) con target > 0. SlpCode y Vendedor resueltos desde `sap_vendors`. Detalle en sección 22.
- **✍️ Fix ortográfico "MOSTRADO" → "MOSTRADOR"** (v296, reportado por vendedor). Selects Tipo de venta + Necesidad puntual + label ponderación + Excel exports. Value en Firestore sigue siendo `'MOSTRADO'` (retrocompat), solo se mapea el display.
- **🏷️ Badge Categoría (Cat P/A/B/C) fijo en esquina de card** (v295). En CLIENTES `position:absolute; top:6px; right:8px` — siempre visible sin importar el largo del nombre. En PEDIDOS va en el cluster derecho arriba del Habilitado (para no chocar). `padding-right:62px` reservado en `.client-card`.
- **🔗 Vincular provisorio con BP SAP** (v294). Cuando el auto-match del cron falla (nombre difiere, provisorio sin CUIT), admin va a **Master Clientes → 👤 Provisorios → 🔗 Vincular con SAP** y elige manualmente el BP correcto. Auto-ranking con badge verde "✓ CUIT MATCH" si los CUITs coinciden. `batch.set(provisorio) + batch.delete(bp_duplicado)`. Preserva assignedVendor/approvals/notas. Solo admin (por Firestore Rules).
- **📋 CUIT opcional en form Alta Rápida** (v294). Nuevo input `ar-cuit` normalizado (solo dígitos). Aviso si != 11 dígitos. Blinda el auto-match futuro por CUIT (el sync ya lo consume vía `_norm_cuit()` sin cambios).
- **🐛 Fix tab "NO CONFIRMADOS" mostraba 3 items cuando el KPI PENDIENTES decía 16** (v293). El filtro descartaba provisorios sin provincia y los que tuvieran geo+addr. Ahora todo provisorio (`manualSapPending && !cardCodeSap`) siempre pasa el filtro "pendientes" y no requiere provincia. Bonus: badge naranja "⚠️ sin provincia" en lugar de `/` suelto.
- **🐛 Fix `sync_sap_to_firestore.py` pisaba localidad/provincia manuales** (v291, 2026-07-13 mañana). El sync cada 30 min hacía `set(merge=True)` con string vacío si SAP no traía valor → destruía el trabajo manual del admin en Master Clientes. Fix: `base_payload.pop('localidad', None)` si `bp.City` viene vacío, mismo para provincia.
- **💾 Autosave debounced en localidad/provincia/dirección del Master Clientes** (v291, filas SAP). Guarda 900ms después del último tipeo. El listener de `approvedAltasList` ya no re-renderea si hay saves en vuelo (evita perder texto por race con el snapshot).
- **👤 Botón "Provisorios" violeta en Master Clientes** (v290). Filtra altas rápidas pendientes de SAP (`manualSapPending && !cardCodeSap`). Badge de conteo en tiempo real. Tabla dedicada `renderMcProvisoriosTable()` con columna "Acción" (v294).

Highlights v282→v289 (BigQuery views para hoja Inventario + sync BPs pesca, 2026-07-08→2026-07-12):

- **📊 Vistas nuevas `v_ventas_lineas` + `v_backorder_lineas` para hoja "Inventario" de Power BI** (2026-07-10). `v_ventas_lineas` explota `lines_json` de facturas con `LEFT JOIN` a `sap_items_raw` para tener familia/subfamilia + flag `is_pesca`. `v_backorder_lineas` idem sobre `sap_orders_raw` (SO abiertas) con `LEFT JOIN` a próximos PO por SKU para columna `prox_embarque_date` y estado ASIGNADO/SIN ASIGNAR.
- **🩹 Parche encoding + familias manuales en `v_ventas_lineas`/`v_backorder_lineas`** (2026-07-12). El catálogo embebido en `index.html` perdió acentos/eñes (bytes latin-1 leídos como UTF-8 → `U+FFFD`). Parche con REPLACE encadenados en las views SQL para mostrar `Caña`/`Tamaño`/`Acción`/etc correctos en Power BI. Además, 7 SKUs pesca reales facturaron `~1.96M ARS` con `familia=''` (sin match en catálogo): parche manual con `CASE WHEN item_code IN (...)` mapea `CVC66H2CSA`, `CVC66MH2`, `CVC66MH4SACO`, `FXPR410`, `12843-01`, `55CRT12524` → `CAÑAS`; `471512` → `FG`. Fix definitivo pendiente en el build del catálogo maestro (`_build_argentina_zonas_v2.py`).
- **🔍 Scripts diagnóstico** (`scripts/check_ventas_facturado.py`, `scripts/investigate_pesca_sin_familia.py`, `scripts/check_encoding_bytes.py`). El primero mide cobertura de familia + top SKUs por unidades/facturado. El segundo lista SKUs `is_pesca=TRUE` con `familia=''` para identificar los que faltan en el catálogo. El tercero valida con `TO_HEX(CAST(x AS BYTES))` que los bytes UTF-8 en BQ son correctos (`0xC3B1=ñ`, `0xC3B3=ó`) — útil porque PowerShell renderiza los `�` aunque los datos estén bien.

Highlights v282→v288 (changelog detallado en sección 41 — sync BPs pesca + BigQuery + Power BI):

- **🎯 Sync automático de BPs pesca de SAP → app** (v282-v288, 2026-07-08). Nueva función `sync_bp_pesca()` dentro del cron cada 30 min. Filtro correcto (v288): `U_DIVISION IN ('2', '3', 'PESCA', 'BIKE & PESCA')` — los códigos internos del dropdown en SAP son 1=BIKE, 2=PESCA, 3=BIKE&PESCA. Provincia canónica poblada desde lookup a `/States?filter=Country eq 'AR'` para convertir código interno (`'2'`) a nombre (`'SALTA'`). ~103 BPs pesca sincronizando cada 30 min. Ver sección **40-bis** con contexto histórico + comportamiento del upsert + 15 iteraciones que llevaron al fix definitivo.
- **📊 Fase 1.2 SAP → BigQuery completa** (2026-07-08). Nuevo `scripts/sync_sap_to_bigquery.py` + workflow `.github/workflows/sync-sap-to-bigquery.yml`. 4 tablas SAP en dataset `shimano_app`: `sap_bp_raw`, `sap_items_raw`, `sap_invoices_raw`, `sap_quotations_raw`. Full snapshot cada 30 min con `WRITE_TRUNCATE`.
- **📊 Fase 2 vistas curadas BigQuery** (2026-07-08). Archivo `bigquery/views.sql` con 4 vistas SQL: `v_pedidos_header`, `v_pedidos_lines` (con `UNNEST` del array lines), `v_visitas`, `v_facturas_sap` (con `LEFT JOIN` BPs). Aplanan el JSON de las Extensions con `JSON_VALUE`, tipado con `SAFE_CAST`, columnas en snake_case latino natural. Listas para Power BI sin `JSON_VALUE()` en cada medida.
- **📊 Fase 3 Power BI Desktop conectado** (2026-07-08). Modo Import con las 4 vistas + `sap_items_raw` + 2 tablas auxiliares (`Vendedores`, `Origenes`). 12+ medidas DAX básicas. Dashboard "Resumen-Desempeño" en armado: gauges de Facturación mensual y % Cumplimiento, cards de KPIs principales, bar charts por Día/Región/Origen. Ver sección 40 con lista completa de medidas y visuales.
- **↩️ Volver a Pendientes desde Confirmados** (v283, solo admin/gerente). Botón naranja en el footer del modal cuando el pedido está en Confirmados. Si el pedido ya se transfirió a SAP, aviso explícito que la Sales Quotation en SAP NO se elimina (hay que cancelarla manualmente). Guarda auditoría en `revertedFromConfirmedAt`, `revertedBy`, `previousSapDocNum`.
- **🔗 Cards del header y contador de lista COINCIDEN** (v283, opción A elegida). `updateContactSummary()` ahora usa `effClients`/`effProspects` (misma lógica que `updateStats`). Antes contaba clientes del padrón viejo sin CardCode SAP; ahora ambos indicadores muestran solo SAP-confirmados. Fin de la discrepancia "97 / 137 habilitados" vs "TIENDAS 109".
- **🐛 Fix `approvedAltas` listener con fallback defensivo** (v283). Cuando el sync o el admin agregaba clientes nuevos, las 4 cards del header no se actualizaban silenciosamente si `drawMarkers()` throweaba. Fix: log explícito del error + fallback que llama `updateStats(filteredPoints())` directo.

Highlights v277→v281 (changelog detallado en sección 41):

- **📊 Fase 1.1 pipeline Power BI COMPLETA** (2026-07-07). 7 instancias de la Firebase Extension `firestore-bigquery-export` sincronizando en tiempo real → dataset `shimano_app` en `southamerica-east1`. Backfill del histórico ejecutado con `fs-bq-import-collection`: 264 documentos importados (pedidos, visits, client_master, sap_clients, client_applications, rendiciones, campaigns). Cada write futuro se sincroniza automáticamente sin código adicional. Detalles + troubleshooting en sección 40.
- **🔍 Buscador con lupa en modal Revisá tu pedido** (v281). Input arriba del listado que filtra por código o descripción. Los totales NO se ven afectados (siguen sumando sobre TODO el pedido). Contador "N de M productos" + botón (×) para limpiar. Útil para pedidos Excel de ~150 SKUs donde scrollear era tedioso.
- **⚠ Excel: SKUs no encontrados se incluyen con badge REVISAR EN SAP** (v280). Antes se descartaban silenciosamente si no matcheaban exactos con el catálogo. Ahora se agregan igual con `needsReview: true`, fondo amarillo en el review, badge `🔍 REVISAR EN SAP` y precio 0. Admin los ve claros antes de cargar a SAP. También se agregaron flags `hasSkusToReview` + `skusToReviewCount` al pedido para poder filtrar en BigQuery. Bonus: matching case-insensitive contra el master para reducir falsos negativos por capitalización (`glf-26b1ue` matchea `GLF-26B1ue`).
- **🐛 Fix pedido aparece y desaparece en Pendientes** (v279). Cuando Firestore rechazaba el `pedidos.add()` por permisos, el fallback local pushea a `pending[]` local y el pedido aparecía momentáneamente en la pestaña PENDIENTES. Cuando el listener del snapshot rerenderizaba, la lista se refrescaba y "desaparecía". Ahora: si el error es `permission-denied` no se toca `pending[]` local — el borrador queda vivo en "En curso" con alert claro incluyendo email + cliente + error code. **Fix relacionado en Firestore Rules**: interno (VDI) ahora puede crear/editar/borrar sus PROPIOS pedidos (`onBehalfOf: false` + `ownerUid == request.auth.uid`), no solo en nombre de VDE pareja como antes.
- **🚀 "Pasar a Pendientes" ahora pasa DIRECTO** (v278). Antes había un paso intermedio con diálogo de mes/año (`.confirm-dialog`) que en el flujo Excel resultaba INVISIBLE por bug de CSS `position:absolute` anidado. El pedido quedaba en `orders[]` como "En curso" y el vendedor no entendía por qué. Ahora `validateReviewAndPasarAPendientes` popula el mes/año actual y llama directo a `doConfirmPedido` — el vendedor ve el `confirm()` nativo del navegador. Si necesita cambiar el mes/año lo edita después. Bonus defensivo: CSS de `.confirm-dialog` cambió a `position:fixed;z-index:9999` para que si algún flujo futuro lo abre, no quede invisible.
- **✨ Auto-clear del banner de error en modal review** (v277). Cuando el vendedor completaba los campos faltantes (Forma Pago, Forma Entrega, direcciones), el banner rojo quedaba stuck aunque el error ya no aplicara. Nueva función `revalidateReviewSilently()` chequea el estado completo en cada `onchange`/`oninput` y limpia el banner cuando todo está OK. No introduce errores nuevos — solo LIMPIA silenciosamente.

Highlights v253→v276 (changelog detallado en sección 41):

- **💰 Sync automático de precios desde SAP** (v268). Extendido el `sync_sap_to_firestore.py` para traer precios de la **lista PESCA #12 ARS** cada 30 min. Antes: precios congelados desde la última carga manual (629 SKUs desactualizados) porque el botón PRECIOS del header se eliminó en v240 y la lógica quedó huérfana. Ahora: cuando administración carga un precio en SAP, aparece en la app en máximo 30 min sin acción manual. Filtro server-side por Item Group PESCA (Number=102, resuelto dinámicamente) → 755 items en el catálogo (antes 665 con SKUs invisibles).
- **Precios TEMPORALES** (v270). Admin/gerente puede asignar un precio temporal a SKUs sin precio en SAP desde el modal Master de Productos. Prioridad SAP > temporal (cuando SAP tiene precio, gana automático). Nuevo checkbox "Solo sin precio" para filtrar la lista de trabajo. Badge amarillo `⏱ TEMPORAL` en cards. Coleccion `app_config/price_list_temporal`.
- **Forma de entrega en pedidos** (v269, v271, v273). Nuevo dropdown obligatorio "Forma de entrega" en el modal review con 2 opciones: **TRANSPORTISTA** (3 campos: nombre + dirección del transportista + dirección de entrega al cliente) y **SUCURSAL** (dirección de entrega). Se agrega al Remarks del Sales Quotation SAP (mientras Ezequiel Mendoza no cree UDFs dedicados). Aplicado a Service Layer y DTW CSV.
- **VISITAS mejorado** (v274). Fotos ahora se pueden cargar desde galería (removido `capture="environment"` en los 4 inputs) + accept HEIC/HEIF para iPhone. Selects de Localidad/Tienda reemplazados por un componente **filter-select** custom con búsqueda escribiendo (tolerante a mayús/minús y acentos: "cordoba" matchea "Córdoba"). Enter selecciona primer match, Escape cierra.
- **Vendedores ven cantidad exacta de stock** (v253-v260). Antes solo admin/gerente porque requería login SL desde el browser. Nueva key `quantities` en el snapshot Firestore (serializada como JSON string para evitar el límite de 40k index entries por doc). Botón "Stock" unificado para todos los roles.
- **Alta rápida ahora en VISITAS y RUTAS** (v267). Antes las provisorias con `manualSapPending` sin dirección no aparecían en RUTAS (filtro exigía calle/address) y case-sensitivity en VISITAS (Balcarce vs balcarce). Ambos corregidos.
- **Búsqueda por fantasía en CLIENTES y PEDIDOS** (v265). Los buscadores matchean también el nombre del local (fantasía) además del titular. Ej: "Pescaplay" encuentra al cliente aunque el titular sea "Juan Pérez".
- **Badge de categoría (P/A/B/C) en cards** (v264, v266). Colores por tipo. Fix: para clientes SAP el `cliTipo` está en `client_applications`, no en `client_master`. Helper chequea ambas fuentes.
- **Fixes flujo pedidos** (v272, v275, v276). v272: banner rojo visible en modal review cuando falta forma de pago/entrega (antes salía alert después de cerrar el modal y el vendedor no lo veía). v275: defensive contra `currentOrderClient` null post-Excel + logs de diagnóstico. v276: fix CANCELAR pedido que no vaciaba realmente el borrador — Firestore deep merge no borraba las keys removidas localmente, ahora se usa `FieldPath` + `FieldValue.delete()`.
- **Otros ajustes UI mobile** (v261-v263): botón Guardar Serie APP centrado; fix inputs date en Safari iOS; botón Eliminar visita en MIS VISITAS.

Highlights v218→v252 (changelog detallado en sección 41):

- **🎯 Sync automático SAP → Firestore + stock.json cada 30 min via GitHub Actions** (v246). Fin del CSV manual de David. `sync_sap_to_firestore.py` corre en cron `13,43 * * * *`, escribe `product_catalog` (665 items filtrados por categorización) + `app_config/stock_snapshot` + `stock.json` en el repo. El bot Inventario-Bot de Google Sheet ahora lee datos frescos vía `raw.githubusercontent.com`.
- **Stock real de warehouses vendibles** (v244). Antes se filtraba solo W07 (PESCA EEUU, casi vacío) → `withStock: 2`. Ahora suma todos EXCEPTO W05 (Marketing) y W06 (Devoluciones) → `withStock: ~3.459` reales.
- **Sync de catálogo desde SL** (v235-v240). Master de Productos con búsqueda live + consulta stock on-demand por SKU. Elimina dependencia de mantener PRODUCTS hardcoded.
- **Envío directo a SAP via Service Layer** (v219-v220). Botón manual + toggle auto-envio (pedido confirmado → Sales Quotation automático). CORS + usuario SL resueltos.
- **Fix perf DISPONIBLES en picker** (v245). Antes con 10k SKUs bloqueaba el thread ~113M ops. Ahora flag O(1).
- **Fix WhatsApp ruta en iOS** (v248). GPS con `enableHighAccuracy: false` + timeout 5s + `window.open` placeholder para no perder user gesture.
- **Precaución solo admin/gerente** (v249). Info sensible oculta a vendedores.
- **Fix contador habilitados inconsistente** (v250). Header y sub-título ahora coinciden.
- **MIS RENDICIONES clickeables** (v251). Vendedor puede ver detalle + foto del ticket de rendiciones pasadas.
- **UI ajustes mobile varios** (v226-v233): resaltado precaución en pedidos, hamburger menu, botones centrados, modal Zonas full-screen.

Highlights v204→v217 (histórico anterior):
- **SEGUIMIENTO** — panel comercial completo para admin/gerente/interno, 7 tabs + Timeline cliente + notas internas + 2 colecciones Firestore nuevas (v209-v212).
- **Gerente desbloqueado** — `canWrite()`, CAMPAÑAS, SAP, lee todos los pedidos, edita rutas, recalcular contornos (v205/v208/v213/v214/v215).
- **Card precaución más visible** (v206) y **progreso de campañas global** (v207).
- **TARGETS-ZONAS reescrito** — solo BPs vivos con CardCode SAP, columna CARDCODE SAP. "Exportar para Análisis" solo Mariano (v208).
- **Rendiciones v2 (Híbrida Opción C)** — TablaGastos agrupada por dupla `(vendedor, tipoGasto)`, hoja Detalle nueva sin agrupar, fotos pre-subidas a Firebase Storage y concatenadas con `;`. Bucket `<project>.firebasestorage.app` (post-2024). Power Automate flow rearmado con HTTP GET de fotos (Premium) + idempotencia por Title (v217).
- **Fix tildar pedido bloqueado en SAP** (v216) y **botón ZONAS sin emoji** (v214).
- **Infra externa nueva** — **Firebase Blaze** activo, **Firebase Storage** inicializado, **BigQuery dataset** `shimano_app` creado, **Power Automate Premium** trial 90 días. Plan Power BI 4 días.

Histórico previo (v197-v203): Sidebar Localidades amplió a altas SAP + modal localidad (v198), burbujas agregadas OFF (v199), Master Clientes botón Eliminar 🗑 (v200), Modal Zonas gerente + scope provincia + toast (v201/v203), mail Rendiciones cron Lun/Mie (v202), SharePoint + Power Automate schema v1 (v203).
