"""Sync GitHub Actions workflow status → Firestore.

Corre cada 5 min via GitHub Actions cron (usa built-in github.token con
permiso actions:read, sin PAT extra). Escribe agregado a
`app_config/gh_actions_status` para que el Panel de Control (Mariano-only,
v611) lo muestre en tiempo real.

Contenido del doc:
    {
      "workflows": {
        "<workflow-name>": {
          "lastRunStatus": "in_progress" | "completed" | "queued",
          "lastRunConclusion": "success" | "failure" | "cancelled" | null,
          "lastRunAt": "2026-08-24T22:34Z",
          "lastRunUrl": "https://github.com/.../runs/32787047183",
          "recentFailures": 0|1|2|... (ultimas 20 corridas)
        },
        ...
      },
      "syncedAt": ISO,
      "totalRunsRead": N,
      "totalFailingWorkflows": M
    }

Variables de entorno:
    GH_TOKEN                 built-in github.token (permission actions:read)
    GH_REPOSITORY            "owner/repo" (built-in $GITHUB_REPOSITORY)
    FIREBASE_SERVICE_ACCOUNT JSON del SA para escribir Firestore
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

import firebase_admin
import requests
from firebase_admin import credentials, firestore

GH_TOKEN = os.environ.get("GH_TOKEN", "")
GH_REPO = os.environ.get("GH_REPOSITORY", "shimano-arg/app-vendedores")
FB_SA_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
GH_API_BASE = "https://api.github.com"

# Workflows criticos que queremos monitorear. Los que no estan en esta lista
# se agregan igual al doc, solo que sin threshold especial. Podemos agregar
# hints por workflow si algun dia necesitamos por-workflow config.
CRITICAL_WORKFLOWS = {
    "Sync SAP Catalog + Stock (Service Layer)",
    "Sync SAP to BigQuery",
    "Notify Waitlist New (VDE cargas)",
    "Send Rendiciones Aprobadas",
    "Deploy to GitHub Pages",
    "Test & Lint",
}


def die(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def init_firestore():
    if not FB_SA_JSON:
        die("FIREBASE_SERVICE_ACCOUNT vacio")
    try:
        sa = json.loads(FB_SA_JSON)
    except Exception as e:
        die(f"FIREBASE_SERVICE_ACCOUNT invalido: {e}")
    cred = credentials.Certificate(sa)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def fetch_recent_runs(session: requests.Session, per_page: int = 100) -> list:
    """Trae los ultimos N runs (de cualquier workflow) del repo."""
    url = f"{GH_API_BASE}/repos/{GH_REPO}/actions/runs"
    params = {"per_page": per_page}
    resp = session.get(url, params=params, timeout=30)
    if resp.status_code != 200:
        die(f"GH API failed: {resp.status_code} - {resp.text[:200]}")
    return resp.json().get("workflow_runs", [])


def summarize_by_workflow(runs: list) -> dict:
    """Agrupa runs por workflow name; extrae ultimo + cuenta failures en los N recientes.

    Returns:
        dict con clave workflow_name y valores {lastRunStatus, lastRunConclusion,
        lastRunAt, lastRunUrl, recentFailures}.
    """
    by_wf = defaultdict(list)
    for r in runs:
        name = r.get("name") or r.get("display_title") or "unknown"
        by_wf[name].append(r)

    out = {}
    for name, wf_runs in by_wf.items():
        # runs ya vienen ordenados por created_at desc.
        latest = wf_runs[0]
        recent_failures = sum(
            1 for r in wf_runs[:20] if (r.get("conclusion") == "failure")
        )
        out[name] = {
            "lastRunStatus": latest.get("status", "unknown"),
            "lastRunConclusion": latest.get("conclusion"),
            "lastRunAt": latest.get("created_at") or latest.get("run_started_at") or "",
            "lastRunUrl": latest.get("html_url") or "",
            "lastRunNumber": latest.get("run_number", 0),
            "recentFailures": recent_failures,
            "isCritical": name in CRITICAL_WORKFLOWS,
        }
    return out


def write_snapshot(db, workflows: dict, total_runs: int) -> None:
    total_failing = sum(
        1
        for w in workflows.values()
        if w.get("lastRunConclusion") == "failure" and w.get("isCritical")
    )
    payload = {
        "workflows": workflows,
        "syncedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "totalRunsRead": total_runs,
        "totalFailingWorkflows": total_failing,
        "totalCriticalFailingWorkflows": total_failing,
    }
    db.collection("app_config").document("gh_actions_status").set(payload)
    print(f"[gh-sync] wrote gh_actions_status: {len(workflows)} workflows, "
          f"{total_failing} critical failing, {total_runs} runs read")


def main() -> int:
    if not GH_TOKEN:
        print("[warn] GH_TOKEN vacio - intentando sin auth (rate limit bajo)")
    session = requests.Session()
    session.headers.update(
        {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
    )
    if GH_TOKEN:
        session.headers["Authorization"] = f"Bearer {GH_TOKEN}"

    runs = fetch_recent_runs(session)
    print(f"[gh-sync] read {len(runs)} recent runs from {GH_REPO}")
    workflows = summarize_by_workflow(runs)

    db = init_firestore()
    write_snapshot(db, workflows, len(runs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
