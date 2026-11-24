// @ts-check
/**
 * DEUDA-M1 R1-R4 (2026-11-19) — tests de waitlist-validate-core.
 */
import { describe, expect, it } from 'vitest';
import {
  handleWaitlistValidate,
  validateWaitlistWrite,
} from '../../functions/core/waitlist-validate-core.js';

describe('validateWaitlistWrite (pure fn)', () => {
  const baseAfter = {
    clientCardCode: 'C001',
    ownerUid: 'vde-uid',
    ownerVendor: 'VDE_ALFA',
    assignedVendorUid: 'vde-uid',
    stage: 'pending',
    items: [],
  };

  describe('R1: asigRefs cross-client', () => {
    it('OK cuando asigRefs apuntan al mismo clientCardCode', () => {
      const after = {
        ...baseAfter,
        items: [
          {
            code: 'SKU1',
            asigRefs: [{ pedidoId: 'ped-c001', lineIndex: 0, qtyAsignada: 2 }],
          },
        ],
      };
      const pedidoOrigenCards = new Map([['ped-c001', { clientCardCode: 'C001' }]]);
      const v = validateWaitlistWrite({
        before: null,
        after,
        waitlistId: 'wl1',
        pedidoOrigenCards,
      });
      expect(v.filter((x) => x.rule === 'R1_ASIGREF_CROSS_CLIENT')).toHaveLength(0);
    });

    it('VIOLATION R1: asigRef apunta a pedido de OTRO cliente', () => {
      const after = {
        ...baseAfter,
        items: [
          {
            code: 'SKU1',
            asigRefs: [{ pedidoId: 'ped-c999', lineIndex: 0, qtyAsignada: 2 }],
          },
        ],
      };
      const pedidoOrigenCards = new Map([['ped-c999', { clientCardCode: 'C999' }]]);
      const v = validateWaitlistWrite({
        before: null,
        after,
        waitlistId: 'wl-attack',
        pedidoOrigenCards,
      });
      const r1 = v.filter((x) => x.rule === 'R1_ASIGREF_CROSS_CLIENT');
      expect(r1).toHaveLength(1);
      expect(r1[0].field).toContain('items[0].asigRefs');
      expect(r1[0].detail.refPedidoId).toBe('ped-c999');
      expect(r1[0].detail.refPedidoCardCode).toBe('C999');
      expect(r1[0].detail.waitlistCardCode).toBe('C001');
    });

    it('fail-open R1: pedido origen sin info en el map → no violación', () => {
      const after = {
        ...baseAfter,
        items: [
          {
            code: 'SKU1',
            asigRefs: [{ pedidoId: 'ped-unknown', lineIndex: 0, qtyAsignada: 2 }],
          },
        ],
      };
      const pedidoOrigenCards = new Map(); // vacío
      const v = validateWaitlistWrite({ before: null, after, waitlistId: 'wl', pedidoOrigenCards });
      expect(v.filter((x) => x.rule === 'R1_ASIGREF_CROSS_CLIENT')).toHaveLength(0);
    });

    it('fail-open R1: pedido origen sin clientCardCode persistido (legacy) → no violación', () => {
      const after = {
        ...baseAfter,
        items: [
          {
            code: 'SKU1',
            asigRefs: [{ pedidoId: 'ped-legacy', lineIndex: 0, qtyAsignada: 2 }],
          },
        ],
      };
      const pedidoOrigenCards = new Map([['ped-legacy', { clientCardCode: '' }]]);
      const v = validateWaitlistWrite({ before: null, after, waitlistId: 'wl', pedidoOrigenCards });
      expect(v.filter((x) => x.rule === 'R1_ASIGREF_CROSS_CLIENT')).toHaveLength(0);
    });

    it('múltiples asigRefs mixtos: detecta la cross-client correcta', () => {
      const after = {
        ...baseAfter,
        items: [
          {
            code: 'SKU1',
            asigRefs: [
              { pedidoId: 'ped-c001', lineIndex: 0, qtyAsignada: 1 },
              { pedidoId: 'ped-c999', lineIndex: 0, qtyAsignada: 1 }, // ataque
            ],
          },
        ],
      };
      const pedidoOrigenCards = new Map([
        ['ped-c001', { clientCardCode: 'C001' }],
        ['ped-c999', { clientCardCode: 'C999' }],
      ]);
      const v = validateWaitlistWrite({ before: null, after, waitlistId: 'wl', pedidoOrigenCards });
      const r1 = v.filter((x) => x.rule === 'R1_ASIGREF_CROSS_CLIENT');
      expect(r1).toHaveLength(1);
      expect(r1[0].detail.refPedidoId).toBe('ped-c999');
    });
  });

  describe('R2: transición de stage', () => {
    it('OK transición pending → consumed', () => {
      const v = validateWaitlistWrite({
        before: { ...baseAfter, stage: 'pending' },
        after: { ...baseAfter, stage: 'consumed' },
        waitlistId: 'wl',
      });
      expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(0);
    });

    it('OK stage=pending (sin transición)', () => {
      const v = validateWaitlistWrite({
        before: { ...baseAfter, stage: 'pending' },
        after: { ...baseAfter, stage: 'pending' },
        waitlistId: 'wl',
      });
      expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(0);
    });

    it('OK stage=consumed (stable)', () => {
      const v = validateWaitlistWrite({
        before: { ...baseAfter, stage: 'consumed' },
        after: { ...baseAfter, stage: 'consumed' },
        waitlistId: 'wl',
      });
      expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(0);
    });

    it('VIOLATION R2: consumed → pending (reanimación)', () => {
      const v = validateWaitlistWrite({
        before: { ...baseAfter, stage: 'consumed' },
        after: { ...baseAfter, stage: 'pending' },
        waitlistId: 'wl',
      });
      const r2 = v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION');
      expect(r2).toHaveLength(1);
      expect(r2[0].detail.from).toBe('consumed');
      expect(r2[0].detail.to).toBe('pending');
    });

    it('OK create (before=null) con stage=pending', () => {
      const v = validateWaitlistWrite({
        before: null,
        after: { ...baseAfter, stage: 'pending' },
        waitlistId: 'wl-new',
      });
      expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(0);
    });
  });

  // Ajuste post-revisión H2 (2026-11-24): las 5 rutas de creación del
  // cliente arman el payload SIN `stage` (verificado con grep en index.html:
  // CPST, Excel, manual, pedido → espera, borrador → espera) y
  // move-pedido-to-waitlist-core crea con stage 'active'. Antes cualquiera de
  // esos creates daba R2 de severidad alta (falso positivo).
  describe('R2: creates reales (H2)', () => {
    const common = {
      clientCardCode: 'C001',
      vendorAssigned: 'VDE_ALFA',
      ownerUid: 'vde-uid',
      ownerEmail: 'vde@example.com',
      ownerDisplayName: 'VDE',
      ownerVendor: 'VDE_ALFA',
      orderNumber: 600,
      createdAt: '2026-11-24T10:00:00.000Z',
      updatedAt: '2026-11-24T10:00:00.000Z',
    };
    const clientPayloads = {
      cpst: {
        ...common,
        clientName: 'CLIENTE SA',
        clientProvince: 'BA',
        clientLocality: 'X',
        deliveryMethod: '',
        deliveryDetails: '',
        source: 'stock-asignado-batch',
        items: [{ code: 'SKU1', qty: 1, origen: 'stock-asignado', asigRefs: [] }],
        pedidosOrigenes: [],
        expiresAt: '2026-12-01T10:00:00.000Z',
      },
      excel: {
        ...common,
        clientName: 'CLIENTE SA',
        clientProvince: 'BA',
        clientLocality: 'X',
        deliveryMethod: '',
        deliveryDetails: '',
      },
      manual: {
        ...common,
        clientName: 'CLIENTE SA',
        clientProvince: 'BA',
        clientLocality: 'X',
        deliveryMethod: '',
        deliveryDetails: '',
        source: 'manual',
      },
      pedidoAEspera: { ...common, fromPedidoFsId: 'p1', fromPedidoMonth: '2026-11' },
      borradorAEspera: { ...common, fromBorrador: true },
    };
    for (const [name, payload] of Object.entries(clientPayloads)) {
      it(`OK create del cliente sin stage (${name})`, () => {
        expect('stage' in payload).toBe(false);
        const v = validateWaitlistWrite({ before: null, after: payload, waitlistId: 'wl-new' });
        expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(0);
      });
    }

    it("OK create con stage 'active' (move-pedido-to-waitlist-core)", () => {
      const v = validateWaitlistWrite({
        before: null,
        after: { ...common, stage: 'active' },
        waitlistId: 'wl-new',
      });
      expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(0);
    });

    it('OK update de orden sin stage (cambio de cantidad) y sin stage → consumed', () => {
      const before = { ...common };
      expect(
        validateWaitlistWrite({ before, after: { ...common, items: [] }, waitlistId: 'wl' })
      ).toEqual([]);
      const v = validateWaitlistWrite({
        before,
        after: { ...common, stage: 'consumed' },
        waitlistId: 'wl',
      });
      expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(0);
    });

    it('OK pending → sin stage y active → consumed', () => {
      for (const [from, to] of [
        ['pending', undefined],
        ['active', 'consumed'],
        [null, 'pending'],
      ]) {
        const v = validateWaitlistWrite({
          before: { ...common, stage: from },
          after: { ...common, stage: to },
          waitlistId: 'wl',
        });
        expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(0);
      }
    });

    it('VIOLATION R2: consumed → sin stage (reanimación)', () => {
      const after = { ...common };
      const v = validateWaitlistWrite({
        before: { ...common, stage: 'consumed' },
        after,
        waitlistId: 'wl',
      });
      const r2 = v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION');
      expect(r2).toHaveLength(1);
      expect(r2[0].detail.to).toBe(null);
    });

    it('VIOLATION R2: create con stage fuera de la lista', () => {
      const v = validateWaitlistWrite({
        before: null,
        after: { ...common, stage: 'rarisimo' },
        waitlistId: 'wl-new',
      });
      expect(v.filter((x) => x.rule === 'R2_INVALID_STAGE_TRANSITION')).toHaveLength(1);
    });
  });

  describe('R3: clientCardCode inmutable', () => {
    it('OK cardCode igual', () => {
      const v = validateWaitlistWrite({
        before: baseAfter,
        after: { ...baseAfter },
        waitlistId: 'wl',
      });
      expect(v.filter((x) => x.rule === 'R3_CLIENTCARDCODE_MUTATED')).toHaveLength(0);
    });

    it('VIOLATION R3: cardCode cambió', () => {
      const v = validateWaitlistWrite({
        before: baseAfter,
        after: { ...baseAfter, clientCardCode: 'C999' },
        waitlistId: 'wl-hijack',
      });
      const r3 = v.filter((x) => x.rule === 'R3_CLIENTCARDCODE_MUTATED');
      expect(r3).toHaveLength(1);
      expect(r3[0].detail.from).toBe('C001');
      expect(r3[0].detail.to).toBe('C999');
    });

    it('OK: before sin clientCardCode (create legacy) → no violación', () => {
      const v = validateWaitlistWrite({
        before: { ...baseAfter, clientCardCode: '' },
        after: { ...baseAfter, clientCardCode: 'C001' },
        waitlistId: 'wl-backfill',
      });
      expect(v.filter((x) => x.rule === 'R3_CLIENTCARDCODE_MUTATED')).toHaveLength(0);
    });
  });

  describe('R4: ownerUid / ownerVendor / assignedVendorUid inmutables', () => {
    it('OK fields iguales', () => {
      const v = validateWaitlistWrite({
        before: baseAfter,
        after: { ...baseAfter },
        waitlistId: 'wl',
      });
      expect(v.filter((x) => x.rule === 'R4_OWNERSHIP_FIELD_MUTATED')).toHaveLength(0);
    });

    it('VIOLATION R4: ownerUid cambió', () => {
      const v = validateWaitlistWrite({
        before: baseAfter,
        after: { ...baseAfter, ownerUid: 'otro-vde' },
        waitlistId: 'wl-hijack',
      });
      const r4 = v.filter((x) => x.rule === 'R4_OWNERSHIP_FIELD_MUTATED');
      expect(r4).toHaveLength(1);
      expect(r4[0].field).toBe('ownerUid');
    });

    it('VIOLATION R4: assignedVendorUid cambió', () => {
      const v = validateWaitlistWrite({
        before: baseAfter,
        after: { ...baseAfter, assignedVendorUid: 'otro-vde' },
        waitlistId: 'wl-hijack',
      });
      const r4 = v.filter((x) => x.rule === 'R4_OWNERSHIP_FIELD_MUTATED');
      expect(r4).toHaveLength(1);
      expect(r4[0].field).toBe('assignedVendorUid');
    });

    it('VIOLATION R4: ownerVendor cambió', () => {
      const v = validateWaitlistWrite({
        before: baseAfter,
        after: { ...baseAfter, ownerVendor: 'VDE_OTRO' },
        waitlistId: 'wl-hijack',
      });
      const r4 = v.filter((x) => x.rule === 'R4_OWNERSHIP_FIELD_MUTATED');
      expect(r4).toHaveLength(1);
      expect(r4[0].field).toBe('ownerVendor');
    });

    it('excepción R4: _backfill presente → NO violación (batch script)', () => {
      // Script Q vendor backfill agrega _backfill.<slug>.
      const v = validateWaitlistWrite({
        before: { ...baseAfter, _backfill: {} },
        after: {
          ...baseAfter,
          assignedVendorUid: 'vde-corregido',
          _backfill: {
            'vendor_realign_2026-11-19': { previousValues: { assignedVendorUid: 'vde-uid' } },
          },
        },
        waitlistId: 'wl-backfill',
      });
      expect(v.filter((x) => x.rule === 'R4_OWNERSHIP_FIELD_MUTATED')).toHaveLength(0);
    });
  });

  it('múltiples violaciones simultáneas devuelven array con todas', () => {
    const v = validateWaitlistWrite({
      before: { ...baseAfter, stage: 'consumed' },
      after: {
        ...baseAfter,
        stage: 'pending',
        clientCardCode: 'C999',
        ownerUid: 'otro',
      },
      waitlistId: 'wl-massive-attack',
    });
    const rules = new Set(v.map((x) => x.rule));
    expect(rules.has('R2_INVALID_STAGE_TRANSITION')).toBe(true);
    expect(rules.has('R3_CLIENTCARDCODE_MUTATED')).toBe(true);
    expect(rules.has('R4_OWNERSHIP_FIELD_MUTATED')).toBe(true);
  });

  it('delete (after=null) NO produce violaciones', () => {
    const v = validateWaitlistWrite({
      before: baseAfter,
      after: null,
      waitlistId: 'wl-del',
    });
    expect(v).toHaveLength(0);
  });
});

/** Mock Firestore para handleWaitlistValidate. */
function makeMockDb(state = { pedidos: {}, operations_log: [] }) {
  return {
    _state: state,
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return {
            async get() {
              return {
                exists: !!state[name]?.[id],
                data: () => state[name]?.[id] || null,
              };
            },
          };
        },
        add(doc) {
          state[name] ||= [];
          state[name].push(doc);
          return Promise.resolve({ id: 'auto_' + state[name].length });
        },
      };
    },
  };
}

describe('handleWaitlistValidate', () => {
  it('OK: write válido no loguea', async () => {
    const state = {
      pedidos: { 'ped-c001': { clientCardCode: 'C001' } },
      operations_log: [],
    };
    const r = await handleWaitlistValidate({
      before: null,
      after: {
        clientCardCode: 'C001',
        ownerUid: 'u',
        stage: 'pending',
        items: [
          { code: 'SKU1', asigRefs: [{ pedidoId: 'ped-c001', lineIndex: 0, qtyAsignada: 1 }] },
        ],
      },
      waitlistId: 'wl',
      fbDb: makeMockDb(state),
    });
    expect(r.violations).toHaveLength(0);
    expect(r.logged).toBe(false);
    expect(state.operations_log).toHaveLength(0);
  });

  it('R1 cross-client: loguea con shape completo', async () => {
    const state = {
      pedidos: { 'ped-c999': { clientCardCode: 'C999' } },
      operations_log: [],
    };
    const r = await handleWaitlistValidate({
      before: null,
      after: {
        clientCardCode: 'C001',
        ownerUid: 'atacante',
        stage: 'pending',
        items: [
          { code: 'SKU1', asigRefs: [{ pedidoId: 'ped-c999', lineIndex: 0, qtyAsignada: 1 }] },
        ],
      },
      waitlistId: 'wl-attack',
      fbDb: makeMockDb(state),
    });
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.logged).toBe(true);
    expect(state.operations_log).toHaveLength(1);
    const logEntry = state.operations_log[0];
    expect(logEntry.type).toBe('sec_m1_waitlist_integrity_violation');
    expect(logEntry.severity).toBe('warning');
    expect(logEntry.waitlistId).toBe('wl-attack');
    expect(logEntry.violations[0].rule).toBe('R1_ASIGREF_CROSS_CLIENT');
  });

  it('R2 reanimación: consumed → pending loguea', async () => {
    const state = { pedidos: {}, operations_log: [] };
    const r = await handleWaitlistValidate({
      before: { clientCardCode: 'C001', ownerUid: 'u', stage: 'consumed' },
      after: { clientCardCode: 'C001', ownerUid: 'u', stage: 'pending' },
      waitlistId: 'wl-revive',
      fbDb: makeMockDb(state),
    });
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.logged).toBe(true);
    expect(state.operations_log[0].violations[0].rule).toBe('R2_INVALID_STAGE_TRANSITION');
  });

  it('delete (after=null) NO procesa ni loguea', async () => {
    const state = { pedidos: {}, operations_log: [] };
    const r = await handleWaitlistValidate({
      before: { clientCardCode: 'C001', ownerUid: 'u', stage: 'pending' },
      after: null,
      waitlistId: 'wl-del',
      fbDb: makeMockDb(state),
    });
    expect(r.violations).toHaveLength(0);
    expect(r.logged).toBe(false);
    expect(state.operations_log).toHaveLength(0);
  });

  it('fail-open: Firestore error en pedido lookup no rompe el trigger', async () => {
    const brokenDb = {
      collection(name) {
        return {
          doc() {
            return {
              async get() {
                throw new Error('Firestore down');
              },
            };
          },
          add(doc) {
            brokenDb._opsLog ||= [];
            brokenDb._opsLog.push(doc);
            return Promise.resolve({ id: 'x' });
          },
        };
      },
      _opsLog: [],
    };
    const r = await handleWaitlistValidate({
      before: null,
      after: {
        clientCardCode: 'C001',
        ownerUid: 'u',
        stage: 'pending',
        items: [{ code: 'SKU1', asigRefs: [{ pedidoId: 'ped-x', lineIndex: 0, qtyAsignada: 1 }] }],
      },
      waitlistId: 'wl',
      fbDb: brokenDb,
    });
    // Sin info del pedido origen, no detecta R1 (fail-open) — pero no throws.
    expect(r.violations.filter((v) => v.rule === 'R1_ASIGREF_CROSS_CLIENT')).toHaveLength(0);
  });
});
