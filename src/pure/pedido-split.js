// @ts-check
/**
 * v600 E2/E3 (2026-08-24): split de linea al crear/editar pedido.
 *
 * Contexto: bajo la logica pre-E2 (`index.html:20261`), un pedido con qty=100
 * y disp=70 quedaba con 1 linea entera `state='BO'` y `qtyOpen=100`. Cero
 * unidades iban a SAP.
 *
 * Nueva politica (confirmada por Mariano 2026-08-24): partir en 2 lineas
 * cuando `0 < disp < qty`:
 *   - `{qty:disp, qtyOpen:disp, state:'confirmed'}` → viaja a SAP como SQ
 *   - `{qty:qty-disp, qtyOpen:qty-disp, state:'BO'}` → queda como Backorder App
 *
 * Feature flag: `opts.flagEnabled` (default false). Si false, retorna 1 linea
 * con el comportamiento legacy (todo-o-nada). Al principio del rollout el
 * flag esta OFF y se habilita per-user por `localStorage.split_enabled='1'`.
 */

/**
 * @typedef {Object} SplitOpts
 * @property {(sku: string) => number | null} [getDisp] Lookup de disponibilidad SAP dep 11.
 * @property {boolean} [flagEnabled] Si false: legacy todo-o-nada. Si true: split.
 */

/**
 * @typedef {Object} RawLine
 * @property {string} code
 * @property {string} [desc]
 * @property {string} [cat]
 * @property {string} [fam]
 * @property {string} [sub]
 * @property {number | string} qty
 * @property {number | string} precio
 * @property {boolean} [needsReview]
 */

/**
 * @typedef {Object} PedidoLine
 * @property {string} code
 * @property {string} desc
 * @property {string} cat
 * @property {string} fam
 * @property {string} sub
 * @property {number} qty
 * @property {number} precio
 * @property {boolean} needsReview
 * @property {number} qtyOpen
 * @property {number} qtyInvoiced
 * @property {number} qtyCancelled
 * @property {number} qtyRecycled
 * @property {'confirmed'|'BO'|'ASIG'|'invoiced'|'cancelled'|'recycled'|'legacy'} state
 * @property {string|null} asigAt
 * @property {string|null} recycledIntoPedidoId
 * @property {number} priceAtCreation
 */

/**
 * Construye 1 o 2 lineas del pedido a partir de una linea cruda del picker.
 *
 * @param {RawLine} rawLine
 * @param {SplitOpts} [opts]
 * @returns {PedidoLine[]}
 */
export function splitPedidoLine(rawLine, opts = {}) {
  const qty = parseFloat(String(rawLine.qty)) || 0;
  const precio = parseFloat(String(rawLine.precio)) || 0;
  const getDisp = typeof opts.getDisp === 'function' ? opts.getDisp : null;
  const disp = getDisp ? getDisp(rawLine.code) || 0 : 0;

  const base = {
    code: rawLine.code,
    desc: rawLine.desc || '',
    cat: rawLine.cat || '',
    fam: rawLine.fam || '',
    sub: rawLine.sub || '',
    precio,
    needsReview: !!rawLine.needsReview,
    qtyInvoiced: 0,
    qtyCancelled: 0,
    qtyRecycled: 0,
    asigAt: null,
    recycledIntoPedidoId: null,
    priceAtCreation: precio,
  };

  // Feature flag OFF: legacy todo-o-nada.
  if (!opts.flagEnabled) {
    const state = qty > 0 && disp >= qty ? 'confirmed' : 'BO';
    return [{ ...base, qty, qtyOpen: qty, state }];
  }

  // Caso 1: sin qty (edge, no deberia pasar por el picker pero por defensa)
  if (qty <= 0) {
    return [{ ...base, qty: 0, qtyOpen: 0, state: 'BO' }];
  }
  // Caso 2: sin stock disponible → todo BO
  if (disp <= 0) {
    return [{ ...base, qty, qtyOpen: qty, state: 'BO' }];
  }
  // Caso 3: stock suficiente → todo confirmed
  if (disp >= qty) {
    return [{ ...base, qty, qtyOpen: qty, state: 'confirmed' }];
  }
  // Caso 4: stock parcial → split en 2 lineas
  return [
    { ...base, qty: disp, qtyOpen: disp, state: 'confirmed' },
    { ...base, qty: qty - disp, qtyOpen: qty - disp, state: 'BO' },
  ];
}

/**
 * Re-enriquece una linea existente al editar un pedido pendiente. Preserva
 * estados "avanzados" (LOCKED) y no re-splittea lineas `confirmed` (pueden
 * haber viajado a SAP como SQ; splittearlas romperia el lineage). Solo
 * re-evalua lineas `BO` o legacy/undefined.
 *
 * @param {any} existingLine
 * @param {SplitOpts} [opts]
 * @returns {PedidoLine[]}
 */
export function reenrichPedidoLine(existingLine, opts = {}) {
  const LOCKED = new Set(['ASIG', 'invoiced', 'cancelled', 'recycled']);
  const qty = parseFloat(String(existingLine.qty)) || 0;
  const precio = parseFloat(String(existingLine.precio)) || 0;
  const prevState = existingLine.state;
  const qtyInv = parseFloat(String(existingLine.qtyInvoiced)) || 0;
  const qtyCan = parseFloat(String(existingLine.qtyCancelled)) || 0;
  const qtyRec = parseFloat(String(existingLine.qtyRecycled)) || 0;
  const qtyOpen = Math.max(qty - qtyInv - qtyCan - qtyRec, 0);

  // Estado locked: preservar (solo recalcular qtyOpen).
  if (prevState && LOCKED.has(prevState)) {
    return [
      Object.assign(
        {
          qtyInvoiced: 0,
          qtyCancelled: 0,
          qtyRecycled: 0,
          asigAt: null,
          recycledIntoPedidoId: null,
          priceAtCreation: precio,
        },
        existingLine,
        { qtyOpen, state: prevState }
      ),
    ];
  }

  // Estado 'confirmed': puede haber viajado a SAP. NO re-splittear ni cambiar.
  // Solo recalcular qtyOpen.
  if (prevState === 'confirmed') {
    return [
      Object.assign(
        {
          qtyInvoiced: 0,
          qtyCancelled: 0,
          qtyRecycled: 0,
          asigAt: null,
          recycledIntoPedidoId: null,
          priceAtCreation: precio,
        },
        existingLine,
        { qtyOpen, state: 'confirmed' }
      ),
    ];
  }

  // Estado 'BO', 'legacy' o undefined: re-evaluar con stock actual.
  const getDisp = typeof opts.getDisp === 'function' ? opts.getDisp : null;
  const disp = getDisp ? getDisp(existingLine.code) || 0 : 0;

  const baseLine = Object.assign(
    {
      qtyInvoiced: 0,
      qtyCancelled: 0,
      qtyRecycled: 0,
      asigAt: null,
      recycledIntoPedidoId: null,
      priceAtCreation: precio,
    },
    existingLine
  );

  // Feature flag OFF: legacy todo-o-nada sobre qtyOpen.
  if (!opts.flagEnabled) {
    const state = qtyOpen > 0 && disp >= qtyOpen ? 'confirmed' : 'BO';
    return [Object.assign({}, baseLine, { qtyOpen, state })];
  }

  // Nada abierto: preservar sin cambios.
  if (qtyOpen <= 0) {
    return [Object.assign({}, baseLine, { qtyOpen: 0, state: prevState || 'BO' })];
  }
  if (disp <= 0) {
    return [Object.assign({}, baseLine, { qtyOpen, state: 'BO' })];
  }
  if (disp >= qtyOpen) {
    return [Object.assign({}, baseLine, { qtyOpen, state: 'confirmed' })];
  }
  // Split: la linea BO existente se parte en {confirmed disp} + {BO restante}.
  // Preservar qty original para audit no es posible si la partition modifica
  // qty (ya que qty=qtyOpen aca — la linea BO nunca fue invoiced/cancelled/recycled
  // por invariante E1). Cambiar qty es OK porque la linea BO nunca viajo a SAP.
  return [
    Object.assign({}, baseLine, { qty: disp, qtyOpen: disp, state: 'confirmed' }),
    Object.assign({}, baseLine, { qty: qtyOpen - disp, qtyOpen: qtyOpen - disp, state: 'BO' }),
  ];
}
