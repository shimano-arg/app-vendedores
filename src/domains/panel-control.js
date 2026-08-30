// @ts-nocheck
// PANEL DE CONTROL (v611, 2026-08-24).
//
// Seccion visible SOLO para Mariano (admin + email whitelist) que muestra
// estado de salud + KPIs de la app para anticipar problemas antes de que
// caiga en produccion.
//
// Fuentes de datos (iteracion 1 = solo Firestore, ya en memoria):
// - STOCK_UPDATED_AT: last update del stock snapshot (SAP source).
// - globalPedidos: array de pedidos-app (breakdown por stage, backorder).
// - STOCK_BACKORDER + STOCK_BACKORDER_APP: totales.
// - opsLogCache: ultimos ops logueados.
//
// Iteracion 2 agrega cards de GitHub Actions status (CF nueva sincroniza cada 5 min).
// Iteracion 3 agrega Sentry issues (CF nueva sincroniza cada 15 min).
//
// SEGURIDAD: todos los strings user-supplied (email, action, entityName) van
// por escapeHtml() antes de innerHTML — mismo patron que el resto del inline.

const _pure = () => (window.__phase0 && window.__phase0.pure) || {};

// escapeHtml del inline (window.escapeHtml). Fallback local si el bundle
// se carga antes que la fn inline (edge case; en runtime siempre esta).
function _escHtml(s) {
  if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') {
    return window.escapeHtml(s);
  }
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HEALTH_COLORS = {
  green: '#16a34a',
  yellow: '#f59e0b',
  red: '#dc2626',
  unknown: '#94a3b8',
};

function _healthDot(status) {
  const color = HEALTH_COLORS[status] || HEALTH_COLORS.unknown;
  return '<span style="color:' + color + ';font-size:14px">&#9679;</span>';
}

function _hCard(title, status, mainText, subText, tooltip) {
  return (
    '<div class="pc-card" title="' +
    _escHtml(tooltip || '') +
    '" style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:14px 16px;min-width:200px;flex:1">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
    _healthDot(status) +
    '<div style="font-size:10.5px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px">' +
    _escHtml(title) +
    '</div></div>' +
    '<div style="font-size:20px;font-weight:800;color:var(--text-primary);margin-bottom:2px">' +
    _escHtml(mainText) +
    '</div>' +
    '<div style="font-size:11px;color:var(--text-muted)">' +
    _escHtml(subText) +
    '</div>' +
    '</div>'
  );
}

function _kpiCard(title, mainText, subText, color) {
  const c = color || '#0f172a';
  return (
    '<div class="pc-card" style="background:var(--bg-elevated);border:1.5px solid var(--border-subtle);border-radius:8px;padding:14px 16px;min-width:200px;flex:1">' +
    '<div style="font-size:10.5px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">' +
    _escHtml(title) +
    '</div>' +
    '<div style="font-size:24px;font-weight:800;color:' +
    c +
    ';margin-bottom:2px">' +
    _escHtml(mainText) +
    '</div>' +
    '<div style="font-size:11px;color:var(--text-muted)">' +
    _escHtml(subText) +
    '</div>' +
    '</div>'
  );
}

function _sectionWrap(title, cardsHtml) {
  return (
    '<div class="pc-section" style="margin-bottom:24px">' +
    '<h3 style="margin:0 0 12px 0;font-size:14px;color:var(--text-primary);font-weight:800;text-transform:uppercase;letter-spacing:.5px">' +
    _escHtml(title) +
    '</h3>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
    cardsHtml +
    '</div></div>'
  );
}

function _renderInfraSection() {
  const p = _pure();
  const stockUpd = window.STOCK_UPDATED_AT != null ? window.STOCK_UPDATED_AT : null;
  const stockStatus = p.computeHealthStatus
    ? p.computeHealthStatus(stockUpd, { greenMaxMinutes: 30, yellowMaxMinutes: 120 })
    : 'unknown';
  const stockLabel = p.formatAgeLabel ? p.formatAgeLabel(stockUpd) : 'sin datos';

  // v612 iter 2: card GitHub Actions status. Lee de window.GH_ACTIONS_STATUS
  // (populado por listener en index.html). Doc escrito cada 5 min por
  // scripts/sync_gh_actions_status.py via workflow sync-gh-actions-status.yml.
  const ghDoc = window.GH_ACTIONS_STATUS || null;
  const gh = p.summarizeGhActionsStatus
    ? p.summarizeGhActionsStatus(ghDoc)
    : {
        healthColor: 'unknown',
        totalWorkflows: 0,
        criticalFailingCount: 0,
        syncedAgoLabel: 'sin datos',
      };
  const ghMain = ghDoc
    ? gh.criticalFailingCount === 0
      ? '0 fallando'
      : gh.criticalFailingCount + ' fallando'
    : 'sin sync todavia';
  const ghSub = ghDoc
    ? gh.totalWorkflows + ' workflows · sync ' + gh.syncedAgoLabel
    : 'esperando primer cron (~5 min)';
  const ghTooltip =
    gh.criticalFailingCount > 0
      ? 'Workflows criticos fallando:\n' +
        gh.criticalWorkflows
          .filter((w) => w.conclusion === 'failure')
          .map((w) => '- ' + w.name)
          .join('\n')
      : 'Todos los workflows criticos OK';

  // v613 iter 3: card Sentry issues. Lee de window.SENTRY_STATUS. Doc escrito
  // cada 15 min por scripts/sync_sentry_issues.py via workflow sync-sentry-issues.yml.
  const sentryDoc = window.SENTRY_STATUS || null;
  const sentry = p.summarizeSentryStatus
    ? p.summarizeSentryStatus(sentryDoc)
    : {
        status: 'unknown',
        healthColor: 'unknown',
        totalUnresolved: 0,
        errorCount: 0,
        warningCount: 0,
        syncedAgoLabel: 'sin datos',
      };
  let sentryMain;
  let sentrySub;
  let sentryTooltip;
  if (sentry.status === 'not_configured') {
    sentryMain = 'no configurado';
    sentrySub = 'requiere SENTRY_AUTH_TOKEN';
    sentryTooltip =
      sentry.errorMessage || 'Crear token en sentry.io/settings/account/api/auth-tokens/';
  } else if (sentry.status === 'error') {
    sentryMain = 'sync error';
    sentrySub = sentry.syncedAgoLabel;
    sentryTooltip = sentry.errorMessage || 'error desconocido';
  } else if (sentry.status === 'ok') {
    sentryMain = sentry.totalUnresolved + ' unresolved';
    sentrySub =
      sentry.errorCount +
      ' errors / ' +
      sentry.warningCount +
      ' warnings · ' +
      sentry.syncedAgoLabel;
    sentryTooltip = 'Ultimas 24h no resueltos. Panel muestra top 20 abajo.';
  } else {
    sentryMain = 'sin sync';
    sentrySub = 'esperando primer cron (~15 min)';
    sentryTooltip = 'Placeholder';
  }

  // v624: card Sentry Rate Spike. Detecta error rate spike hora actual vs
  // promedio 24h. Solo tiene sentido cuando sentry esta 'ok' — sino la card
  // sale gris ("sin datos") como el resto. Renderiza SIEMPRE (aun con 0
  // errores es informativo). Requiere sentryDoc.errorCountHistory (buckets
  // por hora, populado por scripts/sync_sentry_issues.py v616).
  const spike =
    p.computeSentryRateSpike && sentry.status === 'ok'
      ? p.computeSentryRateSpike(sentryDoc)
      : { currentHourErrors: 0, avg24hHourly: 0, spikeRatio: 0, spikeAlert: 'unknown' };
  const spikeStatus = sentry.status === 'ok' ? spike.spikeAlert : 'unknown';
  const spikeMain = sentry.status === 'ok' ? spike.currentHourErrors + ' err/h' : 'sin datos';
  const spikeSub =
    sentry.status === 'ok'
      ? 'avg 24h ' + spike.avg24hHourly + '/h · ratio ' + spike.spikeRatio + 'x'
      : 'requiere Sentry ok';
  const spikeTooltip =
    'Errores Sentry hora actual vs promedio 24h. ' +
    'Verde: normal. Amarillo: >2x avg. Rojo: >5x avg. ' +
    'Solo alerta si hay >=3 errores/h (evita falsos positivos con 0->1).';

  // v616 iter 5: card SAP Service Layer health. Lee app_config/sap_sl_health
  // (escrito por CF checkSapSlHealthCF cada 5 min). Detecta SL down antes de
  // que se caiga el flujo confirmar pedido -> sap-auto-send.
  const slDoc = window.SAP_SL_HEALTH || null;
  const sl = p.summarizeSapSlHealth
    ? p.summarizeSapSlHealth(slDoc)
    : {
        status: 'unknown',
        healthColor: 'unknown',
        latencyLabel: 'sin datos',
        ageLabel: 'sin datos',
        consecutiveFailures: 0,
      };
  const slMain =
    sl.status === 'ok'
      ? sl.latencyLabel
      : sl.status === 'error'
        ? sl.consecutiveFailures + ' fails consec.'
        : 'sin datos';
  const slSub =
    'checked ' +
    sl.ageLabel +
    (sl.consecutiveFailures > 0 && sl.firstFailureAgoLabel
      ? ' · caido desde ' + sl.firstFailureAgoLabel
      : '');
  const slTooltip =
    sl.status === 'error'
      ? 'SAP SL fallando. Error: ' + (sl.errorMessage || 'unknown')
      : 'Health check pasivo: login SAP SL cada 5 min. Verde <3s latencia; amarillo >3s o 1 fail; rojo 2+ fails consecutivos.';

  // v625: card Firestore Quota. Lee app_config/firestore_quota (escrito por
  // scripts/sync_firestore_quota.py cada 30 min via Cloud Monitoring API).
  // Muestra worst % de uso vs free tier (reads/writes/deletes/storage).
  // v685 FIX (2026-08-27): si el listener no habia corrido aun (timing race
  // al abrir Panel), disparar fetch directo + re-invocar listener + re-render
  // al recibir. Antes se veia "sin datos - esperando primer cron (~30 min)"
  // aunque el doc existiera con status: ok.
  const fsqDoc = window.FIRESTORE_QUOTA || null;
  if (!fsqDoc && typeof fbDb !== 'undefined' && fbDb) {
    try {
      fbDb
        .collection('app_config')
        .doc('firestore_quota')
        .get()
        .then((snap) => {
          if (snap && snap.exists) {
            window.FIRESTORE_QUOTA = snap.data();
            if (typeof window.renderPanelControl === 'function') window.renderPanelControl();
          }
        })
        .catch((err) => console.warn('[panel-control] firestore_quota fetch fail', err));
    } catch (_e) {}
    try {
      if (typeof window.ensureFirestoreQuotaListener === 'function') {
        window.ensureFirestoreQuotaListener();
      }
    } catch (_e) {}
  }
  const fsq = p.summarizeFirestoreQuota
    ? p.summarizeFirestoreQuota(fsqDoc)
    : {
        status: 'unknown',
        healthColor: 'unknown',
        readsPct: 0,
        writesPct: 0,
        deletesPct: 0,
        storagePct: 0,
        worstPct: 0,
        syncedAgoLabel: 'sin datos',
      };
  let fsqMain;
  let fsqSub;
  let fsqTooltip;
  if (fsq.status === 'ok') {
    fsqMain = fsq.worstPct + '% peor uso';
    fsqSub =
      'R ' +
      fsq.readsPct +
      '% · W ' +
      fsq.writesPct +
      '% · D ' +
      fsq.deletesPct +
      '% · S ' +
      fsq.storagePct +
      '% · sync ' +
      fsq.syncedAgoLabel;
    fsqTooltip =
      'Uso Firestore 24h vs free tier (reads 50k, writes 20k, deletes 20k, storage 1GB). ' +
      'Verde <50%, amarillo <80%, rojo >80%. ' +
      'Reads: ' +
      fsq.reads24h +
      ' · Writes: ' +
      fsq.writes24h +
      ' · Deletes: ' +
      fsq.deletes24h +
      ' · Storage: ' +
      Math.round((fsq.storageBytes / 1048576) * 10) / 10 +
      ' MB';
  } else if (fsq.status === 'error') {
    fsqMain = 'sync error';
    fsqSub = fsq.syncedAgoLabel;
    fsqTooltip = fsq.errorMessage || 'error desconocido';
  } else {
    fsqMain = 'sin datos';
    fsqSub = 'esperando primer cron (~30 min)';
    fsqTooltip = 'Requiere Cloud Monitoring API + rol monitoring.viewer en el SA';
  }

  // v614 iter 4: card CF Invoice Sync. Lee app_config/sap_sync_state (escrito
  // por CF syncSapInvoicesToApp cada 15 min). Reemplaza el placeholder iter 1.
  const sapState = window.SAP_SYNC_STATE || null;
  const cfLastRun = sapState ? sapState.lastRunAt : null;
  const cfMode = sapState ? sapState.mode || 'shadow' : null;
  const cfStatus = p.computeHealthStatus
    ? p.computeHealthStatus(cfLastRun, { greenMaxMinutes: 30, yellowMaxMinutes: 60 })
    : 'unknown';
  const cfLabel = p.formatAgeLabel ? p.formatAgeLabel(cfLastRun) : 'sin datos';
  const cfSub = cfMode ? 'CF syncSapInvoicesToApp · mode=' + cfMode : 'esperando primer run';
  const cfTooltip =
    'Ultima ejecucion de la CF syncSapInvoicesToApp (sincroniza Invoices SAP → pedidos-app). Cron 15 min. Verde <30min, amarillo <1h, rojo >1h.';

  return _sectionWrap(
    'Infraestructura',
    _hCard(
      'Stock Snapshot',
      stockStatus,
      stockLabel,
      'sync_sap_to_firestore.py cada 5 min',
      'Ultima actualizacion del stock (dep 11 disp + backorderBySku). Verde <30min, amarillo <2h, rojo >2h.'
    ) +
      _hCard('SAP Service Layer', sl.healthColor, slMain, slSub, slTooltip) +
      _hCard('GitHub Actions', gh.healthColor, ghMain, ghSub, ghTooltip) +
      _hCard('Sentry Issues', sentry.healthColor, sentryMain, sentrySub, sentryTooltip) +
      _hCard('Sentry Rate Spike', spikeStatus, spikeMain, spikeSub, spikeTooltip) +
      _hCard('Firestore Quota', fsq.healthColor, fsqMain, fsqSub, fsqTooltip) +
      _hCard('CF Invoice Sync', cfStatus, cfLabel, cfSub, cfTooltip) +
      _renderCollectionsGrowthCard(p) +
      _renderStorageUsageCard(p) +
      _renderCfHealthCard(p) +
      _renderStuckPendingCard(p) +
      _renderDeadProvisoriosCard(p)
  );
}

// v687 Fase E2 (2026-08-27) Card "Storage" - Firebase Storage bytes vs free tier (5GB)
function _renderStorageUsageCard(p) {
  const doc = window.STORAGE_USAGE || null;
  if (!doc && typeof window.fbDb !== 'undefined' && window.fbDb) {
    try {
      window.fbDb
        .collection('app_config')
        .doc('storage_usage')
        .get()
        .then((snap) => {
          if (snap && snap.exists) {
            window.STORAGE_USAGE = snap.data();
            if (typeof window.renderPanelControl === 'function') window.renderPanelControl();
          }
        })
        .catch(() => {});
    } catch (_e) {}
  }
  const s = p.summarizeStorageUsage
    ? p.summarizeStorageUsage(doc)
    : {
        healthColor: 'unknown',
        totalGB: 0,
        totalMB: 0,
        storagePct: 0,
        topFolders: [],
        syncedAgoLabel: 'sin datos',
      };
  let mainText, subText, tooltip;
  if (!doc) {
    mainText = 'sin datos';
    subText = 'esperando primer cron (~24h)';
    tooltip =
      'Cron sync_storage_usage.py corre 1x/dia (03:30 UTC). Suma bytes de buckets user-data + top folders.';
  } else {
    mainText = s.totalGB > 0 ? s.totalGB + ' GB' : s.totalMB + ' MB';
    const top1 = s.topFolders[0];
    subText = top1
      ? top1.path + ' ' + Math.round(top1.bytes / 1024 / 1024) + ' MB · sync ' + s.syncedAgoLabel
      : 'sync ' + s.syncedAgoLabel;
    tooltip =
      'Total ' +
      s.totalGB +
      ' GB / 5 GB free tier (' +
      s.storagePct +
      '%). Top folders:\n' +
      s.topFolders
        .map(
          (f) =>
            '- ' + f.path + ': ' + Math.round(f.bytes / 1024 / 1024) + ' MB (' + f.blobs + ' blobs)'
        )
        .join('\n');
  }
  return _hCard('Storage', s.healthColor, mainText, subText, tooltip);
}

// v687 Fase E4 (2026-08-27) Card "CF Health" - errors + p95 latency por CF
function _renderCfHealthCard(p) {
  const doc = window.CF_HEALTH || null;
  if (!doc && typeof window.fbDb !== 'undefined' && window.fbDb) {
    try {
      window.fbDb
        .collection('app_config')
        .doc('cf_health')
        .get()
        .then((snap) => {
          if (snap && snap.exists) {
            window.CF_HEALTH = snap.data();
            if (typeof window.renderPanelControl === 'function') window.renderPanelControl();
          }
        })
        .catch(() => {});
    } catch (_e) {}
  }
  const c = p.summarizeCfHealth
    ? p.summarizeCfHealth(doc)
    : {
        healthColor: 'unknown',
        totalFunctions: 0,
        worstFunction: '',
        worstErrors24h: 0,
        totalErrors24h: 0,
        topByErrors: [],
        slowest: [],
        errorMessage: null,
        syncedAgoLabel: 'sin datos',
      };
  let mainText, subText, tooltip;
  if (!doc || c.status === 'error') {
    mainText = 'sin datos';
    subText = c.errorMessage
      ? 'error: ' + String(c.errorMessage).slice(0, 40)
      : 'esperando primer cron (~1h)';
    tooltip = c.errorMessage
      ? 'SA falta rol logging.viewer. gcloud projects add-iam-policy-binding <PROJ> --member serviceAccount:<SA_EMAIL> --role roles/logging.viewer\n\nError raw: ' +
        c.errorMessage
      : 'Cron sync_cf_health.py corre cada hora via Cloud Logging API. Requiere Cloud Logging API + rol monitoring.viewer/logging.viewer en el SA.';
  } else {
    mainText = c.totalErrors24h + ' err/24h';
    subText =
      c.totalFunctions +
      ' CFs · ' +
      (c.slowest[0]
        ? 'p95 ' + c.slowest[0].name + ' ' + Math.round(c.slowest[0].p95Ms) + 'ms'
        : 'sin p95') +
      ' · sync ' +
      c.syncedAgoLabel;
    tooltip =
      'Cloud Functions health ultimas 24h. Top por errors:\n' +
      c.topByErrors
        .map(
          (f) =>
            '- ' +
            f.name +
            ': ' +
            f.errors24h +
            ' err, ' +
            f.invocations24h +
            ' inv, p95 ' +
            f.p95Ms +
            'ms'
        )
        .join('\n') +
      '\n\nTop por latencia (slowest p95):\n' +
      c.slowest.map((f) => '- ' + f.name + ': p95 ' + f.p95Ms + 'ms').join('\n');
  }
  return _hCard('CF Health', c.healthColor, mainText, subText, tooltip);
}

// v686 Fase E3 (2026-08-27) Card "Pedidos Stuck" - pedidos con stage=pending
// hace mas de 7 dias sin cerrar. Los vendedores dejan el flow a mitad de
// camino y quedan pendientes visibles pero no procesados.
function _renderStuckPendingCard(p) {
  const pedidos = Array.isArray(window.globalPedidos) ? window.globalPedidos : [];
  const now = new Date();
  const stuck = p.findStuckPendingPedidos
    ? p.findStuckPendingPedidos(pedidos, now, 7)
    : { healthColor: 'unknown', count: 0, top5: [] };
  const mainText = stuck.count + ' pedido' + (stuck.count === 1 ? '' : 's');
  let subText;
  if (stuck.count === 0) {
    subText = 'sin pendientes viejos';
  } else {
    const top = stuck.top5[0];
    subText =
      'mas viejo: ' +
      top.clientName.slice(0, 26) +
      ' (' +
      top.ageDays +
      'd, ' +
      top.ownerVendor.split(' ')[0] +
      ')';
  }
  const tooltip =
    stuck.count === 0
      ? 'Sin pedidos en stage=pending hace mas de 7 dias. Sano.'
      : 'Pedidos stage=pending hace >' +
        stuck.thresholdDays +
        ' dias sin cerrar (vendedor toco Vista preliminar pero no confirmo definitivamente). Top 5:\n' +
        stuck.top5
          .map((x) => '- ' + x.clientName + ' (' + x.ageDays + 'd, ' + x.ownerVendor + ')')
          .join('\n');
  return _hCard('Pedidos Stuck (>7d)', stuck.healthColor, mainText, subText, tooltip);
}

// v686 Fase E3 (2026-08-27) Card "Provisorios Muertos" - client_applications
// sin cardCodeSap hace mas de 30 dias. Candidates para cerrar/archivar.
function _renderDeadProvisoriosCard(p) {
  const apps = Array.isArray(window.approvedAltasList) ? window.approvedAltasList : [];
  const now = new Date();
  const dead = p.findDeadProvisorios
    ? p.findDeadProvisorios(apps, now, 30)
    : { healthColor: 'unknown', count: 0, top5: [] };
  const mainText = dead.count + ' provisorio' + (dead.count === 1 ? '' : 's');
  let subText;
  if (dead.count === 0) {
    subText = 'sin provisorios muertos';
  } else {
    const top = dead.top5[0];
    subText =
      'mas viejo: ' + top.comercio.slice(0, 24) + ' (' + top.ageDays + 'd, ' + top.provincia + ')';
  }
  const tooltip =
    dead.count === 0
      ? 'Sin provisorios abandonados. Sano.'
      : 'Provisorios (manualSapPending=true, sin cardCodeSap) hace >' +
        dead.thresholdDays +
        ' dias. Candidates para cerrar. Top 5:\n' +
        dead.top5
          .map(
            (x) =>
              '- ' + x.comercio + ' (' + x.ageDays + 'd, ' + x.provincia + ', ' + x.ownerEmail + ')'
          )
          .join('\n');
  return _hCard('Provisorios Muertos (>30d)', dead.healthColor, mainText, subText, tooltip);
}

// v686 (2026-08-27) Card "Growth Colecciones" - anticipa crecimiento
// descontrolado antes de que consuma el free tier Firestore Storage (1GB) o
// infle reads/writes por accion (visits + opsLog crecen lineal).
function _renderCollectionsGrowthCard(p) {
  const growthDoc = window.COLLECTIONS_GROWTH || null;
  // v685 pattern: fetch defensivo si el listener no corrio aun.
  if (!growthDoc && typeof window.fbDb !== 'undefined' && window.fbDb) {
    try {
      window.fbDb
        .collection('app_config')
        .doc('collections_growth')
        .get()
        .then((snap) => {
          if (snap && snap.exists) {
            window.COLLECTIONS_GROWTH = snap.data();
            if (typeof window.renderPanelControl === 'function') window.renderPanelControl();
          }
        })
        .catch((err) => console.warn('[panel-control] collections_growth fetch fail', err));
    } catch (_e) {}
    try {
      if (typeof window.ensureCollectionsGrowthListener === 'function') {
        window.ensureCollectionsGrowthListener();
      }
    } catch (_e) {}
  }
  const g = p.summarizeCollectionsGrowth
    ? p.summarizeCollectionsGrowth(growthDoc)
    : {
        healthColor: 'unknown',
        totalMB: 0,
        storagePct: 0,
        topBySize: [],
        worstCollection: '',
        worstDelta: 0,
        syncedAgoLabel: 'sin datos',
      };

  let mainText, subText, tooltip;
  if (!growthDoc) {
    mainText = 'sin datos';
    subText = 'esperando primer cron (~6h)';
    tooltip =
      'Cron sync_collections_growth.py corre cada 6h. Cuenta docs por coleccion + delta desde ultimo sync + estima total bytes.';
  } else {
    mainText = g.totalMB + ' MB';
    const top1 = g.topBySize[0];
    const topLabel = top1 ? top1.name + ' ' + top1.count : '-';
    subText =
      topLabel +
      ' · worst +' +
      g.worstDelta +
      ' (' +
      (g.worstCollection || '-') +
      ') · sync ' +
      g.syncedAgoLabel;
    tooltip =
      'Total ~' +
      g.totalMB +
      ' MB de ' +
      Math.round(g.freeTierBytes / 1024 / 1024) +
      ' MB free tier (' +
      g.storagePct +
      '%). ' +
      'Top por size: ' +
      g.topBySize.map((e) => e.name + ' ' + e.count).join(', ') +
      '. ' +
      'Worst growth: ' +
      (g.worstCollection || '-') +
      ' +' +
      g.worstDelta +
      ' desde ultimo sync.';
  }
  return _hCard('Growth Colecciones', g.healthColor, mainText, subText, tooltip);
}

/**
 * Renderiza tabla de top Sentry issues cuando hay datos.
 */
function _renderSentryDetail() {
  const p = _pure();
  const sentryDoc = window.SENTRY_STATUS || null;
  if (!sentryDoc) return '';
  const s = p.summarizeSentryStatus ? p.summarizeSentryStatus(sentryDoc) : null;
  if (!s) return '';

  // Si esta not_configured o error, mostrar banner con el mensaje.
  if (s.status === 'not_configured' || s.status === 'error') {
    const bannerColor = s.status === 'error' ? '#fef2f2' : '#f8fafc';
    const borderColor = s.status === 'error' ? '#fecaca' : '#e2e8f0';
    const textColor = s.status === 'error' ? '#991b1b' : '#475569';
    return (
      '<div class="pc-section" style="margin-bottom:24px">' +
      '<h3 style="margin:0 0 12px 0;font-size:14px;color:var(--text-primary);font-weight:800;text-transform:uppercase;letter-spacing:.5px">Sentry</h3>' +
      '<div style="background:' +
      bannerColor +
      ';border:1px solid ' +
      borderColor +
      ';border-radius:6px;padding:12px 16px;font-size:12px;color:' +
      textColor +
      '">' +
      '<b>' +
      (s.status === 'error' ? 'Sync Error' : 'No configurado') +
      '</b><br>' +
      _escHtml(s.errorMessage || '') +
      '</div></div>'
    );
  }
  if (s.status !== 'ok' || !s.recentIssues.length) return '';

  let html =
    '<div class="pc-section" style="margin-bottom:24px">' +
    '<h3 style="margin:0 0 12px 0;font-size:14px;color:var(--text-primary);font-weight:800;text-transform:uppercase;letter-spacing:.5px">Sentry — Top issues (24h)</h3>' +
    '<div style="border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="background:var(--bg-muted)">' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Nivel</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Titulo</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Ocurrencias</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Usuarios</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Ultima vez</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Link</th>' +
    '</tr></thead><tbody>';
  for (const it of s.recentIssues) {
    const lvl = String(it.level || 'unknown').toLowerCase();
    let lvlColor = HEALTH_COLORS.unknown;
    if (lvl === 'error' || lvl === 'fatal') lvlColor = HEALTH_COLORS.red;
    else if (lvl === 'warning') lvlColor = HEALTH_COLORS.yellow;
    else if (lvl === 'info') lvlColor = HEALTH_COLORS.green;
    const ageLabel = p.formatAgeLabel ? p.formatAgeLabel(it.lastSeen) : '-';
    const urlHtml = it.permalink
      ? '<a href="' +
        _escHtml(it.permalink) +
        '" target="_blank" rel="noopener" style="color:#1e40af;text-decoration:underline">' +
        _escHtml(it.shortId || 'ver') +
        '</a>'
      : '-';
    html +=
      '<tr style="border-top:1px solid #f1f5f9">' +
      '<td style="padding:5px 8px;color:' +
      lvlColor +
      ';font-weight:700;text-transform:uppercase">' +
      _escHtml(lvl) +
      '</td>' +
      '<td style="padding:5px 8px;color:var(--text-primary);font-weight:500;max-width:400px">' +
      _escHtml(it.title || '-') +
      '</td>' +
      '<td style="padding:5px 8px;color:var(--text-muted)">' +
      it.count +
      '</td>' +
      '<td style="padding:5px 8px;color:var(--text-muted)">' +
      it.userCount +
      '</td>' +
      '<td style="padding:5px 8px;color:var(--text-muted)">' +
      _escHtml(ageLabel) +
      '</td>' +
      '<td style="padding:5px 8px">' +
      urlHtml +
      '</td>' +
      '</tr>';
  }
  html += '</tbody></table></div></div>';
  return html;
}

/**
 * Renderiza detalle de workflows criticos como lista debajo del panel principal.
 * Solo se muestra si hay al menos 1 workflow con datos.
 */
function _renderGhActionsDetail() {
  const p = _pure();
  const ghDoc = window.GH_ACTIONS_STATUS || null;
  if (!ghDoc || !ghDoc.workflows) return '';
  const gh = p.summarizeGhActionsStatus ? p.summarizeGhActionsStatus(ghDoc) : null;
  if (!gh || !gh.criticalWorkflows.length) return '';

  let html =
    '<div class="pc-section" style="margin-bottom:24px">' +
    '<h3 style="margin:0 0 12px 0;font-size:14px;color:var(--text-primary);font-weight:800;text-transform:uppercase;letter-spacing:.5px">Workflows criticos</h3>' +
    '<div style="border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="background:var(--bg-muted)">' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Workflow</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Estado</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Ultima ejecucion</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Fallos recientes</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Link</th>' +
    '</tr></thead><tbody>';
  for (const w of gh.criticalWorkflows) {
    let statusColor = HEALTH_COLORS.green;
    let statusLabel = 'OK';
    if (w.conclusion === 'failure') {
      statusColor = HEALTH_COLORS.red;
      statusLabel = 'FAILURE';
    } else if (w.status === 'in_progress' || w.status === 'queued') {
      statusColor = HEALTH_COLORS.yellow;
      statusLabel = String(w.status).toUpperCase();
    } else if (w.conclusion) {
      statusLabel = String(w.conclusion).toUpperCase();
    }
    const ageLabel = p.formatAgeLabel ? p.formatAgeLabel(w.lastRunAt) : '-';
    const urlHtml = w.url
      ? '<a href="' +
        _escHtml(w.url) +
        '" target="_blank" rel="noopener" style="color:#1e40af;text-decoration:underline">ver</a>'
      : '-';
    html +=
      '<tr style="border-top:1px solid #f1f5f9">' +
      '<td style="padding:5px 8px;color:var(--text-primary);font-weight:600">' +
      _escHtml(w.name) +
      '</td>' +
      '<td style="padding:5px 8px"><span style="color:' +
      statusColor +
      ';font-weight:800">&#9679; ' +
      _escHtml(statusLabel) +
      '</span></td>' +
      '<td style="padding:5px 8px;color:var(--text-muted)">' +
      _escHtml(ageLabel) +
      '</td>' +
      '<td style="padding:5px 8px;color:' +
      (w.recentFailures > 5 ? '#dc2626' : w.recentFailures > 0 ? '#d97706' : '#64748b') +
      ';font-weight:' +
      (w.recentFailures > 0 ? '700' : '400') +
      '">' +
      w.recentFailures +
      ' / 20 ult.</td>' +
      '<td style="padding:5px 8px">' +
      urlHtml +
      '</td>' +
      '</tr>';
  }
  html += '</tbody></table></div></div>';
  return html;
}

function _renderPedidosSection() {
  const p = _pure();
  const gp = Array.isArray(window.globalPedidos) ? window.globalPedidos : [];
  const br = p.computePedidosBreakdown
    ? p.computePedidosBreakdown(gp)
    : {
        total: 0,
        borrador: 0,
        pending: 0,
        confirmed: 0,
        withTransferSap: 0,
        viaAppOnly: 0,
        closed: 0,
      };
  return _sectionWrap(
    'Pedidos',
    _kpiCard(
      'Total abiertos',
      String(br.total - br.closed),
      br.closed + ' cerrados historicos',
      '#0f172a'
    ) +
      _kpiCard(
        'En Pendientes',
        String(br.pending),
        'stage=pending, sin CONFIRMAR DEFINITIVO',
        '#d97706'
      ) +
      _kpiCard('Confirmados', String(br.confirmed), 'stage=confirmed', '#166534') +
      _kpiCard(
        'Con SQ en SAP',
        String(br.withTransferSap - br.viaAppOnly),
        'transferidoSAP.via=service_layer_auto',
        '#1e40af'
      ) +
      _kpiCard(
        '100% BO (app_only)',
        String(br.viaAppOnly),
        'sin SQ en SAP, solo backorder app',
        '#c2410c'
      )
  );
}

function _renderBackorderSection() {
  const p = _pure();
  const sapBo = window.STOCK_BACKORDER || {};
  const appBo = window.STOCK_BACKORDER_APP || {};
  const t = p.computeBackorderTotals
    ? p.computeBackorderTotals(sapBo, appBo)
    : { sapQtyTotal: 0, sapSkuCount: 0, appQtyTotal: 0, appSkuCount: 0 };
  const gp = Array.isArray(window.globalPedidos) ? window.globalPedidos : [];
  const overlap = p.computeStrictOverlap
    ? p.computeStrictOverlap(gp)
    : { strictDupsCount: 0, strictDupsPedidoIds: [] };
  const overlapColor = overlap.strictDupsCount > 0 ? '#dc2626' : '#16a34a';
  return _sectionWrap(
    'Backorder',
    _kpiCard(
      'SAP-source',
      String(Math.round(t.sapQtyTotal || 0)) + 'u',
      (t.sapSkuCount || 0) + ' SKUs unicos',
      '#1e40af'
    ) +
      _kpiCard(
        'APP-source',
        String(Math.round(t.appQtyTotal || 0)) + 'u',
        (t.appSkuCount || 0) + ' SKUs unicos',
        '#7c3aed'
      ) +
      _kpiCard(
        'Duplicaciones STRICT',
        String(overlap.strictDupsCount),
        overlap.strictDupsCount === 0 ? 'invariante OK' : 'PEDIDOS afectados',
        overlapColor
      )
  );
}

function _renderOpsLogSection() {
  const p = _pure();
  const cache = Array.isArray(window.opsLogCache) ? window.opsLogCache : [];
  const recent = p.filterOpsLogRecent ? p.filterOpsLogRecent(cache, 20) : cache.slice(0, 20);
  let html =
    '<div class="pc-section" style="margin-bottom:24px">' +
    '<h3 style="margin:0 0 12px 0;font-size:14px;color:var(--text-primary);font-weight:800;text-transform:uppercase;letter-spacing:.5px">Actividad reciente (opsLog)</h3>';
  if (!recent.length) {
    html +=
      '<div style="color:var(--text-muted);font-size:12px;padding:12px;background:var(--bg-secondary);border-radius:6px">Sin ops registrados en los ultimos 2000 eventos.</div>';
  } else {
    html +=
      '<div style="max-height:260px;overflow:auto;border:1px solid var(--border-subtle);border-radius:6px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
      '<thead><tr style="background:var(--bg-muted);position:sticky;top:0">' +
      '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Timestamp</th>' +
      '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Usuario</th>' +
      '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Accion</th>' +
      '<th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--text-secondary)">Entidad</th>' +
      '</tr></thead><tbody>';
    for (const op of recent) {
      let ts = '-';
      try {
        if (op.timestamp && typeof op.timestamp.toDate === 'function') {
          ts = op.timestamp.toDate().toISOString().slice(0, 19).replace('T', ' ');
        } else if (op.timestamp) {
          ts = String(op.timestamp);
        }
      } catch (_e) {}
      const userShort = String(op.userEmail || '-').split('@')[0];
      html +=
        '<tr style="border-top:1px solid #f1f5f9">' +
        '<td style="padding:5px 8px;color:var(--text-muted);font-family:monospace">' +
        _escHtml(ts) +
        '</td>' +
        '<td style="padding:5px 8px;color:var(--text-secondary)">' +
        _escHtml(userShort) +
        '</td>' +
        '<td style="padding:5px 8px;color:var(--text-primary);font-weight:600">' +
        _escHtml(op.action || '-') +
        '</td>' +
        '<td style="padding:5px 8px;color:var(--text-muted)">' +
        _escHtml((op.entityType || '') + ' / ' + (op.entityName || '')) +
        '</td>' +
        '</tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';
  return html;
}

window.openPanelControl = function () {
  const p = _pure();
  const canView =
    p.canViewPanel && p.canViewPanel(window.currentUser || null, window.userRole || null);
  if (!canView) {
    alert('Panel de Control: no autorizado.');
    return;
  }
  const modal = document.getElementById('panel-control-modal');
  if (!modal) return;
  modal.classList.add('open');
  window.renderPanelControl();
};

window.closePanelControl = function () {
  const modal = document.getElementById('panel-control-modal');
  if (modal) modal.classList.remove('open');
};

window.renderPanelControl = function () {
  const body = document.getElementById('panel-control-body');
  if (!body) return;
  let html = '<div style="padding:16px 20px">';
  html += _renderInfraSection();
  html += _renderGhActionsDetail();
  html += _renderSentryDetail();
  html += _renderPedidosSection();
  html += _renderBackorderSection();
  html += _renderOpsLogSection();
  html +=
    '<div style="text-align:right;font-size:10.5px;color:var(--text-muted);margin-top:8px">Renderizado ' +
    _escHtml(new Date().toLocaleTimeString('es-AR')) +
    ' - Click "Refrescar" para actualizar</div>';
  html += '</div>';
  body.innerHTML = html;
};
