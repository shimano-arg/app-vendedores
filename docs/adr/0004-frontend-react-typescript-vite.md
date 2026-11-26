# ADR-0004: Frontend React + TypeScript (Vite) conviviendo con la app actual

- **Status**: Accepted (2026-11-26).
- **Decididor**: Mariano (owner técnico).
- **Fecha decisión**: 2026-11-26 11:22 ART.
- **Supersede**: ninguno formal. Cambio de dirección respecto del vanilla JS inline + bundle IIFE actual (CLAUDE.md §13-§18).
- **Relacionado**: ADR-008 (migración no-downtime), ADR-011 (bundle budget), ADR-013 (piloto solo lectura), ADR-015 (mobile first + CWV).

## Contexto

La app actual vive en `index.html` (~40k LOC inline) + un bundle IIFE que se cargan blocking en `<head>`. El pattern actual (documentado en CLAUDE.md §13-§18) tiene fricciones acumuladas: extracciones manuales de dominios (map-tile-layer PR #1470, force-update-app PR #1473), scope global compartido con `var`, idempotencia manual de listeners `onSnapshot`, y presupuesto de bundle sin herramienta formal (ADR-011 limitado a 3.5 MB + 400 KB chunks).

Las métricas Core Web Vitals del piloto móvil van a ser el criterio de aceptación de cada pantalla nueva (ADR-015). Un stack con árbol de componentes + bundling moderno (tree-shaking real, code splitting por ruta, HMR en dev) baja la curva de aprendizaje para cada feature nueva y facilita medir CWV por pantalla.

## Decisión

El frontend nuevo del CRM se construye con **React 18 + TypeScript + Vite**, pantalla por pantalla, conviviendo con `index.html` del `shimano-arg.github.io`. Se despliega en la misma URL base bajo rutas nuevas (ej. `/app2/stock`, `/app2/pedidos`) sin desplazar las URLs actuales.

### Stack técnico

- **Framework**: React 18 (concurrent mode disponible).
- **Lenguaje**: TypeScript 5 (strict mode).
- **Bundler**: Vite 5 (`@vitejs/plugin-react`).
- **Router**: `react-router-dom` 6 (data loaders + nested routes).
- **Estado server**: `@tanstack/react-query` v5 (cache + suspense).
- **Estilos**: CSS Modules + Tailwind 4 (opcional, decisión en ADR aparte). Mobile first obligatorio.
- **Tests**: Vitest + Testing Library (unit) + Playwright (e2e crítico).
- **Lint**: Biome (ya en el repo; cero config extra).

### Convivencia con `index.html`

- `index.html` sigue siendo el entry principal. React carga en una ruta `/app2/*` servida por Pages (mismo deploy pipeline).
- Deploy único: `npm run build` genera `frontend-new/dist/` que Pages publica bajo `/app2/`.
- Sesión Firebase compartida: `firebase.initializeApp(sameConfig)` desde el shell React lee el auth del usuario logueado en la app actual. El piloto solo lectura (ADR-013) no requiere cross-auth entre runtimes.
- CSP / COOP sin cambios iniciales.

### Mobile first + CWV (criterios de aceptación)

Cada pantalla nueva debe cumplir (medido con Lighthouse CI o similar, device "Moto G Power" / 4G throttling):

- **LCP ≤ 2.5 s**.
- **INP ≤ 200 ms**.
- **CLS ≤ 0.1**.
- **Bundle de ruta ≤ 150 KB gzipped** (shell + componentes de pantalla, excluyendo vendor).
- Breakpoint mínimo: 360×640 (iPhone SE legacy).

Si una pantalla no cumple → bloquea merge.

## Consecuencias

### Bueno

- Code splitting por ruta via Vite → cada pantalla trae sólo lo suyo. No más bundle monolítico de 3.14 MB.
- Mediciones CWV por pantalla gracias a Web Vitals library (ya hay instrumentación §instrumentation en el bundle actual — reusable).
- React Query maneja cache de Firestore + backend nuevo con contratos tipados.
- TypeScript strict atrapa errores de contrato cliente↔servidor (ADR-010).
- Estándar de la industria → onboarding de futuros devs es inmediato.

### Malo

- Curva de aprendizaje puntual para el equipo (hoy mayormente vanilla).
- Dos runtimes en producción durante la convivencia (vanilla + React). Payload extra temporal estimado: +300 KB (React + ReactDOM + router + react-query minified).
- CI pipeline duplica: `npm run test:unit` del repo raíz + `cd frontend-new && npm run test` nuevo.
- Firestore SDK se carga dos veces (una por runtime). Mitigación: futuro trabajo de shared bundle via module federation o `import maps`.

### Lo que NO cambia

- `index.html` sigue siendo entry principal durante la transición.
- Deploy pipeline (Pages auto-deploy on merge to `main`) no cambia.
- Firebase rules y Cloud Functions no cambian por este ADR.
- Usuarios no notan el cambio salvo donde se migre una pantalla específica.

## Alternativas evaluadas y descartadas

1. **Next.js 15** (SSR + RSC). Sobredimensionado para 15 vendedores + 2k writes/día. SSR requiere servidor nuevo (vs Pages static). Postergado a si se migra a server-rendered por SEO (no es caso).
2. **Lit Elements / Web Components**. Permite integrar con vanilla sin framework. Rechazado por falta de ecosistema para data fetching + routing + tipos.
3. **Preact + Preact Signals**. 10× más chico que React. Rechazado por equipo sin experiencia + biblioteca de componentes más chica.
4. **Seguir con vanilla + mejor extraction pattern**. Rechazado porque no resuelve el problema de medir CWV por pantalla ni code splitting formal.

## Verification

- Audit test `tests/unit/audit/frontend-new-stack-contract.test.js` (a crear): verifica que `frontend-new/package.json` tiene `react@18`, `typescript@5`, `vite@5` como deps principales.
- CI gate: PR que toca `frontend-new/` debe correr `cd frontend-new && npm run build && npm run test`.
- Verificación empírica de CWV en cada PR de pantalla nueva: script `scripts/perf/measure-vitals-<route>.js` reporta LCP/INP/CLS en el PR body.

## Rollback

El stack React vive en `/app2/*`. Si se decide abortar, bastaría con desplegar sin `frontend-new/dist/` publicado en Pages. Las pantallas vanilla actuales siguen funcionando — no hay dependencia de React en el runtime principal.
