/**
 * audit-rules-coverage.js
 *
 * Verifica que TODA colección Firestore referenciada por index.html
 * aparezca en al menos un `match /collection/` de firestore.rules
 * Y en al menos un test de tests/rules/.
 *
 * Exit 0: cobertura completa. Exit 1: hay huecos.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readOr(path) {
  try { return readFileSync(join(root, path), 'utf8'); } catch { return ''; }
}

const html = readOr('index.html');
const rules = readOr('firestore.rules');
const testsDir = join(root, 'tests', 'rules');
let testsBlob = '';
for (const f of readdirSync(testsDir)) testsBlob += readOr(join('tests', 'rules', f));

const usedCollections = new Set();
for (const m of html.matchAll(/\.collection\(['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g)) {
  usedCollections.add(m[1]);
}

const rulesCollections = new Set();
for (const m of rules.matchAll(/match \/([a-zA-Z_][a-zA-Z0-9_]*)\/\{/g)) {
  rulesCollections.add(m[1]);
}

const testedCollections = new Set();
for (const m of testsBlob.matchAll(/['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g)) {
  if (usedCollections.has(m[1])) testedCollections.add(m[1]);
}

const missingFromRules = [...usedCollections].filter(c => !rulesCollections.has(c)).sort();
const missingFromTests = [...usedCollections].filter(c => !testedCollections.has(c)).sort();

console.log(`Colecciones usadas por index.html:  ${usedCollections.size}`);
console.log(`Colecciones cubiertas por rules:    ${rulesCollections.size}`);
console.log(`Colecciones cubiertas por tests:    ${testedCollections.size}`);
console.log('');

if (missingFromRules.length) {
  console.log('❌ SIN RULES:');
  for (const c of missingFromRules) console.log(`   - ${c}`);
} else {
  console.log('✅ Todas las colecciones tienen `match` en firestore.rules');
}
if (missingFromTests.length) {
  console.log('❌ SIN TESTS:');
  for (const c of missingFromTests) console.log(`   - ${c}`);
} else {
  console.log('✅ Todas las colecciones aparecen en algún test');
}

if (missingFromRules.length || missingFromTests.length) process.exit(1);
