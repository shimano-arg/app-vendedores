// @ts-check
/**
 * v611 (2026-08-24): fns puras para PANEL DE CONTROL.
 *
 * Computa metricas de salud + KPIs a partir de datos ya cargados en memoria
 * del browser (globalPedidos, STOCK_UPDATED_AT, STOCK_BACKORDER, opsLogCache).
 * Sin side effects, testeable con vitest.
 *
 * El panel es visible SOLO para Mariano (double gate email + role admin).
 */

const MARIANO_EMAILS = new Set(['mariano.erbino@shimano.com.ar', 'erbinomariano@gmail.com']);

/**
 * Gate de acceso al panel. Solo Mariano (admin + email en whitelist).
 * @param {{ email?: string } | null | undefined} user
 * @param {string | null | undefined} role
 * @returns {boolean}
 */
export function canViewPanel(user, role) {
  if (!user || !user.email) return false;
  if (role !== 'admin') return false;
  return MARIANO_EMAILS.has(String(user.email).toLowerCase());
}

/**
 * Semaforo de salud basado en edad de un timestamp.
 * @param {string | Date | null | undefined} lastUpdateIso
 * @param {{ greenMaxMinutes: number, yellowMaxMinutes: number }} thresholds
 * @returns {'green' | 'yellow' | 'red' | 'unknown'}
 */
export function computeHealthStatus(lastUpdateIso, thresholds) {
  if (!lastUpdateIso) return 'unknown';
  const ageMin = computeAgeMinutes(lastUpdateIso);
  if (ageMin == null) return 'unknown';
  if (ageMin <= thresholds.greenMaxMinutes) return 'green';
  if (ageMin <= thresholds.yellowMaxMinutes) return 'yellow';
  return 'red';
}

/**
 * Retorna minutos entre now y el timestamp dado. Null si es invalido.
 * @param {string | Date | null | undefined} iso
 * @returns {number | null}
 */
export function computeAgeMinutes(iso) {
  if (!iso) return null;
  let d;
  try {
    d = iso instanceof Date ? iso : new Date(iso);
  } catch (_e) {
    return null;
  }
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 60000);
}

/**
 * Label humanamente legible de la edad (ej: "hace 3 min", "hace 2h").
 * @param {string | Date | null | undefined} iso
 * @returns {string}
 */
export function formatAgeLabel(iso) {
  const min = computeAgeMinutes(iso);
  if (min == null) return 'sin datos';
  if (min < 1) return 'hace <1 min';
  if (min < 60) return 'hace ' + Math.round(min) + ' min';
  const h = min / 60;
  if (h < 24) return 'hace ' + h.toFixed(1) + 'h';
  const d = h / 24;
  return 'hace ' + d.toFixed(1) + 'd';
}

/**
 * Breakdown de pedidos por stage.
 * @param {any[]} globalPedidos
 * @returns {{
 *   total: number,
 *   borrador: number,
 *   pending: number,
 *   confirmed: number,
 *   withTransferSap: number,
 *   viaAppOnly: number,
 *   closed: number,
 * }}
 */
export function computePedidosBreakdown(globalPedidos) {
  const out = {
    total: 0,
    borrador: 0,
    pending: 0,
    confirmed: 0,
    withTransferSap: 0,
    viaAppOnly: 0,
    closed: 0,
  };
  if (!Array.isArray(globalPedidos)) return out;
  for (const p of globalPedidos) {
    if (!p) continue;
    out.total++;
    if (p.closedAt) {
      out.closed++;
      continue;
    }
    const stage = p.stage || '';
    if (stage === 'crear') out.borrador++;
    else if (stage === 'pending') out.pending++;
    else if (stage === 'confirmed') out.confirmed++;
    if (p.transferidoSAP) {
      out.withTransferSap++;
      if (p.transferidoSAP.via === 'app_only') out.viaAppOnly++;
    }
  }
  return out;
}

/**
 * Totales de backorder por fuente + cantidad de SKUs unicos.
 * @param {Record<string, number> | null | undefined} stockBackorder SAP-source
 * @param {Record<string, number> | null | undefined} stockBackorderApp APP-source
 * @returns {{
 *   sapQtyTotal: number,
 *   sapSkuCount: number,
 *   appQtyTotal: number,
 *   appSkuCount: number,
 * }}
 */
export function computeBackorderTotals(stockBackorder, stockBackorderApp) {
  const sap = stockBackorder || {};
  const app = stockBackorderApp || {};
  /** @param {Record<string, number>} obj */
  const _sum = (obj) => {
    let s = 0;
    let n = 0;
    for (const k of Object.keys(obj)) {
      const v = Number(obj[k]) || 0;
      if (v > 0) {
        s += v;
        n++;
      }
    }
    return { qty: s, count: n };
  };
  const sapR = _sum(sap);
  const appR = _sum(app);
  return {
    sapQtyTotal: sapR.qty,
    sapSkuCount: sapR.count,
    appQtyTotal: appR.qty,
    appSkuCount: appR.count,
  };
}

/**
 * Cuenta duplicaciones STRICT (misma logica que v602 detector runtime).
 * Ver index.html:_diagBackorderOverlap.
 * @param {any[]} globalPedidos
 * @returns {{ strictDupsCount: number, strictDupsPedidoIds: string[] }}
 */
export function computeStrictOverlap(globalPedidos) {
  const SAP_STATES = new Set(['confirmed', 'invoiced']);
  const APP_STATES = new Set(['BO', 'ASIG']);
  const dupPedidoIds = new Set();
  if (!Array.isArray(globalPedidos)) return { strictDupsCount: 0, strictDupsPedidoIds: [] };
  for (const p of globalPedidos) {
    if (!p || !p.transferidoSAP) continue;
    const bySku = new Map();
    for (const l of p.lines || []) {
      if (!l || !l.code) continue;
      const qtyOpen = Number(l.qtyOpen != null ? l.qtyOpen : l.qty) || 0;
      if (qtyOpen <= 0) continue;
      const sku = String(l.code).toUpperCase();
      const arr = bySku.get(sku) || [];
      arr.push(l);
      bySku.set(sku, arr);
    }
    for (const group of bySku.values()) {
      if (group.length < 2) continue;
      const hasSap = group.some((/** @type {any} */ g) => SAP_STATES.has(g.state));
      const hasApp = group.some((/** @type {any} */ g) => APP_STATES.has(g.state));
      if (hasSap && hasApp) {
        dupPedidoIds.add(p._fsId || p.id || 'unknown');
        break;
      }
    }
  }
  return {
    strictDupsCount: dupPedidoIds.size,
    strictDupsPedidoIds: Array.from(dupPedidoIds),
  };
}

/**
 * Filtra opsLog para eventos de interes (errores o backups o SAP failures).
 * @param {any[]} opsLogCache
 * @param {number} [limit=20]
 * @returns {any[]}
 */
export function filterOpsLogRecent(opsLogCache, limit = 20) {
  if (!Array.isArray(opsLogCache)) return [];
  return opsLogCache.slice(0, limit);
}

/**
 * Resume estado de GitHub Actions doc (`app_config/gh_actions_status`).
 * Vino escrito por scripts/sync_gh_actions_status.py cada 5 min.
 *
 * @param {any} ghDoc doc completo o null si listener aun no llegó
 * @returns {{
 *   healthColor: 'green' | 'yellow' | 'red' | 'unknown',
 *   totalWorkflows: number,
 *   criticalFailingCount: number,
 *   criticalWorkflows: any[],
 *   syncedAgoLabel: string,
 * }}
 */
export function summarizeGhActionsStatus(ghDoc) {
  if (!ghDoc || !ghDoc.workflows) {
    return {
      healthColor: 'unknown',
      totalWorkflows: 0,
      criticalFailingCount: 0,
      criticalWorkflows: [],
      syncedAgoLabel: formatAgeLabel(ghDoc ? ghDoc.syncedAt : null),
    };
  }
  const wfs = ghDoc.workflows || {};
  const critical = [];
  let failing = 0;
  for (const name of Object.keys(wfs)) {
    const w = wfs[name] || {};
    if (!w.isCritical) continue;
    critical.push({
      name,
      status: w.lastRunStatus,
      conclusion: w.lastRunConclusion,
      lastRunAt: w.lastRunAt,
      url: w.lastRunUrl,
      recentFailures: w.recentFailures || 0,
    });
    if (w.lastRunConclusion === 'failure') failing++;
  }
  critical.sort((a, b) => {
    // Failing primero, despues por nombre.
    if (a.conclusion === 'failure' && b.conclusion !== 'failure') return -1;
    if (a.conclusion !== 'failure' && b.conclusion === 'failure') return 1;
    return a.name.localeCompare(b.name);
  });
  const totalCritical = critical.length || 1;
  const failRatio = failing / totalCritical;
  /** @type {'green' | 'yellow' | 'red' | 'unknown'} */
  let healthColor = 'green';
  if (failing === 0) healthColor = 'green';
  else if (failRatio < 0.4) healthColor = 'yellow';
  else healthColor = 'red';
  return {
    healthColor,
    totalWorkflows: Object.keys(wfs).length,
    criticalFailingCount: failing,
    criticalWorkflows: critical,
    syncedAgoLabel: formatAgeLabel(ghDoc.syncedAt),
  };
}

/**
 * Resume estado de Sentry issues doc (`app_config/sentry_issues`).
 * Escrito por scripts/sync_sentry_issues.py cada 15 min.
 *
 * @param {any} sentryDoc doc completo o null si listener no llego
 * @returns {{
 *   status: 'ok' | 'not_configured' | 'error' | 'unknown',
 *   healthColor: 'green' | 'yellow' | 'red' | 'unknown',
 *   totalUnresolved: number,
 *   errorCount: number,
 *   warningCount: number,
 *   recentIssues: any[],
 *   syncedAgoLabel: string,
 *   errorMessage: string | null,
 * }}
 */
export function summarizeSentryStatus(sentryDoc) {
  if (!sentryDoc) {
    return {
      status: 'unknown',
      healthColor: 'unknown',
      totalUnresolved: 0,
      errorCount: 0,
      warningCount: 0,
      recentIssues: [],
      syncedAgoLabel: 'sin datos',
      errorMessage: null,
    };
  }
  const status = sentryDoc.status || 'unknown';
  const byLevel = sentryDoc.byLevel || {};
  const errorCount = Number(byLevel.error || byLevel.fatal || 0);
  const warningCount = Number(byLevel.warning || 0);
  const total = Number(sentryDoc.totalUnresolved || 0);

  /** @type {'green' | 'yellow' | 'red' | 'unknown'} */
  let healthColor = 'green';
  if (status === 'not_configured') healthColor = 'unknown';
  else if (status === 'error')
    healthColor = 'yellow'; // sync fallando pero no rompe app
  else if (errorCount > 5) healthColor = 'red';
  else if (errorCount > 0 || warningCount > 10) healthColor = 'yellow';
  else healthColor = 'green';

  return {
    status,
    healthColor,
    totalUnresolved: total,
    errorCount,
    warningCount,
    recentIssues: Array.isArray(sentryDoc.recentIssues) ? sentryDoc.recentIssues : [],
    syncedAgoLabel: formatAgeLabel(sentryDoc.syncedAt),
    errorMessage: sentryDoc.errorMessage || null,
  };
}
