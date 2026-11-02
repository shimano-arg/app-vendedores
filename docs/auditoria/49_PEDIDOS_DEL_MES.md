# 49 — APP-06: Pedidos del mes (facturación por cliente y SKU) — informe (2026-11-02, v1540)

## 1. Fuente de datos de facturación

- **Fuente de verdad: BigQuery `app-vendedores-shimano.shimano_app.v_ventas_lineas`** (`bigquery/slp_asignado/generated/01_v_ventas_lineas.sql`).
  - Tiene una fila por línea de factura (`sap_invoices_raw`) y de nota de crédito (`sap_credit_notes_raw`) de SAP.
  - La sincroniza `scripts/sync_sap_to_bigquery.py` (workflow `sync-sap-to-bigquery.yml`, cron `8,38 * * * *`), es decir, cada 30 min cuando GitHub corre el cron.
- **En Firestore no hay líneas de factura.** Los `pedidos` de la app guardan el envío a SAP (`transferidoSAP.docEntry` de la cotización y `orderDocEntry` de la orden), pero no la factura. Por eso **la pantalla nunca lee `pedidos`, `revision_waitlist`, backorder ni stock asignado**: solo puede aparecer lo que SAP facturó.
- Campos usados:

| Campo | Columna de la vista |
|---|---|
| Identificador de factura / NC | `doc_entry` + `doc_kind` (`INVOICE` / `CREDIT_NOTE`) |
| Número visible | `doc_num` |
| Fecha de facturación | `doc_date` |
| Cliente | `card_code`, `card_name` |
| SKU y descripción | `item_code`, `item_name_catalogo` ‖ `descripcion_linea` |
| Cantidad facturada | `cantidad` (con signo −1 en NC) |
| Importe | `importe_linea_ars` (con signo −1 en NC) |
| Vendedor | `assigned_vendor` (vendedor asignado al cliente en la app) |
| Provincia | `provincia_cliente`; la localidad sale del alta del cliente (`client_applications_raw_raw_latest`) |

- El número de pedido de la app no está en la factura, porque SAP factura desde la orden de venta. La trazabilidad queda a nivel factura: número y fecha por SKU.

## 2. Cómo se determina que algo está facturado

Un SKU aparece en el módulo **solo si existe una línea de factura o nota de crédito de SAP** en `v_ventas_lineas`. Además:

- **Anulaciones:** se excluyen. La vista filtra `cancelled = 'tNO'`, así que quedan afuera tanto las facturas anuladas como los documentos espejo que crea SAP al anular (fix v748).
- **Facturación parcial:** solo cuentan las unidades que SAP facturó. Si se pidieron 10 y se facturaron 6, aparecen 6.

## 3. Criterios de cálculo (decisiones de Mariano, 2026-11-02)

| Tema | Criterio |
|---|---|
| Mes | Mes contable (`anio_contable`/`mes_contable`). La NC resta en el mes de la **factura original**; una NC sin factura base resta en su propio mes. Es el mismo criterio que el Dashboard de Ventas |
| Productos | Solo pesca (`is_pesca = TRUE`), igual que el Dashboard |
| Importe | Neto del descuento de cabecera prorrateado por línea. **Sin IVA** |
| Cantidad e importe por SKU | Suma neta del período: facturas − NC |
| Precio unitario mostrado | Subtotal ÷ cantidad, es decir, el precio efectivo facturado. Si la cantidad neta es 0, se muestra "-" |
| Duplicados | La query agrupa por (cliente, SKU, `doc_kind`, `doc_entry`), así que cada línea de documento se cuenta una sola vez. Las NC no cuentan como facturas en los contadores |
| Clientes sin vendedor asignado | No aparecen (`assigned_vendor IS NOT NULL`), igual que en el Dashboard |
| Zona horaria | `doc_date` es una fecha de SAP sin hora, así que no hay problema de corte por zona horaria. El mes por defecto es el actual en hora Argentina |

**Consistencia.** Para admin, el total del módulo de un mes tiene que coincidir con el KPI "Facturado" del Dashboard de Ventas para ese mes sin filtros: usan la misma base, el mismo mes contable y el mismo filtro de pesca. Query de control (solo lectura):

```sql
SELECT anio_contable, mes_contable, ROUND(SUM(importe_linea_ars), 2) AS facturado,
       COUNT(DISTINCT IF(doc_kind = 'INVOICE', doc_entry, NULL)) AS facturas
FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
WHERE is_pesca = TRUE AND assigned_vendor IS NOT NULL
  AND anio_contable = 2026 AND mes_contable = 10
GROUP BY 1, 2;
```

## 4. Segmentación por vendedor

La decide el **servidor** (`functions/core/pedidos-del-mes-core.js:resolveAlcance`), que lee el rol de `roles/{uid}` desde la Cloud Function.

| Rol | Ve |
|---|---|
| admin, gerente | Todo el país, con filtro de vendedor opcional en pantalla |
| vendedor | Solo los clientes con `assigned_vendor` = `roles/{uid}.vendor`. El parámetro de la query lo arma el servidor; lo que mande el navegador se ignora |
| vendedor sin `vendor` cargado | Rechazado (`permission-denied`) |
| interno, viewer, sin rol | Rechazado (decisión: el interno queda para más adelante) |

La pantalla solo envía `{anio, mes}`. La caché del servidor (10 min) usa como clave el alcance más el período, así que dos vendedores nunca comparten resultado.

## 5. Arquitectura

```
Botón "Pedidos del mes" (index.html, debajo de Forecast, solo desktop)
  └─ chunk lazy src/domains/pedidos-del-mes.js  (+ src/pure/pedidos-del-mes-view.js)
        └─ callable pedidosDelMesCF (functions/index.js, southamerica-east1)
              └─ core functions/core/pedidos-del-mes-core.js
                    └─ 1 query BigQuery parametrizada (v_ventas_lineas + localidad del alta)
```

- **Una consulta por mes**, agrupada en BigQuery por cliente, SKU y documento. Son entre cientos y pocos miles de filas por mes; no se descarga el histórico.
- **Sin índices de Firestore**: no se lee Firestore, salvo `roles/{uid}`.
- **Solo desktop**: la regla `@media (max-width:1024px),(hover:none),(pointer:coarse)` oculta el botón. Tablets y celulares no lo ven aunque el rol lo habilite.

## 6. Diseño

Sigue el patrón de Stock Asignado:

- **Fila por cliente**: ▶, nombre y código SAP, localidad, provincia, vendedor, cantidad de SKU e importe.
- **Al hacer clic**: se despliega debajo la tabla SKU / Producto / Cantidad / Precio unitario / Subtotal / Facturas, con los números de factura (F) y de nota de crédito (NC) y un total al pie. Se pueden abrir varias a la vez.
- **Encabezado**: mes, año (desde 2026), buscador, vendedor (solo admin/gerente) e indicadores de clientes, SKU e importe. Los indicadores se recalculan con el filtro.
- **Volumen**: se muestran hasta 300 clientes; el resto se encuentra con el buscador.

## 7. Pruebas

| Prueba pedida | Cómo | Resultado |
|---|---|---|
| 1 Una sola factura | `tests/functions/pedidos-del-mes-core.test.js` | OK |
| 2 Varias facturas en el mes | Mismo archivo: suma sin duplicar y conserva cada factura | OK |
| 3 Varios SKU | Mismo archivo: ordenados por importe | OK |
| 4 Facturación en distintos meses | La query filtra por mes contable. En el navegador, al cambiar el mes se vuelve a pedir con el período nuevo | OK |
| 5 Sin facturación en el período | Lista vacía, totales en 0 y mensaje "No hay facturación…" | OK |
| 6 Factura parcial | La fuente solo tiene líneas facturadas | Por construcción |
| 7 Factura anulada | La excluye la vista (`cancelled = 'tNO'`) | Por la vista |
| 8 Nota de crédito | Resta del SKU, se marca NC y no cuenta como factura. Una devolución total da cantidad 0 sin dividir por cero | OK |
| 9 Dos vendedores | Caché: PACHI y MAURICIO GIL disparan cada uno su propia query, sin mezclarse | OK |
| 10 Admin nacional | Sin filtro de vendedor | OK |
| 11 Vendedor pide datos de otro | Manda `vendedor: 'MAURICIO GIL'` y el servidor fuerza `PACHI` | OK |
| 12 Consistencia con los documentos | Query de control de la sección 3 + comparación con el Dashboard | **Pendiente (correr en prod)** |
| Lista de espera / Pendientes / Backorder no aparecen | Test de contrato: el chunk no lee Firestore ni esas colecciones; solo llama `pedidosDelMesCF` | OK |
| Botón solo desktop | Navegador: visible a 1366 px con mouse; oculto en tablet 1024 px, pantalla táctil 1280 px y celular 390 px | OK |

**Suites**:
- unit: 2717 OK;
- smoke: 25 OK;
- functions (tests nuevos): 23 OK;
- typecheck y lint de los archivos nuevos: limpios.

En `tests/functions/` hay 11 fallas que **ya estaban en `main`** antes de este cambio (tests de logging de `commit-pedido`). No tienen relación con este módulo.

## 8. Riesgos

1. **Frescura**: la facturación llega de SAP cada ~30 min. Si GitHub saltea corridas del cron, puede atrasarse más.
2. **Vendedor asignado vs. cobertura**: se usa `assignedVendor` del alta. Una cobertura temporal (`coverageBy`) no cambia quién ve el cliente.
3. **Clientes sin vendedor asignado**: quedan afuera del módulo (y del Dashboard) hasta que se les asigne uno.
4. **Solo pesca**: las líneas de bike de los clientes de División 3 no aparecen. Fue una decisión explícita.
5. **Deploy**: sin `firebase deploy --only functions:pedidosDelMesCF`, el botón abre la pantalla pero muestra el mensaje de error de carga.
