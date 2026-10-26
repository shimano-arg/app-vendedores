// Reset temporal de la password de PACHI + guarda en secrets test-pachi-email + test-pachi-password.
// Autorizado explícitamente por Mariano para Playwright E2E (2026-10-26).
const admin = require('../../functions/node_modules/firebase-admin');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PROJECT = 'app-vendedores-shimano';
const PACHI_EMAIL = 'pachinaba@gmail.com';
const PACHI_UID = 'LaBFi1xkSLObzLEdRoP8fonZ06r2';

if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT });

function genPw() {
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 20);
}

function addSecretVersion(name, value) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('invalid secret name');
  const r = spawnSync(
    'gcloud', ['secrets', 'versions', 'add', name, '--data-file=-', `--project=${PROJECT}`],
    { input: value, encoding: 'utf8', shell: true }
  );
  if (r.status !== 0) throw new Error(`${name} failed: ${r.stderr}`);
  console.log(`[secret] ${name} new version created`);
}

function createSecretIfMissing(name) {
  const r = spawnSync(
    'gcloud', ['secrets', 'describe', name, `--project=${PROJECT}`],
    { encoding: 'utf8', shell: true }
  );
  if (r.status !== 0) {
    console.log(`[secret] creating ${name}...`);
    const c = spawnSync(
      'gcloud', ['secrets', 'create', name, '--replication-policy=automatic', `--project=${PROJECT}`],
      { encoding: 'utf8', shell: true }
    );
    if (c.status !== 0) throw new Error(`create ${name} failed: ${c.stderr}`);
  }
}

(async () => {
  const user = await admin.auth().getUser(PACHI_UID);
  console.log(`[auth] confirmed PACHI uid=${user.uid} email=${user.email}`);
  if (user.email !== PACHI_EMAIL) throw new Error('email mismatch');

  const newPw = genPw();
  await admin.auth().updateUser(PACHI_UID, { password: newPw });
  console.log(`[auth] password rotated for PACHI`);

  createSecretIfMissing('test-pachi-email');
  createSecretIfMissing('test-pachi-password');
  addSecretVersion('test-pachi-email', PACHI_EMAIL);
  addSecretVersion('test-pachi-password', newPw);

  await admin.firestore().collection('app_config').doc('e2e_test_users').set({
    pachi: { email: PACHI_EMAIL, uid: PACHI_UID, rotatedAt: new Date().toISOString() },
  }, { merge: true });
  console.log('\n[done] PACHI pw rotada. Secrets actualizados. PACHI debe re-loggearse.');
})().catch((e) => { console.error('[error]', e); process.exit(1); });
