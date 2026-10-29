# 45 — Asignaciones huérfanas (2026-10-29)

Disparador: CPST de REBORN SRL (`C30710852762`, VDE Gonzalo De La Rosa), 23 productos / 50 u, 29/10 09:08, rechazado por el pre-flight:

```
CLC66H2PY (pedido 8lGQkjUJfZwqsfnNw4iw): linea con qtyOpen=0, state=ASIG
CLC66H2PY: faltaron 2u para cubrir qtyAjustada
```

## Estado de la evidencia

- **Verificado en código**: los dos mecanismos de abajo.
- **NO verificado contra datos de prod**: la sesión que escribió esto no tenía credenciales de Firestore. Los números del listado salen de correr el script (sección "Cómo correrlo").

## Causa (código)

1. **Productor de la ASIG zombie** — `functions/core/reparto-core.js:revertSobreAsignadas` (§40.11). Para una ASIG con `qtyEntregable=0` hace `qty=0; qtyOpen=min(prev,0)=0` y deja `state='ASIG'`, apendeando una BO con la cantidad. La línea queda "ASIG sin unidades". El breakdown la ignora (`qtyOpen<=0`), pero cualquier flujo que busque la línea por producto la puede agarrar.
2. **Por qué bloquea el CPST** — `index.html:_cpstBuildCache` no guardaba `lineIndex` en las entries y `_cpstConfirmar` re-buscaba con `findIndex(code+state==='ASIG')`: primera ASIG del producto = la zombie → error + `break` → "faltaron 2u", aunque la ASIG viva con 2u esté más abajo en el mismo pedido.
3. **Encaje con lo de ayer (hipótesis, a confirmar con el dump)**: las 93 asignaciones por Excel sobre repartos con `clientesBO` viejo permiten sobre-asignar (cap removido en v1338). En el tick siguiente `revertSobreAsignadas` recorta por FIFO: las ASIG que quedan con entregable 0 se vuelven zombies en su mismo índice. Un `clientesBO` viejo que todavía apunta a ese índice rebota en `applyRepartoManualCore` con "linea con qtyOpen=0" (el chequeo de `qtyOpen` corre antes que el de `state`) — consistente con los 21 rechazos de las 15:50.
4. **Riesgo adicional**: `revertSobreAsignadas` hace read-modify-write del array `lines` **fuera de transacción** a partir de una lectura de todos los pedidos abiertos. Si un `applyRepartoManualCF` escribe en el medio, el update de reconcile pisa esa asignación (queda en `ingresos_reparto.assignments` pero no en el pedido). El script lo detecta como tipo R.
5. **Popup TRX301B (7 u sin explicar)**: sin datos no está confirmado. Candidatos que el script mide: (R) asignación registrada sin línea; (S) `stock_snapshot/{SKU}.asignadas.byClient` se escribe con `set(..., {merge:true})`, así que un cliente que deja de tener ASIG **no se borra** del mapa y conserva su cantidad vieja.

## Cómo correrlo (read-only)

```bash
node scripts/audit/AS_asig_huerfanas.cjs --pedido=8lGQkjUJfZwqsfnNw4iw
node scripts/audit/AS_asig_huerfanas.cjs --sku=TRX301B
node scripts/audit/AS_asig_huerfanas.cjs
```

La última corrida imprime las tablas Z/W/R/S por cliente y producto, el total de unidades fantasma y el plan de limpieza dry-run.

## Plan de limpieza (dry-run; `--apply` solo con OK de Mariano)

| Tipo | Acción automática | Criterio |
|---|---|---|
| Z zombie, sin facturado | `cerrar_zombie`: `state='cancelled'`, `closedReason='asig_huerfana_limpieza'` | no mueve stock (qtyOpen ya es 0) |
| Z con `qtyInvoiced>0` | manual | revisar contra SAP |
| W ref a línea muerta, hay otra ASIG viva del producto que cubre | `corregir_ref`: re-apunta `lineIndex` | la reserva existe, solo estaba mal referenciada |
| W sin ASIG viva | `liberar_ref`: saca el `asigRef` del ítem | la reserva no existe; el ítem queda sin reserva |
| R asignación sin línea | manual | re-asignar desde Reparto si corresponde |
| S clave vieja en snapshot por producto | manual / fix de código | no afecta el popup del Master (lee pedidos) |

Cada write guarda `_backfill.AS_asig_huerfanas_2026-10-29_v1520` (§55) y re-verifica dentro de una transacción.

## Listado (pendiente de correr)

_Completar con la salida de `node scripts/audit/AS_asig_huerfanas.cjs`._
