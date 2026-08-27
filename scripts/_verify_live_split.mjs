// Verificacion end-to-end del bundle DEPLOYEADO en GH Pages.
// Fetchea app.bundle.js live, lo evalua en VM con window mock, y llama a
// splitPedidoLine con el caso critico 100/70 para verificar que retorna 2
// lineas con el fix aplicado.
//
// Uso: node scripts/_verify_live_split.mjs

import { runInNewContext } from 'node:vm';

const BUNDLE_URL = `https://shimano-arg.github.io/app-vendedores/app.bundle.js?_=${Date.now()}`;
const HTML_URL = `https://shimano-arg.github.io/app-vendedores/index.html?_=${Date.now()}`;

async function main() {
  console.log('[1/4] Fetching live bundle...');
  const bundleRes = await fetch(BUNDLE_URL);
  if (!bundleRes.ok) throw new Error(`Bundle fetch ${bundleRes.status}`);
  const bundleSrc = await bundleRes.text();
  console.log(`      Bundle size: ${(bundleSrc.length / 1024).toFixed(1)} KB`);

  console.log('[2/4] Fetching live HTML for version check...');
  const htmlRes = await fetch(HTML_URL);
  if (!htmlRes.ok) throw new Error(`HTML fetch ${htmlRes.status}`);
  const htmlSrc = await htmlRes.text();
  const versionMatch = htmlSrc.match(/const APP_VERSION = '(v\d+)'/);
  console.log(`      Live APP_VERSION: ${versionMatch ? versionMatch[1] : 'NOT FOUND'}`);
  if (!versionMatch || versionMatch[1] !== 'v600') {
    throw new Error(`Expected v600, got ${versionMatch && versionMatch[1]}`);
  }

  console.log('[3/4] Evaluating bundle in VM context...');
  const ctx = {
    window: {},
    document: { createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    globalThis: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  ctx.globalThis = ctx;
  runInNewContext(bundleSrc, ctx);

  const phase0 = ctx.window.__phase0;
  if (!phase0) throw new Error('window.__phase0 no expuesto');
  if (!phase0.pure) throw new Error('__phase0.pure ausente');
  if (typeof phase0.pure.splitPedidoLine !== 'function') {
    throw new Error('splitPedidoLine NO es function');
  }
  if (typeof phase0.pure.reenrichPedidoLine !== 'function') {
    throw new Error('reenrichPedidoLine NO es function');
  }
  console.log('      __phase0.pure.splitPedidoLine: OK');
  console.log('      __phase0.pure.reenrichPedidoLine: OK');

  console.log('[4/4] Runtime test caso 100/70 con flag ON...');
  const raw = {
    code: 'SKU-TEST',
    desc: 'Producto Test',
    cat: 'CAT',
    fam: 'FAM',
    sub: 'SUB',
    qty: 100,
    precio: 500,
    needsReview: false,
  };
  const lines = phase0.pure.splitPedidoLine(raw, {
    getDisp: () => 70,
    flagEnabled: true,
  });
  console.log(`      Resultado: ${lines.length} lineas`);
  for (const [i, l] of lines.entries()) {
    console.log(
      `        [${i}] qty=${l.qty} qtyOpen=${l.qtyOpen} state=${l.state} code=${l.code}`
    );
  }

  // Assertions
  if (lines.length !== 2) throw new Error(`Expected 2 lines, got ${lines.length}`);
  if (lines[0].qty !== 70 || lines[0].state !== 'confirmed') {
    throw new Error(`Line 0: expected {qty:70, state:'confirmed'}, got {qty:${lines[0].qty}, state:'${lines[0].state}'}`);
  }
  if (lines[1].qty !== 30 || lines[1].state !== 'BO') {
    throw new Error(`Line 1: expected {qty:30, state:'BO'}, got {qty:${lines[1].qty}, state:'${lines[1].state}'}`);
  }

  console.log('');
  console.log('=====================================');
  console.log('  VERIFICACION LIVE OK — v600 en prod');
  console.log('  Caso 100/70 → 70 confirmed + 30 BO');
  console.log('=====================================');

  // Bonus: flag OFF conserva legacy
  const legacyLines = phase0.pure.splitPedidoLine(raw, { getDisp: () => 70, flagEnabled: false });
  if (legacyLines.length !== 1 || legacyLines[0].qty !== 100 || legacyLines[0].state !== 'BO') {
    throw new Error('Flag OFF no respeta legacy behavior');
  }
  console.log('');
  console.log('  Regresion check flag OFF: 1 linea BO qty=100 ✓');
}

main().catch((err) => {
  console.error('');
  console.error('FAIL:', err.message);
  process.exit(1);
});
