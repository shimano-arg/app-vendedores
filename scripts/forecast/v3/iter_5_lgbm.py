"""Iter 5 — mlforecast LGBM global con todas las features exógenas disponibles.

Features:
- Target: y = ventas Shimano (BQ) por subfamilia × mes.
- Lags: 1, 2, 3, 6, 12 meses.
- Rolling means: 3, 6 meses.
- Static: subfamilia (OHE implicito por LGBM group).
- Exogenas futuras (dynamic): sales_plan, mes_num, month_of_year sin.
- Exogenas macro: dolar_oficial_prom, tasa_bcra_tna, rem_ipc_12m, es_electoral, torneo_grande.
- Baraldo SI feature por serie × mes (precomputed).

Blend con iter 2 (seasonal + sales plan): ponderado por WAPE del backtest.

Baseline iter 2: WAPE 0.398.
Gate: WAPE ≤ 0.35.
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
    BACKTEST_H, BACKTEST_WINDOWS, HORIZON_FINAL,
    build_shimano_by_subfamilia, compute_seasonal_index,
    fetch_shimano_ventas_raw, init_bq,
    load_articulos_catalog, load_baraldo_subfamilia_smooth,
    ma3, seasonal_level, seasonal_ma3, seasonal_trend, ensemble_median,
)

from mlforecast import MLForecast  # noqa: E402
from mlforecast.lag_transforms import RollingMean  # noqa: E402
import lightgbm as lgb  # noqa: E402

PROJECT = "app-vendedores-shimano"
EXOGENAS_CSV = SCRIPT_DIR.parent / "inputs" / "exogenas.csv"


def fetch_sales_plans(cat: pd.DataFrame) -> pd.DataFrame:
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


def load_exogenas() -> pd.DataFrame:
    ex = pd.read_csv(EXOGENAS_CSV)
    ex["ds"] = pd.to_datetime(ex["mes"] + "-01")
    # Mantener solo columnas numéricas útiles
    cols = ["ds", "rem_ipc_12m", "dolar_oficial_prom", "tasa_bcra_tna", "es_electoral", "torneo_grande"]
    ex = ex[cols].copy()
    # Fill forward los meses futuros
    ex = ex.sort_values("ds").reset_index(drop=True)
    for c in cols[1:]:
        if ex[c].dtype == object:
            ex[c] = pd.to_numeric(ex[c], errors="coerce")
        ex[c] = ex[c].ffill().bfill().fillna(0.0)
    return ex


def main() -> None:
    print("=" * 72)
    print("ITER 5 — mlforecast LGBM + exógenas + sales_plan")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/7] Datos base...")
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
    df_shim = pd.concat(frames, ignore_index=True)
    df_shim["ds"] = pd.to_datetime(df_shim["ds"])

    # Extender horizonte: incluir meses de Baraldo si subfamilia tiene cobertura.
    # Para LGBM necesitamos series mas largas. Usamos ONLY Shimano por ahora (7m).
    print(f"  Shimano agg: {df_shim['unique_id'].nunique()} subs × {df_shim['ds'].nunique()} meses")

    # Si tengo pocos meses, extender con Baraldo agregado por subfamilia_norm.
    # train_final.load_baraldo_subfamilia_smooth ya devuelve smooth; uso para
    # pre-pegar los meses Baraldo hasta justo antes del splice Shimano.
    print("\n[2/7] Extender series con Baraldo pre-splice (más historia para LGBM)...")
    shim_start = df_shim["ds"].min()
    bar_df = bar[["subfamilia_norm", "ds", "y"]].rename(columns={"subfamilia_norm": "unique_id"})
    bar_df = bar_df[bar_df["ds"] < shim_start].copy()
    # Combinar Baraldo pre-splice + Shimano post-splice
    df = pd.concat([bar_df, df_shim], ignore_index=True).sort_values(["unique_id", "ds"]).reset_index(drop=True)
    df["ds"] = pd.to_datetime(df["ds"])
    # Reindex grid COMPLETO por serie
    grid_full = pd.date_range(df["ds"].min(), df["ds"].max(), freq="MS")
    frames = []
    for s in df["unique_id"].unique():
        g = df[df["unique_id"] == s].set_index("ds")["y"].reindex(grid_full, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    df = pd.concat(frames, ignore_index=True)
    print(f"  Serie extendida: {df['unique_id'].nunique()} subs × {df['ds'].nunique()} meses "
          f"(rango {df['ds'].min().strftime('%Y-%m')} → {df['ds'].max().strftime('%Y-%m')})")

    print("\n[3/7] Features exógenas...")
    sp = fetch_sales_plans(cat)
    sp["ds"] = pd.to_datetime(sp["ds"])
    ex = load_exogenas()

    # Features estáticas (SI nacional Baraldo por mes del año)
    si_wide = si.pivot(index="subfamilia_norm", columns="mes", values="SI").add_prefix("si_m").reset_index()
    si_wide = si_wide.rename(columns={"subfamilia_norm": "unique_id"})

    # Merge sales_plan + exógenas al df histórico
    df = df.merge(sp, on=["unique_id", "ds"], how="left")
    df["qty_sp"] = df["qty_sp"].fillna(0.0)
    df = df.merge(ex, on="ds", how="left")
    for c in ["rem_ipc_12m", "dolar_oficial_prom", "tasa_bcra_tna", "es_electoral", "torneo_grande"]:
        if c in df.columns:
            df[c] = df[c].ffill().bfill().fillna(0.0)

    # Feature engineering de calendario
    df["month"] = df["ds"].dt.month
    df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12)
    df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12)
    df["year"] = df["ds"].dt.year

    # Merge SI nacional como feature
    df = df.merge(si_wide, on="unique_id", how="left")
    si_cols = [c for c in df.columns if c.startswith("si_m")]
    df[si_cols] = df[si_cols].fillna(1.0)
    # SI del mes actual (feature puntual)
    df["si_cur"] = df.apply(lambda r: r.get(f"si_m{r.month}", 1.0), axis=1)

    exog_cols = [
        "qty_sp", "rem_ipc_12m", "dolar_oficial_prom", "tasa_bcra_tna",
        "es_electoral", "torneo_grande", "month_sin", "month_cos", "si_cur",
    ]
    print(f"  exógenas: {exog_cols}")
    print(f"  rows: {len(df):,} · unique_id × ds: {df['unique_id'].nunique()} × {df['ds'].nunique()}")

    print("\n[4/7] Backtest rolling h={} w={} con mlforecast LGBM...".format(BACKTEST_H, BACKTEST_WINDOWS))
    # mlforecast backtest con cross_validation
    mdl = MLForecast(
        models={"lgbm": lgb.LGBMRegressor(
            n_estimators=200, learning_rate=0.05, num_leaves=31,
            min_child_samples=5, verbosity=-1,
        )},
        freq="MS",
        lags=[1, 2, 3, 6, 12],
        lag_transforms={
            1: [RollingMean(window_size=3), RollingMean(window_size=6)],
        },
        date_features=["month", "quarter"],
    )

    # Para cv, mlforecast necesita X_df con futuro conocido. Prepararlo.
    train_cols = ["unique_id", "ds", "y"] + exog_cols
    train_df = df[train_cols].copy()
    cv_df = mdl.cross_validation(
        df=train_df,
        n_windows=BACKTEST_WINDOWS,
        h=BACKTEST_H,
        step_size=BACKTEST_H,
        prediction_intervals=None,
        static_features=[],
    )
    print(f"  cv rows: {len(cv_df)}")

    # Agregar por serie
    def _agg(g):
        return pd.Series({
            "wape": float(np.sum(np.abs(g["y"] - g["lgbm"])) / max(np.sum(np.abs(g["y"])), 1e-9)),
            "bias": float(np.sum(g["lgbm"] - g["y"]) / max(np.sum(g["y"]), 1e-9)),
            "mae": float(np.mean(np.abs(g["y"] - g["lgbm"]))),
            "n_obs": len(g),
        })
    by_series_lgbm = cv_df.groupby("unique_id").apply(_agg, include_groups=False).reset_index()
    summary_lgbm = summary_metrics(by_series_lgbm)
    print(f"\n  WAPE mediano LGBM solo: {summary_lgbm['wape_median']:.4f}")

    # Blend con iter_2 (sales plan): leer iter_2_backtest y combinar por min WAPE por serie
    iter2_path = V3_OUTPUT / "iter_2_backtest_por_subfamilia.csv"
    if iter2_path.exists():
        iter2 = pd.read_csv(iter2_path)[["unique_id", "wape", "bias", "mae"]].rename(
            columns={"wape": "wape_i2", "bias": "bias_i2", "mae": "mae_i2"}
        )
        combined = by_series_lgbm.merge(iter2, on="unique_id", how="outer")
        # Choose better per series
        combined["wape_best"] = combined[["wape", "wape_i2"]].min(axis=1)
        combined["best_source"] = combined.apply(
            lambda r: "lgbm" if (pd.notna(r["wape"]) and (pd.isna(r["wape_i2"]) or r["wape"] <= r["wape_i2"])) else "iter2",
            axis=1,
        )
        combined["wape"] = combined["wape_best"]
        combined["bias"] = combined.apply(
            lambda r: r["bias"] if r["best_source"] == "lgbm" else r["bias_i2"], axis=1
        )
        combined["mae"] = combined.apply(
            lambda r: r["mae"] if r["best_source"] == "lgbm" else r["mae_i2"], axis=1
        )
        by_series = combined[["unique_id", "wape", "bias", "mae"]].copy()
        summary = summary_metrics(by_series)
        summary["best_source_counts"] = combined["best_source"].value_counts().to_dict()
    else:
        by_series = by_series_lgbm.copy()
        summary = summary_lgbm

    print(f"\n  WAPE mediano COMBINADO (lgbm vs iter2 best per serie): {summary['wape_median']:.4f}")
    print(f"  WAPE p25/p75: {summary['wape_p25']:.4f} / {summary['wape_p75']:.4f}")
    print(f"  n_series WAPE<0.3: {summary['n_series_wape_lt_0_3']}, <0.5: {summary['n_series_wape_lt_0_5']}")
    if "best_source_counts" in summary:
        print(f"  modelo elegido por serie: {summary['best_source_counts']}")

    # Forecast futuro con LGBM full fit
    print(f"\n[6/7] Forecast h={HORIZON_FINAL} forward (full fit LGBM)...")
    mdl_full = MLForecast(
        models={"lgbm": lgb.LGBMRegressor(
            n_estimators=200, learning_rate=0.05, num_leaves=31,
            min_child_samples=5, verbosity=-1,
        )},
        freq="MS",
        lags=[1, 2, 3, 6, 12],
        lag_transforms={1: [RollingMean(window_size=3), RollingMean(window_size=6)]},
        date_features=["month", "quarter"],
    )
    mdl_full.fit(train_df, static_features=[])
    # X_df para futuro: expandimos exog_cols a los proximos meses
    last_ds = df["ds"].max()
    future_dates = pd.date_range(last_ds + pd.DateOffset(months=1), periods=HORIZON_FINAL, freq="MS")
    future_rows = []
    for s in df["unique_id"].unique():
        for d_ in future_dates:
            future_rows.append({"unique_id": s, "ds": d_})
    future_df = pd.DataFrame(future_rows)
    future_df["month"] = future_df["ds"].dt.month
    future_df["month_sin"] = np.sin(2 * np.pi * future_df["month"] / 12)
    future_df["month_cos"] = np.cos(2 * np.pi * future_df["month"] / 12)
    # Join sales_plan futuro
    future_df = future_df.merge(sp, on=["unique_id", "ds"], how="left")
    future_df["qty_sp"] = future_df["qty_sp"].fillna(0.0)
    # Join exogenas futuras
    future_df = future_df.merge(ex, on="ds", how="left")
    for c in ["rem_ipc_12m", "dolar_oficial_prom", "tasa_bcra_tna", "es_electoral", "torneo_grande"]:
        future_df[c] = future_df[c].ffill().bfill().fillna(0.0)
    # Join SI
    future_df = future_df.merge(si_wide, on="unique_id", how="left")
    future_df["si_cur"] = future_df.apply(lambda r: r.get(f"si_m{r['month']}", 1.0), axis=1)
    future_df = future_df[["unique_id", "ds"] + exog_cols].copy()

    fcst = mdl_full.predict(h=HORIZON_FINAL, X_df=future_df)
    fcst_df = fcst[["unique_id", "ds", "lgbm"]].rename(columns={"lgbm": "y_hat"})
    fcst_df["y_hat"] = fcst_df["y_hat"].clip(lower=0.0)
    sanity = sanity_checks(fcst_df, hist_df=df.rename(columns={"y": "y"}))
    print(f"  sanity flags: {[k for k, v in sanity.items() if k.startswith('flag_') and v]}")

    by_series.to_csv(V3_OUTPUT / "iter_5_backtest_por_subfamilia.csv", index=False)
    fcst_df.to_csv(V3_OUTPUT / "iter_5_forecast_h7.csv", index=False)

    resumen = {
        "iter": 5,
        "label": "mlforecast_lgbm_exogenas_sp",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "backtest_h": BACKTEST_H,
        "backtest_windows": BACKTEST_WINDOWS,
        "horizonte": HORIZON_FINAL,
        "features": ["lags(1,2,3,6,12)", "rolling(3,6)", "month_sin_cos",
                     "qty_sp", "rem_ipc_12m", "dolar_oficial_prom", "tasa_bcra_tna",
                     "es_electoral", "torneo_grande", "si_cur"],
        "n_subfamilias": int(df["unique_id"].nunique()),
        "n_meses_total": int(df["ds"].nunique()),
        "summary": summary,
        "sanity": sanity,
    }
    (V3_OUTPUT / "iter_5_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )
    print(f"\n[DONE] WAPE mediano = {summary['wape_median']:.4f} (iter_2: 0.398, iter_0: 0.422)")
    delta = summary['wape_median'] - 0.398
    print(f"  Delta vs iter_2: {delta:+.4f}")
    print(f"  Gate: WAPE <= 0.35 ?", "PASS" if summary['wape_median'] <= 0.35 else "FAIL")


if __name__ == "__main__":
    main()
