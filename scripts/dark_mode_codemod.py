"""Dark Mode codemod - PLAN_DARK_MODE.md E2

Reemplaza colores hex hardcoded por var(--token) semantic-first en:
- index.html (CSS + inline styles)
- src/domains/*.js (inline styles JS-string-embedded)

Property-aware: solo reemplaza en propiedades CSS especificas
(color/background/background-color/border/border-color/border-top/border-bottom/
border-left/border-right/box-shadow-color) donde el token es semanticamente
correcto. NO reemplaza en gradientes, rgba, o propiedades donde el hex es
intencional.

Modo dry-run por default. Usar --apply para aplicar cambios.

Uso:
    python scripts/dark_mode_codemod.py --dry-run           # solo cuenta
    python scripts/dark_mode_codemod.py --apply             # aplica y guarda
    python scripts/dark_mode_codemod.py --apply --file index.html
"""
from __future__ import annotations
import argparse
import re
import sys
from pathlib import Path

# Property-aware replacements. Formato: (property_pattern, hex_pattern, replacement_token)
# El property_pattern matches "color", "background", "border", etc.
# Se ejecutan en orden - especificos primero, generales despues.

# =============================================================================
# TOKEN MAP (basado en PLAN_DARK_MODE.md seccion 2)
# =============================================================================
# Top-40 colores usados en el codebase (from audit v738 2026-08-30):
# - Backgrounds:  #fff, #f8fafc, #f1f5f9, #e5e7eb, #e2e8f0
# - Text:         #0f172a, #1e293b, #334155, #475569, #64748b, #94a3b8
# - Borders:      #cbd5e1, #e5e7eb, #e2e8f0
# - Brand:        #00A9E0
# - Semantic:     #166534, #dc2626, #7c3aed, #f59e0b, #92400e, #d97706, #991b1b
# - Semantic bgs: #dcfce7, #fef3c7, #fee2e2

# Color property replacements: propiedad -> hex -> token
# NOTA: #fff/#ffffff NO se reemplazan (mantener literal blanco para texto
# sobre bg colored solid como .btn-cancel color:#fff bg:#dc2626).
COLOR_REPLACEMENTS = {
    "#0f172a": "var(--text-primary)",
    "#1e293b": "var(--text-primary)",
    "#334155": "var(--text-secondary)",
    "#475569": "var(--text-secondary)",
    "#64748b": "var(--text-muted)",
    "#94a3b8": "var(--text-muted)",
    "#cbd5e1": "var(--text-disabled)",
    "#00A9E0": "var(--brand-shimano-blue)",
    "#00a9e0": "var(--brand-shimano-blue)",
    "#166534": "var(--color-success)",
    "#15803d": "var(--color-success)",
    "#dc2626": "var(--color-danger)",
    "#991b1b": "var(--color-danger-strong)",
    "#7c3aed": "var(--color-accent-violet)",
    "#5b21b6": "var(--color-accent-violet)",
    "#f59e0b": "var(--color-warning)",
    "#d97706": "var(--color-warning)",
    "#92400e": "var(--color-warning)",
}

# Background property replacements
# NOTA: #0f172a/#1e293b/#334155 NO se reemplazan como bg - cuando se usan
# como fondos son casi siempre "dark accent" intencional (badges negros,
# gradient heads, .slft-wl-orden negro) que DEBEN quedar dark tambien en
# light mode. Mapearlos a var(--bg-base) los volveria blanco en light.
BG_REPLACEMENTS = {
    "#fff": "var(--bg-elevated)",
    "#ffffff": "var(--bg-elevated)",
    "#f8fafc": "var(--bg-secondary)",
    "#f1f5f9": "var(--bg-muted)",
    "#e5e7eb": "var(--border-subtle)",
    "#e2e8f0": "var(--border-subtle)",
    "#dcfce7": "var(--color-success-bg)",
    "#fef3c7": "var(--color-warning-bg)",
    "#fee2e2": "var(--color-danger-bg)",
    # semantic solid bgs (buttons) - el token dark tiene variante mas brillante,
    # el text encima (usualmente #fff literal) sigue siendo blanco.
    "#166534": "var(--color-success)",
    "#dc2626": "var(--color-danger)",
    "#7c3aed": "var(--color-accent-violet)",
    "#f59e0b": "var(--color-warning)",
}

# Border property replacements (border-color, border, border-top, etc.)
BORDER_REPLACEMENTS = {
    "#cbd5e1": "var(--border-default)",
    "#e5e7eb": "var(--border-subtle)",
    "#e2e8f0": "var(--border-subtle)",
    "#94a3b8": "var(--border-strong)",
    "#334155": "var(--border-strong)",
    "#00A9E0": "var(--brand-shimano-blue)",
    "#00a9e0": "var(--brand-shimano-blue)",
    "#166534": "var(--color-success)",
    "#dc2626": "var(--color-danger)",
    "#7c3aed": "var(--color-accent-violet)",
}


def build_patterns():
    """Construye regex patterns property-aware. Cada uno matches
    `<property>: <hex>` con optional whitespace y ; opcional al final.
    Devuelve lista de (nombre, regex, template_reemplazo)."""
    patterns = []
    # color: #hex
    for hex_val, token in COLOR_REPLACEMENTS.items():
        # Matches: "color:#0f172a" o "color: #0f172a" - antes de ; o espacio o fin
        regex = re.compile(
            r'(?<![-\w])(color|fill|stroke)(\s*:\s*)'
            + re.escape(hex_val)
            + r'(?=[^0-9a-fA-F]|$)',
            re.IGNORECASE
        )
        patterns.append((f'color:{hex_val}->{token}', regex, r'\1\2' + token))
    # background(-color): #hex
    for hex_val, token in BG_REPLACEMENTS.items():
        regex = re.compile(
            r'(?<![-\w])(background|background-color)(\s*:\s*)'
            + re.escape(hex_val)
            + r'(?=[^0-9a-fA-F]|$)',
            re.IGNORECASE
        )
        patterns.append((f'bg:{hex_val}->{token}', regex, r'\1\2' + token))
    # border-color: #hex y border: <width> <style> #hex
    for hex_val, token in BORDER_REPLACEMENTS.items():
        # border-color: #hex
        regex1 = re.compile(
            r'(?<![-\w])(border-color|border-top-color|border-bottom-color|'
            r'border-left-color|border-right-color)(\s*:\s*)'
            + re.escape(hex_val)
            + r'(?=[^0-9a-fA-F]|$)',
            re.IGNORECASE
        )
        patterns.append((f'border-color:{hex_val}->{token}', regex1, r'\1\2' + token))
        # border: 1px solid #hex (border shorthand). Matches "1px solid #hex" or "1.5px solid #hex" etc.
        # Grupos: (border|border-top|...) (: ) (width) (style) (hex)
        regex2 = re.compile(
            r'(?<![-\w])(border|border-top|border-bottom|border-left|border-right)(\s*:\s*)'
            r'(\d+(?:\.\d+)?px\s+(?:solid|dashed|dotted|double|groove|ridge|inset|outset)\s+)'
            + re.escape(hex_val)
            + r'(?=[^0-9a-fA-F]|$)',
            re.IGNORECASE
        )
        patterns.append((f'border-shorthand:{hex_val}->{token}', regex2, r'\1\2\3' + token))
    return patterns


PATTERNS = build_patterns()


def refactor_content(content: str) -> tuple[str, dict[str, int]]:
    """Devuelve (nuevo_content, {pattern_name: count})."""
    counts = {}
    new_content = content
    for name, regex, replacement in PATTERNS:
        new_content, n = regex.subn(replacement, new_content)
        if n:
            counts[name] = counts.get(name, 0) + n
    return new_content, counts


def process_file(path: Path, apply: bool) -> dict[str, int]:
    src = path.read_text(encoding='utf-8')
    new_src, counts = refactor_content(src)
    if apply and new_src != src:
        path.write_text(new_src, encoding='utf-8', newline='')
    return counts


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--apply', action='store_true', help='Aplica cambios (default: dry-run)')
    p.add_argument('--file', type=str, default=None, help='Solo procesar este archivo (default: index.html + src/domains/*.js)')
    args = p.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    if args.file:
        files = [Path(args.file)]
    else:
        files = [repo_root / 'index.html']
        domains_dir = repo_root / 'src' / 'domains'
        if domains_dir.exists():
            files += sorted(domains_dir.glob('*.js'))

    print(f"Modo: {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"Files: {len(files)}")
    print(f"Patterns: {len(PATTERNS)}")
    print()

    total_by_pattern = {}
    total_by_file = {}
    for f in files:
        if not f.exists():
            print(f"  SKIP (not found): {f}")
            continue
        counts = process_file(f, args.apply)
        file_total = sum(counts.values())
        total_by_file[str(f.relative_to(repo_root))] = file_total
        for name, n in counts.items():
            total_by_pattern[name] = total_by_pattern.get(name, 0) + n
        print(f"  {f.relative_to(repo_root)}: {file_total} replacements")

    print()
    print(f"=== Total: {sum(total_by_file.values())} replacements across {len(total_by_file)} files ===")
    print()
    print("Top 20 patterns:")
    for name, n in sorted(total_by_pattern.items(), key=lambda x: -x[1])[:20]:
        print(f"  {name}: {n}")

    if not args.apply:
        print()
        print("Dry-run - no files modified. Use --apply to write changes.")


if __name__ == '__main__':
    main()
