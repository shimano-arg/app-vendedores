#!/usr/bin/env node
// @ts-check
// Ola 3 M (2026-10-25): prende/apaga app_config/live_sl.enabled.
// Uso: node scripts/setup/toggle_live_sl.cjs [on|off]
const admin = require('../../functions/node_modules/firebase-admin');
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'app-vendedores-shimano' });
const db = admin.firestore();
const target = (process.argv[2] || 'on').toLowerCase() === 'on';
(async () => {
  const ref = db.collection('app_config').doc('live_sl');
  const before = await ref.get();
  console.log('[live_sl] before:', before.exists ? JSON.stringify(before.data()) : '(not exists)');
  await ref.set({
    enabled: target,
    [target ? 'enabledAt' : 'disabledAt']: new Date().toISOString(),
    [target ? 'enabledBy' : 'disabledBy']: 'orchestrator-ola3-M-2026-10-25',
    note: `${target ? 'Habilitado' : 'Deshabilitado'} tras Ola 1+2 cerrada. v1457 prod.`,
  }, { merge: true });
  const after = await ref.get();
  console.log('[live_sl] after:', JSON.stringify(after.data()));
})().catch(e => { console.error(e); process.exit(1); });
