# CLAUDE.md — Reglas durables del proyecto (aprendidas durante Fase 0)

Este archivo captura reglas de comportamiento aprendidas durante Fase 0 (rama `fase-0`). Cada regla incluye el contexto que la disparó y cuándo aplicar.

---

## 0. Protocolo de trabajo obligatorio (acordado 2026-10-14)

Estas reglas aplican a todas las sesiones de este proyecto. No son sugerencias.

### 0.1 Inventario al inicio de cada sesion

Antes de tocar cualquier archivo, y cada vez que Mariano escriba "inventario", hacer esto:

1. Relevar todo lo instalado y disponible, de todos los origenes: skills (globales en `~/.claude/skills` y del proyecto en `.claude/skills`), subagentes (`~/.claude/agents` y `.claude/agents`), plugins habilitados en `settings.json`, servers MCP (`~/.claude.json` y `.mcp.json`) y repositorios clonados dentro del proyecto que contengan `SKILL.md` o agentes.
2. Mostrarlo como checklist, agrupado por tipo. Para cada item: nombre, origen (ruta o plugin), explicacion simple de para que sirve, ejemplo concreto de tarea de ESTA app donde conviene usarlo. Sin jerga.
3. Marcar aparte lo que esta clonado pero NO registrado (repo con SKILL.md fuera de ruta de descubrimiento). Eso esta mal instalado y hay que avisarlo.
4. Si dos skills hacen lo mismo, decirlo y recomendar cual conservar.

Ejecutar `/skills`, `/agents` y `/plugin` para verificar, no asumir de memoria.

### 0.2 Antes de cada tarea: revision de skills aplicables

Cada pedido de cambio/edicion/fix/feature, ANTES de escribir codigo:

1. Revisar inventario, listar skills/subagentes/MCP que aplican. Una linea cada uno explicando POR QUE.
2. Si no aplica ninguna, decirlo explicitamente. No saltearlo en silencio.
3. Usar efectivamente las elegidas (invocacion con Skill tool o `/nombre`). Prometer sin invocar NO cuenta.

### 0.3 Rol de arquitecto: planificar antes de ejecutar

Para cualquier tarea que toque mas de un archivo o mas de una seccion:

1. Si existe skill o plugin de planificacion (ej: `superpowers:brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`), usarla. Si no, aplicar el proceso igual a mano.
2. Producir un plan antes de codear: objetivo, division en secciones/pasos, para cada paso que skill o subagente lo ejecuta y cual lo revisa.
3. ANALISIS DE IMPACTO obligatorio: antes de modificar algo, identificar todos los lugares de la app que dependen o consumen lo mismo (componentes, rutas, API, esquema de datos, estados compartidos, estilos, tests). Listarlos en el plan.
4. Mostrar el plan y esperar OK antes de ejecutar, salvo que Mariano diga "dale directo".
5. Al terminar cada paso: verificacion real (tests, build, lint, abrir el resultado), no "deberia funcionar". Si hay skill de verificacion o code review instalada, usarla.
6. Antes de cerrar: revision de codigo buscando bugs, regresiones, desalineacion con el resto de la app. Reportar lo que se encontro y lo que se corrigio.

### 0.4 Buscar e instalar skills nuevas (AUTORIZADO PREVIAMENTE)

Mariano autorizo previa y explicitamente instalar skills/plugins/subagentes/repos que mejoren la app o la calidad.

1. Usar `find-skills`, `skills.sh` o cualquier buscador instalado. Si no hay ninguno, instalar `find-skills` primero.
2. NO volver a pedir OK por cada instalacion.
3. Condiciones: instalar en ruta correcta segun tipo (marketplace via `/plugin`, skills sueltas en `~/.claude/skills`, agentes en `~/.claude/agents`). Verificar despues con `/skills` que quedo registrado. Avisar en una linea: que se instalo, de donde, si trae hooks o MCPs. Preferir fuentes conocidas con mantenimiento reciente.
4. Si lo que se encuentra parece dudoso (sin mantenimiento, pide credenciales raras), NO instalar y explicar por que.

### 0.5 Formato de las respuestas

Primero el resultado o la decision, despues el detalle. Espanol rioplatense. Nada de "deberia andar": si no se verifico, decirlo.

---

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

## 20. Workflow deploy: rama `dev` + PR squash a `main` (2026-07-30)

**Regla**: TODO trabajo nuevo se commitea en la rama `dev`, NUNCA directo en `main`. Push a `dev` no requiere autorización (no es default branch). Deploy a prod = abrir PR desde `dev` a `main` + squash-merge via `gh pr merge --squash --delete-branch`.

**Por qué**: el harness de Claude Code bloquea `git push` a la default branch (`main`) como safeguard hardcoded — cada push a main requiere frase de autorización explícita del user ("sí, hacé push a main"). Con rama `dev`:
- Commits + push a `dev` corren sin bloqueo (no es default branch).
- El deploy es explícito: abrir PR + merge, no push directo. Queda registro en GitHub Pull Requests para auditoría.
- Squash-merge respeta la regla del repo "no merge commits" (branch protection).

**Cómo aplicar** (flujo estándar por cada feature/hotfix):

```bash
# Trabajar en dev
git checkout dev
# ... editar, bumpear APP_VERSION+CACHE_VERSION, actualizar README
git add <files>
git commit -m "vN: ..."
git push origin dev

# Deploy a prod (cuando el user OK)
gh pr create --base main --head dev --title "vN: <desc>" --body "..."
gh pr merge --squash --delete-branch  # squash-merge + borra dev remoto

# Post-merge: recrear dev local + remoto desde main actualizado
git checkout main
git pull origin main                        # trae el squash commit
git branch -D dev                           # borra dev local (viejo)
git checkout -b dev                          # crea dev nueva desde main
git push -u origin dev                       # recrea dev remota
```

**Autorización previa (2026-07-30)**: el user autorizó explícitamente este workflow. NO pedir confirmación por cada `gh pr create` + `gh pr merge --squash` sucesivo. Sí pedir si el user pide "deploy a main directo" (bypass del PR) o si el PR va a mergear cambios que el user no confirmó explícitamente.

**Rama `main` intacta**: nunca `git checkout main` + edit + commit + push. `main` se toca SOLO via merge de PR + `git pull` para sincronizar local.

**Riesgo residual**: si hay CI checks en el PR y fallan, el `--squash` no completa hasta que pasen. Auditar `gh pr checks` antes de asumir deploy exitoso.

## 21. Interacciones gestuales pasan por apple-design skill (2026-08-26)

**Regla**: cualquier interacción con **drag, swipe, sheet** (modal que abre/cierra con transición), **scroll con snap**, o **transición con "peso"** (bounce, elastic, spring feel) DEBE pasar por la skill `apple-design` antes de darse por hecha.

**Ubicación skill**: `.agents/skills/apple-design/SKILL.md` (o vía symlink `.claude/skills/apple-design/SKILL.md`). Clasificación de qué se hace vanilla vs con `motion/mini` en `CLASSIFICATION.md` al lado. Medición real del peso del lib en `MOTION_BUNDLE_MEASURED.md`.

**Por qué**: la app se usa 100% desde celular; el feel gestual es lo que separa "app nativa" de "web feo". Sin este gate consistente cada modal termina con su propia curva bezier improvisada, cada sheet abre distinto, cada botón responde con un timing diferente. El costo es 3.1 KB gzipped de `motion/mini` (aprobado por Mariano 2026-08-26) para el 5% de casos que requieren spring lib (§4 damping/response + §5 velocity handoff). El 85% restante es CSS + Pointer Events + rAF puros.

**Cómo aplicar** (checklist antes de escribir código de una interacción):

1. **Feedback en pointerdown, no en click** (§1). Botón highlight instantáneo. `transform: scale(0.97)` con `transition: 100ms ease-out`.
2. **1:1 tracking en drag** (§2). `setPointerCapture` + tracking desde el offset donde el user agarró, nunca desde el centro.
3. **Interruptibilidad** (§3). Nunca lockear input durante transición. Al reinterrumpir, animación arranca desde valor **live** (leer transform actual), no desde target. Para reversals mid-flight → `motion/mini` con `animate()` (spring re-target automático).
4. **Springs con damping/response** (§4). Default `bounce: 0, duration: 0.4` para UI normal. `bounce: 0.2, duration: 0.4` **solo cuando la interacción cargó momentum** (flick, drag release). Nunca bounce en fade-in.
5. **Velocity handoff al soltar drag** (§5). Pasar `velocity: pxPerSec` al `animate()` post-drag. Sin esto, el seam entre drag y post-drag se ve como "brick wall".
6. **Momentum projection** (§6). `v/1000 * 0.998 / 0.002` = posición proyectada. Snap al target más cercano a esa posición, no al release point.
7. **Spatial consistency** (§7). Enter/exit por la misma ruta. `transform-origin` en el trigger, no en el centro del elemento.
8. **Rubber-banding en boundaries** (§9). Fórmula `(overshoot * dim * 0.55) / (dim + 0.55 * abs(overshoot))`.
9. **backdrop-filter blur + saturate** (§12) para chrome (headers, sheets). Nunca fondos opacos que cortan la continuidad.
10. **`prefers-reduced-motion` respeto** (§14). Springs → opacity fade + `transform: none !important`.
11. **Vibration API + audio sync** (§13) para actions críticos (commit, snap, error). Solo si el user afirmó el gesto.
12. **Typography size-specific tracking** (§15). `letter-spacing` negativo en display large, `0` en body, positivo en small. `clamp()` para size responsive.

**Downgrade explícito**: si por alguna razón (bundle constraint, tiempo) no se aplica un punto, dejar comentario `// apple-design skill §X sugiere Y pero downgrade a Z por REASON` en el código. Sin nota, el punto se considera pendiente y se pilla en el próximo audit.

**Auditoría periódica**: cuando se implementen features nuevas con interacción gestual, correr `grep -rn "// apple-design skill" src/ index.html` para ver los downgrades acumulados y decidir si vale la pena upgrade. Cero interacciones gestuales nuevas sin al menos §1 (feedback pointerdown) + §7 (spatial consistency) + §14 (reduced motion).

**Cuándo NO usar la skill**: interacciones que no son gestuales (form validation, alerts, redirects, table sort). La skill es sobre **movimiento físico**, no sobre UI en general.

## 22. Diagnosticar App Check enforcement con `gcloud logging`, NO con `firebase functions:log` (2026-09-21)

**Regla**: cuando aparezca `callable(functions/unauthenticated): Unauthenticated` en el frontend contra alguna Cloud Function Gen 2 con `enforceAppCheck: true`, NO diagnosticar con `firebase functions:log`. Ese comando **oculta el `httpRequest.status`** y solo muestra el DEBUG "Callable request verification passed" — que es un log emitido **antes del enforcement gate** y da falso positivo.

**Por qué**: en Gen 2 el logging pipeline emite el DEBUG "verification passed" con `verifications: {auth: VALID, app: MISSING}` INCLUSO cuando el runtime va a devolver HTTP 401 por App Check enforcement. El firebase CLI oculta el status; hay que ir al `gcloud logging` para verlo.

**Comando de diagnóstico correcto**:
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=<fnname_lowercase> \
   AND severity>=WARNING AND timestamp>=\"<iso>\"" \
  --project=app-vendedores-shimano \
  --format="value(timestamp,severity,httpRequest.status)"
```

Interpretación:
- `httpRequest.status: 200` → CF ejecutó handler. Error viene del handler mismo (revisar textPayload o jsonPayload).
- `httpRequest.status: 401` → App Check enforcement REAL rechazó. Rollback `enforceAppCheck: false` o esperar Clear Site Data en cliente.
- `httpRequest.status: 429` → rate limit hit.

**Propagation delay conocido**: registrar la Web App en Firebase Console → App Check → Apps NO activa enforcement inmediato. Delay observado empíricamente **~66h** desde registration hasta que el runtime empieza a rechazar `app:MISSING`. Durante la ventana, el DEBUG log engaña — parece que el flag no funciona.

**Precedente (2026-09-21)**: pedido MARCELO BOSCHETTO no ingresaba a SAP con `callable(functions/unauthenticated)`. `firebase functions:log --only sapProxy` mostró "verification passed" todo el tiempo. Perdimos ~2h diagnosticando race de auth token, sapConfig incompleto, getIdToken race. El diagnóstico real apareció al correr `gcloud logging read --format="value(httpRequest.status)"` → todos los WARNING eran 401. v1003 hotfix: `enforceAppCheck: false` en las 3 CFs (sapProxy + updateAsigLineStateCF + geminiOcrProxy).

## 23. Rollout gradual de App Check enforcement — nunca las 3 CFs simultáneas (2026-09-21)

**Regla**: al enable `enforceAppCheck: true` en Cloud Functions de flujo crítico, hacer rollout gradual **una CF a la vez** con ventana de observación de 24-72h entre cada una. NUNCA enable las 3 CFs (sapProxy + updateAsigLineStateCF + geminiOcrProxy) simultáneas — la penalidad de un incidente afecta a 3 flows críticos a la vez (envío pedidos SAP + recycle ASIG + OCR rendiciones).

**Por qué**: dos precedentes documentados de re-enable masivo que rompieron producción:
- **v918 (2026-09-14)**: `geminiOcrProxy` primero (menos crítico). OK en shadow.
- **v990 (2026-09-18)**: extendió a sapProxy + updateAsigLineStateCF simultáneo. Combinado con el registration Console del mismo día, terminó bloqueando todo tras propagation (~66h después).

**Cómo aplicar** el próximo rollout:
1. Pre-verificar: `activateAppCheckOnce()` en bundle OK + site key correcta + Console App registered + secret configurada.
2. Deploy `enforceAppCheck: true` **solo** en `geminiOcrProxy` (rendiciones — menos crítico, no bloquea envío SAP).
3. Monitor con `gcloud logging httpRequest.status=401` en esa CF durante **1 semana**.
4. Si silencio (cero 401 en request de VDEs con reCAPTCHA activo) → repetir para `updateAsigLineStateCF`.
5. Otra semana silencio → repetir para `sapProxy`.
6. Nunca las 3 simultáneas.

## 24. Firestore field `username` (lowercase) — hacer fallback `sl.username || sl.userName` SIEMPRE (2026-09-21)

**Regla**: cuando leas el config SAP SL desde Firestore `app_config/sap_integration.serviceLayer` en Cloud Functions o scripts Python, usar el pattern **`sl.username || sl.userName`** con fallback. El doc real Firestore tiene el field como `username` (lowercase 'n'), pero muchos handlers viejos accedían solo `sl.userName` (camelCase) sin fallback.

**Por qué**: bug latente v918→v999 en `functions/index.js:446` del trigger `onPedidoConfirmedSendToSap`. Leía `userName: sl.userName || ''` (camelCase-only) sin fallback a `sl.username`. Resultado: `sapConfig.userName === ''` → validation fail → skip → **el trigger NUNCA envió pedidos automáticamente desde su creación**. Los pedidos llegaban a SAP solo porque el flow client-side `sap-auto-send-listener.js` cubría cuando había admin online. Si nadie tenía la app abierta post-confirmación, el pedido quedaba con `transferidoSAP=null` indefinidamente. Los logs Firebase mostraban `sapConfig incompleto` cada ejecución del trigger pero nadie los investigó.

**Cómo aplicar**: al escribir código nuevo que lea sapConfig, siempre usar el pattern:
```js
const sapConfig = {
  url: sl.url || '',
  companyDB: sl.companyDB || '',
  userName: sl.username || sl.userName || '',   // ← ambos, con lowercase primero
  password: SAP_SL_PASSWORD.value(),
};
```

Grep de referencia: en `functions/index.js` las líneas 150, 209, 833, 875, 961 ya tienen el pattern correcto; la 446 fue la que estaba mal. Al agregar cualquier CF nueva que lea sapConfig, revisar TODAS las lecturas con `grep -n "sl.userName\|sl.username" functions/index.js`.

## 25. Force refresh IDToken pre-callable en flow batch (2026-09-21)

**Regla**: en `src/sap-client.js:fetchWithSession` (y cualquier flow que dispare múltiples `httpsCallable` en batch), llamar `firebase.auth().currentUser.getIdToken(true)` con force=true **antes de cada callable**. El costo es ~150ms por invocación y elimina el race del SDK Firebase Auth cuando el IDToken cacheado está cerca del expiration (~1h).

**Por qué**: reporte 2026-09-21 10:36 ART: pedido MARCELO BOSCHETTO falló con `callable(functions/unauthenticated)` en el batch "Enviar via Service Layer" mientras otras callables concurrentes del mismo batch pasaban con auth VALID. Root cause: race del SDK cuando N callables se disparan concurrentes con token cerca de expirar. Alguna toma un token stale que Firebase Callable Gen 2 rechaza con `Unauthenticated` default **antes** de llegar al handler (por eso no aparece en logs sapProxy).

**Cómo aplicar** — ya está implementado en `src/sap-client.js:77-103` (v1000):
```js
try {
  const fbAny = /** @type {any} */ (firebase);
  const auth = fbAny.auth && fbAny.auth();
  if (auth && auth.currentUser && typeof auth.currentUser.getIdToken === 'function') {
    await auth.currentUser.getIdToken(true);
  }
} catch (_authErr) {
  // Non-fatal: si el refresh falla, seguimos con el token cacheado
  console.warn('[sap-client] getIdToken(true) fallo:', _authErr);
}
const callable = firebase.app().functions(region).httpsCallable(callableName);
```

Al agregar callables en flows batch a otras CFs (setupGetMovimientos, geminiOcrProxy, etc), replicar este pattern.

## 26. Stock "DISPONIBLE" en el sync SAP solo cuenta whs 11 (2026-09-21)

**Regla**: en `scripts/sync_sap_to_firestore.py`, el flag `has_stk` (que se traduce a `STOCK_MAP[sku] = true` en Firestore y al badge "DISPONIBLE" en el frontend) debe usar **`whs_breakdown.get('11', 0) > 0`**, NO el total_qty sumando todos los warehouses excepto NON_SALES_WHS.

**Por qué**: SAP tiene múltiples warehouses. La app-vendedores considera vendible SOLO el whs `11` (PESCA DISPONIBLE VENTA). Los demás son:
- `01`, `03`, `04`: consignación / proveedor externo
- `05`: MARKETING
- `06`: DEVOLUCIONES
- `07`: muestras / uso interno (no vendible)
- `12`: PESCA EN TRÁNSITO (va a estar disponible pero HOY no)
- `98`: CUARENTENA

El bug (2026-09-21) reportado por gerente ventas: SKU TRX301HGB aparecía "DISPONIBLE" en el Master de Productos pero el modal detalle decía "LIBRE PARA LA VENTA: 0 unidades". Tenía 1 unidad en whs `07`. El sync marcaba `has_stk=True` porque total_qty=1, aunque `whs['11']=0`. Impacto: 45 SKUs afectados (~13% del catálogo con stock aparente).

**Cómo aplicar**: al modificar `write_stock_snapshot` o cualquier lógica que compute stock disponible en scripts o CFs, SIEMPRE filtrar por whs 11:
```python
has_stk = whs_breakdown.get('11', 0) > 0
```

`qty_map[code] = total_qty` sigue igual (suma ALL_SALES) para no romper reportes/exports que usan la cantidad total. Solo el flag booleano `stock_map` se computa desde whs 11.

**Comment client-side de referencia**: `index.html:6105 v369+` documenta la definición correcta desde 2026-07-31. El sync tardó hasta 2026-09-21 en alinear.

## 27. Los merges pierden hotfixes de branches viejas — verificar blame después de merges masivos (2026-09-21)

**Regla**: cuando se mergean múltiples PRs seguidos (v996 + v997 + v998), verificar que **hotfixes urgentes** en archivos tocados por múltiples branches sigan aplicados. El squash merge NO re-rebasea las branches origen; si una branch fue creada pre-hotfix y no rebaseó, va a sobrescribir el hotfix cuando se mergea.

**Por qué**: precedente v996 hotfix (2026-09-18) revertía `enforceAppCheck: true → false` en 3 CFs. Después vinieron v996-MELI (#665), v997-PowerBI (#666), v998-Node22 (#667) — todos con branches creadas ANTES del hotfix y sin rebase. Al hacer squash merge, las 3 líneas del hotfix se perdieron. `git blame` post-merge mostraba que las líneas apuntaban al commit v990 (el previo al hotfix), no al hotfix. El hotfix quedó latente hasta que la propagation Console lo activó definitivamente (v1003, 2026-09-21).

**Cómo aplicar**: después de mergear múltiples PRs del mismo día que tocaron áreas críticas (functions/index.js, storage.rules, firestore.rules), correr:
```bash
git blame -L <linea>,<linea+10> <archivo>
```
en las líneas de hotfixes recientes. Si el commit shown NO es el hotfix esperado, el squash merge lo perdió — hay que re-aplicar.

**Alternativa proactiva**: cuando abras un PR sobre archivos que tuvieron hotfix reciente en main, hacer `git pull --rebase origin main` en la branch feature antes del merge para que los conflictos aparezcan explícitos (y no se pierdan silenciosos).

## 28. Firebase Callable Gen 2: skipped silent en batch handlers (2026-09-21)

**Regla**: en batch handlers que dispararan múltiples callables, si el summary UI dice "OK: 0 / Fallaron: 0" con requests que sí se dispararon, chequear si hay `skipped[]` que NO se está mostrando al usuario. `skipped` se usa para `sendingSapLock < 60s`, `transferidoSAP` ya set, y similares — casos donde el handler decidió no reintentar pero no es error.

**Por qué**: reporte 2026-09-21 10:52 ART: Mariano vio "Enviados OK: 0 / Fallaron: 0" en el modal Carga a SAP sin ninguna explicación de por qué nada se procesó. `enviarPedidosASAPViaServiceLayer` skipeaba silencioso el pedido de MARCELO BOSCHETTO porque tenía `sendingSapLock` de 21 min (< 60s window del check), pero el handler NUNCA mostraba los skipped al UI.

**Cómo aplicar**: cuando escribas o modifiques handlers batch (envío SAP, aprobar rendiciones masivas, cerrar lote, etc), incluir `skipped` en el summary:
```js
const skippedCount = (r.skipped && r.skipped.length) || 0;
let detail = 'Enviados OK: ' + r.sent + '\nFallaron: ' + r.failed;
if (skippedCount > 0) {
  detail += '\nOmitidos: ' + skippedCount;
  detail += '\n\nOmitidos (no reintentables ahora):\n' +
    r.skipped.slice(0, 5).map(e => '- ' + (e.cliente || e.pedido) + ': ' + e.motivo).join('\n');
}
```

Precedente aplicado: `src/domains/sap-admin-panel.js:830` v1001.

## 29. Skills obligatorias por tipo de trabajo (2026-10-07)

**Regla**: ciertas skills del repo oficial deben invocarse SIEMPRE según el tipo de tarea. Esto reduce rework, incidentes de silent failure, y bugs sin root cause. Historial reciente justifica: FATECHI (CF silent fail), LAMORA (pre-check fail-open), v1157→v1158 (gate restrictivo rework), v1164→v1166 (rework UX botones).

### 29.1 ANTES de implementar feature nueva → `brainstorming` (HARD-GATE)

**Cuándo aplicar**: cualquier flow nuevo (botón nuevo, modal nuevo, columna nueva en tabla, cambio de regla de negocio). NO aplica a: hotfix CSS/UX minor, bump de versión, fix de typo.

**Qué hacer**: invocar `Skill(skill="superpowers:brainstorming")`. Explorar requisitos con el user ANTES de codear. Presentar design (puede ser corto). Esperar aprobación explícita.

**Precedente**: v1164 implementé 4 botones Visita/Contactado Rápido+Clásica en el header; Mariano después pidió reorganizar a chooser modal (v1166). Si hubiera brainstormeado antes, hubiera descubierto el chooser en 1 pregunta y evitado el rework.

### 29.2 ANTES de hacer merge de PR que toque Firestore/SAP/CF → `/code-review` o `silent-failure-hunter` (agent)

**Cuándo aplicar**: PR que toque:
- Cualquier archivo en `functions/` (Cloud Functions server-side)
- Firestore writes/deletes/batch/transactions
- `src/domains/sap-*.js` o `src/sap-client.js`
- `src/domains/sap-auto-send-listener.js` o `*auto-confirm*`
- try/catch con fallback silencioso (`.catch(() => null)`, `fail-open`, etc.)

**Qué hacer**:
- Opción A (recomendada): invocar el agent `pr-review-toolkit:silent-failure-hunter` sobre el diff del PR actual. Enfocado en error handling + silent failures.
- Opción B (más completa pero más tokens): correr `/code-review` command que lanza 5 agents paralelos cross-domain.

**Precedente**: FATECHI 2026-10-06 (CF `onPedidoConfirmedSendToSap` POST timeout, SAP creó la SQ pero el CF marcó ERROR y no linkeó → 2000283 huérfana + 2000284 oficial, $7.3M extra en SAP). Si hubiera corrido silent-failure-hunter sobre v1006 (que agregó el check idempotente en el CF pero NO en el flow manual), hubiera detectado la asimetría.

### 29.3 CUANDO hay bug reportado o inconsistencia → `systematic-debugging` (skill)

**Cuándo aplicar**: cualquier reporte "esto no funciona" o "esperaba X y vi Y". NO aplica a: typo en texto, color/padding, bump de versión.

**Qué hacer**: invocar `Skill(skill="superpowers:systematic-debugging")`. Las 4 fases obligatorias:
1. Root Cause Investigation (NO fixes antes)
2. Pattern Analysis
3. Hypothesis + Testing
4. Implementation

**Precedente**: LAMORA $3.699.000 vs SAP $1.667.000. Sin systematic-debugging mi primer impulso hubiera sido fix cosmético ("muestro warning"); el root cause era que el flow automático (CF trigger) no pasaba por el pre-check cliente-side. Dependió de hacer el análisis de los 2 flows (manual vs trigger CF) para encontrar el gap.

### 29.4 INVESTIGACIÓN compleja con ≥3 preguntas independientes → `dispatching-parallel-agents`

**Cuándo aplicar**: cualquier debug que requiera buscar en ≥3 archivos/sistemas distintos (ej: Firestore + BQ + logs CF + raw files). NO aplica a: lookup único.

**Qué hacer**: invocar `Skill(skill="superpowers:dispatching-parallel-agents")`. Lanzar N `Agent` calls en una sola message (paralelo).

**Precedente**: FATECHI investigación con 3 agents (SAP source of truth + Firestore detail + code audit buildQuotationPayload). Hubiera tomado 3x más tiempo secuencial.

### 29.5 ANTES de declarar deploy "done" → `verification-before-completion`

**Cuándo aplicar**: después de `firebase deploy`, `gcloud run deploy`, o merge de PR a main. NO aplica a: commits en dev que no se mergearon todavía.

**Qué hacer**: verificar que el deploy EFECTIVAMENTE se activó (nueva revisión, logs del CF/CR, pedido test que trigger el nuevo código). No basta con "firebase deploy terminó exit 0" — a veces builda pero no activa.

**Precedente**: v1163 whatsapp-agent — primer deploy build OK pero container no arrancó (`TELEFONO_DERIVACION obligatorio en prod`). Si hubiera verificado la revision activa inmediato (`gcloud run services describe`), hubiera detectado la falla en vez de dar por hecho.

### 29.6 FEATURES grandes con 4+ archivos tocados → `writing-plans`

**Cuándo aplicar**: refactors/features que impactan ≥4 archivos o cross-domain (ej: UI + CF + Firestore + tests). NO aplica a: fix de 1 archivo.

**Qué hacer**: invocar `Skill(skill="superpowers:writing-plans")`. Guardar plan en `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. Ejecutar paso a paso.

**Precedente**: v1162 (quitar sección ASIG + gate + bypass + Fusionar del modal Pedido en espera). Toqué 4 piezas; un plan upfront hubiera formalizado el scope y evitado errores de olvidarme de alguna.

### 29.7 Checklist pre-deploy producción

Antes de `gh pr merge` a `main` o `firebase deploy` a prod:
1. ✅ `npm run test:unit` → 670/670 pass
2. ✅ `npx biome check` → clean (o `--write` para autofix)
3. ✅ `npm run typecheck` → clean (JSDoc annotations correctas)
4. ✅ Para changes grandes: `silent-failure-hunter` sobre el diff
5. ✅ Para changes grandes: lectura cross-domain (CSS clase + CF que la trigger + rules que la protegen)
6. ✅ Si tocaste `src/domains/*`: `node build.js` + commit bundle + chunks

## 30. Documentar TODO cambio con detalle Antes/Problema/Cambio/Por-que/Verificacion (2026-10-07)

**Regla fuerte**: cualquier agente que modifique codigo en este repo DEBE agregar documentacion detallada del cambio ANTES de hacer commit. No alcanza con el mensaje de commit — el commit msg es resumen, la documentacion es el contexto completo.

**Skill asociada**: `.agents/skills/documenting-changes/SKILL.md`. Invocar al inicio de cualquier sesion que modifique codigo. Formato obligatorio: `Antes` + `Problema` + `Cambio` + `Por que` + `Verificacion` + `Rollback`.

**Por que esta regla existe**:
- Precedente v469 (bug "pending fantasma"): un agente cambio `eliminarPendiente` sin saber que habia una 2da definicion que lo pisaba. El comentario de documentacion llego 2 meses tarde. Bug vivio 2 meses.
- Precedente v1058 → v1003 (rollback App Check 2026-09): tomo 3 dias de debug porque nadie documento el delay de ~66h propagation Console. Redescubrimos el precedente.
- Precedente FATECHI 2026-10-06: CF trigger tenia idempotent check desde v1006 pero el batch manual NO — nadie documento la asimetria. Fue a $$$ perdidos cuando el gap se activo.
- Un cambio no documentado es un bug latente esperando a que un futuro agente lo repita.

**Cuando aplicar**: SIEMPRE que modifiques codigo, excepto typos cosmeticos (1 char), bump de version sin logica, rebuild bundle sin src/ changes, rename cosmetico de variable local.

**Donde escribir**:
1. **Hotfix individual (1-3 archivos)**: entry nueva en `README.md §41 Changelog vigente`.
2. **Feature / refactor mediano (4-10 archivos)**: documento aparte `docs/CHANGELOG-<feature>-<fecha>.md`. Link desde README §41.
3. **Audit / review grande**: documento `docs/AUDIT_<topic>_<YYYY-MM-DD>.md` con detalle de TODOS los fixes. Link desde README §41 por cada round shippeado.
4. **Plan upfront**: `docs/plans/<YYYY-MM-DD>-<feature>-plan.md`.
5. **Spec de diseno**: `docs/specs/<YYYY-MM-DD>-<feature>-design.md`.

**Mecanica obligatoria por commit**:
1. Documentacion escrita ANTES del `git commit`.
2. Las 5-6 secciones completas (Antes, Problema, Cambio, Por que, Verificacion, Rollback).
3. Si hay precedente (bug previo, incident, feedback stakeholder) → mencionado con fecha + nombre.
4. Si hay impacto dinero → cuantificado con numeros reales.
5. Rollback instructions presentes si el cambio es sensible.
6. README §41 bumpeado con bullet rapido + link al doc extendido.

**Si falta cualquier item → NO commit. Completar primero.**

## 31. AUDITORIA != correccion -- tareas de auditoria solo producen informe/tests (2026-10-20)

**Regla fuerte**: cuando la sesion arranca con "auditoria" o "audit" explicito, los **unicos** archivos nuevos permitidos son:

1. Informe de auditoria: `docs/auditoria/*.md` o `docs/AUDIT_*.md`.
2. Tests o scripts de reproduccion: `tests/unit/audit/*.test.js`, `scripts/audit/*.{cjs,py,mjs}`.
3. Reglas durables en `CLAUDE.md` (como esta).
4. Plan de la auditoria en `docs/superpowers/plans/*.md`.

**Prohibido** durante una auditoria:
- Modificar `src/**`, `functions/**`, `index.html`, `firestore.rules`, `firebase.json`, bundles, service worker.
- Reescribir codigo "mientras documento el bug". El fix va en otra tarea, con su propio buy-in y su propio PR.
- Correr queries contra base real sin **gate humano explicito** (STOP, pedir OK a Mariano, pegar el output de `--dry-run` primero).

**Que si se puede**:
- Agregar tests que **fallan a proposito** reproduciendo el bug. Esos tests son evidencia; cuando se haga el fix, pasan a verde.
- Agregar scripts `--dry-run` que imprimen la query sin ejecutarla.
- Dejar propuestas de fix en el informe (con archivo:linea + impacto + riesgo) **sin implementarlas**.

**Si durante una auditoria encontras un bug que "es un oneliner"**: NO lo arregles. Documentalo en el informe y segui. El fix va en otra tarea para que Mariano lo revise aparte.

**Precedente**: auditoria flujo stock CRM 2026-10-20 (`docs/superpowers/plans/2026-10-20-auditoria-stock-crm.md`). El prompt original definia 7 entregables; mezclar fix y auditoria en el mismo PR enmascara que cosa es evidencia y que cosa es cambio de comportamiento.

## 32. "disp" para pedidos ex-ASIG DEBE pasar cardCode (bug H1 confirmado 2026-10-20)

**Regla fuerte**: cualquier call-site que calcule `disp` para un pedido ORIGINADO en Stock Asignado (CPST, `source='stock-asignado-batch'`, `pedidosOrigenes[]` populated) DEBE usar una formula POR CLIENTE, no `getStockRealmenteDisponible` global.

**Formula correcta** (replicada del preview CPST `_cpstRenderPreview` v1362, `index.html:16872-16898`):
```js
const r = window.getStockPorCliente(sku, cardCode);
const residual = Math.max(r.fisico - r.reservadasPorCliente - r.reservadasPorOtros, 0);
const disp = Math.min(r.fisico, r.reservadasPorCliente + residual);
```

**Por que**: la propia reserva del cliente (ASIG/confirmed activas) NO cuenta como "comprometido ajeno". Si Oeste tiene ASIG=1 y fisico=1, Oeste puede consumir esa unidad porque le pertenece — no es stock que haya que proteger contra el. La formula global `getStockRealmenteDisponible(sku)` cuenta TODAS las reservas (incluida la propia del cliente) y devuelve 0, mandando el pedido a BO + `app_only` → SAP nunca lo recibe → sintoma reportado 3u disponibles → 100% BO.

**Precedente concreto**: `doConfirmPedido getDisp` (`index.html:34720-34722`, v1208 2026-10-08) usa la formula global. Afecta a todos los pedidos ex-ASIG donde `qty <= Reservado(propio cliente)`. Fix propuesto en `docs/auditoria/06_PROPUESTAS_FIX.md > P1`.

**Donde aplicar la regla**:
- `index.html:34720` (`doConfirmPedido`) — por fix.
- `index.html:26963-26972` (`persistPendingEntry`) — mismo bug con formula v802 ("dep11 - ASIG").
- Cualquier nuevo call-site que calcule disp para pedidos con `source` heredado de un waitlist CPST.

**Como aplicar**:
1. Antes de llamar `splitPedidoLine`, verificar si el pedido es ex-ASIG. Para esto, el pedido padre heredo `source='stock-asignado-batch'` (ver v1209) o `window._pendingPedidoOrigenes` tiene elementos.
2. Si es ex-ASIG, usar la formula por cliente (arriba). Si no, el global sigue siendo correcto.
3. Agregar test en `tests/unit/audit/` que replique el escenario (fisico == reservadasPorCliente) y verifique state='confirmed'.

**Riesgo si no aplicas la regla**:
- Pedido ex-ASIG con qty exacta a la ASIG propia → 100% BO.
- Las ASIG originales se cancelan (bloque v1280) → stock queda "libre" en dep 11 pero el BO sigue vivo en app.
- Doble perdida: cliente pide, Pablo asigna, VDE confirma, SAP no recibe → el cliente queda en BO + Pablo tiene que repartir de nuevo la misma unidad.

**Ejemplo de referencia**: `docs/AUDIT_SHIMANO_2026-10-07.md` — 13 fixes documentados en 4 rounds con el formato completo. Usar como calco.

## 33. Fix de disponibilidad por cliente va SIEMPRE acotado por `source` del pedido (2026-10-20)

**Regla fuerte**: cuando el fix cambia la formula de disponibilidad para favorecer al cliente (ej. `getStockUtilizableParaClienteExAsig` que NO cuenta la reserva propia como "comprometida"), el fix DEBE aplicarse condicionalmente, solo si el pedido tiene `source='stock-asignado-batch'` o `pedidosOrigenes[]` populated. **Nunca** generalizarlo a pedidos normales.

**Por que**: la formula por cliente deja al propio cliente consumir su ASIG. Esto es correcto para pedidos CPST porque el bloque v1280 (`index.html:34881`) cancela la ASIG original despues del `pedidos.add` → la unidad pasa del pedido A al B, sin dobles reservas.

En **pedidos normales** (lista de espera manual, botón "Agregar", edit de pending no-CPST), **NO existe** ese bloque de cancelacion. Si el fix se filtrara ahi:
- El pedido normal tomaria el stock como "disponible para mi".
- La ASIG original seguiria viva.
- Resultado: la unidad quedaria dos veces comprometida (ASIG original + pedido normal nuevo). Bug H2 "reserva fantasma" fabricado por el fix.

**Donde aplicar la condicion**:
```js
const _isExAsig = window._pendingPedidoSource === 'stock-asignado-batch'
  || (Array.isArray(window._pendingPedidoOrigenes) && window._pendingPedidoOrigenes.length > 0);
// en persistPendingEntry sobre entry (ya persistido):
const _entryIsExAsig = entry.source === 'stock-asignado-batch'
  || (Array.isArray(entry.pedidosOrigenes) && entry.pedidosOrigenes.length > 0);
```

**Donde NO aplicar la condicion**:
- Cualquier flow que NO cancele la ASIG propia tras crear el pedido nuevo.
- Pedidos "Generar Backorder" / cargas Excel / etc. — si no hay `source` CPST, es pedido normal.

**Precedente**: fix H1 (`fix-stock-cardcode-h1` 2026-10-20). Diseño confirmado por Mariano explicitamente en el prompt que origino la tarea.

**Test T1 (`tests/unit/audit/fix-h1.test.js`)**: verifica que un pedido normal con ASIG propia NO se filtra al fix (sigue BO). Si T1 falla, el fix se generalizo a pedidos normales — bug H2.

## 34. BO reserva stock por diseño; el reparto convierte BO en ASIG, no crea la reserva (2026-10-20)

**⚠️ REEMPLAZADA POR §40 (2026-10-21, v1392)**. Mantener texto por histórico; la regla vigente es §40 (BO NO reserva).

**Regla fuerte** (histórica, invalidada): `lineReservesStock(line, nowMs, pedido)` devuelve `true` para `state='BO'` dentro del TTL (7d). Esto es **por diseño**, no un bug. **No cambiarlo** sin autorización explícita de Mariano, y recién después de construir alternativa.

**Por que**:
- Entre que entra stock en dep 11 y Pablo abre modal Reparto puede pasar horas o días (Pablo puede estar fuera, con muchos ingresos acumulados, o simplemente no ser prioridad en el día).
- Si BO dejara de reservar, otros clientes podrían cargar pedidos normales que lleven el stock físico recién ingresado antes de que Pablo lo asigne al cliente que lo pidió en BO.
- Esto violaría O1 ("proteger stock con dueño") — la unidad "tiene dueño" desde que el cliente la pidió, no desde que Pablo la reparte.

**El reparto NO crea la reserva. La convierte**:
- BO (reserva genérica cliente-SKU) → ASIG (reserva nominada cliente-SKU con `asigAt` + `asigFromReparto` opcional).
- La diferencia es semántica: BO es "cliente la pidió sin stock", ASIG es "stock físico ya reservado para el cliente".
- Para efectos de `getStockRealmenteDisponible`, ambos cuentan igual.

**Donde NO cambiar sin OK Mariano**:
- `src/pure/stock-realmente-disponible.js:146-202` (`lineReservesStock`): la rama `state === 'BO'` debe seguir retornando `true` dentro del TTL.
- `functions/core/pedido-snapshot-core.js:91-136` (copia inline): idem.
- `functions/core/reparto-core.js:582-612` (`applyRepartoManualCore`): la mutación `state='BO' → state='ASIG'` no crea reserva nueva, solo renombra la existente.

**Precedente**: decisión D1 de Mariano 2026-10-20 (gate humano post-fix H1). Analizados los 11 pasos end-to-end con las 2 semánticas — mantener BO como reserva protege la ventana PASO 5 (ingreso→reparto) sin construir nada nuevo. Ver `docs/auditoria/09_DECISIONES_PENDIENTES.md > D1`.

**Si en el futuro se decide quitar la reserva de BO**:
- Debe venir con panel admin "Reparto urgente" + alertas al admin cuando ingresa stock con BO pendiente.
- Debe venir con bloqueo transitorio UX (ej. SKU "en reparto" por N minutos post-ingreso).
- Es feature grande, no un oneliner. No lo arregles como "mejora menor".

## 35. Fórmula de disponibilidad se decide POR LÍNEA leyendo `line.origen` (2026-10-20)

**Regla fuerte** (refina §33): el call-site del split (`doConfirmPedido`, `persistPendingEntry`) decide la fórmula de `disp` POR LÍNEA, no por documento. El flag es `line.origen === 'stock-asignado'`:

- Si `line.origen === 'stock-asignado'` → fórmula POR CLIENTE (`getStockUtilizableParaClienteExAsig(sku, cardCode)`).
- Si no → fórmula GLOBAL (`getStockRealmenteDisponible(sku)`).

**Por qué refina §33 sin violarla**: §33 dice "sólo pedidos ex-ASIG usan fórmula por cliente, acotados por `source` del documento". §35 dice "sólo líneas con `origen='stock-asignado'`, acotadas por el flag de la propia línea". Es MÁS PRECISO que `source` porque:

1. **Órdenes unificadas mixtas**: una orden normal puede absorber un CPST via "Unificar orden". El documento resultante NO tiene `source='stock-asignado-batch'` (es normal), pero algunas de sus líneas sí vienen de un ASIG original. §33 (por documento) hubiera dejado esas líneas en fórmula global → bug H1 reaparece. §35 (por línea) las detecta correctamente.

2. **Compat con pedidos normales**: una línea sin `origen` sigue usando fórmula global, exactamente como §33. No se filtra el fix.

**Shape nuevo** (persistido en Firestore):

```js
line = {
  code, qty, qtyOpen, state, ...,
  origen: 'stock-asignado',  // flag discriminador (undefined para líneas normales)
  asigRefs: [{                // refs a la(s) ASIG(s) que respaldan esta línea
    pedidoId: 'xxx',
    lineIndex: N,
    qtyAsignada: K,
    sku: '...',
  }]
}
```

El `pedidosOrigenes[]` del CPST original tiene shape `{pedidoId, lineIndex, sku, qtyAsignada}` y se mapea 1-a-N a `asigRefs` por línea via `buildAsigRefsForLine(sku, pedidosOrigenes)` (helper puro en `src/pure/unificar-ordenes.js`).

**Dónde aplicar la regla**:
- `index.html:34720` (`doConfirmPedido.getDisp`): decide por línea.
- `index.html:26963` (`persistPendingEntry.getDisp`): decide por línea.
- `index.html:34881+` (bloque v1280 cancelación ASIG): recolecta `_origenesACancelar` desde `window._pendingPedidoOrigenes` (compat) ∪ `docData.lines[].asigRefs` (nuevo) con dedupe por `(pedidoId, lineIndex)`.

**Dónde seteamos `origen` + `asigRefs`**:
- `_cpstConfirmar` (`index.html:17398+`): cada item del waitlist CPST raíz lleva `origen='stock-asignado'` + `asigRefs`.
- `mergeLinesFromOrders` (`src/pure/unificar-ordenes.js:76+`): líneas importadas desde un CPST absorbido reciben `origen` + `asigRefs` matcheando por SKU.
- `_waitlistPasarAPendientesContinuar` (`index.html:25481+`): propaga `origen`, `asigRefs`, `importedFromOrder` del waitlist a `finalItems[]`.
- `splitPedidoLine` (`src/pure/pedido-split.js:72+`): propaga en `base` → cada línea output.
- `reenrichPedidoLine` (`src/pure/pedido-split.js:181`): preserva via `Object.assign` sobre `existingLine`.

**Riesgo si se olvida la condicional de línea**:
- Si el fix usa `line.origen` para decidir pero el shape NO se persiste correctamente desde el waitlist → regresión H1 (línea CPST pierde origen al llegar a `pedido.lines[]`).
- Si el fix no acota por línea (solo mira documento) → regresión H1 en órdenes unificadas (P2 del plan v1382).

**Precedente**: `feat-unificar-lineas-asig` 2026-10-20 (`docs/superpowers/plans/`...). Tests de regresión en `tests/unit/audit/unificar-cpst-regression.test.js` (T0-P2+P3, T2-T6). Si fallan post-refactor, el fix se filtró a pedidos normales o perdió la identidad por línea.

## 36. `lineReservesStock('confirmed')` sin fecha de referencia = NO reserva (data corrupta, 2026-10-21)

**Regla fuerte**: una línea `state='confirmed'` sin `pedido.confirmedAt` NO reserva stock. Antes de v1384 (comportamiento "backwards-compat pre-v963") devolvía `true` como fallback. Nuevo comportamiento: **sin fecha = data corrupta = no reserva**.

**Fix v1384** (`src/pure/stock-realmente-disponible.js:163-180` + `functions/core/pedido-snapshot-core.js:109-121`):
```js
if (state === 'confirmed') {
  if (line.asigReserva === false || line.asigReserva === 0) return false;
  // Guard defensivo v1384:
  if (!pedido || !pedido.confirmedAt) return false;
  const confirmedAtMs = toMillisSafe(pedido.confirmedAt);
  if (confirmedAtMs === null) return false;
  return (now - confirmedAtMs) / DAY_MS <= RESERVA_TTL_DAYS;
}
```

**Por qué**: el fallback viejo "sin fecha = reserva siempre" era un leak defensivo (originalmente para compat con pedidos pre-v963 que no tenían `confirmedAt`). En prod (2026-10-21) el bucket `confirmed_sin_fecha` tiene **0 unidades** verificado con grep sobre 542 SKUs — ya no hace falta la compat.

**Impacto en prod al deploy v1384**: 0 unidades liberadas (confirmación empírica). El fix es puramente defensivo:
1. Invariante de código: una línea indatable no debería tener efecto sobre el stock.
2. Red de seguridad: si entra data corrupta por un bug futuro, el stock no queda bloqueado "para siempre".
3. Tests limpios: un test unitario que crea una línea sin pedido ahora refleja correctamente que no debe reservar.

**Dónde actualizar al hacer el cambio**:
- `tests/unit/stock-realmente-disponible.test.js`: el helper `P({...})` ahora debe setear `confirmedAt: new Date().toISOString()` por default. Tests que querían el bucket "sin fecha" lo pasan explícitamente.
- `tests/unit/stock-por-cliente-memo.test.js`: `makePedidos()` incluye `confirmedAt` reciente.
- Cualquier test que llame `lineReservesStock(line, now)` sin 3er arg para state='confirmed' ahora devuelve `false` (antes era `true`).

**Precedente**: `fix-ttl-reservas-y-reparto` 2026-10-21 (`docs/auditoria/14_RESERVAS_VENCIDAS.md`). El reporte original de Cowork atribuía reservas fantasma al bucket "sin confirmedAt" sobre CUDC201HG, pero verificación directa contra Firestore mostró que **ninguna** de las 6 líneas confirmed caía en ese bucket (todas tenían `confirmedAt` presente). El guard es defensivo contra data que no existe hoy.

## 37. BO reserva stock sin TTL de 7 días (red de seguridad 90 días, 2026-10-21)

**Regla fuerte**: `lineReservesStock('BO')` devuelve `true` para cualquier BO con `pedido.createdAt` dentro de los últimos **90 días**. No usa el TTL soft de 7 días que aplica a ASIG y confirmed. BO con `createdAt > 90d` deja de reservar (red de seguridad para no acumular BOs olvidados indefinidamente).

**Por qué**:
- Un BO es demanda legitima que aún no tiene stock. Si el stock llega a los 10, 20 o 60 días, hay que respetarle la unidad al cliente que ya la pidió (via reparto).
- v969 (2026-09-17) bajó el TTL BO a 15d y v1198 (2026-10-08) a 7d. Resultado: SKUs con BO + físico quedaban sin reparto porque los BO expiraban antes de llegar la mercadería. Reporte Mariano 2026-10-21: "el back order no vence".
- La red de 90d existe para que un BO olvidado por 3+ meses no quede bloqueando stock para siempre (admin lo puede revisar aparte).

**Código** (`src/pure/stock-realmente-disponible.js:146-162` + copia `functions/core/pedido-snapshot-core.js:96-108`):
```js
const BO_TTL_DAYS = 90;
// ...
if (state === "BO") {
  if (pedido && pedido.createdAt) {
    const createdAtMs = toMillisSafe(pedido.createdAt);
    if (createdAtMs !== null) {
      const now = typeof nowMs === "number" ? nowMs : Date.now();
      const ageDays = (now - createdAtMs) / DAY_MS;
      if (ageDays > BO_TTL_DAYS) return false;
    }
  }
  return true;
}
```

**Impacto reconciliación** (`functions/core/reparto-core.js:reconcileRepartosFaltantes`): usa `lineReservesStock` directamente, por lo que **automáticamente** toma BO de 30, 60, 89 días como válido y crea reparto si hay físico libre. Precedente v1388: destrabamos 13 SKUs con BO 15-80 días que antes del fix quedaban sin reparto porque el reconcile los filtraba por TTL 7d.

**ASIG no cambia**: `asigAt > 7d` sigue liberando stock. Rationale: una ASIG asignada por Pablo que el VDE no confirma en 7d indica abandono, no espera.

**Precedente**: `feat-bo-sin-ttl-conf-hard-cap` 2026-10-21 (v1388). Tests `tests/unit/audit/bo-sin-ttl-7d.test.js` cubren los 3 escenarios críticos (BO 30d reserva, BO 91d no reserva, ASIG 30d no reserva).

**Precaución**: antes de bajar o eliminar `BO_TTL_DAYS = 90`, revisar que no quedan BOs legacy pre-reparto con `createdAt` muy viejo que queden latentes.

## 38. confirmed tiene TTL soft 7 días y hard cap 60 días (red de seguridad, 2026-10-21)

**Regla fuerte**: una línea con `state='confirmed'` deja de reservar stock cuando `pedido.confirmedAt` superó los **7 días** (TTL soft) **o** los **60 días** desde confirmedAt como hard cap (incluso si en el futuro se sube el TTL soft).

**Por qué**:
- v1198 (2026-10-08) bajó el TTL confirmed a 7d. Si Santi (o el flujo automático SAP) no factura en 7d, el stock se libera.
- Red de 60d: si en el futuro alguien sube `RESERVA_TTL_DAYS` (ej. 30d, 45d), 60d sigue siendo el techo duro. Una SQ que SAP tarda 60+ días en facturar es casi seguramente un olvido administrativo, no una venta en curso.

**Código** (`src/pure/stock-realmente-disponible.js:163-193` + copia `functions/core/pedido-snapshot-core.js:109-128`):
```js
const RESERVA_TTL_DAYS = 7;
const CONFIRMED_HARD_CAP_DAYS = 60;
// ...
if (state === "confirmed") {
  if (line.asigReserva === false || line.asigReserva === 0) return false;
  if (!pedido || !pedido.confirmedAt) return false; // regla §36
  const confirmedAtMs = toMillisSafe(pedido.confirmedAt);
  if (confirmedAtMs === null) return false;
  const ageDays = (now - confirmedAtMs) / DAY_MS;
  if (ageDays > RESERVA_TTL_DAYS) return false;
  if (ageDays > CONFIRMED_HARD_CAP_DAYS) return false;
  return true;
}
```

**Nota**: hoy `RESERVA_TTL_DAYS (7) < CONFIRMED_HARD_CAP_DAYS (60)` entonces el primer `if` corta todo. El segundo `if` es defensivo para el día que el TTL soft suba.

**Precedente**: `feat-bo-sin-ttl-conf-hard-cap` 2026-10-21 (v1388). Decisión D4 Mariano. Tests `tests/unit/audit/bo-sin-ttl-7d.test.js` cubren los 3 escenarios: confirmed 3d reserva, confirmed 30d no reserva (soft), confirmed 61d no reserva (hard cap).

## 39. Toda disponibilidad de stock pasa por getStockBreakdown (FINDING-04, 2026-10-21)

**Regla fuerte**: ninguna pantalla, modal, badge, tooltip o CF calcula disponibilidad / reservadas / libre / pendientes de reparto por su cuenta. Toda lectura pasa por `getStockBreakdown(sku, deps, opts)` de `src/pure/stock-breakdown.js` (o copia espejo en `functions/core/pedido-snapshot-core.js`).

**API**:
```js
getStockBreakdown(sku, deps, opts) -> {
  sku, fisicoDep11, transitoDep12,
  demandaSapSinCubrir,     // opt-in con opts.includeStale=true
  backorderApp,            // {total, porCliente} con TTL §37
  confirmadasSinFacturar,  // con TTL §38 soft 7d + hard cap 60d
  asignadas,               // con TTL 7d
  waitlistCpst,            // revision_waitlist source stock-asignado-batch
  reservadasTotal, libre,
  utilizablePara(cardCode),  // formula §33/§35
  pendienteReparto: {qty, repartoId},
  _version: 1,
}
```

**TTL centralizado**: reusa `lineReservesStock()`. No reimplementar reglas de vencimiento fuera.

**Wrappers vivos** (compat con shape viejo):
- `getStockRealmenteDisponible(sku) -> breakdown.libre`
- `getStockDesglose(sku) -> {fisico, comprometido, real, breakdown}`
- `getStockPorCliente(sku, cardCode) -> {reservadasPorCliente, reservadasPorOtros, ...}`
- `getStockUtilizableParaClienteExAsig(sku, cardCode) -> breakdown.utilizablePara(cardCode)`

Son de 2-20 lineas y delegan al breakdown. **NO reimplementar logica dentro** — si necesitas un campo nuevo, agregarlo al breakdown primero.

**reconcileRepartosFaltantes** (CF) tambien usa `breakdown.pendienteReparto.qty` como autoridad. Test `tests/functions/reconcile-breakdown-sync.test.js` falla si divergen de breakdown.

**Si necesitas un bucket nuevo** (ej. "en cuarentena"):
1. Agregarlo a `getStockBreakdown` + a la copia espejo.
2. Actualizar schema check en `tests/unit/stock-breakdown.test.js` (test "schema shape fijo").
3. Actualizar `tests/unit/audit/stock-breakdown-sync.test.js` (conceptos).
4. Agregarlo a `STOCK_LABELS`.
5. Actualizar wrappers si corresponde.

**Labels de UI**: usar `STOCK_LABELS` (export) para que todas las pantallas digan lo mismo. Fuente unica.

**Precedente**: `feat-stock-breakdown-unico` 2026-10-21 (v1391). FINDING-04 auditoria 20/10: el mismo SKU mostraba 5 numeros distintos en 5 pantallas (26, 11, 17, 0, 1 u para CUDC201HG). Loop E0-E5 (`docs/auditoria/17_CINCO_NUMEROS_CUDC201HG.md`, `18_VERIFICACION_V1391_BREAKDOWN.md`, `19_INFORME_COWORK_V1391.md`). 41 tests nuevos.

## 40. BO no reserva stock. Reservan ASIG + confirmed + reparto abierto (2026-10-21, reemplaza §34)

**Regla fuerte**: el back order (`state=’BO’`) ES una cola de clientes esperando reparto + base de forecast. **No reserva stock.**

Reservan stock SOLO:
- Asignaciones (`state=’ASIG’`) con TTL 7d.
- Confirmadas sin facturar (`state=’confirmed’`) con TTL soft 7d + hard 60d.
- Waitlist CPST (`source=’stock-asignado-batch’`).

**Reparto abierto** (`ingresos_reparto` con `status in [pending, in_progress]`) es un bucket INFORMATIVO en el breakdown (campo `repartoAbierto: {qty, repartoId, status}`). NO suma a `reservadasTotal`. Es solo una señal visual: "Pablo tiene algo que atender".

`lineReservesStock(’BO’)` devuelve false. El TTL §37 90d se mantiene para el bucket `backorderApp` del breakdown (cola + forecast) pero NO para reservas.

**Cuando Pablo cierra un reparto con sobrante** (botón "Cerrar reparto"): lo asignado pasa a ASIG, lo no asignado queda libre por construcción (el bucket repartoAbierto desaparece). `applyRepartoManualCF` acepta `allowSobrante=true` + `assignments=[] + eliminations=[]` y marca `status=’done’` con `closedReason=’admin_cerrado_con_sobrante_<N>_libres’`.

**reconcileRepartosFaltantes** crea reparto con `qty = min(fisico - asig - conf, BO_vigente)`. Si un reparto abierto tiene qty > BO vigente actual, reconcile lo ajusta sin tocar las assignments ya aplicadas. Fix v1392: antes de §40 podía repartir 6 unidades entre pedidos de BO 2 — ya no.

**applyRepartoManualCore** valida contra `stockFisicoDep11` del momento. Si otro VDE vendió entre que Pablo abrió el modal y aplicó, el cap rechaza con mensaje claro.

**Shape v2 getStockBreakdown**:
```js
{
  sku, fisicoDep11, transitoDep12,
  backorderApp,            // cola + forecast (TTL §37 90d). NO reserva.
  confirmadasSinFacturar,  // reserva (TTL §38).
  asignadas,               // reserva (TTL 7d).
  waitlistCpst,            // reserva (sin TTL).
  repartoAbierto: {qty, repartoId, status},  // INFORMATIVO, NO reserva.
  reservadasTotal,         // = asignadas + confirmed + waitlistCpst (SIN BO, SIN reparto).
  libre,                   // = max(0, fisicoDep11 - reservadasTotal).
  utilizablePara,          // libre + reservas propias (ASIG+conf+CPST del cliente; NO BO).
  pendienteReparto,        // alias compat de repartoAbierto.
  _version: 2,
}
```

**Caso emblemático CUDC201HG** (21/10 14:11): antes libre 4 con reparto abierto (bug: cualquiera lleva las 4 mientras Pablo decide). Después §40: libre 6 hasta que Pablo cierre. Reparto NO protege — el stock físico queda disponible hasta que Pablo asigne o cierre. Pablo decide rápido para no perder la asignación a clientes BO priorizados.

**Efecto en prod @ merge v1392** (`docs/auditoria/21_EFECTO_BO_NO_RESERVA.md`): 37 SKUs / 289 unidades pasaron a libre. Todos con reparto abierto activo. Mariano aprobó el merge sabiendo este trade-off.

**Precedente**: `feat-reserva-por-reparto` 2026-10-21 (v1392 ✓ bc9a451 ➔ 908a615). CF deploys: applyRepartoManualCF + onDep11IncreaseCreateReparto ambos 15:42 UTC.

**Qué cambia para los consumidores del breakdown**:
- Call-sites que miran `reservadasTotal` ven el bajar los números (BO ya no cuenta).
- Call-sites que muestran `backorderApp.total` ven lo mismo (cola legible).
- `pendienteReparto` queda como alias de `repartoAbierto` (compat v1391).
- `demandaSapSinCubrir` ahora siempre null (DEPRECATED, eliminar en v1393).

### §40.1 (2026-10-21, v1393): waitlistCpst NO reserva (es draft VDE)

Extensión de §40. El bucket `waitlistCpst` del breakdown queda **informativo** (visible en `getStockBreakdown` pero NO suma a `reservadasTotal`).

**Por qué**: un `revision_waitlist` con `source=’stock-asignado-batch’` es un **draft** del VDE preparando un pedido desde Stock Asignado. La ASIG original (pedido padre) ya reserva su stock. Hasta que el VDE apreta "Confirmar", el waitlist no genera un pedido real. Contar waitlist como reserva además de la ASIG = **doble conteo**.

**Precedente**: BENGOCHEA 597151 ORDEN 467 (2026-10-21). Tenía ASIG qty=6 + waitlist `GYQRCgyXyOJttrQyNsru` qty=6 del MISMO cliente para el MISMO SKU. Breakdown v1392 contaba 12 u reservadas con físico 2. VDE veía "reservadas 16" en la Lista de Espera por SKU 597151 (6 asig + 10 wlCpst totales).

**Código** (`src/pure/stock-breakdown.js` + mirror):
```js
const reservadasTotal = confirmadasSinFacturar.total + asignadas.total;
```
NO más `+ waitlistCpst.total`. `utilizablePara` tampoco cuenta waitlist propia.

**Shape**: `waitlistCpst` sigue en el breakdown como bucket informativo para tooltips/debug. `_version` 2 → 3.

**Efecto en prod @ merge v1393** (`docs/auditoria/27_EFECTO_WAITLIST_NO_RESERVA.md`): 31 SKUs / 139 u pasaron a libre. Caso 597151 BENGOCHEA: delta real libre = 0 (clamp por fisico=2), pero la UX visible pasó de "reservadas 16" a "reservadas 6" (sin doble conteo).

**Caso borde**: si existe un waitlist "huérfano" (sin ASIG viva de respaldo), tampoco reserva. Es coherente con §40.1: waitlist es draft, nunca reserva por sí mismo.

### §40.2 (2026-10-21, v1394): reservadasTotal cap por físico (sobre-reserva no es entregable)

Extensión de §40. `reservadasTotal` muestra lo **entregable hoy**, no la reserva nominal cuando excede el físico.

**Fórmula** (`src/pure/stock-breakdown.js` + mirror):
```js
const reservasNominales = confirmadasSinFacturar.total + asignadas.total;
const reservadasTotal = Math.min(reservasNominales, fisicoDep11);
const libre = Math.max(0, fisicoDep11 - reservadasTotal);
```

**Por qué**: una ASIG nominal de 6u sobre un físico de 2u es un sobre-asignado administrativo (Pablo repartió más de lo que tenía; o el físico bajó post-ASIG). La columna "Reservado" debe mostrar **2** (lo que se puede entregar), no **6** (la promesa nominal).

- Los buckets individuales (`asignadas.total`, `confirmadasSinFacturar.total`) **siguen siendo los nominales** para auditoría/debug.
- Sólo `reservadasTotal` + `libre` aplican el cap.
- `utilizablePara(cardCode)` ya respeta esto por construcción (`min(fisicoDep11, libre + reservasPropias)`).

**Precedente concreto**: BENGOCHEA 597151 (2026-10-21). ASIG qty=6, fisicoDep11=2. v1393 mostraba "Reservado 6 / Libre 0" (y la columna confundía — "si están reservadas 6, ¿dónde están?"). v1394 muestra "Reservado 2 / Libre 0" — refleja la realidad entregable.

**Shape**: `_version` 3 → 4. Mismo shape (sin campos nuevos).

**Efecto en prod @ merge v1394**: cero unidades liberadas (es cambio de **representación**, no de reglas de reserva). Solo cambia lo que se muestra en Reservado — útiles para el VDE que ve números más honestos.

### §40.3 (2026-10-21, v1395): sobre-asignadas como estado nombrado + FIFO por `asigAt`

Extensión de §40.2 para propagar la noción de **sobre-asignación** más allá del total agregado — a cada línea individual.

**Shape nuevo** de `asignadas` en `getStockBreakdown`:

```js
asignadas: {
  total: 6,                      // nominal (sin cambio — compat)
  totalEntregable: 2,            // nuevo: suma qtyEntregable FIFO
  totalSobreAsignada: 4,         // nuevo: nominal - entregable
  porCliente: [...],             // existente (nominal)
  detalle: [                     // nuevo: FIFO por asigAt ASC
    { pedidoId, lineIndex, cardCode, clientName, asigAt,
      qtyNominal: 6, qtyEntregable: 2, sobreAsignada: 4 }
  ],
}
```

**Algoritmo FIFO**:
1. `confirmadasSinFacturar` consume físico primero (FIFO por `confirmedAt` ASC).
2. ASIG consume el restante (FIFO por `asigAt` ASC — nulos al final).
3. Para cada ASIG: `qtyEntregable = min(qtyNominal, físicoRestante)`, `sobreAsignada = qtyNominal - qtyEntregable`.

**`_version` 4 → 5**.

**Es computed, no persiste**. Si entra stock que cubre el nominal, `sobreAsignada` vuelve a 0 al próximo read. **Nunca** guardar en Firestore — eso crearía divergencia con el físico actual.

**Reconciliación** (`scanSobreAsignadas` en `functions/core/reparto-core.js`): recorre pedidos abiertos + stock snapshot, computa el breakdown por SKU, loguea en Cloud Logging cada línea con `sobreAsignada > 0`. Corre inline en `onDep11IncreaseCreateReparto`. NO recorta nada automático — es diagnóstico.

**UI Stock Asignado**: en el modal matricial, cada fila cliente ASIG con sobre-asignada muestra badge amarillo "prometidas N" bajo el número principal. El label del número principal pasa de "unid" a "entregables" solo cuando hay sobre-asignación.

**CPST** (`Crear Pedido Desde Stock Asignado`): el preview ya aplica `qtyAjustada = min(sk.qty, disp)` desde v1198, y `_cpstConfirmar` usa `qtyAjustada` para armar el waitlist. Las unidades recortadas quedan ASIG vivas en el pedido original (bloque v1280). No requiere cambio adicional en v1395 — el flow ya respeta "arma el pedido con las entregables".

**Script audit**: `scripts/audit/J_sobre_asignadas_prod.cjs` genera tabla en `docs/auditoria/29_SOBRE_ASIGNADAS_PROD.md`. Correr cuando Pablo quiera revisar backlog de sobre-asignaciones y decidir recortes manuales.

**Caso emblemático BENGOCHEA 597151** (2026-10-21): ASIG qty=6 / físico=2.
- Breakdown v1395: `asignadas.detalle[0] = { qtyNominal: 6, qtyEntregable: 2, sobreAsignada: 4 }`.
- Modal Stock Asignado: "2 entregables / prometidas 6" (badge amarillo).
- Si Pablo recorta 4u con el botón `[−]`, la línea vuelve a `qtyOpen=2` y la sobre-asignada desaparece.
- Si entra stock y físico sube a 6, el próximo read del breakdown devuelve `sobreAsignada=0` sin acción manual.

**Precedente**: `feat-sobre-asignadas` 2026-10-21 (v1395). Tests `tests/unit/audit/asignadas-fifo.test.js` + `tests/functions/scan-sobre-asignadas.test.js` cubren los 3 casos pedidos (T1 nominal == físico, T2 nominal > físico, T3 entra stock que limpia solo) + FIFO con 2 ASIGs + ASIG sin asigAt.

### §40.4 (2026-10-21, v1396): cards STOCK ASIG tienen UN SOLO background en todos los estados

Regla fuerte: una card `.slft-wl-item.source-cpst` (badge "STOCK ASIG") tiene **un único color de fondo (`#fdba74` naranja) en todos los estados** — con/sin `has-exceed`, con/sin `:hover`, con cualquier badge de vencimiento. La señal de excedente va EXCLUSIVAMENTE en el `border-left-color` rojo. No se permiten reglas CSS adicionales que seteen un `background` distinto sobre `.source-cpst[.X]`.

**Por qué**: pre-v1396 el bug era visible como flicker 3-4s al abrir la app. `_hasExceedPure` depende del snapshot stock + `globalPedidos`. Antes de que llegara el snapshot (fisico=0, pedidos=[]), TODAS las cards con qty>0 marcaban excedente spurio → clase `has-exceed`. Al llegar el snapshot real a los 3-4s, muchas perdían `has-exceed` → caían al bucket base `.source-cpst`. `styles/apple-design.css` tenía 2 reglas distintas:

```css
.slft-wl-item.source-cpst { background: #fde68a; }         /* amarillo */
.slft-wl-item.source-cpst.has-exceed { background: #fdba74; }  /* naranja */
```

El flicker visible era el cambio de background entre renders, no de la clase `source-cpst` per se. Mariano reporte 2026-10-21 13:50: cards 479-484 "amarillas" (sin has-exceed → `#fde68a`), 472 "naranja" (con has-exceed real → `#fdba74`).

**Fix v1396** (`styles/apple-design.css:1979-...`):

```css
.slft-wl-item.source-cpst,
.slft-wl-item.source-cpst:hover,
.slft-wl-item.source-cpst.has-exceed,
.slft-wl-item.source-cpst.has-exceed:hover {
  background: #fdba74 !important;
  color: #78350f !important;
  border: 2px solid #f59e0b !important;
  border-left: 6px solid #d97706 !important;
}
.slft-wl-item.source-cpst.has-exceed,
.slft-wl-item.source-cpst.has-exceed:hover {
  border-left-color: #ff3b30 !important;  /* has-exceed solo cambia el color del borde */
}
```

El `background` NO depende de `has-exceed`. El re-render al llegar el snapshot no cambia el color de fondo — solo transiciona el `border-left-color` entre naranja (sin exceso) y rojo (con exceso).

**Fallback source-cpst** (`src/pure/wl-sidebar-classes.js`): `isWaitlistCpst(w)` devuelve `true` también si `pedidosOrigenes[]` está populated — por si el cache local trae un snapshot stale sin el campo `source`. Idempotente: mismo input → mismo output en cualquier render.

**Tests** (dos niveles):
- `tests/unit/wl-sidebar-classes.test.js`: función pura `computeWaitlistCardClasses(w, hasExceed)`. Valida idempotencia: con stock vacío (hasExceed=true) vs stock cargado (hasExceed=false), la clase `source-cpst` NO cambia. Solo `has-exceed` lo hace.
- `tests/unit/audit/wl-sidebar-css-parity.test.js`: parsea `styles/apple-design.css` + `<style>` del `index.html`, encuentra TODAS las reglas que matchean `.slft-wl-item.source-cpst[.X]`, extrae `background`, y falla si hay más de un valor único. Protección contra regresión futura.

**Precedente**: `feat-cards-stock-asig-color-plus-export-pablo` 2026-10-21 (v1396). Reporte Mariano: "al abrir la app todas las cards STOCK ASIG se veían naranja y a los 3-4s algunas pasaban a amarillo". Hipótesis Mariano exacta: "mi lectura es que el fondo depende de has-exceed, que se calcula recién cuando llega el snapshot de stock".

### §40.5 (2026-10-21, v1397): ASIG sin respaldo físico vuelve a BO al pasar por CPST

Regla fuerte: **una asignación solo existe con respaldo físico. Sin respaldo, es cola (BO).**

Cuando el VDE confirma "Crear Pedido Desde Stock Asignado" y el stock físico libre para el cliente HOY no alcanza para cubrir el nominal, las unidades no entregables **no quedan como ASIG viva**. Vuelven al estado `BO` del pedido original con audit (`asigRevertidaAt`, `asigRevertidaBy`, `asigRevertidaReason='asig_sin_stock_revertida_a_bo'`). El SKU entra en la reconciliación normal y aparece en Reparto para que Pablo reasigne cuando ingrese mercadería.

**Comportamiento al confirmar CPST**:
- Entregables (`sk.qtyAjustada > 0`): van al pedido en lista de espera como hoy.
- Recortadas (`sk.qtyRecorte > 0`): split o revert_full en el pedido original:
  - `revert_full`: línea entera `state=ASIG → state=BO` + audit.
  - `split` (recorte parcial): línea original queda ASIG con `qty=qtyKeep`, nueva línea BO con `qty=qtyRevert` + audit + `splitFromLineIndex`.
- Si **todas** las qtyAjustada son 0: botón NO crea pedido vacío. Muestra "No hay unidades entregables; N unidades vuelven a back order" y hace solo la reversión.
- **Idempotencia**: segundo pase sobre una línea ya en `state='BO'` con `asigRevertidaReason='asig_sin_stock_revertida_a_bo'` NO la toca.

**Reconciliación normal**: al volver a BO, el bucket `backorderApp` del `getStockBreakdown` ve la línea y la cuenta en `porCliente`. Cuando el físico > 0 entra en reparto automáticamente (`reconcileRepartosFaltantes`). **No se crea reparto si no hay físico** — es simetría con §40 (reparto solo cuando hay stock que distribuir).

**Flag `sobreAsignada` del plan v1395 §40.3** sigue existiendo PERO queda **informativo**:
- Mientras nadie pase por CPST para el cliente afectado, el breakdown reporta `sobreAsignada > 0` en `asignadas.detalle[]`. Útil para que Pablo vea el gap desde el modal Stock Asignado (ya tiene el badge "prometidas N / entregables M").
- En cuanto el VDE pasa por CPST, la sobre-asignación se resuelve: las unidades sin respaldo pasan a BO → el bucket `asignadas` del SKU/cliente baja → `sobreAsignada` ya es 0.
- Si Pablo quiere resolver manual sin esperar al VDE, puede usar el botón `[−]` de la fila para recortar la ASIG.
- No se elimina (lo mantuvimos por utilidad diagnóstica), pero se puede dropear en el futuro si queda sin consumo.

**Modal confirm**: texto actualizado. Ya no dice "quedan ASIG tildadas reservadas para cuando haya más stock" (comportamiento viejo pre-v1397). Dice "N unidades vuelven a back order (sin stock físico hoy); el SKU va a aparecer en Reparto cuando ingrese mercadería".

**Código**:
- Pure: `src/pure/cpst-revert-plan.js` → `computeCpstRevertPlan(entries, qtyAjustadaTotal)` devuelve plan por entry con action `keep | split | revert_full`.
- Inline: `index.html` `_cpstConfirmar` arma el batch Firestore: aplica reversiones + (si hay entregables) crea waitlist. `batch.commit()` atómico.

**Tests**:
- `tests/unit/cpst-revert-plan.test.js` (10): T1-T3 pedidos Mariano + edge cases + casos LA LOMITA.
- `tests/unit/audit/cpst-revert-flow.test.js` (5): simula el merge de lines[] con reversiones + idempotencia + reconciliación (breakdown ve BO post-reversión).

**Caso real para verificación prod**: LA LOMITA OUTDOORS SRL (C30716659379), EXGC66MHBAR 1u + EXGC66HBAR 2u, hoy recortadas a 0 → al confirmar CPST, 3u totales deberían pasar a BO con `asigRevertidaReason='asig_sin_stock_revertida_a_bo'`. Validar con script audit `scripts/audit/J_sobre_asignadas_prod.cjs` post-ejecución: esas líneas desaparecen de `asignadas.totalSobreAsignada`.

**Precedente**: `feat-cpst-revert-asig-sin-stock-a-bo` 2026-10-21 (v1397). Reporte Mariano: "una asignación solo existe con respaldo físico; sin respaldo, es cola".

### §40.6 (2026-10-21, v1398): "Borrar de espera" en órdenes CPST abre modal de 2 opciones

El botón **"Borrar de espera"** del modal waitlist-card:
- Para órdenes **normales** (sin `source='stock-asignado-batch'` ni `pedidosOrigenes`/`asigRefs` populated): sigue el flujo histórico (confirm nativo + `delete` del doc).
- Para órdenes **CPST** (`isWaitlistCpst(w) === true`): abre `#wcard-delete-choice-modal` con 2 botones (sin opción peligrosa por defecto). Si el user cierra sin elegir, nada se escribe.

Opciones:

1. **"El cliente no quiere la mercadería"** (`choice='rechazo_cpst'`):
   - `batch.delete(revision_waitlist/w._id)`.
   - Para cada ref de `collectAsigRefsForCancel(w)`:
     - Fetch pedido origen.
     - Mutar `lines[lineIndex]`: `state='cancelled'`, `qtyOpen=0`, `qtyCancelled += prevQo`, `closedReason='cliente_rechazo_cpst'`, `cancelledAt=nowIso`, `cancelledBy=userEmail`, `asigReserva=false`.
   - 1 batch atómico (`batch.commit()`).
   - Alert "Pedido borrado · N u ASIG canceladas".
   - Las unidades vuelven a libre; la reconciliación crea reparto si hay BO del SKU y entra físico.

2. **"Solo borro el borrador"** (`choice='solo_borrador'`):
   - `batch.delete(revision_waitlist/w._id)` — nada más.
   - Las ASIG de origen quedan vivas (reservadas hasta vencimiento 7d).

**Fuente de refs** (`src/pure/cpst-cancel-asig-plan.js:collectAsigRefsForCancel`): unión dedupe de `w.pedidosOrigenes[]` + `w.items[].asigRefs[]` (per-línea v1382). Dedupe por `(pedidoId, lineIndex)` — toma la qty máxima si una ref aparece en ambas fuentes.

**Idempotencia**:
- Línea ya en `state='cancelled'` con `closedReason='cliente_rechazo_cpst'`: skip (no se re-cancela ni se cambia audit).
- Línea en otro estado (`BO`, `invoiced`, `confirmed`): skip (no se fuerza cancelación — otros flows la pueden haber mutado válidamente, ej. v1397 revertida a BO).

**UI del modal**:
- Botón 1 (danger, borde rojo): "El cliente no quiere la mercadería" — detalle dinámico: "Se borra el pedido y las N unidad(es) ASIG de origen se cancelan (cliente_rechazo_cpst). Vuelven a libre; si hay back order del SKU, aparecerán en Reparto cuando ingrese stock."
- Botón 2 (neutro, borde gris): "Solo borro el borrador" — detalle dinámico: "Se borra el pedido y las N unidad(es) siguen reservadas para el cliente (ASIG). Vencen el DD/MM (7 días)."
- Botón 3: "Cancelar" (no hace nada).

Ninguno de los 2 botones de acción tiene estilo `default`/focus auto — el user debe elegir explícitamente.

**Tests**:
- `tests/unit/cpst-cancel-asig-plan.test.js` (8): pure function + edge cases + caso ALAN OSCAR orden 487.
- `tests/unit/audit/cpst-delete-choice-flow.test.js` (10): isWaitlistCpst discrimination + path 1 muta línea con audit + breakdown post-cancel deja de contar + path 2 preserva línea + idempotencia (ya cancelled, BO revertida, invoiced) + orden unificada v1382 extrae asigRefs por línea + caso real ALAN OSCAR.

**Caso real para verificar prod**: ALAN OSCAR NICOLAS RODRIGUEZ (CardCode `C23347411299`), orden 487, CLC70MHAAR 1 unidad. Al elegir "cliente_rechazo_cpst":
- `revision_waitlist/<orden487>` se borra.
- `pedidos/ewGoZIDQ.lines[0]` muta: `state='ASIG' → 'cancelled'`, `qtyOpen 1 → 0`, `closedReason='cliente_rechazo_cpst'`.
- `getStockBreakdown('CLC70MHAAR').asignadas` baja 1u. El modal Stock Asignado deja de listarla.

**Precedente**: `feat-cpst-delete-choice-cancel-asig` 2026-10-21 (v1398). Reporte Mariano: regla simétrica a §40.5 — "si el cliente no quiere, no tiene sentido mantener la reserva".
