# ADR-0015: Mobile-first + Core Web Vitals en el frontend nuevo

- **Status**: Accepted (2026-11-26).
- **Decididores**: Mariano (owner técnico).
- **Relacionado**: ADR-004 (stack), ADR-011 (bundle budget), ADR-013 (piloto solo-lectura).

## Contexto

Los vendedores usan el CRM 100% desde celular. El CRM legacy evolucionó mobile-first ad-hoc (CLAUDE.md §21 apple-design) sin presupuesto formal de métricas. El frontend nuevo (ADR-004) tiene oportunidad de arrancar con targets explícitos.

Device de referencia (del parque real de vendedores 2026):

- **Moto G Power** (o equivalente Android gama media-baja): 6GB RAM, Snapdragon 662, display 720×1600.
- **Red 4G Argentina**: ~1.5 Mbps down, 150ms RTT (percentil 50 según Cloudflare Radar + reports de Mariano).

## Decisión

Targets Core Web Vitals (median de 3 corridas, Moto G Power equivalente + 4G throttle):

| Métrica | Target | Rationale |
|---|---|---|
| LCP | ≤ 2.5s | Umbral `good` de web-vitals. Experiencia aceptable en 4G. |
| INP | ≤ 200ms | Umbral `good`. Respuesta táctil sin "lag" percibido. |
| CLS | ≤ 0.1 | Umbral `good`. Zero CLS en la primera vista es objetivo (skeleton reserva espacio). |

Targets secundarios informativos:

- FCP ≤ 1.8s
- TTFB ≤ 800ms

### Técnicas obligatorias

1. **Skeleton inline en `index.html`** con mismo alto que el header real → zero CLS en el mount React.
2. **Chunks lazy por ruta** (ADR-011 por-ruta ≤ 50 KB gzipped) → shell inicial liviano.
3. **Fuentes del system stack** (`-apple-system, BlinkMacSystemFont, ...`) → zero FOIT, zero network.
4. **`prefers-reduced-motion` respetado** en todas las animaciones (CLAUDE.md §21 §14).
5. **Touch targets ≥ 44×44 px** en nav + botones (CLAUDE.md §106).
6. **`web-vitals` library** reportando a `console.log` (P1.5) → `/api/metrics/cwv` (P1.6).

### Técnicas opt-in (no obligatorias pre-P1.6)

- Preload/prefetch de chunks de ruta visible.
- Service worker con stale-while-revalidate (CLAUDE.md §19).
- Image lazy loading nativo (`loading="lazy"`) cuando aparezcan imágenes.

### Medición

`scripts/perf/measure-vitals-app2.js` (Puppeteer + CDP throttling):

- 3 corridas, tolerante a 1 fallo (CLAUDE.md §11).
- CPU 4× + Network 1.5 Mbps / 750 kbps / 150ms (preset Moto G Power ~ ADR).
- Output JSON compatible con lighthouse-ci.
- Exit code 2 si algún target duro (LCP/INP/CLS) se excede por la median.

## Consecuencias

### Positivas

- Targets explícitos → PR puede fallar si se degradan.
- Baseline temprano (P1.5) permite detectar regresiones en P1.6+.
- Mobile-first forzado desde la primera iteración.

### Negativas

- Scripts de medición en Windows con Puppeteer pueden ser flaky (ver CLAUDE.md §10 CDP timeouts). Mitigación: tolerante a 1 fallo + usar `page.evaluate` para dispatch events bajo throttling.
- Device real de vendedores varía. "Moto G Power" es proxy; el target real es consistencia con web-vitals thresholds.

## Verificación

- `scripts/perf/measure-vitals-app2.js` corre contra el preview. Exit 0 si todos los targets pasan.
- CI (`.github/workflows/frontend-ci.yml`) corre el script en P1.6 como gate blocking.
- Spot checks manuales en Moto G Power real al menos 1× por release mayor.

## Referencias

- [web.dev/vitals](https://web.dev/vitals) — definición de LCP / INP / CLS.
- CLAUDE.md §10 — CDP throttling + dispatch events desde `page.evaluate`.
- CLAUDE.md §11 — scripts tolerantes en environment inestable.
- CLAUDE.md §19 — stale-while-revalidate (reservado para P1.6+).
- CLAUDE.md §21 — interacciones gestuales via `apple-design` skill.
- ADR-004 — stack.
- ADR-011 — bundle budget.
- ADR-013 — piloto solo-lectura.
