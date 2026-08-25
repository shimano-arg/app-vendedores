"""Sync Firestore usage (reads/writes/deletes 24h + storage) → Firestore.

Corre cada 30 min via GH Actions cron. Escribe agregado a
`app_config/firestore_quota` para que el Panel de Control (Mariano-only)
muestre uso vs free tier antes de que sorprenda facturacion.

Free tier limits (Spark / Blaze free layer):
  - reads: 50,000/dia
  - writes: 20,000/dia
  - deletes: 20,000/dia
  - storage: 1 GB

Fuente: Cloud Monitoring API metrics. Metric IDs:
  - firestore.googleapis.com/document/read_count       (DELTA)
  - firestore.googleapis.com/document/write_count      (DELTA)
  - firestore.googleapis.com/document/delete_count     (DELTA)
  - firestore.googleapis.com/document/storage_bytes    (GAUGE)

Requisitos:
  - Cloud Monitoring API habilitada en el proyecto GCP
  - FIREBASE_SERVICE_ACCOUNT con rol `roles/monitoring.viewer`

Doc shape:
    {
      "status": "ok" | "error",
      "reads24h": N,
      "writes24h": N,
      "deletes24h": N,
      "storageBytes": N,
      "freeTier": {"reads": 50000, "writes": 20000, "deletes": 20000, "storageBytes": 1073741824},
      "syncedAt": ISO,
      "errorMessage": null | "..."
    }
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import monitoring_v3
from google.oauth2 import service_account

FB_SA_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")

FREE_TIER = {
    "reads": 50_000,
    "writes": 20_000,
    "deletes": 20_000,
    "storageBytes": 1_073_741_824,  # 1 GB
}


def die(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def load_sa():
    if not FB_SA_JSON:
        die("FIREBASE_SERVICE_ACCOUNT vacio")
    try:
        return json.loads(FB_SA_JSON)
    except Exception as e:
        die(f"FIREBASE_SERVICE_ACCOUNT invalido: {e}")


def init_firestore(sa_dict: dict):
    cred = credentials.Certificate(sa_dict)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def init_monitoring(sa_dict: dict) -> tuple:
    project_id = sa_dict.get("project_id")
    if not project_id:
        die("SA sin project_id")
    creds = service_account.Credentials.from_service_account_info(
        sa_dict,
        scopes=["https://www.googleapis.com/auth/monitoring.read"],
    )
    client = monitoring_v3.MetricServiceClient(credentials=creds)
    return client, f"projects/{project_id}"


def sum_delta_metric(client, project_name: str, metric_type: str, hours: int = 24) -> int:
    """Suma un DELTA metric sobre ventana de N horas.

    ALIGN_SUM colapsa cada serie a un solo bucket (window entera). REDUCE_SUM
    suma across series (por database + module label). Firestore metrics tienen
    labels module=DOCUMENT, database=(default) usualmente.
    """
    now = int(time.time())
    interval = monitoring_v3.TimeInterval(
        end_time={"seconds": now},
        start_time={"seconds": now - hours * 3600},
    )
    aggregation = monitoring_v3.Aggregation(
        alignment_period={"seconds": hours * 3600},
        per_series_aligner=monitoring_v3.Aggregation.Aligner.ALIGN_SUM,
        cross_series_reducer=monitoring_v3.Aggregation.Reducer.REDUCE_SUM,
    )
    results = client.list_time_series(
        request={
            "name": project_name,
            "filter": f'metric.type = "{metric_type}"',
            "interval": interval,
            "aggregation": aggregation,
            "view": monitoring_v3.ListTimeSeriesRequest.TimeSeriesView.FULL,
        }
    )
    total = 0
    for ts in results:
        for point in ts.points:
            v = point.value
            total += int(v.int64_value or v.double_value or 0)
    return total


def latest_gauge_metric(client, project_name: str, metric_type: str, hours: int = 2) -> int:
    """Ultimo valor de un GAUGE metric (storage bytes).

    Ventana chica (2h) porque storage se reporta cada 30 min aprox. ALIGN_MAX
    dentro de cada serie + REDUCE_SUM across databases para total storage.
    """
    now = int(time.time())
    interval = monitoring_v3.TimeInterval(
        end_time={"seconds": now},
        start_time={"seconds": now - hours * 3600},
    )
    aggregation = monitoring_v3.Aggregation(
        alignment_period={"seconds": 3600},
        per_series_aligner=monitoring_v3.Aggregation.Aligner.ALIGN_MAX,
        cross_series_reducer=monitoring_v3.Aggregation.Reducer.REDUCE_SUM,
    )
    results = client.list_time_series(
        request={
            "name": project_name,
            "filter": f'metric.type = "{metric_type}"',
            "interval": interval,
            "aggregation": aggregation,
            "view": monitoring_v3.ListTimeSeriesRequest.TimeSeriesView.FULL,
        }
    )
    latest = 0
    for ts in results:
        # Ultimo point de la serie (mas reciente)
        if ts.points:
            v = ts.points[0].value
            latest += int(v.int64_value or v.double_value or 0)
    return latest


def write_error(db, error_msg: str) -> None:
    payload = {
        "status": "error",
        "reads24h": 0,
        "writes24h": 0,
        "deletes24h": 0,
        "storageBytes": 0,
        "freeTier": FREE_TIER,
        "syncedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "errorMessage": error_msg,
    }
    db.collection("app_config").document("firestore_quota").set(payload)
    print(f"[fs-quota-sync] wrote firestore_quota status=error: {error_msg}")


def main() -> int:
    sa_dict = load_sa()
    db = init_firestore(sa_dict)

    try:
        mon_client, project_name = init_monitoring(sa_dict)
        reads = sum_delta_metric(mon_client, project_name, "firestore.googleapis.com/document/read_count")
        writes = sum_delta_metric(mon_client, project_name, "firestore.googleapis.com/document/write_count")
        deletes = sum_delta_metric(mon_client, project_name, "firestore.googleapis.com/document/delete_count")
        storage = latest_gauge_metric(mon_client, project_name, "firestore.googleapis.com/document/storage_bytes")
    except Exception as e:
        write_error(db, f"{type(e).__name__}: {str(e)[:400]}")
        return 0  # no fallar el workflow

    payload = {
        "status": "ok",
        "reads24h": reads,
        "writes24h": writes,
        "deletes24h": deletes,
        "storageBytes": storage,
        "freeTier": FREE_TIER,
        "syncedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "errorMessage": None,
    }
    db.collection("app_config").document("firestore_quota").set(payload)
    print(
        f"[fs-quota-sync] wrote firestore_quota: reads={reads}, writes={writes}, "
        f"deletes={deletes}, storage={storage} bytes"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
