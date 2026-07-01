"""
Sync SAP -> Firestore via Service Layer (SL).

Este script REEMPLAZA al viejo sync_stock.py (que dependia del CSV que David
subia a Drive, ya en desuso). Corre cada 30 min via GitHub Actions y hace:

  1) Login en SAP B1 Service Layer (creds leidas de Firestore
     app_config/sap_integration.serviceLayer).
  2) Descarga TODOS los items del maestro (Items?$select=ItemCode,ItemName,
     ItemWarehouseInfoCollection) paginando via @odata.nextLink. SL bloquea
     el header 'Prefer' asi que la pagina queda en ~20 items.
  3) Por cada item calcula el stock TOTAL vendible = suma de InStock en todos
     los warehouses EXCEPTO 05 (Marketing) y 06 (Devoluciones). Idem al
     cliente web (sapSL.getAllStock con whsCode='ALL').
  4) Escribe a Firestore:
       - product_catalog/chunk_N       (items en chunks de 4000)
       - app_config/product_catalog_meta  (syncBatchId + total)
       - app_config/stock_snapshot     ({stock: {sku: bool}, ...})
     Los listeners del cliente (ensureProductCatalogListener,
     ensureStockSnapshotListener) reaccionan solos y actualizan la UI en
     tiempo real sin necesidad de reload.

Preserva los campos fam/sub/cat de los items del catalog existente en
Firestore para no perder la categorizacion ya cargada manualmente (el sync
manual del cliente hace lo mismo pero contra PRODUCTS en memoria).

Env vars requeridas:
  FIREBASE_SERVICE_ACCOUNT  JSON del service account con permisos rw en
                            Firestore. Se guarda como GitHub Secret.
Env vars opcionales:
  DRY_RUN                   'true' -> no escribe a Firestore (para test)
  SL_INSECURE               'true' -> desactiva verify de cert SSL (solo si
                            el SL tiene cert self-signed y falla el verify)
  SL_MAX_ITEMS              cap de items para test (default: sin cap)

Se saltea el sync silenciosamente si:
  - serviceLayer.enabled es false en Firestore
  - falta alguna credencial
  - login falla
"""
import base64
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests
from urllib3.exceptions import InsecureRequestWarning

# firebase_admin viene de firebase-admin package
try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print('[ERROR] firebase-admin no instalado. pip install firebase-admin', file=sys.stderr)
    sys.exit(2)


# Warehouses que EXCLUIMOS al sumar stock (no son vendibles):
#   '05' MARKETING, '06' DEVOLUCIONES.
# Todos los demas suman.
NON_SALES_WHS = {'05', '06'}

# Bugs de la Service Layer: si mandamos Prefer no anda por CORS + SL v10 lo
# rechaza. Sin Prefer, SL responde con pageSize=20. Con ~11k items = ~550
# requests. A 200-300 ms cada uno = 2-3 min. Aceptable para un cron 30 min.
CHUNK_SIZE_FS = 4000  # items por doc de Firestore (~1 MB max por doc)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(msg: str) -> None:
    print(f'[{now_iso()}] {msg}', flush=True)


def init_firebase() -> firestore.Client:
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if not sa_json:
        log('[FATAL] FIREBASE_SERVICE_ACCOUNT env var vacia')
        sys.exit(2)
    # Base64 opcional (GitHub Secrets a veces se rompen con newlines en JSON).
    if not sa_json.startswith('{'):
        try:
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        except Exception:
            pass
    try:
        sa_data = json.loads(sa_json)
    except json.JSONDecodeError as e:
        log(f'[FATAL] FIREBASE_SERVICE_ACCOUNT no es JSON valido: {e}')
        sys.exit(2)
    cred = credentials.Certificate(sa_data)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def get_sl_config(db: firestore.Client) -> dict:
    """Lee app_config/sap_integration.serviceLayer de Firestore."""
    snap = db.collection('app_config').document('sap_integration').get()
    if not snap.exists:
        log('[FATAL] app_config/sap_integration no existe en Firestore')
        sys.exit(2)
    data = snap.to_dict() or {}
    sl = data.get('serviceLayer') or {}
    if not sl.get('enabled'):
        log('[SKIP] serviceLayer.enabled = false. No corro sync.')
        sys.exit(0)
    required = ('url', 'companyDB', 'username', 'password')
    missing = [k for k in required if not sl.get(k)]
    if missing:
        log(f'[SKIP] Faltan credenciales SL en Firestore: {missing}')
        sys.exit(0)
    return {
        'url': sl['url'].rstrip('/'),
        'companyDB': sl['companyDB'],
        'username': sl['username'],
        'password': sl['password'],
    }


def sl_login(cfg: dict, session: requests.Session) -> None:
    """Hace login y guarda la cookie B1SESSION en session.cookies."""
    endpoint = f"{cfg['url']}/b1s/v1/Login"
    resp = session.post(
        endpoint,
        json={
            'CompanyDB': cfg['companyDB'],
            'UserName': cfg['username'],
            'Password': cfg['password'],
        },
        timeout=30,
    )
    if not resp.ok:
        try:
            detail = resp.json().get('error', {}).get('message', {}).get('value', '')
        except Exception:
            detail = resp.text[:200]
        log(f'[FATAL] Login SL fallo: HTTP {resp.status_code} - {detail}')
        sys.exit(3)
    log('[SL] login OK')


def sl_fetch_items_and_stock(cfg: dict, session: requests.Session, max_items: int = 0):
    """
    Itera Items?$select=ItemCode,ItemName,ItemWarehouseInfoCollection paginando.
    Devuelve (items, stock_map, scanned, with_stock) donde:
      items:      lista de {code, desc}
      stock_map:  dict {ItemCode: bool}  (True = hay stock en algun whs vendible)
      scanned:    total de items iterados
      with_stock: total con stock > 0
    """
    items = []
    stock_map = {}
    scanned = 0
    with_stock = 0

    # Path inicial. nextLink es un path relativo tipo 'Items?$skip=20&$top=20'
    # o a veces URL completa. Lo normalizamos a path absoluto.
    path = "/b1s/v1/Items?$select=ItemCode,ItemName,ItemWarehouseInfoCollection"
    page_count = 0
    last_progress_log = time.time()

    while path:
        url = path if path.startswith('http') else f"{cfg['url']}{path}"
        try:
            resp = session.get(url, timeout=60)
        except requests.RequestException as e:
            log(f'[SL] error de red en pagina {page_count}: {e}. Retry en 5s.')
            time.sleep(5)
            resp = session.get(url, timeout=60)

        if resp.status_code == 401:
            log('[SL] 401 - re-login y retry')
            sl_login(cfg, session)
            resp = session.get(url, timeout=60)

        if not resp.ok:
            try:
                detail = resp.json().get('error', {}).get('message', {}).get('value', '')
            except Exception:
                detail = resp.text[:200]
            log(f'[FATAL] SL error HTTP {resp.status_code} - {detail}. Path: {path}')
            sys.exit(4)

        body = resp.json()
        arr = body.get('value', []) or []

        for it in arr:
            code = (it.get('ItemCode') or '').strip()
            if not code:
                continue
            name = (it.get('ItemName') or '').strip()
            whs_list = it.get('ItemWarehouseInfoCollection') or []
            total_qty = 0.0
            for w in whs_list:
                whs_code = w.get('WarehouseCode') or ''
                if whs_code in NON_SALES_WHS:
                    continue
                try:
                    total_qty += float(w.get('InStock') or 0)
                except (TypeError, ValueError):
                    pass
            has_stk = total_qty > 0
            items.append({'code': code, 'desc': name})
            stock_map[code] = has_stk
            scanned += 1
            if has_stk:
                with_stock += 1
            if max_items and scanned >= max_items:
                log(f'[SL] cap de {max_items} alcanzado (test)')
                return items, stock_map, scanned, with_stock

        page_count += 1
        # Progress log cada 5 segundos
        if time.time() - last_progress_log > 5:
            log(f'[SL] pag {page_count}: {scanned} items ({with_stock} con stock)')
            last_progress_log = time.time()

        next_link = body.get('@odata.nextLink') or body.get('odata.nextLink')
        if not next_link:
            break
        if next_link.startswith('http'):
            idx = next_link.find('/b1s/v1/')
            path = next_link[idx:] if idx >= 0 else next_link
        elif next_link.startswith('/'):
            path = next_link
        else:
            path = '/b1s/v1/' + next_link

        # Safety cap absoluto
        if scanned > 50000:
            log('[SL] safety cap 50k alcanzado, cortando iteracion')
            break

    log(f'[SL] termino: {scanned} items, {with_stock} con stock, {page_count} paginas')
    return items, stock_map, scanned, with_stock


def load_existing_catalog(db: firestore.Client) -> dict:
    """
    Trae los chunks actuales de product_catalog y arma {code: {cat, fam, sub}}
    para preservar la categorizacion ya cargada. El sync del cliente hace lo
    mismo pero contra PRODUCTS en memoria (que a su vez viene del CSV/repo).
    """
    existing = {}
    try:
        docs = db.collection('product_catalog').stream()
        for d in docs:
            data = d.to_dict() or {}
            for it in data.get('items', []) or []:
                code = it.get('code')
                if not code:
                    continue
                # Solo guardamos si hay algo util
                if it.get('cat') or it.get('fam') or it.get('sub'):
                    existing[code] = {
                        'cat': it.get('cat') or '',
                        'fam': it.get('fam') or '',
                        'sub': it.get('sub') or '',
                    }
    except Exception as e:
        log(f'[WARN] load_existing_catalog: {e} - sigo sin merge')
    log(f'[merge] {len(existing)} items con categorizacion previa')
    return existing


def write_catalog(db: firestore.Client, items: list, existing_meta: dict) -> tuple:
    """Escribe product_catalog/chunk_N + app_config/product_catalog_meta.
    Devuelve (sync_batch_id, total_chunks)."""
    merged = []
    for it in items:
        code = it['code']
        prev = existing_meta.get(code) or {}
        merged.append({
            'code': code,
            'desc': it['desc'],
            'fam': prev.get('fam', ''),
            'sub': prev.get('sub', ''),
            'cat': prev.get('cat', ''),
        })

    sync_batch_id = 'SYNC-AUTO-' + str(int(time.time() * 1000))
    chunks = [merged[i:i + CHUNK_SIZE_FS] for i in range(0, len(merged), CHUNK_SIZE_FS)]
    total_chunks = len(chunks)

    if os.environ.get('DRY_RUN', '').lower() == 'true':
        log(f'[DRY_RUN] escribiria {len(merged)} items en {total_chunks} chunks')
        return sync_batch_id, total_chunks

    # Escribir chunks (batch = max 500 writes; 3 chunks encajan holgado)
    batch = db.batch()
    for idx, chunk in enumerate(chunks):
        ref = db.collection('product_catalog').document(f'chunk_{idx}')
        batch.set(ref, {
            'items': chunk,
            'chunkIdx': idx,
            'totalChunks': total_chunks,
            'syncBatchId': sync_batch_id,
            'updatedAt': firestore.SERVER_TIMESTAMP,
        })
    batch.commit()
    log(f'[FS] {total_chunks} chunks escritos')

    # Metadata (dispara el listener del cliente)
    db.collection('app_config').document('product_catalog_meta').set({
        'totalItems': len(merged),
        'totalChunks': total_chunks,
        'syncBatchId': sync_batch_id,
        'updatedAt': firestore.SERVER_TIMESTAMP,
        'updatedBy': 'github-actions/sync_sap_to_firestore',
    })

    # Cleanup: si el sync anterior tenia N chunks y este M < N, borrar los de mas.
    try:
        stale = []
        for d in db.collection('product_catalog').stream():
            data = d.to_dict() or {}
            idx = data.get('chunkIdx')
            if idx is None or idx >= total_chunks:
                stale.append(d.reference)
        for ref in stale:
            try:
                ref.delete()
            except Exception:
                pass
        if stale:
            log(f'[FS] borre {len(stale)} chunks huerfanos')
    except Exception as e:
        log(f'[WARN] cleanup chunks: {e}')

    return sync_batch_id, total_chunks


def write_stock_snapshot(db: firestore.Client, stock_map: dict, with_stock: int) -> str:
    sync_batch_id = 'SYNC-STOCK-AUTO-' + str(int(time.time() * 1000))
    if os.environ.get('DRY_RUN', '').lower() == 'true':
        log(f'[DRY_RUN] escribiria stock_snapshot con {len(stock_map)} SKUs ({with_stock} con stock)')
        return sync_batch_id
    db.collection('app_config').document('stock_snapshot').set({
        # Key 'stock' compatible con el listener existente ensureStockSnapshotListener.
        'stock': stock_map,
        'totalItems': len(stock_map),
        'withStock': with_stock,
        'warehouse': 'ALL_SALES',
        'source': 'service_layer_auto',
        'updatedAt': firestore.SERVER_TIMESTAMP,
        'updatedBy': 'github-actions/sync_sap_to_firestore',
        'syncBatchId': sync_batch_id,
    })
    log(f'[FS] stock_snapshot escrito: {len(stock_map)} SKUs, {with_stock} con stock')
    return sync_batch_id


def main() -> int:
    t_start = time.time()
    log('=== SAP -> Firestore sync start ===')

    db = init_firebase()
    sl_cfg = get_sl_config(db)

    session = requests.Session()
    verify_ssl = os.environ.get('SL_INSECURE', '').lower() != 'true'
    session.verify = verify_ssl
    if not verify_ssl:
        requests.packages.urllib3.disable_warnings(InsecureRequestWarning)
        log('[SL] verify SSL DESHABILITADO (SL_INSECURE=true)')

    try:
        sl_login(sl_cfg, session)
    except requests.exceptions.SSLError as e:
        log(f'[SL] SSL error: {e}. Reintento con verify=False (temporal).')
        session.verify = False
        requests.packages.urllib3.disable_warnings(InsecureRequestWarning)
        sl_login(sl_cfg, session)

    max_items = int(os.environ.get('SL_MAX_ITEMS', '0') or 0)
    items, stock_map, scanned, with_stock = sl_fetch_items_and_stock(sl_cfg, session, max_items=max_items)

    if scanned == 0:
        log('[FATAL] SL devolvio 0 items. No escribo nada para no pisar datos buenos.')
        return 5

    # Catalogo: mergea con existente para preservar cat/fam/sub
    existing = load_existing_catalog(db)
    write_catalog(db, items, existing)
    write_stock_snapshot(db, stock_map, with_stock)

    elapsed = time.time() - t_start
    log(f'=== OK. {scanned} items, {with_stock} con stock. {elapsed:.1f}s ===')

    # Logout best-effort
    try:
        session.post(f"{sl_cfg['url']}/b1s/v1/Logout", timeout=10)
    except Exception:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
