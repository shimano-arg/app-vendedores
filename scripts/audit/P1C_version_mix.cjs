#!/usr/bin/env node
// @ts-check
/**
 * Stack S-7 P1-C (v1588 2026-11-25) — Audit mix de versiones de clientes
 * y cuántos rechazos de commit vienen por versión stale.
 *
 * Lee operations_log + pedidos recientes para responder dos preguntas:
 *
 *   1. ¿Qué distribución de clientVersion hay en los pedidos / rechazos
 *      del día (o últimos N días)?
 *   2. ¿Cuántos rechazos de commit vienen de clientes con
 *      APP_VERSION < minVersion (si Mariano configuró minVersion)?
 *
 * Si `app_config/version_minima.minVersion` NO existe, el script sigue
 * corriendo pero marca "gate no configurado" y no clasifica por stale.
 *
 * Uso:
 *   node scripts/audit/P1C_version_mix.cjs [--days=N] [--full]
 *
 * Opts:
 *   --days=N   Lee los últimos N días (default 1).
 *   --full     Imprime detalle por entry (default: resumen por versión).
 *
 * El script NUNCA escribe (read-only). Útil para medir antes / después
 * del rollout cuando Mariano suba minVersion en Firestore.
 */

const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'app-vendedores-shimano' });
}
const db = admin.firestore();

function parseAppVersion(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/^v/i, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchMinVersion() {
  try {
    const snap = await db.collection('app_config').doc('version_minima').get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const mv = String(data.minVersion || '').trim();
    return mv || null;
  } catch (e) {
    console.warn('[audit P1C] no se pudo leer app_config/version_minima:', e.message);
    return null;
  }
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function printSortedCounts(label, map, topN) {
  const rows = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  console.log('\n' + label + ' (top ' + (topN || rows.length) + '):');
  const limit = topN || rows.length;
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const [k, v] = rows[i];
    console.log('  ' + String(k || '(sin valor)').padEnd(18) + ' ' + String(v).padStart(6));
  }
  if (rows.length === 0) console.log('  (sin datos)');
}

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) || 1 : 1;
  const full = args.includes('--full');

  const minVersionStr = await fetchMinVersion();
  const minVersionNum = parseAppVersion(minVersionStr);
  console.log('[audit P1C] minVersion configurado:', minVersionStr || '(sin gate)');
  if (minVersionStr && minVersionNum === null) {
    console.log('[audit P1C] WARNING: minVersion presente pero no parseable:', minVersionStr);
  }

  const now = Date.now();
  const since = new Date(now - days * 24 * 60 * 60 * 1000);
  console.log('[audit P1C] Ventana: últimos ' + days + ' día(s) desde ' + since.toISOString());

  // Fuente 1: operations_log type=commit_pedido_rejected (o cualquier commit log).
  // Filtramos localmente para no exigir índice compuesto nuevo.
  const logsSnap = await db
    .collection('operations_log')
    .where('timestamp', '>=', since)
    .orderBy('timestamp', 'desc')
    .limit(5000)
    .get();

  const rejByVersion = new Map();
  const rejByReason = new Map();
  const rejStaleByVersion = new Map();
  const preReloadByVersion = new Map();
  let totalRejects = 0;
  let totalPreReloads = 0;

  logsSnap.forEach((d) => {
    const data = d.data() || {};
    const t = data.type || '';
    if (t === 'commit_pedido_rejected') {
      totalRejects += 1;
      const cv = data.clientVersion || '(sin versión)';
      bump(rejByVersion, cv);
      bump(rejByReason, data.errorCode || 'UNKNOWN');
      if (minVersionNum !== null) {
        const localN = parseAppVersion(cv);
        if (localN !== null && localN < minVersionNum) bump(rejStaleByVersion, cv);
      }
    } else if (t === 'client_pre_confirm_reload') {
      totalPreReloads += 1;
      const cv = data.clientVersion || '(sin versión)';
      bump(preReloadByVersion, cv);
    }
  });

  // Fuente 2: pedidos creados en la ventana. Nos da el mix de versiones que
  // efectivamente llegaron al CF (no solo las que rebotaron).
  const pedidosSnap = await db
    .collection('pedidos')
    .where('createdAt', '>=', since.toISOString())
    .limit(5000)
    .get();

  const okByVersion = new Map();
  pedidosSnap.forEach((d) => {
    const data = d.data() || {};
    const cv = data.clientVersion || '(sin versión)';
    bump(okByVersion, cv);
  });

  console.log('\n=== RESUMEN ===');
  console.log('Pedidos creados (fuente /pedidos): ' + pedidosSnap.size);
  console.log('Rechazos commit_pedido_rejected: ' + totalRejects);
  console.log('Pre-confirm reloads (type=client_pre_confirm_reload): ' + totalPreReloads);
  if (minVersionNum !== null) {
    const staleTotal = Array.from(rejStaleByVersion.values()).reduce((a, b) => a + b, 0);
    console.log('Rechazos con APP_VERSION < minVersion (' + minVersionStr + '): ' + staleTotal + ' (' + (totalRejects > 0 ? ((100 * staleTotal) / totalRejects).toFixed(1) : '0') + '%)');
  }

  printSortedCounts('Pedidos OK por clientVersion', okByVersion, 10);
  printSortedCounts('Rechazos por clientVersion', rejByVersion, 10);
  printSortedCounts('Rechazos por errorCode', rejByReason, 15);
  if (minVersionNum !== null) {
    printSortedCounts('Rechazos stale (local < min) por clientVersion', rejStaleByVersion, 10);
  }
  if (totalPreReloads > 0) {
    printSortedCounts('Pre-reloads por clientVersion', preReloadByVersion, 10);
  }

  if (full) {
    console.log('\n=== DETAIL (limitado a 50 últimos rechazos) ===');
    let i = 0;
    logsSnap.forEach((d) => {
      if (i >= 50) return;
      const data = d.data() || {};
      if (data.type !== 'commit_pedido_rejected') return;
      i += 1;
      const t = data.timestamp && data.timestamp.toDate ? data.timestamp.toDate().toISOString() : '';
      console.log('  ' + t + '  ' + String(data.clientVersion || '').padEnd(10) + '  ' + String(data.errorCode || '').padEnd(25) + '  ' + String(data.userEmail || data.userId || ''));
    });
  }

  console.log('\n[audit P1C] Done.');
}

main().catch((e) => {
  console.error('[audit P1C] ERROR:', e);
  process.exit(1);
});
