// sec 2026-11-24 (S-01) — ninguna contraseña de cuentas de prueba en el repo.
// Las credenciales de E2E se pasan por variable de entorno.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
// Patrón de la contraseña por defecto que se usó en el pasado (marca + año).
const PATTERN = new RegExp(['Shim', 'ano20', '\\d{2}'].join(''));
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'evidencia',
  'playwright-report',
  'test-results',
]);
const EXT = /\.(c?js|mjs|ts|md|html|json|py|ya?ml)$/i;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name) && st.size < 5_000_000) out.push(p);
  }
  return out;
}

describe('S-01: sin contraseñas de prueba hardcodeadas', () => {
  it('scripts/, tests/, README.md e index.html no contienen la contraseña por defecto', () => {
    const files = [
      ...walk(join(ROOT, 'scripts'), []),
      ...walk(join(ROOT, 'tests'), []),
      join(ROOT, 'README.md'),
      join(ROOT, 'index.html'),
    ];
    const hits = files.filter((f) => PATTERN.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it('el script de alta lee la contraseña de E2E_PRUEBAS_PASSWORD y falla si falta', () => {
    const s = readFileSync(join(ROOT, 'scripts/create-pruebas-gerente-user.cjs'), 'utf8');
    expect(s).toMatch(/process\.env\.E2E_PRUEBAS_PASSWORD/);
    expect(s).toMatch(/process\.exit\(1\)/);
  });

  it('el spec E2E no tiene fallback de contraseña', () => {
    const s = readFileSync(join(ROOT, 'tests/e2e/pablo-import-reparto.spec.ts'), 'utf8');
    expect(s).toMatch(/const E2E_PASS = process\.env\.E2E_PRUEBAS_PASSWORD \|\| '';/);
  });
});
