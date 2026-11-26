# B2-c: cortar el dual-write de secretos de auth a `/roles`

**Fecha**: 2026-11-26 (Stack S-10, modo continuo)
**Branch**: `sec/b2-c-stop-dual-write-roles`
**Scope**: PR para revisión humana. Sin deploy en este PR.

---

## Antes

Los 3 setters de `functions/core/auth-secrets-core.js` escribían a DOS lugares atómicamente en `runTransaction`:

- `setPasswordCore` → `auth_secrets/{uid}` (scrypt-v2) + `roles/{uid}` (`passwordSalt` + `passwordHash` SHA-256 legacy).
- `setTotpCore` → `auth_secrets/{uid}` (`totpSecret`, `totpLastStep`) + `roles/{uid}` (`totpEnabled`, `totpSecret`, `totpEnabledAt`, `totpEnabledBy`).
- `disableTotpCore` → `auth_secrets/{uid}` (`totpSecret` delete, `totpLastStep` delete) + `roles/{uid}` (`totpEnabled: false`, `totpSecret` delete).

El dual-write existía como red de rollback: mientras el gate de lectura mezclaba `/roles` y `/auth_secrets`, teníamos que mantener ambos consistentes.

## Problema

B2-a (v1573 commit `b9023ada`, 2026-11-25) migró el flujo de login + verificación TOTP a la Cloud Function callable `authVerifyLoginCF`, que lee **solo** `/auth_secrets`. El gate de lectura dejó de mezclar las dos colecciones.

Mientras los setters sigan escribiendo también a `/roles`:

1. Los secretos siguen apareciendo en una colección que el cliente puede leer con reglas más permisivas (dependiendo de rol).
2. Cada cambio de password/TOTP toca un doc que ya nadie lee → ruido operacional + superficie de sincronización inútil.
3. Un futuro bug que relea `/roles` reintroduce el flujo viejo en silencio.

## Cambio

En `functions/core/auth-secrets-core.js`:

- **setPasswordCore**:
  - Elimina el cómputo de `legacySalt` + `legacyHash` (SHA-256).
  - Elimina el `tx.set(rolesRef, {passwordSalt, passwordHash, pwUpdatedAt}, {merge:true})`.
  - Reemplaza `runTransaction` por `asRef.set({pwVersion, pwSalt, pwHash, pwUpdatedAt}, {merge:true})` directo (una sola escritura ⇒ tx innecesaria).
  - Mantiene dep `sha256Hex` porque `verifyPasswordCore` sigue usándolo para el fallback de docs `/auth_secrets` con shape legacy (no afectado por B2-c).
- **setTotpCore**:
  - Elimina el `tx.set(rolesRef, {totpEnabled: true, totpSecret, totpEnabledAt, totpEnabledBy}, {merge:true})`.
  - Reemplaza `runTransaction` por `asRef.set({totpSecret, totpLastStep, totpUpdatedAt, totpEnabledBy}, {merge:true})` directo.
  - `totpEnabledBy` ahora se persiste en `/auth_secrets` (antes vivía solo en `/roles`).
- **disableTotpCore**:
  - Elimina el `tx.set(rolesRef, {totpEnabled: false, totpSecret: delete, totpDisabledAt}, {merge:true})`.
  - Reemplaza `runTransaction` por `asRef.set({totpSecret: delete, totpLastStep: delete, totpDisabledAt}, {merge:true})` directo.

Los 3 bloques incluyen comentario de encabezado con referencia al Stack S-10 2026-11-26 y mención de B3 (script futuro que limpia los campos residuales en `/roles`).

## Por qué

B2-a dejó al cliente leyendo solo `/auth_secrets`. B2-c es el cierre lógico: cortar la escritura hacia `/roles` para que:

1. **Fuente única de verdad** post-login: `/auth_secrets` es el lugar donde viven los secretos. `/roles` guarda **únicamente** metadata de rol/pareja (roles, vendor, email, internalPartnerUid, flags no sensibles).
2. **Reducción de surface**: un doc menos escrito por operación de password/TOTP.
3. **Preparación de B3**: con el dual-write cortado, un script posterior (`scripts/audit/*_cleanup_roles_secretos_residuales.cjs`) puede eliminar los campos `passwordSalt`, `passwordHash`, `pwUpdatedAt`, `totpSecret`, `totpEnabled`, `totpEnabledAt`, `totpEnabledBy`, `totpDisabledAt` residuales sin preocuparse de escrituras concurrentes.

Las verificaciones `verifyPasswordCore` + `verifyTotpCore` **no se tocan**: ya leen solo `/auth_secrets` desde B2-a. Los docs `/roles` con secretos residuales quedan stale pero sin lectores.

## Verificación

- `node_modules/.bin/vitest run tests/functions/auth-secrets-core.test.js` → 43/43 PASS.
- `node_modules/.bin/vitest run tests/functions/` → 1853/1853 PASS (todo el módulo functions verde, incluye `auth-verify-login-core.test.js` que exercises end-to-end el flow B2-a + setters B2-c).
- `node_modules/.bin/vitest run tests/unit/` → 3472/3472 PASS.
- `node_modules/.bin/biome check functions/core/auth-secrets-core.js tests/functions/auth-secrets-core.test.js` → clean.
- `node_modules/.bin/tsc --noEmit --project tsconfig.json` → clean.
- `grep -nE "rolesRef|collection\('roles'\)" functions/core/auth-secrets-core.js` → 0 matches.

### Tests nuevos (bloque `describe('B2-c: no dual-write a /roles')` en `tests/functions/auth-secrets-core.test.js`)

6 tests cubren el contrato nuevo:

1. `setPasswordCore` crea solo `/auth_secrets` (no crea `/roles`).
2. `setPasswordCore` NO muta un `/roles/{uid}` preexistente (preserva `role`, `email`, etc.).
3. `setTotpCore` crea solo `/auth_secrets` + persiste `totpEnabledBy`.
4. `setTotpCore` NO muta un `/roles/{uid}` preexistente (preserva `totpEnabled` stale).
5. `disableTotpCore` solo borra campos de `/auth_secrets`.
6. `disableTotpCore` NO muta un `/roles/{uid}` preexistente con `totpEnabled: true`.

Precedente que justifica incluir los tests (4) y (6) con el flag stale: §55 (snapshot before delete) + B3 futuro que decide cuándo limpiar la residual.

### Tests legacy actualizados

El bloque viejo `describe('setters dual-write (auth_secrets + roles)')` tenía 3 tests que verificaban el dual-write. Por §6 (test-bug cuando el SUT cambió intencionalmente), los reemplacé con `describe('setters: guards de validacion')` que conserva solo el guard `setPasswordCore con password corta -> TransientAuthError` (sigue vigente). Los otros 3 quedan cubiertos por el nuevo bloque B2-c.

### Mocks de Firestore actualizados

Los mocks de `docRef` en `tests/functions/auth-secrets-core.test.js` y `tests/functions/auth-verify-login-core.test.js` tenían solo `get()` porque toda escritura pasaba por `tx.set(ref, ...)`. Como ahora los setters usan `asRef.set()` directo, agregué `.set()` al `docRef` mock en ambos archivos con la misma semántica de merge que `tx.set` (soporta `FieldValue.delete` via sentinel `__delete__`).

## Rollback

Reversión completa:

```bash
git revert <sha de este commit>
firebase deploy --only functions:authSetPassword,functions:authSetTotp,functions:authDisableTotp
```

Rollback parcial no aplica: los 3 setters se cambiaron en bloque. Si hay que reabrir dual-write para una única operación, es reintroducir la escritura a `/roles` en el setter afectado con el mismo patrón viejo (`runTransaction` + `tx.set(rolesRef, ...)`).

## Deploy

**No en este PR**. Mariano lo revisa, y cuando autorice, deploy:

```powershell
firebase deploy --only functions:authSetPasswordCF,functions:authSetTotpCF,functions:authDisableTotpCF `
  --project app-vendedores-shimano
```

Post-deploy verificar en `operations_log` del ambiente real que:
- Cambio de password desde el modal Admin → Usuarios genera entry OK sin tocar `/roles` (chequear con `firebase firestore:get roles/<uid>` que el `pwUpdatedAt` NO se actualiza).
- Activación TOTP idem.
- Rollback: si el flow de login se rompe, verificar primero `operations_log type='auth_verify_login_failed'` — `verifyPasswordCore` + `verifyTotpCore` NO se tocaron en B2-c, por lo que una falla aquí es de B2-a, no de B2-c.

## Precedentes

- B2-a (v1573 commit `b9023ada`, 2026-11-25): migración de login+TOTP a CF callable.
- `docs/CHANGELOG-sec-cf-interno-pareja-2026-11-25.md` + `docs/CHANGELOG-sec-interno-seguimiento-2026-11-25.md` (contexto secundario del plan de SEC continuo).
- CLAUDE.md §6 (test-bug vs SUT-bug), §55 (snapshot before backfill), §57 (cliente+servidor espejo), §58 (ALL reads before writes — ya no aplica porque dropeamos runTransaction).

## Archivos tocados

- `functions/core/auth-secrets-core.js` — 3 setters simplificados.
- `tests/functions/auth-secrets-core.test.js` — mock `.set()`, 6 tests B2-c, limpieza del bloque legacy.
- `tests/functions/auth-verify-login-core.test.js` — mock `.set()` en el `docRef` del helper local.
- `docs/CHANGELOG-b2c-cortar-dual-write-roles-2026-11-26.md` — esta entry.
