# Plan: Migracion de credenciales SAP Service Layer (`userName` + `companyDB`) a Secret Manager

**Fecha**: 2026-10-07
**Autor**: Security Engineer agent
**Branch**: `dev` (plan-only, sin codigo)
**Audit origen**: multi-agent 2026-10-07 — finding `Security M-01` (MEDIUM)
**Precedente**: `SAP_SL_PASSWORD` ya migrada en v690 (Sprint 2). Script Python ya tiene TODO Sprint 3 para `username`.

---

## 1. Scope

### Campos a migrar a Secret Manager

| Firestore path                                             | Nuevo secret               | Razon                                                                 |
|------------------------------------------------------------|----------------------------|-----------------------------------------------------------------------|
| `app_config/sap_integration.serviceLayer.username`         | `SAP_SL_USERNAME`          | Credencial de login SL (identidad). Visible en DevTools hoy.          |
| `app_config/sap_integration.serviceLayer.userName` (alias) | `SAP_SL_USERNAME`          | Alias legacy camelCase, mismo secret (ver CLAUDE.md §24).             |
| `app_config/sap_integration.serviceLayer.companyDB`        | `SAP_SL_COMPANY_DB`        | Identifica la DB SAP; filtracion facilita reconocimiento del tenant. |

### Campos que NO se migran (quedan en Firestore)

- `serviceLayer.url` — host publico SL (NO es secreto; ademas ya existe allowlist `SAP_SL_ALLOWED_HOSTS` en `functions/core/sap-proxy-core.js:288`). Rotar via Panel admin sigue siendo util para failover.
- `serviceLayer.enabled` — flag UX/operativo (toggle on/off desde Panel admin).
- `appSeriesId` — numero de DocSeries APP (103 PROD / 104 TEST), publico por diseno (ver CLAUDE.md §24 nota).
- Resto de flags no sensibles (`autoSendOnConfirm`, timeouts, cursores de sync, etc).

### Fuera de scope

- Rotacion de la password en si (ya es secret manejado; aqui solo tocamos `SAP_SL_USERNAME` + `SAP_SL_COMPANY_DB`).
- Migracion a Workload Identity Federation para GH Actions (futuro, no bloquea este plan).

---

## 2. Vectores de ataque mitigados

| Vector                                                                                                                              | Impacto hoy | Post-migracion |
|-------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| Rogue admin lee `app_config/sap_integration` via Firestore Console / DevTools → extrae `userName` + `companyDB` → brute-force password offline o phishing SAP help-desk | ALTO        | Mitigado       |
| Cold backup Firestore (dailyFirestoreBackup CF, bucket `gs://<project>-backups`) con permisos amplios → leak retroactivo de user+DB  | MEDIO       | Mitigado       |
| XSS persistente en index.html → leer Firestore client-side con credenciales de un admin autenticado                                 | MEDIO       | Mitigado       |
| Export completo de Firestore via `gcloud firestore export` por SA comprometida → user+DB en archivo plain                             | MEDIO       | Mitigado       |
| Service account con `datastore.user` o `firestore.viewer` global (ej: CI/CD mal scoped) → lectura directa                            | MEDIO       | Mitigado       |
| Error log en Sentry que incluye el config completo (dump accidental de `sl` object) → user+DB en Sentry tenant                       | BAJO        | Mitigado       |
| Compromise de credenciales de un gerente (phishing) con acceso Firestore Console → extrae user+DB                                   | MEDIO       | Mitigado       |

### Riesgos NO mitigados por este plan (asumidos)

- Rogue admin con `roles/secretmanager.secretAccessor` en el proyecto GCP: puede leer el secret igual. Mitigacion: minimizar quien tiene ese rol + audit logs via Cloud Audit Logs.
- Compromise del runtime de Cloud Functions: los secrets viven en memoria del proceso durante el handler. Es inevitable; no agrava mas que el estado actual con `SAP_SL_PASSWORD`.
- Compromise del repo GitHub + GH Actions secrets: equivalente al estado actual con `SAP_SL_PASSWORD`.

---

## 3. Inventario de consumidores actuales

Grep real ejecutado:
```
grep -rn "sap_integration" --include="*.js" --include="*.py" --include="*.yml"
```

### 3.1 Cloud Functions (functions/)

**`functions/index.js`** — 11 lecturas de `app_config/sap_integration`:

| Linea | CF / Handler                       | Trigger          | Usa username | Usa companyDB |
|-------|------------------------------------|------------------|--------------|---------------|
| 158   | `sapProxy` (onCall)                | HTTPS            | SI           | SI            |
| 219   | `syncSapInvoicesToApp`             | Schedule 15 min  | SI           | SI            |
| 285   | `syncSapOrdersToApp`               | Schedule 60 min  | SI           | SI            |
| 336   | `syncSapPaymentsToApp`             | Schedule 15 min  | SI           | SI            |
| 393   | `syncSapDocTotalsToApp`            | Schedule 15 min  | SI           | SI            |
| 443   | `syncSapQuotationClosuresToApp`    | Schedule 15 min  | SI           | SI            |
| 669   | `onPedidoConfirmedSendToSap`       | Firestore trigger| SI           | SI            |
| 1105  | `checkSapSlHealthCF` (dependen)    | Schedule / onCall| SI           | SI            |
| 1239  | `checkSapSlHealthCF` second read   | ...              | SI           | SI            |
| 2044  | `autoSendPedidosToSapCF` (batch)   | Schedule / onCall| SI           | SI            |

**Pattern actual (todas)**:
```js
const sapCfgSnap = await db.doc('app_config/sap_integration').get();
const sl = sapCfgSnap.data()?.serviceLayer || {};
// luego:
userName: sl.username || sl.userName,
companyDB: sl.companyDB,
password: SAP_SL_PASSWORD.value(),
```

**`functions/core/sap-proxy-core.js`** — recibe `sapConfig` por DI (lineas 266-295). NO lee Firestore directo; recibe `{ url, companyDB, userName, password }` desde el wrapper. **No requiere cambios de logica**, solo la fuente del DI cambia.

**`functions/core/auto-send-sap-core.js`** — mismo pattern DI (linea 65 doc). NO requiere cambio.

### 3.2 Scripts Python (scripts/)

| Archivo                                 | Linea      | Rol                                                   |
|-----------------------------------------|------------|-------------------------------------------------------|
| `scripts/sync_sap_to_firestore.py`      | 172-197    | Sync maestro SAP → Firestore (BPs, items, stock)      |
| `scripts/sync_sap_to_bigquery.py`       | 297-322    | Sync BPs/items a BQ                                   |
| `scripts/sync_invoices_only.py`         | 50         | Backfill de invoices legacy                           |
| `scripts/patch_paid_to_date.py`         | 37         | Patch one-off, retrocompat                            |
| `scripts/debug_sl_direct.py`            | 12         | Script debug ad-hoc                                   |
| `scripts/build_mejoras_shimano.py`      | 1152       | Solo mencion en texto PDF (NO lee creds)              |
| `scripts/build_manual_shimano.py`       | 502,701,1208,1315,1361 | Solo mencion en texto PDF (NO lee creds) |

**Pattern actual (`sync_sap_to_firestore.py:164-197`)**:
```python
snap = db.collection('app_config').document('sap_integration').get()
sl = data.get('serviceLayer') or {}
required_fs = ('url', 'companyDB', 'username')
# ...
password = os.environ.get('SAP_SL_PASSWORD') or sl.get('password') or ''
```

Nota: solo `password` ya viene via env. `username` + `companyDB` siguen leyendo de Firestore.

### 3.3 GitHub Actions workflows

| Workflow                                            | Que hace                                            | Lee sap_integration |
|-----------------------------------------------------|-----------------------------------------------------|---------------------|
| `.github/workflows/sync-sap-catalog-stock.yml`      | Dispara `sync_sap_to_firestore.py` + `scripts/*`    | Via Firestore ADC (en el script Python) |
| `.github/workflows/sync-sap-to-bigquery.yml`        | Dispara `sync_sap_to_bigquery.py`                   | Via Firestore ADC   |

Ambos ya inyectan `SAP_SL_PASSWORD: ${{ secrets.SAP_SL_PASSWORD }}` como env var. Pattern a replicar para los nuevos secrets.

### 3.4 Frontend (lectura client-side)

**`src/domains/sap-service-layer.js:31-60`** — cachea `app_config/sap_integration` localmente para mostrar UI diagnostic (`sapSL.loadConfig()` devuelve `{ enabled, url, companyDB, username }`). Linea 45 documenta explicitamente que `password` nunca se lee client. **Post-migracion**: `companyDB` y `username` TAMPOCO deberian leerse client. El UI diagnostic debera mostrarse como "configurado via Secret Manager" sin exponer valor.

**`src/domains/sap-admin-panel.js:664,670,704-723`** — Panel admin SAP permite editar `username` y `companyDB` desde la UI y hace `db.doc('app_config/sap_integration').update({ 'serviceLayer.companyDB': ..., 'serviceLayer.username': ... })`. **Post-migracion Fase 3**: estos inputs se vuelven readonly con nota "editable solo via Secret Manager".

**`index.html:7418, 29703, 29872`** — listener client-side `sap_integration` (`detachResilientListener('sap_integration')`). Solo lee `url` + `enabled`, no credenciales (post-migracion sigue andando).

### Resumen contador

**14 archivos** tocan `app_config/sap_integration`:
- 2 CF (`functions/index.js`, `functions/core/sap-proxy-core.js` — pero core recibe DI).
- 5 Python (sync_sap_to_firestore, sync_sap_to_bigquery, sync_invoices_only, patch_paid_to_date, debug_sl_direct).
- 2 Python buildPDF (solo texto, NO lecturas de creds — no requieren cambio).
- 2 workflows YAML (solo mencion comentario — pero deben agregar los secrets nuevos).
- 3 frontend (index.html, sap-service-layer.js, sap-admin-panel.js).

**Consumidores reales de credenciales** (que deben cambiar codigo): **7 archivos** (functions/index.js + 4 Python productivos + 2 frontend).

---

## 4. Secrets nuevos propuestos

### 4.1 Secret 1: `SAP_SL_USERNAME`

- **Proyecto GCP**: `app-vendedores-shimano`
- **Nombre exacto**: `SAP_SL_USERNAME` (mayusculas con underscore, convencion existente).
- **Tipo**: `string`, plain text (no JSON).
- **Reemplaza**: `app_config/sap_integration.serviceLayer.username` + alias `userName`.
- **Comando de creacion**:
```
gcloud secrets create SAP_SL_USERNAME \
  --project=app-vendedores-shimano \
  --replication-policy=automatic \
  --labels=env=prod,subsystem=sap-sl,owner=mariano
# Valor inicial (desde el valor hoy en Firestore)
printf 'APP_VENDEDORES' | gcloud secrets versions add SAP_SL_USERNAME \
  --project=app-vendedores-shimano \
  --data-file=-
```
Importante: usar `printf` (no `echo`) para NO agregar trailing newline (precedente feedback 2026-10-02 bot WhatsApp).

### 4.2 Secret 2: `SAP_SL_COMPANY_DB`

- **Proyecto GCP**: `app-vendedores-shimano`
- **Nombre exacto**: `SAP_SL_COMPANY_DB`
- **Tipo**: `string`, plain text.
- **Reemplaza**: `app_config/sap_integration.serviceLayer.companyDB`.
- **Comando de creacion**:
```
gcloud secrets create SAP_SL_COMPANY_DB \
  --project=app-vendedores-shimano \
  --replication-policy=automatic \
  --labels=env=prod,subsystem=sap-sl,owner=mariano
printf 'SHIMANO_SAU' | gcloud secrets versions add SAP_SL_COMPANY_DB \
  --project=app-vendedores-shimano \
  --data-file=-
```

### 4.3 Rotacion recomendada

- **Password SAP SL**: cada 90 dias (ya es la politica actual de `SAP_SL_PASSWORD`).
- **UserName**: rotacion solo cuando cambie el user tecnico en SAP (ej: migracion de user, dado de baja). No es rotable per se.
- **CompanyDB**: solo cambia en migraciones de SAP tenant (muy raro). No es rotable per se.
- **Audit**: todos los secrets con `--labels=owner=mariano` + Cloud Audit Logs enabled para `secretmanager.googleapis.com/Access`.

### 4.4 Verificacion post-creacion

```
gcloud secrets list --project=app-vendedores-shimano --filter="name:SAP_SL_*"
# Deberia mostrar: SAP_SL_PASSWORD, SAP_SL_USERNAME, SAP_SL_COMPANY_DB
# Verificar tamano sin trailing newline:
gcloud secrets versions access latest --secret=SAP_SL_USERNAME \
  --project=app-vendedores-shimano | wc -c
```

---

## 5. Plan de migracion por fases

### Fase 0 — Preparacion (sin impacto en runtime)

**Objetivo**: crear los secrets en GCP con valores actuales de Firestore. NO desplegar codigo.

**Archivos tocados**: ninguno (solo gcloud + GH Actions UI).

**Pasos**:
1. Leer valores actuales de Firestore (manual, Console UI o via `scripts/debug_sl_direct.py`): copiar `serviceLayer.username` y `serviceLayer.companyDB` exactos.
2. Ejecutar los 2 `gcloud secrets create` + `versions add` (comandos de 4.1 y 4.2).
3. Verificar tamano con `wc -c` (sin trailing newline).
4. En GitHub Settings → Secrets and variables → Actions → New repository secret:
   - `SAP_SL_USERNAME` = mismo valor
   - `SAP_SL_COMPANY_DB` = mismo valor
5. Otorgar IAM `roles/secretmanager.secretAccessor` a la service account default de Firebase Functions (`<project>@appspot.gserviceaccount.com` o la custom runtime SA). Deberia ya tenerlo si usa `SAP_SL_PASSWORD`, pero verificar:
```
gcloud secrets get-iam-policy SAP_SL_USERNAME --project=app-vendedores-shimano
```

**Rollback**: eliminar los secrets (`gcloud secrets delete`). Zero impacto porque nada los lee aun.

**Gate**:
- `gcloud secrets versions access latest --secret=SAP_SL_USERNAME` devuelve el valor correcto.
- `gcloud secrets versions access latest --secret=SAP_SL_COMPANY_DB` idem.
- GH Actions Secrets lista `SAP_SL_USERNAME` y `SAP_SL_COMPANY_DB`.

**Duracion**: 30 min.

---

### Fase 1 — Dual-read / Shadow mode (CF + Python leen de ambos, prefer secret)

**Objetivo**: todos los consumidores aceptan el secret como fuente primaria con fallback a Firestore. Nada se rompe si el secret falta (compat con pre-fase).

**Archivos tocados**:

**Cloud Functions**:
- `functions/index.js`:
  - Agregar al bloque de `defineSecret`:
    ```js
    const SAP_SL_USERNAME = defineSecret('SAP_SL_USERNAME');
    const SAP_SL_COMPANY_DB = defineSecret('SAP_SL_COMPANY_DB');
    ```
  - En cada handler que tiene `secrets: [SAP_SL_PASSWORD]`, agregar los 2 nuevos. 10 CFs listadas en seccion 3.1 (lineas 121, 215, 281, 332, 389, 439, 658, 1100, 1232, 2015).
  - En cada construccion de `sapConfig`, cambiar:
    ```js
    // Antes:
    userName: sl.username || sl.userName,
    companyDB: sl.companyDB,
    // Despues (Fase 1 — dual-read):
    userName: (SAP_SL_USERNAME.value() || '').trim() || sl.username || sl.userName,
    companyDB: (SAP_SL_COMPANY_DB.value() || '').trim() || sl.companyDB,
    ```
  - Log en cada CF `console.log('[sapConfig] source userName:', sourceOfUser)` para auditar en Fase 1.

**Scripts Python**:
- `scripts/sync_sap_to_firestore.py:164-197`:
  ```python
  username = os.environ.get('SAP_SL_USERNAME') or sl.get('username') or sl.get('userName') or ''
  company_db = os.environ.get('SAP_SL_COMPANY_DB') or sl.get('companyDB') or ''
  if not username or not company_db:
      log('[SKIP] userName/companyDB no disponibles')
      sys.exit(0)
  log(f'[info] userName source: {"env" if os.environ.get("SAP_SL_USERNAME") else "firestore(legacy)"}')
  log(f'[info] companyDB source: {"env" if os.environ.get("SAP_SL_COMPANY_DB") else "firestore(legacy)"}')
  ```
- `scripts/sync_sap_to_bigquery.py:290-322`: idem.
- `scripts/sync_invoices_only.py:50`: idem.
- `scripts/patch_paid_to_date.py:37`: idem.
- `scripts/debug_sl_direct.py:12`: idem (es ad-hoc, pero mantener alineado).

**GitHub Actions workflows**:
- `.github/workflows/sync-sap-catalog-stock.yml`: en el `env:` del step que corre python, agregar:
  ```yaml
  SAP_SL_USERNAME: ${{ secrets.SAP_SL_USERNAME }}
  SAP_SL_COMPANY_DB: ${{ secrets.SAP_SL_COMPANY_DB }}
  ```
- `.github/workflows/sync-sap-to-bigquery.yml`: idem (linea ~90 donde ya esta `SAP_SL_PASSWORD`).

**Deploy**:
```
firebase deploy --only functions:sapProxy,functions:syncSapInvoicesToApp,functions:syncSapOrdersToApp,functions:syncSapPaymentsToApp,functions:syncSapDocTotalsToApp,functions:syncSapQuotationClosuresToApp,functions:onPedidoConfirmedSendToSap,functions:checkSapSlHealthCF,functions:autoSendPedidosToSapCF
```

**Test plan**:
1. Smoke: enviar un pedido test (cliente dummy) via Panel admin → verificar que `onPedidoConfirmedSendToSap` lo envia a SAP OK. En logs `console.log` buscar `source userName: SECRET` (no `firestore`).
2. Smoke: dejar correr los schedule syncs 15 min. Confirmar en logs que `syncSapInvoicesToApp` processa invoices con `source userName: SECRET`.
3. Smoke scripts Python: trigger manual del workflow `sync-sap-catalog-stock.yml`. Confirmar en el output `[info] userName source: env`.
4. Dejar correr 48h con monitoreo en Logs Explorer:
   ```
   gcloud logging read 'resource.type=cloud_run_revision AND textPayload=~"sapConfig.*source userName"' \
     --project=app-vendedores-shimano --freshness=48h --limit=100
   ```
   Expected: 100% `source userName: SECRET`.

**Rollback (Fase 1)**:
- Revertir el deploy de functions: `firebase deploy --only functions:XXX` desde commit anterior.
- Scripts: `git revert` el PR. Rapido porque fallback a Firestore sigue andando (si el secret falta, cae a Firestore automaticamente).

**Riesgos**:
- Si Fase 0 no popobo bien el secret (ej: trailing newline, user equivocado), el fallback a Firestore salva — pero el log va a decir `firestore(legacy)` y hay que corregir el secret.
- Deploy de 10 CFs simultaneo es grande; mitigar deploy en 2 tandas (primero las schedule, 1h observacion, despues las callable + trigger).

**Duracion**: 2h deploy + 48h observacion = 2.5 dias calendario.

---

### Fase 2 — Secret-only (remover fallback Firestore en consumidores)

**Objetivo**: todos los consumidores leen SOLO del secret. Si el secret falta, falla fuerte (no silencia).

**Archivos tocados**: los mismos que Fase 1.

**Cambio**:
```js
// Fase 2 — secret-only:
const uname = (SAP_SL_USERNAME.value() || '').trim();
const cdb = (SAP_SL_COMPANY_DB.value() || '').trim();
if (!uname || !cdb) {
  throw new HttpsError('failed-precondition',
    'SAP_SL_USERNAME o SAP_SL_COMPANY_DB no configurados en Secret Manager');
}
// ...
userName: uname,
companyDB: cdb,
```

Scripts Python: hacer fallo fuerte sin fallback Firestore. Mantener logs para audit.

**Deploy**: idem Fase 1 (mismos 10 CFs + scripts).

**Test plan**:
1. Smoke pedido test post-deploy. Verificar OK en SAP.
2. Smoke schedule syncs 15 min. Verificar logs sin WARN.
3. Audit test negativo: en un entorno staging (si existe) o con feature flag, borrar temporalmente los secrets → confirmar que la CF falla con el mensaje `failed-precondition` esperado (no un fallback silent).
4. 48h observacion con alerta configurada:
   ```
   gcloud logging metrics create sap_sl_secret_missing \
     --description="Alert cuando CF logea 'SAP_SL_USERNAME no configurado'" \
     --log-filter='textPayload=~"SAP_SL_USERNAME.*no configurados"'
   ```

**Rollback (Fase 2)**:
- Revertir deploy a Fase 1 (binario con dual-read sigue siendo deploy-able). Rapido: 10 min.
- CRITICO: si durante Fase 2 el secret se corrompe por rotacion fallida, los 10 CFs fallan hasta rollback. Mitigacion: NO borrar el campo Firestore aun (eso es Fase 3). Rollback a Fase 1 recupera via fallback automatico.

**Riesgos**:
- Downtime si secret se corrompe durante deploy. Mitigacion: deploy en horario no laboral (viernes 20hs ART). Monitoreo de alerta.
- Scheduled CFs que usan secrets (`secrets: [SAP_SL_USERNAME, SAP_SL_COMPANY_DB, SAP_SL_PASSWORD]`) necesitan que la secret version este `enabled`. Verificar `gcloud secrets versions list` muestra latest enabled.

**Duracion**: 2h deploy + 48h observacion = 2.5 dias.

---

### Fase 3 — Cleanup Firestore (borrar los campos + readonly UI)

**Objetivo**: `app_config/sap_integration.serviceLayer` ya no contiene `username`, `userName` ni `companyDB`. Panel admin UI deja de permitir editar esos campos.

**Archivos tocados**:

- **Firestore manual (one-shot)**: borrar los campos del doc. Script temporal `scripts/one_shot/strip_sap_credentials_from_firestore.py`:
  ```python
  # borra sl.username, sl.userName, sl.companyDB; mantiene url, enabled, appSeriesId
  from google.cloud.firestore import DELETE_FIELD
  db.collection('app_config').document('sap_integration').update({
      'serviceLayer.username': DELETE_FIELD,
      'serviceLayer.userName': DELETE_FIELD,
      'serviceLayer.companyDB': DELETE_FIELD,
  })
  ```
- **Frontend `src/domains/sap-admin-panel.js:664,670,704-723`**:
  - Volver los 2 inputs HTML `<input id="sl-company">` y `<input id="sl-user">` como `readonly` o `disabled`, con placeholder `"editable via Secret Manager (gcloud)"`.
  - Remover del `update()` las lineas `'serviceLayer.companyDB': ...` y `'serviceLayer.username': ...`.
  - Agregar banner info en el panel: "Credenciales SAP (user + DB + password) estan en Secret Manager. Para rotar: `gcloud secrets versions add SAP_SL_USERNAME --data-file=-`".
- **Frontend `src/domains/sap-service-layer.js:55-60`**:
  - `loadConfig()` dejar de incluir `companyDB` y `username` en el objeto que devuelve (ya no estan en Firestore). O devolver `companyDB: '[hidden]'`, `username: '[hidden]'` para que el diagnostic de UI muestre algo util sin leak.
- **Scripts build PDF** (`build_mejoras_shimano.py:1152`, `build_manual_shimano.py:502,701,1208,1315,1361`): actualizar texto que menciona que la password vive en Firestore → ahora dice "en Secret Manager, rotar via gcloud".
- **CLAUDE.md §24**: actualizar la nota "Firestore field `username` (lowercase)" → marcar como DEPRECATED post-Fase-3. Agregar nueva regla: "SAP credenciales viven en Secret Manager, NO leer de `sl.username`".
- **README.md §41 Changelog**: entry nueva "vXXXX: migracion SAP creds a Secret Manager Fase 3 — Firestore limpio".

**Deploy**:
1. Deploy frontend (bundle + chunks + rules si aplica).
2. Correr el script one-shot `scripts/one_shot/strip_sap_credentials_from_firestore.py` POST-deploy frontend (asi el readonly UI ya esta activo cuando los campos se borren).
3. Actualizar workflows YAML: remover comentarios obsoletos que digan "lee de Firestore".

**Test plan**:
1. Smoke pedido test post-deploy frontend. Debe seguir andando (CFs leen de secret, no Firestore).
2. Firestore Console: verificar que `app_config/sap_integration.serviceLayer` solo tiene `url`, `enabled`, `appSeriesId`.
3. Panel admin UI: abrir, verificar que los campos "Usuario" y "CompanyDB" aparecen readonly con placeholder claro.
4. Correr `grep -rn "sl.username\|sl.userName\|sl.companyDB" functions/ scripts/ src/` → deberia solo matchear fallbacks defensivos que ya no se ejercen.

**Rollback (Fase 3)**:
- Restaurar los campos en Firestore desde el daily backup (`gs://app-vendedores-shimano-backups/firestore/<ayer>/`).
- Revertir frontend al readonly=false. Reverts estandar via `gh pr revert`.
- CFs no requieren rollback — siguen leyendo secret.

**Riesgos**:
- Si Fase 2 no estaba 100% completa y algun consumer todavia usa Firestore, Fase 3 lo rompe. Mitigacion: en Fase 2 verificar con el logging metric que CERO logs digan `firestore(legacy)` durante 48h antes de iniciar Fase 3.
- Script PDF builder tiene texto que menciona rotacion via Firestore. Actualizar antes del cliente ejecute el pipeline, o la doc queda incorrecta.

**Duracion**: 1h deploy + 1h cleanup Firestore + 24h validacion = 1.5 dias.

---

### Fase 4 — Verify + audit cleanup

**Objetivo**: confirmar que no queda lectura del campo viejo + cerrar el ticket Security M-01.

**Archivos tocados**: ninguno (solo audit).

**Pasos**:
1. **Logs grep (1 semana)**: query en Logs Explorer para los 10 CFs:
   ```
   resource.type=cloud_run_revision
   resource.labels.service_name=~"sapproxy|syncsap.*|onpedidoconfirmedsendtosap|checksapslhealthcf|autosendpedidostosapcf"
   textPayload=~"serviceLayer.*username|sl.userName|firestore.legacy"
   ```
   Expected: 0 resultados en 7 dias.
2. **Firestore audit log (1 semana)**:
   ```
   gcloud logging read 'protoPayload.serviceName="firestore.googleapis.com" \
     AND protoPayload.resourceName=~"app_config/sap_integration" \
     AND protoPayload.methodName=~"GetDocument|ListDocuments"' \
     --project=app-vendedores-shimano --freshness=7d --limit=1000 \
     --format="value(timestamp,protoPayload.authenticationInfo.principalEmail)"
   ```
   Verificar que los principales son solo SA runtime de las CFs + humanos admin, no roles extranos.
3. **Secret access audit**:
   ```
   gcloud logging read 'protoPayload.serviceName="secretmanager.googleapis.com" \
     AND protoPayload.resourceName=~"SAP_SL_(USERNAME|COMPANY_DB)" \
     AND protoPayload.methodName="AccessSecretVersion"' \
     --project=app-vendedores-shimano --freshness=7d --limit=100
   ```
   Confirmar que accesos son solo de las SAs esperadas.
4. **Documentar**: `docs/AUDIT_SHIMANO_2026-10-07.md` → agregar seccion "Security M-01 CERRADO con migracion Fase 0-4 completa".
5. **CLAUDE.md**: marcar §24 como "aplicable solo pre-Fase-3; post-cleanup los campos no existen".

**Duracion**: 1 semana de observacion + 1h audit final = ~1 semana calendario (en background, no bloqueante).

---

## 6. Impacto en scripts Python

Pattern comun en los 5 scripts productivos (`sync_sap_to_firestore.py`, `sync_sap_to_bigquery.py`, `sync_invoices_only.py`, `patch_paid_to_date.py`, `debug_sl_direct.py`):

### Antes (hoy):
```python
snap = db.collection('app_config').document('sap_integration').get()
sl = snap.to_dict()['serviceLayer']
cfg = {
    'url': sl['url'],
    'companyDB': sl['companyDB'],
    'username': sl['username'],
    'password': os.environ.get('SAP_SL_PASSWORD') or sl.get('password') or '',
}
```

### Despues (Fase 2):
```python
snap = db.collection('app_config').document('sap_integration').get()
sl = snap.to_dict()['serviceLayer']  # solo para url + enabled flag
cfg = {
    'url': sl['url'],
    'companyDB': os.environ['SAP_SL_COMPANY_DB'],  # KeyError si falta — fail-fast
    'username': os.environ['SAP_SL_USERNAME'],
    'password': os.environ['SAP_SL_PASSWORD'],
}
```

Los workflows YAML inyectan los 3 secrets como env:
```yaml
env:
  SAP_SL_PASSWORD: ${{ secrets.SAP_SL_PASSWORD }}
  SAP_SL_USERNAME: ${{ secrets.SAP_SL_USERNAME }}
  SAP_SL_COMPANY_DB: ${{ secrets.SAP_SL_COMPANY_DB }}
```

**Nota developer local**: para correr scripts localmente, el dev debe setear las 3 env vars en su shell (o `.env` local gitignored). Documentar en README script dev.

**`scripts/debug_sl_direct.py`**: es un helper de debug one-off. Mantener pero actualizar para leer env vars + imprimir "secret source: env" en el output.

---

## 7. Impacto en el Panel Admin SAP (UI)

### Hoy (`src/domains/sap-admin-panel.js:664-723`)

- El admin abre Panel admin → tab "Service Layer" → ve inputs editables para URL, CompanyDB, Usuario, Password, Enabled.
- Hace cambios → "Guardar" ejecuta `db.doc('app_config/sap_integration').update({ 'serviceLayer.companyDB': ..., 'serviceLayer.username': ..., ... })`.
- Password ya NO se guarda ahi desde v690 (hay nota en el panel).

### Post-migracion Fase 3

- Inputs "CompanyDB" y "Usuario" quedan `readonly`, grayed-out, con placeholder `"gestionado via Secret Manager"`.
- Mariano (y Pablo) deben rotar via comando:
  ```
  printf 'nuevo_user' | gcloud secrets versions add SAP_SL_USERNAME \
    --project=app-vendedores-shimano --data-file=-
  ```
- Despues: `firebase deploy --only functions:XXX` NO es necesario porque `defineSecret` resuelve al latest version en runtime. PERO si el cambio es breaking (user viejo deshabilitado inmediato), hay que reiniciar las CFs ejecutando un dummy deploy O esperando el proximo cold start de cada CF.
- Alternativa UX: agregar boton "Como rotar credencial SAP" en el Panel admin que abre modal con los 3 comandos listos para copiar + link a doc interno.

### Comunicacion a Mariano

- Mandar email a Mariano + Pablo (los 2 admins) con el runbook de rotacion ANTES de ejecutar Fase 3.
- Incluir: pre-requisito `gcloud auth login` + alcance del rol GCP necesario + comando exacto + como verificar que la rotacion funciono.
- Precedente: en v690 ya se hizo este cambio para `SAP_SL_PASSWORD`; replicar la misma mecanica.

---

## 8. Riesgos y edge cases

| Riesgo                                                                 | Mitigacion                                                                               |
|------------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| Downtime Fase 2 si secret falta o se corrompe                          | Deploy en horario no-pico. Mantener Fase 1 (dual-read) como rollback inmediato (10 min). |
| Rotation strategy: necesitamos N versions atras por rollback           | `gcloud secrets versions add` crea nueva version SIN deshabilitar anterior. Mantener las ultimas 3 versions enabled.|
| Scheduled CFs (schedule 15/60 min) + secret rotation mid-run           | Las CFs leen el secret value al inicio del handler. Rotacion durante ejecucion afecta solo la proxima invocacion. |
| CFs que faltaron de la lista (ej: alguna CF nueva que no aparece hoy)  | Pre-Fase-2: `grep -rn 'sap_integration' functions/` + validar que todas tienen secrets[].|
| `functions/core/sap-proxy-core.js` recibe DI → NO requiere cambio      | OK, pero validar que el wrapper pasa `sapConfig` con los 4 campos correctos.             |
| GitHub Actions con GITHUB_TOKEN limitado scope                         | Secrets de workflow son por repo, OK. No afecta.                                         |
| Developer local corre scripts Python                                   | Documentar en README `.env.example` con placeholders.                                    |
| Secret acceso desde user accounts (humano) para rotacion               | Mariano + Pablo necesitan `roles/secretmanager.admin` o `roles/secretmanager.secretVersionAdder`. |
| Secret acceso desde SA runtime                                         | SA default `<project>@appspot.gserviceaccount.com` necesita `roles/secretmanager.secretAccessor`. Verificar en Fase 0. |
| Cold backups historicos (gs://<project>-backups/firestore/*)           | Pre-migracion, los backups contienen `username`/`companyDB` leakeados. Opcional post-Fase-4: borrar backups >30 dias (politica de retencion standard). |
| CF `checkSapSlHealthCF` tiene 2 lecturas (lineas 1105 + 1239)          | Ambas migrar en la misma Fase 1/2.                                                       |
| Script Python runtime sin env var (dev local sin .env)                 | Fase 2 falla fast con `KeyError`. OK — forza al dev a configurar bien.                   |
| Credencial accidentalmente logeada en Sentry / Logs                    | Grep post-Fase-4: `secret value` + alerta en Sentry si aparece.                          |

---

## 9. Timeline estimado

| Fase       | Dev time         | Observacion   | Calendar total      |
|------------|------------------|---------------|---------------------|
| Fase 0 (preparacion)         | 30 min  | —            | mismo dia          |
| Fase 1 (dual-read)           | 3h      | 48h          | 2.5 dias           |
| Fase 2 (secret-only)         | 2h      | 48h          | 2.5 dias           |
| Fase 3 (cleanup Firestore)   | 2h      | 24h          | 1.5 dias           |
| Fase 4 (verify + audit)      | 1h      | 7 dias (background) | 1 semana   |
| **TOTAL dev time**           | **~8.5h** |             |                   |
| **TOTAL calendar (serial)**  |         |             | **~2 semanas**     |
| **TOTAL calendar (paralelo con otras tareas)** |  |      | **~1 semana util** |

Recomendacion: hacer Fase 0 + Fase 1 el mismo dia (lunes). Observacion lunes-miercoles. Fase 2 miercoles tarde. Observacion jueves-viernes. Fase 3 lunes siguiente. Fase 4 en background toda la semana.

---

## 10. Pre-requisitos

### 10.1 Permisos GCP

| Rol                                              | Para quien                            | Scope           |
|--------------------------------------------------|---------------------------------------|-----------------|
| `roles/secretmanager.admin`                      | Mariano (admin principal)             | Proyecto app-vendedores-shimano |
| `roles/secretmanager.admin`                      | Pablo (backup admin)                  | Proyecto        |
| `roles/secretmanager.secretAccessor`             | SA default `app-vendedores-shimano@appspot.gserviceaccount.com` | Secrets `SAP_SL_USERNAME`, `SAP_SL_COMPANY_DB` |
| `roles/secretmanager.secretAccessor`             | SA custom runtime de Firebase Functions (si aplica, verificar) | Idem |
| `roles/datastore.importExportAdmin`              | SA responsable de daily backups       | Ya existe        |
| `roles/datastore.user`                           | SA default (lectura Firestore)         | Ya existe        |

### 10.2 GH Actions

- Repo settings → Actions → Secrets → agregar `SAP_SL_USERNAME` + `SAP_SL_COMPANY_DB`.
- Verificar que no se expone a forks (settings: "Deny" workflows from forks).

### 10.3 Checklist humano Mariano (antes de ejecutar)

- [ ] Autenticado en gcloud contra `app-vendedores-shimano`.
- [ ] `gcloud secrets list` muestra `SAP_SL_PASSWORD` existente (confirma permisos admin).
- [ ] Mariano tiene PAT GitHub con `repo + secret` scope.
- [ ] Backup Firestore reciente (<24h) existe en `gs://<project>-backups/`.
- [ ] Dia / horario de bajo trafico elegido (viernes 20hs ART preferible para Fase 2).
- [ ] Runbook de rotacion comunicado a Pablo (co-admin).

---

## 11. Resumen ejecutivo — proximos pasos para Mariano

- **Esta semana (Fase 0 + 1)**: crear los 2 secrets en Secret Manager + GH Actions con valores actuales (30 min). Deploy CFs con dual-read (3h). Observar 48h.
- **Semana que viene (Fase 2 + 3)**: deploy secret-only (2h, viernes). Observar fin de semana. Lunes: cleanup Firestore + readonly UI en Panel admin (2h).
- **Semana siguiente (Fase 4)**: audit logs 1 semana. Confirmar cero accesos legacy. Cerrar Security M-01 en `AUDIT_SHIMANO_2026-10-07.md`.
- **Esfuerzo total**: ~8.5h dev + ~2 semanas calendario (observacion no bloquea otras tareas).
- **Dependencia no obvia**: `functions/core/sap-proxy-core.js` NO requiere cambios (recibe DI). Solo `functions/index.js` wrapper + 10 CFs + 5 scripts Python + 2 workflows YAML + 2 archivos frontend = **7 archivos de codigo** con cambios reales. El resto son grep-matches en texto PDF/docs que se actualizan en Fase 3.

---

**Fin del plan.**
