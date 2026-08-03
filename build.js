// E3 (e2b-perf) — build pipeline con code splitting.
// Produce:
//  - app.bundle.js (shell): entrypoint principal. Contiene Fase 0 pure fns +
//    todos los dominios que necesitan estar disponibles al login (listeners
//    Firestore, funciones cross-scope, product-picker, visitas, etc.) +
//    loader.js + stubs para chunks lazy.
//  - chunks/<name>.js: chunks lazy, uno por dominio de UI que se abre solo al
//    click de un botón. Cargados on-demand por window.loadChunk(name).
//
// Chunks lazy actuales (v3 de este pipeline):
//   - exports-core (1,036 LOC): botón "Exportar a Excel"
//   - exports-advanced (562 LOC): botón "Export para Análisis"
//   - admin-users (799 LOC): panel admin
//
// El shell registra STUBS proxy para los exports window.foo de cada chunk lazy.
// El primer llamado dispara loadChunk, inyecta el <script>, y re-invoca la
// función real (que sobreescribe el stub al load).
//
// Contrato:
// - Shell IIFE con sourcemap inline. Bundle de src/main.js.
// - Chunks IIFE cada uno independiente. Bundle de src/domains/<name>.js.
// - Al load registra window.__phase0 + stubs proxy.
// - No modifica index.html ni sw.js (esos son fuentes editadas a mano).
// - Idempotente: correr N veces produce byte-identical output.
//
// Regenerar tras cualquier cambio en src/**: npm run build && git add app.bundle.js chunks/.

import { mkdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(ROOT, 'app.bundle.js');
const CHUNKS_DIR = join(ROOT, 'chunks');

// Chunks lazy. Se compilan como archivos separados en ./chunks/.
// Cada uno debe listar sus exports window.foo aquí para que el shell genere
// stubs proxy que hagan lazy loadChunk + re-invoke.
const LAZY_CHUNKS = {
  'exports-core': [
    'closeExportAnalisis',
    'closeExportDialog',
    'closeMonthPicker',
    'confirmMonthPicker',
    'exportMasterClientes',
    'exportPreciosStock',
    'exportTargetsZonas',
    'exportToExcel',
    'openExportAnalisis',
    'showMonthPicker',
  ],
  'exports-advanced': [
    'exportAuditExcel',
    'exportExecutive',
    'exportML',
    'exportPhotosZip',
    'exportPowerBI',
    'exportVisitsExcel',
    'exportVisitsWithEmbeddedPhotos',
    // v371+: export dataset ZIP para pipelines ML (admin/gerente only)
    'openExportFormatModal',
    'closeExportFormatModal',
    'exportDatasetZip',
  ],
  'admin-users': [
    'addAllowedEmail',
    'bulkAssignApprover',
    'changeUserPassword',
    'closeAdminPanel',
    'closeTotpSetupModal',
    'confirmTotpSetup',
    'deleteGeminiApiKey',
    'deleteGmapsApiKey',
    'deleteUserRole',
    'disableTotp',
    'generateNewTotp',
    'openAdminPanel',
    'openTotpSetup',
    'removeAllowedEmail',
    'saveGeminiApiKey',
    'saveGmapsApiKey',
    'saveUserRole',
  ],
};

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
}

async function main() {
  const t0 = Date.now();
  await mkdir(CHUNKS_DIR, { recursive: true });

  // Bundle shell (main.js): incluye todos los imports estáticos + loader + stubs.
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
  const shellSize = (await stat(BUNDLE)).size;

  // Bundle cada chunk lazy separado. Cada chunk es su propio IIFE.
  const chunkSizes = {};
  for (const chunkName of Object.keys(LAZY_CHUNKS)) {
    const entry = join(ROOT, 'src/domains/' + chunkName + '.js');
    const outfile = join(CHUNKS_DIR, chunkName + '.js');
    await esbuild({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: 'iife',
      target: 'es2020',
      platform: 'browser',
      minify: false,
      sourcemap: 'inline',
      logLevel: 'error', // solo errores para no spamear
    });
    chunkSizes[chunkName] = (await stat(outfile)).size;
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log('[build]', basename(BUNDLE), fmtSize(shellSize), '(shell)');
  for (const [name, size] of Object.entries(chunkSizes)) {
    console.log('[build] chunks/' + name + '.js', fmtSize(size));
  }
  console.log(
    '[build] Total:',
    fmtSize(shellSize + Object.values(chunkSizes).reduce((a, b) => a + b, 0))
  );
  console.log('[build] Done in', dt, 's');
  console.log('[build] Regenerá y commiteá app.bundle.js + chunks/ cada vez que cambies src/**');
}

main().catch((err) => {
  console.error('[build] FAIL:', err.stack || err.message || err);
  process.exit(1);
});
