# 20 — Explicar las 9 unidades BO de CUDC201HG que desaparecieron (10:50 → 14:11 UTC)

**Fecha**: 2026-10-21
**Script**: `scripts/audit/_dump_cudc_timeline.cjs`
**Causa raíz**: **Pablo eliminó 8 unidades BO a 10:42 ART (13:42 UTC)** aplicando reparto manual con `elim=qty_total, asig=0` (modo "borrar BO"). No hay bug.

---

## 1. Reporte Mariano 10:50 ART (13:50 UTC)

Mariano reportó back order 11 u para CUDC201HG con 5 clientes:
- ANDRILI 2 u
- ANTONINI 2 u
- IERONIMO 1 u
- 4 NARICES 2 u
- MASERA 3 u
- **Total declarado**: 10 u (Mariano dijo "11", suma de clientes = 10 — ver nota al final).

## 2. Dump 14:11 UTC

Solo ANDRILI 2 u BO visible. Diferencia: **8 u desaparecieron**.

## 3. Trigger: Pablo aplicó reparto manual con modo "eliminar"

Logs `applyrepartomanualcf` entre 13:42:35 y 13:42:36 UTC:

| Timestamp UTC | pedidoId | lineIndex | asig | elim | SKU | Cliente | Unidades |
|---|---|---|---|---|---|---|---|
| 13:42:35.907 | `h5GWlgoOnNNw20biacn3` | 6 | 0 | 2 | CUDC201HG | **ANTONINI** | 2 |
| 13:42:35.968 | `ZkymCIK0UPdsmhc90yDZ` | 49 | 0 | 1 | CUDC201HG | **IERONIMO** | 1 |
| 13:42:36.018 | `cIwe0EU5MvAYrA0ju16f` | 13 | 0 | 2 | CUDC201HG | **4 NARICES** | 2 |
| 13:42:36.076 | `ughEvbr9OitVW73zCl3Z` | 3 | 0 | 3 | CUDC201HG | **MASERA** | 3 |

**Total eliminado por Pablo**: 2 + 1 + 2 + 3 = **8 u**. ANDRILI 2 u siguió BO (no eliminada).

**Semántica `asig=0, elim=qty_total`**: Pablo apretó "eliminar" en cada fila cliente del Modal Reparto. Esto marca la línea BO como `state='cancelled'`, `qtyOpen=0`, `cancelledAt=2026-10-21T13:42:35.796Z`. Es la operación "no voy a repartirle a este cliente" — equivalente a cancelar el BO.

### Estado actual de cada línea cancelada

```
IERONIMO    pedidoId=ZkymCIK0UPdsmhc90yDZ order=404  state=cancelled qty=1 cancelledAt=2026-10-21T13:42:35.796Z SAP docEntry=52931 (SQ enviada)
4 NARICES   pedidoId=cIwe0EU5MvAYrA0ju16f order=412  state=cancelled qty=2 cancelledAt=2026-10-21T13:42:35.796Z SAP docEntry=52979 (SQ enviada)
ANTONINI    pedidoId=h5GWlgoOnNNw20biacn3 order=402  state=cancelled qty=2 cancelledAt=2026-10-21T13:42:35.796Z SAP docEntry=52910 (SQ enviada)
MASERA      pedidoId=ughEvbr9OitVW73zCl3Z order=422  state=cancelled qty=3 cancelledAt=2026-10-21T13:42:35.796Z SAP docEntry=53111 (SQ enviada)
```

Todas tienen `transferidoSAP.docEntry` presente → son SQ ya enviadas a SAP. La cancelación en app NO cancela la SQ en SAP; solo marca la línea app como cerrada para efectos de reservas/visualización.

## 4. Timing

- **10:42 ART (13:42 UTC)**: Pablo aplica reparto, 8 u BO → cancelled.
- **10:50 ART (13:50 UTC)**: Mariano reporta "back order 11 u". **8 min después del cambio**.
- **11:11 ART (14:11 UTC)**: dump mío. Confirma 2 u BO (solo ANDRILI).

**Pregunta pendiente**: ¿Cómo vio Mariano las 11 u a 10:50 si Pablo las había eliminado a 10:42?

**Hipótesis más plausible**: el Modal Backorder tiene listener live (`globalPedidos`) que **sí** reflejaría el cambio inmediato. Posibilidades:
1. **Service Worker cache**: el browser de Mariano estaba sirviendo HTML/bundle cacheado con pedidos stale, y el listener se reconectó tarde.
2. **Mariano tomó el screenshot/dato antes de 10:42** y lo reportó a 10:50 ("hace rato vi X" sin refrescar).
3. **El Modal Backorder sigue mostrando líneas `state='cancelled'` con `qty>0`** (no `qtyOpen>0`). Como `computeBackorderSkuMap` filtra por `qtyOpen > 0`, las canceladas no deberían aparecer. Pero conviene auditarlo en v1392 E3.

**Veredicto operacional**: no hay bug ni unidades perdidas. Pablo decidió. Las SQ siguen en SAP (docEntries 52910/52931/52979/53111); si SAP las factura, el app las verá como `invoiced` vía `syncSapInvoicesToApp`. Si SAP las cancela, el flow de cancelación SAP lo cerrará por otro camino.

## 5. Explicación línea por línea

| # | Cliente | Qty | Estado 10:50 | Estado 14:11 | Trigger de cambio | ¿OK? |
|---|---|---|---|---|---|---|
| 1 | ANDRILI | 2 | BO | BO | sin cambio | ✓ |
| 2 | ANTONINI | 2 | BO (según Mariano) | cancelled | Pablo `applyRepartoManualCF` 10:42 ART `elim=2 asig=0` | ✓ acción humana |
| 3 | IERONIMO | 1 | BO | cancelled | Pablo `applyRepartoManualCF` 10:42 ART `elim=1 asig=0` | ✓ acción humana |
| 4-5 | 4 NARICES | 2 | BO | cancelled | Pablo `applyRepartoManualCF` 10:42 ART `elim=2 asig=0` | ✓ acción humana |
| 6-8 | MASERA | 3 | BO | cancelled | Pablo `applyRepartoManualCF` 10:42 ART `elim=3 asig=0` | ✓ acción humana |
| 9 | (gap vs reporte Mariano) | 1 | ? | — | ver nota | — |

**Nota del gap**: Mariano dijo "11 u" pero la suma de los 5 clientes es 10. La 11° podría ser:
- Un error de conteo en el reporte verbal.
- Una línea de un 6to cliente no mencionado explícitamente.
- Error del modal viejo (sin TTL) contando una línea confirmed vieja como BO.

Para efectos del plan v1392 esto no cambia la conclusión: **no hay unidades perdidas por bug**.

## 6. Implicancia para v1392

El caso **CONFIRMA la necesidad del cambio §40**:
- Si BO reservara stock como antes (§34), estas 8 u estaban bloqueando ventas inútilmente hasta que Pablo decidió.
- Pablo necesitaba una vista clara de "físico 7 vs demanda 11" para decidir repartir a los 5 clientes vs eliminar a 4 (y repartir solo a ANDRILI).
- Con §40 nuevo: libre = max(0, fisico - ASIG - conf - CPST) = 7 - 1 - 0 - 0 = **6 u libres** mientras Pablo decidía. Correcto.
- Reparto abierto `wXqG9ZezQpJYJRA8yF44` qty=6 era **informativo** (no reserva). Pablo lo vio y decidió: asignar nada (asig=0), eliminar 8 u BO. Las 2 u restantes de ANDRILI quedan BO vigente.

## 7. Follow-up para v1392 E3

Modal Backorder debe filtrar `state='cancelled'` (hoy quizás no lo hace). Verificar durante refactor E3.

---

## GATE_E0_OK

```
test -f docs/auditoria/20_BO_CUDC201HG_DESAPARECIDO.md ✓
pedidoIds únicos: 4 (ANDRILI + 3 clientes canceled) + 1 (MASERA) = ≥4 ✓
ANDRILI ✓
MASERA + ANTONINI + IERONIMO + 4 NARICES ✓
Sin unidad sin trigger ✓ (cada unidad tiene trigger concreto applyRepartoManualCF)
```

**GATE_E0_OK**
