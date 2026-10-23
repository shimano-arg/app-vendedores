// @ts-check
/**
 * §63 Fase 3 Capa 1 (v1444) — alertas de sync stale.
 *
 * Si no hay corrida exitosa de sync en los últimos 15 min:
 *   - Crea/update doc `alerts/stock_sync_stale` con lastCheckedAt + status + lastSuccessAt.
 *   - Envía email a Mariano (max 1 email/hora, controlado por doc meta).
 *
 * Mariano decisión Fase 3: "sí, email a mi casilla cuando pasan más de 15
 * minutos sin corrida exitosa, con un máximo de un email por hora, además
 * del registro en operations_log."
 */

const STALE_THRESHOLD_MS = 15 * 60 * 1000;
const EMAIL_COOLDOWN_MS = 60 * 60 * 1000;
const ALERT_EMAIL_TO = 'mariano.erbino@shimano.com.ar';

/**
 * @typedef {Object} AlertDeps
 * @property {any} fbDb
 * @property {(opts: {to: string, subject: string, text: string}) => Promise<any>} [sendEmail]
 * @property {(msg: string, extra?: any) => void} [log]
 * @property {() => number} [now]
 */

/**
 * Chequea si el sync está stale y manda alerta si corresponde.
 * @param {AlertDeps} deps
 * @returns {Promise<{alertSent: boolean, emailSent: boolean, ageMs: number, lastSuccessAt: string|null, reason: string}>}
 */
export async function checkStockSyncStale(deps) {
  const log = deps.log || (() => {});
  const now = (deps.now || Date.now)();

  // Lee el snapshot para determinar última corrida.
  const snap = await deps.fbDb.collection('app_config').doc('stock_snapshot').get();
  if (!snap.exists) {
    return {
      alertSent: false,
      emailSent: false,
      ageMs: Infinity,
      lastSuccessAt: null,
      reason: 'no_snapshot_doc',
    };
  }
  const data = snap.data() || {};
  const updatedAt = data.updatedAt;
  let lastSuccessMs = null;
  if (updatedAt) {
    if (typeof updatedAt.toMillis === 'function') {
      lastSuccessMs = updatedAt.toMillis();
    } else if (updatedAt instanceof Date) {
      lastSuccessMs = updatedAt.getTime();
    } else if (typeof updatedAt === 'string') {
      const parsed = Date.parse(updatedAt);
      if (!Number.isNaN(parsed)) lastSuccessMs = parsed;
    }
  }
  const ageMs = lastSuccessMs !== null ? now - lastSuccessMs : Infinity;
  const lastSuccessAt = lastSuccessMs !== null ? new Date(lastSuccessMs).toISOString() : null;

  if (ageMs < STALE_THRESHOLD_MS) {
    // Fresh. Si existía alerta previa, update status=resolved.
    try {
      const prev = await deps.fbDb.collection('alerts').doc('stock_sync_stale').get();
      if (prev.exists && (prev.data() || {}).status !== 'resolved') {
        await deps.fbDb
          .collection('alerts')
          .doc('stock_sync_stale')
          .set(
            {
              status: 'resolved',
              resolvedAt: new Date(now),
              lastSuccessAt,
              ageMsAtResolve: ageMs,
            },
            { merge: true }
          );
        log(`[alert] stock_sync_stale resuelta (ageMs=${ageMs})`);
      }
    } catch (_e) {
      // best-effort
    }
    return {
      alertSent: false,
      emailSent: false,
      ageMs,
      lastSuccessAt,
      reason: 'fresh',
    };
  }

  // Stale. Marcar alert.
  await deps.fbDb
    .collection('alerts')
    .doc('stock_sync_stale')
    .set(
      {
        status: 'firing',
        lastCheckedAt: new Date(now),
        lastSuccessAt,
        ageMs,
        source: (data && data.source) || null,
      },
      { merge: true }
    );
  log(`[alert] stock_sync_stale FIRING ageMs=${ageMs}`);

  // Email con cooldown 1h.
  const metaRef = deps.fbDb.collection('alerts').doc('stock_sync_stale_meta');
  const metaSnap = await metaRef.get();
  const lastEmailAt = metaSnap.exists ? (metaSnap.data() || {}).lastEmailAt : null;
  let lastEmailMs = null;
  if (lastEmailAt) {
    if (typeof lastEmailAt.toMillis === 'function') lastEmailMs = lastEmailAt.toMillis();
    else if (lastEmailAt instanceof Date) lastEmailMs = lastEmailAt.getTime();
    else if (typeof lastEmailAt === 'string') {
      const p = Date.parse(lastEmailAt);
      if (!Number.isNaN(p)) lastEmailMs = p;
    }
  }
  const inCooldown = lastEmailMs !== null && now - lastEmailMs < EMAIL_COOLDOWN_MS;
  let emailSent = false;
  if (!inCooldown && deps.sendEmail) {
    const subject = `[app-vendedores] Stock sync stale ${Math.round(ageMs / 60000)} min`;
    const ageMinutes = Math.round(ageMs / 60000);
    const text =
      `Alerta: el snapshot de stock no se actualizó hace ${ageMinutes} minutos.\n\n` +
      `Última corrida exitosa: ${lastSuccessAt || '(nunca)'}.\n` +
      `Fuente de la última corrida: ${(data && data.source) || 'desconocida'}.\n\n` +
      `Si pasó más de 30 minutos sin corrida: revisar logs de syncSapCatalogStockCF ` +
      `en Cloud Logging o el workflow sync-sap-catalog-stock.yml en GitHub.\n\n` +
      `Mientras el snapshot esté dentro del umbral SNAPSHOT_MAX_AGE_MS (hoy 8h), ` +
      `commitPedidoCF sigue validando contra el snapshot stale sin bloquear ventas.\n\n` +
      `Cooldown: no habrá otro email en la próxima hora aunque siga stale.`;
    try {
      await deps.sendEmail({ to: ALERT_EMAIL_TO, subject, text });
      await metaRef.set({ lastEmailAt: new Date(now), lastEmailSubject: subject }, { merge: true });
      emailSent = true;
      log(`[alert] email enviado a ${ALERT_EMAIL_TO}`);
    } catch (e) {
      log(`[alert] fallo email: ${(e && e.message) || e}`);
    }
  } else if (inCooldown) {
    log(`[alert] email en cooldown (ultimo hace ${Math.round((now - lastEmailMs) / 60000)} min)`);
  }
  return {
    alertSent: true,
    emailSent,
    ageMs,
    lastSuccessAt,
    reason: 'stale',
  };
}
