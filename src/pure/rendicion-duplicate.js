// @ts-check
/**
 * Anti-duplicados de rendiciones (2026-09-09).
 *
 * Contexto: se detectaron pagos duplicados por la misma boleta en agosto 2026
 * ($28.600 de más en un solo mes). Root cause: sin validacion de duplicados,
 * la unica barrera era el ojo del aprobador. Casos reales del audit:
 *   - Ticket 00011-00001442 mauricio $6.600 aprobado 2× (20/08 y 31/08).
 *   - Ticket 00017-00006675 mauricio $22.000 aprobado 2× (21/08 y 31/08).
 *
 * Patrones observados:
 *   - Duplicados vienen con FECHA DE CARGA distinta + MODO DE PAGO distinto,
 *     asi que ni fechaCarga ni modoPago sirven como parte de la clave.
 *   - Mismo comprobante con distinta cantidad de ceros a la izquierda:
 *     "0015-00000115" vs "00015-00000115". Normalizacion requerida.
 *   - Mismo comprobante con distinto CONCEPTO (COMIDA vs COMBUSTIBLE), asi
 *     que concepto tampoco sirve.
 *
 * Estrategia — 3 tipos de clave:
 *   (a) FUERTE: CUIT proveedor + ticketNormalizado
 *   (b) FUERTE: ticketNormalizado + importe (redondeado a entero)
 *   (c) DEBIL: CUIT proveedor + importe + fecha del comprobante
 *
 * Las FUERTES bloquean submit. La DEBIL solo advierte (los peajes de $2.800
 * del mismo dia con tickets distintos son legitimos, no falsos positivos).
 */

/**
 * Normaliza un numero de ticket a forma canonica.
 *
 * Reglas:
 *   1. Trim + uppercase.
 *   2. Reemplaza separadores (espacio, /, \) por '-'.
 *   3. Si no hay '-': deja como un solo segmento (NO adivina donde partir).
 *   4. Si hay '-': quita ceros a la izquierda de cada segmento (preserva "0"
 *      si el segmento era todo ceros).
 *   5. Vacio o solo separadores → null.
 *
 * Ejemplos:
 *   "00011-00001442"  → "11-1442"
 *   "0015-00000115"   → "15-115"
 *   "00015-00000115"  → "15-115"   (mismo canonico que el anterior)
 *   "  0015 / 115 "   → "15-115"
 *   "0015115"          → "15115"   (sin guion no partimos; queda como esta pero sin 0s)
 *   ""                 → null
 *   "N/A"              → "N-A"     (edge; usualmente el submit valida antes)
 *   "-"                → null
 *
 * @param {string | null | undefined} input
 * @returns {string | null}
 */
export function normalizarTicket(input) {
  if (input == null) return null;
  const s = String(input).trim().toUpperCase();
  if (!s) return null;
  // Normalizar separadores. `\` y `/` y espacios → `-`.
  // Preservamos guiones existentes.
  const withDashes = s.replace(/[\s/\\]+/g, '-');
  // Si hay algun guion, procesar por segmentos.
  if (withDashes.includes('-')) {
    const segments = withDashes.split('-').filter((seg) => seg !== ''); // ignorar guiones dobles / borde
    if (!segments.length) return null;
    const normalized = segments
      .map((seg) => {
        const stripped = seg.replace(/^0+/, '');
        return stripped === '' ? '0' : stripped;
      })
      .join('-');
    return normalized || null;
  }
  // Sin guiones: 1 solo segmento. Quitar ceros a la izquierda igual.
  const stripped = withDashes.replace(/^0+/, '');
  return stripped === '' ? null : stripped;
}

/**
 * Parsea el CUIT del proveedor desde el campo `observaciones` (texto libre
 * que rellena el OCR de Gemini). Formatos observados:
 *
 *   "CUIT proveedor: 30-71234567-8"
 *   "CUIT del proveedor: 30712345678"
 *   "cuit prov: 30-71234567/8"
 *   "Total: $6600. CUIT: 30712345678"
 *
 * Retorna solo los 11 digitos (sin guiones). Si no matchea o no da 11
 * digitos validos, retorna null.
 *
 * @param {string | null | undefined} obs
 * @returns {string | null}
 */
export function parseCuitDeObservaciones(obs) {
  if (obs == null) return null;
  const text = String(obs);
  if (!text.trim()) return null;
  // Regex: "CUIT" (case insensitive), luego opcional cualquier cosa hasta el
  // primer ":". Despues capturamos secuencia de digitos + separadores hasta
  // 15 chars totales.
  const re = /CUIT[^\n:]*:\s*([\d\-/.\s]{11,17})/i;
  const m = text.match(re);
  if (!m) return null;
  const digits = (m[1] || '').replace(/\D+/g, '');
  if (digits.length !== 11) return null;
  return digits;
}

/**
 * @typedef {Object} Rendicion
 * @property {string} [numeroTicket]
 * @property {number|string} [importe]
 * @property {string} [observaciones]
 * @property {string} [fechaTicket]  Fecha del comprobante (YYYY-MM-DD).
 * @property {string} [fecha]        Alternativo — algunos docs viejos tienen `fecha` en vez de `fechaTicket`.
 */

/**
 * Redondea importe a entero para evitar ruido de decimales del OCR.
 * @param {number|string|undefined|null} v
 * @returns {number|null}
 */
function _importeCanonico(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Extrae la fecha del comprobante en formato YYYY-MM-DD desde varios campos
 * posibles. Ignora hora / timestamp.
 * @param {Rendicion} r
 * @returns {string|null}
 */
function _fechaTicketCanonica(r) {
  const raw = r.fechaTicket || r.fecha || '';
  if (!raw) return null;
  const s = String(raw).trim();
  // Firestore Timestamp puede haber sido serializado como ISO ya (fromMillis).
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}

/**
 * Devuelve las claves candidatas de duplicado para una rendicion.
 *
 * Retorna `{fuertes: [...], debiles: [...]}`. Las claves son strings unicos
 * con prefijo del tipo, listas para usar en Firestore queries o Set lookups.
 *
 * Prefijos:
 *   "strong:cuit-ticket:{cuit}|{ticketNorm}"
 *   "strong:ticket-importe:{ticketNorm}|{importe}"
 *   "weak:cuit-importe-fecha:{cuit}|{importe}|{fecha}"
 *
 * @param {Rendicion} r
 * @returns {{fuertes: string[], debiles: string[]}}
 */
export function clavesDeDuplicado(r) {
  const ticket = r ? normalizarTicket(r.numeroTicket) : null;
  const cuit = r ? parseCuitDeObservaciones(r.observaciones) : null;
  const importe = r ? _importeCanonico(r.importe) : null;
  const fecha = r ? _fechaTicketCanonica(r) : null;

  /** @type {string[]} */
  const fuertes = [];
  /** @type {string[]} */
  const debiles = [];

  // (a) FUERTE: cuit + ticket
  if (cuit && ticket) {
    fuertes.push(`strong:cuit-ticket:${cuit}|${ticket}`);
  }
  // (b) FUERTE: ticket + importe
  if (ticket && importe != null) {
    fuertes.push(`strong:ticket-importe:${ticket}|${importe}`);
  }
  // (c) DEBIL: cuit + importe + fecha
  // Solo aplica si HAY cuit (sin cuit no advertimos para evitar ruido con
  // los peajes de $2.800 del mismo dia que son legitimos).
  if (cuit && importe != null && fecha) {
    debiles.push(`weak:cuit-importe-fecha:${cuit}|${importe}|${fecha}`);
  }

  return { fuertes, debiles };
}

/**
 * Chequea si dos rendiciones matchean como duplicado. Util para el chequeo
 * cliente-side (compara la rendicion nueva contra cada rendicion recuperada
 * de Firestore) y para tests.
 *
 * Retorna:
 *   null si no hay match.
 *   { strength: 'strong'|'weak', reason: '<clave que matcheo>' } si matchean.
 *
 * @param {Rendicion} a
 * @param {Rendicion} b
 * @returns {{strength: 'strong'|'weak', reason: string} | null}
 */
export function chequearMatchDuplicado(a, b) {
  const ka = clavesDeDuplicado(a);
  const kb = clavesDeDuplicado(b);
  // Fuerte primero — cualquier clave fuerte comun bloquea.
  const setBfuertes = new Set(kb.fuertes);
  for (const k of ka.fuertes) {
    if (setBfuertes.has(k)) return { strength: 'strong', reason: k };
  }
  // Debil — advierte pero no bloquea.
  const setBdebiles = new Set(kb.debiles);
  for (const k of ka.debiles) {
    if (setBdebiles.has(k)) return { strength: 'weak', reason: k };
  }
  return null;
}
