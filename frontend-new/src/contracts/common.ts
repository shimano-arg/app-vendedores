/**
 * Placeholders locales de los contratos Zod de #1477 (backend-new/shared/contracts/common.ts).
 *
 * Cuando #1477 mergee a main, estos archivos se van a reemplazar por imports directos de
 * `backend-new/shared/contracts/*` via workspace package. Mientras tanto, mantengo el
 * mismo shape para que el PR del piloto sea revisable aislado.
 *
 * Ver ADR-013 (sección Implementación piloto P1.6).
 */

import { z } from 'zod';

export const CardCode = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9._-]+$/, 'CardCode con caracteres invalidos')
  .transform((s) => s.toUpperCase());
export type CardCode = z.infer<typeof CardCode>;

export const SkuCode = z.string().trim().min(1).max(50);
export type SkuCode = z.infer<typeof SkuCode>;

export const IsoTimestamp = z.string().datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

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

export const ApiErrorEnvelope = z.object({
  ok: z.literal(false),
  errorCode: z.string(),
  message: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

export function apiOkEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
}
