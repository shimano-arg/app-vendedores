// @ts-check
/**
 * SEC-02 (P0, 2026-10-29) — autorización por rol de commitPedidoCF y
 * updatePedidoLinesCF.
 *
 * Unit tests del helper puro + de authorizeCallerRole con un Firestore mock
 * (sin emulador) + contrato de los wrappers en functions/index.js.
 * Los tests de assertCallerRole T1-T7 vienen del PR #1284.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ROLES,
  assertCallerRole,
  authorizeCallerRole,
  ROLE_REQUIRED_MESSAGE,
  withCallerRole,
} from '../../functions/core/caller-role.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Firestore mock mínimo: roles/{uid} + operations_log.add.
 * @param {Record<string, any>} roles uid -> data (undefined = doc inexistente)
 * @param {{failRead?: boolean, failLog?: boolean}} [opts]
 */
function makeDb(roles, opts = {}) {
  /** @type {any[]} */
  const logs = [];
  const db = {
    logs,
    collection(name) {
      if (name === 'roles') {
        return {
          doc(uid) {
            return {
              async get() {
                if (opts.failRead) throw new Error('read boom');
                const data = roles[uid];
                return { exists: data !== undefined, data: () => data };
              },
            };
          },
        };
      }
      if (name === 'operations_log') {
        return {
          async add(entry) {
            if (opts.failLog) throw new Error('log boom');
            logs.push(entry);
            return { id: 'log-' + logs.length };
          },
        };
      }
      throw new Error('colección inesperada: ' + name);
    },
  };
  return db;
}

describe('assertCallerRole (del PR #1284)', () => {
  it('T1: role="vendedor" → ok, normalized="vendedor"', () => {
    const r = assertCallerRole('vendedor');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('vendedor');
    expect(r.errorCode).toBeUndefined();
  });

  it('T2: role="VENDEDOR" → ok (normaliza a minúsculas)', () => {
    expect(assertCallerRole('VENDEDOR')).toMatchObject({ ok: true, normalized: 'vendedor' });
  });

  it('T3: role="  interno  " → ok (trim)', () => {
    expect(assertCallerRole('  interno  ')).toMatchObject({ ok: true, normalized: 'interno' });
  });

  it('T4: role="" → ROLE_REQUIRED', () => {
    expect(assertCallerRole('')).toMatchObject({ ok: false, errorCode: 'ROLE_REQUIRED' });
  });

  it('T5: viewer / unassigned (fuera de la lista) → ROLE_REQUIRED', () => {
    expect(assertCallerRole('viewer')).toMatchObject({ ok: false, errorCode: 'ROLE_REQUIRED' });
    expect(assertCallerRole('unassigned')).toMatchObject({ ok: false, errorCode: 'ROLE_REQUIRED' });
  });

  it('T6: null / undefined → ROLE_REQUIRED', () => {
    expect(assertCallerRole(null).ok).toBe(false);
    expect(assertCallerRole(undefined).ok).toBe(false);
  });

  it('T7: ALLOWED_ROLES contiene exactamente vendedor, interno, gerente, admin', () => {
    expect([...ALLOWED_ROLES].sort()).toEqual(['admin', 'gerente', 'interno', 'vendedor']);
  });
});

describe('authorizeCallerRole (lectura de rol en servidor)', () => {
  it('A1: usuario autenticado SIN doc en roles → rechazo ROLE_REQUIRED + log', async () => {
    const db = makeDb({});
    await expect(
      authorizeCallerRole({ fbDb: db, uid: 'u-gmail', email: 'x@gmail.com', via: 'commit_pedido' })
    ).rejects.toMatchObject({
      code: 'permission-denied',
      errorCode: 'ROLE_REQUIRED',
      message: ROLE_REQUIRED_MESSAGE,
    });
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({
      type: 'commit_pedido_rejected',
      errorCode: 'ROLE_REQUIRED',
      userId: 'u-gmail',
      callerRole: '(vacío)',
    });
  });

  it('A2: rol unassigned → rechazo', async () => {
    const db = makeDb({ u1: { role: 'unassigned' } });
    await expect(
      authorizeCallerRole({ fbDb: db, uid: 'u1', via: 'commit_pedido' })
    ).rejects.toMatchObject({ errorCode: 'ROLE_REQUIRED' });
    expect(db.logs[0].callerRole).toBe('unassigned');
  });

  it('A3: rol viewer → rechazo', async () => {
    const db = makeDb({ u1: { role: 'viewer' } });
    await expect(
      authorizeCallerRole({ fbDb: db, uid: 'u1', via: 'update_pedido_lines' })
    ).rejects.toMatchObject({ errorCode: 'ROLE_REQUIRED' });
  });

  it('A4: vendedor válido → autorizado, sin log de rechazo', async () => {
    const db = makeDb({ v1: { role: 'vendedor' } });
    await expect(
      authorizeCallerRole({ fbDb: db, uid: 'v1', via: 'commit_pedido' })
    ).resolves.toEqual({ role: 'vendedor' });
    expect(db.logs).toHaveLength(0);
  });

  it('A5: admin, gerente e interno → autorizados (operaciones legítimas preservadas)', async () => {
    const db = makeDb({ a: { role: 'admin' }, g: { role: 'gerente' }, i: { role: 'interno' } });
    for (const uid of ['a', 'g', 'i']) {
      const r = await authorizeCallerRole({ fbDb: db, uid, via: 'commit_pedido' });
      expect(['admin', 'gerente', 'interno']).toContain(r.role);
    }
  });

  it('A6: Gmail con rol vendedor (caso Pachi) → autorizado: el dominio ya no decide', async () => {
    const db = makeDb({ p: { role: 'vendedor', email: 'x@gmail.com' } });
    await expect(
      authorizeCallerRole({ fbDb: db, uid: 'p', email: 'x@gmail.com', via: 'commit_pedido' })
    ).resolves.toEqual({ role: 'vendedor' });
  });

  it('A7: email corporativo sin rol → rechazo (el dominio no reemplaza al rol)', async () => {
    const db = makeDb({});
    await expect(
      authorizeCallerRole({
        fbDb: db,
        uid: 'fake',
        email: 'inventado@shimano.com.ar',
        via: 'commit_pedido',
      })
    ).rejects.toMatchObject({ errorCode: 'ROLE_REQUIRED' });
  });

  it('A8: falla la lectura de roles → falla cerrada (rechazo) y registra el error', async () => {
    const db = makeDb({ v1: { role: 'vendedor' } }, { failRead: true });
    /** @type {any[]} */
    const logged = [];
    await expect(
      authorizeCallerRole({
        fbDb: db,
        uid: 'v1',
        via: 'commit_pedido',
        log: (m, x) => logged.push([m, x]),
      })
    ).rejects.toMatchObject({ errorCode: 'ROLE_REQUIRED' });
    expect(db.logs[0].roleReadError).toBe('read boom');
    expect(logged.some(([m]) => String(m).includes('read failed'))).toBe(true);
  });

  it('A9: falla el write de operations_log → igual rechaza y lo deja en log()', async () => {
    const db = makeDb({}, { failLog: true });
    /** @type {any[]} */
    const logged = [];
    await expect(
      authorizeCallerRole({
        fbDb: db,
        uid: 'x',
        via: 'commit_pedido',
        log: (m, x) => logged.push([m, x]),
      })
    ).rejects.toMatchObject({ errorCode: 'ROLE_REQUIRED' });
    expect(logged.some(([m]) => String(m).includes('operations_log write failed'))).toBe(true);
  });
});

describe('contrato de los wrappers en functions/index.js', () => {
  const src = readFileSync(resolve(__dirname, '../../functions/index.js'), 'utf8');

  /** @param {string} name */
  function wrapperBody(name) {
    const start = src.indexOf(`export const ${name} = onCall(`);
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('\nexport const ', start + 10);
    return src.slice(start, next === -1 ? undefined : next);
  }

  it('W1: commitPedidoCF usa withCallerRole y no usa el gate por dominio', () => {
    const body = wrapperBody('commitPedidoCF');
    expect(body).toMatch(/withCallerRole\(\s*\{ via: 'commit_pedido'/);
    expect(body).not.toContain('ALLOWED_DOMAINS');
    expect(body.indexOf('withCallerRole(')).toBeLessThan(body.indexOf('commitPedidoCore('));
  });

  it('W2: updatePedidoLinesCF usa withCallerRole y no usa el gate por dominio', () => {
    const body = wrapperBody('updatePedidoLinesCF');
    expect(body).toMatch(/withCallerRole\(\s*\{ via: 'update_pedido_lines'/);
    expect(body).not.toContain('ALLOWED_DOMAINS');
    expect(body.indexOf('withCallerRole(')).toBeLessThan(body.indexOf('updatePedidoLinesCore('));
  });

  it('W3: el wrapper ya no traduce errores a mano (lo hace withCallerRole, bloque H)', () => {
    for (const name of ['commitPedidoCF', 'updatePedidoLinesCF']) {
      expect(wrapperBody(name)).not.toContain('authorizeCallerRole(');
    }
  });
});

// D9 (2026-10-29): se EJECUTA el envoltorio que usan los dos onCall.
class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

describe('withCallerRole — el handler solo corre con rol válido (D9)', () => {
  function wrap(roles, opts) {
    const db = makeDb(roles, opts);
    let calls = 0;
    /** @type {any} */
    let ctxSeen = null;
    const fn = withCallerRole(
      { via: 'commit_pedido', getDb: () => db, HttpsError: FakeHttpsError, log: () => {} },
      async (_req, ctx) => {
        calls++;
        ctxSeen = ctx;
        return { ok: true };
      }
    );
    return { fn, db, calls: () => calls, ctx: () => ctxSeen };
  }

  it('H1: sin auth → unauthenticated y el handler no corre', async () => {
    const w = wrap({});
    await expect(w.fn({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(w.calls()).toBe(0);
  });

  it('H2: sin doc en roles → permission-denied con details.errorCode=ROLE_REQUIRED; handler no corre', async () => {
    const w = wrap({});
    await expect(
      w.fn({ auth: { uid: 'u1', token: { email: 'x@gmail.com' } } })
    ).rejects.toMatchObject({
      code: 'permission-denied',
      details: { errorCode: 'ROLE_REQUIRED' },
    });
    expect(w.calls()).toBe(0);
    expect(w.db.logs).toHaveLength(1);
  });

  it('H3: unassigned / viewer → rechazo; handler no corre', async () => {
    for (const role of ['unassigned', 'viewer']) {
      const w = wrap({ u1: { role } });
      await expect(w.fn({ auth: { uid: 'u1', token: {} } })).rejects.toMatchObject({
        code: 'permission-denied',
      });
      expect(w.calls()).toBe(0);
    }
  });

  it('H4: falla la lectura de roles → rechazo (falla cerrada); handler no corre', async () => {
    const w = wrap({ u1: { role: 'vendedor' } }, { failRead: true });
    await expect(w.fn({ auth: { uid: 'u1', token: {} } })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(w.calls()).toBe(0);
  });

  it('H5: vendedor con Gmail → el handler corre y recibe db, email normalizado y rol', async () => {
    const w = wrap({ u1: { role: 'Vendedor' } });
    await expect(w.fn({ auth: { uid: 'u1', token: { email: 'VDE@Gmail.com' } } })).resolves.toEqual(
      { ok: true }
    );
    expect(w.calls()).toBe(1);
    expect(w.ctx()).toMatchObject({ email: 'vde@gmail.com', role: 'vendedor' });
    expect(w.ctx().db).toBe(w.db);
  });

  it('H6: un error no relacionado con el rol se propaga sin traducir', async () => {
    const db = {
      collection: () => {
        throw new Error('boom inesperado');
      },
    };
    const fn = withCallerRole(
      { via: 'x', getDb: () => db, HttpsError: FakeHttpsError, log: () => {} },
      async () => 1
    );
    // authorizeCallerRole captura el error de lectura → ROLE_REQUIRED (falla cerrada).
    await expect(fn({ auth: { uid: 'u1', token: {} } })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});
