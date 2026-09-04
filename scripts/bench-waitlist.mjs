#!/usr/bin/env node
/**
 * bench-waitlist.mjs — perf harness para el modal Pedido en Espera (v803+).
 *
 * v803 iter 1 del Loop Engineering: crea baseline reproducible para medir
 * regresiones y verificar que iter 6 (memoization de getStockPorCliente) da
 * la mejora esperada (-60% en repeat calls).
 *
 * Alcance actual (Fase 1 iter 1):
 *   - getStockPorCliente (pure fn en src/pure/stock-realmente-disponible.js).
 *     Import directo, sin DOM.
 *
 * Alcance pendiente (jsdom required, documentado como TODO):
 *   - _renderWaitlistCard (index.html:16129, ~1.664 líneas).
 *   - _renderClienteAllOpenLines (index.html:15196+).
 *
 * Uso:
 *   node scripts/bench-waitlist.mjs
 *   node scripts/bench-waitlist.mjs --runs=10
 *   node scripts/bench-waitlist.mjs --iterations=5000
 *
 * Output:
 *   Prints table con median/p95/max por función.
 *   Sobreescribe perf-baseline.md con los números.
 *
 * Exit codes:
 *   0 = ejecutó OK.
 *   1 = alguna fn tardó >10s en total (algo raro pasa).
 *
 * Dataset fixture:
 *   - 500 pedidos-app sintéticos.
 *   - 200 SKUs distintos.
 *   - 30 clientes distintos (~17 pedidos/cliente).
 *   - Mix de states: 40% confirmed, 30% BO, 15% ASIG, 10% invoiced, 5% cancelled.
 *   - Cada pedido con 5-20 líneas.
 *   - Coherente con el escenario real "cliente con 50+ SKUs, 500 pedidos historial".
 */

import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getStockPorCliente, getStockRealmenteDisponible } from '../src/pure/stock-realmente-disponible.js';

// ============================================================
// CLI args
// ============================================================
const args = process.argv.slice(2);
const argOf = (name, defaultVal) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : defaultVal;
};
const RUNS = argOf('runs', 5);
const ITERATIONS = argOf('iterations', 1000);

// ============================================================
// Fixture: dataset sintético reproducible
// ============================================================
function seedRandom(seed) {
  // xorshift32 para determinismo
  let s = seed | 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function buildFixture(seed = 42) {
  const rand = seedRandom(seed);
  const N_PEDIDOS = 500;
  const N_SKUS = 200;
  const N_CLIENTES = 30;
  const STATES = [
    { s: 'confirmed', p: 0.4 },
    { s: 'BO', p: 0.3 },
    { s: 'ASIG', p: 0.15 },
    { s: 'invoiced', p: 0.10 },
    { s: 'cancelled', p: 0.05 },
  ];
  const skus = Array.from({ length: N_SKUS }, (_, i) => `SKU${String(i).padStart(4, '0')}`);
  const clientes = Array.from({ length: N_CLIENTES }, (_, i) => `C20${String(1000000 + i).padStart(11, '0')}`);
  const stockFisico = {};
  for (const sku of skus) stockFisico[sku] = Math.floor(rand() * 100);

  const pickState = () => {
    const r = rand();
    let acc = 0;
    for (const st of STATES) { acc += st.p; if (r < acc) return st.s; }
    return 'confirmed';
  };

  const pedidos = [];
  for (let i = 0; i < N_PEDIDOS; i++) {
    const nLines = 5 + Math.floor(rand() * 16); // 5-20 lineas
    const clientIdx = Math.floor(rand() * N_CLIENTES);
    const closed = rand() < 0.15; // 15% ya cerrados
    const lines = [];
    for (let j = 0; j < nLines; j++) {
      const skuIdx = Math.floor(rand() * N_SKUS);
      const qty = 1 + Math.floor(rand() * 20);
      const state = pickState();
      const qtyOpen = state === 'invoiced' || state === 'cancelled' ? 0 : qty;
      lines.push({
        code: skus[skuIdx],
        qty,
        qtyOpen,
        state,
      });
    }
    pedidos.push({
      _fsId: `PED_${i}`,
      clientCardCode: clientes[clientIdx],
      closedAt: closed ? new Date().toISOString() : null,
      lines,
    });
  }

  return { pedidos, skus, clientes, stockFisico };
}

// ============================================================
// Helpers de medición
// ============================================================
function bench(label, fn) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    total_ms: Number(sum.toFixed(2)),
    mean_ms: Number((sum / sorted.length).toFixed(4)),
    median_ms: Number(percentile(sorted, 50).toFixed(4)),
    p95_ms: Number(percentile(sorted, 95).toFixed(4)),
    max_ms: Number(sorted[sorted.length - 1].toFixed(4)),
  };
}

// ============================================================
// Benchmarks
// ============================================================
function runGetStockPorCliente(fixture) {
  const { pedidos, skus, clientes, stockFisico } = fixture;
  const deps = {
    getStockFisico: (sku) => stockFisico[sku] || 0,
    pedidos,
  };
  const samples = [];
  const call = () => {
    for (let k = 0; k < ITERATIONS; k++) {
      const sku = skus[k % skus.length];
      const cc = clientes[k % clientes.length];
      getStockPorCliente(sku, cc, deps);
    }
  };
  for (let r = 0; r < RUNS; r++) {
    samples.push(bench('getStockPorCliente', call));
  }
  return stats(samples);
}

function runGetStockPorClienteRepeat(fixture) {
  // Escenario repeat: mismo (sku, cardCode) N veces. Es el que iter 6
  // memoization va a acelerar. Baseline = sin cache.
  const { pedidos, skus, clientes, stockFisico } = fixture;
  const deps = {
    getStockFisico: (sku) => stockFisico[sku] || 0,
    pedidos,
  };
  const sku = skus[0];
  const cc = clientes[0];
  const samples = [];
  const call = () => {
    for (let k = 0; k < ITERATIONS; k++) {
      getStockPorCliente(sku, cc, deps);
    }
  };
  for (let r = 0; r < RUNS; r++) {
    samples.push(bench('getStockPorClienteRepeat', call));
  }
  return stats(samples);
}

function runGetStockRealmenteDisponible(fixture) {
  const { pedidos, skus, stockFisico } = fixture;
  const deps = {
    getStockFisico: (sku) => stockFisico[sku] || 0,
    pedidos,
  };
  const samples = [];
  const call = () => {
    for (let k = 0; k < ITERATIONS; k++) {
      const sku = skus[k % skus.length];
      getStockRealmenteDisponible(sku, deps);
    }
  };
  for (let r = 0; r < RUNS; r++) {
    samples.push(bench('getStockRealmenteDisponible', call));
  }
  return stats(samples);
}

// ============================================================
// Main
// ============================================================
function main() {
  const startedAt = new Date().toISOString();
  const globalT0 = performance.now();

  console.log(`bench-waitlist v1 · runs=${RUNS} iterations=${ITERATIONS}`);
  console.log(`Building fixture...`);
  const fixture = buildFixture();
  console.log(`Fixture: ${fixture.pedidos.length} pedidos, ${fixture.skus.length} SKUs, ${fixture.clientes.length} clientes`);
  console.log('');

  const results = {
    'getStockPorCliente (diverse sku,cc)': runGetStockPorCliente(fixture),
    'getStockPorCliente (repeat same sku,cc)': runGetStockPorClienteRepeat(fixture),
    'getStockRealmenteDisponible (diverse sku)': runGetStockRealmenteDisponible(fixture),
  };

  const totalMs = performance.now() - globalT0;

  // Print console table
  console.log('Bench results (ms per run of N iterations):');
  console.log('');
  const rows = Object.entries(results).map(([name, s]) => ({
    fn: name,
    'n_runs': s.n,
    'median (ms)': s.median_ms,
    'p95 (ms)': s.p95_ms,
    'max (ms)': s.max_ms,
    'mean per iter (µs)': Number((s.mean_ms * 1000 / ITERATIONS).toFixed(2)),
  }));
  console.table(rows);
  console.log('');
  console.log(`Total bench time: ${totalMs.toFixed(0)} ms`);

  // Escribir perf-baseline.md
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = join(dirname(__filename), '..');
  const outPath = join(repoRoot, 'perf-baseline.md');
  const md = renderMarkdown({ startedAt, RUNS, ITERATIONS, fixture, results, totalMs });
  writeFileSync(outPath, md, 'utf-8');
  console.log(`Written: ${outPath}`);

  if (totalMs > 10_000) {
    console.error(`[FAIL] gate: bench debe correr en <10s, tomó ${totalMs.toFixed(0)}ms`);
    process.exit(1);
  }
}

function renderMarkdown({ startedAt, RUNS, ITERATIONS, fixture, results, totalMs }) {
  const commit = process.env.GITHUB_SHA || 'local';
  const rows = Object.entries(results).map(([name, s]) => {
    const meanPerIterUs = (s.mean_ms * 1000 / ITERATIONS).toFixed(2);
    return `| ${name} | ${s.n} | ${s.median_ms} | ${s.p95_ms} | ${s.max_ms} | ${meanPerIterUs} |`;
  }).join('\n');
  return `# perf-baseline.md

Baseline de performance para el flujo Pedido en Espera. Generado por
\`scripts/bench-waitlist.mjs\`.

**Regenerar**: \`node scripts/bench-waitlist.mjs\`

## Última corrida

- **Fecha (UTC)**: ${startedAt}
- **Commit**: \`${commit}\`
- **Runs**: ${RUNS} (median calculado sobre estos)
- **Iteraciones por run**: ${ITERATIONS}
- **Fixture**: ${fixture.pedidos.length} pedidos-app, ${fixture.skus.length} SKUs, ${fixture.clientes.length} clientes
- **Total bench time**: ${totalMs.toFixed(0)} ms (gate <10.000 ms)

## Resultados

| Función | n_runs | median (ms) | p95 (ms) | max (ms) | µs por iter |
|---|---|---|---|---|---|
${rows}

## Interpretación

- **median (ms)**: tiempo mediano por RUN. Cada run hace ${ITERATIONS} calls
  a la función.
- **µs por iter**: costo promedio de UNA sola llamada, útil para dimensionar
  overhead de memoization (iter 6).

## Escenarios

- **diverse sku,cc**: cada iteración usa (sku, cardCode) distintos.
  Peor caso realista: vendedor viendo su cliente + navegando entre SKUs.
- **repeat same sku,cc**: misma (sku, cardCode) N veces. Es el que
  iter 6 memoization va a atacar. Meta post-memoization: ≥60% reducción
  del median.
- **getStockRealmenteDisponible**: fn base, sin discriminación por cliente.
  Referencia de costo mínimo.

## TODO — fuera de scope de iter 1

- Bench de \`_renderWaitlistCard\` (index.html:16129, ~1.664 líneas).
  Requiere jsdom. Estimado 2h.
- Bench de \`_renderClienteAllOpenLines\` (index.html:15196+).
  Requiere jsdom.
- Bench del initial paint del modal completo (Lighthouse mobile 4G).

## Historial

_Bumpear versión al pie después de cada corrida documentada oficial_

- v803 (${startedAt.slice(0, 10)}): baseline inicial. Ver tabla arriba.
`;
}

main();
