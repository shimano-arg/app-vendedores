"""Validador por iter. Compara iter_N vs iter_N-1. Flaguea posibles leaks/alucinaciones.

Uso:
    python -m v3.common.validate_iter --iter 1
    python -m v3.common.validate_iter --iter 1 --baseline 0
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output"


def load_resumen(iter_n: int) -> dict:
    p = OUTPUT_DIR / f"iter_{iter_n}_resumen.json"
    if not p.exists():
        raise SystemExit(f"[ERR] no existe {p}. Correr iter_{iter_n} primero.")
    return json.loads(p.read_text(encoding="utf-8"))


def check(current: dict, baseline: dict) -> dict:
    """Lista de checks que validan que iter N no esta alucinando."""
    flags = []
    # 1. WAPE no mejora >50% (sospechoso de leak)
    w_cur = current["summary"]["wape_median"]
    w_base = baseline["summary"]["wape_median"]
    if w_cur < w_base * 0.5:
        flags.append(
            f"[CRITICAL] WAPE mediano cayo {w_base:.3f} -> {w_cur:.3f} ({(1-w_cur/w_base)*100:.0f}%). "
            "Mejora sospechosamente grande. Posible leak train/test."
        )
    # 2. BIAS no cambia de signo radicalmente
    b_cur = current["summary"]["bias_median"]
    b_base = baseline["summary"]["bias_median"]
    if b_cur * b_base < 0 and abs(b_cur) > 0.2:
        flags.append(
            f"[WARN] BIAS cambio de signo: {b_base:.3f} -> {b_cur:.3f}. "
            "Puede indicar cambio semantico de target no deliberado."
        )
    # 3. n_series casi igual
    if current["summary"]["n_series"] != baseline["summary"]["n_series"]:
        flags.append(
            f"[WARN] n_series {baseline['summary']['n_series']} -> {current['summary']['n_series']}. "
            "Serie(s) desaparecieron o aparecieron."
        )
    # 4. sanity flags
    for k, v in current.get("sanity", {}).items():
        if k.startswith("flag_") and v is True:
            flags.append(f"[FLAG] sanity: {k} = True")
    # 5. Mejora minima (si no mejora, propone rollback)
    if w_cur >= w_base - 0.005:
        flags.append(
            f"[INFO] WAPE no mejoro significativamente: {w_base:.3f} -> {w_cur:.3f} (<0.005). "
            "Considerar rollback de la feature si no hay otra ganancia."
        )
    return {
        "wape_baseline": w_base,
        "wape_current": w_cur,
        "wape_delta": w_cur - w_base,
        "wape_pct_change": (w_cur - w_base) / w_base * 100 if w_base else 0,
        "flags": flags,
        "verdict": "PASS" if not any("CRITICAL" in f or "WARN" in f for f in flags) else "FAIL",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iter", type=int, required=True, help="Iter actual a validar")
    ap.add_argument("--baseline", type=int, default=None, help="Iter baseline para comparar (default iter-1)")
    args = ap.parse_args()
    baseline_n = args.baseline if args.baseline is not None else args.iter - 1
    if baseline_n < 0:
        print("[INFO] no hay baseline (iter 0 es el baseline). Solo sanity.")
        cur = load_resumen(args.iter)
        print(json.dumps({"sanity": cur.get("sanity", {}), "summary": cur["summary"]}, indent=2))
        return
    current = load_resumen(args.iter)
    baseline = load_resumen(baseline_n)
    report = check(current, baseline)
    print(f"=== VALIDATE iter_{args.iter} vs iter_{baseline_n} ===")
    print(f"WAPE: {report['wape_baseline']:.4f} -> {report['wape_current']:.4f} "
          f"(delta {report['wape_delta']:+.4f}, {report['wape_pct_change']:+.1f}%)")
    print(f"VERDICT: {report['verdict']}")
    if report["flags"]:
        print("FLAGS:")
        for f in report["flags"]:
            print(f"  {f}")
    (OUTPUT_DIR / f"validate_iter_{args.iter}.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
