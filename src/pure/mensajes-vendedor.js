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
  // Gate de rol server-side (commitPedidoCF, updatePedidoLinesCF,
  // fetchStockLiveCF, geminiOcrProxy, releaseAsigCF): permission-denied con
  // details.errorCode='ROLE_REQUIRED'. Reintentar no sirve.
  ROLE_REQUIRED: {
    texto:
      'Tu usuario todavía no tiene permiso para esta acción. Pedile a Mariano que te asigne un rol.',
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

  // Códigos nuevos del servidor (2026-11-24). Llegan en `details.errorCode`
  // del error de la función (o en `errorCode` del resultado de commitPedidoCF).
  // Falla transitoria al leer el permiso del usuario: reintentar sirve.
  ROLE_CHECK_UNAVAILABLE: {
    texto:
      'No pudimos verificar tu permiso en este momento. Volvé a intentar en un minuto; si sigue, avisale a Mariano.',
  },
  // Vendedor interno (VDI) sobre un pedido u orden fuera de su pareja
  // (updatePedidoLinesCF, movePedidoToWaitlistCF, releaseAsigCF,
  // updateAsigLineStateCF, unifyWaitlistsCF). Reintentar no sirve.
  INTERNO_FUERA_DE_PAREJA: {
    texto:
      'Este pedido es de otro vendedor y no lo podés modificar. Si tenés que cambiarlo, pedíselo a su vendedor o a Mariano.',
  },
  // movePedidoToWaitlistCF: el interno solo pasa a espera pedidos propios.
  INTERNO_SOLO_PEDIDO_PROPIO: {
    texto:
      'Solo podés pasar a espera pedidos que cargaste vos. Para este pedido, pedíselo a su vendedor.',
  },
  // releaseAsigCF: al pedido de origen le falta el dato del cliente.
  CLIENT_DATA_MISSING: {
    texto:
      'No pudimos liberar la reserva porque al pedido le falta el dato del cliente. Avisale a Mariano o a un administrador.',
  },
  // releaseAsigCF: la reserva pertenece a otro cliente.
  RELEASE_CROSS_CLIENT: {
    texto:
      'No pudimos liberar la reserva porque pertenece a otro cliente. Revisá la orden y, si sigue, avisale a Mariano.',
  },
  // commitPedidoCF / fetchStockLiveCF: límite de productos por pedido.
  TOO_MANY_SKUS: {
    texto:
      'El pedido tiene demasiados productos para procesarlo de una vez. Dividilo en dos o más pedidos y volvé a intentar.',
  },
  // geminiOcrProxy: no se pudo leer el comprobante.
  GEMINI_OCR_FAILED: {
    texto:
      'No pudimos leer el comprobante. Completá los datos a mano o volvé a intentar en un minuto.',
  },
  // Reenvío de mails del planner.
  EMAIL_SEND_FAILED: {
    texto: 'No pudimos enviar el mail. Volvé a intentar en un minuto; si sigue, avisale a Mariano.',
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

/**
 * Detecta el rechazo del gate de rol server-side: HttpsError
 * `permission-denied` con `details.errorCode === 'ROLE_REQUIRED'`.
 * Acepta también `e.details.errorCode` sin code (por si el SDK cambia el
 * prefijo) y errores ya normalizados con `errorCode` en la raíz.
 *
 * @param {any} e
 * @returns {boolean}
 */
export function isRoleRequiredError(e) {
  if (!e || typeof e !== 'object') return false;
  const details = e.details && typeof e.details === 'object' ? e.details : null;
  if (details && details.errorCode === 'ROLE_REQUIRED') return true;
  if (e.errorCode === 'ROLE_REQUIRED') return true;
  return false;
}

/**
 * Códigos de error del servidor que tienen mensaje propio para el vendedor y
 * que el cliente muestra tal cual, sin texto técnico del error original.
 */
export const SERVER_ERROR_CODES_MAPEADOS = Object.freeze([
  'ROLE_REQUIRED',
  'ROLE_CHECK_UNAVAILABLE',
  'INTERNO_FUERA_DE_PAREJA',
  'INTERNO_SOLO_PEDIDO_PROPIO',
  'CLIENT_DATA_MISSING',
  'RELEASE_CROSS_CLIENT',
  'TOO_MANY_SKUS',
  'GEMINI_OCR_FAILED',
  'EMAIL_SEND_FAILED',
]);

/**
 * Extrae el errorCode de negocio de un error de función: `details.errorCode`
 * (HttpsError) o `errorCode` en la raíz (resultado ya normalizado). Devuelve
 * '' si no hay.
 *
 * @param {any} e
 * @returns {string}
 */
export function getServerErrorCode(e) {
  if (!e || typeof e !== 'object') return '';
  const details = e.details && typeof e.details === 'object' ? e.details : null;
  const raw = (details && details.errorCode) || e.errorCode || '';
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

/**
 * Si el error trae uno de los códigos de `SERVER_ERROR_CODES_MAPEADOS`,
 * devuelve el mensaje completo para el vendedor (con el código técnico al
 * final). Si no, devuelve null y el call-site decide su propio mensaje.
 *
 * @param {any} e
 * @returns {string|null}
 */
export function formatServerErrorAlert(e) {
  const code = getServerErrorCode(e);
  if (!code || !SERVER_ERROR_CODES_MAPEADOS.includes(code)) return null;
  return formatMensajeConCodigo(code);
}
