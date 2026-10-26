/**
 * §67 (2026-10-25 v1454) — Tests para rules `pedidos.create` E10 Fase 2.
 *
 * Suite preparada para la rule deny-legacy. Se activa cuando el audit
 * `scripts/audit/Y_E10_commit_version_audit.cjs --since=2026-10-22T03:00:00Z`
 * esté GREEN post-deploy de v1454.
 *
 * Hasta entonces el `describe` corre sin activar la rule — los tests que
 * exigen `_commitVersion` quedan SKIPPED (describe.skip) y los tests de
 * compat positivo pasan trivially (ya pasan con la rule actual).
 *
 * Si el audit da GREEN:
 *   1. Habilitar rule `allow create ... && request.resource.data._commitVersion == 'commitPedidoCore_v1'`
 *      en firestore.rules.
 *   2. Cambiar `describe.skip` → `describe` abajo.
 *   3. `firebase deploy --only firestore:rules`.
 *   4. Tests deben pasar.
 *
 * Si audit RED → documentar en el PR qué path escribe legacy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  afterAll as _afterAllHelper,
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  doc,
  initTestEnv,
  seedCanonicalRoles,
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
  await seedCanonicalRoles();
});

// §67 Fase 1 (v1454): tests de compat positivo (rule actual). Ya pasa con la
// rule vigente sin requerir `_commitVersion`.
describe('/pedidos — v1454 §67 Fase 1 compat (rule actual)', () => {
  it('vendor puede crear pedido con _commitVersion (post-§67, flow CF OK)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-v67-cf-ok'), {
        ownerUid: UID.vendor,
        _commitVersion: 'commitPedidoCore_v1',
      })
    );
  });
  it('vendor puede crear pedido sin _commitVersion (hasta activar Fase 2)', async () => {
    // Esta aserción se INVIERTE cuando se active la rule deny-legacy.
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-v67-sin-marker'), {
        ownerUid: UID.vendor,
      })
    );
  });
});

// §67 Fase 2 (v1454+N): Tests de rule deny-legacy. SKIPPED hasta activar la
// rule en firestore.rules. Para activar:
//
//   1. Cambiar `describe.skip` → `describe` abajo.
//   2. Editar firestore.rules `pedidos.allow create`:
//      Agregar `&& request.resource.data._commitVersion == 'commitPedidoCore_v1'`
//      a cada path (vendor/interno/admin).
//   3. `firebase deploy --only firestore:rules`.
//
describe.skip('/pedidos — v1454 §67 Fase 2 deny-legacy (post audit GREEN)', () => {
  it('vendor NO puede crear pedido sin _commitVersion', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-v67-ph2-no-marker'), {
        ownerUid: UID.vendor,
      })
    );
  });
  it('vendor puede crear pedido con _commitVersion=commitPedidoCore_v1', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-v67-ph2-ok'), {
        ownerUid: UID.vendor,
        _commitVersion: 'commitPedidoCore_v1',
      })
    );
  });
  it('vendor NO puede crear pedido con _commitVersion inválido', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-v67-ph2-wrong'), {
        ownerUid: UID.vendor,
        _commitVersion: 'commitPedidoCore_v2_hack',
      })
    );
  });
  it('admin NO puede crear pedido sin _commitVersion (sin excepción para admin)', async () => {
    // La rule debe cerrar TODOS los paths (admin incluido) para forzar al
    // Admin SDK a pasar siempre por el CF o escribir con _commitVersion explícito.
    await assertFails(
      setDoc(doc(authedDb(UID.admin), 'pedidos', 'p-v67-ph2-admin-no-marker'), {
        ownerUid: UID.vendorOther,
      })
    );
  });
  it('interno NO puede crear pedido sin _commitVersion', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.interno), 'pedidos', 'p-v67-ph2-interno-no-marker'), {
        ownerUid: UID.interno,
        onBehalfOf: false,
      })
    );
  });
});
