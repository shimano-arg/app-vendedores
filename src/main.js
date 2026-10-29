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
// §J (v1455 2026-10-25) — Absorción de BO al confirmar. Pure + espejo en functions/core.
import {
  applyAbsorptionsToLines,
  buildBackfillUpdate,
  computeBoAbsorption,
} from './pure/absorb-bo-on-confirm.js';
import {
  computeBackorderExportRows,
  formatBackorderFiltrosHeader,
} from './pure/backorder-export-rows.js';
import { computeBackorderRawLines, computeBackorderSkuMap } from './pure/backorder-sku-map.js';
// Tarea L (v1457 2026-10-25): entrada del backorder (filas rojas) + Excel idéntico.
// Espejo en functions/core/bo_entry_logic.js. Textos en l_bo_entry_texts.js.
import {
  computeBoEntryRows,
  findIdenticalOpenOrder,
  isExcelIdenticalToOpenOrder,
  setBoEntryRowResolution,
  unresolvedBoEntryRows,
} from './pure/bo_entry_logic.js';
import { collectAsigRefsForCancel, sumUnitsToFreeOnCancel } from './pure/cpst-cancel-asig-plan.js';
import {
  collectAsigRefsForItemCancel,
  computeRecorteVendedorPlan,
  sumQtyBySku,
} from './pure/cpst-item-cancel-helpers.js';
import { formatAsigHuerfanaAviso, planCpstOrigenes } from './pure/cpst-origenes-plan.js';
import { computeCpstRevertPlan, sumRevertUnits } from './pure/cpst-revert-plan.js';
import { calcClientDiscount } from './pure/discount.js';
import { findSapDuplicateForProvisorio } from './pure/duplicate.js';
import {
  FICHA_CLASIF_LABELS,
  fichaClienteBuyerRow,
  fichaClienteClasifRow,
  fillDashInEmpty,
  findCmDataByCardCode,
  labelForFichaField,
} from './pure/ficha-cliente-labels.js';
import { passesTypeFilter } from './pure/filters.js';
// v1499 §98 (2026-10-27): política de lectura Firestore server vs cache.
// Fuente única de qué colecciones críticas siempre van a server.
import {
  ALWAYS_SERVER_PATHS,
  getReadOptionsForPath,
  shouldAcceptSnapshot,
  shouldIgnoreCachedSnapshot,
  shouldReadFromServer,
} from './pure/firestore-read-policy.js';
// v1470 (2026-10-26): sanitizador undefined para writes Firestore. Fix bug
// Federico Castelanelli "Function WriteBatch.update() called with invalid
// data. Unsupported field value: undefined (found in document
// revision_waitlist/ZPvU3dOUKtkMeNf1lnq)". Replica el fix v1469 server-side
// pero para el cliente web SDK v8 (compat).
import { isSanitizedPath, stripUndefined } from './pure/firestore-sanitize.js';
import { L_BO_ENTRY_TEXTS } from './pure/l_bo_entry_texts.js';
// v1471 §68 (2026-10-26): mensajes humanos para vendedores. Unica fuente de
// verdad de los textos de error que ven en alert/confirm. Sin códigos, sin
// jerga técnica. Formato: una oración qué pasó + una oración qué hacer.
import {
  formatMensajeConCodigo,
  getMensajeParaErrorCode,
  MENSAJES_VENDEDOR,
  PALABRAS_PROHIBIDAS,
} from './pure/mensajes-vendedor.js';
import {
  displayVendorName,
  escapeHtml,
  normalizeSearch,
  normClientName,
  normTitle,
  titleCase,
} from './pure/normalize.js';
// §57 (2026-10-23): un solo lugar para "waitlists abiertas de un cliente" con
// exclusión de la propia waitlist origen. Espejo en functions/core/open-waitlists.js
// usada por commitPedidoCF; test de sincronía en tests/unit/audit/open-waitlists-sync.test.js.
import {
  findOpenWaitlistsForClient as findOpenWaitlistsForClientExcludingSelf,
  formatWaitlistForMessage,
} from './pure/open-waitlists.js';
// Perfil operativo PACHI (2026-10-26): restricciones centralizadas por UID.
import {
  canDeleteOwnWaitlist,
  canRevisionEmailOrUid,
  isHeaderBtnHiddenForPachi,
  isPachiBodyFlagActive,
  isPachiRestricted,
  isSidebarLeftBtnHiddenForPachi,
  PACHI_BLOCKED_OPEN_FNS,
  PACHI_EMAIL,
  PACHI_HIDDEN_HEADER_BTN_IDS,
  PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS,
  PACHI_UID,
  PACHI_UIDS,
  PACHI_VENDOR_KEY,
  pachiGuard,
} from './pure/pachi-restrictions.js';
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
  summarizeCfHealth,
  summarizeCollectionsGrowth,
  summarizeFirestoreQuota,
  summarizeGhActionsStatus,
  summarizeSapSlHealth,
  summarizeSentryStatus,
  summarizeStorageUsage,
} from './pure/panel-metrics.js';
// PR1 (v1474 2026-10-26 §71): parse de fechas tolerante a Timestamp/Date/ISO/number.
// Elimina dependencia del formato persistido. Reportado ORDEN 530 SUSANA ANDRILI
// ("Invalid Date" en tarjeta porque confirmedAt era Timestamp pre-v1473).
import {
  formatFirestoreDate,
  isFirestoreTimestamp,
  parseFirestoreDate,
  pedidoDateForPlanner,
  plannerCutoffIsoForQuery,
  toIsoStringFlexible,
} from './pure/parse-date-flexible.js';
import { reenrichPedidoLine, splitPedidoLine } from './pure/pedido-split.js';
// v1418 §53 (2026-10-22): computeVaASap unifica el "va a SAP" en los 3 lugares
// (modal detalle, Planner card, payload SL). Fixture ORDEN 524 PONTORIERO.
import { computeVaASap, readDiscountPct, sumConfirmedBruto } from './pure/pedido-va-a-sap.js';
import {
  columnBreakdown,
  columnEnteredAt,
  columnStats,
  formatAge,
} from './pure/planner-column-age.js';
// v1520 (2026-10-29) §103: popup "Stock del SKU" muestra TODO lo que resta
// hasta llegar a Libre + fórmula explícita. Reemplaza las 5 líneas de §40.11
// que escondían "Confirmadas sin facturar".
import {
  buildPopupStockSkuLineas,
  renderPopupStockSkuPlainText,
} from './pure/popup-stock-sku-lineas.js';
import {
  formatProductCatLineParts,
  formatProductDesc,
  hasFullClassification,
} from './pure/product-labels.js';
import { matchSkuFromTitle } from './pure/product-match.js';
import { suggestForSku } from './pure/product-suggestions.js';
import { renderSkeletonRowsPure } from './pure/render-skeleton.js';
// v1498 §97 (2026-10-27): consolidar clientesBO por cliente+SKU en Reparto.
// Fuente única para evitar filas duplicadas (ej. URQUIOLA + CUDC201XG con
// 2 pedidos distintos aparecía 2 veces; ahora 1 fila con la suma).
import {
  consolidateClientesBO,
  distributeQtyFifo,
  groupKeyForClienteBO,
} from './pure/reparto-consolidate.js';
// v1505 (2026-10-28): pure fns del nuevo Reparto EXPORT MANUAL + IMPORT.
// Diferente a v1497 §96: aquel es reporte resumen; este arma el template
// editable con 9 columnas (7 visibles + 2 técnicas) y valida el reimport
// contra el estado actual.
import {
  buildRepartoExcelFileName,
  computeRepartoExcelExportRows,
  filterIngresosForExcelExport,
  safeNum as safeNumExcel,
  safeStr as safeStrExcel,
} from './pure/reparto-excel-export-rows.js';
import {
  groupImportMatchesByReparto,
  validateRepartoExcelImport,
} from './pure/reparto-excel-import-validator.js';
// v1497 §96 (2026-10-27): pure fn para armar filas del export Reparto.
// Fuente única + robusta a campos faltantes (cliente sin nombre/localidad, etc).
import {
  computeRepartoExportRows,
  filterIngresosForExport,
  formatRepartoFiltrosHeader,
  safeNum,
  safeStr,
  safeTs,
} from './pure/reparto-export-rows.js';
import { redistributeAsigLine } from './pure/reparto-stock-asig.js';
import { reportCriticalErrorPure } from './pure/report-critical-error.js';
import {
  enrichPayloadWithClientVendor,
  formatAssignedVendorReason,
  resolveClientVendorFromMaster,
} from './pure/resolve-client-vendor.js';
// PR4 (v1477 2026-10-26 §75): fix "undefined" en Pedidos > Confirmados
// (ORDEN 502 OSVALDO MASERA et al). Pure fn que resuelve desc de línea con
// fallback a catálogo. Usado por UI render + commit-pedido-core server-side.
import {
  buildCatalogDescMapFromProducts,
  hasDesc,
  resolveLineDesc,
  resolveLineDescLive,
} from './pure/resolve-line-desc.js';
// v1484 (2026-10-27): resolver prov/loc de pedidos huérfanos desde
// client_master por cardCode. Usada por renderPendientesList +
// renderConfirmadosList en index.html.
import { resolveOrphanPedidoLocation } from './pure/resolve-orphan-pedido-location.js';
// v1416 §42.2 (2026-10-22): guard "Revisá tu pedido" ofrece unificación en vez
// de bloqueo seco. Reusa helpers §42 (findOpenWaitlistsForClient) + pure helpers
// propios de merge (mergeWaitlistIntoOrderLines, buildUnifiedAtReviewUpdate,
// formatUnifyConfirmMessage).
import {
  buildUnifiedAtReviewUpdate,
  formatUnifyConfirmMessage,
  mergeWaitlistIntoOrderLines,
} from './pure/review-guard-unify.js';
import { matchesAllTokens } from './pure/search.js';
import { getStockBreakdown, STOCK_LABELS } from './pure/stock-breakdown.js';
import {
  getStockDesglose,
  getStockPorCliente,
  getStockPorClienteMemo,
  getStockRealmenteDisponible,
  getStockUtilizableParaClienteExAsig,
  lineReservesStock,
} from './pure/stock-realmente-disponible.js';
// v1435 §58 (2026-10-23): textos autoexplicativos para el modal Sugerencias.
import {
  LEYENDA as SUG_LEYENDA,
  TOOLTIP_ALTERNATIVAS as SUG_TOOLTIP_ALTERNATIVAS,
  TOOLTIP_FALTAN as SUG_TOOLTIP_FALTAN,
  explicarMatch as sugExplicarMatch,
} from './pure/sugerencias-explain.js';
import {
  buildAsigRefsForLine,
  buildUnifiedFromAudit,
  dedupeLinesByCode,
  getRowColorClass,
  mergeLinesFromOrders,
} from './pure/unificar-ordenes.js';
import { computeVirtualAsigFifo } from './pure/virtual-asig-fifo.js';
// v1466 (2026-10-26): hotfix STOCK_CHANGED loop reportado por Santi ~16:46 ART.
// Waitlists CPST con pedidosOrigenes[] en doc pero items[].origen vacío → el
// payload CF llegaba sin origen → fórmula global → qtyBO>0 → STOCK_CHANGED.
// Deriva origen+asigRefs por SKU desde pedidosOrigenes del documento como
// fallback cuando items no los tienen.
import {
  buildOrigenesBySkuFromWaitlist,
  enrichItemWithCpstOrigen,
} from './pure/waitlist-cpst-origen.js';
// v1526: filas del Excel "Exportar pedido" (Stock Asignado / Original / Completo).
import { buildWaitlistExportRows, isStockAsignadoItem } from './pure/waitlist-export-rows.js';
import { shouldIncludeWaitlistDoc } from './pure/waitlist-filter.js';
// v1528: disponible por línea en Revisá tu pedido (STOCK ASIGNADO usa utilizable del cliente).
import { dispParaLineaReview } from './pure/review-disp-linea.js';
import { computeHasExceed } from './pure/waitlist-has-exceed.js';
import {
  buildExcludedPedidoIdsForRepetido,
  filterYaEnOtroPedidoForLine,
  lineCountsAsPedidoAnterior,
} from './pure/waitlist-repetido-filter.js';
import {
  findOpenWaitlistsForClient,
  formatWaitlistForConfirm,
} from './pure/waitlist-unique-per-client.js';
// §59 (2026-10-23) — visibilidad VDE: filtro de revision_waitlist por
// `assignedVendorUid` (del cliente master) en vez de `ownerUid` (quién cargó).
// Reemplaza el filtro inline buggy del sidebar que ocultaba órdenes cargadas
// por otros users para clientes del VDE.
import {
  filterWaitlistsForVendor,
  isWaitlistVisibleForVendor,
} from './pure/waitlist-visibility.js';
import { computeWaitlistCardClasses, isWaitlistCpst } from './pure/wl-sidebar-classes.js';
import { createSapClient } from './sap-client.js';
import { applySentryUserContext } from './sentry.js';
// Dominios que quedan en el shell (side-effect imports, cada uno registra window.foo).
// Estos DEBEN estar en el shell porque el inline los llama al login vía
// attachFirebaseListeners() o durante init.
import './domains/targets.js'; // ensureTargetsListener al login
import './domains/campanias.js'; // isCampaignApplicableToVendor + describeCampaignScope
import './domains/dashboard.js'; // listenCampaigns al login + getVendorForKey + renderDashboard
// v811 (Loop iter 8): seguimiento extraido a chunk lazy. Los listeners
// attachSegNotes/StatusListener corren dentro de openSeguimientoModal,
// no al login → seguro lazy. Stubs abajo.
import './domains/rutas.js'; // ensureVisitsListener + ensureCustomRoutesListener al login
import './domains/rendiciones.js'; // ensureRendicionesListener al login
// v1178 (2026-10-07) Perf C1: notificaciones extraido a chunk lazy. 73 KB raw.
// Stubs registrados abajo. El listener Firestore (myNotifications + unsubMyNotifs
// + ensureNotifsListener + updateNotifsBadge) sigue en inline index.html, asi que
// las notifs llegan y actualizan el badge al login. La UI renderea cuando el user
// abre el tab (stub dispara chunk load ~200ms, dedup via loader).
import './domains/product-picker.js'; // getSkuIndex/Tokens usados por matchSkuFromTitle wrapper (inline L3408)
import './domains/exports-sap.js'; // renderSapClientes/Productos usados por sap-admin-panel switchSapTab
import './domains/visitas.js'; // compressImage usado por notificaciones + rendiciones + ensureClientLocsListener
import './domains/pedidos-modal.js'; // openPedidoModal + doConfirmPedido override pattern (fragmento C del inline)
import './domains/master-clientes.js'; // ensureClientMasterListener al login + clientMasterCache (15+ callers)
import './domains/sap-integration-modal.js'; // ensureSapVendorsListener al login
import './domains/sap-service-layer.js'; // sapSL objeto usado por sap-auto-send
import './domains/sap-auto-send-listener.js'; // ensureSapAutoSendListener reactivo
import './domains/sap-admin-panel.js'; // listenSapMaps + ensureSapConfigListener al login

// v810 (Loop iter 7): panel-control extraido a chunk lazy (Mariano-only, on-demand).
// Stubs registrados abajo. NO importar aca — el chunk se carga cuando Mariano
// clickea "Panel de Control" en el header.

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
  // v1413 §51 (2026-10-22): Mariano-only, Reportes Excel > Infracciones MELI.
  'exportInfraccionesMeli',
]);
// v1505 (2026-10-28): Reparto export + import Excel. Chunk disparado por
// botones del modal Reparto ("Excel editable" + "Importar Excel").
installChunkStubs('exports-reparto', [
  'exportRepartoManualExcel',
  'openRepartoImportDialog',
  'closeRepartoImportDialog',
  'handleRepartoImportFileChange',
  'confirmRepartoImportApply',
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
  'switchForecastTab',
  'onSalesPlanFileForFamilia',
  'openForecastStatDetail',
  'onRecoSearchChange',
  'onRecoFamiliaChange',
  'onRecoFilterMinChange',
  'exportRecoExcel',
  'discontinueSku',
  'reactivateSku',
  'openDiscontinuedModal',
  'editMultiplier',
  'resetMultiplier',
]);
installChunkStubs('panel-control', ['openPanelControl', 'closePanelControl', 'renderPanelControl']);
// v1283 (2026-10-20): reemplazo de 'seguimiento' chunk por 'cartera-vendor'.
// El modal viejo (6 tabs) fue tirado; el nuevo es dashboard de analisis de
// cartera por vendedor. Ver docs/superpowers/specs/2026-10-20-cartera-vendor-analisis-design.md
installChunkStubs('cartera-vendor', [
  'openCarteraModal',
  'closeCarteraModal',
  'onCarteraVendorChange',
  'onCarteraChipClick',
  'onCarteraSearchChange',
  'onCarteraSortClick',
  'exportCarteraToExcel',
]);
installChunkStubs('meli', ['openMeliModal', 'closeMeliModal', 'setMeliSubtab']);
// v1178 (2026-10-07) Perf C1: notificaciones chunk. KNOWN BUG preservado del
// legacy: window.markAllNotifsRead esta declarada 2 veces en el chunk; la 2da
// pisa a la 1ra en runtime. TODO code review consolidar.
installChunkStubs('notificaciones', [
  'openNotifsPanel',
  'closeNotifsPanel',
  'populateTaskTargets',
  'copyAltaCliShareLink',
  'shareAltaCliViaWhatsapp',
  'setAltaCliSubtab',
  'submitAltaRapida',
  'onAltaCliFile',
  'removeAltaCliFile',
  'submitClientApplication',
  'deleteMyAltaCli',
  'openClientApplicationDetail',
  'closeClientApplicationDetail',
  'approveClientApplication',
  'rejectClientApplication',
  'setNotifsTab',
  'deleteNotif',
  'markAllNotifsRead',
  'openImgViewer',
  'closeImgViewer',
  'syncUsersDirectory',
  'onTaskImageInput',
  'removeTaskFormImage',
  'sendTaskNotification',
  'completarTask',
  'markNotifRead',
  'contactarDesdeNotif',
  'renderNotifsList',
  'ensureAltaCliListener',
  'updateNotifsTabCounts',
  'populateAltaCliProvincias',
  'notifItemHtml',
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
    suggestForSku,
    passesTypeFilter,
    shouldIncludeWaitlistDoc,
    computeHasExceed,
    computeWaitlistCardClasses,
    isWaitlistCpst,
    findOpenWaitlistsForClient,
    formatWaitlistForConfirm,
    // v1421 §55: filtro aviso "pedido anterior" del modal Pedido en Espera.
    buildExcludedPedidoIdsForRepetido,
    filterYaEnOtroPedidoForLine,
    lineCountsAsPedidoAnterior,
    // v1416 §42.2 — expuestos como `reviewGuardUnify.*` para claridad semántica
    // y por si el inline necesita invocarlos directamente (fallback inline usa
    // la copia dentro del guard; expose aquí es para tests + consumidores
    // futuros).
    reviewGuardUnify: {
      mergeWaitlistIntoOrderLines,
      buildUnifiedAtReviewUpdate,
      formatUnifyConfirmMessage,
    },
    // §57 (2026-10-23) — fuente única del chequeo "waitlists abiertas de un
    // cliente" con exclude de la propia waitlist origen. Usado por el guard
    // informativo del cliente (src/domains/pedidos-modal.js). El servidor usa
    // el espejo (functions/core/open-waitlists.js).
    openWaitlists: {
      findOpenWaitlistsForClient: findOpenWaitlistsForClientExcludingSelf,
      formatWaitlistForMessage,
    },
    // §59 (2026-10-23) — visibilidad VDE por `assignedVendorUid`.
    waitlistVisibility: {
      isWaitlistVisibleForVendor,
      filterWaitlistsForVendor,
    },
    resolveClientVendorFromMaster,
    enrichPayloadWithClientVendor,
    formatAssignedVendorReason,
    computeCpstRevertPlan,
    sumRevertUnits,
    // v1521 (2026-10-29): pre-flight CPST tolerante a ASIG huérfanas.
    cpstOrigenesPlan: {
      planCpstOrigenes,
      formatAsigHuerfanaAviso,
    },
    collectAsigRefsForCancel,
    sumUnitsToFreeOnCancel,
    collectAsigRefsForItemCancel,
    computeRecorteVendedorPlan,
    sumQtyBySku,
    mergeLinesFromOrders,
    dedupeLinesByCode,
    getRowColorClass,
    buildUnifiedFromAudit,
    buildAsigRefsForLine,
    splitPedidoLine,
    reenrichPedidoLine,
    // v1466 §64 (2026-10-26): fallback origen+asigRefs desde pedidosOrigenes.
    waitlistCpstOrigen: {
      buildOrigenesBySkuFromWaitlist,
      enrichItemWithCpstOrigen,
    },
    // v1470 (2026-10-26) §64 — sanitizador undefined para writes Firestore.
    firestoreSanitize: {
      stripUndefined,
      isSanitizedPath,
    },
    // v1471 §68 (2026-10-26) — mensajes humanos para vendedores.
    mensajesVendedor: {
      MENSAJES_VENDEDOR,
      PALABRAS_PROHIBIDAS,
      getMensajeParaErrorCode,
      formatMensajeConCodigo,
    },
    // PR1 (v1474 2026-10-26 §71) — parse fecha tolerante a múltiples formatos.
    // v1479 (2026-10-27 §76): pedidoDateForPlanner + plannerCutoffIsoForQuery
    // unifican los 3 call-sites del Planner que leen fecha de /pedidos.
    parseDateFlexible: {
      parseFirestoreDate,
      toIsoStringFlexible,
      formatFirestoreDate,
      isFirestoreTimestamp,
      pedidoDateForPlanner,
      plannerCutoffIsoForQuery,
    },
    // v1484 §83 (2026-10-27) — resolve prov/loc huérfano via client_master.
    // v1488 §86 (2026-10-27) — fuente única para los 2 exports de backorder
    // (panel + modal). Consolidación §56 + default includeExpired=true §40.1.
    backorderExport: {
      computeBackorderExportRows,
      formatBackorderFiltrosHeader,
    },
    resolveOrphanPedidoLocation: {
      resolveOrphanPedidoLocation,
    },
    // v1482 §82 (2026-10-27) — Ficha Cliente labels fuente única. Reusado por
    // exportMasterClientes + cartera-vendor columna TIPO + tests.
    fichaClienteLabels: {
      FICHA_CLASIF_LABELS,
      labelForFichaField,
      fichaClienteClasifRow,
      fichaClienteBuyerRow,
      fillDashInEmpty,
      // v1485 §84 (2026-10-27 bug fix): búsqueda del doc client_master por
      // cardCode. Fix para MAXERA donde el slug `clientLocId(prov, loc, name)`
      // no matcheaba el doc real con los campos Ficha.
      findCmDataByCardCode,
    },
    // PR4 (v1477 2026-10-26 §75) — resolve-line-desc.
    // PR2 (v1504 2026-10-28) — + resolveLineDescLive (catalog gana) + builder.
    resolveLineDesc: {
      resolveLineDesc,
      resolveLineDescLive,
      buildCatalogDescMapFromProducts,
      hasDesc,
    },
    // §J (v1455 2026-10-25) — BO absorb al confirmar. Pure + espejo.
    absorbBoOnConfirm: {
      computeBoAbsorption,
      applyAbsorptionsToLines,
      buildBackfillUpdate,
    },
    // Perfil operativo PACHI (2026-10-26) — ÚNICA fuente de verdad del UID
    // + guards centralizados. Documentado en INFORME_CAMBIOS_PACHI.md.
    pachiRestrictions: {
      PACHI_UID,
      PACHI_UIDS,
      PACHI_EMAIL,
      PACHI_VENDOR_KEY,
      isPachiRestricted,
      isPachiBodyFlagActive,
      pachiGuard,
      // v1481 §81 (2026-10-27): lista única de botones del sidebar-left ocultos
      // + wrappers de open*Modal() bloqueados por otro camino.
      PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS,
      PACHI_BLOCKED_OPEN_FNS,
      isSidebarLeftBtnHiddenForPachi,
      // v1507 iter 8 (2026-10-28): botones del header-top ocultos para PACHI.
      // Fuente única paralela a PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS.
      PACHI_HIDDEN_HEADER_BTN_IDS,
      isHeaderBtnHiddenForPachi,
      // v1493 §92 (2026-10-27) iter 4: fuente única del gate `can-revision`.
      canRevisionEmailOrUid,
      // v1496 §95 (2026-10-27) iter 6: ¿puede borrar waitlist card? PACHI
      // solo propios; VDE regular + admin cualquiera.
      canDeleteOwnWaitlist,
    },
    // v1495 §94 (2026-10-27): fuente única labels producto (desc/cat/fam/sub)
    // para el picker + audits. Evita "UNDEFINED UNDEFINED UNDEFINED" literal.
    productLabels: {
      formatProductCatLineParts,
      formatProductDesc,
      hasFullClassification,
    },
    // v1497 §96 (2026-10-27): pure fn export Reparto robusta a campos faltantes.
    repartoExport: {
      computeRepartoExportRows,
      filterIngresosForExport,
      formatRepartoFiltrosHeader,
      safeStr,
      safeNum,
      safeTs,
    },
    // v1498 §97 (2026-10-27): consolidar clientesBO por cliente+SKU en
    // Reparto. Fuente única (fix bug URQUIOLA + CUDC201XG 2 filas → 1 fila 17 un).
    repartoConsolidate: {
      consolidateClientesBO,
      distributeQtyFifo,
      groupKeyForClienteBO,
    },
    // v1505 (2026-10-28): template editable Reparto + import validator.
    // 9 columnas (7 editables + 2 técnicas grises) + fórmula Excel.
    // Validación re-usa el shape de clientesBO y chequea 6 casos de error.
    repartoExcelExport: {
      computeRepartoExcelExportRows,
      filterIngresosForExcelExport,
      buildRepartoExcelFileName,
      safeNumExcel,
      safeStrExcel,
    },
    repartoExcelImport: {
      validateRepartoExcelImport,
      groupImportMatchesByReparto,
    },
    // v1499 §98 (2026-10-27): política lectura Firestore server vs cache.
    // Fuente única: lista colecciones críticas (stock_snapshot, pedidos,
    // revision_waitlist, ingresos_reparto) que SIEMPRE van a server.
    firestoreReadPolicy: {
      ALWAYS_SERVER_PATHS,
      shouldReadFromServer,
      getReadOptionsForPath,
      shouldIgnoreCachedSnapshot,
      shouldAcceptSnapshot,
    },
    // Tarea L (v1457 2026-10-25) — "entrada del backorder" (filas rojas) +
    // Excel idéntico. Pure + espejo. Textos UI aparte en L_BO_ENTRY_TEXTS.
    boEntry: {
      computeBoEntryRows,
      setBoEntryRowResolution,
      unresolvedBoEntryRows,
      isExcelIdenticalToOpenOrder,
      findIdenticalOpenOrder,
      texts: L_BO_ENTRY_TEXTS,
    },
    // v1418 §53 (2026-10-22): "va a SAP" neto unificado.
    computeVaASap,
    readDiscountPct,
    sumConfirmedBruto,
    redistributeAsigLine,
    columnEnteredAt,
    columnBreakdown,
    columnStats,
    formatAge,
    renderSkeletonRowsPure,
    reportCriticalErrorPure,
    getStockRealmenteDisponible,
    getStockDesglose,
    getStockPorCliente,
    getStockPorClienteMemo,
    getStockUtilizableParaClienteExAsig,
    getStockBreakdown,
    STOCK_LABELS,
    buildPopupStockSkuLineas,
    renderPopupStockSkuPlainText,
    buildWaitlistExportRows,
    isStockAsignadoItem,
    dispParaLineaReview,
    lineReservesStock,
    computeVirtualAsigFifo,
    computeBackorderSkuMap,
    computeBackorderRawLines,
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
    summarizeStorageUsage,
    summarizeCfHealth,
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
  // v1210 (2026-10-08): redistributeAsigLine expuesta globalmente porque el
  // handler inline del modal "Reparto" (_repExecute) la invoca con pedido+sku+newQty.
  // @ts-expect-error — augmentation runtime-only
  window.redistributeAsigLine = redistributeAsigLine;
  // v1346: motor sugerencias expuesto al inline (modal Sugerencias).
  // @ts-expect-error — augmentation runtime-only
  window.suggestForSku = suggestForSku;
  // v1435 §58: textos autoexplicativos (leyenda, tooltips, etiqueta por fila)
  // expuestos a los handlers inline del modal Sugerencias.
  // @ts-expect-error — augmentation runtime-only
  window.__sugExplain = {
    LEYENDA: SUG_LEYENDA,
    TOOLTIP_FALTAN: SUG_TOOLTIP_FALTAN,
    TOOLTIP_ALTERNATIVAS: SUG_TOOLTIP_ALTERNATIVAS,
    explicarMatch: sugExplicarMatch,
  };
}

export default phase0;
