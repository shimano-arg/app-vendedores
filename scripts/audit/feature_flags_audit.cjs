#!/usr/bin/env node
/**
 * feature_flags_audit.cjs — Read-only audit de app_config/feature_flags.
 *
 * ADR-0009 (docs/adr/0009-feature-flags.md) formaliza el shape:
 *   { value, owner, expiryDate, addedAt, addedBy,
 *     lastChangedAt, lastChangedBy, description, testsPath }
 *
 * Este script:
 *   - Lee app_config/feature_flags.
 *   - Imprime tabla con flags activos + owner + días hasta expiry + tests path.
 *   - Marca flags que carecen de owner/expiryDate/testsPath/description.
 *   - NO escribe nada. Útil para watchdog + review mensual (ADR-009).
 *
 * Uso:
 *   node scripts/audit/feature_flags_audit.cjs
 *     → Usa ADC si está loggeado. Si no, falla con mensaje claro.
 *
 * Requiere la var de entorno GOOGLE_APPLICATION_CREDENTIALS apuntando
 * al JSON de un service account, o estar loggeado con gcloud (ADC).
 */

'use strict';

const REQUIRED_KEYS = ['owner', 'expiryDate', 'description', 'testsPath'];
const DEFAULT_PROJECT = 'app-vendedores-shimano';

function parseDate(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (v && typeof v.toDate === 'function') {
    try {
      return v.toDate();
    } catch (_e) {
      return null;
    }
  }
  if (v && typeof v.seconds === 'number') {
    return new Date(v.seconds * 1000);
  }
  return null;
}

function daysUntil(dateIso, now) {
  const d = parseDate(dateIso);
  if (!d) return null;
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n - 1) + '…';
  return s + ' '.repeat(n - s.length);
}

async function main() {
  let admin;
  try {
    admin = require('firebase-admin');
  } catch (_e) {
    console.error('ERROR: firebase-admin no instalado.');
    console.error('Ejecutar desde el root del repo:');
    console.error('  cd functions && npm install && cd ..');
    console.error('  node scripts/audit/feature_flags_audit.cjs');
    process.exit(1);
  }

  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        projectId: process.env.GCLOUD_PROJECT || DEFAULT_PROJECT,
      });
    } catch (e) {
      console.error('ERROR inicializando firebase-admin:', e.message);
      console.error('Verificá que estás loggeado con `gcloud auth application-default login`');
      console.error('o seteá GOOGLE_APPLICATION_CREDENTIALS a un JSON de SA.');
      process.exit(1);
    }
  }

  const db = admin.firestore();
  const now = new Date();

  console.log('=== feature_flags_audit.cjs (ADR-0009) ===');
  console.log(`Project: ${process.env.GCLOUD_PROJECT || DEFAULT_PROJECT}`);
  console.log(`Now:     ${now.toISOString()}`);
  console.log('');

  let doc;
  try {
    doc = await db.doc('app_config/feature_flags').get();
  } catch (e) {
    console.error('ERROR leyendo app_config/feature_flags:', e.message);
    process.exit(1);
  }

  if (!doc.exists) {
    console.log('app_config/feature_flags no existe. No hay flags para auditar.');
    console.log('(Esto es válido — el helper readFlag() usa default si el doc no existe.)');
    process.exit(0);
  }

  const data = doc.data() || {};
  const flagNames = Object.keys(data).filter((k) => !k.startsWith('_') && typeof data[k] !== 'function');

  if (flagNames.length === 0) {
    console.log('No hay flags en app_config/feature_flags.');
    process.exit(0);
  }

  console.log(`Flags encontrados: ${flagNames.length}`);
  console.log('');
  console.log(pad('Flag', 36) + pad('Value', 8) + pad('Owner', 30) + pad('Days→Expiry', 14) + pad('Tests', 40));
  console.log('-'.repeat(130));

  const issues = [];

  for (const name of flagNames.sort()) {
    const raw = data[name];

    // Shape rico (nuevo): { value, owner, expiryDate, ... }
    // Shape legacy: boolean directo.
    let value, owner, expiryDate, testsPath, description;
    let shape = 'legacy';

    if (typeof raw === 'boolean') {
      value = raw;
      owner = '';
      expiryDate = '';
      testsPath = '';
      description = '';
    } else if (raw && typeof raw === 'object') {
      shape = 'rich';
      value = raw.value;
      owner = raw.owner || '';
      expiryDate = raw.expiryDate || '';
      testsPath = raw.testsPath || '';
      description = raw.description || '';
    } else {
      // Otros tipos (ej. string, number) — tratados como legacy no-boolean.
      value = raw;
      owner = '';
      expiryDate = '';
      testsPath = '';
      description = '';
    }

    const daysLeft = daysUntil(expiryDate, now);
    const daysStr =
      daysLeft === null ? '—' : daysLeft < 0 ? `VENCIDO (${daysLeft}d)` : `${daysLeft}d`;

    console.log(
      pad(name, 36) +
        pad(String(value), 8) +
        pad(owner || '(falta)', 30) +
        pad(daysStr, 14) +
        pad(testsPath || '(falta)', 40)
    );

    // Detectar faltantes.
    if (shape === 'legacy') {
      issues.push(`${name}: shape legacy (boolean directo). Falta owner/expiry/tests/description.`);
    } else {
      for (const key of REQUIRED_KEYS) {
        if (!raw[key]) {
          issues.push(`${name}: falta "${key}"`);
        }
      }
      if (daysLeft !== null && daysLeft < 0) {
        issues.push(`${name}: expiryDate VENCIDO hace ${Math.abs(daysLeft)} días. Decidir prolongar o retirar.`);
      }
    }
  }

  console.log('');
  console.log('=== Issues detectados ===');
  if (issues.length === 0) {
    console.log('Ninguno. Todos los flags cumplen ADR-0009.');
  } else {
    for (const i of issues) {
      console.log('- ' + i);
    }
  }

  console.log('');
  console.log(`Total flags: ${flagNames.length} · Issues: ${issues.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR fatal:', e);
  process.exit(1);
});
