#!/usr/bin/env node
// Y — R01: eager seed de `revision_waitlist_locks/{cardCode}` para
// waitlists abiertos pre-existentes al deploy.
//
// Contexto: cuando Fase 1 se deploya, las CFs (movePedidoToWaitlistCF /
// unifyWaitlistsCF) empiezan a escribir el lock atómico dentro de sus
// txns. Pero las waitlists abiertas creadas ANTES del deploy no tienen
// lock asociado. El lock lazy (crear-al-tocar dentro del tx) cubre el 99%
// de casos, pero la primera operación que toca un cardCode pre-existente
// pierde la fast-path del lock y depende del pre-tx query (§77 fail-open
// → Fase 1 adversarial fix: fail-closed con preflight-unverifiable).
//
// Este script hace el SEED eager: lee todas las waitlists abiertas
// agrupadas por cardCode y, en modo dry-run, propone qué locks escribir.
// En modo --apply (solo Fase 2+), escribe los locks con snapshot
// `_backfill` §55 para reversibilidad.
//
// Decisión A2 (prompt R01 Fase 1): backfill eager dry-run only mientras
// FASE=1. Fase 2 habilita --apply con guards múltiples adicionales.
//
// === GUARDS MÚLTIPLES contra ejecución accidental de --apply ===
//   1. `FASE=1` hardcoded (L70). `--apply` con FASE=1 → exit 3.
//   2. `--apply` SIN `--i-understand-this-writes-production-data` → exit 3,
//      incluso con FASE=2.
//   3. Pre-flight anti-MULTIPLE_OPEN: si cualquier cardCode tiene N>=2
//      waitlists abiertas, se niega el seed (Mariano debe unificar antes).
//   4. Cada lock escrito lleva snapshot `_backfill.{slug}` §55 — reversible.
//   5. Confirmación interactiva doble (variable TTY) + impresión del plan
//      final antes de escribir.
//
// Categorías del plan:
//   - CARDCODE_OK_ONE_OPEN: 1 waitlist abierta, sin lock → CREATE lock.
//   - CARDCODE_MULTIPLE_OPEN: N>=2 abiertos → viola §42 ya. Requiere
//     unificación manual antes del seed (BLOQUEA --apply).
//   - CARDCODE_NO_OPEN: 0 waitlists abiertas (cerradas/consumed) → skip.
//   - CARDCODE_LOCK_EXISTS: lock ya existe → skip (no re-seedear).
//
// Uso:
//   node scripts/audit/Y_seed_waitlist_locks.cjs                     # dry-run (único modo Fase 1)
//   node scripts/audit/Y_seed_waitlist_locks.cjs --apply               # BLOQUEADO si FASE=1
//   # Fase 2+ (post cambio FASE=2):
//   node scripts/audit/Y_seed_waitlist_locks.cjs --apply --i-understand-this-writes-production-data
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
const APPLY = argv.includes('--apply');
const I_UNDERSTAND = argv.includes('--i-understand-this-writes-production-data');
const SKIP_PROMPT = argv.includes('--skip-interactive-confirm'); // útil sólo para tests smoke

// === FASE HARDCODED ===
// Al pasar a Fase 2, cambiar esta línea a `const FASE = 2` + commit explícito
// con autorización de Mariano. El guard 2 (--i-understand flag) se mantiene
// aun con FASE=2.
const FASE = 1;

const SEED_SLUG = `Y_seed_waitlist_locks_${new Date().toISOString().slice(0, 10)}`;

function normCardCode(cc) {
  return String(cc || '').trim().toUpperCase();
}

function isOpen(wl) {
  if (!wl) return false;
  if (wl.closedAt) return false;
  if (wl.stage === 'consumed') return false;
  return true;
}

function exitError(msg, code = 2) {
  console.error('================================================================');
  console.error(msg);
  console.error('================================================================');
  process.exit(code);
}

async function main() {
  // Guard 1: FASE=1 + --apply → exit 3.
  if (APPLY && FASE === 1) {
    exitError(
      'Y — ERROR: --apply está BLOQUEADO en Fase 1 (decisión A2 R01).\n' +
        'Fase 1 solo autoriza dry-run. Mariano aprueba --apply en Fase 2.',
      3
    );
  }
  // Guard 2: --apply SIN --i-understand → exit 3 (independiente de FASE).
  if (APPLY && !I_UNDERSTAND) {
    exitError(
      'Y — ERROR: --apply requiere también --i-understand-this-writes-production-data.\n' +
        'Esta operación escribe locks en Firestore. Sin el flag explícito, se niega.',
      3
    );
  }

  const path = require('node:path');
  const repoRoot = path.resolve(__dirname, '..', '..');
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
  console.log('================================================================');
  console.log('Y — Seed waitlist locks @ ' + nowIso);
  console.log('================================================================');
  console.log('Fase:', FASE);
  console.log('Modo:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log('Project:', PROJECT);
  if (APPLY) {
    console.log('Guards OK: FASE=' + FASE + ', --i-understand presente.');
  }
  console.log();

  const [locksSnap, waitlistsSnap] = await Promise.all([
    db.collection('revision_waitlist_locks').get(),
    db.collection('revision_waitlist').get(),
  ]);

  /** @type {Set<string>} */
  const locksCardCodes = new Set();
  locksSnap.forEach((d) => {
    const data = d.data() || {};
    const cc = normCardCode(data.cardCode || d.id);
    if (cc) locksCardCodes.add(cc);
  });

  /** @type {Map<string, Array<{id: string, data: any}>>} */
  const waitlistsByCardCode = new Map();
  waitlistsSnap.forEach((d) => {
    const data = d.data() || {};
    const cc = normCardCode(data.clientCardCode);
    if (!cc) return;
    if (!waitlistsByCardCode.has(cc)) waitlistsByCardCode.set(cc, []);
    waitlistsByCardCode.get(cc).push({ id: d.id, data });
  });

  const plan = {
    CARDCODE_OK_ONE_OPEN: [],
    CARDCODE_MULTIPLE_OPEN: [],
    CARDCODE_NO_OPEN: 0,
    CARDCODE_LOCK_EXISTS: 0,
  };

  for (const [cc, wls] of waitlistsByCardCode.entries()) {
    if (locksCardCodes.has(cc)) {
      plan.CARDCODE_LOCK_EXISTS += 1;
      continue;
    }
    const openWls = wls.filter((w) => isOpen(w.data));
    if (openWls.length === 0) {
      plan.CARDCODE_NO_OPEN += 1;
      continue;
    }
    openWls.sort((a, b) =>
      String(b.data.createdAt || '').localeCompare(String(a.data.createdAt || ''))
    );
    if (openWls.length === 1) {
      plan.CARDCODE_OK_ONE_OPEN.push({
        cardCode: cc,
        proposedWaitlistId: openWls[0].id,
        orderNumber: openWls[0].data.orderNumber || null,
      });
    } else {
      plan.CARDCODE_MULTIPLE_OPEN.push({
        cardCode: cc,
        openCount: openWls.length,
        proposedTarget: openWls[0].id,
        proposedAbsorb: openWls.slice(1).map((w) => w.id),
      });
    }
  }

  console.log('Totales:');
  console.log('  Waitlists:', waitlistsSnap.size);
  console.log('  Locks existentes:', locksSnap.size);
  console.log();
  console.log('Plan de seed:');
  console.log(
    '  CARDCODE_OK_ONE_OPEN:',
    plan.CARDCODE_OK_ONE_OPEN.length,
    APPLY ? '→ se van a CREAR estos locks' : '→ propone CREATE lock'
  );
  console.log(
    '  CARDCODE_MULTIPLE_OPEN:',
    plan.CARDCODE_MULTIPLE_OPEN.length,
    '→ requiere unificación manual antes del seed'
  );
  console.log('  CARDCODE_LOCK_EXISTS:', plan.CARDCODE_LOCK_EXISTS, '(skip)');
  console.log('  CARDCODE_NO_OPEN:', plan.CARDCODE_NO_OPEN, '(skip)');
  console.log();

  if (plan.CARDCODE_OK_ONE_OPEN.length > 0) {
    console.log('Detalle CARDCODE_OK_ONE_OPEN (primeros 20):');
    plan.CARDCODE_OK_ONE_OPEN.slice(0, 20).forEach((p) => console.log('  ', JSON.stringify(p)));
    if (plan.CARDCODE_OK_ONE_OPEN.length > 20) {
      console.log(`  ... (+${plan.CARDCODE_OK_ONE_OPEN.length - 20} más)`);
    }
    console.log();
  }
  if (plan.CARDCODE_MULTIPLE_OPEN.length > 0) {
    console.log('Detalle CARDCODE_MULTIPLE_OPEN (requiere revisión manual):');
    plan.CARDCODE_MULTIPLE_OPEN.forEach((p) => console.log('  ', JSON.stringify(p)));
    console.log();
  }

  if (!APPLY) {
    console.log('--------');
    console.log('Modo DRY-RUN. Ninguna escritura realizada.');
    console.log(
      'Para aplicar (Fase 2+): node Y_seed_waitlist_locks.cjs --apply --i-understand-this-writes-production-data'
    );
    process.exit(0);
  }

  // === APPLY PATH (Fase 2+ únicamente) ===

  // Guard 3: pre-flight anti-MULTIPLE_OPEN.
  if (plan.CARDCODE_MULTIPLE_OPEN.length > 0) {
    exitError(
      'Y — ERROR: hay ' +
        plan.CARDCODE_MULTIPLE_OPEN.length +
        ' cardCode(s) con N>=2 waitlists abiertas (viola §42 ya).\n' +
        'El seed --apply NO procede hasta que Mariano unifique esos casos manualmente.',
      4
    );
  }

  if (plan.CARDCODE_OK_ONE_OPEN.length === 0) {
    console.log('Sin nada para seedear. Saliendo.');
    process.exit(0);
  }

  // Guard 5: confirmación interactiva doble (salteable solo para tests).
  if (!SKIP_PROMPT) {
    const readline = require('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q) =>
      new Promise((resolve) => {
        rl.question(q, (answer) => resolve(String(answer || '').trim()));
      });

    console.log('================================================================');
    console.log('CONFIRMACIÓN DOBLE para APPLY');
    console.log('================================================================');
    console.log(
      'Se van a escribir ' +
        plan.CARDCODE_OK_ONE_OPEN.length +
        ' documentos en revision_waitlist_locks del proyecto "' +
        PROJECT +
        '".'
    );
    console.log('Cada lock lleva snapshot _backfill para reversibilidad (§55).');
    console.log();
    const a1 = await ask('1) Escribir el project ID exacto para confirmar ("' + PROJECT + '"): ');
    if (a1 !== PROJECT) {
      rl.close();
      exitError('Y — ERROR: project ID no coincide. Abortando sin escribir.', 5);
    }
    const a2 = await ask('2) Escribir la palabra APLICAR en mayúsculas para confirmar: ');
    rl.close();
    if (a2 !== 'APLICAR') {
      exitError('Y — ERROR: confirmación incorrecta. Abortando sin escribir.', 5);
    }
  }

  // === WRITES ===
  // Cada lock lleva snapshot `_backfill.{slug}` §55 con previousValues=null
  // (porque el doc no existía) + metadata del seed.
  console.log();
  console.log('--- Escribiendo locks ---');
  let written = 0;
  let failures = 0;
  for (const entry of plan.CARDCODE_OK_ONE_OPEN) {
    const lockRef = db.collection('revision_waitlist_locks').doc(entry.cardCode);
    const payload = {
      cardCode: entry.cardCode,
      waitlistId: entry.proposedWaitlistId,
      updatedAt: nowIso,
      updatedBy: 'script:Y_seed_waitlist_locks',
      lastOperation: 'seed_phase2',
      _version: 1,
      _backfill: {
        [SEED_SLUG]: {
          previousValues: null, // doc no existía pre-seed
          by: 'scripts/audit/Y_seed_waitlist_locks.cjs',
          at: nowIso,
          phase: 2,
          proposedWaitlistId: entry.proposedWaitlistId,
          proposedOrderNumber: entry.orderNumber,
        },
      },
    };
    try {
      await lockRef.set(payload, { merge: false });
      written += 1;
      if (written <= 10 || written % 100 === 0) {
        console.log('  ✓ ' + entry.cardCode + ' → waitlistId=' + entry.proposedWaitlistId);
      }
    } catch (e) {
      failures += 1;
      console.error('  ✗ ' + entry.cardCode + ' ERROR: ' + (e?.message || String(e)));
    }
  }
  console.log();
  console.log('--- Resumen ---');
  console.log('  Escritos OK: ' + written);
  console.log('  Fallos:      ' + failures);
  console.log('  Slug:        ' + SEED_SLUG);

  if (failures > 0) process.exit(6);
  process.exit(0);
}

main().catch((e) => {
  console.error('Y_seed_waitlist_locks FAIL:', e && e.message ? e.message : e);
  process.exit(2);
});
