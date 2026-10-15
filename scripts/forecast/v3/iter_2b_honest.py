"""Iter 2b — nested CV honesto. Fix del hyperparameter leak detectado por
silent-failure-hunter.

En iter_2 original, el `winner_alpha` se elegía minimizando WAPE EN los mismos
folds de test que después reportaban como métrica. Eso es hyperparameter leak:
el 0.398 era optimista 0.02-0.05.

Fix: 2 estrategias comparadas
A) Nested CV: usar folds 1-2 para elegir alpha, fold 3 como test honesto.
B) Alpha global fijo (0.3) sin tuneo per-series, reportado como métrica honesta.

Reportamos ambos. El que gane es el verdadero baseline out-of-sample.
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

from metrics import summary_metrics  # noqa: E402
from google.cloud import firestore  # noqa: E402

warnings.filterwarnings("ignore")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from train_final import (  # type: ignore  # noqa: E402
    BACKTEST_H, HORIZON_FINAL,
    build_shimano_by_subfamilia, compute_seasonal_index,
    fetch_shimano_ventas_raw, init_bq,
    load_articulos_catalog, load_baraldo_subfamilia_smooth,
    ma3, seasonal_level, seasonal_ma3, seasonal_trend, ensemble_median,
)

PROJECT = "app-vendedores-shimano"
ALPHAS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
# Nested CV: 2 folds para pick alpha + modelo, 1 fold para evaluar honestamente
BACKTEST_WINDOWS_TUNE = 2
BACKTEST_WINDOWS_EVAL = 1  # fold mas reciente, no usado en tune


def fetch_sales_plans(cat):
    db = firestore.Client(project=PROJECT)
    snap = db.collection("sales_plan_cache").get()
    code_to_sub = dict(zip(cat["item_code"].str.upper(), cat["subfamilia_norm"]))
    rows = []
    n_dropped = 0
    for d in snap:
        data = d.to_dict() or {}
        for r in data.get("rows", []):
            sku = str(r.get("sku", "")).upper().strip()
            if not sku:
                continue
            sub = code_to_sub.get(sku)
            if not sub:
                continue
            for mes_str, qty in (r.get("months", {}) or {}).items():
                try:
                    ds = pd.to_datetime(mes_str + "-01")
                    q = float(qty) if qty else 0.0
                except Exception:
                    n_dropped += 1
                    continue
                if q <= 0:
                    continue
                rows.append({"unique_id": sub, "ds": ds, "qty_sp": q})
    if n_dropped > 0:
        print(f"  [WARN] {n_dropped} filas sales_plan dropeadas por parseo malo")
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
    print("ITER 2b — nested CV honesto (fix hyperparameter leak de iter_2)")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/5] Datos...")
    cat = load_articulos_catalog()
    bar = load_baraldo_subfamilia_smooth()
    si = compute_seasonal_index(bar)
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

    sp = fetch_sales_plans(cat)
    sp["ds"] = pd.to_datetime(sp["ds"])
    sp_map = {(r.unique_id, r.ds): r.qty_sp for r in sp.itertuples()}

    print(f"\n[2/5] Nested CV: tune en folds 1-2, test honesto en fold 3...")
    # Para cada serie: 3 folds rolling. Usamos folds 0,1 para pick (model, alpha).
    # Fold 2 (más reciente) es test HONESTO: fijamos los hyperparams y medimos.
    rows_honest_eval = []
    rows_fixed_alpha_eval = []
    FIXED_ALPHA = 0.3

    for sub, g in df.groupby("unique_id"):
        g = g.sort_values("ds").reset_index(drop=True)
        n = len(g)
        if n < 4 + BACKTEST_H:  # minimo 1 fold de h=2 + 4 meses train
            continue
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}

        # Definir folds: todos los que entren non-overlapping.
        # Con 7 meses y h=2: solo 1 fold limpio (train 5, test 2).
        # Para este caso solo evaluamos alpha fijo, no nested tune.
        starts_all = [n - BACKTEST_H * k for k in range(3, 0, -1)]
        starts_all = [s for s in starts_all if s >= 4]

        folds_data = []
        for sidx in starts_all:
            train = g.iloc[:sidx]
            test = g.iloc[sidx:sidx + BACKTEST_H]
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
                "models": models,
                "sp_vals": sp_vals,
                "y": test["y"].values,
            })

        if not folds_data:
            continue
        # Si tengo >=2 folds hago nested CV. Si no, salto (no se puede medir honesto).
        if len(folds_data) >= 2:
            tune_folds = folds_data[:-1]
            eval_fold = folds_data[-1]
            # Pick (model, alpha) que minimiza WAPE en tune_folds
            best = (None, None, float("inf"))
            for mname in folds_data[0]["models"].keys():
                for alpha in ALPHAS:
                    total_abs_err = 0.0
                    total_abs_y = 0.0
                    for f in tune_folds:
                        stat = f["models"][mname]
                        y_hat = blended(stat, f["sp_vals"], alpha)
                        total_abs_err += np.sum(np.abs(f["y"] - y_hat))
                        total_abs_y += np.sum(np.abs(f["y"]))
                    wape = total_abs_err / max(total_abs_y, 1e-9)
                    if wape < best[2]:
                        best = (mname, alpha, wape)
            winner_model, winner_alpha, wape_tune = best
            stat_eval = eval_fold["models"][winner_model]
            y_hat_eval = blended(stat_eval, eval_fold["sp_vals"], winner_alpha)
            y_eval = eval_fold["y"]
            wape_eval = float(np.sum(np.abs(y_eval - y_hat_eval)) / max(np.sum(np.abs(y_eval)), 1e-9))
            bias_eval = float(np.sum(y_hat_eval - y_eval) / max(np.sum(y_eval), 1e-9))
            mae_eval = float(np.mean(np.abs(y_eval - y_hat_eval)))
            rows_honest_eval.append({
                "unique_id": sub, "model": winner_model, "alpha": winner_alpha,
                "wape_tune": wape_tune, "wape": wape_eval, "bias": bias_eval,
                "mae": mae_eval, "n_obs": len(y_eval),
            })
        # Siempre evaluar alpha fijo en el ultimo fold (medida honesta)
        eval_fold = folds_data[-1]
        y_eval = eval_fold["y"]

        # Comparativa: alpha fijo 0.3 con ensemble_median
        stat_fx = eval_fold["models"]["Ensemble_Median"]
        y_hat_fx = blended(stat_fx, eval_fold["sp_vals"], FIXED_ALPHA)
        wape_fx = float(np.sum(np.abs(y_eval - y_hat_fx)) / max(np.sum(np.abs(y_eval)), 1e-9))
        rows_fixed_alpha_eval.append({
            "unique_id": sub, "model": "Ensemble_Median", "alpha": FIXED_ALPHA,
            "wape": wape_fx,
            "bias": float(np.sum(y_hat_fx - y_eval) / max(np.sum(y_eval), 1e-9)),
            "mae": float(np.mean(np.abs(y_eval - y_hat_fx))),
            "n_obs": len(y_eval),
        })

    by_series_honest = pd.DataFrame(rows_honest_eval)
    by_series_fixed = pd.DataFrame(rows_fixed_alpha_eval)
    summary_honest = summary_metrics(by_series_honest)
    summary_fixed = summary_metrics(by_series_fixed)

    print(f"\n  [NESTED CV HONESTO] WAPE mediano eval: {summary_honest['wape_median']:.4f}")
    print(f"    p25/p75: {summary_honest['wape_p25']:.4f} / {summary_honest['wape_p75']:.4f}")
    print(f"    n<0.3: {summary_honest['n_series_wape_lt_0_3']} · n<0.5: {summary_honest['n_series_wape_lt_0_5']}")

    print(f"\n  [ALPHA FIJO 0.3 + Ensemble_Median] WAPE mediano eval: {summary_fixed['wape_median']:.4f}")
    print(f"    p25/p75: {summary_fixed['wape_p25']:.4f} / {summary_fixed['wape_p75']:.4f}")
    print(f"    n<0.3: {summary_fixed['n_series_wape_lt_0_3']} · n<0.5: {summary_fixed['n_series_wape_lt_0_5']}")

    by_series_honest.to_csv(V3_OUTPUT / "iter_2b_honest_eval.csv", index=False)
    by_series_fixed.to_csv(V3_OUTPUT / "iter_2b_fixed_alpha_eval.csv", index=False)

    resumen = {
        "iter": "2b",
        "label": "nested_cv_honest",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "n_series_evaluated": int(len(by_series_honest)),
        "nested_cv_honest": summary_honest,
        "alpha_fijo_0_3": summary_fixed,
        "nota": "iter_2 original tenia hyperparameter leak. 0.398 era optimista; honest = numero real out-of-sample.",
    }
    (V3_OUTPUT / "iter_2b_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )
    best_approach = "nested_cv" if summary_honest["wape_median"] <= summary_fixed["wape_median"] else "alpha_fijo_0_3"
    print(f"\n  Ganador honest: {best_approach}")
    print(f"  Comparacion vs iter_2 'optimista' 0.398:")
    print(f"    nested CV honesto:  {summary_honest['wape_median']:.4f} (delta {summary_honest['wape_median']-0.398:+.4f})")
    print(f"    alpha fijo 0.3:     {summary_fixed['wape_median']:.4f} (delta {summary_fixed['wape_median']-0.398:+.4f})")
    print(f"  Comparacion vs iter_0 baseline honesto 0.422:")
    print(f"    nested CV honesto:  delta {summary_honest['wape_median']-0.422:+.4f}")


if __name__ == "__main__":
    main()
