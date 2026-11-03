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
 *
 * v3 (2026-11-02, ciclo 1 Security & Stabilization) — informativo, NO cambia
 * el exit code:
 *   - entradas con `securityRelevant: true` (+ `hallazgo`) que siguen fallando
 *     se listan SIEMPRE en un bloque "Fallas conocidas de SEGURIDAD abiertas",
 *     para que un hueco de seguridad documentado por un test no quede tapado
 *     como "falla conocida";
 *   - entradas con `revisarAntesDe` (YYYY-MM-DD) vencido se listan como aviso;
 *   - si existe GITHUB_STEP_SUMMARY, se agrega un resumen en markdown.
 * `--today=YYYY-MM-DD` fija la fecha (tests).
 */
import { appendFileSync, readFileSync } from 'node:fs';
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

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Ruta del archivo de test relativa a la raíz del repo ("tests/...").
 * v3 fix: la versión anterior usaba `replace(/.*?(tests\/)/, '$1')` (no greedy),
 * que corta en la PRIMERA aparición de "tests/" del path absoluto: si el repo
 * está clonado en un directorio cuyo nombre termina en "tests" (p. ej.
 * `/x/ciclo1-tests/tests/functions/a.test.js`) devolvía `tests/tests/functions/...`,
 * ninguna clave coincidía y el gate dejaba de detectar fallas conocidas que
 * pasan (y marcaba como "nuevas" las conocidas).
 * @param {string} name path absoluto o relativo que reporta vitest
 * @param {string} [root] raíz del repo (tests)
 */
export function toRepoRelative(name, root = REPO_ROOT) {
  const norm = name.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').replace(/\/?$/, '/');
  if (norm.startsWith(r)) return norm.slice(r.length);
  const i = norm.lastIndexOf('/tests/');
  if (i >= 0) return norm.slice(i + 1);
  return norm;
}

/**
 * @param {any} known contenido de tests/known-failures.json
 * @param {string} suite
 * @param {any} report reporte JSON de vitest
 * @param {{today?: string}} [opts] fecha de referencia YYYY-MM-DD (default: hoy UTC)
 * @returns {{ok: boolean, lines: string[], security: string[], overdue: string[]}}
 */
export function evaluate(known, suite, report, opts = {}) {
  const lines = [];
  /** @type {string[]} */
  const security = [];
  /** @type {string[]} */
  const overdue = [];
  const today = opts.today || new Date().toISOString().slice(0, 10);
  /** @type {{file: string, test: string, signature?: string, securityRelevant?: boolean, hallazgo?: string, revisarAntesDe?: string}[]} */
  const knownList = known[suite];
  if (!Array.isArray(knownList)) return { ok: false, lines: [`Suite desconocida: ${suite}`], security, overdue };
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
    const file = toRepoRelative(String(f.name));
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

  // v3: informativo (no cambia `ok`).
  for (const kn of [...knownList, ...knownSkips]) {
    const k = key(kn);
    const sigueAbierta = failed.has(k) || skippedNow.has(k);
    const meta = /** @type {{securityRelevant?: boolean, hallazgo?: string, revisarAntesDe?: string}} */ (kn);
    if (meta.securityRelevant && sigueAbierta) security.push(`${meta.hallazgo || 'sin-hallazgo'} · ${k}`);
    if (meta.revisarAntesDe && meta.revisarAntesDe < today && sigueAbierta) {
      overdue.push(`${k} (revisar antes de ${meta.revisarAntesDe})`);
    }
  }
  if (security.length) {
    lines.push(`[${suite}] ⚠️  Fallas conocidas de SEGURIDAD abiertas (${security.length}):\n  - ${security.join('\n  - ')}`);
  }
  if (overdue.length) {
    lines.push(`[${suite}] ⏰ Fallas/skips conocidos con revisión VENCIDA (${overdue.length}):\n  - ${overdue.join('\n  - ')}`);
  }
  return { ok: !bad, lines, security, overdue };
}

/**
 * Resumen markdown para $GITHUB_STEP_SUMMARY.
 * @param {string} suite
 * @param {{ok: boolean, lines: string[], security: string[], overdue: string[]}} r
 */
export function summaryMarkdown(suite, r) {
  const out = [`### Gate de fallas conocidas · ${suite}: ${r.ok ? '✅ OK' : '❌ FALLA'}`, '', '```', ...r.lines, '```'];
  if (r.security.length) {
    out.push('', `**⚠️ ${r.security.length} falla(s) conocida(s) de seguridad abierta(s):**`, ...r.security.map((x) => `- ${x}`));
  }
  return out.join('\n') + '\n';
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const todayArg = args.find((a) => a.startsWith('--today='));
  const [suite, reportPath] = args.filter((a) => !a.startsWith('--'));
  if (!suite || !reportPath) {
    console.error('Uso: check-known-failures.mjs <suite> <reporte.json>');
    process.exit(2);
  }
  const known = JSON.parse(readFileSync(new URL('../../tests/known-failures.json', import.meta.url), 'utf8'));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const r = evaluate(known, suite, report, { today: todayArg ? todayArg.split('=')[1] : undefined });
  for (const l of r.lines) (r.ok ? console.log : console.error)(l);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(suite, r));
    } catch (_e) {
      // El resumen es informativo; nunca cambia el resultado del gate.
    }
  }
  process.exit(r.ok ? 0 : 1);
}
