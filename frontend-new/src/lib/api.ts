/**
 * api.ts — fetch wrapper tipado hacia backend-new.
 *
 * P1.5: stub. En P1.6:
 * 1. Resuelve baseUrl de `import.meta.env.VITE_BACKEND_URL` (ver .env.example).
 * 2. Attach `Authorization: Bearer ${idToken}` via `useFirebaseAuth`.
 * 3. Valida response con schemas Zod compartidos (ver `backend-new/schemas/`
 *    cuando exista — ADR-010 contrato API).
 * 4. Mapea errores HTTP → ApiError con `errorCode` + `httpStatus` (consumible
 *    por `src/pure/mensajes-vendedor.ts` para mensaje humano).
 */

export interface ApiError {
  readonly errorCode: string;
  readonly httpStatus: number;
  readonly message: string;
  readonly data?: unknown;
}

export class ApiRequestError extends Error {
  readonly errorCode: string;
  readonly httpStatus: number;
  readonly data: unknown;

  constructor(err: ApiError) {
    super(err.message);
    this.name = 'ApiRequestError';
    this.errorCode = err.errorCode;
    this.httpStatus = err.httpStatus;
    this.data = err.data;
  }
}

/**
 * Stub — en P1.6 devuelve el Promise real.
 */
export async function apiGet<T>(path: string): Promise<T> {
  throw new ApiRequestError({
    errorCode: 'NOT_IMPLEMENTED',
    httpStatus: 501,
    message: `apiGet(${path}) todavia no esta implementado — P1.5 scaffold`,
  });
}

/**
 * Stub.
 */
export async function apiPost<T>(path: string, _body: unknown): Promise<T> {
  throw new ApiRequestError({
    errorCode: 'NOT_IMPLEMENTED',
    httpStatus: 501,
    message: `apiPost(${path}) todavia no esta implementado — P1.5 scaffold`,
  });
}
