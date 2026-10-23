// @ts-check
/**
 * §63 (2026-10-23) — Test de sincronía entre src/pure/cpst-cancel-asig-plan.js
 * + src/pure/cpst-item-cancel-helpers.js (clientes) y
 * functions/core/cpst-cancel-refs.js (espejo servidor).
 *
 * CLAUDE.md §57: cualquier chequeo de negocio que se evalúe en cliente y
 * servidor DEBE vivir una sola vez en src/pure/<name>.js con copia espejo
 * en functions/core/<name>.js y test de sincronía que falla si divergen.
 */
import { describe, expect, it } from 'vitest';
import * as mirror from '../../../functions/core/cpst-cancel-refs.js';
import * as pureCancel from '../../../src/pure/cpst-cancel-asig-plan.js';
import * as pureItem from '../../../src/pure/cpst-item-cancel-helpers.js';

const WAITLIST_SAMPLES = [
  // Vacío.
  null,
  undefined,
  {},
  { items: [], pedidosOrigenes: [] },
  // Solo pedidosOrigenes.
  {
    items: [],
    pedidosOrigenes: [
      { pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2, sku: 'SKU1' },
      { pedidoId: 'p1', lineIndex: 1, qtyAsignada: 1, sku: 'SKU2' },
    ],
  },
  // Solo items.asigRefs (per-line v1382).
  {
    items: [
      {
        code: 'SKU1',
        qty: 2,
        asigRefs: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
      },
      {
        code: 'SKU2',
        qty: 1,
        asigRefs: [{ pedidoId: 'p1', lineIndex: 1, qtyAsignada: 1 }],
      },
    ],
    pedidosOrigenes: [],
  },
  // Unión (doc-level + per-line) con dedupe + max qty.
  {
    items: [
      {
        code: 'SKU1',
        qty: 2,
        asigRefs: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 2 }],
      },
    ],
    pedidosOrigenes: [{ pedidoId: 'p1', lineIndex: 0, qtyAsignada: 3, sku: 'SKU1' }],
  },
  // Refs con lineIndex no numérico (edge case).
  {
    items: [{ code: 'SKU1', qty: 1, asigRefs: [{ pedidoId: 'p1', lineIndex: 'oops' }] }],
    pedidosOrigenes: [],
  },
];

describe('§63 cpst-cancel-refs mirror sync', () => {
  it('collectAsigRefsForCancel: pure y mirror devuelven lo mismo para fixtures', () => {
    for (const w of WAITLIST_SAMPLES) {
      const a = pureCancel.collectAsigRefsForCancel(w);
      const b = mirror.collectAsigRefsForCancel(w);
      expect(b).toEqual(a);
    }
  });

  it('collectAsigRefsForItemCancel: pure y mirror devuelven lo mismo para fixtures', () => {
    for (const w of WAITLIST_SAMPLES) {
      const items = w && Array.isArray(w.items) ? w.items : [];
      // Probar cada itemIndex válido + 1 fuera de rango.
      const indices = [0, 1, 2, items.length];
      for (const idx of indices) {
        const a = pureItem.collectAsigRefsForItemCancel(w, idx);
        const b = mirror.collectAsigRefsForItemCancel(w, idx);
        expect(b).toEqual(a);
      }
    }
  });

  it('collectAsigRefsForCancel: match caso real ALAN OSCAR CLC70MHAAR', () => {
    const w = {
      items: [
        {
          code: 'CLC70MHAAR',
          qty: 1,
          asigRefs: [{ pedidoId: 'ewGoZIDQ', lineIndex: 0, qtyAsignada: 1 }],
        },
      ],
      pedidosOrigenes: [{ pedidoId: 'ewGoZIDQ', lineIndex: 0, qtyAsignada: 1, sku: 'CLC70MHAAR' }],
    };
    expect(mirror.collectAsigRefsForCancel(w)).toEqual(pureCancel.collectAsigRefsForCancel(w));
  });
});
