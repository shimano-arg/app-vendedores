# -*- coding: utf-8 -*-
"""Backfill de atributos tecnicos para cañas, reels y lineas → items_attrs/{sku}.

CAÑAS (familia_motor='canas'):
- tipo (Casting/Spinning/Baitcasting/Surfcasting/Jigging/Multipurpose)
- tramos (int o 'variable')
- libraje_min, libraje_max (lb) — fallback desde potencia
- largo_cm (convierte 2.1m o 7'0" → cm) + largo_ft (display amigable)
- accion, potencia

REELS (familia_motor='reels', v1347):
- tipo (Spinning/Baitcasting/Conventional)
- tamano (1000, 2500, 4000, 14000, etc) — regex desc "Tamaño XXXX" + fallback SKU
- velocidad (regular/HG/XG/PG) — sufijo del SKU

LINEAS (familia_motor='lineas', v1347):
- marca (PowerPro/Kairiki)
- hebras (4 o 8) — mapeo del sub
- libraje (lb)
- largo_m (metros, para Kairiki) + largo_yd (yardas, PowerPro)

Idempotente, con --dry-run para preview sin escribir.
Gate: ≥95% items con los 3 HARD completos por familia.

Uso:
  python scripts/backfill_product_attrs.py --dry-run
  python scripts/backfill_product_attrs.py
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.stdout.reconfigure(encoding='utf-8')

# -----------------------------------------------------------------------------
# 1. Extraer PRODUCTS del index.html
# -----------------------------------------------------------------------------
def load_products() -> list[dict]:
    html = (REPO_ROOT / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'const PRODUCTS\s*=\s*(\[.*?\]);', html, re.DOTALL)
    if not m:
        raise SystemExit('[FATAL] No encontre const PRODUCTS en index.html')
    return json.loads(m.group(1))


# -----------------------------------------------------------------------------
# 2. Identificar cañas
# -----------------------------------------------------------------------------
FAM_CANA_KEYWORDS = (
    'casting', 'spinning', 'baitcasting', 'surfcasting', 'jigging',
    'multi purpose', 'shoresurf', 'telescopic', 'inshore', 'boat',
    'travel', 'slow jigging', 'salt water',
)

EXCLUDED_CATS = {'REEL', 'LINEAS', 'FG', 'COMBO', 'LINEA'}

def is_cana(p: dict) -> bool:
    cat = (p.get('cat') or '').upper()
    fam = (p.get('fam') or '').lower()
    desc = (p.get('desc') or '').lower()
    # Explicit include: cat says caña
    if 'CAÑA' in cat or cat == 'CAÑAS':
        return True
    # Explicit exclude: cat is clearly not caña
    if cat in EXCLUDED_CATS:
        return False
    # Para cat vacio u otro, confio en fam Y en que la desc diga "caña"
    if any(kw in fam for kw in FAM_CANA_KEYWORDS):
        return 'caña' in desc or 'cana' in desc
    return False


# -----------------------------------------------------------------------------
# 3. Parsing de atributos
# -----------------------------------------------------------------------------

# Tipo desde fam (ya estructurado)
def infer_tipo(p: dict) -> str | None:
    fam = (p.get('fam') or '').lower()
    desc = (p.get('desc') or '').lower()
    text = fam + ' ' + desc
    # Orden de prioridad: baitcasting antes de casting (contiene "casting")
    if 'baitcasting' in text:
        return 'Baitcasting'
    if 'surfcasting' in text or 'shoresurf' in text or 'surf' in fam:
        return 'Surfcasting'
    if 'jigging' in text:
        return 'Jigging'
    if 'casting' in text:
        return 'Casting'
    if 'spinning' in text:
        return 'Spinning'
    if 'multi purpose' in text or 'multiprop' in text or 'feeder' in text:
        return 'Multipurpose'
    if 'inshore' in text or 'boat' in text or 'travel' in text or 'telescopic' in text:
        # Si fam dice algo generico, intento ver tipo en desc
        if 'spinning' in desc:
            return 'Spinning'
        if 'casting' in desc:
            return 'Casting'
        return 'Multipurpose'
    return None


# Tramos
RE_TRAMOS = re.compile(r'(\d+)\s*tramos?', re.IGNORECASE)
RE_PARTES = re.compile(r'(\d+)\s*partes?', re.IGNORECASE)
RE_TIPS = re.compile(r'(\d+)\s*tips?', re.IGNORECASE)
RE_GRIP_JOINT = re.compile(r'1\s*\+\s*1\s*\(grip joint\)', re.IGNORECASE)

def infer_tramos(desc: str, fam: str = '') -> int | str | None:
    low = desc.lower()
    if RE_GRIP_JOINT.search(desc):
        return 2  # 1+1 = 2 tramos efectivos
    m = RE_TRAMOS.search(desc)
    if m:
        return int(m.group(1))
    m = RE_PARTES.search(desc)
    if m:
        return int(m.group(1))
    m = RE_TIPS.search(desc)
    if m:
        return 2
    # Heuristicas por palabra
    if 'blank sólido' in low or 'blank solido' in low:
        return 1
    if 'rotativo' in low:
        return 3
    if 'telescop' in low or 'tele' in (fam or '').lower():
        return 'variable'  # telescopicas: tramos variables
    # Default para surfcasting sin tramos explicito: tipicamente 3
    if 'surf' in (fam or '').lower() or 'surfcast' in low:
        return 3
    return None


# Libraje
# "12-25 lb", "10-20 lb", "25 lb" (single), "12-25" (sin lb explicito despues de potencia)
RE_LIBRAJE_RANGO = re.compile(r'(\d+)\s*[-–]\s*(\d+)\s*lb', re.IGNORECASE)
RE_LIBRAJE_SINGLE = re.compile(r'\b(\d+)\s*lb\b', re.IGNORECASE)
RE_LIBRAJE_SIN_LB = re.compile(
    r'potencia\s+\w+(?:\s+\w+)?\s*\(?\w*\)?\s*(\d+)\s*[-–]\s*(\d+)\b(?!\s*gr)',
    re.IGNORECASE
)

# Inferencia desde potencia (fallback)
POTENCIA_LIBRAJE = {
    'UL': (0, 5),
    'L': (4, 8),
    'ML': (6, 14),
    'M': (8, 17),
    'MH': (10, 20),
    'H': (14, 30),
    'XH': (20, 40),
}

# Peso de plomada (gramos) → libraje equivalente aproximado (Surfcasting/Feeder)
RE_PLOMADA_RANGO = re.compile(r'(\d+)\s*[-–]\s*(\d+)\s*gr?\b', re.IGNORECASE)
RE_PLOMADA_MAX = re.compile(r'plomada\s+m[aá]x\.?\s*(\d+)\s*g', re.IGNORECASE)
RE_PLOMADA_SINGLE = re.compile(r'(?:plomada|peso\s+de\s+lance)\s+(\d+)\s*g', re.IGNORECASE)

def plomada_g_a_lb(min_g: int, max_g: int) -> tuple[int, int]:
    """Conversion aproximada peso plomada → libraje lb (regla ~1 lb por 5g)."""
    return max(1, min_g // 5), max(5, max_g // 5)

def infer_libraje(desc: str, potencia: str | None, fam: str = '') -> tuple[int, int, bool] | None:
    """Returns (min, max, inferido_desde_potencia_o_plomada) o None."""
    m = RE_LIBRAJE_RANGO.search(desc)
    if m:
        return int(m.group(1)), int(m.group(2)), False
    m = RE_LIBRAJE_SIN_LB.search(desc)
    if m:
        return int(m.group(1)), int(m.group(2)), False
    m = RE_LIBRAJE_SINGLE.search(desc)
    if m:
        n = int(m.group(1))
        # Single value = bucket angosto +/-5 lb (no 0-N que seria demasiado amplio)
        return max(1, n - 5), n + 5, False
    # Plomada en gramos (Surfcasting/Feeder)
    is_surf_fam = any(kw in (fam or '').lower() for kw in ('surf', 'feeder', 'boat'))
    is_surf_desc = 'surf' in desc.lower() or 'feeder' in desc.lower() or 'plomada' in desc.lower() or 'peso de lance' in desc.lower()
    if is_surf_fam or is_surf_desc:
        m = RE_PLOMADA_RANGO.search(desc)
        if m:
            lo_g, hi_g = int(m.group(1)), int(m.group(2))
            lo_lb, hi_lb = plomada_g_a_lb(lo_g, hi_g)
            return lo_lb, hi_lb, True
        m = RE_PLOMADA_MAX.search(desc)
        if m:
            max_g = int(m.group(1))
            lo_lb, hi_lb = plomada_g_a_lb(max_g // 2, max_g)
            return lo_lb, hi_lb, True
        m = RE_PLOMADA_SINGLE.search(desc)
        if m:
            g = int(m.group(1))
            lo_lb, hi_lb = plomada_g_a_lb(g, g + 20)
            return lo_lb, hi_lb, True
    # Fallback: desde potencia
    if potencia and potencia in POTENCIA_LIBRAJE:
        lo, hi = POTENCIA_LIBRAJE[potencia]
        return lo, hi, True
    return None


# Potencia
RE_POTENCIA_FULL = re.compile(
    r'potencia\s+(ultra\s*light|extra\s*heavy|medium\s*heavy|medium\s*light|heavy|medium|light)',
    re.IGNORECASE
)
RE_POTENCIA_ABBR = re.compile(r'\((UL|L|ML|M|MH|H|XH)\)')

POTENCIA_NORM = {
    'ultra light': 'UL',
    'ultralight': 'UL',
    'extra heavy': 'XH',
    'extraheavy': 'XH',
    'medium heavy': 'MH',
    'mediumheavy': 'MH',
    'medium light': 'ML',
    'mediumlight': 'ML',
    'heavy': 'H',
    'medium': 'M',
    'light': 'L',
}

def infer_potencia(desc: str) -> str | None:
    m = RE_POTENCIA_ABBR.search(desc)
    if m:
        return m.group(1)
    m = RE_POTENCIA_FULL.search(desc)
    if m:
        raw = m.group(1).lower().strip()
        raw = re.sub(r'\s+', ' ', raw)
        return POTENCIA_NORM.get(raw)
    return None


# Largo cm
RE_LARGO_METRICO = re.compile(r'(\d+(?:[.,]\d+)?)\s*m\b', re.IGNORECASE)
RE_LARGO_IMPERIAL = re.compile(r"(\d+)\s*[´'`]\s*(\d+)[´\"'`]?", re.IGNORECASE)

def infer_largo_cm(desc: str) -> int | None:
    m = RE_LARGO_IMPERIAL.search(desc)
    if m:
        ft = int(m.group(1))
        inches = int(m.group(2))
        return round(ft * 30.48 + inches * 2.54)
    m = RE_LARGO_METRICO.search(desc)
    if m:
        meters = float(m.group(1).replace(',', '.'))
        if 0.5 < meters < 6.0:  # sanity: cañas razonables
            return round(meters * 100)
    return None


# Accion
RE_ACCION = re.compile(
    r'acci[oó]n\s+(extra\s+r[aá]pida|moderada\s+r[aá]pida|r[aá]pida|moderada|lenta)',
    re.IGNORECASE
)
RE_FAST = re.compile(r'\b(fast|extra fast)\b', re.IGNORECASE)
RE_RAPIDA_SUELTA = re.compile(r'-\s*(?:extra\s+)?r[aá]pida\s*$', re.IGNORECASE | re.MULTILINE)

ACCION_NORM = {
    'extra rapida': 'extra_rapida',
    'extra rápida': 'extra_rapida',
    'moderada rapida': 'moderada_rapida',
    'moderada rápida': 'moderada_rapida',
    'rapida': 'rapida',
    'rápida': 'rapida',
    'moderada': 'moderada',
    'lenta': 'lenta',
}

def infer_accion(desc: str) -> str | None:
    m = RE_ACCION.search(desc)
    if m:
        raw = m.group(1).lower().replace('á', 'a').replace('ó', 'o')
        raw = re.sub(r'\s+', ' ', raw).strip()
        return ACCION_NORM.get(raw)
    m = RE_FAST.search(desc)
    if m:
        txt = m.group(1).lower()
        if 'extra' in txt:
            return 'extra_rapida'
        return 'rapida'
    if RE_RAPIDA_SUELTA.search(desc):
        return 'rapida'
    return None


# -----------------------------------------------------------------------------
# 4. Build attrs doc (canas)
# -----------------------------------------------------------------------------
def cm_to_ft_display(cm: int | None) -> str | None:
    """213cm → '7'0\"' (display amigable para vendedor)."""
    if cm is None:
        return None
    total_inches = cm / 2.54
    ft = int(total_inches // 12)
    inches = round(total_inches - ft * 12)
    if inches == 12:
        ft += 1
        inches = 0
    return f"{ft}'{inches}\""


def build_attrs(p: dict) -> dict:
    desc = p.get('desc') or ''
    sku = p['code']
    warnings: list[str] = []

    fam = p.get('fam') or ''
    tipo = infer_tipo(p)
    tramos = infer_tramos(desc, fam)
    potencia = infer_potencia(desc)
    libraje = infer_libraje(desc, potencia, fam)
    largo_cm = infer_largo_cm(desc)
    accion = infer_accion(desc)

    if not tipo:
        warnings.append('tipo_missing')
    if tramos is None:
        warnings.append('tramos_missing')
    if libraje is None:
        warnings.append('libraje_missing')
    elif libraje[2]:
        warnings.append('libraje_inferido_desde_potencia')
    if largo_cm is None:
        warnings.append('largo_missing')
    if accion is None:
        warnings.append('accion_missing')
    if potencia is None:
        warnings.append('potencia_missing')

    doc = {
        'sku': sku,
        'familia_motor': 'canas',
        'tipo': tipo,
        'tramos': tramos,
        'libraje_min': libraje[0] if libraje else None,
        'libraje_max': libraje[1] if libraje else None,
        'largo_cm': largo_cm,
        'largo_display': cm_to_ft_display(largo_cm),
        'accion': accion,
        'potencia': potencia,
        'warnings': warnings,
        'source': 'regex_v2',
        'backfillAt': datetime.now(timezone.utc).isoformat(),
    }
    return doc


# -----------------------------------------------------------------------------
# 4b. REELS (v1347)
# -----------------------------------------------------------------------------

def is_reel(p: dict) -> bool:
    return (p.get('cat') or '').upper() == 'REEL'


RE_TAMANO_DESC = re.compile(r'tama[nñ]o\s+(\d{3,5})', re.IGNORECASE)
RE_TAMANO_SKU = re.compile(r'(\d{3,5})')
RE_VEL_SKU = re.compile(r'(XG|HG|PG)[A-Z]*$')
RE_VEL_DESC = re.compile(r'\b(XG|HG|PG)\b')


def infer_tipo_reel(p: dict) -> str | None:
    fam = (p.get('fam') or '').lower()
    desc = (p.get('desc') or '').lower()
    if 'baitcasting' in fam or 'baitcasting' in desc:
        return 'Baitcasting'
    if 'conventional' in fam:
        return 'Conventional'
    if 'spinning' in fam or 'spinning' in desc:
        return 'Spinning'
    if 'rotativo' in desc:
        return 'Rotativo'
    return None


def infer_tamano_reel(p: dict) -> int | None:
    desc = p.get('desc') or ''
    sku = p.get('code') or ''
    m = RE_TAMANO_DESC.search(desc)
    if m:
        return int(m.group(1))
    # Fallback: numero en el SKU — buscar 4-5 digitos
    m = re.search(r'(\d{4,5})', sku)
    if m:
        n = int(m.group(1))
        # Sanity: tamaños razonables 500-30000
        if 500 <= n <= 30000:
            return n
    # Fallback: 3-4 digitos (CU150, CAT1000)
    m = re.search(r'(\d{3,4})', sku)
    if m:
        n = int(m.group(1))
        if 100 <= n <= 10000:
            return n
    return None


def infer_velocidad_reel(p: dict) -> str:
    """Returns 'regular' | 'HG' | 'XG' | 'PG'."""
    sku = p.get('code') or ''
    desc = p.get('desc') or ''
    # XG tiene prioridad (contiene G), luego HG, luego PG
    m = RE_VEL_SKU.search(sku)
    if m:
        return m.group(1)
    m = RE_VEL_DESC.search(desc)
    if m:
        return m.group(1)
    return 'regular'  # sin sigla = regular (mas lento, segun Mariano)


def build_attrs_reel(p: dict) -> dict:
    sku = p['code']
    warnings: list[str] = []
    tipo = infer_tipo_reel(p)
    tamano = infer_tamano_reel(p)
    velocidad = infer_velocidad_reel(p)

    if not tipo:
        warnings.append('tipo_missing')
    if tamano is None:
        warnings.append('tamano_missing')

    return {
        'sku': sku,
        'familia_motor': 'reels',
        'tipo': tipo,
        'tamano': tamano,
        'velocidad': velocidad,
        'warnings': warnings,
        'source': 'regex_v2',
        'backfillAt': datetime.now(timezone.utc).isoformat(),
    }


# -----------------------------------------------------------------------------
# 4c. LINEAS (v1347)
# -----------------------------------------------------------------------------

def is_linea(p: dict) -> bool:
    return (p.get('cat') or '').upper() == 'LINEAS'


# Mapeo sub -> (marca, hebras). Cubre 100% del catalogo actual.
SUB_LINEA_MAP = {
    'Regular PP': ('PowerPro', 4),
    'Super Slick V2': ('PowerPro', 8),
    'Maxcuatro': ('PowerPro', 4),
    'Kairiki 4': ('Kairiki', 4),
    'Kairiki 8': ('Kairiki', 8),
}

RE_METROS = re.compile(r'(\d+)\s*m(?:ts|etros)?\b', re.IGNORECASE)
RE_YARDAS = re.compile(r'(\d+)\s*yd', re.IGNORECASE)


def infer_marca_hebras_linea(p: dict) -> tuple[str | None, int | None]:
    sub = (p.get('sub') or '').strip()
    if sub in SUB_LINEA_MAP:
        marca, hebras = SUB_LINEA_MAP[sub]
        return marca, hebras
    # Fallback desc
    desc = (p.get('desc') or '').lower()
    marca = None
    if 'power pro' in desc or 'powerpro' in desc:
        marca = 'PowerPro'
    elif 'kairiki' in desc or 'hairiki' in desc:
        marca = 'Kairiki'
    hebras = None
    if re.search(r'\b8\s*hebras?\b', desc) or 'superslick' in desc or 'v2' in desc:
        hebras = 8
    elif re.search(r'\b4\s*hebras?\b', desc) or 'max 4' in desc or 'maxcuatro' in desc:
        hebras = 4
    return marca, hebras


def infer_libraje_linea(p: dict) -> int | None:
    """Lineas usan single value lb (ej. '30 LB'). Devuelve el numero."""
    desc = p.get('desc') or ''
    m = re.search(r'(\d+)\s*lb', desc, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


def infer_largo_linea(p: dict) -> tuple[int | None, int | None]:
    """Returns (largo_m, largo_yd). Si no hay dato explicito, None."""
    desc = p.get('desc') or ''
    m = RE_METROS.search(desc)
    largo_m = int(m.group(1)) if m else None
    m = RE_YARDAS.search(desc)
    largo_yd = int(m.group(1)) if m else None
    return largo_m, largo_yd


def build_attrs_linea(p: dict) -> dict:
    sku = p['code']
    warnings: list[str] = []
    marca, hebras = infer_marca_hebras_linea(p)
    libraje = infer_libraje_linea(p)
    largo_m, largo_yd = infer_largo_linea(p)

    if not marca:
        warnings.append('marca_missing')
    if hebras is None:
        warnings.append('hebras_missing')
    if libraje is None:
        warnings.append('libraje_missing')
    if largo_m is None and largo_yd is None:
        warnings.append('largo_missing')

    return {
        'sku': sku,
        'familia_motor': 'lineas',
        'marca': marca,
        'hebras': hebras,
        'libraje': libraje,
        'largo_m': largo_m,
        'largo_yd': largo_yd,
        'warnings': warnings,
        'source': 'regex_v2',
        'backfillAt': datetime.now(timezone.utc).isoformat(),
    }


# -----------------------------------------------------------------------------
# 5. Reporte
# -----------------------------------------------------------------------------
def pct(a: int, b: int) -> str:
    if b == 0:
        return '0%'
    return f'{(a/b)*100:.1f}%'


def report(attrs_docs: list[dict]) -> dict:
    n = len(attrs_docs)
    canas = [d for d in attrs_docs if d.get('familia_motor') == 'canas']
    reels = [d for d in attrs_docs if d.get('familia_motor') == 'reels']
    lineas = [d for d in attrs_docs if d.get('familia_motor') == 'lineas']

    print(f'\n{"="*70}\nREPORTE BACKFILL v2 (canas + reels + lineas)\n{"="*70}')
    print(f'Total procesados: {n}')
    print(f'  Cañas:  {len(canas)}')
    print(f'  Reels:  {len(reels)}')
    print(f'  Lineas: {len(lineas)}')

    # Cañas
    if canas:
        c_tipo = sum(1 for d in canas if d.get('tipo'))
        c_tramos = sum(1 for d in canas if d.get('tramos') is not None)
        c_libraje = sum(1 for d in canas if d.get('libraje_min') is not None)
        c_largo = sum(1 for d in canas if d.get('largo_cm') is not None)
        c_hard = sum(1 for d in canas if d.get('tipo') and d.get('tramos') is not None and d.get('libraje_min') is not None)
        nc = len(canas)
        print(f'\n== CAÑAS ({nc}) ==')
        print(f'  tipo: {pct(c_tipo, nc)} · tramos: {pct(c_tramos, nc)} · libraje: {pct(c_libraje, nc)} · largo: {pct(c_largo, nc)}')
        print(f'  >>> 3 HARD completos: {c_hard}/{nc} ({pct(c_hard, nc)}) <<<')

    # Reels
    if reels:
        r_tipo = sum(1 for d in reels if d.get('tipo'))
        r_tamano = sum(1 for d in reels if d.get('tamano') is not None)
        r_velocidad = sum(1 for d in reels if d.get('velocidad'))  # siempre existe (regular default)
        r_hard = sum(1 for d in reels if d.get('tipo') and d.get('tamano') is not None)
        nr = len(reels)
        print(f'\n== REELS ({nr}) ==')
        print(f'  tipo: {pct(r_tipo, nr)} · tamano: {pct(r_tamano, nr)} · velocidad: {pct(r_velocidad, nr)} (siempre, default=regular)')
        print(f'  >>> HARD completos (tipo+tamano): {r_hard}/{nr} ({pct(r_hard, nr)}) <<<')
        sin_tipo_r = [d['sku'] for d in reels if not d.get('tipo')][:10]
        sin_tamano_r = [d['sku'] for d in reels if d.get('tamano') is None][:10]
        if sin_tipo_r:
            print(f'  Sin tipo (primeros 10): {", ".join(sin_tipo_r)}')
        if sin_tamano_r:
            print(f'  Sin tamano (primeros 10): {", ".join(sin_tamano_r)}')

    # Lineas
    if lineas:
        l_marca = sum(1 for d in lineas if d.get('marca'))
        l_hebras = sum(1 for d in lineas if d.get('hebras') is not None)
        l_libraje = sum(1 for d in lineas if d.get('libraje') is not None)
        l_largo = sum(1 for d in lineas if d.get('largo_m') is not None or d.get('largo_yd') is not None)
        l_hard = sum(1 for d in lineas if d.get('marca') and d.get('hebras') is not None and d.get('libraje') is not None)
        nl = len(lineas)
        print(f'\n== LINEAS ({nl}) ==')
        print(f'  marca: {pct(l_marca, nl)} · hebras: {pct(l_hebras, nl)} · libraje: {pct(l_libraje, nl)} · largo: {pct(l_largo, nl)}')
        print(f'  >>> 3 HARD completos (marca+hebras+libraje): {l_hard}/{nl} ({pct(l_hard, nl)}) <<<')
        sin_hard_l = [d['sku'] for d in lineas if not (d.get('marca') and d.get('hebras') is not None and d.get('libraje') is not None)][:10]
        if sin_hard_l:
            print(f'  Sin HARD completo (primeros 10): {", ".join(sin_hard_l)}')

    # Global 3-HARD rate (ponderado por familia)
    hard_total = 0
    hard_ok = 0
    if canas:
        hard_total += len(canas)
        hard_ok += sum(1 for d in canas if d.get('tipo') and d.get('tramos') is not None and d.get('libraje_min') is not None)
    if reels:
        hard_total += len(reels)
        hard_ok += sum(1 for d in reels if d.get('tipo') and d.get('tamano') is not None)
    if lineas:
        hard_total += len(lineas)
        hard_ok += sum(1 for d in lineas if d.get('marca') and d.get('hebras') is not None and d.get('libraje') is not None)
    return {
        'total': n,
        'with_hard': hard_ok,
        'pct_hard': hard_ok / hard_total if hard_total else 0,
    }


# -----------------------------------------------------------------------------
# 6. Firestore write (opcional)
# -----------------------------------------------------------------------------
def init_firestore_client():
    """Init firestore. Prefiere FIREBASE_SERVICE_ACCOUNT env var; fallback a ADC."""
    import firebase_admin
    from firebase_admin import credentials, firestore
    if firebase_admin._apps:
        return firestore.client()
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if sa_json:
        sa_data = json.loads(sa_json)
        cred = credentials.Certificate(sa_data)
        firebase_admin.initialize_app(cred)
    else:
        # ADC fallback (gcloud auth application-default)
        project_id = os.environ.get('GOOGLE_CLOUD_PROJECT') or 'app-vendedores-shimano'
        firebase_admin.initialize_app(options={'projectId': project_id})
    return firestore.client()


def write_firestore(attrs_docs: list[dict]) -> None:
    db = init_firestore_client()
    col = db.collection('items_attrs')
    batch = db.batch()
    count = 0
    total = len(attrs_docs)
    for doc in attrs_docs:
        ref = col.document(doc['sku'])
        batch.set(ref, doc, merge=True)
        count += 1
        if count % 400 == 0:
            batch.commit()
            print(f'  committed {count}/{total}')
            batch = db.batch()
    if count % 400 != 0:
        batch.commit()
    # Meta doc
    meta_ref = col.document('_backfill_meta_')
    meta_ref.set({
        'totalProcessed': total,
        'backfillAt': datetime.now(timezone.utc).isoformat(),
        'source': 'regex_v1',
        'runFromScript': 'scripts/backfill_product_attrs.py',
    }, merge=True)
    print(f'\n[OK] Escritos {total} docs en items_attrs/ (+ _backfill_meta_)')


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='No escribe a Firestore')
    ap.add_argument('--only-sku', help='Solo procesa este SKU (debug)')
    args = ap.parse_args()

    products = load_products()
    print(f'[load] Total PRODUCTS: {len(products)}')
    canas = [p for p in products if is_cana(p)]
    reels = [p for p in products if is_reel(p)]
    lineas = [p for p in products if is_linea(p)]
    print(f'[filter] Cañas: {len(canas)} · Reels: {len(reels)} · Lineas: {len(lineas)}')

    if args.only_sku:
        all_items = canas + reels + lineas
        found = [p for p in all_items if p['code'] == args.only_sku]
        if not found:
            print(f'[FATAL] SKU {args.only_sku} no encontrado o no es caña/reel/linea')
            sys.exit(1)
        p = found[0]
        if is_cana(p):
            doc = build_attrs(p)
        elif is_reel(p):
            doc = build_attrs_reel(p)
        else:
            doc = build_attrs_linea(p)
        print(json.dumps(doc, indent=2, ensure_ascii=False, default=str))
        return

    attrs_docs = (
        [build_attrs(p) for p in canas] +
        [build_attrs_reel(p) for p in reels] +
        [build_attrs_linea(p) for p in lineas]
    )

    stats = report(attrs_docs)
    gate = 0.95
    if stats['pct_hard'] < gate:
        print(f'\n[WARN] {pct(stats["with_hard"], stats["total"])} < {int(gate*100)}% requerido')
        print('[WARN] Iterar regex antes de push. Usar --dry-run para iterar.')
    else:
        print(f'\n[OK] Gate ≥{int(gate*100)}% alcanzado.')

    if args.dry_run:
        print('\n[DRY-RUN] No escribo a Firestore.')
        return

    if stats['pct_hard'] < gate:
        resp = input('\nGate NO cumplido. Escribir igual? (yes/N): ').strip().lower()
        if resp != 'yes':
            print('Abortado.')
            sys.exit(1)

    write_firestore(attrs_docs)


if __name__ == '__main__':
    main()
