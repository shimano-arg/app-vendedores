# Plan J — v1455 §J Absorción de back order al confirmar (S1)

**Fecha**: 2026-10-25
**Rama**: `feat-v1455-absorb-bo-on-confirm-s1`
**Plan padre**: #1206 (cierre total, hipótesis S1 "backorder inflado")
**Reemplaza/complementa**: §40 (BO no reserva stock), §58 (ALL reads before writes), §57 (pure + espejo + sync).

## 1. Problema

Un cliente tiene un pedido con línea `state='BO'` del SKU `X` por `Y` unidades (back order).
Más tarde entra stock, se arma reparto, y el VDE confirma un pedido nuevo del mismo
cardCode + SKU por `X` unidades. Hoy el BO queda vivo: `qtyOpen=Y` sigue como back order
"inflado" que ya está cubierto por el nuevo pedido confirmado.

**Síntoma reportado (hipótesis S1 del plan #1206)**:
el total de BO contado por `getStockBreakdown` crece por acumulación de BOs cubiertos
pero no cerrados. El cliente ve "sigo con back order" aunque ya le llegó la mercadería
en el pedido nuevo.

## 2. Semántica S1 (una línea por decisión)

Al confirmar un pedido nuevo con `cantidad=X` unidades del SKU `S` para `cardCode=C`:

1. Buscar pedidos abiertos (`closedAt==null`) del mismo `cardCode` con líneas
   `state='BO'` + `qtyOpen > 0` + mismo SKU.
2. Ordenar por `createdAt` ASC (FIFO — el BO más viejo se absorbe primero).
3. Consumir hasta `X` unidades distribuidas FIFO entre los BOs: para cada línea BO,
   `absorbed = min(qtyOpenBO, remainingX)`; `remainingX -= absorbed`.
4. Mutar cada línea BO consumida:
   - `qtyOpen = qtyOpen - absorbed` (puede quedar 0 → pasar a `state='cancelled'`
     + `closedReason='absorbed_by_newer_confirmed'`).
   - Audit en `_backfill.J_bo_absorbed_<fechaIso> = { qtyAntes, qtyDespues, consumedBy, lineIndex, sku }`
     (§55 scripts backfill con snapshot).

**Shape output del pure**:
```js
{
  absorptions: [
    { sku, cantidad, pedidoIdOrigen, lineIndexOrigen, qtyAntes, qtyDespues },
    ...
  ],
  totalCubierto: N,   // suma de cantidad
}
```

**Idempotencia**: una segunda invocación con el mismo set (misma línea BO ya con
`qtyAntes=qtyDespues=0` o `state='cancelled'`) devuelve `absorptions=[]`. El `_backfill`
no se sobreescribe si la clave ya existe (append-only por fecha).

**Determinística**: mismo input (pedidos ordenados por createdAt + lines payload) =
mismo output.

## 3. División del trabajo

### 3.1 Pure core (§57)

`src/pure/absorb-bo-on-confirm.js`:
- `computeBoAbsorption({ cardCode, lines, allPedidos, now })` → `{ absorptions[], totalCubierto }`.
- Lee de `allPedidos`: `line.state === 'BO'`, `line.code === sku`, `pedido.clientCardCode === cardCode`,
  `pedido.closedAt == null`, `qtyOpen > 0`.
- No muta nada. Solo computa el plan.

`functions/core/absorb-bo-on-confirm.js`: espejo byte-exact.

`tests/unit/audit/absorb-bo-sync.test.js`: grep diff los 2 archivos (contenido core idéntico).

### 3.2 Integración en commitInTransaction (§58 ALL reads before writes)

En `functions/core/commit-pedido-core.js:commitInTransaction`:

**FASE READ** (después del pre-fetch de ASIG origen y waitlist origen):
- Para cada SKU único del payload con `cantidad > 0`:
  - `tx.get(pedidosRef.where('clientCardCode','==',cardCode).where('closedAt','==',null))` →
    pre-cargar pedidos candidatos del cliente.
- Computar `computeBoAbsorption({cardCode, lines: payload.lines, allPedidos})`.
- Guardar `absorptions` en un Map para la fase WRITE.

**FASE WRITE** (después de `tx.set(pedidoRef, pedidoData)`):
- Para cada entry de `absorptions`:
  - Mutar `line` del pedido origen (`qtyOpen -= absorbed`, flip a `cancelled` si
    `qtyOpen===0`, agregar `_backfill.J_bo_absorbed_<fecha>`).
  - `tx.update(pedidoOrigenRef, { lines: newLines, _backfill, updatedAt })`.
- `operations_log.add({ type:'bo_absorbed', absorptions, newPedidoId, cardCode, timestamp })`
  fire-and-forget POST-TX.

Devolver `absorptions` en el response del CF.

### 3.3 Fix oneliner `_origenesACancelar` (`index.html:36677-36700`)

**Problema actual**: solo cancela ASIG con `asigRefs` populated (desde payload CPST).
Si el pedido nuevo venía con `pedidosOrigenes` legacy O con líneas sin `asigRefs`
pero con BO absorption del CF, el bloque v1280 no lo cubre.

**Fix**: después del CF response, acumular en `_origenesACancelar` también los
`{ pedidoId, lineIndex }` de las `absorptions` del CF.

El bloque legacy fallback (línea 36664-36978) seguirá funcionando con el array extendido.

### 3.4 Modal confirmación

Después de `_commitCfResult.ok === true`, si `_commitCfResult.absorptions?.length > 0`:
- Mostrar línea gris extra en `showSyncTag` o en un div anexo al modal de success.
- Texto: "Este envío cubre N unidades que el cliente tenía esperando stock."
- Sin botones. Visible 4 segundos.

Función nueva `_renderConfirmModalBoAbsorbed(absorptions)` en `index.html` cerca
de `showSyncTag`.

## 4. NO tocar

- `SNAPSHOT_MAX_AGE_MS` (G).
- Logging STOCK_CHANGED (H / §64).
- `_gbConfirmar` + fallback legacy (I).
- `firestore.rules` (I).

## 5. Rollback

1. Revertir el bloque FASE READ + FASE WRITE del `commitInTransaction` (líneas nuevas).
2. Revertir el bloque `_renderConfirmModalBoAbsorbed`.
3. Revertir el fix `_origenesACancelar` (volver al código v1451).
4. Bump versión (sin cambios funcionales).

El pure core + mirror + sync test pueden quedar; están aislados y no mutan nada
sin el call-site activo.

## 6. Verificación

### Unit (10 casos core puro)
- T1: sin BO del cliente → `absorptions=[]`, `totalCubierto=0`.
- T2: 1 BO exacto `qtyOpen=X` → absorbe X; línea queda `qtyOpen=0 + cancelled`.
- T3: 1 BO parcial `qtyOpen>X` → absorbe X; línea queda `qtyOpen=qtyOpen-X`.
- T4: múltiples BO FIFO (2 pedidos distintos) → absorbe `min(sum qtyOpen, X)` empezando por el más viejo.
- T5: cardCode distinto NO absorbe.
- T6: SKU distinto NO absorbe.
- T7: qty 0 en payload → skip (sin absorption).
- T8: BO con `qtyOpen=0` → skip (ya cancelado).
- T9: idempotencia (segunda invocación con mismo input tras aplicar mutaciones) → `[]`.
- T10: pedido con `closedAt!=null` → skip.

### E2E Playwright (tests/e2e/j_absorb_bo.spec.js)

Setup: cliente `CLIENTE PRUEBAS E2E`, SKU `9691` (del fixture Paso 0).
1. Crear BO manual previo: pedido con `line.state='BO'` qty=5.
2. Login test-user, abrir Pedidos → crear nuevo pedido mismo cliente+SKU qty=3.
3. Confirmar.
4. Assert: modal success muestra "Este envío cubre 3 unidades que el cliente tenía esperando stock."
5. Assert: Firestore muestra el pedido BO con `line.qtyOpen=2` + `_backfill.J_bo_absorbed_*`.

Screenshots: `tests/e2e/evidencia/2026-10-25/J/`.

### Smoke prod

Post-deploy:
```
# 1) Verificar rev nueva commitPedidoCF
gcloud functions describe commitPedidoCF --region=southamerica-east1 --format='value(serviceConfig.revision)'

# 2) Correr Playwright E2E con --project=msedge
npx playwright test tests/e2e/j_absorb_bo.spec.js --project=msedge
```

## 7. Decisiones no obvias

- **FIFO por createdAt vs lineIndex**: FIFO entre pedidos; dentro del mismo pedido,
  FIFO por lineIndex. Es el orden natural del cliente que esperó más tiempo.
- **Fallback cuando BO queda qtyOpen=0**: `state='cancelled'` + `closedReason='absorbed_by_newer_confirmed'`.
  Mismo pattern que §40.6/§40.7 pero con closedReason propio para auditoría separable.
- **operations_log fire-and-forget post-TX**: dentro del tx no se puede (bloquea);
  es best-effort audit.
- **asigReserva=false al cancelar**: BO ya no reservaba (§40), pero por disciplina
  defensiva se setea false (idem §40.7).
- **Shape de absorption**: `{sku, cantidad, pedidoIdOrigen, lineIndexOrigen, qtyAntes, qtyDespues}`
  — todo lo que el UI necesita para "cubre N unidades" + lo que el oneliner
  `_origenesACancelar` necesita para armar el array extendido.
