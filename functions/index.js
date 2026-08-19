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

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { runDailyBackup } from './core/backup-core.js';
// @google-cloud/firestore es pesado (~50 MB con gRPC/protobuf) y solo se
// usa dentro de dailyFirestoreBackup para instanciar FirestoreAdminClient.
// Cargarlo top-level exhausta el timeout de 10s del "backend spec analysis"
// del deploy de Firebase Functions. Lazy dynamic import inside la function.
import { syncSapInvoices } from './core/invoice-sync-core.js';
import { extractAffectedSkus, recalcSnapshotForSkus } from './core/pedido-snapshot-core.js';
import { handleSapProxy } from './core/sap-proxy-core.js';

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
    // cors: true (default) permite que el framework responda el OPTIONS preflight
    // que el browser manda antes del POST cross-origin. Con cors: false el
    // preflight falla, el browser cachea el fallo, y los POST subsiguientes se
    // cuelgan indefinidamente en el SDK client-side sin ni siquiera llegar al server.
    cors: true,
    enforceAppCheck: false, // TODO: enable cuando App Check esté configurado
  },
  async (request) => {
    const db = getFirestore();
    const sapCfgSnap = await db.doc('app_config/sap_integration').get();
    const sapCfg = sapCfgSnap.data() || {};
    const sl = sapCfg.serviceLayer || {};

    try {
      return await handleSapProxy(request.data, request.auth ? { uid: request.auth.uid } : null, {
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
      });
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
        const err = /** @type {{code: string, message: string}} */ (e);
        throw new HttpsError(/** @type {any} */ (err.code), err.message);
      }
      console.error('sapProxy unexpected error', e);
      throw new HttpsError('internal', 'Error interno sapProxy');
    }
  }
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
/**
 * syncSapInvoicesToApp — scheduled cada 15 min (E2 del plan BO/ASIG).
 * En SHADOW MODE (default): lee Invoices SAP, resuelve lineage Invoice->SO->SQ,
 * matchea con pedidos-app por transferidoSAP.docEntry. NO modifica pedidos.
 * Escribe log de resultado a `sap_sync_log/{isoTimestamp}` para inspeccion.
 * Cursor persistido en `app_config/sap_sync_state.lastInvoiceDocEntry`.
 *
 * Modo se cambia editando `app_config/sap_sync_state.mode` a 'active' en E5.
 */
export const syncSapInvoicesToApp = onSchedule(
  {
    region: REGION,
    schedule: 'every 15 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
    retryCount: 1,
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [SAP_SL_PASSWORD],
  },
  async () => {
    const db = getFirestore();
    const sapCfgSnap = await db.doc('app_config/sap_integration').get();
    const sapCfg = sapCfgSnap.data() || {};
    const sl = sapCfg.serviceLayer || {};
    if (!sl.url || !sl.companyDB) {
      console.warn('syncSapInvoicesToApp: sap_integration.serviceLayer incompleto, skip');
      return;
    }
    const result = await syncSapInvoices({
      fetch: globalThis.fetch,
      sapConfig: {
        url: sl.url,
        companyDB: sl.companyDB,
        userName: sl.username || sl.userName,
        password: SAP_SL_PASSWORD.value(),
      },
      fbDb: db,
      log: (msg, extra) => console.log(msg, extra || {}),
    });
    // Audit log: 1 doc por corrida. Retention se puede sumar despues (30d TTL).
    const logId = new Date().toISOString().replace(/[:.]/g, '-');
    await db
      .collection('sap_sync_log')
      .doc(logId)
      .set({
        ranAt: new Date().toISOString(),
        ...result,
      });
    console.log('syncSapInvoicesToApp summary', {
      mode: result.mode,
      invoicesRead: result.invoicesRead,
      matches: result.matches.length,
      orphans: result.orphans.length,
      errors: result.errors.length,
    });
  }
);

/**
 * onPedidoWriteRecalcSnapshot — trigger on-write pedidos/{id} (E3 del plan BO/ASIG).
 * HYBRID MODE: coexiste con SAP-source (sync_sap_to_firestore.py:571-642).
 * Escribe keys paralelos backorderBySkuApp / asigBySkuApp / asigByClientSkuApp:
 *   - Modo shadow (default): a app_config/stock_snapshot_shadow_v3
 *   - Modo active (E5): a app_config/stock_snapshot (sin pisar keys SAP-source)
 * Modo se cambia via app_config/sap_sync_state.mode (mismo flag que E2).
 */
export const onPedidoWriteRecalcSnapshot = onDocumentWritten(
  {
    region: REGION,
    document: 'pedidos/{pedidoId}',
    retry: false,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const beforeData = event.data?.before?.data() ?? null;
    const afterData = event.data?.after?.data() ?? null;
    const affectedSkus = extractAffectedSkus(beforeData, afterData);
    if (!affectedSkus.size) return; // pedido sin lines app-source relevantes
    const db = getFirestore();
    const r = await recalcSnapshotForSkus(
      { fbDb: db, log: (msg, extra) => console.log(msg, extra || {}) },
      affectedSkus
    );
    console.log('onPedidoWriteRecalcSnapshot done', {
      pedidoId: event.params.pedidoId,
      mode: r.mode,
      skus: r.skusRecalculated,
      snapshotDoc: r.snapshotDoc,
    });
  }
);

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
  }
);
