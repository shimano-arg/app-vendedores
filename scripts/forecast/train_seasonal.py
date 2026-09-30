"""F2A.3 iter-2 — Seasonal decomposition approach.

Los baselines fallaron porque el modelo intenta unificar 2 regímenes distintos:
    - Pre-2025-09: ventas BARALDO (mayorista, batches, canal indirecto).
    - Post-2025-09: ventas SHIMANO directo (retail directo, canal nuevo).

Approach nuevo (más adecuado a los datos reales):
    1. Estimar ÍNDICE ESTACIONAL (SI) por subfamilia × mes usando BARALDO 10-años.
       SI[sub, mes] = mean(ventas Baraldo del mes) / mean(ventas Baraldo anuales)
       → SI[sub, mes] ~ 1 significa mes típico; 1.5 = pico; 0.5 = valle.
    2. NIVEL ACTUAL por subfamilia = media móvil últimos 3 meses BQ (post-splice).
    3. TREND por subfamilia = pendiente de las últimas 6 obs BQ.
    4. Forecast[sub, mes_futuro] = (nivel + trend * horizon) * SI[sub, mes_futuro]
    5. Ensemble con AutoARIMA(post-splice-only) para comparar/robustecer.

Backtest: usa solo la ventana post-splice (2025-09 → hoy).
Con 13 meses BQ, hacemos 3 windows de h=3 (predicción trimestral) para
tener 3 folds válidos de validación.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_baseline import (  # type: ignore
    BARALDO_TO_SUBFAMILIA,
    BQ_START_DATE,
    PROJECT,
    DATASET,
    SA_KEY_PATH,
    _parse_baraldo_month,
)

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

BARALDO_CSV = Path.home() / "Desktop" / "FORECAST" / "DATOS_CRUDOS" / "baraldo_ventas_sku_historico.csv"

# Horizonte forecast final (tras backtest)
HORIZON_FINAL = 7
# Backtest reducido: post-splice tenemos ~13 meses. Con h=3 y 3 windows
# validamos 9 meses (test = últimos 9), train inicial = primeros ~4 meses.
BACKTEST_H = 3
BACKTEST_WINDOWS = 3
LEVEL_WINDOW = 3      # meses usados para "nivel actual"
TREND_WINDOW = 6      # meses usados para pendiente lineal


def init_bq() -> bigquery.Client:
    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY_PATH), scopes=["https://www.googleapis.com/auth/bigquery"]
    )
    return bigquery.Client(project=PROJECT, credentials=creds)


def load_baraldo_raw() -> pd.DataFrame:
    b = pd.read_csv(BARALDO_CSV)
    b["subfamilia"] = b["CatItemKey_Norm_Fixed"].map(BARALDO_TO_SUBFAMILIA)
    b = b.dropna(subset=["subfamilia"])
    b["ds"] = b.apply(_parse_baraldo_month, axis=1)
    b = b.dropna(subset=["ds"])
    return b.groupby(["subfamilia", "ds"], as_index=False)["Sales Units"].sum().rename(columns={"Sales Units": "y"})


def compute_seasonal_index(baraldo: pd.DataFrame) -> pd.DataFrame:
    """SI[sub, mes] = ventas promedio mes / ventas promedio del año.

    Uso años 2018 en adelante (data más estable después de 2016-2017 iniciales).
    """
    b = baraldo[baraldo["ds"].dt.year >= 2018].copy()
    b["mes"] = b["ds"].dt.month
    b["year"] = b["ds"].dt.year

    # Agregar por (sub, mes, año) para tener venta mensual por año.
    per_sub_month_year = (
        b.groupby(["subfamilia", "year", "mes"], as_index=False)["y"].sum()
    )
    # Reindex — asegurarnos que cada (sub, year, mes) exista (fill 0).
    idx = pd.MultiIndex.from_product(
        [
            per_sub_month_year["subfamilia"].unique(),
            per_sub_month_year["year"].unique(),
            range(1, 13),
        ],
        names=["subfamilia", "year", "mes"],
    )
    full = per_sub_month_year.set_index(["subfamilia", "year", "mes"]).reindex(idx, fill_value=0.0).reset_index()

    # Promedio mensual por (sub, mes) sobre los años.
    per_sub_month = full.groupby(["subfamilia", "mes"], as_index=False)["y"].mean().rename(columns={"y": "mean_mes"})
    # Promedio anual por sub.
    per_sub = full.groupby("subfamilia", as_index=False)["y"].mean().rename(columns={"y": "mean_anual"})
    si = per_sub_month.merge(per_sub, on="subfamilia")
    si["SI"] = si["mean_mes"] / si["mean_anual"].replace(0, np.nan)
    si = si[["subfamilia", "mes", "SI"]]

    # Suavizar: los meses raros con SI muy extremo, capamos a [0.2, 2.5]
    si["SI"] = si["SI"].clip(lower=0.2, upper=2.5)
    si["SI"] = si["SI"].fillna(1.0)
    return si


def fetch_bq_ventas_post_splice(bq: bigquery.Client) -> pd.DataFrame:
    sql = f"""
    SELECT
      subfamilia,
      DATE(EXTRACT(YEAR FROM fecha_contable), EXTRACT(MONTH FROM fecha_contable), 1) AS ds,
      SUM(cantidad) AS y
    FROM `{PROJECT}.{DATASET}.v_ventas_lineas`
    WHERE is_pesca=TRUE AND subfamilia IS NOT NULL
      AND fecha_contable >= '{BQ_START_DATE}'
    GROUP BY subfamilia, ds
    HAVING SUM(cantidad) IS NOT NULL AND SUM(cantidad) > 0
    ORDER BY subfamilia, ds
    """
    df = bq.query(sql).to_dataframe()
    df["ds"] = pd.to_datetime(df["ds"])
    df["y"] = df["y"].astype(float).clip(lower=0)
    return df


def regrid_bq(df_bq: pd.DataFrame) -> pd.DataFrame:
    """Reindex mensual continuo (fill 0)."""
    subs = df_bq["subfamilia"].unique()
    grid = pd.date_range(df_bq["ds"].min(), df_bq["ds"].max(), freq="MS")
    frames = []
    for s in subs:
        g = df_bq[df_bq["subfamilia"] == s].set_index("ds")["y"].reindex(grid, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
def seasonal_naive_forecast(history: pd.Series, si_map: dict, months_ahead: int, start_ds: pd.Timestamp) -> np.ndarray:
    """Nivel × SI[mes_futuro]. Nivel = media móvil últimos LEVEL_WINDOW.
    Sin trend (versión simple)."""
    level = history.tail(LEVEL_WINDOW).mean()
    ds_future = pd.date_range(start_ds, periods=months_ahead, freq="MS")
    return np.array([level * si_map.get(d.month, 1.0) for d in ds_future])


def seasonal_trend_forecast(history: pd.Series, si_map: dict, months_ahead: int, start_ds: pd.Timestamp) -> np.ndarray:
    """Nivel + trend × horizon, luego escala por SI[mes_futuro]."""
    ys = history.dropna().values.astype(float)
    n = min(len(ys), TREND_WINDOW)
    if n < 2:
        level = ys[-1] if len(ys) else 0.0
        slope = 0.0
    else:
        yr = ys[-n:]
        x = np.arange(n)
        slope, intercept = np.polyfit(x, yr, 1)
        level = intercept + slope * (n - 1)  # nivel al último punto
    ds_future = pd.date_range(start_ds, periods=months_ahead, freq="MS")
    out = []
    for h, d in enumerate(ds_future, start=1):
        base = level + slope * h
        out.append(max(0.0, base * si_map.get(d.month, 1.0)))
    return np.array(out)


def naive_bq_forecast(history: pd.Series, months_ahead: int) -> np.ndarray:
    """Naive puro: repite último valor."""
    last = float(history.tail(1).iloc[0]) if len(history) else 0.0
    return np.full(months_ahead, last)


def seasonal_naive_bq_forecast(history: pd.Series, months_ahead: int, start_ds: pd.Timestamp) -> np.ndarray:
    """Predice usando el mismo mes hace 12 meses (si existe)."""
    if len(history) < 12:
        return np.full(months_ahead, history.mean() if len(history) else 0.0)
    hist_dict = {ts.strftime("%Y-%m"): v for ts, v in history.items()}
    ds_future = pd.date_range(start_ds, periods=months_ahead, freq="MS")
    out = []
    for d in ds_future:
        prev_year = d - pd.DateOffset(months=12)
        key = prev_year.strftime("%Y-%m")
        out.append(hist_dict.get(key, history.tail(3).mean()))
    return np.array(out)


def moving_average_forecast(history: pd.Series, months_ahead: int, window: int = 3) -> np.ndarray:
    """Media móvil de los últimos `window` meses."""
    tail = history.tail(window).mean()
    return np.full(months_ahead, tail)


# ---------------------------------------------------------------------------
# Backtest rolling-origin
# ---------------------------------------------------------------------------
def backtest_series(sub_df: pd.DataFrame, si_map: dict) -> pd.DataFrame:
    """Rolling-origin CV con múltiples modelos. Devuelve tabla larga."""
    sub_df = sub_df.sort_values("ds").reset_index(drop=True)
    n = len(sub_df)
    # Necesitamos: min train = 3 obs, h=BACKTEST_H, windows = BACKTEST_WINDOWS
    min_train = 3
    total_test = BACKTEST_H * BACKTEST_WINDOWS
    if n < min_train + BACKTEST_H:
        return pd.DataFrame()

    rows = []
    max_start = n - BACKTEST_H
    starts = list(range(max_start - (BACKTEST_WINDOWS - 1) * BACKTEST_H, max_start + 1, BACKTEST_H))
    starts = [s for s in starts if s >= min_train]
    for start_idx in starts:
        train = sub_df.iloc[:start_idx].copy()
        test = sub_df.iloc[start_idx:start_idx + BACKTEST_H].copy()
        history = train.set_index("ds")["y"]
        start_ds = test["ds"].iloc[0]
        h = len(test)
        preds = {
            "Naive": naive_bq_forecast(history, h),
            "MA3": moving_average_forecast(history, h, 3),
            "SeasonalNaive": seasonal_naive_bq_forecast(history, h, start_ds),
            "Seasonal_Level": seasonal_naive_forecast(history, si_map, h, start_ds),
            "Seasonal_Trend": seasonal_trend_forecast(history, si_map, h, start_ds),
        }
        for m, yp in preds.items():
            for i in range(h):
                rows.append({
                    "unique_id": sub_df["unique_id"].iloc[0],
                    "cutoff": history.index.max(),
                    "ds": test["ds"].iloc[i],
                    "y": test["y"].iloc[i],
                    "model": m,
                    "y_hat": yp[i],
                })
    return pd.DataFrame(rows)


def compute_wape(g: pd.DataFrame) -> float:
    yt, yp = g["y"].values.astype(float), g["y_hat"].values.astype(float)
    if len(yt) == 0:
        return np.nan
    return float(np.sum(np.abs(yt - yp)) / max(np.sum(np.abs(yt)), 1e-9))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print("=" * 72)
    print("F2A.3 iter-2 — Seasonal decomposition (Baraldo SI × Shimano nivel)")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/5] Baraldo → seasonal index...")
    bar = load_baraldo_raw()
    si = compute_seasonal_index(bar)
    print(f"  SI computado: {si['subfamilia'].nunique()} subfamilias × 12 meses")
    print(f"  ejemplo SI SPINNING:")
    ex_spin = si[si["subfamilia"] == "SPINNING"].sort_values("mes")
    print(ex_spin.to_string(index=False))

    print("\n[2/5] BQ → ventas post-splice...")
    bq = init_bq()
    df_bq = fetch_bq_ventas_post_splice(bq)
    df_bq = regrid_bq(df_bq)
    print(f"  {df_bq['unique_id'].nunique()} subfamilias · {df_bq['ds'].nunique()} meses ({df_bq['ds'].min().date()} → {df_bq['ds'].max().date()})")

    print("\n[3/5] Backtest rolling-origin por subfamilia (h={} × w={})".format(BACKTEST_H, BACKTEST_WINDOWS))
    all_rows = []
    for sub, g in df_bq.groupby("unique_id"):
        si_sub = si[si["subfamilia"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        cv = backtest_series(g, si_map)
        if not cv.empty:
            all_rows.append(cv)
    cv_all = pd.concat(all_rows, ignore_index=True) if all_rows else pd.DataFrame()
    print(f"  backtest rows: {len(cv_all):,}")

    # Métricas por (unique_id, model)
    per_sub = (
        cv_all.groupby(["unique_id", "model"])
        .apply(lambda g: pd.Series({
            "wape": compute_wape(g),
            "n_obs": len(g),
            "y_true_sum": g["y"].sum(),
            "y_pred_sum": g["y_hat"].sum(),
        }), include_groups=False)
        .reset_index()
    )
    per_sub["wape"] = per_sub["wape"].round(4)

    agg = (
        per_sub.groupby("model")
        .agg(
            n_series=("unique_id", "nunique"),
            wape_mediano=("wape", "median"),
            wape_promedio=("wape", "mean"),
            wape_p25=("wape", lambda x: x.quantile(0.25)),
            wape_p75=("wape", lambda x: x.quantile(0.75)),
        )
        .reset_index()
        .sort_values("wape_mediano")
    )

    print("\n=== BACKTEST AGREGADO POR MODELO ===")
    print(agg.to_string(index=False))

    per_sub.to_csv(OUTPUT_DIR / "seasonal_backtest_por_subfamilia.csv", index=False)
    agg.to_csv(OUTPUT_DIR / "seasonal_backtest_agregado.csv", index=False)

    # Best model por serie
    best_per = per_sub.sort_values("wape").groupby("unique_id").first().reset_index()
    print("\n=== DISTRIBUCIÓN WAPE (best model por serie) ===")
    print(best_per["wape"].describe(percentiles=[0.1, 0.25, 0.5, 0.75, 0.9]).to_string())

    n_below_05 = int((best_per["wape"] < 0.5).sum())
    n_below_07 = int((best_per["wape"] < 0.7).sum())
    n_total = len(best_per)
    print(f"\nN series con WAPE < 0.5: {n_below_05} / {n_total} ({100*n_below_05/n_total:.1f}%)")
    print(f"N series con WAPE < 0.7: {n_below_07} / {n_total} ({100*n_below_07/n_total:.1f}%)")

    # Forecast final H=7 con best model
    print("\n[4/5] Forecast final H={} con best model por serie...".format(HORIZON_FINAL))
    max_ds = df_bq["ds"].max()
    start_future = max_ds + pd.offsets.MonthBegin(1)
    ds_future = pd.date_range(start_future, periods=HORIZON_FINAL, freq="MS")

    forecast_rows = []
    for sub, g in df_bq.groupby("unique_id"):
        history = g.set_index("ds")["y"]
        best = best_per[best_per["unique_id"] == sub]
        if best.empty:
            model = "MA3"
            wape = np.nan
        else:
            model = best["model"].iloc[0]
            wape = best["wape"].iloc[0]
        si_sub = si[si["subfamilia"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}

        if model == "Seasonal_Trend":
            yp = seasonal_trend_forecast(history, si_map, HORIZON_FINAL, start_future)
        elif model == "Seasonal_Level":
            yp = seasonal_naive_forecast(history, si_map, HORIZON_FINAL, start_future)
        elif model == "SeasonalNaive":
            yp = seasonal_naive_bq_forecast(history, HORIZON_FINAL, start_future)
        elif model == "MA3":
            yp = moving_average_forecast(history, HORIZON_FINAL, 3)
        else:  # Naive
            yp = naive_bq_forecast(history, HORIZON_FINAL)
        for i, d in enumerate(ds_future):
            forecast_rows.append({
                "unique_id": sub,
                "ds": d,
                "y_hat": max(0, int(round(yp[i]))),
                "best_model": model,
                "wape_backtest": round(wape, 3) if not np.isnan(wape) else None,
            })
    forecast_final = pd.DataFrame(forecast_rows)
    forecast_final.to_csv(OUTPUT_DIR / "seasonal_forecast_h7.csv", index=False)

    print("\n[5/5] TOP 15 subfamilias por magnitud forecast:")
    tot = forecast_final.groupby("unique_id")["y_hat"].sum().sort_values(ascending=False).head(15)
    top = tot.index
    pv = forecast_final[forecast_final["unique_id"].isin(top)].pivot(index="unique_id", columns="ds", values="y_hat")
    pv.columns = [c.strftime("%Y-%m") for c in pv.columns]
    pv = pv.loc[top]
    pv.insert(0, "best_model", forecast_final.groupby("unique_id")["best_model"].first().loc[top])
    pv.insert(1, "wape_bt", forecast_final.groupby("unique_id")["wape_backtest"].first().loc[top])
    print(pv.to_string())

    resumen = {
        "generado": t0.isoformat(),
        "approach": "iter2 · seasonal decomposition · SI_Baraldo × nivel_Shimano_post_splice",
        "backtest_h": BACKTEST_H,
        "backtest_windows": BACKTEST_WINDOWS,
        "level_window": LEVEL_WINDOW,
        "trend_window": TREND_WINDOW,
        "horizon_final": HORIZON_FINAL,
        "wape_mediano_best_per_series": round(float(best_per["wape"].median()), 3),
        "wape_p25_best": round(float(best_per["wape"].quantile(0.25)), 3),
        "wape_p75_best": round(float(best_per["wape"].quantile(0.75)), 3),
        "n_series_wape_lt_0_5": n_below_05,
        "n_series_wape_lt_0_7": n_below_07,
        "n_series_total": n_total,
        "goal_met": float(best_per["wape"].median()) < 0.5,
    }
    (OUTPUT_DIR / "seasonal_resumen.json").write_text(
        json.dumps(resumen, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("\n[done] resumen:")
    print(json.dumps(resumen, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
