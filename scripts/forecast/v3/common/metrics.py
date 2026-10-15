"""Metricas compartidas para v3 iteraciones. Comparables entre iters.

Reglas:
- WAPE es la metrica PRIMARIA. Un numero por iter.
- Secundarias: MAE, RMSE, BIAS, MAPE, coverage IC 80%, cuenta de series por bucket WAPE.
- Nunca cambiar la definicion entre iters.
- Backtest: rolling-origin h=2, w=3 (6 meses test, 7m train minimo).
"""
from __future__ import annotations
import numpy as np
import pandas as pd


def wape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    return float(np.sum(np.abs(y_true - y_pred)) / max(np.sum(np.abs(y_true)), 1e-9))


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(np.asarray(y_true, dtype=float) - np.asarray(y_pred, dtype=float))))


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    e = np.asarray(y_true, dtype=float) - np.asarray(y_pred, dtype=float)
    return float(np.sqrt(np.mean(e * e)))


def bias(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Positivo = sobre-predice. Normalizado por suma real."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    return float(np.sum(y_pred - y_true) / max(np.sum(y_true), 1e-9))


def mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = np.abs(y_true) > 1e-9
    if not mask.any():
        return float("nan")
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])))


def coverage_ic80(y_true: np.ndarray, y_lo: np.ndarray, y_hi: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_lo = np.asarray(y_lo, dtype=float)
    y_hi = np.asarray(y_hi, dtype=float)
    inside = (y_true >= y_lo) & (y_true <= y_hi)
    return float(inside.mean())


def wape_by_series(backtest_df: pd.DataFrame, series_col: str = "unique_id") -> pd.DataFrame:
    """Devuelve WAPE por serie (subfamilia o SKU). Columnas esperadas: unique_id, y, y_hat."""
    def _f(g):
        return pd.Series({
            "wape": wape(g["y"].values, g["y_hat"].values),
            "mae": mae(g["y"].values, g["y_hat"].values),
            "bias": bias(g["y"].values, g["y_hat"].values),
            "n_obs": len(g),
        })
    return backtest_df.groupby(series_col).apply(_f).reset_index()


def summary_metrics(by_series: pd.DataFrame) -> dict:
    """Resumen agregado. Usar WAPE mediano como metrica primaria."""
    wape_vals = by_series["wape"].values
    return {
        "wape_median": float(np.median(wape_vals)),
        "wape_mean": float(np.mean(wape_vals)),
        "wape_p25": float(np.percentile(wape_vals, 25)),
        "wape_p75": float(np.percentile(wape_vals, 75)),
        "wape_std": float(np.std(wape_vals)),
        "n_series": int(len(by_series)),
        "n_series_wape_lt_0_3": int((wape_vals < 0.3).sum()),
        "n_series_wape_lt_0_5": int((wape_vals < 0.5).sum()),
        "n_series_wape_lt_0_7": int((wape_vals < 0.7).sum()),
        "n_series_wape_lt_1_0": int((wape_vals < 1.0).sum()),
        "mae_median": float(np.median(by_series["mae"].values)),
        "bias_median": float(np.median(by_series["bias"].values)),
    }


# Sanity checks (anti-alucinacion)
def sanity_checks(forecast_df: pd.DataFrame, hist_df: pd.DataFrame | None = None) -> dict:
    """Devuelve dict con flags. True = alerta.
    Expects forecast_df con columnas unique_id, ds, y_hat.
    """
    issues = {}
    if forecast_df.empty:
        issues["empty_forecast"] = True
        return issues
    # 1. No puede ser todo cero
    pct_zero = (forecast_df["y_hat"] == 0).mean()
    issues["pct_zero_predictions"] = float(pct_zero)
    issues["flag_too_many_zeros"] = bool(pct_zero > 0.5)
    # 2. No puede ser todo negativo
    pct_neg = (forecast_df["y_hat"] < 0).mean()
    issues["pct_negative_predictions"] = float(pct_neg)
    issues["flag_negatives"] = bool(pct_neg > 0.01)
    # 3. No puede ser constante por serie (colapso naive)
    constants = (
        forecast_df.groupby("unique_id")["y_hat"]
        .apply(lambda s: float(s.nunique() == 1))
        .mean()
    )
    issues["pct_series_constant"] = float(constants)
    issues["flag_too_many_constant"] = bool(constants > 0.3)
    # 4. No puede ser 100x el max historico
    if hist_df is not None and not hist_df.empty:
        max_hist = hist_df.groupby("unique_id")["y"].max()
        max_fcst = forecast_df.groupby("unique_id")["y_hat"].max()
        joined = pd.concat([max_hist.rename("hist"), max_fcst.rename("fcst")], axis=1).dropna()
        if not joined.empty:
            joined["ratio"] = joined["fcst"] / joined["hist"].replace(0, np.nan)
            over_10x = (joined["ratio"] > 10).mean()
            issues["pct_series_over_10x_max_hist"] = float(over_10x)
            issues["flag_overshoot"] = bool(over_10x > 0.1)
    return issues
