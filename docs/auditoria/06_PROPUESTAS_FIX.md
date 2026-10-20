# E6 — Propuestas de fix por hallazgo (sin implementar)

> **Scope:** auditoría = read-only. Estas propuestas documentan el enfoque, archivos a tocar, impacto y riesgo. **No se implementan en esta rama.** El fix va en otra tarea con su propio PR y buy-in.

## Hallazgos CONFIRMADOS

| ID | Hallazgo | Veredicto | Prioridad |
|----|----------|-----------|-----------|
| **BUG-1** | H1 — `doConfirmPedido getDisp` sin cardCode | CONFIRMADA | ALTA (root cause del síntoma reportado) |
| **BUG-2** | H4 — flag OFF `split_enabled` kill switch | CONFIRMADA | MEDIA (requiere browser con la clave seteada) |
| **BUG-3** | FINDING-02 — Drift TTL 7d vs 15d entre src/pure y functions/core | CONFIRMADA | ALTA (data inconsistency sistemática) |
| **FIND-4** | FINDING-04 — 3 fórmulas distintas de "disponibilidad" conviven | observación | BAJA (consolidar es refactor, no bug) |
| **FIND-5** | FINDING-05 — `applyRepartoManualCore` marca `status='done'` con stock sobrante | observación | MEDIA (gap operativo) |
| **FIND-6** | FINDING-06 — Fallback inline usa fórmula v701 vieja | observación | BAJA (edge case bundle no carga) |

---

## Propuesta P1 — Fix BUG-1 (H1): pasar cardCode al getDisp del split

**Archivos a tocar (sin implementar):**
- `index.html:34720-34722` — call-site `getDisp` dentro de `doConfirmPedido.flatMap`.
- `index.html:26963-26972` — call-site análogo en `persistPendingEntry`.
- `src/pure/stock-realmente-disponible.js` — opcional, agregar helper `getStockUtilizableParaCliente(sku, cardCode, deps, opts)` que encapsule la fórmula del preview CPST.

**Fórmula propuesta:**
```js
// En doConfirmPedido, dentro de ord.flatMap:
const _cardCode = currentOrderClient?.cardCode || '';
getDisp: function(sku){
  if (!_cardCode || typeof window.getStockPorCliente !== 'function') {
    // fallback: comportamiento actual (sin cardCode)
    return Math.max(Number(window.getStockRealmenteDisponible(sku) || 0), 0);
  }
  const r = window.getStockPorCliente(sku, _cardCode);
  // Replica fórmula del preview CPST (_cpstRenderPreview, v1362):
  // disp = min(fisico, firmesPropias + residual)
  //   firmesPropias = reservadasPorCliente (ASIG+confirmed VIVAS del propio cliente)
  //   residual      = max(fisico - resPropias - resOtros, 0)
  const residual = Math.max(r.fisico - r.reservadasPorCliente - r.reservadasPorOtros, 0);
  return Math.min(r.fisico, r.reservadasPorCliente + residual);
},
```

**Impacto:**
- Pedidos ex-ASIG con qty ≤ Reservado(propio cliente) ahora viajan a SAP como confirmed en lugar de BO.
- SAP recibe las unidades que ya estaban asignadas al cliente.
- Resuelve el síntoma reportado (3u → 0 enviadas → fix: 3 enviadas).

**Riesgo:**
- Si otro cliente tiene BO del mismo SKU y por race condition se agrega entre el read y el commit, dos clientes podrían reclamar la misma unidad. Mitigación: la ASIG original ya protegía la unidad para el propio cliente — el fix solo descuenta esa protección en su favor.
- Edge case: `currentOrderClient` null o sin `cardCode` → fallback a comportamiento actual (no empeora el caso general).

**Rollback:**
- Fix quirúrgico (menos de 10 líneas tocadas). Revertir con `git revert`.

**Tests que pasan a verde post-fix:**
- `invariants.test.js > I2 > VIOLA I2 (RED): el call-site de doConfirmPedido deberia devolver utilizable(OESTE)=1`
- `invariants.test.js > I2 > VIOLA I2 end-to-end (RED): splitPedidoLine deberia dar state=confirmed qty=1`
- `invariants.test.js > I6 > VIOLA I6 (RED, encadenado con H1)`
- `end-to-end-stradic.test.js > PASO 8 (RED)`
- `end-to-end-stradic.test.js > PASO 11 edge-case (RED)`

---

## Propuesta P2 — Fix BUG-2 (H4 flag OFF): remover kill switch

**Archivos a tocar:**
- `index.html:7023-7029` — `window.isPedidoSplitEnabled` que lee `localStorage.split_enabled`.
- `src/pure/pedido-split.js:86-90` — rama legacy flag OFF.
- Posiblemente: callsites que inyecten `flagEnabled` desde ese helper.

**Opciones:**

### Opción A — Remover el kill switch (recomendado)

```js
// Antes:
if (!opts.flagEnabled) {
  const state = qty > 0 && disp >= qty ? 'confirmed' : 'BO';
  return [{ ...base, qty, qtyOpen: qty, state }];
}

// Después (siempre splittear):
// (eliminar la rama legacy entera)
if (qty <= 0)    return [{ ...base, qty: 0, qtyOpen: 0, state: 'BO' }];
if (disp <= 0)   return [{ ...base, qty, qtyOpen: qty, state: 'BO' }];
if (disp >= qty) return [{ ...base, qty, qtyOpen: qty, state: 'confirmed' }];
return [
  { ...base, qty: disp,       qtyOpen: disp,       state: 'confirmed' },
  { ...base, qty: qty - disp, qtyOpen: qty - disp, state: 'BO' },
];
```

**Impacto:** cualquier browser con `localStorage.setItem('split_enabled','0')` deja de reproducir el bug v600.

**Riesgo:** si algún stakeholder tenía la flag OFF intencional (p.ej. para dejar de partir pedidos de un cliente que no quiere BO parcial), este fix la quita. Precedente: la flag se agregó para rollout gradual v600, no para kill switch permanente.

### Opción B — Telemetría + aviso

Alternativa menos agresiva: dejar la flag, pero loguear si está `false` y mostrar un banner al usuario avisando "flag legacy activa, los pedidos parciales van 100% BO". **No fixea** el bug, solo lo hace visible.

**Tests que pasan post-fix (Opción A):**
- `invariants.test.js > I6 > VIOLA I6 (RED, flag OFF kill switch v600)`
- `invariants.test.js > I7 > VIOLA I7 (RED, flag OFF)`
- `end-to-end-stradic.test.js > PASO 3 (RED, flag OFF v600)`

---

## Propuesta P3 — Fix BUG-3 (FINDING-02): alinear TTL 7d / 15d

**Archivos a tocar:**
- `functions/core/pedido-snapshot-core.js:43` — `RESERVA_TTL_DAYS = 15`.
- `src/pure/stock-realmente-disponible.js:62` — `RESERVA_TTL_DAYS = 7`.

**Decisión necesaria por Mariano:**
- ¿Alinear ambos a 7d (más agresivo, libera stock antes)?
- ¿Alinear a 15d (más conservador, protege reservas más tiempo)?
- Precedente v1198 (2026-10-08): Mariano bajó src/pure a 7d explícitamente ("si ese cliente tiene esas 80 unidades por más de 7 días y no pasa nada, dejan de bloquear stock"). Sugerencia: alinear functions/core a 7d.

**Impacto:**
- Elimina inconsistencia entre VIEW cliente-side (modal muestra "disp 10") y server snapshot (backorderBySkuApp dice "reservado 10").
- Un VDE puede ver un SKU como libre y agregarlo al carrito, mientras que el server lo sigue contando como reservado hasta que la próxima recomputación corra.

**Riesgo:**
- Si alineás a 7d, muchas ASIG/BO viejas dejan de reservar de golpe → el `backorderBySkuApp` cae y pueden aparecer SKUs "libres" nuevos. Impacto en reports: dashboard puede mostrar un drop apparent.

**Fix refactor adicional (no requerido ahora):** dedupe `lineReservesStock` como shared package (ya está pendiente como backlog único en memoria `project_audit_bo_asig_v1126_v1127.md`).

**Query diagnóstico:** `scripts/audit/A_reservas_vivas_pedido_enviado.cjs` (E5-A) mide reservas con TTL expirado que la CF sigue contando.

---

## Propuesta P4 — FINDING-04: consolidar las 3 fórmulas de "disponibilidad"

**Archivos involucrados:**
- `index.html:16872-16898` — preview CPST (v1362).
- `index.html:34720-34722` — split `doConfirmPedido` (v1208).
- `index.html:26963-26972` — split `persistPendingEntry` (v802).
- `src/pure/stock-realmente-disponible.js` — fuentes puras.

**Propuesta:**
- Extraer `getStockUtilizableParaPedido(sku, cardCode, deps, opts)` como fn pura en `src/pure/stock-realmente-disponible.js`, exponerlo via `window.getStockUtilizableParaPedido`.
- Reemplazar las 3 inline-fórmulas por ese helper único.

**Impacto:**
- Única fuente de verdad para "qué puede entrar en el pedido". Elimina divergencia.

**Riesgo:**
- Refactor amplio. Mejor dividir en 3 PRs (uno por call-site). Primera iteración: solo call-site de `doConfirmPedido` (fix BUG-1).

**No urgente** — se hace naturalmente al implementar P1.

---

## Propuesta P5 — FINDING-05: GAP operativo PASO 9+10

**Archivos a tocar:**
- `functions/core/reparto-core.js:641-642` — regla de `nextStatus`.
- `index.html:20036` — filtro del listener del modal Reparto.

**Opciones:**

### Opción A — Dejar `status='in_progress'` si queda stock sobrante

```js
// Antes:
const nextStatus = errors.length === 0 ? 'done' : touched > 0 ? 'in_progress' : 'pending';

// Después (ejemplo):
const stockRestante = Number(ingresoDoc.qtyIngresada) - sumTotalAsignado;
const nextStatus = errors.length === 0
  ? (stockRestante > 0 && hayBOsPendientes ? 'in_progress' : 'done')
  : touched > 0 ? 'in_progress' : 'pending';
```

### Opción B — Admin confirma explícitamente "stock sobrante OK" al cerrar

UI del modal Reparto exige al admin elegir entre "cerrar y dejar stock libre" o "mantener en reparto para asignar más".

**Impacto:** la 1u sobrante del PASO 9 queda visible en el modal Reparto para que Pablo pueda asignarla sin esperar un nuevo ingreso físico.

**Riesgo:**
- Opción A requiere auditar qué pasa cuando el stock sobrante se consume por otro flow (ej. VDE que crea pedido manual y la unidad va a confirmed).
- Opción B agrega un paso UX.

---

## Propuesta P6 — FINDING-06: eliminar fallback inline que ignora v701

**Archivos a tocar:**
- `index.html:34737-34748` — fallback inline en `doConfirmPedido`.
- `index.html:26978-26999` — fallback inline en `persistPendingEntry`.

**Opción simple:** hacer fatal si el bundle no cargó (`throw new Error`) + reportar a Sentry. Es preferible fallar explícito que calcular mal con fórmula vieja.

**Impacto:** cero cuando el bundle carga (99.9%+ de los casos). Beneficio: elimina rama "silent wrong" que mezcla fórmulas.

**Riesgo:** si el bundle falla por un bug de build, los VDE no pueden crear pedidos. Mitigación: Sentry alert + rollback.

---

## Evaluación ventana H6 — "pendiente de reparto" (sin implementar)

**Propuesta original (Mariano):** al detectar ingreso con BO pendiente, crear en la misma transacción una reserva genérica "pendiente de reparto" por `min(ingresado, BO)`. Disponible pasa a ser `Físico − Reservado − PendienteDeReparto`. El reparto de Pablo convierte la genérica en reservas por cliente y libera lo que no asigne.

**Veredicto en el código actual:**

### Lo que ya existe

El código actual **ya protege la ventana H6** por diseño conservador v701: `getStockRealmenteDisponible` resta todos los BO abiertos del físico. Un cuarto cliente nunca verá "disponible = 1" si hay 1 unidad física y 2 BO pendientes (verificado en E3 H6 DESCARTADA + end-to-end PASO 5).

### Qué cambiaría con la propuesta

En la práctica, el estado "pendiente de reparto" es equivalente a "BO abierto pre-reparto". El código ya lo hace via `state='BO'` + `qtyOpen > 0`. No se gana protección adicional.

### Qué sí mejoraría

Separar conceptualmente "BO esperando stock futuro" vs "BO con stock físico esperando asignación admin" en la **UI**: hoy ambos caen en el mismo modal Backorder. Un state `'BO_PENDIENTE_REPARTO'` (o un flag `hasPhysicalStockForAssignment: true`) ayudaría al UX de Pablo. Pero no mejora O1 — ya está protegido.

### Archivos que tocaría si se decide implementar

- `functions/core/reparto-core.js` — `createIngresosRepartoFromDelta` ya hace esto implícitamente (marca `clientesBO[]`).
- `src/pure/stock-realmente-disponible.js` — `lineReservesStock` para contemplar el nuevo state si se agrega.
- `src/pure/backorder-sku-map.js` — mapear nuevo state a modal.
- `index.html:15789+` — `renderBackordersTab` para pintar nuevo state.

### Choca con el diseño actual

**Sí**, choca:
- Hoy la "reserva pendiente de reparto" vive en `ingresos_reparto/{id}.clientesBO[]` como snapshot. Es externa al pedido. Mover a `pedidos.lines[i].state='BO_PENDIENTE_REPARTO'` requiere duplicar lógica + migración.
- El flow Pablo decide manualmente qué asignar. La "genérica" propuesta por Mariano no permite distinguir cuánto es "para Sur" vs "para Oeste". El snapshot `clientesBO[]` ya tiene esa info.

**Recomendación:** no implementar la "reserva genérica pendiente de reparto". El código actual cumple O1. Si quiere mejorar UX, agregar un badge visual al modal Backorder ("tiene stock físico esperando reparto") usando `ingresos_reparto` como fuente.

---

## Resumen gate E6

- Propuestas totales: 6 (P1-P6) + 1 evaluación H6 = **7 secciones `## Propuesta` / `## Evaluación`**
- Hallazgos CONFIRMADOS en E2+E3: H1 (I2, I6-A), FLAG-OFF-v600 (I6-B, I7), FINDING-02 drift TTL = 3 root causes, +3 observaciones = 6 hallazgos.
- Propuestas P ≥ hallazgos + 1 ventana H6: ✅
