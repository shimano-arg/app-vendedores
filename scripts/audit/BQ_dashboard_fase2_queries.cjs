#!/usr/bin/env node
'use strict';
/**
 * Helper de solo lectura (no es parte de la app): imprime las consultas del
 * Dashboard de Ventas fase 2 como scripts de BigQuery listos para pegar en la
 * consola (DECLARE de cada parámetro + consulta con variables p_<nombre>).
 *
 * Uso: node scripts/audit/BQ_dashboard_fase2_queries.cjs > /tmp/queries.sql
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CORE = path.join(__dirname, '..', '..', 'functions', 'core');
const FILTROS = [
  { etiqueta: 'mes 2026-09', raw: { mes: '2026-09' } },
  { etiqueta: 'mes 2026-09, vendedor PACHI', raw: { mes: '2026-09', vendedores: ['PACHI'] } },
];

/** Literal SQL de un string con comillas escapadas. */
function sqlStr(v) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** DECLARE para un parámetro según su tipo (ARRAY<STRING>, INT64 o STRING). */
function declare(name, value, type) {
  const v = `p_${name}`;
  if (Array.isArray(type) || Array.isArray(value)) {
    const arr = Array.isArray(value) ? value : [];
    return `DECLARE ${v} ARRAY<STRING> DEFAULT [${arr.map(sqlStr).join(', ')}];`;
  }
  if (type === 'INT64') return `DECLARE ${v} INT64 DEFAULT ${Number(value)};`;
  return `DECLARE ${v} STRING DEFAULT ${sqlStr(value)};`;
}

/** Bloque completo de una consulta: cabecera, DECLAREs y SQL sin '@'. */
function renderQuery(nombre, etiqueta, q) {
  const params = q.params || {};
  const types = q.types || {};
  const names = Object.keys(params);
  const lines = [`-- ===== ${nombre} (${etiqueta}) =====`];
  for (const n of names) lines.push(declare(n, params[n], types[n]));
  const sql = q.query.replace(/@([A-Za-z_]\w*)/g, (m, n) => {
    if (!names.includes(n)) throw new Error(`Parámetro @${n} sin declarar en ${nombre}`);
    return `p_${n}`;
  });
  lines.push(sql.trimEnd() + ';', '');
  return lines.join('\n');
}

/** Arma el script completo para todos los filtros de muestra. */
async function buildScript(nowMs) {
  const imp = (f) => import(pathToFileURL(path.join(CORE, f)).href);
  const [gestion, productos, campanias, base, core] = await Promise.all([
    imp('dashboard-ventas-queries-gestion.js'),
    imp('dashboard-ventas-queries-productos.js'),
    imp('dashboard-ventas-queries-campanias.js'),
    imp('dashboard-ventas-queries.js'),
    imp('dashboard-ventas-core.js'),
  ]);
  const out = [
    '-- Dashboard de Ventas fase 2: consultas para probar en BigQuery.',
    '-- Cada bloque (desde su linea ===== hasta el ;) se pega y corre por separado: los DECLARE se repiten entre bloques.',
    '-- Generado con: node scripts/audit/BQ_dashboard_fase2_queries.cjs > /tmp/queries.sql',
    '',
  ];
  for (const { etiqueta, raw } of FILTROS) {
    const f = core.normalizeFilters(raw, nowMs);
    const grupos = [
      ...Object.entries(base.buildQueries(f, nowMs)),
      ...Object.entries(gestion.buildGestionQueries(f, nowMs)),
      ...Object.entries(productos.buildProductosQueries(f, nowMs)),
      ['campanias', campanias.buildCampaniasQuery(f, nowMs)],
    ];
    for (const [nombre, q] of grupos) out.push(renderQuery(nombre, etiqueta, q));
  }
  return out.join('\n');
}

module.exports = { buildScript, renderQuery, declare };

if (require.main === module) {
  buildScript(Date.now()).then(
    (s) => process.stdout.write(s + '\n'),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
}
