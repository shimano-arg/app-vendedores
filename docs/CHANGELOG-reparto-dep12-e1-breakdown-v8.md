# E1 Reparto dep 12 — breakdown v8 + lineReservesStock enTransito

**Fecha**: 2026-11-17  
**Branch**: `feat-reparto-dep12-e1-breakdown`  
**Plan**: `docs/superpowers/plans/2026-11-17-reparto-dep12.md` (etapa E1)

## Antes

- `getStockBreakdown` v7 exponía `transitoDep12` solo como campo
  informativo pero sin tracking de líneas ASIG/confirmed con origen
  tránsito dep 12.
- `lineReservesStock` no distinguía entre líneas físico vs tránsito —
  las ASIG reservaban contra dep 11 con TTL soft 7d sin importar que el
  stock todavía estuviera en tránsito.
- Las fórmulas de reserva siempre operaban contra `fisicoDep11`.

## Problema

Para habilitar reparto desde dep 12 (plan 2026-11-17) necesitamos:

1. Identificar y contar líneas `line.enTransito === true` separado del
   bucket físico.
2. No descontar las reservas tránsito del físico (evita doble conteo
   cuando el stock llegue a dep 11 y las líneas se reafecten).
3. Dar libreTransito paralelo contra dep 12.
4. TTLs distintos: una ASIG tránsito con asigAt 10d NO debe vencer
   (soft 7d está pensado para líneas físico); pero sí debe tener un
   hard cap (30d) para red de seguridad.
5. CPST debe saber el estado tránsito de las ASIG origen para audit al
   revertir / cancelar.

## Cambio

### Shape v8 de `getStockBreakdown` (`src/pure/stock-breakdown.js`)

```js
{
  sku, fisicoDep11, transitoDep12,
  libreTransito,                    // NUEVO v8 §E1
  backorderApp,
  confirmadasSinFacturar: {
    total,
    totalFisico,                    // NUEVO v8 §E1
    totalTransito,                  // NUEVO v8 §E1
    porCliente,
  },
  asignadas: {
    total,
    totalFisico,                    // NUEVO v8 §E1
    totalTransito,                  // NUEVO v8 §E1
    porCliente,
    detalle,                        // Solo físico (tránsito excluido)
  },
  waitlistCpst,
  repartoAbierto,
  reservadasTotal,                  // v8: EXCLUYE tránsito (solo físico).
  libre,                            // v8: cap contra reservadasTotal físico.
  utilizablePara,
  pendienteReparto,
  _version: 8,                      // Bumpeado 7→8.
}
```

Fórmulas:
- `reservasNominales = confirmadas.totalFisico + asignadas.totalFisico`.
- `reservadasTotal = min(reservasNominales, fisicoDep11)`.
- `libre = max(0, fisicoDep11 - reservadasTotal)`.
- `reservasTransito = confirmadas.totalTransito + asignadas.totalTransito`.
- `libreTransito = max(0, transitoDep12 - min(reservasTransito, transitoDep12))`.
- `utilizablePara(cardCode)` sigue usando `libre` (físico) — NO cuenta
  `libreTransito` como consumible (decisión E1; E3/E4 definen si los
  pedidos nuevos pueden consumir tránsito).

### `lineReservesStock` extendido (`src/pure/stock-realmente-disponible.js`)

Dos ramas nuevas cuando `line.enTransito === true`:

- `state='ASIG' + enTransito=true`:
  - Ignora TTL soft 7d desde `asigAt`.
  - Hard cap `ASIG_TRANSITO_HARD_CAP_DAYS = 30` desde
    `line.asigAtTransito || line.asigAt || pedido.createdAt`.
  - Fail-open: sin fecha de referencia → reserva.

- `state='confirmed' + enTransito=true`:
  - Ignora TTL soft 7d desde `confirmedAt`.
  - Hard cap `CONFIRMED_HARD_CAP_DAYS = 60` desde
    `line.confirmedAtTransito || pedido.confirmedAt || pedido.createdAt`.
  - Fail-open: sin fecha de referencia → reserva.

### Mirror `functions/core/pedido-snapshot-core.js`

Replica byte-equivalent de ambas fns (sync §57). Los tests
`stock-breakdown-sync.test.js` y `stock-breakdown-sync-strict.test.js`
validan paridad.

### CPST pure helpers

- `src/pure/cpst-revert-plan.js`: `RevertAction` incluye `wasEnTransito`
  flag en cada acción del plan (audit).
- `src/pure/cpst-cancel-asig-plan.js`: `AsigRef` incluye `enTransito?`;
  nuevo export `buildClosedReasonWithTransito(baseReason, ref)` que
  agrega `_transito` suffix si la ref era tránsito (sin cambiar
  comportamiento, solo audit).
- `src/pure/cpst-item-cancel-helpers.js`: `collectAsigRefsForItemCancel`
  preserva `enTransito=true` si alguna fuente lo marca.

### STOCK_LABELS

Agregado `libreTransito: 'Libre en tránsito'` a ambos (src + mirror
server).

## Por qué

- **Sub-totales físico/tránsito** mantienen `total` compatible con
  consumidores actuales (los que no saben de tránsito ven lo mismo), y
  habilitan a los que necesitan la discriminación.
- **TTL dinámico en tránsito**: una ASIG tránsito representa stock
  comprometido que NO está disponible todavía — aplicar el soft 7d
  (pensado para abandonos post-asignación física) la vencería antes de
  que el barco llegue. Hard cap 30d cubre el peor escenario (tránsito
  Uruguay→Argentina típico 7d, plus delays de aduana).
- **Fail-open en falta de fecha**: data corrupta (ASIG tránsito sin
  asigAtTransito ni asigAt ni createdAt) es imposible en prod; si llega,
  mejor reservar que liberar silenciosamente.
- **CPST audit**: el VDE debe poder trazar qué unidades revertidas o
  canceladas venían de tránsito vs físico. El suffix `_transito` en
  closedReason + `wasEnTransito` en el plan permiten query Firestore.

## Verificación

- `npm run test:unit`: **3023 PASS / 0 FAIL** (25 tests nuevos sobre
  v1546: 15 unit `breakdown-dep12-transito` + 3 property × 300 runs +
  7 aserciones en sync tests actualizados).
- `npm run typecheck`: clean.
- `npx biome check`: clean (post autofix).

## Rollback

1. `git revert <sha>` + PR revert + `gh pr merge --squash --admin`.
2. El shape v8 → v7 es puramente aditivo; rollback no pierde datos
   persistidos (los nuevos campos nunca se escriben a Firestore —
   computados en memoria por el breakdown).
3. Las líneas con `line.enTransito === true` quedarían bajo TTL soft 7d
   del flow histórico — eso venceran a los 7d en vez de 30d. No crea
   datos corruptos.
4. El PR E0 (constantes + pure fn `detectStockIncreases`) queda
   intacto; es independiente.

## Precedente

- Plan `docs/superpowers/plans/2026-11-17-reparto-dep12.md` §4 E1.
- Reglas CLAUDE.md §39 (fuente única breakdown), §57 (sync src/pure
  vs functions/core), §38 (confirmed hard cap 60d), §40 (BO no reserva).
