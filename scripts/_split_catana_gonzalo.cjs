/**
 * _split_catana_gonzalo.cjs — 2026-09-29
 * Split CATANA GONZALO en 2:
 *   1. Actual (Kb3MSYOPGoudAuzHCyGP): rename → "CAMPAÑA CATANA GONZALO AGO", activa=false, endDate=2026-08-31
 *   2. Nueva SEPT: mismos SKUs, target $8.5M, rango 2026-09-01 → 2026-11-01, activa=true
 */
const path = require('path');
const os = require('os');
const admin = require('../functions/node_modules/firebase-admin');

const SA_KEY = path.join(os.homedir(), 'Downloads', 'app-vendedores-shimano-firebase-adminsdk-fbsvc-71fc15072e.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_KEY)) });
const db = admin.firestore();

const OLD_ID = 'Kb3MSYOPGoudAuzHCyGP';
const OLD_SKUS = ['CATC3000HGFE', 'CAT4000HGFE', 'CATC3000FE', 'CAT4000FE', 'CAT1000FE', 'CAT2500FE', 'CAT2500HGFE'];
const OLD_FILTER_VALUES = ['CATC3000HGFE', 'CAT4000HGFE', 'CATC3000FE', 'CAT4000FE', 'CAT1000FE', 'CAT2500FE'];

(async () => {
  // 1) Actualizar la actual
  const oldRef = db.collection('campaigns').doc(OLD_ID);
  await oldRef.update({
    name: 'CAMPAÑA CATANA GONZALO AGO',
    activa: false,
    endDate: '2026-08-31', // cerrar en fin de agosto (rango solo agosto)
    updatedAt: new Date().toISOString(),
    updatedBy: 'mariano.erbino@shimano.com.ar (via split script)',
  });
  console.log('✓ CAMPAÑA CATANA GONZALO AGO archivada (activa=false, endDate=2026-08-31)');

  // 2) Crear nueva SEPT
  const newRef = db.collection('campaigns').doc();
  const newDoc = {
    name: 'CAMPAÑA CATANA GONZALO SEPT.',
    familia: 'SPINNING',
    subfamilia: 'CATANA',
    filterType: 'sku',
    filterValues: OLD_FILTER_VALUES,
    skus: OLD_SKUS,
    scope: 'vendor',
    scopeValues: ['GONZALO DE LA ROSA'],
    targetType: 'money',
    targetAmount: 8500000,
    startDate: '2026-09-01',
    endDate: '2026-11-01',
    activa: true,
    createdAt: new Date().toISOString(),
    createdBy: 'mariano.erbino@shimano.com.ar (via split script)',
    createdByEmail: 'mariano.erbino@shimano.com.ar',
    updatedAt: new Date().toISOString(),
    updatedBy: 'mariano.erbino@shimano.com.ar (via split script)',
  };
  await newRef.set(newDoc);
  console.log(`✓ CAMPAÑA CATANA GONZALO SEPT. creada. docId=${newRef.id}`);
  console.log(`  target=$8.500.000  rango 2026-09-01 → 2026-11-01  ${OLD_SKUS.length} SKUs`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
