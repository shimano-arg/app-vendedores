// Lookup del UID real de PACHI (verificado contra roles collection).
const admin = require('../../functions/node_modules/firebase-admin');
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'app-vendedores-shimano' });
const db = admin.firestore();
const auth = admin.auth();
(async () => {
  const email = 'pachinaba@gmail.com';
  try {
    const user = await auth.getUserByEmail(email);
    console.log('[auth]', { uid: user.uid, email: user.email, displayName: user.displayName, disabled: user.disabled });
    const roleDoc = await db.collection('roles').doc(user.uid).get();
    console.log('[roles]', roleDoc.exists ? roleDoc.data() : 'NOT FOUND');
  } catch (e) {
    console.error('[error]', e.message);
    process.exit(1);
  }
})();
