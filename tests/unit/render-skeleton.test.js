import { describe, expect, it, vi } from 'vitest';
import { renderSkeletonRowsPure } from '../../src/pure/render-skeleton.js';

function makeContainer() {
  const children = [];
  return {
    children,
    get firstChild() {
      return children[0] || null;
    },
    appendChild(el) {
      children.push(el);
      return el;
    },
    removeChild(el) {
      const idx = children.indexOf(el);
      if (idx >= 0) children.splice(idx, 1);
      return el;
    },
  };
}

function makeDoc() {
  return {
    createElement: vi.fn((tag) => ({ tag, className: '', children: [] })),
  };
}

describe('renderSkeletonRowsPure', () => {
  it('renderea N filas skeleton con className wcard-skeleton-row', () => {
    const cont = makeContainer();
    const doc = makeDoc();
    renderSkeletonRowsPure(cont, 3, { doc });
    expect(cont.children).toHaveLength(3);
    expect(cont.children.every((c) => c.className === 'wcard-skeleton-row')).toBe(true);
    expect(cont.children.every((c) => c.tag === 'div')).toBe(true);
  });

  it('limpia contenido previo del container antes de agregar skeletons', () => {
    const cont = makeContainer();
    cont.children.push({ tag: 'div', className: 'old-row-1' });
    cont.children.push({ tag: 'div', className: 'old-row-2' });
    renderSkeletonRowsPure(cont, 2, { doc: makeDoc() });
    expect(cont.children).toHaveLength(2);
    expect(cont.children.every((c) => c.className === 'wcard-skeleton-row')).toBe(true);
  });

  it('count=0 se normaliza a 1 (nunca renderea 0 skeletons)', () => {
    const cont = makeContainer();
    renderSkeletonRowsPure(cont, 0, { doc: makeDoc() });
    expect(cont.children).toHaveLength(1);
  });

  it('count negativo o NaN → 1 skeleton (defensive default)', () => {
    const cont = makeContainer();
    renderSkeletonRowsPure(cont, -5, { doc: makeDoc() });
    expect(cont.children).toHaveLength(1);
    const cont2 = makeContainer();
    renderSkeletonRowsPure(cont2, Number.NaN, { doc: makeDoc() });
    expect(cont2.children).toHaveLength(1);
  });

  it('count decimal se floorea (3.9 → 3)', () => {
    const cont = makeContainer();
    renderSkeletonRowsPure(cont, 3.9, { doc: makeDoc() });
    expect(cont.children).toHaveLength(3);
  });

  it('container null NO rompe (early return)', () => {
    expect(() => renderSkeletonRowsPure(null, 3, { doc: makeDoc() })).not.toThrow();
  });

  it('deps.doc missing NO rompe (early return)', () => {
    const cont = makeContainer();
    expect(() => renderSkeletonRowsPure(cont, 3, {})).not.toThrow();
    expect(cont.children).toHaveLength(0);
  });

  it('deps null NO rompe (early return)', () => {
    const cont = makeContainer();
    expect(() => renderSkeletonRowsPure(cont, 3, null)).not.toThrow();
  });

  it('llama createElement con tag "div" exactamente N veces', () => {
    const cont = makeContainer();
    const doc = makeDoc();
    renderSkeletonRowsPure(cont, 4, { doc });
    expect(doc.createElement).toHaveBeenCalledTimes(4);
    expect(doc.createElement).toHaveBeenCalledWith('div');
  });
});
