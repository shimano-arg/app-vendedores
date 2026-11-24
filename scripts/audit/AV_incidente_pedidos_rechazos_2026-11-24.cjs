#!/usr/bin/env node
// @ts-check
/**
 * INCIDENTE PEDIDOS 2026-11-24 — Audit rechazos commitPedidoCF (v2)
 *
 * Lee operations_log (type='commit_pedido_rejected') de los últimos N días.
 *
 * SHAPE REAL (post-§64.2 v1448 + verificación 2026-11-24):
 *   - Base top-level: {type, errorCode, userId, userEmail, cardCode, draftId,
 *     origen, clientVersion, waitlistOrigenId, timestamp, errMessage}.
 *   - El 4to arg `extra` de logCommitRejection se mergea a TOP-LEVEL
 *     (Object.assign). Entonces por errorCode:
 *       - SNAPSHOT_TOO_OLD: snapshotAgeMs, snapshotAgeMinutes, snapshotUpdatedAt, ...
 *       - STOCK_CHANGED: skuDetails[], totalSkuChanged, totalUnitsToBO,
 *         serverSnapshotUpdatedAt, clientSnapshotProvided, ...
 *       - CLIENT_HAS_OPEN_WAITLIST: conflictingWaitlistId, conflictingOrderNumber, ...
 *       - PERMISSION_DENIED: reason, existingPedidoId, sapDocNum, sapDocEntry, via.
 *       - VALIDATION_ERROR: validationReason, validationData.
 *       - VERSION_OLD: minVersion, currentVersion.
 *       - VENDOR_UID_MISSING: vendorAssigned, clientName, cardCode, assignedVendorReason.
 *       - SKU_NOT_IN_SAP_CATALOG: missingSkus[], checkedCount.
 *       - UNRESOLVED_BO_ENTRY_ROWS: unresolvedCount, skus[].
 *       - CONTENTION_RETRY_EXHAUSTED: attempts, lastError.
 *
 * ⚠ ASIG_REF_INVALID — GAP de observabilidad confirmado (ver INCIDENTE_PEDIDOS_04):
 *   Los `throwError('ASIG_REF_INVALID', msg, {reason, pedidoOrigenId, lineIndex, ...})`
 *   en accumulateCancelAsigMutations tiran la data en `err._data` top-level,
 *   PERO el catch del retry loop lee `err._data._logExtra` (sub-nested) para
 *   construir el extra de logCommitRejection. Como ASIG_REF_INVALID no usa
 *   _logExtra, su extra queda vacío `{}` → `reason`/`pedidoOrigenId`/`lineIndex`
 *   NO se persisten en operations_log para ASIG_REF_INVALID.
 *   Los datos SÍ llegan al CLIENTE vía `makeError(...).data`, pero no al log.
 *   Documentado — NO se arregla acá (requiere tocar commit-pedido-core.js).
 *
 * Uso:
 *   node scripts/audit/AV_incidente_pedidos_rechazos_2026-11-24.cjs \
 *     --project app-vendedores-shimano \
 *     [--hours 48] \
 *     [--user <email>] \
 *     [--card <cardCode>] \
 *     [--errorCode ASIG_REF_INVALID] \
 *     [--limit 500] \
 *     [--dump-raw]           # vuelca el shape crudo del primer rechazo por errorCode
 *
 * READ-ONLY. Zero writes. Zero mutaciones a prod.
 */

const admin = require('firebase-admin');

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    project: 'app-vendedores-shimano',
    hours: 48,
    user: null,
    card: null,
    errorCode: null,
    pageSize: 500,         // v3: tamaño de página para paginación startAfter
    maxDocs: 5000,         // v3: safety cap total (sumado entre páginas)
    timelineN: 50,
    dumpRaw: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--project') out.project = args[++i];
    else if (a === '--hours') out.hours = Number(args[++i]) || 48;
    else if (a === '--user') out.user = String(args[++i] || '').toLowerCase();
    else if (a === '--card') out.card = String(args[++i] || '').toUpperCase().trim();
    else if (a === '--errorCode' || a === '--error-code') out.errorCode = String(args[++i] || '').toUpperCase();
    // Compat v2: --limit funcionaba como single-page cap. v3 lo mapea a pageSize.
    else if (a === '--limit') out.pageSize = Number(args[++i]) || 500;
    else if (a === '--page-size') out.pageSize = Number(args[++i]) || 500;
    else if (a === '--max-docs') out.maxDocs = Number(args[++i]) || 5000;
    else if (a === '--timeline') out.timelineN = Number(args[++i]) || 50;
    else if (a === '--dump-raw') out.dumpRaw = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: AV_incidente_pedidos_rechazos_2026-11-24.cjs [--project X] [--hours N] [--user EMAIL] [--card CARDCODE] [--errorCode CODE] [--page-size N] [--max-docs N] [--timeline N] [--dump-raw]');
      console.log('');
      console.log('  --page-size N   Tamaño de página Firestore (default 500).');
      console.log('  --max-docs N    Safety cap total de docs leídos (default 5000). Si se alcanza, marca scan como no-exhaustivo.');
      console.log('  --limit N       Alias legacy v2 — equivale a --page-size (pero ahora paginamos, no es cap total).');
      process.exit(0);
    }
  }
  return out;
}

function initAdmin(projectId) {
  if (admin.apps.length > 0) return admin.firestore();
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  } catch (e) {
    console.error('\nERROR: No se pudo inicializar firebase-admin con Application Default Credentials.');
    console.error('Corré primero:  gcloud auth application-default login');
    console.error('Y asegurate de tener seteado:  gcloud config set project ' + projectId);
    console.error('\nDetalle:', e && e.message ? e.message : e);
    process.exit(1);
  }
  return admin.firestore();
}

function pad(s, n) {
  const str = String(s == null ? '' : s);
  if (str.length >= n) return str.substring(0, n);
  return str.padEnd(n);
}

function padLeft(s, n) {
  const str = String(s == null ? '' : s);
  if (str.length >= n) return str.substring(0, n);
  return str.padStart(n);
}

function toIsoSafe(v) {
  if (!v) return '';
  if (typeof v.toDate === 'function') {
    try { return v.toDate().toISOString(); } catch (_e) { return ''; }
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.seconds != null) {
    return new Date(v.seconds * 1000).toISOString();
  }
  return '';
}

// Lector tolerante de fields anidados comunes por errorCode.
// Mira top-level primero (shape real post-§64.2), luego fallback a .data / ._data
// / .errorData para compat con shapes anteriores u otras CFs que loguearan distinto.
function readNested(doc, field) {
  if (doc[field] != null) return doc[field];
  if (doc.data && typeof doc.data === 'object' && doc.data[field] != null) return doc.data[field];
  if (doc._data && typeof doc._data === 'object' && doc._data[field] != null) return doc._data[field];
  if (doc.errorData && typeof doc.errorData === 'object' && doc.errorData[field] != null) return doc.errorData[field];
  if (doc.logExtra && typeof doc.logExtra === 'object' && doc.logExtra[field] != null) return doc.logExtra[field];
  if (doc._logExtra && typeof doc._logExtra === 'object' && doc._logExtra[field] != null) return doc._logExtra[field];
  return null;
}

async function main() {
  const opts = parseArgs(process.argv);
  const db = initAdmin(opts.project);

  const now = Date.now();
  const since = new Date(now - opts.hours * 60 * 60 * 1000);

  console.log('='.repeat(80));
  console.log('INCIDENTE PEDIDOS 2026-11-24 — Audit rechazos commitPedidoCF (v3)');
  console.log('='.repeat(80));
  console.log('Proyecto      :', opts.project);
  console.log('Ventana       :', since.toISOString(), '→ now  (', opts.hours, 'h )');
  console.log('Filtros       : user=' + (opts.user || 'ALL') + '  card=' + (opts.card || 'ALL') + '  errorCode=' + (opts.errorCode || 'ALL'));
  console.log('Page size     :', opts.pageSize, '  Max docs (safety cap):', opts.maxDocs);
  if (opts.dumpRaw) console.log('⚠ --dump-raw activado: se volcará el shape crudo del primer rechazo por errorCode.');
  console.log('');

  // v3: paginación iterativa startAfter hasta exhausto o safety cap.
  // Preserva orden DESC. Query es sólo por timestamp (single-field index automático).
  const docs = [];
  let totalCommitRejected = 0;
  let totalRead = 0;
  let pages = 0;
  let lastDoc = null;
  let hitSafetyCap = false;

  for (;;) {
    let q = db
      .collection('operations_log')
      .where('timestamp', '>=', since)
      .orderBy('timestamp', 'desc')
      .limit(opts.pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const page = await q.get();
    pages++;
    totalRead += page.size;
    page.forEach((doc) => {
      const d = doc.data();
      if (d.type === 'commit_pedido_rejected') {
        totalCommitRejected++;
        const matchErrorCode = !opts.errorCode || String(d.errorCode || '').toUpperCase() === opts.errorCode;
        const matchUser = !opts.user || String(d.userEmail || '').toLowerCase() === opts.user;
        const matchCard = !opts.card || String(d.cardCode || '').toUpperCase() === opts.card;
        if (matchErrorCode && matchUser && matchCard) {
          docs.push({ _id: doc.id, ...d });
        }
      }
    });
    if (page.size < opts.pageSize) break; // última página (menos que pageSize → no hay más)
    if (totalRead >= opts.maxDocs) { hitSafetyCap = true; break; }
    lastDoc = page.docs[page.docs.length - 1];
  }

  console.log('operations_log páginas leídas:', pages);
  console.log('operations_log docs totales  :', totalRead);
  console.log('commit_pedido_rejected total :', totalCommitRejected);
  console.log('Filtrados finales            :', docs.length);
  if (hitSafetyCap) {
    console.log('');
    console.log('⚠ SAFETY CAP ALCANZADO: se leyeron ' + totalRead + ' docs (>= --max-docs=' + opts.maxDocs + '). Scan NO exhaustivo.');
    console.log('  Subí --max-docs o achicá --hours. Los conteos de abajo cuentan solo lo leído.');
  } else {
    console.log('✓ Scan exhaustivo: ' + totalRead + ' docs leídos en ' + opts.hours + 'h.');
  }
  console.log('');

  if (docs.length === 0) {
    console.log('No se encontraron rechazos en la ventana con los filtros dados.');
    return;
  }

  // ========================================================================
  // DUMP raw (opcional) — primer doc por errorCode
  // ========================================================================
  if (opts.dumpRaw) {
    console.log('='.repeat(80));
    console.log('DUMP raw — primer rechazo por errorCode (para inspeccionar shape real)');
    console.log('='.repeat(80));
    const seenEcDump = new Set();
    for (const d of docs) {
      const ec = String(d.errorCode || 'UNKNOWN').toUpperCase();
      if (seenEcDump.has(ec)) continue;
      seenEcDump.add(ec);
      console.log('');
      console.log('--- ' + ec + ' (docId=' + d._id + ') ---');
      // Dump top-level keys only (no recursive) + value previews.
      const keys = Object.keys(d).sort();
      for (const k of keys) {
        let v = d[k];
        if (v && typeof v === 'object' && typeof v.toDate === 'function') {
          v = '[Timestamp ' + toIsoSafe(v) + ']';
        } else if (v && typeof v === 'object') {
          try {
            const s = JSON.stringify(v);
            v = s.length > 200 ? s.substring(0, 200) + '...(truncado)' : s;
          } catch (_e) { v = '[object]'; }
        } else if (typeof v === 'string' && v.length > 200) {
          v = v.substring(0, 200) + '...(truncado)';
        }
        console.log('  ' + pad(k, 28) + ' = ' + v);
      }
    }
    console.log('');
  }

  // ========================================================================
  // TABLA 1 — RESUMEN POR errorCode + sub-reason
  // ========================================================================
  /** @type {Record<string, { count: number, reasons: Record<string,number>, users: Record<string,number>, cards: Record<string,number> }>} */
  const byErrorCode = {};
  let asigRefInvalidSinReason = 0;
  for (const d of docs) {
    const ec = String(d.errorCode || 'UNKNOWN').toUpperCase();
    if (!byErrorCode[ec]) byErrorCode[ec] = { count: 0, reasons: {}, users: {}, cards: {} };
    const bucket = byErrorCode[ec];
    bucket.count++;
    const reason = readNested(d, 'reason');
    if (reason) {
      bucket.reasons[String(reason)] = (bucket.reasons[String(reason)] || 0) + 1;
    } else if (ec === 'ASIG_REF_INVALID') {
      asigRefInvalidSinReason++;
    }
    const user = d.userEmail || 'unknown';
    bucket.users[user] = (bucket.users[user] || 0) + 1;
    const card = d.cardCode || 'unknown';
    bucket.cards[card] = (bucket.cards[card] || 0) + 1;
  }

  console.log('='.repeat(80));
  console.log('TABLA 1 — RESUMEN POR errorCode');
  console.log('='.repeat(80));
  const codes = Object.keys(byErrorCode).sort((a, b) => byErrorCode[b].count - byErrorCode[a].count);
  for (const ec of codes) {
    const b = byErrorCode[ec];
    console.log('');
    console.log('errorCode: ' + ec + '  (' + b.count + ' rechazos)');
    console.log('-'.repeat(60));
    if (Object.keys(b.reasons).length > 0) {
      console.log('  reasons (sub-códigos):');
      const rs = Object.entries(b.reasons).sort((a, b) => b[1] - a[1]);
      for (const [r, c] of rs) console.log('    ' + padLeft(c, 5) + 'x  ' + r);
    } else if (ec === 'ASIG_REF_INVALID') {
      console.log('  ⚠ sin sub-códigos reason — gap confirmado (ver INCIDENTE_PEDIDOS_04 §4-§5).');
      console.log('  Los `throwError` tiran {reason, pedidoOrigenId, lineIndex} en err._data top-level,');
      console.log('  pero el catch del retry loop sólo lee err._data._logExtra. Los campos NO se');
      console.log('  persisten en operations_log para ASIG_REF_INVALID.');
      console.log('  Los datos SÍ llegan al CLIENTE vía err.data (se ven en DevTools Network tab).');
      console.log('  Para diagnosticar casos individuales: pedí capturas DevTools Network a los VDEs,');
      console.log('  o corré AX contra el cardCode del caso + inferí el reason desde la línea origen.');
    } else {
      console.log('  (sin sub-códigos reason — este errorCode no los usa)');
    }
    const topUsers = Object.entries(b.users).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log('  top 5 usuarios:');
    for (const [u, c] of topUsers) console.log('    ' + padLeft(c, 5) + 'x  ' + u);
    const topCards = Object.entries(b.cards).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log('  top 5 clientes:');
    for (const [cc, c] of topCards) console.log('    ' + padLeft(c, 5) + 'x  ' + cc);
  }

  // ========================================================================
  // TABLA 2 — TIMELINE CRONOLÓGICO
  // ========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('TABLA 2 — TIMELINE (últimos ' + opts.timelineN + ' rechazos)');
  console.log('='.repeat(80));
  console.log(
    pad('TIMESTAMP', 25) + ' | ' +
    pad('USER', 30) + ' | ' +
    pad('CARDCODE', 14) + ' | ' +
    pad('errorCode', 22) + ' | ' +
    pad('reason', 26) + ' | ' +
    pad('pedidoOrigenId', 22) + ' | ' +
    pad('lineIdx', 7) + ' | ' +
    pad('waitlistOrigenId', 22)
  );
  console.log('-'.repeat(180));

  for (const d of docs.slice(0, opts.timelineN)) {
    const ts = toIsoSafe(d.timestamp);
    const user = d.userEmail || '';
    const card = d.cardCode || '';
    const ec = d.errorCode || '';
    const reason = readNested(d, 'reason') || '';
    const pedidoOrigen = readNested(d, 'pedidoOrigenId') || '';
    const lineIdx = readNested(d, 'lineIndex');
    const waitlist = d.waitlistOrigenId || '';
    console.log(
      pad(ts, 25) + ' | ' +
      pad(user, 30) + ' | ' +
      pad(card, 14) + ' | ' +
      pad(ec, 22) + ' | ' +
      pad(reason, 26) + ' | ' +
      pad(pedidoOrigen, 22) + ' | ' +
      pad(lineIdx == null ? '' : String(lineIdx), 7) + ' | ' +
      pad(waitlist, 22)
    );
  }

  // ========================================================================
  // TABLA 3 — AGRUPACIÓN POR DRAFTID (reintentos repetidos)
  // ========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('TABLA 3 — AGRUPACIÓN POR draftId (reintentos del mismo pedido)');
  console.log('='.repeat(80));
  /** @type {Record<string, { count: number, min: string, max: string, lastErrorCode: string, user: string, card: string }>} */
  const byDraft = {};
  for (const d of docs) {
    const draft = d.draftId || '(sin-draft)';
    const ts = toIsoSafe(d.timestamp);
    if (!byDraft[draft]) {
      byDraft[draft] = { count: 0, min: ts, max: ts, lastErrorCode: '', user: d.userEmail || '', card: d.cardCode || '' };
    }
    const b = byDraft[draft];
    b.count++;
    if (ts && (!b.min || ts < b.min)) b.min = ts;
    if (ts && (!b.max || ts > b.max)) b.max = ts;
    if (!b.lastErrorCode) b.lastErrorCode = d.errorCode || '';
    if (!b.user && d.userEmail) b.user = d.userEmail;
    if (!b.card && d.cardCode) b.card = d.cardCode;
  }
  const draftsSorted = Object.entries(byDraft)
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30);

  if (draftsSorted.length === 0) {
    console.log('(ningún draftId con >= 2 rechazos — no hay reintentos repetidos del mismo pedido)');
  } else {
    console.log(
      pad('draftId', 40) + ' | ' +
      pad('count', 6) + ' | ' +
      pad('min', 25) + ' | ' +
      pad('max', 25) + ' | ' +
      pad('errorCode final', 22) + ' | ' +
      pad('user', 30)
    );
    console.log('-'.repeat(160));
    for (const [draft, v] of draftsSorted) {
      console.log(
        pad(draft, 40) + ' | ' +
        padLeft(v.count, 6) + ' | ' +
        pad(v.min, 25) + ' | ' +
        pad(v.max, 25) + ' | ' +
        pad(v.lastErrorCode, 22) + ' | ' +
        pad(v.user, 30)
      );
    }
  }

  // ========================================================================
  // PROPUESTA — PATRONES OBSERVADOS
  // ========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('PROPUESTA — PATRONES OBSERVADOS + HIPÓTESIS');
  console.log('='.repeat(80));

  const total = docs.length;
  const propuestas = [];

  const asigRefCount = (byErrorCode['ASIG_REF_INVALID'] || { count: 0 }).count;
  const internalCount = (byErrorCode['INTERNAL'] || { count: 0 }).count;
  const stockChangedCount = (byErrorCode['STOCK_CHANGED'] || { count: 0 }).count;

  if (asigRefInvalidSinReason > 0) {
    propuestas.push(
      asigRefInvalidSinReason + ' rechazos ASIG_REF_INVALID SIN reason persistido. ' +
      'Gap de observabilidad confirmado: los `throwError` del core NO envuelven la data en `_logExtra` ' +
      'como requiere el catch del retry loop. Ver INCIDENTE_PEDIDOS_04. ' +
      'Workaround hoy: corré AX contra el cardCode del caso para inferir el reason desde la línea origen.'
    );
  }

  if (internalCount / Math.max(total, 1) > 0.3) {
    propuestas.push(
      'ALTA PROPORCIÓN de INTERNAL (' + internalCount + '/' + total + ', ' +
      ((internalCount / total) * 100).toFixed(1) + '%). Indica bug NO de negocio. ' +
      'Stack traces vía gcloud logging (ver docs/incidente/comandos_gcloud_incidente_2026-11-24.md). ' +
      'INTERNAL tampoco se loguea a operations_log hoy — solo a Cloud Logging del service commitpedidocf.'
    );
  }

  if (asigRefCount / Math.max(total, 1) > 0.2) {
    propuestas.push(
      'ALTA PROPORCIÓN de ASIG_REF_INVALID (' + asigRefCount + '/' + total + ', ' +
      ((asigRefCount / total) * 100).toFixed(1) + '%). ' +
      'PR #1350 (v1555 cb7473c2, 2026-11-13) introdujo los 7 CHECKs semánticos; ' +
      'waitlists con asigRefs stale (post-reconcile §40.11, post-recorte §40.7, post-unify §42) ' +
      'ahora rebotan donde antes pasaban en silencio. Correr AX contra los top cardCodes de TABLA 1.'
    );
  }

  if (stockChangedCount / Math.max(total, 1) > 0.3) {
    propuestas.push(
      'ALTA PROPORCIÓN de STOCK_CHANGED (' + stockChangedCount + '/' + total + ', ' +
      ((stockChangedCount / total) * 100).toFixed(1) + '%). Correr script V ' +
      '(scripts/audit/V_stock_changed_falsos_positivos.cjs) para clasificar falsos positivos.'
    );
  }

  const draftHotspots = Object.entries(byDraft).filter(([, v]) => v.count >= 3).length;
  if (draftHotspots > 0) {
    propuestas.push(
      draftHotspots + ' draftId(s) con 3+ fallas consecutivas — mismo pedido rebota repetidamente. ' +
      'Ver TABLA 3 para los draftIds exactos.'
    );
  }

  const allUsers = {};
  for (const d of docs) {
    const u = d.userEmail || 'unknown';
    allUsers[u] = (allUsers[u] || 0) + 1;
  }
  const topUser = Object.entries(allUsers).sort((a, b) => b[1] - a[1])[0];
  if (topUser && topUser[1] / Math.max(total, 1) > 0.4) {
    propuestas.push(
      'UN USUARIO DOMINANTE: ' + topUser[0] + ' (' + topUser[1] + '/' + total + ' = ' +
      ((topUser[1] / total) * 100).toFixed(1) + '% de los rechazos).'
    );
  }

  if (propuestas.length === 0) {
    console.log('No se detectaron patrones agresivos. Rechazos distribuidos uniformemente.');
  } else {
    propuestas.forEach((p, i) => {
      console.log('');
      console.log('[' + (i + 1) + '] ' + p);
    });
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('FIN — audit AV v2 ' + new Date().toISOString());
  console.log('='.repeat(80));
}

main().catch((e) => {
  console.error('ERROR fatal:', e);
  process.exit(1);
});
