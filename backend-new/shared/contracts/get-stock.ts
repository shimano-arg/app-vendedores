/**
 * Contrato Zod — GET /api/v1/stock/:sku
 *
 * Operacion piloto ADR-013. Devuelve el `stock_breakdown` v0 (ADR-001 §39)
 * para un SKU.
 *
 * El shape del output matchea la VIEW `v_stock_breakdown` del schema PG
 * (`backend-new/db/schema/0001_initial.sql`). En v1 se extiende con
 * `waitlistCpst`, `repartoAbierto`, `sobreAsignada FIFO`, `utilizablePara`.
 */

import { z } from 'zod';
import { SkuCode, apiOkEnvelope } from './common.js';

// ----------------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------------

/**
 * Params de ruta. Hono parsea `/stock/:sku` → `{ sku }`.
 */
export const GetStockParams = z.object({
  sku: SkuCode,
});
export type GetStockParams = z.infer<typeof GetStockParams>;

// ----------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------

/**
 * Shape del breakdown en v0 (ADR-001). Matchea la VIEW
 * `v_stock_breakdown`:
 *
 *   SELECT sku, fisico_dep11, transito_dep12, backorder_app,
 *          asignadas_dep11, confirmadas_dep11,
 *          asignadas_dep12, confirmadas_dep12,
 *          reservadas_dep11, libre_dep11
 *   FROM v_stock_breakdown WHERE sku = $1;
 *
 * Campos:
 *   - `sku`               : SKU normalizado.
 *   - `fisicoDep11`       : stock fisico vendible (CLAUDE.md §26: solo whs 11).
 *   - `transitoDep12`     : stock en Uruguay viajando a Arg (§107).
 *   - `backorderApp`      : BO vigente en la app (§40 — cola, NO reserva).
 *   - `asignadasDep11`    : SUM(qty) WHERE state=ASIG + warehouse=dep_11 (§40).
 *   - `confirmadasDep11`  : SUM(qty) WHERE state=confirmed + warehouse=dep_11 (§40, §40.8).
 *   - `asignadasDep12`    : ASIG en transito (§107).
 *   - `confirmadasDep12`  : confirmed en transito (§107).
 *   - `reservadasDep11`   : SUM(qty) de todas las reservations activas (dep_11).
 *   - `libreDep11`        : GREATEST(fisico_dep11 - reservadas_dep11, 0).
 *   - `_version`          : version del shape — bump al agregar bucket (§39).
 */
export const GetStockOutput = z.object({
  sku: z.string(),
  fisicoDep11: z.number().int().nonnegative(),
  transitoDep12: z.number().int().nonnegative(),
  backorderApp: z.number().int().nonnegative(),
  asignadasDep11: z.number().int().nonnegative(),
  confirmadasDep11: z.number().int().nonnegative(),
  asignadasDep12: z.number().int().nonnegative(),
  confirmadasDep12: z.number().int().nonnegative(),
  reservadasDep11: z.number().int().nonnegative(),
  libreDep11: z.number().int().nonnegative(),
  _version: z.literal(1),
});
export type GetStockOutput = z.infer<typeof GetStockOutput>;

/**
 * Envelope completo de la respuesta 200 OK.
 * `{ ok: true, data: GetStockOutput }`.
 */
export const GetStockResponse = apiOkEnvelope(GetStockOutput);
export type GetStockResponse = z.infer<typeof GetStockResponse>;
