"""Opcion B - Etapa 2: bridge map Shimano -> Baraldo subfamilia nombre.

Resuelve el "gap" diagnosticado en etapa 1 que resulto ser naming, no mapping real.

Produce: bridge_shimano_to_baraldo = dict con 5 renames:
    APPAREL -> INDUMENTARIA
    ACCESORIES -> HERRAMIENTAS
    MONOLINE -> MONOFILAMENTO
    SW TRAVEL -> SW SPINNING
    FW TRAVEL -> FW SPINNING

MARKETING y G LOOMIS no tienen match (volumen residual, se dejan sin historia).

Output: usable como from opt_b_02_bridge_map import BRIDGE_SHIM_TO_BAR
"""

BRIDGE_SHIM_TO_BAR = {
    "APPAREL": "INDUMENTARIA",
    "ACCESORIES": "HERRAMIENTAS",
    "MONOLINE": "MONOFILAMENTO",
    "SW TRAVEL": "SW SPINNING",
    "FW TRAVEL": "FW SPINNING",
    # MARKETING y G LOOMIS sin match, quedan como estan (7m solamente)
}


def apply_bridge_to_shimano(shim_df, verbose=True):
    """Renombra las subs Shimano para que matcheen Baraldo historico.

    shim_df: DataFrame con columna subfamilia_norm.
    returns: nuevo DataFrame con nombres unificados.
    """
    out = shim_df.copy()
    if "subfamilia_norm" not in out.columns:
        return out
    before_subs = set(out["subfamilia_norm"].unique())
    out["subfamilia_norm"] = out["subfamilia_norm"].replace(BRIDGE_SHIM_TO_BAR)
    after_subs = set(out["subfamilia_norm"].unique())
    if verbose:
        renamed = before_subs - after_subs
        new = after_subs - before_subs
        print(f"  [bridge] renamed {len(renamed)} subs Shimano para match Baraldo")
        for r in sorted(renamed):
            print(f"    {r} -> {BRIDGE_SHIM_TO_BAR.get(r)}")
    return out


if __name__ == "__main__":
    print("Bridge map Shimano -> Baraldo:")
    for s, b in BRIDGE_SHIM_TO_BAR.items():
        print(f"  {s:20} -> {b}")
