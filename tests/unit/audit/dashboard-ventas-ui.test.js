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
