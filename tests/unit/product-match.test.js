import { describe, expect, it } from 'vitest';
import { matchSkuFromTitle } from '../../src/pure/product-match.js';

// SKU_INDEX ejemplo: keys son SKUs normalizados (por normTitle) → productos.
const skuIndex = {
  REEL4000FI: [{ sku: 'REEL-4000-FI', name: 'Shimano Stella 4000' }],
  REEL4000: [{ sku: 'REEL-4000', name: 'Shimano Stradic 4000' }],
  CANA6MH: [{ sku: 'CANA-6MH', name: 'Caña 6ft MH' }],
};
const skuTokens = {
  REEL: [{ sku: 'FAM-REEL-DEFAULT', name: 'Reel genérico' }],
  CANA: [{ sku: 'FAM-CANA-DEFAULT', name: 'Caña genérica' }],
};

describe('matchSkuFromTitle', () => {
  it('happy: match exacto de SKU específico', () => {
    // El título tiene que contener el texto que aparece como key en el
    // índice (normalizado). "REEL 4000 FI" en el título → "REEL4000FI"
    // tras normTitle → matchea la key.
    // "Reel 4000 FI" en el título → tras normTitle "REEL4000FI" (contiguo,
    // sin nada en el medio) → matchea la key exacta del skuIndex.
    const r = matchSkuFromTitle('Reel 4000 FI Shimano oferta', skuIndex, skuTokens);
    expect(r?.[0].sku).toBe('REEL-4000-FI');
  });

  it('happy: SKU más específico gana (longest match)', () => {
    // "REEL4000" substring en "REEL4000FI", pero elige el más largo.
    const r = matchSkuFromTitle('Reel 4000 FI', skuIndex, skuTokens);
    expect(r?.[0].sku).toBe('REEL-4000-FI');
  });

  it('happy: fallback a familia si no matchea SKU específico', () => {
    const r = matchSkuFromTitle('Reel spinning genérico marca X', skuIndex, skuTokens);
    expect(r?.[0].sku).toBe('FAM-REEL-DEFAULT');
  });

  it('edge: título sin match → null', () => {
    const r = matchSkuFromTitle('Boya de plástico azul', skuIndex, skuTokens);
    expect(r).toBeNull();
  });

  it('edge: título con caracteres raros normaliza vía normTitle', () => {
    const r = matchSkuFromTitle('REEL-4000/FI (nuevo!)', skuIndex, skuTokens);
    expect(r?.[0].sku).toBe('REEL-4000-FI');
  });

  it('edge: null/undefined title → null', () => {
    expect(matchSkuFromTitle(null, skuIndex, skuTokens)).toBeNull();
    expect(matchSkuFromTitle(undefined, skuIndex, skuTokens)).toBeNull();
  });

  it('edge: skuIndex vacío → cae a skuTokens', () => {
    const r = matchSkuFromTitle('caña 6ft', {}, skuTokens);
    expect(r?.[0].sku).toBe('FAM-CANA-DEFAULT');
  });
});
