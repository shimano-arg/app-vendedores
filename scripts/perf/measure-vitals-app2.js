#!/usr/bin/env node

/*
 * measure-vitals-app2.js — mide Core Web Vitals del frontend-new (/app2/*).
 *
 * Prerequisito:
 *   cd frontend-new && npm run build && npm run preview &
 *
 * Luego desde el root:
 *   node scripts/perf/measure-vitals-app2.js [--url http://127.0.0.1:4173/app2/stock]
 *
 * Output:
 *   Desktop/FORECAST/.../NO — va a stdout + guarda JSON en scripts/perf/vitals-app2-<ts>.json
 *   para que lighthouse-ci u otros consumers lo levanten en CI.
 *
 * Patrones aplicados (CLAUDE.md):
 *   §9  fileURLToPath (no URL.pathname.slice(1)) para derivar paths.
 *   §10 dispatch events desde page.evaluate bajo throttling (no page.mouse.wheel).
 *   §11 tolerante a fallos: 3 corridas, si al menos 2 OK computamos median.
 *
 * NO toca el frontend legacy — este script es exclusivo de /app2/.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIR = dirname(fileURLToPath(import.meta.url));

// Default URL — override con --url=.
const defaultUrl = 'http://127.0.0.1:4173/app2/stock';
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...rest] = a.replace(/^--/, '').split('=');
      return [k, rest.join('=') || 'true'];
    })
);
const url = args.url || defaultUrl;
const runs = Number(args.runs || 3);
const minOk = Number(args['min-ok'] || 2);

// ADR-015: throttle Moto G Power ~ 4x CPU + 4G lento.
// Valores empiricos consistentes con scripts/perf/trace-map.js del legacy.
const CPU_THROTTLE = 4;
const NETWORK = {
  // ~Fast 3G en los presets Chrome DevTools, ajustado a 4G argentino conservador.
  offline: false,
  downloadThroughput: (1.5 * 1024 * 1024) / 8, // 1.5 Mbps
  uploadThroughput: (750 * 1024) / 8, // 750 kbps
  latency: 150, // ms
};

async function runOnce(iteration) {
  // Import dinamico para que el script arranque rapido incluso si puppeteer no esta.
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch (err) {
    console.error(
      '[measure-vitals-app2] puppeteer no esta instalado. Instalalo con:\n' +
        '  npm install --no-save puppeteer\n' +
        'o corre desde frontend-new/ donde las devDeps ya lo pueden incluir.'
    );
    throw err;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 851, deviceScaleFactor: 2, isMobile: true });

  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', NETWORK);
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  // `src/lib/vitals.ts` (v1479+) escribe window.__CWV__ con {lcp, inp, cls, route}.
  // Leemos despues del load + interaction via page.evaluate.
  const metrics = {};

  const startedAt = Date.now();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });

  // Espera inicial para que React monte + initVitals corra post hydration.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // INP necesita interaccion para medirse — simulamos tap breve.
  // Usamos page.evaluate (CLAUDE.md §10) en vez de page.mouse.click para evitar
  // timeouts del CDP command bajo throttling.
  // IMPORTANTE: dispatch sobre body/div para evitar navegacion si el target es <a>.
  try {
    await page.evaluate(() => {
      const target = document.body;
      if (!target) return;
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
  } catch (err) {
    console.warn(`[run ${iteration}] interaccion fallo:`, err?.message || err);
  }

  // Esperamos 2s mas para que INP + CLS post-interaction se emitan.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Leemos snapshot de vitals desde window.__CWV__ (patron ADR-015).
  let cwv = null;
  try {
    cwv = await page.evaluate('window.__CWV__ || null');
  } catch (err) {
    console.warn(`[run ${iteration}] lectura __CWV__ fallo:`, err?.message || err);
  }
  if (cwv && typeof cwv === 'object') {
    if (typeof cwv.lcp === 'number')
      metrics.LCP = {
        value: cwv.lcp,
        rating: cwv.lcp <= 2500 ? 'good' : cwv.lcp <= 4000 ? 'needs-improvement' : 'poor',
      };
    if (typeof cwv.inp === 'number')
      metrics.INP = {
        value: cwv.inp,
        rating: cwv.inp <= 200 ? 'good' : cwv.inp <= 500 ? 'needs-improvement' : 'poor',
      };
    if (typeof cwv.cls === 'number')
      metrics.CLS = {
        value: cwv.cls,
        rating: cwv.cls <= 0.1 ? 'good' : cwv.cls <= 0.25 ? 'needs-improvement' : 'poor',
      };
  }

  await browser.close();
  const elapsedMs = Date.now() - startedAt;

  return { iteration, elapsedMs, metrics };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

async function main() {
  console.log(`[measure-vitals-app2] url=${url} runs=${runs} throttle=${CPU_THROTTLE}x`);
  const results = [];
  const failed = [];
  for (let i = 1; i <= runs; i++) {
    try {
      console.log(`[run ${i}/${runs}] starting...`);
      const r = await runOnce(i);
      console.log(`[run ${i}] metrics:`, r.metrics);
      results.push(r);
    } catch (err) {
      console.error(`[run ${i}] fallo:`, err?.message || err);
      failed.push({ iteration: i, error: err?.message || String(err) });
    }
  }

  if (results.length < minOk) {
    console.error(
      `[measure-vitals-app2] solo ${results.length}/${runs} corridas exitosas (min: ${minOk}). Abortando.`
    );
    process.exit(1);
  }

  // Agrega median por metrica — ADR-015 targets.
  const metricNames = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
  const summary = {};
  for (const name of metricNames) {
    const values = results.map((r) => r.metrics[name]?.value).filter((v) => typeof v === 'number');
    if (values.length > 0) {
      summary[name] = {
        median: median(values),
        values,
        rating: results[0]?.metrics[name]?.rating || 'unknown',
      };
    }
  }

  const output = {
    url,
    runs: results.length,
    failedRuns: failed.length,
    failed,
    results,
    summary,
    targets: { LCP: 2500, INP: 200, CLS: 0.1 },
    timestamp: new Date().toISOString(),
  };

  console.log('\n[measure-vitals-app2] summary:');
  console.log(JSON.stringify(summary, null, 2));

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(OUTPUT_DIR, `vitals-app2-${ts}.json`);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[measure-vitals-app2] JSON escrito a ${outPath}`);

  // Exit 1 si algun target duro se supero por la median (LCP / INP / CLS).
  const LCP_OK = !summary.LCP || summary.LCP.median <= 2500;
  const INP_OK = !summary.INP || summary.INP.median <= 200;
  const CLS_OK = !summary.CLS || summary.CLS.median <= 0.1;
  if (!LCP_OK || !INP_OK || !CLS_OK) {
    console.error(
      `[measure-vitals-app2] targets excedidos — LCP_OK=${LCP_OK} INP_OK=${INP_OK} CLS_OK=${CLS_OK}`
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[measure-vitals-app2] fatal:', err);
  process.exit(1);
});
