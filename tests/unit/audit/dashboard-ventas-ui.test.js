// @ts-check
/**
 * Dashboard de Ventas (2026-10-29) — contrato de la pantalla.
 *
 * - Chunk lazy registrado en los 3 lugares con la misma lista (§18).
 * - Modal en el bloque CSS §49 (altura fija + scroll interno).
 * - Botón de entrada visible para vendedor (no lo oculta applyRolePermissions).
 * - Textos exactos de tarjetas, leyenda, títulos y "Ver más".
 * - Chart.js versión fija desde cdnjs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const BUILD_JS = readFileSync('build.js', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');
const SW_JS = readFileSync('sw.js', 'utf8');
const CHUNK_PATH = 'src/domains/dashboard-ventas.js';
const CHUNK = existsSync(CHUNK_PATH) ? readFileSync(CHUNK_PATH, 'utf8') : '';
const UI_TEXT = CHUNK + '\n' + INDEX_HTML;

const EXPORTS = ['openDashboardVentas', 'closeDashboardVentas'];

function parseList(src) {
  return Array.from(src.matchAll(/'([A-Za-z0-9_]+)'/g)).map((m) => m[1]);
}

describe('Dashboard de Ventas — chunk lazy en los 3 lugares (§18)', () => {
  it('existe src/domains/dashboard-ventas.js', () => {
    expect(existsSync(CHUNK_PATH)).toBe(true);
  });

  it('build.js LAZY_CHUNKS tiene dashboard-ventas con la lista exacta', () => {
    const m = BUILD_JS.match(/'dashboard-ventas':\s*\[([^\]]*)\]/);
    expect(m, 'entrada dashboard-ventas en build.js').toBeTruthy();
    expect(parseList(m[1])).toEqual(EXPORTS);
  });

  it('src/main.js installChunkStubs con la misma lista', () => {
    const m = MAIN_JS.match(/installChunkStubs\('dashboard-ventas',\s*\[([^\]]*)\]\)/);
    expect(m, 'installChunkStubs dashboard-ventas en main.js').toBeTruthy();
    expect(parseList(m[1])).toEqual(EXPORTS);
  });

  it('sw.js cachea ./chunks/dashboard-ventas.js', () => {
    expect(SW_JS).toContain("'./chunks/dashboard-ventas.js'");
  });

  it('el chunk define los exports en window', () => {
    for (const name of EXPORTS) {
      expect(CHUNK).toMatch(new RegExp('window\\.' + name + '\\s*='));
    }
  });
});

describe('Dashboard de Ventas — modal §49', () => {
  it('index.html tiene #dashboard-ventas-modal', () => {
    expect(INDEX_HTML).toMatch(/id="dashboard-ventas-modal"/);
  });

  it('el selector está en el bloque CSS §49 (height + max-height 90vh)', () => {
    const block = INDEX_HTML.match(
      /#crear-pedido-st-modal \.modal-box,[\s\S]*?\{[^}]*max-height:\s*90vh\s*!important/
    );
    expect(block, 'bloque §49').toBeTruthy();
    expect(block[0]).toMatch(/#dashboard-ventas-modal \.modal-box/);
  });
});

describe('Dashboard de Ventas — botón visible para vendedor', () => {
  it('existe #dashboard-ventas-btn junto a #dashboard-btn y no arranca oculto', () => {
    const m = INDEX_HTML.match(/<button[^>]*id="dashboard-ventas-btn"[^>]*>/);
    expect(m, 'botón dashboard-ventas-btn').toBeTruthy();
    expect(m[0]).not.toMatch(/display:\s*none/);
    expect(m[0]).toMatch(/openDashboardVentas\(\)/);
    const iDash = INDEX_HTML.indexOf('id="dashboard-btn"');
    const iVentas = INDEX_HTML.indexOf('id="dashboard-ventas-btn"');
    expect(Math.abs(iVentas - iDash)).toBeLessThan(600);
  });

  it('ningún código oculta #dashboard-ventas-btn por rol', () => {
    const hides = INDEX_HTML.match(
      /getElementById\('dashboard-ventas-btn'\)[\s\S]{0,200}?display\s*=\s*[^;]*'none'/
    );
    expect(hides).toBeNull();
  });
});

describe('Dashboard de Ventas — textos exactos', () => {
  const textos = [
    'Facturado mensual',
    'Valorización backorder',
    'Cant. de pedidos del mes',
    'Cant. pedidos únicos',
    'Montos sin IVA, con descuento aplicado y notas de crédito restadas.',
    'Top 20 SKU - Unidades',
    'Top 20 SKU - Dinero',
    'Evolución de ventas',
    'Evolución del backorder - Unidades',
    'Evolución del backorder - Dinero',
    'Ver más',
    'No hay ventas con esos filtros.',
    'Cargando…',
  ];
  for (const t of textos) {
    it('aparece "' + t + '"', () => {
      expect(UI_TEXT).toContain(t);
    });
  }

  it('error usa formatMensajeConCodigo(DASHBOARD_VENTAS_FAILED)', () => {
    expect(CHUNK).toMatch(/formatMensajeConCodigo\('DASHBOARD_VENTAS_FAILED'\)/);
  });

  it('dataUpdatedAt se etiqueta "Calculado", nunca "datos al"', () => {
    expect(CHUNK).toContain('Calculado ');
    expect(CHUNK.toLowerCase()).not.toContain('datos al');
  });
});

describe('Dashboard de Ventas — Chart.js y back order estimado', () => {
  it('carga Chart.js 4.4.1 desde cdnjs', () => {
    expect(CHUNK).toContain(
      'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
    );
  });

  it('dataset estimado punteado + spanGaps false + leyenda "estimado"', () => {
    expect(CHUNK).toMatch(/borderDash:\s*\[6,\s*4\]/);
    expect(CHUNK).toMatch(/spanGaps:\s*false/);
    expect(CHUNK).toContain("'estimado'");
  });

  it('llama a la callable dashboardVentasCF en southamerica-east1', () => {
    expect(CHUNK).toContain("httpsCallable('dashboardVentasCF')");
    expect(CHUNK).toContain("'southamerica-east1'");
  });

  it('destruye charts previos antes de re-renderizar', () => {
    expect(CHUNK).toMatch(/\.destroy\(\)/);
  });
});

describe('Dashboard de Ventas — Top 20', () => {
  it('las barras del Top filtran valor > 0 antes de cortar a 20', () => {
    expect(CHUNK).toMatch(
      /\.filter\(\(r\) => \(Number\(r\[field\]\) \|\| 0\) > 0\)\.slice\(0, TOP_N\)/
    );
  });
});

describe('Dashboard de Ventas — gestión e interacciones', () => {
  // Los helpers viven dentro del chunk (no se exportan): se evalúan desde el fuente.
  function fn(name) {
    const m = CHUNK.match(new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
    expect(m, 'función ' + name).toBeTruthy();
    return m[0];
  }
  const nombres = [
    '_escHtml',
    '_fmtArs',
    '_fmtUds',
    '_fmtPct',
    '_fmtFecha',
    '_tipoLabel',
    '_card',
    '_interaccionesTabla',
    '_interaccionesSection',
    '_gestionSection',
  ];
  const fabrica = new Function(
    nombres.map(fn).join('\n') + '\nreturn { _gestionSection, _interaccionesSection };'
  );
  const { _gestionSection, _interaccionesSection } = fabrica();

  const g = {
    target: 1000000,
    cumplimientoPct: 80.5,
    rendicionesArs: 500,
    baseActiva: 12,
    ticketPromedio: 250,
    visitas: 3,
    contactados: 4,
    interacciones: 7,
    tablaInteracciones: {
      rows: [{ cliente: 'ACME', fecha: '2026-10-05', vendedor: 'PACHI', tipo: 'visita' }],
      total: 1,
    },
    filtrosNoAplican: false,
  };

  it('ids y textos del contrato', () => {
    expect(CHUNK).toContain('dv-gestion');
    expect(CHUNK).toContain('dv-interacciones');
    expect(CHUNK).toContain('dv-interacciones-buscar');
    expect(CHUNK).toContain('Sin target');
    expect(CHUNK).toContain('No disponible');
    expect(CHUNK).toContain('Mostrando ');
  });

  it('tarjetas en orden, % con coma y fecha DD/MM/AAAA', () => {
    const h = _gestionSection(g, {});
    const orden = [
      'Target',
      '% cumplimiento',
      'Rendiciones – monto',
      'Base activa',
      'Ticket promedio',
      'N° visitas',
      'N° contactados',
      'N° interacciones',
    ].map((t) => h.indexOf('>' + t + '<'));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(h).toContain('80,5%');
    expect(h).toContain('05/10/2026');
    expect(h).not.toContain('Mostrando ');
    expect(h).not.toContain('no se filtran');
  });

  it('target null -> "Sin target"', () => {
    const h = _gestionSection({ ...g, target: null, cumplimientoPct: null }, {});
    expect(h).toContain('Sin target');
  });

  it('gestion null o con error -> "No disponible"', () => {
    expect(_gestionSection(null, {})).toContain('No disponible');
    expect(_gestionSection(g, { gestion: { error: true } })).toContain('No disponible');
    expect(_gestionSection(null, {})).not.toContain('dv-interacciones');
  });

  it('filtrosNoAplican muestra la nota', () => {
    const h = _gestionSection({ ...g, filtrosNoAplican: true }, {});
    expect(h).toContain(
      'Target y rendiciones no se filtran por cliente ni producto; visitas y contactos no se filtran por producto.'
    );
  });

  it('total > rows -> "Mostrando N de M"', () => {
    const h = _interaccionesSection({ rows: g.tablaInteracciones.rows, total: 800 });
    expect(h).toContain('Mostrando 1 de 800');
  });

  it('escapa el cliente (sin <img)', () => {
    const h = _interaccionesSection({
      rows: [{ cliente: '<img src=x>', fecha: '2026-10-05', vendedor: 'V', tipo: 'contacto' }],
      total: 1,
    });
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
  });

  it('el buscador filtra y el texto buscado nunca va al HTML', () => {
    const h = _interaccionesSection(
      {
        rows: [
          { cliente: 'ACME', fecha: '2026-10-05', vendedor: 'V', tipo: 'visita' },
          { cliente: 'OTRO', fecha: '2026-10-06', vendedor: 'V', tipo: 'visita' },
        ],
        total: 2,
      },
      '<b>acme'
    );
    expect(h).not.toContain('<b>acme');
    const h2 = _interaccionesSection(
      {
        rows: [
          { cliente: 'ACME', fecha: '2026-10-05', vendedor: 'V', tipo: 'visita' },
          { cliente: 'OTRO', fecha: '2026-10-06', vendedor: 'V', tipo: 'visita' },
        ],
        total: 2,
      },
      'acme'
    );
    expect(h2).toContain('ACME');
    expect(h2).not.toContain('OTRO');
  });

  it('scroll interno con max-height + overflow-y (§49)', () => {
    expect(INDEX_HTML).toMatch(/\.dv-inter-wrap\{max-height:\d+px;overflow-y:auto\}/);
  });
});

describe('Dashboard de Ventas — productos, cobertura y clientes (entrega B)', () => {
  function fn(name) {
    const m = CHUNK.match(new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
    expect(m, 'función ' + name).toBeTruthy();
    return m[0];
  }
  const nombres = [
    '_escHtml',
    '_fmtArs',
    '_fmtUds',
    '_stockColumnasCalc',
    '_stockColumnas',
    '_fmtStockCol',
    '_coberturaEtiqueta',
    '_productosTabla',
    '_noDisponible',
    '_productosSection',
    '_coberturaSection',
    '_tipoVerMas',
    '_verMasTabla',
  ];
  const fabrica = new Function(
    'state',
    'const PRODUCTOS_MAX_FILAS = 200; const _stockMemo = new Map();\n' +
      nombres.map(fn).join('\n') +
      '\nreturn { _stockMemo, _verMasTabla, _stockColumnas, _coberturaEtiqueta, _productosTabla, _productosSection, _coberturaSection };'
  );
  const vmState = { verMasQuery: { unidades: '', dinero: '', clientes: '' } };
  const api = fabrica(vmState);
  const prev = /** @type {any} */ (globalThis).window;
  const setWin = (w) => {
    api._stockMemo.clear();
    /** @type {any} */ (globalThis).window = w;
  };
  const restore = () => {
    /** @type {any} */ (globalThis).window = prev;
  };

  it('_stockColumnas con breakdown -> reservadas/libre/stock', () => {
    setWin({
      getStockDisponibleVenta: () => 5,
      getStockBreakdown: () => ({ reservadasTotal: 3, libre: 2, fisicoDep11: 5 }),
    });
    expect(api._stockColumnas('X')).toEqual({ reservadas: 3, libre: 2, stock: 5 });
    restore();
  });

  it('_stockColumnas sin breakdown o sin stock cargado -> nulls', () => {
    setWin({});
    const vacio = { reservadas: null, libre: null, stock: null };
    expect(api._stockColumnas('X')).toEqual(vacio);
    setWin({
      getStockDisponibleVenta: () => null,
      getStockBreakdown: () => ({ reservadasTotal: 3, libre: 2, fisicoDep11: 5 }),
    });
    expect(api._stockColumnas('X')).toEqual(vacio);
    restore();
  });

  it('etiqueta de cobertura con coma decimal y guion si no hay porcentaje', () => {
    expect(api._coberturaEtiqueta({ compraron: 36, dadosAlta: 66, pct: 54.55 })).toBe(
      '36 de 66 · 54,55%'
    );
    expect(api._coberturaEtiqueta({ compraron: 36, dadosAlta: 0, pct: null })).toBe('36 de 0 · —');
  });

  const prod = [
    {
      categoria: 'CAÑAS',
      familia: 'ALIVIO',
      sku: 'ALV1',
      udsVendidas: 4,
      facturado: 1000,
      udsBackorder: 2,
    },
    {
      categoria: 'REELS',
      familia: 'STELLA',
      sku: 'STL<b>',
      udsVendidas: 1,
      facturado: 5,
      udsBackorder: 0,
    },
  ];

  it('tabla de productos: headers exactos en orden y "…" sin stock', () => {
    setWin({});
    const h = api._productosTabla(prod, '');
    const heads = [
      'CATEGORIA',
      'FAMILIA',
      'SKU',
      'UNIDADES VENDIDAS',
      'FACTURADO',
      'UNIDADES BACKORDER',
      'UNIDADES RESERVADAS',
      'UNIDADES LIBRE PARA LA VENTA',
      'UNIDADES EN STOCK',
    ];
    const ths = Array.from(h.matchAll(/<th[^>]*>([^<]*)<\/th>/g)).map((m) => m[1]);
    expect(ths).toEqual(heads);
    expect(h).toContain('…');
    expect(h).not.toContain('STL<b>');
    expect(h).toContain('STL&lt;b&gt;');
    restore();
  });

  it('el buscador filtra por categoría/familia/SKU', () => {
    setWin({});
    const h = api._productosTabla(prod, 'stella');
    expect(h).toContain('REELS');
    expect(h).not.toContain('CAÑAS');
    restore();
  });

  it('productos null o con error -> "No disponible"; cobertura y ids', () => {
    expect(api._productosSection(null, {}, '')).toContain('No disponible');
    expect(api._productosSection(prod, { productos: { error: true } }, '')).toContain(
      'No disponible'
    );
    expect(api._productosSection(prod, {}, '')).toContain('id="dv-productos"');
    expect(api._coberturaSection(null, {})).toContain('No disponible');
    expect(
      api._coberturaSection([{ vendedor: 'A', dadosAlta: 1, compraron: 1, pct: 100 }], {})
    ).toContain('id="dv-cobertura-chart"');
    expect(CHUNK).toContain('dv-clientes-chart');
  });

  it('"Ver más" admite solo tipos de la lista blanca', () => {
    expect(CHUNK).toMatch(/function _tipoVerMas\(/);
    expect(CHUNK).not.toMatch(/state\.verMasQuery\[vmAttr\]/);
  });

  const muchos = Array.from({ length: 250 }, (_, i) => ({
    categoria: 'C',
    familia: 'F',
    sku: 'SKU' + i,
    udsVendidas: 1,
    facturado: 1,
    udsBackorder: 0,
  }));

  it('tope de 200 filas con nota cuando hay más', () => {
    setWin({});
    const h = api._productosTabla(muchos, '');
    expect((h.match(/<tr><td>/g) || []).length).toBe(200);
    expect(h).toContain('Mostrando 200 de 250. Usá el buscador para ver el resto.');
    expect(api._productosTabla(prod, '')).not.toContain('Mostrando 200');
    restore();
  });

  it('memo: getStockBreakdown se llama una vez por SKU entre dos renders', () => {
    let calls = 0;
    api._stockMemo.clear();
    setWin({
      getStockDisponibleVenta: () => 5,
      getStockBreakdown: () => {
        calls++;
        return { reservadasTotal: 1, libre: 1, fisicoDep11: 2 };
      },
    });
    api._productosTabla(prod, '');
    api._productosTabla(prod, 'alv');
    expect(calls).toBe(2);
    api._stockMemo.clear();
    restore();
  });

  it('el buscador de productos tiene debounce de 200 ms y renderResults limpia el memo', () => {
    expect(CHUNK).toMatch(/PRODUCTOS_DEBOUNCE_MS = 200/);
    expect(CHUNK).toMatch(/setTimeout\([\s\S]{0,300}PRODUCTOS_DEBOUNCE_MS\)/);
    expect(CHUNK).toMatch(/function renderResults\(\) \{\n  _stockMemo\.clear\(\);/);
  });

  it('Ver más de clientes filtra por nombre y por código', () => {
    const rows = [
      { code: 'C100', nombre: 'ACME SA', facturado: 10 },
      { code: 'C200', nombre: 'OTRO SRL', facturado: 5 },
    ];
    vmState.verMasQuery.clientes = 'acme';
    let h = api._verMasTabla('clientes', rows);
    expect(h).toContain('ACME SA');
    expect(h).not.toContain('OTRO SRL');
    vmState.verMasQuery.clientes = 'c200';
    h = api._verMasTabla('clientes', rows);
    expect(h).toContain('OTRO SRL');
    expect(h).not.toContain('ACME SA');
    vmState.verMasQuery.clientes = '';
  });
});
