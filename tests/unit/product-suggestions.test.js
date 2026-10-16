// @ts-check
import { describe, expect, it } from 'vitest';
import {
  computeSoftScore,
  overlapRatio,
  passHard,
  suggestForSku,
} from '../../src/pure/product-suggestions.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORIG_SKU = 'CLC70H2PY';
const CARRITO_SKU = 'CLS70XH2CH'; // SKU que simula ya estar en carrito

const CATALOG = [
  {
    code: 'CLC70H2PY',
    desc: 'Casting Heavy 7ft 30lb',
    cat: 'CAÑAS',
    fam: 'FW Casting',
    sub: 'Clarus',
  },
  {
    code: 'CLC70HA2',
    desc: 'otro Casting 7ft Heavy',
    cat: 'CAÑAS',
    fam: 'FW Casting',
    sub: 'Clarus',
  },
  {
    code: 'CDC72HA',
    desc: 'Curado Casting 7.2ft Heavy',
    cat: 'CAÑAS',
    fam: 'FW Casting',
    sub: 'Curado',
  },
  {
    code: 'CLC70M2',
    desc: 'Casting Medium 7ft 15lb',
    cat: 'CAÑAS',
    fam: 'FW Casting',
    sub: 'Clarus',
  },
  {
    code: 'CLC66HA',
    desc: 'Casting 1 tramo 6.6ft Heavy',
    cat: 'CAÑAS',
    fam: 'FW Casting',
    sub: 'Clarus',
  },
  {
    code: 'CDC60M',
    desc: 'Casting 1 tramo 6ft Medium',
    cat: 'CAÑAS',
    fam: 'FW Casting',
    sub: 'Curado',
  },
  { code: 'CLS70HA', desc: 'Spinning Heavy', cat: 'CAÑAS', fam: 'FW Spinning', sub: 'Clarus' },
  { code: CARRITO_SKU, desc: 'Spinning XH', cat: 'CAÑAS', fam: 'FW Spinning', sub: 'Clarus' },
  { code: 'OUT_OF_STOCK', desc: 'Casting Heavy', cat: 'CAÑAS', fam: 'FW Casting', sub: 'Clarus' },
  {
    code: 'REEL1',
    desc: 'Reel Stella 4000',
    cat: 'REEL',
    fam: 'Spinning Low Profile',
    sub: 'Stella',
  },
  {
    code: 'REEL2',
    desc: 'Reel Stella 2500',
    cat: 'REEL',
    fam: 'Spinning Low Profile',
    sub: 'Stella',
  },
  {
    code: 'REEL3',
    desc: 'Reel Twin Power 4000',
    cat: 'REEL',
    fam: 'Spinning Low Profile',
    sub: 'TwinPower',
  },
];

const ATTRS = {
  CLC70H2PY: {
    sku: 'CLC70H2PY',
    familia_motor: 'canas',
    tipo: 'Casting',
    tramos: 2,
    libraje_min: 25,
    libraje_max: 35,
    largo_cm: 213,
    accion: 'rapida',
    potencia: 'H',
  },
  CLC70HA2: {
    sku: 'CLC70HA2',
    familia_motor: 'canas',
    tipo: 'Casting',
    tramos: 2,
    libraje_min: 25,
    libraje_max: 35,
    largo_cm: 213,
    accion: 'rapida',
    potencia: 'H',
  },
  CDC72HA: {
    sku: 'CDC72HA',
    familia_motor: 'canas',
    tipo: 'Casting',
    tramos: 2,
    libraje_min: 20,
    libraje_max: 30,
    largo_cm: 218,
    accion: 'rapida',
    potencia: 'H',
  },
  CLC70M2: {
    sku: 'CLC70M2',
    familia_motor: 'canas',
    tipo: 'Casting',
    tramos: 2,
    libraje_min: 10,
    libraje_max: 20,
    largo_cm: 213,
    accion: 'rapida',
    potencia: 'M',
  }, // overlap 0 con 25-35
  CLC66HA: {
    sku: 'CLC66HA',
    familia_motor: 'canas',
    tipo: 'Casting',
    tramos: 1,
    libraje_min: 25,
    libraje_max: 35,
    largo_cm: 198,
    accion: 'rapida',
    potencia: 'H',
  },
  CDC60M: {
    sku: 'CDC60M',
    familia_motor: 'canas',
    tipo: 'Casting',
    tramos: 1,
    libraje_min: 8,
    libraje_max: 17,
    largo_cm: 183,
    accion: 'moderada',
    potencia: 'M',
  },
  CLS70HA: {
    sku: 'CLS70HA',
    familia_motor: 'canas',
    tipo: 'Spinning',
    tramos: 2,
    libraje_min: 25,
    libraje_max: 35,
    largo_cm: 213,
    accion: 'rapida',
    potencia: 'H',
  },
  [CARRITO_SKU]: {
    sku: CARRITO_SKU,
    familia_motor: 'canas',
    tipo: 'Spinning',
    tramos: 2,
    libraje_min: 35,
    libraje_max: 45,
    largo_cm: 213,
    accion: 'rapida',
    potencia: 'XH',
  },
  OUT_OF_STOCK: {
    sku: 'OUT_OF_STOCK',
    familia_motor: 'canas',
    tipo: 'Casting',
    tramos: 2,
    libraje_min: 25,
    libraje_max: 35,
    largo_cm: 213,
    accion: 'rapida',
    potencia: 'H',
  },
  // Reels no tienen attrs
};

const STOCK = {
  CLC70H2PY: 0, // El original esta sin stock
  CLC70HA2: 10,
  CDC72HA: 5,
  CLC70M2: 8,
  CLC66HA: 3,
  CDC60M: 20,
  CLS70HA: 7,
  [CARRITO_SKU]: 15,
  OUT_OF_STOCK: 0, // excluir
  REEL1: 12,
  REEL2: 4,
  REEL3: 2,
};

const PRICES = {
  CLC70H2PY: 34000,
  CLC70HA2: 34500, // +1.5%
  CDC72HA: 38000, // +11.8%
  CLC70M2: 30000, // -11.8%
  CLC66HA: 32000,
  CDC60M: 25000,
  CLS70HA: 33000,
  [CARRITO_SKU]: 30000,
  OUT_OF_STOCK: 34000,
  REEL1: 150000,
  REEL2: 140000,
  REEL3: 180000, // +20% vs 150k, fuera de ±30% si original fuera 100k
};

const baseCtx = (overrides = {}) => ({
  catalog: CATALOG,
  attrsBySku: ATTRS,
  stockBySku: STOCK,
  cartSkus: [CARRITO_SKU],
  priceBySku: PRICES,
  qtyFaltante: 3,
  ...overrides,
});

// ---------------------------------------------------------------------------
// overlapRatio
// ---------------------------------------------------------------------------
describe('overlapRatio', () => {
  it('100% overlap igual rango', () => {
    expect(overlapRatio(12, 25, 12, 25)).toBe(1);
  });
  it('overlap parcial 50%', () => {
    // Rango a: 10-20 (width 10). Rango b: 15-25 (width 10). overlap 15-20 = 5. 5/10 = 0.5
    expect(overlapRatio(10, 20, 15, 25)).toBe(0.5);
  });
  it('sin overlap', () => {
    expect(overlapRatio(10, 20, 30, 40)).toBe(0);
  });
  it('rangos contenidos devuelve 1 (overlap = min width)', () => {
    // a=10-30 (width 20), b=15-20 (width 5). overlap=5. ratio=5/5=1
    expect(overlapRatio(10, 30, 15, 20)).toBe(1);
  });
  it('single value iguales → 1', () => {
    expect(overlapRatio(30, 30, 30, 30)).toBe(1);
  });
  it('single value distintos → 0', () => {
    expect(overlapRatio(30, 30, 25, 25)).toBe(0);
  });
  it('null → 0', () => {
    expect(overlapRatio(null, 25, 12, 25)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// passHard
// ---------------------------------------------------------------------------
describe('passHard', () => {
  const orig = ATTRS.CLC70H2PY;

  it('nivel 0: match exacto pasa', () => {
    expect(passHard(orig, ATTRS.CLC70HA2, 0)).toBe(true);
  });
  it('nivel 0: tipo distinto no pasa (nunca)', () => {
    expect(passHard(orig, ATTRS.CLS70HA, 0)).toBe(false);
    expect(passHard(orig, ATTRS.CLS70HA, 3)).toBe(false);
  });
  it('nivel 0: libraje overlap=0 no pasa', () => {
    expect(passHard(orig, ATTRS.CLC70M2, 0)).toBe(false);
  });
  it('nivel 1: libraje overlap=0 no pasa, nivel 1 requiere > 0', () => {
    expect(passHard(orig, ATTRS.CLC70M2, 1)).toBe(false);
  });
  it('nivel 2: tramos distinto no pasa', () => {
    expect(passHard(orig, ATTRS.CLC66HA, 2)).toBe(false);
  });
  it('nivel 3: solo tipo basta', () => {
    expect(passHard(orig, ATTRS.CDC60M, 3)).toBe(true);
    expect(passHard(orig, ATTRS.CLC66HA, 3)).toBe(true);
  });
  it('attrs null → false', () => {
    expect(passHard(null, ATTRS.CLC70HA2, 0)).toBe(false);
    expect(passHard(orig, null, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeSoftScore
// ---------------------------------------------------------------------------
describe('computeSoftScore', () => {
  it('mismo modelo + largo + accion suma 180 + bonus precio', () => {
    const orig = CATALOG.find((p) => p.code === 'CLC70H2PY');
    const cand = CATALOG.find((p) => p.code === 'CLC70HA2');
    const score = computeSoftScore(
      'CLC70H2PY',
      'CLC70HA2',
      orig,
      cand,
      ATTRS.CLC70H2PY,
      ATTRS.CLC70HA2,
      PRICES
    );
    // Mismo sub (Clarus): +100. Mismo largo (213): +50. Misma accion: +30. Delta 1.5%: +48.5. Total ≈ 228.5
    expect(score).toBeGreaterThan(220);
  });
  it('distinto sub resta 100', () => {
    const orig = CATALOG.find((p) => p.code === 'CLC70H2PY');
    const cand = CATALOG.find((p) => p.code === 'CDC72HA');
    const score = computeSoftScore(
      'CLC70H2PY',
      'CDC72HA',
      orig,
      cand,
      ATTRS.CLC70H2PY,
      ATTRS.CDC72HA,
      PRICES
    );
    // Sin sub (Curado≠Clarus): 0 por sub. Largo 218 cerca de 213 (±15): +50. Accion igual: +30. Precio +11.8%: 50-11.8=38.2. ≈118
    expect(score).toBeLessThan(130);
    expect(score).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// suggestForSku - casos principales
// ---------------------------------------------------------------------------
describe('suggestForSku - cañas', () => {
  it('match exacto único: 1 strict', () => {
    // Si solo hubiera CLC70HA2 como candidato valido
    const ctx = baseCtx({
      catalog: [CATALOG[0], CATALOG[1]], // original + 1 match
    });
    const r = suggestForSku(ORIG_SKU, ctx);
    expect(r.mode).toBe('canas');
    expect(r.strict).toHaveLength(1);
    expect(r.strict[0].sku).toBe('CLC70HA2');
    expect(r.strict[0].badge).toBe('ok');
    expect(r.approx).toHaveLength(0);
  });

  it('match exacto múltiple: orden por soft score', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx());
    expect(r.mode).toBe('canas');
    // CLC70HA2 (mismo sub Clarus) debe estar arriba de CDC72HA (sub Curado)
    expect(r.strict[0].sku).toBe('CLC70HA2');
    expect(r.strict[1].sku).toBe('CDC72HA');
  });

  it('aproximados nivel 2 y 3 van en approx[]', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx());
    // CLC66HA (tramos distinto 1 vs 2) → nivel 2
    // CDC60M (tramos y libraje distintos) → nivel 3
    const approxSkus = r.approx.map((a) => a.sku);
    expect(approxSkus).toContain('CLC66HA');
    expect(approxSkus).toContain('CDC60M');
    // CLC70M2: libraje 10-20 vs 25-35 → overlap 0 → NO pasa ni nivel 1
    // Entonces va a nivel 2 (sin libraje, tramos iguales)
    expect(approxSkus).toContain('CLC70M2');
  });

  it('excluye SKUs del carrito', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx());
    const todos = [...r.strict, ...r.approx].map((x) => x.sku);
    expect(todos).not.toContain(CARRITO_SKU);
  });

  it('excluye SKUs sin stock suficiente', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx({ qtyFaltante: 4 }));
    const todos = [...r.strict, ...r.approx].map((x) => x.sku);
    expect(todos).not.toContain('OUT_OF_STOCK');
    expect(todos).not.toContain('CLC66HA'); // stock 3 < qtyFaltante 4
  });

  it('excluye SKUs tipo distinto (Spinning cuando original es Casting)', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx());
    const todos = [...r.strict, ...r.approx].map((x) => x.sku);
    expect(todos).not.toContain('CLS70HA'); // Spinning
  });

  it('excluye el propio SKU original', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx());
    const todos = [...r.strict, ...r.approx].map((x) => x.sku);
    expect(todos).not.toContain(ORIG_SKU);
  });

  it('SKU no en catalogo → error', () => {
    const r = suggestForSku('NOT_EXIST', baseCtx());
    expect(r.error).toBe('SKU_NOT_IN_CATALOG');
    expect(r.strict).toHaveLength(0);
    expect(r.approx).toHaveLength(0);
  });

  it('qtyFaltante mayor que todo el stock → vacio', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx({ qtyFaltante: 1000 }));
    expect(r.strict).toHaveLength(0);
    expect(r.approx).toHaveLength(0);
  });

  it('scored tiene campos esperados (sku, score, badge, stockLibre, precio, precioDelta, precioDeltaPct)', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx());
    const first = r.strict[0];
    expect(first).toHaveProperty('sku');
    expect(first).toHaveProperty('score');
    expect(first).toHaveProperty('badge');
    expect(first).toHaveProperty('stockLibre');
    expect(first).toHaveProperty('precio');
    expect(first).toHaveProperty('precioDelta');
    expect(first).toHaveProperty('precioDeltaPct');
  });

  it('precioDelta y precioDeltaPct se calculan correctamente', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx());
    const hit = r.strict.find((s) => s.sku === 'CLC70HA2');
    expect(hit.precioDelta).toBe(500); // 34500 - 34000
    expect(hit.precioDeltaPct).toBeCloseTo(1.47, 1);
  });
});

// ---------------------------------------------------------------------------
// suggestForSku - fallback no-cañas
// ---------------------------------------------------------------------------
describe('suggestForSku - fallback no-cañas', () => {
  const REEL_CATALOG = [
    { code: 'STELLA4000', desc: 'Reel Stella 4000', cat: 'REEL', fam: 'Spinning', sub: 'Stella' },
    { code: 'STELLA2500', desc: 'Reel Stella 2500', cat: 'REEL', fam: 'Spinning', sub: 'Stella' },
    { code: 'STELLA1000', desc: 'Reel Stella 1000', cat: 'REEL', fam: 'Spinning', sub: 'Stella' },
    {
      code: 'TWINPOWER4000',
      desc: 'TwinPower 4000',
      cat: 'REEL',
      fam: 'Spinning',
      sub: 'TwinPower',
    },
    { code: 'OTHER', desc: 'Other', cat: 'REEL', fam: 'Baitcasting', sub: 'Curado' },
  ];
  const REEL_STOCK = {
    STELLA4000: 10,
    STELLA2500: 5,
    STELLA1000: 8,
    TWINPOWER4000: 7,
    OTHER: 20,
  };
  const REEL_PRICES = {
    STELLA4000: 100000,
    STELLA2500: 90000, // -10%
    STELLA1000: 70000, // -30% exacto
    TWINPOWER4000: 150000, // +50% fuera de rango
    OTHER: 95000,
  };

  it('mismo sub + precio ±30% → mode fallback_sub', () => {
    const ctx = {
      catalog: REEL_CATALOG,
      attrsBySku: {},
      stockBySku: REEL_STOCK,
      cartSkus: [],
      priceBySku: REEL_PRICES,
      qtyFaltante: 1,
    };
    const r = suggestForSku('STELLA4000', ctx);
    expect(r.mode).toBe('fallback_sub');
    const skus = r.strict.map((s) => s.sku);
    expect(skus).toContain('STELLA2500'); // -10% ✓
    expect(skus).toContain('STELLA1000'); // -30% exacto ✓
    expect(skus).not.toContain('TWINPOWER4000'); // +50% fuera
  });

  it('sin match mismo sub → afloja a fam → mode fallback_fam', () => {
    const ctx = {
      catalog: REEL_CATALOG,
      attrsBySku: {},
      stockBySku: REEL_STOCK,
      cartSkus: [],
      priceBySku: REEL_PRICES,
      qtyFaltante: 1,
    };
    // TWINPOWER4000: solo hay 1 TWINPOWER en catalog (ella misma, excluida). Mismo fam=Spinning.
    const r = suggestForSku('TWINPOWER4000', ctx);
    expect(r.mode).toBe('fallback_fam');
    const skus = r.approx.map((s) => s.sku);
    expect(skus).toContain('STELLA4000');
    expect(skus).toContain('STELLA2500');
    expect(skus).toContain('STELLA1000');
    expect(skus).not.toContain('OTHER'); // fam distinto Baitcasting
  });

  it('sin match ni sub ni fam → mode none', () => {
    const ctx = {
      catalog: [
        { code: 'UNIQ', desc: 'unique', cat: 'FG', fam: 'Lures', sub: 'Rapala' },
        { code: 'OTHER2', desc: 'other', cat: 'FG', fam: 'Hooks', sub: 'Mustad' },
      ],
      attrsBySku: {},
      stockBySku: { UNIQ: 5, OTHER2: 10 },
      cartSkus: [],
      priceBySku: { UNIQ: 1000, OTHER2: 1500 },
      qtyFaltante: 1,
    };
    const r = suggestForSku('UNIQ', ctx);
    expect(r.mode).toBe('none');
    expect(r.strict).toHaveLength(0);
    expect(r.approx).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('suggestForSku - edge cases', () => {
  it('cartSkus vacio no excluye candidatos', () => {
    // Confirmo que un SKU valido aparece normal cuando no esta en carrito.
    const r = suggestForSku(ORIG_SKU, baseCtx({ cartSkus: [] }));
    const todos = [...r.strict, ...r.approx].map((x) => x.sku);
    expect(todos).toContain('CLC70HA2'); // match strict normal
  });

  it('cartSkus con un match strict → ese match se excluye', () => {
    // Fuerzo que CLC70HA2 este en el carrito. Debe desaparecer de strict.
    const r = suggestForSku(ORIG_SKU, baseCtx({ cartSkus: [CARRITO_SKU, 'CLC70HA2'] }));
    const todos = [...r.strict, ...r.approx].map((x) => x.sku);
    expect(todos).not.toContain('CLC70HA2');
    // Pero CDC72HA (otro strict) sigue
    expect(todos).toContain('CDC72HA');
  });

  it('stockBySku vacio → todos excluidos por stock=0', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx({ stockBySku: {} }));
    expect(r.strict).toHaveLength(0);
    expect(r.approx).toHaveLength(0);
  });

  it('priceBySku vacio no rompe', () => {
    const r = suggestForSku(ORIG_SKU, baseCtx({ priceBySku: {} }));
    expect(r.strict.length).toBeGreaterThan(0); // sigue habiendo matches aunque sin precio
    // precioDelta debe ser 0 cuando no hay precio
    expect(r.strict[0].precio).toBe(0);
  });

  it('desempate: mayor stock primero', () => {
    // Fuerzo 2 candidatos con mismo score
    const ctx = baseCtx({
      catalog: [
        CATALOG[0],
        { code: 'A', desc: 'A', cat: 'CAÑAS', fam: 'FW Casting', sub: 'Clarus' },
        { code: 'B', desc: 'B', cat: 'CAÑAS', fam: 'FW Casting', sub: 'Clarus' },
      ],
      attrsBySku: {
        ...ATTRS,
        A: {
          sku: 'A',
          familia_motor: 'canas',
          tipo: 'Casting',
          tramos: 2,
          libraje_min: 25,
          libraje_max: 35,
          largo_cm: 213,
          accion: 'rapida',
          potencia: 'H',
        },
        B: {
          sku: 'B',
          familia_motor: 'canas',
          tipo: 'Casting',
          tramos: 2,
          libraje_min: 25,
          libraje_max: 35,
          largo_cm: 213,
          accion: 'rapida',
          potencia: 'H',
        },
      },
      stockBySku: { A: 5, B: 20 },
      priceBySku: { CLC70H2PY: 34000, A: 34000, B: 34000 }, // mismo precio
    });
    const r = suggestForSku(ORIG_SKU, ctx);
    expect(r.strict[0].sku).toBe('B'); // mayor stock (20 vs 5)
    expect(r.strict[1].sku).toBe('A');
  });

  it('attrs del original sin familia_motor cae a fallback', () => {
    const ctx = baseCtx({
      attrsBySku: { ...ATTRS, CLC70H2PY: { sku: 'CLC70H2PY' } }, // sin familia_motor
    });
    const r = suggestForSku(ORIG_SKU, ctx);
    // Cae a fallback_sub (misma sub Clarus) o fallback_fam
    expect(['fallback_sub', 'fallback_fam', 'none']).toContain(r.mode);
  });
});
