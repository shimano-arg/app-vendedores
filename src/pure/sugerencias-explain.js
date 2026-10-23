// @ts-check
/**
 * Textos y helpers de explicacion para el modal "Sugerencias de productos".
 *
 * Objetivo: hacer que la UI sea autoexplicativa sin cambiar la logica del motor
 * de matching (src/pure/product-suggestions.js). Expone:
 *  - LEYENDA: texto corto para mostrar arriba de la lista de SKUs faltantes.
 *  - TOOLTIP_FALTAN: definicion de "Faltan N u".
 *  - TOOLTIP_ALTERNATIVAS: definicion de "N estrictas / M aproximadas".
 *  - explicarMatch({ familia, mode, badge, origAttrs, candAttrs }):
 *      Devuelve { etiqueta, coinciden[], difieren[] } para describir por que
 *      un candidato quedo clasificado como estricto o aproximado del nivel N.
 *
 * 100% puro: cero DOM, cero fetch, cero globals.
 */

/**
 * Texto corto que explica, en una linea, que significan las dos cifras de
 * cada SKU faltante y la diferencia entre estrictos y aproximados.
 */
export const LEYENDA =
  'Por cada producto sin stock te mostramos cuantas unidades faltan y cuantos sustitutos hay con stock libre. ' +
  'Estrictos = misma familia y mismas caracteristicas clave. ' +
  'Aproximados = parecidos pero con alguna diferencia (aflojan libraje, luego tamano/tramos/hebras, y por ultimo solo mismo tipo).';

/**
 * Definicion exacta del contador "Faltan N u" tal como se muestra en el
 * resumen de cada banda. Fuente: _sugFaltantesPorItem (index.html).
 */
export const TOOLTIP_FALTAN =
  'Unidades de este SKU que el pedido no puede cubrir con stock libre. ' +
  'Faltan = cantidad pedida - stock libre para la venta ' +
  '(stock fisico deposito 11 menos todo lo comprometido: confirmado en SAP, backorder, stock asignado y waitlist CPST).';

/**
 * Definicion de los dos contadores "N estrictas - M aproximadas" en el
 * resumen de cada banda. Resume §5 del design doc v1346.
 */
export const TOOLTIP_ALTERNATIVAS =
  'Estrictas: coinciden en todas las caracteristicas clave del producto ' +
  '(canas: mismo tipo + mismos tramos + libraje con overlap >=50%; ' +
  'reels: mismo tipo + tamano exacto + velocidad; ' +
  'lineas: misma marca + mismas hebras + libraje con diferencia <=2 lb; ' +
  'resto: mismo modelo con precio dentro de +-30%). ' +
  'Aproximadas: parecidas pero con alguna diferencia. Se afloja progresivamente: ' +
  'primero libraje/velocidad, despues tramos/tamano/hebras, y por ultimo queda solo "mismo tipo" o "misma familia".';

/**
 * @typedef {Object} ExplainInput
 * @property {'canas'|'reels'|'lineas'|'fallback_sub'|'fallback_fam'|'none'} mode
 *   Modo que devolvio suggestForSku (segun familia del SKU original).
 * @property {'ok'|'warn1'|'warn2'|'warn3'} badge
 *   Badge que suggestForSku asigno al candidato.
 * @property {Record<string, any>|null|undefined} [origAttrs]
 *   Atributos del SKU original (items_attrs/{origSku}).
 * @property {Record<string, any>|null|undefined} [candAttrs]
 *   Atributos del SKU candidato (items_attrs/{candSku}).
 */

/**
 * @typedef {Object} ExplainOutput
 * @property {string} etiqueta  Texto compacto listo para mostrar.
 * @property {string[]} coinciden  Atributos que coinciden entre original y candidato.
 * @property {string[]} difieren   Atributos que no coinciden o fueron relajados.
 */

/**
 * Explica por que un candidato quedo clasificado como estricto (ok) o
 * aproximado (warn1/warn2/warn3). Lee los attrs cuando estan disponibles
 * para enriquecer el detalle; si no, cae en una explicacion generica por
 * nivel.
 *
 * @param {ExplainInput} input
 * @returns {ExplainOutput}
 */
export function explicarMatch(input) {
  const { mode, badge } = input;
  const orig = input.origAttrs || null;
  const cand = input.candAttrs || null;

  // Fallbacks no estructurados (sin items_attrs): fallback_sub y fallback_fam.
  if (mode === 'fallback_sub') {
    return {
      etiqueta: 'Match estricto: mismo modelo y precio dentro de +-30%.',
      coinciden: ['mismo modelo', 'precio +-30%'],
      difieren: [],
    };
  }
  if (mode === 'fallback_fam') {
    return {
      etiqueta: 'Match aproximado: misma familia, el modelo no coincide.',
      coinciden: ['misma familia'],
      difieren: ['modelo'],
    };
  }

  if (mode === 'canas') return explicarCanas(badge, orig, cand);
  if (mode === 'reels') return explicarReels(badge, orig, cand);
  if (mode === 'lineas') return explicarLineas(badge, orig, cand);

  return { etiqueta: '', coinciden: [], difieren: [] };
}

/**
 * @param {'ok'|'warn1'|'warn2'|'warn3'} badge
 * @param {Record<string, any>|null} orig
 * @param {Record<string, any>|null} cand
 * @returns {ExplainOutput}
 */
function explicarCanas(badge, orig, cand) {
  /** @type {string[]} */
  const coinciden = [];
  /** @type {string[]} */
  const difieren = [];
  const tipoLabel = cand && cand.tipo ? 'tipo (' + cand.tipo + ')' : 'tipo';
  const tramosLabel = cand && cand.tramos != null ? 'tramos (' + cand.tramos + ')' : 'tramos';
  const librajeLabel =
    cand && cand.libraje_min != null && cand.libraje_max != null
      ? 'libraje (' + cand.libraje_min + '-' + cand.libraje_max + ' lb)'
      : 'libraje';

  if (badge === 'ok') {
    coinciden.push(tipoLabel, tramosLabel, librajeLabel + ' con overlap >=50%');
    return {
      etiqueta:
        'Match estricto: coincide tipo, tramos y libraje con overlap >=50% del rango menor.',
      coinciden,
      difieren,
    };
  }
  if (badge === 'warn1') {
    coinciden.push(tipoLabel, tramosLabel);
    difieren.push(librajeLabel + ' con overlap <50%');
    return {
      etiqueta:
        'Match aproximado: coincide tipo y tramos; el libraje se superpone pero con overlap <50%.',
      coinciden,
      difieren,
    };
  }
  if (badge === 'warn2') {
    coinciden.push(tipoLabel, tramosLabel);
    difieren.push('libraje (no se comparo)');
    return {
      etiqueta: 'Match muy aproximado: coincide tipo y tramos; se dejo de exigir libraje.',
      coinciden,
      difieren,
    };
  }
  // warn3
  coinciden.push(tipoLabel);
  difieren.push('tramos', 'libraje');
  return {
    etiqueta: 'Solo mismo tipo: no coinciden tramos ni libraje. Ultimo recurso.',
    coinciden,
    difieren,
  };
}

/**
 * @param {'ok'|'warn1'|'warn2'|'warn3'} badge
 * @param {Record<string, any>|null} orig
 * @param {Record<string, any>|null} cand
 * @returns {ExplainOutput}
 */
function explicarReels(badge, orig, cand) {
  /** @type {string[]} */
  const coinciden = [];
  /** @type {string[]} */
  const difieren = [];
  const tipoLabel = cand && cand.tipo ? 'tipo (' + cand.tipo + ')' : 'tipo';
  const tamLabel = cand && cand.tamano != null ? 'tamano (' + cand.tamano + ')' : 'tamano';
  const velLabel = cand && cand.velocidad ? 'velocidad (' + cand.velocidad + ')' : 'velocidad';

  if (badge === 'ok') {
    coinciden.push(tipoLabel, tamLabel, velLabel);
    return {
      etiqueta: 'Match estricto: coincide tipo, tamano exacto y velocidad.',
      coinciden,
      difieren,
    };
  }
  if (badge === 'warn1') {
    coinciden.push(tipoLabel, tamLabel);
    difieren.push(velLabel);
    return {
      etiqueta: 'Match aproximado: coincide tipo y tamano exacto; la velocidad no coincide.',
      coinciden,
      difieren,
    };
  }
  if (badge === 'warn2') {
    coinciden.push(tipoLabel);
    difieren.push(tamLabel + ' (dentro de +-30%)');
    return {
      etiqueta:
        'Match muy aproximado: coincide tipo; el tamano esta cerca (+-30%) pero no es igual.',
      coinciden,
      difieren,
    };
  }
  // warn3
  coinciden.push(tipoLabel);
  difieren.push('tamano', 'velocidad');
  return {
    etiqueta: 'Solo mismo tipo: tamano y velocidad no coinciden.',
    coinciden,
    difieren,
  };
}

/**
 * @param {'ok'|'warn1'|'warn2'|'warn3'} badge
 * @param {Record<string, any>|null} orig
 * @param {Record<string, any>|null} cand
 * @returns {ExplainOutput}
 */
function explicarLineas(badge, orig, cand) {
  /** @type {string[]} */
  const coinciden = [];
  /** @type {string[]} */
  const difieren = [];
  const marcaLabel = cand && cand.marca ? 'marca (' + cand.marca + ')' : 'marca';
  const hebrasLabel = cand && cand.hebras != null ? 'hebras (' + cand.hebras + ')' : 'hebras';
  const librajeLabel =
    cand && cand.libraje != null ? 'libraje (' + cand.libraje + ' lb)' : 'libraje';

  if (badge === 'ok') {
    coinciden.push(marcaLabel, hebrasLabel, librajeLabel + ' (diferencia <=2 lb)');
    return {
      etiqueta: 'Match estricto: coincide marca, hebras y libraje con diferencia <=2 lb.',
      coinciden,
      difieren,
    };
  }
  if (badge === 'warn1') {
    coinciden.push(marcaLabel, hebrasLabel);
    difieren.push(librajeLabel + ' (diferencia <=5 lb)');
    return {
      etiqueta: 'Match aproximado: coincide marca y hebras; el libraje difiere pero <=5 lb.',
      coinciden,
      difieren,
    };
  }
  if (badge === 'warn2') {
    coinciden.push(marcaLabel, hebrasLabel);
    difieren.push('libraje (no se comparo)');
    return {
      etiqueta: 'Match muy aproximado: coincide marca y hebras; se dejo de exigir libraje.',
      coinciden,
      difieren,
    };
  }
  // warn3
  coinciden.push(marcaLabel);
  difieren.push('hebras', 'libraje');
  return {
    etiqueta: 'Solo misma marca: hebras y libraje no coinciden.',
    coinciden,
    difieren,
  };
}
