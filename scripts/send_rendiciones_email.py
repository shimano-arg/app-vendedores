"""
Send Rendiciones Aprobadas - cron Lun/Mie 9 AM AR
==================================================

Lee Firestore las rendiciones que estan APROBADAS y aun no notificadas
(notifiedAt == null), arma un Excel y lo manda por mail al admin.
Despues marca cada rendicion como notifiedAt=now para no duplicar.

Variables de entorno (cargadas por GitHub Actions):
    FIREBASE_SERVICE_ACCOUNT  JSON del service account (string).
    GMAIL_APP_PASSWORD        16 chars del App Password.
    MAIL_FROM                 bot.shimano.pesca@gmail.com
    MAIL_TO                   mariano.erbino@shimano.com.ar

Logica:
  1. Conectarse a Firestore con el service account.
  2. Query: collection 'rendiciones' where status='approved'
     and (notifiedAt does not exist OR notifiedAt is null).
  3. Generar Excel con 2 hojas: Gastos + Solicitudes.
  4. Si hay >= 1 rendicion para notificar, mandar mail con el xlsx
     adjunto. Si no hay nada, salir sin mandar mail (evita spam).
  5. Marcar las notificadas en batch.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import smtplib
import sys
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, storage
from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

MAIL_FROM = os.environ.get("MAIL_FROM", "bot.shimano.pesca@gmail.com")
MAIL_TO = os.environ.get("MAIL_TO", "mariano.erbino@shimano.com.ar")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
FB_SA_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")

def _envbool(name: str) -> bool:
    return (os.environ.get(name, "") or "").strip().lower() in ("1", "true", "yes", "on")

FORCE_SEND = _envbool("FORCE_SEND")  # ignora filtro notifiedAt
SKIP_MARK = _envbool("SKIP_MARK")    # NO marca como notificadas (testing)


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
    project_id = sa_dict.get("project_id", "")
    # Default storage bucket: <project-id>.appspot.com (convencion Firebase).
    # Si el bucket esta deshabilitado, el upload falla y caemos al fallback
    # de embeber thumbnail en Excel.
    storage_bucket = f"{project_id}.appspot.com" if project_id else None
    cred = credentials.Certificate(sa_dict)
    options = {"storageBucket": storage_bucket} if storage_bucket else None
    firebase_admin.initialize_app(cred, options)
    return firestore.client()


def upload_foto_to_storage(rendicion_id: str, foto_dataurl: str):
    """Sube la foto a Firebase Storage en un path predecible y devuelve la URL
    publica permanente. None si no se pudo (storage deshabilitado o foto
    corrupta)."""
    if not foto_dataurl or not isinstance(foto_dataurl, str):
        return None
    try:
        m = re.match(r"^data:image/([\w+]+);base64,(.+)$", foto_dataurl, re.IGNORECASE)
        if m:
            ext = m.group(1).lower()
            b64_data = m.group(2)
        else:
            # No es dataURL: asumir base64 puro + jpeg.
            ext = "jpeg"
            b64_data = foto_dataurl
        if ext == "jpg":
            ext = "jpeg"
        raw = base64.b64decode(b64_data)
        bucket = storage.bucket()
        blob = bucket.blob(f"rendiciones-tickets/{rendicion_id}.{ext}")
        blob.upload_from_string(raw, content_type=f"image/{ext}")
        blob.make_public()
        return blob.public_url
    except Exception as e:
        print(f"[storage] no pude subir foto {rendicion_id}: {e}", file=sys.stderr)
        return None


def fetch_pending_approved(db):
    """Query rendiciones aprobadas. Si FORCE_SEND, traemos todas las
    aprobadas (incluso las ya notificadas) - util para testear el formato
    del Excel sin tener que esperar nuevas rendiciones."""
    docs = db.collection("rendiciones").where("status", "==", "approved").stream()
    out = []
    for d in docs:
        data = d.to_dict() or {}
        if not FORCE_SEND:
            # Filtrar las que YA fueron notificadas (notifiedAt no null).
            notified_at = data.get("notifiedAt")
            if notified_at:
                continue
        data["_id"] = d.id
        data["_ref"] = d.reference
        out.append(data)
    return out


def fmt_ts(ts):
    """Convierte un Firestore Timestamp / datetime / string a 'YYYY-MM-DD HH:MM'."""
    if not ts:
        return ""
    try:
        if hasattr(ts, "to_datetime"):
            dt = ts.to_datetime()
        elif hasattr(ts, "isoformat"):
            dt = ts
        else:
            return str(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(ts)


def build_excel(rendiciones):
    """Arma el Workbook con 2 hojas (Gastos + Solicitudes) + 1 hoja Resumen."""
    wb = Workbook()
    # Hoja 1: Resumen
    ws_sum = wb.active
    ws_sum.title = "Resumen"
    ws_sum.append(["Reporte de Rendiciones Aprobadas - Shimano App Vendedores"])
    ws_sum["A1"].font = Font(bold=True, size=14)
    ws_sum.append([f"Generado: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"])
    ws_sum.append([])
    ws_sum.append(["Total rendiciones notificadas en este lote:", len(rendiciones)])
    gastos = [r for r in rendiciones if r.get("tipo") == "gasto"]
    sols = [r for r in rendiciones if r.get("tipo") == "solicitud"]
    ws_sum.append(["  - Gastos:", len(gastos)])
    ws_sum.append(["  - Solicitudes / anticipos:", len(sols)])
    total_ars = sum(float(r.get("importe") or 0) for r in rendiciones if (r.get("moneda") or "").upper().startswith("PESO"))
    total_usd = sum(float(r.get("importe") or 0) for r in rendiciones if (r.get("moneda") or "").upper().startswith("DOLAR"))
    ws_sum.append(["  - Total ARS:", round(total_ars, 2)])
    ws_sum.append(["  - Total USD:", round(total_usd, 2)])
    ws_sum.column_dimensions["A"].width = 50
    ws_sum.column_dimensions["B"].width = 18

    # Hoja 2: Gastos
    ws_g = wb.create_sheet("Gastos")
    hdr_g = [
        "ID", "Fecha carga", "Vendedor (email)", "N° Ticket", "Descripcion",
        "Modo pago", "Tipo gasto", "Division gasto", "Moneda", "Importe",
        "Importe USD", "Observaciones", "Aprobado por", "Fecha aprobacion",
        "Ticket",
    ]
    ws_g.append(hdr_g)
    for cell in ws_g[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0F172A")
        cell.alignment = Alignment(horizontal="center")
    # Indice 1-based de la columna "Ticket" (hyperlink).
    foto_col_idx = len(hdr_g)  # 15 con el header actual
    link_font = Font(color="0563C1", underline="single", bold=True)
    for r in gastos:
        ws_g.append([
            r.get("_id", ""),
            fmt_ts(r.get("createdAt")),
            r.get("ownerEmail") or r.get("createdByEmail") or "",
            r.get("numeroTicket") or "",
            r.get("descripcion") or "",
            r.get("modoPago") or "",
            r.get("tipoGasto") or "",
            r.get("divisionGasto") or "",
            r.get("moneda") or "",
            float(r.get("importe") or 0),
            float(r.get("importeUsd") or 0) if r.get("importeUsd") else "",
            r.get("observaciones") or "",
            r.get("approvedByEmail") or "",
            fmt_ts(r.get("approvedAt")),
            "",  # placeholder - lo seteamos abajo con hyperlink
        ])
        # Subir la foto a Firebase Storage y meter URL como hyperlink. Si
        # storage no esta disponible o la foto esta corrupta, el campo
        # queda como "(sin foto)".
        foto_src = r.get("fotoTicket") or r.get("adjunto") or ""
        cell = ws_g.cell(row=ws_g.max_row, column=foto_col_idx)
        if foto_src:
            url = upload_foto_to_storage(r.get("_id", "rend"), foto_src)
            if url:
                cell.value = "📷 Ver ticket"
                cell.hyperlink = url
                cell.font = link_font
                cell.alignment = Alignment(horizontal="center")
            else:
                cell.value = "(error al subir)"
        else:
            cell.value = "(sin foto)"
    # Anchos amigables (15 columnas; Ticket es link compacto).
    widths_g = [22, 16, 28, 14, 26, 14, 22, 16, 12, 12, 12, 36, 26, 16, 14]
    for i, w in enumerate(widths_g):
        ws_g.column_dimensions[get_column_letter(i + 1)].width = w

    # Hoja 3: Solicitudes / anticipos
    ws_s = wb.create_sheet("Solicitudes")
    hdr_s = [
        "ID", "Fecha carga", "Vendedor (email)", "Solicitado por",
        "Tipo operacion", "Motivo", "Moneda", "Importe",
        "Estado", "Observaciones", "Aprobado por", "Fecha aprobacion",
    ]
    ws_s.append(hdr_s)
    for cell in ws_s[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0F172A")
        cell.alignment = Alignment(horizontal="center")
    for r in sols:
        ws_s.append([
            r.get("_id", ""),
            fmt_ts(r.get("createdAt")),
            r.get("ownerEmail") or r.get("createdByEmail") or "",
            r.get("solicitadoPor") or "",
            r.get("tipoOperacion") or "",
            r.get("motivo") or "",
            r.get("moneda") or "",
            float(r.get("importe") or 0),
            r.get("estado") or "",
            r.get("observaciones") or "",
            r.get("approvedByEmail") or "",
            fmt_ts(r.get("approvedAt")),
        ])
    widths_s = [22, 16, 28, 22, 22, 30, 12, 12, 12, 36, 26, 16]
    for i, w in enumerate(widths_s):
        ws_s.column_dimensions[chr(65 + i)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def send_email(xlsx_bytes: bytes, count: int) -> None:
    if not GMAIL_APP_PASSWORD:
        die("GMAIL_APP_PASSWORD vacio. Setear el secret en GitHub.")
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    subject = f"[Shimano App] Rendiciones aprobadas - {today_str} ({count} pendientes)"
    body = (
        f"Hola Mariano,\n\n"
        f"Adjunto el Excel con las {count} rendiciones aprobadas pendientes de notificar.\n"
        f"Las hojas son:\n"
        f"  - Resumen: totales por moneda + conteos.\n"
        f"  - Gastos: cada gasto cargado por foto/manual. Ultima columna 'Ticket' es un\n"
        f"    link cliqueable que abre la foto del ticket en su tamano original en el navegador.\n"
        f"  - Solicitudes: anticipos / recargas / rendiciones de gasto generales.\n\n"
        f"Este mail se manda automaticamente cada Lunes y Miercoles a las 9 AM (AR).\n"
        f"Una vez recibido, las rendiciones se marcan como notificadas y no vuelven a salir.\n\n"
        f"-- Shimano App Vendedores"
    )
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = MAIL_FROM
    msg["To"] = MAIL_TO
    msg.set_content(body)
    fname = f"Rendiciones_Aprobadas_{today_str}.xlsx"
    msg.add_attachment(
        xlsx_bytes,
        maintype="application",
        subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=fname,
    )
    print(f"[mail] Enviando a {MAIL_TO} desde {MAIL_FROM}...")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as srv:
        srv.login(MAIL_FROM, GMAIL_APP_PASSWORD)
        srv.send_message(msg)
    print(f"[mail] OK - asunto: {subject}")


def mark_as_notified(rendiciones) -> None:
    """Marca en Firestore cada rendicion como notifiedAt=now."""
    now = datetime.now(timezone.utc)
    for r in rendiciones:
        try:
            r["_ref"].update({
                "notifiedAt": now,
                "notifiedTo": MAIL_TO,
            })
        except Exception as e:
            print(f"[mark] error en {r.get('_id')}: {e}", file=sys.stderr)


def main() -> int:
    db = init_firestore()
    mode_lbl = "FORCE_SEND (todas)" if FORCE_SEND else "solo no notificadas"
    print(f"[fetch] Modo: {mode_lbl}")
    rendiciones = fetch_pending_approved(db)
    print(f"[fetch] Encontradas: {len(rendiciones)}")
    if not rendiciones:
        print("[exit] Sin rendiciones para notificar. No envio mail.")
        return 0
    xlsx_bytes = build_excel(rendiciones)
    send_email(xlsx_bytes, len(rendiciones))
    if SKIP_MARK:
        print(f"[done] SKIP_MARK activo - {len(rendiciones)} rendiciones NO se marcaron como notificadas (testing).")
    else:
        mark_as_notified(rendiciones)
        print(f"[done] {len(rendiciones)} rendiciones marcadas como notificadas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
