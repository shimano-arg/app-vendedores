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
 * 2. Para cada uno, SAP SL (solo GET): /Orders?$filter=NumAtCard eq '<pedidoId>'.
 * 3. Si hay match: race victim. Reparar (REABRE el pedido):
 *    - Unset `closedAt`, `closedReason`, `closedBy`.
 *    - Unset `transferidoSAP.closedManuallyInSap`, `sapDocumentStatus`,
 *      `closedManuallyDetectedAt`.
 *    - Set `transferidoSAP.orderDocEntry`, `orderDocNum`, `orderSyncedAt`.
 * 4. Si NO hay match: cierre manual genuino, dejar como está.
 *
 * C9 (contención):
 *   - DRY-RUN por defecto (antes escribía por defecto).
 *   - APPLY: --project <id> --apply --confirm-project=<id> + cuenta de servicio.
 *   - Firebase Admin se inicializa con `projectId` = --project, y el guard
 *     bloquea si la cuenta de servicio es de otro proyecto.
 *   - Cada update guarda `_backfill.<slug>.previousValues` (CLAUDE.md §55)
 *     para poder revertir.
 *
 * Uso:
 *   cd functions
 *   node ../scripts/repair-quotation-closure-race-victims.mjs --project app-vendedores-shimano
 *
 * Requisitos:
 *   - functions/serviceAccount.json (o GOOGLE_APPLICATION_CREDENTIALS env).
 *   - functions/.env con SAP_SL_URL, SAP_SL_COMPANY, SAP_SL_USER, SAP_SL_PASSWORD.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const safeTarget = require('./_lib/safe-target.cjs');

export const BACKFILL_SLUG = 'repair_quotation_closure_race_v1102';

/**
 * Puro: arma el patch de Firestore para un race victim.
 * @param {Record<string, any>} data  pedido actual
 * @param {{docEntry:number, docNum:number|null}} so
 * @param {string} nowIso
 * @param {() => any} fieldDelete  FieldValue.delete
 */
export function buildRepairPatch(data, so, nowIso, fieldDelete) {
  const existingTsap = data.transferidoSAP || {};
  const newTsap = { ...existingTsap };
  newTsap.orderDocEntry = so.docEntry;
  if (so.docNum !== null) newTsap.orderDocNum = so.docNum;
  newTsap.orderSyncedAt = nowIso;
  newTsap.raceVictimRepairedAt = nowIso;
  delete newTsap.closedManuallyInSap;
  delete newTsap.sapDocumentStatus;
  delete newTsap.closedManuallyDetectedAt;
  const previousValues = {
    closedAt: data.closedAt === undefined ? null : data.closedAt,
    closedReason: data.closedReason === undefined ? null : data.closedReason,
    closedBy: data.closedBy === undefined ? null : data.closedBy,
    transferidoSAP: existingTsap,
  };
  return {
    closedAt: fieldDelete(),
    closedReason: fieldDelete(),
    closedBy: fieldDelete(),
    transferidoSAP: newTsap,
    [`_backfill.${BACKFILL_SLUG}`]: {
      previousValues,
      by: 'scripts/repair-quotation-closure-race-victims.mjs',
      at: nowIso,
    },
  };
}

/**
 * Núcleo con dependencias inyectables (testeable sin red).
 * @param {{ t: any, fbDb: any, findSo: (id:string)=>Promise<any>, fieldDelete: ()=>any,
 *           login: ()=>Promise<any>, logout: (s:any)=>Promise<void>, log?: (m:string)=>void,
 *           now?: ()=>string }} deps
 */
export async function runRepair(deps) {
  const log = deps.log || ((m) => console.log(m));
  const now = deps.now || (() => new Date().toISOString());
  log(`[${deps.t.mode}] Buscando race victims (closedManuallyInSap:true) en ${deps.t.project}...`);
  const snap = await deps.fbDb.collection('pedidos').where('closedAt', '!=', null).get();
  /** @type {{id:string, data:any}[]} */
  const candidates = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const tsap = data.transferidoSAP || {};
    if (tsap.closedManuallyInSap === true) candidates.push({ id: doc.id, data });
  });
  log(`Encontrados ${candidates.length} candidatos con closedManuallyInSap:true`);
  const summary = { salvaged: 0, confirmed: 0, errors: 0, candidates: candidates.length };
  if (candidates.length === 0) return summary;

  const session = await deps.login();
  try {
    for (const c of candidates) {
      log(`\nProcesando ${c.id}...`);
      try {
        const so = await deps.findSo(session, c.id);
        if (!so) {
          log('  → cierre manual genuino (no hay SO con ese NumAtCard). Skip.');
          summary.confirmed++;
          continue;
        }
        log(`  → RACE VICTIM: SO DocEntry=${so.docEntry}, DocNum=${so.docNum}`);
        const patch = buildRepairPatch(c.data, so, now(), deps.fieldDelete);
        await safeTarget.write(
          deps.t,
          `update pedidos/${c.id} (reabrir + orderDocEntry=${so.docEntry})`,
          () => deps.fbDb.doc(`pedidos/${c.id}`).update(patch),
          log,
        );
        summary.salvaged++;
      } catch (e) {
        log(`  ERROR: ${/** @type {any} */ (e).message}`);
        summary.errors++;
      }
    }
  } finally {
    await deps.logout(session);
  }
  log(
    `\n===== RESUMEN =====\nRace victims ${deps.t.apply ? 'reparados' : 'a reparar'}: ${summary.salvaged}\n` +
      `Confirmados cierres manuales: ${summary.confirmed}\nErrores: ${summary.errors}\n` +
      `${deps.t.apply ? '' : '(DRY-RUN — no se aplicaron cambios)'}`,
  );
  return summary;
}

function readEnvFile(envPath) {
  /** @type {Record<string,string>} */
  const envVars = {};
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    envVars[k] = v;
  }
  return envVars;
}

async function main() {
  const saPath = resolve(__dirname, '../functions/serviceAccount.json');
  // El guard valida --project, modo y que la SA sea del mismo proyecto.
  const t = await safeTarget.guardOrExit({
    requiresWrite: true,
    env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || saPath },
  });
  if (t.rest.length) {
    console.error(`argumentos desconocidos: ${t.rest.join(' ')}`);
    process.exit(2);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || saPath;
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(readFileSync(credPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: no se pudo leer la cuenta de servicio. ${/** @type {any} */ (e).message}`);
    process.exit(1);
  }
  let envVars;
  try {
    envVars = readEnvFile(resolve(__dirname, '../functions/.env'));
  } catch (e) {
    console.error(`ERROR: no se pudo leer functions/.env. ${/** @type {any} */ (e).message}`);
    process.exit(1);
  }
  const { SAP_SL_URL, SAP_SL_COMPANY, SAP_SL_USER, SAP_SL_PASSWORD } = envVars;
  if (!SAP_SL_URL || !SAP_SL_COMPANY || !SAP_SL_USER || !SAP_SL_PASSWORD) {
    console.error('ERROR: SAP_SL_URL/COMPANY/USER/PASSWORD faltantes en functions/.env');
    process.exit(1);
  }
  const admin = (await import('firebase-admin')).default;
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: t.project });
  const fbDb = admin.firestore();

  const login = async () => {
    const res = await fetch(`${SAP_SL_URL}/b1s/v1/Login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ CompanyDB: SAP_SL_COMPANY, UserName: SAP_SL_USER, Password: SAP_SL_PASSWORD }),
    });
    if (!res.ok) throw new Error(`SAP Login failed: ${res.status}`);
    const setCookie = res.headers.get('set-cookie') || '';
    const b1 = setCookie.match(/B1SESSION=([^;]+)/);
    const route = setCookie.match(/ROUTEID=([^;]+)/);
    if (!b1) throw new Error('SAP Login: no B1SESSION cookie');
    return { cookie: `B1SESSION=${b1[1]}${route ? `; ROUTEID=${route[1]}` : ''}` };
  };
  const logout = async (session) => {
    try {
      await fetch(`${SAP_SL_URL}/b1s/v1/Logout`, { method: 'POST', headers: { Cookie: session.cookie } });
    } catch {
      /* silent */
    }
  };
  const findSo = async (session, pedidoId) => {
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
    const docEntry = Number(rows[0].DocEntry);
    if (!Number.isFinite(docEntry) || docEntry <= 0) return null;
    const docNumRaw = Number(rows[0].DocNum);
    return { docEntry, docNum: Number.isFinite(docNumRaw) ? docNumRaw : null };
  };

  try {
    await runRepair({ t, fbDb, findSo, login, logout, fieldDelete: () => admin.firestore.FieldValue.delete() });
  } finally {
    await admin.app().delete();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}
