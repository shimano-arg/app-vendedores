import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildFirmesPropiasIndex,
  buildVendorFilterOptions,
  computeDisponibleConStockTotal,
  filterWaitlistsByVendor,
  VENDOR_FILTER_ALL,
  VENDOR_FILTER_NONE,
  waitlistVendorKey,
} from '../../src/pure/waitlist-sidebar-summary.js';

const W = (o) => ({ items: [], ...o });

describe('filtro de vendedor', () => {
  const list = [
    W({ _id: 'a', vendorAssigned: 'MAURICIO GIL' }),
    W({ _id: 'b', vendorAssigned: 'pachi' }),
    W({ _id: 'c', ownerVendor: 'MAURICIO GIL' }),
    W({ _id: 'd' }),
  ];

  it('vendorKey sale de vendorAssigned con fallback a ownerVendor', () => {
    expect(waitlistVendorKey(list[1])).toBe('PACHI');
    expect(waitlistVendorKey(list[2])).toBe('MAURICIO GIL');
    expect(waitlistVendorKey(list[3])).toBe('');
  });

  it('opciones salen solo de la lista visible, con conteo y "sin vendedor" al final', () => {
    expect(buildVendorFilterOptions(list)).toEqual([
      { value: 'MAURICIO GIL', key: 'MAURICIO GIL', count: 2 },
      { value: 'PACHI', key: 'PACHI', count: 1 },
      { value: VENDOR_FILTER_NONE, key: '', count: 1 },
    ]);
  });

  it('filtrar nunca agrega ordenes: siempre subconjunto de la lista recibida', () => {
    expect(filterWaitlistsByVendor(list, VENDOR_FILTER_ALL)).toHaveLength(4);
    expect(filterWaitlistsByVendor(list, 'MAURICIO GIL').map((w) => w._id)).toEqual(['a', 'c']);
    expect(filterWaitlistsByVendor(list, VENDOR_FILTER_NONE).map((w) => w._id)).toEqual(['d']);
    expect(filterWaitlistsByVendor(list, 'FEDERICO CASTELANELLI')).toEqual([]);
  });
});

describe('buildFirmesPropiasIndex', () => {
  it('suma qtyOpen de ASIG y confirmed vigentes por cliente y SKU', () => {
    const pedidos = [
      {
        clientCardCode: ' C1 ',
        lines: [
          { code: 'sku1', state: 'ASIG', qtyOpen: 2 },
          { code: 'SKU1', state: 'confirmed', qtyOpen: 1 },
          { code: 'SKU1', state: 'BO', qtyOpen: 5 },
          { code: 'SKU2', state: 'ASIG', qtyOpen: 3, vencida: true },
        ],
      },
      { clientCardCode: 'C1', closedAt: 'x', lines: [{ code: 'SKU1', state: 'ASIG', qtyOpen: 9 }] },
    ];
    const lrs = (l) => !l.vencida;
    const idx = buildFirmesPropiasIndex(pedidos, lrs, 0);
    expect(idx.get('C1|SKU1')).toBe(3);
    expect(idx.has('C1|SKU2')).toBe(false);
  });
});

describe('computeDisponibleConStockTotal', () => {
  const stock = {
    A: { hasData: true, fisico: 3, sobrante: 3 },
    B: { hasData: true, fisico: 10, sobrante: 0 },
  };
  const deps = (firmes = {}) => ({
    getSkuStock: (c) => stock[c] || { hasData: false, fisico: 0, sobrante: 0 },
    firmesIndex: new Map(Object.entries(firmes)),
    getPrice: (c) => ({ A: 100, B: 10, Z: 7 })[c] || 0,
  });

  it('dos ordenes que compiten por el mismo SKU no cuentan el stock dos veces', () => {
    const list = [
      W({ clientCardCode: 'C1', items: [{ code: 'A', qty: 2 }] }),
      W({ clientCardCode: 'C2', items: [{ code: 'A', qty: 2 }] }),
    ];
    const r = computeDisponibleConStockTotal(list, deps());
    expect(r.total).toBe(300); // solo hay 3 u
    expect(r.sumaPorOrden).toBe(400); // cada detalle por separado ve 2 u
  });

  it('las reservas firmes de un cliente cubren solo sus ordenes', () => {
    // B: fisico 10, todo reservado (sobrante 0). C1 tiene 4 firmes.
    const list = [
      W({ clientCardCode: 'C1', items: [{ code: 'B', qty: 6 }] }),
      W({ clientCardCode: 'C2', items: [{ code: 'B', qty: 5 }] }),
    ];
    const r = computeDisponibleConStockTotal(list, deps({ 'C1|B': 4 }));
    expect(r.total).toBe(40); // 4 de C1, C2 nada
    expect(r.sumaPorOrden).toBe(40);
  });

  it('el total no depende del orden de las ordenes', () => {
    const a = W({
      clientCardCode: 'C1',
      items: [
        { code: 'A', qty: 2 },
        { code: 'B', qty: 3 },
      ],
    });
    const b = W({
      clientCardCode: 'C2',
      items: [
        { code: 'A', qty: 3 },
        { code: 'B', qty: 1 },
      ],
    });
    const d = deps({ 'C2|B': 1, 'C1|B': 2 });
    expect(computeDisponibleConStockTotal([a, b], d).total).toBe(
      computeDisponibleConStockTotal([b, a], d).total
    );
  });

  it('nunca pasa el fisico del SKU', () => {
    const list = [
      W({ clientCardCode: 'C1', items: [{ code: 'A', qty: 5 }] }),
      W({ clientCardCode: 'C2', items: [{ code: 'A', qty: 5 }] }),
    ];
    // firmes inconsistentes (sobre-reserva): igual tope en fisico 3.
    const r = computeDisponibleConStockTotal(list, deps({ 'C1|A': 3, 'C2|A': 3 }));
    expect(r.total).toBe(300);
  });

  it('sin snapshot de stock la linea cuenta entera (igual que el detalle)', () => {
    const r = computeDisponibleConStockTotal(
      [W({ clientCardCode: 'C1', items: [{ code: 'Z', qty: 2 }] })],
      deps()
    );
    expect(r.total).toBe(14);
    expect(r.sumaPorOrden).toBe(14);
  });

  it('una sola orden da lo mismo que su "Subtotal (Con Stock)"', () => {
    // Caso captura ORDEN 1032: un SKU sin libre (0) y otro con 26 libres.
    const st = {
      EXGC70HBAR: { hasData: true, fisico: 0, sobrante: 0 },
      EXGS70HB2AR: { hasData: true, fisico: 26, sobrante: 26 },
    };
    const r = computeDisponibleConStockTotal(
      [
        W({
          clientCardCode: 'C1',
          items: [
            { code: 'EXGC70HBAR', qty: 2 },
            { code: 'EXGS70HB2AR', qty: 2 },
          ],
        }),
      ],
      {
        getSkuStock: (c) => st[c],
        firmesIndex: new Map(),
        getPrice: (c) => (c === 'EXGC70HBAR' ? 80000 : 73000),
      }
    );
    expect(r.total).toBe(146000);
  });

  it('ignora items sin codigo o con cantidad 0', () => {
    const list = [
      W({ clientCardCode: 'C1', items: [{ code: '', qty: 3 }, { code: 'A', qty: 0 }, null] }),
    ];
    expect(computeDisponibleConStockTotal(list, deps()).total).toBe(0);
  });
});

describe('contrato index.html', () => {
  const html = readFileSync('index.html', 'utf8');

  it('selector de vendedor arriba del buscador y card Disponible (Con Stock)', () => {
    const iCard = html.indexOf('id="slft-wl-disp-card"');
    const iSel = html.indexOf('id="slft-wl-vendor"');
    const iSearch = html.indexOf('id="slft-wl-search"');
    expect(iCard).toBeGreaterThan(0);
    expect(iSel).toBeGreaterThan(iCard);
    expect(iSearch).toBeGreaterThan(iSel);
    expect(html).toContain('Disponible (Con Stock)');
  });

  it('las opciones salen de arrForRole (lo que el rol ya ve) y el VDE no ve el selector', () => {
    expect(html).toContain('_sum.buildVendorFilterOptions(arrForRole)');
    expect(html).toContain('_sum.filterWaitlistsByVendor(arrForRole, _slftWlVendor)');
    expect(html).toMatch(/_isVde \? \[\] : _sum\.buildVendorFilterOptions/);
  });

  it('la card se calcula sobre la lista ya filtrada', () => {
    expect(html).toContain('_renderWaitlistDisponibleCard(filtered);');
  });
});
