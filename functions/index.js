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
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
// @google-cloud/firestore es pesado (~50 MB con gRPC/protobuf) y solo se
// usa dentro de dailyFirestoreBackup para instanciar FirestoreAdminClient.
// Cargarlo top-level exhausta el timeout de 10s del "backend spec analysis"
// del deploy de Firebase Functions. Lazy dynamic import inside la function.
import { updateAsigLineState } from './core/asig-recycle-core.js';
// v750 (2026-08-31): tracking de transiciones ASIG para analytics mes-a-mes.
import { detectAsigTransitions, writeTransitionsBatch } from './core/asig-transitions-core.js';
// v774 (2026-09-02): notif email al enviar oferta a SAP (pedido Mariano).
import { buildEmailContent, sendEmail, shouldNotify } from './core/notify-quotation-sent-core.js';
import { expireAsigLinesTTL } from './core/asig-ttl-core.js';
import { runDailyBackup } from './core/backup-core.js';
import { runFifoAssign } from './core/fifo-assign-core.js';
import { runGeminiOcr } from './core/gemini-ocr-core.js';
import { syncSapInvoices } from './core/invoice-sync-core.js';
import { extractAffectedSkus, recalcSnapshotForSkus } from './core/pedido-snapshot-core.js';
import { handleSapProxy } from './core/sap-proxy-core.js';
import { runSapSlHealthCheck } from './core/sap-sl-health-core.js';

if (!getApps().length) initializeApp();

const SAP_SL_PASSWORD = defineSecret('SAP_SL_PASSWORD');
// v551: Gemini API key movida de Firestore (app_config/gemini) a Secret
// Manager. Antes la key era legible por cualquier @shimano user con
// DevTools. Ahora vive solo en el CF geminiOcrProxy.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// v774 (2026-09-02): app password de bot.shimano.pesca@gmail.com para
// notif SMTP al enviar ofertas a SAP. MISMO app password que usa
// send_rendiciones_email.py en GitHub Actions (GMAIL_APP_PASSWORD secret
// del repo) — copiar a Secret Manager con `gcloud secrets create ...`.
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
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
      { fbDb: db, FieldValue, log: (msg, extra) => console.log(msg, extra || {}) },
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

/**
 * v750 (2026-08-31): onPedidoWriteTrackAsigTransitions - trigger on-write
 * pedidos/{id} para trackear transiciones de state en lines que involucran
 * ASIG. Escribe records a asig_transitions/{auto-id} para analytics mes-a-mes.
 *
 * Objetivo negocio (pedido Mariano): al fin de cada mes poder ver de las
 * unidades que estaban en ASIG, cuantas se concretaron (confirmed/invoiced)
 * vs se eliminaron (cancelled/recycled), para evaluar ROI del flow backorder.
 *
 * Logica pura en functions/core/asig-transitions-core.js (testeable sin CF).
 * Este wrapper solo hace plumbing: extraer before/after, llamar detect + write.
 * Fire-and-forget: si falla no propaga (retry:false) para no bloquear otros
 * triggers en el mismo evento.
 */
export const onPedidoWriteTrackAsigTransitions = onDocumentWritten(
  {
    region: REGION,
    document: 'pedidos/{pedidoId}',
    retry: false,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    try {
      const beforeData = event.data?.before?.data() ?? null;
      const afterData = event.data?.after?.data() ?? null;
      const transitions = detectAsigTransitions(event.params.pedidoId, beforeData, afterData);
      if (!transitions.length) return;
      const db = getFirestore();
      const n = await writeTransitionsBatch(
        { fbDb: db, FieldValue, log: (msg, extra) => console.log(msg, extra || {}) },
        transitions
      );
      console.log('onPedidoWriteTrackAsigTransitions done', {
        pedidoId: event.params.pedidoId,
        written: n,
      });
    } catch (e) {
      console.error('onPedidoWriteTrackAsigTransitions error', {
        pedidoId: event.params.pedidoId,
        error: e?.message || String(e),
      });
      // No relanzar - fire-and-forget para no bloquear otros triggers.
    }
  }
);

/**
 * v774 (2026-09-02): onQuotationSentNotify — trigger on-write pedidos/{id}
 * que envia email a santiago.beron@shimano.uy cuando un pedido efectivamente
 * se envia como Sales Quotation a SAP (transferidoSAP.docNum de null a valor
 * Y via='service_layer_auto', excluye 'app_only' que NO va a SAP).
 *
 * Pedido explicito Mariano: cada oferta que ingrese desde la app a SAP debe
 * generar notificacion automatica para tracking de Santiago Beron.
 *
 * Idempotencia: solo dispara cuando docNum pasa de null a valor. Si el
 * pedido se actualiza N veces despues sin tocar transferidoSAP, no reenvia.
 * Si se limpia (volverAPendientes) y vuelve, si notifica (comportamiento
 * esperado: re-envio del pedido).
 *
 * Fire-and-forget: falla del SMTP no rompe nada, solo se loguea.
 *
 * REQUIERE: secret GMAIL_APP_PASSWORD cargado en Secret Manager. Copiar
 * desde el GitHub Actions secret con:
 *   gcloud secrets create GMAIL_APP_PASSWORD --data-file=- \
 *     --replication-policy=automatic --project=app-vendedores-shimano
 *   (pegar el password de 16 chars y Ctrl+D)
 * Y darle acceso al SA de Functions:
 *   gcloud secrets add-iam-policy-binding GMAIL_APP_PASSWORD \
 *     --member=serviceAccount:<sa>@app-vendedores-shimano.iam.gserviceaccount.com \
 *     --role=roles/secretmanager.secretAccessor
 */
export const onQuotationSentNotify = onDocumentWritten(
  {
    region: REGION,
    document: 'pedidos/{pedidoId}',
    retry: false,
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [GMAIL_APP_PASSWORD],
  },
  async (event) => {
    try {
      const beforeData = /** @type {any} */ (event.data?.before?.data() ?? null);
      const afterData = /** @type {any} */ (event.data?.after?.data() ?? null);
      if (!shouldNotify(beforeData, afterData)) return;

      const { subject, text, html } = buildEmailContent(event.params.pedidoId, afterData);

      // Lazy import de nodemailer para no cargarlo si el trigger no dispara.
      // @ts-expect-error — nodemailer no tiene types built-in en este proyecto
      const nodemailerMod = await import('nodemailer');
      const nodemailer = nodemailerMod.default || nodemailerMod;

      const result = await sendEmail(
        {
          nodemailer,
          gmailUser: 'bot.shimano.pesca@gmail.com',
          gmailAppPassword: GMAIL_APP_PASSWORD.value(),
          recipient: 'santiago.beron@shimano.uy',
        },
        subject,
        text,
        html
      );
      if (result.ok) {
        console.log('onQuotationSentNotify email enviado', {
          pedidoId: event.params.pedidoId,
          docNum: afterData?.transferidoSAP?.docNum,
          cliente: afterData?.clientName,
        });
      } else {
        console.error('onQuotationSentNotify FAIL email', {
          pedidoId: event.params.pedidoId,
          error: result.error,
        });
      }
    } catch (e) {
      console.error('onQuotationSentNotify error', {
        pedidoId: event.params.pedidoId,
        error: e?.message || String(e),
      });
    }
  }
);

/**
 * onStockChangeFIFOAssign — trigger on-write app_config/stock_snapshot (E4.5).
 * Cuando el sync_sap_to_firestore.py actualiza warehouseBreakdown (cada 30 min),
 * detecta SKUs con delta positivo en dep 11 y corre FIFO estricto para
 * promover lineas de pedidos-app de state='BO' a state='ASIG'.
 *
 * Modo controlado por app_config/sap_sync_state.mode (mismo flag que E2/E3):
 *   - 'shadow' (default): loguea a stock_assignment_log_shadow, NO modifica pedidos
 *   - 'active' (E5): modifica pedidos.lines[i].state='ASIG' + asigAt=now
 */
export const onStockChangeFIFOAssign = onDocumentWritten(
  {
    region: REGION,
    document: 'app_config/stock_snapshot',
    retry: false,
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const before = event.data?.before?.data() ?? null;
    const after = event.data?.after?.data() ?? null;
    if (!after) return; // delete, no-op
    const db = getFirestore();
    const r = await runFifoAssign(
      { fbDb: db, log: (msg, extra) => console.log(msg, extra || {}) },
      before,
      after
    );
    console.log('onStockChangeFIFOAssign done', {
      mode: r.mode,
      skusChecked: r.skusChecked,
      promotions: r.promotions.length,
      errors: r.errors.length,
    });
  }
);

/**
 * updateAsigLineState — callable HTTPS (E4B step 2 del plan BO/ASIG).
 * Cliente lo invoca con firebase.functions().httpsCallable('updateAsigLineState')
 * ({sourcePedidoId, sourceLineIndex, qty, action, targetPedidoId?}).
 *
 * Muta una linea state='ASIG' de un pedido-app a 'recycled' (cliente lo quiere
 * en pedido nuevo) o 'cancelled' (cliente lo libera). Transaccional.
 *
 * Auth: caller debe estar autenticado como @shimano.com.ar o @shimano.uy
 * (validacion dentro del core). Usa Admin SDK (bypass rules) porque el pedido
 * source puede ser de otro VDE.
 */
export const updateAsigLineStateCF = onCall(
  {
    region: REGION,
    cors: true,
    enforceAppCheck: false,
  },
  async (request) => {
    const db = getFirestore();
    try {
      return await updateAsigLineState(
        { fbDb: db, log: (msg, extra) => console.log(msg, extra || {}) },
        request.auth ? { uid: request.auth.uid, email: request.auth.token?.email || '' } : null,
        request.data
      );
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
        const err = /** @type {{code: string, message: string}} */ (e);
        throw new HttpsError(/** @type {any} */ (err.code), err.message);
      }
      console.error('updateAsigLineStateCF unexpected error', e);
      throw new HttpsError('internal', 'Error interno updateAsigLineState');
    }
  }
);

/**
 * geminiOcrProxy — callable HTTPS (v551 SECURITY).
 * Cliente lo invoca con
 *   firebase.app().functions('southamerica-east1').httpsCallable('geminiOcrProxy')
 *   ({imageBase64, mimeType}).
 *
 * Motivo del cambio: hasta v550 el frontend leia la API key de Gemini
 * desde app_config/gemini y fetcheaba directo a
 * generativelanguage.googleapis.com. Cualquier @shimano user con
 * DevTools podia exfiltrar la key. v551 mueve la key a Secret Manager
 * y proxeya la llamada.
 *
 * Auth: caller debe estar autenticado como @shimano.com.ar o @shimano.uy
 * (validacion dentro del core). Cualquier reader vale — VDEs necesitan
 * OCRizar tickets como parte del flujo de rendiciones.
 *
 * Memory 512MiB + timeout 60s: Gemini 2.5 flash suele responder <10s
 * en imagenes de ticket estandar (~1-2 MB base64). El default de
 * onCall (256MiB, 60s) tambien alcanza pero subimos memory por si el
 * JSON.parse del response con imagenes grandes pica.
 */
export const geminiOcrProxy = onCall(
  {
    region: REGION,
    secrets: [GEMINI_API_KEY],
    cors: true,
    enforceAppCheck: false,
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    try {
      return await runGeminiOcr(
        {
          fetch: globalThis.fetch,
          apiKey: GEMINI_API_KEY.value(),
          log: (msg, extra) => console.log(msg, extra || {}),
        },
        request.auth ? { uid: request.auth.uid, email: request.auth.token?.email || '' } : null,
        request.data
      );
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
        const err = /** @type {{code: string, message: string}} */ (e);
        throw new HttpsError(/** @type {any} */ (err.code), err.message);
      }
      console.error('geminiOcrProxy unexpected error', e);
      throw new HttpsError('internal', 'Error interno geminiOcrProxy');
    }
  }
);

/**
 * expireAsigLinesTTL — cron diario 03:00 America/Argentina/Buenos_Aires (E7).
 * Libera lineas state='ASIG' con asigAt > 30 dias. Mueve a state='expired',
 * qtyExpired += qty, qtyOpen = 0. Cierra pedido si quedan todas las lineas
 * en 0. Escribe audit doc en `asig_ttl_log/{isoTimestamp}`.
 *
 * Efecto sistema: E3 dispara automatico por los pedido writes; stock queda
 * liberado y proximo tick E4.5 puede reasignar a otros clientes en FIFO.
 */
export const expireAsigLinesTTLCF = onSchedule(
  {
    region: REGION,
    schedule: '0 3 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    retryCount: 1,
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const db = getFirestore();
    const r = await expireAsigLinesTTL({
      fbDb: db,
      log: (msg, extra) => console.log(msg, extra || {}),
    });
    console.log('expireAsigLinesTTLCF summary', {
      pedidosScanned: r.pedidosScanned,
      linesExpired: r.expiredLines.length,
      pedidosClosed: r.pedidosClosed,
      errors: r.errors.length,
    });
  }
);

// v616 (2026-08-25): Panel de Control iter 5 — health check pasivo SAP SL.
// Pinguea /Login cada 5 min + mide latencia. Escribe app_config/sap_sl_health.
export const checkSapSlHealthCF = onSchedule(
  {
    region: REGION,
    schedule: 'every 5 minutes',
    secrets: [SAP_SL_PASSWORD],
    retryCount: 0,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    const db = getFirestore();
    const sapCfgSnap = await db.doc('app_config/sap_integration').get();
    const sapCfg = sapCfgSnap.data() || {};
    const sl = sapCfg.serviceLayer || {};
    if (!sl.url || !sl.companyDB) {
      console.warn('checkSapSlHealthCF skip: sap_integration.serviceLayer no configurado');
      return;
    }
    try {
      await runSapSlHealthCheck({
        fbDb: db,
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
      // No hacer throw: si el health check falla, el propio error queda escrito
      // en el doc por runSapSlHealthCheck. Un throw solo llenaria CF errors log
      // sin agregar valor.
      console.warn('checkSapSlHealthCF unexpected error:', e);
    }
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
