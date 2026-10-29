#!/usr/bin/env node
// @ts-check
/**
 * INFRA (2026-10-29): distingue fallas preexistentes de regresiones nuevas.
 *
 * Uso: node scripts/ci/check-known-failures.mjs <suite> <reporte-vitest.json>
 *   suite: clave en tests/known-failures.json ("rules" | "functions").
 *
 * Sale con 1 si:
 *   - falla un test que NO está en la lista (regresión nueva),
 *   - un test de la lista ahora pasa (hay que sacarlo de la lista),
 *   - un test de la lista falla por OTRA causa (cambió la firma del error),
 *   - aparece un test skipped/todo que no está en la lista de skips conocidos
 *     (un `.skip` nuevo no puede esconder una falla),
 *   - un skip conocido ahora corre (hay que sacarlo de la lista),
 *   - un archivo de test falla al cargar (error de suite, p. ej. emulador ausente),
 *   - se ejecutaron menos tests que el piso `minExecuted` (tests borrados o
 *     suite que no se recolectó),
 *   - el reporte no tiene tests (suite vacía = evidencia nula).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Firma estable de una falla: primera línea del primer mensaje, sin números
 * ni hashes (cambian entre corridas). Detecta "misma prueba, otra causa".
 * @param {string[] | undefined} failureMessages
 */
export function failureSignature(failureMessages) {
  const first = String((failureMessages && failureMessages[0]) || '').split('\n')[0];
  return first.replace(/[0-9a-f]{8,}|\d+/gi, '#').trim();
}

/**
 * @param {any} known contenido de tests/known-failures.json
 * @param {string} suite
 * @param {any} report reporte JSON de vitest
 * @returns {{ok: boolean, lines: string[]}}
 */
export function evaluate(known, suite, report) {
  const lines = [];
  /** @type {{file: string, test: string, signature?: string}[]} */
  const knownList = known[suite];
  if (!Array.isArray(knownList)) return { ok: false, lines: [`Suite desconocida: ${suite}`] };
  /** @type {{file: string, test: string}[]} */
  const knownSkips = (known.skipped && known.skipped[suite]) || [];
  const minExecuted = (known.minExecuted && known.minExecuted[suite]) || 0;
  const key = (/** @type {{file: string, test: string}} */ x) => `${x.file} :: ${x.test}`;
  const knownByKey = new Map(knownList.map((x) => [key(x), x]));
  const knownSkipKeys = new Set(knownSkips.map(key));

  /** @type {Map<string, string>} */
  const failed = new Map();
  const passed = new Set();
  const skippedNow = new Set();
  const suiteErrors = [];
  for (const f of report.testResults || []) {
    const file = String(f.name).replace(/.*?(tests\/)/, '$1');
    const asserts = f.assertionResults || [];
    if (f.status === 'failed' && !asserts.some((/** @type {any} */ t) => t.status === 'failed')) {
      suiteErrors.push(`${file}: ${String(f.message || '').split('\n')[0]}`);
    }
    for (const t of asserts) {
      const k = key({ file, test: t.fullName });
      if (t.status === 'failed') failed.set(k, failureSignature(t.failureMessages));
      else if (t.status === 'passed') passed.add(k);
      else skippedNow.add(k); // skipped | pending | todo | disabled
    }
  }

  const nuevas = [...failed.keys()].filter((k) => !knownByKey.has(k));
  const arregladas = [...knownByKey.keys()].filter((k) => passed.has(k));
  const otraCausa = [...failed.entries()]
    .filter(([k, sig]) => {
      const kn = knownByKey.get(k);
      return kn && kn.signature !== undefined && kn.signature !== sig;
    })
    .map(([k, sig]) => `${k}\n      esperado: ${knownByKey.get(k)?.signature}\n      actual:   ${sig}`);
  const skipsNuevos = [...skippedNow].filter((k) => !knownSkipKeys.has(k));
  const skipsQueCorren = [...knownSkipKeys].filter((k) => passed.has(k) || failed.has(k));
  const ejecutados = passed.size + failed.size;

  lines.push(
    `[${suite}] ejecutados=${ejecutados} fallidos=${failed.size} conocidos=${knownByKey.size} skips=${skippedNow.size} (conocidos ${knownSkipKeys.size}) piso=${minExecuted}`
  );
  let bad = false;
  const fail = (/** @type {string} */ msg, /** @type {string[]} */ items) => {
    bad = true;
    lines.push(`[${suite}] ${msg}${items.length ? ':\n  - ' + items.join('\n  - ') : ''}`);
  };
  if (ejecutados === 0) fail('ERROR: no se ejecutó ningún test (¿emulador ausente?).', []);
  if (ejecutados < minExecuted)
    fail(`ERROR: se ejecutaron ${ejecutados} tests, menos que el piso ${minExecuted} (¿tests borrados o suite sin recolectar?)`, []);
  if (suiteErrors.length) fail('ERROR: archivos que fallaron al cargar', suiteErrors);
  if (nuevas.length) fail('REGRESIÓN: fallas que no están en known-failures', nuevas);
  if (otraCausa.length) fail('REGRESIÓN: falla conocida con OTRA causa (cambió la firma del error)', otraCausa);
  if (skipsNuevos.length) fail('Tests skipped/todo NUEVOS (no pueden esconder fallas; agregarlos a skipped si son legítimos)', skipsNuevos);
  if (arregladas.length) fail('Fallas conocidas que ahora PASAN (sacarlas de tests/known-failures.json)', arregladas);
  if (skipsQueCorren.length) fail('Skips conocidos que ahora CORREN (sacarlos de skipped)', skipsQueCorren);
  return { ok: !bad, lines };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [, , suite, reportPath] = process.argv;
  if (!suite || !reportPath) {
    console.error('Uso: check-known-failures.mjs <suite> <reporte.json>');
    process.exit(2);
  }
  const known = JSON.parse(readFileSync(new URL('../../tests/known-failures.json', import.meta.url), 'utf8'));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const r = evaluate(known, suite, report);
  for (const l of r.lines) (r.ok ? console.log : console.error)(l);
  process.exit(r.ok ? 0 : 1);
}
