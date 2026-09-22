import { describe, expect, it, vi } from 'vitest';
import { handleResendPlannerEmail } from '../../functions/core/planner-resend-email-core.js';

// v1005 (2026-09-22): unit tests for callable resendPlannerEmail core.
// Pure logic: no firebase-admin, no emulator needed. All deps injected.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps({ pedidoData = {}, stageHandler = vi.fn(async () => ({ sent: { to: 'x', column: 'oferta' } })) } = {}) {
  const updateMock = vi.fn(async () => {});
  return {
    db: {
      doc: (path) => ({
        get: async () => ({
          exists: !!pedidoData,
          id: path.split('/').pop(),
          data: () => pedidoData,
          ref: { update: updateMock },
        }),
      }),
    },
    stageHandler,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    _updateMock: updateMock,
  };
}

function marianoAuth(email = 'erbinomariano@gmail.com') {
  return { uid: 'uid-mariano', token: { email } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleResendPlannerEmail', () => {
  // Case 1: unauthenticated → throws {code:'unauthenticated'}
  it('case 1: auth=null → throws {code:"unauthenticated"}', async () => {
    const deps = makeDeps();
    await expect(
      handleResendPlannerEmail({ pedidoId: 'p1', column: 'oferta' }, null, deps)
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  // Case 2: non-Mariano caller → throws {code:'permission-denied'}
  it('case 2: non-Mariano email → throws {code:"permission-denied"}', async () => {
    const auth = { uid: 'uid-other', token: { email: 'other@x.com' } };
    const deps = makeDeps();
    await expect(
      handleResendPlannerEmail({ pedidoId: 'p1', column: 'oferta' }, auth, deps)
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  // Case 3: invalid column → throws {code:'invalid-argument'}
  it('case 3: invalid column → throws {code:"invalid-argument"}', async () => {
    const deps = makeDeps();
    await expect(
      handleResendPlannerEmail({ pedidoId: 'p1', column: 'foo' }, marianoAuth(), deps)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // Case 4: happy path — Mariano + valid pedido + valid column
  it('case 4: Mariano + valid pedido + column "oferta" → update called + stageHandler invoked + returns {ok:true}', async () => {
    const pedidoData = { pedidoNumber: 'P-001', items: [], plannerEmails: { oferta: { sentAt: new Date() } } };
    const stageHandler = vi.fn(async () => ({ sent: { to: 'of@x.com', column: 'oferta' } }));
    const deps = makeDeps({ pedidoData, stageHandler });

    const result = await handleResendPlannerEmail(
      { pedidoId: 'pedido-abc', column: 'oferta' },
      marianoAuth(),
      deps
    );

    // update called with null to clear idempotency flag
    expect(deps._updateMock).toHaveBeenCalledTimes(1);
    expect(deps._updateMock).toHaveBeenCalledWith({ 'plannerEmails.oferta': null });

    // stageHandler invoked once
    expect(stageHandler).toHaveBeenCalledTimes(1);

    // result shape
    expect(result).toMatchObject({ ok: true, result: { sent: { column: 'oferta' } } });
  });
});
