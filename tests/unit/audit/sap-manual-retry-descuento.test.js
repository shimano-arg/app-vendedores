/**
 * Reenvío MANUAL (enviarPedidosASAPViaServiceLayer, camino real de
 * src/domains/sap-admin-panel.js) después de un rechazo de SAP por descuento.
 * Exigencias (cierre ciclo 7):
 *  - confirmación explícita, con el % solicitado y aclarando que el descuento
 *    NO queda aplicado;
 *  - sin confirmación no se envía;
 *  - con confirmación se envía y el rechazo original se conserva
 *    (transferErrorHistory + descuentoRechazadoPrevio), aunque tenga éxito;
 *  - pedidos sin rechazo por descuento: mismo comportamiento que antes.
 * También el botón "Reintentar" (window.reintentarEnvioSap, inline de
 * index.html) que llama a esta misma función.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cfReject,
  H,
  pedido,
  resetHarness,
  setupBrowserHarness,
} from './helpers/sap-browser-harness.js';

const g = /** @type {any} */ (globalThis);
beforeAll(setupBrowserHarness);
beforeEach(resetHarness);

const send = (ids) =>
  g.enviarPedidosASAPViaServiceLayer(ids.map((id) => ({ _fsId: id, ...H.store.get(id) })));

describe('reenvío manual con rechazo previo por descuento (de la CF)', () => {
  it('pide confirmación con el % solicitado y dice que el descuento NO se aplica', async () => {
    H.store.set('M1', pedido());
    await cfReject('M1');
    H.confirmAnswer = false;
    await send(['M1']);
    expect(H.confirmCalls).toHaveLength(1);
    const txt = H.confirmCalls[0];
    expect(txt).toMatch(/SAP rechazó antes el descuento/);
    expect(txt).toMatch(/Descuento solicitado: 17 %/);
    expect(txt).toMatch(/SIN el descuento económico/);
    expect(txt).toMatch(/NO se aplica/);
    expect(txt).toMatch(/CLIENTE X \(ORDEN 777\)/);
    expect(txt).toMatch(/Motivo de SAP: Value in Discount field is greater than permitted/);
  });

  it('si el admin cancela: no se envía, queda omitido con motivo y el error intacto', async () => {
    H.store.set('M2', pedido());
    await cfReject('M2');
    H.confirmAnswer = false;
    const r = await send(['M2']);
    expect(H.createCalls).toHaveLength(0);
    expect(r.sent).toBe(0);
    expect(r.skipped[0].motivo).toMatch(/rechazado el descuento|habia rechazado el descuento/);
    expect(H.store.get('M2').transferError).toMatchObject({
      via: 'cf_auto',
      discountRejected: true,
    });
    expect(H.store.get('M2').sendingSapLock).toBeUndefined();
  });

  it('si confirma y SAP acepta: se envía, y el rechazo original se conserva en el historial', async () => {
    H.store.set('M3', pedido());
    await cfReject('M3');
    const original = { ...H.store.get('M3').transferError };
    const r = await send(['M3']);
    expect(H.createCalls).toHaveLength(1);
    expect(H.createCalls[0].DiscountPercent).toBe(0);
    expect(r.sent).toBe(1);
    const d = H.store.get('M3');
    expect(d.transferidoSAP.docNum).toBe(900001);
    expect(d.transferError).toBeUndefined();
    expect(d.transferErrorHistory).toHaveLength(1);
    expect(d.transferErrorHistory[0]).toMatchObject({
      ...original,
      resolution: 'reenvio_manual_confirmado',
      resolvedBy: 'admin@shimano.com.ar',
      pctEnviadoEnReenvio: 0,
    });
    expect(d.descuentoRechazadoPrevio).toMatchObject({
      pctSolicitado: 17,
      pctEnviado: 0,
      aplicadoEnSap: false,
      confirmadoPor: 'admin@shimano.com.ar',
    });
    // El resultado nunca lo informa como OK a secas.
    expect(r.sinDescuento).toEqual([
      { pedido: 'M3', cliente: 'CLIENTE X', pctSolicitado: 17, pctEnviado: 0 },
    ]);
  });

  it('si confirma y vuelve a fallar (otro error): el rechazo original no se pierde', async () => {
    H.store.set('M4', pedido());
    await cfReject('M4');
    H.createResult = () => ({
      ok: false,
      status: 400,
      body: { error: { code: -10, message: { value: 'Invalid BP code' } } },
      error: 'HTTP 400 - Invalid BP code',
    });
    const r = await send(['M4']);
    expect(r.failed).toBe(1);
    const d = H.store.get('M4');
    expect(d.transferError).toMatchObject({
      via: 'service_layer',
      status: 400,
      discountRejected: false,
    });
    expect(d.transferErrorHistory[0]).toMatchObject({
      via: 'cf_auto',
      discountRejected: true,
      resolution: 'reenvio_manual_fallido',
    });
  });

  it('pedido en memoria viejo (sin el rechazo) pero el doc ya lo tiene: no envía sin confirmar', async () => {
    H.store.set('M5', pedido());
    const viejo = { _fsId: 'M5', ...H.store.get('M5') };
    await cfReject('M5');
    const r = await g.enviarPedidosASAPViaServiceLayer([viejo]);
    expect(H.confirmCalls).toHaveLength(0);
    expect(H.createCalls).toHaveLength(0);
    expect(r.skipped[0].motivo).toMatch(/SAP rechazo el descuento/);
    expect(H.store.get('M5').transferError.discountRejected).toBe(true);
  });
});

describe('reenvío manual SIN rechazo por descuento: comportamiento de siempre', () => {
  it('4xx genérico de la CF: no pide confirmación, envía y no escribe historial', async () => {
    H.store.set('N1', pedido());
    await cfReject('N1', {
      status: 400,
      sapCode: '-10',
      discountRejected: false,
      msg: 'Invalid BP code',
    });
    const r = await send(['N1']);
    expect(H.confirmCalls).toHaveLength(0);
    expect(r.sent).toBe(1);
    const d = H.store.get('N1');
    expect(d.transferError).toBeUndefined();
    expect(d.transferErrorHistory).toBeUndefined();
    expect(d.descuentoRechazadoPrevio).toBeUndefined();
    expect(r.sinDescuento).toEqual([]);
  });

  it('pedido sin error previo: envía igual que antes', async () => {
    H.store.set('N2', pedido());
    const r = await send(['N2']);
    expect(H.confirmCalls).toHaveLength(0);
    expect(r.sent).toBe(1);
    expect(H.store.get('N2').transferErrorHistory).toBeUndefined();
  });

  it('un fallo manual por descuento queda marcado (discountRejected) para el próximo intento', async () => {
    H.store.set('N3', pedido());
    H.createResult = () => ({
      ok: false,
      status: 400,
      body: {
        error: {
          code: -10000724,
          message: { value: 'Value in "Discount %" field is greater than permitted' },
        },
      },
      error: 'HTTP 400 - Value in "Discount %" field is greater than permitted',
    });
    await send(['N3']);
    expect(H.store.get('N3').transferError).toMatchObject({
      via: 'service_layer',
      discountRejected: true,
    });
    H.confirmAnswer = false;
    H.createCalls = [];
    await send(['N3']);
    expect(H.confirmCalls).toHaveLength(1);
    expect(H.createCalls).toHaveLength(0);
  });
});

describe('botón "Reintentar" (window.reintentarEnvioSap, index.html)', () => {
  function loadReintentar() {
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
    const a = html.indexOf('window.reintentarEnvioSap = async function(pedidoFsId){');
    const b = html.indexOf('\nfunction renderConfirmadosList(){', a);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    // Carga la función real del inline (asigna window.reintentarEnvioSap).
    new Function(html.slice(a, b))();
  }
  it('confirmado tras rechazo por descuento: avisa que entró SIN el descuento económico', async () => {
    loadReintentar();
    H.store.set('R1', pedido());
    await cfReject('R1');
    g.globalPedidos = [{ _fsId: 'R1', ...H.store.get('R1') }];
    g.confirmed = {};
    const alerts = [];
    g.alert = (m) => alerts.push(m);
    await g.reintentarEnvioSap('R1');
    // 1) confirmación genérica del botón, 2) confirmación específica de descuento.
    expect(H.confirmCalls).toHaveLength(2);
    expect(H.confirmCalls[1]).toMatch(/NO se aplica/);
    expect(alerts.at(-1)).toMatch(/SIN el descuento economico/);
    expect(alerts.at(-1)).toMatch(/Solicitado: 17 %/);
    expect(alerts.at(-1)).toMatch(/NO quedo aplicado/);
    expect(alerts.at(-1)).not.toMatch(/^Enviado OK a SAP\.$/);
    g.alert = () => {};
  });
});
