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

  return _sectionWrap(
    'Infraestructura',
    _hCard(
      'Stock Snapshot',
      stockStatus,
      stockLabel,
      'sync_sap_to_firestore.py cada 5 min',
      'Ultima actualizacion del stock (dep 11 disp + backorderBySku). Verde <30min, amarillo <2h, rojo >2h.'
    ) +
      _hCard('GitHub Actions', gh.healthColor, ghMain, ghSub, ghTooltip) +
      _hCard(
        'Cloud Functions',
        'unknown',
        'pendiente (iter 3)',
        'Last invocations',
        'Placeholder para iter 3'
      )
  );
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
