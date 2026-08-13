"""
Notify Waitlist New - cron cada 5 min
======================================

Se dispara cada 5 minutos. Lee docs de la coleccion `revision_waitlist`
que no tienen `notifiedEmailAt` seteado. Para cada uno:

  - Si el `ownerEmail` es un vendedor externo (VDE: Gonzalo, Federico,
    Mauricio, Martin), manda un email a:
      * pablo.gonzalez@shimano.com.ar  (gerente, siempre)
      * pareja interna (VDI):
          - Gonzalo/Federico -> ioannis.plakoudakis@shimano.com.ar
          - Mauricio/Martin  -> santiago.esteban@shimano.com.ar
    con el asunto y cuerpo definidos abajo.

  - Si el ownerEmail no es VDE (VDI, admin, gerente, etc.), NO manda
    email. Solo marca el doc como `notifiedEmailAt=now` con
    `notifiedEmailSkipped='not_vde'` para saltarlo en el proximo tick.

Post-envio, marca cada doc con `notifiedEmailAt=<server timestamp>`
para no duplicar mails en el proximo tick.

Env vars (GitHub Actions Secrets):
  FIREBASE_SERVICE_ACCOUNT   JSON del service account.
  GMAIL_APP_PASSWORD         App password de bot.shimano.pesca@gmail.com.
  MAIL_FROM                  bot.shimano.pesca@gmail.com (default).
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
from datetime import datetime
from email.message import EmailMessage
from email.utils import make_msgid
from zoneinfo import ZoneInfo

import firebase_admin
from firebase_admin import credentials, firestore

# ============================================================
# Config
# ============================================================
MAIL_FROM = os.environ.get("MAIL_FROM", "bot.shimano.pesca@gmail.com")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
FB_SA_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")

TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

PABLO = "pablo.gonzalez@shimano.com.ar"
IOANNIS = "ioannis.plakoudakis@shimano.com.ar"
SANTIAGO = "santiago.esteban@shimano.com.ar"

# Mapeo VDE -> pareja interna (VDI que controla su pedido).
VDE_TO_INTERNAL = {
    "gonzalo.de.la.rosa@shimano.com.ar": IOANNIS,
    "federico.castelanelli@shimano.com.ar": IOANNIS,
    "mauricio.gil@shimano.com.ar": SANTIAGO,
    "martin.boiero@shimano.com.ar": SANTIAGO,
}
# Nombre para mostrar en el mail (MAYUS como pidio el user).
VDE_DISPLAY_NAME = {
    "gonzalo.de.la.rosa@shimano.com.ar": "GONZALO",
    "federico.castelanelli@shimano.com.ar": "FEDERICO",
    "mauricio.gil@shimano.com.ar": "MAURICIO",
    "martin.boiero@shimano.com.ar": "MARTIN",
}

# Paleta Shimano (consistente con send_tablero_sar_email.py).
NAVY = "#1F3864"
LIGHT_BLUE = "#D9E1F2"
SHIMANO_CYAN = "#00A9E0"
MUTED = "#64748b"

APP_URL = "https://shimano-arg.github.io/app-vendedores/"


def die(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def init_firestore():
    if not FB_SA_JSON:
        die("FIREBASE_SERVICE_ACCOUNT vacio. Setear el secret en GitHub.")
    try:
        sa_dict = json.loads(FB_SA_JSON)
    except json.JSONDecodeError as e:
        die(f"FIREBASE_SERVICE_ACCOUNT no es JSON valido: {e}")
    cred = credentials.Certificate(sa_dict)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def build_email(vde_name: str, cliente: str, doc: dict) -> tuple[str, str, str]:
    """Devuelve (subject, plain_text, html)."""
    localidad = (doc.get("clientLocality") or "").strip()
    provincia = (doc.get("clientProvince") or "").strip()
    loc_prov = " ".join([x for x in [localidad, provincia] if x]).strip() or "-"
    items = doc.get("items") or []
    n_skus = len(items)
    total_unid = sum(int(it.get("qty") or 0) for it in items)
    created_at = doc.get("createdAt")
    fecha_str = "-"
    if created_at is not None:
        try:
            dt = created_at
            if hasattr(dt, "astimezone"):
                dt_local = dt.astimezone(TZ_AR)
            else:
                dt_local = datetime.fromtimestamp(dt.timestamp(), tz=TZ_AR)
            fecha_str = dt_local.strftime("%d/%m/%Y %H:%M")
        except Exception:
            fecha_str = "-"

    subject = f"[Shimano App] {vde_name} cargo un pedido en espera de {cliente}"

    # Texto: el mensaje literal pedido por el user + contexto.
    plain = (
        f"EL VENDEDOR {vde_name} CARGO UN PEDIDO DE \"{cliente}\" Y ESTA EN LA "
        f"LISTA DE ESPERA PARA SU CONTROL.\n\n"
        f"Detalle:\n"
        f"  Cliente:    {cliente}\n"
        f"  Ubicacion:  {loc_prov}\n"
        f"  Cargado:    {fecha_str} (AR)\n"
        f"  Items:      {n_skus} SKUs / {total_unid} unidades\n\n"
        f"Revisar en la app: {APP_URL}\n"
    )

    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        "<body style='margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f7fa;color:#0f172a'>"
        "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#f5f7fa;padding:20px 0'>"
        "<tr><td align='center'>"
        f"<table role='presentation' width='560' cellpadding='0' cellspacing='0' style='background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08)'>"
        f"<tr><td style='background:{NAVY};padding:18px 24px;color:#fff;font-size:16px;font-weight:800;letter-spacing:.5px'>SHIMANO - APP VENDEDORES</td></tr>"
        f"<tr><td style='padding:22px 24px 6px 24px;font-size:14px;line-height:1.5'>"
        f"<div style='background:{LIGHT_BLUE};border-left:4px solid {SHIMANO_CYAN};padding:14px 16px;border-radius:4px;font-weight:700;font-size:14.5px;color:{NAVY}'>"
        f"EL VENDEDOR <span style='font-weight:800'>{vde_name}</span> CARGO UN PEDIDO DE "
        f"<span style='font-weight:800'>\"{cliente}\"</span> Y ESTA EN LA LISTA DE ESPERA PARA SU CONTROL."
        "</div>"
        f"<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='margin-top:16px;font-size:13px'>"
        f"<tr><td style='color:{MUTED};padding:4px 0;width:110px'>Cliente:</td><td style='font-weight:700'>{cliente}</td></tr>"
        f"<tr><td style='color:{MUTED};padding:4px 0'>Ubicacion:</td><td>{loc_prov}</td></tr>"
        f"<tr><td style='color:{MUTED};padding:4px 0'>Cargado:</td><td>{fecha_str} (AR)</td></tr>"
        f"<tr><td style='color:{MUTED};padding:4px 0'>Items:</td><td>{n_skus} SKUs / {total_unid} unidades</td></tr>"
        "</table>"
        f"<div style='margin-top:22px;text-align:center'>"
        f"<a href='{APP_URL}' style='display:inline-block;background:{SHIMANO_CYAN};color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:13px;letter-spacing:.3px'>Revisar en la App</a>"
        "</div>"
        "</td></tr>"
        f"<tr><td style='padding:14px 24px;background:#f8fafc;color:{MUTED};font-size:11px;line-height:1.4'>"
        "Este mail es automatico. Se envia cada vez que un vendedor externo (Gonzalo, Federico, Mauricio, Martin) "
        "carga un pedido en la lista de espera. Recibido por Pablo (gerente) + pareja interna VDI. "
        "Para dejar de recibirlo, contactar al admin de la app."
        "</td></tr>"
        "</table></td></tr></table></body></html>"
    )

    return subject, plain, html


def send_email(subject: str, to_list: list[str], plain: str, html: str) -> None:
    if not GMAIL_APP_PASSWORD:
        die("GMAIL_APP_PASSWORD vacio. Setear el secret en GitHub.")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = MAIL_FROM
    msg["To"] = ", ".join(to_list)
    msg["Message-ID"] = make_msgid(domain="shimano.com.ar")
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        s.login(MAIL_FROM, GMAIL_APP_PASSWORD)
        s.send_message(msg)


def process(db) -> None:
    # Firestore no soporta "field does not exist" en query. Traemos todos
    # y filtramos client-side. La coleccion revision_waitlist es chica
    # (<200 docs esperados en steady state), asi que no hay overhead.
    docs = list(db.collection("revision_waitlist").stream())
    print(f"[notify_waitlist] {len(docs)} docs en revision_waitlist")

    to_notify = []
    to_skip = []
    for d in docs:
        data = d.to_dict() or {}
        if data.get("notifiedEmailAt"):
            continue  # ya notificado (o marcado skipped en corrida previa)
        owner_email = (data.get("ownerEmail") or "").strip().lower()
        if not owner_email:
            to_skip.append((d, "no_email"))
            continue
        if owner_email not in VDE_TO_INTERNAL:
            to_skip.append((d, "not_vde"))
            continue
        to_notify.append((d, data, owner_email))

    print(f"[notify_waitlist] {len(to_notify)} para notificar, {len(to_skip)} para skip")

    sent = 0
    for d, data, owner_email in to_notify:
        vde_name = VDE_DISPLAY_NAME[owner_email]
        internal = VDE_TO_INTERNAL[owner_email]
        cliente = (data.get("clientName") or "sin nombre").strip()
        subject, plain, html = build_email(vde_name, cliente, data)
        to_list = [PABLO, internal]
        try:
            send_email(subject, to_list, plain, html)
            print(f"[notify_waitlist] OK doc={d.id} vde={owner_email} cliente={cliente} -> {to_list}")
            d.reference.update(
                {
                    "notifiedEmailAt": firestore.SERVER_TIMESTAMP,
                    "notifiedEmailTo": to_list,
                    "notifiedEmailVde": vde_name,
                }
            )
            sent += 1
        except Exception as e:
            # No marcar como notificado -> se reintenta al proximo tick.
            print(f"::warning::[notify_waitlist] FAIL doc={d.id} err={e}", file=sys.stderr)

    for d, reason in to_skip:
        d.reference.update(
            {
                "notifiedEmailAt": firestore.SERVER_TIMESTAMP,
                "notifiedEmailSkipped": reason,
            }
        )

    print(f"[notify_waitlist] listo: sent={sent} skipped={len(to_skip)}")


def main() -> None:
    print(f"[notify_waitlist] start {datetime.now(TZ_AR).isoformat()}")
    db = init_firestore()
    process(db)


if __name__ == "__main__":
    main()
