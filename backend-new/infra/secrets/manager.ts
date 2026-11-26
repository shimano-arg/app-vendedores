/**
 * Wrapper de GCP Secret Manager.
 *
 * Patron:
 *   - Prod (Cloud Functions Gen 2): `firebase functions:secrets:set X` →
 *     la secret se inyecta como env var al container. Este wrapper lee
 *     el env var directo; `fetchSecret()` solo cae al SM API si el env
 *     var NO esta set (ej. scripts standalone).
 *   - Dev: `.env` + dotenv provee los env vars; SM API no se toca.
 *   - Test: siempre inyectar via env vars mockeados; nunca llamar SM real.
 *
 * Secrets actuales (para este PR — solo documentadas):
 *   - DATABASE_URL           : connection string Cloud SQL.
 *   - DATABASE_URL_SHADOW    : shadow instance (ADR-008).
 *
 * TODO cuando se abra la ruta `POST /pedidos`:
 *   - Agregar SAP_SL_PASSWORD (si el backend-new inicia el flow SAP).
 *   - Agregar SENTRY_DSN (si se activa observabilidad).
 */

/**
 * Lee un secret por nombre. Fuente:
 *   1. `process.env[name]` si esta set (prod via secrets:set, dev via .env).
 *   2. Fallback a Secret Manager API — solo si el caller pasa `useSmFallback=true`.
 *
 * Devuelve null si no se encuentra. Nunca throws (fail-closed; el caller
 * decide que hacer con el null).
 */
export async function fetchSecret(
  name: string,
  opts?: {
    /**
     * Si true, cae a Secret Manager API cuando el env var no esta set.
     * Usar solo en scripts standalone (NO en handlers Cloud Functions —
     * ahi el env var deberia estar presente via `firebase functions:secrets:set`).
     */
    useSmFallback?: boolean;
    /**
     * Project id GCP. Si no se pasa, usa `GOOGLE_CLOUD_PROJECT` o
     * `GCLOUD_PROJECT`.
     */
    projectId?: string;
  },
): Promise<string | null> {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }

  if (!opts?.useSmFallback) {
    return null;
  }

  // Fallback SM API — import dinamico para no cargar la lib en cold start
  // si no se usa.
  try {
    const { SecretManagerServiceClient } = await import(
      '@google-cloud/secret-manager'
    );
    const client = new SecretManagerServiceClient();
    const projectId =
      opts.projectId ??
      process.env['GOOGLE_CLOUD_PROJECT'] ??
      process.env['GCLOUD_PROJECT'];
    if (!projectId) {
      return null;
    }
    const [access] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${name}/versions/latest`,
    });
    const payload = access.payload?.data;
    if (!payload) return null;
    return typeof payload === 'string'
      ? payload
      : Buffer.from(payload).toString('utf8');
  } catch {
    return null;
  }
}
