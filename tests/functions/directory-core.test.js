// S-7 P0-A Fase 2A — tests del core directory-core.
//
// Verifican que:
// 1. getUsersDirectoryCore NUNCA retorna campos del set PRIVATE_FIELDS.
// 2. Filtros filterRole / byVendorKey / uids funcionan como la rule espera.
// 3. uids > 50 se trunca.
// 4. Payload inválido se sanea (no throws).

import { describe, expect, it } from 'vitest';
import {
  getUsersDirectoryCore,
  PRIVATE_FIELDS,
  PUBLIC_FIELDS,
} from '../../functions/core/directory-core.js';

// ---- mock Firestore minimo (query where / get / forEach) ----

/**
 * Store: Map de uid -> data. Soporta chain de .where() y .get().
 * where('role', '==', X) filtra por data.role === X.
 * where('vendor', '==', X) filtra por data.vendor === X.
 * where('__name__', 'in', arr) filtra por uid ∈ arr.
 * .get() devuelve {forEach(fn)} con docs {id, data()}.
 */
function makeMockDb(initial = []) {
  const store = new Map(initial.map((u) => [u.uid, u]));

  function makeQuery(filters) {
    return {
      where(field, op, value) {
        if (op !== '==' && op !== 'in') {
          throw new Error('mock soporta solo ==, in: ' + op);
        }
        return makeQuery([...filters, { field, op, value }]);
      },
      async get() {
        const docs = [];
        for (const [uid, data] of store.entries()) {
          let ok = true;
          for (const f of filters) {
            if (f.field === '__name__') {
              if (!f.value.includes(uid)) {
                ok = false;
                break;
              }
            } else {
              if (data[f.field] !== f.value) {
                ok = false;
                break;
              }
            }
          }
          if (ok) docs.push({ id: uid, data: () => ({ ...data }) });
        }
        return {
          forEach(fn) {
            docs.forEach(fn);
          },
        };
      },
    };
  }

  return {
    _store: store,
    collection(col) {
      if (col !== 'roles') throw new Error('mock solo /roles');
      return makeQuery([]);
    },
  };
}

// ---- fixture ----
// Set realista con admin/gerente/interno/vendedor + secrets poblados.
function makeUsers() {
  return [
    {
      uid: 'uid-admin-1',
      role: 'admin',
      email: 'admin@example.com',
      displayName: 'Admin User',
      active: true,
      passwordHash: '<HASH-ADMIN>',
      passwordSalt: '<SALT-ADMIN>',
    },
    {
      uid: 'uid-gerente-1',
      role: 'gerente',
      email: 'gerente@example.com',
      displayName: 'Gerente User',
      active: true,
      totpSecret: '<TOTP-GER>',
      totpEnabled: true,
    },
    {
      uid: 'uid-interno-1',
      role: 'interno',
      email: 'interno@example.com',
      displayName: 'Interno User',
      active: true,
      internalPartnerUid: 'uid-vde-1',
      passwordHash: '<HASH-INT>',
    },
    {
      uid: 'uid-vde-1',
      role: 'vendedor',
      email: 'vde1@example.com',
      displayName: 'VDE Uno',
      vendor: 'PACHI',
      zone: 'Z4',
      active: true,
      passwordHash: '<HASH-VDE-1>',
      passwordSalt: '<SALT-VDE-1>',
      totpSecret: '<TOTP-VDE-1>',
      totpEnabled: true,
    },
    {
      uid: 'uid-vde-2',
      role: 'vendedor',
      email: 'vde2@example.com',
      displayName: 'VDE Dos',
      vendor: 'MAURICIO GIL',
      zone: 'Z5',
      active: true,
      passwordHash: '<HASH-VDE-2>',
    },
    {
      uid: 'uid-vde-3',
      role: 'vendedor',
      email: 'vde3@example.com',
      displayName: 'VDE Tres',
      vendor: 'GONZALO DE LA ROSA',
      zone: 'Z6',
      active: false,
    },
  ];
}

function expectNoSecrets(users) {
  for (const u of users) {
    for (const f of PRIVATE_FIELDS) {
      expect(u[f], `secreto filtrado: ${f} en uid=${u.uid}`).toBeUndefined();
    }
  }
}

describe('getUsersDirectoryCore (S-7 P0-A Fase 2)', () => {
  it('retorna todos los users sin filtro, strippeando secretos', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore({ fbDb: db }, {});
    expect(r.users).toHaveLength(6);
    expectNoSecrets(r.users);
    // uid siempre presente
    for (const u of r.users) expect(u.uid).toBeTruthy();
  });

  it('filterRole=vendedor devuelve solo VDEs sin secretos', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore({ fbDb: db }, { filterRole: 'vendedor' });
    expect(r.users).toHaveLength(3);
    for (const u of r.users) expect(u.role).toBe('vendedor');
    expectNoSecrets(r.users);
  });

  it('filterRole=admin devuelve solo admins sin secretos', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore({ fbDb: db }, { filterRole: 'admin' });
    expect(r.users).toHaveLength(1);
    expect(r.users[0].role).toBe('admin');
    expectNoSecrets(r.users);
  });

  it('filterRole inválido es ignorado (devuelve todo)', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore({ fbDb: db }, { filterRole: 'hackerman' });
    expect(r.users).toHaveLength(6);
    expectNoSecrets(r.users);
  });

  it('byVendorKey=PACHI devuelve solo matches sin secretos', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore({ fbDb: db }, { byVendorKey: 'PACHI' });
    expect(r.users).toHaveLength(1);
    expect(r.users[0].uid).toBe('uid-vde-1');
    expect(r.users[0].vendor).toBe('PACHI');
    expectNoSecrets(r.users);
  });

  it('filterRole + byVendorKey combinado', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore(
      { fbDb: db },
      { filterRole: 'vendedor', byVendorKey: 'MAURICIO GIL' }
    );
    expect(r.users).toHaveLength(1);
    expect(r.users[0].uid).toBe('uid-vde-2');
    expectNoSecrets(r.users);
  });

  it('uids array con 2 items devuelve solo esos', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore({ fbDb: db }, { uids: ['uid-admin-1', 'uid-vde-1'] });
    expect(r.users).toHaveLength(2);
    const ids = r.users.map((u) => u.uid).sort();
    expect(ids).toEqual(['uid-admin-1', 'uid-vde-1']);
    expectNoSecrets(r.users);
  });

  it('uids > 50 se trunca a 50 (no crash)', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      uid: 'uid-' + i,
      role: 'vendedor',
      email: 'u' + i + '@x.com',
      passwordHash: '<H-' + i + '>',
    }));
    const db = makeMockDb(many);
    const payload = { uids: many.map((u) => u.uid) }; // 100 uids
    const r = await getUsersDirectoryCore({ fbDb: db }, payload);
    // El core trunca a 50 → max 50 usuarios devueltos.
    expect(r.users.length).toBeLessThanOrEqual(50);
    expect(r.users.length).toBe(50);
    expectNoSecrets(r.users);
  });

  it('uids con valores no-string se filtra (defensivo)', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore(
      { fbDb: db },
      { uids: ['uid-admin-1', null, undefined, 123, {}, 'uid-vde-1'] }
    );
    expect(r.users).toHaveLength(2);
    expectNoSecrets(r.users);
  });

  it('secretos NUNCA en response (strict check sobre todos los campos)', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore({ fbDb: db }, {});
    // Verificación directa de cada secret field.
    const serialized = JSON.stringify(r.users);
    for (const f of PRIVATE_FIELDS) {
      expect(serialized, `${f} presente en response`).not.toContain(f);
    }
    // Y que ningún valor de los fixtures (ej. <HASH-ADMIN>) aparezca.
    for (const u of r.users) {
      const asStr = JSON.stringify(u);
      expect(asStr).not.toMatch(/<HASH-/);
      expect(asStr).not.toMatch(/<SALT-/);
      expect(asStr).not.toMatch(/<TOTP-/);
    }
  });

  it('shape mínimo retornado: uid + role (campos públicos disponibles)', async () => {
    const db = makeMockDb(makeUsers());
    const r = await getUsersDirectoryCore({ fbDb: db }, { uids: ['uid-vde-1'] });
    const u = r.users[0];
    expect(u.uid).toBe('uid-vde-1');
    expect(u.role).toBe('vendedor');
    expect(u.vendor).toBe('PACHI');
    expect(u.zone).toBe('Z4');
    expect(u.email).toBe('vde1@example.com');
    expect(u.displayName).toBe('VDE Uno');
    expect(u.active).toBe(true);
    // Verificar que NO se agregaron campos espurios.
    const keys = Object.keys(u).sort();
    const expected = ['active', 'displayName', 'email', 'role', 'uid', 'vendor', 'zone'].sort();
    expect(keys).toEqual(expected);
  });

  it('deps.fbDb obligatorio', async () => {
    await expect(getUsersDirectoryCore(null, {})).rejects.toThrow();
    await expect(getUsersDirectoryCore({}, {})).rejects.toThrow();
  });

  it('payload vacío / null / undefined no crashea', async () => {
    const db = makeMockDb(makeUsers());
    await expect(getUsersDirectoryCore({ fbDb: db }, null)).resolves.toBeDefined();
    await expect(getUsersDirectoryCore({ fbDb: db }, undefined)).resolves.toBeDefined();
    await expect(getUsersDirectoryCore({ fbDb: db }, {})).resolves.toBeDefined();
  });

  it('PUBLIC_FIELDS está frozen', () => {
    expect(Object.isFrozen(PUBLIC_FIELDS)).toBe(true);
    expect(Object.isFrozen(PRIVATE_FIELDS)).toBe(true);
  });

  it('PRIVATE_FIELDS incluye los 4 secretos documentados', () => {
    expect(PRIVATE_FIELDS).toContain('passwordHash');
    expect(PRIVATE_FIELDS).toContain('passwordSalt');
    expect(PRIVATE_FIELDS).toContain('totpSecret');
    expect(PRIVATE_FIELDS).toContain('totpEnabled');
  });
});
