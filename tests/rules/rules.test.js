/**
 * Suite integral de Firestore Rules — cubre las 23 colecciones detectadas
 * por grep en index.html + closures nuevas de Fase 0.
 *
 * Corre contra Firebase Emulator (`firebase emulators:exec --only firestore`).
 * Cada test cubre matriz representativa rol × acción por colección.
 *
 * Test de "no rules regression": si querés cambiar una rule, primero
 * cambiás/agregás el test acá, después la rule. Nunca al revés.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addDoc,
  anonDb,
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  initTestEnv,
  query,
  seedCanonicalRoles,
  seedDoc,
  setDoc,
  UID,
  updateDoc,
  where,
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

// ============================================================
// ANON — nadie sin auth puede tocar nada sensible
// ============================================================
describe('anon (no auth)', () => {
  it('deniega read/write a pedidos', async () => {
    const db = anonDb();
    await assertFails(getDoc(doc(db, 'pedidos', 'p1')));
    await assertFails(setDoc(doc(db, 'pedidos', 'p1'), { ownerUid: UID.vendor }));
  });
  it('deniega read a visits', async () => {
    await assertFails(getDoc(doc(anonDb(), 'visits', 'v1')));
  });
  it('deniega read a rendiciones', async () => {
    await assertFails(getDoc(doc(anonDb(), 'rendiciones', 'r1')));
  });
  it('deniega read a app_config/sap_integration', async () => {
    await assertFails(getDoc(doc(anonDb(), 'app_config', 'sap_integration')));
  });
  it('deniega read a roles', async () => {
    await assertFails(getDoc(doc(anonDb(), 'roles', UID.admin)));
  });
  it('deniega read a operations_log', async () => {
    await assertFails(getDoc(doc(anonDb(), 'operations_log', 'l1')));
  });
  it('permite crear client_applications via submittedByPublicForm (alta pública)', async () => {
    // Excepción intencional: el formulario público alta-cliente.html no
    // requiere auth. La rule impone campos obligatorios que actúan como
    // captcha ligero para dificultar spam.
    await assertSucceeds(
      addDoc(collection(anonDb(), 'client_applications'), {
        submittedByPublicForm: true,
        comercio: 'Público SA',
        cuit: '20-12345678-9',
        status: 'pending_approval',
      })
    );
  });
  it('deniega crear client_applications sin submittedByPublicForm', async () => {
    await assertFails(
      addDoc(collection(anonDb(), 'client_applications'), {
        comercio: 'X',
        cuit: '1',
        status: 'pending_approval',
      })
    );
  });
});

// ============================================================
// UNASSIGNED — role nuevo sin permisos efectivos
// ============================================================
describe('unassigned role', () => {
  it('no puede leer nada sensible', async () => {
    const db = authedDb(UID.unassigned);
    await assertFails(getDoc(doc(db, 'pedidos', 'p1')));
    await assertFails(getDoc(doc(db, 'visits', 'v1')));
    await assertFails(getDoc(doc(db, 'app_config', 'sap_integration')));
  });
  it('sí puede leer su propio /roles/{uid} y allowed_emails (para el bootstrap)', async () => {
    const db = authedDb(UID.unassigned);
    await assertSucceeds(getDoc(doc(db, 'roles', UID.unassigned)));
    await assertSucceeds(getDoc(doc(db, 'allowed_emails', 'test@example.com')));
  });
  it('puede crear su propio /roles/{uid} con role=unassigned', async () => {
    // Simulamos un uid nuevo que aún no tiene doc en /roles
    const newUid = 'uid-fresh';
    const db = authedDb(newUid);
    await assertSucceeds(setDoc(doc(db, 'roles', newUid), { role: 'unassigned' }));
  });
  it('NO puede crearse a sí mismo como gerente/vendedor', async () => {
    const newUid = 'uid-fresh-2';
    const db = authedDb(newUid);
    await assertFails(setDoc(doc(db, 'roles', newUid), { role: 'gerente' }));
    await assertFails(setDoc(doc(db, 'roles', newUid), { role: 'vendedor' }));
  });
});

// ============================================================
// /roles y /userData
// ============================================================
describe('/roles', () => {
  it('admin puede leer cualquier role', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'roles', UID.vendor)));
  });
  it('gerente puede leer cualquier role', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.gerente), 'roles', UID.vendor)));
  });
  it('vendor puede leer su propio role', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'roles', UID.vendor)));
  });
  it('vendor NO puede leer role de otro vendor', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'roles', UID.vendorOther)));
  });
  it('interno partnered puede leer role de su VDE (para listener partners)', async () => {
    // vendor tiene internalPartnerUid = UID.internoPartnered en seed
    await assertSucceeds(getDoc(doc(authedDb(UID.internoPartnered), 'roles', UID.vendor)));
  });
  it('solo admin puede update/delete roles', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.admin), 'roles', UID.vendor), { role: 'gerente' })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.gerente), 'roles', UID.vendor), { role: 'admin' })
    );
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'roles', UID.vendor)));
  });
});

describe('/userData', () => {
  it('user puede leer/escribir su propio userData', async () => {
    await assertSucceeds(setDoc(doc(authedDb(UID.vendor), 'userData', UID.vendor), { fav: 'x' }));
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'userData', UID.vendor)));
  });
  it('vendor NO puede leer userData de otro', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'userData', UID.vendorOther)));
  });
  it('admin puede leer userData ajeno', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'userData', UID.vendor)));
  });
});

// ============================================================
// PEDIDOS — closure Fase 0: vendor list solo own
// ============================================================
describe('/pedidos', () => {
  beforeEach(async () => {
    await seedDoc('pedidos/p-vendor', { ownerUid: UID.vendor, onBehalfOf: false });
    await seedDoc('pedidos/p-other', { ownerUid: UID.vendorOther, onBehalfOf: false });
  });

  it('vendor puede get de pedido ajeno (baseline preservada)', async () => {
    // Get individual sigue abierto (necesario para admin/gerente workflows;
    // vendor puede llegar via link directo).
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-other')));
  });

  it('vendor NO puede list sin filter por ownerUid propio (CLOSURE Fase 0)', async () => {
    // La rule de list requiere resource.data.ownerUid == uid para vendor.
    // Un list sin where matcheador es rechazado por el motor de rules.
    const q = collection(authedDb(UID.vendor), 'pedidos');
    await assertFails(getDocs(q));
  });

  it('vendor puede list con where ownerUid == self (CLOSURE Fase 0)', async () => {
    const q = query(
      collection(authedDb(UID.vendor), 'pedidos'),
      where('ownerUid', '==', UID.vendor)
    );
    await assertSucceeds(getDocs(q));
  });

  it('vendor NO puede list con where apuntando a otro vendor (CLOSURE Fase 0)', async () => {
    const q = query(
      collection(authedDb(UID.vendor), 'pedidos'),
      where('ownerUid', '==', UID.vendorOther)
    );
    await assertFails(getDocs(q));
  });

  it('admin puede list sin restricción (preserved)', async () => {
    await assertSucceeds(getDocs(collection(authedDb(UID.admin), 'pedidos')));
  });
  it('gerente puede list sin restricción (preserved)', async () => {
    await assertSucceeds(getDocs(collection(authedDb(UID.gerente), 'pedidos')));
  });
  it('interno puede list sin restricción (preserved)', async () => {
    await assertSucceeds(getDocs(collection(authedDb(UID.interno), 'pedidos')));
  });

  it('vendor puede crear pedido propio', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-new'), { ownerUid: UID.vendor })
    );
  });
  it('vendor NO puede crear pedido de otro', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-new-forge'), { ownerUid: UID.vendorOther })
    );
  });
  it('vendor puede update/delete pedido propio', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor'), { stage: 'confirmed' })
    );
    await assertSucceeds(deleteDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-vendor')));
  });
  it('vendor NO puede update/delete pedido ajeno', async () => {
    await assertFails(updateDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-other'), { stage: 'x' }));
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'pedidos', 'p-other')));
  });

  it('interno partnered puede crear pedido en nombre de su VDE (onBehalfOf=true)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.internoPartnered), 'pedidos', 'p-on-behalf'), {
        ownerUid: UID.vendor,
        createdByUid: UID.internoPartnered,
        onBehalfOf: true,
      })
    );
  });
  it('interno NO-partnered NO puede crear pedido en nombre de vendor ajeno', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.interno), 'pedidos', 'p-forge'), {
        ownerUid: UID.vendor,
        createdByUid: UID.interno,
        onBehalfOf: true,
      })
    );
  });
});

// ============================================================
// VISITS — misma closure que pedidos
// ============================================================
describe('/visits', () => {
  beforeEach(async () => {
    await seedDoc('visits/v-vendor', { ownerUid: UID.vendor });
    await seedDoc('visits/v-other', { ownerUid: UID.vendorOther });
  });

  it('vendor NO puede list sin filter (CLOSURE Fase 0)', async () => {
    await assertFails(getDocs(collection(authedDb(UID.vendor), 'visits')));
  });
  it('vendor puede list con where ownerUid=self (CLOSURE Fase 0)', async () => {
    const q = query(
      collection(authedDb(UID.vendor), 'visits'),
      where('ownerUid', '==', UID.vendor)
    );
    await assertSucceeds(getDocs(q));
  });
  it('admin/gerente/interno pueden list todo (preserved)', async () => {
    await assertSucceeds(getDocs(collection(authedDb(UID.admin), 'visits')));
    await assertSucceeds(getDocs(collection(authedDb(UID.gerente), 'visits')));
    await assertSucceeds(getDocs(collection(authedDb(UID.interno), 'visits')));
  });
  it('vendor crea visita propia', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'visits', 'v-new'), { ownerUid: UID.vendor })
    );
  });
  it('vendor NO crea visita de otro', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'visits', 'v-forge'), { ownerUid: UID.vendorOther })
    );
  });
  it('vendor update/delete solo la propia', async () => {
    await assertSucceeds(updateDoc(doc(authedDb(UID.vendor), 'visits', 'v-vendor'), { note: 'x' }));
    await assertFails(updateDoc(doc(authedDb(UID.vendor), 'visits', 'v-other'), { note: 'x' }));
  });
});

// ============================================================
// RENDICIONES — misma closure + approve solo admin/gerente
// ============================================================
describe('/rendiciones', () => {
  beforeEach(async () => {
    await seedDoc('rendiciones/r-vendor', { ownerUid: UID.vendor, status: 'pending' });
    await seedDoc('rendiciones/r-other', { ownerUid: UID.vendorOther, status: 'pending' });
  });

  it('vendor NO puede list sin filter (CLOSURE Fase 0)', async () => {
    await assertFails(getDocs(collection(authedDb(UID.vendor), 'rendiciones')));
  });
  it('vendor lista solo con where ownerUid=self', async () => {
    const q = query(
      collection(authedDb(UID.vendor), 'rendiciones'),
      where('ownerUid', '==', UID.vendor)
    );
    await assertSucceeds(getDocs(q));
  });
  it('admin/gerente listan todo', async () => {
    await assertSucceeds(getDocs(collection(authedDb(UID.admin), 'rendiciones')));
    await assertSucceeds(getDocs(collection(authedDb(UID.gerente), 'rendiciones')));
  });
  it('vendor crea rendición propia; NO puede aprobar (update)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'rendiciones', 'r-new'), { ownerUid: UID.vendor })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'rendiciones', 'r-vendor'), { status: 'approved' })
    );
  });
  it('gerente aprueba rendición', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.gerente), 'rendiciones', 'r-vendor'), { status: 'approved' })
    );
  });
  it('vendor NO puede borrar rendición (solo admin/gerente)', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'rendiciones', 'r-vendor')));
    await assertSucceeds(deleteDoc(doc(authedDb(UID.admin), 'rendiciones', 'r-vendor')));
  });
});

// ============================================================
// app_config — closure Fase 0: sap_integration solo admin+gerente
// ============================================================
describe('/app_config', () => {
  beforeEach(async () => {
    await seedDoc('app_config/sap_integration', { url: 'https://x', password: 'secret' });
    await seedDoc('app_config/gemini', { apiKey: 'gk' });
    await seedDoc('app_config/stock_snapshot', { updatedAt: 'x' });
  });

  it('admin lee sap_integration', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'app_config', 'sap_integration')));
  });
  it('gerente lee sap_integration', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.gerente), 'app_config', 'sap_integration')));
  });
  it('vendedor NO lee sap_integration (CLOSURE Fase 0)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'app_config', 'sap_integration')));
  });
  it('interno NO lee sap_integration (CLOSURE Fase 0)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.interno), 'app_config', 'sap_integration')));
  });
  it('viewer NO lee sap_integration (CLOSURE Fase 0)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.viewer), 'app_config', 'sap_integration')));
  });
  it('anon NO lee sap_integration', async () => {
    await assertFails(getDoc(doc(anonDb(), 'app_config', 'sap_integration')));
  });

  it('v551: vendedor NO lee app_config/gemini (key movida a Secret Manager)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'app_config', 'gemini')));
  });
  it('v551: interno NO lee app_config/gemini', async () => {
    await assertFails(getDoc(doc(authedDb(UID.interno), 'app_config', 'gemini')));
  });
  it('v551: admin/gerente SÍ leen app_config/gemini (para revisar doc legacy)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'app_config', 'gemini')));
    await assertSucceeds(getDoc(doc(authedDb(UID.gerente), 'app_config', 'gemini')));
  });
  it('vendedor SÍ lee otros docs de app_config (preserved para stock/etc)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'app_config', 'stock_snapshot')));
  });
  it('solo admin puede write en app_config', async () => {
    await assertSucceeds(setDoc(doc(authedDb(UID.admin), 'app_config', 'foo'), { x: 1 }));
    await assertFails(setDoc(doc(authedDb(UID.gerente), 'app_config', 'foo'), { x: 1 }));
    await assertFails(setDoc(doc(authedDb(UID.vendor), 'app_config', 'foo'), { x: 1 }));
  });
});

// ============================================================
// client_applications — flujo público + owner delete
// ============================================================
describe('/client_applications', () => {
  beforeEach(async () => {
    // ca-vendor: creado por vendor (ownerUid), assignedVendor NO seteado.
    // Vendor lee via ownerUid (Mis solicitudes). Otros vendors NO leen.
    await seedDoc('client_applications/ca-vendor', { ownerUid: UID.vendor, status: 'approved' });
    await seedDoc('client_applications/ca-with-sap', {
      ownerUid: UID.vendor,
      status: 'approved',
      cardCodeSap: 'C1',
    });
    // v548: docs para probar la nueva rule.
    await seedDoc('client_applications/ca-assigned-to-vendor', {
      ownerUid: UID.admin,
      assignedVendor: 'VDE_GONZALO',
      status: 'approved',
    });
    await seedDoc('client_applications/ca-assigned-to-other', {
      ownerUid: UID.admin,
      assignedVendor: 'VDE_OTRO',
      status: 'approved',
    });
    await seedDoc('client_applications/ca-huerfano', {
      ownerUid: UID.admin,
      status: 'approved',
      // sin assignedVendor
    });
  });
  it('viewer lee cualquier alta (backward compat)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.viewer), 'client_applications', 'ca-vendor')));
    await assertSucceeds(getDoc(doc(authedDb(UID.viewer), 'client_applications', 'ca-huerfano')));
  });
  it('v548: vendor SÍ lee alta que él creó (ownerUid, para Mis solicitudes)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-vendor')));
  });
  it('v548: vendor SÍ lee alta asignada a él (assignedVendor==myVendor)', async () => {
    await assertSucceeds(
      getDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-assigned-to-vendor'))
    );
  });
  it('v548: vendor NO lee alta asignada a otro vendor', async () => {
    await assertFails(
      getDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-assigned-to-other'))
    );
  });
  it('v548: vendor NO lee alta huérfana (sin assignedVendor, no fue creada por él)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-huerfano')));
  });
  it('v548: admin/gerente/interno SÍ leen alta huérfana', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'client_applications', 'ca-huerfano')));
    await assertSucceeds(getDoc(doc(authedDb(UID.gerente), 'client_applications', 'ca-huerfano')));
    await assertSucceeds(getDoc(doc(authedDb(UID.interno), 'client_applications', 'ca-huerfano')));
  });
  it('vendor crea alta propia', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-new'), { ownerUid: UID.vendor })
    );
  });
  it('vendor puede borrar alta propia SIN cardCodeSap', async () => {
    await assertSucceeds(deleteDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-vendor')));
  });
  it('vendor NO puede borrar alta propia CON cardCodeSap (protege pedidos huérfanos)', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'client_applications', 'ca-with-sap')));
  });
  it('gerente puede borrar alta con cardCodeSap', async () => {
    await assertSucceeds(
      deleteDoc(doc(authedDb(UID.gerente), 'client_applications', 'ca-with-sap'))
    );
  });
  it('interno puede update (aprobar) altas', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'client_applications', 'ca-vendor'), { status: 'x' })
    );
  });
});

// ============================================================
// Colecciones admin-gerente escrituras
// ============================================================
describe('colecciones admin+gerente write', () => {
  const cases = [
    'campaigns',
    'sap_clients',
    'sap_products',
    'sap_vendors',
    'vendor_overrides',
    'client_master',
    'targets',
  ];
  for (const col of cases) {
    it(`${col}: reader lee, solo admin/gerente escribe`, async () => {
      await seedDoc(`${col}/x`, { foo: 1 });
      await assertSucceeds(getDoc(doc(authedDb(UID.vendor), col, 'x')));
      await assertSucceeds(setDoc(doc(authedDb(UID.admin), col, 'y'), { foo: 2 }));
      await assertSucceeds(setDoc(doc(authedDb(UID.gerente), col, 'z'), { foo: 3 }));
      await assertFails(setDoc(doc(authedDb(UID.vendor), col, 'w'), { foo: 4 }));
      await assertFails(setDoc(doc(authedDb(UID.interno), col, 'w2'), { foo: 5 }));
    });
  }

  it('client_locations: vendor/interno pueden crear pero no update/delete', async () => {
    await seedDoc('client_locations/loc1', { addr: 'x' });
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'client_locations', 'loc-new'), { addr: 'y' })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'client_locations', 'loc1'), { addr: 'z' })
    );
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.gerente), 'client_locations', 'loc1'), { addr: 'z' })
    );
  });

  it('product_catalog: reader lee, solo admin escribe (gerente NO)', async () => {
    await seedDoc('product_catalog/chunk_0', { items: [] });
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'product_catalog', 'chunk_0')));
    await assertSucceeds(
      setDoc(doc(authedDb(UID.admin), 'product_catalog', 'chunk_1'), { items: [] })
    );
    await assertFails(
      setDoc(doc(authedDb(UID.gerente), 'product_catalog', 'chunk_2'), { items: [] })
    );
  });
});

// ============================================================
// route_overrides — vendor puede crear (con createdByUid propio)
// ============================================================
describe('/route_overrides', () => {
  it('vendor crea con createdByUid propio', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'route_overrides', 'ro1'), { createdByUid: UID.vendor })
    );
  });
  it('vendor NO crea con createdByUid ajeno (forgery)', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'route_overrides', 'ro2'), { createdByUid: UID.vendorOther })
    );
  });
  it('vendor NO update/delete (solo admin/gerente)', async () => {
    await seedDoc('route_overrides/ro-existing', { createdByUid: UID.vendor });
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'route_overrides', 'ro-existing'), { x: 1 })
    );
  });
});

// ============================================================
// custom_routes — dueño exclusivo
// ============================================================
describe('/custom_routes', () => {
  beforeEach(async () => {
    await seedDoc('custom_routes/cr-mine', { ownerUid: UID.vendor });
    await seedDoc('custom_routes/cr-other', { ownerUid: UID.vendorOther });
  });
  it('vendor lee/edita solo las suyas', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'custom_routes', 'cr-mine')));
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'custom_routes', 'cr-other')));
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'custom_routes', 'cr-mine'), { stops: [] })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.vendor), 'custom_routes', 'cr-other'), { stops: [] })
    );
  });
  it('admin/gerente ven todas', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'custom_routes', 'cr-other')));
    await assertSucceeds(getDoc(doc(authedDb(UID.gerente), 'custom_routes', 'cr-other')));
  });
  it('vendor NO puede crear con ownerUid ajeno', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'custom_routes', 'cr-forge'), { ownerUid: UID.vendorOther })
    );
  });
});

// ============================================================
// notifications — sender/receiver y admin
// ============================================================
describe('/notifications', () => {
  beforeEach(async () => {
    await seedDoc('notifications/n-to-me', { targetUid: UID.vendor, fromUid: UID.admin });
    await seedDoc('notifications/n-to-other', { targetUid: UID.vendorOther, fromUid: UID.admin });
  });
  it('vendor lee las notif dirigidas a él', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'notifications', 'n-to-me')));
  });
  it('vendor NO lee notif ajenas', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'notifications', 'n-to-other')));
  });
  it('vendor puede marcar leída (update) la suya', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.vendor), 'notifications', 'n-to-me'), { readAt: 't' })
    );
  });
  it('vendor puede borrar la suya recibida (feature v322)', async () => {
    await assertSucceeds(deleteDoc(doc(authedDb(UID.vendor), 'notifications', 'n-to-me')));
  });
  it('vendor NO puede borrar la de otro', async () => {
    await assertFails(deleteDoc(doc(authedDb(UID.vendor), 'notifications', 'n-to-other')));
  });
  it('vendor crea notif con fromUid propio', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'notifications', 'n-new'), {
        fromUid: UID.vendor,
        targetUid: UID.admin,
      })
    );
  });
  it('vendor NO crea notif con fromUid ajeno (spoofing)', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'notifications', 'n-forge'), {
        fromUid: UID.admin,
        targetUid: UID.vendor,
      })
    );
  });
});

// ============================================================
// operations_log — audit trail append-only
// ============================================================
describe('/operations_log', () => {
  beforeEach(async () => {
    await seedDoc('operations_log/l1', { userUid: UID.vendor, action: 'x' });
  });
  it('admin y viewer leen', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'operations_log', 'l1')));
    await assertSucceeds(getDoc(doc(authedDb(UID.viewer), 'operations_log', 'l1')));
  });
  it('gerente NO lee (baseline preservada)', async () => {
    await assertFails(getDoc(doc(authedDb(UID.gerente), 'operations_log', 'l1')));
  });
  it('vendor NO lee', async () => {
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'operations_log', 'l1')));
  });
  it('cualquiera puede append con su propio userUid', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.vendor), 'operations_log', 'l-new'), {
        userUid: UID.vendor,
        action: 'x',
      })
    );
  });
  it('nadie puede update ni delete (audit-only)', async () => {
    await assertFails(updateDoc(doc(authedDb(UID.admin), 'operations_log', 'l1'), { x: 1 }));
    await assertFails(deleteDoc(doc(authedDb(UID.admin), 'operations_log', 'l1')));
  });
});

// ============================================================
// seguimiento_notes y seguimiento_status
// ============================================================
describe('/seguimiento_*', () => {
  it('vendor NO puede leer seguimiento (es panel VDI)', async () => {
    await seedDoc('seguimiento_notes/n1', { authorUid: UID.interno });
    await assertFails(getDoc(doc(authedDb(UID.vendor), 'seguimiento_notes', 'n1')));
  });
  it('interno/gerente/admin leen', async () => {
    await seedDoc('seguimiento_notes/n1', { authorUid: UID.interno });
    await assertSucceeds(getDoc(doc(authedDb(UID.interno), 'seguimiento_notes', 'n1')));
    await assertSucceeds(getDoc(doc(authedDb(UID.gerente), 'seguimiento_notes', 'n1')));
    await assertSucceeds(getDoc(doc(authedDb(UID.admin), 'seguimiento_notes', 'n1')));
  });
  it('interno crea nota con authorUid propio', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.interno), 'seguimiento_notes', 'n-new'), { authorUid: UID.interno })
    );
  });
  it('interno NO puede crear con authorUid ajeno (spoof)', async () => {
    await assertFails(
      setDoc(doc(authedDb(UID.interno), 'seguimiento_notes', 'n-forge'), { authorUid: UID.gerente })
    );
  });
  it('interno solo edita/borra sus propias notas', async () => {
    await seedDoc('seguimiento_notes/n-mine', { authorUid: UID.interno });
    await seedDoc('seguimiento_notes/n-partner', { authorUid: UID.internoPartnered });
    await assertSucceeds(
      updateDoc(doc(authedDb(UID.interno), 'seguimiento_notes', 'n-mine'), { text: 'x' })
    );
    await assertFails(
      updateDoc(doc(authedDb(UID.interno), 'seguimiento_notes', 'n-partner'), { text: 'x' })
    );
  });
  it('seguimiento_status: mismo patrón, cada VDI ve/edita el suyo por cliente', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.interno), 'seguimiento_status', 's-x'), { authorUid: UID.interno })
    );
    await assertFails(
      setDoc(doc(authedDb(UID.vendor), 'seguimiento_status', 's-y'), { authorUid: UID.vendor })
    );
  });
});

// ============================================================
// allowed_emails — read: cualquier auth (bootstrap flow)
// ============================================================
describe('/allowed_emails', () => {
  beforeEach(async () => {
    await seedDoc('allowed_emails/foo@x.com', { granted: true });
  });
  it('cualquier auth lee (bootstrap)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(UID.unassigned), 'allowed_emails', 'foo@x.com')));
    await assertSucceeds(getDoc(doc(authedDb(UID.vendor), 'allowed_emails', 'foo@x.com')));
  });
  it('anon NO lee', async () => {
    await assertFails(getDoc(doc(anonDb(), 'allowed_emails', 'foo@x.com')));
  });
  it('solo admin escribe (gerente NO)', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(UID.admin), 'allowed_emails', 'new@x.com'), { granted: true })
    );
    await assertFails(
      setDoc(doc(authedDb(UID.gerente), 'allowed_emails', 'new2@x.com'), { granted: true })
    );
  });
});
