# scripts/perf/

Instrumentos para medir performance de la app. Baseline vive en `baseline-*-<tag>.json` y se compara con `compare-vs-baseline.js`.

**Contexto**: E2.b performance + code splitting (plan `majestic-seeking-avalanche`). Estos scripts son el gate de todo lo demás — sin números, no hay ranking real de culpables.

## Setup una única vez

1. Chrome instalado en `C:\Program Files\Google\Chrome\Application\chrome.exe` (o setear `CHROME_PATH` env).
2. `npm install` en el root del repo instala `lighthouse` + `puppeteer-core` (devDeps, agregados en E0).
3. **Servidor local** para servir la app: en otra consola PowerShell desde el repo root:
   ```powershell
   python -m http.server 8000
   ```
   Los scripts asumen `http://localhost:8000/`.

## Escenarios medidos

### (a) Shell load — `lighthouse-baseline.js`

Lighthouse programático, `RUNS_PER_SCENARIO=3` corridas + mediana. Mide desde `navigate` hasta LCP, sin login (Lighthouse no automatiza OAuth). Cubre: splash + login screen.

Config throttling: Slow 4G (150 kbps up / 1.6 Mbps down / 150ms RTT) + CPU 4x slowdown. Emula mobile 412x823.

Emite `baseline-shell-<tag>.json` con: LCP, FCP, TTI, TBT, CLS, transferSize, performance score, long tasks list, main thread work breakdown, bootup time por script.

```powershell
node scripts/perf/lighthouse-baseline.js
# → baseline-shell-2026-07-27.json
```

### (b) Map paint + (c) Pan/zoom — `trace-map.js`

Puppeteer + CDP tracing. Requiere login real. **Google OAuth detecta browsers automatizados de Puppeteer y bloquea el login** → solución: script conecta a Chrome NORMAL del user via `--remote-debugging-port`, el user hace el login manualmente en su Chrome normal.

**Flow completo**:

1. Cerrar TODAS las ventanas de Chrome normales.
2. Launchar Chrome desde PowerShell con debug port:
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
     --remote-debugging-port=9222 `
     --user-data-dir="C:\temp\perf-chrome"
   ```
   El `--user-data-dir` en otro path evita conflictar con el profile normal.
3. Ese Chrome abre. Navegar a `http://localhost:8000/`.
4. Loggearse normal con Google — funciona porque es Chrome real, sin `navigator.webdriver=true`.
5. Cuando ves el mapa de Argentina, correr en la consola del script:
   ```powershell
   node scripts/perf/trace-map.js
   ```
6. Script conecta al puerto 9222, busca el tab con `localhost:8000`, ejecuta 3 corridas × 2 escenarios (map paint + pan/zoom). Chrome queda abierto (script solo hace disconnect).

Escenarios:
- **(b) Map paint inicial**: tiempo desde `page.reload()` hasta `[outlines] cache built` en console.
- **(c) 3 pan+zoom secuenciales**: mouse drag + wheel programático con throttling 4G + CPU 4x aplicado via CDP. Trace CDP captura long tasks > 50ms, worst frame time (>200ms es el gate final).

Emite `baseline-map-<tag>.json` con métricas + top 20 long tasks.

**Env vars**: `DEBUG_PORT` (default 9222) override si tenés algo más corriendo ahí.

## Compare — `compare-vs-baseline.js`

Diff numérico + gate assertion (LCP shell ≥40% mejor). Uso en E6 (post code-splitting):

```powershell
# Correr los baselines con tag distinto
$env:BASELINE_TAG = "post-e6"
node scripts/perf/lighthouse-baseline.js
node scripts/perf/trace-map.js
Remove-Item env:BASELINE_TAG

# Diff
$env:CURRENT_TAG = "post-e6"
node scripts/perf/compare-vs-baseline.js
```

Exit code 1 si el gate falla.

## Notación

- **Corrida** = una ejecución del script. Por script: 3 corridas por escenario.
- **Escenario** = una situación medible (shell, map paint, pan/zoom).
- **Baseline** = snapshot de un momento (`2026-07-27` = pre-E1). Los `<tag>` distinguen: `2026-07-27` (pre-E1), `post-e1` (después de fix listeners), `post-e6` (final).

## Env vars

| Var | Default | Notas |
|---|---|---|
| `CHROME_PATH` | auto-detect Windows | Override si Chrome está en otra ruta |
| `BASELINE_TAG` | `2026-07-27` | Sufijo del filename output |
| `CURRENT_TAG` | `post-e6` | Solo para `compare-vs-baseline.js` |

## Riesgos y limitaciones documentados

- **Lighthouse throttling ≠ 4G real**: emulación predictiva. Útil para comparativa antes/después, no para número absoluto.
- **Chromium headless en Lighthouse ≠ Chrome real**: diferencias sutiles en cold start.
- **Puppeteer trace incluye overhead del profiling**: números absolutos infladas, pero relativos válidos.
- **Servidor local `python http.server` ≠ GH Pages**: sin gzip/brotli, sin HTTP/2, sin cache headers. Transfer size es mayor que prod.
- **1 usuario logueado ≠ 6 vendedores concurrentes**: los tests no cubren carga concurrente en Firestore.

## Archivos que genera

Todo dentro de `scripts/perf/`, gitignored (no queremos ensuciar el repo con reportes de múltiples corridas). El `baseline-shell-2026-07-27.json` sí se puede commitear como "baseline oficial" de E0 — ver `.gitignore`.

- `baseline-shell-<tag>.json` — Lighthouse output
- `baseline-map-<tag>.json` — Puppeteer trace output
- `perf-chrome-profile/` — user data dir persistente para OAuth (gitignored)
