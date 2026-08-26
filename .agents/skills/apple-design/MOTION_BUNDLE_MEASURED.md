# motion npm — bundle size medido (real, no estimado)

**Fecha**: 2026-08-26
**Version medida**: `motion@13.1.1`
**Metodo**: `npm pack motion@13.1.1` + bundle real con `esbuild --bundle --minify --format=esm --target=es2020` usando `animate` real (no dead-code), luego `gzip -c | wc -c`.

## Numeros reales

| Entry point | Raw | Gzipped | Delta bundle actual (643.9 KB gz) |
|---|---|---|---|
| `motion` (full: springs + drag + gestures + layout) | 62 KB | **22.8 KB** | +3.5% (666.7 KB) |
| `motion/mini` (subset: `animate` + `animateSequence`) | 7.7 KB | **3.1 KB** | +0.5% (647.1 KB) |

## Recomendacion segun cobertura de la skill

**`motion/mini` (3.1 KB gz)** — probable candidato:
- Exports: `animate`, `animateSequence`
- Bundle contiene tokens `spring` y `velocity` → tecnicamente soporta el nucleo que necesitamos (secciones 4/5 de la skill).
- Faltan drag gesture helpers, layout animations, y features de framer-motion pesadas. Todo eso ya lo estamos haciendo con Pointer Events + rAF puros.

**`motion` full (22.8 KB gz)** — solo si hace falta:
- Incluye `drag`/`gesture` helpers, layout animations, orchestration.
- Nuestros use cases: podemos manejar drag con Pointer Events y solo llamar `animate(...)` en el `pointerup` para el spring final. NO necesitamos framer drag.

## Decision propuesta

**Instalar `motion/mini`** (3.1 KB gz, +0.5% bundle) para cubrir §4 (springs) y §5 (velocity handoff) sin agregar peso irrelevante.

Si en la practica descubrimos que necesitamos algo especifico de full (ej: `inView`, `layoutAnimate`), sumamos delta sabiendo el costo (~20 KB gz adicionales).

## Riesgo evaluado

- Bundle actual: 643.9 KB gz — grande pero servido con SW cacheado, primer load lento (medido con Lighthouse en session #380 fue ~4s en 4G).
- +3.1 KB gz sobre 643.9 KB = imperceptible en 4G (< 20ms mas de transferencia con throughput medio).
- +22.8 KB seria ~100ms mas en 4G. Aceptable pero no gratis.

## Metodologia de medicion (reproducible)

```bash
# Verificar que la medicion no cambio con nueva version:
mkdir _probe && cd _probe
npm pack motion@X.Y.Z
tar -xzf motion-*.tgz
mkdir test && cd test
echo "import { animate } from 'motion/mini'; document.body.addEventListener('click', () => animate('#foo', {y: 100}, {type: 'spring', bounce: 0.2}));" > use.js
npx esbuild use.js --bundle --minify --format=esm --target=es2020 --outfile=b.js
gzip -c b.js | wc -c  # numero real gzipped
```
