#!/usr/bin/env node
// @ts-check
/**
 * §65 (2026-10-25 v1451) — Dump de SQs abiertas desde SAP Service Layer como
 * fixture read-only. Mariano pidió "fixture de SAP SL via script read-only
 * con autorización" para blindar la paridad Python ↔ Node.
 *
 * Uso:
 *   # Credenciales SAP via secrets (consultar Mariano) o Firestore
 *   # app_config/sap_integration + GOOGLE_APPLICATION_CREDENTIALS activo.
 *   node scripts/audit/dump_sqs_fixture.cjs
 *   → escribe tests/fixtures/sqs_prod.json (overwrite — hace backup .bak si
 *     ya existe)
 *
 * Si no hay ADC + VPN a SAP → el script falla con instrucciones claras.
 * El fixture actual tests/fixtures/sqs_prod.json es SINTÉTICO (cubre los
 * mismos casos pero generado a mano). Si corre este dump en una sesión
 * autorizada, actualizar el fixture + re-correr tests/functions/
 * collect-backorder-paridad-python.test.js.
 *
 * NO modifica Firestore ni SAP. Solo GET /b1s/v1/Quotations.
 */

const fs = require('node:fs');
const path = require('node:path');
const admin = require('../../functions/node_modules/firebase-admin');

const PROJECT = 'app-vendedores-shimano';
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT });
}
const db = admin.firestore();

async function slLogin(cfg) {
  const resp = await fetch(cfg.url + '/b1s/v1/Login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      CompanyDB: cfg.companyDB,
      UserName: cfg.userName,
      Password: cfg.password,
    }),
  });
  if (!resp.ok) {
    throw new Error('SL login HTTP ' + resp.status);
  }
  const setCookie = resp.headers.get('set-cookie') || '';
  const match = /B1SESSION=([^;]+)/.exec(setCookie);
  if (!match) throw new Error('SL login OK pero no vino B1SESSION cookie');
  return match[1];
}

async function fetchAllOpenSqs(cfg, cookie) {
  const sqs = [];
  let p =
    '/b1s/v1/Quotations' +
    '?$select=DocEntry,CardCode,DocumentStatus,Cancelled,DocumentLines' +
    "&$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'";
  let pages = 0;
  while (p) {
    const url = p.startsWith('http') ? p : cfg.url + p;
    const r = await fetch(url, {
      headers: { Cookie: 'B1SESSION=' + cookie },
    });
    if (!r.ok) {
      throw new Error('Quotations page ' + pages + ' HTTP ' + r.status);
    }
    const data = await r.json();
    const arr = (data && data.value) || [];
    for (const doc of arr) sqs.push(doc);
    pages++;
    const nextLink = data['@odata.nextLink'] || data['odata.nextLink'] || null;
    if (!nextLink) break;
    if (nextLink.startsWith('http')) {
      const idx = nextLink.indexOf('/b1s/v1/');
      p = idx >= 0 ? nextLink.slice(idx) : nextLink;
    } else if (nextLink.startsWith('/')) {
      p = nextLink;
    } else {
      p = '/b1s/v1/' + nextLink;
    }
    if (sqs.length > 20000) {
      console.warn('[dump] safety cap 20k alcanzado');
      break;
    }
  }
  return { sqs, pages };
}

async function main() {
  console.log('[dump] Leyendo app_config/sap_integration de Firestore...');
  const snap = await db.collection('app_config').doc('sap_integration').get();
  if (!snap.exists) {
    console.error('[dump] ERROR: app_config/sap_integration no existe');
    process.exit(1);
  }
  const sl = (snap.data() || {}).serviceLayer || {};
  if (!sl.enabled) {
    console.error('[dump] ERROR: serviceLayer.enabled=false');
    process.exit(2);
  }
  if (!sl.url || !sl.companyDB) {
    console.error('[dump] ERROR: serviceLayer url/companyDB faltante');
    process.exit(3);
  }
  const password = process.env.SAP_SL_PASSWORD;
  if (!password) {
    console.error(
      '[dump] ERROR: SAP_SL_PASSWORD env var faltante. Export the value from Secret Manager:\n' +
        '  gcloud secrets versions access latest --secret=SAP_SL_PASSWORD --project=' +
        PROJECT
    );
    process.exit(4);
  }
  const cfg = {
    url: sl.url,
    companyDB: sl.companyDB,
    userName: sl.username || sl.userName,
    password,
  };
  console.log('[dump] Login SAP SL ' + cfg.url + ' companyDB=' + cfg.companyDB + '...');
  const cookie = await slLogin(cfg);
  console.log('[dump] Login OK. Fetching SQs abiertas...');
  const { sqs, pages } = await fetchAllOpenSqs(cfg, cookie);
  console.log('[dump] ' + sqs.length + ' SQs en ' + pages + ' paginas');

  const fixture = {
    _dumpedAt: new Date().toISOString(),
    _project: PROJECT,
    _source: 'SAP Service Layer /b1s/v1/Quotations',
    _comentario:
      'REAL dump de SQs abiertas no canceladas. Shape identico al que ve el core' +
      ' collectBackorderFromSqs. Si re-dumpas, revisar manualmente que haya al menos' +
      ' 1 SQ con multiples lineas y 1 cliente con 2+ SQs abiertas para cobertura.',
    _stats: {
      totalSqs: sqs.length,
      totalLines: sqs.reduce(
        function (a, d) {
          return a + (Array.isArray(d.DocumentLines) ? d.DocumentLines.length : 0);
        },
        0
      ),
      pages: pages,
    },
    value: sqs,
  };

  const outPath = path.resolve(
    __dirname,
    '..',
    '..',
    'tests',
    'fixtures',
    'sqs_prod.json'
  );
  if (fs.existsSync(outPath)) {
    const bak = outPath + '.bak';
    fs.copyFileSync(outPath, bak);
    console.log('[dump] Backup del fixture previo: ' + bak);
  }
  fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2), 'utf8');
  console.log('[dump] Escrito: ' + outPath);
}

main().catch(function (e) {
  console.error('[dump] ERROR:', e);
  process.exit(99);
});
