// Manejo cliente del rechazo ROLE_REQUIRED del gate de rol server-side
// (commitPedidoCF, updatePedidoLinesCF, fetchStockLiveCF, geminiOcrProxy,
// releaseAsigCF devuelven permission-denied con details.errorCode).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  formatMensajeConCodigo,
  getMensajeParaErrorCode,
  isRoleRequiredError,
  MENSAJES_VENDEDOR,
  PALABRAS_PROHIBIDAS,
} from '../../../src/pure/mensajes-vendedor.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

describe('ROLE_REQUIRED — mensajes-vendedor', () => {
  it('tiene entrada propia (no cae a UNKNOWN)', () => {
    expect(MENSAJES_VENDEDOR.ROLE_REQUIRED).toBeTruthy();
    expect(getMensajeParaErrorCode('ROLE_REQUIRED')).toBe(MENSAJES_VENDEDOR.ROLE_REQUIRED);
    expect(getMensajeParaErrorCode('ROLE_REQUIRED')).not.toBe(MENSAJES_VENDEDOR.UNKNOWN);
  });

  it('texto sin palabras prohibidas', () => {
    const t = MENSAJES_VENDEDOR.ROLE_REQUIRED.texto;
    for (const p of PALABRAS_PROHIBIDAS) {
      if (/^[A-Z_]+$/.test(p)) expect(t.includes(p)).toBe(false);
      else expect(t.toLowerCase().includes(p.toLowerCase())).toBe(false);
    }
    expect(t).not.toMatch(/ROLE_REQUIRED|App Check|reCAPTCHA/);
  });

  it('formato con código técnico al final', () => {
    const s = formatMensajeConCodigo('ROLE_REQUIRED');
    expect(s.endsWith('\n\nCódigo técnico: ROLE_REQUIRED')).toBe(true);
    expect(s.startsWith(MENSAJES_VENDEDOR.ROLE_REQUIRED.texto)).toBe(true);
  });

  it('isRoleRequiredError detecta details.errorCode', () => {
    expect(
      isRoleRequiredError({
        code: 'functions/permission-denied',
        details: { errorCode: 'ROLE_REQUIRED', reason: 'sin_doc' },
      })
    ).toBe(true);
    expect(isRoleRequiredError({ errorCode: 'ROLE_REQUIRED' })).toBe(true);
  });

  it('isRoleRequiredError no confunde otros permission-denied', () => {
    expect(isRoleRequiredError({ code: 'functions/permission-denied' })).toBe(false);
    expect(
      isRoleRequiredError({ code: 'functions/permission-denied', details: { errorCode: 'X' } })
    ).toBe(false);
    expect(isRoleRequiredError(null)).toBe(false);
    expect(isRoleRequiredError('ROLE_REQUIRED')).toBe(false);
  });
});

describe('ROLE_REQUIRED — contrato rendiciones (OCR)', () => {
  const src = read('src/domains/rendiciones.js');

  it('chequea ROLE_REQUIRED antes del recovery de App Check', () => {
    const iRole = src.indexOf('if (isRoleRequiredError(e))');
    const iAppCheck = src.indexOf("code === 'functions/permission-denied'");
    const iRetry = src.indexOf('getToken(true)');
    expect(iRole).toBeGreaterThan(-1);
    expect(iAppCheck).toBeGreaterThan(-1);
    expect(iRole).toBeLessThan(iAppCheck);
    expect(iRole).toBeLessThan(iRetry);
  });

  it('el bloque ROLE_REQUIRED no reintenta y usa el mensaje del pure', () => {
    const iRole = src.indexOf('if (isRoleRequiredError(e))');
    const block = src.slice(iRole, src.indexOf('}', iRole) + 1);
    expect(block).toContain("formatMensajeConCodigo('ROLE_REQUIRED')");
    expect(block).toContain('throw');
    expect(block).not.toMatch(/getToken|callable\(|Borrar datos/);
  });

  it('importa los helpers del pure', () => {
    expect(src).toMatch(
      /import \{\s*formatMensajeConCodigo,\s*getServerErrorCode,\s*isRoleRequiredError,\s*\} from '\.\.\/pure\/mensajes-vendedor\.js';/
    );
  });
});

describe('ROLE_REQUIRED — contrato index.html', () => {
  const html = read('index.html');

  it('_tryCommitPedidoCF mapea details.errorCode ROLE_REQUIRED antes de PERMISSION_DENIED', () => {
    const i = html.indexOf("_isRoleReq ? 'ROLE_REQUIRED' :");
    expect(i).toBeGreaterThan(-1);
    const iPerm = html.indexOf("'PERMISSION_DENIED' :", i);
    expect(iPerm).toBeGreaterThan(i);
  });

  it('handler del resultado commit tiene rama ROLE_REQUIRED con código técnico', () => {
    expect(html).toContain("} else if (code === 'ROLE_REQUIRED') {");
    expect(html).toContain('Código técnico: ROLE_REQUIRED');
  });

  it('releaseAsigCF: ambos catch usan _serverErrorAlertText (incluye ROLE_REQUIRED)', () => {
    expect(html).toContain('window._roleRequiredAlertText = function(e)');
    expect(html).toContain('window._serverErrorAlertText = function(e)');
    const n = (
      html.match(
        /alert\(window\._serverErrorAlertText\(e\) \|\| window\._releaseFailedAlertText\(\)\)/g
      ) || []
    ).length;
    expect(n).toBe(2);
  });

  it('fetchStockLiveCF registra role_required en el fallback', () => {
    expect(html).toContain("const _liveReason = _liveRoleReq ? 'role_required'");
    expect(html).toContain('window._liveStockMeta = { reason: _liveReason,');
  });

  it('main.js expone isRoleRequiredError', () => {
    const main = read('src/main.js');
    expect(main).toMatch(/formatMensajeConCodigo,\s*isRoleRequiredError,\s*\}/);
  });
});
