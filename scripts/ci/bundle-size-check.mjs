#!/usr/bin/env node
/**
 * bundle-size-check.mjs — CI gate para ADR-0011 (budget formal de bundle size).
 *
 * Lee app.bundle.js + chunks/*.js, compara contra budgets declarados.
 * Exit 0 si todo OK. Exit 1 si algún asset excede su budget.
 *
 * Budgets (bytes RAW, no gzip):
 *   - app.bundle.js: 3,5 MB (3.670.016 bytes)
 *   - cada chunks/<X>.js: 400 KB (409.600 bytes)
 *   - chunks total agregado: 2 MB (2.097.152 bytes)
 *
 * Si un PR legítimo necesita subir budgets:
 *   1. Modificar las constantes BUDGET_* acá.
 *   2. Documentar razón en el PR description.
 *   3. Agregar fila al historial de docs/adr/0011-bundle-budget.md.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const BUNDLE = join(ROOT, 'app.bundle.js');
const CHUNKS_DIR = join(ROOT, 'chunks');

// Budgets (bytes RAW).
const BUDGET_BUNDLE = 3_670_016; // 3,5 MB
const BUDGET_CHUNK_EACH = 409_600; // 400 KB
const BUDGET_CHUNKS_TOTAL = 2_097_152; // 2 MB

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function pct(actual, budget) {
  return ((actual / budget) * 100).toFixed(1) + '%';
}

function main() {
  console.log('=== bundle-size-check.mjs (ADR-0011) ===');
  console.log('');

  let fail = false;

  // 1. app.bundle.js
  if (!existsSync(BUNDLE)) {
    console.error('FAIL: app.bundle.js no existe. Correr `node build.js` primero.');
    process.exit(1);
  }

  const bundleSize = statSync(BUNDLE).size;
  const bundleStatus = bundleSize <= BUDGET_BUNDLE ? 'OK' : 'EXCEED';
  const bundlePctStr = pct(bundleSize, BUDGET_BUNDLE);
  console.log(
    `app.bundle.js:      ${fmtBytes(bundleSize).padStart(10)} / ${fmtBytes(BUDGET_BUNDLE).padStart(10)} (${bundlePctStr.padStart(6)}) [${bundleStatus}]`
  );

  if (bundleSize > BUDGET_BUNDLE) {
    fail = true;
    console.error(
      `  > app.bundle.js excede el budget en ${fmtBytes(bundleSize - BUDGET_BUNDLE)}`
    );
  }

  // 2. chunks/*.js
  if (!existsSync(CHUNKS_DIR)) {
    console.log('(chunks/ no existe — no hay chunks lazy. OK.)');
    console.log('');
  } else {
    const chunkFiles = readdirSync(CHUNKS_DIR)
      .filter((f) => f.endsWith('.js'))
      .map((f) => join(CHUNKS_DIR, f));

    let chunksTotal = 0;

    console.log('');
    console.log('chunks/');
    for (const f of chunkFiles.sort()) {
      const size = statSync(f).size;
      chunksTotal += size;
      const name = basename(f);
      const status = size <= BUDGET_CHUNK_EACH ? 'OK' : 'EXCEED';
      console.log(
        `  ${name.padEnd(30)} ${fmtBytes(size).padStart(10)} / ${fmtBytes(BUDGET_CHUNK_EACH).padStart(10)} (${pct(size, BUDGET_CHUNK_EACH).padStart(6)}) [${status}]`
      );
      if (size > BUDGET_CHUNK_EACH) {
        fail = true;
        console.error(`    > ${name} excede budget por chunk en ${fmtBytes(size - BUDGET_CHUNK_EACH)}`);
      }
    }

    console.log('');
    const totalStatus = chunksTotal <= BUDGET_CHUNKS_TOTAL ? 'OK' : 'EXCEED';
    console.log(
      `chunks TOTAL:       ${fmtBytes(chunksTotal).padStart(10)} / ${fmtBytes(BUDGET_CHUNKS_TOTAL).padStart(10)} (${pct(chunksTotal, BUDGET_CHUNKS_TOTAL).padStart(6)}) [${totalStatus}]`
    );
    if (chunksTotal > BUDGET_CHUNKS_TOTAL) {
      fail = true;
      console.error(`  > total chunks excede budget en ${fmtBytes(chunksTotal - BUDGET_CHUNKS_TOTAL)}`);
    }
  }

  console.log('');
  if (fail) {
    console.error('FAIL: uno o más assets exceden el budget. Ver docs/adr/0011-bundle-budget.md.');
    process.exit(1);
  }
  console.log('OK: todos los assets dentro del budget.');
  process.exit(0);
}

main();
