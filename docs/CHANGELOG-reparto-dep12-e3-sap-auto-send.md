# E3 reparto-dep12: SAP auto-send skip enTransito + safety-net

**Fecha**: 2026-11-18
**Branch**: `feat-reparto-dep12-e3-sap-auto-send`
**Base**: main @ `010c0f87` (E0+E1+E2 ya mergeados; E2 deployado con feature flag OFF).

## Antes

- `buildQuotationPayload` (`functions/core/auto-send-sap-core.js`) sólo filtraba por `state==='confirmed' + qty>0`. No conocía `enTransito`.
- No existía red de seguridad periódica para tránsito (el único trigger era `onDep11IncreaseCreateReparto` por evento Firestore del snapshot).

## Problema

Con el feature flag `dep12_reparto_enabled` ON (activación consciente post-E2), las líneas de pedidos con `enTransito=true` llegarían a SAP antes de que el stock físico esté en dep 11. Hay que:
1. Saltear esas líneas del payload SL.
2. Esperar a que `scanDep12ToDep11Transitions` (E2, ya wireada) las migre a dep 11 (`enTransito=false`), lo cual re-triggerea `onPedidoConfirmedSendToSap` y las envía.
3. Tener un scheduled cada 60 min por si el trigger pierde un event.

## Cambio

1. **`buildQuotationPayload` acepta `deps.dep12Enabled`**. Si `true`, filtra `confirmedLines` sacando las que tengan `enTransito===true`:
   - Mix físico+tránsito → envía sólo las físicas + loguea `sap_autosend_partial_transito`.
   - Todas tránsito → devuelve `{ok:false, reason:'all_transito', transitoSkipped:N}` + loguea `sap_autosend_skipped_all_transito`.
   - Comportamiento con flag OFF o `dep12Enabled` undefined: idéntico al pre-E3 (defensivo).
2. **`handleAutoSendSap` wrapper (en `functions/index.js`)** resuelve el flag server-side via `loadFeatureFlagsDoc` + `isDep12RepartoEnabled`, fail-open a `false` si el doc no existe. Pasa `dep12Enabled` al core.
3. **Rama `all_transito`** devuelve `AUTO_SEND_RESULT.SKIP_NO_LINES` con `reason='all_transito'` para el log estructurado del trigger.
4. **`scheduledTransitoSafetyNet` CF nueva** (`every 60 minutes`, `America/Argentina/Buenos_Aires`): lee `app_config/stock_snapshot`, invoca `scanCancelledTransito(null, after)` + `scanDep12ToDep11Transitions(after)` detrás del flag. OFF → no-op. Escribe entry en `operations_log` con `type='transito_safety_net_run'`.

## Por qué

- Con stock de tránsito saltado del payload, el pedido no muere: `enTransito=false` al migrar + nuevo tick del trigger lo retoma (patrón E2 ya probado).
- Fail-open en el flag doc: si Firestore está caído momentáneamente, mantenemos el flow histórico (nunca "all_transito" por error de red).
- Idempotencia: los scanners del safety-net son los MISMOS de E2 + ambos chequean estado dentro del tx (§58 + §104 derivada 2). Doble corrida no duplica efectos.
- §2 del plan ("re-trigger cuando tránsito cruza a físico") **ya quedó cubierta en E2** por `scanDep12ToDep11Transitions` (corre dentro del mismo trigger `onDep11IncreaseCreateReparto`). No requiere CF nueva en E3.

## Rescope vs scope original (§5 del protocolo)

- **Eliminado**: `onTransitoBecomesPhysical` como CF nueva. Ya existe como `scanDep12ToDep11Transitions` en `functions/core/reparto-transito-core.js`, wireada en `onDep11IncreaseCreateReparto`. Agregar otro scanner duplicaría la lógica.
- **Reducido**: tests. 6 unit tests sobre `buildQuotationPayload` cubren los caminos críticos (flag ON/OFF, mix, all_transito, BO, defensivo sin flag). Safety-net tiene cobertura implícita vía los tests existentes de los 2 scanners (`reparto-transito-core.test.js`, `reparto-transito-core-extra.test.js`, 12 PASS).
- **Property-based del plan**: no se agregó (alcance acotado). Los invariantes relevantes ya están en `tests/functions/property/reconcile-dep12-fastcheck.test.js` (E2).

## Verificación

- `npx vitest run tests/functions/auto-send-sap-skip-transito.test.js` → 6/6 PASS.
- Suite completa (unit + functions + property + audit): **4227/4227 PASS**.
- `npx biome check functions/core/auto-send-sap-core.js functions/index.js tests/functions/auto-send-sap-skip-transito.test.js --write` → clean.
- `npm run typecheck` → clean.

## Rollback

1. Revertir `buildQuotationPayload` al filtro histórico (`confirmedLines` directamente).
2. Eliminar el bloque del wrapper que lee el flag + pasa `dep12Enabled`.
3. `functions/index.js`: remover el export `scheduledTransitoSafetyNet`.
4. Deploy `firebase deploy --only functions:onPedidoConfirmedSendToSap,functions:scheduledTransitoSafetyNet` (la primera revierte al filtro histórico, la segunda queda huérfana → delete manual via `gcloud scheduler jobs delete`).

El flag `dep12_reparto_enabled` sigue OFF por default; sin activarlo no hay riesgo de regresión funcional en prod aunque E3 se mergee.
