/**
 * Tipos compartidos cliente↔servidor.
 *
 * Fuente única (ADR-014). El frontend React (ADR-013) y las rutas Hono
 * importan desde aquí. Los schemas son runtime-validated por Zod; los types
 * los inferimos con `z.infer`.
 */

import { z } from 'zod';

/**
 * Codigo SAP del cliente. Shape canónico `C` + 11 dígitos (SAP) o prospecto
 * sin prefijo. Permisivo en v0 — cualquier string no vacío alfanumerico.
 * Ver CLAUDE.md §46: siempre normalizar `trim + uppercase`.
 */
export const CardCode = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9._-]+$/, 'CardCode con caracteres invalidos')
  .transform((s) => s.toUpperCase())
  .brand<'CardCode'>();
export type CardCode = z.infer<typeof CardCode>;

/**
 * SKU de SAP. Alfa-numérico, hasta 50 chars. SAP acepta hasta 50
 * (OITM.ItemCode) — restringimos aqui.
 */
export const SkuCode = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .brand<'SkuCode'>();
export type SkuCode = z.infer<typeof SkuCode>;

/**
 * VendorKey canonico — en MAYUSCULAS (§46).
 * Ej. "MAURICIO GIL", "FEDERICO CASTELANELLI", "PACHI".
 */
export const VendorKey = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .brand<'VendorKey'>();
export type VendorKey = z.infer<typeof VendorKey>;

/**
 * UID Firebase Auth — 28 chars alfanumericos.
 */
export const UserUid = z
  .string()
  .min(10)
  .max(128)
  .brand<'UserUid'>();
export type UserUid = z.infer<typeof UserUid>;

/**
 * Timestamp ISO-8601 con TZ. Siempre string serializable. `Date` objects
 * se convierten via .toISOString() antes de salir a la red.
 */
export const IsoTimestamp = z
  .string()
  .datetime({ offset: true })
  .brand<'IsoTimestamp'>();
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

/**
 * Idempotency key para mutaciones (FUTURAS — no en este PR).
 *
 * Pattern (comentario — no implementado en el piloto solo-lectura):
 *   POST /api/v1/pedidos { ..., idempotencyKey: "..." }
 *   -> CF valida vs tabla pedido_draft_locks:
 *      INSERT INTO pedido_draft_locks (draft_id, pedido_id, ...) VALUES (...)
 *      ON CONFLICT (draft_id) DO NOTHING RETURNING pedido_id;
 *   -> Si devuelve filas: pedido nuevo creado.
 *   -> Si no devuelve: lock existia; SELECT pedido_id FROM pedido_draft_locks ...
 *      y devolver 200 con el pedido pre-existente.
 *
 * TODO cuando se abra la ruta `POST /pedidos`:
 *   - Validar que el `idempotencyKey` viene en el payload.
 *   - Implementar la query ON CONFLICT en el repo.
 *   - Tests: 2 requests concurrentes con misma key = 1 pedido + 1 respuesta idem.
 */
export const IdempotencyKey = z
  .string()
  .min(10)
  .max(100)
  .regex(/^[A-Za-z0-9._|:-]+$/, 'IdempotencyKey con caracteres invalidos');
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

/**
 * Paginacion cursor-based (keyset). Inicial para `GET /api/v1/pedidos`.
 * `cursor` es opaco — el servidor codifica el (createdAt, id) del ultimo
 * registro de la pagina anterior.
 */
export const Pagination = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type Pagination = z.infer<typeof Pagination>;

export const PageInfo = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type PageInfo = z.infer<typeof PageInfo>;

/**
 * Envelope de error canonico — matchea el shape que el frontend (React +
 * fallback inline en index.html) espera leer desde §68. El `errorCode` se
 * mapea client-side a un mensaje humano via `MENSAJES_VENDEDOR`.
 */
export const ApiErrorEnvelope = z.object({
  ok: z.literal(false),
  errorCode: z.string(),
  message: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

/**
 * Envelope de success. Tipado generico; cada ruta define su `data`.
 */
export function apiOkEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
}
