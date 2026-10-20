# Auditoría flujo de stock CRM — Plan loop engineering

> **For agentic workers:** Esto es una **AUDITORÍA** (read-only sobre lógica de negocio). Los únicos archivos nuevos permitidos son: informe de auditoría (docs/auditoria/*), tests o scripts de reproducción (tests/unit/audit/*, scripts/audit/*), y reglas en CLAUDE.md. No se toca `src/`, `functions/`, `index.html` ni se cambia lógica. Si se detecta un bug, se documenta con evidencia; el fix queda para otra tarea.

**Goal:** Explicar por qué un pedido con 3u disponibles en SAP dep 11 terminó en back order; dar veredicto por invariante I1-I7 y por hipótesis H1-H6; dejar tests determinísticos que fallen en el bug.

**Architecture:** 7 etapas con GATE ejecutable y determinístico (comando real con exit code) por etapa, BUDGET de turnos, y RIESGOS DE FALSO VERDE. Rama `audit-stock-flow` desde `origin/main`. Commit por etapa. Nunca push a main; nunca deploy a producción.

**Tech Stack:** vitest (tests), Python ADC wrapper (queries diagnóstico), gcloud/firebase SDK (read-only), markdown (informe).

---

## Síntoma a explicar

3 unidades disponibles en SAP dep 11 → la app las mandó a back order (0 a SAP, 3 a BO).

## Objetivos del sistema

- **O1** proteger stock con dueño (BO que recibió unidades no se lo lleva otro cliente).
- **O2** no esconder stock libre (toda unidad SAP dep 11 no reservada tiene que poder enviarse).

Síntoma = violación de O2.

## Invariantes a chequear (I1-I7)

| ID | Invariante |
|----|------------|
| I1 | Disponible = Físico(dep 11) − Reservado, nunca negativo; Físico solo dep 11 |
| I2 | Para pedido ex-Stock Asignado del cliente C: Utilizable(C) = Disp + Reservado(C) |
| I3 | Reserva se libera exactamente una vez: al enviar a SAP el pedido que la consume |
| I4 | Una unidad nunca está en 2 estados a la vez (Disp/Res/EnSAP/BO) |
| I5 | SKU con Físico>0 y BO pendiente aparece en Reparto, no en Backorder |
| I6 | Ningún pedido se autogenera BO si Disp (o Utilizable) cubre al momento del envío |
| I7 | Pedido parcial se parte: cubierto va a SAP, resto a BO (ni todo-SAP ni todo-BO) |

## Hipótesis priorizadas (H1-H6)

| ID | Hipótesis | Síntoma en pasos end-to-end |
|----|-----------|------------------------------|
| H1 | "Crear Pedido Desde Stock Asignado" resta la propia reserva (viola I2) → disp=0 → todo a BO | 7,8 |
| H2 | Reserva no se libera al enviar a SAP (viola I3) → reservas fantasma restan a cero | 8 |
| H3 | Físico mal leído: otro depósito, suma depósitos, o snapshot propio (viola I1) | 2,5,9 |
| H4 | Pedido parcial mal partido (viola I7) | 3 |
| H5 | Condición de carrera: envíos simultáneos leen mismo Disponible | - |
| H6 | Ventana sin protección entre ingreso y reparto (viola O1) | 5 |

---

## Etapas

### E0 — Setup

**Objetivo:** rama + plan + regla auditoría en CLAUDE.md.

**Files:**
- Create: `docs/superpowers/plans/2026-10-20-auditoria-stock-crm.md` (este archivo)
- Modify: `CLAUDE.md` (regla durable: auditorías no tocan lógica)

**Gate ejecutable:**
```bash
test -f docs/superpowers/plans/2026-10-20-auditoria-stock-crm.md && \
grep -q "AUDITORÍA" CLAUDE.md && \
git branch --show-current | grep -q audit-stock-flow
# exit 0 esperado
```

**Budget:** 3 turnos.

**Falso verde:** regla en CLAUDE.md redactada vaga ("ser cuidadoso con auditorías") sin obligar a limitar los archivos nuevos.

---

### E1 — Mapa del flujo real (read-only)

**Objetivo:** por cada paso 0-11 del end-to-end, identificar archivo:línea:función que calcula Físico, Reservado, Disponible y decide SAP vs BO.

**Files:**
- Create: `docs/auditoria/01_MAPA_FLUJO.md` con secciones `## PASO 0` .. `## PASO 11`

**Estrategia:** dispatch 3 agentes paralelos (`general-purpose`) sobre áreas no solapadas:
1. Lista de espera + `pedidos.add()` + split confirmed/BO (pasos 0-4)
2. Modales Backorder/Reparto/Stock Asignado + FIFO ASIG (pasos 5-6, 9-10)
3. "Crear Pedido Desde Stock Asignado" + envío SAP + liberación reserva (pasos 7-8, 11)

Cada agente devuelve: por paso, `path/file.ext:L123-L145` + nombre función + fragmento de 5-10 líneas.

**Gate ejecutable:**
```bash
test -f docs/auditoria/01_MAPA_FLUJO.md && \
for p in 0 1 2 3 4 5 6 7 8 9 10 11; do grep -q "^## PASO $p" docs/auditoria/01_MAPA_FLUJO.md || exit 1; done && \
# Al menos 1 referencia file:line por paso (regex básico: path con :NN)
grep -cE '\.(js|html|cjs|py):[0-9]+' docs/auditoria/01_MAPA_FLUJO.md | awk '{exit ($1<12)?1:0}'
```

**Budget:** 10 turnos (agentes paralelos cuentan como 1 turno cada tanda).

**Falso verde:** documentar funciones que ya no se usan (código muerto), o funciones detrás de feature flag OFF que nunca se ejecutan en prod. Mitigación: cross-check con grep de llamadas en runtime path.

---

### E2 — Veredicto por invariante I1-I7

**Objetivo:** cada I1..I7 con CUMPLE / VIOLA / NO VERIFICABLE + evidencia.

**Files:**
- Create: `tests/unit/audit/invariants.test.js` (un `describe` por invariante)
- Create: `docs/auditoria/02_INVARIANTES.md` con tabla + evidencia

**Reglas:**
- Los tests importan **el código real** (`src/pure/stock-realmente-disponible.js`, `src/pure/virtual-asig-fifo.js`, `src/pure/reparto-stock-asig.js`, `src/pure/pedido-split.js`). No reimplementar fórmulas a mano.
- Fixtures: pedidos y stock_snapshot in-memory siguiendo el shape real.
- Si la invariante VIOLA → test FAIL + capturar `expected/actual` en el informe.

**Gate ejecutable:**
```bash
npx vitest run tests/unit/audit/invariants.test.js --reporter=verbose 2>&1 | tee /tmp/i_out.txt ; \
# No crashes de módulos (import error):
! grep -q "Cannot find module\|SyntaxError" /tmp/i_out.txt && \
# Cantidad de FAIL == cantidad de "| VIOLA |" en el informe
VIOLA=$(grep -cE '\| VIOLA ' docs/auditoria/02_INVARIANTES.md) ; \
FAIL=$(grep -oE "Tests  [0-9]+ failed" /tmp/i_out.txt | grep -oE "[0-9]+") ; \
[ "$VIOLA" = "$FAIL" ]
```

**Budget:** 12 turnos.

**Falso verde:** mock de la función bajo test que simula el bug; verificar que los tests `import` desde el path real del repo.

---

### E3 — Verificar hipótesis H1-H6

**Objetivo:** cada hipótesis CONFIRMADA / DESCARTADA con evidencia.

**Files:**
- Create: `tests/unit/audit/hipotesis.test.js` (un `describe` por hipótesis)
- Create: `docs/auditoria/03_HIPOTESIS.md`

**Reglas:**
- Mismo rule que E2: importar código real.
- H1 es la hipótesis principal → test determinístico que replique: Pablo asigna 3 a Oeste, Oeste envía pedido, Utilizable(Oeste) debería ser 3, el código actual devuelve ¿?.
- H5 (carrera) → doc únicamente, no test (depende de orquestación paralela).

**Gate ejecutable:**
```bash
npx vitest run tests/unit/audit/hipotesis.test.js --reporter=verbose 2>&1 | tee /tmp/h_out.txt ; \
! grep -q "Cannot find module\|SyntaxError" /tmp/h_out.txt && \
# Cada hipótesis tiene veredicto en el informe
for h in H1 H2 H3 H4 H5 H6; do grep -qE "^## $h " docs/auditoria/03_HIPOTESIS.md || exit 1; done
```

**Budget:** 12 turnos.

**Falso verde:** test que "demuestra" el bug con una helper function propia (no la del repo). Mitigación: cada test imprime `require.resolve(...)` para asegurar que apunta al archivo del repo.

---

### E4 — Reproducción end-to-end 11 pasos

**Objetivo:** test único que recorre PASO 0 → PASO 11 con el fixture STRADIC-2500 + Norte/Sur/Oeste.

**Files:**
- Create: `tests/unit/audit/end-to-end-stradic.test.js`

**Estructura:**
```js
it("end-to-end STRADIC-2500 flow", () => {
  // PASO 0: estado inicial
  expect(state).toEqual({ fisico: 3, reservado: 0, disp: 3, bo: 0 });
  // PASO 1 .. PASO 11, mismo patrón
});
```

**Gate ejecutable:**
```bash
npx vitest run tests/unit/audit/end-to-end-stradic.test.js --reporter=verbose 2>&1 | tee /tmp/e2e_out.txt ; \
! grep -q "Cannot find module\|SyntaxError" /tmp/e2e_out.txt && \
# No skipped
! grep -qE "(it|test)\.skip" tests/unit/audit/end-to-end-stradic.test.js && \
# El test corrió (pasó o falló; si falla, el FAIL es evidencia)
grep -qE "Tests  (passed|failed)" /tmp/e2e_out.txt
```

**Budget:** 12 turnos.

**Falso verde:** `test.skip` por pasos "pendientes"; stub de assert `expect(true).toBe(true)` que no verifica estado.

---

### E5 — Queries diagnóstico prod (GATE HUMANO)

**Objetivo:** medir el daño actual en prod (3 queries), con gate humano explícito antes de ejecutar contra prod.

**Files:**
- Create: `scripts/audit/A_reservas_vivas_pedido_enviado.cjs` (reservas con `state=ASIG` cuyo pedido ya tiene `transferidoSAP.docEntry` cerrado por invoice)
- Create: `scripts/audit/B_bo_con_fisico_positivo.cjs` (SKUs en `stock_snapshot.backorderBySkuApp` con Físico dep 11 > 0)
- Create: `scripts/audit/C_bo_creados_en_fecha_con_stock.cjs` (pedidos `state=BO` creados cuando SAP tenía stock según stock.json histórico)
- Cada script acepta `--dry-run` (sin ADC, muestra la query) y `--prod` (con ADC, ejecuta).

**Gate ejecutable (dry-run OK):**
```bash
node scripts/audit/A_reservas_vivas_pedido_enviado.cjs --dry-run && \
node scripts/audit/B_bo_con_fisico_positivo.cjs --dry-run && \
node scripts/audit/C_bo_creados_en_fecha_con_stock.cjs --dry-run
```

**Gate humano:** STOP y pedir OK a Mariano antes de correr con `--prod`.

**Budget:** 8 turnos.

**Falso verde:** `--dry-run` imprime la query hardcodeada sin construirla igual que la real. Mitigación: la rama `--prod` construye la misma query string y la imprime antes de ejecutar.

---

### E6 — Propuesta de fix por hallazgo + evaluación ventana H6

**Objetivo:** 1 sección por hallazgo (CONFIRMADO) con impacto + riesgo + archivos a tocar, SIN implementar.

**Files:**
- Create: `docs/auditoria/06_PROPUESTAS_FIX.md`

**Secciones obligatorias:**
- `## Propuesta P1-<hallazgo>`: resumen, impacto, riesgo, archivos a tocar, estrategia de rollout.
- Repetir por cada hallazgo CONFIRMADO.
- `## Ventana H6: reserva pendiente de reparto` — evaluación de la mejora propuesta por Mariano (crear reserva genérica al ingresar stock con BO pendiente). Qué archivos tocaría, qué choca con el diseño actual, SIN implementar.

**Gate ejecutable:**
```bash
test -f docs/auditoria/06_PROPUESTAS_FIX.md && \
P=$(grep -cE '^## Propuesta ' docs/auditoria/06_PROPUESTAS_FIX.md) && \
HC=$(grep -cE 'CONFIRMADA' docs/auditoria/03_HIPOTESIS.md) && \
VI=$(grep -cE '\| VIOLA ' docs/auditoria/02_INVARIANTES.md) && \
echo "Propuestas=$P ConfirmadaH=$HC VIOLA_I=$VI" && \
# Al menos tantas propuestas como hallazgos CONFIRMADOS + 1 (la ventana H6):
[ "$P" -ge "$((HC + 1))" ]
```

**Budget:** 6 turnos.

**Falso verde:** propuesta genérica ("agregar validación") sin archivo:línea ni impacto medido.

---

### E7 — Commits + CLAUDE.md reglas durables

**Objetivo:** 1 commit por etapa, y reglas durables aprendidas en CLAUDE.md.

**Gate ejecutable:**
```bash
# Al menos 7 commits en la rama audit-stock-flow desde su base en main
COMMITS=$(git rev-list --count origin/main..audit-stock-flow) && \
[ "$COMMITS" -ge 7 ] && \
# CLAUDE.md modificado en al menos 1 commit de esta rama
git log --name-only origin/main..audit-stock-flow | grep -q "^CLAUDE.md"
```

**Budget:** 3 turnos.

**Falso verde:** CLAUDE.md modificado con una regla trivial ("ser más cuidadoso"). Mitigación: la regla debe nombrar un invariante o un file:line específico.

---

## Condición de parada

- Todos los gates verdes → DONE
- Budget agotado en una etapa → STOP, reportar lo logrado, pedir ampliación
- Gate humano E5 → PAUSA (no cuenta como terminar)

## Riesgos transversales de falso verde

- **Flag OFF escondido**: el bug sólo se manifiesta con `localStorage.split_enabled=1` (feature flag v600). Mitigación: tests cubren el camino con la flag ON (bug visible) **y** OFF (comportamiento legacy, documentado como "superseded by flag ON").
- **Hybrid mode SAP+APP**: BO/ASIG tiene 2 fuentes (SAP SQs sin app match + pedidos-app state ∈ {BO,ASIG}). Un bug puede estar en una de las dos. Los tests deben nombrar la fuente explícitamente.
- **Timestamp bug ya fixeado v1126** (`toMillisSafe`): no debe aparecer en los hallazgos nuevos; si aparece, es signal de regresión y hay que escalar.
- **ADC credentials en prod query**: el wrapper `scripts/audit/*_adc` debe usar gcloud ADC, nunca `sa-key.json` en disco.
