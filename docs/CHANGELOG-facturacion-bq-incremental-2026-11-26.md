# Facturación SAP → BigQuery cada 5 minutos (2026-11-26)

CF nueva `syncInvoicesBqIncrementalCF`. Sin cambio de frontend ni de versión de la app.

## Antes

- Facturas (`sap_invoices_raw`) y notas de crédito (`sap_credit_notes_raw`) llegaban a BigQuery solo por el workflow GHA `sync-sap-to-bigquery.yml`.
- Ese workflow recarga todo (12 meses de 15+ entidades SAP más tablas de Firestore) y tarda ~55-63 min por corrida.
- El cron declarado es cada 30 min (`8,38 * * * *`), pero GitHub saltea corridas. Medido entre el 20/11 y el 26/11: 20 corridas OK, una cada 4-11 h. Las últimas: 26/11 01:03 y 10:45 ART.

## Problema

Power BI y las vistas de facturación mostraban datos de hasta 10 h atrás. El stock tuvo el mismo problema y se resolvió en §60/§65 pasándolo a Cloud Scheduler (`syncSapCatalogStockCF`, cada 5 min).

Aunque el cron de GitHub fuera puntual, el full sync no puede correr más seguido que lo que tarda (~1 h).

## Cambio

- `functions/core/sync-invoices-bq-incremental-core.js` (lógica pura, deps inyectables, §7):
  - Pide a SL `/Invoices` y `/CreditNotes` con `UpdateDate ge <ayer ART> and DocDate ge <hoy − 12×31 días>`. Es el mismo `$select` y la misma ventana de fechas que el script Python.
  - `flattenSapDoc` es espejo de `flatten_doc` del Python. Un test compara las columnas contra el source Python.
  - Carga las filas a `sap_invoices_delta_stage` / `sap_credit_notes_delta_stage` (WRITE_TRUNCATE, schema = el de la tabla destino) y corre una transacción BigQuery: `DELETE` de esos `doc_entry` + `INSERT` desde la staging.
- `functions/index.js`: `syncInvoicesBqIncrementalCF`, `onSchedule('every 5 minutes')`, secreto `SAP_SL_PASSWORD`, sesión SL del pool compartido. Guarda el estado de cada corrida en `app_config/invoices_bq_sync`.
- Interruptor: `app_config/feature_flags.invoices_bq_incremental_disabled = true` hace que la corrida no haga nada.
- El workflow GHA queda igual: sigue haciendo el full sync de todo, incluidas facturas y NC.

## Por qué así

- **CF + Cloud Scheduler y no disparar el workflow GHA desde Scheduler**: el workflow tarda 1 h, así que dispararlo más seguido no acerca los datos. Además pedía guardar un token de GitHub en GCP. La CF reusa la sesión SL, el bundle TLS de Seidor y la librería BigQuery que ya están en `functions/`.
- **DELETE + INSERT y no MERGE**: un MERGE que actualiza todas las columnas cobra la lectura de la tabla entera (~420 MB por corrida, casi todo `lines_json`), unos 3,5 TiB/mes a 5 min. El DELETE solo lee `doc_entry` y el INSERT solo la staging (unos KB).
- **Ventana "desde ayer"**: `UpdateDate` en SAP es solo fecha (sin hora). Tomar desde ayer cubre el cambio de día y una corrida perdida. Hoy son ~80 facturas y ~6 NC por corrida, una sola página de SL.
- **Convivencia con el full sync**: el Python hace WRITE_TRUNCATE de las mismas tablas. Si pisa algo recién traído, la siguiente corrida (5 min después) lo vuelve a traer. Si el truncate y la transacción chocan, esa corrida falla y la siguiente reintenta.

## Qué NO cambia

- Las demás tablas (cotizaciones, órdenes, remitos, cobranzas, clientes, productos) siguen con el full sync GHA.
- Los snapshots BQ → Firestore que lee la app (`sync_facturacion_snapshot_to_firestore` y otros) siguen al ritmo del full sync.
- `lines_json` se serializa con `JSON.stringify` (Python usa `json.dumps`). El JSON es equivalente: las vistas leen con `JSON_EXTRACT_ARRAY` / `JSON_VALUE` y castean los números. La única comparación de número como texto (`BaseType = '17'`) es sobre un entero, que sale igual en los dos.

## Verificación

- `npx vitest run tests/functions/sync-invoices-bq-incremental.test.js`: 21 tests (paridad de columnas y `$select` con Python, filtro en hora ART, paginado, dedupe, columnas desconocidas, error por entidad, 401 descarta sesión, transacción abortada, wiring).
- Biome y `tsc` limpios.
- Post-deploy: ver los pasos en el PR.

## Requisitos de deploy (Mariano)

1. Permisos de la cuenta de servicio de runtime de Functions sobre BigQuery: `BigQuery Data Editor` en el dataset `shimano_app` y `BigQuery Job User` en el proyecto.
2. `firebase deploy --only functions:syncInvoicesBqIncrementalCF --project app-vendedores-shimano`, que crea el job de Cloud Scheduler.

## Rollback

- Rápido: `app_config/feature_flags.invoices_bq_incremental_disabled = true`.
- Completo: `firebase functions:delete syncInvoicesBqIncrementalCF --region southamerica-east1 --project app-vendedores-shimano`. Las tablas staging se pueden borrar (`bq rm -f shimano_app.sap_invoices_delta_stage`, idem NC). El full sync GHA sigue cubriendo como antes.
