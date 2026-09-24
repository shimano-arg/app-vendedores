"""
One-shot cleanup ORDEN 228 (ANA LORENA FUENTES) - v1058 incident 2026-09-24.

Fixes:
1. revision_waitlist/KMIdF94Ah9Eud7xyEesf → stage='consumed', consumedByPedidoId,
   consumedAt (invisible en sidebar; sin borrar por si Mariano quiere revisar).
2. pedidos/2msGaQQrMK4Gxl5Q4dMc → sendingSapLock removed (para que sap-auto-send
   pueda reintentar cuando AppCheck esté OK).

Autorizado por Mariano 2026-09-24 vía AskUserQuestion.
"""
import argparse, os
from datetime import datetime, timezone
import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser("~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json")
WAITLIST_ID = "KMIdF94Ah9Eud7xyEesf"
PEDIDO_ID = "2msGaQQrMK4Gxl5Q4dMc"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()

    cred = credentials.Certificate(SA_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] Cleanup ORDEN 228 ANA LORENA FUENTES\n")

    # 1. waitlist → consumed
    w_ref = db.collection("revision_waitlist").document(WAITLIST_ID)
    w_snap = w_ref.get()
    if not w_snap.exists:
        print(f"  ! waitlist {WAITLIST_ID} no existe")
        return
    w_data = w_snap.to_dict() or {}
    print(f"  waitlist current: stage={w_data.get('stage')} consumedByPedidoId={w_data.get('consumedByPedidoId')}")
    print(f"    -> set stage='consumed', consumedByPedidoId='{PEDIDO_ID}'")

    # 2. pedido → clear sendingSapLock
    p_ref = db.collection("pedidos").document(PEDIDO_ID)
    p_snap = p_ref.get()
    if not p_snap.exists:
        print(f"  ! pedido {PEDIDO_ID} no existe")
        return
    p_data = p_snap.to_dict() or {}
    print(f"\n  pedido current: transferError.message={(p_data.get('transferError') or {}).get('message','')[:80]}")
    print(f"                  sendingSapLock={p_data.get('sendingSapLock')}")
    print(f"    -> DELETE sendingSapLock (para permitir reintento cuando AppCheck OK)")

    if not args.apply:
        print(f"\n[DRY-RUN] Correr con --apply para ejecutar.")
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    w_ref.update({
        "stage": "consumed",
        "consumedByPedidoId": PEDIDO_ID,
        "consumedAt": firestore.SERVER_TIMESTAMP,
        "consumedByScript": "_cleanup_orphan_waitlist_228.py",
        "consumedByReason": "v1058-incident-appcheck-401",
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    p_ref.update({
        "sendingSapLock": firestore.DELETE_FIELD,
        "sendingSapLockClearedAt": now_iso,
        "sendingSapLockClearedBy": "_cleanup_orphan_waitlist_228.py",
    })
    print(f"\n[APPLY] OK. Waitlist marcado consumed + pedido lock liberado.")

if __name__ == "__main__":
    main()
