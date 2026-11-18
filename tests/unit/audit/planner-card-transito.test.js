// v1563 reparto-dep12 §E4.2: Planner card tránsito.
// Tests: CSS classes + grep del render + contraste WCAG + fixture de líneas.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APPLE_CSS = readFileSync(join(REPO_ROOT, 'styles', 'apple-design.css'), 'utf-8');
const INDEX_HTML = readFileSync(join(REPO_ROOT, 'index.html'), 'utf-8');

/** @param {string} hex */
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
/** @param {{r:number,g:number,b:number}} c */
function luma(c) {
  const s = (v) => {
    const vv = v / 255;
    return vv <= 0.03928 ? vv / 12.92 : ((vv + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * s(c.r) + 0.7152 * s(c.g) + 0.0722 * s(c.b);
}
/** @param {string} fg @param {string} bg */
function contrastRatio(fg, bg) {
  const l1 = luma(hexToRgb(fg));
  const l2 = luma(hexToRgb(bg));
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

describe('v1563 reparto-dep12 §E4.2 — Planner card tránsito', () => {
  it('T1: CSS .planner-transito-line y .planner-badge-transito-full presentes en apple-design.css', () => {
    expect(APPLE_CSS).toMatch(/\.planner-transito-line\s*\{/);
    expect(APPLE_CSS).toMatch(/\.planner-badge-transito-full\s*\{/);
  });

  it('T2: regla hover-safe del badge con !important', () => {
    expect(APPLE_CSS).toMatch(/\.planner-card:hover\s+\.planner-badge-transito-full/);
    expect(APPLE_CSS).toMatch(/\.planner-card:focus-within\s+\.planner-badge-transito-full/);
    // El bloque hover-safe tiene !important para pisar cascada.
    const hoverBlock = APPLE_CSS.match(
      /\.planner-card:hover\s+\.planner-badge-transito-full[\s\S]+?\}/
    );
    expect(hoverBlock).toBeTruthy();
    expect(hoverBlock[0]).toContain('!important');
  });

  it('T3: index.html incluye el bloque qtyTransitoOpen/qtyFisicoOpen dentro de renderPlannerCard', () => {
    expect(INDEX_HTML).toMatch(/§E4\.2/);
    expect(INDEX_HTML).toMatch(/_qtyTransitoOpen/);
    expect(INDEX_HTML).toMatch(/_qtyFisicoOpen/);
    expect(INDEX_HTML).toMatch(/_transitoLineHtml/);
    expect(INDEX_HTML).toMatch(/planner-badge-transito-full/);
    expect(INDEX_HTML).toMatch(/planner-transito-line/);
  });

  it('T4: contraste WCAG >= 4.5:1 (texto línea sec #1e40af sobre blanco, badge blanco sobre #1e40af)', () => {
    expect(contrastRatio('#1e40af', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#1e40af')).toBeGreaterThanOrEqual(4.5);
  });

  it('T5: fixture — pedido mixto (2 líneas físico qtyOpen=5 total + 1 línea tránsito qtyOpen=3) → qtyTransito=3, qtyFisico=5', () => {
    // Replica la lógica del bloque de renderPlannerCard sin tocar el DOM.
    const pedido = {
      lines: [
        { state: 'confirmed', qtyOpen: 2, enTransito: false, code: 'A' },
        { state: 'confirmed', qtyOpen: 3, enTransito: false, code: 'B' },
        { state: 'confirmed', qtyOpen: 3, enTransito: true, code: 'C' },
        { state: 'BO', qtyOpen: 10, code: 'D' }, // no suma — state != confirmed
      ],
    };
    let qtyTransitoOpen = 0;
    let qtyFisicoOpen = 0;
    for (const l of pedido.lines) {
      if (!l || l.state !== 'confirmed') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      if (l.enTransito === true) qtyTransitoOpen += qo;
      else qtyFisicoOpen += qo;
    }
    expect(qtyTransitoOpen).toBe(3);
    expect(qtyFisicoOpen).toBe(5);

    // Caso mixto → NO badge full, SÍ línea secundaria.
    expect(qtyTransitoOpen > 0 && qtyFisicoOpen === 0).toBe(false);
    expect(qtyTransitoOpen > 0 && qtyFisicoOpen > 0).toBe(true);
  });

  it('T6: fixture — pedido 100% tránsito → badge full, NO línea sec', () => {
    const pedido = {
      lines: [
        { state: 'confirmed', qtyOpen: 3, enTransito: true, code: 'A' },
        { state: 'confirmed', qtyOpen: 2, enTransito: true, code: 'B' },
      ],
    };
    let qtyTransitoOpen = 0;
    let qtyFisicoOpen = 0;
    for (const l of pedido.lines) {
      if (!l || l.state !== 'confirmed') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      if (l.enTransito === true) qtyTransitoOpen += qo;
      else qtyFisicoOpen += qo;
    }
    expect(qtyTransitoOpen).toBe(5);
    expect(qtyFisicoOpen).toBe(0);
    expect(qtyTransitoOpen > 0 && qtyFisicoOpen === 0).toBe(true); // → badge full
    expect(qtyTransitoOpen > 0 && qtyFisicoOpen > 0).toBe(false); // → NO línea sec
  });

  it('T7: fixture — pedido sin líneas enTransito (flag OFF o pedido normal) → ningún render extra', () => {
    const pedido = {
      lines: [{ state: 'confirmed', qtyOpen: 5, enTransito: false, code: 'A' }],
    };
    let qtyTransitoOpen = 0;
    let qtyFisicoOpen = 0;
    for (const l of pedido.lines) {
      if (!l || l.state !== 'confirmed') continue;
      const qo = Number(l.qtyOpen) || 0;
      if (qo <= 0) continue;
      if (l.enTransito === true) qtyTransitoOpen += qo;
      else qtyFisicoOpen += qo;
    }
    expect(qtyTransitoOpen).toBe(0);
    expect(qtyFisicoOpen).toBe(5);
    // Ni badge ni línea: ambos requieren qtyTransitoOpen > 0.
    expect(qtyTransitoOpen > 0).toBe(false);
  });
});
