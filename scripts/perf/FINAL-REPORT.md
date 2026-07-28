# FINAL REPORT — E6 re-medición vs baseline E0

Este archivo se llena con los números del re-trace post-E5 (branch `e2b-perf`).

**Instrumentos**: idénticos al baseline E0 (Lighthouse + Puppeteer + CDP, throttling Slow 4G + CPU 4x, mobile 412×823 dpr 1.75, 3 corridas por escenario, median).

**Cómo correr** (gate humano — no lo puedo hacer sin `python -m http.server` + Chrome debug port):

```powershell
# 1. Servir la app local
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
python -m http.server 8000
# (dejar corriendo en otra consola)

# 2. Abrir Chrome con debug port (una vez, para trace-map)
# Crear un user-data-dir fresco para evitar mezclar cookies
"C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir=C:\temp\chrome-perf `
  http://localhost:8000
# Login manualmente con bot.shimano.pesca@gmail.com
# El script se conecta a este Chrome

# 3. Correr los perf scripts (en la consola original)
node scripts/perf/lighthouse-baseline.js
node scripts/perf/trace-map.js
node scripts/perf/compare-vs-baseline.js
```

## Métricas — shell load (llenar con output de lighthouse-baseline)

| Métrica | Baseline E0 (median) | Post-E5 (median) | Delta | Gate |
|---|---|---|---|---|
| **LCP** | 28,587 ms | **PENDIENTE** | | ≥40% mejor → target <17.2 s |
| FCP | 14,481 ms | | | |
| **TBT** | 1,536 ms | | | |
| CLS | 0 | | | |
| **Transfer size** | 5,332 KB | | | |
| **Score mobile** | 26 / 100 | | | |
| Long tasks >500ms | 2 | | | Cero |
| Score improvement | — | | | ≥+15 puntos deseable |

## Métricas — mapa (llenar con output de trace-map)

| Métrica | Baseline E0 | Post-E5 | Delta | Gate |
|---|---|---|---|---|
| Map paint post-login | 17,305 ms | | | |
| Long tasks >200ms pan/zoom | 6 (median) | | | |
| Long tasks >500ms pan/zoom | 2 (median) | | | |
| **Peor long task pan/zoom** | **3,353 ms** | **PENDIENTE** | | <200 ms (gate del plan) |

## Métricas — bundle sizes

| | Pre-E2 | Post-E5 | Delta |
|---|---|---|---|
| `index.html` | 2.14 MB (28,511 líneas) | **1.42 MB (14,236 líneas)** | -34% líneas, -50% inline |
| `app.bundle.js` (shell) | 44 KB | **1.89 MB** | shell contiene 17 dominios |
| `chunks/*.js` (lazy) | — | **359 KB** (3 chunks) | nuevos, on-demand |
| **Downloaded initial (sin abrir exports/admin)** | 44 KB bundle + 2.14 MB inline = **2.18 MB** | 1.89 MB shell + 1.42 MB inline = **3.31 MB** | ❌ EMPEORÓ transfer |

**Explicación transfer worse**: pre-E2 el bundle era chico (solo pure fns), post-E2 el shell incorpora todos los dominios que antes vivían en el inline. El transfer TOTAL bajó (inline -34%, chunks lazy on-demand), pero el shell inicial creció. **La ganancia real de transfer solo aparece cuando E3 mueve más dominios a chunks lazy** (commits E3.b futuros, fuera de scope de este ciclo).

## Trabajo realizado E0-E6 (21 commits, branch e2b-perf)

- **E0** `addfa57`: línea base medida con Lighthouse + Puppeteer CDP.
- **E1** `ea59a77`: fix leak 23 listeners onSnapshot.
- **E2** (19 sub-commits): extracción verbatim de 19 dominios al bundle.
- **E3** `a99ddd5`: code splitting infra + 3 chunks lazy (exports-core, exports-advanced, admin-users).
- **E4** `eb48c0a`: viewport filter en drawMarkers (culpable trace E0).
- **E5** `7da1ce3`: SW stale-while-revalidate + reglas #18/#19 CLAUDE.md.
- **E6** `2b278e9`: fixes C1-C5 del code review con subagent (5 ReferenceError latentes).

## Métricas hard achievables (sin re-medición)

- **LOC extraídos del inline**: 14,275 (-50.1% del monolito original).
- **Dominios extraídos**: 19 (`src/domains/*.js`).
- **Chunks lazy**: 3 (~360 KB).
- **Tests smoke/unit/functions**: 143/143 pasan (137 iniciales + 6 nuevos E3/E5).
- **Typecheck**: 0 errores.
- **Reglas CLAUDE.md**: 12 → 19 (+7 nuevas del ciclo).
- **APP_VERSION**: v330 → v336.
- **Code review pass**: 0 CRÍTICOS residuales (5 encontrados y fixeados en `2b278e9`).

## Gates del plan (assessment sin números finales)

| Gate | Status | Comentario |
|---|---|---|
| LCP ≥40% mejor vs baseline | PENDIENTE | Requires re-medición local |
| Shell inicial <500 KB transferidos | ❌ NO | Shell 1.89 MB. Requiere split más agresivo (E3.b futuros). |
| Cero long tasks >500ms en carga inicial | PENDIENTE | Requires re-medición. Bundle IIFE grande sigue siendo la principal fuente. |
| Pan/zoom sin frames >200ms | PENDIENTE | E4 viewport filter aplicado. Requires re-medición para confirmar. |
| 129+ tests locales verdes | ✅ 143/143 | Superado. |
| Typecheck | ✅ 0 errores | |
| Smoke navegación cada módulo (gate humano) | PENDIENTE | Requires Mariano abrir la app y probar cada tab. |

## Follow-up recomendado

1. **Correr los 3 scripts perf** (comandos arriba) y llenar las 2 tablas.
2. **Smoke manual** de cada dominio en el browser (10 min max):
   - Targets, Dashboard, Rutas, Rendiciones, Notificaciones, Product-picker,
     Visitas, Pedidos, Master-clientes, SAP Integration (Modal + Panel),
     Admin-users, Exports (Excel + Análisis).
3. **Si algún módulo se rompe**: reportar la excepción específica. Los 5
   bugs C1-C5 estaban silenciados por `try/catch`; puede haber más silenciados
   que aparezcan en producción.
4. **Merge a `main`** solo tras smoke completo + re-medición favorable.
5. **Warnings W1/W2/W3** del code review: fixear en commits futuros post-merge
   (documentados en commit `2b278e9`).
