// @ts-check
/**
 * v1400 §40.8 D3 — una línea confirmed cuya SQ ya se convirtió en SO en SAP
 * (pedido.transferidoSAP.orderDocEntry != null) NO reserva stock. SAP ya la
 * descuenta de Available; la app no debe reservarla también (doble conteo).
 *
 * Hallazgo pre-fix (2026-10-21): 47 líneas / 119 u / 46 SKUs.
 */
import { describe, expect, it } from 'vitest';
import { lineReservesStock as lineReservesStockCF } from '../../../functions/core/pedido-snapshot-core.js';
import { getStockBreakdown } from '../../../src/pure/stock-breakdown.js';
import { lineReservesStock } from '../../../src/pure/stock-realmente-disponible.js';

const NOW = Date.parse('2026-10-21T18:00:00Z');
const confIso = new Date(NOW - 3 * 24 * 3600 * 1000).toISOString();

function pedConfirmedConSO(opts = {}) {
  return {
    _fsId: 'p1',
    closedAt: null,
    clientCardCode: 'C1',
    clientName: 'C',
    createdAt: confIso,
    confirmedAt: confIso,
    transferidoSAP: Object.assign(
      {
        docNum: '12345',
        docEntry: 12345,
      },
      opts
    ),
    lines: [{ code: 'X', state: 'confirmed', qty: 5, qtyOpen: 5 }],
  };
}

describe('v1400 §40.8 D3: confirmed con orderDocEntry NO reserva', () => {
  it('confirmed sin orderDocEntry → reserva (TTL vigente)', () => {
    const p = pedConfirmedConSO({ docEntry: 12345 });
    delete p.transferidoSAP.orderDocEntry;
    const r = lineReservesStock(p.lines[0], NOW, p);
    expect(r).toBe(true);
  });

  it('confirmed con orderDocEntry presente → NO reserva (SAP cubre)', () => {
    const p = pedConfirmedConSO({ docEntry: 12345, orderDocEntry: 67890 });
    const r = lineReservesStock(p.lines[0], NOW, p);
    expect(r).toBe(false);
  });

  it('confirmed con orderDocEntry=0 (valor explícito) también NO reserva', () => {
    // Edge: SAP a veces devuelve 0 como SO. Lo consideramos presente igual.
    const p = pedConfirmedConSO({ docEntry: 12345, orderDocEntry: 0 });
    const r = lineReservesStock(p.lines[0], NOW, p);
    expect(r).toBe(false);
  });

  it('confirmed con orderDocEntry=null → sí reserva (null != undefined pero el guard pasa a false correctamente)', () => {
    const p = pedConfirmedConSO({ docEntry: 12345, orderDocEntry: null });
    const r = lineReservesStock(p.lines[0], NOW, p);
    expect(r).toBe(true);
  });

  it('confirmed con orderDocEntry presente + TTL vencido (>60d): sigue sin reservar (fix antes del TTL check)', () => {
    const oldConf = new Date(NOW - 100 * 24 * 3600 * 1000).toISOString();
    const p = Object.assign(pedConfirmedConSO({ docEntry: 12345, orderDocEntry: 67890 }), {
      confirmedAt: oldConf,
    });
    const r = lineReservesStock(p.lines[0], NOW, p);
    expect(r).toBe(false);
  });

  it('breakdown post-fix: libre sube porque confirmed con orderDocEntry no cuenta', () => {
    const p = pedConfirmedConSO({ docEntry: 12345, orderDocEntry: 67890 });
    const b = getStockBreakdown(
      'X',
      {
        getStockFisico: () => 10,
        pedidos: [p],
      },
      { now: NOW }
    );
    expect(b.confirmadasSinFacturar.total).toBe(0);
    expect(b.libre).toBe(10);
  });

  it('breakdown pre-fix (orderDocEntry ausente): confirmed sí cuenta', () => {
    const p = pedConfirmedConSO({ docEntry: 12345 });
    delete p.transferidoSAP.orderDocEntry;
    const b = getStockBreakdown(
      'X',
      {
        getStockFisico: () => 10,
        pedidos: [p],
      },
      { now: NOW }
    );
    expect(b.confirmadasSinFacturar.total).toBe(5);
    expect(b.libre).toBe(5);
  });

  it('mirror functions/core comporta igual que src/pure', () => {
    const p = pedConfirmedConSO({ docEntry: 12345, orderDocEntry: 67890 });
    expect(lineReservesStockCF(p.lines[0], NOW, p)).toBe(false);
    delete p.transferidoSAP.orderDocEntry;
    expect(lineReservesStockCF(p.lines[0], NOW, p)).toBe(true);
  });

  it('idempotencia: 2 lecturas con mismos args → mismo resultado', () => {
    const p = pedConfirmedConSO({ docEntry: 12345, orderDocEntry: 67890 });
    const a = lineReservesStock(p.lines[0], NOW, p);
    const b = lineReservesStock(p.lines[0], NOW, p);
    expect(a).toBe(b);
  });

  it('ASIG line con pedido.transferidoSAP.orderDocEntry: NO afectado (solo confirmed)', () => {
    const nowIsoAsig = new Date(NOW - 2 * 24 * 3600 * 1000).toISOString();
    const p = pedConfirmedConSO({ docEntry: 12345, orderDocEntry: 67890 });
    p.lines = [
      { code: 'X', state: 'ASIG', qty: 2, qtyOpen: 2, asigReserva: true, asigAt: nowIsoAsig },
    ];
    const r = lineReservesStock(p.lines[0], NOW, p);
    expect(r).toBe(true);
  });

  it('BO line con pedido.transferidoSAP.orderDocEntry: NO afectado (BO ya no reserva por §40 pero ni siquiera llega al guard)', () => {
    const p = pedConfirmedConSO({ docEntry: 12345, orderDocEntry: 67890 });
    p.lines = [{ code: 'X', state: 'BO', qty: 2, qtyOpen: 2 }];
    const r = lineReservesStock(p.lines[0], NOW, p);
    expect(r).toBe(false); // BO no reserva (§40), no por el guard D3.
  });
});
