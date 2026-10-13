# Accessibility Audit — 2026-10-13

## Executive summary (max 5 lines)

Light mode fails WCAG 2.1 AA on **10 of 26** color pairs tested (dark mode passes 24/26 after v745 remediation). The biggest a11y risks are: (1) `user-scalable=no` in the viewport blocks pinch-zoom (WCAG 1.4.4 fail — outdoor sunlight + mid-30s-50s users = critical for this persona), (2) **zero** `role="dialog"` / `aria-modal` / `aria-live` across 77 modal-overlays and ~15 toast call-sites (screen readers cannot discover modals or hear async confirmations), (3) 102 `<div onclick>` interactive controls with no `tabindex` / `role="button"` / keyboard activation, and (4) only 3 of ~50 modals honor Escape to close. Mobile touch targets are inconsistent — bottom nav is 48x48 (good) but admin pills (`.app-btn-pill`) are ~30px (below Apple HIG 44px for gloved outdoor use).

## WCAG contrast violations

Source: `scripts/dark_mode_contrast_audit.py` executed 2026-10-13 against tokens in `index.html` `:root` + `[data-theme="dark"]` blocks (lines ~230-770).

### Light theme — 10 failing pairs

| fg | bg | ratio | AA req | pass? | location |
|---|---|---|---|---|---|
| `#94a3b8` text-disabled | `#ffffff` bg-base | 2.56 | 3.0 (UI) | FAIL | `index.html:~685` `:root --text-disabled` — used in disabled buttons, placeholders |
| `#d97706` color-warning | `#fef3c7` warning-bg | 2.86 | 4.5 | FAIL | `.viewer-readonly-banner` `index.html:1041`; warning summary chips (backorders-summary L5459) |
| `#dc2626` color-danger | `#fee2e2` danger-bg | 3.95 | 4.5 | FAIL | `.password-gate-body #pwd-gate-error:1180`; many inline error boxes |
| `#ffffff` on `#d97706` warning | — | 3.19 | 4.5 | FAIL | `.btn-camp` with warning variant; "Generar Backorder" `index.html:5452` (#b45309 is a touch better but same family) |
| `#ffffff` on `#00A9E0` brand-shimano-blue | — | 2.71 | 4.5 | FAIL | Shimano logo pill `.logo-text` 983; `.header-hamburger` 962; "Z1-Z7" buttons; many brand primaries |
| `#cbd5e1` border-default | `#ffffff` bg-base | 1.48 | 3.0 (UI) | FAIL | ~95% of form field borders (`.bo-ctl` 920, `.sap-input` 1383, `.mc-toolbar input` 1396) — borders invisible against page bg |
| `#cbd5e1` border-default | `#ffffff` bg-elevated | 1.48 | 3.0 (UI) | FAIL | Same tokens in modal content areas |
| `#94a3b8` border-strong | `#ffffff` bg-base | 2.56 | 3.0 (UI) | FAIL | Legacy table dividers, used in `.users-table` etc. |
| `#00A9E0` focus-ring | `#ffffff` bg-base | 2.71 | 3.0 (UI) | FAIL | **Critical** — focus indicator on page bg does not meet non-text 3:1 (WCAG 1.4.11). Light mode has no global `:focus-visible` rule; dark mode does (`index.html:767`) |
| `#00A9E0` focus-ring | `#ffffff` bg-elevated | 2.71 | 3.0 (UI) | FAIL | Same — focus ring invisible inside modals |

### Dark theme — 2 failing pairs (minor)

| fg | bg | ratio | AA req | pass? | location |
|---|---|---|---|---|---|
| `#475569` border-default | `#0f172a` bg-base | 2.36 | 3.0 | FAIL | Same tokens — dark card borders on page bg |
| `#475569` border-default | `#334155` bg-elevated | 1.37 | 3.0 | FAIL | Border between elevated card and modal content — invisible |

Also note: `color-warning #d97706` on `color-warning-bg #fef3c7` is listed as "warning text on warning bg" but in practice the common pattern is **text on page bg** inside a warning banner — the actual contrast in use (e.g., `.viewer-readonly-banner` text `#d97706` on `--color-warning-bg #fef3c7`) IS the fail above.

## Findings

### CRITICAL (blocks a user from completing a task)

#### A1. Viewport blocks user zoom — WCAG 1.4.4 Resize text

- **Area:** forms / mobile
- **WCAG criteria:** 1.4.4 (AA), 1.4.10 (AA Reflow)
- **Problem:** `index.html:5` `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover">` disables pinch-zoom. For a vendor who is a) 35-50 years old (presbyopia common), b) using the app outdoors with sunlight glare, c) sometimes with gloves, the inability to zoom into product codes / client names / SKUs is a task-blocking barrier. Known Shimano user persona per `CLAUDE.md`. iOS 10+ ignores `user-scalable=no` out of the box, but all Android browsers honor it.
- **Fix:** remove `maximum-scale`, `minimum-scale` and `user-scalable=no`. Keep `initial-scale=1.0, viewport-fit=cover`. If the only reason to prevent zoom is to stop accidental zoom on form focus (iOS Safari default behavior), the correct remedy is `font-size: 16px` on inputs (already done on login — just extend to all inputs). Replacement line: `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`.
- **Effort:** small (1-line change + check inputs are ≥16px font to avoid iOS auto-zoom)

#### A2. Zero `role="dialog"` + `aria-modal` on 77 modal overlays

- **Area:** screen-reader / focus
- **WCAG criteria:** 4.1.2 Name/Role/Value, 2.4.3 Focus Order
- **Problem:** Grep `role="dialog"` / `aria-modal` across `index.html` returns **0 matches** (32,640-line file, 267 "modal" references, 77 `class="modal-overlay"` instances including Backorder, Stock Asignado, Estado, Reparto, Panel Control, Planner, Meli, Zonas, Visita, Alta Cliente, Targets, Admin, SAP, Master Clientes, etc.). Screen readers announce the surrounding page as if the modal didn't exist; the AT-tree sees a flat tree with the modal just floated above the body. VoiceOver / NVDA / TalkBack users on mobile can swipe into content behind the modal and interact with it accidentally.
- **Fix:** on every `<div class="modal-overlay" id="...">`:
  1. Add `role="dialog"` + `aria-modal="true"`.
  2. Add `aria-labelledby="<modal-h2-id>"` referencing the modal's `<h2>` (give the `<h2>` an `id` first).
  3. If modal has subtitle `<div class="subt">`, add `aria-describedby="<subt-id>"`.
  4. When `.open` class is added, call `document.getElementById('<modal>').focus()` on the dialog itself (needs `tabindex="-1"` added once) OR focus the first interactive child.
  5. Mark background `inert` while modal is open (polyfill or manually `aria-hidden="true"` + `tabindex="-1"` on siblings).
- **Effort:** medium (template-level change — ~50 modal declarations × 2 attributes + 1 JS helper `_openModal(id)` / `_closeModal(id)` to centralize)

#### A3. No `aria-live` region on toasts / snack / error notifications

- **Area:** screen-reader
- **WCAG criteria:** 4.1.3 Status Messages (AA)
- **Problem:** `window._showErrorToast` (`index.html:24336`), `showZonasToast` (24366), `.sync-tag` (styles at 1007 / usage dynamic), the SAP health badge (3499), and the hamburger notification badge (3489) all mutate the DOM to communicate status, but **zero** `aria-live` or `role="status"` / `role="alert"` attributes exist in the entire HTML. Grep: 0 matches for `aria-live` / `role="status"` / `role="alert"`. A vendor using TalkBack hitting "Enviar pedido a SAP" gets no auditory confirmation. The red error toast after a 6-second timeout is invisible to AT.
- **Fix:**
  1. Add a dedicated persistent polite region at `<body>` end: `<div id="_a11y-announcer" role="status" aria-live="polite" aria-atomic="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden"></div>`.
  2. Modify `_showErrorToast` to also write `document.getElementById('_a11y-announcer').textContent = msg;` (clear + set to force re-announce; add 50ms clear-then-set pattern).
  3. For error toast, use a separate `role="alert"` region (assertive), for info/success use the polite one.
  4. Give the `.sync-tag` + badges `aria-live="polite"` directly or echo their changes to the announcer.
- **Effort:** small (1 shared helper + 5 call sites)

#### A4. 102 `<div onclick>` controls are not keyboard-operable

- **Area:** keyboard
- **WCAG criteria:** 2.1.1 Keyboard (A — level A failure, worse than AA), 4.1.2 Name/Role/Value
- **Problem:** 102 `<div onclick=...>` call-sites, 0 `role="button"`, 0 `tabindex="0"` in the whole file. Specific examples: all `.exp-opt` export options (`index.html:3786-3843`), `.cs-cta` cards in `cargar-sheet` bottom-sheet, picker list items `_selectPedidoCliente(this)` (13448), `.ac-row` rows, map-point clickable div, modal-overlay backdrops (which also trap click but divs are focusable only via screen-reader interactor). A keyboard-only or Switch Control user cannot activate the Export modal, cannot pick a client for a new order via mobile sheet, cannot select from a product picker row.
- **Fix:** two orthogonal moves:
  1. Convert interactive `<div>` to `<button type="button">` where possible (export options, pick list items, drop-zones). CSS mostly already assumes button-like styling; strip `<button>` default border/background with `background:none;border:none;padding:0`.
  2. Where DOM constraint prevents a `<button>` (nested anchors, legacy wrappers), add `role="button" tabindex="0"` + keyboard listener (`keydown` on Enter/Space → `e.preventDefault(); click();`). Create helper `_makeActivatable(el, fn)` in a shared module and call it after render.
- **Effort:** large (102 sites × manual review; most are generated at runtime, so edit the render functions in `src/domains/*.js` + bundle rebuild)

#### A5. Only 3 of ~50 modals honor Escape to close

- **Area:** keyboard
- **WCAG criteria:** 2.1.1, 2.1.2 No Keyboard Trap
- **Problem:** `index.html:13512-13522` installs a global Escape handler for only 3 elements: `#cargar-sheet`, `#pedido-cliente-picker`, `#mobile-drawer`. The ~47 other modal-overlays (Backorder, Stock Asignado, Estado, Reparto, Panel Control, Planner, Export, Stock, Product Master, Zonas, Admin, SAP, Visita, Alta Cliente, Targets, Review, Contacto, etc.) can only be dismissed via mouse click on the backdrop or the `×` button — a keyboard-only user is trapped if focus leaves the close button.
- **Fix:** replace per-modal escape handling with a universal handler at bottom of the keydown listener:
  ```js
  if (e.key === 'Escape') {
    const openModal = [...document.querySelectorAll('.modal-overlay.open')].pop();
    if (openModal) {
      const closeBtn = openModal.querySelector('[data-modal-close], .modal-close');
      if (closeBtn) closeBtn.click();
    }
  }
  ```
  Convention: give every `×` close `<button>` an attribute `data-modal-close` so the handler can find it generically regardless of its specific onclick.
- **Effort:** small (central handler + one grep-sweep adding `data-modal-close`)

#### A6. Focus ring invisible in light mode — no `:focus-visible` global rule

- **Area:** focus / contrast
- **WCAG criteria:** 2.4.7 Focus Visible (AA), 1.4.11 Non-text Contrast
- **Problem:** `index.html:767` only sets `[data-theme="dark"] *:focus-visible { outline: 2px solid var(--focus-ring); }` — light mode has no equivalent. 117 occurrences of `outline:none` on inputs / selects / buttons across `index.html` + `apple-design.css`. The brand focus ring color (`#00A9E0`) itself only hits 2.71:1 on white (see contrast table A1) so even if the rule existed it would fail 1.4.11. On most forms light-mode keyboard users receive **no visible focus**.
- **Fix:**
  1. Add a global rule mirroring the dark one: `*:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }` (not scoped to a theme).
  2. Darken the light-mode `--focus-ring` token from `#00A9E0` to e.g. `#0077A1` or `#006AA1` which gets ≥3:1 on white. Keep the brand blue elsewhere, define `--focus-ring` separately in light.
  3. On the 15+ inputs with `box-shadow:0 0 0 3px rgba(...)` focus patterns (`.bo-ctl:focus` at 934), either preserve them AND the outline, or drop outline in favor of the box-shadow but ensure its contrast on light bg is ≥3:1.
- **Effort:** medium (1 CSS rule globally + token update + manual check that the new ring is visible on known-tricky backgrounds — modal headers which use gradients)

### IMPORTANT (degrades experience but has workaround)

#### A7. 69 close buttons announced as "multiplication sign" / "times"

- **Area:** screen-reader
- **WCAG criteria:** 4.1.2 Name/Role/Value, 2.4.4 Link Purpose
- **Problem:** Of 69 modal close `<button>` elements containing the `×` glyph (`&times;` / `×` / `&#215;`), only ~7 have `aria-label="Cerrar"` (visible on lines 32430, 32453, 32465, 32534, 32561, 32588, 32628). The rest (e.g., `index.html:3407, 3721, 3751, 3782, 3866, 3887, 3921, 3963, 3999, 4038, 4064, 4092, 4151, 4176, 4213, 4306, 4323, 4411, ..., 5411, 5477, ...`) announce as "times, button" or "multiplication sign, button" to NVDA/VoiceOver.
- **Fix:** sweep all `<button class="modal-close">&times;</button>` → `<button class="modal-close" aria-label="Cerrar modal">&times;</button>`. Alternatively hide the glyph from AT and use text: `<button class="modal-close" aria-label="Cerrar"><span aria-hidden="true">&times;</span></button>` (ensures the glyph never leaks through).
- **Effort:** small (sed-replace across the 69 instances)

#### A8. Labels not linked to inputs on the Visita form + Alta Cliente

- **Area:** forms
- **WCAG criteria:** 1.3.1 Info and Relationships, 3.3.2 Labels or Instructions
- **Problem:** `index.html:3530` `<label>Zona:</label>` precedes a `<select>` with no `for=` / `id=` linkage. Same pattern on 43+ `<label>` elements of the Visita form (`index.html:4332, 4353, 4362, 4365, 4373, 4374, 4387, 4388, 4397, 4403, 4406, ...`). `alta-cliente.html:74-80+` has ~30 `<div class="row"><label>...</label><input ...>` with the label never linked. Only 21 of 85 labels in `index.html` use `for=`. Screen readers announce the input alone without context ("edit box, blank") because the label is not programmatically associated.
- **Fix:** two options:
  1. Add `for="X"` on label + `id="X"` on input (preferred — allows click-label-to-focus).
  2. Wrap input inside label: `<label>Zona:<select>...</select></label>` (works without `for=` because of DOM nesting). CSS layout may need to adjust.
- **Effort:** medium (85+ labels across 2 files, mostly mechanical)

#### A9. 6 search inputs are `type="text"` instead of `type="search"`

- **Area:** forms / mobile
- **WCAG criteria:** 1.3.5 Identify Input Purpose (AA)
- **Problem:** `rv-search` (4229), `seg-fcliente` (4519), `pm-search` (4963), `rd-todas-search` (5358), `cpst-search` (5482), `backorders-tienda-filter` (5430) are `<input type="text">` for search semantics. iOS/Android show a search-specific keyboard (magnifying glass "Buscar" button) + native clear control when `type="search"` is used. 14 inputs already use `type="search"` elsewhere — the audit is about the ones that don't.
- **Fix:** change `type="text"` → `type="search"` on these 6 inputs. Also add `role="searchbox"` is redundant but add `aria-label="Buscar <X>"` because many don't have an associated label.
- **Effort:** small

#### A10. `<img onclick>` on the Shimano logo without keyboard activation

- **Area:** keyboard
- **WCAG criteria:** 2.1.1, 4.1.2
- **Problem:** `index.html:3490` `<img src="Shimano-Logo.png" alt="Shimano" class="header-logo" onclick="if(confirm('Recargar la aplicacion?'))location.reload()" title="Click para refrescar la app"/>`. Logo is an `<img>`, not a button, not keyboard-focusable, cannot be activated with Enter/Space. Also `alt="Shimano"` is misleading — the image serves a reload-the-app function, not a brand identifier at that moment.
- **Fix:** wrap in button: `<button type="button" aria-label="Recargar la aplicacion" onclick="..." class="header-logo-btn"><img src="Shimano-Logo.png" alt="" class="header-logo"></button>`. Keep decorative `alt=""` on `<img>` because the button already carries the accessible name.
- **Effort:** small (1 element + minor CSS to kill button default styling)

#### A11. 73 CSS animations, only ~26 wrapped in `prefers-reduced-motion`

- **Area:** motion
- **WCAG criteria:** 2.3.3 Animation from Interactions (AAA), 2.3.1 Three Flashes (A — low risk here)
- **Problem:** 17 `@keyframes` + 56 `animation:` properties, but only 26 `@media (prefers-reduced-motion: reduce)` rules neutralize them. Specifically: `authSpin` (3483 — login spinner), `ocr-spin` (1251), `pulse-mc` (1441 — pulses an edit button, visually distracting), `cs-fade` + `cs-slide` (1961, 1963 — bottom-sheet animations), modal slide-ins across apple-design.css, campaign/dashboard transition curves. Users with vestibular sensitivity on a bright mobile screen get constant motion.
- **Fix:** add two umbrella rules:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
  Note this is intentionally more aggressive than the current scoped overrides and overrides apple-design.css v650 `180ms` fade. If apple-design mod team prefers a softer approach (per CLAUDE.md #21 §14), use `0.001s` → the result is the same user-wise.
- **Effort:** small (one global override — but validate no interaction depends on animation completion event timing)

#### A12. Small touch targets on admin pills + hamburger menu

- **Area:** touch
- **WCAG criteria:** 2.5.5 Target Size (AAA), 2.5.8 Target Size Minimum (2.2 AA)
- **Problem:** `.app-btn-pill` 1188 `padding:8px 16px; font-size:11px` → ~30px tall. `.logout-btn` 992 `min-height:36px; min-width:64px`. `.header-hamburger` 962 `height:36px; width:44px`. `.modal-close` 2492 `padding:0 6px; font-size:24px` → ~30x25px effective. WCAG 2.2 added 2.5.8 "Target Size Minimum" at 24x24 CSS (lower bar than Apple HIG 44x44 but still fails on `padding:0 6px`). Mobile persona + gloves + outdoor use amplifies the issue.
- **Fix:** 
  1. Change `.app-btn-pill` min-height from implicit ~30px to `min-height:44px`.
  2. Change `.logout-btn` from `min-height:36px` to `min-height:44px`.
  3. Change `.header-hamburger` from `height:36px` to `height:44px`.
  4. `.modal-close` buttons: add `min-width:44px; min-height:44px; display:inline-flex; align-items:center; justify-content:center`.
- **Effort:** small (4 CSS rules — may force header layout rebalance, test on mobile breakpoint)

#### A13. 85+ `<label>` without `for=` on filter controls + Visita Form

- **Area:** forms (merged with A8 above but separate symptom)
- **WCAG criteria:** 3.3.2 Labels or Instructions
- **Problem:** header zone/provincia/localidad selects (3530, 3541, 3543) and most of Visita Form fields show visible text labels but the labels are not programmatically linked. The required markers (`<span class="req">*</span>`) are visual-only; SRs don't announce "required" because inputs lack `aria-required="true"` AND the labels are detached.
- **Fix:** combined with A8 (one effort). Also add `aria-required="true"` to inputs matching `[required]` already present on hidden inputs — the attribute should be on the user-visible search input, not the hidden backing field.
- **Effort:** medium

#### A14. Tab-like UI without `role="tab"` / `role="tablist"` / `role="tabpanel"`

- **Area:** screen-reader
- **WCAG criteria:** 1.3.1, 4.1.2
- **Problem:** 147 occurrences of `tab-btn` / `tab-pane` across `index.html` — e.g., `.visita-tabs` (4325), `.rd-subtab-btn` (1235), `.vt-btn` (4326-4327), `.dash-tab-btn` — but zero `role="tab"` / `role="tablist"` / `role="tabpanel"` / `aria-selected` / `aria-controls`. Users navigating with SR heard-of-tabs semantics have no idea that these buttons switch content; they also don't support arrow-key navigation (ARIA APG tabs pattern).
- **Fix:** convert the most-used tab groups first: `.visita-tabs`, `.rd-subtab-btn`, Backorders modal filters (if any). Pattern:
  ```html
  <div role="tablist" aria-label="Vista de visita">
    <button role="tab" aria-selected="true" aria-controls="visita-pane-form" id="visita-tab-nueva">Nueva visita</button>
    <button role="tab" aria-selected="false" aria-controls="visita-pane-list" id="visita-tab-mis">Mis visitas</button>
  </div>
  <div role="tabpanel" id="visita-pane-form" aria-labelledby="visita-tab-nueva">...</div>
  ```
  Add arrow-key handler to the tablist (per ARIA APG).
- **Effort:** medium (central helper for tablist pattern + sweep 5-10 tab groups)

### MINOR / polish

#### A15. `lang="es"` could be `lang="es-AR"` + mark English fragments

- **Area:** lang
- **WCAG criteria:** 3.1.1 Language of Page, 3.1.2 Language of Parts
- **Problem:** `<html lang="es">` is correct but not specific (Spanish-ES vs Spanish-AR differ in pronunciation; SR Spanish voice may use Castilian vocabulary). Also SAP-origin terms (DOCNUM, DocEntry, SO, SQ, backorder, SKU) are English, embedded in Spanish paragraphs; without `<span lang="en">` SR mispronounces them.
- **Fix:** change `<html lang="es-AR">`. For high-frequency embedded tokens like "DOCNUM", "SKU", add `<abbr lang="en" title="Stock Keeping Unit">SKU</abbr>` or `<span lang="en">DOCNUM</span>` in templates. Low priority — Spanish-AR voices handle most SAP terms acceptably.
- **Effort:** small (1-char html tag + optional per-term tagging)

#### A16. `aria-label` missing on hamburger badge; badge not announced as count

- **Area:** screen-reader
- **WCAG criteria:** 4.1.2
- **Problem:** `index.html:3489` the hamburger button has `aria-label="Menu"` (good) but the inner badge span showing notification count `<span id="mob-hamburger-badge">0</span>` lacks any role or label. SR announces "Menu, button, 0" — ambiguous ("menu button has 0 what?").
- **Fix:** dynamically update the button's `aria-label`: `btn.setAttribute('aria-label', 'Menu (' + count + ' notificaciones)')`. Or wrap the number in `<span class="visually-hidden">notificaciones pendientes:</span>5`.
- **Effort:** small

#### A17. Decorative SVG icons mostly correct, but a few missing `aria-hidden`

- **Area:** screen-reader
- **WCAG criteria:** 1.1.1 Non-text Content
- **Problem:** 13 `<svg>` elements, 4 have `aria-` attribute. Mobile bottom nav SVGs (32336+) correctly set `aria-hidden="true"` and parent button has `aria-label`. The theme icon SVGs (3525) are tagged `aria-hidden="true"` with `aria-label` on the button — correct. But the Google icon on line 3469 (login UI) and the OCR dynamic buttons (`src/...` line 6995, 7026) also have `aria-hidden="true"` — those appear OK. The main gaps: dynamically-rendered location-pin, map-marker, chevron-down SVGs created in rendering code likely miss `aria-hidden`. Lower priority since the parent `<button>` carries the label most of the time.
- **Fix:** audit the ~20 SVG `innerHTML = '<svg>'` call sites in `src/domains/*.js` and `index.html` render functions — add `aria-hidden="true"` to all decorative SVGs.
- **Effort:** small-medium

#### A18. `img` elements inside photo-cells have empty `alt=""`

- **Area:** screen-reader
- **WCAG criteria:** 1.1.1
- **Problem:** `index.html:6099` image viewer `<img id="img-viewer-img" alt=""/>` — appropriate when alt is unknown at render time but should be set dynamically. 18535/18543 photo thumbnails `<img src="..." alt=""/>` — these are visita documentation photos (ARCA constancia, store frontage); the empty alt discards legitimate semantic info. A SR user who navigates the Alta Cliente queue cannot know which photo is which.
- **Fix:** when rendering, use a descriptive alt: `alt="Frente del comercio"`, `alt="Interior del comercio"`, `alt="Constancia ARCA"`. For the viewer, update `img.alt` when the user clicks a thumbnail.
- **Effort:** small-medium (requires knowing which photo-cell is which semantic slot)

#### A19. Focus not restored to trigger on modal close

- **Area:** focus
- **WCAG criteria:** 2.4.3 Focus Order
- **Problem:** No `activeElement` saved before modal open; on close, focus returns to `<body>` (effectively nothing). Keyboard-only users lose their place every time they open+close a dialog. 21 `.focus()` calls exist but none restore the trigger.
- **Fix:** central `_openModal(id)` helper:
  ```js
  function _openModal(id){
    const modal = document.getElementById(id);
    modal._prevFocus = document.activeElement;
    modal.classList.add('open');
    // first focusable
    const first = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first || modal).focus();
  }
  function _closeModal(id){
    const modal = document.getElementById(id);
    modal.classList.remove('open');
    if (modal._prevFocus && modal._prevFocus.focus) modal._prevFocus.focus();
    modal._prevFocus = null;
  }
  ```
  Then migrate `openXModal()` / `closeXModal()` incrementally. Combine with A2 and A5 for a one-pass refactor.
- **Effort:** medium

#### A20. Hamburger menu badge indicator relies on color alone

- **Area:** color / cognitive
- **WCAG criteria:** 1.4.1 Use of Color
- **Problem:** The `.hdr-info-badge sap-unknown/sap-ok/sap-fail` (3499) uses only color to convey SAP sync health. For users with protanopia/deuteranopia (red-green blind), green vs red cannot be distinguished reliably. The dot before the label is also color-only.
- **Fix:** include a glyph in the label (`✓ SAP OK`, `! SAP sync lento`, `✗ SAP caído`) OR add an `aria-label` suffix (`SAP ok`, `SAP falla`). The dot can be replaced with a shape (circle for OK, triangle for warning, X for fail).
- **Effort:** small

## Positive observations

- **Dark mode remediation (v745)** is substantial — the audit script shows 24/26 pass on dark, and the token overrides (`color-success #4ade80`, `color-warning #fbbf24`, `color-danger #fca5a5`, `border-strong #64748b`) were deliberately tuned for ≥4.5:1 ratios. The one-off failures (border-default on bg-elevated 1.37) are decorative only.
- **Mobile bottom-nav** (`#mobile-bottom-nav`, 32335) uses `<nav aria-label="Navegación principal mobile">` + `<button aria-label="...">` with proper SVG `aria-hidden="true"` — this is the correct ARIA pattern, replicable to other navigation.
- **Safe-area insets** are respected (`env(safe-area-inset-bottom)` at 1916, 1928, 1947) — notch / home indicator do not collide with the bottom nav.
- **`prefers-reduced-motion`** is referenced in 26 places including a global default on body transitions (235). The apple-design `#campaigns-modal` sets a dedicated reduced-motion variant (`appleModalSlideInReduced`, 20) — good discipline where present.
- **CSP + SRI** (not strictly a11y but ships with the keyboard-affecting Firebase CDN) is comprehensive — unrelated but worth noting that security + a11y co-exist cleanly.
- **Form autocomplete attributes** on login (`autocomplete="username" / current-password`, 3447/3449) and other auth flows (3372 one-time-code, 3726 email) help assistive tech and password managers equally.
- **Semantic HTML** usage: 377 `<button>` vs 102 `<div onclick>` — the ratio is actually 79% in favor of buttons, meaning the baseline convention IS to use buttons; the `<div onclick>` sites are the exceptions, not the norm.
- **Mobile hamburger** correctly has `aria-label="Menu"` (3489).
- **Login/Email/Password modals** have proper `<label for=X>` wiring (3446-3449, 3725, 3755, 3757).

## Suggested next steps

Priority sequence for an a11y sprint (2-week scope):

1. **Day 1 — No-brainer wins (one commit):**
   - Fix viewport `user-scalable=no` (A1).
   - Add global `:focus-visible` rule for light theme (A6) + darker focus-ring token for ≥3:1 contrast.
   - Add the global `prefers-reduced-motion` cascade override (A11).
   - Sweep 69 `×` close buttons for `aria-label="Cerrar"` (A7).
   - Change 6 `type="text"` search inputs to `type="search"` (A9).

2. **Days 2-4 — Modal infrastructure (biggest leverage):**
   - Introduce `_openModal(id)` / `_closeModal(id)` helpers with: focus restoration (A19), focus trap, Escape handler (A5), `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on all 77 modal-overlays (A2).
   - Migrate `openXModal()` / `closeXModal()` for the top 10 most-used modals first (Backorder, Stock Asignado, Visita, Alta Cliente, Export, Panel Control, Admin, SAP, Master Clientes, Dashboard).

3. **Days 5-7 — ARIA + semantics sweep:**
   - Add `role="status"` live region for toasts + wire `_showErrorToast` / `showZonasToast` (A3).
   - Convert 20-30 of the 102 `<div onclick>` to `<button type="button">` or `role="button" tabindex="0"` with keyboard listener (A4) — focus on export options, product picker, client picker.
   - Fix `<img onclick>` on logo (A10).

4. **Days 8-10 — Forms:**
   - Link all `<label>` to inputs in Visita + Alta Cliente + header filter selects (A8 + A13).
   - Add `aria-required="true"` to visible required inputs; add `aria-invalid`/`aria-describedby` on validation errors.
   - Replace all `outline:none` without a `:focus-visible` replacement.

5. **Days 11-14 — Touch targets + tabs + polish:**
   - Enforce 44x44 minimum on `.app-btn-pill`, `.logout-btn`, `.modal-close`, `.header-hamburger` (A12).
   - Convert `.visita-tabs` + 1-2 other key tab UIs to WAI-ARIA tabs pattern (A14).
   - Add glyph/text to color-only badges (A20).
   - Set `lang="es-AR"` (A15); add dynamic alt on photos (A18).
   - Update `scripts/dark_mode_contrast_audit.py` to also audit light theme fixes + add `aria-label` lint test (`tests/unit/aria-label-coverage.test.js`).

**Suggested verification gates:**
- Add `jest-axe` or `@axe-core/puppeteer` smoke test for key screens (login, home map, Visita, Backorder modal, Alta Cliente). Target: 0 serious violations.
- Manual keyboard-only test: can an admin complete "create user → assign role → open Visita → fill form → submit" without touching the mouse?
- Manual NVDA / TalkBack test: open Backorder modal, pick a client, submit. Record if all state changes are heard.
