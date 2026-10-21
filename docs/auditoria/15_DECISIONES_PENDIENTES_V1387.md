# 15 — Decisiones pendientes post v1387 (gate humano E5)

**Fecha**: 2026-10-21
**Rama**: `fix-ttl-reservas-y-reparto` (SHA `44edb64`)
**Autor**: loop E0-E4 (Opus 4.7)

Después de v1387 (TTL guard + reparto por reconciliación + UI columna), 3 decisiones quedan abiertas para Mariano. **No implementar sin OK explícito** — cada una tiene riesgo que requiere trade-off humano.

---

## Estado post-deploy v1387

- CF `onDep11IncreaseCreateReparto` ACTIVE 2026-10-21T13:13 UTC con la segunda pasada de reconciliación. Correrá en el próximo write al snapshot (cron cada 30 min).
- `scripts/audit/G_reservas_vencidas.cjs --prod`: `confirmed_sin_fecha=0` global (regla §36 vigente). Guard defensivo liberó 0 unidades (comportamiento esperado).
- `scripts/audit/B_bo_con_fisico_positivo.cjs --prod`: **13 SKUs** con BO+físico sin reparto activo (bajó de 14 pre-fix). El reconcile aún no corrió post-deploy — veremos la baja real en la próxima iteración.
- **Hallazgo lateral E4**: CUDC201HG tiene un `ingresos_reparto` **fantasma `source='migration-v1278'`** con `clientesCount=0` desde 2026-10-14. El reconcile lo ve como "activo" y skipea → no crea reparto nuevo. Esto bloquea 14 clientes esperando. Es un bug independiente del scope E0-E4.

---

## D3 — Doble conteo con SAP (pedidos convertidos de Quotation a Order)

**Síntoma**: cuando SAP convierte una SQ (Quotation) a Order, el stock físico dep 11 se consume de SAP pero la línea app sigue viva con `state='confirmed'`. Mientras `pedido.confirmedAt` esté dentro del TTL 7d, la línea reserva stock app-side **además** de haberse consumido en SAP → doble conteo.

**Pregunta**: ¿cuántos pedidos app tienen `transferidoSAP.docEntry` que ya está en una Order SAP (no SQ)? Si son pocos, hace falta un sync que marque la línea como `invoiced=true` y pare de reservar. Si son muchos, la lógica actual probablemente ya cubre vía otro camino (sync-sap-orders).

**Opciones**:
- A) Dejar como está. TTL 7d + fallback cascade mitigan. Riesgo residual: ventana 0-7d con doble conteo.
- B) Agregar flag `line.consumedBySapOrder=true` cuando se detecte una Order SAP que matchee → `lineReservesStock` devuelve false. Requiere sync nuevo + test.

**Impacto estimado**: necesito el conteo para dimensionar. Pedir a Mariano correr query:
```sql
SELECT COUNT(*) FROM pedidos
WHERE transferidoSAP.docEntry IS NOT NULL
  AND transferidoSAP.docType = 'Order'  -- o similar
  AND stage = 'confirmed'
  AND lines[i].qtyOpen > 0
```

---

## D4 — TTL duro 60d confirmed como red de seguridad

**Síntoma**: una línea confirmed con `confirmedAt` muy viejo (ej. 90d, 180d) sigue reservando porque pasó el TTL de 7d → ya no reserva. Pero si el valor es `null`/falsy, el guard §36 corta.

**Pregunta**: ¿agregar un TTL hard de 60d sobre `confirmedAt` o `createdAt` como fallback adicional? Es decir, si `confirmedAt > 60d`, aunque el flag `asigReserva` esté true, **igual** no reserva.

**Opciones**:
- A) No. TTL 7d ya corta todo lo que importa. 60d es sobre-ingeniería.
- B) Sí, con el valor exacto a definir (60d, 90d, 180d).

**Riesgo B**: si hay SQ legítima que SAP tarda >60d en facturar (raro pero posible), se libera incorrectamente.

**Datos para decidir**: cuántos pedidos confirmed tienen `confirmedAt` en el rango (7d, 60d), (60d, 180d), (>180d).

---

## D5 — Pedidos con `orderNumber` undefined

**Síntoma**: algunos pedidos legacy tienen `orderNumber === undefined`. Afecta queries de `v_pedidos` + filtros admin. v913 implementó `counters/orderNumber` atómico pero los pedidos pre-v913 quedaron.

**Opciones**:
- A) Backfill con `createdAt` como pseudo-número. Script read-write prod (gate humano).
- B) Marcar legacy en UI con "(sin número)" y seguir. No backfill.
- C) Investigar primero cuántos son — si son <50, backfill fácil; si son >5000, dejar como legacy.

**Pedir a Mariano**: correr `node scripts/audit/_count_pedidos_sin_order_number.cjs --prod` (crear si no existe) para dimensionar.

---

## Backlog adicional surgido en E4

### B1 — `ingresos_reparto` fantasma de migración v1278

**Síntoma**: 14 SKUs (al menos CUDC201HG) tienen un `ingresos_reparto` con `source='migration-v1278'` + `clientesCount=0` desde 2026-10-14. El reconcile los ve como "activos" y skipea → no crea reparto nuevo. Esos clientes BO están atascados sin reparto operable.

**Pregunta**: ¿cerrar esos docs fantasma (status='done' o 'expired') para que reconcile pueda crear reparto nuevo?

**Opciones**:
- A) Script `_close_fantasma_migration_v1278.cjs` que marca `status='expired'` + `expiredReason='clientesCount=0'` para esos docs. Gate humano con `--dry-run` primero.
- B) Extender `reconcileRepartosFaltantes` para ignorar `ingresos_reparto` con `clientesCount=0` como "no reparto activo real". Más defensivo.
- C) Investigar qué pasó con migración v1278 — si los `clientesCount=0` son todos legítimos (todos los clientes BO cancelaron) vs bug.

Recomiendo B o C antes de A. A es destructivo (afecta UI del modal Reparto).

### B2 — Verificar que la próxima corrida del CF genera repartos

**Siguiente paso automatizado**: en 30 min el GHA de sync escribe stock_snapshot → CF corre → `reconcileRepartosFaltantes` crea `ingresos_reparto` con `source='reconciliation'` para los 13 SKUs atascados (minus los que tengan fantasma migration-v1278). Verificar con `scripts/audit/_check_reconcile_cudc201hg.cjs` después.

**Gate**: `Total source=reconciliation activos > 0` en 60 min post-deploy.
