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

# Codigo de la lista de precios "PESCA" en SAP (Administration > Setup >
# Inventory > Price Lists). Confirmado 2026-07-06: es #12 en ARS con
# factor 1 y base = PESCA. Es la que corresponde a los vendedores de
# pesca. Si en algun momento renumeran las listas en SAP, actualizar
# aca (o mover a env var / lookup dinamico por nombre).
PESCA_PRICE_LIST_NUM = 12

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


def resolve_pesca_group_code(cfg: dict, session: requests.Session) -> int:
    """
    Resuelve dinamicamente el ItemsGroupCode (numerico) del grupo PESCA
    consultando /ItemGroups?$filter=GroupName eq 'PESCA'.

    Devuelve int. Si no encuentra, aborta con FATAL.

    Se hace lookup dinamico en vez de hardcodear el numero porque:
     - Si en SAP renombran/renumeran el grupo, no rompemos silenciosamente.
     - Si en TEST y PROD el numero difiere, no hace falta cambiar el script.
     - Deja explicito en el log cual es el grupo actual.
    """
    path = "/b1s/v1/ItemGroups?$filter=GroupName eq 'PESCA'&$select=Number,GroupName"
    resp = session.get(f"{cfg['url']}{path}", timeout=30)
    if not resp.ok:
        try:
            detail = resp.json().get('error', {}).get('message', {}).get('value', '')
        except Exception:
            detail = resp.text[:200]
        log(f"[FATAL] no pude resolver grupo PESCA: HTTP {resp.status_code} - {detail}")
        sys.exit(6)
    body = resp.json()
    arr = body.get('value', []) or []
    if not arr:
        log(f"[FATAL] no existe un grupo llamado 'PESCA' en SAP. Chequear Administration > Setup > Inventory > Item Groups.")
        sys.exit(6)
    if len(arr) > 1:
        log(f"[WARN] {len(arr)} grupos matchean 'PESCA', tomo el primero: {arr[0]}")
    grupo = arr[0]
    number = grupo.get('Number')
    log(f"[grupo] PESCA resuelto: Number={number} (GroupName='{grupo.get('GroupName')}')")
    return int(number)


def sl_fetch_items_and_stock(cfg: dict, session: requests.Session, max_items: int = 0):
    """
    Itera Items del grupo PESCA (filtrado server-side) con
    ?$select=ItemCode,ItemName,ItemWarehouseInfoCollection paginando.
    Devuelve (items, stock_map, qty_map, scanned, with_stock) donde:
      items:      lista de {code, desc}
      stock_map:  dict {ItemCode: bool}
      qty_map:    dict {ItemCode: int}
      scanned:    total de items iterados
      with_stock: total con stock > 0
    """
    items = []
    stock_map = {}       # {sku: bool}
    qty_map = {}         # {sku: int}
    price_map = {}       # {sku: float}   precio en ARS de la lista PESCA (#12)
    scanned = 0
    with_stock = 0
    with_price = 0

    # Filtrar por el grupo PESCA server-side. Antes traiamos TODOS los items
    # (~10.700) y despues filtrabamos client-side usando el CSV inline de
    # index.html (~665). Problema: cualquier SKU nuevo de pesca (ej. SJCM70HB
    # Shimano Sojourn) que no estaba en el CSV inline quedaba invisible en
    # la app aunque estuviera en PESCA en SAP.
    # Fix: filtrar por ItemsGroupCode eq <numero_de_pesca> directamente.
    # Ademas es mas eficiente: bajamos de ~530 requests paginados a ~100.
    pesca_group_code = resolve_pesca_group_code(cfg, session)
    # ItemPrices trae los precios en TODAS las listas para cada item.
    # Filtramos por la lista PESCA (#12 en SAP, ARS) mas abajo cuando
    # iteramos ItemPrices.
    path = (
        "/b1s/v1/Items"
        f"?$filter=ItemsGroupCode eq {pesca_group_code}"
        "&$select=ItemCode,ItemName,ItemWarehouseInfoCollection,ItemPrices"
    )
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
            # Cantidad total en entero (SAP no maneja fracciones de items). La
            # guardamos separada del bool para no romper el listener actual
            # que espera stock_map[sku] = bool.
            qty_map[code] = int(round(total_qty))
            # Extraer el precio de la lista PESCA (#12 en SAP, ARS). Si el
            # SKU no tiene precio cargado en esa lista, no lo agregamos al
            # map -> el frontend lo muestra como '(sin precio)'. En SAP,
            # cuando no hay precio, ItemPrices puede tener Price=null o 0.
            # Solo escribimos si hay un precio > 0.
            for ip in (it.get('ItemPrices') or []):
                if ip.get('PriceList') == PESCA_PRICE_LIST_NUM:
                    price = ip.get('Price')
                    if price is not None and price != 0:
                        try:
                            price_map[code] = float(price)
                            with_price += 1
                        except (TypeError, ValueError):
                            pass
                    break
            scanned += 1
            if has_stk:
                with_stock += 1
            if max_items and scanned >= max_items:
                log(f'[SL] cap de {max_items} alcanzado (test)')
                return items, stock_map, qty_map, price_map, scanned, with_stock, with_price

        page_count += 1
        # Progress log cada 5 segundos
        if time.time() - last_progress_log > 5:
            log(f'[SL] pag {page_count}: {scanned} items ({with_stock} stock, {with_price} precio)')
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

    log(f'[SL] termino: {scanned} items, {with_stock} con stock, {with_price} con precio, {page_count} paginas')
    return items, stock_map, qty_map, price_map, scanned, with_stock, with_price


def load_local_categorization_from_html() -> dict:
    """
    Extrae el mapa {code: {cat, fam, sub}} desde el CSV inline `const PRODUCTS =
    [...]` en index.html del repo. Este CSV es la fuente de verdad de la
    categorizacion (cargada a mano por el equipo de pesca). El script del server
    la usa asi no borra las categorias cuando escribe el catalogo desde SAP.

    Retorna dict vacio si no encuentra la linea (no critico, seguiria escribiendo
    sin cat/fam/sub y el catalogo quedaria plano).
    """
    result = {}
    html_path = os.path.join(os.path.dirname(__file__), '..', 'index.html')
    html_path = os.path.abspath(html_path)
    if not os.path.exists(html_path):
        log(f'[WARN] index.html no encontrado en {html_path}, no puedo leer categorias locales')
        return result
    try:
        # PRODUCTS es una asignacion de una sola linea larga:
        # const PRODUCTS = [{"code":"...","desc":"...","cat":"...","fam":"...","sub":"..."},...];
        with open(html_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                stripped = line.lstrip()
                if stripped.startswith('const PRODUCTS = ['):
                    json_part = stripped[len('const PRODUCTS = '):].rstrip()
                    if json_part.endswith(';'):
                        json_part = json_part[:-1]
                    try:
                        arr = json.loads(json_part)
                    except json.JSONDecodeError as e:
                        log(f'[WARN] no pude parsear PRODUCTS inline: {e}')
                        return result
                    for p in arr:
                        code = (p.get('code') or '').strip()
                        if not code:
                            continue
                        if p.get('cat') or p.get('fam') or p.get('sub'):
                            result[code] = {
                                'cat': p.get('cat') or '',
                                'fam': p.get('fam') or '',
                                'sub': p.get('sub') or '',
                            }
                    break
    except Exception as e:
        log(f'[WARN] load_local_categorization_from_html: {e}')
    log(f'[merge/local] {len(result)} items con categorizacion en index.html')
    return result


def load_existing_catalog(db: firestore.Client) -> dict:
    """
    Trae los chunks actuales de product_catalog y arma {code: {cat, fam, sub}}
    para preservar categorizacion ya cargada. Se usa como capa 2 (fallback si
    el CSV inline no tiene el item).
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
                if it.get('cat') or it.get('fam') or it.get('sub'):
                    existing[code] = {
                        'cat': it.get('cat') or '',
                        'fam': it.get('fam') or '',
                        'sub': it.get('sub') or '',
                    }
    except Exception as e:
        log(f'[WARN] load_existing_catalog: {e} - sigo sin merge Firestore')
    log(f'[merge/firestore] {len(existing)} items con categorizacion previa en Firestore')
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


def write_price_list(db: firestore.Client, price_map: dict) -> str:
    """
    Escribe la lista de precios (SKU -> ARS float) a
    app_config/price_list en Firestore. El cliente la lee via
    ensurePriceListListener y actualiza PRICE_LIST_MAP en tiempo real.

    Estructura escrita (compatible con el listener actual):
      {
        prices: {SKU: number, ...},
        currency: 'ARS',
        source: 'service_layer_auto',
        updatedAt: SERVER_TIMESTAMP,
        updatedBy: '<script>',
        totalSkus: int,
        priceListName: 'PESCA',
        priceListNum: 12,
      }

    Antes de v268 los precios se cargaban manualmente por CSV desde el
    modal admin. Ahora vienen automatic desde SAP cada 30 min.
    """
    sync_batch_id = 'SYNC-PRICE-AUTO-' + str(int(time.time() * 1000))
    if os.environ.get('DRY_RUN', '').lower() == 'true':
        log(f'[DRY_RUN] escribiria price_list con {len(price_map)} SKUs')
        return sync_batch_id
    db.collection('app_config').document('price_list').set({
        'prices': price_map,
        'currency': 'ARS',
        'source': 'service_layer_auto',
        'updatedAt': firestore.SERVER_TIMESTAMP,
        'updatedBy': 'github-actions/sync_sap_to_firestore',
        'totalSkus': len(price_map),
        'priceListName': 'PESCA',
        'priceListNum': PESCA_PRICE_LIST_NUM,
        'syncBatchId': sync_batch_id,
    })
    log(f'[FS] price_list escrito: {len(price_map)} SKUs con precio ARS (lista PESCA #{PESCA_PRICE_LIST_NUM})')
    return sync_batch_id


def write_stock_snapshot(db: firestore.Client, stock_map: dict, qty_map: dict, with_stock: int) -> str:
    sync_batch_id = 'SYNC-STOCK-AUTO-' + str(int(time.time() * 1000))
    if os.environ.get('DRY_RUN', '').lower() == 'true':
        log(f'[DRY_RUN] escribiria stock_snapshot con {len(stock_map)} SKUs ({with_stock} con stock, con cantidades)')
        return sync_batch_id
    # Firestore tiene un limite HARD de ~40.000 index entries por documento.
    # Cada map field indexa cada key automaticamente. Con stock (10.684 entries)
    # + quantities (otras 10.684 como map) exedemos el limite y falla con
    # INDEX_ENTRIES_COUNT_LIMIT_EXCEEDED. Serializar quantities como string
    # JSON evita el problema: Firestore no indexa el contenido de un string.
    # El cliente hace JSON.parse cuando lo lee (~200 KB, negligible).
    qty_json = json.dumps(qty_map, separators=(',', ':'), ensure_ascii=True)
    db.collection('app_config').document('stock_snapshot').set({
        # Key 'stock' compatible con el listener existente ensureStockSnapshotListener.
        'stock': stock_map,
        # Key 'quantities' como STRING JSON (no map) para evitar el limite
        # de 40k index entries de Firestore.
        'quantities': qty_json,
        'totalItems': len(stock_map),
        'withStock': with_stock,
        'warehouse': 'ALL_SALES',
        'source': 'service_layer_auto',
        'updatedAt': firestore.SERVER_TIMESTAMP,
        'updatedBy': 'github-actions/sync_sap_to_firestore',
        'syncBatchId': sync_batch_id,
    })
    log(f'[FS] stock_snapshot escrito: {len(stock_map)} SKUs, {with_stock} con stock (quantities JSON string, {len(qty_json)} bytes)')
    return sync_batch_id


def write_stock_json_for_bot(stock_map: dict, with_stock: int) -> bool:
    """
    Escribe stock.json en la raiz del repo para que el Google Sheet
    "Inventario-Bot" (que consume desde GitHub Pages) tenga datos frescos.
    Devuelve True si el file cambio (y el workflow deberia commitearlo),
    False si es identico al existente (skip commit para no ensuciar historial).

    Historia: esta ruta existia con sync_stock.py (deprecado, dependia de un
    CSV que David subia a Drive y dejo de actualizar). Ahora la fuente es la
    misma que Firestore -> SAP Service Layer -> stock por SKU sumado en todos
    los warehouses vendibles (no solo W07 que era el motivo de que quedara
    'withStock: 2' historico).
    """
    if os.environ.get('DRY_RUN', '').lower() == 'true':
        log(f'[DRY_RUN] escribiria stock.json con {len(stock_map)} SKUs')
        return False
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    stock_json_path = os.path.join(repo_root, 'stock.json')

    payload = {
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': 'SAP_ServiceLayer',
        # 'ALL_SALES' = suma de todos los warehouses vendibles (excluye 05
        # Marketing y 06 Devoluciones). Antes el CSV de David filtraba solo
        # W07 (PESCA EEUU) que estaba vacio -> withStock: 2 historico.
        'warehouse': 'ALL_SALES',
        'totalSkus': len(stock_map),
        'withStock': with_stock,
        'withoutStock': len(stock_map) - with_stock,
        'stock': stock_map,
    }

    # Comparar contra existente para no reescribir si stock_map es identico
    # (aunque los valores cambien, si el conjunto de SKUs con stock es igual
    # no hace falta commit). Como esto se corre 48 veces por dia, evitamos
    # inflar historia git con commits identicos.
    existing_stock = None
    if os.path.exists(stock_json_path):
        try:
            with open(stock_json_path, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            existing_stock = existing_data.get('stock')
        except (json.JSONDecodeError, OSError):
            existing_stock = None
    if existing_stock == stock_map:
        log('[stock.json] sin cambios (stock idem al existente), no reescribo')
        return False

    with open(stock_json_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    log(f'[stock.json] escrito: {len(stock_map)} SKUs, {with_stock} con stock')
    return True


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
    items, stock_map, qty_map, price_map, scanned, with_stock, with_price = sl_fetch_items_and_stock(sl_cfg, session, max_items=max_items)

    if scanned == 0:
        log('[FATAL] SL devolvio 0 items. No escribo nada para no pisar datos buenos.')
        return 5

    # Catalogo: fuente primaria de categorizacion = CSV inline en index.html.
    # Fallback = product_catalog en Firestore (por si alguien clasifico items
    # nuevos via el sync manual del admin y no llegaron al CSV inline aun).
    local_cat = load_local_categorization_from_html()
    fs_cat = load_existing_catalog(db)
    # Merge: local tiene prioridad, firestore rellena huecos.
    existing = dict(fs_cat)
    existing.update(local_cat)
    log(f'[merge] total items con categorizacion disponible: {len(existing)}')

    # Desde v267: el filtro por grupo PESCA ahora es server-side en
    # sl_fetch_items_and_stock (via ?$filter=ItemsGroupCode eq X). Todos
    # los `items` que llegan aca son ya de pesca, no hace falta filtrar
    # de nuevo por CSV inline. El merge con `existing` sigue para copiar
    # cat/fam/sub cuando estan disponibles (para que el picker mantenga
    # los dropdowns de categoria). Items nuevos sin cat/fam/sub quedan
    # con esos campos vacios pero SI aparecen en el buscador Master.
    items_with_cat = 0
    items_sin_cat = 0
    for it in items:
        if it['code'] in existing:
            items_with_cat += 1
        else:
            items_sin_cat += 1
    log(f'[catalogo] escribiendo {len(items)} items de PESCA ({items_with_cat} con cat/fam/sub, {items_sin_cat} sin cat/fam/sub)')

    write_catalog(db, items, existing)
    # Stock SI se escribe COMPLETO (todos los items del grupo PESCA) - se usa para:
    # - indicador verde/rojo en el picker (bool via stock_map)
    # - cantidad exacta en el modal Master de Productos para vendedores
    #   (via qty_map - antes solo admin podia ver la cantidad porque
    #   requeria login SL desde el browser).
    write_stock_snapshot(db, stock_map, qty_map, with_stock)
    # Precios (v268+): traidos automatic de la lista PESCA #12 de SAP.
    # Antes se subian manual por CSV desde el modal admin -> lista congelada
    # con SKUs faltantes. Ahora se refresca cada 30 min.
    log(f'[precios] escribiendo {len(price_map)} precios de SKUs de PESCA (lista #{PESCA_PRICE_LIST_NUM} ARS)')
    write_price_list(db, price_map)
    # Ademas escribimos stock.json en la raiz del repo. Lo consume el Google
    # Sheet "Inventario-Bot" via GitHub Pages (https://shimano-arg.github.io/
    # app-vendedores/stock.json). El workflow despues hace commit si cambio.
    stock_json_changed = write_stock_json_for_bot(stock_map, with_stock)
    # Escribir un archivo marker que el step de git del workflow puede usar
    # para decidir si hacer commit (evita correr git diff si sabemos que no
    # cambio). Es un flag opcional; el workflow tambien puede chequear con
    # git diff --quiet.
    if stock_json_changed:
        try:
            with open(os.path.join(os.path.dirname(__file__), '..', '.stock_json_changed'), 'w') as f:
                f.write('1')
        except OSError:
            pass

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
