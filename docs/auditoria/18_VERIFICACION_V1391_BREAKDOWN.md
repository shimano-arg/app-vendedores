# 18 — Verificación en prod v1391 — getStockBreakdown

**Fecha**: 2026-10-21T14:28:23 UTC
**Snapshot**: `stock_snapshot.updatedAt` del momento.
**Script**: `scripts/audit/I_breakdown_prod_check.cjs`

---

## Tabla getStockBreakdown en prod (4 SKUs)

Elección: CUDC201HG (caso emblemático reporte Mariano) + 3 SKUs con mayor BO vigente (determinístico, top-3 ordenado por BO total).

| SKU | fisico (dep11) | transito (dep12) | BO (app) | confirmed | asignadas | wlCpst | reservadas | libre | pendReparto | repartoId |
|---|---|---|---|---|---|---|---|---|---|---|
| CUDC201HG | 7 | 24 | 2 | 0 | 1 | 0 | 3 | 4 | 6 | wXqG9ZezQpJYJRA8yF44 |
| CLC66H2PY | 9 | 0 | 169 | 2 | 0 | 0 | 171 | 0 | 7 | YlQVZ9YR8MpYUgy9POKx |
| CLC66MH2PY | 7 | 0 | 116 | 2 | 0 | 0 | 118 | 0 | 5 | aKGy48sv7147jzai0eYD |
| CLC70H2PY | 9 | 0 | 109 | 2 | 0 | 0 | 111 | 0 | 7 | hITGvXIaq9yDqnnL5AtI |

---

## Invariantes verificados ✓

Para cada SKU:
- `reservadasTotal == backorderApp + confirmed + asignadas + waitlistCpst` ✓
- `libre == max(0, fisicoDep11 - reservadasTotal)` ✓
- `pendienteReparto.qty == max(0, fisicoDep11 - asignadas - confirmed) si BO > 0, else 0` ✓
- `pendienteReparto.repartoId` apunta al `ingresos_reparto` activo correspondiente (si existe) ✓

**Resultado: TODOS OK ✓**

---

## Interpretación por SKU

### CUDC201HG
- Físico 7, BO vigente 2u ANDRILI, ASIG 1u GRAUBERGER, confirmed 0 (todas >7d TTL expiradas).
- Libre 4u disponible.
- `pendienteReparto.qty = 6` → reparto `wXqG9ZezQpJYJRA8yF44` (reconciliation creado 13:50 UTC) cubre todo lo libre menos el ASIG propio.

### CLC66H2PY (top BO vigente)
- Físico 9, BO vigente 169u, confirmed vigente 2u, ASIG 0.
- Sobre-reservado: 171 vs 9 físico → libre 0.
- `pendienteReparto.qty = 7` (= 9 - 2 confirmed - 0 asig) → reparto activo `YlQVZ9...`.

### CLC66MH2PY
- Físico 7, BO 116, confirmed 2, ASIG 0 → libre 0.
- `pendienteReparto.qty = 5` → reparto `aKGy48...`.

### CLC70H2PY
- Físico 9, BO 109, confirmed 2, ASIG 0 → libre 0.
- `pendienteReparto.qty = 7` → reparto `hITGvX...`.

---

## Nota sobre consistencia con las pantallas

Esta verificación corre `getStockBreakdown` desde Node (fn pura, mismo input que el bundle del browser). Los invariantes **matemáticos** son determinísticos: dado el mismo snapshot + lista de pedidos, el browser debe mostrar los mismos números.

Validación cruzada con pantallas post-deploy requiere:
1. Hard-reload del browser (invalidar SW cache).
2. Verificar APP_VERSION en header = v1391 (o superior).
3. Abrir cada pantalla para CUDC201HG y confirmar los valores de la tabla.

Esto se hará como smoke manual Mariano post-deploy (E4).

---

## GATE_E3_OK

```
test -f docs/auditoria/18_VERIFICACION_V1391_BREAKDOWN.md ✓
grep 'CUDC201HG' ✓
4 SKUs × 11 columnas = 44 celdas de datos ≥ 20 ✓
0 celdas con el símbolo divergente ✓
```

**GATE_E3_OK**
