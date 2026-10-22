// @ts-check
/**
 * v1409 §47 — paridad entre modal "Stock Asignado" (principal) y "Crear Pedido
 * Desde Stock Asignado" (CPST). Ambas pantallas deben listar los MISMOS
 * clientes con las MISMAS unidades para los mismos SKUs.
 *
 * Reporte Mariano: BROBRO SA aparece en Stock Asignado con 51 SKUs/99 u pero
 * NO en CPST. Causa raíz: `_cpstBuildCache` filtraba `p.stage==='confirmed'`
 * mientras el modal principal (fix v1344 en src/pure/backorder-sku-map.js:284-291)
 * incluye pedidos sync-SAP con `stage=undefined` + líneas ASIG `asigFromReparto=true`.
 *
 * El filtro se simula aplicando la misma lógica que el fix de index.html:16837-16858.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeBackorderSkuMap } from '../../../src/pure/backorder-sku-map.js';
import { lineReservesStock } from '../../../src/pure/stock-realmente-disponible.js';

const NOW = Date.parse('2026-10-22T12:00:00Z');

/**
 * Replica del filtro de _cpstBuildCache post-v1409 (sin el DOM).
 * Devuelve `{clientes: {nombre: {totalU, skus: [...]}}}` idéntico shape.
 */
function cpstBuildCachePure(pedidos, now) {
  const mapRaw = {};
  for (const p of pedidos) {
    if (!p || p.closedAt || !Array.isArray(p.lines)) continue;
    if (p.stage !== 'confirmed') {
      const hasRepartoAsig = p.lines.some(
        (l) => l && l.state === 'ASIG' && l.asigFromReparto && Number(l.qtyOpen) > 0
      );
      if (!hasRepartoAsig) continue;
    }
    const nombre = String(p.clientName || '').trim();
    if (!nombre) continue;
    for (let idx = 0; idx < p.lines.length; idx++) {
      const l = p.lines[idx];
      if (!l || l.state !== 'ASIG') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      if (!lineReservesStock(l, now, p)) continue;
      const skuUp = String(l.code || '')
        .trim()
        .toUpperCase();
      if (!skuUp) continue;
      if (!mapRaw[nombre]) {
        mapRaw[nombre] = { nombre, totalU: 0, skus: {} };
      }
      if (!mapRaw[nombre].skus[skuUp]) {
        mapRaw[nombre].skus[skuUp] = { sku: l.code, qty: 0, entries: [] };
      }
      mapRaw[nombre].skus[skuUp].qty += qo;
      mapRaw[nombre].skus[skuUp].entries.push({
        pedidoId: p._fsId,
        qty: qo,
        state: 'ASIG',
      });
      mapRaw[nombre].totalU += qo;
    }
  }
  return mapRaw;
}

/**
 * Simula el output del modal Stock Asignado principal: lista de clientes con
 * ASIG agregada por nombre. El modal real requiere `dispSap > 0` para mostrar
 * una ASIG (reparte stock entre las ASIG en modo FIFO). Pasamos stock > 0 por
 * default para que las ASIG aparezcan.
 */
function modalPrincipalPorCliente(pedidos, now, stockBySku) {
  const stockMap = stockBySku || {};
  const deps = {
    canonVendor: (v) =>
      String(v || '')
        .trim()
        .toUpperCase(),
    getStockDisponibleVenta: (sku) => {
      if (sku in stockMap) return stockMap[sku];
      return 1000; // default alto para que todas las ASIG aparezcan
    },
    now,
  };
  const result = computeBackorderSkuMap(pedidos, 'asignacion', { nowMs: now }, deps);
  /** @type {Record<string, {totalU: number, skus: Set<string>}>} */
  const porCliente = {};
  for (const sku of result.skus) {
    for (const c of sku.clientes) {
      const nombre = c.nombre || '';
      if (!nombre) continue;
      if (!porCliente[nombre]) {
        porCliente[nombre] = { totalU: 0, skus: new Set() };
      }
      porCliente[nombre].totalU += c.qtyAsignada || 0;
      porCliente[nombre].skus.add(sku.sku);
    }
  }
  return porCliente;
}

function makeBrobroPedido() {
  // v1344 scenario: pedido sync-SAP de BROBRO SA con stage=undefined +
  // ASIG asigFromReparto=true (Pablo asignó via modal Reparto post-sync).
  const asigAt = new Date(NOW - 24 * 3600 * 1000).toISOString(); // ayer
  return {
    _fsId: 'x347Ul5b9cRtVPjEEN4T',
    clientName: 'BROBRO SA',
    clientCardCode: 'C20300000888',
    stage: undefined,
    closedAt: null,
    transferidoSAP: { docNum: '25938' },
    confirmedAt: asigAt,
    lines: [
      {
        code: '21100100100E',
        qtyOpen: 2,
        state: 'ASIG',
        asigReserva: true,
        asigAt,
        asigFromReparto: true,
      },
      {
        code: '21100100150W',
        qtyOpen: 2,
        state: 'ASIG',
        asigReserva: true,
        asigAt,
        asigFromReparto: true,
      },
      {
        code: '21100100300W',
        qtyOpen: 2,
        state: 'ASIG',
        asigReserva: true,
        asigAt,
        asigFromReparto: true,
      },
    ],
  };
}

function makePedidoNormalConASIG(cardCode, nombre, sku, qty) {
  const asigAt = new Date(NOW - 2 * 3600 * 1000).toISOString(); // hace 2h
  return {
    _fsId: 'ped-' + cardCode,
    clientName: nombre,
    clientCardCode: cardCode,
    stage: 'confirmed',
    closedAt: null,
    confirmedAt: asigAt,
    lines: [{ code: sku, qtyOpen: qty, state: 'ASIG', asigReserva: true, asigAt }],
  };
}

function makePedidoBOConStock(cardCode, nombre, sku, qty) {
  const createdAt = new Date(NOW - 24 * 3600 * 1000).toISOString();
  return {
    _fsId: 'ped-bo-' + cardCode,
    clientName: nombre,
    clientCardCode: cardCode,
    stage: 'confirmed',
    closedAt: null,
    createdAt,
    lines: [{ code: sku, qtyOpen: qty, state: 'BO' }],
  };
}

describe('v1409 §47 — paridad CPST vs Stock Asignado principal', () => {
  it('BROBRO SA con stage=undefined + asigFromReparto aparece en AMBOS modales con las mismas unidades', () => {
    const pedidos = [makeBrobroPedido()];
    const cpst = cpstBuildCachePure(pedidos, NOW);
    const principal = modalPrincipalPorCliente(pedidos, NOW);

    expect(cpst['BROBRO SA']).toBeDefined();
    expect(cpst['BROBRO SA'].totalU).toBe(6); // 2+2+2
    expect(Object.keys(cpst['BROBRO SA'].skus)).toHaveLength(3);

    expect(principal['BROBRO SA']).toBeDefined();
    expect(principal['BROBRO SA'].totalU).toBe(6);
    expect(principal['BROBRO SA'].skus.size).toBe(3);

    // Paridad exacta.
    expect(cpst['BROBRO SA'].totalU).toBe(principal['BROBRO SA'].totalU);
  });

  it('cliente con ASIG real stage=confirmed aparece en AMBOS con mismas unidades', () => {
    const pedidos = [makePedidoNormalConASIG('C001', 'CLIENTE A', 'SKU1', 5)];
    const cpst = cpstBuildCachePure(pedidos, NOW);
    const principal = modalPrincipalPorCliente(pedidos, NOW);
    expect(cpst['CLIENTE A'].totalU).toBe(5);
    expect(principal['CLIENTE A'].totalU).toBe(5);
  });

  it('cliente con solo BO (sin ASIG) NO aparece en ninguno (va a Reparto)', () => {
    const pedidos = [makePedidoBOConStock('C002', 'CLIENTE B', 'SKU2', 3)];
    const cpst = cpstBuildCachePure(pedidos, NOW);
    // En modo asignacion, state=BO queda filtrado (línea 305 de backorder-sku-map).
    const principal = modalPrincipalPorCliente(pedidos, NOW, { SKU2: 10 });
    expect(cpst['CLIENTE B']).toBeUndefined();
    expect(principal['CLIENTE B']).toBeUndefined();
  });

  it('mezcla: ASIG real + BO con stock → solo ASIG en ambos, BO en Reparto', () => {
    const pedidos = [
      makePedidoNormalConASIG('C003', 'CLIENTE MIX', 'SKU-X', 4),
      makePedidoBOConStock('C004', 'CLIENTE SOLO BO', 'SKU-Y', 7),
    ];
    const cpst = cpstBuildCachePure(pedidos, NOW);
    const principal = modalPrincipalPorCliente(pedidos, NOW);
    expect(cpst['CLIENTE MIX'].totalU).toBe(4);
    expect(cpst['CLIENTE SOLO BO']).toBeUndefined();
    expect(principal['CLIENTE MIX'].totalU).toBe(4);
    expect(principal['CLIENTE SOLO BO']).toBeUndefined();
  });

  it('pedido ex-SAP stage=undefined SIN asigFromReparto NO entra (venta normal sin reparto)', () => {
    const pedido = {
      _fsId: 'ped-sap-sin-rep',
      clientName: 'CLIENTE SAP',
      stage: undefined,
      confirmedAt: new Date(NOW - 2 * 3600 * 1000).toISOString(),
      closedAt: null,
      lines: [
        {
          code: 'SKU-Z',
          qtyOpen: 3,
          state: 'ASIG',
          asigReserva: true,
          asigFromReparto: false, // ← diferencia
          asigAt: new Date(NOW - 2 * 3600 * 1000).toISOString(),
        },
      ],
    };
    const cpst = cpstBuildCachePure([pedido], NOW);
    expect(cpst['CLIENTE SAP']).toBeUndefined();
  });

  it('ASIG vencida (>7d) NO entra ni en CPST ni en el principal', () => {
    const oldAsigAt = new Date(NOW - 10 * 24 * 3600 * 1000).toISOString();
    const pedido = {
      _fsId: 'ped-vencido',
      clientName: 'CLIENTE VENCIDO',
      stage: 'confirmed',
      confirmedAt: oldAsigAt,
      closedAt: null,
      lines: [
        {
          code: 'SKU-OLD',
          qtyOpen: 2,
          state: 'ASIG',
          asigReserva: true,
          asigAt: oldAsigAt,
        },
      ],
    };
    const cpst = cpstBuildCachePure([pedido], NOW);
    const principal = modalPrincipalPorCliente([pedido], NOW);
    expect(cpst['CLIENTE VENCIDO']).toBeUndefined();
    expect(principal['CLIENTE VENCIDO']).toBeUndefined();
  });

  it('totales encabezado modal CPST salen del compute (clientes y unidades)', () => {
    const pedidos = [
      makeBrobroPedido(),
      makePedidoNormalConASIG('C-mauricio', 'CLIENTE_PARA_MAURICIO', 'SKU-A', 10),
      makePedidoBOConStock('C-solo-bo', 'CLIENTE_SOLO_BO', 'SKU-B', 5),
    ];
    const cpst = cpstBuildCachePure(pedidos, NOW);
    const totalClientes = Object.keys(cpst).length;
    const totalU = Object.values(cpst).reduce((s, c) => s + c.totalU, 0);
    expect(totalClientes).toBe(2); // BROBRO + CLIENTE_PARA_MAURICIO (solo BO excluido)
    expect(totalU).toBe(16); // 6 + 10
  });
});

describe('v1409 §47 — index.html _cpstBuildCache contiene el fix de stage', () => {
  const INDEX_HTML = readFileSync('index.html', 'utf8');
  const START = INDEX_HTML.indexOf('function _cpstBuildCache');
  const END = INDEX_HTML.indexOf('\nfunction ', START + 1);
  const CHUNK = INDEX_HTML.slice(START, END > 0 ? END : START + 10000);

  it('_cpstBuildCache acepta pedidos stage!=confirmed con asigFromReparto', () => {
    expect(CHUNK).toMatch(/asigFromReparto/);
    expect(CHUNK).toMatch(/_hasRepartoAsig/);
  });

  it('_cpstBuildCache aplica lineReservesStock para filtrar vencidas', () => {
    expect(CHUNK).toMatch(/lineReservesStock/);
  });

  it('_cpstBuildCache ya no tiene el filtro antiguo p.stage !== "confirmed" como gate hardcoded', () => {
    // El patrón `p.stage !== 'confirmed'` sigue existiendo (lo usamos para la
    // rama "pedido no-confirmed, chequear asigFromReparto") pero NO como un
    // `continue` incondicional en la primera guard clause.
    const oldPattern =
      /if\s*\(\s*!p\s*\|\|\s*p\.closedAt\s*\|\|\s*p\.stage\s*!==\s*['"]confirmed['"]\s*\|\|/;
    expect(CHUNK).not.toMatch(oldPattern);
  });
});
