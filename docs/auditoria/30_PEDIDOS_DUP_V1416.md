# Pedidos post-v1416 con líneas o qty duplicadas (bug §42.2 self-unify)

**Generado**: 2026-10-22T18:03:26.793Z
**Ventana de bug**: 2026-10-22T17:30:00.000Z → 2026-10-22T22:00:00.000Z
**Deploy v1416** (bug introducido): 2026-10-22 ~17:35 UTC (PR #1152 commit ee08ba0).
**Deploy v1418** (hotfix): 2026-10-22 (PR #1154 commit 7ba3208).

**Pedidos confirmados en ventana**: 1
**Con duplicación detectada**: 1

---

## Pedidos con DUPLICACIÓN

| Cliente | ORDEN | SAP DocNum | Confirmed | Owner | WL items | Ped lines | Factor max | SKUs duplicados |
|---|---|---|---|---|---|---|---|---|
| ALBERTO PONTORIERO | 524 | 2000425 | 2026-10-22T17:47:35 | pablo.gonzalez@shimano.com.ar | 0 | 70 | 0.00x |  |

---

## Tabla completa (todos los pedidos de la ventana)

| Dup | Cliente | ORDEN | SAP DocNum | WL items | Ped lines | Diff |
|---|---|---|---|---|---|---|
| 🔴 SÍ | ALBERTO PONTORIERO | 524 | 2000425 | 0 | 70 | 70 |

---

## Detalle por pedido con duplicación

### ALBERTO PONTORIERO — ORDEN 524

- **PedidoId**: `A7Ee40f1RAnLP5b9o2da`
- **CardCode**: `C20175569635`
- **Owner**: pablo.gonzalez@shimano.com.ar
- **ConfirmedAt**: 2026-10-22T17:47:35.114Z
- **SAP DocNum**: 2000425
- **SAP DocEntry**: 53226
- **SAP TransferredAt**: 2026-10-22T17:50:05.984Z
- **Source**: stock-asignado-batch
- **Waitlist origen**: `KvE9Dol8pGTWXIMJzUGi` (NO encontrada en Firestore)
- **Waitlist items / Pedido lines**: 0 / 70 (diff 70)

**SKUs en pedido NO presentes en waitlist**: SUC60MH2APY, FXS66MHC2, FXS70MHC2, FXS80MHC2, FXS90MHC2, CRZSOL165UY, STS60M2C, STS66M2C, STS70M2C, FXXT21MH ...

**SKUs con 2+ líneas en el mismo pedido** (sugerente de self-unify §42.2):

| SKU | Ocurrencias | Qty total |
|---|---|---|
| STS66M2C | 4 | 20 |
| STS70M2C | 4 | 20 |
| ALV10000FA | 4 | 60 |
| EXGTVS90M4CH | 4 | 4 |
| SUC60MH2APY | 2 | 10 |
| FXS66MHC2 | 2 | 20 |
| FXS70MHC2 | 2 | 20 |
| FXS80MHC2 | 2 | 20 |
| FXS90MHC2 | 2 | 20 |
| CRZSOL165UY | 2 | 40 |
| STS60M2C | 2 | 20 |
| FXXT21MH | 2 | 20 |
| TRX400B | 2 | 4 |
| TRX401B | 2 | 2 |
| CUDC201XG | 2 | 6 |
| CU300K | 2 | 6 |
| CU301K | 2 | 6 |
| CU301HGK | 2 | 6 |
| ULT14000XSE | 2 | 6 |
| ULT5500XTD | 2 | 6 |
| ... | ... | ... |
