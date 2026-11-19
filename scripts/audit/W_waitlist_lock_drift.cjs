#!/usr/bin/env node
// W — R01 Fase 1 (v1557-dev 2026-11-17): detector de drift entre
// `revision_waitlist_locks/{cardCode}` y `revision_waitlist` abiertas.
//
// Invariante CLAUDE.md §42 (fortificada por Fase 1): a lo sumo UNA waitlist
// abierta (`closedAt==null && stage!=consumed`) por cardCode. El lock
// atómico garantiza esto inside-tx; el drift detector verifica que el
// estado persistido respeta la invariante.
//
// Categorías de drift:
//   A) LOCK_WITHOUT_WAITLIST: lock apunta a doc que no existe o fue borrado.
//   B) LOCK_POINTS_TO_CLOSED: lock.waitlistId apunta a waitlist con
//      closedAt/consumed (no se actualizó al cerrar).
//   C) MULTIPLE_OPEN_WAITLISTS: el cardCode tiene N>=2 waitlists abiertas
//      (viola §42; el lock debería haber forzado unificación).
//   D) WAITLIST_WITHOUT_LOCK: hay al menos 1 waitlist abierta sin lock
//      asociado (pre-§42 o caso con pre-query failed §77).
//   E) LOCK_MISMATCHED: lock apunta a doc X pero hay otra waitlist abierta Y
//      del mismo cardCode (deberían fusionarse).
//
// Salida: tabla ASCII a stdout + resumen por categoría. Exit 0 siempre
// (sólo diagnóstico; el workflow GHA decide si fallar según conteo).
//
// Uso:
//   node scripts/audit/W_waitlist_lock_drift.cjs              # dry-run (único modo Fase 1)
//   node scripts/audit/W_waitlist_lock_drift.cjs --json       # salida JSON para CI
//
// ADC: `gcloud auth application-default login` o GOOGLE_APPLICATION_CREDENTIALS.

// Default prod; override con FIREBASE_PROJECT_ID / GOOGLE_CLOUD_PROJECT para
// smoke contra emulator sin pegar a prod.
const PROJECT =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  'app-vendedores-shimano';
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');

function normCardCode(cc) {
  return String(cc || '').trim().toUpperCase();
}

function isOpen(wl) {
  if (!wl) return false;
  if (wl.closedAt) return false;
  if (wl.stage === 'consumed') return false;
  return true;
}

async function main() {
  const path = require('node:path');
  const repoRoot = path.resolve(__dirname, '..', '..');
  // Fallback para worktrees: busca firebase-admin en functions/ o node_modules.
  let adminPath;
  try {
    adminPath = require.resolve('firebase-admin', { paths: [repoRoot] });
  } catch (_e) {
    adminPath = path.join(repoRoot, 'functions', 'node_modules', 'firebase-admin');
  }
  const admin = require(adminPath);
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const nowIso = new Date().toISOString();
  if (!AS_JSON) {
    console.log('================================================================');
    console.log('W — Waitlist lock drift @ ' + nowIso);
    console.log('================================================================');
    console.log('Modo: DRY-RUN (Fase 1 no permite --apply).');
    console.log();
  }

  // 1. Snapshot colecciones.
  const [locksSnap, waitlistsSnap] = await Promise.all([
    db.collection('revision_waitlist_locks').get(),
    db.collection('revision_waitlist').get(),
  ]);

  /** @type {Map<string, {id: string, waitlistId: string|null, data: any}>} */
  const locksByCardCode = new Map();
  locksSnap.forEach((d) => {
    const data = d.data() || {};
    const cc = normCardCode(data.cardCode || d.id);
    if (cc) locksByCardCode.set(cc, { id: d.id, waitlistId: data.waitlistId || null, data });
  });

  /** @type {Map<string, Array<{id: string, data: any}>>} */
  const waitlistsByCardCode = new Map();
  /** @type {Map<string, any>} */
  const waitlistById = new Map();
  waitlistsSnap.forEach((d) => {
    const data = d.data() || {};
    waitlistById.set(d.id, data);
    const cc = normCardCode(data.clientCardCode);
    if (!cc) return;
    if (!waitlistsByCardCode.has(cc)) waitlistsByCardCode.set(cc, []);
    waitlistsByCardCode.get(cc).push({ id: d.id, data });
  });

  const drift = {
    LOCK_WITHOUT_WAITLIST: [],
    LOCK_POINTS_TO_CLOSED: [],
    MULTIPLE_OPEN_WAITLISTS: [],
    WAITLIST_WITHOUT_LOCK: [],
    LOCK_MISMATCHED: [],
  };

  // 2. Recorre locks y clasifica.
  for (const [cc, lock] of locksByCardCode.entries()) {
    const wls = waitlistsByCardCode.get(cc) || [];
    const openWls = wls.filter((w) => isOpen(w.data));
    if (lock.waitlistId) {
      const target = waitlistById.get(lock.waitlistId);
      if (!target) {
        drift.LOCK_WITHOUT_WAITLIST.push({ cardCode: cc, lockPointsTo: lock.waitlistId });
      } else if (!isOpen(target)) {
        drift.LOCK_POINTS_TO_CLOSED.push({
          cardCode: cc,
          lockPointsTo: lock.waitlistId,
          waitlistStage: target.stage || null,
          waitlistClosedAt: target.closedAt || null,
        });
      } else if (openWls.length > 1) {
        drift.MULTIPLE_OPEN_WAITLISTS.push({
          cardCode: cc,
          openIds: openWls.map((w) => w.id),
          lockPointsTo: lock.waitlistId,
        });
      } else if (openWls.length === 1 && openWls[0].id !== lock.waitlistId) {
        drift.LOCK_MISMATCHED.push({
          cardCode: cc,
          lockPointsTo: lock.waitlistId,
          actualOpenId: openWls[0].id,
        });
      }
    }
  }

  // 3. Recorre cardCodes con waitlists abiertas pero sin lock.
  // La lógica del paso 2 ya cubre MULTIPLE_OPEN_WAITLISTS cuando el lock
  // existe. Acá sólo faltan los casos SIN lock (WAITLIST_WITHOUT_LOCK) +
  // su caso agravado SIN lock + N>=2 abiertos (MULTIPLE_OPEN sin lock).
  for (const [cc, wls] of waitlistsByCardCode.entries()) {
    const openWls = wls.filter((w) => isOpen(w.data));
    if (openWls.length === 0) continue;
    if (locksByCardCode.has(cc)) continue;
    drift.WAITLIST_WITHOUT_LOCK.push({ cardCode: cc, openIds: openWls.map((w) => w.id) });
    if (openWls.length > 1) {
      drift.MULTIPLE_OPEN_WAITLISTS.push({
        cardCode: cc,
        openIds: openWls.map((w) => w.id),
        lockPointsTo: null,
      });
    }
  }

  const totals = Object.fromEntries(
    Object.entries(drift).map(([k, v]) => [k, v.length])
  );
  const totalDrift = Object.values(totals).reduce((a, b) => a + b, 0);

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          timestamp: nowIso,
          totals,
          totalDrift,
          locksCount: locksByCardCode.size,
          waitlistsCount: waitlistsSnap.size,
          drift,
        },
        null,
        2
      )
    );
  } else {
    console.log('Locks:', locksByCardCode.size);
    console.log('Waitlists totales:', waitlistsSnap.size);
    console.log();
    console.log('Drift por categoría:');
    for (const [k, v] of Object.entries(totals)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log(`  TOTAL: ${totalDrift}`);
    console.log();
    if (totalDrift > 0) {
      console.log('Detalle:');
      for (const [cat, items] of Object.entries(drift)) {
        if (items.length === 0) continue;
        console.log(`  [${cat}]`);
        for (const it of items) console.log('    ', JSON.stringify(it));
      }
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('W_waitlist_lock_drift FAIL:', e && e.message ? e.message : e);
  process.exit(2);
});
