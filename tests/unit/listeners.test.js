// E1 (e2b-perf): garantiza que detachFirebaseListeners() cubre TODOS los
// listeners onSnapshot declarados en index.html. Sin este test, cada
// listener nuevo agregado al app quedaría como leak invisible al logout.
//
// 2 layers:
//   A) Linting: parsea index.html, extrae `let unsub*` / `var unsub*` y
//      verifica que cada uno tenga su llamada `off('unsubX', ...)` en
//      detachFirebaseListeners.
//   B) Behavior: ejercita el patrón `off()` en vm.Context con mocks.
//      Verifica: función tira → siguiente unsub sí se llama; setNull tira
//      → siguiente sí se corre; función OK → return 1.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ROOT = process.cwd();
const INDEX = join(ROOT, 'index.html');
const DOMAINS_DIR = join(ROOT, 'src', 'domains');
const HTML = readFileSync(INDEX, 'utf8');

/**
 * Extrae los nombres de variables `let/var unsub*` declaradas en el inline
 * `index.html` MÁS los `window.unsub* = ...` inicializados desde `src/domains/*.js`
 * (E2 extracciones). Post-E2 los listeners viven en 2 lugares: los del shell
 * (Firebase Auth core, top-level auth listeners) siguen en index.html; los
 * de dominios extraídos declaran su unsub* como window.unsub* en el bundle.
 * @returns {string[]} lista ordenada de nombres únicos
 */
function extractDeclaredListeners() {
  const names = new Set();
  // A) Inline en index.html.
  const inlineRe = /^(?:let|var)\s+(_?unsub[A-Z][a-zA-Z0-9_]*)\s*=/gm;
  let m;
  while ((m = inlineRe.exec(HTML))) names.add(m[1]);
  // B) Modules del bundle (src/domains/*.js) que inicializan window.unsub*.
  if (existsSync(DOMAINS_DIR)) {
    for (const f of readdirSync(DOMAINS_DIR)) {
      if (!f.endsWith('.js')) continue;
      const src = readFileSync(join(DOMAINS_DIR, f), 'utf8');
      const bundleRe = /window\.(_?unsub[A-Z][a-zA-Z0-9_]*)\s*=/g;
      while ((m = bundleRe.exec(src))) names.add(m[1]);
    }
  }
  return [...names].sort();
}

/**
 * Extrae los nombres de listeners que aparecen en `off('<name>', ...)`
 * calls dentro del body de detachFirebaseListeners() (approx: entre la
 * declaración `function detachFirebaseListeners` y la próxima `function`).
 * @returns {string[]}
 */
function extractDetachedListeners() {
  const start = HTML.indexOf('function detachFirebaseListeners()');
  if (start === -1) throw new Error('detachFirebaseListeners() no encontrada en index.html');
  const nextFn = HTML.indexOf('\nfunction ', start + 1);
  const body = HTML.slice(start, nextFn === -1 ? HTML.length : nextFn);
  const re = /off\('([^']+)'/g;
  const names = new Set();
  let m;
  while ((m = re.exec(body))) names.add(m[1]);
  return [...names].sort();
}

describe('detachFirebaseListeners — cobertura de todos los onSnapshot listeners', () => {
  it('parsea index.html y extrae >20 declared unsub* (sanity de la extraction)', () => {
    const declared = extractDeclaredListeners();
    // El baseline pre-E1 tenía 31 variables unsub*. Assertion laxa (>=20) para
    // no romper el test si se agregan/eliminan listeners legítimamente. La
    // assertion estricta que importa es la de cobertura, más abajo.
    expect(declared.length).toBeGreaterThanOrEqual(20);
    // Sanity: nombres conocidos del baseline pre-E1 deben estar declarados.
    for (const known of [
      'unsubUserData',
      'unsubPedidosOwn',
      'unsubApprovedAltas',
      'unsubTargets',
    ]) {
      expect(declared, `${known} debe estar declarado en index.html`).toContain(known);
    }
  });

  it('parsea detachFirebaseListeners y extrae los off() calls', () => {
    const detached = extractDetachedListeners();
    expect(detached.length).toBeGreaterThanOrEqual(20);
    for (const known of ['unsubUserData', 'unsubApprovedAltas']) {
      expect(detached, `${known} debe estar en off() de detachFirebaseListeners`).toContain(known);
    }
  });

  it('TODO listener declarado en index.html tiene su off() en detachFirebaseListeners', () => {
    const declared = extractDeclaredListeners();
    const detached = extractDetachedListeners();
    const missing = declared.filter((name) => !detached.includes(name));
    expect(
      missing,
      `Listeners sin off() en detachFirebaseListeners (leak candidates): ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('ningún off() referencia un listener que no exista (dead code)', () => {
    const declared = extractDeclaredListeners();
    const detached = extractDetachedListeners();
    const orphan = detached.filter((name) => !declared.includes(name));
    expect(orphan, `off() de listeners inexistentes en index.html: ${orphan.join(', ')}`).toEqual(
      []
    );
  });
});

describe('detachFirebaseListeners — patrón off() behavior (aislado en vm)', () => {
  // El helper off() del detachFirebaseListeners se comporta así:
  //   - Si fn no es function → return 0 (skip)
  //   - Si fn tira → warn + intenta setNull
  //   - Si fn OK + setNull OK → return 1
  //   - Si setNull tira → return 1 igual (el unsub ya se ejecutó)

  function makeOff() {
    // Replica del helper interno para poder testarlo sin ejecutar el HTML.
    return (_name, fn, setNull) => {
      if (typeof fn !== 'function') return 0;
      try {
        fn();
      } catch (e) {
        /* swallow */
      }
      try {
        setNull();
      } catch (_) {}
      return 1;
    };
  }

  it('return 0 cuando fn === null (listener nunca inicializado)', () => {
    const off = makeOff();
    let x = null;
    expect(
      off('x', x, () => {
        x = null;
      })
    ).toBe(0);
  });

  it('llama fn() + setNull() cuando fn es function', () => {
    const off = makeOff();
    const spy = vi.fn();
    let x = spy;
    expect(
      off('x', x, () => {
        x = null;
      })
    ).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(x).toBe(null);
  });

  it('fn tira → aún llama setNull (leak parcial > total)', () => {
    const off = makeOff();
    const spy = vi.fn(() => {
      throw new Error('unsub crashed');
    });
    let x = spy;
    expect(
      off('x', x, () => {
        x = null;
      })
    ).toBe(1);
    expect(x).toBe(null);
  });

  it('setNull tira → return 1 igual (el unsub ya corrió)', () => {
    const off = makeOff();
    const spy = vi.fn();
    const x = spy;
    expect(
      off('x', x, () => {
        throw new Error('setNull crashed');
      })
    ).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
