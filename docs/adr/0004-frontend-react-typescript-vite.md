# ADR-0004: Frontend nuevo en React + TypeScript + Vite bajo `/app2/`

- **Status**: Accepted (2026-11-26).
- **Decididores**: Mariano (owner técnico).
- **Supersede**: nada (decisión nueva).
- **Relacionado**: ADR-011 (bundle budget), ADR-013 (piloto solo-lectura), ADR-015 (CWV mobile-first).

## Contexto

El CRM vigente vive en `index.html` (root) + `app.bundle.js` + chunks (todos trackeados en `main`). Se shippean cambios directo al monolito desde hace meses. Problemas crecientes:

- Bundle del shell ~3,04 MB raw (CLAUDE.md §16, ADR-011). Techo hoy 3,5 MB — queda ~15% de margen.
- No hay tipos. Debugging de bugs de shape (ej. `line.origen`, `asigRefs`) es by-grep.
- Tests UI son casi solo smoke de Playwright. Costoso evolucionar UI compleja.
- Interacciones mobile-first requieren disciplina manual (CLAUDE.md §21 apple-design) que no escala.

Propuesta: abrir una segunda aplicación React + TS + Vite montada bajo `/app2/*` que conviva con el legacy. Mariano pidió explícitamente: "frontend nuevo, mobile-first, convive con el legacy; sin lógica de negocio todavía — eso es P1.6".

## Decisión

Stack:

| Capa | Tecnología | Por qué |
|---|---|---|
| Lenguaje | TypeScript 5 strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) | Tipos cubren bugs de shape (ej. §40.3 `asigRefs[]`) antes del test. |
| UI | React 18 | Mismo mental model que el equipo. Concurrent features + Suspense maduros. |
| Bundler | Vite 5 | HMR rápido, ESM nativo, target `es2022`. Sin la complejidad de webpack. |
| Router | React Router v6 (`BrowserRouter` + `basename="/app2"`) | Convive con `/` legacy sin conflicto. URL limpia. |
| Data fetching | TanStack Query v5 | `staleTime: 30s`, retry 2, `refetchOnWindowFocus: false` — pensado para vendedores en 4G. |
| Testing unit | Vitest + Testing Library | Mismo runner que el legacy (`vitest.config.js` en root). |
| Testing E2E | Playwright + Pixel 5 viewport | Mobile-first (ADR-015). |
| Lint/format | Biome 2.5.6 | Extends del `biome.json` raíz. Consistencia cross-subproject. |
| Styling | CSS nativo + CSS vars (`tokens.css`) | Sin runtime, sin bundle extra. Paleta alineada a `apple-design.css` legacy. |
| Metrics | `web-vitals` v4 | LCP/INP/CLS/FCP/TTFB vía `console.log` prefixed `[CWV]` en P1.5; endpoint `/api/metrics/cwv` en P1.6. |

Output: `../app2-dist/` committed a `main` (mismo pattern que `app.bundle.js` legacy). GitHub Pages sirve `/` del root y `/app2/` del dist.

### Alternativas descartadas

- **Next.js**: SSR requiere Node server o Vercel. Rompe la simplicidad de Pages. Convivencia con el legacy es más frágil (rewrite reglas). El equipo no necesita SSR hoy — los vendedores están autenticados y el contenido es dinámico post-login.
- **Reemplazo in-place** del `index.html` legacy: imposible sin migrar los 14 dominios de una vez. El pattern "run strangler" (CLAUDE.md §13/§14 para extracciones) nos enseña que grandes refactors monolíticos no funcionan.
- **Svelte / Solid**: menor adopción en el equipo. Costo de onboarding alto para el beneficio marginal.
- **Vanilla TS + routing a mano**: viable pero no escalable. Router + QueryClient dan baseline productivo sin bundle significativo.

## Consecuencias

### Positivas

- Tests UI primero → regresiones UX se detectan en el PR, no en producción.
- Tipos cubren `pedido.lines[i].origen` + `asigRefs[]` + `boEntryResolved` antes del gate server (CLAUDE.md §35/§56).
- Shell separado del legacy permite iterar sin bloquear hotfixes al CRM productivo.
- Chunks lazy por ruta (ADR-011): shell inicial ≤ 150 KB gzipped, cada pantalla ≤ 50 KB gzipped (target).
- CWV instrumentados desde el día 1 (ADR-015).

### Negativas

- Dos frontends en el mismo repo. Dev tiene que entender dónde vive cada cosa.
- `app2-dist/` committed infla el repo (~500 KB-1 MB por release).
- Hasta P1.6 el frontend nuevo no reemplaza nada — es overhead puro durante la transición.

### Trade-offs aceptados

- **`app2-dist/` committed** (en vez de pipeline CI que buildea en deploy): evita depender de GitHub Actions para servir Pages. Pattern probado con `app.bundle.js`.
- **BrowserRouter + fallback 404** (en vez de HashRouter): URLs limpias para los vendedores; al costo de necesitar `404.html` copia de `index.html` en Pages (TODO P1.6).
- **Sin SSR / sin Static Generation**: todo client-side. Para una app post-login es aceptable.

## Verificación

1. `cd frontend-new && npm run build` genera `../app2-dist/` con `index.html` + assets hasheados.
2. `npm run test` corre Vitest + Testing Library sobre `tests/unit/`.
3. `npm run test:e2e` corre Playwright sobre la build (preview localhost).
4. `.github/workflows/frontend-ci.yml` corre lint + typecheck + test + build en cada PR.
5. `scripts/perf/measure-vitals-app2.js` mide CWV contra el preview — valida targets ADR-015.

## Referencias

- CLAUDE.md §13/§14/§17/§18 — patterns aprendidos de extracciones E2 del legacy.
- CLAUDE.md §16 — historial bundle budget.
- CLAUDE.md §21 — interacciones gestuales vía `apple-design` skill.
- CLAUDE.md §106 — botones pill `.btn-zonas`.
- CLAUDE.md §108 — sin dark mode.
- ADR-011 — bundle budget formal.
- ADR-013 — piloto solo-lectura (stock + pedidos).
- ADR-015 — Core Web Vitals mobile-first.
