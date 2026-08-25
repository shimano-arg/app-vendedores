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
    '" style="background:#fff;border:1.5px solid #e2e8f0;border-radius:8px;padding:14px 16px;min-width:200px;flex:1">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
    _healthDot(status) +
    '<div style="font-size:10.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.4px">' +
    _escHtml(title) +
    '</div></div>' +
    '<div style="font-size:20px;font-weight:800;color:#0f172a;margin-bottom:2px">' +
    _escHtml(mainText) +
    '</div>' +
    '<div style="font-size:11px;color:#64748b">' +
    _escHtml(subText) +
    '</div>' +
    '</div>'
  );
}

function _kpiCard(title, mainText, subText, color) {
  const c = color || '#0f172a';
  return (
    '<div class="pc-card" style="background:#fff;border:1.5px solid #e2e8f0;border-radius:8px;padding:14px 16px;min-width:200px;flex:1">' +
    '<div style="font-size:10.5px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">' +
    _escHtml(title) +
    '</div>' +
    '<div style="font-size:24px;font-weight:800;color:' +
    c +
    ';margin-bottom:2px">' +
    _escHtml(mainText) +
    '</div>' +
    '<div style="font-size:11px;color:#64748b">' +
    _escHtml(subText) +
    '</div>' +
    '</div>'
  );
}

function _sectionWrap(title, cardsHtml) {
  return (
    '<div class="pc-section" style="margin-bottom:24px">' +
    '<h3 style="margin:0 0 12px 0;font-size:14px;color:#0f172a;font-weight:800;text-transform:uppercase;letter-spacing:.5px">' +
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
      _hCard('CF Invoice Sync', cfStatus, cfLabel, cfSub, cfTooltip)
  );
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
      '<h3 style="margin:0 0 12px 0;font-size:14px;color:#0f172a;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Sentry</h3>' +
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
    '<h3 style="margin:0 0 12px 0;font-size:14px;color:#0f172a;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Sentry — Top issues (24h)</h3>' +
    '<div style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="background:#f1f5f9">' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Nivel</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Titulo</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Ocurrencias</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Usuarios</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Ultima vez</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Link</th>' +
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
      '<td style="padding:5px 8px;color:#0f172a;font-weight:500;max-width:400px">' +
      _escHtml(it.title || '-') +
      '</td>' +
      '<td style="padding:5px 8px;color:#64748b">' +
      it.count +
      '</td>' +
      '<td style="padding:5px 8px;color:#64748b">' +
      it.userCount +
      '</td>' +
      '<td style="padding:5px 8px;color:#64748b">' +
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
    '<h3 style="margin:0 0 12px 0;font-size:14px;color:#0f172a;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Workflows criticos</h3>' +
    '<div style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="background:#f1f5f9">' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Workflow</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Estado</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Ultima ejecucion</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Fallos recientes</th>' +
    '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Link</th>' +
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
      '<td style="padding:5px 8px;color:#0f172a;font-weight:600">' +
      _escHtml(w.name) +
      '</td>' +
      '<td style="padding:5px 8px"><span style="color:' +
      statusColor +
      ';font-weight:800">&#9679; ' +
      _escHtml(statusLabel) +
      '</span></td>' +
      '<td style="padding:5px 8px;color:#64748b">' +
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
    '<h3 style="margin:0 0 12px 0;font-size:14px;color:#0f172a;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Actividad reciente (opsLog)</h3>';
  if (!recent.length) {
    html +=
      '<div style="color:#94a3b8;font-size:12px;padding:12px;background:#f8fafc;border-radius:6px">Sin ops registrados en los ultimos 2000 eventos.</div>';
  } else {
    html +=
      '<div style="max-height:260px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
      '<thead><tr style="background:#f1f5f9;position:sticky;top:0">' +
      '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Timestamp</th>' +
      '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Usuario</th>' +
      '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Accion</th>' +
      '<th style="text-align:left;padding:6px 8px;font-weight:700;color:#475569">Entidad</th>' +
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
        '<td style="padding:5px 8px;color:#64748b;font-family:monospace">' +
        _escHtml(ts) +
        '</td>' +
        '<td style="padding:5px 8px;color:#475569">' +
        _escHtml(userShort) +
        '</td>' +
        '<td style="padding:5px 8px;color:#0f172a;font-weight:600">' +
        _escHtml(op.action || '-') +
        '</td>' +
        '<td style="padding:5px 8px;color:#64748b">' +
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
    '<div style="text-align:right;font-size:10.5px;color:#94a3b8;margin-top:8px">Renderizado ' +
    _escHtml(new Date().toLocaleTimeString('es-AR')) +
    ' - Click "Refrescar" para actualizar</div>';
  html += '</div>';
  body.innerHTML = html;
};
