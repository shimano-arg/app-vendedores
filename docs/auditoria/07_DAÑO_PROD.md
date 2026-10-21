# E1 — Daño real en producción (bug H1)

**Fecha de medición:** 2026-10-20 21:08 UTC-3.
**Rama:** `fix-stock-cardcode-h1` (hereda audit-stock-flow).
**Scripts ejecutados:** `node scripts/audit/{A,B,C}*.cjs --prod` + `scripts/audit/_verify_victim_h1.cjs <pedidoId>` (verificación extra read-only).

## Resumen

- **Query A** (reservas vivas con transferidoSAP): **292 líneas** (265 agrupadas sku+cardCode).
- **Query B** (BO + Físico>0 fuera de ingresos_reparto): **14 SKUs**.
- **Query C** (pedidos ex-ASIG 100% BO + app_only, víctimas directas del bug H1): **1 pedido**.

## Total pedidos victima

**1 pedido víctima H1 confirmado**:

| Pedido ID | Cliente | SKU | Qty | Creado | Confirmado por |
|-----------|---------|-----|-----|--------|----------------|
| `tcWxGCE1rdCZz2Iw56Ex` | SNAKE S.R.L. (`C30719034914`) | `ALV6000FA` | 1 | 2026-10-19 19:21 UTC | pablo.gonzalez@shimano.com.ar |

### Snapshot del pedido víctima

```
id: tcWxGCE1rdCZz2Iw56Ex
cliente: SNAKE S.R.L. (C30719034914)
createdAt: 2026-10-19T19:21:06.278Z
source: stock-asignado-batch
transferidoSAP: {
  via: 'app_only',
  reason: 'all_lines_bo',
  docEntry: null,
  docNum: null,
  transferredAt: '2026-10-19T19:21:07.037Z',
  transferredBy: 'auto/confirm-on-save/pablo.gonzalez@shimano.com.ar'
}
closedAt: null
lines:
  sku=ALV6000FA qty=1 qtyOpen=1 state=BO
```

### Pedido A original (ASIG cancelada al confirmar B)

```
id: mSuIidbMd74ziEMIBPUC
lineIndex: 78
state: cancelled
qty: 1
qtyCancelled: 1
asigAt: 2026-10-16T21:47:26.763Z
cancelledAt: 2026-10-19T19:21:07.038Z   ← mismo timestamp que B.transferidoSAP.transferredAt
```

El bloque v1280 (`index.html:34881-34967`) canceló la ASIG inmediatamente después del `pedidos.add(docData)` del pedido B. Ambos timestamps coinciden al milisegundo.

### Verificaciones extra

- **ASIG nuevas del mismo (sku, cliente) posteriores a 2026-10-19 19:21:** 0. El cliente SNAKE S.R.L. **NO recibió** la unidad por otro reparto.
- **Stock físico actual dep 11:** **5u** de ALV6000FA. Hay stock suficiente para restaurar la ASIG.

## Clasificacion recuperables

| ID | Clasificación | Rationale |
|----|---------------|-----------|
| `tcWxGCE1rdCZz2Iw56Ex` | **RECUPERABLE** | ASIG original cancelled apuntando al pedido B + stock físico 5 ≥ qty 1 + no hubo re-reparto posterior |

**Totales:** 1 recuperable, 0 no-recuperable, 0 investigar.

### Script de reparación (Caso A, dry-run only en E4)

Para `tcWxGCE1rdCZz2Iw56Ex`:

1. **En pedido A `mSuIidbMd74ziEMIBPUC` (lineIndex 78):** restaurar línea a ASIG:
   - `state: 'cancelled' → 'ASIG'`
   - `qtyOpen: 0 → 1`
   - `qtyCancelled: 1 → 0`
   - `cancelledAt: delete` (o `null`)
   - `cancelledFrom: delete`
   - `cancelledIntoPedidoId: delete`
   - (preservar `asigAt: '2026-10-16T21:47:26.763Z'` y `asigReserva: true`)

2. **En pedido B `tcWxGCE1rdCZz2Iw56Ex`:** cerrar:
   - `closedAt: now`
   - `closedReason: 'h1_repair_2026-10-20'`
   - `lines[0].state: 'BO' → 'cancelled'`
   - `lines[0].qtyOpen: 1 → 0`
   - `lines[0].qtyCancelled: 0 → 1`

### Resultado post-reparación

- Cliente SNAKE S.R.L. vuelve a tener 1u ALV6000FA en ASIG (como antes del 19/10).
- Pablo puede abrir Stock Asignado → "Crear Pedido Desde Stock Asignado" otra vez.
- Con el fix H1 ya desplegado, el pedido nuevo irá a SAP como confirmed.

## Query A — Reservas vivas con pedido transferidoSAP (contexto)

292 líneas totales. Alta cantidad **no implica bug**: incluye líneas `state='confirmed'` legítimas (SQ enviada, esperando factura SAP) + ASIG dentro del TTL 7d. Para separar fantasmas requiere cross-check SAP Invoice.BaseEntry — fuera del scope de esta tarea.

### Top 20 agrupaciones (sku, cardCode)

```
FXC66MHC2 @ C30719034914: 1 lineas / 60 qty / confirmed / 1 pedidos
EXGC66MBAR @ C23256905159: 2 lineas / 10 qty / ASIG / 2 pedidos
EXGS70MHBAR @ C23256905159: 2 lineas / 10 qty / ASIG / 2 pedidos
EXGS70HB2AR @ C23256905159: 2 lineas / 10 qty / ASIG / 2 pedidos
FXPR410 @ C27224110362: 1 lineas / 10 qty / confirmed / 1 pedidos
LDM64TE2020030G @ C20131936444: 1 lineas / 6 qty / ASIG / 1 pedidos
CLC70MHAAR @ C20131936444: 2 lineas / 6 qty / ASIG / 2 pedidos
LDM54TE5031515H @ C20131936444: 2 lineas / 6 qty / ASIG / 2 pedidos
CLC70MHAAR @ C30716659379: 2 lineas / 6 qty / ASIG / 2 pedidos
EXGC70MHBAR @ C23256905159: 2 lineas / 6 qty / ASIG / 2 pedidos
EXGTVS90M4CH @ C23256905159: 2 lineas / 6 qty / ASIG / 2 pedidos
EXGTVS70MH4AR @ C23256905159: 2 lineas / 6 qty / ASIG / 2 pedidos
FX4000FC @ C27224110362: 1 lineas / 6 qty / confirmed / 1 pedidos
FX4000FCC @ C27224110362: 1 lineas / 6 qty / confirmed / 1 pedidos
FX4000FC @ C20259014868: 1 lineas / 6 qty / confirmed / 1 pedidos
CRZAXFGB2502 @ C30717895521: 1 lineas / 5 qty / ASIG / 1 pedidos
EXGTVS70MH4AR @ C20273631233: 1 lineas / 5 qty / ASIG / 1 pedidos
HL6000FB @ C20259014868: 1 lineas / 5 qty / confirmed / 1 pedidos
FX2000FC @ C20203479752: 1 lineas / 5 qty / ASIG / 1 pedidos
FX2000FC @ C20236640834: 1 lineas / 5 qty / ASIG / 1 pedidos
```

**Nota de interés para D2 (TTL):** varias líneas de C23256905159 y C20131936444 son ASIG multiples del mismo SKU (2 pedidos cada una). Pueden ser legítimos (pedidos repetidos del mismo cliente) o duplicados; cross-check manual recomendado.

## Query B — SKUs con BO + Físico>0 fuera de ingresos_reparto activo

**14 SKUs** con stock físico libre pero BO sin reparto activo. Gap operativo documentado como FINDING-05 en la auditoría.

```
EXGTVS90M4CH: BO=3 / Fisico dep 11=8
ALV6000FA: BO=7 / Fisico dep 11=5             ← incluye el BO del pedido víctima H1
SGS80MH2A: BO=3 / Fisico dep 11=4
CLS70MH2PY: BO=12 / Fisico dep 11=4
21100150150W: BO=1 / Fisico dep 11=4
SUNBASS: BO=22 / Fisico dep 11=3
SHMTECHLGREYXL: BO=4 / Fisico dep 11=2
CLS70XH2CH: BO=18 / Fisico dep 11=2
NEXS70H2SACH: BO=26 / Fisico dep 11=2
EXGC70XHBAR: BO=22 / Fisico dep 11=2
ECLIPSE: BO=34 / Fisico dep 11=2
STS66MH2C: BO=14 / Fisico dep 11=1
CU301HGK: BO=46 / Fisico dep 11=1
FXXTR27XH: BO=4 / Fisico dep 11=1
```

**Acción separada (fuera de esta tarea):** Pablo revisa el modal Reparto / Backorder y asigna manualmente estas unidades. El fix P5 (reportar `status='in_progress'` cuando queda stock sobrante) es la solución estructural.

## Conclusión

- Impacto bug H1 en prod: **1 pedido** (SNAKE S.R.L., 1u ALV6000FA), **recuperable**.
- Scope del script D (E4): 1 pedido víctima + 1 pedido A original → 2 docs a tocar.
- 14 SKUs con gap operativo (FINDING-05) — fuera del scope H1 pero vale avisar a Pablo.
- 292 reservas vivas (Query A) — mayoría probable legítimas; detectar fantasmas excede esta tarea.
