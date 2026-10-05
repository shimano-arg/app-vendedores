"""BO daily audit: corre el detector de duplicacion backorder, guarda snapshot
en Firestore y manda email de resumen a mariano.erbino@shimano.com.ar.

Diseño:
- Reutiliza las funciones puras de scripts/audit_backorder_overlap.py (find_strict_duplicates,
  find_loose_overlaps, load_*). Un solo lugar donde vive la lógica, dos entradas
  (CLI local + CF scheduled).
- Guarda snapshot resumido en Firestore `audit_bo_snapshots/{YYYY-MM-DD}` para tendencia
  y comparación día-a-día. Append-only por fecha (idempotente dentro del día).
- Compara con snapshot del día anterior si existe:
  * nuevos STRICT unexpected  = pedidoIds que aparecen hoy y no ayer
  * nuevos LOOSE pares        = (cardCode, sku) que aparecen hoy y no ayer
- SIEMPRE manda email (incluso cuando está todo OK) para confirmar que el agente corrió.

Env vars esperadas (via GitHub Secrets):
- FIREBASE_SERVICE_ACCOUNT  JSON del SA de Firebase (acceso Firestore prod).
- GMAIL_APP_PASSWORD         App password de bot.shimano.pesca@gmail.com.
- MAIL_FROM                  Default bot.shimano.pesca@gmail.com.
- MAIL_TO                    Default mariano.erbino@shimano.com.ar.
"""

from __future__ import annotations

import os
import smtplib
import ssl
import sys
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

# Reusa las funciones puras del audit script.
from audit_backorder_overlap import (  # noqa: E402
    find_loose_overlaps,
    find_strict_duplicates,
    load_all_open_pedidos,
    load_app_backorder,
    load_sap_backorder,
    load_sap_by_client_sku,
)
from sync_sap_to_bigquery import init_firestore, parse_sa_json  # noqa: E402

MAIL_FROM = os.environ.get("MAIL_FROM", "bot.shimano.pesca@gmail.com")
MAIL_TO = os.environ.get("MAIL_TO", "mariano.erbino@shimano.com.ar")
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

SNAPSHOT_COLLECTION = "audit_bo_snapshots"


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _yesterday_key() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")


def _build_summary(strict: list, loose: list) -> dict:
    """Resumen plano serializable para Firestore (sin objetos complejos)."""
    strict_unexpected = [p for p in strict if not p.get("is_expected_split")]
    strict_expected = [p for p in strict if p.get("is_expected_split")]
    return {
        "strict_unexpected_count": len(strict_unexpected),
        "strict_expected_count": len(strict_expected),
        "strict_unexpected_pedido_ids": sorted(p["pedidoId"] for p in strict_unexpected),
        "strict_expected_pedido_ids": sorted(p["pedidoId"] for p in strict_expected),
        "loose_count": len(loose),
        "loose_pairs": sorted(f"{e['clientCardCode']}::{e['sku']}" for e in loose),
    }


def _diff_vs_previous(today: dict, previous: dict | None) -> dict:
    """Nuevos STRICT unexpected y nuevos LOOSE pares vs snapshot anterior.

    Si no hay snapshot anterior, retorna None en los campos de delta (primer día
    o salto de días por outage de GH Actions).
    """
    if not previous:
        return {
            "has_previous": False,
            "new_strict_unexpected": [],
            "new_loose_pairs": [],
            "resolved_strict_unexpected": [],
        }
    prev_strict_ids = set(previous.get("strict_unexpected_pedido_ids") or [])
    prev_loose = set(previous.get("loose_pairs") or [])
    today_strict_ids = set(today["strict_unexpected_pedido_ids"])
    today_loose = set(today["loose_pairs"])
    return {
        "has_previous": True,
        "new_strict_unexpected": sorted(today_strict_ids - prev_strict_ids),
        "new_loose_pairs": sorted(today_loose - prev_loose),
        "resolved_strict_unexpected": sorted(prev_strict_ids - today_strict_ids),
    }


def _severity_icon(today: dict, diff: dict) -> str:
    """Devuelve el icono para el subject según severidad."""
    if today["strict_unexpected_count"] > 0:
        return "🔴"
    if diff["has_previous"] and len(diff["new_loose_pairs"]) >= 20:
        return "🟡"
    return "🟢"


def _render_html(today: dict, diff: dict, strict: list, loose: list, totals: dict) -> str:
    date = _today_key()
    icon = _severity_icon(today, diff)

    def _list_block(items: list, max_show: int = 10) -> str:
        if not items:
            return "<li><em>Ninguno.</em></li>"
        parts = [f"<li><code>{x}</code></li>" for x in items[:max_show]]
        if len(items) > max_show:
            parts.append(f"<li><em>... y {len(items) - max_show} más.</em></li>")
        return "".join(parts)

    strict_unexp = [p for p in strict if not p.get("is_expected_split")]
    strict_unexp_rows = "".join(
        f"<tr><td><code>{p['pedidoId']}</code></td>"
        f"<td>{(p.get('clientCardCode') or '')}</td>"
        f"<td>{(p.get('clientName') or '')[:40]}</td>"
        f"<td>{(p.get('via') or '')}</td>"
        f"<td>{', '.join(s['sku'] for s in p['dup_skus'])}</td></tr>"
        for p in strict_unexp
    ) or "<tr><td colspan='5'><em>Ninguno.</em></td></tr>"

    delta_prev = ""
    if diff["has_previous"]:
        delta_prev = f"""
        <h3>Delta vs ayer</h3>
        <ul>
          <li><b>Nuevos STRICT unexpected:</b> {len(diff['new_strict_unexpected'])}</li>
          <ul>{_list_block(diff['new_strict_unexpected'])}</ul>
          <li><b>Nuevos pares LOOSE:</b> {len(diff['new_loose_pairs'])}</li>
          <ul>{_list_block(diff['new_loose_pairs'])}</ul>
          <li><b>STRICT unexpected resueltos:</b> {len(diff['resolved_strict_unexpected'])}</li>
          <ul>{_list_block(diff['resolved_strict_unexpected'])}</ul>
        </ul>
        """
    else:
        delta_prev = "<p><em>Sin snapshot de ayer para comparar (primer día o gap).</em></p>"

    return f"""
    <div style="font-family: Arial, sans-serif; color: #222; max-width: 800px;">
      <h2>{icon} BO Daily Audit — {date}</h2>
      <p>Agente automático que verifica duplicación de backorder en producción.
      Reutiliza <code>scripts/audit_backorder_overlap.py</code> (detector v1130 split-aware).</p>

      <h3>Totales de hoy</h3>
      <ul>
        <li><b>SAP-source:</b> {totals['sap_source_skus']} SKUs / {totals['sap_source_qty']:.0f}u</li>
        <li><b>APP-source:</b> {totals['app_source_skus']} SKUs / {totals['app_source_qty']:.0f}u</li>
        <li><b>Pedidos abiertos con transferidoSAP:</b> {totals['pedidos_open']}</li>
      </ul>

      <h3>Findings</h3>
      <ul>
        <li>🔴 <b>STRICT unexpected:</b> {today['strict_unexpected_count']}
            (duplicación real, requiere acción si > 0)</li>
        <li>ℹ️ <b>STRICT expected (split v600+):</b> {today['strict_expected_count']}
            (comportamiento esperado, no es bug)</li>
        <li>🟡 <b>LOOSE pares (cardCode, SKU) en ambas fuentes:</b> {today['loose_count']}
            (mayoría demanda legítima, revisar deltas grandes)</li>
      </ul>

      {delta_prev}

      <h3>STRICT unexpected (detalle)</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; font-size: 13px;">
        <tr style="background-color: #1F4E79; color: #fff;">
          <th>pedidoId</th><th>cardCode</th><th>cliente</th><th>via</th><th>SKUs</th>
        </tr>
        {strict_unexp_rows}
      </table>

      <p style="margin-top: 20px; font-size: 12px; color: #888;">
        Snapshot guardado en Firestore <code>{SNAPSHOT_COLLECTION}/{date}</code>.
        Para auditar manualmente: <code>python scripts/audit_backorder_overlap_adc.py</code>.
      </p>
    </div>
    """


def _send_email(subject: str, html: str) -> None:
    if not SMTP_PASSWORD:
        raise RuntimeError("Falta GMAIL_APP_PASSWORD en env")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = MAIL_FROM
    msg["To"] = MAIL_TO
    msg.set_content("Tu cliente de email no soporta HTML. Abri el reporte en Firebase Console.")
    msg.add_alternative(html, subtype="html")
    ctx = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ctx)
        smtp.ehlo()
        smtp.login(MAIL_FROM, SMTP_PASSWORD)
        smtp.send_message(msg)


def main() -> int:
    sa = parse_sa_json()
    db = init_firestore(sa)

    # Audit
    sap_bo_sku = load_sap_backorder(db)
    app_bo_sku, app_bo_by_client = load_app_backorder(db)
    sap_by_client_sku = load_sap_by_client_sku(db)
    pedidos = load_all_open_pedidos(db)

    strict = find_strict_duplicates(pedidos, min_qty=0.0)
    loose = find_loose_overlaps(sap_by_client_sku, app_bo_by_client, min_qty=0.0)

    today_summary = _build_summary(strict, loose)
    today_key = _today_key()

    totals = {
        "sap_source_skus": sum(1 for v in sap_bo_sku.values() if float(v or 0) > 0),
        "sap_source_qty": sum(float(v or 0) for v in sap_bo_sku.values() if float(v or 0) > 0),
        "app_source_skus": sum(1 for v in app_bo_sku.values() if float(v or 0) > 0),
        "app_source_qty": sum(float(v or 0) for v in app_bo_sku.values() if float(v or 0) > 0),
        "pedidos_open": len(pedidos),
    }

    # Compara con snapshot ayer.
    prev_doc = db.collection(SNAPSHOT_COLLECTION).document(_yesterday_key()).get()
    previous = prev_doc.to_dict() if prev_doc.exists else None
    diff = _diff_vs_previous(today_summary, previous)

    # Guarda snapshot (idempotente dentro del día).
    db.collection(SNAPSHOT_COLLECTION).document(today_key).set({
        **today_summary,
        **totals,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })

    # Email siempre.
    icon = _severity_icon(today_summary, diff)
    subject = (
        f"{icon} BO Audit {today_key}: "
        f"{today_summary['strict_unexpected_count']} STRICT unexp, "
        f"{today_summary['loose_count']} LOOSE"
    )
    if diff["has_previous"] and diff["new_strict_unexpected"]:
        subject += f" (+{len(diff['new_strict_unexpected'])} nuevos)"

    html = _render_html(today_summary, diff, strict, loose, totals)
    _send_email(subject, html)
    print(f"OK  snapshot={today_key}  strict_unexp={today_summary['strict_unexpected_count']}  loose={today_summary['loose_count']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
