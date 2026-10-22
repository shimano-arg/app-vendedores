# Grises Encontrados — Etapa 1 Auditoría Grises Stock (consolidado)

**Fecha**: 2026-10-22
**Rama**: `audit-grises-stock` (desde main post-v1424).
**Metodología**: `superpowers:brainstorming` (23 casos en `41_BRAINSTORMING_ANEXO.md`) + `superpowers:dispatching-parallel-agents` (5 agentes G1-G5 en paralelo).

> Sub-mds detallados por agente: `41_GRISES_G1_concurrencia.md`, `_G2_asignaciones_reparto.md`, `_G3_unificacion.md`, `_G4_estados_sap.md`, `_G5_datos_migraciones.md`.

## Normalización severidad (coordinador)

Para consolidar criterios de los 5 agentes:
- **ALTA** = rompe stock / pérdida financiera concreta / regresión silenciosa de regla
- **MEDIA** = confunde VDE o UX inconsistente / data corrupta sin impacto operativo inmediato
- **BAJA** = cosmético / defensivo / edge case teórico sin reporte prod

Tamaño:
- **S** (chico) = ≤30 LOC + 1 test, cerrable Etapa 3
- **M** (medio) = 30-150 LOC + 2 tests, cerrable Etapa 3 si prioritario
- **L** (grande) = >150 LOC o rediseño arquitectural, va a tabla con estimación (NO se empieza)

## Resumen agregado

**Total casos**: 98 (G1=18, G2=18, G3=15, G4=17, G5=30).

| Agente | Casos | ALTA | MEDIA | BAJA | BLOQ | S | M | L |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| G1 concurrencia | 18 | 9 | 8 | 1 | 0 | 10 | 0 | 8 |
| G2 ASIG+reparto | 18 | 7 | 7 | 4 | 0 | 9 | 7 | 2 |
| G3 unificación+R5 | 15 | 5 | 6 | 3 | 1 | 10 | 5 | 1 |
| G4 estados+SAP | 17 | 5 | 2 | 10 | 0 | ~ | ~ | ~ |
| G5 datos+migraciones | 30 | 10 | 11 | 7 | 0 | ~ | ~ | ~ |
| **Total** | **98** | **36** | **34** | **25** | **1** | **39+** | **12+** | **11+** |

## Prioridades consolidadas Etapa 3

### Bloqueantes (pre-E2)
- **G3.13 (BLOQ)**: correr `scripts/audit/P_clientes_multiple_waitlists.cjs` antes de E2 (verificar cuántos clientes con 2+ waitlists abiertas HOY post deploys v1405-v1419).
- **G4.13 (ALTA)**: verificar `app_config/sap_sync_state.mode` HOY (si `shadow`, cambia severidad de G07/G17 a crítica).

### Prioridad 1 — ALTA + S/M (candidatos cerrar Etapa 3)

| ID | Caso | Agente | Tamaño |
|---|---|---|---|
| G1.G05 | revertSobreAsignadas 2x mismo tick → doble append | G1 | S |
| G1.G06 | sapGet timeout → fallback POST duplica SQ | G1 | S |
| G1.G07 | reparto apply 2x por lock race | G1 | S |
| G1.G15 | sendingSapLock 5min stale (SAP SL >5min) | G1 | S |
| G1.G10 | CF01+CF05 cleanup waitlist silent fail | G1 | S |
| G1.G17 | §42 fresh query cae a cache en permission-denied | G1 | S |
| G2.G2.06 | ASIG facturada SAP entre waitlist→confirm (v1280 skip silente) | G2 | S |
| G2.G2.14 | Línea `origen='stock-asignado'` con `asigRefs=[]` (regresión H1) | G2 | S |
| G2.G2.09 | Reparto unlock error path | G2 | M |
| G2.G2.10 | 2 repartos abiertos mismo SKU race | G2 | M |
| G2.G2.01 | ASIG vence entre waitlist→confirm | G2 | M |
| G2.G2.15 | asigRefs apunta a pedido cerrado | G2 | M |
| G3.G01 | Unificar 2 CPST mismo SKU, asigRefs distintas | G3 | M |
| G3.G02 | Unificar BO+entregable mismo SKU, BO absorbida no cancelada | G3 | M |
| G3.G03 | Guard §42.2 cross-vendor merge | G3 | M |
| G3.G11 | Unificar vs stage=consumed race | G3 | M |
| G4.G07 | Confirmed con orderDocEntry pre-§40.8 (47 líneas Query 2026-10-21) | G4 | S |
| G4.G08 | needsManualIntervention sin dashboard | G4 | M |
| G4.G16 | Pedidos confirmed sin transferidoSAP sin alerta >1h | G4 | M |
| G5.1 | B05 qtyOpen > qty (invariante R9) | G5 | S |
| G5.11 | assignments.lineIndex inválido | G5 | S |
| G5.13 | waitlist stage=consumed + closedAt=null | G5 | S |
| G5.18 | globals `_pendingPedido*` leak try/finally | G5 | S |
| G5.26 | SAP Committed vs app confirmed sin orderDocEntry | G5 | S |

**Total P1**: ~24 casos chicos+medianos candidatos cerrar E3.

### Prioridad 2 — ALTA + L (estimación, NO se empieza)

| ID | Caso | Estimación |
|---|---|---|
| G1.G01 | 2 VDEs confirman mismo SKU → runTransaction server-side pedidos.add | 2 días (nuevo callable + migración call-sites) |
| G1.G02 | Reparto vs confirmación concurrente | 1 día (`stockFisicoDep11` inside txn) |
| G1.G04 | Snapshot SAP stale 30min | 3 días (reducir frecuencia + flag UI + trigger push) |
| G1.G09 | CF02+CF06 autoConfirm race | 2 días (callable `confirmPedidoCF`) |
| G1.G13 | 2 tabs mismo user optimistic | 2 días (callable `createWaitlistFromCPST`) |
| G1.G14 | Clock skew device vs server | 3 días (migrar todos los timestamps a serverTimestamp) |
| G1.G16 | autoConfirmPendingPedidosCF no re-check stock | 1.5 días |
| G2.G2.03 | Cliente ASIG viva + orden normal mismo SKU no unifica | 3 días (extender §42 a órdenes confirmadas) |
| G2.G2.05 | Excel importado con SKU asignado no marca origen | 2 días (integrar bloque v1280 en Excel flow) |
| G3.G05 | Race 2 users create para mismo cliente <500ms | 1 día (`runTransaction` _createOrUnifyWaitlistPayload) |
| G4.G03 | Confirmed editado post-SAP → sapDocTotal stale | 1.5 días (decisión: bloquear edit vs re-POST vs warning) |

**Total P2**: 11 casos grandes, ~22-25 días hombre acumulados. Van al informe E5.

### Prioridad 3 — MEDIA + S/M (si queda budget E3)

| ID | Caso | Agente | Tamaño |
|---|---|---|---|
| G1.G08 | Observer effect `now` entre renders | G1 | S |
| G1.G11 | Reparto + expireAsig misma línea asigAt | G1 | S |
| G1.G12 | reserveNextOrderNumber gap | G1 | S |
| G1.G18 | Breakdown no-atómico (snapshot + live) | G1 | S |
| G3.G04 | Prospecto sin cardCode N órdenes | G3 | S |
| G3.G06 | Self-unify §42.2.1 verificar sticky | G3 | S |
| G3.G08 | §42.2 review no escribe unifiedFromWaitlistId en pedido B | G3 | S |
| G3.G09 | Excel absorbe CPST sin §40.5 revert | G3 | S |
| G3.G12 | Guard §42.2 pedido directo sin waitlist origen | G3 | S |
| G3.G15 | Unificación preserva vendor target (R7 drift) | G3 | S |
| G4.G01 | Pending pre-§36 window 10min | G4 | S |
| G4.G05 | Factura parcial §40.8 | G4 | S |
| G5.2 | B06 qty ≤ 0 activa | G5 | S |
| G5.3 | B07 precio=0 self-unify residual | G5 | S |
| G5.8 | B16 pedidos lines=0 vivas | G5 | S |
| G5.21 | L06 Pedido Final fórmula local | G5 | S |
| G5.22 | L14 Generar Backorder sin TTLs | G5 | S |
| G5.23 | L30 Dashboard fórmula propia (migrar a breakdown) | G5 | M |
| G5.25 | L34 Forecast sin TTL BO (migrar a breakdown) | G5 | M |

**Total P3**: ~19 casos chicos/medianos.

### Prioridad 4 — BAJA (opcional)

25 casos BAJA restantes: cosméticos, defensivos, edge cases teóricos sin reporte prod. Van al informe como "backlog audit".

## Scripts audit propuestos

### Existentes a correr HOY contra prod (dry-run)
- `P_clientes_multiple_waitlists.cjs` (G3.13 BLOQ)
- `L_manual_backorder_sin_cliente.cjs` (G5.4 post-v1401)
- `M_pedidos_key_o_clientname_vacio.cjs` (G5.20 R10)
- `K_confirmed_con_order_docentry.cjs` (G4.07 pre-§40.8 residual)
- `H_cerrar_repartos_fantasma.cjs` (G5.10 B14)
- `J_sobre_asignadas_prod.cjs` (G5.12)
- `audit-waitlist-integrity.cjs` (G5.13)
- `Q_vendedor_desalineado.cjs` (R10)

### Nuevos propuestos para Etapa 2 (14)

| Script | Qué mide |
|---|---|
| `G5a_qtyopen_gt_qty.cjs` | Líneas con `qtyOpen > qty` state activo (G5.1) |
| `G5b_qty_lte_zero.cjs` | Líneas `qty <= 0` state activo (G5.2) |
| `G5c_precio_cero.cjs` | Líneas `precio=0+priceAtCreation=0` state no cancelled (G5.3) |
| `G5e_asigat_estado_mismatch.cjs` | `asigAt != null` + state no ASIG (G5.5) |
| `G5f_closedreason_sin_cancel.cjs` | `closedReason != null` + state no cancelled (G5.6) |
| `G5g_origen_sin_asigrefs.cjs` | `origen='stock-asignado' + asigRefs=[]` (G5.7) |
| `G5h_pedidos_sin_lineas_vivas.cjs` | Pedidos con todas líneas cancelled/invoiced pero `closedAt=null` (G5.8) |
| `G5i_migration_v1278_lineas_huerfanas.cjs` | Líneas `revertedFromAsigReason='migration-v1278' + age>90d + state=BO` (G5.9) |
| `G5k_assignments_lineindex_inv.cjs` | ingresos_reparto.assignments[].lineIndex apuntando a línea inexistente (G5.11) |
| `G5l_reparto_qty_gt_fisico.cjs` | Repartos abiertos con qty > físico actual (G5.12) |
| `G5m_repartos_dup_sku.cjs` | 2+ ingresos_reparto abiertos mismo SKU (G5.27) |
| `G5p_historial_sin_origen_line.cjs` | Pedidos abiertos pre-v1382 sin `line.origen` (G5.28) |
| `G5s_localstorage_legacy_audit.md` | Enumerar 10 keys legacy sin TTL (G5.19) |
| `G5z_sap_mismatch_committed_vs_app.cjs` | Snapshot Committed vs app confirmed sin orderDocEntry (G5.26) |

## Tests nuevos propuestos para Etapa 3

| Test | Cubre |
|---|---|
| `tests/unit/audit/sw-version-coherency.test.js` | G5.14 CACHE_VERSION == APP_VERSION |
| `tests/unit/audit/vendor-outlines-cleanup.test.js` | G5.15 cleanup v13-v16 missing |
| `tests/unit/audit/vendor-outlines-invalidation.test.js` | G5.16 listener setea cache=null |
| `tests/unit/audit/pending-pedido-globals-leak.test.js` | G5.18 try/finally cleanup |
| `tests/unit/audit/l06-pedido-final-vs-breakdown.test.js` | G5.21 L06 R8 |
| `tests/unit/audit/l14-genbo-vs-breakdown.test.js` | G5.22 L14 R8 |
| `tests/unit/audit/l33-productpicker-fallback.test.js` | G5.24 L33 silent-degrade |
| `tests/unit/audit/l34-forecast-vs-breakdown.test.js` | G5.25 L34 R8 |
| `tests/unit/audit/computeVaASap-nan-guard.test.js` | G5.30 sapDocTotal NaN |
| `tests/unit/audit/origen-sin-asigrefs.test.js` | G5.7 shape incompleto §35 |
| `tests/unit/property/stock-invariants.test.js` | Property-based (fast-check) R1-R10 invariantes |

## Preguntas abiertas E0 resueltas en E1

- **invoice-sync-core escribe o loguea**: DEPENDE DE `app_config/sap_sync_state.mode`. Si `active` → aplica writes vía `applyInvoiceMatch`. Si `shadow` → solo loguea. **Verificar HOY en prod** (G4.13).
- **DiscountPercent payload SL**: correcto post-§53 v1419. Lee `pedido.discountPct` con fallback `discountSnapshot.pctTotal`, clamp [0,100]. Deploy confirmado 2026-10-22T18:19.
- **Divergencia nombre closedReason**: `sync-sap-quotation-closures-core.js:403` escribe `'sap_manual_close'` (NO `'sap_quotation_closed_manual'` como aparece en CLAUDE.md §24). Cosmético, actualizar doc.

## Decisiones Etapa 3

Dado budget E3 = 30 turnos:

- **Cerrar en E3**: ~24 casos P1 (ALTA + S/M). Priorizar los que afectan stock real.
- **Agregar al backlog estimación**: ~11 casos P2 (ALTA + L) con días/hombre.
- **Agregar P3 si queda budget**: ~19 casos MEDIA.
- **Omitir E3**: 25 BAJA (van al informe como "backlog audit").
- **Property-based tests (E3.6)**: cubrir invariantes R1-R10 con fast-check sobre operaciones aleatorias de SKU — captura clase entera de grises.

## Gate E1

```bash
test -f docs/auditoria/41_GRISES_ENCONTRADOS.md && \
test -f docs/auditoria/41_BRAINSTORMING_ANEXO.md && \
awk '/^\|/ && !/-----/ && !/^\| ID/ && !/^\| id/' docs/auditoria/41_GRISES_ENCONTRADOS.md | wc -l | awk '$1 >= 40 {exit 0} {exit 1}' && \
grep -cE "^- \*\*B[0-9]" docs/auditoria/41_BRAINSTORMING_ANEXO.md | awk '$1 >= 15 {exit 0} {exit 1}' && \
echo GATE_E1_OK
```

**98 filas totales** en el consolidado (sumando sub-tablas). Brainstorming anexo 23 casos. Gate ejecutado post-write.
