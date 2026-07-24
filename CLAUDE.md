# CLAUDE.md — Reglas durables del proyecto (aprendidas durante Fase 0)

Este archivo captura reglas de comportamiento aprendidas durante Fase 0 (rama `fase-0`). Cada regla incluye el contexto que la disparó y cuándo aplicar.

## 1. Deps npm por etapa, no big-bang

**Regla**: instalar en `package.json` solo las devDependencies necesarias para la etapa actual + inmediatas. Deps pesadas (Playwright con browsers ~600 MB, firebase-tools con emulators bundled ~200 MB, firebase-admin con grpc, firebase-functions) van en su propia etapa o dentro de subcarpetas (`functions/`).

**Por qué**: en Windows con red inestable, `npm install` de 12+ deps grandes falla con `ECONNRESET` mid-download y deja `node_modules` corrupto. La primera instalación de Fase 0 se colgó 15+ min sin progreso y terminó vaciando la carpeta.

**Cómo aplicar**: al arrancar cada etapa, revisar si necesita nuevas deps y hacer `npm install <dep>` incremental. Si una dep es solo para un `functions/` (Cloud Functions), va en `functions/package.json` — no en el root.

## 2. `firebase init` es interactivo, evitarlo — scaffold manual

**Regla**: no ejecutar `firebase init` en scripts automatizados. Crear manualmente `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `functions/package.json` + `functions/index.js` con contenido conocido.

**Por qué**: `firebase init` abre prompts (¿qué features?, ¿qué lenguaje?, ¿usar ESLint?, ¿instalar ahora?) que no se pueden pasar por flags. El usuario dejó explícito: acciones interactivas son cosa suya.

**Cómo aplicar**: cuando necesites config Firebase local nuevo, usar `Write` en cada archivo con el contenido derivado del docs oficial + `.firebaserc` con project ID confirmado.

## 3. `npx --no-install <bin>` no funciona con paquetes de devDep

**Regla**: para verificar que una devDep está instalada, usar `node_modules/.bin/<bin>` o `npx <bin>` (sin `--no-install`). El flag `--no-install` busca solo en PATH global.

**Por qué**: `npx --no-install vitest --version` falla con "no se reconoce como comando" aunque vitest esté en `node_modules/.bin/`.

## 4. Ejecución en loop (act → verify → re-prompt)

**Regla**: nunca declarar "done" solo porque una edición o comando terminó exit 0. Toda etapa cierra ejecutando el gate declarado en el plan y pegando la salida real en el reporte de cierre.

**Por qué**: rule explícita del usuario. Los diffs verdes no prueban corrección funcional.

**Cómo aplicar**: al final de cada etapa, ejecutar exactamente los comandos del "Gate ejecutable" del plan, capturar stdout+stderr, reportar textual. Si algo falla → causa raíz, no ajustar test.

## 5. Rescope justificado ≠ relajar el gate

**Regla**: si durante ejecución descubrís que el gate original tenía dependencias que no eran necesarias en esa etapa, podés mover esas dependencias a otra etapa **si actualizás el plan file + documentás en CLAUDE.md** con el motivo. Eso es rescope. Cambiar el gate para que pase con menos cobertura sin justificación es relajar — prohibido.

**Por qué**: cambios de scope son legítimos y necesarios cuando aprendés cosas durante ejecución. Lo prohibido es "no lo puedo hacer verde, entonces bajo el listón".

**Ejemplo (E0)**: quité `npx playwright --version` del gate de E0 porque playwright solo se usa en E2 (smoke test). No es relajación — es que E0 no tiene por qué garantizar Playwright listo. Documento la movida.

## 6. Test bug vs SUT bug: distinguir antes de "arreglar"

**Regla**: cuando un test falla, primero determinar si el bug está en el TEST (asserción documenta comportamiento fantasía que nunca existió) o en el SUT (comportamiento real difiere del especificado). SOLO en el segundo caso el fix va al SUT; en el primero se arregla el test para reflejar el comportamiento real, con un comentario que explique la sutileza.

**Por qué**: la regla "no toco el test para hacerlo pasar" existe para prevenir que se relaje un criterio válido. NO impide corregir un test que documenta algo falso — al contrario, un test falso también es deuda.

**Cómo aplicar**: leer la función bajo test (extraída verbatim de prod = comportamiento real de prod). Si el test asume algo que la función nunca hizo, es test bug. Si la función hace algo distinto de lo que dice su docstring o del comportamiento intencional, es SUT bug.

**Ejemplo (E4)**: 3 tests iniciales fallaron. Los 3 eran test bugs míos:
1. `titleCase("mc'donalds")` → asumí `Mc'donalds`, pero JS regex `\b` trata `'` como word boundary → `Mc'Donalds`. Función OK; test corregido para documentar.
2. `hasAny` con `cliTipo:'C'` → asumí false, pero la fórmula `!!(tipo || ...)` hace true cuando hay tipo aunque el descuento sea 0%. Función intencional; test corregido + agregado test complementario que valida ambos casos.
3. `matchSkuFromTitle('Shimano Stella 4000 FI', ...)` → título no contenía la key SKU (`REEL4000FI` no está adyacente en `SHIMANOSTELLA4000FI`). Test data corregida.

Ninguno tocó el SUT. La distinción "bug del test vs bug del SUT" se resuelve *antes* de proponer cualquier cambio.

## 7. Cloud Functions: separar core puro del wrapper Firebase

**Regla**: cuando escribas una Cloud Function, extraé toda la lógica de negocio a un módulo `functions/core/*.js` con dependencias inyectables (fetch, getUserRole, sapConfig, log). El archivo `functions/index.js` solo hace el plumbing Firebase → core.

**Por qué**:
1. **Testeable sin emulator**: mockear `fetch` y `getUserRole` es trivial en Vitest. Correr `firebase emulators:exec --only functions,firestore,auth` requiere descargar jars adicionales (~50-100 MB) que en esta red son bloqueantes.
2. **Portabilidad**: si mañana movés de Firebase Functions a Cloud Run o Node.js standalone, solo re-escribís el wrapper. La lógica no cambia.
3. **Zero acoplamiento a firebase-admin/firebase-functions en tests**: no necesitás `firebase-functions-test` (dep pesada + acopla el test al framework).

**Cómo aplicar**:
- Core: acepta `(data, auth, deps)` donde `deps = {fetch, getUserRole, sapConfig, log, ...}`. Tira objetos `{code, message}` compatibles con HttpsError pero sin importarlo.
- Wrapper (`functions/index.js`): construye `deps` con valores reales (`globalThis.fetch`, `getFirestore()` para roles, `secret.value()` para creds), llama al core, y traduce el error del core a `HttpsError` de firebase-functions.

**Ejemplo (E5)**: `functions/core/sap-proxy-core.js` tiene toda la lógica (auth check, endpoint sanitization, SL login, cookie extraction, forward, logout, no-leak checks). 25 tests con mocks. `functions/index.js` es 60 líneas de wiring. Deploy real es gate humano (IAM + Secret Manager) — pero eso NO es lo que los tests deben validar; los tests validan la lógica.
