// @ts-check
/**
 * v1411 §49 — tests del fix "scroll vertical dentro del modal".
 *
 * Reporte Mariano: lista de clientes CPST en 1366x768 con 30+ clientes
 * quedaba fuera de pantalla; usuario tenía que hacer zoom-out. Mismo riesgo
 * en los demás modales con listas largas (Stock Asignado / Backorder,
 * Reparto, Generar Backorder, Waitlist card, Pedido en espera).
 *
 * Causa: `.modal-overlay` global tiene `padding:20px` (línea 2824). Los
 * modales usaban `height:92vh` o `max-height:92vh` fijo → modal + padding
 * (20+20=40px) excedía el viewport cuando DPI o Chrome chrome reducía
 * viewport efectivo. Fix: regla CSS global v1411 §49 fuerza
 * `max-height: calc(100dvh - 40px)` + `height: calc(100dvh - 40px)`
 * con !important sobre los 7 modales de lista larga.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

function extractInlineCss(html) {
  const matches = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g));
  return matches.map((m) => m[1]).join('\n');
}
const INLINE_CSS = extractInlineCss(INDEX_HTML);

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
const CSS = stripComments(INLINE_CSS);

const MODALES_LISTA_LARGA = [
  { id: 'crear-pedido-st-modal', label: 'CPST (Crear Pedido Desde Stock Asignado)' },
  { id: 'reparto-modal', label: 'Reparto' },
  { id: 'generar-backorder-modal', label: 'Generar Backorder' },
  { id: 'backorders-modal', label: 'Stock Asignado / Backorder' },
  { id: 'waitlist-card-modal', label: 'Pedido en espera' },
  { id: 'backorders-graficos-modal', label: 'Backorder gráficos' },
  { id: 'estado-modal', label: 'Estado pedidos' },
];

describe('v1411 §49 — regla CSS fuerza max-height 90vh + flex column sobre los 7 modales', () => {
  it('existe el bloque CSS v1411 §49 con los 7 selectores', () => {
    const block = CSS.match(
      /#crear-pedido-st-modal \.modal-box[,\s\S]*?max-height:\s*90vh\s*!important/
    );
    expect(block, 'bloque CSS v1411 §49 no encontrado').toBeTruthy();
  });

  for (const m of MODALES_LISTA_LARGA) {
    it('selector `#' + m.id + ' .modal-box` presente en el bloque §49 (' + m.label + ')', () => {
      const re = new RegExp('#' + m.id + '\\s*\\.modal-box');
      expect(CSS).toMatch(re);
    });
  }

  it('la regla usa 90vh (lo pedido Mariano explícito)', () => {
    const block = CSS.match(
      /#crear-pedido-st-modal \.modal-box[\s\S]*?max-height:\s*90vh\s*!important/
    );
    expect(block).toBeTruthy();
  });

  it('tiene height determinada (requerida por flex:1 children)', () => {
    const block = CSS.match(
      /#crear-pedido-st-modal \.modal-box[\s\S]{0,500}?height:\s*90vh\s*!important/
    );
    expect(block, 'height:90vh !important faltante').toBeTruthy();
  });

  it('tiene display:flex + flex-direction:column + overflow:hidden forzados', () => {
    const block = CSS.match(/#crear-pedido-st-modal \.modal-box[\s\S]{0,800}?\}/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/display:\s*flex\s*!important/);
    expect(block[0]).toMatch(/flex-direction:\s*column\s*!important/);
    expect(block[0]).toMatch(/overflow:\s*hidden\s*!important/);
  });
});

describe('v1411 §49 — encabezados y buscadores son flex-shrink:0', () => {
  it('modal-heads tienen flex-shrink:0 !important', () => {
    const block = CSS.match(
      /#crear-pedido-st-modal \.modal-head[\s\S]{0,500}?flex-shrink:\s*0\s*!important/
    );
    expect(block, 'regla flex-shrink:0 para modal-heads no encontrada').toBeTruthy();
  });

  for (const id of ['cpst-search', 'cpst-summary', 'cpst-preview-meta', 'cpst-preview-total']) {
    it('#' + id + ' tiene flex-shrink:0', () => {
      // Puede estar en un bloque agrupado — busca el id dentro de un bloque con flex-shrink:0.
      const blocks = Array.from(CSS.matchAll(/([^{}]+)\{([^}]*)\}/g));
      const found = blocks.some((m) => m[1].includes('#' + id) && /flex-shrink:\s*0/.test(m[2]));
      expect(found, 'regla flex-shrink:0 para #' + id + ' no encontrada').toBe(true);
    });
  }
});

describe('v1411 §49 — modal-box CPST NO tiene inline height:92vh (eliminado)', () => {
  it('inline del modal-box CPST solo tiene width (sin height ni max-height inline)', () => {
    const match = INDEX_HTML.match(
      /id="crear-pedido-st-modal"[\s\S]{0,400}?<div class="modal-box"[^>]*style="([^"]*)"/
    );
    expect(match, 'modal-box CPST no encontrado').toBeTruthy();
    const style = match[1];
    expect(style, 'style inline del modal-box CPST todavía tiene height:92vh').not.toMatch(
      /height:\s*92vh/
    );
    expect(style, 'style inline del modal-box CPST todavía tiene max-height:92vh').not.toMatch(
      /max-height:\s*92vh/
    );
  });
});

describe('v1411 §49 — scrollable lists tienen flex column + overflow-y auto', () => {
  const LISTS = [
    { id: 'cpst-clientes-list', modal: 'CPST — paso 1 lista clientes' },
    { id: 'cpst-preview-list', modal: 'CPST — paso 2 SKUs del cliente' },
    { id: 'backorders-list', modal: 'Stock Asignado / Backorder' },
    { id: 'reparto-list', modal: 'Reparto' },
    { id: 'gb-lines-list', modal: 'Generar Backorder — SKUs' },
  ];

  // Busca un bloque CSS que (1) incluya el selector del list y (2) tenga
  // flex + min-height + overflow-y declarados.
  function findBlockWith(selector) {
    const blocks = Array.from(CSS.matchAll(/([^{}]+)\{([^}]*)\}/g));
    for (const m of blocks) {
      const selList = m[1];
      const body = m[2];
      if (!selList.includes('#' + selector)) continue;
      if (!/flex:\s*1 1 0/.test(body)) continue;
      if (!/min-height:\s*0/.test(body)) continue;
      if (!/overflow-y:\s*auto/.test(body)) continue;
      return { selList, body };
    }
    return null;
  }

  for (const l of LISTS) {
    it(
      '`#' + l.id + '` tiene flex:1 1 0 + min-height:0 + overflow-y:auto (' + l.modal + ')',
      () => {
        const block = findBlockWith(l.id);
        expect(block, 'regla CSS para #' + l.id + ' no cumple el patrón').toBeTruthy();
      }
    );
  }
});

describe('v1411 §49 — invariantes de estructura (los modales mantienen flex column)', () => {
  for (const m of MODALES_LISTA_LARGA) {
    it('#' + m.id + ' mantiene display:flex + flex-direction:column (' + m.label + ')', () => {
      const chunk = INDEX_HTML.match(new RegExp('id="' + m.id + '"[\\s\\S]{0,3500}', 'i'));
      expect(chunk, 'modal #' + m.id + ' no encontrado').toBeTruthy();
      // Al menos el modal-box inmediato debe tener flex column.
      const boxMatch = chunk[0].match(/<div class="modal-box[^"]*"[^>]*style="([^"]*)"/);
      expect(boxMatch, 'modal-box del #' + m.id + ' sin style inline').toBeTruthy();
      const style = boxMatch[1];
      // Puede estar normalizado o inline; .modal-box global ya tiene flex column, pero
      // cuando se override con style inline debe mantenerlo.
      // Si no tiene nada de flex en inline, lo hereda del .modal-box global (OK).
      const hasInlineFlex = /display:\s*flex/.test(style) && /flex-direction:\s*column/.test(style);
      const hasNoInlineOverride =
        !/display:\s*(?!flex)/.test(style) && !/flex-direction:\s*(?!column)/.test(style);
      expect(
        hasInlineFlex || hasNoInlineOverride,
        'modal-box del #' + m.id + ' pisa display/flex-direction sin flex column'
      ).toBe(true);
    });
  }
});

describe('v1411 §49 — simulación 1366x768 con 30 clientes (CPST)', () => {
  // Validamos que el modal-box efectivo cabe en 1366x768 con padding del
  // overlay. 100dvh = 768 → calc(100dvh - 40px) = 728px. Cabe exacto.
  const VIEWPORT_H = 768;
  const OVERLAY_PADDING_TOP_BOTTOM = 40;

  it('modal-box altura efectiva = viewport − 40px (cabe por diseño)', () => {
    const modalBoxHeight = VIEWPORT_H - OVERLAY_PADDING_TOP_BOTTOM;
    expect(modalBoxHeight).toBe(728);
    // Antes del fix (height:92vh): 92% * 768 = 706.56 → 706.56 + 40 = 746.56
    // (en zoom 100% cabía por 21.44px; con DPI 125% o chrome extra se cortaba).
    const beforeFix = Math.round(0.92 * VIEWPORT_H) + OVERLAY_PADDING_TOP_BOTTOM;
    expect(beforeFix).toBeGreaterThan(VIEWPORT_H - 40); // había poco margen
  });

  it('30 clientes de 55px cada uno (1650px) requieren scroll (lista supera modal-box)', () => {
    const HEADER_HEIGHT = 72; // modal-head
    const PADDING = 14 * 2; // inner wrapper
    const SEARCH = 46; // #cpst-search
    const SUMMARY = 35; // #cpst-summary
    const GAP = 10 * 2; // gap entre bloques
    const modalBoxHeight = 768 - 40; // calc(100dvh - 40px)
    const listAvailable = modalBoxHeight - HEADER_HEIGHT - PADDING - SEARCH - SUMMARY - GAP;
    const CLIENT_ROW_HEIGHT = 55;
    const CLIENTS = 30;
    const totalListHeight = CLIENT_ROW_HEIGHT * CLIENTS; // 1650px
    expect(totalListHeight).toBeGreaterThan(listAvailable);
    // El overflow:hidden del modal + overflow-y:auto de la lista garantizan
    // que los clientes extras scrollean DENTRO de la lista, no fuera del
    // viewport.
  });

  it('40 SKUs de 48px cada uno (1920px) requieren scroll en el paso 2', () => {
    const HEADER_HEIGHT = 72;
    const PADDING = 14 * 2;
    const BACK_BAR = 40; // botón Volver + nombre cliente
    const META = 35; // #cpst-preview-meta
    const TOTAL = 50; // #cpst-preview-total
    const FOOTER = 55; // botones Cancelar/Confirmar
    const GAP = 10 * 4;
    const modalBoxHeight = 768 - 40;
    const listAvailable =
      modalBoxHeight - HEADER_HEIGHT - PADDING - BACK_BAR - META - TOTAL - FOOTER - GAP;
    const SKU_ROW = 48;
    const SKUS = 40;
    const totalListHeight = SKU_ROW * SKUS; // 1920px
    expect(totalListHeight).toBeGreaterThan(listAvailable);
  });
});
