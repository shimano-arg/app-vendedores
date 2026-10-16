// @ts-check
/**
 * Motor de sugerencias de productos para SKUs sin stock libre suficiente.
 *
 * HARD filters cañas: tipo + tramos + libraje (overlap >= 50% rango menor).
 * SOFT rank: mismo modelo (sub) → mismo largo → misma acción → precio cercano.
 * Fallback no-cañas: mismo sub + precio ±30%, afloja a mismo fam.
 *
 * Aflojado progresivo (nivel 0..3) para boton "Ver aproximadas".
 *
 * 100% puro: cero DOM, cero fetch, cero globals, cero firebase. Todo por parametro.
 */

/**
 * @typedef {Object} ProductItem
 * @property {string} code
 * @property {string} [desc]
 * @property {string} [cat]
 * @property {string} [fam]
 * @property {string} [sub]
 */

/**
 * @typedef {Object} AttrsDoc
 * @property {string} sku
 * @property {'canas'|'reels'|'lineas'|null} [familia_motor]
 * Shared (canas):
 * @property {string|null} [tipo]
 * @property {number|'variable'|null} [tramos]
 * @property {number|null} [libraje_min]
 * @property {number|null} [libraje_max]
 * @property {number|null} [largo_cm]
 * @property {string|null} [largo_display]
 * @property {string|null} [accion]
 * @property {string|null} [potencia]
 * Reels (v1347):
 * @property {number|null} [tamano]
 * @property {'regular'|'HG'|'XG'|'PG'|null} [velocidad]
 * Lineas (v1347):
 * @property {string|null} [marca]
 * @property {number|null} [hebras]
 * @property {number|null} [libraje]
 * @property {number|null} [largo_m]
 * @property {number|null} [largo_yd]
 * Meta:
 * @property {string[]} [warnings]
 */

/**
 * @typedef {Object} SuggestionContext
 * @property {ProductItem[]} catalog Todos los items del catalogo.
 * @property {Record<string, AttrsDoc>} attrsBySku Backfill items_attrs por SKU.
 * @property {Record<string, number>} stockBySku Stock libre por SKU.
 * @property {string[]} cartSkus SKUs ya en el carrito (se excluyen).
 * @property {Record<string, number>} priceBySku Precio por SKU.
 * @property {number} qtyFaltante Cantidad faltante (candidato debe tener >= stock).
 */

/**
 * @typedef {Object} SuggestionResult
 * @property {Array<ScoredSuggestion>} strict Nivel 0 (match exacto).
 * @property {Array<ScoredSuggestion>} approx Niveles 1+2+3 agrupados (orden: 1 primero).
 * @property {'canas'|'reels'|'lineas'|'fallback_sub'|'fallback_fam'|'none'} mode
 * @property {string} [error] 'SKU_NOT_IN_CATALOG' si original no esta en catalog
 */

/**
 * @typedef {Object} ScoredSuggestion
 * @property {string} sku
 * @property {number} score
 * @property {'ok'|'warn1'|'warn2'|'warn3'} badge
 * @property {number} stockLibre
 * @property {number} precio
 * @property {number} precioDelta Diferencia absoluta con el original.
 * @property {number} precioDeltaPct Porcentaje de delta (puede ser negativo).
 */

/**
 * Calcula el ratio de overlap entre dos rangos [a_min, a_max] y [b_min, b_max].
 * Devuelve un valor en [0, 1] relativo al rango menor.
 * Si ambos rangos tienen width=0 (single value), devuelve 1 si son iguales, 0 si no.
 * @param {number | null | undefined} a_min
 * @param {number | null | undefined} a_max
 * @param {number | null | undefined} b_min
 * @param {number | null | undefined} b_max
 */
export function overlapRatio(a_min, a_max, b_min, b_max) {
  if (
    a_min == null ||
    a_max == null ||
    b_min == null ||
    b_max == null ||
    Number.isNaN(a_min) ||
    Number.isNaN(a_max) ||
    Number.isNaN(b_min) ||
    Number.isNaN(b_max)
  ) {
    return 0;
  }
  const overlap = Math.max(0, Math.min(a_max, b_max) - Math.max(a_min, b_min));
  const widthA = a_max - a_min;
  const widthB = b_max - b_min;
  const minWidth = Math.min(widthA, widthB);
  if (minWidth <= 0) {
    // Ambos single-value: match solo si son iguales (o si rangos iguales)
    return a_min === b_min && a_max === b_max ? 1 : 0;
  }
  return overlap / minWidth;
}

/**
 * Determina si un candidato pasa los HARD filters de un nivel dado (CAÑAS).
 * Nivel 0: tipo + tramos + libraje (overlap >= 50%)
 * Nivel 1: tipo + tramos + libraje (overlap > 0)
 * Nivel 2: tipo + tramos (sin libraje)
 * Nivel 3: solo tipo
 * @param {AttrsDoc | null | undefined} origAttrs
 * @param {AttrsDoc | null | undefined} candAttrs
 * @param {number} level
 */
export function passHard(origAttrs, candAttrs, level) {
  if (!origAttrs || !candAttrs) return false;
  // Tipo nunca se afloja
  if (!origAttrs.tipo || !candAttrs.tipo) return false;
  if (origAttrs.tipo !== candAttrs.tipo) return false;
  if (level >= 3) return true;

  // Tramos
  if (origAttrs.tramos == null || candAttrs.tramos == null) return false;
  if (origAttrs.tramos !== candAttrs.tramos) return false;
  if (level >= 2) return true;

  // Libraje
  if (
    origAttrs.libraje_min == null ||
    origAttrs.libraje_max == null ||
    candAttrs.libraje_min == null ||
    candAttrs.libraje_max == null
  ) {
    return false;
  }
  const ratio = overlapRatio(
    origAttrs.libraje_min,
    origAttrs.libraje_max,
    candAttrs.libraje_min,
    candAttrs.libraje_max
  );
  if (level === 0) return ratio >= 0.5;
  if (level === 1) return ratio > 0;
  return false;
}

/**
 * Determina si un candidato REEL pasa los HARD filters por nivel.
 * HARD: tipo + tamano + velocidad.
 * Nivel 0: tipo igual + tamaño igual + velocidad igual
 * Nivel 1: tipo igual + tamaño igual + velocidad distinta
 * Nivel 2: tipo igual + tamaño cercano (±30%) + velocidad cualquiera
 * Nivel 3: solo tipo
 * @param {AttrsDoc | null | undefined} origAttrs
 * @param {AttrsDoc | null | undefined} candAttrs
 * @param {number} level
 */
export function passHardReel(origAttrs, candAttrs, level) {
  if (!origAttrs || !candAttrs) return false;
  if (!origAttrs.tipo || !candAttrs.tipo) return false;
  if (origAttrs.tipo !== candAttrs.tipo) return false;
  if (level >= 3) return true;

  // Tamaño
  if (origAttrs.tamano == null || candAttrs.tamano == null) return false;
  if (level === 2) {
    const diff = Math.abs(candAttrs.tamano - origAttrs.tamano) / origAttrs.tamano;
    return diff <= 0.3;
  }
  if (origAttrs.tamano !== candAttrs.tamano) return false;
  if (level === 1) return true;

  // Velocidad (nivel 0)
  if (!origAttrs.velocidad || !candAttrs.velocidad) return false;
  return origAttrs.velocidad === candAttrs.velocidad;
}

/**
 * Determina si un candidato LINEA pasa los HARD filters por nivel.
 * HARD: marca + hebras + libraje.
 * Nivel 0: marca igual + hebras igual + libraje exacto (±2 lb)
 * Nivel 1: marca igual + hebras igual + libraje ±5 lb
 * Nivel 2: marca igual + hebras igual (sin libraje)
 * Nivel 3: marca igual (sin hebras ni libraje)
 * @param {AttrsDoc | null | undefined} origAttrs
 * @param {AttrsDoc | null | undefined} candAttrs
 * @param {number} level
 */
export function passHardLinea(origAttrs, candAttrs, level) {
  if (!origAttrs || !candAttrs) return false;
  if (!origAttrs.marca || !candAttrs.marca) return false;
  if (origAttrs.marca !== candAttrs.marca) return false;
  if (level >= 3) return true;

  if (origAttrs.hebras == null || candAttrs.hebras == null) return false;
  if (origAttrs.hebras !== candAttrs.hebras) return false;
  if (level >= 2) return true;

  if (origAttrs.libraje == null || candAttrs.libraje == null) return false;
  const diff = Math.abs(candAttrs.libraje - origAttrs.libraje);
  if (level === 0) return diff <= 2;
  if (level === 1) return diff <= 5;
  return false;
}

/**
 * Calcula score SOFT rank para ordenar candidatos.
 * Mayor score = mejor match semantico.
 * @param {string} originalSku
 * @param {string} candCode
 * @param {ProductItem} original
 * @param {ProductItem} candidate
 * @param {AttrsDoc | undefined} origAttrs
 * @param {AttrsDoc | undefined} candAttrs
 * @param {Record<string, number>} priceBySku
 */
export function computeSoftScore(
  originalSku,
  candCode,
  original,
  candidate,
  origAttrs,
  candAttrs,
  priceBySku
) {
  let score = 0;
  // Mismo modelo (sub)
  if (original.sub && candidate.sub && original.sub === candidate.sub) {
    score += 100;
  }
  // Mismo largo (±15 cm)
  if (origAttrs && candAttrs && origAttrs.largo_cm != null && candAttrs.largo_cm != null) {
    if (Math.abs(candAttrs.largo_cm - origAttrs.largo_cm) <= 15) {
      score += 50;
    }
  }
  // Misma accion
  if (
    origAttrs &&
    candAttrs &&
    origAttrs.accion &&
    candAttrs.accion &&
    origAttrs.accion === candAttrs.accion
  ) {
    score += 30;
  }
  // Precio: bonus mayor cuanto menor sea el delta absoluto en %
  const origPrice = priceBySku[originalSku] || 0;
  const candPrice = priceBySku[candCode] || 0;
  if (origPrice > 0) {
    const deltaPct = Math.abs((candPrice - origPrice) / origPrice) * 100;
    score += Math.max(-50, Math.min(50, 50 - deltaPct));
  }
  return score;
}

/**
 * SOFT rank para REELS: mismo sub (modelo) + tamaño cercano + precio.
 * @param {string} originalSku
 * @param {string} candCode
 * @param {ProductItem} original
 * @param {ProductItem} candidate
 * @param {AttrsDoc | undefined} origAttrs
 * @param {AttrsDoc | undefined} candAttrs
 * @param {Record<string, number>} priceBySku
 */
export function computeSoftScoreReel(
  originalSku,
  candCode,
  original,
  candidate,
  origAttrs,
  candAttrs,
  priceBySku
) {
  let score = 0;
  if (original.sub && candidate.sub && original.sub === candidate.sub) score += 100;
  if (origAttrs && candAttrs && origAttrs.tamano != null && candAttrs.tamano != null) {
    if (origAttrs.tamano === candAttrs.tamano) score += 60;
    else {
      const diff = Math.abs(candAttrs.tamano - origAttrs.tamano) / origAttrs.tamano;
      score += Math.max(0, 50 - diff * 100);
    }
  }
  if (
    origAttrs &&
    candAttrs &&
    origAttrs.velocidad &&
    candAttrs.velocidad &&
    origAttrs.velocidad === candAttrs.velocidad
  ) {
    score += 30;
  }
  const origPrice = priceBySku[originalSku] || 0;
  const candPrice = priceBySku[candCode] || 0;
  if (origPrice > 0) {
    const deltaPct = Math.abs((candPrice - origPrice) / origPrice) * 100;
    score += Math.max(-50, Math.min(50, 50 - deltaPct));
  }
  return score;
}

/**
 * SOFT rank para LINEAS: mismo sub + largo cercano + precio.
 * @param {string} originalSku
 * @param {string} candCode
 * @param {ProductItem} original
 * @param {ProductItem} candidate
 * @param {AttrsDoc | undefined} origAttrs
 * @param {AttrsDoc | undefined} candAttrs
 * @param {Record<string, number>} priceBySku
 */
export function computeSoftScoreLinea(
  originalSku,
  candCode,
  original,
  candidate,
  origAttrs,
  candAttrs,
  priceBySku
) {
  let score = 0;
  if (original.sub && candidate.sub && original.sub === candidate.sub) score += 100;
  // Largo similar (en metros, 1 yd = 0.9144 m)
  if (origAttrs && candAttrs) {
    const origM =
      origAttrs.largo_m ??
      (origAttrs.largo_yd != null ? Math.round(origAttrs.largo_yd * 0.9144) : null);
    const candM =
      candAttrs.largo_m ??
      (candAttrs.largo_yd != null ? Math.round(candAttrs.largo_yd * 0.9144) : null);
    if (origM != null && candM != null) {
      if (origM === candM) score += 50;
      else {
        const diff = Math.abs(candM - origM) / origM;
        score += Math.max(0, 40 - diff * 100);
      }
    }
    // Libraje cercano (ya pasaron HARD, bonus por exactitud)
    if (origAttrs.libraje != null && candAttrs.libraje != null) {
      const diff = Math.abs(candAttrs.libraje - origAttrs.libraje);
      score += Math.max(0, 30 - diff * 5);
    }
  }
  const origPrice = priceBySku[originalSku] || 0;
  const candPrice = priceBySku[candCode] || 0;
  if (origPrice > 0) {
    const deltaPct = Math.abs((candPrice - origPrice) / origPrice) * 100;
    score += Math.max(-50, Math.min(50, 50 - deltaPct));
  }
  return score;
}

/**
 * Ordena un array de candidatos con score precalculado. Desempate: mayor stock -> menor precio.
 * @param {ScoredSuggestion[]} items
 * @param {Record<string, number>} stockBySku
 * @param {Record<string, number>} priceBySku
 */
function sortByScoreDesc(items, stockBySku, priceBySku) {
  return items.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const stockA = stockBySku[a.sku] || 0;
    const stockB = stockBySku[b.sku] || 0;
    if (stockB !== stockA) return stockB - stockA;
    const priceA = priceBySku[a.sku] || 0;
    const priceB = priceBySku[b.sku] || 0;
    return priceA - priceB;
  });
}

/**
 * @param {string} code
 * @param {'ok'|'warn1'|'warn2'|'warn3'} badge
 * @param {number} score
 * @param {Record<string, number>} stockBySku
 * @param {Record<string, number>} priceBySku
 * @param {number} originalPrice
 */
function buildScored(code, badge, score, stockBySku, priceBySku, originalPrice) {
  const precio = priceBySku[code] || 0;
  const precioDelta = precio - (originalPrice || 0);
  const precioDeltaPct = originalPrice > 0 ? (precioDelta / originalPrice) * 100 : 0;
  return {
    sku: code,
    score,
    badge,
    stockLibre: stockBySku[code] || 0,
    precio,
    precioDelta,
    precioDeltaPct,
  };
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} pct
 */
function withinPct(a, b, pct) {
  if (!b || b <= 0) return false;
  return Math.abs((a - b) / b) <= pct;
}

/**
 * Entry point del motor.
 * @param {string} originalSku
 * @param {SuggestionContext} context
 * @returns {SuggestionResult}
 */
export function suggestForSku(originalSku, context) {
  const { catalog, attrsBySku, stockBySku, cartSkus, priceBySku, qtyFaltante } = context;
  const original = catalog.find((p) => p.code === originalSku);
  if (!original) {
    return { strict: [], approx: [], mode: 'none', error: 'SKU_NOT_IN_CATALOG' };
  }
  const originalPrice = priceBySku[originalSku] || 0;
  const cartSet = new Set(cartSkus || []);

  // Filtro base: candidato debe tener stock suficiente, no estar en carrito, no ser el original
  const candidates = catalog.filter(
    (p) =>
      p.code !== originalSku && !cartSet.has(p.code) && (stockBySku[p.code] || 0) >= qtyFaltante
  );

  const origAttrs = attrsBySku[originalSku];
  const familia = origAttrs && origAttrs.familia_motor;

  // Motor estructurado por familia (canas/reels/lineas).
  if (familia === 'canas' || familia === 'reels' || familia === 'lineas') {
    const passFn =
      familia === 'canas' ? passHard : familia === 'reels' ? passHardReel : passHardLinea;
    const scoreFn =
      familia === 'canas'
        ? computeSoftScore
        : familia === 'reels'
          ? computeSoftScoreReel
          : computeSoftScoreLinea;
    const strict = [];
    const approx1 = [];
    const approx2 = [];
    const approx3 = [];
    for (const c of candidates) {
      const candAttrs = attrsBySku[c.code];
      if (!candAttrs || candAttrs.familia_motor !== familia) continue;
      const score = scoreFn(originalSku, c.code, original, c, origAttrs, candAttrs, priceBySku);
      if (passFn(origAttrs, candAttrs, 0)) {
        strict.push(buildScored(c.code, 'ok', score, stockBySku, priceBySku, originalPrice));
      } else if (passFn(origAttrs, candAttrs, 1)) {
        approx1.push(buildScored(c.code, 'warn1', score, stockBySku, priceBySku, originalPrice));
      } else if (passFn(origAttrs, candAttrs, 2)) {
        approx2.push(buildScored(c.code, 'warn2', score, stockBySku, priceBySku, originalPrice));
      } else if (passFn(origAttrs, candAttrs, 3)) {
        approx3.push(buildScored(c.code, 'warn3', score, stockBySku, priceBySku, originalPrice));
      }
    }
    return {
      strict: sortByScoreDesc(strict, stockBySku, priceBySku),
      approx: [
        ...sortByScoreDesc(approx1, stockBySku, priceBySku),
        ...sortByScoreDesc(approx2, stockBySku, priceBySku),
        ...sortByScoreDesc(approx3, stockBySku, priceBySku),
      ],
      mode: familia,
    };
  }

  // Fallback no-cañas: mismo sub + precio ±30%, afloja a mismo fam
  const sameSub = candidates.filter(
    (c) =>
      c.sub &&
      original.sub &&
      c.sub === original.sub &&
      withinPct(priceBySku[c.code] || 0, originalPrice, 0.3)
  );
  if (sameSub.length > 0) {
    const scored = sameSub.map((c) => {
      const price = priceBySku[c.code] || 0;
      const delta = Math.abs(price - originalPrice);
      // Score inverso al delta (menor delta = mayor score)
      return buildScored(c.code, 'ok', -delta, stockBySku, priceBySku, originalPrice);
    });
    return {
      strict: sortByScoreDesc(scored, stockBySku, priceBySku),
      approx: [],
      mode: 'fallback_sub',
    };
  }

  const sameFam = candidates.filter((c) => c.fam && original.fam && c.fam === original.fam);
  if (sameFam.length > 0) {
    const scored = sameFam.map((c) => {
      const price = priceBySku[c.code] || 0;
      const delta = Math.abs(price - originalPrice);
      return buildScored(c.code, 'warn1', -delta, stockBySku, priceBySku, originalPrice);
    });
    return {
      strict: [],
      approx: sortByScoreDesc(scored, stockBySku, priceBySku),
      mode: 'fallback_fam',
    };
  }

  return { strict: [], approx: [], mode: 'none' };
}
