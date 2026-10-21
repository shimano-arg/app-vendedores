# E1 — Mapa del flujo real paso 0-11

> **Fuente:** 3 agentes `general-purpose` paralelos sobre `origin/main` 2026-10-20
> (rama `audit-stock-flow`). Cross-checked por lectura directa.
> **Alcance:** read-only. Ningún archivo de `src/`, `functions/` o `index.html` fue modificado.

## Resumen

| Paso | Flujo | Veredicto |
|------|-------|-----------|
| 0    | Estado inicial / Físico-Reservado-Disp | OK, fórmula central `getStockRealmenteDisponible` |
| 1    | Carga Lista de Espera | OK — `revisionWaitlist` NO reserva, salvo CPST |
| 2    | Envío disp>=qty | OK — split flag ON idéntico a OFF |
| 3    | Envío parcial | split flag ON OK; **flag OFF ⇒ bug legacy (todo BO)** |
| 4    | Envío disp=0 | OK |
| 5    | Ingreso stock dep 11 | **CAMBIO 2026-10-14 (v1279):** reparto 100% manual, FIFO automático eliminado |
| 6    | Pablo reparte | `applyRepartoManualCF` + `applyRepartoManualCore` |
| 7    | "Crear Pedido Desde Stock Asignado" (CPST) | **Preview `_cpstRenderPreview` usa fórmula por cliente (CORRECTA)** |
| 8    | VDE confirma pedido ex-ASIG | **BUG H1 CONFIRMADO:** `doConfirmPedido` → split usa fórmula GLOBAL (sin cardCode) |
| 9    | Ingresa stock sobrante | Pablo decide (ya no auto-FIFO) |
| 10   | Pablo reparte restante | mismo mecanismo que PASO 6 |
| 11   | 3 modales vacíos (caso feliz) | caso bug: Backorder del nuevo pedido NO queda vacío |

## Snippet decisivo del BUG (H1)

**`doConfirmPedido` — `index.html:34720-34722`:**
```js
getDisp: function(sku){
  if (typeof window.getStockRealmenteDisponible === 'function') {
    return Math.max(Number(window.getStockRealmenteDisponible(sku) || 0), 0);
  }
  // ...
}
```

`window.getStockRealmenteDisponible(sku)` NO recibe el `cardCode` del cliente del pedido. La propia ASIG del cliente (que el CPST está por consumir) cuenta como "comprometida" → `disp=0` → split cae en caso 2 → **línea entera queda BO** → bloque v607 (`index.html:34849`) auto-marca `transferidoSAP: {via:'app_only', reason:'all_lines_bo'}` → **nunca se intenta enviar a SAP**.

Mientras tanto, `_cpstRenderPreview` (`index.html:16842-16946`, v1362 2026-10-19) usa una fórmula distinta POR CLIENTE:
```
firmesPropias = Σ qtyOpen(ASIG+confirmed vivas del MISMO cardCode)
residual      = max(fisico − resPropias − resOtros, 0)
disp_preview  = min(fisico, firmesPropias + residual)
```
Esto muestra "Stock utilizable 1" al admin. **La UI engaña**: el preview es correcto, el commit es bug.

---

## PASO 0 — Estado inicial (Físico / Reservado / Disp en UI)

**Físico (dep 11 raw desde SAP):** `index.html:7478-7497` — `getStockDisponibleVenta(sku)`.
Lee `STOCK_WAREHOUSE_BREAKDOWN[sku]['11']`. Snapshot poblado por listener Firestore sobre `app_config/stock_snapshot` (cron 30 min).

**Disp real (físico menos compromisos app):** `src/pure/stock-realmente-disponible.js:212-261` — `getStockRealmenteDisponible(sku, deps, opts)`.
```
disponible_real(sku) = max(0, fisico - Σ qtyOpen de lineas con state IN ('confirmed','BO','ASIG') que pasen lineReservesStock)
```
Wrapper runtime en `index.html:7063-7076` inyecta `pedidos: globalPedidos` + `waitlistEntries: _getWaitlistCpstEntries()`.

**Desglose por cliente:** `src/pure/stock-realmente-disponible.js:282-347` — `getStockPorCliente(sku, cardCode, deps, opts)`.
Devuelve `{fisico, reservadasPorCliente, reservadasPorOtros, libreParaCliente, disponibleReal, yaEnOtroPedido}`.
Memoizada via `getStockPorClienteMemo` (líneas 380-408), WeakMap keyed por `pedidos` ref, TTL 5s.

**Gate reserva por línea:** `src/pure/stock-realmente-disponible.js:146-202` — `lineReservesStock(line, nowMs, pedido)`.
Reglas: ASIG/confirmed/BO con TTL 7 días; `asigReserva===false|0` libera; otros estados no reservan.

---

## PASO 1 — Carga en Lista de Espera (`revision_waitlist`, NO reserva stock)

**Función:** `window.revisionDejarRecalculando` — `index.html:21351-21517`.
Persiste `revision_waitlist/{autoId}` con `source` ausente (manual). Optimistic update en `revisionWaitlist[]`.

**NO reserva stock** porque `_getWaitlistCpstEntries` (`index.html:7054-7061`) filtra waitlist entries por `source === 'stock-asignado-batch'` y además descarta las que tienen `pedidosOrigenes[]` populated (fix v1368). Un entry manual nunca cumple el filtro.

---

## PASO 2 — Envío disp >= qty → 100% confirmed → SAP

**Entrypoint A (nuevo pedido):** `index.html:34491` — `window.doConfirmPedido` (2da definición, v1058+).
**Entrypoint B (edit pending):** `index.html:26944-27003` — `persistPendingEntry`.

Ambos construyen `docData.lines` llamando `splitPedidoLine`:

**`src/pure/pedido-split.js:64-109` — `splitPedidoLine`:**
```js
if (!opts.flagEnabled) {
  const state = qty > 0 && disp >= qty ? 'confirmed' : 'BO';
  return [{ ...base, qty, qtyOpen: qty, state }];
}
if (qty <= 0)    return [{ ...base, qty: 0, qtyOpen: 0, state: 'BO' }];
if (disp <= 0)   return [{ ...base, qty, qtyOpen: qty, state: 'BO' }];
if (disp >= qty) return [{ ...base, qty, qtyOpen: qty, state: 'confirmed' }];  // PASO 2
return [
  { ...base, qty: disp,       qtyOpen: disp,       state: 'confirmed' },        // PASO 3 split
  { ...base, qty: qty - disp, qtyOpen: qty - disp, state: 'BO' },
];
```

**Feature flag `localStorage.split_enabled`:** `index.html:7023-7029` — default ON desde v620 (2026-08-25); kill switch per-browser.

**Envío a SAP:** `src/domains/sap-auto-send-listener.js:30-372` — `ensureSapAutoSendListener`. Listener sobre `pedidos.where('stage','==','confirmed')`. Idempotencia por `transferidoSAP` + `sendingSapLock` TTL 300s.

---

## PASO 3 — Envío parcial (0 < disp < qty) → SPLIT

Mismo entrypoint que PASO 2.

**Flag ON (default):** `src/pure/pedido-split.js:104-108` — split en 2 líneas (`confirmed` + `BO`).
**Flag OFF (legacy):** línea 87 → `state = (disp >= qty) ? 'confirmed' : 'BO'` → **todo-o-nada**. Era el bug v600 original (CHALPAC: 2u de 22CATPRII420, disp=1, iban 100% BO con flag OFF).

**Riesgo persistente:** si un browser quedó con `localStorage.setItem('split_enabled','0')` por testing viejo, el bug legacy sigue vivo para ese usuario. No hay telemetría que lo detecte.

**`getDisp` inyectado en `doConfirmPedido`:** `index.html:34720-34733` (v1208 2026-10-08). Usa `window.getStockRealmenteDisponible(sku)` — **sin cardCode**. Alineado con "Revisá tu Pedido" pero NO con el preview CPST.

Snapshot/cache intermedio: CF `onPedidoWriteRecalcSnapshot` → `functions/core/pedido-snapshot-core.js:206-363` recalcula `backorderBySkuApp[sku]` y `asigBySkuApp[sku]` en `app_config/stock_snapshot_app`. UI mergea con `stock_snapshot` (SAP-source) en read-side.

---

## PASO 4 — Envío disp = 0 → todo BO

**`src/pure/pedido-split.js:96-99` (flag ON):**
```js
if (disp <= 0) {
  return [{ ...base, qty, qtyOpen: qty, state: 'BO' }];
}
```

Flag OFF: idéntico resultado. La CF `syncSapInvoicesToApp` nunca toca estas líneas (no viajaron a SAP). `sap-auto-send-listener` filtra por `line.state === 'confirmed'`, salta las BO.

Si **todo** el pedido es BO: bloque v607 (`index.html:34849-34873`) auto-marca `stage='confirmed'` + `transferidoSAP:{via:'app_only', reason:'all_lines_bo'}`.

---

## PASO 5 — Ingreso stock dep 11

**⚠️ CAMBIO DE DISEÑO v1279 (2026-10-14):** `onStockChangeFIFOAssign` **ELIMINADA**. Reparto es 100% manual.

**Flow actual:**
1. `scripts/sync_sap_to_firestore.py:715-777` → `write_stock_snapshot` escribe `app_config/stock_snapshot` con `warehouseBreakdown`.
2. CF `onDep11IncreaseCreateReparto` (`functions/index.js:920-944`) dispara al write.
3. `functions/core/reparto-core.js:101-113` → `detectDep11Increases(before, after)` detecta deltas positivos por SKU.
4. Por cada SKU con delta:
   - `extractClientesBOForSku` (`reparto-core.js:157-206`) ordena FIFO por `createdAt` ASC + tiebreak alfabético pedidoId.
   - Si no hay BO: skip (stock queda libre).
   - Dedup por `dedupeKey = sku + '|' + afterDep11`.
   - Crea `ingresos_reparto/{autoId}` con `status='pending'`, `clientesBO[]`, `qtyIngresada=delta`.

**Modal "Reparto":** `#reparto-modal` (HTML `index.html:6682-6701`) + `openRepartoModal` + `_repartoSubscribe` (`index.html:19997-20144`). Es un modal independiente, NO tab del Backorder.
Listener: `fbDb.collection('ingresos_reparto').where('status','in',['pending','in_progress']).orderBy('detectedAt','desc').onSnapshot(...)`.

**Virtual ASIG (cliente-side only):** `src/pure/virtual-asig-fifo.js:46-164` — `computeVirtualAsigFifo(pedidos, getStk, nowMs)`. Pinta badge "virtual ASIG" en modal "Pedido en espera" (`index.html:22459-22461` y `25131-25133`). **NO muta Firestore.**
Prioridad FIFO: líneas 147-152 — ordena por `createdAt` ASC, luego `pedidoId.localeCompare`, luego `lineIndex`.

**Comportamiento parcial** (Físico=1 + BO=2): `virtual-asig-fifo.js:153-160` → `allocated = Math.min(remaining, b.qtyOpen)`. Pedido más viejo gana primero.

---

## PASO 6 — Pablo reparte

**Callable:** `functions/index.js:965-1037` — `applyRepartoManualCF`.
**Core:** `functions/core/reparto-core.js:411-679` — `applyRepartoManualCore`.
Payload: `{ ingresoId, assignments:[{pedidoId, lineIndex, qtyAsignada}], eliminations:[...] }`.

**Mutate BO → ASIG** (líneas 582-612):
```js
const qr = Math.max(0, qo - asig - elim);
const newOrig = Object.assign({}, line, {
  qtyCancelled: (Number(line.qtyCancelled) || 0) + elim,
  qtyOpen: qr,
});
if (qr === 0 && asig > 0 && elim === 0) {
  newOrig.qtyOpen = asig; newOrig.state = 'ASIG';
  newOrig.asigAt = nowIso; newOrig.asigReserva = true;
  newOrig.asigFromReparto = opts.ingresoId;
  lines[action.lineIndex] = newOrig;
} else {
  lines[action.lineIndex] = newOrig;
  if (asig > 0) lines.push(_buildAsigLine(line, asig, nowIso, opts.ingresoId, action.lineIndex));
}
```

Operación por-pedido dentro de `runTransaction` (línea 523).

**Guards:**
- `line.code === ingresoDoc.sku` (línea 549-560, anti-spoofing).
- `line.state === 'BO'` (línea 567-576, solo BO repartible).
- `sum(assignments) <= stockFisicoDep11` (línea 450-463, cap global).
- `ingreso.status: 'in_progress'` lock PRE-loop (línea 468-482, anti-double-apply).

**Cap `asig+elim <= qtyOpen` REMOVIDO en v1338** (línea 579-581): over-asignación posible por decisión consciente ("Mariano toma la responsabilidad").

**Refresh UI tras reparto:** listener `app_config/stock_snapshot_app` (`index.html:30406-30428`) + CF `onPedidoWriteRecalcSnapshot` → `pedido-snapshot-core.js:206-245` (`aggregateForSku`). Repuebla `STOCK_ASIG_APP` + `STOCK_BACKORDER_APP` consumidos por `renderBackordersTab` (`index.html:15789+`).

---

## PASO 7 — "Crear Pedido Desde Stock Asignado" (CPST)

**Botón UI:** `index.html:6051-6063`.
**Modal abrir:** `index.html:16579-16594` — `window.openCrearPedidoSTModal`.
**Cache clientes CPST:** `index.html:16612-16746` — `_cpstBuildCache`.
**Preview:** `index.html:16842-16946` — `_cpstRenderPreview`.
**Persist waitlist:** `index.html:17249-17475` — `window._cpstConfirmar`.

### Preview — fórmula POR CLIENTE (correcta, v1362 2026-10-19)

```js
// index.html:16872-16898
let qtyAjustada = sk.qty;
if (cardCode && typeof window.getStockPorCliente === 'function') {
  const stk = window.getStockPorCliente(sk.sku, cardCode);
  const _fisico      = Number(stk && stk.fisico) || 0;
  const _resPropias  = Number(stk && stk.reservadasPorCliente) || 0;
  const _resOtros    = Number(stk && stk.reservadasPorOtros) || 0;
  let _firmesPropias = 0;
  for (const _p of globalPedidos) {
    if (!_p || _p.closedAt) continue;
    if (String(_p.clientCardCode || '').trim() !== cardCode) continue;
    for (const _l of _p.lines) {
      if (String(_l.code).toUpperCase() !== _skuUp) continue;
      if (_l.state !== 'ASIG' && _l.state !== 'confirmed') continue;
      if (_lrsFn && !_lrsFn(_l, _nowMs, _p)) continue;
      _firmesPropias += Number(_l.qtyOpen) || 0;
    }
  }
  const _residual = Math.max(_fisico - _resPropias - _resOtros, 0);
  const disp      = Math.min(_fisico, _firmesPropias + _residual);
  qtyAjustada     = Math.min(sk.qty, disp);
}
```

En el escenario Oeste con STRADIC-2500 (fisico=1, resPropias=1 ASIG Oeste, resOtros=0):
- `firmesPropias = 1`
- `residual = max(1 − 1 − 0, 0) = 0`
- `disp = min(1, 1 + 0) = 1`
- UI muestra **"Stock utilizable 1"** ✅

### Persist (sin cambiar lineas ASIG, v1280 2026-10-14)

`index.html:17411-17441`:
```js
const payload = {
  // ...
  source: 'stock-asignado-batch',
  items: items,
  pedidosOrigenes: pedidosOrigenes,  // [{pedidoId, lineIndex, sku, qtyAsignada}, ...]
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  // ...
};
await waitlistRef.set(payload);
```

Las líneas ASIG originales siguen vivas hasta que el VDE "Pase a Pendientes" (ver PASO 8). `expireStockAsignadoWaitlistsCF` cron 04:00 ART borra waitlists CPST con `expiresAt < now && stage != 'consumed'`.

---

## PASO 8 — VDE confirma pedido ex-ASIG → envío a SAP (y el BUG)

**Función:** `index.html:34491-34787` — `window.doConfirmPedido` (2da definición, v1058+).

### Split (PUNTO CRÍTICO H1)

`index.html:34702-34736`:
```js
lines: ord.flatMap(l => {
  const _splitFn = window.__phase0?.pure?.splitPedidoLine;
  if (_splitFn) {
    return _splitFn(l, {
      getDisp: function(sku){
        if (typeof window.getStockRealmenteDisponible === 'function') {
          return Math.max(Number(window.getStockRealmenteDisponible(sku) || 0), 0);
        }
        // fallback dep11 − ASIG
      },
      flagEnabled: window.isPedidoSplitEnabled(),
    });
  }
  // ...
}),
```

`window.getStockRealmenteDisponible(sku)` (`index.html:7063-7076` → `src/pure/stock-realmente-disponible.js:212-261`):

```
disp_split = max(0, fisico − Σ qtyOpen(TODAS las lineas confirmed/BO/ASIG vivas, cualquier cliente))
```

**NO distingue cliente.** Al momento del split, las ASIG originales de Oeste **siguen vivas** (v1280 las cancela DESPUÉS del `.add()`, bloque `index.html:34881-34967`). Entonces:
- `fisico = 1`
- `comprometido = 1 (su propia ASIG)`
- `disp = 0`
- `splitPedidoLine({qty:1}, {getDisp: ()=>0, flagEnabled:true})` → `disp<=0` → `[{qty:1, qtyOpen:1, state:'BO'}]`

El pedido B queda **100% BO**.

### Auto-marcado "app_only"

`index.html:34849-34873`:
```js
const _allBo = (docData.lines || []).length > 0 && (docData.lines || []).every(l => l && l.state === 'BO');
if (_allBo) {
  fbDb.collection('pedidos').doc(ref.id).update({
    stage: 'confirmed',
    finalizedAt: _nowIso,
    transferidoSAP: {
      via: 'app_only',
      reason: 'all_lines_bo',
      // ...
    },
  });
}
```

**SAP NUNCA RECIBE EL PEDIDO.** `sap-auto-send-listener` filtra por `line.state === 'confirmed'` — las BO no viajan. Al estar `transferidoSAP` populated, el listener considera el pedido "ya transferido" y lo salta.

### Cancelación ASIG original (post-add)

`index.html:34881-34967` (`_origenesACancelar`):
```js
if (qty === qo) {
  u.newLines[li] = Object.assign({}, linea, {
    qtyOpen: 0,
    qtyCancelled: (Number(linea.qtyCancelled) || 0) + qty,
    state: 'cancelled',
    cancelledAt: _nowCancelIso,
    cancelledFrom: 'waitlist-confirm',
    cancelledIntoPedidoId: ref.id,
  });
}
// ...
await fbDb.collection('pedidos').doc(pid).update({ lines: u.newLines, ... });
```

Las ASIG se cancelan **después** de que el pedido B ya fue creado. **Es tarde**: el pedido B ya quedó 100% BO.

### Liberación de reserva — 3 caminos

| Camino | Archivo:línea | Trigger |
|--------|---------------|---------|
| 1 — Cancelación ASIG original | `index.html:34881-34967` | Al confirmar pedido ex-ASIG (dentro de `doConfirmPedido.then()`) |
| 2 — Invoice SAP → `state=invoiced` | `functions/core/invoice-sync-core.js:276-402` → `applyInvoiceMatch` | CF scheduled 15min cuando Pablo factura la SQ en SAP |
| 3 — Recycle/Cancel manual | `functions/core/asig-recycle-core.js:67-202` → `updateAsigLineState` | Modal detalle de ASIG, NO usado por CPST |

---

## PASO 9 — Ingreso stock sobrante (más de lo pedido)

**Flow actual (post-v1279) — Pablo decide:**
1. Dep 11 pasa de 0 → 2 unidades.
2. `onDep11IncreaseCreateReparto` detecta delta=2, crea `ingresos_reparto/{id}` con `qtyIngresada=2`, `clientesBO=[Sur (qtyBackorder=1)]` (si tras PASO 6 Sur quedó con 1u BO).
3. Pablo abre modal Reparto, ve ingreso con 2 unidades + 1 cliente (Sur) con BO=1.
4. Pablo asigna 1 a Sur. La otra queda libre en dep 11.
5. Después del write, `getStockRealmenteDisponible = 2 - 1 (ASIG Sur) = 1`.

**No hay auto-asignación.** El código `applyRepartoManualCore` sólo muta líneas con asignación explícita.

**⚠️ GAP OPERATIVO:** `reparto-core.js:641-642`:
```js
const nextStatus = errors.length === 0 ? 'done' : touched > 0 ? 'in_progress' : 'pending';
```
Si Pablo asigna 1 de 2u (PASO 9) y hace click Confirmar, el callable marca `status='done'`. El modal Reparto filtra `.where('status','in',['pending','in_progress'])` → el ingreso desaparece. Para asignar la 2a unidad (PASO 10), Pablo necesita esperar un nuevo write a `stock_snapshot` que dispare un `ingresos_reparto` nuevo. Si el stock físico no cambia, la 1u sobrante queda huérfana hasta otro ingreso. **Riesgo documentado como hallazgo H6-adyacente.**

---

## PASO 10 — Pablo reparte la restante

Mismo mecanismo que PASO 6: nuevo `ingresos_reparto` (requiere delta en dep 11) → `applyRepartoManualCF` muta BO=1 restante de Sur a ASIG. CF `onPedidoWriteRecalcSnapshot` refresca UI.

---

## PASO 11 — 3 modales vacíos (caso feliz contrafactual)

**Función central:** `index.html:15789-15960+` — `window.renderBackordersTab` (switch por `backordersMode`).

Filtro:
```js
// index.html:15842-15846
const hasOpenBoAsig = Array.isArray(p.lines) && p.lines.some(l => l
  && (l.state === 'BO' || l.state === 'ASIG')
  && (Number(l.qtyOpen) || 0) > 0);
if (!hasOpenBoAsig) continue;
```

Los 3 modales (`urgente` = Backorder, `asignacion` = Stock Asignado, modal Reparto independiente) usan `src/pure/backorder-sku-map.js` + wrapping en `index.html:15218-15360` → iteran `globalPedidos` filtrando `state IN ('BO','ASIG')` + `qtyOpen > 0`.

**Caso feliz contrafactual:** ASIG originales canceladas, pedido B pasó a `confirmed` → `invoiced` → `qtyOpen=0`. Nada aparece.

**Caso bug H1 real:** ASIG originales canceladas pero pedido B queda `state='BO', qtyOpen=1`. Modal Backorder (modo `urgente`) MUESTRA ese BO → **modal NO queda vacío**. Stock Asignado SÍ vacío. Reparto vacío.

---

## Hallazgos preliminares (summary para E2/E3)

### FINDING-01 — BUG H1 CONFIRMADO (crítico, root cause del síntoma reportado)

Diferencia de fórmulas entre preview CPST y commit del pedido ex-ASIG:

| Fase | File:line | Fórmula | Considera cardCode |
|------|-----------|---------|---------------------|
| Preview CPST (v1362, 2026-10-19) | `index.html:16872-16898` | `min(fisico, firmesPropias + residual)` | **SÍ** |
| Split pedido B (v1208, 2026-10-08) | `index.html:34720-34722` + `src/pure/stock-realmente-disponible.js:212-261` | `max(0, fisico − Σ qtyOpen total)` | **NO** |

**Secuencia que reproduce el síntoma:** 3u en SAP dep 11 ya ASIG a cliente X → VDE X crea pedido via CPST → split lee `disp=0` → 100% BO → `app_only` → **SAP NUNCA recibe las 3 unidades**.

### FINDING-02 — Drift TTL `lineReservesStock` entre src/pure y functions/core

- `src/pure/stock-realmente-disponible.js:62` → `RESERVA_TTL_DAYS = 7` (v1198 2026-10-08)
- `functions/core/pedido-snapshot-core.js:43` → `RESERVA_TTL_DAYS = 15` (comentario "MANTENER SINCRONIZADO" no se actualizó)

Impacto: una línea ASIG/BO/confirmed de 8-15 días **reserva en snapshot server-side** pero **no en UI**. Un VDE puede "ver libre" un SKU que la CF considera reservado → inconsistencia modal vs. dashboard.

### FINDING-03 — Flag `split_enabled=0` kill switch sigue vivo

`index.html:7023-7029` default ON desde v620. Pero `localStorage.setItem('split_enabled','0')` sigue siendo honrado. Browser con la clave seteada (p.ej. por testing antiguo) carga pedidos con todo-o-nada → caso v600 CHALPAC: 2u pedidas, disp=1, iban 100% BO. Sin telemetría.

### FINDING-04 — 3 fórmulas distintas de "disponibilidad" conviven

| Caller | Archivo | Fórmula | cardCode |
|--------|---------|---------|----------|
| `_cpstRenderPreview` | `index.html:16872` (v1362) | `min(fisico, firmesPropias + residual)` | SÍ |
| `doConfirmPedido getDisp` | `index.html:34720` (v1208) | `getStockRealmenteDisponible` global | NO |
| `persistPendingEntry getDisp` | `index.html:26963-26972` (v802) | `dep11 − STOCK_ASIG_APP[sku]` | NO |

Divergencia estructural: un VDE que edita un pedido pending puede ver un split distinto al que vio al crearlo.

### FINDING-05 — Gap operativo PASO 9+10

`applyRepartoManualCore` marca `status='done'` incluso si queda stock sin asignar. Para repartir la unidad sobrante hace falta que el stock físico cambie y se cree un nuevo `ingresos_reparto`. Mientras tanto la unidad queda huérfana.

### FINDING-06 — Fallback inline `doConfirmPedido` + `persistPendingEntry` ignoran política v701

`index.html:34737-34748` + `index.html:26978-26999` fallback cuando bundle no carga: usan `getStockDisponibleVenta` (físico dep 11 crudo) sin restar compromisos. "No debería pasar en prod" — pero es rama de seguridad que puede dispararse en edge cases.

### FINDING-07 — Waitlist CPST SÍ reserva (opuesto al prompt literal)

El prompt dice "Lista de espera NO reserva". Es correcto solo para waitlist manual. Los waitlist con `source='stock-asignado-batch'` SIN `pedidosOrigenes` sí reservan (fix v1368 2026-10-19 agregó el filtro para evitar double-count cuando el CPST hereda `pedidosOrigenes`).

### FINDING-08 — "Reparto" es modal separado, no tab del Backorder

El prompt dice "los tabs se llaman BACKORDER / STOCK ASIG; Reparto no es un modal separado". **Al revés**: `#reparto-modal` es modal independiente (HTML `index.html:6682-6701`, JS `index.html:19997-20144`), reemplazó al botón "Estado" en v1278. El modal Backorder tiene subpestañas internas (urgente/asignación) pero NO subtab Reparto.

### FINDING-09 — README documenta `lineReservesStock(line)` con 1 argumento

Firma real es `lineReservesStock(line, nowMs, pedido)`. Doc desactualizada.

### FINDING-10 — Semántica "Disp" prompt vs código

- Prompt: `Disp = Físico − Reservado` donde Reservado = solo ASIG asignado por Pablo (no incluye BO).
- Código: `disponible_real = Físico − (confirmed + BO + ASIG)` (BO cuenta como reserva).

No es un bug sino una conceptualización distinta. Puede confundir al leer el prompt contra el código. Reportar como nota de glosario en el informe.
