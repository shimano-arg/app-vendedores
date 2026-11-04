/**
 * S04b PR-B (2026-11-04) — congelamiento de credenciales legacy en /roles.
 *
 * Verifica contra el emulador Firestore que ningún cliente (ni admin) puede
 * crear/modificar/eliminar passwordHash/passwordSalt/totpSecret/totpEnabled
 * vía un update, y que el resto de los campos administrativos sigue editable.
 * Admin SDK (Cloud Functions PR-A) omite estas reglas → su dual-write no se ve
 * afectado (no se prueba acá porque usa bypass).
 *
 * Requiere el emulador. A diferencia del resto de la suite, FALLA si no está
 * disponible (evidencia real), igual que sec-04-roles.test.js.
 */

import { deleteField } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anonDb,
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  clearTestEnv,
  deleteDoc,
  doc,
  getDoc,
  initTestEnv,
  seedCanonicalRoles,
  seedDoc,
  setDoc,
  UID,
  updateDoc,
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
  // Un doc de rol con credenciales legacy ya presentes (como las dejaría el
  // dual-write de PR-A), para probar modificación/eliminación.
  await seedDoc(`roles/${UID.vendor}`, {
    role: 'vendedor',
    vendor: 'VDE_GONZALO',
    internalPartnerUid: UID.internoPartnered,
    passwordHash: 'h',
    passwordSalt: 's',
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpEnabled: true,
  });
});

const CRED_FIELDS = ['passwordHash', 'passwordSalt', 'totpSecret', 'totpEnabled'];

describe('PR-B — congelamiento de credenciales legacy en /roles (DENEGADOS)', () => {
  for (const f of CRED_FIELDS) {
    it(`admin NO puede MODIFICAR ${f} vía update`, async () => {
      const val = f === 'totpEnabled' ? false : 'x';
      await assertFails(updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), { [f]: val }));
    });
    it(`admin NO puede ELIMINAR ${f} vía update (deleteField)`, async () => {
      // Eliminar un campo = update con deleteField(); el borrado aparece en el
      // diff.affectedKeys() → el guard lo bloquea igual que una modificación.
      await assertFails(
        updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), { [f]: deleteField() })
      );
    });
  }

  it('admin NO puede modificar VARIOS campos protegidos en una sola operación', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), {
        passwordHash: 'x',
        totpSecret: 'y',
        totpEnabled: false,
      })
    );
  });

  it('admin NO puede mezclar un campo permitido con uno protegido (el protegido bloquea todo)', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), {
        displayName: 'Nuevo Nombre',
        totpSecret: 'y',
      })
    );
  });

  it('admin NO puede CREAR un campo de credencial que no existía (setTotp-like) vía update', async () => {
    // partimos de un doc sin totp en otro vendor
    await seedDoc(`roles/${UID.vendorOther}`, { role: 'vendedor', vendor: 'VDE_OTRO' });
    await assertFails(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendorOther), { totpSecret: 'nuevo' })
    );
  });

  it('vendedor NO puede modificar credenciales propias', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'roles', UID.vendor), { passwordHash: 'x' })
    );
  });
  it('vendedor NO puede modificar credenciales ajenas', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendorOther), 'roles', UID.vendor), { totpSecret: 'x' })
    );
  });
  it('anónimo NO puede modificar /roles', async () => {
    await assertFails(updateDoc(doc(anonDb(), 'roles', UID.vendor), { passwordHash: 'x' }));
  });
});

describe('PR-B — comportamiento preservado (PERMITIDOS / sin cambio)', () => {
  it('admin SÍ puede modificar un campo administrativo no sensible (role)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), { role: 'gerente' })
    );
  });
  it('admin SÍ puede modificar vendor / displayName', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), {
        vendor: 'VDE_NUEVO',
        displayName: 'X',
      })
    );
  });
  it('admin SÍ puede setear fichaClienteEditorFull (flag admin, no credencial)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), { fichaClienteEditorFull: true })
    );
  });

  it('CREATE: restricción existente se conserva (unassigned OK, otros roles NO)', async () => {
    const nuevo = 'uid-nuevo-prb';
    const db = authedDb(nuevo);
    await assertSucceeds(setDoc(doc(db, 'roles', nuevo), { role: 'unassigned', email: 'n@x.com' }));
    const nuevo2 = 'uid-nuevo2-prb';
    await assertFails(setDoc(doc(authedDb(nuevo2), 'roles', nuevo2), { role: 'vendedor' }));
  });

  it('CREATE: un cliente no puede crear su doc con credenciales (hasOnly SEC-04 lo bloquea)', async () => {
    const nuevo = 'uid-cred-prb';
    await assertFails(
      setDoc(doc(authedDb(nuevo), 'roles', nuevo), {
        role: 'unassigned',
        email: 'n@x.com',
        passwordHash: 'x',
      })
    );
  });

  it('DELETE del doc: sigue restringido a admin', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'roles', UID.vendor)));
    await assertSucceeds(deleteDoc(doc(authedDb(UID.admin), 'roles', UID.vendor)));
  });

  it('READ: se conserva (admin lee cualquiera; unassigned lee su propio doc)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'roles', UID.vendor)));
    await assertSucceeds(getDoc(doc(authedDb(UID.unassigned), 'roles', UID.unassigned)));
  });
});
