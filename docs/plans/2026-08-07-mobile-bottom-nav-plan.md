# Mobile Bottom Nav + Botón Herramientas — Implementation Plan

> **For agentic workers:** Use subagent-driven-development o executing-plans skill para ejecutar este plan task-por-task. Steps usan checkbox (`- [ ]`) para tracking.

**Goal:** Reemplazar el top toolbar mobile por un bottom-nav de 5 slots + hamburger drawer para tabs secundarias, y consolidar 3 botones dispersos (Campañas Activas, Exportar a Excel, Rendiciones) en un solo botón "Herramientas" que aplica desktop + mobile.

**Architecture:** Todo inline en `index.html` (no chunk lazy, no módulo nuevo) — el bottom-nav debe estar en el shell para no impactar first paint mobile. Reglas `@media (max-width:768px)` controlan visibilidad. Los slots simples (Home, Dashboard, Productos) reutilizan funciones ya existentes (`setTab('locs')`, `openDashboardModal()`, `openProductMasterModal()`). Slots complejos (Pedido picker, Cargar sheet) montan mini-modales nuevos que delegan a flujos existentes.

**Tech Stack:** HTML5 + Vanilla JS + CSS inline en `index.html`. Vitest para unit tests (mismo pattern que `tests/unit/listeners.test.js`: leer `index.html` como string y assertear presencia de markup + handlers).

## Global Constraints

- Target release: **v429** (bump `APP_VERSION` en `index.html:3498` y `CACHE_VERSION` en `sw.js:20` a `'v429'` como último paso del plan).
- Trabajo en rama `dev`; PR squash a `main` cuando el user confirme deploy (fuera del scope del plan; ver Task 8).
- Breakpoint mobile: **768px** — matchea el `isMobileBrowser()` existente (`index.html:11525`).
- No agregar dependencias npm. Todo vanilla.
- No agregar listeners `onSnapshot` nuevos (evitar leak-list; ver CLAUDE.md regla #12).
- SVG icons: heroicons outline (MIT), 24×24, stroke 1.75, copiados inline (no dependencia).
- Actualizar `README.md` (tabla "Versión actual" + entrada changelog v429) en el mismo commit del bump de versión.
- Cada commit es squash-mergeable independientemente; test suite en verde después de cada task.

---

## File Structure

| Archivo | Cambio | Rango afectado |
|---|---|---|
| `index.html` | Modificar: markup del bottom-nav, hamburger en `.user-info` (~1666-1680), drawer, sheet, mini-modales, botón Herramientas reemplaza a `#mis-camps-btn` + `btn-export` (~1705-1710), remover tab `data-tab="rendiciones"` (línea 3017), extender `applyRolePermissions()` (~12597+), agregar CSS `@media` mobile, bump APP_VERSION (línea 3498) | ~350 LOC agregadas, ~15 LOC removidas |
| `sw.js` | Bump `CACHE_VERSION` a `'v429'` | Línea 20 |
| `README.md` | Fila "Versión actual" + entrada changelog v429 | ~30 LOC |
| `tests/unit/herramientas-modal.test.js` | NEW: verifica 3 tarjetas + handlers | ~70 LOC |
| `tests/unit/mobile-nav.test.js` | NEW: verifica 5 slots + hamburger + drawer + sheet + pedido picker | ~120 LOC |

Todo inline en `index.html` deliberadamente — el nav es shell crítico para first paint mobile, no puede estar en un chunk lazy.

---

## Task 1: Consolidar 3 botones en "Herramientas"

**Files:**
- Modify: `index.html:1705-1710` (remove `#mis-camps-btn` + `btn-export` buttons; add `.btn-herramientas`)
- Modify: `index.html:3017` (remove tab `data-tab="rendiciones"`)
- Modify: `index.html` — extend `applyRolePermissions()` (línea 12597) para gate card Campañas Activas
- Modify: `index.html` — add `#herramientas-modal` HTML antes de `<div class="main-container">` (~línea 1721)
- Modify: `index.html` — add CSS `.btn-herramientas` + `#herramientas-modal *` en el bloque de estilos
- Modify: `index.html` — add `openHerramientasModal()` + `closeHerramientasModal()` en el bloque JS inline
- Test: `tests/unit/herramientas-modal.test.js`

**Interfaces:**
- Consumes: `openMisCampsModal()`, `_safeOpenExportFormatModal()`, `setTab('rendiciones')` — ya existen en el inline.
- Produces:
  - `window.openHerramientasModal()` — sin args, sin return
  - `window.closeHerramientasModal()` — sin args, sin return
  - Element `#herramientas-modal` con 3 hijos `.herr-card[data-herr-action="camps|export|rendiciones"]`
  - Element `.btn-herramientas` con `onclick="openHerramientasModal()"`

- [ ] **Step 1: Escribir test failing**

Crear `tests/unit/herramientas-modal.test.js`:

```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('Botón Herramientas consolidado', () => {
  it('existe .btn-herramientas con onclick openHerramientasModal', () => {
    expect(HTML).toMatch(/<button[^>]*class="btn-herramientas"[^>]*onclick="openHerramientasModal\(\)"/);
  });

  it('modal #herramientas-modal existe', () => {
    expect(HTML).toContain('id="herramientas-modal"');
  });

  it('modal tiene 3 tarjetas con data-herr-action', () => {
    const actions = ['camps', 'export', 'rendiciones'];
    for (const a of actions) {
      expect(HTML).toMatch(new RegExp(`data-herr-action="${a}"`));
    }
  });

  it('handlers del inline JS existen', () => {
    expect(HTML).toContain('function openHerramientasModal');
    expect(HTML).toContain('function closeHerramientasModal');
  });

  it('botón #mis-camps-btn viejo fue eliminado', () => {
    expect(HTML).not.toContain('id="mis-camps-btn"');
  });

  it('botón Exportar a Excel viejo fue eliminado del top toolbar', () => {
    // el handler _safeOpenExportFormatModal sigue existiendo (lo llama la card),
    // pero el <button class="btn-export" onclick="_safeOpenExportFormatModal()"> del
    // controls-right-group ya no.
    expect(HTML).not.toMatch(/<button[^>]*class="btn-export"[^>]*onclick="_safeOpenExportFormatModal\(\)"/);
  });

  it('tab Rendiciones fue removida del top toolbar', () => {
    expect(HTML).not.toMatch(/<button[^>]*data-tab="rendiciones"[^>]*onclick="setTab\('rendiciones'\)"/);
  });

  it('applyRolePermissions gate la card Campañas Activas', () => {
    // busca el patrón: querySelector('[data-herr-action="camps"]') o similar dentro de applyRolePermissions
    const applyFnMatch = HTML.match(/function applyRolePermissions[\s\S]{0,6000}/);
    expect(applyFnMatch).toBeTruthy();
    expect(applyFnMatch[0]).toMatch(/data-herr-action="camps"|herr-card-camps/);
  });
});
```

- [ ] **Step 2: Correr test para verificar failing**

Comando: `npx vitest run tests/unit/herramientas-modal.test.js`
Expected: 8 asserts fail.

- [ ] **Step 3: Reemplazar botones en `controls-right-group`**

En `index.html:1705-1710`, reemplazar:

```html
    <button class="btn-mis-camps" id="mis-camps-btn" onclick="openMisCampsModal()" style="display:none" title="Ver campañas activas y los SKU involucrados">Campañas Activas</button>
    <button class="btn-dashboard" id="dashboard-btn" onclick="openDashboardModal()" title="Abrir dashboard de ventas">Dashboard</button>
    <button class="btn-analisis" id="analisis-btn" onclick="openExportAnalisis()" style="display:none" title="Formatos avanzados (Power BI / ML / ZIP fotos) - requiere PIN">Exportar para An&aacute;lisis</button>
    <button class="btn-export" onclick="_safeOpenExportFormatModal()" title="Elegir formato: Reportes Excel (uso operativo) o Dataset ZIP para pipelines de ML (solo admin/gerente)">Exportar a Excel</button>
```

Por:

```html
    <button class="btn-herramientas" id="herramientas-btn" onclick="openHerramientasModal()" title="Herramientas: Campañas activas, Exportar a Excel, Rendiciones">Herramientas <span id="herr-btn-dot" style="display:none;background:#dc2626;width:7px;height:7px;border-radius:50%;margin-left:6px"></span></button>
    <button class="btn-dashboard" id="dashboard-btn" onclick="openDashboardModal()" title="Abrir dashboard de ventas">Dashboard</button>
    <button class="btn-analisis" id="analisis-btn" onclick="openExportAnalisis()" style="display:none" title="Formatos avanzados (Power BI / ML / ZIP fotos) - requiere PIN">Exportar para An&aacute;lisis</button>
```

- [ ] **Step 4: Remover tab Rendiciones**

En `index.html:3017`, borrar la línea entera:

```html
      <button class="tab-btn" data-tab="rendiciones" onclick="setTab('rendiciones')" title="Rendiciones (en construccion)">Rendiciones <span class="tab-count" id="tab-rend-count" style="display:none">0</span></button>
```

**NOTA**: mover el span `#tab-rend-count` a la card Rendiciones del modal Herramientas (Step 6) para preservar la referencia — hay código que hace `document.getElementById('tab-rend-count')`.

- [ ] **Step 5: Agregar CSS `.btn-herramientas` en el bloque de estilos**

Después de la regla `.btn-mis-camps` (~línea 791) agregar:

```css
.btn-herramientas{padding:7px 12px;border:1.5px solid #f59e0b;border-radius:6px;background:#facc15;color:#78350f;font-size:11px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.4px;display:inline-flex;align-items:center;gap:5px;box-shadow:0 1px 3px rgba(245,158,11,.35);transition:.15s;white-space:nowrap;flex-shrink:0}
.btn-herramientas::before{content:"\2699";font-size:14px}
.btn-herramientas::after{content:"\25BE";font-size:9px;margin-left:2px}
.btn-herramientas:hover{background:#fde047;box-shadow:0 2px 6px rgba(245,158,11,.55)}
.btn-herramientas:active{transform:translateY(1px)}

#herramientas-modal{position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px}
#herramientas-modal.open{display:flex}
#herramientas-modal .herr-box{background:#fff;border-radius:14px;width:min(520px,96vw);max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)}
#herramientas-modal .herr-head{background:linear-gradient(135deg,#facc15,#f59e0b);color:#78350f;padding:16px 20px;border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center;font-weight:800;text-transform:uppercase;letter-spacing:.4px}
#herramientas-modal .herr-close{background:none;border:none;color:#78350f;font-size:22px;cursor:pointer;line-height:1}
#herramientas-modal .herr-body{padding:16px;display:grid;grid-template-columns:1fr;gap:12px}
@media(min-width:520px){#herramientas-modal .herr-body{grid-template-columns:repeat(3,1fr)}}
.herr-card{padding:18px 14px;border:2px solid #e5e7eb;border-radius:10px;background:#f8fafc;cursor:pointer;text-align:center;transition:.15s;display:flex;flex-direction:column;align-items:center;gap:8px}
.herr-card:hover{border-color:#f59e0b;background:#fffbeb;transform:translateY(-2px)}
.herr-card .herr-icon{font-size:28px;line-height:1}
.herr-card .herr-title{font-weight:800;font-size:13px;color:#0f172a;text-transform:uppercase;letter-spacing:.3px}
.herr-card .herr-sub{font-size:11px;color:#64748b;line-height:1.3}
.herr-card .herr-badge{background:#dc2626;color:#fff;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:800;margin-top:4px;display:none}
.herr-card .herr-badge.active{display:inline-block}
```

- [ ] **Step 6: Agregar HTML del modal Herramientas**

Antes de `<div class="main-container">` (~línea 1721) agregar:

```html
<div id="herramientas-modal" onclick="if(event.target===this)closeHerramientasModal()">
  <div class="herr-box">
    <div class="herr-head">
      <span>Herramientas</span>
      <button class="herr-close" onclick="closeHerramientasModal()" aria-label="Cerrar">&times;</button>
    </div>
    <div class="herr-body">
      <div class="herr-card" data-herr-action="camps" id="herr-card-camps" style="display:none" onclick="closeHerramientasModal();openMisCampsModal()">
        <div class="herr-icon">&#9733;</div>
        <div class="herr-title">Campa&ntilde;as Activas</div>
        <div class="herr-sub">SKUs y descuentos vigentes</div>
      </div>
      <div class="herr-card" data-herr-action="export" onclick="closeHerramientasModal();_safeOpenExportFormatModal()">
        <div class="herr-icon">&#8681;</div>
        <div class="herr-title">Exportar a Excel</div>
        <div class="herr-sub">Reportes operativos + datasets</div>
      </div>
      <div class="herr-card" data-herr-action="rendiciones" onclick="closeHerramientasModal();setTab('rendiciones')">
        <div class="herr-icon">&#128176;</div>
        <div class="herr-title">Rendiciones</div>
        <div class="herr-sub">Mis gastos + aprobaciones</div>
        <span class="herr-badge" id="tab-rend-count">0</span>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 7: Agregar funciones JS**

En el bloque `<script>` inline de `index.html` (cerca de otros `openXxxModal` — buscar `function openDashboardModal` como ancla) agregar:

```javascript
function openHerramientasModal(){
  const m = document.getElementById('herramientas-modal');
  if (m) m.classList.add('open');
}
function closeHerramientasModal(){
  const m = document.getElementById('herramientas-modal');
  if (m) m.classList.remove('open');
}
// Sincroniza el dot rojo del botón Herramientas con el badge de Rendiciones.
// Se llama desde el mismo lugar donde hoy se pinta #tab-rend-count.
function _paintHerramientasDot(){
  const badge = document.getElementById('tab-rend-count');
  const dot = document.getElementById('herr-btn-dot');
  if (!badge || !dot) return;
  const n = parseInt(badge.textContent || '0', 10);
  dot.style.display = (n > 0) ? 'inline-block' : 'none';
  badge.classList.toggle('active', n > 0);
}
// ESC cierra el modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = document.getElementById('herramientas-modal');
    if (m && m.classList.contains('open')) closeHerramientasModal();
  }
});
```

Buscar los sitios donde hoy se hace `document.getElementById('tab-rend-count').textContent = ...` (grep `tab-rend-count`) y agregar `_paintHerramientasDot();` justo después de cada asignación.

- [ ] **Step 8: Extender applyRolePermissions() para gate card Campañas**

En `index.html:12716` la línea actual es:

```javascript
document.getElementById('mis-camps-btn').style.display = (userRole !== 'unassigned') ? '' : 'none';
```

Reemplazar por:

```javascript
const herrCardCamps = document.getElementById('herr-card-camps');
if (herrCardCamps) herrCardCamps.style.display = (userRole !== 'unassigned') ? '' : 'none';
```

- [ ] **Step 9: Correr test para verificar passing**

Comando: `npx vitest run tests/unit/herramientas-modal.test.js`
Expected: 8 asserts pass.

- [ ] **Step 10: Correr suite completa para no romper nada**

Comando: `npx vitest run`
Expected: todos los tests existentes + los nuevos 8 pasan.

- [ ] **Step 11: Commit**

```bash
git add index.html tests/unit/herramientas-modal.test.js
git commit -m "feat: consolidar Campañas/Exportar/Rendiciones en botón Herramientas"
```

---

## Task 2: Bottom-nav skeleton (HTML + CSS)

**Files:**
- Modify: `index.html` — agregar `<nav id="mobile-bottom-nav">` antes de `</body>` con 5 slots + FAB
- Modify: `index.html` — agregar CSS del nav + `@media (max-width:768px)` que oculta `#main-tabs`, `.controls-right-group` y muestra el nav
- Test: `tests/unit/mobile-nav.test.js` (Task 2 crea el file; Tasks 3-6 extienden)

**Interfaces:**
- Consumes: nada (solo markup + CSS).
- Produces:
  - Element `<nav id="mobile-bottom-nav">` con 5 hijos `.mnav-slot[data-mnav-slot="pedido|dashboard|home|cargar|productos"]`.
  - El slot Home es un `<button class="mnav-fab">`.
  - Los otros 4 son `<button class="mnav-btn">`.
  - CSS class `.mnav-fab.active` (aplicable en Task 3).

- [ ] **Step 1: Escribir test failing**

Crear `tests/unit/mobile-nav.test.js`:

```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('Mobile bottom-nav skeleton', () => {
  it('existe <nav id="mobile-bottom-nav">', () => {
    expect(HTML).toMatch(/<nav[^>]*id="mobile-bottom-nav"/);
  });

  it('tiene 5 slots con data-mnav-slot correctos', () => {
    const slots = ['pedido', 'dashboard', 'home', 'cargar', 'productos'];
    for (const s of slots) {
      expect(HTML).toMatch(new RegExp(`data-mnav-slot="${s}"`));
    }
  });

  it('slot home es un FAB (.mnav-fab)', () => {
    expect(HTML).toMatch(/class="mnav-fab"[^>]*data-mnav-slot="home"/);
  });

  it('CSS del nav está presente', () => {
    expect(HTML).toContain('#mobile-bottom-nav');
    expect(HTML).toContain('.mnav-fab');
    expect(HTML).toContain('.mnav-btn');
  });

  it('media queries mobile/desktop están presentes', () => {
    // regla que oculta el top toolbar en mobile
    expect(HTML).toMatch(/@media[^{]*max-width:\s*768px[^{]*\{[^}]*#main-tabs[\s\S]*?display:\s*none/);
    // regla que oculta el nav en desktop
    expect(HTML).toMatch(/@media[^{]*min-width:\s*769px[^{]*\{[^}]*#mobile-bottom-nav[\s\S]*?display:\s*none/);
  });
});
```

- [ ] **Step 2: Correr test para verificar failing**

Comando: `npx vitest run tests/unit/mobile-nav.test.js`
Expected: 5 asserts fail.

- [ ] **Step 3: Agregar HTML del nav**

Antes de `</body>` (buscar el cierre) agregar:

```html
<!-- v429: mobile bottom-nav. Solo visible en @media (max-width:768px).
     Task 3 conecta handlers; este task solo el skeleton. -->
<nav id="mobile-bottom-nav" aria-label="Navegación principal mobile">
  <button class="mnav-btn" data-mnav-slot="pedido" aria-label="Nuevo pedido">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>
  </button>
  <button class="mnav-btn" data-mnav-slot="dashboard" aria-label="Dashboard">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 4 4 5-6"/></svg>
  </button>
  <button class="mnav-fab" data-mnav-slot="home" aria-label="Inicio (mapa)">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/></svg>
  </button>
  <button class="mnav-btn" data-mnav-slot="cargar" aria-label="Cargar visita o contacto">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
  </button>
  <button class="mnav-btn" data-mnav-slot="productos" aria-label="Buscar productos">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
  </button>
</nav>
```

- [ ] **Step 4: Agregar CSS del nav + media queries**

En el bloque de estilos (buscar `.btn-mobile-refresh` como ancla — es otro elemento mobile-only) agregar:

```css
/* ==== v429: mobile bottom-nav ==== */
#mobile-bottom-nav{display:none;position:fixed;left:12px;right:12px;bottom:12px;height:64px;background:#0f172a;border-radius:28px;box-shadow:0 8px 24px rgba(0,0,0,.35);align-items:center;justify-content:space-around;padding:0 8px;padding-bottom:env(safe-area-inset-bottom,0);z-index:9998}
.mnav-btn{width:48px;height:48px;background:none;border:none;color:#f8fafc;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border-radius:12px;transition:.15s;padding:0}
.mnav-btn:active{background:rgba(255,255,255,.12);transform:scale(.92)}
.mnav-fab{width:64px;height:64px;background:#fff;border:none;border-radius:50%;transform:translateY(-14px);box-shadow:0 6px 16px rgba(0,0,0,.4);color:#0f172a;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:.15s;padding:0}
.mnav-fab:active{transform:translateY(-12px) scale(.96)}
.mnav-fab.active{border:2px solid #00A9E0}

@media (max-width: 768px) {
  #main-tabs, .controls-right-group { display: none !important; }
  #mobile-bottom-nav { display: flex; }
  .main-container { padding-bottom: 88px; }
}
@media (min-width: 769px) {
  #mobile-bottom-nav { display: none !important; }
}
```

**IMPORTANTE**: `#main-tabs` puede no ser el ID exacto del contenedor de tabs — buscar el wrapper real. En `index.html:3011-3019` los tabs están dentro de un contenedor; identificar su selector (por ejemplo `.main-tabs`, `#tabs-bar`, etc.) y ajustar la regla. Si no tiene ID/class propio, envolverlo en un `<div id="main-tabs">`.

- [ ] **Step 5: Correr test para verificar passing**

Comando: `npx vitest run tests/unit/mobile-nav.test.js`
Expected: 5 asserts pass.

- [ ] **Step 6: Verificar visualmente en browser (dev server)**

Abrir `index.html` en Chrome DevTools → toggle device toolbar → iPhone 12 Pro. Debería verse el bottom-nav abajo. No clickear todavía (Task 3 conecta handlers).

- [ ] **Step 7: Commit**

```bash
git add index.html tests/unit/mobile-nav.test.js
git commit -m "feat: bottom-nav mobile skeleton (v429 WIP)"
```

---

## Task 3: Wire slots simples (Home, Dashboard, Productos)

**Files:**
- Modify: `index.html` — agregar `onclick` a los 3 slots + función `_updateHomeActiveState()` que sincroniza `.mnav-fab.active` con `currentTab`
- Modify: `tests/unit/mobile-nav.test.js` — extender con asserts de handlers

**Interfaces:**
- Consumes: `setTab('locs')`, `openDashboardModal()`, `openProductMasterModal()` — todos existen.
- Produces:
  - `window._updateHomeActiveState()` — sin args, sin return
  - Cada slot Home/Dashboard/Productos tiene `onclick` definido.

- [ ] **Step 1: Extender test**

En `tests/unit/mobile-nav.test.js` agregar:

```javascript
describe('Bottom-nav handlers simples', () => {
  it('slot home invoca setTab(\'locs\')', () => {
    expect(HTML).toMatch(/data-mnav-slot="home"[^>]*onclick="[^"]*setTab\('locs'\)/);
  });
  it('slot dashboard invoca openDashboardModal', () => {
    expect(HTML).toMatch(/data-mnav-slot="dashboard"[^>]*onclick="openDashboardModal\(\)/);
  });
  it('slot productos invoca openProductMasterModal', () => {
    expect(HTML).toMatch(/data-mnav-slot="productos"[^>]*onclick="openProductMasterModal\(\)/);
  });
  it('función _updateHomeActiveState existe', () => {
    expect(HTML).toContain('function _updateHomeActiveState');
  });
});
```

- [ ] **Step 2: Correr test para verificar failing**

Comando: `npx vitest run tests/unit/mobile-nav.test.js`
Expected: 4 asserts nuevos fail.

- [ ] **Step 3: Agregar onclick a los 3 slots**

En el HTML del nav (Task 2, Step 3), modificar:

- Slot `home`: agregar `onclick="setTab('locs')"`
- Slot `dashboard`: agregar `onclick="openDashboardModal()"`
- Slot `productos`: agregar `onclick="openProductMasterModal()"`

- [ ] **Step 4: Agregar función `_updateHomeActiveState`**

En el bloque `<script>` inline (cerca de `function setTab` — grep `function setTab`) agregar:

```javascript
// v429: sincroniza el estado activo del FAB Home con currentTab.
function _updateHomeActiveState(){
  const fab = document.querySelector('.mnav-fab[data-mnav-slot="home"]');
  if (!fab) return;
  // currentTab se setea dentro de setTab(); si aún no está definido, asumir 'locs'
  const active = (typeof currentTab === 'undefined' || currentTab === 'locs');
  fab.classList.toggle('active', active);
}
```

Después de encontrar la línea donde `setTab` setea `currentTab`, agregar `_updateHomeActiveState();` como última línea del cuerpo de `setTab`.

- [ ] **Step 5: Correr test para verificar passing**

Comando: `npx vitest run tests/unit/mobile-nav.test.js`
Expected: 9 asserts pass (5 originales + 4 nuevos).

- [ ] **Step 6: Verificar en browser**

En mobile mode, tocar cada uno de los 3 slots. Home → mapa (FAB con anillo celeste). Dashboard → modal. Productos → modal.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/unit/mobile-nav.test.js
git commit -m "feat: bottom-nav slots Home/Dashboard/Productos"
```

---

## Task 4: Slot CARGAR + bottom-sheet

**Files:**
- Modify: `index.html` — agregar `<div id="cargar-sheet">`, CSS del sheet, funciones `openCargarSheet()`/`closeCargarSheet()`, onclick al slot
- Modify: `tests/unit/mobile-nav.test.js` — extender con asserts

**Interfaces:**
- Consumes: `openVisitaModal()`, `openVisitaModal('contacto')` — existen.
- Produces:
  - `window.openCargarSheet()` — sin args, sin return
  - `window.closeCargarSheet()` — sin args, sin return
  - Element `#cargar-sheet` con 2 botones `[data-cargar-action="visita|contacto"]`

- [ ] **Step 1: Extender test**

En `tests/unit/mobile-nav.test.js`:

```javascript
describe('Slot CARGAR + sheet', () => {
  it('slot cargar invoca openCargarSheet', () => {
    expect(HTML).toMatch(/data-mnav-slot="cargar"[^>]*onclick="openCargarSheet\(\)"/);
  });
  it('sheet #cargar-sheet existe', () => {
    expect(HTML).toContain('id="cargar-sheet"');
  });
  it('sheet tiene 2 acciones (visita, contacto)', () => {
    expect(HTML).toMatch(/data-cargar-action="visita"/);
    expect(HTML).toMatch(/data-cargar-action="contacto"/);
  });
  it('handlers openCargarSheet/closeCargarSheet existen', () => {
    expect(HTML).toContain('function openCargarSheet');
    expect(HTML).toContain('function closeCargarSheet');
  });
});
```

- [ ] **Step 2: Correr test para verificar failing**

`npx vitest run tests/unit/mobile-nav.test.js` — 4 asserts nuevos fail.

- [ ] **Step 3: Wire slot Cargar**

En el HTML del nav (Task 2), agregar `onclick="openCargarSheet()"` al slot Cargar.

- [ ] **Step 4: Agregar HTML del sheet**

Después del `</nav>` de `#mobile-bottom-nav`:

```html
<div id="cargar-sheet" onclick="if(event.target===this)closeCargarSheet()">
  <div class="cs-box">
    <div class="cs-head">
      <div class="cs-title">¿Qué desea cargar?</div>
      <button class="cs-close" onclick="closeCargarSheet()" aria-label="Cerrar">&times;</button>
    </div>
    <div class="cs-body">
      <button class="cs-cta cs-cta-visita" data-cargar-action="visita" onclick="closeCargarSheet();openVisitaModal()">
        <span class="cs-cta-icon">&#127978;</span>
        <span class="cs-cta-label">Visita Presencial</span>
        <span class="cs-cta-sub">Registrar visita a tienda con GPS</span>
      </button>
      <button class="cs-cta cs-cta-contacto" data-cargar-action="contacto" onclick="closeCargarSheet();openVisitaModal('contacto')">
        <span class="cs-cta-icon">&#128241;</span>
        <span class="cs-cta-label">Contacto No Presencial</span>
        <span class="cs-cta-sub">WhatsApp / teléfono / email</span>
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Agregar CSS del sheet**

```css
#cargar-sheet{position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);display:none;align-items:flex-end;justify-content:center;z-index:10000;padding:0}
#cargar-sheet.open{display:flex;animation:cs-fade .2s ease-out}
@keyframes cs-fade{from{background:rgba(15,23,42,0)}to{background:rgba(15,23,42,.6)}}
#cargar-sheet .cs-box{background:#fff;width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:16px 16px calc(24px + env(safe-area-inset-bottom,0)) 16px;box-shadow:0 -8px 24px rgba(0,0,0,.3);animation:cs-slide .25s ease-out}
@keyframes cs-slide{from{transform:translateY(100%)}to{transform:translateY(0)}}
#cargar-sheet .cs-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding:0 4px}
#cargar-sheet .cs-title{font-weight:800;font-size:16px;color:#0f172a}
#cargar-sheet .cs-close{background:none;border:none;font-size:26px;cursor:pointer;color:#64748b;line-height:1;padding:4px 8px}
#cargar-sheet .cs-body{display:flex;flex-direction:column;gap:10px}
#cargar-sheet .cs-cta{border:none;padding:16px 14px;border-radius:12px;cursor:pointer;display:flex;align-items:center;gap:14px;text-align:left;font-family:inherit;transition:.15s}
#cargar-sheet .cs-cta:active{transform:scale(.98)}
#cargar-sheet .cs-cta-icon{font-size:28px;flex-shrink:0}
#cargar-sheet .cs-cta-label{font-weight:800;font-size:14px;text-transform:uppercase;letter-spacing:.3px;display:block}
#cargar-sheet .cs-cta-sub{font-size:11px;opacity:.85;display:block;margin-top:2px}
#cargar-sheet .cs-cta-visita{background:#1e40af;color:#fff}
#cargar-sheet .cs-cta-contacto{background:#7c3aed;color:#fff}
```

- [ ] **Step 6: Agregar funciones JS**

```javascript
function openCargarSheet(){
  const el = document.getElementById('cargar-sheet');
  if (el) el.classList.add('open');
}
function closeCargarSheet(){
  const el = document.getElementById('cargar-sheet');
  if (el) el.classList.remove('open');
}
```

Extender el listener ESC existente (Task 1 Step 7) para cerrar también el sheet:

```javascript
// dentro del listener keydown ya existente
if (e.key === 'Escape') {
  const cs = document.getElementById('cargar-sheet');
  if (cs && cs.classList.contains('open')) closeCargarSheet();
  // ... resto (herramientas modal, etc.)
}
```

- [ ] **Step 7: Correr test para verificar passing**

`npx vitest run tests/unit/mobile-nav.test.js` — 13 asserts pass.

- [ ] **Step 8: Verificar en browser**

Mobile mode → tap Cargar → sheet sube desde abajo. Tap Visita Presencial → sheet cierra + modal Visita abre. Tap Contacto → sheet cierra + modal Contacto.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/unit/mobile-nav.test.js
git commit -m "feat: bottom-nav slot Cargar + sheet visita/contacto"
```

---

## Task 5: Slot PEDIDO + cliente picker

**Files:**
- Modify: `index.html` — agregar `<div id="pedido-cliente-picker">`, CSS, funciones `openPedidoClientePicker()`/`closePedidoClientePicker()`/`_selectPedidoCliente(clienteName)`, onclick al slot
- Modify: `tests/unit/mobile-nav.test.js` — extender con asserts

**Interfaces:**
- Consumes:
  - `setTab('pedidos')` — existe.
  - Alguna fuente de clientes — típicamente `window.POINTS` (array de tiendas). Buscar la variable global que usa `renderPedidosTab()` para listar tiendas y reusarla.
  - Element `#pedido-search` (`index.html:3050`) — se pre-llena con el nombre del cliente seleccionado.
- Produces:
  - `window.openPedidoClientePicker()` — sin args, sin return
  - `window.closePedidoClientePicker()` — sin args, sin return
  - `window._selectPedidoCliente(name)` — llamada al elegir un cliente
  - Element `#pedido-cliente-picker` con `<input id="pcp-search">` y `<ul id="pcp-list">`

- [ ] **Step 1: Extender test**

```javascript
describe('Slot PEDIDO + cliente picker', () => {
  it('slot pedido invoca openPedidoClientePicker', () => {
    expect(HTML).toMatch(/data-mnav-slot="pedido"[^>]*onclick="openPedidoClientePicker\(\)"/);
  });
  it('picker #pedido-cliente-picker existe', () => {
    expect(HTML).toContain('id="pedido-cliente-picker"');
  });
  it('picker tiene input search y lista', () => {
    expect(HTML).toContain('id="pcp-search"');
    expect(HTML).toContain('id="pcp-list"');
  });
  it('handlers openPedidoClientePicker/closePedidoClientePicker/_selectPedidoCliente existen', () => {
    expect(HTML).toContain('function openPedidoClientePicker');
    expect(HTML).toContain('function closePedidoClientePicker');
    expect(HTML).toContain('function _selectPedidoCliente');
  });
});
```

- [ ] **Step 2: Correr test para verificar failing**

`npx vitest run tests/unit/mobile-nav.test.js` — 4 asserts nuevos fail.

- [ ] **Step 3: Identificar fuente de clientes**

Grep `renderPedidosTab` para ver qué variable global usa como source de tiendas. Probablemente `POINTS` (declarado en index.html línea ~3417 según CLAUDE.md regla #15). Confirmar y usar esa misma variable en `_renderPcpList()`.

- [ ] **Step 4: Wire slot Pedido**

Agregar `onclick="openPedidoClientePicker()"` al slot Pedido en el nav.

- [ ] **Step 5: Agregar HTML del picker**

```html
<div id="pedido-cliente-picker" onclick="if(event.target===this)closePedidoClientePicker()">
  <div class="pcp-box">
    <div class="pcp-head">
      <div class="pcp-title">Elegí un cliente</div>
      <button class="pcp-close" onclick="closePedidoClientePicker()" aria-label="Cerrar">&times;</button>
    </div>
    <div class="pcp-search-wrap">
      <input type="search" id="pcp-search" class="pcp-search" placeholder="Buscar por nombre..." autocomplete="off" oninput="_renderPcpList(this.value)"/>
    </div>
    <ul id="pcp-list" class="pcp-list" role="listbox"></ul>
  </div>
</div>
```

- [ ] **Step 6: Agregar CSS**

```css
#pedido-cliente-picker{position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:10000;padding:16px}
#pedido-cliente-picker.open{display:flex}
#pedido-cliente-picker .pcp-box{background:#fff;border-radius:14px;width:min(520px,96vw);max-height:82vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden}
#pedido-cliente-picker .pcp-head{background:linear-gradient(135deg,#166534,#14532d);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center}
#pedido-cliente-picker .pcp-title{font-weight:800;font-size:15px;text-transform:uppercase;letter-spacing:.4px}
#pedido-cliente-picker .pcp-close{background:none;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1}
#pedido-cliente-picker .pcp-search-wrap{padding:12px 14px;border-bottom:1px solid #e5e7eb}
#pedido-cliente-picker .pcp-search{width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none}
#pedido-cliente-picker .pcp-search:focus{border-color:#166534;box-shadow:0 0 0 3px rgba(22,101,52,.15)}
#pedido-cliente-picker .pcp-list{list-style:none;margin:0;padding:8px 0;overflow-y:auto;flex:1}
#pedido-cliente-picker .pcp-list li{padding:12px 16px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;transition:.1s}
#pedido-cliente-picker .pcp-list li:hover{background:#f0fdf4;color:#166534}
#pedido-cliente-picker .pcp-list li:active{background:#dcfce7}
#pedido-cliente-picker .pcp-empty{padding:20px;text-align:center;color:#94a3b8;font-size:12px}
```

- [ ] **Step 7: Agregar funciones JS**

```javascript
function openPedidoClientePicker(){
  const el = document.getElementById('pedido-cliente-picker');
  if (!el) return;
  el.classList.add('open');
  const input = document.getElementById('pcp-search');
  if (input) { input.value = ''; input.focus(); }
  _renderPcpList('');
}
function closePedidoClientePicker(){
  const el = document.getElementById('pedido-cliente-picker');
  if (el) el.classList.remove('open');
}
function _renderPcpList(query){
  const list = document.getElementById('pcp-list');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  // Usar la misma source que renderPedidosTab. POINTS es el array global de tiendas.
  const source = (typeof window.POINTS !== 'undefined' && Array.isArray(window.POINTS)) ? window.POINTS : [];
  const items = source
    .filter(p => {
      if (!q) return true;
      const name = (p.name || p.tienda || p.nombre || '').toLowerCase();
      return name.includes(q);
    })
    .slice(0, 100); // cap 100 para performance
  if (items.length === 0) {
    list.innerHTML = '<li class="pcp-empty">Sin resultados.</li>';
    return;
  }
  list.innerHTML = items.map(p => {
    const name = p.name || p.tienda || p.nombre || '(sin nombre)';
    const safe = String(name).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return `<li onclick="_selectPedidoCliente('${safe}')" role="option">${name}</li>`;
  }).join('');
}
function _selectPedidoCliente(name){
  closePedidoClientePicker();
  setTab('pedidos');
  // Pre-llenar el search de la tab Pedidos y triggerear re-render
  const searchEl = document.getElementById('pedido-search');
  if (searchEl) {
    searchEl.value = name;
    if (typeof renderPedidosTab === 'function') renderPedidosTab();
  }
}
```

Extender listener ESC:

```javascript
if (e.key === 'Escape') {
  const pcp = document.getElementById('pedido-cliente-picker');
  if (pcp && pcp.classList.contains('open')) closePedidoClientePicker();
  // ...
}
```

- [ ] **Step 8: Correr test para verificar passing**

`npx vitest run tests/unit/mobile-nav.test.js` — 17 asserts pass.

- [ ] **Step 9: Verificar en browser**

Mobile mode → tap Pedido → picker abre. Escribir en el search → lista se filtra. Tap un cliente → picker cierra + va a tab Pedidos con el search pre-llenado.

- [ ] **Step 10: Commit**

```bash
git add index.html tests/unit/mobile-nav.test.js
git commit -m "feat: bottom-nav slot Pedido + cliente picker"
```

---

## Task 6: Hamburger + drawer + badge global notificaciones

**Files:**
- Modify: `index.html` — agregar `<button id="mobile-header-hamburger">` en `.user-info` (~línea 1666-1680), `<aside id="mobile-drawer">`, CSS, funciones `openMobileDrawer()`/`closeMobileDrawer()`/`_updateHamburgerBadge()`
- Modify: `tests/unit/mobile-nav.test.js` — extender

**Interfaces:**
- Consumes: `setTab('rutas'|'rendiciones'|'altacli'|'notif')` — existen.
- Produces:
  - `window.openMobileDrawer()` — sin args, sin return
  - `window.closeMobileDrawer()` — sin args, sin return
  - `window._updateHamburgerBadge()` — sin args, sin return (lee `#tab-notif-count` y actualiza `#mob-hamburger-badge`)
  - Element `#mobile-header-hamburger`
  - Element `#mobile-drawer` con 4 opciones `[data-drawer-action="rutas|rendiciones|altacli|notif"]`

- [ ] **Step 1: Extender test**

```javascript
describe('Hamburger + drawer', () => {
  it('hamburger #mobile-header-hamburger existe', () => {
    expect(HTML).toContain('id="mobile-header-hamburger"');
  });
  it('hamburger invoca openMobileDrawer', () => {
    expect(HTML).toMatch(/id="mobile-header-hamburger"[^>]*onclick="openMobileDrawer\(\)"/);
  });
  it('drawer #mobile-drawer existe', () => {
    expect(HTML).toContain('id="mobile-drawer"');
  });
  it('drawer tiene 4 opciones (rutas, rendiciones, altacli, notif)', () => {
    const actions = ['rutas', 'rendiciones', 'altacli', 'notif'];
    for (const a of actions) {
      expect(HTML).toMatch(new RegExp(`data-drawer-action="${a}"`));
    }
  });
  it('media (min-width:769px) oculta hamburger + drawer', () => {
    expect(HTML).toMatch(/@media[^{]*min-width:\s*769px[\s\S]*?#mobile-header-hamburger[\s\S]*?display:\s*none/);
  });
  it('handlers openMobileDrawer/closeMobileDrawer/_updateHamburgerBadge existen', () => {
    expect(HTML).toContain('function openMobileDrawer');
    expect(HTML).toContain('function closeMobileDrawer');
    expect(HTML).toContain('function _updateHamburgerBadge');
  });
});
```

- [ ] **Step 2: Correr test para verificar failing**

`npx vitest run tests/unit/mobile-nav.test.js` — 6 asserts nuevos fail.

- [ ] **Step 3: Agregar hamburger en `.user-info`**

En `index.html:1666-1680`, antes del `<button class="logout-btn" onclick="signOut()">Salir</button>` agregar:

```html
    <button id="mobile-header-hamburger" onclick="openMobileDrawer()" aria-label="Menú" title="Menú">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      <span id="mob-hamburger-badge" style="display:none">0</span>
    </button>
```

- [ ] **Step 4: Agregar drawer HTML**

Antes de `</body>`:

```html
<aside id="mobile-drawer" onclick="if(event.target===this)closeMobileDrawer()" aria-hidden="true">
  <div class="mdr-box">
    <div class="mdr-head">
      <span>Menú</span>
      <button class="mdr-close" onclick="closeMobileDrawer()" aria-label="Cerrar">&times;</button>
    </div>
    <nav class="mdr-body">
      <button class="mdr-item" data-drawer-action="rutas" onclick="closeMobileDrawer();setTab('rutas')">
        <span class="mdr-icon">&#128662;</span>
        <span class="mdr-label">Rutas</span>
      </button>
      <button class="mdr-item" data-drawer-action="rendiciones" onclick="closeMobileDrawer();setTab('rendiciones')">
        <span class="mdr-icon">&#128176;</span>
        <span class="mdr-label">Rendiciones</span>
      </button>
      <button class="mdr-item" data-drawer-action="altacli" onclick="closeMobileDrawer();setTab('altacli')">
        <span class="mdr-icon">&#128100;</span>
        <span class="mdr-label">Alta clientes</span>
      </button>
      <button class="mdr-item" data-drawer-action="notif" onclick="closeMobileDrawer();setTab('notif')">
        <span class="mdr-icon">&#128276;</span>
        <span class="mdr-label">Notificaciones</span>
        <span class="mdr-item-badge" id="mdr-notif-badge" style="display:none">0</span>
      </button>
    </nav>
  </div>
</aside>
```

- [ ] **Step 5: Agregar CSS**

```css
#mobile-header-hamburger{display:none;position:relative;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;color:#475569;cursor:pointer;padding:8px 10px;min-height:36px;align-items:center;justify-content:center;transition:.15s}
#mobile-header-hamburger:hover{background:#f1f5f9;border-color:#cbd5e1}
#mobile-header-hamburger #mob-hamburger-badge{position:absolute;top:-4px;right:-4px;background:#dc2626;color:#fff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:9px;min-width:16px;text-align:center;line-height:1.3}

#mobile-drawer{position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);display:none;z-index:10000}
#mobile-drawer.open{display:block}
#mobile-drawer .mdr-box{background:#fff;width:min(300px,80vw);height:100vh;box-shadow:2px 0 24px rgba(0,0,0,.3);animation:mdr-slide .25s ease-out;display:flex;flex-direction:column}
@keyframes mdr-slide{from{transform:translateX(-100%)}to{transform:translateX(0)}}
#mobile-drawer .mdr-head{background:linear-gradient(135deg,#0f172a,#334155);color:#fff;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;font-weight:800;text-transform:uppercase;letter-spacing:.4px;padding-top:calc(16px + env(safe-area-inset-top,0))}
#mobile-drawer .mdr-close{background:none;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1}
#mobile-drawer .mdr-body{padding:12px 0;flex:1;overflow-y:auto;display:flex;flex-direction:column}
.mdr-item{background:none;border:none;padding:14px 18px;display:flex;align-items:center;gap:14px;cursor:pointer;font-family:inherit;font-size:14px;color:#0f172a;text-align:left;border-bottom:1px solid #f1f5f9;transition:.1s;position:relative}
.mdr-item:hover{background:#f8fafc}
.mdr-item:active{background:#f1f5f9}
.mdr-item .mdr-icon{font-size:22px}
.mdr-item .mdr-label{font-weight:600;flex:1}
.mdr-item .mdr-item-badge{background:#dc2626;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:9px;min-width:20px;text-align:center}

@media (max-width: 768px) {
  #mobile-header-hamburger { display: inline-flex; }
}
@media (min-width: 769px) {
  #mobile-header-hamburger, #mobile-drawer { display: none !important; }
}
```

- [ ] **Step 6: Agregar funciones JS**

```javascript
function openMobileDrawer(){
  const d = document.getElementById('mobile-drawer');
  if (d) { d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); }
}
function closeMobileDrawer(){
  const d = document.getElementById('mobile-drawer');
  if (d) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
}
// Sincroniza el badge del hamburger con #tab-notif-count.
// Se llama cada vez que se actualiza el contador de notificaciones.
function _updateHamburgerBadge(){
  const src = document.getElementById('tab-notif-count');
  const hb = document.getElementById('mob-hamburger-badge');
  const db = document.getElementById('mdr-notif-badge');
  if (!src) return;
  const n = parseInt(src.textContent || '0', 10);
  const showHb = n > 0;
  if (hb) { hb.style.display = showHb ? 'inline-block' : 'none'; hb.textContent = String(n); }
  if (db) { db.style.display = showHb ? 'inline-block' : 'none'; db.textContent = String(n); }
}
```

Buscar donde se pinta `tab-notif-count` (grep `tab-notif-count`) y agregar `_updateHamburgerBadge();` después de cada asignación al textContent.

Extender listener ESC:

```javascript
if (e.key === 'Escape') {
  const d = document.getElementById('mobile-drawer');
  if (d && d.classList.contains('open')) closeMobileDrawer();
  // ...
}
```

- [ ] **Step 7: Correr test para verificar passing**

`npx vitest run tests/unit/mobile-nav.test.js` — 23 asserts pass.

- [ ] **Step 8: Verificar en browser**

Mobile mode → hamburger visible en el header. Tap → drawer desliza desde la izquierda. Tap cada una de las 4 opciones → drawer cierra + tab correcta activa. Simular una notificación (o modificar `#tab-notif-count` en DevTools) → badge rojo aparece en hamburger y drawer.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/unit/mobile-nav.test.js
git commit -m "feat: hamburger + drawer mobile + badge notif global"
```

---

## Task 7: Bump versión + README + smoke completo

**Files:**
- Modify: `index.html:3498` — `APP_VERSION = 'v429'`
- Modify: `sw.js:20` — `CACHE_VERSION = 'v429'`
- Modify: `README.md` — fila "Versión actual" + entrada changelog v429

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Bump APP_VERSION**

En `index.html:3498`:
```diff
- const APP_VERSION = 'v428';
+ const APP_VERSION = 'v429';
```

- [ ] **Step 2: Bump CACHE_VERSION**

En `sw.js:20`:
```diff
- const CACHE_VERSION = 'v428';
+ const CACHE_VERSION = 'v429';
```

- [ ] **Step 3: Actualizar README.md**

En la tabla del header, buscar la fila "Versión actual" y actualizar:

```markdown
| **Versión actual** | SW v429 (en rama `dev`; **v428 en prod**). v429 introduce bottom-nav mobile (5 slots: Pedido/Dashboard/Home FAB/Cargar/Productos) + hamburger drawer para tabs secundarias (Rutas/Rendiciones/Alta clientes/Notificaciones) + consolidación de Campañas Activas + Exportar a Excel + Rendiciones en un solo botón "Herramientas" (desktop + mobile). Top toolbar oculto en mobile @768px. |
```

Buscar la sección "Changelog" (o similar) y agregar entrada:

```markdown
### v429 (2026-08-07)

**Bottom-nav mobile + consolidación botón Herramientas.**

- Nuevo bottom-nav mobile-only (@768px) con 5 slots pill dark: Pedido | Dashboard | [FAB Home] | Cargar | Productos.
  - Slot Pedido: mini-modal cliente picker → al elegir, va a tab Pedidos con search pre-llenado.
  - Slot Dashboard: abre `openDashboardModal()` (sin cambios).
  - Slot Home (FAB elevado, celeste al estar activo): `setTab('locs')` (mapa).
  - Slot Cargar: bottom-sheet "¿Qué desea cargar?" con Visita Presencial / Contacto No Presencial.
  - Slot Productos: abre `openProductMasterModal()` (buscador de SKU existente).
- Nuevo hamburger `≡` en header mobile con badge global de notificaciones → drawer lateral con Rutas / Rendiciones / Alta clientes / Notificaciones.
- Top toolbar de 9 tabs oculto completamente en mobile (@max-width:768px).
- Consolidación desktop + mobile: los botones "Campañas Activas" + "Exportar a Excel" y la tab "Rendiciones" desaparecen del top toolbar. En su lugar, un único botón amarillo "Herramientas" abre un modal dispatcher con 3 tarjetas. Campañas Activas sigue gated por rol.
- Nuevos tests unitarios: `tests/unit/herramientas-modal.test.js` (8 asserts) + `tests/unit/mobile-nav.test.js` (23 asserts).
```

- [ ] **Step 4: Correr suite completa**

Comando: `npx vitest run`
Expected: todos los tests pasan (existentes + herramientas-modal + mobile-nav).

- [ ] **Step 5: Verificar smoke bundle**

Comando: `npx vitest run tests/smoke/`
Expected: pass (bundle no crece — todo está inline).

- [ ] **Step 6: Verificar listeners test sigue verde**

Comando: `npx vitest run tests/unit/listeners.test.js`
Expected: pass (no agregamos listeners onSnapshot nuevos).

- [ ] **Step 7: Commit**

```bash
git add index.html sw.js README.md
git commit -m "chore: bump v429 (bottom-nav mobile + botón Herramientas)"
```

- [ ] **Step 8: Push a dev**

```bash
git push origin dev
```

---

## Task 8: Deploy a prod (opcional — requiere OK del user)

**NO ejecutar sin confirmación explícita del user.**

Este task es el flujo estándar de deploy documentado en CLAUDE.md regla #20. Solo listar para completar el ciclo.

- [ ] **Step 1: Confirmar con el user que v429 está listo para prod**

Ping al user: "v429 mergeada a `dev` y verificada. ¿Deployamos a prod?"

- [ ] **Step 2: Abrir PR**

```bash
gh pr create --base main --head dev --title "v429: bottom-nav mobile + botón Herramientas" --body "$(cat <<'EOF'
## Summary
- Nuevo bottom-nav mobile de 5 slots (Pedido/Dashboard/Home FAB/Cargar/Productos).
- Hamburger + drawer para tabs secundarias en mobile.
- Consolidación desktop+mobile: Campañas + Exportar + Rendiciones → 1 botón Herramientas.
- Top toolbar mobile oculto @768px.

## Test plan
- [x] `npx vitest run` — todos verdes
- [ ] Manual: iPhone Safari, Android Chrome, tablet, desktop
- [ ] Manual: cada slot del bottom-nav funciona
- [ ] Manual: hamburger + drawer navega a las 4 tabs secundarias
- [ ] Manual: badge de notificaciones aparece en hamburger cuando hay pendientes
- [ ] Manual: modal Herramientas muestra las 3 tarjetas (Campañas gated por rol)
EOF
)"
```

- [ ] **Step 3: Squash merge**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Recrear `dev` desde `main` actualizado**

```bash
git checkout main
git pull origin main
git branch -D dev
git checkout -b dev
git push -u origin dev
```

- [ ] **Step 5: Verificar deploy**

Esperar ~1-2 min. Abrir https://shimano-arg.github.io/app-vendedores/ en mobile y confirmar que el bottom-nav aparece.

---

## Self-Review

**Spec coverage:**
- ✅ Componentes nuevos 1-7 del spec → cubiertos por Tasks 1-6
- ✅ Cambios sobre lo existente (ocultar top toolbar, consolidar 3 botones) → Tasks 1, 2, 7
- ✅ Archivos tocados coincide con la tabla del spec
- ✅ Cada slot del bottom-nav tiene su task o step
- ✅ Botón Herramientas + modal → Task 1 completo
- ✅ Estilo visual (barra dark pill, FAB elevado, safe-area) → Tasks 2, 4, 6 CSS
- ✅ Reglas responsive → Task 2 + refuerzo en Task 6 CSS
- ✅ Testing: 2 test files nuevos, smoke sigue pasando
- ✅ Versionado + deploy → Tasks 7, 8

**Ajustes al spec detectados durante planning (documentar):**
1. Slot PRODUCTOS reusa `openProductMasterModal()` existente (línea 1678) en vez de construir modal nuevo. **Menos código, mejor pattern.**
2. `stock.json` es binario `{SKU: bool}` — 2 estados, no 3. Como reusamos `openProductMasterModal()`, el punto es moot.
3. Flujo PEDIDO: no hay `openPedidoForm(clienteId)` — el cliente picker pre-llena `#pedido-search` y va a la tab Pedidos. Documentado en Task 5.

**Placeholder scan:** ninguno detectado. Todos los steps tienen código concreto o comandos exactos.

**Type consistency:** función names verificados — `openHerramientasModal`/`closeHerramientasModal`, `openCargarSheet`/`closeCargarSheet`, `openPedidoClientePicker`/`closePedidoClientePicker`/`_selectPedidoCliente`, `openMobileDrawer`/`closeMobileDrawer`/`_updateHamburgerBadge`, `_updateHomeActiveState`, `_paintHerramientasDot`. Todos consistentes entre tasks.

**Ambigüedades marcadas explícitamente:**
- Task 2 Step 4: `#main-tabs` puede requerir wrap explícito si no existe hoy — el implementer verifica y ajusta.
- Task 5 Step 3: fuente exacta de clientes (`POINTS` vs otra global) requiere grep de `renderPedidosTab` — implementer verifica.
