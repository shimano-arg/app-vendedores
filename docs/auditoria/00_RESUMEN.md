# Auditoría flujo de stock CRM — Resumen ejecutivo

**Rama:** `audit-stock-flow` (desde `origin/main`, sin modificar lógica de negocio).
**Fecha:** 2026-10-20.
**Plan:** `docs/superpowers/plans/2026-10-20-auditoria-stock-crm.md`.

## Síntoma reportado

> Un pedido con 3u disponibles en SAP dep 11 terminó 100% en back order (0 unidades a SAP). Observado con `STRADIC-2500`.

## Veredicto final

**Causa raíz identificada: bug H1 confirmado.** El call-site `doConfirmPedido` → `getDisp` (`index.html:34720-34722`, v1208) usa `window.getStockRealmenteDisponible(sku)` sin pasar `cardCode`. Para un pedido ex-ASIG del cliente C, la propia reserva ASIG(C) cuenta como "comprometida" contra sí misma → `disp = 0` → split cae en caso 2 → línea entera va a BO → bloque v607 auto-marca `transferidoSAP:{via:'app_only'}` → **SAP nunca recibe el pedido.**

Mientras tanto, el preview CPST (`_cpstRenderPreview`, v1362) usa la fórmula correcta por cliente y muestra "Utilizable 1" al admin. **La UI engaña**: preview correcto, commit buggy.

**Fix propuesto en `06_PROPUESTAS_FIX.md > P1`** — portar la fórmula del preview al call-site del split. ~10 líneas.

## Veredicto por invariante

| ID | Invariante | Veredicto |
|----|------------|-----------|
| I1 | Disp = Físico − Reservado ≥ 0, Físico solo dep 11 | **CUMPLE** |
| I2 | Pedido ex-ASIG: Utilizable(C) = Disp + Reservado(C) | **VIOLA** (bug H1) |
| I3 | Reserva libera 1 vez al enviar a SAP | **NO VERIFICABLE** vía unit — query E5-A |
| I4 | Unidad nunca en 2 estados a la vez | **CUMPLE** |
| I5 | SKU Físico>0 + BO pendiente → Reparto, no Backorder | **NO VERIFICABLE** vía unit — query E5-B |
| I6 | No autogenerar BO si Disp cubre al momento del envío | **VIOLA** (bug H1 + FLAG-OFF-v600) |
| I7 | Pedido parcial se parte: cubierto a SAP, resto a BO | **VIOLA** (FLAG-OFF-v600) |

## Veredicto por hipótesis

| ID | Hipótesis | Veredicto |
|----|-----------|-----------|
| H1 | "Crear Pedido Desde Stock Asignado" resta la propia reserva | **CONFIRMADA** |
| H2 | Reserva no se libera al enviar a SAP | **DESCARTADA** parcial + NO VERIFICABLE e2e |
| H3 | Físico mal leído (otro depósito / snapshot stale) | **DESCARTADA** parcial + NO VERIFICABLE runtime |
| H4 | Pedido parcial mal partido | **CONFIRMADA** (solo flag OFF) |
| H5 | Condición de carrera | **NO VERIFICABLE** vía unit |
| H6 | Ventana sin protección entre ingreso y reparto | **DESCARTADA** (código actual más protectivo) |

## Hallazgos adicionales (FINDING-01 .. FINDING-10)

Documentados en `01_MAPA_FLUJO.md`. Resumen de los que requieren acción:

- **FINDING-02 (CRÍTICO):** drift TTL 7d (src/pure) vs 15d (functions/core). Modal cliente dice "libre", server CF dice "reservado". Fix P3.
- **FINDING-03 (MEDIO):** kill switch `localStorage.split_enabled='0'` sigue honrado. Browsers con esa clave reproducen el bug v600. Fix P2.
- **FINDING-04 (BAJO):** 3 fórmulas distintas de "disponibilidad" conviven en el repo. Fix P4 (refactor).
- **FINDING-05 (MEDIO):** gap operativo PASO 9+10 (`applyRepartoManualCore` marca `status='done'` con stock sobrante). Fix P5.
- **FINDING-06 (BAJO):** fallback inline usa fórmula v701 vieja. Fix P6.

## Entregables producidos

### Documentos
- `00_RESUMEN.md` — este documento
- `01_MAPA_FLUJO.md` — mapa file:line por paso 0-11 (3 agentes paralelos)
- `02_INVARIANTES.md` — veredicto I1-I7 + evidencia
- `03_HIPOTESIS.md` — veredicto H1-H6 + evidencia
- `04_END_TO_END.md` — reporte del test fixture 11 pasos
- `05_QUERIES_DIAGNOSTICO.md` — scripts dry-run OK + GATE HUMANO pendiente para prod
- `06_PROPUESTAS_FIX.md` — 6 propuestas + evaluación ventana H6

### Tests (TDD RED hasta que se arregle el bug)
- `tests/unit/audit/_fixtures.js` — fixtures reusables (NORTE/SUR/OESTE, SKU STRADIC)
- `tests/unit/audit/_fixtures.smoke.test.js` — smoke 7/7 PASS
- `tests/unit/audit/invariants.test.js` — 19 tests (14 PASS + **5 FAIL RED** evidencia)
- `tests/unit/audit/hipotesis.test.js` — 15 tests PASS
- `tests/unit/audit/end-to-end-stradic.test.js` — 14 tests (11 PASS + **3 FAIL RED** evidencia)

### Scripts
- `scripts/audit/A_reservas_vivas_pedido_enviado.cjs` (dry-run OK, prod GATE HUMANO)
- `scripts/audit/B_bo_con_fisico_positivo.cjs` (dry-run OK, prod GATE HUMANO)
- `scripts/audit/C_pedidos_bo_con_stock_al_crear.cjs` (dry-run OK, prod GATE HUMANO)

### Reglas durables
- `CLAUDE.md §31` — auditoría ≠ corrección (regla nueva)
- `CLAUDE.md §32` — regla específica aprendida de H1 (próximo commit)

## Métricas

- **8 commits** en la rama `audit-stock-flow` (uno por etapa + fixtures).
- **~1,200 líneas** de docs/auditoria/*.md.
- **~750 líneas** de tests + fixtures.
- **~400 líneas** de scripts audit/.
- **48 tests nuevos**: 7 fixtures smoke + 19 invariantes + 15 hipótesis + 14 end-to-end = **40 PASS + 8 FAIL RED (evidencia)**.
- **8/8 gates** verdes (E0-E7).

## Próximos pasos

1. **Prioridad ALTA**: Mariano revisa `06_PROPUESTAS_FIX.md > P1` (fix H1). ~10 líneas tocadas en `index.html`. Nueva rama + nuevo PR.
2. **Prioridad ALTA**: Mariano decide TTL 7d vs 15d para fix P3 (drift pedido-snapshot-core).
3. **GATE HUMANO E5**: ¿autorizás ejecutar `--prod` las 3 queries diagnóstico? Esperando OK.
4. **Prioridad MEDIA**: fix P2 (kill switch) + P5 (gap operativo reparto).
5. **Prioridad BAJA**: refactor P4 (consolidar fórmulas) + P6 (fallback inline).
