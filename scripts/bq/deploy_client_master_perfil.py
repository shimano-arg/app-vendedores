"""
deploy_client_master_perfil.py — v1257 (2026-10-13)
Deploya la vista BQ v_client_master_perfil (perfil comercial del master de clientes).

Requiere: pip install google-cloud-bigquery + gcloud auth application-default login
Usage:    python scripts/bq/deploy_client_master_perfil.py
"""
import os
import sys
from pathlib import Path

try:
    from google.cloud import bigquery
except ImportError:
    print("ERROR: pip install google-cloud-bigquery", file=sys.stderr)
    sys.exit(1)

PROJECT_ID = "app-vendedores-shimano"
SQL_FILE = Path(__file__).parent / "client_master_perfil.sql"


def main():
    if not SQL_FILE.exists():
        print(f"ERROR: {SQL_FILE} no existe", file=sys.stderr)
        sys.exit(1)
    sql_text = SQL_FILE.read_text(encoding="utf-8")
    client = bigquery.Client(project=PROJECT_ID)
    print(f"Project: {PROJECT_ID}")
    print(f"Deployando v_client_master_perfil desde {SQL_FILE.name}...")
    try:
        job = client.query(sql_text)
        job.result()
        print("OK")
    except Exception as e:
        print(f"FAIL\n{e}")
        sys.exit(1)
    print("\nVista deployada: app-vendedores-shimano.shimano_app.v_client_master_perfil")


if __name__ == "__main__":
    main()
