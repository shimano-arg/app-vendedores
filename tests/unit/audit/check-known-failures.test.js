// @ts-check
/**
 * INFRA (2026-10-29): el gate de fallas conocidas no puede ocultar una
 * regresión nueva. Reportes vitest sintéticos (sin red ni emulador).
 */
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  failureSignature,
  summaryMarkdown,
  toRepoRelative,
} from '../../../scripts/ci/check-known-failures.mjs';

const KNOWN = {
  version: 2,
  rules: [
    {
      file: 'tests/rules/a.test.js',
      test: 'A conocida',
      signature: 'AssertionError: expected # to be # // Object.is equality',
    },
  ],
  skipped: { rules: [{ file: 'tests/rules/a.test.js', test: 'A skip legítimo' }] },
  minExecuted: { rules: 3 },
};

/** @param {Array<[string, string, string?]>} tests [nombre, status, mensaje] en tests/rules/a.test.js */
function report(tests, extraFiles = []) {
  return {
    testResults: [
      {
        name: '/repo/tests/rules/a.test.js',
        status: tests.some((t) => t[1] === 'failed') ? 'failed' : 'passed',
        assertionResults: tests.map(([fullName, status, msg]) => ({
          fullName,
          status,
          failureMessages: msg ? [msg] : [],
        })),
      },
      ...extraFiles,
    ],
  };
}
const BASE = () => [
  ['A conocida', 'failed', 'AssertionError: expected 2 to be 1 // Object.is equality'],
  ['A skip legítimo', 'skipped'],
  ['B', 'passed'],
  ['C', 'passed'],
  ['D', 'passed'],
];

describe('check-known-failures — no oculta regresiones', () => {
  it('G0: estado conocido exacto → OK', () => {
    expect(evaluate(KNOWN, 'rules', report(BASE())).ok).toBe(true);
  });
  it('G1: falla nueva → falla', () => {
    const t = BASE();
    t[2] = ['B', 'failed', 'Error: boom'];
    const r = evaluate(KNOWN, 'rules', report(t));
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/REGRESIÓN: fallas que no están/);
  });
  it('G2: falla conocida que ahora pasa → falla (hay que actualizar la lista)', () => {
    const t = BASE();
    t[0] = ['A conocida', 'passed'];
    expect(evaluate(KNOWN, 'rules', report(t)).ok).toBe(false);
  });
  it('G3: falla conocida con OTRA causa → falla', () => {
    const t = BASE();
    t[0] = ['A conocida', 'failed', 'TypeError: cannot read x of undefined'];
    const r = evaluate(KNOWN, 'rules', report(t));
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/OTRA causa/);
  });
  it('G4: misma causa con otros números → OK (firma normalizada)', () => {
    const t = BASE();
    t[0] = ['A conocida', 'failed', 'AssertionError: expected 7 to be 3 // Object.is equality'];
    expect(evaluate(KNOWN, 'rules', report(t)).ok).toBe(true);
  });
  it('G5: un `.skip` nuevo sobre un test que fallaba → falla', () => {
    const t = BASE();
    t[2] = ['B', 'skipped'];
    const r = evaluate(KNOWN, 'rules', report(t));
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/skipped\/todo NUEVOS/);
  });
  it('G6: `todo` nuevo → falla', () => {
    const t = BASE();
    t.push(['E', 'todo']);
    expect(evaluate(KNOWN, 'rules', report(t)).ok).toBe(false);
  });
  it('G7: skip conocido que ahora corre → falla (actualizar lista)', () => {
    const t = BASE();
    t[1] = ['A skip legítimo', 'passed'];
    expect(evaluate(KNOWN, 'rules', report(t)).ok).toBe(false);
  });
  it('G8: tests borrados por debajo del piso → falla', () => {
    const t = BASE().slice(0, 3); // quedan 2 ejecutados < piso 3
    const r = evaluate(KNOWN, 'rules', report(t));
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/menos que el piso/);
  });
  it('G9: archivo que no carga (sin assertions) → falla', () => {
    const r = evaluate(
      KNOWN,
      'rules',
      report(BASE(), [
        {
          name: '/repo/tests/rules/b.test.js',
          status: 'failed',
          message: 'emulador ausente',
          assertionResults: [],
        },
      ])
    );
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/fallaron al cargar/);
  });
  it('G10: reporte vacío → falla', () => {
    expect(evaluate(KNOWN, 'rules', { testResults: [] }).ok).toBe(false);
  });
  it('G11: suite desconocida → falla', () => {
    expect(evaluate(KNOWN, 'otra', report(BASE())).ok).toBe(false);
  });
  it('firma: primera línea, sin números ni hashes', () => {
    expect(failureSignature(['FirebaseError: 7 PERMISSION_DENIED: x\n at y'])).toBe(
      'FirebaseError: # PERMISSION_DENIED: x'
    );
    expect(failureSignature(undefined)).toBe('');
  });
});

describe('check-known-failures v3 — rutas, seguridad y revisión vencida', () => {
  const KNOWN_V3 = {
    version: 3,
    rules: [
      {
        file: 'tests/rules/a.test.js',
        test: 'A conocida',
        signature: 'AssertionError: expected # to be # // Object.is equality',
        hallazgo: 'S04',
        securityRelevant: true,
        revisarAntesDe: '2026-11-30',
      },
    ],
    skipped: {
      rules: [
        { file: 'tests/rules/a.test.js', test: 'A skip legítimo', revisarAntesDe: '2026-11-15' },
      ],
    },
    minExecuted: { rules: 3 },
  };

  it('G12: el path absoluto se normaliza aunque el directorio del clon contenga "tests"', () => {
    expect(toRepoRelative('/x/ciclo1-tests/tests/functions/a.test.js', '/x/ciclo1-tests/')).toBe(
      'tests/functions/a.test.js'
    );
    expect(toRepoRelative('/x/ciclo1-tests/tests/functions/a.test.js', '/otra/raiz/')).toBe(
      'tests/functions/a.test.js'
    );
    expect(toRepoRelative('C:\\repo\\tests\\rules\\r.test.js', 'C:\\repo\\')).toBe(
      'tests/rules/r.test.js'
    );
  });

  it('G13: con un clon en ".../algo-tests/" una falla conocida que pasa SIGUE detectándose', () => {
    const rep = report(BASE());
    rep.testResults[0].name = '/x/ciclo1-tests/tests/rules/a.test.js';
    rep.testResults[0].assertionResults[0] = {
      fullName: 'A conocida',
      status: 'passed',
      failureMessages: [],
    };
    rep.testResults[0].status = 'passed';
    const r = evaluate(KNOWN_V3, 'rules', rep, { today: '2026-11-02' });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/ahora PASAN/);
  });

  it('G14: falla conocida de seguridad abierta → se lista, pero NO cambia el resultado', () => {
    const r = evaluate(KNOWN_V3, 'rules', report(BASE()), { today: '2026-11-02' });
    expect(r.ok).toBe(true);
    expect(r.security).toHaveLength(1);
    expect(r.security[0]).toMatch(/^S04 · tests\/rules\/a\.test\.js :: A conocida$/);
    expect(r.lines.join('\n')).toMatch(/SEGURIDAD abiertas \(1\)/);
  });

  it('G15: revisión vencida → aviso (no cambia el resultado); sin vencer → sin aviso', () => {
    const vencida = evaluate(KNOWN_V3, 'rules', report(BASE()), { today: '2026-12-01' });
    expect(vencida.ok).toBe(true);
    expect(vencida.overdue).toHaveLength(2);
    const enFecha = evaluate(KNOWN_V3, 'rules', report(BASE()), { today: '2026-11-02' });
    expect(enFecha.overdue).toHaveLength(0);
  });

  it('G16: suite sin fallas conocidas (unit/smoke) aplica el piso de ejecutados', () => {
    const known = { version: 3, unit: [], skipped: { unit: [] }, minExecuted: { unit: 5 } };
    const pocos = {
      testResults: [
        {
          name: '/repo/tests/unit/u.test.js',
          status: 'passed',
          assertionResults: [{ fullName: 'U1', status: 'passed', failureMessages: [] }],
        },
      ],
    };
    const r = evaluate(known, 'unit', pocos, { today: '2026-11-02' });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/menos que el piso 5/);
  });

  it('G17: el resumen markdown incluye el estado y el bloque de seguridad', () => {
    const r = evaluate(KNOWN_V3, 'rules', report(BASE()), { today: '2026-11-02' });
    const md = summaryMarkdown('rules', r);
    expect(md).toMatch(/Gate de fallas conocidas · rules: ✅ OK/);
    expect(md).toMatch(/falla\(s\) conocida\(s\) de seguridad/);
  });
});
