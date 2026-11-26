#!/usr/bin/env node
/**
 * W_dual_write_health.cjs — audit read-only del shadow sync Firestore → PG.
 *
 * Uso:
 *   node scripts/audit/W_dual_write_health.cjs           # read-only tabla ASCII
 *   node scripts/audit/W_dual_write_health.cjs --markdown docs/auditoria/W_dual_write_health.md
 *
 * Qué hace:
 *   1. Lee pedidos abiertos en Firestore (`closedAt == null`).
 *   2. Lee pedidos abiertos en PG (`closed_at IS NULL`).
 *   3. Reporta por SKU:
 *      - count_firestore_asig  vs  count_pg_asig
 *      - count_firestore_bo    vs  count_pg_bo
 *      - count_firestore_total vs  count_pg_total
 *   4. Imprime tabla ASCII (default) + markdown (opcional).
 *   5. Si count_divergent > 0 → exit 1 (CI fail).
 *
 * ⚠️ READ-ONLY. No escribe en PG ni en Firestore.
 *
 * Variables de entorno:
 *   - GOOGLE_APPLICATION_CREDENTIALS: path al JSON SA del proyecto Firebase.
 *   - PG_CONN_STRING: connection string PostgreSQL (postgres://user:pass@host/db).
 *
 * S-10 doble escritura (feat/s10-dual-write-design, 2026-11-26).
 * ADR-008 §Decisión B monitoreo + rollback.
 *
 * En Fase 0 (flag OFF) este script SIEMPRE reporta "PG vacio" porque nadie
 * escribe. Es exactamente lo esperado. Sirve para:
 *   - Smoke: la conexion PG funciona.
 *   - Baseline: documentar qué pedidos abiertos existen en Firestore.
 *   - Fase 1 arranque: correr pre-flip y después del flip para ver que PG se puebla.
 */

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const markdownOut = (() => {
  const idx = args.indexOf('--markdown');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return null;
})();

function log(msg) {
  process.stdout.write(msg + '\n');
}

function err(msg) {
  process.stderr.write(msg + '\n');
}

async function loadFirestore() {
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length === 0) {
      admin.initializeApp();
    }
    return admin.firestore();
  } catch (e) {
    err('[W] firebase-admin no disponible: ' + e.message);
    return null;
  }
}

async function loadPg() {
  const conn = process.env.PG_CONN_STRING;
  if (!conn) {
    err('[W] PG_CONN_STRING no definido; solo leo Firestore + marco PG=0');
    return null;
  }
  try {
    const { Client } = require('pg');
    const client = new Client({ connectionString: conn });
    await client.connect();
    return client;
  } catch (e) {
    err('[W] pg client no disponible: ' + e.message);
    return null;
  }
}

async function firestorePedidosAbiertos(db) {
  if (!db) return [];
  const snap = await db.collection('pedidos').where('closedAt', '==', null).get();
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() }));
  return out;
}

async function pgPedidosAbiertos(pgClient) {
  if (!pgClient) return [];
  const { rows } = await pgClient.query(
    `SELECT p.id, p.order_number, p.client_card_code,
            jsonb_agg(jsonb_build_object(
              'line_index', pl.line_index,
              'sku', pl.sku,
              'state', pl.state,
              'qty', pl.qty,
              'qty_open', pl.qty_open
            )) AS lines
     FROM pedidos p
     LEFT JOIN pedido_lines pl ON pl.pedido_id = p.id
     WHERE p.closed_at IS NULL
     GROUP BY p.id, p.order_number, p.client_card_code`,
  );
  return rows;
}

/**
 * Agrega counts por SKU con state=ASIG o BO.
 */
function aggregateBySku(pedidos, source) {
  // source='firestore' usa field names Firestore; 'pg' usa field names PG.
  const map = new Map();
  for (const p of pedidos) {
    const lines = source === 'firestore' ? (p.data && p.data.lines) || [] : p.lines || [];
    for (const l of lines) {
      if (!l) continue;
      const sku = source === 'firestore' ? (l.code || l.sku) : l.sku;
      const state = l.state;
      const qtyOpen = source === 'firestore' ? Number(l.qtyOpen) : Number(l.qty_open);
      if (!sku || !isFinite(qtyOpen) || qtyOpen <= 0) continue;
      if (!map.has(sku)) {
        map.set(sku, { asig: 0, bo: 0, confirmed: 0, total: 0 });
      }
      const agg = map.get(sku);
      if (state === 'ASIG') agg.asig += qtyOpen;
      if (state === 'BO') agg.bo += qtyOpen;
      if (state === 'confirmed') agg.confirmed += qtyOpen;
      agg.total += qtyOpen;
    }
  }
  return map;
}

function makeTable(fsAgg, pgAgg) {
  const allSkus = new Set([...fsAgg.keys(), ...pgAgg.keys()]);
  const rows = [];
  for (const sku of [...allSkus].sort()) {
    const fs = fsAgg.get(sku) || { asig: 0, bo: 0, confirmed: 0, total: 0 };
    const pg = pgAgg.get(sku) || { asig: 0, bo: 0, confirmed: 0, total: 0 };
    const divergent =
      fs.asig !== pg.asig ||
      fs.bo !== pg.bo ||
      fs.confirmed !== pg.confirmed;
    rows.push({ sku, fs, pg, divergent });
  }
  return rows;
}

function renderAscii(rows) {
  const header = 'SKU'.padEnd(20) +
    'FS asig'.padStart(8) + 'FS bo'.padStart(8) + 'FS conf'.padStart(8) +
    'PG asig'.padStart(8) + 'PG bo'.padStart(8) + 'PG conf'.padStart(8) +
    'Div?'.padStart(6);
  const lines = [header, ''.padEnd(header.length, '-')];
  for (const r of rows) {
    lines.push(
      String(r.sku).slice(0, 20).padEnd(20) +
        String(r.fs.asig).padStart(8) +
        String(r.fs.bo).padStart(8) +
        String(r.fs.confirmed).padStart(8) +
        String(r.pg.asig).padStart(8) +
        String(r.pg.bo).padStart(8) +
        String(r.pg.confirmed).padStart(8) +
        (r.divergent ? 'YES' : 'no').padStart(6),
    );
  }
  return lines.join('\n');
}

function renderMarkdown(rows, scannedFs, scannedPg) {
  const out = [];
  out.push('# Dual-write health report');
  out.push('');
  out.push('Fecha: ' + new Date().toISOString());
  out.push('');
  out.push('Pedidos abiertos Firestore: ' + scannedFs);
  out.push('Pedidos abiertos PG:        ' + scannedPg);
  out.push('');
  out.push('| SKU | FS asig | FS bo | FS conf | PG asig | PG bo | PG conf | Divergente |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---|');
  for (const r of rows) {
    out.push(
      '| ' + r.sku + ' | ' + r.fs.asig + ' | ' + r.fs.bo + ' | ' + r.fs.confirmed +
      ' | ' + r.pg.asig + ' | ' + r.pg.bo + ' | ' + r.pg.confirmed +
      ' | ' + (r.divergent ? '**sí**' : 'no') + ' |',
    );
  }
  return out.join('\n');
}

async function main() {
  log('[W] arrancando audit read-only de dual-write health...');

  const db = await loadFirestore();
  const pgClient = await loadPg();

  const fsPedidos = await firestorePedidosAbiertos(db);
  const pgPedidos = await pgPedidosAbiertos(pgClient);

  log('[W] Firestore pedidos abiertos: ' + fsPedidos.length);
  log('[W] PG pedidos abiertos:        ' + pgPedidos.length);

  const fsAgg = aggregateBySku(fsPedidos, 'firestore');
  const pgAgg = aggregateBySku(pgPedidos, 'pg');

  const rows = makeTable(fsAgg, pgAgg);
  const divergentCount = rows.filter((r) => r.divergent).length;

  log('');
  log(renderAscii(rows));
  log('');
  log('[W] SKUs analizados:   ' + rows.length);
  log('[W] SKUs divergentes:  ' + divergentCount);

  if (markdownOut) {
    const md = renderMarkdown(rows, fsPedidos.length, pgPedidos.length);
    const outPath = path.resolve(process.cwd(), markdownOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
    log('[W] markdown escrito en: ' + outPath);
  }

  if (pgClient && typeof pgClient.end === 'function') {
    await pgClient.end();
  }

  // En Fase 0 (flag OFF) esperamos divergentCount === fsAgg.size (PG vacio).
  // En Fase 1+ con flag ON esperamos divergentCount === 0.
  // El script NO decide — lo reporta y deja que CI evalue segun fase.
  //
  // Exit 0 siempre en v0 (es read-only diagnóstico). La semantica de "fail"
  // se define en el workflow nightly cuando se arme (S-10.3.2).
  process.exit(0);
}

main().catch((e) => {
  err('[W] fatal: ' + (e && e.message ? e.message : e));
  err(e && e.stack ? e.stack : '');
  process.exit(2);
});
