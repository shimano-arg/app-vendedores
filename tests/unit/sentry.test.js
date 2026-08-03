import { describe, expect, it, vi } from 'vitest';
import { applySentryUserContext } from '../../src/sentry.js';

/** Fabrica un mock Sentry con setUser y setTag como spies. */
function makeSentry() {
  return {
    setUser: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
  };
}

describe('applySentryUserContext', () => {
  it('happy: setea user + tags rol/vendor', () => {
    const s = makeSentry();
    applySentryUserContext(s, { uid: 'u1', email: 'x@y.com' }, 'admin', 'GONZALO');
    expect(s.setUser).toHaveBeenCalledWith({ id: 'u1', email: 'x@y.com' });
    expect(s.setTag).toHaveBeenCalledWith('role', 'admin');
    expect(s.setTag).toHaveBeenCalledWith('vendor', 'GONZALO');
  });

  it('user=null (logout): limpia setUser + tags default', () => {
    const s = makeSentry();
    applySentryUserContext(s, null, null, null);
    expect(s.setUser).toHaveBeenCalledWith(null);
    expect(s.setTag).toHaveBeenCalledWith('role', 'unknown');
    expect(s.setTag).toHaveBeenCalledWith('vendor', 'none');
  });

  it('role/vendor undefined: usa defaults "unknown"/"none"', () => {
    const s = makeSentry();
    applySentryUserContext(s, { uid: 'u1' }, undefined, undefined);
    expect(s.setTag).toHaveBeenCalledWith('role', 'unknown');
    expect(s.setTag).toHaveBeenCalledWith('vendor', 'none');
  });

  it('sentry=null: no throw (loader aun no cargo)', () => {
    // Caso real: SDK async; alguien llama al helper antes de que baje.
    expect(() => applySentryUserContext(null, { uid: 'u1' }, 'vendedor', 'X')).not.toThrow();
    expect(() => applySentryUserContext(undefined, { uid: 'u1' }, 'vendedor', 'X')).not.toThrow();
  });

  it('sentry sin métodos: no throw (loader parcial o mock incompleto)', () => {
    // Ej. loader que expuso Sentry como array de queue todavia sin
    // .setUser/.setTag definidos.
    expect(() => applySentryUserContext({}, { uid: 'u1' }, 'vendedor', 'X')).not.toThrow();
  });

  it('setUser lanza: se traga silenciosamente (best-effort)', () => {
    const s = {
      setUser: () => {
        throw new Error('boom');
      },
      setTag: vi.fn(),
    };
    expect(() => applySentryUserContext(s, { uid: 'u1' }, 'admin', 'X')).not.toThrow();
  });

  it('user sin email: setUser recibe id sin email', () => {
    const s = makeSentry();
    applySentryUserContext(s, { uid: 'u1' }, 'vendedor', 'ANA');
    expect(s.setUser).toHaveBeenCalledWith({ id: 'u1', email: undefined });
  });
});
