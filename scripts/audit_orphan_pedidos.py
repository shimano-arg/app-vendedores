# -*- coding: utf-8 -*-
"""Audit pedidos huerfanos (badge amarillo 'sin catalogo').

Un pedido es huerfano cuando su key (tipo|province|locality|clientName) NO
matchea con ningun POINT del catalogo NI con approvedAltas de client_applications.

Fuentes de matcheo:
1. Catalogo POINTS (embebido en la app, aca lo re-derivamos consultando
   client_master + sap_clients).
2. client_applications con status='approved'.

Uso:
    python scripts/audit_orphan_pedidos.py                # solo listado
    python scripts/audit_orphan_pedidos.py --suggest      # con sugerencias
    python scripts/audit_orphan_pedidos.py --apply        # aplicar top N sugerencias claras
    python scripts/audit_orphan_pedidos.py --export csv   # export CSV para revision manual
"""
import argparse
import csv
import os
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if SA_KEY.exists():
    os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY.read_text()
sys.stdout.reconfigure(encoding='utf-8')

from sync_sap_to_bigquery import init_firestore, parse_sa_json  # noqa: E402


def norm_str(s):
    """Normaliza para comparar: strip acentos, upper, trim."""
    if not s:
        return ''
    s = str(s).strip()
    # NFKD descompone acentos, luego filtramos los combining marks
    s = ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))
    return s.upper()


def order_key(tipo, province, locality, name):
    """Replica orderKey del inline (index.html):
       return `${tipo}|${province.toUpperCase()}|${locality}|${name}`
    """
    return f'{tipo}|{(province or "").upper()}|{locality or ""}|{name or ""}'


# Aliases comunes de provincia (formato "usuario" -> formato "catalogo")
PROVINCE_ALIASES = {
    'CIUDAD AUTONOMA DE BUENOS AIRES': 'CAPITAL FEDERAL',
    'CABA': 'CAPITAL FEDERAL',
    'CIUDAD DE BUENOS AIRES': 'CAPITAL FEDERAL',
    'CIUDAD AUTONOMA': 'CAPITAL FEDERAL',
    'BUENOS AIRES CAPITAL': 'CAPITAL FEDERAL',
    'TIERRA DEL FUEGO ANTARTIDA E ISLAS DEL ATLANTICO SUR': 'TIERRA DEL FUEGO',
    'ANTARTIDA E ISLAS DEL ATLANTICO SUR': 'TIERRA DEL FUEGO',
    'RIO NEGRO PROVINCIA': 'RIO NEGRO',
}


def load_catalog_keys(db):
    """Construye el set de keys 'validas' desde client_master + client_applications."""
    keys = set()
    # 1) client_master (POINTS derivados)
    for doc in db.collection('client_master').stream():
        d = doc.to_dict() or {}
        prov = norm_str(d.get('provincia') or '')
        loc = (d.get('localidad') or '').strip()
        name = (d.get('clientName') or '').strip()
        if not prov or not loc or not name:
            continue
        keys.add(order_key('C', prov, loc, name))
    # 2) client_applications aprobadas
    for doc in db.collection('client_applications').stream():
        d = doc.to_dict() or {}
        if d.get('status') != 'approved':
            continue
        prov = norm_str(d.get('provincia') or '')
        loc = (d.get('localidadFinal') or d.get('localidad') or '').strip()
        name = (d.get('comercio') or d.get('fantasia') or '').strip()
        if not prov or not loc or not name:
            continue
        keys.add(order_key('C', prov, loc, name))
    return keys


def load_catalog_by_name(db):
    """Índice por nombre normalizado → (province, locality) del catálogo.
    Sirve para sugerir fix cuando el nombre coincide pero la provincia/localidad no."""
    idx = defaultdict(list)
    for doc in db.collection('client_master').stream():
        d = doc.to_dict() or {}
        name = (d.get('clientName') or '').strip()
        prov = norm_str(d.get('provincia') or '')
        loc = (d.get('localidad') or '').strip()
        if not name or not prov or not loc:
            continue
        idx[norm_str(name)].append(('client_master', d.get('provincia'), loc))
    for doc in db.collection('client_applications').stream():
        d = doc.to_dict() or {}
        if d.get('status') != 'approved':
            continue
        name = (d.get('comercio') or d.get('fantasia') or '').strip()
        prov = norm_str(d.get('provincia') or '')
        loc = (d.get('localidadFinal') or d.get('localidad') or '').strip()
        if not name or not prov or not loc:
            continue
        idx[norm_str(name)].append(('approved_alta', d.get('provincia'), loc))
    return idx


def suggest_fix(pedido, catalog_by_name, catalog_keys):
    """Devuelve dict con sugerencia de fix o None si no hay match claro.
    Estrategia:
    1. Si el clientName matchea EXACTAMENTE (norm) con algún doc del catálogo,
       usar la provincia+localidad de ese doc.
    2. Si la provincia normalizada matchea un alias conocido, aplicar el alias.
    """
    pname = pedido.get('clientName') or ''
    pprov = pedido.get('clientProvince') or ''
    ploc = pedido.get('clientLocality') or ''
    tipo = 'C'

    suggestions = []

    # Estrategia 1: match por nombre
    hits = catalog_by_name.get(norm_str(pname), [])
    for src, cat_prov, cat_loc in hits:
        candidate_key = order_key(tipo, norm_str(cat_prov), cat_loc, pname)
        if candidate_key in catalog_keys:
            suggestions.append({
                'strategy': f'match_by_name_from_{src}',
                'new_province': cat_prov,
                'new_locality': cat_loc,
                'confidence': 'HIGH',
            })

    # Estrategia 2: alias de provincia (si nombre + localidad quedan iguales)
    normalized_prov = norm_str(pprov)
    if normalized_prov in PROVINCE_ALIASES:
        new_prov = PROVINCE_ALIASES[normalized_prov]
        candidate_key = order_key(tipo, new_prov, ploc, pname)
        if candidate_key in catalog_keys:
            suggestions.append({
                'strategy': 'province_alias',
                'new_province': new_prov,
                'new_locality': ploc,
                'confidence': 'HIGH',
            })

    if not suggestions:
        return None
    # Dedup + preferir HIGH confidence primero
    seen = set()
    dedup = []
    for s in suggestions:
        key = (s['new_province'], s['new_locality'])
        if key in seen: continue
        seen.add(key)
        dedup.append(s)
    return dedup[0] if dedup else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--suggest', action='store_true', help='Incluir sugerencias de fix')
    parser.add_argument('--apply', action='store_true', help='Aplicar sugerencias HIGH confidence')
    parser.add_argument('--export', help='Path CSV de salida')
    parser.add_argument('--limit', type=int, help='Limitar N pedidos (para test)')
    args = parser.parse_args()

    db = init_firestore(parse_sa_json())

    print('Cargando catalogo (client_master + approved altas)...')
    catalog_keys = load_catalog_keys(db)
    print(f'  {len(catalog_keys)} keys validas en catalogo')

    catalog_by_name = load_catalog_by_name(db) if (args.suggest or args.apply) else {}

    print('Escaneando pedidos...')
    orphans = []
    total = 0
    for doc in db.collection('pedidos').stream():
        d = doc.to_dict() or {}
        total += 1
        prov = norm_str(d.get('clientProvince') or '')
        loc = (d.get('clientLocality') or '').strip()
        name = (d.get('clientName') or '').strip()
        if not name or not prov or not loc:
            orphans.append({'id': doc.id, 'd': d, 'reason': 'missing_fields'})
            continue
        key = order_key('C', prov, loc, name)
        if key in catalog_keys:
            continue
        orphans.append({'id': doc.id, 'd': d, 'reason': 'no_match'})

    print(f'Total pedidos: {total}')
    print(f'Huerfanos: {len(orphans)}')

    # Aplicar sugerencias
    fixed = 0
    if args.apply:
        print()
        print('=== APPLY mode ===')
        for o in orphans:
            if args.limit and fixed >= args.limit: break
            d = o['d']
            sug = suggest_fix(d, catalog_by_name, catalog_keys)
            if not sug or sug.get('confidence') != 'HIGH': continue
            new_prov = sug['new_province']
            new_loc = sug['new_locality']
            old_prov = d.get('clientProvince') or ''
            old_loc = d.get('clientLocality') or ''
            if new_prov == old_prov and new_loc == old_loc: continue
            db.collection('pedidos').document(o['id']).update({
                'clientProvince': new_prov,
                'clientLocality': new_loc,
                'huerfanoFixedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
                'huerfanoFixStrategy': sug['strategy'],
            })
            fixed += 1
            print(f'  ✓ {o["id"]}: {d.get("clientName")[:35]:<35} {old_prov}/{old_loc} -> {new_prov}/{new_loc} ({sug["strategy"]})')
        print(f'\\nAplicados: {fixed}')

    # Print summary
    print()
    print('=== TOP 20 huerfanos ===')
    for o in orphans[:20]:
        d = o['d']
        prov = d.get('clientProvince') or '(vacio)'
        loc = d.get('clientLocality') or '(vacio)'
        name = (d.get('clientName') or '(sin nombre)')[:35]
        stage = d.get('stage') or ''
        line = f'  {o["id"][:20]:<22} {name:<37} {prov[:20]:<20} / {loc[:18]:<18} [{stage}] {o["reason"]}'
        if args.suggest:
            sug = suggest_fix(d, catalog_by_name, catalog_keys)
            if sug:
                line += f'\\n    → fix {sug["confidence"]}: {sug["new_province"]}/{sug["new_locality"]} ({sug["strategy"]})'
        print(line)

    # Export CSV
    if args.export:
        with open(args.export, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f)
            w.writerow(['pedidoId','clientName','province','locality','stage','reason','suggestion_province','suggestion_locality','confidence','strategy'])
            for o in orphans:
                d = o['d']
                sug = suggest_fix(d, catalog_by_name, catalog_keys) if catalog_by_name else None
                w.writerow([
                    o['id'], d.get('clientName',''), d.get('clientProvince',''),
                    d.get('clientLocality',''), d.get('stage',''), o['reason'],
                    sug['new_province'] if sug else '',
                    sug['new_locality'] if sug else '',
                    sug['confidence'] if sug else '',
                    sug['strategy'] if sug else '',
                ])
        print(f'\\n📄 CSV guardado en: {args.export}')


if __name__ == '__main__':
    main()
