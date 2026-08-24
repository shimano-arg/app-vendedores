import { describe, expect, it } from 'vitest';
import { reenrichPedidoLine, splitPedidoLine } from '../../src/pure/pedido-split.js';

const RAW = (o = {}) => ({
  code: 'SKU-X',
  desc: 'Producto X',
  cat: 'CAT',
  fam: 'FAM',
  sub: 'SUB',
  qty: 100,
  precio: 500,
  needsReview: false,
  ...o,
});

describe('splitPedidoLine — flag OFF (legacy todo-o-nada)', () => {
  it('disp >= qty → 1 linea confirmed', () => {
    const disp = 100;
    const lines = splitPedidoLine(RAW({ qty: 100 }), { getDisp: () => disp, flagEnabled: false });
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('confirmed');
    expect(lines[0].qty).toBe(100);
    expect(lines[0].qtyOpen).toBe(100);
  });

  it('disp < qty → 1 linea BO con qty=qty completa (legacy comportamiento)', () => {
    const lines = splitPedidoLine(RAW({ qty: 100 }), { getDisp: () => 70, flagEnabled: false });
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
    expect(lines[0].qty).toBe(100);
    expect(lines[0].qtyOpen).toBe(100);
  });

  it('disp = 0 → 1 linea BO', () => {
    const lines = splitPedidoLine(RAW({ qty: 50 }), { getDisp: () => 0, flagEnabled: false });
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
  });
});

describe('splitPedidoLine — flag ON (nueva politica)', () => {
  it('caso 100/70: split en {70 confirmed, 30 BO}', () => {
    const lines = splitPedidoLine(RAW({ qty: 100 }), { getDisp: () => 70, flagEnabled: true });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: 70, qtyOpen: 70, state: 'confirmed', code: 'SKU-X' });
    expect(lines[1]).toMatchObject({ qty: 30, qtyOpen: 30, state: 'BO', code: 'SKU-X' });
  });

  it('disp >= qty (stock suficiente): 1 linea confirmed', () => {
    const lines = splitPedidoLine(RAW({ qty: 100 }), { getDisp: () => 200, flagEnabled: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qty: 100, qtyOpen: 100, state: 'confirmed' });
  });

  it('disp = 0 (sin stock): 1 linea BO', () => {
    const lines = splitPedidoLine(RAW({ qty: 50 }), { getDisp: () => 0, flagEnabled: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qty: 50, qtyOpen: 50, state: 'BO' });
  });

  it('qty = 0 edge (defensivo): 1 linea BO qty=0', () => {
    const lines = splitPedidoLine(RAW({ qty: 0 }), { getDisp: () => 100, flagEnabled: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qty: 0, qtyOpen: 0, state: 'BO' });
  });

  it('preserva metadata desc/cat/fam/sub/needsReview en cada linea splitteada', () => {
    const raw = RAW({
      qty: 10,
      desc: 'Rod XR',
      cat: 'CAÑAS',
      fam: 'ROD',
      sub: 'XR',
      needsReview: true,
    });
    const lines = splitPedidoLine(raw, { getDisp: () => 4, flagEnabled: true });
    for (const l of lines) {
      expect(l.desc).toBe('Rod XR');
      expect(l.cat).toBe('CAÑAS');
      expect(l.fam).toBe('ROD');
      expect(l.sub).toBe('XR');
      expect(l.needsReview).toBe(true);
      expect(l.priceAtCreation).toBe(500);
      expect(l.qtyInvoiced).toBe(0);
      expect(l.qtyCancelled).toBe(0);
      expect(l.qtyRecycled).toBe(0);
      expect(l.asigAt).toBeNull();
      expect(l.recycledIntoPedidoId).toBeNull();
    }
  });

  it('sin getDisp: trata disp=0 → 1 linea BO', () => {
    const lines = splitPedidoLine(RAW({ qty: 10 }), { flagEnabled: true });
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
  });
});

describe('reenrichPedidoLine — estados LOCKED preservados', () => {
  const existing = (state, overrides = {}) => ({
    code: 'SKU-X',
    desc: 'X',
    qty: 100,
    precio: 500,
    qtyInvoiced: 0,
    qtyCancelled: 0,
    qtyRecycled: 0,
    state,
    ...overrides,
  });

  it.each(['ASIG', 'invoiced', 'cancelled', 'recycled'])(
    'state=%s: no re-evalua, preserva estado',
    (state) => {
      const lines = reenrichPedidoLine(existing(state), {
        getDisp: () => 10,
        flagEnabled: true,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0].state).toBe(state);
    }
  );

  it('state=confirmed: NO re-splittea aunque disp<qty (linea ya puede estar en SAP)', () => {
    const lines = reenrichPedidoLine(existing('confirmed'), {
      getDisp: () => 30,
      flagEnabled: true,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('confirmed');
    expect(lines[0].qty).toBe(100);
    expect(lines[0].qtyOpen).toBe(100);
  });
});

describe('reenrichPedidoLine — flag OFF (legacy)', () => {
  it('state=BO + disp>=qtyOpen: pasa a confirmed', () => {
    const lines = reenrichPedidoLine(
      {
        code: 'SKU-X',
        qty: 100,
        precio: 500,
        qtyInvoiced: 0,
        qtyCancelled: 0,
        qtyRecycled: 0,
        state: 'BO',
      },
      { getDisp: () => 200, flagEnabled: false }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('confirmed');
    expect(lines[0].qtyOpen).toBe(100);
  });

  it('state=BO + disp<qtyOpen: se queda BO con qtyOpen entera (legacy)', () => {
    const lines = reenrichPedidoLine(
      {
        code: 'SKU-X',
        qty: 100,
        precio: 500,
        qtyInvoiced: 0,
        qtyCancelled: 0,
        qtyRecycled: 0,
        state: 'BO',
      },
      { getDisp: () => 70, flagEnabled: false }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
    expect(lines[0].qtyOpen).toBe(100);
  });
});

describe('reenrichPedidoLine — flag ON (nueva politica)', () => {
  it('state=BO qty=100 + disp=70: split en {70 confirmed, 30 BO}', () => {
    const lines = reenrichPedidoLine(
      {
        code: 'SKU-X',
        qty: 100,
        precio: 500,
        qtyInvoiced: 0,
        qtyCancelled: 0,
        qtyRecycled: 0,
        state: 'BO',
      },
      { getDisp: () => 70, flagEnabled: true }
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: 70, qtyOpen: 70, state: 'confirmed' });
    expect(lines[1]).toMatchObject({ qty: 30, qtyOpen: 30, state: 'BO' });
  });

  it('state=BO + disp>=qtyOpen: 1 linea confirmed', () => {
    const lines = reenrichPedidoLine(
      {
        code: 'SKU-X',
        qty: 100,
        precio: 500,
        qtyInvoiced: 0,
        qtyCancelled: 0,
        qtyRecycled: 0,
        state: 'BO',
      },
      { getDisp: () => 500, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('confirmed');
    expect(lines[0].qtyOpen).toBe(100);
  });

  it('state=BO + disp=0: sigue BO', () => {
    const lines = reenrichPedidoLine(
      {
        code: 'SKU-X',
        qty: 50,
        precio: 500,
        qtyInvoiced: 0,
        qtyCancelled: 0,
        qtyRecycled: 0,
        state: 'BO',
      },
      { getDisp: () => 0, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe('BO');
    expect(lines[0].qtyOpen).toBe(50);
  });

  it('state=legacy: se comporta como BO (re-evaluar + potencialmente split)', () => {
    const lines = reenrichPedidoLine(
      {
        code: 'SKU-X',
        qty: 100,
        precio: 500,
        qtyInvoiced: 0,
        qtyCancelled: 0,
        qtyRecycled: 0,
        state: 'legacy',
      },
      { getDisp: () => 60, flagEnabled: true }
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: 60, qtyOpen: 60, state: 'confirmed' });
    expect(lines[1]).toMatchObject({ qty: 40, qtyOpen: 40, state: 'BO' });
  });

  it('qtyOpen=0 (todo ya invoiced/recycled): no genera lineas activas', () => {
    const lines = reenrichPedidoLine(
      {
        code: 'SKU-X',
        qty: 100,
        precio: 500,
        qtyInvoiced: 60,
        qtyCancelled: 20,
        qtyRecycled: 20,
        state: 'BO',
      },
      { getDisp: () => 100, flagEnabled: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].qtyOpen).toBe(0);
  });
});
