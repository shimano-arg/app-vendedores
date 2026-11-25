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
//
// v1573 (2026-11-25): defensa-en-profundidad adicional — si un doc
// tiene `closedAt` seteado (por script cleanup externo, cancelacion
// admin, migracion, cualquier otra ruta), tambien queda fuera del
// sidebar. Un doc cerrado NO debe aparecer en la UI aunque le falte
// el stage='consumed'. Precedente 2026-11-24: script
// `asig_ref_invalid_sku_cleanup` dejo 2 waitlists con `closedAt != null`
// + `stage === undefined` que aparecian vacias en el sidebar
// (ORDEN 927 CASA FERRACIOLI + ORDEN 939 ESTACION DINKELDEIN).

/**
 * Decide si un doc de revision_waitlist debe incluirse en la UI.
 * @param {{ stage?: string, closedAt?: any, [key: string]: any } | null | undefined} data — el `d.data()` del Firestore doc
 * @returns {boolean} true si incluir, false si skipear
 */
export function shouldIncludeWaitlistDoc(data) {
  if (!data || typeof data !== 'object') return false;
  // Skipear docs consumidos (invariante v953).
  if (data.stage === 'consumed') return false;
  // v1573 (2026-11-25): skipear docs cerrados aunque les falte el stage.
  // closedAt puede ser ISO string, Firestore Timestamp, o Date. Todos truthy.
  if (data.closedAt) return false;
  return true;
}
