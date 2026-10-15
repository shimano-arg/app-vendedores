"""Aplica bucket A del audit multi-bucket: cancela BO cuyo cliente ya tiene
facturado >= total BO del mismo (cardCode, SKU) en los ultimos 180d.

Matching por card_code (preciso, no nombre). Precedente: cancel_bo_ya_facturado_adc.py
pero con BQ live en vez de CSV cutoff.

Uso:
    DRY_RUN=true  python scripts/audit_bo_apply_bucketA.py
    DRY_RUN=false python scripts/audit_bo_apply_bucketA.py
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from google.cloud import firestore, bigquery
from google.oauth2 import service_account

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT = "app-vendedores-shimano"
DRY_RUN = (os.environ.get("DRY_RUN", "true").lower() != "false")

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


def _iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    print(f"=== audit_bo_apply_bucketA (DRY_RUN={DRY_RUN}) ===")
    db = firestore.Client(project=PROJECT)
    bq = init_bq()

    # 1. Levantar BO abiertos
    print("[1/4] BO abiertos de Firestore...")
    snap = db.collection("pedidos").where("closedAt", "==", None).get()
    bo_lines = []
    for d in snap:
        data = d.to_dict() or {}
        if data.get("stage") != "confirmed":
            continue
        card_code = (data.get("clientCardCode") or "").strip().upper()
        if not card_code:
            continue
        lines = data.get("lines") or []
        for idx, l in enumerate(lines):
            if not l or l.get("state") != "BO":
                continue
            qo = float(l.get("qtyOpen") or 0)
            if qo <= 0:
                continue
            bo_lines.append({
                "pedidoId": d.id,
                "ref": d.reference,
                "lineIndex": idx,
                "sku": str(l.get("code") or "").strip().upper(),
                "cardCode": card_code,
                "clientName": (data.get("clientName") or "").strip(),
                "qty": float(l.get("qty") or 0),
                "qtyOpen": qo,
                "qtyCancelled": float(l.get("qtyCancelled") or 0),
                "linea": l,
            })
    print(f"  BO lines: {len(bo_lines)}")

    # 2. Agregar por (cardCode, sku)
    bo_by_cs = defaultdict(lambda: {"total_bo": 0.0, "lineas": []})
    for r in bo_lines:
        k = (r["cardCode"], r["sku"])
        bo_by_cs[k]["total_bo"] += r["qtyOpen"]
        bo_by_cs[k]["lineas"].append(r)

    # 3. Facturado 180d
    print("[2/4] Facturado 180d BQ...")
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
    SELECT card_code, sku, SUM(qty) AS qty_facturada
    FROM all_u
    WHERE sku IS NOT NULL AND card_code IS NOT NULL
    GROUP BY 1, 2
    """
    df = bq.query(sql).to_dataframe()
    fact_map = {}
    for r in df.itertuples(index=False):
        k = (str(r.card_code).upper().strip(), str(r.sku).upper().strip())
        fact_map[k] = float(r.qty_facturada or 0)
    print(f"  facturado keys: {len(fact_map)}")

    # 4. Identificar lineas a cancelar
    print("[3/4] Identificando lineas a cancelar (facturado >= total BO del cliSku)...")
    plan = []  # (pedidoId, lineIndex, cardCode, sku, qtyOpen, fact_qty, bo_cs_total)
    for (card_code, sku), info in bo_by_cs.items():
        fact = fact_map.get((card_code, sku), 0.0)
        if fact >= info["total_bo"] and info["total_bo"] > 0:
            for ln in info["lineas"]:
                plan.append({
                    "pedidoId": ln["pedidoId"],
                    "ref": ln["ref"],
                    "lineIndex": ln["lineIndex"],
                    "cardCode": card_code,
                    "clientName": ln["clientName"],
                    "sku": sku,
                    "qtyOpen": ln["qtyOpen"],
                    "fact_qty": fact,
                    "bo_cs_total": info["total_bo"],
                    "linea_actual": ln["linea"],
                })
    total_u = sum(p["qtyOpen"] for p in plan)
    print(f"  plan: {len(plan)} lineas, {total_u:.0f} unidades a cancelar")
    print(f"  top 10 por qtyOpen:")
    for p in sorted(plan, key=lambda x: -x["qtyOpen"])[:10]:
        print(f"    {p['clientName'][:30]:30} / {p['sku']:20} qtyOpen={p['qtyOpen']:5.0f} fact={p['fact_qty']:5.0f}")

    if DRY_RUN:
        print("\n=== DRY_RUN ===")
        return

    # 5. Apply: cancelar linea por linea (agrupadas por pedidoId para 1 tx por doc)
    print("\n[4/4] APLICANDO cancelacion...")
    now_iso = _iso()
    by_pedido = defaultdict(list)
    for p in plan:
        by_pedido[p["pedidoId"]].append(p)

    cancelled = 0
    errors = []
    for pid, items in by_pedido.items():
        try:
            @firestore.transactional
            def _tx(txn):
                nonlocal cancelled
                ref = items[0]["ref"]
                snap_ = ref.get(transaction=txn)
                data = snap_.to_dict() or {}
                lines = list(data.get("lines") or [])
                for it in items:
                    li = it["lineIndex"]
                    if li >= len(lines):
                        continue
                    line = lines[li]
                    if not line or line.get("state") != "BO":
                        continue
                    qo = float(line.get("qtyOpen") or 0)
                    if qo <= 0:
                        continue
                    new_line = dict(line)
                    new_line["state"] = "cancelled"
                    new_line["qtyOpen"] = 0
                    new_line["qtyCancelled"] = (float(line.get("qtyCancelled") or 0)) + qo
                    new_line["cancelledFrom"] = "audit-ya-facturado-bq180d"
                    new_line["cancelledAt"] = now_iso
                    new_line["cancelledCardCode"] = it["cardCode"]
                    new_line["cancelledFactQty"] = it["fact_qty"]
                    new_line["cancelledBoCsTotal"] = it["bo_cs_total"]
                    lines[li] = new_line
                    cancelled += 1
                txn.update(items[0]["ref"], {"lines": lines, "updatedAt": now_iso})
            txn = db.transaction()
            _tx(txn)
        except Exception as e:
            errors.append((pid, str(e)))

    print(f"  cancelled: {cancelled} lineas, {sum(p['qtyOpen'] for p in plan):.0f} u")
    if errors:
        print(f"  errores: {len(errors)}")
        for pid, e in errors[:5]:
            print(f"    {pid}: {e}")

    # Audit log
    try:
        db.collection("audit_bo_bucketA_log").add({
            "runAt": now_iso,
            "planLineas": len(plan),
            "cancelled": cancelled,
            "errors": len(errors),
            "unidades_total": float(sum(p["qtyOpen"] for p in plan)),
            "source": "scripts/audit_bo_apply_bucketA.py",
        })
    except Exception:
        pass
    print(f"\n=== DONE ({cancelled} canceladas, {len(errors)} errores) ===")


if __name__ == "__main__":
    main()
