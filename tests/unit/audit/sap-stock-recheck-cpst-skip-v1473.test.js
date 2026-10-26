// @ts-check
/**
 * v1473 §39 (2026-10-26) — tests del skip CPST en sap-stock-recheck.
 *
 * Reportado Federico ORDEN 530 SUSANA ANDRILI: pedido confirmed quedó stuck
 * con `needsManualIntervention=true` por `stock_degradado_cf_skip`. En ese
 * caso específico el motivo fue `sap_item_not_found` (EXGTVC66M4AR no existe
 * en SAP catalog), pero el fix defensivo cubre el bug equivalente del v1466
 * aplicado al envío a SAP: líneas CPST (origen=stock-asignado + asigRefs)
 * tienen reserva propia del cliente, ya validaron utilizablePara(cardCode)
 * en commitPedidoCore, y el whs11 raw de SAP las degradaría espuriamente
 * porque SAP tiene esa qty Committed en otro doc.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSkipSetForCpstLines,
  filterLinesByLiveStock,
} from '../../../functions/core/sap-stock-recheck-core.js';

describe('v1473 §39 — buildSkipSetForCpstLines', () => {
  it('T1 líneas con origen=stock-asignado + asigRefs → se incluyen en skip', () => {
    const lines = [
      {
        code: 'CUDC201HG',
        qty: 4,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'X', lineIndex: 9, sku: 'CUDC201HG', qtyAsignada: 2 }],
      },
      { code: 'MANUAL1', qty: 1 },
    ];
    const skip = buildSkipSetForCpstLines(lines);
    expect(skip.has('CUDC201HG')).toBe(true);
    expect(skip.has('MANUAL1')).toBe(false);
    expect(skip.size).toBe(1);
  });

  it('T2 líneas con origen=stock-asignado pero asigRefs vacío → NO skip', () => {
    const lines = [
      { code: 'A', qty: 1, origen: 'stock-asignado', asigRefs: [] },
      { code: 'B', qty: 1, origen: 'stock-asignado' /* sin asigRefs */ },
    ];
    expect(buildSkipSetForCpstLines(lines).size).toBe(0);
  });

  it('T3 líneas con otro origen (manual, undefined) → NO skip', () => {
    const lines = [
      { code: 'X', qty: 1 },
      { code: 'Y', qty: 1, origen: 'excel' },
      { code: 'Z', qty: 1, origen: 'manual' },
    ];
    expect(buildSkipSetForCpstLines(lines).size).toBe(0);
  });

  it('T4 normaliza a UPPERCASE + trim', () => {
    const lines = [
      {
        code: '  cudc201hg  ',
        qty: 1,
        origen: 'stock-asignado',
        asigRefs: [{ pedidoId: 'X', lineIndex: 1, sku: 'cudc201hg', qtyAsignada: 1 }],
      },
    ];
    const skip = buildSkipSetForCpstLines(lines);
    expect(skip.has('CUDC201HG')).toBe(true);
  });

  it('T5 input vacío / null / no-array → Set vacío', () => {
    expect(buildSkipSetForCpstLines([]).size).toBe(0);
    expect(buildSkipSetForCpstLines(null).size).toBe(0);
    expect(buildSkipSetForCpstLines(undefined).size).toBe(0);
    expect(buildSkipSetForCpstLines('not-array').size).toBe(0);
  });

  it('T6 fixture REAL ORDEN 530 SUSANA ANDRILI: línea CUDC201HG CPST', () => {
    // De los logs reales:
    const lines = [
      {
        code: 'CUDC201HG',
        qty: 4,
        qtyOpen: 4,
        state: 'confirmed',
        origen: 'stock-asignado',
        asigRefs: [
          { qtyAsignada: 2, lineIndex: 9, sku: 'CUDC201HG', pedidoId: 'VxkAnBLXsxbkE19WF7ji' },
        ],
        precio: 326000,
      },
      // Resto son manuales
      { code: 'EXGTVC66M4AR', qty: 1, state: 'confirmed', precio: 78000 },
    ];
    const skip = buildSkipSetForCpstLines(lines);
    expect(skip.has('CUDC201HG')).toBe(true);
    expect(skip.has('EXGTVC66M4AR')).toBe(false); // manual → se re-chequea → sap_item_not_found correcto
  });
});

describe('v1473 §39 — filterLinesByLiveStock con skipByItemCode', () => {
  function _mockSession() {
    return { CompanyDB: 'test', SessionId: 'xyz', cookie: 'B1SESSION=x' };
  }
  function _mockDepsWithAvail(availMap) {
    const body = {
      value: Array.from(availMap.entries()).map(([itemCode, qty]) => ({
        ItemCode: itemCode,
        ItemWarehouseInfoCollection: [
          { WarehouseCode: '11', InStock: qty, Committed: 0, Ordered: 0 },
        ],
      })),
    };
    return {
      sapConfig: { url: 'https://sap-mock' },
      fetch: async () => ({
        status: 200,
        text: async () => JSON.stringify(body),
      }),
    };
  }

  it('T10 línea CPST con whs11=0 pero skip → se mantiene (NO degrada)', async () => {
    const session = _mockSession();
    const deps = _mockDepsWithAvail(new Map([['CUDC201HG', 0]]));
    const lines = [{ ItemCode: 'CUDC201HG', Quantity: 4 }];
    const r = await filterLinesByLiveStock(session, lines, deps, {
      skipByItemCode: new Set(['CUDC201HG']),
    });
    expect(r.keptLines).toHaveLength(1);
    expect(r.degradedLines).toHaveLength(0);
    expect(r.checkSucceeded).toBe(true);
  });

  it('T11 pre-v1473 (sin skip): línea con whs11=0 → DEGRADED insufficient_whs11_stock', async () => {
    const session = _mockSession();
    const deps = _mockDepsWithAvail(new Map([['CUDC201HG', 0]]));
    const lines = [{ ItemCode: 'CUDC201HG', Quantity: 4 }];
    const r = await filterLinesByLiveStock(session, lines, deps); // sin opts
    expect(r.keptLines).toHaveLength(0);
    expect(r.degradedLines).toHaveLength(1);
    expect(r.degradedLines[0].reason).toBe('insufficient_whs11_stock');
  });

  it('T12 skip opcional NO afecta a líneas manuales fuera del set', async () => {
    const session = _mockSession();
    const deps = _mockDepsWithAvail(
      new Map([
        ['CPST1', 0],
        ['MANUAL1', 5],
      ])
    );
    const lines = [
      { ItemCode: 'CPST1', Quantity: 2 },
      { ItemCode: 'MANUAL1', Quantity: 10 }, // excede → degraded
    ];
    const r = await filterLinesByLiveStock(session, lines, deps, {
      skipByItemCode: new Set(['CPST1']),
    });
    expect(r.keptLines.map((l) => l.ItemCode)).toEqual(['CPST1']);
    expect(r.degradedLines.map((l) => l.itemCode)).toEqual(['MANUAL1']);
  });

  it('T13 sap_item_not_found NO se filtra por skip (es error de catalog real)', async () => {
    const session = _mockSession();
    const deps = _mockDepsWithAvail(new Map()); // mapa vacío → ningún ItemCode
    const lines = [{ ItemCode: 'INEXISTENTE', Quantity: 1 }];
    const r = await filterLinesByLiveStock(session, lines, deps); // sin skip
    expect(r.degradedLines).toHaveLength(1);
    expect(r.degradedLines[0].reason).toBe('sap_item_not_found');
  });

  it('T14 skip array (en vez de Set) también funciona', async () => {
    const session = _mockSession();
    const deps = _mockDepsWithAvail(new Map([['A', 0]]));
    const lines = [{ ItemCode: 'A', Quantity: 1 }];
    const r = await filterLinesByLiveStock(session, lines, deps, {
      skipByItemCode: ['A'],
    });
    expect(r.keptLines).toHaveLength(1);
  });
});

describe('v1473 — contrato: auto-send-sap-core usa el skip', () => {
  it('T20 grep auto-send-sap-core.js: importa buildSkipSetForCpstLines + lo usa', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/auto-send-sap-core.js', 'utf8');
    expect(core).toMatch(
      /import \{\s*buildSkipSetForCpstLines[^}]*\}\s*from '\.\/sap-stock-recheck-core/
    );
    expect(core).toMatch(/buildSkipSetForCpstLines\(afterData\s*&&\s*afterData\.lines\)/);
    expect(core).toMatch(/skipByItemCode:\s*_skipCpstSet/);
  });
});

describe('v1473 — confirmedAt + createdAt como ISO string', () => {
  it('T30 commit-pedido-core.js escribe nowIso (NO FieldValue.serverTimestamp)', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    // Post-v1473: ambas keys como nowIso, sin FieldValue.
    expect(core).toMatch(/confirmedAt:\s*nowIso,/);
    expect(core).toMatch(/createdAt:\s*nowIso,/);
    expect(core).not.toMatch(/confirmedAt:\s*FieldValue\s*\?\s*FieldValue\.serverTimestamp/);
    expect(core).not.toMatch(/createdAt:\s*FieldValue\s*\?\s*FieldValue\.serverTimestamp/);
  });
});
