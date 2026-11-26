# S-10 P1.6 — Piloto React mobile-first read-only (Stock + Pedidos)

**Fecha**: 2026-11-26.
**Owner**: Mariano.
**Rama**: `feat/s10-pilot-react-readonly`.
**Base**: `origin/main` (b9023ada).
**Dependencias conceptuales**: #1477 (backend data layer + contratos Zod) y #1479 (frontend scaffold Vite). Como ninguno está en `main`, este PR incluye placeholders locales en `frontend-new/` + copias mínimas de los contratos Zod bajo `frontend-new/src/contracts/`.

## Objetivo

Shippear un piloto React aislado bajo `/app2/` con 2 rutas de solo lectura:

1. `/app2/stock` — SKU breakdown por cliente (10 campos del `getStockBreakdown`, §39/§107).
2. `/app2/pedidos` — últimas órdenes del cliente (keyset paginated), modal detalle.

Zero writes, zero Firebase mutations. Validación bidireccional Zod en runtime (parsea respuestas antes de render). TanStack Query v5. Mobile-first (Moto G Power + 4G throttling, ADR-015). Bundle shell < 150 KB gzipped + rutas < 50 KB cada una (ADR-011 subset piloto).

## Scope OUT

- Mutaciones (POST /api/pedidos). Van por otro PR con guard.
- Render del mapa Leaflet (no hace falta para el piloto).
- Login real (reusa el token del app1 via `firebase.auth().currentUser.getIdToken(true)` §25).
- Service Worker PWA (lo cubre el scaffold base).
- Prerender / SSR.

## Pasos ejecutables

### 1. Scaffold base (si no existe en main)

- `frontend-new/package.json`, `tsconfig.json`, `vite.config.ts`, `biome.json`, `vitest.config.ts`.
- `frontend-new/index.html` con mount point.
- `frontend-new/src/main.tsx` monta `<App />` con `BrowserRouter basename="/app2"` + `QueryClientProvider`.
- `frontend-new/src/App.tsx` define rutas `/`, `/stock`, `/pedidos`, `/*`.
- `frontend-new/src/styles/tokens.css` — tokens base (colores, spacing, tap targets ≥ 44px).
- `frontend-new/src/components/{Shell,Loading,ErrorBoundary}.tsx`.
- `frontend-new/src/lib/{firebase,auth,api,vitals}.ts`.
- `frontend-new/src/contracts/{common,get-stock,get-pedidos}.ts` — placeholders Zod compat con #1477.

### 2. API client con Zod parse (`src/lib/api.ts`)

- `API_BASE_URL = 'http://localhost:8080'` constante (sin env vars, ADR-013).
- Función `apiFetch<T>(path, { params, schema })` que:
  1. Resuelve `firebase.auth().currentUser.getIdToken(true)` (force refresh §25).
  2. Hace `fetch` con header `Authorization: Bearer <token>`.
  3. `response.json()` → `envelope.data` → `schema.parse(envelope.data)`.
  4. Si Zod falla → tirar `ApiValidationError` (capturado por `ErrorBoundary`).
- Endpoints:
  - `getStock({ cardCode, sku })` → `GetStockOutput`.
  - `getPedidos({ cardCode, cursor })` → `GetPedidosByClientOutput`.

### 3. Ruta `/app2/stock` (`src/routes/stock.tsx`)

- Input mobile-first con buscador cardCode (query param `?cliente=CXXX`).
- `useQuery` con `queryKey: ['stock', cardCode, sku]`, `staleTime: 30_000`, `retry: 2`, `refetchOnWindowFocus: false`.
- Render tabla con los 10 campos del breakdown (siguiendo §103 fórmula explícita):
  - Físico dep 11
  - En tránsito dep 12
  - Back order (app)
  - Confirmadas sin facturar
  - Asignadas
  - Waitlist CPST (informativo)
  - Reparto abierto
  - Reservadas total
  - Libre para la venta
  - Utilizable para el cliente
- Loading skeleton + ErrorBoundary.
- Botón "Buscar otro SKU".

### 4. Ruta `/app2/pedidos` (`src/routes/pedidos.tsx`)

- Input cardCode.
- `useInfiniteQuery` con keyset (`cursor`).
- Render cards: fecha humanizada + cliente + ARS total + N SKUs.
- Click card → modal detalle líneas.
- Loading skeleton + ErrorBoundary.

### 5. Tests

- `frontend-new/tests/unit/stock.test.tsx`: mock api client → fixture → assert 10 líneas + fórmula cierra.
- `frontend-new/tests/unit/pedidos.test.tsx`: mock api client → fixture → assert cards + modal.
- `frontend-new/tests/e2e/pilot.spec.ts`: Playwright smoke con `test.describe.skip` (queda sintáctico; requiere emulators para correr real).

### 6. Mediciones CWV

- Script `scripts/perf/measure-vitals-app2.js` ya existe (del scaffold). Documentar en README del `frontend-new` cómo correrlo:
  - `npm run build && npm run preview`.
  - `node ../scripts/perf/measure-vitals-app2.js http://localhost:4173/app2/stock`.
- Reportar LCP/INP/CLS en el PR body si es posible; si no, dejar comando listo para Mariano.

### 7. ADR + documentación

- Crear `docs/adr/0013-piloto-solo-lectura-stock-pedidos.md` (status Accepted) con sección "Implementación piloto P1.6".
- Agregar fila en el índice de `docs/adr/README.md`.
- README dentro de `frontend-new/` con instrucciones de desarrollo local.

## Gate ejecutable

```
# Desde frontend-new/
npm install            # si no está
npm run biome:check    # clean
npm run typecheck      # tsc --noEmit
npm run test           # vitest (unit)
npm run build          # vite build
ls -lh dist/assets/    # verificar bundle < 150 KB + rutas < 50 KB gzipped
```

## Checklist Pre-PR

- [ ] `biome check` clean.
- [ ] `tsc --noEmit` clean.
- [ ] `npm run test` del frontend-new verde.
- [ ] Bundle gzipped < 150 KB shell + < 50 KB rutas.
- [ ] ADR-013 actualizado.
- [ ] PR body con test plan + comandos CWV para Mariano.

## Impacto conocido

- **Zero** impacto en prod (nada se deploya, es subdir aislado `frontend-new/`).
- **Zero** cambios en `index.html`, `functions/`, `src/domains/`, `firestore.rules`, bundles del app1, SW del app1.
- El `backend-new` (PR #1477) no está deployado todavía; el piloto apunta a `localhost:8080` por default (Mariano lo levanta local para probar).
