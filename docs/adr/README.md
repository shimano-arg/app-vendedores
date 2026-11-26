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
| 0001-0007 | (ADRs informales previos — ver CLAUDE.md §56-§107) | — | — |
| 0008 | [Estrategia de migración sin downtime](./0008-migracion-no-downtime.md) | Proposed | 2026-11-26 |
| 0009 | [Gobernanza de feature flags](./0009-feature-flags.md) | Accepted | 2026-11-25 |
| 0010 | [Versionado API commitPedidoCF](./0010-versionado-api-commit-pedido.md) | Proposed | 2026-11-26 |
| 0011 | [Budget formal de bundle size](./0011-bundle-budget.md) | Accepted | 2026-11-25 |
| 0012 | [Gobernanza de cron workflows](./0012-cron-governance.md) | Accepted | 2026-11-25 |

## Pendientes humanos

Los ADRs en estado `Proposed` requieren decisión de Mariano antes de implementar:

- **ADR-008** (migración no-downtime): toca modelo de datos. Pre-requisito: ADR-001. Doc completo 2026-11-26 con recomendación Opción B (doble escritura + flag de cutover). Sin decisión todavía.
- **ADR-010** (versionado API commitPedidoCF): toca contrato cliente+servidor. Doc completo 2026-11-26 con recomendación Opción B (semver MAJOR.MINOR + ventana soporte N-2). Sin decisión todavía.

Ver `Desktop/RESPUESTAS/PENDIENTE_HUMANO.md` para el status actual.

## Cómo agregar un ADR nuevo

1. Elegir el siguiente número libre (0013, 0014, …).
2. Copiar la estructura de `0009-feature-flags.md` como template.
3. Llenar Context / Decision / Consequences / Verification.
4. Marcar `Status: Proposed` hasta que Mariano acepte.
5. Agregar fila en el índice de este README.
6. Si el ADR se traduce en un script de audit o un test, dejar el link en la sección Verification.
