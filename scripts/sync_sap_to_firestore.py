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

# ============================================================
# BPs pesca (v282+, 2026-07-08): sync automatico BusinessPartners -> app
# ============================================================
# Antes: los BPs nuevos dados de alta en SAP quedaban "invisibles" en la
# app hasta que admin subia manualmente un CSV desde el panel SAP >
# Integracion. Ahora se sincronizan automatic cada 30 min a la coleccion
# client_applications de Firestore.
#
# Filtro: solo BPs de pesca (SalesPersonCode ∈ {50..55}), del tipo Customer.
# SAP es la fuente unica de verdad para asignacion de vendedor - si el
# gerente reasigna en la app, en la proxima corrida el sync va a pisarlo
# (para reasignar de forma persistente hay que cambiarlo en SAP).
PESCA_SLP_CODES = [50, 51, 52, 53, 54, 55]

# Mapping SlpCode -> vendedor en la app (nombre, email).
# Nombres en UPPERCASE porque assignedVendor usa esa convencion en la app.
SLP_TO_VENDOR = {
    50: {'name': 'GONZALO DE LA ROSA',     'email': 'gonzalo.de.la.rosa@shimano.com.ar'},
    51: {'name': 'MAURICIO GIL',           'email': 'mauricio.gil@shimano.com.ar'},
    52: {'name': 'IOANNIS PALKOUDAKIS',    'email': 'ioannis.plakoudakis@shimano.com.ar'},
    53: {'name': 'SANTIAGO ESTEBAN',       'email': 'santiago.esteban@shimano.com.ar'},
    54: {'name': 'FEDERICO CASTELANELLI',  'email': 'federico.castelanelli@shimano.com.ar'},
    55: {'name': 'MARTIN BOIERO',          'email': 'martin.boiero@shimano.com.ar'},
}

# v284 (2026-07-08): descubrimiento importante. Los BPs pesca en SAP NO
# tienen SalesPersonCode asignado a los 6 vendedores (viene -1 "No Sales
# Employee" en el header). El campo real que identifica pesca es el UDF
# U_DIVISION con valor "PESCA". La asignacion vendedor -> cliente se hace
# por PROVINCIA (mismo mapping que la app tiene hardcoded en index.html
# ~linea 8160). Cuando el gerente reasigna manualmente en la app, respetamos
# via opcion A elegida antes (el sync pisa; para cambiar de forma persistente
# hay que cambiar la provincia del BP en SAP).
IOANNIS_PROVS = {'TIERRA DEL FUEGO', 'SANTA CRUZ', 'CHUBUT', 'RIO NEGRO', 'NEUQUEN', 'LA PAMPA', 'MENDOZA'}
SANTIAGO_PROVS = {'SALTA', 'JUJUY', 'TUCUMAN', 'CATAMARCA', 'LA RIOJA', 'SANTIAGO DEL ESTERO', 'MISIONES', 'CHACO', 'FORMOSA'}
MAURICIO_PROVS = {'ENTRE RIOS', 'CORRIENTES'}
MARTIN_PROVS = {'CORDOBA', 'SANTA FE', 'SAN JUAN', 'SAN LUIS'}
GONZALO_PROVS = {'CIUDAD AUTONOMA DE BUENOS AIRES', 'CABA', 'CAPITAL FEDERAL'}
# Buenos Aires (provincia) default -> Federico (BA Interior + Costa). Podemos
# afinar por localidad en el futuro si el gerente quiere sub-zonas.
FEDERICO_PROVS = {'BUENOS AIRES'}


def resolve_vendor_by_province(prov: str):
    """Mapea provincia -> vendedor pesca segun las zonas hardcoded de la app.
    Devuelve el dict de SLP_TO_VENDOR o None si no matchea."""
    if not prov:
        return None
    p = prov.strip().upper()
    if p in IOANNIS_PROVS:      return SLP_TO_VENDOR[52]
    if p in SANTIAGO_PROVS:     return SLP_TO_VENDOR[53]
    if p in MAURICIO_PROVS:     return SLP_TO_VENDOR[51]
    if p in MARTIN_PROVS:       return SLP_TO_VENDOR[55]
    if p in GONZALO_PROVS:      return SLP_TO_VENDOR[50]
    if p in FEDERICO_PROVS:     return SLP_TO_VENDOR[54]
    return None

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
    qty_map = {}         # {sku: int}     total sumado (retrocompat)
    whs_map = {}         # {sku: {whs_code: int}}  v368+ desglose por almacen (11=NUR PESCA vendible, 12=EN TRANSITO PESCA, 98=CUARENTENA, etc.)
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
            whs_breakdown = {}  # v368+: {whs_code: int} desglose para separar disponible vs transito en la UI
            for w in whs_list:
                whs_code = w.get('WarehouseCode') or ''
                if whs_code in NON_SALES_WHS:
                    continue
                try:
                    stk = float(w.get('InStock') or 0)
                except (TypeError, ValueError):
                    continue
                total_qty += stk
                if stk > 0:
                    whs_breakdown[whs_code] = int(round(stk))
            has_stk = total_qty > 0
            items.append({'code': code, 'desc': name})
            stock_map[code] = has_stk
            # Cantidad total en entero (SAP no maneja fracciones de items). La
            # guardamos separada del bool para no romper el listener actual
            # que espera stock_map[sku] = bool.
            qty_map[code] = int(round(total_qty))
            # v368+ (2026-07-31): desglose por almacen. Solo escribimos si el
            # SKU tiene stock en al menos 1 warehouse (empty dict quema espacio).
            # La UI usa 11 (disponible) y 12 (transito) por separado; el resto
            # (98 cuarentena, 01/03/04/07 no aplican a stock vendible) queda
            # como 'otros' en la card.
            if whs_breakdown:
                whs_map[code] = whs_breakdown
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
                return items, stock_map, qty_map, whs_map, price_map, scanned, with_stock, with_price

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
    return items, stock_map, qty_map, whs_map, price_map, scanned, with_stock, with_price


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


def sl_fetch_backorder_by_sku(cfg: dict, session: requests.Session) -> dict:
    """v377+ (2026-08-02): fetch de Sales Quotations abiertas (backorder) y
    agrega el RemainingOpenQuantity por ItemCode.

    Backorder Shimano = SQ open con RemainingOpenQuantity > 0. Incluye
    tanto SQ parciales (SO cubrio parte, resto pendiente) como SQ intactas
    (aun no procesadas). Es el mismo criterio que usa v_backorder_lineas
    en BQ (bigquery/views.sql:V8).

    La app usa este agregado para computar "Stock Liberado" = max(transito
    (whs 12) - backorder, 0). Si backorder > transito, todo el transito
    esta reservado y no hay stock que se libere cuando llegue mercaderia.

    Retorna: {'SN2000FG': 20, 'REEL5000': 5, ...} - SKUs sin backorder
    NO aparecen (equivale a 0). Para reducir el size del JSON.
    """
    log('[BACKORDER] fetch Sales Quotations abiertas (para computar backorder por SKU)...')
    result = {}  # {sku: int (unidades pendientes)}
    scanned_docs = 0
    scanned_lines = 0
    # $select para minimizar payload: solo lo necesario.
    # $filter: solo abiertas + no canceladas. Ventana amplia porque las SQ
    # abiertas pueden ser viejas (Santiago mantiene SQ pendientes de meses).
    path = '/b1s/v1/Quotations?$select=DocEntry,DocumentStatus,Cancelled,DocumentLines&$filter=DocumentStatus%20eq%20%27bost_Open%27%20and%20Cancelled%20eq%20%27tNO%27'
    page_count = 0
    while True:
        url = path if path.startswith('http') else f"{cfg['url']}{path}"
        try:
            resp = session.get(url, timeout=60)
        except requests.RequestException as e:
            log(f'[BACKORDER] error de red pagina {page_count} (no bloqueante): {e}')
            return result
        if resp.status_code == 401:
            log('[BACKORDER] 401 - re-login y retry')
            sl_login(cfg, session)
            resp = session.get(url, timeout=60)
        if not resp.ok:
            log(f'[BACKORDER] HTTP {resp.status_code} (no bloqueante). Body: {resp.text[:200]}')
            return result
        body = resp.json()
        arr = body.get('value', []) or []
        for doc in arr:
            scanned_docs += 1
            lines = doc.get('DocumentLines') or []
            for ln in lines:
                scanned_lines += 1
                code = (ln.get('ItemCode') or '').strip()
                if not code:
                    continue
                try:
                    remaining = float(ln.get('RemainingOpenQuantity') or 0)
                except (TypeError, ValueError):
                    remaining = 0
                if remaining > 0:
                    result[code] = result.get(code, 0) + int(round(remaining))
        page_count += 1
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
        # Safety cap - las Quotations abiertas historicas rara vez pasan de 5000
        if scanned_docs > 20000:
            log(f'[BACKORDER] safety cap 20k Quotations, cortando')
            break
    log(f'[BACKORDER] {page_count} paginas, {scanned_docs} SQ open, {scanned_lines} lineas -> {len(result)} SKUs con backorder')
    return result


def write_stock_snapshot(db: firestore.Client, stock_map: dict, qty_map: dict, whs_map: dict, backorder_map: dict, with_stock: int) -> str:
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
    # v368+ (2026-07-31): warehouseBreakdown como JSON string (mismo patron que
    # quantities para evitar el limite de 40k index entries de Firestore).
    # Formato: {"SN2000FG":{"11":20,"12":160},"OTROSKU":{"11":5},...}
    # La UI parsea con JSON.parse y muestra Disponible (11) + Transito (12) + Otros.
    whs_json = json.dumps(whs_map, separators=(',', ':'), ensure_ascii=True)
    # v377+ (2026-08-02): backorderBySku como JSON string (mismo patron).
    # Formato: {"SN2000FG":20,"REEL5000":5,...} - suma de RemainingOpenQuantity
    # de todas las SQ open no canceladas por SKU. La UI computa:
    # Stock Liberado = max(transito(whs12) - backorder, 0).
    # SKUs sin backorder NO estan en el map (equivale a 0) - reduce size.
    backorder_json = json.dumps(backorder_map or {}, separators=(',', ':'), ensure_ascii=True)
    db.collection('app_config').document('stock_snapshot').set({
        # Key 'stock' compatible con el listener existente ensureStockSnapshotListener.
        'stock': stock_map,
        # Key 'quantities' como STRING JSON (no map) para evitar el limite
        # de 40k index entries de Firestore.
        'quantities': qty_json,
        # v368+: desglose por almacen para separar disponible venta (whs 11) vs
        # transito (whs 12) en la card de stock de la app.
        'warehouseBreakdown': whs_json,
        # v377+: backorder por SKU (sumatoria RemainingOpenQuantity de SQ open).
        'backorderBySku': backorder_json,
        'totalItems': len(stock_map),
        'withStock': with_stock,
        'warehouse': 'ALL_SALES',
        'source': 'service_layer_auto',
        'updatedAt': firestore.SERVER_TIMESTAMP,
        'updatedBy': 'github-actions/sync_sap_to_firestore',
        'syncBatchId': sync_batch_id,
    })
    log(f'[FS] stock_snapshot escrito: {len(stock_map)} SKUs, {with_stock} con stock (quantities JSON string {len(qty_json)} bytes, warehouseBreakdown {len(whs_json)} bytes, backorderBySku {len(backorder_json)} bytes / {len(backorder_map or {})} SKUs)')
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


# ============================================================
# BPs pesca -> Firestore (v282+)
# ============================================================
def _norm_name(s: str) -> str:
    """Replica de sapNorm() del cliente (index.html:19449): trim + uppercase.
    Se usa como fallback para matchear BPs SAP con client_applications de la
    app cuando no hay match por CardCode ni CUIT."""
    return (s or '').strip().upper()


def _norm_cuit(s: str) -> str:
    """Limpia el CUIT dejando solo digitos. SAP a veces trae con guiones
    (20-12345678-9) o espacios, la app puede tenerlo distinto."""
    return ''.join(c for c in (s or '') if c.isdigit())


def load_ar_provinces_map(cfg: dict, session: requests.Session) -> dict:
    """
    v287+: en SAP de Shimano el UDF U_SH_PCIA guarda el codigo interno de
    provincia (ej: '1', '2', '3'), no el nombre. Este helper trae el mapping
    code -> name para Argentina desde /b1s/v1/States?$filter=Country eq 'AR'.

    Devuelve dict {'1': 'BUENOS AIRES', '2': 'CIUDAD AUTONOMA...', ...}
    en UPPERCASE para matchear con las zonas hardcoded.

    Si el lookup falla, devuelve dict vacio y el filtro de vendor por
    provincia va a fallar (skip por vendor). No aborta el sync.
    """
    result = {}
    try:
        # Intentamos primero con /States (nombre canonico en SL v10+).
        path = "/b1s/v1/States?$filter=Country eq 'AR'&$select=Code,Name"
        resp = session.get(f"{cfg['url']}{path}", timeout=30)
        if resp.ok:
            for state in resp.json().get('value', []):
                code = str(state.get('Code', '')).strip()
                name = str(state.get('Name', '')).strip().upper()
                if code and name:
                    result[code] = name
        else:
            log(f'[bp] load_ar_provinces: HTTP {resp.status_code} en /States')
    except Exception as e:
        log(f'[bp] WARN load_ar_provinces: {e}')
    log(f'[bp] {len(result)} codigos de provincia AR cargados desde SAP States')
    if result:
        # Sample para diagnostico
        sample_items = list(result.items())[:10]
        log(f'[bp] sample provincias: {sample_items}')
    return result


def load_vendor_uids_by_email(db: firestore.Client) -> dict:
    """
    Consulta /roles y devuelve {email_lowercase: uid}. Se usa para poblar
    ownerUid en client_applications creados/actualizados. Si un vendedor
    aun no se logueo (no tiene doc en /roles), su email no va a estar en
    el dict y ownerUid queda vacio - el sync loguea WARN y sigue.
    """
    result = {}
    try:
        docs = db.collection('roles').stream()
        for d in docs:
            data = d.to_dict() or {}
            email = (data.get('email') or '').strip().lower()
            if email:
                result[email] = d.id
    except Exception as e:
        log(f'[WARN] load_vendor_uids_by_email: {e}')
    log(f'[bp] {len(result)} vendedores en /roles con email')
    return result


def fetch_bp_pesca_from_sl(cfg: dict, session: requests.Session) -> list:
    """
    Trae BPs pesca de SAP via Service Layer con paginacion.
    Filtro: CardType='cCustomer' + SalesPersonCode ∈ {50..55}.
    """
    # v285+ (2026-07-08): U_DIVISION eq 'PESCA' en $filter devuelve 0 desde SL
    # aunque el UDF exista con ese valor. Los UDFs en SL son picky con el
    # naming y a veces no aceptan filter directo. Solucion: traer todos los
    # BPs (Customer + Lead) y filtrar en Python por el UDF, probando
    # variantes del nombre (U_DIVISION, U_Division, etc).
    type_filter = "(CardType eq 'cCustomer' or CardType eq 'cLid')"
    filter_expr = type_filter
    # $select vacio -> SL devuelve schema completo incluidos los UDFs.
    select_fields = None
    path = f"/b1s/v1/BusinessPartners?$filter={filter_expr}"
    if select_fields:
        path += f"&$select={','.join(select_fields)}"
    bps = []
    page = 0
    last_progress = time.time()
    while path:
        url = path if path.startswith('http') else f"{cfg['url']}{path}"
        try:
            resp = session.get(url, timeout=60)
        except requests.RequestException as e:
            log(f'[SL/BP] error de red pag {page}: {e}. Retry en 5s.')
            time.sleep(5)
            resp = session.get(url, timeout=60)
        if resp.status_code == 401:
            log('[SL/BP] 401 - re-login y retry')
            sl_login(cfg, session)
            resp = session.get(url, timeout=60)
        if not resp.ok:
            try:
                detail = resp.json().get('error', {}).get('message', {}).get('value', '')
            except Exception:
                detail = resp.text[:200]
            log(f'[FATAL/BP] HTTP {resp.status_code} - {detail}')
            return bps  # devolver lo que llevemos, no aborta el sync entero
        body = resp.json()
        bps.extend(body.get('value', []) or [])
        page += 1
        if time.time() - last_progress > 5:
            log(f'[SL/BP] pag {page}: {len(bps)} BPs')
            last_progress = time.time()
        # v285+: SL v10+ devuelve nextLink con @, versiones viejas sin @.
        # Chequear ambos para no cortar el paginado prematuramente.
        next_link = body.get('@odata.nextLink') or body.get('odata.nextLink')
        if not next_link:
            break
        # normalizar path
        if next_link.startswith('http'):
            idx = next_link.find('/b1s/v1/')
            path = next_link[idx:] if idx >= 0 else next_link
        elif next_link.startswith('/'):
            path = next_link
        else:
            path = '/b1s/v1/' + next_link
        # Safety cap para evitar loops infinitos.
        if page > 500:
            log(f'[SL/BP] safety cap 500 paginas alcanzado, cortando')
            break
    log(f'[SL/BP] total: {len(bps)} BPs pesca en {page} paginas')
    return bps


def load_existing_client_applications(db: firestore.Client) -> list:
    """
    Trae TODOS los docs de client_applications. Con ~150 docs es rapido y
    permite matchear en memoria por CardCode / CUIT / nombre normalizado.
    """
    out = []
    try:
        for d in db.collection('client_applications').stream():
            data = d.to_dict() or {}
            data['__id'] = d.id
            data['__ref'] = d.reference
            out.append(data)
    except Exception as e:
        log(f'[WARN] load_existing_client_applications: {e}')
    log(f'[bp] {len(out)} client_applications cargados para matching')
    return out


def find_match(bp: dict, existing_apps: list):
    """
    Busca un doc en client_applications que matchee con el BP:
      1. Por cardCodeSap (mas confiable)
      2. Por cuit normalizado (solo digitos)
      3. Fallback: por nombre normalizado (comercio o fantasia, uppercase+trim)
    Retorna el dict del doc (con __id, __ref) o None.
    """
    bp_cardcode = (bp.get('CardCode') or '').strip()
    bp_cuit = _norm_cuit(bp.get('FederalTaxID', ''))
    bp_name_norm = _norm_name(bp.get('CardName', ''))
    # 1. Match por cardCodeSap
    if bp_cardcode:
        for app in existing_apps:
            if (app.get('cardCodeSap') or '').strip() == bp_cardcode:
                return app
    # 2. Match por CUIT
    if bp_cuit:
        for app in existing_apps:
            app_cuit = _norm_cuit(app.get('cuit', '') or app.get('cuitCliente', ''))
            if app_cuit and app_cuit == bp_cuit:
                return app
    # 3. Match por nombre normalizado (comercio o fantasia)
    if bp_name_norm:
        for app in existing_apps:
            for field in ('comercio', 'fantasia', 'razonSocial'):
                val_norm = _norm_name(app.get(field, ''))
                if val_norm and val_norm == bp_name_norm:
                    return app
    return None


def upsert_bp_pesca_to_firestore(db: firestore.Client,
                                  bps: list,
                                  vendor_uids: dict,
                                  provinces_map: dict = None,
                                  dry_run: bool = False) -> dict:
    """
    Para cada BP pesca de SAP:
      - Busca match en client_applications
      - Si existe como PROVISORIO (manualSapPending=true) -> pisar con datos SAP
        + status=approved + cardCodeSap seteado + manualSapPending=false
      - Si existe como HABILITADO -> actualizar datos SAP (incluye vendedor,
        segun opcion A elegida por el user 2026-07-08: SAP es fuente unica de
        verdad; si el gerente reasigno en la app, se pisa)
      - Si NO existe -> crear nuevo con status=approved

    Devuelve dict con stats {created, updated_prov_to_conf, updated_existing,
    skipped_unknown_vendor}.
    """
    existing_apps = load_existing_client_applications(db)
    provinces_map = provinces_map or {}
    stats = {'created': 0, 'updated_prov_to_conf': 0, 'updated_existing': 0, 'skipped_unknown_vendor': 0, 'skipped_not_pesca': 0}
    # v285+: filtrar por UDF DIVISION=PESCA en Python porque OData $filter no
    # matchea el UDF con seguridad. Probamos varios nombres posibles.
    UDF_DIVISION_KEYS = ('U_DIVISION', 'U_Division', 'U_division', 'U_DIV', 'U_Categoria', 'U_CATEGORIA')
    def get_bp_division(bp_data):
        for k in UDF_DIVISION_KEYS:
            v = bp_data.get(k)
            if v is not None and str(v).strip() != '':
                return str(v).strip().upper()
        return ''
    # Diagnostico: mostrar sample de UDFs detectados en el primer BP + valor
    # de U_DIVISION en los primeros 5 (asi vemos que valores esta trayendo
    # SL para el UDF y ajustamos el filtro si hace falta).
    if bps:
        sample = bps[0]
        udf_keys_found = [k for k in sample.keys() if k.startswith('U_')]
        log(f'[bp] sample BP CardCode={sample.get("CardCode")}, UDFs detectados: {udf_keys_found}')
        for i, bp_diag in enumerate(bps[:5]):
            div_val = None
            for k in UDF_DIVISION_KEYS:
                v = bp_diag.get(k)
                if v is not None:
                    div_val = f'{k}={v!r}'
                    break
            # v286+: log tambien la provincia detectada en distintos campos
            # para poder diagnosticar por que se skippean por vendor.
            prov_pcia = bp_diag.get('U_SH_PCIA')
            prov_std = bp_diag.get('Province')
            prov_addr = None
            for addr in (bp_diag.get('BPAddresses') or []):
                p2 = addr.get('State') or addr.get('State1')
                if p2:
                    prov_addr = p2
                    break
            log(f'[bp] diag #{i+1} CardCode={bp_diag.get("CardCode")} CardType={bp_diag.get("CardType")} '
                f'DIVISION={div_val or "(none)"} U_SH_PCIA={prov_pcia!r} Province={prov_std!r} BPAddr.State={prov_addr!r}')
    for bp in bps:
        cardcode = (bp.get('CardCode') or '').strip()
        cardname = (bp.get('CardName') or '').strip()
        # v288+ (2026-07-08): correccion IMPORTANTE del filtro U_DIVISION.
        # Los codigos del dropdown en Shimano SAP son:
        #   1 = BIKE
        #   2 = PESCA
        #   3 = BIKE & PESCA
        # v286 filtro por '1' pensando que era PESCA -> trajo ~2500 clientes
        # de BICICLETAS. Aceptamos '2' (PESCA puro) y '3' (mixto BIKE&PESCA)
        # + fallbacks textuales para otras configuraciones.
        division = get_bp_division(bp)
        if division not in ('2', '3', 'PESCA', 'BIKE & PESCA', 'BIKE&PESCA'):
            stats['skipped_not_pesca'] += 1
            continue
        # v287+ SIMPLIFICADO: el requerimiento del user (2026-07-08) es que
        # TODOS los BPs pesca de SAP aparezcan en la app. La asignacion de
        # vendedor+zona la hace admin/gerente MANUALMENTE desde la app.
        # No mapeamos provincia -> vendedor (evita todo el drama de codigos
        # numericos y campos raros).
        slp_header = bp.get('SalesPersonCode')
        try:
            slp_header = int(slp_header) if slp_header is not None else None
        except (TypeError, ValueError):
            slp_header = None
        # v288+: convertir el codigo de U_SH_PCIA (ej: '2') a nombre real
        # de provincia ('SALTA') usando el mapping de SAP States. La app
        # espera el nombre en el campo 'provincia' para poder filtrar la
        # lista de clientes por localidad/provincia.
        prov_code_raw = (bp.get('U_SH_PCIA') or bp.get('Province') or '').strip()
        prov_name = ''
        if prov_code_raw and provinces_map:
            prov_name = provinces_map.get(prov_code_raw, '')
        # Fallback: buscar en BPAddresses[].State por si el UDF no tiene valor.
        if not prov_name:
            for addr in (bp.get('BPAddresses') or []):
                st = (addr.get('State') or addr.get('State1') or '').strip()
                if st and provinces_map:
                    prov_name = provinces_map.get(st, '')
                    if prov_name:
                        break
        # provincia_final: el nombre canonico (SALTA, BUENOS AIRES, etc.) o
        # el codigo raw si el mapping fallo (mejor mostrar algo que nada).
        provincia_final = prov_name or prov_code_raw or ''
        # Vendedor: NO asignar. Queda vacio para que admin/gerente lo asigne
        # en la app usando la logica de zonas visual.
        vendor_email = ''
        vendor_name = ''
        vendor_uid = ''

        # Payload para upsert. Solo pisamos campos "SAP", NO tocamos campos
        # manuales del gerente que no son de SAP (approvals, notas, categorizacion,
        # etc.) - Firestore hace merge de subcolecciones si usamos set(..., merge=True).
        base_payload = {
            # Nombre + identificacion
            'comercio': cardname,
            'fantasia': cardname,
            'cardCodeSap': cardcode,
            'cuit': _norm_cuit(bp.get('FederalTaxID', '')),
            # Direccion
            'calle': bp.get('Address', '') or '',
            'localidad': bp.get('City', '') or '',
            'localidadFinal': bp.get('City', '') or '',
            'codigoPostal': bp.get('ZipCode', '') or '',
            # v288+: provincia CANONICA en uppercase (SALTA, BUENOS AIRES, etc.)
            # que la app usa para filtrar/agrupar clientes por localidad.
            'provincia': provincia_final.upper() if provincia_final else '',
            # Contacto
            'telefonoContacto': bp.get('Phone1', '') or bp.get('Cellular', '') or '',
            'email': bp.get('EmailAddress', '') or '',
            # SAP metadata. sapCardType permite a la app distinguir Customers
            # de Leads (los Leads son BPs esperando validacion de finanzas y NO
            # se pueden facturar hasta que admin los convierta manualmente en
            # SAP). sapFrozen/sapValid indican si esta activo.
            'sapCardType': bp.get('CardType', ''),  # cCustomer | cLid
            'sapSalesPersonCode': slp_header,       # -1 en general para pesca
            'sapDivision': bp.get('U_DIVISION', ''),  # 'PESCA'
            'sapValid': bp.get('Valid', ''),
            'sapFrozen': bp.get('Frozen', ''),
            'sapUpdateDate': bp.get('UpdateDate', ''),
            # Provincia SAP raw (codigo interno). Solo info auditable.
            'sapProvinceRaw': prov_code_raw,
            # sapReadyForSL: convenience flag para la app. True solo si es
            # Customer + Valid=tYES + Frozen=tNO. La app deberia skip auto-envio
            # a Service Layer si es False (asi no se acumulan errores 400 en
            # la consola). Se calcula aca para no complicar la logica del
            # frontend.
            'sapReadyForSL': (
                bp.get('CardType') == 'cCustomer'
                and bp.get('Valid') == 'tYES'
                and bp.get('Frozen') != 'tYES'
            ),
            # v287+: NO poblar assignedVendor/ownerUid en el payload. El
            # admin/gerente los asigna manualmente desde la app. Solo los
            # inicializamos vacios en el CREATE inicial; en UPDATE no los
            # tocamos para no pisar lo que el gerente asigno.
            # Estado
            'status': 'approved',
            'manualSapPending': False,
            'source': 'sap_sync',
            'syncedAt': firestore.SERVER_TIMESTAMP,
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }

        # v291+ (2026-07-13): NO pisar localidad/provincia si SAP no tiene
        # valor. Estos campos se editan manualmente por admin en Master
        # Clientes cuando el BP viene con City/State vacios desde SAP B1.
        # Antes: cada 30 min este sync hacia set(merge=True) con strings
        # vacios y destruia el trabajo manual del admin (reportado por
        # Mariano 2026-07-13 - completo ~20 tiendas a la manana y a la
        # tarde estaban todas "(sin localidad)" otra vez).
        if not (bp.get('City', '') or '').strip():
            base_payload.pop('localidad', None)
            base_payload.pop('localidadFinal', None)
        if not provincia_final:
            base_payload.pop('provincia', None)
        # v608 (2026-08-24): mismo guard para calle + codigoPostal. Antes:
        # `calle` se escribia SIEMPRE con bp.get('Address','') aunque SAP
        # tenga Address vacio -> destruia la direccion manual que el admin
        # cargo desde Master Clientes -> Direcciones. Reportado por Mariano
        # 2026-08-24 ("completo los campos, dice guardado, y al refrescar
        # queda vacio otra vez"). Root cause: este cron corre cada 5 min
        # (sync-sap-catalog-stock.yml), asi que basta con <5 min entre save
        # y refresh para ver el bug.
        if not (bp.get('Address', '') or '').strip():
            base_payload.pop('calle', None)
        if not (bp.get('ZipCode', '') or '').strip():
            base_payload.pop('codigoPostal', None)

        match = find_match(bp, existing_apps)

        # v299+ (2026-07-14): NO pisar 'fantasia' si el admin/gerente ya
        # cargo una distinta del comercio (nombre comercial real de la
        # tienda vs razon social de SAP). Antes: bulk import cargaba
        # "ARMERIA EL COLORADO" y el sync a los 30 min lo reemplazaba con
        # "GABRIEL ALEJANDRO YAMIN" (CardName SAP). Mismo bug del user
        # reporte: cargo fantasias a mano y "a los 2-3 dias desaparecieron".
        #
        # Regla:
        # - Si match existe Y match.fantasia esta cargada Y difiere del
        #   comercio -> NO incluir 'fantasia' en el payload (preserva manual).
        # - Si no hay match (create) o fantasia == comercio o vacia
        #   -> setear fantasia = cardname como default.
        if match is not None:
            existing_fant = (match.get('fantasia') or '').strip()
            existing_com = (match.get('comercio') or '').strip()
            has_manual_fantasia = (
                existing_fant
                and existing_fant.lower() != existing_com.lower()
                and existing_fant.lower() != cardname.strip().lower()
            )
            if has_manual_fantasia:
                base_payload.pop('fantasia', None)
                log(f'[bp] preserva fantasia manual: {cardcode} keep={existing_fant!r} (sap dice {cardname!r})')

            # v300+ (2026-07-14): tambien preservar provincia + localidad si
            # fueron corregidas manualmente (marca provinciaLocSource) o
            # bulk_excel_*. Bug real: el sync SAP asigna provincia mal para
            # muchos BPs (YAMIN en CHUBUT cuando es SALTA, TOMPY PESCA idem)
            # por bug del provinces_map. Correcto seria arreglar SAP, pero
            # como paliativo el admin corrige a mano y el sync respeta.
            prov_locked_marker = (match.get('provinciaLocSource') or '').strip()
            if prov_locked_marker and prov_locked_marker != 'sap_sync':
                if 'provincia' in base_payload:
                    log(f'[bp] preserva provincia manual: {cardcode} keep={match.get("provincia")!r} source={prov_locked_marker!r} (sap dice {base_payload["provincia"]!r})')
                    base_payload.pop('provincia', None)
                if 'localidad' in base_payload:
                    base_payload.pop('localidad', None)
                    base_payload.pop('localidadFinal', None)

        if match is None:
            # CASO 3: crear nuevo. Solo aca inicializamos vendedor vacio.
            base_payload['createdAt'] = firestore.SERVER_TIMESTAMP
            base_payload['assignedVendor'] = ''
            base_payload['ownerUid'] = ''
            base_payload['ownerEmail'] = ''
            base_payload['ownerName'] = ''
            if dry_run:
                log(f'[DRY_RUN/bp] CREATE {cardcode} ({cardname}) sin vendedor asignado')
            else:
                db.collection('client_applications').add(base_payload)
            stats['created'] += 1
            log(f'[bp] CREATED {cardcode} ({cardname}) - admin debe asignar vendedor+zona en la app')
            continue

        was_provisorio = bool(match.get('manualSapPending')) or (not match.get('cardCodeSap'))
        if was_provisorio:
            # CASO 1: provisorio -> confirmado. Pisar datos SAP pero preservar
            # vendedor que el gerente pueda haber asignado antes.
            if dry_run:
                log(f'[DRY_RUN/bp] PROV->CONF {match["__id"]} ({cardname}) -> cardCodeSap={cardcode}')
            else:
                match['__ref'].set(base_payload, merge=True)
            stats['updated_prov_to_conf'] += 1
            log(f'[bp] PROV->CONF {match["__id"]} ({cardname}) cardCodeSap={cardcode}')
        else:
            # CASO 2: ya estaba habilitado - solo actualizar datos SAP.
            # No tocamos createdAt ni approvals ni assignedVendor.
            if dry_run:
                log(f'[DRY_RUN/bp] UPDATE {match["__id"]} ({cardname})')
            else:
                match['__ref'].set(base_payload, merge=True)
            stats['updated_existing'] += 1
            log(f'[bp] UPDATED {match["__id"]} ({cardname}) cardCodeSap={cardcode}')

    return stats


def sync_bp_pesca(db: firestore.Client, cfg: dict, session: requests.Session) -> None:
    """
    Sync BPs pesca de SAP -> Firestore client_applications.
    Se llama desde main() al final del sync de items/stock. Si falla, loguea
    pero no aborta el sync entero (los items/stock ya fueron escritos).
    """
    dry_run = os.environ.get('DRY_RUN', '').lower() == 'true'
    log('[bp] === sync BPs pesca START ===')
    try:
        vendor_uids = load_vendor_uids_by_email(db)
        # v288+: cargar mapping code->name de provincias argentinas desde SAP
        # asi podemos convertir U_SH_PCIA (codigo interno tipo '2') al nombre
        # de la provincia ('SALTA', 'BUENOS AIRES', etc.) y poblarlo en el
        # campo 'provincia' del doc client_applications - que es el que usa
        # la app para filtrar/agrupar clientes por provincia.
        provinces_map = load_ar_provinces_map(cfg, session)
        bps = fetch_bp_pesca_from_sl(cfg, session)
        if not bps:
            log('[bp] SL devolvio 0 BPs pesca. No hago nada.')
            return
        stats = upsert_bp_pesca_to_firestore(db, bps, vendor_uids, provinces_map=provinces_map, dry_run=dry_run)
        log(f'[bp] === sync BPs pesca END: created={stats["created"]}, '
            f'prov->conf={stats["updated_prov_to_conf"]}, '
            f'updated={stats["updated_existing"]}, '
            f'skipped_vendor={stats["skipped_unknown_vendor"]}, '
            f'skipped_not_pesca={stats.get("skipped_not_pesca", 0)} ===')
    except Exception as e:
        log(f'[bp] FATAL sync BPs pesca: {e}. Sigo sin abortar el sync general.')


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
    items, stock_map, qty_map, whs_map, price_map, scanned, with_stock, with_price = sl_fetch_items_and_stock(sl_cfg, session, max_items=max_items)

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
    # v377+ (2026-08-02): antes de escribir el snapshot, fetchear backorder
    # (RemainingOpenQuantity de SQ open) para computar Stock Liberado en la UI.
    # Fetch fault-tolerante: si SL falla o timeout, backorder_map queda vacio
    # y la UI simplemente no muestra la linea "Stock Liberado" (transito ==
    # stock liberado). No aborta el sync entero por esta feature secundaria.
    try:
        backorder_map = sl_fetch_backorder_by_sku(sl_cfg, session)
    except Exception as e:
        log(f'[BACKORDER] exception no bloqueante: {e}. Continuo sin backorder_map.')
        backorder_map = {}
    # Stock SI se escribe COMPLETO (todos los items del grupo PESCA) - se usa para:
    # - indicador verde/rojo en el picker (bool via stock_map)
    # - cantidad exacta en el modal Master de Productos para vendedores
    #   (via qty_map - antes solo admin podia ver la cantidad porque
    #   requeria login SL desde el browser).
    write_stock_snapshot(db, stock_map, qty_map, whs_map, backorder_map, with_stock)
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

    # v282+: sync BPs pesca -> client_applications. Se ejecuta al final del
    # sync general para no bloquear items/stock si falla. Best-effort:
    # cualquier error queda logueado pero no aborta el sync entero.
    sync_bp_pesca(db, sl_cfg, session)

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
