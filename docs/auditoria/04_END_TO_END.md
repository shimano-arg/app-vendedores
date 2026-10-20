# E4 — Reproducción end-to-end 11 pasos (STRADIC-2500)

> **Test:** `tests/unit/audit/end-to-end-stradic.test.js` — 14 tests (11 PASS + 3 FAIL RED que son evidencia).

## Resumen por paso

| Paso | Estado esperado (prompt) | Estado observado (código) | Veredicto |
|------|---------------------------|---------------------------|-----------|
| 0  | 3 / 0 / 3 / 0 | 3 / 0 / 3 / 0 | ✅ CUMPLE |
| 1  | 3 / 0 / 3 / 0 (sin cambios) | idem | ✅ CUMPLE (manual waitlist no reserva) |
| 2  | Norte 2u → SAP, Sur BO, Oeste BO; disp=1 | split 2 confirmed ✅, SAP recibe 2 ✅ | ✅ CUMPLE |
| 3  | Sur envía 2, Disp 1 → split 1 SAP + 1 BO | flag ON: split 1+1 ✅; flag OFF: 100% BO ❌ | ✅ (flag ON) / **BUG H4** (flag OFF) |
| 4  | Oeste envía 1 con Disp 0 → 1 BO | 1 línea BO ✅ | ✅ CUMPLE |
| 5  | Fisico 1 + Sur BO + Oeste BO: Disp 1 (prompt) | código: Disp 0 (BO reserva) | ⚠️ DIVERGE_PROMPT (código más protectivo) |
| 6  | Pablo asigna 1 a Oeste → Oeste ASIG, Sur BO | `applyRepartoManualCore` muta OK | ✅ CUMPLE |
| 7  | Preview CPST muestra Utilizable(Oeste)=1 | preview correcto (v1362) | ✅ CUMPLE |
| 8  | VDE Oeste confirma, SAP recibe 1 | **split devuelve state=BO → bug H1** | ❌ **BUG H1 confirmado** |
| 9  | Fisico pasa a 2, Sur BO 1 | fisico 2, BO Sur 1 ✅ | ✅ CUMPLE (sin FIFO automático) |
| 10 | Pablo asigna 1 a Sur → Sur ASIG | mutate OK | ✅ CUMPLE |
| 11 | CPST para Sur, SAP recibe 1 | caso fisico=2+ASIG=1: SAP recibe 1 ✅. Caso fisico=1+ASIG=1: BUG H1 ❌ | ✅ (caso general) / ❌ **BUG H1 edge-case** |

## FAIL RED (evidencia)

1. **PASO 3 flag OFF**: `splitPedidoLine(qty 2 disp 1, flagEnabled:false)` → 1 línea BO qty=2. Debería partir en 2 líneas {1 confirmed + 1 BO}. Bug H4.
2. **PASO 8**: `splitPedidoLine(qty 1 disp 0, flagEnabled:true)` → 1 línea BO. Debería ser confirmed porque Utilizable(Oeste)=1. Bug H1.
3. **PASO 11 edge-case**: fisico=1+ASIG Sur=1 → disp=0 → BO. Mismo bug H1 reaparece cuando fisico == ASIG(propio).

## Observaciones

- **PASO 5** diverge semánticamente del prompt pero no es bug: el código es más protectivo (BO cuenta como reserva, política v701). O1 cumple por diseño conservador.
- **PASO 9+10** sin FIFO automático (cambio v1279 2026-10-14). Pablo decide manualmente. El prompt describe un sistema pre-v1279.
- **PASO 11 caso general**: cuando fisico > ASIG(propio), el bug H1 no se dispara (hay stock libre que absorbe el pedido). El bug es más riesgoso cuando el cliente tiene toda su reserva pegada al físico exacto.

## Mapeo con hallazgos de E1-E3

- Tests FAIL de PASO 3 flag OFF ↔ FINDING-03 + H4 CONFIRMADA.
- Tests FAIL de PASO 8 y PASO 11 edge-case ↔ FINDING-01 + H1 CONFIRMADA + I2+I6 VIOLA.
- PASO 5 ↔ FINDING-10 (semántica distinta prompt vs código).

## Gate E4

- Archivo existe ✅
- 11 pasos presentes como `describe/it` ✅
- Sin `test.skip` ni `it.skip` ✅
- 14 tests corren; 3 FAIL son evidencia TDD RED ✅

**GATE_E4_OK.**
