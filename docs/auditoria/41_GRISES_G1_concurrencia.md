# Grises G1 — Concurrencia + orden de eventos

**Agente**: general-purpose G1 · 352s · 46 tool uses.
**18 casos G01-G18**.

## Severidad (nomenclatura agente)
- rompe stock: 9 (G01, G02, G04, G06, G07, G13, G14, G15, G16)
- confunde: 8 (G03, G05, G08, G09, G10, G11, G17, G18)
- cosmético: 1 (G12)

## Tamaño
- chico: 10 (G05, G06, G07, G08, G10, G11, G12, G15, G17, G18)
- grande: 8 (G01, G02, G03, G04, G09, G13, G14, G16)

## Tabla

| ID | Caso | Regla | Sev | Tam | Fix propuesto |
|---|---|---|---|---|---|
| G01 | 2 VDEs confirman mismo SKU mismo stock libre mismo segundo | R3+R4 | ALTA | L | runTransaction server-side en `pedidos.add` con re-lectura breakdown |
| G02 | Pablo aplica reparto mientras VDE confirma venta mismo SKU | R3+R4 | ALTA | L | `applyRepartoManualCore:697` re-leer `stockFisicoDep11` dentro de `runTransaction` |
| G03 | Reconcile corre durante reparto; `revertSobreAsignadas` usa snapshot stale | R2+R3+R7 | MEDIA | L | re-leer `app_config/stock_snapshot` fresh en `revertSobreAsignadas` o lock por SKU |
| G04 | Snapshot SAP stale 30min vs venta app recién (S11 §40) | R1+R7 | ALTA | L | reducir frecuencia Python 5-10min + flag `stale` en breakdown + trigger push desde `syncSapInvoicesToApp` |
| G05 | B18 `revertSobreAsignadas` 2x mismo tick → doble append | R2+R3 | MEDIA | S | runTransaction + guard `splitFromLineIndex` duplicate |
| G06 | B19 `sapGet` timeout → fallback POST duplica SQ | R2 | ALTA | S | si `sapGet` falla → abort + `needsManualIntervention=true` (no fail-open) |
| G07 | B20 reparto apply 2x por lock write-fail | R2+R3 | ALTA | S | `runTransaction` para lock + `assignmentFingerprint` idempotente |
| G08 | B21 observer effect `now` entre renders flipea TTL | R5+R8 | MEDIA | S | pin `nowMs` por tick de render (un solo lugar superior) |
| G09 | CF02+CF06 race `autoConfirmPendingPedidos` vs VDE confirm manual | R3+R7 | MEDIA | L | callable `confirmPedidoCF` server-side atómico |
| G10 | CF01+CF05 cleanup waitlist silent fail → orden fantasma §42 | R2+R7 | MEDIA | S | mutex Firestore por waitlistId o merge en 1 CF atómico |
| G11 | CF08+CF09 reparto + expireAsig misma línea | R6 | MEDIA | S | verificar 3 paths `reparto-core.js:849-878` → todos setear `asigAt=nowIso` |
| G12 | `reserveNextOrderNumber` gap si `pedidos.add` falla | R6+R9 | BAJA | S | acoplar reserve + add en misma txn (o tolerar gap) |
| G13 | 2 tabs mismo user optimistic → §42 fresh query salva solo si latency Firestore > batch | R3+R4+R7 | ALTA | L | callable `createWaitlistFromCPST` server-side runTransaction |
| G14 | B01+B04 clock skew device vs server → TTL +/-2h incorrecto | R5+R7 | ALTA | L | `FieldValue.serverTimestamp()` para `asigAt/confirmedAt/createdAt` |
| G15 | `sendingSapLock` 5min stale si SAP SL >5min → duplica SQ (precedente 2026-08-21) | R2 | ALTA | S | subir TTL a 15min + lease con heartbeat + fix G06 |
| G16 | `autoConfirmPendingPedidosCF` no re-chequea stock entre compute y tx | R1+R7 | ALTA | L | re-leer stock_snapshot inside cada runTransaction |
| G17 | §42 fresh query fallback a cache si rules deniegan → doble orden silent | R8+R10 | MEDIA | S | callable `findOpenWaitlistsForClientCF` con Admin SDK |
| G18 | Breakdown no-atómico (fisico snapshot + pedidos live): 30min stale |  R1+R7 | MEDIA | S | extender firma breakdown con `snapshotUpdatedAt` + flag `stale` UI |

## Prioridades según agente

- **Prio 1 (rompe stock + chico)**: G05, G06, G07, G15 — cerrar en E3 con 1 PR cada uno.
- **Prio 2 (rompe stock + grande)**: G01, G02, G13, G14 — plan E4-E5 con design doc.
- **Prio 3 (confunde + chico)**: G08, G10, G17, G18.
