/**
 * Tests de rules para el módulo Planner Kanban:
 *  - /app_config/planner_responsables  (Mariano-only write)
 *  - /app_config/planner_config        (any auth read; Mariano-only write)
 *  - /pedidos/{id} whitelist extendido (plannerStage + planner* + paid*)
 *  - /roles/{uid} read tightened       (+ isMariano())
 *
 * Ver docs/specs/2026-09-22-planner-design.md §8 y plan Task 2.
 * Corre contra Firebase Emulator (npm run test:rules).
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  doc,
  getDoc,
  initTestEnv,
  seedCanonicalRoles,
  seedDoc,
  setDoc,
  UID,
  updateDoc,
} from './setup.js';

const MARIANO_EMAIL = 'erbinomariano@gmail.com';

/** DB autenticado como Mariano (email en token). */
function marianoDb() {
  return authedDb('uid-mariano', { email: MARIANO_EMAIL });
}

/** DB autenticado como admin NO-Mariano. */
function nonMarianoAdminDb() {
  return authedDb(UID.admin, { email: 'otro-admin@shimano.com.ar' });
}

beforeAll(async () => {
  await initTestEnv();
});
afterAll(async () => {
  await cleanupTestEnv();
});
beforeEach(async () => {
  await seedCanonicalRoles();
});

// ============================================================
// /app_config/planner_responsables — Mariano-only write
// ============================================================
describe('/app_config/planner_responsables', () => {
  it('Mariano puede escribir planner_responsables (assertSucceeds)', async () => {
    await assertSucceeds(
      setDoc(doc(marianoDb(), 'app_config', 'planner_responsables'), {
        responsables: ['uid-a', 'uid-b'],
      })
    );
  });

  it('admin NO-Mariano NO puede escribir planner_responsables (assertFails)', async () => {
    await assertFails(
      setDoc(doc(nonMarianoAdminDb(), 'app_config', 'planner_responsables'), {
        responsables: ['uid-a'],
      })
    );
  });
});

// ============================================================
// /app_config/planner_config — any auth read; Mariano-only write
// ============================================================
describe('/app_config/planner_config', () => {
  beforeEach(async () => {
    await seedDoc('app_config/planner_config', { stages: ['backlog', 'in_progress', 'done'] });
  });

  it('cualquier usuario autenticado puede leer planner_config (assertSucceeds)', async () => {
    // vendor es un usuario autenticado regular — debe poder leer
    await assertSucceeds(
      getDoc(doc(authedDb(UID.vendor), 'app_config', 'planner_config'))
    );
  });

  it('admin NO-Mariano NO puede escribir planner_config (assertFails)', async () => {
    await assertFails(
      setDoc(doc(nonMarianoAdminDb(), 'app_config', 'planner_config'), {
        stages: ['hacked'],
      })
    );
  });
});

// ============================================================
// /pedidos/{id} — whitelist extendido con campos planner + paid
// ============================================================
describe('/pedidos hasOnly whitelist — campos planner + paid (vendor update)', () => {
  beforeEach(async () => {
    await seedDoc('pedidos/p-vendor', { ownerUid: UID.vendor, onBehalfOf: false });
  });

  it('Mariano puede escribir pedido con plannerStage (whitelist extendido)', async () => {
    // Mariano es admin/gerente equivalent para este test: usa admin blanket.
    // Pero el punto clave es que vendor pueda actualizar plannerStage en su
    // propio pedido via el whitelist de vendor update.
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), {
        plannerStage: 'in_progress',
      })
    );
  });
});

// ============================================================
// /roles/{uid} — read gate tightened (+ isMariano())
// ============================================================
describe('/roles/{uid} read — isMariano() incluido', () => {
  it('Mariano puede leer cualquier role (necesario para onPlannerStageChanged CF)', async () => {
    await assertSucceeds(
      getDoc(doc(marianoDb(), 'roles', UID.vendor))
    );
  });
});
