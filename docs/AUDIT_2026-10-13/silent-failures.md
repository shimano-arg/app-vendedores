# Silent Failure Audit — 2026-10-13

## Executive summary

20 findings total. **8 CRITICAL** with real financial / SAP-SAP-split-brain / data-loss risk. The highest-risk cluster is in `functions/core/sq-cancel-core.js` where **TWO independent silent failures** currently block the SQ auto-cancel flow (S1 + S2): `verifySqCanBeCancelled` reads the wrong response shape and always returns "SQ no encontrada" (fail-closed, flow is effectively dead), and `cancelSqInSap` never validates the HTTP status (if the gate were patched, SAP-reject would be reported as success and lines would be marked `cancelled` in Firestore while the SQ stays alive in SAP = split-brain ≈ LAMORA). The second-highest cluster is in `onPlannerStageChanged` + fire-and-forget Firestore writes in `index.html` and `pedidos-modal.js` where state can be lost between client-cache and server-truth, mirroring the v469 "pending fantasma" root cause.

## CRITICAL — could cause data loss, duplicate SAP orders, or financial discrepancy

#### S1. `verifySqCanBeCancelled` reads wrong response shape — the auto-cancel flow is dead
- **File:** `functions/core/sq-cancel-core.js:142` and `:159`
- **Code snippet:**
```js
const headerRes = await deps.slFetch(
  `/b1s/v1/Quotations?$filter=DocNum eq ${docNum}&$select=DocEntry,DocNum,DocumentStatus,Cancelled`
);
if (!headerRes || !Array.isArray(headerRes.value) || headerRes.value.length === 0) {
  return { canCancel: false, reason: 'SQ no encontrada en SAP' };
}
// ...
const linesRes = await deps.slFetch(`/b1s/v1/Quotations(${header.DocEntry})?$select=DocumentLines`);
const lineas = Array.isArray(linesRes && linesRes.DocumentLines) ? linesRes.DocumentLines : [];
```
- **Why dangerous:** `deps.slFetch` is wired in `functions/index.js:1152-1157` and `:1227-1232` as `return await sapPost/sapGet(...)` which returns `{status, body}` (per `functions/core/sap-sl-client.js:85-100 + :112-128`). So `headerRes.value` is **always `undefined`** → `canCancel: false, reason: 'SQ no encontrada en SAP'` 100% of runs. The scheduled `sqCancelExpiredCF` has been silently NOT cancelling expired SQs for weeks. Expired SQs continue to reserve stock in SAP + the committed-stock numbers used by the recheck (v1051 / v1180) are stale → eventually causes false "degraded" rejections for legit new pedidos.
- **Hidden errors:** SAP API shape changes, cursor/pagination bugs, auth drift — ALL would be invisible because every path returns "SQ no encontrada".
- **Analogous past incident:** `username vs userName` v918→v999 — code lived for a year reading the wrong field, every log said "sapConfig incompleto" and nobody looked.
- **User impact:** Admin sees empty audit log entries, assumes nothing to cancel, SAP accumulates ghost SQs. If/when the gate is "fixed", S2 below activates. Also: the `sq_cancel_log` writes `candidatesCount` from `scanExpiredConfirmedSqs` (which does work) and 0 for cancelled, which looks like "nothing matched" — pure silent failure.
- **Fix:** Unwrap in `slFetchFn`:
```js
const slFetchFn = async (uri, opts) => {
  const r = opts && opts.method === 'POST'
    ? await sapPost(sapSession, uri, opts.body || {}, sapDeps)
    : await sapGet(sapSession, uri, sapDeps);
  if (r.status < 200 || r.status >= 300) {
    const errMsg = (r.body && r.body.error && r.body.error.message && r.body.error.message.value) || `SL http ${r.status}`;
    throw new Error(`slFetch ${uri} status=${r.status}: ${errMsg}`);
  }
  return r.body;
};
```
Plus add a smoke test that mocks a real-looking SL response and asserts `canCancel: true` for the happy path.

#### S2. `cancelSqInSap` returns `ok:true` without validating HTTP status
- **File:** `functions/core/sq-cancel-core.js:185-203`
- **Code snippet:**
```js
export async function cancelSqInSap(deps, docNum) {
  if (!deps.slFetch) return { ok: false, error: 'slFetch no inyectado' };
  try {
    const q = await deps.slFetch(`/b1s/v1/Quotations?$filter=DocNum eq ${docNum}&$select=DocEntry`);
    if (!q || !Array.isArray(q.value) || q.value.length === 0) {
      return { ok: false, error: 'SQ no encontrada' };
    }
    const docEntry = q.value[0].DocEntry;
    await deps.slFetch(`/b1s/v1/Quotations(${docEntry})/Cancel`, { method: 'POST' });
    return { ok: true };
  } catch (e) { ... }
}
```
- **Why dangerous:** Even if S1 is patched, the `/Cancel` POST response is discarded. SAP SL can respond 400 "Cannot cancel SQ with linked documents" (or similar business error) and `cancelSqInSap` returns `{ok: true}`. The caller (`runSqCancelExpired` loop and `runSqCancelManualBulk` loop) then runs `markLinesCancelled(deps, c)` which writes `state: 'cancelled'` + `qtyOpen: 0` to Firestore. **Result: lines are 'cancelled' in the app but the SQ is still alive in SAP.** When invoices come in via `syncSapInvoices`, pedidos lineage won't match → orphans. Stock accounting breaks because reserves disappear from app view but SAP still committed the stock.
- **Hidden errors:** SAP 400/401/403/409/500, auth session expired mid-batch, HTML error pages (not JSON), SL endpoint renamed.
- **Analogous past incident:** FATECHI — half-committed state between SAP (SQ created) + app (CF marked ERROR). Same pattern, inverse direction.
- **User impact:** `$$$ discrepancy — SAP shows stock committed to pedidos that app has already "cancelled". Mariano / Santi have to reconcile manually.
- **Fix:** Validate response like `auto-send-sap-core.js:753+`:
```js
const r = await deps.slFetch(`/b1s/v1/Quotations(${docEntry})/Cancel`, { method: 'POST' });
// After S1 fix: r is the body or throws. Need to additionally require success before marking.
// Use the sapPost shape directly: expect 204 No Content on /Cancel success.
if (!r || (r.status !== undefined && r.status !== 204)) {
  return { ok: false, error: `SL cancel status=${r.status}` };
}
return { ok: true };
```

#### S3. `onPlannerStageChanged` sends email BEFORE persisting `sentAt` → duplicate emails on retry
- **File:** `functions/core/planner-stage-change-core.js:436-456`
- **Code snippet:**
```js
await deps.transporter.sendMail({...});   // ← email actually sent
const updatePatch = {
  [`plannerEmails.${afterCol}`]: { sentAt: deps.now(), to: recipients.join(',') },
};
if (afterCol === 'cobrado' && !after.cobradoAt) {
  updatePatch.cobradoAt = deps.now();
}
await event.data.after.ref.update(updatePatch);  // ← if this fails, idempotency token is lost
```
And in the wrapper `functions/index.js:2082-2086`:
```js
} catch (err) {
  console.error('onPlannerStageChanged failed:', err);
  // NEVER throw — retries would duplicate emails when the send actually succeeded.
  return { skipped: 'error', error: err?.message };
}
```
- **Why dangerous:** If `sendMail` succeeds but the subsequent `.update(updatePatch)` fails (Firestore quota, transient error, doc deletion race), **the email was sent but `plannerEmails.{col}.sentAt` was never persisted**. Next pedido write that still hits the same column triggers the function again → the idempotency guard at `:379` says `sentAt` empty → sends **duplicate email**. The comment "NEVER throw" protects against the opposite case (send succeeded but Firestore write failed), but **does not actually prevent duplicates** because the next write-event triggers it again.
- **Hidden errors:** Firestore quota exhaustion (free tier limits), temporary network partition, pedido doc deleted mid-flight, retry:undefined default behavior.
- **Analogous past incident:** CLAUDE.md §28 (Callable Gen 2 skipped silent). Pattern of "success path assumed but intermediate step can fail".
- **User impact:** VDI/VDE/responsable receives duplicate "pedido entró a columna X" emails. In worst case (quota breach), ALL recipients get N emails per transition. Reputation damage + distrust of the Planner notifications.
- **Fix:** Persist `sentAt` FIRST (as a reserve marker), then send email, then confirm. Pattern similar to `auto-send-sap-core.js` idempotent lock:
```js
// Step 1: reserve the slot with a pre-send marker
await event.data.after.ref.update({
  [`plannerEmails.${afterCol}.sendingAt`]: deps.now(),
  [`plannerEmails.${afterCol}.attemptBy`]: 'cf-trigger',
});
// Step 2: send
await deps.transporter.sendMail({...});
// Step 3: finalize
await event.data.after.ref.update({
  [`plannerEmails.${afterCol}.sentAt`]: deps.now(),
  [`plannerEmails.${afterCol}.to`]: recipients.join(','),
});
```
Then update the idempotency check to treat `sendingAt` as "in-flight within 5min TTL" like the SAP lock.

#### S4. `fbDb.collection('pedidos').doc(entry._fsId).update(...)` fire-and-forget on pedido line enrichment
- **File:** `index.html:23782`
- **Code snippet:**
```js
fbDb.collection('pedidos').doc(entry._fsId).update({
  lines: _linesEnriched,
  updatedAt: firebase.firestore.FieldValue.serverTimestamp()
}).catch(e=>console.error('update pending lines', e));
```
- **Why dangerous:** This is a **fire-and-forget** `.update()` on a pedido pending document — it enriches `lines` with computed state (`qtyOpen`, `state`, `priceAtCreation`). The caller doesn't `await` it, there's no UI feedback, and the only error signal is `console.error` which 99% of users never see. If this fails (permissions, offline, Firestore quota), the pedido stays unenriched — subsequent operations (confirmar, SQ-create) may use stale `state: undefined` lines that the legacy fallback `_isLegacyState` (sap-service-layer.js:544) treats as **"send ALL lines to SAP"** — exactly the opposite of the intended BO/confirmed split.
- **Hidden errors:** permission-denied if VDE edits other's pedido (rules reject silently), quota exhausted, offline + stale cache that writes nothing, serverTimestamp with no connectivity.
- **Analogous past incident:** CLAUDE.md §17 (listener leaks because of silent `off()` fallthrough). Same silent-tolerance pattern.
- **User impact:** Pedido confirmed with stale lines → wrong state → SAP SQ created with incorrect lines (ALL instead of just confirmed) → stock oversold or duplicate.
- **Fix:** Always `await` or at least mark the pedido with `_enrichmentPending: true` + show UI warning if the write fails:
```js
try {
  await fbDb.collection('pedidos').doc(entry._fsId).update({
    lines: _linesEnriched,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
} catch (e) {
  console.error('update pending lines', e);
  if (typeof showSyncTag === 'function') showSyncTag('ERROR: no pude actualizar las lineas del pedido — refresca y reintenta');
  if (typeof logError === 'function') logError('pedido_enrich_fail', { pedidoId: entry._fsId, err: e.message });
}
```

#### S5. `doConfirmDefinitivoFromReview` fire-and-forget `.update({ stage: 'confirmed' })`
- **File:** `src/domains/pedidos-modal.js:842-851`
- **Code snippet:**
```js
if (entry._fsId && currentUser) {
  fbDb.collection('pedidos').doc(entry._fsId)
    .update({ stage: 'confirmed', finalizedAt: new Date().toISOString() })
    .then(() => showSyncTag('Pedido confirmado definitivamente'))
    .catch((e) => {
      console.error('confirm def', e);
      alert('Error: ' + (e.message || e));
    });
}
if (!confirmed[key]) confirmed[key] = [];
confirmed[key].push(Object.assign({}, entry, { finalizedAt: new Date().toISOString() }));
saveConfirmed();
pending[key] = list.filter((_, i) => i !== idx);
if (!pending[key].length) delete pending[key];
savePending();
closePedidoModal();
setPedidoView('confirmados');
```
- **Why dangerous:** The local `confirmed[]` push and `savePending()` happen SYNCHRONOUSLY before the Firestore promise resolves/rejects. If `.update()` fails, the alert fires but by then the local state has already moved the pedido to "confirmados" view — user sees it as confirmed, server state unchanged. On refresh, Firestore `onSnapshot` brings the pedido back to pending because `stage !== 'confirmed'` → **flapping UI, user confusion, pedido lost in UI noise**. Worse: the trigger `onPedidoConfirmedSendToSap` NEVER fires because the stage field never updated → **pedido never goes to SAP**.
- **Hidden errors:** permission-denied (VDE confirming VDI's pedido = rules reject), Firestore offline, closed-session token, concurrent update conflict.
- **Analogous past incident:** v469 "pending fantasma" — divergence between local optimistic and server state. Also LAMORA (client-side gate but server flow bypassed).
- **User impact:** Vendor thinks pedido is confirmed. SAP never gets the SQ. Admin discovers days later when reconciling.
- **Fix:** `await` the write BEFORE moving local state:
```js
if (entry._fsId && currentUser) {
  try {
    await fbDb.collection('pedidos').doc(entry._fsId).update({ stage: 'confirmed', finalizedAt: new Date().toISOString() });
  } catch (e) {
    console.error('confirm def', e);
    alert('No pude confirmar en Firestore: ' + (e.message || e) + '\nEl pedido NO se marcó como confirmado. Refresca y reintenta.');
    return;  // ← do NOT mutate local state if server rejected
  }
}
// only now mutate local caches
if (!confirmed[key]) confirmed[key] = [];
...
```

#### S6. `syncSapQuotationClosures` anti-race NumAtCard GET: fail-open silently on error
- **File:** `functions/core/sync-sap-quotation-closures-core.js:331-336`
- **Code snippet:**
```js
try {
  const escaped = String(c.id).replace(/'/g, "''");
  const rSo = await sapGet(session, '/b1s/v1/Orders?$filter=...', deps);
  if (rSo.status === 200) { ... }
} catch (e) {
  log('[sync-quot-closures] anti-race NumAtCard GET fallo (fail-open)', {...});
}
if (derivedSo) { ... /* race victim rescue */ }
// FALL THROUGH: if GET failed, derivedSo stays null → treated as "no SO derived" → closes pedido with `sap_manual_close`
```
- **Why dangerous:** The anti-race guard is explicitly fail-open (log says so). If the GET to SAP fails for ANY reason (timeout, SL re-login needed, 5xx, parse error), `derivedSo` is null and the function proceeds to close the pedido with `closedReason: 'sap_manual_close'`. **This is the race-victim trap that this v1102 rewrite was meant to CLOSE.** Fail-open means a transient SAP hiccup WILL close pedidos erroneously, and the user then needs the `scripts/repair-quotation-closure-race-victims.mjs` manual fix (v1102 comment confirms this exists).
- **Hidden errors:** SAP SL 5xx under load, session cookie expired, timeout past 90s, encoded apostrophe edge case.
- **Analogous past incident:** SOLEDAD SANCHEZ race victim 2026-09-29 (SQ 2000241 → SO 20056) — exact same pattern.
- **User impact:** Pedido disappears from Planner "Pending" column, gets marked `closedManuallyInSap: true` + `closedAt`. Admin thinks it was closed in SAP. Order fulfillment lost. Dollar amount depends on pedido size.
- **Fix:** Change to fail-closed — if GET fails, skip this candidate (do NOT close) and leave for next tick:
```js
} catch (e) {
  log('[sync-quot-closures] anti-race NumAtCard GET fallo — SKIP (fail-closed)', {...});
  errors++;
  continue;  // ← do not fall through to close the pedido
}
```

#### S7. `handleSapProxy` cookie extraction returns 'unavailable' but doesn't trigger SAP alert
- **File:** `functions/core/sap-proxy-core.js:301-304`
- **Code snippet:**
```js
const cookie = extractSessionCookies(loginRes.headers.get('set-cookie'));
if (!cookie) {
  throw makeHttpsError('unavailable', 'SL no devolvió cookies de sesión.');
}
```
- **Why dangerous:** When SAP SL changes behavior (e.g., switches to Secure+SameSite cookies on https upgrade, or the regex in `extractSessionCookies` doesn't match a new format), the proxy throws `unavailable`. The client (`src/sap-client.js:127-131`) catches it and returns `{ ok: false, status: 0, error: 'callable(unavailable): ...' }` — this is treated as a transient error in `enviarPedidosASAPViaServiceLayer`. The UI alerts "FALLO" but nothing escalates to Sentry/alerting. If this happens org-wide (SAP cert renewal, Seidor config change), **every pedido fails silently** until someone notices manually.
- **Hidden errors:** SAP cookie format change, HTTP/2 header split, response Set-Cookie quirk, upstream proxy stripping.
- **Analogous past incident:** CLAUDE.md §22 — AppCheck propagation delay bug where logs said OK but requests failed.
- **User impact:** All SAP integrations down, no proactive alert. VDEs discover the problem on next pedido send.
- **Fix:** Add Sentry/logError + `app_config/sap_sl_health` write when login happens but no cookie extracted. The health check CF already exists; broaden to catch this.

#### S8. `invoice-sync-core` sapLogin failure: cursor silently preserved, retries all invoices forever
- **File:** `functions/core/invoice-sync-core.js:408-422`
- **Code snippet:**
```js
let session;
try {
  session = await sapLogin(deps);
} catch (e) {
  errors.push(`sapLogin: ${String(e)}`);
  return {
    cursorBefore,
    cursorAfter: cursorBefore,
    invoicesRead: 0, matches, orphans, errors, mode,
  };
}
```
- **Why dangerous:** If SL login keeps failing, the CF returns silently every 15 minutes with `errors=['sapLogin: ...']` logged but the `sap_sync_log` write still succeeds (line :249-247 of `index.js` wrapper). No alert fires. Mariano can't see from the UI that invoice sync is dead unless he actively opens the Panel de Control. Impact: **invoiced pedidos stay in `Pending de facturar` column indefinitely**, Planner column drift grows, downstream `paidStatus` sync also fails because no invoiced pedidos appear.
- **Hidden errors:** SAP creds rotated and secret not updated, SL maintenance window, SAP server rejected concurrent sessions limit.
- **Analogous past incident:** `username vs userName` — all logs said "sapConfig incompleto", nobody looked for weeks.
- **User impact:** Days-long Planner stale data. Potentially missed cobranza follow-ups.
- **Fix:** Write to `app_config/sap_sl_health` with `invoiceSyncFailedConsecutively: N` + persist. Panel de Control card already has `sap_sl_health` wired — surface this count. Also add Sentry alert if consecutiveFailures >= 3.

## IMPORTANT — degrades reliability but not fatal

#### I1. `markLinesCancelled` runs AFTER SAP cancel but failure is only `errors.push` — half-committed state
- **File:** `functions/core/sq-cancel-core.js:289-299` (also `:410-414`)
- **Code snippet:**
```js
const cancel = await cancelSqInSap(deps, c.sapDocNum);
if (!cancel.ok) {
  errors.push(`pedido ${c.pedidoId} SQ ${c.sapDocNum}: ${cancel.error}`);
  continue;
}
try {
  await markLinesCancelled(deps, c);
  cancelledCount++;
} catch (e) {
  errors.push(`pedido ${c.pedidoId} markLines: ${String(e)}`);
}
```
- **Why dangerous:** SAP cancel succeeded → SQ dead in SAP. Firestore update fails → lines still show `state='confirmed'` in app. User sees pedido as still active, tries to send to SAP again → `findQuotationByNumAtCard` idempotence hit on the cancelled SQ → confusing state. Even worse, if admin tries manual batch send, the pre-check idempotent will find the cancelled SQ and refuse to re-send.
- **Hidden errors:** Firestore quota, race with another writer, transaction retry exhausted.
- **Analogous past incident:** FATECHI (half-committed between SAP + app).
- **User impact:** Mismatched state until admin manually syncs.
- **Fix:** Compensating action — if `markLinesCancelled` fails, write a `pending_reconciliation` doc to Firestore so a nightly job can retry (or a Sentry alert fires).

#### I2. SAP mapping load failure is non-blocking → may send pedido with blank CardCode
- **File:** `functions/index.js:783-787`
- **Code snippet:**
```js
try {
  const [cliSnap, prodSnap, venSnap] = await Promise.all([
    db.collection('sap_clients').get(),
    db.collection('sap_products').get(),
    db.collection('sap_vendors').get(),
  ]);
  // ... populate maps
} catch (mapErr) {
  console.warn('onPedidoConfirmedSendToSap: mapping load failed (non-blocking)', {
    err: mapErr?.message || String(mapErr),
  });
}
```
- **Why dangerous:** If the mapping Firestore reads fail, the function proceeds with empty `sapClients`, `sapProducts`, `sapVendors` maps. `resolveCardCode` falls back to the pedido's `clientCardCode` (persisted at confirm time), which usually works — but `resolveItemCode` returns the appCode unchanged (which may be wrong, e.g. missing leading-zero normalization), and `resolveSlpCode` returns `-1` so SAP shows "sin asignar". Commission attribution is lost for that pedido.
- **Hidden errors:** Firestore permission transient failure, quota, offline.
- **User impact:** Pedido reaches SAP but with wrong product codes (SAP rejects with 23105-like error or imports the wrong SKU) and no SlpCode (commission orphan).
- **Fix:** Fail-close — if ANY of the three gets fail, skip the CF and leave the pedido pending with a visible `transferError` marker:
```js
} catch (mapErr) {
  console.error('onPedidoConfirmedSendToSap: mapping load failed — SKIP (fail-safe)', {...});
  await db.doc(`pedidos/${pedidoId}`).update({
    transferError: { message: 'sap_mappings_load_failed: ' + mapErr.message, needsManualIntervention: true },
  });
  return;
}
```

#### I3. `getUserVendor` fallback on failure uses `pedido.ownerVendor` — SecAudit protection weakened
- **File:** `functions/core/auto-send-sap-core.js:439-451`
- **Code snippet:**
```js
let trueVendor = null;
const ownerUid = String(afterData?.ownerUid || '').trim();
if (deps.getUserVendor && ownerUid) {
  try {
    trueVendor = await deps.getUserVendor(ownerUid);
  } catch (e) {
    // Non-fatal: cae al fallback pedido.ownerVendor + loguea.
    log('[auto-send] getUserVendor fail', {...});
  }
}
```
- **Why dangerous:** The v991 SecAudit fix explicitly says this: resolve vendor server-side instead of trusting the pedido field (which a hostile VDE can spoof via devtools). But if the `roles/{uid}` read fails, `trueVendor` stays `null` and `buildQuotationPayload` falls back to `pedido.ownerVendor` — reopening the spoof vector.
- **Hidden errors:** Firestore quota, permission (SA rules reject), transient read error.
- **User impact:** Low likelihood but high consequence — commission fraud via spoofed `ownerVendor`.
- **Fix:** Fail-closed: if `getUserVendor` throws, abort the send:
```js
} catch (e) {
  log('[auto-send] getUserVendor FAIL — SKIP (fail-safe)', {...});
  await docRef.update({
    sendingSapLock: deps.FieldValue.delete(),
    transferError: { message: 'vendor_lookup_failed: ' + e.message, needsManualIntervention: true },
  });
  return { result: AUTO_SEND_RESULT.ERROR_SL, error: 'vendor_lookup_failed' };
}
```

#### I4. `isEnabled()` returns silent `false` when `sapConfigCache` fails to load
- **File:** `src/domains/sap-service-layer.js:65-68` + `:54-62`
- **Code snippet:**
```js
isEnabled() {
  this.loadConfig();
  return this.config.enabled && this.config.url && this.config.companyDB && this.config.username;
},
loadConfig() {
  const sl = sapConfigCache && sapConfigCache.serviceLayer ? sapConfigCache.serviceLayer : {};
  this.config = { enabled: !!sl.enabled, url: sl.url || '', companyDB: sl.companyDB || '', username: sl.username || '' };
  return this.config;
},
```
- **Why dangerous:** If `sapConfigCache` has not loaded yet (race with login), `isEnabled()` silently returns false. The caller (`ensureSapAutoSendListener` at `src/domains/sap-auto-send-listener.js:32-45`) interprets this as "not eligible" and tears down the listener. Then when `sapConfigCache` eventually loads, nothing re-fires the listener → listener stays dead until next full page reload.
- **Hidden errors:** First-load race between auth + `app_config/sap_integration` snapshot.
- **User impact:** Admin opens app, listener never activates, pedidos only go to SAP via CF trigger (which requires v999 fix to work).
- **Fix:** Add a `sapConfigLoadedAt` guard and have the config listener re-call `ensureSapAutoSendListener` after each refresh. (Already partially done via `renderSapConfig` call-chain, but should be verified end-to-end.)

#### I5. Empty catch at `fbDb.collection('revision_waitlist').doc(_waitlistIdToDelete).delete().catch(_e => {})`
- **File:** `index.html:22218-22220`
- **Code snippet:**
```js
if (_waitlistIdToDelete && typeof fbDb !== 'undefined' && fbDb) {
  setTimeout(() => {
    try {
      fbDb.collection('revision_waitlist').doc(_waitlistIdToDelete).delete().catch(_e => {
        // Silencioso — el .then() del add() ya podria haberlo borrado.
      });
    } catch (_e) { /* silencioso */ }
  }, 500);
}
```
- **Why dangerous:** The CLAUDE.md §28 feedback and the v469 "pending fantasma" precedent prove that these waitlist cleanup races matter. If the setTimeout delete fails AND the add's `.then()` chain also fails (which was the whole reason ANA LORENA FUENTES ORDEN 228 incident happened), the waitlist stays orphan AND the user sees it in both "lista de espera" and "confirmados".
- **Hidden errors:** permission-denied (VDE deleting another VDE's waitlist entry), quota, offline.
- **Analogous past incident:** ANA LORENA FUENTES 2026-09-24 — exact same scenario (ref: CLAUDE.md v1058 `onPedidoCreatedCleanupWaitlist` trigger comment).
- **User impact:** Phantom waitlist entries. Confusing UI.
- **Fix:** The server-side trigger `onPedidoCreatedCleanupWaitlist` already backs this up. But still, this client-side empty catch should at least log to `logError` so we have telemetry if the server trigger ALSO fails.

#### I6. `logOp` catches error with `console.warn` and swallows — audit log holes
- **File:** `index.html:12116-12128`
- **Code snippet:**
```js
async function logOp(action, entityType, entityName, details){
  if (!currentUser) return;
  try {
    await fbDb.collection('operations_log').add({ ... });
  } catch(e) { console.warn('logOp', e); }
}
```
- **Why dangerous:** Audit log holes are the WORST silent failure for security review. If a user does something destructive and `logOp` fails (quota, offline, perms), the operation still succeeds but there's no audit trail. CLAUDE.md §28 says this project is paranoid about financial reconciliation; audit log is key.
- **Hidden errors:** Firestore quota (free-tier limits), offline, permission transient failure.
- **User impact:** Forensic investigation gaps.
- **Fix:** Queue failed logs to localStorage + retry on next session. Pattern:
```js
} catch(e) {
  console.warn('logOp', e);
  try {
    const pending = JSON.parse(localStorage.getItem('_opsLogPending') || '[]');
    pending.push({ action, entityType, entityName, details, at: new Date().toISOString() });
    localStorage.setItem('_opsLogPending', JSON.stringify(pending.slice(-500)));
  } catch (_le) {}
}
```

#### I7. `onPedidoCreatedCleanupWaitlist` fail-close silencioso con `console.error` sin re-throw
- **File:** `functions/index.js:2304-2312`
- **Code snippet:**
```js
} catch (e) {
  // Fail-close silencioso — un error aca no debe bloquear el flujo de creacion
  // de pedidos. El path old client-side + script manual son fallbacks.
  console.error('[cleanup-waitlist] error (no-throw)', { pedidoId, waitlistId, err: ... });
}
```
- **Why dangerous:** The comment says "fallbacks" exist (client-side + manual script). But the client-side was explicitly removed because it was unreliable (v1058 docstring says so). So the only real fallback is the manual script `_cleanup_orphan_waitlist_228.py` — which requires Mariano to notice and run it. If this trigger fails silently, waitlists go orphan without any alert.
- **Analogous past incident:** v469 pending fantasma was exactly this race.
- **User impact:** Orphan waitlist entries, Lista de Espera shows pedidos that are already in Confirmados.
- **Fix:** On error, write to a `cleanup_failures` collection + log to Sentry. Then at least the manual script knows what to clean.

## MINOR — logs noise / annoying

#### M1. `setupGetMovimientos` fetchWindow catch returns `[]` silently
- **File:** `functions/index.js:1713-1718`
- **Code snippet:**
```js
} catch (err) {
  console.warn(`setupGetMovimientos: ventana ${w.desde}→${w.hasta} error=${err && err.message}`);
  return [];
}
```
- **Why dangerous:** Each window failure returns empty — the aggregate function doesn't know which windows failed vs really-empty. User sees fewer movimientos but no error.
- **User impact:** VDE thinks there are no shipments for that period, logistics data gap.
- **Fix:** Count windowErrors and surface in the response: `{movimientos, notasCount, windowsFailed}`.

#### M2. `_getCloudClient` returns null silently when `window.__phase0.sap` not loaded
- **File:** `src/domains/sap-service-layer.js:98-108`
- **Code snippet:**
```js
_getCloudClient() {
  if (!this._cloudClient) {
    if (!window.__phase0 || !window.__phase0.sap || !window.__phase0.sap.createSapClient) {
      return null;
    }
    this._cloudClient = window.__phase0.sap.createSapClient(firebase, { region: 'southamerica-east1' });
  }
  return this._cloudClient;
},
```
- **Why dangerous:** The caller `fetchWithSession` logs error + returns `{ok:false, error:'...'}` which is caught per-pedido in the batch handler. But the root cause (bundle not loaded = app totally broken) deserves a global alert banner, not per-pedido retry noise.
- **User impact:** Confusing per-pedido errors instead of "the app is broken, reload".
- **Fix:** Add global init assertion at boot.

#### M3. `getGmapsApiKey` falls back to null silently on Firestore read fail
- **File:** `src/domains/admin-users.js:156-171`
- **Code snippet:**
```js
async function getGmapsApiKey() {
  if (gmapsApiKeyCache) return gmapsApiKeyCache;
  try {
    const snap = await fbDb.collection('app_config').doc('google_maps').get();
    if (snap.exists) { ... return d.apiKey; }
  } catch (e) {
    console.warn('[gmaps] no se pudo leer api key', e);
  }
  return null;
}
```
- **Why dangerous:** Silent degradation to OSM Nominatim (worse rural AR coverage). User doesn't know their geocoding dropped quality.
- **User impact:** Lower-quality client address auto-complete, Mariano doesn't know why.
- **Fix:** Set a boot flag `_gmapsKeyLoadFailed` + show subtle UI badge in geocoding results so admin can investigate.

#### M4. `useOrDisabled auto-send-listener` legacy `app_only` writes without `transferError` cleanup
- **File:** `src/domains/sap-auto-send-listener.js:128-154`
- **Code snippet:** Writes `transferidoSAP = { via: 'app_only', ... }` + `transferError: FieldValue.delete()` BUT only on success paths. If the write itself fails, no indication to user.
- **Why dangerous:** Pedidos 100% BO silently stay without `transferidoSAP` marker if the write fails.
- **User impact:** Pedido stuck in Confirmados "awaiting SAP sync" state forever.
- **Fix:** Wrap in try/catch + persist a visible marker.

#### M5. `fifo-assign-core` empty catches on cliTipo fetch
- **File:** `functions/core/fifo-assign-core.js:114-116`
- **Code snippet:**
```js
} catch (_e) {
  return 'C';
}
```
- **Why dangerous:** Returning 'C' (regular client) as default on fetch error means a Platinum/A-tier client might get FIFO-deprioritized silently.
- **User impact:** Occasionally wrong FIFO ordering under read failures. Low frequency.
- **Fix:** Log the error at least once per run to surface pattern.

## Positive observations

- `onPedidoConfirmedSendToSap` (v818+v999+v1004+v1005+v1006+v1051+v1172+v1179+v1180) has become very defensive. The idempotent check (v1006 at `auto-send-sap-core.js:498-528`), the fail-safe stock recheck (v1180 at `:587-633`), and the fail-safe partial-degraded path (v1179 at `:636-711`) are textbook examples of how to turn silent failures into audible ones. Keep this pattern.
- `v999 HOTFIX` fix for `sl.username || sl.userName` was correctly applied to the one broken line (`functions/index.js:693`). Grep confirms other lines use the pattern already (CLAUDE.md §24).
- `src/sap-client.js:90-104` v1000 `getIdToken(true)` force-refresh IS correct for the batch-callable race. CLAUDE.md §25 is well-documented.
- `auto-send-sap-core.js:727-751` v1172 — the fail-safe POST ambiguity handling (DON'T release lock, mark `needsManualVerification`) is exactly the right pattern post-FATECHI.
- `invoice-sync-core.js:521-562` v1172 cursor rollback on applyInvoiceMatch failures prevents the silent-skip pattern that would have burned invoiced pedidos.
- `syncSapQuotationClosures` has anti-race fetch (v1095 → v1102 rewrite); the v1102 rewrite is sound EXCEPT the fail-open noted in S6.
- Server-side `onPedidoCreatedCleanupWaitlist` (v1058) correctly replaces the fragile client-side `_pendingWaitlistDelete` memory variable — right pattern per CLAUDE.md feedback #28.
- CLAUDE.md itself (§22, §24, §25, §28, §29.2) documents all the historical patterns — the project's own written memory is a strong signal that silent failures are taken seriously. But: multiple findings above show the memory doesn't close ALL gaps yet, especially in `sq-cancel-core.js` which was never audited against the shape-of-slFetch pattern.

## Recommended next actions

1. **Immediate (data-loss risk):** Fix S1 + S2 together (`sq-cancel-core.js`) — these are both dormant NOW but any deploy that fixes one half without the other opens FATECHI-style split-brain.
2. **This week:** S3 (planner duplicate emails), S4 (fire-and-forget pedido line enrichment), S5 (fire-and-forget stage=confirmed) — these are active silent failures.
3. **This sprint:** S6 (sync-quot-closures fail-open → fail-closed), S7 + S8 (SAP SL health monitoring surfacing).
4. **Add a smoke test (per CLAUDE.md §29.2):** write a `test/smoke/slFetch-contract.test.js` that verifies every consumer of `slFetch` unwraps `{status, body}` correctly. This would have caught S1 at commit time.
