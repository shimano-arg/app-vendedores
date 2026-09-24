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
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import nodemailer from 'nodemailer';
// @google-cloud/firestore es pesado (~50 MB con gRPC/protobuf) y solo se
// usa dentro de dailyFirestoreBackup para instanciar FirestoreAdminClient.
// Cargarlo top-level exhausta el timeout de 10s del "backend spec analysis"
// del deploy de Firebase Functions. Lazy dynamic import inside la function.
import { updateAsigLineState } from './core/asig-recycle-core.js';
// v750 (2026-08-31): tracking de transiciones ASIG para analytics mes-a-mes.
import { detectAsigTransitions, writeTransitionsBatch } from './core/asig-transitions-core.js';
import { expireAsigLinesTTL } from './core/asig-ttl-core.js';
// v818 (2026-09-07): auto-envio pedidos confirmed a SAP via CF trigger. Elimina
// dependencia del auto-send client-side (que solo corria en sesion admin/gerente
// con SL activo). Fix bug reportado por Mariano: pedidos VDE confirmed quedaban
// invisibles a SAP hasta que admin abria la app.
// v921 (2026-09-14): auto-confirm pedidos estancados en pending > 10 min.
// Idea Mariano: VDEs olvidan clickear "CONFIRMAR DEFINITIVO", los pedidos
// quedan sin llegar a SAP. Este core scanea + promueve stage='confirmed';
// el trigger onPedidoConfirmedSendToSap ya hace el envio SAP real.
import { autoConfirmPendingPedidos } from './core/auto-confirm-pending-core.js';
import { AUTO_SEND_RESULT, handleAutoSendSap } from './core/auto-send-sap-core.js';
import { runDailyBackup } from './core/backup-core.js';
// v1056 (2026-09-24): denormaliza attrs comerciales de la última visita al doc
// del cliente en client_master. Última visita gana (LWW por fecha).
import { denormVisitToClientMaster } from './core/denorm-visit-to-client-master-core.js';
import { runFifoAssign } from './core/fifo-assign-core.js';
import { runGeminiOcr } from './core/gemini-ocr-core.js';
import { syncSapInvoices } from './core/invoice-sync-core.js';
// v774 (2026-09-02): notif email al enviar oferta a SAP (pedido Mariano).
import { buildEmailContent, sendEmail, shouldNotify } from './core/notify-quotation-sent-core.js';
import { extractAffectedSkus, recalcSnapshotForSkus } from './core/pedido-snapshot-core.js';
import { handleResendPlannerEmail } from './core/planner-resend-email-core.js';
// v1005 (2026-09-22): Planner Kanban — trigger email on column transition.
import { handlePlannerStageChanged } from './core/planner-stage-change-core.js';
// v939 (SecAudit Sprint 2 MED-15 VULN-L004+L015): rate limit para sapProxy
// + geminiOcrProxy. Contador atomico en Firestore rate_limits/{uid}.
import { checkAndIncrementRateLimit, RATE_LIMITS } from './core/rate-limit-core.js';
import { checkNewRendicionDuplicate } from './core/rendicion-duplicate-core.js';
import { handleSapProxy } from './core/sap-proxy-core.js';
import { sapGet, sapLogin, sapLogout, sapPost } from './core/sap-sl-client.js';
import { runSapSlHealthCheck } from './core/sap-sl-health-core.js';
// v964 (2026-09-17): auto-cancel SQ expiradas (Fase B shadow + Fase C active).
import { runSqCancelExpired } from './core/sq-cancel-core.js';
import { syncSapOrders } from './core/sync-sap-orders-core.js';
import { handleSyncSapPayments } from './core/sync-sap-payments-core.js';
// v1053 (2026-09-24): detección SQs cerradas manualmente en SAP (Close Document).
import { syncSapQuotationClosures } from './core/sync-sap-quotation-closures-core.js';

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
// v829 (2026-09-08): password de SETUP WMS API para consultar estado de
// pedidos (movimientos de salida). Confirmado por Marcos (SETUP) 2026-09-08:
// mismo user sirve para prod (nur-integra) y sandbox (nur-prueba).
// v937 (2026-09-14, SecAudit Sprint 2 MED-12 VULN-301+711): redactado el
// valor literal de user/password que estaba en este comment. El secret
// vive en GCP Secret Manager (SETUP_API_PASSWORD) y se lee via
// SETUP_API_PASSWORD.value() dentro del CF setupGetMovimientos. El
// user "nur" era un secret weak (4 digitos) leaked en el codigo fuente
// del repo publico - cambiar a un password fuerte requiere coordinacion
// con SETUP/Marcos + rotar en Secret Manager. TODO Sprint 3.
// Ver setupGetMovimientos abajo + probe scripts en
// Desktop\SETUP-INTEGRACION\ para diagnostico empirico de la API.
const SETUP_API_PASSWORD = defineSecret('SETUP_API_PASSWORD');
// v830 (2026-09-08): cache in-memory del mapa {codigo_producto: 'B'|'F'} para
// clasificar cada movimiento por division sin re-consultar /GetProductos en
// cada request. Firebase Functions v2 mantiene la instancia warm ~15 min ->
// primer request tarda ~3s (fetch 10k productos), subsecuentes tardan ~1s.
// TTL 30 min por si SETUP agrega productos nuevos.
/** @type {Record<string, 'B'|'F'|'?'> | null} */
let setupProductosCache = null;
let setupProductosCacheAt = 0;
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
    // v990 (2026-09-18, SecAudit run-1 HIGH #4): enforceAppCheck true.
    // v1003 (2026-09-21): rollback hotfix directo a false (no comprometido).
    // v1058 (2026-09-24): commit del rollback. Redeploys posteriores a v1003
    // reintrodujeron true → hoy 24/9 Pablo reportó "callable(functions/
    // unauthenticated)" al enviar ORDEN 228 desde Lista de Espera. 3 días
    // desde v1003 debería haber propagado el AppCheck pero sigue devolviendo
    // 401. Volver a false hasta que se investigue con tiempo la propagación
    // real de la registration reCAPTCHA v3 (ver reference_appcheck_throttle_24h
    // y feedback_appcheck_gcloud_diagnostic).
    enforceAppCheck: false,
  },
  async (request) => {
    const db = getFirestore();
    // v939 (SecAudit MED-15): rate limit ANTES de leer sapConfig/hacer login.
    // Un token comprometido no debe poder burnear reads de app_config ni
    // gastar SL sessions haciendo login+logout en loop.
    if (request.auth) {
      const rl = await checkAndIncrementRateLimit(
        { fbDb: db, log: (m, e) => console.log(m, e || {}) },
        request.auth.uid,
        'sapProxy',
        RATE_LIMITS.sapProxy.threshold,
        RATE_LIMITS.sapProxy.windowMs
      );
      if (!rl.allowed) {
        throw new HttpsError(
          'resource-exhausted',
          `sapProxy rate limit alcanzado (${rl.threshold}/hr). Reset: ${rl.resetAt}`
        );
      }
    }
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
 * v1015 (2026-09-22): syncSapOrdersToApp — scheduled cada 60 min.
 * Cierra la columna "Pendiente de facturar" del Planner Kanban que estaba en 0
 * porque nadie escribia `transferidoSAP.orderDocEntry` en Firestore.
 *
 * v1028 (2026-09-22): schedule cambiado de 60min a 15min (match con
 * syncSapInvoicesToApp). Reporte Mariano: la latencia hasta 60min entre
 * "genero SO en SAP" y "aparece en el Planner" era demasiada para operar.
 *
 * Flujo:
 * 1. Lista pedidos con SQ en SAP (docEntry seteado) sin orderDocEntry aun.
 * 2. Enum /Orders desc paginado ($skip=0..500) y matchea via BaseType=23 + BaseEntry.
 * 3. Si hit -> update `transferidoSAP.orderDocEntry` + `orderSyncedAt`.
 *
 * Idempotente. Costo: 1 loop de ~25 GETs por corrida (500/20 default page).
 * NO tiene modo shadow — es un enrichment de campo nuevo, no reemplaza dato existente.
 */
export const syncSapOrdersToApp = onSchedule(
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
      console.warn('syncSapOrdersToApp: sap_integration.serviceLayer incompleto, skip');
      return;
    }
    const result = await syncSapOrders({
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
    console.log('syncSapOrdersToApp summary', result);
  }
);

/**
 * v1035 (2026-09-22): syncSapPaymentsToApp — scheduled cada 15 min.
 * Cierra la columna "Cobrado" del Planner Kanban que estaba vacía porque
 * nadie escribia `paidAmount` / `paidStatus` en Firestore.
 *
 * Flujo:
 * 1. Lista pedidos abiertos con `sapLinkage.appliedInvoiceDocEntries` no vacío.
 * 2. Enum `/Invoices desc` paginado ($skip=0..500) leyendo DocTotal + PaidToDate.
 * 3. Para cada pedido, suma invoicedAmount + paidAmount y calcula paidStatus.
 * 4. Escribe `pedidos/{id}` con { paidAmount, invoicedAmount, paidStatus }.
 *
 * paidStatus='paid' hace que `computeColumn` mueva el pedido a Cobrado
 * automatico. Ademas `invoicedAmount` fixea el error residual 9.8% de v1033.
 *
 * Idempotente. Costo: ~25 GETs por corrida (500 invoices / 20 default page).
 * NO tiene modo shadow — enrichment de fields nuevos, safe para deploy directo.
 */
export const syncSapPaymentsToApp = onSchedule(
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
      console.warn('syncSapPaymentsToApp: sap_integration.serviceLayer incompleto, skip');
      return;
    }
    const result = await handleSyncSapPayments({
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
    console.log('syncSapPaymentsToApp summary', result);
  }
);

/**
 * v1053 (2026-09-24): syncSapQuotationClosuresToApp — scheduled cada 15 min.
 * Cierra pedidos-app cuyas SQs fueron cerradas manualmente en SAP (Close
 * Document, sin cancel ni conversion). Antes de v1053, esos pedidos quedaban
 * pineados en la columna "Oferta" del Planner Kanban indefinidamente porque
 * `syncSapOrdersToApp` solo detecta conversión SQ→SO (BaseType=23), no cierre
 * manual.
 *
 * Precedente: 2026-09-23 Mariano reportó 4 casos (SQs 2000123 Peralta, 2000155
 * Fatechi, 2000220/2000221 Desiata). Fix manual con
 * scripts/close-manual-sap-sqs-2026-09-23.cjs. Este CF automatiza la detección.
 *
 * Idempotente. Costo: ~100 GETs/corrida (LOOKAHEAD=2000, page 20 default).
 * FAIL-SAFE: solo cierra pedidos SIN orderDocEntry, SIN qtyInvoiced, SIN
 * paidStatus (=nunca facturamos algo que ya avanzó). Ver core para detalles.
 */
export const syncSapQuotationClosuresToApp = onSchedule(
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
      console.warn('syncSapQuotationClosuresToApp: sap_integration.serviceLayer incompleto, skip');
      return;
    }
    const result = await syncSapQuotationClosures({
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
    console.log('syncSapQuotationClosuresToApp summary', result);
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
 * v818 (2026-09-07): auto-envio de pedidos confirmed a SAP.
 *
 * Firestore trigger sobre pedidos/{pedidoId}. Detecta transiciones a
 * stage='confirmed' sin transferidoSAP y las envia como Sales Quotation
 * via Service Layer. Server-side, corre 24/7 — no depende de sesion admin.
 *
 * Guards + idempotencia:
 * - isEligibleForAutoSend: transicion real a confirmed (before.stage != confirmed).
 * - Lock cross-session TTL 300s (evita doble-envio con el auto-send client-side).
 * - Doble-check transferidoSAP en transaccion post-createQuotation.
 *
 * Config runtime:
 * - Region: southamerica-east1 (mismo que SAP proxy).
 * - Memory 512 MiB: SL login+POST+logout con parsing JSON.
 * - Timeout 120s: SL response puede tardar 30-60s con network variance.
 * - retry: false (single attempt). Errores permanentes (400 SAP business
 *   logic) no deben retry-storm. Errores transitorios (SL 500, timeout) los
 *   maneja el auto-send client-side de fallback cuando admin abre la app.
 * - secrets: [SAP_SL_PASSWORD] — mismo secret que sapProxy.
 *
 * NO ejecuta si sapConfig no esta cargado en Firestore (skip silencioso).
 */
export const onPedidoConfirmedSendToSap = onDocumentWritten(
  {
    region: REGION,
    document: 'pedidos/{pedidoId}',
    retry: false,
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: [SAP_SL_PASSWORD],
  },
  async (event) => {
    const pedidoId = event.params.pedidoId;
    try {
      const beforeData = /** @type {any} */ (event.data?.before?.data() ?? null);
      const afterData = /** @type {any} */ (event.data?.after?.data() ?? null);
      if (!afterData) return; // doc deleted, nada que hacer

      // Load sap config (url, companyDB, userName). El password viene del Secret.
      const db = getFirestore();
      const sapCfgSnap = await db.doc('app_config/sap_integration').get();
      if (!sapCfgSnap.exists) {
        console.log('onPedidoConfirmedSendToSap skip: app_config/sap_integration no existe');
        return;
      }
      const sapCfgData = sapCfgSnap.data() || {};
      const sl = sapCfgData.serviceLayer || {};
      // v999 (2026-09-21) HOTFIX: fallback sl.username || sl.userName.
      // El doc Firestore app_config/sap_integration tiene el field como
      // `username` (lowercase), no `userName` (camelCase). Todas las demas
      // lecturas del sapConfig en este archivo (lineas 150, 209, 833, 875, 961)
      // usan `sl.username || sl.userName` pero esta unica no. Resultado: el
      // trigger detectaba sapConfig incompleto -> skip -> NUNCA envio pedidos
      // a SAP desde su creacion. Los pedidos igual llegaban porque el
      // client-side sap-auto-send-listener.js cubria cuando algun admin estaba
      // con la app abierta. Reporte 2026-09-21 09:31 ART: pedido MARCELO
      // BOSCHETTO fallo por Firebase Auth token expirado en el client-side;
      // trigger auto server-side habria sido el fallback pero estaba roto.
      const sapConfig = {
        url: sl.url || '',
        companyDB: sl.companyDB || '',
        userName: sl.username || sl.userName || '',
        password: SAP_SL_PASSWORD.value(),
      };
      if (!sapConfig.url || !sapConfig.companyDB || !sapConfig.userName || !sapConfig.password) {
        console.log('onPedidoConfirmedSendToSap skip: sapConfig incompleto');
        return;
      }
      // v1004 (2026-09-22): appSeriesId (DocSeries "APP") desde app_config.
      // El flow client-side (sap-service-layer.js:441) ya seteaba
      // `payload.Series = seriesId` pero el CF nunca lo pasaba -> SAP aplicaba
      // DocSeries default del user SL, que en produccion es una serie Bike
      // -> pedidos Pesca terminaban clasificados como BIKE. Bug latente v818
      // pero invisible hasta v999 que arreglo el userName y activo el CF.
      // Reporte 2026-09-22: cross-BU Pesca->Bike en SAP.
      const appSeriesIdRaw = sapCfgData.appSeriesId;
      const appSeriesId =
        appSeriesIdRaw !== undefined && appSeriesIdRaw !== null && appSeriesIdRaw !== ''
          ? parseInt(String(appSeriesIdRaw), 10)
          : null;
      // v1005 (2026-09-22): FAIL-CLOSE. Si appSeriesId no esta configurado
      // (missing/null/NaN), el CF NO manda el pedido a SAP. Sin esta guarda,
      // el CF mandaria sin Series -> SAP aplicaria default del user SL ->
      // cross-BU silencioso (bug v1004 puede reaparecer si admin borra el
      // config). El pedido queda pending con transferError visible en la
      // card de Confirmados; admin arregla config y reenvia manual via
      // batch handler "Carga a SAP".
      if (!Number.isFinite(appSeriesId)) {
        console.error('onPedidoConfirmedSendToSap SKIP: appSeriesId no configurado', {
          pedidoId,
          appSeriesIdRaw,
          cliente: afterData.clientName,
        });
        try {
          await db.doc(`pedidos/${pedidoId}`).update({
            transferError: {
              message:
                'appSeriesId no configurado en app_config/sap_integration. Config admin -> panel SAP.',
              at: new Date().toISOString(),
              via: 'cf_auto',
              attemptedBy: 'cf-auto',
            },
          });
        } catch (_) {
          /* swallow: si el pedido fue borrado o hay otro race, seguimos */
        }
        return;
      }

      // Cargar mappings sap_clients/sap_products/sap_vendors para resolvers.
      // Los VDE confirman con clientCardCode ya persistido en el pedido, asi
      // que el mapping de clientes es fallback. Products es fallback tambien
      // (auto-resolve leading zeros funciona para la mayoria).
      /** @type {Map<string, string>} */
      const sapClients = new Map();
      /** @type {Map<string, string>} */
      const sapProducts = new Map();
      /** @type {Map<string, number>} */
      const sapVendors = new Map();
      try {
        const [cliSnap, prodSnap, venSnap] = await Promise.all([
          db.collection('sap_clients').get(),
          db.collection('sap_products').get(),
          db.collection('sap_vendors').get(),
        ]);
        cliSnap.forEach((d) => {
          const data = d.data() || {};
          const nameNorm = String(data.clientName || d.id)
            .toUpperCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (nameNorm && data.cardCode) sapClients.set(nameNorm, String(data.cardCode));
        });
        prodSnap.forEach((d) => {
          const data = d.data() || {};
          if (data.appCode && data.sapItemCode)
            sapProducts.set(String(data.appCode), String(data.sapItemCode));
        });
        venSnap.forEach((d) => {
          const data = d.data() || {};
          const vendorKey = String(data.vendorKey || d.id)
            .toUpperCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const slp = Number(data.slpCode);
          if (vendorKey && Number.isFinite(slp)) sapVendors.set(vendorKey, slp);
        });
      } catch (mapErr) {
        console.warn('onPedidoConfirmedSendToSap: mapping load failed (non-blocking)', {
          err: mapErr?.message || String(mapErr),
        });
      }

      const result = await handleAutoSendSap(pedidoId, beforeData, afterData, {
        fbDb: db,
        FieldValue,
        sapClients,
        sapProducts,
        sapVendors,
        // v1004 (2026-09-22): DocSeries "APP" del config; buildQuotationPayload
        // lo pasa como payload.Series. Sin esto, SAP aplica default del user SL
        // y clasifica los SQ contra la BU equivocada (bug cross-BU 2026-09-22).
        appSeriesId,
        // v991 (SecAudit run-1 HIGH #5): fresh lookup del vendor real del owner
        // desde roles/{uid}.vendor. handleAutoSendSap lo pasa a
        // buildQuotationPayload para resolver SlpCode (en vez de confiar en
        // pedido.ownerVendor, que un VDE hostil puede spoofear via devtools).
        getUserVendor: async (uid) => {
          const snap = await db.doc(`roles/${uid}`).get();
          return (snap.data() || {}).vendor || null;
        },
        sl: {
          fetch: globalThis.fetch,
          sapConfig,
          log: (msg, extra) => console.log(msg, extra || {}),
        },
      });

      // Log estructurado del resultado.
      if (result.result === AUTO_SEND_RESULT.SENT_OK) {
        console.log('onPedidoConfirmedSendToSap OK', {
          pedidoId,
          docNum: result.docNum,
          docEntry: result.docEntry,
          cliente: afterData.clientName,
        });
      } else if (
        result.result === AUTO_SEND_RESULT.SKIP_ALREADY_SENT ||
        result.result === AUTO_SEND_RESULT.SKIP_ALL_BO ||
        result.result === AUTO_SEND_RESULT.SKIP_NO_LINES ||
        result.result === AUTO_SEND_RESULT.SKIP_NO_CARDCODE ||
        result.result === AUTO_SEND_RESULT.SKIP_LOCKED ||
        result.result === AUTO_SEND_RESULT.SKIP_STAGE
      ) {
        // Skips normales — log info para debugging pero no error.
        console.log('onPedidoConfirmedSendToSap skip', {
          pedidoId,
          result: result.result,
          reason: result.reason,
        });
      } else if (result.result === AUTO_SEND_RESULT.ERROR_RACE) {
        // Otra sesion (client-side auto-send) gano la carrera. No es error real.
        console.log('onPedidoConfirmedSendToSap race lost', {
          pedidoId,
          winnerDocNum: result.docNum,
        });
      } else {
        // ERROR_SL — algo fallo. Log error para monitoring/Sentry.
        console.error('onPedidoConfirmedSendToSap ERROR', {
          pedidoId,
          error: result.error,
          cliente: afterData.clientName,
        });
      }
    } catch (e) {
      console.error('onPedidoConfirmedSendToSap uncaught exception', {
        pedidoId,
        error: e?.message || String(e),
        stack: e?.stack?.split('\n').slice(0, 3).join('\n'),
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
    // v990 (2026-09-18, SecAudit run-1 CRITICAL #1): endurecer CF.
    // Antes: enforceAppCheck false + sin rate limit + sin role gate + sin
    // ownership check. Cualquier @shimano user (viewer, unassigned, VDE de
    // otra zona) podia spamear recycle/reject en pedidos ajenos → DoS +
    // corrupcion + auto-close forzado (closedAt set). Cambios:
    //   - enforceAppCheck: true (token reCAPTCHA v3 obligatorio).
    //   - rate limit 500/hr por user (updateAsigLineState en RATE_LIMITS).
    //   - role gate + ownership check en el core (asig-recycle-core.js:1.5+3).
    // v1058 (2026-09-24): rollback a false (sync con sapProxy — mismo incidente
    // AppCheck 401). Rate limit + role gate + ownership check siguen activos.
    enforceAppCheck: false,
  },
  async (request) => {
    const db = getFirestore();
    // Rate limit ANTES del transaction (evita gastar reads en un abuse loop).
    if (request.auth) {
      const rl = await checkAndIncrementRateLimit(
        { fbDb: db, log: (m, e) => console.log(m, e || {}) },
        request.auth.uid,
        'updateAsigLineState',
        RATE_LIMITS.updateAsigLineState.threshold,
        RATE_LIMITS.updateAsigLineState.windowMs
      );
      if (!rl.allowed) {
        throw new HttpsError(
          'resource-exhausted',
          `updateAsigLineState rate limit alcanzado (${rl.threshold}/hr). Reset: ${rl.resetAt}`
        );
      }
    }
    try {
      return await updateAsigLineState(
        {
          fbDb: db,
          log: (msg, extra) => console.log(msg, extra || {}),
          getUserRole: async (uid) => {
            const snap = await db.doc(`roles/${uid}`).get();
            return (snap.data() || {}).role || null;
          },
        },
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
    // v918 (2026-09-14, SecAudit Sprint 1 E1.2): App Check obligatorio.
    // Antes: false con TODO. Un IDToken robado via XSS/phishing/browser ext
    // era usable desde curl para burn Gemini credit ilimitado. Ahora exige
    // token App Check emitido por el browser via reCAPTCHA v3 (activado
    // post-login en index.html:21209 activateAppCheckOnce).
    // Rollout gradual — geminiOcrProxy es el primero (menos flow-critico).
    // Si empiezan a llegar reports de rendicion falla, chequear que el user
    // no tenga throttle 24h en reCAPTCHA (ver reference_appcheck_throttle_24h).
    // v1058 (2026-09-24): rollback a false (sync con sapProxy — mismo incidente
    // AppCheck 401 en Pablo). Rate limit sigue activo.
    enforceAppCheck: false,
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    // v939 (SecAudit MED-15): rate limit para geminiOcrProxy - cada request
    // consume tokens Gemini pagos. Sin limit, un token comprometido burnea
    // credit ilimitado.
    if (request.auth) {
      const rl = await checkAndIncrementRateLimit(
        { fbDb: getFirestore(), log: (m, e) => console.log(m, e || {}) },
        request.auth.uid,
        'geminiOcrProxy',
        RATE_LIMITS.geminiOcrProxy.threshold,
        RATE_LIMITS.geminiOcrProxy.windowMs
      );
      if (!rl.allowed) {
        throw new HttpsError(
          'resource-exhausted',
          `geminiOcrProxy rate limit alcanzado (${rl.threshold}/hr). Reset: ${rl.resetAt}`
        );
      }
    }
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

/**
 * v964 (2026-09-17): auto-cancel SQs con lineas confirmed >15d.
 *
 * Fase B (shadow, default): loguea qué SQs cancelaría a
 * `sq_cancel_log_shadow/{iso}`. NO ejecuta cancel en SAP ni cambia state
 * en Firestore. Se activa por deploy sin riesgo.
 *
 * Fase C (active): cambiar `app_config/sap_sync_state.sqCancelMode='active'`.
 * Cada corrida verifica cada SQ candidata en SAP (DocumentStatus + Delivery)
 * y solo cancela las que pasan las salvaguardas. Escribe a `sq_cancel_log`
 * (audit) y `sq_cancel_skipped_log` (por qué se saltearon).
 *
 * Cron diario 04:30 America/Argentina/Buenos_Aires (después del TTL ASIG a
 * las 03:00 para no colisionar).
 */
export const sqCancelExpiredCF = onSchedule(
  {
    region: REGION,
    schedule: '30 4 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    retryCount: 1,
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [SAP_SL_PASSWORD],
  },
  async () => {
    const db = getFirestore();
    // Cargar sapConfig para posible modo active (Fase C).
    const sapCfgSnap = await db.doc('app_config/sap_integration').get();
    const sapCfg = sapCfgSnap.exists ? sapCfgSnap.data() || {} : {};
    const sl = sapCfg.serviceLayer || {};
    /** @type {any} */
    let sapSession = null;
    /** @type {any} */
    let slFetchFn;
    const wantsActive = sl && sl.url && SAP_SL_PASSWORD.value();
    if (wantsActive) {
      const stateSnap = await db.doc('app_config/sap_sync_state').get();
      const sqCancelMode = String(
        ((stateSnap.exists ? stateSnap.data() : {}) || {}).sqCancelMode || ''
      ).toLowerCase();
      if (sqCancelMode === 'active') {
        try {
          const deps = {
            fetch: /** @type {any} */ (globalThis.fetch),
            sapConfig: {
              url: sl.url,
              companyDB: sl.companyDB,
              userName: sl.username || sl.userName,
              password: SAP_SL_PASSWORD.value(),
            },
            log: (/** @type {string} */ msg, /** @type {any} */ extra) =>
              console.log(msg, extra || {}),
          };
          sapSession = await sapLogin(deps);
          // Wrapper que hace GET/POST via helpers del sap-sl-client.
          slFetchFn = async (/** @type {string} */ uri, /** @type {any} */ opts) => {
            if (opts && opts.method === 'POST') {
              return await sapPost(sapSession, uri, opts.body || {}, deps);
            }
            return await sapGet(sapSession, uri, deps);
          };
        } catch (e) {
          console.error('sqCancelExpiredCF: fallo login SL, cae a shadow', e);
          slFetchFn = undefined; // sin slFetch → runSqCancelExpired se queda en shadow
        }
      }
    }

    try {
      const r = await runSqCancelExpired({
        fbDb: db,
        log: (msg, extra) => console.log(msg, extra || {}),
        slFetch: slFetchFn,
      });
      console.log('sqCancelExpiredCF summary', {
        mode: r.mode,
        pedidosScanned: r.pedidosScanned,
        cancelled: r.cancelledCount,
        skipped: r.skipped.length,
        errors: r.errors.length,
      });
    } finally {
      if (sapSession && slFetchFn) {
        try {
          await sapLogout(sapSession, {
            fetch: /** @type {any} */ (globalThis.fetch),
            sapConfig: {
              url: sl.url,
              companyDB: sl.companyDB,
              userName: sl.username || sl.userName,
              password: SAP_SL_PASSWORD.value(),
            },
            log: () => {},
          });
        } catch (e) {
          console.warn('sqCancelExpiredCF: logout SL fallo', e);
        }
      }
    }
  }
);

/**
 * v921 (2026-09-14): auto-confirmar pedidos estancados en stage='pending' > 10 min.
 *
 * Corre cada 2 min. Query pedidos stage='pending' ordenados por confirmedAt ASC
 * (limit 100). Los que cumplen `now - confirmedAt >= minutesTimeout` (default
 * 10) reciben update({stage: 'confirmed', finalizedAt, finalizedBy: 'auto/<N>min-timeout',
 * autoConfirmed: {...}}). El trigger onPedidoConfirmedSendToSap ya existente
 * (v818) detecta la transición y arma la Sales Quotation en SAP.
 *
 * Kill switch: `app_config/auto_confirm.enabled=false` en Firestore desactiva
 * el barrido. `app_config/auto_confirm.minutesTimeout=<N>` cambia el timeout.
 *
 * Notificaciones: agrega un doc `notifications/{}` type='auto_confirm_timeout'
 * dirigido al VDE dueño del pedido — el frontend lo muestra como toast + bell.
 */
export const autoConfirmPendingPedidosCF = onSchedule(
  {
    region: REGION,
    schedule: 'every 2 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
    retryCount: 0,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    const db = getFirestore();
    try {
      const r = await autoConfirmPendingPedidos({
        fbDb: db,
        FieldValue,
        log: (msg, extra) => console.log(msg, extra || {}),
      });
      console.log('autoConfirmPendingPedidosCF summary', {
        result: r.result,
        processed: r.processed,
        errors: r.errors && r.errors.length ? r.errors.length : 0,
      });
      if (r.errors && r.errors.length) {
        console.warn('autoConfirmPendingPedidosCF errors detail', r.errors);
      }
    } catch (e) {
      console.error('autoConfirmPendingPedidosCF unexpected error', e);
    }
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

/**
 * setupGetMovimientos — v829 (2026-09-08)
 *
 * Callable proxy que consulta SETUP WMS API para traer el estado logistico
 * de pedidos (endpoint /GetMovimientosSalida). Alimenta el modal "Deposito"
 * de la app vendedores que muestra "PREPARACIÓN DE PEDIDO" vs "DESPACHO"
 * por cada pedido en el deposito.
 *
 * Config:
 * - URL: https://nur-integra.setuponline.com.ar/ (prod, unico ambiente con data)
 * - Auth: POST /CreateToken con {Username: 'nur', Password: secret}
 * - Fetch: GET /GetMovimientosSalida con body JSON (requiere node:http para
 *   bypass de restriccion GET-con-body de fetch standard).
 *
 * Input (request.data):
 *   - dias: number (default 60) - ventana temporal a consultar
 *   - cardCode?: string - filtro opcional por destinatario (SAP CardCode)
 *
 * Output:
 *   - { movimientos: [...] } - array de movimientos flat con la estructura
 *     documentada en scripts de probe (id_nota_de_venta, comprobante, etc).
 *
 * Autorizacion:
 *   - Requiere request.auth (usuario logueado)
 *   - v928 (2026-09-14, SecAudit Sprint 1 E1.7 HIGH-10): domain gate
 *     @shimano.com.ar/@shimano.uy + role check contra roles/{uid}.
 *     Rechaza unassigned/viewer + roles no-Shimano. Antes: cualquier
 *     authenticated user enumeraba 365d de shipments SETUP por cualquier
 *     cardCode -> logistics data exfil + SETUP API quota burn.
 *   - v994 (2026-09-18, SecAudit run-1 HIGH #3): scope filterCardCode a
 *     caller vendor cuando role='vendedor'. Cierra el TODO Sprint 2:
 *     vendedor solo puede consultar movimientos de clientes cuyo
 *     client_master.assignedVendor matchea roles/{uid}.vendor.
 *     Admin/gerente/interno sin restriccion.
 *
 * Ver Desktop\SETUP-INTEGRACION\scripts\probe-setup-api.mjs para diagnóstico
 * empírico de la API.
 */
export const setupGetMovimientos = onCall(
  {
    region: REGION,
    secrets: [SETUP_API_PASSWORD],
    cors: true,
    enforceAppCheck: false,
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }
    // v928 (SecAudit E1.7 HIGH-10): domain gate + role check.
    const _db = getFirestore();
    const _email = String(request.auth.token?.email || '').toLowerCase();
    if (!(_email.endsWith('@shimano.com.ar') || _email.endsWith('@shimano.uy'))) {
      throw new HttpsError('permission-denied', 'Solo @shimano.com.ar o @shimano.uy');
    }
    const _roleSnap = await _db.doc(`roles/${request.auth.uid}`).get();
    const _roleData = _roleSnap.data() || {};
    const _role = _roleData.role || null;
    const _callerVendor = _roleData.vendor || null;
    if (!['admin', 'gerente', 'vendedor', 'interno'].includes(_role)) {
      throw new HttpsError(
        'permission-denied',
        `Rol ${_role} no autorizado para setupGetMovimientos`
      );
    }
    console.log('setupGetMovimientos OK gate', {
      uid: request.auth.uid,
      email: _email,
      role: _role,
      cardCode: String((request.data && request.data.cardCode) || '').trim() || null,
    });

    const SETUP_URL = 'https://nur-integra.setuponline.com.ar';
    const SETUP_USER = 'nur';
    // v835 (2026-09-08): dias hasta 365 (1 año). Timeout CF subido a 300s
    // porque SETUP tarda mucho con rangos amplios + productos cache warm-up.
    const dias = Math.min(365, Number(request.data && request.data.dias) || 60);
    const filterCardCode = String((request.data && request.data.cardCode) || '').trim();

    // v994 (2026-09-18, SecAudit run-1 HIGH #3): scope cardCode a caller
    // vendor cuando role='vendedor'. Antes: cualquier VDE podia pasar el
    // cardCode de un cliente ajeno y ver 365d de shipments SETUP → competitor
    // territory intel + patterns de compra por cliente. Admin/gerente/interno
    // mantienen acceso amplio (necesitan queries cross-vendor para
    // troubleshoot logistico).
    // Reglas para role='vendedor':
    //   1. Con cardCode: fetch client_master/{cardCode}.assignedVendor y
    //      comparar case-insensitive con _callerVendor. Mismatch -> deny.
    //      client_master doc ausente: fail closed (asumimos no autorizado).
    //   2. Sin cardCode: el modal Deposito llama sin cardCode para traer
    //      "todos los shipments recientes" (v836 flow). NO tiramos error —
    //      en su lugar, marcamos _scopeAllToVendorCartera=true y al final
    //      filtramos los movimientos server-side por client_master.assignedVendor.
    //      El vendedor solo ve shipments de clientes de su cartera.
    const _norm = (/** @type {any} */ s) =>
      String(s || '')
        .trim()
        .toUpperCase();
    let _scopeAllToVendorCartera = false;
    if (_role === 'vendedor') {
      if (!_callerVendor) {
        throw new HttpsError(
          'failed-precondition',
          'roles/{uid}.vendor no seteado — pedirle al admin que asigne vendorKey'
        );
      }
      if (filterCardCode) {
        const _cmSnap = await _db.doc(`client_master/${filterCardCode}`).get();
        const _cmData = _cmSnap.data() || {};
        const _clientVendor = _cmData.assignedVendor || null;
        if (!_clientVendor || _norm(_clientVendor) !== _norm(_callerVendor)) {
          console.warn('setupGetMovimientos DENY cardCode scope', {
            uid: request.auth.uid,
            callerVendor: _callerVendor,
            cardCode: filterCardCode,
            clientVendor: _clientVendor,
          });
          throw new HttpsError(
            'permission-denied',
            `cardCode ${filterCardCode} no pertenece a tu cartera`
          );
        }
      } else {
        _scopeAllToVendorCartera = true;
      }
    }

    // v830 (2026-09-08): cache TTL 30 min declarado a module-scope arriba
    // (setupProductosCache / setupProductosCacheAt). Reset si expiro.
    if (setupProductosCacheAt && Date.now() - setupProductosCacheAt > 30 * 60 * 1000) {
      setupProductosCache = null;
      setupProductosCacheAt = 0;
    }

    try {
      // 1) Login → Bearer token
      const rLogin = await globalThis.fetch(`${SETUP_URL}/CreateToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: SETUP_USER, Password: SETUP_API_PASSWORD.value() }),
      });
      if (!rLogin.ok) {
        const body = await rLogin.text().catch(() => '');
        throw new HttpsError(
          'internal',
          `SETUP login failed status=${rLogin.status} body=${body.slice(0, 200)}`
        );
      }
      const authBody = await rLogin.json();
      const token = authBody.Token || authBody.token || authBody.access_token;
      if (!token) {
        throw new HttpsError('internal', 'SETUP no devolvio token');
      }

      // 2) Fetch movimientos — GET con body via node:http bypass.
      // fetch nativo (undici) valida spec y rechaza body en GET. Usamos
      // Node http/https directo para pasar body con method GET.
      //
      // v838 (2026-09-08): PAGINACION POR VENTANAS SEMANALES para eludir el
      // hard-limit de 500 lineas por respuesta que impone SETUP (probado
      // empiricamente 2026-09-08 en probe-por-que-10.mjs). Ningun parametro
      // estandar de paginacion funciona (LimitCount, Offset, Page, Skip, etc.);
      // pero Fecha_desde/Fecha_hasta SI filtra correctamente. Estrategia:
      // trocear el rango pedido en ventanas de 7 dias y hacer requests en
      // paralelo. Cada semana usualmente cabe muy debajo de 500 lineas
      // (probe mostro 180 lineas en 7d recientes = ok con margen). Luego
      // dedup por (id_nota + fecha + comprobante + idproducto) al mergear.
      const https = await import('node:https');
      const { URL } = await import('node:url');
      // v865 (2026-09-11): "today" ancla en TIMEZONE AR (SETUP publica fechas
      // en calendario AR). Antes usabamos new Date() → UTC. Cuando la CF corria
      // entre 21:00-24:00 AR (00:00-03:00 UTC del dia siguiente), la ventana
      // 0 tenia `hasta = tomorrow_AR` y SETUP no devolvia nada de HOY porque
      // el filtro es inclusive-inclusive por dia calendario. Ahora `today` se
      // calcula formateado en TZ AR → matchea el dia que espera SETUP.
      // Extra bonus: logs y consumers ven la fecha AR correcta.
      const todayARStr = new Date()
        .toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
        .slice(0, 10); // YYYY-MM-DD
      // Anclamos "today" a las 12:00 UTC del mismo dia AR (evita salt de dia
      // por rounding a medianoche UTC durante las restas de 7d).
      const today = new Date(todayARStr + 'T12:00:00Z');
      const WINDOW_DIAS = 7;

      /** @type {{desde: string, hasta: string}[]} */
      const windows = [];
      for (let offset = 0; offset < dias; offset += WINDOW_DIAS) {
        const hastaD = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
        const desdeD = new Date(
          today.getTime() - Math.min(offset + WINDOW_DIAS, dias) * 24 * 60 * 60 * 1000
        );
        windows.push({
          desde: desdeD.toISOString().slice(0, 10),
          hasta: hastaD.toISOString().slice(0, 10),
        });
      }
      console.log(
        `setupGetMovimientos: dias=${dias} → ${windows.length} ventanas semanales (today AR=${todayARStr})`
      );

      const u = new URL(`${SETUP_URL}/GetMovimientosSalida`);

      /**
       * Fetch una ventana. Devuelve el array de lineas o null en caso de error
       * transitorio (para no bloquear las otras ventanas).
       * @param {{desde: string, hasta: string}} w
       * @returns {Promise<any[]>}
       */
      async function fetchWindow(w) {
        const filtros = {
          ID_Nota_de_venta: '',
          ID_Cliente: '',
          ID_Destinatario: filterCardCode,
          Codigo_deposito: 1,
          Fecha_desde: w.desde,
          Fecha_hasta: w.hasta,
        };
        const bodyStr = JSON.stringify(filtros);
        try {
          /** @type {{status: number, body: string}} */
          const resp = await new Promise((resolve, reject) => {
            const req = https.request(
              {
                hostname: u.hostname,
                port: u.port || 443,
                path: u.pathname,
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(bodyStr),
                  Authorization: `Bearer ${token}`,
                },
              },
              (r) => {
                /** @type {Buffer[]} */
                const chunks = [];
                r.on('data', (/** @type {Buffer} */ c) => chunks.push(c));
                r.on('end', () =>
                  resolve({
                    status: r.statusCode || 0,
                    body: Buffer.concat(chunks).toString('utf-8'),
                  })
                );
              }
            );
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
          });
          if (resp.status !== 200) {
            console.warn(
              `setupGetMovimientos: ventana ${w.desde}→${w.hasta} status=${resp.status} body=${resp.body.slice(0, 120)}`
            );
            return [];
          }
          const parsed = JSON.parse(resp.body);
          const data = parsed.VFPData;
          if (!data) {
            console.log(`setupGetMovimientos: ventana ${w.desde}→${w.hasta} sin VFPData en body`);
            return [];
          }
          const arrKey = Object.keys(data).find((k) => Array.isArray(data[k]));
          const rows = arrKey ? data[arrKey] : [];
          console.log(`setupGetMovimientos: ventana ${w.desde}→${w.hasta} → ${rows.length} lineas`);
          return rows;
        } catch (err) {
          console.warn(
            `setupGetMovimientos: ventana ${w.desde}→${w.hasta} error=${err && err.message}`
          );
          return [];
        }
      }

      // Fetch en paralelo (12 semanas × ~2s c/u ≈ 3s wall-clock con paralelismo).
      const perWindow = await Promise.all(windows.map(fetchWindow));

      // Dedup por composite key. Ventanas adyacentes pueden solapar en el borde
      // (Fecha_desde/hasta inclusivos ambos), asi que una misma linea podria
      // aparecer 2 veces. Key = id_nota + fecha + comprobante + idproducto +
      // cantidad para minimizar colisiones falsas.
      const seen = new Set();
      /** @type {any[]} */
      const arr = [];
      let dupsCount = 0;
      for (const lines of perWindow) {
        for (const m of lines) {
          const key = `${m.id_nota_de_venta}|${m.fecha}|${m.comprobante}|${m.idproducto}|${m.cantidad}`;
          if (seen.has(key)) {
            dupsCount++;
            continue;
          }
          seen.add(key);
          arr.push(m);
        }
      }
      console.log(
        `setupGetMovimientos: total ${arr.length} lineas post-dedup (dedup=${dupsCount} dup)`
      );

      if (arr.length === 0) {
        return { movimientos: [], notasCount: 0 };
      }

      // 4) v830 (2026-09-08): fetch /GetProductos si no esta en cache.
      // SETUP tipa cada producto con tipo_mercaderia: 1=Fishing, 2=Bike.
      // Necesario para clasificar cada nota como BIKE/FISHING/MIXTO.
      if (!setupProductosCache) {
        console.log('setupGetMovimientos: cargando cache productos desde SETUP');
        const rProds = await new Promise((resolve, reject) => {
          const uProds = new URL(`${SETUP_URL}/GetProductos`);
          const req = https.request(
            {
              hostname: uProds.hostname,
              port: uProds.port || 443,
              path: uProds.pathname,
              method: 'GET',
              headers: { Authorization: `Bearer ${token}` },
            },
            (r) => {
              /** @type {Buffer[]} */
              const chunks = [];
              r.on('data', (/** @type {Buffer} */ c) => chunks.push(c));
              r.on('end', () =>
                resolve({
                  status: r.statusCode || 0,
                  body: Buffer.concat(chunks).toString('utf-8'),
                })
              );
            }
          );
          req.on('error', reject);
          req.end();
        });
        if (rProds.status === 200) {
          const pParsed = JSON.parse(rProds.body);
          const pData = pParsed.VFPData;
          const pKey = pData && Object.keys(pData).find((k) => Array.isArray(pData[k]));
          const productos = pKey ? pData[pKey] : [];
          /** @type {Record<string, 'B'|'F'|'?'>} */
          const map = {};
          for (const p of productos) {
            const t = String(p.tipo_mercaderia || '');
            map[p.codigo_producto] = t === '2' ? 'B' : t === '1' ? 'F' : '?';
          }
          setupProductosCache = map;
          setupProductosCacheAt = Date.now();
          console.log(`setupGetMovimientos: cache productos ${productos.length} items`);
        } else {
          console.warn(
            `setupGetMovimientos: /GetProductos fallo status=${rProds.status}, sin clasificacion division`
          );
          setupProductosCache = {};
        }
      }
      const prodMap = setupProductosCache || {};

      // 5) Agregar por id_nota_de_venta — 1 fila = 1 nota (con contadores).
      // Rastreamos cuantos productos son BIKE vs FISHING para asignar division.
      // v837 (2026-09-08): FIX — antes se guardaba el PRIMER comprobante visto,
      // perdiendo el estado DESPACHO cuando una nota tiene tanto PREPARACION
      // como DESPACHO (pedido armado + despachado). Ahora trackeamos ambos y
      // priorizamos DESPACHO como estado final. Tambien la fecha se toma
      // como el MAX de todas las lineas (fecha del ultimo evento).
      const byNota = new Map();
      for (const m of arr) {
        const k = m.id_nota_de_venta || '(sin-nota)';
        if (!byNota.has(k)) {
          byNota.set(k, {
            id_nota_de_venta: k,
            fecha: m.fecha,
            fecha_desde: m.fecha,
            cliente: m.cliente,
            destinatario: m.destinatario,
            iddestinatario: m.iddestinatario,
            deposito: m.deposito,
            zona: m.zona,
            ubicacion: m.ubicacion,
            items_count: 0,
            cantidad_total: 0,
            _bikeCount: 0,
            _fishingCount: 0,
            _unknownCount: 0,
            _hasPreparacion: false,
            _hasDespacho: false,
            _hasOtro: null,
          });
        }
        const acc = byNota.get(k);
        acc.items_count += 1;
        acc.cantidad_total += Number(m.cantidad || 0);
        const tipo = prodMap[m.idproducto] || '?';
        if (tipo === 'B') acc._bikeCount++;
        else if (tipo === 'F') acc._fishingCount++;
        else acc._unknownCount++;
        // Track comprobante flags
        const comp = String(m.comprobante || '').toUpperCase();
        if (comp === 'DESPACHO') acc._hasDespacho = true;
        else if (comp === 'PREPARACIÓN DE PEDIDO' || comp === 'PREPARACION DE PEDIDO')
          acc._hasPreparacion = true;
        else if (comp) acc._hasOtro = m.comprobante;
        // Fecha = max de todas las lineas (mas reciente)
        if (m.fecha && (!acc.fecha || String(m.fecha) > String(acc.fecha))) {
          acc.fecha = m.fecha;
        }
        if (m.fecha && (!acc.fecha_desde || String(m.fecha) < String(acc.fecha_desde))) {
          acc.fecha_desde = m.fecha;
        }
      }

      // 6) Asignar division consolidada por nota + limpiar campos internos.
      // v837: comprobante final = DESPACHO si la nota tuvo evento DESPACHO
      // (estado final), sino PREPARACION DE PEDIDO, sino el "otro" observado.
      const movimientos = Array.from(byNota.values())
        .map((n) => {
          let division = 'DESCONOCIDO';
          if (n._bikeCount > 0 && n._fishingCount === 0) division = 'BIKE';
          else if (n._fishingCount > 0 && n._bikeCount === 0) division = 'FISHING';
          else if (n._bikeCount > 0 && n._fishingCount > 0) division = 'MIXTO';
          let comprobanteFinal;
          if (n._hasDespacho) comprobanteFinal = 'DESPACHO';
          else if (n._hasPreparacion) comprobanteFinal = 'PREPARACIÓN DE PEDIDO';
          else comprobanteFinal = n._hasOtro || '';
          return {
            id_nota_de_venta: n.id_nota_de_venta,
            fecha: n.fecha,
            fecha_desde: n.fecha_desde,
            comprobante: comprobanteFinal,
            cliente: n.cliente,
            destinatario: n.destinatario,
            iddestinatario: n.iddestinatario,
            deposito: n.deposito,
            zona: n.zona,
            ubicacion: n.ubicacion,
            items_count: n.items_count,
            cantidad_total: n.cantidad_total,
            division,
            bike_items: n._bikeCount,
            fishing_items: n._fishingCount,
            unknown_items: n._unknownCount,
            has_preparacion: n._hasPreparacion,
            has_despacho: n._hasDespacho,
          };
        })
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

      // v994 (SecAudit run-1 HIGH #3): si el caller es vendedor sin cardCode
      // explicito, filtrar server-side por su cartera antes de retornar. Sin
      // este filtro el vendedor seguiria viendo TODOS los shipments de todos
      // los clientes (bug exfil de v829-v993). Query batch a client_master
      // por los cardCodes unicos de la respuesta SETUP, indexar por
      // assignedVendor, y matchear.
      let _finalMovimientos = movimientos;
      if (_scopeAllToVendorCartera) {
        const _cardCodes = Array.from(
          new Set(movimientos.map((m) => String(m.destinatario || '').trim()).filter(Boolean))
        );
        // Firestore no permite `in` con >30 items — chunkear (o all-fetch si
        // son pocos). Total cardCodes tipicos por ventana 60d ~50-200.
        /** @type {Map<string, string>} */
        const _vendorByCardCode = new Map();
        const CHUNK = 30;
        for (let i = 0; i < _cardCodes.length; i += CHUNK) {
          const chunk = _cardCodes.slice(i, i + CHUNK);
          const _qs = await _db.collection('client_master').where('__name__', 'in', chunk).get();
          _qs.forEach((/** @type {any} */ d) => {
            const av = (d.data() || {}).assignedVendor;
            if (av) _vendorByCardCode.set(d.id, _norm(av));
          });
        }
        const _callerVendorNorm = _norm(_callerVendor);
        const _preFilterCount = movimientos.length;
        _finalMovimientos = movimientos.filter((m) => {
          const cc = String(m.destinatario || '').trim();
          if (!cc) return false;
          const av = _vendorByCardCode.get(cc);
          return av === _callerVendorNorm;
        });
        console.log(
          `setupGetMovimientos: vendor scope filter ${_preFilterCount} → ${_finalMovimientos.length} notas (callerVendor=${_callerVendor})`
        );
      }

      // v865 (2026-09-11): log de max fecha para detectar "SETUP dejo de publicar".
      // Si Mariano ve la app sin data nueva, este log confirma si SETUP mismo
      // esta stale (max fecha vieja) o si el problema es cache/render client-side.
      const maxFecha =
        _finalMovimientos.length > 0 ? String(_finalMovimientos[0].fecha || '').slice(0, 10) : null;
      const minFecha =
        _finalMovimientos.length > 0
          ? String(_finalMovimientos[_finalMovimientos.length - 1].fecha || '').slice(0, 10)
          : null;
      const totalDespachos = _finalMovimientos.filter((m) => m.comprobante === 'DESPACHO').length;
      console.log(
        `setupGetMovimientos: retornando ${_finalMovimientos.length} notas (${totalDespachos} despachos) desde=${minFecha} hasta=${maxFecha}`
      );

      return {
        movimientos: _finalMovimientos,
        notasCount: _finalMovimientos.length,
        lineasTotales: arr.length,
        maxFecha,
        minFecha,
        fetchedAtIso: new Date().toISOString(),
      };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('setupGetMovimientos unexpected error', e);
      throw new HttpsError('internal', String(e && e.message ? e.message : e));
    }
  }
);

/**
 * onRendicionCreatedCheckDuplicate — trigger onCreate en rendiciones/{id}.
 *
 * Contexto: audit agosto/septiembre 2026 detecto pagos duplicados por la
 * misma boleta ($28.600 de mas en un mes). Root cause: la unica barrera
 * era el ojo del aprobador. Este trigger corre server-side (no bypasseable
 * desde el cliente) y marca la rendicion como 'duplicado_detectado' si
 * detecta match FUERTE contra una rendicion approved/pending del mismo
 * owner en los ultimos 90 dias.
 *
 * Logica core: functions/core/rendicion-duplicate-core.js (testeable con
 * mocks Firestore, no requiere emulador).
 *
 * Feature flag: app_config/rendiciones_config.antiDuplicadoEnabled (default
 * true si el doc no existe). Cuando OFF, el trigger solo popula el campo
 * ticketNormalizado (para no perder datos), pero NO bloquea. Permite apagar
 * el bloqueo desde Firestore Console sin redeploy.
 */
export const onRendicionCreatedCheckDuplicate = onDocumentCreated(
  {
    region: REGION,
    document: 'rendiciones/{docId}',
    retry: false,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const db = getFirestore();
    try {
      const result = await checkNewRendicionDuplicate(event.params.docId, data, {
        db,
        FieldValue,
        log: (msg, extra) => console.log(msg, extra || {}),
        isEnabled: async () => {
          try {
            const snap = await db.doc('app_config/rendiciones_config').get();
            if (!snap.exists) return true; // default enabled si no hay config
            const d = snap.data() || {};
            return d.antiDuplicadoEnabled !== false; // solo false explicito lo apaga
          } catch (_e) {
            return true; // en duda, enabled
          }
        },
      });
      console.log('[antidup] result', { docId: event.params.docId, ...result });
    } catch (e) {
      console.error('[antidup] error', e);
      // NO re-throw: retry:false + no queremos que fallos aca frenen el flow.
    }
  }
);

/**
 * onVisitCreatedDenormToClientMaster — v1056 (2026-09-24).
 * Trigger onCreate en visits/{id}. Copia los atributos comerciales de la
 * visita (fidelidad, tamanos[], especializaciones[], canalCompra, tipoVenta +
 * ponderaciones) al doc `client_master.{docId}` como subobjeto `lastVisit`.
 *
 * Motivación: pedido Mariano 2026-09-24 — hoy esos campos solo viven en cada
 * doc de `visits` (append-only). La app y PowerBI necesitan leer el "estado
 * actual" de un cliente (última fidelidad, último tipo, etc.) sin agregar
 * visits en cada query. Este trigger denormaliza al doc del cliente con
 * regla "última visita gana" (LWW por `visit.fecha`).
 *
 * Guard temporal LWW: si la visita nueva tiene fecha anterior al lastVisit
 * ya guardado, skip. Cubre backfill fuera de orden y retries del runtime.
 *
 * Core testeable: functions/core/denorm-visit-to-client-master-core.js
 */
export const onVisitCreatedDenormToClientMaster = onDocumentCreated(
  {
    region: REGION,
    document: 'visits/{visitId}',
    retry: false,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const visit = event.data?.data();
    if (!visit) return;
    const db = getFirestore();
    try {
      const result = await denormVisitToClientMaster(
        { visit, visitId: event.params.visitId },
        { db, FieldValue, log: (msg, extra) => console.log(msg, extra || {}) }
      );
      console.log('[denorm-visit] result', { visitId: event.params.visitId, ...result });
    } catch (e) {
      console.error('[denorm-visit] error', e);
      // NO re-throw: retry:false + no queremos que fallos aca frenen el flow
      // de visitas (que sigue funcionando con lectura directa de la colección).
    }
  }
);

// v1005 (2026-09-22): Planner Kanban section — trigger email on column transition.
// Idempotencia via pedido.plannerEmails.{column}.sentAt.
// Deploy pending human approval — see Task 5 of Planner Kanban plan.
export const onPlannerStageChanged = onDocumentWritten(
  {
    document: 'pedidos/{id}',
    region: REGION,
    secrets: [GMAIL_APP_PASSWORD],
  },
  async (event) => {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'bot.shimano.pesca@gmail.com',
        pass: GMAIL_APP_PASSWORD.value(),
      },
    });

    try {
      return await handlePlannerStageChanged(event, {
        db: getFirestore(),
        transporter,
        log: console,
        now: () => new Date(),
      });
    } catch (err) {
      console.error('onPlannerStageChanged failed:', err);
      // NEVER throw — retries would duplicate emails when the send actually succeeded.
      return { skipped: 'error', error: err?.message };
    }
  }
);

// v1005 (2026-09-22): Callable to re-send Planner column-entry email.
// Mariano only. Clears plannerEmails.{col}.sentAt so the stage handler re-fires.
// Deploy pending human approval.
export const resendPlannerEmail = onCall(
  { region: REGION, secrets: [GMAIL_APP_PASSWORD] },
  async (request) => {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: 'bot.shimano.pesca@gmail.com', pass: GMAIL_APP_PASSWORD.value() },
    });
    const db = getFirestore();
    try {
      return await handleResendPlannerEmail(request.data, request.auth ?? null, {
        db,
        stageHandler: (event) =>
          handlePlannerStageChanged(event, {
            db,
            transporter,
            log: console,
            now: () => new Date(),
          }),
        log: console,
      });
    } catch (err) {
      if (err?.code && err?.message) {
        throw new HttpsError(err.code, err.message);
      }
      throw new HttpsError('internal', 'Resend failed', { detail: err?.message });
    }
  }
);

/**
 * v1050 (2026-09-23): triggerPlannerSync — callable para forzar manualmente
 * las 3 syncs SAP → Firestore que alimentan el Planner Kanban (Invoices +
 * Orders + Payments). Pedido Mariano: cuando genera una SO/factura/cobranza
 * en SAP no quiere esperar hasta 15min al próximo tick del schedule.
 *
 * Gate: admin | gerente | interno (mismos roles que ven el Planner completo).
 * Ejecuta las 3 syncs EN SERIE (no paralelo — cada una hace su propio SL
 * login/logout, y la SL company tiene throttling para sesiones concurrentes).
 * Retorna summary de cada una.
 */
export const triggerPlannerSync = onCall(
  {
    region: REGION,
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [SAP_SL_PASSWORD],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Login requerido');
    }
    const db = getFirestore();
    const roleSnap = await db.doc(`roles/${request.auth.uid}`).get();
    const role = (roleSnap.data() || {}).role || null;
    if (!['admin', 'gerente', 'interno'].includes(role)) {
      throw new HttpsError('permission-denied', `Rol ${role || 'sin rol'} no puede forzar sync`);
    }
    const sapCfgSnap = await db.doc('app_config/sap_integration').get();
    const sapCfg = sapCfgSnap.data() || {};
    const sl = sapCfg.serviceLayer || {};
    if (!sl.url || !sl.companyDB) {
      throw new HttpsError('failed-precondition', 'sap_integration.serviceLayer incompleto');
    }
    const deps = {
      fetch: globalThis.fetch,
      sapConfig: {
        url: sl.url,
        companyDB: sl.companyDB,
        userName: sl.username || sl.userName,
        password: SAP_SL_PASSWORD.value(),
      },
      fbDb: db,
      log: (/** @type {string} */ msg, /** @type {Record<string, unknown>} */ extra) =>
        console.log('[triggerPlannerSync]', msg, extra || {}),
    };
    /** @type {{invoices: any, orders: any, payments: any, closures: any, errors: Array<{step: string, message: string}>}} */
    const summary = { invoices: null, orders: null, payments: null, closures: null, errors: [] };
    try {
      const r = await syncSapInvoices(deps);
      summary.invoices = {
        mode: r.mode,
        invoicesRead: r.invoicesRead,
        matches: r.matches.length,
        orphans: r.orphans.length,
        errors: r.errors.length,
      };
      const logId = new Date().toISOString().replace(/[:.]/g, '-');
      await db
        .collection('sap_sync_log')
        .doc(logId)
        .set({
          ranAt: new Date().toISOString(),
          manualTrigger: true,
          triggeredBy: request.auth.uid,
          ...r,
        });
    } catch (e) {
      summary.errors.push({
        step: 'invoices',
        message: /** @type {any} */ (e)?.message || String(e),
      });
    }
    try {
      summary.orders = await syncSapOrders(deps);
    } catch (e) {
      summary.errors.push({
        step: 'orders',
        message: /** @type {any} */ (e)?.message || String(e),
      });
    }
    try {
      summary.payments = await handleSyncSapPayments(deps);
    } catch (e) {
      summary.errors.push({
        step: 'payments',
        message: /** @type {any} */ (e)?.message || String(e),
      });
    }
    try {
      summary.closures = await syncSapQuotationClosures(deps);
    } catch (e) {
      summary.errors.push({
        step: 'closures',
        message: /** @type {any} */ (e)?.message || String(e),
      });
    }
    console.log('triggerPlannerSync summary', summary);
    return summary;
  }
);

/**
 * v1058 (2026-09-24): onPedidoCreatedCleanupWaitlist — trigger onCreate en
 * `pedidos/{pedidoId}` que, si el pedido trae `waitlistOrigenId`, marca el
 * doc `revision_waitlist/{waitlistOrigenId}` como consumido de forma atomica.
 *
 * Reemplaza el path fragil client-side (`_pendingWaitlistDelete` en memoria del
 * browser) que dependia de que la variable global sobreviviera reload/close del
 * tab entre "Pasar a Pendientes" y el confirm final.
 *
 * Incidente que motivo el fix (2026-09-24): ANA LORENA FUENTES ORDEN 228 quedo
 * en Lista de Espera Y en Confirmados simultaneamente. El path old client-side
 * fallo silenciosamente en un intento de Pablo — el pedido llego a `pedidos`
 * pero el `stage='consumed'` update del waitlist nunca ocurrio (`stage: None`,
 * `consumedByPedidoId: None`).
 *
 * Idempotencia:
 * - Si el waitlist ya tiene `stage='consumed'`, no hace nada.
 * - Si el waitlist no existe (ya borrado), log info y no throw.
 * - Si el pedido no trae `waitlistOrigenId`, no hace nada (pedido cargado
 *   directo desde Crear Pedido, no desde waitlist).
 *
 * Retry: false. Un waitlist quedandose huerfano es peor que un re-trigger —
 * si algo falla el path old client-side todavia intenta como fallback, o el
 * script `_cleanup_orphan_waitlist_XXX.py` limpia manualmente.
 */
export const onPedidoCreatedCleanupWaitlist = onDocumentCreated(
  {
    region: REGION,
    document: 'pedidos/{pedidoId}',
    retry: false,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const data = event.data?.data() || null;
    if (!data) return;
    const waitlistId = data.waitlistOrigenId;
    if (!waitlistId || typeof waitlistId !== 'string') return;
    const pedidoId = event.params.pedidoId;
    const db = getFirestore();
    const wRef = db.collection('revision_waitlist').doc(waitlistId);
    try {
      const snap = await wRef.get();
      if (!snap.exists) {
        console.log('[cleanup-waitlist] waitlist no existe (ya borrado?)', {
          pedidoId,
          waitlistId,
        });
        return;
      }
      const wData = snap.data() || {};
      if (wData.stage === 'consumed') {
        console.log('[cleanup-waitlist] ya consumed, no-op', { pedidoId, waitlistId });
        return;
      }
      await wRef.update({
        stage: 'consumed',
        consumedByPedidoId: pedidoId,
        consumedAt: FieldValue.serverTimestamp(),
        consumedByTrigger: 'onPedidoCreatedCleanupWaitlist',
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log('[cleanup-waitlist] marked consumed', { pedidoId, waitlistId });
    } catch (e) {
      // Fail-close silencioso — un error aca no debe bloquear el flujo de creacion
      // de pedidos. El path old client-side + script manual son fallbacks.
      console.error('[cleanup-waitlist] error (no-throw)', {
        pedidoId,
        waitlistId,
        err: e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e),
      });
    }
  }
);
