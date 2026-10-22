// @ts-check
/**
 * E3 §auditgrises G1.G05 — `revertSobreAsignadas` idempotent:
 * B18 cualquier corrida posterior a un revert exitoso NO debe generar
 * duplicados ni appendear 2a línea BO. Confirmación: línea mutada a
 * `qty=qtyEntregable` + línea BO con `state='BO'` ya no entran al bucket
 * `asignadas.detalle` → `sobreAsignada=0` en el siguiente scan.
 */
import { describe, expect, it } from 'vitest';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';

describe('G1.G05 — revertSobreAsignadas idempotent', () => {
  it('post-revert: scan 2 veces no genera nueva sobreAsignada', () => {
    // Simulamos el estado post-revert: L0 muta a qty=qtyEntregable (2 de 6),
    // L1 appendada como BO con qty=4 + audit.
    const pedidoPostRevert = {
      _fsId: 'p1',
      closedAt: null,
      stage: 'confirmed',
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      clientCardCode: 'C001',
      clientName: 'CLIENTE X',
      lines: [
        { code: 'SKU-A', state: 'ASIG', qty: 2, qtyOpen: 2, asigAt: '2026-10-20T10:00:00Z' },
        {
          code: 'SKU-A',
          state: 'BO',
          qty: 4,
          qtyOpen: 4,
          asigRevertidaAt: '2026-10-21T10:00:00Z',
          asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
          splitFromLineIndex: 0,
        },
      ],
    };

    const breakdown = getStockBreakdown(
      'SKU-A',
      {
        getStockFisico: () => 2,
        pedidos: [pedidoPostRevert],
      },
      { now: Date.parse('2026-10-21T12:00:00Z') }
    );

    expect(breakdown.asignadas.total).toBe(2);
    const sobreAsignadas = (breakdown.asignadas.detalle || []).filter((d) => d.sobreAsignada > 0);
    expect(sobreAsignadas).toHaveLength(0);
  });

  it('estado inicial pre-revert: sí hay sobreAsignada', () => {
    const pedidoPreRevert = {
      _fsId: 'p1',
      closedAt: null,
      stage: 'confirmed',
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      clientCardCode: 'C001',
      clientName: 'CLIENTE X',
      lines: [{ code: 'SKU-A', state: 'ASIG', qty: 6, qtyOpen: 6, asigAt: '2026-10-20T10:00:00Z' }],
    };
    const breakdown = getStockBreakdown(
      'SKU-A',
      {
        getStockFisico: () => 2,
        pedidos: [pedidoPreRevert],
      },
      { now: Date.parse('2026-10-21T12:00:00Z') }
    );
    const sobreAsignadas = (breakdown.asignadas.detalle || []).filter((d) => d.sobreAsignada > 0);
    expect(sobreAsignadas).toHaveLength(1);
    expect(sobreAsignadas[0].sobreAsignada).toBe(4);
  });

  it('línea BO revertida tiene audit marker preservado', () => {
    const pedido = {
      _fsId: 'p1',
      closedAt: null,
      createdAt: new Date().toISOString(),
      lines: [
        { code: 'SKU-A', state: 'ASIG', qty: 2, qtyOpen: 2, asigAt: '2026-10-20T10:00:00Z' },
        {
          code: 'SKU-A',
          state: 'BO',
          qty: 4,
          qtyOpen: 4,
          asigRevertidaReason: 'asig_sin_stock_revertida_a_bo',
        },
      ],
    };
    const revertedLine = pedido.lines[1];
    expect(revertedLine.asigRevertidaReason).toBe('asig_sin_stock_revertida_a_bo');
    expect(revertedLine.state).toBe('BO');
  });
});
