// @ts-check
/**
 * v1535 (APP-02) — textos del boton "Sincronizar con SAP" del Master de
 * Clientes. Fuente unica (CLAUDE.md §68): lenguaje simple; en errores, el
 * codigo tecnico va al final en una linea aparte.
 */

export const SYNC_CLIENTES_SAP_TEXTOS = Object.freeze({
  boton: 'Sincronizar con SAP',
  sincronizando: 'Sincronizando…',
  sinNuevos: 'Sincronización terminada: no hay clientes nuevos',
  enCurso: 'Ya hay una sincronización en curso, probá en un minuto',
  /** @param {number} n */
  nuevos: (n) =>
    n === 1 ? 'Se incorporó 1 cliente nuevo' : 'Se incorporaron ' + n + ' clientes nuevos',
  /** @param {number} n */
  actualizadosSinNuevos: (n) =>
    n === 1
      ? 'Se actualizó 1 cliente existente; no hay clientes nuevos'
      : 'Se actualizaron ' + n + ' clientes existentes; no hay clientes nuevos',
  /** @param {number} n */
  parcial: (n) =>
    n === 1
      ? 'Antes del corte se incorporó 1 cliente nuevo.'
      : 'Antes del corte se incorporaron ' + n + ' clientes nuevos.',
});

/** @param {any} v */
function entero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** @type {Readonly<Record<string, string>>} */
const ERRORES = Object.freeze({
  'permission-denied':
    'Tu usuario no tiene permiso para sincronizar clientes. Si creés que es un error, avisale a Mariano.',
  unauthenticated: 'Tu sesión venció. Cerrá sesión, volvé a entrar y probá de nuevo.',
  SAP_INCOMPLETO:
    'SAP no devolvió la lista completa de clientes. Volvé a tocar Sincronizar con SAP en un minuto.',
  SAP_NO_CONFIGURADO: 'La conexión con SAP no está configurada. Avisale a Mariano.',
});

const ERROR_GENERICO =
  'No pudimos sincronizar los clientes con SAP. Volvé a intentar en un minuto; si sigue pasando, avisale a Mariano.';

/**
 * @param {any} res respuesta del callable syncClientesSapCF (o {ok:false, code}
 *   armado por el cliente ante un error de red / permiso).
 * @returns {{tipo: 'ok'|'info'|'error', texto: string}}
 */
export function mensajeSyncClientesSap(res) {
  if (res && res.ok === true) {
    const nuevos = entero(res.nuevos);
    // "confirmados" = provisorios que se confirmaron con su codigo SAP. Los
    // existentes que solo se refrescaron no se mencionan (son casi todos).
    const confirmados = entero(res.confirmados);
    /** @type {string} */
    let texto = SYNC_CLIENTES_SAP_TEXTOS.sinNuevos;
    if (nuevos > 0) texto = SYNC_CLIENTES_SAP_TEXTOS.nuevos(nuevos);
    else if (confirmados > 0) texto = SYNC_CLIENTES_SAP_TEXTOS.actualizadosSinNuevos(confirmados);
    return { tipo: 'ok', texto };
  }
  const code = String((res && res.code) || 'UNKNOWN');
  if (code === 'EN_CURSO') return { tipo: 'info', texto: SYNC_CLIENTES_SAP_TEXTOS.enCurso };
  let base = ERRORES[code] || ERROR_GENERICO;
  if (code === 'SAP_INCOMPLETO' && entero(res && res.nuevos) > 0) {
    base += ' ' + SYNC_CLIENTES_SAP_TEXTOS.parcial(entero(res.nuevos));
  }
  return { tipo: 'error', texto: base + '\nCódigo técnico: ' + code };
}
