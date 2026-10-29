# Invariante ASIG qtyOpen>0 en reparto (2026-10-29)

**Antes**: `revertSobreAsignadas` (§40.11, corre en cada tick de `onDep11IncreaseCreateReparto`) con una ASIG de `qtyEntregable=0` hacía `qty=0, qtyOpen=0` dejando `state='ASIG'` y apendeaba una BO con la cantidad.

**Problema**: queda una ASIG zombie. El breakdown la ignora, pero los flujos que buscan la línea origen por producto la toman: el CPST de REBORN SRL CLC66H2PY (29/10 09:08) se bloqueó entero; repartos con `clientesBO` viejo que apuntan a ese índice rebotan con "linea con qtyOpen=0".

**Cambio**:
- `functions/core/asig-invariant.js`: `findZombieAsigLines(lines)`.
- `revertSobreAsignadas`: entregable 0 → la línea vuelve entera a BO en su lugar (mismo audit `asig_sin_stock_revertida_a_bo`, `asigRevertidaBy='system:reconcile'`), sin línea extra. Antes de escribir cada pedido, si el resultado tendría una zombie nueva, no se escribe y va a `errors[]`.
- `applyRepartoManualCore`: dentro de la transacción, antes de `tx.update`, rechaza si la línea tocada o las apendeadas quedarían ASIG con `qtyOpen<=0`. Zombies previas en otras líneas no bloquean.

**Por qué**: "ASIG = reserva real con unidades" (§40). Una ASIG sin unidades contradice la regla y rompe a quien la lee.

**Verificación**: `tests/functions/asig-invariante-qtyopen.test.js` (6). `tests/functions/` 795 pass / 11 fail, los 11 preexistentes en `commit-pedido-*` (idénticos en `main` sin este cambio). `tests/unit/` 2443/2443.

**Deploy**: `firebase deploy --only functions:onDep11IncreaseCreateReparto,functions:applyRepartoManualCF`.

**Rollback**: revertir el commit y redeployar las dos funciones. Las líneas BO revertidas en su lugar son estado válido; no hay que deshacerlas.

**Pendiente (no incluido)**: `revertSobreAsignadas` hace read-modify-write de `lines` fuera de transacción; un `applyRepartoManualCF` concurrente puede perder su asignación. Lo detecta `scripts/audit/AS_asig_huerfanas.cjs` (tipo R). Pasarlo a transacción por pedido es el siguiente paso.
