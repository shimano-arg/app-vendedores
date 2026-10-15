"""Reporte accionable de Bucket C (huerfanos reales): 10 pedidos / 81 lineas / 371u.

Para cada pedido, exporta:
  - orderNumber, pedidoId, cardCode, clientName, vendedor
  - createdAt, days_old
  - lineas BO (sku, desc, qtyOpen, precio, subtotal)
  - total pedido BO (unidades + ARS)
  - Actividad SAP post-created (ultimas 3 SQs del cardCode): docNum, fecha, status, total

El output es Excel con 1 hoja consolidada + 1 hoja por pedido para enviar al vendedor.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from google.cloud import bigquery, firestore

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT = "app-vendedores-shimano"
OUT_PATH = Path("outputs/audit_bo_bucketC_review_vendedor.xlsx")


def _to_dt(v):
    if v is None: return None
    if hasattr(v, "timestamp"):
        try: return datetime.fromtimestamp(v.timestamp(), tz=timezone.utc)
        except: return None
    return None


def main():
    print("=== audit_bo_bucketC_review ===")
    db = firestore.Client(project=PROJECT)
    bq = bigquery.Client(project=PROJECT)

    now = datetime.now(timezone.utc)
    snap = db.collection("pedidos").where("closedAt", "==", None).get()

    pedidos_c = []
    for d in snap:
        data = d.to_dict() or {}
        if data.get("stage") != "confirmed": continue
        created = _to_dt(data.get("createdAt"))
        if not created or (now - created).days <= 30: continue
        tsap = data.get("transferidoSAP") if isinstance(data.get("transferidoSAP"), dict) else None
        if tsap and tsap.get("docNum"): continue

        bo_lines = []
        for idx, l in enumerate(data.get("lines") or []):
            if not l or l.get("state") != "BO": continue
            qo = float(l.get("qtyOpen") or 0)
            if qo <= 0: continue
            precio = float(l.get("precio") or l.get("priceAtCreation") or 0)
            bo_lines.append({
                "lineIndex": idx,
                "sku": str(l.get("code") or "").upper().strip(),
                "desc": (l.get("desc") or "")[:80],
                "qtyOpen": qo,
                "precio": precio,
                "subtotal_ars": qo * precio,
            })
        if not bo_lines: continue
        pedidos_c.append({
            "pedidoId": d.id,
            "orderNumber": data.get("orderNumber"),
            "cardCode": (data.get("clientCardCode") or "").strip().upper(),
            "clientName": (data.get("clientName") or "").strip(),
            "vendedor": (data.get("ownerVendor") or data.get("vendedor") or "").strip(),
            "createdAt": created.isoformat(),
            "createdDays": (now - created).days,
            "bo_lines": bo_lines,
            "bo_total_u": sum(l["qtyOpen"] for l in bo_lines),
            "bo_total_ars": sum(l["subtotal_ars"] for l in bo_lines),
        })

    print(f"Pedidos en C: {len(pedidos_c)}")

    # Actividad SAP por cardCode (ultimas 10 SQs)
    cards = sorted({p["cardCode"] for p in pedidos_c if p["cardCode"]})
    sap_act = defaultdict(list)
    if cards:
        sql = f"""
        SELECT card_code, doc_num, doc_date, document_status, doc_total, lines_count
        FROM `app-vendedores-shimano.shimano_app.sap_orders_raw`
        WHERE card_code IN ({','.join([repr(c) for c in cards])})
          AND doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
          AND cancelled = 'tNO'
        ORDER BY doc_date DESC
        """
        for r in bq.query(sql).result():
            sap_act[(r.card_code or "").upper().strip()].append({
                "docNum": int(r.doc_num),
                "docDate": str(r.doc_date),
                "status": r.document_status,
                "total_ars": float(r.doc_total or 0),
                "lines_count": int(r.lines_count or 0),
            })

    # Consolidado
    import pandas as pd
    OUT_PATH.parent.mkdir(exist_ok=True, parents=True)

    rows_consol = []
    for p in pedidos_c:
        sap_recent = sap_act.get(p["cardCode"], [])[:3]
        sap_summary = "; ".join([f"SQ{s['docNum']}({s['docDate']}:{'OPEN' if s['status']=='bost_Open' else 'CLOSED'})" for s in sap_recent]) or "sin actividad SAP"
        rows_consol.append({
            "orderNumber": p["orderNumber"] or "sin ORD",
            "clientName": p["clientName"],
            "cardCode": p["cardCode"],
            "vendedor": p["vendedor"] or "SIN ASIGNAR",
            "createdDays": p["createdDays"],
            "createdAt": p["createdAt"][:10],
            "lineas_BO": len(p["bo_lines"]),
            "unidades_BO": p["bo_total_u"],
            "valor_BO_ARS": round(p["bo_total_ars"], 2),
            "SAP_post_pedido": sap_summary,
            "DECISION_SUGERIDA": "Enviar a SAP" if sap_recent else "Cancelar BO",
            "pedidoId": p["pedidoId"],
        })

    df_consol = pd.DataFrame(rows_consol).sort_values("valor_BO_ARS", ascending=False)
    total_ars = df_consol["valor_BO_ARS"].sum()
    total_u = df_consol["unidades_BO"].sum()
    print(f"\nTotal BO huerfano: {total_u:.0f}u / ARS ${total_ars:,.0f}")

    with pd.ExcelWriter(OUT_PATH, engine="openpyxl") as w:
        df_consol.to_excel(w, sheet_name="RESUMEN", index=False)
        for p in pedidos_c:
            df_lines = pd.DataFrame(p["bo_lines"])
            sheet_name = (f"ORD{p['orderNumber']}_{p['clientName'][:15]}" if p["orderNumber"] else f"NO_ORD_{p['clientName'][:15]}").replace("/", "-")[:31]
            df_lines.to_excel(w, sheet_name=sheet_name, index=False)

    print(f"\nOK: {OUT_PATH}")
    print(f"\n{'='*80}")
    print("RESUMEN consolidado:")
    print(f"{'='*80}")
    for _, r in df_consol.iterrows():
        print(f"  {r['orderNumber']:>10} {r['clientName'][:30]:30} {r['vendedor'][:20]:20} {r['unidades_BO']:>4.0f}u ${r['valor_BO_ARS']:>12,.0f} [{r['DECISION_SUGERIDA']}]")

if __name__ == "__main__":
    main()
