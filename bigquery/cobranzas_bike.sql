-- ============================================================
-- COBRANZAS BIKE v2 (2026-09-07)
-- ============================================================
-- Vistas nuevas + fix de vista rota para el tablero de cobranzas Bike.
-- Contexto: Desktop\BIKE DASHBOARD\INFORME_SAP_INVESTIGACION_2026-09-07.md
--
-- Requiere que el pipeline sync_sap_to_bigquery.py haya corrido con las
-- nuevas ingestas activas (Cobranzas-A/B/C: Banks + IncomingPayments +
-- Deposits). Sin eso, las 4 vistas nuevas fallan porque las tablas raw
-- no existen.
--
-- Deploy: bq query --use_legacy_sql=false < bigquery/cobranzas_bike.sql
-- ============================================================


-- ============================================================
-- FIX: v_deuda_facturas_detalle (2026-09-07)
-- ============================================================
-- Bug reportado por COWORK 2026-09-07: la vista tiene un filtro hardcodeado
-- IN ('GONZALO DE LA ROSA', 'MAURICIO GIL', 'IOANNIS PALKOUDAKIS',
-- 'SANTIAGO ESTEBAN', 'FEDERICO CASTELANELLI', 'MARTIN BOIERO') que son los
-- 6 VDE de PESCA. Resultado: devolvia solo 10 facturas de pesca (18.8M ARS)
-- cuando la deuda real de la empresa es ~1.070M ARS.
--
-- Fix:
--   1) LEFT JOIN a clientes_app (antes INNER JOIN) — no perder facturas de
--      clientes que no estan asignados a ningun vendedor en la app.
--   2) Quitar el filtro IN de vendedores.
--   3) Agregar columna es_bike (heredada de sap_invoices_raw.es_bike) para
--      poder filtrar Bike vs Pesca desde Power BI.
--   4) Agregar columna es_intercompany para excluir facturas SHIMANO INC.
--      y SHIMANO PHILIPINE (11 de las 13 con +90d son intercompany).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_deuda_facturas_detalle` AS
WITH facturas_abiertas AS (
  SELECT
    inv.card_code,
    inv.card_name AS card_name_sap,
    inv.doc_entry,
    inv.doc_num,
    inv.doc_date,
    inv.doc_due_date,
    SAFE_CAST(inv.doc_total AS FLOAT64) AS doc_total_ars,
    COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) AS paid_to_date_ars,
    SAFE_CAST(inv.doc_total AS FLOAT64) - COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) AS saldo_ars,
    inv.sales_person_code AS sap_sales_person_code,
    inv.payment_group_code,
    inv._sync_timestamp,
    -- Flags para separar universo en Power BI.
    -- Intercompany: SHIMANO INC (CSIC*) y SHIMANO PHILIPINE (CSPH*) refacturacion
    -- del grupo. Concentran 890M de deuda "vencida" que no es cobranza real.
    CASE
      WHEN inv.card_code LIKE 'CSIC%' OR inv.card_code LIKE 'CSPH%' THEN TRUE
      ELSE FALSE
    END AS es_intercompany
  FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` inv
  WHERE inv.document_status = 'bost_Open'
    AND inv.cancelled = 'tNO'
    AND SAFE_CAST(inv.doc_total AS FLOAT64) - COALESCE(SAFE_CAST(inv.paid_to_date AS FLOAT64), 0) > 0.01
),
clientes_app AS (
  SELECT
    JSON_VALUE(data, '$.cardCodeSap') AS card_code,
    ARRAY_AGG(
      STRUCT(
        JSON_VALUE(data, '$.assignedVendor') AS assigned_vendor,
        JSON_VALUE(data, '$.comercio') AS comercio,
        JSON_VALUE(data, '$.fantasia') AS fantasia
      )
      ORDER BY document_id
      LIMIT 1
    )[SAFE_OFFSET(0)] AS info
  FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
  WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
    AND JSON_VALUE(data, '$.cardCodeSap') != ''
  GROUP BY card_code
)
SELECT
  ca.info.assigned_vendor AS assigned_vendor,  -- puede ser NULL si el cliente no esta asignado
  fa.card_code,
  COALESCE(NULLIF(ca.info.fantasia, ''), ca.info.comercio, fa.card_name_sap) AS cliente_display,
  ca.info.comercio AS cliente_titular,
  ca.info.fantasia AS cliente_fantasia,
  fa.doc_num,
  fa.doc_entry,
  fa.doc_date,
  fa.doc_due_date,
  DATE_DIFF(CURRENT_DATE(), fa.doc_due_date, DAY) AS dias_vencido,
  fa.doc_total_ars,
  fa.paid_to_date_ars,
  ROUND(fa.saldo_ars, 2) AS saldo_ars,
  CASE
    WHEN fa.doc_due_date < CURRENT_DATE() THEN 'VENCIDA'
    ELSE 'AL DIA'
  END AS estado,
  -- Buckets aging estandar. En Bike la mayoria son "AL DIA" (cartera sana).
  CASE
    WHEN fa.doc_due_date >= CURRENT_DATE() THEN '1. Corriente'
    WHEN DATE_DIFF(CURRENT_DATE(), fa.doc_due_date, DAY) <= 30 THEN '2. Vencida 1-30d'
    WHEN DATE_DIFF(CURRENT_DATE(), fa.doc_due_date, DAY) <= 60 THEN '3. Vencida 31-60d'
    WHEN DATE_DIFF(CURRENT_DATE(), fa.doc_due_date, DAY) <= 90 THEN '4. Vencida 61-90d'
    ELSE '5. Vencida +90d'
  END AS bucket_aging,
  fa.sap_sales_person_code,
  fa.payment_group_code,
  fa.es_intercompany,
  fa._sync_timestamp
FROM facturas_abiertas fa
LEFT JOIN clientes_app ca USING (card_code);  -- LEFT: no perder facturas sin match en app


-- ============================================================
-- NUEVA 1: dim_bancos (2026-09-07)
-- ============================================================
-- Catalogo de 86 bancos de SAP. Sirve para cruzar BankCode de PaymentChecks
-- a BankName. Top 3 bancos concentran 51% del volumen de cheques Bike 12m
-- (Santander 72, Macro 285, Galicia 7).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.dim_bancos` AS
SELECT
  CAST(bank_code AS STRING) AS bank_code,
  bank_name,
  country_code,
  swift_no,
  iban,
  absolute_entry,
  _sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_banks_raw`
WHERE bank_code IS NOT NULL;


-- ============================================================
-- NUEVA 2: v_pagos_recibidos (2026-09-07)
-- ============================================================
-- Cabecera de cada pago recibido (transferencia, cheque, efectivo).
-- Discovery Bike 12m: 6.684 pagos totales, de los cuales 4.494 (67%) son
-- transferencias (TransferSum>0) y 2.190 (33%) son cheques (todos ambos=0).
-- La distincion se hace via monto_por_medio:
--   TRANSFERENCIA: transfer_sum > 0
--   CHEQUE:        cash_sum=0 AND transfer_sum=0 (los cheques van en
--                  sap_payment_checks_raw asociados por doc_entry)
--   EFECTIVO:      cash_sum > 0 (raro en Bike)
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_pagos_recibidos` AS
WITH cheques_por_pago AS (
  -- v2 fix (2026-09-07 post-deploy): los pagos-cheque tienen cash_sum=0,
  -- transfer_sum=0 y bill_of_exchange_amount=0 en la cabecera. El monto
  -- real vive en PaymentChecks.check_sum. Sumamos aca para que
  -- monto_total_ars refleje el monto real independiente del medio de pago.
  SELECT
    payment_doc_entry,
    SUM(SAFE_CAST(check_sum AS FLOAT64)) AS total_cheques_ars,
    COUNT(*) AS n_cheques
  FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw`
  GROUP BY 1
)
SELECT
  p.doc_entry,
  p.doc_num,
  p.doc_date,
  p.due_date,
  p.card_code,
  p.card_name,
  p.doc_currency,
  SAFE_CAST(p.doc_rate AS FLOAT64) AS doc_rate,
  SAFE_CAST(p.cash_sum AS FLOAT64) AS cash_sum,
  SAFE_CAST(p.transfer_sum AS FLOAT64) AS transfer_sum,
  p.transfer_date,
  p.transfer_account,
  SAFE_CAST(p.bill_of_exchange_amount AS FLOAT64) AS bill_of_exchange_amount,
  COALESCE(c.total_cheques_ars, 0) AS total_cheques_ars,
  COALESCE(c.n_cheques, 0) AS n_cheques,
  p.series,
  CAST(p.bank_code AS STRING) AS bank_code,
  p.cancelled,
  p.journal_remarks,
  p.u_estado,
  p.u_rendicion,
  p.u_detalle_transferencia,
  p.u_status_bbva,
  p.u_id_bbva,
  -- Categoria del medio de pago (util para Power BI slicer).
  CASE
    WHEN SAFE_CAST(p.transfer_sum AS FLOAT64) > 0 THEN 'TRANSFERENCIA'
    WHEN SAFE_CAST(p.cash_sum AS FLOAT64) > 0 THEN 'EFECTIVO'
    ELSE 'CHEQUE'
  END AS medio_pago,
  -- Monto total del pago: suma de todos los medios + suma de cheques asociados
  -- (fix v2: sin el JOIN a PaymentChecks, los pagos-cheque daban monto=0).
  ROUND(
    COALESCE(SAFE_CAST(p.cash_sum AS FLOAT64), 0) +
    COALESCE(SAFE_CAST(p.transfer_sum AS FLOAT64), 0) +
    COALESCE(SAFE_CAST(p.bill_of_exchange_amount AS FLOAT64), 0) +
    COALESCE(c.total_cheques_ars, 0),
    2
  ) AS monto_total_ars,
  p._sync_timestamp
FROM `app-vendedores-shimano.shimano_app.sap_incoming_payments_raw` p
LEFT JOIN cheques_por_pago c ON p.doc_entry = c.payment_doc_entry
WHERE p.cancelled = 'tNO';


-- ============================================================
-- NUEVA 3: v_cheques_recibidos (2026-09-07)
-- ============================================================
-- 1 fila por cheque. FK a v_pagos_recibidos por payment_doc_entry.
-- Discovery Bike 12m: 1.777 cheques, 99.83% son echeq (e_check='tYES').
-- Solo 3 cheques fisicos residuales.
-- El link a Deposit va por check_abs_entry === Deposit.CheckLines.check_key.
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_cheques_recibidos` AS
WITH cheques_con_deposit AS (
  SELECT
    ch.payment_doc_entry,
    ch.payment_doc_date,
    ch.payment_card_code,
    ch.line_num,
    ch.check_number,
    ch.check_abs_entry,
    ch.due_date,
    SAFE_CAST(ch.check_sum AS FLOAT64) AS check_sum,
    ch.currency,
    CAST(ch.bank_code AS STRING) AS bank_code,
    ch.branch,
    ch.accountt_num,
    ch.check_account,
    ch.country_code,
    ch.e_check,
    ch.trnsfrable,
    ch.manual_check,
    ch.endorse,
    ch.originally_issued_by,
    ch.fiscal_id,
    ch._sync_timestamp,
    -- LEFT JOIN a deposit_checks para saber si el cheque fue depositado.
    dc.deposit_abs_entry,
    dc.deposit_date
  FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw` ch
  LEFT JOIN `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw` dc
    ON CAST(ch.check_abs_entry AS INT64) = CAST(dc.check_key AS INT64)
)
SELECT
  c.*,
  -- Estado del cheque: depositado / en cartera / vencido sin depositar
  CASE
    WHEN c.deposit_abs_entry IS NOT NULL THEN 'DEPOSITADO'
    WHEN c.due_date < CURRENT_DATE() THEN 'VENCIDO_SIN_DEPOSITAR'
    ELSE 'EN_CARTERA'
  END AS estado_cheque,
  -- Dias hasta el vencimiento (negativo = ya vencio).
  DATE_DIFF(c.due_date, CURRENT_DATE(), DAY) AS dias_hasta_vencimiento,
  -- Categoria echeq vs fisico (flag primario segun discovery).
  CASE WHEN c.e_check = 'tYES' THEN 'ECHEQ' ELSE 'FISICO' END AS tipo_cheque,
  -- Bucket vencimiento para timeline.
  CASE
    WHEN c.due_date < CURRENT_DATE() THEN '0. Vencido'
    WHEN DATE_DIFF(c.due_date, CURRENT_DATE(), DAY) <= 7 THEN '1. Vence esta semana'
    WHEN DATE_DIFF(c.due_date, CURRENT_DATE(), DAY) <= 30 THEN '2. Vence 15-30d'
    WHEN DATE_DIFF(c.due_date, CURRENT_DATE(), DAY) <= 60 THEN '3. Vence 31-60d'
    WHEN DATE_DIFF(c.due_date, CURRENT_DATE(), DAY) <= 90 THEN '4. Vence 61-90d'
    ELSE '5. Vence +90d'
  END AS bucket_vencimiento
FROM cheques_con_deposit c;


-- ============================================================
-- NUEVA 4: v_depositos (2026-09-07)
-- ============================================================
-- Cabecera de deposit. Discovery Bike 12m: 267 deposits, mayormente
-- DepositType='dtChecks' (los echeqs NO usan Deposits — se acreditan
-- directo a la cuenta bancaria via BBVA/MAV/MEP).
-- ============================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_depositos` AS
SELECT
  d.abs_entry,
  d.deposit_number,
  d.deposit_type,
  d.deposit_date,
  d.deposit_currency,
  d.deposit_account,
  d.deposit_account_type,
  d.depositor_name,
  d.bank AS bank_code_deposito,
  d.bank_account_num,
  d.bank_branch,
  SAFE_CAST(d.total_lc AS FLOAT64) AS total_lc,
  SAFE_CAST(d.total_fc AS FLOAT64) AS total_fc,
  SAFE_CAST(d.doc_rate AS FLOAT64) AS doc_rate,
  d.series,
  d.journal_remarks,
  d.check_deposit_type,
  d._sync_timestamp,
  -- Contadores de cheques del deposit (agregado desde deposit_checks).
  (
    SELECT COUNT(*)
    FROM `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw` dc
    WHERE dc.deposit_abs_entry = d.abs_entry
  ) AS n_cheques,
  (
    SELECT SUM(SAFE_CAST(dc.check_amount AS FLOAT64))
    FROM `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw` dc
    WHERE dc.deposit_abs_entry = d.abs_entry
  ) AS total_cheques_ars
FROM `app-vendedores-shimano.shimano_app.sap_deposits_raw` d;


-- ============================================================
-- Validaciones esperadas post-deploy (correr manualmente en BQ Console)
-- ============================================================
-- SELECT COUNT(*), SUM(saldo_ars) FROM v_deuda_facturas_detalle WHERE NOT es_intercompany;
--   -> ~65 facturas, ~179M ARS (bike + pesca real)
--
-- SELECT COUNT(*) FROM dim_bancos;
--   -> 86
--
-- SELECT COUNT(*), SUM(monto_total_ars) FROM v_pagos_recibidos WHERE doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH);
--   -> ~6.684 pagos, monto total esperado ~ordenes de billones
--
-- SELECT tipo_cheque, COUNT(*) FROM v_cheques_recibidos WHERE payment_doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH) GROUP BY 1;
--   -> ECHEQ: ~1774, FISICO: ~3 (99.83% echeq)
--
-- SELECT estado_cheque, COUNT(*), SUM(check_sum) FROM v_cheques_recibidos GROUP BY 1;
--   -> DEPOSITADO chico, EN_CARTERA/VENCIDO grande (los echeqs no aparecen depositados)
