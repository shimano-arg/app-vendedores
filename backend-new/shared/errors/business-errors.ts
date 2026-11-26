/**
 * Catalogo de errorCodes del backend-new + mensajes humanos (CLAUDE.md §68).
 *
 * El cliente mapea `errorCode` → texto para el usuario via
 * `src/pure/mensajes-vendedor.js` (fuente unica de UI copy). El servidor
 * NUNCA devuelve texto en español en el response default — solo el code.
 */

/**
 * Codigos canonicos. Prefijo por dominio:
 *   - STOCK_*     : operaciones de stock.
 *   - PEDIDOS_*   : queries y mutaciones de pedidos.
 *   - VALIDATION_*: fallos de validacion de payload.
 *   - AUTH_*      : autenticacion / autorizacion.
 *   - INTERNAL    : fallback no esperado.
 */
export const ERROR_CODES = {
  // --- Validation (zod schema fail, cardCode invalido, etc.) ---
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // --- Stock domain ---
  STOCK_SKU_NOT_FOUND: 'STOCK_SKU_NOT_FOUND',
  STOCK_SNAPSHOT_UNAVAILABLE: 'STOCK_SNAPSHOT_UNAVAILABLE',

  // --- Pedidos domain ---
  PEDIDOS_CLIENTE_NO_ENCONTRADO: 'PEDIDOS_CLIENTE_NO_ENCONTRADO',
  PEDIDOS_CURSOR_INVALIDO: 'PEDIDOS_CURSOR_INVALIDO',

  // --- Auth / rol ---
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // --- Infra ---
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Mapa errorCode → mensaje humano (es-AR, sin jerga tecnica).
 * Replica el estilo de CLAUDE.md §68 — el cliente tiene su propia copia
 * en `src/pure/mensajes-vendedor.js`; aqui va una referencia para debug
 * server-side y para el adapter Hono que loguea.
 */
export const BUSINESS_ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR:
    'Los datos enviados no son validos. Revisá el pedido y volvé a intentar.',
  STOCK_SKU_NOT_FOUND:
    'No encontramos el producto en el catalogo. Avisale a Mariano.',
  STOCK_SNAPSHOT_UNAVAILABLE:
    'No pudimos consultar el stock ahora. Esperá un minuto y volvé a intentar.',
  PEDIDOS_CLIENTE_NO_ENCONTRADO:
    'No encontramos pedidos para este cliente.',
  PEDIDOS_CURSOR_INVALIDO:
    'El cursor de paginacion no es valido. Recargá la pantalla.',
  AUTH_REQUIRED: 'Tenés que iniciar sesión para ver esta información.',
  PERMISSION_DENIED: 'Tu usuario no tiene permiso para esta acción.',
  DATABASE_UNAVAILABLE:
    'No pudimos consultar la base ahora. Esperá un minuto y volvé a intentar.',
  INTERNAL: 'Hubo un error inesperado. Avisale a Mariano con la hora.',
};

/**
 * Factory tipada para errores de negocio dentro del core (sin acople a Hono).
 * Similar al pattern `makeError` de `functions/core/commit-pedido-core.js`
 * (CLAUDE.md §7) pero en TS.
 */
export class BusinessError extends Error {
  public readonly errorCode: ErrorCode;
  public readonly data: Record<string, unknown> | undefined;

  constructor(errorCode: ErrorCode, options?: {
    message?: string;
    data?: Record<string, unknown>;
  }) {
    super(options?.message ?? BUSINESS_ERROR_MESSAGES[errorCode]);
    this.name = 'BusinessError';
    this.errorCode = errorCode;
    this.data = options?.data;
  }
}

/**
 * Discriminador para `catch (e)` blocks sin recurrir a `instanceof` cross-realm.
 */
export function isBusinessError(e: unknown): e is BusinessError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: string }).name === 'BusinessError' &&
    typeof (e as { errorCode?: unknown }).errorCode === 'string'
  );
}
