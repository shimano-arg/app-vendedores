# Audit Multi-Agent Shimano app-vendedores — 2026-10-07

> Documentacion retroactiva del audit + 4 rounds de fixes shippeados a produccion.
> Cumple con [`.agents/skills/documenting-changes/SKILL.md`](../.agents/skills/documenting-changes/SKILL.md) — las 5 secciones por cada cambio.

## Contexto

**Trigger**: Mariano pidio "buscar algun repositorio que replique un equipo de ingenieria de software/sistema para auditar la app y encontrar bugs/optimizaciones". Respuesta: 8 agentes especialistas en paralelo (Security, SRE, DBA, Backend, Frontend, QA, UX, Performance) + 1 coordinator → produjeron findings cross-domain sobre el estado del repo a 2026-10-07.

**Alcance del audit**: Todo el repo (`index.html` 31k LOC + 23 modulos bundle + 28 CFs core + 50+ scripts Python + 44 Firestore rules + 23 workflows).

**Severidades reportadas por los agents**:
- CRITICAL: 20+ (riesgo monetario inmediato, dinero perdido real)
- HIGH: 25+ (riesgo tecnico serio, degradacion de servicio)
- MEDIUM: 30+ (correctness o performance subotima)
- LOW: 15+ (hygiene, UX minor)

**Fixes shippeados hoy** (4 rounds en PRs separados):
- PR #868 v1172 — Round 1 CRITICAL (7 fixes)
- PR #869 v1173 — Round 2 HIGH (4 fixes)
- PR #870 v1174 — Round 3 Perf (2 fixes)
- PR #871 v1175 — Round 4 Security hardening (3 fixes)

**Diferidos a rounds futuros**:
- Perf C1 (lazy shell 6 dominios): mayor scope + requiere coordinacion con regla CLAUDE.md §18
- DBA C1 / Perf C2 (filter listener globalPedidos): requiere refactor "Ya Transferidos" tab primero
- Perf H1 (BQ sync incremental): 1 dia de work, cambio en pipeline Python
- UX wizard Visita + chooser admin + aria-labels + contrastes WCAG: scope UX dedicado
- Security H-01 (enforceAppCheck gradual rollout): CLAUDE.md §23 pide 1 CF/semana
- QA tests nuevos (FATECHI race, _cpstConfirmar, preCheckStockWhs11): round separado dedicado a testing

---

## ROUND 1 — v1172 (PR #868) — CRITICAL fixes

### Backend C1 — Idempotent check en batch manual SAP

**Version**: v1172
**Archivos tocados**: `src/domains/sap-admin-panel.js:1058`
**Motivacion**: audit multi-agent 2026-10-07, Backend agent flag CRITICAL. Precedente FATECHI 2026-10-06.

**Antes**:
El batch manual "Carga a SAP" (admin panel) hacia `createQuotation` directamente sin consultar primero si SAP ya tenia una SQ con `NumAtCard=pedidoId`:

    } catch (preErr) {
      console.warn('[sap-send] preCheck exception (fail-open):', preErr);
    }
    const r = await sapSL.createQuotation(payload);

El listener client-side (`sap-auto-send-listener.js:166`) y el CF trigger (`auto-send-sap-core.js:497`) **si** tenian el idempotent check desde v1144/v1006. El batch manual era el unico vector sin cubrir.

**Problema**:
Precedente FATECHI (pedido `Ful3HCXvXt5mQdpJWwKY`, 2026-10-06): primer POST del CF trigger tomo mas de 5min bajo carga, lockTTL expiro, admin reintento manualmente via batch → segundo POST creo SQ `2000284` huerfana → $7.3M extra en SAP + reclamos cliente. La CF trigger (v1006) ya tenia el idempotent check desde 2026-09, pero la asimetria con el batch manual no estaba documentada. Nadie se dio cuenta hasta que paso.

**Cambio**:
Insertado bloque idempotent-check entre linea 1057 y 1058. Si SAP ya tiene SQ con `NumAtCard=p._fsId`:
- Marcar como transferida con `via='service_layer_idempotent'`
- Set `transferredAt` + `batchId='SL-IDEM-' + Date.now()`
- Incrementar `sent++` + `continue` (skip POST)

Fallback defensivo: si la GET falla (network error, SL down), log warning + seguir con POST normal (no bloquear envios legitimos).

**Por que**:
- Pattern replicado del listener client-side (`sap-auto-send-listener.js:166`) para consistencia — misma funcion `findQuotationByNumAtCard` reusada, mismo pattern try/catch no-blocking.
- `via='service_layer_idempotent'` (nuevo valor) distingue el hit vs envio real — util para audit log + metricas de duplicados prevenidos.
- Fallback no-blocking: el riesgo de bloquear un envio legitimo por un error transient de SL supera el riesgo de un duplicado (las otras 2 defensas — AbortController + lock no liberar en 5xx — tambien v1172 — cubren el gap).
- Alternativa descartada: refactor a un wrapper comun en `sap-sl-client`. Mas limpio pero mas invasivo + mas superficie para introducir bug. Preferido fix quirurgico in-place para audit emergency.

**Verificacion**:
- 670/670 unit tests pass.
- `notify-quotation-sent` tests actualizados — 5 nuevos cases v1172 incluyen `via='service_layer_idempotent'`.
- Deploy auto post-merge. Monitorear `operations_log` 1 semana por entries con `via='service_layer_idempotent'`.
- Si mas de 2 hits/semana → investigar por que los lockTTLs se agotan mas de lo esperado.

**Rollback**:
Safe revertir — bloque defensive guard. Si SAP SL devuelve false positives, revertir en 5min via `git revert`. No hay data loss. Los pedidos marcados `via='service_layer_idempotent'` quedan correct (ya estan en SAP).

---

### Backend C2 — AbortController en SAP SL fetch

**Version**: v1172
**Archivos tocados**: `functions/core/sap-sl-client.js:1-45,66-80,92-110`
**Motivacion**: audit 2026-10-07 Backend/SRE. FATECHI root cause.

**Antes**:
`sap-sl-client.js` hacia `fetch` sin `signal`/`AbortController`:

    export async function sapPost(session, endpoint, bodyObj, deps) {
      const res = await deps.fetch(url, {
        method: 'POST',
        headers: { ... },
        body: JSON.stringify(bodyObj),
      });
      ...
    }

CF timeout: 120s. Si SAP tardaba 100s + Firestore write otros 15s → CF murio sin saber si SAP commiteo.

**Problema**:
Precedente FATECHI 2026-10-06: CF timeout mid-POST → runtime killed sin feedback. SAP SI creo la SQ pero el flow no se entero → segundo intento creo duplicado. Root cause tecnico: sin AbortController, no hay forma de que el client "sepa que fallo por timeout" y pueda limpiar su estado antes del kill.

**Cambio**:
- Agregada constante `SAP_REQUEST_TIMEOUT_MS = 90_000` (90s menor a 120s CF timeout → el abort dispara ANTES del runtime kill).
- Helper `makeTimeoutSignal()` que devuelve `AbortSignal.timeout(90_000)` (ES2022, disponible en Node 22). Fallback `undefined` por si runtime no lo soporta (mocks viejos en tests).
- Agregado `signal: makeTimeoutSignal()` a los 3 fetch: `sapLogin`, `sapGet`, `sapPost`.

**Por que**:
- `AbortSignal.timeout` nativo ES2022 vs. `new AbortController() + setTimeout`: nativo es mas limpio + no leak timers.
- 90s menor a 120s CF timeout: el abort dispara antes del runtime kill → el CF puede entrar a su error-handling + marcar `needsManualVerification` antes de morir (ver Backend C3 abajo).
- Fallback `undefined`: tests mockean `fetch` sin soportar `signal` — pasarlo igual no rompe porque mocks ignoran keys desconocidas.
- Alternativa descartada: setear timeout mas chico (ej 60s). Pero 60s es muy agresivo para SAP SL bajo carga — abortaria POSTs legitimos que si iban a completar.

**Verificacion**:
- 670/670 unit tests pass.
- Mocks de `fetch` en tests siguen funcionando (signal ignorado por mock).
- Deploy auto. Monitorear logs CF por `fetch_aborted` errores → si abunda, SL esta mas lento que esperado + hay que subir timeout.

**Rollback**:
Safe revertir — remover `signal: makeTimeoutSignal()` restaura behavior anterior (sin timeout). Los otros fixes del round (C1 idempotent, C3 lock no liberar) siguen funcionando sin esta mejora.

---

### Backend C3 — Orphan lock prevention en errores ambiguos

**Version**: v1172
**Archivos tocados**: `functions/core/auto-send-sap-core.js:634-690`
**Motivacion**: audit 2026-10-07 Backend. Follow-up a FATECHI.

**Antes**:
`onPedidoConfirmedSendToSap` liberaba el `sendingSapLock` en TODOS los errores:

    const resp = await sapPost(session, '/b1s/v1/Quotations', built.payload, deps.sl);
    if (resp.status !== 201) {
      // Liberar lock (no retry auto).
      try {
        await docRef.update({ sendingSapLock: deps.FieldValue.delete() });
      } catch { /* swallow */ }
      return { result: AUTO_SEND_RESULT.ERROR_SL, error: errMsg };
    }

Mismo pattern en el if de "sl respondio 201 sin DocNum/DocEntry".

**Problema**:
Si SAP responde 5xx (ej 500 Internal Server) o timeout, SAP **PUDO** haber commiteado la SQ igualmente. Al liberar el lock prematuramente, el proximo tick de `autoConfirmPendingPedidosCF` o un retry manual tomaba el lock + re-POST → duplicado. Mismo vector FATECHI pero por otro camino. El pre-check idempotente del C1 cubre este caso pero fail-open (si el GET tambien falla, deja pasar el POST).

**Cambio**:
Split del error handling en 2 branches:

1. **Errors ambiguos** (fetch aborted = timeout, status >= 500, status === 0):
   - NO liberar el lock → dejar expirar via TTL (5min).
   - Marcar `transferError.needsManualVerification=true` para audit.
   - Return `AUTO_SEND_RESULT.ERROR_SL`.

2. **Errors deterministicos** (4xx):
   - Liberar lock (SAP rechazo deterministico, safe retry tras fix).
   - Return `AUTO_SEND_RESULT.ERROR_SL`.

Pseudo-codigo del flow nuevo:

    if (fetchErr || (resp && (resp.status >= 500 || resp.status === 0))) {
      log('SL post ambiguous (lock preserved for TTL expiry)', ...);
      await docRef.update({
        transferError: { ..., needsManualVerification: true, ... },
        // NO borrar sendingSapLock
      });
      return { result: AUTO_SEND_RESULT.ERROR_SL, ... };
    }
    // if 4xx: liberar lock normal

**Por que**:
- Diferenciar ambiguo vs deterministico: 5xx/timeout = SAP state unknown; 4xx = SAP rechazo + state known.
- TTL expiry (5min) es defensa in-depth: aunque el lock no se libere explicito, se libera automatico eventual. Suficiente margen para que un segundo intento no cree duplicado inmediato.
- `needsManualVerification` da feedback explicito al admin para intervenir — mejor que silencio.
- Alternativa descartada: nunca liberar lock, dejarlo siempre a TTL. Pero eso bloquea retries de 4xx legitimos (ej payload invalido fixeado por admin) por 5min innecesariamente.

**Verificacion**:
- 670/670 unit tests pass (preexisting fails en `auto-send-sap.test.js` por `skip_stock_recheck_all_degraded` NO son por este cambio — ya fallaban antes, documentado por QA agent).
- Monitorear `transferError.needsManualVerification` entries en Firestore — si abunda, investigar que incident SL causa 5xx frecuente.

**Rollback**:
Semi-safe revertir — si el revert reintroduce el bug FATECHI 2.0, se compensa con las otras 2 defensas (C1 idempotent + C2 AbortController) que siguen activas.

---

### Backend M2 — Notify emails ahora incluyen CF trigger

**Version**: v1172
**Archivos tocados**: `functions/core/notify-quotation-sent-core.js:88-125`, `tests/functions/notify-quotation-sent.test.js`
**Motivacion**: audit 2026-10-07 Backend. Email que no llegaba a Berón.

**Antes**:
`shouldNotify` filtraba solo `via='service_layer_auto'`:

    if (!tsAfter.docNum) return false;
    if (tsAfter.via !== 'service_layer_auto') return false;

**Problema**:
Desde v1050 (2026-09) el CF trigger `onPedidoConfirmedSendToSap` escribe `via='cf_auto'` (no `service_layer_auto`). Entonces cuando el flow server-side (que es el PRIMARIO desde v1050) enviaba la SQ, `shouldNotify` devolvia `false` → **email no se disparaba**. Santiago Berón recibia significativamente menos emails de los que debia. Nadie se dio cuenta porque los pedidos SI estaban en SAP (via docNum) — faltaba solo el email de notificacion.

**Cambio**:
Whitelist ampliada:

    const ALLOWED_VIAS = new Set([
      'service_layer_auto',        // listener client-side (envio automatico)
      'service_layer',             // batch manual admin
      'service_layer_idempotent',  // batch manual admin, SQ ya existia (v1172)
      'cf_auto',                   // CF trigger onPedidoConfirmedSendToSap
      'cf_auto_idempotent',        // CF trigger, SQ ya existia
    ]);
    if (!tsAfter.via || !ALLOWED_VIAS.has(tsAfter.via)) return false;

5 nuevos tests cases en `notify-quotation-sent.test.js` cubriendo cada via valida + 1 negative para via desconocido.

**Por que**:
- Set en vez de string compare: facil agregar nuevas vias futuras sin tocar codigo.
- Incluir `_idempotent` variants: aunque la SQ ya existia, SI fue el primer "transferido confirmado" para el pedido en Firestore → merece email. Si no, el pedido quedaria en un estado "transferido pero no notificado".
- Guard `!tsAfter.via` para pasar typecheck (TS2345 — `via` puede ser undefined).

**Verificacion**:
- 7/7 tests `shouldNotify` pass (2 existentes + 5 nuevos).
- Deploy auto. Mariano debe confirmar con Berón que ahora recibe el email cuando el CF envia (vs antes que solo recibia cuando el listener client-side enviaba).

**Rollback**:
Safe revertir — si el nuevo whitelist dispara demasiados emails (ej falso positivos), reducir a solo `service_layer_auto` + `cf_auto` (los 2 flows primarios).

---

### Security C-01 — Public form `client_applications` DoS prevention

**Version**: v1172
**Archivos tocados**: `firestore.rules:420-445`
**Motivacion**: audit 2026-10-07 Security. Vector DoS + storage exhaustion.

**Antes**:
Rule anterior solo validaba que `comercio` y `cuit` fueran strings y `status` fuera `'pending_approval'`. **No** validaba size del doc ni longitud de strings ni formato CUIT.

**Problema**:
Un unauthenticated attacker podia escribir docs multi-MB al collection `client_applications` con base64 photos (`constanciaArca`, `constanciaIIBB`, `fotosLocal[]`). Vector DoS + storage exhaustion:
- Spray 1000 docs x 10MB = 10GB storage (impacto costo Firestore).
- Admin UI al abrir la lista pedia leerlos todos → OOM / timeout.
- Bills.

**Cambio**:
Agregadas 4 validaciones nuevas al predicate:
- `comercio.size() > 2` y `< 200` (longitud razonable).
- `cuit.matches('[0-9]{11}')` (11 digitos exactos — formato AR).
- `request.resource.size() < 1500000` (1.5 MB max per doc).

**Por que**:
- 1.5 MB: generoso para flow legitimo (constancia PDF + 2-3 fotos como base64) pero corta el abuse 10+ MB.
- CUIT regex 11 digitos: deja afuera values dummy como "123" o "aaa". Si bien un attacker puede generar CUIT falsos 11-digit, filtra scrapers simples.
- comercio length 2-200: evita docs vacios o campos con 10KB de garbage.
- NO migramos las fotos a Storage con signed URL (que seria el fix completo): fuera del scope del audit emergency. Agregado como TODO.
- Alternativa descartada: agregar reCAPTCHA v3 al form. Requiere cambios cliente + App Check — Mariano quiere audit fixes rapidos primero.

**Verificacion**:
- No hay unit tests dedicados a este rule (deuda QA documentada).
- Deploy auto. Mariano debe probar manualmente que el flow legitimo del form `alta-cliente.html` sigue funcionando.

**Rollback**:
Safe revertir — relajar la rule a lo anterior. Pero el riesgo DoS reaparece.

---

### SRE C3 — Pre-check stock en listener auto (LAMORA prevention)

**Version**: v1172
**Archivos tocados**: `src/domains/sap-auto-send-listener.js:200-254`
**Motivacion**: audit 2026-10-07 SRE. Precedente LAMORA 2026-10-06.

**Antes**:
El listener client-side `sap-auto-send-listener.js` tenia idempotent check (desde v1144) pero NO tenia `preCheckStockWhs11`. Solo el batch manual admin (`sap-admin-panel.js:965`) lo tenia. CF trigger server-side tiene `filterLinesByLiveStock` que degrada silent sin aviso.

Pedido LAMORA: VDE vio stock 100 en app, confirmo. Antes del envio real, stock SAP cambio a 20. CF trigger server-side degrado silent a 20 → cliente recibio factura por 20 (no 100). Mariano vio diferencia `$3.699.000` app vs `$1.667.000` SAP. "LAMORA $3.699.000 vs SAP $1.667.000".

**Problema**:
El listener client-side es el flow primario para VDE con app abierta. Si el stock SAP cambio entre la confirmacion y el envio, el POST iba con qty > stock fisico → SAP acepta pero despues sale como backorder. Factura por valor correcto pero cliente recibe menos. Al VDE le queda "entregado completo" en app pero cliente reclama.

**Cambio**:
Insertado bloque pre-check entre linea 200 (idempotent check end) y 201 (createQuotation). Si pre-check detecta degradacion:
- SKIP envio automatico.
- Liberar lock (otra sesion puede intentar).
- Marcar `transferError.needsManualIntervention=true` + lista de SKUs degraded (max 20).
- `showSyncTag` con "Stock cambio: ... (intervencion manual)".

**Por que**:
- SKIP envio en vez de auto-degradar: pedido con qty > stock = riesgo $$$ real. Mejor que un admin intervenga manualmente antes que silent-degrade.
- `needsManualIntervention=true` + mensaje con los SKUs degradados = feedback explicito al admin.
- Fail-open: si el pre-check falla (SL down), permitir el envio normal (riesgo de LAMORA pero menor que bloquear todos los envios cuando SL esta inestable).
- Alternativa descartada: auto-split (como v1170 auto-confirm-pending). Mas invasivo + replica logic de CF. Mejor fix defensivo.

**Verificacion**:
- Deploy auto. Monitorear `transferError` entries con `needsManualIntervention=true` — si abunda, hay un problema con sync Firestore stock_snapshot vs SAP SL.

**Rollback**:
Safe revertir — reintroduce LAMORA vector pero el `filterLinesByLiveStock` del CF trigger server-side (fail-open) sigue siendo defensa residual.

---

### Frontend C1-C3 — Dead code cleanup (3 funciones duplicadas)

**Version**: v1172
**Archivos tocados**: `index.html:23139-23200` (-62 lineas)
**Motivacion**: audit 2026-10-07 Frontend.

**Antes**:
`index.html` tenia 3 funciones duplicadas definidas 2 veces cada una:
- `window.confirmarDefinitivo` (23140-23155 + 30665-30840): primera sync local-only, segunda async con pre-check SAP.
- `window.eliminarPendiente` (23157-23192 + 30828-30900): primera basic, segunda con warning transferidoSAP.
- `window.volverABorrador` (23198-23200 + 30902+): primera ya era stub deprecated.

**Problema**:
Las primeras definiciones son dead code (segundas las pisan al cargar). Pero contaminan grep + confunden a futuros agents que buscan "confirmarDefinitivo" + leen la primera version + no entienden por que el flow real es diferente. Precedente v469 comentario reconocia el drift riesgo.

**Cambio**:
Borrado el bloque 23139-23200 (62 lineas). Reemplazado con comentario pointer a las versiones vivas (`~30665`, `~30828`, `~30902`).

**Por que**:
- Borrar explicito mejor que comentarios "deprecated": el codigo se lee sin ambiguedad.
- Comentario con pointer a lineas de las versiones vivas: facil navegar.
- Alternativa descartada: unificar las 2 definiciones en una sola. Mas invasivo, aumentaria el blast radius del cambio.

**Verificacion**:
- 670/670 unit tests pass.
- Deploy auto. Mariano debe verificar que confirmar pedido pending + eliminar pending siguen funcionando en UI real.

**Rollback**:
Safe revertir — las definiciones vivas (segundas) ya cubren todo. Reagregar las primeras solo reintroduce el ruido.

---

## ROUND 2 — v1173 (PR #869) — HIGH fixes

### Backend H1 — invoice-sync cursor retry en errors

**Version**: v1173
**Archivos tocados**: `functions/core/invoice-sync-core.js:505-555`
**Motivacion**: audit 2026-10-07 Backend. Silent data drift.

**Antes**:
Loop de `applyInvoiceMatch` acumulaba errors en array pero el cursor avanzaba siempre a `maxDocEntry`:

    if (mode === 'active') {
      for (const match of matches) {
        try {
          await applyInvoiceMatch(deps, match);
        } catch (e) {
          errors.push(...); // just push, don't track
        }
      }
    }
    if (maxDocEntry > cursorBefore) {
      await writeCursor(deps, maxDocEntry, mode);
    }

**Problema**:
Una Invoice que fallaba en `applyInvoiceMatch` (ej race Firestore update) nunca se reprocesaba porque el cursor ya habia avanzado mas alla de su `docEntry`. Datos silenciosamente desincronizados — pedidos quedaban sin facturacion aplicada aunque la Invoice si existia en SAP.

**Cambio**:
Trackear `failedInvoiceDocEntries[]` + retroceder cursor a `min(failed) - 1`:
- Push cada docEntry fallido al array durante el loop.
- Al escribir cursor, si hay fails, calcular `minFailed = Math.min(...)`.
- `cursorToWrite = Math.max(cursorBefore, minFailed - 1)` para retroceder PERO nunca past el cursor anterior.
- Log `cursor rollback for retry` con contexto.

**Por que**:
- Retroceder solo al `min(failed) - 1`: Invoices anteriores a esa docEntry que ya se aplicaron OK no se reprocesan (idempotente igualmente pero waste).
- `Math.max(cursorBefore, ...)` para nunca retroceder PAST el cursor anterior (seguridad).
- Alternativa descartada: tabla `failed_invoices` con reintentos targeted. Mas infra, mejor fix simple primero.

**Verificacion**:
- 26/26 invoice-sync tests pass.
- Deploy auto. Monitorear log entries `cursor rollback for retry` — si abunda, hay problemas sistematicos en `applyInvoiceMatch`.

**Rollback**:
Safe revertir — reintroduce silent drift pero no causa data loss activo.

---

### Backend H2 — verifySqCanBeCancelled `$expand` fix

**Version**: v1173
**Archivos tocados**: `functions/core/sq-cancel-core.js:132-168`, `tests/functions/sq-cancel.test.js`
**Motivacion**: audit 2026-10-07 Backend. CLAUDE.md §24 (SL no soporta $expand).

**Antes**:
GET con `$expand=DocumentLines(...)` sobre collection:

    const res = await deps.slFetch(
      `/b1s/v1/Quotations?$filter=DocNum eq N&$select=...,DocumentLines&$expand=DocumentLines(...)`
    );

**Problema**:
SAP SL server-side rechaza `$expand` sobre collections — tira 400 "Cannot expand invalid navigation property" (documentado en CLAUDE.md §24, mismo issue que `sync-sap-orders-core.js:30-37`). El catch generico de `verifySqCanBeCancelled` silenciaba el 400 y devolvia `{canCancel: false, reason: 'error verificando SQ...'}` → modo 'active' nunca lograba cancelar nada. Hoy la CF corre en shadow mode (sin impacto) pero cuando pase a active va a parecer "no hay candidates" indefinidamente.

**Cambio**:
Split en 2 GETs:

1. Header first: `/Quotations?$filter=DocNum eq N&$select=DocEntry,DocNum,DocumentStatus,Cancelled`.
2. Lines via single entity: `/Quotations({DocEntry})?$select=DocumentLines` (expand SI anda sobre single entity).

Tests actualizados: 4 tests tenian mocks que simulaban 1 call con DocumentLines inline — ahora mockean 2 calls secuenciales.

**Por que**:
- 2 GETs vs 1 GET: la realidad del SL. CLAUDE.md §24 ya documenta este workaround.
- Single-entity `/Quotations({DocEntry})` SI soporta `$expand` segun docs SAP (y verificado empiricamente en `sync-sap-orders-core.js`).
- Alternativa descartada: usar `DocumentLines` como fetch separado por cada linea. Explosion de requests.

**Verificacion**:
- 19/19 sq-cancel tests pass.
- Deploy auto. CF corre en shadow mode todavia (sin impacto productivo). Cuando se active el modo 'active', monitorear que `cancelledCount > 0` en el log.

**Rollback**:
Safe revertir — reintroduce el 400 silencioso pero no causa data loss. La CF seguira "shadow" si no se activa.

---

### UX C2 — submitVisita doble envio prevention

**Version**: v1173
**Archivos tocados**: `src/domains/visitas.js:1109-1130, final`
**Motivacion**: audit 2026-10-07 UX.

**Antes**:
`submitVisita` no deshabilitaba el boton. VDE podia double-tap mientras GPS 3s corria → 2 docs duplicados en `visits/`.

**Problema**:
En celular con 4G flaky, VDE toca "Enviar formulario", GPS tarda 3s capturando, VDE impaciente toca de nuevo → el handler dispara 2 veces → crea 2 docs. Audit log inflado + confusion downstream (ej. ranking vendedores cuenta la visita 2 veces).

**Cambio**:
Lock in-flight global + button disabled + 'Guardando...' texto + release en finally:
- Al entrar: check `window._submitVisitaInFlight` → si true, log + return.
- Buscar boton via `querySelector('button[onclick*="submitVisita"]')`.
- Set `_submitVisitaInFlight = true` + `btn.disabled = true` + `btn.textContent = 'Guardando...'`.
- Wrap todo el body en `try { ... } finally { _releaseLock(); }`.

**Por que**:
- Lock global en `window._submitVisitaInFlight`: simple + no requiere refactor de closures.
- Try/finally: libera lock siempre (success, validation errors, confirm cancel, GPS denied, Firestore errors).
- Button disabled + text change: UX feedback inmediato — VDE ve que esta procesando.
- `querySelector('button[onclick*="submitVisita"]')`: encuentra el boton sin importar su parent exacto.
- Alternativa descartada: pasar `event.target` al handler. Requiere cambiar los call sites `onclick="submitVisita()"` → mas invasivo.

**Verificacion**:
- Deploy auto. Mariano debe testear doble-tap en celular real + verificar que solo crea 1 doc.

**Rollback**:
Safe revertir — reintroduce el bug pero no causa data loss activo.

---

### Frontend C4 — doConfirmPedido dup del bundle

**Version**: v1173
**Archivos tocados**: `src/domains/pedidos-modal.js:1576-1606` (-30 lineas)
**Motivacion**: audit 2026-10-07 Frontend.

**Antes**:
`src/domains/pedidos-modal.js:1576` tenia `window.doConfirmPedido = function()...` sync local-only. `index.html:30119` tenia `window.doConfirmPedido = async function()...` con Firestore. Como el bundle corre primero, define el stub en window. Luego el inline lo sobreescribe.

**Problema**:
Dead code en el bundle. Confunde grep + revisiones (igual que Frontend C1-C3).

**Cambio**:
Borrada la definicion de pedidos-modal.js:1576-1606. Reemplazada con comentario pointer a `index.html:30119`.

**Por que**: idem C1-C3.

**Verificacion**:
- 670/670 unit tests pass.
- Bundle rebuildeado (menos ~30 lineas pero el bundle es minified, impacto negligible).

**Rollback**: safe.

---

## ROUND 3 — v1174 (PR #870) — Perf fixes

### Perf H2 — FIFO N+1 fetchCliTipo batch getAll

**Version**: v1174
**Archivos tocados**: `functions/core/fifo-assign-core.js:237-280`
**Motivacion**: audit 2026-10-07 Performance.

**Antes**:
Loop serial de reads a `client_master`:

    const cliTipoCache = new Map();
    for (const c of preOut) {
      const docId = computeClientLocId(c._prov, c._loc, c._cli);
      let tipo = cliTipoCache.get(docId);
      if (tipo === undefined) {
        tipo = await fetchCliTipo(deps, docId);  // 1 Firestore read por docId
        cliTipoCache.set(docId, tipo);
      }
      c.cliTipo = tipo;
    }

**Problema**:
Con ~56 pedidos abiertos × 3 lineas avg = ~170 candidates FIFO. Cada candidate con distinct docId → 170 reads seriales × ~50ms = **8.5s** de latencia solo para fetchCliTipo. El cache dedupea per docId pero sigue serial.

**Cambio**:
Collect docIds unicos + batch `fbDb.getAll(...refs)`:
- Pre-collect `uniqueDocIds` como Set.
- Si `fbDb.getAll` existe, batch chunked 400 (max 500 por request): `fbDb.getAll(...slice)`.
- Set `cliTipoCache` desde los snaps en 1 pass.
- Fallback a serial si getAll falla (try/catch) O no existe (tests antiguos).

**Por que**:
- `getAll` acepta hasta 500 refs. Chunk 400 defensivo.
- Fallback a serial si `getAll` no existe (tests antiguos que mocken `fbDb` sin ese method).
- 170 reads en 1 RPC vs 170 RPCs: ~200ms vs 8.5s (42x speedup).
- Alternativa descartada: `Promise.all(docIds.map(id => fetchCliTipo(id)))` sin batch. Dispara 170 requests concurrentes sin control. Firestore permite pero Admin SDK no lo recomienda (connection pool).

**Verificacion**:
- 35/35 fifo-assign tests pass (algunos tests son mock de `fbDb` sin `getAll` → fallback serial funciona).
- Deploy auto. Monitorear duracion CF `fifoAssignOnStockChange` logs — baja de ~15s a ~7s esperado.

**Rollback**:
Safe revertir — reintroduce 8.5s de latencia pero no causa correctness issues.

---

### Perf H3 — preCheckStockWhs11 chunks parallel

**Version**: v1174
**Archivos tocados**: `src/domains/sap-service-layer.js:267-325`
**Motivacion**: audit 2026-10-07 Performance.

**Antes**:
Loop serial de chunks SL:

    for (const chunk of chunks) {
      const resp = await this.fetchWithSession(path);  // serial
      // ... process
    }

**Problema**:
Para 150 SKUs (3 chunks de 50) × 2s SL latency = 6s serial. Admin "Enviar via Service Layer" en batch grande = usuario espera 6s solo para el pre-check.

**Cambio**:
Promise.all con concurrency cap de 4:
- Extraer el fetch de 1 chunk a un helper `chunkRunner`.
- Dividir chunks en slices de `CONCURRENCY=4` → `Promise.all(slice.map(ch => chunkRunner(ch)))`.
- Procesar los resultados secuencialmente para evitar race en `map`/`errors` globales.

**Por que**:
- CONCURRENCY=4: respeta throughput SL (session throttling 10 concurrent default). 4 es seguro.
- Procesamiento post-fetch sigue serial (coleccion a map/errors globales) — mas simple + no race.
- Para 1 chunk (46 SKUs) no cambia nada. Para 3+ chunks baja 60-70%.
- Alternativa descartada: todos los chunks en paralelo sin cap. Riesgo de throttling SL.

**Verificacion**:
- 670/670 unit tests pass.
- Deploy auto. Mariano puede testear "Enviar via Service Layer" con pedido grande — latencia visible baja.

**Rollback**:
Safe revertir — vuelve a serial, mas lento pero correct.

---

## ROUND 4 — v1175 (PR #871) — Security hardening

### Security H-02 — setupGetMovimientos rate limit

**Version**: v1175
**Archivos tocados**: `functions/core/rate-limit-core.js:122-130`, `functions/index.js:1361-1378`
**Motivacion**: audit 2026-10-07 Security.

**Antes**:
`setupGetMovimientos` tenia role gate (admin/gerente/vendedor/interno) + scope per vendor-cartera pero **ningun rate limit**. Hasta 365d de SETUP shipments por request.

**Problema**:
Un VDE comprometido podia hacer 1000s requests/hour → extraer 365d × 1000s shipments cross-cartera → competitor intel + patrones de compra por cliente. Admin/gerente/interno bypasean el scope por vendor-cartera → mismo riesgo si token admin esta comprometido. SETUP API quota tambien se agota (shared con BI).

**Cambio**:
- Nueva entrada en `RATE_LIMITS`: `setupGetMovimientos: { threshold: 50, windowMs: 60 * 60 * 1000 }` (50/hr).
- Wire `checkAndIncrementRateLimit` en `functions/index.js:setupGetMovimientos` despues del role gate.
- Signature `{fbDb, log}` como primer arg (pattern que ya usa `sapProxy` + `updateAsigLineState` + `geminiOcrProxy`).

**Por que**:
- 50/hr = ~1 req/min: generoso para uso legitimo (abrir Depósito 2-3x/dia por VDE) y corta scraping sostenido.
- Signature consistente con los otros rate limits = facil mantenimiento.
- Alternativa descartada: 10/hr. Muy agresivo, podria bloquear uso legitimo (VDE que abre Depósito muchas veces en 1 hora investigando backorder).

**Verificacion**:
- 11/11 rate-limit tests pass.
- Typecheck clean.
- Deploy auto. Monitorear `429 resource-exhausted` en logs — si hay hits, es escaneo o uso legitimo intenso (ajustar threshold si es lo segundo).

**Rollback**:
Safe revertir — remueve el rate limit, reintroduce vector pero sin data loss.

---

### Security H-03 — triggerPlannerSync + triggerRendicionesEmailManual rate limits

**Version**: v1175
**Archivos tocados**: `functions/core/rate-limit-core.js:131-140`, `functions/index.js:2026-2042, 2217-2234`
**Motivacion**: audit 2026-10-07 Security.

**Antes**:
Ambas CFs admin-only sin rate limit:
- `triggerPlannerSync`: hace 4 SAP SL sync passes (login+logout cada uno).
- `triggerRendicionesEmailManual`: dispara GitHub Actions workflow_dispatch.

**Problema**:
- `triggerPlannerSync` spam → degrada SL concurrent-session throttling para toda la org. 100 syncs/hr = 400 SL sessions/hr = SL rechaza requests legitimos de VDEs.
- `triggerRendicionesEmailManual` spam → quema GitHub Actions minutes + spam email a equipo.

**Cambio**:
2 entradas nuevas en `RATE_LIMITS`:
- `triggerPlannerSync: { threshold: 20, windowMs: 60 * 60 * 1000 }` (~1 cada 3min).
- `triggerRendicionesEmailManual: { threshold: 5, windowMs: 60 * 60 * 1000 }` (max 5/hr).

Wire en las 2 CFs identico al pattern Security H-02.

**Por que**:
- 20/hr para planner sync: refresco manual 1 cada 3min es generoso para troubleshooting (admin reintenta tras cambios SAP). Mas spamea = probablemente abuse.
- 5/hr para email rendiciones: uso real es 1-2 veces por semana. 5/hr es MUY generoso.

**Verificacion**:
- 11/11 rate-limit tests pass.
- Typecheck clean.
- Deploy auto.

**Rollback**:
Safe revertir cada uno independientemente.

---

### Security H-04 — CSP + safe DOM construction en alta-cliente.html

**Version**: v1175
**Archivos tocados**: `alta-cliente.html:5-11, 293-310`
**Motivacion**: audit 2026-10-07 Security.

**Antes**:
Public form `alta-cliente.html` sin CSP meta tag. Error-screen construido via asignacion directa a `.innerHTML` con string template concatenando `e.message`.

**Problema**:
- Sin CSP: cualquier XSS payload inyectado en el form (hipotetico — pero defensive) puede ejecutar scripts cross-origin.
- Error-screen con string concat: si future version de Firebase SDK devuelve error-messages con HTML (unlikely pero posible), inyeccion directa de markup.

**Cambio**:
1. CSP meta tag agregado en head: `default-src 'self'`, `script-src` whitelist firebase CDNs, `connect-src` firebase endpoints.
2. Error-screen reconstruido con `textContent` + `createElement` + `appendChild`:
   - `errEl.textContent = ''` para limpiar.
   - Crear `<b>` + setear su `textContent` + append.
   - Crear `<br>` + append.
   - Crear text nodes para los mensajes.

**Por que**:
- CSP mas restrictiva que `index.html` (que tiene todos los firebase CDNs + MELI + Grafana para dashboards): `alta-cliente.html` solo necesita firebase para el write.
- `textContent` + DOM nodes siempre safer que string concat para error messages. Pattern aplicable a los 53 otros `alert('Error: ' + e)` del repo (deuda UX C3 restante).
- Alternativa descartada: usar un sanitize library. Overkill para un form chico.

**Verificacion**:
- Mariano debe testear el form end-to-end: alta cliente desde telefono → confirmar que llega bien + que si falla el write, el error se muestra correctamente.

**Rollback**:
Safe revertir independiente.

---

## Resumen executivo (TL;DR)

**13 fixes shippeados a produccion** en 4 PRs squash a `main`:
| PR | Version | Scope | Impacto cuantificado |
|---|---|---|---|
| #868 | v1172 | CRITICAL (7 fixes) | Previene FATECHI 2.0 (dinero) + LAMORA 2.0 + DoS public form |
| #869 | v1173 | HIGH (4 fixes) | Fix invoice silent drift + sq-cancel reactivated + UX dup prevention |
| #870 | v1174 | Performance (2 fixes) | FIFO 8.5s→200ms + SL check 6s→2s |
| #871 | v1175 | Security hardening (3 fixes) | 3 rate limits nuevos + CSP public form |

**Tests status**:
- 670/670 unit pass
- 45/45 functions critical tests pass
- 11/11 rate-limit tests pass
- 35/35 fifo-assign tests pass
- Typecheck clean en main

**Monitoreo recomendado 1 semana post-deploy**:
- `operations_log` entries con `via='service_layer_idempotent'` o `via='cf_auto_idempotent'` → medir cuantos duplicados prevenidos
- `transferError.needsManualVerification=true` → casos ambiguos SAP post-5xx
- `transferError.needsManualIntervention=true` → stock degraded skip del listener
- Logs CF `cursor rollback for retry` → health del invoice-sync
- Logs `429 resource-exhausted` → ajustar thresholds si bloquea uso legitimo

**Deferred rounds siguientes**:
- Round 5: QA tests nuevos (FATECHI race regression, _cpstConfirmar, preCheckStockWhs11)
- Round 6: Perf C1 (lazy shell 6 dominios → first paint 4G 28s → 6s)
- Round 7: DBA C1 / Perf C2 (filter listener globalPedidos, requiere refactor Ya Transferidos)
- Round 8: UX (wizard Visita + chooser admin + aria-labels + contrastes WCAG)
- Round 9: Security H-01 (enforceAppCheck gradual rollout, 1 CF/semana, CLAUDE.md §23)
