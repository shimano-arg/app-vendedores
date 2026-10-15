"""Diagnostico read-only del bucket C: pedidos confirmed sin transferidoSAP.docNum
y >30d desde creacion.

Clasifica cada caso en 1 de 4 hipotesis para decidir que hacer con cada subgrupo:

  C1_MIGRACION: pedido sintetico de la migracion 2026-08-28 (NO tocar)
      Marcadores posibles: migratedFrom, fromSapDocEntry, pedidoSintetico, synthetic=true,
      createdAt entre 2026-08-27 y 2026-08-30
  C2_SAP_EXISTE: pedido tiene una SQ en SAP (via BQ sap_orders_raw) pero el docNum
      nunca se linkeo al pedido. Comparar por (cardCode + fecha ±2d + items).
  C3_YA_FACTURADO: cardCode+SKU facturado en SAP >= BO qty (igual que bucket A pero
      requiere que el fact sea POST-createdAt del pedido).
  C4_HUERFANO_REAL: no es ninguna de las anteriores. FATECHI-like: pedido confirmed,
      nadie lo mando a SAP, nunca se facturo. Candidato a review manual.

Salida: Excel con una hoja por sub-bucket. NO cambia nada en Firestore.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from google.cloud import bigquery, firestore
from google.oauth2 import service_account

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT = "app-vendedores-shimano"
OUT_PATH = Path("outputs/audit_bo_bucketC_diag.xlsx")

SA_KEY_PATH = Path("secrets/sa_bigquery_reader.json")
if not SA_KEY_PATH.exists():
    SA_KEY_PATH = Path("scripts/forecast/secrets/sa_bigquery_reader.json")


def init_bq():
    if not SA_KEY_PATH.exists():
        return bigquery.Client(project=PROJECT)
    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY_PATH), scopes=["https://www.googleapis.com/auth/bigquery"]
    )
    return bigquery.Client(project=PROJECT, credentials=creds)


def _to_dt(v):
    if v is None:
        return None
    if hasattr(v, "timestamp"):
        try:
            return datetime.fromtimestamp(v.timestamp(), tz=timezone.utc)
        except Exception:
            return None
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


MIG_WINDOW_START = datetime(2026, 8, 27, tzinfo=timezone.utc)
MIG_WINDOW_END = datetime(2026, 8, 30, 23, 59, tzinfo=timezone.utc)
MIG_MARKER_FIELDS = ("migratedFrom", "fromSapDocEntry", "pedidoSintetico", "synthetic", "sqMigratedFrom", "migrationBatch")


def main():
    print("=== audit_bo_diag_bucketC (read-only) ===")
    db = firestore.Client(project=PROJECT)
    bq = init_bq()

    # 1. Bucket C: pedidos confirmed sin docNum, createdAt >30d
    print("[1/5] Levantando bucket C...")
    now = datetime.now(timezone.utc)
    snap = db.collection("pedidos").where("closedAt", "==", None).get()
    rows = []
    pedidos_in_C = 0
    pedido_meta = {}  # pedidoId -> {createdAt, docNum, marcadores, etc.}
    for d in snap:
        data = d.to_dict() or {}
        if data.get("stage") != "confirmed":
            continue
        created = _to_dt(data.get("createdAt"))
        if not created:
            continue
        if (now - created).days <= 30:
            continue
        tsap = data.get("transferidoSAP") if isinstance(data.get("transferidoSAP"), dict) else None
        has_doc = bool(tsap and tsap.get("docNum"))
        if has_doc:
            continue
        pedidos_in_C += 1

        # Marcadores migracion
        mig_marker = None
        for f in MIG_MARKER_FIELDS:
            if data.get(f):
                mig_marker = f + "=" + str(data.get(f))[:60]
                break
        in_mig_window = MIG_WINDOW_START <= created <= MIG_WINDOW_END

        card_code = (data.get("clientCardCode") or "").strip().upper()
        pedido_meta[d.id] = {
            "pedidoId": d.id,
            "orderNumber": data.get("orderNumber"),
            "clientName": (data.get("clientName") or "").strip(),
            "cardCode": card_code,
            "createdAt": created,
            "createdDays": (now - created).days,
            "ownerVendor": (data.get("ownerVendor") or data.get("vendedor") or "").strip(),
            "mig_marker": mig_marker,
            "in_mig_window": in_mig_window,
            "ref": d.reference,
        }

        lines = data.get("lines") or []
        for idx, l in enumerate(lines):
            if not l or l.get("state") != "BO":
                continue
            qo = float(l.get("qtyOpen") or 0)
            if qo <= 0:
                continue
            rows.append({
                "pedidoId": d.id,
                "lineIndex": idx,
                "sku": str(l.get("code") or "").strip().upper(),
                "desc": (l.get("desc") or "")[:60],
                "qtyOpen": qo,
                "qty": float(l.get("qty") or 0),
            })

    print(f"  pedidos en bucket C: {pedidos_in_C}")
    print(f"  lineas BO en bucket C: {len(rows)} / {sum(r['qtyOpen'] for r in rows):.0f}u")

    if not rows:
        print("Nada que diagnosticar."); return

    # 2. Facturado por cardCode+sku POST-created del pedido
    print("[2/5] Facturado BQ 180d...")
    sql = """
    WITH expanded AS (
      SELECT i.card_code AS card_code,
             UPPER(TRIM(JSON_EXTRACT_SCALAR(line, '$.ItemCode'))) AS sku,
             CAST(JSON_EXTRACT_SCALAR(line, '$.Quantity') AS FLOAT64) AS qty,
             i.doc_date AS doc_date
      FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` i,
           UNNEST(JSON_EXTRACT_ARRAY(i.lines_json)) AS line
      WHERE i.cancelled = 'tNO' AND i.doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
    ),
    neg AS (
      SELECT c.card_code,
             UPPER(TRIM(JSON_EXTRACT_SCALAR(line, '$.ItemCode'))) AS sku,
             -CAST(JSON_EXTRACT_SCALAR(line, '$.Quantity') AS FLOAT64) AS qty,
             c.doc_date
      FROM `app-vendedores-shimano.shimano_app.sap_credit_notes_raw` c,
           UNNEST(JSON_EXTRACT_ARRAY(c.lines_json)) AS line
      WHERE c.cancelled = 'tNO' AND c.doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
    ),
    all_u AS (SELECT * FROM expanded UNION ALL SELECT * FROM neg)
    SELECT card_code, sku, SUM(qty) AS qty_facturada, MAX(doc_date) AS last_fact
    FROM all_u WHERE sku IS NOT NULL AND card_code IS NOT NULL
    GROUP BY 1, 2
    """
    fact_df = bq.query(sql).to_dataframe()
    fact_map = {}
    for r in fact_df.itertuples(index=False):
        k = (str(r.card_code).upper().strip(), str(r.sku).upper().strip())
        fact_map[k] = {"qty": float(r.qty_facturada or 0), "last": r.last_fact}

    # 3. SAP SQs abiertos por cardCode (podria estar vivo en SAP sin linkear)
    print("[3/5] SAP SQs abiertos por cardCode BQ...")
    sql_sq = """
    SELECT card_code, doc_entry, doc_num, doc_date, document_status
    FROM `app-vendedores-shimano.shimano_app.sap_orders_raw`
    WHERE document_status = 'bost_Open' AND cancelled = 'tNO'
      AND doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
    """
    try:
        sq_df = bq.query(sql_sq).to_dataframe()
        sq_by_card = defaultdict(list)
        for r in sq_df.itertuples(index=False):
            cc = str(r.card_code or "").upper().strip()
            sq_by_card[cc].append({
                "docEntry": int(r.doc_entry),
                "docNum": int(r.doc_num),
                "docDate": r.doc_date,
            })
        print(f"  SQs abiertos SAP (120d): {len(sq_df)}")
    except Exception as e:
        print(f"  WARN: no se pudo leer sap_orders_raw: {e}")
        sq_by_card = {}

    # 4. Clasificar
    print("[4/5] Clasificando...")
    C1_mig = []
    C2_sap_exist = []
    C3_facturado = []
    C4_huerfano = []

    for r in rows:
        meta = pedido_meta[r["pedidoId"]]
        enriched = {
            **r,
            "orderNumber": meta["orderNumber"],
            "clientName": meta["clientName"],
            "cardCode": meta["cardCode"],
            "createdAt": meta["createdAt"].isoformat(),
            "createdDays": meta["createdDays"],
            "ownerVendor": meta["ownerVendor"],
            "mig_marker": meta["mig_marker"],
            "in_mig_window": meta["in_mig_window"],
        }
        # C1 — migracion (marker explicito O ventana + sin sapDoc)
        if meta["mig_marker"] or meta["in_mig_window"]:
            enriched["hipotesis"] = "C1_migracion"
            enriched["razon"] = meta["mig_marker"] or f"createdAt={meta['createdAt'].date()} dentro ventana 2026-08-27..30"
            C1_mig.append(enriched)
            continue

        # C3 — ya facturado post-created (bucket A no lo cubre si fact es pre-created)
        k = (meta["cardCode"], r["sku"])
        fact = fact_map.get(k)
        if fact and fact["qty"] >= r["qtyOpen"]:
            last_fact_dt = datetime.combine(fact["last"], datetime.min.time()).replace(tzinfo=timezone.utc) if fact["last"] else None
            is_post = last_fact_dt and last_fact_dt >= meta["createdAt"] - timedelta(days=2)
            if is_post:
                enriched["hipotesis"] = "C3_facturado_post_create"
                enriched["razon"] = f"facturado={fact['qty']:.0f} >= BO={r['qtyOpen']:.0f} last={fact['last']}"
                enriched["fact_qty"] = fact["qty"]
                enriched["last_fact"] = str(fact["last"])
                C3_facturado.append(enriched)
                continue

        # C2 — SAP tiene SQ abierta del mismo cliente creada despues del pedido app (desincronizado)
        sq_list = sq_by_card.get(meta["cardCode"], [])
        candidates = [sq for sq in sq_list if sq["docDate"] and (abs((datetime.combine(sq["docDate"], datetime.min.time()).replace(tzinfo=timezone.utc) - meta["createdAt"]).days) <= 7)]
        if candidates:
            enriched["hipotesis"] = "C2_sap_sq_abierta_sin_linkear"
            enriched["razon"] = f"SAP tiene SQ(s) abiertas del cardCode {meta['cardCode']} +-7d: " + ",".join([f"docNum={sq['docNum']}" for sq in candidates[:3]])
            enriched["sap_candidates"] = ",".join([str(sq["docNum"]) for sq in candidates])
            C2_sap_exist.append(enriched)
            continue

        # C4 — huerfano real
        enriched["hipotesis"] = "C4_huerfano_real"
        enriched["razon"] = f"pedido {meta['createdDays']}d sin SAP docNum, sin SQ en BQ, sin facturado"
        C4_huerfano.append(enriched)

    print("\n=== RESUMEN ===")
    for name, lst in [("C1 migracion (NO tocar)", C1_mig),
                      ("C2 SQ SAP abierta (relinkear)", C2_sap_exist),
                      ("C3 ya facturado post-create (cancel BO)", C3_facturado),
                      ("C4 huerfano real (review manual)", C4_huerfano)]:
        u = sum(r["qtyOpen"] for r in lst)
        peds = len({r["pedidoId"] for r in lst})
        print(f"  {name}: {len(lst)} lineas / {u:.0f}u / {peds} pedidos")

    # Preview top 10 de C4 (huerfano real, mas interesante)
    print("\nTOP 10 C4_huerfano_real (ordenado por u DESC):")
    for r in sorted(C4_huerfano, key=lambda x: -x["qtyOpen"])[:10]:
        print(f"  ORD{r['orderNumber']} {r['clientName'][:30]:30} {r['sku']:18} {r['qtyOpen']:5.0f}u ({r['createdDays']}d) {r['ownerVendor']}")

    # Export Excel
    print("\n[5/5] Exportando Excel...")
    try:
        import pandas as pd
        OUT_PATH.parent.mkdir(exist_ok=True, parents=True)
        with pd.ExcelWriter(OUT_PATH, engine="openpyxl") as w:
            for name, lst in [("C1_migracion", C1_mig),
                              ("C2_sap_sq_abierta", C2_sap_exist),
                              ("C3_facturado_post", C3_facturado),
                              ("C4_huerfano_real", C4_huerfano)]:
                if lst:
                    pd.DataFrame(lst).to_excel(w, sheet_name=name[:31], index=False)
        print(f"  OK: {OUT_PATH}")
    except Exception as e:
        print(f"  ERROR Excel: {e}")


if __name__ == "__main__":
    main()
