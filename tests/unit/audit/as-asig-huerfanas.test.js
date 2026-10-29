// v1520 (2026-10-29) — análisis puro del script AS_asig_huerfanas.cjs.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { lineReservesStock } from '../../../src/pure/stock-realmente-disponible.js';

const require = createRequire(import.meta.url);
const { analizar, planLimpieza } = require('../../../scripts/audit/AS_asig_huerfanas.cjs');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const asigAt = '2026-10-28T15:50:00Z';

function fixture() {
  const pedidos = [
    {
      _fsId: 'PED_REBORN',
      clientCardCode: 'C30710852762',
      clientName: 'REBORN SRL',
      createdAt: '2026-10-20T10:00:00Z',
      closedAt: null,
      lines: [
        { code: 'CLC66H2PY', state: 'ASIG', qty: 0, qtyOpen: 0, asigAt, asigFromReparto: 'ING1' },
        { code: 'CLC66H2PY', state: 'BO', qty: 2, qtyOpen: 0, splitFromLineIndex: 0, asigRevertidaReason: 'asig_sin_stock_revertida_a_bo' },
        { code: 'CLC66H2PY', state: 'ASIG', qty: 2, qtyOpen: 2, asigAt, asigFromReparto: 'ING2' },
        { code: 'TRX301B', state: 'ASIG', qty: 1, qtyOpen: 1, asigAt, asigFromReparto: 'ING3' },
      ],
    },
  ];
  const waitlists = [
    {
      _id: 'WL1',
      orderNumber: 600,
      clientName: 'REBORN SRL',
      clientCardCode: 'C30710852762',
      closedAt: null,
      stage: 'review',
      pedidosOrigenes: [{ pedidoId: 'PED_REBORN', lineIndex: 0, sku: 'CLC66H2PY', qtyAsignada: 2 }],
      items: [{ code: 'CLC66H2PY', qty: 2, origen: 'stock-asignado', asigRefs: [{ pedidoId: 'PED_REBORN', lineIndex: 0, sku: 'CLC66H2PY', qtyAsignada: 2 }] }],
    },
  ];
  const ingresos = [
    { _id: 'ING2', sku: 'CLC66H2PY', appliedAt: asigAt, assignments: [{ pedidoId: 'PED_REBORN', lineIndex: 1, qtyAsignada: 2 }] },
    { _id: 'ING9', sku: 'TRX301B', appliedAt: asigAt, assignments: [{ pedidoId: 'PED_REBORN', lineIndex: 3, qtyAsignada: 7 }] },
  ];
  const perSkuSnap = {
    TRX301B: { asignadas: { total: 8, byClient: { C30710852762: 1, C_VIEJO: 7 } } },
  };
  return { pedidos, waitlists, ingresos, perSkuSnap, nowMs: NOW, lineReservesStock };
}

describe('AS analizar', () => {
  it('Z: detecta la zombie CLC66H2PY y que la referencia la waitlist', () => {
    const r = analizar(fixture());
    expect(r.Z).toHaveLength(1);
    expect(r.Z[0]).toMatchObject({ pedidoId: 'PED_REBORN', lineIndex: 0, sku: 'CLC66H2PY', revertida: true, refsWaitlist: ['WL1'], fantasma: 2 });
  });

  it('W: waitlist apuntando a la zombie = 2u fantasma', () => {
    const r = analizar(fixture());
    expect(r.W).toHaveLength(1);
    expect(r.W[0]).toMatchObject({ waitlistId: 'WL1', lineIndex: 0, lineQtyOpen: 0, fantasma: 2 });
  });

  it('R: asignación de reparto sin línea con asigFromReparto=ingreso', () => {
    const r = analizar(fixture());
    const sinLinea = r.R.filter((x) => x.tipo === 'asignacion_sin_linea');
    expect(sinLinea).toEqual([expect.objectContaining({ ingresoId: 'ING9', sku: 'TRX301B', fantasma: 7 })]);
  });

  it('S: clave vieja en stock_snapshot/{SKU}.byClient (merge:true no la borra)', () => {
    const r = analizar(fixture());
    expect(r.S).toEqual([expect.objectContaining({ sku: 'TRX301B', cardCode: 'C_VIEJO', snapshot: 7, real: 0, fantasma: 7 })]);
  });

  it('filtro por SKU', () => {
    const r = analizar({ ...fixture(), skuFiltro: 'TRX301B' });
    expect(r.Z).toHaveLength(0);
    expect(r.W).toHaveLength(0);
  });
});

describe('AS planLimpieza', () => {
  it('re-apunta la ref a la ASIG viva y cierra la zombie', () => {
    const f = fixture();
    const acciones = planLimpieza(analizar(f), f.pedidos);
    expect(acciones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accion: 'corregir_ref', waitlistId: 'WL1', deLineIndex: 0, aLineIndex: 2 }),
        expect.objectContaining({ accion: 'cerrar_zombie', pedidoId: 'PED_REBORN', lineIndex: 0 }),
        expect.objectContaining({ accion: 'manual', ingresoId: 'ING9' }),
      ])
    );
  });

  it('sin ASIG viva alternativa → liberar_ref', () => {
    const f = fixture();
    f.pedidos[0].lines[2] = { code: 'CLC66H2PY', state: 'BO', qty: 2, qtyOpen: 2 };
    const acciones = planLimpieza(analizar(f), f.pedidos);
    expect(acciones).toEqual(expect.arrayContaining([expect.objectContaining({ accion: 'liberar_ref', waitlistId: 'WL1' })]));
  });
});
