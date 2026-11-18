# CHANGELOG — Reparto dep 12 · E4.1 UI (badge + popup + toggle)

**Fecha**: 2026-11-18
**Rama**: `feat-reparto-dep12-e4-ui`
**Scope**: UI visible del feature reparto-dep12 — 3 piezas de 6. Resto de E4 (columna Planner / export Pablo / forecast) va en E4.2+.

## Antes

- Las CFs del feature (E0..E3) están live en prod detrás del flag `app_config/feature_flags.dep12_reparto_enabled` (OFF default).
- Sin UI que muestre si una ASIG está en tránsito, sin fórmula separada para el tránsito, sin forma rápida de prender/apagar el flag.

## Problema

1. **Badge invisible**: una unidad reservada en tránsito se ve igual que una en depósito — Pablo no puede distinguirlas en el modal Stock Asignado.
2. **Popup confuso**: con tránsito > 0, la cuenta "físico − asig − conf = libre" no explica qué pasa con las unidades cruzando Uruguay.
3. **Flag sólo editable por consola**: para probar el feature hay que escribir el doc Firestore a mano — riesgo + fricción.

## Cambio

### Pieza A — Badge TRÁNSITO en modal Stock Asignado

- CSS `.badge-transito` (`styles/apple-design.css`): fondo `#dbeafe`, color `#1e40af`, pill §106 + hover-safe §62 (specificity 0,3,3 + `!important`) para los 4 pseudo-states del modal.
- `index.html:_renderBackordersTab` (bloque v1562): para cada fila cliente × SKU, suma `pedidoIds[].qtyOpen` donde `enTransito===true` y renderea `<span class="badge-transito">✈️ N</span>` con tooltip §68 ("Unidades cruzando Uruguay — llegan en ~7 días..."). Con flag OFF nunca aparece en prod.

### Pieza B — Popup "Stock del SKU" 2 fórmulas

- `src/pure/popup-stock-sku-lineas.js`: nueva export `renderPopupStockSkuPlainTextMultiBlock(breakdown, {dep12FlagOn})`. Si flag ON + `transitoDep12 > 0` → 2 bloques (físico + tránsito) con fórmulas separadas que cierran. En cualquier otro caso delega a `renderPopupStockSkuPlainText` (§103, 1 bloque).
- `src/main.js`: exposición en `window.__phase0.pure`.
- `index.html:queryStockLive`: prioriza el helper multi-block; preserva fallback §103 inline si el bundle no cargó (SW stale).

### Pieza C — Toggle flag en Panel de Control

- `src/domains/panel-control.js`: nueva sección "Features experimentales" (gate `_isMarianoEmail()`).
- Botón `#dep12-flag-toggle` con hydrate async que lee `app_config/feature_flags.dep12_reparto_enabled` + cachea en `window._dep12FlagCached` (consumido por popup §E4.1 B).
- Click → `confirm` §68 (sin jerga) → `set({dep12_reparto_enabled, dep12FlagChangedAt, dep12FlagChangedBy}, {merge:true})`.
- Catch error → alert §68 + revert visual.
- CSS pill §106 con 3 estados: verde activado / gris apagado / azul-gris cargando.
- `firestore.rules`: match nuevo `/app_config/feature_flags` con `read: request.auth != null` + `write: isMariano()`. Catch-all `/app_config/{docId}` excluye `feature_flags` del `isAdmin()` default.

## Por qué

- Riesgo prod: **cero**. El flag sigue OFF en producción post-deploy y las 3 piezas son defensivas con flag OFF (badge no aparece, popup sigue en §103, toggle sólo visible para Mariano).
- Mariano pidió la UI mínima antes de prender el flag en producción. Estas 3 piezas son lo que necesita para operar el feature sin consola.
- §106 + §62 + §68 + §103 respetados.

## Verificación

- `npm run test:unit` → **3065 PASS / 0 FAIL** (15 tests nuevos).
  - `tests/unit/audit/badge-transito-stock-asignado.test.js` (4): CSS pill + hover-safe + grep render + WCAG >=4.5:1.
  - `tests/unit/audit/popup-stock-sku-2-formulas.test.js` (6): flag ON+tránsito 2 bloques, flag OFF/sin tránsito compat §103, ambas fórmulas cierran.
  - `tests/unit/audit/panel-control-dep12-toggle.test.js` (5): gate Mariano, set con audit, confirm §68 sin jerga, CSS pill §106, cache window._dep12FlagCached.
- `npx biome check` → clean (3 files).
- `npm run typecheck` → clean.
- `node build.js` → bundle rebuild OK.

## Rollback

- Revertir el commit del PR. El flag en Firestore queda OFF (default) y las piezas desaparecen sin cambios en datos. `firestore.rules` necesita redeploy manual del catch-all previo si se quiere revertir también la rule — en la práctica no hace falta, el match específico sólo restringe, no habilita nada nuevo.

## Diferido a E4.2/E4.3 (§5 rescope)

- **Columna tránsito en Planner Kanban**: `renderPlannerCard` vive inline en `index.html` con layout denso + rebuild del chunk Planner. PR separado.
- **Export Pablo con tránsito**: el helper tiene columnas hardcoded en 3 lugares + paridad con export Python. PR separado.
- **Forecast con tránsito**: no hay ventana "forecast" en la app web actual. El proyecto `Desktop\FORECAST\` (Python) es externo y vive aparte. Diferido como "no aplica a la app".
