// @ts-check
/**
 * reparto-excel-consistency.test.js (v1505, 2026-10-28) — test de consistencia
 * POST-import: simula la aplicación de un import Excel y verifica que el
 * breakdown del cliente+SKU resultante coincide con "Vuelve a backorder" del
 * Excel.
 *
 * Fixture:
 *   - Cliente C001, SKU-A, Backorder=5, StockDisponible=3.
 *   - Excel: Asignado=2, Eliminar=1 → Vuelve a BO esperado = 5 - 2 - 1 = 2.
 *
 * Expected post-apply:
 *   - backorderApp.porCliente['C001'] = 2.
 *   - asignadas incrementa 2 unidades para C001.
 *   - 1 unidad eliminada NO aparece en ningún bucket.
 *
 * Si alguna igualdad falla, test falla + reporta qué.
 */
import { describe, expect, it } from 'vitest';
import { computeRepartoExcelExportRows } from '../../../src/pure/reparto-excel-export-rows.js';
import { validateRepartoExcelImport } from '../../../src/pure/reparto-excel-import-validator.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

describe('v1505 Reparto Excel — consistencia POST-import (fixture C001/SKU-A 5→2)', () => {
  it('backorder residual del breakdown coincide con "Vuelve a backorder" del Excel', () => {
    const sku = 'SKU-A';
    const cardCode = 'C001';
    const fisico = 3;

    // 1. Pre: pedido con BO=5 para C001/SKU-A.
    const pedidoBO = {
      _fsId: 'ped-1',
      clientCardCode: cardCode,
      clientName: 'ACME',
      createdAt: new Date().toISOString(),
      closedAt: null,
      stage: 'lista_espera',
      lines: [
        {
          code: sku,
          qty: 5,
          qtyOpen: 5,
          state: 'BO',
          precio: 100,
        },
      ],
    };

    // 2. Breakdown pre-apply.
    const breakdownPre = getStockBreakdown(sku, {
      getStockFisico: () => fisico,
      pedidos: [pedidoBO],
    });
    expect(breakdownPre.backorderApp.total).toBe(5);
    const preBoCliente = breakdownPre.backorderApp.porCliente.find((c) => c.cardCode === cardCode);
    expect(preBoCliente && preBoCliente.qty).toBe(5);
    expect(breakdownPre.asignadas.total).toBe(0);

    // 3. Simular ingreso_reparto activo para ese SKU.
    const ingreso = {
      _id: 'ING-1',
      sku,
      qtyIngresada: 3,
      status: 'pending',
      clientesBO: [
        {
          pedidoId: 'ped-1',
          lineIndex: 0,
          clientCardCode: cardCode,
          clientName: 'ACME',
          qtyBackorder: 5,
        },
      ],
    };

    // 4. Export Excel → fila que Pablo vería.
    const exportRes = computeRepartoExcelExportRows(
      [ingreso],
      {},
      {
        getStockFisico: () => fisico,
      }
    );
    expect(exportRes.rows.length).toBe(1);
    const excelRow = exportRes.rows[0];
    expect(excelRow.Backorder).toBe(5);
    expect(excelRow.StockDisponible).toBe(3);

    // 5. Pablo edita el Excel: Asignado=2, Eliminar=1.
    // Vuelve a BO esperado = Backorder - Asignado - Eliminar = 5 - 2 - 1 = 2.
    const vueleABOEsperado = 5 - 2 - 1;
    expect(vueleABOEsperado).toBe(2);

    // 6. Importar el Excel editado.
    const importedRows = [
      {
        __rowIndex: 2,
        Codigo: sku,
        Cliente: 'ACME',
        Backorder: 5,
        StockDisponible: 3,
        Asignado: 2,
        VueleABackorder: '=C2-E2-G2',
        Eliminar: 1,
        RepartoId: 'ING-1',
        CardCode: cardCode,
      },
    ];
    const repartosActivos = [
      {
        _id: 'ING-1',
        sku,
        status: 'pending',
        stockDisponible: 3,
        clientesBO: ingreso.clientesBO,
      },
    ];
    const validation = validateRepartoExcelImport(importedRows, repartosActivos);
    expect(validation.errores.length).toBe(0);
    expect(validation.conCambios.length).toBe(1);
    const match = validation.conCambios[0];
    expect(match.asignadoNuevo).toBe(2);
    expect(match.eliminarNuevo).toBe(1);

    // 7. Simular el apply server-side (lo que haría applyRepartoManualCF):
    //    - 2 unidades pasan a state=ASIG.
    //    - 1 unidad se elimina (qtyOpen=0, closedReason='eliminado_en_reparto').
    //    - 2 unidades quedan como BO (línea nueva o resto).
    //
    // Mutación: la línea BO original pasa a tener qtyOpen=2 (lo que vuelve a BO).
    // Nueva línea ASIG qty=2. Nueva línea cancelled qty=1 (closedReason).
    const pedidoPost = {
      ...pedidoBO,
      lines: [
        // Línea original BO queda con 2 (vuelve a BO).
        { ...pedidoBO.lines[0], qty: 2, qtyOpen: 2 },
        // Línea nueva ASIG qty=2.
        {
          code: sku,
          qty: 2,
          qtyOpen: 2,
          state: 'ASIG',
          precio: 100,
          asigAt: new Date().toISOString(),
          asigFromReparto: true,
          asigReserva: true,
        },
        // Línea cancelada qty=1 (eliminada del BO).
        {
          code: sku,
          qty: 1,
          qtyOpen: 0,
          state: 'cancelled',
          precio: 100,
          cancelledAt: new Date().toISOString(),
          closedReason: 'eliminado_en_reparto',
        },
      ],
    };

    // 8. Breakdown POST-apply.
    const breakdownPost = getStockBreakdown(sku, {
      getStockFisico: () => fisico,
      pedidos: [pedidoPost],
    });

    // Expected invariants.
    const postBoCliente = breakdownPost.backorderApp.porCliente.find(
      (c) => c.cardCode === cardCode
    );
    expect(postBoCliente && postBoCliente.qty).toBe(vueleABOEsperado);
    expect(breakdownPost.asignadas.total).toBe(2);
    expect(breakdownPost.asignadas.porCliente[0].cardCode).toBe(cardCode);
    expect(breakdownPost.asignadas.porCliente[0].qty).toBe(2);
    // La unidad eliminada no cuenta en ningún bucket (asig/BO/confirmed/reparto).
    const totalContabilizado =
      (postBoCliente && postBoCliente.qty ? postBoCliente.qty : 0) +
      (breakdownPost.asignadas.total || 0);
    expect(totalContabilizado).toBe(4);
  });

  it('todos los Asignado=0 y Eliminar=0 → nada que aplicar', () => {
    const sku = 'SKU-B';
    const cardCode = 'C002';
    const ingreso = {
      _id: 'ING-2',
      sku,
      status: 'pending',
      stockDisponible: 2,
      clientesBO: [
        {
          pedidoId: 'ped-x',
          lineIndex: 0,
          clientCardCode: cardCode,
          clientName: 'BETA',
          qtyBackorder: 3,
        },
      ],
    };
    const rows = computeRepartoExcelExportRows([ingreso], {}, { getStockFisico: () => 2 }).rows;
    // Convertir a shape import (asignado=0, eliminar=0 default).
    const importedRows = rows.map((r) => ({
      ...r,
      __rowIndex: 2,
    }));
    const validation = validateRepartoExcelImport(importedRows, [
      {
        _id: 'ING-2',
        sku,
        status: 'pending',
        stockDisponible: 2,
        clientesBO: ingreso.clientesBO,
      },
    ]);
    expect(validation.errores.length).toBe(0);
    expect(validation.conCambios.length).toBe(0);
    expect(validation.reconocidas.length).toBe(1);
    expect(validation.reconocidas[0].tieneCambios).toBe(false);
  });
});
