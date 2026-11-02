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
});

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
    const n = Number(res.nuevos);
    const nuevos = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return {
      tipo: 'ok',
      texto:
        nuevos > 0 ? SYNC_CLIENTES_SAP_TEXTOS.nuevos(nuevos) : SYNC_CLIENTES_SAP_TEXTOS.sinNuevos,
    };
  }
  const code = String((res && res.code) || 'UNKNOWN');
  if (code === 'EN_CURSO') return { tipo: 'info', texto: SYNC_CLIENTES_SAP_TEXTOS.enCurso };
  const base = ERRORES[code] || ERROR_GENERICO;
  return { tipo: 'error', texto: base + '\nCódigo técnico: ' + code };
}
