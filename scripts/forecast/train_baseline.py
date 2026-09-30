"""F2A.1 baseline forecast — Shimano app-vendedores.

Approach top-down subfamilia (decisión Mariano 2026-09-30):
    1. Consolidar historia mensual por subfamilia (~40 series):
       - Baraldo 2016-01 -> 2025-08 (10 años, agregado por subfamilia desde
         `baraldo_ventas_sku_historico.csv` con mapping CatItemKey -> subfamilia).
       - BQ v_ventas_lineas 2025-09 -> hoy (venta directa Shimano post-transición).
    2. Baseline por subfamilia: Naive / SeasonalNaive(12) / AutoARIMA(12).
    3. Backtest rolling-origin CV. Métricas WAPE + MAE + RMSE por subfamilia.
    4. Forecast H=7 con mejor modelo por subfamilia.

Por qué subfamilia y no SKU:
- SKU-level no tiene serie mensual continua: Baraldo compraba en batches
  trimestrales/semestrales (mediana 2 meses de historia por SKU), y BQ tiene
  solo 12 meses de venta directa Shimano.
- Al agregar por subfamilia se suavizan los batches Baraldo, se obtiene una
  serie mensual continua con la misma estacionalidad de mercado, y las 40
  subfamilias vs ~450 SKUs son mucho más modelables.

Fase 2 futura: disaggregar SUB -> SKU con pesos históricos (fracción de ventas
por SKU dentro de la subfamilia en los últimos meses observados).

NO escribe a Firestore. Solo CSVs a scripts/forecast/output/.

Uso:
    python scripts/forecast/train_baseline.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Windows PS 5.1 default = cp1252; forzamos UTF-8 para no romper con
# caracteres como acentos/emoji en print().
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import numpy as np
import pandas as pd
from google.cloud import bigquery
from google.oauth2 import service_account

SCRIPT_DIR = Path(__file__).resolve().parent
INPUTS_DIR = SCRIPT_DIR / "inputs"
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

BARALDO_CSV = Path.home() / "Desktop" / "FORECAST" / "DATOS_CRUDOS" / "baraldo_ventas_sku_historico.csv"

PROJECT = "app-vendedores-shimano"
DATASET = "shimano_app"

# Splice date: pre = Baraldo, >= = BQ. Baraldo compraba a Shimano hasta
# ~agosto 2025; Shimano arrancó venta directa 2025-09-23.
SPLICE_YEAR_MONTH = "2025-09"

# Parámetros del modelo
BQ_START_DATE = "2025-09-01"
HORIZON = 7
BACKTEST_WINDOWS = 3
SEASON_LENGTH = 12

# Mapping meses español -> número
MESES_ES = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12,
}


def _resolve_sa_key() -> Path:
    candidates = [
        Path.home() / "Desktop" / "sa-key.json",
        Path.home() / "Downloads" / "app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json",
    ]
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError("SA key no encontrada. Candidatos: " + "; ".join(str(p) for p in candidates))


SA_KEY_PATH = _resolve_sa_key()


# ---------------------------------------------------------------------------
# Baraldo: CSV histórico 2016-2026 con CatItemKey_Norm_Fixed -> subfamilia
# ---------------------------------------------------------------------------
# Mapping Baraldo CatItemKey_Norm_Fixed -> subfamilia SAP. Basado en overlap
# observado en el análisis de 2026-09-30. Ver README.md § F2A.1.
BARALDO_TO_SUBFAMILIA = {
    "REEL|SPINNING":                 "SPINNING",
    "REEL|BAITCASTINGLOWPROFILE":    "Baitcasting Low Profile",
    "REEL|CONVENTIONALROUNDREELS":   "Conventional Round Reels",
    "REEL|SPINNINGSALTWATER":        "Spinning Salt Water",
    "REEL|SPINNINGSURFCASTING":      "Spinning Surfcasting",
    "REEL|CONVENTIONALSTARDRAG":     "Conventional Star Drag",
    "REEL|ELECTRIC":                 "Spinning Salt Water",  # merge — muy poco volumen
    "ROD|FWCASTING":                 "FW Casting",
    "ROD|MULTIPURPOSE":              "Multi Purpose",
    "ROD|FWSPINNING":                "FW Spinning",
    "ROD|FWTELESCOPIC":              "FW Telescopic",
    "ROD|FWBOAT":                    "FW Boat",
    "ROD|SWSURFCASTING":             "SW Surfcasting",
    "ROD|SWSHORESURF":               "SW Shoresurf",
    "ROD|SWJIGGING":                 "SW Slow Jigging",       # merge — variantes SW menos frecuentes
    "ROD|SWSLOWJIGGING":             "SW Slow Jigging",
    "ROD|SWSPINNING":                "SW Spinning",
    "ROD|SWOFFSHORE":                "SW Spinning",
    "ROD|SWINSHORE":                 "SW Inshore",
    "ROD|SWBOAT":                    "SW Inshore",
    "ROD|SWBLUEWATER":               "SW Spinning",
    "ROD|SWPOPPING":                 "SW Spinning",
    "ROD|COMBOSPINFW":               "Combo Spin FW",
    "ROD|BAITCASTINGCOMBO":          "Combo Spin FW",
    "LSG|KAIRIKI":                   "KAIRIKI",
    "LSG|POWERPRO":                  "POWER PRO",
    "LSG|MONOLINE":                  "MONOFILAMENTO",
    "LSG|FLUOROCARBONO":             "MONOFILAMENTO",
    "LSG|APPAREL":                   "INDUMENTARIA",
    "LSG|BAGS":                      "INDUMENTARIA",
    "LSG|ACCESORIES":                "HERRAMIENTAS",
    "LSG|MINNOW":                    "HERRAMIENTAS",
    "LSG|METALJIG":                  "HERRAMIENTAS",
    "LSG|TOPWATER":                  "HERRAMIENTAS",
    "LSG|SOFTBAIT":                  "HERRAMIENTAS",
}


def _parse_baraldo_month(row) -> pd.Timestamp | None:
    """Convierte (Year, Month) del CSV Baraldo a Timestamp del 1er día del mes."""
    m = MESES_ES.get(str(row["Month"]).strip().lower())
    if not m:
        return None
    try:
        return pd.Timestamp(int(row["Year"]), m, 1)
    except (ValueError, TypeError):
        return None


def load_baraldo_subfamilia() -> pd.DataFrame:
    """Devuelve DataFrame agregado (subfamilia, ds, y) desde el CSV Baraldo."""
    if not BARALDO_CSV.exists():
        raise FileNotFoundError(f"Baraldo CSV no encontrado: {BARALDO_CSV}")
    print(f"[baraldo] leyendo {BARALDO_CSV.name}")
    b = pd.read_csv(BARALDO_CSV)
    b["subfamilia"] = b["CatItemKey_Norm_Fixed"].map(BARALDO_TO_SUBFAMILIA)
    unmapped = b[b["subfamilia"].isna()]["CatItemKey_Norm_Fixed"].unique()
    if len(unmapped):
        print(f"[baraldo] WARN {len(unmapped)} categorías sin mapping: {list(unmapped)}")
    b = b.dropna(subset=["subfamilia"])
    b["ds"] = b.apply(_parse_baraldo_month, axis=1)
    b = b.dropna(subset=["ds"])
    agg = b.groupby(["subfamilia", "ds"], as_index=False)["Sales Units"].sum().rename(columns={"Sales Units": "y"})
    print(f"[baraldo] agregado: {len(agg):,} filas · {agg['subfamilia'].nunique()} subfamilias · rango {agg['ds'].min().date()} -> {agg['ds'].max().date()}")
    return agg


# ---------------------------------------------------------------------------
# BigQuery: v_ventas_lineas post 2025-09
# ---------------------------------------------------------------------------
def init_bq_client() -> bigquery.Client:
    print(f"[auth] SA key: {SA_KEY_PATH.name}")
    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY_PATH),
        scopes=["https://www.googleapis.com/auth/bigquery"],
    )
    return bigquery.Client(project=PROJECT, credentials=creds)


def fetch_bq_ventas_subfamilia(bq: bigquery.Client) -> pd.DataFrame:
    sql = f"""
    SELECT
      subfamilia,
      DATE(EXTRACT(YEAR FROM fecha_contable), EXTRACT(MONTH FROM fecha_contable), 1) AS ds,
      SUM(cantidad) AS y
    FROM `{PROJECT}.{DATASET}.v_ventas_lineas`
    WHERE is_pesca = TRUE
      AND subfamilia IS NOT NULL
      AND fecha_contable >= '{BQ_START_DATE}'
    GROUP BY subfamilia, ds
    HAVING SUM(cantidad) IS NOT NULL AND SUM(cantidad) > 0
    ORDER BY subfamilia, ds
    """
    print(f"[bq] pulling v_ventas_lineas desde {BQ_START_DATE}")
    df = bq.query(sql).to_dataframe()
    df["ds"] = pd.to_datetime(df["ds"])
    df["y"] = df["y"].astype(float).clip(lower=0)
    print(f"[bq] {len(df):,} filas · {df['subfamilia'].nunique()} subfamilias · rango {df['ds'].min().date()} -> {df['ds'].max().date()}")
    return df


# ---------------------------------------------------------------------------
# Merge + regrid
# ---------------------------------------------------------------------------
def merge_and_regrid(bar: pd.DataFrame, bq: pd.DataFrame) -> pd.DataFrame:
    """Empalma Baraldo (< splice) + BQ (>= splice), regrid mensual, fill 0."""
    splice_ts = pd.Timestamp(SPLICE_YEAR_MONTH + "-01")
    bar_pre = bar[bar["ds"] < splice_ts].copy()
    bq_post = bq[bq["ds"] >= splice_ts].copy()
    print(f"[splice] Baraldo pre-{SPLICE_YEAR_MONTH}: {len(bar_pre)} filas · BQ post: {len(bq_post)} filas")

    # Union de subfamilias (evita perder las que solo aparecen en una fuente).
    subs = sorted(set(bar_pre["subfamilia"]) | set(bq_post["subfamilia"]))
    grid_start = min(bar_pre["ds"].min(), bq_post["ds"].min())
    grid_end = max(bar_pre["ds"].max(), bq_post["ds"].max())
    all_months = pd.date_range(grid_start, grid_end, freq="MS")
    print(f"[grid] {len(subs)} subfamilias · {len(all_months)} meses ({grid_start.date()} -> {grid_end.date()})")

    combined = pd.concat([bar_pre, bq_post], ignore_index=True)
    frames = []
    for sub in subs:
        g = combined[combined["subfamilia"] == sub].set_index("ds")["y"]
        # Si hay múltiples valores por (sub, ds) por algún merge — sumar.
        g = g.groupby(level=0).sum()
        s = g.reindex(all_months, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": sub, "ds": s.index, "y": s.values}))
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Backtest + forecast
# ---------------------------------------------------------------------------
def run_backtest(long_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    from statsforecast import StatsForecast
    from statsforecast.models import AutoARIMA, Naive, SeasonalNaive

    models = [
        Naive(),
        SeasonalNaive(season_length=SEASON_LENGTH),
        AutoARIMA(season_length=SEASON_LENGTH),
    ]
    sf_input = long_df[["unique_id", "ds", "y"]].copy()

    print(f"[cv] statsforecast crossvalidation h={HORIZON} n_windows={BACKTEST_WINDOWS}")
    sf = StatsForecast(models=models, freq="MS", n_jobs=-1)
    cv = sf.cross_validation(df=sf_input, h=HORIZON, step_size=HORIZON, n_windows=BACKTEST_WINDOWS)
    if "unique_id" not in cv.columns:
        cv = cv.reset_index()

    model_cols = [c for c in cv.columns if c not in ("unique_id", "ds", "cutoff", "y")]
    print(f"[cv] modelos evaluados: {model_cols}")

    rows = []
    for sub, g in cv.groupby("unique_id"):
        y_true = g["y"].values.astype(float)
        for m in model_cols:
            y_pred = g[m].values.astype(float)
            mask = (~np.isnan(y_true)) & (~np.isnan(y_pred))
            if mask.sum() == 0:
                continue
            yt, yp = y_true[mask], y_pred[mask]
            mae = float(np.mean(np.abs(yt - yp)))
            rmse = float(np.sqrt(np.mean((yt - yp) ** 2)))
            wape = float(np.sum(np.abs(yt - yp)) / max(np.sum(np.abs(yt)), 1e-9))
            nz = yt > 0
            mape = float(np.mean(np.abs((yt[nz] - yp[nz]) / yt[nz])) * 100) if nz.sum() > 0 else np.nan
            rows.append({
                "unique_id": sub, "model": m,
                "mae": round(mae, 2), "rmse": round(rmse, 2),
                "mape_pct": round(mape, 1) if not np.isnan(mape) else None,
                "wape": round(wape, 3), "n_obs": int(mask.sum()),
            })
    per_sub = pd.DataFrame(rows)

    # Agregado global por modelo
    agg = (
        per_sub.groupby("model")
        .agg(n_series=("unique_id", "nunique"),
             wape_mediano=("wape", "median"),
             wape_promedio=("wape", "mean"),
             mae_mediano=("mae", "median"))
        .reset_index()
        .sort_values("wape_mediano")
    )

    # Elegir mejor modelo por subfamilia
    best = per_sub.sort_values("wape").groupby("unique_id").first()[["model", "wape"]].reset_index().rename(columns={"model": "best_model"})

    print(f"[forecast] refit + forecast H={HORIZON}")
    fut = sf.forecast(df=sf_input, h=HORIZON)
    if "unique_id" not in fut.columns:
        fut = fut.reset_index()
    fut = fut.merge(best, on="unique_id", how="left")

    def pick(row):
        m = row.get("best_model")
        return row.get(m, np.nan) if pd.notna(m) else np.nan

    fut["y_hat"] = fut.apply(pick, axis=1)
    forecast_final = fut[["unique_id", "ds", "best_model", "y_hat"]].copy()
    forecast_final["y_hat"] = forecast_final["y_hat"].clip(lower=0).round(0).astype("Int64")
    return per_sub, agg, forecast_final


def main() -> None:
    print("=" * 72)
    print("F2A.1 baseline forecast (top-down subfamilia, empalme Baraldo+BQ)")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    bar = load_baraldo_subfamilia()
    bq = init_bq_client()
    bqdf = fetch_bq_ventas_subfamilia(bq)

    long_df = merge_and_regrid(bar, bqdf)
    long_df.to_csv(OUTPUT_DIR / "ventas_mensuales_subfamilia.csv", index=False)
    print(f"[out] ventas_mensuales_subfamilia.csv ({len(long_df):,} filas)")

    per_sub, agg, forecast_final = run_backtest(long_df)
    per_sub.to_csv(OUTPUT_DIR / "backtest_por_subfamilia.csv", index=False)
    agg.to_csv(OUTPUT_DIR / "backtest_agregado.csv", index=False)
    forecast_final.to_csv(OUTPUT_DIR / "forecast_h7_subfamilia.csv", index=False)

    print("\n=== BACKTEST AGREGADO POR MODELO (WAPE MEDIANO — menor = mejor) ===")
    print(agg.to_string(index=False))

    print("\n=== TOP 10 BEST-MODEL POR SUBFAMILIA (WAPE mín) ===")
    best = per_sub.sort_values("wape").groupby("unique_id").first()[["model", "wape", "mae", "mape_pct"]]
    print(best.sort_values("wape").head(10).to_string())

    print("\n=== TOP 10 SUBFAMILIAS PEORES (WAPE máx del mejor modelo) ===")
    print(best.sort_values("wape", ascending=False).head(10).to_string())

    resumen = {
        "generado": t0.isoformat(),
        "approach": "top-down por subfamilia · empalme Baraldo pre-2025-09 + BQ post",
        "splice_year_month": SPLICE_YEAR_MONTH,
        "bq_start_date": BQ_START_DATE,
        "horizon": HORIZON,
        "backtest_windows": BACKTEST_WINDOWS,
        "season_length": SEASON_LENGTH,
        "n_subfamilias_modeladas": int(long_df["unique_id"].nunique()),
        "n_meses_grid": int(long_df["ds"].nunique()),
        "modelos": ["Naive", "SeasonalNaive", "AutoARIMA"],
        "output_files": sorted(p.name for p in OUTPUT_DIR.iterdir()),
    }
    (OUTPUT_DIR / "resumen.json").write_text(
        json.dumps(resumen, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("\n[done] resumen.json:")
    print(json.dumps(resumen, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
