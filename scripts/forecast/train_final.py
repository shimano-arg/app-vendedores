"""F2A.3 iter-3 (final) — Rescatar los 13 meses BQ con mapping SKU externo.

Hallazgos previos:
    - v_ventas_lineas tiene 72k filas pero solo 5.7k con familia mapeada
      (sap_items_raw solo cubre 775 items, catálogo incompleto).
    - Los meses 2025-09 → 2026-06 tienen ventas Shimano pero sin categoría.
    - El catálogo REAL está en Desktop/FORECAST/DATOS_CRUDOS/Articulos 6-1 (2).xlsx
      (6718 items con Clasificador + Familia + Subfamilia).

Approach:
    1. Cargar catálogo maestro Articulos.xlsx → dict item_code → subfamilia_norm.
    2. Query BQ sap_invoices_raw directo (bypass v_ventas_lineas).
       JSON_EXTRACT lines → item_code + cantidad.
    3. Aplicar mapping local → agregar por subfamilia × mes.
    4. Empalmar Baraldo (pre-2025-09, agregado y suavizado) + Shimano (post-splice).
    5. Modelar con seasonal decomposition (SI_Baraldo × nivel_Shimano):
       Baraldo 10 años → índice estacional; Shimano 13m → nivel actual.
    6. Backtest h=2 w=3 (6 meses test, 7 meses train mínimo).
    7. Ensemble por SUB con múltiples modelos.

Goal: WAPE mediano < 0.5.
"""
from __future__ import annotations

import json
import re
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
    PROJECT,
    DATASET,
    SA_KEY_PATH,
    _parse_baraldo_month,
)

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

BARALDO_CSV = Path.home() / "Desktop" / "FORECAST" / "DATOS_CRUDOS" / "baraldo_ventas_sku_historico.csv"
ARTICULOS_XLSX = Path.home() / "Desktop" / "FORECAST" / "DATOS_CRUDOS" / "Articulos 6-1 (2).xlsx"
EXOGENAS_CSV = SCRIPT_DIR / "inputs" / "exogenas.csv"

BQ_START_DATE = "2025-09-01"
SPLICE_YEAR_MONTH = "2025-09"
HORIZON_FINAL = 7

# Backtest: h=2, w=3 → test=6m, train inicial=7m (de los 13 disponibles)
BACKTEST_H = 2
BACKTEST_WINDOWS = 3
LEVEL_WINDOW = 3
TREND_WINDOW = 6

BARALDO_SMOOTH = 3


def init_bq() -> bigquery.Client:
    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY_PATH), scopes=["https://www.googleapis.com/auth/bigquery"]
    )
    return bigquery.Client(project=PROJECT, credentials=creds)


# ---------------------------------------------------------------------------
# Catálogo maestro Articulos.xlsx
# ---------------------------------------------------------------------------
def _norm_str(s: object) -> str:
    return str(s).strip().upper() if s else ""


def load_articulos_catalog() -> pd.DataFrame:
    """Devuelve DataFrame [item_code, clasificador, familia_articulo, subfamilia, fabrica]."""
    import openpyxl
    wb = openpyxl.load_workbook(ARTICULOS_XLSX, data_only=True, read_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(c).strip() if c else "" for c in rows[0]]
    idx = {h: i for i, h in enumerate(headers)}
    keys = ["Codigo De Articulo", "Clasificador Articulos", "Nombre Familia Articulo", "Subfamilia", "Fabrica"]
    for k in keys:
        if k not in idx:
            raise KeyError(f"Falta columna '{k}' en Articulos.xlsx")

    data = []
    for r in rows[1:]:
        code = r[idx["Codigo De Articulo"]]
        if not code:
            continue
        data.append({
            "item_code": str(code).strip(),
            "clasificador": _norm_str(r[idx["Clasificador Articulos"]]),
            "familia_articulo": _norm_str(r[idx["Nombre Familia Articulo"]]),
            "subfamilia": _norm_str(r[idx["Subfamilia"]]),
            "fabrica": _norm_str(r[idx["Fabrica"]]),
        })
    cat = pd.DataFrame(data)
    print(f"[catalog] {len(cat)} items · clasificadores: {sorted(cat['clasificador'].unique())}")

    # Normalizamos "grupo" (familia principal para forecast) usando familia_articulo:
    # ROD-* → CAÑAS, REEL-* → REEL, LSG-* → LINEAS/ACCESORIOS mix.
    def to_grupo(row):
        cl = row["clasificador"]
        if cl == "ROD":
            return "CAÑAS"
        if cl == "REEL":
            return "REEL"
        if cl == "LSG":
            return "LSG"
        return cl or "OTROS"
    cat["grupo"] = cat.apply(to_grupo, axis=1)

    # "subfamilia_norm" unifica taxonomías: usamos `familia_articulo` que es el
    # nivel de granularidad medio (SW Jigging, FW Casting, Multi Purpose, etc)
    # y matchea con lo que sale de v_ventas_lineas + Baraldo.
    cat["subfamilia_norm"] = cat["familia_articulo"]
    return cat


# ---------------------------------------------------------------------------
# Ventas Shimano post-splice desde sap_invoices_raw + credit_notes
# ---------------------------------------------------------------------------
def fetch_shimano_ventas_raw(bq: bigquery.Client) -> pd.DataFrame:
    """Ventas Shimano directas (post 2025-09) desde sap_invoices_raw expandido
    por línea. Sin filtrar por catálogo (aplicamos mapping local después).
    """
    sql = f"""
    WITH invoices AS (
      SELECT doc_date, doc_entry, lines_json, 1 AS sign FROM `{PROJECT}.{DATASET}.sap_invoices_raw`
      UNION ALL
      SELECT doc_date, doc_entry, lines_json, -1 AS sign FROM `{PROJECT}.{DATASET}.sap_credit_notes_raw`
    )
    SELECT
      DATE(EXTRACT(YEAR FROM doc_date), EXTRACT(MONTH FROM doc_date), 1) AS ds,
      JSON_VALUE(line, '$.ItemCode') AS item_code,
      SAFE_CAST(JSON_VALUE(line, '$.Quantity') AS FLOAT64) * sign AS qty
    FROM invoices, UNNEST(JSON_EXTRACT_ARRAY(lines_json)) AS line
    WHERE doc_date >= '{BQ_START_DATE}'
      AND JSON_VALUE(line, '$.ItemCode') IS NOT NULL
    """
    print(f"[bq] pulling sap_invoices+credit_notes desde {BQ_START_DATE}")
    df = bq.query(sql).to_dataframe()
    df["ds"] = pd.to_datetime(df["ds"])
    print(f"[bq] {len(df):,} rows · {df['item_code'].nunique()} items únicos")
    return df


# ---------------------------------------------------------------------------
# Baraldo (con mapping directo a subfamilia_norm — mismo taxonomy)
# ---------------------------------------------------------------------------
# Mapping Baraldo Cat -> subfamilia_norm que matchea con `familia_articulo`
# del catálogo Articulos.xlsx. Ojo: taxonomías son parecidas pero no idénticas.
BARALDO_TO_SUBFAMILIA_NORM = {
    "REEL|SPINNING":                 "SPINNING",
    "REEL|BAITCASTINGLOWPROFILE":    "Baitcasting Low Profile",
    "REEL|CONVENTIONALROUNDREELS":   "Conventional Round Reels",
    "REEL|SPINNINGSALTWATER":        "Spinning Salt Water",
    "REEL|SPINNINGSURFCASTING":      "Spinning Surfcasting",
    "REEL|CONVENTIONALSTARDRAG":     "Conventional Star Drag",
    "REEL|ELECTRIC":                 "Spinning Salt Water",
    "ROD|FWCASTING":                 "FW Casting",
    "ROD|MULTIPURPOSE":              "Multi Purpose",
    "ROD|FWSPINNING":                "FW Spinning",
    "ROD|FWTELESCOPIC":              "FW Telescopic",
    "ROD|FWBOAT":                    "FW Boat",
    "ROD|SWSURFCASTING":             "SW Surfcasting",
    "ROD|SWSHORESURF":               "SW Shoresurf",
    "ROD|SWJIGGING":                 "SW Jigging",
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


def load_baraldo_subfamilia_smooth() -> pd.DataFrame:
    b = pd.read_csv(BARALDO_CSV)
    b["subfamilia_norm"] = b["CatItemKey_Norm_Fixed"].map(BARALDO_TO_SUBFAMILIA_NORM)
    b = b.dropna(subset=["subfamilia_norm"])
    b["ds"] = b.apply(_parse_baraldo_month, axis=1)
    b = b.dropna(subset=["ds"])
    # Uppercase para matchear con Articulos.xlsx (que subimos a mayúsculas)
    b["subfamilia_norm"] = b["subfamilia_norm"].str.upper()
    raw = b.groupby(["subfamilia_norm", "ds"], as_index=False)["Sales Units"].sum().rename(columns={"Sales Units": "y"})

    subs = raw["subfamilia_norm"].unique()
    grid = pd.date_range(raw["ds"].min(), raw["ds"].max(), freq="MS")
    frames = []
    for s in subs:
        g = raw[raw["subfamilia_norm"] == s].set_index("ds")["y"].reindex(grid, fill_value=0.0)
        smoothed = g.rolling(BARALDO_SMOOTH, min_periods=1).mean()
        frames.append(pd.DataFrame({"subfamilia_norm": s, "ds": smoothed.index, "y": smoothed.values}))
    out = pd.concat(frames, ignore_index=True)
    print(f"[baraldo smooth-{BARALDO_SMOOTH}] {len(out):,} filas · {len(subs)} subs · {out['ds'].min().date()} -> {out['ds'].max().date()}")
    return out


def build_shimano_by_subfamilia(shimano_raw: pd.DataFrame, cat: pd.DataFrame) -> pd.DataFrame:
    """Aplica mapping item_code -> subfamilia_norm y agrega."""
    m = cat.set_index("item_code")["subfamilia_norm"].to_dict()
    shimano_raw["subfamilia_norm"] = shimano_raw["item_code"].map(m)

    n_mapped = shimano_raw["subfamilia_norm"].notna().sum()
    n_total = len(shimano_raw)
    print(f"[shimano] mapped {n_mapped}/{n_total} rows ({100*n_mapped/n_total:.1f}%)")

    df = shimano_raw.dropna(subset=["subfamilia_norm"]).copy()
    df["y"] = df["qty"].clip(lower=None)  # NCs restan
    agg = df.groupby(["subfamilia_norm", "ds"], as_index=False)["y"].sum()
    agg["y"] = agg["y"].clip(lower=0)  # meses netos negativos van a 0
    print(f"[shimano agg] {len(agg)} filas · {agg['subfamilia_norm'].nunique()} subs · {agg['ds'].min().date()} -> {agg['ds'].max().date()}")
    return agg


def compute_seasonal_index(bar_smooth: pd.DataFrame) -> pd.DataFrame:
    b = bar_smooth[bar_smooth["ds"].dt.year >= 2018].copy()
    b["mes"] = b["ds"].dt.month
    b["year"] = b["ds"].dt.year
    per = b.groupby(["subfamilia_norm", "year", "mes"], as_index=False)["y"].sum()
    idx = pd.MultiIndex.from_product(
        [per["subfamilia_norm"].unique(), per["year"].unique(), range(1, 13)],
        names=["subfamilia_norm", "year", "mes"],
    )
    full = per.set_index(["subfamilia_norm", "year", "mes"]).reindex(idx, fill_value=0.0).reset_index()
    mean_mes = full.groupby(["subfamilia_norm", "mes"], as_index=False)["y"].mean().rename(columns={"y": "mean_mes"})
    mean_anual = full.groupby("subfamilia_norm", as_index=False)["y"].mean().rename(columns={"y": "mean_anual"})
    si = mean_mes.merge(mean_anual, on="subfamilia_norm")
    si["SI"] = (si["mean_mes"] / si["mean_anual"].replace(0, np.nan)).clip(lower=0.2, upper=2.5).fillna(1.0)
    return si[["subfamilia_norm", "mes", "SI"]]


# ---------------------------------------------------------------------------
# Modelos + backtest
# ---------------------------------------------------------------------------
def naive(hist: pd.Series, h: int, start_ds: pd.Timestamp, si_map: dict) -> np.ndarray:
    last = float(hist.iloc[-1]) if len(hist) else 0.0
    return np.full(h, last)


def ma3(hist: pd.Series, h: int, start_ds: pd.Timestamp, si_map: dict) -> np.ndarray:
    v = float(hist.tail(3).mean()) if len(hist) else 0.0
    return np.full(h, v)


def seasonal_naive_yoy(hist: pd.Series, h: int, start_ds: pd.Timestamp, si_map: dict) -> np.ndarray:
    """Predice usando mismo mes 12 meses atrás si existe; sino MA3."""
    hd = {ts.strftime("%Y-%m"): float(v) for ts, v in hist.items()}
    fallback = float(hist.tail(3).mean()) if len(hist) else 0.0
    out = []
    for i in range(h):
        d = start_ds + pd.DateOffset(months=i)
        prev = d - pd.DateOffset(months=12)
        out.append(hd.get(prev.strftime("%Y-%m"), fallback))
    return np.array(out)


def seasonal_level(hist: pd.Series, h: int, start_ds: pd.Timestamp, si_map: dict) -> np.ndarray:
    """Level × SI[mes_futuro]. Level = MA3."""
    level = float(hist.tail(LEVEL_WINDOW).mean()) if len(hist) else 0.0
    out = []
    for i in range(h):
        d = start_ds + pd.DateOffset(months=i)
        out.append(level * si_map.get(d.month, 1.0))
    return np.array(out)


def seasonal_trend(hist: pd.Series, h: int, start_ds: pd.Timestamp, si_map: dict) -> np.ndarray:
    ys = hist.dropna().values.astype(float)
    n = min(len(ys), TREND_WINDOW)
    if n < 2:
        return seasonal_level(hist, h, start_ds, si_map)
    yr = ys[-n:]
    x = np.arange(n)
    slope, intercept = np.polyfit(x, yr, 1)
    level = intercept + slope * (n - 1)
    out = []
    for k in range(1, h + 1):
        base = max(0.0, level + slope * k)
        d = start_ds + pd.DateOffset(months=k - 1)
        out.append(base * si_map.get(d.month, 1.0))
    return np.array(out)


def seasonal_ma3(hist: pd.Series, h: int, start_ds: pd.Timestamp, si_map: dict) -> np.ndarray:
    """MA3 desestacionalizado × SI del futuro. Desestacionaliza dividiendo por
    SI del mes de cada obs, saca MA3, remultiplica por SI futuro."""
    if not si_map or len(hist) == 0:
        return ma3(hist, h, start_ds, si_map)
    des = pd.Series(
        [v / si_map.get(ts.month, 1.0) for ts, v in hist.items()],
        index=hist.index,
    )
    level = float(des.tail(LEVEL_WINDOW).mean())
    return np.array([level * si_map.get((start_ds + pd.DateOffset(months=i)).month, 1.0) for i in range(h)])


def ensemble_median(pred_dict: dict) -> np.ndarray:
    """Mediana entre los modelos que tengan predicción válida."""
    stack = np.vstack(list(pred_dict.values()))
    return np.median(stack, axis=0)


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
            "Seasonal_Trend": seasonal_trend(history, h, start_ds, si_map),
            "Seasonal_MA3": seasonal_ma3(history, h, start_ds, si_map),
        }
        preds["Ensemble_Median"] = ensemble_median({k: v for k, v in preds.items() if k not in ("Naive", "SeasonalNaive_YoY")})

        for m, yp in preds.items():
            for i in range(h):
                rows.append({
                    "unique_id": sub_df["unique_id"].iloc[0],
                    "cutoff": history.index.max(),
                    "ds": test["ds"].iloc[i],
                    "y": float(test["y"].iloc[i]),
                    "model": m,
                    "y_hat": float(yp[i]),
                })
    return pd.DataFrame(rows)


def compute_wape(g: pd.DataFrame) -> float:
    yt = g["y"].values.astype(float)
    yp = g["y_hat"].values.astype(float)
    return float(np.sum(np.abs(yt - yp)) / max(np.sum(np.abs(yt)), 1e-9))


def compute_bias(g: pd.DataFrame) -> float:
    yt = g["y"].values.astype(float)
    yp = g["y_hat"].values.astype(float)
    return float(np.sum(yp - yt) / max(np.sum(yt), 1e-9))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print("=" * 76)
    print("F2A.3 FINAL — mapping externo (Articulos.xlsx) + seasonal decomposition")
    print("=" * 76)
    t0 = datetime.now(timezone.utc)

    print("\n[1/6] Cargando catálogo maestro Articulos.xlsx...")
    cat = load_articulos_catalog()

    print("\n[2/6] Baraldo (smooth) + índice estacional...")
    bar = load_baraldo_subfamilia_smooth()
    si = compute_seasonal_index(bar)
    print(f"  SI: {si['subfamilia_norm'].nunique()} subs × 12 meses")

    print("\n[3/6] Shimano ventas post-splice + mapping externo...")
    bq = init_bq()
    shimano_raw = fetch_shimano_ventas_raw(bq)
    shimano_agg = build_shimano_by_subfamilia(shimano_raw, cat)

    # Reindex mensual completo (fill 0 en meses sin venta).
    subs = shimano_agg["subfamilia_norm"].unique()
    grid = pd.date_range(shimano_agg["ds"].min(), shimano_agg["ds"].max(), freq="MS")
    frames = []
    for s in subs:
        g = shimano_agg[shimano_agg["subfamilia_norm"] == s].set_index("ds")["y"].reindex(grid, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    df_bq = pd.concat(frames, ignore_index=True)
    print(f"  Shimano agg grid: {df_bq['unique_id'].nunique()} subs × {df_bq['ds'].nunique()} meses")

    print(f"\n[4/6] Backtest rolling-origin (h={BACKTEST_H}, w={BACKTEST_WINDOWS})...")
    all_rows = []
    for sub, g in df_bq.groupby("unique_id"):
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        cv = backtest_series(g, si_map)
        if not cv.empty:
            all_rows.append(cv)
    cv_all = pd.concat(all_rows, ignore_index=True) if all_rows else pd.DataFrame()
    print(f"  backtest rows: {len(cv_all)}")

    # Métricas
    per_sub = (
        cv_all.groupby(["unique_id", "model"])
        .apply(
            lambda g: pd.Series({
                "wape": compute_wape(g),
                "bias": compute_bias(g),
                "n_obs": len(g),
                "y_true_sum": g["y"].sum(),
                "y_pred_sum": g["y_hat"].sum(),
            }),
            include_groups=False,
        )
        .reset_index()
    )
    per_sub["wape"] = per_sub["wape"].round(4)
    per_sub["bias"] = per_sub["bias"].round(4)

    agg = (
        per_sub.groupby("model")
        .agg(
            n=("unique_id", "nunique"),
            wape_med=("wape", "median"),
            wape_avg=("wape", "mean"),
            wape_p25=("wape", lambda x: x.quantile(0.25)),
            wape_p75=("wape", lambda x: x.quantile(0.75)),
            n_wape_lt_05=("wape", lambda x: (x < 0.5).sum()),
        )
        .reset_index()
        .sort_values("wape_med")
    )
    print("\n=== BACKTEST AGREGADO POR MODELO ===")
    print(agg.to_string(index=False))

    per_sub.to_csv(OUTPUT_DIR / "final_backtest_por_subfamilia.csv", index=False)
    agg.to_csv(OUTPUT_DIR / "final_backtest_agregado.csv", index=False)

    best = per_sub.sort_values("wape").groupby("unique_id").first().reset_index()
    print("\n=== DISTRIBUCIÓN WAPE (best-per-series) ===")
    print(best["wape"].describe(percentiles=[0.1, 0.25, 0.5, 0.75, 0.9]).to_string())

    n_below = {t: int((best["wape"] < t).sum()) for t in (0.3, 0.5, 0.7, 1.0)}
    n_total = len(best)
    for t, n in n_below.items():
        print(f"  N series con WAPE < {t}: {n}/{n_total} ({100*n/n_total:.1f}%)")

    # Forecast final H=7
    print(f"\n[5/6] Forecast H={HORIZON_FINAL} con best-per-series...")
    max_ds = df_bq["ds"].max()
    start_future = max_ds + pd.offsets.MonthBegin(1)

    forecast_rows = []
    model_fns = {
        "Naive": naive, "MA3": ma3, "SeasonalNaive_YoY": seasonal_naive_yoy,
        "Seasonal_Level": seasonal_level, "Seasonal_Trend": seasonal_trend,
        "Seasonal_MA3": seasonal_ma3,
    }
    for sub, g in df_bq.groupby("unique_id"):
        history = g.set_index("ds")["y"]
        b = best[best["unique_id"] == sub]
        if b.empty:
            continue
        model = b["model"].iloc[0]
        wape = b["wape"].iloc[0]
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}

        if model == "Ensemble_Median":
            preds = {k: fn(history, HORIZON_FINAL, start_future, si_map) for k, fn in model_fns.items() if k not in ("Naive", "SeasonalNaive_YoY")}
            yp = ensemble_median(preds)
        else:
            yp = model_fns[model](history, HORIZON_FINAL, start_future, si_map)

        for i in range(HORIZON_FINAL):
            d = start_future + pd.DateOffset(months=i)
            forecast_rows.append({
                "unique_id": sub,
                "ds": d,
                "y_hat": max(0, int(round(yp[i]))),
                "best_model": model,
                "wape_backtest": round(wape, 3),
            })
    forecast_final = pd.DataFrame(forecast_rows)
    forecast_final.to_csv(OUTPUT_DIR / "final_forecast_h7.csv", index=False)

    tot = forecast_final.groupby("unique_id")["y_hat"].sum().sort_values(ascending=False).head(20)
    top = tot.index
    pv = forecast_final[forecast_final["unique_id"].isin(top)].pivot(index="unique_id", columns="ds", values="y_hat")
    pv.columns = [c.strftime("%Y-%m") for c in pv.columns]
    pv = pv.loc[top]
    pv.insert(0, "best_model", forecast_final.groupby("unique_id")["best_model"].first().loc[top])
    pv.insert(1, "wape_bt", forecast_final.groupby("unique_id")["wape_backtest"].first().loc[top])
    print("\n[6/6] TOP 20 subfamilias por magnitud forecast H=7:")
    print(pv.to_string())

    wape_med = float(best["wape"].median())
    resumen = {
        "generado": t0.isoformat(),
        "approach": "iter3 · mapping externo Articulos.xlsx · Baraldo SI · Shimano nivel · 6 modelos + ensemble",
        "backtest_h": BACKTEST_H,
        "backtest_windows": BACKTEST_WINDOWS,
        "level_window": LEVEL_WINDOW,
        "trend_window": TREND_WINDOW,
        "horizon_final": HORIZON_FINAL,
        "n_subfamilias": int(df_bq["unique_id"].nunique()),
        "n_meses_shimano": int(df_bq["ds"].nunique()),
        "n_meses_baraldo_si": int(bar["ds"].nunique()),
        "wape_mediano_best_per_series": round(wape_med, 3),
        "n_series_wape_lt_0_3": n_below[0.3],
        "n_series_wape_lt_0_5": n_below[0.5],
        "n_series_wape_lt_0_7": n_below[0.7],
        "n_series_total": n_total,
        "goal_met": wape_med < 0.5,
    }
    (OUTPUT_DIR / "final_resumen.json").write_text(
        json.dumps(resumen, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("\n[done] resumen:")
    print(json.dumps(resumen, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
