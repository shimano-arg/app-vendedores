# 22 — Ventana ingreso → reparto (v1392)

**Fecha**: 2026-10-21

## Qué se mide

El tiempo entre que un `ingresos_reparto` es creado (`detectedAt`) y que Pablo o la reconciliación lo aplican (`appliedAt` en `applyRepartoManualCore`).

## Pipeline actual

1. **Snapshot stock dep 11** (`stock_snapshot`) se refresca cada **30 min** via cron GHA `sync-sap-catalog-stock.yml`.
2. **CF `onDep11IncreaseCreateReparto`** se dispara **en cada write** al snapshot (listener onWrite). Dos pasadas:
   - `createIngresosRepartoFromDelta`: delta positivo → crea reparto nuevo.
   - `reconcileRepartosFaltantes`: catch-up para SKUs con físico + BO vigente sin reparto activo.
3. **Modal Reparto** (listener live `_repartoSubscribe`) muestra los ingresos pending/in_progress a Pablo.
4. **Pablo aplica** → `applyRepartoManualCF` → `applyRepartoManualCore` escribe `appliedAt`.

## Ventana real medida (empírica, 2026-10-21)

De los logs `gcloud logging read` del CF `applyrepartomanualcf`:

- v1384 inicial: deploy 13:13 UTC → reconcile creó 13 ingresos a 13:23 UTC → Pablo aplicó a 13:42 UTC. Ventana aplicación = 19 min.
- v1390 (post reinit): snapshot update 13:50 UTC → reconcile 13:50:34 UTC → ventana reconcile = **seconds** (listener onWrite inmediato).

**Conclusión**: la ventana real entre snapshot write y reparto creado es **de segundos** (CF trigger instantáneo). El retardo humano (Pablo aplica cuando puede) es el único componente lento.

Si el snapshot cron no corre por 30 min, el reparto queda sin crearse (pero si hay delta en algún otro field del snapshot, igual se dispara). Caso borde: SKU con físico estable + BO llegando después del último snapshot → reconcile capta en el próximo cron (hasta 30 min).

## Métrica loggeada por `applyRepartoManualCore` v1392 §40

```js
log('reparto_ventana', {
  ingresoId,
  detectedAt,
  appliedAt,
  ventanaMinutos,
});
```

El doc `ingresos_reparto` guarda `ventanaIngresoARepartoMs` + `appliedAt`. Para medir empíricamente la ventana en producción:

```bash
# gcloud logging query
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=applyrepartomanualcf AND textPayload=~\"reparto_ventana\"" \
  --project=app-vendedores-shimano \
  --format="value(textPayload)" --limit=100
```

Luego parsear `ventanaMinutos` y calcular P50/P95/max.

## Decisión §40

La ventana entre que entra stock y que la CF crea el reparto es **de segundos** (CF corre con cada write). No hace falta cambios adicionales al trigger.

La ventana entre que el reparto se crea y Pablo aplica depende de Pablo. Mientras tanto, con §40 nuevo:
- El stock físico está **libre** para la venta (BO no reserva + reparto abierto no reserva).
- Si alguien vende, el stock se reduce y la próxima corrida reconcile ajusta `qtyIngresada` del reparto activo via `reparto_ajustado` log.
- Pablo puede cerrar con sobrante (`allowSobrante=true`) si el stock se agotó entre medio.

## GATE_E2_OK

```
tests pasan ✓
  - reparto-ajuste (parte de reparto-reconciliation): 6 PASS
  - reparto-cerrar-sobrante: 5 PASS
  - reconcile-breakdown-sync: 4 PASS (fórmula §40 verificada)
docs/auditoria/22_VENTANA_INGRESO_REPARTO.md ✓ (este)
```

**GATE_E2_OK**
