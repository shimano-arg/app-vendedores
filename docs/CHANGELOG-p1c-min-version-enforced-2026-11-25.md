# P1-C — minVersion configurable + recarga pre-confirm (v1588, 2026-11-25)

## Antes

- `app_config/version_minima` existía desde v1434 (E10 Fase 1+3 stock-servidor-atomico) pero el chequeo cliente-side corría SOLO post-login. Un VDE con sesión viva no recibía el modal bloqueante hasta que cerrara sesión y volviera a entrar.
- El server-side gate `VERSION_OLD` (`functions/core/commit-pedido-core.js:155`) sí aplicaba al commit, pero el round-trip de rechazo consumía quota + daba mensajes inconsistentes.
- Observación operativa: 52% de los rechazos `ASIG_REF_INVALID` recientes venían de clientes con versión stale que no habían aplicado fixes de identidad por línea (§33/§35).

## Problema

Sin un gate client-side que dispare ANTES del commit, los VDEs con sesión larga + versiones bumped mientras su app seguía abierta disparaban commits condenados al rechazo. No había cómo cerrar la ventana para VDEs con mala conectividad u otros browsers (el reload post-login no dispara si la sesión ya está).

## Cambio

1. **Pure fn nueva** `src/pure/min-version-check.js`:
   - `parseAppVersion(v)` — devuelve `number | null` para strings tipo `v1234`, `V1234`, `1234`, o `null` para no parseable (distingue de `0`).
   - `shouldForceReload(appVersion, minVersion)` — devuelve `true` solo si ambos parsean + `local < min`. Fail-open §77 para todos los demás casos.
   - `compareAppVersion(a, b)` — 3-way `-1 | 0 | 1 | null` (helper).

2. **src/main.js**: import + expone `window.__phase0.pure.minVersionCheck = { parseAppVersion, shouldForceReload, compareAppVersion }`.

3. **index.html** (nuevas piezas client-side):
   - `window._shimanoMinVersionCached` + `window._fetchMinVersionOnce()` — 1 read Firestore por sesión del doc `app_config/version_minima`. Cache en `window._shimanoMinVersionCached`. In-flight dedupe con `window._shimanoMinVersionFetchInflight`.
   - `_renderPreConfirmReloadModal(minVersion)` — modal apple-design §106 (pill button, rounded, backdrop-filter, feedback `:active`) construido con `createElement` + `textContent` (nunca `innerHTML` con strings). Botón "Aceptar" dispara `location.reload()` — NO `location.replace` (preserva history + back). Idempotente.
   - `_preConfirmForceReloadIfStale()` — invoca pure fn (fallback inline para SW stale). Retorna `true` si disparó modal (caller debe abortar).
   - **Hook en `_tryCommitPedidoCF`**: primera línea del body. Si devuelve `true` → `return { ok: false, errorCode: 'VERSION_OLD_CLIENT', data: { blockedByClient: true, clientVersion } }`.
   - **Handler nuevo** en el else-chain del commit result de `doConfirmPedido`: `code === 'VERSION_OLD_CLIENT'` → `closeConfirmDialog()` + `return;` (sin alert duplicado — el modal ya está en pantalla).

4. **Draft preservation**: el flujo depende de que `localStorage['shimano_zonas_pending_v1']` sobreviva un `location.reload()` nativo. §101 y los tests nuevos T8 lo garantizan: el hook NO hace `removeItem`/`clear` sobre esa key.

5. **Instrumentación**: cuando el modal dispara, el hook escribe `operations_log` fire-and-forget con `type: 'client_pre_confirm_reload'`, `clientVersion`, `minVersion`, `userUid`, `userEmail`. Ya cubierto por rules §70 (`operations_log` create permitido si `userUid == auth.uid`).

6. **Audit script** `scripts/audit/P1C_version_mix.cjs` (read-only, dry-run por naturaleza):
   - Lee `app_config/version_minima` + `operations_log` (últimos N días) + `pedidos` (últimos N días).
   - Tabula pedidos OK por `clientVersion`, rechazos por `clientVersion` y por `errorCode`, y — si `minVersion` configurado — rechazos stale (local < min).
   - Útil para medir antes/después del rollout: `node scripts/audit/P1C_version_mix.cjs --days=7 --full`.

7. **Versiones**: `APP_VERSION` + `CACHE_VERSION` bump v1586 → v1588.

## Por qué

- **Regla fuerte §68**: el modal usa mensajes humanos (sin jerga), 1 oración qué pasó + 1 qué hacer. Nunca códigos crudos o jerga técnica en el texto.
- **Regla fuerte §77**: fail-open ante doc inexistente, lectura fallida, versión no parseable. El server-side (CF `VERSION_OLD` v1434) sigue siendo la red de seguridad final.
- **Regla fuerte §101**: `location.reload()` nativo (no `replace`) preserva el borrador + history. Draft vive en `localStorage['shimano_zonas_pending_v1']` que está en `CLEAN_RELOAD_PRESERVE_KEYS` por diseño.
- **Regla fuerte §106**: modal nuevo nace con estilo Apple (pill button, letter-spacing negativo, text-transform none, feedback `:active` con `scale(0.97)`).
- **Regla fuerte §57**: lógica cliente+servidor vive una sola vez en pure. Si en el futuro el server adopta `shouldForceReload` del pure (vs la lógica inline actual), se evita drift.

## Verificación

- `npm run test:unit` → **3378/3378 PASS** (32 nuevos: 20 pure + 12 contrato).
- `npx biome check src/pure/min-version-check.js src/main.js tests/unit/min-version-check.test.js tests/unit/audit/min-version-enforce-v1588.test.js` → clean.
- `npm run typecheck` → clean en los archivos nuevos (61 errores pre-existentes en `functions/`, no relacionados).
- `npx vitest run tests/smoke/` → 25/25 PASS.
- Bundle rebuilt con `node build.js` + commit de `app.bundle.js` + `chunks/`.

### Smoke manual sugerido (post-deploy)

1. Abrir la app con bundle v1588 cargado.
2. Setear `app_config/version_minima.minVersion = 'v99999'` en Firestore (tira valor imposiblemente alto para forzar).
3. Intentar confirmar un pedido → debe aparecer el modal "Hay una versión nueva disponible" + reload al tocar Aceptar.
4. Verificar que el borrador aparece intacto post-reload (el pedido en curso NO se pierde).
5. Volver `minVersion` a `'v1500'` (o cualquier valor ≤ v1588) → confirmar debe pasar normal.
6. Ejecutar `node scripts/audit/P1C_version_mix.cjs --days=1` → debe mostrar al menos un entry de tipo `client_pre_confirm_reload` con el `clientVersion` = `v1588`.

## Rollback

1. `git revert <commit v1588>` + squash merge PR revert.
2. Pages auto-redeploy ~2 min. Sin cambio de rules.
3. Si queda cualquier bump de `APP_VERSION` + `CACHE_VERSION` orphan, el mismo revert los baja.
4. Nada que revertir en Firestore — el doc `app_config/version_minima` se queda como estaba. Si Mariano lo seteó a un valor estricto post-deploy y quiere destrabar, basta con dejarlo en blanco o bajarlo.

## Pendiente humano

- **Configurar `app_config/version_minima.minVersion`** — Mariano decide cuándo y a qué valor. La herramienta está lista y verificada; el enforcement no dispara hasta que se setea.
- Rules side-note: la rule actual de `app_config/{docId}` cataloga el write como `isAdmin() && !(docId in ['planner_responsables','planner_config','feature_flags'])`. Esto significa que **cualquier admin** (no solo Mariano) puede escribir `version_minima`. Si Mariano decide que quiere write-Mariano-only como en `feature_flags`, tocar `firestore.rules` en un PR aparte.

## Archivos tocados

```
docs/CHANGELOG-p1c-min-version-enforced-2026-11-25.md   (nuevo)
index.html                                              (bump + hook + modal + handler)
sw.js                                                   (bump CACHE_VERSION)
README.md                                               (changelog entry)
scripts/audit/P1C_version_mix.cjs                       (nuevo)
src/main.js                                             (import + export phase0)
src/pure/min-version-check.js                           (nuevo)
tests/unit/min-version-check.test.js                    (nuevo)
tests/unit/audit/min-version-enforce-v1588.test.js      (nuevo)
tests/unit/audit/commit-cf-fallback-strict.test.js      (window size bump 9500→11000)
tests/unit/audit/commit-cf-v1432-inline-contract.test.js (window size bump 9500→11000)
tests/unit/audit/do-confirm-pedido-usa-cf.test.js       (window size bump 5500→6500)
app.bundle.js                                           (rebuild)
chunks/*.js                                             (rebuild — sin cambios de contenido)
```
