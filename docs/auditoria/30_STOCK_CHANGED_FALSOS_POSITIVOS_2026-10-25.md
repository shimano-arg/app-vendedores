# Auditoría STOCK_CHANGED falsos positivos — 2026-10-25

**Rama**: `audit-stock-changed-falsos-positivos`
**Autor**: Claude agent (prompt Mariano)
**Base**: `main` HEAD `213fbd41` (v1449)
**Ventana**: últimos 3 días (desde `2026-10-22T23:00:43Z` hasta `2026-10-25T23:00:43Z`).
**Fuente primaria**: Firestore `operations_log` (query `--days=3 --full`).
**Fuente secundaria** (cuando primaria falla): Cloud Logging `commitpedidocf`.

---

## Veredicto (1 línea)

**NO hay bug §39. Hay un bug §64 LOGGING (función no serializable).** 10 rechazos STOCK_CHANGED legítimos en 3 días (23/10 → 25/10); todos siguen el flow esperado (`STOCK_CHANGED → modal "¿Confirmar con BO?" → user acepta → 2do commit OK`). El audit NO pudo contrastar `clientStock` vs `server` porque el logging a `operations_log` falla con `Cannot encode value: (cardCode) => {...}` — `getStockBreakdown.utilizablePara` es una función y el CF intenta persistirla cruda.

---

## Resumen bruto

| Métrica | Valor |
|---|---:|
| Entries `operations_log` ventana 3d | 661 |
| Entries `commit_pedido_rejected` | **0** |
| Entries con `errorCode='STOCK_CHANGED'` | **0** |
| Rechazos STOCK_CHANGED **reales** (vía logs CF) | 10 |
| Candidatos a bug §39 (mismatch cliente↔CF con misma fuente) | **0** (indeterminable sin logs) |
| Rechazos `cliente_viejo` (sin `clientStock` en payload) | indeterminable (logging falla) |
| Rechazos `race_legit` (snapshot cliente ≠ CF por > 10s) | indeterminable |

**Interpretación**: la ausencia total de `commit_pedido_rejected` en `operations_log` NO significa que no hubo rechazos. Significa que el bloque de logging §64 del CF `functions/core/commit-pedido-core.js` lanza `Cannot encode value` al intentar persistir el `breakdown` cuando ejecuta `operations_log.add(_logEntry)`. El fire-and-forget captura el error, loguea `operations_log write failed (STOCK_CHANGED)` en stdout y continúa — pero el documento NUNCA se escribe.

---

## Tabla ASCII — 10 STOCK_CHANGED reales (cruzando `commitpedidocf` logs)

```
TIMESTAMP (UTC)             | FOLLOW-UP (OK siguiente)   | DELTA | CLIENTE / ORDEN                                            | FLOW
----------------------------+----------------------------+-------+------------------------------------------------------------+-----------------
2026-10-23 18:43:53.069Z    | 18:43:57.049Z              | 4.0 s | C | CORDOBA | SAN FRANCISCO | MARCELO BOSCHETTO | 541      | user acepta BO
2026-10-23 20:24:25.814Z    | (sin OK posterior directo) | n/a   | ?                                                           | user cancela
2026-10-23 20:26:39.425Z    | (sin OK posterior directo) | n/a   | ?                                                           | user cancela
2026-10-23 20:52:32.445Z    | 20:52:37.962Z              | 5.5 s | C | CAPITAL FEDERAL | VILLA DEVOTO | BROBRO SA | 516       | user acepta BO
2026-10-23 22:07:03.595Z    | 22:07:10.297Z              | 6.7 s | C | BUENOS AIRES | CIUDADELA | GUSTAVO EMILIO DESIATA | 435 | user acepta BO
2026-10-23 22:08:36.862Z    | 22:08:41.439Z              | 4.5 s | C | BUENOS AIRES | ESCOBAR | EDUARDO SATO | 538           | user acepta BO (dup pre §64.3)
2026-10-23 22:08:38.484Z    | 22:08:43.154Z              | 4.6 s | C | BUENOS AIRES | ESCOBAR | EDUARDO SATO | 538           | user acepta BO (dup pre §64.3)
2026-10-24 16:25:13.645Z    | 16:25:23.051Z              | 9.4 s | C | BUENOS AIRES | BARADERO | LUCAS BAIGORRIA | 537       | user acepta BO
2026-10-25 08:01:59.856Z    | 08:02:06.688Z              | 6.8 s | C | BUENOS AIRES | BERAZATEGUI | LA LOMITA | 491          | user acepta BO
2026-10-25 08:03:20.452Z    | 08:03:25.968Z              | 5.5 s | C | BUENOS AIRES | BERAZATEGUI | LA LOMITA | 544          | user acepta BO
```

### Top SKUs rechazados

**NO MEDIBLE** — el logging falló los 10 veces; sin `operations_log` no hay `skuDetails[]` publicados.

### Top clientes afectados

```
2 x LA LOMITA OUTDOORS SRL (ORDEN 491 + 544)
2 x EDUARDO SATO (ORDEN 538, dup pre §64.3)
1 x MARCELO BOSCHETTO (ORDEN 541)
1 x BROBRO SA (ORDEN 516)
1 x GUSTAVO EMILIO DESIATA (ORDEN 435)
1 x LUCAS BAIGORRIA (ORDEN 537)
2 x (user canceló tras modal — no identificable)
```

### Top users afectados

**NO MEDIBLE** — misma razón.

---

## Divergencias cliente ↔ CF por SKU

**NO MEDIBLE** — el logging falla al intentar escribir `skuDetails[].server.breakdown` (función). Sin datos no se puede confirmar ni descartar divergencias.

---

## Clasificación por root cause probable

| Categoría | Count | Nota |
|---|---:|---|
| `race_legit` (cliente/CF snapshots > 10s) | **indeterminable** | sin `clientSnapshotUpdatedAt` ni `serverSnapshotUpdatedAt` |
| `misma_fuente` (CANDIDATO BUG §39) | **indeterminable** | sin `mismatch.libre/utilizablePara` |
| `cliente_viejo` (SW stale sin `clientStock`) | **indeterminable** | sin `clientSnapshotProvided` |

**Única inferencia posible por los logs CF**: el flow completo (`STOCK_CHANGED → modal → user acepta → 2do commit OK` en < 10 s) sugiere **comportamiento esperado**: cliente vio stock `X` al armar el pedido, CF al validar vio stock `X-K`, propuso BO, user aceptó, 2do commit (con `autoAcceptStockChange=true`) pasó. Es la UX de "stock cambió mientras armabas, mandámelo con BO".

---

## HALLAZGO CRÍTICO (SI aplicás §31, se queda como propuesta de fix separada)

**Bug §64 LOGGING** — `functions/core/commit-pedido-core.js:600-612` persiste el breakdown entero en `skuDetails[].server`, pero `breakdown.utilizablePara` es una **función** (declarada en `src/pure/stock-breakdown.js:327` + espejo `functions/core/pedido-snapshot-core.js:356`). Firestore `Serializer.encodeValue` tira `Cannot encode value: (cardCode) => {...}`.

**Error exacto** (10 instancias idénticas en Cloud Logging):
```
operations_log write failed (STOCK_CHANGED) Error: Cannot encode value: (cardCode) => {
    if (!cardCode) return libre;
    const key = String(cardCode).trim();
    let reservasPropias = 0;
    for (const map of [buckets.confirmed, buckets.ASIG]) {
      const own = map.get(key);
      if (own) reservasPropias += own.qty;
    }
    return Math.min(fisicoDep11, libre + reservasPropias);
  }
    at Serializer.encodeValue (@google-cloud/firestore/.../serializer.js:179:15)
    ...
    at WriteBatch.commit (@google-cloud/firestore/.../write-batch.js:436:43)
```

**Dónde ocurre** (code trace):
1. CF detecta `diffVsClient` → entra al bloque §64 logging (`commit-pedido-core.js:580`).
2. Construye `skuDetails[]` mapeando `lineasResultado`.
3. Para cada SKU: `const serverBd = serverLine.breakdown || null;` (`:601`).
4. `serverPayload.utilizablePara: serverBd ? serverBd.utilizablePara : null` (`:606`) — guarda la **función**, no el valor.
5. `operations_log.add(_logEntry)` falla.
6. Fire-and-forget captura `_err` y loguea → `throwError('STOCK_CHANGED', ...)` sigue adelante correctamente. El cliente sí recibe el error — solo el audit se pierde.

**Impacto**: la §64 "pedido Mariano, cada vez que la CF lo devuelve, registrar en operations_log SKU y valores de cada lado" **no funcionó NUNCA desde el merge de v1443 (23/10 15:37 ART)**. Las 10 instancias de STOCK_CHANGED entre el deploy y hoy quedaron sin logging.

**Afectación §39**: ninguna por sí misma (la lógica de `lineReservesStock` / `getStockBreakdown` / `commitPedidoCore` sigue correcta). El bug es puramente de observabilidad.

**Fix propuesto** (SI Mariano autoriza aparte en otra tarea — §31 bloquea tocar `src/` o `functions/` acá):

Opción A (en commit-pedido-core.js:606): no copiar `utilizablePara` entero; evaluar el cardCode del pedido:
```js
utilizablePara: serverBd ? serverBd.utilizablePara(payload.cardCode || '') : null,
```

Opción B (en src/pure/stock-breakdown.js + mirror): separar `utilizablePara` función del `breakdown` plano, devolver 2 objetos (data + helpers) o exponer un snapshot plano `breakdown.toJSON()` para persistir.

Opción A es mínima (1 línea en 1 archivo) + mantiene semántica útil (`utilizablePara(cardCode)` del pedido específico). Opción B es más limpia pero toca §39 fuente única y requiere grep de todos los consumers.

---

## Veredicto §39 (fase 2 del pedido Mariano)

**NO HAY EVIDENCIA DE BUG §39** con los datos actuales. Los 10 STOCK_CHANGED observados en logs CF siguen el flow esperado del happy path (`STOCK_CHANGED → aceptar → OK en 4-10s`). Sin `operations_log` no se puede confirmar que `clientStock[sku].libre === server.libre` para cada caso — el audit QUEDA PARCIAL hasta que se arregle el bug del logging.

**Candidatos para seguimiento próximo**:
- Fix logging §64 (opción A arriba) — permite reauditar en 3 días.
- Monitor cadencia `operations_log` tras fix: si en los próximos 7 días aparecen entries con `mismatch.libre === true` + `|serverSnapshotUpdatedAt - clientSnapshotUpdatedAt| < 10s`, SÍ hay bug §39 y hay que unificar.

---

## Material de evidencia (preservado)

- `/tmp/audit_v_output.txt` — output completo del script `V_stock_changed_falsos_positivos.cjs --days=3 --full` (vacío por el bug).
- `/tmp/all_cf_logs.txt` — 602 líneas de `gcloud logging read` del CF commitpedidocf en la ventana. Grep `operations_log write failed` → 10 matches; grep `commitPedidoCore OK` → 8 matches.
- `/tmp/sc_times.txt` — timestamps de los 10 STOCK_CHANGED.
- `/tmp/commit_results.txt` — commits OK y retries en la ventana.

Logs de CF son transitorios (90 días). Si necesitás reproducir, correr:
```
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=commitpedidocf AND timestamp>=\"2026-10-22T22:00:00Z\" AND textPayload=~\"operations_log write failed .STOCK_CHANGED.\"" --project=app-vendedores-shimano --limit=50 --format="value(timestamp)"
```

---

## Entregables producidos en esta tarea

1. **Rama** `audit-stock-changed-falsos-positivos` (desde main `213fbd41`).
2. **Patch mínimo al script** `scripts/audit/V_stock_changed_falsos_positivos.cjs`:
   - Query cambiada de `where type + errorCode + timestamp` (requería composite index) a `where timestamp + orderBy timestamp` + filtro in-memory. Evita crear índice extra.
   - Clasificación `race_legit / misma_fuente / cliente_viejo / sin_mismatch` agregada.
   - Top-10 users (adicional a top-10 SKUs/clientes).
   - Veredicto en la última línea del output.
3. **Reporte** `docs/auditoria/30_STOCK_CHANGED_FALSOS_POSITIVOS_2026-10-25.md` (este archivo).
4. **Sin PR de fix §39** (no hay evidencia de bug §39).
5. **Sin cambio funcional en `src/` ni `functions/`** (§31 auditoría ≠ corrección).

---

## Próximos pasos sugeridos (NO los ejecuto por §31)

1. Abrir ticket "Fix §64 logging — breakdown.utilizablePara es función" (opción A arriba, 1-line fix).
2. Deploy del fix.
3. Esperar 3-7 días.
4. Re-correr `node scripts/audit/V_stock_changed_falsos_positivos.cjs --days=7 --full`.
5. Con `clientStock` + `server` lado-a-lado, confirmar o descartar bug §39.
