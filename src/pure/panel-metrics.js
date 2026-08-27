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

/**
 * Resume estado del health check SAP SL (`app_config/sap_sl_health`).
 * Escrito por CF checkSapSlHealthCF cada 5 min.
 *
 * @param {any} doc doc completo o null
 * @returns {{
 *   status: 'ok' | 'error' | 'unknown',
 *   healthColor: 'green' | 'yellow' | 'red' | 'unknown',
 *   latencyLabel: string,
 *   ageLabel: string,
 *   consecutiveFailures: number,
 *   firstFailureAgoLabel: string,
 *   errorMessage: string | null,
 * }}
 */
export function summarizeSapSlHealth(doc) {
  if (!doc) {
    return {
      status: 'unknown',
      healthColor: 'unknown',
      latencyLabel: 'sin datos',
      ageLabel: 'sin datos',
      consecutiveFailures: 0,
      firstFailureAgoLabel: '',
      errorMessage: null,
    };
  }
  const status = doc.status || 'unknown';
  const consecutive = Number(doc.consecutiveFailures) || 0;
  const latencyMs = Number(doc.latencyMs) || 0;

  /** @type {'green' | 'yellow' | 'red' | 'unknown'} */
  let healthColor;
  if (status === 'ok' && latencyMs < 3000) healthColor = 'green';
  else if (status === 'ok')
    healthColor = 'yellow'; // ok pero lento (>3s)
  else if (consecutive === 1)
    healthColor = 'yellow'; // 1 fail aislado
  else if (consecutive > 1)
    healthColor = 'red'; // 2+ consecutivos
  else healthColor = 'unknown';

  const latencyLabel =
    latencyMs > 0
      ? latencyMs < 1000
        ? latencyMs + 'ms'
        : (latencyMs / 1000).toFixed(1) + 's'
      : 'sin datos';
  return {
    status,
    healthColor,
    latencyLabel,
    ageLabel: formatAgeLabel(doc.lastCheckAt),
    consecutiveFailures: consecutive,
    firstFailureAgoLabel: doc.firstFailureAt ? formatAgeLabel(doc.firstFailureAt) : '',
    errorMessage: doc.errorMessage || null,
  };
}

/**
 * Compara errorCount de doc Sentry actual vs promedio 24h para detectar spike.
 * Doc puede incluir field `errorCountHistory` = [{hourIso, count}, ...] (last 24h).
 *
 * @param {any} sentryDoc
 * @returns {{
 *   currentHourErrors: number,
 *   avg24hHourly: number,
 *   spikeRatio: number,
 *   spikeAlert: 'green' | 'yellow' | 'red',
 * }}
 */
export function computeSentryRateSpike(sentryDoc) {
  if (!sentryDoc || !Array.isArray(sentryDoc.errorCountHistory)) {
    return {
      currentHourErrors: 0,
      avg24hHourly: 0,
      spikeRatio: 0,
      spikeAlert: 'green',
    };
  }
  const history = sentryDoc.errorCountHistory;
  if (!history.length) {
    return { currentHourErrors: 0, avg24hHourly: 0, spikeRatio: 0, spikeAlert: 'green' };
  }
  // Ultimo bucket = hora actual (approx).
  const current = Number(history[history.length - 1].count) || 0;
  // Promedio de los 23 previos (excluyendo el actual).
  const priorHours = history.slice(0, -1);
  const sumPrior = priorHours.reduce(
    (/** @type {number} */ s, /** @type {any} */ h) => s + (Number(h.count) || 0),
    0
  );
  const avg = priorHours.length ? sumPrior / priorHours.length : 0;
  const ratio = avg > 0 ? current / avg : current > 0 ? Infinity : 0;
  /** @type {'green' | 'yellow' | 'red'} */
  let alert = 'green';
  // Solo alerta si hay minimo de eventos (evitar spikes falsos con 0→1).
  if (current >= 3) {
    if (ratio > 5) alert = 'red';
    else if (ratio > 2) alert = 'yellow';
  }
  return {
    currentHourErrors: current,
    avg24hHourly: Number(avg.toFixed(2)),
    spikeRatio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : 0,
    spikeAlert: alert,
  };
}

/**
 * v625: summarize Firestore quota doc (app_config/firestore_quota).
 *
 * Compara uso 24h vs free tier limits. Health color:
 * - green: max(ratio) <= 0.5 (menos de 50% en TODAS las metricas)
 * - yellow: max(ratio) <= 0.8
 * - red: cualquiera > 80%
 * - unknown: sin doc, sin sync, o status=error
 *
 * @param {any} quotaDoc
 * @returns {{
 *   status: 'ok' | 'error' | 'unknown',
 *   healthColor: 'green' | 'yellow' | 'red' | 'unknown',
 *   reads24h: number,
 *   writes24h: number,
 *   deletes24h: number,
 *   storageBytes: number,
 *   readsPct: number,
 *   writesPct: number,
 *   deletesPct: number,
 *   storagePct: number,
 *   worstPct: number,
 *   syncedAgoLabel: string,
 *   errorMessage: string | null,
 * }}
 */
export function summarizeFirestoreQuota(quotaDoc) {
  if (!quotaDoc) {
    return {
      status: 'unknown',
      healthColor: 'unknown',
      reads24h: 0,
      writes24h: 0,
      deletes24h: 0,
      storageBytes: 0,
      readsPct: 0,
      writesPct: 0,
      deletesPct: 0,
      storagePct: 0,
      worstPct: 0,
      syncedAgoLabel: 'sin datos',
      errorMessage: null,
    };
  }
  const status = quotaDoc.status || 'unknown';
  const ft = quotaDoc.freeTier || {};
  const readsQ = Number(ft.reads) || 50000;
  const writesQ = Number(ft.writes) || 20000;
  const deletesQ = Number(ft.deletes) || 20000;
  const storageQ = Number(ft.storageBytes) || 1073741824;
  const reads = Number(quotaDoc.reads24h) || 0;
  const writes = Number(quotaDoc.writes24h) || 0;
  const deletes = Number(quotaDoc.deletes24h) || 0;
  const storage = Number(quotaDoc.storageBytes) || 0;
  const readsPct = readsQ > 0 ? reads / readsQ : 0;
  const writesPct = writesQ > 0 ? writes / writesQ : 0;
  const deletesPct = deletesQ > 0 ? deletes / deletesQ : 0;
  const storagePct = storageQ > 0 ? storage / storageQ : 0;
  const worst = Math.max(readsPct, writesPct, deletesPct, storagePct);
  /** @type {'green' | 'yellow' | 'red' | 'unknown'} */
  let health = 'unknown';
  if (status === 'ok') {
    if (worst <= 0.5) health = 'green';
    else if (worst <= 0.8) health = 'yellow';
    else health = 'red';
  }
  return {
    status,
    healthColor: health,
    reads24h: reads,
    writes24h: writes,
    deletes24h: deletes,
    storageBytes: storage,
    readsPct: Number((readsPct * 100).toFixed(1)),
    writesPct: Number((writesPct * 100).toFixed(1)),
    deletesPct: Number((deletesPct * 100).toFixed(1)),
    storagePct: Number((storagePct * 100).toFixed(1)),
    worstPct: Number((worst * 100).toFixed(1)),
    syncedAgoLabel: formatAgeLabel(quotaDoc.syncedAt),
    errorMessage: quotaDoc.errorMessage || null,
  };
}

/**
 * v686 (2026-08-27) Summarize Collections Growth doc para card del Panel.
 * Input: doc app_config/collections_growth escrito por sync_collections_growth.py.
 *
 * Retorna: worst collection por delta7d, total bytes estimados, % free tier
 * storage, top 3 collections por size, top 3 por delta.
 *
 * Health:
 *   - red si totalBytes > 80% free tier o worst delta > 500 docs/6h
 *   - yellow si totalBytes > 50% free tier o worst delta > 100 docs/6h
 *   - green sino
 *   - unknown si no hay doc
 *
 * @param {object|null} growthDoc - {collections, freeTierBytes, totalBytesAllCollections, worstGrowthCollection, worstGrowthDelta7d, syncedAt, status}
 */
export function summarizeCollectionsGrowth(growthDoc) {
  if (!growthDoc || !growthDoc.collections) {
    return {
      status: 'unknown',
      healthColor: 'unknown',
      totalBytes: 0,
      totalMB: 0,
      freeTierBytes: 1073741824,
      storagePct: 0,
      topBySize: [],
      topByDelta: [],
      worstCollection: '',
      worstDelta: 0,
      syncedAgoLabel: 'sin datos',
    };
  }
  const cols = growthDoc.collections || {};
  const freeTier = Number(growthDoc.freeTierBytes) || 1073741824;
  const total = Number(growthDoc.totalBytesAllCollections) || 0;
  const totalMB = Number((total / 1024 / 1024).toFixed(1));
  const storagePct = freeTier > 0 ? total / freeTier : 0;

  const entries = Object.entries(cols).map(([name, m]) => ({
    name,
    count: Number(m.count) || 0,
    avgBytesDoc: Number(m.avgBytesDoc) || 0,
    totalBytes: Number(m.totalBytes) || 0,
    delta7d: Number(m.delta7d) || 0,
  }));

  const topBySize = entries
    .filter((e) => e.totalBytes > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 3);

  const topByDelta = entries
    .filter((e) => e.delta7d > 0)
    .sort((a, b) => b.delta7d - a.delta7d)
    .slice(0, 3);

  const worst = Number(growthDoc.worstGrowthDelta7d) || 0;
  let health = 'green';
  if (storagePct > 0.8 || worst > 500) health = 'red';
  else if (storagePct > 0.5 || worst > 100) health = 'yellow';

  return {
    status: growthDoc.status || 'ok',
    healthColor: health,
    totalBytes: total,
    totalMB,
    freeTierBytes: freeTier,
    storagePct: Number((storagePct * 100).toFixed(2)),
    topBySize,
    topByDelta,
    worstCollection: String(growthDoc.worstGrowthCollection || ''),
    worstDelta: worst,
    syncedAgoLabel: formatAgeLabel(growthDoc.syncedAt),
  };
}

/**
 * v686 Fase E3 (2026-08-27) Detecta pedidos "stuck" en pending por muchos dias
 * (indica que el vendedor no cerro el flow con Confirmar Definitivamente).
 *
 * @param {Array<{stage?:string, confirmedAt?:any, finalizedAt?:any, transferidoSAP?:any, clientName?:string, ownerVendor?:string}>} pedidos - globalPedidos array
 * @param {Date} now - fecha actual (para test determinista)
 * @param {number} thresholdDays - default 7 dias
 */
export function findStuckPendingPedidos(pedidos, now, thresholdDays) {
  const th = thresholdDays || 7;
  const nowTs = now && now.getTime ? now.getTime() : Date.now();
  const threshMs = th * 24 * 60 * 60 * 1000;
  const list = Array.isArray(pedidos) ? pedidos : [];
  const stuck = [];
  for (const p of list) {
    if (!p || p.stage !== 'pending') continue;
    // Si ya se transfirio a SAP, no cuenta (aunque siga en pending por bug).
    if (p.transferidoSAP && p.transferidoSAP.transferredAt) continue;
    const ts = p.confirmedAt || p.finalizedAt || p.createdAt;
    if (!ts) continue;
    let d = null;
    if (typeof ts === 'string') {
      d = new Date(ts);
    } else if (ts && typeof ts.toDate === 'function') {
      try {
        d = ts.toDate();
      } catch (_e) {
        d = null;
      }
    }
    if (!d || Number.isNaN(d.getTime())) continue;
    const ageMs = nowTs - d.getTime();
    if (ageMs < threshMs) continue;
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    stuck.push({
      clientName: String(p.clientName || '-'),
      ownerVendor: String(p.ownerVendor || '-'),
      ageDays,
      confirmedAt: d.toISOString().slice(0, 10),
    });
  }
  stuck.sort((a, b) => b.ageDays - a.ageDays);
  let health = 'green';
  if (stuck.length >= 10) health = 'red';
  else if (stuck.length >= 3) health = 'yellow';
  return {
    healthColor: health,
    count: stuck.length,
    thresholdDays: th,
    top5: stuck.slice(0, 5),
  };
}

/**
 * v686 Fase E3 (2026-08-27) Detecta provisorios (client_applications) sin
 * cardCodeSap hace muchos dias - probablemente dead entries que deberian
 * cerrarse.
 *
 * @param {Array<{cardCodeSap?:string, manualSapPending?:boolean, createdAt?:any, comercio?:string, titular?:string, provincia?:string, ownerEmail?:string}>} applications
 * @param {Date} now
 * @param {number} thresholdDays - default 30
 */
export function findDeadProvisorios(applications, now, thresholdDays) {
  const th = thresholdDays || 30;
  const nowTs = now && now.getTime ? now.getTime() : Date.now();
  const threshMs = th * 24 * 60 * 60 * 1000;
  const list = Array.isArray(applications) ? applications : [];
  const dead = [];
  for (const a of list) {
    if (!a) continue;
    // Un provisorio = tiene manualSapPending=true Y no tiene cardCodeSap.
    if (a.cardCodeSap) continue;
    if (!a.manualSapPending) continue;
    const ts = a.createdAt;
    if (!ts) continue;
    let d = null;
    if (typeof ts === 'string') {
      d = new Date(ts);
    } else if (ts && typeof ts.toDate === 'function') {
      try {
        d = ts.toDate();
      } catch (_e) {
        d = null;
      }
    }
    if (!d || Number.isNaN(d.getTime())) continue;
    const ageMs = nowTs - d.getTime();
    if (ageMs < threshMs) continue;
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    dead.push({
      comercio: String(a.comercio || a.titular || '-'),
      provincia: String(a.provincia || '-'),
      ageDays,
      createdAt: d.toISOString().slice(0, 10),
      ownerEmail: String(a.ownerEmail || '-'),
    });
  }
  dead.sort((a, b) => b.ageDays - a.ageDays);
  let health = 'green';
  if (dead.length >= 20) health = 'red';
  else if (dead.length >= 5) health = 'yellow';
  return {
    healthColor: health,
    count: dead.length,
    thresholdDays: th,
    top5: dead.slice(0, 5),
  };
}

/**
 * v687 Fase E2 (2026-08-27) Summarize Cloud Storage usage doc.
 * Input: app_config/storage_usage escrito por sync_storage_usage.py.
 * Health: red >80% free tier, yellow >50%, green sino.
 */
export function summarizeStorageUsage(doc) {
  if (!doc) {
    return {
      status: 'unknown',
      healthColor: 'unknown',
      totalGB: 0,
      storagePct: 0,
      topFolders: [],
      buckets: [],
      syncedAgoLabel: 'sin datos',
    };
  }
  const total = Number(doc.totalBytes) || 0;
  const freeTier = Number(doc.freeTierBytes) || 5 * 1024 * 1024 * 1024;
  const pct = freeTier > 0 ? total / freeTier : 0;
  let health = 'green';
  if (pct > 0.8) health = 'red';
  else if (pct > 0.5) health = 'yellow';
  return {
    status: doc.status || 'ok',
    healthColor: health,
    totalGB: Number(doc.totalGB) || Number((total / 1024 / 1024 / 1024).toFixed(3)),
    totalMB: Number((total / 1024 / 1024).toFixed(1)),
    storagePct: Number((pct * 100).toFixed(1)),
    topFolders: Array.isArray(doc.topFolders) ? doc.topFolders : [],
    buckets: Array.isArray(doc.buckets) ? doc.buckets : [],
    syncedAgoLabel: formatAgeLabel(doc.syncedAt),
  };
}

/**
 * v687 Fase E4 (2026-08-27) Summarize CF health doc (errors + p95 por funcion).
 * Health del card:
 *   - red si hay alguna funcion en red o worstErrors24h > 20
 *   - yellow si alguna yellow o worstErrors > 5
 *   - green sino
 *   - unknown si status=error o sin datos
 */
export function summarizeCfHealth(doc) {
  if (!doc || doc.status === 'error') {
    return {
      status: doc && doc.status === 'error' ? 'error' : 'unknown',
      healthColor: 'unknown',
      totalFunctions: 0,
      worstFunction: '',
      worstErrors24h: 0,
      totalErrors24h: 0,
      topByErrors: [],
      slowest: [],
      errorMessage: (doc && doc.errorMessage) || null,
      syncedAgoLabel: doc ? formatAgeLabel(doc.syncedAt) : 'sin datos',
    };
  }
  const funcs = doc.functions || {};
  const entries = Object.entries(funcs).map(([name, f]) => ({
    name,
    errors24h: Number(f.errors24h) || 0,
    invocations24h: Number(f.invocations24h) || 0,
    p95Ms: Number(f.p95Ms) || 0,
    healthColor: f.healthColor || 'green',
  }));
  const totalErrors = entries.reduce((s, e) => s + e.errors24h, 0);
  const topByErrors = entries
    .filter((e) => e.errors24h > 0)
    .sort((a, b) => b.errors24h - a.errors24h)
    .slice(0, 5);
  const slowest = entries
    .filter((e) => e.p95Ms > 0)
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, 5);
  const worstErrors = Number(doc.worstErrors24h) || 0;
  let health = 'green';
  const anyRed = entries.some((e) => e.healthColor === 'red');
  const anyYellow = entries.some((e) => e.healthColor === 'yellow');
  if (anyRed || worstErrors > 20) health = 'red';
  else if (anyYellow || worstErrors > 5) health = 'yellow';
  return {
    status: doc.status || 'ok',
    healthColor: health,
    totalFunctions: entries.length,
    worstFunction: String(doc.worstFunction || ''),
    worstErrors24h: worstErrors,
    totalErrors24h: totalErrors,
    topByErrors,
    slowest,
    errorMessage: null,
    syncedAgoLabel: formatAgeLabel(doc.syncedAt),
  };
}
