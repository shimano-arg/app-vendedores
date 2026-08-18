"""
sync_sap_to_bigquery.py — Sync SAP B1 -> BigQuery (Power BI pipeline)

Complementa al sync_sap_to_firestore.py existente (que va solo al frontend).
Este script escribe DIRECTO a BigQuery para el pipeline Power BI:

  1) Login a SAP B1 Service Layer (creds leidas de Firestore
     app_config/sap_integration.serviceLayer — mismo pattern que el otro).
  2) Descarga:
       - Business Partners (customers): sap_bp_raw
       - Items del grupo PESCA (con stock + precio lista PESCA): sap_items_raw
       - Facturas (Invoices) ultimos 24 meses: sap_invoices_raw
       - Cotizaciones (Quotations) ultimos 24 meses: sap_quotations_raw
       - Ordenes de venta (Orders) ultimos 24 meses: sap_orders_raw  (v289+)
  3) Escribe a BigQuery con WRITE_TRUNCATE (full snapshot cada corrida).
     Cuando el volumen escale, migramos a delta por UpdateDate.

Dataset destino: app-vendedores-shimano.shimano_app (southamerica-east1).
Cada row incluye una columna _sync_timestamp (UTC ISO) para saber cuando fue
la ultima corrida.

Env vars requeridas:
  FIREBASE_SERVICE_ACCOUNT  Mismo SA JSON que sync_sap_to_firestore.py y
                            send_rendiciones_email. El SA tiene rol
                            BigQuery Data Editor + Studio User asignado
                            desde el backfill 2026-07-07.
Env vars opcionales:
  DRY_RUN                   'true' -> no escribe a BQ (para test).
  SL_INSECURE               'true' -> desactiva verify SSL en SL.
  SL_MAX_DOCS               cap de documentos por endpoint (default: sin cap).
                            Util para debug local sin pegarle a produccion.
  HISTORY_MONTHS            override de la ventana historica (default: 24).

Salidas del script:
  Exit 0  OK (o skip por serviceLayer.enabled=false).
  Exit 2  Env vars invalidas o Firestore inaccesible.
  Exit 3  Login SL fallo.
  Exit 4  SL error HTTP en algun fetch.
  Exit 5  BigQuery load fallo.
  Exit 6  No se pudo resolver el grupo PESCA en SAP.

Ejecucion:
  Local:   FIREBASE_SERVICE_ACCOUNT=$(cat sa-key.json) python scripts/sync_sap_to_bigquery.py
  GH Actions: .github/workflows/sync-sap-to-bigquery.yml (cron 13,43 * * * *)
"""
import base64
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from io import BytesIO

import requests
from urllib3.exceptions import InsecureRequestWarning

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print('[ERROR] firebase-admin no instalado. pip install firebase-admin', file=sys.stderr)
    sys.exit(2)

try:
    from google.cloud import bigquery
    from google.oauth2 import service_account
except ImportError:
    print('[ERROR] google-cloud-bigquery no instalado. pip install google-cloud-bigquery', file=sys.stderr)
    sys.exit(2)


# ============================================================
# Constantes de destino
# ============================================================
BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'

BQ_TABLE_BP         = f'{BQ_PROJECT}.{BQ_DATASET}.sap_bp_raw'
BQ_TABLE_ITEMS      = f'{BQ_PROJECT}.{BQ_DATASET}.sap_items_raw'
BQ_TABLE_INVOICES   = f'{BQ_PROJECT}.{BQ_DATASET}.sap_invoices_raw'
BQ_TABLE_CREDIT_NOTES = f'{BQ_PROJECT}.{BQ_DATASET}.sap_credit_notes_raw'
BQ_TABLE_QUOTATIONS = f'{BQ_PROJECT}.{BQ_DATASET}.sap_quotations_raw'
# v289+ (2026-07-10): Sales Orders (ORDR/RDR1 en SAP). Necesarias para
# calcular el BACKORDER = Cantidad_Quotation - Cantidad_SO_generada para
# el dashboard "Inventario y Backorder" de Power BI.
BQ_TABLE_ORDERS     = f'{BQ_PROJECT}.{BQ_DATASET}.sap_orders_raw'
# v289+ (2026-07-10): Purchase Orders (OPOR/POR1 en SAP). Hoy Shimano PESCA
# NO carga POs sistematicamente (cargan el embarque cuando llega y ven a
# posteriori). A futuro van a cargar POs con fecha estimada de llegada para
# tener previsibilidad -> el dashboard va a mostrar "ASIGNADO a embarque"
# + fecha para los SKUs con PO abierta. Sincronizamos ya para tener la
# tabla lista cuando arranquen a cargarlas (sin re-codear).
BQ_TABLE_PURCHASE_ORDERS = f'{BQ_PROJECT}.{BQ_DATASET}.sap_purchase_orders_raw'
# v386+ (2026-08-03): DeliveryNotes (ODLN/DLN1 en SAP). Necesarias para el
# reporte REMITIDO en Power BI. Aunque el 99.7% de las facturas se generan
# desde el SO directo (BaseType=17, no BaseType=15), en SAP existen 18k+
# DeliveryNotes paralelas que representan el pase real a deposito. Regla
# hibrida en v_remitos_lineas: si el SO tiene Delivery -> usar la fecha
# del remito; si no -> fallback a la fecha de la factura.
BQ_TABLE_DELIVERIES      = f'{BQ_PROJECT}.{BQ_DATASET}.sap_deliveries_raw'
# v386.2+ (2026-08-04): Returns (ORIN/RIN1 en SAP). Contrapartida fisica del
# Delivery cuando el cliente devuelve mercaderia. Sin restar Returns,
# v_remitos_lineas queda inflada por las devoluciones (mismo bug conceptual
# que Credit Notes en v_facturas_sap v367).
BQ_TABLE_RETURNS         = f'{BQ_PROJECT}.{BQ_DATASET}.sap_returns_raw'
BQ_TABLE_TARGETS         = f'{BQ_PROJECT}.{BQ_DATASET}.targets_raw'
BQ_TABLE_CAMPAIGNS       = f'{BQ_PROJECT}.{BQ_DATASET}.campaigns_raw'

# Codigo de la lista PESCA en SAP (misma que sync_sap_to_firestore.py).
PESCA_PRICE_LIST_NUM = 12

# Warehouses no vendibles (misma logica): 05 Marketing, 06 Devoluciones.
NON_SALES_WHS = {'05', '06'}

# Ventana historica default (meses). El env HISTORY_MONTHS puede overridear.
# v289 iter5 (2026-07-10): bajamos de 24 -> 12. PESCA arranco venta directa hace
# ~1 mes; 12 meses cubre estacionalidad y corta ~50% del volumen de invoices/
# quotations/orders/POs (~50% del tiempo de sync). Subir de nuevo cuando el
# historial post-Baraldo justifique.
DEFAULT_HISTORY_MONTHS = 12

# Page size del SL v10. En SL, `$top=N` funciona como "cap total" (te resta
# hasta llegar a 0), NO como page size. Para page size hay que usar el header
# `Prefer: odata.maxpagesize=N`. Se puede pedir hasta 500. Con esto Items
# pasa de 38 pags -> 2 pags (2 x 500).
SL_PAGE_SIZE = 500


# ============================================================
# Helpers
# ============================================================
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(msg: str) -> None:
    print(f'[{now_iso()}] {msg}', flush=True)


def env_bool(name: str) -> bool:
    return os.environ.get(name, '').lower() in ('true', '1', 'yes')


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, '').strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def parse_sa_json() -> dict:
    """Lee y parsea FIREBASE_SERVICE_ACCOUNT env var."""
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if not sa_json:
        log('[FATAL] FIREBASE_SERVICE_ACCOUNT env var vacia')
        sys.exit(2)
    # Base64 opcional (algunos secrets managers agregan padding raro).
    if not sa_json.startswith('{'):
        try:
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        except Exception:
            pass
    try:
        return json.loads(sa_json)
    except json.JSONDecodeError as e:
        log(f'[FATAL] FIREBASE_SERVICE_ACCOUNT no es JSON valido: {e}')
        sys.exit(2)


def init_firestore(sa_data: dict) -> firestore.Client:
    cred = credentials.Certificate(sa_data)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def init_bigquery(sa_data: dict) -> bigquery.Client:
    """Inicializa el cliente BigQuery con las credenciales del SA."""
    creds = service_account.Credentials.from_service_account_info(sa_data)
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


def get_sl_config(db: firestore.Client) -> dict:
    """Lee app_config/sap_integration.serviceLayer de Firestore."""
    snap = db.collection('app_config').document('sap_integration').get()
    if not snap.exists:
        log('[FATAL] app_config/sap_integration no existe')
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
    resp = session.post(
        f"{cfg['url']}/b1s/v1/Login",
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
    """Lookup dinamico del ItemsGroupCode del grupo PESCA."""
    path = "/b1s/v1/ItemGroups?$filter=GroupName eq 'PESCA'&$select=Number,GroupName"
    resp = session.get(f"{cfg['url']}{path}", timeout=30)
    if not resp.ok:
        log(f"[FATAL] no pude resolver grupo PESCA: HTTP {resp.status_code}")
        sys.exit(6)
    arr = resp.json().get('value', []) or []
    if not arr:
        log("[FATAL] no existe un grupo llamado 'PESCA' en SAP")
        sys.exit(6)
    return int(arr[0]['Number'])


# ============================================================
# Fetch desde SL (paginado + retry en 401)
# ============================================================
def sl_fetch_all(cfg, session, path_base, entity_name,
                 select_fields=None, filter_expr=None, max_docs=0):
    """
    Itera un endpoint OData con @odata.nextLink hasta agotar todas las paginas.
    Devuelve la lista completa de docs (dicts).

    Args:
      path_base: e.g. '/b1s/v1/Invoices'
      entity_name: para logs ('BP', 'ITEMS', etc.)
      select_fields: lista de campos para $select
      filter_expr: expresion $filter
      max_docs: cap de docs para debug (0 = sin cap)
    """
    parts = [path_base]
    query = []
    if filter_expr:
        query.append(f"$filter={filter_expr}")
    if select_fields:
        query.append(f"$select={','.join(select_fields)}")
    if query:
        parts.append('?' + '&'.join(query))
    url_path = ''.join(parts)
    # v289 iter6: page size via header (no $top - $top actua como cap total).
    page_size_headers = {'Prefer': f'odata.maxpagesize={SL_PAGE_SIZE}'}

    docs = []
    page = 0
    last_progress_log = time.time()
    while url_path:
        url = url_path if url_path.startswith('http') else f"{cfg['url']}{url_path}"
        try:
            resp = session.get(url, timeout=60, headers=page_size_headers)
        except requests.RequestException as e:
            log(f'[SL/{entity_name}] error de red pag {page}: {e}. Retry en 5s.')
            time.sleep(5)
            resp = session.get(url, timeout=60, headers=page_size_headers)
        if resp.status_code == 401:
            log(f'[SL/{entity_name}] 401 - re-login y retry')
            sl_login(cfg, session)
            resp = session.get(url, timeout=60, headers=page_size_headers)
        if not resp.ok:
            try:
                detail = resp.json().get('error', {}).get('message', {}).get('value', '')
            except Exception:
                detail = resp.text[:200]
            log(f'[FATAL/{entity_name}] HTTP {resp.status_code} - {detail}. Path: {url_path}')
            sys.exit(4)
        body = resp.json()
        page_docs = body.get('value', []) or []
        docs.extend(page_docs)
        page += 1
        if time.time() - last_progress_log > 5:
            log(f'[SL/{entity_name}] pag {page}: {len(docs)} docs')
            last_progress_log = time.time()
        if max_docs and len(docs) >= max_docs:
            log(f'[SL/{entity_name}] cap {max_docs} alcanzado')
            docs = docs[:max_docs]
            break
        # v289 iter3 (2026-07-10): SL v10+ devuelve nextLink con @, versiones
        # viejas sin @. Chequear ambos para no cortar el paginado en pag 1.
        # (Mismo fix que ya se aplico en sync_sap_to_firestore.py)
        next_link = body.get('@odata.nextLink') or body.get('odata.nextLink')
        if not next_link:
            break
        # Normalizar: puede venir absoluto (http://...) o relativo (/b1s/...) o
        # sin barra ('Items?...').
        if next_link.startswith('http'):
            idx = next_link.find('/b1s/v1/')
            url_path = next_link[idx:] if idx >= 0 else next_link
        elif next_link.startswith('/'):
            url_path = next_link
        else:
            url_path = '/b1s/v1/' + next_link
        # Safety cap para evitar loops infinitos.
        if page > 500:
            log(f'[SL/{entity_name}] safety cap 500 paginas alcanzado, cortando')
            break
    log(f'[SL/{entity_name}] total: {len(docs)} docs en {page} paginas')
    return docs


# ============================================================
# Normalizacion: aplanar a rows para BigQuery
# ============================================================
def flatten_bp(bp: dict, sync_ts: str) -> dict:
    return {
        'card_code': bp.get('CardCode'),
        'card_name': bp.get('CardName'),
        'card_type': bp.get('CardType'),
        'group_code': bp.get('GroupCode'),
        'currency': bp.get('Currency'),
        'address': bp.get('Address'),
        'city': bp.get('City'),
        'zip_code': bp.get('ZipCode'),
        # state queda en None por ahora (State1 fue removido del schema SL en
        # 2026-07-08). Se puede extraer de BPAddresses en la vista Fase 2.
        'state': None,
        'country': bp.get('Country'),
        'email': bp.get('EmailAddress'),
        'phone1': bp.get('Phone1'),
        'cellular': bp.get('Cellular'),
        'pay_terms_group_code': bp.get('PayTermsGrpCode'),
        # credit_line, current_account_balance, notes removidos del select
        # (ver comentario en main). Mantenemos las columnas en el schema BQ
        # con null para no romper vistas o consumers downstream.
        'credit_line': None,
        'current_account_balance': None,
        'sales_person_code': bp.get('SalesPersonCode'),
        'notes': None,
        'valid': bp.get('Valid'),
        'frozen': bp.get('Frozen'),
        'create_date': bp.get('CreateDate'),
        'update_date': bp.get('UpdateDate'),
        '_sync_timestamp': sync_ts,
    }


def load_local_categorization_from_html() -> dict:
    """
    v289+: replica de la funcion homonima en sync_sap_to_firestore.py.
    Lee el mapa {code: {cat, fam, sub}} desde el CSV inline `const PRODUCTS =
    [...]` en index.html del repo. Este mapping es la fuente de verdad de
    la categorizacion del catalogo pesca (cargada a mano por producto).
    SAP no tiene la categoria fina - solo el ItemsGroupCode = PESCA.

    Se usa para poblar cat/fam/sub en sap_items_raw asi Power BI puede
    hacer el treemap Familia/Subfamilia sin joins raros.

    Retorna dict vacio si no encuentra la linea (no critico).
    """
    result = {}
    html_path = os.path.join(os.path.dirname(__file__), '..', 'index.html')
    html_path = os.path.abspath(html_path)
    if not os.path.exists(html_path):
        log(f'[WARN] index.html no encontrado en {html_path}, no puedo leer categorias')
        return result
    try:
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
    log(f'[cat] {len(result)} items con categorizacion en index.html')
    return result


# Cache modulo-level: cargar el CSV una sola vez por corrida.
_LOCAL_CATEGORIZATION_CACHE = None


def get_local_categorization() -> dict:
    global _LOCAL_CATEGORIZATION_CACHE
    if _LOCAL_CATEGORIZATION_CACHE is None:
        _LOCAL_CATEGORIZATION_CACHE = load_local_categorization_from_html()
    return _LOCAL_CATEGORIZATION_CACHE


def flatten_item(item: dict, price_list_num: int, sync_ts: str) -> dict:
    """Aplana un Item de SAP para BQ: suma stock vendible + extrae precio PESCA + costo por warehouse."""
    def _safe_float(x):
        try:
            return float(x) if x is not None else None
        except (TypeError, ValueError):
            return None
    total_qty = 0.0
    whs_stock = {}
    # v289 iter2: costo ponderado por warehouse (SUM stock*costo / SUM stock).
    # StandardAveragePrice viene por deposito en algunos SAP; si no, dejamos None.
    weighted_cost_num = 0.0
    weighted_cost_den = 0.0
    for w in (item.get('ItemWarehouseInfoCollection') or []):
        whs_code = w.get('WarehouseCode') or ''
        try:
            qty = float(w.get('InStock') or 0)
        except (TypeError, ValueError):
            qty = 0.0
        whs_stock[whs_code] = qty
        if whs_code in NON_SALES_WHS:
            continue
        total_qty += qty
        # Costo promedio ponderado de warehouses vendibles.
        c = _safe_float(w.get('StandardAveragePrice'))
        if c is not None and c > 0 and qty > 0:
            weighted_cost_num += c * qty
            weighted_cost_den += qty
    price_pesca = None
    for ip in (item.get('ItemPrices') or []):
        if ip.get('PriceList') == price_list_num:
            p = ip.get('Price')
            if p is not None:
                try:
                    price_pesca = float(p)
                except (TypeError, ValueError):
                    pass
            break
    # v289 iter2: costo por unidad. Si no hay stock ni costo por warehouse,
    # queda None y Power BI lo trata como faltante (skip en Valor Inventario Costo).
    cost_avg = (weighted_cost_num / weighted_cost_den) if weighted_cost_den > 0 else None
    # last_purchase queda para compat con el schema (siempre None hasta que
    # este SAP exponga LastPurchasePrice o algun campo equivalente).
    last_purchase = None
    avg_std = cost_avg
    # v289+: buscar la categorizacion cat/fam/sub del catalogo pesca.
    # v527 (2026-08-14): fallback a UDFs de SAP (U_CATEGORIA/U_FAMILIA/
    # U_SUBFAMILIA de OITM Ficha Tecnica Pesca) cuando el SKU no esta en
    # index.html PRODUCTS. Antes ~92 SKUs quedaban con cat/fam/sub vacios
    # aunque SAP los tenia cargados (ej: CVC70H con SUBFAMILIA "FW Casting"
    # en SAP salia "SIN SUBFAMILIA" en Power BI).
    cat_all = get_local_categorization()
    _cat_map = cat_all.get(item.get('ItemCode') or '', {})
    _cat_local = (_cat_map.get('cat') or '').strip()
    _fam_local = (_cat_map.get('fam') or '').strip()
    _sub_local = (_cat_map.get('sub') or '').strip()
    # UDFs SAP (fallback). Si vienen None (UDF no existe con ese nombre),
    # queda '' y no hay side-effect.
    _cat_sap = (item.get('U_CATEGORIA') or '').strip() if item.get('U_CATEGORIA') else ''
    _fam_sap = (item.get('U_FAMILIA') or '').strip() if item.get('U_FAMILIA') else ''
    _sub_sap = (item.get('U_SUBFAMILIA') or '').strip() if item.get('U_SUBFAMILIA') else ''
    return {
        'item_code': item.get('ItemCode'),
        'item_name': item.get('ItemName'),
        'foreign_name': item.get('ForeignName'),
        'items_group_code': item.get('ItemsGroupCode'),
        'valid': item.get('Valid'),
        'frozen': item.get('Frozen'),
        'create_date': item.get('CreateDate'),
        'update_date': item.get('UpdateDate'),
        'stock_total_sellable': int(round(total_qty)),
        'stock_by_warehouse_json': json.dumps(whs_stock, default=str) if whs_stock else None,
        'price_pesca_ars': price_pesca,
        # v289+: costos del item (2 fuentes de SAP para redundancia).
        # Power BI usa COALESCE(cost_avg_ars, cost_last_purchase_ars) para
        # tener siempre un valor razonable.
        'cost_last_purchase_ars': last_purchase,
        'cost_avg_ars': avg_std,
        # v289/v527: categorizacion prioridad = catalogo local (index.html
        # PRODUCTS) -> UDFs SAP OITM (fallback). Los SKUs cargados en
        # index.html mantienen la categorizacion curada (mas fina, con
        # sub-familia comercial); los que solo estan en SAP toman los
        # valores del maestro.
        'cat': _cat_local or _cat_sap,
        'fam': _fam_local or _fam_sap,
        'sub': _sub_local or _sub_sap,
        '_sync_timestamp': sync_ts,
    }


def flatten_doc(doc: dict, doc_type: str, sync_ts: str) -> dict:
    """
    Aplana una factura o cotizacion. DocumentLines (array anidado) se guarda
    como JSON string en la columna lines_json para no explotar el schema.
    Cuando armemos las vistas curadas de Fase 2 haremos UNNEST desde ahi.
    """
    lines = doc.get('DocumentLines') or []
    return {
        'doc_type': doc_type,
        'doc_entry': doc.get('DocEntry'),
        'doc_num': doc.get('DocNum'),
        'doc_date': doc.get('DocDate'),
        'doc_due_date': doc.get('DocDueDate'),
        'document_status': doc.get('DocumentStatus'),
        'cancelled': doc.get('Cancelled'),
        'card_code': doc.get('CardCode'),
        'card_name': doc.get('CardName'),
        'doc_currency': doc.get('DocCurrency'),
        'doc_total': doc.get('DocTotal'),
        'doc_total_fc': doc.get('DocTotalFc'),
        'doc_rate': doc.get('DocRate'),
        'discount_percent': doc.get('DiscountPercent'),
        'total_discount': doc.get('TotalDiscount'),
        # v302+ (2026-07-20): PaidToDate para calcular deuda por vendedor.
        # DocumentBalance NO existe en el schema Shimano (SL 400).
        # El saldo se calcula en la vista v_deuda_por_vendedor como
        # doc_total - paid_to_date. Solo poblado para INVOICE (facturas);
        # en QUOTATION/ORDER/PO viene null y no molesta.
        'paid_to_date': doc.get('PaidToDate'),
        'sales_person_code': doc.get('SalesPersonCode'),
        'comments': doc.get('Comments'),
        'jrnl_memo': doc.get('JournalMemo'),
        'payment_group_code': doc.get('PaymentGroupCode'),
        'series': doc.get('Series'),
        'create_date': doc.get('CreationDate'),
        'update_date': doc.get('UpdateDate'),
        'lines_count': len(lines),
        'lines_json': json.dumps(lines, default=str) if lines else None,
        '_sync_timestamp': sync_ts,
    }


# ============================================================
# Carga a BigQuery (WRITE_TRUNCATE)
# ============================================================
def sync_targets_from_firestore(db: firestore.Client, sync_ts: str) -> list:
    """Lee la coleccion `targets` de Firestore y aplana a rows para BQ.
    Fields cargados por la app (ver index.html: saveTargets):
      sellerId       STRING   vendorKey uppercase, ej 'GONZALO DE LA ROSA'
      year           INT      2026, 2027, ...
      month          INT      0-11 (indice del array MESES 0-indexed)
      targetArs      NUMBER   objetivo del mes en ARS (suma de las familias)
      targetByFamily MAP      v310+: desglose por familia REEL/CANAS/LINEAS
      updatedAt      TS
      updatedBy      STRING   uid
      updatedByEmail STRING

    v310+: targetByFamily se aplana a columnas explicitas target_reel_ars,
    target_canas_ars, target_lineas_ars. Docs viejos sin targetByFamily
    (pre-v310) quedan con esas columnas en null; v_targets usa COALESCE
    para exponer el target_ars global igual que antes.

    NOTA: el schema resultante en BQ preserva month 0-11. La conversion
    a 1-12 vive en la vista v_targets para no romper la fidelidad de la
    tabla staging."""
    log('[TARGETS] leyendo coleccion targets de Firestore...')
    rows = []
    for d in db.collection('targets').stream():
        data = d.to_dict() or {}
        try:
            target = float(data.get('targetArs', 0) or 0)
        except (TypeError, ValueError):
            log(f'[TARGETS] skip {d.id}: targetArs invalido ({data.get("targetArs")!r})')
            continue
        if target <= 0:
            continue  # skip meses sin cargar
        updated_at = data.get('updatedAt')
        by_fam = data.get('targetByFamily') or {}
        def _safe_num(v):
            try: return float(v) if v is not None else None
            except (TypeError, ValueError): return None
        rows.append({
            'doc_id':           d.id,
            'seller_id':        data.get('sellerId', ''),
            'year':             int(data.get('year', 0) or 0),
            'month':            int(data.get('month', -1)),  # 0-11
            'target_ars':       target,
            'target_reel_ars':   _safe_num(by_fam.get('REEL')),
            'target_canas_ars':  _safe_num(by_fam.get('CANAS')),
            'target_lineas_ars': _safe_num(by_fam.get('LINEAS')),
            'updated_at':       updated_at.isoformat() if updated_at else None,
            'updated_by':       data.get('updatedBy', ''),
            'updated_by_email': data.get('updatedByEmail', ''),
            '_sync_timestamp':  sync_ts,
        })
    log(f'[TARGETS] {len(rows)} rows validas (target > 0)')
    return rows


def sync_campaigns_from_firestore(db: firestore.Client, sync_ts: str) -> list:
    """v367+: lee la coleccion `campaigns` de Firestore y aplana a rows para BQ.
    Fields cargados por la app (ver src/domains/campanias.js: crearCampania):
      name              STRING   (nombre, requerido)
      familia           STRING   (ej: 'REELS', 'CANAS')
      subfamilia        STRING
      skus              ARRAY    (ItemCodes incluidos, ej ['REEL4000',...])
      filterType        STRING   ('sku' hoy, extensible)
      filterValues      ARRAY    (copia de skus)
      targetType        STRING   ('units' | 'money')
      targetAmount      NUMBER
      startDate         DATE ISO ('2026-07-30')
      endDate           DATE ISO ('2026-08-29')
      scope             STRING   ('all' | 'province' | 'vendor')
      scopeValues       ARRAY    (provincias o vendor keys si scope != 'all')
      createdBy         STRING   (uid)
      createdByEmail    STRING
      createdAt         TS
      archivedManually  BOOL     (finalizada antes de endDate)
      archivedAt        TS
      archivedBy        STRING

    Serializamos skus y scope_values como STRING JSON (usar JSON_EXTRACT_ARRAY
    en la vista v_campanias_progreso). BQ ARRAY nested tira problemas con
    autodetect + UNNEST cross-view; string JSON es mas robusto y compatible
    con el patron que ya usan sap_invoices_raw.lines_json.
    WRITE_TRUNCATE cada sync: dedup por construccion."""
    log('[CAMPAIGNS] leyendo coleccion campaigns de Firestore...')
    rows = []
    for d in db.collection('campaigns').stream():
        data = d.to_dict() or {}
        name = (data.get('name') or '').strip()
        if not name:
            log(f'[CAMPAIGNS] skip {d.id}: name vacio')
            continue
        try:
            target_amount = float(data.get('targetAmount', 0) or 0)
        except (TypeError, ValueError):
            log(f'[CAMPAIGNS] skip {d.id}: targetAmount invalido ({data.get("targetAmount")!r})')
            continue
        if target_amount <= 0:
            log(f'[CAMPAIGNS] skip {d.id}: targetAmount <= 0')
            continue
        target_type = (data.get('targetType') or 'money').lower()
        if target_type not in ('units', 'money'):
            target_type = 'money'
        scope = (data.get('scope') or 'all').lower()
        if scope not in ('all', 'province', 'vendor'):
            scope = 'all'
        skus_list = data.get('skus') or []
        if not isinstance(skus_list, list):
            skus_list = []
        scope_vals = data.get('scopeValues') or []
        if not isinstance(scope_vals, list):
            scope_vals = []
        created_at = data.get('createdAt')
        archived_at = data.get('archivedAt')
        rows.append({
            'campaign_id':      d.id,
            'name':             name,
            'familia':          (data.get('familia') or '').strip(),
            'subfamilia':       (data.get('subfamilia') or '').strip(),
            'skus_json':        json.dumps([str(s) for s in skus_list if s]),
            'skus_count':       len([s for s in skus_list if s]),
            'target_type':      target_type,
            'target_amount':    target_amount,
            'start_date':       data.get('startDate') or None,   # ISO 'YYYY-MM-DD'
            'end_date':         data.get('endDate') or None,
            'scope':            scope,
            'scope_values_json': json.dumps([str(v) for v in scope_vals if v]),
            'created_by':       data.get('createdBy', ''),
            'created_by_email': data.get('createdByEmail', ''),
            'created_at':       created_at.isoformat() if created_at else None,
            'archived':         bool(data.get('archivedManually')),
            'archived_at':      archived_at.isoformat() if archived_at else None,
            'archived_by':      data.get('archivedBy', ''),
            '_sync_timestamp':  sync_ts,
        })
    log(f'[CAMPAIGNS] {len(rows)} campanias validas (name + targetAmount > 0)')
    return rows


def sync_dashboard_snapshot_to_firestore(bq_client: bigquery.Client,
                                          db: firestore.Client,
                                          dry_run: bool = False) -> int:
    """v367+ (2026-07-30): agrega los KPIs de v_facturas_sap + v_ventas_lineas
    por (vendedor, año, mes) y los escribe a Firestore `sap_snapshot/{doc_id}`
    para que el Dashboard de la app pueda mostrar facturado real SAP + unidades
    + % cumplimiento vs target, en linea con el TABLERO SAR de Power BI.

    Doc ID canonico: {vendorKey_normalizado}_{YYYY}_{MM}, ej
    'GONZALO_DE_LA_ROSA_2026_07'. Convencion identica a la de targets_raw
    para que la app pueda cruzar sap_snapshot con targets en el cliente.

    Solo agrega vendedores donde `assigned_vendor` de client_applications no
    sea NULL (los 6 vendedores pesca reales de la app: GONZALO DE LA ROSA,
    FEDERICO CASTELANELLI, MARTIN BOIERO, MAURICIO GIL, IOANNIS PALKOUDAKIS,
    SANTIAGO ESTEBAN). Ignora facturas historicas de Baraldo (assigned_vendor
    NULL). Ventana: año actual completo (mes 1..12).

    Retorna la cantidad de docs escritos (util para logging).

    UI en la app: src/domains/dashboard.js lee la coleccion sap_snapshot y
    la usa en las cards MES EN CURSO y ACUMULADO ANUAL del modal Dashboard.
    """
    log('[SNAPSHOT] agregando v_facturas_sap + v_ventas_lineas por (vendor, año, mes)...')
    from datetime import date as _date
    current_year = _date.today().year
    query = f"""
    WITH fact AS (
      SELECT
        assigned_vendor,
        EXTRACT(YEAR  FROM doc_date) AS anio,
        EXTRACT(MONTH FROM doc_date) AS mes,
        SUM(doc_total)                                              AS facturado_ars_neto,
        SUM(CASE WHEN doc_kind='INVOICE'      THEN doc_total ELSE 0 END) AS facturado_ars_bruto,
        SUM(CASE WHEN doc_kind='CREDIT_NOTE'  THEN doc_total ELSE 0 END) AS ncs_ars,
        COUNTIF(doc_kind='INVOICE')                                 AS facturas_count,
        COUNTIF(doc_kind='CREDIT_NOTE')                             AS ncs_count
      FROM `app-vendedores-shimano.shimano_app.v_facturas_sap`
      WHERE assigned_vendor IS NOT NULL
        AND EXTRACT(YEAR FROM doc_date) = {current_year}
        AND COALESCE(cancelled, 'tNO') = 'tNO'
      GROUP BY assigned_vendor, anio, mes
    ),
    unid AS (
      SELECT
        assigned_vendor,
        EXTRACT(YEAR  FROM doc_date) AS anio,
        EXTRACT(MONTH FROM doc_date) AS mes,
        SUM(cantidad)                AS unidades_neto,
        SUM(importe_linea_ars)       AS importe_lineas_ars_neto
      FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
      WHERE assigned_vendor IS NOT NULL
        AND EXTRACT(YEAR FROM doc_date) = {current_year}
      GROUP BY assigned_vendor, anio, mes
    )
    SELECT
      f.assigned_vendor,
      f.anio,
      f.mes,
      f.facturado_ars_neto,
      f.facturado_ars_bruto,
      f.ncs_ars,
      f.facturas_count,
      f.ncs_count,
      COALESCE(u.unidades_neto, 0)          AS unidades_neto,
      COALESCE(u.importe_lineas_ars_neto, 0) AS importe_lineas_ars_neto
    FROM fact f
    LEFT JOIN unid u
      ON u.assigned_vendor = f.assigned_vendor
     AND u.anio = f.anio
     AND u.mes  = f.mes
    """
    rows = list(bq_client.query(query, location=BQ_LOCATION).result())
    if not rows:
        log('[SNAPSHOT] 0 filas en la agregacion (verificar que v_facturas_sap tenga datos del año actual)')
        return 0
    if dry_run:
        log(f'[SNAPSHOT] DRY-RUN: {len(rows)} docs listos para escribir a Firestore')
        return 0
    coll = db.collection('sap_snapshot')
    batch = db.batch()
    written = 0
    for row in rows:
        d = dict(row.items())
        vendor_key = d['assigned_vendor']
        vendor_norm = vendor_key.replace(' ', '_').upper()
        doc_id = f"{vendor_norm}_{d['anio']}_{d['mes']:02d}"
        payload = {
            'vendorKey':               vendor_key,
            'anio':                    int(d['anio']),
            'mes':                     int(d['mes']),
            'facturadoArsNeto':        float(d['facturado_ars_neto'] or 0),
            'facturadoArsBruto':       float(d['facturado_ars_bruto'] or 0),
            'ncsArs':                  float(d['ncs_ars'] or 0),
            'facturasCount':           int(d['facturas_count'] or 0),
            'ncsCount':                int(d['ncs_count'] or 0),
            'unidadesNeto':            float(d['unidades_neto'] or 0),
            'importeLineasArsNeto':    float(d['importe_lineas_ars_neto'] or 0),
            'updatedAt':               firestore.SERVER_TIMESTAMP,
        }
        batch.set(coll.document(doc_id), payload)
        written += 1
        if written % 400 == 0:
            batch.commit()
            batch = db.batch()
    if written % 400 != 0:
        batch.commit()
    log(f'[SNAPSHOT] {written} docs escritos a sap_snapshot (año {current_year})')
    return written


def sync_backorder_snapshot_to_firestore(bq_client: bigquery.Client,
                                          db: firestore.Client,
                                          dry_run: bool = False) -> int:
    """v398+ (2026-08-05): agrega v_backorder_lineas por vendedor y escribe
    a Firestore backorder_snapshot/{VENDOR_NORM} con {lines: [array de
    lineas SQ open sin stock]}. Alimenta la nueva tab BACKORDERS de la app:
    cuando llega mercaderia el vendedor busca por SKU y ve que clientes
    lo tenian pedido para avisarles.

    Estrategia:
    - 1 doc por vendedor (~6 vendedores + '(SIN ASIGNAR)' fallback).
    - JOIN con client_applications_raw_raw_latest para obtener assignedVendor
      por cliente_code.
    - Vendedor lee solo su doc; admin/gerente/interno leen todos.
    - Firestore doc size ~50-500 KB por vendedor (dentro del limite 1MB).
    """
    log('[BACKORDER] agregando v_backorder_lineas por vendedor...')
    query = """
    WITH backorder AS (
      SELECT sku, producto, familia, subfamilia, is_pesca,
             pedido, pendiente, stock_actual, precio_unitario,
             cliente_code, cliente_nombre, cliente_ciudad,
             sq_doc_num, sq_doc_date, estado
      FROM `app-vendedores-shimano.shimano_app.v_backorder_lineas`
      WHERE pendiente > 0
    ),
    cliente_vendor AS (
      SELECT
        JSON_VALUE(data, '$.cardCodeSap') AS card_code,
        ARRAY_AGG(
          IFNULL(NULLIF(JSON_VALUE(data, '$.assignedVendor'), ''), '(SIN ASIGNAR)')
          IGNORE NULLS ORDER BY document_id LIMIT 1
        )[SAFE_OFFSET(0)] AS assigned_vendor
      FROM `app-vendedores-shimano.shimano_app.client_applications_raw_raw_latest`
      WHERE JSON_VALUE(data, '$.cardCodeSap') IS NOT NULL
        AND JSON_VALUE(data, '$.cardCodeSap') != ''
      GROUP BY card_code
    )
    SELECT
      b.*,
      IFNULL(cv.assigned_vendor, '(SIN ASIGNAR)') AS assigned_vendor
    FROM backorder b
    LEFT JOIN cliente_vendor cv ON cv.card_code = b.cliente_code
    ORDER BY assigned_vendor, cliente_nombre, sku
    """
    rows = list(bq_client.query(query, location=BQ_LOCATION).result())
    if not rows:
        log('[BACKORDER] 0 filas (v_backorder_lineas vacia o pendiente<=0 en todas)')
        return 0
    # Group by vendor
    by_vendor: dict = {}
    for row in rows:
        d = dict(row.items())
        vendor = d.pop('assigned_vendor', '(SIN ASIGNAR)') or '(SIN ASIGNAR)'
        # Firestore-friendly types: convertir dates a ISO strings.
        if d.get('sq_doc_date'):
            d['sq_doc_date'] = d['sq_doc_date'].isoformat()
        # Solo lineas de PESCA (v_backorder_lineas ya trae otros items tambien
        # pero para la app filtramos solo pesca)
        if not d.get('is_pesca'):
            continue
        d = {
            'sku':              d.get('sku') or '',
            'producto':         d.get('producto') or '',
            'familia':          d.get('familia') or '',
            'subfamilia':       d.get('subfamilia') or '',
            'pendiente':        float(d.get('pendiente') or 0),
            'pedido':           float(d.get('pedido') or 0),
            'stockActual':      int(d.get('stock_actual') or 0),
            'precioUnitario':   float(d.get('precio_unitario') or 0),
            'clienteCode':      d.get('cliente_code') or '',
            'clienteNombre':    d.get('cliente_nombre') or '',
            'clienteCiudad':    d.get('cliente_ciudad') or '',
            'sqDocNum':         int(d.get('sq_doc_num') or 0),
            'sqDocDate':        d.get('sq_doc_date') or '',
            'estado':           d.get('estado') or '',
        }
        by_vendor.setdefault(vendor, []).append(d)
    log(f'[BACKORDER] {sum(len(v) for v in by_vendor.values())} lineas pesca en {len(by_vendor)} vendedores')
    if dry_run:
        for v, lines in by_vendor.items():
            log(f'  DRY-RUN {v}: {len(lines)} lineas')
        return 0
    coll = db.collection('backorder_snapshot')
    written = 0
    for vendor, lines in by_vendor.items():
        vendor_norm = vendor.replace(' ', '_').replace('(', '').replace(')', '').upper()
        payload = {
            'vendorKey': vendor,
            'linesCount': len(lines),
            'lines': lines,
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }
        coll.document(vendor_norm).set(payload)
        written += 1
    # Cleanup: borrar docs de vendedores que ya no tienen backorder.
    existing_ids = {vendor.replace(' ', '_').replace('(', '').replace(')', '').upper()
                     for vendor in by_vendor.keys()}
    for doc in coll.stream():
        if doc.id not in existing_ids:
            doc.reference.delete()
            log(f'[BACKORDER] cleanup: borrado doc {doc.id} (sin backorder)')
    log(f'[BACKORDER] {written} docs escritos a backorder_snapshot')
    return written


def _sanitize_sku_doc_id(sku: str) -> str:
    """Firestore doc IDs no toleran '/', '.', '..'. Los SKUs SAP suelen ser
    alfanumericos limpios pero por defensividad sanitizamos igual. Prefix
    'SKU_' evita colisiones con otros patterns de doc id + facilita debug."""
    s = str(sku or '').strip().upper()
    for ch in ('/', '.', '\\', '#', '?', '[', ']', '*'):
        s = s.replace(ch, '_')
    return f'SKU_{s[:1400]}'


def sync_sku_ventas_snapshot_to_firestore(bq_client: bigquery.Client,
                                            db: firestore.Client,
                                            dry_run: bool = False) -> int:
    """v42x+ (2026-08-06): agrega v_ventas_lineas por (item_code, año, mes)
    para los ultimos 13 meses y escribe a Firestore
    `sku_ventas_snapshot/SKU_{item_code_saneado}` con la estructura:

      {
        sku:        'REEL4000FI',
        itemName:   'STELLA 4000 FI',
        familia:    'CARRETES',
        subfamilia: 'STELLA',
        meses: {
          '2025-08': {qty: 20.0, ars: 500000.0},
          '2025-09': {qty: 15.0, ars: 375000.0},
          ...
          '2026-08': {qty:  5.0, ars: 125000.0}
        },
        updatedAt: SERVER_TIMESTAMP
      }

    Alimenta el modal FORECAST (admin-only) que compara ventas historicas
    vs Sales Plan cargado por el user + politica de inventario. El unico
    lector desde el frontend es src/domains/forecast.js.

    Diseño:
      - 1 doc por SKU con array de meses adentro (~755 docs total para
        grupo PESCA activo). Reduce reads del frontend (1 bulk get vs
        755 x 13 = ~10k docs).
      - Ventana de 13 meses para cubrir 12 completos + parcial del actual
        (ej: en agosto, incluye agosto pasado como mes 13).
      - familia/subfamilia usan ANY_VALUE — asumen invariancia por SKU
        (si hay cambios de master, queda una arbitraria; aceptable).

    Retorna cantidad de docs escritos.
    """
    log('[SKU_VENTAS] agregando v_ventas_lineas por (sku, año, mes) - ventana 13m...')
    query = """
    WITH lineas_13m AS (
      SELECT
        item_code,
        item_name_catalogo,
        familia,
        subfamilia,
        EXTRACT(YEAR  FROM doc_date) AS anio,
        EXTRACT(MONTH FROM doc_date) AS mes,
        cantidad,
        importe_linea_ars
      FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
      WHERE doc_date >= DATE_SUB(CURRENT_DATE('America/Argentina/Buenos_Aires'), INTERVAL 13 MONTH)
        AND item_code IS NOT NULL
        AND item_code != ''
    ),
    por_sku_mes AS (
      SELECT
        item_code,
        ANY_VALUE(item_name_catalogo) AS item_name,
        ANY_VALUE(familia)            AS familia,
        ANY_VALUE(subfamilia)         AS subfamilia,
        anio,
        mes,
        SUM(cantidad)                 AS cantidad_neta,
        SUM(importe_linea_ars)        AS importe_ars_neto
      FROM lineas_13m
      GROUP BY item_code, anio, mes
    )
    SELECT
      item_code,
      ANY_VALUE(item_name)   AS item_name,
      ANY_VALUE(familia)     AS familia,
      ANY_VALUE(subfamilia)  AS subfamilia,
      ARRAY_AGG(STRUCT(anio, mes, cantidad_neta, importe_ars_neto)) AS meses_arr
    FROM por_sku_mes
    GROUP BY item_code
    """
    rows = list(bq_client.query(query, location=BQ_LOCATION).result())
    if not rows:
        log('[SKU_VENTAS] 0 SKUs con ventas en los ultimos 13 meses (verificar v_ventas_lineas)')
        return 0
    if dry_run:
        log(f'[SKU_VENTAS] DRY-RUN: {len(rows)} SKUs listos para escribir a Firestore')
        return 0

    coll = db.collection('sku_ventas_snapshot')
    batch = db.batch()
    written = 0
    seen_ids = set()
    for row in rows:
        d = dict(row.items())
        sku_original = str(d['item_code'] or '').strip()
        if not sku_original:
            continue
        doc_id = _sanitize_sku_doc_id(sku_original)
        seen_ids.add(doc_id)
        meses = {}
        for m in (d.get('meses_arr') or []):
            key = f"{int(m['anio']):04d}-{int(m['mes']):02d}"
            meses[key] = {
                'qty': float(m['cantidad_neta'] or 0),
                'ars': float(m['importe_ars_neto'] or 0),
            }
        payload = {
            'sku':        sku_original,
            'itemName':   d.get('item_name') or '',
            'familia':    d.get('familia') or '',
            'subfamilia': d.get('subfamilia') or '',
            'meses':      meses,
            'updatedAt':  firestore.SERVER_TIMESTAMP,
        }
        batch.set(coll.document(doc_id), payload)
        written += 1
        if written % 400 == 0:
            batch.commit()
            batch = db.batch()
    if written % 400 != 0:
        batch.commit()

    # Cleanup: borrar docs de SKUs que ya no tienen ventas en los ultimos 13m
    # (evita mostrar en FORECAST SKUs muertos con doc stale de hace >1 año).
    deleted = 0
    for doc in coll.stream():
        if doc.id not in seen_ids:
            doc.reference.delete()
            deleted += 1
    log(f'[SKU_VENTAS] {written} docs escritos, {deleted} docs stale eliminados')
    return written


def sync_campania_snapshot_to_firestore(bq_client: bigquery.Client,
                                          db: firestore.Client,
                                          dry_run: bool = False) -> int:
    """v532+ (2026-08-18): agrega v_campanias_progreso a Firestore
    `campania_snapshot/{campaign_id}` para que el Dashboard app muestre
    facturado REAL SAP en la card 'Campanias activas' (antes usaba
    globalPedidos que da $0 porque los pedidos van directo a SAP).

    Match 1:1 con lo que Power BI ve en la hoja CAMPANIAS del TABLERO SAR.

    Payload:
      {
        campaignId, name, familia, subfamilia,
        realizadoQty, realizadoArs,
        lineasFacturadas, pctCumplimiento,
        targetType, targetAmount,
        startDate, endDate, activa,
        updatedAt
      }
    """
    log('[CAMPANIA_SNAP] agregando v_campanias_progreso a Firestore campania_snapshot...')
    query = """
    SELECT
      campaign_id,
      name,
      familia,
      subfamilia,
      target_type,
      target_amount,
      start_date,
      end_date,
      realizado_qty,
      realizado_ars,
      lineas_facturadas,
      pct_cumplimiento,
      activa
    FROM `app-vendedores-shimano.shimano_app.v_campanias_progreso`
    """
    rows = list(bq_client.query(query, location=BQ_LOCATION).result())
    if not rows:
        log('[CAMPANIA_SNAP] 0 campanias en v_campanias_progreso')
        return 0
    if dry_run:
        log(f'[CAMPANIA_SNAP] DRY-RUN: {len(rows)} campanias listas para escribir')
        return 0

    coll = db.collection('campania_snapshot')
    batch = db.batch()
    written = 0
    seen_ids = set()
    for row in rows:
        d = dict(row.items())
        cid = str(d['campaign_id'] or '').strip()
        if not cid:
            continue
        seen_ids.add(cid)
        payload = {
            'campaignId':       cid,
            'name':             d.get('name') or '',
            'familia':          d.get('familia') or '',
            'subfamilia':       d.get('subfamilia') or '',
            'targetType':       d.get('target_type') or '',
            'targetAmount':     float(d.get('target_amount') or 0),
            'startDate':        str(d.get('start_date') or ''),
            'endDate':          str(d.get('end_date') or ''),
            'realizadoQty':     float(d.get('realizado_qty') or 0),
            'realizadoArs':     float(d.get('realizado_ars') or 0),
            'lineasFacturadas': int(d.get('lineas_facturadas') or 0),
            'pctCumplimiento':  float(d.get('pct_cumplimiento') or 0) if d.get('pct_cumplimiento') is not None else None,
            'activa':           bool(d.get('activa')),
            'updatedAt':        firestore.SERVER_TIMESTAMP,
        }
        batch.set(coll.document(cid), payload)
        written += 1
        if written % 400 == 0:
            batch.commit()
            batch = db.batch()
    if written % 400 != 0:
        batch.commit()

    deleted = 0
    for doc in coll.stream():
        if doc.id not in seen_ids:
            doc.reference.delete()
            deleted += 1
    log(f'[CAMPANIA_SNAP] {written} docs escritos, {deleted} docs stale eliminados')
    return written


def sync_pedido_estados_to_firestore(bq_client: bigquery.Client,
                                       db: firestore.Client,
                                       dry_run: bool = False) -> int:
    """v378+ (2026-08-02): para cada pedido de Firestore con transferidoSAP.docNum,
    deriva el estado macro del flujo SAP (SQ open -> SO -> DN -> Invoice -> Cobrada)
    y escribe `sapEstado` + `sapEstadoDetalles` + `sapEstadoUpdatedAt` de vuelta
    al doc de Firestore. El vendedor ve un badge en la card CONFIRMADOS con
    el estado actual sin tener que preguntarle al admin.

    Estados (v505 agrego REMITIDO, 2026-08-13):
      - OFERTA_VENTA       SQ abierta (bost_Open), sin SO copiada aun.
      - ORDEN_VENTA        SO creada a partir de la SQ, sin DN ni factura aun.
      - REMITIDO           DeliveryNote creada, sin Invoice aun.
      - FACTURADO          Invoice creada, paid_to_date = 0.
      - COBRADO_PARCIAL    Invoice con 0 < paid_to_date < doc_total.
      - COBRADO_COMPLETO   Invoice con paid_to_date >= doc_total.
      - CERRADO            SQ cancelada (tYES) o cerrada (bost_Close) sin llegar a SO.

    Link entre docs (SAP convention):
      - SO -> SQ:      Order.DocumentLines[].BaseType='17' + BaseEntry=<SQ.DocEntry>
      - Invoice -> SO: Invoice.DocumentLines[].BaseType='17' + BaseEntry=<SO.DocEntry>
        (En SL de SAP B1, BaseType='17' referencia tanto SQ como SO segun el
        contexto del documento padre; el destino discrimina por el tipo de doc.)

    Retorna cantidad de docs de pedidos actualizados.
    """
    log('[PEDIDO_ESTADO] agregando SQ->SO->Invoice->Cobrado y linkeando a pedidos Firestore...')
    # Query BQ: para cada SQ, deriva el estado macro leyendo lines_json de
    # sap_orders_raw y sap_invoices_raw. Filtramos SQ del ultimo año para
    # bajar el volumen (los pedidos historicos ya no interesan al vendedor).
    query = """
    WITH sq_base AS (
      SELECT
        doc_entry              AS sq_doc_entry,
        doc_num                AS sq_doc_num,
        document_status        AS sq_status,
        cancelled              AS sq_cancelled,
        doc_date               AS sq_doc_date
      FROM `app-vendedores-shimano.shimano_app.sap_quotations_raw`
      WHERE doc_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
    ),
    -- Para cada SO, extraer todos los BaseEntry (SQ DocEntry) que copio.
    -- Una SO puede referenciar N SQs distintas (parcial fulfillment).
    -- v505 fix (2026-08-13): BaseType='23' (Quotation), NO '17' (SO).
    -- El bug historico dejaba TODAS las SO sin match contra su SQ padre ->
    -- todos los pedidos aparecian como OFERTA_VENTA aunque hubiesen sido
    -- convertidos a SO/DN/Invoice. Verificado con BQ: sap_orders_raw
    -- lines_json.BaseType = '23' en 100% de los casos con BaseEntry.
    so_to_sq AS (
      SELECT DISTINCT
        o.doc_entry            AS so_doc_entry,
        o.doc_num              AS so_doc_num,
        o.document_status      AS so_status,
        o.cancelled            AS so_cancelled,
        SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry') AS INT64) AS sq_doc_entry
      FROM `app-vendedores-shimano.shimano_app.sap_orders_raw` o,
           UNNEST(JSON_QUERY_ARRAY(o.lines_json)) ln
      WHERE JSON_VALUE(ln, '$.BaseType') = '23'  -- Quotation
        AND JSON_VALUE(ln, '$.BaseEntry') IS NOT NULL
        AND COALESCE(o.cancelled, 'tNO') = 'tNO'
    ),
    -- v505/v506 (2026-08-13): DeliveryNote -> SO por 2 caminos posibles.
    -- En Shimano el flujo dominante es SO -> Invoice -> DN (DN.BaseType=13
    -- referencia Invoice), NO el clasico SO -> DN paralelo. Verificado en BQ:
    -- BaseType=13 -> 62816 rows, BaseType=17 -> 3872, BaseType=23 -> 61.
    -- Camino 1: DN.BaseType=17 -> SO directa (SO -> DN paralelo).
    -- Camino 2: DN.BaseType=13 -> Invoice -> SO (flujo dominante Shimano).
    dn_to_so AS (
      -- Camino 1: DN referencia SO directamente.
      SELECT DISTINCT
        d.doc_entry            AS dn_doc_entry,
        d.doc_num              AS dn_doc_num,
        d.document_status      AS dn_status,
        SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry') AS INT64) AS so_doc_entry
      FROM `app-vendedores-shimano.shimano_app.sap_deliveries_raw` d,
           UNNEST(JSON_QUERY_ARRAY(d.lines_json)) ln
      WHERE JSON_VALUE(ln, '$.BaseType') = '17'
        AND JSON_VALUE(ln, '$.BaseEntry') IS NOT NULL
        AND COALESCE(d.cancelled, 'tNO') = 'tNO'
      UNION DISTINCT
      -- Camino 2: DN referencia Invoice; Invoice referencia SO.
      SELECT DISTINCT
        d.doc_entry            AS dn_doc_entry,
        d.doc_num              AS dn_doc_num,
        d.document_status      AS dn_status,
        i_so.so_doc_entry
      FROM `app-vendedores-shimano.shimano_app.sap_deliveries_raw` d,
           UNNEST(JSON_QUERY_ARRAY(d.lines_json)) ln
      INNER JOIN (
        SELECT
          i.doc_entry AS inv_doc_entry,
          SAFE_CAST(JSON_VALUE(iln, '$.BaseEntry') AS INT64) AS so_doc_entry
        FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` i,
             UNNEST(JSON_QUERY_ARRAY(i.lines_json)) iln
        WHERE JSON_VALUE(iln, '$.BaseType') = '17'
          AND JSON_VALUE(iln, '$.BaseEntry') IS NOT NULL
          AND COALESCE(i.cancelled, 'tNO') = 'tNO'
      ) i_so
        ON i_so.inv_doc_entry = SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry') AS INT64)
      WHERE JSON_VALUE(ln, '$.BaseType') = '13'  -- Invoice
        AND JSON_VALUE(ln, '$.BaseEntry') IS NOT NULL
        AND COALESCE(d.cancelled, 'tNO') = 'tNO'
    ),
    -- Para cada Invoice, extraer los BaseEntry (SO DocEntry) que factura.
    inv_to_so AS (
      SELECT DISTINCT
        i.doc_entry            AS inv_doc_entry,
        i.doc_num              AS inv_doc_num,
        i.doc_total            AS inv_doc_total,
        i.paid_to_date         AS inv_paid_to_date,
        i.document_status      AS inv_status,
        SAFE_CAST(JSON_VALUE(ln, '$.BaseEntry') AS INT64) AS so_doc_entry
      FROM `app-vendedores-shimano.shimano_app.sap_invoices_raw` i,
           UNNEST(JSON_QUERY_ARRAY(i.lines_json)) ln
      WHERE JSON_VALUE(ln, '$.BaseType') = '17'  -- SO
        AND JSON_VALUE(ln, '$.BaseEntry') IS NOT NULL
        AND COALESCE(i.cancelled, 'tNO') = 'tNO'
    ),
    -- Agregar por SQ: 1 fila por SQ, con la SO mas reciente + DN mas
    -- reciente + Invoice mas reciente. Si N SOs/DNs/Invoices, ANY_VALUE.
    sq_agg AS (
      SELECT
        sq.sq_doc_entry,
        sq.sq_doc_num,
        sq.sq_status,
        sq.sq_cancelled,
        sq.sq_doc_date,
        ANY_VALUE(so.so_doc_entry) AS so_doc_entry,
        ANY_VALUE(so.so_doc_num)   AS so_doc_num,
        ANY_VALUE(so.so_status)    AS so_status,
        ANY_VALUE(dn.dn_doc_entry) AS dn_doc_entry,
        ANY_VALUE(dn.dn_doc_num)   AS dn_doc_num,
        ANY_VALUE(dn.dn_status)    AS dn_status,
        ANY_VALUE(inv.inv_doc_entry)    AS inv_doc_entry,
        ANY_VALUE(inv.inv_doc_num)      AS inv_doc_num,
        ANY_VALUE(inv.inv_doc_total)    AS inv_doc_total,
        ANY_VALUE(inv.inv_paid_to_date) AS inv_paid_to_date,
        ANY_VALUE(inv.inv_status)       AS inv_status
      FROM sq_base sq
      LEFT JOIN so_to_sq so  ON so.sq_doc_entry  = sq.sq_doc_entry
      LEFT JOIN dn_to_so dn  ON dn.so_doc_entry  = so.so_doc_entry
      LEFT JOIN inv_to_so inv ON inv.so_doc_entry = so.so_doc_entry
      GROUP BY sq.sq_doc_entry, sq.sq_doc_num, sq.sq_status, sq.sq_cancelled, sq.sq_doc_date
    )
    SELECT
      sq_doc_entry,
      sq_doc_num,
      sq_status,
      sq_cancelled,
      so_doc_entry,
      so_doc_num,
      so_status,
      dn_doc_entry,
      dn_doc_num,
      dn_status,
      inv_doc_entry,
      inv_doc_num,
      inv_doc_total,
      inv_paid_to_date,
      inv_status,
      -- v506 (2026-08-13): REMITIDO YA NO es un estado del CASE principal.
      -- Ahora el frontend muestra REMITIDO como chip SEPARADO cuando
      -- sapEstadoDetalles.dnDocNum esta, junto al estado principal
      -- (asi ves 'FACTURADO + REMITIDO' o 'COBRADO + REMITIDO'). Motivo:
      -- en Shimano el DN se hace despues de la Invoice (BaseType=13),
      -- entonces todo pedido facturado casi siempre tiene DN.
      CASE
        WHEN inv_doc_entry IS NOT NULL
             AND COALESCE(inv_paid_to_date, 0) >= COALESCE(inv_doc_total, 0)
             AND COALESCE(inv_doc_total, 0) > 0
          THEN 'COBRADO_COMPLETO'
        WHEN inv_doc_entry IS NOT NULL
             AND COALESCE(inv_paid_to_date, 0) > 0
          THEN 'COBRADO_PARCIAL'
        WHEN inv_doc_entry IS NOT NULL
          THEN 'FACTURADO'
        WHEN so_doc_entry IS NOT NULL
          THEN 'ORDEN_VENTA'
        WHEN sq_cancelled = 'tYES' OR sq_status = 'bost_Close'
          THEN 'CERRADO'
        ELSE 'OFERTA_VENTA'
      END AS estado
    FROM sq_agg
    """
    rows = list(bq_client.query(query, location=BQ_LOCATION).result())
    if not rows:
        log('[PEDIDO_ESTADO] 0 SQ encontradas (ventana 365d) - nada que actualizar')
        return 0
    # Index por sq_doc_num para lookup rapido desde los pedidos Firestore.
    # Firestore guarda transferidoSAP.docNum como string, BQ como INT64 -
    # normalizamos a string.
    estados_by_doc_num = {}
    for row in rows:
        d = dict(row.items())
        key = str(d['sq_doc_num'])
        estados_by_doc_num[key] = {
            'estado': d['estado'],
            'sqDocEntry': int(d['sq_doc_entry']) if d['sq_doc_entry'] is not None else None,
            'sqDocNum': int(d['sq_doc_num']) if d['sq_doc_num'] is not None else None,
            'sqStatus': d['sq_status'],
            'sqCancelled': d['sq_cancelled'],
            'soDocEntry': int(d['so_doc_entry']) if d['so_doc_entry'] is not None else None,
            'soDocNum': int(d['so_doc_num']) if d['so_doc_num'] is not None else None,
            'soStatus': d['so_status'],
            # v505: Delivery Note (REMITIDO)
            'dnDocEntry': int(d['dn_doc_entry']) if d.get('dn_doc_entry') is not None else None,
            'dnDocNum': int(d['dn_doc_num']) if d.get('dn_doc_num') is not None else None,
            'dnStatus': d.get('dn_status'),
            'invoiceDocEntry': int(d['inv_doc_entry']) if d['inv_doc_entry'] is not None else None,
            'invoiceDocNum': int(d['inv_doc_num']) if d['inv_doc_num'] is not None else None,
            'invoiceTotal': float(d['inv_doc_total']) if d['inv_doc_total'] is not None else None,
            'invoicePaidToDate': float(d['inv_paid_to_date']) if d['inv_paid_to_date'] is not None else None,
            'invoiceStatus': d['inv_status'],
        }
    log(f'[PEDIDO_ESTADO] {len(estados_by_doc_num)} SQ agregadas del ultimo año')
    if dry_run:
        # Ejemplo del primer estado computado para verificar la logica.
        sample = next(iter(estados_by_doc_num.values()))
        log(f'[PEDIDO_ESTADO] DRY-RUN sample: {sample}')
        return 0
    # Ahora leemos pedidos Firestore con transferidoSAP.docNum y matcheamos.
    # No hay muchos pedidos (proyecto en transicion Baraldo->venta directa),
    # asi que un scan completo del collection es OK (<1000 docs).
    pedidos_ref = db.collection('pedidos')
    updated = 0
    unmatched = 0
    batch = db.batch()
    batch_count = 0
    for doc in pedidos_ref.stream():
        data = doc.to_dict() or {}
        ts = data.get('transferidoSAP') or {}
        doc_num = ts.get('docNum')
        if not doc_num:
            continue  # pedido aun no transferido a SAP
        key = str(doc_num)
        estado_info = estados_by_doc_num.get(key)
        if not estado_info:
            unmatched += 1
            continue  # la SQ existe en el pedido pero no en BQ (fuera de ventana o vieja)
        payload = {
            'sapEstado': estado_info['estado'],
            'sapEstadoDetalles': {k: v for k, v in estado_info.items() if k != 'estado'},
            'sapEstadoUpdatedAt': firestore.SERVER_TIMESTAMP,
        }
        batch.update(doc.reference, payload)
        batch_count += 1
        updated += 1
        if batch_count >= 400:
            batch.commit()
            batch = db.batch()
            batch_count = 0
    if batch_count > 0:
        batch.commit()
    log(f'[PEDIDO_ESTADO] {updated} pedidos Firestore actualizados con sapEstado (unmatched: {unmatched})')
    return updated


def load_to_bq(bq_client: bigquery.Client, table_id: str, rows: list, entity_name: str, dry_run: bool = False):
    if not rows:
        log(f'[BQ/{entity_name}] 0 rows, nada que cargar')
        return
    if dry_run:
        log(f'[BQ/{entity_name}] DRY-RUN: {len(rows)} rows NO cargados a {table_id}')
        return
    log(f'[BQ/{entity_name}] cargando {len(rows)} rows a {table_id}...')
    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        autodetect=True,
    )
    ndjson_bytes = '\n'.join(json.dumps(r, default=str) for r in rows).encode('utf-8')
    try:
        job = bq_client.load_table_from_file(
            BytesIO(ndjson_bytes),
            table_id,
            location=BQ_LOCATION,
            job_config=job_config,
        )
        job.result()  # bloquea hasta que termine
    except Exception as e:
        log(f'[FATAL/{entity_name}] BigQuery load fallo: {e}')
        sys.exit(5)
    dest = bq_client.get_table(table_id)
    log(f'[BQ/{entity_name}] OK: {dest.num_rows} rows en la tabla despues del truncate+load')


def _load_to_bq_with_schema(bq_client: bigquery.Client, table_id: str, rows: list, entity_name: str, schema: list, dry_run: bool = False, truncate_on_empty: bool = False):
    """v311+: variante de load_to_bq con schema explicito. Usar cuando hay
    columnas que pueden venir todas null en el batch (autodetect las
    dropea, tipo lo que paso con paid_to_date y con target_reel_ars).
    Fuerza las columnas del schema aunque no tengan valores todavia.

    v373+ (2026-08-02): parametro truncate_on_empty. Cuando la fuente
    (Firestore) devuelve 0 rows Y truncate_on_empty=True, la tabla en BQ
    se TRUNCATE explicito - refleja el estado actual de la fuente. Sin
    este flag (default False, comportamiento anterior), 0 rows retorna
    early y deja la tabla con el snapshot anterior.

    Casos donde truncate_on_empty=True es CORRECTO:
    - `campaigns_raw`: si Pablo borra la ultima campania activa, la vista
      v_campanias_progreso NO debe seguir mostrandola. Bug reportado
      2026-08-02: POWER PRO zombie en BQ tras delete desde la app.

    Casos donde truncate_on_empty=False es CORRECTO (default):
    - `sap_bp_raw`, `sap_items_raw`, `sap_invoices_raw`, `targets_raw`:
      0 rows casi seguro es un bug de sync SAP (SL down, fetch fallo,
      etc), NO un delete legitimo. Mejor conservar snapshot anterior
      hasta que un humano investigue - vale mas la data stale que
      la tabla vacia.
    """
    if not rows:
        if truncate_on_empty and not dry_run:
            log(f'[BQ/{entity_name}] 0 rows y truncate_on_empty=True -> TRUNCATE explicito')
            try:
                job = bq_client.query(f'TRUNCATE TABLE `{table_id}`', location=BQ_LOCATION)
                job.result()
                dest = bq_client.get_table(table_id)
                log(f'[BQ/{entity_name}] OK: tabla truncada, {dest.num_rows} rows (deberia ser 0)')
            except Exception as e:
                log(f'[FATAL/{entity_name}] BigQuery TRUNCATE fallo: {e}')
                sys.exit(5)
            return
        log(f'[BQ/{entity_name}] 0 rows, nada que cargar (tabla queda con snapshot anterior)')
        return
    if dry_run:
        log(f'[BQ/{entity_name}] DRY-RUN: {len(rows)} rows NO cargados a {table_id}')
        return
    log(f'[BQ/{entity_name}] cargando {len(rows)} rows a {table_id} (schema explicito)...')
    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        schema=schema,
    )
    ndjson_bytes = '\n'.join(json.dumps(r, default=str) for r in rows).encode('utf-8')
    try:
        job = bq_client.load_table_from_file(
            BytesIO(ndjson_bytes),
            table_id,
            location=BQ_LOCATION,
            job_config=job_config,
        )
        job.result()
    except Exception as e:
        log(f'[FATAL/{entity_name}] BigQuery load fallo: {e}')
        sys.exit(5)
    dest = bq_client.get_table(table_id)
    log(f'[BQ/{entity_name}] OK: {dest.num_rows} rows en la tabla despues del truncate+load')


def sync_facturacion_snapshot_to_firestore(bq_client: bigquery.Client,
                                             db: firestore.Client,
                                             dry_run: bool = False) -> int:
    """v482 (2026-08-12): agrega v_ventas_lineas por vendor + total nacional
    y escribe a Firestore facturacion_snapshot/{VENDOR_NORM} con
    {hoyArs, mesArs, anoArs, updatedAt}. Alimenta las 2 cards del
    sidebar-left (Facturacion Diaria + Cumplimiento del mes).

    Fuente = misma que PowerBI 'Facturacion Total' del usuario:
        SUM(importe_linea_ars) WHERE is_pesca = TRUE

    Escribe:
      - 1 doc por vendor (assigned_vendor de v_ventas_lineas): VENDOR_NORM.
      - 1 doc TOTAL_NACIONAL con la suma nacional (para admin/gerente scope).

    Timezone: America/Argentina/Buenos_Aires para hoy/mes/año.
    """
    log('[FACTURACION] agregando v_ventas_lineas por vendor + total nacional...')
    query = """
    WITH facts AS (
      SELECT
        COALESCE(NULLIF(assigned_vendor, ''), '(SIN ASIGNAR)') AS vendor,
        doc_date,
        importe_linea_ars
      FROM `app-vendedores-shimano.shimano_app.v_ventas_lineas`
      WHERE is_pesca = TRUE
        AND doc_date IS NOT NULL
    )
    SELECT
      vendor,
      SUM(CASE WHEN doc_date = CURRENT_DATE('America/Argentina/Buenos_Aires')
              THEN importe_linea_ars ELSE 0 END) AS hoy_ars,
      SUM(CASE WHEN doc_date >= DATE_TRUNC(CURRENT_DATE('America/Argentina/Buenos_Aires'), MONTH)
              THEN importe_linea_ars ELSE 0 END) AS mes_ars,
      SUM(CASE WHEN doc_date >= DATE_TRUNC(CURRENT_DATE('America/Argentina/Buenos_Aires'), YEAR)
              THEN importe_linea_ars ELSE 0 END) AS ano_ars
    FROM facts
    GROUP BY vendor
    """
    rows = list(bq_client.query(query, location=BQ_LOCATION).result())
    if not rows:
        log('[FACTURACION] 0 filas (v_ventas_lineas vacia?)')
        return 0

    hoy_total = 0.0
    mes_total = 0.0
    ano_total = 0.0
    per_vendor = []
    for r in rows:
        hoy = float(r.hoy_ars or 0)
        mes = float(r.mes_ars or 0)
        ano = float(r.ano_ars or 0)
        hoy_total += hoy
        mes_total += mes
        ano_total += ano
        per_vendor.append({
            'vendor': r.vendor,
            'hoyArs': hoy,
            'mesArs': mes,
            'anoArs': ano,
        })

    log(f'[FACTURACION] {len(per_vendor)} vendors procesados. '
        f'Nacional: hoy=${hoy_total:,.0f} mes=${mes_total:,.0f} ano=${ano_total:,.0f}')

    if dry_run:
        for v in per_vendor:
            log(f'  DRY-RUN {v["vendor"]}: hoy=${v["hoyArs"]:,.0f} '
                f'mes=${v["mesArs"]:,.0f} ano=${v["anoArs"]:,.0f}')
        log(f'  DRY-RUN TOTAL_NACIONAL: hoy=${hoy_total:,.0f} '
            f'mes=${mes_total:,.0f} ano=${ano_total:,.0f}')
        return 0

    coll = db.collection('facturacion_snapshot')
    written = 0
    for v in per_vendor:
        vendor_norm = (v['vendor']
                       .replace(' ', '_')
                       .replace('(', '')
                       .replace(')', '')
                       .upper())
        coll.document(vendor_norm).set({
            'vendorKey': v['vendor'],
            'hoyArs': v['hoyArs'],
            'mesArs': v['mesArs'],
            'anoArs': v['anoArs'],
            'updatedAt': firestore.SERVER_TIMESTAMP,
        })
        written += 1

    # Doc TOTAL_NACIONAL nacional para admin/gerente.
    coll.document('TOTAL_NACIONAL').set({
        'vendorKey': 'TOTAL_NACIONAL',
        'hoyArs': hoy_total,
        'mesArs': mes_total,
        'anoArs': ano_total,
        'updatedAt': firestore.SERVER_TIMESTAMP,
    })
    written += 1

    # Cleanup: borrar docs de vendedores que ya no aparecen (rotacion de equipo).
    existing_ids = {(v['vendor']
                     .replace(' ', '_')
                     .replace('(', '')
                     .replace(')', '')
                     .upper()) for v in per_vendor}
    existing_ids.add('TOTAL_NACIONAL')
    for doc in coll.stream():
        if doc.id not in existing_ids:
            doc.reference.delete()
            log(f'[FACTURACION] cleanup: borrado doc {doc.id} (sin facturacion)')

    log(f'[FACTURACION] {written} docs escritos a facturacion_snapshot')
    return written


# ============================================================
# Main
# ============================================================
def main():
    log('=== sync_sap_to_bigquery START ===')
    sync_ts = now_iso()
    dry_run = env_bool('DRY_RUN')
    if dry_run:
        log('[MODE] DRY-RUN: no se escribe a BigQuery')
    sl_insecure = env_bool('SL_INSECURE')
    max_docs = env_int('SL_MAX_DOCS', 0)
    history_months = env_int('HISTORY_MONTHS', DEFAULT_HISTORY_MONTHS)

    # Init clientes
    sa_data = parse_sa_json()
    db = init_firestore(sa_data)
    bq_client = init_bigquery(sa_data)
    log(f'[BQ] cliente OK, project={BQ_PROJECT}, location={BQ_LOCATION}')

    # Config SL
    cfg = get_sl_config(db)
    session = requests.Session()
    session.verify = not sl_insecure
    if sl_insecure:
        import urllib3
        urllib3.disable_warnings(InsecureRequestWarning)
        log('[SL] SSL verify OFF (SL_INSECURE=true)')
    sl_login(cfg, session)

    # Ventana historica
    since_dt = datetime.now(timezone.utc) - timedelta(days=history_months * 31)
    since_iso_date = since_dt.strftime('%Y-%m-%d')
    log(f'[historial] cutoff DocDate >= {since_iso_date} (ultimos {history_months} meses)')

    # === 1. Business Partners (customers)
    # Campos removidos del $select por incompatibilidad con el schema SL de
    # Shimano (2026-07-08 pruebas manuales):
    #   - State1  -> HTTP 400 (movido a BPAddresses)
    #   - CreditLine -> HTTP 400 (renombrado o no expuesto)
    #   - CurrentAccountBalance -> preventivo (campo calculado, puede fallar
    #     por el mismo motivo)
    #   - Notes -> preventivo (LongText a veces rompe autodetect en BQ)
    # Se pueden extraer despues en las vistas curadas de Fase 2 si Power BI
    # los necesita.
    bp_select = [
        'CardCode', 'CardName', 'CardType', 'GroupCode', 'Currency',
        'Address', 'City', 'ZipCode', 'Country',
        'EmailAddress', 'Phone1', 'Cellular',
        'PayTermsGrpCode',
        'SalesPersonCode', 'Valid', 'Frozen',
        'CreateDate', 'UpdateDate',
    ]
    bps = sl_fetch_all(
        cfg, session, '/b1s/v1/BusinessPartners', 'BP',
        select_fields=bp_select,
        filter_expr="CardType eq 'cCustomer'",
        max_docs=max_docs,
    )
    bp_rows = [flatten_bp(bp, sync_ts) for bp in bps]
    load_to_bq(bq_client, BQ_TABLE_BP, bp_rows, 'BP', dry_run=dry_run)

    # === 2. Items (grupo PESCA con stock + precio)
    pesca_code = resolve_pesca_group_code(cfg, session)
    log(f'[grupo] PESCA = {pesca_code}')
    # v289 iter2 (2026-07-10): LastPurchasePrice/AvgStdPrice NO existen en el
    # schema del Item de este SAP (SL devolvio HTTP 400 en run #29). En SAP B1
    # el costo puede venir por warehouse en ItemWarehouseInfoCollection[]:
    #   .StandardAveragePrice  - precio promedio ponderado por deposito
    #   .Committed             - comprometido
    # Los extraemos en flatten_item() desde ese array.
    # v527 (2026-08-14): pedimos UDFs U_CATEGORIA / U_FAMILIA / U_SUBFAMILIA
    # de OITM (Ficha Tecnica Pesca) para usar como fallback cuando el
    # catalogo local (index.html PRODUCTS) no tiene el SKU. Si los UDFs
    # reales tienen otro nombre, SL responde 400 - en ese caso hay que
    # ajustar los nombres consultando a David.
    item_select_base = [
        'ItemCode', 'ItemName', 'ForeignName', 'ItemsGroupCode',
        'ItemWarehouseInfoCollection', 'ItemPrices',
        'Valid', 'Frozen', 'CreateDate', 'UpdateDate',
    ]
    # v527/v530 (2026-08-14): intentar con UDFs; si SL responde 400 (UDF con
    # otro nombre en este SAP), fallback al select base sin UDFs.
    # NOTA v530: sl_fetch_all hace sys.exit(4) en HTTP 400 (levanta SystemExit,
    # no Exception). Capturamos BaseException para no perder el fallback.
    # Confirmado prod 2026-08-14: los UDFs no se llaman U_CATEGORIA/U_FAMILIA/
    # U_SUBFAMILIA en este SAP - los UDFs reales hay que consultarlos a David.
    item_select = item_select_base + ['U_CATEGORIA', 'U_FAMILIA', 'U_SUBFAMILIA']
    try:
        items = sl_fetch_all(
            cfg, session, '/b1s/v1/Items', 'ITEMS',
            select_fields=item_select,
            filter_expr=f"ItemsGroupCode eq {pesca_code}",
            max_docs=max_docs,
        )
    except (Exception, SystemExit) as e:
        log(f'[ITEMS] fallo con UDFs (probable nombre distinto en SAP): {e}')
        log('[ITEMS] reintentando sin UDFs (fallback a catalogo local solo)')
        items = sl_fetch_all(
            cfg, session, '/b1s/v1/Items', 'ITEMS',
            select_fields=item_select_base,
            filter_expr=f"ItemsGroupCode eq {pesca_code}",
            max_docs=max_docs,
        )
    item_rows = [flatten_item(it, PESCA_PRICE_LIST_NUM, sync_ts) for it in items]
    load_to_bq(bq_client, BQ_TABLE_ITEMS, item_rows, 'ITEMS', dry_run=dry_run)

    # === 3. Invoices (ultimos 24 meses)
    doc_select_invoices = [
        'DocEntry', 'DocNum', 'DocDate', 'DocDueDate',
        'DocumentStatus', 'Cancelled',
        'CardCode', 'CardName',
        'DocCurrency', 'DocTotal', 'DocTotalFc', 'DocRate',
        # v302+ (2026-07-20): PaidToDate para calcular saldo pendiente.
        # DocumentStatus='bost_Open' + saldo>0 = deuda vigente. Ver
        # v_deuda_por_vendedor en bigquery/views.sql.
        'PaidToDate',
        'DiscountPercent', 'TotalDiscount',
        'SalesPersonCode', 'Comments', 'JournalMemo',
        'PaymentGroupCode', 'Series',
        'CreationDate', 'UpdateDate',
        'DocumentLines',
    ]
    invs = sl_fetch_all(
        cfg, session, '/b1s/v1/Invoices', 'INVOICES',
        select_fields=doc_select_invoices,
        filter_expr=f"DocDate ge '{since_iso_date}'",
        max_docs=max_docs,
    )
    inv_rows = [flatten_doc(d, 'INVOICE', sync_ts) for d in invs]
    load_to_bq(bq_client, BQ_TABLE_INVOICES, inv_rows, 'INVOICES', dry_run=dry_run)

    # === 3b. Credit Notes / Notas de Credito (v367+, 2026-07-30)
    # Endpoint SAP separado /b1s/v1/CreditNotes (schema identico a Invoices).
    # Motivacion: hasta hoy el pipeline solo cargaba Invoices -> Power BI
    # sobreestimaba la facturacion porque las NCs no se restaban. Bug
    # reportado por Mariano: Santiago aparecia con $29M cuando deberia ser
    # $18.9M (NC RC 1810 por -$10.1M nunca llegaba a BQ).
    # Fix: cargar CNs a tabla separada + UNION ALL en v_ventas_lineas y
    # v_facturas_sap con signo negativo en cantidad/importe_linea_ars/doc_total.
    # Mismo doc_select que Invoices (incluye PaidToDate por consistencia,
    # aunque en CNs no aplica igual — sirve para el UNION uniforme).
    cns = sl_fetch_all(
        cfg, session, '/b1s/v1/CreditNotes', 'CREDIT_NOTES',
        select_fields=doc_select_invoices,
        filter_expr=f"DocDate ge '{since_iso_date}'",
        max_docs=max_docs,
    )
    cn_rows = [flatten_doc(d, 'CREDIT_NOTE', sync_ts) for d in cns]
    load_to_bq(bq_client, BQ_TABLE_CREDIT_NOTES, cn_rows, 'CREDIT_NOTES', dry_run=dry_run)

    # Cotizaciones + Ordenes + PO usan el select viejo (sin PaidToDate,
    # que en esos tipos no aplica).
    doc_select = [
        'DocEntry', 'DocNum', 'DocDate', 'DocDueDate',
        'DocumentStatus', 'Cancelled',
        'CardCode', 'CardName',
        'DocCurrency', 'DocTotal', 'DocTotalFc', 'DocRate',
        'DiscountPercent', 'TotalDiscount',
        'SalesPersonCode', 'Comments', 'JournalMemo',
        'PaymentGroupCode', 'Series',
        'CreationDate', 'UpdateDate',
        'DocumentLines',
    ]

    # === 4. Quotations (ultimos 24 meses)
    qtns = sl_fetch_all(
        cfg, session, '/b1s/v1/Quotations', 'QUOTATIONS',
        select_fields=doc_select,
        filter_expr=f"DocDate ge '{since_iso_date}'",
        max_docs=max_docs,
    )
    qtn_rows = [flatten_doc(d, 'QUOTATION', sync_ts) for d in qtns]
    load_to_bq(bq_client, BQ_TABLE_QUOTATIONS, qtn_rows, 'QUOTATIONS', dry_run=dry_run)

    # === 5. Orders (ultimos 24 meses). Sales Orders son ORDR/RDR1 en SAP.
    # Necesarias para calcular Backorder = Cantidad_Quotation - Cantidad_SO
    # generada por Administracion. Cada linea de Order tiene RemainingOpenQuantity
    # (cuanto sigue abierto sin facturar) - eso alimenta el KPI backorder.
    # Mismo doc_select que Invoices/Quotations (misma estructura de documento
    # marketing de ventas).
    orders = sl_fetch_all(
        cfg, session, '/b1s/v1/Orders', 'ORDERS',
        select_fields=doc_select,
        filter_expr=f"DocDate ge '{since_iso_date}'",
        max_docs=max_docs,
    )
    order_rows = [flatten_doc(d, 'ORDER', sync_ts) for d in orders]
    load_to_bq(bq_client, BQ_TABLE_ORDERS, order_rows, 'ORDERS', dry_run=dry_run)

    # === 6. Purchase Orders (ultimos 24 meses). Hoy vacio o casi vacio -
    # Shimano PESCA arranca a cargar POs con fecha estimada de llegada mas
    # adelante. Cuando lo hagan, el dashboard Power BI va a mostrar
    # "ASIGNADO a embarque" + Prox. embarque para los SKUs con PO abierta.
    pos = sl_fetch_all(
        cfg, session, '/b1s/v1/PurchaseOrders', 'PURCHASE_ORDERS',
        select_fields=doc_select,
        filter_expr=f"DocDate ge '{since_iso_date}'",
        max_docs=max_docs,
    )
    po_rows = [flatten_doc(d, 'PURCHASE_ORDER', sync_ts) for d in pos]
    load_to_bq(bq_client, BQ_TABLE_PURCHASE_ORDERS, po_rows, 'PURCHASE_ORDERS', dry_run=dry_run)

    # === 7. DeliveryNotes (ultimos 24 meses). v386+ (2026-08-03).
    # Aunque las Invoices Shimano se generan directo desde SO (BaseType=17),
    # existen ~18k DeliveryNotes paralelas que registran el pase a deposito
    # (transferencia de propiedad al cliente). El pipeline REMITIDO en Power
    # BI usa v_remitos_lineas con regla hibrida MAX(delivery, invoice): si
    # el SO tiene Delivery se usa la fecha del remito; si no, fallback a
    # fecha de factura (caso SEBASTIAN SALES fact 18364 documentado).
    # Mismo doc_select que Invoices/Orders. Ventana 12 meses (hardcodeada,
    # menor que HISTORY_MONTHS global) porque hay ~18k deliveries totales en
    # SAP y el fetch de 24 meses hacia timeout el workflow (45 min). Con 12
    # meses baja a ~9k -> ~7 min de fetch, sano dentro del timeout.
    # Suficiente para el reporte % Cumplimiento del vendedor (mensual).
    deliveries_history_months = min(12, history_months)
    deliveries_since_dt = datetime.now(timezone.utc) - timedelta(days=deliveries_history_months * 31)
    deliveries_since_iso = deliveries_since_dt.strftime('%Y-%m-%d')
    log(f'[SL/DELIVERIES] ventana propia: {deliveries_since_iso} ({deliveries_history_months} meses)')
    deliveries = sl_fetch_all(
        cfg, session, '/b1s/v1/DeliveryNotes', 'DELIVERIES',
        select_fields=doc_select,
        filter_expr=f"DocDate ge '{deliveries_since_iso}'",
        max_docs=max_docs,
    )
    delivery_rows = [flatten_doc(d, 'DELIVERY', sync_ts) for d in deliveries]
    load_to_bq(bq_client, BQ_TABLE_DELIVERIES, delivery_rows, 'DELIVERIES', dry_run=dry_run)

    # === 8. Returns (contrapartida fisica de Delivery, v386.2+ 2026-08-04)
    # Endpoint SL: /b1s/v1/Returns (tabla ORIN/RIN1 en SAP B1). Cuando un
    # cliente devuelve mercaderia se genera un Return (mueve inventario de
    # vuelta al deposito) + una Credit Note (resta contable de la factura
    # original). Sin restar Returns, v_remitos_lineas quedaba inflada por
    # las devoluciones. Volumen bajo (~216 docs totales, ~37/mes recientes)
    # asi que no impacta timeout. Misma ventana 12 meses que deliveries.
    returns = sl_fetch_all(
        cfg, session, '/b1s/v1/Returns', 'RETURNS',
        select_fields=doc_select,
        filter_expr=f"DocDate ge '{deliveries_since_iso}'",
        max_docs=max_docs,
    )
    return_rows = [flatten_doc(r, 'RETURN', sync_ts) for r in returns]
    load_to_bq(bq_client, BQ_TABLE_RETURNS, return_rows, 'RETURNS', dry_run=dry_run)

    # === 7. Targets mensuales (Firestore -> BigQuery)
    # Coleccion `targets` en Firestore (una fila por vendedor+ano+mes).
    # Doc ID canonico: {vendorKey_normalizado}_{year}_{MM} (unico por combinacion).
    # WRITE_TRUNCATE: garantiza dedup por construccion (borra y reescribe todo).
    # No usamos Firestore Extension porque son ~50 docs y este pull es mas simple.
    # v311+: schema explicito para forzar las columnas target_reel/canas/lineas_ars
    # aunque vengan todas null. Sin schema, autodetect las dropea (bug conocido
    # tipo el que tuvimos con paid_to_date en sap_invoices_raw).
    target_rows = sync_targets_from_firestore(db, sync_ts)
    _target_schema = [
        bigquery.SchemaField('doc_id', 'STRING'),
        bigquery.SchemaField('seller_id', 'STRING'),
        bigquery.SchemaField('year', 'INT64'),
        bigquery.SchemaField('month', 'INT64'),
        bigquery.SchemaField('target_ars', 'FLOAT64'),
        bigquery.SchemaField('target_reel_ars', 'FLOAT64'),
        bigquery.SchemaField('target_canas_ars', 'FLOAT64'),
        bigquery.SchemaField('target_lineas_ars', 'FLOAT64'),
        bigquery.SchemaField('updated_at', 'TIMESTAMP'),
        bigquery.SchemaField('updated_by', 'STRING'),
        bigquery.SchemaField('updated_by_email', 'STRING'),
        bigquery.SchemaField('_sync_timestamp', 'TIMESTAMP'),
    ]
    _load_to_bq_with_schema(bq_client, BQ_TABLE_TARGETS, target_rows, 'TARGETS', _target_schema, dry_run=dry_run)

    # === 8. Campanias comerciales (Firestore -> BigQuery)  v367+
    # Coleccion `campaigns` en Firestore (una fila por campania). Doc ID = auto.
    # WRITE_TRUNCATE dedup por construccion. Schema explicito porque skus_json
    # y scope_values_json son STRING que van a UNNEST via JSON_EXTRACT_ARRAY
    # en la vista v_campanias_progreso (mismo patron que sap_invoices_raw.lines_json).
    # Alimenta hoja "CAMPAÑAS" del TABLERO SAR (Power BI).
    campaign_rows = sync_campaigns_from_firestore(db, sync_ts)
    _campaign_schema = [
        bigquery.SchemaField('campaign_id', 'STRING'),
        bigquery.SchemaField('name', 'STRING'),
        bigquery.SchemaField('familia', 'STRING'),
        bigquery.SchemaField('subfamilia', 'STRING'),
        bigquery.SchemaField('skus_json', 'STRING'),
        bigquery.SchemaField('skus_count', 'INT64'),
        bigquery.SchemaField('target_type', 'STRING'),
        bigquery.SchemaField('target_amount', 'FLOAT64'),
        bigquery.SchemaField('start_date', 'DATE'),
        bigquery.SchemaField('end_date', 'DATE'),
        bigquery.SchemaField('scope', 'STRING'),
        bigquery.SchemaField('scope_values_json', 'STRING'),
        bigquery.SchemaField('created_by', 'STRING'),
        bigquery.SchemaField('created_by_email', 'STRING'),
        bigquery.SchemaField('created_at', 'TIMESTAMP'),
        bigquery.SchemaField('archived', 'BOOL'),
        bigquery.SchemaField('archived_at', 'TIMESTAMP'),
        bigquery.SchemaField('archived_by', 'STRING'),
        bigquery.SchemaField('_sync_timestamp', 'TIMESTAMP'),
    ]
    # v373+ (2026-08-02): truncate_on_empty=True porque si Pablo borra la
    # ultima campania activa, la vista v_campanias_progreso debe reflejar
    # el estado real (0 filas), no seguir mostrando la campania zombie.
    # Ver docstring de _load_to_bq_with_schema para contexto completo.
    _load_to_bq_with_schema(bq_client, BQ_TABLE_CAMPAIGNS, campaign_rows, 'CAMPAIGNS', _campaign_schema, dry_run=dry_run, truncate_on_empty=True)

    # === 9. Dashboard snapshot (BQ -> Firestore) v367+
    # Agrega v_facturas_sap + v_ventas_lineas por (vendor, año, mes) y escribe
    # a Firestore sap_snapshot/{vendorKey_YYYYMM}. Alimenta el modal Dashboard
    # de la app (KPIs facturado real SAP + unidades + % cumplimiento).
    # Corre AL FINAL porque depende de v_facturas_sap y v_ventas_lineas
    # (views que ya leen datos de sap_invoices_raw + sap_credit_notes_raw
    # actualizados por los steps 3 y 3b de este mismo script).
    try:
        sync_dashboard_snapshot_to_firestore(bq_client, db, dry_run=dry_run)
    except Exception as e:
        # No detener el cron si esto falla — el snapshot se puede reintentar
        # solo. El resto de la sync (raw + campaigns + targets) YA quedo OK.
        log(f'[SNAPSHOT] fallo (no bloqueante): {e}')

    # === 10. Pedido -> estado SAP (BQ -> Firestore) v378+ (2026-08-02)
    # Para cada pedido con transferidoSAP.docNum, deriva el estado macro
    # del flujo SAP (SQ open -> SO -> Invoice -> Cobrada) y escribe
    # sapEstado + sapEstadoDetalles al doc de Firestore. Frontend usa esto
    # para mostrar un badge en la card CONFIRMADOS.
    try:
        sync_pedido_estados_to_firestore(bq_client, db, dry_run=dry_run)
    except Exception as e:
        log(f'[PEDIDO_ESTADO] fallo (no bloqueante): {e}')

    # === 11. Backorder por vendedor (BQ -> Firestore) v398+ (2026-08-05)
    # Alimenta la nueva tab BACKORDERS de la app. 1 doc por vendedor en
    # backorder_snapshot/{VENDOR_NORM} con array de lineas SQ pendientes.
    # Uso: cuando llega mercaderia el vendedor busca el SKU y ve que
    # clientes lo tenian pedido para avisarles.
    try:
        sync_backorder_snapshot_to_firestore(bq_client, db, dry_run=dry_run)
    except Exception as e:
        log(f'[BACKORDER] fallo (no bloqueante): {e}')

    # === 12. SKU ventas snapshot (BQ -> Firestore) v42x+ (2026-08-06)
    # Agrega v_ventas_lineas por (item_code, año, mes) ventana 13 meses y
    # escribe 1 doc por SKU con array de meses a sku_ventas_snapshot.
    # Alimenta el modal FORECAST admin-only (src/domains/forecast.js).
    try:
        sync_sku_ventas_snapshot_to_firestore(bq_client, db, dry_run=dry_run)
    except Exception as e:
        log(f'[SKU_VENTAS] fallo (no bloqueante): {e}')

    # === 13. Facturacion snapshot (BQ -> Firestore) v482 (2026-08-12)
    # Agrega v_ventas_lineas por vendedor (hoy, mes actual, año actual) y
    # escribe 1 doc por vendedor + TOTAL_NACIONAL nacional a facturacion_snapshot.
    # Alimenta las 2 cards del sidebar-left (Facturacion Diaria + Cumplimiento).
    # Fuente = misma que PowerBI (importe_linea_ars con is_pesca=TRUE).
    try:
        sync_facturacion_snapshot_to_firestore(bq_client, db, dry_run=dry_run)
    except Exception as e:
        log(f'[FACTURACION] fallo (no bloqueante): {e}')

    # === 14. Campania snapshot (BQ -> Firestore) v532 (2026-08-18)
    # Agrega v_campanias_progreso a Firestore campania_snapshot para que la
    # card 'Campanias activas' del Dashboard app muestre facturado REAL SAP
    # (antes usaba globalPedidos = solo pedidos via app = $0 permanente).
    # Match 1:1 con Power BI hoja CAMPANIAS.
    try:
        sync_campania_snapshot_to_firestore(bq_client, db, dry_run=dry_run)
    except Exception as e:
        log(f'[CAMPANIA_SNAP] fallo (no bloqueante): {e}')

    log('=== sync_sap_to_bigquery END OK ===')


if __name__ == '__main__':
    main()
