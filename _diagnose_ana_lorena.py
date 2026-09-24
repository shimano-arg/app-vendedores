"""Diagnóstico del duplicado ANA LORENA FUENTES ORDEN 228."""
import os
import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser("~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json")
cred = credentials.Certificate(SA_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()

def scan(coll, filt_field, filt_val):
    print(f"\n=== {coll}: {filt_field} contains '{filt_val}' ===")
    hits = []
    for d in db.collection(coll).stream():
        data = d.to_dict() or {}
        v = str(data.get(filt_field) or "").upper()
        if filt_val.upper() in v:
            hits.append((d.id, data))
    print(f"Encontrados: {len(hits)}")
    for i, (did, data) in enumerate(hits[-6:]):  # solo últimos 6
        print(f"\n  [{i}] ID: {did}")
        print(f"      clientName: {data.get('clientName')}")
        print(f"      stage: {data.get('stage')}")
        print(f"      orderNumber: {data.get('orderNumber')}")
        print(f"      createdAt: {data.get('createdAt')}")
        print(f"      transferidoSAP: {data.get('transferidoSAP')}")
        print(f"      transferError: {str(data.get('transferError'))[:150]}")
        print(f"      sendingSapLock: {data.get('sendingSapLock')}")
        print(f"      consumedByPedidoId: {data.get('consumedByPedidoId')}")
        print(f"      consumedAt: {data.get('consumedAt')}")

scan("pedidos", "clientName", "ANA LORENA")
scan("revision_waitlist", "clientName", "ANA LORENA")
