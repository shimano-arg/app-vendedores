"""F2A.4 — Publica forecast_output a Firestore para consumo del modal FORECAST.

Lee output/prod_forecast_h7.csv + output/prod_best_per_series.csv y escribe:
    forecast_output/{subfamilia_slug}  con { subfamilia, forecast[], metrics, generatedAt, versionId }

Rules: solo Mariano puede read/write (whitelist email en firestore.rules).

Uso:
    python scripts/forecast/publish_to_firestore.py [--dry-run]
"""
from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from train_baseline import SA_KEY_PATH, PROJECT  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR / "output"

FORECAST_CSV = OUTPUT_DIR / "prod_forecast_h7.csv"
BEST_CSV = OUTPUT_DIR / "prod_best_per_series.csv"
RESUMEN_JSON = OUTPUT_DIR / "prod_resumen.json"


def _slug(s: str) -> str:
    """Convierte 'FW Casting' -> 'fw_casting'. Firestore doc IDs no aceptan / o . por separado."""
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s[:120] or "sin_nombre"


def init_firestore():
    from google.cloud import firestore
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY_PATH),
        scopes=["https://www.googleapis.com/auth/datastore"],
    )
    return firestore.Client(project=PROJECT, credentials=creds)


def main() -> None:
    dry_run = "--dry-run" in sys.argv

    import json
    resumen = json.loads(RESUMEN_JSON.read_text(encoding="utf-8"))
    version_id = resumen.get("generado", "").replace(":", "").replace("-", "").split(".")[0]

    fc = pd.read_csv(FORECAST_CSV)
    best = pd.read_csv(BEST_CSV)
    print(f"[read] {len(fc)} forecast rows · {len(best)} best-per-series")
    print(f"[version_id] {version_id}")

    db = init_firestore() if not dry_run else None

    # Agrupar forecast por subfamilia -> lista de meses
    docs_written = 0
    for sub, g in fc.groupby("unique_id"):
        b = best[best["unique_id"] == sub]
        if b.empty:
            continue
        forecast_list = [
            {
                "ds": row["ds"],
                "y_hat": int(row["y_hat"]),
                "lo80": int(row["lo80"]),
                "hi80": int(row["hi80"]),
            }
            for _, row in g.sort_values("ds").iterrows()
        ]
        payload = {
            "subfamilia": sub,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "versionId": version_id,
            "forecast": forecast_list,
            "bestModel": b["model"].iloc[0],
            "metrics": {
                "wape": float(b["wape"].iloc[0]),
                "bias": float(b["bias"].iloc[0]),
                "mae": float(b["mae"].iloc[0]),
                "rmse": float(b["rmse"].iloc[0]),
                "n_obs": int(b["n_obs"].iloc[0]),
            },
            "config": {
                "backtest_h": resumen.get("backtest_h"),
                "backtest_windows": resumen.get("backtest_windows"),
                "horizon": resumen.get("horizon_final"),
                "approach": resumen.get("approach"),
            },
        }
        doc_id = _slug(sub)
        if dry_run:
            print(f"  [DRY] forecast_output/{doc_id}  wape={payload['metrics']['wape']:.3f}  best={payload['bestModel']}")
        else:
            db.collection("forecast_output").document(doc_id).set(payload)
        docs_written += 1

    # Meta doc con métricas globales
    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "versionId": version_id,
        "resumen": resumen,
    }
    if dry_run:
        print(f"  [DRY] forecast_output_meta/current")
    else:
        db.collection("forecast_output_meta").document("current").set(meta)
    docs_written += 1
    print(f"[done] {docs_written} docs {'previstos' if dry_run else 'escritos'}")


if __name__ == "__main__":
    main()
