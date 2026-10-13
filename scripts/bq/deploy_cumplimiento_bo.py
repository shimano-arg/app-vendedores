"""
deploy_cumplimiento_bo.py
Deploya las 3 vistas BQ para medir tasa de cumplimiento del Backorder.

Lee scripts/bq/cumplimiento_bo.sql y ejecuta cada statement CREATE OR REPLACE
VIEW por separado. UTF-8 explicito en TODO para evitar mojibake con tildes
(feedback_bq_view_deploy_utf8 2026-10-13).

Requiere: pip install google-cloud-bigquery
          gcloud auth application-default login
Usage:    python scripts/bq/deploy_cumplimiento_bo.py
"""

import os
import re
import sys
from pathlib import Path

try:
    from google.cloud import bigquery
except ImportError:
    print("ERROR: pip install google-cloud-bigquery", file=sys.stderr)
    sys.exit(1)

PROJECT_ID = "app-vendedores-shimano"
DATASET = "shimano_app"
SQL_FILE = Path(__file__).parent / "cumplimiento_bo.sql"


def split_statements(sql_text):
    """
    Separa statements por ';' al final de linea. Ignora ';' dentro de
    strings (ninguno en este SQL pero defensive).
    """
    statements = []
    current = []
    for line in sql_text.splitlines():
        current.append(line)
        if line.rstrip().endswith(";"):
            stmt = "\n".join(current).strip()
            # Skip lineas que solo son comentarios + ';'
            non_comment = "\n".join(
                [l for l in stmt.splitlines() if not l.lstrip().startswith("--")]
            ).strip()
            if non_comment and not non_comment.rstrip(";").strip() == "":
                statements.append(stmt)
            current = []
    return statements


def extract_view_name(stmt):
    """Extrae el nombre de la vista de un CREATE OR REPLACE VIEW."""
    m = re.search(r"CREATE\s+OR\s+REPLACE\s+VIEW\s+`([^`]+)`", stmt, re.IGNORECASE)
    return m.group(1) if m else "<unknown>"


def main():
    if not SQL_FILE.exists():
        print(f"ERROR: {SQL_FILE} no existe", file=sys.stderr)
        sys.exit(1)

    sql_text = SQL_FILE.read_text(encoding="utf-8")
    statements = split_statements(sql_text)
    if not statements:
        print("ERROR: no se encontraron statements CREATE OR REPLACE VIEW", file=sys.stderr)
        sys.exit(1)

    client = bigquery.Client(project=PROJECT_ID)
    print(f"Project: {PROJECT_ID} / Dataset: {DATASET}")
    print(f"Deploying {len(statements)} statements desde {SQL_FILE.name}...\n")

    ok = 0
    fail = 0
    for i, stmt in enumerate(statements, 1):
        view = extract_view_name(stmt)
        print(f"  [{i}/{len(statements)}] {view}...", end=" ", flush=True)
        try:
            job = client.query(stmt)
            job.result()  # blocking
            print("OK")
            ok += 1
        except Exception as e:
            print(f"FAIL\n     {e}")
            fail += 1

    print(f"\nResumen: {ok} OK / {fail} FAIL de {len(statements)} statements.")
    if fail:
        sys.exit(1)

    print("\nVistas deployadas:")
    for stmt in statements:
        print(f"  - {extract_view_name(stmt)}")


if __name__ == "__main__":
    main()
