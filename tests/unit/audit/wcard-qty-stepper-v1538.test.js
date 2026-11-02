// v1538 APP-03 (2026-11-02): columna Pedido original del modal "Pedido en
// espera" usa el mismo control .qty-stepper que Crear pedido manual.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX = readFileSync('index.html', 'utf8');
const CSS = readFileSync('styles/apple-design.css', 'utf8');
const PICKER = readFileSync('src/domains/product-picker.js', 'utf8');
const MAIN = readFileSync('src/main.js', 'utf8');

function renderBlock() {
  const start = INDEX.indexOf('// v1538 APP-03 (2026-11-02): mismo control');
  expect(start).toBeGreaterThan(0);
  return INDEX.slice(start, INDEX.indexOf('tdQty.appendChild(stepper);', start) + 30);
}

describe('v1538 APP-03 — render de Pedido original', () => {
  it('usa .qty-stepper con botón minus, input y botón plus en ese orden', () => {
    const b = renderBlock();
    expect(b).toMatch(/stepper\.className = 'qty-stepper wcard-qty-stepper'/);
    expect(b).toMatch(/btnMinus\.className = 'minus'/);
    expect(b).toMatch(/btnPlus\.className = 'plus'/);
    const iMinus = b.indexOf('stepper.appendChild(btnMinus)');
    const iInp = b.indexOf('stepper.appendChild(inp)');
    const iPlus = b.indexOf('stepper.appendChild(btnPlus)');
    expect(iMinus).toBeGreaterThan(0);
    expect(iInp).toBeGreaterThan(iMinus);
    expect(iPlus).toBeGreaterThan(iInp);
  });

  it('las 3 acciones persisten con waitlistUpdateItemQty (mecanismo de siempre)', () => {
    const b = renderBlock();
    expect(b.match(/waitlistUpdateItemQty\(w\._id, r\.idx,/g)?.length).toBe(2);
    expect(b).toMatch(
      /btnMinus\.onclick = \(ev\) => \{ ev\.stopPropagation\(\); _applyStep\(-1\); \}/
    );
    expect(b).toMatch(
      /btnPlus\.onclick = \(ev\) => \{ ev\.stopPropagation\(\); _applyStep\(1\); \}/
    );
  });

  it('(−) se deshabilita con cantidad 1 y apunta a la X', () => {
    const b = renderBlock();
    expect(b).toMatch(/btnMinus\.disabled = off/);
    expect(b).toMatch(/Para quitar el producto usá la X/);
  });

  it('el campo viejo (input suelto de 60px) ya no existe', () => {
    expect(INDEX).not.toMatch(
      /inp\.style\.cssText = 'width:60px;text-align:center;font-weight:700/
    );
  });

  it('waitlistUpdateItemQty sigue rechazando < 1', () => {
    expect(INDEX).toMatch(/if \(!Number\.isFinite\(newQty\) \|\| newQty < 1\) \{/);
  });

  it('pure helper expuesto en __phase0.pure.waitlistQtyStepper', () => {
    expect(MAIN).toMatch(
      /waitlistQtyStepper: \{ nextWaitlistQty, parseWaitlistQtyInput, isWaitlistQtyMinusDisabled \}/
    );
  });
});

describe('v1538 APP-03 — mismo control que Crear pedido manual', () => {
  it('product-picker sigue usando .qty-stepper con minus/plus (no se tocó)', () => {
    expect(PICKER).toMatch(/<div class="qty-stepper"/);
    expect(PICKER).toMatch(/<button class="minus"/);
    expect(PICKER).toMatch(/<button class="plus"/);
  });

  it('estilos base .qty-stepper: minus rojo, plus verde', () => {
    expect(INDEX).toMatch(/\.qty-stepper button\.minus\{background:var\(--color-danger\)/);
    expect(INDEX).toMatch(/\.qty-stepper button\{background:var\(--color-success\)/);
  });
});

describe('v1538 APP-03 — hover de fila no borra los colores', () => {
  it('minus y plus fuerzan su fondo también en tr:hover', () => {
    expect(CSS).toMatch(
      /#waitlist-card-modal tbody tr:hover td \.qty-stepper button\.minus \{\r?\n\s*background: var\(--color-danger\) !important;/
    );
    expect(CSS).toMatch(
      /#waitlist-card-modal tbody tr:hover td \.qty-stepper button\.plus \{\r?\n\s*background: var\(--color-success\) !important;/
    );
  });

  it('el número queda negro sobre blanco en hover', () => {
    expect(CSS).toMatch(
      /#waitlist-card-modal tbody tr:hover td \.qty-stepper input\[type="number"\] \{\r?\n\s*background: #ffffff !important;\r?\n\s*color: #1d1d1f !important;/
    );
  });
});

describe('v1538 APP-03 — ancho dentro de la columna', () => {
  it('la celda tiene clase propia y padding chico (gana al !important de apple-design)', () => {
    expect(INDEX).toMatch(/tdQty\.className = 'num wcard-qty-cell'/);
    expect(INDEX).toMatch(
      /#waitlist-card-modal #wcard-rows td\.wcard-qty-cell\{padding-left:2px !important;padding-right:2px !important\}/
    );
  });

  it('el control ocupa la columna hasta 100px y no baja de 62px', () => {
    expect(INDEX).toMatch(
      /#wcard-rows \.wcard-qty-stepper\{width:100%;max-width:100px;min-width:62px;margin:0 auto\}/
    );
  });
});
