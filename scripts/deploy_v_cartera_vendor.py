"""
Deploya la view v_cartera_vendor (v1283, 2026-10-20) a BigQuery y corre un
smoke query con el top 10 vendors por cantidad de clientes.

Uso:
  python scripts/deploy_v_cartera_vendor.py

Requiere: google-cloud-bigquery + ADC del proyecto app-vendedores-shimano
(o service account con roles/bigquery.dataEditor + roles/bigquery.jobUser).

Patron: calco de scripts/deploy_leads_detalle_view.py.
"""
import re
from pathlib import Path

from google.cloud import bigquery

PROJECT = "app-vendedores-shimano"
VIEWS_FILE = Path("bigquery/views.sql")
VIEW_NAME = "v_cartera_vendor"


def extract_view_sql(src: str, view_name: str) -> str:
    """Extrae el bloque CREATE OR REPLACE VIEW ... para el view_name dado."""
    pattern = (
        r"(CREATE OR REPLACE VIEW\s+`[^`]+\." + re.escape(view_name) + r"`\s+AS.*?;\s*)"
    )
    m = re.search(pattern, src, re.DOTALL | re.IGNORECASE)
    if not m:
        raise SystemExit(
            f"[ERROR] no encontre CREATE OR REPLACE VIEW {view_name} en {VIEWS_FILE}"
        )
    return m.group(1)


def main() -> None:
    if not VIEWS_FILE.exists():
        raise SystemExit(f"[ERROR] no existe {VIEWS_FILE}")
    src = VIEWS_FILE.read_text(encoding="utf-8")
    sql = extract_view_sql(src, VIEW_NAME)
    print(f"[deploy] {VIEW_NAME} ({len(sql)} chars)...")
    client = bigquery.Client(project=PROJECT)
    client.query(sql).result()
    print(f"[OK] {VIEW_NAME} deployada.\n")

    smoke_sql = (
        f"SELECT vendor_key, COUNT(*) AS n_clientes "
        f"FROM `{PROJECT}.shimano_app.{VIEW_NAME}` "
        f"GROUP BY vendor_key ORDER BY n_clientes DESC LIMIT 10"
    )
    print("[smoke] top 10 vendors por cantidad de clientes...")
    rows = list(client.query(smoke_sql).result())
    total = sum(r["n_clientes"] for r in rows)
    print(f"[OK] top 10 vendors ({total} clientes totales en el top):")
    for r in rows:
        print(f"  {r['vendor_key']:<40} {r['n_clientes']:>5} clientes")


if __name__ == "__main__":
    main()
