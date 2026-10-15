"""Iter 7 — Prophet con covariates (pivot pragmático desde Chronos-2 que no instala).

Prophet pros:
- Covariates nativas (sales_plan, dolar, torneo, electoral, SI).
- Zero-shot style: hyperparameters default razonables, no requiere tuneo.
- Honest-measurable con single fold (no hay grid search leak).
- Trabaja bien con series cortas (7 meses OK).

Features exógenas:
- qty_sp (sales plan del mes)
- dolar_oficial_prom
- tasa_bcra_tna
- es_electoral
- torneo_grande
- si_cur (indice estacional Baraldo del mes futuro, cuando subfamilia tiene SI)

Approach:
- Extender serie con Baraldo pre-splice (mismo que iter_5).
- Prophet por subfamilia (una serie por vez).
- Backtest honest: solo 1 fold limpio (el último BACKTEST_H=2 meses).
- Métricas: WAPE eval en fold limpio.
- Comparar vs iter_0 (0.422) y iter_2 (0.398 optimista).

Si WAPE honest de Prophet ≤ 0.42, es mejora medible real. Si no, iter_2 queda.
"""
from __future__ import annotations

import json
import os
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

os.environ.setdefault("CMDSTAN_VERBOSE", "False")

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
from prophet import Prophet  # noqa: E402
import logging  # noqa: E402

logging.getLogger("prophet").setLevel(logging.WARNING)
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)

from train_final import (  # type: ignore  # noqa: E402
    BACKTEST_H, HORIZON_FINAL,
    build_shimano_by_subfamilia, compute_seasonal_index,
    fetch_shimano_ventas_raw, init_bq,
    load_articulos_catalog, load_baraldo_subfamilia_smooth,
)

PROJECT = "app-vendedores-shimano"
EXOGENAS_CSV = SCRIPT_DIR.parent / "inputs" / "exogenas.csv"


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


def load_exogenas():
    ex = pd.read_csv(EXOGENAS_CSV)
    ex["ds"] = pd.to_datetime(ex["mes"] + "-01")
    cols = ["ds", "rem_ipc_12m", "dolar_oficial_prom", "tasa_bcra_tna", "es_electoral", "torneo_grande"]
    ex = ex[cols].copy()
    ex = ex.sort_values("ds").reset_index(drop=True)
    for c in cols[1:]:
        ex[c] = pd.to_numeric(ex[c], errors="coerce").ffill().bfill().fillna(0.0)
    return ex


def main():
    print("=" * 72)
    print("ITER 7 — Prophet + covariates (sales plan, dolar, torneos, electoral)")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/6] Datos base + extensión Baraldo...")
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

    # Extender con Baraldo pre-splice
    shim_start = df_shim["ds"].min()
    bar_df = bar[["subfamilia_norm", "ds", "y"]].rename(columns={"subfamilia_norm": "unique_id"})
    bar_df = bar_df[bar_df["ds"] < shim_start].copy()
    df_combined = pd.concat([bar_df, df_shim], ignore_index=True).sort_values(["unique_id", "ds"]).reset_index(drop=True)
    df_combined["ds"] = pd.to_datetime(df_combined["ds"])
    # Reindex grid completo por serie
    grid_full = pd.date_range(df_combined["ds"].min(), df_combined["ds"].max(), freq="MS")
    frames = []
    for s in df_combined["unique_id"].unique():
        g = df_combined[df_combined["unique_id"] == s].set_index("ds")["y"].reindex(grid_full, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    df = pd.concat(frames, ignore_index=True)
    print(f"  Serie extendida: {df['unique_id'].nunique()} subs × {df['ds'].nunique()} meses "
          f"({df['ds'].min().strftime('%Y-%m')} → {df['ds'].max().strftime('%Y-%m')})")

    print("\n[2/6] Features exógenas...")
    sp = fetch_sales_plans(cat)
    sp["ds"] = pd.to_datetime(sp["ds"])
    ex = load_exogenas()
    print(f"  sales plan: {len(sp)} filas, {sp['unique_id'].nunique()} subs")
    print(f"  exógenas macro: {len(ex)} meses, cols {list(ex.columns[1:])}")

    # SI index por serie × mes
    si_map = {(r.subfamilia_norm, r.mes): r.SI for r in si.itertuples()}

    def enrich_exog(df_in, sub):
        """Agregar sales_plan, dolar_oficial, tasa_bcra, electoral, torneo, si_cur."""
        d = df_in.copy()
        d = d.merge(sp[sp["unique_id"] == sub][["ds", "qty_sp"]], on="ds", how="left")
        d["qty_sp"] = d["qty_sp"].fillna(0.0)
        d = d.merge(ex, on="ds", how="left")
        for c in ["rem_ipc_12m", "dolar_oficial_prom", "tasa_bcra_tna", "es_electoral", "torneo_grande"]:
            d[c] = d[c].ffill().bfill().fillna(0.0)
        d["si_cur"] = d["ds"].dt.month.map(lambda m: si_map.get((sub, m), 1.0))
        return d

    print(f"\n[3/6] Prophet por subfamilia, backtest honest 1 fold (ultimo h={BACKTEST_H})...")
    EXOG_COLS = ["qty_sp", "dolar_oficial_prom", "tasa_bcra_tna",
                 "es_electoral", "torneo_grande", "si_cur"]
    results = []
    forecasts_future = []

    for sub, g in df.groupby("unique_id"):
        g = g.sort_values("ds").reset_index(drop=True)
        if len(g) < 4 + BACKTEST_H:
            continue
        split = len(g) - BACKTEST_H
        train = g.iloc[:split].copy()
        test = g.iloc[split:].copy()
        # Enrich
        train = enrich_exog(train, sub)
        test = enrich_exog(test, sub)

        prophet_train = train[["ds", "y"] + EXOG_COLS].copy()
        try:
            m = Prophet(
                yearly_seasonality=True,
                weekly_seasonality=False,
                daily_seasonality=False,
                seasonality_mode="additive",
                changepoint_prior_scale=0.05,
                n_changepoints=min(10, max(2, len(train) // 10)),
            )
            for c in EXOG_COLS:
                m.add_regressor(c, standardize=True)
            m.fit(prophet_train)

            # Predict en fold eval
            future_test = test[["ds"] + EXOG_COLS].copy()
            pred = m.predict(future_test)
            y_hat = np.clip(pred["yhat"].values, 0.0, None)
            y_true = test["y"].values
            wape = float(np.sum(np.abs(y_true - y_hat)) / max(np.sum(np.abs(y_true)), 1e-9))
            bias = float(np.sum(y_hat - y_true) / max(np.sum(y_true), 1e-9))
            mae = float(np.mean(np.abs(y_true - y_hat)))
            results.append({
                "unique_id": sub, "wape": wape, "bias": bias, "mae": mae, "n_obs": len(y_true),
            })

            # Predict forward 7m con todo entrenado (fit con todo el histórico)
            m_full = Prophet(
                yearly_seasonality=True, weekly_seasonality=False, daily_seasonality=False,
                seasonality_mode="additive", changepoint_prior_scale=0.05,
                n_changepoints=min(10, max(2, len(g) // 10)),
            )
            for c in EXOG_COLS:
                m_full.add_regressor(c, standardize=True)
            full_train = enrich_exog(g, sub)[["ds", "y"] + EXOG_COLS]
            m_full.fit(full_train)
            future_dates = pd.date_range(g["ds"].max() + pd.DateOffset(months=1), periods=HORIZON_FINAL, freq="MS")
            future_df = pd.DataFrame({"ds": future_dates})
            future_df = enrich_exog(future_df, sub)
            pred_future = m_full.predict(future_df[["ds"] + EXOG_COLS])
            for i, d_ in enumerate(future_dates):
                forecasts_future.append({
                    "unique_id": sub, "ds": d_,
                    "y_hat": float(max(0.0, pred_future["yhat"].iloc[i])),
                    "yhat_lower": float(max(0.0, pred_future["yhat_lower"].iloc[i])),
                    "yhat_upper": float(max(0.0, pred_future["yhat_upper"].iloc[i])),
                })
        except Exception as e:
            print(f"  [WARN] {sub} fallo: {e}")
            continue

    by_series = pd.DataFrame(results)
    if by_series.empty:
        print("[ERR] no se evaluó ninguna serie")
        return
    summary = summary_metrics(by_series)
    print(f"\n  [HONEST eval 1 fold] WAPE mediano: {summary['wape_median']:.4f}")
    print(f"    p25/p75: {summary['wape_p25']:.4f} / {summary['wape_p75']:.4f}")
    print(f"    n<0.3: {summary['n_series_wape_lt_0_3']} · n<0.5: {summary['n_series_wape_lt_0_5']}")

    fcst_df = pd.DataFrame(forecasts_future)
    sanity = sanity_checks(fcst_df, hist_df=df)
    print(f"  sanity flags: {[k for k, v in sanity.items() if k.startswith('flag_') and v]}")

    by_series.to_csv(V3_OUTPUT / "iter_7_backtest_por_subfamilia.csv", index=False)
    fcst_df.to_csv(V3_OUTPUT / "iter_7_forecast_h7.csv", index=False)

    resumen = {
        "iter": 7,
        "label": "prophet_covariates_honest_single_fold",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "backtest_h": BACKTEST_H,
        "backtest_folds": 1,
        "horizonte": HORIZON_FINAL,
        "features": EXOG_COLS,
        "modelo": "Prophet (yearly_seasonality + 6 regressors standardized)",
        "n_subfamilias": int(by_series["unique_id"].nunique()),
        "n_meses_total": int(df["ds"].nunique()),
        "summary": summary,
        "sanity": sanity,
        "nota": "WAPE eval en SOLO el ultimo fold (h=2). NO hay grid search ni leak. Compara honest vs iter_0 (0.422) e iter_2 (0.398 OPTIMISTA).",
    }
    (V3_OUTPUT / "iter_7_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )

    print(f"\n[DONE] WAPE honest Prophet = {summary['wape_median']:.4f}")
    print(f"  Comparacion:")
    print(f"    iter_0 baseline (potencialmente también con leak): 0.422")
    print(f"    iter_2 sales plan blend (hyperparameter leak): 0.398 OPTIMISTA")
    print(f"    iter_7 Prophet (HONEST, 1 fold limpio):             {summary['wape_median']:.4f}")


if __name__ == "__main__":
    main()
