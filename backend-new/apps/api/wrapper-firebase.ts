/**
 * Adapter Cloud Functions Gen 2 — expone la app Hono como `crmApiCF`.
 *
 * Patron (CLAUDE.md §7): este archivo es puro plumbing Firebase. Toda la
 * logica vive en `apps/api/index.ts` y `domains/*`.
 *
 * Deploy:
 *   firebase deploy --only functions:crmApiCF
 *
 * Secrets requeridas (Gen 2):
 *   firebase functions:secrets:set DATABASE_URL
 *
 * VPC Connector (Cloud SQL Private IP): configurado en el `onRequest`.
 * NOTA: los valores estan hardcodeados para `app-vendedores-shimano` en
 * `southamerica-east1`; adaptar a la instancia real cuando se deployee
 * el shadow db (ADR-008).
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

import { createApp } from './index.js';
import { getDb } from '../../infra/db/pool.js';

// Secret declarado para firebase-functions. Al deploy, Firebase Function
// inyecta el valor como `process.env.DATABASE_URL` en el runtime.
const DATABASE_URL = defineSecret('DATABASE_URL');

/**
 * Lazy singleton del handler. El `createApp` se instancia la primera vez
 * que el container recibe una request y queda en memoria durante el warm.
 */
let _honoHandler: ReturnType<typeof createApp> | null = null;

function getHandler(): ReturnType<typeof createApp> {
  if (_honoHandler) return _honoHandler;
  // getDb() lee process.env.DATABASE_URL (inyectado via defineSecret).
  const db = getDb();
  _honoHandler = createApp({ db });
  return _honoHandler;
}

/**
 * Cloud Function HTTPS. Monta todas las rutas de Hono.
 *
 * Config:
 *   - `region`: southamerica-east1 (mismo que el resto de CFs del proyecto).
 *   - `secrets`: DATABASE_URL (inyectado como env var).
 *   - `cpu` + `memory`: conservador para empezar; subir cuando se mida
 *     throughput real.
 *   - `concurrency`: 80 (default Gen 2 para max throughput por instancia).
 *   - `cors`: false — el frontend corre en el mismo origen Firebase Hosting;
 *     si en el futuro se expone a terceros, agregar con lista blanca.
 */
export const crmApiCF = onRequest(
  {
    region: 'southamerica-east1',
    secrets: [DATABASE_URL],
    cpu: 1,
    memory: '256MiB',
    concurrency: 80,
    timeoutSeconds: 30,
    // TODO ADR-008: vpcConnector: 'app-vendedores-sql-connector',
    // TODO ADR-008: vpcConnectorEgressSettings: 'PRIVATE_RANGES_ONLY',
  },
  async (req, res) => {
    const app = getHandler();
    // Hono soporta ejecucion directa via fetch API. Convertimos
    // req/res de Node a Fetch Request/Response.
    const url = `http://${req.headers.host ?? 'cf'}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) {
        for (const vv of v) headers.append(k, vv);
      } else if (typeof v === 'string') {
        headers.set(k, v);
      }
    }
    const method = req.method ?? 'GET';
    const fetchReq = new Request(url, {
      method,
      headers,
      body:
        method === 'GET' || method === 'HEAD'
          ? null
          : (req as unknown as { rawBody?: Buffer }).rawBody,
    });

    const fetchRes = await app.fetch(fetchReq);
    res.status(fetchRes.status);
    fetchRes.headers.forEach((value, key) => res.setHeader(key, value));
    const buf = Buffer.from(await fetchRes.arrayBuffer());
    res.end(buf);
  },
);
