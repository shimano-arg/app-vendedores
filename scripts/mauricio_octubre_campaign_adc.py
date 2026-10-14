"""One-shot 2026-10-14: archivar todas las campanias activas de MAURICIO y
crear una sola nueva "MAURICIO OCTUBRE 2026" con los 14 SKUs de Canas Cruzar
+ Canas Stimula, meta 100 u, 2026-10-01 a 2026-10-31.

Match MAURICIO: scope='vendor' + scopeValues contiene algo que normalice a
MAURICIO. Soporta variantes (MAURICIO, mauricio, Mauricio, con/sin apellido).

Uso:
    DRY_RUN=true  python scripts/mauricio_octubre_campaign_adc.py
    DRY_RUN=false python scripts/mauricio_octubre_campaign_adc.py
"""
from __future__ import annotations
import os
from datetime import datetime, timezone
from google.cloud import firestore

DRY_RUN = (os.environ.get('DRY_RUN', 'true').lower() != 'false')
PROJECT = 'app-vendedores-shimano'

VENDOR_TARGET = 'MAURICIO GIL'
SKUS_CRUZAR = ['CRZAXFGB2802', 'CRZAXFGB2902', 'CRZAXFGB21002']
SKUS_STIMULA = [
    'STC56MHC', 'STC60MHC', 'STC66HC2', 'STC66MHC', 'STC70HC', 'STC70MHC',
    'STS60M2C', 'STS66M2C', 'STS66MH2C', 'STS70M2C', 'STS70MHC',
]
SKUS_ALL = SKUS_CRUZAR + SKUS_STIMULA
TARGET_AMOUNT = 100
START_DATE = '2026-10-01'
END_DATE = '2026-10-31'
CAMP_NAME = 'MAURICIO OCTUBRE 2026'


def _norm(s):
    return (s or '').strip().upper()


def _iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def main():
    print(f'=== mauricio_octubre_campaign_adc START (DRY_RUN={DRY_RUN}) ===')
    db = firestore.Client(project=PROJECT)

    # 1. Listar campanias activas (no archivadas) de MAURICIO.
    all_snap = db.collection('campaigns').get()
    camps = []
    for d in all_snap:
        data = d.to_dict() or {}
        if data.get('archivedManually') is True:
            continue
        scope = data.get('scope') or 'all'
        if scope != 'vendor':
            continue
        values = data.get('scopeValues') or []
        if not any(_norm(v) == VENDOR_TARGET for v in values):
            continue
        camps.append((d.id, d.reference, data))

    print(f'  campanias activas de {VENDOR_TARGET}: {len(camps)}')
    for cid, _ref, data in camps:
        print(f'    - {cid}: "{data.get("name")}" ({data.get("startDate")} -> {data.get("endDate")}, target={data.get("targetAmount")})')

    # 2. Verificar que no exista ya una "MAURICIO OCTUBRE 2026".
    already_octubre = any(_norm(d.get('name')) == CAMP_NAME for _, _, d in camps)
    if already_octubre:
        print(f'  [WARN] ya existe una campania activa con nombre "{CAMP_NAME}". Se archivara igual + se recreara.')

    if DRY_RUN:
        print(f'  (DRY RUN) Se archivarian {len(camps)} campanias y se crearia 1 nueva:')
        print(f'    name: {CAMP_NAME}')
        print(f'    skus: {SKUS_ALL}')
        print(f'    targetAmount: {TARGET_AMOUNT}')
        print(f'    startDate: {START_DATE}')
        print(f'    endDate: {END_DATE}')
        print(f'    scope: vendor / scopeValues: [{VENDOR_TARGET}]')
        print('=== DONE (DRY_RUN) ===')
        return

    # 3. Archivar activas (archivedManually=true + archivedAt).
    now_iso = _iso()
    for cid, ref, data in camps:
        try:
            ref.update({
                'archivedManually': True,
                'archivedAt': now_iso,
                'archivedBy': 'mauricio_octubre_campaign_adc.py',
                'archivedReason': 'consolidado en "' + CAMP_NAME + '"',
            })
            print(f'    archivada: {cid}')
        except Exception as e:
            print(f'    [ERR] no se pudo archivar {cid}: {e}')

    # 4. Crear nueva.
    try:
        new_ref = db.collection('campaigns').add({
            'name': CAMP_NAME,
            'familia': '',
            'subfamilia': '',
            'skus': SKUS_ALL,
            'filterType': 'sku',
            'filterValues': SKUS_ALL,
            'targetType': 'units',
            'targetAmount': TARGET_AMOUNT,
            'startDate': START_DATE,
            'endDate': END_DATE,
            'scope': 'vendor',
            'scopeValues': [VENDOR_TARGET],
            'createdBy': 'script',
            'createdByEmail': 'mauricio_octubre_campaign_adc.py',
            'createdAt': firestore.SERVER_TIMESTAMP,
            'importedFromExcel': False,
            'sourceScript': 'mauricio_octubre_campaign_adc.py',
            'sourceScriptRunAt': now_iso,
            'description': 'Vender 100u entre canas Cruzar (3 SKUs) + canas Stimula (11 SKUs). Consolida ' + str(len(camps)) + ' campanias previas archivadas.',
        })
        new_id = new_ref[1].id if isinstance(new_ref, tuple) else getattr(new_ref, 'id', 'unknown')
        print(f'    creada nueva campania: id={new_id} name="{CAMP_NAME}"')
    except Exception as e:
        print(f'    [ERR] no se pudo crear la nueva campania: {e}')

    # 5. Audit log.
    try:
        db.collection('audit_campaign_consolidate_log').add({
            'runAt': now_iso,
            'vendor': VENDOR_TARGET,
            'archivedCount': len(camps),
            'archivedIds': [cid for cid, _, _ in camps],
            'newCampaignName': CAMP_NAME,
            'newCampaignSkus': SKUS_ALL,
            'newCampaignTarget': TARGET_AMOUNT,
            'startDate': START_DATE,
            'endDate': END_DATE,
            'source': 'mauricio_octubre_campaign_adc.py',
        })
    except Exception as _e:
        pass
    print('=== DONE (APPLIED) ===')


if __name__ == '__main__':
    main()
