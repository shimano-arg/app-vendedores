# Reparto manual de stock por Pablo (reemplazo del FIFO automático)

**Fecha**: 2026-10-14
**Pedido por**: Mariano
**Owner implementación**: Claude + Mariano aprobación por fase
**Status**: 🟡 Borrador — pendiente OK Mariano antes de Fase 1

---

## Contexto

Hoy el motor FIFO automático (CF `onStockChangeFIFOAssign`) promueve líneas `state='BO'` → `state='ASIG'` cada vez que sube el Dep 11 del `warehouseBreakdown` de SAP. Las promociones son:
- Tier-based (P → A → B → C según cliTipo del `client_master`).
- FIFO estricto por `createdAt` dentro de cada tier (no parcial — si no cubre el primer BO, se corta el tier).
- Transaccional contra `pedidos/{id}` dentro de `runTransaction()`.

Mariano quiere **eliminar la automatización** y reemplazarla por un **flow manual asistido**: Pablo (jefe operativo) ve cada ingreso de mercadería en un modal matricial y asigna manualmente cuántas unidades reparte a cada cliente con backorder.

### Rationale
El FIFO automático reparte sin criterio operativo. Pablo tiene visibilidad real de prioridades (cliente VIP que llamó, pedido urgente, logística de ruta, etc). El reparto manual lo deja decidir caso por caso.

---

## Decisiones default (marcar las que querés cambiar)

| # | Punto | Default propuesto | Alternativa |
|---|---|---|---|
| D1 | **Trigger**: ¿Dep 11 o Dep 12? | **Dep 11** (ingreso físico real) | Dep 12 (tránsito, anticipación) |
| D2 | **Migración ASIG actuales** | **Revertir a BO** (preserva demanda + audit) | Marcar `cancelled` / Borrar array |
| D3 | **Modal reparto** | **Nuevo modal independiente** (botón "REPARTO" en navbar) | Panel inline en Stock Asignado |
| D4 | **Rol / Gate** | Admin + email `pablogrieco@shimano.com.ar` (si existe) | Solo admin |
| D5 | **Validación "asignar > BO del cliente"** | **Bloquear** | Permitir con warning |
| D6 | **Validación "asignar < ingresadas"** | **Permitir** (resto queda stock libre) | Bloquear hasta repartir todo |
| D7 | **Validación "sum asignado > ingresadas"** | **Bloquear UI** | Permitir con warning |
| D8 | **Pedidos ya enviados a SAP** (state='confirmed') | **No tocar** — siguen flujo normal (facturación / entrega) | — |

**Nota sobre D1**: tu palabras "cuando ingrese mercadería (Dep 12)" son ambiguas. En SAP "Dep 12" es *tránsito* (barco en camino), no *ingreso*. El *ingreso real* al depósito de venta sube Dep 11. Si querés anticipación (Pablo prepara el reparto cuando sabe que viene), es Dep 12. Si querés el instante del ingreso físico, es Dep 11.

**Nota sobre D4**: no hay flag `isPablo` en el código. Hay `isMarianoUser` por email hardcoded. Si vas con D4 default, me decís el email de Pablo y lo agrego al gate.

---

## Blast radius (del mapeo del agente)

### Componentes a ELIMINAR
- `functions/index.js:870-895` — Cloud Function `onStockChangeFIFOAssign`.
- `functions/core/fifo-assign-core.js` — core completo (runFifoAssign, computeAssignmentsFifo, applyAssignments, loadBoCandidatesForSku).
- Audit collection `stock_assignment_log` / `stock_assignment_log_shadow` — queda data histórica pero no se escribe más.
- Tests asociados en `tests/functions/fifo-assign.test.js` (si existe).

### Componentes a MANTENER (no tocar)
- Trigger `onPedidoWriteRecalcSnapshot` (snapshot recalc por cambios de pedido). **Sigue funcionando** con las ASIG que crea el flujo manual.
- Auto-send a SAP: depende de `stage='confirmed'` del pedido, NO de `state='ASIG'` de línea. **No afectado**.
- Invoice sync: skippea ASIG/BO. **No afectado**.
- Asig recycle (`updateAsigLineState` callable): sigue sirviendo para que admin reasigne manualmente. **Reutilizable** para la fase manual.
- TTL expiración 60d (v1274): **mantiene**. Si Pablo asigna hoy pero el cliente no confirma en 60d, el stock vuelve al pool.

### Componentes a CREAR
- **Nueva collection Firestore** `ingresos_reparto/{id}`:
  - `sku`, `qtyIngresada`, `detectedAt`, `detectedBy` (sistema), `status` (`pending|in_progress|done`).
  - `assignments[]`: por cliente con BO, `cardCode`, `nombre`, `qtyBackorder`, `qtyAsignada` (editable Pablo).
  - `completedAt`, `completedBy` (Pablo).
- **CF Trigger `onDep11IncreaseCreateReparto`** (reemplaza a `onStockChangeFIFOAssign`):
  - Mismo evento (`stock_snapshot` write).
  - Mismo extract de deltas (reutilizo `extractSkusWithStockIncrease` de dep 11).
  - En vez de aplicar FIFO: crea doc en `ingresos_reparto/` con la lista de clientes BO + qty ingresada.
- **CF Callable `applyRepartoManual`**:
  - Pablo manda `{ingresoId, assignments: [{pedidoId, lineIndex, qtyAsignada}]}`.
  - Server valida sum(qtyAsignada) ≤ qtyIngresada + cliente tiene BO ≥ qtyAsignada.
  - Aplica transacciones a `pedidos/*.lines[]`: split línea BO en (qtyAsignada → ASIG) + (resto → BO).
  - Marca `ingresos_reparto/{id}.status = 'done'`.
- **Modal "Reparto" en frontend**:
  - Nuevo botón en header (reemplaza "ESTADO" — confirmar ubicación).
  - Lista `ingresos_reparto` con `status='pending'` o `in_progress`.
  - Matriz: SKU | CLIENTE | BACKORDER | INGRESO | ASIGNADO (input).
  - Suma total vs ingreso + validaciones live.
  - Botón "APLICAR" → llama callable.

### Migración datos (una vez)
- Script `scripts/migrate_asig_to_bo_v1277.py` (o CF one-shot):
  - Query `pedidos WHERE closedAt == null`.
  - Para cada línea `state='ASIG'` + `qtyOpen > 0`:
    - Según D2: revertir a `state='BO'` + resetear `asigAt`, `asigReserva`, `asigCliTipo`. Agregar `revertedFromAsigAt=now`, `revertedFromAsigReason='migration-v1277-reparto-manual'`.
  - Audit en nueva collection `asig_migration_log_v1277/{iso}`.
  - **Importante**: NO tocar líneas `state='confirmed'` (ya en SAP, siguen su flujo).

---

## Fases propuestas

### Fase 0: Approval + preparación (ESTA FASE)
- Mariano confirma D1-D8.
- Mariano confirma ubicación del botón "ESTADO" → "REPARTO".
- Mariano confirma email de Pablo si va D4-default.
- Yo preparo el gate en código (sin deployar).

### Fase 1: Backend — nuevo motor manual (deployable solo, sin UI)
- Crear `functions/core/reparto-core.js`.
- CF trigger `onDep11IncreaseCreateReparto` (NO deploy aún — solo escrito).
- CF callable `applyRepartoManual` (NO deploy aún).
- Tests unitarios de ambos.
- Deploy en modo **shadow** (crea `ingresos_reparto` docs pero sin UI que los consuma).
- Observar durante 24h si no hay regresión.

### Fase 2: Frontend — modal "Reparto"
- Crear modal + botón.
- Hook con callable `applyRepartoManual`.
- Smoke manual con Pablo en producción (con el motor FIFO viejo aún corriendo en paralelo).

### Fase 3: Switchover
- Deshabilitar motor FIFO (comentar trigger `onStockChangeFIFOAssign`).
- Correr migración ASIG → BO.
- Pablo empieza a usar modal.

### Fase 4: Cleanup
- Borrar código FIFO viejo (`fifo-assign-core.js`, tests).
- Documentar en README §41.

**Rollback**: en cada fase el deploy anterior se mantiene. Si Fase 3 falla, revertir migración (hay audit en `asig_migration_log_v1277`) + re-habilitar `onStockChangeFIFOAssign`.

---

## Preguntas abiertas (necesito que confirmes)

1. **D1-D8**: ¿aceptás los defaults o cambiás alguno?
2. **D4**: email de Pablo si va default.
3. **Botón "ESTADO"**: ¿dónde está hoy en la UI? ¿Navbar? ¿Dentro de un modal? Mandame screenshot o describime la ruta.
4. **Agrupación del modal**: ¿un ingreso por SKU (cada vez que sube dep 11 de un SKU, un card) o un ingreso agrupado (snapshot a snapshot, todos los SKUs juntos)?
5. **Multi-reparto parcial**: si Pablo asigna 30 de 50 ingresadas, ¿las 20 restantes quedan como "pending" en el modal para repartir después, o se dan por "stock libre" permanente?
6. **Timing de la migración ASIG→BO**: ¿hacerla el mismo día que deployamos, o esperar un período de observación?

---

## Métrica de éxito
- Pablo abre el modal al llegar mercadería y reparte en < 5 min por SKU.
- Zero promociones automáticas BO → ASIG post-switchover.
- Audit completo (quién asignó, cuándo, cuánto a cada cliente).
- Zero regresiones en flow confirmed → SAP → invoiced.
