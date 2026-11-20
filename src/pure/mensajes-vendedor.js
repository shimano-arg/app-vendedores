// @ts-check
/**
 * mensajes-vendedor (v1471, 2026-10-26) — §68 CLAUDE.md.
 *
 * REGLA: todo mensaje de error que ve un vendedor se escribe para alguien
 * que no es técnico. Formato:
 *   - Una oración que dice QUÉ PASÓ.
 *   - Una oración que dice QUÉ HACER.
 *   - Nada más.
 *
 * PROHIBIDO en el texto principal:
 *   - Códigos: STOCK_CHANGED, CONTENTION_RETRY_EXHAUSTED,
 *     UNRESOLVED_BO_ENTRY_ROWS, VERSION_OLD, CLIENT_HAS_OPEN_WAITLIST,
 *     SNAPSHOT_TOO_OLD, VALIDATION_ERROR, PERMISSION_DENIED, SAP_UNAVAILABLE,
 *     INTERNAL, UNKNOWN.
 *   - Palabras: snapshot, transacción/transaccion, concurrencia, SKU, payload,
 *     batch, Firestore, undefined, backend, server, callable, request.
 *
 * El código técnico va al FINAL, separado, en una línea aparte, para que el
 * vendedor lo mande por WhatsApp. Formato: `Código técnico: <ERRORCODE>`.
 *
 * ÚNICA fuente de verdad. Todos los `alert()` / `confirm()` relacionados con
 * errores de commitPedidoCF, releaseAsigCF y guardado de lista de espera
 * leen de aquí.
 */

/**
 * @typedef {Object} MensajeVendedor
 * @property {string} texto    Dos oraciones máx. qué pasó + qué hacer.
 * @property {string} [confirmLabel]   Para errorCodes que ofrecen reintentar
 *   con un confirm() (STOCK_CHANGED, VERSION_OLD).
 */

/**
 * Mapa de errorCode → mensaje humano.
 *
 * @type {Record<string, MensajeVendedor>}
 */
export const MENSAJES_VENDEDOR = Object.freeze({
  // Guardado de lista de espera (TAREA 1 cliente).
  SAVE_WAITLIST_FAILED: {
    texto: 'No pudimos guardar los cambios. Volvé a intentar; si sigue pasando, avisale a Mariano.',
  },

  // Dashboard de Ventas (2026-10-29).
  DASHBOARD_VENTAS_FAILED: {
    texto:
      'No pudimos cargar el tablero de ventas. Volvé a intentar en un minuto; si sigue pasando, avisale a Mariano.',
  },

  // PR 3 §74 — cliente en master pero vendor sin UID resolvible.
  VENDOR_UID_MISSING: {
    texto:
      'Este cliente tiene vendedor asignado pero no pudimos encontrar su usuario. Avisale a Mariano con el nombre del cliente antes de volver a intentar.',
  },

  // commitPedidoCF errorCodes.
  STOCK_CHANGED: {
    texto:
      'No pudimos confirmar el pedido porque el stock cambió mientras lo revisabas. Tocá Aceptar para confirmarlo igual; lo que no haya queda esperando stock.',
    confirmLabel: 'Confirmar igual',
  },
  CONTENTION_RETRY_EXHAUSTED_REAL: {
    texto:
      'Este pedido quedó trabado por un intento anterior. Esperá 10 segundos y volvé a tocar Pasar a Pendientes.',
  },
  CONTENTION_RETRY_EXHAUSTED_OTRO: {
    texto:
      'No pudimos confirmar el pedido por un error del sistema. Avisale a Mariano con la hora exacta y el cliente.',
  },
  UNRESOLVED_BO_ENTRY_ROWS: {
    texto:
      'Tenés productos marcados en rojo sin revisar. Para cada uno, elegí si son las mismas unidades o son más.',
  },
  CLIENT_HAS_OPEN_WAITLIST: {
    texto:
      'Este cliente ya tiene otra orden abierta esperando. Primero cerrá o unificá esa orden y después volvé.',
  },
  SNAPSHOT_TOO_OLD: {
    texto:
      'El pedido no se puede confirmar ahora porque los datos de stock están viejos. Queda en espera; cuando se actualicen lo volvemos a intentar solos.',
  },
  VERSION_OLD: {
    texto: 'Hay una versión nueva de la app. Tocá Aceptar para actualizar.',
    confirmLabel: 'Actualizar ahora',
  },
  VALIDATION_ERROR: {
    texto:
      'Algo del pedido no está completo. Revisá los datos del cliente y los productos; si sigue pasando, avisale a Mariano.',
  },
  PERMISSION_DENIED: {
    texto:
      'Tu usuario no tiene permiso para esta acción. Cerrá sesión y volvé a entrar; si sigue, avisale a Mariano.',
  },
  SAP_UNAVAILABLE: {
    texto:
      'No pudimos consultar el stock al sistema porque no responde. Esperá un minuto y volvé a intentar.',
  },
  INTERNAL: {
    texto:
      'Hubo un error inesperado al confirmar el pedido. Volvé a intentar en un minuto; si sigue, avisale a Mariano.',
  },
  UNKNOWN: {
    texto: 'No pudimos confirmar el pedido. Avisale a Mariano con la hora y el cliente.',
  },
  // v1547: excepción no prevista dentro de doConfirmPedido (antes era muda).
  CONFIRM_EXCEPTION: {
    texto:
      'No pudimos pasar el pedido a Pendientes por un error del sistema. Sacale una captura a este mensaje y mandásela a Mariano.',
  },

  // §105 commitPedidoCF: inconsistencia en referencias ASIG del pedido CPST.
  // Caso típico: entre que el VDE armó el pedido CPST y lo pasó a pendientes,
  // alguna reserva del cliente cambió (fue consumida, cancelada o facturada
  // por otro flow), y el payload referencia una línea que ya no corresponde.
  // El servidor aborta la tx completa (pedido derivado NO se crea) para
  // evitar persistir inconsistencias (ver informe 032).
  ASIG_REF_INVALID: {
    texto:
      'No pudimos confirmar el pedido porque una de las reservas del cliente cambió. Volvé a entrar a Stock Asignado y rearmá la selección; si sigue, avisale a Mariano.',
  },

  // §91 (Fix D12 2026-11-20) commitPedidoCF: el descuento calculado en
  // pantalla no coincide con el detalle. Puede pasar si el vendedor forzó
  // valores desde la consola o si hubo un bug en el cálculo cliente.
  DISCOUNT_COHERENCE_MISMATCH: {
    texto:
      'El descuento del pedido no coincide con el detalle de la pantalla. Cerrá el pedido y volvé a abrirlo para recalcular; si sigue, avisale a Mariano.',
  },

  // releaseAsigCF errorCodes (quitar producto / rechazo CPST).
  RELEASE_PERMISSION_DENIED: {
    texto:
      'Tu usuario no puede modificar esta orden. Cerrá sesión y volvé a entrar; si sigue, avisale a Mariano.',
  },
  RELEASE_WAITLIST_NOT_FOUND: {
    texto: 'Esta orden ya no está disponible. Refrescá la pantalla.',
  },
  RELEASE_INVALID_ACTION: {
    texto:
      'No pudimos aplicar el cambio porque la acción no es válida. Avisale a Mariano con la hora exacta.',
  },
  RELEASE_FAILED: {
    texto: 'No pudimos quitar el producto. Volvé a intentar; si sigue, avisale a Mariano.',
  },
});

/**
 * Palabras prohibidas en el texto principal (regla §68).
 *
 * El test `tests/unit/mensajes-vendedor.test.js` verifica que ningún texto
 * contiene estas palabras.
 */
export const PALABRAS_PROHIBIDAS = Object.freeze([
  // Códigos.
  'STOCK_CHANGED',
  'CONTENTION_RETRY_EXHAUSTED',
  'UNRESOLVED_BO_ENTRY_ROWS',
  'VERSION_OLD',
  'CLIENT_HAS_OPEN_WAITLIST',
  'SNAPSHOT_TOO_OLD',
  'VALIDATION_ERROR',
  'PERMISSION_DENIED',
  'SAP_UNAVAILABLE',
  'DISCOUNT_COHERENCE_MISMATCH',
  // Jerga técnica.
  'snapshot',
  'transacción',
  'transaccion',
  'concurrencia',
  'SKU',
  'payload',
  'batch',
  'Firestore',
  'undefined',
  'backend',
  'callable',
]);

/**
 * Devuelve el mensaje humanizado para un errorCode. Si el code no está
 * mapeado, devuelve el fallback UNKNOWN.
 *
 * @param {string} errorCode
 * @returns {MensajeVendedor}
 */
export function getMensajeParaErrorCode(errorCode) {
  const code = String(errorCode || '')
    .trim()
    .toUpperCase();
  return MENSAJES_VENDEDOR[code] || MENSAJES_VENDEDOR.UNKNOWN;
}

/**
 * Formatea el mensaje completo con el código técnico al final.
 *
 * Formato:
 *   "<texto>
 *
 *   Código técnico: <ERRORCODE>"
 *
 * @param {string} errorCode
 * @param {{ incluirCodigoTecnico?: boolean }} [opts]
 * @returns {string}
 */
export function formatMensajeConCodigo(errorCode, opts) {
  const m = getMensajeParaErrorCode(errorCode);
  const incluir = !opts || opts.incluirCodigoTecnico !== false;
  if (!incluir) return m.texto;
  const codeTecnico = String(errorCode || 'UNKNOWN')
    .trim()
    .toUpperCase();
  return `${m.texto}\n\nCódigo técnico: ${codeTecnico}`;
}

// Nota (incidente Federico 2026-11-20): `formatProductosNoCargadosEnSap` fue
// removida junto con el gate `SKU_NOT_IN_SAP_CATALOG` del CF. Los SKUs sin
// alta en SAP ya no rechazan el pedido entero: CAPA (c) de
// `auto-send-sap-core.js` los deja en BO + marca `_degradedReason='sap_item_
// not_found_app_only'` + manda email a Mariano. El VDE ya no ve un cartel
// que lo culpe por un SKU recién creado que todavía no llegó al catálogo SAP.
