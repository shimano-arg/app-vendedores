# Auditoría de grises de toda la lógica de stock — Plan

> **For agentic workers:** usar `superpowers:brainstorming` para enumerar casos adicionales (Etapa 1), `superpowers:dispatching-parallel-agents` para repartir inventario y búsqueda (Etapas 0+1), `superpowers:systematic-debugging` para cada hallazgo (Etapa 3), `superpowers:test-driven-development` para cada fix (Etapa 3), `superpowers:verification-before-completion` ANTES de cada gate. Steps con checkbox (`- [ ]`).

**Goal:** auditar sistemáticamente toda la lógica de stock contra las 10 reglas vigentes R1–R10 (CLAUDE.md §33–§53), encontrar todos los grises, cerrar los chicos en esta tarea y estimar los grandes para otra iteración.

**Rama:** `audit-grises-stock` desde `main` (post-v1424).

**Autonomía:** completa hasta producción (code, tests, scripts audit, scripts write con dry-run+--apply, deploy Pages/functions/rules si corresponden). **Pausa única:** si un fix de Etapa 3 cambia el libre de más de 50 unidades en prod → mostrar antes de mergear.

**Suite baseline pre-tarea:** 2157 PASS, 0 FAIL.

---

## Inventario de capacidades (lectura confirmada)

| Capacidad | Disponible | Uso |
|---|---|---|
| `superpowers:brainstorming` | ✅ `~/.claude/skills/brainstorming` | Etapa 1: ampliar lista de grises |
| `superpowers:writing-plans` | ✅ | este documento |
| `superpowers:dispatching-parallel-agents` | ✅ | Etapas 0, 1, 2 |
| `superpowers:systematic-debugging` | ✅ | cada hallazgo Etapa 3 |
| `superpowers:test-driven-development` | ✅ | cada fix Etapa 3 |
| `superpowers:verification-before-completion` | ✅ | pre-gate cada etapa |
| `superpowers:using-git-worktrees` | ✅ | si se dispara trabajo paralelo |
| Agentes `Explore` / `Plan` / `general-purpose` / `backend-architect` / `debugger` / `test-automator` / `silent-failure-hunter` | ✅ | Etapas 0, 1, 3 |
| vitest | ✅ (en package.json) | tests |
| **fast-check** (property-based tests) | ❌ **no instalado** | **autorización pendiente** para Etapa 3.6 (ver Riesgos abajo) |
| firebase-admin SDK | ✅ (functions/node_modules) | scripts audit prod |
| `firebase deploy` | ✅ (user auth OK) | Etapa 4 |

---

## Entregables al cierre

- `docs/auditoria/40_INVENTARIO_STOCK.md` — matriz de transiciones + lectores + SAP + CFs.
- `docs/auditoria/41_GRISES_ENCONTRADOS.md` — tabla con id, caso, regla, severidad, repro, fix, tamaño.
- `docs/auditoria/42_GRISES_PROD.md` — scan read-only de prod, totales por caso.
- `docs/auditoria/43_FIXES_APLICADOS.md` — qué se cerró en Etapa 3 (precedente + commit).
- `Desktop/INFORME_COWORK_auditoria-grises-stock.md` — informe autocontenido para Cowork.
- Fixes grandes en tabla con estimación (no se arrancan).
- Suite completa post-tarea en verde.
- Rama `audit-grises-stock` mergeada a `main`.

---

## Riesgos transversales de falso verde

1. **Cache SW stale**: usuarios con `v1420` cacheado operando sobre reglas nuevas v1421+. **Mitigación**: bump `CACHE_VERSION` + verificar prod post-deploy; informe explícito al equipo si Etapa 3 cambia reglas.
2. **Scripts audit con permission-denied del sandbox**: queries full-collection a prod bloqueadas. **Mitigación**: cada script usa queries indexadas por `cardCode`/`sku`/`state`; dry-run default; si bloquea, Mariano ejecuta y copia output al md.
3. **Firestore signature-based cache stale**: fix v1422 confirmó que caches locales no se invalidan si la firma es degenerada. **Mitigación**: Etapa 1 verifica firmas de otros caches (route_overrides, client_master, product_catalog).
4. **Hallazgos nuevos durante Etapa 3** que crecen a "grandes": si al fixear uno aparecen 3 más, se mueven a la tabla con estimación en vez de encadenar.
5. **Property-based tests con fast-check (Etapa 3.6)**: si no autorizado, se omite esa sub-etapa y queda documentada como pendiente. Los tests puntuales siguen siendo obligatorios.
6. **Deploy functions**: si Etapa 3 toca `functions/core/*`, requiere `firebase deploy --only functions:*` — autorización explícita en Etapa 4 (ya pre-aprobado por Mariano en el prompt original pero sandbox puede bloquear).
7. **Pausa 50u**: si un fix cambia libre >50u en prod, no se mergea sin OK. Fast-fail para proteger operaciones.

---

## Etapas

### ETAPA 0 — Inventario (4 agentes `Explore` en paralelo, solo lectura)

**Files:**
- Create: `docs/auditoria/40_INVENTARIO_STOCK.md`

**Agentes (dispatchear en una sola message, en paralelo):**

- **A — Transiciones de estado**: todos los call-sites que mutan `pedidos.lines[].state/qty/qtyOpen` + `revision_waitlist.items[].qty`. Matriz: función · archivo:línea · estados origen → destino · closedReason · pasa por getStockBreakdown? · tiene test? · trigger (vendedor/Pablo/CF/script/sync SAP).
- **B — Lectores de disponibilidad**: pantallas (modales, Planner, sidebar, popup Stock, Master, Reparto, Backorder, Stock Asignado), exports (Excel app), CFs, scripts. Para cada uno: usa breakdown? wrapper? fórmula propia? Lista de los que violan R8.
- **C — Integración SAP**: SQ send, sync orders, sync invoices, sync stock snapshot. Campos SAP leídos (`InStock`/`Committed`/`Available`/`Ordered`/`B1Allocation`). Mapeo a `fisicoDep11`/`transitoDep12`. Puntos de doble conteo o conteo nulo.
- **D — Cloud Functions**: nombres + triggers + frecuencia + idempotencia + concurrencia + `gcloud describe` con `updateTime`. Alineación: v1419 §53 deploy functions pendiente desde ayer.

**Pure helper agregado al inventario**: cada agente devuelve un sub-md en `docs/auditoria/40_INVENTARIO_STOCK_<letra>.md`; el agente **coordinador** (yo) merge en `40_INVENTARIO_STOCK.md`.

- [ ] Despachar 4 agentes `Explore` en paralelo (una sola message, 4 tool-use blocks).
- [ ] Esperar resultados, mergear en el md final.
- [ ] Validar que la matriz de transiciones tiene todos los estados conocidos (BO, ASIG, confirmed, invoiced, cancelled, expired, pending, pre-stage, …).

**Gate ejecutable:**
```bash
test -f docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -qE "^##.*Transiciones" docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -qE "^##.*Lectores" docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -qE "^##.*SAP" docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -qE "^##.*Cloud Functions" docs/auditoria/40_INVENTARIO_STOCK.md && \
grep -c "^\|.*|.*|.*|" docs/auditoria/40_INVENTARIO_STOCK.md | awk '$1 > 50 {exit 0} {exit 1}' && \
echo GATE_E0_OK
```

**Budget:** 10 turnos.

**Falsos verdes:**
- Agente devuelve lista "muestra" en vez de exhaustiva. **Mitigación**: cross-check con grep count de `splitPedidoLine|state[ =]*['"]*(BO|ASIG|confirmed|invoiced|cancelled)|lineReservesStock|getStockBreakdown`.
- CF deployada pero el agente miró el código y no `gcloud describe`. **Mitigación**: gate exige `updateTime` para cada CF.

---

### ETAPA 1 — Búsqueda de grises (brainstorming + 5 agentes en paralelo)

**Files:**
- Create: `docs/auditoria/41_GRISES_ENCONTRADOS.md`
- Create: `docs/auditoria/41_BRAINSTORMING_ANEXO.md`

**Sub-etapa 1.0 — Brainstorming (yo, antes de despachar):**

Aplicar `superpowers:brainstorming` para ampliar la lista Mariano con casos **no listados** que surgen del inventario Etapa 0. Mínimo esperado 15 adicionales. Lentes:
- **Temporal**: ¿qué pasa si corre justo cuando…?
- **Data corrupta**: ¿qué pasa si el doc tiene …?
- **Boundary**: 0, 1, max, negativo.
- **Idempotencia**: ¿y si corre dos veces?
- **Observer effect**: ¿el acto de leer cambia algo?

**Sub-etapa 1.1 — Agentes paralelos (5 en una message):**

- **G1 — Concurrencia y orden de eventos** (sub-lista Mariano + brainstorming).
- **G2 — Asignaciones + Reparto** (incluye TTL, cancel por SAP sync, split v1189 confirmed+BO del mismo origen).
- **G3 — Unificación + una orden por cliente** (R5 + v1382 asigRefs + cardCode vacío + prospectos).
- **G4 — Estados intermedios + SAP** (pending→confirmed, send-fail, DocTotal mismatch, factura parcial, bypassAsigGate v1118).
- **G5 — Datos y migraciones** (líneas corruptas, docs huérfanos, pedidos v1278 pre-migración, cache SW stale, pantallas con fuente propia).

Cada agente devuelve filas de la tabla.

**Formato tabla (en `41_GRISES_ENCONTRADOS.md`):**

| id | caso | regla violada | severidad | reproducción | fix propuesto | tamaño |
|---|---|---|---|---|---|---|
| G1-01 | 2 vendedores confirman mismo SKU | R6 | rompe stock | script sim 2 txn | runTransaction con `getStockBreakdown` en read-side de la txn | **chico** |
| … | … | … | … | … | … | … |

**Severidad**: `rompe stock` / `confunde` / `cosmético`.
**Tamaño**: `chico` (se cierra Etapa 3) / `grande` (estimación en horas, no se empieza).

- [ ] Brainstorming → `41_BRAINSTORMING_ANEXO.md`.
- [ ] Despachar G1–G5 en paralelo.
- [ ] Mergear tabla.
- [ ] Auto-triage: contar chicos vs grandes.

**Gate ejecutable:**
```bash
test -f docs/auditoria/41_GRISES_ENCONTRADOS.md && \
test -f docs/auditoria/41_BRAINSTORMING_ANEXO.md && \
# Al menos 40 filas en la tabla (de la lista Mariano + brainstorming agents):
awk '/^\|/ && !/-----/ && !/^\| id/' docs/auditoria/41_GRISES_ENCONTRADOS.md | wc -l | awk '$1 >= 40 {exit 0} {exit 1}' && \
# Al menos 15 casos nuevos de brainstorming (no en la lista Mariano):
grep -c "^- \*\*B[0-9]" docs/auditoria/41_BRAINSTORMING_ANEXO.md | awk '$1 >= 15 {exit 0} {exit 1}' && \
# Cada fila tiene severidad + tamaño:
awk '/^\|/ && !/-----/ && !/^\| id/ {if ($0 !~ /chico|grande/ || $0 !~ /rompe stock|confunde|cosmético/) exit 1}' docs/auditoria/41_GRISES_ENCONTRADOS.md && \
echo GATE_E1_OK
```

**Budget:** 20 turnos.

**Falsos verdes:**
- Un gris con regla ambigua se clasifica "cosmético" para evitar fix. **Mitigación**: lectura cruzada post-merge (yo re-leo cada fila clasificada cosmético).
- Agente propone "fix: investigar más" en vez de un fix concreto. **Mitigación**: gate obliga a que la columna `fix propuesto` tenga archivo:línea o módulo.

---

### ETAPA 2 — Scan de producción (scripts audit, read-only)

**Files:**
- Create: `scripts/audit/W_scan_grises_prod.cjs` (un script con sub-comandos por familia).
- Create: `docs/auditoria/42_GRISES_PROD.md`.

Para cada familia relevante de Etapa 1, una sub-query:
- **transiciones corruptas**: `qtyOpen > qty`, `qtyOpen < 0`, `qty < 0`, state desconocido, `precio == 0` + state no cancelled.
- **ASIG huérfanas**: `asigAt > 7d` sin cancelación auto; ASIG con pedido origen cerrado.
- **CPST**: waitlist stage=consumed sin `closedAt`; `source=stock-asignado-batch` sin `pedidosOrigenes` ni `items[].asigRefs` populated.
- **repartos**: `clientesBO=[]`; qty > físico; 2+ repartos abiertos mismo SKU.
- **unificación**: clientes con ≥2 waitlists abiertas; waitlists con `unifiedFrom` sin `source`.
- **datos cliente**: pedidos sin `clientCardCode`, sin `key`, con `key=''`.
- **SAP mismatch**: `transferidoSAP.docNum` con `sapDocTotal=0`; `orderDocEntry != null` con líneas confirmed `reservadas>0` (bug §40.8 pre-v1400 residual).
- **va a SAP**: `discountPct` del pedido vs `sapDocTotal` + líneas confirmed (verificación v1419 §53).

Cada sub-query devuelve `count + list[ids]`. Si count > 0: fila en `42_GRISES_PROD.md`.

- [ ] Script W con 10 sub-comandos.
- [ ] Correr cada sub-comando (requiere sandbox OK — queries indexadas por sku/cardCode/stage; cada una pide OK si bloquea).
- [ ] Mergear outputs en el md.
- [ ] Para cada caso con **> 0** y **tamaño chico**: pasa a Etapa 3 con prioridad por severidad.

**Gate ejecutable:**
```bash
test -f scripts/audit/W_scan_grises_prod.cjs && \
test -f docs/auditoria/42_GRISES_PROD.md && \
grep -qE "^##.*(transiciones|ASIG|CPST|repartos|unificación|datos cliente|SAP|va a SAP)" docs/auditoria/42_GRISES_PROD.md && \
grep -qE "Total afectados:" docs/auditoria/42_GRISES_PROD.md && \
echo GATE_E2_OK
```

**Budget:** 10 turnos.

**Falsos verdes:**
- Query devuelve `0` por filtro mal (ej. `where state in [...]` que no matchea una variante). **Mitigación**: cada sub-query loguea un sample doc id + sanity check cruzando contra el inventario Etapa 0.

---

### ETAPA 3 — Cerrar los chicos (TDD + commits por fix + rama)

**Files:**
- Modify: `src/pure/*.js` según cada fix.
- Modify: `index.html` / `functions/core/*.js` / `firestore.rules` según.
- Create: `tests/unit/audit/grises-*.test.js` por familia.
- Create: `docs/auditoria/43_FIXES_APLICADOS.md`.

Por cada gris chico identificado en Etapa 1+2:

1. **Systematic-debugging phase 1 (root cause)**: trace la fuente real.
2. **TDD**: test RED que lo reproduce.
3. **Fix minimal**: una línea / una función.
4. **Test GREEN**: suite PASS.
5. **CLAUDE.md regla nueva**: si el fix cambia comportamiento, agregar §.
6. **Commit** en la rama con mensaje `v<N> §<N>: <descripción>`.
7. **Suite completa**: 0 fallos. Si no pasa → root cause nuevo (no bypass).

**Sub-etapas:**

- [ ] **E3.1** — Transiciones corruptas (sanitize `splitPedidoLine` / `cancelLine`).
- [ ] **E3.2** — ASIG huérfanas (CF `revertSobreAsignadas` extendida? o manual script?).
- [ ] **E3.3** — CPST sin pedidosOrigenes (migración script o fix helper).
- [ ] **E3.4** — Repartos huérfanos (CF `reconcileRepartosFaltantes` con limpieza).
- [ ] **E3.5** — Unificación clientes con ≥2 waitlists (reusar script R + aplicar).
- [ ] **E3.6** — **Property-based tests** con `fast-check` (si Mariano autoriza install):
  - [ ] `npm install -D fast-check`
  - [ ] `tests/unit/property/stock-invariants.test.js` con N operaciones aleatorias:
    - `reservadas = asignadas.total + confirmadasSinFacturar.total` (R1).
    - `libre >= 0` siempre (R2).
    - `asignadas.total <= fisicoDep11` siempre (R2).
    - Una orden abierta por cliente (R5).
    - Suma por SKU + state entre pedidos y waitlist no supera físico.
    - `va_a_sap(payload) == dispNeto(modal) == plannerCardTotal`.
- [ ] **E3.X extras** — cada chico adicional de Etapa 1/2.

**Pausa 50u**: antes de merge, por cada fix que escribe datos, correr script dry-run → si suma líneas afectadas > 50u totales libre, STOP + mostrar diff a Mariano.

**Gate ejecutable:**
```bash
# Toda la suite PASS (si fast-check instalado, incluye property):
npx vitest run --reporter=default 2>&1 | tee /tmp/e3.txt | tail -5 && \
FAIL=$(grep -oE "Tests +[0-9]+ failed" /tmp/e3.txt | grep -oE "[0-9]+" || echo "0") && \
[ "$FAIL" = "0" ] && \
# tsc clean:
npx tsc --noEmit 2>&1 | grep -c "error TS" | awk '$1 == 0 {exit 0} {exit 1}' && \
# Biome clean:
npx biome check 2>&1 | grep -c "error" | awk '$1 == 0 {exit 0} {exit 1}' && \
# Cada fix tiene commit (contar vs filas chicas de Etapa 1):
EXPECTED_FIXES=$(awk '/^\|.*chico/' docs/auditoria/41_GRISES_ENCONTRADOS.md | wc -l) && \
ACTUAL_COMMITS=$(git log --oneline main..HEAD | wc -l) && \
echo "Fixes chicos esperados: $EXPECTED_FIXES — Commits en rama: $ACTUAL_COMMITS" && \
test $ACTUAL_COMMITS -ge $EXPECTED_FIXES && \
echo GATE_E3_OK
```

**Budget:** 30 turnos.

**Falsos verdes:**
- Un fix pasa el test puntual pero rompe un invariante property-based. **Mitigación**: E3.6 property corre en cada fix antes del commit (no al final).
- Fix cosmético (ej. renombrar) marcado como fix de gris. **Mitigación**: tabla fixes aplicados en `43` cita el id del gris de Etapa 1 → coincidencia 1:1.
- Un fix cambia libre en prod > 50u y lo mergeo sin pausa. **Mitigación**: dry-run obligatorio pre-merge.

---

### ETAPA 4 — Verificación y cierre

**Files:**
- Modify: CLAUDE.md (§59+ para cada regla nueva de Etapa 3).
- Create: `Desktop/INFORME_COWORK_auditoria-grises-stock.md`.

- [ ] PR `audit-grises-stock` → `main` con `--squash --admin`.
- [ ] Si Etapa 3 tocó `functions/core/*`: `firebase deploy --only functions:<X>`.
- [ ] Si Etapa 3 tocó `firestore.rules`: `firebase deploy --only firestore:rules`.
- [ ] Si Etapa 3 tocó frontend: GH Pages auto; verificar `APP_VERSION` prod.
- [ ] Verificación prod 3 SKUs (CUDC201HG, 597151, EXGC80HBAR2AR):
  - Popup Stock del SKU.
  - Modal Pedido en Espera (orden abierta de un cliente con el SKU).
  - Modal Stock Asignado.
  - Modal Backorder.
  - Planner card.
  - Export Excel (si aplica).
  - 1 sólo número en los 6 lugares para cada SKU.
- [ ] Informe Cowork con las 4 salidas + reglas nuevas + lista para Pablo/Mariano operativa.

**Gate ejecutable:**
```bash
# Prod verificado:
curl -sSL "https://shimano-arg.github.io/app-vendedores/index.html?v=$(date +%s)" 2>&1 | \
  grep -oE "APP_VERSION\s*=\s*['\"]v[0-9]+['\"]" | head -1 | grep -qE "v1[4-9][0-9]+" && \
# Informe existe:
test -f "C:/Users/shimano.sandbox/Desktop/INFORME_COWORK_auditoria-grises-stock.md" && \
# CLAUDE.md tiene las reglas nuevas (si hay):
grep -qE "^## 5[9-9]|^## 6[0-9]" CLAUDE.md && \
echo GATE_E4_OK
```

**Budget:** 10 turnos.

**Falsos verdes:**
- Deploy marca success pero prod sigue en versión vieja. **Mitigación**: `curl` compara APP_VERSION live contra `index.html` committed.
- Informe tiene todas las secciones pero data mentirosa (ej. "0 grises" cuando Etapa 1 encontró 20). **Mitigación**: cross-check con `41_GRISES_ENCONTRADOS.md`.

---

## Resumen de budgets

| Etapa | Turnos | Gate |
|---|---:|---|
| E0 inventario (4 agentes paralelos) | 10 | GATE_E0_OK |
| E1 grises (brainstorming + 5 agentes) | 20 | GATE_E1_OK |
| E2 scan prod (10 sub-queries) | 10 | GATE_E2_OK |
| E3 cerrar chicos (TDD + property) | 30 | GATE_E3_OK |
| E4 verify + deploy + informe | 10 | GATE_E4_OK |
| **Total** | **80** | |

Si se agotan antes de cerrar: paro, documento estado real, listo lo pendiente con estimación. No empiezo nada grande sin OK.

---

## Qué queda del lado de Mariano

- **Antes de arrancar**: aprobar install de `fast-check` (dev dep, ~500 KB, 3MB con deps). Sin esto E3.6 se omite.
- **Durante E2**: si una sub-query full-collection la bloquea sandbox, ejecutarla manual + pegar output.
- **Pausa 50u**: cada fix de E3 que afecte > 50u pide OK antes del merge.
- **Deploy functions/rules**: si Etapa 3 toca CF o rules, autorización del sandbox puede pedir OK adicional (igual que ayer con `onPedidoConfirmedSendToSap`).
- **Post-merge**: smoke test manual de los 3 SKUs en prod + feedback.

---

## Self-review (writing-plans skill)

1. **Spec coverage**: cada regla R1-R10 tiene al menos 1 caso de prueba en E1. ✓
2. **No placeholders**: cada etapa tiene archivo:línea específico + comando concreto en el gate. ✓
3. **Dependencias correctas**: E0 → E1 → E2 → E3 → E4. ✓
4. **Pausa 50u** y **autorización fast-check** documentadas antes de arrancar. ✓
5. **Risks de falso verde** por etapa + transversales. ✓
