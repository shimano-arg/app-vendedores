// @ts-check
/**
 * E4 — Reproducción end-to-end 11 pasos del caso STRADIC-2500.
 *
 * SKU: STRADIC-2500. Clientes: Norte, Sur, Oeste.
 * Formato: Físico / Reservado / Disponible / Backorder.
 *
 * Nota: el prompt describe "Reservado" como SOLO ASIG (asignado por Pablo).
 * El código actual cuenta confirmed+BO+ASIG como reserva (política v701).
 * Donde el estado observable diverge del prompt, lo marcamos como:
 *   - "DIVERGE_PROMPT" si es diferencia conceptual sin bug.
 *   - "BUG_H1" si viola una invariante.
 *
 * Este test recorre los 11 pasos como estado de prueba. No es end-to-end real
 * (requiere firestore emulator + CF triggers para serlo). Es simulacion de
 * cómo el modelo evoluciona vs. lo que las fórmulas puras dicen.
 */
import { describe, expect, it } from 'vitest';
import { splitPedidoLine } from '../../../src/pure/pedido-split.js';
import {
  getStockPorCliente,
  getStockRealmenteDisponible,
  getStockUtilizableParaClienteExAsig,
} from '../../../src/pure/stock-realmente-disponible.js';
import {
  AT_NOW,
  CUARTO,
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

/**
 * Helper: devuelve el estado observable del SKU
 * {fisico, reservado_asig, disp_segun_prompt, bo}.
 * El "reservado" aqui respeta la semantica del prompt (solo ASIG).
 */
function observableState(deps) {
  const fisico = deps.getStockFisico(SKU_STRADIC);
  let reservado = 0; // solo ASIG segun semantica prompt
  let bo = 0;
  for (const p of deps.pedidos || []) {
    if (!p || p.closedAt) continue;
    for (const l of p.lines || []) {
      if (String(l.code).toUpperCase() !== SKU_STRADIC) continue;
      const q = Number(l.qtyOpen) || 0;
      if (l.state === 'ASIG' && q > 0 && l.asigReserva !== false) reservado += q;
      if (l.state === 'BO' && q > 0) bo += q;
    }
  }
  const disp = Math.max(0, fisico - reservado - bo);
  // disp_segun_prompt = fisico - solo_reservado_ASIG (BO no cuenta).
  const dispPrompt = Math.max(0, fisico - reservado);
  return { fisico, reservado, disp, dispPrompt, bo };
}

describe('end-to-end STRADIC-2500 flow (11 pasos)', () => {
  // =========================================================================
  // PASO 0 — Estado inicial
  // =========================================================================
  it('PASO 0: 3 fisico / 0 reservado / 3 disp / 0 BO', () => {
    const deps = makeDeps({ fisicoBySku: { [SKU_STRADIC]: 3 }, pedidos: [] });
    const s = observableState(deps);
    expect(s).toEqual({ fisico: 3, reservado: 0, disp: 3, dispPrompt: 3, bo: 0 });
  });

  // =========================================================================
  // PASO 1 — Lista de espera (NO reserva stock)
  // =========================================================================
  it('PASO 1: Norte pide 2, Sur pide 2, Oeste pide 1 → estado NO cambia (lista no reserva)', () => {
    // Pre-carga en revisionWaitlist manual (source != 'stock-asignado-batch')
    // no reserva stock. deps.waitlistEntries vacio en este caso.
    const deps = makeDeps({ fisicoBySku: { [SKU_STRADIC]: 3 }, pedidos: [], waitlistEntries: [] });
    const s = observableState(deps);
    expect(s).toEqual({ fisico: 3, reservado: 0, disp: 3, dispPrompt: 3, bo: 0 });
    // Codigo real: getStockRealmenteDisponible devuelve 3.
    expect(getStockRealmenteDisponible(SKU_STRADIC, deps, AT_NOW)).toBe(3);
  });

  // =========================================================================
  // PASO 2 — Norte envía 2u. Disp 3 cubre 2 → 100% SAP (state=confirmed)
  // =========================================================================
  it('PASO 2: Norte envia 2 → split 2 confirmed, SAP recibe 2 → fisico 1, confirmed 2', () => {
    const depsPre = makeDeps({ fisicoBySku: { [SKU_STRADIC]: 3 }, pedidos: [] });
    const getDisp = (sku) => getStockRealmenteDisponible(sku, depsPre, AT_NOW);
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 2, precio: 1000 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('confirmed');
    expect(lines[0].qty).toBe(2);

    // Post-envio: pedido de Norte con 2 confirmed; stock dep 11 pasa a 1
    // (SAP consume el stock al facturar; mientras tanto, confirmed sigue reservando).
    const depsPost = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 }, // SAP reservo las 2u
      pedidos: [
        pedidoOpen(
          'p-norte',
          NORTE,
          [lineConfirmed(SKU_STRADIC, 2, { confirmedAt: '2026-10-19T10:00:00Z' })],
          { confirmedAt: '2026-10-19T10:00:00Z' }
        ),
      ],
    });
    // Semantica prompt: Reservado = ASIG only. confirmed no cuenta → dispPrompt=1.
    expect(observableState(depsPost).fisico).toBe(1);
    expect(observableState(depsPost).reservado).toBe(0);
    expect(observableState(depsPost).dispPrompt).toBe(1);
  });

  // =========================================================================
  // PASO 3 — Sur envía 2u. Disp 1 cubre 1 → split {1 confirmed + 1 BO}
  // =========================================================================
  it('PASO 3: Sur envia 2, disp 1 → split 1 confirmed + 1 BO (flag ON)', () => {
    const depsPre = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [], // simplificado — en real estaria el p-norte confirmed pero no afecta disp si consumio 2
    });
    const getDisp = (sku) => getStockRealmenteDisponible(sku, depsPre, AT_NOW);
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 2, precio: 1000 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: 1, state: 'confirmed' });
    expect(lines[1]).toMatchObject({ qty: 1, state: 'BO' });
  });

  it('PASO 3 (RED, flag OFF v600): Sur envia 2 con disp 1 → 1 linea 100% BO (bug legacy)', () => {
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 2, precio: 1000 },
      { getDisp: () => 1, flagEnabled: false }
    );
    // VIOLA I7: SAP deberia recibir 1 (parcial se parte). Observado: 0.
    expect(lines).toHaveLength(2); // ← FALLA con flag OFF (confirma H4).
  });

  // =========================================================================
  // PASO 4 — Oeste envía 1u. Disp 0 → todo BO
  // =========================================================================
  it('PASO 4: Oeste envia 1 con disp 0 → 1 linea BO (correcto)', () => {
    const depsPre = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 0 },
      pedidos: [pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)])],
    });
    const getDisp = (sku) => getStockRealmenteDisponible(sku, depsPre, AT_NOW);
    expect(getDisp(SKU_STRADIC)).toBe(0);
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 1000 },
      { getDisp, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
  });

  // =========================================================================
  // PASO 5 — Ingresa 1u al dep 11, hay BO=2 pendiente
  // =========================================================================
  it('PASO 5: fisico pasa de 0 a 1 con BO=2 (Sur+Oeste); codigo actual Disp=0 (BO cuenta como reserva)', () => {
    const depsPre = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 0 },
      pedidos: [
        pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)]),
        pedidoOpen('p-oeste', OESTE, [lineBO(SKU_STRADIC, 1)]),
      ],
    });
    // Simular ingreso: fisico pasa a 1.
    const depsPost = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [
        pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)]),
        pedidoOpen('p-oeste', OESTE, [lineBO(SKU_STRADIC, 1)]),
      ],
    });
    const s = observableState(depsPost);
    // Prompt: Disp=1 (porque BO no reserva). Codigo: disp=0 (BO si reserva).
    expect(s.dispPrompt).toBe(1); // segun semantica prompt
    expect(s.disp).toBe(0); // codigo: BO reserva
    expect(getStockRealmenteDisponible(SKU_STRADIC, depsPost, AT_NOW)).toBe(0);
    // Hallazgo: la ventana H6 del prompt NO existe en el codigo (DESCARTADA).
    // CUARTO cliente no puede llevarse esa unidad.
    const rCuarto = getStockPorCliente(SKU_STRADIC, CUARTO, depsPost, AT_NOW);
    expect(rCuarto.libreParaCliente).toBe(0); // cuarto cliente ve 0 (protegido)
  });

  // =========================================================================
  // PASO 6 — Pablo reparte: asigna 1 a Oeste. Sur queda BO
  // =========================================================================
  it('PASO 6: Pablo reparte 1 a Oeste → Sur BO 1, Oeste ASIG 1', () => {
    // Simula el estado post-reparto (applyRepartoManualCore transforma 1 BO Oeste → ASIG).
    const depsPost = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [
        pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)]),
        pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)]),
      ],
    });
    const s = observableState(depsPost);
    expect(s.fisico).toBe(1);
    expect(s.reservado).toBe(1); // Oeste ASIG
    expect(s.bo).toBe(1); // Sur
    expect(s.dispPrompt).toBe(0); // 1-1=0

    // Para Oeste: reservadasPorCliente=1, libreParaCliente=fisico-otros=1-1(SurBO)=0
    const rOeste = getStockPorCliente(SKU_STRADIC, OESTE, depsPost, AT_NOW);
    expect(rOeste.reservadasPorCliente).toBe(1);
    expect(rOeste.reservadasPorOtros).toBe(1); // Sur BO cuenta
    expect(rOeste.libreParaCliente).toBe(0);
  });

  // =========================================================================
  // PASO 7 — Pablo crea CPST para Oeste. Esperado: Utilizable(Oeste)=1
  // =========================================================================
  it('PASO 7: preview CPST muestra Utilizable(Oeste)=1 (formula correcta por cliente)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [
        pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)]),
        pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)]),
      ],
    });
    const r = getStockPorCliente(SKU_STRADIC, OESTE, deps, AT_NOW);
    const residual = Math.max(r.fisico - r.reservadasPorCliente - r.reservadasPorOtros, 0);
    const dispPreview = Math.min(r.fisico, r.reservadasPorCliente + residual);
    expect(dispPreview).toBe(1); // preview CPST muestra 1 ✅
  });

  // =========================================================================
  // PASO 8 — VDE Oeste confirma pedido ex-ASIG. Deberia enviar 1 a SAP.
  //         BUG: va a BO
  // =========================================================================
  it('PASO 8 (post-fix H1): VDE Oeste confirma pedido ex-ASIG → SAP recibe 1', () => {
    // Antes del fix, Sur BO + Oeste ASIG hacian que getStockRealmenteDisponible
    // devolviera 0 (ambas cuentan como reserva). El fix usa la formula por
    // cliente que descuenta solo las reservas de OTROS clientes.
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [
        pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)]),
        pedidoOpen('p-oeste', OESTE, [lineASIG(SKU_STRADIC, 1)]),
      ],
    });
    // Call-site POST-FIX de doConfirmPedido (index.html:34720).
    const getDispCallSite = (sku) =>
      Math.max(getStockUtilizableParaClienteExAsig(sku, OESTE, deps, AT_NOW), 0);
    // Para Oeste con pedido ex-ASIG:
    //   fisico=1, firmesPropias(Oeste)=1 (su ASIG), resOtros=1 (Sur BO)
    //   residual = max(1 - 1 - 1, 0) = 0
    //   disp = min(1, 1 + 0) = 1
    expect(getDispCallSite(SKU_STRADIC)).toBe(1);

    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 1000 },
      { getDisp: getDispCallSite, flagEnabled: true }
    );
    expect(lines[0].state).toBe('confirmed');
  });

  // =========================================================================
  // PASO 9 — Ingresan 2u (más de lo pedido). Fisico=2, BO Sur=1, 1u sobrante
  // =========================================================================
  it('PASO 9: fisico pasa a 2 con BO Sur=1. 1u sobrante queda libre', () => {
    const depsPost = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 2 },
      pedidos: [pedidoOpen('p-sur', SUR, [lineBO(SKU_STRADIC, 1)])],
    });
    const s = observableState(depsPost);
    expect(s.fisico).toBe(2);
    expect(s.reservado).toBe(0); // no hay ASIG firmes
    expect(s.bo).toBe(1); // Sur
    // Prompt: Disp=2 (BO no cuenta). Codigo: disp=1 (BO cuenta).
    expect(s.dispPrompt).toBe(2);
    expect(getStockRealmenteDisponible(SKU_STRADIC, depsPost, AT_NOW)).toBe(1);
  });

  // =========================================================================
  // PASO 10 — Pablo asigna 1u a Sur. Sur ASIG 1, 1u libre
  // =========================================================================
  it('PASO 10: Pablo asigna 1 a Sur → Sur ASIG 1, 1u libre en dep 11', () => {
    const depsPost = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 2 },
      pedidos: [pedidoOpen('p-sur', SUR, [lineASIG(SKU_STRADIC, 1)])],
    });
    const s = observableState(depsPost);
    expect(s.fisico).toBe(2);
    expect(s.reservado).toBe(1); // Sur ASIG
    expect(s.dispPrompt).toBe(1); // 2-1 segun prompt
    expect(getStockRealmenteDisponible(SKU_STRADIC, depsPost, AT_NOW)).toBe(1); // mismo valor en codigo
  });

  // =========================================================================
  // PASO 11 — Pablo CPST para Sur, VDE confirma, SAP recibe 1. 3 modales vacios.
  // =========================================================================
  it('PASO 11 (RED): CPST para Sur deberia enviar 1 a SAP (bug H1 lo manda a BO)', () => {
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 2 },
      pedidos: [pedidoOpen('p-sur', SUR, [lineASIG(SKU_STRADIC, 1)])],
    });
    const getDispCallSite = (sku) => Math.max(getStockRealmenteDisponible(sku, deps, AT_NOW), 0);
    // Fisico=2, ASIG Sur=1 → disp global = max(0, 2-1) = 1.
    // Para Sur: utilizable deberia ser 1 (su propia reserva).
    // Pero en el call-site: disp=1 ≥ qty=1 → va a confirmed. ✅ Este paso SI pasa!
    // Porque fisico=2 y solo 1u ASIG → sobra 1 libre.
    expect(getDispCallSite(SKU_STRADIC)).toBe(1);
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 1000 },
      { getDisp: getDispCallSite, flagEnabled: true }
    );
    expect(lines[0].state).toBe('confirmed'); // ✅ CUMPLE
    // El bug H1 solo se dispara cuando Fisico EXACTAMENTE == Reservado(propio cliente).
    // En PASO 11, fisico=2 y ASIG propia=1, hay 1u libre que absorbe el pedido.
  });

  it('PASO 11 edge-case (post-fix H1): fisico==ASIG propia → confirmed', () => {
    // Caso critico: fisico=1 y ASIG Sur=1. Pre-fix: disp global = 0 → BO.
    // Post-fix: formula por cliente devuelve 1 → confirmed.
    const deps = makeDeps({
      fisicoBySku: { [SKU_STRADIC]: 1 },
      pedidos: [pedidoOpen('p-sur', SUR, [lineASIG(SKU_STRADIC, 1)])],
    });
    const getDispCallSite = (sku) =>
      Math.max(getStockUtilizableParaClienteExAsig(sku, SUR, deps, AT_NOW), 0);
    expect(getDispCallSite(SKU_STRADIC)).toBe(1); // formula por cliente OK
    const lines = splitPedidoLine(
      { code: SKU_STRADIC, qty: 1, precio: 1000 },
      { getDisp: getDispCallSite, flagEnabled: true }
    );
    expect(lines[0].state).toBe('confirmed');
  });
});
