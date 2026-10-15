"""Opcion B - Etapa 1: diagnostico del mapping Baraldo <-> Shimano.

Objetivo: identificar las subfamilias Shimano actual que NO tienen match
en Baraldo (y vice versa), para extender la serie a 10 años por subfamilia.

Outputs:
- opt_b_subs_shimano_sin_baraldo.csv: subs Shimano que no tienen historia
  Baraldo mapeada (son las que quedan con solo 7m de data).
- opt_b_cats_baraldo_sin_mapping.csv: categorias Baraldo huerfanas (no en el map)
- opt_b_volumen_baraldo_por_cat.csv: cuanto volumen tiene cada cat Baraldo
  (para priorizar cuales merece la pena mapear).
- opt_b_matrix_shimano_baraldo.md: tabla visual de intersecciones.
"""
from __future__ import annotations

import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
V2_DIR = SCRIPT_DIR.parent
V3_OUTPUT = SCRIPT_DIR / "output"
V3_OUTPUT.mkdir(exist_ok=True)

sys.path.insert(0, str(V2_DIR))

warnings.filterwarnings("ignore")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from train_baseline import BARALDO_TO_SUBFAMILIA  # type: ignore
from train_final import (  # type: ignore
    build_shimano_by_subfamilia,
    fetch_shimano_ventas_raw,
    init_bq,
    load_articulos_catalog,
    load_baraldo_subfamilia_smooth,
    BARALDO_CSV,
)


def main():
    print("=" * 72)
    print("OPCION B - ETAPA 1: Diagnostico mapping Baraldo <-> Shimano")
    print("=" * 72)

    # 1. Subs Shimano actuales (del catálogo Articulos.xlsx)
    print("\n[1/5] Subs Shimano desde Articulos.xlsx + ventas BQ...")
    cat = load_articulos_catalog()
    subs_shim_cat = sorted(cat["subfamilia_norm"].dropna().unique().tolist())
    print(f"  subs Shimano cat: {len(subs_shim_cat)}")

    bq = init_bq()
    shim_raw = fetch_shimano_ventas_raw(bq)
    shim_agg = build_shimano_by_subfamilia(shim_raw, cat)
    subs_shim_ventas = sorted(shim_agg["subfamilia_norm"].unique().tolist())
    # Volumen por sub Shimano (venta últimos 7m)
    vol_shim = shim_agg.groupby("subfamilia_norm")["y"].sum().sort_values(ascending=False)
    print(f"  subs Shimano con ventas 2025-09+: {len(subs_shim_ventas)}")

    # 2. Subs Baraldo mapeadas
    print("\n[2/5] Subs Baraldo mapeadas...")
    bar = load_baraldo_subfamilia_smooth()
    subs_bar_mapeadas = sorted(bar["subfamilia_norm"].dropna().unique().tolist())
    vol_bar = bar.groupby("subfamilia_norm")["y"].sum().sort_values(ascending=False)
    print(f"  subs Baraldo mapeadas: {len(subs_bar_mapeadas)}")

    # 3. Cargar Baraldo crudo para ver categorias sin mapping
    print("\n[3/5] Categorias Baraldo crudas (CatItemKey_Norm_Fixed)...")
    bar_raw = pd.read_csv(BARALDO_CSV)
    bar_raw["qty"] = pd.to_numeric(bar_raw.get("Sales Units", 0), errors="coerce").fillna(0.0)
    bar_raw["cat_key"] = bar_raw["CatItemKey_Norm_Fixed"].astype(str).str.strip().str.upper()
    cats_bar = bar_raw["cat_key"].unique().tolist()
    print(f"  categorias Baraldo distintas: {len(cats_bar)}")
    mapeadas = set(BARALDO_TO_SUBFAMILIA.keys())
    unmapped_cats = sorted([c for c in cats_bar if c not in mapeadas])
    print(f"  categorias Baraldo SIN mapping actual: {len(unmapped_cats)}")

    # Volumen por categoria Baraldo (incluye las sin mapping)
    vol_cats_bar = bar_raw.groupby("cat_key")["qty"].sum().sort_values(ascending=False)
    vol_cats_bar.to_csv(V3_OUTPUT / "opt_b_volumen_baraldo_por_cat.csv", header=["qty_total"])
    print(f"  guardado: opt_b_volumen_baraldo_por_cat.csv")

    # 4. Subs Shimano SIN correspondencia Baraldo (gap)
    print("\n[4/5] Subs Shimano SIN correspondencia Baraldo (gap)...")
    subs_shim_set = set(subs_shim_ventas)
    subs_bar_set = set(subs_bar_mapeadas)
    gap_shim = sorted(subs_shim_set - subs_bar_set)
    overlap = sorted(subs_shim_set & subs_bar_set)
    gap_bar = sorted(subs_bar_set - subs_shim_set)
    print(f"  intersección (ya con historia extendida): {len(overlap)}")
    print(f"  subs Shimano SIN Baraldo (solo 7m, prioridad opcB): {len(gap_shim)}")
    print(f"  subs Baraldo SIN Shimano actual (discontinuadas o renombradas): {len(gap_bar)}")

    # Volumen de cada gap sub Shimano (cuanto nos duele el gap)
    gap_rows = []
    for s in gap_shim:
        gap_rows.append({
            "subfamilia_norm": s,
            "volumen_shim_7m": float(vol_shim.get(s, 0.0)),
        })
    gap_df = pd.DataFrame(gap_rows).sort_values("volumen_shim_7m", ascending=False)
    gap_df.to_csv(V3_OUTPUT / "opt_b_subs_shimano_sin_baraldo.csv", index=False)

    unm_rows = []
    for c in unmapped_cats:
        unm_rows.append({
            "cat_baraldo": c,
            "volumen_baraldo_total": float(vol_cats_bar.get(c, 0.0)),
        })
    if unm_rows:
        unm_df = pd.DataFrame(unm_rows).sort_values("volumen_baraldo_total", ascending=False)
    else:
        unm_df = pd.DataFrame(columns=["cat_baraldo", "volumen_baraldo_total"])
    unm_df.to_csv(V3_OUTPUT / "opt_b_cats_baraldo_sin_mapping.csv", index=False)

    # 5. Matriz visual (markdown)
    md = ["# Diagnostico mapping Baraldo <-> Shimano\n"]
    md.append(f"**Fecha**: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}\n")
    md.append(f"- Subs Shimano con ventas 2025-09+: **{len(subs_shim_ventas)}**")
    md.append(f"- Subs Baraldo actualmente mapeadas: **{len(subs_bar_mapeadas)}**")
    md.append(f"- Interseccion (ya extendida): **{len(overlap)}**")
    md.append(f"- Subs Shimano SIN Baraldo (**TRABAJO**): **{len(gap_shim)}**")
    md.append(f"- Cats Baraldo SIN mapping (fuente potencial): **{len(unmapped_cats)}**\n")

    md.append("## Subs Shimano SIN historia Baraldo (ordenadas por volumen 2025-09+)\n")
    md.append("| Subfamilia | Volumen 7m | Prioridad |")
    md.append("|---|---|---|")
    tot_gap = float(gap_df["volumen_shim_7m"].sum())
    cum = 0.0
    for r in gap_df.itertuples():
        cum += r.volumen_shim_7m
        prio = "ALTA" if r.volumen_shim_7m > tot_gap * 0.1 else ("MEDIA" if r.volumen_shim_7m > tot_gap * 0.03 else "BAJA")
        md.append(f"| {r.subfamilia_norm} | {int(r.volumen_shim_7m):,} | {prio} |")
    md.append("")

    md.append("## Categorias Baraldo huerfanas (potenciales fuentes)\n")
    md.append("Top 20 por volumen historico:\n")
    md.append("| Cat Baraldo | Volumen total hist | % del total Baraldo |")
    md.append("|---|---|---|")
    tot_bar = float(vol_cats_bar.sum())
    for r in unm_df.head(20).itertuples():
        pct = 100 * r.volumen_baraldo_total / max(tot_bar, 1e-9)
        md.append(f"| {r.cat_baraldo} | {int(r.volumen_baraldo_total):,} | {pct:.1f}% |")
    md.append("")

    md.append("## Interseccion (subs que ya tienen historia extendida)\n")
    for s in overlap:
        md.append(f"- {s}")
    md.append("")

    (V3_OUTPUT / "opt_b_matrix_shimano_baraldo.md").write_text("\n".join(md), encoding="utf-8")

    print("\n[5/5] Outputs generados en output/:")
    print("  - opt_b_subs_shimano_sin_baraldo.csv  (gap, prioridad)")
    print("  - opt_b_cats_baraldo_sin_mapping.csv  (fuentes potenciales)")
    print("  - opt_b_volumen_baraldo_por_cat.csv   (todas las cats + volumen)")
    print("  - opt_b_matrix_shimano_baraldo.md     (reporte visual)")
    print(f"\n  Resumen rapido:")
    print(f"    {len(overlap)}/{len(subs_shim_ventas)} subs Shimano ya tienen historia Baraldo")
    print(f"    {len(gap_shim)}/{len(subs_shim_ventas)} subs necesitan trabajo de mapping")
    print(f"    {len(unmapped_cats)} categorias Baraldo huerfanas (fuentes potenciales)")


if __name__ == "__main__":
    main()
