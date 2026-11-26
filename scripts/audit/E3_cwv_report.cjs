// Stack CRM S-8 E3 — reporte read-only de Core Web Vitals + commitPedidoCF phase timers.
//
// Lee de dos colecciones (sin writes):
//   - `instrumentation_log` type='client_instrumentation' con events[] (kind='web_vitals', name∈{lcp,inp,cls})
//     Escritos por `src/domains/instrumentation.js` (20% sampling, flush fire-and-forget).
//   - `operations_log` type='commit_phase_timers' con phases{} + totalMs.
//     Escritos por `functions/core/commit-phase-timers.js` (20% sampling por userUid, en CommitpedidoCF).
//
// Imprime tabla ASCII con p50/p95/p99 por metrica + breakdown por pantalla + commit flow.
//
// Autorizado por Mariano (Stack CRM S-8 E3). Solo lectura. Zero behavior change.
//
// Correr:
//   node scripts/audit/E3_cwv_report.cjs
//   node scripts/audit/E3_cwv_report.cjs --days=7
//   node scripts/audit/E3_cwv_report.cjs --days=7 --full

// Resolve firebase-admin desde multiples ubicaciones (este repo no tiene
// node_modules en functions/; reusamos la instalacion del repo principal).
function resolveAdmin() {
  const candidates = [
    '../../functions/node_modules/firebase-admin',
    '../../node_modules/firebase-admin',
    'C:/Users/shimano.sandbox/Desktop/APP VENDEDORES/functions/node_modules/firebase-admin',
    'firebase-admin',
  ];
  let lastErr = null;
  for (const p of candidates) {
    try {
      return require(p);
    } catch (e) {
      lastErr = e;
    }
  }
  console.error('No pude cargar firebase-admin. Probe:');
  for (const p of candidates) console.error('  - ' + p);
  if (lastErr) console.error('Ultimo error: ' + lastErr.message);
  process.exit(2);
}
const admin = resolveAdmin();

const PROJECT = 'app-vendedores-shimano';

function parseArgs() {
  const args = { days: 7, full: false };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--days=')) args.days = Number(a.split('=')[1]) || 7;
    else if (a === '--full') args.full = true;
  }
  return args;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = arr.slice().sort((x, y) => x - y);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmt(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return '    -   ';
  if (unit === 'ms') return String(Math.round(v)).padStart(6) + ' ms';
  if (unit === 'cls') return v.toFixed(3).padStart(8);
  return String(v).padStart(8);
}

function row(label, values, unit) {
  const [count, p50, p95, p99] = values;
  return (
    '  ' +
    label.padEnd(28) +
    String(count).padStart(6) +
    '  ' +
    fmt(p50, unit) +
    '  ' +
    fmt(p95, unit) +
    '  ' +
    fmt(p99, unit)
  );
}

async function main() {
  const args = parseArgs();
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  const cutoff = new Date(Date.now() - args.days * 24 * 3600 * 1000);
  const nowIso = new Date().toISOString();

  console.log('================================================================');
  console.log('Stack S-8 E3 — Core Web Vitals + commit phase timers');
  console.log('Project    : ' + PROJECT);
  console.log('Generado   : ' + nowIso);
  console.log('Ventana    : ultimas ' + args.days + ' dias (desde ' + cutoff.toISOString() + ')');
  console.log('Modo       : ' + (args.full ? 'full (detalle por pantalla)' : 'resumen'));
  console.log('================================================================');

  // --------------------------------------------------------------------
  // 1) CORE WEB VITALS (instrumentation_log)
  // --------------------------------------------------------------------
  console.log('');
  console.log('[1] CORE WEB VITALS — fuente: instrumentation_log');
  console.log('----------------------------------------------------------------');

  // Shape: type='client_instrumentation', events: [{kind, name, value, ts, ...}]
  const cwvQs = await db
    .collection('instrumentation_log')
    .where('timestamp', '>=', cutoff)
    .get();

  const cwvByName = { lcp: [], inp: [], cls: [] };
  let cwvDocsSeen = 0;
  let cwvEventsSeen = 0;
  let cwvNonVitalsEvents = 0;
  const cwvByVersion = {};

  cwvQs.forEach((d) => {
    const data = d.data() || {};
    if (data.type && data.type !== 'client_instrumentation') return;
    cwvDocsSeen += 1;
    const events = Array.isArray(data.events) ? data.events : [];
    for (const e of events) {
      cwvEventsSeen += 1;
      if (!e || e.kind !== 'web_vitals') {
        cwvNonVitalsEvents += 1;
        continue;
      }
      const name = String(e.name || '').toLowerCase();
      const v = Number(e.value);
      if (!(name in cwvByName) || !Number.isFinite(v)) continue;
      cwvByName[name].push(v);
      const cv = String(data.clientVersion || 'unknown');
      if (!cwvByVersion[cv]) cwvByVersion[cv] = 0;
      cwvByVersion[cv] += 1;
    }
  });

  console.log('Docs leidos           : ' + cwvDocsSeen);
  console.log('Eventos totales       : ' + cwvEventsSeen);
  console.log('Eventos web_vitals    : ' + (cwvByName.lcp.length + cwvByName.inp.length + cwvByName.cls.length));
  console.log('Eventos no-vitals     : ' + cwvNonVitalsEvents + '  (cache, timing, otros)');
  console.log('');
  console.log('Distribucion por clientVersion (solo vitals):');
  const vers = Object.keys(cwvByVersion).sort();
  if (!vers.length) console.log('  (sin datos)');
  else for (const v of vers) console.log('  ' + v.padEnd(10) + ' : ' + cwvByVersion[v]);

  console.log('');
  console.log('Metrica                       N       p50       p95       p99');
  console.log('  ' + '-'.repeat(60));
  const metas = {
    lcp: { unit: 'ms', target: '<= 2500 ms' },
    inp: { unit: 'ms', target: '<=  200 ms' },
    cls: { unit: 'cls', target: '<=  0.1' },
  };
  for (const name of ['lcp', 'inp', 'cls']) {
    const arr = cwvByName[name];
    const label = name.toUpperCase() + ' (' + metas[name].target + ')';
    console.log(
      row(label, [arr.length, percentile(arr, 50), percentile(arr, 95), percentile(arr, 99)], metas[name].unit)
    );
  }

  // --------------------------------------------------------------------
  // 2) COMMIT PHASE TIMERS (operations_log)
  // --------------------------------------------------------------------
  console.log('');
  console.log('[2] COMMIT PHASE TIMERS — fuente: operations_log (type=commit_phase_timers)');
  console.log('----------------------------------------------------------------');

  // Nota: query solo por timestamp (evita index compuesto) y filtro
  // type en memoria. Si en el futuro hay volumen grande, crear el
  // index compuesto (type ASC, timestamp ASC) y restaurar la query.
  const phaseQs = await db
    .collection('operations_log')
    .where('timestamp', '>=', cutoff)
    .get();

  const phases = {}; // name -> number[]
  const totals = [];
  const outcomes = {};
  const byOrigen = {};
  const byClientVersion = {};
  const perInvoc = []; // {total, origen, outcome, clientVersion, phases}
  let phaseDocs = 0;

  phaseQs.forEach((d) => {
    const data = d.data() || {};
    if (data.type !== 'commit_phase_timers') return;
    phaseDocs += 1;
    const tot = Number(data.totalMs);
    if (Number.isFinite(tot)) totals.push(tot);
    const outc = String(data.outcome || 'unknown');
    outcomes[outc] = (outcomes[outc] || 0) + 1;
    const or = String(data.origen || 'unknown');
    byOrigen[or] = (byOrigen[or] || 0) + 1;
    const cv = String(data.clientVersion || 'unknown');
    byClientVersion[cv] = (byClientVersion[cv] || 0) + 1;
    const ph = data.phases || {};
    for (const [k, v] of Object.entries(ph)) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      if (!phases[k]) phases[k] = [];
      phases[k].push(n);
    }
    perInvoc.push({ total: tot, origen: or, outcome: outc, clientVersion: cv, phases: ph });
  });

  console.log('Docs operations_log   : ' + phaseQs.size);
  console.log('Invocaciones commit   : ' + phaseDocs);
  console.log('');
  console.log('Outcomes:');
  const ok = Object.keys(outcomes).sort();
  if (!ok.length) console.log('  (sin datos)');
  else for (const k of ok) console.log('  ' + k.padEnd(28) + ' : ' + outcomes[k]);

  console.log('');
  console.log('Origen (pantalla / flow):');
  const oks = Object.keys(byOrigen).sort();
  if (!oks.length) console.log('  (sin datos)');
  else for (const k of oks) console.log('  ' + k.padEnd(28) + ' : ' + byOrigen[k]);

  console.log('');
  console.log('Distribucion por clientVersion:');
  const cvs = Object.keys(byClientVersion).sort();
  if (!cvs.length) console.log('  (sin datos)');
  else for (const v of cvs) console.log('  ' + v.padEnd(28) + ' : ' + byClientVersion[v]);

  console.log('');
  console.log('Fase                           N       p50       p95       p99');
  console.log('  ' + '-'.repeat(60));

  const phaseOrder = [
    'validation',
    'idempotent_check',
    'waitlist_check',
    'vendor_resolve',
    'transaction',
    'total',
  ];

  // Total como fase implicita (si existe)
  if (totals.length) phases.total = totals;

  const seen = new Set();
  for (const name of phaseOrder) {
    const arr = phases[name];
    if (!arr) continue;
    seen.add(name);
    console.log(row(name, [arr.length, percentile(arr, 50), percentile(arr, 95), percentile(arr, 99)], 'ms'));
  }
  for (const [name, arr] of Object.entries(phases)) {
    if (seen.has(name)) continue;
    console.log(row(name, [arr.length, percentile(arr, 50), percentile(arr, 95), percentile(arr, 99)], 'ms'));
  }

  // --------------------------------------------------------------------
  // 3) BREAKDOWN FASE DOMINANTE (para explicar los 5s del commit)
  // --------------------------------------------------------------------
  if (phaseDocs > 0) {
    console.log('');
    console.log('[3] BREAKDOWN FASE DOMINANTE (p50/p95/p99 vs total)');
    console.log('----------------------------------------------------------------');
    const pTotal50 = percentile(totals, 50);
    const pTotal95 = percentile(totals, 95);
    const pTotal99 = percentile(totals, 99);
    console.log('Fase                       %p50       %p95       %p99');
    console.log('  ' + '-'.repeat(60));
    for (const name of phaseOrder) {
      if (name === 'total') continue;
      const arr = phases[name];
      if (!arr) continue;
      const p50 = percentile(arr, 50) || 0;
      const p95 = percentile(arr, 95) || 0;
      const p99 = percentile(arr, 99) || 0;
      const line =
        '  ' +
        name.padEnd(22) +
        '  ' +
        (pTotal50 ? ((p50 / pTotal50) * 100).toFixed(1).padStart(6) + ' %' : '      -') +
        '  ' +
        (pTotal95 ? ((p95 / pTotal95) * 100).toFixed(1).padStart(6) + ' %' : '      -') +
        '  ' +
        (pTotal99 ? ((p99 / pTotal99) * 100).toFixed(1).padStart(6) + ' %' : '      -');
      console.log(line);
    }
  }

  // --------------------------------------------------------------------
  // 4) FULL — top-10 invocaciones mas lentas
  // --------------------------------------------------------------------
  if (args.full && perInvoc.length) {
    console.log('');
    console.log('[4] TOP-10 invocaciones commitPedidoCF mas lentas (ventana completa)');
    console.log('----------------------------------------------------------------');
    const sorted = perInvoc.filter((x) => Number.isFinite(x.total)).sort((a, b) => b.total - a.total).slice(0, 10);
    for (const r of sorted) {
      const phRaw = Object.entries(r.phases)
        .filter(([k]) => k !== 'total')
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([k, v]) => k + '=' + v + 'ms')
        .join(' ');
      console.log(
        '  total=' +
          String(r.total).padStart(6) +
          'ms  outcome=' +
          r.outcome.padEnd(16) +
          '  origen=' +
          r.origen.padEnd(14) +
          '  cv=' +
          r.clientVersion.padEnd(10) +
          '  ' +
          phRaw
      );
    }
  }

  console.log('');
  console.log('================================================================');
  console.log('FIN E3 report');
  console.log('================================================================');

  const cwvTotal = cwvByName.lcp.length + cwvByName.inp.length + cwvByName.cls.length;
  console.log('Resumen            : ' + cwvTotal + ' events CWV + ' + phaseDocs + ' invocaciones phase_timers');
  console.log('Instrucciones      : re-correr si cwvTotal=0 => desplegado post-horario, sin uso real aun');
  console.log('Comando recomendado: node scripts/audit/E3_cwv_report.cjs --days=7 --full');
}

main().catch((e) => {
  console.error('ERR:', e && e.stack ? e.stack : e);
  process.exit(1);
});
