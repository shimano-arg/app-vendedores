// Mide el SHELL de la app con Lighthouse programático. Escenario:
// "carga inicial hasta LCP" = usuario abre la URL, ve el splash + login
// screen. No incluye login real (Lighthouse no puede automatizar OAuth).
//
// Corre RUNS_PER_SCENARIO (3) veces y reporta la MEDIANA + variance.
// Emite `scripts/perf/baseline-shell-<fecha>.json` con métricas + long tasks.
//
// Uso:
//   1. En otra consola: `python -m http.server 8000` desde el repo root.
//   2. `node scripts/perf/lighthouse-baseline.js`
//
// Env vars:
//   CHROME_PATH  override auto-detect (opcional)
//   BASELINE_TAG "post-e0" o "post-e6" para distinguir corridas (default: iso date)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import {
  BASELINE_DATE,
  findChrome,
  LOCAL_URL,
  OUTPUT_DIR,
  RUNS_PER_SCENARIO,
  THROTTLING,
} from './config.js';

const TAG = process.env.BASELINE_TAG || BASELINE_DATE;

async function runOne(url, chromePath) {
  const chrome = await chromeLauncher.launch({
    chromePath,
    chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox'],
  });

  const result = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance'],
    formFactor: 'mobile',
    screenEmulation: {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
      disabled: false,
    },
    throttling: THROTTLING,
    throttlingMethod: 'simulate',
  });

  // chrome-launcher en Windows tiene race condition: kill() retorna antes
  // que Chrome libere los archivos del temp dir → EPERM al borrar. try/catch
  // + delay antes de volver a spawnar otro Chrome en la próxima corrida.
  try {
    await chrome.kill();
  } catch (_e) {
    /* ignore EPERM Windows race */
  }
  await new Promise((r) => setTimeout(r, 3000));

  const lhr = result.lhr;
  return {
    lcp: lhr.audits['largest-contentful-paint'].numericValue,
    fcp: lhr.audits['first-contentful-paint'].numericValue,
    tti: lhr.audits.interactive.numericValue,
    tbt: lhr.audits['total-blocking-time'].numericValue,
    cls: lhr.audits['cumulative-layout-shift'].numericValue,
    transferSize: lhr.audits['total-byte-weight'].numericValue,
    performanceScore: lhr.categories.performance.score,
    longTasks: (lhr.audits['long-tasks']?.details?.items || []).map((t) => ({
      url: t.url,
      startTime: t.startTime,
      duration: t.duration,
    })),
    mainThreadWork: (lhr.audits['mainthread-work-breakdown']?.details?.items || []).map((t) => ({
      group: t.group,
      duration: t.duration,
    })),
    bootupTime: (lhr.audits['bootup-time']?.details?.items || []).slice(0, 10).map((t) => ({
      url: t.url,
      total: t.total,
      scripting: t.scripting,
    })),
  };
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stats(arr) {
  return {
    median: median(arr),
    min: Math.min(...arr),
    max: Math.max(...arr),
  };
}

async function main() {
  const chromePath = findChrome();
  console.log('[lighthouse] Chrome:', chromePath);
  console.log('[lighthouse] URL:', LOCAL_URL);
  console.log('[lighthouse] Runs:', RUNS_PER_SCENARIO);
  console.log('[lighthouse] Tag:', TAG);

  const runs = [];
  for (let i = 0; i < RUNS_PER_SCENARIO; i++) {
    console.log(`[lighthouse] Corrida ${i + 1}/${RUNS_PER_SCENARIO}...`);
    const t0 = Date.now();
    try {
      const r = await runOne(LOCAL_URL, chromePath);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `  → LCP=${Math.round(r.lcp)}ms  FCP=${Math.round(r.fcp)}ms  TBT=${Math.round(r.tbt)}ms  score=${(r.performanceScore * 100).toFixed(0)}  (${dt}s)`
      );
      runs.push(r);
    } catch (err) {
      console.error(`  ✗ Corrida ${i + 1} falló:`, err.message);
      throw err;
    }
  }

  const output = {
    tag: TAG,
    url: LOCAL_URL,
    runs,
    metrics: {
      lcp: stats(runs.map((r) => r.lcp)),
      fcp: stats(runs.map((r) => r.fcp)),
      tti: stats(runs.map((r) => r.tti)),
      tbt: stats(runs.map((r) => r.tbt)),
      cls: stats(runs.map((r) => r.cls)),
      transferSize: stats(runs.map((r) => r.transferSize)),
      performanceScore: stats(runs.map((r) => r.performanceScore * 100)),
    },
    // Long tasks / mainthread / bootup del primer run (representativos).
    longTasksSample: runs[0].longTasks,
    mainThreadWorkSample: runs[0].mainThreadWork,
    bootupTimeSample: runs[0].bootupTime,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, `baseline-shell-${TAG}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[lighthouse] Reporte: ${outPath}`);
  console.log(
    `[lighthouse] Median LCP: ${Math.round(output.metrics.lcp.median)}ms (min=${Math.round(output.metrics.lcp.min)}, max=${Math.round(output.metrics.lcp.max)})`
  );
  console.log(`[lighthouse] Median TBT: ${Math.round(output.metrics.tbt.median)}ms`);
  console.log(
    `[lighthouse] Median transfer: ${(output.metrics.transferSize.median / 1024).toFixed(0)} KB`
  );
  console.log(
    `[lighthouse] Median score: ${output.metrics.performanceScore.median.toFixed(0)}/100`
  );
  console.log(
    `[lighthouse] Long tasks >500ms (primer run): ${runs[0].longTasks.filter((t) => t.duration > 500).length}`
  );
}

main().catch((err) => {
  console.error('[lighthouse] FAIL:', err.stack || err.message || err);
  process.exit(1);
});
