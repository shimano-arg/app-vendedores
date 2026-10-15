"""Iter 0 - Baseline reproduciendo train_prod/train_final (v2 PROD).

Objetivo: confirmar que podemos reproducir el WAPE 0.476 con un pipeline nuevo
usando los mismos datos. Si no se reproduce, hay bug en el loader. STOP.

Features usadas: solo histórico Baraldo (10y) + Shimano BQ post 2025-09.
Metodo: 6 modelos naive/seasonal + ensemble median.
Backtest: rolling-origin h=2, w=3.

Output: output/iter_0_resumen.json + output/iter_0_backtest_por_subfamilia.csv
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Reusar la pipeline original para que iter_0 sea 1:1 con train_final.
# Si en el futuro quiero desacoplar, agrego loaders propios en common/data_sources.py.
SCRIPT_DIR = Path(__file__).resolve().parent
V2_DIR = SCRIPT_DIR.parent
V3_OUTPUT = SCRIPT_DIR / "output"
V3_OUTPUT.mkdir(exist_ok=True)

sys.path.insert(0, str(V2_DIR))
sys.path.insert(0, str(SCRIPT_DIR))

from common.metrics import summary_metrics, wape_by_series, sanity_checks  # noqa: E402

warnings.filterwarnings("ignore")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from train_final import (  # type: ignore  # noqa: E402
    BACKTEST_H,
    BACKTEST_WINDOWS,
    HORIZON_FINAL,
    LEVEL_WINDOW,
    TREND_WINDOW,
    backtest_series,
    build_shimano_by_subfamilia,
    compute_seasonal_index,
    ensemble_median,
    fetch_shimano_ventas_raw,
    init_bq,
    load_articulos_catalog,
    load_baraldo_subfamilia_smooth,
    ma3,
    naive,
    seasonal_level,
    seasonal_ma3,
    seasonal_naive_yoy,
    seasonal_trend,
)


def main() -> None:
    print("=" * 72)
    print("ITER 0 — Baseline (reproduce train_prod/train_final)")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/5] catálogo Articulos...")
    cat = load_articulos_catalog()

    print("\n[2/5] Baraldo smooth + SI...")
    bar = load_baraldo_subfamilia_smooth()
    si = compute_seasonal_index(bar)

    print("\n[3/5] Shimano ventas BQ post-splice...")
    bq = init_bq()
    shimano_raw = fetch_shimano_ventas_raw(bq)
    shimano_agg = build_shimano_by_subfamilia(shimano_raw, cat)

    subs = shimano_agg["subfamilia_norm"].unique()
    grid = pd.date_range(shimano_agg["ds"].min(), shimano_agg["ds"].max(), freq="MS")
    frames = []
    for s in subs:
        g = shimano_agg[shimano_agg["subfamilia_norm"] == s].set_index("ds")["y"].reindex(grid, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    df = pd.concat(frames, ignore_index=True)
    print(f"  Shimano agg: {df['unique_id'].nunique()} subs × {df['ds'].nunique()} meses")

    print(f"\n[4/5] Backtest rolling h={BACKTEST_H} w={BACKTEST_WINDOWS}...")
    all_cv = []
    for sub, g in df.groupby("unique_id"):
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        cv = backtest_series(g, si_map)
        if not cv.empty:
            all_cv.append(cv)
    cv_all = pd.concat(all_cv, ignore_index=True) if all_cv else pd.DataFrame()
    print(f"  backtest rows: {len(cv_all)}")

    # train_prod usa "best per series": por cada subfamilia, elegir modelo con
    # menor WAPE en backtest, no ensemble plano. Esto reproduce 0.476.
    per_model = wape_by_series(cv_all, series_col="unique_id").copy()  # NOTE: por si queres debug per-modelo
    # Agrupar por (unique_id, model) para computar WAPE por combinacion
    def _agg(g):
        return pd.Series({
            "wape": float(np.sum(np.abs(g["y"] - g["y_hat"])) / max(np.sum(np.abs(g["y"])), 1e-9)),
            "bias": float(np.sum(g["y_hat"] - g["y"]) / max(np.sum(g["y"]), 1e-9)),
            "mae": float(np.mean(np.abs(g["y"] - g["y_hat"]))),
            "n_obs": len(g),
        })
    per_all = cv_all.groupby(["unique_id", "model"]).apply(_agg, include_groups=False).reset_index()
    # Best per series = modelo con menor WAPE por cada subfamilia
    best = per_all.sort_values("wape").groupby("unique_id").first().reset_index()
    by_series = best[["unique_id", "wape", "bias", "mae", "n_obs"]].copy()
    summary = summary_metrics(by_series)
    summary["modelos_elegidos"] = best["model"].value_counts().to_dict()
    print(f"\n  WAPE mediano ensemble: {summary['wape_median']:.4f}")
    print(f"  WAPE p25/p75: {summary['wape_p25']:.4f} / {summary['wape_p75']:.4f}")
    print(f"  n_series WAPE<0.3: {summary['n_series_wape_lt_0_3']}, <0.5: {summary['n_series_wape_lt_0_5']}")

    print(f"\n[5/5] Forecast h={HORIZON_FINAL} forward (ensemble)...")
    last_ds = df["ds"].max()
    start_fcst = (last_ds + pd.DateOffset(months=1)).normalize()
    rows = []
    for sub, g in df.groupby("unique_id"):
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        hist = g.set_index("ds")["y"]
        preds = {
            "MA3": ma3(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_Level": seasonal_level(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_Trend": seasonal_trend(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_MA3": seasonal_ma3(hist, HORIZON_FINAL, start_fcst, si_map),
        }
        ens_pred = ensemble_median(preds)
        for i in range(HORIZON_FINAL):
            rows.append({
                "unique_id": sub,
                "ds": (start_fcst + pd.DateOffset(months=i)).normalize(),
                "y_hat": float(max(0.0, ens_pred[i])),
            })
    fcst_df = pd.DataFrame(rows)

    sanity = sanity_checks(fcst_df, hist_df=df)
    print(f"  sanity flags: {[k for k, v in sanity.items() if k.startswith('flag_') and v]}")

    # Guardar
    by_series.to_csv(V3_OUTPUT / "iter_0_backtest_por_subfamilia.csv", index=False)
    fcst_df.to_csv(V3_OUTPUT / "iter_0_forecast_h7.csv", index=False)

    resumen = {
        "iter": 0,
        "label": "baseline_v2_reproduce",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "backtest_h": BACKTEST_H,
        "backtest_windows": BACKTEST_WINDOWS,
        "level_window": LEVEL_WINDOW,
        "trend_window": TREND_WINDOW,
        "horizonte": HORIZON_FINAL,
        "features": ["baraldo_SI", "shimano_BQ_level"],
        "n_subfamilias": int(df["unique_id"].nunique()),
        "n_meses_shimano": int(df["ds"].nunique()),
        "summary": summary,
        "sanity": sanity,
    }
    (V3_OUTPUT / "iter_0_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )
    print(f"\n[DONE] WAPE mediano = {summary['wape_median']:.4f}")
    print(f"  Resumen: {V3_OUTPUT / 'iter_0_resumen.json'}")
    print(f"  Gate: 0.466 <= {summary['wape_median']:.4f} <= 0.486 ?",
          "PASS" if 0.466 <= summary['wape_median'] <= 0.486 else "FAIL")


if __name__ == "__main__":
    main()
