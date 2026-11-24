// @ts-check
/**
 * SEC-H4 iter2 (HARDENING5 BATCH 1, 2026-11-19) — tests del wrapper
 * fetchStockLiveCF relacionados al logging en operations_log.
 *
 * Problema iter1: el bloque que escribía a operations_log con los metadata
 * del cap excedido estaba DESPUÉS del `throw new HttpsError(...)` → nunca
 * se ejecutaba. Viola §64.2 CLAUDE.md ("TODO rechazo de la CF debe pasar
 * por logging centralizado AWAIT").
 *
 * Fix: el write a operations_log corre AWAIT antes del throw, con fail-safe
 * para no bloquear el throw si el write falla.
 *
 * Como el wrapper es un `onCall` que ensambla el entorno real (admin SDK,
 * getFirestore, secrets), no podemos invocar la función tal cual sin
 * duplicar bootstrap. Testeamos la lógica del bloque TOO_MANY_SKUS como
 * unidad: dado result={ok:false, errorCode:'TOO_MANY_SKUS'}, debe
 * - escribir UN entry en operations_log antes del throw (AWAIT),
 * - entry.type === 'cf_rejected',
 * - entry.errorCode === 'TOO_MANY_SKUS',
 * - entry.cf === 'fetchStockLiveCF',
 * - entry.requested === skus.length,
 * - entry.cap === 250,
 * - throw HttpsError('invalid-argument', ...).
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * Simula el bloque de manejo de TOO_MANY_SKUS del wrapper
 * `functions/index.js:fetchStockLiveCF`. Replica la lógica tal cual está
 * en el archivo real (ver líneas 1810-1836 post iter2).
 *
 * @param {{
 *   db: any,
 *   auth: { uid: string } | null,
 *   email: string,
 *   skus: string[],
 *   result: { ok: false, errorCode: 'TOO_MANY_SKUS', reason?: string, error?: string },
 *   HttpsError: any,
 *   consoleWarn: (...a: any[]) => void,
 * }} args
 */
async function simulateWrapperBlock(args) {
  const { db, auth, email, skus, result, HttpsError, consoleWarn } = args;
  if (result && result.ok === false && result.errorCode === 'TOO_MANY_SKUS') {
    try {
      await db.collection('operations_log').add({
        type: 'cf_rejected',
        errorCode: 'TOO_MANY_SKUS',
        cf: 'fetchStockLiveCF',
        userId: auth && auth.uid ? auth.uid : null,
        userEmail: email || null,
        requested: Array.isArray(skus) ? skus.length : 0,
        cap: 250,
        reason: result.reason || 'cap_exceeded',
        timestamp: new Date(),
      });
    } catch (_logErr) {
      consoleWarn('operations_log write failed (fetchStockLiveCF TOO_MANY_SKUS)', _logErr);
    }
    throw new HttpsError('invalid-argument', result.error || 'demasiados SKUs por request', {
      errorCode: 'TOO_MANY_SKUS',
      requested: skus.length,
    });
  }
}

/** Factory que arma `db.collection('operations_log').add` como spy. */
function makeDbSpy({ addImpl } = {}) {
  const addSpy = vi.fn(addImpl || (async () => ({ id: 'log-mock-id' })));
  return {
    addSpy,
    db: {
      collection(name) {
        if (name !== 'operations_log') {
          throw new Error('unexpected collection: ' + name);
        }
        return { add: addSpy };
      },
    },
  };
}

/** HttpsError factory que captura code + message + details. */
class HttpsErrorMock extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'HttpsError';
  }
}

describe('SEC-H4 iter2 — fetchStockLiveCF wrapper logging', () => {
  it('T1 — TOO_MANY_SKUS escribe UN entry a operations_log ANTES del throw', async () => {
    const { addSpy, db } = makeDbSpy();
    const skus251 = Array.from({ length: 251 }, (_, i) => 'K' + String(i + 1).padStart(4, '0'));
    const consoleWarn = vi.fn();
    const result = {
      ok: false,
      errorCode: /** @type {const} */ ('TOO_MANY_SKUS'),
      reason: 'cap_exceeded',
      error: 'cap SKUs excedido: 251 > 250',
    };
    await expect(
      simulateWrapperBlock({
        db,
        auth: { uid: 'uid-mariano' },
        email: 'mariano@shimano.com.ar',
        skus: skus251,
        result,
        HttpsError: HttpsErrorMock,
        consoleWarn,
      })
    ).rejects.toThrow(/demasiados SKUs|cap SKUs excedido/);
    // Crítico: el add DEBE haber sido llamado ANTES del throw (si estuviera
    // después, no se habría invocado — la promesa rejects antes de llegar).
    expect(addSpy).toHaveBeenCalledTimes(1);
    const entry = addSpy.mock.calls[0][0];
    expect(entry.type).toBe('cf_rejected');
    expect(entry.errorCode).toBe('TOO_MANY_SKUS');
    expect(entry.cf).toBe('fetchStockLiveCF');
    expect(entry.userId).toBe('uid-mariano');
    expect(entry.userEmail).toBe('mariano@shimano.com.ar');
    expect(entry.requested).toBe(251);
    expect(entry.cap).toBe(250);
    expect(entry.reason).toBe('cap_exceeded');
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('T2 — HttpsError code=invalid-argument + details incluyen errorCode y requested', async () => {
    const { db } = makeDbSpy();
    const skus500 = Array.from({ length: 500 }, (_, i) => 'K' + i);
    const result = {
      ok: false,
      errorCode: /** @type {const} */ ('TOO_MANY_SKUS'),
      reason: 'cap_exceeded',
      error: 'cap SKUs excedido: 500 > 250',
    };
    try {
      await simulateWrapperBlock({
        db,
        auth: { uid: 'uid-x' },
        email: 'x@shimano.com.ar',
        skus: skus500,
        result,
        HttpsError: HttpsErrorMock,
        consoleWarn: () => {},
      });
      // no debería llegar acá
      expect.fail('expected throw');
    } catch (e) {
      /** @type {any} */
      const err = e;
      expect(err).toBeInstanceOf(HttpsErrorMock);
      expect(err.code).toBe('invalid-argument');
      expect(err.details.errorCode).toBe('TOO_MANY_SKUS');
      expect(err.details.requested).toBe(500);
      expect(err.message).toMatch(/cap SKUs excedido|demasiados SKUs/);
    }
  });

  it('T3 — fail-safe: si operations_log.add() tira, el throw igual ocurre', async () => {
    const { addSpy, db } = makeDbSpy({
      addImpl: async () => {
        throw new Error('firestore unavailable');
      },
    });
    const consoleWarn = vi.fn();
    const result = {
      ok: false,
      errorCode: /** @type {const} */ ('TOO_MANY_SKUS'),
      reason: 'cap_exceeded',
    };
    await expect(
      simulateWrapperBlock({
        db,
        auth: { uid: 'uid-y' },
        email: 'y@shimano.com.ar',
        skus: Array.from({ length: 300 }, (_, i) => 'K' + i),
        result,
        HttpsError: HttpsErrorMock,
        consoleWarn,
      })
    ).rejects.toThrow(/demasiados SKUs|cap SKUs excedido|TOO_MANY_SKUS/);
    expect(addSpy).toHaveBeenCalledTimes(1);
    // El warn del fail-safe sí se invocó.
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0][0]).toMatch(/operations_log write failed/);
  });

  it('T4 — auth=null no rompe (userId/userEmail quedan null)', async () => {
    const { addSpy, db } = makeDbSpy();
    const result = {
      ok: false,
      errorCode: /** @type {const} */ ('TOO_MANY_SKUS'),
      reason: 'cap_exceeded',
    };
    await expect(
      simulateWrapperBlock({
        db,
        auth: null,
        email: '',
        skus: Array.from({ length: 251 }, (_, i) => 'K' + i),
        result,
        HttpsError: HttpsErrorMock,
        consoleWarn: () => {},
      })
    ).rejects.toThrow(HttpsErrorMock);
    const entry = addSpy.mock.calls[0][0];
    expect(entry.userId).toBe(null);
    expect(entry.userEmail).toBe(null);
  });

  it('T5 — result.ok=true (sin errorCode) NO escribe a operations_log ni throw', async () => {
    const { addSpy, db } = makeDbSpy();
    const result = /** @type {any} */ ({
      ok: true,
      fisicoDep11: {},
      skusLive: [],
      skusSnapshot: [],
    });
    const out = await simulateWrapperBlock({
      db,
      auth: { uid: 'uid-z' },
      email: 'z@shimano.com.ar',
      skus: [],
      result,
      HttpsError: HttpsErrorMock,
      consoleWarn: () => {},
    });
    expect(out).toBeUndefined();
    expect(addSpy).not.toHaveBeenCalled();
  });
});
