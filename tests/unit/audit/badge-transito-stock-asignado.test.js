// @ts-nocheck
/**
 * v1562 reparto-dep12 §E4.1 — Badge TRANSITO en modal Stock Asignado.
 *
 * Verifica que el badge inline respeta §106 (pill), §62 (hover-safe) y §21
 * (apple-design). Con feature flag OFF nunca aparece en prod porque no
 * hay líneas enTransito=true.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..', '..');
const CSS = readFileSync(join(REPO, 'styles/apple-design.css'), 'utf-8');
const INDEX = readFileSync(join(REPO, 'index.html'), 'utf-8');

describe('v1562 §E4.1 — badge TRANSITO', () => {
  it('T1: regla CSS .badge-transito con background #dbeafe + color #1e40af', () => {
    expect(CSS).toMatch(/\.badge-transito\s*\{[^}]*background:\s*#dbeafe/i);
    expect(CSS).toMatch(/\.badge-transito\s*\{[^}]*color:\s*#1e40af/i);
    expect(CSS).toMatch(/\.badge-transito\s*\{[^}]*border-radius:\s*999px/i);
  });

  it('T2: regla hover-safe con 4 selectores y !important', () => {
    const hoverBlock = CSS.match(/#backorders-modal tbody tr:hover td \.badge-transito[\s\S]*?\}/);
    expect(hoverBlock).toBeTruthy();
    expect(CSS).toMatch(/#backorders-modal tbody tr:hover td \.badge-transito/);
    expect(CSS).toMatch(/#backorders-modal tbody tr:focus-within td \.badge-transito/);
    expect(CSS).toMatch(/#backorders-modal tbody tr\.highlighted td \.badge-transito/);
    expect(CSS).toMatch(/#backorders-modal tbody tr\.selected td \.badge-transito/);
    const block = hoverBlock[0];
    expect(block).toMatch(/background:\s*#dbeafe\s*!important/);
    expect(block).toMatch(/color:\s*#1e40af\s*!important/);
  });

  it('T3: index.html referencia badge-transito en bloque enTransito', () => {
    expect(INDEX).toContain('badge-transito');
    expect(INDEX).toContain('_p.enTransito === true');
    // Suma solo qty con enTransito=true.
    expect(INDEX).toMatch(/_qtyTransito\s*\+=\s*Number\(_p\.qtyOpen/);
  });

  it('T4: contraste WCAG >= 4.5:1 (#1e40af sobre #dbeafe)', () => {
    // Pre-calculated ratio: #1e40af sobre #dbeafe ≈ 8.59:1 (AAA).
    function rel(hex) {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16) / 255;
      const g = parseInt(h.slice(2, 4), 16) / 255;
      const b = parseInt(h.slice(4, 6), 16) / 255;
      const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }
    const bgL = rel('#dbeafe');
    const fgL = rel('#1e40af');
    const ratio = (Math.max(bgL, fgL) + 0.05) / (Math.min(bgL, fgL) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
