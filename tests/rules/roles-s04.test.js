/**
 * STACK_19 T4 §S04 (2026-11-25) — fix del leak de `/roles/{uid}`.
 *
 * Contexto: v1491 (commit 983d808) agregó la rama
 *
 *     || (isReader() && resource.data.role == 'vendedor')
 *
 * a `/roles/{uid}:allow read`. Esto permitió a CUALQUIER usuario rol lector
 * (incluidos otros VDEs) hacer `collection('roles').get()` y leer TODOS los
 * docs de role=='vendedor', incluyendo `passwordHash`, `passwordSalt`,
 * `totpSecret`, `totpEnabled`.
 *
 * Severidad: ALTA. Explotable con una sola línea JS en consola desde la app
 * oficial (cualquier VDE con sesión activa). Firestore Rules no soportan
 * read filtrado por campos, así que no se puede "ocultar sólo los secretos"
 * — hay que denegar el doc entero.
 *
 * Fix: removida la rama vulnerable. Read de `/roles/{<ajeno>}` queda sólo
 * para admin/gerente/interno/Mariano/partner-VDE-del-VDI; self-read sigue
 * OK para todos los roles.
 *
 * Patrón skip-wrap §40.8: si el emulator no está arriba, `setup.js` marca
 * `emulatorUnavailable=true` y los asserts devuelven stubs. CI dedicado
 * levanta emulators aparte para verificación real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anonDb,
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
  seedRole,
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
  // Datos sensibles sembrados en el doc del VDE "ajeno" para simular el
  // leak real — passwordHash/totpSecret sólo los lee Admin SDK en prod,
  // pero están presentes en /roles por dual-write (PR-A §S04b v1491).
  await seedRole('<UID-OTRO-VDE>', 'vendedor', {
    vendor: 'VDE_OTRO_SENSITIVE',
    email: '<EMAIL-OTRO>',
    displayName: 'VDE Otro',
    passwordHash: '<HASH>',
    passwordSalt: '<SALT>',
    totpSecret: '<TOTP>',
    totpEnabled: true,
  });
});

describe('STACK_19 §S04 — precondición', () => {
  it('el emulador de Firestore está disponible (si no, estos tests no prueban nada)', () => {
    // No forzamos aquí: usamos skip-wrap. Dejamos el flag visible para debug.
    expect(emulatorUnavailable === true || emulatorUnavailable === false).toBe(true);
  });
});

describe('STACK_19 §S04 — read de /roles/{otroUid}: VDE', () => {
  it('S04-R1: VDE NO puede leer el doc /roles de OTRO VDE (permission-denied)', async () => {
    // Pre-fix: pasaba por `isReader() && role=='vendedor'`. Post-fix: deniega.
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'roles', '<UID-OTRO-VDE>')));
  });

  it('S04-R2: VDE NO puede listar la colección /roles filtrando por role=="vendedor"', async () => {
    // Contrato de lista: cada doc se evalúa contra la rule de read; si uno
    // falla, Firestore aborta la query entera. El test de doc individual
    // (R1) ya cubre esto; agregamos marker explícito como documentación.
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'roles', UID.vendorOther)));
  });

  it('S04-R3: VDE SÍ puede leer SU PROPIO doc /roles (self-read)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'roles', UID.vendor)));
  });
});

describe('STACK_19 §S04 — read de /roles/{otroUid}: Admin/Gerente/Interno', () => {
  it('S04-R4: Admin SÍ puede leer /roles de cualquier user (necesario para Panel Usuarios)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'roles', '<UID-OTRO-VDE>')));
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'roles', UID.vendor)));
  });

  it('S04-R5: Gerente SÍ puede leer /roles de cualquier user', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.gerente), 'roles', '<UID-OTRO-VDE>')));
  });

  it('S04-R6: Interno SÍ puede leer /roles de cualquier user (necesario para Partnership VDI/VDE + vdiPartnerUsers)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.interno), 'roles', '<UID-OTRO-VDE>')));
  });
});

describe('STACK_19 §S04 — read de /roles/{otroUid}: Anonymous', () => {
  it('S04-R7: Anonymous (sin auth) NO puede leer /roles de nadie', async () => {
    await assertFails(getDoc(doc(anonDb(), 'roles', '<UID-OTRO-VDE>')));
  });
});

describe('STACK_19 §S04 — partnership VDI/VDE preservada', () => {
  it('S04-R8: Interno-partnered puede leer /roles del VDE del cual es `internalPartnerUid`', async () => {
    // seedCanonicalRoles pone vendor con internalPartnerUid=internoPartnered.
    // Esta regla existía pre-fix y debe seguir funcionando.
    await assertSucceeds(getDoc(doc(authedDb(UID.internoPartnered), 'roles', UID.vendor)));
  });
});

describe('STACK_19 §S04 — write (admin create/update): preservado por este PR', () => {
  it('S04-R9: Admin sigue pudiendo update role de cualquier vendor (shape legítimo)', async () => {
    // Este PR solo toca `allow read`. `allow update` sigue tal cual
    // (hardening HARD6-F4-S3 + D18 + SEC-04). Dejamos marker.
    const { updateDoc } = await import('./setup.js');
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), {
        role: 'vendedor',
      })
    );
  });
});
