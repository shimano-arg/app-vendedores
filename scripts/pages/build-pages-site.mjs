#!/usr/bin/env node
// @ts-check
/**
 * SEC-07 (P0, 2026-10-29) — arma el sitio de GitHub Pages con una lista
 * EXPLÍCITA de archivos (allowlist) en lugar de publicar el repo entero.
 *
 * Antes: `.github/workflows/deploy-pages.yml` subía `path: '.'` → se publicaban
 * CLAUDE.md, README.md, docs/ (incluido docs/auditoria/), tests/ (con fixtures
 * de producción), scripts/, functions/, firestore.rules, etc.
 *
 * Uso:   node scripts/pages/build-pages-site.mjs <dirSalida>
 * Falla (exit 1) si:
 *   - falta algún archivo requerido,
 *   - un chunk declarado en sw.js / build.js no está en la allowlist,
 *   - el directorio de salida contiene algo prohibido (CLAUDE.md, docs/, ...).
 *
 * No borra ni modifica archivos del repo: solo copia a <dirSalida>.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Archivos que necesita la PWA publicada (verificado 2026-10-29 rastreando
 * referencias relativas en index.html, app.bundle.js, chunks, sw.js,
 * manifest.json y styles/).
 */
export const REQUIRED_FILES = Object.freeze([
  // App
  'index.html',
  'app.bundle.js',
  'sw.js',
  'manifest.json',
  'styles/apple-design.css',
  // Datos estáticos que la app lee
  'geo.json',
  'stock.json', // también lo lee un Google Sheet externo ("Inventario-Bot")
  // Imágenes
  'Shimano-Logo.png',
  'login-bg.jpg',
  'icon-180-v3.png',
  'icon-192-v3.png',
  'icon-512-v3.png',
  'icon-512-maskable-v3.png',
  // Páginas públicas
  'alta-cliente.html', // formulario público de alta (link compartido por WhatsApp)
  'politica-privacidad.html', // URL de política de privacidad (pantalla OAuth)
]);

/**
 * Archivos que se publican si existen (compatibilidad con PWAs instaladas que
 * cachearon un manifest viejo con íconos sin sufijo -v3).
 */
export const OPTIONAL_FILES = Object.freeze([
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  '.nojekyll',
]);

/** Directorio de chunks lazy: se publican todos los `.js` de `chunks/`. */
export const CHUNKS_DIR = 'chunks';

/** Rutas que NUNCA deben aparecer en el sitio publicado. */
export const FORBIDDEN_PATHS = Object.freeze([
  'CLAUDE.md',
  'README.md',
  'AVANCES.md',
  'LOOP_RETRO.md',
  'docs',
  'tests',
  'scripts',
  'functions',
  'src',
  'bigquery',
  'apps',
  'extensions',
  'templates',
  'firestore.rules',
  'storage.rules',
  'firestore.indexes.json',
  'firebase.json',
  '.firebaserc',
  'package.json',
  'package-lock.json',
  'build.js',
  'build_app.py',
  '.github',
  '.gitignore',
  'audit-report',
]);

/** Extensiones que no deben publicarse en ningún lugar del sitio. */
const FORBIDDEN_EXT = /\.(md|py|cjs|mjs|rules|env|log|xlsx|csv|map)$/i;

/**
 * D4 (2026-10-29): `build.js` genera app.bundle.js y chunks/*.js con
 * `sourcemap: 'inline'` (data: URI con `sourcesContent` = todo el código de
 * src/ con comentarios). Se quita SOLO en lo publicado; el repo no cambia.
 * Sentry no sube sourcemaps (no hay sentry-cli/plugin) y el bundle no está
 * minificado: los stack traces siguen siendo legibles (apuntan a líneas del
 * bundle en vez de src/).
 */
export const INLINE_SOURCEMAP_RE = /\n?\/\/# sourceMappingURL=data:[^\n]*\n?$/;

/** @param {string} text */
export function stripInlineSourcemap(text) {
  return text.replace(INLINE_SOURCEMAP_RE, '\n');
}

/**
 * D7 (2026-10-29): el directorio de salida se borra con rmSync recursivo.
 * Solo se acepta `<repo>/_site` o una ruta fuera del repo (p. ej. un tmpdir de
 * tests); nunca una carpeta del repo como `src/`. Se valida ANTES de borrar.
 * @param {string} out ruta absoluta
 */
export function assertSafeOutDir(out) {
  const inRepo = out === ROOT || out.startsWith(ROOT + sep);
  if (inRepo && out !== join(ROOT, '_site')) {
    throw new Error(`Directorio de salida no permitido: ${out}. Usar _site o una ruta fuera del repo.`);
  }
  if (ROOT.startsWith(out + sep)) {
    throw new Error('El directorio de salida no puede ser un padre del repo.');
  }
}

/** @param {string} dir */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/** Chunks referenciados en sw.js (STATIC_ASSETS) y build.js (LAZY_CHUNKS). */
export function declaredChunks() {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const fromSw = [...sw.matchAll(/['"]\.\/chunks\/([A-Za-z0-9_-]+)\.js['"]/g)].map((m) => m[1]);
  const build = readFileSync(join(ROOT, 'build.js'), 'utf8');
  const lazyBlock = build.match(/LAZY_CHUNKS\s*=\s*\{([\s\S]*?)\n\};/);
  const fromBuild = lazyBlock
    ? [...lazyBlock[1].matchAll(/^\s*['"]?([A-Za-z0-9_-]+)['"]?\s*:/gm)].map((m) => m[1])
    : [];
  return [...new Set([...fromSw, ...fromBuild])].sort();
}

/**
 * Arma el sitio en outDir y devuelve la lista de archivos publicados
 * (rutas relativas). Lanza Error con detalle si algo no cumple.
 * @param {string} outDir
 * @returns {string[]}
 */
export function buildSite(outDir) {
  const errors = [];
  const out = resolve(outDir);
  assertSafeOutDir(out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  /** @param {string} rel */
  const copy = (rel) => {
    const dst = join(out, rel);
    mkdirSync(dirname(dst), { recursive: true });
    if (rel.endsWith('.js')) {
      writeFileSync(dst, stripInlineSourcemap(readFileSync(join(ROOT, rel), 'utf8')));
    } else {
      copyFileSync(join(ROOT, rel), dst);
    }
  };

  for (const rel of REQUIRED_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`falta archivo requerido: ${rel}`);
    else copy(rel);
  }
  for (const rel of OPTIONAL_FILES) {
    if (existsSync(join(ROOT, rel))) copy(rel);
  }

  const chunkFiles = existsSync(join(ROOT, CHUNKS_DIR))
    ? readdirSync(join(ROOT, CHUNKS_DIR)).filter((f) => f.endsWith('.js'))
    : [];
  for (const f of chunkFiles) copy(`${CHUNKS_DIR}/${f}`);
  for (const name of declaredChunks()) {
    if (!chunkFiles.includes(`${name}.js`)) {
      errors.push(`chunk declarado en sw.js/build.js sin archivo: chunks/${name}.js`);
    }
  }

  const published = listFiles(out).map((p) => relative(out, p).split('\\').join('/'));
  for (const rel of published) {
    const top = rel.split('/')[0];
    if (FORBIDDEN_PATHS.includes(top) || FORBIDDEN_PATHS.includes(rel)) {
      errors.push(`ruta prohibida en el sitio: ${rel}`);
    }
    if (FORBIDDEN_EXT.test(rel)) errors.push(`extensión prohibida en el sitio: ${rel}`);
    if (/\.(js|html)$/.test(rel)) {
      const t = readFileSync(join(out, rel), 'utf8');
      if (/sourceMappingURL=data:|"sourcesContent"/.test(t)) {
        errors.push(`sourcemap con código fuente en el sitio: ${rel}`);
      }
    }
  }

  if (errors.length) throw new Error('build-pages-site falló:\n- ' + errors.join('\n- '));
  return published.sort();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('Uso: node scripts/pages/build-pages-site.mjs <dirSalida>');
    process.exit(2);
  }
  try {
    const files = buildSite(outDir);
    console.log(`Sitio armado en ${outDir}: ${files.length} archivos`);
    for (const f of files) console.log('  ' + f);
  } catch (e) {
    console.error(/** @type {Error} */ (e).message);
    process.exit(1);
  }
}
