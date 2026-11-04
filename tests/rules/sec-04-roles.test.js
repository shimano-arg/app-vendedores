/**
 * SEC-04 (P0, 2026-10-29) — escalamiento de privilegios vía campos extra en
 * roles/{uid} y edición de fichas con fichaClienteEditorFull.
 *
 * Requiere el emulador de Firestore. A diferencia del resto de la suite, este
 * archivo FALLA si el emulador no está disponible (en vez de pasar en vacío),
 * para que su resultado sea evidencia real.
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
  initTestEnv,
  seedCanonicalRoles,
  seedDoc,
  seedRole,
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
});

/** Payload legítimo de alta (mismo shape que index.html fetchAndApplyRole). */
function altaLegitima(role = 'unassigned') {
  return {
    email: 'nuevo@example.com',
    displayName: 'Nuevo Usuario',
    role,
    vendor: null,
    createdAt: new Date(),
  };
}

describe('SEC-04 — precondición', () => {
  it('el emulador de Firestore está disponible (si no, estos tests no prueban nada)', () => {
    expect(emulatorUnavailable).toBe(false);
  });
});

describe('SEC-04 — create de roles/{uid}', () => {
  it('R1: alta legítima con los 5 campos → permitida', async () => {
    const uid = 'uid-alta-ok';
    await assertSucceeds(setDoc(doc(authedDb(uid), 'roles', uid), altaLegitima()));
  });

  it('R2: alta mínima {role:"unassigned"} → permitida (compat test histórico)', async () => {
    const uid = 'uid-alta-min';
    await assertSucceeds(setDoc(doc(authedDb(uid), 'roles', uid), { role: 'unassigned' }));
  });

  it('R3: alta con fichaClienteEditorFull:true → DENEGADA', async () => {
    const uid = 'uid-escala-1';
    await assertFails(
      setDoc(doc(authedDb(uid), 'roles', uid), {
        ...altaLegitima(),
        fichaClienteEditorFull: true,
      })
    );
  });

  it('R4: alta con otros campos de privilegio (internalPartnerUid, rendicionesApproverUid, totpSecret) → DENEGADA', async () => {
    for (const [i, extra] of [
      { internalPartnerUid: UID.vendor },
      { rendicionesApproverUid: 'x' },
      { totpSecret: 'x', totpEnabled: true },
    ].entries()) {
      const uid = 'uid-escala-x' + i;
      await assertFails(setDoc(doc(authedDb(uid), 'roles', uid), { ...altaLegitima(), ...extra }));
    }
  });

  it('R5: alta con vendor no nulo → DENEGADA (el vendor lo asigna el admin)', async () => {
    const uid = 'uid-escala-vendor';
    await assertFails(
      setDoc(doc(authedDb(uid), 'roles', uid), { ...altaLegitima(), vendor: 'MAURICIO GIL' })
    );
  });

  it('R6: auto-crearse con rol vendedor sigue DENEGADO', async () => {
    const uid = 'uid-escala-rol';
    await assertFails(setDoc(doc(authedDb(uid), 'roles', uid), altaLegitima('vendedor')));
  });

  it('R7: cuenta bootstrap sigue pudiendo crearse admin con el shape legítimo', async () => {
    const uid = 'uid-boot';
    await assertSucceeds(
      setDoc(
        // D3 (2026-10-29): la regla ahora exige email verificado + Google.
        doc(
          authedDb(uid, {
            email: 'bot.shimano.pesca@gmail.com',
            email_verified: true,
            firebase: { sign_in_provider: 'google.com' },
          }),
          'roles',
          uid
        ),
        altaLegitima('admin')
      )
    );
  });

  it('R8: admin conserva el update de roles (asignar rol y flag de editor)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), {
        role: 'vendedor',
        fichaClienteEditorFull: true,
      })
    );
  });

  it('R9: un no-admin no puede darse el flag por update', async () => {
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'roles', UID.vendor), { fichaClienteEditorFull: true })
    );
  });
});

describe('SEC-04 — isFichaClienteEditor() exige rol con lectura', () => {
  const fichaCompleta = { cliTipo: 'A', creditoCheque: 'si', fidelidad: 'alta' };

  it('F1: unassigned con fichaClienteEditorFull (doc sembrado) → NO puede editar fichas', async () => {
    // Simula una cuenta que logró el flag antes del fix: el flag solo no alcanza.
    await seedRole('uid-flag-sin-rol', 'unassigned', { fichaClienteEditorFull: true });
    await seedDoc('client_master/cli-1', { address: 'x' });
    await assertFails(
      setDoc(doc(authedDb('uid-flag-sin-rol'), 'client_master', 'cli-1'), fichaCompleta)
    );
  });

  it('F2: vendedor SIN el flag → no puede escribir campos completos de la ficha', async () => {
    await seedDoc('client_master/cli-2', { address: 'x' });
    await assertFails(setDoc(doc(authedDb(UID.vendor), 'client_master', 'cli-2'), fichaCompleta));
  });

  it('F3: interno CON el flag (caso legítimo Ioannis/Santiago) → puede editar', async () => {
    await seedRole('uid-editor-ok', 'interno', { fichaClienteEditorFull: true });
    await seedDoc('client_master/cli-3', { address: 'x' });
    await assertSucceeds(
      setDoc(doc(authedDb('uid-editor-ok'), 'client_master', 'cli-3'), fichaCompleta)
    );
  });

  it('F4: admin y gerente conservan la edición de fichas', async () => {
    await seedDoc('client_master/cli-4', { address: 'x' });
    await assertSucceeds(setDoc(doc(authedDb(UID.admin), 'client_master', 'cli-4'), fichaCompleta));
    await assertSucceeds(
      setDoc(doc(authedDb(UID.gerente), 'client_master', 'cli-4'), fichaCompleta)
    );
  });
});
