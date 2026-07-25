// @ts-check
/**
 * dailyFirestoreBackup core (Fase 0 E6).
 *
 * Diseño: mismo patrón que sap-proxy-core.js. La lógica que construye la
 * request de exportDocuments es pura y testeable con mocks; el wrapper
 * de Cloud Functions inyecta el cliente real de @google-cloud/firestore.
 *
 * Objetivo: exportar todas las colecciones de Firestore a
 * gs://{bucket}/firestore/{YYYY-MM-DD}/ una vez por día. El botón
 * manual `runFullBackup` (index.html:10517) queda intacto — es un ZIP
 * con fotos + JSON, distinto formato. Este scheduled backup es el
 * hot-restore-ready oficial de Firestore.
 *
 * Notificación de falla: la fn tira. Cloud Functions loguea el error y
 * el user puede armar una alerta de log-based metric en Cloud Logging
 * sobre el pattern `dailyFirestoreBackup failed`. NO enviamos email
 * desde acá (menos deps, menos surface).
 */

/**
 * @typedef {Object} BackupDeps
 * @property {(request: ExportDocumentsRequest) => Promise<ExportDocumentsResponse>} exportDocuments
 * @property {() => Date} now Injectable para testear timestamps deterministas.
 * @property {string} projectId
 * @property {string} bucketName Ej: 'app-vendedores-shimano-backups'.
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 *
 * @typedef {Object} ExportDocumentsRequest
 * @property {string} name Ej: 'projects/{p}/databases/(default)'.
 * @property {string} outputUriPrefix Ej: 'gs://{bucket}/firestore/{ts}/'.
 * @property {string[]} [collectionIds] Vacío = todas las colecciones.
 *
 * @typedef {Object} ExportDocumentsResponse
 * @property {string} [name] Operación long-running: 'projects/.../operations/...'.
 *
 * @typedef {Object} BackupResult
 * @property {string} outputUriPrefix
 * @property {string} [operationName]
 * @property {string} timestamp
 */

/**
 * Formatea Date a "YYYY-MM-DD" en UTC (evita drift entre zonas cuando
 * el cron dispara justo cerca de medianoche AR).
 * @param {Date} d
 */
export function formatBackupTimestamp(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * @param {BackupDeps} deps
 * @returns {Promise<BackupResult>}
 */
export async function runDailyBackup(deps) {
  const log = deps.log || (() => {});

  if (!deps.projectId || !deps.bucketName) {
    throw new Error('runDailyBackup: projectId y bucketName requeridos.');
  }

  const timestamp = formatBackupTimestamp(deps.now());
  const outputUriPrefix = `gs://${deps.bucketName}/firestore/${timestamp}/`;
  const request = {
    name: `projects/${deps.projectId}/databases/(default)`,
    outputUriPrefix,
    collectionIds: [], // empty = export todas
  };

  log('dailyFirestoreBackup starting', { outputUriPrefix, projectId: deps.projectId });

  try {
    const response = await deps.exportDocuments(request);
    const operationName = response && response.name ? response.name : undefined;
    log('dailyFirestoreBackup started operation', { outputUriPrefix, operationName });
    return { outputUriPrefix, operationName, timestamp };
  } catch (e) {
    log('dailyFirestoreBackup failed', { outputUriPrefix, error: String(e) });
    // Re-throw para que Cloud Functions marque la ejecución como fallida
    // y el log-based alerting se dispare.
    throw e;
  }
}
