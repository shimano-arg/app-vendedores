#!/usr/bin/env python
"""Sanity check queries post-deploy de cobranzas_bike.sql."""
from google.cloud import bigquery

PROJECT = 'app-vendedores-shimano'
client = bigquery.Client(project=PROJECT, location='southamerica-east1')

def run(name, sql):
    print(f'\n=== {name} ===')
    try:
        for row in client.query(sql).result():
            print('  ', dict(row))
    except Exception as e:
        print(f'  ERROR: {e}')

run('Deuda real bike+pesca (sin intercompany)',
    '''SELECT
         COUNT(*) AS n_facturas,
         ROUND(SUM(saldo_ars), 2) AS total_saldo_ars,
         SUM(CASE WHEN es_intercompany THEN 1 ELSE 0 END) AS intercompany_excluidas
       FROM `app-vendedores-shimano.shimano_app.v_deuda_facturas_detalle`
       WHERE NOT es_intercompany''')

run('Catalogo bancos',
    'SELECT COUNT(*) AS n FROM `app-vendedores-shimano.shimano_app.dim_bancos`')

run('Pagos 12m por medio_pago',
    '''SELECT medio_pago, COUNT(*) AS n, ROUND(SUM(monto_total_ars), 2) AS total
       FROM `app-vendedores-shimano.shimano_app.v_pagos_recibidos`
       WHERE doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
       GROUP BY 1 ORDER BY n DESC''')

run('Cheques 12m: echeq vs fisico',
    '''SELECT tipo_cheque, COUNT(*) AS n, ROUND(SUM(check_sum), 2) AS total_ars
       FROM `app-vendedores-shimano.shimano_app.v_cheques_recibidos`
       WHERE payment_doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
       GROUP BY 1''')

run('Cheques por estado',
    '''SELECT estado_cheque, COUNT(*) AS n, ROUND(SUM(check_sum), 2) AS total_ars
       FROM `app-vendedores-shimano.shimano_app.v_cheques_recibidos`
       GROUP BY 1 ORDER BY n DESC''')

run('Deposits 12m',
    '''SELECT COUNT(*) AS n_deposits, SUM(n_cheques) AS total_cheques_depositados
       FROM `app-vendedores-shimano.shimano_app.v_depositos`
       WHERE deposit_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)''')

run('Aging Bike (sin intercompany)',
    '''SELECT bucket_aging, COUNT(*) AS n, ROUND(SUM(saldo_ars), 2) AS total_ars
       FROM `app-vendedores-shimano.shimano_app.v_deuda_facturas_detalle`
       WHERE NOT es_intercompany
       GROUP BY 1 ORDER BY 1''')

run('Top 3 bancos por # cheques 12m',
    '''SELECT c.bank_code, b.bank_name, COUNT(*) AS n_cheques,
              ROUND(SUM(c.check_sum), 2) AS total_ars
       FROM `app-vendedores-shimano.shimano_app.v_cheques_recibidos` c
       LEFT JOIN `app-vendedores-shimano.shimano_app.dim_bancos` b USING (bank_code)
       WHERE c.payment_doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
       GROUP BY 1, 2 ORDER BY n_cheques DESC LIMIT 3''')
