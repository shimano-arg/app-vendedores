/**
 * Contrato Zod del endpoint `GET /api/stock?cardCode=<C>&sku=<X>` (ADR-013 P1.6).
 *
 * Shape alineado con `getStockBreakdown` (CLAUDE.md §39/§107): 10 campos visibles al
 * vendedor + fórmula explícita (§103). El backend-new (PR #1477) va a devolver este
 * mismo shape; cuando mergee a main, este archivo se reemplaza por import directo.
 */

import { z } from 'zod';
import { apiOkEnvelope } from './common.js';

/** Totales por bucket que el popup "Stock del SKU" muestra (§103). */
const BucketTotales = z.object({
  total: z.number().int().nonnegative(),
  totalTransito: z.number().int().nonnegative().optional().default(0),
});

export const GetStockOutput = z.object({
  sku: z.string(),

  // Físico
  fisicoDep11: z.number().int().nonnegative(),
  transitoDep12: z.number().int().nonnegative(),

  // Buckets (cada uno con total + totalTransito opcional)
  backorderApp: BucketTotales,
  asignadas: BucketTotales,
  confirmadasSinFacturar: BucketTotales,
  waitlistCpst: BucketTotales,
  repartoAbierto: z.object({
    qty: z.number().int().nonnegative(),
    repartoId: z.string().nullable().optional(),
    status: z.string().optional(),
  }),

  // Derivados
  reservadasTotal: z.number().int().nonnegative(),
  libre: z.number().int().nonnegative(),
  utilizablePara: z.number().int().nonnegative(),

  _version: z.number().int().positive(),
});
export type GetStockOutput = z.infer<typeof GetStockOutput>;

export const GetStockResponse = apiOkEnvelope(GetStockOutput);
export type GetStockResponse = z.infer<typeof GetStockResponse>;
