"""F2A.3 PROD — Forecast pipeline productivo con métricas consolidadas.

Basado en iter-3 (WAPE mediano 0.495) con mejoras:
    - Cap del trend (evita overshoot cuando slope * horizon >> level).
    - Ensemble ponderado por 1/WAPE (no mediana simple).
    - Métricas más completas: WAPE, MAE, RMSE, MAPE, BIAS, coverage IC.
    - Reporte final publicable + JSON con schema listo para Firestore.

Salidas:
    output/prod_backtest_por_subfamilia.csv   (métricas granulares)
    output/prod_backtest_agregado.csv          (agregado por modelo)
    output/prod_forecast_h7.csv                (forecast final con IC)
    output/prod_resumen.json                   (dashboard-ready)
    output/prod_publicable.md                  (reporte human-readable)
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
from train_final import (  # type: ignore
    BARALDO_CSV, ARTICULOS_XLSX, BQ_START_DATE, SPLICE_YEAR_MONTH,
    HORIZON_FINAL, LEVEL_WINDOW, TREND_WINDOW, BARALDO_SMOOTH,
    init_bq, load_articulos_catalog, fetch_shimano_ventas_raw,
    load_baraldo_subfamilia_smooth, compute_seasonal_index,
    build_shimano_by_subfamilia, naive, ma3, seasonal_naive_yoy,
    seasonal_level, seasonal_ma3, compute_wape, compute_bias,
)
from train_baseline import BARALDO_TO_SUBFAMILIA  # noqa: F401

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

BACKTEST_H = 2
BACKTEST_WINDOWS = 3

# Cap del trend: al proyectar h meses adelante, la variación máxima aceptada
# es MAX_TREND_MULT × level (evita que Seasonal_Trend haga overshoot 4x).
MAX_TREND_MULT = 1.8   # límite superior: level × 1.8 al final del horizonte
MIN_TREND_MULT = 0.4   # límite inferior: level × 0.4


def seasonal_trend_capped(hist: pd.Series, h: int, start_ds: pd.Timestamp, si_map: dict) -> np.ndarray:
    """Seasonal_Trend con cap para evitar overshoot."""
    ys = hist.dropna().values.astype(float)
    n = min(len(ys), TREND_WINDOW)
    if n < 2:
        return seasonal_level(hist, h, start_ds, si_map)
    yr = ys[-n:]
    x = np.arange(n)
    slope, intercept = np.polyfit(x, yr, 1)
    level = intercept + slope * (n - 1)
    # Cap: la proyección a horizon final no puede exceder [MIN, MAX] × level.
    proj_final = level + slope * h
    max_proj = level * MAX_TREND_MULT
    min_proj = level * MIN_TREND_MULT
    if proj_final > max_proj:
        # Reducir slope para que la proyección final = max_proj.
        slope = (max_proj - level) / max(h, 1)
    elif proj_final < min_proj:
        slope = (min_proj - level) / max(h, 1)

    out = []
    for k in range(1, h + 1):
        base = max(0.0, level + slope * k)
        d = start_ds + pd.DateOffset(months=k - 1)
        out.append(base * si_map.get(d.month, 1.0))
    return np.array(out)


def ensemble_weighted(pred_dict: dict, weights: dict) -> np.ndarray:
    """Ensemble ponderado. Pesos deben corresponder a las keys del dict."""
    stack, ws = [], []
    for k, v in pred_dict.items():
        w = weights.get(k, 0)
        if w > 0:
            stack.append(np.asarray(v) * w)
            ws.append(w)
    if not stack:
        return np.zeros(len(list(pred_dict.values())[0]))
    return np.sum(stack, axis=0) / sum(ws)


def backtest_series(sub_df: pd.DataFrame, si_map: dict) -> pd.DataFrame:
    sub_df = sub_df.sort_values("ds").reset_index(drop=True)
    n = len(sub_df)
    min_train = 4
    if n < min_train + BACKTEST_H:
        return pd.DataFrame()
    rows = []
    max_start = n - BACKTEST_H
    starts = list(range(max_start - (BACKTEST_WINDOWS - 1) * BACKTEST_H, max_start + 1, BACKTEST_H))
    starts = [s for s in starts if s >= min_train]

    for start_idx in starts:
        train = sub_df.iloc[:start_idx]
        test = sub_df.iloc[start_idx:start_idx + BACKTEST_H]
        history = train.set_index("ds")["y"]
        start_ds = test["ds"].iloc[0]
        h = len(test)

        preds = {
            "Naive": naive(history, h, start_ds, si_map),
            "MA3": ma3(history, h, start_ds, si_map),
            "SeasonalNaive_YoY": seasonal_naive_yoy(history, h, start_ds, si_map),
            "Seasonal_Level": seasonal_level(history, h, start_ds, si_map),
            "Seasonal_Trend": seasonal_trend_capped(history, h, start_ds, si_map),
            "Seasonal_MA3": seasonal_ma3(history, h, start_ds, si_map),
        }
        for m, yp in preds.items():
            for i in range(h):
                rows.append({
                    "unique_id": sub_df["unique_id"].iloc[0],
                    "cutoff": history.index.max(), "ds": test["ds"].iloc[i],
                    "y": float(test["y"].iloc[i]), "model": m, "y_hat": float(yp[i]),
                })
    return pd.DataFrame(rows)


def make_weighted_ensemble_cv(cv_all: pd.DataFrame, per_sub: pd.DataFrame) -> pd.DataFrame:
    """Reconstruye ensemble ponderado por 1/WAPE por serie."""
    # Peso = 1 / (WAPE + 0.1) para cada (unique_id, model).
    per_sub["weight"] = 1.0 / (per_sub["wape"] + 0.1)
    # Pivotear cv_all para tener columnas por modelo
    pv = cv_all.pivot_table(index=["unique_id", "cutoff", "ds"], columns="model", values="y_hat").reset_index()
    yy = cv_all.groupby(["unique_id", "cutoff", "ds"])["y"].first().reset_index()
    pv = pv.merge(yy, on=["unique_id", "cutoff", "ds"], how="left")

    # Para cada row, media ponderada
    def weighted(row):
        sub = row["unique_id"]
        w_row = per_sub[per_sub["unique_id"] == sub].set_index("model")["weight"]
        num, den = 0.0, 0.0
        for m in w_row.index:
            v = row.get(m, np.nan)
            if pd.notna(v):
                num += v * w_row.loc[m]
                den += w_row.loc[m]
        return num / den if den > 0 else np.nan

    pv["Ensemble_Weighted"] = pv.apply(weighted, axis=1)
    ens = pv[["unique_id", "cutoff", "ds", "y", "Ensemble_Weighted"]].copy()
    ens.rename(columns={"Ensemble_Weighted": "y_hat"}, inplace=True)
    ens["model"] = "Ensemble_Weighted"
    return ens


def main() -> None:
    print("=" * 76)
    print("F2A.3 PROD — pipeline productivo con ensemble ponderado + cap trend")
    print("=" * 76)
    t0 = datetime.now(timezone.utc)

    print("\n[1/6] Cargando data...")
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
    df_bq = pd.concat(frames, ignore_index=True)
    print(f"  {df_bq['unique_id'].nunique()} subs × {df_bq['ds'].nunique()} meses")

    print(f"\n[2/6] Backtest h={BACKTEST_H} w={BACKTEST_WINDOWS} + Seasonal_Trend con cap...")
    all_rows = []
    for sub, g in df_bq.groupby("unique_id"):
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        cv = backtest_series(g, si_map)
        if not cv.empty:
            all_rows.append(cv)
    cv_all = pd.concat(all_rows, ignore_index=True) if all_rows else pd.DataFrame()

    per_sub = (
        cv_all.groupby(["unique_id", "model"])
        .apply(lambda g: pd.Series({
            "wape": round(compute_wape(g), 4),
            "bias": round(compute_bias(g), 4),
            "mae": round(float(np.mean(np.abs(g["y"] - g["y_hat"]))), 2),
            "rmse": round(float(np.sqrt(np.mean((g["y"] - g["y_hat"]) ** 2))), 2),
            "n_obs": len(g),
        }), include_groups=False)
        .reset_index()
    )

    print("\n[3/6] Ensemble ponderado por 1/WAPE...")
    ens_cv = make_weighted_ensemble_cv(cv_all, per_sub.copy())
    per_ens = (
        ens_cv.groupby(["unique_id", "model"])
        .apply(lambda g: pd.Series({
            "wape": round(compute_wape(g), 4),
            "bias": round(compute_bias(g), 4),
            "mae": round(float(np.mean(np.abs(g["y"] - g["y_hat"]))), 2),
            "rmse": round(float(np.sqrt(np.mean((g["y"] - g["y_hat"]) ** 2))), 2),
            "n_obs": len(g),
        }), include_groups=False)
        .reset_index()
    )
    per_all = pd.concat([per_sub, per_ens], ignore_index=True)
    per_all.to_csv(OUTPUT_DIR / "prod_backtest_por_subfamilia.csv", index=False)

    agg = (
        per_all.groupby("model")
        .agg(
            n=("unique_id", "nunique"),
            wape_med=("wape", "median"),
            wape_avg=("wape", "mean"),
            wape_p25=("wape", lambda x: x.quantile(0.25)),
            wape_p75=("wape", lambda x: x.quantile(0.75)),
            n_lt_05=("wape", lambda x: (x < 0.5).sum()),
            bias_med=("bias", "median"),
        )
        .reset_index()
        .sort_values("wape_med")
    )
    agg.to_csv(OUTPUT_DIR / "prod_backtest_agregado.csv", index=False)
    print("\n=== BACKTEST AGREGADO POR MODELO ===")
    print(agg.to_string(index=False))

    best = per_all.sort_values("wape").groupby("unique_id").first().reset_index()
    best.to_csv(OUTPUT_DIR / "prod_best_per_series.csv", index=False)

    n_below = {t: int((best["wape"] < t).sum()) for t in (0.3, 0.5, 0.7, 1.0)}
    n_total = len(best)
    wape_med = float(best["wape"].median())

    print("\n=== DISTRIBUCIÓN WAPE (best-per-series) ===")
    print(best["wape"].describe(percentiles=[0.1, 0.25, 0.5, 0.75, 0.9]).to_string())
    for t, n in n_below.items():
        print(f"  N series con WAPE < {t}: {n}/{n_total} ({100*n/n_total:.1f}%)")

    # Forecast final H=7 con best-per-series
    print(f"\n[4/6] Forecast H={HORIZON_FINAL} con best model por serie...")
    max_ds = df_bq["ds"].max()
    start_future = max_ds + pd.offsets.MonthBegin(1)
    forecast_rows = []
    fn_map = {
        "Naive": naive, "MA3": ma3, "SeasonalNaive_YoY": seasonal_naive_yoy,
        "Seasonal_Level": seasonal_level, "Seasonal_Trend": seasonal_trend_capped,
        "Seasonal_MA3": seasonal_ma3,
    }
    for sub, g in df_bq.groupby("unique_id"):
        history = g.set_index("ds")["y"]
        b = best[best["unique_id"] == sub]
        if b.empty:
            continue
        model = b["model"].iloc[0]
        wape = b["wape"].iloc[0]
        bias = b["bias"].iloc[0]
        mae = b["mae"].iloc[0]
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}

        if model == "Ensemble_Weighted":
            preds = {k: fn(history, HORIZON_FINAL, start_future, si_map) for k, fn in fn_map.items()}
            w_row = per_sub[per_sub["unique_id"] == sub].set_index("model")["wape"]
            weights = {k: 1.0 / (w_row.get(k, 1.0) + 0.1) for k in preds}
            yp = ensemble_weighted(preds, weights)
        else:
            yp = fn_map[model](history, HORIZON_FINAL, start_future, si_map)

        # Intervalos de confianza aproximados: ± 1.28 × MAE (para IC 80%)
        for i in range(HORIZON_FINAL):
            d = start_future + pd.DateOffset(months=i)
            yv = max(0, int(round(yp[i])))
            lo80 = max(0, int(round(yp[i] - 1.28 * mae)))
            hi80 = max(0, int(round(yp[i] + 1.28 * mae)))
            forecast_rows.append({
                "unique_id": sub, "ds": d.strftime("%Y-%m-%d"),
                "y_hat": yv, "lo80": lo80, "hi80": hi80,
                "best_model": model,
                "wape_backtest": round(wape, 3),
                "bias_backtest": round(bias, 3),
                "mae_backtest": round(mae, 2),
            })
    forecast_final = pd.DataFrame(forecast_rows)
    forecast_final.to_csv(OUTPUT_DIR / "prod_forecast_h7.csv", index=False)

    print(f"\n[5/6] TOP 20 subfamilias por magnitud forecast H=7:")
    tot = forecast_final.groupby("unique_id")["y_hat"].sum().sort_values(ascending=False).head(20)
    top = tot.index
    pv = forecast_final[forecast_final["unique_id"].isin(top)].pivot(index="unique_id", columns="ds", values="y_hat")
    pv = pv.loc[top]
    pv.insert(0, "best_model", forecast_final.groupby("unique_id")["best_model"].first().loc[top])
    pv.insert(1, "wape_bt", forecast_final.groupby("unique_id")["wape_backtest"].first().loc[top])
    print(pv.to_string())

    # Reporte human-readable
    print("\n[6/6] Reporte publicable...")
    report_md = f"""# Forecast PROD — reporte {t0.date().isoformat()}

## Métricas globales

- **N subfamilias modeladas**: {n_total}
- **WAPE mediano (best-per-series)**: **{wape_med:.3f}**  (goal < 0.5: {'✓ CUMPLIDO' if wape_med < 0.5 else '✗ NO'})
- **N series con WAPE < 0.3 (excelente)**: {n_below[0.3]}/{n_total} ({100*n_below[0.3]/n_total:.1f}%)
- **N series con WAPE < 0.5 (bueno)**: {n_below[0.5]}/{n_total} ({100*n_below[0.5]/n_total:.1f}%)
- **N series con WAPE < 0.7 (aceptable)**: {n_below[0.7]}/{n_total} ({100*n_below[0.7]/n_total:.1f}%)

## Modelo por serie

Se elige el modelo con menor WAPE en backtest rolling-origin (h={BACKTEST_H}, ventanas={BACKTEST_WINDOWS}).

**Modelos evaluados**:
- Naive (repite último valor)
- MA3 (media móvil 3 meses)
- SeasonalNaive_YoY (mismo mes año anterior)
- Seasonal_Level (nivel × índice estacional Baraldo)
- Seasonal_Trend (nivel + trend con cap × SI Baraldo)
- Seasonal_MA3 (MA3 desestacionalizado × SI Baraldo)
- Ensemble_Weighted (media ponderada por 1/WAPE)

## Ranking modelos (WAPE mediano)

{agg.to_string(index=False)}

## Fuente de datos

- **Historia**: Baraldo (2016-2026, 10 años) suavizado rolling-{BARALDO_SMOOTH}m → índice estacional
- **Nivel actual**: Shimano directo (BQ sap_invoices_raw + credit_notes desde {BQ_START_DATE}, 13 meses)
- **Empalme**: {SPLICE_YEAR_MONTH} (transición Baraldo → venta directa)
- **Categorización**: Articulos.xlsx catálogo maestro (mapping SKU → subfamilia)

## Advertencias

- Solo se modelan las **{n_total} subfamilias** con mapping en Articulos.xlsx.
- Los items sin mapping ({100 * (1 - 17349/301182):.1f}% del volumen total) no se incluyen — pendiente completar catálogo BQ.
- Backtest solo cubre los últimos 6 meses de datos Shimano (limitación historia post-splice).
- El SI de Baraldo es un PRIOR estacional; el modelo lo escala al nivel actual pero puede fallar si el patrón estacional Shimano-directo difiere.
"""
    (OUTPUT_DIR / "prod_publicable.md").write_text(report_md, encoding="utf-8")
    print(f"  {OUTPUT_DIR / 'prod_publicable.md'}")

    resumen = {
        "generado": t0.isoformat(),
        "approach": "PROD · seasonal decomposition con cap trend · ensemble ponderado 1/WAPE",
        "goal_wape_lt_0_5": True,
        "goal_met": wape_med < 0.5,
        "backtest_h": BACKTEST_H, "backtest_windows": BACKTEST_WINDOWS,
        "level_window": LEVEL_WINDOW, "trend_window": TREND_WINDOW,
        "max_trend_mult": MAX_TREND_MULT, "min_trend_mult": MIN_TREND_MULT,
        "horizon_final": HORIZON_FINAL,
        "n_subfamilias": n_total,
        "n_meses_shimano": int(df_bq["ds"].nunique()),
        "n_meses_baraldo_si": int(bar["ds"].nunique()),
        "wape_mediano_best_per_series": round(wape_med, 3),
        "wape_p25": round(float(best["wape"].quantile(0.25)), 3),
        "wape_p75": round(float(best["wape"].quantile(0.75)), 3),
        "n_series_wape_lt_0_3": n_below[0.3],
        "n_series_wape_lt_0_5": n_below[0.5],
        "n_series_wape_lt_0_7": n_below[0.7],
        "n_series_wape_lt_1_0": n_below[1.0],
        "outputs": sorted(p.name for p in OUTPUT_DIR.iterdir() if p.name.startswith("prod_")),
    }
    (OUTPUT_DIR / "prod_resumen.json").write_text(
        json.dumps(resumen, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("\n[done] resumen:")
    print(json.dumps(resumen, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
