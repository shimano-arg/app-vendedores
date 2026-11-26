/**
 * API client del piloto (ADR-013 P1.6).
 *
 * Reemplaza el stub de P1.5. Cada request:
 *   1. Resuelve IDToken con force refresh (§25).
 *   2. Hace fetch con `Authorization: Bearer <token>`.
 *   3. Parsea el envelope `{ok, data}` o `{ok: false, errorCode}`.
 *   4. Zod.parse sobre `data` ANTES de devolverlo (validación bidireccional runtime).
 *
 * Si Zod falla → `ApiValidationError` (el ErrorBoundary de la ruta lo captura).
 * Si el backend devuelve envelope error → `ApiError` con errorCode + mensaje.
 * Si el fetch falla (red, CORS) → `NetworkError`.
 */

import type { z } from 'zod';
import {
  GetPedidosByClientOutput,
  type GetPedidosByClientOutput as GetPedidosByClientOutputT,
} from '../contracts/get-pedidos.js';
import { GetStockOutput, type GetStockOutput as GetStockOutputT } from '../contracts/get-stock.js';
import { getIdTokenForced } from './auth.js';
import { API_BASE_URL } from './firebase.js';

export class ApiError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly status: number,
    public readonly serverData?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiValidationError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly zodError: z.ZodError
  ) {
    super(
      `El servidor devolvió una respuesta que no matchea el contrato de ${endpoint}. ` +
        `Avisale a Mariano.`
    );
    this.name = 'ApiValidationError';
  }
}

export class NetworkError extends Error {
  constructor(
    public readonly endpoint: string,
    cause: unknown
  ) {
    super(`No pudimos conectar con el servidor. Revisá tu conexión y volvé a intentar.`);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/** URL con query params serializados. Omite keys con valor undefined/null. */
function buildUrl(
  path: string,
  params?: Record<string, string | number | undefined | null>
): string {
  const base = API_BASE_URL.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(base + cleanPath);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

async function apiFetch<T extends z.ZodTypeAny>(
  endpoint: string,
  path: string,
  params: Record<string, string | number | undefined | null> | undefined,
  schema: T,
  signal?: AbortSignal
): Promise<z.infer<T>> {
  const token = await getIdTokenForced();
  const url = buildUrl(path, params);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal,
    });
  } catch (cause) {
    throw new NetworkError(endpoint, cause);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new NetworkError(endpoint, cause);
  }

  if (!response.ok || (payload as { ok?: boolean })?.ok === false) {
    const envelope = payload as {
      errorCode?: string;
      message?: string;
      data?: Record<string, unknown>;
    };
    throw new ApiError(
      envelope?.errorCode ?? 'UNKNOWN',
      envelope?.message ?? `Error ${response.status}`,
      response.status,
      envelope?.data
    );
  }

  const envelope = payload as { data: unknown };
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new ApiValidationError(endpoint, parsed.error);
  }
  return parsed.data;
}

export interface GetStockParams {
  cardCode: string;
  sku: string;
  signal?: AbortSignal;
}

export async function getStock(params: GetStockParams): Promise<GetStockOutputT> {
  return apiFetch(
    'getStock',
    '/api/stock',
    { cardCode: params.cardCode, sku: params.sku },
    GetStockOutput,
    params.signal
  );
}

export interface GetPedidosParams {
  cardCode: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

export async function getPedidos(params: GetPedidosParams): Promise<GetPedidosByClientOutputT> {
  return apiFetch(
    'getPedidos',
    '/api/pedidos',
    { cardCode: params.cardCode, cursor: params.cursor, limit: params.limit },
    GetPedidosByClientOutput,
    params.signal
  );
}
