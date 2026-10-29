/**
 * D2 + D3 (2026-10-29) — lectura de secretos en roles/{uid} y bootstrap admin.
 *
 * D2: cualquier cuenta autenticada (incluida una `unassigned` recién creada)
 *     podía leer los docs `roles` de vendedores, que contienen totpSecret y
 *     passwordHash. Ahora la lectura de docs de vendedores exige rol lector.
 *     `auth_secrets/{uid}` (destino de la migración) queda cerrado a clientes.
 * D3: el create de roles con role='admin' para la cuenta bootstrap exige
 *     email verificado y login con Google.
 *
 * Requiere emulador: FALLA si no está (no pasa en vacío).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  clearTestEnv,
  doc,
  emulatorUnavailable,
  getDoc,
  initTestEnv,
  seedCanonicalRoles,
  seedDoc,
  setDoc,
  UID,
} from './setup.js';

beforeAll(async () => {
  await initTestEnv();
});
afterAll(async () => {
  await cleanupTestEnv();
});
beforeEach(async () => {
  await clearTestEnv();
  await seedCanonicalRoles();
  // Doc de vendedor con secretos (estado actual de producción, valores ficticios).
  await seedDoc(`roles/${UID.vendorOther}`, {
    role: 'vendedor',
    vendor: 'VDE_OTRO',
    email: 'otro@test.invalid',
    totpSecret: 'FICTICIO',
    passwordHash: 'ficticio',
    passwordSalt: 'ficticio',
  });
  await seedDoc(`auth_secrets/${UID.vendor}`, { passwordHash: 'ficticio', totpSecret: 'FICTICIO' });
});

const bootToken = (extra = {}) => ({
  email: 'bot.shimano.pesca@gmail.com',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
  ...extra,
});
const altaAdmin = () => ({
  email: 'bot.shimano.pesca@gmail.com',
  displayName: 'Bot',
  role: 'admin',
  vendor: null,
  createdAt: new Date(),
});

describe('D2/D3 — precondición', () => {
  it('el emulador de Firestore está disponible', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});

describe('D2 — lectura de roles de vendedores', () => {
  it('L1: usuario unassigned NO puede leer el doc de un vendedor (antes: sí)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.unassigned), 'roles', UID.vendorOther)));
  });
  it('L2: autenticado sin doc en roles NO puede leer el doc de un vendedor', async () => {
    await assertFails(getDoc(doc(authedDb('uid-sin-doc'), 'roles', UID.vendorOther)));
  });
  it('L3: un vendedor sigue pudiendo leer docs de vendedores (caso v1491 vendorKey→UID)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'roles', UID.vendorOther)));
  });
  it('L4: interno, viewer, gerente y admin siguen pudiendo leerlos', async () => {
    for (const u of [UID.interno, UID.viewer, UID.gerente, UID.admin]) {
      await assertSucceeds(getDoc(doc(authedDb(u), 'roles', UID.vendorOther)));
    }
  });
  it('L5: cada usuario sigue leyendo su propio doc (incluido unassigned)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.unassigned), 'roles', UID.unassigned)));
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'roles', UID.vendor)));
  });
});

describe('D2 — auth_secrets cerrado a clientes', () => {
  it('S1: el dueño no puede leer ni escribir su propio auth_secrets', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'auth_secrets', UID.vendor)));
    await assertFails(setDoc(doc(authedDb(UID.vendor), 'auth_secrets', UID.vendor), { x: 1 }));
  });
  it('S2: otro vendedor no puede leer los secretos de un vendedor', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendorOther), 'auth_secrets', UID.vendor)));
  });
  it('S3: ni admin ni gerente leen auth_secrets desde el cliente (solo Admin SDK)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.admin), 'auth_secrets', UID.vendor)));
    await assertFails(getDoc(doc(authedDb(UID.gerente), 'auth_secrets', UID.vendor)));
  });
});

describe('D3 — bootstrap admin', () => {
  it('B1: email verificado + Google → puede crearse admin', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb('uid-boot-1', bootToken()), 'roles', 'uid-boot-1'), altaAdmin())
    );
  });
  it('B2: mismo email SIN verificar → DENEGADO', async () => {
    await assertFails(
      setDoc(
        doc(authedDb('uid-boot-2', bootToken({ email_verified: false })), 'roles', 'uid-boot-2'),
        altaAdmin()
      )
    );
  });
  it('B3: mismo email con proveedor password → DENEGADO', async () => {
    await assertFails(
      setDoc(
        doc(
          authedDb('uid-boot-3', bootToken({ firebase: { sign_in_provider: 'password' } })),
          'roles',
          'uid-boot-3'
        ),
        altaAdmin()
      )
    );
  });
  it('B4: el alta unassigned no se ve afectada (cualquier proveedor)', async () => {
    await assertSucceeds(
      setDoc(
        doc(
          authedDb('uid-nuevo', {
            email: 'x@test.invalid',
            firebase: { sign_in_provider: 'password' },
          }),
          'roles',
          'uid-nuevo'
        ),
        {
          email: 'x@test.invalid',
          displayName: '',
          role: 'unassigned',
          vendor: null,
          createdAt: new Date(),
        }
      )
    );
  });
});
