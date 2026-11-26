# Recorte de reservas reducidas por el reconcile al confirmar (2026-11-26)

## Antes
`healAsigRefs` (v1565) curaba refs de asignación vencidas antes de los controles de
`commitPedidoCore`: líneas revertidas a BO, canceladas, partidas o en cero. Pero cuando
la línea seguía en `ASIG` con **menos** unidades que las que guardaba la orden en espera
(`qtyAsignada > qtyOpen`), devolvía `KEEP` a propósito (decisión conservadora) y el
CHECK F abortaba con `ASIG_REF_INVALID / QTY_INSUFFICIENT`. El comentario de cabecera
decía que hacía CLAMP; el código nunca lo hacía.

## Problema
`revertSobreAsignadas` (§40.11) reduce una ASIG a lo entregable y manda el resto a una
línea BO gemela. Toda orden en espera armada antes de eso queda trabada para siempre:
cada intento de confirmar rebota. 35 de los 62 rechazos `ASIG_REF_INVALID` de los últimos
7 días fueron este caso.

Precedente: PESCAR.INFO SHOP S.R.L. ORDEN 890 (26/11). Reparto del 20/11 de 3u de
NEX6000FE y 3u de NEX8000FE, orden armada el mismo día con reserva 3, reconcile del 24/11
dejó 1 ASIG + 2 BO de cada uno. QUESADA ORDEN 902 mismo caso.

## Cambio
- `src/pure/asig-ref-healing.js` + espejo `functions/core/asig-ref-healing.js` (§57):
  - Caso `ASIG && qtyOpen > 0` con ref que excede el saldo: si hay **prueba del
    reconcile** (otra línea del mismo pedido con `splitFromLineIndex === li`, mismo SKU y
    `asigRevertidaReason='asig_sin_stock_revertida_a_bo'`) → `CLAMP` al saldo
    (`reason='reducida_por_reconcile'`), o `DROP` si el saldo es 0
    (`reducida_por_reconcile_sin_saldo`).
  - Sin esa prueba → `KEEP` como antes (sobre-asignación inexplicada sigue abortando).
  - `budget` (Map `pedidoId#lineIndex → saldo`) reparte el `qtyOpen` entre varias refs a
    la misma línea, porque `dedupRefsByLineIndex` suma duplicados antes del CHECK F.
  - Nuevo helper `hasReconcileReduction`.
- Cada recorte queda en `operations_log` `type='asig_ref_healed'` (ya existía).

## Por qué
Las unidades recortadas ya están en la cola BO del pedido origen: recortar la ref no
libera ni duplica stock, solo alinea la orden con lo que el reconcile ya decidió. Exigir la
prueba del reconcile mantiene la intención original de no enmascarar bugs.

## Verificación
- Tests nuevos: 4 unit (`tests/unit/asig-ref-healing.test.js`) + 2 integración
  (`tests/functions/commit-pedido-asig-ref-healing.test.js` T6 pasa, T7 sin prueba sigue
  abortando). Sync §57 OK. 216/216 tests de `commit-pedido*` + healing.
- Las fallas de la suite completa (caller-role-gate, listeners v1490, d8, etc.) existen
  igual en `main` sin este cambio.
- Prod: datos de la ORDEN 890 corregidos a mano el 26/11 con snapshot
  `_backfill.fix_asigref_clamp_orden890_2026-11-26` (OK Mariano). Simulación del
  healing contra datos reales: 0 rechazos.

## Rollback
Revertir el PR y redeploy `functions:commitPedidoCF`. Vuelve el abort `QTY_INSUFFICIENT`.
Datos ORDEN 890: `previousValues` en `_backfill.fix_asigref_clamp_orden890_2026-11-26` del
doc `revision_waitlist` de la orden.

## Revisión adversarial (aplicado / pendiente)
- Aplicado: la prueba exige que la gemela siga en `state='BO'`. Si Pablo ya la repartió
  como ASIG, recortar dejaría 2u reservadas dos veces → no se recorta (test T8).
- Aplicado: `hasReconcileReduction` entra al test de sincronía §57.
- Pendiente (pre-existente desde v1565): `tx.set(pedidoRef)` se arma antes del healing,
  así que el pedido nuevo guarda `asigRefs` sin sanar (auditoría, no afecta stock).
- Pendiente (menor): REPOINT (caso B) no descuenta del `budget`.
