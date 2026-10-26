# Plan I — Migrar `_gbConfirmar` + eliminar fallback legacy → E10 Fase 2

**Rama**: `feat-v1454-migrate-gb-to-cf-e10-fase2`
**Fecha**: 2026-10-25
**Autor**: agente (en ejecución del plan I del cierre total 2026-10-25)
**Objetivo**: migrar las 2 escrituras directas a `pedidos` restantes (`_gbConfirmar` y el fallback de `doConfirmPedido`) a `commitPedidoCF`, de modo que **todo** pedido nuevo tenga `_commitVersion='commitPedidoCore_v1'`. Luego, si el audit pasa en verde, activar E10 Fase 2 (rules deny al camino legacy).

Documento alineado con CLAUDE.md §30 (documentar todo cambio) y §31 (auditoría ≠ corrección; acá es corrección autorizada).

---

## 1. Antes

Dos call-sites escriben `pedidos` directo sin pasar por `commitPedidoCF`:

### 1.1 `index.html:19324` — `_gbConfirmar` (Generar Backorder manual)

Flow: VDE/admin arma backorder manual (cliente + N SKUs sin stock) → clic Confirmar → `fbDb.collection('pedidos').add(docData)` directo. Payload incluye:
- `source: 'manual-backorder'`
- `transferidoSAP: { via: 'manual-backorder', skipSap: true, docNum: null, docEntry: null, createdAt: nowIso }`
- `schemaVersion: 2`
- `stage: 'confirmed'` (ya nace confirmado — no pasa por pending/waitlist)
- `lines[]` ya split (ASIG + BO) con `getStockDisponibleVenta` + `STOCK_ASIG_APP` (fórmula vieja, pre-§33/§35).
- **SIN** `_commitVersion` (el CF nunca participa) → bloquea E10 GREEN.
- `vendorAssigned` + `assignedVendorUid` + `ownerVendor` seteados via `_enrichPayloadWithClientVendor` (§44/§46).

### 1.2 `index.html:36664` — fallback legacy en `doConfirmPedido`

Flow: `doConfirmPedido` llama primero a `_tryCommitPedidoCF`:
- Si CF OK → usa pedidoId server + `_commitVersion='commitPedidoCore_v1'`.
- Si CF devuelve `{ok:false, errorCode: ...}` → modal apropiado + abort (nunca fallback).
- Si CF **no está disponible** (null — unavailable / deadline-exceeded / cancelled / not-found / network) → cae a `fbDb.collection('pedidos').add(docData)` directo.
  - El fallback preserva TODO el flow legacy: cancelación ASIG originales, delete waitlist, auto-confirm 100% BO, notif actingPartner, defaultDelivery save.
  - El `.catch(e)` discrimina `permission-denied` (NO toca pending[] local) vs otros (guarda local + reintentable).
  - El `.finally()` reset de globals `_pendingPedido*` (CLAUDE.md §52).
  - **El `pedidos.add` directo NO tiene `_commitVersion`** → bloquea E10 GREEN.

Como ya tenemos `_tryCommitPedidoCF` con capa de **post-hoc idempotency recovery** (`v1432`: si CF cae por red, consultamos Firestore por `_draftId` antes de fallback — si ya existe, lo usamos), el fallback legacy sólo se dispara ante:
1. Primera invocación del CF que crashea con red total (no llegó al servidor para crear nada).
2. CF deployada en versión que no soporta el payload.

Son casos reales pero raros (CF ha tenido 0 incidentes recientes).

---

## 2. Problema

CLAUDE.md §30 + prompt del cierre total 2026-10-25 piden E10 Fase 2 (rules deny-legacy sobre `pedidos.create`). El audit `scripts/audit/Y_E10_commit_version_audit.cjs` tiene veredicto GREEN cuando:
- (a) `pedidos` activos (`closedAt == null`) sin `_commitVersion` → 0.
- (b) `pedidos` creados desde `--since` sin `_commitVersion` → < 5.

Mientras `_gbConfirmar` + fallback legacy de `doConfirmPedido` sigan vivos, **cualquier** backorder manual nuevo + **cualquier** confirm con CF caída se cuentan como pedido legacy → GREEN inalcanzable. **No se puede cerrar la rule.**

Trade-off del fallback: downtime del CF ≠ downtime de pedidos (hoy). Con E10 Fase 2, downtime CF = downtime pedidos. Mariano aprueba el trade-off (CF tiene 0 incidentes recientes; además `_tryCommitPedidoCF` tiene post-hoc idempotency recovery).

---

## 3. Cambio

### 3.1 Extender `commitPedidoCore` para aceptar `origen='manual_backorder'` + `skipSap: true`

**Archivo**: `functions/core/commit-pedido-core.js`.

- Agregar `'manual_backorder'` a `VALID_ORIGENS`.
- Nuevo payload field `skipSap: boolean` (opcional, solo relevante con `origen='manual_backorder'`).
- Nuevo payload field `pedidoYaConLines: boolean` (opcional): si `true`, el payload incluye `linesPrebuilt: [...]` con shape idéntico a `pedido.lines[]` (incluye `code`, `qty`, `qtyOpen`, `state`, `asigAt`, `priceAtCreation`, etc.) — porque `_gbConfirmar` arma lineas con `state=ASIG/BO` y campos propios (`targetMonth`, `manualBackorder`, `asigCliTipo='manual-backorder'`). Para `manual_backorder` **conservar las lineas pre-armadas** sin re-computar breakdown. El servidor sólo valida: cantidad > 0, qty match qtyOpen, state ∈ {ASIG, BO}, agrega `_commitVersion` + draft lock + lanza el escribir atómico.
- `buildPedidoDocData` chequea `origen === 'manual_backorder'`:
  - Setea `source: 'manual-backorder'` + `transferidoSAP: { via: 'manual-backorder', skipSap: true, docNum: null, docEntry: null, createdAt: nowIso }` + `stage: 'confirmed'`.
  - Usa `payload.linesPrebuilt` (si viene) en vez de recomputar `docLines` desde breakdown.
  - Preserva `targetMonth`, `targetYear`, `manualBackorder`, `asigCliTipo='manual-backorder'`, `asigReserva`, `asigAt` en cada line.
- Para `origen='manual_backorder'`:
  - No corre el chequeo CLIENT_HAS_OPEN_WAITLIST (es un flow paralelo que NO consume waitlist).
  - **Sí** corre validación de `cardCode`, idempotencia por `draftId`, y draft lock (§64.3).
  - **Sí** corre check `pedido_ya_en_sap` (G4.03) — defensa en profundidad.
  - **No** corre validación de breakdown por SKU (las lineas vienen pre-armadas). PROBABILIDAD extremadamente baja de que esto genere stock negativo porque `getStockDisponibleVenta` del cliente ya hizo el split; y el objetivo del backorder manual ES generar la demanda incluso sin stock.
  - **Sí** escribe los globals `_commitVersion` + `_draftId` + lock atómico.

### 3.2 Migrar `_gbConfirmar` → usar `_tryCommitPedidoCF`

**Archivo**: `index.html`.

Reemplazar `const ref = await fbDb.collection('pedidos').add(docData);` por:

```js
docData._draftId = 'manual-backorder|' + orderNum + '|' + Date.now();
docData.source = 'manual-backorder';
docData.origen = 'manual_backorder';
docData.skipSap = true;
docData.linesPrebuilt = docData.lines;  // ya armado, con asigAt/state/etc.

const _cfResult = await window._tryCommitPedidoCF(docData);
if (_cfResult && _cfResult.ok === true) {
  const refId = _cfResult.pedidoId;
  // continuar con logOp + showSyncTag + alert + closeGenerarBackorderModal.
} else if (_cfResult && _cfResult.ok === false) {
  // Error de negocio — mostrar al user. NO fallback legacy.
  alert('Error guardando backorder: ' + (_cfResult.message || _cfResult.errorCode || 'desconocido'));
  return;
} else {
  // CF no disponible (red/timeout). NO fallback legacy. Reintentar manual.
  alert('No se pudo contactar al servidor. El backorder no se guardó. Reintentá en 1 minuto.');
  return;
}
```

El `_tryCommitPedidoCF` ya setea `payload.origen` basado en `docData.source`. Para `manual-backorder`, extendemos el mapping para que `source === 'manual-backorder'` ↔ `origen === 'manual_backorder'`.

### 3.3 Eliminar fallback legacy en `doConfirmPedido`

**Archivo**: `index.html:36663-37086` (bloque `fbDb.collection('pedidos').add(docData).then(...)` + `.catch(...)` + `.finally(...)`).

El bloque entero se reemplaza por un `alert` + reintento manual + preservar los globals cleanup §52:

```js
// E10 Fase 2 (v1454 §67): fallback legacy ELIMINADO. Si CF no disponible,
// mostrar error al VDE + reintento manual. Preserva los globals cleanup
// §52 porque el flow legacy ya hacía reset en .finally().
alert('No se pudo contactar al servidor para confirmar el pedido.\n\n' +
  'El borrador queda intacto en "En curso". Reintentá en 1 minuto.');
// Reset defensivo de globals pendingPedido* (idempotente §52).
window._pendingPedidoOrderNumber = null;
window._pendingPedidoWaitlistId = null;
window._pendingPedidoSource = null;
window._pendingPedidoOrigenes = null;
window._pendingBypassAsigGate = null;
return; // NO cerrar modales, NO borrar orders[] — dejar borrador vivo.
```

**NO** se preservan las features del fallback que requerían el ref.id del pedido:
- cancelación de ASIG originales → **la CF ya lo hace** dentro de la misma transacción (§57 + §58 pre-fetch).
- delete / mark consumed waitlist → **la CF ya lo hace** dentro de la misma transacción (§57).
- auto-confirm 100% BO → **debe migrar** al servidor como caso derivado del flow (nota: hoy no lo hace la CF, pero es benigno — se dispara post-pedido y es idempotente).
- defaultDelivery save → **mantener client-side** post-success del CF (el helper actual ya lo hace).
- actingPartner notif → **mantener client-side** post-success del CF.
- `_origenesACancelar` (cancelación ASIG lineages) → **la CF ya lo hace** (`cancelAsigRefsFromPrefetched`).

**IMPORTANTE**: el bloque de post-success (líneas 36556-36599, happy path) ya hace lo necesario (push pending + render + delete waitlist + reset globals). Se preserva intacto.

### 3.4 Activar rules deny-legacy (SOLO si audit GREEN post-fix)

**Archivo**: `firestore.rules`, bloque `match /pedidos/{pedidoId}` `allow create`.

Agregar como requisito de todos los paths:
```
&& request.resource.data._commitVersion == 'commitPedidoCore_v1'
```

Flow esperado:
1. Deploy Pages + Functions con el bump v1454.
2. Esperar 60-90 min para que SW stale-while-revalidate propague (Mariano aprueba el riesgo).
3. Correr `node scripts/audit/Y_E10_commit_version_audit.cjs --since=2026-10-22T03:00:00Z` → debe estar GREEN.
4. Si GREEN → PR separado con el bump de rules + tests emulator. Deploy `firebase deploy --only firestore:rules`.
5. Si RED → NO tocar rules. Documentar quién sigue escribiendo legacy (puede ser SW stale, cliente desactualizado).

En este PR dejamos la rule **preparada** pero NO activada — se activa en un PR posterior cuando audit sea GREEN.

### 3.5 Bump versión

- `index.html` → `APP_VERSION = 'v1454'`.
- `sw.js` → `CACHE_VERSION = 'v1454'`.

---

## 4. Por qué

- E10 Fase 2 es el objetivo final del hardening server-side (CLAUDE.md §64.3 + §58 + §57 + §63). Un cliente nunca más puede escribir `pedidos` directo saltándose la transacción atómica + logging + validación centralizada.
- Reduce la superficie de ataque: un VDE malicioso con devtools NO puede ya crear pedidos saltándose la validación server-side.
- Simplifica el flow: una sola fuente de verdad (CF) para la creación de pedidos. Antes tenías 2 (CF + fallback) que podían divergir.
- El trade-off (downtime CF ⇒ downtime pedidos) está mitigado por `_tryCommitPedidoCF` con post-hoc idempotency recovery (v1432) + draft lock atómico (§64.3) + reintento manual del VDE.

## 5. Verificación

### 5.1 Pre-fix baseline

`node scripts/audit/Y_E10_commit_version_audit.cjs --since=2026-10-22T03:00:00Z --full`

Capturar: cuántos pedidos activos sin `_commitVersion` + cuántos post-cutover.

### 5.2 Post-fix

Mismo comando. GREEN si (a) == 0 && (b) < 5.

### 5.3 Tests obligatorios

- `tests/functions/commit-pedido-manual-backorder.test.js` (nuevo):
  - T1: payload `origen='manual_backorder'` con `linesPrebuilt` crea pedido con `transferidoSAP.skipSap=true`, `source='manual-backorder'`, `_commitVersion='commitPedidoCore_v1'`.
  - T2: 4 roles (admin, gerente, interno, vendedor) → todos pueden crear backorder manual.
  - T3: idempotencia por `draftId` + lock atómico.
  - T4: NO corre CLIENT_HAS_OPEN_WAITLIST (es flow paralelo).
  - T5: respeta validation de `cardCode` requerido.
- `tests/rules/rules.test.js` (extender bloque E10):
  - T1: `pedidos.create` sin `_commitVersion` → DENIED (cuando rule activada).
  - T2: `pedidos.create` con `_commitVersion='commitPedidoCore_v1'` → OK.
  - T3: `pedidos.create` con `_commitVersion='other_value'` → DENIED.
- `tests/e2e/i_gb_cf.spec.js` (nuevo):
  - Login test user.
  - Navegar Generar Backorder.
  - Cargar 1 producto para `CLIENTE PRUEBAS E2E`.
  - Verificar via Firestore que el pedido tiene `_commitVersion='commitPedidoCore_v1'`.
  - Screenshots en `tests/e2e/evidencia/2026-10-25/I/`.

### 5.4 Build gate

`node build.js` + commit chunks. `npm run test:unit` → PASS. `npm run test:functions` → PASS. `biome check` → clean.

## 6. Rollback

- Rules: revertir el `_commitVersion` requirement de `pedidos.create`. Deploy `firebase deploy --only firestore:rules`.
- `_gbConfirmar`: revertir a `fbDb.collection('pedidos').add(docData)` directo.
- `doConfirmPedido` fallback legacy: restaurar el bloque `.then()/.catch()/.finally()` completo desde v1453.
- `commitPedidoCore`: dropear `manual_backorder` de VALID_ORIGENS + lógica `linesPrebuilt`.
- Bump versión al anterior (v1453).

Rollback compartimentado: Rules se pueden revertir sin tocar código (deploy independiente). Si el fallback no estaba activando (confirmación bloqueada en prod), revertir solo rules y mantener código vigente — restaura el gap de GREEN pero destraba usuarios.

## 7. Riesgos conocidos

1. **SW stale**: VDEs con SW de v1453 cacheado siguen usando `fbDb.collection('pedidos').add` directo via `_gbConfirmar`. Mitigación: Rules deny bloquea → VDE recibe error permission-denied → recarga app. SW stale máximo ~1h en campo (stale-while-revalidate).
2. **CF down**: downtime del CF ahora bloquea toda confirmación. Mitigación: 0 incidentes recientes + post-hoc idempotency recovery + draft lock atómico + reintento manual al VDE.
3. **E2E test**: requires `CLIENTE PRUEBAS E2E` existente en Firestore. Si no existe, el test fails en el paso de resolver cliente. Mitigación: documentar como pre-req del test en el .spec file + usar un cliente existente del dataset de testing si está disponible.
