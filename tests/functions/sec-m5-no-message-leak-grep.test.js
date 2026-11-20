// @ts-check
/**
 * SEC-M5 (HARDENING5 B2, 2026-11-19) — anti-regresión grep sobre functions/**.
 *
 * Verifica que ningún archivo del directorio `functions/` propague
 * `e.message`, `String(e)`, `e?.message` o `${e.message}` dentro de un
 * `throw new HttpsError('internal', ...)` o `throw mkErr('internal', ...)`.
 *
 * El patrón canónico §64.2 permitido:
 *   throw new HttpsError(e._errorCode, e.message || 'generic', e._data);  // BUSINESS
 *   throw new HttpsError('internal', 'texto estático');                    // INFRASTRUCTURE
 *   throw mkErr('internal', 'texto estático');                             // INFRASTRUCTURE
 *
 * Prohibidos:
 *   throw new HttpsError('internal', 'X: ' + e.message)
 *   throw new HttpsError('internal', 'X: ' + String(e))
 *   throw new HttpsError('internal', 'X: ' + (e?.message || ...))
 *   throw new HttpsError('internal', 'X: ' + (e && e.message))
 *   throw mkErr('internal', 'X: ' + e.message)
 *   throw new HttpsError('internal', `X ${e.message}`)  (template literal)
 *
 * Portado del worktree R01 (tests/functions/sec-m5-no-message-leak-grep.test.js).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FUNCTIONS_DIR = resolve(__dirname, '../../functions');

function listJsFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      if (entry === 'test') continue; // test helpers OK
      if (entry === 'tests') continue;
      listJsFiles(full, acc);
    } else if (st.isFile() && entry.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

// 8 patterns prohibidos. Cubren concat con +, optional chaining, logical AND,
// String(e), y template literals ${...}.
const PROHIBITED_PATTERNS = [
  {
    name: '+ e.message',
    regex: /throw\s+(new\s+)?(HttpsError|mkErr)\s*\(\s*['"]internal['"]\s*,[^)]*\+\s*e\.message/,
  },
  {
    name: '+ e?.message (optional chaining)',
    regex: /throw\s+(new\s+)?(HttpsError|mkErr)\s*\(\s*['"]internal['"]\s*,[^)]*\+\s*e\?\.message/,
  },
  {
    name: '+ (e && e.message) (logical AND)',
    regex:
      /throw\s+(new\s+)?(HttpsError|mkErr)\s*\(\s*['"]internal['"]\s*,[^)]*\+\s*\(e\s*&&\s*e\.message/,
  },
  {
    name: '+ String(e)',
    regex:
      /throw\s+(new\s+)?(HttpsError|mkErr)\s*\(\s*['"]internal['"]\s*,[^)]*\+\s*String\(\s*e\s*\)/,
  },
  {
    name: 'String(e && e.message ? e.message : e)',
    regex:
      /throw\s+(new\s+)?(HttpsError|mkErr)\s*\(\s*['"]internal['"]\s*,\s*String\(\s*e\s*&&\s*e\.message/,
  },
  {
    name: 'template literal `${e.message}`',
    regex:
      /throw\s+(new\s+)?(HttpsError|mkErr)\s*\(\s*['"]internal['"]\s*,\s*`[^`]*\$\{\s*e\.message/,
  },
  {
    name: 'template literal `${e?.message}` (optional)',
    regex:
      /throw\s+(new\s+)?(HttpsError|mkErr)\s*\(\s*['"]internal['"]\s*,\s*`[^`]*\$\{\s*e\?\.message/,
  },
  {
    name: 'template literal `${String(e)}`',
    regex:
      /throw\s+(new\s+)?(HttpsError|mkErr)\s*\(\s*['"]internal['"]\s*,\s*`[^`]*\$\{\s*String\(\s*e/,
  },
];

const files = listJsFiles(FUNCTIONS_DIR);

describe('SEC-M5 anti-regresión: zero leaks de e.message/String(e) en throws internal', () => {
  for (const file of files) {
    const rel = file.replace(FUNCTIONS_DIR + '\\', '').replace(FUNCTIONS_DIR + '/', '');
    it(`${rel}: zero patterns prohibidos`, () => {
      const content = readFileSync(file, 'utf8');
      for (const { name, regex } of PROHIBITED_PATTERNS) {
        const match = content.match(regex);
        expect(match, `Pattern "${name}" encontrado en ${rel}: ${match && match[0]}`).toBeNull();
      }
    });
  }

  it('cobertura de la auditoría: encontró al menos 60 archivos .js en functions/', () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
  });
});
