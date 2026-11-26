# frontend-new

Nuevo frontend del CRM Shimano, montado bajo `/app2/*` conviviendo con el `index.html` legacy del root.

**Estado P1.5 (scaffold)**: shell + 2 pantallas placeholder + CI. **Sin lógica de negocio todavía** — eso llega en P1.6.

## Stack

- React 18 + TypeScript 5 strict (`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`).
- Vite 5 como bundler (ESM nativo, HMR rápido).
- React Router v6 con `basename="/app2"` (ver `src/main.tsx`).
- TanStack Query v5 para data fetching (ver `queryClient` config en `src/main.tsx`).
- Vitest + Testing Library para unit + Playwright para E2E.
- `web-vitals` para instrumentar LCP/INP/CLS/FCP/TTFB.

## Comandos

Desde `frontend-new/`:

```bash
npm install            # deps
npm run dev            # vite dev server en http://127.0.0.1:5173/app2/
npm run build          # output a ../app2-dist/ (listo para git add + Pages)
npm run preview        # sirve la build en http://127.0.0.1:4173/app2/
npm run test           # unit (vitest)
npm run test:watch     # unit en watch
npm run test:e2e       # smoke Playwright (necesita build previo)
npm run typecheck      # tsc --noEmit
npm run lint           # biome check
npm run format         # biome format --write
```

## Convivencia con el legacy

- **El `index.html` del root sigue siendo la app legacy.** NO tocarlo desde este subproyecto.
- **El `index.html` de `frontend-new/` es el entry de Vite** y solo se usa durante `vite dev`. En producción, lo que sirve `/app2/` es `app2-dist/index.html` (generado por `vite build`).
- La carpeta `app2-dist/` es committed al repo (como el `app.bundle.js` legacy) para que GitHub Pages la sirva sin pipeline extra.
- `app.bundle.js`, `src/`, `functions/`, `firestore.rules` del repo legacy **no se tocan** desde este subproyecto.

## Deploy (sin pipeline automático todavía)

Flujo manual actual:

```bash
cd frontend-new
npm run build           # regenera ../app2-dist/
cd ..
git add app2-dist/      # commit el output
git commit -m "..."
git push origin dev     # workflow CLAUDE.md §20 — PR squash-merge a main
```

GitHub Pages sirve desde `main` directamente. El root `/` sigue atendido por `index.html` legacy; `/app2/` lo atiende `app2-dist/index.html` con fallback SPA (ver notas de configuración de Pages más abajo).

### Fallback SPA en Pages

Para que rutas como `/app2/pedidos` no den 404 en Pages (no hay server-side routing), hay dos opciones:

1. **Copy `index.html` a `404.html`** dentro de `app2-dist/` como workaround clásico.
2. Usar `HashRouter` en vez de `BrowserRouter` (perdemos URLs limpias pero evitamos la config).

Hoy estamos con `BrowserRouter`. En P1.6 agregamos el paso de `cp dist/index.html dist/404.html` al script de build, o migramos a Firebase Hosting (que soporta rewrite nativa) si Mariano autoriza.

## Medición de Core Web Vitals

ADR-015 fija los targets contra **Moto G Power / 4G throttle**:

- LCP ≤ 2.5s
- INP ≤ 200ms
- CLS ≤ 0.1

Hoy los emitimos a `console.log` con prefijo `[CWV]` (ver `src/lib/vitals.ts`). Para capturarlos localmente:

```bash
npm run build && npm run preview &
# luego desde el root del repo:
node scripts/perf/measure-vitals-app2.js
```

El script usa Puppeteer + CDP throttling (receta de `scripts/perf/trace-map.js` del legacy). Output JSON apto para lighthouse-ci integration.

## Estructura

```
frontend-new/
├── index.html                   # entry Vite — NO es el root index.html
├── package.json
├── tsconfig.json                # strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess
├── vite.config.ts               # base: '/app2/', output: '../app2-dist/'
├── vitest.config.ts
├── playwright.config.ts         # mobile-first (Pixel 5 viewport)
├── biome.json                   # extends del biome.json raíz
├── .gitignore
├── src/
│   ├── main.tsx                 # mount + QueryClient + Router
│   ├── App.tsx                  # top-level routes con lazy chunks
│   ├── routes/
│   │   ├── index.tsx            # barrel
│   │   ├── stock.tsx            # placeholder
│   │   ├── pedidos.tsx          # placeholder
│   │   └── _404.tsx
│   ├── components/
│   │   ├── Shell.tsx            # header + nav + outlet mobile-first
│   │   ├── Loading.tsx          # skeleton CWV-friendly
│   │   └── ErrorBoundary.tsx    # §68 mensajes humanos
│   ├── lib/
│   │   ├── firebase.ts          # stub P1.5 (init en P1.6)
│   │   ├── auth.ts              # stub P1.5
│   │   ├── api.ts               # stub P1.5 — fetch tipado hacia backend-new
│   │   └── vitals.ts            # web-vitals init + report
│   └── styles/
│       ├── tokens.css           # design tokens (sin dark mode — §108)
│       └── global.css           # reset + layout shell + .btn-zonas pill
├── tests/
│   ├── unit/
│   │   ├── setup.ts
│   │   ├── Shell.test.tsx
│   │   └── ErrorBoundary.test.tsx
│   └── e2e/
│       └── smoke.spec.ts        # Playwright smoke
└── .github/
    └── workflows/
        └── frontend-ci.yml      # lint + typecheck + unit + build
```

## Restricciones durables

- **Sin dark mode** — CLAUDE.md §108 v1580 lo removió. No reintroducir.
- **Sin backend real todavía** — todos los módulos en `src/lib/` son stubs. P1.6 trae wiring.
- **Botones estilo pill** — CLAUDE.md §106. La clase `.btn-zonas` del shell nuevo matchea la del CRM legacy.
- **Interacciones gestuales** — pasar por `apple-design` skill (CLAUDE.md §21) si en P1.6 se agregan drags/swipes/sheets.
- **TypeScript strict** — no relajar flags. Si un tipo falla, revisar el shape, no el tsconfig.

## Decisiones consideradas (y descartadas)

- **Next.js** — descartado en ADR-004 (no queremos SSR; Pages es más simple + barato; convivencia con el legacy es más fácil con SPA puro).
- **Zustand / Jotai** — por ahora TanStack Query cubre server state. Si aparece client state cross-ruta (ej. cart, filtros globales), evaluamos.
- **Styled-components / emotion** — descartado por bundle size. CSS nativo + CSS Modules si surge necesidad.
- **Framer Motion** — solo se incluye cuando aparezca una interacción que la skill `apple-design` clasifique como motion/mini (ver `.agents/skills/apple-design/CLASSIFICATION.md` del repo legacy).

## Changelog

- **2026-11-26 — v0.1.0 scaffold inicial (P1.5)**: estructura + Shell + 2 rutas placeholder + tests + CI. Sin lógica de negocio.
