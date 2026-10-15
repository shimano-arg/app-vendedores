"""Audit multi-bucket de backorder abierto en Firestore.

Detecta posibles infladores del BO con 7 criterios + genera Excel con una
pestaña por bucket + resumen volumen.

Fuentes:
- Firestore pedidos (state=BO, qtyOpen>0)
- BQ sap_invoices_raw + credit_notes (facturado real por SKU x mes)

READ-ONLY. No modifica nada. Mariano revisa Excel + decide qué limpiar.

Uso:
    python scripts/audit_backorder_multiBuckets.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from google.cloud import firestore, bigquery
from google.oauth2 import service_account

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT = "app-vendedores-shimano"
DESKTOP = Path.home() / "Desktop"
OUT_XLSX = DESKTOP / f"AUDIT_BO_MULTIBUCKET_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"

# Thresholds
DAYS_VIEJO = 90
DAYS_CLIENTE_INACTIVO = 180

# BQ SA key (reusa el del forecast)
SA_KEY_PATH = Path("secrets/sa_bigquery_reader.json")
if not SA_KEY_PATH.exists():
    SA_KEY_PATH = Path("scripts/forecast/secrets/sa_bigquery_reader.json")


def init_bq():
    if not SA_KEY_PATH.exists():
        # fallback a ADC
        return bigquery.Client(project=PROJECT)
    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY_PATH), scopes=["https://www.googleapis.com/auth/bigquery"]
    )
    return bigquery.Client(project=PROJECT, credentials=creds)


def _to_dt(v):
    """Convierte Firestore Timestamp/str/Date a datetime UTC."""
    if v is None:
        return None
    if hasattr(v, "timestamp"):
        try:
            return datetime.fromtimestamp(v.timestamp(), tz=timezone.utc)
        except Exception:
            return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            s = v.replace("Z", "+00:00")
            d = datetime.fromisoformat(s)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def fetch_all_bo_lines(db):
    """Levanta todas las líneas state=BO qtyOpen>0 de pedidos abiertos."""
    print("[1/8] Fetching pedidos abiertos (closedAt=null, stage=confirmed)...")
    snap = db.collection("pedidos").where("closedAt", "==", None).get()
    rows = []
    pedidos = 0
    for d in snap:
        data = d.to_dict() or {}
        if data.get("stage") != "confirmed":
            continue
        pedidos += 1
        lines = data.get("lines") or []
        created = _to_dt(data.get("createdAt"))
        updated = _to_dt(data.get("updatedAt"))
        confirmed = _to_dt(data.get("confirmedAt"))
        client_name = (data.get("clientName") or "").strip()
        card_code = (data.get("clientCardCode") or "").strip()
        order_num = data.get("orderNumber")
        owner_vendor = (data.get("ownerVendor") or data.get("vendedor") or "").strip()
        has_sap_doc = bool(data.get("transferidoSAP", {}).get("docNum") if isinstance(data.get("transferidoSAP"), dict) else None)
        for idx, l in enumerate(lines):
            if not l or not l.get("code"):
                continue
            if l.get("state") != "BO":
                continue
            qo = float(l.get("qtyOpen") or 0)
            if qo <= 0:
                continue
            rows.append({
                "pedidoId": d.id,
                "orderNumber": order_num,
                "lineIndex": idx,
                "sku": str(l.get("code") or "").strip().upper(),
                "desc": (l.get("desc") or "")[:80],
                "clientName": client_name,
                "cardCode": card_code,
                "vendor": owner_vendor,
                "qty": float(l.get("qty") or 0),
                "qtyOpen": qo,
                "qtyInvoiced": float(l.get("qtyInvoiced") or 0),
                "qtyCancelled": float(l.get("qtyCancelled") or 0),
                "qtyRecycled": float(l.get("qtyRecycled") or 0),
                "overAssigned": bool(l.get("overAssigned") is True),
                "overAssignedDelta": float(l.get("overAssignedDelta") or 0),
                "pedidoCreatedAt": created.isoformat() if created else None,
                "pedidoCreatedDays": (datetime.now(timezone.utc) - created).days if created else -1,
                "pedidoUpdatedAt": updated.isoformat() if updated else None,
                "pedidoConfirmedAt": confirmed.isoformat() if confirmed else None,
                "has_sap_doc": has_sap_doc,
                "precio": float(l.get("precio") or l.get("priceAtCreation") or 0),
            })
    print(f"  pedidos confirmed abiertos: {pedidos}")
    print(f"  lineas BO qtyOpen>0: {len(rows)}")
    total_u = sum(r["qtyOpen"] for r in rows)
    print(f"  unidades BO totales: {total_u:,.0f}")
    return rows


def fetch_facturado_recent(bq):
    """Facturado por (cardCode, sku) en los últimos 180d desde SAP invoices."""
    print("[2/8] Fetching facturado 180d BQ...")
    sql = """
    WITH expanded AS (
      SELECT
        i.card_code AS card_code,
        UPPER(TRIM(JSON_EXTRACT_SCALAR(line, '$.ItemCode'))) AS sku,
        CAST(JSON_EXTRACT_SCALAR(line, '$.Quantity') AS FLOAT64) AS qty,
        i.doc_date AS doc_date
      FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` i,
           UNNEST(JSON_EXTRACT_ARRAY(i.lines_json)) AS line
      WHERE i.cancelled = 'tNO' AND i.doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
    ),
    neg AS (
      SELECT
        c.card_code,
        UPPER(TRIM(JSON_EXTRACT_SCALAR(line, '$.ItemCode'))) AS sku,
        -CAST(JSON_EXTRACT_SCALAR(line, '$.Quantity') AS FLOAT64) AS qty,
        c.doc_date
      FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw` c,
           UNNEST(JSON_EXTRACT_ARRAY(c.lines_json)) AS line
      WHERE c.cancelled = 'tNO' AND c.doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
    ),
    all_u AS (SELECT * FROM expanded UNION ALL SELECT * FROM neg)
    SELECT card_code, sku, SUM(qty) AS qty_facturada, MAX(doc_date) AS last_fact_date
    FROM all_u
    WHERE sku IS NOT NULL AND card_code IS NOT NULL
    GROUP BY 1, 2
    """
    df = bq.query(sql).to_dataframe()
    print(f"  facturado rows (card_code,sku): {len(df)}")
    # Build map: (cardCode_upper, sku_upper) -> {qty, last_date}
    fmap = {}
    for r in df.itertuples(index=False):
        k = (str(r.card_code).upper().strip(), str(r.sku).upper().strip())
        fmap[k] = {"qty": float(r.qty_facturada or 0), "last": r.last_fact_date}
    return fmap


def fetch_last_order_per_client(db):
    """Para cada cardCode, última fecha de pedido confirmed."""
    print("[3/8] Fetching last order date por cliente (todos los pedidos, filtrando client-side)...")
    # No necesitamos un query compuesto; levantamos todos los pedidos recientes
    snap = db.collection("pedidos").get()
    last_map = {}
    for d in snap:
        data = d.to_dict() or {}
        cc = (data.get("clientCardCode") or "").strip()
        if not cc:
            continue
        dt = _to_dt(data.get("createdAt"))
        if not dt:
            continue
        prev = last_map.get(cc)
        if prev is None or dt > prev:
            last_map[cc] = dt
    print(f"  clientes con pedidos: {len(last_map)}")
    return last_map


def main():
    print("=" * 72)
    print("AUDIT BACKORDER MULTI-BUCKET — diagnostico sin modificar")
    print("=" * 72)
    db = firestore.Client(project=PROJECT)
    bq = init_bq()

    bo_rows = fetch_all_bo_lines(db)
    fact_map = fetch_facturado_recent(bq)
    last_order_map = fetch_last_order_per_client(db)

    # Pre-aggregate BO by (cardCode, sku)
    print("\n[4/8] Agregando BO por (cardCode, sku)...")
    bo_by_cliSku = defaultdict(lambda: {"total_bo": 0.0, "lineas": []})
    for r in bo_rows:
        k = (r["cardCode"].upper().strip(), r["sku"].upper().strip())
        bo_by_cliSku[k]["total_bo"] += r["qtyOpen"]
        bo_by_cliSku[k]["lineas"].append(r)

    # BUCKETS
    print("\n[5/8] Clasificando BO en buckets...")
    bucket_A = []  # facturado post-cutoff
    bucket_B = []  # duplicado cliente+sku en multiples pedidos
    bucket_C = []  # BO en pedido con has_sap_doc = False PERO sin confirmedAt (sospechoso)
    bucket_D = []  # BO viejo > 90d
    bucket_E = []  # qtyOpen mal matematico
    bucket_F = []  # cliente inactivo >180d
    bucket_G = []  # overAssigned=True

    now = datetime.now(timezone.utc)

    for r in bo_rows:
        k = (r["cardCode"].upper().strip(), r["sku"].upper().strip())
        # A — facturado >= BO del cliente+sku
        fact = fact_map.get(k)
        if fact and fact["qty"] > 0:
            total_bo_cli_sku = bo_by_cliSku[k]["total_bo"]
            if fact["qty"] >= total_bo_cli_sku and total_bo_cli_sku > 0:
                bucket_A.append({**r, "facturado_qty": fact["qty"], "last_fact": str(fact["last"]), "bo_cli_sku_total": total_bo_cli_sku})

        # B — duplicado cliente+SKU en 2+ pedidos
        n_lineas = len(bo_by_cliSku[k]["lineas"])
        if n_lineas >= 2 and r["cardCode"]:
            bucket_B.append({**r, "n_lineas_mismo_cliSku": n_lineas, "bo_cli_sku_total": bo_by_cliSku[k]["total_bo"]})

        # C — pedido confirmed sin transferidoSAP docNum (sospechoso si viejo)
        if not r["has_sap_doc"] and r["pedidoCreatedDays"] > 30:
            bucket_C.append(r)

        # D — BO viejo
        if r["pedidoCreatedDays"] >= DAYS_VIEJO:
            bucket_D.append(r)

        # E — qtyOpen matematico
        expected_qo = max(0, r["qty"] - r["qtyInvoiced"] - r["qtyCancelled"] - r["qtyRecycled"])
        if abs(expected_qo - r["qtyOpen"]) > 0.5:
            bucket_E.append({**r, "expected_qtyOpen": expected_qo, "diff": r["qtyOpen"] - expected_qo})

        # F — cliente inactivo
        if r["cardCode"]:
            last_ord = last_order_map.get(r["cardCode"])
            if last_ord:
                dias = (now - last_ord).days
                if dias >= DAYS_CLIENTE_INACTIVO:
                    bucket_F.append({**r, "dias_sin_pedido": dias, "last_pedido": last_ord.isoformat()})

        # G — overAssigned
        if r["overAssigned"]:
            bucket_G.append(r)

    print(f"  A facturado post-cutoff:         {len(bucket_A):>5} lineas, {sum(x['qtyOpen'] for x in bucket_A):>7.0f} u")
    print(f"  B duplicado cliente+SKU:         {len(bucket_B):>5} lineas, {sum(x['qtyOpen'] for x in bucket_B):>7.0f} u")
    print(f"  C sin SAP docNum >30d creacion:  {len(bucket_C):>5} lineas, {sum(x['qtyOpen'] for x in bucket_C):>7.0f} u")
    print(f"  D BO viejo >={DAYS_VIEJO}d:                  {len(bucket_D):>5} lineas, {sum(x['qtyOpen'] for x in bucket_D):>7.0f} u")
    print(f"  E qtyOpen matematico mal:        {len(bucket_E):>5} lineas, {sum(x['qtyOpen'] for x in bucket_E):>7.0f} u")
    print(f"  F cliente inactivo >={DAYS_CLIENTE_INACTIVO}d:         {len(bucket_F):>5} lineas, {sum(x['qtyOpen'] for x in bucket_F):>7.0f} u")
    print(f"  G overAssigned=true:             {len(bucket_G):>5} lineas, {sum(x['qtyOpen'] for x in bucket_G):>7.0f} u")

    # Union: lineas que caen en >= 1 bucket (candidatas a limpieza)
    def _key(r):
        return (r["pedidoId"], r["lineIndex"])

    union_keys = set()
    for b in [bucket_A, bucket_B, bucket_C, bucket_D, bucket_E, bucket_F, bucket_G]:
        for r in b:
            union_keys.add(_key(r))
    total_lines_sospechosas = len(union_keys)
    total_u_sospechosas = sum(r["qtyOpen"] for r in bo_rows if _key(r) in union_keys)
    total_u = sum(r["qtyOpen"] for r in bo_rows)
    print(f"\n  UNION (líneas en ≥1 bucket): {total_lines_sospechosas:,} / {len(bo_rows):,} ({100*total_lines_sospechosas/len(bo_rows):.1f}%)")
    print(f"  UNION unidades: {total_u_sospechosas:,.0f} / {total_u:,.0f} ({100*total_u_sospechosas/max(total_u,1):.1f}%)")

    print("\n[6/8] Escribiendo Excel...")
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        raise SystemExit("pip install openpyxl")

    wb = Workbook()
    ws = wb.active
    ws.title = "RESUMEN"
    bold = Font(bold=True)
    red = PatternFill(start_color="991B1B", end_color="991B1B", fill_type="solid")
    orange = PatternFill(start_color="D97706", end_color="D97706", fill_type="solid")
    yellow = PatternFill(start_color="EAB308", end_color="EAB308", fill_type="solid")
    purple = PatternFill(start_color="7C3AED", end_color="7C3AED", fill_type="solid")
    gray = PatternFill(start_color="6B7280", end_color="6B7280", fill_type="solid")
    white_bold = Font(bold=True, color="FFFFFF")

    ws["A1"] = f"Audit BO multi-bucket — generado {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A3"] = "Bucket"; ws["B3"] = "Líneas"; ws["C3"] = "Unidades BO"; ws["D3"] = "Comentario"
    for c in "ABCD":
        ws[c + "3"].font = bold
    buckets_meta = [
        ("A", "Facturado post-cutoff (ya vendimos ≥ total BO del cliente+sku)", bucket_A, red, "Candidato fuerte a cancelar"),
        ("B", "Duplicado cliente+SKU en 2+ pedidos", bucket_B, orange, "Revisar: alguno puede ser legítimo"),
        ("C", "Sin SAP docNum >30d desde creación", bucket_C, yellow, "Pedido confirmed pero nunca llegó a SAP"),
        ("D", f"BO viejo >={DAYS_VIEJO}d", bucket_D, orange, "Probable ya cumplido por otro lado"),
        ("E", "qtyOpen matemáticamente mal", bucket_E, red, "Bug data, qty_open ≠ qty - inv - canc - rec"),
        ("F", f"Cliente inactivo >={DAYS_CLIENTE_INACTIVO}d", bucket_F, gray, "Cliente dejó de operar"),
        ("G", "overAssigned=true (v1292)", bucket_G, purple, "Sobre-asignado residual"),
    ]
    for i, (letra, desc, bk, color, coment) in enumerate(buckets_meta, 4):
        ws.cell(row=i, column=1, value=f"{letra} — {desc}")
        ws.cell(row=i, column=2, value=len(bk))
        ws.cell(row=i, column=3, value=round(sum(x["qtyOpen"] for x in bk), 1))
        ws.cell(row=i, column=4, value=coment)
    row_u = 4 + len(buckets_meta) + 1
    ws.cell(row=row_u, column=1, value="UNION (líneas en ≥1 bucket)").font = bold
    ws.cell(row=row_u, column=2, value=total_lines_sospechosas)
    ws.cell(row=row_u, column=3, value=round(total_u_sospechosas, 1))
    ws.cell(row=row_u + 1, column=1, value="BO TOTAL").font = bold
    ws.cell(row=row_u + 1, column=2, value=len(bo_rows))
    ws.cell(row=row_u + 1, column=3, value=round(total_u, 1))
    ws.cell(row=row_u + 2, column=1, value="% sospechoso de total").font = bold
    ws.cell(row=row_u + 2, column=2, value=f"{100*total_lines_sospechosas/max(len(bo_rows),1):.1f}% líneas")
    ws.cell(row=row_u + 2, column=3, value=f"{100*total_u_sospechosas/max(total_u,1):.1f}% u")
    for col_w, w in zip("ABCDE", [60, 10, 14, 70, 14]):
        ws.column_dimensions[col_w].width = w

    def _write_sheet(ws_, data, hdr_fill):
        cols = ["pedidoId", "orderNumber", "lineIndex", "sku", "desc", "clientName",
                "cardCode", "vendor", "qty", "qtyOpen", "qtyInvoiced", "qtyCancelled",
                "pedidoCreatedAt", "pedidoCreatedDays", "has_sap_doc", "precio"]
        # extra cols por bucket
        extra = sorted({k for row in data for k in row.keys() if k not in cols})
        all_cols = cols + extra
        for ci, c in enumerate(all_cols, 1):
            cell = ws_.cell(row=1, column=ci, value=c)
            cell.font = white_bold
            cell.fill = hdr_fill
            cell.alignment = Alignment(horizontal="center")
        data_sorted = sorted(data, key=lambda r: (-float(r.get("qtyOpen") or 0), r.get("clientName", "")))
        for ri, r in enumerate(data_sorted, 2):
            for ci, c in enumerate(all_cols, 1):
                v = r.get(c, "")
                if isinstance(v, (int, float)):
                    ws_.cell(row=ri, column=ci, value=v)
                else:
                    ws_.cell(row=ri, column=ci, value=str(v) if v is not None else "")
        for ci, c in enumerate(all_cols, 1):
            w = max(10, min(40, len(c) + 3))
            if c in ("clientName", "desc", "pedidoCreatedAt"):
                w = 30
            ws_.column_dimensions[chr(64 + ci) if ci <= 26 else "A" + chr(64 + ci - 26)].width = w

    for letra, desc, bk, color, _ in buckets_meta:
        if not bk:
            continue
        ws_b = wb.create_sheet(f"{letra}_{desc.split(' ')[0][:15]}"[:31])
        _write_sheet(ws_b, bk, color)

    wb.save(OUT_XLSX)
    print(f"\n[DONE] Excel: {OUT_XLSX}")
    print(f"\nPróximo paso: abrí el Excel, revisá por bucket, decime cuáles ejecutar.")


if __name__ == "__main__":
    main()
