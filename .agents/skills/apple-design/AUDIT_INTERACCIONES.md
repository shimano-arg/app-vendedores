# Audit de interacciones gestuales existentes (Fase 5)

**Metodo**: grep en index.html + src/domains/*.js.
**Fecha**: 2026-08-26.

## Inventario actual

| Metrica | Cantidad | Estado apple-design |
|---|---:|---|
| Modales totales | 53 | Todos abren con `classList.add('open')` + CSS transition |
| Pointer/touch handlers reales | 0 | `touchstart` unico es feature-detect, no gesture |
| Reglas `:active` con feedback | 25 | §1 parcial - botones OK; cards y filas de listas SIN feedback |
| `backdrop-filter` en uso | 4 | §12 muy parcial - **ninguno en modales**, solo en 4 botones |
| `prefers-reduced-motion` | 0 | §14 **completamente ausente** - gap grande |
| Duraciones CSS transition | 100/120/150/200/250/300/400 ms | §4 - sin standard, cada componente uso su valor |
| Interrupt-friendly springs | 0 | §3, §5 - la app NO tiene ninguna interaccion gestual real |

## Insight clave

La app NO tiene drag/swipe/gesture reales. **Todo es tap → open/close.**
Por eso el nucleo de la skill que requiere `motion/mini` (§4 springs + §5 velocity handoff)
se activa solo cuando IMPLEMENTEMOS features gestuales nuevas (drag-to-dismiss modales,
swipe-to-delete, sheet drag).

Para lo que ya existe (los 53 modales tap→open/close), el mayor impacto viene de:
- §14 reduced motion (0 → cubierto = win grande accessibility, ~5 lineas CSS)
- §12 backdrop-filter en modales (4 → 53 modales cubiertos = win visual enorme)
- §1 feedback pointerdown en cards clickeables (25 :active → probable ~50 elementos)
- §4 estandarizar duraciones (7 valores dispersos → 3 tokens: fast 150ms, normal 250ms, slow 400ms)

## Tabla Before/After priorizada por impacto

**Impacto** = frecuencia de uso × users afectados × visibility del cambio.
**Effort** = ~horas de implementacion.
**Bundle Δ** = KB gzipped agregados (solo cuando se importe `motion/mini`).

| # | Interaccion / superficie | Ubicacion | Before (actual) | After (apple-design) | Impacto | Effort | Bundle Δ |
|---|---|---|---|---|:-:|:-:|:-:|
| 1 | **Reduced motion global** | index.html `<style>` | Nada - transitions fuerzan movimiento a users con vestibular disorders | `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } .modal-overlay { transition: opacity 200ms ease !important; } }` | **A11y critical** - toda la user base con setting activado | XS (10 lineas) | 0 |
| 2 | **Modales chrome translucido** | 53 x `.modal-overlay` + `.modal-head` | Fondos opacos blancos/degradados. Corta continuidad visual. | `background: rgba(255,255,255,0.75); backdrop-filter: blur(20px) saturate(180%)` en modal-overlay. Content scrolls detras visible. | **Alto - visible en cada apertura de modal** | S (2 reglas CSS globales) | 0 |
| 3 | **Standardizar duraciones** | 7 valores distintos entre 100-400ms | Cada component tiene su duration | 3 tokens CSS custom props: `--dur-fast: 150ms`, `--dur-normal: 250ms`, `--dur-slow: 400ms`. Sed replace. | **Medio - consistency perception** | M (grep + review) | 0 |
| 4 | **Feedback pointerdown en cards** | Cards de sidebar clientes, lista pedidos en espera, cards de campanas | `onclick` sin `:active` feedback (o solo hover en desktop) | `:active { transform: scale(0.98); transition: transform 100ms }` en `.card`, `.pedido-card`, `.mc-camp-card`, `.list-item-clickable` | **Alto - el user toca 50-100 cards por sesion** | S (5-10 selectors CSS) | 0 |
| 5 | **Modal open transition uniforme** | 53 x apertura modal | `.open` class trigger; algunos hacen fade, otros translate, otros scale. Inconsistente. | Standard: `transform: translateY(20px) scale(0.98); opacity: 0` → open `translateY(0) scale(1); opacity: 1` con `--dur-normal cubic-bezier(0.32, 0.72, 0, 1)` (curva Apple ease-out). Reduced-motion: solo opacity fade. | **Alto - primer feedback visual del user cada vez que abre algo** | M (revisar cada modal, unificar) | 0 |
| 6 | **Sheet drag-to-dismiss** (FEATURE NUEVA) | Modal Pedido en Espera, Backorder, Dashboard (los grandes) | Solo cierra con boton X o click backdrop | Drag el header abajo → si velocity > threshold O position > 50% pantalla → animate close con velocity handoff via `motion/mini`. Rubber-band si drag arriba (§9). | **Muy alto - feel nativo** | L (fase separada, ~500 lineas por modal) | +3.1 KB |
| 7 | **Typography optical sizing** | Headers modales, cards titulos | `letter-spacing: 0.4-.5px` fijo en todo | Tokens: display large `-0.02em`, normal `0`, small `+0.5px`. Usar `font-optical-sizing: auto` en el root si font-family soporta. | **Bajo - detalle craft** | S | 0 |
| 8 | **Vibration en actions criticos** | Confirmar pedido, cancelar SQ SAP, eliminar cliente | Sin vibracion | `navigator.vibrate(10)` en commit exitoso. `vibrate([50,50,50])` en error. Solo mobile. | **Bajo - nice to have** | XS | 0 |
| 9 | **`transform-origin` en modales anchored** | Todos usan center | Botones que abren tooltip/popover sin anclar visual | `transform-origin` en el punto donde el user toco (via `--origin-x`, `--origin-y` inline). Solo si aplica al design. | **Medio - popovers y menus especificamente** | M (por caso) | 0 |
| 10 | **Loader/spinner con `will-change`** | Sync tags, loading states | `spinner` clase usa `@keyframes` sin `will-change` | `will-change: transform` en `.spinner`, `.saving`, `.mc-save-btn.saving`. Removerlo al terminar la animacion (evitar layer permanente). | **Bajo - performance** | S | 0 |

## Priorizacion sugerida (secuencia)

### Sprint 1 (cero riesgo, cero bundle, ~2h)
- #1 reduced-motion (a11y compliance)
- #2 backdrop-filter en modales (win visual gigante)
- #4 feedback pointerdown en cards (feel responsivo)

### Sprint 2 (medium effort, cero bundle, ~4h)
- #3 duraciones standardizadas (base para todo lo que sigue)
- #5 modal open transition uniforme (usa #3)
- #7 typography optical

### Sprint 3 (feature nueva, requiere motion/mini, effort alto)
- #6 sheet drag-to-dismiss (empezar con 1 modal como piloto)

### Backlog
- #8 vibration
- #9 transform-origin popovers
- #10 will-change loaders

## Instrumentacion

Post-Sprint 1: verificar cero regresiones con:
```bash
grep -rn "// apple-design skill" src/ index.html  # tracked downgrades
grep -c "backdrop-filter" index.html               # deberia subir de 4 a 50+
grep -c "prefers-reduced-motion" index.html        # deberia subir de 0 a 1+
```

## Notas de riesgo

- **backdrop-filter en modales**: en Safari iOS 15+ hay bug con `saturate()` en algunos casos.
  Fallback: `background: rgba(255,255,255,0.95)` sin filter si `@supports not (backdrop-filter: blur())`.
- **Drag-to-dismiss (#6)**: hay que respetar scroll interno de modales largos (Backorder tiene lista de 500+ items). Detectar si el pointerdown esta sobre el header (draggable) vs body (scroll).
- **Reduced motion**: no aplicar `transition: none !important` a scroll containers - rompe scroll snap.

## Que NO auditar

- Interacciones NO gestuales: form validation, alerts, redirects, table sorts. Fuera de scope de la skill.
- El mapa Leaflet: tiene su propio gesture handling nativo, no reinventar.
