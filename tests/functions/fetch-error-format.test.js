// @ts-check
/**
 * Incidente 2026-11-17 — tests para `formatFetchError`.
 *
 * Cobertura pedida explícitamente en la autorización:
 *   1. ECONNRESET
 *   2. UND_ERR_CONNECT_TIMEOUT
 *   3. ENOTFOUND
 *   4. Error con cause.message pero sin cause.code
 *   5. Error sin cause
 *   6. Error nulo o undefined
 *   7. Estructura inesperada de cause
 *   8. Conservación del mensaje original
 */
import { describe, expect, it } from 'vitest';
import { formatFetchError } from '../../functions/core/fetch-error-format.js';

/**
 * Simula el shape real que emite undici (Node 20+) al fallar fetch
 * pre-response. En tiempo de ejecución, `new TypeError('fetch failed')`
 * recibe `.cause` como Error con propiedades propias.
 */
function undiciError(causeShape) {
  const err = new TypeError('fetch failed');
  // @ts-expect-error — .cause es asignable
  err.cause = causeShape;
  return err;
}

describe('formatFetchError — casos requeridos por la autorización', () => {
  it('T1: ECONNRESET → incluye code + errno + syscall', () => {
    const e = undiciError({ code: 'ECONNRESET', errno: -4077, syscall: 'read' });
    const out = formatFetchError(e);
    expect(out).toContain('fetch failed');
    expect(out).toContain('ECONNRESET');
    expect(out).toContain('errno=-4077');
    expect(out).toContain('syscall=read');
    // Mensaje original preservado como prefijo (grep compat).
    expect(out.startsWith('fetch failed')).toBe(true);
  });

  it('T2: UND_ERR_CONNECT_TIMEOUT → código undici propagado', () => {
    const e = undiciError({ code: 'UND_ERR_CONNECT_TIMEOUT' });
    const out = formatFetchError(e);
    expect(out).toBe('fetch failed (UND_ERR_CONNECT_TIMEOUT)');
  });

  it('T3: ENOTFOUND → incluye code + hostname', () => {
    const e = undiciError({
      code: 'ENOTFOUND',
      errno: -3008,
      syscall: 'getaddrinfo',
      hostname: 'sap-sl.shimano.com.ar',
    });
    const out = formatFetchError(e);
    expect(out).toContain('ENOTFOUND');
    expect(out).toContain('errno=-3008');
    expect(out).toContain('syscall=getaddrinfo');
    expect(out).toContain('host=sap-sl.shimano.com.ar');
  });

  it('T4: cause con message pero SIN code → usa cause.message como fallback', () => {
    const e = undiciError({ message: 'invalid certificate (self-signed)' });
    const out = formatFetchError(e);
    expect(out).toBe('fetch failed (invalid certificate (self-signed))');
  });

  it('T5: error SIN cause → devuelve el message sin modificar', () => {
    const e = new Error('HTTP 403 Forbidden');
    const out = formatFetchError(e);
    expect(out).toBe('HTTP 403 Forbidden');
  });

  it('T6a: error null → "unknown"', () => {
    expect(formatFetchError(null)).toBe('unknown');
  });

  it('T6b: error undefined → "unknown"', () => {
    expect(formatFetchError(undefined)).toBe('unknown');
  });

  it('T7a: cause string (shape raro) → se incluye como paréntesis', () => {
    const e = new TypeError('fetch failed');
    // @ts-expect-error
    e.cause = 'raw string cause';
    const out = formatFetchError(e);
    expect(out).toBe('fetch failed (raw string cause)');
  });

  it('T7b: cause array → no crashea, se incluye como string', () => {
    const e = new TypeError('fetch failed');
    // @ts-expect-error
    e.cause = ['foo', 'bar'];
    const out = formatFetchError(e);
    // Array → typeof 'object'. Pasa por rama de objeto; sin code/errno/syscall/hostname
    // ni message → parts queda vacío → devuelve base sin paréntesis.
    expect(out).toBe('fetch failed');
  });

  it('T7c: cause con getter que lanza → devuelve base sin crash', () => {
    const e = new TypeError('fetch failed');
    Object.defineProperty(e, 'cause', {
      get() {
        throw new Error('getter boom');
      },
    });
    const out = formatFetchError(e);
    expect(out).toBe('fetch failed');
  });

  it('T7d: cause con code pero code no-string → ignora', () => {
    const e = undiciError({ code: 42, errno: -1 });
    const out = formatFetchError(e);
    // code=42 ignorado (no string), errno sí.
    expect(out).toBe('fetch failed (errno=-1)');
  });

  it('T8: conserva el mensaje original aunque haya cause', () => {
    const e = undiciError({ code: 'ECONNRESET' });
    const out = formatFetchError(e);
    // base + ' (' + ... + ')'
    expect(out.indexOf('fetch failed')).toBe(0);
  });

  it('T8b: mensaje custom distinto de "fetch failed" también se preserva', () => {
    const e = new Error('SL login failed HTTP 503: service unavailable');
    // @ts-expect-error
    e.cause = { code: 'ECONNREFUSED' };
    const out = formatFetchError(e);
    expect(out).toBe('SL login failed HTTP 503: service unavailable (ECONNREFUSED)');
  });
});

describe('formatFetchError — defensa adicional', () => {
  it('error numérico → String(e)', () => {
    // @ts-expect-error
    expect(formatFetchError(404)).toBe('404');
  });

  it('error string → se devuelve como está', () => {
    // @ts-expect-error
    expect(formatFetchError('timeout')).toBe('timeout');
  });

  it('cause con code vacío "" → no lo incluye', () => {
    const e = undiciError({ code: '', errno: -1 });
    const out = formatFetchError(e);
    expect(out).toBe('fetch failed (errno=-1)');
  });

  it('cause null (post-chequeo de cause !== null) → base sin paréntesis', () => {
    const e = new TypeError('fetch failed');
    // @ts-expect-error
    e.cause = null;
    expect(formatFetchError(e)).toBe('fetch failed');
  });

  it('cause con hostname pero sin code ni message → incluye solo host', () => {
    const e = undiciError({ hostname: 'example.com' });
    const out = formatFetchError(e);
    expect(out).toBe('fetch failed (host=example.com)');
  });
});
