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
| **Versión actual** | SW v197 (commit `259ed55`) |
| **APP_VERSION** | `v197` (sincronizada con `sw.js` CACHE_VERSION; banner en console al arrancar + chequeo HTML vs SW) |

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
[X] Export Rendiciones mensual con foto embebida (ExcelJS) + columnas SAP
[X] Export Visitas mensual con foto del frente embebida (ExcelJS)
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
[X] PWA con SW v197 + login bg con foto del río
[X] Boton "Forzar actualizacion" (↻) + "Reubicar pines" (📍) + "REFRESCAR APP" mobile
[X] Banner version + chequeo sync HTML vs SW en console al arrancar
[X] Botón Recalcular Rutas en la pestaña Rutas
```

### Bloqueantes externos para el lanzamiento

| # | Bloqueante | Responsable | Estado |
|---|---|---|---|
| 1 | **CORS habilitado en Apache** delante del Service Layer | Alejandro Caracchi (SEIDOR) | ⏳ Email enviado |
| 2 | **Usuario integración** en SAP (licencia Limited CRM o Logistics) | Juan (IT Shimano) | ⏳ Email enviado |
| 3 | **UDFs + Serie APP 103 en PROD** (SHIMANO_SAU) | Ezequiel Mendoza (SEIDOR) | ⏳ Pendiente |

### Plan de contingencia

Si alguno de los 3 bloqueantes no llega a tiempo para el lanzamiento, **arrancamos con el ZIP DTW manual** que ya está probado y funcional. Admin descarga el ZIP de pedidos confirmados, lo importa en DTW, los pedidos entran como Quotations. Lento pero confiable. El DTW manual queda como **backup permanente** incluso cuando Service Layer esté operativo.

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
├── sw.js                     # Service Worker (v57)
├── login-bg.jpg              # Foto de fondo del login (río al amanecer)
├── stock.json                # Snapshot del stock SAP (placeholder hoy)
├── Shimano-Logo.png          # Logo (header + splash)
├── icon-180-v3.png           # PWA icon iOS 180×180
├── icon-192-v3.png           # PWA icon Android 192×192
├── icon-512-v3.png           # PWA icon 512×512 (any)
├── icon-512-maskable-v3.png  # PWA icon 512×512 (maskable Android adaptive)
├── .github/
│   └── workflows/
│       └── sync-stock.yml    # Cron 30min: sync stock CSV → stock.json
├── scripts/
│   └── sync_stock.py         # Procesa CSV exportado de SAP → JSON
└── README.md                 # Este archivo
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
# Bumpear sw.js: CACHE_VERSION = 'v57' → 'v58'
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
| **`admin`** | Mariano, Diego | Todo: panel admin, modal Zonas, Master Clientes, SAP, Stock, Backup, Targets, aprobar altas, Auditoría |
| **`gerente`** | Cargo gerencial | Casi todo lo de admin **excepto** USUARIOS, STOCK, PRECIOS y AUDITORIA. Ve todo el mapa, aprueba Altas Clientes, aprueba Rendiciones, edita Master Clientes (con campos restringidos), reubica pines |
| **`vendedor`** | VDEs (Mauricio, Martin, Gonzalo, Federico) | Ver SOLO su zona, crear pedidos/visitas propios, cargar Alta Cliente |
| **`interno`** | VDIs (Santiago, Ioannis) | Ver zonas de sus VDEs pareja, crear pedidos/visitas en nombre del VDE pareja |
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

20 colecciones activas en el proyecto `app-vendedores-shimano` (la 20va es `custom_routes`, agregada en v182+):

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

Helper `isMyPartnerVDE(targetUid)`: para que un VDI pueda actuar en nombre de un VDE solo si el VDE tiene a ese VDI como `internalPartnerUid`. Esto bloquea que un VDI cualquiera cargue pedidos a nombre de cualquier VDE.

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
- Botones (derecha): **Campañas Activas** (amarillo) / **Exportar para Análisis** (verde) / **Exportar a Excel** (celeste) / **Zonas** (azul marino)

### Cuerpo
- **Mapa Leaflet** (izquierda, ocupa gran parte de la pantalla).
- **Sidebar derecha** con tabs: Localidades / Clientes / Pedidos / Rutas / Visita / Dashboard / Rendiciones / Alta Clientes / Notificaciones.

### Controles topleft del mapa (debajo de zoom Leaflet)

- **↻ Forzar actualización**: hace `unregister()` del SW, limpia caches y recarga con cache-bust. Útil cuando el banner del console marca DESYNC HTML vs SW.
- **📍 Reubicar pines** (solo admin/gerente): triggea `runBulkGeocodeSapAltas()` para correr geocoding bulk de altas SAP que no tengan lat/lng.

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

---

## 12) Sección: Localidades / Clientes / Pedidos

### Localidades

Tab "Localidades" del sidebar. Lista todas las localidades visibles según los filtros del header, ordenadas por cantidad de tiendas.

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

### Export Rendiciones mensual (NUEVO)

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

Admin crea campañas con:
- Nombre + descripción.
- Fechas vigencia (desde / hasta).
- SKUs incluidos.
- Zonas / vendedores aplicables.

En el picker de productos del pedido, los SKUs en campaña activa aparecen marcados con badge **★ CAMP**.

Tab "Campañas Activas" (botón amarillo del header) muestra el detalle.

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

Solo admin. Botón violeta **🗺️ Zonas** en el header.

### Tabs

1. **Por tienda**: lista de cada tienda con dropdown para cambiar de vendor.
2. **Por localidad**: igual pero a nivel localidad (afecta todas sus tiendas).
3. **Historial**: últimos 50 cambios con quién, cuándo, de quién a quién.

### Destinos disponibles

- **Vendedores externos** (VDE): los 4 reales (Mauricio, Martin, Gonzalo, Federico).
- **Vendedores internos** (VDI): Ioannis, Santiago.
- **Otros (admins)**: cargados de Firestore con rol `admin`.
- **DISTRIBUIDOR**: sale de venta directa, aparece solo en filtro Distribuidores.

### Persistencia

Colección `vendor_overrides/{docId}`. Listener `ensureVendorOverridesListener` aplica los cambios en tiempo real:
- **Override de localidad**: muta `p.vendor` del POINT → automáticamente afecta el filtro, marker color, contadores.
- **Override de tienda**: `getEffectiveVendorForClient(p, name)` lo respeta en `effClients(p)`, `filteredPoints()`, y `deptStyle()` (via `deptEffectiveVendor`).

### Distribuidor en deptStyle

Cuando el vendor mayoritario de un dept es `__DISTRIBUTOR__`, **solo se pinta azul si el filtro Tipo = Distribuidores está activo**. Sino, ignora `__DISTRIBUTOR__` del conteo y usa el segundo vendor mayoritario (o el original del Excel).

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

### Vía 1: CSV manual (panel admin "Stock")

Estado: **OPERATIVO**.

1. Admin exporta query de SAP B1 Query Generator:
   ```sql
   SELECT "ItemCode", "OnHand" FROM OITW WHERE "WhsCode" = '07'
   ```
2. Guarda como CSV UTF-8.
3. Botón **Stock** del header → arrastra el CSV al drop zone.
4. Preview con stats: total SKUs / con stock / sin stock.
5. **Publicar a la app** → escribe a `app_config/stock_snapshot`.
6. Listener `ensureStockSnapshotListener` actualiza `STOCK_MAP` en tiempo real para todos los usuarios.
7. Picker de productos refresca con verde/rojo.

Frecuencia recomendada: 3x día hasta que esté Service Layer.

### Vía 2: Service Layer real-time (preparado)

Cuando esté habilitado SL:
- `sapSL.getStock(itemCode, '07')` consulta directamente.
- No requiere CSV.
- Refresh transparente al abrir el picker o cada N segundos.

### Fallback estático

`stock.json` del repo. Se mantiene como fallback histórico para que la app no quede sin info de stock si Firestore no responde.

### Workflow GitHub Actions

`.github/workflows/sync-stock.yml` corre cada 30 min. Si está configurado el secret `SAP_STOCK_CSV_URL`, descarga el CSV de la URL pública (Drive) y actualiza `stock.json`. Hoy queda como sistema legacy desde que tenemos el upload manual + listener Firestore.

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

Botón **Exportar para Análisis** (verde) → 5 opciones avanzadas:
- **Power BI** (fact + dim tables).
- **Python / IA / ML** (tabla larga).
- **Fotos de visitas (ZIP)**.
- **Excel con fotos embebidas**.
- **Excel TARGETS-ZONAS (con altas)** ← genera el formato del Excel master con todas las tiendas + altas aprobadas integradas.
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
- `Shimano App v197 — <timestamp ISO>` (banner con styled console.log).
- **Chequeo de sync**: fetcheaq `sw.js`, parsea su `CACHE_VERSION` y compara con `APP_VERSION` del HTML.
  - Si coinciden: `[version] HTML v197 === SW v197 OK` en verde.
  - Si difieren: `[version] DESYNC: HTML=v197 vs SW=v196 - tocar ↻ en el mapa para refrescar` en rojo.

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

## Convenciones del documento

**Cuando se actualice esta app**, mantener este README sincronizado con:
1. Nuevas features → agregar sección o ampliar la existente.
2. Cambios en modelo de datos → actualizar sección 8.
3. Cambios en Firestore Rules → actualizar sección 9.
4. Nuevos roles → actualizar sección 7.
5. Nuevas colecciones → actualizar secciones 8 y 9.
6. Cambios en el lanzamiento (bloqueantes resueltos) → actualizar sección 2.
7. SW version → actualizar el header del documento.

---

**Última actualización**: 2026-06-29 — SW v197 / commit `259ed55` / agrega Rutas personalizadas, Alta rápida, Vista preliminar con subtotales de stock, login Microsoft + Email/password + Magic link, reset password Firebase, 2FA opcional, outlines híbrido provincia+dept, `PROVINCE_VENDOR_OVERRIDE` (SAN LUIS → Martin), dropdown provincia editable en Master, botones de refresh + reubicar pines, banner versión + chequeo HTML vs SW, export Visitas/Rendiciones con fotos embebidas (ExcelJS), delete de notificaciones por target, delete de altas propias sin SAP, fix gerente ve todo el mapa, fix rules rendiciones via users_directory.
