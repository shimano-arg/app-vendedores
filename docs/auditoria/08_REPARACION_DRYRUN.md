# E4 — Reparación de víctimas bug H1 (dry-run)

**Script:** `scripts/audit/D_restaurar_victimas_h1.cjs`
**Modo:** `--dry-run` (default). Para aplicar: `--apply` (requiere OK humano explícito — NO autorizado en esta tarea).
**Fecha dry-run:** 2026-10-20 21:35 UTC-3.

## Víctimas en lista

1. `tcWxGCE1rdCZz2Iw56Ex` — SNAKE S.R.L. (C30719034914), 1u ALV6000FA, confirmado 2026-10-19 19:21 UTC.

Total pedidos procesados: **1**.

## Salida del dry-run

```
================================================================
QUERY D — Reparación víctimas bug H1
================================================================

Modo: --dry-run (NO escribe)
Victimas en lista: 1

Estrategia por victima:
  1. Chequear ASIG original (pedido A, lineIndex) sigue cancelled.
  2. Chequear stock dep 11 >= qty.
  3. Chequear que no haya ASIG nueva del mismo (sku, cardCode)
     con asigAt > pedidoB.createdAt (cliente ya recibio por otro).
  4. Si recuperable: restaurar ASIG + cerrar pedido B.
  5. Si no recuperable: marcar h1_victim para decisión manual.

---
VICTIMA 1/1: tcWxGCE1rdCZz2Iw56Ex / SNAKE S.R.L.
---
[CASE A] RECUPERABLE
  pedido A mSuIidbMd74ziEMIBPUC lineIndex 78
    BEFORE: {"state":"cancelled","qtyOpen":0,"qtyCancelled":1,"cancelledAt":"2026-10-19T19:21:07.038Z","cancelledIntoPedidoId":"tcWxGCE1rdCZz2Iw56Ex"}
    AFTER : {"state":"ASIG","qtyOpen":1,"qtyCancelled":0,"cancelledAt":null,"cancelledIntoPedidoId":null}
  pedido B tcWxGCE1rdCZz2Iw56Ex lineIndex 0
    BEFORE: {"state":"BO","qtyOpen":1,"qtyCancelled":0}
    AFTER : {"state":"cancelled","qtyOpen":0,"qtyCancelled":1}
    pedido B closedAt: now ISO, closedReason: h1_repair_2026-10-20

=====================================
RESUMEN
=====================================
Total pedidos procesados: 1
Caso A (RECUPERABLES): 1
Caso B (NO-RECUPERABLES): 0
Caso C (SKIP/INVESTIGAR): 0
```

## Documentos a mutar (si --apply)

### Documento 1 — `pedidos/mSuIidbMd74ziEMIBPUC`

`lines[78]` cambia:

| Campo | BEFORE | AFTER |
|-------|--------|-------|
| state | `cancelled` | `ASIG` |
| qtyOpen | 0 | 1 |
| qtyCancelled | 1 | 0 |
| cancelledAt | `2026-10-19T19:21:07.038Z` | `null` |
| cancelledFrom | `waitlist-confirm` | `null` |
| cancelledIntoPedidoId | `tcWxGCE1rdCZz2Iw56Ex` | `null` |
| asigReserva | (preservado) | `true` |
| asigAt | `2026-10-16T21:47:26.763Z` (preservado) | `2026-10-16T21:47:26.763Z` |

También: `updatedAt: serverTimestamp()`.

### Documento 2 — `pedidos/tcWxGCE1rdCZz2Iw56Ex`

`lines[0]` cambia:

| Campo | BEFORE | AFTER |
|-------|--------|-------|
| state | `BO` | `cancelled` |
| qtyOpen | 1 | 0 |
| qtyCancelled | 0 | 1 |

A nivel documento:
- `closedAt: <now ISO>`
- `closedReason: 'h1_repair_2026-10-20'`
- `updatedAt: serverTimestamp()`

## Verificaciones post-apply (plan)

Cuando Mariano autorice `--apply`:
1. Correr `node scripts/audit/_verify_victim_h1.cjs tcWxGCE1rdCZz2Iw56Ex` → debería mostrar `pedido B.closedAt != null` + `ASIG original state='ASIG' qtyOpen=1`.
2. Correr `node scripts/audit/C_pedidos_bo_con_stock_al_crear.cjs --prod` → debería devolver **0 pedidos víctima** (ninguno restante).
3. Pablo abre modal Stock Asignado para SNAKE S.R.L.: `ALV6000FA 1u` debería aparecer como ASIG viva.
4. Pablo intenta "Crear Pedido Desde Stock Asignado" + VDE confirma → con el fix H1 ya desplegado, el nuevo pedido va a SAP como confirmed (no BO).

## Side-effects post-apply

- **SNAKE S.R.L.** recupera 1u ALV6000FA en ASIG (como estaba antes del 19/10).
- Stock físico dep 11 ALV6000FA sigue en 5u (no cambia porque la ASIG ya lo descontaba lógicamente via `getStockRealmenteDisponible`).
- `backorderBySkuApp[ALV6000FA]` baja en 1 (el pedido B queda cerrado).
- `asigBySkuApp[ALV6000FA]` sube en 1 (ASIG restaurada).
- CF `onPedidoWriteRecalcSnapshot` recalcula el snapshot automáticamente en 2 writes.

## Riesgos

- **Race condition:** si entre dry-run y apply hay otro reparto que use el stock de ALV6000FA, el apply igual escribe los dos docs — pero el VDE con ASIG restaurada vería 0 utilizable para crear el pedido (porque `getStockRealmenteDisponible` incluye reservas del cliente actual). No es catastrófico. Si hay dudas, re-correr `_verify_victim_h1.cjs` antes de `--apply`.
- **Firestore write throughput:** 2 writes, instantáneo. Sin side effects en SAP.
- **Rollback:** si el apply resulta mal, podemos revertir con otro script que haga la mutación inversa (restaurar `state=BO qtyOpen=1` en pedido B + `state=cancelled` en pedido A). Pero NO deberíamos necesitar rollback — los datos post-apply son equivalentes al estado pre-bug.

## Gate E4 (dry-run)

```bash
node scripts/audit/D_restaurar_victimas_h1.cjs --dry-run > /tmp/d-dry.txt
# exit 0 esperado + "Total pedidos procesados: 1" + "Caso A: 1"
```

**Resultado: ✅ GATE_E4_OK.**
