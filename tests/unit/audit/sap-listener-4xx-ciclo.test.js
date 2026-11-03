/**
 * Ciclo completo del listener de auto-envío del navegador
 * (src/domains/sap-auto-send-listener.js) frente a rechazos de SAP.
 * Arnés: tests/unit/audit/helpers/sap-browser-harness.js (Firestore en memoria
 * con eventos por escritura, módulos reales del navegador, red simulada).
 * El lado CF se representa con la escritura exacta del patch 4xx; la CF en sí
 * está cubierta en tests/functions/auto-send-sap.test.js y en el escenario con
 * emulador.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cfReject,
  clone,
  flush,
  H,
  pedido,
  resetHarness,
  setupBrowserHarness,
  startListener,
  write,
} from './helpers/sap-browser-harness.js';

const store = {
  get: (id) => H.store.get(id),
  set: (id, v) => H.store.set(id, v),
};

beforeAll(setupBrowserHarness);
beforeEach(resetHarness);

describe('listener + rechazo 4xx de la CF (admin conectado)', () => {
  it('rechazo por descuento (10000724): no reenvía, conserva transferError', async () => {
    // La CF ganó el lock al confirmarse: el admin ve el pedido con lock vigente.
    store.set('P1', pedido({ sendingSapLock: { sessionId: 'cf', at: Date.now() } }));
    startListener();
    await flush();
    expect(H.createCalls).toHaveLength(0); // lock de la CF => skip
    await cfReject('P1');
    await flush();
    expect(H.createCalls).toHaveLength(0);
    expect(store.get('P1').transferidoSAP).toBeUndefined();
    expect(store.get('P1').transferError).toMatchObject({ via: 'cf_auto', discountRejected: true });
  });

  it('4xx genérico (400): no reenvía y no pisa el error de la CF', async () => {
    store.set('P2', pedido({ sendingSapLock: { sessionId: 'cf', at: Date.now() } }));
    startListener();
    await flush();
    await cfReject('P2', {
      status: 400,
      sapCode: '-10',
      discountRejected: false,
      msg: 'Invalid BP code',
    });
    await flush();
    expect(H.createCalls).toHaveLength(0);
    expect(store.get('P2').transferError).toMatchObject({ via: 'cf_auto', status: 400 });
  });

  it('modificaciones posteriores del pedido tampoco disparan reenvío', async () => {
    store.set('P3', pedido({ sendingSapLock: { sessionId: 'cf', at: Date.now() } }));
    startListener();
    await flush();
    await cfReject('P3');
    await flush();
    await write('P3', { observaciones: 'cambio cualquiera' });
    await write('P3', { lastExportBatchId: 'X' });
    await flush();
    expect(H.createCalls).toHaveLength(0);
    expect(store.get('P3').transferError.via).toBe('cf_auto');
  });
});

describe('listener + rechazo 4xx de la CF (admin desconectado)', () => {
  it('al conectarse el admin, el snapshot inicial no reenvía el pedido rechazado', async () => {
    store.set('P4', pedido());
    await cfReject('P4'); // sin listener activo: solo queda escrito
    startListener();
    await flush();
    expect(H.createCalls).toHaveLength(0);
    expect(store.get('P4').transferError.via).toBe('cf_auto');
  });
});

describe('sin regresiones', () => {
  it('pedido confirmado sin error: el listener lo envía (DiscountPercent 0, descuento en Comments)', async () => {
    store.set('P5', pedido());
    startListener();
    await flush();
    expect(H.createCalls).toHaveLength(1);
    expect(H.createCalls[0].DiscountPercent).toBe(0);
    expect(H.createCalls[0].Comments).toMatch(/DESCUENTO SOLICITADO: 17%/);
    expect(store.get('P5').transferidoSAP.docNum).toBe(900001);
  });

  it('error ambiguo 5xx de la CF (needsManualVerification, lock vigente): skip por lock, como hoy', async () => {
    store.set(
      'P6',
      pedido({
        sendingSapLock: { sessionId: 'cf', at: Date.now() },
        transferError: {
          message: 'sl_5xx_502',
          via: 'cf_auto',
          status: 502,
          needsManualVerification: true,
        },
      })
    );
    startListener();
    await flush();
    expect(H.createCalls).toHaveLength(0);
  });

  it('error ambiguo 5xx con lock vencido: el listener reintenta (comportamiento actual)', async () => {
    store.set(
      'P7',
      pedido({
        sendingSapLock: { sessionId: 'cf', at: Date.now() - 20 * 60 * 1000 },
        transferError: {
          message: 'sl_5xx_502',
          via: 'cf_auto',
          status: 502,
          needsManualVerification: true,
        },
      })
    );
    startListener();
    await flush();
    expect(H.createCalls).toHaveLength(1);
  });

  it('fallo 4xx del propio navegador: guarda su error y no entra en loop con su propia escritura', async () => {
    H.createResult = () => ({ ok: false, error: 'Invalid BP code' });
    store.set('P8', pedido());
    startListener();
    await flush();
    expect(H.createCalls).toHaveLength(1);
    expect(store.get('P8').transferError).toMatchObject({ via: 'service_layer_auto' });
  });

  it('error de la CF con 429 (transitorio): el listener sí reintenta', async () => {
    store.set('P9', pedido());
    await cfReject('P9', {
      status: 429,
      sapCode: null,
      discountRejected: false,
      msg: 'Too many requests',
    });
    startListener();
    await flush();
    expect(H.createCalls).toHaveLength(1);
  });
});

describe('carrera: el snapshot llega viejo pero el pedido ya tiene el rechazo', () => {
  it('la transacción relee el doc y no envía (CF_REJECTED_4XX)', async () => {
    store.set('R1', pedido());
    await cfReject('R1');
    startListener();
    await flush(2); // deja pasar el snapshot inicial (ya protegido) ...
    H.createCalls = [];
    // ... y simula un evento con datos viejos (sin transferError).
    const viejo = pedido();
    for (const cb of H.subs)
      cb({ docChanges: () => [{ type: 'modified', doc: { id: 'R1', data: () => clone(viejo) } }] });
    await flush();
    expect(H.createCalls).toHaveLength(0);
    expect(store.get('R1').transferError.via).toBe('cf_auto');
  });
});

describe('rechazo por descuento generado por el propio navegador', () => {
  it('el listener guarda discountRejected y no vuelve a enviar ante cambios posteriores', async () => {
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
    store.set('B1', pedido());
    startListener();
    await flush();
    expect(H.createCalls).toHaveLength(1);
    expect(store.get('B1').transferError).toMatchObject({
      via: 'service_layer_auto',
      status: 400,
      sapCode: '-10000724',
      discountRejected: true,
    });
    H.createResult = () => ({ ok: true, status: 201, body: { DocNum: 1, DocEntry: 1 } });
    await write('B1', { observaciones: 'otro cambio' });
    await flush();
    expect(H.createCalls).toHaveLength(1);
    expect(store.get('B1').transferidoSAP).toBeUndefined();
  });
});
