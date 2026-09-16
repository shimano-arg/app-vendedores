// v953 (2026-09-16): filtro puro para docs de revision_waitlist.
// Extraido de index.html:15008 para poder testear + reusar.
//
// Invariante: los waitlist docs marcados como `stage: 'consumed'` NO
// deben aparecer en la UI. Se marcan asi post-pedidos.add() como
// defense-in-depth: si el delete falla por permisos, el update de
// stage=consumed sigue funcionando y esconde la card del sidebar.
//
// Ver README §41 (v953) para el contexto del bug: VDE re-confirmaba el
// mismo pedido 3 veces creando SQs duplicadas en SAP porque la card no
// desaparecia de "Lista de Espera" cuando el delete fallaba.

/**
 * Decide si un doc de revision_waitlist debe incluirse en la UI.
 * @param {Object} data — el `d.data()` del Firestore doc
 * @returns {boolean} true si incluir, false si skipear
 */
export function shouldIncludeWaitlistDoc(data) {
  if (!data || typeof data !== 'object') return false;
  // Skipear docs consumidos.
  if (data.stage === 'consumed') return false;
  return true;
}
