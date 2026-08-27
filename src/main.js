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
  displayVendorName,
  escapeHtml,
  normalizeSearch,
  normClientName,
  normTitle,
  titleCase,
} from './pure/normalize.js';
import {
  canViewPanel,
  computeAgeMinutes,
  computeBackorderTotals,
  computeHealthStatus,
  computePedidosBreakdown,
  computeSentryRateSpike,
  computeStrictOverlap,
  filterOpsLogRecent,
  findDeadProvisorios,
  findStuckPendingPedidos,
  formatAgeLabel,
  summarizeCollectionsGrowth,
  summarizeFirestoreQuota,
  summarizeGhActionsStatus,
  summarizeSapSlHealth,
  summarizeSentryStatus,
} from './pure/panel-metrics.js';
import { reenrichPedidoLine, splitPedidoLine } from './pure/pedido-split.js';
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
import './domains/panel-control.js'; // v611 PANEL DE CONTROL (Mariano-only)

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
installChunkStubs('forecast', [
  'openForecastModal',
  'closeForecastModal',
  'onForecastSalesPlanFile',
  'exportForecastExcel',
]);

const phase0 = {
  version: 'v333',
  pure: {
    normClientName,
    titleCase,
    displayVendorName,
    escapeHtml,
    normTitle,
    normalizeSearch,
    calcClientDiscount,
    matchesAllTokens,
    findSapDuplicateForProvisorio,
    matchSkuFromTitle,
    passesTypeFilter,
    splitPedidoLine,
    reenrichPedidoLine,
    canViewPanel,
    computeHealthStatus,
    computeAgeMinutes,
    formatAgeLabel,
    computePedidosBreakdown,
    computeBackorderTotals,
    computeStrictOverlap,
    filterOpsLogRecent,
    summarizeGhActionsStatus,
    summarizeSentryStatus,
    summarizeSapSlHealth,
    computeSentryRateSpike,
    summarizeFirestoreQuota,
    summarizeCollectionsGrowth,
    findStuckPendingPedidos,
    findDeadProvisorios,
  },
  sentry: { applySentryUserContext },
  sap: { createSapClient },
};

if (typeof window !== 'undefined') {
  // @ts-expect-error — window augmentation runtime-only
  window.__phase0 = phase0;
  // v426 (2026-08-07): displayVendorName expuesto globalmente porque el
  // inline de index.html tambien lo necesita (varios lugares que muestran
  // titleCase(vendor) al user y ahora deben usar el helper con override).
  // @ts-expect-error — augmentation runtime-only
  window.displayVendorName = displayVendorName;
}

export default phase0;
