# 26 — Doble conteo waitlistCpst: BENGOCHEA 597151 (fix v1393)

**Fecha**: 2026-10-21T15:53 UTC
**SKU**: 597151
**Cliente**: JUAN MIGUEL BENGOCHEA (C20293164852)
**Reporte Mariano**: Físico 2, Stock Asignado 2u Bengochea, Lista de espera dice reservadas 6.

---

## 1. Dump prod

**Físico snapshot** (updatedAt 15:22 UTC):
- `whs[597151] = {"11": 2, "12": 10}` → físico dep 11 = 2.

**Pedidos abiertos con 597151** (4 líneas):

| pedidoId | ORDEN | cliente | state | qty | qtyOpen | source | asigAt |
|---|---|---|---|---|---|---|---|
| 3JqlsAin...I | 166 | Folca | BO | 1 | 1 | — | — |
| DzCnw4uA...c | 203 | NOUGUEZ | BO | 3 | 3 | — | — |
| **EFw2AM0lhfp8VRB52KmG** | **467** | **BENGOCHEA** | **ASIG** | **6** | **6** | manual-backorder | 2026-10-20 17:37 UTC |
| K88WVskz...X | 219 | RODRIGUEZ | BO | 1 | 2 | — | asigReserva=false |

**Nota**: Mariano reportó "ORDEN 472" pero en prod es **ORDEN 467** (`EFw2AM0lhfp8VRB52KmG`). Confusión mínima; el patrón es claro.

**revision_waitlist con items 597151** (3 docs):

| waitlistId | cliente | qty | source |
|---|---|---|---|
| **GYQRCgyXyOJttrQyNsru** | **BENGOCHEA (C20293164852)** | **6** | stock-asignado-batch |
| i5rOIL0aFnSh5HdFzdkD | PONTORIERO | 2 | stock-asignado-batch |
| tTEVhx7RvBXthQdeY8r2 | RODRIGUEZ | 2 | stock-asignado-batch |

**TOTAL waitlistCpst para 597151 = 10 u**.

**ingresos_reparto activos**: `I0XyJ6cGSSFLNlrJplkT` status=in_progress qtyIng=6 assignments=2 (ya aplicadas).

---

## 2. Doble conteo confirmado

Para **BENGOCHEA**, el breakdown v2 cuenta:
- `asignadas.total += 6` (del pedido ORDEN 467, state=ASIG qtyOpen=6).
- `waitlistCpst.total += 6` (del waitlist `GYQRCgyXyOJttrQyNsru` con items[0].qty=6).

**Mismo cliente, mismo SKU, suman 12 u** cuando el físico son solo 2 u. Breakdown total:
- `reservadasTotal = 6 (asig) + 10 (waitlist) + 0 (conf) = 16`.
- `libre = max(0, 2 - 16) = 0`.

El VDE que carga ORDEN 467 ve "reservadas 6" en Lista de Espera (porque la fila es por SKU) y confunde con un cap propio.

---

## 3. Causa raíz: waitlist CPST no es una reserva real

Un `revision_waitlist` con `source='stock-asignado-batch'` es:
- Un **draft** del VDE preparando un pedido desde Stock Asignado.
- La ASIG original (pedido padre) ya reserva su stock.
- Hasta que el VDE apreta "Confirmar", el waitlist no genera un pedido real.

**Regla §40.1 (nueva)**: `waitlistCpst` NO reserva stock. Solo la ASIG de origen reserva, por la cantidad asignada. Si el VDE sube la cantidad por encima de la ASIG, el excedente va a BO al confirmar — nunca reserva mientras está en draft.

### Antes del fix (breakdown v2 §40):
```
reservadasTotal = asignadas + confirmed + waitlistCpst   // ← bug: waitlist cuenta
```

### Después del fix (breakdown v3 §40.1):
```
reservadasTotal = asignadas + confirmed                   // ← waitlist NO cuenta
```

El bucket `waitlistCpst` sigue existiendo en el shape (informativo, para debug/tooltip), pero no suma.

---

## 4. Test del caso

Fixture: BENGOCHEA 597151 — físico 2, ASIG 6, waitlistCpst 6.

| Métrica | Pre-fix | Post-fix |
|---|---|---|
| asignadas.total | 6 | 6 |
| waitlistCpst.total | 6 (informativo) | 6 (informativo) |
| reservadasTotal | 12 | 6 |
| libre | 0 | 0 (fisico 2 - asig 6 = clamp 0) |
| utilizablePara(C20293164852) | min(2, 0+12)=2 (por casualidad) | min(2, 0+6)=2 ✓ |

Al confirmar la ORDEN 467 (si se queda state=ASIG qty=6 y qty manda = 6): confirmed=0 (no se envió a SAP todavía), ASIG=6, waitlistCpst=0 (porque el pedido ya es ASIG real) → split al confirmar: 2 a SAP (confirmed), 4 a BO.

El fix mantiene la invariante: el excedente va a BO al confirmar, nunca reserva mientras tanto.

---

## 5. GATE E0 — Dump completo

```
test -f docs/auditoria/26_WAITLIST_CPST_DOBLE_CONTEO.md ✓
dump explica el 6 (asig=6 + waitlistCpst=6 doble conteo) ✓
pedidoId=EFw2AM0lhfp8VRB52KmG + waitlistId=GYQRCgyXyOJttrQyNsru identificados ✓
```

**GATE_E0_OK**
