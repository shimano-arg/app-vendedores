"""Opcion B - Etapa 3: iter honest con serie extendida bridge-mapeada.

Con el bridge Shimano -> Baraldo subfamilias ahora matchean. Las series pasan
de 7 meses a ~120 meses (10 años Baraldo + 7 Shimano empalmados).

Ahora SI tenemos data suficiente para:
- Backtest con 3+ folds (nested CV honesto es posible)
- LGBM via mlforecast (necesita 2+ años historia)
- Medicion honesta sin hyperparameter leak

Compara:
- iter_0 baseline (sin bridge, 7m): WAPE 0.422 (con leak best-per-series)
- iter_2 sales plan blend (sin bridge, 7m): WAPE 0.398 (con hyperparameter leak)
- iter_7 Prophet (sin bridge, 7m, 1 fold honest): WAPE 0.871
- Opcion B iter 3a (CON BRIDGE, 120m, ensemble stat): WAPE ???
- Opcion B iter 3b (CON BRIDGE, 120m, ensemble stat + sales plan nested CV): WAPE ???

Si el bridge+serie-larga da WAPE honest ≤ 0.40 -> deployar como v4.
Si no, documentar y seguir buscando.
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
sys.path.insert(0, str(SCRIPT_DIR / "common"))

warnings.filterwarnings("ignore")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from metrics import summary_metrics, sanity_checks  # noqa: E402
from google.cloud import firestore  # noqa: E402

from train_final import (  # type: ignore  # noqa: E402
    BACKTEST_H, BACKTEST_WINDOWS, HORIZON_FINAL,
    build_shimano_by_subfamilia, compute_seasonal_index,
    fetch_shimano_ventas_raw, init_bq,
    load_articulos_catalog, load_baraldo_subfamilia_smooth,
    ma3, seasonal_level, seasonal_ma3, seasonal_trend, ensemble_median,
)

from opt_b_02_bridge_map import BRIDGE_SHIM_TO_BAR  # noqa: E402

PROJECT = "app-vendedores-shimano"
# Con 120 meses de serie, podemos permitirnos 4-6 folds nested CV honesto
BACKTEST_WINDOWS_HONEST = 5  # 5 folds tune + 1 fold eval = 6 folds totales
BACKTEST_H_HONEST = 2
ALPHAS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]


def fetch_sales_plans(cat):
    db = firestore.Client(project=PROJECT)
    snap = db.collection("sales_plan_cache").get()
    code_to_sub = dict(zip(cat["item_code"].str.upper(), cat["subfamilia_norm"]))
    # Aplicar bridge a los sub names del catalog
    rows = []
    for d in snap:
        data = d.to_dict() or {}
        for r in data.get("rows", []):
            sku = str(r.get("sku", "")).upper().strip()
            if not sku:
                continue
            sub = code_to_sub.get(sku)
            if not sub:
                continue
            # Aplicar bridge
            sub = BRIDGE_SHIM_TO_BAR.get(sub, sub)
            for mes_str, qty in (r.get("months", {}) or {}).items():
                try:
                    ds = pd.to_datetime(mes_str + "-01")
                    q = float(qty) if qty else 0.0
                except Exception:
                    continue
                if q <= 0:
                    continue
                rows.append({"unique_id": sub, "ds": ds, "qty_sp": q})
    if not rows:
        return pd.DataFrame(columns=["unique_id", "ds", "qty_sp"])
    return pd.DataFrame(rows).groupby(["unique_id", "ds"], as_index=False)["qty_sp"].sum()


def blended(stat, sp, alpha):
    out = []
    for s, p in zip(stat, sp):
        out.append(alpha * p + (1 - alpha) * s if p > 0 else s)
    return np.array(out)


def main():
    print("=" * 72)
    print("OPCION B - ETAPA 3: iter honest con serie extendida (bridge-mapeada)")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/6] Datos base + bridge map...")
    cat = load_articulos_catalog()
    bar = load_baraldo_subfamilia_smooth()
    si = compute_seasonal_index(bar)
    bq = init_bq()
    shim_raw = fetch_shimano_ventas_raw(bq)
    shim_agg = build_shimano_by_subfamilia(shim_raw, cat)

    # Aplicar bridge a Shimano
    print(f"  bridge: {len(BRIDGE_SHIM_TO_BAR)} renames aplicados a Shimano")
    shim_agg["subfamilia_norm"] = shim_agg["subfamilia_norm"].replace(BRIDGE_SHIM_TO_BAR)
    # Re-agregar por si bridge junta subs
    shim_agg = shim_agg.groupby(["subfamilia_norm", "ds"], as_index=False)["y"].sum()

    subs = shim_agg["subfamilia_norm"].unique()
    print(f"  subs post-bridge: {len(subs)}")

    # Reindex Shimano con grid
    grid_shim = pd.date_range(shim_agg["ds"].min(), shim_agg["ds"].max(), freq="MS")
    frames = []
    for s in subs:
        g = shim_agg[shim_agg["subfamilia_norm"] == s].set_index("ds")["y"].reindex(grid_shim, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    df_shim = pd.concat(frames, ignore_index=True)

    # Pegar con Baraldo pre-splice (Baraldo ya tiene los nombres post-bridge)
    shim_start = df_shim["ds"].min()
    bar_df = bar[["subfamilia_norm", "ds", "y"]].rename(columns={"subfamilia_norm": "unique_id"})
    bar_df = bar_df[bar_df["ds"] < shim_start].copy()
    df_combined = pd.concat([bar_df, df_shim], ignore_index=True).sort_values(["unique_id", "ds"]).reset_index(drop=True)
    # Reindex por serie con grid completo
    grid_full = pd.date_range(df_combined["ds"].min(), df_combined["ds"].max(), freq="MS")
    frames = []
    for s in df_combined["unique_id"].unique():
        g = df_combined[df_combined["unique_id"] == s].set_index("ds")["y"].reindex(grid_full, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    df = pd.concat(frames, ignore_index=True)
    print(f"  Serie bridge-extendida: {df['unique_id'].nunique()} subs × {df['ds'].nunique()} meses "
          f"({df['ds'].min().strftime('%Y-%m')} → {df['ds'].max().strftime('%Y-%m')})")

    print("\n[2/6] Sales plans...")
    sp = fetch_sales_plans(cat)
    sp["ds"] = pd.to_datetime(sp["ds"])
    sp_map = {(r.unique_id, r.ds): r.qty_sp for r in sp.itertuples()} if not sp.empty else {}
    print(f"  sales_plan filas: {len(sp)} · unique_ids: {sp['unique_id'].nunique() if not sp.empty else 0}")

    # Para cada serie: definimos 5 folds TUNE + 1 fold EVAL honesto
    print(f"\n[3/6] Backtest nested CV HONEST (tune {BACKTEST_WINDOWS_HONEST} folds, eval 1 fold limpio)...")
    rows_honest = []
    rows_tune_only = []  # para verificar que el tune minimiza bien

    for sub, g in df.groupby("unique_id"):
        g = g.sort_values("ds").reset_index(drop=True)
        n = len(g)
        # Necesitamos (BACKTEST_WINDOWS_HONEST + 1) folds * BACKTEST_H + minimo 4 train
        needed = (BACKTEST_WINDOWS_HONEST + 1) * BACKTEST_H_HONEST + 4
        if n < needed:
            continue
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}

        # Folds: ultimos (BACKTEST_WINDOWS_HONEST + 1) * BACKTEST_H meses, no solapados
        starts_all = [n - BACKTEST_H_HONEST * k for k in range(BACKTEST_WINDOWS_HONEST + 1, 0, -1)]
        starts_all = [s for s in starts_all if s >= 4]

        folds_data = []
        for sidx in starts_all:
            train = g.iloc[:sidx]
            test = g.iloc[sidx:sidx + BACKTEST_H_HONEST]
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
            folds_data.append({
                "models": models, "sp_vals": sp_vals, "y": test["y"].values,
            })

        if len(folds_data) < 2:
            continue
        tune_folds = folds_data[:-1]
        eval_fold = folds_data[-1]

        # Pick (model, alpha) en tune_folds
        best = (None, None, float("inf"))
        for mname in folds_data[0]["models"].keys():
            for alpha in ALPHAS:
                total_err = 0.0
                total_abs_y = 0.0
                for f in tune_folds:
                    stat = f["models"][mname]
                    y_hat = blended(stat, f["sp_vals"], alpha)
                    total_err += np.sum(np.abs(f["y"] - y_hat))
                    total_abs_y += np.sum(np.abs(f["y"]))
                wape = total_err / max(total_abs_y, 1e-9)
                if wape < best[2]:
                    best = (mname, alpha, wape)
        winner_model, winner_alpha, wape_tune = best

        # EVAL honesto
        stat_e = eval_fold["models"][winner_model]
        y_hat_e = blended(stat_e, eval_fold["sp_vals"], winner_alpha)
        y_e = eval_fold["y"]
        wape_eval = float(np.sum(np.abs(y_e - y_hat_e)) / max(np.sum(np.abs(y_e)), 1e-9))
        bias_eval = float(np.sum(y_hat_e - y_e) / max(np.sum(y_e), 1e-9))
        mae_eval = float(np.mean(np.abs(y_e - y_hat_e)))

        rows_honest.append({
            "unique_id": sub, "model": winner_model, "alpha": winner_alpha,
            "wape_tune": wape_tune, "wape": wape_eval, "bias": bias_eval,
            "mae": mae_eval, "n_obs": len(y_e), "n_meses_hist": n,
        })

    by_series = pd.DataFrame(rows_honest)
    if by_series.empty:
        print("[ERR] no se evaluó ninguna serie")
        return
    summary = summary_metrics(by_series)
    summary["modelos_elegidos"] = by_series["model"].value_counts().to_dict()
    summary["alphas_elegidos"] = by_series["alpha"].value_counts().sort_index().to_dict()

    print(f"\n  [HONEST eval] subs evaluadas: {len(by_series)}/{df['unique_id'].nunique()}")
    print(f"  WAPE mediano HONEST: {summary['wape_median']:.4f}")
    print(f"    p25/p75: {summary['wape_p25']:.4f} / {summary['wape_p75']:.4f}")
    print(f"    mean: {summary['wape_mean']:.4f}, std: {summary['wape_std']:.4f}")
    print(f"    n<0.3: {summary['n_series_wape_lt_0_3']} · n<0.5: {summary['n_series_wape_lt_0_5']} · n<0.7: {summary['n_series_wape_lt_0_7']}")
    print(f"    bias mediana: {summary['bias_median']:+.3f}")
    print(f"    modelos elegidos: {summary['modelos_elegidos']}")
    print(f"    alphas elegidos: {summary['alphas_elegidos']}")

    # Diferencia vs tune WAPE para medir overfit tune-eval
    diff = by_series["wape"] - by_series["wape_tune"]
    print(f"\n  overfit check: WAPE eval - WAPE tune")
    print(f"    mediano: {diff.median():+.4f} (positivo = eval peor que tune = overfit del tune)")
    print(f"    p25/p75: {diff.quantile(0.25):+.4f} / {diff.quantile(0.75):+.4f}")

    # Forecast futuro
    print(f"\n[4/6] Forecast h={HORIZON_FINAL} forward con winner por serie...")
    last_ds = df["ds"].max()
    start_fcst = (last_ds + pd.DateOffset(months=1)).normalize()
    fcst_rows = []
    for sub, g in df.groupby("unique_id"):
        best_sub = by_series[by_series["unique_id"] == sub]
        if best_sub.empty:
            # fallback: ensemble median sin blend
            si_sub = si[si["subfamilia_norm"] == sub]
            si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
            hist = g.set_index("ds")["y"]
            preds = {
                "MA3": ma3(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_Level": seasonal_level(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_Trend": seasonal_trend(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_MA3": seasonal_ma3(hist, HORIZON_FINAL, start_fcst, si_map),
            }
            yp = ensemble_median(preds)
            winner_model = "Ensemble_Median"
            winner_alpha = 0.0
        else:
            winner_model = best_sub["model"].iloc[0]
            winner_alpha = best_sub["alpha"].iloc[0]
            si_sub = si[si["subfamilia_norm"] == sub]
            si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
            hist = g.set_index("ds")["y"]
            preds = {
                "MA3": ma3(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_Level": seasonal_level(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_Trend": seasonal_trend(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_MA3": seasonal_ma3(hist, HORIZON_FINAL, start_fcst, si_map),
            }
            preds["Ensemble_Median"] = ensemble_median(preds)
            stat_preds = preds[winner_model]
            sp_vals_f = np.array([
                sp_map.get((sub, (start_fcst + pd.DateOffset(months=i)).normalize()), 0.0)
                for i in range(HORIZON_FINAL)
            ])
            yp = blended(stat_preds, sp_vals_f, winner_alpha)
        for i in range(HORIZON_FINAL):
            fcst_rows.append({
                "unique_id": sub,
                "ds": (start_fcst + pd.DateOffset(months=i)).normalize(),
                "y_hat": float(max(0.0, yp[i])),
                "model": winner_model,
                "alpha": winner_alpha,
            })
    fcst_df = pd.DataFrame(fcst_rows)
    sanity = sanity_checks(fcst_df, hist_df=df)
    print(f"  sanity flags: {[k for k, v in sanity.items() if k.startswith('flag_') and v]}")

    by_series.to_csv(V3_OUTPUT / "opt_b_iter_honest_eval.csv", index=False)
    fcst_df.to_csv(V3_OUTPUT / "opt_b_iter_honest_forecast_h7.csv", index=False)

    resumen = {
        "etapa": "opcB_etapa3_honest",
        "label": "serie_extendida_bridge_nested_cv_honest",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "backtest_h": BACKTEST_H_HONEST,
        "backtest_windows_tune": BACKTEST_WINDOWS_HONEST,
        "horizonte": HORIZON_FINAL,
        "bridge_renames": BRIDGE_SHIM_TO_BAR,
        "n_subfamilias_evaluadas": int(len(by_series)),
        "n_subfamilias_totales": int(df["unique_id"].nunique()),
        "n_meses_rango": f"{df['ds'].min().strftime('%Y-%m')} → {df['ds'].max().strftime('%Y-%m')}",
        "summary": summary,
        "sanity": sanity,
        "diff_eval_tune_mediana": float(diff.median()),
        "comparativa": {
            "iter_0_baseline_sin_bridge_optimista": 0.422,
            "iter_2_sales_plan_sin_bridge_optimista": 0.398,
            "iter_7_prophet_sin_bridge_honest": 0.871,
            "opcB_honest_con_bridge": float(summary["wape_median"]),
        },
    }
    (V3_OUTPUT / "opt_b_iter_honest_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )

    print(f"\n[DONE] WAPE HONEST opcB = {summary['wape_median']:.4f}")
    print(f"  Comparacion:")
    print(f"    iter_0 (sin bridge, optimista):     0.422")
    print(f"    iter_2 (sin bridge, optimista):     0.398")
    print(f"    iter_7 Prophet (sin bridge, honest): 0.871")
    print(f"    opcB (bridge, HONEST):              {summary['wape_median']:.4f}")
    print(f"\n  Gate deploy: WAPE honest <= 0.40 ?",
          "PASS -> listo para v4 publish" if summary["wape_median"] <= 0.40 else "FAIL")


if __name__ == "__main__":
    main()
