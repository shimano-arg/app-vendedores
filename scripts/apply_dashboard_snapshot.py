"""Bootstrap del snapshot BQ -> Firestore para el Dashboard de la app.
Corre sync_dashboard_snapshot_to_firestore() aislado del script principal
(sin hacer todo el fetch SL de invoices/quotations/etc).

Uso:
    python scripts/apply_dashboard_snapshot.py

Requiere:
- ~/Desktop/sa-key.json con service account que tiene BQ Read + Firestore Write.
- Las vistas v_facturas_sap y v_ventas_lineas ya deployadas (ya lo estan post
  apply_credit_notes_fix.py 2026-07-30).

Despues de este bootstrap, el cron GH Actions llama a
sync_dashboard_snapshot_to_firestore() al final de sync_sap_to_bigquery.py
en cada corrida (13,43 * * * *).
"""
import json
import os
import sys
from pathlib import Path
from google.cloud import bigquery
from google.oauth2 import service_account

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY_PATH.read_text()

from sync_sap_to_bigquery import (  # noqa: E402
    parse_sa_json,
    init_firestore,
    init_bigquery,
    sync_dashboard_snapshot_to_firestore,
)

print('=' * 70)
print('Bootstrap sap_snapshot (BQ -> Firestore)')
print('=' * 70)

sa_data = parse_sa_json()
db = init_firestore(sa_data)
bq_client = init_bigquery(sa_data)

written = sync_dashboard_snapshot_to_firestore(bq_client, db, dry_run=False)
print(f'\n>>> DONE. {written} docs en sap_snapshot para el año actual.')
print('    La app leera esta coleccion para mostrar facturado SAP en el Dashboard.')

# Verify: leer 1 doc de ejemplo (Gonzalo julio 2026 si existe).
print()
print('=' * 70)
print('VERIFY: leer sap_snapshot/GONZALO_DE_LA_ROSA_2026_07')
print('=' * 70)
doc = db.collection('sap_snapshot').document('GONZALO_DE_LA_ROSA_2026_07').get()
if doc.exists:
    d = doc.to_dict()
    print(f'  vendorKey:            {d.get("vendorKey")}')
    print(f'  anio / mes:           {d.get("anio")} / {d.get("mes")}')
    print(f'  facturadoArsNeto:     ${d.get("facturadoArsNeto"):>15,.2f}')
    print(f'  facturadoArsBruto:    ${d.get("facturadoArsBruto"):>15,.2f}')
    print(f'  ncsArs:               ${d.get("ncsArs"):>15,.2f}')
    print(f'  unidadesNeto:         {d.get("unidadesNeto"):>15,.2f}')
    print(f'  facturas / ncs count: {d.get("facturasCount")} / {d.get("ncsCount")}')
else:
    print('  (no existe — verificar que Gonzalo tenga facturas SAP en jul 2026)')
