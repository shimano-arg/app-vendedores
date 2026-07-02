# Shimano App Vendedores — Documentación técnica completa

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
| **Versión actual** | SW v252 |
| **APP_VERSION** | `v252` (sincronizada con `sw.js` CACHE_VERSION; banner en console al arrancar + chequeo HTML vs SW) |
| **Firebase plan** | **Blaze** activo (necesario para Storage + extensions BigQuery) |
| **Pipeline Power BI** | Firestore → BigQuery (extension `firestore-bigquery-export`) → Power BI Service — **en armado, Día 1 hoy** (ver `PLAN_POWERBI.md`) |
| **Sync SAP automático** | Service Layer → Firestore + `stock.json` cada 30 min (cron GH Actions `13,43 * * * *`) — ACTIVO desde v246 (2026-07-01) |
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
41. [Changelog v204 → v252](#41-changelog-v204--v252)

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
├── sw.js                     # Service Worker (v252)
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
├── scripts/
│   ├── sync_sap_to_firestore.py  # (v246+) SL login → itera Items?$expand=... →
│   │                             #  escribe product_catalog (665 items filtrados
│   │                             #  con cat/fam/sub) + app_config/stock_snapshot
│   │                             #  + stock.json en el repo. Usado por el cron
│   │                             #  y dispatch manual desde Actions.
│   ├── sync_stock.py             # LEGACY. Procesa CSV manual de David. Queda
│   │                             #  por si hay que restaurar el flujo viejo.
│   └── send_rendiciones_email.py # Genera Excel (Gastos agrupado + Detalle + Solicitudes) + sube fotos a Firebase Storage + manda mail
├── PLAN_POWERBI.md               # Plan 4 días Firestore → BigQuery → Power BI
├── POWER_AUTOMATE_RENDICIONES.md # Doc operativo del flow de SharePoint (schema v2 de TablaGastos)
├── Roadmap_Integracion_App_SAP.md
├── Solicitud_SEIDOR_Integracion_App.md
├── Pitch_Lunes_App_Vendedores.md
└── README.md                     # Este archivo
```

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
  cuit: "30-12345678-9",
  condicionFiscal: "Responsable Inscripto",
  calle: "Av. Corrientes",
  numero: "1234",
  localidad: "Palermo",
  provincia: "BUENOS AIRES",
  localidadFinal: "Palermo",     // override del aprobador si la declarada no matcheaba
  cardCodeSap: "C-12345",        // cargado por el aprobador
  assignedVendor: "FEDERICO CASTELANELLI",  // cargado por el aprobador
  constanciaArca: "data:image/...",
  constanciaIIBB: "data:image/...",
  fotosLocal: ["data:image/...", ...],
  status: "pending_approval" | "approved" | "rejected",
  source: "manual" | "sap_bulk_import" | "alta_rapida",
  manualSapPending: true,         // si vino por alta_rapida y todavía no se cargó a SAP
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
| `pedidos` | todos los readers | admin / vendedor (su propio) / VDI en nombre del VDE pareja |
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
- Necesidad puntual.
- Tipo de venta: Casa de pesca, ecommerce, mixto.
- % Mostrado / % Ecommerce (sliders 0-100).
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

1. Sub-tab **"Alta rápida"** → formulario corto: comercio, dirección, **provincia + localidad obligatorias**, dueño.
2. Crea un documento en `client_applications` con:
   - `source: 'alta_rapida'`
   - `manualSapPending: true`
   - `status: 'approved'` (la app no exige doble aprobación para alta rápida).
3. **Notifica automáticamente a admin** (`type: 'alta_rapida_creada'`) con texto "X dio de alta rápida a ... — hay que cargarlo manualmente en SAP".
4. La tienda aparece **al instante** en:
   - Mapa (pin SAP).
   - Picker de Pedidos (`buildPedidoVisibleKeysSet`).
   - Visitas (dropdown localidad + tienda).
   - Rutas (picker custom).
5. Se identifica con badge **"⚡ PROVISORIO (cargar a SAP manual)"** + fondo crema en todas las vistas.
6. Admin más tarde la carga formalmente a SAP, le pone `cardCodeSap`, y `manualSapPending` queda `false`.

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

Gerente carga el target de facturación en USD para cada mes:
- Julio 2026 USD
- Julio-Diciembre 2026 USD
- Anual 2027 USD

Tipo de cambio se carga desde el master. Targets en ARS se calculan automáticamente.

Dashboard muestra % de cumplimiento del mes contra target.

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
5. Filtra los items a escribir al catálogo por los que tienen `cat/fam/sub` en el CSV inline de `index.html` (665 items de pesca). El resto (~10.000 SKUs de bici/otras líneas/inactivos) NO se escribe al catálogo → no ensucian el picker del vendedor.
6. Escribe a Firestore:
   - `product_catalog/chunk_N` (665 items en chunks de 4000)
   - `app_config/product_catalog_meta` (dispara listener)
   - `app_config/stock_snapshot` con `{stock: {SKU: bool}, warehouse: 'ALL_SALES', ...}`
7. Escribe también `stock.json` en la raíz del repo y hace commit si cambió (consumido por el Google Sheet Inventario-Bot — ver sección específica).
8. Cliente: `ensureStockSnapshotListener` y `ensureProductCatalogListener` reciben los cambios en tiempo real. `PRODUCTS` en memoria se reemplaza con los 665 items del catalog. `STOCK_MAP` se actualiza con los bools.

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

**En armado, Día 1 hoy 2026-06-30**. Doc completo en `PLAN_POWERBI.md` (588 líneas, 4 días de plan).

### Objetivo

Tablero Power BI alimentado real-time (5-30s de lag) desde Firestore para que Diego, Pablo y Mariano vean performance comercial sin esperar exports manuales.

### Arquitectura

```
Firestore (app vive aquí)
   ↓ Firebase extension "firestore-bigquery-export" (una instancia por colección)
BigQuery dataset shimano_app (us-central1)
   ↓ Vistas SQL planas (aplanan el JSON crudo)
Power BI Desktop → publish → Power BI Service
   ↓ Refresh DirectQuery o cada 30 min
Workspace "Shimano Vendedores" (viewers: Mariano, Diego, Santiago Beron, Pablo, Ioannis)
```

### Colecciones que se sincronizan

6 instancias de la extension `firestore-bigquery-export`:

| Colección Firestore | Tabla raw BigQuery | Vista SQL plana |
|---|---|---|
| `pedidos` | `pedidos_raw_changelog` + `pedidos_raw_latest` | `pedidos_view` + `pedido_lines_view` |
| `visits` | `visits_raw_*` | `visits_view` |
| `client_applications` | `client_applications_raw_*` | `client_applications_view` |
| `campaigns` | `campaigns_raw_*` | `campaigns_view` |
| `targets` | `targets_raw_*` | `targets_view` |
| `roles` | `roles_raw_*` | `roles_view` |

**Fuera de alcance fase 1**: rendiciones (ya en SharePoint), stock (snapshots), audit log (privacy review pendiente), backups de fotos.

### Estado checklist (Día 1 — 2026-06-30)

- [X] Project ID confirmado (`app-vendedores-shimano`).
- [X] Login GCP Console con `erbinomariano@gmail.com`.
- [X] BigQuery API habilitada.
- [X] Dataset `shimano_app` creado en us-central1.
- [X] Plan **Blaze** activo (paso bloqueante para extensions + Storage).
- [ ] Instalar 6 instancias `firestore-bigquery-export`.
- [ ] Backfill histórico de cada colección.
- [ ] Crear 6 vistas SQL planas (queries en Apéndice A de `PLAN_POWERBI.md`).
- [ ] Smoke test SQL (contar pedidos / facturación / top SKUs vs Dashboard de la app).
- [ ] Configurar budget alert en GCP a 25 USD/mes.

### Próximos días

- **Día 2 (mañana 01/07)**: Service Account `powerbi-reader` + Power BI Desktop + cargar vistas + modelar relaciones + medidas DAX + páginas Resumen / Pedidos.
- **Día 3 (02/07)**: páginas Visitas / Campañas + publish a Power BI Service + asignar viewers.
- **Día 4 (03/07)**: demo a Diego + Pablo + ajustes finales + capacitación de uso.

### Viewers del workspace

- **Mariano Erbino** (admin) — `mariano.erbino@shimano.com.ar`
- **Diego Valsi** — `diego.valsi@shimano.uy`
- **Santiago Beron** — `santiago.beron@shimano.uy`
- **Pablo Maraschin** — email pendiente confirmación
- **Ioannis Palkoudakis** — email pendiente confirmación

---

## 41) Changelog v204 → v252

Solo las versiones nuevas — el histórico anterior está en la última entrada de la sección 38 (Hecho recientemente) y al pie del documento.

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

**Última actualización**: 2026-07-02 — SW v252. Highlights v218→v252 (changelog detallado en sección 41):

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
