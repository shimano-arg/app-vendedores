// @ts-check
/**
 * v1397 (2026-10-21) §40.5 — Plan de reversión ASIG → BO al confirmar CPST.
 *
 * Regla: una asignación solo existe con respaldo físico. Cuando el VDE pasa
 * por "Crear Pedido Desde Stock Asignado" y el stock físico libre para el
 * cliente HOY no alcanza para cubrir el nominal, las unidades no entregables
 * no quedan como ASIG viva — vuelven a cola BO. El SKU entrará en reparto
 * cuando ingrese mercadería.
 *
 * Esta función es PURA. Dado un listado de `entries` (cada entry representa
 * una línea ASIG original en un pedido previo con su `qtyAsignada` que el
 * flow CPST piensa consumir) y `qtyAjustadaTotal` (total entregable que va
 * al waitlist), devuelve un plan de acciones por entry — qué hacer con la
 * línea original en Firestore:
 *
 *   - `keep`: la línea se mantiene como está (toda al waitlist, bloque v1280
 *     cancela cuando VDE confirme el pedido final).
 *   - `split`: la línea se splittea — una parte queda ASIG qty=qtyKeep (va al
 *     waitlist) y una parte revierte a BO qty=qtyRevert con audit fields.
 *   - `revert_full`: la línea entera revierte a BO (state mutado, qty igual).
 *
 * El reparto es FIFO: los entries se procesan en el orden recibido (los
 * primeros consumen el `restante` disponible primero). El caller debe ordenar
 * `entries` por `asigAt` ASC o similar antes de llamar.
 *
 * Precedente: BENGOCHEA 597151, ASIG 6 fisico 2 → entregable 2 → 1 entry split
 * qtyKeep=2 qtyRevert=4. LA LOMITA OUTDOORS EXGC66MHBAR 1u / EXGC66HBAR 2u →
 * fisico 0 → 1 entry revert_full qtyRevert=1 (y 2).
 */

/**
 * @typedef {Object} AsigEntry
 * @property {string} pedidoId
 * @property {number} [lineIndex]
 * @property {number} qtyAsignada
 * @property {string} [state]
 */

/**
 * @typedef {Object} RevertAction
 * @property {AsigEntry} entry
 * @property {'keep'|'split'|'revert_full'} action
 * @property {number} qtyKeep  Unidades que mantienen state=ASIG (van al waitlist).
 * @property {number} qtyRevert Unidades que revierten a state=BO.
 */

/**
 * @param {AsigEntry[]} entries — ordenados FIFO por asigAt ASC.
 * @param {number} qtyAjustadaTotal — total entregable (0 si recorte 100%).
 * @returns {RevertAction[]}
 */
export function computeCpstRevertPlan(entries, qtyAjustadaTotal) {
  /** @type {RevertAction[]} */
  const out = [];
  let restante = Math.max(0, Number(qtyAjustadaTotal) || 0);
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    const q = Number(entry && entry.qtyAsignada) || 0;
    if (q <= 0) continue;
    if (restante <= 0) {
      out.push({
        entry,
        action: /** @type {'revert_full'} */ ('revert_full'),
        qtyKeep: 0,
        qtyRevert: q,
      });
      continue;
    }
    if (q <= restante) {
      out.push({ entry, action: /** @type {'keep'} */ ('keep'), qtyKeep: q, qtyRevert: 0 });
      restante -= q;
    } else {
      out.push({
        entry,
        action: /** @type {'split'} */ ('split'),
        qtyKeep: restante,
        qtyRevert: q - restante,
      });
      restante = 0;
    }
  }
  return out;
}

/**
 * Suma total de unidades a revertir en un plan.
 * @param {RevertAction[]} plan
 * @returns {number}
 */
export function sumRevertUnits(plan) {
  if (!Array.isArray(plan)) return 0;
  return plan.reduce((s, a) => s + (Number(a && a.qtyRevert) || 0), 0);
}
