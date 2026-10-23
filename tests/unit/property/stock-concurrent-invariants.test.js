// @ts-check
/**
 * E11 §stock-servidor-atomico — Property-based tests concurrencia.
 *
 * Para cada combinación aleatoria de operaciones concurrentes (commitPedidoCF
 * N veces sobre mismo SKU + aborted retries), verifica invariantes R1-R10:
 * - sum(reservadasTotal post-ops) <= fisicoDep11.
 * - count(pedidos con mismo draftId) <= 1 (idempotencia).
 * - aborted retry nunca duplica (cliente retry no gatilla pedidos.add directo).
 */
import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  ABORTED_CODES,
  NETWORK_CODES,
  tryCommitPedidoClient,
} from '../../../src/pure/commit-pedido-client.js';

/**
 * Simula un backend concurrente que mantiene estado de pedidos y stock.
 */
function makeMockBackend(initialStock) {
  const pedidos = new Map();
  let stockFisico = initialStock;
  let currentContention = 0;

  async function invokeCommit(payload) {
    // Simula posible conflicto. Si currentContention > 0, throw aborted.
    if (currentContention > 0) {
      currentContention--;
      const err = new Error('aborted mock');
      err.code = 'functions/aborted';
      throw err;
    }
    // Idempotencia: si existe con mismo draftId, devolver.
    if (pedidos.has(payload.draftId)) {
      const existing = pedidos.get(payload.draftId);
      return { ok: true, pedidoId: existing.id, idempotentHit: true, lines: existing.lines };
    }
    // Calcular confirmed vs BO según stock disponible.
    const linesResult = [];
    let totalReserved = 0;
    for (const l of payload.lines) {
      const cantidad = Number(l.cantidad) || 0;
      const utilizable = Math.max(0, stockFisico - totalReserved);
      const qConfirmed = Math.min(cantidad, utilizable);
      const qBO = cantidad - qConfirmed;
      linesResult.push({ sku: l.sku, qtyConfirmed: qConfirmed, qtyBO: qBO });
      totalReserved += qConfirmed;
    }
    const pedidoId = 'ped_' + payload.draftId;
    pedidos.set(payload.draftId, { id: pedidoId, lines: linesResult });
    stockFisico -= totalReserved; // consumir físico
    return { ok: true, pedidoId, lines: linesResult };
  }

  async function queryByDraftId(draftId) {
    const existing = pedidos.get(draftId);
    if (!existing) return { empty: true, docs: [] };
    return {
      empty: false,
      docs: [{ id: existing.id, data: () => ({ _draftId: draftId, lines: existing.lines }) }],
    };
  }

  function setContention(n) {
    currentContention = n;
  }

  return {
    invokeCommit,
    queryByDraftId,
    setContention,
    getStockRemaining: () => stockFisico,
    getPedidosCount: () => pedidos.size,
    getPedidos: () => Array.from(pedidos.values()),
  };
}

describe('E11 Property-based concurrency', () => {
  it('invariante: sum(qtyConfirmed) <= stockFisicoInicial (nunca sobre-vende)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }), // stockFisicoInicial
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 10 }), // commits aleatorios
        async (stockInicial, commits) => {
          const backend = makeMockBackend(stockInicial);
          const results = [];
          for (let i = 0; i < commits.length; i++) {
            const r = await tryCommitPedidoClient(
              {
                draftId: 'draft_' + i,
                cardCode: 'C' + i,
                origen: 'manual',
                lines: [{ sku: 'SKU-A', cantidad: commits[i] }],
                clientVersion: 'v1433',
                docDataForLog: { lines: [{ code: 'SKU-A' }] },
              },
              {
                callInvoke: () =>
                  backend.invokeCommit({
                    draftId: 'draft_' + i,
                    lines: [{ sku: 'SKU-A', cantidad: commits[i] }],
                  }),
                queryByDraftId: backend.queryByDraftId,
                logFallback: async () => {},
                sleep: () => Promise.resolve(),
              }
            );
            results.push(r);
          }
          // Invariante: sum(qtyConfirmed) <= stockInicial.
          let totalConfirmed = 0;
          for (const r of results) {
            if (r && r.ok && r.lines) {
              for (const l of r.lines) {
                totalConfirmed += l.qtyConfirmed || 0;
              }
            }
          }
          return totalConfirmed <= stockInicial;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('invariante: count(pedidos con mismo draftId) <= 1 (idempotencia)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (retriesCount) => {
        const backend = makeMockBackend(100);
        const results = [];
        // Mismo draftId N veces (simulando retry por aborted/network).
        for (let i = 0; i < retriesCount; i++) {
          const r = await tryCommitPedidoClient(
            {
              draftId: 'draft_shared',
              cardCode: 'C001',
              origen: 'manual',
              lines: [{ sku: 'SKU-A', cantidad: 3 }],
              clientVersion: 'v1433',
              docDataForLog: { lines: [{ code: 'SKU-A' }] },
            },
            {
              callInvoke: () =>
                backend.invokeCommit({
                  draftId: 'draft_shared',
                  lines: [{ sku: 'SKU-A', cantidad: 3 }],
                }),
              queryByDraftId: backend.queryByDraftId,
              logFallback: async () => {},
              sleep: () => Promise.resolve(),
            }
          );
          results.push(r);
        }
        // Todos los pedidos deben tener el mismo pedidoId.
        const uniquePedidoIds = new Set(results.filter((r) => r && r.ok).map((r) => r.pedidoId));
        return uniquePedidoIds.size === 1;
      }),
      { numRuns: 50 }
    );
  });

  it('invariante: aborted retry nunca duplica pedido', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }), // contention count
        async (contention) => {
          const backend = makeMockBackend(10);
          backend.setContention(contention);
          const r = await tryCommitPedidoClient(
            {
              draftId: 'draft_contention',
              cardCode: 'C001',
              origen: 'manual',
              lines: [{ sku: 'SKU-A', cantidad: 2 }],
              clientVersion: 'v1433',
              docDataForLog: { lines: [{ code: 'SKU-A' }] },
            },
            {
              callInvoke: () =>
                backend.invokeCommit({
                  draftId: 'draft_contention',
                  lines: [{ sku: 'SKU-A', cantidad: 2 }],
                }),
              queryByDraftId: backend.queryByDraftId,
              logFallback: async () => {},
              sleep: () => Promise.resolve(),
            }
          );
          // Si contention <= 3, el retry debería converger a ok.
          // Si contention > 3, debe ser CONTENTION_RETRY_EXHAUSTED.
          const pedidosCount = backend.getPedidosCount();
          if (contention <= 3) {
            // Debería haber EXACTAMENTE 1 pedido.
            return r && r.ok === true && pedidosCount === 1;
          }
          // No alcanzó: 0 pedidos, exhausted.
          return (
            r &&
            r.ok === false &&
            r.errorCode === 'CONTENTION_RETRY_EXHAUSTED' &&
            pedidosCount === 0
          );
        }
      ),
      { numRuns: 50 }
    );
  });

  it('invariante: aborted exhausted → 0 pedidos creados (nunca fallback)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 4, max: 10 }), // contention > retries
        async (contention) => {
          const backend = makeMockBackend(10);
          backend.setContention(contention);
          const r = await tryCommitPedidoClient(
            {
              draftId: 'draft_exhaust',
              cardCode: 'C001',
              origen: 'manual',
              lines: [{ sku: 'SKU-A', cantidad: 1 }],
              clientVersion: 'v1433',
              docDataForLog: { lines: [{ code: 'SKU-A' }] },
            },
            {
              callInvoke: () => backend.invokeCommit({ draftId: 'draft_exhaust', lines: [] }),
              queryByDraftId: backend.queryByDraftId,
              logFallback: async () => {},
              sleep: () => Promise.resolve(),
            }
          );
          return (
            r.ok === false &&
            r.errorCode === 'CONTENTION_RETRY_EXHAUSTED' &&
            backend.getPedidosCount() === 0
          );
        }
      ),
      { numRuns: 30 }
    );
  });
});
