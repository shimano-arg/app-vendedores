"""Opcion B - Etapa 4: iter con bridge aplicado SOLO al SI (estacionalidad).

Learning de etapa 3: pegar los niveles Baraldo + Shimano empalma escalas
distintas (Baraldo = mercado total, Shimano = nuestro share). Esto genera
BIAS -42% porque el modelo entrenado en el nivel alto predice en el nivel
bajo.

Fix: usar el bridge SOLO para extender el SI (indice estacional por mes),
pero el nivel sigue siendo Shimano directo. Es lo que ya hace iter_0/iter_2,
pero con 5 subs mas que antes quedaban sin SI (APPAREL, ACCESORIES, MONOLINE,
SW TRAVEL, FW TRAVEL).

Esto deberia:
- Resolver el 'flag_too_many_constant' de iter_2 (8 subs sin SI → MA3 flat).
- Mejorar las 5 subs ahora con SI historica.
- Mantener el resto igual.

Compara vs iter_0/iter_2 CON la misma strategy (best per series + grid alpha
HONEST con nested CV cuando sea posible, best effort con 1 fold cuando no).
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
ALPHAS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]


def fetch_sales_plans(cat):
    db = firestore.Client(project=PROJECT)
    snap = db.collection("sales_plan_cache").get()
    code_to_sub = dict(zip(cat["item_code"].str.upper(), cat["subfamilia_norm"]))
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
            # Nota: aqui NO aplicamos bridge al cliente de sales plan. El
            # sales_plan refleja plan de ventas por subfamilia Shimano actual
            # (APPAREL, no INDUMENTARIA). Lo dejamos en name Shimano.
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
    print("OPCION B - ETAPA 4: iter con bridge aplicado SOLO al SI")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/6] Datos base...")
    cat = load_articulos_catalog()
    bar = load_baraldo_subfamilia_smooth()
    si = compute_seasonal_index(bar)
    # SI tiene subs Baraldo. Para que lookup del lado Shimano matchee,
    # creamos un SI augmentado donde cada sub Shimano gap tenga el SI
    # de su sub Baraldo asociada.
    si_aug_rows = []
    for shim_sub, bar_sub in BRIDGE_SHIM_TO_BAR.items():
        if bar_sub in si["subfamilia_norm"].values:
            si_bar = si[si["subfamilia_norm"] == bar_sub].copy()
            si_bar["subfamilia_norm"] = shim_sub
            si_aug_rows.append(si_bar)
    if si_aug_rows:
        si_aug = pd.concat([si] + si_aug_rows, ignore_index=True)
    else:
        si_aug = si
    print(f"  SI base: {si['subfamilia_norm'].nunique()} subs")
    print(f"  SI augmentado con bridge: {si_aug['subfamilia_norm'].nunique()} subs (+{si_aug['subfamilia_norm'].nunique() - si['subfamilia_norm'].nunique()} via bridge)")

    bq = init_bq()
    shim_raw = fetch_shimano_ventas_raw(bq)
    shim_agg = build_shimano_by_subfamilia(shim_raw, cat)
    subs = shim_agg["subfamilia_norm"].unique()
    grid = pd.date_range(shim_agg["ds"].min(), shim_agg["ds"].max(), freq="MS")
    frames = []
    for s in subs:
        g = shim_agg[shim_agg["subfamilia_norm"] == s].set_index("ds")["y"].reindex(grid, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    df = pd.concat(frames, ignore_index=True)
    df["ds"] = pd.to_datetime(df["ds"])
    print(f"  Shimano agg: {df['unique_id'].nunique()} subs × {df['ds'].nunique()} meses")

    print("\n[2/6] Sales plans...")
    sp = fetch_sales_plans(cat)
    sp["ds"] = pd.to_datetime(sp["ds"])
    sp_map = {(r.unique_id, r.ds): r.qty_sp for r in sp.itertuples()} if not sp.empty else {}

    print(f"\n[3/6] Backtest nested CV honest (tune 2 folds, eval 1 fold)...")
    rows_honest = []
    rows_tune_as_metric = []  # para comparar con iter_2 que reportaba tune WAPE

    for sub, g in df.groupby("unique_id"):
        g = g.sort_values("ds").reset_index(drop=True)
        n = len(g)
        if n < 4 + BACKTEST_H:
            continue
        si_sub = si_aug[si_aug["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}

        # Definir folds
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
            folds_data.append({"models": models, "sp_vals": sp_vals, "y": test["y"].values})

        if not folds_data:
            continue

        if len(folds_data) >= 2:
            # Nested CV: tune en todos menos ultimo, eval en ultimo.
            tune_folds = folds_data[:-1]
            eval_fold = folds_data[-1]
            best = (None, None, float("inf"))
            for mname in folds_data[0]["models"].keys():
                for alpha in ALPHAS:
                    te = 0.0; ty = 0.0
                    for f in tune_folds:
                        yh = blended(f["models"][mname], f["sp_vals"], alpha)
                        te += np.sum(np.abs(f["y"] - yh))
                        ty += np.sum(np.abs(f["y"]))
                    wape = te / max(ty, 1e-9)
                    if wape < best[2]:
                        best = (mname, alpha, wape)
            winner_m, winner_a, wape_tune = best
            stat_e = eval_fold["models"][winner_m]
            yhe = blended(stat_e, eval_fold["sp_vals"], winner_a)
            ye = eval_fold["y"]
            wape_eval = float(np.sum(np.abs(ye - yhe)) / max(np.sum(np.abs(ye)), 1e-9))
            bias_eval = float(np.sum(yhe - ye) / max(np.sum(ye), 1e-9))
            mae_eval = float(np.mean(np.abs(ye - yhe)))
            rows_honest.append({
                "unique_id": sub, "model": winner_m, "alpha": winner_a,
                "wape_tune": wape_tune, "wape": wape_eval, "bias": bias_eval,
                "mae": mae_eval, "n_obs": len(ye),
            })
        else:
            # 1 fold: solo tune WAPE para comparacion con iter_2 (reportable como "optimista")
            eval_fold = folds_data[-1]
            best = (None, None, float("inf"))
            for mname in folds_data[0]["models"].keys():
                for alpha in ALPHAS:
                    yh = blended(eval_fold["models"][mname], eval_fold["sp_vals"], alpha)
                    wape = float(np.sum(np.abs(eval_fold["y"] - yh)) / max(np.sum(np.abs(eval_fold["y"])), 1e-9))
                    if wape < best[2]:
                        best = (mname, alpha, wape)
            winner_m, winner_a, wape_1f = best
            rows_tune_as_metric.append({
                "unique_id": sub, "model": winner_m, "alpha": winner_a,
                "wape": wape_1f,
            })

    print(f"  nested CV evaluado: {len(rows_honest)} series")
    print(f"  single-fold (optimistic): {len(rows_tune_as_metric)} series")

    if rows_honest:
        by_series_honest = pd.DataFrame(rows_honest)
        summary_honest = summary_metrics(by_series_honest)
        summary_honest["modelos_elegidos"] = by_series_honest["model"].value_counts().to_dict()
        summary_honest["alphas_elegidos"] = by_series_honest["alpha"].value_counts().sort_index().to_dict()
        print(f"\n  [HONEST eval {len(by_series_honest)} series] WAPE mediano: {summary_honest['wape_median']:.4f}")
        print(f"    p25/p75: {summary_honest['wape_p25']:.4f} / {summary_honest['wape_p75']:.4f}")
        print(f"    n<0.3: {summary_honest['n_series_wape_lt_0_3']} · n<0.5: {summary_honest['n_series_wape_lt_0_5']}")
        print(f"    modelos: {summary_honest['modelos_elegidos']}")
        print(f"    alphas: {summary_honest['alphas_elegidos']}")
    else:
        summary_honest = {}

    # Forecast futuro
    print(f"\n[5/6] Forecast h={HORIZON_FINAL} forward...")
    last_ds = df["ds"].max()
    start_fcst = (last_ds + pd.DateOffset(months=1)).normalize()
    fcst_rows = []
    all_eval = pd.DataFrame(rows_honest + rows_tune_as_metric)
    for sub, g in df.groupby("unique_id"):
        best_sub = all_eval[all_eval["unique_id"] == sub] if not all_eval.empty else pd.DataFrame()
        if best_sub.empty:
            continue
        winner_m = best_sub["model"].iloc[0]
        winner_a = best_sub["alpha"].iloc[0] if "alpha" in best_sub.columns else 0.0
        si_sub = si_aug[si_aug["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        hist = g.set_index("ds")["y"]
        preds = {
            "MA3": ma3(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_Level": seasonal_level(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_Trend": seasonal_trend(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_MA3": seasonal_ma3(hist, HORIZON_FINAL, start_fcst, si_map),
        }
        preds["Ensemble_Median"] = ensemble_median(preds)
        stat_f = preds[winner_m]
        sp_vals_f = np.array([
            sp_map.get((sub, (start_fcst + pd.DateOffset(months=i)).normalize()), 0.0)
            for i in range(HORIZON_FINAL)
        ])
        yp = blended(stat_f, sp_vals_f, winner_a)
        for i in range(HORIZON_FINAL):
            fcst_rows.append({
                "unique_id": sub,
                "ds": (start_fcst + pd.DateOffset(months=i)).normalize(),
                "y_hat": float(max(0.0, yp[i])),
                "model": winner_m,
                "alpha": winner_a,
            })
    fcst_df = pd.DataFrame(fcst_rows)
    sanity = sanity_checks(fcst_df, hist_df=df)
    print(f"  n_series forecast: {fcst_df['unique_id'].nunique()}")
    print(f"  sanity flags: {[k for k, v in sanity.items() if k.startswith('flag_') and v]}")

    fcst_df.to_csv(V3_OUTPUT / "opt_b_siOnly_forecast_h7.csv", index=False)
    if rows_honest:
        pd.DataFrame(rows_honest).to_csv(V3_OUTPUT / "opt_b_siOnly_honest_eval.csv", index=False)

    resumen = {
        "etapa": "opcB_etapa4_si_only",
        "label": "shimano_level_bridge_SI_only",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "bridge_renames": BRIDGE_SHIM_TO_BAR,
        "n_subfamilias_total": int(df["unique_id"].nunique()),
        "n_series_honest_eval": len(rows_honest),
        "n_series_single_fold": len(rows_tune_as_metric),
        "si_aug_subs": int(si_aug["subfamilia_norm"].nunique()),
        "summary_honest": summary_honest,
        "sanity_forecast": sanity,
        "comparativa": {
            "iter_0_sin_bridge_optimista": 0.422,
            "iter_2_sin_bridge_optimista": 0.398,
            "iter_7_prophet_sin_bridge_honest": 0.871,
            "opcB_etapa3_bridge_niveles_honest": 0.760,
            "opcB_etapa4_bridge_SI_only_honest": float(summary_honest.get("wape_median", -1)) if rows_honest else None,
        },
    }
    (V3_OUTPUT / "opt_b_siOnly_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )

    print(f"\n[DONE]")
    print(f"  Comparacion completa:")
    print(f"    iter_0 (optimista):            0.422")
    print(f"    iter_2 (optimista):            0.398")
    print(f"    iter_7 Prophet (HONEST 1f):    0.871")
    print(f"    opcB etapa3 bridge niveles:   0.760 (bug: escalas distintas)")
    if rows_honest:
        print(f"    opcB etapa4 bridge SI only:    {summary_honest['wape_median']:.4f} HONEST")


if __name__ == "__main__":
    main()
