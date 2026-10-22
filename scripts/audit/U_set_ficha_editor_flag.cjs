// U — Setear fichaClienteEditorFull=true en roles/{uid} para los 2 usuarios
// autorizados por Mariano a editar la Ficha Cliente de cualquier cliente:
//   - Ioannis Palkoudakis — ioannis.plakoudakis@shimano.com.ar
//     uid: mQgB3TDMhwPOmLlFAH0Tdhw9hVa2
//   - Santiago Esteban — santiago.esteban@shimano.com.ar
//     uid: 1b0UtWCYB3gxTXg8EfcGIoEvK1D3
//
// Ambos tienen role=interno. Admin/gerente ya tienen el permiso por default.
//
// Rules Firestore: `firestore.rules isFichaClienteEditor()` lee el flag.
// Client-side: `window.currentUserFichaEditor` carga el flag al login.
//
// Dry-run default + `--apply` para persistir.
// Autorizado por Mariano 2026-10-22.

const PROJECT = 'app-vendedores-shimano';

const EDITORS = [
  {
    uid: 'mQgB3TDMhwPOmLlFAH0Tdhw9hVa2',
    email: 'ioannis.plakoudakis@shimano.com.ar',
    name: 'Ioannis Palkoudakis',
  },
  {
    uid: '1b0UtWCYB3gxTXg8EfcGIoEvK1D3',
    email: 'santiago.esteban@shimano.com.ar',
    name: 'Santiago Esteban',
  },
];

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('U — Setear fichaClienteEditorFull=true (v1420 §54)');
  console.log('================================================================');
  console.log('Modo:', APPLY ? '--apply' : 'DRY-RUN');
  console.log();

  const nowIso = new Date().toISOString();
  for (const u of EDITORS) {
    const ref = db.collection('roles').doc(u.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log('⚠️  ', u.name, '(', u.uid, ') — NO existe el doc en roles/');
      continue;
    }
    const data = snap.data();
    const currentFlag = data.fichaClienteEditorFull;
    const emailMatch = (data.email || '').toLowerCase() === u.email.toLowerCase();
    console.log(u.name, '·', u.uid);
    console.log('  email:', data.email, emailMatch ? '✓ match' : '⚠️  diff vs expected ' + u.email);
    console.log('  role:', data.role, '· vendor:', data.vendor || '-');
    console.log('  fichaClienteEditorFull actual:', currentFlag);
    console.log('  → target: true');
    if (currentFlag === true) {
      console.log('  (ya está en true, no-op)');
    }
    console.log();
    if (APPLY && currentFlag !== true) {
      await ref.update({
        fichaClienteEditorFull: true,
        fichaClienteEditorFullAt: nowIso,
        fichaClienteEditorFullBy: 'scripts/audit/U_set_ficha_editor_flag.cjs',
        fichaClienteEditorFullReason: 'autorizacion_mariano_2026_10_22_informe_cowork',
      });
      console.log('  ✓ Flag seteado.');
    }
  }
  if (!APPLY) {
    console.log('DRY-RUN: ninguna escritura. Correr de nuevo con --apply para persistir.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
