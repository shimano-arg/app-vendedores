# Security Audit — 2026-10-13

## Executive summary

19 findings total: **4 CRITICAL / 8 IMPORTANT / 7 MINOR**. Top risk is cross-user data corruption via `onPedidoCreatedCleanupWaitlist` CF (any VDE can wipe another VDE's waitlist card by setting `waitlistOrigenId` to victim's doc id). Secondary risks are commission dashboard tampering (vendor can write `paidStatus`/`paidAmount`/`invoicedAmount` on own pedidos), broken Rules regex for public `alta-cliente` form (rejects valid CUIT with dashes, breaking the public submit flow), and public form forgery of `ownerUid`/`ownerVendor`. All critical AppCheck gaps remain open per CLAUDE.md section 22-23 and are tracked for separate rollout.

## Findings

### CRITICAL (immediate action needed)

#### C1. `onPedidoCreatedCleanupWaitlist` consumes victim's waitlist doc without ownership check

- **File:** `functions/index.js:2266-2314` (CF), consumed waitlist written via Admin SDK bypassing rules.
- **Issue:** The trigger reads `data.waitlistOrigenId` from the newly-created pedido and marks `revision_waitlist/{waitlistId}` as `stage='consumed'` using Admin SDK. No check that the pedido owner equals the waitlist owner (or any related mapping). Firestore rules (lines 102-118) permit any `vendedor` to create a pedido with any value in `waitlistOrigenId` (not in a hasOnly restricted set at create time).
- **Exploit:** VDE A opens devtools, creates `pedidos/{autoId}` with `{ ownerUid: self.uid, ownerVendor: self.vendorKey, waitlistOrigenId: '<victim_waitlist_doc_id>', ... }`. The trigger fires immediately and sets victim's waitlist card `stage='consumed'` + `consumedByPedidoId=self_pedido_id`. The victim loses visibility of the entry in `revision_waitlist`. Vector enables bulk destruction of pending orders (DoS of waitlist UI) + audit trail poisoning (consumedByPedidoId points to attacker's pedido). ANA LORENA FUENTES orden 228 incident (2026-09-24) shows the inverse race already caused visible damage; this is the reverse exploitation.
- **Fix:** In the CF, before writing `stage='consumed'`, read the waitlist doc and compare `wData.ownerUid` with pedido `data.ownerUid` (or any explicit owner). If mismatch and caller is not `admin`/`gerente`/`interno`, log + skip:
  ```
  if (wData.ownerUid && wData.ownerUid !== data.ownerUid &&
      !['admin','gerente','interno'].includes(await getRole(data.ownerUid))) {
    log('[cleanup-waitlist] owner mismatch, SKIP', { pedidoWaitlistId: waitlistId });
    return;
  }
  ```
  Also add Firestore rule for pedido create to require `waitlistOrigenId == null || resource at /revision_waitlist/{waitlistOrigenId}.ownerUid matches ownerUid or isAdminOrGerente || isInterno`.
- **Effort:** small

#### C2. Vendor can tamper commission/dashboard fields on own pedidos (`paidStatus`, `paidAmount`, `invoicedAmount`)

- **File:** `firestore.rules:164-169` (vendor update whitelist includes `paidStatus`, `paidAmount`, `paidToDate`, `invoicedAmount`, `paidSyncedAt`, `plannerStage`).
- **Issue:** The `hasOnly` whitelist for vendor `update` on `pedidos/*` was extended for Planner Kanban. It includes payment-sync fields that are supposed to be exclusively written by server-side CFs (`syncSapPaymentsToApp`, `syncSapOrdersToApp`, `syncSapDocTotalsToApp`). The CF overwrites every 15-30 min with SAP's truth, but during the window a VDE can set `paidStatus='paid'`, `paidAmount=<arbitrary>`, `invoicedAmount=<arbitrary>` on own `pedidos/{id}` directly from devtools.
- **Exploit:** VDE at end of month devtools-writes `paidStatus='paid'` on all own non-paid pedidos. Pedidos migrate to "Cobrado" column in Planner Kanban (per `planner-compute-column.js` rules 1-2), inflating commission dashboards + Mariano's end-of-month view. Even if the CF resyncs within 15min, batch screenshots during that window justify commission payouts. `invoicedAmount` tampering has the same effect for the "facturado" metric.
- **Fix:** Split the vendor whitelist into two sections: fields VDE legitimately needs to edit pre-transfer (`lines`, `netAmountArs`, `discountPct`, `formaEntrega`, `observaciones`, etc.) and fields that are server-sync only (`paidStatus`, `paidAmount`, `paidToDate`, `invoicedAmount`, `paidSyncedAt`, `transferidoSAP.*`). Remove the sync fields from `vendor` write path. If a VDE legitimately needs to drag a pedido to another column in the UI, make that a callable CF (`updatePlannerStageCF`) with role gate instead of direct Firestore write.
- **Effort:** small (rule change) + medium (if a dedicated callable CF for drag-to-column is wanted)

#### C3. Public `alta-cliente` form is broken: Rules regex rejects valid CUIT with dashes

- **File:** `firestore.rules:442` (regex `cuit.matches('[0-9]{11}')`) + `alta-cliente.html:77` (input placeholder `20-12345678-9`, no dash stripping before `db.collection('client_applications').add({ cuit: r('ac-cuit'), ... })` on line 257).
- **Issue:** v1172 Security C-01 added `cuit.matches('[0-9]{11}')` to the rule. But the client submits the raw input value (dashes included). The regex requires a substring of 11 consecutive digits — "20-12345678-9" has runs of 2, 8, and 1 digits (max 8), so it does NOT match. All CUITs typed with dashes fail with "permission-denied". Users who type dashes (as the placeholder suggests) cannot submit.
- **Exploit:** This is primarily a functional/availability issue — legitimate external customers can't submit. BUT: a security-adjacent angle: attackers can bypass the length check by submitting exactly 11 digits (`"20123456789"`) with no verification of CUIT check-digit validity. The rule only guards against trivial garbage, not valid-looking fakes. Combined with the fact that the form is unauthenticated, this means the only real defense is the 1.5MB size cap.
- **Fix:**
  1. **Immediate (fix availability):** in `alta-cliente.html:257` strip non-digits before submit:
     ```
     cuit: r('ac-cuit').replace(/\D/g, ''),
     ```
  2. **Harden rule:** anchor regex (`^[0-9]{11}$`) AND add CUIT checksum validation (Modulus 11 — can be done in Rules with a helper, or move to a CF `submitAltaCliente` that validates fully + rate-limits).
  3. **Consider migrating photos to Storage with signed URL** — the 1.5MB cap on the doc is a brittle defense when `fotosLocal[]` can be base64. Already noted as TODO in rules comment line 254.
- **Effort:** small (fix 1-2); medium (option 3)

#### C4. Weak client-side password gate hashes (unsalted-fast SHA-256) stored readable by admin/gerente

- **File:** `index.html:25278` (`DEFAULT_USER_PASSWORD = 'Shi0*'`), `index.html:25280-25290` (`hashPasswordSHA256`: single-round SHA-256 with 8-byte salt), `firestore.rules:59-65` (admin+gerente can read ANY `roles/{uid}` incl. `passwordHash`, `passwordSalt`, `totpSecret`).
- **Issue:** Three combined weaknesses:
  1. **Fast hash:** Single-pass SHA-256 is designed to be fast. GPUs crunch billions/sec. With 8-byte random salt and a 4-char-min password, offline crack of common patterns ("Shi0*", "Shimano1", etc.) finishes in seconds.
  2. **Default password:** `Shi0*` is hard-coded. Any admin/gerente with read access to `roles` can enumerate users where `passwordHash == hash("Shi0*", salt)` and immediately gain their Google-SSO-bypass creds.
  3. **Readable by admin+gerente:** Rules line 59-65 allow admin/gerente to read entire `roles/{uid}` docs. `passwordHash` + `passwordSalt` + `totpSecret` are exposed to admin and gerente roles via plain Firestore reads.
  Additionally the password gate check happens entirely client-side — an attacker with a stolen Google ID token can simply skip the gate by not invoking `ensurePasswordGate()` (there's no server-side enforcement). Combined with weak client-stored secret, this is defense-in-depth that doesn't actually defend.
- **Exploit:**
  - Malicious admin/gerente runs: `fbDb.collection('roles').get()` --> gets all `passwordHash`+`passwordSalt`+`totpSecret` --> cracks offline (unsalted-fast SHA-256) OR directly reads TOTP secret to generate codes.
  - Attacker with any @shimano Google token (ex-employee token not revoked, OAuth phish, device left unattended): bypasses password gate by DOM manipulation or by calling `fbDb.collection('pedidos').add(...)` directly from devtools — the gate only guards the UI, not Firestore.
- **Fix:**
  1. **Short-term:** restrict role doc field access: use `allow read: if ...` with field projection (not supported directly in Rules — needs a split into subcollection `roles/{uid}/credentials` that only the owner can read).
  2. **Medium-term:** replace client-side gate with server-side (CF `verifyPasswordGate` that does the hash + compare; return a short-lived signed cookie / custom claim). Use PBKDF2/scrypt/Argon2 (via `node:crypto` in CF) with 100k+ iterations.
  3. **Immediate:** rotate the default password away from `Shi0*` (change to a random per-user default + email delivery via SMTP, mirroring `sendPasswordResetEmail`).
  4. **TOTP secret:** must be moved out of client-readable Firestore (same mitigation as above). Current state: TOTP's single-factor security property is broken because admin can read the secret.
- **Effort:** medium (restructure roles/credentials subcollection) + large (full server-side gate)

### IMPORTANT (schedule within 2 weeks)

#### I1. Public form forges `ownerUid`/`ownerVendor`/`ownerEmail` via URL params

- **File:** `alta-cliente.html:142-144, 278-281` + `firestore.rules:420-444` (public form create path, no validation of `ownerUid`/`ownerVendor`).
- **Issue:** The public form reads `vendor`/`vendorName`/`vendorEmail` from `window.location.search` and writes them to `client_applications` as `ownerUid`, `ownerName`, `ownerEmail`. The Firestore rule for `submittedByPublicForm=true` doesn't validate that these fields point to real/consistent values.
- **Exploit:** Attacker crafts `https://.../alta-cliente.html?vendor=<victim_uid>&vname=Victim&vemail=victim@shimano.com.ar` and spam-submits plausible-looking leads. Leads appear in the victim VDE's "Mis solicitudes" list (via `.where('ownerUid','==',victim_uid)` in `notificaciones.js:113`). Clogs victim's queue with fakes + poisons analytics attributed to that VDE.
- **Fix:** The rule for `submittedByPublicForm` already allows unauthenticated. Add validation: if `submittedByPublicForm=true`, require `ownerUid == '__public__' || ownerUid is null`. Have the submit path NOT pass `vendorUid` into `ownerUid` — instead store it as `referredByVendorUid` and validate client-side only for display. Also tighten `assignedVendor` on public submits.
- **Effort:** small

#### I2. `allowed_emails` `get` reveals email existence to any authenticated user

- **File:** `firestore.rules:388-392`.
- **Issue:** `get` for `allowed_emails/{email}` is open to any authenticated. v934 split `list` to admin+gerente, but `get` still leaks: an attacker with any token can enumerate "does this specific email exist in whitelist?" by probing one doc id at a time. Enables targeted phishing (confirms email is a real @shimano user with app access).
- **Exploit:** Attacker logs in with any email (even unassigned role), DevTools: `for (const e of candidateEmails) await fbDb.doc('allowed_emails/' + e).get()`. Builds complete @shimano directory via trial. Confirms targets for phishing — the signal is high because match = active app user.
- **Fix:** Change `get` from `request.auth != null` to `isReader()`. The legitimate login flow (`index.html:21457, 21646`) is from users who already have a valid role — their `get` still works. Unassigned/orphan accounts cannot enumerate.
- **Effort:** small

#### I3. `waitlist-excels` Storage read is open to ANY authenticated user (incl. unassigned)

- **File:** `storage.rules:73-81`.
- **Issue:** Read rule is `allow read: if request.auth != null` — no role check, no ownership check. Any Firebase-authenticated user can read any VDE's uploaded Excel.
- **Exploit:** VDE A guesses or enumerates VDE B's UID (visible from pedido docs they can list), then: `firebase.storage().ref('waitlist-excels/<uid_B>/some_file.xlsx').getDownloadURL()`. Downloads VDE B's uploaded pricing/order data without authorization.
- **Fix:** Mirror the `isReader()` pattern used for `rendiciones` block:
  ```
  allow read: if isReader() && (
    request.auth.uid == ownerUid || firestore.get(/databases/(default)/documents/roles/$(request.auth.uid)).data.role in ['admin','gerente','interno']
  );
  ```
- **Effort:** small

#### I4. `pedidos` list access leaks all pedidos cross-vendor to `interno` without `onBehalfOf` scope

- **File:** `firestore.rules:92` (`allow list: if isAdminOrGerente() || isInterno() || (isVendor() && ownsDoc())`).
- **Issue:** `interno` (VDI) users get full `list` of all pedidos including those of VDEs they are NOT paired with. The `internalPartnerUid` field exists on `roles/{uid}` and could scope VDIs to their partner VDE's pedidos only.
- **Exploit:** A compromised `interno` account (Santi/Ioannis Google token stolen) can enumerate all pedidos in the system. Impact: client lists, pricing, margins, SAP card codes exposed cross-vendor-group.
- **Fix:** Change list rule for interno to use a partner map, or require explicit filter in queries (not enforceable at Rules level — would need a server callable `listPedidosForMe`). As a middle ground, keep interno `list` but set an alert on high-rate pedidos reads per interno uid.
- **Effort:** medium (requires rethinking VDI access model)

#### I5. Public form unauthenticated spam vector + no CF rate-limit on `client_applications` writes

- **File:** `alta-cliente.html:141-285` + `firestore.rules:420-444`.
- **Issue:** The public form (unauthenticated) was intended to be shared by VDEs via `?vendor=<their_uid>`. Any party can reshape the URL. Nothing prevents the form from being hotlinked/scraped — basic bot submits can fill `client_applications` with up to 1.5MB each (rule enforces this cap). Rate-limit at CF level is missing (the write is direct Firestore, no CF in the loop).
- **Exploit:** Scripted bot submits with valid-looking 11-digit CUIT + `submittedByPublicForm=true` + `vendorUid=A` can poison VDE A's queue with hundreds of leads/day until Mariano/admin notices. Also depletes Firestore writes quota.
- **Fix:**
  1. Route all public submits via a CF `submitAltaClienteCF` that: validates CUIT with check-digit, rate-limits by IP (CF-exposed via `functions.https.onRequest` not callable), writes with Admin SDK with proper `ownerUid='__public__'`.
  2. Add App Check for public forms (reCAPTCHA invisible) — currently App Check is only wired for authenticated callables.
- **Effort:** medium (new CF + Storage migration for photos)

#### I6. CSP uses `'unsafe-inline' 'unsafe-eval'` — defense ineffective against XSS

- **File:** `index.html:8`.
- **Issue:** Both `script-src 'unsafe-inline' 'unsafe-eval'` and `style-src 'unsafe-inline'` disable the main defenses of CSP. Any injected `<script>` or inline event handler executes; dynamic code evaluators work. Given the code has 190+ `innerHTML` writes (some going through `escapeHtml`, some not), CSP is the fallback that should block exploit payloads — but it doesn't.
- **Exploit:** Any XSS vector that gets a payload past `escapeHtml` or into non-sanitized sinks (e.g., `JSON.stringify + &quot; substitution` patterns described in codebase) executes without CSP intervention.
- **Fix:** Phase migration: generate per-page nonce (hard in a static index.html PWA, but possible via SW middleware), move inline `<script>` to `app.bundle.js`, remove inline event handlers (`onclick="..."`) in favor of `addEventListener`. Target `script-src 'self' 'nonce-xxx'` without `unsafe-eval`. Separate audit effort (3-5 days scope).
- **Effort:** large

#### I7. `?skipAppCheck=1` and `localStorage.debugSkipAppCheck=1` are user-controlled escape hatches

- **File:** `index.html:24203-24210`.
- **Issue:** Any user can disable App Check with a URL param or localStorage flag. The code acknowledges this is "safe because enforceAppCheck=false on 3 CFs" — but that's circular (the escape hatch is only safe because enforcement is already disabled; combined with the AppCheck rollout gap in CLAUDE.md section 23, there's no useful defense-in-depth). If enforcement is turned on later, this backdoor silently defeats it.
- **Exploit:** Attacker with a stolen token adds `?skipAppCheck=1` to session URL. All future requests skip reCAPTCHA. If sapProxy enforcement is enabled per the rollout plan, this backdoor still bypasses.
- **Fix:** Remove the escape hatch entirely. If needed for debug, guard with an authenticated `role === 'admin'` check post-login (gate the flag by role rather than by URL). Alternatively make it a build-flag only in dev builds, stripped at build time.
- **Effort:** small

#### I8. `functions/package.json` has 1 critical + 4 high dependency vulns (npm audit)

- **File:** `functions/package.json`, `functions/package-lock.json`.
- **Issue:** 16 vulns reported by `npm audit` (1 critical, 4 high, 11 moderate):
  - **CRITICAL** `proxy-addr` (IP spoofing via IPv4-mapped IPv6 trust subnet) — transitive via `firebase-functions`. CVE allows an attacker to forge their source IP in CF logs/rate-limit decisions. (`npm audit fix` resolves.)
  - **HIGH** `@grpc/grpc-js` (unauthorized certs returned as authorized by `getAuthContext`) — transitive. Impact: TLS auth bypass if any code path checks `getAuthContext`. Low exploitability here but still a defense gap.
  - **HIGH** `@fastify/busboy` (3 CVEs: DoS via oversized boundary, DoS via prototype-named part header, CRLF injection via Content-Disposition) — transitive. Impact: CF ingress parsing DoS.
  - **HIGH** `node-forge` (RSA PKCS#1 v1.5 signature verification bypass) — transitive via `firebase-admin`. Signature verification affected.
- **Fix:** Run `npm audit fix` in `functions/` (non-breaking) — resolves most. Separately: run `npm audit fix --force` + validate (bumps `firebase-admin` to 14.x; test suite needs to pass). Validate 670/670 unit tests remain green.
- **Effort:** small

### MINOR (nice to have / future)

#### M1. Default `userRole` for new accounts is `unassigned` but `userData/{uid}` has no role gate

- **File:** `firestore.rules:84-87` (`userData` write permits `request.auth.uid == uid` without role check).
- **Issue:** An unassigned user can scribble arbitrary data in own `userData` doc (low impact — only readable by self + admin/gerente/viewer).
- **Fix:** Add role gate on `userData` write: `isReader() && ...`. Low priority.
- **Effort:** small

#### M2. `isMariano()` hardcoded email checks replicate across rules and CFs

- **File:** `firestore.rules:48-54`, `functions/core/trigger-rendiciones-email-core.js:46-47`, `functions/core/planner-resend-email-core.js:21`, `storage.rules:93-100`.
- **Issue:** Mariano's two emails are hard-coded in 4+ places. If Mariano's email changes (or leaves company) multiple files need coordinated updates. If any one is missed, scoping diverges.
- **Fix:** Move to a Firestore doc `app_config/admin_users` or a custom claim `admin: true` on the Firebase Auth token. Reference it from both Rules (`request.auth.token.admin == true`) and CFs.
- **Effort:** medium

#### M3. `operations_log` and audit logs — write-false Rules don't prevent admin SDK deletion

- **File:** `firestore.rules:197-201, 651-665, 670-691`.
- **Issue:** The audit log rules prevent client-side mutations (good). However, the Firebase Console / Admin SDK can still delete these at will. There's no object-level immutability. For a sensitive audit trail (operations_log, sap_sync_log, sq_cancel_log) this is a gap.
- **Fix:** Mirror the audit log to BigQuery (append-only sink) OR enable Firestore PITR + document-level TTL. For strong guarantees, use Cloud Logging export (write-once bucket).
- **Effort:** medium

#### M4. `cors: true` on all callable CFs — could be origin-locked

- **File:** `functions/index.js` (sapProxy, geminiOcrProxy, updateAsigLineStateCF, setupGetMovimientos, triggerPlannerSync, triggerRendicionesEmailManual).
- **Issue:** `cors: true` allows preflight from any origin. Combined with `enforceAppCheck: false`, a token stolen from one browser can be replayed from an attacker-controlled site to invoke these CFs. Firebase callables encode auth in the body, so cross-origin attacks need valid tokens — but a leaked token is effectively a credential.
- **Fix:** Explicit origin allowlist: `cors: ['https://shimano-arg.github.io', 'https://app-vendedores-shimano.web.app']`. Reduces blast radius of leaked tokens.
- **Effort:** small

#### M5. `rate_limits/{uid}` counter is user-aware but not IP-aware

- **File:** `functions/core/rate-limit-core.js`.
- **Issue:** Rate limit per uid is good for auth'd flows. For unauthenticated public form submits (`client_applications` + future `submitAltaClienteCF`), per-IP rate limit is still missing.
- **Fix:** When implementing I5's CF, add IP-based rate limit using `request.rawRequest.ip` (Firebase CF v2 exposes it via `onRequest`).
- **Effort:** small

#### M6. `allowed_emails` whitelist is leveraged pre-auth in login flow but has no account-lockout on failures

- **File:** `index.html` login flow + no lockout mechanism visible.
- **Issue:** No rate-limit on login attempts for Firebase Auth with email/password. Firebase itself has some throttling but doesn't lock the account after N failures.
- **Fix:** Implement Firebase Admin SDK call `admin.auth().updateUser(uid, { disabled: true })` from a CF triggered by N failed signins in Y minutes. Related to Firebase's own `enforceAuthorizationHeader` and Identity Platform MFA.
- **Effort:** medium

#### M7. `log` output in sapProxy CF lacks response-size and query-pattern fields — can't detect exfil patterns

- **File:** `functions/core/sap-proxy-core.js:338-344` and other CFs.
- **Issue:** Audit log is useful but lacks response size (`body.length`), SQ pagination count, or whether user is scraping with pattern GET /BusinessPartners?$skip=0,20,40... Can't flag abnormal patterns.
- **Fix:** Add structured log: `{status, bodyBytes, resource, method, skipParam, uid, role}` — enables Cloud Logging alerts on anomalies (e.g., single uid with 100 reads of BusinessPartners in 10 min).
- **Effort:** small

## Dependency vulnerabilities

Top vulnerable packages in `functions/package.json` (production only):

| Package | Severity | CVE / Advisory | Upgrade path |
|---|---|---|---|
| `proxy-addr` (transitive, `firebase-functions`) | critical | GHSA-jqcg-44mw-7w3h (IP spoofing via IPv4-mapped IPv6 trust) | `npm audit fix` |
| `node-forge` (transitive, `firebase-admin`) | high | GHSA-86w9-cpqp-85rv (RSA PKCS#1 v1.5 sig verify bypass) | `npm audit fix --force` --> firebase-admin 14.5.0 (breaking) |
| `@grpc/grpc-js` 1.14.0-4 (transitive) | high | GHSA-m9gg-hp2v-232j (unauthorized certs accepted) + GHSA-f596-whhp-79r4 (error msg disclosure) | `npm audit fix` |
| `@fastify/busboy` <=3.2.1 (transitive) | high | GHSA-xjh9-v7x6-24jw, GHSA-x8mw-p69m-v3mx, GHSA-gxm5-99cw-xjw9 (DoS + CRLF injection) | `npm audit fix` |
| `qs` 2.2.5-6.15.3 (transitive, express) | moderate | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g (DoS, limit bypass) | `npm audit fix` |
| `uuid` <11.1.1 (transitive, exceljs/gaxios) | moderate | GHSA-w5hq-g745-h8pq (buffer bounds check missing) | `npm audit fix --force` |
| `@vitest/mocker` (devDep, root) | moderate | GHSA-82fw-gwwq-j7x9 (path traversal in test runner) | `npm audit fix` |
| `adm-zip` <=0.6.0 (devDep via mapshaper, root) | high (x5) | GHSA-xcpc-8h2w-3j85, GHSA-vwc7-r8mq-g2x9, GHSA-7q85-xj36-vmfc, GHSA-rcw4-f5rp-g42v, GHSA-j5f4-cc29-5x44 | `npm audit fix` |
| `source-map-js` (transitive, root) | high | event-loop DoS | fix available |

**Recommended action:**
1. `cd functions && npm audit fix` (non-breaking, addresses proxy-addr critical + @grpc/grpc-js + busboy + qs).
2. Separately validate: `cd functions && npm audit fix --force` (upgrades firebase-admin to 14.x — run full `npm run test:functions` and `npm run test:unit` + staging deploy before shipping).
3. Root `npm audit fix` for devDeps (vitest, mapshaper) — low risk since these are build-time only.

Context: GitHub Dependabot shows 19 open alerts (1 critical, 7 high, 11 moderate) matching this view. Prior push warned about "1 critical + 9 high + 7 moderate + 2 low" — consistent.

## Positive observations

- **SA key referenced from Downloads folder, not committed:** `scripts/` and `functions/` don't contain service account JSON files; patterns reference external paths (good).
- **Secrets properly in GCP Secret Manager:** `SAP_SL_PASSWORD`, `GEMINI_API_KEY`, `GMAIL_APP_PASSWORD`, `SETUP_API_PASSWORD`, `GITHUB_DISPATCH_TOKEN` all use `defineSecret()` + `.value()` pattern. No hardcoded prod secrets.
- **Custom-claim-adjacent isMariano() check** uses Firebase Auth `token.email` which is signed by Firebase and cannot be spoofed from client. Good foundation; next step is proper custom claims (see M2).
- **Hardened `sapProxy` core (v917, v935):** whitelist of resources per role (admin/gerente/vendedor/interno), host allowlist (`shimano-sap.seidor.com.ar`), path traversal guards. Clean separation of core logic from CF wrapper (CLAUDE.md section 7).
- **Rate limits for 6 callables:** sapProxy, geminiOcrProxy, updateAsigLineState, setupGetMovimientos, triggerPlannerSync, triggerRendicionesEmailManual.
- **CodeQL alerts clean except one warning:** 29/30 historical alerts resolved. Only `actions/missing-workflow-permissions` on `bo-daily-audit.yml` is open (warning, not security critical).
- **Firestore rules use strict field whitelists for vendor updates** (`affectedKeys().hasOnly([...])`) — pattern applied consistently to `pedidos`, `client_master.defaultDelivery`, `client_applications`. Prevents field injection.
- **Server-side defense-in-depth for ASIG recycle:** role gate + ownership check + rate limit on `updateAsigLineStateCF`.
- **OCR anti-jailbreak + server-side validation of Gemini output** (v992): bounded enums, max importe check, string truncation.
- **AbortSignal.timeout on all SAP SL fetches** (v1172 C2): prevents orphan locks on CF timeout.
- **Audit log retention:** `sap_sync_log`, `sq_cancel_log`, `operations_log`, `asig_ttl_log`, `stock_assignment_log`, `asig_transitions`, `lead_merge_log` — all write-false client-side, read admin+gerente only.
- **Public form CSP** (`alta-cliente.html`): tighter than main app CSP; removed `unsafe-eval` + narrowed script-src.
- **Vendor's `pedidos` update rule guards sensitive fields** (`transferidoSAP`, `sendingSapLock`, `ownerUid`, etc.) — the escape via `paidStatus`/`paidAmount` (finding C2) is a recent regression from Planner Kanban work, not a long-standing gap.

---

## Paths referenced

- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\firestore.rules`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\storage.rules`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\index.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\package.json`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\sap-proxy-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\rate-limit-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\gemini-ocr-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\trigger-rendiciones-email-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\planner-stage-change-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\planner-compute-column.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\functions\core\asig-recycle-core.js`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\index.html`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\alta-cliente.html`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\package.json`
- `C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\.github\workflows\send-rendiciones-email.yml`
