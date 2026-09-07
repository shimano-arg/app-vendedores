#!/usr/bin/env python
"""
Diagnostico del link cheque <-> deposit en produccion.
Objetivo: encontrar la columna clave que hace el JOIN correcto entre
sap_payment_checks_raw y sap_deposit_checks_raw.
Cowork reporta que el link actual (check_abs_entry <-> check_key)
matchea 0 de 1849 cheques.
"""
from google.cloud import bigquery

c = bigquery.Client(project='app-vendedores-shimano', location='southamerica-east1')

def run(name, sql):
    print(f'\n=== {name} ===')
    try:
        for row in c.query(sql).result():
            print('  ', dict(row))
    except Exception as e:
        print(f'  ERROR: {e}')

# 1. Ver un sample de deposit_checks reciente
run('Sample 3 deposit_checks recientes',
    '''SELECT deposit_abs_entry, deposit_date, check_key, check_number, bank, branch, check_amount
       FROM `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw`
       ORDER BY deposit_date DESC LIMIT 3''')

# 2. Ver un sample de payment_checks reciente
run('Sample 3 payment_checks recientes',
    '''SELECT payment_doc_entry, payment_doc_date, check_number, check_abs_entry, bank_code, branch, check_sum, e_check
       FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw`
       ORDER BY payment_doc_date DESC LIMIT 3''')

# 3. Distribucion de valores
run('Valores unicos en deposit_checks.check_key',
    '''SELECT COUNT(*) AS total,
              COUNT(DISTINCT check_key) AS distinct_check_key,
              COUNT(DISTINCT check_number) AS distinct_check_number,
              MIN(check_key) AS min_ck, MAX(check_key) AS max_ck
       FROM `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw`''')

run('Valores unicos en payment_checks.check_abs_entry',
    '''SELECT COUNT(*) AS total,
              COUNT(DISTINCT check_abs_entry) AS distinct_cae,
              COUNT(DISTINCT check_number) AS distinct_check_number,
              MIN(check_abs_entry) AS min_cae, MAX(check_abs_entry) AS max_cae
       FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw`''')

# 4. Test de matcheo por 3 join keys
run('Test JOIN por check_abs_entry <-> check_key',
    '''SELECT COUNT(*) AS matches
       FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw` p
       INNER JOIN `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw` d
         ON CAST(p.check_abs_entry AS INT64) = CAST(d.check_key AS INT64)''')

run('Test JOIN por check_number solo',
    '''SELECT COUNT(*) AS matches
       FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw` p
       INNER JOIN `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw` d
         ON CAST(p.check_number AS INT64) = CAST(d.check_number AS INT64)''')

run('Test JOIN por check_number + bank_code',
    '''SELECT COUNT(*) AS matches
       FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw` p
       INNER JOIN `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw` d
         ON CAST(p.check_number AS INT64) = CAST(d.check_number AS INT64)
        AND CAST(p.bank_code AS STRING) = CAST(d.bank AS STRING)''')

run('Test JOIN por check_number + branch + bank',
    '''SELECT COUNT(*) AS matches
       FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw` p
       INNER JOIN `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw` d
         ON CAST(p.check_number AS INT64) = CAST(d.check_number AS INT64)
        AND CAST(p.bank_code AS STRING) = CAST(d.bank AS STRING)
        AND CAST(p.branch AS STRING) = CAST(d.branch AS STRING)''')

# 5. Ver un cheque de payment concreto y buscarlo en deposit por check_number+bank
run('Sample: 1 payment_check y buscar en deposit_checks',
    '''WITH sample AS (
         SELECT p.check_number, p.bank_code, p.branch, p.check_abs_entry, p.check_sum
         FROM `app-vendedores-shimano.shimano_app.sap_payment_checks_raw` p
         WHERE p.check_number > 0
         ORDER BY p.payment_doc_date DESC
         LIMIT 1
       )
       SELECT s.check_number AS pcheck_num, s.check_abs_entry, s.bank_code AS pbank,
              d.check_key, d.check_number AS dcheck_num, d.bank AS dbank, d.deposit_abs_entry
       FROM sample s
       LEFT JOIN `app-vendedores-shimano.shimano_app.sap_deposit_checks_raw` d
         ON CAST(s.check_number AS INT64) = CAST(d.check_number AS INT64)
        AND CAST(s.bank_code AS STRING) = CAST(d.bank AS STRING)''')
