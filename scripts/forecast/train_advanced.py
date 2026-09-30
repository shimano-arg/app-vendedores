"""F2A.3+ advanced forecast — Shimano app-vendedores.

Extiende F2A.1 baseline con:
    - Smoothing rolling-3m sobre Baraldo pre-splice para reducir batches.
    - Feature engineering: exógenas macro + derivados anti-colinealidad
      (brecha_mep, devaluacion_implicita_12m), mes-del-año dummy.
    - Modelos: Naive/SeasonalNaive/AutoARIMA + MSTL + LightGBM (mlforecast).
    - Ensemble por serie (media de modelos válidos).
    - Backtest rolling-origin CV comparando 5+ modelos.

Goal: WAPE mediano por subfamilia < 0.5.

Uso: python scripts/forecast/train_advanced.py
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from google.cloud import bigquery
from google.oauth2 import service_account

warnings.filterwarnings("ignore")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Reutilizamos config del baseline
sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_baseline import (  # type: ignore
    BARALDO_TO_SUBFAMILIA,
    BQ_START_DATE,
    HORIZON,
    BACKTEST_WINDOWS,
    SEASON_LENGTH,
    SPLICE_YEAR_MONTH,
    PROJECT,
    DATASET,
    MESES_ES,
    SA_KEY_PATH,
    _parse_baraldo_month,
)

SCRIPT_DIR = Path(__file__).resolve().parent
INPUTS_DIR = SCRIPT_DIR / "inputs"
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

BARALDO_CSV = Path.home() / "Desktop" / "FORECAST" / "DATOS_CRUDOS" / "baraldo_ventas_sku_historico.csv"
EXOGENAS_CSV = INPUTS_DIR / "exogenas.csv"

# Suavizado Baraldo: rolling window mensual para amortiguar batches trimestrales
BARALDO_SMOOTH_WINDOW = 3

# LightGBM lags
LGB_LAGS = [1, 2, 3, 6, 12]
LGB_ROLLING = [3, 6, 12]


# ---------------------------------------------------------------------------
# BQ + Baraldo (redefinidos aquí para poder aplicar smoothing)
# ---------------------------------------------------------------------------
def init_bq_client() -> bigquery.Client:
    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY_PATH),
        scopes=["https://www.googleapis.com/auth/bigquery"],
    )
    return bigquery.Client(project=PROJECT, credentials=creds)


def load_baraldo_subfamilia_smooth() -> pd.DataFrame:
    """Baraldo agregado mensual por subfamilia CON rolling-3m para suavizar batches."""
    b = pd.read_csv(BARALDO_CSV)
    b["subfamilia"] = b["CatItemKey_Norm_Fixed"].map(BARALDO_TO_SUBFAMILIA)
    b = b.dropna(subset=["subfamilia"])
    b["ds"] = b.apply(_parse_baraldo_month, axis=1)
    b = b.dropna(subset=["ds"])
    raw = b.groupby(["subfamilia", "ds"], as_index=False)["Sales Units"].sum().rename(columns={"Sales Units": "y"})

    # Reindex al grid mensual completo por subfamilia + rolling window.
    subs = raw["subfamilia"].unique()
    grid = pd.date_range(raw["ds"].min(), raw["ds"].max(), freq="MS")
    frames = []
    for s in subs:
        g = raw[raw["subfamilia"] == s].set_index("ds")["y"].reindex(grid, fill_value=0.0)
        smoothed = g.rolling(BARALDO_SMOOTH_WINDOW, min_periods=1).mean()
        frames.append(pd.DataFrame({"subfamilia": s, "ds": smoothed.index, "y": smoothed.values}))
    out = pd.concat(frames, ignore_index=True)
    print(f"[baraldo+smooth-{BARALDO_SMOOTH_WINDOW}] {len(out):,} filas · {len(subs)} subfamilias · rango {out['ds'].min().date()} -> {out['ds'].max().date()}")
    return out


def fetch_bq_ventas_subfamilia(bq: bigquery.Client) -> pd.DataFrame:
    sql = f"""
    SELECT
      subfamilia,
      DATE(EXTRACT(YEAR FROM fecha_contable), EXTRACT(MONTH FROM fecha_contable), 1) AS ds,
      SUM(cantidad) AS y
    FROM `{PROJECT}.{DATASET}.v_ventas_lineas`
    WHERE is_pesca = TRUE AND subfamilia IS NOT NULL
      AND fecha_contable >= '{BQ_START_DATE}'
    GROUP BY subfamilia, ds
    HAVING SUM(cantidad) IS NOT NULL AND SUM(cantidad) > 0
    ORDER BY subfamilia, ds
    """
    df = bq.query(sql).to_dataframe()
    df["ds"] = pd.to_datetime(df["ds"])
    df["y"] = df["y"].astype(float).clip(lower=0)
    return df


def merge_and_regrid(bar: pd.DataFrame, bq: pd.DataFrame) -> pd.DataFrame:
    splice_ts = pd.Timestamp(SPLICE_YEAR_MONTH + "-01")
    bar_pre = bar[bar["ds"] < splice_ts].copy()
    bq_post = bq[bq["ds"] >= splice_ts].copy()
    subs = sorted(set(bar_pre["subfamilia"]) | set(bq_post["subfamilia"]))
    grid_start = min(bar_pre["ds"].min(), bq_post["ds"].min())
    grid_end = max(bar_pre["ds"].max(), bq_post["ds"].max())
    all_months = pd.date_range(grid_start, grid_end, freq="MS")

    combined = pd.concat([bar_pre, bq_post], ignore_index=True)
    frames = []
    for sub in subs:
        g = combined[combined["subfamilia"] == sub].set_index("ds")["y"]
        g = g.groupby(level=0).sum()
        s = g.reindex(all_months, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": sub, "ds": s.index, "y": s.values}))
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Exógenas: cargar + derivados anti-colinealidad
# ---------------------------------------------------------------------------
def load_exogenas() -> pd.DataFrame:
    ex = pd.read_csv(EXOGENAS_CSV)
    ex["ds"] = pd.to_datetime(ex["mes"] + "-01")

    # Derivados anti-colinealidad (sugerencia Cowork reporte_exogenas.md)
    ex["brecha_mep"] = (ex["dolar_mep_prom"] / ex["dolar_oficial_prom"] - 1).round(4)
    ex["devaluacion_implicita_12m"] = (ex["dolar_futuro_12m"] / ex["dolar_oficial_prom"] - 1).round(4)

    # Selección de features a usar en el modelo (evitamos niveles nominales)
    features = [
        "ds",
        "rem_ipc_12m",
        "brecha_mep",
        "devaluacion_implicita_12m",
        "tasa_bcra_tna",
        "es_electoral",
        "torneo_grande",
        "confianza_gob",
    ]
    ex = ex[features].copy()

    # Forward-fill de features conocidas en el pasado que no tienen futuro
    # (brecha_mep, devaluacion_implicita, tasa, confianza_gob).
    for c in ["brecha_mep", "devaluacion_implicita_12m", "tasa_bcra_tna", "confianza_gob"]:
        ex[c] = ex[c].ffill()
    return ex


# ---------------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------------
def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    mask = (~np.isnan(y_true)) & (~np.isnan(y_pred))
    if mask.sum() == 0:
        return {"n": 0, "wape": np.nan, "mae": np.nan, "rmse": np.nan, "mape": np.nan}
    yt, yp = y_true[mask].astype(float), y_pred[mask].astype(float)
    mae = float(np.mean(np.abs(yt - yp)))
    rmse = float(np.sqrt(np.mean((yt - yp) ** 2)))
    wape = float(np.sum(np.abs(yt - yp)) / max(np.sum(np.abs(yt)), 1e-9))
    nz = yt > 0
    mape = float(np.mean(np.abs((yt[nz] - yp[nz]) / yt[nz])) * 100) if nz.sum() > 0 else np.nan
    return {
        "n": int(mask.sum()),
        "wape": round(wape, 4),
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "mape": round(mape, 1) if not np.isnan(mape) else None,
    }


def summarize_per_model(cv_df: pd.DataFrame, y_col: str = "y") -> pd.DataFrame:
    """Métricas por subfamilia × modelo, luego mediana global por modelo."""
    model_cols = [c for c in cv_df.columns if c not in ("unique_id", "ds", "cutoff", y_col, "id")]
    rows = []
    for sub, g in cv_df.groupby("unique_id"):
        yt = g[y_col].values.astype(float)
        for m in model_cols:
            yp = g[m].values.astype(float)
            met = compute_metrics(yt, yp)
            rows.append({"unique_id": sub, "model": m, **met})
    per_sub = pd.DataFrame(rows)
    agg = (
        per_sub.groupby("model")
        .agg(
            n_series=("unique_id", "nunique"),
            wape_mediano=("wape", "median"),
            wape_promedio=("wape", "mean"),
            mae_mediano=("mae", "median"),
            rmse_mediano=("rmse", "median"),
        )
        .reset_index()
        .sort_values("wape_mediano")
    )
    return per_sub, agg


# ---------------------------------------------------------------------------
# Modelos: statsforecast + mlforecast
# ---------------------------------------------------------------------------
def run_statsforecast_cv(long_df: pd.DataFrame) -> pd.DataFrame:
    from statsforecast import StatsForecast
    from statsforecast.models import (
        AutoARIMA, Naive, SeasonalNaive, AutoETS, MSTL,
    )

    models = [
        Naive(alias="Naive"),
        SeasonalNaive(season_length=SEASON_LENGTH, alias="SeasonalNaive"),
        AutoARIMA(season_length=SEASON_LENGTH, alias="AutoARIMA"),
        AutoETS(season_length=SEASON_LENGTH, alias="AutoETS"),
        MSTL(season_length=SEASON_LENGTH, alias="MSTL"),
    ]
    sf = StatsForecast(models=models, freq="MS", n_jobs=-1)
    sf_input = long_df[["unique_id", "ds", "y"]].copy()
    cv = sf.cross_validation(df=sf_input, h=HORIZON, step_size=HORIZON, n_windows=BACKTEST_WINDOWS)
    if "unique_id" not in cv.columns:
        cv = cv.reset_index()
    return cv


def run_mlforecast_cv(long_df: pd.DataFrame, exog: pd.DataFrame) -> pd.DataFrame:
    """LightGBM tabular con lags + rolling stats + exógenas mensuales."""
    from mlforecast import MLForecast
    from mlforecast.lag_transforms import RollingMean, RollingStd
    import lightgbm as lgb

    # Preparar dataframe con exógenas mergeado
    df = long_df.merge(exog, on="ds", how="left")
    exog_cols = [c for c in exog.columns if c != "ds"]

    # Features: mes-del-año dummy + year lineal + exógenas
    df["mes"] = df["ds"].dt.month
    df["year_num"] = df["ds"].dt.year - 2020

    static_features = None  # no queremos que use unique_id
    fcst = MLForecast(
        models={
            "LGBM": lgb.LGBMRegressor(
                n_estimators=200, learning_rate=0.05, max_depth=6,
                num_leaves=31, min_child_samples=5, verbosity=-1,
                random_state=42,
            )
        },
        freq="MS",
        lags=LGB_LAGS,
        lag_transforms={l: [RollingMean(window_size=w) for w in LGB_ROLLING] for l in [1]},
        date_features=["month", "quarter"],
    )
    # cross_validation devuelve columnas: unique_id, ds, cutoff, y, LGBM
    cv = fcst.cross_validation(
        df=df[["unique_id", "ds", "y"] + exog_cols + ["mes", "year_num"]],
        h=HORIZON,
        step_size=HORIZON,
        n_windows=BACKTEST_WINDOWS,
        static_features=[],
    )
    if "unique_id" not in cv.columns:
        cv = cv.reset_index()
    return cv


def build_ensemble(cv_sf: pd.DataFrame, cv_ml: pd.DataFrame, ensemble_models: list[str]) -> pd.DataFrame:
    """Combina las columnas de modelos elegidos en un promedio 'Ensemble'."""
    # Merge por (unique_id, ds, cutoff)
    merge_cols = ["unique_id", "ds", "cutoff", "y"]
    df = cv_sf.merge(cv_ml, on=merge_cols, how="inner", suffixes=("", "_ml"))
    valid = [m for m in ensemble_models if m in df.columns]
    df["Ensemble"] = df[valid].mean(axis=1)
    return df


# ---------------------------------------------------------------------------
# Forecast final (refit + H=7 con mejor modelo por serie)
# ---------------------------------------------------------------------------
def refit_and_forecast(long_df: pd.DataFrame, exog: pd.DataFrame, best_per_series: pd.DataFrame) -> pd.DataFrame:
    """Refit modelos best-per-series y devuelve forecast H futuro."""
    from statsforecast import StatsForecast
    from statsforecast.models import AutoARIMA, Naive, SeasonalNaive, AutoETS, MSTL
    from mlforecast import MLForecast
    from mlforecast.lag_transforms import RollingMean
    import lightgbm as lgb

    sf_input = long_df[["unique_id", "ds", "y"]].copy()
    sf = StatsForecast(
        models=[
            Naive(alias="Naive"),
            SeasonalNaive(season_length=SEASON_LENGTH, alias="SeasonalNaive"),
            AutoARIMA(season_length=SEASON_LENGTH, alias="AutoARIMA"),
            AutoETS(season_length=SEASON_LENGTH, alias="AutoETS"),
            MSTL(season_length=SEASON_LENGTH, alias="MSTL"),
        ],
        freq="MS", n_jobs=-1,
    )
    fut_sf = sf.forecast(df=sf_input, h=HORIZON)
    if "unique_id" not in fut_sf.columns:
        fut_sf = fut_sf.reset_index()

    df_ml = long_df.merge(exog, on="ds", how="left")
    df_ml["mes"] = df_ml["ds"].dt.month
    df_ml["year_num"] = df_ml["ds"].dt.year - 2020
    exog_cols = [c for c in exog.columns if c != "ds"]

    fcst = MLForecast(
        models={
            "LGBM": lgb.LGBMRegressor(
                n_estimators=200, learning_rate=0.05, max_depth=6,
                num_leaves=31, min_child_samples=5, verbosity=-1, random_state=42,
            )
        },
        freq="MS",
        lags=LGB_LAGS,
        lag_transforms={1: [RollingMean(window_size=w) for w in LGB_ROLLING]},
        date_features=["month", "quarter"],
    )
    fcst.fit(df_ml[["unique_id", "ds", "y"] + exog_cols + ["mes", "year_num"]], static_features=[])

    # Para forecast necesitamos X_df del futuro (mes, year_num, exógenas ffill)
    max_ds = long_df["ds"].max()
    future_ds = pd.date_range(max_ds + pd.offsets.MonthBegin(1), periods=HORIZON, freq="MS")
    subs = long_df["unique_id"].unique()
    x_future = pd.DataFrame({"unique_id": np.repeat(subs, HORIZON), "ds": np.tile(future_ds, len(subs))})
    x_future = x_future.merge(exog, on="ds", how="left")
    for c in exog_cols:
        x_future[c] = x_future[c].ffill().bfill()
    x_future["mes"] = x_future["ds"].dt.month
    x_future["year_num"] = x_future["ds"].dt.year - 2020

    fut_ml = fcst.predict(h=HORIZON, X_df=x_future)
    if "unique_id" not in fut_ml.columns:
        fut_ml = fut_ml.reset_index()

    # Merge stats + ml
    fut = fut_sf.merge(fut_ml, on=["unique_id", "ds"], how="outer")

    # Ensemble = media de columnas disponibles menos Naive/SeasonalNaive (los usamos solo como referencia)
    ensemble_cols = ["AutoARIMA", "AutoETS", "MSTL", "LGBM"]
    ensemble_cols = [c for c in ensemble_cols if c in fut.columns]
    fut["Ensemble"] = fut[ensemble_cols].mean(axis=1)

    # Asignar predicción según best_model
    best_per_series = best_per_series.rename(columns={"model": "best_model"})
    fut = fut.merge(best_per_series[["unique_id", "best_model"]], on="unique_id", how="left")

    def pick(row):
        m = row.get("best_model")
        if pd.notna(m) and m in row.index:
            return row[m]
        return row.get("Ensemble", np.nan)

    fut["y_hat"] = fut.apply(pick, axis=1)
    fut["y_hat"] = fut["y_hat"].clip(lower=0).round(0).astype("Int64")

    keep_cols = ["unique_id", "ds", "best_model", "y_hat"] + ensemble_cols + ["Ensemble"]
    return fut[keep_cols].sort_values(["unique_id", "ds"])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print("=" * 72)
    print("F2A.3 ADVANCED forecast — subfamilia + smooth Baraldo + exogenas + LGBM + ensemble")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/6] Cargando data...")
    bar = load_baraldo_subfamilia_smooth()
    bq = init_bq_client()
    bqdf = fetch_bq_ventas_subfamilia(bq)
    print(f"  BQ: {len(bqdf)} filas · {bqdf['subfamilia'].nunique()} subfamilias")
    long_df = merge_and_regrid(bar, bqdf)
    print(f"  grid: {long_df['unique_id'].nunique()} subfamilias × {long_df['ds'].nunique()} meses")

    print("\n[2/6] Cargando exógenas + derivados...")
    exog = load_exogenas()
    print(f"  exogenas: {len(exog)} filas · cols: {list(exog.columns)}")

    print("\n[3/6] Backtest statsforecast (5 modelos)...")
    cv_sf = run_statsforecast_cv(long_df)
    per_sf, agg_sf = summarize_per_model(cv_sf)
    print("  agg statsforecast:")
    print(agg_sf.to_string(index=False))

    print("\n[4/6] Backtest mlforecast LightGBM con exógenas...")
    cv_ml = run_mlforecast_cv(long_df, exog)
    per_ml, agg_ml = summarize_per_model(cv_ml)
    print("  agg mlforecast:")
    print(agg_ml.to_string(index=False))

    print("\n[5/6] Backtest Ensemble (AutoARIMA+AutoETS+MSTL+LGBM)...")
    cv_all = build_ensemble(cv_sf, cv_ml, ["AutoARIMA", "AutoETS", "MSTL", "LGBM"])
    per_all, agg_all = summarize_per_model(cv_all)
    print("  agg ALL:")
    print(agg_all.to_string(index=False))

    per_all.to_csv(OUTPUT_DIR / "advanced_backtest_por_subfamilia.csv", index=False)
    agg_all.to_csv(OUTPUT_DIR / "advanced_backtest_agregado.csv", index=False)

    # Best modelo por serie (menor WAPE)
    best_per_series = (
        per_all.sort_values("wape").groupby("unique_id").first().reset_index()[["unique_id", "model", "wape"]]
    )
    best_per_series.to_csv(OUTPUT_DIR / "advanced_best_per_series.csv", index=False)

    print("\n=== TOP 15 BEST-MODEL POR SUBFAMILIA (WAPE ascendente) ===")
    print(best_per_series.sort_values("wape").head(15).to_string(index=False))

    print("\n=== 15 PEORES (WAPE del mejor modelo por serie) ===")
    print(best_per_series.sort_values("wape", ascending=False).head(15).to_string(index=False))

    # Distribución global
    print("\n=== DISTRIBUCIÓN WAPE (best-per-series) ===")
    q = best_per_series["wape"].describe(percentiles=[0.25, 0.5, 0.75, 0.9])
    print(q.to_string())

    print("\n[6/6] Refit + forecast H=7 con best model por serie...")
    forecast_h7 = refit_and_forecast(long_df, exog, best_per_series)
    forecast_h7.to_csv(OUTPUT_DIR / "advanced_forecast_h7.csv", index=False)

    # Top 10 forecast por magnitud
    tot = forecast_h7.groupby("unique_id")["y_hat"].sum().sort_values(ascending=False).head(15)
    top = tot.index
    pv = forecast_h7[forecast_h7["unique_id"].isin(top)].pivot(index="unique_id", columns="ds", values="y_hat")
    pv.columns = [c.strftime("%Y-%m") for c in pv.columns]
    pv = pv.loc[top]
    pv.insert(0, "best_model", best_per_series.set_index("unique_id").loc[top, "model"])
    pv.insert(1, "wape_backtest", best_per_series.set_index("unique_id").loc[top, "wape"].round(3))
    print("\n=== FORECAST H=7 top 15 subfamilias por magnitud ===")
    print(pv.to_string())

    wape_median = float(best_per_series["wape"].median())
    wape_q25 = float(best_per_series["wape"].quantile(0.25))
    wape_q75 = float(best_per_series["wape"].quantile(0.75))
    n_below_05 = int((best_per_series["wape"] < 0.5).sum())
    n_total = len(best_per_series)

    resumen = {
        "generado": t0.isoformat(),
        "approach": "advanced · smooth Baraldo(3m) · exogenas macro · statsforecast+mlforecast · ensemble",
        "modelos_probados": ["Naive", "SeasonalNaive", "AutoARIMA", "AutoETS", "MSTL", "LGBM", "Ensemble"],
        "horizon": HORIZON,
        "backtest_windows": BACKTEST_WINDOWS,
        "n_subfamilias": int(long_df["unique_id"].nunique()),
        "wape_mediano_best_per_series": round(wape_median, 3),
        "wape_p25_best_per_series": round(wape_q25, 3),
        "wape_p75_best_per_series": round(wape_q75, 3),
        "n_series_wape_lt_0_5": n_below_05,
        "n_series_total": n_total,
        "pct_series_wape_lt_0_5": round(n_below_05 / n_total * 100, 1),
        "goal_wape_mediano_lt_0_5": wape_median < 0.5,
    }
    (OUTPUT_DIR / "advanced_resumen.json").write_text(
        json.dumps(resumen, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("\n[done] resumen:")
    print(json.dumps(resumen, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
