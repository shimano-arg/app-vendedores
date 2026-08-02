# scripts/ — matriz de scripts Python

Última actualización: 2026-08-02 (v379).

Muchos scripts en esta carpeta son de una sola corrida — bootstrap de vistas BQ, data-fixes puntuales, investigaciones. Otros son cronjobs activos que sostienen la app. Esta matriz explica cuál es cuál para acelerar el on-boarding.

Los scripts **`check_*.py`, `count_*.py`, `find_*.py`, `query_*.py`, `replay_*.py` están gitignored** desde v379 — son investigation ad-hoc que no se mantienen versionadas.

## 🟢 ACTIVOS — cronjobs de producción

| Script | Workflow | Frecuencia | Qué hace |
|---|---|---|---|
| `sync_sap_to_firestore.py` | `sync-sap-catalog-stock.yml` | Cada 30 min (`:13,:43`) | SL → Firestore. Poblá `product_catalog`, `stock_snapshot` (con `warehouseBreakdown` v368+ y `backorderBySku` v377+), `price_list`, BPs pesca y `stock.json` del repo. |
| `sync_sap_to_bigquery.py` | `sync-sap-to-bigquery.yml` | Cada 30 min (`:13,:43`) | SL → BQ (6 tablas `sap_*_raw`) + targets + campanias + `sap_snapshot` Dashboard v367+ + `sapEstado` pedidos v378+. |
| `send_rendiciones_email.py` | `send-rendiciones-email.yml` | Diario | Email al equipo con rendiciones pendientes. |

## 🟡 BOOTSTRAP / DEPLOY — uso ocasional

Se corren cuando se despliega una nueva vista BQ o se hace un bootstrap de datos históricos.

| Script | Cuándo usar |
|---|---|
| `apply_v_targets.py` | Bootstrap vista `v_targets` (targets sync). |
| `apply_v_campanias.py` | Bootstrap vista `v_campanias_progreso`. |
| `apply_v_deuda.py` | Bootstrap vistas `v_deuda_por_vendedor` + `v_deuda_facturas_detalle`. |
| `apply_v_facturado_cobrado.py` | Bootstrap vista `v_facturado_cobrado_deuda_por_vendedor`. |
| `apply_facturas_sap_slim.py` | Bootstrap vista slim de facturas. |
| `apply_credit_notes_fix.py` | Bootstrap del sync de credit notes. |
| `apply_dashboard_snapshot.py` | Bootstrap del `sap_snapshot` Dashboard v367. |
| `bootstrap_targets_to_bigquery.py` | Bootstrap inicial de `targets_raw` en BQ. |
| `deploy_inventario_views.py` | Deploy de vistas de inventario. |
| `redeploy_views.py` | Reset + recreate de todas las vistas BQ. |

## 🟠 AUDIT / VERIFY — chequeos post-deploy

Manuales, se corren tras cada release relevante o cuando el equipo reporta anomalía.

| Script | Qué chequea |
|---|---|
| `audit_targets.py` | Auditoría periódica del sync targets Firestore ↔ BQ. |
| `verify_fantasias_in_firestore.py` | Verifica que las fantasías bulk-imported estén en Firestore. |
| `verify_inventario_post_deploy.py` | Post-deploy de vistas inventario. |
| `smoke_inventario.py`, `smoke_pedidos_lines.py`, `smoke_ventas_backorder.py` | Smokes de vistas BQ contra BQ real. |

## 🔵 BUILD / GENERADORES DE DOCS

| Script | Output |
|---|---|
| `build_manual_shimano.py` | Manual de usuario en PDF/DOCX. |
| `build_mejoras_shimano.py` | Doc de mejoras/roadmap generado. |

## ⚪ LEGACY — one-shot ya ejecutados (mantener por historial)

No los borres — muchos documentan cómo se hicieron migraciones que no se pueden reproducir hoy. Pero **NO los ejecutes de nuevo** sin revisar antes.

| Script | Qué hizo |
|---|---|
| `sync_stock.py` | Sync stock desde CSV Drive de David. **Deprecated** desde 2026-06-18 (David dejó de subir el CSV). Sustituido por `sync_sap_to_firestore.py`. |
| `bulk_fix_provincia_localidad_from_excel.py` | Data-fix masivo de provincias/localidades. |
| `bulk_import_fantasias_from_excel.py` | Import inicial de fantasias desde Excel. |
| `migrate_rendiciones_foto_to_storage.py` | Migró `fotoTicket` base64 → Cloud Storage. |
| `patch_paid_to_date.py` | Fix histórico de `paid_to_date` en `sap_invoices_raw`. |
| `cleanup_bad_bp_sync.py` | Limpieza de BPs mal sincronizados post-v285. |
| `validate_slp_mapping.py` | Validación mapping SlpCode → vendedor. |
| `rollback_v_inventario.py` | Rollback puntual de vista inventario. |
| `sync_invoices_only.py` | Re-sync puntual de sólo invoices tras un bug. |
| `inspect_shimano_fishing_excel.py`, `investigate_pesca_sin_familia.py` | Investigation one-shot Excel PESCA. |
| `explore_targets_pipeline.py`, `diagnose_inventario_gap.py`, `dryrun_new_views.py` | Diagnósticos puntuales BQ. |
| `debug_items.py`, `debug_sl_direct.py`, `check_encoding_bytes.py`, `check_provincias_salta.py`, `check_salta_matching.py`, `check_sl_config.py`, `check_ventas_facturado.py`, `query_sap_sales_persons*.py`, `test_inventario_fix.py` | Debug ad-hoc — mantener por doc pero no ejecutar sin contexto. |

## Convención para scripts nuevos

- **Activo (cronjob nuevo)** → prefijo `sync_`, `send_`, `apply_`, `audit_`. Va en un workflow.
- **Bootstrap/deploy manual** → prefijo `apply_`, `deploy_`, `bootstrap_`. Documentá el uso al inicio del script.
- **Smoke/verify post-deploy** → prefijo `smoke_`, `verify_`. Documentá qué asserts hace.
- **Investigation one-shot** → prefijo `check_`, `count_`, `find_`, `query_`, `replay_`. **Gitignored automáticamente** (ver `.gitignore` líneas 55-63). Ejecutá localmente sin commitear.
- **One-shot que sí querés versionar** (data fix histórico) → cualquier prefijo salvo los gitignored. Agregá docstring explicando qué fue y cuándo se corrió.
