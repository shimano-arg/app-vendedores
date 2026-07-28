// Trace del mapa con Puppeteer + Chrome DevTools Protocol.
// Escenarios medidos:
//   (a) primer paint del mapa post-login: tiempo desde navigate hasta "outlines cache built"
//   (b) 3 pan+zoom consecutivos: long tasks > 200ms, breakdown main thread
//
// PROBLEMA con OAuth: Google detecta Puppeteer y bloquea el login OAuth
// (navigator.webdriver = true). Solución: conectar a Chrome REAL del user via
// debug port. El user tiene el control del OAuth, script solo mide.
//
// FLOW DE USO:
//   1. Cerrar todas las ventanas de Chrome normales.
//   2. Launchar Chrome desde PowerShell con debug port:
//      & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
//        --remote-debugging-port=9222 `
//        --user-data-dir="C:\temp\perf-chrome"
//   3. En ese Chrome, navegar a http://localhost:8000/
//   4. Loggearse normal con Google (OAuth funciona porque es Chrome real).
//   5. Cuando ves el mapa de Argentina, correr: node scripts/perf/trace-map.js
//   6. El script conecta al puerto 9222 y ejecuta los escenarios en el tab
//      loggeado. Chrome queda abierto (no lo cierra el script).
//
// Env vars:
//   DEBUG_PORT   default 9222
//   BASELINE_TAG "post-e0" (default: iso date)

import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_URL, THROTTLING, RUNS_PER_SCENARIO, OUTPUT_DIR, BASELINE_DATE } from './config.js';

const TAG = process.env.BASELINE_TAG || BASELINE_DATE;
const DEBUG_PORT = parseInt(process.env.DEBUG_PORT || '9222', 10);
const DEBUG_URL = `http://localhost:${DEBUG_PORT}`;

async function ensureLoggedIn(page) {
  // Polling: la app tarda unos segundos post-reload en esconder el auth
  // overlay. También el mapa Leaflet aparece como .leaflet-container adentro
  // de #map — ese es el signal fiable de "mapa listo".
  const TIMEOUT = 30_000;
  const started = Date.now();
  let lastState;
  while (Date.now() - started < TIMEOUT) {
    try {
      lastState = await page.evaluate(() => {
        const mapEl = document.querySelector('#map');
        const leaflet = document.querySelector('.leaflet-container');
        const authOverlay = document.querySelector('.auth-overlay');
        const authVisible = authOverlay
          ? !authOverlay.classList.contains('hidden') && getComputedStyle(authOverlay).display !== 'none' && getComputedStyle(authOverlay).visibility !== 'hidden'
          : false;
        return {
          hasMap: !!mapEl,
          hasLeaflet: !!leaflet,
          authVisible,
          url: window.location.href,
        };
      });
      if (lastState.hasLeaflet && !lastState.authVisible) {
        console.log('[trace] Tab loggeado ✓ (Leaflet listo, sin auth overlay)');
        return;
      }
    } catch (_) { /* frame invalidated, retry */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Tab no llegó a estado loggeado en ${TIMEOUT / 1000}s. Último estado: ${JSON.stringify(lastState)}. Loggeate en el Chrome del debug port y refrescá el tab de localhost:8000.`);
}

async function measureMapPaint(page) {
  console.log('[trace] Escenario (a): map paint inicial...');
  // Recargar para medir con cache-hit (representativo de "abrir la app 2da vez")
  const t0 = Date.now();
  const outlinesReady = new Promise(res => {
    const handler = msg => {
      if (msg.text().includes('[outlines] cache built')) {
        page.off('console', handler);
        res(Date.now() - t0);
      }
    };
    page.on('console', handler);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const ms = await Promise.race([
    outlinesReady,
    new Promise((_, rej) => setTimeout(() => rej(new Error('outlines timeout 30s')), 30_000)),
  ]);
  console.log(`  → outlines ready in ${ms}ms`);
  return ms;
}

async function tracePanZoom(page, client) {
  console.log('[trace] Escenario (b): 3 pan+zoom con tracing...');

  // Iniciar tracing CDP con categorías de rendering + long tasks.
  await client.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-v8.cpu_profiler',
    options: 'sampling-frequency=10000',
  });

  const tCollect = new Promise(res => {
    const chunks = [];
    client.on('Tracing.dataCollected', ev => chunks.push(...ev.value));
    client.on('Tracing.tracingComplete', () => res(chunks));
  });

  // Dispatch eventos DENTRO del browser via evaluate — evita CDP roundtrip
  // que timeoutea con throttling activo. Cada iteración: mousedown+mousemove+
  // mouseup (pan) + wheel (zoom). Waits entre iteraciones para que Leaflet
  // procese completamente cada acción.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const el = document.querySelector('#map');
      if (!el) throw new Error('#map no encontrado');
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const mk = (type, x, y, extras = {}) => new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0, buttons: 1, ...extras,
      });
      // Pan drag
      el.dispatchEvent(mk('mousedown', cx, cy));
      for (let s = 1; s <= 10; s++) {
        el.dispatchEvent(mk('mousemove', cx - (100 * s / 10), cy - (100 * s / 10)));
      }
      el.dispatchEvent(mk('mouseup', cx - 100, cy - 100));
      // Zoom wheel
      const wheel = new WheelEvent('wheel', {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy, deltaY: -100, deltaMode: 0,
      });
      el.dispatchEvent(wheel);
    });
    await new Promise(r => setTimeout(r, 1500));
  }

  await client.send('Tracing.end');
  const events = await tCollect;
  console.log(`  → trace ${events.length} eventos`);

  // Analizar long tasks (>50ms) y worst frame time.
  const longTasks = [];
  let worstFrame = 0;
  for (const ev of events) {
    if (ev.name === 'RunTask' && ev.dur && ev.dur / 1000 > 50) {
      longTasks.push({ name: ev.name, dur: ev.dur / 1000 });
    }
    if (ev.name === 'DrawFrame' && ev.dur && ev.dur / 1000 > worstFrame) {
      worstFrame = ev.dur / 1000;
    }
  }
  return {
    totalEvents: events.length,
    longTasks: longTasks.sort((a, b) => b.dur - a.dur).slice(0, 20),
    longTasksOver200ms: longTasks.filter(t => t.dur > 200).length,
    longTasksOver500ms: longTasks.filter(t => t.dur > 500).length,
    worstFrameMs: worstFrame,
  };
}

async function findLocalhostTab(browser) {
  // Busca el tab que tiene abierta la app en localhost:8000.
  // Match laxo: cualquier URL con "localhost:8000" o "[::1]:8000" o "127.0.0.1:8000".
  const pages = await browser.pages();
  const allUrls = pages.map(p => p.url());
  const isLocal = (u) => /(?:localhost|127\.0\.0\.1|\[::1\]):8000/.test(u);
  for (const p of pages) {
    if (isLocal(p.url())) return p;
  }
  throw new Error(
    `No hay ningún tab que matchee "localhost:8000" en el Chrome del debug port.\n` +
    `Tabs abiertos actualmente:\n  ${allUrls.map(u => '- ' + u).join('\n  ')}\n` +
    `Abrí la app en el Chrome que launcheaste con --remote-debugging-port=${DEBUG_PORT}.`
  );
}

async function runOne(browser) {
  const page = await findLocalhostTab(browser);
  const client = await page.target().createCDPSession();

  // Aplicar throttling CPU + network via CDP.
  await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLING.cpuSlowdownMultiplier });
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: THROTTLING.rttMs,
    downloadThroughput: (THROTTLING.downloadThroughputKbps * 1024) / 8,
    uploadThroughput: (THROTTLING.uploadThroughputKbps * 1024) / 8,
  });

  await ensureLoggedIn(page);

  const mapPaintMs = await measureMapPaint(page);
  const panZoom = await tracePanZoom(page, client);

  // Restaurar throttling normal para no dejar el tab lento después del script.
  try {
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
  } catch (_) {}

  return { mapPaintMs, panZoom };
}

async function main() {
  console.log('[trace] Debug URL:', DEBUG_URL);
  console.log('[trace] URL local:', LOCAL_URL);
  console.log('[trace] Runs:', RUNS_PER_SCENARIO);
  console.log('[trace] Tag:', TAG);

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: DEBUG_URL,
      defaultViewport: null,
      // Con CPU 4x + Slow 4G, cada CDP call puede tardar >30s. Subimos el
      // protocolTimeout default para que Input.dispatchMouseEvent no timeoutee.
      protocolTimeout: 120_000,
    });
  } catch (err) {
    throw new Error(
      `No pude conectar a ${DEBUG_URL}. Chequear que Chrome esté abierto con --remote-debugging-port=${DEBUG_PORT}.\n` +
      `Original: ${err.message}`
    );
  }
  console.log('[trace] Conectado a Chrome ✓');

  const runs = [];
  const failures = [];
  try {
    for (let i = 0; i < RUNS_PER_SCENARIO; i++) {
      console.log(`\n[trace] Corrida ${i + 1}/${RUNS_PER_SCENARIO}`);
      try {
        const r = await runOne(browser);
        runs.push(r);
      } catch (err) {
        console.error(`  ✗ Corrida ${i + 1} falló: ${err.message}`);
        failures.push({ run: i + 1, error: err.message });
      }
    }
  } finally {
    await browser.disconnect();
  }

  if (runs.length < 2) {
    console.error(`\n[trace] Solo ${runs.length}/${RUNS_PER_SCENARIO} corridas exitosas — insuficiente para baseline.`);
    console.error(`[trace] Fallos:`, failures);
    process.exit(1);
  }
  if (runs.length < RUNS_PER_SCENARIO) {
    console.warn(`\n[trace] ⚠️  ${runs.length}/${RUNS_PER_SCENARIO} corridas OK (variance elegida sobre las OK).`);
  }

  const mapPaintTimes = runs.map(r => r.mapPaintMs);
  const worstFrames = runs.map(r => r.panZoom.worstFrameMs);
  const median = arr => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const output = {
    tag: TAG,
    url: LOCAL_URL,
    runsCompleted: runs.length,
    runsExpected: RUNS_PER_SCENARIO,
    failures,
    runs,
    mapPaint: {
      median: median(mapPaintTimes),
      min: Math.min(...mapPaintTimes),
      max: Math.max(...mapPaintTimes),
      all: mapPaintTimes,
    },
    panZoomWorstFrame: {
      median: median(worstFrames),
      min: Math.min(...worstFrames),
      max: Math.max(...worstFrames),
      all: worstFrames,
    },
    longTasksOver200msMedian: median(runs.map(r => r.panZoom.longTasksOver200ms)),
    longTasksOver500msMedian: median(runs.map(r => r.panZoom.longTasksOver500ms)),
    longTasksSample: runs[0].panZoom.longTasks,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, `baseline-map-${TAG}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[trace] Reporte: ${outPath}`);
  console.log(`[trace] Median map paint: ${output.mapPaint.median}ms`);
  console.log(`[trace] Median worst frame durante pan/zoom: ${output.panZoomWorstFrame.median.toFixed(0)}ms`);
  console.log(`[trace] Median long tasks >200ms durante pan/zoom: ${output.longTasksOver200msMedian}`);
  console.log(`[trace] Median long tasks >500ms durante pan/zoom: ${output.longTasksOver500msMedian}`);
}

main().catch(err => {
  console.error('[trace] FAIL:', err.stack || err.message || err);
  process.exit(1);
});
