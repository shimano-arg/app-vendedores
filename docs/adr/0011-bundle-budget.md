# ADR-0011: Budget formal de bundle size

- **Status**: Accepted (2026-11-25).
- **Decididores**: Mariano (owner técnico).
- **Supersede**: CLAUDE.md §16 (techos subidos ad-hoc durante E2) — ahora formalizado.
- **Relacionado**: ADR-002 (modularización progresiva).

## Contexto

Estado actual del bundle (medido 2026-11-25 contra `main`):

- `app.bundle.js` (shell): **3.187.755 bytes (~3,04 MB)** — incluye sourcemap inline.
- `chunks/*.js` (lazy, 11 chunks):
  - `exports-core.js`: 292 KB.
  - `exports-advanced.js`: 244 KB.
  - `exports-reparto.js`: 119 KB.
  - `forecast.js`: 242 KB.
  - `notificaciones.js`: 199 KB.
  - `dashboard-ventas.js`: 127 KB.
  - `admin-users.js`: 119 KB.
  - `panel-control.js`: 100 KB.
  - `cartera-vendor.js`: 77 KB.
  - `meli.js`: 63 KB.
  - `pedidos-del-mes.js`: 47 KB.
  - Total chunks: **~1,55 MB**.

Historial del techo (CLAUDE.md §16):

- Pre-E2: 44 KB (10 pure fns + sap + sentry).
- Post-E2.h: 224 KB → techo subido a 500 KB.
- Post-E2.f (rutas): 537 KB → techo subido a 1.500 KB.
- v732 (2026-08-29): techo subido 2,5 MB → 3 MB (3 schemas ML).
- v744 (2026-08-30): techo subido 3 MB → 3,5 MB (dark mode + leaflet tiles).

El techo se subió **ad-hoc** en cada expansión, sin presupuesto formal por chunk.

Smoke test actual (`tests/smoke/bundle-runtime.test.js`) ya valida:

- `app.bundle.js` en rango [20 KB, 3,5 MB].
- Cada chunk lazy en rango [1 KB, 400 KB].

Falta formalizar el budget como ADR + gate CI explícito + script medidor reusable.

## Decisión

### Presupuestos

| Asset | Budget | Hoy | Margen |
|---|---|---|---|
| `app.bundle.js` | **3,5 MB** (raw) | 3,04 MB | 15% |
| Cada `chunks/<nombre>.js` | **400 KB** (raw) | max 292 KB | 27% |
| Chunks total agregado | **2 MB** (raw) | 1,55 MB | 23% |

Budgets expresados en **bytes raw** (archivo en disco), no gzip. Motivo: raw es más fácil de medir determinísticamente, y el smoke test ya lo usa.

### CI gate

1. `scripts/ci/bundle-size-check.js` lee `app.bundle.js` + `chunks/*.js`, compara contra budgets, exit 1 si excede.
2. Workflow `Test & Lint` corre el script después de los tests. Falla el PR si excede.
3. Si un PR legítimo necesita subir el budget, se cambia la constante en `bundle-size-check.js` + se documenta la razón en el PR + se bumpea esta ADR con la nueva fila en la tabla de historial.

### Exclusiones

- No se mide `index.html` acá (ADR separado en el futuro; hoy baja progresivamente a medida que E2 sigue).
- No se mide `styles/*.css` (poca variabilidad; <50 KB).
- No se mide gzip hoy — se puede agregar después si hace falta medición más realista.

### Reducción histórica

Candidato para `docs/metrics/bundle-size.md` en el futuro. No es parte de este PR.

## Consecuencias

### Positivas

- Gate explícito contra drift silencioso.
- Un PR que agrega un dominio nuevo pesado ve el fallo en CI antes de merge.
- Documentación compartida de los budgets — team puede medir contra el mismo baseline.

### Negativas

- Si el budget está muy ajustado, PRs legítimos van a necesitar subir el budget + justificar.
- El budget es raw (no gzip) → cambios de minificación pueden cruzar el límite sin cambio real.

### Trade-offs aceptados

- No usamos Lighthouse CI (opción 3 de STACK_10 §ADR-011): setup frágil + Lighthouse local es inestable (STACK_00 §2.2). Queda post-ADR-006.
- No separamos "shell" vs "chunks lazy" como presupuestos distintos todavía porque el bundle sigue siendo semi-monolito. Cuando E3 avance más (chunks pedidos-full, waitlist-full, etc.), reevaluar.

## Verificación

Dos artefactos:

1. **Script CI**: `scripts/ci/bundle-size-check.js` — exit 0 si todo OK, exit 1 si excede. Imprime tabla de sizes.
2. **Workflow**: `.github/workflows/test-and-lint.yml` tiene un step que corre `node scripts/ci/bundle-size-check.js`. Falla el PR si excede.

Smoke test existente (`tests/smoke/bundle-runtime.test.js`) sigue cubriendo el range check. ADR-011 formaliza y agrega el gate CI explícito.

## Historial de presupuesto

| Fecha | app.bundle.js | chunks each | Motivo |
|---|---|---|---|
| 2026-07-28 | 200 KB | — | Pre-E2 baseline (§16). |
| 2026-07-28 (post-E2.h) | 500 KB | — | 3 dominios extraídos (§16). |
| 2026-07-28 (post-E2.f) | 1.500 KB | — | Rutas extraídas (§16). |
| 2026-08-29 (v732) | 2.500 KB | — | 3 schemas ML. |
| 2026-08-30 (v744) | 3.000 KB → 3.500 KB | 400 KB | Dark mode + leaflet dark tiles. |
| 2026-11-25 (ADR-011) | **3.500 KB** | **400 KB** | Formalización + CI gate. |

## Referencias

- CLAUDE.md §16 — historia del techo del smoke test.
- CLAUDE.md §18 — chunks lazy nuevos requieren 3 lugares sincronizados.
- CLAUDE.md §19 — stale-while-revalidate para assets locales.
- `tests/smoke/bundle-runtime.test.js` — range check existente.
- STACK_10 §ADR-011 — propuesta original y opciones consideradas.
