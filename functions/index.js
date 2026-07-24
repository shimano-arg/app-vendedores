// @ts-check
/**
 * Cloud Functions entry point para app-vendedores-shimano.
 *
 * Fase 0:
 *   - E5: sapProxy — callable HTTPS que enruta llamadas SL server-side
 *     con creds del Secret Manager. Reemplaza el fetch directo desde el
 *     browser (que hoy lee creds de app_config/sap_integration).
 *   - E6: dailyFirestoreBackup — scheduled function que exporta Firestore
 *     a gs://<project>-backups/firestore/{YYYY-MM-DD}/ (implementado en E6).
 *
 * Region: southamerica-east1 (mismo que Firestore + Storage del proyecto).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { handleSapProxy } from './core/sap-proxy-core.js';

if (!getApps().length) initializeApp();

const SAP_SL_PASSWORD = defineSecret('SAP_SL_PASSWORD');
const REGION = 'southamerica-east1';

/**
 * Callable sapProxy.
 * El cliente lo invoca con firebase.functions().httpsCallable('sapProxy')({endpoint, method, body}).
 * URL SL + companyDB + userName vienen del doc app_config/sap_integration
 * (no sensibles); la password viene del Secret Manager.
 */
export const sapProxy = onCall(
  {
    region: REGION,
    secrets: [SAP_SL_PASSWORD],
    cors: false, // callable maneja CORS internamente
    enforceAppCheck: false, // TODO: enable cuando App Check esté configurado
  },
  async (request) => {
    const db = getFirestore();
    const sapCfgSnap = await db.doc('app_config/sap_integration').get();
    const sapCfg = sapCfgSnap.data() || {};
    const sl = sapCfg.serviceLayer || {};

    try {
      return await handleSapProxy(
        request.data,
        request.auth ? { uid: request.auth.uid } : null,
        {
          getUserRole: async (uid) => {
            const snap = await db.doc(`roles/${uid}`).get();
            return (snap.data() || {}).role || null;
          },
          fetch: globalThis.fetch,
          sapConfig: {
            url: sl.url,
            companyDB: sl.companyDB,
            userName: sl.username || sl.userName,
            password: SAP_SL_PASSWORD.value(),
          },
          log: (msg, extra) => console.log(msg, extra || {}),
        },
      );
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
        const err = /** @type {{code: string, message: string}} */ (e);
        throw new HttpsError(/** @type {any} */ (err.code), err.message);
      }
      console.error('sapProxy unexpected error', e);
      throw new HttpsError('internal', 'Error interno sapProxy');
    }
  },
);
