"""
Migracion one-shot: los waitlist docs que quedaron con SOLO items backorder
(era v568, resuelto por v573) se convierten a pedidos con lineas state='BO'.

Post-migracion:
- El waitlist doc se borra.
- El pedido nuevo aparece en Pendientes (stage='pending').
- La CF E3 recalcula stock_snapshot_app.backorderByClientSkuApp automatico
  cuando se escribe el pedido -> aparece en el modal BACKORDER con badge APP.

Uso:
  python scripts/migrate_waitlist_to_pedidos_bo.py            # dry-run
  python scripts/migrate_waitlist_to_pedidos_bo.py --apply    # aplicar
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore

SA_PATH = os.path.expanduser(
    "~/Downloads/app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json"
)

# Waitlist docs a migrar (identificados por el user 2026-08-21).
WAITLIST_IDS = [
    "aCTXIwIX1P6W7nY1x2gb",  # LUIS JOSE ZYSMAN - ORDEN OC 062
    "r0jrG8fCYbJXlT0VmV0Z",  # PESCA ESCOBAR S.R.L. - ORDEN 64
    "sSD8QxTYbEGxj0dMdE1d",  # BROBRO SA - ORDEN 73
]


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _month_label(dt):
    meses = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
    ]
    return f"{meses[dt.month - 1]} {dt.year}"


def build_pedido_doc(wl_data):
    """Convierte un waitlist doc a un pedido schema v2 con todas las lineas state='BO'."""
    now_iso = _now_iso()
    now_dt = datetime.now(timezone.utc)
    client_name = wl_data.get("clientName") or ""
    province = (wl_data.get("clientProvince") or "").upper()
    loc_name = wl_data.get("clientLocality") or ""
    card_code = wl_data.get("clientCardCode") or ""
    owner_email = wl_data.get("ownerEmail") or ""
    owner_uid = wl_data.get("ownerUid") or ""
    owner_vendor = wl_data.get("vendorAssigned") or wl_data.get("ownerVendor") or ""
    order_number = wl_data.get("orderNumber") or None
    items = wl_data.get("items") or []

    lines = []
    for it in items:
        code = str(it.get("code") or "").strip()
        qty = float(it.get("qty") or 0)
        if not code or qty <= 0:
            continue
        # State='BO' porque el waitlist v568 los skipeo por dispSap=0.
        # Precio y desc se resuelven en el frontend con PRICE_LIST_MAP + PRODUCTS.
        lines.append({
            "code": code,
            "desc": it.get("desc") or "",
            "cat": "", "fam": "", "sub": "",
            "qty": qty,
            "precio": float(it.get("precio") or 0),
            "needsReview": False,
            "qtyOpen": qty,
            "qtyInvoiced": 0,
            "qtyCancelled": 0,
            "qtyRecycled": 0,
            "qtyExpired": 0,
            "state": "BO",
            "asigAt": None,
            "expiredAt": None,
            "recycledIntoPedidoId": None,
            "priceAtCreation": float(it.get("precio") or 0),
        })

    key = f"C|{province}|{loc_name}|{client_name}"

    doc_data = {
        "ownerUid": owner_uid,
        "ownerEmail": owner_email,
        "ownerVendor": owner_vendor,
        "createdByUid": owner_uid,
        "createdByEmail": owner_email,
        "createdByDisplayName": wl_data.get("ownerDisplayName") or owner_email,
        "onBehalfOf": False,
        "stage": "pending",
        "key": key,
        "tipo": "C",
        "province": province,
        "locName": loc_name,
        "clientName": client_name,
        "clientCardCode": card_code,
        "month": _month_label(now_dt),
        "monthIdx": now_dt.month - 1,
        "year": now_dt.year,
        "confirmedAt": now_iso,
        "condicionPago": wl_data.get("formaPago") or "",
        "formaEntrega": {"tipo": "", "transpNombre": "", "transpDireccion": "",
                         "clienteDireccion": "", "sucursalDireccion": "",
                         "retiroNombre": "", "retiroApellido": "", "retiroDni": "", "retiroPatente": ""},
        "lines": lines,
        "hasSkusToReview": False,
        "skusToReviewCount": 0,
        "subtotalArs": int(sum(l["qty"] * l["precio"] for l in lines)),
        "netAmountArs": int(sum(l["qty"] * l["precio"] for l in lines)),
        "discountPct": 0,
        "discountSnapshot": None,
        "schemaVersion": 2,
        "sapLinkage": {"soDocEntry": None, "lastInvoiceDocEntry": None, "lastSyncAt": None, "appliedInvoiceDocEntries": []},
        "closedAt": None,
        "closedReason": None,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "orderNumber": order_number,
        # Marcar como migrado desde waitlist para trazabilidad.
        "migratedFromWaitlist": True,
        "migratedFromWaitlistId": None,  # se completa abajo por doc
        "migratedAt": now_iso,
        "migratedReason": "v568-cleanup-2026-08-21",
    }
    return doc_data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Escribe cambios")
    args = ap.parse_args()

    if not os.path.exists(SA_PATH):
        print(f"ERROR SA no encontrado: {SA_PATH}", file=sys.stderr)
        sys.exit(1)
    firebase_admin.initialize_app(credentials.Certificate(SA_PATH))
    db = firestore.client()

    print(f"[{'APPLY' if args.apply else 'DRY-RUN'}] Migracion waitlist -> pedidos BO\n")

    for wl_id in WAITLIST_IDS:
        wl_ref = db.collection("revision_waitlist").document(wl_id)
        wl_snap = wl_ref.get()
        if not wl_snap.exists:
            print(f"  [SKIP] {wl_id}: no existe. SKIP.")
            continue
        wl_data = wl_snap.to_dict() or {}
        client_name = wl_data.get("clientName") or "?"
        items = wl_data.get("items") or []
        print(f"\n-> {wl_id} - {client_name} - orden {wl_data.get('orderNumber', '?')}")
        print(f"  {len(items)} items -> se crearan como lineas state='BO'")

        pedido_doc = build_pedido_doc(wl_data)
        pedido_doc["migratedFromWaitlistId"] = wl_id
        print(f"  Nuevo pedido: {len(pedido_doc['lines'])} lineas, subtotal $0 (precios a resolver desde catalogo)")

        if not args.apply:
            continue

        # Crear pedido nuevo
        pedido_ref = db.collection("pedidos").add(pedido_doc)
        pedido_id = pedido_ref[1].id
        print(f"  [OK] Pedido creado: {pedido_id}")

        # Borrar waitlist doc
        wl_ref.delete()
        print(f"  [OK] Waitlist doc {wl_id} eliminado")

    if not args.apply:
        print("\n(dry-run — sin cambios. Correr con --apply para persistir)")
    else:
        print("\n[APPLY] Migracion completa. Recorda correr scripts/rebuild_stock_snapshot_app.py --apply")
        print("        para popular backorderByClientSkuApp inmediato (sin esperar CF E3).")


if __name__ == "__main__":
    main()
