// @ts-check
/**
 * v1477 PR4 §75 — tests resolve-line-desc.
 * Fix "undefined" en Pedidos > Confirmados (ORDEN 502 OSVALDO MASERA et al).
 */
import { describe, expect, it } from 'vitest';
import {
  buildCatalogDescMapFromProducts,
  hasDesc,
  resolveLineDesc,
  resolveLineDescLive,
} from '../../src/pure/resolve-line-desc.js';

describe('v1477 §75 — resolveLineDesc', () => {
  it('T1 desc populated → se usa como es', () => {
    const line = { code: 'ABC', desc: 'Reel Stella 4000' };
    expect(resolveLineDesc(line, {})).toBe('Reel Stella 4000');
  });

  it('T2 desc vacío + catalog hit → desc del catalog', () => {
    const line = { code: 'ABC' };
    const catalog = { ABC: { descripcion: 'Caña Shimano Fx 6\'6"' } };
    expect(resolveLineDesc(line, catalog)).toBe('Caña Shimano Fx 6\'6"');
  });

  it('T3 desc vacío + catalog miss → string vacío (NUNCA undefined)', () => {
    const line = { code: 'INEXISTENTE' };
    expect(resolveLineDesc(line, {})).toBe('');
    expect(resolveLineDesc(line, null)).toBe('');
  });

  it('T4 line null/undefined → string vacío', () => {
    expect(resolveLineDesc(null, {})).toBe('');
    expect(resolveLineDesc(undefined, {})).toBe('');
  });

  it('T5 fixture REAL ORDEN 502: línea CPST sin desc + catalog', () => {
    const line = { code: 'SGS80MH2A', qty: 2, state: 'confirmed', origen: 'stock-asignado' };
    const catalog = { SGS80MH2A: { descripcion: 'Shimano Sellus 8\'0" MH 2 piezas' } };
    expect(resolveLineDesc(line, catalog)).toBe('Shimano Sellus 8\'0" MH 2 piezas');
  });

  it('T6 Map catalog funciona igual que plain object', () => {
    const line = { code: 'ABC' };
    const catalog = new Map([['ABC', { descripcion: 'test' }]]);
    expect(resolveLineDesc(line, catalog)).toBe('test');
  });

  it('T7 normaliza code (uppercase + trim) para lookup', () => {
    const line = { code: '  abc  ' };
    const catalog = { ABC: { descripcion: 'test' } };
    expect(resolveLineDesc(line, catalog)).toBe('test');
  });

  it('T8 fallback alias descripcion/desc/name en catalog', () => {
    expect(resolveLineDesc({ code: 'A' }, { A: { descripcion: 'd1' } })).toBe('d1');
    expect(resolveLineDesc({ code: 'A' }, { A: { desc: 'd2' } })).toBe('d2');
    expect(resolveLineDesc({ code: 'A' }, { A: { name: 'd3' } })).toBe('d3');
  });

  it('T9 line.descripcion alias si l.desc vacío', () => {
    const line = { code: 'A', descripcion: 'from-line-desc' };
    expect(resolveLineDesc(line, {})).toBe('from-line-desc');
  });

  it('T10 desc whitespace-only se trata como vacío', () => {
    const line = { code: 'A', desc: '   ' };
    const catalog = { A: { descripcion: 'from-catalog' } };
    expect(resolveLineDesc(line, catalog)).toBe('from-catalog');
  });

  it('T11 return SIEMPRE string (nunca undefined/null)', () => {
    expect(typeof resolveLineDesc(null, null)).toBe('string');
    expect(typeof resolveLineDesc({}, null)).toBe('string');
    expect(typeof resolveLineDesc({ code: 'X' }, null)).toBe('string');
    expect(typeof resolveLineDesc({ code: 'X' }, {})).toBe('string');
  });
});

describe('v1477 §75 — hasDesc', () => {
  it('T20 populated → true', () => {
    expect(hasDesc({ desc: 'x' })).toBe(true);
  });
  it('T21 vacío/undefined/null → false', () => {
    expect(hasDesc({})).toBe(false);
    expect(hasDesc({ desc: '' })).toBe(false);
    expect(hasDesc({ desc: '   ' })).toBe(false);
    expect(hasDesc(null)).toBe(false);
    expect(hasDesc(undefined)).toBe(false);
  });
});

describe('v1477 §75 — contrato commit-pedido-core.js escribe desc + month', () => {
  it('T30 import resolveLineDesc + llamada en _lineConfirmed + BO', async () => {
    const { readFileSync } = await import('node:fs');
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    expect(core).toMatch(/import \{\s*resolveLineDesc\s*\}\s*from '\.\/resolve-line-desc-core/);
    // Dos call-sites: _lineConfirmed + BO.
    const matches = (core.match(/desc: resolveLineDesc\(payloadLine, catalogDescMap\)/g) || [])
      .length;
    expect(matches).toBe(2);
    // Catalog map construido pre-write.
    expect(core).toMatch(/catalogDescMap/);
    // month seteado en buildPedidoDocData (biome puede partir en varias líneas).
    expect(core).toMatch(/month:\s*(?:\n\s*)?payload\.month \|\|/);
  });

  it('T31 index.html _tryCommitPedidoCF manda desc + month al payload', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('lines: (docData.lines || []).map');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 1500);
    expect(slice).toMatch(/desc: l\.desc \|\| ''/);
    // month en el payload (fuera del map de lines).
    const idxPayload = html.indexOf('month: docData.month || null');
    expect(idxPayload).toBeGreaterThan(0);
  });
});

describe('v1477 §75 — UI renders tienen fallback (sin "undefined" literal)', () => {
  it('T40 índex.html pname del modal pedidos (línea 29106) usa resolveLineDesc', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    // El render arreglado está adyacente a `<div class="ped-line"`.
    const idx = html.indexOf('<div class="ped-line"');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 1500);
    expect(slice).toMatch(/<div class="pname">/);
    expect(slice).toMatch(/resolveLineDesc/);
  });

  it('T41 ningún call-site con escapeHtml(l.desc) sin fallback', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    // Pattern problemático: escapeHtml(l.desc) sin || después → prohibido.
    const bareMatches = html.match(/escapeHtml\(l\.desc\)(?!\s*\+)/g) || [];
    expect(
      bareMatches.length,
      `encontré ${bareMatches.length} escapeHtml(l.desc) sin fallback`
    ).toBe(0);
  });
});

// =============================================================================
// v1504 PR2 — resolveLineDescLive (read-side con prioridad catalog)
// =============================================================================
describe('v1504 PR2 — resolveLineDescLive (catalog gana sobre snapshot)', () => {
  it('L1 catalog hit → gana sobre line.desc (desc vigente, no snapshot)', () => {
    const line = { code: 'CLC70MHAAR', desc: 'Shimano Clarus - 2 tramos (snapshot viejo)' };
    const catalog = { CLC70MHAAR: { descripcion: 'Shimano Clarus - 1 tramo (vigente)' } };
    expect(resolveLineDescLive(line, catalog)).toBe('Shimano Clarus - 1 tramo (vigente)');
  });

  it('L2 catalog miss → fallback a line.desc', () => {
    const line = { code: 'SKU_BORRADO', desc: 'desc histórica' };
    expect(resolveLineDescLive(line, {})).toBe('desc histórica');
  });

  it('L3 catalog miss + line sin desc → fallback al code', () => {
    const line = { code: 'XYZ123' };
    expect(resolveLineDescLive(line, {})).toBe('XYZ123');
  });

  it('L4 catalog null + line.desc populated → line.desc', () => {
    expect(resolveLineDescLive({ code: 'A', desc: 'd' }, null)).toBe('d');
    expect(resolveLineDescLive({ code: 'A', desc: 'd' }, undefined)).toBe('d');
  });

  it('L5 line null/undefined → ""', () => {
    expect(resolveLineDescLive(null, {})).toBe('');
    expect(resolveLineDescLive(undefined, {})).toBe('');
  });

  it('L6 catalog descripcion vacío (string vacío) → NO cuenta, fallback a line.desc', () => {
    const line = { code: 'A', desc: 'line-desc' };
    const catalog = { A: { descripcion: '   ' } };
    expect(resolveLineDescLive(line, catalog)).toBe('line-desc');
  });

  it('L7 Map como catalog', () => {
    const catalog = new Map([['A', { desc: 'from-map' }]]);
    expect(resolveLineDescLive({ code: 'A' }, catalog)).toBe('from-map');
  });

  it('L8 normaliza code (uppercase + trim)', () => {
    const catalog = { ABC: { descripcion: 'ok' } };
    expect(resolveLineDescLive({ code: '  abc  ' }, catalog)).toBe('ok');
  });

  it('L9 fixture Mariano caso CLC70MHAAR (2 tramos → 1 tramo)', () => {
    const line = {
      code: 'CLC70MHAAR',
      desc: 'Shimano Clarus - Caña de Casting 7\'0" - 2 tramos (snapshot al cargar)',
    };
    const catalog = {
      CLC70MHAAR: { descripcion: 'Shimano Clarus - Caña de Casting 7\'0" - 1 tramo' },
    };
    expect(resolveLineDescLive(line, catalog)).toBe(
      'Shimano Clarus - Caña de Casting 7\'0" - 1 tramo'
    );
  });

  it('L10 return SIEMPRE string', () => {
    expect(typeof resolveLineDescLive(null, null)).toBe('string');
    expect(typeof resolveLineDescLive({}, null)).toBe('string');
    expect(typeof resolveLineDescLive({ code: 'X' }, null)).toBe('string');
  });

  it('L11 SKU borrado del catálogo + line sin desc → devuelve code (nunca "")', () => {
    expect(resolveLineDescLive({ code: 'X' }, {})).toBe('X');
    expect(resolveLineDescLive({ code: 'X' }, { OTRO: { desc: 'z' } })).toBe('X');
  });
});

describe('v1504 PR2 — buildCatalogDescMapFromProducts', () => {
  it('B1 array con shape {code, desc} → map uppercase', () => {
    const products = [
      { code: 'abc', desc: 'A' },
      { code: 'DEF', desc: 'D' },
    ];
    const map = buildCatalogDescMapFromProducts(products);
    expect(map).toEqual({
      ABC: { descripcion: 'A' },
      DEF: { descripcion: 'D' },
    });
  });

  it('B2 shape vacío / null → {}', () => {
    expect(buildCatalogDescMapFromProducts(null)).toEqual({});
    expect(buildCatalogDescMapFromProducts(undefined)).toEqual({});
    expect(buildCatalogDescMapFromProducts([])).toEqual({});
  });

  it('B3 ignora items sin code', () => {
    const products = [{ desc: 'orphan' }, null, { code: 'OK', desc: 'ok' }];
    expect(buildCatalogDescMapFromProducts(products)).toEqual({
      OK: { descripcion: 'ok' },
    });
  });

  it('B4 soporta descripcion/desc/name alias', () => {
    const products = [
      { code: 'A', descripcion: 'd1' },
      { code: 'B', desc: 'd2' },
      { code: 'C', name: 'd3' },
    ];
    expect(buildCatalogDescMapFromProducts(products)).toEqual({
      A: { descripcion: 'd1' },
      B: { descripcion: 'd2' },
      C: { descripcion: 'd3' },
    });
  });

  it('B5 integración: products catalog real → resolveLineDescLive devuelve vigente', () => {
    const products = [
      {
        code: 'CLC70MHAAR',
        desc: 'Shimano Clarus - Caña de Casting 7\'0" - 1 tramo',
      },
    ];
    const map = buildCatalogDescMapFromProducts(products);
    const line = { code: 'CLC70MHAAR', desc: '... 2 tramos (snapshot)' };
    expect(resolveLineDescLive(line, map)).toBe('Shimano Clarus - Caña de Casting 7\'0" - 1 tramo');
  });
});

// =============================================================================
// v1504 PR2 — contrato: payload SAP NO cambia (sigue usando snapshot desc)
// =============================================================================
describe('v1504 PR2 — payload SAP intacto (snapshot l.desc, no catalog live)', () => {
  it('S1 auto-send-sap-core NO llama resolveLineDescLive (SAP usa su propia desc)', async () => {
    const { readFileSync } = await import('node:fs');
    const sapCore = readFileSync('functions/core/auto-send-sap-core.js', 'utf8');
    expect(sapCore).not.toMatch(/resolveLineDescLive/);
  });

  it('S2 commit-pedido-core SIGUE usando resolveLineDesc (write-side, no Live)', async () => {
    const { readFileSync } = await import('node:fs');
    const commit = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    expect(commit).toMatch(/desc: resolveLineDesc\(payloadLine, catalogDescMap\)/);
    // No usa Live.
    expect(commit).not.toMatch(/resolveLineDescLive/);
  });
});

describe('v1477 §75 — mensaje "aguardando snapshot SAP" diferenciado', () => {
  it('T50 renderSapEstadoBadge acepta pedidoConf + diferencia por transferidoSAP', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/function renderSapEstadoBadge\(estado, detalles, pedidoConf\)/);
    const idx = html.indexOf('function renderSapEstadoBadge(estado, detalles, pedidoConf)');
    const slice = html.slice(idx, idx + 2500);
    expect(slice).toMatch(/en SAP, procesando cobranza/);
    expect(slice).toMatch(/trabado, avisale a Mariano/);
    expect(slice).toMatch(/pendiente de envío a SAP/);
    // Call-site actualizado.
    expect(html).toMatch(
      /renderSapEstadoBadge\(it\.conf\.sapEstado, it\.conf\.sapEstadoDetalles, it\.conf\)/
    );
  });
});
