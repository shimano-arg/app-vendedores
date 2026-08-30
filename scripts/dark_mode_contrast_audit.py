"""Dark Mode WCAG AA contrast audit - PLAN_DARK_MODE.md E4

Chequea que las combinaciones de CSS vars del sistema de temas cumplan
WCAG 2.1 AA:
- Texto normal (< 18pt): 4.5:1 minimum
- Texto grande (>= 18pt o >= 14pt bold): 3:1 minimum
- UI components (borders, focus outlines): 3:1 minimum

Formula: (L1 + 0.05) / (L2 + 0.05) donde L es relative luminance.

Reporta cada par (bg, text) con su ratio y PASS/FAIL para AA.

Uso:
    python scripts/dark_mode_contrast_audit.py
    python scripts/dark_mode_contrast_audit.py --json  # output JSON
"""
from __future__ import annotations
import argparse
import json
import sys


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    """#RRGGBB -> (r, g, b) 0-255."""
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    """WCAG 2.1 relative luminance."""

    def channel(c: int) -> float:
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(hex1: str, hex2: str) -> float:
    """WCAG contrast ratio entre dos hex colors."""
    l1 = relative_luminance(hex_to_rgb(hex1))
    l2 = relative_luminance(hex_to_rgb(hex2))
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


# Definidos en index.html :root y [data-theme="dark"] (v738+)
LIGHT_TOKENS = {
    "bg-base": "#ffffff",
    "bg-secondary": "#f8fafc",
    "bg-elevated": "#ffffff",
    "bg-input": "#ffffff",
    "bg-muted": "#f1f5f9",
    "text-primary": "#0f172a",
    "text-secondary": "#475569",
    "text-muted": "#64748b",
    "text-disabled": "#94a3b8",
    "text-inverse": "#ffffff",
    "border-default": "#cbd5e1",
    "border-subtle": "#e5e7eb",
    "border-strong": "#94a3b8",
    "brand-shimano-blue": "#00A9E0",
    "color-success": "#166534",
    "color-success-bg": "#dcfce7",
    "color-warning": "#d97706",
    "color-warning-bg": "#fef3c7",
    "color-danger": "#dc2626",
    "color-danger-bg": "#fee2e2",
    "color-danger-strong": "#991b1b",
    "color-accent-violet": "#7c3aed",
    "focus-ring": "#00A9E0",
}

DARK_TOKENS = {
    # v745 E4 WCAG: ajustes para compliance AA - ver comments en index.html [data-theme="dark"] block.
    "bg-base": "#0f172a",
    "bg-secondary": "#1e293b",
    "bg-elevated": "#334155",
    "bg-input": "#1e293b",
    "bg-muted": "#334155",
    "text-primary": "#f1f5f9",
    "text-secondary": "#cbd5e1",
    "text-muted": "#cbd5e1",             # v745: era #94a3b8
    "text-disabled": "#64748b",
    "text-inverse": "#0f172a",
    "border-default": "#475569",         # v745: era #334155 (igual a bg-elevated)
    "border-subtle": "#1e293b",
    "border-strong": "#64748b",          # v745: era #475569
    "brand-shimano-blue": "#00A9E0",
    "color-success": "#4ade80",          # v745: era #22c55e
    "color-success-bg": "#14532d",
    "color-warning": "#fbbf24",
    "color-warning-bg": "#78350f",
    "color-danger": "#fca5a5",           # v745: era #f87171
    "color-danger-bg": "#7f1d1d",
    "color-danger-strong": "#fca5a5",    # v745: era #dc2626
    "color-accent-violet": "#a78bfa",
    "focus-ring": "#38bdf8",
}

# Pares (bg, text) a auditar. type='text' = 4.5:1 min (normal text WCAG AA).
# type='ui' = 3:1 min (UI components / borders / large text).
PAIRS_TO_AUDIT = [
    # Body / page general
    ("bg-base", "text-primary", "text", "Body text on page bg"),
    ("bg-base", "text-secondary", "text", "Secondary text on page bg"),
    ("bg-base", "text-muted", "text", "Muted text on page bg"),
    ("bg-base", "text-disabled", "ui", "Disabled text on page bg (UI level)"),
    # Cards / panels
    ("bg-secondary", "text-primary", "text", "Primary text on secondary bg"),
    ("bg-secondary", "text-secondary", "text", "Secondary text on secondary bg"),
    ("bg-secondary", "text-muted", "text", "Muted text on secondary bg"),
    # Elevated (modals, cards)
    ("bg-elevated", "text-primary", "text", "Primary text on elevated bg"),
    ("bg-elevated", "text-secondary", "text", "Secondary text on elevated bg"),
    ("bg-elevated", "text-muted", "text", "Muted text on elevated bg"),
    # Muted (chips, tags)
    ("bg-muted", "text-primary", "text", "Primary text on muted bg"),
    ("bg-muted", "text-secondary", "text", "Secondary text on muted bg"),
    # Semantic backgrounds
    ("color-success-bg", "color-success", "text", "Success text on success bg"),
    ("color-warning-bg", "color-warning", "text", "Warning text on warning bg"),
    ("color-danger-bg", "color-danger", "text", "Danger text on danger bg"),
    ("color-danger-bg", "color-danger-strong", "text", "Danger-strong on danger-bg"),
    # Solid buttons (usually with white text)
    ("color-success", "text-inverse", "text", "Inverse text on success button (bg dark)"),
    ("color-warning", "text-inverse", "text", "Inverse text on warning button"),
    ("color-danger", "text-inverse", "text", "Inverse text on danger button"),
    ("color-accent-violet", "text-inverse", "text", "Inverse text on violet button"),
    ("brand-shimano-blue", "text-inverse", "text", "Inverse text on brand-blue button"),
    # Borders (UI level 3:1)
    ("bg-base", "border-default", "ui", "Border default vs bg-base"),
    ("bg-elevated", "border-default", "ui", "Border default vs bg-elevated"),
    ("bg-base", "border-strong", "ui", "Border strong vs bg-base"),
    # Focus ring (must be visible on any bg)
    ("bg-base", "focus-ring", "ui", "Focus ring on bg-base"),
    ("bg-elevated", "focus-ring", "ui", "Focus ring on bg-elevated"),
]


def audit_theme(tokens: dict[str, str], theme_name: str) -> tuple[list[dict], int, int]:
    """Auditea todos los pares para un tema. Devuelve (results, pass_count, fail_count)."""
    results = []
    pass_count = 0
    fail_count = 0
    for bg_key, text_key, kind, desc in PAIRS_TO_AUDIT:
        bg = tokens[bg_key]
        text = tokens[text_key]
        ratio = contrast_ratio(bg, text)
        threshold = 4.5 if kind == "text" else 3.0
        passes = ratio >= threshold
        results.append(
            {
                "bg_key": bg_key,
                "bg_hex": bg,
                "text_key": text_key,
                "text_hex": text,
                "kind": kind,
                "description": desc,
                "ratio": round(ratio, 2),
                "threshold": threshold,
                "passes_aa": passes,
                "theme": theme_name,
            }
        )
        if passes:
            pass_count += 1
        else:
            fail_count += 1
    return results, pass_count, fail_count


def print_report(results: list[dict], theme_name: str) -> None:
    print(f"\n=== {theme_name.upper()} theme WCAG AA audit ===")
    print(
        f"{'STATUS':<7} {'RATIO':<7} {'THRESH':<7} {'PAIR':<50} {'HEX':<26} {'DESC'}"
    )
    print("-" * 130)
    for r in results:
        status = "PASS" if r["passes_aa"] else "FAIL"
        pair = f"{r['bg_key']} / {r['text_key']}"
        hex_pair = f"{r['bg_hex']} / {r['text_hex']}"
        print(
            f"{status:<7} {r['ratio']:<7} {r['threshold']:<7} {pair:<50} {hex_pair:<26} {r['description']}"
        )


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--json", action="store_true", help="Output as JSON")
    args = p.parse_args()

    light_results, light_pass, light_fail = audit_theme(LIGHT_TOKENS, "light")
    dark_results, dark_pass, dark_fail = audit_theme(DARK_TOKENS, "dark")

    if args.json:
        output = {
            "light": {"pass": light_pass, "fail": light_fail, "results": light_results},
            "dark": {"pass": dark_pass, "fail": dark_fail, "results": dark_results},
        }
        print(json.dumps(output, indent=2))
    else:
        print_report(light_results, "light")
        print_report(dark_results, "dark")
        print()
        print(
            f"=== SUMMARY: light PASS={light_pass}/{light_pass + light_fail}, "
            f"dark PASS={dark_pass}/{dark_pass + dark_fail} ==="
        )
        total_fail = light_fail + dark_fail
        if total_fail > 0:
            print(f"\n{total_fail} FAILURE(S). Review the FAIL entries above.")
        else:
            print("\nAll pairs PASS WCAG AA. Nice.")

    return 0 if (light_fail + dark_fail) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
