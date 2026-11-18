# E4.2 reparto-dep12 — Planner tránsito (v1563)

**Fecha**: 2026-11-18

## Antes

`renderPlannerCard` (`index.html:36885+`) mostraba el total ARS del pedido con `_plannerComputeTotal`/`_plannerComputeInvoicedTotal`/`_plannerComputePaidTotal` según columna, más badges `SAP:X`, `SO:Y`, `ORDEN N`, `🔒` cerrado. Ninguna señal visual indicaba cuántas unidades del pedido estaban en tránsito (`line.enTransito === true` + `state='confirmed'`).

## Problema

Con feature flag `dep12_reparto_enabled` ON (previsto por Mariano), las líneas confirmed con `enTransito=true` reservan stock de dep 12 pero no están disponibles físicamente hasta cruzar a dep 11 (~7 días). El Planner tenía que mostrar al vendedor y a Pablo qué pedidos tienen todo/parte del volumen en tránsito para priorizar reparto cuando llega mercadería.

Sin esto: un pedido con 10u confirmadas (3 físicas + 7 tránsito) se ve como un pedido normal de 10u — el vendedor pone expectativa de entrega inmediata y después el cliente queda esperando.

## Cambio

1. **CSS en `styles/apple-design.css`** (bloque v1563 §E4.2, CRLF preservado):
   - `.planner-transito-line`: línea secundaria azul `#1e40af` con airplane inline. Versión dark con `#93c5fd` por legibilidad.
   - `.planner-badge-transito-full`: badge pill azul `#1e40af` texto blanco "100% TRÁNSITO".
   - Regla hover-safe `0,3,3` con `!important` sobre `.planner-card:hover|:focus-within .planner-badge-transito-full` para pisar cualquier cascada que fuerce color blanco en hover.

2. **JS en `index.html:renderPlannerCard`**:
   - Loop sobre `pedido.lines` (state='confirmed' + qtyOpen>0): acumula `_qtyTransitoOpen` vs `_qtyFisicoOpen`.
   - Si `_qtyTransitoOpen > 0 && _qtyFisicoOpen === 0`: push al array `badges` con `cls='planner-badge-transito-full'` + title descriptivo.
   - Si mix (`_qtyTransitoOpen > 0 && _qtyFisicoOpen > 0`): arma `_transitoLineHtml` como span adicional y se concatena al HTML return después del `.planner-card-total`.

3. **Flag OFF defensivo**: hoy ninguna línea tiene `enTransito=true` en prod (feature flag OFF por default). El bloque corre pero no produce output visible. Cuando Mariano prenda el flag, las líneas con `enTransito=true` empiezan a aparecer automáticamente.

4. **Tests** (`tests/unit/audit/planner-card-transito.test.js`, 7 tests): CSS presente + hover-safe + grep del render + contraste WCAG + 3 fixtures (mixto / 100% tránsito / sin tránsito).

## Por qué

- Visibilidad del vendedor: distingue de un vistazo qué pedidos tienen entrega inmediata vs ~7 días.
- Visibilidad de Pablo: filtra prioridades en Reparto cuando llega mercadería (los 100% tránsito saltan a ASIG automáticamente via §40.11 + E3 `scanDep12ToDep11Transitions`, pero los parciales le importan para armar tandas).
- §68: los textos son explícitos ("En tránsito", "cruzando Uruguay", "llegan en ~7 días"), sin jerga técnica ("dep 11", "dep 12", "enTransito").
- §106: el badge sigue el estilo pill Apple (sin mayúsculas forzadas en el CSS, border-radius 999px, sin box-shadow).
- §39: todas las lecturas pasan por `pedido.lines` directo, no se duplica lógica de `getStockBreakdown`.

## Verificación

- Suite: `npm run test:unit` → PASS (+7 tests nuevos).
- Build: `node build.js` → bundle rebuild (no toca domains, solo CSS + inline HTML, pero revalida rebuild por disciplina).
- Prod post-deploy con flag OFF: ningún cambio visible (defensivo).
- Prod post-deploy con flag ON + líneas enTransito: card del Planner muestra badge/línea.

## Rollback

Revertir el bloque CSS (`styles/apple-design.css` entre `/* v1563 ... :begin */` y `/* v1563 ... :end */`) + los 2 edits en `index.html:renderPlannerCard` (bloque qtyTransitoOpen + inserción `_transitoLineHtml` en el return) + el test. Bundle rebuild.

## Diferidos a próximas sub-etapas

- **E4.3**: Export Pablo con columna "En tránsito" en el xlsx del reparto.
- **E4.4/forecast**: integración tránsito en forecast — proyecto externo `Desktop\FORECAST\`, no aplica a la app web.
