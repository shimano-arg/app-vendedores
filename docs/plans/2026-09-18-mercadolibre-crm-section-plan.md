# Sección MERCADOLIBRE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar la data de `mercado-intelligence` al CRM `app-vendedores` como sección Mariano-only con 3 sub-tabs (MAP · Productos · Categorías), alimentada por sync diario cross-project.

**Architecture:** Sync unidireccional diario `mercado-intelligence → app-vendedores` vía GHA con Service Account. La app lee de su propio Firestore (4 colecciones mirror). UI = chunk lazy + modal con sub-tabs abierto desde el Panel de Control existente.

**Tech Stack:** Firestore (2 proyectos GCP), Python 3.11 (google-cloud-firestore + BigQuery + módulos existentes `mi.*`), Vanilla JS (chunk lazy en `src/domains/meli.js`), Vitest (unit + rules), GitHub Actions (cron 9:20 ARG).

**Spec de referencia:** `docs/specs/2026-09-18-mercadolibre-crm-section-design.md`

**Convención de código:** todo output HTML del bundle usa `escapeHtml()` (global del inline) para escapar strings user-supplied antes de asignar al DOM. Este patrón es consistente con `src/domains/rendiciones.js`, `panel-control.js` y todos los renderers del bundle. Ver regla de seguridad en `firestore.rules` y comentarios de `src/domains/panel-control.js`.

---

## Etapa E0 · Setup GCP (manual, gate humano)

### Task E0.1: Crear Service Account en app-vendedores-shimano

**Files:** ninguno (config manual GCP).

- [ ] **Step 1: Crear SA en el proyecto `app-vendedores-shimano`**

Abrir https://console.cloud.google.com/iam-admin/serviceaccounts?project=app-vendedores-shimano y crear SA:
- Name: `mi-sync-writer`
- Description: `Escritura de las colecciones meli_* desde el pipeline mercado-intelligence`
- Email resultante: `mi-sync-writer@app-vendedores-shimano.iam.gserviceaccount.com`

- [ ] **Step 2: Otorgar rol Cloud Datastore User a la SA**

En la misma consola, sección "Grant this service account access to project":
- Rol: `Cloud Datastore User` (roles/datastore.user)
- Sin condiciones adicionales.

- [ ] **Step 3: Descargar key JSON**

Click en la SA creada → Keys → Add Key → Create new key → JSON. Se descarga a Downloads.

- [ ] **Step 4: Verificar SA con gcloud**

Run:
```powershell
gcloud iam service-accounts describe mi-sync-writer@app-vendedores-shimano.iam.gserviceaccount.com --project app-vendedores-shimano
```
Expected: JSON con `email`, `disabled: false`, `oauth2ClientId`. Sin errores.

### Task E0.2: Cargar key como GH Secret en repo mercado-intelligence

**Files:** ninguno (config manual GitHub).

- [ ] **Step 1: Crear GH Secret `APP_VENDEDORES_SA_KEY`**

Abrir https://github.com/botshimanopesca-beep/mercado-intelligence/settings/secrets/actions/new:
- Name: `APP_VENDEDORES_SA_KEY`
- Value: pegar el JSON completo de la key descargada en E0.1

- [ ] **Step 2: Verificar que aparece en la lista**

Run:
```powershell
gh secret list --repo botshimanopesca-beep/mercado-intelligence
```
Expected: `APP_VENDEDORES_SA_KEY` aparece con `Updated` reciente.

- [ ] **Step 3: Borrar la key local**

Borrar el JSON de Downloads. La key vive en GH Secret + descargable de nuevo desde GCP si se re-crea. Nunca commitear.

---

## Etapa E1 · Sync script + dry-run

### Task E1.1: Crear script sync_to_app.py con estructura + dry-run

**Files:**
- Create: `scripts/sync_to_app.py` (en repo mercado-intelligence)

- [ ] **Step 1: Crear rama en repo mercado-intelligence**

Run:
```powershell
cd C:\Users\shimano.sandbox\Desktop\MERCADOLIBRE\mercado-intelligence
git checkout main
git pull origin main
git checkout -b feat/sync-to-app
```

- [ ] **Step 2: Escribir script skeleton con parser + clients**

Crear `scripts/sync_to_app.py`:
```python
"""Sync diario de mercado-intelligence Firestore -> app-vendedores Firestore.

Corre cada dia a las 9:20 ARG (12:20 UTC) via .github/workflows/sync-to-app.yml.
Lee: market_products + market_categories (Firestore MI) + BQ para MAP alerts.
Escribe: meli/state + meli_products + meli_categories + meli_map_alerts en
Firestore de app-vendedores-shimano.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from google.cloud import bigquery, firestore
from google.oauth2 import service_account

log = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Lee, imprime counts, no escribe.")
    parser.add_argument("--mi-credentials", default=".secrets/gcp_sa_key.json")
    parser.add_argument("--av-credentials", default=".secrets/app_vendedores_sa.json")
    return parser.parse_args()


def _make_clients(args: argparse.Namespace) -> tuple[firestore.Client, firestore.Client, bigquery.Client]:
    mi_creds = service_account.Credentials.from_service_account_file(args.mi_credentials)
    av_creds = service_account.Credentials.from_service_account_file(args.av_credentials)
    fs_mi = firestore.Client(
        project="shimano-mi", credentials=mi_creds, database="mi-pipeline-bq-meli-shimano-new"
    )
    fs_av = firestore.Client(project="app-vendedores-shimano", credentials=av_creds)
    bq_mi = bigquery.Client(project="shimano-mi", credentials=mi_creds, location="southamerica-east1")
    return fs_mi, fs_av, bq_mi


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = parse_args()
    log.info("sync_to_app iniciado (dry_run=%s)", args.dry_run)
    fs_mi, fs_av, bq_mi = _make_clients(args)
    log.info("Clientes: fs_mi=%s fs_av=%s bq_mi=%s", fs_mi.project, fs_av.project, bq_mi.project)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Verificar imports + creds**

Descargar de nuevo el SA JSON de `mi-sync-writer` a `.secrets/app_vendedores_sa.json` (temporal para test local). Run:
```powershell
.venv\Scripts\python scripts\sync_to_app.py --dry-run
```
Expected: log `sync_to_app iniciado` + `Clientes: fs_mi=shimano-mi fs_av=app-vendedores-shimano bq_mi=shimano-mi`. Exit 0.

- [ ] **Step 4: Commit**

```powershell
git add scripts/sync_to_app.py
git commit -m "feat(sync): skeleton sync_to_app.py con parser + clients"
```

### Task E1.2: Implementar `_read_mi_snapshot`

**Files:**
- Modify: `scripts/sync_to_app.py`

- [ ] **Step 1: Agregar función `_read_mi_snapshot`**

Insertar antes de `main()`:
```python
def _read_mi_snapshot(fs_mi: firestore.Client) -> tuple[list[dict], list[dict], str]:
    """Lee 2 collections mirror + devuelve el snapshot_date mas reciente."""
    products = [d.to_dict() for d in fs_mi.collection("market_products").stream()]
    categories = [d.to_dict() for d in fs_mi.collection("market_categories").stream()]
    snapshot_dates = {p.get("snapshot_date") for p in products if p.get("snapshot_date")}
    if not snapshot_dates:
        raise RuntimeError("No hay snapshot_date en market_products -- pipeline MI no corrio?")
    snapshot_date = max(snapshot_dates)
    log.info("MI snapshot=%s products=%d categories=%d", snapshot_date, len(products), len(categories))
    return products, categories, snapshot_date
```

- [ ] **Step 2: Extender `main()` con dry-run del snapshot MI**

Reemplazar cuerpo de `main()` después de `log.info("Clientes...")`:
```python
    products, categories, snapshot_date = _read_mi_snapshot(fs_mi)
    if args.dry_run:
        log.info(
            "[DRY] products=%d categories=%d snapshot=%s. No se escribe nada.",
            len(products), len(categories), snapshot_date,
        )
        return 0
    log.warning("Escritura no implementada aun (Task E1.4).")
    return 0
```

- [ ] **Step 3: Verificar dry-run lee data real**

Run:
```powershell
.venv\Scripts\python scripts\sync_to_app.py --dry-run
```
Expected: log `MI snapshot=2026-09-17 products=231 categories=11` + `[DRY] products=231 categories=11 snapshot=2026-09-17. No se escribe nada.`

- [ ] **Step 4: Commit**

```powershell
git add scripts/sync_to_app.py
git commit -m "feat(sync): _read_mi_snapshot lee products + categories con snapshot_date"
```

### Task E1.3: Detectar MAP alerts reusando mi.map_monitor

**Files:**
- Modify: `scripts/sync_to_app.py`

- [ ] **Step 1: Agregar imports + función `_detect_alerts`**

Agregar imports:
```python
from mi.map_monitor import detect_violations, load_precios_sugeridos
from mi.sku_matcher import load_sku_catalog
```

Insertar función antes de `main()`:
```python
def _detect_alerts(bq_mi: bigquery.Client) -> list[dict]:
    """Reusa mi.map_monitor.detect_violations + serializa Violation -> dict."""
    precios = load_precios_sugeridos(Path("config/precios_sugeridos.csv"))
    catalog = load_sku_catalog(Path("config/articulos_shimano.xlsx"))
    violations = detect_violations(bq_mi, precios, catalog, tolerance_pct=0.0)
    alerts = []
    for v in violations:
        alerts.append({
            "item_id": v.item_id,
            "sku": v.sku,
            "product_name": v.product_name,
            "seller_id": int(v.seller_id),
            "seller_nickname": v.seller_nickname,
            "seller_state": v.seller_state,
            "precio_publicado": float(v.precio_publicado),
            "precio_sugerido": float(v.precio_sugerido),
            "diferencia_pct": float(v.diferencia_pct),
            "ml_url": v.ml_url,
            "snapshot_date": v.snapshot_date,
        })
    log.info("MAP: %d violaciones detectadas", len(alerts))
    return alerts
```

- [ ] **Step 2: Extender `main()` con detección de alerts**

Modificar `main()` — después de `_read_mi_snapshot()`:
```python
    products, categories, snapshot_date = _read_mi_snapshot(fs_mi)
    alerts = _detect_alerts(bq_mi)
    if args.dry_run:
        log.info(
            "[DRY] products=%d categories=%d alerts=%d snapshot=%s. No se escribe nada.",
            len(products), len(categories), len(alerts), snapshot_date,
        )
        return 0
    log.warning("Escritura no implementada aun (Task E1.4).")
    return 0
```

- [ ] **Step 3: Verificar dry-run devuelve los 4 alerts**

Run:
```powershell
.venv\Scripts\python scripts\sync_to_app.py --dry-run
```
Expected: `MAP: 4 violaciones detectadas` + `[DRY] products=231 categories=11 alerts=4 snapshot=2026-09-17`.

- [ ] **Step 4: Commit**

```powershell
git add scripts/sync_to_app.py
git commit -m "feat(sync): _detect_alerts serializa Violation a dict para Firestore"
```

### Task E1.4: Implementar escritura a Firestore de app-vendedores

**Files:**
- Modify: `scripts/sync_to_app.py`

- [ ] **Step 1: Agregar helpers `_batch_upsert` y `_wipe_and_write`**

Insertar antes de `main()`:
```python
def _batch_upsert(fs: firestore.Client, collection: str, docs: list[dict], id_field: str) -> int:
    """Upsert de N docs en batches de 500 (limite Firestore commit)."""
    col = fs.collection(collection)
    n_written = 0
    for i in range(0, len(docs), 500):
        chunk = docs[i : i + 500]
        batch = fs.batch()
        for d in chunk:
            batch.set(col.document(str(d[id_field])), d)
        batch.commit()
        n_written += len(chunk)
        log.info("  %s: %d/%d escritos", collection, n_written, len(docs))
    return n_written


def _wipe_and_write(fs: firestore.Client, collection: str, docs: list[dict], id_field: str) -> int:
    """Borra la coleccion + reescribe (patron snapshot para alerts)."""
    col = fs.collection(collection)
    existing = list(col.list_documents())
    for i in range(0, len(existing), 500):
        batch = fs.batch()
        for doc_ref in existing[i : i + 500]:
            batch.delete(doc_ref)
        batch.commit()
    log.info("  %s: %d docs viejos borrados", collection, len(existing))
    return _batch_upsert(fs, collection, docs, id_field)
```

- [ ] **Step 2: Agregar `_write_state`**

Insertar antes de `main()`:
```python
def _write_state(
    fs_av: firestore.Client,
    snapshot_date: str,
    counts: dict[str, int],
    status: str = "ok",
    error: str | None = None,
) -> None:
    """Escribe meli/state con last_sync + snapshot_date + counts + status."""
    doc: dict = {
        "last_sync": firestore.SERVER_TIMESTAMP,
        "snapshot_date": snapshot_date,
        "counts": counts,
        "sync_status": status,
        "sync_run_id": os.environ.get("GITHUB_RUN_ID", "local"),
    }
    if error:
        doc["sync_error"] = error[:500]
    fs_av.collection("meli").document("state").set(doc, merge=True)
    log.info("meli/state actualizado: status=%s snapshot=%s", status, snapshot_date)
```

- [ ] **Step 3: Reemplazar `main()` con escritura completa + error handling**

Reemplazar todo `main()` después de `parse_args()`:
```python
    fs_mi, fs_av, bq_mi = _make_clients(args)
    log.info("Clientes: fs_mi=%s fs_av=%s bq_mi=%s", fs_mi.project, fs_av.project, bq_mi.project)
    snapshot_date = "-"
    try:
        products, categories, snapshot_date = _read_mi_snapshot(fs_mi)
        alerts = _detect_alerts(bq_mi)
        counts = {"products": len(products), "categories": len(categories), "map_alerts": len(alerts)}

        if args.dry_run:
            log.info("[DRY] snapshot=%s counts=%s. No se escribe nada.", snapshot_date, counts)
            return 0

        _batch_upsert(fs_av, "meli_products", products, "catalog_product_id")
        _batch_upsert(fs_av, "meli_categories", categories, "category_id")
        _wipe_and_write(fs_av, "meli_map_alerts", alerts, "item_id")
        _write_state(fs_av, snapshot_date, counts, status="ok")
        log.info("Sync completo: %s", counts)
        return 0

    except Exception as e:
        log.exception("Sync fallo")
        try:
            _write_state(fs_av, snapshot_date, {}, status="failed", error=str(e))
        except Exception:
            log.exception("Ademas fallo el write de meli/state con status=failed")
        return 1
```

- [ ] **Step 4: Verificar dry-run**

Run:
```powershell
.venv\Scripts\python scripts\sync_to_app.py --dry-run
```
Expected: `[DRY] snapshot=2026-09-17 counts={'products': 231, 'categories': 11, 'map_alerts': 4}. No se escribe nada.`

- [ ] **Step 5: Commit**

```powershell
git add scripts/sync_to_app.py
git commit -m "feat(sync): escritura real 4 colecciones + error handling"
```

### Task E1.5: Quality gates + push branch

**Files:** ninguno (verificación).

- [ ] **Step 1: Correr ruff + format + mypy + pytest**

Run:
```powershell
cd C:\Users\shimano.sandbox\Desktop\MERCADOLIBRE\mercado-intelligence
.venv\Scripts\python -m ruff check .
.venv\Scripts\python -m ruff format --check mi/ scripts/ tests/
.venv\Scripts\python -m mypy mi scripts
.venv\Scripts\python -m pytest -q
```
Expected: los 4 pasan. Si `ruff format --check` falla, correr `.venv\Scripts\python -m ruff format scripts/sync_to_app.py`.

- [ ] **Step 2: Push branch**

```powershell
git push -u origin feat/sync-to-app
```

---

## Etapa E2 · Rules meli_* + tests

### Task E2.1: Crear rama dev + extender firestore.rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Reset rama dev desde main**

Run:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
git checkout main
git pull origin main
git branch -D dev
git checkout -b dev
git push -u origin dev --force-with-lease
```

- [ ] **Step 2: Agregar helper `isMariano()` en firestore.rules**

Editar `firestore.rules` — insertar después de `function ownsDoc()` (aprox línea 42):
```
    // Section MERCADOLIBRE (Mariano-only). Ver docs/specs/2026-09-18-mercadolibre-crm-section-design.md
    function isMariano() {
      return request.auth != null
        && request.auth.token.email in [
          'erbinomariano@gmail.com',
          'mariano.erbino@shimano.com.ar'
        ];
    }
```

- [ ] **Step 3: Agregar bloques `match` para las 4 colecciones**

Al final de `match /databases/{database}/documents { ... }`, antes del último `}` de cierre:
```
    // MERCADOLIBRE (v>=997) -- solo Mariano lee, nadie escribe desde client.
    // La escritura la hace el GHA sync-to-app.yml del repo mercado-intelligence
    // con SA (Admin SDK bypasea rules).
    match /meli/{docId} {
      allow read: if isMariano();
      allow write: if false;
    }
    match /meli_products/{productId} {
      allow read: if isMariano();
      allow write: if false;
    }
    match /meli_categories/{categoryId} {
      allow read: if isMariano();
      allow write: if false;
    }
    match /meli_map_alerts/{alertId} {
      allow read: if isMariano();
      allow write: if false;
    }
```

### Task E2.2: Escribir tests de rules

**Files:**
- Create: `tests/rules/meli.test.js`

- [ ] **Step 1: Crear archivo de tests completo**

Crear `tests/rules/meli.test.js`:
```javascript
/**
 * Tests de rules para las 4 colecciones MERCADOLIBRE (Mariano-only).
 * Ver docs/specs/2026-09-18-mercadolibre-crm-section-design.md § 5.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  anonDb,
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  collection,
  doc,
  getDoc,
  getDocs,
  initTestEnv,
  seedCanonicalRoles,
  setDoc,
  UID,
} from './setup.js';

beforeAll(async () => { await initTestEnv(); });
afterAll(async () => { await cleanupTestEnv(); });
beforeEach(async () => { await seedCanonicalRoles(); });

const MARIANO_EMAILS = ['erbinomariano@gmail.com', 'mariano.erbino@shimano.com.ar'];

describe('meli_* (Mariano-only)', () => {
  describe('read: solo Mariano', () => {
    for (const email of MARIANO_EMAILS) {
      it(`Mariano (${email}) lee meli/state`, async () => {
        const db = authedDb('uid-mariano', { email });
        await assertSucceeds(getDoc(doc(db, 'meli', 'state')));
      });
      it(`Mariano (${email}) lista meli_products`, async () => {
        const db = authedDb('uid-mariano', { email });
        await assertSucceeds(getDocs(collection(db, 'meli_products')));
      });
      it(`Mariano (${email}) lista meli_categories`, async () => {
        const db = authedDb('uid-mariano', { email });
        await assertSucceeds(getDocs(collection(db, 'meli_categories')));
      });
      it(`Mariano (${email}) lista meli_map_alerts`, async () => {
        const db = authedDb('uid-mariano', { email });
        await assertSucceeds(getDocs(collection(db, 'meli_map_alerts')));
      });
    }

    it('admin NO-Mariano NO lee meli/state', async () => {
      const db = authedDb(UID.admin, { email: 'otro-admin@shimano.com.ar' });
      await assertFails(getDoc(doc(db, 'meli', 'state')));
    });
    it('vendor NO lista meli_products', async () => {
      const db = authedDb(UID.vendor, { email: 'vendedor@shimano.com.ar' });
      await assertFails(getDocs(collection(db, 'meli_products')));
    });
    it('gerente NO lista meli_map_alerts', async () => {
      const db = authedDb(UID.gerente, { email: 'gerente@shimano.com.ar' });
      await assertFails(getDocs(collection(db, 'meli_map_alerts')));
    });
    it('interno NO lista meli_categories', async () => {
      const db = authedDb(UID.interno, { email: 'interno@shimano.com.ar' });
      await assertFails(getDocs(collection(db, 'meli_categories')));
    });
    it('viewer NO lee meli/state', async () => {
      const db = authedDb(UID.viewer, { email: 'viewer@shimano.com.ar' });
      await assertFails(getDoc(doc(db, 'meli', 'state')));
    });
    it('anon NO lee nada', async () => {
      await assertFails(getDoc(doc(anonDb(), 'meli', 'state')));
      await assertFails(getDocs(collection(anonDb(), 'meli_products')));
    });
  });

  describe('write: nadie escribe desde client', () => {
    it('Mariano NO escribe meli/state (solo SA del GHA)', async () => {
      const db = authedDb('uid-mariano', { email: 'erbinomariano@gmail.com' });
      await assertFails(setDoc(doc(db, 'meli', 'state'), { snapshot_date: '2026-09-18' }));
    });
    it('Mariano NO crea docs en meli_products', async () => {
      const db = authedDb('uid-mariano', { email: 'erbinomariano@gmail.com' });
      await assertFails(setDoc(doc(db, 'meli_products', 'MLAtest'), { name: 'test' }));
    });
    it('admin NO escribe meli_map_alerts', async () => {
      const db = authedDb(UID.admin, { email: 'otro-admin@shimano.com.ar' });
      await assertFails(setDoc(doc(db, 'meli_map_alerts', 'MLAtest'), { sku: 'X' }));
    });
  });
});
```

- [ ] **Step 2: Correr tests contra emulator**

Run:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
npx firebase emulators:exec --only firestore "npm test tests/rules/meli.test.js"
```
Expected: los 20+ casos PASS.

Si Windows tira problemas con emulators:exec, usar 2 terminales:
```powershell
# Terminal 1: npx firebase emulators:start --only firestore
# Terminal 2: npm test tests/rules/meli.test.js
```

- [ ] **Step 3: Correr suite completa de rules para verificar sin regresión**

Run:
```powershell
npx firebase emulators:exec --only firestore "npm test tests/rules/"
```
Expected: TODOS los tests (existentes + nuevos) PASS.

- [ ] **Step 4: Commit rules + tests**

```powershell
git add firestore.rules tests/rules/meli.test.js
git commit -m "feat(rules): 4 colecciones meli_* Mariano-only + tests"
```

---

## Etapa E3 · Deploy rules + primer sync productivo

### Task E3.1: Merge PR de sync a main mercado-intelligence

**Files:** ninguno (deploy).

- [ ] **Step 1: Crear PR en repo mercado-intelligence**

Run:
```powershell
cd C:\Users\shimano.sandbox\Desktop\MERCADOLIBRE\mercado-intelligence
gh pr create --title "feat: sync_to_app.py -- mirror diario a app-vendedores Firestore" --body "Script standalone que propaga los datos del pipeline MI al Firestore de app-vendedores para consumo del CRM (seccion MERCADOLIBRE Mariano-only). Ver docs/specs/ en repo app-vendedores. Sin workflow todavia (E6)."
```

- [ ] **Step 2: Merge squash**

```powershell
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```

### Task E3.2: Deploy rules + primer sync manual

**Files:** ninguno (deploy).

- [ ] **Step 1: Merge PR de rules en app-vendedores**

Run:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
gh pr create --base main --head dev --title "feat(rules): firestore rules meli_* (Mariano-only) — sin bump" --body "Solo agrega rules + tests. No cambia UI ni APP_VERSION (bump viene en E5). Se puede deployar solo sin afectar la app en produccion (las colecciones meli_* aun no se leen desde el cliente)."
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
git branch -D dev
git checkout -b dev
git push -u origin dev
```

- [ ] **Step 2: Deploy rules a Firebase**

Run:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
firebase deploy --only firestore:rules
```
Expected: `Deploy complete!` + `firestore: released rules` en Firebase Console.

- [ ] **Step 3: Verificar rules en Firebase Console**

Abrir https://console.firebase.google.com/project/app-vendedores-shimano/firestore/rules y verificar que las 4 `match /meli*/` aparecen en el timestamp de deploy actual.

- [ ] **Step 4: Trigger manual del sync (desde local, workflow viene en E6)**

Run:
```powershell
cd C:\Users\shimano.sandbox\Desktop\MERCADOLIBRE\mercado-intelligence
.venv\Scripts\python scripts\sync_to_app.py
```
Expected:
- `MI snapshot=2026-09-17 products=231 categories=11`
- `MAP: 4 violaciones detectadas`
- `meli_products: 231/231 escritos`
- `meli_categories: 11/11 escritos`
- `meli_map_alerts: 0 docs viejos borrados` (primera corrida) + `4/4 escritos`
- `meli/state actualizado: status=ok snapshot=2026-09-17`
- `Sync completo: {'products': 231, 'categories': 11, 'map_alerts': 4}`
- Exit 0.

- [ ] **Step 5: Verificar data en Firestore Console de app-vendedores**

Abrir https://console.firebase.google.com/project/app-vendedores-shimano/firestore/data y confirmar:
- `meli/state` con `sync_status: "ok"` + `snapshot_date: "2026-09-17"` + `counts.products: 231`.
- `meli_products` con 231 docs (abrir uno para verificar campo `top_sellers` array).
- `meli_categories` con 11 docs.
- `meli_map_alerts` con 4 docs (uno de PESCAPLAY con `diferencia_pct: -5.5`).

---

## Etapa E4 · Chunk meli.js + tests unit

### Task E4.1: Escribir tests unitarios de funciones puras (TDD)

**Files:**
- Create: `tests/unit/meli-dom.test.js`

- [ ] **Step 1: Escribir el archivo de tests**

Crear `tests/unit/meli-dom.test.js`:
```javascript
/**
 * Tests unit de funciones puras del modulo meli (src/domains/meli.js).
 * Ver docs/specs/2026-09-18-mercadolibre-crm-section-design.md § 6.2.
 */
import { describe, expect, it } from 'vitest';
import {
  filterProducts,
  formatSnapshotAge,
  getSeverityColor,
  sortMapAlerts,
} from '../../src/domains/meli.js';

describe('formatSnapshotAge', () => {
  const nowRef = new Date('2026-09-18T14:00:00Z');

  it('devuelve "hoy HH:mm" si el sync fue hoy', () => {
    const syncAt = new Date('2026-09-18T09:20:00Z');
    expect(formatSnapshotAge(syncAt, nowRef)).toMatch(/^hoy \d{2}:\d{2}$/);
  });

  it('devuelve "hace 1 día" si fue ayer', () => {
    const syncAt = new Date('2026-09-17T09:20:00Z');
    expect(formatSnapshotAge(syncAt, nowRef)).toBe('hace 1 día');
  });

  it('devuelve "hace N días" si fue hace más de 1 día', () => {
    const syncAt = new Date('2026-09-15T09:20:00Z');
    expect(formatSnapshotAge(syncAt, nowRef)).toBe('hace 3 días');
  });

  it('devuelve "hace más de 7 días" si fue hace 8+ días', () => {
    const syncAt = new Date('2026-09-05T09:20:00Z');
    expect(formatSnapshotAge(syncAt, nowRef)).toBe('hace más de 7 días');
  });

  it('devuelve "—" si el date es null o inválido', () => {
    expect(formatSnapshotAge(null, nowRef)).toBe('—');
    expect(formatSnapshotAge(undefined, nowRef)).toBe('—');
  });
});

describe('sortMapAlerts', () => {
  const alerts = [
    { seller_nickname: 'A', diferencia_pct: -3.2 },
    { seller_nickname: 'B', diferencia_pct: -10.5 },
    { seller_nickname: 'C', diferencia_pct: -0.9 },
    { seller_nickname: 'D', diferencia_pct: -5.5 },
  ];

  it('ordena por diferencia_pct ascendente (peor primero)', () => {
    const out = sortMapAlerts(alerts);
    expect(out.map(a => a.seller_nickname)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('no muta el array original', () => {
    const original = [...alerts];
    sortMapAlerts(alerts);
    expect(alerts).toEqual(original);
  });

  it('devuelve [] si input es [] o null', () => {
    expect(sortMapAlerts([])).toEqual([]);
    expect(sortMapAlerts(null)).toEqual([]);
  });
});

describe('filterProducts', () => {
  const products = [
    { catalog_product_id: '1', name: 'Reel Miravel C5000XG', category_name: 'Reeles' },
    { catalog_product_id: '2', name: 'Caña Stimula 7', category_name: 'Cañas' },
    { catalog_product_id: '3', name: 'Reel Sedona 1000', category_name: 'Reeles' },
  ];

  it('sin filtros devuelve todos', () => {
    expect(filterProducts(products, {}).length).toBe(3);
  });

  it('filtra por categoría', () => {
    const out = filterProducts(products, { category: 'Reeles' });
    expect(out.length).toBe(2);
    expect(out.map(p => p.catalog_product_id)).toEqual(['1', '3']);
  });

  it('filtra por search case-insensitive', () => {
    expect(filterProducts(products, { search: 'stimula' }).length).toBe(1);
    expect(filterProducts(products, { search: 'REEL' }).length).toBe(2);
  });

  it('combina categoría + search', () => {
    const out = filterProducts(products, { category: 'Reeles', search: 'sedona' });
    expect(out.length).toBe(1);
    expect(out[0].catalog_product_id).toBe('3');
  });

  it('devuelve [] si nada matchea', () => {
    expect(filterProducts(products, { search: 'xxxxx' })).toEqual([]);
  });
});

describe('getSeverityColor', () => {
  it('rojo si Δ ≤ -10%', () => {
    expect(getSeverityColor(-10)).toBe('red');
    expect(getSeverityColor(-15)).toBe('red');
    expect(getSeverityColor(-64)).toBe('red');
  });
  it('ámbar si -10 < Δ ≤ -2', () => {
    expect(getSeverityColor(-9.9)).toBe('amber');
    expect(getSeverityColor(-5.5)).toBe('amber');
    expect(getSeverityColor(-2)).toBe('amber');
  });
  it('gris si Δ > -2', () => {
    expect(getSeverityColor(-1.9)).toBe('gray');
    expect(getSeverityColor(-0.9)).toBe('gray');
    expect(getSeverityColor(0)).toBe('gray');
  });
});
```

- [ ] **Step 2: Correr tests para verificar que FALLAN (módulo aún no existe)**

Run:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
npm test tests/unit/meli-dom.test.js
```
Expected: FAIL con `Cannot find module '../../src/domains/meli.js'`.

### Task E4.2: Crear src/domains/meli.js con funciones puras + esqueleto UI

**Files:**
- Create: `src/domains/meli.js`

- [ ] **Step 1: Crear archivo con las 4 funciones puras + skeleton API**

Crear `src/domains/meli.js`. Estructura del archivo (funciones puras primero, luego API pública, luego renderers stub):
```javascript
// @ts-nocheck
// MERCADOLIBRE (v>=997, 2026-09-18). Seccion Mariano-only.
// Ver docs/specs/2026-09-18-mercadolibre-crm-section-design.md.
// Globals leidos: fbDb, firebase, currentUser, escapeHtml (declarados en inline).

// ============================================================
// Funciones puras (testables sin DOM)
// ============================================================

export function formatSnapshotAge(date, nowRef = new Date()) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';
  const diffMs = nowRef.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `hoy ${hh}:${mm}`;
  }
  if (diffDays === 1) return 'hace 1 día';
  if (diffDays <= 7) return `hace ${diffDays} días`;
  return 'hace más de 7 días';
}

export function sortMapAlerts(alerts) {
  if (!Array.isArray(alerts)) return [];
  return [...alerts].sort((a, b) => a.diferencia_pct - b.diferencia_pct);
}

export function filterProducts(products, { category, search } = {}) {
  if (!Array.isArray(products)) return [];
  const s = (search || '').trim().toLowerCase();
  return products.filter(p => {
    if (category && p.category_name !== category) return false;
    if (s && !(p.name || '').toLowerCase().includes(s)) return false;
    return true;
  });
}

export function getSeverityColor(pct) {
  if (pct <= -10) return 'red';
  if (pct <= -2) return 'amber';
  return 'gray';
}

// ============================================================
// State interno (local al IIFE del chunk, NO cross-scope)
// ============================================================

let _meliCache = null;   // { state, products, categories, alerts }
let _currentSubtab = 'map';

// ============================================================
// API publica (window.*)
// ============================================================

async function openMeliModal() {
  const overlay = document.getElementById('meli-modal');
  if (!overlay) { console.error('[meli] #meli-modal no existe'); return; }
  overlay.style.display = 'flex';
  if (!_meliCache) await loadMeliData();
  renderMeliModal();
}

function closeMeliModal() {
  const overlay = document.getElementById('meli-modal');
  if (overlay) overlay.style.display = 'none';
}

function setMeliSubtab(name) {
  if (!['map', 'products', 'categories'].includes(name)) return;
  _currentSubtab = name;
  renderMeliModal();
}

async function loadMeliData(force = false) {
  if (_meliCache && !force) return _meliCache;
  const db = window.fbDb;
  const [stateSnap, prodSnap, catSnap, alertSnap] = await Promise.all([
    db.collection('meli').doc('state').get(),
    db.collection('meli_products').get(),
    db.collection('meli_categories').get(),
    db.collection('meli_map_alerts').get(),
  ]);
  _meliCache = {
    state: stateSnap.exists ? stateSnap.data() : null,
    products: prodSnap.docs.map(d => d.data()),
    categories: catSnap.docs.map(d => d.data()),
    alerts: alertSnap.docs.map(d => d.data()),
  };
  return _meliCache;
}

function renderMeliModal() {
  const body = document.getElementById('meli-modal-body');
  const header = document.getElementById('meli-modal-header');
  const tabs = document.getElementById('meli-subtabs');
  if (!body || !header || !tabs) return;
  if (!_meliCache) {
    body.textContent = 'Cargando...';
    return;
  }
  _paintHeader(header, _meliCache.state);
  _paintSubtabs(tabs, _meliCache, _currentSubtab);
  if (_currentSubtab === 'map') _paintMapSection(body, _meliCache.alerts);
  else if (_currentSubtab === 'products') _paintProductsSection(body, _meliCache.products);
  else if (_currentSubtab === 'categories') _paintCategoriesSection(body, _meliCache.categories);
}

// Renderers (stubs -- implementación completa en Task E4.3)
function _paintHeader(el, state) {
  el.textContent = state ? `🛒 MERCADOLIBRE · snapshot ${state.snapshot_date}` : '🛒 MERCADOLIBRE · sin data';
}
function _paintSubtabs(el, cache, active) {
  el.textContent = `[${active}] MAP:${cache.alerts.length} · Prods:${cache.products.length} · Cats:${cache.categories.length}`;
}
function _paintMapSection(el, alerts) {
  el.textContent = `MAP alerts: ${alerts.length} (impl completa en Task E4.3)`;
}
function _paintProductsSection(el, products) {
  el.textContent = `Products: ${products.length} (impl completa en Task E4.3)`;
}
function _paintCategoriesSection(el, categories) {
  el.textContent = `Categories: ${categories.length} (impl completa en Task E4.3)`;
}

// Exports a window (build.js registra stubs proxy en el shell)
if (typeof window !== 'undefined') {
  window.openMeliModal = openMeliModal;
  window.closeMeliModal = closeMeliModal;
  window.setMeliSubtab = setMeliSubtab;
}
```

- [ ] **Step 2: Correr tests unit para verificar que PASAN**

Run:
```powershell
npm test tests/unit/meli-dom.test.js
```
Expected: los 15+ casos PASS.

- [ ] **Step 3: Commit**

```powershell
git add src/domains/meli.js tests/unit/meli-dom.test.js
git commit -m "feat(meli): src/domains/meli.js con funciones puras + esqueleto"
```

### Task E4.3: Implementar renderers completos de las 3 sub-tabs

**Files:**
- Modify: `src/domains/meli.js`

Los renderers construyen HTML strings (mismo patrón que `src/domains/rendiciones.js`, `panel-control.js`, etc.), escapando todo string user-supplied con `window.escapeHtml()`. Asignan el resultado al `.innerHTML` del container correspondiente.

Detalles visuales exactos están en la spec `docs/specs/2026-09-18-mercadolibre-crm-section-design.md § 6.4-6.6` con el mockup renderizado del sub-tab MAP como referencia.

- [ ] **Step 1: Reemplazar `_paintHeader` con implementación completa**

Requerimientos del header (spec § 6.7):
- Fondo oscuro (`linear-gradient(90deg, #0f172a, #1e293b)` con `color: #fff`).
- Título "🛒 MERCADOLIBRE" + subtítulo con `snapshot_date` (escapado con `window.escapeHtml`) + `formatSnapshotAge(last_sync)`.
- Botón "✕" a la derecha que llama `closeMeliModal()`.
- Freshness banner ámbar/rojo según edad del snapshot (ver spec § 6.7 tabla).

Asignar el HTML resultante al `el.innerHTML`. Patrón: construir string con template literals, escapar todo user-supplied con `window.escapeHtml()`.

- [ ] **Step 2: Reemplazar `_paintSubtabs` con implementación completa**

Requerimientos:
- Fondo `#f9f9f9` con border-bottom.
- 3 pills con `onclick="setMeliSubtab('...')"`: activa con `background: #FFE600` + `font-weight: 700`, inactivas con `background: #e5e7eb`.
- Cada pill muestra icono + label + count entre `<b>`.

Ejemplo del span pattern:
```
`<span onclick="setMeliSubtab('map')" style="cursor:pointer;padding:6px 12px;background:${activeBg};color:${activeColor};border-radius:6px;font-weight:${weight};font-size:11px">🎯 MAP <b>${cache.alerts.length}</b></span>`
```

- [ ] **Step 3: Reemplazar `_paintMapSection` con implementación completa**

Componentes:
1. 3 KPI cards (grid 3 cols): "Violaciones" (color según N), "Descuento promedio %", "Sellers involucrados".
2. Input filter con `oninput="window.__meliFilterMapAlerts(this.value)"`.
3. Tabla con header (grid: Seller · SKU · Producto · Pub · Sugerido · Δ% · Link) + filas.
4. Cada fila con `data-seller="${escapeHtml(alert.seller_nickname.toLowerCase())}"` (para el filtro client-side).
5. Fondo por severidad: `getSeverityColor(pct)` devuelve `red`/`amber`/`gray` → mapear a `#fef2f2`/`#fffbeb`/`transparent`.
6. Ordenar con `sortMapAlerts(alerts)` antes de renderizar.
7. Precio formateado con `.toLocaleString('es-AR')`.
8. Link `<a href="${escapeHtml(alert.ml_url)}" target="_blank" rel="noopener">🔗</a>`.

Además, agregar al window:
```javascript
if (typeof window !== 'undefined') {
  window.__meliFilterMapAlerts = function (query) {
    const q = (query || '').trim().toLowerCase();
    document.querySelectorAll('.meli-alert-row').forEach(row => {
      const seller = row.dataset.seller || '';
      row.style.display = !q || seller.includes(q) ? '' : 'none';
    });
  };
}
```

Asignar `el.innerHTML = <string construido>`.

- [ ] **Step 4: Reemplazar `_paintProductsSection` con implementación completa**

Componentes:
1. 3 KPI cards: "Productos Shimano", "Precio promedio" (round(sum/n)), "Visitas 7d totales".
2. 2 filtros: input search (`id="meli-prod-search"`) + select categoría (`id="meli-prod-cat"`) con opción "Todas".
3. Container vacío `<div id="meli-prod-table"></div>` que se puebla vía `_paintProductsTable()`.
4. Ambos filtros con `onchange`/`oninput` = `"window.__meliReRenderProducts()"`.

Función auxiliar `_paintProductsTable()`:
- Leer valores actuales de `#meli-prod-search` y `#meli-prod-cat`.
- Filtrar con `filterProducts(cache.products, {search, category})`.
- Ordenar por `visits_7d_sum` descendente.
- Renderizar tabla (grid: Producto · Categoría · Min · Avg · Sellers · Visitas · Top seller).
- Empty state: "Sin resultados" si `filtered.length === 0`.
- Registrar `window.__meliReRenderProducts = _paintProductsTable`.

En `renderMeliModal()`, después de llamar `_paintProductsSection`, agregar:
```javascript
if (_currentSubtab === 'products') setTimeout(_paintProductsTable, 0);
```

- [ ] **Step 5: Reemplazar `_paintCategoriesSection` con implementación completa**

Componentes:
1. Ordenar por `n_listings` desc.
2. Tabla (grid: Categoría · Listings · Prods · % Shimano bar · Precio min · Precio avg · Sellers).
3. Columna `% Shimano` con barra de progreso:
   - Contenedor `background: #e5e7eb, height: 8px, border-radius: 4px`.
   - Barra inner con `width: ${pct}%` y color según threshold: verde `#16a34a` si `pct > 80`, ámbar `#f59e0b` si `50 <= pct <= 80`, rojo `#dc2626` si `pct < 50`.
   - Texto `${pct.toFixed(1)}%` al costado, color matcheado a la barra.

Asignar al `el.innerHTML`.

- [ ] **Step 6: Correr tests unit (deben seguir pasando)**

Run:
```powershell
npm test tests/unit/meli-dom.test.js
```
Expected: los 15+ casos PASS. Los renderers no rompen las funciones puras.

- [ ] **Step 7: Commit**

```powershell
git add src/domains/meli.js
git commit -m "feat(meli): renderers completos para las 3 sub-tabs"
```

### Task E4.4: Registrar chunk lazy en build.js + main.js + sw.js

**Files:**
- Modify: `build.js`
- Modify: `src/main.js`
- Modify: `sw.js`

- [ ] **Step 1: Agregar 'meli' al `LAZY_CHUNKS` de build.js**

Editar `build.js` — en el objeto `LAZY_CHUNKS` (aprox línea 40) agregar nueva entrada al final:
```javascript
  'meli': [
    'openMeliModal',
    'closeMeliModal',
    'setMeliSubtab',
  ],
```

- [ ] **Step 2: Agregar `installChunkStubs('meli', ...)` en main.js**

Buscar en `src/main.js` las llamadas existentes a `installChunkStubs(...)`. Agregar después de la última:
```javascript
installChunkStubs('meli', ['openMeliModal', 'closeMeliModal', 'setMeliSubtab']);
```

- [ ] **Step 3: Agregar `./chunks/meli.js` a STATIC_ASSETS de sw.js**

Editar `sw.js` — en el array `STATIC_ASSETS` (aprox línea 24), agregar después de `'./chunks/admin-users.js'`:
```javascript
  './chunks/meli.js',
```

- [ ] **Step 4: Correr build**

Run:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
npm run build
```
Expected: `chunks/meli.js` generado. Verificar con `ls chunks/meli.js`.

- [ ] **Step 5: Correr smoke test de bundle**

Run:
```powershell
npm test tests/smoke/bundle-runtime.test.js
```
Expected: PASS. Si falla con `ReferenceError` en `meli.js`, revisar que ninguna función top-level llame a globals del inline durante init (regla #15 CLAUDE.md — usar lazy init).

- [ ] **Step 6: Correr suite completa de tests**

Run:
```powershell
npm test
```
Expected: TODOS los tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add build.js src/main.js sw.js app.bundle.js chunks/meli.js
git commit -m "build: registrar chunk lazy meli en build.js + main.js + sw.js"
```

---

## Etapa E5 · Modal en index.html + botón Panel de Control

### Task E5.1: Agregar HTML del modal MERCADOLIBRE en index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Localizar el modal Panel de Control existente**

Run:
```powershell
grep -n "id=\"panel-control-modal\"" "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\index.html"
```
Expected: línea ~3159.

- [ ] **Step 2: Insertar el modal nuevo debajo del Panel de Control**

Editar `index.html` — después del cierre del `<div class="modal-overlay" id="panel-control-modal" ...>...</div>` (aprox línea 3175), insertar bloque HTML del modal MERCADOLIBRE. Estructura:
- `<div class="modal-overlay" id="meli-modal" onclick="if(event.target===this)closeMeliModal()" style="z-index:1200;display:none;align-items:flex-start;justify-content:center;padding:24px">`
- Dentro: `<div class="modal-content">` con 3 contenedores hijos vacíos con IDs `meli-modal-header`, `meli-subtabs`, `meli-modal-body`.
- `meli-modal-body` con `style="flex:1;overflow:auto;background:var(--bg-secondary)"`.

El contenido de los 3 contenedores lo puebla `meli.js` en runtime.

- [ ] **Step 3: Verificar que el HTML es válido y no rompe grep**

Run:
```powershell
grep -n "meli-modal" "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\index.html"
```
Expected: 4 matches (3 IDs internos + onclick del overlay).

### Task E5.2: Agregar botón "Mercado Libre" en Panel de Control

**Files:**
- Modify: `src/domains/panel-control.js`

- [ ] **Step 1: Localizar el render principal del Panel de Control**

Run:
```powershell
grep -n "renderPanelControl\|function render\|panel-control-body" "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\panel-control.js" | head -8
```
Expected: función que asigna al `#panel-control-body`.

- [ ] **Step 2: Verificar si ya existe helper `_isMarianoEmail()`**

Run:
```powershell
grep -n "isMariano\|erbinomariano\|mariano.erbino" "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\src\domains\panel-control.js"
```

Si existe: reusar. Si no existe: agregar cerca del top del archivo:
```javascript
function _isMarianoEmail() {
  const email = (window.currentUser && window.currentUser.email || '').toLowerCase();
  return email === 'erbinomariano@gmail.com' || email === 'mariano.erbino@shimano.com.ar';
}
```

- [ ] **Step 3: Agregar botón "🛒 Mercado Libre" al final del render del Panel de Control**

En la función que construye el HTML del panel body, antes del cierre del último container, agregar bloque condicional gated por `_isMarianoEmail()`:
- Título: "Herramientas Mariano-only" (label pequeño, uppercase).
- Botón amarillo `#FFE600` con texto "🛒 Mercado Libre".
- `onclick="closePanelControl();openMeliModal();"` — cierra Panel de Control y abre modal MERCADOLIBRE (encadenado).
- Subtexto pequeño: "Datos sincronizados diariamente desde mercado-intelligence".

Patrón (mismo estilo que las otras cards de panel-control):
```javascript
if (_isMarianoEmail()) {
  html += '<div style="margin-top:24px;padding:16px;background:var(--bg-secondary);border-radius:8px">' +
    '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Herramientas Mariano-only</div>' +
    '<button onclick="closePanelControl();openMeliModal();" style="padding:10px 18px;background:#FFE600;color:#0f172a;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px">🛒 Mercado Libre</button>' +
    '<div style="font-size:10px;color:var(--text-muted);margin-top:6px">Datos sincronizados diariamente desde mercado-intelligence</div>' +
    '</div>';
}
```

Nota: el nombre de la variable local puede diferir (podría ser `body`, `content`, etc.). Usar el nombre del render function del archivo.

- [ ] **Step 4: Rebuild + verificar en dev local**

Run:
```powershell
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
npm run build
python -m http.server 8000
```

En browser (otra terminal libre):
- Abrir http://localhost:8000
- Login con `erbinomariano@gmail.com`
- Click "Panel de Control" del header
- Verificar botón "🛒 Mercado Libre" visible al final del modal
- Click → modal MERCADOLIBRE abre con las 3 sub-tabs y data real (231/11/4)
- Click sub-tab "📦 Productos" → tabla poblada
- Click sub-tab "📊 Categorías" → tabla con barras % Shimano
- Filtro por seller en tab MAP → filas se ocultan sin re-render completo
- Click "🔗" → publicación MELI abre en tab nueva
- Click ✕ → modal cierra

- [ ] **Step 5: Verificar acceso denegado para no-Mariano**

- Logout + login con `bot.shimano.pesca@gmail.com` (admin no-Mariano)
- Click "Panel de Control" → bloque "Herramientas Mariano-only" NO aparece
- Abrir DevTools console → ejecutar `window.openMeliModal()`:
  - Si por error se abre, `loadMeliData()` falla con `permission-denied` (rules bloquean)
  - Modal queda en estado "Cargando..." — comportamiento aceptable (rules son la defensa real)

- [ ] **Step 6: Bumpear APP_VERSION en index.html + CACHE_VERSION en sw.js**

Editar `index.html` — buscar el string de la versión actual (ej. `v995` o `v996`) en la tabla del header + en la variable `APP_VERSION`. Reemplazar por la siguiente disponible (asumamos `v997`).

Editar `sw.js` línea ~20: `const CACHE_VERSION = 'v997';`

- [ ] **Step 7: Actualizar README.md con nueva sección**

Editar `README.md`:
- Agregar al índice: `50. [MERCADOLIBRE (Mariano-only)](#50-mercadolibre-mariano-only)`.
- Al final del archivo, agregar sección nueva con:
  - Descripción: "Sección visible solo para Mariano..."
  - Entry point: "Panel de Control → botón 🛒 Mercado Libre"
  - Fuente de datos: 4 colecciones + link a repo mercado-intelligence
  - Rules: mención de `isMariano()` + `allow write: if false`
  - Sin `onSnapshot`: nota que data cambia diario, `.get()` one-shot

- [ ] **Step 8: Commit todo el bloque UI + version bump**

```powershell
git add index.html sw.js src/domains/panel-control.js README.md
git commit -m "v997: modal MERCADOLIBRE en Panel de Control (Mariano-only)"
```

### Task E5.3: PR + merge a main + deploy

**Files:** ninguno (deploy).

- [ ] **Step 1: Push dev + crear PR**

```powershell
git push origin dev
gh pr create --base main --head dev --title "v997: MERCADOLIBRE section en Panel de Control (Mariano-only)" --body "Integra data de mercado-intelligence al CRM en 3 sub-tabs. Ver docs/specs/ + docs/plans/."
```

- [ ] **Step 2: Merge squash + delete branch**

```powershell
gh pr merge --squash --delete-branch
```

- [ ] **Step 3: Actualizar main local + recrear dev**

```powershell
git checkout main
git pull origin main
git branch -D dev
git checkout -b dev
git push -u origin dev
```

- [ ] **Step 4: Verificar deploy en GitHub Pages**

GitHub Pages auto-deploya al pushear a `main`. Esperar 1-2 min. Abrir https://shimano-arg.github.io/app-vendedores/ y verificar el header muestra `v997` en "Versión actual".

- [ ] **Step 5: Verificación end-to-end en prod**

- Login como Mariano en https://shimano-arg.github.io/app-vendedores/
- Panel de Control → botón "🛒 Mercado Libre" visible → modal abre
- Las 4 alerts reales del último snapshot aparecen en sub-tab MAP
- Sub-tab Productos y Categorías cargan con data
- Logout + login como otra cuenta → botón invisible

---

## Etapa E6 · Cron activo + monitoreo

### Task E6.1: Crear workflow sync-to-app.yml + activar cron

**Files:**
- Create: `.github/workflows/sync-to-app.yml` (en repo mercado-intelligence)

- [ ] **Step 1: Crear branch**

Run:
```powershell
cd C:\Users\shimano.sandbox\Desktop\MERCADOLIBRE\mercado-intelligence
git checkout main
git pull origin main
git checkout -b feat/sync-workflow
```

- [ ] **Step 2: Escribir workflow**

Crear `.github/workflows/sync-to-app.yml`:
```yaml
name: Sync to app-vendedores

on:
  schedule:
    - cron: '20 12 * * *'  # 12:20 UTC = 9:20 ARG, 20 min despues del map-daily
  workflow_dispatch:

concurrency:
  group: sync-to-app
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip

      - name: Install package (con extras gcp)
        run: pip install -e ".[gcp]"

      - name: Materialize SA keys
        env:
          GCP_SA_KEY_JSON: ${{ secrets.GCP_SA_KEY_JSON }}
          APP_VENDEDORES_SA_KEY: ${{ secrets.APP_VENDEDORES_SA_KEY }}
        run: |
          mkdir -p .secrets
          echo "$GCP_SA_KEY_JSON" > .secrets/gcp_sa_key.json
          echo "$APP_VENDEDORES_SA_KEY" > .secrets/app_vendedores_sa.json

      - name: Run sync
        env:
          MI_ML_CLIENT_ID: ${{ secrets.ML_CLIENT_ID }}
          MI_ML_CLIENT_SECRET: ${{ secrets.ML_CLIENT_SECRET }}
          MI_ML_REDIRECT_URI: ${{ secrets.ML_REDIRECT_URI }}
          MI_GCP_PROJECT: ${{ secrets.MI_GCP_PROJECT }}
        run: python scripts/sync_to_app.py 2>&1 | tee sync.log

      - name: Report to step summary
        if: always()
        run: |
          echo "## Sync to app-vendedores" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "\`\`\`" >> $GITHUB_STEP_SUMMARY
          tail -20 sync.log >> $GITHUB_STEP_SUMMARY || echo "no log"
          echo "\`\`\`" >> $GITHUB_STEP_SUMMARY
```

- [ ] **Step 3: Commit + push branch**

```powershell
git add .github/workflows/sync-to-app.yml
git commit -m "feat(gha): sync-to-app.yml cron diario 9:20 ARG"
git push -u origin feat/sync-workflow
```

- [ ] **Step 4: Trigger manual del workflow desde GitHub UI**

Abrir https://github.com/botshimanopesca-beep/mercado-intelligence/actions/workflows/sync-to-app.yml → click "Run workflow" → seleccionar branch `feat/sync-workflow` → Run.

Esperar 2-3 min.

Expected: run verde. En Firestore Console de app-vendedores: `meli/state.sync_run_id` cambió a un GitHub run ID + `last_sync` avanzado.

- [ ] **Step 5: Merge PR + activar cron en main**

```powershell
gh pr create --title "feat: workflow sync-to-app.yml diario" --body "Cron 9:20 ARG activado. Trigger manual validado en E6.1 step 4."
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```

- [ ] **Step 6: Verificar 2 corridas automáticas consecutivas**

Esperar 2 días. Verificar en:
- https://github.com/botshimanopesca-beep/mercado-intelligence/actions/workflows/sync-to-app.yml → últimos runs OK
- Firestore Console → `meli/state.last_sync` avanza automáticamente cada día

### Task E6.2: Actualizar README de mercado-intelligence

**Files:**
- Modify: `README.md` (en repo mercado-intelligence)

- [ ] **Step 1: Agregar sync-to-app.yml a la sección Operación automática**

Editar `README.md` — buscar sección `## ⏰ Operación automática`. Después del bloque "Cada día 9:00 ARG (12:00 UTC) — MAP Monitor separado", insertar:

```markdown
### Cada día 9:20 ARG (12:20 UTC) — Sync a app-vendedores CRM

Workflow `.github/workflows/sync-to-app.yml` corre `python scripts/sync_to_app.py`
(~30-60 seg): lee snapshot MI de Firestore + detecta MAP alerts vía
`mi.map_monitor.detect_violations()` + escribe 4 colecciones en el
Firestore del proyecto `app-vendedores-shimano` con la SA
`mi-sync-writer` (Cloud Datastore User only).

**Colecciones escritas**: `meli/state`, `meli_products`, `meli_categories`,
`meli_map_alerts`. La app-vendedores lee estas colecciones para mostrar
la sección MERCADOLIBRE (Mariano-only).

**Setup GH Secrets adicional**: `APP_VENDEDORES_SA_KEY` (JSON de la SA
mi-sync-writer, descargable desde GCP Console del proyecto
app-vendedores-shimano).
```

- [ ] **Step 2: Actualizar tabla "Backends escritos por corrida"**

En sección `## 📌 Estado régimen`, agregar fila:
```markdown
| **Firestore app-vendedores** (`meli/*`) | Serving CRM Mariano-only | Sobrescrito diario |
```

- [ ] **Step 3: Commit + PR + merge**

```powershell
git checkout -b docs/readme-sync-to-app
git add README.md
git commit -m "docs: README refleja sync-to-app.yml + backend app-vendedores"
git push -u origin docs/readme-sync-to-app
gh pr create --title "docs: sync-to-app.yml en README" --body "Documenta workflow + backend nuevo."
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```

---

## Success Criteria (feature done)

- [ ] Los 5+ tests nuevos (unit `meli-dom` + rules `meli`) pasan en CI.
- [ ] Smoke test de bundle verde con chunk meli.js incluido.
- [ ] 2 corridas consecutivas del cron `sync-to-app.yml` OK, con `meli/state.sync_status='ok'`.
- [ ] Al abrir el modal con cuenta Mariano en prod se ven las 4 sub-secciones cargadas.
- [ ] Cuenta no-Mariano: botón invisible + rules bloquean lecturas (`permission-denied` en DevTools).
- [ ] README de app-vendedores actualizado con nueva §50.
- [ ] README de mercado-intelligence actualizado con `sync-to-app.yml`.
- [ ] `APP_VERSION` + `CACHE_VERSION` bumpeadas a v997.
