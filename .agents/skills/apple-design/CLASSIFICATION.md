# apple-design skill — Vanilla feasibility classification

**Contexto**: PWA vanilla JS (sin React), bundle esbuild, ~500 users móvil.
Clasificación de cada sección de SKILL.md según qué se puede aplicar sin
lib de springs y qué requiere una.

## Score global

- **85% vanilla 100%** (secciones 1, 2, 7-17)
- **~10% aproximable vanilla con esfuerzo** (3, 4 parcial, 6 parcial)
- **~5% costo real sin lib** (3 velocity blend + 5 velocity handoff)

## Sección por sección

| # | Sección | Vanilla | Lib | Notas |
|---|---|:-:|:-:|---|
| 1 | Response — kill latency | ✅ | — | CSS `:active` + `pointerdown` |
| 2 | Direct manipulation | ✅ | — | Pointer Events + `setPointerCapture` |
| 3 | Interruptibility | ⚠️ | ✅ | Live transform read: OK con Web Animations. Velocity blend: costoso sin lib |
| 4 | Springs (damping/response) | ⚠️ | ✅ | `cubic-bezier` aproxima; spring real con params requiere lib |
| 5 | **Velocity handoff** | ❌ | ✅ | Seam drag→post-drag: donde vanilla se nota mal |
| 6 | Momentum projection | ✅ | ⚠️ | Fórmula JS puro; spring final con velocity requiere lib |
| 7 | Spatial consistency | ✅ | — | `transform-origin` + cubic-bezier inverso |
| 8 | Hint direction | ✅ | — | Concepto |
| 9 | Rubber-banding | ✅ | — | Fórmula JS ~10 líneas |
| 10 | Gesture details (tap/hysteresis) | ✅ | — | JS + CSS puros |
| 11 | Frame smoothness (rAF/will-change) | ✅ | — | Nativo |
| 12 | Materials & depth (backdrop-filter) | ✅ | — | CSS puro, gran win visual |
| 13 | Multimodal (Vibration + sync) | ✅ | — | `navigator.vibrate()` nativa |
| 14 | Reduced motion / a11y | ✅ | — | Media queries CSS |
| 15 | Typography (optical/tracking/leading) | ✅ | — | CSS `clamp()`, `font-optical-sizing` |
| 16 | Design foundations | ✅ | — | Conceptual |
| 17 | Process | ✅ | — | Metodología |

## Núcleo que sí requiere lib (§3+§5)

Solo aparece cuando hay:
- **Drag interruptible con reversal mid-flight** (arrastrar un sheet
  hacia abajo, soltar en medio, volver a agarrar y llevarlo arriba)
- **Post-gesture animation que hereda velocidad exacta del dedo**
  (soltar sheet a X px/s → animación continúa a X px/s sin brick wall)

Sin lib: se puede hacer, pero es reinvención + 100 líneas custom por
interacción. Con lib (`motion`): 5 líneas por interacción.

## Interacciones actuales en la app que caen en cada categoría

**Requieren §3/§5 (con lib se ven "Apple", sin lib se ven "web"):**
- Modales tipo sheet: `#pedido-modal`, `#backorder-modal`,
  `#dashboard-modal`, `#mis-camps-modal` — actualmente open/close
  con `classList.add('open')` + `transition: opacity`. No hay drag.
  Con drag-to-dismiss + velocity handoff = feel nativo.

**Se resuelven 100% vanilla (win rápido):**
- §12 `backdrop-filter` para headers/toolbars: cero código nuevo, solo
  CSS. Actualmente todos los modales usan fondos opacos.
- §14 `prefers-reduced-motion`: no está seteado. Fix media query.
- §15 Typography: `letter-spacing` fijo en varios lugares — auditar.
- §11 `will-change` presente parcial — auditar dónde falta.
- §1 Response on `pointerdown` no `click` — auditar botones críticos.

## Decisión pendiente (Fase 3)

Evaluar `motion` npm gzipped size vs valor incremental.
Referencia: sin lib, alcanzamos ~90-95% del feel Apple.
Con lib, alcanzamos 100% pero pagamos KB.
