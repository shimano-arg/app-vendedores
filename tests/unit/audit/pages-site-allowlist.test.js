// @ts-check
/**
 * SEC-07 (P0, 2026-10-29) — la publicación en GitHub Pages usa una allowlist.
 *
 * Arma el sitio en un directorio temporal (no toca el repo) y verifica:
 * - están todos los archivos que la app pide en runtime,
 * - no se publica nada prohibido (CLAUDE.md, docs/, tests/, scripts/, ...),
 * - toda referencia relativa de index.html / sw.js / manifest existe en el sitio,
 * - el workflow sube _site y no el repo entero.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertSafeOutDir,
  buildSite,
  declaredChunks,
  FORBIDDEN_PATHS,
  REQUIRED_FILES,
  stripInlineSourcemap,
} from '../../../scripts/pages/build-pages-site.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
let outDir = '';
/** @type {string[]} */
let published = [];

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'pages-site-'));
  published = buildSite(join(outDir, '_site'));
});
afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('SEC-07 — contenido del sitio publicado', () => {
  it('P1: incluye todos los archivos requeridos', () => {
    for (const f of REQUIRED_FILES) expect(published).toContain(f);
  });

  it('P2: incluye todos los chunks declarados en sw.js y build.js', () => {
    const chunks = declaredChunks();
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(published).toContain(`chunks/${c}.js`);
  });

  it('P3: NO publica CLAUDE.md, docs/, tests/, scripts/, functions/, reglas ni fixtures', () => {
    for (const p of published) {
      expect(FORBIDDEN_PATHS).not.toContain(p.split('/')[0]);
      expect(p).not.toMatch(/\.(md|py|cjs|rules|env|log|xlsx|csv)$/i);
    }
    for (const must of ['CLAUDE.md', 'README.md', 'firestore.rules', 'storage.rules']) {
      expect(published).not.toContain(must);
    }
    expect(published.some((p) => p.startsWith('docs/'))).toBe(false);
    expect(published.some((p) => p.startsWith('tests/'))).toBe(false);
    expect(published.some((p) => p.startsWith('scripts/'))).toBe(false);
  });

  it('P4: toda referencia relativa a un archivo local en index.html / sw.js / manifest existe en el sitio', () => {
    // Se descartan líneas de comentario (`//`, `*`): mencionan rutas de src/
    // como documentación, no son recursos que la app pida en runtime.
    const texts = ['index.html', 'sw.js', 'manifest.json', 'alta-cliente.html'].map((f) =>
      readFileSync(join(ROOT, f), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
    );
    const refs = new Set();
    for (const t of texts) {
      for (const m of t.matchAll(
        /["'(`](?:\.\/)?([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:png|jpg|svg|ico|json|js|css|html|webp))["')`?#]/g
      )) {
        refs.add(m[1]);
      }
    }
    // Solo las que existen como archivo en el repo (descarta nombres de
    // variables/strings que no son rutas).
    const locales = [...refs].filter((r) => existsSync(join(ROOT, r)));
    expect(locales.length).toBeGreaterThan(10);
    const faltan = locales.filter((r) => !published.includes(r));
    expect(faltan).toEqual([]);
  });
});

describe('D4 — sin sourcemaps con código fuente en lo publicado', () => {
  it('S1: ningún .js/.html publicado contiene sourceMappingURL=data: ni sourcesContent', () => {
    for (const p of published.filter((f) => /\.(js|html)$/.test(f))) {
      const t = readFileSync(join(outDir, '_site', p), 'utf8');
      expect(t, p).not.toMatch(/sourceMappingURL=data:/);
      expect(t, p).not.toContain('"sourcesContent"');
    }
  });
  it('S2: el repo NO cambia (el bundle commiteado conserva su sourcemap)', () => {
    expect(readFileSync(join(ROOT, 'app.bundle.js'), 'utf8')).toMatch(/sourceMappingURL=data:/);
  });
  it('S3: el bundle y los chunks publicados siguen siendo JS válido', () => {
    for (const p of published.filter((f) => f === 'app.bundle.js' || f.startsWith('chunks/'))) {
      expect(() => new Function(readFileSync(join(outDir, '_site', p), 'utf8')), p).not.toThrow();
    }
  });
  it('S4: stripInlineSourcemap solo quita la línea final de data: URI', () => {
    expect(
      stripInlineSourcemap('a();\n//# sourceMappingURL=data:application/json;base64,AAA\n')
    ).toBe('a();\n');
    expect(
      stripInlineSourcemap('a(); // sourceMappingURL=data: en un comentario intermedio\nb();')
    ).toBe('a(); // sourceMappingURL=data: en un comentario intermedio\nb();');
  });
});

describe('D7 — el directorio de salida no puede ser una carpeta del repo', () => {
  it('O1: rechaza src/, functions/, la raíz y un padre del repo (sin borrar nada)', () => {
    for (const bad of ['src', 'functions', '.', '..']) {
      expect(() => assertSafeOutDir(resolve(ROOT, bad)), bad).toThrow();
    }
  });
  it('O2: acepta <repo>/_site y rutas fuera del repo', () => {
    expect(() => assertSafeOutDir(join(ROOT, '_site'))).not.toThrow();
    expect(() => assertSafeOutDir(join(tmpdir(), 'x-site'))).not.toThrow();
  });
});

describe('SEC-07 — workflow deploy-pages.yml', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/deploy-pages.yml'), 'utf8');

  it('W1: arma el sitio con el script de allowlist', () => {
    expect(wf).toContain('node scripts/pages/build-pages-site.mjs _site');
  });

  it("W2: sube '_site' y ya no sube el repo entero (path: '.')", () => {
    expect(wf).toMatch(/path:\s*'_site'/);
    expect(wf).not.toMatch(/path:\s*['"]\.['"]/);
  });

  it('W3: el armado ocurre antes del upload', () => {
    expect(wf.indexOf('build-pages-site.mjs')).toBeLessThan(wf.indexOf('upload-pages-artifact'));
  });
});
