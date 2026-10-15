"""Iter 8 — incorpora TODAS las señales de demanda disponibles.

Mariano pidio tener en cuenta:
1. Lo pedido para proximos meses (sales_plan_cache) — ya lo tenia iter_2.
2. Campañas (nuevo) — target comprometido por SKU x mes.
3. Sesgo Baraldo (oferta != demanda) — detectar "subs nuevos" sin SI confiable.
4. Stock en warehouse 11 de PESCA (sap_items_raw.stock_total_sellable).

Approach pragmatico (no reclamamos WAPE honest-measurable, es imposible con
7m Shimano. Reclamamos mejora cualitativa):
- Forecast base = ensemble stat + sales_plan blend (iter_2 bridgeSI style).
- Feature "campaign_boost": si hay campania activa para alguna sub en un mes
  dado, bump el forecast por target_amount/duracion_meses (proporcional).
- Feature "backorder_signal": incluir BO abierto como demanda insatisfecha del
  primer mes del horizonte (demanda pendiente que necesita cumplirse).
- Feature "stock_dep11_actual": info de disponibilidad, NO cap duro.
- Flag "subfamilia_es_nueva_shimano": si volumen_shim/volumen_bar < 2%
  (Baraldo era mercado total o nada, Shimano directo es share chico) la
  subfamilia es "nueva" en el nuevo regimen → NO usar SI Baraldo, usar
  seasonal_naive_yoy fallback.

Output: forecast_v3c publicado a Firestore con metadata por sub:
    - forecast base
    - campaign_bump_pct
    - backorder_signal_m1
    - stock_dep11
    - es_nueva_shimano (flag)
"""
from __future__ import annotations

import json
import os
import re
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
V2_DIR = SCRIPT_DIR.parent
V3_OUTPUT = SCRIPT_DIR / "output"

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
    BACKTEST_H, HORIZON_FINAL,
    build_shimano_by_subfamilia, compute_seasonal_index,
    fetch_shimano_ventas_raw, init_bq,
    load_articulos_catalog, load_baraldo_subfamilia_smooth,
    ma3, seasonal_level, seasonal_ma3, seasonal_trend, ensemble_median,
    seasonal_naive_yoy,
)

from opt_b_02_bridge_map import BRIDGE_SHIM_TO_BAR  # noqa: E402

PROJECT = "app-vendedores-shimano"
ALPHAS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
NUEVA_THRESHOLD_PCT = 2.0  # <2% ratio volumen → "sub nueva en regimen Shimano"


def fetch_stock_dep11_by_sub(bq, cat):
    """Devuelve DataFrame subfamilia_norm -> stock dep 11 agregado."""
    sql = """
    SELECT i.fam AS familia_articulo,
           COUNT(DISTINCT i.item_code) AS n_skus,
           SUM(COALESCE(i.stock_total_sellable, 0)) AS stock_dep11
    FROM `app-vendedores-shimano.shimano_app.sap_items_raw` i
    WHERE i.items_group_code = 102
    GROUP BY 1
    """
    df = bq.query(sql).to_dataframe()
    df["familia_articulo"] = df["familia_articulo"].fillna("").astype(str).str.upper().str.strip()
    df = df.rename(columns={"familia_articulo": "subfamilia_norm"})
    return df


def fetch_backorder_by_sub(bq):
    """BO actual abierto por subfamilia."""
    sql = """
    SELECT i.fam AS familia_articulo,
           SUM(COALESCE(ba.qty_open, 0)) AS backorder_abierto,
           COUNT(DISTINCT ba.sku) AS n_skus_bo
    FROM `app-vendedores-shimano.shimano_app.v_backorder_app` ba
    LEFT JOIN `app-vendedores-shimano.shimano_app.sap_items_raw` i ON ba.sku = i.item_code
    WHERE i.items_group_code = 102 AND ba.qty_open > 0
    GROUP BY 1
    """
    df = bq.query(sql).to_dataframe()
    df["familia_articulo"] = df["familia_articulo"].fillna("").astype(str).str.upper().str.strip()
    df = df.rename(columns={"familia_articulo": "subfamilia_norm"})
    return df


def fetch_campaigns_future(cat):
    """Mapea campañas activas/futuras a subfamilia × mes con target units."""
    db = firestore.Client(project=PROJECT)
    snap = db.collection("campaigns").get()
    code_to_sub = dict(zip(cat["item_code"].str.upper(), cat["subfamilia_norm"]))
    rows = []
    for d in snap:
        data = d.to_dict() or {}
        if data.get("archivedManually") is True:
            continue
        if (data.get("targetType") or "units") != "units":
            continue  # ignoramos campañas money, no sabemos convertir a units
        skus = data.get("skus") or data.get("filterValues") or []
        start = str(data.get("startDate") or "")
        end = str(data.get("endDate") or "")
        target = float(data.get("targetAmount") or 0)
        if not skus or not start or not end or target <= 0:
            continue
        try:
            ds_start = pd.to_datetime(start)
            ds_end = pd.to_datetime(end)
        except Exception:
            continue
        # Expandir a meses
        months = pd.date_range(ds_start, ds_end, freq="MS")
        if len(months) == 0:
            months = [ds_start.to_period("M").to_timestamp()]
        n_months = len(months)
        # target por sku × mes = target / (n_skus * n_months) (reparto plano)
        per_cell = target / max(len(skus) * n_months, 1)
        for sku in skus:
            sub = code_to_sub.get(str(sku).upper().strip())
            if not sub:
                continue
            for m in months:
                rows.append({"unique_id": sub, "ds": m, "campaign_target": per_cell})
    if not rows:
        return pd.DataFrame(columns=["unique_id", "ds", "campaign_target"])
    return pd.DataFrame(rows).groupby(["unique_id", "ds"], as_index=False)["campaign_target"].sum()


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


def blended(stat, sp, alpha):
    out = []
    for s, p in zip(stat, sp):
        out.append(alpha * p + (1 - alpha) * s if p > 0 else s)
    return np.array(out)


def main():
    print("=" * 72)
    print("ITER 8 — demand signals (stock + BO + campañas + sesgo Baraldo)")
    print("=" * 72)
    t0 = datetime.now(timezone.utc)

    print("\n[1/8] Datos base + bridge SI...")
    cat = load_articulos_catalog()
    bar = load_baraldo_subfamilia_smooth()
    si = compute_seasonal_index(bar)
    # SI augmentado con bridge
    si_aug_rows = []
    for shim_sub, bar_sub in BRIDGE_SHIM_TO_BAR.items():
        if bar_sub in si["subfamilia_norm"].values:
            si_bar = si[si["subfamilia_norm"] == bar_sub].copy()
            si_bar["subfamilia_norm"] = shim_sub
            si_aug_rows.append(si_bar)
    si_aug = pd.concat([si] + si_aug_rows, ignore_index=True) if si_aug_rows else si

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

    print("\n[2/8] Flag subs nuevas regimen Shimano (sesgo Baraldo)...")
    # Volumen Shimano acumulado por sub
    vol_shim = shim_agg.groupby("subfamilia_norm")["y"].sum()
    # Volumen Baraldo normalizado al mismo periodo (7 meses de promedio reciente)
    bar_recent = bar[bar["ds"] >= bar["ds"].max() - pd.DateOffset(months=24)].copy()
    bar_monthly = bar_recent.groupby("subfamilia_norm")["y"].mean()
    bar_7m = bar_monthly * 7  # proyeccion 7m
    # Aplicar bridge para match
    bar_7m_mapped = bar_7m.copy()
    for shim_sub, bar_sub in BRIDGE_SHIM_TO_BAR.items():
        if bar_sub in bar_7m.index:
            bar_7m_mapped[shim_sub] = bar_7m[bar_sub]

    nueva_flags = {}
    for s in subs:
        v_s = float(vol_shim.get(s, 0))
        v_b = float(bar_7m_mapped.get(s, 0))
        if v_b > 0:
            ratio = 100 * v_s / v_b
        else:
            ratio = -1  # sin referencia
        nueva_flags[s] = {
            "vol_shim_7m": v_s,
            "vol_bar_estim_7m": v_b,
            "ratio_pct": ratio,
            "es_nueva": ratio < NUEVA_THRESHOLD_PCT and ratio >= 0 or v_b == 0,
        }
    n_nuevas = sum(1 for v in nueva_flags.values() if v["es_nueva"])
    print(f"  subs flaggeadas como 'nuevas Shimano' (sin SI Baraldo confiable): {n_nuevas}/{len(subs)}")
    for s, f in sorted(nueva_flags.items(), key=lambda x: -x[1]["vol_shim_7m"])[:5]:
        if f["es_nueva"]:
            print(f"    - {s}: vol_shim={f['vol_shim_7m']:.0f}u, vol_bar_estim={f['vol_bar_estim_7m']:.0f}u, ratio={f['ratio_pct']:.1f}%")

    print("\n[3/8] Stock dep11 por sub...")
    stock_df = fetch_stock_dep11_by_sub(bq, cat)
    stock_map = dict(zip(stock_df["subfamilia_norm"], stock_df["stock_dep11"]))
    print(f"  subs con stock dep11: {(stock_df['stock_dep11'] > 0).sum()}/{len(stock_df)}")
    print(f"  stock dep11 total PESCA: {stock_df['stock_dep11'].sum():,.0f}")

    print("\n[4/8] Backorder abierto por sub...")
    bo_df = fetch_backorder_by_sub(bq)
    bo_map = dict(zip(bo_df["subfamilia_norm"], bo_df["backorder_abierto"]))
    print(f"  subs con BO abierto: {(bo_df['backorder_abierto'] > 0).sum()}/{len(bo_df)}")
    print(f"  BO total PESCA: {bo_df['backorder_abierto'].sum():,.0f}")

    print("\n[5/8] Campañas activas (target units)...")
    camp_df = fetch_campaigns_future(cat)
    camp_map = {(r.unique_id, r.ds): r.campaign_target for r in camp_df.itertuples()} if not camp_df.empty else {}
    print(f"  cells campaña (sub, mes): {len(camp_map)}")
    if not camp_df.empty:
        print(f"  target units total campañas: {camp_df['campaign_target'].sum():,.0f}")

    print("\n[6/8] Sales plans...")
    sp = fetch_sales_plans(cat)
    sp["ds"] = pd.to_datetime(sp["ds"])
    sp_map = {(r.unique_id, r.ds): r.qty_sp for r in sp.itertuples()} if not sp.empty else {}

    print(f"\n[7/8] Backtest + forecast con todas las features...")
    rows_eval = []
    fcst_rows = []
    last_ds = df["ds"].max()
    start_fcst = (last_ds + pd.DateOffset(months=1)).normalize()

    for sub, g in df.groupby("unique_id"):
        g = g.sort_values("ds").reset_index(drop=True)
        n = len(g)
        if n < 4 + BACKTEST_H:
            continue
        # Si es nueva (sin SI Baraldo confiable), usar seasonal_naive_yoy fallback
        es_nueva = nueva_flags.get(sub, {}).get("es_nueva", False)
        if es_nueva:
            si_map = {}  # fuerza modelos a MA3/seasonal_naive fallback
        else:
            si_sub = si_aug[si_aug["subfamilia_norm"] == sub]
            si_map = dict(zip(si_sub["mes"], si_sub["SI"])) if len(si_sub) else {}

        # 1-fold eval en último BACKTEST_H
        split = n - BACKTEST_H
        train = g.iloc[:split]
        test = g.iloc[split:]
        history = train.set_index("ds")["y"]
        start_test = test["ds"].iloc[0]
        h_test = len(test)

        models_test = {
            "MA3": ma3(history, h_test, start_test, si_map),
            "Seasonal_Level": seasonal_level(history, h_test, start_test, si_map),
            "Seasonal_Trend": seasonal_trend(history, h_test, start_test, si_map),
            "Seasonal_MA3": seasonal_ma3(history, h_test, start_test, si_map),
        }
        if es_nueva:
            models_test["Seasonal_Naive_YoY"] = seasonal_naive_yoy(history, h_test, start_test, si_map)
        models_test["Ensemble_Median"] = ensemble_median(models_test)
        sp_vals_t = np.array([sp_map.get((sub, test["ds"].iloc[i]), 0.0) for i in range(h_test)])

        best = (None, None, float("inf"))
        for mname in models_test.keys():
            for alpha in ALPHAS:
                yh = blended(models_test[mname], sp_vals_t, alpha)
                wape = float(np.sum(np.abs(test["y"].values - yh)) / max(np.sum(np.abs(test["y"].values)), 1e-9))
                if wape < best[2]:
                    best = (mname, alpha, wape)
        winner_m, winner_a, wape_1f = best
        yh_winner = blended(models_test[winner_m], sp_vals_t, winner_a)
        ytest = test["y"].values
        rows_eval.append({
            "unique_id": sub, "model": winner_m, "alpha": winner_a,
            "wape_1fold": wape_1f,
            "mae": float(np.mean(np.abs(ytest - yh_winner))),
            "bias": float(np.sum(yh_winner - ytest) / max(np.sum(ytest), 1e-9)),
            "n_obs": len(ytest),
            "es_nueva": es_nueva,
        })

        # Forecast forward
        hist = g.set_index("ds")["y"]
        models_fwd = {
            "MA3": ma3(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_Level": seasonal_level(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_Trend": seasonal_trend(hist, HORIZON_FINAL, start_fcst, si_map),
            "Seasonal_MA3": seasonal_ma3(hist, HORIZON_FINAL, start_fcst, si_map),
        }
        if es_nueva:
            models_fwd["Seasonal_Naive_YoY"] = seasonal_naive_yoy(hist, HORIZON_FINAL, start_fcst, si_map)
        models_fwd["Ensemble_Median"] = ensemble_median(models_fwd)
        stat_f = models_fwd[winner_m]
        sp_vals_f = np.array([
            sp_map.get((sub, (start_fcst + pd.DateOffset(months=i)).normalize()), 0.0)
            for i in range(HORIZON_FINAL)
        ])
        base = blended(stat_f, sp_vals_f, winner_a)

        # Boost por campaña (sumar target units al mes correspondiente)
        for i in range(HORIZON_FINAL):
            ds_i = (start_fcst + pd.DateOffset(months=i)).normalize()
            boost = camp_map.get((sub, ds_i), 0.0)
            base[i] = base[i] + boost

        # Agregar backorder abierto al mes 1 (demanda pendiente que necesita cumplirse)
        bo_sub = float(bo_map.get(sub, 0))
        if bo_sub > 0:
            base[0] += bo_sub

        # Cap suave: si forecast > 2x promedio histórico Shimano reciente, warn
        hist_mean = float(hist.tail(6).mean()) if len(hist) >= 1 else 0
        for i in range(HORIZON_FINAL):
            if hist_mean > 0 and base[i] > 3 * hist_mean:
                base[i] = min(base[i], 3 * hist_mean + bo_sub)

        for i in range(HORIZON_FINAL):
            ds_i = (start_fcst + pd.DateOffset(months=i)).normalize()
            fcst_rows.append({
                "unique_id": sub,
                "ds": ds_i,
                "y_hat": float(max(0.0, base[i])),
                "model": winner_m,
                "alpha": winner_a,
                "campaign_boost_u": float(camp_map.get((sub, ds_i), 0.0)),
                "backorder_added_u": float(bo_sub if i == 0 else 0),
                "stock_dep11_actual": float(stock_map.get(sub, 0)),
                "es_nueva_shimano": bool(es_nueva),
            })

    by_series = pd.DataFrame(rows_eval)
    summary = summary_metrics(by_series.rename(columns={"wape_1fold": "wape"}))
    summary["modelos_elegidos"] = by_series["model"].value_counts().to_dict()
    summary["alphas_elegidos"] = by_series["alpha"].value_counts().sort_index().to_dict()
    summary["n_subs_nuevas"] = int(by_series["es_nueva"].sum())

    print(f"\n  WAPE 1-fold (optimistic, no honest): {summary['wape_median']:.4f}")
    print(f"  n<0.3: {summary['n_series_wape_lt_0_3']} · n<0.5: {summary['n_series_wape_lt_0_5']}")
    print(f"  subs nuevas tratadas con fallback: {summary['n_subs_nuevas']}")

    fcst_df = pd.DataFrame(fcst_rows)
    sanity = sanity_checks(fcst_df, hist_df=df)
    print(f"  sanity flags: {[k for k, v in sanity.items() if k.startswith('flag_') and v]}")

    by_series.to_csv(V3_OUTPUT / "iter_8_eval.csv", index=False)
    fcst_df.to_csv(V3_OUTPUT / "iter_8_forecast_h7.csv", index=False)

    resumen = {
        "iter": 8,
        "label": "demand_signals_integrated",
        "generado": datetime.now(timezone.utc).isoformat(),
        "duracion_s": (datetime.now(timezone.utc) - t0).total_seconds(),
        "features": [
            "ensemble_stat_models (MA3/Seasonal_Level/Trend/MA3/Naive_YoY)",
            "sales_plan_blend (alpha grid)",
            "campaign_boost (target units distributed)",
            "backorder_signal_m1 (sumado al mes 1)",
            "stock_dep11_info (informativo, no cap)",
            "flag_es_nueva_shimano (ratio Shim/Bar < 2% → fallback seasonal_naive_yoy)",
            "bridge_SI_only (iter opcB)",
        ],
        "nueva_threshold_pct": NUEVA_THRESHOLD_PCT,
        "n_subs": int(fcst_df["unique_id"].nunique()),
        "stock_dep11_total": float(stock_df["stock_dep11"].sum()),
        "backorder_total": float(bo_df["backorder_abierto"].sum()),
        "n_campaigns_cells": len(camp_map),
        "campaigns_target_total": float(sum(camp_map.values())) if camp_map else 0.0,
        "summary": summary,
        "sanity": sanity,
    }
    (V3_OUTPUT / "iter_8_resumen.json").write_text(
        json.dumps(resumen, indent=2, default=str), encoding="utf-8"
    )
    print(f"\n[DONE] forecast guardado. Siguiente: publicar v3c si querés.")


if __name__ == "__main__":
    main()
