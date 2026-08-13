"""
Deploya la view v_leads_detalle a BigQuery + corre la reconciliacion
contra v_leads_vs_clientes_por_vendedor y printea si cierra.

Uso:
  python _deploy_leads_detalle_view.py

Requiere: google-cloud-bigquery + ADC del proyecto app-vendedores-shimano
o service account con roles/bigquery.dataEditor + roles/bigquery.jobUser.
"""
import re
import sys
from pathlib import Path

from google.cloud import bigquery

PROJECT = "app-vendedores-shimano"
VIEWS_FILE = Path("bigquery/views.sql")
VIEW_NAME = "v_leads_detalle"
RECON_FILE = Path("bigquery/reconciliacion_leads_detalle.sql")


def extract_view_sql(src: str, view_name: str) -> str:
    """Extrae el bloque CREATE OR REPLACE VIEW ... para el view_name dado."""
    pattern = (
        r"(CREATE OR REPLACE VIEW\s+`[^`]+\." + re.escape(view_name) + r"`\s+AS.*?;\s*)"
    )
    m = re.search(pattern, src, re.DOTALL | re.IGNORECASE)
    if not m:
        raise SystemExit(f"[ERROR] no encontre CREATE OR REPLACE VIEW {view_name} en {VIEWS_FILE}")
    return m.group(1)


def main() -> None:
    src = VIEWS_FILE.read_text(encoding="utf-8")
    sql = extract_view_sql(src, VIEW_NAME)
    print(f"[deploy] {VIEW_NAME} ({len(sql)} chars)...")
    client = bigquery.Client(project=PROJECT)
    client.query(sql).result()
    print(f"[OK] view {VIEW_NAME} deployada.\n")

    # Sanity: contar filas y romper por tipo.
    q1 = f"""
      SELECT tipo, COUNT(*) AS n, COUNTIF(provincia IS NULL) AS sin_prov,
             COUNTIF(localidad IS NULL) AS sin_loc
      FROM `{PROJECT}.shimano_app.{VIEW_NAME}`
      GROUP BY tipo
      ORDER BY tipo;
    """
    print("[sanity] filas por tipo:")
    for r in client.query(q1).result():
        print(
            f"  tipo={r.tipo:12} filas={r.n:6}  sin_provincia={r.sin_prov:5}  sin_localidad={r.sin_loc:5}"
        )
    print()

    # Reconciliacion contra v_leads_vs_clientes_por_vendedor.
    if not RECON_FILE.exists():
        print(f"[WARN] no encuentro {RECON_FILE} - saltando reconciliacion.")
        return
    recon_sql = RECON_FILE.read_text(encoding="utf-8")
    # El archivo tiene un query principal y un query comentado; corremos el principal.
    print("[recon] corriendo reconciliacion vs v_leads_vs_clientes_por_vendedor...")
    rows = list(client.query(recon_sql).result())
    ok_total = 0
    fail_total = 0
    fail_rows = []
    for r in rows:
        if r.clientes_sap_ok and r.leads_ok:
            ok_total += 1
        else:
            fail_total += 1
            fail_rows.append(r)
    print(f"[recon] OK: {ok_total} vendors  FAIL: {fail_total} vendors")
    if fail_rows:
        print("\n[recon FAIL detalle]")
        for r in fail_rows:
            print(
                f"  {r.assigned_vendor:35} sap {r.clientes_sap_detalle}/{r.clientes_sap_vendor} "
                f"leads {r.leads_detalle}/{r.leads_vendor}"
            )
        print("\n[ERROR] la clasificacion de v_leads_detalle DIFIERE de "
              "v_leads_vs_clientes_por_vendedor. Revisar antes de exponer al PBI.")
        sys.exit(1)
    print("\n[OK] reconciliacion cierra para todos los vendors.")
    print("Proximos pasos manuales para Power BI:")
    print(f"  1. En Power BI Desktop: Home -> Transformar datos -> Nuevo origen -> BigQuery.")
    print(f"     Elegir {PROJECT}.shimano_app.{VIEW_NAME} y cargar.")
    print("  2. En el modelo, crear relacion N:1 con dim_Region_Geo por provincia+localidad.")
    print("  3. Publicar el .pbix. El proximo refresh del dataset (scheduled o manual)")
    print("     va a traer la view. Correr esto en PBI Service:")
    print("       Workspace -> Dataset TABLERO SAR -> Refrescar ahora.")


if __name__ == "__main__":
    main()
