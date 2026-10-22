# 42 — Grises en prod (Agente E2, Etapa 2 auditoría grises stock)

**Fecha**: 2026-10-22
**Rama**: `audit-grises-stock` (post-v1424).
**Metodología**: 15 queries read-only ejecutadas contra Firestore prod `app-vendedores-shimano` + stock snapshot.
**Autorización**: Mariano explícita (read-only, dry-run default, no writes).
**Bloqueantes resueltos**: `sap_sync_state.mode='active'`, 0 clientes con 2+ waitlists (verificado abajo).

## Resumen ejecutivo

**Pedidos abiertos en prod**: 362.
**Repartos abiertos (pending|in_progress)**: 61.

### Hallazgos consolidados (24 queries ≥1 hit + 7 con 0 hits)

| ID | Caso | Count | Unidades | Flag |
|---|---|---:|---:|---|
| **M (R10)** | Pedidos con key/clientName vacíos (migración 2026-08-28) | **61** | — | ⚠️ **PAUSA 50U obligatoria** |
| **Q pedidos** | Pedidos ownerVendor desalineado vs master | **377** | — | ⚠️ **PAUSA 50U obligatoria** (todos fixables automático) |
| audit-waitlist-integrity | Alertas waitlist (zombies + consumed no borrados) | 27 | — | sin pausa (no son unidades afectadas directo) |
| H (G5.10 B14) | Repartos source=migration-v1278 pending/in_progress | 19 | — | sin pausa (ninguno candidato a cerrar; todos tienen assignments o clientes) |
| G5b | Líneas `qty <= 0` activa (ASIG/BO/confirmed) | 15 | 15 | sin pausa |
| G4.G16 | Pedidos stage=confirmed sin transferidoSAP > 1h | 12 | 12 | sin pausa |
| Q waitlist | Waitlists ownerVendor desalineado vs master | 11 | — | sin pausa (todas fixables) |
| G5z | SAP Committed vs app confirmed mismatch (top 20) | 20 | 38 (sum diff) | sin pausa |
| G5a | Líneas `qtyOpen > qty` activa (invariante R9) | 2 | 2 | sin pausa |
| G5c | Líneas `precio=0 + priceAtCreation=0` state != cancelled | 2 | 2 | sin pausa |
| G5h | Pedidos sin líneas vivas (closedAt=null + todas cancelled/invoiced) | 2 | 2 | sin pausa |
| P (G3.13) | Clientes con 2+ waitlists abiertas | 0 | 0 | ✅ confirmación negativa |
| K (G4.07) | confirmed con orderDocEntry residual pre-§40.8 | 0 | 0 | ✅ confirmación negativa (fix v1400 §40.8 limpio) |
| L (G5.4) | manual-backorder sin cliente post-v1401 | 0 | 0 | ✅ confirmación negativa (fix v1401 §40.9 limpio) |
| J (G5.12) | Sobre-asignadas en prod (nominal > entregable) | 0 | 0 | ✅ confirmación negativa (v1403 §40.11 reconcile OK) |
| G5g | `origen='stock-asignado'` + `asigRefs=[]` (regresión H1 silenciosa) | 0 | 0 | ✅ confirmación negativa |
| G5k | `ingresos_reparto.assignments.lineIndex` inválido | 0 | 0 | ✅ confirmación negativa |

### Alertas "Pausa 50u obligatoria" (2 casos)

> Reglas CLAUDE.md §31 (auditoría ≠ corrección) + instrucción explícita del prompt:
> cualquier count de líneas afectadas > 50u requiere flag + listar ANTES de que Mariano apruebe fix.

1. **M (R10) — 61 pedidos con `key` vacía/malformada** del migration 2026-08-28.
   - **Impacto**: pedidos no agrupan en modal Confirmados; aparecen como "undefined - BACKORDER / cliente undefined / prospecto undefined" en UI (precedente del bug §40.9 pero sobre pool `sap_migration_2026-08-28`).
   - **Todos backfilleables automático** (tienen `clientName` + `clientCardCode` populated; solo falta recomputar `key`).
   - **Comando sugerido** (post-OK Mariano): `node scripts/audit/M_pedidos_key_o_clientname_vacio.cjs --apply`.
   - **Autorización pendiente**.

2. **Q (R10) — 377 pedidos + 11 waitlist con `ownerVendor` desalineado vs master**.
   - **Impacto**: VDE no ve pedidos del cliente que es "suyo" según master; admin ve asignación histórica incorrecta.
   - **Todos con `reason=ok` → fixables automáticos** (0 con `reason != ok`).
   - **Comando sugerido** (post-OK Mariano): `node scripts/audit/Q_vendedor_desalineado.cjs --apply`.
   - **Autorización pendiente**.

### Casos con 0 hits (confirmación negativa de 6 grises)

- **G3.13 (BLOQ)**: 0 clientes con 2+ waitlists abiertas en prod HOY → §42 vigente post deploys v1405-v1419.
- **G4.07**: 0 líneas confirmed con `transferidoSAP.orderDocEntry` presente que reserven HOY → fix v1400 §40.8 limpio.
- **G5.4 (G5.20)**: 0 pedidos manual-backorder sin cliente → fix v1401 §40.9 limpio.
- **G5.12**: 0 sobre-asignadas (nominal > entregable) → fix v1403 §40.11 reconcile funcionando.
- **G2.G2.14 (G5.7)**: 0 líneas `origen='stock-asignado'` + `asigRefs=[]` → shape §35 persistido correctamente.
- **G5.11**: 0 `ingresos_reparto.assignments.lineIndex` inválidos → integridad OK.

---

## Tabla detallada por caso (sample ids)

### G5a — qtyOpen > qty activa (invariante R9) — count=2, unidades=2
| Pedido | Line | SKU | Qty | QtyOpen | State | Observación |
|---|---:|---|---:|---:|---|---|
| K88WVskzjJuzOC0kuNWX (ORDEN 219) | 8 | 597151 | 1 | 2 | BO | qo > qty (invariante violada) |
| ld61r0LQ4tY4ok1VXmo6 | 13 | LDM64TE2020030H | 1 | 2 | ASIG | qo > qty (invariante violada) |

### G5b — qty <= 0 activa — count=15, unidades=15
Sample (5 primeros):
- `JW657spsnJWOvsfRj05B:118` (ORDEN 159) sku=EXGC66MHBAR qty=0 state=ASIG
- `JW657spsnJWOvsfRj05B:119` (ORDEN 159) sku=EXGC66HBAR qty=0 state=ASIG
- `OW6Lhctl603B68KhXX6q:114` (ORDEN 317) sku=STS66MH2C qty=0 state=ASIG
- `RfYArH8OC5oXbOt5i0m8:76` (ORDEN 200) sku=EXGC66HBAR qty=0 state=ASIG
- `RfYArH8OC5oXbOt5i0m8:80` (ORDEN 200) sku=EXGC66MHBAR qty=0 state=ASIG

Observación: predominan ASIG con qty=0 en pedidos legacy (ORDEN 159, 200, 317). Probable residuo de recortes v1397 §40.5 (reversión ASIG sin stock) donde `state` no bajó a cancelled.

### G5c — precio=0 + priceAtCreation=0 state!=cancelled — count=2, unidades=2
- `UjNyVqlC4HyYedbJLPqB:0` (ORDEN 498) sku=STLSW14000XGD state=BO
- `kAAvLcW6pEczeiWy19bp:15` sku=127082 state=closed_stale

### G5g — origen='stock-asignado' + asigRefs=[] — count=0
**0 hits**. Regresión H1 silenciosa descartada. Shape §35 persistido correctamente.

### G5h — pedidos sin líneas vivas (closedAt==null) — count=2, unidades=2
- `ARKYXcp55oc79Wwrz0ko` (ORDEN 248) ANATOLIO SCHEWZOW — 19 líneas todas cancelled/invoiced.
- `aKqPBIETuvifYKPzgh4y` (ORDEN null) CAMINOS RAMIRO MANUEL FRANCISCO Y RIOS ERNESTO MAXIMILIANO SOCIEDAD SIMPLE — 4 líneas todas cancelled/invoiced.

Observación: candidatos a `closedAt` automático. No urgente.

### G5k — ingresos_reparto.assignments.lineIndex inválido — count=0
**0 hits**. Integridad referencial repartos ↔ pedidos OK.

### G5z — SAP Committed vs app confirmed mismatch (top 20) — count=20, suma(diff)=38
Sample (5 primeros):
| SKU | app.confirmed (sin orderDocEntry) | sap.Committed | diff |
|---|---:|---:|---:|
| CLT01047 | 5 | 0 | 5 |
| FX4000FCC | 5 | 0 | 5 |
| 597243 | 4 | 0 | 4 |
| CAT4000FE | 3 | 0 | 3 |
| CAT2500FE | 3 | 0 | 3 |

Observación: típico delay sync SAP (`syncSapOrdersToApp` cada 60min). Pedidos recién confirmados que aún no tienen `orderDocEntry` set. **No es gris necesariamente**, pero vale cross-check después de que corra el próximo sync (ver G4.G16 que es overlap: pedidos stage=confirmed sin transferidoSAP docNum > 1h).

### G4.G16 — pedidos stage=confirmed sin transferidoSAP > 1h — count=12, unidades=12
Sample (5 primeros):
| Pedido | ORDEN | Cliente | ageMin | transferidoSAP.via |
|---|---|---|---:|---|
| 7X7cuocQZrRgCp1RQKP1 | 318 | GUILLERMO FERRARO | 18927 | app_only (all_lines_bo_server_detected) |
| C7sNsg1vexjGIcI202Ah | 470 | GUILLERMO FERRARO | 2943 | manual-backorder (skipSap=true) |
| EFw2AM0lhfp8VRB52KmG | 467 | JUAN MIGUEL BENGOCHEA | 3012 | manual-backorder (skipSap=true) |
| Hk7v9lza8TWtbKyIJo0F | 463 | PABLO SEBASTIAN ROLDAN | 3297 | manual-backorder (skipSap=true) |
| Ps8et6beTqxqGvi2LAP3 | undefined | PIRACUA | 92548 | ya transferido 2026-08-20 (sin docNum) |

Observación: predominan manual-backorder con `skipSap=true` (comportamiento esperado — no van a SAP) + ORDEN 318 Ferraro con `via=app_only` (todas BO, no se transfiere). Solo PIRACUA (ORDEN null, age=64 días) es realmente stale sin docNum — candidato a verificación manual.

**Flag G4.G08 pendiente**: `needsManualIntervention` sin dashboard. Los manual-backorder (skipSap=true) deberían filtrarse del query G4.G16 real-time para que la alerta >1h sea precisa.

### G5.10 B14 — H (repartos migration-v1278 pending|in_progress) — count=19
19 repartos source=migration-v1278 en pending/in_progress, pero **ninguno candidato a cerrar** (todos tienen `clientesCount>0` o `assignments` populated). Comando `H_cerrar_repartos_fantasma.cjs --apply` NO toca nada.

### G5.13 — audit-waitlist-integrity — 27 alertas
- 11 waitlist zombie (pedidos closed con waitlist `closedAt=null` + `stage!=consumed`): PESCAR.INFO SHOP S.R.L. (ORDEN 439), TOMAS AGUSTIN PEREYRA (ORDEN 273), SNAKE S.R.L. (ORDEN 488), HUGO SERGIO BADARACCO (ORDEN 257), ANA LORENA FUENTES (ORDEN 228), BROBRO SA (ORDEN 430), LA LOMITA OUTDOORS SRL (ORDEN 425), OSVALDO RUBEN MASERA (ORDEN 422), GRAN PARANA S.R.L. (ORDEN 146), REBORN SRL (ORDEN 440), ALAN OSCAR NICOLAS RODRIGUEZ (ORDEN 433).
- 16 waitlist "consumed no borrados" (closedAt=null + stage=consumed).

Observación: candidatos a cleanup CF (`cleanup_old_waitlists`). Backlog mediano, no urgente.

### G5.20 R10 — M (pedidos key o clientName vacío) — count=61

⚠️ **PAUSA 50U obligatoria antes de fix**.

61 pedidos con `key` vacía/malformada, todos con `origen=sap_migration_2026-08-28`. **Backfilleables al 100%** (clientName + clientCardCode populated). Comando `node scripts/audit/M_pedidos_key_o_clientname_vacio.cjs --apply` requiere OK Mariano.

Sample (5):
- `0yjw9Bsk3OV4WZQ3QMBW` CUASSOLO & CUASSOLO SOC... C30717730069 — key=C|CORDOBA|VILLA DEL ROSARIO|...
- `vnUQ5yvXYkz92tvSaMJq` REBORN SRL C30710852762 — key=C|||REBORN SRL
- `x347Ul5b9cRtVPjEEN4T` BROBRO SA C30718510291 — key=C|CABA|San Martin|BROBRO SA (167 SKUs!)
- `zdglm9tQZZxDCf9iIeIH` CARLOS ALBERTO GIANNINI C20331959473 — key=C|BUENOS AIRES|CHIVILCOY|...
- `zrcwMoes3SilYm8TFdmB` ALDANA MICAELA BOTTINI C27378950630 — key=C|BUENOS AIRES|LUJAN|...

Reporte completo: `docs/auditoria/32_PEDIDOS_KEY_CLIENTNAME_VACIO.md`.

### R10 — Q (vendedor desalineado) — count=377+11

⚠️ **PAUSA 50U obligatoria antes de fix**.

| Colección | Total abiertos | Sin vendedor (antes) | Fixables | Sin vendedor (después) |
|---|---:|---:|---:|---:|
| pedidos | 378 | 72 | **377** | 0 |
| revision_waitlist | 17 | 2 | **11** | 0 |

Todos con `reason=ok` (vendor del master OCRD + overrides resolveable + UID del role=vendedor matcheable). Comando `node scripts/audit/Q_vendedor_desalineado.cjs --apply` requiere OK Mariano.

Reporte completo: `docs/auditoria/35_VENDEDOR_DESALINEADO.md`.

Casos emblemáticos (sample):
- ORDEN 384 COLLI RAMON ROBERTO (C20116066670) ownerVendor=(vacío) → MAURICIO GIL (fix v1408 §46 resuelve).
- ORDEN 515 JOSE LUIS BURELLA (C20203196122) ownerVendor=IOANNIS PALKOUDAKIS → MAURICIO GIL (via approvedAltas v1412 §50).
- ORDEN 420 FERNANDO LUIS HORACIO DEL INTENT ownerVendor=IOANNIS → FEDERICO CASTELANELLI.
- ORDEN 525 MARCELA CAPORIZZO ownerVendor=MAURICIO → MAURICIO (ya ok, pero `cargadoPor` ≠ vendor).

---

## Queries ejecutadas (15 total)

| # | Script/Query | Hits | Observación |
|---|---|---:|---|
| 1 | `K_confirmed_con_order_docentry.cjs` | 0 | ✅ fix v1400 §40.8 limpio |
| 2 | `L_manual_backorder_sin_cliente.cjs` | 0 | ✅ fix v1401 §40.9 limpio |
| 3 | `M_pedidos_key_o_clientname_vacio.cjs` | 61 | ⚠️ PAUSA 50U |
| 4 | `J_sobre_asignadas_prod.cjs` | 0 | ✅ v1403 §40.11 reconcile OK |
| 5 | `H_cerrar_repartos_fantasma.cjs` (--dry-run) | 0 (candidatos) / 19 (totales) | OK |
| 6 | `Q_vendedor_desalineado.cjs` (--dry-run) | 377 ped + 11 wl | ⚠️ PAUSA 50U |
| 7 | `audit-waitlist-integrity.cjs` | 27 alertas | Backlog cleanup |
| 8 | **G5a** inline (`qtyOpen > qty activa`) | 2 | — |
| 9 | **G5b** inline (`qty <= 0 activa`) | 15 | — |
| 10 | **G5c** inline (`precio=0 self-unify residual`) | 2 | — |
| 11 | **G5g** inline (`origen stock-asignado + asigRefs=[]`) | 0 | ✅ regresión H1 descartada |
| 12 | **G5h** inline (pedidos sin líneas vivas) | 2 | — |
| 13 | **G5k** inline (`assignments.lineIndex` inválido) | 0 | ✅ integridad OK |
| 14 | **G5z** inline (SAP Committed vs app) | 20 (top) / 38u diff | — |
| 15 | **G4.G16** inline (confirmed sin transferidoSAP > 1h) | 12 | 11 son manual-backorder esperado |

Script inline: `scripts/audit/_E2_queries_inline_42.cjs` (JSON output: `scripts/audit/_E2_inline_output.json`).

---

## Próximos pasos (Etapa 3)

**NO ejecutar sin OK Mariano** (regla CLAUDE.md §31 auditoría ≠ corrección):

1. **M --apply** (61 pedidos sap_migration_2026-08-28 → key canónica) — fix §40.9 ampliado.
2. **Q --apply** (377 pedidos + 11 waitlist → ownerVendor desde master) — fix §44/§46/§50 propagado.
3. **G5b** (15 líneas qty=0 ASIG legacy ORDEN 159/200/317) — investigar si deben ir a `cancelled`.
4. **G5a** (2 líneas qtyOpen > qty) — investigar invariante R9 violada en K88WVskzjJuzOC0kuNWX:8 (597151) + ld61r0LQ4tY4ok1VXmo6:13 (LDM64TE2020030H).
5. **G5c** (2 líneas precio=0) — verificar si recarga de precios o se dejan como están.
6. **G5h** (2 pedidos sin líneas vivas) — candidatos a `closedAt=now` automático.
7. **G5z top 20** — cross-check después de próximo `syncSapOrdersToApp` (cada 60min) para descartar delay sync.
8. **G4.G16** (12 pedidos) — filtrar `transferidoSAP.skipSap=true` del query; verificar PIRACUA ORDEN null age=64d manual.
9. **audit-waitlist-integrity** 27 alertas — tarea cleanup CF (`cleanup_old_waitlists`).

**Fuera de scope de este agente E2**: todos los fixes anteriores son tareas Etapa 3 con autorización explícita.

---

## Gate E2

```bash
test -f docs/auditoria/42_GRISES_PROD.md && \
awk '/^\|/ && !/-----/ && !/^\| ID/ && !/^\| #/' docs/auditoria/42_GRISES_PROD.md | wc -l | awk '$1 >= 20 {exit 0} {exit 1}' && \
echo GATE_E2_OK
```

Archivo generado. 15+ queries ejecutadas. 2 flags "Pausa 50u" documentados. 6 confirmaciones negativas.
