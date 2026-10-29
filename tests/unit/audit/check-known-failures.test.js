// @ts-check
/**
 * INFRA (2026-10-29): el gate de fallas conocidas no puede ocultar una
 * regresión nueva. Reportes vitest sintéticos (sin red ni emulador).
 */
import { describe, expect, it } from 'vitest';
import { evaluate, failureSignature } from '../../../scripts/ci/check-known-failures.mjs';

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
