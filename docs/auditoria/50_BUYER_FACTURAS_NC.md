# 50 — APP-07: Buyer (Ficha Cliente) — facturas y notas de crédito (2026-11-02, v1542)

## 1. De dónde salen los números

- Pestaña Buyer de la Ficha Cliente (`index.html:_renderFichaClienteBuyer`). Solo muestra el doc `client_buyer_stats/{cardCode}` de Firestore, sin calcular nada.
- Ese doc lo escribe la Cloud Function `recomputeClientBuyerStats` (cron `0 3 * * *`, `functions/index.js:3530`) y también la callable manual `triggerRecomputeClientBuyerStats`.
  - Lee BigQuery `v_ventas_lineas` de los últimos 24 meses con `_buyerFetchVentasRows`.
  - Agrega por cliente y por ventana de 3/6/12/24 meses en `functions/core/buyer-stats-core.js:computeWindowStats`.
- **Tipos de documento reales de SAP**: la columna `doc_kind` de la vista.
  - `INVOICE`: documentos del endpoint SAP `/b1s/v1/Invoices` (tabla `sap_invoices_raw`).
  - `CREDIT_NOTE`: documentos de `/b1s/v1/CreditNotes` (`sap_credit_notes_raw`). Llegan con cantidad e importe multiplicados por −1.
  - **No se usa el signo del importe para clasificar.**
- **Anulados**: la vista filtra `cancelled = 'tNO'`. Excluye las facturas anuladas y también los documentos espejo de anulación (fix v748).
- **Fecha**: es `fecha_contable`. Una NC con factura base toma la fecha de esa factura (v1073); una NC sin base conserva su propia fecha.

## 2. Diagnóstico

**FACTURAS:** el código ya contaba solo `INVOICE` (`facturasSet` por `doc_entry`). **Con el código actual, 5 facturas + 3 NC dan 5, no 8.** Para el caso que vio Mariano quedan tres hipótesis, que se cierran con la consulta de diagnóstico (sección 6) y el CardCode afectado:

1. El doc de Firestore del cliente es viejo: el cron falló o lo escribió una versión anterior. Se verifica con `client_buyer_stats/_meta_.lastRun` y el `computedAt` del cliente.
2. En SAP hay documentos cargados como factura (`/Invoices`) que no son facturas de venta. Por ejemplo, notas de débito, que en SAP Argentina viven en Invoices con `DocumentSubType`. La sincronización **no guarda** `DocumentSubType`; la consulta muestra la **serie** de cada documento para distinguirlos.
3. El 8 se vio en otra pantalla.

**Errores reales encontrados y corregidos (v1542):**

| Indicador | Antes | Problema |
|---|---|---|
| Primera / Última compra, Días desde la última | Mín/máx de la fecha de **todas** las filas | Una NC sin factura base (que queda en su propia fecha) aparecía como "última compra", y un cliente con solo NC mostraba una compra |
| Frecuencia | Período de todas las filas ÷ (facturas − 1) | Mezclaba el período con fechas de NC y la cantidad de facturas |
| Kpi Frecuencia (pantalla) | `facturas < 2` → "N/A (1 factura)" | Con 0 facturas decía "1 factura" |

## 3. Fórmulas

| Indicador | Antes | Ahora |
|---|---|---|
| Facturas | # `doc_entry` distintos con `doc_kind = INVOICE` | Igual |
| Monto total | Σ importe de todas las líneas (facturas + NC con signo) = **neto** | Igual (neto). Se agregan `montoBruto` (solo facturas), `notasCreditoArs` y `notasCreditoCount` como datos informativos; la pantalla no cambia |
| Promedio por factura | neto ÷ facturas | Igual (0 si no hay facturas) |
| Primera / Última compra | mín/máx de todas las filas | mín/máx **solo de facturas** |
| Días desde la última | desde la última fila | desde la última **factura** (null si no hay) |
| Frecuencia | período(todas las filas) ÷ (facturas − 1) | período(**facturas**) ÷ (facturas − 1), con 2 o más facturas |
| Facturas por mes | facturas ÷ meses de la ventana | Igual |
| SKU (cantidad, monto, %) | Neto por SKU (la NC resta en su SKU) | Igual. Suma de SKU = monto total |
| Mix por categoría | Neto por categoría, % sobre el monto total | Igual. Suma de categorías = monto total |

Criterio: todos los importes son **netos**, después del descuento de cabecera prorrateado y sin IVA, con la misma base que `v_ventas_lineas`, el Dashboard de Ventas y Pedidos del mes. No se mezclan bruto y neto.

## 4. Pruebas (`tests/functions/buyer-stats-core.test.js`)

| Caso | Resultado |
|---|---|
| A: 5 facturas + 3 NC | Facturas 5, NC 3, neto = bruto + NC, promedio = neto ÷ 5 ✔ |
| B: 5 facturas sin NC | Facturas 5, neto = bruto, frecuencia correcta ✔ |
| C: NC total | Facturas 5, neto y cantidad del SKU ajustados ✔ |
| D: 2 NC parciales sobre SKU distintos | Cada NC resta en su SKU; Σ SKU = Σ categorías = monto total ✔ |
| E: NC sin base posterior | La última compra sigue siendo la factura (antes daba la fecha de la NC) ✔. Ventanas: la NC queda en la ventana de su factura base ✔ |
| F: factura anulada + NC | La NC resta una sola vez y no cuenta como factura ni como compra ✔ (ver limitación 2) |
| G: sin facturación válida / sin filas | Sin compras, sin divisiones por cero ✔ |

Con el código anterior fallan los casos E y G por las fechas. Los demás fallan solo por los campos nuevos: el conteo de facturas ya daba 5.

## 5. Limitaciones

1. **NC sin factura base** (`nc_sin_base` en la vista): resta en su propia fecha. Si cae en una ventana donde no está la factura original, el neto de esa ventana baja. No se puede asignar a la factura sin el vínculo `BaseEntry`.
2. **Factura anulada y además una NC sobre ella**: la vista excluye la factura y deja la NC, que entonces resta sola. El core no puede detectarlo porque `v_ventas_lineas` no expone la factura base. Si la consulta muestra casos así, el arreglo va en la vista: excluir la NC cuya base esté anulada.
3. **Notas de débito**: si SAP las guarda en `/Invoices`, hoy cuentan como facturas. Distinguirlas requiere sincronizar `DocumentSubType` (o usar la serie). Es un cambio de sync, fuera de este alcance; se decide con el resultado de la consulta.
4. Los datos se recalculan **solo cuando corre el cron** con el código nuevo, después del deploy de `recomputeClientBuyerStats`. No se reprocesa nada por fuera.

## 6. Consulta de diagnóstico (solo lectura)

La consulta se le entregó a Mariano con el nombre `app07-diagnostico.sql`. Para un CardCode muestra:

- todos los documentos de facturas y NC, incluidos los anulados, con su serie;
- lo que entra a Buyer en los últimos 12 meses por tipo;
- las series de facturas y NC de toda la base.
