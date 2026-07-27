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
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
// @google-cloud/firestore es pesado (~50 MB con gRPC/protobuf) y solo se
// usa dentro de dailyFirestoreBackup para instanciar FirestoreAdminClient.
// Cargarlo top-level exhausta el timeout de 10s del "backend spec analysis"
// del deploy de Firebase Functions. Lazy dynamic import inside la function.
import { handleSapProxy } from './core/sap-proxy-core.js';
import { runDailyBackup } from './core/backup-core.js';

if (!getApps().length) initializeApp();

const SAP_SL_PASSWORD = defineSecret('SAP_SL_PASSWORD');
const REGION = 'southamerica-east1';
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'app-vendedores-shimano';
const BACKUP_BUCKET = `${PROJECT_ID}-backups`;

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

/**
 * dailyFirestoreBackup — cron 02:00 America/Argentina/Buenos_Aires.
 * Exporta Firestore a gs://<project>-backups/firestore/{YYYY-MM-DD}/.
 * Requiere que:
 *  1. Bucket destino exista (crear con `gcloud storage buckets create ...`).
 *  2. Service account default tenga `roles/datastore.importExportAdmin` +
 *     `roles/storage.objectAdmin` en el bucket.
 *  3. Cloud Scheduler + Firestore API habilitadas.
 * Alerta: configurar log-based metric sobre "dailyFirestoreBackup failed".
 */
export const dailyFirestoreBackup = onSchedule(
  {
    region: REGION,
    schedule: '0 2 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    retryCount: 2,
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    // Dynamic import (CJS interop): puede venir como .default o directo.
    const firestorePkg = await import('@google-cloud/firestore');
    const v1 = (firestorePkg.default || firestorePkg).v1;
    const client = new v1.FirestoreAdminClient();
    await runDailyBackup({
      projectId: PROJECT_ID,
      bucketName: BACKUP_BUCKET,
      now: () => new Date(),
      exportDocuments: async (request) => {
        const [operation] = await client.exportDocuments(request);
        return { name: operation.name || undefined };
      },
      log: (msg, extra) => console.log(msg, extra || {}),
    });
  },
);
