// @ts-check
/**
 * v1102 (2026-09-30): reparar pedidos que fueron cerrados incorrectamente
 * por syncSapQuotationClosuresToApp cuando en realidad la SQ se cerró por
 * conversión a SO (no cierre manual).
 *
 * Contexto: el anti-race guard v1095 usaba `fetchQuotationsWithDerivedOrder`
 * que enumeraba 2000 SOs recientes globales. En prod la mayoría son bike,
 * así que las SOs pesca correspondientes a las SQs pending caen fuera del
 * scan y el guard NO detecta la race. Reportado por Mariano 2026-09-30 con
 * REBORN SRL (SQ 2000244 → SO 20067) cerrado como `sap_manual_close`.
 *
 * Estrategia:
 * 1. Firestore: buscar pedidos con `transferidoSAP.closedManuallyInSap: true`.
 * 2. Para cada uno, SAP SL: GET /Orders?$filter=NumAtCard eq '<pedidoId>'.
 * 3. Si hay match: la SQ SÍ tenía SO derivada — race victim. Reparar:
 *    - Unset `closedAt`, `closedReason`, `closedBy`.
 *    - Unset `transferidoSAP.closedManuallyInSap`, `sapDocumentStatus`,
 *      `closedManuallyDetectedAt`.
 *    - Set `transferidoSAP.orderDocEntry`, `orderDocNum`, `orderSyncedAt`.
 * 4. Si NO hay match: cierre manual genuino, dejar como está.
 *
 * Uso:
 *   cd functions
 *   node ../scripts/repair-quotation-closure-race-victims.mjs [--dry-run]
 *
 * Requisitos:
 *   - functions/serviceAccount.json (o GOOGLE_APPLICATION_CREDENTIALS env).
 *   - functions/.env con SAP_SL_URL, SAP_SL_COMPANY, SAP_SL_USER, SAP_SL_PASSWORD.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import admin from 'firebase-admin';

// __dirname replacement.
const __dirname = dirname(fileURLToPath(import.meta.url));

const DRY_RUN = process.argv.includes('--dry-run');

// -----------------------------------------------------------------------
// Firebase Admin init
// -----------------------------------------------------------------------

const saPath = resolve(__dirname, '../functions/serviceAccount.json');
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(saPath, 'utf8'));
} catch (e) {
  console.error(`ERROR: no se pudo leer ${saPath}. ${e.message}`);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const fbDb = admin.firestore();

// -----------------------------------------------------------------------
// SAP SL config
// -----------------------------------------------------------------------

// Leer .env manualmente para no requerir dotenv.
const envPath = resolve(__dirname, '../functions/.env');
const envVars = {};
try {
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    envVars[k] = v;
  }
} catch (e) {
  console.error(`ERROR: no se pudo leer ${envPath}. ${e.message}`);
  process.exit(1);
}

const SAP_SL_URL = envVars.SAP_SL_URL;
const SAP_SL_COMPANY = envVars.SAP_SL_COMPANY;
const SAP_SL_USER = envVars.SAP_SL_USER;
const SAP_SL_PASSWORD = envVars.SAP_SL_PASSWORD;
if (!SAP_SL_URL || !SAP_SL_COMPANY || !SAP_SL_USER || !SAP_SL_PASSWORD) {
  console.error(
    'ERROR: SAP_SL_URL/COMPANY/USER/PASSWORD faltantes en functions/.env'
  );
  process.exit(1);
}

// -----------------------------------------------------------------------
// SAP SL login helper (mínimo — sin retry / refresh)
// -----------------------------------------------------------------------

async function sapLogin() {
  const res = await fetch(`${SAP_SL_URL}/b1s/v1/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      CompanyDB: SAP_SL_COMPANY,
      UserName: SAP_SL_USER,
      Password: SAP_SL_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`SAP Login failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie') || '';
  // Extraer B1SESSION + ROUTEID.
  const b1 = setCookie.match(/B1SESSION=([^;]+)/);
  const route = setCookie.match(/ROUTEID=([^;]+)/);
  if (!b1) throw new Error('SAP Login: no B1SESSION cookie');
  return {
    cookie: `B1SESSION=${b1[1]}${route ? `; ROUTEID=${route[1]}` : ''}`,
  };
}

async function sapLogout(session) {
  try {
    await fetch(`${SAP_SL_URL}/b1s/v1/Logout`, {
      method: 'POST',
      headers: { Cookie: session.cookie },
    });
  } catch {
    /* silent */
  }
}

async function findSoByNumAtCard(session, pedidoId) {
  const escaped = String(pedidoId).replace(/'/g, "''");
  const endpoint =
    `${SAP_SL_URL}/b1s/v1/Orders` +
    `?$filter=${encodeURIComponent(`NumAtCard eq '${escaped}'`)}` +
    `&$select=${encodeURIComponent('DocEntry,DocNum')}`;
  const res = await fetch(endpoint, { headers: { Cookie: session.cookie } });
  if (!res.ok) {
    console.warn(`  findSoByNumAtCard ${pedidoId} status=${res.status}`);
    return null;
  }
  const body = await res.json();
  const rows = (body && body.value) || [];
  if (rows.length === 0) return null;
  rows.sort((a, b) => Number(b.DocEntry) - Number(a.DocEntry));
  const so = rows[0];
  const docEntry = Number(so.DocEntry);
  if (!Number.isFinite(docEntry) || docEntry <= 0) return null;
  const docNumRaw = Number(so.DocNum);
  const docNum = Number.isFinite(docNumRaw) ? docNumRaw : null;
  return { docEntry, docNum };
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

async function main() {
  console.log(
    `${DRY_RUN ? '[DRY-RUN]' : '[LIVE]'} Buscando race victims (closedManuallyInSap:true)...`
  );

  // Buscar candidatos.
  const snap = await fbDb.collection('pedidos').where('closedAt', '!=', null).get();
  const candidates = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const t = data.transferidoSAP || {};
    if (t.closedManuallyInSap === true) {
      candidates.push({ id: doc.id, data });
    }
  });
  console.log(`Encontrados ${candidates.length} candidatos con closedManuallyInSap:true`);

  if (candidates.length === 0) {
    console.log('Nada por reparar.');
    await admin.app().delete();
    return;
  }

  const session = await sapLogin();
  console.log('SAP SL login OK.');

  let salvaged = 0;
  let confirmed = 0;
  let errors = 0;
  try {
    for (const c of candidates) {
      console.log(`\nProcesando ${c.id} (${c.data.clientName || '(sin nombre)'})...`);
      try {
        const so = await findSoByNumAtCard(session, c.id);
        if (!so) {
          console.log('  → cierre manual genuino (no hay SO con ese NumAtCard). Skip.');
          confirmed++;
          continue;
        }
        console.log(`  → RACE VICTIM: SO DocEntry=${so.docEntry}, DocNum=${so.docNum}`);
        if (DRY_RUN) {
          console.log('  [DRY-RUN] no se actualiza Firestore.');
          salvaged++;
          continue;
        }
        const nowIso = new Date().toISOString();
        const existingTsap = c.data.transferidoSAP || {};
        // Preservar campos previos + agregar orderDocEntry/orderDocNum
        // + limpiar los closure flags. Usamos objeto completo para
        // reemplazar transferidoSAP sin arrastrar closure flags.
        const newTsap = { ...existingTsap };
        newTsap.orderDocEntry = so.docEntry;
        if (so.docNum !== null) newTsap.orderDocNum = so.docNum;
        newTsap.orderSyncedAt = nowIso;
        newTsap.raceVictimRepairedAt = nowIso;
        delete newTsap.closedManuallyInSap;
        delete newTsap.sapDocumentStatus;
        delete newTsap.closedManuallyDetectedAt;

        await fbDb.doc(`pedidos/${c.id}`).update({
          closedAt: admin.firestore.FieldValue.delete(),
          closedReason: admin.firestore.FieldValue.delete(),
          closedBy: admin.firestore.FieldValue.delete(),
          transferidoSAP: newTsap,
        });
        console.log('  → reparado.');
        salvaged++;
      } catch (e) {
        console.error(`  ERROR: ${e.message}`);
        errors++;
      }
    }
  } finally {
    await sapLogout(session);
  }

  console.log(
    `\n===== RESUMEN =====\n` +
      `Salvados (race victims reparados): ${salvaged}\n` +
      `Confirmados cierres manuales: ${confirmed}\n` +
      `Errores: ${errors}\n` +
      `${DRY_RUN ? '(DRY-RUN — no se aplicaron cambios)' : ''}`
  );

  await admin.app().delete();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
