# Grises G4 — Estados intermedios + SAP

**Agente**: general-purpose G4 · 226s · 13 tool uses.
**17 casos G01-G17**.

## Preguntas abiertas E0 resueltas

- **Q13 (invoice-sync escribe o loguea)**: **DEPENDE DE MODE**. `functions/core/invoice-sync-core.js:101-106 readSyncMode` lee `app_config/sap_sync_state.mode`. Default `'shadow'`. En `active` → `applyInvoiceMatch` via `tx.update` setea `qtyInvoiced`, `qtyOpen`, `state='invoiced'`, cierra pedido con `closedReason='all_invoiced'`. En `shadow` solo loguea.
- **Q14 (DiscountPercent)**: **OK post-§53**. `functions/core/auto-send-sap-core.js:263-278` lee `pedido.discountPct` → fallback `discountSnapshot.pctTotal` → clamp [0,100]. Deploy 2026-10-22T18:19 confirmado.
- **Divergencia nombre**: `sync-sap-quotation-closures-core.js:403` escribe `closedReason='sap_manual_close'` (NO `'sap_quotation_closed_manual'` como dice el prompt). Cosmético, no funcional.

## Severidad

- **ALTA**: 5 (G03, G07, G08, G13, G16, G17).
- **MEDIA**: 2 (G01, G05).
- **BAJA**: 10 (G02, G04, G06, G09, G10, G11, G12, G14, G15).

## Tabla

| ID | Caso | Call-site clave | Sev | Status |
|---|---|---|---|---|
| G01 | Pending pre-§36 sin confirmedAt (10 min window hasta autoConfirmPendingPedidosCF) | `index.html:36374+ persistPendingEntry` | MEDIA | §36 defensivo OK |
| G02 | Confirmed SAP SL caído → reintento (v1006 idempotent) | `auto-send-sap-core.js:733-767` | BAJA | OK cerrado v1006+v1172 |
| **G03** | **Confirmed editado post-envío** → `sapDocTotal` stale + discountPct no re-envía al SL | `sync-sap-doc-totals-core.js:162-172` | **ALTA** | **NO cerrado** — decisión Mariano |
| G04 | SAP SQ cancelada manual (`closedReason='sap_manual_close'` real) | `sync-sap-quotation-closures-core.js:401-411` | BAJA | OK v1102 anti-race |
| G05 | SAP SO facturada parcial: §40.8 cubre + guard SKIP_STATES | `invoice-sync-core.js:321-345` | MEDIA | OK §40.8 |
| G06 | Factura SAP sin pedido app (venta directa) → orphans log | `invoice-sync-core.js:481-488` | BAJA | OK diseño |
| **G07** | **S01 confirmed con orderDocEntry** — 47 líneas / 119u / 46 SKUs en query 2026-10-21 | `scripts/audit/K_confirmed_con_order_docentry.cjs` | **ALTA** | **re-query HOY** |
| **G08** | **S03 CPST `needsManualIntervention` sin dashboard** → stock bloqueado 7d | `auto-send-sap-core.js:650-727` | **ALTA** | **Pendiente dashboard admin** |
| G09 | S05 VDE recorta + cancela draft (fantasma reverso) — §40.1 cerró double count | `index.html:_cpstConfirmar v1280` | BAJA | OK §40.1 v1393 |
| G10 | S10 línea `via='app_only'` sticky — race manual batch | `auto-send-sap-core.js:386-407` | BAJA | OK §28 — tool admin promover pendiente |
| G11 | `bypassAsigGate` audit-only (v1118) | `index.html:35874` | BAJA | OK audit |
| G12 | B03 `createdAt=null` serverTimestamp pending flush — §37 defensivo | `pedidos.add({createdAt: FieldValue.serverTimestamp()})` | BAJA | OK §37 |
| **G13** | **`app_config/sap_sync_state.mode` desconocido en prod** (shadow vs active) | `invoice-sync-core.js:101-106` | **ALTA** | **Verificar HOY** — si shadow, pedidos sobre-reservan hasta hard cap 60d |
| G14 | DiscountPercent post-§53 correcto | `auto-send-sap-core.js:263-278` | BAJA | OK v1419 §53 |
| G15 | `transferidoSAP.docNum` con `sapDocTotal=0` — fallback computeVaASap cascade | `src/pure/pedido-va-a-sap.js` | BAJA | OK fallback |
| **G16** | **Pedido `stage='confirmed' + transferidoSAP=null` > 1h sin alerta** — precedente §24 bug ~1 año | trigger `onPedidoConfirmedSendToSap` falla | **ALTA** | **Pendiente alerta** |
| G17 | Derivado G13 (shadow mode + invoice cursor avanza = loss trazabilidad) | `invoice-sync-core.js:528-566` v1172 | **ALTA** | Depende G13 |

## Prioridades

1. **G13** verificar `app_config/sap_sync_state.mode` HOY (bloqueante para evaluar G07, G17 severidad real).
2. **G03** decidir: bloquear edit post-SAP vs re-POST vs warning.
3. **G07** re-query HOY — ver cuántas líneas quedan con el patrón pre-§40.8.
4. **G08** dashboard admin `transferError.needsManualIntervention`.
5. **G16** alerta pedidos confirmed sin SAP >1h.
