// @ts-check
/**
 * Gemini OCR core: extrae datos de tickets/facturas argentinos para el
 * flujo de rendiciones. Sin acoplamiento a Firebase — inyecta fetch,
 * apiKey y log.
 *
 * Motivo: hasta v550 la API key de Gemini vivia en Firestore
 * (app_config/gemini) legible por cualquier @shimano user. Un VDE con
 * DevTools la exfiltraba y quemaba credito. v551 mueve la key a Secret
 * Manager y proxeya la llamada via callable geminiOcrProxy.
 *
 * IDEMPOTENCIA: N/A — cada OCR es independiente.
 * AUTH: caller debe estar autenticado como @shimano.com.ar o @shimano.uy.
 */

/**
 * @typedef {Object} GeminiDeps
 * @property {typeof fetch} fetch
 * @property {string} apiKey Value del secret GEMINI_API_KEY (via defineSecret().value()).
 * @property {(msg: string, extra?: Record<string, unknown>) => void} [log]
 * @property {number} [timeoutMs] Default 45000. Sin timeout el CF queda colgado hasta el timeout de onCall.
 *
 * @typedef {Object} GeminiAuth
 * @property {string} uid
 * @property {string} email
 *
 * @typedef {Object} GeminiOcrInput
 * @property {string} imageBase64 Solo la parte base64 (sin el prefijo "data:image/...;base64,").
 * @property {string} mimeType Ej. "image/jpeg", "image/png".
 *
 * @typedef {Object} GeminiOcrResult
 * @property {string|null} numeroTicket
 * @property {string|null} descripcion COMBUSTIBLE|COMIDA|HOSPEDAJE|PEAJE|TRASLADO|OTROS
 * @property {string|null} modoPago RECARGABLE|CORPORATIVA|EFECTIVO
 * @property {string|null} moneda PESOS|DOLARES|OTRAS MONEDAS
 * @property {string|null} tipoGasto GASTO CON COMPROBANTE|GASTO SIN COMPROBANTE|FACTURA A
 * @property {number|null} importe
 * @property {number|null} importeUsd
 * @property {string|null} divisionGasto GASTO LOCAL|GASTO REGIONAL
 * @property {string|null} observaciones
 */

const SHIMANO_DOMAINS = ['shimano.com.ar', 'shimano.uy'];
const GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_TIMEOUT_MS = 45000;

// Extraido verbatim del frontend v550 (rendiciones.js:51-87). Cambios de
// prompt deben mantenerse en sync entre ambos por ahora — post-v551 el
// frontend ya no lo usa (llama al CF que tiene esta copia). Solo esta
// version queda viva.
const GEMINI_OCR_PROMPT =
  'Sos un asistente que extrae datos de tickets/facturas argentinos para el sistema de rendiciones de Shimano Argentina. ' +
  'Analiza la imagen y devuelve EXCLUSIVAMENTE un JSON valido con los siguientes campos (sin texto adicional fuera del JSON). ' +
  'Si un campo no se puede determinar, usa null. Para los campos con opciones cerradas, devolve EXACTAMENTE uno de los valores listados (case-sensitive).\n\n' +
  'Esquema:\n' +
  '{\n' +
  '  "numeroTicket": "string - numero del comprobante (si no se ve, SIN_NUMERO)",\n' +
  '  "descripcion": "uno de: COMBUSTIBLE | COMIDA | HOSPEDAJE | PEAJE | TRASLADO | OTROS",\n' +
  '  "modoPago": "uno de: RECARGABLE | CORPORATIVA | EFECTIVO",\n' +
  '  "moneda": "uno de: PESOS | DOLARES | OTRAS MONEDAS",\n' +
  '  "tipoGasto": "uno de: GASTO CON COMPROBANTE | GASTO SIN COMPROBANTE | FACTURA A",\n' +
  '  "importe": "numero con decimales (el TOTAL final del ticket, NO subtotales)",\n' +
  '  "importeUsd": "numero o null (solo si el ticket esta en USD)",\n' +
  '  "divisionGasto": "uno de: GASTO LOCAL | GASTO REGIONAL",\n' +
  '  "observaciones": "string libre - CUIT del proveedor, items principales, contexto util"\n' +
  '}\n\n' +
  'Reglas para DESCRIPCION:\n' +
  '- Estaciones de servicio (YPF, Shell, Axion, Puma) -> COMBUSTIBLE\n' +
  '- Restaurantes, bares, kioscos de comida -> COMIDA\n' +
  '- Hoteles, hostels, apart -> HOSPEDAJE\n' +
  '- Cabinas de peaje en autopistas -> PEAJE\n' +
  '- Pasajes de tren/colectivo/avion, Uber, taxi, estacionamiento -> TRASLADO\n' +
  '- Resto -> OTROS\n\n' +
  'Reglas para TIPO DE GASTO (categoria tributaria argentina):\n' +
  '- Si es una FACTURA A (dice claramente "FACTURA A" o "RESPONSABLE INSCRIPTO") -> FACTURA A\n' +
  '- Si es ticket fiscal, factura B o C, o cualquier comprobante valido -> GASTO CON COMPROBANTE\n' +
  '- Si no hay comprobante formal (solo recibo manual) -> GASTO SIN COMPROBANTE\n\n' +
  'Reglas para MODO DE PAGO:\n' +
  '- Si el ticket dice tarjeta corporativa, Visa Corporate, etc -> CORPORATIVA\n' +
  '- Si dice tarjeta recargable, tarjeta prepaga -> RECARGABLE\n' +
  '- Si es efectivo o cash -> EFECTIVO\n' +
  '- Si no se ve claro, default EFECTIVO\n\n' +
  'Reglas para MONEDA:\n' +
  '- Si esta en $ AR / ARS / pesos -> PESOS\n' +
  '- Si esta en U$D / USD / dolares -> DOLARES\n' +
  '- Otra cosa -> OTRAS MONEDAS\n\n' +
  'Para DIVISION GASTO: por defecto GASTO LOCAL salvo que el contexto sugiera otra cosa.';

/**
 * @param {string} email
 * @returns {boolean}
 */
function _isShimanoEmail(email) {
  if (!email) return false;
  const lc = email.toLowerCase();
  return SHIMANO_DOMAINS.some((d) => lc.endsWith('@' + d));
}

/**
 * Whitelist de MIME types aceptados. Gemini acepta mas pero limitamos
 * para reducir superficie de abuso (nadie deberia mandar video/audio
 * en OCR de ticket).
 */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/**
 * Limite defensivo: 10 MB base64 = ~7.5 MB imagen. Gemini acepta mas
 * pero un ticket real jamas pasa de ~2 MB. Rechazar temprano evita
 * quemar credito en payloads absurdos.
 */
const MAX_BASE64_SIZE = 10 * 1024 * 1024;

/**
 * Ejecuta un OCR de ticket con Gemini y devuelve el JSON parseado.
 * @param {GeminiDeps} deps
 * @param {GeminiAuth|null} auth
 * @param {GeminiOcrInput} input
 * @returns {Promise<GeminiOcrResult>}
 */
export async function runGeminiOcr(deps, auth, input) {
  // 1) Auth
  if (!auth || !auth.email) {
    throw { code: 'unauthenticated', message: 'requiere login' };
  }
  if (!_isShimanoEmail(auth.email)) {
    throw { code: 'permission-denied', message: 'solo @shimano puede OCRizar tickets' };
  }

  // 2) Config validation
  if (!deps.apiKey) {
    throw { code: 'failed-precondition', message: 'GEMINI_API_KEY no configurado en Secret Manager' };
  }

  // 3) Input validation
  const { imageBase64, mimeType } = input || /** @type {any} */ ({});
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw { code: 'invalid-argument', message: 'imageBase64 requerido' };
  }
  if (imageBase64.length > MAX_BASE64_SIZE) {
    throw { code: 'invalid-argument', message: 'imagen demasiado grande (max ~7.5 MB)' };
  }
  if (!mimeType || typeof mimeType !== 'string' || !ALLOWED_MIME.has(mimeType)) {
    throw { code: 'invalid-argument', message: 'mimeType no soportado (jpeg/png/webp/heic/heif)' };
  }
  // Validar base64 rapido — rechaza data URLs con prefijo, chars invalidos.
  if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
    throw { code: 'invalid-argument', message: 'imageBase64 debe ser base64 puro (sin data: prefix)' };
  }

  const log = deps.log || (() => {});

  // 4) Fetch a Gemini
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL +
    ':generateContent?key=' +
    encodeURIComponent(deps.apiKey);
  const body = {
    contents: [
      {
        parts: [
          { text: GEMINI_OCR_PROMPT },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.1,
    },
  };

  const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e && /** @type {any} */ (e).name === 'AbortError') {
      throw {
        code: 'deadline-exceeded',
        message: `Gemini tardo mas de ${Math.round(timeoutMs / 1000)}s. Reintentar o completar manual.`,
      };
    }
    throw { code: 'internal', message: 'fetch a Gemini fallo: ' + (/** @type {any} */ (e).message || e) };
  }
  clearTimeout(timeoutId);

  if (!r.ok) {
    const errTxt = await r.text().catch(() => '');
    log('[gemini] non-2xx response', { status: r.status, snippet: errTxt.slice(0, 200) });
    throw { code: 'internal', message: 'Gemini API ' + r.status + ': ' + errTxt.slice(0, 200) };
  }

  // 5) Parse response
  const data = await r.json();
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) {
    throw { code: 'internal', message: 'Gemini no devolvio candidatos' };
  }
  const text =
    cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
  if (!text) {
    throw { code: 'internal', message: 'Gemini devolvio respuesta vacia' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    throw { code: 'internal', message: 'Gemini devolvio JSON invalido: ' + String(text).slice(0, 150) };
  }

  log('[gemini] ocr ok', { uid: auth.uid, importe: parsed.importe, tipoGasto: parsed.tipoGasto });
  return parsed;
}
