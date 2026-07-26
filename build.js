// Fase 0 E2.b — build pipeline. Produce app.bundle.js al REPO ROOT.
//
// Desde E2.b (2026-07-25), source index.html tiene `<script src="./app.bundle.js">`
// baked in y el bundle es la fuente de verdad de las 10 funciones puras + sentry
// helper + sap-client. app.bundle.js queda commiteado en `main` porque GitHub
// Pages sirve desde el repo root sin build step.
//
// Contrato:
// - IIFE 41 KB con sourcemap inline. Bundle de src/main.js.
// - Al load registra window.__phase0 = { version, pure, sentry, sap }.
// - No modifica index.html ni sw.js (esos son fuentes editadas a mano).
// - Idempotente: correr N veces produce byte-identical app.bundle.js.
//
// Regenerar tras cualquier cambio en src/**: npm run build && git add app.bundle.js.

import { build as esbuild } from 'esbuild';
import { stat } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, 'app.bundle.js');

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
}

async function main() {
  const t0 = Date.now();
  await esbuild({
    entryPoints: [join(ROOT, 'src/main.js')],
    outfile: BUNDLE,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify: false,
    sourcemap: 'inline',
    logLevel: 'info',
  });
  const size = (await stat(BUNDLE)).size;
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log('[build]', basename(BUNDLE), fmtSize(size), 'in', dt, 's');
  console.log('[build] Regenerá y commiteá app.bundle.js cada vez que cambies src/**');
}

main().catch((err) => {
  console.error('[build] FAIL:', err.stack || err.message || err);
  process.exit(1);
});
