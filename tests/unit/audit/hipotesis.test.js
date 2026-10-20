// @ts-check
/**
 * E3 — Verificacion de hipotesis H1-H6 (auditoria flujo stock CRM, 2026-10-20).
 *
 * Reglas:
 * - Importar codigo real del repo (no reimplementar formulas).
 * - H1-H4 testables con unit; H5 (carrera) solo documentable; H6 testable
 *   parcial (flow actual la descarta por diseno v701).
 * - Hipotesis CONFIRMADA => test que reproduce el bug (expect bug.value).
 * - Hipotesis DESCARTADA => test que verifica que el bug NO ocurre.
 */
import { describe, expect, it } from 'vitest';
import {
  getStockPorCliente,
  getStockRealmenteDisponible,
  lineReservesStock,
} from '../../../src/pure/stock-realmente-disponible.js';
import { splitPedidoLine } from '../../../src/pure/pedido-split.js';
import {
  AT_NOW,
  CUARTO,
  lineASIG,
  lineBO,
  makeDeps,
  NORTE,
  OESTE,
  pedidoOpen,
  SKU_STRADIC,
  SUR,
} from './_fixtures.js';

// =============================================================================
// H1 — "Crear Pedido Desde Stock Asignado" resta la propia reserva del cliente
//      (viola I2) → disp=0 → todo a BO.
//      Veredicto: CONFIRMADA.
// =============================================================================
describe('H1 — Pedido ex-ASIG resta propia reserva (viola I2)', () => {
  it('CONFIRMADA: con 1u ASIG propia + 1u fisico, call-site getDisp devuelve 0 (bug observado)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    // Call-site exacto de doConfirmPedido (index.html:34720-34722).
    const dispCallSite = getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW);
    expect(dispCallSite).toBe(0); // bug observado hoy
  });

  it('CONFIRMADA: splitPedidoLine en el mismo escenario produce state=BO', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const getDisp = (sku) => getStockRealmenteDisponible(sku, deps, AT_NOW);
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 1000 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO'); // bug observado
    expect(lines[0].qty).toBe(1);
  });

  it('CONFIRMADA: el preview CPST (fórmula correcta por cliente) SI calcula disp=1', () => {
    // _cpstRenderPreview usa getStockPorCliente + firmesPropias.
    // Esta es la formula que deberia usarse en el split tambien.
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)])],
    });
    const r = getStockPorCliente(SKU_STRADIC, OESTE, deps, AT_NOW);
    const residual = Math.max(r.fisico - r.reservadasPorCliente - r.reservadasPorOtros, 0);
    const dispPreview = Math.min(r.fisico, r.reservadasPorCliente + residual);
    expect(dispPreview).toBe(1); // formula correcta
    // Divergencia explicita: preview CPST ve 1, split confirm ve 0.
    const dispSplit = getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW);
    expect(dispPreview).toBeGreaterThan(dispSplit); // 1 > 0
  });
});

// =============================================================================
// H2 — Reserva no se libera al enviar a SAP (viola I3)
//      Veredicto: DESCARTADA en el pure fn (lineReservesStock libera invoiced/
//      cancelled correctamente). End-to-end no verificable con unit.
// =============================================================================
describe('H2 — Reserva no se libera al enviar a SAP', () => {
  it('DESCARTADA (parcial): lineReservesStock(invoiced) = false', () => {
    const line = { state: 'invoiced', qtyOpen: 0, qty: 1 };
    expect(lineReservesStock(line, AT_NOW.now, null)).toBe(false);
  });

  it('DESCARTADA (parcial): lineReservesStock(cancelled) = false', () => {
    const line = { state: 'cancelled', qtyOpen: 0, qty: 1 };
    expect(lineReservesStock(line, AT_NOW.now, null)).toBe(false);
  });

  it('DESCARTADA (parcial): TTL 7d expira ASIG viejas (olvidadas)', () => {
    // v959/v1198: ASIG con asigAt > 7 dias atras no reserva.
    const asigViejaMs = AT_NOW.now - 8 * 24 * 60 * 60 * 1000;
    const line = {
      state: 'ASIG',
      qty: 1,
      qtyOpen: 1,
      asigReserva: true,
      asigAt: new Date(asigViejaMs).toISOString(),
    };
    expect(lineReservesStock(line, AT_NOW.now, null)).toBe(false);
  });

  it('NO VERIFICABLE unit: cadena doConfirmPedido._origenesACancelar + invoice-sync.applyInvoiceMatch', () => {
    // Requiere firestore emulator + CF triggers para verificar que:
    // 1. La ASIG original se cancela cliente-side al confirmar pedido ex-ASIG.
    // 2. Al facturar en SAP, applyInvoiceMatch marca state='invoiced' con qtyOpen=0.
    // 3. No hay double-release (ASIG cancelada + invoiced simultaneo).
    // Query diagnostico A (E5) detecta double-release en prod.
    expect(true).toBe(true);
  });
});

// =============================================================================
// H3 — Fisico mal leido (otro deposito / suma / snapshot stale)
//      Veredicto: DESCARTADA en pure fn (getStockFisico es inyectable).
//      Verificar en E5 que el wrapper runtime apunta a dep 11.
// =============================================================================
describe('H3 — Físico mal leído', () => {
  it('DESCARTADA: getStockRealmenteDisponible consulta getStockFisico 1 sola vez', () => {
    // Si estuviera sumando otros depositos, llamaria mas de 1 vez por sku.
    let calls = 0;
    const deps = {
      getStockFisico: () => {
        calls++;
        return 5;
      },
      pedidos: [],
    };
    getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW);
    expect(calls).toBe(1);
  });

  it('DESCARTADA: snapshot stale protection — ignora pedidos con closedAt', () => {
    // Un pedido cerrado no cuenta — safety contra reads sin fresh listener.
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 10 },
      pedidos: [
        pedidoOpen('p1', NORTE, [lineASIG(SKU_STRADIC, 5)], {
          closedAt: '2026-10-15T00:00:00Z',
        }),
      ],
    });
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(10);
  });

  it('NO VERIFICABLE unit: que window.getStockDisponibleVenta apunta a dep 11', () => {
    // index.html:7478-7497 lee STOCK_WAREHOUSE_BREAKDOWN[sku]['11'].
    // Verificar en E5 que el snapshot runtime no tiene SKUs con warehouseBreakdown
    // vacio o con otros depositos como fallback.
    expect(true).toBe(true);
  });
});

// =============================================================================
// H4 — Pedido parcial mal partido (viola I7)
//      Veredicto: DESCARTADA con flag ON, CONFIRMADA con flag OFF.
// =============================================================================
describe('H4 — Pedido parcial mal partido', () => {
  it('DESCARTADA (flag ON): qty 10 disp 7 → 2 lineas {7 confirmed, 3 BO}', () => {
    const lines = splitPedidoLine(
      { code: 'X', qty: 10, precio: 100 },
      { getDisp: () => 7, flagEnabled: true }
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: 7, state: 'confirmed' });
    expect(lines[1]).toMatchObject({ qty: 3, state: 'BO' });
  });

  it('CONFIRMADA (flag OFF kill switch v600): qty 10 disp 7 → 1 linea 100% BO', () => {
    const lines = splitPedidoLine(
      { code: 'X', qty: 10, precio: 100 },
      { getDisp: () => 7, flagEnabled: false }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
    expect(lines[0].qty).toBe(10);
    // Bug persistente en browsers con localStorage.split_enabled='0'.
  });
});

// =============================================================================
// H5 — Condicion de carrera: 2 envios simultaneos leen mismo Disponible
//      Veredicto: NO VERIFICABLE con unit (requiere orquestacion paralela)
// =============================================================================
describe('H5 — Condición de carrera entre envíos simultáneos', () => {
  it('NO VERIFICABLE unit: requiere firestore emulator + 2 contextos concurrentes', () => {
    // Vectores de riesgo documentados:
    // 1. sap-auto-send-listener.js: lock por `sendingSapLock` con TTL 300s + double-check post-createQuotation (v577).
    //    Mitigacion existente, no eliminable con unit test.
    // 2. applyRepartoManualCore (reparto-core.js): runTransaction + status lock 'in_progress'.
    //    Mitigacion existente server-side.
    // 3. doConfirmPedido NO esta dentro de transaccion:
    //    - El getDisp lee globalPedidos (snapshot cliente-side).
    //    - Si otro cliente agrega un BO entre el leer y el commit, puede dar
    //      el stock al VDE A y al VDE B.
    //    - No hay snapshot read-and-check en el write.
    // Para prod: query diagnostico A en E5 mide overcommit (reservas totales > fisico).
    expect(true).toBe(true);
  });
});

// =============================================================================
// H6 — Ventana sin protección entre ingreso y reparto (viola O1)
//      Veredicto: DESCARTADA en el flow actual (BO reserva stock por diseño v701).
//      Es un hallazgo de glosario, no un bug.
// =============================================================================
describe('H6 — Ventana sin protección entre ingreso y reparto', () => {
  it('DESCARTADA: con BO pendientes, un cuarto cliente NO ve stock disponible', () => {
    // Escenario PASO 5 end-to-end: Fisico=1, Sur BO 1, Oeste BO 1 (ambos pendientes).
    // Un cuarto cliente que intenta cargar un pedido NO deberia ver Disponible=1.
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [
        pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)]),
        pedidoOpen('p-oeste', OESTE, [lineBO(SKU_STRADIC, 1)]),
      ],
    });
    // Codigo actual (politica v701): BO reserva stock. Disp = 0.
    const disp = getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW);
    expect(disp).toBe(0);
    // Para un cuarto cliente: libreParaCliente = fisico - reservasOtros = 1 - 2 = max(0, -1) = 0
    const rCuarto = getStockPorCliente(SKU_STRADIC, CUARTO, deps, AT_NOW);
    expect(rCuarto.libreParaCliente).toBe(0);
  });

  it('DESCARTADA (nota de glosario): el prompt describe un sistema donde BO NO reserva', () => {
    // El prompt dice "Disponible = Fisico - Reservado" donde Reservado = ASIG
    // (asignado por Pablo). El codigo cuenta BO + confirmed + ASIG como reserva.
    // Semantica distinta pero el codigo es mas protectivo (O1 cumple).
    // No es bug — es diseno conservador v701 (app owns stock).
    expect(true).toBe(true);
  });
});
