"""
Sync SAP stock CSV -> stock.json
================================

Lee un CSV exportado desde SAP (lo genera David con una query, deposito 07)
y lo convierte a stock.json para que la app lea solo un booleano por SKU.

Convencion: NO exponemos cantidades exactas en stock.json. Solo true/false
por SKU. Cuando se conecte a SAP via Service Layer (mas adelante), pasamos
a cantidades reales.

Variables de entorno:
    SAP_STOCK_CSV_URL   URL publica del CSV (Drive con link compartido, OneDrive, etc).
                        Si el CSV esta en Drive, usar el formato:
                        https://drive.google.com/uc?id=FILE_ID&export=download

Layout esperado del CSV (David define las columnas exactas):
    - Una columna con el codigo del item (SKU): nombres aceptados:
      'ItemCode', 'SKU', 'Codigo', 'CODIGO', 'Code'.
    - Una columna con la cantidad disponible: nombres aceptados:
      'OnHand', 'Available', 'Disponible', 'Stock', 'Cantidad', 'Qty'.
    - (Opcional) Una columna con el deposito: 'WhsCode', 'Warehouse',
      'Deposito'. Si existe, filtramos solo las filas del deposito 07.

Salida: stock.json con la estructura
{
    "updatedAt": "ISO8601",
    "source": "SAP",
    "warehouse": "07",
    "totalSkus": <int>,
    "withStock": <int>,
    "withoutStock": <int>,
    "stock": { "<SKU>": true|false, ... }
}
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STOCK_JSON = REPO_ROOT / "stock.json"

SKU_COL_NAMES = {
    "itemcode", "sku", "codigo", "code", "item",
    "item no.", "item no", "item number", "no. art.", "nro art",
}
QTY_COL_NAMES = {
    "onhand", "available", "disponible", "stock", "cantidad", "qty", "saldo",
    "in stock", "instock", "on hand",
}
WHS_COL_NAMES = {"whscode", "warehouse", "deposito", "almacen", "whs"}

WAREHOUSE_FILTER = "07"  # solo deposito 07


def fail(msg: str) -> None:
    print(f"[sync_stock] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def info(msg: str) -> None:
    print(f"[sync_stock] {msg}")


def fetch_csv(url: str) -> str:
    info(f"Descargando CSV desde {url[:80]}...")
    # User-Agent de navegador real: Drive a veces devuelve HTML de bloqueo
    # cuando detecta clients raros (default urllib o WGET sin UA).
    ua = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    )
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        info(f"HTTP {resp.status} Content-Type={resp.headers.get('Content-Type')} bytes={len(raw)}")

    # Detectar si Drive devolvio una pagina de confirmacion (archivos > 25 MB o
    # con flag virus-scan-skipped) o de bloqueo. En ese caso intenta extraer
    # el link de descarga real desde el HTML y reintentar.
    head_lower = raw[:512].lower()
    if b"<html" in head_lower or b"<!doctype" in head_lower:
        info("La respuesta es HTML, no CSV. Intento extraer link de confirmacion...")
        html = raw.decode("utf-8", errors="replace")
        # Caso 1: pagina de "virus scan" tiene un form con confirm token
        import re
        m = re.search(r'href="(/uc\?[^"]*confirm=[^"]+)"', html)
        if m:
            confirm_url = "https://drive.google.com" + m.group(1).replace("&amp;", "&")
            info(f"Confirm URL detectada, reintento: {confirm_url[:80]}...")
            req2 = urllib.request.Request(confirm_url, headers={"User-Agent": ua})
            with urllib.request.urlopen(req2, timeout=60) as resp2:
                raw = resp2.read()
                info(f"Reintento HTTP {resp2.status} bytes={len(raw)}")
        else:
            # Mostrar primer trozo del HTML para debug
            preview = raw[:500].decode("utf-8", errors="replace")
            fail(
                f"Drive devolvio HTML y no encontre link de confirmacion. "
                f"Preview: {preview!r}"
            )

    # Validar que ahora si es CSV (no HTML)
    head_lower = raw[:256].lower()
    if b"<html" in head_lower or b"<!doctype" in head_lower:
        preview = raw[:500].decode("utf-8", errors="replace")
        fail(f"Tras reintento aun es HTML. Preview: {preview!r}")

    # Probar UTF-8 BOM, UTF-8, Latin-1
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw.decode(enc)
            info(f"CSV decodificado como {enc} ({len(text)} chars)")
            return text
        except UnicodeDecodeError:
            continue
    fail("No se pudo decodificar el CSV (probe utf-8-sig, utf-8, latin-1)")
    return ""  # nunca llega


def detect_delimiter(text: str) -> str:
    head = text[:4096]
    sniffer = csv.Sniffer()
    try:
        return sniffer.sniff(head, delimiters=",;|\t").delimiter
    except csv.Error:
        # Fallback: contar caracteres comunes en la primera linea
        first = head.splitlines()[0] if head else ""
        counts = {d: first.count(d) for d in [",", ";", "|", "\t"]}
        return max(counts, key=counts.get) if any(counts.values()) else ","


def find_col(header_lower: list[str], candidates: set[str]) -> int | None:
    for i, h in enumerate(header_lower):
        if h.strip() in candidates:
            return i
    return None


def parse_qty(raw: str) -> float:
    if raw is None:
        return 0.0
    s = str(raw).strip()
    if not s:
        return 0.0
    # SAP a veces exporta con coma decimal y miles con punto
    # Heuristica: si hay una sola coma y ningun punto -> coma es decimal
    # Si hay punto y coma -> punto es miles, coma decimal
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s and s.count(",") == 1:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def main() -> None:
    url = os.environ.get("SAP_STOCK_CSV_URL", "").strip()
    if not url:
        info("SAP_STOCK_CSV_URL no esta configurado - no hay nada que sincronizar.")
        info("Configura el secret en GitHub: Settings -> Secrets and variables -> Actions.")
        return  # exit 0, no error: el workflow no falla mientras David termina su parte

    text = fetch_csv(url)
    delim = detect_delimiter(text)
    info(f"Delimiter detectado: {repr(delim)}")

    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = list(reader)
    if not rows:
        fail("CSV vacio")

    header = [h.strip() for h in rows[0]]
    header_lower = [h.lower() for h in header]
    info(f"Header: {header}")

    sku_col = find_col(header_lower, SKU_COL_NAMES)
    qty_col = find_col(header_lower, QTY_COL_NAMES)
    whs_col = find_col(header_lower, WHS_COL_NAMES)

    if sku_col is None:
        fail(f"No encuentro columna SKU. Acepto: {sorted(SKU_COL_NAMES)}")
    if qty_col is None:
        fail(f"No encuentro columna cantidad. Acepto: {sorted(QTY_COL_NAMES)}")

    if whs_col is not None:
        info(f"Columna deposito encontrada (col {whs_col}): filtro solo deposito {WAREHOUSE_FILTER}")
    else:
        info(f"Sin columna deposito: asumo que el CSV ya viene filtrado a deposito {WAREHOUSE_FILTER}")

    stock_map: dict[str, bool] = {}
    skipped_no_sku = 0
    skipped_other_whs = 0
    total_with_stock = 0

    for row in rows[1:]:
        if not row:
            continue
        if len(row) <= max(sku_col, qty_col):
            continue
        sku = (row[sku_col] or "").strip().upper()
        if not sku:
            skipped_no_sku += 1
            continue
        if whs_col is not None and len(row) > whs_col:
            whs = (row[whs_col] or "").strip()
            if whs != WAREHOUSE_FILTER:
                skipped_other_whs += 1
                continue
        qty = parse_qty(row[qty_col])
        has_stock = qty > 0
        # Si un SKU aparece en varias filas (multi-lote), basta con que uno tenga stock
        prev = stock_map.get(sku)
        stock_map[sku] = bool(prev or has_stock)
        if stock_map[sku] and not prev:
            total_with_stock += 1

    total = len(stock_map)
    without_stock = total - total_with_stock

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "SAP",
        "warehouse": WAREHOUSE_FILTER,
        "totalSkus": total,
        "withStock": total_with_stock,
        "withoutStock": without_stock,
        "stock": stock_map,
    }

    info(f"Filas con SKU vacio: {skipped_no_sku}")
    info(f"Filas de otro deposito (descartadas): {skipped_other_whs}")
    info(f"SKUs unicos: {total}")
    info(f"  con stock: {total_with_stock}")
    info(f"  sin stock: {without_stock}")

    # Solo reescribir si cambio (para no inflar el historial git)
    existing = None
    if STOCK_JSON.exists():
        try:
            existing = json.loads(STOCK_JSON.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = None

    # Comparar solo la parte de stock (ignorar updatedAt)
    existing_stock = (existing or {}).get("stock") if existing else None
    if existing_stock == stock_map:
        info("Sin cambios en el stock. No reescribo stock.json.")
        return

    STOCK_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False),
        encoding="utf-8",
    )
    info(f"stock.json actualizado ({STOCK_JSON})")


if __name__ == "__main__":
    main()
