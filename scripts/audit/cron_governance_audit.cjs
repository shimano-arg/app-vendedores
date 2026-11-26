#!/usr/bin/env node
/**
 * cron_governance_audit.cjs — Read-only audit de workflows GHA con `schedule:`.
 *
 * ADR-0012 (docs/adr/0012-cron-governance.md) exige que todo workflow con
 * `schedule:` tenga un bloque header con:
 *   # Owner: <email o rol>
 *   # SLA: cada N min / horas / diario
 *   # Criticality: low | medium | high
 *
 * Este script:
 *   - Itera .github/workflows/*.yml.
 *   - Identifica workflows con `schedule:`.
 *   - Chequea presencia del bloque Owner/SLA/Criticality en el header.
 *   - Reporta los que NO cumplen.
 *
 * NO escribe ni modifica workflows. Útil para review periódico + onboarding.
 *
 * Uso:
 *   node scripts/audit/cron_governance_audit.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');

function listYmlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
}

function hasScheduleBlock(content) {
  // Busca línea "schedule:" dentro de on: (no comentada).
  // Simple heurística: cualquier línea no-comentada que empiece con "  schedule:" o "schedule:" al nivel de on.
  const lines = content.split(/\r?\n/);
  let inOn = false;
  let onIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (/^on\s*:/.test(line)) {
      inOn = true;
      onIndent = line.search(/\S/);
      continue;
    }
    if (inOn) {
      const indent = line.search(/\S/);
      if (indent === -1) continue;
      if (indent <= onIndent && trimmed !== '') {
        inOn = false;
        continue;
      }
      if (/^schedule\s*:/.test(trimmed)) return true;
    }
  }
  return false;
}

function headerComments(content) {
  // Retorna las líneas de comentarios al inicio del archivo (antes de la primera key no comentada).
  // Simplificación: tomamos las primeras 80 líneas o hasta `on:` (lo que llegue primero).
  const lines = content.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    if (/^on\s*:/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function detectField(header, labels) {
  for (const label of labels) {
    const re = new RegExp('^#\\s*' + label + '\\s*:\\s*(.+)$', 'im');
    const m = header.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n - 1) + '…';
  return s + ' '.repeat(n - s.length);
}

function main() {
  console.log('=== cron_governance_audit.cjs (ADR-0012) ===');
  console.log(`Workflows dir: ${WORKFLOWS_DIR}`);
  console.log('');

  const files = listYmlFiles(WORKFLOWS_DIR);
  if (files.length === 0) {
    console.log('No hay workflows en .github/workflows/. Nada que auditar.');
    process.exit(0);
  }

  const scheduled = [];
  const noSchedule = [];

  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    const hasSchedule = hasScheduleBlock(content);
    const header = headerComments(content);

    const owner = detectField(header, ['Owner']);
    const sla = detectField(header, ['SLA']);
    const criticality = detectField(header, ['Criticality', 'Criticidad']);

    const name = path.basename(f);
    if (hasSchedule) {
      scheduled.push({ name, owner, sla, criticality });
    } else {
      noSchedule.push({ name, owner, sla, criticality });
    }
  }

  console.log(`Total workflows:            ${files.length}`);
  console.log(`Con schedule:               ${scheduled.length}`);
  console.log(`Sin schedule:               ${noSchedule.length}`);
  console.log('');

  console.log('=== Workflows con schedule ===');
  console.log(pad('File', 44) + pad('Owner', 30) + pad('SLA', 18) + pad('Criticality', 14));
  console.log('-'.repeat(106));

  const pending = [];
  for (const w of scheduled.sort((a, b) => a.name.localeCompare(b.name))) {
    const ownerDisp = w.owner || '(falta)';
    const slaDisp = w.sla || '(falta)';
    const critDisp = w.criticality || '(falta)';
    console.log(pad(w.name, 44) + pad(ownerDisp, 30) + pad(slaDisp, 18) + pad(critDisp, 14));
    if (!w.owner || !w.sla || !w.criticality) {
      pending.push(w.name);
    }
  }

  console.log('');
  console.log('=== Resumen ===');
  console.log(`Workflows con schedule que cumplen ADR-0012:  ${scheduled.length - pending.length}`);
  console.log(`Workflows con schedule que FALTAN cumplir:    ${pending.length}`);

  if (pending.length > 0) {
    console.log('');
    console.log('Pendientes (necesitan header Owner + SLA + Criticality):');
    for (const n of pending) {
      console.log('  - ' + n);
    }
    console.log('');
    console.log('Ver docs/adr/0012-cron-governance.md para el shape del header.');
  }

  // Exit 0 siempre (audit informativo, no bloquea CI).
  // Si en el futuro se decide gatear PRs, cambiar a exit 1 cuando pending > 0.
  process.exit(0);
}

main();
