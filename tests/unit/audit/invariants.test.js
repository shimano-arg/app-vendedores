// @ts-check
/**
 * E2 — Tests de invariantes I1-I7 (auditoria flujo stock CRM, 2026-10-20).
 *
 * Reglas:
 * - Importan codigo real del repo (sin mocks de la formula).
 * - Las invariantes VIOLA generan tests que FAIL — eso es la evidencia.
 * - Si una invariante no se puede testear con unit (ej. depende de CF trigger
 *   o modal UI render), queda como NO VERIFICABLE con descripcion explicita.
 */
import { describe, expect, it } from 'vitest';
import { splitPedidoLine } from '../../../src/pure/pedido-split.js';
import {
  getStockPorCliente,
  getStockRealmenteDisponible,
  lineReservesStock,
} from '../../../src/pure/stock-realmente-disponible.js';
import {
  AT_NOW,
  lineASIG,
  lineBO,
  lineConfirmed,
  makeDeps,
  NORTE,
  OESTE,
  pedidoOpen,
  SKU_STRADIC,
  SUR,
} from './_fixtures.js';

// =============================================================================
// I1 — Disp = Fisico(dep 11) - Reservado, nunca negativo; Fisico solo dep 11
// =============================================================================
describe('I1 — Disp = Fisico - Reservado, no negativo, Fisico solo dep 11', () => {
  it('CUMPLE: 3 fisico, 0 reservas → disp 3', () => {
    const deps = makeDeps({ fisicoBySku: { [SKU_STRADIC]: 3 }, pedidos: [] });
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(3);
  });

  it('CUMPLE: 1 fisico, 2 reservas BO → disp max(0, 1-2) = 0 (nunca negativo)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [
        pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)]),
        pedidoOpen('p-oeste', OESTE, [lineBO(SKU_STRADIC, 1)]),
      ],
    });
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(0);
  });

  it('CUMPLE: ignora pedidos con closedAt', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 5 },
      pedidos: [
        pedidoOpen('p1', SUR, [lineASIG(SKU_STRADIC, 3)], { closedAt: '2026-10-19T10:00:00.000Z' }),
      ],
    });
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(5);
  });

  it('CUMPLE: fisico es inyectado solo via getStockFisico(sku); el deps no consulta otros depositos', () => {
    // Diseno: el pure fn delega 100% en getStockFisico. Si el wrapper runtime
    // lo apunta a dep 11, el pure fn no suma otros depositos.
    let called = 0;
    const deps = {
      getStockFisico: (sku) => {
        called++;
        return sku === SKU_STRADIC ? 7 : 0;
      },
      pedidos: [],
    };
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(7);
    // Un solo lookup. Si llamara mas de 1 vez por SKU, podria estar sumando.
    expect(called).toBe(1);
  });
});

// =============================================================================
// I2 — Pedido ex-ASIG: Utilizable(C) = Disp + Reservado(C)
//      La reserva del propio cliente NO se resta en su contra.
// =============================================================================
describe('I2 — Utilizable(C) = Disp + Reservado(C) para pedidos ex-ASIG', () => {
  /**
   * Escenario PASO 7-8 del end-to-end:
   * - Fisico 1
   * - Oeste tiene ASIG 1u (reservada por Pablo)
   * - Pablo crea CPST para Oeste → se abre modal, preview muestra Utilizable=1
   * - VDE Oeste pasa el waitlist a Pendientes → doConfirmPedido llama a splitPedidoLine
   *   con getDisp = window.getStockRealmenteDisponible(sku) ← SIN cardCode
   */
  const buildEscenarioOeste = () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    return deps;
  };

  it('getStockPorCliente(OESTE) devuelve libreParaCliente=1 (lo que ve el preview CPST)', () => {
    // El preview CPST ADEMAS suma firmesPropias (ASIG + confirmed del mismo cliente).
    // Formula completa: disp_preview = min(fisico, firmesPropias + residual).
    // getStockPorCliente ya devuelve reservadasPorCliente separada → el consumer
    // calcula disp_preview sumandolas.
    const deps = buildEscenarioOeste();
    const r = getStockPorCliente(SKU_STRADIC, OESTE, deps, AT_NOW);
    expect(r.fisico).toBe(1);
    expect(r.reservadasPorCliente).toBe(1); // Oeste ASIG
    expect(r.reservadasPorOtros).toBe(0);
    // Utilizable segun semantica del prompt I2:
    const utilizableOeste = r.fisico - r.reservadasPorOtros; // = fisico (sin restar las propias)
    expect(utilizableOeste).toBe(1);
    // ALT: utilizable = (residual) + firmesPropias
    // residual = max(fisico - resPropias - resOtros, 0) = max(1-1-0, 0) = 0
    // firmesPropias = 1
    // disp_preview = min(fisico, firmes + residual) = min(1, 1+0) = 1
    const residual = Math.max(r.fisico - r.reservadasPorCliente - r.reservadasPorOtros, 0);
    const dispPreview = Math.min(r.fisico, r.reservadasPorCliente + residual);
    expect(dispPreview).toBe(1);
  });

  // VIOLA — tests que FALLAN hasta que se arregle (patron TDD red-to-green).
  // Cuando el fix de H1 esté implementado, estos tests pasan a verde.
  it('VIOLA I2 (RED): el call-site de doConfirmPedido deberia devolver utilizable(OESTE)=1', () => {
    const deps = buildEscenarioOeste();
    // Simula el call-site exacto de doConfirmPedido (index.html:34720-34722).
    const getDispCallSite = (sku) => Math.max(getStockRealmenteDisponible(sku, deps, AT_NOW), 0);
    const disp = getDispCallSite(SKU_STRADIC);
    // SEGUN I2: Utilizable(Oeste) = Disp + Reservado(Oeste) = 0 + 1 = 1.
    // OBSERVADO HOY: 0 (porque getStockRealmenteDisponible no considera cardCode).
    expect(disp).toBe(1); // ← FALLA hoy; pasa cuando se arregle H1.
  });

  it('VIOLA I2 end-to-end (RED): splitPedidoLine deberia dar state=confirmed qty=1', () => {
    // Fase final del PASO 8: con fix de H1, splitPedidoLine deberia recibir
    // disp=1 y producir una linea confirmed.
    const deps = buildEscenarioOeste();
    const getDispCallSite = (sku) => Math.max(getStockRealmenteDisponible(sku, deps, AT_NOW), 0);
    const rawLine = { code: SKU_STRADIC, qty: 1, precio: 1000 };
    const lines = splitPedidoLine(rawLine, {
      getDisp: getDispCallSite,
      flagEnabled: true,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('confirmed'); // ← FALLA hoy (da 'BO'); pasa post-fix.
    expect(lines[0].qty).toBe(1);
  });
});

// =============================================================================
// I3 — Reserva libera 1 vez al enviar a SAP
//      Ni antes, ni dos veces, ni nunca.
// =============================================================================
describe('I3 — Reserva libera exactamente 1 vez al consumir el pedido', () => {
  it('CUMPLE parcial: lineReservesStock(linea invoiced) = false (ya liberada)', () => {
    const line = { state: 'invoiced', qtyOpen: 0, qty: 1 };
    expect(lineReservesStock(line, Date.parse('2026-10-20T00:00:00Z'), null)).toBe(false);
  });

  it('CUMPLE parcial: lineReservesStock(linea cancelled) = false', () => {
    const line = { state: 'cancelled', qtyOpen: 0, qty: 1 };
    expect(lineReservesStock(line, Date.parse('2026-10-20T00:00:00Z'), null)).toBe(false);
  });

  it('CUMPLE parcial: linea confirmed VIVA (sin confirmedAt viejo) sigue reservando', () => {
    const line = lineConfirmed(SKU_STRADIC, 1, { confirmedAt: '2026-10-18T10:00:00Z' });
    const pedido = { confirmedAt: '2026-10-18T10:00:00Z' };
    expect(lineReservesStock(line, Date.parse('2026-10-20T00:00:00Z'), pedido)).toBe(true);
  });

  it('NO VERIFICABLE via unit: la liberacion end-to-end involucra', () => {
    // - CF syncSapInvoicesToApp (functions/core/invoice-sync-core.js)
    // - CF applyInvoiceMatch (mismo archivo, L276-402)
    // - Cliente-side cancel en doConfirmPedido (_origenesACancelar, index.html:34881)
    // - Modal "Cancelar linea" manual (functions/core/asig-recycle-core.js)
    // Requiere emulador firestore + CF triggers. Dejar E5 con query diagnostico
    // para detectar reservas vivas con pedido ya enviado.
    expect(true).toBe(true);
  });
});

// =============================================================================
// I4 — Unidad nunca en 2 estados a la vez (Disp/Res/EnSAP/BO)
// =============================================================================
describe('I4 — Una unidad no esta en 2 estados a la vez', () => {
  it('CUMPLE: solo UN state activo por linea; estados exclusivos', () => {
    // Enumeracion de states y veredicto de lineReservesStock
    const states = ['confirmed', 'BO', 'ASIG', 'invoiced', 'cancelled', 'recycled', 'legacy'];
    const results = states.map((state) => {
      const line = { state, qtyOpen: 1 };
      return { state, reserves: lineReservesStock(line, Date.parse('2026-10-20T00:00:00Z'), null) };
    });
    // confirmed/BO/ASIG reservan; otros no.
    expect(results.find((r) => r.state === 'confirmed').reserves).toBe(true);
    expect(results.find((r) => r.state === 'BO').reserves).toBe(true);
    expect(results.find((r) => r.state === 'ASIG').reserves).toBe(true);
    expect(results.find((r) => r.state === 'invoiced').reserves).toBe(false);
    expect(results.find((r) => r.state === 'cancelled').reserves).toBe(false);
    expect(results.find((r) => r.state === 'recycled').reserves).toBe(false);
    expect(results.find((r) => r.state === 'legacy').reserves).toBe(false);
  });

  it('OBSERVACION: lineReservesStock devuelve bool unico por linea; no hay doble conteo por diseno', () => {
    // qty se contabiliza una sola vez via Σ qtyOpen en getStockRealmenteDisponible.
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 10 },
      pedidos: [pedidoOpen('p1', NORTE, [lineASIG(SKU_STRADIC, 3)])],
    });
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(7);
    // Si la linea se contara 2 veces (ej ASIG + waitlist CPST del mismo pedido),
    // dispondria mal. Fix v1368 arreglo este caso.
  });
});

// =============================================================================
// I5 — SKU con Fisico>0 + BO pendiente → aparece en Reparto, no en Backorder
// =============================================================================
describe('I5 — Fisico>0 + BO → Reparto (no Backorder)', () => {
  it('NO VERIFICABLE con unit test puro: depende de renderBackordersTab + modal Reparto', () => {
    // El modal "Reparto" (index.html:19997+) es alimentado por el CF
    // onDep11IncreaseCreateReparto que escribe a `ingresos_reparto/`.
    // El modal Backorder (renderBackordersTab mode='urgente') filtra por
    // state='BO' + qtyOpen>0.
    // Un SKU con fisico>0 + BO deberia:
    //   - estar en ingresos_reparto si la CF detecto delta positivo
    //   - estar en modal Backorder si tiene state='BO' independientemente del fisico
    // Es decir, PUEDE aparecer en los DOS a la vez. Es por diseno (uno es cola
    // de reparto admin, otro es listado BO general).
    // Para auditar: query diagnostico B (E5) mide SKUs en backorderBySkuApp
    // con fisico dep 11 > 0 → ese ES el candidato a reparto.
    expect(true).toBe(true);
  });
});

// =============================================================================
// I6 — No autogenerar BO si Disp cubre al momento del envio
// =============================================================================
describe('I6 — No autogenerar BO si Disp cubre al enviar', () => {
  it('CUMPLE: pedido nuevo (no ex-ASIG), fisico 10, qty 3 → 1 linea confirmed', () => {
    const deps = makeDeps({ fisicoBySku: { X: 10 }, pedidos: [] });
    const getDisp = (sku) => getStockRealmenteDisponible(sku, deps, AT_NOW);
    const lines = splitPedidoLine(
      { code: 'X', qty: 3, precio: 100 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('confirmed');
  });

  it('VIOLA I6 (RED, encadenado con H1): pedido ex-ASIG deberia ir a confirmed, no BO', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const getDisp = (sku) => getStockRealmenteDisponible(sku, deps, AT_NOW);
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 100 },
      { getDisp, flagEnabled: true }
    );
    // SEGUN I6: Utilizable(Oeste)=1 cubre qty=1 → state='confirmed'.
    expect(lines[0].state).toBe('confirmed'); // ← FALLA hoy (da 'BO').
  });

  it('VIOLA I6 (RED, flag OFF kill switch v600): parcial disp=5 qty=10 deberia partir en 5+5, no 0+10', () => {
    // Caso v600 CHALPAC pre-fix. Con flag OFF (localStorage.split_enabled=0)
    // sigue vivo el bug legacy. I6 pide que si Disp cubre parte, al menos esa
    // parte vaya a SAP.
    const deps = makeDeps({
      fisicoBySku: { X: 10 },
      pedidos: [pedidoOpen('p1', SUR, [lineBO('X', 5)])],
    });
    const getDisp = (sku) => getStockRealmenteDisponible(sku, deps, AT_NOW);
    expect(getDisp('X')).toBe(5);
    const lines = splitPedidoLine(
      { code: 'X', qty: 10, precio: 100 },
      { getDisp, flagEnabled: false }
    );
    // SEGUN I6 + I7: deberia partir 5 confirmed + 5 BO (aunque flag esté OFF,
    // la invariante del dominio no admite 100% BO con stock parcial).
    expect(lines).toHaveLength(2); // ← FALLA hoy (da 1 linea BO con flag OFF).
  });
});

// =============================================================================
// I7 — Pedido parcial se parte: cubierto a SAP, resto a BO
// =============================================================================
describe('I7 — Parcial se parte', () => {
  it('CUMPLE flag ON: qty 10, disp 7 → 2 lineas {7 confirmed, 3 BO}', () => {
    const lines = splitPedidoLine(
      { code: 'X', qty: 10, precio: 100 },
      { getDisp: () => 7, flagEnabled: true }
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: 7, state: 'confirmed', qtyOpen: 7 });
    expect(lines[1]).toMatchObject({ qty: 3, state: 'BO', qtyOpen: 3 });
  });

  it('VIOLA I7 (RED, flag OFF): qty 10 disp 7 deberia partir en 7+3, no 1 linea 100% BO', () => {
    const lines = splitPedidoLine(
      { code: 'X', qty: 10, precio: 100 },
      { getDisp: () => 7, flagEnabled: false }
    );
    // SEGUN I7: parcial se parte. Con flag OFF, el kill switch mete 100% BO.
    expect(lines).toHaveLength(2); // ← FALLA hoy (da 1 linea BO).
  });
});
