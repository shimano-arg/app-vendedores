// scripts/seed-planner-responsables.mjs
// v1007 (2026-09-22): siembra inicial de app_config/planner_responsables con
// mariano.erbino@shimano.com.ar como responsable por defecto en las 6 columnas.
// Mariano después reasigna vía sub-tab Config en la UI del Planner.
//
// Uso: node scripts/seed-planner-responsables.mjs
// Requiere: gcloud auth application-default login (o GOOGLE_APPLICATION_CREDENTIALS
// apuntando a un service account con role datastore.user en el proyecto).

import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.GCLOUD_PROJECT || 'app-vendedores-shimano',
  });
}

const db = admin.firestore();

const MARIANO = 'mariano.erbino@shimano.com.ar';

const config = {
  lista_espera: { email: MARIANO, name: 'Mariano', notifyOnEnter: true },
  oferta:       { email: MARIANO, name: 'Mariano', notifyOnEnter: true },
  ordenes:      { email: MARIANO, name: 'Mariano', notifyOnEnter: true },
  confirmado:   { email: MARIANO, name: 'Mariano', notifyOnEnter: true, hardcoded: true },
  facturar:     { email: MARIANO, name: 'Mariano', notifyOnEnter: true, sendToVdi: false },
  cobrado:      { email: MARIANO, name: 'Mariano', notifyOnEnter: true },
};

const ref = db.doc('app_config/planner_responsables');
const existing = await ref.get();

if (existing.exists) {
  console.log('planner_responsables ya existe. Contenido actual:');
  console.log(JSON.stringify(existing.data(), null, 2));
  console.log('\nOverride? Este script hace .set() (reemplaza completo).');
  console.log('Continuando en 3 segundos... (Ctrl+C para cancelar)');
  await new Promise(r => setTimeout(r, 3000));
}

await ref.set(config);
console.log('\n✅ Seeded app_config/planner_responsables:');
console.log(JSON.stringify(config, null, 2));
console.log('\nMariano puede reasignar responsables via sub-tab Config en el Planner.');

process.exit(0);
