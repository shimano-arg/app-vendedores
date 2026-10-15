"""Publicar iter_2 (ganador v3) a Firestore forecast_output.

Uso:
    DRY_RUN=true  python scripts/forecast/v3/publish_iter_2.py
    DRY_RUN=false python scripts/forecast/v3/publish_iter_2.py
"""
from __future__ import annotations
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from google.cloud import firestore

SCRIPT_DIR = Path(__file__).resolve().parent
V3_OUT = SCRIPT_DIR / "output"
DRY_RUN = (os.environ.get("DRY_RUN", "true").lower() != "false")
PROJECT = "app-vendedores-shimano"
VERSION_ID = f"v3-iter2-{datetime.now(timezone.utc).strftime('%Y%m%d')}"


def _slug(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "unknown"


def main():
    print(f"=== publish_iter_2 (DRY_RUN={DRY_RUN}, version={VERSION_ID}) ===")
    fcst = pd.read_csv(V3_OUT / "iter_2_forecast_h7.csv")
    best = pd.read_csv(V3_OUT / "iter_2_backtest_por_subfamilia.csv")
    resumen = json.loads((V3_OUT / "iter_2_resumen.json").read_text(encoding="utf-8"))

    print(f"  subfamilias: {fcst['unique_id'].nunique()}")
    print(f"  WAPE mediano iter_2: {resumen['summary']['wape_median']:.4f}")

    db = firestore.Client(project=PROJECT)
    batch_rows = []
    for sub, g in fcst.groupby("unique_id"):
        g = g.sort_values("ds")
        slug = _slug(str(sub))
        m = best[best["unique_id"] == sub]
        metrics = {}
        if not m.empty:
            metrics = {
                "wape": round(float(m["wape"].iloc[0]), 3),
                "bias": round(float(m["bias"].iloc[0]), 3),
                "mae": round(float(m["mae"].iloc[0]), 2),
                "n_obs": int(m["n_obs"].iloc[0]),
            }
        doc_data = {
            "subfamilia": str(sub),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "versionId": VERSION_ID,
            "approach": "iter2 — stat ensemble + sales plan blend",
            "forecast": [
                {
                    "ds": str(r.ds)[:10],
                    "y_hat": int(round(float(r.y_hat))),
                    "model": str(r.model),
                    "alpha": float(r.alpha),
                }
                for r in g.itertuples()
            ],
            "metrics": metrics,
            "config": {
                "backtest_h": resumen["backtest_h"],
                "backtest_windows": resumen["backtest_windows"],
                "horizon": resumen["horizonte"],
            },
        }
        batch_rows.append((slug, doc_data))

    print(f"  docs a escribir: {len(batch_rows)}")
    for slug, data in batch_rows[:3]:
        print(f"    - {slug}: {data['forecast'][:2]}")
    if len(batch_rows) > 3:
        print(f"    ... y {len(batch_rows) - 3} más")

    if DRY_RUN:
        print("=== DRY RUN — nada escrito ===")
        return

    # Escribir batched
    coll = db.collection("forecast_output")
    for slug, data in batch_rows:
        coll.document(slug).set(data)
    # Meta doc
    db.collection("forecast_output_meta").document("current").set({
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "versionId": VERSION_ID,
        "resumen": {
            "approach": "v3-iter2 — ensemble stat + sales plan blend",
            "wape_median": resumen["summary"]["wape_median"],
            "n_subfamilias": resumen["summary"]["n_series"],
            "n_series_wape_lt_0_3": resumen["summary"]["n_series_wape_lt_0_3"],
            "n_series_wape_lt_0_5": resumen["summary"]["n_series_wape_lt_0_5"],
        },
    })
    print(f"=== DONE — {len(batch_rows)} subfamilias publicadas a forecast_output ===")


if __name__ == "__main__":
    main()
