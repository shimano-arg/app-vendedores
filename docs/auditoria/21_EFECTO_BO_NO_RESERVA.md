# 21 — Efecto §40 (BO no reserva) en producción — PAUSA REQUERIDA

**Fecha**: 2026-10-21T15:27 UTC
**Script**: `scripts/audit/J_efecto_bo_no_reserva.cjs` (read-only prod)
**Veredicto**: **PAUSA** — total ≥ 50 unidades. Esperando OK Mariano antes de merge.

---

## Resumen

| Métrica | Valor |
|---|---|
| SKUs cuyo libre SUBE con §40 | **37** |
| Total unidades que pasan a libre | **289 u** |
| Con reparto abierto activo | 37 SKUs, 289 u |
| Sin reparto abierto activo | 0 SKUs, 0 u |

**Dato clave**: los 37 SKUs tienen **reparto activo**. Significa que todos ya están en atención de Pablo. Lo que §40 destraba es stock físico que BO reservaba mientras Pablo decidía — hoy ese stock aparece como "0 libre" pero realmente lo está. Con §40, el libre refleja la verdad: Pablo decide, y lo no asignado queda libre.

---

## Top 20 SKUs con mayor delta

| SKU | fisico | libre_v1 (BO reserva) | libre_v2 §40 | delta | BO vigente | reparto |
|---|---|---|---|---|---|---|
| LDM54TE5031515H | 40 | 2 | 28 | +26 | 26 | SI |
| CLC66HAR | 31 | 6 | 31 | +25 | 25 | SI |
| LDM64TE5031530G | 24 | 0 | 24 | +24 | 35 | SI |
| CLC70HAR | 24 | 0 | 21 | +21 | 41 | SI |
| LDM54TE4028015S | 20 | 0 | 20 | +20 | 66 | SI |
| LDM54TE3023015S | 18 | 0 | 18 | +18 | 25 | SI |
| LDM64TE1819030G | 15 | 0 | 15 | +15 | 16 | SI |
| CLT01047 | 14 | 0 | 14 | +14 | 22 | SI |
| LDM64TE2020030H | 87 | 74 | 87 | +13 | 13 | SI |
| LDM64TE3023030G | 16 | 0 | 11 | +11 | 29 | SI |
| LDM64TE4028030G | 15 | 0 | 10 | +10 | 48 | SI |
| 33400500300E | 8 | 1 | 8 | +7 | 7 | SI |
| CLS58HBR | 7 | 0 | 7 | +7 | 13 | SI |
| CLC66H2PY | 9 | 0 | 7 | +7 | 169 | SI |
| CLC70H2PY | 9 | 0 | 7 | +7 | 109 | SI |
| PLM58RE0200150S | 6 | 0 | 6 | +6 | 12 | SI |
| 21100400100E | 12 | 6 | 12 | +6 | 6 | SI |
| PLM58RE0150150S | 13 | 7 | 13 | +6 | 6 | SI |
| 21100500100E | 5 | 0 | 5 | +5 | 6 | SI |
| CLC66MH2PY | 7 | 0 | 5 | +5 | 116 | SI |

---

## Interpretación

**Lo que significa el cambio en prod** si se merge v1392:
- 289 unidades de stock físico que hoy aparecen bloqueadas por BO (reservando) pasan a `libre` para la venta.
- Como los 37 SKUs tienen reparto abierto, **Pablo tiene que decidir** qué hace: asignar a los clientes BO (via Modal Reparto) o cerrar con sobrante (botón nuevo "Cerrar reparto" liberará lo no asignado).
- Mientras Pablo no decide, cualquier VDE que cargue pedido ve el libre real. **Esto es el objetivo de §40**: libre refleja lo que Pablo no reservó para nadie.

**Riesgo**:
- Si un VDE carga pedido ANTES que Pablo cierre reparto, ese pedido se queda con el stock. Los clientes BO quedan en cola. Pablo lo verá en el próximo refresh del Modal Reparto (BO vigente baja, reconcile ajusta qty, Pablo decide con menos stock).
- Es consistente con el diseño §40: Pablo tiene que elegir rápido para proteger clientes BO prioritarios; si no, el stock se vende.

**Protección residual**: el modal Reparto Pablo ve siempre el libre actual del momento (post-E3). Si entre que abrió el modal y aplica, VDE vendió 5u, el libre bajó. El cap backend (`applyRepartoManualCore` v1312) rechaza si `sum(assignments) > stockFisicoDep11`.

---

## GATE_E4_PAUSED

```
test -f docs/auditoria/21_EFECTO_BO_NO_RESERVA.md ✓
grep 'Total unidades que pasan a libre: 289' ✓
TOTAL=289 >= 50 → PAUSA ✓
```

**GATE_E4_PAUSED — Esperando OK Mariano antes de merge a main.**

Si Mariano aprueba:
- Push rama + PR + merge --squash --admin.
- `firebase deploy --only functions:onDep11IncreaseCreateReparto` + applyRepartoManualCF (toca ambas).
- Verify prod post-deploy con CUDC201HG + 3 SKUs del top.

Si Mariano rechaza:
- Rollback plan: revertir E1+E2 del breakdown. Las pantallas (E3) pueden quedar sin §40 pero actualizarse en v1393 cuando se decida.
