import { describe, expect, it, vi } from 'vitest';
import { handlePlannerStageChanged } from '../../functions/core/planner-stage-change-core.js';

// v— (2026-09-22): unit tests for CF onPlannerStageChanged core.
// Pure logic: no firebase-admin, no emulator needed. All deps injected.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(before, after) {
  return {
    data: {
      before: before ? { data: () => before } : null,
      after: after ? { data: () => after, ref: { update: vi.fn(async () => {}) } } : null,
    },
  };
}

function makeDeps({ config = defaultConfig(), roleDocs = {} } = {}) {
  return {
    db: {
      doc: (path) => ({
        get: async () => {
          if (path === 'app_config/planner_responsables')
            return { exists: true, data: () => config };
          return { exists: false, data: () => ({}) };
        },
      }),
      collection: (_name) => ({
        where: (field, _op, val) => ({
          limit: (n) => ({
            get: async () => {
              const uids = Object.keys(roleDocs).filter((uid) => roleDocs[uid][field] === val);
              return {
                empty: uids.length === 0,
                docs: uids.slice(0, n).map((uid) => ({ id: uid, data: () => roleDocs[uid] })),
              };
            },
          }),
        }),
      }),
    },
    transporter: { sendMail: vi.fn(async () => ({ messageId: 'test' })) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date('2026-09-22T12:00:00Z'),
  };
}

function defaultConfig() {
  return {
    lista_espera: { email: 'le@x.com', name: 'LE', notifyOnEnter: true },
    oferta: { email: 'of@x.com', name: 'OF', notifyOnEnter: true },
    ordenes: { email: 'or@x.com', name: 'OR', notifyOnEnter: true },
    confirmado: {
      email: 'mariano.erbino@shimano.com.ar',
      name: 'Mariano',
      notifyOnEnter: true,
      hardcoded: true,
    },
    facturar: {
      email: 'fa@x.com',
      name: 'FA',
      notifyOnEnter: true,
      sendToVdi: true,
    },
    cobrado: { email: 'co@x.com', name: 'CO', notifyOnEnter: true },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handlePlannerStageChanged', () => {
  // Case 1: before=lista_espera, after=oferta → email sent
  it('case 1: lista_espera→oferta transition sends email to of@x.com with subject matching /oferta/i', async () => {
    const before = { items: [] };
    const after = {
      items: [],
      transferidoSAP: { docNum: 12345 },
      pedidoNumber: 'P-001',
    };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    const result = await handlePlannerStageChanged(event, deps);

    expect(deps.transporter.sendMail).toHaveBeenCalledTimes(1);
    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.to).toContain('of@x.com');
    expect(callArgs.subject).toMatch(/oferta/i);
    expect(result).toEqual(
      expect.objectContaining({ sent: expect.objectContaining({ column: 'oferta' }) })
    );
  });

  // Case 2: same state before/after → no email
  it('case 2: same column before/after → sendMail NOT called', async () => {
    const state = { items: [], transferidoSAP: { docNum: 12345 }, pedidoNumber: 'P-002' };
    const event = makeEvent(state, { ...state });
    const deps = makeDeps();

    const result = await handlePlannerStageChanged(event, deps);

    expect(deps.transporter.sendMail).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: 'no-column-change' });
  });

  // Case 3: idempotency — already sent
  it('case 3: after.plannerEmails.oferta.sentAt already set → sendMail NOT called', async () => {
    const before = { items: [] };
    const after = {
      items: [],
      transferidoSAP: { docNum: 12345 },
      pedidoNumber: 'P-003',
      plannerEmails: { oferta: { sentAt: new Date('2026-09-21T00:00:00Z'), to: 'of@x.com' } },
    };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    const result = await handlePlannerStageChanged(event, deps);

    expect(deps.transporter.sendMail).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: 'already-sent' });
  });

  // Case 4: transition to confirmado via plannerStage override
  it('case 4: before=lista_espera, after has plannerStage=confirmado → email to mariano.erbino@shimano.com.ar', async () => {
    const before = { items: [] };
    const after = {
      items: [],
      plannerStage: 'confirmado',
      pedidoNumber: 'P-004',
    };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    const result = await handlePlannerStageChanged(event, deps);

    expect(deps.transporter.sendMail).toHaveBeenCalledTimes(1);
    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.to).toContain('mariano.erbino@shimano.com.ar');
    expect(result.sent.column).toBe('confirmado');
  });

  // Case 5: facturar + sendToVdi with matching vendor → both emails in to
  it('case 5: facturar + sendToVdi + vendorKey diego → both fa@x.com and diego@shimano.com.ar in to', async () => {
    const before = { items: [] };
    const after = {
      items: [{ qtyInvoiced: 2, code: 'X' }],
      pedidoNumber: 'P-005',
      vendorKey: 'diego',
    };
    const event = makeEvent(before, after);
    const deps = makeDeps({
      roleDocs: {
        'diego-uid': { role: 'vendedor', vendor: 'diego', email: 'diego@shimano.com.ar' },
      },
    });

    const result = await handlePlannerStageChanged(event, deps);

    expect(deps.transporter.sendMail).toHaveBeenCalledTimes(1);
    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.to).toContain('fa@x.com');
    expect(callArgs.to).toContain('diego@shimano.com.ar');
    expect(result.sent.column).toBe('facturar');
  });

  // Case 6: after send, ref.update called with plannerEmails.oferta payload
  it('case 6: after send, event.data.after.ref.update called ONCE with plannerEmails.oferta property', async () => {
    const before = { items: [] };
    const after = {
      items: [],
      transferidoSAP: { docNum: 12345 },
      pedidoNumber: 'P-006',
    };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    await handlePlannerStageChanged(event, deps);

    expect(event.data.after.ref.update).toHaveBeenCalledTimes(1);
    const updateArg = event.data.after.ref.update.mock.calls[0][0];
    expect(updateArg).toHaveProperty('plannerEmails.oferta');
  });

  // Case 7: notifyOnEnter=false → no email
  it('case 7: column config with notifyOnEnter=false → sendMail NOT called', async () => {
    const config = {
      ...defaultConfig(),
      oferta: { email: 'of@x.com', name: 'OF', notifyOnEnter: false },
    };
    const before = { items: [] };
    const after = {
      items: [],
      transferidoSAP: { docNum: 12345 },
      pedidoNumber: 'P-007',
    };
    const event = makeEvent(before, after);
    const deps = makeDeps({ config });

    const result = await handlePlannerStageChanged(event, deps);

    expect(deps.transporter.sendMail).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: 'notify-disabled' });
  });

  // Case 8: delete event (after=null) → no throw, sendMail NOT called
  it('case 8: delete event (after=null) → no throw, sendMail NOT called', async () => {
    const event = makeEvent({ items: [] }, null);
    const deps = makeDeps();

    const result = await handlePlannerStageChanged(event, deps);

    expect(deps.transporter.sendMail).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: 'no-after' });
  });

  // v1021: fallback a transferidoSAP.docNum cuando no hay pedidoNumber/orderNumber
  it('case 10 (v1021): sin pedidoNumber pero con transferidoSAP.docNum → subject "SAP:12345"', async () => {
    const before = { items: [] };
    const after = { items: [], transferidoSAP: { docNum: 12345 } };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    await handlePlannerStageChanged(event, deps);

    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.subject).toContain('SAP:12345');
    expect(callArgs.subject).not.toContain('sin número');
    expect(callArgs.text).toContain('SAP:12345');
  });

  it('case 11 (v1021): sin pedidoNumber pero con docNum+orderDocEntry → "SAP:X · SO:Y"', async () => {
    const before = { items: [] };
    const after = { items: [], transferidoSAP: { docNum: 2000120, orderDocEntry: 36882 } };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    await handlePlannerStageChanged(event, deps);

    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.subject).toContain('SAP:2000120');
    expect(callArgs.subject).toContain('SO:36882');
  });

  // v1021: fallback de totalArs cuando totalAmountArs ausente pero netAmountArs presente (76% de pedidos reales)
  it('case 12 (v1021): sin totalAmountArs pero con netAmountArs → total muestra el netAmountArs', async () => {
    const before = { items: [] };
    const after = {
      items: [],
      transferidoSAP: { docNum: 999 },
      netAmountArs: 1954000,
    };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    await handlePlannerStageChanged(event, deps);

    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.text).toContain('1.954.000');
    expect(callArgs.html).toContain('1.954.000');
    // No aparece el "-" que indicaba total ausente
    expect(callArgs.text).not.toMatch(/Total ARS:-/);
  });

  it('case 13 (v1021): sin totales pero con lines qty*precio → total computado', async () => {
    const before = { items: [] };
    const after = {
      items: [],
      lines: [
        { qty: 2, precio: 27000 },
        { qty: 3, priceAtCreation: 10000 },
      ],
      transferidoSAP: { docNum: 888 },
    };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    await handlePlannerStageChanged(event, deps);

    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    // 2*27000 + 3*10000 = 84000
    expect(callArgs.text).toContain('84.000');
  });

  // v1022: orderNumber tiene precedencia como ID único del negocio.
  it('case 14 (v1022): orderNumber solo (sin SAP) + transición a confirmado → "ORDEN 145"', async () => {
    // Necesitamos que el after cambie de columna vs before para que se dispare el email.
    // Usamos plannerStage='confirmado' — cae en columna 'confirmado' sin necesitar SAP.
    const before = { items: [] };
    const after = { items: [], orderNumber: '145', plannerStage: 'confirmado' };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    await handlePlannerStageChanged(event, deps);

    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.subject).toContain('ORDEN 145');
    expect(callArgs.subject).not.toContain('SAP:');
    expect(callArgs.subject).not.toContain('(SAP:');
  });

  it('case 15 (v1022): orderNumber + docNum + orderDocEntry → "ORDEN 145 (SAP:X · SO:Y)"', async () => {
    const before = { items: [] };
    const after = {
      items: [],
      orderNumber: '145',
      transferidoSAP: { docNum: 2000120, orderDocEntry: 36882 },
    };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    await handlePlannerStageChanged(event, deps);

    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.subject).toMatch(/ORDEN 145 \(SAP:2000120 · SO:36882\)/);
  });

  it('case 16 (v1022): orderNumber + docNum (sin SO) → "ORDEN 145 (SAP:2000120)"', async () => {
    const before = { items: [] };
    const after = {
      items: [],
      orderNumber: '145',
      transferidoSAP: { docNum: 2000120 },
    };
    const event = makeEvent(before, after);
    const deps = makeDeps();

    await handlePlannerStageChanged(event, deps);

    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.subject).toMatch(/ORDEN 145 \(SAP:2000120\)/);
    expect(callArgs.subject).not.toContain('SO:');
  });

  // Case 9: facturar + sendToVdi + orphan VDI (no email) → log.warn + sendMail still called with primary email only
  it('case 9: facturar + sendToVdi + orphan VDI (no email field) → log.warn called AND sendMail called with fa@x.com only', async () => {
    const before = { items: [] };
    const after = {
      items: [{ qtyInvoiced: 3 }],
      pedidoNumber: 'P-009',
      vendorKey: 'orphan',
    };
    const event = makeEvent(before, after);
    const deps = makeDeps({
      roleDocs: {
        'orphan-uid': { role: 'vendedor', vendor: 'orphan' }, // no email field
      },
    });

    const result = await handlePlannerStageChanged(event, deps);

    expect(deps.log.warn).toHaveBeenCalled();
    const warnMsg = deps.log.warn.mock.calls[0][0];
    expect(warnMsg).toMatch(/orphan/);

    expect(deps.transporter.sendMail).toHaveBeenCalledTimes(1);
    const callArgs = deps.transporter.sendMail.mock.calls[0][0];
    expect(callArgs.to).toContain('fa@x.com');
    expect(callArgs.to).not.toContain('@shimano.com.ar');
    expect(result.sent.column).toBe('facturar');
  });
});
