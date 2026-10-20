/**
 * _backfill_vendor_canonical_v1283.cjs — 2026-10-20
 *
 * Context: Task 1.5 del plan v1283 "Analisis de Cartera por Vendedor". Smoke de
 * la BQ view `v_cartera_vendor` (deployada en Task 1, commit 236bbd4) revelo
 * que 47/100 docs de `client_master` tienen `data.vendor` seteado como EMAIL
 * (`gonzalo.de.la.rosa@shimano.com.ar`) en vez de nombre canonico
 * (`GONZALO DE LA ROSA`). Esto causa cards duplicadas en el modal (GONZALO +
 * gonzalo@... como 2 vendors distintos).
 *
 * Fix: normalizar `data.vendor` al nombre canonico usando un mapping explicito
 * email -> canonical (hardcoded de index.html:7193 array VENDORS). Idempotente.
 *
 * Scope: SOLO client_master docs con `data.vendor` seteado que matchee en el
 * mapping. Vendors unknown o vacios: skip con log (no inventamos data).
 *
 * Uso:
 *   node scripts/_backfill_vendor_canonical_v1283.cjs           # dry-run
 *   node scripts/_backfill_vendor_canonical_v1283.cjs --commit  # aplica
 *
 * Audit trail: cada doc modificado recibe:
 *   vendorBackfilledAt      (ISO timestamp)
 *   vendorBackfilledFrom    (valor original)
 *   vendorBackfilledReason  ('canonical_v1283')
 */

const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const COMMIT = process.argv.includes('--commit');
const SA_KEY = path.join(
  os.homedir(),
  'Downloads',
  'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json'
);

admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

// Mapping canonico de VDE (fuente: index.html:7193 array VENDORS + emails verificados)
// Lowercase emails + legacy uppercase alias.
const VENDOR_CANONICAL_MAP = {
  // Email -> canonical
  'gonzalo.de.la.rosa@shimano.com.ar': 'GONZALO DE LA ROSA',
  'federico.castelanelli@shimano.com.ar': 'FEDERICO CASTELANELLI',
  'ioannis.plakoudakis@shimano.com.ar': 'IOANNIS PALKOUDAKIS', // ojo spelling: plakoudakis email vs palkoudakis canonical
  'mauricio.gil@shimano.com.ar': 'MAURICIO GIL',
  'santiago.esteban@shimano.com.ar': 'SANTIAGO ESTEBAN',
  'martin.boiero@shimano.com.ar': 'PACHI', // alias legacy
  'diego.valsi@shimano.com.ar': 'DIEGO VALSI',
  'pachi@shimano.com.ar': 'PACHI',
  // Legacy uppercase string alias (sin email)
  'MARTIN BOIERO': 'PACHI',
};

const CANONICAL_VALUES = new Set(Object.values(VENDOR_CANONICAL_MAP));

/**
 * Devuelve el nombre canonico para un vendor crudo.
 *   null si no es string / vacio / unknown.
 *   mismo string (uppercase) si ya era canonico.
 *   canonical del map si matcheo email o legacy alias.
 */
function canonicalize(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim();
  if (!key) return null;
  const keyLower = key.toLowerCase();
  // 1. Email lookup (keys del map son todas lowercase)
  if (VENDOR_CANONICAL_MAP[keyLower]) return VENDOR_CANONICAL_MAP[keyLower];
  // 2. Legacy uppercase alias (MARTIN BOIERO)
  const keyUpper = key.toUpperCase();
  if (VENDOR_CANONICAL_MAP[keyUpper]) return VENDOR_CANONICAL_MAP[keyUpper];
  // 3. Ya canonico (presente en los values del map)
  if (CANONICAL_VALUES.has(keyUpper)) return keyUpper;
  // 4. Unknown
  return null;
}

async function main() {
  console.log('===== v1283 BACKFILL: client_master.vendor email -> canonical =====');
  console.log(`Modo: ${COMMIT ? '[COMMIT]' : '[DRY RUN]'}\n`);

  console.log('Scaneando collection client_master...');
  const snap = await db.collection('client_master').get();
  console.log(`Docs totales: ${snap.size}\n`);

  // Buckets
  const toApply = []; // { docId, originalVendor, canonicalVendor }
  const stats = {
    emptyVendor: 0, // vendor null / '' / undefined (skip)
    alreadyCanonical: 0, // vendor === canonicalize(vendor) (idempotent, skip)
    normalizable: 0, // vendor !== canonical pero mapeable (to apply)
    unknown: 0, // vendor seteado pero no mapeable (skip, log)
  };
  const unknownSamples = new Map(); // raw -> count

  snap.forEach((doc) => {
    const data = doc.data();
    // NOTA: en Firestore el field esta al top-level (`vendor`); en BQ queda
    // bajo `data.vendor` porque el stream Firestore->BQ serializa el doc
    // entero en la col JSON `data`. Para el backfill escribimos top-level.
    const rawVendor = data?.vendor;

    if (!rawVendor || typeof rawVendor !== 'string' || !rawVendor.trim()) {
      stats.emptyVendor++;
      return;
    }

    const canonical = canonicalize(rawVendor);

    if (canonical === null) {
      stats.unknown++;
      const cur = unknownSamples.get(rawVendor) || 0;
      unknownSamples.set(rawVendor, cur + 1);
      return;
    }

    if (canonical === rawVendor) {
      stats.alreadyCanonical++;
      return;
    }

    stats.normalizable++;
    toApply.push({
      docId: doc.id,
      originalVendor: rawVendor,
      canonicalVendor: canonical,
    });
  });

  console.log('===== RESUMEN SCAN =====');
  console.log(`  vacio / null (skip)         : ${stats.emptyVendor}`);
  console.log(`  ya canonico (idempotent)    : ${stats.alreadyCanonical}`);
  console.log(`  normalizable (to apply)     : ${stats.normalizable}`);
  console.log(`  unknown (skip + log)        : ${stats.unknown}`);
  console.log();

  if (unknownSamples.size > 0) {
    console.log('===== UNKNOWN VENDORS (NO SE TOCAN) =====');
    const sortedUnknown = [...unknownSamples.entries()].sort((a, b) => b[1] - a[1]);
    for (const [raw, count] of sortedUnknown) {
      console.log(`  "${raw}"  -> ${count} docs`);
    }
    console.log();
  }

  if (toApply.length === 0) {
    console.log('Nada que normalizar. Exit.');
    process.exit(0);
  }

  // Sample primeros 10
  console.log('===== SAMPLE (primeros 10 a normalizar) =====');
  for (const r of toApply.slice(0, 10)) {
    console.log(`  ${r.docId}  "${r.originalVendor}"  ->  "${r.canonicalVendor}"`);
  }
  if (toApply.length > 10) console.log(`  ... y ${toApply.length - 10} mas`);
  console.log();

  if (!COMMIT) {
    console.log('[DRY RUN] Para aplicar: node scripts/_backfill_vendor_canonical_v1283.cjs --commit');
    process.exit(0);
  }

  // COMMIT
  console.log('[COMMIT] Aplicando updates...');
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;
  let applied = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();

  async function flush() {
    if (batchCount === 0) return;
    try {
      await batch.commit();
      applied += batchCount;
      console.log(`  OK commit batch (${batchCount}, acumulado: ${applied}/${toApply.length})`);
    } catch (e) {
      failed += batchCount;
      console.error(`  FAIL commit batch: ${e.message}`);
    }
    batch = db.batch();
    batchCount = 0;
  }

  for (const { docId, originalVendor, canonicalVendor } of toApply) {
    batch.update(db.collection('client_master').doc(docId), {
      vendor: canonicalVendor,
      vendorBackfilledAt: nowIso,
      vendorBackfilledFrom: originalVendor,
      vendorBackfilledReason: 'canonical_v1283',
    });
    batchCount++;
    if (batchCount >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`\n[DONE] ${applied} docs actualizados. Fallidos: ${failed}`);
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
