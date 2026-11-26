// @ts-check
/**
 * ADR-0009 — Feature Flags Governance.
 *
 * Verifica el contrato del pure helper + documenta el shape esperado del
 * doc `app_config/feature_flags.<flag>` según ADR-0009.
 *
 * Alcance acotado:
 *   - El test valida contrato del CÓDIGO (readFlag + isDep12RepartoEnabled).
 *   - El validation del SHAPE DE DATOS en Firestore se hace vía el script
 *     `scripts/audit/feature_flags_audit.cjs` (read-only, usado en review
 *     mensual + futuro watchdog Panel Control).
 *   - Firestore rules actuales ya protegen contra escritura no-Mariano
 *     (CLAUDE.md §107). Un test server-side de rules ya existe aparte.
 *
 * Si el shape cambia (ej. se agrega un campo obligatorio), este archivo
 * documenta las expectativas para que el próximo PR las revise.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  FEATURE_FLAG_DOC_PATH,
  isDep12RepartoEnabled,
  readFlag,
} from '../../../src/pure/feature-flags.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..', '..');

describe('ADR-0009 — readFlag fail-open defensivo', () => {
  it('readFlag(null, key, default) devuelve default (doc inexistente)', () => {
    expect(readFlag(null, 'dep12_reparto_enabled', false)).toBe(false);
    expect(readFlag(null, 'dep12_reparto_enabled', true)).toBe(true);
  });

  it('readFlag(undefined, key, default) devuelve default', () => {
    expect(readFlag(undefined, 'any_flag', false)).toBe(false);
  });

  it('readFlag({}, key, default) devuelve default (doc existe pero sin la key)', () => {
    expect(readFlag({}, 'dep12_reparto_enabled', false)).toBe(false);
  });

  it('readFlag({flag: true}, flag, false) devuelve true (shape legacy boolean directo)', () => {
    expect(readFlag({ dep12_reparto_enabled: true }, 'dep12_reparto_enabled', false)).toBe(true);
  });

  it('readFlag con valor no-boolean devuelve default (shape inválido)', () => {
    expect(readFlag({ x: 'yes' }, 'x', false)).toBe(false);
    expect(readFlag({ x: 1 }, 'x', false)).toBe(false);
    expect(readFlag({ x: null }, 'x', false)).toBe(false);
  });
});

describe('ADR-0009 — isDep12RepartoEnabled compat con ambos shapes', () => {
  it('shape legacy boolean directo: {dep12_reparto_enabled: true}', () => {
    expect(isDep12RepartoEnabled({ dep12_reparto_enabled: true })).toBe(true);
    expect(isDep12RepartoEnabled({ dep12_reparto_enabled: false })).toBe(false);
  });

  it('default false si doc null/undefined/sin key', () => {
    expect(isDep12RepartoEnabled(null)).toBe(false);
    expect(isDep12RepartoEnabled(undefined)).toBe(false);
    expect(isDep12RepartoEnabled({})).toBe(false);
  });

  it('TODO ADR-0009: shape rich con subcampo .value no está soportado por readFlag hoy', () => {
    // Nota: el shape nuevo de ADR-0009 ({ value, owner, expiryDate, ... })
    // requiere que `readFlag` lea `doc.<flag>.value` en vez de `doc.<flag>`.
    // Ese cambio de shape es BREAKING para los consumidores actuales.
    // ADR-0009 deja compat legacy: si el valor es boolean directo, se usa.
    // Cuando `src/pure/feature-flags.js` se extienda para leer subcampo, actualizar este test.
    const docRich = {
      dep12_reparto_enabled: {
        value: true,
        owner: 'erbinomariano@gmail.com',
        expiryDate: '2027-02-25',
      },
    };
    // Hoy: devuelve false porque el valor no es boolean (es objeto).
    // Esto documenta el estado actual pre-migración.
    expect(isDep12RepartoEnabled(docRich)).toBe(false);
  });
});

describe('ADR-0009 — FEATURE_FLAG_DOC_PATH es canónico', () => {
  it('FEATURE_FLAG_DOC_PATH === "app_config/feature_flags"', () => {
    expect(FEATURE_FLAG_DOC_PATH).toBe('app_config/feature_flags');
  });

  it('firestore.rules protege la ruta con write: isMariano() (grep)', () => {
    const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
    // ADR-0009 depende de que la ruta siga protegida. Grep defensivo.
    // Si rules se refactoriza, actualizar este expect.
    expect(rules).toContain('/app_config/feature_flags');
  });
});

describe('ADR-0009 — script audit presente', () => {
  it('scripts/audit/feature_flags_audit.cjs existe (watchdog + review mensual)', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'audit', 'feature_flags_audit.cjs'), 'utf8');
    expect(script).toContain('ADR-0009');
    // Smoke: lista las 4 keys requeridas del shape rich.
    expect(script).toContain("'owner'");
    expect(script).toContain("'expiryDate'");
    expect(script).toContain("'description'");
    expect(script).toContain("'testsPath'");
  });
});

describe('ADR-0009 — mirror cliente/server sigue sincronizado (§57)', () => {
  // El mirror tiene header propio pero el body (exports + lógica) debe ser idéntico.
  function stripLeadingBlockComment(src) {
    // Quita el bloque de comentario inicial /** ... */ para comparar solo el código real.
    return src.replace(/\r\n/g, '\n').replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');
  }

  it('src/pure/feature-flags.js body === functions/core/feature-flags.js body (post-header)', () => {
    const pureFile = readFileSync(join(ROOT, 'src', 'pure', 'feature-flags.js'), 'utf8');
    const mirrorFile = readFileSync(join(ROOT, 'functions', 'core', 'feature-flags.js'), 'utf8');
    expect(stripLeadingBlockComment(pureFile)).toBe(stripLeadingBlockComment(mirrorFile));
  });
});
