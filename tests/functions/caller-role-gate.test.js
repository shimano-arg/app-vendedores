// @ts-check
/**
 * SEC F1A (2026-11-24) — gate por rol aprobado para commitPedidoCF,
 * updatePedidoLinesCF, fetchStockLiveCF y geminiOcrProxy (H1, H7, H9).
 *
 * Bloques:
 *  A — evaluateCallerRole (puro).
 *  B — authorizeCaller (lectura de roles + log del rechazo, mock Firestore).
 *  C — contrato de los wrappers en functions/index.js (grep: el wrapper no
 *      se puede ejecutar sin firebase-functions instalado; la lógica vive en
 *      el core puro, que se ejecuta en A y B).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetRoleRejectionLogDedupe,
  APPROVED_ROLES,
  authorizeCaller,
  evaluateCallerRole,
  normalizeRole,
  PACHI_UIDS,
  ROLE_REJECTION_LOG_MAX_KEYS,
  ROLE_REJECTION_LOG_WINDOW_MS,
  ROLE_REQUIRED_MESSAGE,
  USER_DISABLED_MESSAGE,
} from '../../functions/core/caller-role-gate.js';
import { PACHI_UIDS as PACHI_UIDS_CLIENTE } from '../../src/pure/pachi-restrictions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACHI = 'LaBFi1xkSLObzLEdRoP8fonZ06r2';

/**
 * Mock mínimo: roles/{uid}.get + operations_log.add.
 * @param {Record<string, any>} roles uid -> data (ausente = doc inexistente)
 * @param {{failRead?: boolean, failLog?: boolean}} [opts]
 */
function makeDb(roles, opts = {}) {
  /** @type {any[]} */
  const logs = [];
  const db = {
    logs,
    reads: 0,
    /** @param {string} name */
    collection(name) {
      if (name === 'roles') {
        return {
          /** @param {string} uid */
          doc(uid) {
            return {
              async get() {
                db.reads++;
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
          /** @param {any} entry */
          async add(entry) {
            if (opts.failLog) throw new Error('log boom');
            logs.push(entry);
            return { id: 'log' + logs.length };
          },
        };
      }
      throw new Error('colección inesperada ' + name);
    },
  };
  return db;
}

describe('A — evaluateCallerRole', () => {
  it('los 4 roles aprobados pasan', () => {
    for (const role of ['vendedor', 'interno', 'gerente', 'admin']) {
      const r = evaluateCallerRole({ role }, 'u1');
      expect(r).toMatchObject({ ok: true, code: 'ok', role, reason: 'ok' });
    }
    expect([...APPROVED_ROLES].sort()).toEqual(['admin', 'gerente', 'interno', 'vendedor']);
  });

  it('normaliza mayúsculas y espacios', () => {
    expect(evaluateCallerRole({ role: '  Vendedor ' }, 'u1').ok).toBe(true);
  });

  it('sin doc de rol → permission-denied (sin_doc_rol)', () => {
    for (const doc of [null, undefined]) {
      const r = evaluateCallerRole(doc, 'u1');
      expect(r).toMatchObject({ ok: false, code: 'permission-denied', reason: 'sin_doc_rol' });
      expect(r.message).toBe(ROLE_REQUIRED_MESSAGE);
    }
  });

  it('unassigned, viewer, vacío y desconocido → rechazados', () => {
    for (const role of ['unassigned', 'viewer', '', 'superadmin', 'vendedores', undefined]) {
      const r = evaluateCallerRole({ role }, 'u1');
      expect(r.ok, String(role)).toBe(false);
      expect(r.code).toBe('permission-denied');
      expect(r.reason).toBe('rol_no_aprobado');
    }
  });

  it('disabled:true o active:false → rechazado aunque el rol sea admin', () => {
    const a = evaluateCallerRole({ role: 'admin', disabled: true }, 'u1');
    const b = evaluateCallerRole({ role: 'vendedor', active: false }, 'u1');
    for (const r of [a, b]) {
      expect(r).toMatchObject({ ok: false, reason: 'usuario_deshabilitado' });
      expect(r.message).toBe(USER_DISABLED_MESSAGE);
    }
    // active:true o ausente no bloquea
    expect(evaluateCallerRole({ role: 'vendedor', active: true }, 'u1').ok).toBe(true);
  });

  it('sin uid → unauthenticated', () => {
    expect(evaluateCallerRole({ role: 'admin' }, '')).toMatchObject({
      ok: false,
      code: 'unauthenticated',
    });
  });

  it('el dominio del email no interviene: el helper no recibe email', () => {
    // gmail.com con rol vendedor (caso PACHI) pasa; gmail.com sin rol no.
    expect(evaluateCallerRole({ role: 'vendedor' }, 'gmail-user').ok).toBe(true);
    expect(evaluateCallerRole(null, 'gmail-user').ok).toBe(false);
  });

  it('extraAllowedUids (PACHI) pasa sin rol aprobado, pero no si está deshabilitado', () => {
    expect(PACHI_UIDS).toContain(PACHI);
    const opts = { extraAllowedUids: PACHI_UIDS };
    expect(evaluateCallerRole(null, PACHI, opts)).toMatchObject({
      ok: true,
      reason: 'uid_permitido',
    });
    expect(evaluateCallerRole({ role: 'unassigned' }, PACHI, opts).ok).toBe(true);
    expect(evaluateCallerRole({ role: 'vendedor', disabled: true }, PACHI, opts).ok).toBe(false);
    // Sin opts, PACHI no tiene excepción: necesita rol.
    expect(evaluateCallerRole(null, PACHI).ok).toBe(false);
    expect(evaluateCallerRole({ role: 'vendedor' }, PACHI).ok).toBe(true);
  });
});

describe('B — authorizeCaller', () => {
  beforeEach(() => _resetRoleRejectionLogDedupe());

  it('vendedor/interno/gerente/admin → ok y sin log', async () => {
    const db = makeDb({
      v: { role: 'vendedor' },
      i: { role: 'interno' },
      g: { role: 'gerente' },
      a: { role: 'admin' },
    });
    for (const uid of ['v', 'i', 'g', 'a']) {
      const r = await authorizeCaller({ fbDb: db, uid, email: `${uid}@shimano.com.ar`, via: 'x' });
      expect(r.ok).toBe(true);
    }
    expect(db.logs).toHaveLength(0);
  });

  it('gmail.com con rol vendedor → ok', async () => {
    const db = makeDb({ g1: { role: 'vendedor' } });
    const r = await authorizeCaller({ fbDb: db, uid: 'g1', email: 'alguien@gmail.com', via: 'x' });
    expect(r.ok).toBe(true);
  });

  it('gmail.com sin doc de rol → rechazo + 1 log ROLE_REQUIRED', async () => {
    const db = makeDb({});
    const r = await authorizeCaller({
      fbDb: db,
      uid: 'intruso',
      email: 'intruso@gmail.com',
      via: 'commit_pedido',
    });
    expect(r).toMatchObject({
      ok: false,
      code: 'permission-denied',
      reason: 'sin_doc_rol',
      errorCode: 'ROLE_REQUIRED',
    });
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({
      type: 'commit_pedido_rejected',
      errorCode: 'ROLE_REQUIRED',
      reason: 'sin_doc_rol',
      userId: 'intruso',
      userEmail: 'intruso@gmail.com',
      callerRole: '(vacío)',
      via: 'commit_pedido',
    });
    expect(db.logs[0].timestamp).toBeInstanceOf(Date);
  });

  it('@shimano.com.ar con rol unassigned → rechazo (antes pasaba por dominio)', async () => {
    const db = makeDb({ u: { role: 'unassigned' } });
    const r = await authorizeCaller({ fbDb: db, uid: 'u', email: 'x@shimano.com.ar', via: 'y' });
    expect(r.ok).toBe(false);
    expect(db.logs[0]).toMatchObject({ callerRole: 'unassigned', reason: 'rol_no_aprobado' });
  });

  it('viewer → rechazo', async () => {
    const db = makeDb({ w: { role: 'viewer' } });
    const r = await authorizeCaller({ fbDb: db, uid: 'w', via: 'y' });
    expect(r.ok).toBe(false);
  });

  it('falla la lectura de roles → rechazo (falla cerrada), incluso para PACHI', async () => {
    const db = makeDb({}, { failRead: true });
    const r = await authorizeCaller({ fbDb: db, uid: 'v', via: 'y' });
    // Falla cerrada pero reintentable: 'unavailable' + ROLE_CHECK_UNAVAILABLE
    // (no "pedile un rol a Mariano"). Sigue quedando registrado.
    expect(r).toMatchObject({
      ok: false,
      code: 'unavailable',
      reason: 'error_lectura_rol',
      errorCode: 'ROLE_CHECK_UNAVAILABLE',
    });
    expect(r.message).not.toMatch(/rol/i);
    expect(db.logs[0].roleReadError).toBe('read boom');
    expect(db.logs[0].errorCode).toBe('ROLE_CHECK_UNAVAILABLE');
    const r2 = await authorizeCaller({
      fbDb: db,
      uid: PACHI,
      via: 'y',
      extraAllowedUids: PACHI_UIDS,
    });
    expect(r2.ok).toBe(false);
  });

  it('PACHI con extraAllowedUids y sin doc → ok; sin opts → rechazo', async () => {
    const db = makeDb({});
    expect(
      (await authorizeCaller({ fbDb: db, uid: PACHI, via: 'y', extraAllowedUids: PACHI_UIDS })).ok
    ).toBe(true);
    expect((await authorizeCaller({ fbDb: db, uid: PACHI, via: 'y' })).ok).toBe(false);
  });

  it('si falla el log, el rechazo igual se devuelve', async () => {
    /** @type {any[]} */
    const warns = [];
    const db = makeDb({}, { failLog: true });
    const r = await authorizeCaller({
      fbDb: db,
      uid: 'x',
      via: 'y',
      log: (m, e) => warns.push([m, e]),
    });
    expect(r.ok).toBe(false);
    expect(warns.some(([m]) => String(m).includes('operations_log write failed'))).toBe(true);
  });
});

describe('D — H2: deduplicación del registro de rechazos', () => {
  beforeEach(() => _resetRoleRejectionLogDedupe());
  const T0 = 1_800_000_000_000;

  it('mismo (uid, via) en loop dentro de 10 min → rechaza siempre, registra 1 vez', async () => {
    const db = makeDb({});
    for (let i = 0; i < 50; i++) {
      const r = await authorizeCaller({
        fbDb: db,
        uid: 'loop',
        via: 'commit_pedido',
        now: T0 + i * 1000,
      });
      expect(r).toMatchObject({ ok: false, code: 'permission-denied', reason: 'sin_doc_rol' });
    }
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({
      userId: 'loop',
      via: 'commit_pedido',
      suppressedSinceLast: 0,
    });
  });

  it('pasada la ventana vuelve a registrar, con la cuenta de suprimidos', async () => {
    const db = makeDb({});
    await authorizeCaller({ fbDb: db, uid: 'u1', via: 'x', now: T0 });
    await authorizeCaller({ fbDb: db, uid: 'u1', via: 'x', now: T0 + 1000 });
    await authorizeCaller({ fbDb: db, uid: 'u1', via: 'x', now: T0 + 2000 });
    await authorizeCaller({
      fbDb: db,
      uid: 'u1',
      via: 'x',
      now: T0 + ROLE_REJECTION_LOG_WINDOW_MS - 1,
    });
    expect(db.logs).toHaveLength(1);
    await authorizeCaller({
      fbDb: db,
      uid: 'u1',
      via: 'x',
      now: T0 + ROLE_REJECTION_LOG_WINDOW_MS,
    });
    expect(db.logs).toHaveLength(2);
    expect(db.logs[1].suppressedSinceLast).toBe(3);
    expect(db.logs[1].timestamp.getTime()).toBe(T0 + ROLE_REJECTION_LOG_WINDOW_MS);
  });

  it('la ventana es de 10 minutos', () => {
    expect(ROLE_REJECTION_LOG_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it('distinto via o distinto uid → registros separados', async () => {
    const db = makeDb({});
    await authorizeCaller({ fbDb: db, uid: 'a', via: 'commit_pedido', now: T0 });
    await authorizeCaller({ fbDb: db, uid: 'a', via: 'gemini_ocr', now: T0 });
    await authorizeCaller({ fbDb: db, uid: 'b', via: 'commit_pedido', now: T0 });
    await authorizeCaller({ fbDb: db, uid: 'a', via: 'commit_pedido', now: T0 + 5 });
    expect(db.logs.map((l) => `${l.via}|${l.userId}`)).toEqual([
      'commit_pedido|a',
      'gemini_ocr|a',
      'commit_pedido|b',
    ]);
  });

  it('el registro que sí se escribe es con await (existe al volver)', async () => {
    const db = makeDb({});
    await authorizeCaller({ fbDb: db, uid: 'aw', via: 'x', now: T0 });
    expect(db.logs).toHaveLength(1);
  });

  it('si la escritura falla, no cuenta como registrada: el próximo rechazo reintenta', async () => {
    const db = makeDb({}, { failLog: true });
    const r1 = await authorizeCaller({ fbDb: db, uid: 'f', via: 'x', now: T0 });
    expect(r1.ok).toBe(false);
    const ok = makeDb({});
    await authorizeCaller({ fbDb: ok, uid: 'f', via: 'x', now: T0 + 1000 });
    expect(ok.logs).toHaveLength(1);
  });

  it('llamadas concurrentes del mismo (uid, via) → 1 registro', async () => {
    const db = makeDb({});
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => authorizeCaller({ fbDb: db, uid: 'c', via: 'x', now: T0 }))
    );
    expect(rs.every((r) => r.ok === false)).toBe(true);
    expect(db.logs).toHaveLength(1);
  });

  it('autorizados no tocan el estado ni registran', async () => {
    const db = makeDb({ v: { role: 'vendedor' } });
    for (let i = 0; i < 5; i++) {
      expect((await authorizeCaller({ fbDb: db, uid: 'v', via: 'x', now: T0 + i })).ok).toBe(true);
    }
    expect(db.logs).toHaveLength(0);
  });

  it('muchas cuentas distintas no hacen crecer el estado sin límite (siguen registrándose)', async () => {
    const db = makeDb({});
    const n = ROLE_REJECTION_LOG_MAX_KEYS + 10;
    for (let i = 0; i < n; i++) {
      await authorizeCaller({ fbDb: db, uid: `g${i}`, via: 'x', now: T0 });
    }
    expect(db.logs).toHaveLength(n);
    // Las primeras se podaron: un nuevo rechazo de g0 vuelve a registrarse.
    await authorizeCaller({ fbDb: db, uid: 'g0', via: 'x', now: T0 + 1 });
    expect(db.logs).toHaveLength(n + 1);
  });
});

describe('E — H4: role debe ser string', () => {
  beforeEach(() => _resetRoleRejectionLogDedupe());

  it.each([[['admin']], [{ role: 'admin' }], [1], [true], [new String('admin')]])(
    'role %j → rechazo con reason rol_tipo_invalido',
    (bad) => {
      const r = evaluateCallerRole({ role: bad }, 'u1');
      expect(r).toMatchObject({
        ok: false,
        code: 'permission-denied',
        reason: 'rol_tipo_invalido',
      });
    }
  );

  it('normalizeRole devuelve vacío para no-string', () => {
    expect(normalizeRole(['admin'])).toBe('');
    expect(normalizeRole({})).toBe('');
    expect(normalizeRole(5)).toBe('');
    expect(normalizeRole(null)).toBe('');
    expect(normalizeRole(undefined)).toBe('');
    expect(normalizeRole(' Admin ')).toBe('admin');
  });

  it('role null/ausente sigue como rol_no_aprobado', () => {
    expect(evaluateCallerRole({ role: null }, 'u1').reason).toBe('rol_no_aprobado');
    expect(evaluateCallerRole({}, 'u1').reason).toBe('rol_no_aprobado');
  });

  it('authorizeCaller con role array → rechazo y registro', async () => {
    const db = makeDb({ arr: { role: ['admin'] } });
    const r = await authorizeCaller({ fbDb: db, uid: 'arr', via: 'x' });
    expect(r.ok).toBe(false);
    expect(db.logs[0]).toMatchObject({ reason: 'rol_tipo_invalido', callerRole: '(vacío)' });
  });

  it('release-asig-core (usa evaluateCallerRole) también rechaza role no string', () => {
    // evaluateCallerRole es la única función de decisión; se valida acá.
    expect(evaluateCallerRole({ role: ['vendedor'] }, 'v').ok).toBe(false);
  });
});

describe('F — H5: PACHI_UIDS sincronizado en las 3 copias', () => {
  const sort = (/** @type {ReadonlyArray<string>} */ a) => [...a].sort();

  it('functions/core coincide con src/pure/pachi-restrictions.js', () => {
    expect(sort(PACHI_UIDS)).toEqual(sort(PACHI_UIDS_CLIENTE));
  });

  it('functions/core coincide con isPachiUid() de firestore.rules', () => {
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
    const m = rules.match(/function isPachiUid\(\)\s*\{([\s\S]*?)\n\s*\}/);
    expect(m).not.toBeNull();
    const uids = [...(m ? m[1] : '').matchAll(/request\.auth\.uid == '([^']+)'/g)].map((x) => x[1]);
    expect(uids.length).toBeGreaterThan(0);
    expect(sort(uids)).toEqual(sort(PACHI_UIDS));
  });

  it('sin duplicados', () => {
    expect(new Set(PACHI_UIDS).size).toBe(PACHI_UIDS.length);
  });
});

describe('C — contrato de los wrappers en functions/index.js', () => {
  const src = readFileSync(resolve(__dirname, '../../functions/index.js'), 'utf8');

  /** @param {string} name */
  function handlerBody(name) {
    const start = src.indexOf(`export const ${name} = onCall(`);
    expect(start, name).toBeGreaterThan(-1);
    // Fin del onCall(...): primer `\n);` a nivel raíz después del inicio.
    const end = src.indexOf('\n);\n', start);
    expect(end, name).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('importa el helper', () => {
    expect(src).toMatch(
      /import \{ authorizeCaller, PACHI_UIDS \} from '\.\/core\/caller-role-gate\.js';/
    );
    expect(src).toMatch(/async function _requireApprovedRole\(/);
    // El wrapper propaga el errorCode del gate (ROLE_REQUIRED o, si falló la
    // lectura del rol, ROLE_CHECK_UNAVAILABLE) con ROLE_REQUIRED por defecto.
    expect(src).toMatch(/errorCode: r\.errorCode \|\| 'ROLE_REQUIRED'/);
  });

  it('releaseAsigCF: propaga details del core (errorCode de rol/permiso)', () => {
    const i = src.indexOf('export const releaseAsigCF');
    const block = src.slice(i, src.indexOf('\n);\n', i));
    expect(block).toMatch(/e\._errorDetails/);
    expect(block).toMatch(
      /new HttpsError\(e\._errorCode, e\.message \|\| 'release asig fallo', details\)/
    );
  });

  it('commitPedidoCF: exige rol y ya no acepta gmail.com por dominio', () => {
    const body = handlerBody('commitPedidoCF');
    expect(body).toMatch(/await _requireApprovedRole\(db, auth, 'commit_pedido'\)/);
    expect(body).not.toMatch(/ALLOWED_DOMAINS/);
    expect(body).not.toMatch(/'gmail\.com'/);
    // El gate corre antes de llamar al core.
    expect(body.indexOf('_requireApprovedRole')).toBeLessThan(body.indexOf('commitPedidoCore('));
  });

  it('updatePedidoLinesCF: exige rol (falla cerrada) y pasa ese rol al core', () => {
    const body = handlerBody('updatePedidoLinesCF');
    expect(body).toMatch(
      /const role = await _requireApprovedRole\(db, auth, 'update_pedido_lines'\)/
    );
    expect(body).not.toMatch(/ALLOWED_DOMAINS/);
    // El try/catch viejo que seguía con rol vacío ya no está.
    expect(body).not.toMatch(/VDE queda sin role/);
    expect(body.indexOf('_requireApprovedRole')).toBeLessThan(
      body.indexOf('updatePedidoLinesCore(')
    );
  });

  it('fetchStockLiveCF: rol + excepción PACHI por UID, sin gate de dominio', () => {
    const body = handlerBody('fetchStockLiveCF');
    expect(body).toMatch(/_requireApprovedRole\(getFirestore\(\), auth, 'fetch_stock_live', \{/);
    expect(body).toMatch(/extraAllowedUids: PACHI_UIDS/);
    expect(body).not.toMatch(/dominio no permitido/);
  });

  it('geminiOcrProxy: rol antes del rate limit y de Gemini', () => {
    const body = handlerBody('geminiOcrProxy');
    const gate = body.indexOf("_requireApprovedRole(getFirestore(), request.auth, 'gemini_ocr')");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf('checkAndIncrementRateLimit('));
    expect(gate).toBeLessThan(body.indexOf('runGeminiOcr('));
  });
});
