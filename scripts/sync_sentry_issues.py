"""Sync Sentry unresolved issues → Firestore.

Corre cada 15 min via GH Actions cron. Escribe agregado a
`app_config/sentry_issues` para que el Panel de Control (Mariano-only, v611)
muestre estado + top issues sin salir de la app.

Requisito: SENTRY_AUTH_TOKEN debe existir como GH secret. Se crea en
https://sentry.io/settings/account/api/auth-tokens/ con scopes:
  - `event:read` (leer issues)
  - `org:read` (listar org info)

Si el secret no esta seteado, el script escribe un doc "not_configured"
para que el panel muestre mensaje claro en vez de romper el sync.

Variables de entorno:
    SENTRY_AUTH_TOKEN         auth token con scopes event:read + org:read
    SENTRY_ORG_SLUG           default: 'shimano' (memory reference)
    SENTRY_PROJECT_SLUG       default: 'app-vendedores'
    FIREBASE_SERVICE_ACCOUNT  JSON del SA

Doc shape:
    {
      "status": "ok" | "not_configured" | "error",
      "totalUnresolved": N,
      "byLevel": {"error": M, "warning": K, "info": ...},
      "recentIssues": [
        {"id", "title", "culprit", "level", "count", "userCount",
         "lastSeen", "permalink", "shortId"}
        ...
      ],
      "syncedAt": ISO,
      "errorMessage": null | "..."
    }
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone

import firebase_admin
import requests
from firebase_admin import credentials, firestore

SENTRY_TOKEN = os.environ.get("SENTRY_AUTH_TOKEN", "")
SENTRY_ORG = os.environ.get("SENTRY_ORG_SLUG", "shimano")
SENTRY_PROJECT = os.environ.get("SENTRY_PROJECT_SLUG", "app-vendedores")
FB_SA_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
SENTRY_API_BASE = "https://sentry.io/api/0"


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


def write_not_configured(db, reason: str) -> None:
    """Escribe doc marcando que Sentry no esta configurado. El panel muestra
    banner claro con instrucciones en vez de romper."""
    payload = {
        "status": "not_configured",
        "totalUnresolved": 0,
        "byLevel": {},
        "recentIssues": [],
        "syncedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "errorMessage": reason,
    }
    db.collection("app_config").document("sentry_issues").set(payload)
    print(f"[sentry-sync] wrote sentry_issues status=not_configured: {reason}")


def write_error(db, error_msg: str) -> None:
    """Escribe doc marcando error de sync (token invalido, red, etc)."""
    payload = {
        "status": "error",
        "totalUnresolved": 0,
        "byLevel": {},
        "recentIssues": [],
        "syncedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "errorMessage": error_msg,
    }
    db.collection("app_config").document("sentry_issues").set(payload)
    print(f"[sentry-sync] wrote sentry_issues status=error: {error_msg}")


def fetch_unresolved_issues(session: requests.Session) -> list:
    """Trae issues no resueltos (top 50) del proyecto en las ultimas 24h."""
    url = f"{SENTRY_API_BASE}/organizations/{SENTRY_ORG}/issues/"
    params = {
        "query": f"is:unresolved project:{SENTRY_PROJECT}",
        "statsPeriod": "24h",
        "limit": 50,
    }
    resp = session.get(url, params=params, timeout=30)
    if resp.status_code == 401 or resp.status_code == 403:
        raise RuntimeError(f"Sentry auth failed ({resp.status_code}): revisar token + scopes")
    if resp.status_code != 200:
        raise RuntimeError(f"Sentry API failed ({resp.status_code}): {resp.text[:300]}")
    return resp.json()


def fetch_error_count_history(session: requests.Session) -> list:
    """v616 iter 5: cuenta events por hora las ultimas 24h para tendencia.

    Sentry `/events-stats/` retorna serie temporal. Devolvemos list de
    {hourIso, count}. Silenciamos errores porque el field es opcional en el doc.
    """
    url = f"{SENTRY_API_BASE}/organizations/{SENTRY_ORG}/events-stats/"
    params = {
        "query": f"event.type:error project:{SENTRY_PROJECT}",
        "statsPeriod": "24h",
        "interval": "1h",
        "yAxis": "count()",
    }
    try:
        resp = session.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"[sentry-sync] warn: events-stats {resp.status_code}", file=sys.stderr)
            return []
        body = resp.json()
        # Response shape: {"data": [[timestamp_epoch, [{"count": N}]], ...]}
        raw = body.get("data") or []
        out = []
        for entry in raw:
            if not isinstance(entry, list) or len(entry) < 2:
                continue
            ts_epoch = entry[0]
            slots = entry[1]
            count = 0
            if isinstance(slots, list) and slots:
                count = int(slots[0].get("count", 0) or 0)
            hour_iso = datetime.fromtimestamp(ts_epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")
            out.append({"hourIso": hour_iso, "count": count})
        return out
    except Exception as e:
        print(f"[sentry-sync] warn: events-stats fetch failed: {e}", file=sys.stderr)
        return []


def summarize(issues: list) -> dict:
    """Extrae summary + top issues."""
    by_level = Counter()
    for it in issues:
        lvl = (it.get("level") or "unknown").lower()
        by_level[lvl] += 1
    recent = []
    for it in issues[:20]:
        recent.append({
            "id": it.get("id", ""),
            "shortId": it.get("shortId", ""),
            "title": it.get("title", "")[:200],
            "culprit": (it.get("culprit") or "")[:200],
            "level": it.get("level", "unknown"),
            "count": int(it.get("count") or 0),
            "userCount": int(it.get("userCount") or 0),
            "lastSeen": it.get("lastSeen", ""),
            "permalink": it.get("permalink") or "",
        })
    return {
        "totalUnresolved": len(issues),
        "byLevel": dict(by_level),
        "recentIssues": recent,
    }


def main() -> int:
    db = init_firestore()

    if not SENTRY_TOKEN:
        write_not_configured(
            db,
            "SENTRY_AUTH_TOKEN no seteado. Crear en sentry.io/settings/account/api/auth-tokens/ "
            "con scopes event:read + org:read y agregar como GH secret.",
        )
        return 0

    session = requests.Session()
    session.headers.update(
        {
            "Authorization": f"Bearer {SENTRY_TOKEN}",
            "Accept": "application/json",
        }
    )

    try:
        issues = fetch_unresolved_issues(session)
    except Exception as e:
        write_error(db, str(e))
        return 0  # no fallar el workflow por errores de Sentry (el panel muestra el estado)

    summary = summarize(issues)
    # v616 iter 5: agregar errorCountHistory (24h en buckets 1h) para
    # que el panel calcule spike ratio via computeSentryRateSpike.
    error_count_history = fetch_error_count_history(session)
    payload = {
        "status": "ok",
        **summary,
        "errorCountHistory": error_count_history,
        "syncedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "errorMessage": None,
    }
    db.collection("app_config").document("sentry_issues").set(payload)
    print(f"[sentry-sync] wrote sentry_issues: {summary['totalUnresolved']} unresolved, "
          f"levels={summary['byLevel']}, history={len(error_count_history)} buckets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
