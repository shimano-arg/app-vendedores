import { describe, expect, it } from 'vitest';
import { computeBackorderSkuMap } from '../../src/pure/backorder-sku-map.js';

const NOW_MS = new Date('2026-09-30T12:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (n) => new Date(NOW_MS - n * DAY_MS).toISOString();

const identityVendor = (t) =>
  String(t || '')
    .trim()
    .toUpperCase();

const baseDeps = (overrides = {}) => ({
  getStockDisponibleVenta: () => 0,
  canonVendor: identityVendor,
  now: NOW_MS,
  ...overrides,
});

const pedido = (o = {}) => ({
  _fsId: 'p1',
  stage: 'confirmed',
  clientName: 'REBORN SRL',
  clientCardCode: 'C-REBORN',
  locName: 'VILLA DEL PARQUE',
  ownerVendor: 'GONZALO DE LA ROSA',
  confirmedAt: daysAgo(2),
  createdAt: daysAgo(3),
  lines: [],
  ...o,
});

const line = (o = {}) => ({
  code: 'SLXDC151HG',
  desc: 'Shimano SLX DC 151HG',
  state: 'BO',
  qty: 6,
  qtyOpen: 6,
  precio: 227000,
  ...o,
});

describe('computeBackorderSkuMap — mode urgente (Backorder)', () => {
  it('SKU sin stock disponible → aparece con urgency=urgente', () => {
    const pedidos = [pedido({ lines: [line({ qtyOpen: 6 })] })];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].sku).toBe('SLXDC151HG');
    expect(r.skus[0].urgency).toBe('urgente');
    expect(r.skus[0].dispSap).toBe(0);
    expect(r.skus[0].clientes[0].qtyBackorder).toBe(6);
    expect(r.totalUnidades).toBe(6);
    expect(r.totalClientes).toBe(1);
  });

  it('SKU con stock parcial → urgency=parcial + FIFO reparte entre clientes', () => {
    const pedidos = [
      pedido({
        _fsId: 'pA',
        clientName: 'CLIENTE A',
        clientCardCode: 'C-A',
        confirmedAt: daysAgo(5),
        lines: [line({ qtyOpen: 3 })],
      }),
      pedido({
        _fsId: 'pB',
        clientName: 'CLIENTE B',
        clientCardCode: 'C-B',
        confirmedAt: daysAgo(1),
        lines: [line({ qtyOpen: 4 })],
      }),
    ];
    // Stock disponible: 2 unidades. FIFO: CLIENTE A (más viejo) toma 2, sobra 0.
    const deps = baseDeps({ getStockDisponibleVenta: () => 2 });
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, deps);
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].urgency).toBe('parcial');
    expect(r.skus[0].dispSap).toBe(2);
    // Ambos clientes deben aparecer con qtyBackorder>0 (A: 1, B: 4).
    const A = r.skus[0].clientes.find((c) => c.nombre === 'CLIENTE A');
    const B = r.skus[0].clientes.find((c) => c.nombre === 'CLIENTE B');
    expect(A.qtyAsignada).toBe(2);
    expect(A.qtyBackorder).toBe(1);
    expect(B.qtyAsignada).toBe(0);
    expect(B.qtyBackorder).toBe(4);
    expect(r.totalUnidades).toBe(5); // 1 + 4
  });

  it('SKU con stock >= demanda total → NO aparece en modo urgente', () => {
    const pedidos = [pedido({ lines: [line({ qtyOpen: 3 })] })];
    const deps = baseDeps({ getStockDisponibleVenta: () => 100 });
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, deps);
    expect(r.skus).toHaveLength(0);
  });

  it('línea BO con pedido >15d atrás → excluida (v969 vencida)', () => {
    const pedidos = [
      pedido({
        createdAt: daysAgo(20),
        lines: [line({ qtyOpen: 5 })],
      }),
    ];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(0);
  });

  it('pedido con stage != confirmed → excluido', () => {
    const pedidos = [pedido({ stage: 'draft', lines: [line({ qtyOpen: 5 })] })];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(0);
  });

  it('pedido con closedAt → NO se considera (stage check ya lo saca, pero doblemente seguro)', () => {
    const pedidos = [
      pedido({ closedAt: daysAgo(1), lines: [line({ qtyOpen: 5 })] }),
      pedido({ _fsId: 'p2', lines: [line({ qtyOpen: 3 })] }),
    ];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].totalPendiente).toBe(3);
  });

  it('consolidar duplicados del mismo cliente (varios pedidos mismo SKU)', () => {
    const pedidos = [
      pedido({
        _fsId: 'p1',
        clientName: 'REBORN SRL',
        clientCardCode: 'C-REBORN',
        lines: [line({ qtyOpen: 5 })],
      }),
      pedido({
        _fsId: 'p2',
        clientName: 'REBORN SRL',
        clientCardCode: 'C-REBORN',
        lines: [line({ qtyOpen: 3 })],
      }),
    ];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes).toHaveLength(1);
    expect(r.skus[0].clientes[0].qtyBackorder).toBe(8);
    expect(r.skus[0].clientes[0].pedidoIds).toHaveLength(2);
  });
});

describe('computeBackorderSkuMap — mode asignacion (Stock Asignado)', () => {
  it('ASIG con stock disponible → aparece', () => {
    const pedidos = [
      pedido({
        lines: [line({ state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(2) })],
      }),
    ];
    const deps = baseDeps({ getStockDisponibleVenta: () => 5 });
    const r = computeBackorderSkuMap(pedidos, 'asignacion', {}, deps);
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes[0].qtyAsignada).toBe(3);
    expect(r.skus[0].totalPendiente).toBe(3);
  });

  it('confirmed (v962) también entra a Stock Asignado', () => {
    const pedidos = [
      pedido({
        confirmedAt: daysAgo(2),
        lines: [line({ state: 'confirmed', qtyOpen: 4 })],
      }),
    ];
    const deps = baseDeps({ getStockDisponibleVenta: () => 10 });
    const r = computeBackorderSkuMap(pedidos, 'asignacion', {}, deps);
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes[0].qtyAsignada).toBe(4);
  });

  it('ASIG expirada (>15d) → excluida del modo asignacion', () => {
    const pedidos = [
      pedido({
        lines: [line({ state: 'ASIG', qtyOpen: 3, asigAt: daysAgo(20) })],
      }),
    ];
    const deps = baseDeps({ getStockDisponibleVenta: () => 5 });
    const r = computeBackorderSkuMap(pedidos, 'asignacion', {}, deps);
    expect(r.skus).toHaveLength(0);
  });

  it('ASIG con asigReserva=false vigente (v1072) → INCLUIDA en asignacion', () => {
    const pedidos = [
      pedido({
        lines: [line({ state: 'ASIG', qtyOpen: 2, asigReserva: false, asigAt: daysAgo(3) })],
      }),
    ];
    const deps = baseDeps({ getStockDisponibleVenta: () => 5 });
    const r = computeBackorderSkuMap(pedidos, 'asignacion', {}, deps);
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes[0].qtyAsignada).toBe(2);
  });

  it('ASIG con asigReserva=false y >15d → excluida incluso en asignacion', () => {
    const pedidos = [
      pedido({
        lines: [line({ state: 'ASIG', qtyOpen: 2, asigReserva: false, asigAt: daysAgo(20) })],
      }),
    ];
    const deps = baseDeps({ getStockDisponibleVenta: () => 5 });
    const r = computeBackorderSkuMap(pedidos, 'asignacion', {}, deps);
    expect(r.skus).toHaveLength(0);
  });

  it('FIFO cap: ASIG total > dispSap → excedente cae a qtyBackorder (invisible en modo ASIG)', () => {
    const pedidos = [
      pedido({
        _fsId: 'pA',
        clientName: 'CLIENTE A',
        clientCardCode: 'C-A',
        confirmedAt: daysAgo(5),
        lines: [line({ state: 'ASIG', qtyOpen: 10, asigAt: daysAgo(4) })],
      }),
      pedido({
        _fsId: 'pB',
        clientName: 'CLIENTE B',
        clientCardCode: 'C-B',
        confirmedAt: daysAgo(1),
        lines: [line({ state: 'ASIG', qtyOpen: 5, asigAt: daysAgo(1) })],
      }),
    ];
    // dispSap=7 → A (más viejo) toma 7, B queda con qtyAsignada=0 (invisible en modo asig).
    const deps = baseDeps({ getStockDisponibleVenta: () => 7 });
    const r = computeBackorderSkuMap(pedidos, 'asignacion', {}, deps);
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes).toHaveLength(1);
    expect(r.skus[0].clientes[0].nombre).toBe('CLIENTE A');
    expect(r.skus[0].clientes[0].qtyAsignada).toBe(7);
  });
});

describe('computeBackorderSkuMap — filtros', () => {
  const pedidos = [
    pedido({
      _fsId: 'pA',
      clientName: 'CLIENTE A',
      ownerVendor: 'GONZALO DE LA ROSA',
      confirmedAt: '2026-09-15T10:00:00Z',
      createdAt: daysAgo(3),
      lines: [line({ code: 'SKU1', qtyOpen: 2 })],
    }),
    pedido({
      _fsId: 'pB',
      clientName: 'CLIENTE B',
      ownerVendor: 'MAURICIO GIL',
      confirmedAt: '2026-08-20T10:00:00Z',
      createdAt: daysAgo(3),
      lines: [line({ code: 'SKU2', qtyOpen: 3 })],
    }),
  ];

  it('filter vendorKey exacto → solo pedidos de ese vendor', () => {
    const r = computeBackorderSkuMap(
      pedidos,
      'urgente',
      { vendorKey: 'GONZALO DE LA ROSA' },
      baseDeps()
    );
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].sku).toBe('SKU1');
  });

  it('filter mesYYYYMM → solo pedidos de ese mes', () => {
    const r = computeBackorderSkuMap(pedidos, 'urgente', { mesYYYYMM: '2026-08' }, baseDeps());
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].sku).toBe('SKU2');
  });

  it('filter tiendaQuery matchea SKU / producto / cliente', () => {
    const r1 = computeBackorderSkuMap(pedidos, 'urgente', { tiendaQuery: 'sku1' }, baseDeps());
    expect(r1.skus).toHaveLength(1);
    const r2 = computeBackorderSkuMap(pedidos, 'urgente', { tiendaQuery: 'cliente b' }, baseDeps());
    expect(r2.skus).toHaveLength(1);
    expect(r2.skus[0].sku).toBe('SKU2');
  });

  it('filter urgencyFilter=urgente en mode urgente → solo dispSap=0', () => {
    // pA: dispSap=5 (parcial), pB: dispSap=0 (urgente)
    const deps = baseDeps({
      getStockDisponibleVenta: (sku) => (sku === 'SKU1' ? 5 : 0),
    });
    const r = computeBackorderSkuMap(pedidos, 'urgente', { urgencyFilter: 'urgente' }, deps);
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].sku).toBe('SKU2');
  });

  it('canonVendor alias (PACHI → SANTIAGO ESTEBAN)', () => {
    const canonPachi = (t) => {
      const u = String(t || '')
        .trim()
        .toUpperCase();
      if (u === 'PACHI') return 'SANTIAGO ESTEBAN';
      return u;
    };
    const pedidosPachi = [pedido({ ownerVendor: 'PACHI', lines: [line({ qtyOpen: 2 })] })];
    const r = computeBackorderSkuMap(
      pedidosPachi,
      'urgente',
      { vendorKey: 'SANTIAGO ESTEBAN' },
      baseDeps({ canonVendor: canonPachi })
    );
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes[0].vendorKey).toBe('SANTIAGO ESTEBAN');
  });
});

describe('computeBackorderSkuMap — edge cases', () => {
  it('pedidos vacío → resultado vacío', () => {
    const r = computeBackorderSkuMap([], 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(0);
    expect(r.totalUnidades).toBe(0);
    expect(r.totalClientes).toBe(0);
  });

  it('línea con qtyOpen=0 → excluida', () => {
    const pedidos = [pedido({ lines: [line({ qtyOpen: 0 })] })];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(0);
  });

  it('línea con state=cancelled → excluida', () => {
    const pedidos = [pedido({ lines: [line({ state: 'cancelled', qtyOpen: 5 })] })];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(0);
  });

  it('SKU count coincide con clientes distintos (Set por cardCode/nombre)', () => {
    const pedidos = [
      pedido({
        _fsId: 'p1',
        clientName: 'A',
        clientCardCode: 'CA',
        lines: [line({ code: 'SKU1', qtyOpen: 2 })],
      }),
      pedido({
        _fsId: 'p2',
        clientName: 'B',
        clientCardCode: 'CB',
        lines: [line({ code: 'SKU1', qtyOpen: 2 })],
      }),
      pedido({
        _fsId: 'p3',
        clientName: 'A',
        clientCardCode: 'CA',
        lines: [line({ code: 'SKU2', qtyOpen: 2 })],
      }),
    ];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(2);
    expect(r.totalClientes).toBe(2); // A y B distintos
  });

  it('ordena SKUs por totalPendiente DESC', () => {
    const pedidos = [
      pedido({ _fsId: 'p1', clientName: 'A', lines: [line({ code: 'SKU_LOW', qtyOpen: 1 })] }),
      pedido({ _fsId: 'p2', clientName: 'B', lines: [line({ code: 'SKU_HIGH', qtyOpen: 10 })] }),
    ];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus[0].sku).toBe('SKU_HIGH');
    expect(r.skus[1].sku).toBe('SKU_LOW');
  });
});

// Fix auditor 2026-10-02 (bug C2): asigAt/confirmedAt como Firestore Timestamp
// rompian el check `isAsigSinReservaVigente` (NaN) y el sqDocDate ("[object O").
describe('computeBackorderSkuMap — fix auditor 2026-10-02 Timestamp handling', () => {
  const tsToMillis = (ms) => ({ toMillis: () => ms });

  it('C2: ASIG con asigReserva=false + asigAt Timestamp FRESCA -> aparece en modo asignacion (v1072)', () => {
    const asigAtFresh = NOW_MS - 3 * DAY_MS;
    const pedidos = [
      pedido({
        confirmedAt: tsToMillis(NOW_MS - 2 * DAY_MS),
        createdAt: tsToMillis(NOW_MS - 3 * DAY_MS),
        lines: [
          line({
            state: 'ASIG',
            qtyOpen: 2,
            asigReserva: false,
            asigAt: tsToMillis(asigAtFresh),
          }),
        ],
      }),
    ];
    const deps = baseDeps({ getStockDisponibleVenta: () => 5 });
    const r = computeBackorderSkuMap(pedidos, 'asignacion', {}, deps);
    // Pre-fix: new Date(timestampObj).getTime() -> NaN, isAsigSinReservaVigente
    // devolvia false -> la linea quedaba descartada. Post-fix aparece.
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes[0].qtyAsignada).toBe(2);
  });

  it('C2: ASIG con asigReserva=0 (entero) + asigAt Timestamp fresca -> aparece en modo asignacion', () => {
    const asigAtFresh = NOW_MS - 3 * DAY_MS;
    const pedidos = [
      pedido({
        confirmedAt: tsToMillis(NOW_MS - 2 * DAY_MS),
        createdAt: tsToMillis(NOW_MS - 3 * DAY_MS),
        lines: [
          line({
            state: 'ASIG',
            qtyOpen: 2,
            asigReserva: 0, // entero 0, equivalente a false
            asigAt: tsToMillis(asigAtFresh),
          }),
        ],
      }),
    ];
    const deps = baseDeps({ getStockDisponibleVenta: () => 5 });
    const r = computeBackorderSkuMap(pedidos, 'asignacion', {}, deps);
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes[0].qtyAsignada).toBe(2);
  });

  it('C2: sqDocDate normalizado a YYYY-MM-DD cuando confirmedAt es Timestamp (no "[object O")', () => {
    // Pre-fix: String(timestampObj).slice(0,10) === "[object O" -> sort rompia
    // y filtro mesYYYYMM no matcheaba. Post-fix sqDocDate = "YYYY-MM-DD" real.
    const confirmedAtMs = new Date('2026-09-15T10:00:00Z').getTime();
    const pedidos = [
      pedido({
        confirmedAt: tsToMillis(confirmedAtMs),
        createdAt: tsToMillis(NOW_MS - 3 * DAY_MS),
        lines: [line({ qtyOpen: 2 })],
      }),
    ];
    const r = computeBackorderSkuMap(pedidos, 'urgente', {}, baseDeps());
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].clientes[0].sqDocDate).toBe('2026-09-15');
  });

  it('C2: filtro mesYYYYMM funciona con confirmedAt Timestamp (antes rompia)', () => {
    const confAt1 = new Date('2026-09-15T10:00:00Z').getTime();
    const confAt2 = new Date('2026-08-20T10:00:00Z').getTime();
    const pedidos = [
      pedido({
        _fsId: 'pA',
        clientName: 'CLIENTE A',
        confirmedAt: tsToMillis(confAt1),
        createdAt: tsToMillis(NOW_MS - 3 * DAY_MS),
        lines: [line({ code: 'SKU1', qtyOpen: 2 })],
      }),
      pedido({
        _fsId: 'pB',
        clientName: 'CLIENTE B',
        confirmedAt: tsToMillis(confAt2),
        createdAt: tsToMillis(NOW_MS - 3 * DAY_MS),
        lines: [line({ code: 'SKU2', qtyOpen: 3 })],
      }),
    ];
    const r = computeBackorderSkuMap(pedidos, 'urgente', { mesYYYYMM: '2026-08' }, baseDeps());
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].sku).toBe('SKU2');
  });
});

describe('computeBackorderSkuMap — aggregationMode strict (alineado tablero PBI)', () => {
  it('strict + dispSap=0 + state=BO → qtyBackorder=pendiente, urgency=urgente', () => {
    const pedidos = [pedido({ lines: [line({ qtyOpen: 100, state: 'BO' })] })];
    const r = computeBackorderSkuMap(
      pedidos,
      'urgente',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 0 })
    );
    expect(r.skus).toHaveLength(1);
    expect(r.skus[0].urgency).toBe('urgente');
    expect(r.skus[0].clientes[0].qtyBackorder).toBe(100);
    expect(r.totalUnidades).toBe(100);
  });

  it('strict + dispSap=3 + pendiente=100 → NO backorder (dispSap>0 cubre todo bina­rio)', () => {
    const pedidos = [pedido({ lines: [line({ qtyOpen: 100, state: 'BO' })] })];
    const r = computeBackorderSkuMap(
      pedidos,
      'urgente',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 3 })
    );
    // Binario: cualquier stock > 0 excluye el SKU del backorder.
    expect(r.totalUnidades).toBe(0);
    expect(r.skus).toHaveLength(0);
  });

  it('strict + mode=asignacion + dispSap>0 + state=ASIG → cuenta como asignado', () => {
    const pedidos = [pedido({ lines: [line({ qtyOpen: 50, state: 'ASIG' })] })];
    const r = computeBackorderSkuMap(
      pedidos,
      'asignacion',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 100 })
    );
    expect(r.totalUnidades).toBe(50);
    expect(r.skus[0].clientes[0].qtyAsignada).toBe(50);
  });

  it('strict + mode=asignacion + dispSap=0 + state=ASIG → DESAPARECE del total', () => {
    // Caso crítico del diagnóstico: PBI dice "si stock=0, el ASIG no cuenta".
    const pedidos = [pedido({ lines: [line({ qtyOpen: 50, state: 'ASIG' })] })];
    const r = computeBackorderSkuMap(
      pedidos,
      'asignacion',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 0 })
    );
    expect(r.totalUnidades).toBe(0);
    expect(r.skus).toHaveLength(0);
  });

  it('strict NO modifica el default (fifo): mismo pedido en ambos modos da resultados distintos', () => {
    const pedidos = [pedido({ lines: [line({ qtyOpen: 100, state: 'BO' })] })];
    const deps = baseDeps({ getStockDisponibleVenta: () => 30 });
    const rFifo = computeBackorderSkuMap(pedidos, 'urgente', {}, deps);
    const rStrict = computeBackorderSkuMap(pedidos, 'urgente', { aggregationMode: 'strict' }, deps);
    // FIFO: 100-30=70 unidades de backorder; urgency=parcial.
    expect(rFifo.totalUnidades).toBe(70);
    expect(rFifo.skus[0].urgency).toBe('parcial');
    // Strict: dispSap=30>0 → cero backorder.
    expect(rStrict.totalUnidades).toBe(0);
  });
});

describe('computeBackorderSkuMap — v1137: strict incluye migrados SAP + sin TTL', () => {
  it('strict + pedido con stage=null pero transferidoSAP → se incluye', () => {
    const pedidos = [
      pedido({
        _fsId: 'migrated-1',
        stage: null, // migrado desde SAP 2026-08-28, sin stage
        transferidoSAP: { docNum: 25753, via: 'sap_migration_2026-08-28' },
        clientName: 'WEEKEND OUTDOOR',
        lines: [line({ state: 'ASIG', qtyOpen: 6, asigReserva: false, asigAt: daysAgo(2) })],
      }),
    ];
    const r = computeBackorderSkuMap(
      pedidos,
      'asignacion',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 100 })
    );
    expect(r.totalUnidades).toBe(6);
    expect(r.skus[0].clientes[0].nombre).toBe('WEEKEND OUTDOOR');
  });

  it('fifo (default) + pedido con stage=null + transferidoSAP → se EXCLUYE (preservado)', () => {
    const pedidos = [
      pedido({
        stage: null,
        transferidoSAP: { docNum: 25753 },
        lines: [line({ state: 'ASIG', qtyOpen: 6, asigReserva: false, asigAt: daysAgo(2) })],
      }),
    ];
    const r = computeBackorderSkuMap(
      pedidos,
      'asignacion',
      {},
      baseDeps({ getStockDisponibleVenta: () => 100 })
    );
    expect(r.totalUnidades).toBe(0);
  });

  it('strict + BO línea >15d → se incluye (sin TTL)', () => {
    const pedidos = [
      pedido({
        stage: 'confirmed',
        createdAt: daysAgo(20), // supera TTL 15d
        lines: [line({ state: 'BO', qtyOpen: 10 })],
      }),
    ];
    const r = computeBackorderSkuMap(
      pedidos,
      'urgente',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 0 })
    );
    expect(r.totalUnidades).toBe(10);
  });

  it('fifo (default) + BO línea >15d → se EXCLUYE por TTL (preservado)', () => {
    const pedidos = [
      pedido({
        stage: 'confirmed',
        createdAt: daysAgo(20),
        lines: [line({ state: 'BO', qtyOpen: 10 })],
      }),
    ];
    const r = computeBackorderSkuMap(
      pedidos,
      'urgente',
      {},
      baseDeps({ getStockDisponibleVenta: () => 0 })
    );
    expect(r.totalUnidades).toBe(0);
  });
});

describe('computeBackorderSkuMap — v1185: strict incluye pedidos pending con lineas que reservan', () => {
  // Incident 2026-10-07 pedido PESCAR.INFO SHOP SRL ANT101XGB:
  // modal Pedido en Espera decia RESERVADAS=1 (via getStockDesglose que itera
  // TODAS las lineas sin filtrar por stage) pero Stock Asignado decia "0 clientes"
  // porque computeBackorderSkuMap filtraba p.stage !== 'confirmed'.
  // Fix: strict mode acepta cualquier stage; filtro de linea decide.
  it('strict + pedido stage=pending + line state=confirmed → SE INCLUYE', () => {
    const pedidos = [
      pedido({
        stage: 'pending',
        clientName: 'PESCAR.INFO SHOP SRL',
        lines: [line({ state: 'confirmed', qtyOpen: 1 })],
      }),
    ];
    const r = computeBackorderSkuMap(
      pedidos,
      'asignacion',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 1 })
    );
    expect(r.totalUnidades).toBe(1);
    expect(r.skus[0].clientes[0].nombre).toBe('PESCAR.INFO SHOP SRL');
  });

  it('strict + pedido stage=pending + line state=ASIG → SE INCLUYE', () => {
    const pedidos = [
      pedido({
        stage: 'pending',
        lines: [line({ state: 'ASIG', qtyOpen: 2 })],
      }),
    ];
    const r = computeBackorderSkuMap(
      pedidos,
      'asignacion',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 5 })
    );
    expect(r.totalUnidades).toBe(2);
  });

  it('fifo (default) + pedido stage=pending → sigue EXCLUIDO (preservado backward compat)', () => {
    const pedidos = [
      pedido({
        stage: 'pending',
        lines: [line({ state: 'confirmed', qtyOpen: 1 })],
      }),
    ];
    const r = computeBackorderSkuMap(
      pedidos,
      'asignacion',
      {},
      baseDeps({ getStockDisponibleVenta: () => 1 })
    );
    expect(r.totalUnidades).toBe(0);
  });

  it('strict + pedido stage=pending + line state=cancelled → NO se incluye (filtro linea)', () => {
    const pedidos = [
      pedido({
        stage: 'pending',
        lines: [line({ state: 'cancelled', qtyOpen: 1 })],
      }),
    ];
    const r = computeBackorderSkuMap(
      pedidos,
      'asignacion',
      { aggregationMode: 'strict' },
      baseDeps({ getStockDisponibleVenta: () => 1 })
    );
    expect(r.totalUnidades).toBe(0);
  });
});
