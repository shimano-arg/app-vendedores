"""
Reporte semanal facturacion zona PACHI vs zona SANTI propia — trial 3 meses.
============================================================================

Contexto: Diego (director) 2026-09-10 confirmo que PACHI cubre presencialmente
la ex-zona de MARTIN durante 3 meses (hasta 2026-12-11). SAP factura como SANTI
pero client_applications.coverageBy='PACHI' distingue operativamente. Este
reporte le muestra a Mariano cuanto factura cada zona por semana.

Envio: bot.shimano.pesca@gmail.com -> mariano.erbino@shimano.com.ar
Frecuencia: lunes 09:00 AR (12:00 UTC). Configurable en el workflow.

Extra: 7 dias ANTES del vencimiento del trial (2026-12-04), y AL vencer
(2026-12-11), agrega bloque de alerta con recomendacion operativa.

Fuente de datos: BigQuery
  - v_facturas_sap        cabecera facturas SAP con coverage_by (v862+)

Env vars (GitHub Actions Secrets):
  FIREBASE_SERVICE_ACCOUNT   JSON SA (BQ Data Viewer).
  GMAIL_APP_PASSWORD         App password de bot.shimano.pesca@gmail.com.
  MAIL_FROM, MAIL_TO         Overridable por env.
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
from datetime import datetime, date, timedelta
from email.message import EmailMessage
from email.utils import make_msgid
from zoneinfo import ZoneInfo

from google.cloud import bigquery
from google.oauth2 import service_account

BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'

MAIL_FROM = os.environ.get('MAIL_FROM', 'bot.shimano.pesca@gmail.com')
MAIL_TO_RAW = os.environ.get('MAIL_TO', 'mariano.erbino@shimano.com.ar')
MAIL_TO = [x.strip() for x in MAIL_TO_RAW.split(',') if x.strip()]
GMAIL_APP_PASSWORD = os.environ.get('GMAIL_APP_PASSWORD', '')
FB_SA_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '')
DRY_RUN = os.environ.get('DRY_RUN', '').lower() in ('true', '1', 'yes')

TZ_AR = ZoneInfo('America/Argentina/Buenos_Aires')

# Trial dates (fijos)
TRIAL_START = date(2026, 9, 11)
TRIAL_END = date(2026, 12, 11)
ALERT_WEEK_BEFORE = TRIAL_END - timedelta(days=7)  # 2026-12-04

# Paleta Shimano (misma que send_tablero_sar_email.py)
NAVY = '#1F3864'
NAVY_DARK = '#0F172A'
LIGHT_BLUE = '#D9E1F2'
SHIMANO_CYAN = '#00A9E0'
GREEN_OK = '#10b981'
ORANGE_WARN = '#f59e0b'
RED_BAD = '#dc2626'
MUTED = '#64748b'


def log(msg):
    print(f'[{datetime.now(TZ_AR).isoformat()}] {msg}', flush=True)


def init_bq():
    if not FB_SA_JSON:
        log('[FATAL] FIREBASE_SERVICE_ACCOUNT vacia')
        sys.exit(1)
    sa_info = json.loads(FB_SA_JSON)
    creds = service_account.Credentials.from_service_account_info(
        sa_info,
        scopes=['https://www.googleapis.com/auth/bigquery'],
    )
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


def fmt_ars(n):
    if n is None:
        return '$ 0'
    return '$ ' + f'{int(round(n)):,}'.replace(',', '.')


def query_coverage_agg(client):
    """
    Facturacion ultimos 7d y 30d agrupada por coverage_by.
    Solo INVOICE (no CN), open o closed pero facturas emitidas
    (no cancelled). Filtra assigned_vendor='SANTIAGO ESTEBAN' para el
    corte que interesa al trial (facturas que SAP registra a SANTI pero
    que pueden ser PACHI coverage).
    """
    q = f'''
    WITH facts AS (
      SELECT
        card_code,
        assigned_vendor,
        coverage_by,
        DATE(doc_date) AS d,
        doc_total AS total_ars
      FROM `{BQ_PROJECT}.{BQ_DATASET}.v_facturas_sap`
      WHERE cancelled = 'tNO'
        AND doc_kind = 'INVOICE'
        AND assigned_vendor = 'SANTIAGO ESTEBAN'
        AND doc_date >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 30 DAY)
    )
    SELECT
      CASE WHEN coverage_by = 'PACHI' THEN 'ZONA_PACHI'
           ELSE 'ZONA_SANTI_PROPIA' END AS bucket,
      COUNT(DISTINCT card_code) AS clientes,
      COUNTIF(d >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 7 DAY)) AS n_fx_7d,
      ROUND(SUM(CASE WHEN d >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 7 DAY) THEN total_ars ELSE 0 END), 0) AS total_ars_7d,
      COUNT(*) AS n_fx_30d,
      ROUND(SUM(total_ars), 0) AS total_ars_30d
    FROM facts
    GROUP BY bucket
    ORDER BY bucket;
    '''
    return list(client.query(q).result())


def query_top_pachi_clientes(client):
    """Top 10 clientes zona PACHI por facturacion ultimos 30d."""
    q = f'''
    SELECT
      card_code,
      ANY_VALUE(card_name_invoice) AS cliente,
      COUNT(*) AS n_fx,
      ROUND(SUM(doc_total), 0) AS total_ars,
      MAX(doc_date) AS ultima_fx
    FROM `{BQ_PROJECT}.{BQ_DATASET}.v_facturas_sap`
    WHERE cancelled = 'tNO' AND doc_kind = 'INVOICE'
      AND coverage_by = 'PACHI'
      AND doc_date >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 30 DAY)
    GROUP BY card_code
    ORDER BY total_ars DESC
    LIMIT 10;
    '''
    return list(client.query(q).result())


def get_trial_status():
    today = datetime.now(TZ_AR).date()
    days_left = (TRIAL_END - today).days
    if days_left < 0:
        return ('EXPIRED', days_left, 'Trial vencido — decisión pendiente')
    if today >= ALERT_WEEK_BEFORE:
        return ('WEEK_LEFT', days_left, f'Trial vence en {days_left} días — preparar decisión')
    return ('ACTIVE', days_left, f'Trial activo — {days_left} días restantes')


def build_html(agg_rows, top_pachi, trial_state, days_left, trial_msg):
    today_str = datetime.now(TZ_AR).strftime('%d/%m/%Y')

    # KPI blocks agg_rows
    def find_bucket(name):
        for r in agg_rows:
            if r.bucket == name:
                return r
        return None

    pachi = find_bucket('ZONA_PACHI')
    santi = find_bucket('ZONA_SANTI_PROPIA')

    def kpi_block(name, row, color):
        if not row:
            return f'<td style="background:#f8fafc;color:{MUTED};padding:12px;border-radius:6px;text-align:center">{name}<br><b>Sin data</b></td>'
        return (
            f'<td style="background:{LIGHT_BLUE};padding:12px;border-radius:6px;text-align:center;border-left:4px solid {color}">'
            f'<div style="font-size:11px;color:{MUTED};font-weight:800;letter-spacing:.5px;text-transform:uppercase">{name}</div>'
            f'<div style="font-size:18px;color:{NAVY};font-weight:800;margin:4px 0">{fmt_ars(row.total_ars_7d)}</div>'
            f'<div style="font-size:11px;color:{MUTED}">7d · {row.n_fx_7d} fx · {row.clientes} clientes</div>'
            f'<div style="font-size:12px;color:{NAVY};margin-top:6px">Últimos 30d: <b>{fmt_ars(row.total_ars_30d)}</b> ({row.n_fx_30d} fx)</div>'
            f'</td>'
        )

    # Trial banner (con color según state)
    trial_color = {'ACTIVE': GREEN_OK, 'WEEK_LEFT': ORANGE_WARN, 'EXPIRED': RED_BAD}[trial_state]
    trial_bg = {'ACTIVE': '#dcfce7', 'WEEK_LEFT': '#fef3c7', 'EXPIRED': '#fee2e2'}[trial_state]
    trial_banner = (
        f'<div style="background:{trial_bg};border-left:4px solid {trial_color};padding:10px 14px;margin:0 0 16px 0;border-radius:4px">'
        f'<div style="font-size:11px;font-weight:800;color:{trial_color};text-transform:uppercase;letter-spacing:.5px">Trial coverage PACHI</div>'
        f'<div style="font-size:13px;color:{NAVY_DARK};margin-top:4px">{trial_msg}</div>'
        f'<div style="font-size:11px;color:{MUTED};margin-top:2px">Vencimiento: {TRIAL_END.strftime("%d/%m/%Y")}</div>'
        f'</div>'
    )

    # Top clientes tabla
    if top_pachi:
        rows_html = ''
        for i, r in enumerate(top_pachi, 1):
            bg = '#f8fafc' if i % 2 == 0 else '#ffffff'
            rows_html += (
                f'<tr style="background:{bg}">'
                f'<td style="padding:6px 8px;font-size:11px;color:{MUTED}">{i}</td>'
                f'<td style="padding:6px 8px;font-size:12px;color:{NAVY};font-weight:600">{(r.cliente or r.card_code)[:40]}</td>'
                f'<td style="padding:6px 8px;font-size:11px;color:{MUTED};font-family:monospace">{r.card_code}</td>'
                f'<td style="padding:6px 8px;font-size:12px;color:{NAVY};text-align:right;font-weight:700">{fmt_ars(r.total_ars)}</td>'
                f'<td style="padding:6px 8px;font-size:11px;color:{MUTED};text-align:right">{r.n_fx} fx</td>'
                f'<td style="padding:6px 8px;font-size:11px;color:{MUTED};text-align:right">{r.ultima_fx.strftime("%d/%m") if r.ultima_fx else "-"}</td>'
                f'</tr>'
            )
        top_table = (
            f'<div style="margin-top:20px">'
            f'<div style="font-size:12px;font-weight:800;color:{NAVY};margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Top 10 clientes zona PACHI (últimos 30d)</div>'
            f'<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif">'
            f'<thead><tr style="background:{NAVY};color:#fff">'
            f'<th style="padding:6px 8px;font-size:11px;text-align:left">#</th>'
            f'<th style="padding:6px 8px;font-size:11px;text-align:left">Cliente</th>'
            f'<th style="padding:6px 8px;font-size:11px;text-align:left">CardCode</th>'
            f'<th style="padding:6px 8px;font-size:11px;text-align:right">Facturado</th>'
            f'<th style="padding:6px 8px;font-size:11px;text-align:right">Fx</th>'
            f'<th style="padding:6px 8px;font-size:11px;text-align:right">Última</th>'
            f'</tr></thead><tbody>{rows_html}</tbody></table></div>'
        )
    else:
        top_table = f'<div style="color:{MUTED};padding:12px;font-style:italic">Sin facturas zona PACHI en los últimos 30 días.</div>'

    html = f'''<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f5f7fa;font-family:Arial,sans-serif">
<div style="max-width:720px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
  <div style="border-bottom:3px solid {SHIMANO_CYAN};padding-bottom:12px;margin-bottom:20px">
    <div style="font-size:18px;font-weight:800;color:{NAVY}">SHIMANO · Reporte semanal coverage PACHI</div>
    <div style="font-size:12px;color:{MUTED};margin-top:4px">Semana al {today_str} · Facturación zona PACHI vs zona SANTI propia</div>
  </div>
  {trial_banner}
  <div style="font-size:12px;font-weight:800;color:{NAVY};margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Facturación por zona</div>
  <table style="width:100%;border-collapse:separate;border-spacing:8px 0"><tr>
    {kpi_block('Zona PACHI', pachi, RED_BAD)}
    {kpi_block('Zona SANTI propia', santi, SHIMANO_CYAN)}
  </tr></table>
  {top_table}
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:{MUTED};line-height:1.5">
    Reporte automático · Datos desde BigQuery <code>v_facturas_sap</code> con <code>coverage_by</code> (v862+).<br>
    Filtro: <code>assigned_vendor='SANTIAGO ESTEBAN' AND cancelled='tNO' AND doc_kind='INVOICE'</code>.<br>
    Trial coverage PACHI vence <b>{TRIAL_END.strftime("%d/%m/%Y")}</b>. Al vencer, decidir: oficializar a SANTI, buscar VDE Shimano o extender.
  </div>
</div>
</body></html>
'''
    return html


def send_email(html_body):
    if not GMAIL_APP_PASSWORD:
        log('[FATAL] GMAIL_APP_PASSWORD vacio')
        sys.exit(1)
    msg = EmailMessage()
    msg['Subject'] = f'Coverage PACHI · Semana al {datetime.now(TZ_AR).strftime("%d/%m/%Y")}'
    msg['From'] = MAIL_FROM
    msg['To'] = ', '.join(MAIL_TO)
    msg['Message-ID'] = make_msgid(domain='shimano.com.ar')
    msg.set_content('Reporte HTML. Usa un cliente que soporte HTML.')
    msg.add_alternative(html_body, subtype='html')
    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as s:
        s.login(MAIL_FROM, GMAIL_APP_PASSWORD)
        s.send_message(msg)
    log(f'[OK] Email enviado a {MAIL_TO}')


def main():
    log('=== send_pachi_coverage_report START ===')
    client = init_bq()
    log('BQ client ready')

    agg = query_coverage_agg(client)
    log(f'Agg rows: {len(agg)}')
    top = query_top_pachi_clientes(client)
    log(f'Top clientes PACHI: {len(top)}')

    trial_state, days_left, trial_msg = get_trial_status()
    log(f'Trial: {trial_state} · {days_left}d left · {trial_msg}')

    html = build_html(agg, top, trial_state, days_left, trial_msg)

    if DRY_RUN:
        out = '_dryrun_pachi_coverage.html'
        with open(out, 'w', encoding='utf-8') as f:
            f.write(html)
        log(f'[DRY-RUN] HTML escrito a {out}')
        return

    send_email(html)


if __name__ == '__main__':
    main()
