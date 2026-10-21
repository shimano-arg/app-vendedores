# 27 — Efecto §40.1 (waitlistCpst no reserva) en producción — PAUSA REQUERIDA

**Fecha**: 2026-10-21T15:58 UTC
**Script**: `scripts/audit/K_efecto_waitlist_no_reserva.cjs`
**Veredicto**: **PAUSA** — total ≥ 50 u. Esperando OK Mariano antes de merge.

---

## Resumen

| Métrica | Valor |
|---|---|
| SKUs cuyo libre SUBE con §40.1 | **31** |
| Total unidades que pasan a libre | **139 u** |

Las 139 u son unidades que hoy están "reservadas" por waitlistCpst (draft VDE desde Stock Asignado) **además** de la ASIG original del mismo cliente — doble conteo. El fix saca el double counting.

---

## Top 20 SKUs con mayor delta

| SKU | fisico | asig | conf | wlCpst | librePre | librePost | delta |
|---|---|---|---|---|---|---|---|
| LDM54TE3023015S | 18 | 0 | 0 | 15 | 3 | 18 | +15 |
| LDM54TE5031515H | 40 | 12 | 0 | 12 | 16 | 28 | +12 |
| LDM54TE4028015S | 20 | 0 | 0 | 10 | 10 | 20 | +10 |
| EXGC66MBAR | 63 | 6 | 0 | 10 | 47 | 57 | +10 |
| EXGTVS70MH4AR | 24 | 15 | 0 | 22 | 0 | 9 | +9 |
| FX2000FC | 61 | 28 | 1 | 8 | 24 | 32 | +8 |
| EXGS70HB2AR | 57 | 7 | 0 | 7 | 43 | 50 | +7 |
| CRZAXFGB2502 | 30 | 7 | 0 | 7 | 16 | 23 | +7 |
| LDM54TE1516015G | 23 | 15 | 0 | 6 | 2 | 8 | +6 |
| CLT01047 | 14 | 0 | 0 | 5 | 9 | 14 | +5 |
| EXGC70MHBAR | 12 | 6 | 1 | 6 | 0 | 5 | +5 |
| EXGS70MHBAR | 74 | 5 | 0 | 5 | 64 | 69 | +5 |
| **CUDC201HG** | **7** | **1** | **0** | **4** | **2** | **6** | **+4** |
| SUNBASS | 3 | 0 | 0 | 3 | 0 | 3 | +3 |
| CLC70H2PY | 9 | 0 | 2 | 3 | 4 | 7 | +3 |
| LDM64TE2020030G | 51 | 17 | 0 | 3 | 31 | 34 | +3 |
| MIR4000XG | 7 | 0 | 1 | 3 | 3 | 6 | +3 |
| ALV6000FA | 5 | 2 | 0 | 3 | 0 | 3 | +3 |
| ECLIPSE | 2 | 0 | 0 | 2 | 0 | 2 | +2 |
| STS70M2C | 4 | 0 | 0 | 2 | 2 | 4 | +2 |

---

## Caso 597151 BENGOCHEA (reporte Mariano)

Hoy aparece como:
- fisico 2, asig 6 (BENGOCHEA), wlCpst 10 (BENGOCHEA 6 + PONTORIERO 2 + RODRIGUEZ 2).
- librePre = max(0, 2 - 6 - 10) = 0.
- librePost = max(0, 2 - 6) = 0 (clamp).

**Delta aparente para 597151 = 0**, pero el fix elimina el doble conteo visible al VDE en la tabla "Reservadas" del Modal Pedido en espera. Antes la tabla mostraba "reservadas 16" (asig 6 + wlCpst 10); después muestra "reservadas 6" (solo asig). El libre no cambia pero la UX es correcta.

---

## Interpretación

**Antes del fix** (v1392 §40): un waitlist CPST contaba como reserva igual que la ASIG original. Si el VDE preparaba un draft desde Stock Asignado, el stock se contaba 2 veces:
1. Una vez por el pedido ASIG original (ya existente).
2. Otra vez por el waitlist (draft preparando el reemplazo).

**Después del fix** (v1393 §40.1): solo la ASIG reserva. El waitlist es informativo. Si el VDE sube la cantidad por encima de la ASIG al confirmar, el excedente va a BO (que no reserva por §40).

**Riesgo residual**: si un waitlist queda "huérfano" (sin ASIG viva de respaldo), no reserva nada. **Es consistente con §40.1**: waitlist es draft, nunca reserva.

---

## GATE_E4_PAUSED

```
test -f docs/auditoria/27_EFECTO_WAITLIST_NO_RESERVA.md ✓
Total unidades que pasan a libre: 139 ✓
TOTAL=139 >= 50 → PAUSA ✓
```

**GATE_E4_PAUSED — Esperando OK Mariano antes de merge.**

Si aprueba:
- Push + PR + merge --squash --admin.
- `firebase deploy --only functions:onDep11IncreaseCreateReparto,functions:applyRepartoManualCF` (ambas usan el breakdown espejo).
- Verify prod: BENGOCHEA 597151 en Lista de Espera "reservadas 6" (no 16).
