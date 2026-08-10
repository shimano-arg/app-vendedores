"""
Send Tablero SAR Email — cron L-V 17:00 hora Argentina
======================================================

Genera un mail HTML con branding Shimano que resume el desempeño diario
de ventas SAR (Shimano Argentina). Reemplaza el mail que enviaba la
suscripción de Power BI Service (template fijo, sin branding).

Envío: bot.shimano.pesca@gmail.com  →  MAIL_TO (mariano.erbino@shimano.com.ar
por default; ampliable via env var).

Métricas incluidas (5 bloques):
  1) Facturación de hoy + acumulado mes vs target + saldo pendiente.
  2) Top 5 clientes del día (por monto).
  3) Ranking vendedores del mes (top 10, por monto acumulado).
  4) Top 5 SKUs del día (por monto).

Fuente de datos: BigQuery
  - v_facturas_sap        facturas SAP con doc_total, saldo, assigned_vendor
  - v_ventas_lineas       líneas de ventas con item_code, cantidad, importe
  - v_targets             targets mensuales por vendedor

Filtro: excluye facturas canceladas (cancelled = tYES) y notas de crédito
(v_facturas_sap ya trae solo doc_kind = INVOICE / TAX_INVOICE).

Env vars requeridas (GitHub Actions Secrets):
  FIREBASE_SERVICE_ACCOUNT   JSON del service account (misma cuenta con rol
                             BigQuery Data Viewer + Studio User que usan los
                             otros syncs).
  GMAIL_APP_PASSWORD         App password 16 chars de bot.shimano.pesca@gmail.com.
  MAIL_FROM                  bot.shimano.pesca@gmail.com
  MAIL_TO                    mariano.erbino@shimano.com.ar (comma-sep si son varios)
  POWERBI_REPORT_URL         (opcional) URL del report completo para el botón CTA.
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
from datetime import datetime
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path
from zoneinfo import ZoneInfo

from google.cloud import bigquery
from google.oauth2 import service_account

# ============================================================
# Config
# ============================================================
BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'

MAIL_FROM = os.environ.get('MAIL_FROM', 'bot.shimano.pesca@gmail.com')
MAIL_TO_RAW = os.environ.get('MAIL_TO', 'mariano.erbino@shimano.com.ar')
MAIL_TO = [x.strip() for x in MAIL_TO_RAW.split(',') if x.strip()]
GMAIL_APP_PASSWORD = os.environ.get('GMAIL_APP_PASSWORD', '')
FB_SA_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '')
POWERBI_REPORT_URL = os.environ.get(
    'POWERBI_REPORT_URL',
    'https://app.powerbi.com/'
)

TZ_AR = ZoneInfo('America/Argentina/Buenos_Aires')

# Paleta Shimano (matcheo con el resto de reportes al equipo comercial)
NAVY = '#1F3864'
NAVY_DARK = '#0F172A'
LIGHT_BLUE = '#D9E1F2'
SHIMANO_CYAN = '#00A9E0'
GREEN_OK = '#10b981'
ORANGE_WARN = '#f59e0b'
RED_BAD = '#dc2626'
MUTED = '#64748b'

MESES_ES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
DIAS_ES = [
    'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
]


def log(msg: str) -> None:
    ts = datetime.now(TZ_AR).strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


# ============================================================
# Encoding fix: los strings del catálogo SAP tienen bytes latin-1 leídos
# como UTF-8 → aparecen U+FFFD (�). Mismo hack que bigquery/views.sql:773+.
# ============================================================
_ENCODING_REPLACEMENTS = [
    ('Ca�as', 'Cañas'),
    ('Ca�a', 'Caña'),
    ('Tama�o', 'Tamaño'),
    ('Se�uelo', 'Señuelo'),
    ('Se�or', 'Señor'),
    ('Acci�n', 'Acción'),
    ('visi�n', 'visión'),
    ('Multifunci�n', 'Multifunción'),
    ('C�digo', 'Código'),
    ('Jap�n', 'Japón'),
    ('Telesc�pica', 'Telescópica'),
    ('Se�al', 'Señal'),
    ('a�os', 'años'),
    ('a�o', 'año'),
    ('R�pida', 'Rápida'),
    ('R�pido', 'Rápido'),
    ('Pesca�', 'Pesca'),
    ('CA�AS', 'CAÑAS'),
    ('DISE�O', 'DISEÑO'),
    ('�', ''),  # fallback: dropear cualquier otro replacement char
]


def clean_text(s):
    if s is None:
        return ''
    out = str(s)
    for old, new in _ENCODING_REPLACEMENTS:
        out = out.replace(old, new)
    return out


def fmt_ars(n) -> str:
    """Formato ARS: $12.345.678 (sin decimales, separador miles = punto)."""
    if n is None:
        return '$0'
    n = float(n)
    # Formato AR: miles con punto, decimales con coma. Usamos int (sin decimales).
    return '$' + '{:,.0f}'.format(round(n)).replace(',', '.')


def fmt_int(n) -> str:
    if n is None:
        return '0'
    return '{:,.0f}'.format(round(float(n))).replace(',', '.')


def fmt_pct(pct: float) -> str:
    return f'{pct:.1f}%'


# ============================================================
# BQ queries
# ============================================================
def bq_client() -> bigquery.Client:
    if not FB_SA_JSON:
        raise SystemExit('[ERROR] FIREBASE_SERVICE_ACCOUNT no seteada')
    sa = json.loads(FB_SA_JSON)
    creds = service_account.Credentials.from_service_account_info(sa)
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


def fetch_kpis(client: bigquery.Client) -> dict:
    """Retorna un dict con las 5 métricas listas para render."""
    log('[BQ] fetch KPIs...')

    q_totales = """
        DECLARE hoy DATE DEFAULT CURRENT_DATE('America/Argentina/Buenos_Aires');
        SELECT
          COUNTIF(doc_date = hoy) AS facturas_hoy,
          ROUND(SUM(IF(doc_date = hoy, doc_total, 0)), 0) AS monto_hoy,
          COUNTIF(doc_date >= DATE_TRUNC(hoy, MONTH)) AS facturas_mes,
          ROUND(SUM(IF(doc_date >= DATE_TRUNC(hoy, MONTH), doc_total, 0)), 0) AS monto_mes,
          ROUND(SUM(IF(doc_date >= DATE_TRUNC(hoy, MONTH), saldo_ars, 0)), 0) AS saldo_mes,
          EXTRACT(YEAR FROM hoy) AS anio,
          EXTRACT(MONTH FROM hoy) AS mes
        FROM `app-vendedores-shimano.shimano_app.v_facturas_sap`
        WHERE doc_date >= DATE_TRUNC(hoy, MONTH)
          AND COALESCE(cancelled, 'tNO') = 'tNO'
    """
    totales = dict(next(iter(client.query(q_totales).result())))
    log(f'  totales: {totales}')

    q_target = f"""
        SELECT ROUND(SUM(target_ars), 0) AS target_ars
        FROM `app-vendedores-shimano.shimano_app.v_targets`
        WHERE anio = {int(totales['anio'])} AND mes = {int(totales['mes'])}
    """
    target_row = next(iter(client.query(q_target).result()), None)
    target_ars = float(dict(target_row).get('target_ars') or 0) if target_row else 0
    log(f'  target mes: {target_ars}')

    q_clientes = """
        DECLARE hoy DATE DEFAULT CURRENT_DATE('America/Argentina/Buenos_Aires');
        SELECT
          card_code,
          COALESCE(card_name_bp, card_name_invoice, '(sin nombre)') AS cliente,
          ROUND(SUM(doc_total), 0) AS monto,
          COUNT(*) AS n_facturas
        FROM `app-vendedores-shimano.shimano_app.v_facturas_sap`
        WHERE doc_date = hoy AND COALESCE(cancelled, 'tNO') = 'tNO'
        GROUP BY card_code, cliente
        ORDER BY monto DESC LIMIT 5
    """
    top_clientes = [dict(r) for r in client.query(q_clientes).result()]

    q_vendedores = """
        DECLARE hoy DATE DEFAULT CURRENT_DATE('America/Argentina/Buenos_Aires');
        SELECT
          COALESCE(assigned_vendor, '(SIN ASIGNAR)') AS vendedor,
          ROUND(SUM(IF(doc_date = hoy, doc_total, 0)), 0) AS monto_hoy,
          ROUND(SUM(doc_total), 0) AS monto_mes,
          COUNT(*) AS n_facturas_mes
        FROM `app-vendedores-shimano.shimano_app.v_facturas_sap`
        WHERE doc_date >= DATE_TRUNC(hoy, MONTH)
          AND COALESCE(cancelled, 'tNO') = 'tNO'
        GROUP BY vendedor ORDER BY monto_mes DESC LIMIT 10
    """
    ranking_vendedores = [dict(r) for r in client.query(q_vendedores).result()]

    q_skus = """
        DECLARE hoy DATE DEFAULT CURRENT_DATE('America/Argentina/Buenos_Aires');
        SELECT
          item_code AS sku,
          MAX(item_name_catalogo) AS producto,
          MAX(familia) AS familia,
          ROUND(SUM(cantidad), 0) AS unidades,
          ROUND(SUM(importe_linea_ars), 0) AS monto_ars
        FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
        WHERE doc_date = hoy AND item_code IS NOT NULL AND doc_kind = 'INVOICE'
        GROUP BY sku ORDER BY monto_ars DESC LIMIT 5
    """
    top_skus = [dict(r) for r in client.query(q_skus).result()]

    return {
        'totales': totales,
        'target_ars': target_ars,
        'top_clientes': top_clientes,
        'ranking_vendedores': ranking_vendedores,
        'top_skus': top_skus,
    }


# ============================================================
# HTML template
# ============================================================
def render_html(kpis: dict, logo_cid: str) -> str:
    t = kpis['totales']
    monto_hoy = float(t.get('monto_hoy') or 0)
    monto_mes = float(t.get('monto_mes') or 0)
    saldo_mes = float(t.get('saldo_mes') or 0)
    target = float(kpis['target_ars'] or 0)
    pct_target = (monto_mes / target * 100) if target > 0 else 0
    facturas_hoy = int(t.get('facturas_hoy') or 0)
    facturas_mes = int(t.get('facturas_mes') or 0)

    # Color del % cumplimiento según ritmo del mes (día X de 22 hábiles ≈)
    hoy = datetime.now(TZ_AR)
    dia_mes = hoy.day
    pct_esperado = (dia_mes / 30) * 100  # aproximación simple
    if pct_target >= pct_esperado:
        color_pct = GREEN_OK
        emoji_pct = '✅'
    elif pct_target >= pct_esperado * 0.8:
        color_pct = ORANGE_WARN
        emoji_pct = '⚠️'
    else:
        color_pct = RED_BAD
        emoji_pct = '🔴'

    fecha_str = f'{DIAS_ES[hoy.weekday()].capitalize()} {hoy.day} de {MESES_ES[hoy.month - 1]}, {hoy.year}'
    hora_str = hoy.strftime('%H:%M')

    # ---------- Top clientes ----------
    if kpis['top_clientes']:
        rows_clientes = ''.join(
            f'''<tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#0f172a">
                <strong>{i + 1}.</strong> {clean_text(c['cliente'])[:52]}
                <div style="font-size:10px;color:{MUTED};margin-top:2px;font-family:monospace">{c['card_code']}</div>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;font-weight:700;color:{NAVY};white-space:nowrap">{fmt_ars(c['monto'])}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;color:{MUTED}">{c['n_facturas']}</td>
            </tr>'''
            for i, c in enumerate(kpis['top_clientes'])
        )
    else:
        rows_clientes = f'<tr><td colspan="3" style="padding:20px;text-align:center;color:{MUTED};font-size:12px">Sin facturas hoy todavía.</td></tr>'

    # ---------- Ranking vendedores ----------
    max_monto_mes = max((float(v['monto_mes'] or 0) for v in kpis['ranking_vendedores']), default=1)
    rows_vend = ''
    for i, v in enumerate(kpis['ranking_vendedores']):
        monto_v = float(v['monto_mes'] or 0)
        pct_bar = (monto_v / max_monto_mes * 100) if max_monto_mes > 0 else 0
        medal = '🥇' if i == 0 else '🥈' if i == 1 else '🥉' if i == 2 else f'<span style="color:{MUTED}">{i + 1}</span>'
        vend_hoy = float(v['monto_hoy'] or 0)
        rows_vend += f'''<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#0f172a;width:40px;text-align:center;font-size:18px">{medal}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#0f172a;font-weight:600">
            {clean_text(v['vendedor'])}
            <div style="height:6px;background:#f1f5f9;border-radius:3px;margin-top:4px;overflow:hidden">
              <div style="height:100%;background:linear-gradient(90deg,{SHIMANO_CYAN},{NAVY});width:{pct_bar:.1f}%"></div>
            </div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;font-weight:700;color:{NAVY};white-space:nowrap">
            {fmt_ars(monto_v)}
            <div style="font-size:10px;color:{MUTED};font-weight:400;margin-top:2px">hoy: {fmt_ars(vend_hoy)}</div>
          </td>
        </tr>'''

    if not rows_vend:
        rows_vend = f'<tr><td colspan="3" style="padding:20px;text-align:center;color:{MUTED};font-size:12px">Sin datos.</td></tr>'

    # ---------- Top SKUs ----------
    if kpis['top_skus']:
        rows_skus = ''.join(
            f'''<tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#0f172a">
                <span style="font-family:monospace;font-weight:700;color:{NAVY}">{s['sku']}</span>
                <div style="font-size:11px;color:#334155;margin-top:2px;line-height:1.3">{clean_text(s.get('producto') or '')[:70]}</div>
                <div style="font-size:9px;color:{MUTED};margin-top:2px;text-transform:uppercase;letter-spacing:.3px">{clean_text(s.get('familia') or '')}</div>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:14px;font-weight:800;color:{NAVY}">{fmt_int(s['unidades'])}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;font-weight:700;color:{NAVY};white-space:nowrap">{fmt_ars(s['monto_ars'])}</td>
            </tr>'''
            for s in kpis['top_skus']
        )
    else:
        rows_skus = f'<tr><td colspan="3" style="padding:20px;text-align:center;color:{MUTED};font-size:12px">Sin ventas hoy todavía.</td></tr>'

    html = f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tablero SAR — Desempeño diario ventas</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:20px 12px">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 20px rgba(15,23,42,.08)">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,{NAVY_DARK},{NAVY});padding:24px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle">
              <img src="cid:{logo_cid}" alt="Shimano" width="120" style="display:block;height:auto"/>
            </td>
            <td style="vertical-align:middle;text-align:right">
              <div style="color:{SHIMANO_CYAN};font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Tablero SAR · Pesca</div>
              <div style="color:#fff;font-size:12px;font-weight:500">{fecha_str}</div>
              <div style="color:#94a3b8;font-size:10px;margin-top:2px">Actualizado {hora_str} ART</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Título principal -->
      <tr><td style="padding:28px 28px 8px">
        <div style="font-size:11px;font-weight:700;color:{SHIMANO_CYAN};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Resumen diario</div>
        <h1 style="margin:0;font-size:24px;font-weight:800;color:{NAVY_DARK};line-height:1.2">Desempeño de ventas al {hoy.day}/{hoy.month:02d}</h1>
        <p style="margin:8px 0 0;color:{MUTED};font-size:13px;line-height:1.5">Snapshot desde SAP B1 → BigQuery. Reemplaza al mail automático de Power BI con un resumen ejecutivo para lectura rápida.</p>
      </td></tr>

      <!-- KPI hero -->
      <tr><td style="padding:20px 28px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#f8fafc,#e2e8f0);border-radius:10px;padding:0">
          <tr>
            <td width="50%" style="padding:20px 20px;border-right:1px solid #cbd5e1">
              <div style="font-size:10px;font-weight:800;color:{MUTED};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">Facturado hoy</div>
              <div style="font-size:26px;font-weight:900;color:{NAVY};line-height:1">{fmt_ars(monto_hoy)}</div>
              <div style="font-size:11px;color:{MUTED};margin-top:4px">{facturas_hoy} facturas emitidas</div>
            </td>
            <td width="50%" style="padding:20px 20px">
              <div style="font-size:10px;font-weight:800;color:{MUTED};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px">Acumulado mes</div>
              <div style="font-size:26px;font-weight:900;color:{NAVY};line-height:1">{fmt_ars(monto_mes)}</div>
              <div style="font-size:11px;color:{MUTED};margin-top:4px">{facturas_mes} facturas · saldo: {fmt_ars(saldo_mes)}</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Target progress -->
      <tr><td style="padding:14px 28px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;padding:0">
          <tr><td style="padding:16px 20px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:10px;font-weight:800;color:{MUTED};letter-spacing:1.2px;text-transform:uppercase">Cumplimiento del mes</div>
                  <div style="font-size:14px;font-weight:600;color:#0f172a;margin-top:4px">{fmt_ars(monto_mes)} <span style="color:{MUTED};font-weight:400">/ target {fmt_ars(target)}</span></div>
                </td>
                <td style="text-align:right">
                  <div style="font-size:22px;font-weight:900;color:{color_pct}">{emoji_pct} {fmt_pct(pct_target)}</div>
                </td>
              </tr>
            </table>
            <div style="height:10px;background:#e5e7eb;border-radius:5px;margin-top:12px;overflow:hidden">
              <div style="height:100%;background:linear-gradient(90deg,{color_pct},{color_pct});width:{min(pct_target, 100):.1f}%"></div>
            </div>
          </td></tr>
        </table>
      </td></tr>

      <!-- Sección: Top clientes -->
      <tr><td style="padding:28px 28px 0">
        <div style="font-size:11px;font-weight:800;color:{NAVY};letter-spacing:1.2px;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid {SHIMANO_CYAN};margin-bottom:12px">🏆 Top 5 clientes de hoy</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:{NAVY}">
              <th style="padding:10px 12px;text-align:left;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Cliente</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Monto</th>
              <th style="padding:10px 12px;text-align:center;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Fact.</th>
            </tr>
          </thead>
          <tbody>{rows_clientes}</tbody>
        </table>
      </td></tr>

      <!-- Sección: Ranking vendedores -->
      <tr><td style="padding:28px 28px 0">
        <div style="font-size:11px;font-weight:800;color:{NAVY};letter-spacing:1.2px;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid {SHIMANO_CYAN};margin-bottom:12px">🎯 Ranking vendedores del mes</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:{NAVY}">
              <th style="padding:10px 12px;text-align:center;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase;width:40px">#</th>
              <th style="padding:10px 12px;text-align:left;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Vendedor</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Mes</th>
            </tr>
          </thead>
          <tbody>{rows_vend}</tbody>
        </table>
      </td></tr>

      <!-- Sección: Top SKUs -->
      <tr><td style="padding:28px 28px 0">
        <div style="font-size:11px;font-weight:800;color:{NAVY};letter-spacing:1.2px;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid {SHIMANO_CYAN};margin-bottom:12px">🎣 Top 5 SKUs vendidos hoy</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:{NAVY}">
              <th style="padding:10px 12px;text-align:left;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Producto</th>
              <th style="padding:10px 12px;text-align:center;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Unid.</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#fff;font-weight:800;letter-spacing:.5px;text-transform:uppercase">Monto</th>
            </tr>
          </thead>
          <tbody>{rows_skus}</tbody>
        </table>
      </td></tr>

      <!-- CTA -->
      <tr><td style="padding:32px 28px 20px;text-align:center">
        <a href="{POWERBI_REPORT_URL}" style="display:inline-block;background:{NAVY};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:13px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 4px 12px rgba(31,56,100,.25)">
          Abrir tablero completo en Power BI →
        </a>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:20px 28px 24px;border-top:1px solid #e5e7eb;background:#f8fafc;text-align:center">
        <div style="font-size:10px;color:{MUTED};line-height:1.5">
          Este correo se genera automáticamente cada día hábil a las 17:00 ART.<br>
          Datos: SAP B1 → BigQuery. Excluye facturas canceladas.<br>
          Repo: <a href="https://github.com/shimano-arg/app-vendedores" style="color:{NAVY};text-decoration:none">shimano-arg/app-vendedores</a> · script: <code>scripts/send_tablero_sar_email.py</code>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>
'''
    return html


# ============================================================
# Send
# ============================================================
def send_email(html: str, kpis: dict, logo_cid: str, logo_bytes: bytes) -> None:
    if not GMAIL_APP_PASSWORD:
        raise SystemExit('[ERROR] GMAIL_APP_PASSWORD no seteada')
    if not MAIL_TO:
        raise SystemExit('[ERROR] MAIL_TO vacío')

    hoy = datetime.now(TZ_AR)
    monto_hoy = float(kpis['totales'].get('monto_hoy') or 0)
    subject = f'Tablero SAR · {hoy.day}/{hoy.month:02d} · {fmt_ars(monto_hoy)} facturado hoy'

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = MAIL_FROM
    msg['To'] = ', '.join(MAIL_TO)

    # Plain text fallback para clientes que no renderizan HTML
    monto_mes = float(kpis['totales'].get('monto_mes') or 0)
    plain = f'''Tablero SAR — Desempeño diario ventas PESCA
{hoy.strftime('%d/%m/%Y')}

Facturado hoy:       {fmt_ars(monto_hoy)} ({int(kpis['totales'].get('facturas_hoy') or 0)} facturas)
Acumulado del mes:   {fmt_ars(monto_mes)}
Target del mes:      {fmt_ars(kpis['target_ars'])}

Este correo se ve mejor en HTML. Abrí el tablero completo en Power BI: {POWERBI_REPORT_URL}
'''
    msg.set_content(plain)
    msg.add_alternative(html, subtype='html')

    # Attach logo inline (CID)
    logo_part = msg.get_payload()[-1]  # el HTML part
    logo_part.add_related(
        logo_bytes,
        maintype='image',
        subtype='png',
        cid=f'<{logo_cid}>',
    )

    log(f'[SMTP] enviando a {MAIL_TO}... subject={subject!r}')
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=30) as smtp:
        smtp.login(MAIL_FROM, GMAIL_APP_PASSWORD)
        smtp.send_message(msg)
    log('[SMTP] OK')


# ============================================================
# Main
# ============================================================
def main() -> int:
    log('=== send_tablero_sar_email START ===')
    client = bq_client()
    kpis = fetch_kpis(client)

    # Logo (opcional, si no está simplemente omite el img — usa alt text).
    repo_root = Path(__file__).parent.parent
    logo_path = repo_root / 'Shimano-Logo.png'
    logo_bytes = logo_path.read_bytes() if logo_path.exists() else b''
    logo_cid = make_msgid(domain='shimano.local')[1:-1]  # strip <>

    html = render_html(kpis, logo_cid)

    if os.environ.get('DRY_RUN', '').lower() == 'true':
        out = repo_root / '_dryrun_tablero_sar.html'
        out.write_text(html, encoding='utf-8')
        log(f'[DRY_RUN] HTML escrito a {out} (no envía mail)')
        return 0

    send_email(html, kpis, logo_cid, logo_bytes)
    log('=== DONE ===')
    return 0


if __name__ == '__main__':
    sys.exit(main())
