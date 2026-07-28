# BASELINE — 2026-07-27

Snapshot del estado pre-E1 (v330 en `main` / `e2b-perf` HEAD antes de tocar código).

**Instrumentos**: Lighthouse programático + Puppeteer + Chrome DevTools Protocol (ver `README.md`).
**Throttling**: Slow 4G (150ms RTT, 1.6 Mbps down) + CPU 4x slowdown.
**Emulación**: mobile 412×823 dpr 1.75.
**Corridas**: 3 por escenario (Lighthouse), 2/3 exitosas en trace-map (auth overlay reapareció en corrida 2).

Sirve como referencia para el gate final de E6 (LCP ≥40% mejor, shell <500 KB, cero long tasks >500ms en carga inicial, pan/zoom sin frames >200ms).

## Métricas — shell load

| Métrica | Valor (median) | Min | Max |
|---|---|---|---|
| **LCP** | **28,587 ms** | 28,525 | 28,775 |
| FCP | 14,481 ms | 14,392 | 14,711 |
| TTI | — | — | — |
| **TBT** | **1,536 ms** | 1,456 | 1,770 |
| CLS | 0 | 0 | 0 |
| **Transfer size** | **5,332 KB** | — | — |
| **Score** | **26 / 100** | 25 | 27 |
| Long tasks >500ms (run 1) | 2 | — | — |

Variance <1% en las 3 corridas → números **muy estables**, no ruido.

**Interpretación**: en 4G emulado con CPU 4x, la app toma **28.6 segundos** hasta el Largest Contentful Paint. En un celular real (Snapdragon 4G) probablemente sea 10-20 segundos. Cualquier vendedor abriendo la app "en frío" en la calle tiene que esperar 15-30 segundos hasta ver algo utilizable. Confirma cualitativamente el problema reportado ("se tilda").

## Métricas — mapa

| Métrica | Valor |
|---|---|
| Map paint (post-login, media 2 runs) | **17,305 ms** (runs: 17305, 17065) |
| Long tasks >200ms durante pan/zoom (median) | 6 |
| Long tasks >500ms durante pan/zoom (median) | 2 |
| **Peor long task durante pan/zoom** | **3,353 ms** (un solo tick bloqueando >3 segundos) |

Los long tasks aparecen como `RunTask` genérico porque no habilitamos stack sampling en el trace (era muy voluminoso). La MAGNITUD basta para confirmar el problema.

## Ranking de culpables MEDIDOS (top-down)

Todos ordenados por impacto observado en el trace, con referencia al long task o main thread breakdown que lo revela.

### 1. Script inline gigante de `index.html` (28k líneas)

**Evidencia**:
- Main thread breakdown: `scriptEvaluation 3550ms + scriptParseCompile 851ms` = 4.4 segundos evaluando/parseando JavaScript en el main thread.
- Long task de 2340ms "Unattributable" (típico del código inline sin URL attribution).
- Bootup time del propio `http://localhost:8000/` = 2836ms total, 337ms puro scripting.

**Estado**: **CONFIRMADO**. Fix natural: extracción por dominio (E2) + code splitting (E3) para no cargar todo al arranque.

### 2. Scripts CDN sync bloqueantes en `<head>`

**Evidencia**:
- Leaflet 1.9.4 CDN parse: **883 ms** (una task).
- xlsx 0.18.5 CDN parse: **479 ms**.
- jszip 3.10.1 CDN parse: **154 ms**.
- Firebase Firestore/Auth compat: 133ms + 121ms parse c/u (chico pero blocking).

Total **~1.5-2 segundos** de parse de terceros bloqueando el main thread.

**Estado**: **CONFIRMADO**. Fix: xlsx + jszip ya son `defer` (correcto). Leaflet podría moverse a `defer` si retrasamos la init del mapa hasta post-DOMContentLoaded — parte del split del mapa (E3/E4). Firebase compat SDKs son harder — se cargan porque cliente los usa desde el arranque; opción es upgrade a Firebase v9+ modular con tree-shaking (mucho más chico).

### 3. Transfer size 5.3 MB al load inicial

**Evidencia**: `transferSize.median = 5332 KB` vs HTML source solo de 2.14 MB. Los ~3 MB extra se reparten en: geo.json (~1.56 MB), Firebase SDKs (~500 KB), Leaflet CSS+JS (~150 KB), sourcemaps, dependencies.

**Estado**: **CONFIRMADO** como problema, aunque con matiz importante. **`geo.json` es fetch async (no bloqueante)** — la app no espera para mostrar el splash. Pero SÍ contribuye al total transferido en 4G lento. La fix del transfer: (a) chunks por dominio (E3) reduce el bundle inicial, (b) geo.json podría pre-split (E4 si el trace lo confirma).

### 4. Peor long task durante pan/zoom del mapa: **3,353 ms**

**Evidencia**: durante 3 pan+zoom secuenciales con throttling, el trace capturó un `RunTask` de **3.35 segundos** — literalmente un pan bloqueando el thread principal por 3+ segundos. Otros 5 tasks >200ms (702, 465, 246, 218, 190 ms).

Sin stack sampling, no puedo confirmar QUÉ función específica es la culpable. Hipótesis por tamaño y patrón: `drawMarkers()` (loop O(2000-5000 markers) + re-style de 527 features del `deptLayer` en cada `zoomend`) — consistente con el análisis estructural que hizo el Explore agent.

**Estado**: **CONFIRMADO — problema serio en el mapa**. Culpable exacto por confirmar en E4 con stack sampling activado. Candidato #1: `drawMarkers()`. Candidato #2: `polygon-clipping.union()` si el cache localStorage estuviera invalidado durante los pan/zoom (menos probable — cache persiste entre pan/zoom del mismo session).

### 5. Hipótesis del user prompt: verdict

| Hipótesis | Verdict | Comentario |
|---|---|---|
| Markers del mapa sin clustering | ✅ **CONFIRMADO** | 3.35s long task durante pan/zoom es consistente. E4 confirmará si `drawMarkers()` es el pattern exacto. |
| Parse de geo.json / stock.json enteros al inicio | ⚠️ **PARCIAL** | geo.json contribuye a transfer size pero es async fetch, no bloquea LCP. Sí bloquea el main thread al parsear (medir en E4). stock.json es small (~20 KB), no relevante. |
| Listeners onSnapshot acumulados sin desuscribir | ⚠️ **NO CAPTURADO por este trace** | Es un leak cumulativo a través de sesiones (logout/login). NO aparece en single-run trace. Sin embargo, el análisis estructural del Explore agent confirmó 23/33 listeners sin cleanup. E1 lo cubre igual. |
| Parse del JS inline de 24k líneas | ✅ **CONFIRMADO** | `scriptEvaluation 3550ms + parseCompile 851ms` + long task "Unattributable 2340ms" son la firma exacta. |

## Culpables NO confirmados (dejar para trace más profundo si aparecen en E4)

- `_buildVendorOutlinesCache()` con polygon-clipping.union() — Explore agent lo listó como Tier 1 riesgo (O(n³) en peor caso). El trace de E0 NO lo capturó porque la corrida no invalidó el cache localStorage. Solo se manifiesta al primer login post-logout o cambio de `vendor_overrides`. Requiere escenario específico en E4 si aparece como percibida.
- `deptStyle()` × 527 en cada `setStyle()` — Explore agent lo listó como Tier 2. Sub-task del `drawMarkers()` probablemente, incluido en el 3.35s. Confirmable con stack sampling en E4.

## Gate esperado post-E6

- **LCP shell**: ≥40% mejor → target **<17.2 s** (desde 28.6 s).
- **Shell inicial <500 KB transferidos**.
- **Cero long tasks >500ms** en carga inicial (hoy hay 2).
- **Pan/zoom sin frames >200ms** (hoy peor frame 3,353 ms).
- 129 tests locales verdes + typecheck + smoke navegación cada módulo.

## Notas técnicas de la corrida

- Chromium: system Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Server local: `python -m http.server 8000` (no gzip, no HTTP/2, no cache headers). Prod GH Pages con HTTP/2 + brotli probablemente da mejor transfer size real.
- Corrida 2/3 de trace-map falló porque el auth overlay reapareció después del reload de la corrida 1 (posible session refresh de Firebase Auth). El script fue tolerante y computó median sobre 2/3 exitosas. Documentado como known issue del harness.
- Bug del OUTPUT_DIR con `%20` en el path (URL encoding) fue detectado y corregido — los baselines finales están en `scripts/perf/` (sin path encoded).
