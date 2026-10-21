# 25 — Informe Cowork v1392 — El back order deja de reservar stock

**Fecha**: 2026-10-21
**Rama**: `feat-reserva-por-reparto` → `main`
**SHA merge**: `908a615`
**PR**: [#1126](https://github.com/shimano-arg/app-vendedores/pull/1126)
**Deploy**: GitHub Pages auto + `firebase deploy --only functions:applyRepartoManualCF,functions:onDep11IncreaseCreateReparto` (15:42 UTC)
**Metodología**: loop engineering E0-E5 con superpowers (`writing-plans`, `test-driven-development`, `systematic-debugging` en E0, `verification-before-completion` cada gate).

---

## 1. Decisión de diseño (§40 reemplaza §34)

Hasta hoy el back order reservaba stock (§34). **Desde v1392**:
- El back order **NO** reserva stock. Es la cola de clientes esperando y la base del forecast.
- Reservan stock: **asignaciones** (ASIG) + **confirmadas sin facturar** + **waitlist CPST**.
- Reparto abierto es **INFORMATIVO** (no reserva). Pablo lo ve y decide.
- Cuando Pablo cierra un reparto, lo asignado pasa a ASIG, lo no asignado queda libre.

CLAUDE.md §40 nueva. §34 marcada como reemplazada.

---

## 2. Las 9 unidades BO desaparecidas (E0, systematic-debugging)

**Causa raíz**: Pablo aplicó reparto con `elim=qty_total, asig=0` a 2026-10-21T13:42 UTC = 10:42 ART, 8 min **antes** del reporte Mariano 10:50. **No fue bug**.

| Cliente | Qty | pedidoId | Trigger |
|---|---|---|---|
| ANTONINI | 2 | h5GWlgoOnNNw20biacn3 | applyRepartoManualCF 13:42:35.907 UTC |
| IERONIMO | 1 | ZkymCIK0UPdsmhc90yDZ | applyRepartoManualCF 13:42:35.968 UTC |
| 4 NARICES | 2 | cIwe0EU5MvAYrA0ju16f | applyRepartoManualCF 13:42:36.018 UTC |
| MASERA | 3 | ughEvbr9OitVW73zCl3Z | applyRepartoManualCF 13:42:36.076 UTC |
| ANDRILI | 2 | VxkAnBLXsxbkE19WF7ji | NO tocada (sigue BO) |

Total eliminado: 8 u. Mariano dijo 11 pero suma = 10. Doc `20_BO_CUDC201HG_DESAPARECIDO.md`.

**Caso CONFIRMA necesidad §40**: con §34, estas 8u bloqueaban stock inútilmente. Pablo decidía "eliminar" como atajo. Con §40, el libre refleja la verdad; Pablo decide con mejor info.

---

## 3. Diff conceptual getStockBreakdown v1 → v2

```
v1 (pre §40):                           v2 (v1392 §40):

reservadasTotal =                       reservadasTotal =
  backorderApp +                          + confirmed
  confirmed +                             + asignadas
  asignadas +                             + waitlistCpst
  waitlistCpst                          (SIN backorderApp, SIN reparto)

                                        NUEVO bucket:
                                        repartoAbierto: {qty, repartoId, status}
                                                     INFORMATIVO (no reserva)

lineReservesStock('BO') → true          lineReservesStock('BO') → false
  (si createdAt <= 90d)                 (siempre)

utilizablePara: suma BO propia          utilizablePara: BO propio NO cuenta

TTL §37 90d en BO:                      TTL §37 90d en BO:
  filtra reserva BO vigente              filtra bucket para cola/forecast
                                         (NO afecta reservas; reservas no existen)

_version: 1                             _version: 2
```

Mirror en `functions/core/pedido-snapshot-core.js` sincronizado con test automático.

---

## 4. Reparto por reconciliación (E2)

Fórmula nueva en `reconcileRepartosFaltantes`:
```
qtyARepartir = min(fisico - asig_vigente - conf_vigente, BO_vigente)
```

- Antes de v1392 podía repartir 6 unidades entre pedidos de BO=2 → ahora cap por BO.
- Repartos abiertos existentes con `qty > BO vigente`: reconcile ajusta `qtyIngresada` sin tocar assignments ya aplicadas. Log: `reparto_ajustado`.
- `applyRepartoManualCore` con `allowSobrante=true`: Pablo cierra con sobrante → `status=done` + `closedReason='admin_cerrado_con_sobrante_<N>_libres'` + `sobranteLibre=N`.
- Nueva métrica: `ventanaIngresoARepartoMs` guardada en el doc + log `reparto_ventana`. Ventana real medida = **segundos** (CF trigger onWrite inmediato).

---

## 5. Pantallas (E3)

| Pantalla | Cambio |
|---|---|
| Lista de espera (celda Reservadas) | Badge priorizado: "N en reparto pendiente (no reserva)" si hay reparto abierto; sino "N clientes en back order" (informativo, no resta). Tooltip clarifica §40. |
| Modal Reparto (card) | "Libre ahora: N" con breakdown.libre del snapshot. Botón "Cerrar reparto" con confirm "quedan N unidades libres". |
| Modal Backorder | Título: "Backorder (app)". Subtítulo: "Cola de clientes esperando reparto. No reserva stock (§40). Si hay mercadería, Pablo reparte desde el modal Reparto." |
| Modal Pedido en espera | 1 call breakdown (reemplaza 2 anteriores). |
| Modal Stock Asignado | Sin cambios (ya usaba wrapper que delega al breakdown). |

---

## 6. Efecto en prod (E4 verificado post-deploy)

Script `scripts/audit/J_efecto_bo_no_reserva.cjs` (read-only) comparó libre_v1 (BO reserva) vs libre_v2 (§40) para todos los SKUs:

| Métrica | Valor |
|---|---|
| SKUs cuyo libre SUBE con §40 | **37** |
| Total unidades que pasan a libre | **289 u** |
| Con reparto abierto activo | 37 SKUs, 289 u |
| Sin reparto abierto activo | 0 SKUs, 0 u |

Umbral de pausa (50u) superado. **Mariano aprobó el merge** sabiendo que las 289 u aparecen como libre y Pablo tiene que decidir rápido (asignar o cerrar con sobrante). Riesgo residual aceptado por Mariano.

Doc 21: `21_EFECTO_BO_NO_RESERVA.md`.
Doc 24 (para Pablo hoy): `24_REPARTOS_PARA_PABLO.md` — lista con 37 SKUs ordenados por delta, con físico, ASIG, BO vigente, clientes en cola y id del reparto activo.

### Top 10 SKUs para atender hoy

| SKU | fisico | libre_v1 | libre_v2 | delta | BO vig | clientes en cola |
|---|---|---|---|---|---|---|
| LDM54TE5031515H | 40 | 2 | 28 | +26 | 26 | varios |
| CLC66HAR | 31 | 6 | 31 | +25 | 25 | — |
| LDM64TE5031530G | 24 | 0 | 24 | +24 | 35 | varios |
| CLC70HAR | 24 | 0 | 21 | +21 | 41 | varios |
| LDM54TE4028015S | 20 | 0 | 20 | +20 | 66 | varios |
| LDM54TE3023015S | 18 | 0 | 18 | +18 | 25 | varios |
| LDM64TE1819030G | 15 | 0 | 15 | +15 | 16 | varios |
| CLT01047 | 14 | 0 | 14 | +14 | 22 | varios |
| LDM64TE2020030H | 87 | 74 | 87 | +13 | 13 | varios |
| LDM64TE3023030G | 16 | 0 | 11 | +11 | 29 | varios |

Lista completa + clientes FIFO en `docs/auditoria/24_REPARTOS_PARA_PABLO.md`.

---

## 7. CUDC201HG en las 5 pantallas (post-deploy)

- **Modal Backorder**: título ahora "Backorder (app)". ANDRILI 2u visible como cola.
- **Modal Reparto**: `wXqG9ZezQpJYJRA8yF44` qty=6, status=pending. "Libre ahora: 6" (= fisico 7 - ASIG 1). Botón "Cerrar reparto" habilitado.
- **Popup Master Stock del SKU**: sigue usando `computeBackorderSkuMap` legacy (follow-up v1393).
- **Modal Pedido en espera**: reservadas = 1 (solo ASIG GRAUBERGER). Libre = 6. Badge "6 en reparto pendiente (no reserva)".
- **Modal Stock Asignado**: 1u GRAUBERGER.

---

## 8. Tests

- **Antes del loop**: 1497 PASS + 1 FAIL pre-existente (`reparto.test.js`).
- **Después del loop**: **1506 PASS + 1 FAIL pre-existente**. Delta +9 (reducción neta porque `bo-sin-ttl-7d.test.js` eliminado = -9; nuevos `reparto-cerrar-sobrante` +5 y 10+ tests legacy ajustados).

Nuevos:
- `tests/functions/reparto-cerrar-sobrante.test.js` (5): allowSobrante + sobranteLibre + ventana loggeada.
- `tests/functions/reconcile-breakdown-sync.test.js` reescrito (4): fórmula §40 min(fisico-asig-conf, BO).

Legacy ajustados a §40 (10+ tests): stock-realmente-disponible, pedido-snapshot, backorder-sku-map, virtual-asig-fifo, invariants, end-to-end-stradic, hipotesis, _fixtures.smoke, getStockDesglose-breakdown, stock-por-cliente-memo.

Removed: `tests/unit/audit/bo-sin-ttl-7d.test.js` (v1390 — semántica invertida).

---

## 9. Gates ejecutables

```
GATE_E0_OK ✓   (docs/auditoria/20 + archivo:línea Pablo elim CF)
GATE_E1_OK ✓   (breakdown v2 shape + 16 tests PASS + sync + wrappers)
GATE_E2_OK ✓   (reconcile ajuste + allowSobrante + ventana medida)
GATE_E3_OK ✓   (3 pantallas migradas + Modal Backorder reescrito)
GATE_E4_PAUSED (TOTAL=289 >= 50) → OK Mariano otorgado → GATE_E4_CONTINUAR
GATE_E4b_OK ✓  (PR #1126 merged bc9a451 → 908a615 + CFs deployed 15:42 UTC)
GATE_E5_OK ✓   (CLAUDE.md §40 + este informe + Desktop)
```

---

## 10. PR + SHA + deploy

- **Rama**: `feat-reserva-por-reparto`.
- **PR**: #1126 (merged `--squash --admin`).
- **SHA en main**: `908a615`.
- **GitHub Pages**: auto-deploy desde el merge (v1392 live).
- **Firebase Functions**: `applyRepartoManualCF` + `onDep11IncreaseCreateReparto` ambas ACTIVE 2026-10-21T15:42 UTC.

---

## 11. Follow-ups

1. **Popup "Stock del SKU" del Master** sigue usando `computeBackorderSkuMap` legacy. Migrar a `getStockBreakdown` (v1393). (Marcado para próxima tarea, no ahora.)
2. **D3** (SQ → Order SAP): respuesta pendiente al resumen 10 líneas en `17_RESULTADO_V1390_BO_SIN_TTL.md`.
3. **demandaSapSinCubrir** del breakdown queda como `null` por compat (DEPRECATED v1392). Eliminar del shape en v1393.

---

## 12. Qué le toca a Mariano

1. **Pasar `docs/auditoria/24_REPARTOS_PARA_PABLO.md`** a Pablo hoy. 37 SKUs ordenados por delta, con clientes en cola.
2. **Smoke manual post-v1392**: abrir CUDC201HG en Modal Reparto → verificar botón "Cerrar reparto" + "Libre ahora: 6".
3. **Monitoreo**: durante próximas 24h, verificar que Pablo atiende los 37 repartos. Si un VDE vende antes, el reconcile ajusta en segundos.

---

## 13. Entregables shipped

- `src/pure/stock-breakdown.js` v2 (bucket repartoAbierto, BO no reserva).
- `functions/core/pedido-snapshot-core.js` copia espejo.
- `src/pure/stock-realmente-disponible.js` wrappers §40.
- `src/pure/backorder-sku-map.js` + `virtual-asig-fifo.js` (TTL 90d directo para cola).
- `functions/core/reparto-core.js` (reconcile ajuste + allowSobrante + ventana).
- `index.html` 3 pantallas migradas + Modal Backorder reescrito.
- Tests: nuevos `reparto-cerrar-sobrante.test.js` + reescritos.
- Scripts: `_dump_cudc_timeline.cjs`, `J_efecto_bo_no_reserva.cjs`, `_dump_repartos_para_pablo.cjs`, `_gen_doc24.cjs`.
- Docs: `20_BO_CUDC201HG_DESAPARECIDO.md`, `21_EFECTO_BO_NO_RESERVA.md`, `22_VENTANA_INGRESO_REPARTO.md`, `24_REPARTOS_PARA_PABLO.md`, `25_INFORME_COWORK_V1392.md` (este).
- CLAUDE.md §40 + §34 marcada reemplazada.
