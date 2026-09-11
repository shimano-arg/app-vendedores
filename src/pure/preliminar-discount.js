// @ts-check
/**
 * Pedido Preliminar — cotizador de show room.
 * ================================================================
 *
 * Cálculo puro de subtotal + descuentos en cascada para el modal
 * "🎪 Pedido Preliminar" (v868, 2026-09-11).
 *
 * Contexto: Mariano organiza una feria donde vienen prospects/clientes
 * y quieren saber "si te pido tanto de X y tanto de Y, cuánto me
 * queda con mi descuento de categoría, con contado, con volumen".
 * Todo en memoria — NO persiste, NO impacta stock, NO va a SAP.
 *
 * ================================================================
 * Reglas de descuento (defaults; editables en el modal):
 *
 * 1. **Categoría cliente** (mutuamente exclusivas):
 *      P → -15%
 *      A → -10%
 *      B →  -5%
 *      C →   0%
 *
 * 2. **Volumen** (acumulable):
 *      Si subtotal_post_categoria >= VOL_THRESHOLD → aplica VOL_PCT extra
 *      Default: THRESHOLD $500.000, PCT 3%
 *
 * 3. **Contado** (solo si categoria es P o A):
 *      Si pagaContado == true → aplica CONTADO_PCT extra
 *      Default: 5%
 *
 * Orden de aplicación: bruto → −categoría → −volumen → −contado.
 * Todos se aplican sobre el subtotal RESIDUAL (compuesto, no aditivo).
 * Ej: bruto 1000, cat 15%, vol 3%, contado 5%:
 *   post_cat  = 1000 × (1 − 0.15) = 850
 *   post_vol  =  850 × (1 − 0.03) = 824.5
 *   post_cont =  824.5 × (1 − 0.05) = 783.275 → 783 (redondeo entero)
 */

/**
 * @typedef {Object} Linea
 * @property {string} sku
 * @property {string} [desc]
 * @property {number} qty
 * @property {number} precioUnitario
 */

/**
 * @typedef {Object} DiscountConfig
 * @property {'P'|'A'|'B'|'C'|''} categoria
 * @property {boolean} pagaContado
 * @property {{P: number, A: number, B: number, C: number}} pctCategoria  Porcentajes 0-100.
 * @property {number} volThreshold                                          Umbral en ARS.
 * @property {number} pctVolumen                                            Porcentaje 0-100.
 * @property {number} pctContado                                            Porcentaje 0-100.
 */

/**
 * @typedef {Object} CotizacionResult
 * @property {number} subtotalBruto              qty × precio de cada línea.
 * @property {number} descCategoriaMonto         ARS descontados por categoría.
 * @property {number} descCategoriaPct           % efectivo aplicado (0-100).
 * @property {number} subtotalPostCategoria
 * @property {number} descVolumenMonto
 * @property {number} descVolumenPct             0 si no aplica.
 * @property {number} subtotalPostVolumen
 * @property {number} descContadoMonto
 * @property {number} descContadoPct             0 si no aplica.
 * @property {number} total                      Redondeo entero.
 * @property {number} descTotalMonto             Suma total descontada.
 * @property {number} descTotalPctEfectivo       % efectivo total (0-100).
 * @property {number} nLineas
 * @property {number} nUnidades                  Suma de qty.
 * @property {Array<{aplica: boolean, motivo: string}>} razonesDescuento
 */

/**
 * Default config con los valores razonables acordados con Mariano 2026-09-11.
 */
export const DEFAULT_DISCOUNT_CONFIG = Object.freeze({
  categoria: /** @type {'P'|'A'|'B'|'C'|''} */ (''),
  pagaContado: false,
  pctCategoria: { P: 15, A: 10, B: 5, C: 0 },
  volThreshold: 500000,
  pctVolumen: 3,
  pctContado: 5,
});

/**
 * Calcula subtotal + cascada de descuentos.
 *
 * @param {Linea[]} lineas
 * @param {DiscountConfig} config
 * @returns {CotizacionResult}
 */
export function calcularCotizacion(lineas, config) {
  const arr = Array.isArray(lineas) ? lineas : [];
  const nLineas = arr.length;
  let nUnidades = 0;
  let subtotalBruto = 0;
  for (const l of arr) {
    const qty = Number(l && l.qty) || 0;
    const precio = Number(l && l.precioUnitario) || 0;
    if (qty <= 0 || precio <= 0) continue;
    subtotalBruto += qty * precio;
    nUnidades += qty;
  }

  const razones = [];

  // 1) Categoria
  const cat = config && config.categoria ? config.categoria : '';
  const catPct = cat && config.pctCategoria ? Number(config.pctCategoria[cat] || 0) : 0;
  const descCategoriaPct = Math.max(0, Math.min(100, catPct));
  const descCategoriaMonto = Math.round(subtotalBruto * (descCategoriaPct / 100));
  const subtotalPostCategoria = subtotalBruto - descCategoriaMonto;
  if (cat) {
    razones.push({
      aplica: descCategoriaPct > 0,
      motivo: `Categoría ${cat} (−${descCategoriaPct}%)`,
    });
  }

  // 2) Volumen (sobre subtotal post-categoria)
  const volThreshold = Math.max(0, Number(config.volThreshold) || 0);
  const pctVolumenCfg = Math.max(0, Math.min(100, Number(config.pctVolumen) || 0));
  const volAplica = volThreshold > 0 && subtotalPostCategoria >= volThreshold && pctVolumenCfg > 0;
  const descVolumenPct = volAplica ? pctVolumenCfg : 0;
  const descVolumenMonto = Math.round(subtotalPostCategoria * (descVolumenPct / 100));
  const subtotalPostVolumen = subtotalPostCategoria - descVolumenMonto;
  if (volThreshold > 0) {
    razones.push({
      aplica: volAplica,
      motivo: `Volumen ≥ $${volThreshold.toLocaleString('es-AR')} (−${pctVolumenCfg}%)`,
    });
  }

  // 3) Contado (solo P/A, sobre subtotal post-volumen)
  const pagaContado = Boolean(config && config.pagaContado);
  const contadoElegible = cat === 'P' || cat === 'A';
  const pctContadoCfg = Math.max(0, Math.min(100, Number(config.pctContado) || 0));
  const contadoAplica = pagaContado && contadoElegible && pctContadoCfg > 0;
  const descContadoPct = contadoAplica ? pctContadoCfg : 0;
  const descContadoMonto = Math.round(subtotalPostVolumen * (descContadoPct / 100));
  const total = subtotalPostVolumen - descContadoMonto;

  if (pagaContado) {
    razones.push({
      aplica: contadoAplica,
      motivo: contadoElegible
        ? `Contado (solo P/A) (−${pctContadoCfg}%)`
        : 'Contado NO aplica (solo P/A)',
    });
  }

  const descTotalMonto = subtotalBruto - total;
  const descTotalPctEfectivo = subtotalBruto > 0 ? (descTotalMonto / subtotalBruto) * 100 : 0;

  return {
    subtotalBruto,
    descCategoriaMonto,
    descCategoriaPct,
    subtotalPostCategoria,
    descVolumenMonto,
    descVolumenPct,
    subtotalPostVolumen,
    descContadoMonto,
    descContadoPct,
    total,
    descTotalMonto,
    descTotalPctEfectivo,
    nLineas,
    nUnidades,
    razonesDescuento: razones,
  };
}

/**
 * Serializa la cotización a un texto WhatsApp-friendly (multi-línea,
 * emojis discretos, formato ARS es-AR).
 *
 * @param {Linea[]} lineas
 * @param {CotizacionResult} r
 * @param {string} [tituloExtra]  Opcional, va después de "Cotización preliminar Shimano".
 * @returns {string}
 */
export function formatCotizacionParaWhatsApp(lineas, r, tituloExtra) {
  /** @param {number} n */
  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  const arr = Array.isArray(lineas) ? lineas : [];
  const partes = [];
  partes.push('*Cotización preliminar Shimano*' + (tituloExtra ? ' — ' + tituloExtra : ''));
  partes.push('');
  for (const l of arr) {
    const qty = Number(l && l.qty) || 0;
    const precio = Number(l && l.precioUnitario) || 0;
    if (qty <= 0 || precio <= 0) continue;
    const sub = qty * precio;
    partes.push(`${qty}× ${l.sku}${l.desc ? ' — ' + l.desc : ''}`);
    partes.push(`   ${fmt(precio)} c/u = ${fmt(sub)}`);
  }
  partes.push('');
  partes.push(`Subtotal: ${fmt(r.subtotalBruto)}`);
  for (const rz of r.razonesDescuento) {
    if (rz.aplica) partes.push(`  ${rz.motivo}`);
  }
  partes.push('');
  partes.push(`*Total: ${fmt(r.total)}*`);
  if (r.descTotalMonto > 0) {
    partes.push(
      `(Descuento total: ${fmt(r.descTotalMonto)} = −${r.descTotalPctEfectivo.toFixed(1)}%)`
    );
  }
  return partes.join('\n');
}
