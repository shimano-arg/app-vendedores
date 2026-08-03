// @ts-check
/**
 * SHELL (entrypoint del bundle). Post-E3 (code splitting):
 * - Contiene TODOS los dominios que necesitan estar disponibles al login
 *   (listeners Firestore, funciones cross-scope críticas).
 * - Contiene el loader.js + STUBS proxy para chunks lazy.
 * - Los 3 chunks lazy (exports-core, exports-advanced, admin-users) NO se
 *   importan aquí; se cargan on-demand vía window.loadChunk(name) al primer
 *   llamado a cualquier de sus window.foo (que en el shell son stubs proxy).
 */

// E3 (e2b-perf 2026-07-28): loader para chunks lazy.
import { installChunkStubs } from './loader.js';
import { calcClientDiscount } from './pure/discount.js';
import { findSapDuplicateForProvisorio } from './pure/duplicate.js';
import { passesTypeFilter } from './pure/filters.js';
import {
  escapeHtml,
  normalizeSearch,
  normClientName,
  normTitle,
  titleCase,
} from './pure/normalize.js';
import { matchSkuFromTitle } from './pure/product-match.js';
import { matchesAllTokens } from './pure/search.js';
import { createSapClient } from './sap-client.js';
import { applySentryUserContext } from './sentry.js';
// Dominios que quedan en el shell (side-effect imports, cada uno registra window.foo).
// Estos DEBEN estar en el shell porque el inline los llama al login vía
// attachFirebaseListeners() o durante init.
import './domains/targets.js'; // ensureTargetsListener al login
import './domains/campanias.js'; // isCampaignApplicableToVendor + describeCampaignScope
import './domains/dashboard.js'; // listenCampaigns al login + getVendorForKey + renderDashboard
import './domains/seguimiento.js'; // unsubSegNotes/Status (cleanup)
import './domains/rutas.js'; // ensureVisitsListener + ensureCustomRoutesListener al login
import './domains/rendiciones.js'; // ensureRendicionesListener al login
import './domains/notificaciones.js'; // renderNotifsList + syncUsersDirectory
import './domains/product-picker.js'; // getSkuIndex/Tokens usados por matchSkuFromTitle wrapper (inline L3408)
import './domains/exports-sap.js'; // renderSapClientes/Productos usados por sap-admin-panel switchSapTab
import './domains/visitas.js'; // compressImage usado por notificaciones + rendiciones + ensureClientLocsListener
import './domains/pedidos-modal.js'; // openPedidoModal + doConfirmPedido override pattern (fragmento C del inline)
import './domains/master-clientes.js'; // ensureClientMasterListener al login + clientMasterCache (15+ callers)
import './domains/sap-integration-modal.js'; // ensureSapVendorsListener al login
import './domains/sap-service-layer.js'; // sapSL objeto usado por sap-auto-send
import './domains/sap-auto-send-listener.js'; // ensureSapAutoSendListener reactivo
import './domains/sap-admin-panel.js'; // listenSapMaps + ensureSapConfigListener al login

// === Chunks lazy (E3): stubs proxy que hacen loadChunk + re-invoke ===
// Cada entrada { chunkName: [exportNames] } genera stubs window.foo que al primer
// llamado inyectan <script src="./chunks/<name>.js"> y luego invocan la función real.
// La lista debe MATCHEAR la de build.js LAZY_CHUNKS (fuente de verdad).
installChunkStubs('exports-core', [
  'closeExportAnalisis',
  'closeExportDialog',
  'closeMonthPicker',
  'confirmMonthPicker',
  'exportMasterClientes',
  'exportPreciosStock',
  'exportTargetsZonas',
  'exportToExcel',
  'openExportAnalisis',
  'showMonthPicker',
]);
installChunkStubs('exports-advanced', [
  'exportAuditExcel',
  'exportExecutive',
  'exportML',
  'exportPhotosZip',
  'exportPowerBI',
  'exportVisitsExcel',
  'exportVisitsWithEmbeddedPhotos',
  // v371+: export dataset ZIP para pipelines ML (admin/gerente only)
  'openExportFormatModal',
  'closeExportFormatModal',
  'exportDatasetZip',
]);
installChunkStubs('admin-users', [
  'addAllowedEmail',
  'bulkAssignApprover',
  'changeUserPassword',
  'closeAdminPanel',
  'closeTotpSetupModal',
  'confirmTotpSetup',
  'deleteGeminiApiKey',
  'deleteGmapsApiKey',
  'deleteUserRole',
  'disableTotp',
  'generateNewTotp',
  'openAdminPanel',
  'openTotpSetup',
  'removeAllowedEmail',
  'saveGeminiApiKey',
  'saveGmapsApiKey',
  'saveUserRole',
]);

const phase0 = {
  version: 'v333',
  pure: {
    normClientName,
    titleCase,
    escapeHtml,
    normTitle,
    normalizeSearch,
    calcClientDiscount,
    matchesAllTokens,
    findSapDuplicateForProvisorio,
    matchSkuFromTitle,
    passesTypeFilter,
  },
  sentry: { applySentryUserContext },
  sap: { createSapClient },
};

// @ts-expect-error — window augmentation runtime-only
if (typeof window !== 'undefined') window.__phase0 = phase0;

export default phase0;
