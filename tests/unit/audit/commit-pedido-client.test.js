// @ts-check
/**
 * v1432 §stock-servidor-atomico — tests para src/pure/commit-pedido-client.js.
 *
 * Reglas:
 * 1) aborted/functions/aborted → retry 3× backoff → CONTENTION_RETRY_EXHAUSTED.
 *    NUNCA fallback (deps.logFallback con motivo network no se llama).
 * 2) Antes de fallback (unavailable/deadline-exceeded/cancelled/not-found/red):
 *    deps.queryByDraftId → si docs no vacío, post-hoc recovery.
 * 3) Errores de negocio → errorCode mapeado.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ABORTED_BACKOFFS_MS,
  ABORTED_CODES,
  deriveLinesFromExistingPedido,
  NETWORK_CODES,
  tryCommitPedidoClient,
} from '../../../src/pure/commit-pedido-client.js';

const basePayload = {
  draftId: 'draft_v1432_test',
  cardCode: 'C001',
  origen: 'manual',
  lines: [{ sku: 'SKU-A', cantidad: 2 }],
  clientVersion: 'v1432',
  docDataForLog: { clientCardCode: 'C001', clientName: 'TEST', lines: [{ code: 'SKU-A' }] },
};

function makeDepsErr(code) {
  const err = Object.assign(new Error('mock ' + code), { code });
  return {
    callInvoke: vi.fn(async () => {
      throw err;
    }),
    queryByDraftId: vi.fn(async () => ({ empty: true, docs: [] })),
    logFallback: vi.fn(async () => {}),
    sleep: () => Promise.resolve(), // skip backoff en tests
  };
}

describe('v1432 aborted retry', () => {
  it('functions/aborted 3× → CONTENTION_RETRY_EXHAUSTED, callInvoke 4×, 0 logFallback', async () => {
    const deps = makeDepsErr('functions/aborted');
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('CONTENTION_RETRY_EXHAUSTED');
    expect(r._rawCode).toBe('functions/aborted');
    // 1 initial + 3 reintentos.
    expect(deps.callInvoke).toHaveBeenCalledTimes(4);
    // Fallback nunca disparó → logFallback con motivo network/post_hoc = 0.
    expect(deps.logFallback).toHaveBeenCalledTimes(0);
    // queryByDraftId nunca invocado (no es rama red).
    expect(deps.queryByDraftId).toHaveBeenCalledTimes(0);
  });

  it('aborted (sin prefix) también retriable', async () => {
    const deps = makeDepsErr('aborted');
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.errorCode).toBe('CONTENTION_RETRY_EXHAUSTED');
    expect(deps.callInvoke).toHaveBeenCalledTimes(4);
    expect(deps.logFallback).toHaveBeenCalledTimes(0);
  });

  it('aborted 1× + ok 2do → ok sin exhausted', async () => {
    let callCount = 0;
    const deps = {
      callInvoke: vi.fn(async () => {
        callCount++;
        if (callCount === 1)
          throw Object.assign(new Error('aborted'), { code: 'functions/aborted' });
        return { ok: true, pedidoId: 'ped_retry_ok', lines: [], diffVsClient: null };
      }),
      queryByDraftId: vi.fn(async () => ({ empty: true, docs: [] })),
      logFallback: vi.fn(async () => {}),
      sleep: () => Promise.resolve(),
    };
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBe('ped_retry_ok');
    expect(deps.callInvoke).toHaveBeenCalledTimes(2);
    expect(deps.logFallback).toHaveBeenCalledTimes(0);
  });
});

describe('v1432 idempotency check pre-fallback', () => {
  it('deadline-exceeded + pedido existe → idempotentHit, 0 fallback', async () => {
    const deps = {
      callInvoke: vi.fn(async () => {
        throw Object.assign(new Error('deadline'), { code: 'functions/deadline-exceeded' });
      }),
      queryByDraftId: vi.fn(async () => ({
        empty: false,
        docs: [
          {
            id: 'ped_recovered',
            data: () => ({
              _draftId: 'draft_v1432_test',
              lines: [{ code: 'SKU-A', state: 'confirmed', qty: 2 }],
            }),
          },
        ],
      })),
      logFallback: vi.fn(async () => {}),
      sleep: () => Promise.resolve(),
    };
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBe('ped_recovered');
    expect(r.idempotentHit).toBe(true);
    expect(r._postHocRecovery).toBe(true);
    expect(r.lines[0]).toEqual({
      sku: 'SKU-A',
      qtyConfirmed: 2,
      qtyBO: 0,
      reason: 'post_hoc_recovery',
    });
    // Log con motivo 'post_hoc_recovery'.
    expect(deps.logFallback).toHaveBeenCalledTimes(1);
    const logArg = deps.logFallback.mock.calls[0][0];
    expect(logArg.motivo).toBe('post_hoc_recovery');
    expect(logArg.firebaseCode).toBe('functions/deadline-exceeded');
    expect(logArg.draftId).toBe('draft_v1432_test');
  });

  it('deadline-exceeded + pedido NO existe → null (fallback) + log network_or_cf_down', async () => {
    const deps = {
      callInvoke: vi.fn(async () => {
        throw Object.assign(new Error('deadline'), { code: 'functions/deadline-exceeded' });
      }),
      queryByDraftId: vi.fn(async () => ({ empty: true, docs: [] })),
      logFallback: vi.fn(async () => {}),
      sleep: () => Promise.resolve(),
    };
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r).toBeNull();
    expect(deps.logFallback).toHaveBeenCalledTimes(1);
    expect(deps.logFallback.mock.calls[0][0].motivo).toBe('network_or_cf_down');
    expect(deps.logFallback.mock.calls[0][0].firebaseCode).toBe('functions/deadline-exceeded');
  });

  it('unavailable + no existe → null fallback', async () => {
    const deps = {
      callInvoke: vi.fn(async () => {
        throw Object.assign(new Error('unavailable'), { code: 'functions/unavailable' });
      }),
      queryByDraftId: vi.fn(async () => ({ empty: true, docs: [] })),
      logFallback: vi.fn(async () => {}),
      sleep: () => Promise.resolve(),
    };
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r).toBeNull();
    expect(deps.logFallback).toHaveBeenCalledTimes(1);
  });

  it('not-found + existe → recovery', async () => {
    const deps = {
      callInvoke: vi.fn(async () => {
        throw Object.assign(new Error('not-found'), { code: 'functions/not-found' });
      }),
      queryByDraftId: vi.fn(async () => ({
        empty: false,
        docs: [{ id: 'ped_x', data: () => ({ lines: [{ code: 'X', state: 'BO', qty: 3 }] }) }],
      })),
      logFallback: vi.fn(async () => {}),
      sleep: () => Promise.resolve(),
    };
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.ok).toBe(true);
    expect(r.idempotentHit).toBe(true);
    expect(r.lines[0]).toEqual({
      sku: 'X',
      qtyConfirmed: 0,
      qtyBO: 3,
      reason: 'post_hoc_recovery',
    });
  });

  it('mensaje con /network/ sin code → fallback con idempotency check', async () => {
    const deps = {
      callInvoke: vi.fn(async () => {
        throw new Error('network timeout fetch failed');
      }),
      queryByDraftId: vi.fn(async () => ({ empty: true, docs: [] })),
      logFallback: vi.fn(async () => {}),
      sleep: () => Promise.resolve(),
    };
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r).toBeNull();
    expect(deps.queryByDraftId).toHaveBeenCalledTimes(1);
  });
});

describe('v1432 errores de negocio NO fallback', () => {
  it('functions/unauthenticated → PERMISSION_DENIED', async () => {
    const deps = makeDepsErr('functions/unauthenticated');
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PERMISSION_DENIED');
    expect(deps.queryByDraftId).toHaveBeenCalledTimes(0);
    expect(deps.logFallback).toHaveBeenCalledTimes(0);
  });

  it('functions/permission-denied → PERMISSION_DENIED', async () => {
    const deps = makeDepsErr('functions/permission-denied');
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.errorCode).toBe('PERMISSION_DENIED');
  });

  it('functions/invalid-argument → VALIDATION_ERROR', async () => {
    const deps = makeDepsErr('functions/invalid-argument');
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.errorCode).toBe('VALIDATION_ERROR');
  });

  it('functions/internal → INTERNAL', async () => {
    const deps = makeDepsErr('functions/internal');
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.errorCode).toBe('INTERNAL');
  });

  it('code desconocido → INTERNAL', async () => {
    const deps = makeDepsErr('functions/unknown-code');
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.errorCode).toBe('INTERNAL');
  });
});

describe('v1432 happy path sin errores', () => {
  it('call directo OK → return response as-is', async () => {
    const deps = {
      callInvoke: vi.fn(async () => ({
        ok: true,
        pedidoId: 'ped_happy',
        lines: [],
        diffVsClient: null,
      })),
      queryByDraftId: vi.fn(async () => ({ empty: true, docs: [] })),
      logFallback: vi.fn(async () => {}),
      sleep: () => Promise.resolve(),
    };
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.ok).toBe(true);
    expect(r.pedidoId).toBe('ped_happy');
    expect(deps.callInvoke).toHaveBeenCalledTimes(1);
    expect(deps.queryByDraftId).toHaveBeenCalledTimes(0);
    expect(deps.logFallback).toHaveBeenCalledTimes(0);
  });

  it('CF responde ok:false con errorCode → pass through sin fallback', async () => {
    const deps = {
      callInvoke: vi.fn(async () => ({
        ok: false,
        errorCode: 'STOCK_CHANGED',
        data: { diff: [] },
      })),
      queryByDraftId: vi.fn(async () => ({ empty: true, docs: [] })),
      logFallback: vi.fn(async () => {}),
      sleep: () => Promise.resolve(),
    };
    const r = await tryCommitPedidoClient(basePayload, deps);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('STOCK_CHANGED');
    expect(deps.logFallback).toHaveBeenCalledTimes(0);
  });
});

describe('v1432 constants', () => {
  it('ABORTED_CODES = {functions/aborted, aborted}', () => {
    expect(ABORTED_CODES.has('functions/aborted')).toBe(true);
    expect(ABORTED_CODES.has('aborted')).toBe(true);
    expect(ABORTED_CODES.size).toBe(2);
  });

  it('NETWORK_CODES NO incluye aborted', () => {
    expect(NETWORK_CODES.has('functions/aborted')).toBe(false);
    expect(NETWORK_CODES.has('aborted')).toBe(false);
  });

  it('ABORTED_BACKOFFS_MS = [100, 300, 900]', () => {
    expect(ABORTED_BACKOFFS_MS).toEqual([100, 300, 900]);
  });
});

describe('v1432 deriveLinesFromExistingPedido', () => {
  it('consolida qtyConfirmed + qtyBO por SKU', () => {
    const data = {
      lines: [
        { code: 'A', state: 'confirmed', qty: 3 },
        { code: 'A', state: 'BO', qty: 2 },
        { code: 'B', state: 'ASIG', qty: 1 },
        { code: 'C', state: 'cancelled', qty: 5 }, // ignorado
      ],
    };
    const r = deriveLinesFromExistingPedido(data);
    const a = r.find((l) => l.sku === 'A');
    const b = r.find((l) => l.sku === 'B');
    expect(a).toEqual({ sku: 'A', qtyConfirmed: 3, qtyBO: 2, reason: 'post_hoc_recovery' });
    expect(b).toEqual({ sku: 'B', qtyConfirmed: 1, qtyBO: 0, reason: 'post_hoc_recovery' });
    expect(r.find((l) => l.sku === 'C')).toBeUndefined();
  });
});
