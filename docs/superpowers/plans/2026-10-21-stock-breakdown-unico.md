# Plan v1391 — Una sola fuente de verdad para el stock de un SKU en todas las pantallas

**Fecha**: 2026-10-21
**Autor**: Mariano (dirección) + Claude (ejecución planificada)
**Rama**: `feat-stock-breakdown-unico` desde `main` (`88e182c`, post-v1390)
**Metodología**: loop engineering (act → verify → re-prompt) con superpowers (`systematic-debugging` E0, `writing-plans` plan, `test-driven-development` E1-E2, `verification-before-completion` cada gate).

---

## 1. Problema observado

**Caso 21/10/2026 10:50, SKU CUDC201HG.** Cinco pantallas distintas muestran cinco números diferentes para el mismo SKU:

| Pantalla | Qué dice |
|---|---|
| Modal Backorder | 26 unidades, 3 clientes (REBORN 16, BROBRO 8, ANDRILI 2), estado PARCIAL. Subtítulo: "datos SAP cada 30 min". |
| Modal Reparto | 0 resultados para CUDC201HG. |
| Popup "Stock del SKU" (Master de productos) | Físico dep 11 = 7, tránsito dep 12 = 24, backorder = 11, asignado = 1, libre = 0. |
| Modal Pedido en espera (ORDEN 474, Cabrera) | Stock completo 7, reservadas 18 con badge "17 en BO", libre 0. |
| Modal Stock Asignado | 1 unidad (GRAUBERGER). |

Para el mismo SKU el back order vale **26, 17 u 11** según la pantalla. El usuario no puede saber cuál es el número real.

Esto es FINDING-04 de la auditoría del 20/10 (`docs/AUDIT_SHIMANO_2026-10-20.md`).

---

## 2. Objetivo

Que las 5 pantallas muestren el **mismo** número para cada concepto de un SKU, computado por una sola función pura:

```js
getStockBreakdown(sku, deps, opts)
```

con reglas de TTL centralizadas (`lineReservesStock` existente, reglas §36 / §37 / §38 de `CLAUDE.md`), labels de UI homogéneas y copia espejo en `functions/core/` sincronizada con test automático.

---

## 3. Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  src/pure/stock-breakdown.js                                │
│                                                             │
│  getStockBreakdown(sku, deps, opts)                         │
│     reusa lineReservesStock() de                            │
│     src/pure/stock-realmente-disponible.js (reglas TTL)     │
│     retorna { fisicoDep11, transitoDep12,                   │
│                demandaSapSinCubrir, backorderApp,           │
│                confirmadasSinFacturar, asignadas,           │
│                reservadasTotal, libre,                      │
│                utilizablePara(cardCode), pendienteReparto } │
└──────────┬──────────────────────────────────────────────────┘
           │
           ├─→ wrappers finos (compat con llamadores viejos)
           │     - getStockRealmenteDisponible → breakdown.libre
           │     - getStockDesglose → { fisico, comprometido, real, breakdown }
           │     - getStockPorCliente → breakdown.utilizablePara + porCli
           │     - getStockUtilizableParaClienteExAsig → breakdown.utilizablePara
           │     - computeHasExceed (v1389) → usa breakdown
           │
           ├─→ 5 pantallas lo consumen DIRECTO:
           │     1. Modal Backorder (2 tabs: SAP + app)
           │     2. Modal Reparto
           │     3. Popup Master Stock del SKU
           │     4. Modal Pedido en espera (celda Reservadas + tooltip + badge)
           │     5. Modal Stock Asignado
           │   + Sidebar mapa (card excedentes)
           │   + Reenrich pending (persistPendingEntry, doConfirmPedido)
           │
           └─→ copia espejo en functions/core/pedido-snapshot-core.js
               (tests/unit/audit/stock-breakdown-sync.test.js lo garantiza)
```

**Labels en UI**, exportadas desde la fn pura:

| Concepto | Label uniforme |
|---|---|
| `fisicoDep11` | Stock físico (dep 11) |
| `transitoDep12` | En tránsito (dep 12) |
| `demandaSapSinCubrir` | Demanda SAP sin cubrir |
| `backorderApp` | Back order (app) |
| `confirmadasSinFacturar` | Confirmadas sin facturar |
| `asignadas` | Asignadas |
| `reservadasTotal` | Reservadas |
| `libre` | Libre para la venta |
| `pendienteReparto` | Pendientes de reparto |

El Modal Backorder deja de llamarse solo "Backorder". Título: **"Backorder: demanda SAP sin cubrir"**. Dos pestañas: Demanda SAP (default) y Back order (app).

---

## 4. Etapas

### Etapa 0 — Explicar los 5 números (`systematic-debugging`)

**Objetivo**: mapear cada número con su `archivo:línea`, fuente de datos y semántica. Sin esto, la fn pura puede quedar incompleta.

**Files**:
- Create: `docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md`
- Script auxiliar: `scripts/audit/_dump_cudc_full.cjs` (read-only prod, imprime todo lo relevante de CUDC201HG)

**Acciones**:

1. Dispatch 2 agentes `Explore` en paralelo (una sola message con 2 tool_calls):
   - Breadth "quick": grep `data-sku="CUDC201HG"`, `backorderBySkuApp`, render del modal Backorder (`openBackorderModal`, `renderBackorderList`). Reportar `archivo:línea` + fuente del 26.
   - Breadth "medium": grep los 5 call-sites completos (Modal Reparto, Popup Master, Modal Pedido en espera, Modal Stock Asignado, sidebar mapa).

2. Script `_dump_cudc_full.cjs` imprime:
   - `pedidos` abiertos con línea CUDC201HG: `_fsId`, `clientCardCode`, `clientName`, `createdAt`, `confirmedAt`, `transferidoSAP.*`, `lines[].state`, `qtyOpen`, `asigAt`, `asigReserva`.
   - `app_config/stock_snapshot.warehouseBreakdown.CUDC201HG`.
   - `app_config/backorderBySkuApp.CUDC201HG` si existe (fuente probable del "26").
   - `ingresos_reparto` CUDC201HG (todos los status).

3. Correr `getStockDesglose('CUDC201HG')` desde script (con los deps reales) y comparar con las 5 pantallas.

4. Escribir informe con **tabla final**: Concepto | Valor | Fuente (colección/campo) | Función | archivo:línea. Más explicación textual de cada número (qué significa, qué incluye, con/sin TTL).

5. Verificar que el doc fantasma `XqBxRRu78WLwmZx0K6Gd` ya está `status='done'` (cerrado en el loop anterior 13:28 UTC). Si no, cerrarlo con el script ya creado `_close_cudc_migration.cjs`.

**Gate ejecutable**:
```bash
test -f docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md && \
grep -qE 'Modal Backorder' docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md && \
grep -qE 'Modal Reparto' docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md && \
grep -qE 'Popup Master' docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md && \
grep -qE 'Pedido en espera' docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md && \
grep -qE 'Stock Asignado' docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md && \
grep -qE 'archivo:' docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md && \
node scripts/audit/_inspect_cudc_fantasma.cjs 2>&1 | grep -q "status=done" && \
echo GATE_E0_OK
```

**Budget**: 10 turnos.

**Riesgos de falso verde**:
- "26 unidades" del Modal Backorder puede venir de **BigQuery** (vista `v_backorder_lineas_v2`) y no de Firestore. Si es BQ, no se puede reproducir con un fixture local — hay que marcarlo como "fuente externa" y pasarla como `deps.sapBackorderSnapshot` en E1.
- "17 en BO" de Pedido en espera puede sumar BO + confirmed + ASIG en vez de solo BO. Mitigación: comparar numéricamente contra `getStockDesglose` real desde el script.
- El snapshot de stock se refresca cada 30 min; Mariano reportó a las 10:50. Mitigación: congelar el snapshot del momento del dump en el informe (ISO timestamp al tope).

---

### Etapa 1 — getStockBreakdown pura + sync test (`test-driven-development`)

**Files**:
- Create: `src/pure/stock-breakdown.js`
- Modify: `functions/core/pedido-snapshot-core.js` (copia inline espejo; functions es standalone, no se puede importar de `src/pure`)
- Create: `tests/unit/stock-breakdown.test.js` (10+ tests)
- Create: `tests/unit/audit/stock-breakdown-sync.test.js` (como `ttl-sync.test.js`)

**API diseñada**:

```js
/**
 * @typedef {Object} PorClienteItem
 * @property {string} cardCode
 * @property {string} clientName
 * @property {number} qty
 * @property {string} [pedidoId]
 * @property {number} [lineIndex]
 * @property {string} [createdAt]
 * @property {boolean} [isStale]
 */

/**
 * @typedef {Object} StockBreakdown
 * @property {string} sku
 * @property {number} fisicoDep11
 * @property {number} transitoDep12
 * @property {{total:number, porCliente:PorClienteItem[]}|null} demandaSapSinCubrir
 * @property {{total:number, porCliente:PorClienteItem[]}} backorderApp
 * @property {{total:number, porCliente:PorClienteItem[]}} confirmadasSinFacturar
 * @property {{total:number, porCliente:PorClienteItem[]}} asignadas
 * @property {number} reservadasTotal
 * @property {number} libre
 * @property {(cardCode:string) => number} utilizablePara
 * @property {{qty:number, repartoId:string|null}} pendienteReparto
 * @property {number} _version
 */

export function getStockBreakdown(sku, deps, opts) { ... }

export const STOCK_LABELS = {
  demandaSapSinCubrir: 'Demanda SAP sin cubrir',
  backorderApp: 'Back order (app)',
  confirmadasSinFacturar: 'Confirmadas sin facturar',
  asignadas: 'Asignadas',
  reservadasTotal: 'Reservadas',
  fisicoDep11: 'Stock físico (dep 11)',
  transitoDep12: 'En tránsito (dep 12)',
  libre: 'Libre para la venta',
  pendienteReparto: 'Pendientes de reparto',
};
```

**TTL centralizado**: reutiliza `lineReservesStock(line, now, pedido)` del mismo archivo (ya tiene §37 BO 90d + §38 confirmed 60d + §36 guard). No duplica reglas.

**Acciones (TDD estricto)**:

1. RED: tests invariante en `tests/unit/stock-breakdown.test.js`:
   ```js
   it('reservadasTotal == backorderApp + confirmadasSinFacturar + asignadas', ...);
   it('libre == max(0, fisicoDep11 - reservadasTotal)', ...);
   it('pendienteReparto.qty == max(0, fisicoDep11 - asignadas - confirmadas) si BO>0, else 0', ...);
   it('utilizablePara(cardCode) == libre + reservasPropias (fórmula §33/§35)', ...);
   it('schema shape: todos los buckets conocidos en Object.keys()', ...);
   it('TTL: BO 95d NO cuenta (red §37) ; BO 30d SI cuenta (§37)', ...);
   it('TTL: confirmed 30d NO cuenta ; confirmed 3d SI cuenta', ...);
   it('TTL: ASIG 30d NO cuenta ; ASIG 3d SI cuenta', ...);
   it('demandaSapSinCubrir=null si no hay sapBackorderSnapshot (deps opcional)', ...);
   it('fixture CUDC201HG = {fisico:7, BO:11, asig:1, confirmed:0, libre:0, pendienteReparto:6}', ...);
   ```

2. Run → fallan (RED).

3. Implementar `getStockBreakdown` reusando `lineReservesStock` + helpers internos.

4. Run → pasan (GREEN).

5. Copiar fn a `functions/core/pedido-snapshot-core.js` (sin `utilizablePara` si no se usa server-side — igual mejor copiar completa).

6. Test sync `tests/unit/audit/stock-breakdown-sync.test.js`: parsea los 2 archivos, compara que todos los conceptos aparezcan en ambos.

7. LF normalize + biome write.

**Gate ejecutable**:
```bash
npx vitest run tests/unit/stock-breakdown.test.js --reporter=default 2>&1 | tee /tmp/e1.txt | tail -5 && \
grep -qE "Tests  10 passed" /tmp/e1.txt && \
npx vitest run tests/unit/audit/stock-breakdown-sync.test.js --reporter=default 2>&1 | tail -5 | grep -q "passed" && \
npx vitest run 2>&1 | tee /tmp/e1-full.txt | tail -5 && \
FAIL=$(grep -oE "Tests +[0-9]+ failed" /tmp/e1-full.txt | grep -oE "[0-9]+" || echo "0") && \
[ "$FAIL" = "1" ] && \
grep -q "rechaza assignment que no matchea con ningun cliente BO" /tmp/e1-full.txt && \
echo GATE_E1_OK
```

**Budget**: 14 turnos.

**Riesgos de falso verde**:
- Test invariante no cacha un bucket nuevo si se agrega sin tocar el test. Mitigación: schema check — `Object.keys(breakdown)` ordenados comparados contra lista fija; agregar bucket requiere actualizar la lista.
- Fórmula `pendienteReparto` compite con la de `reconcileRepartosFaltantes` en `functions/core/reparto-core.js`. Mitigación: `reconcileRepartosFaltantes` queda usando `lineReservesStock` directo; `pendienteReparto` del breakdown es solo para display. Diferencia documentada en el JSDoc.
- `utilizablePara` duplica semántica de `getStockPorCliente` + `getStockUtilizableParaClienteExAsig`. Mitigación: en E2 las 2 fns viejas pasan a wrappers.

---

### Etapa 2 — Refactor call-sites + labels homogéneas (`test-driven-development` + `silent-failure-hunter`)

**Files (varios)**:

- Modify `src/pure/stock-realmente-disponible.js`:
  - `getStockRealmenteDisponible` → `return getStockBreakdown(sku, deps, opts).libre;`
  - `getStockDesglose` → wrapper que mapea al shape viejo (`{fisico, comprometido, real, breakdown}`).
  - `getStockPorCliente` → wrapper con `utilizablePara(cardCode)` + `reservasPropias/ajenas`.
  - `getStockUtilizableParaClienteExAsig` → wrapper directo.

- Modify `index.html` (5+ call-sites, grep guiado):
  - **Modal Backorder** (`openBackorderModal`, `renderBackorderList`): usar `breakdown.demandaSapSinCubrir` (si existe) o `breakdown.backorderApp`. **Dos pestañas**.
  - **Modal Reparto** (`_repartoRender`, `_repartoStockFisico`): usar `breakdown.fisicoDep11` + `breakdown.pendienteReparto`.
  - **Popup Master Stock del SKU**: usar `breakdown.*` para todos los números.
  - **Modal Pedido en espera** (`tdReserv`, `tdLibre`): usar `breakdown.reservadasTotal` + tooltip con breakdown completo + badge "N pendientes de reparto" (`breakdown.pendienteReparto.qty`).
  - **Modal Stock Asignado**: usar `breakdown.asignadas`.
  - **Sidebar mapa** (`waitlist-has-exceed.js` + `has-exceed` en sidebar): la fn `computeHasExceed` existe (v1389) — se la toca para que acepte `getStockBreakdown` + eventualmente deprecarla.
  - **Reenrich pending** (`persistPendingEntry`, `doConfirmPedido`): si usan `getDisp(sku)` global, migrar a `breakdown.utilizablePara(cardCode)`.

- Modify `src/main.js`: exponer `window.__phase0.pure.getStockBreakdown`.

- Build bundle (`node build.js`).

**Modal Backorder** — rename + 2 tabs:
- Título: "Backorder: demanda SAP sin cubrir"
- Tab 1 (default): "Demanda SAP sin cubrir" → fuente `backorderBySkuApp` (o lo que resulte de E0).
- Tab 2: "Back order (app)" → fuente `pedidos.lines[state=BO vigentes]`.

**Acciones (TDD + review)**:

1. Dispatch `pr-review-toolkit:silent-failure-hunter` sobre el diff pendiente antes del commit E2. Toca Firestore reads en 7+ call-sites, cualquier `.catch(() => null)` latente queda documentado.

2. RED tests integ `tests/unit/stock-breakdown-integration.test.js`:
   ```js
   describe('Consistencia entre call-sites — mismo fixture, mismo número', () => {
     const fixture = {...};  // 1 SKU con BO + confirmed + ASIG + físico mixto
     const breakdown = getStockBreakdown(fixture.sku, fixture.deps, {now: FIXED});
     it('getStockRealmenteDisponible wrapper == breakdown.libre', ...);
     it('getStockDesglose wrapper .comprometido == breakdown.reservadasTotal', ...);
     it('getStockPorCliente wrapper .libreParaCliente == breakdown.utilizablePara(cardCode)', ...);
     it('computeHasExceed wrapper usa breakdown', ...);
   });
   ```

3. Implementar wrappers.

4. Refactor 5+ call-sites en `index.html` (edits individuales).

5. **Grep audit final**: `grep -nE "getStockFisico|getStockDisponibleVenta|getStockRealmenteDisponible|getStockDesglose|getStockPorCliente|_pendingAppDeSku|_revisionStockFor" index.html` → cada hit debe estar dentro de un wrapper o justificado con comentario.

6. LF normalize + biome write + `node build.js` + commit bundle.

**Gate ejecutable**:
```bash
npx vitest run --reporter=default 2>&1 | tee /tmp/e2.txt | tail -5 && \
FAIL=$(grep -oE "Tests +[0-9]+ failed" /tmp/e2.txt | grep -oE "[0-9]+" || echo "0") && \
[ "$FAIL" = "1" ] && \
grep -q "rechaza assignment que no matchea con ningun cliente BO" /tmp/e2.txt && \
# Grep audit: no debería haber calls directos a las fns deprecadas fuera de wrappers
test $(grep -nE "getStockFisico\(|getStockRealmenteDisponible\(" index.html | grep -v "window\.getStock\|_fn\|wrapper\|// label" | wc -l) -le 10 && \
# Labels nuevos presentes
grep -q "Demanda SAP sin cubrir\|demandaSapSinCubrir" index.html && \
grep -q "Back order (app)\|backorderApp" index.html && \
echo GATE_E2_OK
```

**Budget**: 18 turnos.

**Riesgos de falso verde**:
- Call-site viejo oculto que no aparece en el grep (ej. construido con string template dinámico). Mitigación: el agent `silent-failure-hunter` revisa el diff + grep manual al final.
- Wrappers que silently cambian de shape rompen consumidores sin test. Mitigación: wrappers mantienen shape viejo EXACTO; verificación con tests existentes.
- Rename "Backorder" → "Backorder: demanda SAP sin cubrir" puede romper link/bookmarks internos. Mitigación: `data-sku` + ids HTML no cambian; solo el `<h2>`.
- Bundle rebuild olvidado tras cambio en `src/domains/*` o `src/pure/*`. Mitigación: `node build.js` + stage `app.bundle.js chunks/*` en commit E2.

---

### Etapa 3 — Verificación en prod (read-only)

**Files**:
- Create: `scripts/audit/I_breakdown_prod_check.cjs`
- Create: `docs/auditoria/18_VERIFICACION_V1391_BREAKDOWN.md`

**Acciones**:

1. Script lee `app_config/stock_snapshot` + `pedidos` + `ingresos_reparto` + `backorderBySkuApp` para 4 SKUs: CUDC201HG + 3 al azar con BO del audit B.

2. Corre `getStockBreakdown` sobre cada uno (import desde `src/pure/stock-breakdown.js` via `node --experimental-vm-modules` o copiando mínimo).

3. Para cada SKU: compara contra lo que se renderiza en pantalla (manual: screenshot post-deploy + número del breakdown).

4. Tabla final:

| SKU | Pantalla | Concepto | Valor pantalla | Valor breakdown | ✓/✗ |
|---|---|---|---|---|---|
| CUDC201HG | Modal Backorder | Demanda SAP sin cubrir | ... | ... | ... |
| CUDC201HG | Modal Reparto | Pendientes de reparto | ... | ... | ... |
| ... | ... | ... | ... | ... | ... |

**Gate ejecutable**:
```bash
test -f docs/auditoria/18_VERIFICACION_V1391_BREAKDOWN.md && \
grep -qE 'CUDC201HG' docs/auditoria/18_VERIFICACION_V1391_BREAKDOWN.md && \
# 4 SKUs × 5 pantallas = 20 rows mínimo
test $(grep -cE '^\| ' docs/auditoria/18_VERIFICACION_V1391_BREAKDOWN.md) -ge 20 && \
# Ninguna row con ✗
test $(grep -c '✗' docs/auditoria/18_VERIFICACION_V1391_BREAKDOWN.md) -eq 0 && \
echo GATE_E3_OK
```

**Budget**: 6 turnos.

**Riesgos de falso verde**:
- Script y pantalla ven snapshots distintos del `stock_snapshot` (refresh cada 30 min). Mitigación: congelo el timestamp en el script, repito la verificación si hay desync.
- Script usa fn pura en Node, pantalla la usa en browser via bundle. Si el bundle quedó stale post-deploy, divergen. Mitigación: hard-reload antes de screenshot + verificar `APP_VERSION` en header.

---

### Etapa 4 — Push, PR, merge, deploy, verify

**Acciones**:

1. Push rama.
2. `gh pr create --base main --head feat-stock-breakdown-unico`.
3. `gh pr merge --squash --delete-branch --admin`.
4. GitHub Pages auto-deploy del frontend.
5. Si tocó `functions/**`: `firebase deploy --only functions`.
6. Verify `gcloud functions describe` → `updateTime` fresco.
7. Correr script E3 contra prod post-deploy. Debe coincidir con el output pre-deploy (fns puras, mismos inputs).

**Gate ejecutable**:
```bash
# Después del merge:
git log origin/main --oneline -1 | grep -q "v1391\|stock-breakdown-unico" && \
node scripts/audit/I_breakdown_prod_check.cjs > /tmp/e4.txt 2>&1 && \
test $(grep -c '✗' /tmp/e4.txt) -eq 0 && \
echo GATE_E4_OK
```

**Budget**: 6 turnos.

**Riesgos de falso verde**:
- Deploy functions marca success pero la revisión no se actualiza (precedente CLAUDE.md §29.5). Mitigación: `gcloud functions describe` para `updateTime` reciente.
- Mariano shippea otra feature en paralelo que rompe el merge. Mitigación: rebase o merge main con resolución documentada.

---

### Etapa 5 — Informe Cowork + CLAUDE.md §39 (regla durable)

**Files**:
- Create: `docs/auditoria/19_INFORME_COWORK_V1391.md`
- Modify: `CLAUDE.md` — agregar §39.

**CLAUDE.md §39** (durable):

```
## 39. Toda disponibilidad de stock pasa por getStockBreakdown (2026-10-21)

Regla fuerte: ninguna pantalla, modal, badge, tooltip o CF calcula
disponibilidad / reservadas / libre / pendientes de reparto por su
cuenta. Toda lectura pasa por `getStockBreakdown(sku, deps, opts)` de
`src/pure/stock-breakdown.js` (o copia espejo en functions/core).

Las funciones viejas (`getStockRealmenteDisponible`, `getStockDesglose`,
`getStockPorCliente`, `getStockUtilizableParaClienteExAsig`) son
wrappers que retornan subsets del breakdown; nunca reimplementar la
lógica fuera.

Si necesitás un bucket nuevo (ej. "en cuarentena"), lo agregás a
`getStockBreakdown` + al test invariante de schema + al wrapper que
corresponda. No improvisar inline.

Labels de UI (`STOCK_LABELS`) exportados también desde esa fn.
```

**Acciones**:

Informe autocontenido para Cowork con:
- La tabla de los 5 números pre-v1391 (lo que vio Mariano 10:50).
- Lista de call-sites refactorizados (archivo:línea).
- Tabla verificación E3.
- Estado CUDC201HG en prod (reparto `wXqG9...` activo + migración ya cerrada).
- Gates E0-E4 con salida real pegada.
- PR link + hash merge.
- Follow-ups (SKUs >90d del audit B, D3 pendiente).

**Gate ejecutable**:
```bash
test -f docs/auditoria/19_INFORME_COWORK_V1391.md && \
grep -qE 'GATE_E0_OK' docs/auditoria/19_INFORME_COWORK_V1391.md && \
grep -qE 'GATE_E1_OK' docs/auditoria/19_INFORME_COWORK_V1391.md && \
grep -qE 'GATE_E2_OK' docs/auditoria/19_INFORME_COWORK_V1391.md && \
grep -qE 'GATE_E3_OK' docs/auditoria/19_INFORME_COWORK_V1391.md && \
grep -qE 'GATE_E4_OK' docs/auditoria/19_INFORME_COWORK_V1391.md && \
grep -qE '^## 39' CLAUDE.md && \
echo GATE_E5_OK
```

**Budget**: 4 turnos.

---

## 5. Resumen budgets + gates

| Etapa | Qué hace | Budget | Gate |
|---|---|---:|---|
| E0 | Explicar 5 números (systematic-debugging) | 10 | GATE_E0_OK |
| E1 | getStockBreakdown pura + sync test (TDD) | 14 | GATE_E1_OK |
| E2 | Refactor call-sites + labels (TDD + silent-failure-hunter) | 18 | GATE_E2_OK |
| E3 | Verificación prod read-only | 6 | GATE_E3_OK |
| E4 | Push + PR + merge + deploy + verify | 6 | GATE_E4_OK |
| E5 | Informe Cowork + CLAUDE.md §39 | 4 | GATE_E5_OK |
| **Total** | | **58** | |

---

## 6. Entregables al cierre

- Rama `feat-stock-breakdown-unico` con ~6 commits (uno por etapa + merge intermedios si Mariano pushea).
- PR + merge --squash --admin a main (nueva versión v1391).
- Deploy GitHub Pages + `firebase deploy --only functions` si toca.
- `src/pure/stock-breakdown.js` + copia `functions/core/pedido-snapshot-core.js`.
- Tests: `tests/unit/stock-breakdown.test.js` + `tests/unit/audit/stock-breakdown-sync.test.js` + `tests/unit/stock-breakdown-integration.test.js`.
- `scripts/audit/I_breakdown_prod_check.cjs`.
- `docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md` (E0).
- `docs/auditoria/18_VERIFICACION_V1391_BREAKDOWN.md` (E3).
- `docs/auditoria/19_INFORME_COWORK_V1391.md` (E5).
- CLAUDE.md §39 nueva regla durable.
- Suite completa en verde salvo `reparto.test.js` pre-existente.

---

## 7. Autorizaciones vigentes

- Autonomía completa hasta producción: push, PR, merge a main --squash --admin, deploy (GitHub Pages auto + `firebase deploy --only functions`).
- Sin volver a preguntar por cada deploy.
- Condición única: suite completa en verde salvo el pre-existente de `reparto.test.js`.
- Prohibido tocar `firestore.rules`.
- Única escritura en datos de prod autorizada: cerrar el doc de reparto `XqBxRRu78WLwmZx0K6Gd` si todavía está abierto (ya fue cerrado 13:28 UTC).

---

## 8. Qué queda del lado de Mariano

1. **D3** (SQ → Order SAP): respuesta al resumen de 10 líneas en `docs/auditoria/17_RESULTADO_V1390_BO_SIN_TTL.md`. Si autoriza, se lanza un script de dimensionamiento SAP SL.
2. **9 SKUs con BO >90d** quedando fuera del reparto por §37: decidir si se arma una vista admin para "demanda muy vieja" aparte, o se deja como stale.
3. **Smoke test manual post-deploy v1391**: abrir CUDC201HG en las 5 pantallas y confirmar que los números coinciden.

---

## 9. Riesgos transversales de falso verde

- **E0 → E1**: si no se mapea bien de dónde viene "26 unidades" (podría ser BQ, no Firestore), el `demandaSapSinCubrir` queda como `null` y la fn pura queda incompleta. Mitigación: E0 obliga a documentar fuente con `archivo:línea`; si no hay archivo:línea (es BQ), hay que agregar `deps.sapBackorderSnapshot` como input obligatorio en E1 — no opcional.
- **E2 call-sites ocultos**: cualquier template string dinámico con `getStock*(` escapa al grep. Mitigación: `silent-failure-hunter` agent + revisión manual del diff en el PR.
- **E3 script usa fns puras pero pantalla las ejecuta en bundle**: si bundle quedó stale post-deploy, divergen. Mitigación: hard-reload + verificar `APP_VERSION` en header antes de screenshots.
- **E2 renombres de labels rompen tests existentes de UI** (si los hay en jsdom/happy-dom). Mitigación: grep de los labels viejos antes de renombrar + decidir si los tests requieren update.
- **CUDC201HG dinámico**: si Pablo asigna o cancela mientras corre E3, los números cambian. Mitigación: congelar timestamp en el script + repetir si hay desync.

---

**Esperando OK para arrancar E0.** Autorizaciones ya cubren el loop entero.
