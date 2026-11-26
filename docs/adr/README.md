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
| 0001 | Modelo de datos pedidos/líneas/reservas (PostgreSQL) | Proposed → Accepted en S-10 (ver PR schema PG) | 2026-11-26 |
| 0002 | (informal — ver CLAUDE.md §56-§107) | — | — |
| 0003 | Ambiente staging separado (ver guía PENDIENTE_HUMANO) | Accepted (project `app-vendedores-staging`) | 2026-11-26 |
| 0004 | [Frontend React + TypeScript (Vite)](./0004-frontend-react-typescript-vite.md) | Accepted | 2026-11-26 |
| 0005-0007 | (informales previos) | — | — |
| 0008 | [Estrategia de migración sin downtime](./0008-migracion-no-downtime.md) | Proposed (PR #1472) | 2026-11-26 |
| 0009 | [Gobernanza de feature flags](./0009-feature-flags.md) | Accepted | 2026-11-25 |
| 0010 | [Versionado API commitPedidoCF](./0010-versionado-api-commit-pedido.md) | Proposed (PR #1472) | 2026-11-26 |
| 0011 | [Budget formal de bundle size](./0011-bundle-budget.md) | Accepted | 2026-11-25 |
| 0012 | [Gobernanza de cron workflows](./0012-cron-governance.md) | Accepted | 2026-11-25 |
| 0013 | [Piloto solo lectura stock + pedidos](./0013-piloto-solo-lectura-stock-pedidos.md) | Accepted | 2026-11-26 |
| 0014 | [Backend TypeScript/Node modular](./0014-backend-typescript-node-modular.md) | Accepted | 2026-11-26 |
| 0015 | [Mobile first + Core Web Vitals](./0015-mobile-first-core-web-vitals.md) | Accepted | 2026-11-26 |

## Decisiones S-10 (2026-11-26, Mariano 11:22-11:25 ART)

7 decisiones arquitectónicas definitivas tomadas por Mariano en el inicio de S-10. El Stack ya NO depende del GO de seguridad.

1. **Fases 6 y 7 autorizadas** (piloto + migración pedidos/reservas) con doble escritura + flag de lectura. → ADR-0008 opción B.
2. **Frontend React + TS, pantalla por pantalla**, conviviendo con `index.html`. → ADR-0004.
3. **Pedidos y reservas pasan a PostgreSQL**. → ADR-0001 (schema en PR aparte).
4. **PostgreSQL en Cloud SQL**, mismo proyecto GCP que las Functions.
5. **Backend TypeScript/Node modular**, migración gradual Functions. → ADR-0014.
6. **Ambiente de pruebas separado** (`app-vendedores-staging`, ya existe). → Guía setup en PENDIENTE_HUMANO.
7. **Piloto: consulta de stock + pedidos, SOLO LECTURA**. → ADR-0013.

Mobile first + CWV (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1) son criterios de aceptación de **cada pantalla nueva**. → ADR-0015.

## Pendientes humanos

Los ADRs en estado `Proposed` requieren decisión de Mariano:

- **ADR-008**: recomendación Opción B (doble escritura + flag cutover) — Mariano firma cuando ADR-001 se implemente.
- **ADR-010**: versionado semver API commitPedidoCF — Mariano firma antes de que ADR-001 obligue un bump MAJOR.

Ver `Desktop/RESPUESTAS/PENDIENTE_HUMANO.md` para el status actual.

## Cómo agregar un ADR nuevo

1. Elegir el siguiente número libre (0013, 0014, …).
2. Copiar la estructura de `0009-feature-flags.md` como template.
3. Llenar Context / Decision / Consequences / Verification.
4. Marcar `Status: Proposed` hasta que Mariano acepte.
5. Agregar fila en el índice de este README.
6. Si el ADR se traduce en un script de audit o un test, dejar el link en la sección Verification.
