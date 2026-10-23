# Stock servidor atómico — Design doc

**Autor**: Claude Opus 4.7 (bajo instrucciones de Mariano)
**Fecha**: 2026-10-23
**Rama**: `feat-stock-servidor-atomico` desde `main` (v1425).
**Base**: 11 grises grandes de la auditoría 2026-10-22 (docs/auditoria/41_*).
**Scope**: SESIÓN 1 (93 turnos budget) = corazón funcional. Sesión 2 (110t) después de 3 días hábiles observación.
**Decisiones Cowork**: D1=B (split 3 días hábiles), D2=B (shadow 24h), D3=A (solo emulador), D4=A (solo bloqueo), D5=A.

---

## Objetivo

Que la decisión de "hay stock" la tome el servidor en una operación atómica, y que ninguna pantalla con datos viejos pueda vender lo que no hay.

Los 8 casos del Grupo A (concurrencia + stale) caen con **una sola solución arquitectónica**: mover la decisión del cliente al servidor dentro de una transacción Firestore que relee adentro. Los 3 restantes (B hora, C edit post-SAP, D unificación) son fixes puntuales piggy-back.

---

## Sección (a) — ¿Dónde se escriben hoy los cambios de estado que consumen stock?

Resumen del inventario (detalle en `docs/auditoria/50_INVENTARIO_CALLSITES_STOCK.md`).

### Cliente (navegador) escribe directo

| Flow | Call-site | ¿Pasa por CF? |
|---|---|---|
| **Confirmar pedido manual** | `index.html:36031 persistPendingEntry/doConfirmPedido` | NO. `pedidos.add` directo. |
| **Confirmar pedido CPST** | `index.html:17968 _cpstConfirmar` | NO. batch directo. |
| **Crear waitlist (manual/Excel/CPST)** | `index.html:17594 _createOrUnifyWaitlistPayload` | NO. |
| **Unificar waitlists (§42)** | `index.html:25535 _revisionUnificarOrdenModal` | NO. |
| **Agregar línea a pending** | `index.html:36330 _entryAddPendienteRow` | NO. |
| **Backorder manual** | `index.html:18786 addManualBackorder` | NO. |

### CF (ya con txn)

| Flow | CF | Tipo |
|---|---|---|
| **Enviar pedido a SAP (SQ)** | `onPedidoConfirmedSendToSap` | trigger onWrite |
| **Aplicar reparto manual** | `applyRepartoManualCF` | callable |
| **Confirmar pedido pending → confirmed automático** | `autoConfirmPendingPedidosCF` | scheduled |
| **Sync facturas SAP → app** | `syncSapInvoicesToApp` | scheduled 30min |
| **Sync órdenes SAP → app** | `syncSapOrdersToApp` | scheduled 15min |
| **Expirar ASIG TTL** | `expireAsigLinesTTLCF` | scheduled diario |
| **Cancelar SQ expiradas** | `sqCancelExpiredCF` | scheduled diario |
| **Trigger reparto por aumento físico** | `onDep11IncreaseCreateReparto` | trigger onWrite |

**Problema**: las validaciones **pre-transaction** son stale (v1343, §40 shipped). El breakdown que calcula la CF ANTES de entrar en `runTransaction` puede estar outdated. Cuando entra en la transacción, Firestore no re-ejecuta la lectura, solo detecta conflictos sobre los docs que **tocaste adentro**.

---

## Sección (b) — Propuesta: función de servidor única `commitPedidoCF`

### Arquitectura

```
Cliente (navegador)
  ├─ UI muestra breakdown vía getStockBreakdown     [informativo]
  ├─ VDE pide 5u, decide confirmar
  └─ commitPedidoCF({ draftId, cardCode, origen, lines, clientVersion, expectedBreakdownHash })
                                   │
                                   ▼
Servidor (CF callable Gen 2)
  ├─ Autenticación + validación básica payload
  ├─ Chequeo clientVersion >= app_config/version_minima
  ├─ Idempotencia: ¿existe pedido con _draftId == draftId?
  │   SI → devolver ese pedido (cerrado o abierto) sin re-ejecutar
  │   NO → continuar
  └─ runTransaction(firestore, async (tx) => {
       ├─ Para cada SKU único en lines:
       │   ├─ tx.get(stock_snapshot/{SKU})                [NUEVO doc por SKU, E1]
       │   └─ tx.get(ingresos_reparto activo del SKU)     [query indexada]
       ├─ Chequeo snapshotAgeMs < 45min para TODOS los SKUs
       │   → si no, throw SNAPSHOT_TOO_OLD
       ├─ Para cada línea:
       │   ├─ Compute breakdown.libre + utilizablePara(cardCode)
       │   ├─ Asigna: min(cantidad, libre) → confirmed, resto → BO
       │   └─ Si origen='stock-asignado' + asigRefs: cancela ASIG originales
       ├─ Compute diffVsClient vs expectedBreakdownHash
       ├─ tx.set(pedidos/<new>) con lines[] decididas
       ├─ tx.update(stock_snapshot/{SKU}) con bucket actualizado por SKU
       └─ tx.set(_commit_log/<draftId>) para audit
     })
       │
       ▼
  Si otra txn interleaved → Firestore reintenta hasta 5× automático
  Si el conflicto persiste → throw CONTENTION_RETRY_EXHAUSTED (muy raro)
  
Cliente recibe:
  ├─ OK: { pedidoId, lines: [{sku, qtyConfirmed, qtyBO, reason}], diffVsClient, commitAtIso }
  │       Si diffVsClient null → silencio.
  │       Si diffVsClient con delta → modal "antes veías X, ahora Y, 2u pasaron a BO"
  └─ ERROR: { errorCode, message, data } (ver sección "Contrato")
```

### Trigger de aplicación

- **Manual** (`origen='manual'`): llamado desde `doConfirmPedido` cuando VDE aprieta "Confirmar pedido".
- **CPST** (`origen='cpst'`): llamado desde `_cpstConfirmar`. Variante: `lines` tienen `origenLinea='stock-asignado'` + `asigRefs`. La CF cancela ASIG originales dentro de la misma txn.
- **Excel** (`origen='excel'`): llamado desde `revisionDejarRecalculando`. Similar a manual pero sin bloque CPST.
- **Auto** (`origen='auto'`): llamado desde `autoConfirmPendingPedidosCF`. Pedido ya existe en pending, lo promueve a confirmed re-chequeando stock.
- **Reparto**: `applyRepartoManualCF` sigue siendo función separada (porque el payload es diferente: assignments[] por cliente). Pero DENTRO usa `commitPedidoCore(deps, {origen:'reparto', ...})` reusando la lógica de decisión.

### Para el aplicar reparto específicamente

`applyRepartoManualCF` ya tiene runTransaction (v1343). En E5 se endurece así:
```js
runTransaction(async (tx) => {
  const snap = await tx.get(stock_snapshot/{SKU});
  const livresPrePost = computeLibre(snap);
  if (totalAsignarVsBO > livresPrePost + nuevoIngreso) {
    throw NOT_ENOUGH_FOR_REPARTO;
  }
  // ... aplica assignments ...
});
```

Idéntico pattern para `onDep11IncreaseCreateReparto` que llama a `reconcileRepartosFaltantes` — todo dentro del mismo `runTransaction` o el trigger se re-ejecuta.

---

## Sección (c) — Qué pasa con el cliente

### UI pre-commit

- `getStockBreakdown` sigue mostrando libre, reservadas, en reparto. **Informativo**.
- VDE arma el pedido pensando que hay 3u libres.

### UI post-commit

- Cliente llama `commitPedidoCF`.
- Respuesta en 2 flavors:

**OK silencioso** (diff=null, el stock al momento del commit coincide con lo que mostraba):
- Modal verde "Pedido confirmado · 3u confirmed, 0 BO".
- UI se actualiza con el pedido nuevo.

**OK con diff** (stock cambió entre render y commit):
- Modal naranja:
  ```
  ⚠ Al confirmar, el stock cambió:
  - SKU X: pediste 3u, 1 ya la tomó otro vendedor → 2u confirmed, 1u BO.
  
  ¿Querés mantener el pedido así (click OK) o editarlo primero (click Cancelar)?
  ```
- Si VDE dio `autoAcceptStockChange=true` como opción de usuario (checkbox persistido en localStorage) → se salta el modal, acepta silencioso con un snackbar informativo.

**ERROR**:
- `VERSION_OLD`: modal rojo "Actualizá la app para continuar" + botón "Recargar" que fuerza `location.reload()`.
- `CLIENT_HAS_OPEN_WAITLIST`: modal naranja "El cliente ya tiene la ORDEN 445 abierta en lista de espera (ver detalle) · Unificar / Mantener separada / Cancelar".
- `STOCK_CHANGED` (sólo si `autoAcceptStockChange=false`): modal naranja con diff, botón "Aceptar" (vuelve a llamar la CF con `autoAcceptStockChange=true`) o "Cancelar".
- `SNAPSHOT_TOO_OLD`: modal rojo "El stock está más viejo de 45 minutos. Tocá 'Actualizar snapshot' y volvé a intentar" + botón que llama a CF `refreshStockSnapshotCF`.

---

## Sección (d) — Snapshot de SAP

### Shape nuevo (sesión 1 E1-E2)

Hoy: `app_config/stock_snapshot` con maps top-level `byItem/backorderBySku/asigBySku`.

**Propuesta**: migrar a 1 doc por SKU → `stock_snapshot/{SKU}`:

```js
{
  sku,
  fisicoDep11,                        // SAP source (BQ sync nocturno)
  transitoDep12,                      // SAP source
  // computed desde app:
  backorderApp: { total, porCliente: {C001: 2, ...} },
  asignadas: { total, porCliente, detalle: [{...}] },
  confirmadasSinFacturar: { total, porCliente },
  // derived:
  reservadasTotal,                    // min(nominal, fisico) §40.2
  libre,                              // max(0, fisico - reservadasTotal)
  // metadata:
  snapshotFromSap: { fuente: 'bq_sync', updatedAt: TS },
  computedAt: TS,                     // última recálculo app
  _version: 'app_v8',
}
```

### Fuente dentro de la transacción

```js
await runTransaction(async (tx) => {
  const snap = await tx.get(stock_snapshot/{SKU});
  const data = snap.data();
  const age = Date.now() - data.snapshotFromSap.updatedAt.toMillis();
  if (age > 45 * 60 * 1000) throw SNAPSHOT_TOO_OLD;  // 45min
  // calcula breakdown con data + reparto activo + líneas en progreso de ESTA txn
});
```

### Refresh forzado

Si una CF detecta `libre < 0` o `age > 30min`, dispara `refreshStockSnapshotCF` que:
1. Trigger el BQ sync inmediato (vía Pub/Sub a `cloud-run-bq-sync`).
2. Recomputa snapshot per-SKU afectado.
3. Return actualizado.

### Trigger `onPedidoWriteRecalcSnapshot`

Hoy escribe en el doc global. En E2 se refactorea para escribir en los docs `stock_snapshot/{SKU}` individuales → trigger per-SKU en vez de doc único. **Menor contention cross-SKU**.

### Shadow 24h E1

Durante E1, el trigger escribe en **ambos** docs (`stock_snapshot/{SKU}` nuevo + `app_config/stock_snapshot` legacy). Lectores viejos siguen funcionando. En E2 cutover, nuevos lectores usan el per-SKU.

---

## Sección (e) — Hora (TTL `serverTimestamp`)

### Hoy

- **Server-side**: `functions/core/*.js` todos usan `deps.now ?? Date.now()` inyectable. ✓ OK.
- **Cliente**: `index.html` usa `Date.now()` para renderizar TTLs informativos. ✓ OK (no decide).

### Problema G1.G14

El cliente, al armar el payload del pedido, inserta timestamps con `firebase.firestore.FieldValue.serverTimestamp()` para `createdAt`, `confirmedAt`, etc. Pero también usa `new Date().toISOString()` en algunos lugares (ej. `asigAt` del bloque v1280).

**Grep client-side**:
```
index.html:17436  asigAt: new Date().toISOString(),            ← cliente wall-clock
index.html:17812  confirmedAt: new Date().toISOString(),       ← cliente wall-clock
index.html:36000  confirmedAt: new Date().toISOString(),       ← cliente wall-clock
```

Si el dispositivo del VDE tiene clock skew (laptop con hora mal setteada), estos timestamps quedan con hora incorrecta. El servidor después usa esos timestamps para TTL → decisión errada.

### Fix

En **todos** los flows que escriben desde cliente timestamps que luego se usan para TTL:
1. Si el flow pasa por CF (post-E3): el cliente **NO** setea `confirmedAt`. La CF lo setea con `admin.firestore.FieldValue.serverTimestamp()` dentro de la txn.
2. Si el flow queda client-side (categoría C): usar `firebase.firestore.FieldValue.serverTimestamp()` (que es NTP server-side) en vez de `new Date().toISOString()`.

**Grep final E7**: `grep -nE "new Date\(\)\.toISOString\(\)" index.html` → 0 ocurrencias en código que escriba timestamps TTL.

---

## Sección (f) — Edición post-SAP (G4.03)

### Decisión Cowork (D4 = A)

Solo bloqueo UI. No se implementa botón "Cancelar SQ y rehacer" (la cotización con SO linkeada no se puede cerrar en SAP SL y no queremos el camino a medias).

### UI (E8)

Modal de edición de pedido: si `pedido.transferidoSAP.docEntry != null`:
- Todos los campos de edición (líneas, qty, precio, descuento) **deshabilitados**.
- Banner naranja fijo arriba: `Este pedido ya está en SAP (SQ #2000425). Para modificarlo, contactar a Mariano / Pablo que lo editan en SAP. Vendedor no puede editar desde la app post-envío.`

### Rules (E10)

Opción 3 Hybrid (recomendada por agente 3):
- `firestore.rules`: remover `'lines'` del whitelist VDE.
- VDE no puede update `lines` directamente nunca más.
- Flows legítimos cliente que editan `lines` (precio, qty, notas pre-envío) pasan por CF callable `updatePedidoLinesCF`.
- Admin/gerente/interno sin cambio (blanket permitido).

Rules escapes para edge:
- `pedido.transferidoSAP` presente + VDE intenta cualquier `update` → deny.
- Admin/gerente/interno con `transferidoSAP` presente → permitido (ellos sí pueden hacer cambios menores, ej. notas).

### CF alternativa `updatePedidoLinesCF`

Payload:
```js
{ pedidoId, lines: [{lineIndex, cantidad, precio, notas}] }
```

Validaciones:
- `pedido.transferidoSAP == null` (sino deny).
- `lines[].state` NO está en el payload (CF no acepta cambios de state desde cliente).
- VDE solo puede modificar sus pedidos (`ownerUid == auth.uid`).
- Dentro de runTransaction por consistencia.

---

## Sección (g) — Unificación G2.03

### Caso borde

```
1. Orden X (CPST) con pedidosOrigenes=[{pedidoId:'A', lineIndex:0, sku:'SKU1', qty:2}]
2. Orden Y absorbe X vía unify.
   mergeLinesFromOrders(Y.lines, [X])
   Y.lines[k] = { ...X.lines[0], asigRefs: [{pedidoId:'A', ...}] }  ← OK
   Y.pedidosOrigenes = [{pedidoId:'A', ...}]  ← se preserva
3. Orden Z absorbe Y vía unify.
   mergeLinesFromOrders(Z.lines, [Y])
   Y.pedidosOrigenes al momento de absorber Z = [{pedidoId:'A', ...}]  ← STILL OK
   PERO: si en el ínterin Y agregó una NUEVA línea CPST (desde orden W),
   Y.pedidosOrigenes puede haber sido pisado por el merge con W.
   
   Al absorber Z en Y: buildAsigRefsForLine(line.code, Y.pedidosOrigenes) solo
   mira los pedidosOrigenes DEL MOMENTO del merge Y→Z, no los asigRefs
   persistidos EN la línea desde el merge X→Y anterior.
```

**Resultado**: línea importada en Z pierde asigRefs → regresión H1 (cliente puede confirmar con fórmula GLOBAL cuando debería usar POR CLIENTE).

### Fix (E9)

En `mergeLinesFromOrders`, UNION de refs:
```js
const refsFromOrigenes = buildAsigRefsForLine(line.code, order.pedidosOrigenes);
const refsFromLine = Array.isArray(line.asigRefs) ? line.asigRefs : [];
const refs = unionAsigRefsDedup(refsFromOrigenes, refsFromLine);
if (refs.length > 0) {
  newLine.origen = 'stock-asignado';
  newLine.asigRefs = refs;
}
```

`unionAsigRefsDedup`: dedupe por `(pedidoId, lineIndex)`.

Test RED: chained merge X → Y → Z con una línea en Z que debe tener refs de X.

---

## Sección (h) — Compatibilidad clientes viejos

### Problema

Un VDE con bundle v1420 (viejo, no migrado) sigue escribiendo directo a `pedidos.add`. Si post-E10 las rules deniegan `'lines'` whitelist, su flow rompe silenciosamente.

### Solución (E10)

Fase 1: shadow 24h (shadow log, rules permiten):
- Agregar logging CF `logDirectWriteAttempt` que recibe eventos trigger `onWrite(pedidos)` + loguea en Cloud Logging si `request.auth.firebase.sign_in_provider != 'custom'` (es decir, write de cliente, no Admin SDK).
- Si en 24h hay cero logs → cutover a rules estrictas.

Fase 2: cutover (rules estrictas):
- `firestore.rules`: `'lines'` removido del whitelist VDE para `update pedidos`.
- VDE con bundle viejo que intenta write directo → **permission-denied**.
- Modal rojo cliente: "Actualizá la app" + reload forzado.

### `min_app_version` (D5 = A, solo en E10)

Doc nuevo `app_config/version_minima`:
```js
{
  minVersion: 'v1430',             // la versión del cutover
  blockedAt: '2026-...-...T...Z',
  blockedReason: 'commitPedidoCF_mandatory',
  message: 'Actualizá para seguir cargando pedidos',
}
```

Rules:
- Read: `isReader()` (todos autenticados — para que el cliente lo lea en load).
- Write: `isAdmin()`.

Cliente lee en load:
```js
const vm = await fbDb.collection('app_config').doc('version_minima').get();
if (vm.data().minVersion > APP_VERSION) {
  showBlockedModal(vm.data());
  return;  // bloquea toda la app
}
```

### Comunicación al equipo

Antes del cutover E10, mandar WhatsApp a los 4 VDEs + Mariano + Pablo + Santiago + Ioannis explicando: "Mañana a las 10am forzamos actualización de la app. Si ven el modal 'Actualizá', aprieten Recargar."

---

## Sección (i) — Plan de etapas (sesión 1 y 2)

### Sesión 1 (budget 93t)

Rama: `feat-stock-servidor-atomico`.

| # | Etapa | Qué hace | Budget | Pausa |
|---|---|---|---:|---|
| E0 | Design doc + inventario + brainstorming | este doc + agentes | 20 | **SÍ** (ya ejecutada, pedimos OK) |
| E1 | Mirror getStockBreakdown completo + stock_snapshot/{SKU} shadow + agregado por SKU | copia servidor + per-SKU docs + test sync | 15 | - |
| E2 | CF `commitPedidoCF` + emulator setup + tests concurrencia | corazón + 2 txn paralelas emulator | 30 | - |
| E3 | Migrar `doConfirmPedido` cliente a CF | reemplaza pedidos.add + modal diff | 15 | - |
| E4 | Migrar `_cpstConfirmar` cliente a CF | variant stock-asignado | 13 | - |

**Pausa fin sesión 1**: deploy functions + reglas + bundle. **3 días hábiles observación** antes de sesión 2.

Al cierre sesión 1: **4 de 11 casos cerrados** (G1.G01, G1.G02, G1.G13, G3.05 — los que afectan los flows manual y CPST). Otros 7 todavía abiertos pero mitigados parcialmente.

### Sesión 2 (budget 110t)

Después de 3 días hábiles sin rechazos inesperados ni duplicados.

| # | Etapa | Qué hace | Budget | Pausa |
|---|---|---|---:|---|
| E5 | Endurecer `applyRepartoManualCF` + `onDep11IncreaseCreateReparto` | runTransaction uniforme | 10 | - |
| E6 | Migrar `autoConfirmPendingPedidosCF` a `commitPedidoCore` | reusa lógica | 10 | - |
| E7 | serverTimestamp en TTLs cliente | migra `new Date().toISOString()` del cliente | 10 | - |
| E8 | Bloqueo UI edición post-SAP + banner | G4.03 solo bloqueo (D4=A) | 15 | - |
| E9 | Fix G2.03 unificación asigRefs (chained merge) | repro + fix UNION | 10 | - |
| E10 | firestore.rules cutover + min_app_version + CF `updatePedidoLinesCF` | shadow 24h + cutover | 15 | **SÍ** (ver cuántos VDEs tienen versión vieja antes de activar) |
| E11 | Property-based tests concurrencia (fast-check + emulator) | invariantes R1-R10 con N txn aleatorias | 15 | - |
| E12 | Prueba race contra emulador local (NO prod — D3=A) | 2 CFs paralelas sobre mismo SKU libre=1 | 10 | - |
| E13 | PR + merge + deploy + verify + informe | smoke prod + 3 SKUs + informe cowork | 15 | - |

Al cierre sesión 2: **11 de 11 casos cerrados**.

### Dependencias

```
E0 (design, OK) → E1 (mirror + per-SKU)
                → E2 (CF corazón)
                      → E3 (doConfirmPedido migrate)  [paralelizable con E4]
                      → E4 (_cpstConfirmar migrate)   [paralelizable con E3]
                      
                      [PAUSA 3 días hábiles observación]
                      
                → E5 (reparto endurecer)
                → E6 (auto-confirm migrate)
                → E7 (serverTimestamp cliente)
                → E8 (edit post-SAP bloqueo)   [paralelizable con E9]
                → E9 (G2.03 fix)               [paralelizable con E8]
                → E10 (rules cutover, con pausa)
                → E11 (property concurrency)
                → E12 (race emulador)
                → E13 (deploy + informe)
```

---

## Sección NUEVA — Costo transacción y agregado por SKU

### Decisión: agregado por SKU va en SESIÓN 1 (E1-E2)

**Datos reales** (prod 2026-10-23):
- 302 pedidos abiertos / 512 SKUs únicos / 3.693 líneas vivas.
- Líneas/SKU: mediana 5, p95 22, p99 38, max 46.

**Sin agregado**: cada commitPedidoCF relee N líneas por SKU. Para un pedido con 5 SKUs × 22 líneas/SKU p95 = **110 reads × 20ms = ~440ms** latencia percibida por el VDE.

**Con agregado por SKU** (`stock_snapshot/{SKU}`):
- 1 read por SKU → 5 reads × 20ms = **100ms** latencia.
- Reads/día: ~5k (vs 110k sin agregado).

**Beneficio**: 22× menor latencia + 22× menor costo reads.

**Costo adicional de implementación**: trigger `onPedidoWriteRecalcSnapshot` ya recomputa el snapshot. Solo cambiamos el shape: de 1 doc global a N docs per SKU. **Migración incremental con shadow 24h**.

### Reconciliación 30min

Scheduled CF `reconcileStockSnapshotCF`:
- Cada 30min recorre pedidos abiertos.
- Para cada SKU, computa breakdown real desde líneas vivas.
- Compara con `stock_snapshot/{SKU}`.
- Si difiere → log alerta + sobrescribe snapshot.

**En sesión 1**: implementar el reconcile pero solo en modo observación (log, no sobrescribe). En sesión 2 se activa la autoridad.

---

## Sección NUEVA — Contrato `commitPedidoCF`

### Idempotencia por `draftId`

Cliente envía `draftId` único. CF busca pedido con `_draftId == draftId`:
- Existe → devuelve ese pedido sin re-ejecutar (idempotente).
- No existe → crea nuevo con `_draftId` setteado.

Query indexada en `_draftId` necesaria. Para pedidos pending, `draftId = pending.id` (ya es único). Para nuevos pedidos, cliente genera `draftId = uuid()` en el momento de confirmar.

### Payload

```typescript
interface CommitPedidoPayload {
  draftId: string;                    // único; mismo = idempotente
  cardCode: string;
  origen: 'manual' | 'excel' | 'cpst' | 'auto';
  lines: Array<{
    sku: string;
    cantidad: number;
    origenLinea?: 'normal' | 'stock-asignado';
    asigRefs?: Array<{pedidoId: string, lineIndex: number, qtyAsignada: number, sku: string}>;
    precio?: number;
    notas?: string;
  }>;
  clientVersion: string;               // 'v1430' bundle version
  expectedBreakdownHash?: string;      // hash SHA-1 del breakdown que el cliente mostraba (opcional)
  autoAcceptStockChange?: boolean;     // true si VDE pre-aceptó diff
  formaEntrega?: object;               // paquete adicional
  condicionPago?: string;
  observaciones?: string;
}
```

### Respuesta OK

```typescript
interface CommitPedidoResponseOk {
  ok: true;
  pedidoId: string;
  lines: Array<{
    sku: string;
    qtyConfirmed: number;
    qtyBO: number;
    reason: 'ok' | 'stock_changed' | 'reserva_propia_consumida';
  }>;
  diffVsClient: null | {
    skuChanged: Array<{sku: string, libreAntes: number, libreAhora: number}>;
    message: string;                    // "2 unidades pasaron a BO porque otro pedido las tomó antes"
  };
  servidorNowMs: number;                // para que cliente alinee TTL rendering
  commitAtIso: string;
}
```

### Respuesta ERROR

```typescript
interface CommitPedidoResponseError {
  ok: false;
  errorCode:
    | 'VERSION_OLD'
    | 'CLIENT_HAS_OPEN_WAITLIST'
    | 'STOCK_CHANGED'                   // solo si autoAcceptStockChange=false
    | 'SNAPSHOT_TOO_OLD'                // >45min
    | 'CONTENTION_RETRY_EXHAUSTED'      // Firestore reintentó 5× sin éxito, muy raro
    | 'VALIDATION_ERROR'                // payload mal armado
    | 'PERMISSION_DENIED';              // Auth fail
  message: string;
  data?: {
    // VERSION_OLD:
    minVersion?: string;
    currentVersion?: string;
    // CLIENT_HAS_OPEN_WAITLIST:
    waitlistId?: string;
    orderNumber?: number;
    items?: Array<any>;
    // STOCK_CHANGED:
    diff?: Array<{sku: string, libreAntes: number, libreAhora: number, pediste: number, podesLlevar: number}>;
    // SNAPSHOT_TOO_OLD:
    snapshotAgeMs?: number;
    canRefresh?: boolean;
  };
}
```

### Garantías

1. **Idempotencia**: `draftId` repetido devuelve el mismo pedido. Doble click, reintento de red, retry automático = OK.
2. **Atomicidad**: `runTransaction` garantiza que o se escribe todo o nada. Nunca "a medias".
3. **Isolation**: Firestore reintenta hasta 5× ante conflicto. Si falla todas → `CONTENTION_RETRY_EXHAUSTED` + rollback.
4. **Durability**: write exitoso = persistido.
5. **Consistencia servidor**: dentro de la txn, el breakdown que la CF calcula es exactamente el stock disponible en ese tick. No hay "entre lectura y escritura".

### Códigos de error — manejo cliente

| Code | Semántica | Acción cliente |
|---|---|---|
| `VERSION_OLD` | Bundle del cliente < min_app_version | Modal rojo + reload forzado |
| `CLIENT_HAS_OPEN_WAITLIST` | Cliente ya tiene waitlist abierta (regla §42) | Modal "Unificar / Mantener separado / Cancelar" |
| `STOCK_CHANGED` | Diff vs lo mostrado | Modal con diff + "Aceptar" / "Cancelar" |
| `SNAPSHOT_TOO_OLD` | Snapshot >45min | Botón "Refrescar + reintentar" (dispara `refreshStockSnapshotCF`) |
| `CONTENTION_RETRY_EXHAUSTED` | Race demasiado alto (muy raro) | Modal "Reintentar en 10 segundos" |
| `VALIDATION_ERROR` | Payload mal | Alert + log Sentry |
| `PERMISSION_DENIED` | Auth fail | Modal "Volvé a loguearte" + redirect |

**Ningún error deja el pedido a medias**: la CF rollback automático. Cliente puede reintentar con mismo `draftId` (idempotente).

---

## Riesgos de falso verde

1. **Tests concurrencia no concurrentes**. Lanzar 2 txn secuencialmente no es race. Mitigación: emulator real + hook `onBeforeWrite` que pausa.
2. **Mirror getStockBreakdown drifea**. Fix cliente sin propagar servidor. Mitigación: test de sync strict (compara tokens R1-R10 entre `src/pure/stock-breakdown.js` y `functions/core/pedido-snapshot-core.js`).
3. **Agregado por SKU drifea de las líneas reales**. Reconciliación 30min + alerta.
4. **Deploy OK pero endpoint falla en prod**. Smoke `gcloud logging` post-deploy automático.
5. **Rules cutover rompe flows legítimos**. Shadow 24h con alerta pre-cutover.
6. **Property tests generan datos imposibles**. Constraints realistas + fixtures de regresión conocidos.

---

## Verificación final (sesión 2 E13)

1. **Prueba de carrera emulador**: 2 confirmaciones simultáneas del mismo SKU libre=1 → exactamente una recibe, otra queda BO con mensaje correcto. Lo mismo para reparto + confirm simultáneo.
2. **Prueba de carrera prod (observacional, no destructiva)**: durante los 3 días hábiles de observación entre sesión 1 y 2, grep de logs CF por `CONTENTION_RETRY` o `STOCK_CHANGED` en pedidos reales.
3. **3 SKUs verificación**: CUDC201HG, 597151, EXGC80HBAR2AR muestran lo mismo en todas las pantallas.
4. **11 casos tabla final**: CERRADO con test que lo cubre.

---

## Follow-ups (fuera de scope sesión 1+2)

- Dashboard admin de CFs: `commitPedidoCF` métricas (p50/p95/p99 latencia, tasa de `STOCK_CHANGED`, tasa de `CONTENTION_RETRY`).
- Observabilidad: Sentry breadcrumbs cliente antes de llamar CF.
- Analytics del "diffVsClient": cuántos pedidos tuvieron diff + magnitud → mejorar UX pre-commit.
- Reconcile per-SKU con autoridad (sesión 3).
