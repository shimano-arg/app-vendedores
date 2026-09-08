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
import { expireAsigLinesTTL } from './core/asig-ttl-core.js';
// v818 (2026-09-07): auto-envio pedidos confirmed a SAP via CF trigger. Elimina
// dependencia del auto-send client-side (que solo corria en sesion admin/gerente
// con SL activo). Fix bug reportado por Mariano: pedidos VDE confirmed quedaban
// invisibles a SAP hasta que admin abria la app.
import { AUTO_SEND_RESULT, handleAutoSendSap } from './core/auto-send-sap-core.js';
import { runDailyBackup } from './core/backup-core.js';
import { runFifoAssign } from './core/fifo-assign-core.js';
import { runGeminiOcr } from './core/gemini-ocr-core.js';
import { syncSapInvoices } from './core/invoice-sync-core.js';
// v774 (2026-09-02): notif email al enviar oferta a SAP (pedido Mariano).
import { buildEmailContent, sendEmail, shouldNotify } from './core/notify-quotation-sent-core.js';
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
// v829 (2026-09-08): password de SETUP WMS API para consultar estado de
// pedidos (movimientos de salida). Confirmado por Marcos (SETUP) 2026-09-08:
// user "nur" / password "1234" sirve para prod (nur-integra) y sandbox
// (nur-prueba). Ver setupGetMovimientos abajo + probe scripts en
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
      const sapConfig = {
        url: sl.url || '',
        companyDB: sl.companyDB || '',
        userName: sl.userName || '',
        password: SAP_SL_PASSWORD.value(),
      };
      if (!sapConfig.url || !sapConfig.companyDB || !sapConfig.userName || !sapConfig.password) {
        console.log('onPedidoConfirmedSendToSap skip: sapConfig incompleto');
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
 *   - Sin gate por rol: cualquier user de la app puede ver estado depósito
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

    const SETUP_URL = 'https://nur-integra.setuponline.com.ar';
    const SETUP_USER = 'nur';
    // v835 (2026-09-08): dias hasta 365 (1 año). Timeout CF subido a 300s
    // porque SETUP tarda mucho con rangos amplios + productos cache warm-up.
    const dias = Math.min(365, Number(request.data && request.data.dias) || 60);
    const filterCardCode = String((request.data && request.data.cardCode) || '').trim();

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
      const https = await import('node:https');
      const { URL } = await import('node:url');
      const today = new Date();
      const desde = new Date(today.getTime() - dias * 24 * 60 * 60 * 1000);
      const filtros = {
        ID_Nota_de_venta: '',
        ID_Cliente: '',
        ID_Destinatario: filterCardCode,
        Codigo_deposito: 1,
        Fecha_desde: desde.toISOString().slice(0, 10),
        Fecha_hasta: today.toISOString().slice(0, 10),
      };
      const bodyStr = JSON.stringify(filtros);
      const u = new URL(`${SETUP_URL}/GetMovimientosSalida`);

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
              resolve({ status: r.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') })
            );
          }
        );
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
      });

      if (resp.status !== 200) {
        throw new HttpsError(
          'internal',
          `SETUP /GetMovimientosSalida status=${resp.status} body=${resp.body.slice(0, 200)}`
        );
      }

      // 3) Parsear VFPData wrapper.
      const parsed = JSON.parse(resp.body);
      const data = parsed.VFPData;
      if (!data) {
        // Sin data — respuesta valida pero vacia (comun en sandbox).
        return { movimientos: [], notasCount: 0 };
      }
      const arrKey = Object.keys(data).find((k) => Array.isArray(data[k]));
      const arr = arrKey ? data[arrKey] : [];

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
        else if (comp === 'PREPARACIÓN DE PEDIDO' || comp === 'PREPARACION DE PEDIDO') acc._hasPreparacion = true;
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

      return { movimientos, notasCount: movimientos.length, lineasTotales: arr.length };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error('setupGetMovimientos unexpected error', e);
      throw new HttpsError('internal', String(e && e.message ? e.message : e));
    }
  }
);
