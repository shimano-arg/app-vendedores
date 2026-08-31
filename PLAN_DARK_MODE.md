# Plan Dark Mode — Refactor a CSS variables + paleta oscura

**Fecha de armado:** 2026-08-30
**Fecha de cierre:** 2026-08-31
**Owner:** Mariano Erbino
**Estimación revisada:** 20-40 hs (2 semanas part-time o 1 semana full-time)
**Tiempo real ejecutado:** ~1 día (compressed, mismo día 2026-08-30/31)
**Estado:** ✅ **COMPLETADO** — E0 a E5 shipped v736-v746

**Timeline final:**
- v736 (2026-08-30): placeholder button + modal "En construcción"
- v738 (2026-08-30): E1 - infra CSS vars + toggle real + FOUC prevention
- v740-v742 (2026-08-30): iterations de contraste con overrides class-based
- v743 (2026-08-30): E2 - codemod 1964 hex hardcoded -> var(--token) semantic
- v744 (2026-08-30): E3 - assets + edge cases (Leaflet tiles, scrollbars, logos)
- v745 (2026-08-30): E4 - WCAG AA audit programatico + fixes + docs README §36
- v746 (2026-08-31): E5 - rollout announcement one-time modal + monitoring hooks

**Tooling reusable creado:**
- `scripts/dark_mode_codemod.py` (E2)
- `scripts/dark_mode_contrast_audit.py` (E4)

---

## 0. TL;DR

Después del audit real, el scope es **mucho mayor** que la estimación inicial de 4-8 hs. Hay **~4,000 referencias a colores hardcoded** en el repo (2704 hex `#XXXXXX` + 412 hex `#XXX` + 161 rgba + 801 en `src/` + 69 en `chunks/`). Un dark mode "de verdad" requiere refactor sistemático a **CSS variables** + paleta oscura diseñada.

El plan divide el trabajo en 6 fases (E0-E5) ejecutables independientemente. Cada fase entrega valor y se puede pausar entre ellas sin romper la app. **Recomendación:** ejecutar en modo Ralph Loop (tu metodología preferida) con gates claros por fase.

---

## 1. Contexto y motivación

### Estado actual (audit 2026-08-30)

```
=== Colores hardcoded en index.html ===
hex #XXXXXX inline: 2704
hex #XXX (3-char):   412
rgba() calls:        161

=== Colores hardcoded en src/domains/ ===
hex #XXXXXX: 801
hex #XXX:    69

Total: ~4,147 referencias
```

**Buenas noticias del audit:**
- Los colores siguen la **paleta Tailwind estándar** (slate, gray, green, red, violet). No son valores random.
- Solo ~20 colores únicos concentran el 80% de los usos.
- El brand color Shimano (`#00A9E0`) funciona bien en light y dark — no requiere cambio.

### Top 15 colores más usados (representan el 80%)

| Uso | Hex | Rol semántico | Uses |
|---|---|---|---|
| 1 | `#0f172a` | text-primary (slate-900) | 180 |
| 2 | `#cbd5e1` | border-default (slate-300) | 150 |
| 3 | `#475569` | text-secondary (slate-600) | 142 |
| 4 | `#94a3b8` | text-muted (slate-400) | 111 |
| 5 | `#166534` | color-success (green-800) | 110 |
| 6 | `#64748b` | text-placeholder (slate-500) | 108 |
| 7 | `#dc2626` | color-danger (red-600) | 89 |
| 8 | `#7c3aed` | color-accent-violet | 81 |
| 9 | `#e5e7eb` | border-subtle (gray-200) | 80 |
| 10 | `#92400e` | color-warning-dark (amber-800) | 67 |
| 11 | `#fef3c7` | color-warning-bg (amber-100) | 66 |
| 12 | `#f59e0b` | color-warning (amber-500) | 66 |
| 13 | `#f8fafc` | bg-secondary (slate-50) | 65 |
| 14 | `#00A9E0` | **brand-shimano-blue** | 61 |
| 15 | `#991b1b` | color-danger-dark (red-800) | 60 |

### Por qué no hacer un CSS-filter hack

`filter: invert(1) hue-rotate(180deg)` inverso global:
- ❌ Verde Shimano (#166534) → morado feo
- ❌ Azul brand (#00A9E0) → naranja
- ❌ Botones críticos rojos (delete) → cyan (¡anti-señal semántica!)
- ❌ Fotos de rendiciones invertidas ilegibles
- ❌ Charts del Dashboard con colores random

Nivel de calidad: **1/10**. No lo hacemos.

---

## 2. Diseño de tokens (semantic-first)

**Regla:** los tokens se nombran por rol semántico (`--text-primary`), no por color (`--slate-900`). Así el mismo token cambia de valor entre light y dark sin renombrar refs.

### Tabla de tokens propuesta

| Token | Light value | Dark value | Uso |
|---|---|---|---|
| **Backgrounds** | | | |
| `--bg-base` | `#ffffff` | `#0f172a` | Body, root |
| `--bg-secondary` | `#f8fafc` | `#1e293b` | Cards, panels |
| `--bg-elevated` | `#ffffff` | `#334155` | Modales, dropdowns |
| `--bg-input` | `#ffffff` | `#1e293b` | Inputs, selects |
| `--bg-muted` | `#f1f5f9` | `#334155` | Chips, tags neutros |
| **Text** | | | |
| `--text-primary` | `#0f172a` | `#f1f5f9` | Body text, headings |
| `--text-secondary` | `#475569` | `#cbd5e1` | Subheadings, labels |
| `--text-muted` | `#64748b` | `#94a3b8` | Placeholder, meta |
| `--text-disabled` | `#94a3b8` | `#64748b` | Disabled state |
| `--text-inverse` | `#ffffff` | `#0f172a` | Texto sobre bg oscuro (buttons) |
| **Borders** | | | |
| `--border-default` | `#cbd5e1` | `#334155` | Border estándar |
| `--border-subtle` | `#e5e7eb` | `#1e293b` | Border sutil (dividers) |
| `--border-strong` | `#94a3b8` | `#475569` | Border enfatizado |
| **Brand** | | | |
| `--brand-shimano-blue` | `#00A9E0` | `#00A9E0` | Sin cambio (funciona ambos) |
| `--brand-shimano-blue-dark` | `#0891b2` | `#0891b2` | Sin cambio |
| **Semantic** | | | |
| `--color-success` | `#166534` | `#22c55e` | Confirmed, OK |
| `--color-success-bg` | `#dcfce7` | `#14532d` | Success card bg |
| `--color-warning` | `#d97706` | `#fbbf24` | Warning icon/text |
| `--color-warning-bg` | `#fef3c7` | `#78350f` | Warning card bg |
| `--color-danger` | `#dc2626` | `#f87171` | Delete, error |
| `--color-danger-bg` | `#fee2e2` | `#7f1d1d` | Error card bg |
| `--color-danger-strong` | `#991b1b` | `#dc2626` | Hover danger |
| `--color-info` | `#0284c7` | `#38bdf8` | Info messages |
| `--color-accent-violet` | `#7c3aed` | `#a78bfa` | Accent, admin actions |
| **Interactive states** | | | |
| `--focus-ring` | `#00A9E0` | `#38bdf8` | Focus outline |
| `--hover-overlay` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.05)` | Hover state layer |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.06)` | `0 1px 2px rgba(0,0,0,.4)` | Small shadow |
| `--shadow-md` | `0 4px 8px rgba(0,0,0,.1)` | `0 4px 8px rgba(0,0,0,.5)` | Medium shadow |

### Paleta oscura — decisiones de diseño

- **Base:** slate-900 (`#0f172a`), NO black puro. Reduce eye strain en pantallas OLED sin perder contraste con el negro del sistema.
- **Elevación:** 3 niveles (base → secondary → elevated) siguiendo Material Design guidelines. Más oscuro = más "profundo".
- **Text primary:** slate-100 (`#f1f5f9`), NO white puro. Mismo razonamiento (reducir contraste).
- **Colores semánticos:** invertidos hacia el "500-700" range en dark (más brillantes) para mantener contrast ratio WCAG AA (≥4.5:1 texto).
- **Shimano brand blue:** `#00A9E0` funciona bien en ambos temas (accesible sobre light y dark). Sin cambio.

---

## 3. Fases de ejecución

### E0 — Audit final + tokens design (0.5 día) — GATE HUMANO

**Trabajo:**
- Grep exhaustivo de TODOS los colores del repo → CSV con `{file, line, color_hex, context_snippet}`
- Clasificación semántica de cada color (bg / border / text / brand / semantic)
- Refinar tabla de tokens (arriba) según hallazgos del audit
- Mockup visual light + dark de 3 pantallas clave (Mapa principal, Modal pedido, Dashboard) para aprobación Mariano

**Gate:** Mariano aprueba visualmente la paleta dark propuesta antes de tocar código.

**Output:** `PLAN_DARK_MODE_TOKENS.csv` + 6 screenshots mockup

---

### E1 — Infra + tokens base + toggle real (1 día)

**Trabajo:**
- Agregar bloque `:root` con TODAS las variables light-mode al inicio del `<style>` de `index.html`
- Agregar bloque `[data-theme="dark"] :root` con overrides
- Reemplazar el modal placeholder `#dark-mode-modal` (v736) por el toggle REAL:
  - Icon 🌙/☀️ dinámico según tema actual
  - Click → `document.documentElement.setAttribute('data-theme', newTheme)` + localStorage `shimano_theme`
  - Init on load: leer localStorage → apply, fallback a `matchMedia('(prefers-color-scheme: dark)')`
- Firestore sync opcional: `userData/{uid}.themePreference` para cross-device
- **Pilot: refactor SOLO 1 sección** (Panel de Control admin) para validar el approach

**Gate:**
- User puede togglear light/dark
- Preferencia persiste post-reload
- Panel de Control admin se ve OK en ambos modos
- Contrast ratio verificado con browser DevTools

**Bumps:** v738

---

### E2 — Refactor por dominio (2-3 días, dividido)

Refactor sistemático de cada dominio, reemplazando colores hardcoded por CSS variables. Se hace via **script Python codemod** que reemplaza los top-15 colores + review manual por edge cases.

**Sub-fases (cada una es 1 commit independiente):**

**Nota bumps (2026-08-30):** v738 se uso para el Dark Mode hybrid funcional shipped early, y v739+ se estan usando para bug fixes urgentes. Los bumps de la tabla abajo son ORIENTATIVOS - al arrancar E0 real (post-SETUP), reasignar bumps a los siguientes disponibles.

| Sub | Scope | Bump |
|---|---|---|
| E2.a | Header + sidebar-left + mapa base (mapa panel, filtros, badges) | v739 |
| E2.b | Modales de pedidos (waitlist, pedido-en-espera, confirmación) | v740 |
| E2.c | Master Clientes + Alta Cliente + Estado | v741 |
| E2.d | Rendiciones + Rutas + Visitas | v742 |
| E2.e | Panel Usuarios + configs SAP/Gemini + admin | v743 |
| E2.f | Notificaciones + Backorder + Stock Asig + Seguimiento | v744 |
| E2.g | Dashboard (tabs + charts + facturación) | v745 |
| E2.h | Exports + Forecast + Deposito modal | v746 |

**Gate por sub-fase:**
1. Screenshot light + dark de la vista principal de esa sub-fase
2. No hay regressions visuales light (comparación pre/post commit)
3. Grep `grep -rE "#[0-9a-fA-F]{6}"` en el scope debe devolver <10 matches (los restantes justificados en comentario)

---

### E3 — Assets + edge cases (0.5-1 día)

**Trabajo:**
- **Logo Shimano PNG** (`Shimano-Logo.png`): fondo blanco embebido → generar variante dark (fondo transparente o oscuro). Swap dinámico via `<picture>` + `prefers-color-scheme` o CSS `background-image` con var.
- **Leaflet map tiles**: usar tileserver CartoDB Dark Matter para dark mode (free tier)
- **Charts del Dashboard** (top SKUs bars, facturación line chart): recolorizar via `--brand-shimano-blue` y `--text-primary`
- **Rendiciones fotos**: NO invertir (son fotos de tickets del usuario)
- **Scrollbars**: `::-webkit-scrollbar` custom para dark mode
- **Overlays / backdrops**: chequear `rgba(0,0,0,.5)` funciona en ambos, o crear `--overlay-color`

**Gate:** navegación completa por app en dark mode sin elementos rotos/ilegibles.

**Bumps:** v747

---

### E4 — Polish + accessibility (0.5 día)

**Trabajo:**
- **Contrast audit WCAG AA:** herramienta `axe-devtools` o `wave` scan por pantalla. Fixear cualquier ratio <4.5:1 en texto o <3:1 en UI components.
- **Smooth transition:** `body { transition: background-color .2s, color .2s }` para toggle suave
- **Respect `prefers-reduced-motion`:** disable transition si el user tiene reduced motion
- **Toggle button UX:** icon rotate animation, tooltip claro
- **README §36 update:** documentar paleta + toggle + storage
- **Test en Chrome, Firefox, Safari mobile y desktop**

**Gate:** cero issues WCAG AA + funciona en 4 browsers principales.

**Bumps:** v748

---

### E5 — Deploy + rollout (0.5 día)

**Trabajo:**
- Deploy con toggle habilitado para todos los users (default: light + respeta OS preference)
- Notificación in-app a users: "🌙 Nuevo: modo oscuro. Toggle arriba a la derecha."
- Monitor 1 semana: Sentry + feedback vía WhatsApp
- Si estable → cerrar plan
- Si issues → v750 con fixes

**Bumps:** v749 (rollout comm) + posibles fixes

---

## 4. Toggle mechanism (detalle técnico)

### HTML markup

Reemplazar el placeholder `#dark-mode-btn` v736 con:

```html
<button class="logout-btn theme-toggle" id="theme-toggle" onclick="toggleTheme()"
        title="Cambiar tema (claro/oscuro)" aria-label="Cambiar tema">
  <svg id="theme-icon-light" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <!-- Sol SVG -->
  </svg>
  <svg id="theme-icon-dark" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="display:none">
    <!-- Luna SVG (misma que v736) -->
  </svg>
</button>
```

### JS

```javascript
const THEME_KEY = 'shimano_theme';

function getEffectiveTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-icon-light').style.display = theme === 'dark' ? 'inline-flex' : 'none';
  document.getElementById('theme-icon-dark').style.display = theme === 'light' ? 'inline-flex' : 'none';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  // Firestore sync opcional (cross-device)
  if (typeof currentUser !== 'undefined' && currentUser && typeof fbDb !== 'undefined') {
    fbDb.collection('userData').doc(currentUser.uid).set({themePreference: next}, {merge: true}).catch(() => {});
  }
}

// Init on load (antes de que el user vea la UI para evitar flash)
(function initTheme() { applyTheme(getEffectiveTheme()); })();
```

### CSS init (para evitar FOUC — Flash Of Unstyled Content)

Poner el `<script>` de init INLINE en el `<head>`, ANTES de cualquier `<link rel="stylesheet">`.

---

## 5. Storage strategy

| Layer | Contenido | Rationale |
|---|---|---|
| **localStorage** `shimano_theme` | `'light' \| 'dark' \| null` | Fuente de verdad local. Aplica inmediato sin round-trip. |
| **Firestore** `userData/{uid}.themePreference` | Same values | Cross-device sync. Se lee en `onAuthStateChanged` para hidratar localStorage si nunca fue seteado en este device. |
| **OS preference** `matchMedia('(prefers-color-scheme: dark)')` | Fallback | Si NUNCA se seteó localStorage ni Firestore. Respeta preferencia del sistema del user. |

**Precedencia:** localStorage > Firestore > OS. Toggle manual siempre gana.

---

## 6. QA plan (por sub-fase E2)

Cada sub-fase debe pasar este checklist antes de commit:

- [ ] Screenshot **light mode** de la vista principal vs baseline pre-commit → no hay regressions visuales
- [ ] Screenshot **dark mode** de la misma vista → se ve OK (contrast, legibilidad, no elementos "flotando" sin border)
- [ ] Grep `#[0-9a-fA-F]{6}` en el scope → <10 matches restantes, todos justificados con comment
- [ ] Toggle light↔dark 5 veces sin refresh → estado consistente, sin FOUC
- [ ] Contrast ratio checked con DevTools > A11y para 3 elementos clave (headings, body text, disabled state)
- [ ] Funciona en Chrome desktop + mobile

---

## 7. Riesgos + mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Regressions visuales en light mode al refactorizar | Alto (rompe UX de todos los users) | Screenshot pre/post por sub-fase. Codemod bulk-replace con revisión visual, no ejecutar sin verificar |
| FOUC (Flash Of Unstyled Content) durante init | Medio (UX molesta al abrir) | Init inline en `<head>` antes de CSS. Set attribute ANTES de render |
| Firestore sync roto por rules restrictivas | Bajo (funciona local, no cross-device) | Firestore rule `userData/{uid}` ya permite write al owner. No requiere cambio |
| Charts del Dashboard con colores fijos ilegibles en dark | Medio | E3 refactoriza chart colors explicitamente |
| Screenshots del vendedor pierden legibilidad si él tomó fotos con flash blanco | Bajo | Fotos NO se invierten (E3 explicit) |
| Users no descubren el toggle | Bajo | E5 notification in-app cuando se rollout |
| Bundle size crece por CSS variables extras | Bajo | ~50 vars × ~20 chars = ~1 KB (negligible vs 2.5 MB bundle) |

---

## 8. Timeline y hitos

| Fase | Duración | Cumulative | Gate |
|---|---|---|---|
| E0 | 0.5 día | 0.5 | Mockups aprobados Mariano |
| E1 | 1 día | 1.5 | Toggle real funcionando en Panel Control |
| E2 (8 sub-fases) | 2-3 días | 3.5-4.5 | Cada sub-fase con screenshot pre/post |
| E3 | 0.5-1 día | 4-5.5 | Assets + edge cases resueltos |
| E4 | 0.5 día | 4.5-6 | WCAG AA + browser matrix |
| E5 | 0.5 día | 5-6.5 | Rollout + monitor |
| **Total** | **5-7 días full-time** | | |

En modo Ralph Loop part-time (2-3 hs/día): **2-3 semanas calendario**.

---

## 9. Metodología recomendada: Ralph Loop

Este plan es candidato perfecto para tu metodología Ralph Loop (per feedback memory):
- Criterios verificables por sub-fase (grep counts + screenshots)
- Fases pequeñas ejecutables independientes
- Gate humano en E0 (aprobación palette) y opcional post-cada-sub-fase

**Prompt inicial sugerido para el loop** (a colocar en `Desktop\Notas\LOOP_PROMPT_DARK_MODE.md`):

```
Ejecutar E<N>.<X> del PLAN_DARK_MODE.md.
Gate: los criterios del checklist QA de la sub-fase.
No arrancar E<N+1> hasta que el gate pase verde.
Commitear en dev con bump de version correspondiente.
Actualizar README.md fila "Versión actual" en el mismo commit.
Reportar al final del sub-fase con: colores refactorizados count / files touched / screenshots diff.
```

---

## 10. Decisiones tomadas (2026-08-30, Mariano)

| Pregunta | Decision |
|---|---|
| Firestore sync de la preferencia (cross-device) | **SI** - sync a `userData/{uid}.themePreference`. Mejor UX cross-device. |
| Default para users nuevos | **Respetar OS preference** (`prefers-color-scheme`). Pattern moderno. |
| Timing arranque E0 | **Despues de la reunion SETUP** (miercoles 2026-09-03+). Prioridad: no distraer la reunion. |
| Modo de ejecucion | **Ralph Loop autonomous**. Gates auto-verificables. Revision al final de cada fase. |

**Proximos pasos concretos:**
1. Reunion SETUP martes 2026-09-02 (ver `Brief_Reunion_SETUP_Integracion.md`)
2. Post-reunion evaluar si integracion SETUP es prioridad inmediata o no
3. Si SETUP no bloquea: arrancar E0 (audit final + mockups) via Ralph Loop
4. Prompt del loop vive en `Desktop\Notas\LOOP_PROMPT_DARK_MODE.md`

---

## Anexos

### A. Script codemod (E2 support)

Python script propuesto para bulk-replace en cada sub-fase:

```python
# scripts/dark_mode_codemod.py
import re
from pathlib import Path

TOKEN_MAP = {
    '#0f172a': 'var(--text-primary)',
    '#cbd5e1': 'var(--border-default)',
    '#475569': 'var(--text-secondary)',
    '#94a3b8': 'var(--text-muted)',
    '#166534': 'var(--color-success)',
    '#64748b': 'var(--text-placeholder)',
    '#dc2626': 'var(--color-danger)',
    '#7c3aed': 'var(--color-accent-violet)',
    '#e5e7eb': 'var(--border-subtle)',
    '#f8fafc': 'var(--bg-secondary)',
    '#00A9E0': 'var(--brand-shimano-blue)',
    '#991b1b': 'var(--color-danger-strong)',
    # ... top 40 mas usados
}

def refactor_file(path: Path, dry_run: bool = True):
    src = path.read_text(encoding='utf-8')
    count = 0
    for hex_val, token in TOKEN_MAP.items():
        # Solo dentro de inline styles + CSS rules, no en strings JS random
        pattern = re.compile(re.escape(hex_val) + r'\b', re.IGNORECASE)
        new_src, n = pattern.subn(token, src)
        count += n
        src = new_src
    if not dry_run:
        path.write_text(src, encoding='utf-8')
    return count

# Uso:
# python scripts/dark_mode_codemod.py --scope index.html --dry-run
# python scripts/dark_mode_codemod.py --scope src/domains/dashboard.js --apply
```

### B. Referencias externas

- [Material Design 3 - Dark theme guidelines](https://m3.material.io/styles/color/dark-theme)
- [Apple HIG - Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [WCAG 2.1 contrast ratios](https://www.w3.org/WAI/WCAG21/quickref/#contrast-minimum)
- [CSS `prefers-color-scheme` MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme)

---

**Próximo paso:** responder las 4 preguntas de sección 10. Con eso arrancamos E0.
