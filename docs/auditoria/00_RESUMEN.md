# Auditoría flujo de stock CRM — Resumen ejecutivo

**Rama:** `audit-stock-flow` (desde `origin/main`, sin modificar lógica de negocio).
**Fecha:** 2026-10-20.
**Plan:** `docs/superpowers/plans/2026-10-20-auditoria-stock-crm.md`.

## Síntoma reportado

> Un pedido con 3u disponibles en SAP dep 11 terminó 100% en back order (0 unidades a SAP). Observado con `STRADIC-2500`.

## Objetivos

- **O1** proteger stock con dueño (BO que recibió unidades no se lo lleva otro cliente).
- **O2** no esconder stock libre (toda unidad SAP dep 11 no reservada tiene que poder enviarse).

El síntoma es violación de **O2**.

## Veredicto por invariante

Pendiente E2 (`docs/auditoria/02_INVARIANTES.md`).

| ID | Invariante | Veredicto |
|----|------------|-----------|
| I1 | Disp = Físico − Reservado ≥ 0, Físico solo dep 11 | ⏳ |
| I2 | Pedido ex-ASIG: Utilizable(C) = Disp + Reservado(C) | ⏳ |
| I3 | Reserva libera 1 vez al enviar a SAP | ⏳ |
| I4 | Unidad nunca en 2 estados a la vez | ⏳ |
| I5 | SKU Físico>0 + BO pendiente → Reparto, no Backorder | ⏳ |
| I6 | No autogenerar BO si Disp cubre al momento del envío | ⏳ |
| I7 | Parcial se parte: cubierto a SAP, resto a BO | ⏳ |

## Veredicto por hipótesis

Pendiente E3 (`docs/auditoria/03_HIPOTESIS.md`).

| ID | Hipótesis | Veredicto |
|----|-----------|-----------|
| H1 | "Crear Pedido Desde Stock Asignado" resta la propia reserva | ⏳ |
| H2 | Reserva no se libera al enviar a SAP | ⏳ |
| H3 | Físico mal leído (otro depósito / snapshot stale) | ⏳ |
| H4 | Pedido parcial mal partido | ⏳ |
| H5 | Condición de carrera | ⏳ |
| H6 | Ventana sin protección entre ingreso y reparto | ⏳ |

## Entregables

- `01_MAPA_FLUJO.md` — mapa file:line por paso 0-11
- `02_INVARIANTES.md` — tabla I1-I7 + evidencia
- `03_HIPOTESIS.md` — tabla H1-H6 + evidencia
- `04_END_TO_END.md` — reporte paso-a-paso del test fixture STRADIC-2500
- `05_QUERIES_DIAGNOSTICO.md` — queries + resultado dry-run (+ prod si GATE OK)
- `06_PROPUESTAS_FIX.md` — 1 sección por hallazgo + evaluación H6 window
- Tests: `tests/unit/audit/*.test.js`
- Scripts: `scripts/audit/*.cjs`
