# Mobile Bottom Navigation — Design Spec

- **Fecha**: 2026-08-07
- **Autor**: Mariano Erbino + Claude (brainstorming skill)
- **Target release**: v429 (rama `dev` → PR squash a `main`)
- **Scope**: mobile UX + consolidación de botones desktop

## Contexto y objetivo

Hoy en mobile, la App Vendedores muestra un toolbar superior con 9 tabs (`locs`, `clients`, `pedidos`, `rutas`, `visita-action`, `contactado-action`, `rendiciones`, `altacli`, `notif`) más 4-6 botones en `controls-right-group` (Campañas Activas, Dashboard, Exportar a Excel, Backorder, Forecast, etc.). La pantalla queda cargada y los flujos operativos frecuentes (armar pedido, cargar visita, consultar stock de un SKU) requieren varios taps y scrolls horizontales por la toolbar.

**Objetivo**: dar al vendedor una barra de navegación inferior fija estilo "liquid navigation" con acceso directo a los 5 flujos que más usa, ocultando la toolbar superior. Meta secundaria: consolidar 3 botones dispersos (Campañas Activas, Exportar a Excel, Rendiciones) en un solo botón "Herramientas" que aplica en desktop y mobile.

**Fuera de scope**:
- Refactor a un router client-side.
- Agregar acción "agregar SKU al pedido" desde el modal Productos (queda para v2).
- Redesign completo del app-shell — solo bottom-nav + hamburger + consolidación de Herramientas.

## Decisiones tomadas en brainstorming

| Pregunta | Decisión |
|---|---|
| ¿Toolbar superior mobile? | Ocultarlo completo (`@media max-width:768px`) |
| ¿Qué muestra el FAB Home? | Mapa (`setTab('locs')`) |
| ¿Acceso a Rutas/Rendiciones/Alta/Notif en mobile? | Hamburger `≡` en header con badge global de notificaciones + side-drawer |
| ¿Consolidación botón Herramientas? | Global (desktop + mobile) |

## Arquitectura

### Componentes nuevos

1. **`<nav id="mobile-bottom-nav">`** — barra fija `position:fixed; bottom:0`, pill dark, 5 slots. HTML siempre presente; visibilidad controlada por `@media`.
2. **`<button id="mobile-header-hamburger">`** — ícono `≡` en el header actual con badge de notificaciones global. Abre el drawer.
3. **`<aside id="mobile-drawer">`** — side-drawer que despliega de izquierda con Rutas / Rendiciones / Alta clientes / Notificaciones. Cada opción delega a `setTab(...)`.
4. **`<div id="cargar-sheet">`** — bottom-sheet "¿Qué desea cargar?" con 2 CTAs (Visita Presencial, Contacto No Presencial).
5. **`<div id="pedido-cliente-picker">`** — mini-modal search de clientes → al seleccionar, invoca el flujo actual de armado de pedido con `clienteId` precargado.
6. **`<div id="productos-sku-modal">`** — mini-modal search-SKU contra `stock.json` en memoria; badges de color por estado de stock.
7. **`<button class="btn-herramientas">`** + **`<div id="herramientas-modal">`** — botón consolidado + modal dispatcher con 3 tarjetas (Campañas Activas, Exportar a Excel, Rendiciones).

### Cambios sobre lo existente

- Ocultar `#main-tabs` y `.controls-right-group` en mobile via `@media`.
- Eliminar del top toolbar (desktop y mobile): botones `#mis-camps-btn`, `Exportar a Excel` (línea ~1709), tab `data-tab="rendiciones"` (línea 3017). Reemplazados por `[Herramientas ▾]`.
- Preservar handlers `openMisCampsModal()`, `_safeOpenExportFormatModal()`, `setTab('rendiciones')` — solo cambia el punto de entrada.
- No se toca el bundle `app.bundle.js`; todo el nav es inline en `index.html` para no impactar first paint mobile.

### Archivos tocados

| Archivo | Cambio | LOC aprox |
|---|---|---|
| `index.html` | HTML del nav + drawer + sheet + 2 modales + botón Herramientas + CSS mobile + JS glue | ~300 |
| `sw.js` | Bump `CACHE_VERSION` a `v429` | 1 |
| `README.md` | Fila "Versión actual" + changelog v429 | ~30 |
| `tests/unit/mobile-nav.test.js` | NEW: verifica IDs y handlers del nav | ~80 |
| `tests/unit/herramientas-modal.test.js` | NEW: verifica 3 tarjetas y handlers | ~60 |

## Comportamiento por slot del bottom-nav

### Slot 1 — PEDIDO (izquierda)
- Tap → abre `#pedido-cliente-picker` (mini-modal centered).
- Input search + lista de clientes filtrada por vendedor logueado; admin ve todos.
- Al seleccionar cliente: cierra modal + invoca el flujo actual de crear pedido con `clienteId` precargado (el implementer identifica la función exacta durante la implementación).
- Si el cliente tiene un pedido borrador: ofrecer "Continuar borrador" o "Nuevo pedido".

### Slot 2 — DASHBOARD (izquierda)
- Tap → `openDashboardModal()` directo. Sin cambios en la lógica actual.

### Slot 3 — HOME FAB (centro, elevado)
- Tap → `setTab('locs')` (mapa).
- Único slot con estado activo visible: cuando `currentTab === 'locs'`, FAB con anillo celeste `#00A9E0`; si estás en modal u otro tab, queda blanco/gris.
- Slot ~64×64 px, elevado `translateY(-14px)`.

### Slot 4 — CARGAR (derecha)
- Tap → sube `#cargar-sheet` desde abajo (animación 200 ms).
- 2 CTAs full-width:
  - **Visita Presencial** (azul) → cierra sheet + `openVisitaModal()`.
  - **Contacto No Presencial** (violeta) → cierra sheet + `openVisitaModal('contacto')`.
- Cerrable con tap fuera, drag-down, o botón X.

### Slot 5 — PRODUCTOS (derecha)
- Tap → abre `#productos-sku-modal`.
- Input con debounce 200 ms; busca por SKU o descripción en `stock.json` (ya cargado en memoria).
- Renderiza cada match como fila con badge:
  - **EN STOCK** verde `#16a34a` (con qty).
  - **EN TRÁNSITO** amarillo `#facc15` (con qty + ETA si existe).
  - **SIN STOCK** rojo `#dc2626`.
- Sin acción de "agregar al pedido" en v1.

### Estados globales
- Ripple táctil al tap (transform + shadow).
- Al abrir cualquier modal desde el bottom-nav, la barra sigue visible en `bottom:0`.
- Respeta `env(safe-area-inset-bottom)`.
- Tap targets ≥ 44×44 px.

## Botón "Herramientas" consolidado

### El botón
- Clase `.btn-herramientas`, clonado visualmente de `.btn-mis-camps` (amarillo `#facc15`, borde `#f59e0b`, texto `#78350f`, uppercase, bold).
- Ícono `⚙` en `::before`, sufijo `▾`, label "Herramientas".
- Siempre visible (no gated por rol); las tarjetas de adentro se ocultan por rol.
- Ubicación: primer botón de `controls-right-group` (donde hoy está `#mis-camps-btn`).
- `onclick="openHerramientasModal()"`.

### El modal `#herramientas-modal`
- Mini-modal centered, header amarillo, 3 tarjetas.
- Layout: vertical full-width en mobile, grid 3-col en desktop.

| Tarjeta | Ícono | Onclick | Gated |
|---|---|---|---|
| ⭐ Campañas Activas — "SKUs y descuentos vigentes" | `★` | `closeHerramientasModal(); openMisCampsModal()` | `display:none` por default; `applyRolePermissions()` la muestra igual que hoy hacía con `#mis-camps-btn` |
| ⬇ Exportar a Excel — "Reportes operativos + datasets" | `↓` | `closeHerramientasModal(); _safeOpenExportFormatModal()` | Siempre visible |
| 💵 Rendiciones — "Mis gastos + aprobaciones" | `$` | `closeHerramientasModal(); setTab('rendiciones')` | Siempre visible; muestra badge del count `#tab-rend-count` |

### Efectos colaterales
- La tab `data-tab="rendiciones"` (línea 3017) se elimina del top toolbar en desktop y mobile. Único acceso: Herramientas → Rendiciones.
- El botón "Herramientas" muestra un dot rojo si `#tab-rend-count` > 0 (aviso agregado; hoy ese aviso lo daba la tab).
- `unsubMisRendiciones` sigue vivo; el badge se actualiza en vivo.

## Estilo visual (matching liquid navigation del screenshot)

### Barra
```
background: #0f172a         /* slate-900, coherente con modal-head */
border-radius: 28px
height: 64px
margin: 0 12px 12px 12px
box-shadow: 0 8px 24px rgba(0,0,0,.35)
padding-bottom: env(safe-area-inset-bottom)
```

### Slots normales (4)
```
width: 48px; height: 48px
color: #f8fafc              /* ícono blanco */
:active { background: rgba(255,255,255,.12); transform: scale(0.92) }
```

### FAB Home (centro)
```
width: 64px; height: 64px
background: #ffffff
border-radius: 50%
transform: translateY(-14px)
box-shadow: 0 6px 16px rgba(0,0,0,.4)
color: #0f172a
&.active { border: 2px solid #00A9E0 }
```

### Iconografía
- SVG inline (no Unicode), 24×24 px, stroke 1.75, `fill:currentColor`.
- Set: **home** (Home), **clipboard-list** (PEDIDO), **chart-bar** (DASHBOARD), **plus-square** (CARGAR), **fish-hook** (PRODUCTOS — reemplazable si no hay en heroicons, alternativa `sparkles` o `search` con caña custom).
- Fuente: heroicons outline (MIT) copiados directo, sin dependencia.

### Backdrop de sheets/modales
```
background: rgba(15,23,42,.6)
backdrop-filter: blur(4px)
```

## Reglas responsive

```css
@media (max-width: 768px) {
  #main-tabs, .controls-right-group { display: none; }
  #mobile-bottom-nav { display: flex; }
  #mobile-header-hamburger { display: inline-flex; }
  .main-container { padding-bottom: 88px; }
}
@media (min-width: 769px) {
  #mobile-bottom-nav,
  #mobile-header-hamburger,
  #mobile-drawer,
  #cargar-sheet,
  #pedido-cliente-picker,
  #productos-sku-modal { display: none !important; }
}
```

Breakpoint 768 elegido para matchear `isMobileBrowser()` existente (línea 11525: `window.matchMedia('(max-width: 768px)')`).

**Nota importante**: el botón Herramientas y su modal son **globales** (no gated por media query) — aplican desktop + mobile.

## Testing

### Manual (checklist)
- iPhone Safari, Android Chrome, tablet portrait, tablet landscape, desktop.
- Cada uno de los 5 slots del bottom-nav abre lo esperado.
- Hamburger abre drawer; drawer navega a las 4 tabs.
- Los 3 flujos nuevos funcionan: pedido picker → armar pedido, cargar sheet → visita/contacto, productos search → resultados por color.
- Herramientas modal: 3 tarjetas visibles según rol; cada una delega correcto.
- Rendiciones sigue accesible desde Herramientas y no aparece más como tab.

### Unit tests nuevos
- **`tests/unit/mobile-nav.test.js`**: parsea `index.html`, verifica que existen los 5 slots + hamburger + drawer con los IDs correctos y que cada `onclick` referencia una función definida en el inline o en el bundle.
- **`tests/unit/herramientas-modal.test.js`**: verifica presencia de las 3 tarjetas, sus IDs, y que sus handlers (`openMisCampsModal`, `_safeOpenExportFormatModal`, `setTab('rendiciones')`) son referencias válidas.

### Regression
- Smoke test existente (`tests/smoke/bundle-runtime.test.js`) sigue pasando (bundle no crece).
- Test `tests/unit/listeners.test.js` sigue pasando (no se agregan listeners onSnapshot nuevos).

## Versionado y deploy

- Bump `APP_VERSION` en `index.html` y `CACHE_VERSION` en `sw.js` a `v429`.
- Actualizar tabla "Versión actual" del README + agregar entrada de changelog v429.
- Trabajo en rama `dev`; PR squash a `main` cuando OK.

## Rollback

- `git revert` del squash commit desde `main`.
- Alternativa quirúrgica sin revert: agregar `display:none !important` inline en `#mobile-bottom-nav` y `#mobile-header-hamburger` para desactivar en runtime mientras se investiga.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Vendedores no descubren el drawer/hamburger y no encuentran Notificaciones | Badge rojo en el hamburger cuando hay pendientes → señala visualmente que hay algo detrás |
| Modal Herramientas rompe el uso del botón Exportar Excel (usuarios desktop acostumbrados a un solo click) | Consolidación agrega solo 1 tap más; la ganancia es coherencia y menos superficie |
| iPhone safe-area no respetada → nav tapa contenido | `env(safe-area-inset-bottom)` + `padding-bottom:88px` en `.main-container` |
| Ícono caña de pesca para PRODUCTOS no existe en heroicons | Fallback: usar `sparkles` con label textual chico "SKU" debajo, o `magnifying-glass` |
| Regression en flujo actual de crear pedido (no sé la función exacta que precarga cliente) | El writing-plans identifica la función durante planning; si no existe, la implementación crea un wrapper que reusa el modal actual |
