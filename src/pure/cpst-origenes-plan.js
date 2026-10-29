// @ts-check
/**
 * v1521 (2026-10-29) — Pre-flight de "Crear Pedido Desde Stock Asignado"
 * tolerante a asignaciones huérfanas.
 *
 * Antes: `_cpstConfirmar` (index.html) re-buscaba la línea origen con
 * `lines.findIndex(code===sku && state===ASIG)`. Si el pedido tenía una ASIG
 * zombie del mismo SKU (qtyOpen=0, dejada por revertSobreAsignadas con
 * entregable 0) ANTES de la ASIG viva, el findIndex caía en la zombie y el
 * pre-flight bloqueaba el pedido entero: "linea con qtyOpen=0" + "faltaron Nu".
 * Precedente: REBORN SRL CLC66H2PY 2026-10-29 09:08.
 *
 * Ahora:
 *   1. Se usa `entry.lineIndex` (lo setea `_cpstBuildCache`) si la línea en ese
 *      índice sigue siendo del SKU, del state esperado y con qtyOpen>0.
 *   2. Si no, fallback: primera línea del SKU+state con qtyOpen>0 no usada.
 *   3. Si no hay ninguna, la entry es HUÉRFANA: se omite (no bloquea) y se
 *      reporta para aviso al vendedor + log `asig_huerfana`.
 *
 * Pura: recibe los pedidos ya leídos.
 */

/**
 * @typedef {Object} CpstEntry
 * @property {string} pedidoId
 * @property {number} [lineIndex]
 * @property {number} qty
 * @property {string} [state]
 */

/**
 * @typedef {Object} CpstSkuInput
 * @property {string} sku
 * @property {number} qtyAjustada
 * @property {CpstEntry[]} [entries]
 */

/**
 * @typedef {Object} AsigHuerfana
 * @property {string} sku
 * @property {string} pedidoId
 * @property {number|null} lineIndex
 * @property {'pedido_no_encontrado'|'linea_no_encontrada'|'qtyOpen_cero'} motivo
 * @property {string|null} lineState
 * @property {number|null} lineQtyOpen
 * @property {number} qtyEsperada
 */

/**
 * @param {any} line
 * @param {string} skuUp
 * @param {string} state
 */
function _lineaUsable(line, skuUp, state) {
  return (
    !!line &&
    String(line.code || '').toUpperCase() === skuUp &&
    line.state === state &&
    (Number(line.qtyOpen) || 0) > 0
  );
}

/**
 * @param {CpstSkuInput[]} skus
 * @param {Map<string, {lines?: any[]}>} pedidosById
 * @returns {{
 *   pedidosOrigenes: Array<{pedidoId:string, lineIndex:number, sku:string, qtyAsignada:number}>,
 *   huerfanas: AsigHuerfana[],
 *   cubiertoPorSku: Record<string, number>,
 *   faltantePorSku: Record<string, number>,
 * }}
 */
export function planCpstOrigenes(skus, pedidosById) {
  /** @type {Array<{pedidoId:string, lineIndex:number, sku:string, qtyAsignada:number}>} */
  const pedidosOrigenes = [];
  /** @type {AsigHuerfana[]} */
  const huerfanas = [];
  /** @type {Record<string, number>} */
  const cubiertoPorSku = {};
  /** @type {Record<string, number>} */
  const faltantePorSku = {};
  // Líneas ya consumidas (pedidoId|lineIndex) para no usar dos veces la misma.
  const usadas = new Set();

  for (const sk of Array.isArray(skus) ? skus : []) {
    const total = Math.max(0, Number(sk && sk.qtyAjustada) || 0);
    if (total <= 0) continue;
    const skuUp = String(sk.sku || '').toUpperCase();
    let restante = total;
    for (const entry of sk.entries || []) {
      if (restante <= 0) break;
      const pid = String((entry && entry.pedidoId) || '');
      const st = (entry && entry.state) || 'ASIG';
      const qtyEsperada = Number(entry && entry.qty) || 0;
      const hintIdx = Number.isInteger(entry && entry.lineIndex) ? Number(entry.lineIndex) : null;
      const p = pid ? pedidosById.get(pid) : undefined;
      const lines = p && Array.isArray(p.lines) ? p.lines : null;
      if (!lines) {
        huerfanas.push({
          sku: sk.sku,
          pedidoId: pid,
          lineIndex: hintIdx,
          motivo: 'pedido_no_encontrado',
          lineState: null,
          lineQtyOpen: null,
          qtyEsperada,
        });
        continue;
      }
      let idx = -1;
      if (
        hintIdx !== null &&
        !usadas.has(pid + '|' + hintIdx) &&
        _lineaUsable(lines[hintIdx], skuUp, st)
      ) {
        idx = hintIdx;
      } else {
        idx = lines.findIndex((l, i) => !usadas.has(pid + '|' + i) && _lineaUsable(l, skuUp, st));
      }
      if (idx < 0) {
        const ref = hintIdx !== null ? lines[hintIdx] : undefined;
        const refOk = ref && String(ref.code || '').toUpperCase() === skuUp;
        huerfanas.push({
          sku: sk.sku,
          pedidoId: pid,
          lineIndex: refOk ? hintIdx : null,
          motivo: refOk ? 'qtyOpen_cero' : 'linea_no_encontrada',
          lineState: refOk ? ref.state || null : null,
          lineQtyOpen: refOk ? Number(ref.qtyOpen) || 0 : null,
          qtyEsperada,
        });
        continue;
      }
      usadas.add(pid + '|' + idx);
      const toAssign = Math.min(Number(lines[idx].qtyOpen) || 0, restante);
      pedidosOrigenes.push({ pedidoId: pid, lineIndex: idx, sku: sk.sku, qtyAsignada: toAssign });
      restante -= toAssign;
    }
    cubiertoPorSku[sk.sku] = total - restante;
    if (restante > 0) faltantePorSku[sk.sku] = restante;
  }
  return { pedidosOrigenes, huerfanas, cubiertoPorSku, faltantePorSku };
}

/**
 * Aviso para el vendedor (§68: sin jerga). Una línea por producto.
 * @param {Record<string, number>} faltantePorSku
 * @returns {string}
 */
export function formatAsigHuerfanaAviso(faltantePorSku) {
  return Object.entries(faltantePorSku || {})
    .filter(([, n]) => (Number(n) || 0) > 0)
    .map(([sku, n]) =>
      n === 1
        ? '1 unidad de ' + sku + ' ya no está disponible, avisale a Mariano.'
        : n + ' unidades de ' + sku + ' ya no están disponibles, avisale a Mariano.'
    )
    .join('\n');
}
