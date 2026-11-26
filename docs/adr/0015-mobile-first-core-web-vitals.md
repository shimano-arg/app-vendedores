# ADR-0015: Mobile first + Core Web Vitals como criterios de aceptación por pantalla

- **Status**: Accepted (2026-11-26).
- **Decididor**: Mariano (owner técnico).
- **Fecha decisión**: 2026-11-26 11:25 ART.
- **Supersede**: ninguno — formaliza una expectativa ya implícita (CLAUDE.md §106 patrón pill mobile + apple-design §21).
- **Relacionado**: ADR-004 (frontend React), ADR-011 (bundle budget), ADR-013 (piloto solo lectura).

## Contexto

La app se usa **100% desde celular** (CLAUDE.md §21). Hoy no hay baseline cuantitativa de performance mobile por pantalla — las decisiones de UX pasan por "le pregunto a un vendedor" o "me parece lento". El equipo no tiene manera de comparar objetivamente antes/después de un cambio.

Google formalizó Core Web Vitals (CWV) como estándar — tres métricas que correlacionan con la percepción del usuario:

- **LCP (Largest Contentful Paint)**: tiempo hasta que el elemento visualmente más grande termina de pintar. Mide "cuándo parece cargada la pantalla".
- **INP (Interaction to Next Paint)**: latencia desde tap/click hasta próximo frame visible. Mide "cuán fluida se siente la interacción". Reemplazó FID en 2024.
- **CLS (Cumulative Layout Shift)**: suma de desplazamientos inesperados del layout. Mide "qué tanto se mueve la pantalla mientras cargo".

## Decisión

Toda pantalla nueva (empezando por el piloto ADR-013) debe cumplir los siguientes **thresholds mobile** antes del merge:

| Métrica | Threshold "bueno" | Threshold "aceptable" | Fail |
|---|---|---|---|
| LCP | ≤ 2.5 s | ≤ 4.0 s | > 4.0 s |
| INP | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |

**"Aceptable"** se permite temporalmente con justificación en el PR body + ticket de follow-up. **"Fail"** bloquea merge.

### Device + condiciones de medición

- **Device emulado**: "Moto G Power" en Chrome DevTools (4× CPU throttle, 1.6 Mbps down, 750 Kbps up, 150 ms RTT — equivalente a 4G lento promedio en zonas no-urbanas de Argentina).
- **Device real** (para validación final): un smartphone Android mid-range del equipo de ventas (Samsung A54 o similar) en red móvil real.
- **3 corridas** por PR, el valor reportado es la **mediana** (patrón §11 tolerante a corridas fallidas).

### Herramientas

- **Lighthouse CI** (GitHub Action `treosh/lighthouse-ci-action`) corre en cada PR de pantalla nueva.
- **web-vitals** library (ya integrada en el bundle actual via instrumentation) para RUM — mide usuarios reales en producción.
- Reporte CWV semanal: `scripts/audit/E3_cwv_report.cjs --days=7 --full` (ya existe, se corre post-18:00 ART cada día).

### Mobile first obligatorio

- Diseño parte de **360×640 (iPhone SE legacy)** como mínimo soportado.
- Breakpoints up: 640px, 768px, 1024px, 1280px. Desktop es "mejora progresiva", no target principal.
- Touch targets ≥ 44×44 CSS px (Apple HIG + WCAG 2.5.5).
- Viewport meta: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- `prefers-reduced-motion` respetado (CLAUDE.md §21 punto 10).
- Formularios: inputs con `inputmode` + `autocomplete` apropiados (tipo numérico abre teclado numérico).

### Bundle budget

Complementa ADR-0011 (bundle budget general):

- **Shell React**: ≤ 150 KB gzipped (React + ReactDOM + router + react-query + shell chrome).
- **Por ruta**: ≤ 50 KB gzipped (componentes específicos de pantalla, excluyendo vendor shared).
- **Imágenes**: AVIF primario con fallback WebP. Nunca PNG/JPG grandes sin `<picture>` + `loading="lazy"`.

### PR template adiciones

Cada PR que agrega/modifica una pantalla React debe incluir en el body:

```
## CWV baseline
- Ruta: /app2/<ruta>
- Device: Moto G Power (emulado) / 4G
- LCP: <medido> s (threshold 2.5 s)
- INP: <medido> ms (threshold 200 ms)
- CLS: <medido> (threshold 0.1)
- Bundle de ruta: <medido> KB gzipped (budget 50 KB)
- 3 corridas, mediana. Link al Lighthouse CI run: <url>
```

## Consecuencias

### Bueno

- Baseline cuantitativa de performance → decisiones informadas.
- Fricción explícita si un dev quiere agregar una pantalla pesada.
- CWV Google-standard → aprovecha herramientas (Lighthouse, Search Console, PageSpeed Insights) sin inventar nada.
- Mobile first elimina reclamos recurrentes del equipo ("no entra en mi celular", "el botón es chico").

### Malo

- Requiere setup inicial de Lighthouse CI + web-vitals wiring (1 PR dedicado, ~4 horas).
- Puede bloquear merges si una pantalla cae por un vendor pesado agregado por accidente (ej. Chart.js). Trade-off aceptable — justamente eso buscamos.
- Measurement en dispositivo real es manual (no automatizable 100%) — toca al dev del PR.

### Lo que NO cambia

- Pantallas vanilla actuales (index.html) no están obligadas retroactivamente — la medición empieza con el piloto ADR-013. Las vanilla pueden mejorar oportunamente.
- Rules Firestore.
- Backend contracts (ADR-014).

## Alternativas evaluadas

1. **Solo medir LCP** (ignorar INP y CLS). Rechazado — INP correlaciona mejor con percepción de "fluidez" en una app operativa. CLS baja frustración de usuarios que tapean el botón equivocado por reflow.
2. **Thresholds desktop + mobile combinados**. Rechazado — desktop es minoría, enfoque claro en mobile first.
3. **Solo RUM (producción) sin lighthouse CI**. Rechazado — RUM mide usuarios reales pero el feedback loop es días. Lighthouse en CI atrapa regresiones antes del merge.

## Verification

- `.github/workflows/lighthouse-ci.yml` nuevo (PR dedicado post-ADR).
- Audit test `tests/unit/audit/cwv-pr-template.test.js`: si la label `pantalla-nueva` está presente en el PR, el body debe incluir el bloque "CWV baseline".
- Script `scripts/audit/cwv_baseline_report.cjs --days=7` genera el reporte semanal (ya existe como `E3_cwv_report.cjs`, se extiende).

## Rollback

Si los thresholds resultan demasiado estrictos para el stack elegido:

1. Primero: ajustar thresholds (ej. LCP 3.0 s en vez de 2.5 s) con PR dedicado + justificación.
2. Después: si siguen bloqueando, considerar que el stack frontend (ADR-004) no es adecuado — pero eso es un ADR separado.

El CI gate se puede desactivar temporalmente editando el workflow — nunca con `continue-on-error: true` (prohibido por regla S-9/S-10).
