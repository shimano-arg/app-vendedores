// Códigos de error nuevos del servidor (2026-11-24): mensajes §68 y cableado
// en el cliente (releaseAsigCF, commitPedidoCF, fetchStockLiveCF, OCR de
// rendiciones y reenvío de mails del planner).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  formatMensajeConCodigo,
  formatServerErrorAlert,
  getMensajeParaErrorCode,
  getServerErrorCode,
  MENSAJES_VENDEDOR,
  PALABRAS_PROHIBIDAS,
  SERVER_ERROR_CODES_MAPEADOS,
} from '../../../src/pure/mensajes-vendedor.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const NUEVOS = [
  'ROLE_CHECK_UNAVAILABLE',
  'CLIENT_DATA_MISSING',
  'RELEASE_CROSS_CLIENT',
  'TOO_MANY_SKUS',
  'GEMINI_OCR_FAILED',
  'EMAIL_SEND_FAILED',
  // Auditoría 2026-11-25: alcance del vendedor interno en las Cloud Functions.
  'INTERNO_FUERA_DE_PAREJA',
  'INTERNO_SOLO_PEDIDO_PROPIO',
  // N5 (2026-11-25): releaseAsigCF rechazo_cpst sobre orden no propia del interno.
  'WAITLIST_BORRAR_SOLO_PROPIA',
];

describe('mensajes de los códigos nuevos', () => {
  for (const code of NUEVOS) {
    it(`${code}: entrada propia, sin jerga, dos oraciones`, () => {
      const m = MENSAJES_VENDEDOR[code];
      expect(m).toBeTruthy();
      expect(getMensajeParaErrorCode(code)).toBe(m);
      const t = m.texto;
      for (const p of PALABRAS_PROHIBIDAS) {
        if (/^[A-Z_]+$/.test(p)) expect(t.includes(p)).toBe(false);
        else expect(t.toLowerCase().includes(p.toLowerCase())).toBe(false);
      }
      expect(t).not.toContain(code);
      expect(t).not.toMatch(/App Check|reCAPTCHA|servidor|server/i);
      const oraciones = t.split(/\.\s+/).filter(Boolean);
      expect(oraciones.length).toBe(2);
      expect(formatMensajeConCodigo(code).endsWith(`\n\nCódigo técnico: ${code}`)).toBe(true);
    });
  }

  it('SERVER_ERROR_CODES_MAPEADOS cubre ROLE_REQUIRED y los nuevos', () => {
    expect([...SERVER_ERROR_CODES_MAPEADOS].sort()).toEqual(['ROLE_REQUIRED', ...NUEVOS].sort());
    for (const c of SERVER_ERROR_CODES_MAPEADOS) expect(MENSAJES_VENDEDOR[c]).toBeTruthy();
  });

  it('el fallback inline de index.html tiene el mismo texto que el pure', () => {
    const html = read('index.html');
    for (const c of SERVER_ERROR_CODES_MAPEADOS) {
      expect(html).toContain(`${c}: '${MENSAJES_VENDEDOR[c].texto}'`);
    }
  });
});

describe('getServerErrorCode / formatServerErrorAlert', () => {
  it('lee details.errorCode (HttpsError) y errorCode en la raíz', () => {
    expect(
      getServerErrorCode({
        code: 'functions/unavailable',
        details: { errorCode: 'ROLE_CHECK_UNAVAILABLE' },
      })
    ).toBe('ROLE_CHECK_UNAVAILABLE');
    expect(getServerErrorCode({ errorCode: 'too_many_skus' })).toBe('TOO_MANY_SKUS');
    expect(getServerErrorCode({ code: 'functions/internal' })).toBe('');
    expect(getServerErrorCode(null)).toBe('');
    expect(getServerErrorCode('X')).toBe('');
    expect(getServerErrorCode({ details: { errorCode: 42 } })).toBe('');
  });

  it('devuelve el mensaje para códigos mapeados y null para el resto', () => {
    expect(formatServerErrorAlert({ details: { errorCode: 'RELEASE_CROSS_CLIENT' } })).toBe(
      formatMensajeConCodigo('RELEASE_CROSS_CLIENT')
    );
    expect(formatServerErrorAlert({ details: { errorCode: 'ROLE_REQUIRED' } })).toBe(
      formatMensajeConCodigo('ROLE_REQUIRED')
    );
    // STOCK_CHANGED tiene mensaje pero lo maneja su propio flujo: no se mapea acá.
    expect(formatServerErrorAlert({ details: { errorCode: 'STOCK_CHANGED' } })).toBeNull();
    expect(formatServerErrorAlert({ message: 'boom' })).toBeNull();
  });

  it('main.js expone los helpers nuevos', () => {
    const main = read('src/main.js');
    expect(main).toMatch(
      /SERVER_ERROR_CODES_MAPEADOS,\s*getServerErrorCode,\s*formatServerErrorAlert,/
    );
  });
});

describe('cableado en index.html', () => {
  const html = read('index.html');

  it('releaseAsig: sin fallback de unidades estimadas por el cliente', () => {
    expect(html).not.toContain('d.unitsCancelled || unitsToFree');
    expect(html).not.toContain('d.linesCancelled || refsItem.length');
    // PR G v1579 §Decisión-4: el syncTag concatena `_msgExtra` cuando hay pedidos
    // cerrados por quedar vacíos. La raíz del tag ('Producto quitado · N u liberadas')
    // sigue sin fallbacks locales.
    expect(html).toContain("showSyncTag('Producto quitado · ' + _unitsServer + 'u liberadas'");
    expect(html).toContain('_pedidosCerrados');
  });

  it('releaseAsig: los catch no concatenan el mensaje crudo del error', () => {
    expect(html).not.toContain("'Error aplicando el cambio: ' + (e.message || e)");
  });

  it('commitPedidoCF: ROLE_CHECK_UNAVAILABLE se corta antes de la rama de red', () => {
    const iRole = html.indexOf("if (_srvCode === 'ROLE_CHECK_UNAVAILABLE') {");
    const iNet = html.indexOf('// Rama RED: idempotency check pre-fallback.');
    expect(iRole).toBeGreaterThan(-1);
    expect(iRole).toBeLessThan(iNet);
    expect(html).toContain("_isTooMany ? 'TOO_MANY_SKUS' :");
    expect(html).toContain('window._SERVER_ERROR_FALLBACK_TEXTS[code]');
  });

  it('fetchStockLiveCF registra el motivo de los códigos nuevos', () => {
    expect(html).toContain("'role_check_unavailable'");
    expect(html).toContain("'too_many_skus'");
  });

  it('reenvío del planner usa EMAIL_SEND_FAILED y no el mensaje crudo', () => {
    expect(html).not.toContain("alert('Error al reenviar: ' + ((err && err.message) || err));");
    expect(html).toContain("formatMensajeConCodigo('EMAIL_SEND_FAILED')");
  });
});

describe('cableado en rendiciones (OCR)', () => {
  const src = read('src/domains/rendiciones.js');

  it('el reintento que falla por rol no muestra el mensaje de App Check', () => {
    const iCatch = src.indexOf('} catch (retryErr) {');
    const iThrowRole = src.indexOf('if (retryRoleMsg) throw new Error(retryRoleMsg);');
    const iAppCheck = src.indexOf('La verificacion de seguridad (App Check)');
    expect(iCatch).toBeGreaterThan(-1);
    expect(iThrowRole).toBeGreaterThan(iCatch);
    expect(iThrowRole).toBeLessThan(iAppCheck);
    const block = src.slice(iCatch, iThrowRole);
    expect(block).toContain('isRoleRequiredError(retryErr)');
    expect(block).toContain("getServerErrorCode(retryErr) === 'ROLE_CHECK_UNAVAILABLE'");
  });

  it('ROLE_CHECK_UNAVAILABLE en el primer intento no entra al recovery de App Check', () => {
    const iCheck = src.indexOf("if (getServerErrorCode(e) === 'ROLE_CHECK_UNAVAILABLE') {");
    const iRetry = src.indexOf('getToken(true)');
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iRetry);
  });

  it('GEMINI_OCR_FAILED genérico usa el mensaje §68', () => {
    expect(src).toContain(
      "getServerErrorCode(e) === 'GEMINI_OCR_FAILED' && code === 'functions/internal'"
    );
    expect(src).toContain("formatMensajeConCodigo('GEMINI_OCR_FAILED')");
  });
});

describe('admin-users escapa data-uid', () => {
  const src = read('src/domains/admin-users.js');
  it('ambos data-uid pasan por escapeHtml', () => {
    expect(src).not.toMatch(/data-uid="' \+ docId \+/);
    expect((src.match(/data-uid="' \+ escapeHtml\(docId\) \+/g) || []).length).toBe(2);
  });
});
