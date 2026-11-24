// @ts-check
/**
 * Helpers puros para armar HTML con datos que vienen de Firestore u otra
 * fuente no confiable (sec 2026-11-24).
 *
 * - `escapeAttr(s)`: escape para valores que van DENTRO de un atributo HTML,
 *   incluido el caso de un string JS entre comillas simples dentro de un
 *   handler inline (`onclick="f('…')"`). Escapa `&` primero (el navegador
 *   decodifica entidades del atributo antes de ejecutar el handler), después
 *   `\` y `'` con barra, y `"`, `<`, `>` como entidades.
 *   El inline de index.html tiene una copia idéntica (test de sincronía en
 *   tests/unit/audit/html-safe-sync.test.js).
 * - `jsArgAttr(s)`: argumento string JS ya entre comillas simples, listo para
 *   concatenar dentro de un handler inline (`onclick="f(' + jsArgAttr(x) + ')"`).
 *   Es `escapeAttr` más el escape de saltos de línea (que romperían el literal
 *   JS). Reemplaza el patrón viejo con `JSON.stringify` + reemplazo de comillas
 *   por `&quot;`, que no escapaba `&` y dejaba cerrar el string.
 * - `safeImgSrc(v)`: devuelve el valor listo para `<img src="…">` solo si es
 *   una imagen `data:image/<tipo>;base64,…` de una lista corta o una URL
 *   `https:`. Cualquier otra cosa devuelve `''` y no se renderiza.
 * - `safeDownloadHref(v)`: idem para `<a href="…" download>` de adjuntos:
 *   `data:` con MIME explícito de una lista corta (pdf, imágenes, planillas)
 *   o `https:`. Un `data:` sin MIME no se acepta.
 */

/** @type {Record<string, string>} */
const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * @param {unknown} s
 * @returns {string}
 */
function escapeHtmlLocal(s) {
  return String(s).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Escape para atributos HTML (y strings JS entre comillas simples dentro de
 * handlers inline).
 * @param {unknown} s
 * @returns {string}
 */
export function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/[\\']/g, '\\$&')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Argumento string para un handler inline: `'…'` escapado para atributo HTML
 * y para literal JS entre comillas simples. `null`/`undefined` → `''`.
 * @param {unknown} s
 * @returns {string}
 */
export function jsArgAttr(s) {
  const body = escapeAttr(s)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return "'" + body + "'";
}

const DATA_IMG_RE = /^data:image\/(png|jpe?g|webp|gif|heic|heif|bmp|avif);base64,[A-Za-z0-9+/=]*$/i;

const DATA_DOWNLOAD_RE =
  /^data:(application\/pdf|image\/(png|jpe?g|webp|gif|heic|heif|bmp|avif)|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|text\/csv|application\/octet-stream);base64,[A-Za-z0-9+/=]*$/i;

/**
 * @param {string} s
 * @returns {boolean}
 */
function isHttpsUrl(s) {
  if (!/^https:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !!u.hostname;
  } catch (_e) {
    return false;
  }
}

/**
 * Valor seguro para `src` de una imagen, ya escapado para atributo.
 * @param {unknown} v
 * @returns {string} '' si el valor no es una imagen permitida.
 */
export function safeImgSrc(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  if (DATA_IMG_RE.test(s) || isHttpsUrl(s)) return escapeHtmlLocal(s);
  return '';
}

/**
 * Valor seguro para `href` de un adjunto descargable, ya escapado.
 * @param {unknown} v
 * @returns {string} '' si el valor no es un adjunto permitido.
 */
export function safeDownloadHref(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  if (DATA_DOWNLOAD_RE.test(s) || isHttpsUrl(s)) return escapeHtmlLocal(s);
  return '';
}
