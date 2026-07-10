"""Chequea la config del SL en Firestore."""
import json
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
cred = credentials.Certificate(sa)
firebase_admin.initialize_app(cred)
db = firestore.client()

snap = db.collection('app_config').document('sap_integration').get()
if not snap.exists:
    print('no existe')
else:
    data = snap.to_dict() or {}
    sl = data.get('serviceLayer', {})
    print('serviceLayer.url:', sl.get('url'))
    print('serviceLayer.companyDB:', sl.get('companyDB'))
    print('serviceLayer.username:', sl.get('username'))
    print('serviceLayer.enabled:', sl.get('enabled'))
