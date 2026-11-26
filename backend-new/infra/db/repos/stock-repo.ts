/**
 * Repo de lectura de stock. Opera contra la VIEW `v_stock_breakdown`
 * (ADR-001 §39) via Kysely.
 *
 * El shape de salida matchea `GetStockOutput` del contrato Zod — el test
 * de contrato valida que una lectura real de la VIEW cumple con el schema.
 */

import type { Kysely } from 'kysely';
import type { Database, VStockBreakdownRow } from '../schema.js';

export interface StockBreakdownForSku {
  sku: string;
  fisicoDep11: number;
  transitoDep12: number;
  backorderApp: number;
  asignadasDep11: number;
  confirmadasDep11: number;
  asignadasDep12: number;
  confirmadasDep12: number;
  reservadasDep11: number;
  libreDep11: number;
}

export interface StockRepo {
  getStockBreakdownBySku(sku: string): Promise<StockBreakdownForSku | null>;
}

/**
 * Construye el repo contra una instancia Kysely dada.
 * Permite inyectar un DB distinto en tests (testcontainers).
 */
export function createStockRepo(db: Kysely<Database>): StockRepo {
  return {
    async getStockBreakdownBySku(sku: string): Promise<StockBreakdownForSku | null> {
      const row: VStockBreakdownRow | undefined = await db
        .selectFrom('v_stock_breakdown')
        .where('sku', '=', sku)
        .select([
          'sku',
          'fisico_dep11',
          'transito_dep12',
          'backorder_app',
          'asignadas_dep11',
          'confirmadas_dep11',
          'asignadas_dep12',
          'confirmadas_dep12',
          'reservadas_dep11',
          'libre_dep11',
        ])
        .executeTakeFirst();

      if (!row) return null;

      return {
        sku: row.sku,
        fisicoDep11: Number(row.fisico_dep11),
        transitoDep12: Number(row.transito_dep12),
        backorderApp: Number(row.backorder_app),
        asignadasDep11: Number(row.asignadas_dep11),
        confirmadasDep11: Number(row.confirmadas_dep11),
        asignadasDep12: Number(row.asignadas_dep12),
        confirmadasDep12: Number(row.confirmadas_dep12),
        reservadasDep11: Number(row.reservadas_dep11),
        libreDep11: Number(row.libre_dep11),
      };
    },
  };
}
