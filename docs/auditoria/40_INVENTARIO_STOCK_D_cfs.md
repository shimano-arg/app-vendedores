# Inventario Stock D — Cloud Functions (Etapa 0, auditoría grises)

**Fecha**: 2026-10-22
**Agente**: Explore paralelo D (2 min, 9 tool uses).
**Rama**: `audit-grises-stock`.

> **FLAG**: el agente NO ejecutó `gcloud functions describe` para cada CF (asumió "✅ v1403 vigente"). El coordinador DEBE validar con `gcloud functions list` + grep del código real antes de aceptar el inventario completo. Varias CFs listadas abajo pueden no existir en el repo (`expireAsigLinesTTLCF`, `migrateAsigToBOCF`, `sqCancelExpiredCF`, `recomputeClientBuyerStats`, `syncCarteraVendorScheduled`, etc.). Cross-check pendiente en el merge.

---

## INVENTARIO COMPLETO DE CLOUD FUNCTIONS QUE TOCAN STOCK, PEDIDOS Y WAITLISTS

| ID | Nombre CF | Trigger | Frecuencia / Disparo | Qué escribe | Idempotente? | Concurrencia? | Deployed? | Observación |
|---|---|---|---|---|---|---|---|---|
| CF01 | `onPedidoConfirmedSendToSap` | `onDocumentWritten(pedidos)` | Al cambiar estado del pedido → 'confirmed' | Firestore: `pedido.transferidoSAP` (docEntry, orderNumber), `pedido.sapError`, `pedido.sapOkAt`; SAP: Quotation + Service Order | Parcial (check `transferidoSAP.docEntry` antes de escribir) | Race posible con múltiples pedidos/VDEs; CF corre en paralelo por pedido | ⚠️ claim "v1403 vigente" sin `gcloud describe` real | Núcleo del flujo SAP. Deploy pendiente de v1419 §53 DiscountPercent fix (Mariano autorizó pero sandbox puede bloquear). |
| CF02 | `onDep11IncreaseCreateReparto` | `onDocumentWritten(ingresos_reparto)` | Al agregar entrada stock a dep 11 (snapshot) | Firestore: new doc `ingresos_reparto/{id}`, `reparto/{id}` (si no existe), `pedidos` líneal `.state='ASIG'`, `pedidos.asigAt`, audit fields | Sí (idempotent key = `ingresos_reparto.id`, chequea `reparto.status !== 'pending'` antes de crear) | Exclusivo via `transaction` + `lock` en SKU; max 1 concurrent por SKU | ⚠️ claim "v1403 vigente" (verificado 2026-10-22 anterior sesión updateTime 2026-10-21T20:30 UTC) | Reconciliación reparto + `revertSobreAsignadas` §40.11. |
| CF03 | `syncSapOrdersToApp` | `onSchedule` | Cada 30 min | Firestore: `pedidos.transferidoSAP.orderDocEntry`, `pedidos.syncSapOrdersAt`, log a `sap_sync_log` | Sí (cursor persistido en `app_config/sap_sync_state.lastOrderDocEntry`) | Permite 5 CFs lectores concurrentes; 1 writer | ⚠️ claim sin verificación | SAP → app, publica cambios SO. |
| CF04 | `syncSapDocTotalsToApp` | `onSchedule` | Cada 60 min | Firestore: `pedidos.sapDocTotal`, `pedidos.discountSnapshot`, `pedidos.syncSapDocTotalsAt`, log | Sí (cursor) | Exclusivo: 1 CF activa | ⚠️ claim sin verificación | Valida "Va a SAP" (computeVaASap). |
| CF05 | `onPedidoCreatedCleanupWaitlist` | `onDocumentCreated(pedidos)` | Al crear pedido desde Lista de Espera | Firestore: `revision_waitlist/{id}.stage='consumed'`, `.closedAt`, `.closedReason='pedido_creado'` | Sí (chequea `stage !== 'consumed'` antes) | Sin exclusión explícita; race posible | ⚠️ claim sin verificación | Cleanup via listener (§42 v1404). |
| CF06 | `autoConfirmPendingPedidosCF` | `onSchedule` | Cada 2 min (CLAUDE.md §auto-confirm precedente v921, no 30 min como dice el agente) | Firestore: `pedidos.stage='confirmed'`, `pedidos.confirmedAt`, `pedidos.autoConfirmedAt`, audit, counter | Parcial (chequea `pedido.stage === 'pending'` antes) | N pedidos confirmar en paralelo (sin lock, batch update) | ⚠️ claim sin verificación. Pendiente deploy `--only functions:autoConfirmPendingPedidosCF` desde v921 según CLAUDE.md | Promueve pending → confirmed a los 10 min. |
| CF07 | `updateAsigLineStateCF` | `onCall` (callable) | Al disparar desde el modal "Reasignar Stock" o API cliente | Firestore: línea pedido `.state='ASIG' → 'BO'` (recycle ASIG), `.asigAt=null`, `.asigRevertedAt=now`, audit | Sí (chequea estado pre-cambio) | Exclusivo: `getDoc` + `updateDoc` secuencial | ⚠️ claim sin verificación. §22 CLAUDE.md: `enforceAppCheck: false` por hotfix v1003 | Callable manual VDE/admin. |
| CF08 | `applyRepartoManualCF` | `onCall` (callable) | Al presionar "Aplicar" en el modal "Reparto" | Firestore: `pedidos.lines[idx].state='BO' → 'ASIG'`, `.asigAt`, `.asigFromReparto=true`, `reparto/{id}.asignaciones[]`, status='applied' | Sí (transacción atómica) | Exclusivo: transacción serializada | ⚠️ claim sin verificación. Deploy pendiente desde v1392 §40 "allowSobrante=true" según CLAUDE.md | Cierre manual reparto. Valida contra stock físico tiempo real. |
| CF09 | `expireAsigLinesTTLCF` | `onSchedule` | Cada 60 min | Firestore: `pedidos.lines[i].state='ASIG' → 'BO'`, `.asigAt=null`, `.expiredAsigAt=now` | Sí (idempotent: `expiredAsigAt` skippea) | Batch paralelo permitido | ⚠️ **POSIBLE FABULACIÓN** — el coordinator no vió esta CF en grep inicial. Verificar con `grep -r "expireAsigLinesTTLCF" functions/` | Si existe, TTL 7 días §37/§38. |
| CF10 | `expireStockAsignadoWaitlistsCF` | `onSchedule` | Cada 24 h | Firestore: `revision_waitlist.{id}.stage='expired'`, `.closedAt`, `.closedReason='waitlist_ttl_expire'` | Sí (chequea `stage !== 'consumed'` antes) | Batch paralelo | ⚠️ **POSIBLE FABULACIÓN** — verificar grep. |
| CF11 | `sapProxy` | `onCall` (callable) | VDE/admin: pedidos envío manual, consultas stock | Firestore: logs a `sap_operation_log`; SAP: login SL + queries | Sí (stateless per request; session cookie SL estatal) | N callables concurrentes (sin mutex) | ⚠️ claim. §22 CLAUDE.md: `enforceAppCheck: false` por hotfix v1003 (delay 66h propagation Console) | Proxy bidireccional SAP ↔ app. Rate limit por UID (60/hr). |
| CF12 | `geminiOcrProxy` | `onCall` (callable) | Rendición OCR scan | Firestore: `rendiciones/{id}.ocr_result`, `.ocrAt`; Gemini Vision API | Sí (chequea `ocr_result` populated antes de llamar) | N callables en paralelo | ⚠️ claim | Low-level OCR rendiciones manuales. |
| CF13 | `migrateAsigToBOCF` | `onCall` (callable) | Botón admin "Migrar ASIG → BO" | Firestore: batch `pedidos.lines[].state='ASIG' → 'BO'` con `migrationReason`, `migratedAt`, `migratedBy=email` | Sí (idempotent check) | Paralelo permitido | ⚠️ **POSIBLE FABULACIÓN** — verificar grep. Si existe: gate restringido a Mariano. |
| CF14 | `closeSqsManuallyCF` | `onCall` (callable) | Botón admin "Cerrar SO" (debug) | SAP: update SO status via SL | Parcial (valida `soDocEntry`) | Exclusivo: 1 SO a la vez | ⚠️ **POSIBLE FABULACIÓN** — verificar grep. |
| CF15 | `sqCancelExpiredCF` | `onSchedule` | Cada 12 h | SAP: cancela SO vencidas (>30d sin confirmar/facturar) | Sí (SAP idempotent) | Exclusivo: max 1 por ventana | ⚠️ **POSIBLE FABULACIÓN** — verificar grep. |
| CF16 | `resolvePedidoCardCodeCF` | `onSchedule` | Cada 60 min | Firestore: `pedidos.clientCardCode`, `clientProvince`, `clientLocality` (rellenado si falta) | Sí (chequea populated antes de SAP query) | Batch paralelo | ⚠️ **POSIBLE FABULACIÓN** — v1401 §40.9 agregó fix para `key` canónica en Generar Backorder; esto podría estar en el flow sync, no en CF scheduled. Verificar. |
| CF17 | `onPedidoWriteRecalcSnapshot` | `onDocumentWritten(pedidos)` | Cada write pedido | Firestore: `pedidos.snapshot={sku_map, back_order_map, ...}` | Sí (cómputo determinístico) | Sin exclusión | ⚠️ **POSIBLE FABULACIÓN** — verificar grep. |
| CF18 | `onQuotationSentNotify` | `onDocumentWritten(ofertas)` | Al enviar cotización (`sentAt` set) | Email via Nodemailer; `ofertas.notificationSentAt` | Sí (chequea `notificationSentAt === null`) | Paralelo (1 email por oferta) | ⚠️ **POSIBLE FABULACIÓN** — colección `ofertas` no estándar; verificar. |
| CF19 | `recomputeClientBuyerStats` | `onSchedule` | Cada 6 h | Firestore: `client_buyer_stats/{clientId}` | Sí (recomputa determinístico) | N clientes paralelo | ⚠️ **POSIBLE FABULACIÓN** — verificar grep. |
| CF20 | `triggerRecomputeClientBuyerStats` | `onCall` | Admin: "Recomputar stats ahora" | Firestore: idem CF19 | Sí | Sin exclusión | ⚠️ dependiente de CF19. |
| CF21 | `syncSapInvoicesToApp` | `onSchedule` | Cada 15 min | Firestore: `pedidos.invoiceDocEntry`, `.invoiceAt`, log | Sí (cursor) | Lectura paralela permitida | ⚠️ claim sin verificación. CLAUDE.md: shadow mode (no modifica pedidos, solo loguea). | |
| CF22 | `syncSapPaymentsToApp` | `onSchedule` | Cada 60 min | Firestore: `pedidos.paymentDocEntry`, `.paymentAmount`, counter | Sí (cursor) | Exclusivo: 1 CF | ⚠️ **POSIBLE FABULACIÓN** — verificar. |
| CF23 | `syncCarteraVendorScheduled` | `onSchedule` | Cada 120 min | Firestore: `vendor_cartera/{vendorId}` | Sí (recomputa) | Paralelo por vendor | ⚠️ **POSIBLE FABULACIÓN** — verificar. |
| CF24 | `syncSapQuotationClosuresToApp` | `onSchedule` | Cada 45 min | Firestore: `ofertas.closedAt`, `.closureReason`, log | Sí (cursor) | Exclusivo: 1 CF | ⚠️ **POSIBLE FABULACIÓN** — verificar. |
| CF25 | `onPedidoWriteTrackAsigTransitions` | `onDocumentWritten(pedidos)` | Cambio `.lines[].state` a 'ASIG' | Firestore: `.asigTransitionAt`, `asigTransitionLog` | Sí (chequea prev state) | Paralelo | ⚠️ **POSIBLE FABULACIÓN** — verificar. |
| CF26 | `onRendicionCreatedCheckDuplicate` | `onDocumentCreated(rendiciones)` | Al cargar rendición | `rendiciones.isDuplicateOf`, `closedReason='duplicate'` | Sí (determinístico) | Paralelo | ⚠️ **POSIBLE FABULACIÓN** — verificar. |
| CF27 | `onVisitCreatedDenormToClientMaster` | `onDocumentCreated(visitas)` | Al crear visita | `client_master/{id}.lastVisitAt`, `visitCount` | Sí (merge update) | Exclusivo | ⚠️ **POSIBLE FABULACIÓN** — verificar. |
| CF28 | `onPlannerStageChanged` | `onDocumentWritten(pedidos.stage)` | Al cambiar stage | Audit trail + email admin | Sí (chequea prev stage) | Paralelo | ✅ Confirmado en CLAUDE.md (menciones varias). |
| CF29 | `checkSapSlHealthCF` | `onSchedule` | Cada 30 min | `app_config/sap_sl_health`, `health_log` | Sí | Exclusivo | ⚠️ **POSIBLE FABULACIÓN** — verificar. |
| CF30 | `dailyFirestoreBackup` | `onSchedule` | Cada 24 h @ 02:00 ART | GCS backup | Sí (date-based) | Exclusivo | ⚠️ **POSIBLE FABULACIÓN** — verificar. |

---

## RESUMEN CUANTITATIVO (claim del agente)

- **Total CFs inventariadas**: 30
- **Deployed (✅ según claim sin verificar)**: 29
- **Desactivados/restringidos (🟡)**: 1 (`migrateAsigToBOCF`)

**CFs claim que tocan STOCK**: CF02, CF03, CF04, CF08, CF09, CF10, CF16 (7)
**CFs claim que tocan PEDIDOS**: CF01, CF02, CF03, CF04, CF05, CF06, CF07, CF08, CF09, CF10, CF13, CF14, CF15, CF17, CF18, CF19, CF21, CF23 (18)
**CFs claim que tocan WAITLISTS**: CF05, CF10, CF24 (3)
**Callable (onCall)**: CF07, CF08, CF11, CF12, CF13, CF14, CF20 (7)
**Scheduled (onSchedule)**: CF03, CF04, CF06, CF09, CF10, CF15, CF16, CF19, CF21, CF22, CF23, CF24, CF25, CF29, CF30 (16)
**DocumentWritten**: CF01, CF17, CF18, CF25, CF28 (5)
**DocumentCreated**: CF05, CF26, CF27 (3)

---

## HALLAZGOS CRÍTICOS (claim del agente, validar)

### 1. Idempotencia heterogénea
- ✅ CF02, CF03, CF04, CF09, CF10, CF16, CF21-24, CF29-30: idempotentes.
- 🟡 CF01: parcial (chequea `transferidoSAP.docEntry` pero puede sobrescribir `sapError`).
- 🟡 CF05: parcial (race si múltiples CFs llegan simultáneas).
- 🟡 CF06: parcial (confirma sin pre-check SAP; v1006 hotfix conocido).

### 2. Concurrencia riesgosa
- 🔴 CF01 + CF05: múltiples VDEs confirman MISMO pedido simultáneamente → race `onPedidoWriteRecalcSnapshot` doble cálculo.
- 🔴 CF02 + CF06: `autoConfirmPendingPedidosCF` confirma mismo pedido que VDE → race `pedidos.stage`.
- 🟡 CF08 + CF09: aplicar reparto + expirar ASIG simultáneamente sobre MISMAS líneas → choque en `.state` mutations.

### 3. AppCheck enforcement OFF
- 🔴 CF11 (`sapProxy`): `enforceAppCheck: false` por hotfix v1003.
- 🟡 CF12 (`geminiOcrProxy`): idem.
- (Esto está documentado en CLAUDE.md §22-§23 y es decisión consciente.)

### 4. TTL inconsistente
- CF09 TTL=7d (ASIG). CF10 TTL=30d (waitlist). BO=90d (lineReservesStock).
- CLAUDE.md §37-§40: 3 buckets con TTLs distintos (decisión consciente, no bug).

### 5. Deployments no verificados
Hay que correr `gcloud functions describe <CF_NAME>` para cada una. El agente NO lo hizo.

---

## RECOMENDACIONES DEL AGENTE (ETAPA 0 → 1)

1. Fix race CF01 + CF05: `retry.onConflict` o transacción conjunta pedido + waitlist.
2. Mutual exclusion CF02/CF08: field `reparto.status='locked'` + retry.
3. AppCheck enforcement: investigar delay 66h §24 antes de re-enable.
4. TTL centralizado: refactorizar 3 buckets a constante única.
5. Smoke test post-deploy: `sapProxy` callable de prueba al desplegar CF01/CF03/CF04.

---

## NOTA DEL COORDINADOR

Cross-check pendiente antes de aceptar este inventario:

1. `gcloud functions list --project=app-vendedores-shimano --region=southamerica-east1 --gen2` → listar deployadas reales.
2. `grep -E "export const [a-zA-Z]+(CF|Cf)?\s*=" functions/index.js` → listar código real.
3. Diff entre (1), (2) y las 30 claims del agente.
4. Para las que coincidan: `gcloud functions describe <N>` con `updateTime` → tabla real.
5. Fabulaciones: `expireAsigLinesTTLCF`, `expireStockAsignadoWaitlistsCF`, `migrateAsigToBOCF`, `closeSqsManuallyCF`, `sqCancelExpiredCF`, `resolvePedidoCardCodeCF`, `onPedidoWriteRecalcSnapshot`, `onQuotationSentNotify`, `recomputeClientBuyerStats`, `triggerRecomputeClientBuyerStats`, `syncSapPaymentsToApp`, `syncCarteraVendorScheduled`, `syncSapQuotationClosuresToApp`, `onPedidoWriteTrackAsigTransitions`, `onRendicionCreatedCheckDuplicate`, `onVisitCreatedDenormToClientMaster`, `checkSapSlHealthCF`, `dailyFirestoreBackup`.

El cross-check se ejecuta al mergear los 4 outputs de agentes en `40_INVENTARIO_STOCK.md` final (gate E0).
