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

Cada write guarda `_backfill.AS_asig_huerfanas_2026-10-29_v1521` (§55) y re-verifica dentro de una transacción.

## Listado (corrido por Mariano 2026-10-29, prod, read-only)

**Caso REBORN confirmado** (`8lGQkjUJfZwqsfnNw4iw`, CLC66H2PY):
- 21/10 20:38 Pablo asigna 2u (ingreso `YlQVZ9YR8MpYUgy9POKx`) → línea 162 ASIG split de la 77.
- 27/10 17:21 `revertSobreAsignadas` con entregable 0 → línea 162 queda `ASIG qty=0 qtyOpen=0` (zombie) y apendea línea 163 BO 2u.
- 28/10 18:49 reparto `IJP5yi0gAayLkCeNrwi5` (lote de ayer) convierte la 163 entera en ASIG 2u.
- 29/10 09:08 CPST: `findIndex` cae en la 162 → bloqueo. Las 2u existían en la 163.

| Tipo | Filas | Unidades fantasma | Lectura |
|---|---:|---:|---|
| Z zombies | 53 | 0 propias | Todas `qty=0`, `revertida=true`. No restan stock; son trampas para quien busque por producto. |
| W refs sin respaldo | 4 | **7** | Todas en la ORDEN 504 (FERNANDO LUIS HORACIO DEL INTENTO): 597144 2u, LDM54TE3023015S 3u, LDM54TE4028015S 1u, PLM58RE0200150S 1u. |
| R | 42 | 0 | Todas `doble_aplicacion` = cliente re-asignado después de un revert (patrón REBORN). No hay asignaciones perdidas. |
| S snapshot por producto | 37 | 62 | Claves viejas en `stock_snapshot/{SKU}.asignadas.byClient`. Sin efecto: `commitPedidoCF` lee ese doc pero no usa el campo, y el popup lee pedidos. |

**Unidades fantasma reales hoy: 7** (ORDEN 504). Las 62 de S son contables, no operativas.

**TRX301B**: 3 zombies (ACOSTA, DINKELDEIN, SFRAMELI) + 3 claves viejas en S; ninguna resta del popup. Las 7u "sin explicar" de las 09:04 eran confirmadas sin facturar (IUALE 1 + PESCAR.INFO 6), resuelto en v1520 §103 (PR #1285).

**Plan**: 53 `cerrar_zombie` + ORDEN 504: 2 `liberar_ref` (597144, LDM54TE3023015S) + 2 `ajustar_ref` 3→2 (LDM54TE4028015S, PLM58RE0200150S).
