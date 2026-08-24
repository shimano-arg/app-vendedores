# PLAN — Backorder Split de Linea (bug confirmado 2026-08-24)

## Contexto

Auditoria del flujo backorder detecto que `pedidos.add()` es **todo-o-nada por linea**: si `disp < qty` (aunque sea por 1u), la linea entera queda `state='BO'` con `qtyOpen=qty`. Cero unidades van a SAP.

Mariano confirmo 2026-08-24 que el comportamiento esperado es **split**: enviar a SAP las unidades disponibles + dejar el faltante como BO en la app.

Caso 100 pedidas / 70 disponibles al confirmar:
- **Hoy**: 1 linea `state='BO'`, `qty=100`, `qtyOpen=100` → SAP recibe 0.
- **Esperado**: 2 lineas → `{qty:70, state:'confirmed', qtyOpen:70}` + `{qty:30, state:'BO', qtyOpen:30}` → SAP recibe 70, BO app = 30.

Comentarios en `index.html:4470` y `:4493` ya documentan la intencion de split ("verde con stock disponible, roja con el faltante"), pero **nunca se implemento** — es Chekhov's gun del diseno original.

## Diagnostico completo

### Escritura (2 sitios a partir)

**S1. `confirmExcelPedido` — `index.html:20257-20268`**
```js
lines: ord.map(l => {
  const _qty = parseFloat(l.qty) || 0;
  const _precio = parseFloat(l.precio) || 0;
  const _disp = (typeof getStockDisponibleVenta === 'function') ? (getStockDisponibleVenta(l.code) || 0) : 0;
  const _state = (_qty > 0 && _disp >= _qty) ? 'confirmed' : 'BO';
  return { code, desc, ..., qty: _qty, qtyOpen: _qty, state: _state, ... };
}),
```
Fix: cuando `0 < _disp < _qty`, generar 2 objetos en el array en lugar de 1. `ord.flatMap` en vez de `ord.map`.

**S2. `persistPendingEntry` — `index.html:15455-15476`**
```js
const _linesEnriched = (entry.lines || []).map(l => {
  const _qty = parseFloat(l.qty) || 0;
  // ...
  if (_prevState && _LOCKED_STATES.includes(_prevState)) {
    _state = _prevState;
  } else {
    const _disp = getStockDisponibleVenta(l.code) || 0;
    _state = (_qtyOpen > 0 && _disp >= _qtyOpen) ? 'confirmed' : 'BO';
  }
  return Object.assign({...}, l, { qtyOpen: _qtyOpen, state: _state });
});
```
Fix: mas delicado — la linea ya puede tener sido splitteada previamente por S1. Politica: si `l.state` ∈ LOCKED (ASIG/invoiced/cancelled/recycled), preservar. Sino, `flatMap` con split logic si `_prevState !== 'confirmed'` (evita re-splittear lineas confirmed que ya fueron enviadas a SAP; solo re-evaluar BO ↔ confirmed sobre lineas activas).

### Read side (verificar que aguanten multi-linea por SKU)

**R1. CF E3 `pedido-snapshot-core.js:99-130` (`aggregateForSku`)** — ✅ **OK sin cambios**
Itera todas las lines, suma `qtyOpen` por `state`. 2 lineas del mismo SKU (una `confirmed`, otra `BO`) suman correctamente separadas.

**R2. CF E4.5 `fifo-assign-core.js` (candidatos BO)** — ✅ **OK sin cambios**
Trata cada linea con `state='BO'` como candidato independiente. Si un pedido tiene {70 confirmed, 30 BO} del mismo SKU, solo la linea de 30 entra al FIFO. Correcto.

**R3. `sap-service-layer.js:409-427` (`buildQuotationPayload`)** — ✅ **OK sin cambios**
Filtra `state==='confirmed'` (L411) y despues **dedupea por ItemCode** (L419-427). Si hay 2 lineas del mismo SKU (una confirmed, una BO), solo la confirmed pasa el filter y el dedupe no hace nada. SAP recibe 1 sola linea con la qty correcta.

**R4. `sap-auto-send-listener.js:126-148`** — ✅ **OK sin cambios**
Ya maneja `DocumentLines.length===0` → `via='app_only'`. Ahora se dispararia menos porque casi siempre habra al menos 1 linea confirmed.

**R5. `invoice-sync-core.js:257-321` (`applyInvoiceMatch`)** — 🔴 **BUG PRE-EXISTENTE UNMASKED POR EL SPLIT**

Codigo actual (L279-298):
```js
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const invNow = invoicedByCode.get(up);
  if (!invNow) continue;
  const newInvoiced = already + invNow;  // ← usa la SUMA TOTAL para CADA linea
  const qtyOpen = Math.max(qty - newInvoiced - cancelled - recycled, 0);
  // ...
}
```

**Escenario post-split**: pedido tiene 2 lineas del mismo SKU X ({qty:70, state:'confirmed'} + {qty:30, state:'BO'}). SAP factura 70. `invoicedByCode.get('X') = 70`.
- Iteracion linea A: `newInvoiced = 0+70 = 70`, `qtyOpen = 70-70 = 0`, `state='invoiced'` ✓
- Iteracion linea B: `newInvoiced = 0+70 = 70`, `qtyOpen = 30-70 = 0` (clamp), `state='invoiced'` ✗ **INCORRECTO** — la linea BO se marca como facturada sin haber sido facturada.

**Fix**: consumir el `invoicedByCode` a medida que se asignan lineas. Politica FIFO: primero asignar a `state='invoiced'` (previamente parcialmente facturada), despues a `state='confirmed'` (con stock enviado a SAP), y NUNCA a `state='BO'` o `state='ASIG'`.

Codigo propuesto:
```js
const remaining = new Map(invoicedByCode);
const ORDER = ['invoiced', 'confirmed', 'ASIG']; // ASIG solo si vino de reciclado
for (const targetState of ORDER) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.state !== targetState && !(targetState === 'invoiced' && l.state === 'invoiced')) continue;
    const up = String(l.code).toUpperCase();
    const rem = remaining.get(up) || 0;
    if (rem <= 0) continue;
    const qty = Number(l.qty) || 0;
    const alreadyInv = Number(l.qtyInvoiced) || 0;
    const cancelled = Number(l.qtyCancelled) || 0;
    const recycled = Number(l.qtyRecycled) || 0;
    const openBefore = Math.max(qty - alreadyInv - cancelled - recycled, 0);
    if (openBefore <= 0) continue;
    const applyQty = Math.min(rem, openBefore);
    const newInvoiced = alreadyInv + applyQty;
    const qtyOpen = openBefore - applyQty;
    lines[i] = Object.assign({}, l, {
      qtyInvoiced: newInvoiced,
      qtyOpen,
      state: qtyOpen <= 0 ? 'invoiced' : l.state,
    });
    remaining.set(up, rem - applyQty);
    anyLineChanged = true;
  }
}
```

Este fix es **necesario incluso sin el split** — hoy no salta porque el modal Revisar dedupea SKUs antes de crear el pedido, pero si algun dia se cargan 2 lineas del mismo SKU manualmente el bug ya esta latente.

### UI

**U1. Modal Revisar (`viewPedido` render)** — 🟡 verificar
Al mostrar un pedido con lineas splitteadas del mismo SKU, la tabla de items va a mostrar 2 filas. Puede confundir al vendedor. Opciones:
- **A**: agrupar visualmente por SKU con badge "Splitted: 70 confirmed + 30 BO"
- **B**: mostrar como 2 filas normales con badge de state por fila
- **C**: agregar helper que colapsa por SKU en el render pero preserva el schema

Recomendacion: **B** (mas simple, coherente con como se muestra ASIG/BO en el modal Backorder v576+).

**U2. Modal Backorder / Stock Asig (v572+)** — ✅ probablemente OK
Estos modales iteran lines con state='BO' o 'ASIG'. Splitteo no cambia el read: cada linea BO se procesa independiente.

**U3. Archivo Cliente / exports (v565+)** — 🟡 verificar
`v565` politica: columna `Pedido = min(qty, dispSap)`. Con split, ahora hay 2 lineas por SKU. El calculo debe agrupar por SKU antes de aplicar min. Grep necesario: donde se lee `p.lines` en exports.

**U4. Dashboard `importeLineasArsNeto` (v580)** — ✅ OK
Suma linea por linea, 2 lineas del mismo SKU suman igual que 1.

## Etapas

### E0 — Buy-in Santi (bloqueante)

**Que**: mail o mensaje resumiendo el bug + fix propuesto (split de linea al confirmar). Adjuntar caso 100/70 → 70 SAP + 30 BO.

**Por que**: aplica `feedback_validar_stakeholders_planes_grandes.md`. Cambia el flujo SAP (mas SQs con qty menores en lugar de 0). Impacto: mas Ofertas de Venta en SAP con quantities partial. Santi tiene que confirmar que esta OK con esto operativamente.

**Gate**: OK escrito de Santi. Sin esto, no seguir.

### E1 — Fix invoice-sync-core `applyInvoiceMatch` (bug pre-existente, standalone)

**Que**: reemplazar el loop de `applyInvoiceMatch` con el algoritmo consumidor de `remaining` (arriba).

**Por que**: es fix estandalone que NO depende del split, y **es requisito** para que E2 no rompa la conciliacion de facturas.

**Archivos**:
- `functions/core/invoice-sync-core.js:257-321` — reescribir loop
- `functions/core/invoice-sync-core.test.js` — agregar tests:
  - 1 linea del mismo SKU, invoice completa → linea invoiced ✓
  - 1 linea del mismo SKU, invoice parcial → qtyInvoiced += parcial, state='confirmed'/'BO' preservado
  - **2 lineas del mismo SKU (confirmed + BO)**, invoice cubre solo confirmed → linea A invoiced, linea B intacta
  - 2 lineas del mismo SKU (invoiced + confirmed), invoice adicional → primero completa la invoiced, despues aplica a confirmed
  - Idempotencia: 2do run con mismo docEntry → skip

**Gate ejecutable**:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
npm test -- functions/core/invoice-sync-core.test.js
# Todos los tests OK, coverage del branch nuevo
```

**Deploy**: `firebase deploy --only functions:syncSapInvoicesToApp`

### E2 — Split logic en `confirmExcelPedido` (S1)

**Que**: cambiar `ord.map` a `ord.flatMap` en `index.html:20257`. Si `0 < _disp < _qty`, retornar 2 objetos:

```js
lines: ord.flatMap(l => {
  const _qty = parseFloat(l.qty) || 0;
  const _precio = parseFloat(l.precio) || 0;
  const _disp = (typeof getStockDisponibleVenta === 'function') ? (getStockDisponibleVenta(l.code) || 0) : 0;
  const _base = {
    code: l.code, desc: l.desc, cat: l.cat||'', fam: l.fam||'', sub: l.sub||'',
    precio: _precio, needsReview: !!l.needsReview,
    qtyInvoiced: 0, qtyCancelled: 0, qtyRecycled: 0,
    asigAt: null, recycledIntoPedidoId: null,
    priceAtCreation: _precio,
  };
  // Caso 1: sin stock → todo BO
  if (_qty > 0 && _disp <= 0) {
    return [{ ..._base, qty: _qty, qtyOpen: _qty, state: 'BO' }];
  }
  // Caso 2: stock suficiente → todo confirmed
  if (_qty > 0 && _disp >= _qty) {
    return [{ ..._base, qty: _qty, qtyOpen: _qty, state: 'confirmed' }];
  }
  // Caso 3: stock parcial → split
  if (_qty > 0 && _disp > 0 && _disp < _qty) {
    return [
      { ..._base, qty: _disp, qtyOpen: _disp, state: 'confirmed' },
      { ..._base, qty: _qty - _disp, qtyOpen: _qty - _disp, state: 'BO' },
    ];
  }
  // Caso 4: qty=0 (edge, no deberia pasar) → conservar linea sola sin state especial
  return [{ ..._base, qty: 0, qtyOpen: 0, state: 'BO' }];
}),
```

**Consideracion**: el subtotal (`_subtotalArs`) se calcula ANTES de esta seccion (linea ~20205 aprox). Split no lo afecta porque suma qty*precio y las qty splitteadas suman igual al original.

**Archivos**:
- `index.html:20257-20268` — cambio `map`→`flatMap` + logica split
- `tests/unit/pedido-split.test.js` — NUEVO test unitario que extrae la logica a funcion pura y testea los 4 casos

**Gate ejecutable**:
```powershell
npm test -- tests/unit/pedido-split.test.js
node build.js  # rebuild bundle
# Smoke manual en preview: cargar 100 unidades de un SKU con disp=70, confirmar,
# verificar en Firestore emulator/preview que el doc tiene 2 lineas
```

### E3 — Split logic en `persistPendingEntry` (S2)

**Que**: mismo pattern en el re-enrich. Preservar LOCKED_STATES intactos. Sobre lineas sin state locked, aplicar split solo si aun no fue splitteada (heuristica: si hay otra linea del mismo code+precio en el pedido, ya se splitteo — no re-splittear).

**Politica simplificada**: si `_prevState === 'confirmed'` NO re-evaluar (la linea ya viajo a SAP, no tocar). Si `_prevState === 'BO'`, re-evaluar con la logica split de E2 y potencialmente reemplazar la linea BO por {confirmed + BO nuevo} si el stock aumento.

**Riesgo**: mutar en medio del `map` cambia el largo del array. Cambiar tambien a `flatMap` y devolver la linea existente sin cambios si el state esta locked o si es confirmed y no queremos re-evaluar.

**Archivos**:
- `index.html:15455-15476` — cambio `map`→`flatMap` + logica split condicional
- `tests/unit/pedido-split.test.js` — extender con casos de re-enrich (locked preservado, BO con stock nuevo splittea)

**Gate ejecutable**: mismos tests. Preview manual: editar un pedido pendiente en la UI, verificar que las lineas locked no se tocan.

### E4 — UI Modal Revisar: badge por state (U1)

**Que**: en `viewPedido` render, agregar visualmente el `state` por linea. Opciones B (2 filas con badge por fila).

**Archivos**: buscar donde se renderiza la tabla de items del pedido (grep `p.lines.map` en index.html).

**Gate**: preview manual — pedido splitteado se ve claro para el vendedor. VDE de piloto (BROBRO SA?) confirma que se entiende.

### E5 — Verificar exports / Archivo Cliente (U3)

**Que**: grep `p.lines` en index.html para todos los sitios de export. Agregar helper `groupLinesBySku(lines)` que colapsa por SKU sumando `qty` y `qtyOpen`. Usar en exports donde hoy se asume 1 linea = 1 SKU.

**Archivos**: grep pending. Estimo 3-6 sitios (export "Todo", export Archivo Cliente, dashboard tarjetas, modal cliente general).

**Gate ejecutable**:
```powershell
npm test -- tests/unit/dataset-export-integration.test.js
# Verificar que el export xlsx del cliente splitteado suma qty correcta (100, no 70+30 en filas separadas si el export es "por SKU")
```

### E6 — Backfill (NO se hace)

**Que**: pedidos legacy pre-E2 quedan con sus lineas `state='BO'` originales (qtyOpen=qty completa). NO se auto-migran a split — es la foto historica de que ese pedido, al confirmarse, no tenia stock parcial.

**Excepcion**: si un pedido pre-E2 tiene lineas `state='confirmed'` que ya viajaron a SAP, quedan iguales (ya se facturaron o estan open en SAP).

**Riesgo**: el aggregate `backorderBySkuApp` va a tener valores mas bajos post-E2 (porque las nuevas BO son solo el faltante, no la qty completa). Comunicar al equipo comercial que la metrica cambia de semantica.

### E7 — Rollout gradual con feature flag

**Que**: gate `localStorage.split_enabled = '1'` en E2/E3. Piloto solo Mariano + Santi. Despues admin/gerente. Despues todos.

**Por que**: cambio de semantica en un flujo critico. Rollback rapido si algo se rompe.

**Archivos**:
- `index.html:20257-20268` — envolver split logic en `if (localStorage.getItem('split_enabled') === '1') { ... } else { <codigo actual todo-o-nada> }`
- `index.html:15455-15476` — idem

**Gate**: 1 semana en piloto sin issues → activar para todos. Sacar flag en la version siguiente.

### E8 — Cleanup

**Que**: sacar el flag, comprimir la funcion, actualizar README con el nuevo comportamiento oficial.

## Testing global

- **Unit tests nuevos**: `tests/unit/pedido-split.test.js` (E2/E3), extender `invoice-sync-core.test.js` (E1)
- **Smoke test**: cargar pedido manual en preview, verificar Firestore state
- **Manual regression**: 
  - Pedido 100% stock → 1 linea confirmed (regresion cero)
  - Pedido 100% sin stock → 1 linea BO (regresion cero)
  - Pedido parcial → 2 lineas ✓
  - Pedido parcial + factura completa del confirmed → linea A invoiced, linea B intacta ✓
  - Pedido parcial + stock entra → E4.5 promueve BO→ASIG solo esa linea ✓

## Bump version

- `APP_VERSION` + `CACHE_VERSION` en `sw.js` + tabla en README.md
- Sugiero version tag: v600 (nuevo hito semantico)

## Deploy plan

1. Rama `dev` — todos los commits
2. E1 primero (fix standalone) → PR squash a main → deploy CF
3. E2/E3 juntos (split logic escritura) → PR squash → deploy Pages
4. E4/E5 (UI + exports) → PR squash → deploy Pages
5. E7 (flag OFF por default) → PR squash — piloto ON manualmente
6. Post-piloto (1 semana): E8 cleanup (remove flag) → PR squash

## Referencias

- Memoria: `project_backorder_split_line_bug.md`
- Contexto plan hybrid BO/ASIG: `project_backorder_plan.md`
- Auditoria completa: conversacion 2026-08-24
- Chekhov's gun: comentarios `index.html:4470` y `:4493` ya documentan la intencion

## Riesgos

| Riesgo | Mitigacion |
|---|---|
| `invoice-sync` pisa lineas BO como invoiced (bug pre-existente) | E1 antes que todo lo demas |
| VDE confuso con 2 filas del mismo SKU | E4 badge visual + comunicacion previa |
| Exports duplican SKU | E5 helper `groupLinesBySku` |
| Pedidos legacy quedan raros en el aggregate | Documentar en README, no backfill |
| Race condition entre E2 (nuevo pedido split) y E4.5 (FIFO viejo) mientras se despliega | Deploy CF antes de UI, hybrid mode tolera transicion |
| Santi rechaza el fix por overhead de mas SQs en SAP con qty menores | E0 buy-in bloqueante |
