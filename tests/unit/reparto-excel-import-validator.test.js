// @ts-check
import { describe, expect, it } from 'vitest';
import {
  groupImportMatchesByReparto,
  validateRepartoExcelImport,
} from '../../src/pure/reparto-excel-import-validator.js';

/**
 * Helper para armar un reparto activo con 1 cliente.
 */
function reparto({
  id = 'ING-1',
  sku = 'SKU-A',
  status = 'pending',
  stockDisponible = 5,
  cardCode = 'C001',
  clientName = 'ACME',
  qtyBackorder = 3,
} = {}) {
  return {
    _id: id,
    sku,
    status,
    stockDisponible,
    clientesBO: [{ clientCardCode: cardCode, clientName, qtyBackorder }],
  };
}

/**
 * Helper para armar una fila del Excel.
 */
function row({
  rowIndex = 2,
  codigo = 'SKU-A',
  cliente = 'ACME',
  backorder = 3,
  stock = 5,
  asignado = 0,
  eliminar = 0,
  repartoId = 'ING-1',
  cardCode = 'C001',
} = {}) {
  return {
    __rowIndex: rowIndex,
    Codigo: codigo,
    Cliente: cliente,
    Backorder: backorder,
    StockDisponible: stock,
    Asignado: asignado,
    VueleABackorder: '=C2-E2-G2',
    Eliminar: eliminar,
    RepartoId: repartoId,
    CardCode: cardCode,
  };
}

describe('T1: Asignado > StockDisponible → error asignado_gt_stock', () => {
  it('rechaza con el error correcto', () => {
    const res = validateRepartoExcelImport(
      [row({ asignado: 10 })],
      [reparto({ stockDisponible: 5 })]
    );
    expect(res.errores.length).toBe(1);
    expect(res.errores[0].type).toBe('asignado_gt_stock');
    expect(res.errores[0].rowIndex).toBe(2);
  });
});

describe('T2: Asignado + Eliminar > Backorder → error asignado_elim_gt_bo', () => {
  it('rechaza con el error correcto', () => {
    const res = validateRepartoExcelImport(
      [row({ asignado: 2, eliminar: 2, backorder: 3 })],
      [reparto({ qtyBackorder: 3, stockDisponible: 10 })]
    );
    expect(res.errores.length).toBe(1);
    expect(res.errores[0].type).toBe('asignado_elim_gt_bo');
  });
});

describe('T3: Asignado negativo → error invalid_number', () => {
  it('rechaza negativos', () => {
    const res = validateRepartoExcelImport([row({ asignado: -5 })], [reparto()]);
    expect(res.errores.length).toBe(1);
    expect(res.errores[0].type).toBe('invalid_number');
  });
});

describe('T4: Asignado no numérico → error invalid_number', () => {
  it('rechaza string "abc"', () => {
    const res = validateRepartoExcelImport([row({ asignado: 'abc' })], [reparto()]);
    expect(res.errores.length).toBe(1);
    expect(res.errores[0].type).toBe('invalid_number');
  });
  it('acepta "0" string vacío (celda vacía)', () => {
    const res = validateRepartoExcelImport([row({ asignado: '', eliminar: '' })], [reparto()]);
    expect(res.errores.length).toBe(0);
    expect(res.reconocidas.length).toBe(1);
    expect(res.reconocidas[0].tieneCambios).toBe(false);
  });
});

describe('T5: Filas duplicadas (mismo RepartoId+CardCode+Codigo 2+ veces) → error duplicate', () => {
  it('rechaza con el error correcto', () => {
    const res = validateRepartoExcelImport(
      [row({ rowIndex: 2, asignado: 1 }), row({ rowIndex: 3, asignado: 2 })],
      [reparto({ qtyBackorder: 10, stockDisponible: 10 })]
    );
    const dupErrs = res.errores.filter((e) => e.type === 'duplicate');
    expect(dupErrs.length).toBeGreaterThan(0);
  });
});

describe('T6: RepartoId que ya no existe (reparto cerrado) → error reparto_cerrado', () => {
  it('rechaza por status done', () => {
    const res = validateRepartoExcelImport([row()], [reparto({ status: 'done' })]);
    expect(res.errores.length).toBe(1);
    expect(res.errores[0].type).toBe('reparto_cerrado');
  });
});

describe('T6b: RepartoId que no existe (no coincide con ningún reparto activo) → error not_found', () => {
  it('rechaza con el error correcto', () => {
    const res = validateRepartoExcelImport([row({ repartoId: 'ING-INEXISTENTE' })], [reparto()]);
    expect(res.errores.length).toBe(1);
    expect(res.errores[0].type).toBe('not_found');
  });
});

describe('T7: fila bien formada con cambios → clasifica como "con cambios", sin error', () => {
  it('Asignado=2, Eliminar=1, Backorder=5, StockDisponible=3 → OK', () => {
    const res = validateRepartoExcelImport(
      [row({ asignado: 2, eliminar: 1, backorder: 5, stock: 3 })],
      [reparto({ qtyBackorder: 5, stockDisponible: 3 })]
    );
    expect(res.errores.length).toBe(0);
    expect(res.reconocidas.length).toBe(1);
    expect(res.conCambios.length).toBe(1);
    expect(res.conCambios[0].asignadoNuevo).toBe(2);
    expect(res.conCambios[0].eliminarNuevo).toBe(1);
    expect(res.conCambios[0].backorderActual).toBe(5);
    expect(res.conCambios[0].stockDisponibleActual).toBe(3);
    expect(res.conCambios[0].tieneCambios).toBe(true);
    expect(res.totalAsignado).toBe(2);
    expect(res.totalEliminar).toBe(1);
  });
});

describe('T8: fila sin cambios (asig=0, elim=0) → reconocida pero NO conCambios', () => {
  it('se clasifica correctamente', () => {
    const res = validateRepartoExcelImport([row({ asignado: 0, eliminar: 0 })], [reparto()]);
    expect(res.errores.length).toBe(0);
    expect(res.reconocidas.length).toBe(1);
    expect(res.conCambios.length).toBe(0);
    expect(res.reconocidas[0].tieneCambios).toBe(false);
  });
});

describe('Match por (RepartoId + CardCode + Codigo)', () => {
  it('mismo SKU en 2 repartos distintos: cada fila matchea su reparto correcto', () => {
    const repartos = [
      reparto({
        id: 'ING-A',
        sku: 'CLC66HAR',
        cardCode: 'C001',
        qtyBackorder: 3,
        stockDisponible: 5,
      }),
      reparto({
        id: 'ING-B',
        sku: 'CLC66HAR',
        cardCode: 'C001',
        qtyBackorder: 2,
        stockDisponible: 5,
      }),
    ];
    const filas = [
      row({ repartoId: 'ING-A', cardCode: 'C001', codigo: 'CLC66HAR', asignado: 3 }),
      row({ rowIndex: 3, repartoId: 'ING-B', cardCode: 'C001', codigo: 'CLC66HAR', asignado: 2 }),
    ];
    const res = validateRepartoExcelImport(filas, repartos);
    expect(res.errores.length).toBe(0);
    expect(res.conCambios.length).toBe(2);
    expect(res.conCambios.find((r) => r.repartoId === 'ING-A').asignadoNuevo).toBe(3);
    expect(res.conCambios.find((r) => r.repartoId === 'ING-B').asignadoNuevo).toBe(2);
  });
});

describe('groupImportMatchesByReparto', () => {
  it('agrupa por reparto y separa assignments/eliminations', () => {
    const matches = [
      {
        rowIndex: 2,
        repartoId: 'ING-1',
        cardCode: 'C001',
        sku: 'SKU-A',
        clientName: 'ACME',
        backorderActual: 5,
        stockDisponibleActual: 10,
        asignadoNuevo: 3,
        eliminarNuevo: 0,
        tieneCambios: true,
      },
      {
        rowIndex: 3,
        repartoId: 'ING-1',
        cardCode: 'C002',
        sku: 'SKU-A',
        clientName: 'BETA',
        backorderActual: 2,
        stockDisponibleActual: 10,
        asignadoNuevo: 0,
        eliminarNuevo: 2,
        tieneCambios: true,
      },
      {
        rowIndex: 4,
        repartoId: 'ING-2',
        cardCode: 'C001',
        sku: 'SKU-B',
        clientName: 'ACME',
        backorderActual: 1,
        stockDisponibleActual: 5,
        asignadoNuevo: 1,
        eliminarNuevo: 0,
        tieneCambios: true,
      },
    ];
    const groups = groupImportMatchesByReparto(matches);
    expect(groups.length).toBe(2);
    const g1 = groups.find((g) => g.repartoId === 'ING-1');
    expect(g1.assignments.length).toBe(1);
    expect(g1.assignments[0].cardCode).toBe('C001');
    expect(g1.assignments[0].qtyAsignada).toBe(3);
    expect(g1.eliminations.length).toBe(1);
    expect(g1.eliminations[0].cardCode).toBe('C002');
    expect(g1.eliminations[0].qtyEliminar).toBe(2);
    const g2 = groups.find((g) => g.repartoId === 'ING-2');
    expect(g2.assignments.length).toBe(1);
    expect(g2.eliminations.length).toBe(0);
  });
});

describe('Edge cases', () => {
  it('empty filas array', () => {
    const res = validateRepartoExcelImport([], [reparto()]);
    expect(res.reconocidas.length).toBe(0);
    expect(res.errores.length).toBe(0);
  });
  it('empty repartos array → todas not_found', () => {
    const res = validateRepartoExcelImport([row()], []);
    expect(res.errores.length).toBe(1);
    expect(res.errores[0].type).toBe('not_found');
  });
});
