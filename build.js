// Fase 0 E2 — build pipeline. Produce dist/ con:
//   - dist/app.bundle.js  ← esbuild(src/main.js) IIFE, ES2020, sourcemap inline
//   - dist/index.html     ← copia de index.html con <script src="./app.bundle.js" defer>
//                            inyectado antes de </head>. Versión NO se modifica: dist
//                            mirroreá source. El bump de APP_VERSION/CACHE_VERSION es
//                            responsabilidad del humano al mergear (regla dura README).
//   - dist/sw.js          ← copia verbatim
//   - dist/<assets>       ← manifest/geo/stock/login-bg/icons/logo copiados sin cambios
//
// Contrato NO-BREAKING: dist/index.html sigue teniendo TODO el JS inline actual.
// El bundle es aditivo (window.__phase0). E2.b hará la migración real.
// Build idempotente: correr N veces produce byte-identical output.

import { build as esbuild } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');

const ASSETS_STATIC = [
  'manifest.json',
  'geo.json',
  'stock.json',
  'login-bg.jpg',
  'Shimano-Logo.png',
  'alta-cliente.html',
  'politica-privacidad.html',
];

const ASSET_GLOBS_PREFIX = ['icon-']; // icon-180-v3.png, icon-192.png, etc.

/** @returns {Promise<string[]>} */
async function collectRootAssets() {
  const entries = await readdir(ROOT);
  const iconAssets = entries.filter((name) =>
    ASSET_GLOBS_PREFIX.some((p) => name.startsWith(p)) && name.endsWith('.png')
  );
  return [...ASSETS_STATIC, ...iconAssets];
}

async function ensureDist() {
  if (!existsSync(DIST)) await mkdir(DIST, { recursive: true });
}

async function buildBundle() {
  const out = join(DIST, 'app.bundle.js');
  await esbuild({
    entryPoints: [join(ROOT, 'src/main.js')],
    outfile: out,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify: false,
    sourcemap: 'inline',
    logLevel: 'info',
  });
  const size = (await stat(out)).size;
  return { out, size };
}

async function processIndexHtml() {
  const src = join(ROOT, 'index.html');
  const dst = join(DIST, 'index.html');
  let html = await readFile(src, 'utf8');

  const versionMatch = html.match(/const APP_VERSION = '(v\d+)';/);
  if (!versionMatch) throw new Error('APP_VERSION const no encontrada en index.html');

  // Inyectar bundle antes de </head>. Idempotente: si ya está, no re-inyecta.
  const injectTag = '<script src="./app.bundle.js" defer></script>';
  if (!html.includes(injectTag)) {
    const closingHead = '</head>';
    const idx = html.indexOf(closingHead);
    if (idx === -1) throw new Error('</head> no encontrado en index.html');
    html = html.slice(0, idx) +
      '<!-- Fase 0 E2: bundle aditivo. Expone window.__phase0.{pure,sentry,sap}. -->\n' +
      injectTag + '\n' +
      html.slice(idx);
  }

  await writeFile(dst, html, 'utf8');
  const size = (await stat(dst)).size;
  return { out: dst, size, version: versionMatch[1] };
}

async function processServiceWorker() {
  const src = join(ROOT, 'sw.js');
  const dst = join(DIST, 'sw.js');
  const js = await readFile(src, 'utf8');
  const match = js.match(/const CACHE_VERSION = '(v\d+)';/);
  if (!match) throw new Error('CACHE_VERSION const no encontrada en sw.js');
  await writeFile(dst, js, 'utf8');
  return { out: dst, version: match[1] };
}

async function copyAssets() {
  const assets = await collectRootAssets();
  const copied = [];
  for (const name of assets) {
    const src = join(ROOT, name);
    if (!existsSync(src)) continue;
    const dst = join(DIST, name);
    await copyFile(src, dst);
    copied.push(name);
  }
  return copied;
}

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
}

async function main() {
  const t0 = Date.now();
  await ensureDist();
  const bundle = await buildBundle();
  console.log('[build] bundle:', basename(bundle.out), fmtSize(bundle.size));
  const idx = await processIndexHtml();
  const sw = await processServiceWorker();
  if (idx.version !== sw.version) {
    console.warn('[build] WARN: APP_VERSION (' + idx.version + ') ≠ CACHE_VERSION (' + sw.version + '). Bumpealas juntas antes de mergear.');
  }
  console.log('[build] index.html:', idx.version, fmtSize(idx.size));
  console.log('[build] sw.js:', sw.version);
  const copied = await copyAssets();
  console.log('[build] copied assets (' + copied.length + '):', copied.join(', '));
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log('[build] OK in', dt, 's');
}

main().catch((err) => {
  console.error('[build] FAIL:', err.stack || err.message || err);
  process.exit(1);
});
