# Architecture Decision Records (ADR)

Registros de decisiones arquitectónicas durables del proyecto. Cada ADR captura
el contexto, la decisión y las consecuencias de un cambio estructural.

## Formato

- **Status**: `Proposed` → `Accepted` → `Superseded by <N>` / `Deprecated`.
- **Context**: por qué existe la decisión.
- **Decision**: qué se decidió.
- **Consequences**: qué cambia (bueno y malo).
- **Verification**: cómo se chequea que se sigue.

## Índice

| N | Título | Status | Fecha |
|---|---|---|---|
| 0001-0008 | (ADRs informales previos — ver CLAUDE.md §56-§107) | — | — |
| 0009 | [Gobernanza de feature flags](./0009-feature-flags.md) | Accepted | 2026-11-25 |
| 0010 | Versionado API commitPedidoCF | PendienteHumano | — |
| 0011 | [Budget formal de bundle size](./0011-bundle-budget.md) | Accepted | 2026-11-25 |
| 0012 | [Gobernanza de cron workflows](./0012-cron-governance.md) | Accepted | 2026-11-25 |

## Pendientes humanos

Los ADRs que requieren decisión de Mariano antes de implementar:

- **ADR-008** (migración no-downtime): toca modelo de datos. Pre-requisito: ADR-001.
- **ADR-010** (versionado API): toca contrato cliente+servidor. Requiere plan de rollout.

Ver `Desktop/RESPUESTAS/PENDIENTE_HUMANO.md` para el status actual.

## Cómo agregar un ADR nuevo

1. Elegir el siguiente número libre (0013, 0014, …).
2. Copiar la estructura de `0009-feature-flags.md` como template.
3. Llenar Context / Decision / Consequences / Verification.
4. Marcar `Status: Proposed` hasta que Mariano acepte.
5. Agregar fila en el índice de este README.
6. Si el ADR se traduce en un script de audit o un test, dejar el link en la sección Verification.
