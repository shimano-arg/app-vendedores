// @ts-check
// Auditoría 2026-11-25: mensajes del cliente para los rechazos por alcance del
// vendedor interno (INTERNO_FUERA_DE_PAREJA / INTERNO_SOLO_PEDIDO_PROPIO).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatServerErrorAlert } from '../../../src/pure/mensajes-vendedor.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (/** @type {string} */ p) => readFileSync(resolve(ROOT, p), 'utf8');

describe('rechazos por alcance del interno — cliente', () => {
  it('formatServerErrorAlert arma el mensaje desde details.errorCode', () => {
    const t = formatServerErrorAlert({
      code: 'functions/permission-denied',
      details: { errorCode: 'INTERNO_FUERA_DE_PAREJA' },
    });
    expect(t).toContain('Este pedido es de otro vendedor y no lo podés modificar.');
    expect(t).toContain('Código técnico: INTERNO_FUERA_DE_PAREJA');
    // updatePedidoLinesCF devuelve el código en la raíz del resultado.
    expect(formatServerErrorAlert({ errorCode: 'INTERNO_SOLO_PEDIDO_PROPIO' })).toContain(
      'Solo podés pasar a espera pedidos que cargaste vos.'
    );
  });

  it('el catch de updateAsigLineStateCF usa el mensaje del servidor', () => {
    const html = read('index.html');
    expect(html).toContain(
      "alert(_srvMsgE4B || ('Error ejecutando ' + actionLabel + ': ' + (e.message || e)));"
    );
  });

  it('el wrapper de updateAsigLineStateCF propaga solo details.errorCode', () => {
    const src = read('functions/index.js');
    expect(src).toContain('{ errorCode: err.details.errorCode }');
  });
});

describe('borrado directo de orden en espera sin permiso (rules 2026-11-25)', () => {
  it('index.html usa el mensaje propio en los 3 borrados directos', () => {
    const html = read('index.html');
    expect(html).toContain('window._waitlistDeleteErrorText = function(e)');
    const n = (html.match(/window\._waitlistDeleteErrorText\(e\)/g) || []).length;
    expect(n).toBe(3);
    expect(html).toContain('Código técnico: WAITLIST_BORRAR_SOLO_PROPIA');
  });

  it('el mensaje existe y no tiene jerga', async () => {
    const mv = await import('../../../src/pure/mensajes-vendedor.js');
    const t = mv.MENSAJES_VENDEDOR.WAITLIST_BORRAR_SOLO_PROPIA.texto;
    expect(t).toContain('Solo podés borrar órdenes en espera que cargaste vos.');
    for (const p of mv.PALABRAS_PROHIBIDAS) expect(t).not.toContain(p);
  });
});
