// v1547 (2026-11-03): "Pasar a Pendientes" no puede fallar en silencio.
// doConfirmPedido es async y sus llamadores no hacen await: una excepción
// después del confirm() quedaba como promesa rechazada sin manejar y el
// vendedor veía "no pasa nada". Ahora un envoltorio la atrapa, avisa y registra.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  getMensajeParaErrorCode,
  PALABRAS_PROHIBIDAS,
} from '../../../src/pure/mensajes-vendedor.js';

const HTML = readFileSync('index.html', 'utf8');

function extraerEnvoltorio() {
  const ini = HTML.indexOf('window.doConfirmPedido = async function(){\n  try {');
  const fin = HTML.indexOf('window._doConfirmPedidoImpl = async function(){');
  expect(ini, 'envoltorio no encontrado').toBeGreaterThan(0);
  expect(fin).toBeGreaterThan(ini);
  return HTML.slice(ini, fin);
}

function correr(impl) {
  const alerts = [];
  const logs = [];
  const ctx = {
    alert: (m) => alerts.push(m),
    console: { error() {}, warn() {} },
    currentUser: { uid: 'u1', email: 'v@x' },
    currentOrderClient: { name: 'LOS FERRETIS S. R. L.' },
    currentOrderKey: 'C|BUENOS AIRES|VIEDMA|LOS FERRETIS S. R. L.',
    fbDb: {
      collection: () => ({
        add: (d) => {
          logs.push(d);
          return Promise.resolve();
        },
      }),
    },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
  };
  ctx.window = ctx;
  ctx.window._doConfirmPedidoImpl = impl;
  ctx.window._pendingPedidoWaitlistId = 'wl-610';
  ctx.window._pendingPedidoOrderNumber = 610;
  ctx.window.APP_VERSION = 'v1547';
  vm.runInNewContext(extraerEnvoltorio(), ctx);
  return { ctx, alerts, logs };
}

describe('v1547 — doConfirmPedido nunca falla en silencio', () => {
  it('una excepción dentro del flujo muestra cartel y registra en operations_log', async () => {
    const { ctx, alerts, logs } = correr(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'qty')");
    });
    const r = await ctx.window.doConfirmPedido();
    expect(r).toBeUndefined();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/No pudimos pasar el pedido a Pendientes/);
    expect(alerts[0]).toMatch(/Código técnico: CONFIRM_EXCEPTION · Cannot read properties/);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      type: 'client_confirm_exception',
      userUid: 'u1',
      clientName: 'LOS FERRETIS S. R. L.',
      waitlistOrigenId: 'wl-610',
      orderNumber: 610,
    });
  });

  it('sin excepción no muestra cartel y devuelve lo mismo que el flujo', async () => {
    const { ctx, alerts, logs } = correr(async () => 'ok');
    expect(await ctx.window.doConfirmPedido()).toBe('ok');
    expect(alerts).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it('la llamada a commitPedidoCF muestra un aviso de espera y lo oculta al terminar', () => {
    expect(HTML).toMatch(/showSyncTag\('Confirmando el pedido, esperá unos segundos…', 90000\)/);
    expect(HTML).toMatch(
      /_commitCfResult = await \(window\._tryCommitPedidoCF[\s\S]{0,200}\} finally \{[\s\S]{0,200}classList\.remove\('show'\)/
    );
  });

  it('el mensaje CONFIRM_EXCEPTION sigue la regla §68 (sin jerga)', () => {
    const t = getMensajeParaErrorCode('CONFIRM_EXCEPTION').texto;
    expect(t).toMatch(/Pendientes/);
    for (const p of PALABRAS_PROHIBIDAS) {
      expect(t.toLowerCase().includes(String(p).toLowerCase()), p).toBe(false);
    }
  });

  it('versión >= v1547 en sync con el SW', () => {
    const m = HTML.match(/const APP_VERSION = 'v(\d+)'/);
    expect(Number(m[1])).toBeGreaterThanOrEqual(1547);
    expect(readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/)[1]).toBe(m[1]);
  });
});
