"""One-off: migra fotoTicket base64 embebido en rendiciones -> Firebase Storage.

Contexto (v308+): la app v307 y anteriores guardaban la foto del ticket
como data URL base64 dentro del doc de Firestore. Eso hace que cada doc
pese 50-500KB, y en cantidad rompe Power BI Import mode (VertiPaq no
puede comprimir strings unicos).

Fix: v308 sube la foto a Firebase Storage y guarda solo la downloadURL en
el campo fotoTicketUrl. Este script retro-migra los docs viejos:
  1. Lee todos los docs de `rendiciones` con fotoTicket (base64).
  2. Sube cada foto a Storage bajo rendiciones/{ownerUid}/{docId}_ticket.{ext}
  3. Guarda fotoTicketUrl en el doc.
  4. Borra el campo fotoTicket (con FieldValue.DELETE_FIELD).

Idempotente: skippea docs que ya tienen fotoTicketUrl y no tienen fotoTicket.

Uso:
    cd "C:\\Users\\shimano.sandbox\\Desktop\\APP VENDEDORES"
    $env:DRY_RUN = "true"     # opcional: solo listar, no tocar
    python scripts/migrate_rendiciones_foto_to_storage.py
"""
import base64
import json
import os
import re
import sys
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, storage

SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
sa_data = json.loads(SA_KEY_PATH.read_text())
BUCKET_NAME = 'app-vendedores-shimano.firebasestorage.app'

if not firebase_admin._apps:
    firebase_admin.initialize_app(
        credentials.Certificate(sa_data),
        {'storageBucket': BUCKET_NAME},
    )

db = firestore.client()
bucket = storage.bucket()

DRY_RUN = os.environ.get('DRY_RUN', '').lower() in ('1', 'true', 'yes')

DATA_URL_RE = re.compile(r'^data:image/(\w+);base64,(.+)$', re.IGNORECASE)


def upload_photo(owner_uid: str, doc_id: str, data_url: str) -> str:
    m = DATA_URL_RE.match(data_url)
    if not m:
        raise ValueError('data URL invalido')
    ext = m.group(1).lower().replace('jpeg', 'jpg')
    b64 = m.group(2)
    raw = base64.b64decode(b64)
    path = f'rendiciones/{owner_uid or "anonimo"}/{doc_id}_ticket.{ext}'
    blob = bucket.blob(path)
    blob.upload_from_string(raw, content_type=f'image/{ext}')
    # Hacer publico el archivo para que la URL sea directamente accesible
    # (mismo comportamiento que un getDownloadURL de client SDK).
    blob.make_public()
    return blob.public_url


def main():
    print(f'[cfg] bucket={BUCKET_NAME}')
    print(f'[cfg] DRY_RUN={DRY_RUN}')
    print()
    docs = list(db.collection('rendiciones').stream())
    print(f'[scan] {len(docs)} docs totales en rendiciones')

    to_migrate = []
    already_migrated = 0
    no_photo = 0
    for d in docs:
        data = d.to_dict() or {}
        has_url = bool(data.get('fotoTicketUrl'))
        has_b64 = bool(data.get('fotoTicket'))
        if has_url and not has_b64:
            already_migrated += 1
            continue
        if not has_b64:
            no_photo += 1
            continue
        to_migrate.append((d.id, data))

    print(f'  a migrar (con base64): {len(to_migrate)}')
    print(f'  ya migradas (solo url): {already_migrated}')
    print(f'  sin foto: {no_photo}')
    print()

    if not to_migrate:
        print('Nada que hacer.')
        return

    ok = 0
    fail = 0
    for i, (doc_id, data) in enumerate(to_migrate, 1):
        owner_uid = data.get('ownerUid') or ''
        owner_email = data.get('ownerEmail') or ''
        importe = data.get('importe', 0)
        b64 = data.get('fotoTicket') or ''
        size_kb = len(b64) / 1024
        print(f'[{i}/{len(to_migrate)}] doc={doc_id[:12]}...  owner={owner_email[:30]:30s}  importe={importe:>10}  foto={size_kb:6.1f}KB', end='  ')
        if DRY_RUN:
            print('[DRY-RUN skip]')
            continue
        try:
            url = upload_photo(owner_uid, doc_id, b64)
            db.collection('rendiciones').document(doc_id).update({
                'fotoTicketUrl': url,
                'fotoTicket': firestore.DELETE_FIELD,
                'fotoTicketMigratedAt': firestore.SERVER_TIMESTAMP,
                'fotoTicketMigratedBy': 'migrate_rendiciones_foto_to_storage.py',
            })
            print(f'[OK] url={url[-60:]}')
            ok += 1
        except Exception as e:
            print(f'[FAIL] {e}')
            fail += 1

    print()
    print('=' * 60)
    print(f'DONE  ok={ok}  fail={fail}  total_a_migrar={len(to_migrate)}')


if __name__ == '__main__':
    main()
