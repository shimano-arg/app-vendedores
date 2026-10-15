"""Opcion B - Etapa 5: publicar v3b a Firestore con bridge SI aplicado.

Mejora sobre iter_2 publicado:
- 5 subs (APPAREL, ACCESORIES, MONOLINE, SW TRAVEL, FW TRAVEL) ahora tienen
  SI historica de Baraldo que antes no tenian. En iter_2 estaban como MA3 flat.

Resto igual: ensemble stat + sales plan blend por serie.

NO reclamamos mejora cuantitativa de WAPE porque con 7m Shimano no podemos
medir honestamente. Reclamamos mejora cualitativa: las 5 subs dejan de ser
forecast plano y respetan patron estacional historico.

Usa:
    DRY_RUN=true  python scripts/forecast/v3/opt_b_05_publish_v3b.py
    DRY_RUN=false python scripts/forecast/v3/opt_b_05_publish_v3b.py
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
VERSION_ID = f"v3b-bridgeSI-{datetime.now(timezone.utc).strftime('%Y%m%d')}"


def _slug(s):
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "unknown"


def main():
    print(f"=== publish v3b (DRY_RUN={DRY_RUN}, version={VERSION_ID}) ===")
    fcst = pd.read_csv(V3_OUT / "opt_b_siOnly_forecast_h7.csv")
    print(f"  subfamilias: {fcst['unique_id'].nunique()}")

    # Check slugs
    slugs = [_slug(str(s)) for s in fcst["unique_id"].unique()]
    assert len(set(slugs)) == len(slugs), "Slug collision detected"
    print(f"  slug collision check: OK ({len(slugs)} unicos)")

    db = firestore.Client(project=PROJECT)
    batch_rows = []
    for sub, g in fcst.groupby("unique_id"):
        g = g.sort_values("ds")
        slug = _slug(str(sub))
        doc_data = {
            "subfamilia": str(sub),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "versionId": VERSION_ID,
            "approach": "v3b — ensemble stat + sales plan blend + bridge SI (5 subs extras con estacionalidad)",
            "forecast": [
                {
                    "ds": str(r.ds)[:10],
                    "y_hat": int(round(float(r.y_hat))),
                    "model": str(r.model),
                    "alpha": float(r.alpha),
                }
                for r in g.itertuples()
            ],
            "metrics": {
                "note": "WAPE no reportado — nested CV requiere 10+ meses Shimano, tenemos 7. Mejora cualitativa: 5 subs (APPAREL, ACCESORIES, MONOLINE, SW TRAVEL, FW TRAVEL) ahora tienen estacionalidad en vez de constante.",
            },
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
            "approach": "v3b — bridge SI applied (5 extra subs with estacionalidad historica)",
            "n_subfamilias": len(batch_rows),
            "nota": "Mejora cualitativa sobre v3-iter2. WAPE no medible honestly con 7m Shimano.",
        },
    })
    if errors:
        print(f"=== DONE con {len(errors)} errores:")
        for s, e in errors[:5]:
            print(f"  {s}: {e}")
    else:
        print(f"=== DONE — {len(batch_rows)} subfamilias publicadas ===")


if __name__ == "__main__":
    main()
