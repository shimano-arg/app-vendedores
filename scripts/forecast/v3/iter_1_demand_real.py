"""Iter 1 — Target real = venta facturada + backorder abierto (demanda insatisfecha).

Hipotesis: en meses con quiebre de stock, la venta real subestima la demanda real.
Sumando el BO abierto por SKU al target, capturamos la demanda que no se cumplio.
Esto deberia dar mejor forecast en subfamilias con historial de quiebres.

Fuentes nuevas:
- BQ v_backorder_app (estado actual pedidos app, aplanado por SKU)
- pedidos_raw_raw_changelog (reconstruye snapshots mensuales de BO abierto)

Fallback: si pedidos_raw_raw_changelog no está disponible o es muy ruidoso,
usamos solo el BO actual como "features de demanda pendiente" para el mes mas reciente.

Baseline a batir: 0.422 (iter 0).
Gate: WAPE <= 0.40 (mejora >=0.022).
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

warnings.filterwarnings("ignore")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from train_final import (  # type: ignore  # noqa: E402
    BACKTEST_H,
    BACKTEST_WINDOWS,
    HORIZON_FINAL,
    LEVEL_WINDOW,
    TREND_WINDOW,
    backtest_series,
    build_shimano_by_subfamilia,
    compute_seasonal_index,
    fetch_shimano_ventas_raw,
    init_bq,
    load_articulos_catalog,
    load_baraldo_subfamilia_smooth,
)


def fetch_backorder_timeline(bq, cat: pd.DataFrame) -> pd.DataFrame:
    """Reconstruir BO abierto por subfamilia × mes desde pedidos_raw_raw_latest.

    Estrategia: para cada linea de pedido:
    - qty_open > 0 significa demanda pendiente al momento del snapshot (latest).
    - Usamos createdAt como fecha de origen de la demanda.
    - Agrupamos por subfamilia + mes del createdAt → qty_open suma.

    LIMITACION: esto captura demanda actualmente pendiente, no un timeline historico.
    Para serie completa habria que leer pedidos_raw_raw_changelog, mas pesado.
    En este iter usamos el proxy "fecha de origen del BO" como fecha target.
    """
    sql = """
    SELECT
      sku,
      qty_open,
      PARSE_DATE('%Y-%m-%d', FORMAT_DATE('%Y-%m-01', DATE(created_at))) AS ds,
      familia,
      subfamilia
    FROM `app-vendedores-shimano.shimano_app.v_backorder_app`
    WHERE qty_open > 0
      AND created_at IS NOT NULL
    """
    print("  [bq] v_backorder_app ...")
    try:
        df = bq.query(sql).to_dataframe()
    except Exception as e:
        print(f"  [WARN] v_backorder_app query fallo: {e}")
        print("  [FALLBACK] usar solo backorderBySku del stock_snapshot (ultima foto)")
        return pd.DataFrame()
    print(f"  BO rows: {len(df)}")
    if df.empty:
        return pd.DataFrame()
    # Agregar por subfamilia × mes
    code_to_sub = dict(zip(cat["item_code"].str.upper(), cat["subfamilia_norm"]))
    df["unique_id"] = df["sku"].astype(str).str.upper().map(code_to_sub).fillna("UNK")
    df = df[df["unique_id"] != "UNK"]
    agg = df.groupby(["unique_id", "ds"], as_index=False)["qty_open"].sum().rename(
        columns={"qty_open": "bo_abierto"}
    )
    # Coerce ds a Timestamp (BQ devuelve dbdate, no mergeable con datetime64).
    agg["ds"] = pd.to_datetime(agg["ds"])
    return agg


def main() -> None:
    print("=" * 72)
    print("ITER 1 — target = venta + backorder abierto")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/6] catálogo + Baraldo + SI...")
    cat = load_articulos_catalog()
    bar = load_baraldo_subfamilia_smooth()
    si = compute_seasonal_index(bar)

    print("\n[2/6] Shimano ventas BQ...")
    bq = init_bq()
    shimano_raw = fetch_shimano_ventas_raw(bq)
    shimano_agg = build_shimano_by_subfamilia(shimano_raw, cat)
    subs = shimano_agg["subfamilia_norm"].unique()
    grid = pd.date_range(shimano_agg["ds"].min(), shimano_agg["ds"].max(), freq="MS")
    frames = []
    for s in subs:
        g = shimano_agg[shimano_agg["subfamilia_norm"] == s].set_index("ds")["y"].reindex(grid, fill_value=0.0)
        frames.append(pd.DataFrame({"unique_id": s, "ds": g.index, "y": g.values}))
    df_ventas = pd.concat(frames, ignore_index=True)

    print("\n[3/6] Backorder abierto por subfamilia × mes...")
    bo_df = fetch_backorder_timeline(bq, cat)
    if bo_df.empty:
        print("  [WARN] sin BO data, iter 1 degenera a iter 0.")
        bo_df = pd.DataFrame(columns=["unique_id", "ds", "bo_abierto"])

    print(f"  BO agregado: {bo_df['unique_id'].nunique() if not bo_df.empty else 0} subs × {bo_df['ds'].nunique() if not bo_df.empty else 0} meses")

    # Merge
    df = df_ventas.merge(bo_df, on=["unique_id", "ds"], how="left")
    df["bo_abierto"] = df["bo_abierto"].fillna(0.0)
    df["y_demand"] = df["y"] + df["bo_abierto"]  # TARGET NUEVO
    print(f"\n  venta total: {df['y'].sum():.0f}  ·  BO total abierto: {df['bo_abierto'].sum():.0f}")
    print(f"  demanda real (y_demand): {df['y_demand'].sum():.0f} (+{100*df['bo_abierto'].sum()/max(df['y'].sum(),1e-9):.1f}% vs venta)")

    # Reemplazar y por y_demand para el backtest (el pipeline existente lee y).
    df_train = df.rename(columns={"y": "y_venta"})[["unique_id", "ds", "y_demand"]].rename(columns={"y_demand": "y"})

    print(f"\n[4/6] Backtest rolling h={BACKTEST_H} w={BACKTEST_WINDOWS}...")
    all_cv = []
    for sub, g in df_train.groupby("unique_id"):
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        cv = backtest_series(g, si_map)
        if not cv.empty:
            all_cv.append(cv)
    cv_all = pd.concat(all_cv, ignore_index=True) if all_cv else pd.DataFrame()
    print(f"  backtest rows: {len(cv_all)}")

    # best per series
    def _agg(g):
        return pd.Series({
            "wape": float(np.sum(np.abs(g["y"] - g["y_hat"])) / max(np.sum(np.abs(g["y"])), 1e-9)),
            "bias": float(np.sum(g["y_hat"] - g["y"]) / max(np.sum(g["y"]), 1e-9)),
            "mae": float(np.mean(np.abs(g["y"] - g["y_hat"]))),
            "n_obs": len(g),
        })
    per_all = cv_all.groupby(["unique_id", "model"]).apply(_agg, include_groups=False).reset_index()
    best = per_all.sort_values("wape").groupby("unique_id").first().reset_index()
    by_series = best[["unique_id", "wape", "bias", "mae", "n_obs"]].copy()
    summary = summary_metrics(by_series)
    summary["modelos_elegidos"] = best["model"].value_counts().to_dict()

    print(f"\n  WAPE mediano: {summary['wape_median']:.4f}")
    print(f"  WAPE p25/p75: {summary['wape_p25']:.4f} / {summary['wape_p75']:.4f}")
    print(f"  n_series WAPE<0.3: {summary['n_series_wape_lt_0_3']}, <0.5: {summary['n_series_wape_lt_0_5']}")

    # Forecast final 7m con target demanda real
    print(f"\n[5/6] Forecast h={HORIZON_FINAL} forward...")
    from train_final import ma3, seasonal_level, seasonal_trend, seasonal_ma3, ensemble_median
    last_ds = df_train["ds"].max()
    start_fcst = (last_ds + pd.DateOffset(months=1)).normalize()
    rows = []
    for sub, g in df_train.groupby("unique_id"):
        si_sub = si[si["subfamilia_norm"] == sub]
        si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}
        hist = g.set_index("ds")["y"]
        # Elegir el modelo ganador para esta serie (del backtest)
        winner = best[best["unique_id"] == sub]["model"].iloc[0] if not best[best["unique_id"] == sub].empty else "Seasonal_Level"
        if winner == "MA3":
            yp = ma3(hist, HORIZON_FINAL, start_fcst, si_map)
        elif winner == "Seasonal_Level":
            yp = seasonal_level(hist, HORIZON_FINAL, start_fcst, si_map)
        elif winner == "Seasonal_Trend":
            yp = seasonal_trend(hist, HORIZON_FINAL, start_fcst, si_map)
        elif winner == "Seasonal_MA3":
            yp = seasonal_ma3(hist, HORIZON_FINAL, start_fcst, si_map)
        else:
            # ensemble fallback
            preds = {
                "MA3": ma3(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_Level": seasonal_level(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_Trend": seasonal_trend(hist, HORIZON_FINAL, start_fcst, si_map),
                "Seasonal_MA3": seasonal_ma3(hist, HORIZON_FINAL, start_fcst, si_map),
            }
            yp = ensemble_median(preds)
        for i in range(HORIZON_FINAL):
            rows.append({
                "unique_id": sub,
                "ds": (start_fcst + pd.DateOffset(months=i)).normalize(),
                "y_hat": float(max(0.0, yp[i])),
                "model": winner,
            })
    fcst_df = pd.DataFrame(rows)
    sanity = sanity_checks(fcst_df, hist_df=df_train)
    print(f"  sanity flags: {[k for k, v in sanity.items() if k.startswith('flag_') and v]}")

    # Guardar
    by_series.to_csv(V3_OUTPUT / "iter_1_backtest_por_subfamilia.csv", index=False)
    fcst_df.to_csv(V3_OUTPUT / "iter_1_forecast_h7.csv", index=False)

    resumen = {
        "iter": 1,
        "label": "demanda_real_venta_mas_BO",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "backtest_h": BACKTEST_H,
        "backtest_windows": BACKTEST_WINDOWS,
        "level_window": LEVEL_WINDOW,
        "trend_window": TREND_WINDOW,
        "horizonte": HORIZON_FINAL,
        "features": ["baraldo_SI", "shimano_BQ_level", "backorder_abierto"],
        "feature_impact": {
            "venta_total": float(df["y"].sum()),
            "bo_total": float(df["bo_abierto"].sum()),
            "pct_bo_sobre_venta": float(100 * df["bo_abierto"].sum() / max(df["y"].sum(), 1e-9)),
        },
        "n_subfamilias": int(df_train["unique_id"].nunique()),
        "n_meses_shimano": int(df_train["ds"].nunique()),
        "summary": summary,
        "sanity": sanity,
    }
    (V3_OUTPUT / "iter_1_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )
    print(f"\n[DONE] WAPE mediano = {summary['wape_median']:.4f} (baseline iter_0: 0.422)")
    delta = summary['wape_median'] - 0.422
    print(f"  Delta vs baseline: {delta:+.4f}")
    print(f"  Gate: WAPE <= 0.40 ?", "PASS" if summary['wape_median'] <= 0.40 else "FAIL")


if __name__ == "__main__":
    main()
