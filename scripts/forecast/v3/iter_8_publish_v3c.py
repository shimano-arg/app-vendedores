"""Publicar iter_8 (v3c demand signals) a Firestore.

Uso:
    DRY_RUN=true  python scripts/forecast/v3/iter_8_publish_v3c.py
    DRY_RUN=false python scripts/forecast/v3/iter_8_publish_v3c.py
"""
from __future__ import annotations
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from google.cloud import firestore

SCRIPT_DIR = Path(__file__).resolve().parent
V3_OUT = SCRIPT_DIR / "output"
DRY_RUN = (os.environ.get("DRY_RUN", "true").lower() != "false")
PROJECT = "app-vendedores-shimano"
VERSION_ID = f"v3c-demandsignals-{datetime.now(timezone.utc).strftime('%Y%m%d')}"


def _slug(s):
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "unknown"


def main():
    print(f"=== publish v3c (DRY_RUN={DRY_RUN}, version={VERSION_ID}) ===")
    fcst = pd.read_csv(V3_OUT / "iter_8_forecast_h7.csv")
    resumen = json.loads((V3_OUT / "iter_8_resumen.json").read_text(encoding="utf-8"))
    print(f"  subs: {fcst['unique_id'].nunique()}")

    # Slug collision check
    slugs = [_slug(str(s)) for s in fcst["unique_id"].unique()]
    assert len(set(slugs)) == len(slugs)

    db = firestore.Client(project=PROJECT)
    batch_rows = []
    for sub, g in fcst.groupby("unique_id"):
        g = g.sort_values("ds")
        slug = _slug(str(sub))
        es_nueva = bool(g["es_nueva_shimano"].iloc[0]) if "es_nueva_shimano" in g.columns else False
        doc_data = {
            "subfamilia": str(sub),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "versionId": VERSION_ID,
            "approach": "v3c — stat ensemble + sales plan + bridge SI + campaign boost + BO signal + stock dep11 + flag nueva",
            "flags": {
                "es_nueva_shimano": es_nueva,
                "stock_dep11_actual": int(round(float(g["stock_dep11_actual"].iloc[0]))),
            },
            "forecast": [
                {
                    "ds": str(r.ds)[:10],
                    "y_hat": int(round(float(r.y_hat))),
                    "model": str(r.model),
                    "alpha": float(r.alpha),
                    "campaign_boost": int(round(float(r.campaign_boost_u))) if r.campaign_boost_u > 0 else 0,
                    "backorder_added": int(round(float(r.backorder_added_u))) if r.backorder_added_u > 0 else 0,
                }
                for r in g.itertuples()
            ],
            "metrics": {
                "note": "WAPE 1-fold 0.398 no es honest-measurable con 7m Shimano. Mejoras CUALITATIVAS: BO sumado al mes 1, campañas boosteadas, subs nuevas con fallback YoY, stock dep11 como metadata informativa.",
                "wape_1fold_optimistic": resumen["summary"]["wape_median"],
            },
            "features_included": resumen["features"],
            "config": {"horizon": 7, "backtest_h": 2},
        }
        batch_rows.append((slug, doc_data))

    print(f"  docs a escribir: {len(batch_rows)}")
    if DRY_RUN:
        print("=== DRY RUN ===")
        return

    coll = db.collection("forecast_output")
    errors = []
    for slug, data in batch_rows:
        try:
            coll.document(slug).set(data)
        except Exception as e:
            errors.append((slug, str(e)))
    db.collection("forecast_output_meta").document("current").set({
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "versionId": VERSION_ID,
        "resumen": {
            "approach": "v3c — demand signals (stock dep11 + BO + campañas + flag nueva + bridge SI)",
            "n_subfamilias": len(batch_rows),
            "stock_dep11_total": resumen["stock_dep11_total"],
            "backorder_total_u": resumen["backorder_total"],
            "campaigns_target_u": resumen["campaigns_target_total"],
            "n_subs_nuevas_shimano": resumen["summary"]["n_subs_nuevas"],
            "nota": "Mejoras cualitativas. WAPE 1-fold 0.398 (NO out-of-sample valido).",
        },
    })
    if errors:
        print(f"=== DONE con {len(errors)} errores:")
        for s, e in errors[:5]:
            print(f"  {s}: {e}")
    else:
        print(f"=== DONE — {len(batch_rows)} subfamilias publicadas v3c ===")


if __name__ == "__main__":
    main()
