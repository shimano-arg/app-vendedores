// X v1516 §TBD (2026-10-28) — Destrabar ingresos_reparto trabados en in_progress.
//
// Dry-run por default. `--apply` requiere ejecución explícita.
// Threshold configurable: `--threshold-hours=N` (default 1 hora).
//
// Flow:
//   - Load ingresos_reparto con status='in_progress'.
//   - Filtrar los que tienen lockedAt viejo (nowMs - lockedAt > threshold).
//   - Para cada ingreso trabado:
//     - Guarda snapshot _backfill.X_destrabar_<fecha>.previousValues con status, lockedAt, lockedBy.
//     - Update: status='pending', lockedAt=null, lockedBy=null, _unlockedAt, _unlockedBy, _unlockedReason.
//   - Output: tabla + docs/auditoria/X_destrabar_in_progress.md.
//
// Causa: `applyRepartoManualCore` setea status='in_progress' + lockedAt antes del loop.
// Si CF timeout/crashea mid-loop, el lock queda. El guard `status !== 'pending'`
// (validateRepartoPayload línea 589) bloquea reintentos. Script destraba.
//
// Precedente: v1516 BALTICA20MD + otros ingresos reportados stuck 2026-10-28.

const PROJECT = 'app-vendedores-shimano';
const APPLY = process.argv.includes('--apply');
const THRESHOLD_ARG = process.argv.find((a) => a.startsWith('--threshold-hours='));
const THRESHOLD_HOURS = THRESHOLD_ARG ? Number(THRESHOLD_ARG.split('=')[1]) || 1 : 1;
const SLUG_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const SLUG = `X_destrabar_${SLUG_DATE}_v1516`;
const SCRIPT_NAME = 'scripts/audit/X_destrabar_in_progress_eterno.cjs';

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('X — Destrabar ingresos_reparto in_progress eterno');
  console.log('Modo:', APPLY ? '*** APPLY (persistira) ***' : 'DRY-RUN');
  console.log('Threshold:', THRESHOLD_HOURS, 'horas');
  console.log('Slug:', SLUG);
  console.log('================================================================\n');

  const snap = await db
    .collection('ingresos_reparto')
    .where('status', '==', 'in_progress')
    .get();
  console.log('Total ingresos_reparto status=in_progress:', snap.size);

  const nowMs = Date.now();
  const thresholdMs = THRESHOLD_HOURS * 60 * 60 * 1000;

  /** @type {Array<any>} */
  const stuck = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const lockedAt = data.lockedAt;
    let lockedMs = null;
    if (typeof lockedAt === 'string') {
      lockedMs = Date.parse(lockedAt) || null;
    } else if (lockedAt && typeof lockedAt.toMillis === 'function') {
      try {
        lockedMs = lockedAt.toMillis();
      } catch {
        lockedMs = null;
      }
    } else if (lockedAt instanceof Date) {
      lockedMs = lockedAt.getTime();
    }
    const ageMs = lockedMs ? nowMs - lockedMs : null;
    if (ageMs === null || ageMs > thresholdMs) {
      stuck.push({
        id: d.id,
        sku: data.sku || '',
        qtyIngresada: data.qtyIngresada || 0,
        lockedAt: lockedAt ? (typeof lockedAt === 'string' ? lockedAt : new Date(lockedMs).toISOString()) : '(sin lockedAt)',
        lockedBy: data.lockedBy || '',
        ageHours: ageMs !== null ? (ageMs / (60 * 60 * 1000)).toFixed(2) : 'N/A',
        clientesCount: data.clientesCount || 0,
        _rawData: data,
      });
    }
  });

  console.log('Trabados (edad > ' + THRESHOLD_HOURS + 'h):', stuck.length);

  if (stuck.length === 0) {
    console.log('\nSin ingresos trabados. OK.');
    writeReport({ stuck: [], applied: APPLY });
    return;
  }

  // Imprimir tabla.
  console.log('\n============== PLAN ==============');
  console.log('Doc ID                   | SKU             | qty | lockedAt                    | age (h) | lockedBy');
  console.log('-------------------------|-----------------|-----|-----------------------------|---------|-----------------------');
  for (const r of stuck) {
    const line = [
      String(r.id).padEnd(24),
      String(r.sku).padEnd(15),
      String(r.qtyIngresada).padStart(3),
      String(r.lockedAt).padEnd(27),
      String(r.ageHours).padStart(7),
      String(r.lockedBy).slice(0, 22).padEnd(22),
    ].join(' | ');
    console.log(line);
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] No se escribio nada. Para persistir correr con --apply.');
    writeReport({ stuck, applied: false });
    return;
  }

  // === APPLY ===
  console.log('\n>>> APPLY: destrabando ingresos...');
  const nowIso = new Date().toISOString();
  let successCount = 0;
  let errorCount = 0;
  /** @type {string[]} */
  const errors = [];
  for (const r of stuck) {
    try {
      const previousValues = {
        status: r._rawData.status,
        lockedAt: r._rawData.lockedAt,
        lockedBy: r._rawData.lockedBy,
      };
      const prevBackfill = r._rawData._backfill || {};
      await db.collection('ingresos_reparto').doc(r.id).update({
        status: 'pending',
        lockedAt: null,
        lockedBy: null,
        _unlockedAt: nowIso,
        _unlockedBy: SCRIPT_NAME,
        _unlockedReason: 'in_progress_>_' + THRESHOLD_HOURS + '_hours',
        _backfill: Object.assign({}, prevBackfill, {
          [SLUG]: {
            previousValues,
            by: SCRIPT_NAME,
            at: nowIso,
          },
        }),
      });
      successCount += 1;
      console.log(`  OK id=${r.id} sku=${r.sku}`);
    } catch (e) {
      errorCount += 1;
      const msg = `${r.id}: ${e.message || String(e)}`;
      errors.push(msg);
      console.error(`  FAIL ${msg}`);
    }
  }
  console.log(`\nAPPLY completo. OK=${successCount} FAIL=${errorCount}`);
  if (errors.length > 0) console.log('Errores:', errors);
  writeReport({ stuck, applied: true, successCount, errorCount, errors });
}

function writeReport({ stuck, applied, successCount = 0, errorCount = 0, errors = [] }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const outDir = path.join(__dirname, '..', '..', 'docs', 'auditoria');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'X_destrabar_in_progress.md');
  const lines = [];
  lines.push('# X — Destrabar ingresos_reparto in_progress eterno');
  lines.push('');
  lines.push('Script: `scripts/audit/X_destrabar_in_progress_eterno.cjs`');
  lines.push('Modo: ' + (applied ? 'APPLY' : 'DRY-RUN'));
  lines.push('Threshold horas: ' + THRESHOLD_HOURS);
  lines.push('Slug: `' + SLUG + '`');
  lines.push('Fecha: ' + new Date().toISOString());
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push('- Ingresos trabados (status=in_progress + edad > threshold): **' + stuck.length + '**');
  if (applied) {
    lines.push('- Destrabados OK: **' + successCount + '**');
    lines.push('- Con error: **' + errorCount + '**');
  }
  lines.push('');
  if (stuck.length === 0) {
    lines.push('_Sin ingresos trabados. OK._');
  } else {
    lines.push('## Lista');
    lines.push('');
    lines.push('| Doc ID | SKU | Qty | lockedAt | Age (h) | lockedBy |');
    lines.push('|---|---|---:|---|---:|---|');
    for (const r of stuck) {
      lines.push(
        '| `' +
          r.id +
          '` | ' +
          r.sku +
          ' | ' +
          r.qtyIngresada +
          ' | ' +
          r.lockedAt +
          ' | ' +
          r.ageHours +
          ' | ' +
          r.lockedBy +
          ' |'
      );
    }
  }
  if (errors.length > 0) {
    lines.push('');
    lines.push('## Errores');
    lines.push('');
    for (const e of errors) lines.push('- ' + e);
  }
  lines.push('');
  lines.push('## Como ejecutar');
  lines.push('');
  lines.push('```bash');
  lines.push('# Dry-run (default, threshold 1h):');
  lines.push('node scripts/audit/X_destrabar_in_progress_eterno.cjs');
  lines.push('');
  lines.push('# Dry-run con threshold distinto:');
  lines.push('node scripts/audit/X_destrabar_in_progress_eterno.cjs --threshold-hours=4');
  lines.push('');
  lines.push('# Apply (persiste cambios):');
  lines.push('node scripts/audit/X_destrabar_in_progress_eterno.cjs --apply');
  lines.push('node scripts/audit/X_destrabar_in_progress_eterno.cjs --apply --threshold-hours=4');
  lines.push('```');
  lines.push('');
  lines.push('## Rollback');
  lines.push('');
  lines.push('Cada doc modificado guarda `_backfill.' + SLUG + '.previousValues` (ver §55).');
  lines.push('Para revertir: iterar docs con el slug, restaurar `status/lockedAt/lockedBy`.');
  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
  console.log('\nReporte: docs/auditoria/X_destrabar_in_progress.md');
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
