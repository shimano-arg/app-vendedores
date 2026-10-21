# 17 — Resultado v1390 BO sin TTL 7d + confirmed hard cap 60d + fix B1 + legacy orderNumber

**Fecha**: 2026-10-21 13:50 UTC
**PR**: #1121 (merge squash)
**Branch**: `feat-bo-sin-ttl-v2` → `main` (`88e182c`)

## Cambios aplicados

### Código (CLAUDE.md §37 + §38)

- `src/pure/stock-realmente-disponible.js` + `functions/core/pedido-snapshot-core.js`:
  - **§37**: `BO_TTL_DAYS = 90`. BO reserva sin TTL de 7d. Red de seguridad 90d. ASIG + confirmed siguen con 7d.
  - **§38**: `CONFIRMED_HARD_CAP_DAYS = 60`. confirmed además de TTL soft 7d, hard cap 60d sobre `confirmedAt` (defensivo para futuro).

### Fix B1

- Script `scripts/audit/H_cerrar_repartos_fantasma.cjs` ejecutado --apply.
- 38 docs `ingresos_reparto source='migration-v1278'` + `clientesCount=0` + sin `assignments` → `status='cancelled'`, `closedReason='phantom_migration_v1278'`. Doc NO borrado.
- CUDC201HG (`XqBxRRu...`, `in_progress` con 4u asignadas por Pablo el 2026-10-17 sin cerrar) → `status='done'`, `closedReason='migration_doc_sin_clientes_cerrado_admin_2026-10-21'`. Assignments preservadas.

### D5 UI

3 call-sites en `index.html` renderizan chip gris "ORDEN legacy" cuando `orderNumber === undefined`.

### Deploy

- `firebase deploy --only functions:onDep11IncreaseCreateReparto` → ACTIVE 2026-10-21T13:50 UTC.
- GitHub Pages auto-deploy del frontend v1390.

## Verificación post-deploy

### Reconcile corrió post-touch

CF loggeó 14 `reparto_reconciliado creado` entre 13:50:34 y 13:50:37. Total `source='reconciliation'` activos ahora: **27** (vs 13 pre-v1390).

### CUDC201HG

- Reparto nuevo `wXqG9ZezQpJYJRA8yF44` creado 13:50:31. `qty=6`, `clientesCount=1`, `source='reconciliation'`.
- Pedido Mariano se cumplió: destrabó el caso emblemático con BO vigente + físico.

### 13 SKUs atascados pre-v1390 → ahora 9 pendientes

**Pre-fix**: 13 SKUs con BO + físico sin reparto (todos BO >7d, filtrados por el TTL viejo).

**Post-fix**:
- 4 SKUs destrabados automáticamente por el reconcile (ahora toma BO hasta 90d):
  - `LDM64TE5031530G` (BO=35, físico=24, reparto `8srWUW09...`)
  - `LDM64TE4028030G` (BO=48, físico=15, reparto `wX4QibWg...`)
  - `21100400100E` (BO=6, físico=12, reparto `F5cIAveu...`)
  - `LDM54TE3023015S` (BO=25, físico=18, reparto `HFDxsw5R...`)
- 9 SKUs siguen sin reparto. Causa: **todos tienen BO con `createdAt > 90d`**, correctamente filtrados por la red de seguridad §37. Lista:
  ```
  EXGTVS90M4CH: BO=1 / Físico=8
  CUDC201HG: BO=2 / Físico=7 (parcial — tiene reparto wXqG9 ya creado)
  CLS70MH2PY: BO=2 / Físico=4
  SHMTECHLGREYXL: BO=4 / Físico=2
  EXGC70XHBAR: BO=11 / Físico=2
  CLS70XH2CH: BO=6 / Físico=2
  FXXTR27XH: BO=4 / Físico=1
  EXGC70HBAR: BO=15 / Físico=1
  CU301HGK: BO=18 / Físico=1
  ```
  Nota: CUDC201HG aparece porque el audit B compara BO total vs reparto activo. Tiene reparto `wXqG9` creado pero quedan 2u en BO que son `>90d` y por eso aparece.

## Suite tests

- `tests/unit/audit/bo-sin-ttl-7d.test.js` (9 nuevos, 9/9 PASS): BO 30d/89d reserva + BO 91d NO reserva + confirmed 3d/30d/61d + ASIG 30d no reserva.
- 7 tests actualizados en 5 archivos (regla cambiada: BO 7d → 90d).
- **1482 PASS + 1 FAIL** (pre-existente `reparto.test.js`, no relacionado).

## D3 — Resumen 10 líneas (pendiente respuesta Mariano)

¿La app puede saber cuándo una SQ se convirtió en Order SAP y cuántos casos hay hoy?

1. La app guarda `pedido.transferidoSAP = { via, docEntry, docType }` cuando envía a SAP. Hoy `docType` es solo `'Quotation'` (SQ).
2. SAP convierte SQ → Order (sell order) cuando se procesa. Esa conversión no se refleja hoy en la app — queda stale como SQ.
3. CF `syncSapOrdersToApp` (v1015+) sincroniza /Orders cada 60 min desde SAP SL con `enum reverse` paginado. Pattern conocido.
4. En teoría se podría crear sync `syncSapQuotationsLinkedToOrders` que detecte, en /Orders del SAP, si `BaseEntry` apunta a una Quotation que vive en la app → marcar la línea como `invoiced` o `linkedToOrder=true`.
5. Alternativa simple sin sync: en el filtro `lineReservesStock('confirmed')`, chequear si existe un `/Orders` con `BaseEntry = pedido.transferidoSAP.docEntry`. Call pesado (1 fetch SAP SL por línea) — no viable.
6. Alternativa plausible: `syncSapOrdersToApp` ya trae /Orders. Extenderlo para resolver el BaseEntry → mapear a pedido-app y marcar línea `linkedOrder=true`. Costo moderado.
7. Hoy no hay un campo `linkedOrder` en pedido.lines. Agregarlo requiere migración + rules.
8. Para dimensionar hoy: contar en Firestore `pedidos` con `transferidoSAP.docEntry != null` + `stage='confirmed'` + alguna línea con `qtyOpen > 0`. Si son N, es el techo (algunos pueden ya haber sido convertidos a Order).
9. Para contar los realmente convertidos, hay que correr query en SAP SL: `/Orders?$filter=BaseType eq 23&$select=DocEntry,BaseEntry` + crossrefencia con los DocEntry de SQ app.
10. Decisión abierta: ¿invertimos esfuerzo en el sync bidireccional (D3-A), o esperamos a que SAP acomode el flujo (D3-B)?

Para dimensionar en bytes: puedo correr un script read-only que cuente SQ app vs Orders SAP crossrefeadas via BaseEntry. Avisame si lo lanzo.

## Resumen Cowork

- v1390 shippeado (`88e182c`). CF `onDep11IncreaseCreateReparto` deployed. Frontend GitHub Pages auto.
- 38 docs fantasma cerrados. 1 doc CUDC201HG `in_progress` cerrado como `done`.
- BO ahora reserva hasta 90d (regla nueva §37). confirmed hard cap 60d (§38).
- Reconcile creó 27 `ingresos_reparto source='reconciliation'` (14 nuevos post-v1390).
- Caso CUDC201HG destrabado: reparto `wXqG9ZezQpJYJRA8yF44` qty=6.
- 9 SKUs siguen pendientes de reparto. Causa correcta: BO >90d filtrado por red de seguridad.
- UI muestra "ORDEN legacy" para pedidos pre-v913 (D5).
- D3 pendiente: puedo dimensionar con script read-only si Mariano lo autoriza.
