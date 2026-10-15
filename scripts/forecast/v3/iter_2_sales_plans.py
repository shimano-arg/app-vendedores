"""Iter 2 — Sales plans como anchor / blender del forecast estadistico.

Hipotesis: cuando el equipo comercial tiene sales plan para un SKU × mes, es
señal directa de demanda esperada (más limpia que el histórico ruidoso).
Blend ponderado: forecast_final = alpha * sales_plan + (1-alpha) * forecast_stat.

Fuentes nuevas:
- Firestore sales_plan_cache (reels + rods, ~1145 SKUs, cobertura 2021-01 → 2027-12)

Approach:
1. Cargar sales plans → agregar por subfamilia × mes.
2. En el backtest, para cada ventana predecir con el modelo stat ganador +
   blendear con sales_plan si existe. Grid search alpha ∈ [0, 0.2, 0.4, 0.6, 0.8, 1.0]
   por subfamilia, elegir el mejor por WAPE.
3. Forecast futuro: usar winner_alpha por subfamilia.

Baseline a batir: 0.422 (iter 0). Iter 1 fue rollback.
Gate: WAPE <= 0.38.
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
V2_DIR = SCRIPT_DIR.parent
V3_OUTPUT = SCRIPT_DIR / "output"
V3_OUTPUT.mkdir(exist_ok=True)

sys.path.insert(0, str(V2_DIR))
sys.path.insert(0, str(SCRIPT_DIR))

from common.metrics import summary_metrics, sanity_checks  # noqa: E402
from google.cloud import firestore  # noqa: E402

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
    build_shimano_by_subfamilia,
    compute_seasonal_index,
    fetch_shimano_ventas_raw,
    init_bq,
    load_articulos_catalog,
    load_baraldo_subfamilia_smooth,
    ma3,
    seasonal_level,
    seasonal_ma3,
    seasonal_trend,
    ensemble_median,
)

PROJECT = "app-vendedores-shimano"


def fetch_sales_plans(cat: pd.DataFrame) -> pd.DataFrame:
    """Carga sales_plan_cache de Firestore. Devuelve DataFrame con
    columnas unique_id (subfamilia_norm), ds, qty_sp (suma SKUs de la subfamilia)."""
    print("  [firestore] sales_plan_cache ...")
    db = firestore.Client(project=PROJECT)
    snap = db.collection("sales_plan_cache").get()
    code_to_sub = dict(zip(cat["item_code"].str.upper(), cat["subfamilia_norm"]))

    all_rows = []
    for d in snap:
        data = d.to_dict() or {}
        for r in data.get("rows", []):
            sku = str(r.get("sku", "")).upper().strip()
            if not sku:
                continue
            months = r.get("months", {}) or {}
            sub = code_to_sub.get(sku)
            if not sub:
                continue
            for mes_str, qty in months.items():
                try:
                    ds = pd.to_datetime(mes_str + "-01")
                except Exception:
                    continue
                try:
                    q = float(qty) if qty else 0.0
                except Exception:
                    q = 0.0
                if q <= 0:
                    continue
                all_rows.append({"unique_id": sub, "ds": ds, "qty_sp": q})
    if not all_rows:
        return pd.DataFrame(columns=["unique_id", "ds", "qty_sp"])
    df = pd.DataFrame(all_rows).groupby(["unique_id", "ds"], as_index=False)["qty_sp"].sum()
    print(f"  sales_plan agregado: {df['unique_id'].nunique()} subs × {df['ds'].nunique()} meses")
    print(f"  rango: {df['ds'].min().strftime('%Y-%m')} → {df['ds'].max().strftime('%Y-%m')}")
    return df


ALPHAS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]


def blended_forecast(stat_preds: np.ndarray, sp_values: np.ndarray, alpha: float) -> np.ndarray:
    """Blend simple: alpha * sales_plan + (1-alpha) * stat. Donde sp es 0 (no hay plan),
    usar stat crudo (alpha=0 implicito)."""
    out = []
    for s, p in zip(stat_preds, sp_values):
        if p > 0:
            out.append(alpha * p + (1 - alpha) * s)
        else:
            out.append(s)
    return np.array(out)


def main() -> None:
    print("=" * 72)
    print("ITER 2 — sales plans como anchor (blend ensemble + sales_plan)")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/6] catálogo + Baraldo SI...")
    cat = load_articulos_catalog()
    bar = load_baraldo_subfamilia_smooth()
    si = compute_seasonal_index(bar)

    print("\n[2/6] Shimano ventas BQ...")
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

    print("\n[3/6] Sales plans Firestore...")
    sp = fetch_sales_plans(cat)
    sp_map = {(r.unique_id, r.ds): r.qty_sp for r in sp.itertuples()} if not sp.empty else {}

    # Cobertura: cuantos pares (sub, mes) en el histórico Shimano tienen sales plan
    shim_pairs = [(r.unique_id, r.ds) for r in df.itertuples()]
    sp_cov = sum(1 for p in shim_pairs if p in sp_map) / max(len(shim_pairs), 1)
    print(f"  cobertura sales_plan en histórico Shimano: {100*sp_cov:.1f}%")

    print(f"\n[4/6] Backtest rolling con grid search alpha ∈ {ALPHAS}...")
    best_rows = []
    for sub, g in df.groupby("unique_id"):
        g = g.sort_values("ds").reset_index(drop=True)
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        n = len(g)
        if n < 4 + BACKTEST_H:
            continue
        max_start = n - BACKTEST_H
        starts = list(range(max_start - (BACKTEST_WINDOWS - 1) * BACKTEST_H, max_start + 1, BACKTEST_H))
        starts = [s for s in starts if s >= 4]

        # Para cada ventana, computar predicciones de todos los modelos
        all_fold_preds = []  # (fold_idx, model, preds_array, test_y_array, test_ds_array)
        for start_idx in starts:
            train = g.iloc[:start_idx]
            test = g.iloc[start_idx:start_idx + BACKTEST_H]
            history = train.set_index("ds")["y"]
            start_ds = test["ds"].iloc[0]
            h = len(test)
            models = {
                "MA3": ma3(history, h, start_ds, si_map),
                "Seasonal_Level": seasonal_level(history, h, start_ds, si_map),
                "Seasonal_Trend": seasonal_trend(history, h, start_ds, si_map),
                "Seasonal_MA3": seasonal_ma3(history, h, start_ds, si_map),
            }
            models["Ensemble_Median"] = ensemble_median(models)
            sp_vals = np.array([sp_map.get((sub, test["ds"].iloc[i]), 0.0) for i in range(h)])
            for model_name, preds in models.items():
                for alpha in ALPHAS:
                    blended = blended_forecast(preds, sp_vals, alpha)
                    all_fold_preds.append({
                        "model": model_name,
                        "alpha": alpha,
                        "y_hat": blended,
                        "y": test["y"].values,
                        "ds": test["ds"].values,
                    })

        # Agregar WAPE por (model, alpha) across folds
        df_fold = []
        for p in all_fold_preds:
            df_fold.append(pd.DataFrame({
                "model": p["model"], "alpha": p["alpha"],
                "y": p["y"], "y_hat": p["y_hat"],
            }))
        if not df_fold:
            continue
        folds = pd.concat(df_fold, ignore_index=True)
        agg = folds.groupby(["model", "alpha"]).apply(lambda z: pd.Series({
            "wape": float(np.sum(np.abs(z["y"] - z["y_hat"])) / max(np.sum(np.abs(z["y"])), 1e-9)),
            "bias": float(np.sum(z["y_hat"] - z["y"]) / max(np.sum(z["y"]), 1e-9)),
            "mae": float(np.mean(np.abs(z["y"] - z["y_hat"]))),
            "n_obs": len(z),
        }), include_groups=False).reset_index()
        best = agg.sort_values("wape").iloc[0]
        best_rows.append({
            "unique_id": sub, "model": best["model"], "alpha": float(best["alpha"]),
            "wape": float(best["wape"]), "bias": float(best["bias"]),
            "mae": float(best["mae"]), "n_obs": int(best["n_obs"]),
        })

    by_series = pd.DataFrame(best_rows)
    summary = summary_metrics(by_series)
    summary["modelos_elegidos"] = by_series["model"].value_counts().to_dict()
    summary["alphas_elegidos"] = by_series["alpha"].value_counts().sort_index().to_dict()

    print(f"\n  WAPE mediano: {summary['wape_median']:.4f}")
    print(f"  WAPE p25/p75: {summary['wape_p25']:.4f} / {summary['wape_p75']:.4f}")
    print(f"  n_series WAPE<0.3: {summary['n_series_wape_lt_0_3']}, <0.5: {summary['n_series_wape_lt_0_5']}")
    print(f"  alphas elegidos: {summary['alphas_elegidos']}")

    # Forecast futuro con winner_alpha por serie
    print(f"\n[5/6] Forecast h={HORIZON_FINAL} forward...")
    last_ds = df["ds"].max()
    start_fcst = (last_ds + pd.DateOffset(months=1)).normalize()
    rows = []
    for sub, g in df.groupby("unique_id"):
        best_sub = by_series[by_series["unique_id"] == sub]
        if best_sub.empty:
            continue
        winner_model = best_sub["model"].iloc[0]
        winner_alpha = best_sub["alpha"].iloc[0]
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        hist = g.set_index("ds")["y"]
        models = {
            "MA3": ma3(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_Level": seasonal_level(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_Trend": seasonal_trend(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_MA3": seasonal_ma3(hist, HORIZON_FINAL, start_fcst, si_map),
        }
        models["Ensemble_Median"] = ensemble_median(models)
        stat_preds = models[winner_model]
        sp_vals = np.array([
            sp_map.get((sub, (start_fcst + pd.DateOffset(months=i)).normalize()), 0.0)
            for i in range(HORIZON_FINAL)
        ])
        blended = blended_forecast(stat_preds, sp_vals, winner_alpha)
        for i in range(HORIZON_FINAL):
            rows.append({
                "unique_id": sub,
                "ds": (start_fcst + pd.DateOffset(months=i)).normalize(),
                "y_hat": float(max(0.0, blended[i])),
                "model": winner_model,
                "alpha": winner_alpha,
            })
    fcst_df = pd.DataFrame(rows)
    sanity = sanity_checks(fcst_df, hist_df=df)
    print(f"  sanity flags: {[k for k, v in sanity.items() if k.startswith('flag_') and v]}")

    by_series.to_csv(V3_OUTPUT / "iter_2_backtest_por_subfamilia.csv", index=False)
    fcst_df.to_csv(V3_OUTPUT / "iter_2_forecast_h7.csv", index=False)

    resumen = {
        "iter": 2,
        "label": "sales_plans_blend_anchor",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "backtest_h": BACKTEST_H,
        "backtest_windows": BACKTEST_WINDOWS,
        "level_window": LEVEL_WINDOW,
        "trend_window": TREND_WINDOW,
        "horizonte": HORIZON_FINAL,
        "features": ["baraldo_SI", "shimano_BQ_level", "sales_plan_blend"],
        "alphas_grid": ALPHAS,
        "sp_coverage_pct_hist": round(100 * sp_cov, 1),
        "n_subfamilias": int(df["unique_id"].nunique()),
        "n_meses_shimano": int(df["ds"].nunique()),
        "summary": summary,
        "sanity": sanity,
    }
    (V3_OUTPUT / "iter_2_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )
    print(f"\n[DONE] WAPE mediano = {summary['wape_median']:.4f} (baseline iter_0: 0.422)")
    delta = summary['wape_median'] - 0.422
    print(f"  Delta vs baseline: {delta:+.4f}")
    print(f"  Gate: WAPE <= 0.38 ?", "PASS" if summary['wape_median'] <= 0.38 else "FAIL")


if __name__ == "__main__":
    main()
