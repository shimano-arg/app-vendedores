import { describe, expect, it } from 'vitest';
import {
  calcularCotizacion,
  DEFAULT_DISCOUNT_CONFIG,
  formatCotizacionParaWhatsApp,
} from '../../src/pure/preliminar-discount.js';

/** Helper para clonar el default config con overrides opcionales. */
function cfg(over = {}) {
  return {
    ...DEFAULT_DISCOUNT_CONFIG,
    pctCategoria: { ...DEFAULT_DISCOUNT_CONFIG.pctCategoria },
    ...over,
  };
}

describe('preliminar-discount — calcularCotizacion', () => {
  it('subtotal vacío devuelve todo 0', () => {
    const r = calcularCotizacion([], cfg());
    expect(r.subtotalBruto).toBe(0);
    expect(r.total).toBe(0);
    expect(r.nLineas).toBe(0);
    expect(r.nUnidades).toBe(0);
  });

  it('sin descuentos: total = subtotal bruto', () => {
    const lineas = [
      { sku: 'A', qty: 2, precioUnitario: 100 },
      { sku: 'B', qty: 3, precioUnitario: 50 },
    ];
    const r = calcularCotizacion(lineas, cfg());
    expect(r.subtotalBruto).toBe(350);
    expect(r.total).toBe(350);
    expect(r.descTotalMonto).toBe(0);
    expect(r.nLineas).toBe(2);
    expect(r.nUnidades).toBe(5);
  });

  it('categoría P (−15%) aplicada', () => {
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 1000 }];
    const r = calcularCotizacion(lineas, cfg({ categoria: 'P' }));
    expect(r.subtotalBruto).toBe(1000);
    expect(r.descCategoriaPct).toBe(15);
    expect(r.descCategoriaMonto).toBe(150);
    expect(r.total).toBe(850);
  });

  it('categoría B (−5%) aplicada', () => {
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 1000 }];
    const r = calcularCotizacion(lineas, cfg({ categoria: 'B' }));
    expect(r.descCategoriaPct).toBe(5);
    expect(r.total).toBe(950);
  });

  it('categoría C (0%) no descuenta', () => {
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 1000 }];
    const r = calcularCotizacion(lineas, cfg({ categoria: 'C' }));
    expect(r.total).toBe(1000);
  });

  it('volumen aplica si subtotal_post_categoria >= threshold', () => {
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 600000 }];
    const r = calcularCotizacion(lineas, cfg({ categoria: 'C' })); // post-cat = 600k >= 500k
    expect(r.descVolumenPct).toBe(3);
    expect(r.descVolumenMonto).toBe(18000);
    expect(r.subtotalPostVolumen).toBe(600000 - 18000);
  });

  it('volumen NO aplica si post-categoria < threshold (aunque bruto sí)', () => {
    // Bruto 550k, cat P (−15%) → post-cat 467.500 < 500k → volumen NO aplica.
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 550000 }];
    const r = calcularCotizacion(lineas, cfg({ categoria: 'P' }));
    expect(r.subtotalPostCategoria).toBe(467500);
    expect(r.descVolumenPct).toBe(0);
    expect(r.descVolumenMonto).toBe(0);
  });

  it('contado aplica solo si categoría P o A', () => {
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 100000 }];
    const rP = calcularCotizacion(lineas, cfg({ categoria: 'P', pagaContado: true }));
    const rB = calcularCotizacion(lineas, cfg({ categoria: 'B', pagaContado: true }));
    expect(rP.descContadoPct).toBe(5);
    expect(rB.descContadoPct).toBe(0);
  });

  it('contado sin categoría no aplica', () => {
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 100000 }];
    const r = calcularCotizacion(lineas, cfg({ categoria: '', pagaContado: true }));
    expect(r.descContadoPct).toBe(0);
  });

  it('cascada completa: P + volumen + contado en el mismo pedido', () => {
    // Bruto 1M, P 15% = 850k, vol 3% = 824.500, contado 5% = 783.275 → round 783275.
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 1000000 }];
    const r = calcularCotizacion(lineas, cfg({ categoria: 'P', pagaContado: true }));
    expect(r.subtotalBruto).toBe(1000000);
    expect(r.subtotalPostCategoria).toBe(850000);
    expect(r.descVolumenMonto).toBe(25500); // 850000 × 0.03
    expect(r.subtotalPostVolumen).toBe(824500);
    expect(r.descContadoMonto).toBe(41225); // 824500 × 0.05
    expect(r.total).toBe(783275);
    expect(r.descTotalMonto).toBe(1000000 - 783275);
    // %efectivo total ≈ 21.67%
    expect(r.descTotalPctEfectivo).toBeCloseTo(21.6725, 3);
  });

  it('razones de descuento reflejan aplicabilidad', () => {
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 100000 }];
    // B con contado → contado NO aplica pero se lista con "NO aplica"
    const r = calcularCotizacion(lineas, cfg({ categoria: 'B', pagaContado: true }));
    const contadoRow = r.razonesDescuento.find((x) => x.motivo.includes('Contado'));
    expect(contadoRow).toBeDefined();
    expect(contadoRow.aplica).toBe(false);
    expect(contadoRow.motivo).toContain('NO aplica');
  });

  it('líneas inválidas (qty=0 o precio=0) se ignoran', () => {
    const lineas = [
      { sku: 'A', qty: 0, precioUnitario: 100 },
      { sku: 'B', qty: 2, precioUnitario: 0 },
      { sku: 'C', qty: 1, precioUnitario: 500 },
    ];
    const r = calcularCotizacion(lineas, cfg());
    expect(r.subtotalBruto).toBe(500);
    expect(r.nLineas).toBe(3); // nLineas cuenta el array raw, unidades no
    expect(r.nUnidades).toBe(1);
  });

  it('pct fuera de rango se clampea (defensivo)', () => {
    const lineas = [{ sku: 'A', qty: 1, precioUnitario: 1000 }];
    const r = calcularCotizacion(
      lineas,
      cfg({ categoria: 'P', pctCategoria: { P: 200, A: 10, B: 5, C: 0 } })
    );
    expect(r.descCategoriaPct).toBe(100); // clamp a 100
    expect(r.total).toBe(0);
  });

  it('formato WhatsApp incluye líneas + total + descuentos aplicados', () => {
    const lineas = [
      { sku: 'REEL4000', desc: 'Shimano Stella 4000 FI', qty: 2, precioUnitario: 180000 },
    ];
    const r = calcularCotizacion(lineas, cfg({ categoria: 'A' }));
    const txt = formatCotizacionParaWhatsApp(lineas, r);
    expect(txt).toContain('*Cotización preliminar Shimano*');
    expect(txt).toContain('2× REEL4000 — Shimano Stella 4000 FI');
    expect(txt).toContain('$180.000 c/u = $360.000');
    expect(txt).toContain('Categoría A (−10%)');
    expect(txt).toContain('*Total: $324.000*');
  });

  it('formato WhatsApp con título extra', () => {
    const r = calcularCotizacion([{ sku: 'X', qty: 1, precioUnitario: 100 }], cfg());
    const txt = formatCotizacionParaWhatsApp(
      [{ sku: 'X', qty: 1, precioUnitario: 100 }],
      r,
      'Feria 2026'
    );
    expect(txt).toContain('Feria 2026');
  });
});
