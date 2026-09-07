# Deploy Sprint 2 Backend — Cobranzas Bike

Fecha: 2026-09-07
Contexto: Desktop\BIKE DASHBOARD\INFORME_SAP_INVESTIGACION_2026-09-07.md

## Qué se cambió

### 1. `scripts/sync_sap_to_bigquery.py`

**A. Fix `bp_select`** (Business Partners con credit):
- Agregados: `CreditLimit`, `MaxCommitment`, `CurrentAccountBalance`
- Corrige el error viejo `CreditLine` (HTTP 400 en SL) — el nombre real es `CreditLimit`
- Impacto: los 3 campos van a poblarse en `sap_bp_raw` (antes venían todos NULL)

**B. Nueva sección `COBRANZAS-A` — Banks**:
- Endpoint `/Banks` — 86 rows
- Tabla nueva: `sap_banks_raw`

**C. Nueva sección `COBRANZAS-B` — IncomingPayments + Checks**:
- Endpoint `/IncomingPayments?$filter=DocDate ge ...&$expand=PaymentChecks`
- Historia: 12 meses (usa `since_iso_date` global del pipeline)
- Fan-out: 1 pago con N cheques → N rows en tabla de cheques
- Tablas nuevas: `sap_incoming_payments_raw` + `sap_payment_checks_raw`
- Volumen esperado: ~6.684 pagos + ~1.777 cheques 12m

**D. Nueva sección `COBRANZAS-C` — Deposits + CheckLines**:
- Endpoint `/Deposits?$filter=DepositDate ge ...&$expand=CheckLines`
- Fan-out análogo al anterior
- Tablas nuevas: `sap_deposits_raw` + `sap_deposit_checks_raw`
- Volumen esperado: ~1.009 deposits totales (~267 del último año)

**5 nuevas funciones flatten**: `flatten_incoming_payment`, `flatten_payment_check`, `flatten_deposit`, `flatten_deposit_check`, `flatten_bank`.

### 2. `bigquery/cobranzas_bike.sql`

**Fix `v_deuda_facturas_detalle`**:
- Removido filtro hardcodeado `assigned_vendor IN (...)` de los 6 VDE Pesca (bug reportado por Cowork 2026-09-07 — devolvía solo 10 facturas Pesca cuando la deuda real es ~1.070M ARS)
- Cambiado `INNER JOIN` → `LEFT JOIN` para no perder facturas de clientes sin match en app
- Agregada columna `es_intercompany` (True para `CSIC*` y `CSPH*`)
- Agregada columna `bucket_aging` (5 buckets estándar 0/1-30/31-60/61-90/91+)

**4 vistas nuevas**:
- `dim_bancos` — catálogo bancos con nombre limpio
- `v_pagos_recibidos` — cabecera cada pago con `medio_pago` categorizado (TRANSFERENCIA / CHEQUE / EFECTIVO)
- `v_cheques_recibidos` — 1 fila por cheque con link a Deposit + `tipo_cheque` (ECHEQ / FISICO) + `estado_cheque` (DEPOSITADO / EN_CARTERA / VENCIDO_SIN_DEPOSITAR) + `bucket_vencimiento`
- `v_depositos` — cabecera con contadores de cheques agregados

## Cómo desplegar

### Paso 1 — Correr el pipeline con los cambios de Python

```bash
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"

# Con .env local o SA JSON
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content sa-key.json -Raw
python scripts/sync_sap_to_bigquery.py
```

**Tiempo estimado**: 8-15 minutos (los 4 endpoints nuevos suman ~2-3 min al total).

**Qué buscar en los logs**:
- `[SL/BP] total: 2410 docs` (o similar) → BP con credit correcto
- `[SL/BANKS] total: 86 docs` → catálogo bancos OK
- `[SL/INCOMING_PAYMENTS] total: ~7000 docs` → pagos 12m OK
- `[COBRANZAS] IncomingPayments 12m: ~7000 pagos / ~2000 cheques`
- `[SL/DEPOSITS] total: ~270 docs`
- `[COBRANZAS] Deposits 12m: ~270 deposits / ~500 check-lines`

Si algún endpoint devuelve HTTP 400 → revisar log para ver qué campo no reconoce. Fix típico: probar con `expand_fields=None` primero y agregar campos incrementalmente.

### Paso 2 — Desplegar las vistas SQL

```bash
# Opción A: via bq CLI
bq query --use_legacy_sql=false < bigquery/cobranzas_bike.sql

# Opción B: copiar+pegar en BigQuery Console
# 1. Abrir https://console.cloud.google.com/bigquery?project=app-vendedores-shimano
# 2. Copiar el contenido de bigquery/cobranzas_bike.sql
# 3. Ejecutar
```

**Tiempo estimado**: <30 segundos (son 5 CREATE OR REPLACE VIEW).

### Paso 3 — Validar en BQ

Correr en BQ Console cada uno de estos y verificar el rango esperado:

```sql
-- Deuda real bike + pesca (sin intercompany)
SELECT
  COUNT(*) AS n_facturas,
  ROUND(SUM(saldo_ars), 2) AS total_saldo
FROM `app-vendedores-shimano.shimano_app.v_deuda_facturas_detalle`
WHERE NOT es_intercompany;
-- Esperado: ~65 facturas, ~179M ARS

-- Catálogo bancos
SELECT COUNT(*) FROM `app-vendedores-shimano.shimano_app.dim_bancos`;
-- Esperado: 86

-- Split cheques echeq vs físico
SELECT tipo_cheque, COUNT(*) AS n, ROUND(SUM(check_sum), 2) AS total
FROM `app-vendedores-shimano.shimano_app.v_cheques_recibidos`
WHERE payment_doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
GROUP BY 1;
-- Esperado: ECHEQ ~1774, FISICO ~3

-- Distribución medio de pago
SELECT medio_pago, COUNT(*) AS n, ROUND(SUM(monto_total_ars), 2) AS total
FROM `app-vendedores-shimano.shimano_app.v_pagos_recibidos`
WHERE doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
GROUP BY 1;
-- Esperado: TRANSFERENCIA ~4494 (67%), CHEQUE ~2190 (33%), EFECTIVO minoría
```

### Paso 4 — Refresh del modelo Power BI

En PBI Desktop → abrir `TABLERO BIKE SAR.pbix` → Home → Refresh.

Las 4 tablas nuevas + fix van a aparecer en el modelo. Después Cowork o Mariano pueden armar las 3 hojas nuevas (Cash Flow, Cheques & Bancos, VIP Credit Limits) usando estas vistas.

## Rollback

Si algo se rompe:

### Rollback del pipeline
Revertir el commit en `sync_sap_to_bigquery.py`. Las tablas raw quedan pero paran de refrescarse — no afecta las tablas viejas (BP, invoices, etc.).

### Rollback de las vistas
La única vista con cambio destructivo es `v_deuda_facturas_detalle`. Para revertir al comportamiento viejo (con filtro Pesca hardcodeado), copiar el SQL viejo de `bigquery/views.sql` línea ~1155-1216 y correr manualmente.

Las 4 vistas nuevas se pueden `DROP VIEW` sin consecuencia porque no hay consumers todavía.

## Consumo desde Power BI

Cuando el pipeline corra + las vistas estén deployadas:

- Modelo PBI: agregar las 4 vistas nuevas como tablas (Home → Get Data → BigQuery)
- Relaciones sugeridas:
  - `v_pagos_recibidos[bank_code]` → `dim_bancos[bank_code]` (M:1)
  - `v_cheques_recibidos[bank_code]` → `dim_bancos[bank_code]` (M:1)
  - `v_cheques_recibidos[payment_doc_entry]` → `v_pagos_recibidos[doc_entry]` (M:1)
  - `v_pagos_recibidos[card_code]` → `dim_Cliente[Cliente_Key]` (M:1)
  - `v_pagos_recibidos[doc_date]` → `Date[Date]` (M:1)
  - `v_cheques_recibidos[due_date]` → `Date[Date]` (M:1 con USERELATIONSHIP)

## Next steps

1. Correr `sync_sap_to_bigquery.py` una vez completo (paso 1)
2. Deploy vistas SQL (paso 2)
3. Validar métricas en BQ (paso 3)
4. Refresh PBI + verificar nuevas tablas en modelo (paso 4)
5. Cowork arma las 3 hojas nuevas (Cash Flow / Cheques & Bancos / VIP Credit Limits) con guías análogas a la de AR Aging
