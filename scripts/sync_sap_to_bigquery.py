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
BQ_TABLE_TARGETS         = f'{BQ_PROJECT}.{BQ_DATASET}.targets_raw'

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
    cat_all = get_local_categorization()
    _cat_map = cat_all.get(item.get('ItemCode') or '', {})
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
        # v289+: categorizacion del catalogo pesca (Reels/Cañas/Lineas etc.)
        # tomada del CSV inline en index.html. SAP solo tiene ItemsGroupCode
        # (PESCA); la sub-categorizacion viene del catalogo cargado por producto.
        # Power BI usa cat = Familia y fam = Subfamilia en el treemap.
        'cat': _cat_map.get('cat', ''),
        'fam': _cat_map.get('fam', ''),
        'sub': _cat_map.get('sub', ''),
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
      targetArs      NUMBER   objetivo del mes en ARS
      updatedAt      TS
      updatedBy      STRING   uid
      updatedByEmail STRING

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
        rows.append({
            'doc_id':           d.id,
            'seller_id':        data.get('sellerId', ''),
            'year':             int(data.get('year', 0) or 0),
            'month':            int(data.get('month', -1)),  # 0-11
            'target_ars':       target,
            'updated_at':       updated_at.isoformat() if updated_at else None,
            'updated_by':       data.get('updatedBy', ''),
            'updated_by_email': data.get('updatedByEmail', ''),
            '_sync_timestamp':  sync_ts,
        })
    log(f'[TARGETS] {len(rows)} rows validas (target > 0)')
    return rows


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
    item_select = [
        'ItemCode', 'ItemName', 'ForeignName', 'ItemsGroupCode',
        'ItemWarehouseInfoCollection', 'ItemPrices',
        'Valid', 'Frozen', 'CreateDate', 'UpdateDate',
    ]
    items = sl_fetch_all(
        cfg, session, '/b1s/v1/Items', 'ITEMS',
        select_fields=item_select,
        filter_expr=f"ItemsGroupCode eq {pesca_code}",
        max_docs=max_docs,
    )
    item_rows = [flatten_item(it, PESCA_PRICE_LIST_NUM, sync_ts) for it in items]
    load_to_bq(bq_client, BQ_TABLE_ITEMS, item_rows, 'ITEMS', dry_run=dry_run)

    # === 3. Invoices (ultimos 24 meses)
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
    invs = sl_fetch_all(
        cfg, session, '/b1s/v1/Invoices', 'INVOICES',
        select_fields=doc_select,
        filter_expr=f"DocDate ge '{since_iso_date}'",
        max_docs=max_docs,
    )
    inv_rows = [flatten_doc(d, 'INVOICE', sync_ts) for d in invs]
    load_to_bq(bq_client, BQ_TABLE_INVOICES, inv_rows, 'INVOICES', dry_run=dry_run)

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

    # === 7. Targets mensuales (Firestore -> BigQuery)
    # Coleccion `targets` en Firestore (una fila por vendedor+ano+mes).
    # Doc ID canonico: {vendorKey_normalizado}_{year}_{MM} (unico por combinacion).
    # WRITE_TRUNCATE: garantiza dedup por construccion (borra y reescribe todo).
    # No usamos Firestore Extension porque son ~50 docs y este pull es mas simple.
    target_rows = sync_targets_from_firestore(db, sync_ts)
    load_to_bq(bq_client, BQ_TABLE_TARGETS, target_rows, 'TARGETS', dry_run=dry_run)

    log('=== sync_sap_to_bigquery END OK ===')


if __name__ == '__main__':
    main()
