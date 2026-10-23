// @ts-check
/**
 * v1435 §56 (2026-10-24): verifica que el helper `computeDuplicateCodes` y
 * las clases CSS `.merge-duplicate-*`/`.badge-duplicado` fueron eliminadas
 * de src/ y de index.html como código activo.
 *
 * Permitidos solo en comentarios o en strings de documentación histórica.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DIRNAME, '..', '..', '..');
const SRC_DIR = resolve(ROOT, 'src');
const INDEX_HTML_PATH = resolve(ROOT, 'index.html');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walkJs(p));
    } else if (/\.js$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Elimina comentarios de bloque `/\*...\*\/` y de línea `//...` para hacer
 * grep sobre el código "vivo" (ignorando documentación).
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const SRC_JS_FILES = walkJs(SRC_DIR);
const INDEX_HTML_RAW = readFileSync(INDEX_HTML_PATH, 'utf-8');

describe('§56: computeDuplicateCodes eliminado como código activo', () => {
  it('No existe export/declaración de computeDuplicateCodes en src/', () => {
    const violations = [];
    for (const file of SRC_JS_FILES) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      if (/\bfunction\s+computeDuplicateCodes\b/.test(src)) {
        violations.push(file + ' (declaración de función)');
      }
      if (
        /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\s+)?computeDuplicateCodes\b/.test(src)
      ) {
        violations.push(file + ' (export)');
      }
    }
    expect(violations).toEqual([]);
  });

  it('No existe import de computeDuplicateCodes en src/', () => {
    const violations = [];
    for (const file of SRC_JS_FILES) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      if (/\bimport[^;]*\bcomputeDuplicateCodes\b/.test(src)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it('index.html NO invoca computeDuplicateCodes como código activo', () => {
    const src = stripComments(INDEX_HTML_RAW);
    // Buscar invocación efectiva: `.computeDuplicateCodes(` o `computeDuplicateCodes(`.
    expect(src).not.toMatch(/\.computeDuplicateCodes\s*\(/);
    expect(src).not.toMatch(/\bcomputeDuplicateCodes\s*\(/);
  });
});

describe('§56: clases CSS .merge-duplicate-* y .badge-duplicado eliminadas', () => {
  it('index.html NO contiene reglas CSS para .merge-duplicate-original ni .merge-duplicate-imported', () => {
    expect(INDEX_HTML_RAW).not.toMatch(/\.merge-duplicate-original\s*\{[^}]+\}/);
    expect(INDEX_HTML_RAW).not.toMatch(/\.merge-duplicate-imported\s*\{[^}]+\}/);
  });

  it('index.html NO agrega la clase merge-duplicate-* al DOM', () => {
    const src = stripComments(INDEX_HTML_RAW);
    expect(src).not.toMatch(/classList\.add\(['"]merge-duplicate-/);
    // El uso 'merge-' + _mergeCls debe no evaluar nunca a merge-duplicate-* (regla sólo contiene imported | reservado-imported).
  });

  it('index.html NO contiene regla CSS .badge-duplicado activa', () => {
    expect(INDEX_HTML_RAW).not.toMatch(/^[^/]*\.badge-duplicado\s*\{[^}]+\}/m);
  });
});
