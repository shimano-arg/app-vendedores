"""
Busca el user 'PACHI' en Firebase Auth + Firestore roles, y opcionalmente lo
disable + marca roles como disabled. Uso:

  python scripts/disable_pachi_and_find.py            # dry-run: solo busca y reporta
  python scripts/disable_pachi_and_find.py --apply    # ejecuta disable

Contexto: Diego (director) 2026-09-10 confirmo que PACHI NO es empleado
Shimano y NO debe tener acceso a la app. Este script cierra el gap de
compliance de la migracion v849-v856 que le habia dado Firebase user +
role='vendor'.

Requiere FIREBASE_SERVICE_ACCOUNT env var (mismo JSON que usa el sync).
"""
import sys
import json
import os

sys.path.insert(0, 'scripts')

# Reutilizamos el bootstrapping del sync (init_firestore + parse_sa_json)
from sync_sap_to_bigquery import init_firestore, parse_sa_json, log  # noqa: E402

import firebase_admin
from firebase_admin import auth as fb_auth

APPLY = '--apply' in sys.argv


def find_pachi_user(db):
    """
    Busca user Pachi en 3 fuentes:
    - Firebase Auth por displayName
    - Firestore roles/{uid} por displayName
    - Firestore users_directory doc si existe

    Returns lista de dicts {uid, email, displayName, source}.
    """
    matches = []

    # 1) Firebase Auth: iterar users (batch)
    log('[SEARCH] Firebase Auth: listando users...')
    page = fb_auth.list_users()
    total = 0
    while page:
        for u in page.users:
            total += 1
            dn = (u.display_name or '').upper()
            em = (u.email or '').lower()
            if 'PACHI' in dn or 'pachi' in em:
                matches.append({
                    'source': 'firebase_auth',
                    'uid': u.uid,
                    'email': u.email,
                    'displayName': u.display_name,
                    'disabled': u.disabled,
                })
        page = page.get_next_page()
    log(f'[SEARCH] Total users en Auth: {total}')

    # 2) Firestore roles: buscar por displayName
    log('[SEARCH] Firestore roles/: buscando displayName contiene PACHI...')
    roles = db.collection('roles').stream()
    for r in roles:
        d = r.to_dict() or {}
        dn = (d.get('displayName') or '').upper()
        em = (d.get('email') or '').lower()
        if 'PACHI' in dn or 'pachi' in em:
            matches.append({
                'source': 'firestore_roles',
                'uid': r.id,
                'email': d.get('email'),
                'displayName': d.get('displayName'),
                'role': d.get('role'),
                'status': d.get('status'),
            })

    return matches


def disable_user(db, uid, email):
    """Disable en Firebase Auth + marca roles/{uid}.status='disabled'."""
    # Firebase Auth
    try:
        fb_auth.update_user(uid, disabled=True)
        log(f'[APPLY] Firebase Auth: user {uid} ({email}) disabled=True')
    except Exception as e:
        log(f'[APPLY] ERROR Firebase Auth disable {uid}: {e}')
        return False

    # Firestore roles
    try:
        db.collection('roles').document(uid).set({
            'status': 'disabled',
            'disabledAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
            'disabledReason': 'Compliance: Diego confirmo 2026-09-10 que PACHI no es empleado Shimano',
        }, merge=True)
        log(f'[APPLY] Firestore roles/{uid}: status=disabled')
    except Exception as e:
        log(f'[APPLY] ERROR Firestore roles update {uid}: {e}')
        return False

    return True


def main():
    sa = parse_sa_json()
    db = init_firestore(sa)

    matches = find_pachi_user(db)

    if not matches:
        log('\n[RESULT] Cero matches. Pachi NO tiene user en Firebase Auth ni doc en Firestore roles/.')
        log('         Nada para deshabilitar. Compliance ya limpio.')
        return

    log(f'\n[RESULT] {len(matches)} match(es):')
    for m in matches:
        log(f'  {m}')

    # Dedupe por UID
    uids = {}
    for m in matches:
        uid = m.get('uid')
        if uid and uid not in uids:
            uids[uid] = m

    log(f'\n[RESULT] {len(uids)} UID(s) unicos a deshabilitar:')
    for uid, m in uids.items():
        log(f'  uid={uid} email={m.get("email")} displayName={m.get("displayName")}')

    if not APPLY:
        log('\n[DRY-RUN] Corre con --apply para deshabilitar.')
        return

    log('\n[APPLY] Deshabilitando...')
    for uid, m in uids.items():
        disable_user(db, uid, m.get('email'))

    log('\n[APPLY] Done. Verificar en Firebase Console + intentar login para confirmar rebote.')


if __name__ == '__main__':
    main()
