// Compara métricas actuales vs el baseline oficial de E0.
// Uso en E6 (post code-splitting): correr `lighthouse-baseline.js` +
// `trace-map.js` con BASELINE_TAG=post-e6, después este script para el diff.
//
// Assertion: si LCP shell no mejora >=40% vs baseline, exit 1 (gate fail).
// Sirve como último gate en el checklist final de E6.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OUTPUT_DIR, BASELINE_DATE } from './config.js';

const BASELINE_TAG = process.env.BASELINE_TAG || BASELINE_DATE;
const CURRENT_TAG = process.env.CURRENT_TAG || 'post-e6';

function loadReport(scenario, tag) {
  const p = join(OUTPUT_DIR, `baseline-${scenario}-${tag}.json`);
  if (!existsSync(p)) {
    throw new Error(`No existe reporte ${p}. Correr lighthouse-baseline.js/trace-map.js con BASELINE_TAG=${tag} primero.`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function deltaPct(before, after) {
  if (before === 0) return after === 0 ? 0 : Infinity;
  return ((after - before) / before) * 100;
}

function fmtMs(v) { return `${Math.round(v)}ms`; }
function fmtKb(v) { return `${(v / 1024).toFixed(0)} KB`; }
function fmtDelta(pct) {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

const shellBefore = loadReport('shell', BASELINE_TAG);
const shellAfter = loadReport('shell', CURRENT_TAG);
const mapBefore = loadReport('map', BASELINE_TAG);
const mapAfter = loadReport('map', CURRENT_TAG);

console.log(`\n=== SHELL METRICS ===`);
console.log(`                    ${BASELINE_TAG.padEnd(15)} ${CURRENT_TAG.padEnd(15)} DELTA`);
const shellMetrics = [
  ['LCP', shellBefore.metrics.lcp.median, shellAfter.metrics.lcp.median, fmtMs],
  ['FCP', shellBefore.metrics.fcp.median, shellAfter.metrics.fcp.median, fmtMs],
  ['TTI', shellBefore.metrics.tti.median, shellAfter.metrics.tti.median, fmtMs],
  ['TBT', shellBefore.metrics.tbt.median, shellAfter.metrics.tbt.median, fmtMs],
  ['Transfer', shellBefore.metrics.transferSize.median, shellAfter.metrics.transferSize.median, fmtKb],
  ['Score', shellBefore.metrics.performanceScore.median, shellAfter.metrics.performanceScore.median, v => v.toFixed(0)],
];
for (const [name, b, a, fmt] of shellMetrics) {
  const d = deltaPct(b, a);
  console.log(`  ${name.padEnd(18)} ${fmt(b).padEnd(15)} ${fmt(a).padEnd(15)} ${fmtDelta(d)}`);
}

console.log(`\n=== MAP METRICS ===`);
console.log(`                    ${BASELINE_TAG.padEnd(15)} ${CURRENT_TAG.padEnd(15)} DELTA`);
const mapMetrics = [
  ['Map paint', mapBefore.mapPaint.median, mapAfter.mapPaint.median, fmtMs],
  ['Worst frame', mapBefore.panZoomWorstFrame.median, mapAfter.panZoomWorstFrame.median, fmtMs],
  ['LT >200ms', mapBefore.longTasksOver200msMedian, mapAfter.longTasksOver200msMedian, v => `${v}`],
  ['LT >500ms', mapBefore.longTasksOver500msMedian, mapAfter.longTasksOver500msMedian, v => `${v}`],
];
for (const [name, b, a, fmt] of mapMetrics) {
  const d = deltaPct(b, a);
  console.log(`  ${name.padEnd(18)} ${fmt(b).padEnd(15)} ${fmt(a).padEnd(15)} ${fmtDelta(d)}`);
}

// Assertion final: LCP shell >=40% mejor
const lcpDelta = deltaPct(shellBefore.metrics.lcp.median, shellAfter.metrics.lcp.median);
console.log('');
if (lcpDelta > -40) {
  console.error(`❌ GATE FAIL: LCP shell mejoró solo ${fmtDelta(lcpDelta)} (target ≥40% reducción).`);
  process.exit(1);
}
console.log(`✓ GATE OK: LCP shell mejoró ${fmtDelta(lcpDelta)} (target ≥40% reducción).`);
