// @ts-nocheck
/**
 * SEC-05 (2026-10-29) — sq-cancel-core con la FORMA REAL de respuesta.
 *
 * En producción `slFetch` envuelve sapGet/sapPost y devuelve `{status, body}`
 * (functions/core/sap-sl-client.js:99,127; functions/index.js closeSqsManuallyCF
 * y sqCancelExpiredCF). Los tests previos (sq-cancel.test.js) mockean la forma
 * cruda `{value}`, por eso no detectaban que la cancelación nunca ocurría.
 * Datos ficticios; sin SAP real.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  cancelSqInSap,
  runSqCancelManualBulk,
  slBody,
  verifySqCanBeCancelled,
} from '../../functions/core/sq-cancel-core.js';

const ok = (body, status = 200) => ({ status, body });

describe('SEC-05 — slBody', () => {
  it('W1: forma wrapper 2xx → body', () => {
    expect(slBody(ok({ value: [1] }), 'x')).toEqual({ value: [1] });
    expect(slBody({ status: 204, body: null }, 'x')).toBeNull();
  });
  it('W2: forma wrapper no-2xx → lanza con el status y el mensaje de SL', () => {
    expect(() =>
      slBody({ status: 400, body: { error: { message: { value: 'no se puede' } } } }, 'POST Cancel')
    ).toThrow(/POST Cancel: HTTP 400 - no se puede/);
  });
  it('W3: forma cruda (compatibilidad) → se devuelve tal cual', () => {
    expect(slBody({ value: [] }, 'x')).toEqual({ value: [] });
  });
});

describe('SEC-05 — verify / cancel con respuestas {status, body}', () => {
  it('V1: SQ abierta sin documentos derivados → canCancel (antes: "SQ no encontrada")', async () => {
    const slFetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          value: [
            { DocEntry: 100, DocNum: 2000100, DocumentStatus: 'bost_Open', Cancelled: 'tNO' },
          ],
        })
      )
      .mockResolvedValueOnce(ok({ DocumentLines: [{ TargetType: -1 }] }));
    const r = await verifySqCanBeCancelled({ slFetch }, '2000100');
    expect(r).toEqual({ canCancel: true, reason: '' });
  });

  it('V2: SQ con Order derivada (TargetType 17) → no se cancela', async () => {
    const slFetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ value: [{ DocEntry: 100, DocumentStatus: 'bost_Open', Cancelled: 'tNO' }] })
      )
      .mockResolvedValueOnce(ok({ DocumentLines: [{ TargetType: 17 }] }));
    const r = await verifySqCanBeCancelled({ slFetch }, '2000100');
    expect(r.canCancel).toBe(false);
  });

  it('V3: GET header con 500 → no se cancela (falla cerrada)', async () => {
    const slFetch = vi.fn().mockResolvedValueOnce({ status: 500, body: {} });
    const r = await verifySqCanBeCancelled({ slFetch }, '2000100');
    expect(r.canCancel).toBe(false);
    expect(r.reason).toMatch(/HTTP 500/);
  });

  it('C1: GET DocEntry 200 + POST Cancel 204 → ok', async () => {
    const slFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ value: [{ DocEntry: 555 }] }))
      .mockResolvedValueOnce({ status: 204, body: null });
    const r = await cancelSqInSap({ slFetch }, '2000100');
    expect(r).toEqual({ ok: true });
    expect(slFetch).toHaveBeenLastCalledWith('/b1s/v1/Quotations(555)/Cancel', { method: 'POST' });
  });

  it('C2: POST Cancel con 400 → ok:false (antes: ok:true sin mirar el status)', async () => {
    const slFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ value: [{ DocEntry: 555 }] }))
      .mockResolvedValueOnce({
        status: 400,
        body: { error: { message: { value: 'Document is closed' } } },
      });
    const r = await cancelSqInSap({ slFetch }, '2000100');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 400/);
  });
});

describe('SEC-05 — bulk manual: un Cancel fallido NO marca líneas canceladas', () => {
  function makeDb(pedido) {
    const store = { pedido: { ...pedido }, logs: [] };
    const ref = {
      async get() {
        return { exists: true, data: () => store.pedido };
      },
    };
    return {
      _store: store,
      collection(name) {
        if (name === 'pedidos') return { doc: () => ref };
        return {
          doc: () => ({
            async set(d) {
              store.logs.push(d);
            },
          }),
        };
      },
      async runTransaction(fn) {
        return fn({
          get: (r) => r.get(),
          update: (_r, patch) => {
            store.pedido = { ...store.pedido, ...patch };
          },
        });
      },
    };
  }
  const pedido = {
    transferidoSAP: { docNum: 2000100 },
    closedAt: null,
    confirmedAt: '2026-10-01T00:00:00.000Z',
    lines: [{ code: 'SKU-A', qty: 2, qtyOpen: 2, state: 'confirmed' }],
  };

  it('B1: verify OK + Cancel 400 → error registrado, línea sigue confirmed', async () => {
    const fbDb = makeDb(pedido);
    const slFetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ value: [{ DocEntry: 100, DocumentStatus: 'bost_Open', Cancelled: 'tNO' }] })
      )
      .mockResolvedValueOnce(ok({ DocumentLines: [] }))
      .mockResolvedValueOnce(ok({ value: [{ DocEntry: 100 }] }))
      .mockResolvedValueOnce({ status: 400, body: {} });
    const r = await runSqCancelManualBulk({ fbDb, slFetch }, ['p1'], 'admin@test.invalid');
    expect(r.cancelledCount).toBe(0);
    expect(r.errors.join(' ')).toMatch(/HTTP 400/);
    expect(fbDb._store.pedido.lines[0].state).toBe('confirmed');
  });

  it('B2: verify OK + Cancel 204 → línea cancelada', async () => {
    const fbDb = makeDb(pedido);
    const slFetch = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ value: [{ DocEntry: 100, DocumentStatus: 'bost_Open', Cancelled: 'tNO' }] })
      )
      .mockResolvedValueOnce(ok({ DocumentLines: [] }))
      .mockResolvedValueOnce(ok({ value: [{ DocEntry: 100 }] }))
      .mockResolvedValueOnce({ status: 204, body: null });
    const r = await runSqCancelManualBulk({ fbDb, slFetch }, ['p1'], 'admin@test.invalid');
    expect(r.cancelledCount).toBe(1);
    expect(fbDb._store.pedido.lines[0].state).toBe('cancelled');
  });
});
