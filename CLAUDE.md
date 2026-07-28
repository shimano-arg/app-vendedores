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

## 8. Puppeteer + Google OAuth no funciona — conectar a Chrome real via debug port

**Regla**: nunca usar `puppeteer.launch()` para escenarios que requieran login OAuth (Google, Microsoft, etc.). Usar `puppeteer.connect({ browserURL: 'http://localhost:9222' })` a un Chrome real launcheado por el user con `--remote-debugging-port=9222 --user-data-dir=<temp>`.

**Por qué**: Google detecta `navigator.webdriver = true` que Puppeteer setea por default y bloquea el OAuth con "This browser isn't supported". El user no puede loggearse en la ventana Puppeteer → escenarios post-login imposibles de automatizar.

**Cómo aplicar**: para E0/E4/E6 (scripts perf que necesitan mapa post-login), el user launcha Chrome fresh con debug port, loggea manualmente (una vez, cookies persisten en `--user-data-dir`), y el script se engancha. Script hace `browser.disconnect()` al final — NO cierra el Chrome del user.

**Ejemplo (E0)**: `scripts/perf/trace-map.js` conecta al puerto 9222 y busca el tab con `localhost:8000` ya loggeado.

## 9. Path del OUTPUT_DIR con `import.meta.url.pathname` deja %20 en Windows

**Regla**: para derivar paths de archivos junto al script en curso, usar `fileURLToPath(import.meta.url)` de `node:url`, NUNCA `new URL('./', import.meta.url).pathname.slice(1)`.

**Por qué**: `URL.pathname` deja los espacios URL-encoded (`%20`). En Windows, `fs.writeFileSync('C:/Users/.../APP%20VENDEDORES/foo.json', ...)` NO falla — Windows lo acepta como directorio válido, con `%20` literal en el nombre. Se genera un directorio paralelo al real (`APP VENDEDORES/` vs `APP%20VENDEDORES/`) → los outputs quedan en un lado y los lectures buscan en otro.

**Cómo aplicar**:
```js
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const OUTPUT_DIR = dirname(fileURLToPath(import.meta.url));  // correcto
```

**Ejemplo (E0)**: `scripts/perf/config.js` lo tuvo mal en la primera versión → Lighthouse guardó en `C:\Users\...\APP%20VENDEDORES\scripts\perf\baseline-shell-2026-07-27.json` (real path). El script de lectura buscaba en `APP VENDEDORES\scripts\perf\` → ENOENT. Detectado al inspeccionar los baselines para escribir BASELINE.md.

## 10. Puppeteer CDP con throttling → subir protocolTimeout, o dispatch events desde `page.evaluate`

**Regla**: cuando ejecutás automation con CPU throttling >2x + Network throttling, los CDP commands como `Input.dispatchMouseEvent` pueden tardar >30s en devolver ACK. Fix preferido: **dispatch los events dentro del browser via `page.evaluate` + `dispatchEvent(new MouseEvent(...))`**, evitando el roundtrip CDP. Fix fallback: `puppeteer.connect({ protocolTimeout: 120_000 })`.

**Por qué**: `page.mouse.wheel()` / `page.mouse.move()` mandan un CDP command; bajo CPU throttling 4x, el compositor thread puede tardar >30s (default) en dar el ACK del dispatch. Puppeteer tira `ProtocolError: Input.dispatchMouseEvent timed out`. El `protocolTimeout` en `puppeteer.connect()` a veces se ignora por el CDPSession creado desde `page.target().createCDPSession()` — inconsistente entre versiones.

**Cómo aplicar**:
```js
// En vez de:
await page.mouse.wheel({ deltaY: -100 });
// Hacer:
await page.evaluate(() => {
  const el = document.querySelector('#map');
  el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100, ... }));
});
```

**Ejemplo (E0)**: `scripts/perf/trace-map.js` tenía `page.mouse.wheel()` en el escenario pan/zoom con CPU 4x throttling — timeout siempre. Cambiado a dispatch desde `evaluate` con `MouseEvent` + `WheelEvent` nativos — funcionó.

## 11. Escenarios de perf en environment inestable → script tolerante, no all-or-nothing

**Regla**: cuando un script de medición corre N iteraciones (ej: 3 corridas para median), tolerar fallos individuales SI hay al menos 2 exitosas. Reportar cuáles fallaron pero no exit(1) si tenés muestra suficiente.

**Por qué**: environments locales para perf tests (Puppeteer + Firebase Auth + Chrome del user) son inestables — session refresh, network hiccups, throttling interactions. Un fallo transitorio en run 2 de 3 NO debería invalidar toda la baseline si runs 1 y 3 son consistentes.

**Cómo aplicar**: try/catch por iteración, acumular runs exitosos, si `runs.length < MIN_ACCEPTABLE` (por ej 2) exit 1; sino computar median sobre los OK + reportar fallos como warning.

**Ejemplo (E0)**: `scripts/perf/trace-map.js` tuvo 2/3 corridas exitosas (auth overlay reapareció en run 2). Script fue tolerante — median calculada sobre 2 runs, reportado en el JSON output. Baseline oficial no comprometido.

## 12. Todo `onSnapshot()` debe tener su `unsub*` cerrado en `detachFirebaseListeners()`

**Regla**: cualquier nuevo `let unsubX = null` + `unsubX = fbDb...onSnapshot(...)` en `index.html` requiere agregar `n += off('unsubX', unsubX, () => unsubX = null)` en `detachFirebaseListeners()`. Sin excepción.

**Por qué**: los listeners `onSnapshot` de Firestore quedan vivos en memoria + CPU + network hasta que se llama al unsub retornado. Si el user logout sin cerrar el listener → listener sigue leyendo la colección (Firestore Rules pueden bloquear pero el retry loop consume). Si re-loggea con otra cuenta → doble listener activo. Cumulativo entre sesiones.

**Cómo aplicar**: el test `tests/unit/listeners.test.js` es un linting automático — parsea `index.html`, extrae todas las `let/var unsub*`, compara contra los `off('name', ...)` de `detachFirebaseListeners()`. Si agregás un listener nuevo sin su `off()`, el test falla con el nombre exacto. Solo hay que agregar la línea al detach.

**Ejemplo (E1)**: audit reveló 23/31 listeners sin cleanup — `unsubApprovedAltas`, `unsubTargets`, `unsubMisRendiciones`, `unsubStockSnapshot`, etc. Extendido con helper `off(name, fn, setNull)` que tolera fallos individuales (leak parcial > total). Test unitario garantiza que futuros listeners no se olviden.

## 13. Bundle IIFE ≠ inline script scope — `let` en el inline NO va a `window`, `var` sí

**Regla**: cuando extraés código del inline `<script>` de `index.html` a un módulo del bundle (`src/domains/*.js`), state compartido cross-scope debe declararse con `var` en el inline, NUNCA con `let`. Al agregar un `let X` nuevo al inline que después será leído/escrito desde el bundle, cambiar a `var X`.

**Por qué**: el bundle es un IIFE `(function(){...})()` que se ejecuta ANTES del script inline (`<script src="./app.bundle.js">` en `<head>`, blocking). Su scope es local a la función anónima. Referencias a identifiers no declarados:
- `let X` / `const X` en el inline → binding en script scope, NO en `window`. Bundle no lo ve.
- `var X` en el inline → binding TAMBIÉN en `window.X`. Bundle lee `window.X` (o simplemente `X` — JS name resolution cae a `window` si no encuentra en local scope).

Timing: el bundle IIFE ejecuta primero → si intenta leer `window.X` en load time, `X` es undefined (inline no corrió aún). Pero las FUNCIONES definidas en el bundle usan `X` **al ser invocadas** (post-load, post-inline). Ahí `window.X` ya está definido. Pattern funciona salvo que el bundle intente ejecutar código con `X` durante su init IIFE.

**Cómo aplicar** al extraer un dominio:
- Antes de mover funciones al bundle: audit `let X = ...` del dominio → cambiar a `var X = ...` para las que serán accedidas cross-scope.
- Semantic diff cero para el uso actual (nadie usa TDZ ni redeclaration).
- Documentar en el commit qué vars cambiaron y por qué.

**Ejemplo (E2)**: para extraer targets a `src/domains/targets.js`, hay que cambiar `let targetsCache`, `let unsubTargets`, `let tgtSelectedVendor`, `let tgtSelectedYear`, `let tgtPendingChanges` → `var`. `detachFirebaseListeners` (inline) hace `off('unsubTargets', unsubTargets, ...)` — con `var`, `unsubTargets === window.unsubTargets` siempre, y el bundle escribiendo `unsubTargets = X` es lo mismo que `window.unsubTargets = X`. Ambos scopes ven el cambio.

**Alternativa descartada**: hacer un E2.0 upfront que convierte TODAS las `let` globales a `var`. Más invasivo, cambio ancho aunque semantic-safe. Preferimos hacer el swap **puntual dentro de cada sub-etapa** de extracción — cambio contained al dominio + revisable en el diff de la sub-etapa.

**Antecedente**: `var userRole` (línea 19056 pre-E2) usa el pattern desde antes con comentario explícito: "var (no let) para evitar TDZ cuando otras funciones dependen del binding antes del punto de asignación". `var approvedAltasList` (línea 3735) también. Los devs previos ya conocían el pattern; solo lo aplicaron inconsistente.

## 14. Rescope de un dominio grande — dividir o postponer, nunca extraer en un commit gigante

**Regla**: si al arrancar la extracción de un dominio (E2.x) descubrís que el rango real es >1500 LOC o involucra 3+ subdominios entrelazados, **NO extraer en un solo commit**. Opciones aceptables:
1. **Dividir**: definir subdominios claros (`src/domains/<name>-<subdomain>.js`) y extraer uno por commit.
2. **Postponer**: continuar con dominios más chicos que confirmen el pattern; volver al grande con más experiencia.

**Por qué**: extraer 6k líneas en un commit es imposible de code-review, imposible de bisectar en caso de regresión, imposible de rollback quirúrgico. La regla "verbatim first, refactor después" NO justifica commits monstruosos — la verbatimness aplica al contenido, no al tamaño.

**Cómo aplicar**: al iniciar cada sub-etapa E2.x, usar Explore agent para medir el rango real ANTES de proceder. Si el reporte devuelve >1500 LOC, escribir el rescope al plan file + CLAUDE.md antes de la extracción.

**Ejemplo (E2, 2026-07-28)**: el plan original estimaba admin-users en ~500 LOC (líneas 20700-21200). Explore midió: **6,463 LOC** (20058-26520) con 6 subdominios entrelazados (allowed emails, Gemini config, Gmaps config, bulk approver, 2FA/TOTP, password change). Se postpone admin-users y se prioriza campañas (~314 LOC) primero. Cuando lleguemos a admin-users, se dividirá en 6 sub-extractions distintas — o se hace un mini-plan aparte para ese solo dominio.

## 15. IIFE al top-level del módulo bundle → lazy init si consume state del inline

**Regla**: NUNCA copiar verbatim un `const X = (() => { ...POINTS.forEach... })();` del inline al bundle sin convertirlo a lazy init. El IIFE se ejecuta al **load** del bundle → el bundle IIFE corre ANTES del inline → arrays globales como POINTS, VENDORS, MESES, PRODUCTS aún son undefined → `ReferenceError`.

**Por qué**: order of execution. El bundle es `<script src="./app.bundle.js">` blocking en `<head>` → corre antes del `<script>` inline gigante. En el inline, `POINTS` está declarado en línea ~3417; el `const POINT_TO_VENDOR = (() => POINTS.forEach ...)();` original estaba en línea ~25782 — muy después. Al extraer el bloque al bundle, el IIFE se ejecuta primero.

**Cómo aplicar**: cualquier `const X = (() => { ... })()` en el bloque a extraer que referencie globals del inline debe convertirse en:
```js
let _cached = null;
function getX() {
  if (!_cached) {
    _cached = /* IIFE body */;
  }
  return _cached;
}
```
Y los usos `X[...]` → `getX()[...]`. La primera invocación construye; las siguientes usan el cache.

**Ejemplo (E2.h, dashboard)**: `POINT_TO_VENDOR` era un IIFE que iteraba POINTS. Fix: `getPointToVendorMap()` con lazy init. Detectado por `tests/smoke/bundle-runtime.test.js` que runsInNewContext el bundle sin globals — 10 tests fallaron con `ReferenceError: POINTS is not defined`. Corregido antes de commit.

## 16. Bundle > 200 KB por extracción E2 → subir techo del smoke test

**Regla**: el `bundle-runtime.test.js` tenía assertion `size < 200_000`. Post-E2 el bundle crece linealmente (targets ~50 KB, campanias ~55 KB, dashboard ~74 KB → ya 224 KB con solo 3 dominios). Techo real post-E2: ~400 KB. Techo post-E3 (split): shell.js < 500 KB.

**Por qué**: pre-E2 el bundle era 44 KB (solo 10 pure fns + sap + sentry). E2 mueve 14 dominios enteros al bundle → crece 5-10x. La assertion original era coherente para Fase 0, no para E2.

**Cómo aplicar**: al arrancar E2, subir el techo del smoke test a **500 KB** (techo post-E3 split del plan). Cuando E3 termine, la assertion cambia a "shell.js < 500 KB + cada chunk < 400 KB" según el plan.

**Ejemplo (E2.h, 2026-07-28)**: bundle 224 KB → test fallaba. Ajustado el rango a [20, 500 KB] con comentario explicando la escala esperada.

**Actualización (E2.f, 2026-07-28)**: rutas es ~1,394 LOC → bundle 537 KB. Techo re-ajustado a **1,500 KB** para soportar los 10 dominios restantes durante E2. Post-E3 el shell.js real bajará a <500 KB con code splitting; hasta entonces el bundle acumula todo. La assertion pre-E3 debe reflejar la fase intermedia, no el objetivo final.

## 17. `let unsub*` en el bundle IIFE + `off(name, fn, setNull)` en el inline → LEAK silencioso

**Regla**: cualquier `let unsub*` (o `let/const` de state compartido) declarado dentro de un módulo `src/domains/*.js` que sea REFERENCIADO por `detachFirebaseListeners()` del inline (o cualquier otra función del inline) DEBE convertirse a `if (typeof window.unsubX === 'undefined') window.unsubX = null;` + reasignaciones con `window.unsubX = ...`. NO alcanza con dejarlo como `let`.

**Por qué**: el bundle es un IIFE `(function(){...})()`. Cualquier `let/const` en el top-level del módulo queda en el scope de esa función, **no en el window**. El inline hace `off('unsubX', unsubX, () => unsubX = null)` donde `unsubX` es una **free reference** — el JS engine busca el binding en el scope léxico del inline (que NO ve dentro del IIFE) y cae al Global Environment Record. Si `unsubX` no está declarado allí, resuelve a `undefined`. `off` hace `typeof undefined !== 'function'` → **skip**. El listener onSnapshot queda vivo al logout. Leak silencioso — sin warning, sin error.

Los `off()` fallan silenciosamente por design del helper (tolera fn no-función para dar defensa contra "listener nunca inicializado"). Esa tolerancia hace invisible el bug del scope.

**Cómo aplicar**: SIEMPRE ANTES de extraer un dominio con listeners, grep el nombre del listener en el resto del inline (especialmente en `detachFirebaseListeners`). Si tiene callers fuera del bundle, requiere cross-scope. Chequeo automático: el test `tests/unit/listeners.test.js` valida cobertura pero solo detecta `let/var unsub*` en inline O `window.unsub*` en bundle — si el bundle declara `let unsub*`, la variable queda "invisible" al parser + al `off()` del inline. **El test lo pilla como orphan cleanup**: "off() de listeners inexistentes en index.html: unsubX".

**Ejemplo (E2.g, 2026-07-28)**: al extraer notificaciones, el bundle heredó `let unsubAltaCliMine = null;` verbatim del inline. El `off('unsubAltaCliMine', ...)` del inline línea 22668 quedó apuntando a undefined → listener leak silencioso. Test `listeners.test.js` reportó "off() de listeners inexistentes: unsubAltaCliMine". Fix: cambio a `if (typeof window.unsubAltaCliMine === 'undefined') window.unsubAltaCliMine = null;` + reasignaciones con prefix `window.`.

**Regla derivada del script Node de extracción**: buscar en el bloque a extraer todos los `let unsub[A-Z]*` y aplicar el patrón cross-scope AUTOMÁTICAMENTE, no como acción manual post-facto. Documentar en cada `src/domains/*.js` cuáles unsub* son cross-scope (window.*) y cuáles son intra-bundle (let local OK).

## 18. Chunks lazy nuevos requieren 3 lugares sincronizados

**Regla**: al agregar un nuevo chunk lazy `src/domains/<name>.js`, actualizar **3 archivos en el mismo commit**:
1. `build.js` → agregar entrada en `LAZY_CHUNKS = {name: [exports]}`.
2. `src/main.js` → `installChunkStubs('<name>', [exports])` con la MISMA lista.
3. `sw.js` → agregar `'./chunks/<name>.js'` a `STATIC_ASSETS`.

**Por qué**: si falta (1) o (2), el chunk no se genera o los stubs no se instalan → runtime error. Si falta (3), el chunk no se cachea → offline no funciona para ese módulo.

**Cómo aplicar**: los tests `tests/smoke/bundle-runtime.test.js` chequean (1) y (3) pero NO (2) — si el chunk existe en filesystem y en `sw.js`, pasa el smoke. Los stubs son responsabilidad del developer. Después de agregar un chunk, verificar manualmente que abrir la feature dispara `window.loadChunk(name)` sin errores.

**Actualización SW simultánea**: cada chunk nuevo requiere bumpear `CACHE_VERSION` en `sw.js` para invalidar cache viejo. Los usuarios con cache stale tendrán el chunk viejo (que quizás no existe post-refactor). El `activate` del SW borra cache viejo al primer navigation post-deploy.

**Ejemplo (E3, 2026-07-28)**: 3 chunks lazy iniciales (exports-core, exports-advanced, admin-users). Los 3 archivos sincronizados. Si mañana se extrae `pedidos-full` como chunk, agregar en los 3.

## 19. Stale-while-revalidate para assets locales del PWA

**Regla**: assets locales (bundle, chunks, iconos, geo.json, manifest) usan estrategia **stale-while-revalidate** en `sw.js` (no cache-first ni network-first). Sirve del cache inmediato (fast path) + fetch en background para actualizar cache al próximo load.

**Por qué**: post-deploy, si un usuario abre la app antes de que el SW nuevo active, sirve cache viejo (correcto para arranque rápido). En paralelo, fetch actualiza cache. Próximo load ya tiene versión nueva. Evita el "mismatch shell/chunk" donde un usuario tiene shell v333 cacheado pero descarga chunk v334 fresh (deploy incompleto o parcial).

**Cómo aplicar**: pattern
```js
event.respondWith(
  caches.open(STATIC_CACHE).then(cache =>
    cache.match(req).then(cached => {
      const netFetch = fetch(req).then(resp => {
        if (resp && resp.status === 200) cache.put(req, resp.clone()).catch(()=>{});
        return resp;
      }).catch(() => cached);
      return cached || netFetch;
    })
  )
);
```

**NO aplicar a**: `index.html` (network-first, cambia seguido, quiere versión fresca), `stock.json` (SIEMPRE network-first sin cache, snapshot cada 30 min).

**Ejemplo (E5, 2026-07-28, v335)**: cambio de estrategia de "cache-first ONLY" a "stale-while-revalidate". Solucionó bug potencial: post-deploy de un chunk, usuarios con SW viejo (pre-activate) descargaban chunk viejo desde cache → runtime error si el chunk viejo esperaba una API que ya no existe en shell nuevo.
